// File: /api/stripe/webhook.js
// Verifies Stripe signatures, creates Transfers to connected sellers,
// writes db_orders, marks listings SOLD when possible,
// and sends the buyer an order-confirmation email via /api/send-order-confirmation.
//
// ENV: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SITE_URL (or NEXT_PUBLIC_SITE_URL),
//      SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import Stripe from "stripe";
import fetch from "node-fetch";
import supabaseAdmin from "../_supabaseAdmin";

// Let Stripe read the RAW body for signature verification (Next.js-style config)
export const config = { api: { bodyParser: false } };

// ---- Stripe client (safe init so module load never throws) ----
const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
let stripe = null;

try {
  if (!stripeSecret) {
    console.error(
      "[stripe webhook] STRIPE_SECRET_KEY is not set in environment variables"
    );
  } else {
    stripe = new Stripe(stripeSecret, {
      apiVersion: "2023-10-16",
    });
  }
} catch (err) {
  console.error("[stripe webhook] Failed to initialize Stripe client:", err);
}

// ---- Helpers ----

function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Helper: base site URL for calling our own API
function siteBase() {
  return (
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    ""
  ).replace(/\/$/, "");
}

// Helper: send order-confirmation email via our API
async function sendOrderConfirmation({ to, orderId, items }) {
  if (!to) return;
  const base = siteBase();
  if (!base) return; // no site URL configured

  try {
    const res = await fetch(`${base}/api/send-order-confirmation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, orderId, items }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error(
        "[stripe webhook] send-order-confirmation failed:",
        res.status,
        t
      );
    }
  } catch (err) {
    console.error(
      "[stripe webhook] send-order-confirmation error:",
      err?.message || err
    );
  }
}

// Helper: best-effort parse JSON
function safeJsonParse(val, fallback) {
  if (!val || typeof val !== "string") return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

// ---- Main handler ----
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!stripe) {
    console.error(
      "[stripe webhook] Stripe client not initialized (missing or invalid STRIPE_SECRET_KEY)"
    );
    return res.status(500).json({ error: "Stripe not configured" });
  }

  let event;
  try {
    const buf = await buffer(req);
    const signature = req.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!secret) {
      console.error(
        "[stripe webhook] STRIPE_WEBHOOK_SECRET is not set in environment variables"
      );
      return res.status(500).json({ error: "Missing STRIPE_WEBHOOK_SECRET" });
    }

    event = stripe.webhooks.constructEvent(buf, signature, secret);
  } catch (err) {
    console.error(
      "⚠️  Stripe signature verification failed:",
      err?.message || err
    );
    return res
      .status(400)
      .send(`Webhook Error: ${err?.message || "invalid signature"}`);
  }

  // Immediately ACK so Stripe doesn't retry
  res.status(200).json({ received: true });

  // ---- Post-ack processing ----
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        // -----------------------------
        // 1) Basic buyer + metadata
        // -----------------------------
        const buyerEmail =
          session.customer_details?.email ||
          session.customer_email ||
          null;

        const stripeSessionId = session.id;
        const subtotalCents = Number(
          session.metadata?.subtotal_cents || session.amount_subtotal || 0
        );
        const shippingCents = Number(session.metadata?.shipping_cents || 0);
        const totalCents =
          subtotalCents + shippingCents ||
          Number(session.amount_total || 0);

        // sellers_json used for transfers
        let bySeller = {};
        try {
          bySeller = JSON.parse(session.metadata?.sellers_json || "{}");
        } catch {
          bySeller = {};
        }

        // cart_json (optional, used for orders + SOLD + notifications)
        // We expect each item (if available) to look roughly like:
        // { listing_id, name, qty, amount, seller_id, seller_user_id }
        const cartItems =
          safeJsonParse(session.metadata?.cart_json, null) || [];

        // -----------------------------
        // 2) Build a generic "items" array for db_orders + email
        //    Fallback to Stripe line items if cart_json is missing.
        // -----------------------------
        let orderItems = [];

        if (Array.isArray(cartItems) && cartItems.length > 0) {
          orderItems = cartItems.map((it) => ({
            listing_id: it.listing_id ?? null,
            seller_id: it.seller_id ?? null,
            seller_user_id: it.seller_user_id ?? null,
            name: it.name || "Item",
            qty: Number(it.qty || 1),
            amount_cents: Number(it.amount || 0),
          }));
        } else {
          // Fallback to Stripe line items (no listing_ids here)
          try {
            const li = await stripe.checkout.sessions.listLineItems(
              session.id,
              { limit: 20 }
            );
            orderItems =
              li.data?.map((x) => ({
                listing_id: null,
                seller_id: null,
                seller_user_id: null,
                name: x.description || x.price?.nickname || "Item",
                qty: x.quantity || 1,
                amount_cents: x.amount_total ?? 0,
              })) || [];
          } catch {
            orderItems = [];
          }
        }

        // -----------------------------
        // 3) Insert into db_orders
        // -----------------------------
        try {
          const { error: orderErr } = await supabaseAdmin
            .from("db_orders")
            .insert({
              stripe_session_id: stripeSessionId,
              buyer_id: null, // can be wired later if we pass buyer_id in metadata
              buyer_email: buyerEmail,
              total_cents: totalCents || 0,
              shipping_cents: shippingCents || 0,
              items: orderItems,
              status: "PAID",
            });

          if (orderErr) {
            console.error("[stripe] db_orders insert error:", orderErr);
          }
        } catch (e) {
          console.error("[stripe] db_orders insert exception:", e);
        }

        // -----------------------------
        // 4) Mark listings SOLD (if we have listing_ids in cart_items)
        //    and notify sellers that an item sold.
        // -----------------------------
        if (Array.isArray(cartItems) && cartItems.length > 0) {
          for (const it of cartItems) {
            const listingId = it.listing_id;
            const sellerUserId = it.seller_user_id; // Supabase auth.user id
            const name = it.name || "Item";

            // Mark listing as sold in listings table
            if (listingId) {
              try {
                const { error: updErr } = await supabaseAdmin
                  .from("listings")
                  .update({
                    status: "SOLD",
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", listingId);

                if (updErr) {
                  console.error(
                    "[stripe] listing SOLD update error:",
                    listingId,
                    updErr
                  );
                }
              } catch (ex) {
                console.error(
                  "[stripe] listing SOLD update exception:",
                  listingId,
                  ex
                );
              }
            }

            // Notify seller (if we know the seller user id)
            if (sellerUserId) {
              try {
                const { error: notifErr } = await supabaseAdmin
                  .from("notifications")
                  .insert({
                    user_id: sellerUserId,
                    type: "order",
                    kind: "order",
                    title: "Your item sold",
                    body: `“${name}” was just purchased.`,
                    href: "account.html#orders", // can tweak later
                    is_read: false,
                  });

                if (notifErr) {
                  console.error(
                    "[stripe] seller sold notification error:",
                    notifErr
                  );
                }
              } catch (ex) {
                console.error(
                  "[stripe] seller sold notification exception:",
                  ex
                );
              }
            }
          }
        }

        // -----------------------------
        // 5) Send buyer order-confirmation email
        // -----------------------------
        await sendOrderConfirmation({
          to: buyerEmail,
          orderId: stripeSessionId,
          items: orderItems.map((x) => ({
            name: x.name,
            qty: x.qty,
          })),
        });

        // -----------------------------
        // 6) Create Transfers to connected accounts
        // -----------------------------
        const sellerIds = Object.keys(bySeller || {});
        if (!sellerIds.length) {
          console.log("[stripe] session.completed (no sellers_json)");
          break;
        }

        // Find charge that funded the checkout
        const piId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id;

        if (!piId) {
          console.warn(
            "[stripe] Missing payment_intent on session; cannot create transfers."
          );
          break;
        }

        const pi = await stripe.paymentIntents.retrieve(piId, {
          expand: ["latest_charge"],
        });
        const chargeId =
          typeof pi.latest_charge === "string"
            ? pi.latest_charge
            : pi.latest_charge?.id;

        if (!chargeId) {
          console.warn(
            "[stripe] Missing latest_charge on PI; cannot create transfers."
          );
          break;
        }

        for (const acctId of sellerIds) {
          const amount = Math.max(0, Number(bySeller[acctId] || 0)); // cents
          if (!amount) continue;

          try {
            const tr = await stripe.transfers.create({
              amount,
              currency: "usd",
              destination: acctId,
              source_transaction: chargeId,
              metadata: {
                checkout_session: session.id,
                subtotal_cents: String(session.amount_subtotal ?? ""),
                shipping_cents: session.metadata?.shipping_cents ?? "",
              },
            });
            console.log("[stripe] transfer.created", {
              id: tr.id,
              amount,
              destination: acctId,
            });
          } catch (err) {
            console.error(
              `[stripe] transfer error for ${acctId}:`,
              err?.message || err
            );
          }
        }

        // (Optional) you could also write payout-related notifications later.

        break;
      }

      case "payout.paid":
      case "payout.failed":
      case "payout.created": {
        const p = event.data.object;
        console.log(`[stripe] ${event.type}`, {
          id: p.id,
          status: p.status,
          amount: p.amount,
          arrival_date: p.arrival_date,
        });
        break;
      }

      case "account.updated":
      case "account.application.authorized":
      case "account.application.deauthorized": {
        const acct = event.data.object;
        console.log(`[stripe] ${event.type}`, {
          account: acct?.id || event.account,
          charges_enabled: acct?.charges_enabled,
          payouts_enabled: acct?.payouts_enabled,
          requirements_due: acct?.requirements?.currently_due || [],
        });
        break;
      }

      default:
        console.log("[stripe] unhandled event:", event.type);
    }
  } catch (err) {
    console.error("Stripe webhook handler error:", err);
  }
}

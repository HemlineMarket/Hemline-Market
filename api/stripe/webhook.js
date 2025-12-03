// File: /api/stripe/webhook.js
// Verifies Stripe signatures, creates Transfers to connected sellers,
// sends the buyer an order-confirmation email via /api/send-order-confirmation,
// and writes “item sold” notifications for sellers (and buyer, if user id is known).
//
// ENV: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SITE_URL (or NEXT_PUBLIC_SITE_URL),
//      SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

export const config = { api: { bodyParser: false } };

import Stripe from "stripe";
import fetch from "node-fetch";
import supabaseAdmin from "../_supabaseAdmin";

// Stripe client
const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  throw new Error("STRIPE_SECRET_KEY is not set in environment variables");
}
const stripe = new Stripe(stripeSecret, {
  apiVersion: "2023-10-16",
});

// Read raw body so Stripe can verify signatures
function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Base site URL for calling our own APIs + building links in notifications
function siteBase() {
  return (
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    ""
  ).replace(/\/$/, "");
}

// Fire-and-forget email via /api/send-order-confirmation
async function sendOrderConfirmation({ to, orderId, items }) {
  if (!to) return;
  const base = siteBase();
  if (!base) return;

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

// Insert a notification row (best-effort; errors are logged only)
async function insertNotification({
  userId,
  type = "notice",
  kind = "system",
  title,
  body,
  href,
}) {
  if (!userId) return;
  try {
    const payload = {
      user_id: userId,
      type,
      kind,
      title: title || "Notification",
      body: body || "",
      href: href || null,
      is_read: false,
    };
    const { error } = await supabaseAdmin.from("notifications").insert(payload);
    if (error) {
      console.error("[stripe webhook] notifications insert error:", error);
    }
  } catch (err) {
    console.error(
      "[stripe webhook] notifications insert exception:",
      err?.message || err
    );
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  let event;
  try {
    const buf = await buffer(req);
    const signature = req.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      return res
        .status(500)
        .json({ error: "Missing STRIPE_WEBHOOK_SECRET" });
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

  // ACK immediately so Stripe doesn’t retry
  res.status(200).json({ received: true });

  // ---- Post-ack processing (no more writes to res) ----
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        // ---- Buyer email + cart metadata -----------------------------
        const buyerEmail =
          session.metadata?.buyer_email ||
          session.customer_details?.email ||
          session.customer_email ||
          null;

        let cart = [];
        try {
          cart = session.metadata?.cart_json
            ? JSON.parse(session.metadata.cart_json)
            : [];
          if (!Array.isArray(cart)) cart = [];
        } catch {
          cart = [];
        }

        // ---- 1) Send order-confirmation email ------------------------
        let items = [];
        try {
          const li = await stripe.checkout.sessions.listLineItems(session.id, {
            limit: 20,
          });
          items =
            li.data?.map((x) => ({
              name: x.description || x.price?.nickname || "Item",
              qty: x.quantity || 1,
            })) || [];
        } catch {
          items = [];
        }

        await sendOrderConfirmation({
          to: buyerEmail,
          orderId: session.id,
          items,
        });

        // ---- 2) Transfers to connected accounts ----------------------
        // sellers_json should look like: {"acct_123": 1299, "acct_456": 5400}
        let bySeller = {};
        try {
          bySeller = JSON.parse(session.metadata?.sellers_json || "{}");
        } catch {
          bySeller = {};
        }
        const sellerAcctIds = Object.keys(bySeller || {});
        if (!sellerAcctIds.length) {
          console.log(
            "[stripe] session.completed (no sellers_json; skipping transfers)"
          );
        } else {
          // Find the charge that funded the checkout
          const piId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id;

          if (!piId) {
            console.warn(
              "[stripe] Missing payment_intent on session; cannot create transfers."
            );
          } else {
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
            } else {
              for (const acctId of sellerAcctIds) {
                const amount = Math.max(
                  0,
                  Number(bySeller[acctId] || 0) // cents
                );
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
            }
          }
        }

        // ---- 3) In-app notifications: items sold ---------------------
        // cart items are compact: { id, listing_id, name, qty, amount, sellerId }
        const ordersHref = "account.html?tab=orders";
        const cancelWindowMinutes = 30;

        // Seller notifications (one per cart line, per seller user id)
        if (Array.isArray(cart) && cart.length) {
          for (const line of cart) {
            const sellerUserId = line.sellerId || null;
            if (!sellerUserId) continue;

            const qty = Number(line.qty || 1);
            const itemName = line.name || "fabric";

            const title = "You sold an item";
            const body = [
              `Your fabric "${itemName}" was just purchased.`,
              `The buyer has ${cancelWindowMinutes} minutes to cancel before the order is final.`,
              `Please do not ship until that window has passed, then create the label from your Orders page.`,
            ].join(" ");

            await insertNotification({
              userId: sellerUserId,
              type: "order",
              kind: "item_sold",
              title,
              body,
              href: ordersHref,
            });
          }
        }

        // Buyer notification (only if we know buyer user id)
        const buyerUserId =
          session.metadata?.buyer_user_id ||
          session.metadata?.buyerId ||
          null;

        if (buyerUserId) {
          const title = "Order placed";
          const body = [
            "Your Hemline Market order was placed successfully.",
            `You have ${cancelWindowMinutes} minutes to cancel this order from your Orders page before the seller ships.`,
          ].join(" ");

          await insertNotification({
            userId: buyerUserId,
            type: "order",
            kind: "order_created",
            title,
            body,
            href: ordersHref,
          });
        }

        // (Later steps can also:
        //  - create an orders table row
        //  - mark listings as sold
        //  - gate label creation until 30 minutes have passed.)

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

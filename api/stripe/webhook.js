// File: /api/stripe/webhook.js
// Verifies Stripe signatures, creates Transfers to connected sellers,
// creates SOLD notifications, and sends buyer an order-confirmation email.
//
// ENV REQUIRED:
// - STRIPE_SECRET_KEY
// - STRIPE_WEBHOOK_SECRET
// - SITE_URL or NEXT_PUBLIC_SITE_URL
//
// NOTE:
// ThreadTalk reply/like notifications, favorites notifications,
// and message notifications DO NOT belong here.
// They are created separately in your app logic. This webhook handles ONLY payments.

import Stripe from "stripe";
import fetch from "node-fetch";

// Stripe requires raw body for signature verification
export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function siteBase() {
  return (
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    ""
  ).replace(/\/$/, "");
}

// Email helper → calls your /api/send-order-confirmation endpoint
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
      console.error("[webhook] send-order-confirmation failed:", res.status, t);
    }
  } catch (err) {
    console.error("[webhook] send-order-confirmation error:", err?.message || err);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // --- VERIFY STRIPE SIGNATURE ---
  let event;
  try {
    const buf = await buffer(req);
    const signature = req.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!secret) {
      return res.status(500).json({ error: "Missing STRIPE_WEBHOOK_SECRET" });
    }

    event = stripe.webhooks.constructEvent(buf, signature, secret);
  } catch (err) {
    console.error("⚠️ Stripe signature verification failed:", err?.message || err);
    return res.status(400).send(`Webhook Error: ${err?.message || "invalid signature"}`);
  }

  // Immediately ACK — prevents Stripe retries
  res.status(200).json({ received: true });

  // ---------------------- AFTER ACK ---------------------------
  try {
    switch (event.type) {
      // ----------------------------------------------------------
      // PAYMENT COMPLETED
      // ----------------------------------------------------------
      case "checkout.session.completed": {
        const session = event.data.object;

        // 1) Email receipt to buyer
        const buyerEmail =
          session.customer_details?.email ||
          session.customer_email ||
          null;

        let items = [];
        try {
          const li = await stripe.checkout.sessions.listLineItems(session.id, { limit: 40 });
          items = li.data?.map((x) => ({
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

        // 2) Transfer payout allocation (Sep charges + transfer flow)
        let bySeller = {};
        try {
          bySeller = JSON.parse(session.metadata?.sellers_json || "{}");
        } catch {
          bySeller = {};
        }

        const sellerAccountIds = Object.keys(bySeller);
        if (!sellerAccountIds.length) {
          console.log("[stripe] session.completed but no sellers_json");
          break;
        }

        const piId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id;
        if (!piId) {
          console.warn("[stripe] Missing payment_intent; cannot create transfers.");
          break;
        }

        const pi = await stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge"] });
        const chargeId =
          typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;

        if (!chargeId) {
          console.warn("[stripe] Missing latest_charge; cannot transfer.");
          break;
        }

        // --- CREATE TRANSFERS ---
        for (const acctId of sellerAccountIds) {
          const amount = Math.max(0, Number(bySeller[acctId] || 0));

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
            console.log("[stripe] transfer created:", tr.id);
          } catch (err) {
            console.error("[stripe] transfer error:", acctId, err?.message || err);
          }
        }

        // ----------------------------------------------------------
        // 3) SOLD NOTIFICATION (one per seller)
        // ----------------------------------------------------------
        try {
          for (const acctId of sellerAccountIds) {
            // Lookup seller’s Supabase profile using your own API
            const lookup = await fetch(`${siteBase()}/api/lookup-seller-by-stripe`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ stripeAccountId: acctId }),
            }).then((r) => r.json()).catch(() => null);

            if (!lookup || !lookup.id) {
              console.warn("[webhook] no matching profile for Stripe account", acctId);
              continue;
            }

            const sellerUserId = lookup.id;

            // Create notification
            await fetch(`${siteBase()}/api/notify`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                recipient_id: sellerUserId,
                type: "listing_sold",
                kind: "sold",
                title: "Your fabric has sold!",
                body: "You received a new paid order. Prepare to ship your fabric.",
                href: "orders.html",
                is_read: false,
              }),
            });
          }
        } catch (err) {
          console.error("[webhook] sold notification error:", err?.message || err);
        }

        break;
      }

      // ----------------------------------------------------------
      // PAYOUTS
      // ----------------------------------------------------------
      case "payout.paid":
      case "payout.failed":
      case "payout.created": {
        const p = event.data.object;
        console.log(`[stripe] ${event.type}`, {
          id: p.id,
          status: p.status,
          amount: p.amount,
          arrival: p.arrival_date,
        });
        break;
      }

      // ----------------------------------------------------------
      // CONNECTED ACCOUNT EVENTS
      // ----------------------------------------------------------
      case "account.updated":
      case "account.application.authorized":
      case "account.application.deauthorized": {
        const acct = event.data.object;
        console.log(`[stripe] ${event.type}`, {
          account: acct.id || event.account,
          charges_enabled: acct.charges_enabled,
          payouts_enabled: acct.payouts_enabled,
          requirements_due: acct.requirements?.currently_due || [],
        });
        break;
      }

      default:
        console.log("[stripe] unhandled event:", event.type);
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
  }
}

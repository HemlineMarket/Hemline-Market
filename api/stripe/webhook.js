// File: /api/stripe/webhook.js
// Verifies Stripe signatures, creates Transfers to connected sellers,
// and sends the buyer an order-confirmation email via our /api/send-order-confirmation.
// ENV: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SITE_URL (or NEXT_PUBLIC_SITE_URL),
//      SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (only if you later add DB checks)

import Stripe from "stripe";
import fetch from "node-fetch";

// Let Stripe read the RAW body for signature verification
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
      console.error("[stripe webhook] send-order-confirmation failed:", res.status, t);
    }
  } catch (err) {
    console.error("[stripe webhook] send-order-confirmation error:", err?.message || err);
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
    if (!secret) return res.status(500).json({ error: "Missing STRIPE_WEBHOOK_SECRET" });
    event = stripe.webhooks.constructEvent(buf, signature, secret);
  } catch (err) {
    console.error("⚠️  Stripe signature verification failed:", err?.message || err);
    return res.status(400).send(`Webhook Error: ${err?.message || "invalid signature"}`);
  }

  // Immediately ACK so Stripe doesn't retry
  res.status(200).json({ received: true });

  // ---- Post-ack processing ----
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        // 1) Send buyer order-confirmation email
        const buyerEmail =
          session.customer_details?.email ||
          session.customer_email ||
          null;

        // Pull line items (optional; improves email content)
        let items = [];
        try {
          const li = await stripe.checkout.sessions.listLineItems(session.id, { limit: 20 });
          items =
            li.data?.map((x) => ({
              name: x.description || x.price?.nickname || "Item",
              qty: x.quantity || 1,
            })) || [];
        } catch {
          items = [];
        }

        // Fire-and-forget email (logs to email_log inside that API)
        await sendOrderConfirmation({
          to: buyerEmail,
          orderId: session.id,
          items,
        });

        // 2) Create Transfers to connected accounts (separate charges & transfers flow)
        // Expect sellers_json in session.metadata: {"acct_123": 1299, "acct_456": 5400}
        let bySeller = {};
        try {
          bySeller = JSON.parse(session.metadata?.sellers_json || "{}");
        } catch (_) {
          bySeller = {};
        }
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
          console.warn("[stripe] Missing payment_intent on session; cannot create transfers.");
          break;
        }

        const pi = await stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge"] });
        const chargeId =
          typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;

        if (!chargeId) {
          console.warn("[stripe] Missing latest_charge on PI; cannot create transfers.");
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
            console.log("[stripe] transfer.created", { id: tr.id, amount, destination: acctId });
          } catch (err) {
            console.error(`[stripe] transfer error for ${acctId}:`, err?.message || err);
          }
        }

        // (Optional) update your DB order status to PAID / TRANSFERS_CREATED here.

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

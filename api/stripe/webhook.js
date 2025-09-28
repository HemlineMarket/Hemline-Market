// File: /stripe-webhook.js
// Purpose: Handle Stripe webhooks and, on successful checkout, send the buyer
// an order confirmation email via our /api/send-order-confirmation endpoint.
//
// Env required in Vercel:
// - STRIPE_SECRET_KEY
// - STRIPE_WEBHOOK_SECRET
// - SITE_URL (or NEXT_PUBLIC_SITE_URL)  -> e.g. https://hemline-market.vercel.app
//
// Notes:
// - This file is a top-level webhook handler used by your Vercel project routing.
//   If your project uses /api/stripe/webhook.js as the canonical handler, keep that too.
// - This implementation focuses on sending the confirmation email. Your payouts
//   to connected accounts are handled in your other webhook (api/stripe/webhook.js).

import Stripe from "stripe";

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

function getBaseUrl() {
  const base =
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "";
  return base.replace(/\/$/, "");
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
    if (!secret) throw new Error("Missing STRIPE_WEBHOOK_SECRET");
    event = stripe.webhooks.constructEvent(buf, signature, secret);
  } catch (err) {
    console.error("⚠️ Stripe signature verification failed:", err?.message || err);
    return res.status(400).send(`Webhook Error: ${err?.message || "invalid signature"}`);
  }

  // Acknowledge first so Stripe doesn't retry.
  res.status(200).json({ received: true });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        // Pull buyer email + order metadata
        const to =
          session.customer_details?.email ||
          session.customer_email ||
          null;
        const orderId = session.metadata?.orderId || session.client_reference_id || null;

        // Items, if you passed them in metadata at checkout (optional)
        let items = [];
        try {
          items = JSON.parse(session.metadata?.items_json || "[]");
          if (!Array.isArray(items)) items = [];
        } catch (_) {
          items = [];
        }

        if (!to || !orderId) {
          console.warn("[stripe-webhook] missing to/orderId; skipping confirmation email", {
            to,
            orderId,
          });
          break;
        }

        // Call our API to send the email
        const base = getBaseUrl();
        if (!base) {
          console.warn("[stripe-webhook] SITE_URL not set; cannot send confirmation email");
          break;
        }

        const resp = await fetch(`${base}/api/send-order-confirmation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to, orderId, items }),
        });

        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          console.error("[stripe-webhook] send-order-confirmation failed", resp.status, json);
        } else {
          console.log("[stripe-webhook] confirmation email sent", { to, orderId });
        }
        break;
      }

      default:
        // Log other events for observability during launch
        console.log("[stripe-webhook] unhandled event:", event.type);
    }
  } catch (err) {
    // We already responded 200 above; just log failures.
    console.error("[stripe-webhook] post-ack error:", err?.message || err);
  }
}

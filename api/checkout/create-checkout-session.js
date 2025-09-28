// File: /api/checkout/create-checkout-session.js
// Creates a Stripe Checkout Session and embeds everything our webhooks need:
// - metadata.orderId           (used to tie payment → shipping label)
// - metadata.items_json        (shown in confirmation email)
// - metadata.sellers_json      (used to create Transfers to connected accounts)
// - shipping_address_collection (so we get buyer shipping address for Shippo)
//
// ENV required: STRIPE_SECRET_KEY
//
// POST JSON shape (example)
// {
//   "orderId": "HM-771234",
//   "line_items": [
//     { "price": "price_123", "quantity": 1 }
//   ],
//   "sellers_json": { "acct_1Abc...": 1299 },   // cents per connected acct (optional)
//   "customer_email": "buyer@example.com",      // optional if using customer
//   "success_path": "/orders-buyer.html",       // optional
//   "cancel_path": "/cart.html"                 // optional
// }

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const {
      orderId,
      line_items,
      sellers_json = {},
      customer_email,
      success_path = "/orders-buyer.html",
      cancel_path = "/cart.html",
      items = [] // optional, for email summary; if omitted we’ll derive a minimal list
    } = req.body || {};

    if (!orderId) return res.status(400).json({ error: "Missing orderId" });
    if (!Array.isArray(line_items) || line_items.length === 0) {
      return res.status(400).json({ error: "Missing line_items" });
    }

    // Build absolute URLs
    const origin =
      req.headers["x-forwarded-proto"] && req.headers["x-forwarded-host"]
        ? `${req.headers["x-forwarded-proto"]}://${req.headers["x-forwarded-host"]}`
        : `https://${req.headers.host}`;
    const success_url = `${origin}${success_path}?order=${encodeURIComponent(orderId)}&paid=1`;
    const cancel_url = `${origin}${cancel_path}?order=${encodeURIComponent(orderId)}&canceled=1`;

    // Keep items_json small & safe
    const items_json = JSON.stringify(
      (Array.isArray(items) ? items : []).map((i) => ({
        name: String(i.name || "").slice(0, 120),
        qty: Number(i.qty || i.quantity || 1) || 1,
      }))
    );

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url,
      cancel_url,
      customer_email: customer_email || undefined,

      // Collect shipping address so our webhook can pass it to Shippo
      shipping_address_collection: {
        allowed_countries: ["US", "CA"],
      },

      // Surface everything our webhooks need
      metadata: {
        orderId,
        items_json,
        sellers_json: JSON.stringify(sellers_json || {}),
        // optional convenience field
        origin_url: origin,
      },

      // Recommended for marketplaces that charge tax/shipping via prices
      allow_promotion_codes: true,
      submit_type: "pay",
    });

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
}

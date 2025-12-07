// File: /api/checkout/create-checkout-session.js
// Creates a Stripe Checkout Session and embeds everything our webhooks need.

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
      items = [],

      // NEW REQUIRED FIELDS FOR WEBHOOK → ORDERS TABLE
      listing_id,
      seller_id,
      buyer_id,
      price_cents,
      yardage,
      shipping_cents,
      title,
      image_url,
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

    // Minimal item summary
    const items_json = JSON.stringify(
      (Array.isArray(items) ? items : []).map((i) => ({
        name: String(i.name || "").slice(0, 120),
        qty: Number(i.qty || i.quantity || 1) || 1,
      }))
    );

    // -----------------------------------------
    // UPDATED METADATA — THIS FIXES SALES / PURCHASES
    // -----------------------------------------
    const metadata = {
      orderId,
      listing_id,
      seller_id,
      buyer_id,
      price_cents,
      yardage,
      shipping_cents,
      title: title || "",
      image_url: image_url || "",
      items_json,
      sellers_json: JSON.stringify(sellers_json || {}),
      origin_url: origin,
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url,
      cancel_url,
      customer_email: customer_email || undefined,

      shipping_address_collection: {
        allowed_countries: ["US", "CA"],
      },

      metadata,

      allow_promotion_codes: true,
      submit_type: "pay",
    });

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
}

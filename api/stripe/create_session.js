// File: /api/stripe/create_session.js
// Creates Stripe Checkout session and embeds buyer_id so Purchases works.

import Stripe from "stripe";
import supabaseAdmin from "../_supabaseAdmin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    /* ------------------------------------------
       1. AUTH: get buyer from Supabase JWT
    ------------------------------------------ */
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.replace("Bearer ", "")
      : null;

    if (!token) {
      return res.status(401).json({ error: "Missing auth token" });
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: "Invalid user session" });
    }

    const buyerId = user.id;
    const buyerEmail = user.email;

    /* ------------------------------------------
       2. INPUT
    ------------------------------------------ */
    const { cart = [], shipping_cents = 0 } = req.body || {};

    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    // NOTE: current system supports 1 listing per checkout
    const item = cart[0];

    const listingId = item.listing_id || item.id || null;
    const sellerId = item.seller_id || null;
    const title = item.name || "Listing";
    const imageUrl = item.image_url || null;

    const priceCents = Number(item.amount || 0) * Number(item.qty || 1);

    if (!listingId || !sellerId || !priceCents) {
      return res.status(400).json({ error: "Invalid cart item" });
    }

    /* ------------------------------------------
       3. STRIPE SESSION
    ------------------------------------------ */
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: buyerEmail,

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: title,
              images: imageUrl ? [imageUrl] : [],
            },
            unit_amount: priceCents,
          },
          quantity: 1,
        },
        ...(shipping_cents > 0
          ? [
              {
                price_data: {
                  currency: "usd",
                  product_data: { name: "Shipping" },
                  unit_amount: Number(shipping_cents),
                },
                quantity: 1,
              },
            ]
          : []),
      ],

      success_url: `${process.env.PUBLIC_SITE_URL}/success.html`,
      cancel_url: `${process.env.PUBLIC_SITE_URL}/cart.html`,

      metadata: {
        listing_id: listingId,
        seller_id: sellerId,
        buyer_id: buyerId,                // ✅ FIX
        title,
        image_url: imageUrl || "",
        price_cents: priceCents,
        shipping_cents: Number(shipping_cents),
        buyer_email: buyerEmail,
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe create_session error:", err);
    return res.status(500).json({
      error: "Failed to create checkout session",
    });
  }
}

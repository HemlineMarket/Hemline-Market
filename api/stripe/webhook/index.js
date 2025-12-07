// File: /api/stripe/webhook.js

import Stripe from "stripe";
import supabaseAdmin from "../_supabaseAdmin";

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const sig = req.headers["stripe-signature"];
  const buf = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // -------------------------------
  // HANDLE CHECKOUT COMPLETED
  // -------------------------------
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    // Get metadata passed from create_session
    const listingId = session.metadata?.listing_id;
    const buyerId = session.metadata?.buyer_id;
    const itemsCents = parseInt(session.metadata?.items_cents || 0, 10);
    const shippingCents = parseInt(session.metadata?.shipping_cents || 0, 10);

    // Get listing to extract seller_id + title + image_url
    const { data: listing, error: listingErr } = await supabaseAdmin
      .from("listings")
      .select("seller_id, title, image_url")
      .eq("id", listingId)
      .single();

    if (listingErr) {
      console.error("❌ Failed to load listing:", listingErr);
      return res.status(500).json({ error: listingErr.message });
    }

    // Insert the order with seller_id included
    const { error: orderErr } = await supabaseAdmin
      .from("orders")
      .insert({
        listing_id: listingId,
        buyer_id: buyerId,
        seller_id: listing.seller_id,        // ★★★ FIXED: adds seller_id ★★★

        items_cents: itemsCents,
        shipping_cents: shippingCents,
        total_cents: itemsCents + shippingCents,

        stripe_checkout: session.id,
        stripe_payment_intent: session.payment_intent,

        listing_title: listing.title,
        listing_image_url: listing.image_url,

        status: "paid",
        created_at: new Date().toISOString(),
      });

    if (orderErr) {
      console.error("❌ Failed inserting order:", orderErr);
      return res.status(500).json({ error: orderErr.message });
    }

    // Mark listing as SOLD
    await supabaseAdmin
      .from("listings")
      .update({
        sold: true,
        sold_at: new Date().toISOString(),
      })
      .eq("id", listingId);
  }

  res.status(200).json({ received: true });
}

// File: /api/stripe/webhook/index.js
// Handles Stripe events and inserts real orders into Supabase.

import Stripe from "stripe";
import supabaseAdmin from "../../_supabaseAdmin";

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Read raw body for signature verification
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  let event;
  let rawBody;

  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    return res.status(400).send(`Raw body error: ${e.message}`);
  }

  const sig = req.headers["stripe-signature"];

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook signature error: ${err.message}`);
  }

  // ------------------------------
  // CHECKOUT COMPLETED
  // ------------------------------
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const md = session.metadata || {};

    // Insert order into Supabase
    const { error: insertError } = await supabaseAdmin
      .from("orders")
      .insert({
        stripe_checkout: session.id,
        buyer_id: md.buyer_id || null,
        seller_id: md.seller_id || null,
        listing_id: md.listing_id || null,
        yardage: Number(md.yardage) || 1,
        items_cents: Number(md.price_cents) || 0,
        shipping_cents: Number(md.shipping_cents) || 0,
        total_cents:
          (Number(md.price_cents) || 0) +
          (Number(md.shipping_cents) || 0),
        listing_title: md.title || "",
        listing_image: md.image_url || "",
      });

    if (insertError) {
      console.error("Order insert error:", insertError);
      // Still return 200 so Stripe doesn't retry forever
    }

    // Mark listing SOLD
    if (md.listing_id) {
      await supabaseAdmin
        .from("listings")
        .update({
          status: "SOLD",
          cart_set_at: null,
        })
        .eq("id", md.listing_id);
    }
  }

  return res.json({ received: true });
}

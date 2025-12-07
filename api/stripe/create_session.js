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

    // Recover cart from metadata (created in /api/stripe/create_session.js)
    let cart = [];
    if (md.cart_json) {
      try {
        cart = JSON.parse(md.cart_json);
      } catch (e) {
        console.warn("[webhook] Failed to parse cart_json:", e);
      }
    }
    const first = cart[0] || {};

    // Buyer / seller / listing
    const buyerId =
      md.buyer_id ||
      md.buyer_user_id ||
      md.buyerId ||
      md.buyer ||
      null;

    const sellerId =
      md.seller_id ||
      first.seller_user_id ||
      first.seller_id ||
      first.user_id ||
      null;

    const listingId =
      md.listing_id ||
      first.listing_id ||
      first.id ||
      null;

    // Yardage (best-effort; we only support 1 listing per order right now)
    const yardage =
      Number(md.yardage) ||
      Number(first.qty) ||
      1;

    // Amounts (cents)
    let itemsCents = 0;
    if (md.price_cents != null) {
      itemsCents = Number(md.price_cents) || 0;
    } else if (md.subtotal_cents != null) {
      itemsCents = Number(md.subtotal_cents) || 0;
    } else if (first.amount_cents != null) {
      itemsCents = Number(first.amount_cents) || 0;
    }

    const shippingCents = Number(md.shipping_cents) || 0;
    const totalCents = itemsCents + shippingCents;

    const listingTitle =
      md.title ||
      md.listing_title ||
      first.name ||
      "Fabric listing";

    const listingImage = md.image_url || "";

    const cancelExpiresAt = md.cancel_expires_at || null;
    const currency =
      (session.currency || "usd").toUpperCase();

    try {
      // Insert order into Supabase
      const { error: insertError } = await supabaseAdmin
        .from("orders")
        .insert({
          stripe_checkout: session.id,
          buyer_id: buyerId || null,
          seller_id: sellerId || null,
          listing_id: listingId || null,
          yardage: yardage || 1,
          items_cents: itemsCents,
          shipping_cents: shippingCents,
          total_cents: totalCents,
          listing_title: listingTitle,
          listing_image: listingImage,
          status: "PAID",
          currency,
          listing_snapshot: cart && cart.length ? cart : null,
          cancel_expires_at: cancelExpiresAt,
        });

      if (insertError) {
        console.error("[webhook] Order insert error:", insertError);
        // Still return 200 so Stripe doesn’t keep retrying
      }

      // Mark listing SOLD + clear cart lock (single-item cart for now)
      if (listingId) {
        await supabaseAdmin
          .from("listings")
          .update({
            status: "SOLD",
            cart_set_at: null,
          })
          .eq("id", listingId);
      }
    } catch (e) {
      console.error("[webhook] Order handling exception:", e);
      // Do NOT throw a 4xx here; acknowledge to Stripe
    }
  }

  return res.json({ received: true });
}

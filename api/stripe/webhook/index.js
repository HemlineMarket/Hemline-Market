// File: api/stripe/webhook/index.js
// Handles Stripe events and inserts orders into Supabase.

import Stripe from "stripe";
import supabaseAdmin from "../../../_supabaseAdmin.js"; // FIXED PATH

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function getStripeSignatureHeader(req) {
  const h = req.headers?.["stripe-signature"];
  if (Array.isArray(h)) return h.join(",");
  return h ? String(h) : "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const sig = getStripeSignatureHeader(req);
  if (!sig) {
    return res.status(400).send("Webhook signature error: Missing stripe-signature header");
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    return res.status(400).send(`Raw body error: ${e.message}`);
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook signature error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const md = session.metadata || {};

    let listingRow = null;
    if (md.listing_id) {
      const { data, error } = await supabaseAdmin
        .from("listings")
        .select("id, seller_id, title, image_url")
        .eq("id", md.listing_id)
        .maybeSingle();

      if (!error) listingRow = data;
    }

    const sellerId = md.seller_id || listingRow?.seller_id || null;
    const listingTitle = md.title || listingRow?.title || "";
    const listingImageUrl = md.image_url || listingRow?.image_url || null;

    const buyerEmail =
      session.customer_details?.email ||
      session.customer_email ||
      md.buyer_email ||
      null;

    const priceCents = Number(md.price_cents) || 0;
    const shippingCents = Number(md.shipping_cents) || 0;

    const { error: insertError } = await supabaseAdmin.from("orders").insert({
      stripe_checkout_session: session.id,
      stripe_event_id: event.id,
      stripe_payment_intent: session.payment_intent || null,
      buyer_id: md.buyer_id || null,
      buyer_email: buyerEmail,
      seller_id: sellerId,
      listing_id: md.listing_id || null,
      items_cents: priceCents,
      shipping_cents: shippingCents,
      total_cents: priceCents + shippingCents,
      listing_title: listingTitle,
      listing_image_url: listingImageUrl,
      status: "PAID",
    });

    if (!insertError && md.listing_id) {
      await supabaseAdmin
        .from("listings")
        .update({
          status: "SOLD",
          in_cart_by: null,
          reserved_until: null,
          sold_at: new Date().toISOString(),
        })
        .eq("id", md.listing_id);
    }
  }

  return res.status(200).json({ received: true });
}

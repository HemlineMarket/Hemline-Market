// File: api/stripe/webhook/index.js
// FIX: Remove broken _supabaseAdmin import and create admin client inline (CJS-safe)

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } };

// --- Stripe ---
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// --- Supabase ADMIN (inline, no external module) ---
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// --- helpers ---
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function getStripeSignature(req) {
  const h = req.headers["stripe-signature"];
  if (Array.isArray(h)) return h.join(",");
  return h || "";
}

// --- handler ---
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const sig = getStripeSignature(req);
  if (!sig) return res.status(400).send("Missing stripe-signature");

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    return res.status(400).send(e.message);
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    return res.status(400).send(e.message);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const md = session.metadata || {};

    let listing = null;
    if (md.listing_id) {
      const { data } = await supabaseAdmin
        .from("listings")
        .select("id, seller_id, title, image_url")
        .eq("id", md.listing_id)
        .maybeSingle();
      listing = data;
    }

    const priceCents = Number(md.price_cents || 0);
    const shippingCents = Number(md.shipping_cents || 0);

    await supabaseAdmin.from("orders").insert({
      stripe_checkout_session: session.id,
      stripe_event_id: event.id,
      stripe_payment_intent: session.payment_intent || null,
      buyer_id: md.buyer_id || null,
      buyer_email:
        session.customer_details?.email ||
        session.customer_email ||
        md.buyer_email ||
        null,
      seller_id: md.seller_id || listing?.seller_id || null,
      listing_id: md.listing_id || null,
      items_cents: priceCents,
      shipping_cents: shippingCents,
      total_cents: priceCents + shippingCents,
      listing_title: md.title || listing?.title || "",
      listing_image_url: md.image_url || listing?.image_url || null,
      status: "PAID",
    });

    if (md.listing_id) {
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

// File: api/stripe/webhook/index.js
// ESM-only, self-contained Stripe webhook for Vercel.
// Saves order data including shipping address from Stripe checkout.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } };

// Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Supabase (Admin/service role)
function getSupabaseAdmin() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    "";

  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";

  if (!url) {
    throw new Error(
      "Missing Supabase URL env var. Set SUPABASE_URL (preferred)."
    );
  }
  if (!serviceKey) {
    throw new Error(
      "Missing Supabase service role env var. Set SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

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

  // 1) Verify Stripe signature
  const sig = getStripeSignatureHeader(req);
  if (!sig) {
    return res
      .status(400)
      .send("Webhook signature error: Missing stripe-signature header");
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    return res.status(400).send(`Raw body error: ${e?.message || e}`);
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

  // 2) Only handle what you actually need
  if (event.type !== "checkout.session.completed") {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  // 3) Process order
  try {
    const supabaseAdmin = getSupabaseAdmin();

    const session = event.data.object;
    const md = session.metadata || {};

    // Attempt to enrich listing data if we have listing_id
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

    // Extract shipping address from Stripe session
    const shippingDetails = session.shipping_details || session.customer_details || {};
    const shippingAddress = shippingDetails.address || {};

    // Build order data object
    const orderData = {
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
      // Shipping address fields
      shipping_name: shippingDetails.name || session.customer_details?.name || null,
      shipping_address_line1: shippingAddress.line1 || null,
      shipping_address_line2: shippingAddress.line2 || null,
      shipping_city: shippingAddress.city || null,
      shipping_state: shippingAddress.state || null,
      shipping_postal_code: shippingAddress.postal_code || null,
      shipping_country: shippingAddress.country || null,
    };

    // Insert order
    const { error: insertError } = await supabaseAdmin
      .from("orders")
      .insert(orderData);

    // If order insert succeeded, mark listing sold and notify seller
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

      // Notify seller of the sale
      if (sellerId) {
        await supabaseAdmin
          .from("notifications")
          .insert({
            user_id: sellerId,
            type: "sale",
            kind: "sale",
            title: "You made a sale!",
            body: `Your item "${listingTitle}" sold for $${(priceCents / 100).toFixed(2)}`,
            href: "/sales.html",
            link: "/sales.html",
            listing_id: md.listing_id || null,
          });
      }
    }

    // If insert failed, surface it clearly (so Stripe retries, and you see why)
    if (insertError) {
      // Stripe will retry on 500s
      console.error("Webhook order insert failed:", insertError);
      return res.status(500).json({
        error: "Order insert failed",
        details: insertError,
      });
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("Webhook handler error:", e);
    return res.status(500).json({
      error: "Webhook handler error",
      message: e?.message || String(e),
    });
  }
}

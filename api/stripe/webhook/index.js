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

    // Try to look up the listing so we always know the real seller
    let listingRow = null;
    if (md.listing_id) {
      const { data: listing, error: listingError } = await supabaseAdmin
        .from("listings")
        .select("id, seller_id, title, image_url")
        .eq("id", md.listing_id)
        .maybeSingle();

      if (listingError) {
        console.error("Listing lookup error:", listingError);
      } else {
        listingRow = listing;
      }
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

    // Insert order into Supabase
    const { error: insertError } = await supabaseAdmin
      .from("orders")
      .insert({
        stripe_checkout_session: session.id,
        stripe_event_id: event.id,
        buyer_id: md.buyer_id || null,
        buyer_email: buyerEmail,
        seller_id: sellerId,
        listing_id: md.listing_id || null,
        items_cents: priceCents,
        shipping_cents: shippingCents,
        total_cents: priceCents + shippingCents,
        listing_title: listingTitle,
        listing_image_url: listingImageUrl,
        status: "paid",
      });

    if (insertError) {
      console.error("Order insert error:", insertError);
      // Still return 200 so Stripe doesn't retry forever
    }

    // Mark listing SOLD (and clear cart-reserve info if you’re using it)
    if (md.listing_id) {
      const { error: listingUpdateError } = await supabaseAdmin
        .from("listings")
        .update({
          status: "sold",
          in_cart_by: null,
          reserved_until: null,
          sold_at: new Date().toISOString(),
        })
        .eq("id", md.listing_id);

      if (listingUpdateError) {
        console.error("Listing sold update error:", listingUpdateError);
      }
    }
  }

  return res.json({ received: true });
}

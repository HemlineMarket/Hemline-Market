// File: /api/stripe/webhook/index.js
// Handles Stripe events and inserts real orders into Supabase.

import Stripe from "stripe";
import supabaseAdmin from "../../_supabaseAdmin.js";

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
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const sig = req.headers["stripe-signature"];
    if (!sig) return res.status(400).send("Missing Stripe-Signature header");

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

    // ------------------------------
    // CHECKOUT COMPLETED
    // ------------------------------
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const md = session.metadata || {};

      const listingId = md.listing_id || null;

      // Look up listing so we always know the real seller + latest title/image
      let listingRow = null;
      if (listingId) {
        const { data, error } = await supabaseAdmin
          .from("listings")
          .select("id, seller_id, title, image_url_1")
          .eq("id", listingId)
          .maybeSingle();

        if (error) {
          console.error("Listing lookup error:", error);
        } else {
          listingRow = data;
        }
      }

      const sellerId = listingRow?.seller_id || md.seller_id || null;

      const buyerEmail =
        session?.customer_details?.email ||
        session?.customer_email ||
        md.buyer_email ||
        null;

      const buyerId =
        md.buyer_id ||
        session?.client_reference_id ||
        null;

      const priceCents = Number(md.price_cents) || 0;
      const shippingCents = Number(md.shipping_cents) || 0;

      const listingTitle =
        md.title ||
        listingRow?.title ||
        md.listing_title ||
        "";

      const listingImageUrl =
        md.image_url_1 ||
        md.image_url ||
        listingRow?.image_url_1 ||
        md.listing_image_url ||
        null;

      const stripePaymentIntent =
        (typeof session?.payment_intent === "string" && session.payment_intent) ||
        null;

      // Insert / upsert order (idempotent on stripe_checkout_session)
      const { error: upsertErr } = await supabaseAdmin
        .from("orders")
        .upsert(
          {
            stripe_checkout_session: session.id,
            stripe_event_id: event.id,
            stripe_payment_intent: stripePaymentIntent,

            buyer_id: buyerId,
            buyer_email: buyerEmail,

            seller_id: sellerId,
            listing_id: listingId,

            items_cents: priceCents,
            shipping_cents: shippingCents,
            total_cents: priceCents + shippingCents,

            listing_title: listingTitle,
            listing_image_url: listingImageUrl,

            status: "PAID",
          },
          { onConflict: "stripe_checkout_session" }
        );

      if (upsertErr) {
        console.error("Order upsert error:", upsertErr);
        // Return 200 so Stripe doesn't retry forever; you can inspect logs + event payload.
      }

      // Mark listing SOLD (best-effort)
      if (listingId) {
        const { error: listingUpdateError } = await supabaseAdmin
          .from("listings")
          .update({
            status: "SOLD",
            in_cart_by: null,
            reserved_until: null,
            sold_at: new Date().toISOString(),
          })
          .eq("id", listingId);

        if (listingUpdateError) {
          console.error("Listing sold update error:", listingUpdateError);
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("Webhook 500:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

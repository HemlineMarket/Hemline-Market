// File: api/stripe/webhook/index.js
// Stripe webhook -> verify signature with raw body -> write order/listing updates to Supabase (admin client).

const Stripe = require("stripe");

module.exports = async function handler(req, res) {
  // Only POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // --- Helpers ---
  const readRawBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

  const getStripeSignatureHeader = (req) => {
    const h = req.headers && req.headers["stripe-signature"];
    if (Array.isArray(h)) return h.join(",");
    return h ? String(h) : "";
  };

  // --- Validate required env ---
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET_LIVE;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!STRIPE_SECRET_KEY) return res.status(500).send("Server misconfig: STRIPE_SECRET_KEY missing");
  if (!STRIPE_WEBHOOK_SECRET) return res.status(500).send("Server misconfig: STRIPE_WEBHOOK_SECRET missing");
  if (!SUPABASE_URL) return res.status(500).send("Server misconfig: SUPABASE_URL missing");
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).send("Server misconfig: SUPABASE_SERVICE_ROLE_KEY missing");

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

  // --- Get raw body + signature ---
  const sig = getStripeSignatureHeader(req);
  if (!sig) return res.status(400).send("Webhook signature error: Missing stripe-signature header");

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    return res.status(400).send(`Raw body error: ${e.message}`);
  }

  // --- Verify event ---
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature error: ${err.message}`);
  }

  // --- Create Supabase admin client (dynamic import avoids ESM/CJS issues on Vercel) ---
  let supabaseAdmin;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  } catch (e) {
    console.error("Supabase client init error:", e);
    return res.status(500).json({ error: "Supabase client init failed" });
  }

  // --- Handle event(s) ---
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const md = session.metadata || {};

      // Optional: lookup listing to get canonical seller/title/image
      let listingRow = null;
      if (md.listing_id) {
        const { data, error } = await supabaseAdmin
          .from("listings")
          .select("id, seller_id, title, image_url")
          .eq("id", md.listing_id)
          .maybeSingle();

        if (error) console.error("Listing lookup error:", error);
        else listingRow = data;
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

      // Insert order (best-effort). If you have a UNIQUE constraint on stripe_event_id or stripe_checkout_session,
      // retries won’t duplicate.
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

      if (insertError) {
        console.error("Order insert error:", insertError);
        // Return 200 anyway so Stripe doesn’t hammer retries forever.
      }

      // Mark listing SOLD (best-effort)
      if (md.listing_id) {
        const { error: listingUpdateError } = await supabaseAdmin
          .from("listings")
          .update({
            status: "SOLD",
            in_cart_by: null,
            reserved_until: null,
            sold_at: new Date().toISOString(),
          })
          .eq("id", md.listing_id);

        if (listingUpdateError) console.error("Listing sold update error:", listingUpdateError);
      }
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("Webhook handler error:", e);
    return res.status(500).json({ error: "A server error has occurred" });
  }
};

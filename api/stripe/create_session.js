// /api/stripe/create_session.js
// Creates a Stripe Checkout Session for the current cart.

import Stripe from "stripe";
import supabaseAdmin from "../_supabaseAdmin.js";   // ⭐ FIXED PATH ⭐

export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };

const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  throw new Error("STRIPE_SECRET_KEY is not set in environment variables");
}

const stripe = new Stripe(stripeSecret);

function originFrom(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").toString();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
  return `${proto}://${host}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { cart = [], buyer = {}, shipping_cents = 0 } = req.body || {};

    const listingIds = cart.map(i => i.listing_id || i.id).filter(Boolean);

    if (listingIds.length > 0) {
      const { data: listings, error: listingErr } = await supabaseAdmin
        .from("listings")
        .select("id, status")
        .in("id", listingIds);

      if (listingErr || !listings) {
        return res.status(400).json({ error: "Unable to verify listing availability." });
      }

      const unavailable = listings.find(l => l.status !== "ACTIVE");

      if (unavailable) {
        return res.status(409).json({
          error: "This fabric was just sold and is no longer available."
        });
      }
    }

    const sellers = {};
    let subtotal = 0;
    const cartForMeta = [];

    for (const it of cart) {
      const qty = Number(it.qty || 1);
      const amount = Number(it.amount || 0);
      const cents = amount * qty;
      subtotal += cents;

      const sellerStripeAcct = it.sellerId || it.seller || "default";
      sellers[sellerStripeAcct] = (sellers[sellerStripeAcct] || 0) + cents;

      cartForMeta.push({
        listing_id: it.listing_id ?? it.id ?? null,
        seller_id: sellerStripeAcct,
        seller_user_id: it.seller_user_id || null,
        name: it.name || "Fabric item",
        qty,
        amount,
        yards: it.yards ?? null,
      });
    }

    const total = subtotal + Number(shipping_cents || 0);
    if (total <= 0) {
      return res.status(400).json({
        error: "Total must be greater than zero to start checkout."
      });
    }

    const now = new Date();
    const cancelExpiresIso = new Date(now.getTime() + 30 * 60 * 1000).toISOString();

    const origin = originFrom(req);
    const success_url =
      process.env.STRIPE_SUCCESS_URL ||
      `${origin}/success.html?sid={CHECKOUT_SESSION_ID}`;

    const cancel_url =
      process.env.STRIPE_CANCEL_URL || `${origin}/checkout.html`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url,
      cancel_url,
      customer_email: buyer.email || undefined,
      shipping_address_collection: { allowed_countries: ["US", "CA"] },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Fabric purchase" },
            unit_amount: total,
          },
          quantity: 1,
        },
      ],
      metadata: {
        sellers_json: JSON.stringify(sellers),
        shipping_cents: String(Number(shipping_cents || 0)),
        subtotal_cents: String(subtotal),
        cart_json: JSON.stringify(cartForMeta),
        buyer_user_id: buyer.id || buyer.user_id || "",
        cancel_expires_at: cancelExpiresIso,
      },
      automatic_tax: { enabled: false },
    });

    return res.status(200).json({ url: session.url, id: session.id });

  } catch (err) {
    console.error("create_session error:", err?.type, err?.message || err);
    return res.status(500).json({
      error: "Unable to create checkout session",
      detail: err?.message || null,
    });
  }
}

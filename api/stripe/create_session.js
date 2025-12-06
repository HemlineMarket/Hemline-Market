// /api/stripe/create_session.js
// Creates a Stripe Checkout Session for the current cart.
//
// ENV needed: STRIPE_SECRET_KEY
// Optional: STRIPE_SUCCESS_URL, STRIPE_CANCEL_URL (fallbacks to request origin)

import Stripe from "stripe";

export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };

// --- Stripe client ---------------------------------------------------------
const stripeSecret = process.env.STRIPE_SECRET_KEY;

if (!stripeSecret) {
  throw new Error("STRIPE_SECRET_KEY is not set in environment variables");
}

const stripe = new Stripe(stripeSecret);

// Helper: get origin from request (for success/cancel URLs)
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

    // --- simple total from cart -------------------------------------------
    let subtotal = 0;

    for (const it of cart) {
      const qty = Number(it.qty || 1);
      const amount = Number(it.amount || 0); // cents
      subtotal += amount * qty;
    }

    const total = subtotal + Number(shipping_cents || 0);

    if (total <= 0) {
      return res
        .status(400)
        .json({ error: "Total must be greater than zero to start checkout." });
    }

    // 30-minute cancellation window timestamp (metadata only for now)
    const now = new Date();
    const cancelExpiresIso = new Date(now.getTime() + 30 * 60 * 1000).toISOString();

    // Fallback URLs from origin
    const origin = originFrom(req);
    const success_url =
      process.env.STRIPE_SUCCESS_URL ||
      `${origin}/success.html?sid={CHECKOUT_SESSION_ID}`;

    const cancel_url =
      process.env.STRIPE_CANCEL_URL || `${origin}/checkout.html`;

    // One Stripe line item for the entire purchase
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
        subtotal_cents: String(subtotal),
        shipping_cents: String(Number(shipping_cents || 0)),
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

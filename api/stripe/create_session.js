// /api/stripe/create_session.js
// Creates a Stripe Checkout Session for the current cart.
// ENV needed: STRIPE_SECRET_KEY
// Optional: STRIPE_SUCCESS_URL, STRIPE_CANCEL_URL (fallbacks to request origin)

import Stripe from "stripe";

export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };

// --- Stripe client ---------------------------------------------------------
const stripeSecret = process.env.STRIPE_SECRET_KEY;

if (!stripeSecret) {
  // Throw at boot so Vercel logs a very obvious error if the key is missing
  throw new Error("STRIPE_SECRET_KEY is not set in environment variables");
}

// Let Stripe use the account’s default API version.
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

    // Build seller summary for later Transfers (done in webhook)
    // Expected cart item shape (minimal): { id, listing_id?, name, amount, qty, sellerId, seller_user_id?, yards? }
    const sellers = {};
    let subtotal = 0;

    // Also build a compact cart for Stripe metadata → db_orders + SOLD + seller notifications
    const cartForMeta = [];

    for (const it of cart) {
      const qty = Number(it.qty || 1);
      const amount = Number(it.amount || 0); // cents
      const cents = amount * qty;
      subtotal += cents;

      const sellerStripeAcct = it.sellerId || it.seller || "default";
      sellers[sellerStripeAcct] = (sellers[sellerStripeAcct] || 0) + cents;

      cartForMeta.push({
        listing_id: it.listing_id ?? it.id ?? null,
        seller_id: sellerStripeAcct,           // Stripe connected account id (for transfers)
        seller_user_id: it.seller_user_id || null, // Supabase auth.user.id of seller (for notifications)
        name: it.name || "Item",
        qty,
        amount, // cents, per unit
        yards: it.yards ?? null,
      });
    }

    const total = subtotal + Number(shipping_cents || 0);

    if (total <= 0) {
      return res
        .status(400)
        .json({ error: "Order total must be greater than zero to start payment." });
    }

    // 30-minute cancel window timestamp (used by future cancel/hold logic)
    const now = new Date();
    const cancelExpiresIso = new Date(now.getTime() + 30 * 60 * 1000).toISOString();

    // Fallback success/cancel URLs from request origin
    const origin = originFrom(req);
    const success_url =
      process.env.STRIPE_SUCCESS_URL ||
      `${origin}/success.html?sid={CHECKOUT_SESSION_ID}`;
    const cancel_url =
      process.env.STRIPE_CANCEL_URL || `${origin}/checkout.html`;

    // One line item for the whole order (you can expand later if you want)
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url,
      cancel_url,

      // Basic customer hints (Stripe will collect actual card info)
      customer_email: buyer.email || undefined,
      shipping_address_collection: { allowed_countries: ["US", "CA"] },

      // Totals via line_items. (Stripe sums these; amounts are in cents)
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Fabric order" },
            unit_amount: total, // cents
          },
          quantity: 1,
        },
      ],

      // Store data we’ll need in the webhook for:
      // - transfers
      // - db_orders
      // - marking listings SOLD
      // - seller notifications
      metadata: {
        sellers_json: JSON.stringify(sellers),                    // { sellerStripeAcct: amount_cents, ... }
        shipping_cents: String(Number(shipping_cents || 0)),
        subtotal_cents: String(subtotal),
        cart_json: JSON.stringify(cartForMeta),                   // normalized cart
        buyer_user_id: buyer.id || buyer.user_id || "",           // optional
        cancel_expires_at: cancelExpiresIso,                      // 30-min cancel window
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

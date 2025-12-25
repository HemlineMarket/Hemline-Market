// File: /api/stripe/create_session.js
// Creates a Stripe Checkout Session from the client cart payload.
// Defensive: works for (a) single-listing carts and (b) generic multi-item carts
// without crashing (no 500s).

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

function getOrigin(req) {
  // Always use the canonical domain for redirects
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  
  // Fallback to hemlinemarket.com
  return "https://hemlinemarket.com";
}

function asInt(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.trunc(x) : fallback;
}

function safeJsonStringify(obj, maxLen = 450) {
  try {
    const s = JSON.stringify(obj ?? {});
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  } catch {
    return "";
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const origin = getOrigin(req);

    const body = req.body || {};
    const cart = Array.isArray(body.cart) ? body.cart : [];
    const buyerEmail = (body?.buyer?.email || body?.buyer_email || "").toString().trim();
    const buyerId = (body?.buyer?.id || body?.buyer_id || "").toString().trim();
    const shippingCents = Math.max(0, asInt(body?.shipping_cents, 0));

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });
    }

    if (!cart.length) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    // Compute subtotal from cart items (expects cents in it.amount)
    const currency = "usd";
    let itemsCents = 0;

    for (const it of cart) {
      const qty = Math.max(1, asInt(it?.qty, 1));
      const amount = Math.max(0, asInt(it?.amount, 0)); // cents
      itemsCents += amount * qty;
    }

    if (itemsCents <= 0) {
      return res.status(400).json({ error: "Cart total is invalid" });
    }

    // Build Stripe line_items
    // Keep it simple + robust: represent each cart line as its own line item.
    // If any item lacks name, fall back gracefully.
    const line_items = cart.map((it) => {
      const qty = Math.max(1, asInt(it?.qty, 1));
      const name = (it?.name || it?.title || "Fabric").toString();
      const unitAmount = Math.max(0, asInt(it?.amount, 0)); // cents
      return {
        quantity: qty,
        price_data: {
          currency,
          unit_amount: unitAmount,
          product_data: {
            name: name.length > 120 ? name.slice(0, 120) : name,
          },
        },
      };
    });

    // Add shipping as a separate line item so it never disappears
    if (shippingCents > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency,
          unit_amount: shippingCents,
          product_data: { name: "Shipping" },
        },
      });
    }

    // If this is a single-listing style checkout, carry metadata for webhook compatibility
    const first = cart[0] || {};
    const listingId =
      (first.listing_id || first.listingId || body.listing_id || "").toString().trim();
    const sellerId =
      (first.seller_id || first.sellerId || body.seller_id || "").toString().trim();
    const imageUrl = (first.image_url || first.imageUrl || "").toString().trim();
    const title = (first.title || first.name || "").toString().trim();

    const metadata = {
      buyer_email: buyerEmail || "",
      buyer_id: buyerId || "",
      shipping_cents: String(shippingCents),
      price_cents: String(itemsCents),
      // keep these for your existing webhook (safe if blank)
      listing_id: listingId,
      seller_id: sellerId,
      title: title,
      image_url: imageUrl,
      // for debugging / future multi-item support
      cart_json: safeJsonStringify(cart),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      customer_email: buyerEmail || undefined,
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout.html?canceled=1`,
      metadata,
      // Collect shipping address for physical goods
      shipping_address_collection: {
        allowed_countries: ["US", "CA"],
      },
      // optional: helps Stripe receipts & address capture
      billing_address_collection: "auto",
    });

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (err) {
    console.error("[create_session] error", err);
    return res.status(500).json({
      error: "Stripe create_session failed",
      message: err?.message || String(err),
    });
  }
}

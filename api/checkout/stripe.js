// /api/checkout/stripe.js
// Creates a Stripe Checkout Session from the ENTIRE cart.
// Expects POST JSON: { items: [{ id, name, price, currency, quantity, image, url }...] }
// price is in CENTS. currency like "usd". quantity is an integer >= 1.
// Env required: STRIPE_SECRET_KEY

const Stripe = require('stripe');
const crypto = require('crypto');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

function getOrigin(req) {
  // Prefer X-Forwarded-Proto/Host on Vercel
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
  const host  = (req.headers['x-forwarded-host']  || req.headers.host || 'hemlinemarket.com').toString();
  return `${proto}://${host}`;
}

function normalizeItem(it) {
  // Guard + normalize fields
  return {
    id: String(it.id || ''),
    name: String(it.name || '').slice(0, 250),
    price: Math.max(0, Number(it.price || 0)), // cents
    currency: String((it.currency || 'usd')).toLowerCase(),
    quantity: Math.max(1, parseInt(it.quantity || it.qty || 1, 10)),
    image: it.image ? String(it.image) : undefined,
    url: it.url ? String(it.url) : undefined,
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY' });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY);
  const body = await readJson(req);

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) {
    return res.status(400).json({ error: 'items[] is required' });
  }
  if (rawItems.length > 50) {
    return res.status(400).json({ error: 'Too many items (max 50)' });
  }

  // Normalize + validate each line
  const items = rawItems.map(normalizeItem).filter(i => i.name && i.price > 0 && i.quantity > 0);
  if (items.length === 0) {
    return res.status(400).json({ error: 'No valid items after normalization' });
  }

  // All items must share same currency for a single Checkout Session
  const currency = items[0].currency || 'usd';
  const mixed = items.some(i => i.currency !== currency);
  if (mixed) return res.status(400).json({ error: 'All items must have the same currency' });

  const orderId = crypto.randomUUID();
  const origin = getOrigin(req);

  try {
    const line_items = items.map(i => ({
      price_data: {
        currency,
        unit_amount: i.price, // cents
        product_data: {
          name: i.name,
          images: i.image ? [i.image] : undefined,
          metadata: { id: i.id, url: i.url || '' }
        }
      },
      quantity: i.quantity
    }));

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      success_url: `${origin}/checkout-success.html?order_id=${encodeURIComponent(orderId)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cart.html`,
      allow_promotion_codes: true,
      submit_type: 'pay',
      metadata: {
        order_id: orderId
      }
    });

    return res.status(200).json({
      id: session.id,
      url: session.url,
      order_id: orderId
    });
  } catch (err) {
    console.error('stripe.checkout.sessions.create error:', err);
    return res.status(400).json({ error: err.message || 'Stripe error' });
  }
};

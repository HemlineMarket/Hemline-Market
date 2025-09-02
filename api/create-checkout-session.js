// /api/create-checkout-session.js
// Creates a Stripe Checkout Session and ALWAYS includes metadata.order_id.
// Expects JSON POST with: { line_items: [...], success_url: "...", cancel_url: "...", order_id?: "abc123", metadata?: {...} }
// Env required: STRIPE_SECRET_KEY

const Stripe = require('stripe');
const crypto = require('crypto');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
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

  // Validate minimal inputs
  if (!Array.isArray(body.line_items) || body.line_items.length === 0) {
    return res.status(400).json({ error: 'line_items is required (array with at least one item)' });
  }
  if (!body.success_url || !body.cancel_url) {
    return res.status(400).json({ error: 'success_url and cancel_url are required' });
  }

  // Ensure every session has a durable order_id
  const orderId = body.order_id || crypto.randomUUID();

  const metadata = Object.assign({}, body.metadata || {}, { order_id: orderId });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: body.line_items,
      success_url: body.success_url,
      cancel_url: body.cancel_url,
      metadata,

      // Nice-to-have defaults (safe in test & live)
      allow_promotion_codes: true,
      submit_type: 'pay'
    });

    return res.status(200).json({
      id: session.id,
      url: session.url,
      order_id: orderId
    });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    return res.status(400).json({ error: err.message });
  }
};

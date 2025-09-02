// Stripe webhook for Vercel (Node 18/20, CommonJS)
const Stripe = require('stripe');

// REQUIRED: set this in Vercel → Settings → Environment Variables
// (you already added STRIPE_WEBHOOK_SECRET — good)
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  // Simple GET to prove the route works
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, route: '/api/stripe' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Read raw body for signature verification
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    console.error('Failed to read raw body:', err);
    return res.status(400).send(`Bad request: ${err.message}`);
  }

  const sig = req.headers['stripe-signature'];
  if (!sig || !WEBHOOK_SECRET) {
    return res.status(400).send('Missing stripe-signature or STRIPE_WEBHOOK_SECRET');
  }

  let event;
  try {
    // Verify signature using Stripe library (no Stripe secret key needed)
    event = Stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('✅ Webhook event:', event.type);

  // TODO: In the next step we’ll handle specific event types (update order, inventory, email)
  return res.status(200).json({ received: true, type: event.type });
};

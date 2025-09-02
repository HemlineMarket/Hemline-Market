// Serverless Stripe webhook for Vercel (Node.js runtime)
// IMPORTANT: set STRIPE_WEBHOOK_SECRET (test or live) in Vercel Project → Settings → Environment Variables.
// Optional: STRIPE_SECRET_KEY if you plan to call Stripe API inside the handler.

const Stripe = require('stripe');

// Lazy init; ok if you only need webhook verification.
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  // Simple GET ping helps confirm the route isn't 404ing
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, route: '/api/stripe' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!WEBHOOK_SECRET) {
    // Don’t 500 just because env isn’t set; return a clear 500 with message
    return res.status(500).json({ error: 'Missing STRIPE_WEBHOOK_SECRET on server' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    console.error('Failed to read raw body:', e);
    return res.status(400).send(`Bad request: ${e.message}`);
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    return res.status(400).send('Missing stripe-signature header');
  }

  let event;
  try {
    // Construct and verify the event using the raw body
    const stripeLib = require('stripe'); // ensure available even if no secret key
    event = stripeLib.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Log minimally so you can see it in Vercel logs
  console.log('✅ Stripe webhook received:', event.type);

  // TODO: In Step 3 we'll wire business logic here (orders, inventory, email)
  // For now, immediately acknowledge.
  return res.status(200).json({ received: true, type: event.type });
};

const Stripe = require('stripe');

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, route: '/api/stripe' });
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, GET');
    res.status(405).end('Method Not Allowed');
    return;
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    res.status(400).end(`Error reading body: ${err.message}`);
    return;
  }

  const sig = req.headers['stripe-signature'];
  if (!sig || !WEBHOOK_SECRET) {
    res.status(400).end('Missing stripe-signature or STRIPE_WEBHOOK_SECRET');
    return;
  }

  let event;
  try {
    event = Stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Signature verification failed:', err.message);
    res.status(400).end(`Webhook Error: ${err.message}`);
    return;
  }

  console.log('✅ Webhook event received:', event.type);

  // TEMP: Just acknowledge receipt
  res.status(200).end(`Received ${event.type}`);
};

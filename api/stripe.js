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
    return res.status(200).json({ ok: true, route: '/api/stripe', method: 'GET' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    return res.status(400).send(`Error reading body: ${err.message}`);
  }

  const sig = req.headers['stripe-signature'];
  if (!sig || !WEBHOOK_SECRET) {
    return res.status(400).send('Missing stripe-signature or webhook secret');
  }

  let event;
  try {
    event = Stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('✅ Received event:', event.type);

  // Temporary: just acknowledge
  res.json({ received: true, type: event.type });
};

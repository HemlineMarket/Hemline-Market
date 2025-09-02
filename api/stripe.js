// /api/stripe.js  (at the REPO ROOT)
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// read raw body so the signature check is correct
async function readBuffer(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  let event;
  try {
    const buf = await readBuffer(req);
    const signature = req.headers['stripe-signature'];

    event = stripe.webhooks.constructEvent(
      buf,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET // whsec_...
    );
  } catch (err) {
    console.error('⚠️  Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Minimal handler – just acknowledge
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('✅ checkout.session.completed', session.id);
  } else {
    console.log('ℹ️ event:', event.type);
  }

  return res.status(200).json({ received: true });
};

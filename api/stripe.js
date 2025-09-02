// /api/stripe.js
// Prereqs in Vercel env: STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const stripe = new Stripe(STRIPE_SECRET_KEY);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
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

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const orderId = session?.metadata?.order_id; // you must set this when creating the Checkout Session
        if (!orderId) {
          console.warn('checkout.session.completed without metadata.order_id');
          break;
        }

        // Mark order as paid
        const { error } = await supabase
          .from('orders')
          .update({ status: 'paid', stripe_session_id: session.id })
          .eq('id', orderId);

        if (error) {
          console.error('Supabase update error:', error);
          // Return 200 so Stripe doesn’t keep retrying forever; we’ll observe logs and fix
          break;
        }

        console.log(`✅ Order ${orderId} marked paid`);
        break;
      }

      default:
        // no-op for other events (we can add more later)
        break;
    }

    res.status(200).end(`Received ${event.type}`);
  } catch (err) {
    console.error('Webhook handler error:', err);
    // 200 is safer for webhooks (prevents endless retries if our bug is on our side)
    res.status(200).end('Handled with warnings');
  }
};

// Create a Stripe refund for an order (full or partial).
// ENV: ADMIN_API_KEY, STRIPE_SECRET_KEY

import Stripe from 'stripe';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

function auth(req, res) {
  const key = process.env.ADMIN_API_KEY || '';
  const got = (req.headers['x-admin-key'] || '').toString();
  if (!key || got !== key) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-07-30.basil',
});

async function findSession(order_id) {
  try { return await stripe.checkout.sessions.retrieve(order_id, { expand: ['payment_intent','total_details'] }); }
  catch {}
  const list = await stripe.checkout.sessions.list({ limit: 100, expand: ['data.payment_intent'] });
  return (list.data || []).find(s => (s.metadata?.order_id || '').toLowerCase() === order_id.toLowerCase()) || null;
}

export default async function handler(req, res) {
  if (!auth(req, res)) return;

  try {
    const { order_id, amount_cents } = req.body || {};
    if (!order_id) return res.status(400).json({ error: 'order_id required' });

    const sess = await findSession(order_id);
    if (!sess) return res.status(404).json({ error: 'Order not found' });

    const piId = typeof sess.payment_intent === 'string' ? sess.payment_intent : (sess.payment_intent?.id || '');
    if (!piId) return res.status(400).json({ error: 'No payment_intent on order' });

    const refund = await stripe.refunds.create({
      payment_intent: piId,
      amount: Number.isFinite(Number(amount_cents)) ? Number(amount_cents) : undefined, // undefined => full refund
      reason: 'requested_by_customer',
      metadata: { hm_refund: 'admin' },
    });

    res.status(200).json({ ok: true, refund });
  } catch (err) {
    console.error('refund error:', err);
    res.status(500).json({ error: 'Refund failed' });
  }
}

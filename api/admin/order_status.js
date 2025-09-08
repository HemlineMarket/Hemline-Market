// Looks up a single order for Admin view using Stripe Checkout/PI.
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

function usd(cents = 0) { return Number(cents || 0); }

export default async function handler(req, res) {
  if (!auth(req, res)) return;

  try {
    const { order_id } = req.body || {};
    if (!order_id) return res.status(400).json({ error: 'order_id required' });

    // Try direct session lookup first.
    let session = null;
    try {
      session = await stripe.checkout.sessions.retrieve(order_id, {
        expand: ['total_details', 'payment_intent'],
      });
    } catch { /* ignore */ }

    // If not a session id, search the last 100 sessions by metadata.order_id
    if (!session) {
      const list = await stripe.checkout.sessions.list({ limit: 100, expand: ['data.payment_intent'] });
      session = (list.data || []).find(s => (s.metadata?.order_id || '').toLowerCase() === order_id.toLowerCase()) || null;
      if (session && !session.total_details) {
        // fetch expanded copy for accuracy
        session = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['total_details', 'payment_intent'],
        });
      }
    }

    if (!session) return res.status(404).json({ error: 'Not found' });

    // Minimal item echo (if you set items in metadata when creating the session)
    let items = [];
    try {
      items = JSON.parse(session.metadata?.items_json || '[]');
      if (!Array.isArray(items)) items = [];
    } catch { items = []; }

    const out = {
      order_id: session.metadata?.order_id || session.id,
      status: session.payment_status?.toUpperCase() === 'PAID' ? 'PAID' : session.payment_status?.toUpperCase() || 'OPEN',
      buyer_name: session.customer_details?.name || '',
      buyer_email: session.customer_details?.email || session.customer_email || '',
      subtotal_cents: usd(session.amount_subtotal),
      shipping_cents: usd(session.total_details?.amount_shipping || 0),
      total_cents: usd(session.amount_total),
      payment_intent: typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id || ''),
      created_at: new Date(session.created * 1000).toISOString(),
      items,
      raw_session_id: session.id,
    };

    res.status(200).json(out);
  } catch (err) {
    console.error('order_status error:', err);
    res.status(500).json({ error: 'Lookup failed' });
  }
}

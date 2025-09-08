// Lists recent Stripe Checkout Sessions for the admin dashboard.
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
    const q = (req.query.q || '').toString().trim().toLowerCase();

    // Pull latest 50 sessions; filter in-memory for a simple, launch-ready tool.
    const list = await stripe.checkout.sessions.list({
      limit: 50,
      expand: ['data.total_details', 'data.payment_intent'],
    });

    const orders = (list.data || [])
      .map(s => ({
        created: s.created,                                // unix seconds
        order_id: s.metadata?.order_id || s.id,           // prefer your order id if you set it
        email: s.customer_details?.email || s.customer_email || '',
        total_cents: usd(s.amount_total),
        status: s.payment_status?.toUpperCase() === 'PAID' ? 'PAID' : s.payment_status?.toUpperCase() || 'OPEN',
        payment_intent: typeof s.payment_intent === 'string'
          ? s.payment_intent
          : (s.payment_intent?.id || ''),
        session_id: s.id,
      }))
      .filter(o => {
        if (!q) return true;
        return (
          o.order_id?.toLowerCase().includes(q) ||
          o.email?.toLowerCase().includes(q) ||
          o.payment_intent?.toLowerCase().includes(q)
        );
      })
      .sort((a,b) => b.created - a.created);

    res.status(200).json({ orders });
  } catch (err) {
    console.error('orders_list error:', err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
}

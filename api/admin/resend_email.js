// Resend transactional emails by rebuilding from Stripe session data,
// then forwarding to our /api/email/send endpoint.
// ENV: ADMIN_API_KEY, STRIPE_SECRET_KEY, (POSTMARK_SERVER_TOKEN used by /api/email/send)

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
  apiVersion: '2024-06-20',
});

async function findSession(order_id) {
  try { return await stripe.checkout.sessions.retrieve(order_id, { expand: ['total_details','payment_intent'] }); }
  catch {}
  const list = await stripe.checkout.sessions.list({ limit: 100, expand: ['data.payment_intent'] });
  const found = (list.data || []).find(s => (s.metadata?.order_id || '').toLowerCase() === order_id.toLowerCase());
  return found ? await stripe.checkout.sessions.retrieve(found.id, { expand: ['total_details','payment_intent'] }) : null;
}

function asItems(sess) {
  try {
    const j = JSON.parse(sess.metadata?.items_json || '[]');
    if (Array.isArray(j) && j.length) return j;
  } catch {}
  // Fallback: single line for whole order
  return [{ name: 'Fabric order', qty: 1, amount: Number(sess.amount_total || 0) }];
}

export default async function handler(req, res) {
  if (!auth(req, res)) return;

  try {
    const { order_id, type } = req.body || {};
    if (!order_id || !type) return res.status(400).json({ error: 'order_id and type required' });

    const sess = await findSession(order_id);
    if (!sess) return res.status(404).json({ error: 'Order not found' });

    const to = sess.customer_details?.email || sess.customer_email;
    if (!to) return res.status(400).json({ error: 'No customer email on order' });

    const payload = {
      to,
      type: type, // e.g. 'order_confirmation'
      data: {
        order_id: sess.metadata?.order_id || sess.id,
        order_date: new Date(sess.created * 1000).toLocaleDateString(),
        items: asItems(sess),
        subtotal_cents: Number(sess.amount_subtotal || 0),
        shipping_cents: Number(sess.total_details?.amount_shipping || 0),
        site_origin: `${(req.headers['x-forwarded-proto'] || 'https')}://${(req.headers['x-forwarded-host'] || req.headers.host)}`
      }
    };

    const resp = await fetch(`${payload.data.site_origin}/api/email/send`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error('resend_email provider error:', t);
      return res.status(502).json({ error: 'Email send failed' });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('resend_email error:', err);
    res.status(500).json({ error: 'Failed to resend email' });
  }
}

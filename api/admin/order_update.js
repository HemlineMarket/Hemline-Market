// Update an order's status by writing to Stripe metadata.
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
  apiVersion: '2024-06-20',
});

function asCents(n) { return Number(n || 0); }

async function findSession(order_id) {
  // Try direct session id first
  try { return await stripe.checkout.sessions.retrieve(order_id, { expand: ['payment_intent','total_details'] }); }
  catch {}
  // Otherwise search recent sessions by metadata.order_id
  const list = await stripe.checkout.sessions.list({ limit: 100, expand: ['data.payment_intent'] });
  return (list.data || []).find(s => (s.metadata?.order_id || '').toLowerCase() === order_id.toLowerCase()) || null;
}

export default async function handler(req, res) {
  if (!auth(req, res)) return;

  try {
    const { order_id, status } = req.body || {};
    if (!order_id || !status) return res.status(400).json({ error: 'order_id and status required' });

    const sess = await findSession(order_id);
    if (!sess) return res.status(404).json({ error: 'Order not found' });

    // Save status + history onto the PaymentIntent metadata (preferred) and session metadata (also).
    const piId = typeof sess.payment_intent === 'string' ? sess.payment_intent : (sess.payment_intent?.id || null);
    const ts = new Date().toISOString();

    if (piId) {
      await stripe.paymentIntents.update(piId, {
        metadata: {
          ...(sess.payment_intent?.metadata || {}),
          hm_status: status,
          hm_status_updated_at: ts,
        },
      });
    }

    await stripe.checkout.sessions.update(sess.id, {
      metadata: {
        ...(sess.metadata || {}),
        hm_status: status,
        hm_status_updated_at: ts,
      },
    });

    // Return order view
    const out = {
      order_id: sess.metadata?.order_id || sess.id,
      status,
      buyer_name: sess.customer_details?.name || '',
      buyer_email: sess.customer_details?.email || sess.customer_email || '',
      subtotal_cents: asCents(sess.amount_subtotal),
      shipping_cents: asCents(sess.total_details?.amount_shipping || 0),
      total_cents: asCents(sess.amount_total),
      payment_intent: piId || '',
      created_at: new Date(sess.created * 1000).toISOString(),
      items: (() => {
        try { const x = JSON.parse(sess.metadata?.items_json || '[]'); return Array.isArray(x) ? x : []; } catch { return []; }
      })(),
      raw_session_id: sess.id,
    };

    res.status(200).json(out);
  } catch (err) {
    console.error('order_update error:', err);
    res.status(500).json({ error: 'Update failed' });
  }
}

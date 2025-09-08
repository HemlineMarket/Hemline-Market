// api/admin/order_status.js
// Admin: lookup an order by Stripe object id (pi_... or cs_...).
// Auth: requires header `x-admin-key` to equal process.env.ADMIN_ACCESS_KEY
// ENV: ADMIN_ACCESS_KEY, STRIPE_SECRET_KEY

import Stripe from 'stripe';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-07-30.basil', // keep consistent with your other Stripe files
});

function requireKey(req, res) {
  const want = process.env.ADMIN_ACCESS_KEY || '';
  if (!want) {
    res.status(500).json({ error: 'ADMIN_ACCESS_KEY missing' });
    return false;
  }
  const got = (req.headers['x-admin-key'] || '').toString();
  if (got !== want) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function fmtUSD(cents = 0) {
  const v = Math.max(0, Number(cents || 0)) / 100;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
    if (!requireKey(req, res)) return;

    const { order_id } = req.body || {};
    const id = (order_id || '').trim();

    if (!id) return res.status(400).json({ error: 'Missing order_id' });

    let session = null;
    let pi = null;

    if (id.startsWith('cs_')) {
      // Checkout Session lookup
      session = await stripe.checkout.sessions.retrieve(id, {
        expand: ['payment_intent'],
      });
      pi = session.payment_intent && typeof session.payment_intent === 'object'
        ? session.payment_intent
        : (session.payment_intent ? await stripe.paymentIntents.retrieve(session.payment_intent) : null);
    } else if (id.startsWith('pi_')) {
      // PaymentIntent lookup
      pi = await stripe.paymentIntents.retrieve(id);
      // Try to find its session (best-effort; not guaranteed)
      const list = await stripe.checkout.sessions.list({ payment_intent: pi.id, limit: 1 });
      session = list.data?.[0] || null;
    } else {
      // Until we persist our own HM-xxxxx ids, require a Stripe id.
      return res.status(404).json({ error: 'Use a Stripe id (pi_… or cs_…) for now' });
    }

    if (!pi && !session) return res.status(404).json({ error: 'Not found' });

    // Derive amounts
    const subtotal_cents = Number(session?.metadata?.subtotal_cents || 0);
    const shipping_cents = Number(session?.metadata?.shipping_cents || 0);
    const total_cents    = Number(session?.amount_total ?? pi?.amount ?? (subtotal_cents + shipping_cents) ?? 0);

    // Items (if you later store them in metadata, we’ll show them)
    let items = [];
    try {
      if (session?.metadata?.items_json) {
        items = JSON.parse(session.metadata.items_json);
      }
    } catch {}

    // Buyer hints
    const buyer_email = session?.customer_details?.email || session?.customer_email || pi?.receipt_email || null;
    const buyer_name  = session?.customer_details?.name || null;

    // Status mapping
    let status = 'PAID';
    if (pi?.status === 'requires_payment_method' || pi?.status === 'requires_confirmation') status = 'PENDING';
    if (pi?.status === 'canceled') status = 'CANCELED';
    if (pi?.status === 'processing') status = 'PROCESSING';
    if (pi?.status === 'succeeded') status = 'PAID';

    const payload = {
      // identifiers
      order_id: session?.id || pi?.id || id,
      checkout_session: session?.id || null,
      payment_intent: pi?.id || null,

      // money
      subtotal_cents,
      shipping_cents,
      total_cents,

      // buyer
      buyer_email,
      buyer_name,

      // status (high-level)
      status,
      created_at: session?.created ? new Date(session.created * 1000).toISOString() :
                  pi?.created ? new Date(pi.created * 1000).toISOString() : null,

      // extras
      items,
      currency: (pi?.currency || session?.currency || 'usd').toUpperCase(),
      display_total: fmtUSD(total_cents),
    };

    return res.status(200).json(payload);
  } catch (err) {
    console.error('admin/order_status error:', err);
    return res.status(500).json({ error: 'Lookup failed' });
  }
}

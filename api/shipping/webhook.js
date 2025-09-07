// /api/shipping/webhook.js
// Receives Shippo webhooks and saves label transaction IDs into Supabase.
// ENV needed: SHIPPO_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } }
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Optional simple verification using a shared secret in the URL
  const REQUIRED_SECRET = process.env.SHIPPO_WEBHOOK_SECRET || '';
  if (REQUIRED_SECRET) {
    const supplied = (req.query.secret || '').toString();
    if (supplied !== REQUIRED_SECRET) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }
  }

  try {
    const event = req.body || {};
    const type = event.event || event.type || 'unknown';
    const data = event.data || {};
    const tracking = data.tracking_number || data.tracking?.tracking_number;
    const txId = data.object_id || null;

    // Always respond first so Shippo doesn’t retry
    res.status(200).json({ ok: true });

    // ---- Background work ----
    console.log('[Shippo webhook]', { type, txId, tracking });

    // Save label transaction ID when created
    if (type === 'transaction_created' && txId) {
      const orderId = data.metadata?.order_id; // attach order_id in create step
      if (orderId) {
        const { error } = await supabase
          .from('orders')
          .update({ shippo_tx: txId })
          .eq('id', orderId);
        if (error) console.error('Failed to save Shippo tx → Supabase', error);
        else console.log('✅ Shippo tx saved to order', orderId);
      }
    }
  } catch (err) {
    console.error('Shippo webhook error:', err);
    // We already returned 200, so just log
  }
}

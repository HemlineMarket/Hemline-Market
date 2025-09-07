// /api/shipping/label.js
// Fetches a shipping label PDF URL from Shippo using saved transaction id.
// ENV needed: SHIPPO_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { orderId } = req.query;
  if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

  try {
    // Look up transaction id from Supabase
    const { data, error } = await supabase
      .from('orders')
      .select('shippo_tx')
      .eq('id', orderId)
      .single();

    if (error || !data?.shippo_tx) {
      return res.status(404).json({ error: 'No label for this order' });
    }

    const txId = data.shippo_tx;

    // Fetch label from Shippo
    const resp = await fetch(`https://api.goshippo.com/transactions/${txId}`, {
      headers: { Authorization: `ShippoToken ${process.env.SHIPPO_TOKEN}` }
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Shippo error: ${txt}`);
    }

    const tx = await resp.json();
    if (!tx?.label_url) {
      return res.status(404).json({ error: 'Label not ready yet' });
    }

    // Redirect browser straight to the PDF
    res.writeHead(302, { Location: tx.label_url });
    res.end();
  } catch (err) {
    console.error('label.js error', err);
    res.status(500).json({ error: 'Unable to fetch label' });
  }
}

// /api/shipping/label.js
// Returns a shipping label PDF for a given order.
// Requires: SHIPPO_LIVE_KEY in Vercel env.

import fetch from 'node-fetch';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const orderId = req.query.order;
    if (!orderId) {
      return res.status(400).json({ error: 'Missing order id' });
    }

    // TODO: Replace this lookup with your DB query
    // Example: find the Shippo transaction id stored for this order
    // For now, hard-coded for demo
    const shippoTransactionId = "e3a0f21f0b0e4d01b4d41c12a3d12345";

    const resp = await fetch(`https://api.goshippo.com/transactions/${shippoTransactionId}/`, {
      headers: {
        "Authorization": `ShippoToken ${process.env.SHIPPO_LIVE_KEY}`
      }
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("Shippo transaction fetch error", text);
      return res.status(502).json({ error: 'Shippo lookup failed' });
    }

    const tx = await resp.json();
    if (!tx.label_url) {
      return res.status(404).json({ error: 'Label not ready' });
    }

    // Fetch the PDF itself
    const pdfResp = await fetch(tx.label_url);
    if (!pdfResp.ok) throw new Error('Unable to fetch PDF');
    const buf = Buffer.from(await pdfResp.arrayBuffer());

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${orderId}-label.pdf"`);
    return res.send(buf);

  } catch (err) {
    console.error("Label download error:", err);
    return res.status(500).json({ error: 'Unable to download label' });
  }
}

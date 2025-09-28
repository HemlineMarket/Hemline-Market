// /api/shippo/webhook.js
import fetch from 'node-fetch';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const event = req.body;
    console.log('[shippo] webhook received:', event);

    const { event: eventType, data } = event;

    if (!data || !data.tracking_number) {
      return res.status(200).json({ received: true });
    }

    // Build payload for our shipping update email API
    const payload = {
      to: data?.address_to?.email || '',        // Shippo sometimes includes recipient email
      orderId: data?.order || 'Unknown',
      trackingNumber: data.tracking_number,
      status: eventType.replace('track.', ''),  // e.g. "track.updated"
    };

    // Call our shipping update API
    await fetch(`${process.env.SITE_URL}/api/send-shipping-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Error handling Shippo webhook:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

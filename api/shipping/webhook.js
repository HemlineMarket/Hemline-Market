// /api/shipping/webhook.js
// Receives Shippo webhooks (e.g., "track_updated").
// Respond 200 ASAP so Shippo doesn't retry. Validate optional secret.

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Optional simple verification using a shared secret in the URL:
  // Set SHIPPO_WEBHOOK_SECRET in Vercel, then configure your webhook URL as:
  // https://<your-domain>/api/shipping/webhook?secret=YOUR_SECRET
  const REQUIRED_SECRET = process.env.SHIPPO_WEBHOOK_SECRET || '';
  if (REQUIRED_SECRET) {
    const supplied = (req.query.secret || '').toString();
    if (supplied !== REQUIRED_SECRET) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }
  }

  try {
    const event = req.body || {};
    // Typical Shippo payload fields
    // - event: "track_updated" | "transaction_created" | ...
    // - data:  { tracking_number, tracking_status, tracking_history, ... }
    // See: https://goshippo.com/docs/webhooks/

    // Always acknowledge first
    res.status(200).json({ ok: true });

    // ---- Do your background processing below (non-blocking) ----
    // (Vercel still runs this code, but Shippo already got 200.)

    const type = event.event || event.type || 'unknown';
    const data = event.data || {};
    const tracking = data.tracking_number || data.tracking?.tracking_number;
    const status =
      data.tracking_status?.status ||
      data.tracking_status ||
      data.status ||
      null;

    // TODO: link this update to your order by tracking number or transaction id
    // and persist it (e.g., Supabase). For now we just log safely.
    console.log('[Shippo webhook]', {
      type,
      tracking,
      status,
      dataBrief: {
        carrier: data.carrier || data.tracking_provider || null,
        eta: data.eta || null,
        object_id: data.object_id || null,
      },
    });

    // Example placeholder: send a notification email on delivered, etc.
    // if (status === 'DELIVERED') { await notifyBuyer(...); }

  } catch (err) {
    // We already returned 200 above. Log for diagnostics.
    console.error('Shippo webhook error:', err);
  }
}

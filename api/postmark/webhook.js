// /pages/api/postmark/webhook.js
//
// Secures Postmark inbound webhook with POSTMARK_WEBHOOK_SECRET.
// ENV required: POSTMARK_WEBHOOK_SECRET
//
// Postmark calls this for events like "bounce", "delivery", "open".
// For now we just log them safely.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { secret } = req.query;
  const expected = process.env.POSTMARK_WEBHOOK_SECRET;
  if (!expected) {
    return res.status(500).json({ error: 'Missing POSTMARK_WEBHOOK_SECRET' });
  }
  if (secret !== expected) {
    return res.status(403).json({ error: 'Forbidden: invalid secret' });
  }

  try {
    const event = req.body;
    console.log('[postmark] event received:', event);

    // TODO: persist or act on events (bounce, delivery, spam complaint, etc.)

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Postmark webhook handler error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}

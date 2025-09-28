// /api/postmark/webhook.js
// Handles Postmark webhooks for delivery, bounce, spam complaints, opens, and clicks.
// Secured with POSTMARK_WEBHOOK_KEY (your custom secret token in query string).

export const config = {
  api: {
    bodyParser: true, // Postmark sends JSON payloads
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Verify secret token
  const token = req.query.token;
  if (!token || token !== process.env.POSTMARK_WEBHOOK_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const event = req.body;
    const { RecordType } = event;

    switch (RecordType) {
      case 'Delivery':
        console.log('[postmark] Delivery event:', {
          messageId: event.MessageID,
          recipient: event.Recipient,
          deliveredAt: event.DeliveredAt,
        });
        break;

      case 'Bounce':
        console.log('[postmark] Bounce event:', {
          type: event.Type,
          recipient: event.Email,
          details: event.Details,
        });
        break;

      case 'SpamComplaint':
        console.log('[postmark] Spam complaint:', {
          recipient: event.Email,
          details: event.Details,
        });
        break;

      case 'Open':
        console.log('[postmark] Open event:', {
          recipient: event.Recipient,
          receivedAt: event.ReceivedAt,
        });
        break;

      case 'Click':
        console.log('[postmark] Link click:', {
          recipient: event.Recipient,
          url: event.OriginalLink,
        });
        break;

      default:
        console.log('[postmark] Unhandled event type:', RecordType, event);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[postmark] webhook error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// /api/send-shipping-update.js
import Postmark from 'postmark';

const client = new Postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { to, orderId, trackingNumber, status } = req.body;

    if (!to || !orderId || !trackingNumber || !status) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Choose subject line based on shipping status
    let subject;
    switch (status) {
      case 'label_purchased':
        subject = `Your order ${orderId} shipping label has been created`;
        break;
      case 'in_transit':
        subject = `Your order ${orderId} is on the way`;
        break;
      case 'delivered':
        subject = `Your order ${orderId} has been delivered`;
        break;
      default:
        subject = `Update on your order ${orderId}`;
    }

    // Send via Postmark
    await client.sendEmail({
      From: process.env.FROM_EMAIL,
      To: to,
      Subject: subject,
      TextBody: `Order ${orderId} update: ${status}\nTracking number: ${trackingNumber}`,
      HtmlBody: `<h2>Order ${orderId} update: ${status}</h2><p>Your tracking number is <strong>${trackingNumber}</strong>.</p>`,
      MessageStream: 'outbound',
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error sending shipping update email:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

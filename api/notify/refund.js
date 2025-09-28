// File: /api/notify/refund.js
// Sends refund notification emails via Postmark

import Postmark from "postmark";

const client = new Postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { orderId, amount, to_buyer } = req.body || {};

    if (!orderId || !amount || !to_buyer) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const subject = `Order ${orderId} — Refund Issued`;

    const htmlBody = `
      <h2>Refund Issued for Order ${orderId}</h2>
      <p>Amount refunded: <strong>$${(amount / 100).toFixed(2)}</strong></p>
      <p>The refund has been processed back to your original payment method.</p>
    `;

    const textBody = `
Refund Issued for Order ${orderId}
Amount refunded: $${(amount / 100).toFixed(2)}
The refund has been processed back to your original payment method.
`;

    await client.sendEmail({
      From: process.env.FROM_EMAIL,
      To: to_buyer,
      Subject: subject,
      HtmlBody: htmlBody,
      TextBody: textBody,
      MessageStream: "outbound",
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("notify/refund error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

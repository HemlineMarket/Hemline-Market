// File: /api/notify/support.js
// Sends support/contact form messages to your support inbox via Postmark

import Postmark from "postmark";

const client = new Postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { from_email, from_name, message } = req.body || {};

    if (!from_email || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const subject = `New support request from ${from_name || from_email}`;

    const htmlBody = `
      <h2>New Support Request</h2>
      <p><strong>From:</strong> ${from_name || "—"} (${from_email})</p>
      <p><strong>Message:</strong></p>
      <p>${message}</p>
    `;

    const textBody = `
New Support Request
From: ${from_name || "—"} (${from_email})
Message:
${message}
`;

    // Send to your support inbox (set FROM_EMAIL to support@hemlinemarket.com)
    await client.sendEmail({
      From: process.env.FROM_EMAIL,
      To: process.env.SUPPORT_EMAIL || process.env.FROM_EMAIL,
      Subject: subject,
      HtmlBody: htmlBody,
      TextBody: textBody,
      MessageStream: "outbound",
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("notify/support error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

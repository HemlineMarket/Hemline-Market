// FILE: api/notify/support.js
// FIX: Added HTML escaping to prevent XSS (BUG #11)
// Sends support/contact form messages to your support inbox via Postmark
//
// NOTE: This endpoint stays public (no auth) because contact forms need to work
// for non-logged-in users. The fix is HTML escaping user input.

import Postmark from "postmark";

const client = new Postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);

// FIX: HTML escape function to prevent XSS/injection
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

    // FIX: Escape all user input to prevent XSS
    const safeEmail = escapeHtml(from_email);
    const safeName = escapeHtml(from_name);
    const safeMessage = escapeHtml(message);

    const subject = `New support request from ${safeName || safeEmail}`;

    const htmlBody = `
      <h2>New Support Request</h2>
      <p><strong>From:</strong> ${safeName || "—"} (${safeEmail})</p>
      <p><strong>Message:</strong></p>
      <p>${safeMessage}</p>
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

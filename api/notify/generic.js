// File: /api/notify/generic.js
// Generic Postmark sender for any custom notification

import Postmark from "postmark";

const client = new Postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { to, subject, htmlBody, textBody } = req.body || {};

    if (!to || !subject || (!htmlBody && !textBody)) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    await client.sendEmail({
      From: process.env.FROM_EMAIL,
      To: to,
      Subject: subject,
      HtmlBody: htmlBody || undefined,
      TextBody: textBody || undefined,
      MessageStream: "outbound",
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("notify/generic error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

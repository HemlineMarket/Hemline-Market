// File: /api/notify/test.js
// Simple test endpoint to verify Postmark setup

import Postmark from "postmark";

const client = new Postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { to } = req.body || {};

    if (!to) {
      return res.status(400).json({ error: "Missing 'to' email address" });
    }

    await client.sendEmail({
      From: process.env.FROM_EMAIL,
      To: to,
      Subject: "Hemline Market Test Email",
      HtmlBody: "<h2>This is a test email from Hemline Market</h2><p>Success!</p>",
      TextBody: "This is a test email from Hemline Market — Success!",
      MessageStream: "outbound",
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("notify/test error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

// File: /api/notify/account.js
// Sends account-related notifications (like verification, onboarding) via Postmark

import Postmark from "postmark";

const client = new Postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { to, type } = req.body || {};

    if (!to || !type) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    let subject = "Hemline Market Account Update";
    let htmlBody = "";
    let textBody = "";

    if (type === "verify") {
      subject = "Verify your Hemline Market account";
      htmlBody = `
        <h2>Welcome to Hemline Market!</h2>
        <p>Please verify your email address to activate your account.</p>
      `;
      textBody = `Welcome to Hemline Market!\nPlease verify your email address to activate your account.`;
    }

    if (type === "onboard") {
      subject = "Complete your Hemline Market seller setup";
      htmlBody = `
        <h2>Seller Onboarding</h2>
        <p>Please finish connecting your account to Stripe in order to receive payouts.</p>
      `;
      textBody = `Seller Onboarding\nPlease finish connecting your account to Stripe in order to receive payouts.`;
    }

    await client.sendEmail({
      From: process.env.FROM_EMAIL,
      To: to,
      Subject: subject,
      HtmlBody: htmlBody,
      TextBody: textBody,
      MessageStream: "outbound",
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("notify/account error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

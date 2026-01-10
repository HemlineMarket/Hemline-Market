// File: /api/notify/account.js
// FIX: Added JWT/internal secret authentication
// Sends account-related notifications (like verification, onboarding) via Postmark

import Postmark from "postmark";
import { createClient } from "@supabase/supabase-js";

const client = new Postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

async function verifyAuth(req) {
  // Allow internal server-to-server calls
  const internalSecret = req.headers["x-internal-secret"];
  if (internalSecret && internalSecret === process.env.INTERNAL_API_SECRET) {
    return { internal: true };
  }

  // Verify JWT token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  const supabase = getSupabaseAdmin();

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return null;
  }

  return user;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // FIX: Require authentication
    const user = await verifyAuth(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { to, type } = req.body || {};

    if (!to || !type) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // FIX: Users can only send account emails to themselves (unless internal call)
    if (!user.internal && user.email !== to) {
      return res.status(403).json({ error: "Cannot send emails to other users" });
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

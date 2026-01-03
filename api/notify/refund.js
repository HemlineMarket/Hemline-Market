// FILE: api/notify/refund.js
// FIX: Added JWT authentication (BUG #9)
// Sends refund notification emails via Postmark
//
// CHANGE: Now requires valid JWT token OR internal secret

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

// FILE: api/notify/generic.js
// FIX: Added JWT authentication to prevent open email relay (BUG #10)
//
// CHANGE: Now requires valid JWT token in Authorization header
// Internal server calls can use x-internal-secret header instead

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

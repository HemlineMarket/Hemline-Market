// FILE: api/notify/index.js
// FIX: Added JWT authentication (BUG #21)
// Generic server-side notification creator.
// All Hemline Market systems call THIS to insert notifications safely.
//
// CHANGE: Now requires valid JWT token OR internal secret
// Users can only create notifications for themselves
//
// Works with RLS because we use the service-role key.
// Requires env:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - INTERNAL_API_SECRET (for server-to-server calls)

import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
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

    const {
      user_id,
      kind = "notice",
      title = "",
      body = "",
      href = "",
      link = "",
    } = req.body || {};

    if (!user_id || typeof user_id !== "string") {
      return res.status(400).json({ error: "Missing user_id" });
    }

    // FIX: Users can only create notifications for themselves (unless internal call)
    if (!user.internal && user.id !== user_id) {
      return res.status(403).json({ error: "Cannot create notifications for other users" });
    }

    // Validate basic fields
    if (typeof title !== "string" || typeof body !== "string") {
      return res.status(400).json({ error: "Invalid title/body" });
    }

    // Create service-role supabase client
    const supabase = getSupabaseAdmin();

    // Insert notification
    const { data, error } = await supabase
      .from("notifications")
      .insert([
        {
          user_id,
          kind,
          type: kind, // support older 'type' column
          title,
          body,
          href: href || link,
          link: href || link,
          is_read: false,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("[notify] insert error:", error);
      return res.status(500).json({ error: "insert_failed", detail: error.message });
    }

    return res.status(200).json({ success: true, notification: data });
  } catch (err) {
    console.error("[notify] handler error:", err);
    return res.status(500).json({ error: "server_error", detail: err.message });
  }
}

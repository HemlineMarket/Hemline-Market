// File: /api/notify.js
// Generic server-side notification creator.
// All Hemline Market systems call THIS to insert notifications safely.
//
// Works with RLS because we use the service-role key.
// Requires env:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
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

    // Validate basic fields
    if (typeof title !== "string" || typeof body !== "string") {
      return res.status(400).json({ error: "Invalid title/body" });
    }

    // Create service-role supabase client
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { autoRefreshToken: false, persistSession: false },
      }
    );

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

// File: /api/saved-searches/toggle-alerts.js
// Toggle email alerts for a saved search
// POST { id, enabled }
// Headers: Authorization: Bearer <token>

import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = getSupabaseAdmin();

  // Verify auth
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  
  if (authError || !user) {
    return res.status(401).json({ error: "Invalid token" });
  }

  try {
    const { id, enabled } = req.body || {};

    if (!id) {
      return res.status(400).json({ error: "id required" });
    }

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled (boolean) required" });
    }

    // Update only if owned by this user
    const { data, error } = await supabase
      .from("saved_searches")
      .update({ email_alerts: enabled })
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) {
      console.error("[saved-searches/toggle-alerts] Error:", error);
      return res.status(500).json({ error: "Failed to update saved search" });
    }

    return res.status(200).json({ success: true, savedSearch: data });

  } catch (e) {
    console.error("[saved-searches/toggle-alerts] Error:", e);
    return res.status(500).json({ error: e.message });
  }
}

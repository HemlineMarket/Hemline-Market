// File: /api/saved-searches/delete.js
// Delete a saved search
// DELETE { id }
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
  if (req.method !== "DELETE") {
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
    const { id } = req.body || {};

    if (!id) {
      return res.status(400).json({ error: "id required" });
    }

    // Delete only if owned by this user
    const { error } = await supabase
      .from("saved_searches")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      console.error("[saved-searches/delete] Error:", error);
      return res.status(500).json({ error: "Failed to delete saved search" });
    }

    return res.status(200).json({ success: true });

  } catch (e) {
    console.error("[saved-searches/delete] Error:", e);
    return res.status(500).json({ error: e.message });
  }
}

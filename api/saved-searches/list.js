// File: /api/saved-searches/list.js
// Get all saved searches for the authenticated user
// GET - Returns array of saved searches
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
  if (req.method !== "GET") {
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
    const { data: searches, error } = await supabase
      .from("saved_searches")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[saved-searches/list] Error:", error);
      return res.status(500).json({ error: "Failed to fetch saved searches" });
    }

    return res.status(200).json({ searches: searches || [] });

  } catch (e) {
    console.error("[saved-searches/list] Error:", e);
    return res.status(500).json({ error: e.message });
  }
}

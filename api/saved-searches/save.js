// File: /api/saved-searches/save.js
// Save a search query for email alerts when new listings match
// POST { filters, name (optional) }
// Headers: Authorization: Bearer <token>

import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

const MAX_SAVED_SEARCHES = 10;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = getSupabaseAdmin();

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
    const { filters, name } = req.body || {};

    if (!filters || typeof filters !== "object") {
      return res.status(400).json({ error: "filters object required" });
    }

    const { count, error: countError } = await supabase
      .from("saved_searches")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (countError) {
      console.error("[saved-searches/save] Count error:", countError);
      return res.status(500).json({ error: "Failed to check saved searches" });
    }

    if (count >= MAX_SAVED_SEARCHES) {
      return res.status(400).json({ 
        error: `Maximum ${MAX_SAVED_SEARCHES} saved searches allowed`,
        message: `You can have up to ${MAX_SAVED_SEARCHES} saved searches. Please delete one to add another.`
      });
    }

    let displayName = name;
    if (!displayName) {
      const parts = [];
      if (filters.q) parts.push(`"${filters.q}"`);
      if (filters.content?.length) parts.push(filters.content.slice(0, 2).join(", "));
      if (filters.colors?.length) parts.push(filters.colors.slice(0, 2).join(", "));
      if (filters.fabricTypes?.length) parts.push(filters.fabricTypes.slice(0, 2).join(", "));
      if (filters.minPrice || filters.maxPrice) {
        const priceRange = `$${filters.minPrice || 0}-$${filters.maxPrice || '∞'}`;
        parts.push(priceRange);
      }
      displayName = parts.length > 0 ? parts.join(" · ") : "Custom search";
      if (displayName.length > 100) {
        displayName = displayName.slice(0, 97) + "...";
      }
    }

    const { data: savedSearch, error: insertError } = await supabase
      .from("saved_searches")
      .insert({
        user_id: user.id,
        name: displayName,
        filters: filters,
        email_alerts: true,
        last_checked_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error("[saved-searches/save] Insert error:", insertError);
      return res.status(500).json({ error: "Failed to save search" });
    }

    return res.status(200).json({ success: true, savedSearch });

  } catch (e) {
    console.error("[saved-searches/save] Error:", e);
    return res.status(500).json({ error: e.message });
  }
}

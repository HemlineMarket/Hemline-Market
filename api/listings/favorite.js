// FILE: api/listings/favorite.js
// REPLACE your existing file with this entire file
//
// FIXES:
// - Added authentication - users can only favorite as themselves

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

  // REQUIRE AUTHENTICATION
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Please sign in to favorite items" });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  
  if (authError || !user) {
    return res.status(401).json({ error: "Invalid session" });
  }

  try {
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    } catch {
      body = req.body || {};
    }

    const { listing_id } = body;
    const user_id = user.id; // Always use authenticated user's ID

    if (!listing_id) {
      return res.status(400).json({ error: "Missing listing_id" });
    }

    // Check if already favorited
    const { data: existing } = await supabase
      .from("favorites")
      .select("id")
      .eq("listing_id", listing_id)
      .eq("user_id", user_id)
      .maybeSingle();

    if (existing) {
      return res.status(200).json({ ok: true, already_favorited: true });
    }

    const { data: fav, error: favErr } = await supabase
      .from("favorites")
      .insert({
        listing_id,
        user_id
      })
      .select("*")
      .single();

    if (favErr) {
      console.error("Favorite insert error:", favErr);
      return res.status(500).json({ error: "Could not save favorite" });
    }

    // Notify seller
    const { data: listing } = await supabase
      .from("listings")
      .select("seller_id, title")
      .eq("id", listing_id)
      .maybeSingle();

    if (listing?.seller_id && listing.seller_id !== user_id) {
      await supabase.from("notifications").insert({
        user_id: listing.seller_id,
        actor_id: user_id,
        type: "listing_favorite",
        kind: "favorite",
        title: "Someone favorited your item",
        body: listing.title || "",
        href: `listing.html?id=${listing_id}`,
        link: `listing.html?id=${listing_id}`,
      });
    }

    return res.status(200).json({ ok: true, fav });
  } catch (err) {
    console.error("favorite.js error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

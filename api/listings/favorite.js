// File: api/listings/favorite.js
// Insert favorite + notify seller

import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const { listing_id, user_id } = JSON.parse(req.body);

    // 1. Insert favorite
    const { data: fav, error: favErr } = await supabase
      .from("favorites")
      .insert({
        listing_id,
        user_id
      })
      .select("*")
      .single();

    if (favErr) {
      return res.status(500).json({ error: "Insert failed" });
    }

    // 2. Lookup seller
    const { data: listing, error: listErr } = await supabase
      .from("listings")
      .select("seller_id, title")
      .eq("id", listing_id)
      .maybeSingle();

    if (!listing || listErr) {
      return res.status(200).json({ ok: true, fav });
    }

    const seller_id = listing.seller_id;

    // 3. Notify seller (not self)
    if (seller_id && seller_id !== user_id) {
      await supabase.from("notifications").insert({
        user_id: seller_id,
        actor_id: user_id,
        type: "listing_favorite",
        kind: "favorite",
        title: "Someone favorited your item",
        body: listing.title || "",
        href: `listing.html?id=${listing_id}`,
        link: `listing.html?id=${listing_id}`,
        metadata: {
          listing_id,
          favorite_id: fav.id
        }
      });
    }

    return res.status(200).json({ ok: true, fav });
  } catch (err) {
    console.error("favorite.js error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

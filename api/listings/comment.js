// File: api/listings/comment.js
// Insert a listing comment + notify seller

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
    const { listing_id, author_id, body } = JSON.parse(req.body);

    // ---------------------------------
    // 1. Insert comment into table
    // ---------------------------------
    const { data: comment, error: commentErr } = await supabase
      .from("listing_comments")
      .insert({
        listing_id,
        author_id,
        body
      })
      .select("*")
      .single();

    if (commentErr) {
      console.error("Comment insert failed:", commentErr);
      return res.status(500).json({ error: "Insert failed" });
    }

    // ---------------------------------
    // 2. Get seller ID from listing
    // ---------------------------------
    const { data: listing, error: listErr } = await supabase
      .from("listings")
      .select("id, seller_id, title")
      .eq("id", listing_id)
      .maybeSingle();

    if (listErr || !listing) {
      return res.status(200).json({ ok: true, comment });
    }

    const seller_id = listing.seller_id;

    // ---------------------------------
    // 3. Notify seller
    // ---------------------------------
    if (seller_id && seller_id !== author_id) {
      await supabase.from("notifications").insert({
        user_id: seller_id,
        actor_id: author_id,
        type: "listing_comment",
        kind: "comment",
        title: "New comment on your listing",
        body,
        href: `listing.html?id=${listing_id}`,
        link: `listing.html?id=${listing_id}`,
        metadata: {
          listing_id,
          comment_id: comment.id
        }
      });
    }

    return res.status(200).json({ ok: true, comment });
  } catch (err) {
    console.error("comment.js error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

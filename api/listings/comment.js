// FILE: api/listings/comment.js
// FIX: Added JWT authentication and author_id validation (BUG #7)
// Insert a listing comment + notify seller
//
// CHANGE: Now requires valid JWT token, and author_id must match authenticated user

import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

async function verifyAuth(req) {
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
    return res.status(405).json({ error: "Method not allowed" });
  }

  // FIX: Require authentication
  const user = await verifyAuth(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = getSupabaseAdmin();

  try {
    const { listing_id, author_id, body } = typeof req.body === "string" 
      ? JSON.parse(req.body) 
      : req.body;

    // FIX: Validate author_id matches authenticated user
    if (author_id !== user.id) {
      return res.status(403).json({ error: "Cannot post comments as another user" });
    }

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

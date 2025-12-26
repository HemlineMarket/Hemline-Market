// File: api/reviews/submit.js
// Submit a review for a completed order
// POST { order_id, rating (1-5), comment (optional) }

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
  const { order_id, rating, comment } = req.body || {};

  // Validate rating
  if (!order_id || !rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "Invalid order_id or rating (1-5 required)" });
  }

  // Get auth token
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
    // Get order and verify buyer owns it
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, buyer_id, seller_id, status, listing_title")
      .eq("id", order_id)
      .maybeSingle();

    if (orderError || !order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.buyer_id !== user.id) {
      return res.status(403).json({ error: "You can only review orders you placed" });
    }

    // Check order is delivered/complete
    if (!["DELIVERED", "COMPLETE"].includes(order.status)) {
      return res.status(400).json({ error: "You can only review delivered orders" });
    }

    // Check if already reviewed
    const { data: existingReview } = await supabase
      .from("reviews")
      .select("id")
      .eq("order_id", order_id)
      .maybeSingle();

    if (existingReview) {
      return res.status(400).json({ error: "You have already reviewed this order" });
    }

    // Create review
    const { data: review, error: insertError } = await supabase
      .from("reviews")
      .insert({
        order_id,
        reviewer_id: user.id,
        seller_id: order.seller_id,
        rating: Math.round(rating),
        comment: comment?.trim() || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Review insert error:", insertError);
      return res.status(500).json({ error: "Failed to submit review" });
    }

    // Notify seller
    await supabase.from("notifications").insert({
      user_id: order.seller_id,
      type: "review",
      kind: "review",
      title: `New ${rating}-star review!`,
      body: `You received a ${rating}-star review for "${order.listing_title}"`,
      href: "/sales.html",
    });

    return res.status(200).json({ success: true, review });

  } catch (e) {
    console.error("Review error:", e);
    return res.status(500).json({ error: e.message });
  }
}

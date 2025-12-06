// File: /api/cancel_purchase.js
// Buyer can cancel a purchase within 30 minutes.
// Cancels the order and reopens the listing immediately.

import supabaseAdmin from "./_supabaseAdmin";

// Helper: return JSON with status
function json(res, code, obj) {
  res.status(code).json(obj);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method Not Allowed" });
  }

  const { order_id, buyer_id } = req.body || {};

  if (!order_id || !buyer_id) {
    return json(res, 400, { error: "Missing order_id or buyer_id" });
  }

  // 1) Load the order
  const { data: order, error: loadErr } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", order_id)
    .single();

  if (loadErr || !order) {
    return json(res, 404, { error: "Order not found." });
  }

  // 2) Verify buyer
  if (order.buyer_id !== buyer_id) {
    return json(res, 403, { error: "You are not allowed to cancel this purchase." });
  }

  // 3) Validate time window (30 min)
  const created = new Date(order.created_at).getTime();
  const now = Date.now();
  const diffMinutes = (now - created) / 60000;

  if (diffMinutes > 30) {
    return json(res, 400, { error: "Cancellation window has expired." });
  }

  // 4) Cancel order
  const cancelTime = new Date().toISOString();

  const { error: updateErr } = await supabaseAdmin
    .from("orders")
    .update({
      status: "CANCELED",
      canceled_at: cancelTime,
      updated_at: cancelTime
    })
    .eq("id", order_id);

  if (updateErr) {
    return json(res, 500, { error: "Failed to cancel order." });
  }

  // 5) Reopen listing immediately
  if (order.listing_id) {
    await supabaseAdmin
      .from("listings")
      .update({
        status: "ACTIVE",
        updated_at: cancelTime
      })
      .eq("id", order.listing_id)
      .is("deleted_at", null);
  }

  // 6) Optional notification to seller
  try {
    await supabaseAdmin.from("notifications").insert({
      user_id: order.seller_id,
      actor_id: order.buyer_id,
      type: "purchase_canceled",
      title: "Purchase canceled",
      body: "The buyer canceled the purchase within the 30-minute window.",
      href: `/listing.html?id=${order.listing_id}`
    });
  } catch (_) {
    // best effort only
  }

  return json(res, 200, { success: true });
}

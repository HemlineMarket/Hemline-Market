// File: /api/orders/cancel.js
// Cancels a purchase IF within 30 minutes of creation.
// Updates: orders.status, listings.status, notifications.

import supabaseAdmin from "../_supabaseAdmin";

export const config = {
  api: { bodyParser: true }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { order_id, user_id } = req.body || {};
  if (!order_id || !user_id) {
    return res.status(400).json({ error: "Missing order_id or user_id" });
  }

  // Fetch order
  const { data: order, error: fetchErr } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", order_id)
    .single();

  if (fetchErr || !order) {
    return res.status(404).json({ error: "Order not found" });
  }

  // Ensure buyer matches
  if (order.buyer_id !== user_id) {
    return res.status(403).json({ error: "Not allowed" });
  }

  // Check window (30 minutes)
  const created = new Date(order.created_at).getTime();
  const now = Date.now();
  const diffMinutes = (now - created) / 60000;

  if (diffMinutes > 30) {
    return res.status(400).json({ error: "Cancellation window expired" });
  }

  // Update order → CANCELLED
  const { error: updateOrderErr } = await supabaseAdmin
    .from("orders")
    .update({
      status: "CANCELLED",
      updated_at: new Date().toISOString()
    })
    .eq("id", order_id);

  if (updateOrderErr) {
    return res.status(500).json({ error: "Failed to update order" });
  }

  // Restore listing
  if (order.listing_id) {
    await supabaseAdmin
      .from("listings")
      .update({
        status: "ACTIVE",
        updated_at: new Date().toISOString()
      })
      .eq("id", order.listing_id);
  }

  // Notification to seller
  if (order.seller_id) {
    await supabaseAdmin.from("notifications").insert({
      user_id: order.seller_id,
      actor_id: order.buyer_id,
      type: "purchase_cancelled",
      kind: "order",
      title: "Buyer cancelled purchase",
      body: `A buyer cancelled the purchase for “${order.listing_title || "your listing"}”.`,
      href: `/sales.html`,
      link: `/sales.html`
    });
  }

  return res.status(200).json({ success: true });
}

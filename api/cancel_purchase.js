// File: /api/cancel_purchase.js
// Cancels an order (within 30 minutes) and re-opens the listing.
//
// Called from purchases.html via POST /api/cancel_purchase
// Body: { order_id, buyer_id }

import supabaseAdmin from "./_supabaseAdmin";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { order_id, buyer_id } = req.body || {};

    if (!order_id) {
      return res.status(400).json({ error: "Missing order_id" });
    }

    if (!buyer_id) {
      return res.status(400).json({ error: "Missing buyer_id" });
    }

    // Load the order
    const { data: order, error: selectErr } = await supabaseAdmin
      .from("orders")
      .select("id, buyer_id, buyer_email, listing_id, status, created_at")
      .eq("id", order_id)
      .maybeSingle();

    if (selectErr) {
      console.error("[cancel_purchase] select error:", selectErr);
      return res.status(500).json({ error: "Failed to load order" });
    }

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Basic ownership check:
    // if the order has a buyer_id set, it must match the logged-in buyer.
    if (order.buyer_id && order.buyer_id !== buyer_id) {
      return res
        .status(403)
        .json({ error: "This order does not belong to the current user." });
    }

    // 30-minute server-side cancellation window
    if (order.created_at) {
      const createdMs = new Date(order.created_at).getTime();
      const diffMs = Date.now() - createdMs;
      const windowMs = 30 * 60 * 1000;

      if (diffMs > windowMs) {
        return res
          .status(400)
          .json({ error: "The 30-minute cancellation window has expired." });
      }
    }

    // If already cancelled, just return OK so the UI can update gracefully
    if (
      order.status &&
      order.status.toString().toUpperCase() === "CANCELLED"
    ) {
      return res.status(200).json({ status: "CANCELLED" });
    }

    const nowIso = new Date().toISOString();

    // 1) Mark order as CANCELLED
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("orders")
      .update({ status: "CANCELLED", updated_at: nowIso })
      .eq("id", order.id)
      .select("id, status, listing_id")
      .maybeSingle();

    if (updateErr) {
      console.error("[cancel_purchase] update order error:", updateErr);
      return res.status(500).json({ error: "Failed to cancel order" });
    }

    // 2) Re-open listing, if we know which one it is
    if (updated?.listing_id) {
      const { error: listingErr } = await supabaseAdmin
        .from("listings")
        .update({ status: "ACTIVE", updated_at: nowIso })
        .eq("id", updated.listing_id)
        .is("deleted_at", null);

      if (listingErr) {
        // Don't block cancellation if this fails; just log it.
        console.warn("[cancel_purchase] listing update error:", listingErr);
      }
    }

    return res.status(200).json({ status: updated?.status || "CANCELLED" });
  } catch (err) {
    console.error("[cancel_purchase] handler error:", err);
    return res
      .status(500)
      .json({ error: "Server error cancelling purchase" });
  }
}

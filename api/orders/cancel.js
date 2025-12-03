// File: /api/orders/cancel.js
// Marks an order as CANCEL_REQUESTED (within 30 minutes)
// and notifies buyer + seller via the notifications table.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import supabaseAdmin from "../_supabaseAdmin";
import { logError, logInfo } from "../_logger";

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

const CANCEL_WINDOW_MINUTES = 30;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { order_id } = req.body || {};
    const orderId = (order_id || "").trim();

    if (!orderId) {
      return res.status(400).json({ error: "Missing order_id" });
    }

    // 1) Look up the order
    const { data: order, error: fetchErr } = await supabaseAdmin
      .from("orders")
      .select(
        `
          id,
          order_id,
          status,
          created_at,
          buyer_id,
          seller_id,
          buyer_email,
          total_cents
        `
      )
      .eq("order_id", orderId)
      .maybeSingle();

    if (fetchErr) {
      await logError("/api/orders/cancel", "orders fetch error", fetchErr);
      return res.status(500).json({ error: "Database error" });
    }

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // 2) Check whether we’re still inside the 30-minute window
    const createdAtMs = order.created_at
      ? new Date(order.created_at).getTime()
      : NaN;

    if (!Number.isFinite(createdAtMs)) {
      return res.status(400).json({
        error: "Order timestamp invalid; cannot safely cancel automatically.",
      });
    }

    const nowMs = Date.now();
    const diffMinutes = (nowMs - createdAtMs) / (60 * 1000);

    if (diffMinutes > CANCEL_WINDOW_MINUTES) {
      return res.status(400).json({
        error: "Cancellation window has passed.",
        code: "WINDOW_EXPIRED",
      });
    }

    // 3) Check existing status
    const currentStatus = (order.status || "").toUpperCase();
    if (
      currentStatus === "CANCELLED" ||
      currentStatus === "CANCEL_REQUESTED" ||
      currentStatus === "REFUNDED"
    ) {
      return res.status(200).json({
        ok: true,
        status: currentStatus,
        message: "Order is already in a cancelled state.",
      });
    }

    // If you mark "SHIPPED" or similar, block automatic cancel.
    if (currentStatus === "SHIPPED") {
      return res.status(400).json({
        error: "This order is already marked as shipped.",
        code: "ALREADY_SHIPPED",
      });
    }

    // 4) Mark as CANCEL_REQUESTED
    const nowIso = new Date().toISOString();

    const { error: updateErr } = await supabaseAdmin
      .from("orders")
      .update({
        status: "CANCEL_REQUESTED",
        cancel_requested_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", order.id);

    if (updateErr) {
      await logError("/api/orders/cancel", "orders update error", updateErr);
      return res.status(500).json({ error: "Failed to update order" });
    }

    // 5) Insert notifications for buyer + seller (best-effort)
    const notifs = [];
    const href = `/orders.html?order=${encodeURIComponent(orderId)}`;

    if (order.buyer_id) {
      notifs.push({
        user_id: order.buyer_id,
        type: "order",
        kind: "order",
        title: "We’re processing your cancellation request",
        body: `You asked to cancel order ${orderId}. We’ve notified the seller. They are instructed not to ship within the first 30 minutes.`,
        href,
        is_read: false,
        created_at: nowIso,
      });
    }

    if (order.seller_id) {
      notifs.push({
        user_id: order.seller_id,
        type: "order",
        kind: "order",
        title: "Buyer requested to cancel an order",
        body: `The buyer requested to cancel order ${orderId}. Do not ship this order within the first 30 minutes after purchase while the cancellation is processed.`,
        href,
        is_read: false,
        created_at: nowIso,
      });
    }

    if (notifs.length) {
      const { error: notifErr } = await supabaseAdmin
        .from("notifications")
        .insert(notifs);

      if (notifErr) {
        await logError(
          "/api/orders/cancel",
          "notifications insert error",
          notifErr
        );
      }
    }

    await logInfo("/api/orders/cancel", "cancel requested", {
      order_id: orderId,
      buyer_id: order.buyer_id,
      seller_id: order.seller_id,
    });

    return res.status(200).json({
      ok: true,
      status: "CANCEL_REQUESTED",
      order_id: orderId,
    });
  } catch (err) {
    await logError("/api/orders/cancel", "Unhandled error", {
      message: err?.message || err,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

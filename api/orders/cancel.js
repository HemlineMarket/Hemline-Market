// File: /api/orders/cancel.js
// Buyer-initiated cancel within 30 minutes.
// - Verifies the order exists and is still within cancel window
// - Issues a Stripe refund
// - Marks db_orders as CANCELLED
// - Marks listings as AVAILABLE again
// - (Optional) writes notifications for buyer + sellers
//
// ENV required:
// - STRIPE_SECRET_KEY
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY

import Stripe from "stripe";
import supabaseAdmin from "../_supabaseAdmin";
import { rateLimit } from "../_rateLimit";
import { logError } from "../_logger";

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  throw new Error("STRIPE_SECRET_KEY is not set");
}

const stripe = new Stripe(stripeSecret, {
  apiVersion: "2023-10-16",
});

export default async function handler(req, res) {
  // Rate limit
  if (!rateLimit(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { sessionId, checkout_session_id, reason } = req.body || {};
    const sid = (sessionId || checkout_session_id || "").trim();

    if (!sid) {
      return res.status(400).json({ error: "Missing sessionId" });
    }

    // 1) Look up order in db_orders by Stripe Checkout Session id
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("db_orders")
      .select(
        "id, stripe_session_id, buyer_id, status, cancel_expires_at, refund_id"
      )
      .eq("stripe_session_id", sid)
      .maybeSingle();

    if (orderErr) {
      await logError("/api/orders/cancel", "db_orders lookup error", {
        error: orderErr,
        sid,
      });
      return res.status(500).json({ error: "Database error" });
    }

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Only allow cancel if PAID (or PENDING_PAID) and not already refunded/cancelled
    const blockedStatuses = ["CANCELLED", "REFUNDED", "EXPIRED"];
    if (blockedStatuses.includes(order.status)) {
      return res.status(400).json({ error: "Order cannot be cancelled" });
    }

    // 2) Enforce 30-minute cancel window (using cancel_expires_at we set in metadata)
    if (order.cancel_expires_at) {
      const now = new Date();
      const limit = new Date(order.cancel_expires_at);
      if (now > limit) {
        return res.status(400).json({
          error: "Cancel window has expired",
        });
      }
    }

    // 3) Get the Stripe PaymentIntent from the Checkout Session
    const session = await stripe.checkout.sessions.retrieve(sid, {
      expand: ["payment_intent"],
    });

    const piId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;

    if (!piId) {
      await logError("/api/orders/cancel", "No payment_intent on session", {
        sid,
      });
      return res.status(400).json({
        error: "This payment cannot be cancelled via API",
      });
    }

    // 4) Create refund (Stripe handles partials if you later add amount)
    const refund = await stripe.refunds.create({
      payment_intent: piId,
      reason: "requested_by_customer",
      metadata: {
        order_id: order.id,
        checkout_session_id: sid,
        cancel_reason: reason || "buyer_cancel",
      },
    });

    // 5) Fetch order items so we can re-open listings
    const { data: items, error: itemsErr } = await supabaseAdmin
      .from("db_order_items")
      .select("listing_id, seller_user_id")
      .eq("order_id", order.id);

    if (itemsErr) {
      await logError(
        "/api/orders/cancel",
        "db_order_items lookup error",
        { error: itemsErr, orderId: order.id }
      );
    }

    const listingIds = (items || [])
      .map((it) => it.listing_id)
      .filter(Boolean);

    // 6) Mark order as CANCELLED in db_orders
    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabaseAdmin
      .from("db_orders")
      .update({
        status: "CANCELLED",
        cancelled_at: nowIso,
        refund_id: refund.id,
        updated_at: nowIso,
      })
      .eq("id", order.id);

    if (updateErr) {
      await logError(
        "/api/orders/cancel",
        "db_orders update error",
        { error: updateErr, orderId: order.id }
      );
    }

    // 7) Re-open listings (so they can be sold again)
    if (listingIds.length) {
      const { error: listingsErr } = await supabaseAdmin
        .from("listings")
        .update({
          status: "AVAILABLE", // assumes your listings table uses this; adjust if needed
          sold_at: null,
          buyer_id: null,
        })
        .in("id", listingIds);

      if (listingsErr) {
        await logError(
          "/api/orders/cancel",
          "listings reopen error",
          { error: listingsErr, listingIds }
        );
      }
    }

    // 8) Optional: notifications for buyer + sellers
    try {
      const notifPayloads = [];

      if (order.buyer_id) {
        notifPayloads.push({
          user_id: order.buyer_id,
          type: "order_cancelled",
          kind: "order",
          title: "Order cancelled",
          body:
            "Your order has been cancelled and a refund request was sent to Stripe.",
          href: `/orders.html?order=${encodeURIComponent(order.id)}`,
          is_read: false,
        });
      }

      (items || []).forEach((it) => {
        if (!it.seller_user_id) return;
        notifPayloads.push({
          user_id: it.seller_user_id,
          type: "order_cancelled",
          kind: "order",
          title: "Order cancelled by buyer",
          body:
            "A buyer cancelled their order within the 30-minute window. Do not ship this item.",
          href: `/orders.html?order=${encodeURIComponent(order.id)}`,
          is_read: false,
        });
      });

      if (notifPayloads.length) {
        await supabaseAdmin.from("notifications").insert(
          notifPayloads.map((n) => ({
            ...n,
            created_at: nowIso,
          }))
        );
      }
    } catch (notifErr) {
      await logError(
        "/api/orders/cancel",
        "notifications insert error",
        { message: notifErr?.message || notifErr }
      );
    }

    return res.status(200).json({
      ok: true,
      orderId: order.id,
      refundId: refund.id,
      status: "CANCELLED",
    });
  } catch (err) {
    await logError("/api/orders/cancel", "Unhandled error", {
      message: err?.message || err,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

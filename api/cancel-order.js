// File: /api/cancel-order.js
// Buyer-initiated order cancellation (within 30 min window)
//
// ENV REQUIRED:
// STRIPE_SECRET_KEY
// SUPABASE_URL
// SUPABASE_SERVICE_ROLE_KEY
// SITE_URL
//
// Works with RLS because it uses service-role.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

// Supabase (service role)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);

// Base URL
function site() {
  return (process.env.SITE_URL || "").replace(/\/$/, "");
}

// Notify helper
async function notify(payload) {
  try {
    await fetch(`${site()}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("[cancel-order] notify error:", err);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { order_id, buyer_id } = req.body || {};

    if (!order_id || !buyer_id) {
      return res.status(400).json({ error: "Missing order_id or buyer_id" });
    }

    // 1) Load order
    const { data: order, error } = await supabase
      .from("orders")
      .select("*")
      .eq("id", order_id)
      .single();

    if (error || !order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // 2) Validate buyer
    if (order.buyer_id !== buyer_id) {
      return res.status(403).json({
        error: "This order does not belong to you.",
      });
    }

    // 3) Check if already canceled or shipped
    if (order.status === "canceled") {
      return res.status(400).json({ error: "Order already canceled." });
    }
    if (order.status === "shipped") {
      return res.status(400).json({
        error: "Order already shipped — cannot cancel.",
      });
    }

    // 4) Check 30-minute window
    const placed = new Date(order.created_at).getTime();
    const now = Date.now();
    const diffMin = (now - placed) / 60000;

    if (diffMin > 30) {
      return res.status(400).json({
        error: "Cancellation window has expired.",
      });
    }

    // 5) Refund the charge
    if (!order.payment_intent) {
      return res
        .status(500)
        .json({ error: "Order missing payment_intent" });
    }

    await stripe.refunds.create({
      payment_intent: order.payment_intent,
      reason: "requested_by_customer",
    });

    // 6) Update order status
    await supabase
      .from("orders")
      .update({ status: "canceled", canceled_at: new Date().toISOString() })
      .eq("id", order_id);

    // 7) Re-open listing (optional)
    if (order.listing_id) {
      await supabase
        .from("listings")
        .update({ status: "active" })
        .eq("id", order.listing_id);
    }

    // 8) Notify seller
    await notify({
      user_id: order.seller_id,
      kind: "warning",
      title: "Order canceled",
      body: `The buyer canceled their purchase of ${order.listing_name}. Do not ship.`,
      href: `${site()}/orders.html`,
    });

    // 9) Notify buyer
    await notify({
      user_id: order.buyer_id,
      kind: "order",
      title: "Your order was canceled",
      body: `Your refund for ${order.listing_name} has been processed.`,
      href: `${site()}/orders.html`,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[cancel-order] error:", err);
    return res.status(500).json({ error: "server_error", detail: err.message });
  }
}

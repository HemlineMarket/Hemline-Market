// File: api/orders/cancel.js
// Cancel an order and issue Stripe refund
// Only allowed if:
// - Order is PAID status (not shipped)
// - 5+ business days have passed since purchase
// - Buyer is the one canceling
//
// POST { order_id: "..." }

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

async function sendEmail(to, subject, htmlBody, textBody) {
  const POSTMARK = process.env.POSTMARK_SERVER_TOKEN;
  const FROM = process.env.FROM_EMAIL || "orders@hemlinemarket.com";
  if (!POSTMARK || !to) return;

  await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Postmark-Server-Token": POSTMARK },
    body: JSON.stringify({ From: FROM, To: to, Subject: subject, HtmlBody: htmlBody, TextBody: textBody, MessageStream: "outbound" }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = getSupabaseAdmin();
  const { order_id } = req.body || {};

  if (!order_id) {
    return res.status(400).json({ error: "Missing order_id" });
  }

  // Get authorization header (Supabase JWT)
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
    // Get order
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", order_id)
      .maybeSingle();

    if (orderError || !order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Verify buyer owns this order
    if (order.buyer_id !== user.id) {
      return res.status(403).json({ error: "You can only cancel your own orders" });
    }

    // Check order status
    if (order.status !== "PAID") {
      return res.status(400).json({ error: `Cannot cancel order with status: ${order.status}` });
    }

    // Check if already shipped
    if (order.shipped_at || order.shipping_status === "IN_TRANSIT" || order.shipping_status === "DELIVERED") {
      return res.status(400).json({ error: "Cannot cancel - order has already shipped" });
    }

    // Check if 5 days have passed
    const orderDate = new Date(order.created_at);
    const now = new Date();
    const daysSinceOrder = (now - orderDate) / (1000 * 60 * 60 * 24);

    if (daysSinceOrder < 5) {
      const daysRemaining = Math.ceil(5 - daysSinceOrder);
      return res.status(400).json({ 
        error: `Cannot cancel yet. Seller has ${daysRemaining} more day(s) to ship.`,
        days_remaining: daysRemaining
      });
    }

    // Process Stripe refund
    if (!order.stripe_payment_intent) {
      return res.status(400).json({ error: "No payment intent found for this order" });
    }

    const refund = await stripe.refunds.create({
      payment_intent: order.stripe_payment_intent,
      reason: "requested_by_customer",
    });

    // Update order status
    await supabase.from("orders").update({
      status: "CANCELLED",
      cancelled_at: now.toISOString(),
      cancelled_by: user.id,
      stripe_refund_id: refund.id,
    }).eq("id", order_id);

    // Re-list the item if applicable
    if (order.listing_id) {
      await supabase.from("listings").update({
        status: "active",
        sold_at: null,
      }).eq("id", order.listing_id);
    }

    // Notify buyer
    await supabase.from("notifications").insert({
      user_id: order.buyer_id,
      type: "refund",
      kind: "refund",
      title: "Order cancelled & refunded",
      body: `Your order for "${order.listing_title}" has been cancelled. Refund of $${(order.total_cents / 100).toFixed(2)} is being processed.`,
      href: "/purchases.html",
    });

    // Notify seller
    if (order.seller_id) {
      await supabase.from("notifications").insert({
        user_id: order.seller_id,
        type: "cancelled",
        kind: "cancelled",
        title: "Order cancelled",
        body: `Order for "${order.listing_title}" was cancelled because it wasn't shipped within 5 days. The item has been relisted.`,
        href: "/sales.html",
      });

      // Email seller
      const { data: sellerProfile } = await supabase
        .from("profiles")
        .select("contact_email")
        .eq("id", order.seller_id)
        .maybeSingle();

      if (sellerProfile?.contact_email) {
        await sendEmail(
          sellerProfile.contact_email,
          "⚠️ Order Cancelled - Hemline Market",
          `<h2>Order Cancelled</h2>
          <p>Your order for <strong>"${order.listing_title}"</strong> was cancelled because it wasn't shipped within 5 days.</p>
          <p>The buyer has been refunded and your listing has been automatically relisted.</p>
          <p>To avoid cancellations, please ship orders within 5 business days of purchase.</p>
          <p>Hemline Market</p>`,
          `Order for "${order.listing_title}" was cancelled due to non-shipment. The item has been relisted.`
        );
      }
    }

    // Email buyer
    if (order.buyer_email) {
      await sendEmail(
        order.buyer_email,
        "✅ Order Cancelled & Refunded - Hemline Market",
        `<h2>Order Cancelled</h2>
        <p>Your order for <strong>"${order.listing_title}"</strong> has been cancelled.</p>
        <p>A full refund of <strong>$${(order.total_cents / 100).toFixed(2)}</strong> is being processed to your original payment method.</p>
        <p>Refunds typically appear within 5-10 business days.</p>
        <p>We're sorry this order didn't work out. <a href="https://hemlinemarket.com/browse.html">Continue shopping</a></p>
        <p>Hemline Market</p>`,
        `Your order for "${order.listing_title}" has been cancelled. Refund of $${(order.total_cents / 100).toFixed(2)} is being processed.`
      );
    }

    return res.status(200).json({ 
      success: true, 
      refund_id: refund.id,
      amount_refunded: order.total_cents
    });

  } catch (e) {
    console.error("Cancel order error:", e);
    return res.status(500).json({ error: e.message });
  }
}

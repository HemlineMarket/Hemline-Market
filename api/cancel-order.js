// FILE: api/cancel-order.js
// FIX: Uses JWT to verify buyer instead of trusting body parameter (BUG #20)
// Buyer-initiated order cancellation (within 30 min window)
//
// CHANGE: Now requires valid JWT token, buyer_id derived from token (not body)
//
// ENV REQUIRED:
// STRIPE_SECRET_KEY
// SUPABASE_URL
// SUPABASE_SERVICE_ROLE_KEY
// SITE_URL
// POSTMARK_SERVER_TOKEN (optional, for email)
//
// Works with RLS because it uses service-role.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
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

// Base URL
function site() {
  return (process.env.SITE_URL || "https://hemlinemarket.com").replace(/\/$/, "");
}

// Send email via Postmark
async function sendEmail(to, subject, htmlBody, textBody) {
  const POSTMARK = process.env.POSTMARK_SERVER_TOKEN;
  const FROM = process.env.FROM_EMAIL || "orders@hemlinemarket.com";
  if (!POSTMARK || !to) return;

  try {
    await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Postmark-Server-Token": POSTMARK },
      body: JSON.stringify({ From: FROM, To: to, Subject: subject, HtmlBody: htmlBody, TextBody: textBody, MessageStream: "outbound" }),
    });
  } catch (err) {
    console.error("[cancel-order] email error:", err);
  }
}

// Create in-app notification directly (more reliable than calling /api/notify)
async function createNotification(supabase, userId, kind, title, body, href) {
  if (!userId) return;
  
  try {
    await supabase.from("notifications").insert({
      user_id: userId,
      kind: kind,
      type: kind,
      title: title,
      body: body,
      href: href,
      link: href,
      is_read: false,
    });
  } catch (err) {
    console.error("[cancel-order] notification error:", err);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // FIX: Require authentication
    const user = await verifyAuth(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // FIX: Use authenticated user's ID instead of trusting body parameter
    const buyer_id = user.id;
    const { order_id } = req.body || {};

    if (!order_id) {
      return res.status(400).json({ error: "Missing order_id" });
    }

    const supabase = getSupabaseAdmin();

    // 1) Load order
    const { data: order, error } = await supabase
      .from("orders")
      .select("*")
      .eq("id", order_id)
      .single();

    if (error || !order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // 2) Validate buyer - FIX: Compare against authenticated user
    if (order.buyer_id !== buyer_id) {
      return res.status(403).json({
        error: "This order does not belong to you.",
      });
    }

    // 3) Check if already canceled or shipped
    if (order.status === "canceled" || order.status === "CANCELLED") {
      return res.status(400).json({ error: "Order already canceled." });
    }
    if (order.status === "shipped" || order.status === "SHIPPED" || order.shipped_at) {
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
        error: "Cancellation window has expired (30 minutes).",
      });
    }

    // 5) Refund the charge
    // Support both field names: stripe_payment_intent (new) and payment_intent (old)
    const paymentIntent = order.stripe_payment_intent || order.payment_intent;
    
    if (!paymentIntent) {
      return res.status(500).json({ error: "Order missing payment_intent" });
    }

    await stripe.refunds.create({
      payment_intent: paymentIntent,
      reason: "requested_by_customer",
    });

    // 5b) Void Shippo shipping label if exists
    const shippoTransactionId = order.shippo_transaction_id;
    if (shippoTransactionId) {
      const SHIPPO_KEY = process.env.SHIPPO_API_KEY;
      if (SHIPPO_KEY) {
        try {
          const voidRes = await fetch(`https://api.goshippo.com/transactions/${shippoTransactionId}`, {
            method: "PUT",
            headers: {
              "Authorization": `ShippoToken ${SHIPPO_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ is_return: false, async: false }),
          });
          
          // Shippo uses POST to /refunds endpoint to void/refund a label
          const refundRes = await fetch("https://api.goshippo.com/refunds/", {
            method: "POST",
            headers: {
              "Authorization": `ShippoToken ${SHIPPO_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ transaction: shippoTransactionId }),
          });
          
          const refundData = await refundRes.json();
          if (refundData.status === "QUEUED" || refundData.status === "SUCCESS") {
            console.log(`[cancel-order] Shippo label refund requested: ${refundData.status}`);
          } else {
            console.error("[cancel-order] Shippo refund issue:", refundData);
          }
        } catch (shippoErr) {
          // Log but don't fail the cancellation - the Stripe refund already went through
          console.error("[cancel-order] Shippo void error:", shippoErr);
        }
      }
    }

    // 6) Update order status
    await supabase
      .from("orders")
      .update({ 
        status: "CANCELLED", 
        canceled_at: new Date().toISOString(),
        cancelled_at: new Date().toISOString(), // support both spellings
      })
      .eq("id", order_id);

    // 7) Re-open listing
    if (order.listing_id) {
      await supabase
        .from("listings")
        .update({ status: "active", sold_at: null })
        .eq("id", order.listing_id);
    }

    // Get the item name (support both field names)
    const listingName = order.listing_title || order.listing_name || "your item";
    const totalAmount = order.total_cents ? `$${(order.total_cents / 100).toFixed(2)}` : "your payment";

    // 8) Notify seller (in-app)
    await createNotification(
      supabase,
      order.seller_id,
      "warning",
      "⚠️ Order Canceled",
      `The buyer canceled their purchase of "${listingName}". Do not ship this item. Your listing has been automatically relisted.`,
      "/sales.html"
    );

    // 9) Notify buyer (in-app)
    await createNotification(
      supabase,
      order.buyer_id,
      "order",
      "Order Canceled",
      `Your order for "${listingName}" has been canceled. A refund of ${totalAmount} is being processed.`,
      "/purchases.html"
    );

    // 10) Email seller
    if (order.seller_id) {
      const { data: sellerProfile } = await supabase
        .from("profiles")
        .select("contact_email, first_name")
        .eq("id", order.seller_id)
        .maybeSingle();
      
      if (sellerProfile?.contact_email) {
        await sendEmail(
          sellerProfile.contact_email,
          `⚠️ Order Canceled - ${listingName}`,
          `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;">
            <h2 style="color:#991b1b;">Order Canceled</h2>
            <p>Hi${sellerProfile.first_name ? ' ' + sellerProfile.first_name : ''},</p>
            <p>The buyer has canceled their order for <strong>"${listingName}"</strong> within the 30-minute cancellation window.</p>
            <p><strong>Please do not ship this item.</strong></p>
            <p>Your listing has been automatically relisted and is available for purchase again.</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
            <p style="color:#6b7280;font-size:14px;">Hemline Market</p>
          </div>`,
          `Order Canceled: The buyer canceled "${listingName}". Do not ship. Your listing has been relisted.`
        );
      }
    }

    // 11) Email buyer
    if (order.buyer_email) {
      await sendEmail(
        order.buyer_email,
        `✅ Order Canceled & Refund Initiated`,
        `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#166534;">Order Canceled</h2>
          <p>Your order for <strong>"${listingName}"</strong> has been successfully canceled.</p>
          <p>A refund of <strong>${totalAmount}</strong> is being processed to your original payment method.</p>
          <p>Refunds typically appear within 5-10 business days depending on your bank.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
          <p><a href="${site()}/browse.html" style="color:#991b1b;">Continue shopping</a></p>
          <p style="color:#6b7280;font-size:14px;">Hemline Market</p>
        </div>`,
        `Your order for "${listingName}" has been canceled. Refund of ${totalAmount} is being processed.`
      );
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[cancel-order] error:", err);
    return res.status(500).json({ error: "server_error", detail: err.message });
  }
}

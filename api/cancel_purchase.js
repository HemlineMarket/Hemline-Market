// File: /api/cancel_purchase.js
// Cancels an order (within 30 minutes) and re-opens the listing(s).
// Includes: Stripe refund, Shippo label void, email notifications, seller notification
// FIXED: Now handles multi-item orders (restores all listings with ORIGINAL yards)
// SECURITY FIX: Now requires JWT authentication - buyer_id comes from token, not body
//
// Called from purchases.html via POST /api/cancel_purchase
// Body: { order_id }
// Headers: Authorization: Bearer <token>

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// Create Supabase admin client inline (avoids module resolution issues)
function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

// SECURITY FIX: Verify JWT token and return user
async function verifyAuth(req, supabase) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    return null;
  }

  return user;
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
  } catch (e) {
    console.error("[cancel_purchase] email error:", e);
  }
}

// Void the Shippo label to get refund on label cost
async function voidShippoLabel(supabase, orderId) {
  const apiKey = process.env.SHIPPO_API_KEY;
  if (!apiKey) {
    console.log("[cancel_purchase] No SHIPPO_API_KEY, skipping label void");
    return { voided: false, reason: "no_api_key" };
  }

  try {
    // Look up the shipment
    const { data: shipment, error: dbErr } = await supabase
      .from("db_shipments")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dbErr || !shipment) {
      console.log("[cancel_purchase] No shipment found for order:", orderId);
      return { voided: false, reason: "no_shipment" };
    }

    if (!shipment.shippo_transaction_id) {
      console.log("[cancel_purchase] Shipment has no transaction ID:", orderId);
      return { voided: false, reason: "no_transaction_id" };
    }

    if (shipment.status === "CANCELED") {
      console.log("[cancel_purchase] Shipment already cancelled:", orderId);
      return { voided: true, reason: "already_cancelled" };
    }

    // Call Shippo to void the label
    const cancelRes = await fetch(
      `https://api.goshippo.com/transactions/${shipment.shippo_transaction_id}/void/`,
      {
        method: "POST",
        headers: {
          Authorization: `ShippoToken ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    const cancelData = await cancelRes.json();

    if (!cancelRes.ok || (cancelData.status && cancelData.status.toUpperCase() !== "SUCCESS")) {
      console.error("[cancel_purchase] Shippo void failed:", cancelData);
      return { voided: false, reason: "shippo_error", details: cancelData };
    }

    // Mark shipment as cancelled in database
    await supabase
      .from("db_shipments")
      .update({
        status: "CANCELED",
        cancelled_at: new Date().toISOString(),
      })
      .eq("order_id", orderId);

    // Also clear label info from orders table
    await supabase
      .from("orders")
      .update({
        label_url: null,
        tracking_number: null,
        tracking_url: null,
        shipping_status: "LABEL_VOIDED",
      })
      .eq("id", orderId);

    console.log("[cancel_purchase] Shippo label voided successfully:", orderId);
    return { voided: true, reason: "success", transaction_id: shipment.shippo_transaction_id };

  } catch (err) {
    console.error("[cancel_purchase] Shippo void exception:", err);
    return { voided: false, reason: "exception", error: err.message };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const supabaseAdmin = getSupabaseAdmin();

  try {
    // SECURITY FIX: Require authentication
    const user = await verifyAuth(req, supabaseAdmin);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized - please sign in" });
    }

    // SECURITY FIX: Get buyer_id from authenticated user, not from request body
    const buyer_id = user.id;
    const { order_id } = req.body || {};

    if (!order_id) {
      return res.status(400).json({ error: "Missing order_id" });
    }

    // Load the full order (including listing_ids for multi-item orders)
    const { data: order, error: selectErr } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", order_id)
      .maybeSingle();

    if (selectErr) {
      console.error("[cancel_purchase] select error:", selectErr);
      return res.status(500).json({ error: "Failed to load order" });
    }

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // SECURITY FIX: Verify the authenticated user is the buyer
    if (order.buyer_id !== buyer_id) {
      return res.status(403).json({ error: "You can only cancel your own orders" });
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

    // If already cancelled, just return OK
    if (order.status && order.status.toString().toUpperCase() === "CANCELED") {
      return res.status(200).json({ status: "CANCELED" });
    }

    // === STRIPE REFUND ===
    let refundId = null;
    if (order.stripe_payment_intent) {
      try {
        // First check if already refunded
        const existingRefunds = await stripe.refunds.list({
          payment_intent: order.stripe_payment_intent,
          limit: 1,
        });
        
        if (existingRefunds.data.length > 0) {
          refundId = existingRefunds.data[0].id;
          console.log("[cancel_purchase] Refund already exists:", refundId);
        } else {
          const refund = await stripe.refunds.create({
            payment_intent: order.stripe_payment_intent,
            reason: "requested_by_customer",
          });
          refundId = refund.id;
          console.log("[cancel_purchase] Stripe refund created:", refundId);
        }
      } catch (stripeErr) {
        // Handle "already refunded" error gracefully
        if (stripeErr.code === 'charge_already_refunded') {
          console.log("[cancel_purchase] Charge already refunded, continuing...");
        } else {
          console.error("[cancel_purchase] Stripe refund error:", stripeErr);
        }
        // Continue with cancellation even if refund fails - admin can handle manually
      }
    }

    const nowIso = new Date().toISOString();

    // === VOID SHIPPO LABEL ===
    const labelVoidResult = await voidShippoLabel(supabaseAdmin, order.id);
    console.log("[cancel_purchase] Label void result:", labelVoidResult);

    // 1) Mark order as CANCELED
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("orders")
      .update({ 
        status: "CANCELED", 
        canceled_at: nowIso,
        cancelled_at: nowIso,  // support both spellings
        cancelled_by: buyer_id,
        stripe_refund_id: refundId,
        updated_at: nowIso 
      })
      .eq("id", order.id)
      .select("id, status, listing_id, listing_ids")
      .maybeSingle();

    if (updateErr) {
      console.error("[cancel_purchase] update order error:", updateErr);
      return res.status(500).json({ error: "Failed to cancel order" });
    }

    // 2) Re-open ALL listings with ORIGINAL yards (supports multi-item orders)
    let listingIdsToRestore = [];
    
    // Check for listing_ids array first (multi-item orders)
    if (order.listing_ids && Array.isArray(order.listing_ids) && order.listing_ids.length > 0) {
      listingIdsToRestore = order.listing_ids;
    } else if (order.listing_id) {
      // Fall back to single listing_id
      listingIdsToRestore = [order.listing_id];
    }

    if (listingIdsToRestore.length > 0) {
      console.log("[cancel_purchase] Restoring listings:", listingIdsToRestore);
      
      // Parse original yards from order if available
      let originalYardsMap = {};
      try {
        if (order.original_yards_json) {
          originalYardsMap = JSON.parse(order.original_yards_json);
        }
      } catch (e) {
        console.warn("[cancel_purchase] Could not parse original_yards_json:", e.message);
      }

      // Restore each listing with its original yards
      let restoredCount = 0;
      for (const listingId of listingIdsToRestore) {
        // Use original yards if we have them, otherwise default to 1
        const originalYards = originalYardsMap[listingId] || 1;
        
        const { error: listingErr } = await supabaseAdmin
          .from("listings")
          .update({ 
            status: "ACTIVE", 
            yards_available: originalYards,
            sold_at: null,
            updated_at: nowIso 
          })
          .eq("id", listingId)
          .is("deleted_at", null);

        if (listingErr) {
          console.warn("[cancel_purchase] listing update error for", listingId, ":", listingErr);
        } else {
          console.log(`[cancel_purchase] Restored listing ${listingId} with ${originalYards} yards`);
          restoredCount++;
        }
      }
      
      console.log(`[cancel_purchase] Successfully restored ${restoredCount} of ${listingIdsToRestore.length} listing(s)`);
    }

    // Determine item count for notification text
    const itemCount = listingIdsToRestore.length || 1;
    const itemText = itemCount > 1 
      ? `${itemCount} items` 
      : `"${order.listing_title || 'this item'}"`;

    // 3) Create in-app notification for buyer
    await supabaseAdmin.from("notifications").insert({
      user_id: buyer_id,
      type: "refund",
      kind: "refund",
      title: "Order cancelled & refund initiated",
      body: `Your order for ${itemText} has been cancelled. Refund of $${((order.total_cents || 0) / 100).toFixed(2)} is being processed.`,
      href: "/purchases.html",
    });

    // 4) Create in-app notification for seller
    if (order.seller_id) {
      await

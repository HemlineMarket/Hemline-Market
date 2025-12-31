// File: /api/cancel_purchase.js
// Cancels an order (within 30 minutes) and re-opens the listing(s).
// Includes: Stripe refund, Shippo label void, email notifications, seller notification
// FIXED: Now handles multi-item orders (restores all listings, not just the first one)
//
// Called from purchases.html via POST /api/cancel_purchase
// Body: { order_id, buyer_id }

import Stripe from "stripe";
import supabaseAdmin from "./_supabaseAdmin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

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
async function voidShippoLabel(orderId) {
  const apiKey = process.env.SHIPPO_API_KEY;
  if (!apiKey) {
    console.log("[cancel_purchase] No SHIPPO_API_KEY, skipping label void");
    return { voided: false, reason: "no_api_key" };
  }

  try {
    // Look up the shipment
    const { data: shipment, error: dbErr } = await supabaseAdmin
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

    if (shipment.status === "CANCELLED") {
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
    await supabaseAdmin
      .from("db_shipments")
      .update({
        status: "CANCELLED",
        cancelled_at: new Date().toISOString(),
      })
      .eq("order_id", orderId);

    // Also clear label info from orders table
    await supabaseAdmin
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

  try {
    const { order_id, buyer_id } = req.body || {};

    if (!order_id) {
      return res.status(400).json({ error: "Missing order_id" });
    }

    if (!buyer_id) {
      return res.status(400).json({ error: "Missing buyer_id" });
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

    // Basic ownership check
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

    // If already cancelled, just return OK
    if (order.status && order.status.toString().toUpperCase() === "CANCELLED") {
      return res.status(200).json({ status: "CANCELLED" });
    }

    // === STRIPE REFUND ===
    let refundId = null;
    if (order.stripe_payment_intent) {
      try {
        const refund = await stripe.refunds.create({
          payment_intent: order.stripe_payment_intent,
          reason: "requested_by_customer",
        });
        refundId = refund.id;
        console.log("[cancel_purchase] Stripe refund created:", refundId);
      } catch (stripeErr) {
        console.error("[cancel_purchase] Stripe refund error:", stripeErr);
        // Continue with cancellation even if refund fails - admin can handle manually
      }
    }

    const nowIso = new Date().toISOString();

    // === VOID SHIPPO LABEL ===
    const labelVoidResult = await voidShippoLabel(order.id);
    console.log("[cancel_purchase] Label void result:", labelVoidResult);

    // 1) Mark order as CANCELLED
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("orders")
      .update({ 
        status: "CANCELLED", 
        cancelled_at: nowIso,
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

    // 2) Re-open ALL listings (supports multi-item orders)
    // Build list of all listing IDs to restore
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
      
      const { error: listingErr } = await supabaseAdmin
        .from("listings")
        .update({ 
          status: "ACTIVE", 
          yards_available: 1, // Default to 1 yard; could be enhanced to store original yards
          sold_at: null,
          updated_at: nowIso 
        })
        .in("id", listingIdsToRestore)
        .is("deleted_at", null);

      if (listingErr) {
        console.warn("[cancel_purchase] listing update error:", listingErr);
      } else {
        console.log(`[cancel_purchase] Successfully restored ${listingIdsToRestore.length} listing(s)`);
      }
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
      await supabaseAdmin.from("notifications").insert({
        user_id: order.seller_id,
        type: "cancelled",
        kind: "cancelled",
        title: "🚫 Order cancelled - DO NOT SHIP",
        body: `The buyer cancelled ${itemText} within 30 minutes. ${labelVoidResult.voided ? 'Label has been voided.' : 'Do not use the shipping label.'} ${itemCount > 1 ? 'All listings' : 'Listing'} re-activated.`,
        href: "/sales.html",
      });
    }

    // 5) Email buyer confirmation
    if (order.buyer_email) {
      const totalDollars = ((order.total_cents || 0) / 100).toFixed(2);
      const itemDescription = itemCount > 1 
        ? `<strong>${itemCount} items</strong>` 
        : `<strong>"${order.listing_title || 'this item'}"</strong>`;
      
      await sendEmail(
        order.buyer_email,
        "✅ Order Cancelled & Refund Initiated - Hemline Market",
        `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;">
          <h1 style="color:#991b1b;">Order Cancelled</h1>
          <p>Your order for ${itemDescription} has been cancelled.</p>
          
          <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px;margin:20px 0;">
            <h3 style="margin:0 0 8px;color:#166534;">💳 Refund Details</h3>
            <p style="margin:0;">A full refund of <strong>$${totalDollars}</strong> is being processed to your original payment method.</p>
            <p style="margin:8px 0 0;font-size:14px;color:#6b7280;">Refunds typically appear within 5-10 business days.</p>
          </div>
          
          <p>We're sorry this order didn't work out. <a href="https://hemlinemarket.com/browse.html" style="color:#991b1b;">Continue shopping</a></p>
          
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
          <p style="color:#6b7280;font-size:14px;">Questions? <a href="https://hemlinemarket.com/contact.html" style="color:#991b1b;">Contact us</a><br><strong>Hemline Market</strong></p>
        </div>`,
        `Your order for ${itemCount > 1 ? itemCount + ' items' : '"' + (order.listing_title || 'this item') + '"'} has been cancelled. Refund of $${totalDollars} is being processed to your original payment method.`
      );
    }

    // 6) Email seller notification
    if (order.seller_id) {
      const { data: sellerProfile } = await supabaseAdmin
        .from("profiles")
        .select("contact_email")
        .eq("id", order.seller_id)
        .maybeSingle();

      // Also try to get email from auth
      let sellerEmail = sellerProfile?.contact_email;
      if (!sellerEmail) {
        const { data: sellerAuth } = await supabaseAdmin.auth.admin.getUserById(order.seller_id);
        sellerEmail = sellerAuth?.user?.email;
      }

      if (sellerEmail) {
        const labelMessage = labelVoidResult.voided 
          ? `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px;margin:20px 0;">
              <h3 style="margin:0 0 8px;color:#166534;">🏷️ Shipping Label Voided</h3>
              <p style="margin:0;color:#166534;">The prepaid shipping label has been automatically cancelled. You will not be charged for it.</p>
            </div>`
          : `<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:16px;margin:20px 0;">
              <h3 style="margin:0 0 8px;color:#92400e;">⚠️ About the Shipping Label</h3>
              <p style="margin:0;color:#92400e;">If you printed a shipping label, please discard it — <strong>do not use it</strong>. We attempted to void it automatically.</p>
            </div>`;

        const itemDescription = itemCount > 1 
          ? `<strong>${itemCount} items</strong>` 
          : `<strong>"${order.listing_title || 'your item'}"</strong>`;
        
        const listingMessage = itemCount > 1 
          ? "All your listings have been automatically re-activated"
          : "Your listing has been automatically re-activated";

        await sendEmail(
          sellerEmail,
          "📦 Order Cancelled - Do Not Ship - Hemline Market",
          `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;">
            <h1 style="color:#991b1b;">Order Cancelled</h1>
            <p>The buyer cancelled their order for ${itemDescription} within the 30-minute cancellation window.</p>
            
            <div style="background:#dc2626;color:white;border-radius:8px;padding:16px;margin:20px 0;text-align:center;">
              <h2 style="margin:0;font-size:20px;">🚫 DO NOT SHIP THIS ORDER</h2>
            </div>
            
            ${labelMessage}
            
            <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px;margin:20px 0;">
              <h3 style="margin:0 0 8px;color:#166534;">✅ ${itemCount > 1 ? 'Listings' : 'Listing'} Re-Activated</h3>
              <p style="margin:0;color:#166534;">${listingMessage} and ${itemCount > 1 ? 'are' : 'is'} available for other buyers.</p>
            </div>
            
            <p><strong>No further action needed.</strong></p>
            
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
            <p style="color:#6b7280;font-size:14px;">Happy selling!<br><strong>Hemline Market</strong></p>
          </div>`,
          `CANCELLED: The buyer cancelled their order for ${itemCount > 1 ? itemCount + ' items' : '"' + (order.listing_title || 'your item') + '"'} within 30 minutes. DO NOT SHIP. ${listingMessage}.`
        );
      }
    }

    return res.status(200).json({ 
      status: "CANCELLED",
      refund_id: refundId,
      listings_restored: listingIdsToRestore.length
    });

  } catch (err) {
    console.error("[cancel_purchase] handler error:", err);
    return res
      .status(500)
      .json({ error: "Server error cancelling purchase" });
  }
}

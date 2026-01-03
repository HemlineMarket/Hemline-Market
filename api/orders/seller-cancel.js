// File: api/orders/seller-cancel.js
// Seller-initiated order cancellation with Stripe refund and buyer notification
// Allows cancellation any time before shipping (Poshmark-style policy)
//
// FIXED:
// - Now restores ALL listings for multi-item orders (not just the first one)
// - Now voids Shippo shipping labels
// - Better email formatting for multi-item orders

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

  try {
    await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "X-Postmark-Server-Token": POSTMARK 
      },
      body: JSON.stringify({ 
        From: FROM, 
        To: to, 
        Subject: subject, 
        HtmlBody: htmlBody, 
        TextBody: textBody, 
        MessageStream: "outbound" 
      }),
    });
  } catch (e) {
    console.error("[seller-cancel] email error:", e);
  }
}

// Void the Shippo label to get refund on label cost
async function voidShippoLabel(supabase, orderId) {
  const apiKey = process.env.SHIPPO_API_KEY;
  if (!apiKey) {
    console.log("[seller-cancel] No SHIPPO_API_KEY, skipping label void");
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
      console.log("[seller-cancel] No shipment found for order:", orderId);
      return { voided: false, reason: "no_shipment" };
    }

    if (!shipment.shippo_transaction_id) {
      console.log("[seller-cancel] Shipment has no transaction ID:", orderId);
      return { voided: false, reason: "no_transaction_id" };
    }

    if (shipment.status === "CANCELED") {
      console.log("[seller-cancel] Shipment already cancelled:", orderId);
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
      console.error("[seller-cancel] Shippo void failed:", cancelData);
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

    console.log("[seller-cancel] Shippo label voided successfully:", orderId);
    return { voided: true, reason: "success", transaction_id: shipment.shippo_transaction_id };

  } catch (err) {
    console.error("[seller-cancel] Shippo void exception:", err);
    return { voided: false, reason: "exception", error: err.message };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = getSupabaseAdmin();
  const { order_id, reason } = req.body || {};

  if (!order_id) {
    return res.status(400).json({ error: "Missing order_id" });
  }

  // Verify seller authorization
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
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Verify seller owns this order
    if (order.seller_id !== user.id) {
      return res.status(403).json({ error: "You can only cancel your own sales" });
    }

    // Check order status - can't cancel if already canceled
    const status = (order.status || "").toUpperCase();
    if (status === "CANCELED" || status === "CANCELLED") {
      return res.status(400).json({ error: "Order is already cancelled" });
    }

    // Check order hasn't shipped
    if (order.shipped_at || status === "SHIPPED" || status === "DELIVERED" || status === "COMPLETE") {
      return res.status(400).json({ error: "Cannot cancel - order has already shipped" });
    }

    // Process Stripe refund if we have a payment intent
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
          console.log("[seller-cancel] Refund already exists:", refundId);
        } else {
          const refund = await stripe.refunds.create({
            payment_intent: order.stripe_payment_intent,
            reason: "requested_by_customer",
          });
          refundId = refund.id;
          console.log("[seller-cancel] Stripe refund created:", refundId);
        }
      } catch (stripeError) {
        if (stripeError.code === 'charge_already_refunded') {
          console.log("[seller-cancel] Charge already refunded, continuing...");
        } else {
          console.error("Stripe refund error:", stripeError);
        }
        // Continue with cancellation even if refund fails - can be manually processed
      }
    }

    const now = new Date().toISOString();

    // Void Shippo label if exists
    const labelVoidResult = await voidShippoLabel(supabase, order.id);
    console.log("[seller-cancel] Label void result:", labelVoidResult);

    // Update order status
    await supabase.from("orders").update({
      status: "CANCELED",
      canceled_at: now,
      cancelled_at: now,  // support both spellings
      canceled_by: user.id,
      cancel_reason: reason || "seller_canceled",
      stripe_refund_id: refundId,
      refund_status: refundId ? "PROCESSED" : "PENDING",
      refund_amount_cents: order.total_cents,
      updated_at: now
    }).eq("id", order_id);

    // FIX: Restore ALL listings (handles multi-item orders)
    let listingIdsToRestore = [];
    
    // Check for listing_ids array first (multi-item orders)
    if (order.listing_ids && Array.isArray(order.listing_ids) && order.listing_ids.length > 0) {
      listingIdsToRestore = order.listing_ids;
    } else if (order.listing_id) {
      // Fall back to single listing_id
      listingIdsToRestore = [order.listing_id];
    }

    if (listingIdsToRestore.length > 0) {
      console.log("[seller-cancel] Restoring listings:", listingIdsToRestore);
      
      const { error: listingErr } = await supabase
        .from("listings")
        .update({ 
          status: "ACTIVE", 
          sold_at: null,
          updated_at: now 
        })
        .in("id", listingIdsToRestore)
        .is("deleted_at", null);

      if (listingErr) {
        console.warn("[seller-cancel] listing update error:", listingErr);
      } else {
        console.log(`[seller-cancel] Successfully restored ${listingIdsToRestore.length} listing(s)`);
      }
    }

    // Determine item count for notification text
    const itemCount = listingIdsToRestore.length || 1;
    const itemText = itemCount > 1 
      ? `${itemCount} items` 
      : `"${order.listing_title || 'Fabric'}"`;

    // Create in-app notification for buyer
    if (order.buyer_id) {
      await supabase.from("notifications").insert({
        user_id: order.buyer_id,
        type: "order_cancelled",
        kind: "cancelled",
        title: "Order Cancelled by Seller",
        body: `Your order for ${itemText} has been cancelled by the seller. A refund of $${(order.total_cents / 100).toFixed(2)} will be processed to your original payment method.`,
        href: "/purchases.html",
        created_at: now
      });
    }

    // Email buyer about cancellation
    if (order.buyer_email) {
      const refundAmount = (order.total_cents / 100).toFixed(2);
      const itemDescription = itemCount > 1 
        ? `<strong>${itemCount} items</strong>` 
        : `<strong>"${order.listing_title || 'Fabric'}"</strong>`;
      
      await sendEmail(
        order.buyer_email,
        "📦 Order Cancelled - Hemline Market",
        `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f7; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f7; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #991b1b, #7f1d1d); padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">Order Cancelled</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #374151; font-size: 16px; line-height: 1.6;">
                Hi there,
              </p>
              <p style="margin: 0 0 20px; color: #374151; font-size: 16px; line-height: 1.6;">
                The seller has cancelled your order for ${itemDescription}.
              </p>
              
              <!-- Refund Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ecfdf5; border-radius: 8px; margin: 24px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="margin: 0 0 8px; color: #065f46; font-size: 14px; font-weight: 600;">REFUND AMOUNT</p>
                    <p style="margin: 0; color: #065f46; font-size: 28px; font-weight: 700;">$${refundAmount}</p>
                    <p style="margin: 12px 0 0; color: #047857; font-size: 14px;">
                      Your refund has been processed and should appear in your account within 5-10 business days.
                    </p>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 24px 0; color: #374151; font-size: 16px; line-height: 1.6;">
                We're sorry this order didn't work out. There's plenty more beautiful fabric waiting for you!
              </p>
              
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="https://hemlinemarket.com/browse.html" style="display: inline-block; background: #991b1b; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Continue Shopping</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 24px 40px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #6b7280; font-size: 14px; text-align: center;">
                Questions? Reply to this email or visit our <a href="https://hemlinemarket.com/help.html" style="color: #991b1b;">Help Center</a>
              </p>
              <p style="margin: 12px 0 0; color: #9ca3af; font-size: 12px; text-align: center;">
                © ${new Date().getFullYear()} Hemline Market. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
        `Your order for ${itemCount > 1 ? itemCount + ' items' : '"' + (order.listing_title || 'Fabric') + '"'} has been cancelled by the seller. A refund of $${refundAmount} is being processed to your original payment method. Refunds typically appear within 5-10 business days.`
      );
    }

    return res.status(200).json({ 
      success: true,
      refund_id: refundId,
      listings_restored: listingIdsToRestore.length,
      label_voided: labelVoidResult.voided,
      message: "Order cancelled successfully"
    });

  } catch (e) {
    console.error("Seller cancel error:", e);
    return res.status(500).json({ error: e.message });
  }
}

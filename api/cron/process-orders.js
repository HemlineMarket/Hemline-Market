// File: api/cron/process-orders.js
// Vercel Cron Job - runs daily to:
// 1. Send reminder emails to sellers who haven't shipped (Day 3)
// 2. Notify buyers they can cancel if order not shipped (Day 5)
// 3. Auto-release payment to seller's WALLET 3 days after delivery confirmed
//
// Add to vercel.json:
// { "crons": [{ "path": "/api/cron/process-orders", "schedule": "0 9 * * *" }] }
//
// ENV: CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POSTMARK_SERVER_TOKEN, INTERNAL_WEBHOOK_SECRET

import { createClient } from "@supabase/supabase-js";

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

// Credit seller's wallet using the wallet API
async function creditSellerWallet(sellerId, amountCents, orderId, description) {
  const baseUrl = process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}` 
    : process.env.NEXT_PUBLIC_SITE_URL || 'https://hemlinemarket.com';
  
  const response = await fetch(`${baseUrl}/api/wallet/credit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': process.env.INTERNAL_WEBHOOK_SECRET
    },
    body: JSON.stringify({
      seller_id: sellerId,
      amount_cents: amountCents,
      order_id: orderId,
      description: description || 'Sale proceeds'
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Wallet credit failed: ${response.status}`);
  }

  return response.json();
}

export default async function handler(req, res) {
  // Verify cron secret (Vercel sends this automatically for cron jobs)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = getSupabaseAdmin();
  const now = new Date();
  const results = { reminders: 0, buyerNotifications: 0, payouts: 0, errors: [] };

  try {
    // =========================================================
    // 1. SEND REMINDERS TO SELLERS WHO HAVEN'T SHIPPED (Day 3)
    // =========================================================
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: unshippedOrders3Days } = await supabase
      .from("orders")
      .select("*, seller:profiles!seller_id(first_name, last_name, contact_email)")
      .eq("status", "PAID")
      .is("shipped_at", null)
      .lt("created_at", threeDaysAgo)
      .is("reminder_sent_at", null);

    for (const order of unshippedOrders3Days || []) {
      try {
        const sellerEmail = order.seller?.contact_email;
        if (sellerEmail) {
          await sendEmail(
            sellerEmail,
            "⏰ Reminder: Please ship your order",
            `<h2>Shipping Reminder</h2>
            <p>Your order for <strong>"${order.listing_title}"</strong> hasn't been shipped yet.</p>
            <p>Please ship within <strong>2 more days</strong> to avoid the buyer being able to cancel.</p>
            ${order.label_url ? `<p><a href="${order.label_url}" style="background:#991b1b;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;">Download Shipping Label</a></p>` : ''}
            <p>Thank you!<br>Hemline Market</p>`,
            `Reminder: Your order for "${order.listing_title}" hasn't been shipped. Please ship within 2 more days.`
          );
          
          await supabase.from("orders").update({ reminder_sent_at: now.toISOString() }).eq("id", order.id);
          results.reminders++;
        }
      } catch (e) {
        results.errors.push({ type: "reminder", orderId: order.id, error: e.message });
      }
    }

    // =========================================================
    // 2. NOTIFY BUYERS THEY CAN CANCEL (Day 5, not shipped)
    // =========================================================
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const { data: unshippedOrders5Days } = await supabase
      .from("orders")
      .select("*")
      .eq("status", "PAID")
      .is("shipped_at", null)
      .lt("created_at", fiveDaysAgo)
      .is("buyer_cancel_notified_at", null);

    for (const order of unshippedOrders5Days || []) {
      try {
        if (order.buyer_id) {
          // In-app notification to buyer
          await supabase.from("notifications").insert({
            user_id: order.buyer_id,
            type: "order",
            kind: "order",
            title: "Your order hasn't shipped yet",
            body: `"${order.listing_title}" hasn't shipped in 5 days. You can cancel for a full refund if you'd like.`,
            href: `/order-buyer.html?id=${order.id}`,
          });

          // Mark that we notified the buyer (so we don't spam them daily)
          await supabase.from("orders").update({ 
            buyer_cancel_notified_at: now.toISOString() 
          }).eq("id", order.id);

          results.buyerNotifications++;
        }
      } catch (e) {
        results.errors.push({ type: "buyerNotification", orderId: order.id, error: e.message });
      }
    }

    // =========================================================
    // 3. AUTO-RELEASE PAYMENT TO WALLET 3 DAYS AFTER DELIVERY
    // =========================================================
    const threeDaysAfterDelivery = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: deliveredOrders } = await supabase
      .from("orders")
      .select("*, seller:profiles!seller_id(first_name, last_name, contact_email)")
      .eq("status", "DELIVERED")
      .is("payout_at", null)
      .lt("delivered_at", threeDaysAfterDelivery);

    for (const order of deliveredOrders || []) {
      try {
        // Get seller's fee rate
        const { data: sellerProfile } = await supabase
          .from("profiles")
          .select("fee_rate, founding_seller_number")
          .eq("id", order.seller_id)
          .maybeSingle();

        // Use seller's fee rate (founding sellers = 9%, standard = 13%)
        // Default to 13% if fee_rate not set
        const platformFeePercent = sellerProfile?.fee_rate || 0.13;
        const payoutAmount = Math.floor(order.items_cents * (1 - platformFeePercent));

        if (payoutAmount <= 0) {
          results.errors.push({ type: "payout", orderId: order.id, error: "Payout amount <= 0" });
          continue;
        }

        // Credit seller's wallet instead of Stripe transfer
        const walletResult = await creditSellerWallet(
          order.seller_id,
          payoutAmount,
          order.id,
          `Sale: ${order.listing_title || 'Order'}`
        );

        // Update order as paid out
        await supabase.from("orders").update({
          status: "COMPLETE",
          payout_at: now.toISOString(),
          payout_amount_cents: payoutAmount,
          wallet_transaction_id: walletResult.transaction_id,
          platform_fee_rate: platformFeePercent,
          platform_fee_cents: order.items_cents - payoutAmount,
        }).eq("id", order.id);

        // Notify seller
        const sellerEmail = order.seller?.contact_email;
        if (sellerEmail) {
          await sendEmail(
            sellerEmail,
            "💰 Payment Released - Hemline Market",
            `<h2>You've been paid!</h2>
            <p>Your earnings of <strong>$${(payoutAmount / 100).toFixed(2)}</strong> for order "${order.listing_title}" have been added to your Hemline balance.</p>
            <p>You can use this balance to shop on Hemline Market or withdraw to your bank account from your <a href="https://hemlinemarket.com/account.html">Account page</a>.</p>
            <p>Thank you for selling on Hemline Market!</p>`,
            `Earnings of $${(payoutAmount / 100).toFixed(2)} for "${order.listing_title}" have been added to your Hemline balance. Visit your Account page to withdraw or shop.`
          );
        }

        // In-app notification
        await supabase.from("notifications").insert({
          user_id: order.seller_id,
          type: "payout",
          kind: "payout",
          title: "Payment released! 💰",
          body: `$${(payoutAmount / 100).toFixed(2)} for "${order.listing_title}" has been added to your balance. Withdraw or shop anytime!`,
          href: "/account.html",
        });

        results.payouts++;
      } catch (e) {
        results.errors.push({ type: "payout", orderId: order.id, error: e.message });
      }
    }

    return res.status(200).json({ success: true, ...results });
  } catch (e) {
    console.error("Cron error:", e);
    return res.status(500).json({ error: e.message });
  }
}

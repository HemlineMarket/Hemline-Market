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
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

// HTML escape function to prevent injection in emails
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
          const safeTitle = escapeHtml(order.listing_title);
          const safeLabelUrl = escapeHtml(order.label_url);
          await sendEmail(
            sellerEmail,
            "⏰ Reminder: Please ship your order",
            `<h2>Shipping Reminder</h2>
            <p>Your order for <strong>"${safeTitle}"</strong> hasn't been shipped yet.</p>
            <p>Please ship within <strong>2 more days</strong> to avoid the buyer being able to cancel.</p>
            ${order.label_url ? `<p><a href="${safeLabelUrl}" style="background:#991b1b;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;">Download Shipping Label</a></p>` : ''}
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
    // 2. NOTIFY BUYERS THEY CAN CANCEL (after 5 business days, not shipped)
    // =========================================================
    // Use 7 calendar days to guarantee at least 5 business days have passed
    // (worst case: order placed Saturday, 7 calendar days later = following Saturday = 5 weekdays)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: unshippedOrders5Days } = await supabase
      .from("orders")
      .select("*")
      .eq("status", "PAID")
      .is("shipped_at", null)
      .lt("created_at", sevenDaysAgo)
      .is("buyer_cancel_notified_at", null);

    for (const order of unshippedOrders5Days || []) {
      try {
        if (order.buyer_id) {
          const safeCronTitle = escapeHtml(order.listing_title);
          // In-app notification to buyer
          await supabase.from("notifications").insert({
            user_id: order.buyer_id,
            type: "order",
            kind: "order",
            title: "Your order hasn't shipped yet",
            body: `"${safeCronTitle}" hasn't shipped in 5 business days. You can cancel for a full refund if you'd like.`,
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
    // 3. PAY THE SELLER
    //    Released when the buyer confirms receipt (status COMPLETE,
    //    buyer_accepted_at set) OR 3 days after tracking shows
    //    delivered. Paid by Stripe transfer to the seller's
    //    connected account; Stripe pays out to their bank from there.
    // =========================================================
    const threeDaysAfterDelivery = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: deliveredOrders } = await supabase
      .from("orders")
      .select("*, seller:profiles!seller_id(first_name, last_name, contact_email)")
      .is("payout_at", null)
      .or(`and(status.eq.COMPLETE,buyer_accepted_at.not.is.null),and(status.eq.DELIVERED,delivered_at.lt.${threeDaysAfterDelivery})`);

    for (const order of deliveredOrders || []) {
      try {
        // Seller's fee rate and Stripe account
        const { data: sellerProfile } = await supabase
          .from("profiles")
          .select("fee_rate, stripe_account_id, payouts_enabled")
          .eq("id", order.seller_id)
          .maybeSingle();

        // Platform fee rate from the seller profile
        // Default to 13% if fee_rate not set
        const platformFeePercent = sellerProfile?.fee_rate || 0.13;
        const payoutAmount = Math.floor(order.items_cents * (1 - platformFeePercent));

        if (payoutAmount <= 0) {
          results.errors.push({ type: "payout", orderId: order.id, error: "Payout amount <= 0" });
          continue;
        }

        // Pay the seller. Stripe transfer to their connected account
        // (idempotent per order), falling back to the wallet only if the
        // seller somehow has no payable Stripe account.
        let walletTransactionId = null;
        let paidVia = "stripe";
        if (sellerProfile?.stripe_account_id && sellerProfile?.payouts_enabled !== false) {
          await stripe.transfers.create(
            {
              amount: payoutAmount,
              currency: "usd",
              destination: sellerProfile.stripe_account_id,
              description: `Hemline Market sale: ${order.listing_title || "Order"}`,
              metadata: { order_id: order.id, seller_id: order.seller_id },
            },
            { idempotencyKey: `payout_${order.id}` }
          );
        } else {
          paidVia = "wallet";
          const walletResult = await creditSellerWallet(
            order.seller_id,
            payoutAmount,
            order.id,
            `Sale: ${order.listing_title || "Order"}`
          );
          walletTransactionId = walletResult.transaction_id;
        }

        // Update order as paid out
        await supabase.from("orders").update({
          status: "COMPLETE",
          payout_at: now.toISOString(),
          payout_amount_cents: payoutAmount,
          wallet_transaction_id: walletTransactionId,
          platform_fee_rate: platformFeePercent,
          platform_fee_cents: order.items_cents - payoutAmount,
        }).eq("id", order.id);

        // Notify seller
        const sellerEmail = order.seller?.contact_email;
        if (sellerEmail) {
          const safePayoutTitle = escapeHtml(order.listing_title);
          await sendEmail(
            sellerEmail,
            "💰 Payment Released - Hemline Market",
            paidVia === "stripe"
              ? `<h2>You've been paid!</h2>
            <p>Your earnings of <strong>$${(payoutAmount / 100).toFixed(2)}</strong> for order "${safePayoutTitle}" have been sent to your bank through Stripe. They usually arrive in 2 to 3 business days.</p>
            <p>Thank you for selling on Hemline Market!</p>`
              : `<h2>You've been paid!</h2>
            <p>Your earnings of <strong>$${(payoutAmount / 100).toFixed(2)}</strong> for order "${safePayoutTitle}" have been added to your Hemline balance. Withdraw to your bank from your <a href="https://hemlinemarket.com/account.html">Account page</a>.</p>`,
            paidVia === "stripe"
              ? `Earnings of $${(payoutAmount / 100).toFixed(2)} for "${order.listing_title}" have been sent to your bank through Stripe. They usually arrive in 2 to 3 business days.`
              : `Earnings of $${(payoutAmount / 100).toFixed(2)} for "${order.listing_title}" have been added to your Hemline balance. Visit your Account page to withdraw.`
          );
        }

        // In-app notification
        await supabase.from("notifications").insert({
          user_id: order.seller_id,
          type: "payout",
          kind: "payout",
          title: "Payment released! 💰",
          body: paidVia === "stripe"
            ? `$${(payoutAmount / 100).toFixed(2)} for "${escapeHtml(order.listing_title)}" is on its way to your bank. Usually 2 to 3 business days.`
            : `$${(payoutAmount / 100).toFixed(2)} for "${escapeHtml(order.listing_title)}" has been added to your balance. Withdraw anytime.`,
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

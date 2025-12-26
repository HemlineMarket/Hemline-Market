// File: api/cron/process-orders.js
// Vercel Cron Job - runs daily to:
// 1. Mark orders as cancel-eligible after 5 days if not shipped
// 2. Auto-release payment to seller 3 days after delivery confirmed
// 3. Send reminder emails to sellers who haven't shipped
//
// Add to vercel.json:
// { "crons": [{ "path": "/api/cron/process-orders", "schedule": "0 9 * * *" }] }
//
// ENV: CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, POSTMARK_SERVER_TOKEN

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
  // Verify cron secret (Vercel sends this automatically for cron jobs)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = getSupabaseAdmin();
  const now = new Date();
  const results = { reminders: 0, payouts: 0, errors: [] };

  try {
    // =========================================================
    // 1. SEND REMINDERS TO SELLERS WHO HAVEN'T SHIPPED (Day 3)
    // =========================================================
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: unshippedOrders } = await supabase
      .from("orders")
      .select("*, seller:profiles!seller_id(first_name, last_name, contact_email)")
      .eq("status", "PAID")
      .is("shipped_at", null)
      .lt("created_at", threeDaysAgo)
      .is("reminder_sent_at", null);

    for (const order of unshippedOrders || []) {
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
    // 2. AUTO-RELEASE PAYMENT 3 DAYS AFTER DELIVERY
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
        // Get seller's Stripe Connect account and fee rate
        const { data: sellerProfile } = await supabase
          .from("profiles")
          .select("stripe_account_id, fee_rate, founding_seller_number")
          .eq("id", order.seller_id)
          .maybeSingle();

        if (!sellerProfile?.stripe_account_id) {
          results.errors.push({ type: "payout", orderId: order.id, error: "No Stripe account" });
          continue;
        }

        // Use seller's fee rate (founding sellers = 9%, standard = 13%)
        // Default to 13% if fee_rate not set
        const platformFeePercent = sellerProfile.fee_rate || 0.13;
        const payoutAmount = Math.floor(order.items_cents * (1 - platformFeePercent));

        if (payoutAmount <= 0) {
          results.errors.push({ type: "payout", orderId: order.id, error: "Payout amount <= 0" });
          continue;
        }

        // Create Stripe Transfer to seller
        const transfer = await stripe.transfers.create({
          amount: payoutAmount,
          currency: "usd",
          destination: sellerProfile.stripe_account_id,
          description: `Hemline order ${order.short_id || order.id}`,
          transfer_group: order.id,
        });

        // Update order as paid out
        await supabase.from("orders").update({
          status: "COMPLETE",
          payout_at: now.toISOString(),
          payout_amount_cents: payoutAmount,
          stripe_transfer_id: transfer.id,
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
            <p>Your payment of <strong>$${(payoutAmount / 100).toFixed(2)}</strong> for order "${order.listing_title}" has been released to your account.</p>
            <p>Thank you for selling on Hemline Market!</p>`,
            `Payment of $${(payoutAmount / 100).toFixed(2)} for "${order.listing_title}" has been released.`
          );
        }

        // In-app notification
        await supabase.from("notifications").insert({
          user_id: order.seller_id,
          type: "payout",
          kind: "payout",
          title: "Payment released! 💰",
          body: `$${(payoutAmount / 100).toFixed(2)} for "${order.listing_title}" has been sent to your account.`,
          href: "/sales.html",
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

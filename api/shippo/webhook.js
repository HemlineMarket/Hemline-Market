// File: api/shippo/webhook.js
// Shippo webhook - updates tracking status and triggers delivery flow
// POST URL: https://hemlinemarket.com/api/shippo/webhook?secret=YOUR_SECRET
//
// When package is delivered:
// 1. Updates order status to DELIVERED
// 2. Notifies buyer
// 3. Starts 3-day countdown to auto-release payment

import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } };

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
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

function normalizeStatus(s = "") {
  const up = s.toUpperCase();
  if (up.includes("DELIVER")) return "DELIVERED";
  if (up.includes("TRANSIT") || up.includes("ACCEPTED")) return "IN_TRANSIT";
  if (up.includes("FAIL") || up.includes("EXCEPT") || up.includes("RETURN")) return "EXCEPTION";
  return "IN_TRANSIT";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verify secret
  if (req.query.secret !== process.env.SHIPPO_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ACK immediately so Shippo doesn't retry
  res.status(200).json({ received: true });

  try {
    const payload = await readBody(req);
    const supabase = getSupabaseAdmin();
    const now = new Date();

    const eventType = payload?.event || "";
    const data = payload?.data || payload;

    // Extract tracking number
    const trackingNumber = 
      data?.tracking_number || 
      data?.tracking?.tracking_number ||
      data?.object?.tracking_number ||
      null;

    if (!trackingNumber) {
      console.log("Shippo webhook: no tracking number found");
      return;
    }

    // Get tracking status
    const trackingStatus = data?.tracking_status || data?.tracking?.tracking_status || {};
    const status = normalizeStatus(trackingStatus?.status || trackingStatus?.object_state || "");

    console.log(`Shippo webhook: ${trackingNumber} -> ${status}`);

    // Update db_shipments
    await supabase.from("db_shipments").update({
      status,
      updated_at: now.toISOString(),
    }).eq("tracking_number", trackingNumber);

    // Find the order by tracking number
    const { data: order } = await supabase
      .from("orders")
      .select("*")
      .eq("tracking_number", trackingNumber)
      .maybeSingle();

    if (!order) {
      console.log(`Shippo webhook: no order found for ${trackingNumber}`);
      return;
    }

    // Update order shipping status
    const updates = { shipping_status: status };

    // === SHIPPED (IN_TRANSIT) ===
    if (status === "IN_TRANSIT" && !order.shipped_at) {
      updates.shipped_at = now.toISOString();
      updates.status = "SHIPPED";

      // Notify buyer
      if (order.buyer_id) {
        await supabase.from("notifications").insert({
          user_id: order.buyer_id,
          type: "shipped",
          kind: "shipped",
          title: "Your order has shipped! 📦",
          body: `"${order.listing_title}" is on its way.`,
          href: "/purchases.html",
        });
      }

      // Email buyer
      if (order.buyer_email) {
        await sendEmail(
          order.buyer_email,
          "📦 Your order has shipped! - Hemline Market",
          `<h2>Your order is on its way!</h2>
          <p><strong>"${order.listing_title}"</strong> has shipped.</p>
          <p><strong>Tracking:</strong> ${trackingNumber}</p>
          ${order.tracking_url ? `<p><a href="${order.tracking_url}" style="background:#991b1b;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;">Track Package</a></p>` : ''}
          <p>Hemline Market</p>`,
          `Your order "${order.listing_title}" has shipped. Tracking: ${trackingNumber}`
        );
      }
    }

    // === DELIVERED ===
    if (status === "DELIVERED" && order.status !== "DELIVERED") {
      updates.delivered_at = now.toISOString();
      updates.status = "DELIVERED";

      // Notify buyer
      if (order.buyer_id) {
        await supabase.from("notifications").insert({
          user_id: order.buyer_id,
          type: "delivered",
          kind: "delivered",
          title: "Your order was delivered! 🎉",
          body: `"${order.listing_title}" has been delivered. Enjoy your fabric!`,
          href: "/purchases.html",
        });
      }

      // Email buyer
      if (order.buyer_email) {
        await sendEmail(
          order.buyer_email,
          "🎉 Your order was delivered! - Hemline Market",
          `<h2>Your order has arrived!</h2>
          <p><strong>"${order.listing_title}"</strong> has been delivered.</p>
          <p>We hope you love your new fabric!</p>
          <p>If there are any issues, please <a href="https://hemlinemarket.com/contact.html">contact us</a> within 3 days.</p>
          <p>The seller will receive payment in 3 days unless you report an issue.</p>
          <p>Happy sewing!<br>Hemline Market</p>`,
          `Your order "${order.listing_title}" has been delivered!`
        );
      }

      // Notify seller
      if (order.seller_id) {
        await supabase.from("notifications").insert({
          user_id: order.seller_id,
          type: "delivered",
          kind: "delivered",
          title: "Order delivered! 📬",
          body: `"${order.listing_title}" was delivered. Payment will be released in 3 days.`,
          href: "/sales.html",
        });
      }
    }

    // Apply updates
    await supabase.from("orders").update(updates).eq("id", order.id);

  } catch (e) {
    console.error("Shippo webhook error:", e);
  }
}

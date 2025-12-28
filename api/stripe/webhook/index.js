// File: api/stripe/webhook/index.js
// Stripe webhook for Vercel - Full Poshmark-like flow:
// 1. Creates order
// 2. Auto-generates Shippo label
// 3. Emails label to seller (Postmark)
// 4. Emails confirmation to buyer (Postmark)
// 5. Creates in-app notifications

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) throw new Error("Missing Supabase env vars");
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Shipping tier: <3yd=$5, 3-10yd=$8, >10yd=$15 → estimate parcel size
function getParcelFromShippingCents(cents) {
  if (cents <= 500) return { length: 10, width: 8, height: 1, weight: 0.5 };
  if (cents <= 800) return { length: 12, width: 10, height: 3, weight: 2 };
  return { length: 14, width: 12, height: 5, weight: 5 };
}

// Create label via Shippo API
async function createShippoLabel(fromAddr, toAddr, parcel) {
  const SHIPPO_KEY = process.env.SHIPPO_API_KEY;
  if (!SHIPPO_KEY) return null;

  const shipRes = await fetch("https://api.goshippo.com/shipments/", {
    method: "POST",
    headers: { Authorization: `ShippoToken ${SHIPPO_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      address_from: fromAddr,
      address_to: toAddr,
      parcels: [{ ...parcel, distance_unit: "in", mass_unit: "lb" }],
      async: false,
    }),
  });
  const shipment = await shipRes.json();
  if (!shipment.rates?.length) return null;

  const rate = shipment.rates
    .filter(r => r.provider === "USPS")
    .sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount))[0] 
    || shipment.rates.sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount))[0];

  const txRes = await fetch("https://api.goshippo.com/transactions/", {
    method: "POST",
    headers: { Authorization: `ShippoToken ${SHIPPO_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ rate: rate.object_id, label_file_type: "PDF", async: false }),
  });
  const tx = await txRes.json();
  if (tx.status !== "SUCCESS") return null;

  return {
    label_url: tx.label_url,
    tracking_number: tx.tracking_number,
    tracking_url: tx.tracking_url_provider || tx.tracking_url,
    carrier: rate.provider,
    service: rate.servicelevel?.name,
  };
}

// Send email via Postmark
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

// Email label to seller
async function emailLabelToSeller(toEmail, labelUrl, trackingNumber, itemTitle, shipTo, priceCents) {
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;">
      <h1 style="color:#991b1b;">🎉 You made a sale!</h1>
      <p>Your item <strong>"${itemTitle}"</strong> just sold for <strong>$${(priceCents/100).toFixed(2)}</strong>.</p>
      
      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:16px;margin:20px 0;">
        <h3 style="margin:0 0 8px;color:#92400e;">⏱️ Important: 30-Minute Cancel Window</h3>
        <p style="margin:0;color:#92400e;font-size:14px;">The buyer has <strong>30 minutes</strong> from purchase to cancel their order. Please wait until this window closes before printing your label and shipping.</p>
      </div>
      
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px;margin:20px 0;">
        <h2 style="margin:0 0 12px;color:#166534;">📦 Your Prepaid Shipping Label</h2>
        <p><a href="${labelUrl}" style="background:#991b1b;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;">Download Label (PDF)</a></p>
        <p style="margin-top:12px;">Tracking: <strong>${trackingNumber}</strong></p>
      </div>
      
      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:16px;margin:20px 0;">
        <h3 style="margin:0 0 8px;color:#92400e;">Ship To:</h3>
        <p style="margin:0;">${shipTo.name}<br>${shipTo.line1}${shipTo.line2 ? '<br>' + shipTo.line2 : ''}<br>${shipTo.city}, ${shipTo.state} ${shipTo.zip}</p>
      </div>
      
      <p><strong>⏰ Please ship within 5 business days.</strong> After 5 days, the buyer can cancel for a full refund.</p>
      <p>Once delivered, your payment will be released within 3 days.</p>
      
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p style="color:#6b7280;font-size:14px;">Happy selling!<br><strong>Hemline Market</strong></p>
    </div>
  `;
  const text = `You made a sale!\n\n"${itemTitle}" sold for $${(priceCents/100).toFixed(2)}.\n\n⏱️ IMPORTANT: The buyer has 30 minutes from purchase to cancel. Please wait before printing your label.\n\nDownload label: ${labelUrl}\nTracking: ${trackingNumber}\n\nShip to:\n${shipTo.name}\n${shipTo.line1}\n${shipTo.city}, ${shipTo.state} ${shipTo.zip}\n\nPlease ship within 5 business days.`;
  
  await sendEmail(toEmail, "🎉 You made a sale! Your shipping label is ready", html, text);
}

// Email confirmation to buyer
async function emailConfirmationToBuyer(toEmail, itemTitle, totalCents, trackingNumber, shipTo) {
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;">
      <h1 style="color:#991b1b;">Order Confirmed! 🧵</h1>
      <p>Thank you for your purchase on Hemline Market.</p>
      
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:20px 0;">
        <h2 style="margin:0 0 12px;">Order Details</h2>
        <p><strong>Item:</strong> ${itemTitle}</p>
        <p><strong>Total:</strong> $${(totalCents/100).toFixed(2)}</p>
        ${trackingNumber ? `<p><strong>Tracking:</strong> ${trackingNumber}</p>` : ''}
      </div>
      
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:20px 0;">
        <h3 style="margin:0 0 8px;">Shipping To:</h3>
        <p style="margin:0;">${shipTo.name}<br>${shipTo.line1}${shipTo.line2 ? '<br>' + shipTo.line2 : ''}<br>${shipTo.city}, ${shipTo.state} ${shipTo.zip}</p>
      </div>
      
      <p>The seller has 5 business days to ship your order. You'll receive tracking updates via email.</p>
      <p>If the seller doesn't ship within 5 business days, you can cancel for a full refund.</p>
      
      <p><a href="https://hemlinemarket.com/purchases.html" style="background:#991b1b;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;">View Your Orders</a></p>
      
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p style="color:#6b7280;font-size:14px;">Questions? <a href="https://hemlinemarket.com/contact.html" style="color:#991b1b;">Contact us</a><br><strong>Hemline Market</strong></p>
    </div>
  `;
  const text = `Order Confirmed!\n\nItem: ${itemTitle}\nTotal: $${(totalCents/100).toFixed(2)}\n${trackingNumber ? 'Tracking: ' + trackingNumber + '\n' : ''}\nShipping to:\n${shipTo.name}\n${shipTo.line1}\n${shipTo.city}, ${shipTo.state} ${shipTo.zip}\n\nThe seller has 5 business days to ship. Visit hemlinemarket.com/purchases.html to view your orders.`;
  
  await sendEmail(toEmail, "✅ Order Confirmed - Hemline Market", html, text);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).send("Missing stripe-signature");

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  if (event.type !== "checkout.session.completed") {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  try {
    const supabase = getSupabaseAdmin();
    const session = event.data.object;
    const md = session.metadata || {};

    let listing = null;
    if (md.listing_id) {
      const { data } = await supabase.from("listings").select("*").eq("id", md.listing_id).maybeSingle();
      listing = data;
    }

    const sellerId = md.seller_id || listing?.seller_id;
    const listingTitle = md.title || listing?.title || "Fabric";
    const priceCents = Number(md.price_cents) || 0;
    const shippingCents = Number(md.shipping_cents) || 0;
    const totalCents = priceCents + shippingCents;
    const buyerEmail = session.customer_details?.email || md.buyer_email;

    const shipDetails = session.shipping_details || session.customer_details || {};
    const shipAddr = shipDetails.address || {};

    const order = {
      stripe_checkout_session: session.id,
      stripe_payment_intent: session.payment_intent,
      buyer_id: md.buyer_id || null,
      buyer_email: buyerEmail,
      seller_id: sellerId,
      listing_id: md.listing_id || null,
      items_cents: priceCents,
      shipping_cents: shippingCents,
      total_cents: totalCents,
      listing_title: listingTitle,
      status: "PAID",
      shipping_name: shipDetails.name || session.customer_details?.name,
      shipping_address_line1: shipAddr.line1,
      shipping_address_line2: shipAddr.line2,
      shipping_city: shipAddr.city,
      shipping_state: shipAddr.state,
      shipping_postal_code: shipAddr.postal_code,
      shipping_country: shipAddr.country || "US",
      cancel_eligible_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days from now
    };

    const { data: insertedOrder, error: insertErr } = await supabase.from("orders").insert(order).select().single();
    if (insertErr) {
      console.error("Order insert failed:", insertErr);
      return res.status(500).json({ error: "Order insert failed" });
    }

    if (md.listing_id) {
      await supabase.from("listings").update({ status: "SOLD", sold_at: new Date().toISOString() }).eq("id", md.listing_id);
    }

    let label = null;
    let sellerEmail = null;

    // === AUTO-GENERATE SHIPPING LABEL ===
    if (sellerId && shipAddr.line1) {
      const { data: sellerAuth } = await supabase.auth.admin.getUserById(sellerId);
      const meta = sellerAuth?.user?.user_metadata || {};
      
      const { data: sellerProfile } = await supabase.from("profiles").select("first_name, last_name, contact_email").eq("id", sellerId).maybeSingle();
      sellerEmail = sellerProfile?.contact_email || sellerAuth?.user?.email;
      const sellerName = [sellerProfile?.first_name, sellerProfile?.last_name].filter(Boolean).join(" ") || meta.ship_name || "Seller";

      if (meta.ship_address1 && meta.ship_city && meta.ship_state && meta.ship_postal) {
        const fromAddr = { name: sellerName, street1: meta.ship_address1, street2: meta.ship_address2 || "", city: meta.ship_city, state: meta.ship_state, zip: meta.ship_postal, country: "US" };
        const toAddr = { name: order.shipping_name || "Customer", street1: shipAddr.line1, street2: shipAddr.line2 || "", city: shipAddr.city, state: shipAddr.state, zip: shipAddr.postal_code, country: "US" };

        const parcel = getParcelFromShippingCents(shippingCents);
        label = await createShippoLabel(fromAddr, toAddr, parcel);

        if (label) {
          await supabase.from("orders").update({
            tracking_number: label.tracking_number,
            tracking_url: label.tracking_url,
            label_url: label.label_url,
            shipping_carrier: label.carrier,
            shipping_status: "LABEL_CREATED",
          }).eq("id", insertedOrder.id);

          await supabase.from("db_shipments").insert({
            order_id: insertedOrder.id,
            label_url: label.label_url,
            tracking_number: label.tracking_number,
            tracking_url: label.tracking_url,
            carrier: label.carrier,
            service: label.service,
            status: "LABEL_CREATED",
          });

          // Email label to seller
          await emailLabelToSeller(sellerEmail, label.label_url, label.tracking_number, listingTitle, {
            name: order.shipping_name, line1: shipAddr.line1, line2: shipAddr.line2, city: shipAddr.city, state: shipAddr.state, zip: shipAddr.postal_code,
          }, priceCents);
        }
      }
    }

    // Email confirmation to buyer
    if (buyerEmail) {
      await emailConfirmationToBuyer(buyerEmail, listingTitle, totalCents, label?.tracking_number, {
        name: order.shipping_name, line1: shipAddr.line1, line2: shipAddr.line2, city: shipAddr.city, state: shipAddr.state, zip: shipAddr.postal_code,
      });
    }

    // In-app notifications
    if (sellerId) {
      await supabase.from("notifications").insert({
        user_id: sellerId, type: "sale", kind: "sale",
        title: "You made a sale! 🎉",
        body: `"${listingTitle}" sold for $${(priceCents/100).toFixed(2)}. Check your email for the shipping label.`,
        href: "/sales.html",
      });
    }

    if (md.buyer_id) {
      await supabase.from("notifications").insert({
        user_id: md.buyer_id, type: "order", kind: "order",
        title: "Order confirmed!",
        body: `Your order for "${listingTitle}" is confirmed. The seller will ship it soon.`,
        href: "/purchases.html",
      });
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("Webhook error:", e);
    return res.status(500).json({ error: e.message });
  }
}

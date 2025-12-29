// File: api/stripe/webhook/index.js
// FIXED VERSION - Handles multiple items in cart
//
// Stripe webhook for Vercel - Full Poshmark-like flow:
// 1. Creates order
// 2. Auto-generates Shippo label
// 3. Emails label to seller (Postmark)
// 4. Emails confirmation to buyer (Postmark)
// 5. Creates in-app notifications
// 6. Handles label creation failures gracefully
// 7. FIX: Marks ALL listings as SOLD (not just first one)

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
// Returns { success: true, label: {...} } or { success: false, reason: "..." }
async function createShippoLabel(fromAddr, toAddr, parcel) {
  const SHIPPO_KEY = process.env.SHIPPO_API_KEY;
  if (!SHIPPO_KEY) {
    return { success: false, reason: "Shipping system not configured" };
  }

  try {
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
    
    if (!shipment.rates?.length) {
      console.error("Shippo: No rates returned", shipment);
      return { success: false, reason: "No shipping rates available for this address" };
    }

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
    
    if (tx.status !== "SUCCESS") {
      console.error("Shippo: Label purchase failed", tx);
      return { success: false, reason: tx.messages?.[0]?.text || "Label purchase failed" };
    }

    return {
      success: true,
      label: {
        label_url: tx.label_url,
        tracking_number: tx.tracking_number,
        tracking_url: tx.tracking_url_provider || tx.tracking_url,
        carrier: rate.provider,
        service: rate.servicelevel?.name,
      }
    };
  } catch (err) {
    console.error("Shippo: Exception", err);
    return { success: false, reason: "Shipping service temporarily unavailable" };
  }
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
    console.error("Postmark email error:", err);
  }
}

// Email label to seller (when label creation succeeds)
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

// Email seller when label creation fails - tells them to create manually
async function emailLabelFailedToSeller(toEmail, itemTitle, shipTo, priceCents, reason, orderId) {
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;">
      <h1 style="color:#991b1b;">🎉 You made a sale!</h1>
      <p>Your item <strong>"${itemTitle}"</strong> just sold for <strong>$${(priceCents/100).toFixed(2)}</strong>.</p>
      
      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:16px;margin:20px 0;">
        <h3 style="margin:0 0 8px;color:#92400e;">⏱️ Important: 30-Minute Cancel Window</h3>
        <p style="margin:0;color:#92400e;font-size:14px;">The buyer has <strong>30 minutes</strong> from purchase to cancel their order. Please wait until this window closes before shipping.</p>
      </div>
      
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:20px 0;">
        <h2 style="margin:0 0 12px;color:#b91c1c;">⚠️ Action Required: Create Shipping Label</h2>
        <p style="margin:0 0 12px;color:#7f1d1d;">We couldn't automatically generate your shipping label.</p>
        <p style="margin:0 0 12px;color:#7f1d1d;font-size:13px;">Reason: ${reason}</p>
        <p style="margin:0;"><a href="https://hemlinemarket.com/ship-order.html?order=${orderId}" style="background:#991b1b;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;">Create Label Now →</a></p>
      </div>
      
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:20px 0;">
        <h3 style="margin:0 0 8px;color:#374151;">Ship To:</h3>
        <p style="margin:0;">${shipTo.name}<br>${shipTo.line1}${shipTo.line2 ? '<br>' + shipTo.line2 : ''}<br>${shipTo.city}, ${shipTo.state} ${shipTo.zip}</p>
      </div>
      
      <p><strong>⏰ Please ship within 5 business days.</strong> After 5 days, the buyer can cancel for a full refund.</p>
      <p>Once delivered, your payment will be released within 3 days.</p>
      
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p style="color:#6b7280;font-size:14px;">Need help? <a href="https://hemlinemarket.com/contact.html" style="color:#991b1b;">Contact support</a><br><strong>Hemline Market</strong></p>
    </div>
  `;
  const text = `You made a sale!\n\n"${itemTitle}" sold for $${(priceCents/100).toFixed(2)}.\n\n⏱️ IMPORTANT: The buyer has 30 minutes from purchase to cancel. Please wait before shipping.\n\n⚠️ ACTION REQUIRED: We couldn't automatically create your shipping label.\nReason: ${reason}\n\nPlease create your label at: https://hemlinemarket.com/ship-order.html?order=${orderId}\n\nShip to:\n${shipTo.name}\n${shipTo.line1}\n${shipTo.city}, ${shipTo.state} ${shipTo.zip}\n\nPlease ship within 5 business days.`;
  
  await sendEmail(toEmail, "🎉 You made a sale! Action required: Create shipping label", html, text);
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

    // FIX: Get ALL listing IDs from metadata (supports multi-item carts)
    const allListingIds = (md.listing_ids || md.listing_id || "")
      .split(",")
      .map(id => id.trim())
      .filter(Boolean);
    
    // Get first listing for display purposes
    let listing = null;
    if (allListingIds.length > 0) {
      const { data } = await supabase.from("listings").select("*").eq("id", allListingIds[0]).maybeSingle();
      listing = data;
    }

    const sellerId = md.seller_id || listing?.seller_id;
    const listingTitle = md.title || listing?.title || "Fabric";
    const listingImage = md.image_url || listing?.image_url_1 || "";
    const priceCents = Number(md.price_cents) || 0;
    const shippingCents = Number(md.shipping_cents) || 0;
    const totalCents = priceCents + shippingCents;
    const buyerEmail = session.customer_details?.email || md.buyer_email;
    const itemCount = Number(md.item_count) || allListingIds.length || 1;

    const shipDetails = session.shipping_details || session.customer_details || {};
    const shipAddr = shipDetails.address || {};

    // For multi-item orders, update the title to show count
    const displayTitle = itemCount > 1 
      ? `${listingTitle} + ${itemCount - 1} more item${itemCount > 2 ? 's' : ''}`
      : listingTitle;

    const order = {
      stripe_checkout_session: session.id,
      stripe_payment_intent: session.payment_intent,
      buyer_id: md.buyer_id || null,
      buyer_email: buyerEmail,
      seller_id: sellerId,
      listing_id: allListingIds[0] || null,  // Primary listing ID
      listing_ids: allListingIds.length > 0 ? allListingIds : null,  // FIX: Store ALL listing IDs
      items_cents: priceCents,
      shipping_cents: shippingCents,
      total_cents: totalCents,
      listing_title: displayTitle,
      listing_image: listingImage,
      status: "PAID",
      shipping_name: shipDetails.name || session.customer_details?.name,
      shipping_address_line1: shipAddr.line1,
      shipping_address_line2: shipAddr.line2,
      shipping_city: shipAddr.city,
      shipping_state: shipAddr.state,
      shipping_postal_code: shipAddr.postal_code,
      shipping_country: shipAddr.country || "US",
      cancel_eligible_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days from now
      item_count: itemCount,
    };

    const { data: insertedOrder, error: insertErr } = await supabase.from("orders").insert(order).select().single();
    if (insertErr) {
      console.error("Order insert failed:", insertErr);
      return res.status(500).json({ error: "Order insert failed" });
    }

    // FIX: Mark ALL listings as SOLD (not just the first one)
    if (allListingIds.length > 0) {
      const { error: updateErr } = await supabase.from("listings").update({ 
        status: "SOLD", 
        yards_available: 0,
        sold_at: new Date().toISOString() 
      }).in("id", allListingIds);
      
      if (updateErr) {
        console.error("Failed to mark listings as SOLD:", updateErr);
      } else {
        console.log(`Marked ${allListingIds.length} listing(s) as SOLD:`, allListingIds);
      }
    }

    let labelResult = { success: false, reason: "No seller address configured" };
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
        labelResult = await createShippoLabel(fromAddr, toAddr, parcel);

        if (labelResult.success) {
          const label = labelResult.label;
          
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
          await emailLabelToSeller(sellerEmail, label.label_url, label.tracking_number, displayTitle, {
            name: order.shipping_name, line1: shipAddr.line1, line2: shipAddr.line2, city: shipAddr.city, state: shipAddr.state, zip: shipAddr.postal_code,
          }, priceCents);
        }
      } else {
        labelResult = { success: false, reason: "Please update your shipping address in Account settings" };
      }
    }

    // If label creation failed, notify seller to create manually
    if (!labelResult.success && sellerEmail) {
      await supabase.from("orders").update({
        shipping_status: "LABEL_PENDING",
      }).eq("id", insertedOrder.id);

      await emailLabelFailedToSeller(sellerEmail, displayTitle, {
        name: order.shipping_name, line1: shipAddr.line1, line2: shipAddr.line2, city: shipAddr.city, state: shipAddr.state, zip: shipAddr.postal_code,
      }, priceCents, labelResult.reason, insertedOrder.id);
    }

    // Email confirmation to buyer
    if (buyerEmail) {
      const trackingNumber = labelResult.success ? labelResult.label.tracking_number : null;
      await emailConfirmationToBuyer(buyerEmail, displayTitle, totalCents, trackingNumber, {
        name: order.shipping_name, line1: shipAddr.line1, line2: shipAddr.line2, city: shipAddr.city, state: shipAddr.state, zip: shipAddr.postal_code,
      });
    }

    // In-app notifications
    if (sellerId) {
      const notifBody = labelResult.success 
        ? `"${displayTitle}" sold for $${(priceCents/100).toFixed(2)}. Check your email for the shipping label.`
        : `"${displayTitle}" sold for $${(priceCents/100).toFixed(2)}. Action needed: Create your shipping label.`;
      
      await supabase.from("notifications").insert({
        user_id: sellerId, type: "sale", kind: "sale",
        title: "You made a sale! 🎉",
        body: notifBody,
        href: labelResult.success ? "/sales.html" : `/ship-order.html?order=${insertedOrder.id}`,
      });
    }

    if (md.buyer_id) {
      await supabase.from("notifications").insert({
        user_id: md.buyer_id, type: "order", kind: "order",
        title: "Order confirmed!",
        body: `Your order for "${displayTitle}" is confirmed. The seller will ship it soon.`,
        href: "/purchases.html",
      });
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("Webhook error:", e);
    return res.status(500).json({ error: e.message });
  }
}

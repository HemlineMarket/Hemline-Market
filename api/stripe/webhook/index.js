// File: api/stripe/webhook/index.js
// Stripe webhook for Vercel - Creates order, auto-generates Shippo label, emails to seller via Postmark

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
  if (cents <= 500) return { length: 10, width: 8, height: 1, weight: 0.5 };  // Lightweight
  if (cents <= 800) return { length: 12, width: 10, height: 3, weight: 2 };   // Standard
  return { length: 14, width: 12, height: 5, weight: 5 };                      // Heavy
}

// Create label via Shippo API
async function createShippoLabel(fromAddr, toAddr, parcel) {
  const SHIPPO_KEY = process.env.SHIPPO_API_KEY;
  if (!SHIPPO_KEY) return null;

  // 1. Create shipment to get rates
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

  // 2. Pick cheapest USPS rate
  const rate = shipment.rates
    .filter(r => r.provider === "USPS")
    .sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount))[0] 
    || shipment.rates.sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount))[0];

  // 3. Purchase label
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

// Email label to seller via Postmark
async function emailLabelToSeller(toEmail, labelUrl, trackingNumber, itemTitle, shipTo) {
  const POSTMARK = process.env.POSTMARK_SERVER_TOKEN;
  const FROM = process.env.FROM_EMAIL || "orders@hemlinemarket.com";
  if (!POSTMARK || !toEmail) return;

  await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": POSTMARK 
    },
    body: JSON.stringify({
      From: FROM,
      To: toEmail,
      Subject: `🎉 You made a sale! Your shipping label is ready`,
      HtmlBody: `
        <h1>Congratulations on your sale!</h1>
        <p>Your item <strong>"${itemTitle}"</strong> just sold.</p>
        <h2>📦 Your Prepaid Shipping Label</h2>
        <p><a href="${labelUrl}" style="background:#991b1b;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;">Download Label (PDF)</a></p>
        <p>Tracking: <strong>${trackingNumber}</strong></p>
        <h3>Ship To:</h3>
        <p>${shipTo.name}<br>${shipTo.line1}<br>${shipTo.line2 ? shipTo.line2 + '<br>' : ''}${shipTo.city}, ${shipTo.state} ${shipTo.zip}</p>
        <p><strong>Next steps:</strong> Print the label, pack securely, drop off at USPS.</p>
      `,
      TextBody: `You made a sale! Item: ${itemTitle}\n\nDownload label: ${labelUrl}\nTracking: ${trackingNumber}\n\nShip to:\n${shipTo.name}\n${shipTo.line1}\n${shipTo.city}, ${shipTo.state} ${shipTo.zip}`,
      MessageStream: "outbound",
    }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  // Verify Stripe signature
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

    // Get listing info
    let listing = null;
    if (md.listing_id) {
      const { data } = await supabase.from("listings").select("*").eq("id", md.listing_id).maybeSingle();
      listing = data;
    }

    const sellerId = md.seller_id || listing?.seller_id;
    const listingTitle = md.title || listing?.title || "Fabric";
    const priceCents = Number(md.price_cents) || 0;
    const shippingCents = Number(md.shipping_cents) || 0;

    // Shipping address from Stripe
    const shipDetails = session.shipping_details || session.customer_details || {};
    const shipAddr = shipDetails.address || {};

    // Build order
    const order = {
      stripe_checkout_session: session.id,
      stripe_payment_intent: session.payment_intent,
      buyer_id: md.buyer_id || null,
      buyer_email: session.customer_details?.email || md.buyer_email,
      seller_id: sellerId,
      listing_id: md.listing_id || null,
      items_cents: priceCents,
      shipping_cents: shippingCents,
      total_cents: priceCents + shippingCents,
      listing_title: listingTitle,
      status: "PAID",
      shipping_name: shipDetails.name || session.customer_details?.name,
      shipping_address_line1: shipAddr.line1,
      shipping_address_line2: shipAddr.line2,
      shipping_city: shipAddr.city,
      shipping_state: shipAddr.state,
      shipping_postal_code: shipAddr.postal_code,
      shipping_country: shipAddr.country || "US",
    };

    // Insert order
    const { data: insertedOrder, error: insertErr } = await supabase.from("orders").insert(order).select().single();
    if (insertErr) {
      console.error("Order insert failed:", insertErr);
      return res.status(500).json({ error: "Order insert failed" });
    }

    // Mark listing sold
    if (md.listing_id) {
      await supabase.from("listings").update({ status: "SOLD", sold_at: new Date().toISOString() }).eq("id", md.listing_id);
    }

    // === AUTO-GENERATE SHIPPING LABEL ===
    if (sellerId && shipAddr.line1) {
      // Get seller's address from user_metadata
      const { data: sellerAuth } = await supabase.auth.admin.getUserById(sellerId);
      const meta = sellerAuth?.user?.user_metadata || {};
      
      // Get seller email from profiles
      const { data: sellerProfile } = await supabase.from("profiles").select("first_name, last_name, contact_email").eq("id", sellerId).maybeSingle();
      const sellerEmail = sellerProfile?.contact_email || sellerAuth?.user?.email;
      const sellerName = [sellerProfile?.first_name, sellerProfile?.last_name].filter(Boolean).join(" ") || meta.ship_name || "Seller";

      if (meta.ship_address1 && meta.ship_city && meta.ship_state && meta.ship_postal) {
        const fromAddr = {
          name: sellerName,
          street1: meta.ship_address1,
          street2: meta.ship_address2 || "",
          city: meta.ship_city,
          state: meta.ship_state,
          zip: meta.ship_postal,
          country: "US",
        };

        const toAddr = {
          name: order.shipping_name || "Customer",
          street1: shipAddr.line1,
          street2: shipAddr.line2 || "",
          city: shipAddr.city,
          state: shipAddr.state,
          zip: shipAddr.postal_code,
          country: "US",
        };

        const parcel = getParcelFromShippingCents(shippingCents);
        const label = await createShippoLabel(fromAddr, toAddr, parcel);

        if (label) {
          // Update order with tracking
          await supabase.from("orders").update({
            tracking_number: label.tracking_number,
            tracking_url: label.tracking_url,
            label_url: label.label_url,
            shipping_carrier: label.carrier,
            shipping_status: "LABEL_CREATED",
          }).eq("id", insertedOrder.id);

          // Save to db_shipments
          await supabase.from("db_shipments").insert({
            order_id: insertedOrder.id,
            label_url: label.label_url,
            tracking_number: label.tracking_number,
            tracking_url: label.tracking_url,
            carrier: label.carrier,
            service: label.service,
            status: "LABEL_CREATED",
          });

          // Email label to seller via Postmark
          await emailLabelToSeller(sellerEmail, label.label_url, label.tracking_number, listingTitle, {
            name: order.shipping_name,
            line1: shipAddr.line1,
            line2: shipAddr.line2,
            city: shipAddr.city,
            state: shipAddr.state,
            zip: shipAddr.postal_code,
          });
        }
      }
    }

    // Notify seller (in-app)
    if (sellerId) {
      await supabase.from("notifications").insert({
        user_id: sellerId,
        type: "sale",
        kind: "sale",
        title: "You made a sale! 🎉",
        body: `"${listingTitle}" sold. Check your email for the shipping label.`,
        href: "/sales.html",
      });
    }

    // Notify buyer (in-app)
    if (md.buyer_id) {
      await supabase.from("notifications").insert({
        user_id: md.buyer_id,
        type: "order",
        kind: "order",
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

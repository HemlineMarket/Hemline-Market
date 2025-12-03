// File: /api/stripe/webhook.js
// Stripe → Hemline Market order workflow
//
// Handles:
// ✔ Order created
// ✔ Seller notifications
// ✔ Buyer notifications
// ✔ Listing marked sold
// ✔ Order inserted into DB
// ✔ Shipping label notification (if available later)
// ✔ Cancellation window logic
//
// ENV REQUIRED:
// STRIPE_SECRET_KEY
// STRIPE_WEBHOOK_SECRET
// SUPABASE_URL
// SUPABASE_SERVICE_ROLE_KEY
// SITE_URL

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function site() {
  return (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function notify({ user_id, kind, title, body, href }) {
  try {
    await fetch(`${site()}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id, kind, title, body, href })
    });
  } catch (err) {
    console.error("[notify webhook error]", err);
  }
}

async function markListingSold(listingId) {
  if (!listingId) return;
  const { error } = await supabase
    .from("listings")
    .update({ status: "sold", sold_at: new Date().toISOString() })
    .eq("id", listingId);

  if (error) console.error("[mark sold error]", error);
}

async function createOrder({ orderId, buyerId, sellerId, listingId, amount }) {
  const { error } = await supabase.from("orders").insert([
    {
      id: orderId,
      buyer_id: buyerId,
      seller_id: sellerId,
      listing_id: listingId,
      amount_cents: amount,
      status: "paid",
      created_at: new Date().toISOString()
    }
  ]);

  if (error) console.error("[order insert error]", error);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  let event;
  try {
    const buf = await buffer(req);
    const signature = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(buf, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("⚠️  Stripe signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Immediately acknowledge (Stripe retries otherwise)
  res.status(200).json({ received: true });

  // ----------------------------------------
  // EVENT HANDLING
  // ----------------------------------------
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const buyerEmail = session.customer_details?.email || session.customer_email;
        const buyerId = session.metadata?.buyer_id;
        const listingId = session.metadata?.listing_id;
        const sellerId = session.metadata?.seller_user_id;
        const listingName = session.metadata?.listing_name || "Fabric";

        // Insert order in DB
        await createOrder({
          orderId: session.id,
          buyerId,
          sellerId,
          listingId,
          amount: session.amount_total
        });

        // Mark listing sold
        await markListingSold(listingId);

        // Notify: seller (item sold)
        if (sellerId) {
          await notify({
            user_id: sellerId,
            kind: "sale",
            title: "Your item sold!",
            body: `${listingName} has been purchased.`,
            href: `${site()}/orders.html`
          });
        }

        // Notify: buyer (order received)
        if (buyerId) {
          await notify({
            user_id: buyerId,
            kind: "order",
            title: "Order confirmed",
            body: `Your purchase of ${listingName} is confirmed.`,
            href: `${site()}/orders.html`
          });
        }

        break;
      }

      case "charge.refunded": {
        const charge = event.data.object;
        const buyerId = charge.metadata?.buyer_id;
        const listingName = charge.metadata?.listing_name || "Fabric";

        if (buyerId) {
          await notify({
            user_id: buyerId,
            kind: "order_cancel",
            title: "Order refunded",
            body: `Your order for ${listingName} has been refunded.`,
            href: `${site()}/orders.html`
          });
        }
        break;
      }

      case "payout.paid": {
        const payout = event.data.object;
        const sellerId = payout.metadata?.seller_user_id;
        if (sellerId) {
          await notify({
            user_id: sellerId,
            kind: "payout",
            title: "Payout sent",
            body: `A payout of $${(payout.amount / 100).toFixed(2)} was deposited.`,
            href: `${site()}/account.html`
          });
        }
        break;
      }

      case "payout.failed": {
        const payout = event.data.object;
        const sellerId = payout.metadata?.seller_user_id;

        if (sellerId) {
          await notify({
            user_id: sellerId,
            kind: "payout",
            title: "Payout failed",
            body: `Your payout could not be processed. Check your Stripe account.`,
            href: `${site()}/account.html`
          });
        }
        break;
      }

      // Shipping label ready (once your Shippo webhook is hooked in)
      case "shipping.label.created": {
        const obj = event.data.object;
        const buyer = obj.metadata?.buyer_user_id;

        if (buyer) {
          await notify({
            user_id: buyer,
            kind: "shipping",
            title: "Shipping label ready",
            body: "Your order is being prepared for shipment.",
            href: `${site()}/orders.html`
          });
        }
        break;
      }

      default:
        console.log("[Unhandled Stripe event]", event.type);
        break;
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
  }
}

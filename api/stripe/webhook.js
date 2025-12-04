// File: /api/stripe/webhook.js
// Verifies Stripe signatures, creates Transfers to connected sellers,
// writes db_orders, marks listings SOLD when possible,
// sends the buyer an order-confirmation email via /api/send-order-confirmation,
// and inserts notifications for buyer + seller.
//
// ENV: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SITE_URL (or NEXT_PUBLIC_SITE_URL),
//      SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import Stripe from "stripe";
import fetch from "node-fetch";
import supabaseAdmin from "../_supabaseAdmin";

// Let Stripe read the RAW body for signature verification
export const config = { api: { bodyParser: false } };

const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  throw new Error("STRIPE_SECRET_KEY is not set");
}

const stripe = new Stripe(stripeSecret, {
  apiVersion: "2023-10-16",
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
if (!webhookSecret) {
  throw new Error("STRIPE_WEBHOOK_SECRET is not set");
}

// Prefer SITE_URL, fall back to NEXT_PUBLIC_SITE_URL
const SITE_URL =
  process.env.SITE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://hemline.market";

// ------------ helpers ------------

function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function safeMeta(session) {
  const m = (session && session.metadata) || {};
  return m || {};
}

/**
 * Insert notifications for buyer + seller when an order is created.
 * Assumes notifications table has:
 *   user_id, actor_id, type, kind, title, body, href, link, created_at (default), read_at (nullable)
 */
async function insertOrderNotifications({ buyerId, sellerId, listingId, listingTitle }) {
  // If any critical piece is missing, bail quietly.
  if (!buyerId || !sellerId || !listingId) return;

  const safeTitle = listingTitle || "your listing";

  const sellerHref = `/listing.html?id=${encodeURIComponent(listingId)}`;
  const buyerHref = `/orders.html`;

  const rows = [
    {
      // Seller: "Your item has sold"
      user_id: sellerId,
      actor_id: buyerId,
      type: "order_sale",
      kind: "order",
      title: `Your item sold: “${safeTitle}”`,
      body: `Your item “${safeTitle}” was purchased.`,
      href: sellerHref,
      link: sellerHref,
    },
    {
      // Buyer: "Your order is confirmed"
      user_id: buyerId,
      actor_id: sellerId,
      type: "order_purchase",
      kind: "order",
      title: `Order confirmed: “${safeTitle}”`,
      body: `Your order for “${safeTitle}” is confirmed.`,
      href: buyerHref,
      link: buyerHref,
    },
  ];

  try {
    const { error } = await supabaseAdmin.from("notifications").insert(rows);
    if (error) {
      console.warn("[webhook] notifications insert error", error);
    }
  } catch (err) {
    console.warn("[webhook] notifications insert exception", err);
  }
}

/**
 * Mark listing as SOLD in Supabase (best-effort).
 */
async function markListingSold(listingId) {
  if (!listingId) return;
  try {
    const { error } = await supabaseAdmin
      .from("listings")
      .update({ status: "SOLD", updated_at: new Date().toISOString() })
      .eq("id", listingId)
      .is("deleted_at", null);

    if (error) {
      console.warn("[webhook] markListingSold error", error);
    }
  } catch (err) {
    console.warn("[webhook] markListingSold exception", err);
  }
}

/**
 * Create or update an order row in db_orders.
 * Assumes db_orders has at least:
 *   stripe_session_id (unique), buyer_id, seller_id, listing_id, amount_total, currency, status
 */
async function upsertOrderFromSession(session) {
  const meta = safeMeta(session);

  const listingId = meta.listing_id || meta.listingId || null;
  const listingTitle = meta.listing_title || meta.listingTitle || "";
  const buyerId = meta.buyer_id || meta.buyerId || null;
  const sellerId = meta.seller_id || meta.sellerId || null;

  const amountTotal = session.amount_total || 0;
  const currency = session.currency || "usd";
  const stripeSessionId = session.id;
  const stripePaymentIntent = session.payment_intent || null;

  const orderPayload = {
    stripe_session_id: stripeSessionId,
    stripe_payment_intent: stripePaymentIntent,
    buyer_id: buyerId,
    seller_id: sellerId,
    listing_id: listingId,
    listing_title: listingTitle || null,
    amount_total: amountTotal,
    currency,
    status: "completed",
    updated_at: new Date().toISOString(),
  };

  try {
    // upsert by stripe_session_id if you have a unique constraint on that
    const { data: rows, error } = await supabaseAdmin
      .from("db_orders")
      .upsert(orderPayload, {
        onConflict: "stripe_session_id",
      })
      .select()
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[webhook] upsertOrderFromSession error", error);
      return null;
    }

    return rows || null;
  } catch (err) {
    console.error("[webhook] upsertOrderFromSession exception", err);
    return null;
  }
}

/**
 * Fire our internal order-confirmation email route (best-effort).
 */
async function sendOrderEmail({ stripeSessionId }) {
  if (!stripeSessionId) return;
  const base = SITE_URL.replace(/\/+$/, "");
  const url = `${base}/api/send-order-confirmation`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stripeSessionId }),
    });

    if (!res.ok) {
      console.warn(
        "[webhook] send-order-confirmation non-OK",
        res.status,
        await res.text().catch(() => "")
      );
    }
  } catch (err) {
    console.warn("[webhook] send-order-confirmation exception", err);
  }
}

// ------------ main handler ------------

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  let event;
  let rawBody;

  try {
    rawBody = await buffer(req);
  } catch (err) {
    console.error("[webhook] buffer error", err);
    return res.status(400).send("Unable to read request body");
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) {
    return res.status(400).send("Missing Stripe signature");
  }

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error("[webhook] signature verification failed", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        // 1) Write / update db_orders
        const orderRow = await upsertOrderFromSession(session);

        // 2) Mark listing SOLD (best-effort)
        const meta = safeMeta(session);
        const listingId = meta.listing_id || meta.listingId || null;
        if (listingId) {
          await markListingSold(listingId);
        }

        // 3) Fire order confirmation email (best-effort)
        await sendOrderEmail({ stripeSessionId: session.id });

        // 4) Notifications for buyer + seller (best-effort)
        const buyerId = meta.buyer_id || meta.buyerId || null;
        const sellerId = meta.seller_id || meta.sellerId || null;
        const listingTitle = meta.listing_title || meta.listingTitle || "";

        await insertOrderNotifications({
          buyerId,
          sellerId,
          listingId,
          listingTitle,
        });

        break;
      }

      // You can expand here for other event types as needed:
      // - payment_intent.succeeded
      // - charge.refunded
      // etc.
      default: {
        // For now we just log unhandled events.
        console.log(`[webhook] Unhandled event type: ${event.type}`);
      }
    }

    // Acknowledge to Stripe that we processed the event.
    res.json({ received: true });
  } catch (err) {
    console.error("[webhook] handler exception", err);
    return res.status(500).json({ error: "Webhook handler error" });
  }
}

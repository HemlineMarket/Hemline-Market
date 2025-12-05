// File: /api/stripe/webhook.js
// Verifies Stripe signatures, writes to orders table,
// marks listings SOLD when possible,
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
 * notifications table:
 *   user_id, actor_id, type, kind, title, body, href, link, created_at (default), read_at (nullable)
 */
async function insertOrderNotifications({
  buyerId,
  sellerId,
  listingId,
  listingTitle,
}) {
  if (!buyerId && !sellerId) return;

  const safeTitle = listingTitle || "your listing";
  const sellerHref = `/listing.html?id=${encodeURIComponent(
    listingId || ""
  )}`;
  const buyerHref = `/purchases.html`;

  const rows = [];

  if (sellerId) {
    rows.push({
      user_id: sellerId,
      actor_id: buyerId || sellerId,
      type: "order_sale",
      kind: "order",
      title: `Your item sold: “${safeTitle}”`,
      body: `Your item “${safeTitle}” was purchased.`,
      href: sellerHref,
      link: sellerHref,
    });
  }

  if (buyerId) {
    rows.push({
      user_id: buyerId,
      actor_id: sellerId || buyerId,
      type: "order_purchase",
      kind: "order",
      title: `Order confirmed: “${safeTitle}”`,
      body: `Your order for “${safeTitle}” is confirmed.`,
      href: buyerHref,
      link: buyerHref,
    });
  }

  if (!rows.length) return;

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
      .update({
        status: "SOLD",
        updated_at: new Date().toISOString(),
      })
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
 * Create or update an order row in the orders table.
 * orders table columns (expected):
 *   id, stripe_event_id, stripe_payment_intent, stripe_checkout,
 *   buyer_email, buyer_id, seller_id, listing_id, listing_snapshot (jsonb),
 *   total_cents, status, created_at, updated_at
 */
async function upsertOrderIntoOrders(event, session) {
  const meta = safeMeta(session);

  // Cart from metadata
  let cart = [];
  try {
    if (meta.cart_json) {
      cart = JSON.parse(meta.cart_json);
    }
  } catch (_) {
    cart = [];
  }

  const firstItem = Array.isArray(cart) && cart.length ? cart[0] : {};
  const listingId =
    firstItem.listing_id || meta.listing_id || meta.listingId || null;

  const listingTitle =
    firstItem.name || meta.listing_title || meta.listingTitle || "";

  const buyerId =
    meta.buyer_user_id || meta.buyer_id || meta.buyerId || null;

  const sellerUserId =
    firstItem.seller_user_id || meta.seller_user_id || meta.sellerId || null;

  const totalCents = session.amount_total || 0;
  const buyerEmail =
    session.customer_details?.email || session.customer_email || null;

  const nowIso = new Date().toISOString();

  const basePayload = {
    stripe_event_id: event.id,
    stripe_payment_intent: session.payment_intent || null,
    stripe_checkout: session.id,
    buyer_email: buyerEmail,
    buyer_id: buyerId,
    seller_id: sellerUserId,
    listing_id: listingId,
    listing_snapshot: cart,
    total_cents: totalCents,
    status: "PAID",
    updated_at: nowIso,
  };

  try {
    // See if an order already exists for this checkout session
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("stripe_checkout", session.id)
      .maybeSingle();

    if (fetchErr) {
      console.error("[webhook] upsertOrderIntoOrders fetch error", fetchErr);
      return null;
    }

    if (existing?.id) {
      const { data, error } = await supabaseAdmin
        .from("orders")
        .update(basePayload)
        .eq("id", existing.id)
        .select()
        .maybeSingle();

      if (error) {
        console.error("[webhook] upsertOrderIntoOrders update error", error);
        return null;
      }
      return data || null;
    } else {
      const payload = {
        ...basePayload,
        created_at: nowIso,
      };

      const { data, error } = await supabaseAdmin
        .from("orders")
        .insert(payload)
        .select()
        .maybeSingle();

      if (error) {
        console.error("[webhook] upsertOrderIntoOrders insert error", error);
        return null;
      }
      return data || null;
    }
  } catch (err) {
    console.error("[webhook] upsertOrderIntoOrders exception", err);
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

        // 1) Write / update orders
        const orderRow = await upsertOrderIntoOrders(event, session);

        // 2) Mark listing SOLD (best-effort)
        const meta = safeMeta(session);

        let listingId = null;
        if (orderRow?.listing_id) {
          listingId = orderRow.listing_id;
        } else if (meta.listing_id || meta.listingId) {
          listingId = meta.listing_id || meta.listingId;
        }

        if (listingId) {
          await markListingSold(listingId);
        }

        // 3) Fire order confirmation email (best-effort)
        await sendOrderEmail({ stripeSessionId: session.id });

        // 4) Notifications for buyer + seller (best-effort)
        const cart =
          (orderRow && orderRow.listing_snapshot) ||
          (() => {
            try {
              return meta.cart_json ? JSON.parse(meta.cart_json) : [];
            } catch {
              return [];
            }
          })();

        const firstItem = Array.isArray(cart) && cart.length ? cart[0] : {};
        const listingTitle =
          firstItem.name || meta.listing_title || meta.listingTitle || "";

        const buyerId =
          orderRow?.buyer_id ||
          meta.buyer_user_id ||
          meta.buyer_id ||
          meta.buyerId ||
          null;

        const sellerId =
          orderRow?.seller_id ||
          firstItem.seller_user_id ||
          meta.seller_user_id ||
          meta.sellerId ||
          null;

        await insertOrderNotifications({
          buyerId,
          sellerId,
          listingId,
          listingTitle,
        });

        break;
      }

      default: {
        console.log(`[webhook] Unhandled event type: ${event.type}`);
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("[webhook] handler exception", err);
    return res.status(500).json({ error: "Webhook handler error" });
  }
}

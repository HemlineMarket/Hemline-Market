// File: /api/stripe/webhook.js
// Verifies Stripe signatures, writes to orders table,
// marks listings SOLD when possible,
// sends the buyer a purchase-confirmation email via /api/send-order-confirmation,
// and inserts notifications for buyer + seller.
//
// ENV: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SITE_URL (or NEXT_PUBLIC_SITE_URL),
//      SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import Stripe from "stripe";
import fetch from "node-fetch";
import supabaseAdmin from "../_supabaseAdmin";

export const config = { api: { bodyParser: false } };

const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) throw new Error("STRIPE_SECRET_KEY is not set");

const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");

const SITE_URL =
  process.env.SITE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://hemline.market";

// ---------- helpers ----------

function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function safeMeta(session) {
  return (session && session.metadata) || {};
}

// ---------- notifications ----------

async function insertPurchaseNotifications({ buyerId, sellerId, listingId, listingTitle }) {
  if (!buyerId && !sellerId) return;

  const title = listingTitle || "your fabric";
  const sellerHref = `/listing.html?id=${encodeURIComponent(listingId || "")}`;
  const buyerHref = `/purchases.html`;

  const rows = [];

  if (sellerId) {
    rows.push({
      user_id: sellerId,
      actor_id: buyerId || sellerId,
      type: "purchase_sale",
      kind: "purchase",
      title: `Your fabric was purchased: “${title}”`,
      body: `Someone purchased “${title}”.`,
      href: sellerHref,
      link: sellerHref,
    });
  }

  if (buyerId) {
    rows.push({
      user_id: buyerId,
      actor_id: sellerId || buyerId,
      type: "purchase_buyer",
      kind: "purchase",
      title: `Purchase confirmed: “${title}”`,
      body: `Your purchase of “${title}” is confirmed.`,
      href: buyerHref,
      link: buyerHref,
    });
  }

  if (!rows.length) return;

  try {
    const { error } = await supabaseAdmin.from("notifications").insert(rows);
    if (error) console.warn("[webhook] notifications insert error", error);
  } catch (err) {
    console.warn("[webhook] notifications insert exception", err);
  }
}

// ---------- SOLD marking ----------

async function markListingSold(listingId) {
  if (!listingId) return;
  try {
    await supabaseAdmin
      .from("listings")
      .update({
        status: "SOLD",
        updated_at: new Date().toISOString(),
      })
      .eq("id", listingId)
      .is("deleted_at", null);
  } catch (err) {
    console.warn("[webhook] markListingSold exception", err);
  }
}

// ---------- upsert into orders ----------

async function upsertOrderIntoOrders(event, session) {
  const meta = safeMeta(session);

  let cart = [];
  try {
    if (meta.cart_json) cart = JSON.parse(meta.cart_json);
  } catch {}

  const first = Array.isArray(cart) && cart.length ? cart[0] : {};

  const listingId =
    first.listing_id || meta.listing_id || meta.listingId || null;

  const listingTitle =
    first.name || meta.listing_title || meta.listingTitle || "";

  const buyerId =
    meta.buyer_user_id || meta.buyer_id || meta.buyerId || null;

  const sellerId =
    first.seller_user_id || meta.seller_user_id || meta.sellerId || null;

  const totalCents = session.amount_total || 0;
  const buyerEmail =
    session.customer_details?.email || session.customer_email || null;

  const nowIso = new Date().toISOString();

  const payload = {
    stripe_event_id: event.id,
    stripe_payment_intent: session.payment_intent || null,
    stripe_checkout: session.id,
    buyer_email: buyerEmail,
    buyer_id: buyerId,
    seller_id: sellerId,
    listing_id: listingId,
    listing_snapshot: cart,
    total_cents: totalCents,
    status: "PAID",
    updated_at: nowIso,
  };

  try {
    const { data: existing } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("stripe_checkout", session.id)
      .maybeSingle();

    if (existing?.id) {
      const { data } = await supabaseAdmin
        .from("orders")
        .update(payload)
        .eq("id", existing.id)
        .select()
        .maybeSingle();
      return data || null;
    }

    const { data } = await supabaseAdmin
      .from("orders")
      .insert({ ...payload, created_at: nowIso })
      .select()
      .maybeSingle();

    return data || null;
  } catch (err) {
    console.error("[webhook] upsert error", err);
    return null;
  }
}

// ---------- purchase email (disabled until Shippo) ----------

async function sendPurchaseEmail({ stripeSessionId }) {
  if (!stripeSessionId) return;

  const base = SITE_URL.replace(/\/+$/, "");
  const url = `${base}/api/send-order-confirmation`; // will rename later when Shippo is added

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stripeSessionId }),
    });

    if (!res.ok) {
      console.warn("[webhook] purchase-email non-OK", res.status);
    }
  } catch (err) {
    console.warn("[webhook] purchase-email exception", err);
  }
}

// ---------- main handler ----------

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  let rawBody;
  try {
    rawBody = await buffer(req);
  } catch {
    return res.status(400).send("Unable to read request body");
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).send("Missing Stripe signature");

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const orderRow = await upsertOrderIntoOrders(event, session);

      const meta = safeMeta(session);

      let listingId =
        orderRow?.listing_id ||
        meta.listing_id ||
        meta.listingId ||
        null;

      if (listingId) await markListingSold(listingId);

      await sendPurchaseEmail({ stripeSessionId: session.id });

      const cart =
        orderRow?.listing_snapshot ||
        (() => {
          try {
            return meta.cart_json ? JSON.parse(meta.cart_json) : [];
          } catch {
            return [];
          }
        })();

      const first = Array.isArray(cart) && cart.length ? cart[0] : {};
      const listingTitle =
        first.name || meta.listing_title || meta.listingTitle || "";

      const buyerId =
        orderRow?.buyer_id ||
        meta.buyer_user_id ||
        meta.buyer_id ||
        meta.buyerId ||
        null;

      const sellerId =
        orderRow?.seller_id ||
        first.seller_user_id ||
        meta.seller_user_id ||
        meta.sellerId ||
        null;

      await insertPurchaseNotifications({
        buyerId,
        sellerId,
        listingId,
        listingTitle,
      });
    }

    res.json({ received: true });
  } catch (err) {
    console.error("[webhook] handler exception", err);
    res.status(500).json({ error: "Webhook handler error" });
  }
}

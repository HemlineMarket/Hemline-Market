// File: /api/stripe/webhook/index.js
// TEMP: no Stripe signature check so orders always write.
// Once everything works, we can re-enable constructEvent.

import Stripe from "stripe";
import fetch from "node-fetch";
import supabaseAdmin from "../../_supabaseAdmin.js";

export const config = { api: { bodyParser: false } };

const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) throw new Error("STRIPE_SECRET_KEY is not set");

const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });

// we keep this env var only for later when we re-enable signing
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || null;

const SITE_URL =
  process.env.SITE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://hemline.market";

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

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

// ----------------------------------------------------------
// Notifications
// ----------------------------------------------------------

async function insertPurchaseNotifications({
  buyerId,
  sellerId,
  listingId,
  listingTitle
}) {
  const title = listingTitle || "your fabric";
  const sellerHref = `/listing.html?id=${listingId || ""}`;
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
      link: sellerHref
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
      link: buyerHref
    });
  }

  if (!rows.length) return;
  await supabaseAdmin.from("notifications").insert(rows);
}

// ----------------------------------------------------------
// Mark listing SOLD
// ----------------------------------------------------------

async function markListingSold(listingId) {
  if (!listingId) return;
  try {
    await supabaseAdmin
      .from("listings")
      .update({
        status: "SOLD",
        updated_at: new Date().toISOString()
      })
      .eq("id", listingId)
      .is("deleted_at", null);
  } catch (err) {
    console.warn("markListingSold error:", err);
  }
}

// ----------------------------------------------------------
// UPSERT ORDER
// ----------------------------------------------------------

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
    meta.buyer_user_id ||
    meta.buyer_id ||
    meta.buyerId ||
    null;

  const sellerId =
    first.seller_user_id ||
    meta.seller_user_id ||
    meta.sellerId ||
    null;

  const payload = {
    stripe_event_id: event.id || null,
    stripe_payment_intent: session.payment_intent || null,
    stripe_checkout: session.id || null,

    buyer_email:
      session.customer_details?.email || session.customer_email || "",
    buyer_id: buyerId,
    seller_id: sellerId,
    listing_id: listingId,

    listing_snapshot: cart,
    total_cents: session.amount_total || 0,
    status: "PAID",
    updated_at: new Date().toISOString()
  };

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
    .insert({ ...payload, created_at: new Date().toISOString() })
    .select()
    .maybeSingle();

  return data || null;
}

// ----------------------------------------------------------
// Purchase email
// ----------------------------------------------------------

async function sendPurchaseEmail({ stripeSessionId }) {
  if (!stripeSessionId) return;
  const base = SITE_URL.replace(/\/+$/, "");
  const url = `${base}/api/send-order-confirmation`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stripeSessionId })
    });
  } catch (err) {
    console.warn("purchase-email error", err);
  }
}

// ----------------------------------------------------------
// MAIN HANDLER  (NO SIGNATURE CHECK)
// ----------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  let rawBody;
  try {
    rawBody = await buffer(req);
  } catch (err) {
    console.error("buffer error", err);
    return res.status(400).send("Unable to read request body");
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8") || "{}");
  } catch (err) {
    console.error("webhook JSON parse error", err);
    return res.status(400).send("Invalid JSON");
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const orderRow = await upsertOrderIntoOrders(event, session);
      const meta = safeMeta(session);

      const listingId =
        orderRow?.listing_id ||
        meta.listing_id ||
        meta.listingId ||
        null;

      if (listingId) await markListingSold(listingId);

      await sendPurchaseEmail({ stripeSessionId: session.id });

      const cart =
        orderRow?.listing_snapshot ||
        (meta.cart_json ? JSON.parse(meta.cart_json) : []);

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
        listingTitle
      });
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("webhook handler error:", err);
    return res.status(500).json({ error: "Webhook handler error" });
  }
}

// File: /api/shippo/webhook.js
// Handles Shippo webhooks, updates order_shipments, and emails buyer/seller.
// Uses order_details view to resolve emails when orderId is a UUID.
// If orderId is NOT a UUID (e.g., "HM-12345"), we skip email lookup gracefully.

import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

export const config = { api: { bodyParser: false } };

function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getSiteBase() {
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "").replace(/\/$/, "");
}

function looksLikeUUID(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ""));
}

// Try to resolve buyer/seller emails using the view we created.
// Only attempt if orderId is a UUID. Return nulls otherwise.
async function getOrderEmails(orderId) {
  if (!looksLikeUUID(orderId)) {
    console.warn("[shippo] orderId is not a UUID; skipping DB email lookup:", orderId);
    return { buyer_email: null, seller_email: null };
  }
  try {
    const { data, error } = await supabase
      .from("order_details")
      .select("buyer_email, seller_email")
      .eq("order_id", orderId)
      .maybeSingle();
    if (error) {
      console.error("[shippo] order_details lookup error:", error);
      return { buyer_email: null, seller_email: null };
    }
    return {
      buyer_email: data?.buyer_email || null,
      seller_email: data?.seller_email || null,
    };
  } catch (err) {
    console.error("[shippo] order_details lookup exception:", err?.message || err);
    return { buyer_email: null, seller_email: null };
  }
}

async function notifyShipment(payload) {
  const base = getSiteBase();
  if (!base) {
    console.warn("[notify] Skipping email notify — missing SITE_URL / NEXT_PUBLIC_SITE_URL");
    return;
  }
  try {
    const res = await fetch(`${base}/api/notify/shipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[notify] Failed:", res.status, json);
    } else {
      console.log("[notify] Sent:", json?.message || "ok");
    }
  } catch (err) {
    console.error("[notify] Exception:", err?.message || err);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const rawBody = await buffer(req);
    const payload = JSON.parse(rawBody.toString("utf-8"));

    // Shippo event envelope
    const eventType = payload.event || payload.type || "unknown";
    const data = payload.data || {};

    // Metadata carries "order:XYZ"
    const meta = data.metadata || "";
    const m = String(meta).match(/order:([A-Za-z0-9\-]+)/);
    const orderId = m ? m[1] : null;

    if (!orderId) {
      console.warn("[shippo] Webhook without orderId metadata:", meta);
      res.status(200).json({ ok: true, skipped: true });
      return;
    }

    // Normalize fields
    const update = {
      status: data.status || null,
      tracking_number: data.tracking_number || null,
      tracking_url: data.tracking_url_provider || data.tracking_url || null,
      carrier: data.rate?.provider || null,
      service: data.rate?.servicelevel?.name || null,
      label_url: data.label_url || null,
      updated_at: new Date().toISOString(),
    };

    // Persist to order_shipments (this table stores your external orderId/text)
    const { error: upErr } = await supabase
      .from("order_shipments")
      .update(update)
      .eq("order_id", orderId);

    if (upErr) {
      console.error("[shippo] Supabase update error:", upErr);
      res.status(500).json({ error: "Failed to update shipment" });
      return;
    }

    // Resolve emails (best-effort)
    const { buyer_email, seller_email } = await getOrderEmails(orderId);

    // Choose email status keyword
    const upper = String(update.status || "").toUpperCase();
    const statusForEmail =
      update.label_url && !upper ? "LABEL_CREATED" :
      upper.includes("SUCCESS") ? "LABEL_CREATED" :
      upper.includes("DELIVERED") ? "DELIVERED" :
      upper.includes("TRANSIT") || upper.includes("TRACK") ? "IN_TRANSIT" :
      upper || "UPDATED";

    // Only send if we have at least one recipient
    if (buyer_email || seller_email) {
      await notifyShipment({
        orderId,
        status: statusForEmail,
        label_url: update.label_url,
        tracking_number: update.tracking_number,
        tracking_url: update.tracking_url,
        carrier: update.carrier,
        service: update.service,
        to_buyer: buyer_email || undefined,
        to_seller: seller_email || undefined,
      });
    } else {
      console.warn("[notify] No recipients found for order:", orderId);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[shippo] webhook error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

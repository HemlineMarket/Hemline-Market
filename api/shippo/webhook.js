// File: /api/shippo/webhook.js
// Consolidated handler:
//  - Verifies shared secret (?secret=...)
//  - Normalizes Shippo Transaction/Tracking payloads
//  - Upserts into public.db_shipments (canonical)
//  - Notifies buyer/seller via /api/notify/shipment (Postmark) when useful
//
// Env required (Vercel):
// - SHIPPO_WEBHOOK_SECRET                (you set: Icreatedthismyself)
// - SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - SITE_URL or NEXT_PUBLIC_SITE_URL     (base to call our own APIs)

import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

export const config = { api: { bodyParser: true } };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function baseUrl() {
  return (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
}

function parseOrderId(metadata) {
  if (!metadata) return null;
  if (typeof metadata === "string") {
    const m = metadata.match(/order\s*:\s*([A-Za-z0-9\-_]+)/i);
    return m ? m[1] : null;
  }
  if (typeof metadata === "object") {
    return metadata.order || metadata.order_id || metadata.orderId || null;
  }
  return null;
}

function normalizeFromTransaction(tx) {
  const statusRaw = (tx.status || "").toUpperCase(); // SUCCESS | ERROR | QUEUED
  const status = statusRaw === "SUCCESS" ? "LABEL_CREATED" : statusRaw || "CREATED";
  const rate = tx.rate || {};
  return {
    order_id: parseOrderId(tx.metadata),
    tracking_number: tx.tracking_number || null,
    tracking_url: tx.tracking_url_provider || tx.tracking_url || null,
    label_url: tx.label_url || null,
    carrier: rate?.provider || null,
    service: rate?.servicelevel?.name || null,
    status
  };
}

function normalizeFromTracking(t) {
  const ev = (t?.tracking_status?.status || "").toUpperCase();
  let status = "IN_TRANSIT";
  if (ev.includes("DELIVER")) status = "DELIVERED";
  else if (ev.includes("FAIL") || ev.includes("EXCEPT")) status = "ERROR";
  return {
    order_id: parseOrderId(t?.metadata),
    tracking_number: t?.tracking_number || null,
    tracking_url: t?.tracking_url_provider || null,
    label_url: null,
    carrier: t?.carrier || null,
    service: t?.servicelevel?.name || null,
    status
  };
}

async function upsertShipment(row) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("db_shipments")
    .upsert(
      {
        order_id: row.order_id,
        tracking_number: row.tracking_number,
        tracking_url: row.tracking_url,
        label_url: row.label_url,
        carrier: row.carrier,
        service: row.service,
        status: row.status,
        updated_at: now
      },
      { onConflict: "order_id" }
    )
    .select("order_id")
    .limit(1);

  if (error) throw error;
  return data?.[0]?.order_id || row.order_id;
}

async function getOrderEmails(orderId) {
  // Best-effort: if you have order_details view with buyer_email/seller_email, use it.
  try {
    const { data, error } = await supabase
      .from("order_details")
      .select("buyer_email, seller_email")
      .eq("order_id", orderId)
      .maybeSingle();
    if (error) return { buyer_email: null, seller_email: null };
    return {
      buyer_email: data?.buyer_email || null,
      seller_email: data?.seller_email || null
    };
  } catch {
    return { buyer_email: null, seller_email: null };
  }
}

async function notify(row, emails) {
  const base = baseUrl();
  if (!base) return;

  const payload = {
    orderId: row.order_id,
    status: row.status,
    label_url: row.label_url,
    tracking_number: row.tracking_number,
    tracking_url: row.tracking_url,
    carrier: row.carrier,
    service: row.service,
    to_buyer: emails?.buyer_email || undefined,
    to_seller: emails?.seller_email || undefined
  };

  // Only notify when we have something actionable: label or tracking state change
  const actionable =
    row.status === "LABEL_CREATED" ||
    row.status === "DELIVERED" ||
    row.status === "IN_TRANSIT";

  if (!actionable) return;

  try {
    const r = await fetch(`${base}/api/notify/shipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      console.error("[notify/shipment] failed:", r.status, j);
    }
  } catch (err) {
    console.error("[notify/shipment] error:", err?.message || err);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // --- Security: shared secret in query ---
  const given = (req.query?.secret || "").toString();
  const expected = process.env.SHIPPO_WEBHOOK_SECRET || "";
  if (!expected || given !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    // Unwrap common shapes
    let payload = body?.data?.object ? body.data.object : body;
    let kind = "";

    // Detect transaction vs tracking
    if (payload?.object === "transaction" || payload?.label_url || payload?.rate) kind = "transaction";
    if (!kind && (payload?.tracking_status || payload?.object === "tracking_status")) kind = "tracking";
    if (!kind && typeof body?.event === "string" && body.event.includes("track")) {
      kind = "tracking";
      payload = body.data || payload;
    }

    // Normalize row
    let row = kind === "tracking" ? normalizeFromTracking(payload) : normalizeFromTransaction(payload);

    if (!row.order_id) {
      // If order_id missing, still 200 to avoid retries
      console.warn("[shippo] missing order_id; metadata was:", payload?.metadata);
      return res.status(200).json({ ok: true, skipped: "no order_id" });
    }

    // Upsert shipment
    const upsertedOrderId = await upsertShipment(row);

    // Fetch recipients and notify (best-effort)
    const emails = await getOrderEmails(upsertedOrderId);
    await notify(row, emails);

    return res.status(200).json({ ok: true, type: kind || "unknown", order_id: upsertedOrderId });
  } catch (err) {
    console.error("[shippo webhook] error:", err?.message || err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

// File: /api/shippo/webhook.js
// Handles Shippo webhooks and upserts into public.db_shipments.
// Security: require ?secret=... that matches SHIPPO_WEBHOOK_SECRET (set in Vercel).
//
// Env required:
// - SHIPPO_WEBHOOK_SECRET
// - SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
// - SUPABASE_SERVICE_ROLE_KEY
//
// Notes:
// - We rely on `metadata: "order:<ORDER_ID>"` set when buying labels (create_label.js).
// - Supports Transaction (label purchase) + Track Updated payloads.

import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: true } };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function parseOrderId(metadata) {
  if (!metadata) return null;
  // metadata may be "order:HM-123" or an object; handle both
  if (typeof metadata === "string") {
    const m = metadata.match(/order\s*:\s*([A-Za-z0-9\-_.]+)/i);
    return m ? m[1] : null;
  }
  if (typeof metadata === "object") {
    // common shapes: { order: "HM-123" } or { "order_id": "..." }
    return metadata.order || metadata.order_id || null;
  }
  return null;
}

function normalizeFromTransaction(tx) {
  // tx: Shippo Transaction object
  const status = (tx.status || "").toUpperCase(); // SUCCESS | ERROR | QUEUED
  const isSuccess = status === "SUCCESS";
  const orderId = parseOrderId(tx.metadata);
  const rate = tx.rate || {};
  const service = rate?.servicelevel?.name || null;
  const carrier = rate?.provider || null;

  return {
    order_id: orderId,
    tracking_number: tx.tracking_number || null,
    tracking_url: tx.tracking_url_provider || tx.tracking_url || null,
    label_url: tx.label_url || null,
    carrier,
    service,
    status: isSuccess ? "LABEL_CREATED" : status || "CREATED",
  };
}

function normalizeFromTracking(t) {
  // t: Shippo Tracking payload (track updated)
  // Ref: t.tracking_number, t.tracking_url_provider, t.tracking_status.status
  const event = (t?.tracking_status?.status || "").toUpperCase(); // TRANSIT | DELIVERED | etc.
  let status = "IN_TRANSIT";
  if (event.includes("DELIVER")) status = "DELIVERED";
  else if (event.includes("FAIL") || event.includes("EXCEPT")) status = "ERROR";

  // order id may be in metadata or transactions? Try metadata first.
  const orderId = parseOrderId(t?.metadata);

  return {
    order_id: orderId,
    tracking_number: t?.tracking_number || null,
    tracking_url: t?.tracking_url_provider || null,
    label_url: null,
    carrier: t?.carrier || null,
    service: t?.servicelevel?.name || null,
    status,
  };
}

async function upsertShipment(row) {
  if (!row.order_id) return { skipped: true, reason: "no order_id" };

  // upsert by order_id if present, otherwise by tracking_number
  const set = {
    tracking_number: row.tracking_number,
    tracking_url: row.tracking_url,
    label_url: row.label_url,
    carrier: row.carrier,
    service: row.service,
    status: row.status,
  };

  // Prefer unique key on order_id; fallback to tracking_number if order unknown
  if (row.order_id) {
    const { data, error } = await supabase
      .from("db_shipments")
      .upsert(
        { order_id: row.order_id, ...set, updated_at: new Date().toISOString() },
        { onConflict: "order_id" }
      )
      .select("order_id")
      .limit(1);

    if (error) throw error;
    return { ok: true, upserted: data?.[0]?.order_id || row.order_id };
  }

  // Fallback path (rare)
  const { error } = await supabase
    .from("db_shipments")
    .insert({ ...row, updated_at: new Date().toISOString() });

  if (error) throw error;
  return { ok: true, inserted: true };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Verify webhook secret in query
  const given = (req.query?.secret || "").toString();
  const expected = process.env.SHIPPO_WEBHOOK_SECRET || "";
  if (!expected || given !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    // Shippo sends various shapes; detect Transaction vs Tracking
    // Common root keys: "event", "data" OR direct object
    let kind = "";
    let payload = body;

    if (body?.data?.object?.object_state || body?.data?.object?.status) {
      // V2 webhook wrapper
      payload = body.data.object;
    }

    // Heuristics:
    if (payload?.object === "transaction" || payload?.label_url || payload?.tracking_number) {
      kind = "transaction";
    }
    if (payload?.object === "tracking_status" || payload?.tracking_status) {
      kind = "tracking";
    }
    // Some webhooks send { event: "track_updated", data: {...} }
    if (!kind && typeof body?.event === "string" && body.event.includes("track")) {
      kind = "tracking";
      payload = body.data || payload;
    }

    let row;
    if (kind === "transaction") {
      row = normalizeFromTransaction(payload);
    } else if (kind === "tracking") {
      row = normalizeFromTracking(payload);
    } else {
      // Unknown shape; try best-effort transaction parse
      row = normalizeFromTransaction(payload);
    }

    const result = await upsertShipment(row);
    return res.status(200).json({ ok: true, type: kind || "unknown", result });
  } catch (err) {
    console.error("[shippo webhook] error:", err?.message || err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

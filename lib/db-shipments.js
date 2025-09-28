// File: lib/db-shipments.js
// Server-side helper for saving Shippo label + tracking to Supabase
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  // Fail fast in server logs; callers will see a clean error object
  console.error("[db-shipments] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const admin = url && serviceKey ? createClient(url, serviceKey, {
  auth: { persistSession: false },
}) : null;

/**
 * Save a shipment row tied to an order.
 * Call from /api/shippo/create_label or /api/shippo/purchase_label after SUCCESS.
 *
 * @param {Object} payload
 * @param {string} payload.orderId                   e.g., "HM-12345"
 * @param {string} [payload.shipment_id]
 * @param {string} [payload.transaction_id]
 * @param {string} [payload.label_url]
 * @param {string} [payload.tracking_number]
 * @param {string} [payload.tracking_url]
 * @param {string} [payload.carrier]                 e.g., "USPS"
 * @param {string} [payload.service]                 e.g., "Priority Mail"
 * @param {number|string} [payload.rate_amount]
 * @param {string} [payload.rate_currency]           e.g., "USD"
 * @param {string} [payload.status='PURCHASED']      CREATED | PURCHASED | TRACKING | DELIVERED | ERROR
 * @param {Object} [payload.raw]                     full Shippo object (transaction or shipment)
 * @returns {Promise<{ ok: boolean, id?: string, error?: any }>}
 */
export async function saveOrderShipment(payload = {}) {
  try {
    if (!admin) {
      return { ok: false, error: "Supabase admin client not initialized" };
    }
    const {
      orderId,
      shipment_id,
      transaction_id,
      label_url,
      tracking_number,
      tracking_url,
      carrier,
      service,
      rate_amount,
      rate_currency,
      status = "PURCHASED",
      raw,
    } = payload;

    if (!orderId) {
      return { ok: false, error: "orderId is required" };
    }

    const toInsert = {
      order_id: orderId,
      shipment_id: shipment_id ?? null,
      transaction_id: transaction_id ?? null,
      label_url: label_url ?? null,
      tracking_number: tracking_number ?? null,
      tracking_url: tracking_url ?? null,
      carrier: carrier ?? null,
      service: service ?? null,
      rate_amount: (typeof rate_amount === "string" ? parseFloat(rate_amount) : rate_amount) ?? null,
      rate_currency: rate_currency ?? null,
      status,
      raw: raw ?? null,
    };

    const { data, error } = await admin
      .from("order_shipments")
      .insert(toInsert)
      .select("id")
      .single();

    if (error) return { ok: false, error };
    return { ok: true, id: data?.id };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * Update an existing shipment row by tracking_number or transaction_id.
 * Use from webhook: update status/checkpoints as events arrive.
 *
 * @param {Object} where            e.g., { tracking_number } or { transaction_id }
 * @param {Object} changes          columns to update (status, tracking_url, raw, etc.)
 * @returns {Promise<{ ok: boolean, count?: number, error?: any }>}
 */
export async function updateOrderShipment(where = {}, changes = {}) {
  try {
    if (!admin) {
      return { ok: false, error: "Supabase admin client not initialized" };
    }
    const q = admin.from("order_shipments").update(changes);
    if (where.tracking_number) q.eq("tracking_number", where.tracking_number);
    if (where.transaction_id) q.eq("transaction_id", where.transaction_id);
    if (where.order_id) q.eq("order_id", where.order_id);

    const { error, count } = await q.select("id", { count: "exact" });
    if (error) return { ok: false, error };
    return { ok: true, count: count ?? 0 };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

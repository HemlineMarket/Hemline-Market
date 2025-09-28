// File: /api/shippo/webhook.js
// Shippo webhook → updates Supabase order_shipments
// Env: SHIPPO_WEBHOOK_SECRET (optional), SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { updateOrderShipment, saveOrderShipment } from "../../lib/db-shipments.js";

export const config = {
  api: { bodyParser: false }, // raw body for signature verification
};

// ---- helpers ----
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function verifySignature(rawBody, signature, secret) {
  if (!secret) return true; // no secret configured → accept (tighten later)
  try {
    const crypto = require("crypto");
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(rawBody, "utf8");
    const expected = hmac.digest("hex");
    return typeof signature === "string" &&
      signature.toLowerCase() === expected.toLowerCase();
  } catch {
    return false;
  }
}

// Extract "HM-12345" from metadata like "order:HM-12345"
function parseOrderIdFromMetadata(meta) {
  if (!meta || typeof meta !== "string") return null;
  const m = meta.match(/order:([A-Za-z0-9\-_]+)/);
  return m ? m[1] : null;
}

// ---- handler ----
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const raw = await getRawBody(req);
  const signature = req.headers["x-shippo-signature"];
  const secret = process.env.SHIPPO_WEBHOOK_SECRET || "";

  if (!verifySignature(raw, signature, secret)) {
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  const type = event?.event || "unknown";
  const data = event?.data || {};
  const orderId = parseOrderIdFromMetadata(data?.metadata || "");

  // Minimal log (Vercel): avoid printing secrets
  console.log("[shippo:webhook]", { type, orderId, object_id: data?.object_id, tracking: data?.tracking_number, status: data?.tracking_status?.status || data?.status });

  try {
    // Handle the two primary event families:
    // 1) transaction_updated → label purchase lifecycle
    if (type === "transaction_updated") {
      const status = (data?.status || "").toUpperCase();
      // SUCCESS → ensure we have a row saved (idempotent insert) and mark as PURCHASED
      if (status === "SUCCESS") {
        const payload = {
          orderId: orderId || undefined,
          transaction_id: data?.object_id || null,
          label_url: data?.label_url || null,
          tracking_number: data?.tracking_number || null,
          tracking_url: data?.tracking_url_provider || data?.tracking_url || null,
          carrier: data?.rate?.provider || null,
          service: data?.rate?.servicelevel?.name || data?.rate?.servicelevel?.token || null,
          rate_amount: data?.rate?.amount ?? null,
          rate_currency: data?.rate?.currency ?? null,
          status: "PURCHASED",
          raw: data,
        };

        // Try to upsert: first attempt update by transaction_id; if nothing updated, insert.
        const upd = await updateOrderShipment({ transaction_id: payload.transaction_id }, {
          order_id: orderId ?? null,
          label_url: payload.label_url,
          tracking_number: payload.tracking_number,
          tracking_url: payload.tracking_url,
          carrier: payload.carrier,
          service: payload.service,
          rate_amount: typeof payload.rate_amount === "string" ? parseFloat(payload.rate_amount) : payload.rate_amount,
          rate_currency: payload.rate_currency,
          status: "PURCHASED",
          raw: payload.raw,
        });

        if (!upd.ok || (upd.count ?? 0) === 0) {
          await saveOrderShipment(payload);
        }
      } else if (status === "ERROR") {
        await updateOrderShipment(
          { transaction_id: data?.object_id },
          { status: "ERROR", raw: data }
        );
      }
    }

    // 2) track_updated → tracking events as the package moves
    if (type === "track_updated") {
      const tracking_number = data?.tracking_number || null;
      const tracking_status = data?.tracking_status?.status || null;

      let normalized = "TRACKING";
      if (tracking_status) {
        const s = tracking_status.toUpperCase();
        if (s.includes("DELIVERED")) normalized = "DELIVERED";
        else if (s.includes("TRANSIT") || s.includes("IN_TRANSIT")) normalized = "TRACKING";
        else if (s.includes("FAIL") || s.includes("EXCEPTION")) normalized = "ERROR";
      }

      await updateOrderShipment(
        tracking_number ? { tracking_number } : {},
        {
          status: normalized,
          tracking_url: data?.tracking_url_provider || data?.tracking_url || null,
          raw: data,
        }
      );
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[shippo:webhook] error", err);
    return res.status(500).json({ error: "Webhook handling failed" });
  }
}

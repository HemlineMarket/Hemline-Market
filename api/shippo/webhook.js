// File: /api/shippo/webhook.js
// Secure Shippo webhook → updates public.db_shipments by tracking_number only.
// Expects Shippo to POST to:
//   https://hemlinemarket.vercel.app/api/shippo/webhook?secret=Icreatedthismyself
//
// Env required:
// - SHIPPO_WEBHOOK_SECRET  (use: Icreatedthismyself)
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY

export const config = { api: { bodyParser: false } };

import supabaseAdmin from "../_supabaseAdmin";

// Read raw body safely and parse JSON
async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

// Normalize Shippo "track_updated" status to our canonical values
function normalizeTrackingStatus(s = "") {
  const up = String(s).toUpperCase();
  if (up.includes("DELIVER")) return "DELIVERED";
  if (up.includes("FAIL") || up.includes("EXCEPT")) return "ERROR";
  if (up.includes("TRANSIT")) return "IN_TRANSIT";
  return up || "IN_TRANSIT";
}

// Normalize Shippo transaction status to our canonical values
function normalizeTransactionStatus(s = "") {
  const up = String(s).toUpperCase();
  if (up === "SUCCESS") return "LABEL_PURCHASED";
  if (up === "ERROR")   return "FAILED";
  return up || "CREATED";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Shared-secret check (?secret=...)
  const given = String(req.query.secret || "");
  if (!given || given !== process.env.SHIPPO_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  let payload;
  try {
    payload = await readBody(req);
  } catch (err) {
    console.error("[shippo webhook] JSON parse error:", err);
    return res.status(400).json({ error: "Bad JSON" });
  }

  // ACK immediately so Shippo doesn't retry
  res.status(200).json({ ok: true });

  try {
    // Shippo commonly sends:
    // { event: "track_updated", data: {...} }  OR
    // { event: "transaction.created", data: {...} }
    const eventType = payload?.event || payload?.event_type || "";
    const data = payload?.data || payload?.object || payload || {};

    // Helper: update by tracking number (we only touch columns that exist in db_shipments)
    async function updateByTracking(trackingNumber, fields) {
      if (!trackingNumber) return;
      const { error } = await supabaseAdmin
        .from("db_shipments")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("tracking_number", trackingNumber);
      if (error) console.error("[db_shipments] update error:", error);
    }

    // Transaction events (label purchase flows)
    if (/^transaction\./i.test(eventType)) {
      // Shippo transaction payload shape varies; be tolerant
      const tx = data?.object || data;

      const trackingNumber =
        tx?.tracking_number ||
        tx?.label?.tracking_number ||
        null;

      const trackingUrl =
        tx?.tracking_url_provider ||
        tx?.tracking_url ||
        null;

      const carrier = tx?.rate?.provider || null;
      const service = tx?.rate?.servicelevel?.name || null;

      const status = normalizeTransactionStatus(tx?.status);

      // Update only known columns in db_shipments
      await updateByTracking(trackingNumber, {
        status,
        tracking_url: trackingUrl,
        carrier,
        service,
        // label_url is often present on SUCCESS transactions:
        ...(tx?.label_url ? { label_url: tx.label_url } : {})
      });

      return;
    }

    // Tracking updates (movement, delivered, exception)
    if (/track_updated/i.test(eventType) || data?.tracking_status) {
      const trackingNumber =
        data?.tracking_number ||
        data?.tracking?.tracking_number ||
        null;

      // tracking_status shape: { status, status_date, substatus, ... }
      const ts = data?.tracking_status || data?.tracking?.tracking_status || {};
      const status = normalizeTrackingStatus(ts?.status || ts?.object_state || "");

      await updateByTracking(trackingNumber, {
        status
        // (intentionally not storing raw payload to avoid schema mismatches)
      });

      return;
    }

    // Unknown event — just log
    console.log("[shippo webhook] Unhandled event:", eventType);
  } catch (err) {
    // We already ACKed; log for diagnostics
    console.error("[shippo webhook] handler error:", err);
  }
}

// File: /api/shippo/webhook.js
// Listens for Shippo webhooks and updates db_shipments accordingly.
// Configure Shippo to POST to:
//   https://hemlinemarket.com/api/shippo/webhook?secret=YOUR_SECRET
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SHIPPO_WEBHOOK_SECRET

export const config = { api: { bodyParser: false } };

import supabaseAdmin from "../_supabaseAdmin";

// read raw body for safety
async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({ raw, json: raw ? JSON.parse(raw) : {} });
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // simple shared-secret check on query string
  const secret = (req.query.secret || "").trim();
  if (!secret || secret !== process.env.SHIPPO_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  let payload;
  try {
    const { json } = await readBody(req);
    payload = json || {};
  } catch (err) {
    console.error("shippo webhook parse error:", err);
    return res.status(400).json({ error: "Bad JSON" });
  }

  // acknowledge ASAP
  res.status(200).json({ ok: true });

  try {
    const type = payload?.event || payload?.event_type || "";
    // Shippo normally nests data under 'data' (and often 'object')
    const data = payload?.data || payload?.object || payload;

    // Helpers to update db row
    async function updateByTransactionId(txId, fields) {
      if (!txId) return;
      const { error } = await supabaseAdmin
        .from("db_shipments")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("shippo_transaction_id", txId);
      if (error) console.error("db_shipments update (tx) error:", error);
    }

    async function updateByTracking(trk, fields) {
      if (!trk) return;
      const { error } = await supabaseAdmin
        .from("db_shipments")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("tracking_number", trk);
      if (error) console.error("db_shipments update (trk) error:", error);
    }

    // transaction.created / transaction.updated
    if (/^transaction\./i.test(type)) {
      // Shippo sends the full transaction object as data
      const tx = data?.object || data; // be tolerant
      const txId = tx?.object_id || tx?.id;
      const trackingNumber = tx?.tracking_number || null;
      const trackingUrl = tx?.tracking_url_provider || tx?.tracking_url || null;
      const carrier = tx?.rate?.provider || null;
      const service = tx?.rate?.servicelevel?.name || null;

      const status =
        (tx?.status === "SUCCESS" && "LABEL_PURCHASED") ||
        (tx?.status === "ERROR" && "FAILED") ||
        (tx?.status?.toUpperCase?.() || "UNKNOWN");

      const fields = {
        status,
        tracking_number: trackingNumber || null,
        tracking_url: trackingUrl || null,
        carrier,
        service,
        raw: tx,
      };

      if (txId) await updateByTransactionId(txId, fields);
      else if (trackingNumber) await updateByTracking(trackingNumber, fields);

      return;
    }

    // track_updated
    if (/track_updated/i.test(type)) {
      // Typical structure contains tracking_number and tracking_status
      const trk = data?.tracking_number || data?.tracking?.tracking_number || null;
      const statusObj = data?.tracking_status || data?.tracking?.tracking_status || {};
      const status =
        statusObj?.status?.toUpperCase?.() ||
        statusObj?.object_state?.toUpperCase?.() ||
        "IN_TRANSIT";

      await updateByTracking(trk, {
        status,
        last_tracking: data, // keep entire payload
      });
      return;
    }

    // Fallback: log unhandled events
    console.log("Unhandled Shippo event:", type);
  } catch (e) {
    // We've already 200'd; just log.
    console.error("shippo webhook handler error:", e);
  }
}

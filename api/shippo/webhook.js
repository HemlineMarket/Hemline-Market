// /api/shippo/webhook.js
/**
 * Configure your Shippo webhook URL like:
 *   https://YOUR_DOMAIN/api/shippo/webhook?secret=YOUR_SECRET
 *
 * Set Vercel env var:
 *   SHIPPO_WEBHOOK_SECRET=YOUR_SECRET  (choose any long random string)
 *
 * Shippo sends JSON payloads like:
 * { "event": "transaction.updated", "data": { object: "transaction", status: "SUCCESS", ... } }
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const secret = req.query.secret || "";
    if (!process.env.SHIPPO_WEBHOOK_SECRET) {
      console.warn("Missing SHIPPO_WEBHOOK_SECRET");
      return res.status(500).json({ error: "Server not configured" });
    }
    if (secret !== process.env.SHIPPO_WEBHOOK_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const evt = req.body || {};
    const type = evt.event || evt.type || "unknown";
    const data = evt.data || {};

    // Minimal examples of what you might do:
    if (data.object === "transaction") {
      const tx = data;
      // tx.status: SUCCESS | ERROR | QUEUED | ...
      // tx.object_id, tx.label_url, tx.tracking_number, tx.tracking_url_provider, tx.rate.provider
      // TODO (launch): find your order by tx.metadata or by mapping transaction_id saved earlier
      // and update order: label_url / tracking_number / status
      console.log("Shippo transaction update:", {
        event: type,
        status: tx.status,
        transaction_id: tx.object_id,
        tracking_number: tx.tracking_number,
      });
    } else if (type === "track_updated" || data.object === "track") {
      const tr = data;
      // tr.tracking_number, tr.tracking_status?.status, tr.tracking_history
      // TODO (launch): update order shipment status & push buyer notification if desired
      console.log("Shippo tracking update:", {
        tracking_number: tr.tracking_number,
        status: tr.tracking_status?.status,
      });
    } else {
      console.log("Shippo webhook (ignored type):", type);
    }

    // Respond quickly so Shippo doesn't retry unnecessarily
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Shippo webhook error:", err);
    return res.status(500).json({ error: "Webhook error" });
  }
}

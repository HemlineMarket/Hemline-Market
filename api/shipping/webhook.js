// api/shipping/webhook.js
// Hemline Market — Shippo webhook receiver.
// Accepts POSTs from Shippo for transaction and tracking updates.
// For now we just acknowledge and surface a minimal, structured response.
// Later we can persist to DB and fan out notifications.

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

module.exports = async (req, res) => {
  // Allow Shippo to preflight if it ever does OPTIONS
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "POST,OPTIONS");
    res.statusCode = 200;
    return res.end();
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS");
    return send(res, 405, { error: "POST only" });
  }

  // Shippo sends JSON; handle both string and object bodies
  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  } catch {
    return send(res, 400, { error: "Invalid JSON" });
  }

  // Common payload shapes:
  // - transaction webhook: { event: "transaction.created|transaction.updated", data: {...tx...} }
  // - tracking webhook: { event: "track.updated", data: {...tracking...} }
  const event = body.event || body.type || "unknown";
  const data = body.data || {};

  // Extract a few helpful fields (if present)
  const txId = data.object_id || data.transaction || null;
  const status = data.status || (data.tracking_status && data.tracking_status.status) || null;
  const trackingNumber = data.tracking_number || (data.tracking_status && data.tracking_status.tracking_number) || null;
  const carrier = (data.carrier || data.provider || (data.rate && (data.rate.carrier || data.rate.provider))) || null;

  // NOTE: We are not persisting yet. Vercel logs will show the event.
  // Later: write to DB and notify buyer/seller.

  return send(res, 200, {
    ok: true,
    event,
    txId,
    status,
    trackingNumber,
    carrier
  });
};

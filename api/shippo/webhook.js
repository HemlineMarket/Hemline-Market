// File: /api/shippo/webhook.js
// Unified Shippo webhook receiver for tracking & transaction events
// Configure Shippo to POST to: https://YOUR_DOMAIN/api/shippo/webhook
// Env vars: SHIPPO_WEBHOOK_SECRET (optional, for HMAC), SHIPPO_API_KEY (only if you call Shippo from here)

export const config = {
  api: { bodyParser: false }, // raw body needed for signature verification
};

// ---- helpers ----
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function verifySignature(rawBody, signature, secret) {
  if (!secret) return true; // no secret configured → accept (you can tighten later)
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

  // Minimal log (Vercel): avoid printing secrets
  console.log("[shippo:webhook]", type, {
    object_id: data?.object_id,
    tracking_number: data?.tracking_number,
    status: data?.tracking_status?.status || data?.status,
  });

  // TODO: persist to Supabase (not running tests now):
  // - On "transaction_updated" with SUCCESS: save label_url, tracking_number, tracking_url to your Order.
  // - On "track_updated": upsert checkpoints & current status on the Order.
  // We stored orderId via metadata: `order:HM-12345` in create/purchase; parse it if present.

  const response = {
    ok: true,
    received: {
      type,
      object_id: data?.object_id || null,
      order_tag: data?.metadata || null, // e.g., "order:HM-12345"
      tracking_number: data?.tracking_number || null,
      status:
        data?.tracking_status?.status ||
        data?.status ||
        null,
      label_url: data?.label_url || null,
      tracking_url: data?.tracking_url_provider || data?.tracking_url || null,
      carrier: data?.carrier || data?.rate?.provider || null,
      service:
        data?.servicelevel?.name ||
        data?.rate?.servicelevel?.name ||
        data?.rate?.servicelevel?.token ||
        null,
    },
  };

  return res.status(200).json(response);
}

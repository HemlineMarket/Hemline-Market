// File: /api/shipping/webhook.js
// Shippo webhook receiver for tracking & transaction events
// IMPORTANT: Configure your Shippo Webhook URL to point at /api/shipping/webhook
// Uses SHIPPO_WEBHOOK_SECRET (optional HMAC verification) and SHIPPO_API_KEY (for any follow-ups)

export const config = {
  api: {
    bodyParser: false, // we need raw body for signature verification
  },
};

// --- helper: get raw body string ---
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

// --- optional: verify HMAC signature if you set SHIPPO_WEBHOOK_SECRET ---
function verifySignature(rawBody, signature, secret) {
  if (!secret) return true; // no secret configured → skip verification
  try {
    const crypto = require("crypto");
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(rawBody, "utf8");
    const expected = hmac.digest("hex");
    return typeof signature === "string" && signature.toLowerCase() === expected.toLowerCase();
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const raw = await getRawBody(req);
  const signature = req.headers["x-shippo-signature"]; // if configured in Shippo
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

  // Shippo event example fields:
  // event: { event: "track_updated" | "transaction_updated", data: {...} }
  const type = event?.event || "unknown";
  const data = event?.data || {};

  // Minimal logging (Vercel logs); avoid leaking secrets
  console.log("[shippo:webhook]", type, {
    object_id: data?.object_id,
    tracking_number: data?.tracking_number,
    status: data?.tracking_status?.status || data?.status,
  });

  // TODO: persist to your DB (Supabase) — pseudo:
  //  - When type === "transaction_updated" and data.status === "SUCCESS":
  //      save label_url, tracking_number, tracking_url to the Order
  //  - When type === "track_updated":
  //      upsert tracking checkpoints & current status on the Order

  // Example structure you may want to emit back to your app
  const response = {
    ok: true,
    received: {
      type,
      object_id: data?.object_id || null,
      order_tag: data?.metadata || null, // we set metadata: `order:HM-12345` on create/purchase
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

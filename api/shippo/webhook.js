// api/shippo/webhook.js
// Handles incoming webhooks from Shippo to keep order_shipments up to date.

import { createClient } from "@supabase/supabase-js";

export const config = {
  api: {
    bodyParser: false, // Shippo sends raw JSON
  },
};

function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const rawBody = await buffer(req);
    const payload = JSON.parse(rawBody.toString("utf8"));

    // Shippo docs: payload.object === "event", payload.data contains transaction/shipment
    const eventType = payload.event || "unknown";
    const data = payload.data || {};

    // We expect metadata: order:HM-12345
    const metadata = data.metadata || "";
    const orderMatch = metadata.match(/order:(HM-\d+)/);
    const orderId = orderMatch ? orderMatch[1] : null;

    if (!orderId) {
      console.warn("Webhook with no orderId:", metadata);
      return res.status(200).json({ ok: true, skipped: true });
    }

    // Connect to Supabase (service role key required)
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const update = {
      status: data.status || null,
      tracking_number: data.tracking_number || null,
      tracking_url: data.tracking_url_provider || data.tracking_url || null,
      carrier: data.rate?.provider || null,
      service: data.rate?.servicelevel?.name || null,
      label_url: data.label_url || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("order_shipments")
      .update(update)
      .eq("order_id", orderId);

    if (error) {
      console.error("Supabase update error:", error);
      return res.status(500).json({ error: "Failed to update shipment" });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

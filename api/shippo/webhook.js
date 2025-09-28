// File: /api/shippo/webhook.js
// Handles incoming Shippo webhooks, updates Supabase, and emails buyer/seller.
// Env required:
// - SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
// - SUPABASE_SERVICE_ROLE_KEY
// - (for notify call) NEXT_PUBLIC_SITE_URL or SITE_URL pointing to your deployed domain

import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

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

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Resolve the base site URL for calling our notify endpoint
function getSiteBase() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    "" // if empty, the notify call will be skipped
  ).replace(/\/$/, "");
}

// Best-effort: look up buyer/seller emails from orders table
async function getOrderEmails(orderId) {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("buyer_email, seller_email")
      .eq("order_id", orderId)
      .limit(1)
      .maybeSingle();
    if (error || !data) return { buyer_email: null, seller_email: null };
    return {
      buyer_email: data.buyer_email || null,
      seller_email: data.seller_email || null,
    };
  } catch {
    return { buyer_email: null, seller_email: null };
  }
}

async function notifyShipment(payload) {
  const base = getSiteBase();
  if (!base) {
    console.warn("[notify] Skipping email notify — missing SITE_URL / NEXT_PUBLIC_SITE_URL");
    return;
  }
  try {
    const res = await fetch(`${base}/api/notify/shipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[notify] Failed:", res.status, json);
    } else {
      console.log("[notify] Sent:", json?.message || "ok");
    }
  } catch (err) {
    console.error("[notify] Exception:", err?.message || err);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const rawBody = await buffer(req);
    const payload = JSON.parse(rawBody.toString("utf-8"));

    // Shippo format: payload.object === "event", payload.data = transaction/shipment object
    const eventType = payload.event || payload.type || "unknown";
    const data = payload.data || {};

    // We expect metadata like "order:HM-12345"
    const meta = data.metadata || "";
    const m = String(meta).match(/order:(HM-\d+)/i);
    const orderId = m ? m[1] : null;

    if (!orderId) {
      console.warn("[shippo] Webhook without orderId metadata:", meta);
      res.status(200).json({ ok: true, skipped: true });
      return;
    }

    // Normalize fields we care about
    const update = {
      status: data.status || null,
      tracking_number: data.tracking_number || null,
      tracking_url: data.tracking_url_provider || data.tracking_url || null,
      carrier: data.rate?.provider || null,
      service: data.rate?.servicelevel?.name || null,
      label_url: data.label_url || null,
      updated_at: new Date().toISOString(),
    };

    // Update shipment record
    const { error } = await supabase
      .from("order_shipments")
      .update(update)
      .eq("order_id", orderId);

    if (error) {
      console.error("[shippo] Supabase update error:", error);
      res.status(500).json({ error: "Failed to update shipment" });
      return;
    }

    // Fire email notifications (best-effort)
    const { buyer_email, seller_email } = await getOrderEmails(orderId);

    // Choose a simple email status keyword
    const upper = String(update.status || "").toUpperCase();
    const statusForEmail =
      update.label_url && !upper ? "LABEL_CREATED" :
      upper.includes("SUCCESS") ? "LABEL_CREATED" :
      upper.includes("TRANSIT") || upper.includes("TRACK") ? "IN_TRANSIT" :
      upper.includes("DELIVERED") ? "DELIVERED" :
      upper || "UPDATED";

    await notifyShipment({
      orderId,
      status: statusForEmail,
      label_url: update.label_url,
      tracking_number: update.tracking_number,
      tracking_url: update.tracking_url,
      carrier: update.carrier,
      service: update.service,
      to_buyer: buyer_email || undefined,
      to_seller: seller_email || undefined,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[shippo] webhook error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

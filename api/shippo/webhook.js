// File: /api/shippo/webhook.js
// Upserts order_shipments from Shippo webhooks and emails buyer/seller.
// Requires unique constraint on order_shipments(order_id).

import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

export const config = { api: { bodyParser: false } };

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

function getSiteBase() {
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "").replace(/\/$/, "");
}

function looksLikeUUID(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ""));
}

async function getOrderEmails(orderId) {
  if (!looksLikeUUID(orderId)) {
    return { buyer_email: null, seller_email: null };
  }
  try {
    const { data, error } = await supabase
      .from("order_details")
      .select("buyer_email, seller_email")
      .eq("order_id", orderId)
      .maybeSingle();
    if (error) return { buyer_email: null, seller_email: null };
    return {
      buyer_email: data?.buyer_email || null,
      seller_email: data?.seller_email || null,
    };
  } catch {
    return { buyer_email: null, seller_email: null };
  }
}

async function notifyShipment(payload) {
  const base = getSiteBase();
  if (!base) return;
  try {
    const res = await fetch(`${base}/api/notify/shipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      console.error("[notify] Failed:", res.status, json);
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

    const data = payload.data || {};
    const meta = data.metadata || "";
    const m = String(meta).match(/order:([A-Za-z0-9\-]+)/);
    const orderId = m ? m[1] : null;

    if (!orderId) {
      console.warn("[shippo] Missing orderId in metadata:", meta);
      return res.status(200).json({ ok: true, skipped: true });
    }

    // Normalize incoming fields
    const update = {
      order_id: orderId,
      status: data.status || null,
      tracking_number: data.tracking_number || null,
      tracking_url: data.tracking_url_provider || data.tracking_url || null,
      carrier: data.rate?.provider || null,
      service: data.rate?.servicelevel?.name || null,
      label_url: data.label_url || null,
      updated_at: new Date().toISOString(),
    };

    // 🔑 Upsert so first webhook creates the row automatically
    const { error: upErr } = await supabase
      .from("order_shipments")
      .upsert(update, { onConflict: "order_id" });

    if (upErr) {
      console.error("[shippo] Supabase upsert error:", upErr);
      return res.status(500).json({ error: "Failed to upsert shipment" });
    }

    // Resolve recipients (best-effort)
    const { buyer_email, seller_email } = await getOrderEmails(orderId);

    // Pick a user-friendly status for email
    const upper = String(update.status || "").toUpperCase();
    const statusForEmail =
      update.label_url && !upper ? "LABEL_CREATED" :
      upper.includes("SUCCESS") ? "LABEL_CREATED" :
      upper.includes("DELIVERED") ? "DELIVERED" :
      upper.includes("TRANSIT") || upper.includes("TRACK") ? "IN_TRANSIT" :
      upper || "UPDATED";

    if (buyer_email || seller_email) {
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
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[shippo] webhook error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

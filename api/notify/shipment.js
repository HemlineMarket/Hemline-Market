// File: /api/notify/shipment.js
// Sends shipping notification emails (seller + buyer) via Postmark
// and logs each send to Supabase `email_log`.
//
// Env required (Vercel → Settings → Environment Variables):
// - POSTMARK_SERVER_TOKEN
// - POSTMARK_FROM  (or FROM_EMAIL)
// - SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
// - SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

const POSTMARK_API = "https://api.postmarkapp.com/email";

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function subjectFor(status, orderId) {
  const s = (status || "").toUpperCase();
  if (s === "PURCHASED" || s === "LABEL_CREATED") return `Label ready — Order ${orderId}`;
  if (s.includes("DELIVERED")) return `Delivered — Order ${orderId}`;
  if (s.includes("TRACK") || s.includes("TRANSIT")) return `Shipped — Order ${orderId}`;
  if (s.includes("ERROR") || s.includes("FAIL")) return `Shipping issue — Order ${orderId}`;
  return `Shipping update — Order ${orderId}`;
}

function htmlEmail({ orderId, status, label_url, tracking_number, tracking_url, carrier, service }, opts = {}) {
  const s = (status || "").toUpperCase();
  const hasLabel = !!label_url;
  const hasTracking = !!(tracking_url || tracking_number);
  const who = opts.audience || "Buyer";
  const carrierLine = [carrier, service].filter(Boolean).join(" — ");

  const ctaLabel = hasLabel
    ? `<a href="${label_url}" target="_blank" rel="noreferrer" style="background:#111827;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;display:inline-block">Download Label (PDF)</a>`
    : "";
  const ctaTrack = hasTracking
    ? `<a href="${tracking_url || "#"}" target="_blank" rel="noreferrer" style="background:#991b1b;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;display:inline-block;margin-left:8px">Track Shipment</a>`
    : "";

  const statusPretty =
    s === "PURCHASED" || s === "LABEL_CREATED" ? "Label Created" :
    s.includes("DELIVERED") ? "Delivered" :
    s.includes("TRANSIT") || s.includes("TRACK") ? "Shipped" :
    s.includes("ERROR") || s.includes("FAIL") ? "Shipping Issue" : "Shipping Update";

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;color:#111827;line-height:1.5">
    <h2 style="margin:0 0 8px">Order ${orderId} — ${statusPretty}</h2>
    <p style="margin:0 0 16px">Hi ${who}, here’s the latest shipping update for your order.</p>
    <ul style="margin:0 0 16px;padding-left:18px;color:#374151">
      ${carrierLine ? `<li><strong>Carrier/Service:</strong> ${carrierLine}</li>` : ""}
      ${tracking_number ? `<li><strong>Tracking #:</strong> ${tracking_number}</li>` : ""}
      ${hasLabel ? `<li><strong>Label:</strong> <a href="${label_url}" target="_blank" rel="noreferrer">Download PDF</a></li>` : ""}
      ${hasTracking && tracking_url ? `<li><strong>Tracking Link:</strong> <a href="${tracking_url}" target="_blank" rel="noreferrer">${tracking_url}</a></li>` : ""}
      <li><strong>Status:</strong> ${statusPretty}</li>
    </ul>
    <div style="margin:16px 0">${ctaLabel} ${ctaTrack}</div>
    <p style="color:#6b7280;font-size:12px">If you have questions, reply to this email.</p>
  </div>`;
}

function textEmail({ orderId, status, label_url, tracking_number, tracking_url, carrier, service }, opts = {}) {
  const who = opts.audience || "Buyer";
  const lines = [
    `Order ${orderId} — ${status}`,
    `Hi ${who}, here’s the latest shipping update.`,
    carrier ? `Carrier: ${carrier}` : null,
    service ? `Service: ${service}` : null,
    tracking_number ? `Tracking #: ${tracking_number}` : null,
    tracking_url ? `Tracking: ${tracking_url}` : null,
    label_url ? `Label: ${label_url}` : null,
    ``,
    `Questions? Reply to this email.`,
  ].filter(Boolean);
  return lines.join("\n");
}

async function sendViaPostmark({ to, subject, html, text }) {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.POSTMARK_FROM || process.env.FROM_EMAIL;
  if (!token || !from) {
    throw new Error("Missing POSTMARK_SERVER_TOKEN or POSTMARK_FROM/FROM_EMAIL");
  }

  const res = await fetch(POSTMARK_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": token,
    },
    body: JSON.stringify({
      From: from,
      To: to,
      Subject: subject,
      HtmlBody: html,
      TextBody: text,
      MessageStream: "outbound",
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = `Postmark error: ${res.status} ${JSON.stringify(json)}`;
    throw new Error(msg);
  }
  return json; // contains MessageID, SubmittedAt, etc.
}

async function logEmail({ to_email, subject, status, provider_id, template, payload, error }) {
  try {
    await supabase.from("email_log").insert({
      to_email,
      subject: subject || null,
      status: status || null,
      provider_id: provider_id || null,
      template: template || "shipment_update",
      payload: payload ? JSON.stringify(payload) : null,
      error: error ? JSON.stringify(error) : null,
    });
  } catch (e) {
    console.error("[email_log] insert error:", e?.message || e);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const {
      orderId,
      status,
      label_url,
      tracking_number,
      tracking_url,
      carrier,
      service,
      to_seller,
      to_buyer,
    } = req.body || {};

    if (!orderId) return res.status(400).json({ error: "Missing orderId" });
    if (!to_seller && !to_buyer) return res.status(400).json({ error: "No recipients provided" });

    const basePayload = { orderId, status, label_url, tracking_number, tracking_url, carrier, service };
    const subject = subjectFor(status, orderId);

    const sends = [];
    const results = [];

    // Send to Seller
    if (to_seller) {
      const html = htmlEmail(basePayload, { audience: "Seller" });
      const text = textEmail(basePayload, { audience: "Seller" });
      try {
        const pm = await sendViaPostmark({ to: to_seller, subject, html, text });
        results.push({ audience: "seller", ok: true, provider: pm });
        await logEmail({
          to_email: to_seller,
          subject,
          status: "sent",
          provider_id: pm?.MessageID || null,
          template: "shipment_update",
          payload: { audience: "seller", ...basePayload },
        });
      } catch (err) {
        results.push({ audience: "seller", ok: false, error: err?.message || String(err) });
        await logEmail({
          to_email: to_seller,
          subject,
          status: "failed",
          provider_id: null,
          template: "shipment_update",
          payload: { audience: "seller", ...basePayload },
          error: { message: err?.message || String(err) },
        });
      }
    }

    // Send to Buyer
    if (to_buyer) {
      const html = htmlEmail(basePayload, { audience: "Buyer" });
      const text = textEmail(basePayload, { audience: "Buyer" });
      try {
        const pm = await sendViaPostmark({ to: to_buyer, subject, html, text });
        results.push({ audience: "buyer", ok: true, provider: pm });
        await logEmail({
          to_email: to_buyer,
          subject,
          status: "sent",
          provider_id: pm?.MessageID || null,
          template: "shipment_update",
          payload: { audience: "buyer", ...basePayload },
        });
      } catch (err) {
        results.push({ audience: "buyer", ok: false, error: err?.message || String(err) });
        await logEmail({
          to_email: to_buyer,
          subject,
          status: "failed",
          provider_id: null,
          template: "shipment_update",
          payload: { audience: "buyer", ...basePayload },
          error: { message: err?.message || String(err) },
        });
      }
    }

    const anyFailed = results.some(r => !r.ok);
    return res.status(anyFailed ? 207 : 200).json({
      ok: !anyFailed,
      message: anyFailed ? "Some emails failed" : "Emails sent",
      results,
    });
  } catch (err) {
    console.error("[notify/shipment] error", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

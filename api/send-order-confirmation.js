// File: /api/send-order-confirmation.js
// Sends an order-confirmation email using Postmark.
// Called by /api/stripe/webhook after checkout.session.completed.
//
// ENV required:
// - POSTMARK_SERVER_TOKEN  (Postmark → Server → API Tokens)
// - FROM_EMAIL             (verified sender in Postmark)
// Optional:
// - SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY  (to write to email_log, if you created it)

import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: true } };

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const hasSupabase = SUPABASE_URL && SUPABASE_KEY;

const supabase = hasSupabase
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

function renderItems(items = []) {
  if (!items.length) return "<p><em>Order details not available.</em></p>";
  const rows = items
    .map(
      (it) =>
        `<tr><td style="padding:6px 10px;border:1px solid #eee">${escapeHtml(
          it.name || "Item"
        )}</td><td style="padding:6px 10px;border:1px solid #eee;text-align:right">${Number(
          it.qty || 1
        )}</td></tr>`
    )
    .join("");
  return `
    <table style="border-collapse:collapse;border:1px solid #eee">
      <thead>
        <tr>
          <th style="padding:6px 10px;border:1px solid #eee;text-align:left">Item</th>
          <th style="padding:6px 10px;border:1px solid #eee;text-align:right">Qty</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function htmlTemplate({ orderId, items }) {
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;color:#111">
    <h2 style="margin:0 0 8px">Thanks for your order!</h2>
    <p style="margin:0 0 10px">Your order <strong>${escapeHtml(
      orderId || ""
    )}</strong> has been received.</p>
    ${renderItems(items)}
    <p style="margin:14px 0 0">We’ll email you tracking when the seller ships.</p>
    <p style="margin:6px 0 0;color:#6b7280;font-size:12px">Hemline Market</p>
  </div>`;
}

function textTemplate({ orderId, items }) {
  const lines = (items || [])
    .map((it) => `- ${it.name || "Item"} x ${it.qty || 1}`)
    .join("\n");
  return `Thanks for your order!

Order: ${orderId || ""}

Items:
${lines || "(details not available)"}

We’ll email you tracking when the seller ships.
Hemline Market`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { to, orderId, items = [] } = req.body || {};
    if (!to || !orderId) {
      return res.status(400).json({ error: "Missing to or orderId" });
    }

    const token = process.env.POSTMARK_SERVER_TOKEN;
    const from = process.env.FROM_EMAIL;
    if (!token || !from) {
      return res
        .status(500)
        .json({ error: "Missing POSTMARK_SERVER_TOKEN or FROM_EMAIL" });
    }

    const subject = `Order ${orderId} — Confirmation`;
    const HtmlBody = htmlTemplate({ orderId, items });
    const TextBody = textTemplate({ orderId, items });

    const pmResp = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": token,
      },
      body: JSON.stringify({
        From: from,
        To: to,
        Subject: subject,
        HtmlBody,
        TextBody,
        MessageStream: "outbound", // default transactional stream
        Metadata: { orderId },
        Tag: "order-confirmation",
      }),
    });

    const data = await pmResp.json();

    if (!pmResp.ok) {
      console.error("[send-order-confirmation] Postmark error:", data);
      return res.status(502).json({ error: "Postmark send failed", details: data });
    }

    // Optional: log to email_log if your table exists
    if (hasSupabase) {
      try {
        await supabase.from("email_log").insert({
          to_email: to,
          subject,
          status: "queued",
          template: "order-confirmation",
          provider_id: data.MessageID || data.MessageId || null,
          payload: JSON.stringify({ orderId, items }),
        });
      } catch (e) {
        // non-fatal
        console.warn("[send-order-confirmation] email_log insert warn:", e?.message || e);
      }
    }

    return res.status(200).json({
      ok: true,
      messageId: data.MessageID || data.MessageId || null,
    });
  } catch (err) {
    console.error("[send-order-confirmation] error:", err?.message || err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

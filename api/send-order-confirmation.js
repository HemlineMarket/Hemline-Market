// File: /api/send-order-confirmation.js
// Sends buyer order-confirmation via Postmark AND logs to Supabase email_log.
//
// Env: POSTMARK_SERVER_TOKEN, FROM_EMAIL or POSTMARK_FROM,
//      SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
//      SITE_URL (or NEXT_PUBLIC_SITE_URL)

import { createClient } from "@supabase/supabase-js";

const POSTMARK_API = "https://api.postmarkapp.com/email";

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };

function siteBase(req) {
  const base =
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (req.headers["x-forwarded-proto"] && req.headers["x-forwarded-host"]
      ? `${req.headers["x-forwarded-proto"]}://${req.headers["x-forwarded-host"]}`
      : `https://${req.headers.host}`);
  return String(base).replace(/\/$/, "");
}

function htmlBody({ orderId, items, site }) {
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;color:#111827">
    <h2 style="margin:0 0 8px">Thanks for your order!</h2>
    <p style="margin:0 0 12px">Your order <strong>${orderId}</strong> has been received.</p>
    ${
      Array.isArray(items) && items.length
        ? `<ul style="margin:0 0 16px;padding-left:18px;color:#374151">
            ${items
              .map(
                (i) =>
                  `<li>${Number(i.qty || i.quantity || 1)} × ${String(i.name || "").slice(
                    0,
                    120
                  )}</li>`
              )
              .join("")}
          </ul>`
        : ""
    }
    <p style="margin:0 0 16px">
      You can view your order at
      <a href="${site}/orders-buyer.html" target="_blank" rel="noreferrer">My Orders</a>.
    </p>
    <p style="color:#6b7280;font-size:12px">If you have questions, reply to this email.</p>
  </div>`;
}

function textBody({ orderId, items, site }) {
  const lines = [
    `Thanks for your order!`,
    `Order: ${orderId}`,
    ...(Array.isArray(items) && items.length
      ? items.map((i) => `- ${Number(i.qty || i.quantity || 1)} x ${String(i.name || "")}`)
      : []),
    ``,
    `View your order: ${site}/orders-buyer.html`,
  ];
  return lines.join("\n");
}

async function sendPostmark({ to, subject, html, text }) {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.POSTMARK_FROM || process.env.FROM_EMAIL;
  if (!token || !from) throw new Error("Missing POSTMARK_SERVER_TOKEN or FROM_EMAIL/POSTMARK_FROM");

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
    throw new Error(`Postmark error: ${res.status} ${JSON.stringify(json)}`);
  }
  return json; // includes MessageID
}

async function logEmail({ to_email, subject, status, provider_id, payload, error }) {
  try {
    await supabase.from("email_log").insert({
      to_email,
      subject: subject || null,
      status: status || null,               // sent | failed
      provider_id: provider_id || null,     // Postmark MessageID
      template: "order_confirmation",
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
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const to = String(body.to || "").trim();
    const orderId = String(body.orderId || "").trim();
    const items = Array.isArray(body.items) ? body.items : [];

    if (!to || !orderId) {
      return res.status(400).json({ error: "Missing to or orderId" });
    }

    const site = siteBase(req);
    const subject = `Your Hemline Market Order ${orderId}`;
    const html = htmlBody({ orderId, items, site });
    const text = textBody({ orderId, items, site });

    try {
      const pm = await sendPostmark({ to, subject, html, text });
      await logEmail({
        to_email: to,
        subject,
        status: "sent",
        provider_id: pm?.MessageID || null,
        payload: { orderId, items },
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      await logEmail({
        to_email: to,
        subject,
        status: "failed",
        provider_id: null,
        payload: { orderId, items },
        error: { message: err?.message || String(err) },
      });
      return res.status(502).json({ error: "Failed to send email" });
    }
  } catch (err) {
    console.error("send-order-confirmation error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

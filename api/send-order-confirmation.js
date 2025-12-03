// File: /api/send-order-confirmation.js
// Sends the buyer an order confirmation email via Postmark (or logs if disabled).
// ENV needed:
//   POSTMARK_SERVER_TOKEN (or leave unset to no-op in dev)
//   POSTMARK_FROM_EMAIL   (e.g. "orders@hemlinemarket.com")

import { buffer } from "micro";

export const config = {
  api: {
    bodyParser: false, // we'll parse JSON ourselves from the raw body
  },
};

async function readJson(req) {
  const raw = (await buffer(req)).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error("Invalid JSON in request body");
  }
}

function buildPlainText({ orderId, items }) {
  const lines = [];
  lines.push("Thank you for your Hemline Market order! 💌");
  lines.push("");
  lines.push(`Order ID: ${orderId}`);
  lines.push("");

  if (Array.isArray(items) && items.length) {
    lines.push("Items:");
    for (const it of items) {
      const name = it.name || "Item";
      const qty = it.qty || 1;
      lines.push(` • ${name} × ${qty}`);
    }
    lines.push("");
  }

  lines.push(
    "Your payment has been received and your order is now pending. " +
      "You have 30 minutes from the time of checkout to cancel this order from your Hemline Market account if needed."
  );
  lines.push(
    "Sellers are asked not to ship during this 30-minute cancellation window. After that, your order is locked and can no longer be cancelled through Hemline Market."
  );
  lines.push("");
  lines.push("You’ll receive another email once your seller prints a shipping label or updates tracking.");
  lines.push("");
  lines.push("Love,");
  lines.push("Hemline Market");

  return lines.join("\n");
}

function buildHtml({ orderId, items }) {
  const itemHtml =
    Array.isArray(items) && items.length
      ? `
      <p style="margin:0 0 8px;font-size:14px;">Items:</p>
      <ul style="margin:0 0 16px;padding-left:18px;font-size:14px;">
        ${items
          .map((it) => {
            const name = it.name || "Item";
            const qty = it.qty || 1;
            return `<li>${escapeHtml(name)} × ${qty}</li>`;
          })
          .join("")}
      </ul>
    `
      : "";

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
              font-size:14px;line-height:1.5;color:#111827;">
    <p style="margin:0 0 12px;">Thank you for your Hemline Market order! 💌</p>

    <p style="margin:0 0 8px;">
      <strong>Order ID:</strong>
      <span style="font-family:Menlo,Consolas,monospace;">
        ${escapeHtml(orderId || "")}
      </span>
    </p>

    ${itemHtml}

    <p style="margin:0 0 8px;">
      Your payment has been received and your order is now <strong>pending</strong>.
      You have <strong>30 minutes</strong> from checkout to cancel this order from your Hemline Market account
      if something looks wrong.
    </p>

    <p style="margin:0 0 8px;">
      Sellers are asked <strong>not to ship</strong> during this 30-minute cancellation window.
      After that, your order is locked and can no longer be cancelled through Hemline Market.
    </p>

    <p style="margin:0 0 12px;">
      You’ll receive another email once your seller prints a shipping label or updates tracking.
    </p>

    <p style="margin:12px 0 0;">
      Love,<br/>
      <strong>Hemline Market</strong>
    </p>
  </div>
  `;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res
      .status(405)
      .json({ error: "Method Not Allowed. Use POST with JSON body." });
  }

  try {
    const body = await readJson(req);
    const to = (body.to || "").trim();
    const orderId = (body.orderId || "").trim();
    const items = Array.isArray(body.items) ? body.items : [];

    if (!to || !orderId) {
      return res
        .status(400)
        .json({ error: "Missing required fields: to, orderId" });
    }

    const serverToken = process.env.POSTMARK_SERVER_TOKEN || "";
    const from = process.env.POSTMARK_FROM_EMAIL || "";

    const plainText = buildPlainText({ orderId, items });
    const htmlBody = buildHtml({ orderId, items });

    // If Postmark is not configured, log and noop (useful in dev)
    if (!serverToken || !from) {
      console.log("[send-order-confirmation] (dry run)", {
        to,
        fromConfigured: !!from,
        serverTokenConfigured: !!serverToken,
        subject: "Your Hemline Market order",
        text: plainText,
      });
      return res.status(200).json({ ok: true, dryRun: true });
    }

    const postmarkRes = await fetch(
      "https://api.postmarkapp.com/email",
      {
        method: "POST",
        headers: {
          "X-Postmark-Server-Token": serverToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          From: from,
          To: to,
          Subject: "Your Hemline Market order",
          TextBody: plainText,
          HtmlBody: htmlBody,
          MessageStream: "outbound",
        }),
      }
    );

    if (!postmarkRes.ok) {
      const t = await postmarkRes.text();
      console.error(
        "[send-order-confirmation] Postmark error",
        postmarkRes.status,
        t
      );
      return res.status(502).json({ error: "Email send failed" });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(
      "[send-order-confirmation] Unhandled error",
      err?.message || err
    );
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

// /api/send-order-email.js
// Vercel/Next.js style serverless function to send an order email via Postmark.
// Expects POST JSON body with at least { to, order: { id, items:[{name, qty, price}], total } }.
// Uses env var POSTMARK_SERVER_TOKEN (already set in Vercel).

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    }

    const POSTMARK_TOKEN = process.env.POSTMARK_SERVER_TOKEN;
    if (!POSTMARK_TOKEN) {
      return res.status(500).json({ ok: false, error: "Missing POSTMARK_SERVER_TOKEN" });
    }

    const body = await readJson(req);
    const to = (body?.to || "").trim();
    const order = body?.order || {};
    if (!to) {
      return res.status(400).json({ ok: false, error: "Missing 'to' email" });
    }

    // Basic order fields with safe fallbacks
    const orderId = order.id || `HM-${Date.now()}`;
    const items = Array.isArray(order.items) ? order.items : [];
    const total = typeof order.total === "number" ? order.total : sumTotal(items);
    const shipping = order.shipping || {};
    const buyer = order.buyer || {};

    const subject = body?.subject || `Order ${orderId} — Hemline Market`;
    const from = 'Hemline Market <hello@hemlinemarket.com>';
    const textBody = buildText({ orderId, items, total, shipping, buyer });
    const htmlBody = buildHtml({ orderId, items, total, shipping, buyer });

    const resp = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": POSTMARK_TOKEN
      },
      body: JSON.stringify({
        From: from,
        To: to,
        Subject: subject,
        TextBody: textBody,
        HtmlBody: htmlBody,
        MessageStream: "outbound"
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({ ok: false, error: data?.Message || "Postmark error", data });
    }

    return res.status(200).json({ ok: true, messageId: data?.MessageID || data?.MessageId || null });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}

/* ---------- helpers ---------- */

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

function sumTotal(items) {
  return items.reduce((acc, it) => {
    const qty = Number(it.qty || 1);
    const price = Number(it.price || 0);
    return acc + qty * price;
  }, 0);
}

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function buildText({ orderId, items, total, shipping, buyer }) {
  const lines = [];
  lines.push(`Order ${orderId}`);
  lines.push(`====================`);
  if (buyer?.name || buyer?.email) {
    lines.push(`Buyer: ${[buyer?.name, buyer?.email].filter(Boolean).join(" — ")}`);
  }
  lines.push("");
  if (items.length) {
    lines.push("Items:");
    for (const it of items) {
      lines.push(`- ${it.name || "Item"}  x${it.qty || 1}  @ ${money(it.price || 0)}`);
    }
  } else {
    lines.push("No items provided.");
  }
  lines.push("");
  lines.push(`Total: ${money(total)}`);
  if (shipping && (shipping.address1 || shipping.city)) {
    lines.push("");
    lines.push("Ship to:");
    lines.push([shipping.name, shipping.address1, shipping.address2].filter(Boolean).join(", "));
    lines.push([shipping.city, shipping.state, shipping.postal].filter(Boolean).join(", "));
    if (shipping.country) lines.push(shipping.country);
  }
  lines.push("");
  lines.push("Thank you for using Hemline Market.");
  return lines.join("\n");
}

function buildHtml({ orderId, items, total, shipping, buyer }) {
  const itemRows = items.map(it => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(it.name || "Item")}</td>
      <td style="padding:6px 8px;text-align:center;border-bottom:1px solid #eee;">${it.qty || 1}</td>
      <td style="padding:6px 8px;text-align:right;border-bottom:1px solid #eee;">${money(it.price || 0)}</td>
    </tr>`).join("");

  const shipBlock = (shipping && (shipping.address1 || shipping.city)) ? `
    <p style="margin:0;color:#111;"><strong>Ship to</strong><br/>
      ${[shipping.name, shipping.address1, shipping.address2].filter(Boolean).map(escapeHtml).join("<br/>")}<br/>
      ${[shipping.city, shipping.state, shipping.postal].filter(Boolean).map(escapeHtml).join(", ")}<br/>
      ${shipping.country ? escapeHtml(shipping.country) : ""}
    </p>` : "";

  const buyerLine = (buyer?.name || buyer?.email)
    ? `<p style="margin:0 0 6px 0;color:#374151;"><strong>Buyer:</strong> ${[buyer?.name, buyer?.email].filter(Boolean).map(escapeHtml).join(" — ")}</p>`
    : "";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f7f9;color:#111;font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:20px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #eee;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:16px 18px;border-bottom:1px solid #eee;">
                <div style="font-weight:800;font-size:18px;color:#991b1b;">Hemline Market</div>
                <div style="color:#6b7280;font-size:13px;">Order ${escapeHtml(orderId)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 18px;">
                ${buyerLine}
                <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
                  <thead>
                    <tr>
                      <th align="left"  style="padding:6px 8px;border-bottom:2px solid #e5e7eb;color:#374151;">Item</th>
                      <th align="center" style="padding:6px 8px;border-bottom:2px solid #e5e7eb;color:#374151;">Qty</th>
                      <th align="right" style="padding:6px 8px;border-bottom:2px solid #e5e7eb;color:#374151;">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${itemRows || `<tr><td colspan="3" style="padding:8px;color:#6b7280;">No items provided.</td></tr>`}
                    <tr>
                      <td colspan="2" style="padding:10px 8px;text-align:right;font-weight:700;">Total</td>
                      <td style="padding:10px 8px;text-align:right;font-weight:700;">${money(total)}</td>
                    </tr>
                  </tbody>
                </table>
                <div style="margin-top:14px;font-size:14px;color:#374151;">
                  ${shipBlock}
                </div>
                <p style="margin-top:18px;color:#6b7280;font-size:13px;">Thanks for using Hemline Market.</p>
              </td>
            </tr>
          </table>
          <div style="color:#9ca3af;font-size:12px;margin-top:10px;">© ${new Date().getFullYear()} Hemline Market</div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

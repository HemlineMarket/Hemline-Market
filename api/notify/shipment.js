// File: /api/notify/shipment.js
// Sends shipping notification emails (seller + buyer) via Postmark.
// Env required (Vercel -> Settings -> Environment Variables):
// - POSTMARK_SERVER_TOKEN  (your Postmark Server Token)
// - POSTMARK_FROM          (e.g., "no-reply@hemline.market")
//
// Usage (POST JSON):
// {
//   "orderId": "HM-771234",
//   "status": "PURCHASED",       // or TRACKING, DELIVERED, ERROR, etc.
//   "label_url": "https://...pdf",
//   "tracking_number": "9400...",
//   "tracking_url": "https://tools.usps.com/go/TrackConfirmAction_input?qtc_tLabels1=...",
//   "carrier": "USPS",
//   "service": "Priority Mail",
//   "to_seller": "seller@example.com",  // optional
//   "to_buyer": "buyer@example.com"     // optional
// }

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

const POSTMARK_API = "https://api.postmarkapp.com/email";

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

async function sendEmail({ to, subject, html, text }) {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.POSTMARK_FROM;
  if (!token || !from) {
    throw new Error("Missing POSTMARK_SERVER_TOKEN or POSTMARK_FROM");
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
      MessageStream: "outbound", // change if you use a different stream
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Postmark error: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
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

    const payload = { orderId, status, label_url, tracking_number, tracking_url, carrier, service };
    const subj = subjectFor(status, orderId);

    const sends = [];

    if (to_seller) {
      sends.push(
        sendEmail({
          to: to_seller,
          subject: subj,
          html: htmlEmail(payload, { audience: "Seller" }),
          text: textEmail(payload, { audience: "Seller" }),
        })
      );
    }

    if (to_buyer) {
      sends.push(
        sendEmail({
          to: to_buyer,
          subject: subj,
          html: htmlEmail(payload, { audience: "Buyer" }),
          text: textEmail(payload, { audience: "Buyer" }),
        })
      );
    }

    const results = await Promise.allSettled(sends);
    const failed = results.filter(r => r.status === "rejected");
    if (failed.length) {
      return res.status(207).json({ ok: false, message: "Some emails failed", results });
    }

    return res.status(200).json({ ok: true, message: "Emails sent", results });
  } catch (err) {
    console.error("[notify/shipment] error", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

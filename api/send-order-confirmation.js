// /api/send-order-confirmation.js
// Vercel serverless API endpoint (Node 18+) that sends the "Order Confirmation"
// email via Postmark using your template. Requires env var: POSTMARK_SERVER_TOKEN.

const TEMPLATE_ID = 41390805; // your Postmark template ID (visible in the UI)

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  // Basic body parse & validation
  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON body" });
  }

  const { to, orderId, itemName, itemPrice, orderTotal } = body || {};
  if (!to || !orderId || !itemName || !itemPrice || !orderTotal) {
    return res.status(400).json({
      ok: false,
      error:
        "Missing required fields: to, orderId, itemName, itemPrice, orderTotal",
    });
  }

  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) {
    return res
      .status(500)
      .json({ ok: false, error: "POSTMARK_SERVER_TOKEN not set" });
  }

  try {
    // Call Postmark Email With Template API
    const pmRes = await fetch("https://api.postmarkapp.com/email/withTemplate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": token,
      },
      body: JSON.stringify({
        From: "Hemline Market <hello@hemlinemarket.com>",
        To: to,
        TemplateId: TEMPLATE_ID,
        TemplateModel: {
          orderId,
          itemName,
          itemPrice,
          orderTotal,
        },
        MessageStream: "outbound", // keep default transactional stream
      }),
    });

    const data = await pmRes.json();
    if (!pmRes.ok) {
      return res.status(pmRes.status).json({
        ok: false,
        error: data?.Message || "Postmark API error",
      });
    }

    return res.status(200).json({
      ok: true,
      to,
      messageId: data?.MessageID || null,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Unexpected server error",
      detail: String(err?.message || err),
    });
  }
}

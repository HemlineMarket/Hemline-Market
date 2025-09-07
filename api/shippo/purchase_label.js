// /api/shippo/purchase_label.js
import fetch from "node-fetch";

/**
 * Body (JSON):
 * {
 *   "orderId": "HM-12345",
 *   "rate_id": "rate_XXXXXXXX",   // Picked from /api/shippo/create_label response
 *   "label_file_type": "PDF"      // optional, default PDF (also: PNG, ZPL)
 * }
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { orderId, rate_id, label_file_type = "PDF" } = req.body || {};
    if (!rate_id) return res.status(400).json({ error: "Missing rate_id" });

    const resp = await fetch("https://api.goshippo.com/transactions/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `ShippoToken ${process.env.SHIPPO_API_TOKEN}`,
      },
      body: JSON.stringify({
        rate: rate_id,
        async: false,
        label_file_type,
      }),
    });

    const tx = await resp.json();

    // Shippo returns status SUCCESS / ERROR
    if (tx.status !== "SUCCESS") {
      // Surface a concise message for UI + full payload for logging
      return res.status(502).json({
        error: "Label purchase not successful",
        details: tx.messages || tx,
      });
    }

    // What you’ll typically save with the order:
    const result = {
      orderId,
      transaction_id: tx.object_id,
      label_url: tx.label_url,
      tracking_number: tx.tracking_number,
      tracking_url: tx.tracking_url_provider || tx.tracking_url,
      carrier: tx.rate?.provider,          // e.g., "USPS"
      service: tx.rate?.servicelevel?.name // e.g., "Priority Mail"
    };

    // TODO (launch): persist `result` on your Order record

    return res.status(200).json(result);
  } catch (err) {
    console.error("purchase_label error:", err);
    return res.status(500).json({ error: "Failed to purchase label" });
  }
}

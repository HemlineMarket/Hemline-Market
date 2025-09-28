// File: /api/shippo/purchase_label.js
// Purchases a label for a selected Shippo rate
// Saves the result to Supabase (order_shipments)

import { saveOrderShipment } from "../../lib/db-shipments.js";

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
        Authorization: `ShippoToken ${process.env.SHIPPO_API_KEY}`,
      },
      body: JSON.stringify({
        rate: rate_id,
        async: false,
        label_file_type,
        metadata: orderId ? `order:${orderId}` : undefined,
      }),
    });

    const tx = await resp.json();

    if (tx.status !== "SUCCESS") {
      return res.status(502).json({
        error: "Label purchase not successful",
        details: tx.messages || tx,
      });
    }

    const result = {
      orderId,
      transaction_id: tx.object_id,
      label_url: tx.label_url,
      tracking_number: tx.tracking_number,
      tracking_url: tx.tracking_url_provider || tx.tracking_url,
      carrier: tx.rate?.provider,
      service: tx.rate?.servicelevel?.name,
      rate_amount: tx.rate?.amount,
      rate_currency: tx.rate?.currency,
      status: "PURCHASED",
      raw: tx,
    };

    // Save to Supabase
    await saveOrderShipment(result);

    return res.status(200).json(result);
  } catch (err) {
    console.error("purchase_label error:", err);
    return res.status(500).json({ error: "Failed to purchase label" });
  }
}

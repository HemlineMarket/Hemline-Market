// File: /api/shippo/create_label.js
// Creates a shipping label via Shippo for a given order
// Requires SHIPPO_API_KEY in Vercel env

import fetch from "node-fetch";

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { orderId, address_from, address_to, parcel } = req.body || {};

    if (!orderId || !address_from || !address_to || !parcel) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const apiKey = process.env.SHIPPO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing SHIPPO_API_KEY" });
    }

    // Create shipment
    const shipmentRes = await fetch("https://api.goshippo.com/shipments/", {
      method: "POST",
      headers: {
        "Authorization": `ShippoToken ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address_from,
        address_to,
        parcels: [parcel],
        async: false,
        metadata: `order:${orderId}`, // 👈 tie shipment to orderId
      }),
    });

    const shipment = await shipmentRes.json();

    if (!shipment.rates || !shipment.rates.length) {
      return res.status(400).json({ error: "No shipping rates found" });
    }

    // Pick the cheapest rate
    const rate = shipment.rates.sort(
      (a, b) => parseFloat(a.amount) - parseFloat(b.amount)
    )[0];

    // Buy the label
    const transactionRes = await fetch("https://api.goshippo.com/transactions/", {
      method: "POST",
      headers: {
        "Authorization": `ShippoToken ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rate: rate.object_id,
        label_file_type: "PDF",
        async: false,
        metadata: `order:${orderId}`, // 👈 store orderId with label too
      }),
    });

    const transaction = await transactionRes.json();

    if (transaction.status !== "SUCCESS") {
      return res.status(500).json({ error: "Label purchase failed", details: transaction });
    }

    return res.status(200).json({
      orderId,
      tracking_number: transaction.tracking_number,
      label_url: transaction.label_url,
      rate: transaction.rate,
    });
  } catch (err) {
    console.error("Shippo label error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

// File: /api/shippo/create_label.js
// Creates a shipping label via Shippo for a given order
// Requires SHIPPO_API_KEY in Vercel env (already set)

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

    // 1) Create shipment → get rates
    const shipmentRes = await fetch("https://api.goshippo.com/shipments/", {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address_from,
        address_to,
        parcels: [parcel],
        async: false,
        metadata: `order:${orderId}`,
      }),
    });

    if (!shipmentRes.ok) {
      const txt = await shipmentRes.text();
      return res.status(shipmentRes.status).json({ error: "Shippo shipments failed", details: txt });
    }

    const shipment = await shipmentRes.json();

    if (!Array.isArray(shipment.rates) || shipment.rates.length === 0) {
      return res.status(400).json({ error: "No shipping rates found" });
    }

    // Pick cheapest by amount
    const rate = shipment.rates
      .map(r => ({ ...r, _amt: parseFloat(r.amount) }))
      .sort((a, b) => a._amt - b._amt)[0];

    // 2) Buy label
    const txRes = await fetch("https://api.goshippo.com/transactions/", {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rate: rate.object_id,
        label_file_type: "PDF",
        async: false,
        metadata: `order:${orderId}`,
      }),
    });

    if (!txRes.ok) {
      const txt = await txRes.text();
      return res.status(txRes.status).json({ error: "Shippo transactions failed", details: txt });
    }

    const transaction = await txRes.json();

    if (transaction.status !== "SUCCESS") {
      return res.status(500).json({ error: "Label purchase failed", details: transaction });
    }

    return res.status(200).json({
      orderId,
      tracking_number: transaction.tracking_number,
      tracking_url: transaction.tracking_url_provider,
      label_url: transaction.label_url,
      rate: transaction.rate,
    });
  } catch (err) {
    console.error("Shippo label error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

// File: /api/shipping/label.js
// Creates a shipment (gets rates), picks cheapest, and purchases a label via Shippo
// Uses SHIPPO_API_KEY from Vercel env (do NOT log the secret)

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

    // 1) Create shipment → fetch rates
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
      return res
        .status(shipmentRes.status)
        .json({ error: "Shippo /shipments failed", details: txt });
    }

    const shipment = await shipmentRes.json();
    const rates = Array.isArray(shipment.rates) ? shipment.rates : [];
    if (!rates.length) {
      return res.status(400).json({ error: "No shipping rates found" });
    }

    // pick cheapest rate
    const rate = rates
      .map(r => ({ ...r, _amt: parseFloat(r.amount) }))
      .sort((a, b) => a._amt - b._amt)[0];

    // 2) Buy label for selected rate
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
      return res
        .status(txRes.status)
        .json({ error: "Shippo /transactions failed", details: txt });
    }

    const tx = await txRes.json();
    if (tx.status !== "SUCCESS") {
      return res
        .status(502)
        .json({ error: "Label purchase not successful", details: tx });
    }

    // response payload
    return res.status(200).json({
      orderId,
      shipment_id: shipment.object_id,
      rate: {
        id: rate.object_id,
        amount: rate.amount,
        currency: rate.currency,
        provider: rate.provider,
        service: rate.servicelevel?.name || rate.servicelevel?.token,
      },
      transaction_id: tx.object_id,
      label_url: tx.label_url,
      tracking_number: tx.tracking_number,
      tracking_url: tx.tracking_url_provider || tx.tracking_url,
    });
  } catch (err) {
    console.error("shipping/label error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

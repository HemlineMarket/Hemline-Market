// File: /api/shipping/eta.js
// Estimates delivery dates by fetching rates from Shippo
// Uses SHIPPO_API_KEY from Vercel env

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { address_from, address_to, parcel } = req.body || {};

    if (!address_from || !address_to || !parcel) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const apiKey = process.env.SHIPPO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing SHIPPO_API_KEY" });
    }

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

    // Map out ETAs
    const etaInfo = rates.map(r => ({
      provider: r.provider,
      service: r.servicelevel?.name || r.servicelevel?.token,
      est_days: r.estimated_days || null,
      amount: r.amount,
      currency: r.currency,
    }));

    return res.status(200).json({
      shipment_id: shipment.object_id,
      eta: etaInfo,
    });
  } catch (err) {
    console.error("shipping/eta error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

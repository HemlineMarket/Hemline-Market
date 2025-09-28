// File: /api/shipping/rates.js
// Returns available shipping rates from Shippo for a given shipment (no purchase)
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
    const { orderId, address_from, address_to, parcel } = req.body || {};

    if (!address_from || !address_to || !parcel) {
      return res.status(400).json({ error: "address_from, address_to, and parcel are required" });
    }

    const apiKey = process.env.SHIPPO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing SHIPPO_API_KEY" });
    }

    // Create a shipment to get rates
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
        metadata: orderId ? `order:${orderId}` : undefined,
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
      return res.status(200).json({ shipment_id: shipment.object_id, rates: [] });
    }

    // Normalize + sort by price ascending
    const normalized = rates
      .map(r => ({
        id: r.object_id,
        amount: parseFloat(r.amount),
        amount_str: r.amount,
        currency: r.currency,
        provider: r.provider,
        service: r.servicelevel?.name || r.servicelevel?.token,
        est_days: r.estimated_days,
        carrier_account: r.carrier_account,
      }))
      .sort((a, b) => a.amount - b.amount);

    return res.status(200).json({
      shipment_id: shipment.object_id,
      rates: normalized,
      cheapest_rate_id: normalized[0]?.id || null,
    });
  } catch (err) {
    console.error("shipping/rates error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

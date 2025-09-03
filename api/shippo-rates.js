// /api/shippo-rates.js  — Vercel serverless function
// Requires env var: SHIPPO_API_KEY
// POST body (JSON):
// {
//   "to": { "name":"", "street1":"", "street2":"", "city":"", "state":"", "zip":"", "country":"US" },
//   "parcel": { "length": 12, "width": 9, "height": 2, "distance_unit": "in", "weight": 1.0, "mass_unit": "lb" }
// }

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const SHIPPO_API_KEY = process.env.SHIPPO_API_KEY;
    if (!SHIPPO_API_KEY) {
      return res.status(500).json({ error: "Missing SHIPPO_API_KEY" });
    }

    // Parse body safely
    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    } catch {
      body = {};
    }

    // Defaults (prevent failures if client forgets something)
    const to = body.to || {};
    const parcel = body.parcel || {};

    // Your ship-from address (edit to your real origin)
    const FROM = {
      name: "Hemline Market",
      street1: "2 Castle Ridge Road",
      city: "Salem",
      state: "NH",
      zip: "03079",
      country: "US",
    };

    const TO = {
      name: to.name || "Customer",
      street1: to.street1 || "",
      street2: to.street2 || "",
      city: to.city || "",
      state: to.state || "",
      zip: to.zip || "",
      country: to.country || "US",
    };

    const PARCEL = {
      length: parcel.length ?? 12,
      width:  parcel.width  ?? 9,
      height: parcel.height ?? 2,
      distance_unit: parcel.distance_unit || "in",
      weight: parcel.weight ?? 1.0,
      mass_unit: parcel.mass_unit || "lb",
    };

    // Create a shipment (synchronous) to get rates immediately
    const resp = await fetch("https://api.goshippo.com/shipments/", {
      method: "POST",
      headers: {
        "Authorization": `ShippoToken ${SHIPPO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address_from: FROM,
        address_to: TO,
        parcels: [PARCEL],
        async: false,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(400).json({ error: "Shippo error", details: text });
    }

    const shipment = await resp.json();
    const rawRates = Array.isArray(shipment.rates) ? shipment.rates : [];

    // Normalize & sort by price ascending
    const rates = rawRates
      .map(r => ({
        object_id: r.object_id,
        carrier: r.provider,                  // e.g., "USPS"
        service: r.servicelevel?.name || r.servicelevel?.token, // e.g., "Priority Mail"
        amount: Number(r.amount),             // string → number
        currency: r.currency || "USD",
        estimated_days: r.estimated_days ?? null,
        duration_terms: r.duration_terms || "",
      }))
      .filter(r => Number.isFinite(r.amount))
      .sort((a, b) => a.amount - b.amount);

    return res.status(200).json({ rates });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

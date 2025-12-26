// /api/shippo-rates.js  — Vercel serverless function
// Requires env var: SHIPPO_API_KEY
// POST body (JSON):
// {
//   "from": { "name":"", "street1":"", "street2":"", "city":"", "state":"", "zip":"", "country":"US" },
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

    // Get addresses from request
    const from = body.from || {};
    const to = body.to || {};
    const parcel = body.parcel || {};

    // Build FROM address (seller's address from request)
    const FROM = {
      name: from.name || "Seller",
      street1: from.street1 || "",
      street2: from.street2 || "",
      city: from.city || "",
      state: from.state || "",
      zip: from.zip || "",
      country: from.country || "US",
    };

    // Validate FROM address
    if (!FROM.street1 || !FROM.city || !FROM.state || !FROM.zip) {
      return res.status(400).json({ error: "Missing seller ship-from address. Please set up your address in Account Settings." });
    }

    const TO = {
      name: to.name || "Customer",
      street1: to.street1 || "",
      street2: to.street2 || "",
      city: to.city || "",
      state: to.state || "",
      zip: to.zip || "",
      country: to.country || "US",
    };

    // Validate TO address
    if (!TO.street1 || !TO.city || !TO.state || !TO.zip) {
      return res.status(400).json({ error: "Missing buyer ship-to address." });
    }

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
      console.error("Shippo API error:", text);
      return res.status(400).json({ error: "Shippo error", details: text });
    }

    const shipment = await resp.json();
    const rawRates = Array.isArray(shipment.rates) ? shipment.rates : [];

    if (rawRates.length === 0) {
      return res.status(400).json({ 
        error: "No shipping rates available. Please verify both addresses are valid US addresses.",
        shippo_messages: shipment.messages || []
      });
    }

    // Normalize & sort by price ascending
    const rates = rawRates
      .map(r => ({
        object_id: r.object_id,
        provider: r.provider,                  // e.g., "USPS"
        carrier: r.provider,                   // alias for compatibility
        service: r.servicelevel?.name || r.servicelevel?.token,
        servicelevel: r.servicelevel,
        amount: Number(r.amount),
        currency: r.currency || "USD",
        estimated_days: r.estimated_days ?? null,
        duration_terms: r.duration_terms || "",
      }))
      .filter(r => Number.isFinite(r.amount))
      .sort((a, b) => a.amount - b.amount);

    return res.status(200).json({ rates });
  } catch (err) {
    console.error("shippo-rates error:", err);
    return res.status(500).json({ error: err.message });
  }
}

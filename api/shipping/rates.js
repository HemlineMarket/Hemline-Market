// api/shipping/rates.js
// Hemline Market — Get curated USPS shipping rates via Shippo (serverless)
// POST only. JSON body:
// {
//   "to": { "name":"", "street1":"", "city":"", "state":"", "zip":"", "country":"US" },
//   "parcel": { "weight_oz": 16, "length_in": 10, "width_in": 8, "height_in": 2 }
// }
// Returns simplified rates for a tight V1 set of USPS services.

const SHIPPO_API = "https://api.goshippo.com";

// Keep scope tight so UI stays simple.
const ALLOWED_SERVICE_KEYS = [
  "usps_priority_mail",
  "usps_ground_advantage"
];

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function bad(res, msg) { return send(res, 400, { error: msg }); }

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return bad(res, "Use POST with JSON body.");
  }

  const {
    SHIPPO_API_KEY,
    SHIP_FROM_NAME,
    SHIP_FROM_STREET1,
    SHIP_FROM_CITY,
    SHIP_FROM_STATE,
    SHIP_FROM_ZIP,
    SHIP_FROM_COUNTRY
  } = process.env;

  if (!SHIPPO_API_KEY) {
    return send(res, 500, { error: "Missing SHIPPO_API_KEY env var." });
  }

  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { return bad(res, "Invalid JSON body."); }

  const to = body.to || {};
  const parcel = body.parcel || {};

  // Minimal validation
  for (const k of ["name","street1","city","state","zip","country"]) {
    if (!to[k]) return bad(res, `Missing "to.${k}"`);
  }
  for (const k of ["weight_oz","length_in","width_in","height_in"]) {
    if (parcel[k] == null) return bad(res, `Missing "parcel.${k}"`);
  }

  // Origin from env (defaults keep you moving if you haven't set them yet)
  const address_from = {
    name: SHIP_FROM_NAME || "Hemline Seller",
    street1: SHIP_FROM_STREET1 || "123 Main St",
    city: SHIP_FROM_CITY || "Salem",
    state: SHIP_FROM_STATE || "NH",
    zip: SHIP_FROM_ZIP || "03079",
    country: SHIP_FROM_COUNTRY || "US"
  };

  const address_to = {
    name: to.name,
    street1: to.street1,
    city: to.city,
    state: to.state,
    zip: to.zip,
    country: to.country
  };

  const parcels = [{
    weight: String(parcel.weight_oz),
    mass_unit: "oz",
    length: String(parcel.length_in),
    width: String(parcel.width_in),
    height: String(parcel.height_in),
    distance_unit: "in"
  }];

  try {
    // Create a shipment and get rates synchronously
    const resp = await fetch(`${SHIPPO_API}/shipments/`, {
      method: "POST",
      headers: {
        "Authorization": `ShippoToken ${SHIPPO_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        address_from,
        address_to,
        parcels,
        async: false
      })
    });

    if (!resp.ok) {
      const text = await resp.text();
      return send(res, 502, { error: "Shippo error creating shipment", details: text.slice(0, 600) });
    }

    const shipment = await resp.json();
    const rawRates = Array.isArray(shipment.rates) ? shipment.rates : [];

    // Normalize and filter to our allowed services
    const normalized = rawRates
      .map(r => ({
        rate_object_id: r.object_id,
        amount: Number(r.amount),
        currency: r.currency || "USD",
        provider: r.provider || r.carrier, // "USPS"
        service_token: r.servicelevel && r.servicelevel.token, // e.g., "usps_priority_mail"
        service_name: r.servicelevel && r.servicelevel.name,   // e.g., "USPS Priority Mail"
        estimated_days: r.estimated_days ?? null
      }))
      .filter(r => ALLOWED_SERVICE_KEYS.includes((r.service_token || "").toLowerCase()))
      .sort((a,b) => a.amount - b.amount);

    return send(res, 200, {
      address_from,
      address_to,
      rates: normalized
    });
  } catch (err) {
    return send(res, 500, { error: "Unexpected server error", details: String(err).slice(0, 300) });
  }
};

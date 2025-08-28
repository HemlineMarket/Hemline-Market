// api/shipping/eta.js
// Returns an "arrives by" date window given seller_id, destination, parcel, and handling days.
// POST JSON:
// {
//   "seller_id": "<uuid>",                 // REQUIRED (multi-seller origin lookup)
//   "to": { "city":"", "state":"", "zip":"", "country":"US" }, // name/street not needed for ETA
//   "parcel": { "weight_oz": 16, "length_in": 10, "width_in": 8, "height_in": 2 },
//   "handling_days_min": 1,                // REQUIRED (e.g., 1)
//   "handling_days_max": 2                 // REQUIRED (e.g., 2)
// }
// Response 200: {
//   "ships_in": { "min":1, "max":2 },
//   "carrier_days": 3,                     // from Shippo suggested rate (estimated_days)
//   "arrives_by": { "start":"2025-09-01", "end":"2025-09-03" } // business-day window
// }

const SHIPPO_API = "https://api.goshippo.com";

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
function bad(res, msg) { return send(res, 400, { error: msg }); }

function isWeekend(d) {
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  return day === 0 || day === 6;
}
function addBusinessDays(date, days) {
  // Adds 'days' business days to a UTC date (ignores holidays for V1).
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  let remaining = Number(days) || 0;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!isWeekend(d)) remaining--;
  }
  return d;
}
function fmtISO(d) {
  return d.toISOString().slice(0,10);
}

// ---------- Supabase (service role) fetch ----------
async function fetchSellerOrigin(sellerId, supabaseUrl, serviceKey) {
  const url = `${supabaseUrl.replace(/\/+$/,'')}/rest/v1/rpc/get_seller_origin`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ p_user_id: sellerId })
  });
  if (!resp.ok) throw new Error(`Supabase RPC failed: ${resp.status}`);
  const data = await resp.json();
  if (!data) throw new Error("Seller origin not found");
  return {
    name: data.origin_name || data.display_name || "Seller",
    street1: data.origin_street1,
    city: data.origin_city,
    state: data.origin_state,
    zip: data.origin_zip,
    country: data.origin_country || "US"
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return bad(res, "Use POST with JSON body.");
  }

  const {
    SHIPPO_API_KEY,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
  } = process.env;

  if (!SHIPPO_API_KEY) return send(res, 500, { error: "Missing SHIPPO_API_KEY env var." });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return send(res, 500, { error: "Missing Supabase env vars." });

  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { return bad(res, "Invalid JSON"); }

  const { seller_id, to, parcel, handling_days_min, handling_days_max } = body || {};
  if (!seller_id) return bad(res, "Missing seller_id");
  if (!to || !to.city || !to.state || !to.zip || !to.country) return bad(res, 'Missing "to" (city/state/zip/country required)');
  if (!parcel || parcel.weight_oz == null || parcel.length_in == null || parcel.width_in == null || parcel.height_in == null) {
    return bad(res, 'Missing "parcel" (weight_oz/length_in/width_in/height_in required)');
  }
  if (handling_days_min == null || handling_days_max == null) return bad(res, "Missing handling_days_min/max");

  // 1) Look up seller origin
  let address_from;
  try {
    address_from = await fetchSellerOrigin(seller_id, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  } catch (e) {
    return send(res, 400, { error: e.message || "Seller origin lookup failed" });
  }

  // 2) Create a shipment in Shippo and get rates (sync) — we only need estimated_days
  const address_to = { name: "ETA Only", street1: "N/A", city: to.city, state: to.state, zip: to.zip, country: to.country };
  const parcels = [{
    weight: String(parcel.weight_oz), mass_unit: "oz",
    length: String(parcel.length_in), width: String(parcel.width_in),
    height: String(parcel.height_in), distance_unit: "in"
  }];

  try {
    const resp = await fetch(`${SHIPPO_API}/shipments/`, {
      method: "POST",
      headers: {
        "Authorization": `ShippoToken ${SHIPPO_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ address_from, address_to, parcels, async: false })
    });
    if (!resp.ok) {
      const text = await resp.text();
      return send(res, 502, { error: "Shippo error creating shipment", details: text.slice(0, 400) });
    }
    const shipment = await resp.json();
    const rates = Array.isArray(shipment.rates) ? shipment.rates : [];
    // Prefer USPS, then cheapest; use its estimated_days
    const usps = rates.filter(r => (r.provider || r.carrier) === "USPS");
    const ordered = (usps.length ? usps : rates).slice().sort((a,b) => Number(a.amount) - Number(b.amount));
    const chosen = ordered[0];
    const carrierDays = chosen && (chosen.estimated_days ?? null);

    // 3) Compute business-day window: handling + transit
    const today = new Date(); // UTC-ish; window calc is approximate
    const minStart = addBusinessDays(today, Number(handling_days_min || 0));
    const maxStart = addBusinessDays(today, Number(handling_days_max || 0));

    // Transit days: if Shippo didn't give any, assume 3 business days
    const transit = Number.isFinite(Number(carrierDays)) ? Number(carrierDays) : 3;

    const etaStart = addBusinessDays(maxStart, Math.max(1, transit - 1)); // start of window
    const etaEnd = addBusinessDays(maxStart, Math.max(1, transit + 1));   // end of window (pad ±1)

    return send(res, 200, {
      ships_in: { min: Number(handling_days_min), max: Number(handling_days_max) },
      carrier_days: transit,
      arrives_by: { start: fmtISO(etaStart), end: fmtISO(etaEnd) }
    });
  } catch (err) {
    return send(res, 500, { error: String(err.message || err).slice(0, 400) });
  }
};

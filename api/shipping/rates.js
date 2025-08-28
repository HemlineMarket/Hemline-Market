// api/shipping/rates.js
// Hemline Market — Get curated USPS shipping rates via Shippo (serverless)
// Multi-seller aware: accepts { seller_id } and pulls that seller's ship-from
// address from Supabase (service role). New: require seller origin unless
// ALLOW_ENV_ORIGIN_FALLBACK === "true".
//
// POST JSON:
// {
//   "seller_id": "uuid-of-seller",   // REQUIRED for marketplace correctness
//   "to": { "name":"", "street1":"", "city":"", "state":"", "zip":"", "country":"US" },
//   "parcel": { "weight_oz": 16, "length_in": 10, "width_in": 8, "height_in": 2 }
// }
// Response 200: { address_from, address_to, rates: [ ... ] }
// Response 400: when seller has no origin and fallback not allowed.

const SHIPPO_API = "https://api.goshippo.com";
const ALLOWED_SERVICE_KEYS = ["usps_priority_mail", "usps_ground_advantage"];

// ---------- tiny utils ----------
function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
function bad(res, msg) { return send(res, 400, { error: msg }); }
function required(obj, keys, prefix, res) {
  for (const k of keys) if (!obj[k]) return bad(res, `Missing "${prefix}.${k}"`);
}

// ---------- Supabase service fetch (RPC) ----------
async function fetchSellerOrigin(sellerId, supabaseUrl, serviceKey) {
  if (!sellerId) return null;
  if (!supabaseUrl || !serviceKey) throw new Error("Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
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
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Supabase RPC get_seller_origin failed: ${resp.status} ${txt.slice(0,300)}`);
  }
  const data = await resp.json(); // seller_profiles row or null
  if (!data) return null;
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
    SHIP_FROM_NAME,
    SHIP_FROM_STREET1,
    SHIP_FROM_CITY,
    SHIP_FROM_STATE,
    SHIP_FROM_ZIP,
    SHIP_FROM_COUNTRY,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    ALLOW_ENV_ORIGIN_FALLBACK
  } = process.env;

  if (!SHIPPO_API_KEY) return send(res, 500, { error: "Missing SHIPPO_API_KEY env var." });

  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { return bad(res, "Invalid JSON body."); }

  const sellerId = body.seller_id || null;
  const to = body.to || {};
  const parcel = body.parcel || {};

  // Validate destination + parcel
  if (required(to, ["name","street1","city","state","zip","country"], "to", res)) return;
  if (required(parcel, ["weight_oz","length_in","width_in","height_in"], "parcel", res)) return;

  // Resolve origin: seller-specific via Supabase
  let address_from = null;
  try {
    if (sellerId) {
      const s = await fetchSellerOrigin(sellerId, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      if (s && s.street1 && s.city && s.state && s.zip) address_from = s;
    }
  } catch (e) {
    // Log but don't crash the request
    console.error("seller origin lookup failed:", e.message || e);
  }

  // New: enforce seller origin unless fallback allowed
  const allowFallback = String(ALLOW_ENV_ORIGIN_FALLBACK || "").toLowerCase() === "true";
  if (!address_from && !allowFallback) {
    return bad(res, "Seller must set ship-from address before requesting rates.");
  }

  if (!address_from && allowFallback) {
    // Fallback (only when explicitly allowed for local testing)
    address_from = {
      name: SHIP_FROM_NAME || "Hemline Seller",
      street1: SHIP_FROM_STREET1 || "123 Main St",
      city: SHIP_FROM_CITY || "Salem",
      state: SHIP_FROM_STATE || "NH",
      zip: SHIP_FROM_ZIP || "03079",
      country: SHIP_FROM_COUNTRY || "US"
    };
  }

  const address_to = {
    name: to.name, street1: to.street1, city: to.city,
    state: to.state, zip: to.zip, country: to.country
  };
  const parcels = [{
    weight: String(parcel.weight_oz), mass_unit: "oz",
    length: String(parcel.length_in), width: String(parcel.width_in),
    height: String(parcel.height_in), distance_unit: "in"
  }];

  try {
    // Create shipment & get rates (sync)
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
      return send(res, 502, { error: "Shippo error creating shipment", details: text.slice(0, 600) });
    }

    const shipment = await resp.json();
    const rawRates = Array.isArray(shipment.rates) ? shipment.rates : [];

    const normalized = rawRates
      .map(r => ({
        rate_object_id: r.object_id,
        amount: Number(r.amount),
        currency: r.currency || "USD",
        provider: r.provider || r.carrier,
        service_token: r.servicelevel && r.servicelevel.token,
        service_name: r.servicelevel && r.servicelevel.name,
        estimated_days: r.estimated_days ?? null
      }))
      .filter(r => ALLOWED_SERVICE_KEYS.includes((r.service_token || "").toLowerCase()))
      .sort((a,b) => a.amount - b.amount);

    return send(res, 200, { address_from, address_to, rates: normalized });
  } catch (err) {
    return send(res, 500, { error: "Unexpected server error", details: String(err).slice(0, 300) });
  }
};

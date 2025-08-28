// api/shipping/label.js
// Hemline Market — Purchase a shipping label via Shippo (multi-seller aware).
//
// Two request modes:
//
// A) Purchase using a rate you already got from /api/shipping/rates
//    { "rate_object_id": "<rate id>", "seller_id": "<uuid>" }
//    (seller_id is ignored here because the rate already encodes origin)
//
// B) Create shipment + buy in one call (we'll pick a curated USPS service)
//    {
//      "seller_id": "<uuid>",                                 // REQUIRED for marketplace correctness
//      "to": { "name":"", "street1":"", "city":"", "state":"", "zip":"", "country":"US" },
//      "parcel": { "weight_oz": 16, "length_in": 10, "width_in": 8, "height_in": 2 }
//    }
//
// Response 200:
// {
//   "transaction_id": "...",
//   "label_pdf_url": "https://...pdf",
//   "tracking_number": "9400...",
//   "carrier": "USPS",
//   "service_name": "USPS Priority Mail",
//   "amount": 8.95,
//   "currency": "USD"
// }

const SHIPPO_API = "https://api.goshippo.com";
const ALLOWED_SERVICE_KEYS = ["usps_priority_mail", "usps_ground_advantage"];

// ---------- utils ----------
function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
function bad(res, msg) { return send(res, 400, { error: msg }); }
function required(obj, keys, prefix, res) {
  for (const k of keys) if (!obj[k]) return bad(res, `Missing "${prefix}.${k}"`);
}

async function shippo(path, method, body, token) {
  const resp = await fetch(`${SHIPPO_API}${path}`, {
    method,
    headers: {
      "Authorization": `ShippoToken ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await resp.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!resp.ok) {
    const msg = (data && (data.detail || data.error)) || text || resp.statusText;
    const code = resp.status || 502;
    throw new Error(`Shippo ${path} ${code}: ${String(msg).slice(0, 600)}`);
  }
  return data;
}

// ---------- Supabase (service role) fetch ----------
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
  const data = await resp.json();
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
    SUPABASE_SERVICE_ROLE_KEY
  } = process.env;

  if (!SHIPPO_API_KEY) return send(res, 500, { error: "Missing SHIPPO_API_KEY env var." });

  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { return bad(res, "Invalid JSON body."); }

  const rateId = body.rate_object_id || null;

  try {
    let transaction;

    if (rateId) {
      // Mode A: buy the label directly from an existing rate
      transaction = await shippo("/transactions/", "POST", {
        rate: rateId,
        label_file_type: "PDF",
        async: false
      }, SHIPPO_API_KEY);

    } else {
      // Mode B: create shipment (with seller-specific origin), pick curated rate, then buy
      const sellerId = body.seller_id || null;
      const to = body.to || {};
      const parcel = body.parcel || {};

      if (required(to, ["name","street1","city","state","zip","country"], "to", res)) return;
      if (required(parcel, ["weight_oz","length_in","width_in","height_in"], "parcel", res)) return;

      // Resolve origin: seller-specific via Supabase, else env fallback
      let address_from = null;
      try {
        if (sellerId) {
          const s = await fetchSellerOrigin(sellerId, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
          if (s && s.street1 && s.city && s.state && s.zip) address_from = s;
        }
      } catch (e) {
        console.error("seller origin lookup failed:", e.message || e);
      }
      if (!address_from) {
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

      // Create shipment (sync)
      const shipment = await shippo("/shipments/", "POST",
        { address_from, address_to, parcels, async: false }, SHIPPO_API_KEY);

      const rawRates = Array.isArray(shipment.rates) ? shipment.rates : [];
      const normalized = rawRates
        .map(r => ({
          id: r.object_id,
          amount: Number(r.amount),
          currency: r.currency || "USD",
          provider: r.provider || r.carrier,
          token: r.servicelevel && r.servicelevel.token,
          name: r.servicelevel && r.servicelevel.name
        }))
        .filter(r => ALLOWED_SERVICE_KEYS.includes((r.token || "").toLowerCase()))
        .sort((a,b) => a.amount - b.amount);

      if (!normalized.length) throw new Error("No allowed rates found for this parcel/destination.");

      // Buy with the cheapest curated rate
      transaction = await shippo("/transactions/", "POST", {
        rate: normalized[0].id,
        label_file_type: "PDF",
        async: false
      }, SHIPPO_API_KEY);
    }

    // Ensure success
    if (transaction.status && transaction.status.toLowerCase() === "error") {
      const msg = (transaction.messages && transaction.messages[0] && transaction.messages[0].text) || "Label purchase failed";
      return send(res, 502, { error: msg });
    }

    return send(res, 200, {
      transaction_id: transaction.object_id,
      label_pdf_url: transaction.label_url || transaction.label_pdf_url,
      tracking_number: transaction.tracking_number,
      carrier: (transaction.rate && (transaction.rate.provider || transaction.rate.carrier)) || "USPS",
      service_name: transaction.rate && transaction.rate.servicelevel && transaction.rate.servicelevel.name,
      amount: transaction.rate ? Number(transaction.rate.amount) : null,
      currency: (transaction.rate && transaction.rate.currency) || "USD"
    });

  } catch (err) {
    return send(res, 500, { error: String(err.message || err).slice(0, 600) });
  }
};

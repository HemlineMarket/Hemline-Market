// api/shipping/label.js
// Hemline Market — Purchase a shipping label via Shippo.
// POST only. JSON body (two ways to use):
// A) Provide a rate you already selected from /api/shipping/rates:
//    { "rate_object_id": "<rate id from rates API>" }
// B) Or provide destination + parcel and we'll pick a curated service automatically:
//    {
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

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
function bad(res, msg) { return send(res, 400, { error: msg }); }

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

  if (!SHIPPO_API_KEY) return send(res, 500, { error: "Missing SHIPPO_API_KEY env var." });

  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { return bad(res, "Invalid JSON body."); }

  const rateId = body.rate_object_id;

  try {
    let chosenRateId = rateId;

    if (!chosenRateId) {
      // Validate inputs for auto-pick mode
      const to = body.to || {};
      const parcel = body.parcel || {};
      for (const k of ["name","street1","city","state","zip","country"]) {
        if (!to[k]) return bad(res, `Missing "to.${k}"`);
      }
      for (const k of ["weight_oz","length_in","width_in","height_in"]) {
        if (parcel[k] == null) return bad(res, `Missing "parcel.${k}"`);
      }

      // Build addresses
      const address_from = {
        name: SHIP_FROM_NAME || "Hemline Seller",
        street1: SHIP_FROM_STREET1 || "123 Main St",
        city: SHIP_FROM_CITY || "Salem",
        state: SHIP_FROM_STATE || "NH",
        zip: SHIP_FROM_ZIP || "03079",
        country: SHIP_FROM_COUNTRY || "US"
      };
      const address_to = {
        name: to.name, street1: to.street1, city: to.city,
        state: to.state, zip: to.zip, country: to.country
      };
      const parcels = [{
        weight: String(parcel.weight_oz), mass_unit: "oz",
        length: String(parcel.length_in), width: String(parcel.width_in),
        height: String(parcel.height_in), distance_unit: "in"
      }];

      // Create shipment (sync) and pick a curated rate
      const shipment = await shippo("/shipments/", "POST", {
        address_from, address_to, parcels, async: false
      }, SHIPPO_API_KEY);

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
      chosenRateId = normalized[0].id;
    }

    // Purchase label
    const tx = await shippo("/transactions/", "POST", {
      rate: chosenRateId,
      label_file_type: "PDF",
      async: false
    }, SHIPPO_API_KEY);

    // Shippo returns a transaction object; ensure it succeeded
    if (tx.status && tx.status.toLowerCase() === "error") {
      const msg = (tx && tx.messages && tx.messages[0] && tx.messages[0].text) || "Label purchase failed";
      return send(res, 502, { error: msg });
    }

    return send(res, 200, {
      transaction_id: tx.object_id,
      label_pdf_url: tx.label_url || tx.label_pdf_url,
      tracking_number: tx.tracking_number,
      carrier: (tx.rate && (tx.rate.provider || tx.rate.carrier)) || "USPS",
      service_name: tx.rate && tx.rate.servicelevel && tx.rate.servicelevel.name,
      amount: tx.rate ? Number(tx.rate.amount) : null,
      currency: (tx.rate && tx.rate.currency) || "USD"
    });
  } catch (err) {
    return send(res, 500, { error: String(err.message || err).slice(0, 600) });
  }
};

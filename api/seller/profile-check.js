// api/seller/profile-check.js
// Returns whether the seller has a complete ship-from address.
// POST JSON: { "seller_id": "<uuid>" }
// 200 -> { ok: true } or { ok: false, missing: ["origin_city", ...] }

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

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return send(res, 500, { error: "Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
  }

  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { return bad(res, "Invalid JSON"); }

  const { seller_id } = body;
  if (!seller_id) return bad(res, "Missing seller_id");

  // Call the secure RPC to get seller origin
  const url = `${SUPABASE_URL.replace(/\/+$/,'')}/rest/v1/rpc/get_seller_origin`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ p_user_id: seller_id })
  });

  if (!resp.ok) {
    const text = await resp.text();
    return send(res, 502, { error: `Supabase RPC failed: ${resp.status}`, details: text.slice(0,300) });
  }

  const row = await resp.json(); // may be null
  const required = ["origin_street1","origin_city","origin_state","origin_zip","origin_country"];
  const missing = [];

  if (!row) {
    missing.push(...required);
  } else {
    for (const k of required) {
      const v = (row[k] ?? "").toString().trim();
      if (!v) missing.push(k);
    }
  }

  if (missing.length) return send(res, 200, { ok: false, missing });
  return send(res, 200, { ok: true });
};

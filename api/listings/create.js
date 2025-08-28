// api/listings/create.js
// Creates a listing in Supabase using the service role (server-only).
// Accepts either form POST (application/x-www-form-urlencoded) from public/create-listing.html
// or JSON POST. Responds with a simple HTML success page for form posts, or JSON for API clients.

function sendJSON(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function sendHTML(res, status, html) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

function parseUrlEncoded(bodyStr) {
  const out = {};
  bodyStr.split("&").forEach(pair => {
    const [k, v] = pair.split("=");
    if (!k) return;
    out[decodeURIComponent(k.replace(/\+/g, " "))] =
      decodeURIComponent((v || "").replace(/\+/g, " "));
  });
  return out;
}

async function insertListing(supabaseUrl, serviceKey, row) {
  const url = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/listings`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation" // return inserted row
    },
    body: JSON.stringify(row)
  });
  const text = await resp.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!resp.ok) {
    const msg = (data && (data.message || data.error)) || text || resp.statusText;
    throw new Error(`Supabase insert failed: ${resp.status} ${String(msg).slice(0,400)}`);
  }
  // PostgREST returns an array of inserted rows
  return Array.isArray(data) ? data[0] : data;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendHTML(res, 405, "<h1>405</h1><p>POST only.</p>");
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return sendHTML(res, 500, "<h1>500</h1><p>Server missing Supabase env vars.</p>");
  }

  // Parse body based on Content-Type
  const ct = String(req.headers["content-type"] || "").toLowerCase();
  let body = {};
  try {
    if (ct.includes("application/json")) {
      body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      const raw = typeof req.body === "string" ? req.body : (req.body ? req.body.toString() : "");
      body = parseUrlEncoded(raw || "");
    } else {
      // Attempt JSON first, fall back to urlencoded
      try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
      catch { body = parseUrlEncoded((req.body || "").toString()); }
    }
  } catch {
    return sendHTML(res, 400, "<h1>400</h1><p>Invalid request body.</p>");
  }

  // Extract fields
  const title = (body.title || "").trim();
  const description = (body.description || "").trim();
  const priceRaw = (body.price || "").toString().trim();
  const seller_id = (body.seller_id || "").trim();

  // Basic validation
  if (!seller_id) return sendHTML(res, 400, "<h1>400</h1><p>Missing seller_id.</p>");
  if (!title) return sendHTML(res, 400, "<h1>400</h1><p>Title is required.</p>");
  const price = Number(priceRaw);
  if (!Number.isFinite(price) || price < 0) {
    return sendHTML(res, 400, "<h1>400</h1><p>Price must be a non-negative number.</p>");
  }

  try {
    // Insert row; other columns (created_at, etc.) handled by DB defaults
    const inserted = await insertListing(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      seller_id,
      title,
      description,
      price
    });

    // If request was JSON, return JSON
    if (ct.includes("application/json")) {
      return sendJSON(res, 200, { ok: true, listing: inserted });
    }

    // Otherwise, respond with a minimal HTML success page for normal form posts
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Listing Created</title>
<style>body{font-family:system-ui,sans-serif;margin:24px}a{color:#111}</style></head>
<body>
  <h1>🎉 Listing Created</h1>
  <p><strong>${inserted?.title || title}</strong> — $${(inserted?.price ?? price).toFixed(2)}</p>
  <p>Your listing was created successfully.</p>
  <p><a href="/create-listing.html">Create another</a> • <a href="/public/listings.html">Back to listings</a></p>
</body></html>`;
    return sendHTML(res, 200, html);
  } catch (err) {
    // DB trigger will block if seller has no ship-from address
    const msg = String(err.message || err);
    // For form posts, show human-friendly HTML
    if (!ct.includes("application/json")) {
      const hint = /must set ship-from address/i.test(msg)
        ? "<p>Tip: set your address on <a href=\"/seller-profile.html\">Seller Profile</a> first.</p>"
        : "";
      return sendHTML(res, 400, `<h1>Listing not created</h1><p>${msg}</p>${hint}`);
    }
    // For API clients, return JSON
    return sendJSON(res, 400, { ok: false, error: msg });
  }
};

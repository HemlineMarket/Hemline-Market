// FILE: api/listings/create.js
// FIX: Added JWT authentication and seller_id validation (BUG #6)
// FIX: Converted from CommonJS (module.exports) to ES modules (export default)
// FIX: Added title length/character validation
// Creates a listing in Supabase using the service role (server-only).
// 
// CHANGE: Now requires valid JWT token, and seller_id must match authenticated user
//
// Supports:
//  - Form POST (application/x-www-form-urlencoded) from public/create-listing.html
//  - JSON POST (application/json)
// Saves required shipping fields: weight_oz, handling_days_min/max, and optional dims.

import { createClient } from "@supabase/supabase-js";

// Constants for validation
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 5000;

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  const supabase = getSupabaseAdmin();

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return null;
  }

  return user;
}

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
  (bodyStr || "").split("&").forEach(pair => {
    if (!pair) return;
    const [k, v = ""] = pair.split("=");
    const key = decodeURIComponent(k.replace(/\+/g, " "));
    const val = decodeURIComponent(v.replace(/\+/g, " "));
    out[key] = val;
  });
  return out;
}

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Sanitize and validate title
 * - Trims whitespace
 * - Enforces max length
 * - Removes potentially dangerous characters for Stripe/emails
 */
function sanitizeTitle(title) {
  if (!title) return { valid: false, error: "Title is required." };
  
  let sanitized = String(title).trim();
  
  // Remove null bytes and other control characters
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
  
  // Check length
  if (sanitized.length === 0) {
    return { valid: false, error: "Title is required." };
  }
  
  if (sanitized.length > MAX_TITLE_LENGTH) {
    return { valid: false, error: `Title must be ${MAX_TITLE_LENGTH} characters or less.` };
  }
  
  return { valid: true, value: sanitized };
}

/**
 * Sanitize description
 */
function sanitizeDescription(description) {
  if (!description) return { valid: true, value: "" };
  
  let sanitized = String(description).trim();
  
  // Remove null bytes and other control characters (keep newlines)
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  if (sanitized.length > MAX_DESCRIPTION_LENGTH) {
    return { valid: false, error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less.` };
  }
  
  return { valid: true, value: sanitized };
}

async function insertListing(supabaseUrl, serviceKey, row) {
  const url = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/listings`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
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
  return Array.isArray(data) ? data[0] : data;
}

// FIX: Changed from module.exports to export default for ES modules consistency
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendHTML(res, 405, "<h1>405</h1><p>POST only.</p>");
  }

  // Require authentication
  const user = await verifyAuth(req);
  if (!user) {
    const ct = String(req.headers["content-type"] || "").toLowerCase();
    if (ct.includes("application/json")) {
      return sendJSON(res, 401, { ok: false, error: "Unauthorized" });
    }
    return sendHTML(res, 401, "<h1>401</h1><p>Unauthorized. Please log in.</p>");
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return sendHTML(res, 500, "<h1>500</h1><p>Server missing Supabase env vars.</p>");
  }

  // Parse body
  const ct = String(req.headers["content-type"] || "").toLowerCase();
  let body = {};
  try {
    if (ct.includes("application/json")) {
      body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      const raw = typeof req.body === "string" ? req.body : (req.body ? req.body.toString() : "");
      body = parseUrlEncoded(raw || "");
    } else {
      try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
      catch { body = parseUrlEncoded((req.body || "").toString()); }
    }
  } catch {
    return sendHTML(res, 400, "<h1>400</h1><p>Invalid request body.</p>");
  }

  // Extract and validate fields
  const seller_id = (body.seller_id || "").trim();
  
  // FIX: Sanitize and validate title
  const titleResult = sanitizeTitle(body.title);
  if (!titleResult.valid) {
    if (ct.includes("application/json")) {
      return sendJSON(res, 400, { ok: false, error: titleResult.error });
    }
    return sendHTML(res, 400, `<h1>400</h1><p>${titleResult.error}</p>`);
  }
  const title = titleResult.value;
  
  // FIX: Sanitize and validate description
  const descResult = sanitizeDescription(body.description);
  if (!descResult.valid) {
    if (ct.includes("application/json")) {
      return sendJSON(res, 400, { ok: false, error: descResult.error });
    }
    return sendHTML(res, 400, `<h1>400</h1><p>${descResult.error}</p>`);
  }
  const description = descResult.value;
  
  const price = toNumber(body.price);

  const weight_oz = toNumber(body.weight_oz);
  const handling_days_min = Math.trunc(toNumber(body.handling_days_min));
  const handling_days_max = Math.trunc(toNumber(body.handling_days_max));

  const length_in = body.length_in == null || body.length_in === ""
    ? null : toNumber(body.length_in);
  const width_in  = body.width_in  == null || body.width_in  === ""
    ? null : toNumber(body.width_in);
  const height_in = body.height_in == null || body.height_in === ""
    ? null : toNumber(body.height_in);

  // Validate seller_id matches authenticated user
  if (!seller_id) {
    if (ct.includes("application/json")) {
      return sendJSON(res, 400, { ok: false, error: "Missing seller_id." });
    }
    return sendHTML(res, 400, "<h1>400</h1><p>Missing seller_id.</p>");
  }
  if (seller_id !== user.id) {
    if (ct.includes("application/json")) {
      return sendJSON(res, 403, { ok: false, error: "Cannot create listings for other users" });
    }
    return sendHTML(res, 403, "<h1>403</h1><p>Cannot create listings for other users.</p>");
  }

  if (!Number.isFinite(price) || price < 0) {
    if (ct.includes("application/json")) {
      return sendJSON(res, 400, { ok: false, error: "Price must be a non-negative number." });
    }
    return sendHTML(res, 400, "<h1>400</h1><p>Price must be a non-negative number.</p>");
  }

  // Validate shipping fields
  if (!Number.isFinite(weight_oz) || weight_oz <= 0) {
    if (ct.includes("application/json")) {
      return sendJSON(res, 400, { ok: false, error: "Weight (oz) must be greater than 0." });
    }
    return sendHTML(res, 400, "<h1>400</h1><p>Weight (oz) must be greater than 0.</p>");
  }
  if (!Number.isFinite(handling_days_min) || !Number.isFinite(handling_days_max)
      || handling_days_min < 0 || handling_days_max < handling_days_min) {
    if (ct.includes("application/json")) {
      return sendJSON(res, 400, { ok: false, error: "Handling days must be integers and max ≥ min." });
    }
    return sendHTML(res, 400, "<h1>400</h1><p>Handling days must be integers and max ≥ min.</p>");
  }
  for (const [k, v] of Object.entries({ length_in, width_in, height_in })) {
    if (v != null && (!Number.isFinite(v) || v < 0)) {
      if (ct.includes("application/json")) {
        return sendJSON(res, 400, { ok: false, error: `${k} must be a non-negative number.` });
      }
      return sendHTML(res, 400, `<h1>400</h1><p>${k} must be a non-negative number.</p>`);
    }
  }

  try {
    const inserted = await insertListing(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      seller_id,
      title,
      description,
      price,
      weight_oz,
      handling_days_min,
      handling_days_max,
      length_in,
      width_in,
      height_in
    });

    if (ct.includes("application/json")) {
      return sendJSON(res, 200, { ok: true, listing: inserted });
    }

    // Escape title for HTML output
    const safeTitle = (inserted?.title || title)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Listing Created</title>
<style>body{font-family:system-ui,sans-serif;margin:24px}a{color:#111}</style></head>
<body>
  <h1>🎉 Listing Created</h1>
  <p><strong>${safeTitle}</strong> — $${(inserted?.price ?? price).toFixed(2)}</p>
  <p>Shipping: ${weight_oz} oz · ships in ${handling_days_min}${handling_days_min===handling_days_max ? "" : "–"+handling_days_max} business day(s)</p>
  <p>Your listing was created successfully.</p>
  <p><a href="/create-listing.html">Create another</a> • <a href="/public/listings.html">Back to listings</a></p>
</body></html>`;
    return sendHTML(res, 200, html);
  } catch (err) {
    const msg = String(err.message || err);
    if (!ct.includes("application/json")) {
      const hint = /ship-from address/i.test(msg)
        ? "<p>Tip: set your address on <a href=\"/seller-profile.html\">Seller Profile</a> first.</p>"
        : "";
      return sendHTML(res, 400, `<h1>Listing not created</h1><p>${msg}</p>${hint}`);
    }
    return sendJSON(res, 400, { ok: false, error: msg });
  }
}

// File: /api/cron/check-saved-searches.js
// Vercel Cron Job - runs every 6 hours to check saved searches
// Finds new listings matching each user's saved searches and emails them
//
// Add to vercel.json:
// { "crons": [{ "path": "/api/cron/check-saved-searches", "schedule": "0 */6 * * *" }] }
//
// ENV: CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POSTMARK_SERVER_TOKEN

import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

async function sendEmail(to, subject, htmlBody, textBody) {
  const POSTMARK = process.env.POSTMARK_SERVER_TOKEN;
  const FROM = process.env.FROM_EMAIL || "alerts@hemlinemarket.com";
  if (!POSTMARK || !to) return false;

  try {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Postmark-Server-Token": POSTMARK },
      body: JSON.stringify({ From: FROM, To: to, Subject: subject, HtmlBody: htmlBody, TextBody: textBody, MessageStream: "outbound" }),
    });
    return res.ok;
  } catch (e) {
    console.error("[check-saved-searches] Email error:", e);
    return false;
  }
}

// Check if a listing matches the saved search filters
function listingMatchesFilters(listing, filters) {
  // Text search
  if (filters.q) {
    const searchTerm = filters.q.toLowerCase();
    const hay = ((listing.title || "") + " " + (listing.description || "")).toLowerCase();
    if (!hay.includes(searchTerm)) return false;
  }

  // Price range
  if (filters.minPrice != null && listing.price_cents != null) {
    if (listing.price_cents < Math.round(filters.minPrice * 100)) return false;
  }
  if (filters.maxPrice != null && listing.price_cents != null) {
    if (listing.price_cents > Math.round(filters.maxPrice * 100)) return false;
  }

  // Minimum yards
  if (filters.minYards != null && listing.yards_available != null) {
    if (Number(listing.yards_available) < filters.minYards) return false;
  }

  // Content/fiber (e.g., Silk, Wool, Cotton)
  if (filters.content && Array.isArray(filters.content) && filters.content.length > 0) {
    const lc = (listing.content || "").toLowerCase();
    let hit = false;
    for (const v of filters.content) {
      if (lc.includes(v.toLowerCase())) {
        hit = true;
        break;
      }
    }
    if (!hit) return false;
  }

  // Fabric types (e.g., Charmeuse, Jersey)
  if (filters.fabricTypes && Array.isArray(filters.fabricTypes) && filters.fabricTypes.length > 0) {
    const listingFabricTypes = (listing.fabric_type || "").split(",").map(s => s.trim().toLowerCase());
    let fabricMatch = false;
    for (const selected of filters.fabricTypes) {
      if (listingFabricTypes.some(ft => ft === selected.toLowerCase())) {
        fabricMatch = true;
        break;
      }
    }
    if (!fabricMatch) return false;
  }

  // Colors
  if (filters.colors && Array.isArray(filters.colors) && filters.colors.length > 0) {
    if (!listing.color_family || !filters.colors.includes(listing.color_family)) return false;
  }

  // Department
  if (filters.dept && listing.dept !== filters.dept) return false;

  // Fiber type (Natural, Synthetic, etc.)
  if (filters.fiberType && listing.fiber_type !== filters.fiberType) return false;

  // Width range
  if (filters.minWidth != null && listing.width_in != null) {
    if (Number(listing.width_in) < filters.minWidth) return false;
  }
  if (filters.maxWidth != null && listing.width_in != null) {
    if (Number(listing.width_in) > filters.maxWidth) return false;
  }

  // GSM range
  if (filters.minGsm != null && listing.weight_gsm != null) {
    if (Number(listing.weight_gsm) < filters.minGsm) return false;
  }
  if (filters.maxGsm != null && listing.weight_gsm != null) {
    if (Number(listing.weight_gsm) > filters.maxGsm) return false;
  }

  // Origin/country
  if (filters.origin) {
    const listingOrigin = listing.country_of_origin || listing.origin;
    if (listingOrigin !== filters.origin) return false;
  }

  // Designer
  if (filters.designer) {
    const dName = (listing.designer || "").toLowerCase();
    if (!dName.includes(filters.designer.toLowerCase())) return false;
  }

  return true;
}

// Format price from cents
function formatPrice(cents) {
  if (cents == null) return "TBD";
  return "$" + (cents / 100).toFixed(2);
}

// Build email HTML for matching listings
function buildAlertEmail(searchName, matches, searchId) {
  const listingsHtml = matches.slice(0, 6).map(l => `
    <div style="display:inline-block;width:180px;margin:8px;vertical-align:top;">
      <a href="https://hemlinemarket.com/listing.html?id=${l.id}" style="text-decoration:none;color:inherit;">
        ${l.image_url_1 ? `<img src="${l.image_url_1}" alt="" style="width:180px;height:180px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb;">` : '<div style="width:180px;height:180px;background:#f3f4f6;border-radius:8px;"></div>'}
        <div style="margin-top:6px;font-weight:600;font-size:14px;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.title || 'Fabric'}</div>
        <div style="font-size:13px;color:#991b1b;font-weight:700;">${formatPrice(l.price_cents)}/yard</div>
        ${l.yards_available ? `<div style="font-size:12px;color:#6b7280;">${l.yards_available} yards</div>` : ''}
      </a>
    </div>
  `).join("");

  const moreText = matches.length > 6 ? `<p style="margin-top:16px;"><a href="https://hemlinemarket.com/browse.html" style="color:#991b1b;">View all ${matches.length} matches →</a></p>` : '';

  return `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;">
      <h1 style="color:#991b1b;font-size:22px;">New fabrics match your search! 🧵</h1>
      <p style="color:#6b7280;font-size:14px;">Your saved search: <strong>"${searchName}"</strong></p>
      
      <div style="margin:20px 0;">
        ${listingsHtml}
      </div>
      
      ${moreText}
      
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p style="color:#6b7280;font-size:12px;">
        <a href="https://hemlinemarket.com/favorites.html" style="color:#991b1b;">Manage saved searches</a> · 
        <a href="https://hemlinemarket.com/api/saved-searches/unsubscribe?id=${searchId}" style="color:#6b7280;">Unsubscribe from this alert</a>
      </p>
      <p style="color:#6b7280;font-size:12px;"><strong>Hemline Market</strong></p>
    </div>
  `;
}

export default async function handler(req, res) {
  // Verify cron secret (Vercel sends this automatically for cron jobs)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = getSupabaseAdmin();
  const now = new Date();
  const results = { checked: 0, emailsSent: 0, errors: [] };

  try {
    // Get all saved searches with email alerts enabled
    const { data: searches, error: searchError } = await supabase
      .from("saved_searches")
      .select("*, user:profiles!user_id(contact_email)")
      .eq("email_alerts", true);

    if (searchError) {
      console.error("[check-saved-searches] Fetch error:", searchError);
      return res.status(500).json({ error: "Failed to fetch saved searches" });
    }

    if (!searches || searches.length === 0) {
      return res.status(200).json({ success: true, message: "No saved searches to check", ...results });
    }

    // Get all active, published listings
    const { data: allListings, error: listingError } = await supabase
      .from("listings")
      .select("*")
      .eq("is_published", true)
      .eq("status", "ACTIVE")
      .gt("yards_available", 0)
      .order("published_at", { ascending: false });

    if (listingError) {
      console.error("[check-saved-searches] Listings fetch error:", listingError);
      return res.status(500).json({ error: "Failed to fetch listings" });
    }

    // Process each saved search
    for (const search of searches) {
      try {
        results.checked++;

        // Get user's email
        let userEmail = search.user?.contact_email;
        if (!userEmail) {
          // Try getting from auth
          const { data: authUser } = await supabase.auth.admin.getUserById(search.user_id);
          userEmail = authUser?.user?.email;
        }

        if (!userEmail) {
          console.log(`[check-saved-searches] No email for user ${search.user_id}, skipping`);
          continue;
        }

        const filters = search.filters || {};
        const lastChecked = search.last_checked_at ? new Date(search.last_checked_at) : new Date(0);

        // Find listings that match AND were published after last check
        const newMatches = (allListings || []).filter(listing => {
          // Must be newer than last check
          if (listing.published_at) {
            const publishedAt = new Date(listing.published_at);
            if (publishedAt <= lastChecked) return false;
          }

          return listingMatchesFilters(listing, filters);
        });

        // Update last_checked_at regardless of matches
        await supabase
          .from("saved_searches")
          .update({ last_checked_at: now.toISOString() })
          .eq("id", search.id);

        // Only email if there are new matches
        if (newMatches.length > 0) {
          const html = buildAlertEmail(search.name, newMatches, search.id);
          const text = `New fabrics match your saved search "${search.name}"! ${newMatches.length} new listing(s) found. Visit hemlinemarket.com to view.`;

          const sent = await sendEmail(
            userEmail,
            `🧵 ${newMatches.length} new fabric${newMatches.length > 1 ? 's' : ''} match your search!`,
            html,
            text
          );

          if (sent) {
            results.emailsSent++;

            // Also create in-app notification
            await supabase.from("notifications").insert({
              user_id: search.user_id,
              type: "saved_search",
              kind: "saved_search",
              title: `New matches for "${search.name}"`,
              body: `${newMatches.length} new listing${newMatches.length > 1 ? 's' : ''} match your saved search.`,
              href: "/favorites.html",
            });
          }
        }

      } catch (e) {
        console.error(`[check-saved-searches] Error processing search ${search.id}:`, e);
        results.errors.push({ searchId: search.id, error: e.message });
      }
    }

    return res.status(200).json({ success: true, ...results });

  } catch (e) {
    console.error("[check-saved-searches] Error:", e);
    return res.status(500).json({ error: e.message });
  }
}

// api/atelier/[id].js
// Server-renders a seller's storefront page at /atelier/:id, the canonical
// (indexable) URL for that seller's atelier. The interactive client-rendered
// /atelier.html?u=:id page remains for logged-in actions and points its
// canonical at the SSR URL so Google indexes the server-rendered version.
//
// JSON-LD emitted:
//   - ProfilePage  (main entity: the seller as a Person)
//   - ItemList     (the seller's currently active listings)
//   - BreadcrumbList
//
// Fields exposed are limited to public profile data — no email, no
// auth identifiers, no private fields.

const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";
const SITE_BASE = "https://hemlinemarket.com";

// Cap the listings included in the JSON-LD ItemList (and rendered grid)
// so the page stays a reasonable size.
const MAX_LISTINGS_IN_GRID = 60;

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeJsonLd(obj) {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function formatPrice(cents) {
  if (!cents) return null;
  return (Number(cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

async function supabaseFetch(path) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
    });
    if (r.ok) return r.json();
  } catch (e) {}
  return null;
}

function displayName(profile) {
  if (!profile) return "Hemline Member";
  const store = (profile.store_name || profile.shop_name || "").trim();
  if (store) return store;
  const fullName = profile.full_name?.trim();
  if (fullName) return fullName;
  const fl = `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
  if (fl) return fl;
  return profile.display_name || "Hemline Member";
}

function ownerName(profile) {
  if (!profile) return "Hemline Member";
  const fullName = profile.full_name?.trim();
  if (fullName) return fullName;
  const fl = `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
  if (fl) return fl;
  return profile.display_name || displayName(profile);
}

// ---------- Handler ----------

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.redirect(302, "/browse.html");

  // Validate UUID format before hitting Supabase. PostgREST will reject
  // malformed UUIDs anyway, but this short-circuits obviously invalid requests.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).send("Invalid seller ID");
  }

  const profiles = await supabaseFetch(
    `profiles?id=eq.${encodeURIComponent(id)}` +
      `&select=id,store_name,shop_name,first_name,last_name,full_name,display_name,bio,avatar_url,` +
      `is_founder,is_early_seller,seller_number,stripe_account_id,completed_sales,rating_average,rating_count` +
      `&limit=1`
  );

  if (!profiles || profiles.length === 0) {
    return res.status(404).send("Seller not found");
  }
  const profile = profiles[0];

  // Fetch this seller's active, published listings.
  const listings =
    (await supabaseFetch(
      `listings?seller_id=eq.${encodeURIComponent(id)}` +
        `&status=eq.ACTIVE&is_published=eq.true&deleted_at=is.null&yards_available=gt.0` +
        `&select=id,title,price_cents,cover_image_url,image_url_1,yards_available,fiber_content,fabric_type,updated_at` +
        `&order=updated_at.desc&limit=${MAX_LISTINGS_IN_GRID}`
    )) || [];

  const shopName = displayName(profile);
  const personName = ownerName(profile);
  const canonicalUrl = `${SITE_BASE}/atelier/${encodeURIComponent(id)}`;
  const interactiveUrl = `${SITE_BASE}/atelier.html?u=${encodeURIComponent(id)}`;
  const avatarUrl = profile.avatar_url || null;
  const ogImage = avatarUrl || `${SITE_BASE}/images/og-image.jpg`;
  const isVerifiedSeller = !!profile.stripe_account_id;

  // Title and meta description.
  const pageTitle =
    `${shopName} — Sewist's Atelier on Hemline Market`;
  const metaDescription =
    (profile.bio && profile.bio.trim().slice(0, 155)) ||
    `Shop fabric from ${shopName} on Hemline Market. Browse ${listings.length} active listing${listings.length === 1 ? "" : "s"} from this sewist's stash.`;

  // ---------- ProfilePage JSON-LD ----------
  const personEntity = {
    "@type": "Person",
    "@id": canonicalUrl + "#person",
    name: personName,
    url: canonicalUrl,
  };
  if (shopName && shopName !== personName) personEntity.alternateName = shopName;
  if (avatarUrl) personEntity.image = avatarUrl;
  if (profile.bio) personEntity.description = profile.bio;
  if (isVerifiedSeller) {
    personEntity.makesOffer = listings.slice(0, 10).map((l) => ({
      "@type": "Offer",
      url: `${SITE_BASE}/fabric/${encodeURIComponent(l.id)}`,
      itemOffered: {
        "@type": "Product",
        name: l.title,
      },
    }));
  }

  const profilePageSchema = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: canonicalUrl,
    name: pageTitle,
    dateModified: new Date().toISOString(),
    mainEntity: personEntity,
  };

  // Aggregate rating (only if Google's minimum thresholds are met).
  if (
    profile.completed_sales >= 5 &&
    profile.rating_count >= 1 &&
    profile.rating_average
  ) {
    profilePageSchema.mainEntity.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Number(profile.rating_average).toFixed(1),
      reviewCount: profile.rating_count,
      bestRating: 5,
      worstRating: 1,
    };
  }

  // ---------- ItemList JSON-LD ----------
  const listingItems = listings.map((l, idx) => ({
    "@type": "ListItem",
    position: idx + 1,
    url: `${SITE_BASE}/fabric/${encodeURIComponent(l.id)}`,
    name: l.title,
  }));

  const itemListSchema =
    listingItems.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `Listings by ${shopName}`,
          numberOfItems: listingItems.length,
          itemListElement: listingItems,
        }
      : null;

  // ---------- BreadcrumbList JSON-LD ----------
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Hemline Market", item: SITE_BASE + "/" },
      { "@type": "ListItem", position: 2, name: "Browse Fabric", item: `${SITE_BASE}/browse.html` },
      { "@type": "ListItem", position: 3, name: shopName, item: canonicalUrl },
    ],
  };

  // ---------- Render listings grid ----------
  const listingsHtml = listings
    .map((l) => {
      const img = l.cover_image_url || l.image_url_1 || "";
      const price = formatPrice(l.price_cents);
      const yards = l.yards_available
        ? `${l.yards_available} yd${l.yards_available === 1 ? "" : "s"}`
        : "";
      const fab = [l.fabric_type, l.fiber_content].filter(Boolean).join(" · ");
      return `
      <a class="atl-card" href="/fabric/${encodeURIComponent(l.id)}">
        ${img ? `<img class="atl-card-img" src="${escapeHtml(img)}" alt="${escapeHtml(l.title)}" loading="lazy"/>` : `<div class="atl-card-img atl-card-img-empty">No photo</div>`}
        <div class="atl-card-body">
          <div class="atl-card-title">${escapeHtml(l.title)}</div>
          <div class="atl-card-meta">
            ${price ? `<span class="atl-card-price">${escapeHtml(price)}</span>` : ""}
            ${yards ? `<span class="atl-card-yards">${escapeHtml(yards)}</span>` : ""}
          </div>
          ${fab ? `<div class="atl-card-fab">${escapeHtml(fab)}</div>` : ""}
        </div>
      </a>`;
    })
    .join("\n");

  // ---------- Build the HTML ----------
  const profilePageJson = safeJsonLd(profilePageSchema);
  const itemListJson = itemListSchema ? safeJsonLd(itemListSchema) : null;
  const breadcrumbJson = safeJsonLd(breadcrumbSchema);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(metaDescription)}"/>
  <meta name="robots" content="index, follow"/>
  <link rel="canonical" href="${canonicalUrl}"/>

  <meta property="og:type" content="profile"/>
  <meta property="og:url" content="${canonicalUrl}"/>
  <meta property="og:title" content="${escapeHtml(pageTitle)}"/>
  <meta property="og:description" content="${escapeHtml(metaDescription)}"/>
  <meta property="og:image" content="${escapeHtml(ogImage)}"/>
  <meta property="og:site_name" content="Hemline Market"/>

  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}"/>
  <meta name="twitter:description" content="${escapeHtml(metaDescription)}"/>
  <meta name="twitter:image" content="${escapeHtml(ogImage)}"/>

  <script type="application/ld+json">${profilePageJson}</script>
  ${itemListJson ? `<script type="application/ld+json">${itemListJson}</script>` : ""}
  <script type="application/ld+json">${breadcrumbJson}</script>

  <link rel="icon" href="/favicon.ico"/>
  <link rel="stylesheet" href="/styles/hm-modern.css"/>
  <link rel="stylesheet" href="/styles/hm-header.css"/>
  <link rel="stylesheet" href="/styles/hm-typography.css"/>
  <link rel="stylesheet" href="/styles/hm-footer.css"/>

  <style>
    .atl-page { max-width: 1100px; margin: 32px auto 60px; padding: 0 20px; }
    .atl-breadcrumb { font-size: 13px; color: #888; margin-bottom: 18px; }
    .atl-breadcrumb a { color: #c8a96e; text-decoration: none; }
    .atl-breadcrumb a:hover { text-decoration: underline; }
    .atl-header { display: grid; grid-template-columns: 92px 1fr; gap: 18px; align-items: center; padding: 22px; background: #fff; border: 1px solid #e8e0d5; border-radius: 14px; margin-bottom: 22px; }
    @media (max-width: 520px) { .atl-header { grid-template-columns: 64px 1fr; gap: 12px; padding: 16px; } }
    .atl-avatar { width: 92px; height: 92px; border-radius: 50%; overflow: hidden; background: #f3eee5; display: flex; align-items: center; justify-content: center; }
    @media (max-width: 520px) { .atl-avatar { width: 64px; height: 64px; } }
    .atl-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .atl-avatar-fallback { font-size: 32px; color: #c8a96e; }
    .atl-shop-name { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: 0.02em; color: #1a1a1a; }
    @media (max-width: 520px) { .atl-shop-name { font-size: 20px; } }
    .atl-owner-name { margin: 4px 0 0; font-size: 14px; color: #666; }
    .atl-badges { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
    .atl-badge { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.05em; }
    .atl-badge.founder { background: #fee2e2; color: #991b1b; }
    .atl-badge.early { background: #fef3c7; color: #92400e; }
    .atl-bio { margin-top: 10px; font-size: 14px; line-height: 1.6; color: #444; }
    .atl-rating { margin-top: 8px; font-size: 13px; color: #92400e; }
    .atl-cta-row { margin-top: 14px; }
    .atl-cta { display: inline-block; background: #1a1a1a; color: #fff; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; }
    .atl-cta:hover { background: #333; }
    .atl-listings-heading { margin: 24px 0 14px; font-size: 18px; font-weight: 700; color: #1a1a1a; }
    .atl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 18px; }
    .atl-card { display: block; background: #fff; border: 1px solid #e8e0d5; border-radius: 12px; overflow: hidden; text-decoration: none; color: inherit; transition: transform .12s, box-shadow .12s; }
    .atl-card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,.06); }
    .atl-card-img { width: 100%; aspect-ratio: 4/3; object-fit: cover; background: #f5f0ea; }
    .atl-card-img-empty { display: flex; align-items: center; justify-content: center; color: #aaa; font-size: 13px; }
    .atl-card-body { padding: 12px 14px 14px; }
    .atl-card-title { font-size: 14px; font-weight: 600; color: #1a1a1a; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.6em; }
    .atl-card-meta { display: flex; gap: 10px; align-items: baseline; margin-top: 6px; font-size: 13px; }
    .atl-card-price { font-weight: 700; color: #1a1a1a; }
    .atl-card-yards { color: #888; }
    .atl-card-fab { font-size: 12px; color: #888; margin-top: 4px; }
    .atl-empty { padding: 40px 20px; text-align: center; color: #888; background: #fff; border: 1px solid #e8e0d5; border-radius: 12px; }
  </style>
</head>
<body>
  <div id="hm-header"></div>

  <main class="atl-page">
    <nav class="atl-breadcrumb" aria-label="Breadcrumb">
      <a href="/">Hemline Market</a> &rsaquo;
      <a href="/browse.html">Browse Fabric</a> &rsaquo;
      ${escapeHtml(shopName)}
    </nav>

    <header class="atl-header">
      <div class="atl-avatar">
        ${
          avatarUrl
            ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(shopName)}"/>`
            : `<span class="atl-avatar-fallback">👤</span>`
        }
      </div>
      <div>
        <h1 class="atl-shop-name">${escapeHtml(shopName)}</h1>
        ${
          personName && personName !== shopName
            ? `<p class="atl-owner-name">by ${escapeHtml(personName)}</p>`
            : ""
        }
        ${
          profile.is_founder || profile.is_early_seller
            ? `<div class="atl-badges">
                ${profile.is_founder ? '<span class="atl-badge founder">★ Founding seller</span>' : ""}
                ${profile.is_early_seller ? '<span class="atl-badge early">Early seller</span>' : ""}
              </div>`
            : ""
        }
        ${profile.bio ? `<p class="atl-bio">${escapeHtml(profile.bio)}</p>` : ""}
        ${
          profile.completed_sales >= 5 && profile.rating_count >= 1 && profile.rating_average
            ? `<p class="atl-rating">★ ${Number(profile.rating_average).toFixed(1)} / 5 (${profile.rating_count} review${profile.rating_count === 1 ? "" : "s"})</p>`
            : ""
        }
        <div class="atl-cta-row">
          <a class="atl-cta" href="${escapeHtml(interactiveUrl)}">Open in Hemline Market →</a>
        </div>
      </div>
    </header>

    <h2 class="atl-listings-heading">${listings.length > 0 ? `Active Listings (${listings.length})` : "Listings"}</h2>

    ${
      listings.length > 0
        ? `<div class="atl-grid">${listingsHtml}</div>`
        : `<div class="atl-empty">No active listings right now. Check back soon.</div>`
    }
  </main>

  <div id="hm-footer"></div>

  <script src="/scripts/supabase-config.js"></script>
  <script src="/scripts/hm-shell.js"></script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).send(html);
}

// api/listing/[id].js
// Server-renders a fabric listing page at /fabric/:id (canonical URL).
//
// SEO improvements over the previous version:
//   - Removed microdata (itemscope / itemtype / itemprop) from the markup that
//     was duplicating the JSON-LD as a string-typed source. JSON-LD is now the
//     single source of truth (avoids the same "Invalid object type" class of
//     Search Console error that hit DiscussionForumPosting).
//   - Product schema now includes the fields Google requires for Merchant
//     listing experiences: priceValidUntil, hasMerchantReturnPolicy,
//     shippingDetails (computed from the listing's yardage tier per the
//     site's published shipping rates: $5/$8/$14 lightweight/standard/heavy).
//   - Seller is now a Person with a url pointing to atelier.html?u={seller_id}
//     so it links into the site's seller storefront page.
//   - Adds brand, productID, additionalProperty (yardage, width, weight,
//     fiber content, fabric type, condition, stretch).
//   - Adds BreadcrumbList JSON-LD (Home → Browse → listing title).

const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";
const SITE_BASE = "https://hemlinemarket.com";

// Days the price is valid for in Product schema (Google requires priceValidUntil).
const PRICE_VALID_DAYS = 30;

// Shipping tiers (from terms.html):
//   < 3 yards  → Lightweight $5
//   3–10 yards → Standard    $8
//   > 10 yards → Heavy       $14
function shippingForYards(yards) {
  const y = Number(yards) || 0;
  if (y > 10) return { value: "14.00", tier: "Heavy" };
  if (y >= 3) return { value: "8.00", tier: "Standard" };
  return { value: "5.00", tier: "Lightweight" };
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPrice(cents) {
  if (!cents) return null;
  return (Number(cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function isoDateInDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
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

// schema.org condition mapping
function mapCondition(raw) {
  const c = String(raw || "").toLowerCase();
  if (c === "new" || c === "new_with_tags") return "https://schema.org/NewCondition";
  if (c === "like_new") return "https://schema.org/NewCondition";
  if (c === "used" || c === "preowned" || c === "vintage") return "https://schema.org/UsedCondition";
  if (c === "refurbished") return "https://schema.org/RefurbishedCondition";
  return "https://schema.org/NewCondition";
}

function displayName(profile, fallback) {
  if (!profile) return fallback || "Hemline Seller";
  const store = (profile.store_name || "").trim();
  if (store) return store;
  const person = `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
  return person || fallback || "Hemline Seller";
}

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.redirect(302, "/browse.html");

  const listings = await supabaseFetch(
    `listings?id=eq.${encodeURIComponent(id)}&deleted_at=is.null&limit=1`
  );

  if (!listings || listings.length === 0) {
    return res.status(404).send("Listing not found");
  }

  const listing = listings[0];

  // Fetch seller profile
  let seller = null;
  if (listing.seller_id) {
    const profiles = await supabaseFetch(
      `profiles?id=eq.${listing.seller_id}&select=store_name,first_name,last_name&limit=1`
    );
    if (profiles && profiles.length > 0) seller = profiles[0];
  }

  const sellerName = displayName(seller, listing.store_name);
  const sellerUrl = listing.seller_id
    ? `${SITE_BASE}/atelier.html?u=${encodeURIComponent(listing.seller_id)}`
    : null;

  // Field name fallbacks — the listings table has gone through a schema
  // evolution; both old and new names appear in the codebase.
  const yards =
    listing.yards_available ??
    listing.yardage ??
    null;
  const widthIn =
    listing.width_inches ??
    listing.width_in ??
    listing.width ??
    null;
  const weightOz = listing.weight_oz ?? null;
  const handlingMin = Number(listing.handling_days_min) || 1;
  const handlingMax = Number(listing.handling_days_max) || 3;

  const price = formatPrice(listing.price_cents);
  const title = listing.title || listing.name || "Fabric Listing";
  const status = String(listing.status || "").toUpperCase();
  const isSold = status === "SOLD";
  const canonicalUrl = `${SITE_BASE}/fabric/${id}`;

  const detailParts = [];
  if (yards) detailParts.push(`${yards} yards`);
  if (widthIn) detailParts.push(`${widthIn}" wide`);
  if (listing.fiber_content) detailParts.push(listing.fiber_content);
  if (listing.fabric_type) detailParts.push(listing.fabric_type);
  const details = detailParts.join(" · ");

  const images = [
    listing.cover_image_url,
    listing.image_url_1,
    listing.image_url_2,
    listing.image_url_3,
  ].filter(Boolean);

  const ogImage = images[0] || `${SITE_BASE}/images/og-image.jpg`;

  const metaDescription = [
    title,
    details,
    price ? `${price} — Buy on Hemline Market` : "Available on Hemline Market",
  ]
    .filter(Boolean)
    .join(" — ")
    .slice(0, 160);

  // ---------- Build Product JSON-LD ----------
  const offer = {
    "@type": "Offer",
    url: canonicalUrl,
    priceCurrency: "USD",
    availability: isSold
      ? "https://schema.org/SoldOut"
      : "https://schema.org/InStock",
    itemCondition: mapCondition(listing.condition),
  };

  if (listing.price_cents) {
    offer.price = (listing.price_cents / 100).toFixed(2);
    offer.priceValidUntil = isoDateInDays(PRICE_VALID_DAYS);
  }

  // Seller — Person with url to their atelier page when available.
  offer.seller = sellerUrl
    ? { "@type": "Person", name: sellerName, url: sellerUrl }
    : { "@type": "Person", name: sellerName };

  // Shipping details — derived from yardage tier.
  if (!isSold) {
    const ship = shippingForYards(yards);
    offer.shippingDetails = {
      "@type": "OfferShippingDetails",
      shippingRate: {
        "@type": "MonetaryAmount",
        value: ship.value,
        currency: "USD",
      },
      shippingDestination: {
        "@type": "DefinedRegion",
        addressCountry: "US",
      },
      deliveryTime: {
        "@type": "ShippingDeliveryTime",
        handlingTime: {
          "@type": "QuantitativeValue",
          minValue: handlingMin,
          maxValue: handlingMax,
          unitCode: "DAY",
        },
        transitTime: {
          "@type": "QuantitativeValue",
          minValue: 2,
          maxValue: 7,
          unitCode: "DAY",
        },
      },
    };
  }

  // Return policy — per terms.html: 3-day return window for misrepresented items.
  offer.hasMerchantReturnPolicy = {
    "@type": "MerchantReturnPolicy",
    applicableCountry: "US",
    returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
    merchantReturnDays: 3,
    returnMethod: "https://schema.org/ReturnByMail",
    returnFees: "https://schema.org/FreeReturn",
  };

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": canonicalUrl,
    url: canonicalUrl,
    name: title,
    description: listing.description || title,
    sku: id,
    productID: id,
    image: images,
    category: "Fabric",
    offers: offer,
  };

  // Brand — fall back to Hemline Market for the marketplace itself if no
  // designer/brand is attached to the listing.
  const brandName = (listing.brand && String(listing.brand).trim()) || null;
  productSchema.brand = brandName
    ? { "@type": "Brand", name: brandName }
    : { "@type": "Organization", name: "Hemline Market" };

  if (listing.fiber_content) productSchema.material = listing.fiber_content;
  if (listing.fabric_type) productSchema.color = undefined; // no color field in DB
  if (weightOz) {
    productSchema.weight = {
      "@type": "QuantitativeValue",
      value: weightOz,
      unitCode: "ONZ", // UN/CEFACT code for ounces (avoirdupois)
    };
  }

  // additionalProperty — exposes fabric-specific attributes search engines
  // can surface in shopping comparisons.
  const props = [];
  if (yards != null) {
    props.push({
      "@type": "PropertyValue",
      name: "Yards Available",
      value: yards,
      unitText: "yards",
    });
  }
  if (widthIn != null) {
    props.push({
      "@type": "PropertyValue",
      name: "Width",
      value: widthIn,
      unitText: "inches",
    });
  }
  if (listing.fiber_content) {
    props.push({
      "@type": "PropertyValue",
      name: "Fiber Content",
      value: listing.fiber_content,
    });
  }
  if (listing.fabric_type) {
    props.push({
      "@type": "PropertyValue",
      name: "Fabric Type",
      value: listing.fabric_type,
    });
  }
  if (listing.stretch) {
    props.push({
      "@type": "PropertyValue",
      name: "Stretch",
      value: listing.stretch,
    });
  }
  if (listing.condition) {
    props.push({
      "@type": "PropertyValue",
      name: "Condition",
      value: listing.condition,
    });
  }
  if (props.length > 0) productSchema.additionalProperty = props;

  // ---------- Build BreadcrumbList JSON-LD ----------
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Hemline Market", item: SITE_BASE + "/" },
      { "@type": "ListItem", position: 2, name: "Browse Fabric", item: `${SITE_BASE}/browse.html` },
      { "@type": "ListItem", position: 3, name: title, item: canonicalUrl },
    ],
  };

  const productJsonLd = JSON.stringify(productSchema);
  const breadcrumbJsonLd = JSON.stringify(breadcrumbSchema);

  // ---------- Image gallery markup (no microdata) ----------
  const imageGallery = images
    .map(
      (url, i) =>
        `<img src="${escapeHtml(url)}" alt="${escapeHtml(title)}" loading="${i === 0 ? "eager" : "lazy"}" class="listing-photo"/>`
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(title)} — Hemline Market</title>
  <meta name="description" content="${escapeHtml(metaDescription)}"/>
  <meta name="robots" content="${isSold ? "noindex" : "index, follow"}"/>
  <link rel="canonical" href="${canonicalUrl}"/>
  <meta property="og:type" content="product"/>
  <meta property="og:url" content="${canonicalUrl}"/>
  <meta property="og:title" content="${escapeHtml(title)} — Hemline Market"/>
  <meta property="og:description" content="${escapeHtml(metaDescription)}"/>
  <meta property="og:image" content="${escapeHtml(ogImage)}"/>
  <meta property="og:site_name" content="Hemline Market"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${escapeHtml(title)} — Hemline Market"/>
  <meta name="twitter:description" content="${escapeHtml(metaDescription)}"/>
  <meta name="twitter:image" content="${escapeHtml(ogImage)}"/>

  <script type="application/ld+json">${productJsonLd}</script>
  <script type="application/ld+json">${breadcrumbJsonLd}</script>

  <link rel="icon" href="/favicon.ico"/>
  <link rel="stylesheet" href="/styles/hm-modern.css"/>
  <link rel="stylesheet" href="/styles/hm-header.css"/>
  <link rel="stylesheet" href="/styles/hm-typography.css"/>
  <link rel="stylesheet" href="/styles/hm-footer.css"/>
  <style>
    .fabric-page { max-width: 900px; margin: 40px auto; padding: 0 20px 60px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
    @media (max-width: 640px) { .fabric-page { grid-template-columns: 1fr; } }
    .fabric-breadcrumb { grid-column: 1 / -1; font-size: 13px; color: #888; }
    .fabric-breadcrumb a { color: #c8a96e; text-decoration: none; }
    .fabric-breadcrumb a:hover { text-decoration: underline; }
    .fabric-gallery { display: flex; flex-direction: column; gap: 10px; }
    .listing-photo { width: 100%; border-radius: 10px; object-fit: cover; aspect-ratio: 4/3; background: #f5f0ea; }
    .fabric-info { display: flex; flex-direction: column; gap: 14px; }
    .fabric-title { font-size: 24px; font-weight: 700; color: #1a1a1a; margin: 0; line-height: 1.3; }
    .fabric-price { font-size: 28px; font-weight: 700; color: #1a1a1a; margin: 0; }
    .fabric-details { font-size: 14px; color: #666; margin: 0; }
    .fabric-seller { font-size: 13px; color: #888; margin: 0; }
    .fabric-seller a { color: #444; text-decoration: none; font-weight: 600; }
    .fabric-seller a:hover { text-decoration: underline; }
    .fabric-description { font-size: 15px; line-height: 1.7; color: #333; white-space: pre-wrap; }
    .sold-badge { display: inline-block; background: #fee2e2; color: #991b1b; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 20px; text-transform: uppercase; }
    .fabric-cta { display: block; background: #1a1a1a; color: #fff; text-align: center; padding: 14px 24px; border-radius: 8px; text-decoration: none; font-size: 15px; font-weight: 600; }
    .fabric-cta:hover { background: #333; }
    .fabric-cta-sold { background: #ccc; pointer-events: none; }
  </style>
</head>
<body>
  <div id="hm-header"></div>
  <main>
    <div class="fabric-page">
      <nav class="fabric-breadcrumb" aria-label="Breadcrumb">
        <a href="/">Hemline Market</a> &rsaquo;
        <a href="/browse.html">Browse Fabric</a> &rsaquo;
        ${escapeHtml(title)}
      </nav>
      <div class="fabric-gallery">
        ${imageGallery || `<div class="listing-photo" style="display:flex;align-items:center;justify-content:center;color:#ccc;font-size:13px;">No photo</div>`}
      </div>
      <div class="fabric-info">
        ${isSold ? '<span class="sold-badge">Sold</span>' : ""}
        <h1 class="fabric-title">${escapeHtml(title)}</h1>
        ${price ? `<p class="fabric-price">${escapeHtml(price)}</p>` : ""}
        ${details ? `<p class="fabric-details">${escapeHtml(details)}</p>` : ""}
        <p class="fabric-seller">Sold by ${
          sellerUrl
            ? `<a href="/atelier.html?u=${escapeHtml(listing.seller_id)}">${escapeHtml(sellerName)}</a>`
            : `<strong>${escapeHtml(sellerName)}</strong>`
        }</p>
        ${listing.description ? `<div class="fabric-description">${escapeHtml(listing.description)}</div>` : ""}
        <a href="/listing.html?id=${encodeURIComponent(id)}" class="fabric-cta${isSold ? " fabric-cta-sold" : ""}">
          ${isSold ? "This listing has sold" : "View listing &amp; buy →"}
        </a>
      </div>
    </div>
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

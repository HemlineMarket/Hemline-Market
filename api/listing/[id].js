// SAVE THIS FILE AS: api/listing/[id].js
// (replace the existing file at that path)

const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";
const SITE_BASE = "https://hemlinemarket.com";

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

  const sellerName =
    seller?.store_name ||
    (seller?.first_name
      ? `${seller.first_name} ${seller.last_name || ""}`.trim()
      : null) ||
    listing.store_name ||
    "Hemline Seller";

  const price = formatPrice(listing.price_cents);
  const title = listing.title || listing.name || "Fabric Listing";
  const isSold = (listing.status || "").toUpperCase() === "SOLD";
  const canonicalUrl = `${SITE_BASE}/fabric/${id}`;

  const detailParts = [];
  if (listing.yardage) detailParts.push(`${listing.yardage} yards`);
  if (listing.width) detailParts.push(`${listing.width}" wide`);
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

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: title,
    description: listing.description || title,
    sku: id,
    image: images,
    offers: {
      "@type": "Offer",
      url: canonicalUrl,
      priceCurrency: "USD",
      price: listing.price_cents
        ? (listing.price_cents / 100).toFixed(2)
        : undefined,
      availability: isSold
        ? "https://schema.org/SoldOut"
        : "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: sellerName },
    },
    ...(listing.fiber_content ? { material: listing.fiber_content } : {}),
  });

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
  <script type="application/ld+json">${jsonLd}</script>
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
    .fabric-seller strong { color: #444; }
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
    <div class="fabric-page" itemscope itemtype="https://schema.org/Product">
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
        <h1 class="fabric-title" itemprop="name">${escapeHtml(title)}</h1>
        ${price ? `<p class="fabric-price">${escapeHtml(price)}</p>` : ""}
        ${details ? `<p class="fabric-details">${escapeHtml(details)}</p>` : ""}
        <p class="fabric-seller">Sold by <strong>${escapeHtml(sellerName)}</strong></p>
        ${listing.description ? `<div class="fabric-description" itemprop="description">${escapeHtml(listing.description)}</div>` : ""}
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

// File: /api/sitemap.js
// Dynamic sitemap generator that includes all active listings
// This ensures search engines can discover and index all your fabric listings

import supabaseAdmin from "./_supabaseAdmin.js";

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Fetch all active, published listings
    const { data: listings, error } = await supabaseAdmin
      .from("listings")
      .select("id, updated_at, title, image_url_1")
      .eq("status", "ACTIVE")
      .eq("is_published", true)
      .gt("yards_available", 0)
      .order("published_at", { ascending: false });

    if (error) {
      console.error("Sitemap: Error fetching listings:", error);
      // Return static sitemap if DB fails
      return res.status(200).setHeader("Content-Type", "application/xml").send(getStaticSitemap());
    }

    // Fetch all seller profiles with active listings (for atelier pages)
    const { data: sellers, error: sellersError } = await supabaseAdmin
      .from("profiles")
      .select("id, updated_at")
      .eq("is_seller", true);

    const sellerIds = sellersError ? [] : (sellers || []);

    // Build the XML sitemap
    const xml = buildSitemap(listings || [], sellerIds);

    // Set cache headers - cache for 1 hour, stale-while-revalidate for 24 hours
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    
    return res.status(200).send(xml);

  } catch (err) {
    console.error("Sitemap: Unexpected error:", err);
    return res.status(200).setHeader("Content-Type", "application/xml").send(getStaticSitemap());
  }
}

function buildSitemap(listings, sellers) {
  const baseUrl = "https://hemlinemarket.com";
  const now = new Date().toISOString();

  // Static pages with their priorities and change frequencies
  const staticPages = [
    { loc: "/", priority: "1.0", changefreq: "daily" },
    { loc: "/browse.html", priority: "0.9", changefreq: "hourly" },
    { loc: "/sell.html", priority: "0.8", changefreq: "weekly" },
    { loc: "/about.html", priority: "0.7", changefreq: "monthly" },
    { loc: "/how.html", priority: "0.7", changefreq: "monthly" },
    { loc: "/contact.html", priority: "0.6", changefreq: "monthly" },
    { loc: "/faq.html", priority: "0.6", changefreq: "monthly" },
    { loc: "/auth.html", priority: "0.6", changefreq: "monthly" },
    { loc: "/signin.html", priority: "0.5", changefreq: "monthly" },
    { loc: "/privacy.html", priority: "0.4", changefreq: "yearly" },
    { loc: "/terms.html", priority: "0.4", changefreq: "yearly" },
    { loc: "/returns.html", priority: "0.5", changefreq: "monthly" },
    // ThreadTalk community pages
    { loc: "/ThreadTalk.html", priority: "0.6", changefreq: "daily" },
    { loc: "/showcase.html", priority: "0.5", changefreq: "daily" },
    { loc: "/stitch-school.html", priority: "0.5", changefreq: "weekly" },
    { loc: "/pattern-hacks.html", priority: "0.5", changefreq: "weekly" },
    { loc: "/fabric-sos.html", priority: "0.5", changefreq: "daily" },
    { loc: "/loose-threads.html", priority: "0.5", changefreq: "daily" },
    { loc: "/before-after.html", priority: "0.5", changefreq: "weekly" },
    { loc: "/tailoring.html", priority: "0.5", changefreq: "weekly" },
    { loc: "/cosplay.html", priority: "0.5", changefreq: "weekly" },
  ];

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">

  <!-- Static pages -->
`;

  // Add static pages
  for (const page of staticPages) {
    xml += `  <url>
    <loc>${baseUrl}${page.loc}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>
`;
  }

  // Add listing pages with images for rich results
  xml += `
  <!-- Fabric Listings (${listings.length} active) -->
`;

  for (const listing of listings) {
    const lastmod = listing.updated_at 
      ? new Date(listing.updated_at).toISOString().split("T")[0]
      : now.split("T")[0];
    
    xml += `  <url>
    <loc>${baseUrl}/fabric/${listing.id}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>`;
    
    // Add image sitemap data if available
    if (listing.image_url_1) {
      const safeTitle = (listing.title || "Fabric listing").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      xml += `
    <image:image>
      <image:loc>${listing.image_url_1}</image:loc>
      <image:title>${safeTitle}</image:title>
    </image:image>`;
    }
    
    xml += `
  </url>
`;
  }

  // Add seller atelier pages
  if (sellers.length > 0) {
    xml += `
  <!-- Seller Ateliers (${sellers.length} sellers) -->
`;
    for (const seller of sellers) {
      const lastmod = seller.updated_at 
        ? new Date(seller.updated_at).toISOString().split("T")[0]
        : now.split("T")[0];
      
      xml += `  <url>
    <loc>${baseUrl}/atelier.html?id=${seller.id}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>
`;
    }
  }

  xml += `</urlset>`;

  return xml;
}

// Fallback static sitemap if database is unavailable
function getStaticSitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://hemlinemarket.com/</loc><priority>1.0</priority></url>
  <url><loc>https://hemlinemarket.com/browse.html</loc><priority>0.9</priority></url>
  <url><loc>https://hemlinemarket.com/sell.html</loc><priority>0.8</priority></url>
  <url><loc>https://hemlinemarket.com/about.html</loc><priority>0.7</priority></url>
  <url><loc>https://hemlinemarket.com/how.html</loc><priority>0.7</priority></url>
  <url><loc>https://hemlinemarket.com/contact.html</loc><priority>0.6</priority></url>
  <url><loc>https://hemlinemarket.com/faq.html</loc><priority>0.6</priority></url>
  <url><loc>https://hemlinemarket.com/privacy.html</loc><priority>0.4</priority></url>
  <url><loc>https://hemlinemarket.com/terms.html</loc><priority>0.4</priority></url>
</urlset>`;
}

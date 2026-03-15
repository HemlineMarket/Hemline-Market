const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";
const SITE_BASE = "https://hemlinemarket.com";

const STATIC_PAGES = [
  { url: "/", priority: "1.0", changefreq: "daily" },
  { url: "/browse.html", priority: "0.9", changefreq: "daily" },
  { url: "/sell.html", priority: "0.8", changefreq: "weekly" },
  { url: "/about.html", priority: "0.7", changefreq: "monthly" },
  { url: "/how.html", priority: "0.7", changefreq: "monthly" },
  { url: "/contact.html", priority: "0.6", changefreq: "monthly" },
  { url: "/faq.html", priority: "0.6", changefreq: "monthly" },
  { url: "/auth.html", priority: "0.6", changefreq: "monthly" },
  { url: "/atelier.html", priority: "0.6", changefreq: "weekly" },
  { url: "/ThreadTalk.html", priority: "0.5", changefreq: "weekly" },
  { url: "/showcase.html", priority: "0.5", changefreq: "weekly" },
  { url: "/stitch-school.html", priority: "0.5", changefreq: "weekly" },
  { url: "/pattern-hacks.html", priority: "0.5", changefreq: "weekly" },
  { url: "/fabric-sos.html", priority: "0.5", changefreq: "weekly" },
  { url: "/tailoring.html", priority: "0.5", changefreq: "weekly" },
  { url: "/privacy.html", priority: "0.4", changefreq: "monthly" },
  { url: "/terms.html", priority: "0.4", changefreq: "monthly" },
  { url: "/returns.html", priority: "0.5", changefreq: "monthly" },
  { url: "/seller/", priority: "0.6", changefreq: "weekly" },
];

export default async function handler(req, res) {
  const today = new Date().toISOString().split("T")[0];

  // Fetch active listings
  let listings = [];
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/listings?select=id,updated_at&status=eq.active&order=updated_at.desc`,
      {
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
        },
      }
    );
    if (r.ok) listings = await r.json();
  } catch (e) {
    // If Supabase fails, still return static pages
    console.error("Supabase fetch failed:", e);
  }

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  // Static pages
  for (const page of STATIC_PAGES) {
    xml += `  <url>\n    <loc>${SITE_BASE}${page.url}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${page.changefreq}</changefreq>\n    <priority>${page.priority}</priority>\n  </url>\n`;
  }

  // Individual listing pages
  for (const listing of listings) {
    const lastmod = listing.updated_at
      ? new Date(listing.updated_at).toISOString().split("T")[0]
      : today;
    xml += `  <url>\n    <loc>${SITE_BASE}/listing.html?id=${encodeURIComponent(listing.id)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
  }

  xml += `</urlset>`;

  res.setHeader("Content-Type", "application/xml");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
  res.status(200).send(xml);
}

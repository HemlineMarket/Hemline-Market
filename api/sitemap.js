// api/sitemap.js
// Dynamic sitemap covering static pages, all active listings (/fabric/:id),
// and all public ThreadTalk posts (/thread/:id).

const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";
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
  { url: "/ThreadTalk.html", priority: "0.7", changefreq: "daily" },
  { url: "/showcase.html", priority: "0.6", changefreq: "daily" },
  { url: "/stitch-school.html", priority: "0.6", changefreq: "weekly" },
  { url: "/pattern-hacks.html", priority: "0.6", changefreq: "weekly" },
  { url: "/fabric-sos.html", priority: "0.6", changefreq: "weekly" },
  { url: "/tailoring.html", priority: "0.6", changefreq: "weekly" },
  { url: "/before-after.html", priority: "0.6", changefreq: "weekly" },
  { url: "/loose-threads.html", priority: "0.6", changefreq: "weekly" },
  { url: "/privacy.html", priority: "0.4", changefreq: "monthly" },
  { url: "/terms.html", priority: "0.4", changefreq: "monthly" },
  { url: "/returns.html", priority: "0.5", changefreq: "monthly" },
  { url: "/seller/", priority: "0.6", changefreq: "weekly" },
];

async function supabaseFetch(path) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
    });
    if (r.ok) return r.json();
  } catch (e) {
    console.error("Supabase fetch failed:", e);
  }
  return [];
}

export default async function handler(req, res) {
  const today = new Date().toISOString().split("T")[0];

  // Fetch active listings for /fabric/:id URLs
  const listings = await supabaseFetch(
    "listings?select=id,updated_at&status=eq.ACTIVE&deleted_at=is.null&order=updated_at.desc"
  );

  // Fetch public ThreadTalk posts for /thread/:id URLs
  const threads = await supabaseFetch(
    "threadtalk_threads?select=id,updated_at&is_deleted=eq.false&order=updated_at.desc"
  );

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  // Static pages
  for (const page of STATIC_PAGES) {
    xml += `  <url>\n    <loc>${SITE_BASE}${page.url}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${page.changefreq}</changefreq>\n    <priority>${page.priority}</priority>\n  </url>\n`;
  }

  // Active listings — canonical URL is /fabric/:id (SSR route)
  for (const listing of listings) {
    const lastmod = listing.updated_at
      ? new Date(listing.updated_at).toISOString().split("T")[0]
      : today;
    xml += `  <url>\n    <loc>${SITE_BASE}/fabric/${encodeURIComponent(listing.id)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
  }

  // ThreadTalk posts — canonical URL is /thread/:id (SSR route)
  for (const thread of threads) {
    const lastmod = thread.updated_at
      ? new Date(thread.updated_at).toISOString().split("T")[0]
      : today;
    xml += `  <url>\n    <loc>${SITE_BASE}/thread/${thread.id}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
  }

  xml += `</urlset>`;

  res.setHeader("Content-Type", "application/xml");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
  res.status(200).send(xml);
}

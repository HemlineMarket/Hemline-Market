// File: /api/listing/[id].js
// Redirect /fabric/[id] to listing.html?id=[id]
// The sitemap uses /fabric/ URLs for clean SEO, this redirects to the working page

export default async function handler(req, res) {
  const { id } = req.query;

  if (!id) {
    return res.redirect(302, "/browse.html");
  }

  // 301 permanent redirect to the listing page
  return res.redirect(301, `/listing.html?id=${id}`);
}

// File: /api/listing/[id].js
// Server-side rendering for listing pages with proper meta tags for SEO
// This ensures search engines see correct titles, descriptions, and images

import supabaseAdmin from "../_supabaseAdmin.js";
import { readFileSync } from "fs";
import { join } from "path";

export const config = {
  runtime: "nodejs18.x",
};

export default async function handler(req, res) {
  const { id } = req.query;

  if (!id) {
    // Redirect to browse if no ID
    return res.redirect(302, "/browse.html");
  }

  try {
    // Fetch the listing from Supabase
    const { data: listing, error } = await supabaseAdmin
      .from("listings")
      .select(`
        id,
        title,
        description,
        image_url_1,
        image_url_2,
        image_url_3,
        price_cents,
        yards_available,
        status,
        is_published,
        content,
        fabric_type,
        designer,
        width_inches,
        seller_id
      `)
      .eq("id", id)
      .single();

    if (error || !listing) {
      console.error("Listing fetch error:", error);
      // Redirect to 404 or browse
      return res.redirect(302, "/browse.html");
    }

    // Fetch seller info
    let sellerName = "Hemline Market seller";
    if (listing.seller_id) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("store_name, first_name, last_name, display_name")
        .eq("id", listing.seller_id)
        .single();

      if (profile) {
        sellerName = profile.store_name || 
          (profile.first_name ? `${profile.first_name} ${profile.last_name || ""}`.trim() : null) ||
          profile.display_name || 
          "Hemline Market seller";
      }
    }

    // Build meta content
    const title = listing.title || "Fabric Listing";
    const fullTitle = `${title} — Hemline Market`;
    const description = listing.description 
      ? listing.description.substring(0, 155) + (listing.description.length > 155 ? "..." : "")
      : `Buy ${title} on Hemline Market. Secure checkout and prepaid shipping.`;
    const imageUrl = listing.image_url_1 || "https://hemlinemarket.com/images/og-image.jpg";
    const pageUrl = `https://hemlinemarket.com/fabric/${listing.id}`;
    
    // Price formatting
    const priceDollars = listing.price_cents 
      ? (listing.price_cents / 100).toFixed(2) 
      : null;
    const priceDisplay = priceDollars ? `$${priceDollars}/yard` : "";
    const yardsDisplay = listing.yards_available ? `${listing.yards_available} yards available` : "";

    // Build JSON-LD structured data
    const jsonLd = buildProductSchema(listing, sellerName, priceDollars);
    const jsonLdScript = `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;

    // Read the original listing.html template
    let html;
    try {
      html = readFileSync(join(process.cwd(), "public", "listing.html"), "utf8");
    } catch (e) {
      console.error("Failed to read listing.html:", e);
      return res.redirect(302, `/listing.html?id=${id}`);
    }

    // Replace meta tags in the HTML
    const escTitle = escapeHtml(fullTitle);
    const escDesc = escapeHtml(description);
    const escImage = escapeHtml(imageUrl);
    const escUrl = escapeHtml(pageUrl);

    // Replace <title>
    html = html.replace(
      /<title>.*?<\/title>/i,
      `<title>${escTitle}</title>`
    );

    // Replace meta description
    html = html.replace(
      /<meta name="description" content="[^"]*"/i,
      `<meta name="description" content="${escDesc}"`
    );

    // Replace Open Graph tags
    html = html.replace(
      /<meta property="og:title" content="[^"]*"/i,
      `<meta property="og:title" content="${escTitle}"`
    );
    html = html.replace(
      /<meta property="og:description" content="[^"]*"/i,
      `<meta property="og:description" content="${escDesc}"`
    );
    html = html.replace(
      /<meta property="og:image" content="[^"]*"/i,
      `<meta property="og:image" content="${escImage}"`
    );
    html = html.replace(
      /<meta property="og:url" content="[^"]*"/i,
      `<meta property="og:url" content="${escUrl}"`
    );

    // Replace Twitter Card tags
    html = html.replace(
      /<meta name="twitter:title" content="[^"]*"/i,
      `<meta name="twitter:title" content="${escTitle}"`
    );
    html = html.replace(
      /<meta name="twitter:description" content="[^"]*"/i,
      `<meta name="twitter:description" content="${escDesc}"`
    );
    html = html.replace(
      /<meta name="twitter:image" content="[^"]*"/i,
      `<meta name="twitter:image" content="${escImage}"`
    );

    // Add canonical URL if not present
    if (!html.includes('rel="canonical"')) {
      html = html.replace(
        "</head>",
        `  <link rel="canonical" href="${escUrl}"/>\n</head>`
      );
    }

    // Inject JSON-LD structured data before </head>
    html = html.replace(
      "</head>",
      `  ${jsonLdScript}\n</head>`
    );

    // Set cache headers
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
    
    return res.status(200).send(html);

  } catch (err) {
    console.error("Listing SSR error:", err);
    // Fall back to client-side rendering
    return res.redirect(302, `/listing.html?id=${id}`);
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildProductSchema(listing, sellerName, priceDollars) {
  const status = (listing.status || "").toLowerCase();
  const inStock = status !== "sold" && listing.yards_available > 0 && listing.is_published;

  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": listing.title || "Fabric Listing",
    "description": listing.description || listing.title || "",
    "sku": listing.id,
    "category": "Fabric",
    "image": [],
  };

  // Add images
  if (listing.image_url_1) schema.image.push(listing.image_url_1);
  if (listing.image_url_2) schema.image.push(listing.image_url_2);
  if (listing.image_url_3) schema.image.push(listing.image_url_3);
  if (schema.image.length === 0) {
    schema.image = ["https://hemlinemarket.com/images/og-image.jpg"];
  }

  // Add material/fiber content
  if (listing.content && listing.content !== "Not sure" && listing.content !== "Other") {
    schema.material = listing.content;
  }

  // Add offer/pricing
  if (priceDollars) {
    schema.offers = {
      "@type": "Offer",
      "url": `https://hemlinemarket.com/fabric/${listing.id}`,
      "priceCurrency": "USD",
      "price": priceDollars,
      "priceValidUntil": new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      "availability": inStock ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
      "itemCondition": "https://schema.org/NewCondition",
      "seller": {
        "@type": "Organization",
        "name": sellerName
      }
    };
  }

  // Add brand if designer is specified
  if (listing.designer) {
    schema.brand = {
      "@type": "Brand",
      "name": listing.designer
    };
  }

  // Add additional properties
  schema.additionalProperty = [];
  if (listing.yards_available) {
    schema.additionalProperty.push({
      "@type": "PropertyValue",
      "name": "Yards Available",
      "value": listing.yards_available
    });
  }
  if (listing.width_inches) {
    schema.additionalProperty.push({
      "@type": "PropertyValue",
      "name": "Width",
      "value": `${listing.width_inches} inches`
    });
  }
  if (listing.fabric_type) {
    schema.additionalProperty.push({
      "@type": "PropertyValue",
      "name": "Fabric Type",
      "value": listing.fabric_type
    });
  }

  // Add breadcrumb
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "name": "Home",
        "item": "https://hemlinemarket.com/"
      },
      {
        "@type": "ListItem",
        "position": 2,
        "name": "Browse Fabrics",
        "item": "https://hemlinemarket.com/browse.html"
      },
      {
        "@type": "ListItem",
        "position": 3,
        "name": listing.title || "Listing",
        "item": `https://hemlinemarket.com/fabric/${listing.id}`
      }
    ]
  };

  return [schema, breadcrumb];
}

// api/autofill-fabric.js
// Fetches a fabric product page and uses Claude to extract structured fabric details
// Tries Shopify JSON endpoint first (for Mood, etc.), falls back to HTML parsing

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { url } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
    return res.status(400).json({ error: "Invalid URL format" });
  }

  try {
    let shopifyProduct = null;
    let html = "";

    // Try Shopify JSON endpoint first (works for Mood and many fabric stores)
    const isShopify = parsedUrl.hostname.includes('moodfabrics.com') || 
                      parsedUrl.pathname.includes('/products/');
    
    if (isShopify) {
      try {
        const jsonUrl = url.split('?')[0] + '.json';
        const jsonResp = await fetch(jsonUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "application/json"
          }
        });
        if (jsonResp.ok) {
          const data = await jsonResp.json();
          shopifyProduct = data.product;
        }
      } catch (e) {
        console.log("Shopify JSON not available, using HTML");
      }
    }

    // Fetch HTML page
    const pageResp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html"
      }
    });

    if (!pageResp.ok) {
      return res.status(400).json({ error: `Could not fetch page (${pageResp.status})` });
    }

    html = await pageResp.text();

    // Check for API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "AI extraction not configured" });
    }

    // Build context for Claude
    let context = "";

    // Include Shopify data if we got it
    if (shopifyProduct) {
      context += "=== SHOPIFY PRODUCT DATA (PRIMARY SOURCE) ===\n";
      context += JSON.stringify(shopifyProduct, null, 2).substring(0, 20000);
      context += "\n\n";
    }

    // Extract JSON-LD
    const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdMatches) {
      context += "=== JSON-LD DATA ===\n" + jsonLdMatches.join("\n").substring(0, 5000) + "\n\n";
    }

    // Extract specific patterns from HTML
    let extracted = "";
    
    const widthMatch = html.match(/width\s*:\s*(\d+)["']?\s*\(?\d*\.?\d*\s*cm\)?/i) ||
                       html.match(/(\d+)["']\s*\(\d+\.?\d*\s*cm\)/i);
    if (widthMatch) extracted += `Width: ${widthMatch[1]} inches\n`;

    const contentMatch = html.match(/content\s*:\s*([^<\n]{5,100})/i);
    if (contentMatch) extracted += `Content: ${contentMatch[1]}\n`;

    const weightMatch = html.match(/(?:industry\s*)?weight\s*:\s*(\d+)\s*GSM/i) ||
                        html.match(/(\d+)\s*GSM/i);
    if (weightMatch) extracted += `Weight: ${weightMatch[1]} GSM\n`;

    const patternMatch = html.match(/pattern\s*:\s*([^<\n]{3,50})/i);
    if (patternMatch) extracted += `Pattern: ${patternMatch[1]}\n`;

    const fiberMatch = html.match(/fiber\s*type\s*:\s*([^<\n]{3,30})/i);
    if (fiberMatch) extracted += `Fiber Type: ${fiberMatch[1]}\n`;

    const colorMatch = html.match(/color\s*family\s*:\s*([^<\n]{3,30})/i);
    if (colorMatch) extracted += `Color Family: ${colorMatch[1]}\n`;

    if (extracted) {
      context += "=== EXTRACTED FROM HTML ===\n" + extracted + "\n";
    }

    // Add truncated HTML
    context += "=== RAW HTML (truncated) ===\n" + html.substring(0, 25000);

    // Claude prompt
    const prompt = `Extract fabric product details from this webpage data. ACCURACY IS CRITICAL.

RULES:
1. Use SHOPIFY PRODUCT DATA as primary source if available
2. Look for explicit field values like "Width: 60", "Content: 60% Lurex, 40% Polyester", "Industry Weight: 62 GSM"
3. For content, parse percentages into an array of fiber names
4. DO NOT guess - use null if not confident
5. DO NOT include price
6. Write a FRESH 2-3 sentence description - do not copy

Return ONLY valid JSON:
{
  "title": "product title",
  "content": ["Lurex", "Polyester"],
  "fabricType": ["Brocade", "Metallic / Lame"],
  "width": 60,
  "gsm": 62,
  "origin": "Italy",
  "designer": "Mood Fabrics",
  "pattern": "Geometric",
  "department": "Apparel",
  "fiberType": "Synthetic",
  "colorFamily": "Brown",
  "suggestedDescription": "A luxurious metallic brocade with ornate chandelier pattern. Features a tactile hand with voluminous drape, ideal for evening gowns, jackets, and formal skirts."
}

VALID VALUES:
- content: Acetate, Acrylic, Alpaca, Bamboo, Camel, Cashmere, Cotton, Cupro, Hemp, Jute, Leather, Linen, Lurex, Lyocell, Merino, Modal, Mohair, Nylon, Polyester, Ramie, Rayon, Silk, Spandex / Elastane, Tencel, Triacetate, Viscose, Wool, Yak
- fabricType: Brocade, Canvas, Charmeuse, Chiffon, Corduroy, Crepe, Denim, Double Knit, Faux Fur, Faux Leather, Flannel, Fleece, Gabardine, Jersey, Knit, Lace, Lining, Mesh, Metallic / Lame, Minky, Organza, Ponte, Satin, Scuba, Shirting, Spandex / Lycra, Suiting, Tulle, Tweed, Twill, Velvet, Vinyl, Voile, Woven
- origin: Italy, France, Japan, UK, USA, Spain, Portugal, Germany, Belgium, Switzerland, Netherlands, Korea, Australia, Canada, Brazil
- pattern: Abstract, Animal, Camouflage, Check, Damask, Floral, Geometric, Houndstooth, Paisley, Plaid, Polka Dot, Solid, Stripes, Tie Dye, Toile, Other
- department: Apparel, Home Dec, Bridal, Costume
- fiberType: Natural, Synthetic, Blend
- colorFamily: Black, Grey, White, Cream, Brown, Pink, Red, Orange, Yellow, Green, Blue, Purple, Gold, Silver

PAGE DATA:
${context}`;

    const claudeResp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!claudeResp.ok) {
      console.error("Claude API error:", await claudeResp.text());
      return res.status(500).json({ error: "AI extraction failed" });
    }

    const claudeData = await claudeResp.json();
    const responseText = claudeData.content?.[0]?.text || "";

    // Parse JSON
    let fabricData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        fabricData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found");
      }
    } catch (e) {
      console.error("Parse error:", e, "Response:", responseText);
      return res.status(500).json({ error: "Could not parse fabric details" });
    }

    // Clean response
    const cleanData = {};
    for (const [key, value] of Object.entries(fabricData)) {
      if (value !== null && value !== undefined && value !== "") {
        if (key === "suggestedDescription") {
          cleanData.description = value;
        } else {
          cleanData[key] = value;
        }
      }
    }

    return res.status(200).json(cleanData);

  } catch (err) {
    console.error("Autofill error:", err);
    return res.status(500).json({ error: "Failed to extract fabric details" });
  }
}

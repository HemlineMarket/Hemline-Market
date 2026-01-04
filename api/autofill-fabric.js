// api/autofill-fabric.js
// Fetches a fabric product page and uses Claude to extract structured fabric details
// Returns: { title, content[], fabricType[], width, gsm, origin, designer, price, description, pattern, department }

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
  try {
    new URL(url);
  } catch (e) {
    return res.status(400).json({ error: "Invalid URL format" });
  }

  try {
    // Fetch the webpage
    const pageResp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!pageResp.ok) {
      return res.status(400).json({ error: `Could not fetch page (${pageResp.status})` });
    }

    const html = await pageResp.text();

    // Try to extract JSON-LD structured data first (most reliable)
    let structuredData = "";
    const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdMatches) {
      structuredData = "STRUCTURED DATA (JSON-LD) FOUND:\n" + jsonLdMatches.join("\n") + "\n\n";
    }

    // Extract meta tags
    let metaTags = "";
    const metaMatches = html.match(/<meta[^>]*(property|name)=["'][^"']*["'][^>]*>/gi);
    if (metaMatches) {
      metaTags = "META TAGS:\n" + metaMatches.slice(0, 30).join("\n") + "\n\n";
    }

    // Extract product-related sections more intelligently
    // Look for common product info patterns
    let productSection = "";
    
    // Try to find price
    const priceMatch = html.match(/["']price["']\s*:\s*["']?(\d+\.?\d*)["']?/i) ||
                       html.match(/\$(\d+\.?\d*)\s*(?:\/\s*yard|per\s*yard)/i);
    if (priceMatch) {
      productSection += `PRICE FOUND: $${priceMatch[1]}\n`;
    }

    // Try to find product specs/details section
    const specsMatch = html.match(/(?:product[- ]?details|specifications|product[- ]?info|fabric[- ]?details)[^<]*<[^>]*>([\s\S]{0,5000})/i);
    if (specsMatch) {
      productSection += "PRODUCT SPECS SECTION:\n" + specsMatch[0].substring(0, 3000) + "\n\n";
    }

    // Look for width pattern
    const widthMatch = html.match(/width[:\s]*(\d+(?:\.\d+)?)\s*(?:inches|in|")/i) ||
                       html.match(/(\d+)["']\s*wide/i);
    if (widthMatch) {
      productSection += `WIDTH FOUND: ${widthMatch[1]} inches\n`;
    }

    // Look for content/composition
    const contentMatch = html.match(/(?:content|composition|material)[:\s]*([^<]{10,200})/i);
    if (contentMatch) {
      productSection += `CONTENT FOUND: ${contentMatch[1]}\n`;
    }

    // Truncate main HTML but keep important parts
    const truncatedHtml = html.substring(0, 40000);

    // Check for Anthropic API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "AI extraction not configured" });
    }

    // Build context for Claude
    const context = structuredData + metaTags + productSection + "\n\nRAW HTML (truncated):\n" + truncatedHtml;

    // Use Claude to extract fabric details
    const prompt = `You are extracting fabric product information from a webpage. This is for a fabric resale marketplace - ACCURACY IS CRITICAL. Wrong data causes real problems.

I've provided structured data (if found), meta tags, and extracted patterns, plus the raw HTML.

EXTRACTION RULES:
1. ONLY extract information that is EXPLICITLY and CLEARLY stated
2. If you cannot find a value with HIGH CONFIDENCE, use null - don't guess!
3. For PRICE: Look for the main product price PER YARD. Mood Fabrics prices are typically $15-150/yard. If you see a price, verify it makes sense for fabric.
4. For WIDTH: Usually 44", 45", 54", 58", 60" for fashion fabrics. Look for "Width: XX" or "XX inches wide"
5. For CONTENT: Look for fiber percentages like "100% Polyester" or "60% Nylon, 40% Metallic"
6. For WEIGHT: Look for GSM, g/m², oz/yd², or descriptions like "light/medium/heavy weight"
7. DO NOT copy descriptions verbatim - write a fresh description

Return ONLY valid JSON (no markdown, no explanation):
{
  "title": "exact product title",
  "content": ["Polyester", "Nylon", "Lurex"] or null,
  "fabricType": ["Brocade", "Metallic / Lame"] or null,
  "width": 54 or null,
  "gsm": 200 or null,
  "origin": "Italy" or null,
  "designer": "brand name" or null,
  "price": 49.98 or null,
  "pattern": "Damask" or null,
  "department": "Apparel" or null,
  "fiberType": "Synthetic" or null,
  "suggestedDescription": "1-2 sentence original description of this fabric"
}

VALID content values: Acetate, Acrylic, Alpaca, Bamboo, Camel, Cashmere, Cotton, Cupro, Hemp, Jute, Leather, Linen, Lurex, Lyocell, Merino, Modal, Mohair, Nylon, Polyester, Ramie, Rayon, Silk, Spandex / Elastane, Tencel, Triacetate, Viscose, Wool, Yak

VALID fabricType values: Brocade, Canvas, Charmeuse, Chiffon, Corduroy, Crepe, Denim, Double Knit, Faux Fur, Faux Leather, Flannel, Fleece, Gabardine, Jersey, Knit, Lace, Lining, Mesh, Metallic / Lame, Minky, Organza, Ponte, Satin, Scuba, Shirting, Spandex / Lycra, Suiting, Tulle, Tweed, Twill, Velvet, Vinyl, Voile, Woven

VALID origin: Italy, France, Japan, UK, USA, Spain, Portugal, Germany, Belgium, Switzerland, Netherlands, Korea, Australia, Canada, Brazil

VALID pattern: Abstract, Animal, Camouflage, Check, Damask, Floral, Geometric, Houndstooth, Paisley, Plaid, Polka Dot, Solid, Stripes, Tie Dye, Toile, Other

VALID department: Apparel, Home Dec, Bridal, Costume

VALID fiberType: Natural, Synthetic, Blend

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
        messages: [
          { role: "user", content: prompt }
        ]
      })
    });

    if (!claudeResp.ok) {
      const errText = await claudeResp.text();
      console.error("Claude API error:", errText);
      return res.status(500).json({ error: "AI extraction failed" });
    }

    const claudeData = await claudeResp.json();
    const responseText = claudeData.content?.[0]?.text || "";

    // Parse the JSON from Claude's response
    let fabricData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        fabricData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr, "Response:", responseText);
      return res.status(500).json({ error: "Could not parse fabric details" });
    }

    // Clean up the response
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

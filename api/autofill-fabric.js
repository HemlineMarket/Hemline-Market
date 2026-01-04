// api/autofill-fabric.js
// Fetches a fabric product page and extracts structured fabric details
// Tries Shopify JSON endpoint first (for Mood, etc.), falls back to AI parsing

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

  const { url, debug } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
    return res.status(400).json({ error: "Invalid URL format" });
  }

  try {
    // Special handling for Mood Fabrics - try their JSON endpoint
    if (parsedUrl.hostname.includes('moodfabrics.com')) {
      try {
        const jsonUrl = url.split('?')[0] + '.json';
        console.log("Trying Mood JSON:", jsonUrl);
        
        const jsonResp = await fetch(jsonUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "application/json"
          }
        });
        
        console.log("Mood JSON response status:", jsonResp.status);
        
        if (jsonResp.ok) {
          const text = await jsonResp.text();
          console.log("Mood JSON response length:", text.length);
          
          // Debug mode - return raw response
          if (debug) {
            let productKeys = [];
            let parsedData = null;
            try {
              parsedData = JSON.parse(text);
              productKeys = Object.keys(parsedData.product || {});
            } catch(e) {}
            
            return res.status(200).json({ 
              debug: true, 
              jsonUrl,
              status: jsonResp.status,
              responseLength: text.length,
              productKeys,
              responsePreview: text.substring(0, 3000)
            });
          }
          
          if (text.length > 0) {
            const data = JSON.parse(text);
            const product = data.product;
            
            console.log("Got Mood product:", product?.title);
            console.log("Product tags type:", typeof product?.tags);
            console.log("Product tags:", product?.tags?.substring ? product.tags.substring(0, 200) : product?.tags?.slice(0, 10));
            console.log("Product body_html length:", product?.body_html?.length);
            
            if (product) {
              const result = parseMoodProduct(product);
              console.log("Parsed result:", JSON.stringify(result));
              return res.status(200).json(result);
            }
          }
        } else {
          console.log("Mood JSON failed with status:", jsonResp.status);
          if (debug) {
            return res.status(200).json({ 
              debug: true, 
              error: "JSON endpoint failed",
              status: jsonResp.status
            });
          }
        }
      } catch (e) {
        console.log("Mood JSON error:", e.message);
        if (debug) {
          return res.status(200).json({ debug: true, error: e.message });
        }
      }
    }

    // Fallback: Fetch HTML and use AI
    const pageResp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html"
      }
    });

    if (!pageResp.ok) {
      return res.status(400).json({ error: `Could not fetch page (${pageResp.status})` });
    }

    const html = await pageResp.text();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "AI extraction not configured" });
    }

    // Build context for Claude
    let context = "";

    // Extract JSON-LD
    const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdMatches) {
      context += "=== JSON-LD DATA ===\n" + jsonLdMatches.join("\n").substring(0, 10000) + "\n\n";
    }

    // Extract meta tags
    const metaMatches = html.match(/<meta[^>]*(property|name)=["'][^"']*["'][^>]*>/gi);
    if (metaMatches) {
      context += "=== META TAGS ===\n" + metaMatches.slice(0, 30).join("\n") + "\n\n";
    }

    context += "=== RAW HTML (truncated) ===\n" + html.substring(0, 30000);

    const prompt = `Extract fabric product details. ACCURACY IS CRITICAL. Return ONLY valid JSON.

{
  "title": "product title",
  "content": ["Lurex", "Polyester"],
  "fabricType": ["Brocade"],
  "width": 60,
  "gsm": 62,
  "price": 49.99,
  "pattern": "Geometric",
  "department": "Apparel",
  "fiberType": "Synthetic",
  "colorFamily": "Brown",
  "suggestedDescription": "2-3 sentence description"
}

VALID content: Acetate, Acrylic, Alpaca, Bamboo, Camel, Cashmere, Cotton, Cupro, Hemp, Jute, Leather, Linen, Lurex, Lyocell, Merino, Modal, Mohair, Nylon, Polyester, Ramie, Rayon, Silk, Spandex / Elastane, Tencel, Triacetate, Viscose, Wool, Yak
VALID fabricType: Brocade, Canvas, Charmeuse, Chiffon, Corduroy, Crepe, Denim, Double Knit, Faux Fur, Faux Leather, Flannel, Fleece, Gabardine, Jersey, Knit, Lace, Lining, Mesh, Metallic / Lame, Minky, Organza, Ponte, Satin, Scuba, Shirting, Spandex / Lycra, Suiting, Tulle, Tweed, Twill, Velvet, Vinyl, Voile, Woven
VALID pattern: Abstract, Animal, Camouflage, Check, Damask, Floral, Geometric, Houndstooth, Paisley, Plaid, Polka Dot, Solid, Stripes, Tie Dye, Toile, Other
VALID department: Apparel, Home Dec, Bridal, Costume
VALID fiberType: Natural, Synthetic, Blend
VALID colorFamily: Black, Grey, White, Cream, Brown, Pink, Red, Orange, Yellow, Green, Blue, Purple, Gold, Silver

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
      return res.status(500).json({ error: "AI extraction failed" });
    }

    const claudeData = await claudeResp.json();
    const responseText = claudeData.content?.[0]?.text || "";

    let fabricData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        fabricData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found");
      }
    } catch (e) {
      return res.status(500).json({ error: "Could not parse fabric details" });
    }

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

// Parse Mood Fabrics product JSON directly
function parseMoodProduct(product) {
  const result = {
    title: product.title || null
  };

  // Get the HTML body content - this has all the specs!
  const bodyHtml = product.body_html || "";
  
  // Decode unicode escapes like \u003c to <
  const decodedHtml = bodyHtml.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\n/g, '\n');
  
  console.log("Parsing body_html, length:", decodedHtml.length);

  // Extract Content (e.g., "60% Lurex, 40% Polyester")
  const contentMatch = decodedHtml.match(/Content:?\s*<\/strong>\s*([^<]+)/i) ||
                       decodedHtml.match(/Content:?\s*([^<\n]+)/i);
  if (contentMatch) {
    const contentStr = contentMatch[1].trim();
    console.log("Found content string:", contentStr);
    // Parse fibers from percentage string
    const validFibers = ['Acetate', 'Acrylic', 'Alpaca', 'Bamboo', 'Camel', 'Cashmere', 'Cotton', 'Cupro', 'Hemp', 'Jute', 'Leather', 'Linen', 'Lurex', 'Lyocell', 'Merino', 'Modal', 'Mohair', 'Nylon', 'Polyester', 'Ramie', 'Rayon', 'Silk', 'Spandex', 'Elastane', 'Tencel', 'Triacetate', 'Viscose', 'Wool', 'Yak'];
    const foundFibers = [];
    for (const fiber of validFibers) {
      if (contentStr.toLowerCase().includes(fiber.toLowerCase())) {
        if (fiber === 'Elastane') {
          foundFibers.push('Spandex / Elastane');
        } else if (fiber === 'Spandex' && !foundFibers.includes('Spandex / Elastane')) {
          foundFibers.push('Spandex / Elastane');
        } else if (fiber !== 'Spandex' && fiber !== 'Elastane') {
          foundFibers.push(fiber);
        }
      }
    }
    if (foundFibers.length > 0) {
      result.content = [...new Set(foundFibers)];
    }
  }

  // Extract Width (e.g., "60" (152.4cm)")
  const widthMatch = decodedHtml.match(/Width:?\s*<\/strong>\s*:?\s*(\d+)[""]?\s*\(?/i) ||
                     decodedHtml.match(/Width:?\s*:?\s*(\d+)[""]?\s*\(?/i);
  if (widthMatch) {
    result.width = parseInt(widthMatch[1]);
    console.log("Found width:", result.width);
  }

  // Extract Weight/GSM (e.g., "62 GSM")
  const gsmMatch = decodedHtml.match(/(?:Industry\s*)?Weight:?\s*<\/strong>\s*:?\s*(\d+)\s*GSM/i) ||
                   decodedHtml.match(/(\d+)\s*GSM/i);
  if (gsmMatch) {
    result.gsm = parseInt(gsmMatch[1]);
    console.log("Found GSM:", result.gsm);
  }

  // Extract Fiber Type
  const fiberTypeMatch = decodedHtml.match(/Fiber\s*Type:?\s*<\/strong>\s*:?\s*([^<\n]+)/i) ||
                         decodedHtml.match(/Fiber\s*Type:?\s*:?\s*(\w+)/i);
  if (fiberTypeMatch) {
    const ft = fiberTypeMatch[1].trim();
    if (ft.toLowerCase().includes('synthetic')) result.fiberType = 'Synthetic';
    else if (ft.toLowerCase().includes('natural')) result.fiberType = 'Natural';
    else if (ft.toLowerCase().includes('blend')) result.fiberType = 'Blend';
    console.log("Found fiber type:", result.fiberType);
  }

  // Extract Pattern
  const patternMatch = decodedHtml.match(/Pattern:?\s*<\/strong>\s*:?\s*([^<\n]+)/i) ||
                       decodedHtml.match(/Pattern:?\s*:?\s*([^<\n]+)/i);
  if (patternMatch) {
    const patternStr = patternMatch[1].trim();
    const validPatterns = ['Abstract', 'Animal', 'Camouflage', 'Check', 'Damask', 'Floral', 'Geometric', 'Houndstooth', 'Paisley', 'Plaid', 'Polka Dot', 'Solid', 'Stripes', 'Tie Dye', 'Toile'];
    for (const p of validPatterns) {
      if (patternStr.toLowerCase().includes(p.toLowerCase())) {
        result.pattern = p;
        break;
      }
    }
    if (!result.pattern && patternStr.toLowerCase().includes('miscellaneous')) {
      result.pattern = 'Other';
    }
    console.log("Found pattern:", result.pattern);
  }

  // Extract Color Family
  const colorMatch = decodedHtml.match(/Color\s*Family:?\s*<\/strong>\s*:?\s*([^<\n]+)/i) ||
                     decodedHtml.match(/Color\s*Family:?\s*:?\s*(\w+)/i);
  if (colorMatch) {
    const colorStr = colorMatch[1].trim();
    const validColors = ['Black', 'Grey', 'Gray', 'White', 'Cream', 'Brown', 'Pink', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Gold', 'Silver'];
    for (const c of validColors) {
      if (colorStr.toLowerCase().includes(c.toLowerCase())) {
        result.colorFamily = c === 'Gray' ? 'Grey' : c;
        break;
      }
    }
    console.log("Found color:", result.colorFamily);
  }

  // Get price from variants
  if (product.variants && product.variants.length > 0) {
    const price = parseFloat(product.variants[0].price);
    if (price > 0) {
      result.price = price;
      console.log("Found price:", result.price);
    }
  }

  // Detect fabric type from title and body
  const fabricTypes = ['Brocade', 'Canvas', 'Charmeuse', 'Chiffon', 'Corduroy', 'Crepe', 'Denim', 'Flannel', 'Fleece', 'Gabardine', 'Jersey', 'Knit', 'Lace', 'Lining', 'Mesh', 'Organza', 'Ponte', 'Satin', 'Scuba', 'Suiting', 'Tulle', 'Tweed', 'Twill', 'Velvet', 'Vinyl', 'Voile', 'Woven'];
  const foundTypes = [];
  const searchText = (product.title + ' ' + decodedHtml).toLowerCase();
  
  for (const ft of fabricTypes) {
    if (searchText.includes(ft.toLowerCase())) {
      foundTypes.push(ft);
    }
  }
  // Check for Metallic / Lame
  if (searchText.includes('lame') || searchText.includes('metallic')) {
    foundTypes.push('Metallic / Lame');
  }
  if (foundTypes.length > 0) {
    result.fabricType = [...new Set(foundTypes)];
    console.log("Found fabric types:", result.fabricType);
  }

  // Department from product_type or body
  if (product.product_type) {
    const pt = product.product_type.toLowerCase();
    if (pt.includes('fashion') || pt.includes('apparel')) result.department = 'Apparel';
    else if (pt.includes('home')) result.department = 'Home Dec';
    else if (pt.includes('bridal')) result.department = 'Bridal';
    else if (pt.includes('costume')) result.department = 'Costume';
  }
  if (!result.department && searchText.includes('fashion fabric')) {
    result.department = 'Apparel';
  }

  // Generate description - get first paragraph from body
  const descMatch = decodedHtml.match(/<p>([^<]+)/i) || 
                    decodedHtml.match(/^([^<]{50,300})/);
  if (descMatch) {
    let desc = descMatch[1].replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim();
    // Take first 2 sentences
    const sentences = desc.split(/\.\s+/).slice(0, 2);
    result.description = sentences.join('. ').trim();
    if (result.description && !result.description.endsWith('.')) {
      result.description += '.';
    }
  }

  // Clean up null/empty values
  const cleanResult = {};
  for (const [key, value] of Object.entries(result)) {
    if (value !== null && value !== undefined && value !== "" && 
        !(Array.isArray(value) && value.length === 0)) {
      cleanResult[key] = value;
    }
  }

  console.log("Final parsed result:", JSON.stringify(cleanResult));
  return cleanResult;
}

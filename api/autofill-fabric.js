// api/autofill-fabric.js
// Fetches a fabric product page and uses Claude to extract structured fabric details
// Returns: { title, content[], fabricType[], width, gsm, origin, designer, price, description }

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

    // Truncate HTML to avoid token limits (keep first ~60k chars which should include product details)
    const truncatedHtml = html.substring(0, 60000);

    // Check for Anthropic API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "AI extraction not configured" });
    }

    // Use Claude to extract fabric details
    const prompt = `You are extracting fabric product information from a webpage HTML. This is for a fabric marketplace - accuracy is critical.

IMPORTANT RULES:
1. Only extract information that is EXPLICITLY stated on the page
2. If you cannot find a value with high confidence, use null
3. For price: Look for the MAIN product price per yard (not shipping, not sale prices unless clearly marked). If price is per meter, multiply by 0.9144 to convert to per yard.
4. For width: Usually shown as "Width: XX inches" or "XX in wide" or in centimeters (divide by 2.54)
5. For content/fiber: Look for "Content:", "Composition:", "Material:", or fiber percentages like "100% Polyester"
6. For weight: Look for GSM, g/m², oz/yd², or weight descriptions
7. DO NOT make up or guess values - only extract what you can clearly see

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "title": "exact product title from page",
  "content": ["Polyester", "Nylon"] or null if not found,
  "fabricType": ["Brocade", "Metallic / Lame"] or null if not found,
  "width": 54 (number in inches) or null,
  "gsm": 200 (number) or null,
  "origin": "Italy" or null,
  "designer": "brand/mill name" or null,
  "price": 49.98 (number per yard) or null,
  "suggestedDescription": "A brief 1-2 sentence description of the fabric's characteristics and suggested uses - write this FRESH, do not copy from the page"
}

VALID content values (match to these exactly): Acetate, Acrylic, Alpaca, Bamboo, Camel, Cashmere, Cotton, Cupro, Hemp, Jute, Leather, Linen, Lurex, Lyocell, Merino, Modal, Mohair, Nylon, Polyester, Ramie, Rayon, Silk, Spandex / Elastane, Tencel, Triacetate, Viscose, Wool, Yak

VALID fabricType values (match to these exactly): Brocade, Canvas, Charmeuse, Chiffon, Corduroy, Crepe, Denim, Double Knit, Faux Fur, Faux Leather, Flannel, Fleece, Gabardine, Jersey, Knit, Lace, Lining, Mesh, Metallic / Lame, Minky, Organza, Ponte, Satin, Scuba, Shirting, Spandex / Lycra, Suiting, Tulle, Tweed, Twill, Velvet, Vinyl, Voile, Woven

VALID origin values: Italy, France, Japan, UK, USA, Spain, Portugal, Germany, Belgium, Switzerland, Netherlands, Korea, Australia, Canada, Brazil

HTML to analyze:
${truncatedHtml}`;

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
      // Try to extract JSON from the response (in case there's any wrapper text)
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

    // Clean up the response - remove null values and rename suggestedDescription to description
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

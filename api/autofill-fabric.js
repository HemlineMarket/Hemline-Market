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
        "User-Agent": "Mozilla/5.0 (compatible; HemlineMarket/1.0; +https://hemlinemarket.com)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!pageResp.ok) {
      return res.status(400).json({ error: `Could not fetch page (${pageResp.status})` });
    }

    const html = await pageResp.text();

    // Truncate HTML to avoid token limits (keep first ~50k chars which should include product details)
    const truncatedHtml = html.substring(0, 50000);

    // Check for Anthropic API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "AI extraction not configured" });
    }

    // Use Claude to extract fabric details
    const prompt = `You are extracting fabric/textile product information from a webpage. Analyze the HTML and return a JSON object with the fabric details you can find.

Return ONLY a valid JSON object with these fields (use null for any field you can't find):
{
  "title": "product name/title",
  "content": ["Silk", "Wool", "Cotton", etc - fiber content as array],
  "fabricType": ["Charmeuse", "Twill", "Jersey", etc - fabric type as array],
  "width": number in inches (convert from cm if needed),
  "gsm": number (weight in grams per square meter, convert if needed),
  "origin": "country of origin like Italy, France, Japan, etc",
  "designer": "designer or mill name",
  "price": number (price per yard, convert from meter if needed),
  "description": "brief description of the fabric"
}

Valid content values: Acetate, Acrylic, Alpaca, Bamboo, Camel, Cashmere, Cotton, Cupro, Hemp, Jute, Leather, Linen, Lurex, Lyocell, Merino, Modal, Mohair, Nylon, Polyester, Ramie, Rayon, Silk, Spandex / Elastane, Tencel, Triacetate, Viscose, Wool, Yak

Valid fabricType values: Brocade, Canvas, Charmeuse, Chiffon, Corduroy, Crepe, Denim, Double Knit, Faux Fur, Faux Leather, Flannel, Fleece, Gabardine, Jersey, Knit, Lace, Lining, Mesh, Metallic / Lame, Minky, Organza, Ponte, Satin, Scuba, Shirting, Spandex / Lycra, Suiting, Tulle, Tweed, Twill, Velvet, Vinyl, Voile, Woven

Valid origin values: Italy, France, Japan, UK, USA, Spain, Portugal, Germany, Belgium, Switzerland, Netherlands, Korea, Australia, Canada, Brazil

Important:
- Match content and fabricType to the valid values above (use closest match)
- Convert cm to inches (divide by 2.54) and meters to yards (multiply by 1.094) if needed
- For price, convert per-meter to per-yard if needed (multiply by 0.9144)
- Return ONLY the JSON object, no markdown, no explanation

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

    // Clean up the response - remove null values
    const cleanData = {};
    for (const [key, value] of Object.entries(fabricData)) {
      if (value !== null && value !== undefined && value !== "") {
        cleanData[key] = value;
      }
    }

    return res.status(200).json(cleanData);

  } catch (err) {
    console.error("Autofill error:", err);
    return res.status(500).json({ error: "Failed to extract fabric details" });
  }
}

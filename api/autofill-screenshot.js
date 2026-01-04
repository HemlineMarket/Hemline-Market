// api/autofill-screenshot.js
// Extracts fabric details from a screenshot using Claude's vision

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

  const { image, images } = req.body || {};

  // Support both single image and array of images
  const imageArray = images || (image ? [image] : []);
  
  if (imageArray.length === 0) {
    return res.status(400).json({ error: "At least one image is required" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "AI extraction not configured" });
  }

  try {
    // Build content array with all images
    const content = [];
    
    for (const img of imageArray) {
      const matches = img.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        continue; // Skip invalid images
      }
      
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: matches[1],
          data: matches[2]
        }
      });
    }
    
    if (content.length === 0) {
      return res.status(400).json({ error: "No valid images provided" });
    }

    const prompt = `You are looking at ${content.length} screenshot${content.length > 1 ? 's' : ''} of a fabric product page (likely from Mood Fabrics, Fabric.com, or similar).

Extract ALL fabric details you can see across all images and return them as JSON. Be accurate - only include fields you can clearly see.

Return ONLY valid JSON in this format (include only fields you find):
{
  "title": "product name if visible",
  "content": ["Lurex", "Polyester"],
  "fabricType": ["Brocade", "Charmeuse"],
  "width": 60,
  "gsm": 62,
  "origPrice": 49.99,
  "pattern": "Solid or Printed",
  "department": "Fashion",
  "fiberType": "Synthetic",
  "colorFamily": ["Brown", "Gold"],
  "description": "FULL description - see instructions below",
  "stretch": "None or 2-way or 4-way",
  "opacity": "Opaque or Semi-opaque or Translucent or Sheer",
  "suggestedProjects": "Gowns, Jackets, Skirts",
  "designer": "Designer or mill name if shown",
  "origin": "Italy"
}

DESCRIPTION FIELD - IMPORTANT:
- Extract the COMPLETE description text from the page
- Include ALL paragraphs - the full product description
- Include details about hand feel, drape, suggested uses, etc.
- This should be multiple sentences capturing everything written about the fabric

IMPORTANT FIELD MAPPINGS:
- content: The fiber composition (e.g., "60% Lurex, 40% Polyester" → ["Lurex", "Polyester"])
  Valid: Acetate, Acrylic, Alpaca, Bamboo, Camel, Cashmere, Cotton, Cupro, Hemp, Jute, Leather, Linen, Lurex, Lyocell, Merino, Modal, Mohair, Nylon, Polyester, Ramie, Rayon, Silk, Spandex / Elastane, Tencel, Triacetate, Viscose, Wool, Yak

- fabricType: The type of weave/fabric
  Valid: Brocade, Canvas, Charmeuse, Chiffon, Corduroy, Crepe, Denim, Double Knit, Faux Fur, Faux Leather, Flannel, Fleece, Gabardine, Jersey, Knit, Lace, Mesh, Metallic / Lame, Minky, Organza, Ponte, Satin, Scuba, Shirting, Spandex / Lycra, Suiting, Tulle, Tweed, Twill, Velvet, Vinyl, Voile, Woven

- pattern: Use "Solid" only if explicitly solid. Everything else (geometric, floral, stripes, etc.) → "Printed"

- department: Valid values are Fashion, Home, Quilting, Notions

- fiberType: Natural, Modified Natural (rayon/viscose/modal/tencel), Synthetic, or Blend

- colorFamily: Valid values are Black, Grey, White, Cream, Brown, Pink, Red, Orange, Yellow, Green, Blue, Purple, Gold, Silver

- origin: Valid values are Italy, France, Japan, UK, USA, Spain, Portugal, Germany, Belgium, Switzerland, Netherlands, Korea, Australia, Canada, Brazil, Other

- width: Just the number in inches (e.g., 60 not "60 inches")

- gsm: Just the number (e.g., 62 not "62 GSM")

- origPrice: The retail price per yard as a number (e.g., 49.99 not "$49.99/yard")

Return ONLY the JSON object, no other text.`;

    // Add the prompt to the content array
    content.push({
      type: "text",
      text: prompt
    });

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
        messages: [{
          role: "user",
          content: content
        }]
      })
    });

    if (!claudeResp.ok) {
      const errorData = await claudeResp.text();
      console.error("Claude API error:", errorData);
      return res.status(500).json({ error: "AI extraction failed" });
    }

    const claudeData = await claudeResp.json();
    const responseText = claudeData.content?.[0]?.text || "";

    let fabricData;
    try {
      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        fabricData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (e) {
      console.error("Parse error:", e, "Response:", responseText);
      return res.status(500).json({ error: "Could not parse fabric details" });
    }

    // Clean up and validate the response
    const cleanResult = {};
    
    if (fabricData.title) cleanResult.title = fabricData.title;
    if (fabricData.description) cleanResult.description = fabricData.description;
    if (fabricData.designer) cleanResult.designer = fabricData.designer;
    
    if (fabricData.content && Array.isArray(fabricData.content)) {
      cleanResult.content = fabricData.content;
    }
    
    if (fabricData.fabricType && Array.isArray(fabricData.fabricType)) {
      cleanResult.fabricType = fabricData.fabricType;
    }
    
    if (fabricData.width && typeof fabricData.width === 'number') {
      cleanResult.width = fabricData.width;
    }
    
    if (fabricData.gsm && typeof fabricData.gsm === 'number') {
      cleanResult.gsm = fabricData.gsm;
    }
    
    if (fabricData.origPrice && typeof fabricData.origPrice === 'number') {
      cleanResult.origPrice = fabricData.origPrice;
    }
    
    if (fabricData.pattern) cleanResult.pattern = fabricData.pattern;
    if (fabricData.department) cleanResult.department = fabricData.department;
    if (fabricData.fiberType) cleanResult.fiberType = fabricData.fiberType;
    if (fabricData.origin) cleanResult.origin = fabricData.origin;
    
    if (fabricData.colorFamily) {
      cleanResult.colorFamily = Array.isArray(fabricData.colorFamily) 
        ? fabricData.colorFamily 
        : [fabricData.colorFamily];
    }

    return res.status(200).json(cleanResult);

  } catch (error) {
    console.error("Screenshot autofill error:", error);
    return res.status(500).json({ error: "Failed to process screenshot" });
  }
}

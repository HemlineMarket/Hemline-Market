// api/autofill-screenshot.js
// Extracts fabric details from a screenshot using Claude's vision
// UPDATED: Strip retailer names from title, add extra details to description

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// Retailer names to strip from titles
const RETAILER_NAMES = [
  "Mood Exclusive",
  "Mood Fabrics",
  "Mood",
  "Fabric.com",
  "Fabric Mart",
  "FabricMart",
  "JoAnn",
  "JOANN",
  "Jo-Ann",
  "Hancock Fabrics",
  "FeelGood Fibers",
  "Michael Levine",
  "B&J Fabrics",
  "Britex Fabrics",
  "Dharma Trading",
  "Emma One Sock",
  "Fashion Fabrics Club",
  "Gorgeous Fabrics",
  "LA Finch Fabrics",
  "Marcy Tilton",
  "Nick of Time Textiles",
  "Stone Mountain & Daughter",
  "Style Maker Fabrics",
  "The Fabric Store",
  "Vogue Fabrics"
];

function stripRetailerNames(title) {
  if (!title) return title;
  let cleaned = title;
  for (const retailer of RETAILER_NAMES) {
    // Remove retailer name with common separators
    const patterns = [
      new RegExp(`^${retailer}\\s*[-–—:]\\s*`, 'i'),
      new RegExp(`\\s*[-–—:]\\s*${retailer}$`, 'i'),
      new RegExp(`\\s*[-–—]\\s*${retailer}\\s*[-–—]\\s*`, 'gi'),
      new RegExp(`^${retailer}\\s+`, 'i'),
      new RegExp(`\\s+${retailer}$`, 'i'),
      new RegExp(`\\(${retailer}\\)`, 'gi'),
      new RegExp(`${retailer}'s\\s*`, 'gi'),
    ];
    for (const pattern of patterns) {
      cleaned = cleaned.replace(pattern, ' ');
    }
  }
  // Clean up extra spaces and dashes
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(/^[-–—]\s*/, '').replace(/\s*[-–—]$/, '');
  return cleaned;
}

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
      // More flexible regex to handle various base64 formats
      let matches = img.match(/^data:([^;,]+)[^,]*,(.+)$/);
      
      if (!matches) {
        // Try without data: prefix (raw base64)
        if (img.length > 100 && /^[A-Za-z0-9+/=]+$/.test(img.substring(0, 100))) {
          matches = [null, 'image/jpeg', img];
        } else {
          console.log("Skipping invalid image format, length:", img?.length, "start:", img?.substring(0, 50));
          continue;
        }
      }
      
      const mediaType = matches[1] || 'image/jpeg';
      const base64Data = matches[2];
      
      // Validate it looks like base64
      if (!base64Data || base64Data.length < 100) {
        console.log("Skipping image with insufficient data");
        continue;
      }
      
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: base64Data
        }
      });
    }
    
    if (content.length === 0) {
      return res.status(400).json({ error: "Could not process images. Please try again or use a different image format." });
    }

    const prompt = `You are looking at ${content.length} screenshot${content.length > 1 ? 's' : ''} of a fabric product page (likely from Mood Fabrics, Fabric.com, or similar).

Extract ALL fabric details you can see across all images and return them as JSON. Be accurate - only include fields you can clearly see.

IMPORTANT: Do NOT include retailer or store names in the title (like "Mood Exclusive", "Mood", "Fabric Mart", etc.). Extract only the fabric description itself.

Return ONLY valid JSON in this format (include only fields you find):
{
  "title": "product name WITHOUT store/retailer names",
  "content": ["Lurex", "Polyester"],
  "fabricType": ["Brocade", "Charmeuse"],
  "width": 60,
  "gsm": 62,
  "origPrice": 49.99,
  "pattern": "Solid or Printed",
  "department": "Fashion",
  "fiberType": "Synthetic",
  "colorFamily": ["Brown", "Gold"],
  "description": "YOUR ORIGINAL rewritten description - see instructions below",
  "stretch": "None or 2-way or 4-way",
  "opacity": "Opaque or Semi-opaque or Translucent or Sheer",
  "suggestedProjects": "Gowns, Jackets, Skirts",
  "designer": "Designer or mill name if shown",
  "origin": "Italy"
}

DESCRIPTION FIELD - CRITICAL:
- Do NOT copy text from the screenshots verbatim
- REWRITE the description in your own words while preserving all the key information
- INCLUDE these details if visible: hand feel, drape, weight, stretch, opacity, pattern repeat, skill level, thickness, and best project uses
- Make it sound natural and original, like a seller describing their own fabric
- Keep it 3-5 sentences
- Example input: "This luxurious brocade features ornate chandeliers with a tactile hand and voluminous drape"
- Example output: "A stunning brocade with an intricate chandelier motif. The fabric has excellent body with a soft, textured hand and flows beautifully. No stretch, semi-sheer - consider lining for structured garments. Perfect for evening jackets, formal skirts, and statement pieces."

TITLE FIELD - CRITICAL:
- Remove any retailer/store names like "Mood Exclusive", "Mood", "Fabric Mart", "JoAnn", etc.
- Keep only the actual fabric description
- Example input: "Mood Exclusive - Italian Silk Charmeuse in Navy Blue"
- Example output: "Italian Silk Charmeuse in Navy Blue"

IMPORTANT FIELD MAPPINGS:
- content: The fiber composition (e.g., "60% Lurex, 40% Polyester" → ["Lurex", "Polyester"])
  Valid: Acetate, Acrylic, Alpaca, Bamboo, Camel, Cashmere, Cotton, Cupro, Hemp, Jute, Leather, Linen, Lurex, Lyocell, Merino, Modal, Mohair, Nylon, Polyester, Ramie, Rayon, Silk, Spandex / Elastane, Tencel, Triacetate, Viscose, Wool, Yak

- fabricType: The type of weave/fabric
  Valid: Broadcloth, Brocade, Canvas, Challis, Chambray, Charmeuse, Chiffon, Corduroy, Crepe, Crepe de Chine, Denim, Double Cloth, Double Knit, Duchesse, Dupioni, Faux Fur, Faux Leather, Flannel, Fleece, Gabardine, Gauze, Gazar, Georgette, Habotai, Jersey, Knit, Lace, Lamé, Mesh, Metallic, Mikado, Minky, Muslin, Organza, Ottoman, Oxford, Peau de Soie, Poplin, Ponte, Satin, Scuba, Shirting, Spandex / Lycra, Suiting, Taffeta, Terry / French Terry, Tropical, Tulle, Tweed, Twill, Velvet, Vinyl, Voile, Woven

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
    
    // UPDATED: Strip retailer names from title
    if (fabricData.title) {
      cleanResult.title = stripRetailerNames(fabricData.title);
    }
    if (fabricData.description) cleanResult.description = fabricData.description;
    
    // Designer logic: if designer is known, use it. If unknown but origin is known, use "Unknown [Country] Mill"
    // If both unknown, leave blank (don't fake it)
    if (fabricData.designer) {
      cleanResult.designer = fabricData.designer;
    } else if (fabricData.origin && fabricData.origin !== 'Other') {
      // Map country codes to adjectives for natural phrasing
      const countryAdjectives = {
        'Italy': 'Italian',
        'France': 'French', 
        'Japan': 'Japanese',
        'UK': 'British',
        'USA': 'American',
        'Spain': 'Spanish',
        'Portugal': 'Portuguese',
        'Germany': 'German',
        'Belgium': 'Belgian',
        'Switzerland': 'Swiss',
        'Netherlands': 'Dutch',
        'Korea': 'Korean',
        'Australia': 'Australian',
        'Canada': 'Canadian',
        'Brazil': 'Brazilian'
      };
      const adjective = countryAdjectives[fabricData.origin] || fabricData.origin;
      cleanResult.designer = `Unknown ${adjective} Mill`;
    }
    // If neither designer nor origin is known, leave designer blank
    
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

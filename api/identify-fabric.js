// api/identify-fabric.js
// AI-powered fabric identification from photos

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

  const { image } = req.body || {};

  if (!image) {
    return res.status(400).json({ error: "Image is required" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "AI service not configured" });
  }

  try {
    // Parse base64 image
    const matches = image.match(/^data:([^;,]+)[^,]*,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: "Invalid image format" });
    }
    
    const mediaType = matches[1] || 'image/jpeg';
    const base64Data = matches[2];

    const prompt = `You are an expert textile specialist analyzing a photo of fabric. Examine this image carefully and identify the fabric characteristics.

Return ONLY valid JSON in this exact format:
{
  "fabricType": "The type of fabric (e.g., Jersey, Chiffon, Denim, Brocade, Tweed, Velvet, Satin, Canvas, Linen, etc.)",
  "weight": "Lightweight, Medium weight, or Heavyweight",
  "pattern": "Solid, Printed, Plaid, Striped, Floral, Geometric, Textured, etc.",
  "color": "Primary color(s) visible",
  "texture": "Smooth, Textured, Nubby, Fuzzy, Crisp, Soft, etc.",
  "sheen": "Matte, Subtle sheen, Moderate sheen, or High shine",
  "stretch": "No stretch, 2-way stretch, or 4-way stretch (based on visible structure)",
  "opacity": "Opaque, Semi-opaque, Semi-sheer, or Sheer",
  "likelyContent": "Best guess at fiber content based on appearance (e.g., 'Likely cotton or cotton blend', 'Appears to be silk or silk-like synthetic')",
  "confidence": "Your confidence level as a percentage (e.g., '85%')",
  "description": "A 2-3 sentence description of the fabric's characteristics and hand feel based on what you can see",
  "suggestedUses": "What this fabric would be good for (e.g., 'Dresses, blouses, and flowy garments' or 'Structured jackets and pants')"
}

IMPORTANT GUIDELINES:
- Base your analysis ONLY on what you can see in the image
- For fiber content, be honest that it's a guess based on appearance - you cannot definitively identify fibers from a photo
- Look at the weave structure, drape, sheen, and texture
- If the image is unclear, say so in the description and lower confidence
- Be specific but not overconfident

Return ONLY the JSON object, no other text.`;

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
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Data
              }
            },
            {
              type: "text",
              text: prompt
            }
          ]
        }]
      })
    });

    if (!claudeResp.ok) {
      const errorData = await claudeResp.text();
      console.error("Claude API error:", errorData);
      return res.status(500).json({ error: "AI analysis failed" });
    }

    const claudeData = await claudeResp.json();
    const responseText = claudeData.content?.[0]?.text || "";

    let fabricData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        fabricData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (e) {
      console.error("Parse error:", e, "Response:", responseText);
      return res.status(500).json({ error: "Could not parse fabric analysis" });
    }

    return res.status(200).json(fabricData);

  } catch (error) {
    console.error("Identify fabric error:", error);
    return res.status(500).json({ error: "Failed to analyze fabric" });
  }
}

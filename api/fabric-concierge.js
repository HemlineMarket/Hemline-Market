// api/fabric-concierge.js
// Fabric Concierge - Upload a photo, get fabric identification and alternatives

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "AI service not configured" });

  const { image } = req.body || {};
  if (!image) return res.status(400).json({ error: "Image is required" });

  try {
    const matches = image.match(/^data:([^;,]+)[^,]*,(.+)$/);
    if (!matches) return res.status(400).json({ error: "Invalid image format" });

    const mediaType = matches[1] || "image/jpeg";
    const base64Data = matches[2];

    const prompt = `You are Hemline Market's Fabric Concierge -- an expert textile analyst who helps sewists identify fabrics in photos of garments and outfits.

A sewist uploaded a photo. Analyze the FABRIC, not the print or pattern.

Return ONLY valid JSON in this format:
{
  "overview": "2-3 sentences describing the garment(s): silhouette, construction details (fit, closures, gathers, structure). Keep it conversational.",
  "bestGuess": "The single most likely fabric, with reasoning based on surface texture, drape, weight, sheen, and how the fabric behaves. Be specific -- say 'Egyptian mercerized cotton poplin' or 'silk charmeuse' not just 'cotton' or 'silk'. If it looks high-end, name the premium version.",
  "options": [
    {
      "fabric": "Specific fabric name (genuinely different from the others -- different fiber, different weave, different properties)",
      "pros": "Why this fabric could be what's in the photo OR why it would work. 1 sentence.",
      "cons": "What would be different or challenging with this fabric. 1 sentence.",
      "price": "Budget, Mid-range, or Investment",
      "difficulty": "Beginner-friendly, Intermediate, or Advanced"
    }
  ],
  "tip": "One practical sewing note if relevant (e.g., 'Pre-wash linen before cutting' or 'This silhouette needs a lining for the skirt'). Set to null if nothing important to add.",
  "disclaimer": "These are our best guesses based on the photo. Fiber content can't be confirmed from an image alone."
}

CRITICAL RULES:
- Analyze the FABRIC properties: weave, drape, weight, sheen, texture, how it holds shape
- When the garment looks high-end, luxurious, or designer, your best guess should be the premium fabric, not the budget alternative. A flowing silk skirt should be identified as silk, not rayon challis. Rayon is the dupe, not the default.
- Be careful identifying the garment type. A bias-cut midi with fluid drape is likely a skirt, not pants. Look at the silhouette carefully before labeling.
- Do NOT fixate on the print or pattern. A shamrock dress is about the cotton poplin, not about sourcing shamrock fabric
- Do NOT give yardage estimates
- Do NOT break garments into separate pieces if they are clearly the same fabric. One unified response.
- Give 3-4 options that are GENUINELY DIFFERENT from each other. Different fiber content, different weave, different behavior. "Cotton poplin, cotton sateen, cotton broadcloth, cotton lawn" is BAD. "Egyptian mercerized cotton poplin, cotton sateen, rayon challis, silk-cotton blend" is GOOD.
- ALWAYS include a premium/luxury option when the garment looks high-end
- ALWAYS include at least one budget-friendly option
- Order options strictly from most expensive to least expensive: Investment first, then Mid-range, then Budget. Never mix the order. Every option must have one of these three price tiers and they must descend in order.
- Only mention embroidered vs printed if you are VERY confident (e.g., you can clearly see raised, dimensional stitching). If you are not sure, do NOT mention it at all. It is better to say nothing than to guess wrong.
- When you suspect a synthetic blend but cannot visually distinguish the specific synthetic fiber, use broader language like "cotton-synthetic blend (likely polyester or nylon)" rather than committing to one. Polyester and nylon look nearly identical in photos.
- Viscose/rayon is NOT a synthetic -- it is a semi-synthetic with distinct drape and hand. If a fabric has fluid drape with body, consider viscose blends (viscose-cotton, viscose-wool) not just polyester blends. Viscose drapes differently than polyester.
- If you can see the brand or identify the specific garment, note it briefly in the overview
- Keep the tone knowledgeable but conversational, like a friend who works at a high-end fabric store

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
        max_tokens: 2048,
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
            { type: "text", text: prompt }
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

    let result;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (e) {
      console.error("Parse error:", e, "Response:", responseText);
      return res.status(500).json({ error: "Could not parse AI response" });
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error("Fabric concierge error:", error);
    return res.status(500).json({ error: "Failed to process request" });
  }
}

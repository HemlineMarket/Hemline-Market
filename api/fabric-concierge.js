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

  const { image, hint } = req.body || {};
  if (!image) return res.status(400).json({ error: "Image is required" });

  try {
    const matches = image.match(/^data:([^;,]+)[^,]*,(.+)$/);
    if (!matches) return res.status(400).json({ error: "Invalid image format" });

    const mediaType = matches[1] || "image/jpeg";
    const base64Data = matches[2];

    const prompt = `You are Hemline Market's Fabric Concierge, an expert textile analyst who helps sewists identify fabrics from garment photos.

A sewist uploaded a photo. Analyze the FABRIC, not the print or pattern.

Return ONLY valid JSON:
{
  "overview": "2-3 sentences describing the garment: silhouette, construction details (fit, closures, gathers, structure). Conversational tone.",
  "bestGuess": "The most likely fabric with reasoning based on the decision tree below. Be specific (e.g., 'silk charmeuse' not 'silk'). When two fibers look identical in photos (silk/viscose, cashmere/merino, linen/hemp, wool/acrylic), name both possibilities.",
  "options": [
    {
      "fabric": "Specific fabric name (genuinely different fiber/weave from the others)",
      "pros": "Why this fabric matches or would work. 1 sentence.",
      "cons": "Drawback or difference. 1 sentence.",
      "price": "Investment, Mid-range, or Budget (must descend in this order)"
    }
  ],
  "tip": "One practical sewing note, or null.",
  "disclaimer": "These are our best guesses based on the photo. Fiber content can't be confirmed from an image alone."
}

DECISION TREE - Follow these steps IN ORDER:

STEP 1: IS IT A KNIT OR A WOVEN?
Knits show visible stitch loops, stretch, and conform to the body. Wovens have a flat woven surface, may show weave texture, and behave differently at gathering/draping points. If knit, go to STEP 2K. If woven, go to STEP 2W.

STEP 2K (KNITS): WHAT DOES THE SURFACE LOOK LIKE?
- Fuzzy halo of fine wispy fibers catching light → mohair or kid mohair blend. Say "wool-mohair blend knit" or "kid mohair blend knit." Do NOT say just "wool blend" or "merino" when you see a fuzzy halo.
- Smooth, even, fine-gauge with no fuzz → cashmere or fine merino. These look identical in photos. Say "cashmere knit or fine merino wool knit."
- Medium-gauge with visible stitch definition, no fuzz → merino wool or wool-acrylic blend.
- Chunky, lofty → wool, alpaca, or acrylic. Acknowledge ambiguity.
- Flat, dense, no loft → cotton knit or cotton-modal blend.
Then provide 3-4 options spanning Investment to Budget with genuinely different fibers.

STEP 2W (WOVENS): CHECK SHEEN FIRST.
Look at how light interacts with the fabric surface. This is the most important visual property.

HIGH SHEEN (visible light reflection, luminous surface, bright highlights):
→ SATIN/CHARMEUSE family. Fluid drape against the body with smooth liquid folds = silk charmeuse or viscose satin (flag both possibilities). Slightly plastic-looking shine = polyester satin. Subtle warm glow = cotton sateen.
A fabric with sheen is NEVER wool crepe. NEVER matte crepe. NEVER cotton poplin.

NO SHEEN (completely matte, zero light reflection):
→ Go to STEP 3W.

SEMI-SHEER (you can see light through the fabric, or skin is faintly visible beneath):
→ CHIFFON or GEORGETTE family. Chiffon is sheerer, airier, floats in layers. Georgette is slightly more textured/crinkled with a dry hand, more opaque than chiffon but still semi-sheer. Both drape fluidly. Neither is challis (challis is fully opaque). When the fabric could be either, include both as options. Flag silk vs viscose ambiguity.

STEP 3W (MATTE WOVENS): HOW DOES THE FABRIC BEHAVE?

HOLDS VOLUME outward from body, crisp/defined gathers, fabric stands away from legs:
→ COTTON family. Cotton poplin (crisp, smooth), cotton sateen (slight sheen - recheck step 2W), cotton broadcloth. Cotton has body. Even a formal maxi dress or expensive dress can be cotton. Do not assume silk/georgette just because a dress looks nice.

FLUID DRAPE against the body, soft movement, fabric flows with the body but is opaque and matte:
→ CREPE DE CHINE (heavier than chiffon/georgette, fully opaque, matte with slight texture) or VISCOSE/RAYON CHALLIS (soft, opaque, matte, lightweight, flows but doesn't float). Challis and crepe de chine differ in weight: challis is lighter and softer, crepe de chine has more body and a subtle pebbly texture.

STRUCTURED, SMOOTH, MATTE, WRINKLE-FREE (holds crisp silhouette, zero visible creasing):
→ WOOL CREPE or wool blend. The only fabric that is simultaneously matte, structured, wrinkle-free, and smooth. Cotton wrinkles. Polyester crepe often has slight shine. Lead with "wool crepe with elastane" for fitted garments.

SLUBBY TEXTURE, natural creasing, visible irregularity:
→ Linen or hemp (look identical in photos, name both).

OUTPUT RULES:
- 3-4 options with genuinely different fibers. Not "cotton poplin, cotton sateen, cotton broadcloth."
- Options ordered: Investment first, Mid-range, Budget last.
- Price tier logic: pure natural fibers > synthetic blends. Silk > viscose. Wool > acrylic. Cotton > cotton-poly blend.
- Fitted bodice/body-hugging areas → likely contains 2-5% elastane. Mention it.
- Do NOT reference or guess at brands. Analyze only visible fabric properties.
- Do NOT fixate on prints/patterns. Analyze the base fabric.
- Do NOT give yardage estimates.
- Do NOT break same-fabric garments into pieces.
- Tone: knowledgeable but conversational, like a friend who works at a high-end fabric store.

Return ONLY the JSON object, no other text.`;

    const userHint = (hint || '').slice(0, 200).trim();
    const finalPrompt = userHint
      ? prompt + `\n\nThe sewist provided this description: "${userHint}". Use this as additional context alongside your visual analysis.`
      : prompt;

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
            { type: "text", text: finalPrompt }
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

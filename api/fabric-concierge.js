// api/fabric-concierge.js
// Fabric Concierge - Upload a photo, get fabric options to recreate it

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

    const prompt = `You are an expert textile and fashion specialist who talks like a knowledgeable friend at a fabric store. A sewist uploaded a photo of something they want to recreate. It could be an outfit, a single garment, a runway shot, a Pinterest save, or a fabric swatch.

Your job: identify the fabrics in the image, then for each one, give them realistic options they could buy to recreate it. Not just "this is silk charmeuse" but "here are 3 fabrics that would get you this look, with tradeoffs."

Return ONLY valid JSON in this format:
{
  "overview": "2-3 sentences describing what you see. Warm, conversational, like a friend helping them shop.",
  "pieces": [
    {
      "name": "What this piece is (e.g., 'The skirt', 'The blouse', 'The jacket'). If it's a single fabric swatch, just say 'This fabric'.",
      "looksLike": "What the original fabric appears to be (e.g., 'Silk charmeuse or a similar satin-weave silk')",
      "options": [
        {
          "fabric": "Specific fabric name (e.g., 'Silk charmeuse')",
          "pros": "Why this works. 1 sentence, plain language.",
          "cons": "The downside. 1 sentence, plain language.",
          "price": "Budget, Mid-range, or Investment",
          "difficulty": "Beginner-friendly, Intermediate, or Advanced"
        }
      ],
      "estimatedYardage": "How much fabric they'd need (e.g., '2.5 - 3 yards for a midi length')",
      "tip": "One practical sewing tip for this piece. Something actually useful."
    }
  ],
  "disclaimer": "These are our best guesses based on the photo. Fiber content can't be confirmed from an image alone."
}

GUIDELINES:
- Give 2-4 options per piece, ranging from the closest match to easier/cheaper alternatives
- Always include at least one beginner-friendly option
- Be honest about tradeoffs. If polyester satin looks close but feels cheap, say that.
- If the image shows multiple garment pieces, break them out separately
- If it's just a fabric swatch, give one piece with options for what it could be
- Keep everything conversational. No jargon without explanation.
- Yardage estimates should assume a standard size range (8-14) and note that

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

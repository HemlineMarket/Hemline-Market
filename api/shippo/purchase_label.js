// File: /api/shippo/purchase_label.js
// Purchases a label for a selected rate from Shippo
// Requires SHIPPO_API_KEY in Vercel env

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { orderId, rate_id, label_file_type = "PDF" } = req.body || {};
    if (!rate_id) {
      return res.status(400).json({ error: "Missing rate_id" });
    }

    const apiKey = process.env.SHIPPO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing SHIPPO_API_KEY" });
    }

    const resp = await fetch("https://api.goshippo.com/transactions/", {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rate: rate_id,
        async: false,
        label_file_type,
        metadata: orderId ? `order:${orderId}` : undefined,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return res
        .status(resp.status)
        .json({ error: "Shippo /transactions failed", details: txt });
    }

    const tx = await resp.json();

    if (tx.status !== "SUCCESS") {
      return res.status(502).json({
        error: "Label purchase not successful",
        details: tx.messages || tx,
      });
    }

    const result = {
      orderId,
      transaction_id: tx.object_id,
      label_url: tx.label_url,
      tracking_number: tx.tracking_number,
      tracking_url: tx.tracking_url_provider || tx.tracking_url,
      carrier: tx.rate?.provider,
      service: tx.rate?.servicelevel?.name || tx.rate?.servicelevel?.token,
    };

    // TODO: Save `result` on your Order record in DB

    return res.status(200).json(result);
  } catch (err) {
    console.error("purchase_label error:", err);
    return res.status(500).json({ error: "Failed to purchase label" });
  }
}

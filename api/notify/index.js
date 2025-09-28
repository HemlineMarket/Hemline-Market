// File: /api/notify/index.js
// Health check + reference index for all notify endpoints

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  return res.status(200).json({
    ok: true,
    endpoints: [
      "/api/notify/shipment",
      "/api/notify/refund",
      "/api/notify/account",
      "/api/notify/support",
      "/api/notify/generic",
    ],
  });
}

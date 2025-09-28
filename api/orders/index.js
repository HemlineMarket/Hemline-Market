// File: /api/orders/index.js
// Orders index endpoint with auth + rate limiting

import rateLimit from "../../middleware/rateLimit";

export default async function handler(req, res) {
  return rateLimit(req, res, async () => {
    // Require Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${process.env.HM_ADMIN_KEY}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    return res.status(200).json({
      ok: true,
      message: "Orders API root (secured)"
    });
  });
}

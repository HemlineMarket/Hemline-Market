// File: /api/admin/index.js
// Index + health check for admin APIs
// Protected by ADMIN_SECRET + rate limiting

import protect from "./protect";
import rateLimit from "../../middleware/rateLimit";

async function handler(req, res) {
  return rateLimit(req, res, async () => {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    return res.status(200).json({
      ok: true,
      endpoints: [
        "/api/admin/orders",
        "/api/admin/users",
        "/api/admin/shipments"
      ]
    });
  });
}

export default protect(handler);

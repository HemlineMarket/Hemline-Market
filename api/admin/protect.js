// File: /api/admin/protect.js
// Middleware-style helper for admin-only API routes
// Accepts EITHER of:
//   1) Authorization: Bearer <HM_ADMIN_KEY>
//   2) x-admin-token: <ADMIN_SECRET>

export default function protect(handler) {
  return async function wrapped(req, res) {
    const auth = req.headers.authorization || "";
    const bearerKey = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const headerToken = req.headers["x-admin-token"];

    const okBearer = process.env.HM_ADMIN_KEY && bearerKey === process.env.HM_ADMIN_KEY;
    const okHeader = process.env.ADMIN_SECRET && headerToken === process.env.ADMIN_SECRET;

    if (!okBearer && !okHeader) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    return handler(req, res);
  };
}

// File: /api/admin/protect.js
// Middleware-style helper for admin-only API routes
//
// Usage: import protect from "../admin/protect";
// then wrap your handler with it.

export default function protect(handler) {
  return async function wrapped(req, res) {
    const token = req.headers["x-admin-token"];

    if (!token || token !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    return handler(req, res);
  };
}

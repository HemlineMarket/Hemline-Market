// File: /api/_rateLimit.js
// Simple in-memory rate limiter for Vercel serverless functions.
// NOTE: This is per-region & per-instance (not shared globally).

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 20;     // per IP per window

const buckets = new Map();

export function rateLimit(req, res) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = buckets.get(ip) || { count: 0, expires: now + WINDOW_MS };

  if (now > bucket.expires) {
    // reset window
    bucket.count = 0;
    bucket.expires = now + WINDOW_MS;
  }

  bucket.count++;
  buckets.set(ip, bucket);

  if (bucket.count > MAX_REQUESTS) {
    res.status(429).json({ error: "Too Many Requests" });
    return false;
  }
  return true;
}

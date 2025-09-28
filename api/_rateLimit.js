// File: /api/_rateLimit.js
// Simple in-memory rate limiter for API routes
// Protects against abuse (per IP, per route)

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 30;     // per IP per minute

const hits = new Map();

export default function rateLimit(handler) {
  return async function wrapped(req, res) {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    if (!hits.has(ip)) hits.set(ip, []);
    const timestamps = hits.get(ip).filter(ts => ts > windowStart);

    timestamps.push(now);
    hits.set(ip, timestamps);

    if (timestamps.length > MAX_REQUESTS) {
      res.setHeader("Retry-After", Math.ceil(WINDOW_MS / 1000));
      return res.status(429).json({ error: "Too many requests, slow down." });
    }

    return handler(req, res);
  };
}

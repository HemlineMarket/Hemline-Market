// middleware/rateLimit.js
// Simple in-memory rate limiter for Vercel/Supabase edge API routes

const rateLimits = new Map();

// Limit: 100 requests per 15 minutes per IP
const WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 100;

export default function rateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();

  if (!rateLimits.has(ip)) {
    rateLimits.set(ip, []);
  }

  const timestamps = rateLimits.get(ip);

  // drop old timestamps
  while (timestamps.length && timestamps[0] <= now - WINDOW) {
    timestamps.shift();
  }

  if (timestamps.length >= MAX_REQUESTS) {
    res.status(429).json({ error: 'Too many requests, slow down.' });
    return;
  }

  timestamps.push(now);
  rateLimits.set(ip, timestamps);

  next();
}

// File: /api/_rateLimitDb.js
// Distributed rate limiter using Supabase
// Works across all serverless function instances
//
// Requires a rate_limits table in Supabase:
// CREATE TABLE rate_limits (
//   key TEXT PRIMARY KEY,
//   count INTEGER DEFAULT 0,
//   window_start TIMESTAMPTZ DEFAULT NOW()
// );

import { createClient } from "@supabase/supabase-js";

const WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_REQUESTS = 30;     // requests per window per key

let supabase = null;

function getSupabase() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      supabase = createClient(url, key, { auth: { persistSession: false } });
    }
  }
  return supabase;
}

/**
 * Check and increment rate limit for a key
 * @param {string} key - Rate limit key (e.g., IP address, user ID)
 * @param {object} options - { maxRequests, windowMs }
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: Date}>}
 */
export async function checkRateLimit(key, options = {}) {
  const maxRequests = options.maxRequests || MAX_REQUESTS;
  const windowMs = options.windowMs || WINDOW_MS;
  
  const db = getSupabase();
  
  // Fallback to always-allow if no database
  if (!db) {
    return { allowed: true, remaining: maxRequests, resetAt: new Date(Date.now() + windowMs) };
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);

  try {
    // Try to get existing rate limit record
    const { data: existing } = await db
      .from("rate_limits")
      .select("count, window_start")
      .eq("key", key)
      .single();

    if (existing) {
      const recordWindowStart = new Date(existing.window_start);
      
      // Check if window has expired
      if (recordWindowStart < windowStart) {
        // Reset the window
        await db
          .from("rate_limits")
          .update({ count: 1, window_start: now.toISOString() })
          .eq("key", key);
        
        return { 
          allowed: true, 
          remaining: maxRequests - 1, 
          resetAt: new Date(now.getTime() + windowMs) 
        };
      }

      // Window still active - check if over limit
      if (existing.count >= maxRequests) {
        const resetAt = new Date(recordWindowStart.getTime() + windowMs);
        return { 
          allowed: false, 
          remaining: 0, 
          resetAt 
        };
      }

      // Increment count
      await db
        .from("rate_limits")
        .update({ count: existing.count + 1 })
        .eq("key", key);

      return { 
        allowed: true, 
        remaining: maxRequests - existing.count - 1, 
        resetAt: new Date(recordWindowStart.getTime() + windowMs) 
      };
    }

    // No existing record - create one
    await db
      .from("rate_limits")
      .insert({ key, count: 1, window_start: now.toISOString() });

    return { 
      allowed: true, 
      remaining: maxRequests - 1, 
      resetAt: new Date(now.getTime() + windowMs) 
    };

  } catch (err) {
    // On any error, allow the request (fail open)
    console.error("[rateLimitDb] Error:", err.message);
    return { allowed: true, remaining: maxRequests, resetAt: new Date(Date.now() + windowMs) };
  }
}

/**
 * Express/Vercel middleware style rate limiter
 * @param {Request} req 
 * @param {Response} res 
 * @param {object} options - { maxRequests, windowMs, keyFn }
 * @returns {Promise<boolean>} - true if request is allowed
 */
export async function rateLimit(req, res, options = {}) {
  // Extract key (default: IP address)
  const keyFn = options.keyFn || ((req) => {
    return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() 
      || req.socket?.remoteAddress 
      || "unknown";
  });
  
  const key = `rate:${keyFn(req)}`;
  const result = await checkRateLimit(key, options);

  // Set rate limit headers
  res.setHeader("X-RateLimit-Limit", options.maxRequests || MAX_REQUESTS);
  res.setHeader("X-RateLimit-Remaining", result.remaining);
  res.setHeader("X-RateLimit-Reset", Math.floor(result.resetAt.getTime() / 1000));

  if (!result.allowed) {
    res.status(429).json({ 
      error: "Too Many Requests",
      message: "Please slow down. Try again in a minute.",
      retryAfter: Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)
    });
    return false;
  }

  return true;
}

/**
 * Cleanup old rate limit records (call from cron)
 */
export async function cleanupRateLimits() {
  const db = getSupabase();
  if (!db) return;

  const cutoff = new Date(Date.now() - WINDOW_MS * 2).toISOString();
  
  await db
    .from("rate_limits")
    .delete()
    .lt("window_start", cutoff);
}

// File: /api/_logger.js
// Lightweight server-side logger → writes to public.error_logs (service role)
// Usage: import { logError, logWarn, logInfo } from "../_logger";

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  url && key
    ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

async function insertLog(level, route, message, details = {}, ip = "") {
  try {
    if (!supabase) return;
    await supabase.from("error_logs").insert({
      level,
      route,
      message: message?.toString?.() || String(message || ""),
      details,
      ip,
    });
  } catch (e) {
    // Last-resort: avoid throwing from logger
    console.warn("[logger] failed to insert log:", e?.message || e);
  }
}

export async function logError(route, message, details = {}, req) {
  const ip =
    req?.headers?.["x-forwarded-for"]?.split(",")[0] ||
    req?.socket?.remoteAddress ||
    "";
  await insertLog("error", route, message, details, ip);
}

export async function logWarn(route, message, details = {}, req) {
  const ip =
    req?.headers?.["x-forwarded-for"]?.split(",")[0] ||
    req?.socket?.remoteAddress ||
    "";
  await insertLog("warn", route, message, details, ip);
}

export async function logInfo(route, message, details = {}, req) {
  const ip =
    req?.headers?.["x-forwarded-for"]?.split(",")[0] ||
    req?.socket?.remoteAddress ||
    "";
  await insertLog("info", route, message, details, ip);
}

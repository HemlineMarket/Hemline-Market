// File: /api/orders/cancel.js
// Buyer-initiated cancellation (within 30 minutes).
// Refunds payment, reopens listing, updates order, sends notifications.
//
// ENV REQUIRED:
// STRIPE_SECRET_KEY
// SITE_URL
// SUPABASE_URL
// SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import fetch from "node-fetch";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function site() {
  return (process.env.SITE_URL || "").replace(/\/$/, "");
}

async function notify(payload) {
  try {
    await fetch(`${site()}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (_) {}
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Must be logged in
  const token = req.headers["authorization"]?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  // Get current user
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { order_id } = req.body || {};
  if (!order_id) return res.status(400).json({ error: "Missing order_id" });

  // Fetch order
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("*")
    .eq("id", order_id)
    .single();

  if (orderErr || !order) return res.status(404).json({ error: "Order not found" });

  // Ensure buyer owns this order
  if (order.buyer_id !== user.id) {
    return res.status(403).json({ error: "Not allowed" });
  }

  // Ensure cancellation window (30 minutes)
  const created = new Date(order.created_at).getTime();
  const now = Date.now();
  const minutes = (now - created) / 1000 / 60;

  if (minutes > 30)

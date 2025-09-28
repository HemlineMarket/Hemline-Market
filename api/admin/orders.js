// File: /api/admin/orders.js
// Admin endpoint to list orders with basic details
// Protected by ADMIN_SECRET

import { createClient } from "@supabase/supabase-js";
import protect from "./protect";

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { data, error } = await supabase
      .from("orders")
      .select("order_id, buyer_id, seller_id, total_cents, status, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("admin/orders error:", error);
      return res.status(500).json({ error: "Database error" });
    }

    return res.status(200).json({ orders: data });
  } catch (err) {
    console.error("admin/orders exception:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

export default protect(handler);

// File: /api/admin/shipments.js
// Admin endpoint to list recent shipments
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
      .from("db_shipments")
      .select("order_id, tracking_number, carrier, service, status, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("admin/shipments error:", error);
      return res.status(500).json({ error: "Database error" });
    }

    return res.status(200).json({ shipments: data });
  } catch (err) {
    console.error("admin/shipments exception:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

export default protect(handler);

// File: /api/shippo/get_shipment.js
// Read-only: returns latest label/tracking info for an order from Supabase
// Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { orderId } = req.query || {};
  if (!orderId) return res.status(400).json({ error: "Missing orderId" });

  try {
    const { data, error } = await supabase
      .from("order_shipments")
      .select(
        "order_id, label_url, tracking_number, tracking_url, carrier, service, status, created_at, updated_at"
      )
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("get_shipment db error:", error);
      return res.status(500).json({ error: "Database error" });
    }
    if (!data) return res.status(404).json({ error: "No shipment found for order" });

    return res.status(200).json(data);
  } catch (err) {
    console.error("get_shipment exception:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

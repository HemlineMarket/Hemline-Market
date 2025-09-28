// File: /api/shippo/get_shipment.js
// Read-only endpoint used by orders pages to show label/track info.
// GET /api/shippo/get_shipment?orderId=HM-12345
//
// Now reads from the canonical table: public.db_shipments
//
// Env required: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY

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

  try {
    const orderId = String(req.query.orderId || "").trim();
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });

    const { data, error } = await supabase
      .from("db_shipments")
      .select("order_id, status, label_url, tracking_number, tracking_url, carrier, service, updated_at")
      .eq("order_id", orderId)
      .maybeSingle();

    if (error) {
      console.error("[get_shipment] supabase error:", error);
      return res.status(500).json({ error: "Database error" });
    }
    if (!data) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("[get_shipment] error:", err?.message || err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

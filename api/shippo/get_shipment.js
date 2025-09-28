// File: /api/shippo/get_shipment.js
// Returns the latest shipment row for a given orderId from db_shipments
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import supabaseAdmin from "../_supabaseAdmin";

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const orderId = (req.query.orderId || "").trim();
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });

    const { data, error } = await supabaseAdmin
      .from("db_shipments")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("get_shipment db error:", error);
      return res.status(500).json({ error: "Database error" });
    }

    if (!data) return res.status(404).json({ error: "Not found" });

    return res.status(200).json(data);
  } catch (err) {
    console.error("get_shipment error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

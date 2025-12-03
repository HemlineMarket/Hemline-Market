// File: /api/shippo/get_shipment.js
// Returns the latest shipment row for a given orderId from db_shipments
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import supabaseAdmin from "../_supabaseAdmin";
import { rateLimit } from "../_rateLimit";
import { logError } from "../_logger";

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  // Enforce per-IP rate limit
  if (!rateLimit(req, res)) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const rawOrderId = req.query.orderId;
    const orderId =
      typeof rawOrderId === "string" ? rawOrderId.trim() : Array.isArray(rawOrderId) ? rawOrderId[0].trim() : "";

    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }

    const { data, error } = await supabaseAdmin
      .from("db_shipments")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      await logError("/api/shippo/get_shipment", "db_shipments select error", {
        error,
        orderId,
      });
      return res.status(500).json({ error: "Database error" });
    }

    if (!data) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.status(200).json(data);
  } catch (err) {
    await logError("/api/shippo/get_shipment", "Unhandled error", {
      message: err?.message || err,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

// File: /api/shippo/get_shipment.js
// Returns the latest shipment row for a given orderId from db_shipments
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { rateLimit } from "./_rateLimit";
import supabaseAdmin from "../_supabaseAdmin";

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  // Per-IP rate limit
  if (!rateLimit(req, res)) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const orderId = (req.query.orderId || "").trim();
    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }

    // -------------------------------------------------------------------
    // Fetch latest shipment row
    // -------------------------------------------------------------------
    const { data, error } = await supabaseAdmin
      .from("db_shipments")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[get_shipment] Supabase error:", error);
      return res.status(500).json({ error: "Database error" });
    }

    if (!data) {
      return res.status(404).json({ error: "Shipment not found" });
    }

    // -------------------------------------------------------------------
    // Clean and send response
    // -------------------------------------------------------------------
    return res.status(200).json({
      order_id: data.order_id,
      tracking_number: data.tracking_number,
      tracking_url: data.tracking_url,
      label_url: data.label_url,
      shippo_transaction_id: data.shippo_transaction_id,
      carrier: data.carrier,
      service: data.service,
      status: data.status,
      amount_cents: data.amount_cents,
      created_at: data.created_at,
      updated_at: data.updated_at,
      raw: data.raw || null,
    });
  } catch (err) {
    console.error("[get_shipment] Unhandled error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

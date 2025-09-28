// File: /api/shippo/create_label.js
// Creates a shipping label via Shippo and saves record to db_shipments.

import { rateLimit } from "./_rateLimit";
import supabaseAdmin from "../_supabaseAdmin";

export default async function handler(req, res) {
  // Enforce rate limit
  if (!rateLimit(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { orderId, address_from, address_to, parcel } = req.body || {};
    if (!orderId || !address_from || !address_to || !parcel) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Call Shippo API
    const shippoRes = await fetch("https://api.goshippo.com/transactions", {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${process.env.SHIPPO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shipment: {
          address_from,
          address_to,
          parcels: [parcel],
        },
        async: false,
      }),
    });

    const data = await shippoRes.json();
    if (!shippoRes.ok) {
      console.error("Shippo error:", data);
      return res.status(400).json({ error: "Shippo API error", details: data });
    }

    // Save to db_shipments
    const { error } = await supabaseAdmin.from("db_shipments").insert([
      {
        order_id: orderId,
        shippo_transaction_id: data.object_id,
        status: data.status || "CREATED",
        label_url: data.label_url || null,
        tracking_number: data.tracking_number || null,
        tracking_url: data.tracking_url_provider || null,
        carrier: data.rate?.provider || null,
        service: data.rate?.servicelevel?.name || null,
        raw: data,
      },
    ]);

    if (error) {
      console.error("Supabase insert error:", error);
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("create_label error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

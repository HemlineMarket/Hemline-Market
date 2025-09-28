// File: /api/shippo/create_label.js
// Creates a shipping label via Shippo for a given order
// Persists the label + tracking to Supabase (db_shipments)
// Requires env: SHIPPO_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fetch from "node-fetch";
import supabaseAdmin from "../_supabaseAdmin";

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { orderId, address_from, address_to, parcel } = req.body || {};
    if (!orderId || !address_from || !address_to || !parcel) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const apiKey = process.env.SHIPPO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing SHIPPO_API_KEY" });
    }

    // 1) Create shipment
    const shipmentRes = await fetch("https://api.goshippo.com/shipments/", {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address_from,
        address_to,
        parcels: [parcel],
        async: false,
        metadata: `order:${orderId}`,
      }),
    });

    const shipment = await shipmentRes.json();
    if (!shipment?.rates || !Array.isArray(shipment.rates) || shipment.rates.length === 0) {
      return res.status(400).json({ error: "No shipping rates found", details: shipment });
    }

    // 2) Pick the cheapest rate
    const rate = shipment.rates
      .slice()
      .sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount))[0];

    // 3) Buy the label (transaction)
    const transactionRes = await fetch("https://api.goshippo.com/transactions/", {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rate: rate.object_id,
        label_file_type: "PDF",
        async: false,
        metadata: `order:${orderId}`,
      }),
    });

    const tx = await transactionRes.json();
    if (tx.status !== "SUCCESS") {
      return res.status(502).json({ error: "Label purchase not successful", details: tx });
    }

    // 4) Persist to Supabase (server-side; bypasses RLS)
    try {
      const payload = {
        order_id: orderId,
        shippo_transaction_id: tx.object_id || null,
        label_url: tx.label_url || null,
        tracking_number: tx.tracking_number || null,
        tracking_url: tx.tracking_url_provider || tx.tracking_url || null,
        carrier: tx.rate?.provider || null,
        service: tx.rate?.servicelevel?.name || null,
        amount_cents: tx.rate?.amount ? Math.round(parseFloat(tx.rate.amount) * 100) : null,
        status: "LABEL_PURCHASED",
        raw: tx, // keep the whole transaction for auditing
      };

      // Delete any previous row for the same order, then insert fresh
      await supabaseAdmin.from("db_shipments").delete().eq("order_id", orderId);
      await supabaseAdmin.from("db_shipments").insert(payload);
    } catch (dbErr) {
      // Do not fail the label response if DB write fails; just log it
      console.error("db_shipments insert error:", dbErr);
    }

    // 5) Return to client
    return res.status(200).json({
      orderId,
      tracking_number: tx.tracking_number,
      tracking_url: tx.tracking_url_provider || tx.tracking_url || null,
      label_url: tx.label_url,
      carrier: tx.rate?.provider || null,
      service: tx.rate?.servicelevel?.name || null,
      rate: tx.rate || null,
    });
  } catch (err) {
    console.error("Shippo label error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

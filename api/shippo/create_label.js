// File: /api/shippo/create_label.js
// Creates a shipment, picks the cheapest rate, purchases a label (TEST/LIVE depends on your key)
// Saves label + tracking to Supabase via lib/db-shipments.js
// Requires env: SHIPPO_API_KEY, SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY

import { saveOrderShipment } from "../../lib/db-shipments.js";

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

    // 1) Create shipment → get rates
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

    if (!shipmentRes.ok) {
      const txt = await shipmentRes.text();
      return res
        .status(shipmentRes.status)
        .json({ error: "Shippo /shipments failed", details: txt });
    }

    const shipment = await shipmentRes.json();

    const rates = Array.isArray(shipment.rates) ? shipment.rates : [];
    if (!rates.length) {
      return res.status(400).json({ error: "No shipping rates found" });
    }

    // Pick cheapest rate
    const cheapest = rates
      .map(r => ({ ...r, _amt: parseFloat(r.amount) }))
      .sort((a, b) => a._amt - b._amt)[0];

    // 2) Buy label for selected rate
    const txRes = await fetch("https://api.goshippo.com/transactions/", {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rate: cheapest.object_id,
        label_file_type: "PDF",
        async: false,
        metadata: `order:${orderId}`,
      }),
    });

    if (!txRes.ok) {
      const txt = await txRes.text();
      return res
        .status(txRes.status)
        .json({ error: "Shippo /transactions failed", details: txt });
    }

    const tx = await txRes.json();

    if (tx.status !== "SUCCESS") {
      return res
        .status(500)
        .json({ error: "Label purchase failed", details: tx });
    }

    // 3) Persist to Supabase (server-side via service role)
    await saveOrderShipment({
      orderId,
      shipment_id: shipment.object_id,
      transaction_id: tx.object_id,
      label_url: tx.label_url,
      tracking_number: tx.tracking_number,
      tracking_url: tx.tracking_url_provider || tx.tracking_url,
      carrier: tx.rate?.provider ?? cheapest.provider,
      service:
        tx.rate?.servicelevel?.name ||
        tx.rate?.servicelevel?.token ||
        cheapest.servicelevel?.name ||
        cheapest.servicelevel?.token ||
        null,
      rate_amount:
        typeof cheapest.amount === "string"
          ? parseFloat(cheapest.amount)
          : cheapest.amount,
      rate_currency: cheapest.currency || tx.rate?.currency || "USD",
      status: "PURCHASED",
      raw: tx, // keep full transaction payload for audit/debug
    });

    // 4) Response back to client
    return res.status(200).json({
      orderId,
      shipment_id: shipment.object_id,
      rate: {
        id: cheapest.object_id,
        amount: cheapest.amount,
        currency: cheapest.currency,
        provider: cheapest.provider,
        service:
          cheapest.servicelevel?.name || cheapest.servicelevel?.token || null,
      },
      transaction_id: tx.object_id,
      label_url: tx.label_url,
      tracking_number: tx.tracking_number,
      tracking_url: tx.tracking_url_provider || tx.tracking_url,
    });
  } catch (err) {
    console.error("Shippo create_label error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

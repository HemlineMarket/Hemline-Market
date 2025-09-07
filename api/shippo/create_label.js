import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { orderId, address_from, address_to, parcel } = req.body;

    // Build payload for Shippo
    const payload = {
      address_from,
      address_to,
      parcels: [parcel],
      async: false
    };

    // Call Shippo API
    const response = await fetch("https://api.goshippo.com/shipments/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `ShippoToken ${process.env.SHIPPO_API_TOKEN}`
      },
      body: JSON.stringify(payload)
    });

    const shipment = await response.json();

    // Return rates + shipment object
    res.status(200).json({ orderId, shipment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create label" });
  }
}

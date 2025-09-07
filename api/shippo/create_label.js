// /api/shippo/create_label.js
// Creates a shipping label via Shippo API

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const token = process.env.SHIPPO_API_TOKEN;
    if (!token) {
      return res.status(500).json({ error: 'Shippo API token missing' });
    }

    // Example payload sent in from checkout or dashboard
    const {
      addressFrom,
      addressTo,
      parcel,
      metadata
    } = req.body;

    // Build request to Shippo
    const resp = await fetch('https://api.goshippo.com/shipments/', {
      method: 'POST',
      headers: {
        'Authorization': `ShippoToken ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        address_from: addressFrom,
        address_to: addressTo,
        parcels: [parcel],
        async: false,
        metadata: metadata || ''
      })
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return res.status(resp.status).json({ error: txt });
    }

    const shipment = await resp.json();

    // Pick the first available rate
    const rateId = shipment.rates?.[0]?.object_id;
    if (!rateId) {
      return res.status(400).json({ error: 'No rates available' });
    }

    // Buy the label
    const labelResp = await fetch('https://api.goshippo.com/transactions/', {
      method: 'POST',
      headers: {
        'Authorization': `ShippoToken ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        rate: rateId,
        label_file_type: 'PDF'
      })
    });

    const label = await labelResp.json();

    return res.status(200).json({
      shipment_id: shipment.object_id,
      label_url: label.label_url,
      tracking_number: label.tracking_number,
      tracking_url: label.tracking_url_provider,
      metadata: label.metadata
    });

  } catch (err) {
    console.error('Shippo create_label error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

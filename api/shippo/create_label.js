// /api/shippo/create_label.js
// Creates a shipping label with Shippo and returns label + tracking info.
// Expects POST JSON with: { to, from, parcel }
// Docs: https://goshippo.com/docs/reference#shipments

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const SHIPPO_API_TOKEN = process.env.SHIPPO_API_TOKEN;
  if (!SHIPPO_API_TOKEN) {
    return res.status(500).json({ error: 'Missing SHIPPO_API_TOKEN env var' });
  }

  // Basic input validation — we keep this strict so we catch bad data early.
  const { to, from, parcel } = req.body || {};
  if (!to || !from || !parcel) {
    return res.status(400).json({
      error: 'Missing required body. Provide { to, from, parcel }.'
    });
  }

  // Helper for Shippo fetch calls
  const shippoFetch = async (path, body) => {
    const r = await fetch(`https://api.goshippo.com${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `ShippoToken ${SHIPPO_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`Shippo ${path} ${r.status}: ${text}`);
    }
    return r.json();
  };

  try {
    // 1) Create a Shipment and get live rates (sync)
    const shipment = await shippoFetch('/shipments/', {
      address_from: from,     // { name, street1, city, state, zip, country, phone?, email? }
      address_to: to,         // same shape as above
      parcels: [parcel],      // { length, width, height, distance_unit:'in', weight, mass_unit:'lb'|'oz' }
      async: false            // return rates immediately
    });

    if (!shipment?.rates?.length) {
      return res.status(422).json({
        error: 'No shipping rates returned for this address/parcel.',
        details: shipment
      });
    }

    // 2) Pick the cheapest rate (feel free to refine later by carrier/service)
    const cheapest = shipment.rates
      .map(r => ({ ...r, amountNum: Number(r.amount) || Infinity }))
      .sort((a, b) => a.amountNum - b.amountNum)[0];

    if (!cheapest || !cheapest.object_id) {
      return res.status(422).json({ error: 'Could not choose a rate.', rates: shipment.rates });
    }

    // 3) Buy the label (sync) -> returns label_url + tracking info
    const tx = await shippoFetch('/transactions/', {
      rate: cheapest.object_id,
      label_file_type: 'PDF',
      async: false
    });

    if (tx.status !== 'SUCCESS') {
      return res.status(502).json({ error: 'Label purchase failed', transaction: tx });
    }

    // 4) Respond with what the UI needs
    return res.status(200).json({
      shipment_id: shipment.object_id,
      transaction_id: tx.object_id,
      rate: {
        amount: cheapest.amount,
        currency: cheapest.currency,
        provider: cheapest.provider,
        servicelevel: cheapest.servicelevel?.name || cheapest.servicelevel?.token,
        est_days: cheapest.estimated_days ?? null
      },
      label_url: tx.label_url,
      tracking_number: tx.tracking_number,
      tracking_url: tx.tracking_url_provider
    });
  } catch (err) {
    console.error('Shippo error:', err);
    return res.status(500).json({ error: 'Shippo error', message: err.message });
  }
}

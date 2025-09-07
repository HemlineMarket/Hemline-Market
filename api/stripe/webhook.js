case 'checkout.session.completed': {
  const s = event.data.object; // Checkout Session
  console.log('[stripe] checkout.session.completed', { id: s.id });

  // Example: create a Shippo transaction right away
  try {
    const resp = await fetch("https://api.goshippo.com/transactions/", {
      method: "POST",
      headers: {
        "Authorization": `ShippoToken ${process.env.SHIPPO_LIVE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        shipment: {
          address_from: {
            name: "Hemline Market Seller",
            street1: "123 Fabric St",
            city: "Boston",
            state: "MA",
            zip: "02118",
            country: "US"
          },
          address_to: {
            name: s.customer_details?.name || "Buyer",
            street1: s.shipping_details?.address?.line1,
            city: s.shipping_details?.address?.city,
            state: s.shipping_details?.address?.state,
            zip: s.shipping_details?.address?.postal_code,
            country: s.shipping_details?.address?.country || "US"
          },
          parcels: [{
            length: "12",
            width: "9",
            height: "2",
            distance_unit: "in",
            weight: "2",
            mass_unit: "lb"
          }]
        },
        async: false
      })
    });

    const tx = await resp.json();
    console.log("[shippo] transaction created", tx.object_id);

    // TODO: save order → include tx.object_id in DB
    // Example: await db.orders.update({ id: s.id }, { shippo_tx: tx.object_id });

  } catch (e) {
    console.error("[shippo] create transaction failed", e);
  }

  break;
}

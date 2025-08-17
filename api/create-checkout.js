// /api/create-checkout.js
import { priceToCents, assertUSD } from "../lib/price.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { price } = req.body; // e.g. { price: "24.99" }
    const amount = priceToCents(price);
    const currency = assertUSD();

    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        mode: "payment",
        "line_items[0][price_data][currency]": currency,
        "line_items[0][price_data][product_data][name]": "Fabric Listing",
        "line_items[0][price_data][unit_amount]": amount.toString(),
        "line_items[0][quantity]": "1",
        success_url: `${process.env.SITE_URL}/success.html`,
        cancel_url: `${process.env.SITE_URL}/cancel.html`,
      }),
    });

    const session = await r.json();
    if (!r.ok) {
      return res.status(500).json({ ok: false, error: session.error });
    }
    res.status(200).json({ ok: true, id: session.id, url: session.url });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

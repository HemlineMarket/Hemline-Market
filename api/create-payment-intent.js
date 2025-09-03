// /api/create-payment-intent (Vercel serverless function)
// Accepts JSON: { subtotalCents: number, shippingTier: "light" | "standard" | "heavy" }

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { subtotalCents, shippingTier } = req.body || {};

    // Basic validation / normalize
    const sub = Number.isFinite(subtotalCents) && subtotalCents >= 0
      ? Math.floor(subtotalCents)
      : 0;

    // Flat-rate tiers (USD, cents)
    const SHIPPING = {
      light: 500,     // $5   (under 1 lb)
      standard: 800,  // $8   (1–5 lb)
      heavy: 1400,    // $14  (over 5 lb)
    };

    const ship = SHIPPING[shippingTier] ?? SHIPPING.standard;

    const amount = sub + ship;

    const intent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: {
        source: "hemlinemarket-web",
        shipping_tier: shippingTier || "standard",
        subtotal_cents: String(sub),
        shipping_cents: String(ship),
      },
    });

    return res.status(200).json({ clientSecret: intent.client_secret });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: err.message });
  }
}

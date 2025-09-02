// Vercel serverless function
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    // TODO: compute amount server-side from your cart/session
    const amount = 8600; // $86.00 (cents) — placeholder for now

    const intent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: { source: "hemlinemarket-web", cart_example: "demo" },
    });

    res.status(200).json({ clientSecret: intent.client_secret });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
}

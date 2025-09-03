// /api/create-payment-intent.js  (Vercel serverless function)
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    // Parse JSON body safely (works whether req.body is object or string)
    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    } catch (_) {
      body = {};
    }

    // Amount from client in cents; fallback to $1.00 if missing/invalid
    let amount = parseInt(body.amount, 10);
    if (!Number.isFinite(amount) || amount < 50) amount = 100; // min 50¢; default $1

    const intent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      payment_method_types: ["card"], // card only
      metadata: {
        source: "hemlinemarket-web",
        cart_amount_cents: String(amount),
      },
    });

    res.status(200).json({ clientSecret: intent.client_secret, amount });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
}

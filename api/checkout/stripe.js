// api/checkout/stripe.js
import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { name, amount } = req.body || {};
  if (!name || !Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name },
            unit_amount: amount, // cents
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/success.html`,
      cancel_url: `${origin}/browse.html`,
      shipping_address_collection: { allowed_countries: ["US", "CA"] },
      billing_address_collection: "auto",
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Stripe error" });
  }
}

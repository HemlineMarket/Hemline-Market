// /api/create-payment-intent.js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Change this env var in Vercel if you want a different flat fee.
// Example: 695 = $6.95
const FLAT_SHIP_CENTS = Number(process.env.SHIPPING_FLAT_CENTS || "695");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    // Front-end can send the cart subtotal in cents. Fallback to demo subtotal.
    // (Keep this until your cart sends a real subtotal.)
    const { subtotalCents } = await readJson(req);
    const subtotal = Number.isFinite(subtotalCents) ? subtotalCents : 8600; // $86.00 demo
    const shipping = FLAT_SHIP_CENTS;
    const total = subtotal + shipping;

    const intent = await stripe.paymentIntents.create({
      amount: total,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: {
        source: "hemlinemarket-web",
        subtotal_cents: String(subtotal),
        shipping_flat_cents: String(shipping),
      },
    });

    res.status(200).json({
      clientSecret: intent.client_secret,
      subtotal,
      shipping,
      total,
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "Stripe error" });
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

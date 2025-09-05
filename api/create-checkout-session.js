import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });
  // Hard block live keys (safety rail)
  if (!secret.startsWith("sk_test_")) {
    return res.status(503).json({ error: "Live payments are disabled. Use test keys." });
  }

  const stripe = new Stripe(secret, { apiVersion: "2024-06-20" });

  try {
    const { line_items, success_url, cancel_url } = req.body || {};

    const items = Array.isArray(line_items) && line_items.length
      ? line_items
      : [{
          price_data: {
            currency: "usd",
            product_data: { name: "Hemline Test Order" },
            unit_amount: 500, // $5.00 test charge
          },
          quantity: 1,
        }];

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: items,
      success_url: success_url || `${req.headers.origin}/success.html?sid={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url || `${req.headers.origin}/cart.html`,
      allow_promotion_codes: false,
      payment_intent_data: { metadata: { env: "test", hemline: "true" } },
    });

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Stripe error" });
  }
}

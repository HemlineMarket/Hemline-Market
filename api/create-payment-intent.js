// /api/create-payment-intent.js  (Vercel Serverless Function - CommonJS)
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  try {
    // TODO: replace with your server-side cart total (in cents)
    const amount = 8600; // $86.00

    const intent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: { source: "hemlinemarket-web" },
    });

    res.status(200).json({ clientSecret: intent.client_secret });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};

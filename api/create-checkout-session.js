const Stripe = require("stripe");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Fabric Test Product" },
            unit_amount: 2000 // $20.00
          },
          quantity: 1
        }
      ],
      success_url: `${req.headers.origin}/dashboard.html?success=true`,
      cancel_url: `${req.headers.origin}/dashboard.html?canceled=true`
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

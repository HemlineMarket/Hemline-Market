// api/checkout/stripe.js
// Serverless endpoint for Stripe Checkout (Vercel /api route)

const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-06-20',
});

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY env var' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];

    if (items.length === 0) {
      return res.status(400).json({ error: 'No items provided' });
    }

    // Build Stripe line_items from client payload
    const line_items = items.map((i) => ({
      quantity: Math.max(1, Number(i.quantity || 1)),
      price_data: {
        currency: (i.currency || 'usd').toLowerCase(),
        unit_amount: Number(i.amount || 0), // cents
        product_data: {
          name: String(i.name || 'Item'),
        },
      },
    }));

    // Determine the site origin for redirects
    const origin =
      process.env.SITE_URL || // set this in Vercel if you have a custom domain
      (req.headers['x-forwarded-proto'] ? `${req.headers['x-forwarded-proto']}://${req.headers.host}` : `https://${req.headers.host}`);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,
      allow_promotion_codes: true,
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cart.html`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    const msg = err?.message || 'Checkout error';
    return res.status(500).json({ error: msg });
  }
};

// api/stripe/connect_onboard.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Create a new Express connected account for a seller
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',               // adjust if you need other countries
      business_type: 'individual', // or 'company'
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true }
      }
    });

    return res.status(200).json({ accountId: account.id });
  } catch (err) {
    console.error('Stripe connect error:', err);
    return res.status(500).json({ error: err.message });
  }
}

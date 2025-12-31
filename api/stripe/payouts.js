// api/stripe/payouts.js
// Returns recent payouts for a connected account (Stripe Connect).
// Usage: GET /api/stripe/payouts?account=acct_123&limit=20
// Env: STRIPE_SECRET_KEY

import Stripe from 'stripe';

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const account = (req.query.account || '').toString().trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const starting_after = req.query.starting_after || undefined;

    if (!account || !account.startsWith('acct_')) {
      return res.status(400).json({ error: 'Missing or invalid `account` (acct_...)' });
    }

    // List payouts (most recent first)
    const payouts = await stripe.payouts.list(
      { limit, ...(starting_after ? { starting_after } : {}) },
      { stripeAccount: account }
    );

    // Light-weight payload for the UI
    const data = payouts.data.map(p => ({
      id: p.id,
      amount: p.amount,
      currency: p.currency,
      status: p.status,              // paid | pending | in_transit | canceled | failed
      method: p.method,              // standard | instant
      arrival_date: p.arrival_date,  // epoch seconds
      created: p.created,
      statement_descriptor: p.statement_descriptor || null,
      balance_transaction: p.balance_transaction || null,
    }));

    return res.status(200).json({
      account,
      has_more: payouts.has_more,
      data,
    });
  } catch (err) {
    console.error('stripe payouts error:', err);
    return res.status(500).json({ error: 'Unable to fetch payouts' });
  }
}

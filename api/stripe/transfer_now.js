// api/stripe/transfer_now.js
// Creates a Stripe Transfer from the platform to a connected account.
// POST { account: 'acct_xxx', amount_cents: 1234, order_id?: 'HM-123', memo?: '...' }
// Env: STRIPE_SECRET_KEY

import Stripe from 'stripe';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-07-30.basil',
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { account, amount_cents, order_id, memo } = req.body || {};
    if (!account || typeof account !== 'string' || !account.startsWith('acct_'))
      return res.status(400).json({ error: 'Invalid `account` (acct_...)' });

    const amt = Number(amount_cents);
    if (!Number.isFinite(amt) || amt <= 0)
      return res.status(400).json({ error: 'Invalid `amount_cents` (> 0 required)' });

    const transfer = await stripe.transfers.create({
      amount: Math.round(amt),
      currency: 'usd',
      destination: account,
      metadata: {
        source: 'hemline_market',
        order_id: order_id || '',
        memo: memo || '',
      },
    });

    return res.status(200).json({
      ok: true,
      id: transfer.id,
      status: transfer.status, // paid | pending | failed
      amount: transfer.amount,
      destination: transfer.destination,
    });
  } catch (err) {
    console.error('transfer_now error:', err);
    return res.status(500).json({ error: 'Unable to create transfer' });
  }
}

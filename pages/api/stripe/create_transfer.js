// File: /pages/api/stripe/create_transfer.js
// Creates a Stripe Transfer to a connected account
// ENV required: STRIPE_SECRET_KEY

import Stripe from 'stripe';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-07-30.basil',
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { account, amount_cents, order_id, metadata } = req.body || {};

    if (!account || !amount_cents || amount_cents <= 0) {
      return res.status(400).json({ error: 'Missing or invalid parameters' });
    }

    const transfer = await stripe.transfers.create({
      amount: Math.floor(amount_cents),
      currency: 'usd',
      destination: account,
      transfer_group: order_id || undefined,
      metadata: metadata || {},
    });

    return res.status(200).json(transfer);
  } catch (err) {
    console.error('create_transfer error:', err);
    return res.status(500).json({ error: 'Unable to create transfer' });
  }
}

// api/stripe/create_transfer.js
// Sends a payout to a connected account by creating a Stripe Transfer
// ENV: STRIPE_SECRET_KEY
//
// POST JSON:
// {
//   "account": "acct_123...",
//   "amount_cents": 12345,        // required, integer USD cents
//   "order_id": "HM-291362",      // required, used for transfer_group/description
//   "metadata": { "sellerId":"...", "note":"..." } // optional
// }
//
// Notes:
// - This assumes your Checkout payment settled to the PLATFORM balance.
// - On success we return { id, status } from the Transfer.
//
// Security tip: gate this endpoint behind auth/role checks in production.

import Stripe from 'stripe';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-07-30.basil',
});

function bad(res, code, msg) {
  return res.status(code).json({ error: msg });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return bad(res, 405, 'Method Not Allowed');
  }

  try {
    const { account, amount_cents, order_id, metadata = {} } = req.body || {};

    // Basic validation
    if (!account || typeof account !== 'string' || !account.startsWith('acct_')) {
      return bad(res, 400, 'Invalid or missing "account" (acct_...)');
    }
    const amount = Number(amount_cents);
    if (!Number.isInteger(amount) || amount <= 0) {
      return bad(res, 400, 'Invalid or missing "amount_cents" (> 0 integer)');
    }
    if (!order_id || typeof order_id !== 'string') {
      return bad(res, 400, 'Missing "order_id"');
    }

    // Optional: idempotency based on order+account to prevent double pay
    const idemKey = `transfer:${order_id}:${account}:${amount}`;

    const transfer = await stripe.transfers.create(
      {
        amount,
        currency: 'usd',
        destination: account,
        description: `Hemline order ${order_id}`,
        transfer_group: order_id,
        metadata,
      },
      { idempotencyKey: idemKey }
    );

    return res.status(200).json({
      id: transfer.id,
      status: transfer.status,
      amount: transfer.amount,
      destination: transfer.destination,
      created: transfer.created,
    });
  } catch (err) {
    console.error('create_transfer error:', err);
    return bad(res, 500, 'Unable to create transfer');
  }
}

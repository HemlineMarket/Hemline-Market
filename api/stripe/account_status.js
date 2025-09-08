// Returns the seller’s Stripe Connect account status for the Payouts page.
// ENV required: STRIPE_SECRET_KEY
//
// How it finds the account to look up (any one works):
//  1) Query string:   /api/stripe/account_status?account=acct_123
//  2) Header:         x-stripe-account: acct_123
//  3) Body (POST/GET w/ JSON): { "account": "acct_123" }
// If none provided, we return a helpful “not connected” payload (200).

import Stripe from 'stripe';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-07-30.basil', // keep consistent with your other files
});

function getAccountId(req) {
  // Accept from query, header, or JSON body
  const q = (req.query?.account || '').toString().trim();
  if (q) return q;
  const h = (req.headers['x-stripe-account'] || '').toString().trim();
  if (h) return h;
  try {
    if (req.body && typeof req.body === 'object') {
      const b = (req.body.account || '').toString().trim();
      if (b) return b;
    }
  } catch {}
  return '';
}

export default async function handler(req, res) {
  try {
    const accountId = getAccountId(req);

    // If we weren't given an account id, respond with a friendly “not connected”.
    if (!accountId) {
      return res.status(200).json({
        account: null,
        charges_enabled: false,
        payouts_enabled: false,
        requirements: ['Connect account not linked'],
      });
    }

    // Fetch the connected account
    const acct = await stripe.accounts.retrieve(accountId);

    // Collect requirement hints (only the ones that matter)
    const reqs = new Set();
    const r = acct.requirements || {};
    (r.currently_due || []).forEach((x) => reqs.add(x));
    (r.past_due || []).forEach((x) => reqs.add(x));
    (r.eventually_due || []).forEach((x) => reqs.add(x));
    const requirements = Array.from(reqs);

    return res.status(200).json({
      account: acct.id,
      details_submitted: !!acct.details_submitted,
      charges_enabled: !!acct.charges_enabled,
      payouts_enabled: !!acct.payouts_enabled,
      requirements,
    });
  } catch (err) {
    console.error('account_status error:', err);
    // Don’t leak details; return a safe payload so UI can still render
    return res.status(200).json({
      account: null,
      charges_enabled: false,
      payouts_enabled: false,
      requirements: ['Unable to load account'],
    });
  }
}

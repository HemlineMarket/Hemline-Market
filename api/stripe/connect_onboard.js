// /api/stripe/connect_onboard.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = (typeof req.body === 'string') ? JSON.parse(req.body || '{}') : (req.body || {});
    const return_url = body.return_url || `${getOrigin(req)}/dashboard.html`;
    const refresh_url = body.refresh_url || `${getOrigin(req)}/dashboard.html`;

    // 1) Create an Express connected account for the seller
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',          // adjust if you’ll support others
      business_type: 'individual', // or 'company'
      capabilities: {
        card_payments: { requested: true },
        transfers:     { requested: true },
      },
    });

    // TODO: persist `account.id` mapped to your user in your DB

    // 2) Create an onboarding link for that account
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      type: 'account_onboarding',
      return_url,
      refresh_url,
    });

    return res.status(200).json({ url: accountLink.url, accountId: account.id });
  } catch (err) {
    console.error('Stripe connect error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}

// Helper to build absolute URLs if the client didn’t send them
function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host']  || req.headers.host || '';
  return `${proto}://${host}`;
}

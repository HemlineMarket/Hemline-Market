// /api/stripe/connect_onboard.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { user_id } = body;
    const return_url = body.return_url || `${getOrigin(req)}/dashboard.html`;
    const refresh_url = body.refresh_url || `${getOrigin(req)}/dashboard.html`;

    if (!user_id) {
      return res.status(400).json({ error: 'Missing user_id' });
    }

    // 1) Create Stripe connected account
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      business_type: 'individual',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });

    // 2) Save Stripe account ID into Supabase profiles table
    await supabase
      .from('profiles')
      .update({ stripe_account_id: account.id })
      .eq('id', user_id);

    // 3) Create onboarding link for that account
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      type: 'account_onboarding',
      return_url,
      refresh_url,
    });

    return res.status(200).json({
      url: accountLink.url,
      accountId: account.id,
    });
  } catch (err) {
    console.error('Stripe connect error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}

// helper
function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['host'];
  return `${proto}://${host}`;
}

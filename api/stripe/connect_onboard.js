// FILE: api/stripe/connect_onboard.js
// REPLACE your existing file with this entire file
//
// FIXES:
// - Added authentication - only lets users create Stripe accounts for themselves
// - Prevents attackers from hijacking other users' payment setup

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['host'];
  return `${proto}://${host}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // REQUIRE AUTHENTICATION
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Please sign in to set up payments'
    });
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = getSupabaseAdmin();

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  
  if (authError || !user) {
    return res.status(401).json({ 
      error: 'Invalid session',
      message: 'Please sign in again'
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    
    // Always use the authenticated user's ID (ignore body.user_id)
    const user_id = user.id;
    
    if (body.user_id && body.user_id !== user_id) {
      return res.status(403).json({ 
        error: 'Forbidden',
        message: 'You can only set up payments for your own account'
      });
    }

    const return_url = body.return_url || `${getOrigin(req)}/account.html`;
    const refresh_url = body.refresh_url || `${getOrigin(req)}/account.html`;

    // Check if user already has a Stripe account
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_account_id')
      .eq('id', user_id)
      .maybeSingle();

    if (profile?.stripe_account_id) {
      try {
        const loginLink = await stripe.accounts.createLoginLink(profile.stripe_account_id);
        return res.status(200).json({
          url: loginLink.url,
          accountId: profile.stripe_account_id,
          existing: true,
        });
      } catch (loginErr) {
        console.log('Login link failed, will create new onboarding link');
      }
    }

    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      business_type: 'individual',
      email: user.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: {
        hemline_user_id: user_id,
      },
    });

    await supabase
      .from('profiles')
      .update({ stripe_account_id: account.id })
      .eq('id', user_id);

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
    return res.status(500).json({ 
      error: 'Setup failed',
      message: err.message || 'Could not set up payment account'
    });
  }
}

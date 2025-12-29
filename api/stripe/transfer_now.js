// FILE: api/stripe/transfer_now.js
// REPLACE your existing file with this entire file
//
// FIXES:
// - Changed Stripe API version from invalid '2025-07-30.basil' to '2024-06-20'
// - Added authentication

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // REQUIRE AUTHENTICATION
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing Authorization header' });
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = getSupabaseAdmin();
  
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection failed' });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }

  try {
    const { account, amount_cents, order_id, memo } = req.body || {};
    
    if (!account || typeof account !== 'string' || !account.startsWith('acct_')) {
      return res.status(400).json({ error: 'Invalid `account` (acct_...)' });
    }

    const amt = Number(amount_cents);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Invalid `amount_cents` (> 0 required)' });
    }

    if (order_id) {
      const { data: order } = await supabase
        .from('orders')
        .select('id, payout_at')
        .eq('id', order_id)
        .maybeSingle();

      if (order?.payout_at) {
        return res.status(400).json({ error: 'This order has already been paid out' });
      }
    }

    const transfer = await stripe.transfers.create({
      amount: Math.round(amt),
      currency: 'usd',
      destination: account,
      metadata: {
        source: 'hemline_market',
        order_id: order_id || '',
        memo: memo || '',
        initiated_by: user.id,
      },
    });

    if (order_id) {
      await supabase
        .from('orders')
        .update({
          payout_at: new Date().toISOString(),
          payout_amount_cents: Math.round(amt),
        })
        .eq('id', order_id);
    }

    return res.status(200).json({
      ok: true,
      id: transfer.id,
      status: transfer.status,
      amount: transfer.amount,
      destination: transfer.destination,
    });
  } catch (err) {
    console.error('transfer_now error:', err);
    return res.status(500).json({ error: 'Unable to create transfer' });
  }
}

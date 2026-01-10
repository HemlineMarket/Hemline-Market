// FILE: api/stripe/transfer_now.js
// Credits seller's wallet instead of direct Stripe transfer
// Use this for manual payouts - credits wallet, seller can then withdraw

import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Credit seller's wallet using the wallet API
async function creditSellerWallet(sellerId, amountCents, orderId, description) {
  const baseUrl = process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}` 
    : process.env.NEXT_PUBLIC_SITE_URL || 'https://hemlinemarket.com';
  
  const response = await fetch(`${baseUrl}/api/wallet/credit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': process.env.INTERNAL_WEBHOOK_SECRET
    },
    body: JSON.stringify({
      seller_id: sellerId,
      amount_cents: amountCents,
      order_id: orderId,
      description: description || 'Sale proceeds'
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Wallet credit failed: ${response.status}`);
  }

  return response.json();
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
    const { seller_id, amount_cents, order_id, memo } = req.body || {};
    
    if (!seller_id) {
      return res.status(400).json({ error: 'Missing seller_id' });
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

    // Credit wallet instead of direct Stripe transfer
    const walletResult = await creditSellerWallet(
      seller_id,
      Math.round(amt),
      order_id,
      memo || 'Manual payout'
    );

    if (order_id) {
      await supabase
        .from('orders')
        .update({
          payout_at: new Date().toISOString(),
          payout_amount_cents: Math.round(amt),
          wallet_transaction_id: walletResult.transaction_id,
        })
        .eq('id', order_id);
    }

    return res.status(200).json({
      ok: true,
      id: walletResult.transaction_id,
      status: 'completed',
      amount: Math.round(amt),
      destination: 'wallet',
      new_balance_cents: walletResult.new_balance_cents,
    });
  } catch (err) {
    console.error('transfer_now error:', err);
    return res.status(500).json({ error: 'Unable to create transfer: ' + err.message });
  }
}

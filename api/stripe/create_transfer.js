// FILE: api/stripe/create_transfer.js
// Credits seller's wallet instead of direct Stripe transfer
// This is now a legacy endpoint - kept for backwards compatibility
// The actual payout flow goes through wallet credit

import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function bad(res, code, msg) {
  return res.status(code).json({ error: msg });
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
    return bad(res, 405, 'Method Not Allowed');
  }

  // REQUIRE AUTHENTICATION
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return bad(res, 401, 'Unauthorized: Missing Authorization header');
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = getSupabaseAdmin();
  
  if (!supabase) {
    return bad(res, 500, 'Database connection failed');
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  
  if (authError || !user) {
    return bad(res, 401, 'Unauthorized: Invalid token');
  }

  try {
    const { amount_cents, order_id, metadata = {} } = req.body || {};

    const amount = Number(amount_cents);
    if (!Number.isInteger(amount) || amount <= 0) {
      return bad(res, 400, 'Invalid or missing "amount_cents" (> 0 integer)');
    }
    if (!order_id || typeof order_id !== 'string') {
      return bad(res, 400, 'Missing "order_id"');
    }

    // Verify order exists and is delivered
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, status, seller_id, payout_at, listing_title')
      .eq('id', order_id)
      .maybeSingle();

    if (orderError || !order) {
      return bad(res, 404, 'Order not found');
    }

    if (order.status !== 'DELIVERED' && order.status !== 'COMPLETE') {
      return bad(res, 400, `Order must be DELIVERED to transfer. Current status: ${order.status}`);
    }

    if (order.payout_at) {
      return bad(res, 400, 'This order has already been paid out');
    }

    // Credit seller's wallet instead of Stripe transfer
    const walletResult = await creditSellerWallet(
      order.seller_id,
      amount,
      order_id,
      metadata.description || `Sale: ${order.listing_title || 'Order'}`
    );

    // Mark order as paid out
    await supabase
      .from('orders')
      .update({
        payout_at: new Date().toISOString(),
        payout_amount_cents: amount,
        status: 'COMPLETE',
        wallet_transaction_id: walletResult.transaction_id,
      })
      .eq('id', order_id);

    return res.status(200).json({
      id: walletResult.transaction_id,
      status: 'completed',
      amount: amount,
      destination: 'wallet',
      wallet_id: walletResult.wallet_id,
      new_balance_cents: walletResult.new_balance_cents,
    });
  } catch (err) {
    console.error('create_transfer error:', err);
    return bad(res, 500, 'Unable to create transfer: ' + err.message);
  }
}

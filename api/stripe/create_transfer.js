// FILE: api/stripe/create_transfer.js
// REPLACE your existing file with this entire file
//
// FIXES:
// - Changed Stripe API version from invalid '2025-07-30.basil' to '2024-06-20'
// - Added authentication so only logged-in users can access
// - Verifies order exists before allowing transfer

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

function bad(res, code, msg) {
  return res.status(code).json({ error: msg });
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
    const { account, amount_cents, order_id, metadata = {} } = req.body || {};

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

    // Verify order exists and is delivered
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, status, seller_id, payout_at')
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

    const idemKey = `transfer:${order_id}:${account}:${amount}`;

    const transfer = await stripe.transfers.create(
      {
        amount,
        currency: 'usd',
        destination: account,
        description: `Hemline order ${order_id}`,
        transfer_group: order_id,
        metadata: {
          ...metadata,
          order_id,
          initiated_by: user.id,
        },
      },
      { idempotencyKey: idemKey }
    );

    // Mark order as paid out
    await supabase
      .from('orders')
      .update({
        payout_at: new Date().toISOString(),
        payout_amount_cents: amount,
        status: 'COMPLETE',
      })
      .eq('id', order_id);

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

// FILE: api/stripe/payouts.js
// FIX: Added JWT authentication - users can only access their own Stripe account (BUG #13)
// Returns recent payouts for a connected account (Stripe Connect).
// Usage: GET /api/stripe/payouts?limit=20
//
// CHANGE: Now requires valid JWT token, account derived from user's profile (not query param)
//
// Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import Stripe from 'stripe';
import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } };

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

async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  const supabase = getSupabaseAdmin();

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return null;
  }

  return user;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // FIX: Require authentication
    const user = await verifyAuth(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const supabase = getSupabaseAdmin();

    // FIX: Get account from user's profile, not query param
    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profErr) {
      console.error("[stripe/payouts] profiles error:", profErr);
      return res.status(500).json({ error: "Database error" });
    }

    const account = profile?.stripe_account_id;
    if (!account || !account.startsWith('acct_')) {
      return res.status(400).json({ error: 'No Stripe connected account found' });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const starting_after = req.query.starting_after || undefined;

    // List payouts (most recent first)
    const payouts = await stripe.payouts.list(
      { limit, ...(starting_after ? { starting_after } : {}) },
      { stripeAccount: account }
    );

    // Light-weight payload for the UI
    const data = payouts.data.map(p => ({
      id: p.id,
      amount: p.amount,
      currency: p.currency,
      status: p.status,              // paid | pending | in_transit | canceled | failed
      method: p.method,              // standard | instant
      arrival_date: p.arrival_date,  // epoch seconds
      created: p.created,
      statement_descriptor: p.statement_descriptor || null,
      balance_transaction: p.balance_transaction || null,
    }));

    return res.status(200).json({
      account,
      has_more: payouts.has_more,
      data,
    });
  } catch (err) {
    console.error('stripe payouts error:', err);
    return res.status(500).json({ error: 'Unable to fetch payouts' });
  }
}

// FILE: api/stripe/account_status.js
// FIX: Added JWT authentication - users can only access their own account status (BUG #14)
// Returns the seller's Stripe Connect account status for the Payouts page.
//
// CHANGE: Now requires valid JWT token, account derived from user's profile
//
// ENV required: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import Stripe from 'stripe';
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

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
  try {
    // FIX: Require authentication
    const user = await verifyAuth(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const supabase = getSupabaseAdmin();

    // FIX: Get account from user's profile, not query/header/body
    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profErr) {
      console.error("[stripe/account_status] profiles error:", profErr);
      return res.status(500).json({ error: "Database error" });
    }

    const accountId = profile?.stripe_account_id;

    // If no account linked, respond with "not connected"
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
    // Don't leak details; return a safe payload so UI can still render
    return res.status(200).json({
      account: null,
      charges_enabled: false,
      payouts_enabled: false,
      requirements: ['Unable to load account'],
    });
  }
}

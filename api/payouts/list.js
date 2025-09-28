// File: /api/payouts/list.js
// Returns recent Stripe Payouts for a seller's connected account.
// GET /api/payouts/list?user_id=<profiles.id>&limit=10
//
// Env required: STRIPE_SECRET_KEY, SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const user_id = String(req.query.user_id || "").trim();
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));

    if (!user_id) {
      return res.status(400).json({ error: "Missing user_id" });
    }

    // Look up the seller's connected account id
    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("stripe_account_id, payouts_enabled, email")
      .eq("id", user_id)
      .maybeSingle();

    if (profErr) {
      console.error("[payouts/list] profiles error:", profErr);
      return res.status(500).json({ error: "Database error" });
    }
    if (!profile?.stripe_account_id) {
      return res.status(400).json({ error: "Seller has no Stripe connected account" });
    }

    // Fetch payouts from the connected account
    const payouts = await stripe.payouts.list(
      { limit },
      { stripeAccount: profile.stripe_account_id }
    );

    const simplified = (payouts?.data || []).map((p) => ({
      id: p.id,
      amount: p.amount,                 // in cents
      currency: p.currency,
      status: p.status,                 // paid | pending | in_transit | canceled | failed
      arrival_date: p.arrival_date,     // unix timestamp
      created: p.created,               // unix timestamp
      method: p.method,                 // standard | instant
      type: p.type,                     // bank_account | card
      description: p.description || null,
      statement_descriptor: p.statement_descriptor || null,
      failure_code: p.failure_code || null,
      failure_message: p.failure_message || null,
    }));

    return res.status(200).json({
      user_id,
      stripe_account_id: profile.stripe_account_id,
      payouts_enabled: !!profile.payouts_enabled,
      count: simplified.length,
      data: simplified,
      has_more: !!payouts.has_more,
    });
  } catch (err) {
    console.error("[payouts/list] error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

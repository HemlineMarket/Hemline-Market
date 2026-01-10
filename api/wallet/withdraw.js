import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.stripe_account_id) {
      return res.status(400).json({ 
        error: "No connected bank account. Please complete seller setup first." 
      });
    }

    const { data: wallet, error: walletError } = await supabaseAdmin
      .from("wallets")
      .select("id, balance_cents")
      .eq("user_id", user.id)
      .single();

    if (walletError || !wallet) {
      return res.status(400).json({ error: "No balance to withdraw" });
    }

    if (wallet.balance_cents < 100) {
      return res.status(400).json({ error: "Minimum withdrawal is $1.00" });
    }

    const withdrawAmount = wallet.balance_cents;

    const transfer = await stripe.transfers.create({
      amount: withdrawAmount,
      currency: "usd",
      destination: profile.stripe_account_id,
      description: "Hemline Market earnings withdrawal",
      metadata: {
        user_id: user.id,
        wallet_id: wallet.id
      }
    });

    const { error: updateError } = await supabaseAdmin
      .from("wallets")
      .update({ 
        balance_cents: 0,
        updated_at: new Date().toISOString()
      })
      .eq("id", wallet.id);

    if (updateError) {
      console.error("CRITICAL: Transfer succeeded but wallet update failed", {
        transfer_id: transfer.id,
        user_id: user.id,
        amount: withdrawAmount
      });
    }

    await supabaseAdmin.from("wallet_transactions").insert({
      wallet_id: wallet.id,
      user_id: user.id,
      amount_cents: -withdrawAmount,
      type: "withdrawal",
      description: "Withdrawal to bank account",
      stripe_transfer_id: transfer.id
    });

    return res.status(200).json({
      success: true,
      transfer_id: transfer.id,
      amount_cents: withdrawAmount,
      amount_dollars: (withdrawAmount / 100).toFixed(2),
      message: "Withdrawal complete! Funds arrive in 2-3 business days."
    });

  } catch (err) {
    console.error("Wallet withdraw error:", err);
    
    if (err.type === "StripeInvalidRequestError") {
      return res.status(400).json({ error: err.message });
    }
    
    return res.status(500).json({ error: "Internal server error" });
  }
}

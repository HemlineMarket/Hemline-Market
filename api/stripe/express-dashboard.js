// api/stripe/express-dashboard.js
// Returns a Stripe Express login link for the SELLER'S individual account
// (NOT the platform's business account)
//
// FIXED: Now fetches the user's stripe_account_id from their profile
// instead of using the platform's STRIPE_CONNECT_ACCOUNT_ID

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

/**
 * POST /api/stripe/express-dashboard
 * 
 * Requires Authorization header with user's JWT token.
 * Returns a login link to the user's Stripe Express dashboard.
 *
 * Response: { url: "https://connect.stripe.com/..." }
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Require authentication
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Please sign in to manage your Stripe account",
    });
  }

  const token = authHeader.replace("Bearer ", "");
  const supabase = getSupabaseAdmin();

  try {
    // Verify the user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({
        error: "Invalid session",
        message: "Please sign in again",
      });
    }

    // Get the user's Stripe account ID from their profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("[express-dashboard] Profile fetch error:", profileError);
      return res.status(500).json({
        error: "Could not load profile",
      });
    }

    if (!profile?.stripe_account_id) {
      return res.status(400).json({
        error: "No Stripe account",
        message: "Please set up your Stripe account first",
        needsOnboarding: true,
      });
    }

    // Create a login link for the USER'S Stripe Express account
    const origin = req.headers.origin || `https://${req.headers.host || "hemlinemarket.com"}`;
    
    const loginLink = await stripe.accounts.createLoginLink(
      profile.stripe_account_id,  // <-- User's account, NOT platform account
      {
        redirect_url: `${origin}/account.html`,
      }
    );

    return res.status(200).json({ url: loginLink.url });

  } catch (err) {
    console.error("[express-dashboard] Error:", err);
    
    // Handle specific Stripe errors
    if (err.type === "StripeInvalidRequestError") {
      if (err.message?.includes("cannot create a login link")) {
        return res.status(400).json({
          error: "Account not ready",
          message: "Your Stripe account needs additional setup. Please complete onboarding first.",
          needsOnboarding: true,
        });
      }
    }

    return res.status(500).json({
      error: "Unable to create Stripe dashboard link",
      message: err.message || "Please try again",
    });
  }
}

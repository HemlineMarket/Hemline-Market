// api/stripe/express-dashboard.js
// Returns a Stripe Express/Connect dashboard login link for your platform account.

import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const connectAccountId = process.env.STRIPE_CONNECT_ACCOUNT_ID || ""; // e.g. acct_123...

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2024-06-20",
});

/**
 * POST /api/stripe/express-dashboard
 *
 * Response: { url: "https://connect.stripe.com/..." }
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!stripeSecretKey || !connectAccountId) {
    console.error(
      "[express-dashboard] Missing STRIPE_SECRET_KEY or STRIPE_CONNECT_ACCOUNT_ID env vars"
    );
    return res
      .status(500)
      .json({ error: "Stripe account is not configured on the server." });
  }

  try {
    const origin =
      req.headers.origin ||
      `https://${req.headers.host || "hemlinemarket.com"}`;

    const loginLink = await stripe.accounts.createLoginLink(
      connectAccountId,
      {
        // Where Stripe sends you back after leaving the dashboard
        redirect_url: `${origin}/account.html`,
      }
    );

    return res.status(200).json({ url: loginLink.url });
  } catch (err) {
    console.error("[express-dashboard] Error creating login link:", err);
    return res
      .status(500)
      .json({ error: "Unable to create Stripe dashboard link." });
  }
}

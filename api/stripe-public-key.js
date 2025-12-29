// File: api/stripe-public-key.js
// Returns the Stripe publishable key to the frontend

export default function handler(req, res) {
  // Only allow GET
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Grab publishable key from env
  const pk =
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    process.env.STRIPE_PUBLISHABLE_KEY;

  if (!pk) {
    return res.status(500).json({ error: "Missing publishable key" });
  }

  // Return the key (works for both test and live)
  return res.status(200).json({ publishableKey: pk });
}

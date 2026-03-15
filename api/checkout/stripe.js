// FILE: api/checkout/stripe.js
//
// NOTE: This is the OLD checkout endpoint. The active checkout endpoint is:
//   api/stripe/create_session.js
//
// This file was discovered to never pass metadata to Stripe, which would cause
// the webhook to create orders with all null values. It is kept here (rather
// than deleted) to avoid a 404 for any stale references, but it now redirects
// to the correct endpoint.
//
// DO NOT add real checkout logic here. Use api/stripe/create_session.js instead.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Forward the request body to the correct endpoint
  try {
    const origin =
      process.env.SITE_URL ||
      (req.headers["x-forwarded-proto"]
        ? `${req.headers["x-forwarded-proto"]}://${req.headers.host}`
        : `https://${req.headers.host}`);

    const upstream = await fetch(`${origin}/api/stripe/create_session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}),
    });

    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error("[checkout/stripe] proxy error:", err);
    return res.status(500).json({ error: "Checkout failed. Please try again." });
  }
}

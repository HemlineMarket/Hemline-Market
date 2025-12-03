// File: /api/orders/cancel_window.js
// Returns whether the 30-minute cancellation window is over.
// Requires Stripe because we read the real checkout session.timestamp.

import Stripe from "stripe";

export const config = {
  api: { bodyParser: false },
};

const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  throw new Error("STRIPE_SECRET_KEY is missing");
}

const stripe = new Stripe(stripeSecret);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const sessionId = (req.query.sid || "").trim();
  if (!sessionId) {
    return res.status(400).json({ error: "Missing sid (checkout session id)" });
  }

  try {
    // Pull session direct from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const createdTs = session.created * 1000; // seconds → ms
    const now = Date.now();
    const diffMs = now - createdTs;

    const CANCEL_WINDOW_MS = 30 * 60 * 1000;
    const isOver = diffMs >= CANCEL_WINDOW_MS;

    return res.status(200).json({
      sessionId,
      created: new Date(createdTs).toISOString(),
      now: new Date(now).toISOString(),
      diffMs,
      canShip: isOver,
      cancelWindowMinutes: 30,
    });
  } catch (err) {
    console.error("cancel_window error:", err?.message || err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

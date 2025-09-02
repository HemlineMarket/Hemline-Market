// Vercel Serverless Function for Stripe webhooks

import Stripe from "stripe";

export const config = {
  api: { bodyParser: false }, // IMPORTANT: we need the raw body for signature verification
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-07-30.basil",
});

// read raw bytes from the incoming request
async function readBuffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  let event;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  try {
    const rawBody = await readBuffer(req);
    const signature = req.headers["stripe-signature"];

    if (webhookSecret) {
      // verify this really came from Stripe
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } else {
      // fallback (not recommended in prod)
      event = JSON.parse(rawBody.toString());
    }
  } catch (err) {
    console.error("❌ Webhook verification failed", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        // TODO: mark order paid / fulfill / email, etc.
        // Examples you can access:
        // session.id, session.mode, session.amount_total, session.currency,
        // session.customer_email
        console.log("✅ Checkout complete:", session.id, session.customer_email);
        break;
      }

      case "payment_intent.succeeded": {
        const pi = event.data.object;
        console.log("✅ Payment intent succeeded:", pi.id);
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object;
        console.warn("⚠️ Payment intent failed:", pi.id, pi.last_payment_error?.message);
        break;
      }

      default:
        // Keep an eye on what else arrives
        console.log("ℹ️ Unhandled event:", event.type);
    }

    // Tell Stripe we received and processed the event
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("❌ Webhook handler error:", err);
    return res.status(500).send("Webhook handler error");
  }
}

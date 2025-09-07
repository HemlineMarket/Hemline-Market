// /api/stripe/webhook.js
// Receives Stripe events (Connect + payments). Acknowledge fast.
// If STRIPE_WEBHOOK_SECRET is set, we verify signatures; otherwise we accept JSON (dev).

import Stripe from 'stripe';

export const config = {
  api: { bodyParser: false } // we need the raw body for signature verification
};

// helper to read raw body
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = [];
    req.on('data', chunk => data.push(chunk));
    req.on('end', () => resolve(Buffer.concat(data)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  const sigHeader = req.headers['stripe-signature'];
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  let event;

  try {
    if (whSecret) {
      const rawBody = await readRawBody(req);
      event = stripe.webhooks.constructEvent(rawBody, sigHeader, whSecret);
    } else {
      // dev fallback (no verification)
      const rawBody = await readRawBody(req);
      event = JSON.parse(rawBody.toString('utf8'));
    }
  } catch (err) {
    console.error('Stripe webhook verify/parse error:', err.message);
    return res.status(400).json({ error: `Invalid payload: ${err.message}` });
  }

  // Acknowledge first so Stripe stops retrying quickly
  res.status(200).json({ received: true });

  try {
    switch (event.type) {
      // Seller onboarding / payouts readiness
      case 'account.updated':
      case 'capabilities.updated': {
        const acct = event.data.object;
        const payoutsEnabled = !!acct.payouts_enabled;
        const detailsSubmitted = !!acct.details_submitted;
        console.log('[Stripe Connect]', event.type, {
          account: acct.id,
          payoutsEnabled,
          detailsSubmitted
        });
        // TODO: persist this to your DB (e.g., Supabase) keyed by seller
        break;
      }

      // Checkout / payments lifecycle (optional now; useful later)
      case 'checkout.session.completed': {
        const s = event.data.object;
        console.log('[Stripe]', event.type, { session: s.id, mode: s.mode, amount_total: s.amount_total });
        // TODO: mark order paid & store session id
        break;
      }
      case 'charge.succeeded':
      case 'transfer.created':
      case 'payout.paid':
      case 'payout.failed': {
        console.log('[Stripe]', event.type, { id: event.data.object.id });
        // TODO: update order/payout records accordingly
        break;
      }

      default:
        console.log('[Stripe] unhandled event:', event.type);
    }
  } catch (err) {
    // we already returned 200 — just log
    console.error('Post-ack webhook handler error:', err);
  }
}

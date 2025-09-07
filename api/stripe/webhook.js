// File: /api/stripe/webhook.js
// Verifies Stripe signatures and handles Connect/Checkout events.
// Requires env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

import Stripe from 'stripe';

// Important: let Stripe read the raw body for signature verification
export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-07-30.basil', // or your account default
});

function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let event;
  try {
    const buf = await buffer(req);
    const signature = req.headers['stripe-signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      // If you ever run without a secret, refuse; avoids noisy retries.
      return res.status(500).json({ error: 'Missing STRIPE_WEBHOOK_SECRET' });
    }
    event = stripe.webhooks.constructEvent(buf, signature, secret);
  } catch (err) {
    console.error('⚠️  Stripe signature verification failed:', err?.message || err);
    return res.status(400).send(`Webhook Error: ${err?.message || 'invalid signature'}`);
  }

  // Acknowledge ASAP so Stripe doesn’t retry
  res.status(200).json({ received: true });

  // ---- Non-blocking processing (logs + TODOs) ----
  try {
    const type = event.type;

    switch (type) {
      // Checkout
      case 'checkout.session.completed': {
        const s = event.data.object; // Checkout Session
        console.log('[stripe] checkout.session.completed', {
          id: s.id,
          payment_intent: s.payment_intent,
          customer: s.customer,
          amount_total: s.amount_total,
          mode: s.mode,
          metadata: s.metadata || {},
        });
        // TODO: mark order as PAID in DB by your session/order id
        // TODO: create per-seller ledger rows; queue label creation
        break;
      }
      case 'checkout.session.expired': {
        const s = event.data.object;
        console.log('[stripe] checkout.session.expired', { id: s.id });
        // TODO: release any reservations/locks you may have created
        break;
      }

      // PaymentIntent (extra safety)
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        console.log(`[stripe] ${type}`, {
          id: pi.id,
          status: pi.status,
          amount: pi.amount,
          metadata: pi.metadata || {},
        });
        // TODO: reconcile if needed
        break;
      }

      // Payouts (seller payouts lifecycle)
      case 'payout.created':
      case 'payout.paid':
      case 'payout.failed': {
        const p = event.data.object;
        console.log(`[stripe] ${type}`, {
          id: p.id,
          status: p.status,
          amount: p.amount,
          arrival_date: p.arrival_date,
        });
        // TODO: update seller payout history/status
        break;
      }

      // Transfers (platform → connected account)
      case 'transfer.created': {
        const t = event.data.object;
        console.log('[stripe] transfer.created', {
          id: t.id,
          amount: t.amount,
          destination: t.destination,
        });
        // TODO: record transfer id on your per-seller ledger entry
        break;
      }

      // Connect account + app auth changes
      case 'account.updated':
      case 'account.application.authorized':
      case 'account.application.deauthorized': {
        const acct = event.data.object;
        console.log(`[stripe] ${type}`, {
          account: acct?.id || event.account,
          details_submitted: acct?.details_submitted,
          charges_enabled: acct?.charges_enabled,
          payouts_enabled: acct?.payouts_enabled,
          requirements: acct?.requirements?.currently_due || [],
        });
        // TODO: persist account capability flags for the seller
        break;
      }

      default: {
        // Keep logging so we see unexpected events in prod
        console.log('[stripe] unhandled event', type);
      }
    }
  } catch (err) {
    // We already returned 200; just log for diagnostics
    console.error('Stripe webhook handler error:', err);
  }
}

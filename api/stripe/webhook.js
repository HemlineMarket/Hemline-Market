// Verifies Stripe signatures and pays out sellers via Transfers on successful checkout.
// ENV required: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
//
// IMPORTANT: this assumes the Checkout Session was created by your platform account
// (not a connected account), and that `metadata.sellers_json` is a JSON object where
// the KEYS are Stripe connected account IDs (e.g. "acct_123") and the VALUES are
// the amount (in CENTS) to send to that seller.
//
// Example sellers_json: {"acct_1Abc...": 1299, "acct_9Xyz...": 5400}

import Stripe from 'stripe';

// Let Stripe read the RAW body for signature verification
export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  // Use your account default if you prefer; keep consistent across your API
  apiVersion: '2025-07-30.basil',
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
    if (!secret) return res.status(500).json({ error: 'Missing STRIPE_WEBHOOK_SECRET' });
    event = stripe.webhooks.constructEvent(buf, signature, secret);
  } catch (err) {
    console.error('⚠️  Stripe signature verification failed:', err?.message || err);
    return res.status(400).send(`Webhook Error: ${err?.message || 'invalid signature'}`);
  }

  // Acknowledge immediately so Stripe doesn’t retry
  res.status(200).json({ received: true });

  // ---- Post-ack processing ---------------------------------------------------
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;

        // Pull amounts-by-seller from metadata
        let bySeller = {};
        try {
          bySeller = JSON.parse(session.metadata?.sellers_json || '{}');
        } catch (_) {
          bySeller = {};
        }

        // Nothing to do if we don't have any sellers
        const sellerIds = Object.keys(bySeller || {});
        if (!sellerIds.length) {
          console.log('[stripe] checkout.session.completed, no sellers_json present');
          break;
        }

        // Get the charge to fund the transfers (separate charges & transfers flow)
        // session.payment_intent may be an ID or an object depending on expand settings
        const piId = typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id;

        if (!piId) {
          console.warn('[stripe] Missing payment_intent on session; cannot create transfers.');
          break;
        }

        const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] });
        const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id;

        if (!chargeId) {
          console.warn('[stripe] Missing latest_charge on PI; cannot create transfers.');
          break;
        }

        // Create one Transfer per seller
        for (const acctId of sellerIds) {
          const amount = Math.max(0, Number(bySeller[acctId] || 0)); // cents
          if (!amount) continue;
          try {
            const tr = await stripe.transfers.create({
              amount,
              currency: 'usd',
              destination: acctId,             // connected account (acct_...)
              source_transaction: chargeId,    // fund transfer from this charge
              metadata: {
                checkout_session: session.id,
                subtotal_cents: String(session.amount_subtotal ?? ''),
                shipping_cents: session.metadata?.shipping_cents ?? '',
              },
            });
            console.log('[stripe] transfer.created', { id: tr.id, amount, destination: acctId });
          } catch (err) {
            console.error(`[stripe] transfer error for ${acctId}:`, err?.message || err);
            // Optional: queue a retry or alert ops here
          }
        }

        // TODO (optional): mark your order as PAID and TRANSFERS_CREATED in your DB.

        break;
      }

      case 'payout.paid':
      case 'payout.failed':
      case 'payout.created': {
        const p = event.data.object;
        console.log(`[stripe] ${event.type}`, {
          id: p.id, status: p.status, amount: p.amount, arrival_date: p.arrival_date,
        });
        // TODO (optional): update seller payout history/status in your DB
        break;
      }

      case 'account.updated':
      case 'account.application.authorized':
      case 'account.application.deauthorized': {
        const acct = event.data.object;
        console.log(`[stripe] ${event.type}`, {
          account: acct?.id || event.account,
          charges_enabled: acct?.charges_enabled,
          payouts_enabled: acct?.payouts_enabled,
          requirements_due: acct?.requirements?.currently_due || [],
        });
        // TODO (optional): persist capability flags for the seller in your DB
        break;
      }

      default:
        // Keep logging to see everything during launch
        console.log('[stripe] unhandled event:', event.type);
    }
  } catch (err) {
    // We already returned 200; just log for diagnostics
    console.error('Stripe webhook handler error:', err);
  }
}

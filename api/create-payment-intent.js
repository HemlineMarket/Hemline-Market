// /api/create-payment-intent.js
// Serverless function (Vercel style). Requires STRIPE_SECRET_KEY in env.
// POST body: { cart: Array<item> }
// item shape (from your frontend): {
//   name, amount (cents per unit), qty, yards?, sellerId?, sellerName?, photo?, perYd?
// }

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

// shipping tiers (cents)
function tierCents(yards) {
  if (yards < 3) return 500;
  if (yards <= 10) return 800;
  return 1500;
}

// qty counts as yards if item.yards is missing
function yardsForItem(it) {
  const qty = Number(it.qty || 1);
  if (it.yards !== undefined && it.yards !== null && it.yards !== '') {
    const y = Number(it.yards) || 0;
    return y * qty;
  }
  return qty; // fallback: 1 qty == 1 yd
}

function calcTotals(cart) {
  // subtotal
  let subtotal = 0;
  for (const it of cart) {
    const unit = Number(it.amount || 0);
    const qty = Number(it.qty || 1);
    if (!Number.isFinite(unit) || !Number.isFinite(qty) || unit < 0 || qty < 1) {
      throw new Error('Invalid cart line item.');
    }
    subtotal += unit * qty;
  }

  // shipping per seller by yards
  const groups = {};
  for (const it of cart) {
    const sellerId = it.sellerId || 'default_seller';
    const sellerName = it.sellerName || 'Seller';
    const yards = yardsForItem(it);
    if (!groups[sellerId]) groups[sellerId] = { name: sellerName, yards: 0 };
    groups[sellerId].yards += yards;
  }
  const lines = Object.values(groups).map((g) => ({
    sellerName: g.name,
    yards: g.yards,
    fee_cents: tierCents(g.yards),
  }));
  const shipping = lines.reduce((s, l) => s + l.fee_cents, 0);

  return { subtotal, shipping, total: subtotal + shipping, shipLines: lines };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { cart = [], email } = req.body || {};
    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: 'Cart is required' });
    }

    const totals = calcTotals(cart);

    // Create PaymentIntent in USD. Adjust currency if needed.
    const intent = await stripe.paymentIntents.create({
      amount: totals.total,
      currency: 'usd',
      receipt_email: email || undefined,
      automatic_payment_methods: { enabled: true },
      metadata: {
        subtotal_cents: String(totals.subtotal),
        shipping_cents: String(totals.shipping),
        ship_breakdown: JSON.stringify(
          totals.shipLines.map((l) => ({
            seller: l.sellerName,
            yards: Number(l.yards.toFixed(2)),
            fee_cents: l.fee_cents,
          }))
        ),
      },
    });

    return res.status(200).json({
      client_secret: intent.client_secret,
      totals, // useful for client sanity-check
    });
  } catch (err) {
    console.error('create-payment-intent error:', err);
    const msg =
      (err && err.message) || 'Failed to create PaymentIntent';
    return res.status(500).json({ error: msg });
  }
}

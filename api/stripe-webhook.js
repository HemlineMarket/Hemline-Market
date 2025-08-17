const Stripe = require('stripe');

// Vercel (Node) needs raw body for signature verification
// Disable body parsing:
module.exports.config = { api: { bodyParser: false } };

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  // --- Test bypass ---
  const bypassKey = req.headers['x-test-bypass'];
  if (bypassKey && bypassKey === process.env.TEST_WEBHOOK_BYPASS_KEY) {
    console.log('✅ Using TEST_WEBHOOK_BYPASS_KEY, simulating checkout.session.completed');
    // Fake a Stripe checkout.session.completed event
    req.body = {
      id: 'evt_test_bypass',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_bypass',
          payment_intent: 'pi_test_bypass',
          customer_details: { email: 'test-buyer@example.com' },
          metadata: {
            seller_id: '00000000-0000-0000-0000-000000000000',
            listing_id: '00000000-0000-0000-0000-000000000000',
            listing_snapshot: JSON.stringify({
              title: 'Test Fabric',
              price_cents: 1234
            })
          },
          amount_total: 1234,
          currency: 'usd'
        }
      }
    };
    req.headers['stripe-signature'] = ''; // skip verification
  }
  // --- End bypass ---

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let event;
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  try {
    const rawBody = await getRawBody(req);
    if (endpointSecret && sig) {
      event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
    } else if (req.body) {
      event = req.body; // bypass case
    } else {
      event = JSON.parse(rawBody.toString('utf8'));
    }
  } catch (err) {
    console.error('❌ Webhook signature/parse failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

// Stripe webhook for Hemline Market (CommonJS, Vercel-compatible)
// Allows a secure test bypass via header or query for GET requests.

const Stripe = require('stripe');

// IMPORTANT: Stripe signature verification needs the raw request body
module.exports.config = { api: { bodyParser: false } };

// Read raw bytes from the request stream
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  try {
    // Build URL safely for query parsing
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `https://${host}`);

    // Bypass secret may come from header OR query string (?x-test-bypass=...)
    const bypassFromHeader = req.headers['x-test-bypass'];
    const bypassFromQuery  = url.searchParams.get('x-test-bypass');
    const bypassSecret     = process.env.TEST_WEBHOOK_BYPASS_KEY || '';
    const isBypass         = !!bypassSecret && (bypassFromHeader === bypassSecret || bypassFromQuery === bypassSecret);

    // Allow GET only when using the bypass secret; otherwise require POST
    if (req.method !== 'POST' && !(req.method === 'GET' && isBypass)) {
      res.setHeader('Allow', 'POST, GET');
      return res.status(405).send('Method Not Allowed');
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    const sig = req.headers['stripe-signature'];

    let event = null;

    if (isBypass) {
      // Simulate a checkout.session.completed payload for testing
      event = {
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
              }),
              application_fee_amount: '0'
            },
            amount_total: 1234,
            currency: 'usd'
          }
        }
      };
    } else {
      // Normal Stripe path (POST) — verify signature if we have a signing secret
      const rawBody = await getRawBody(req);

      if (endpointSecret && sig) {
        try {
          event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
        } catch (err) {
          console.error('❌ Signature verification failed:', err.message);
          return res.status(400).send(`Webhook Error: ${err.message}`);
        }
      } else {
        // No signing secret yet: accept JSON for initial setup only
        try {
          event = JSON.parse(rawBody.toString('utf8'));
        } catch (err) {
          console.error('❌ JSON parse failed:', err.message);
          return res.status(400).send(`Parse Error: ${err.message}`);
        }
      }
    }

    // Handle successful checkout
    if (event && event.type === 'checkout.session.completed') {
      const session = event.data.object || {};

      const order = {
        stripe_event_id: event.id,
        stripe_payment_intent: session.payment_intent || null,
        stripe_checkout_session: session.id || null,
        buyer_email: (session.customer_details && session.customer_details.email) || null,
        buyer_id: null, // can be filled later via metadata (auth uid)
        seller_id: (session.metadata && session.metadata.seller_id) || null,
        listing_id: (session.metadata && session.metadata.listing_id) || null,
        listing_snapshot: (() => {
          try {
            if (session.metadata && session.metadata.listing_snapshot) {
              return JSON.parse(session.metadata.listing_snapshot);
            }
          } catch (_) {}
          return {}; // not null per schema
        })(),
        amount_total: typeof session.amount_total === 'number' ? session.amount_total : 0,
        application_fee_amount: Number(
          (session.metadata && session.metadata.application_fee_amount) || 0
        ),
        currency: (session.currency || 'usd').toLowerCase(),
        status: 'PAID'
      };

      // Write to Supabase using Service Role
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );

      const { error } = await supabase
        .from('orders')
        .upsert(order, { onConflict: 'stripe_event_id', ignoreDuplicates: true });

      if (error) {
        console.error('❌ Supabase upsert error:', error);
        return res.status(500).send('Database error');
      }

      console.log('✅ Order recorded:', order.stripe_checkout_session);
    }

    return res.status(200).send('[ok]');
  } catch (e) {
    console.error('❌ Uncaught webhook error:', e);
    return res.status(500).send('Internal error');
  }
};

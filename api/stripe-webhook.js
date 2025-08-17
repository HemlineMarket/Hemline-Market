// Stripe webhook for Hemline Market
// NOTE: We'll add STRIPE_WEBHOOK_SECRET in Vercel after we create the endpoint in Stripe.
// This function is safe for webhook retries (idempotent via stripe_event_id).

const Stripe = require('stripe');

// Vercel (Node) needs raw body for signature verification
// Disable body parsing:
module.exports.config = { api: { bodyParser: false } };

// Collect raw bytes from the request stream
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

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  let event;
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  try {
    const rawBody = await getRawBody(req);

    if (endpointSecret) {
      // Verify signature when we have the signing secret
      event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
    } else {
      // Fallback (temporary during setup): accept JSON without verification
      event = JSON.parse(rawBody.toString('utf8'));
    }
  } catch (err) {
    console.error('❌ Webhook signature/parse failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // We only care about successful checkouts for now
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // Optionally expand to fetch more details if needed
    // const fullSession = await stripe.checkout.sessions.retrieve(session.id, { expand: ['payment_intent'] });

    // Prepare order record
    const order = {
      stripe_event_id: event.id,
      stripe_payment_intent: session.payment_intent || null,
      stripe_checkout_session: session.id,
      buyer_email: session.customer_details?.email || null,
      buyer_id: null,    // fill later if you attach auth user id in metadata
      seller_id: session.metadata?.seller_id || null,
      listing_id: session.metadata?.listing_id || null,
      listing_snapshot: (() => {
        try {
          if (session.metadata?.listing_snapshot) {
            return JSON.parse(session.metadata.listing_snapshot);
          }
        } catch {}
        return {}; // not null per schema
      })(),
      amount_total: session.amount_total ?? 0,
      application_fee_amount: Number(session.metadata?.application_fee_amount ?? 0),
      currency: (session.currency || 'usd').toLowerCase(),
      status: 'PAID'
    };

    // Write to Supabase using the service role key
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Upsert using stripe_event_id to be idempotent
    const { error } = await supabase
      .from('orders')
      .upsert(order, { onConflict: 'stripe_event_id', ignoreDuplicates: true });

    if (error) {
      console.error('❌ Supabase upsert error:', error);
      return res.status(500).send('Database error');
    }

    console.log('✅ Order recorded:', order.stripe_checkout_session);
  }

  // You can add more event handlers later (refunds, etc.)
  return res.status(200).send('[ok]');
};

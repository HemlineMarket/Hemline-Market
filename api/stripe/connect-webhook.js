// File: api/stripe/connect-webhook.js
// Handles Stripe Connect account updates
// Marks seller as verified when charges_enabled becomes true
// This triggers the founding seller number assignment

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

export const config = {
  api: { bodyParser: false },
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];
  
  // Use STRIPE_CONNECT_WEBHOOK_SECRET for Connect events
  // Falls back to regular webhook secret if not set
  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const supabase = getSupabaseAdmin();

  // Handle account.updated events
  if (event.type === 'account.updated') {
    const account = event.data.object;
    const accountId = account.id;
    
    console.log(`Account updated: ${accountId}, charges_enabled: ${account.charges_enabled}`);

    // Only process if charges are now enabled
    if (account.charges_enabled) {
      try {
        // Find the user with this Stripe account
        const { data: profile, error: findError } = await supabase
          .from('profiles')
          .select('id, stripe_connect_verified, founding_seller_number')
          .eq('stripe_account_id', accountId)
          .maybeSingle();

        if (findError) {
          console.error('Error finding profile:', findError);
          return res.status(500).json({ error: 'Database error' });
        }

        if (!profile) {
          console.log(`No profile found for Stripe account ${accountId}`);
          return res.status(200).json({ received: true, message: 'No matching profile' });
        }

        // Skip if already verified
        if (profile.stripe_connect_verified) {
          console.log(`Profile ${profile.id} already verified`);
          return res.status(200).json({ received: true, message: 'Already verified' });
        }

        // Mark as verified - the database trigger will assign founding number and fee rate
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ 
            stripe_connect_verified: true,
            payouts_enabled: true
          })
          .eq('id', profile.id);

        if (updateError) {
          console.error('Error updating profile:', updateError);
          return res.status(500).json({ error: 'Failed to update profile' });
        }

        // Fetch the updated profile to get the assigned number
        const { data: updated } = await supabase
          .from('profiles')
          .select('founding_seller_number, fee_rate')
          .eq('id', profile.id)
          .single();

        console.log(`Seller verified! Profile: ${profile.id}, Founding #: ${updated?.founding_seller_number}, Fee: ${updated?.fee_rate}`);

        return res.status(200).json({ 
          received: true, 
          verified: true,
          founding_seller_number: updated?.founding_seller_number,
          fee_rate: updated?.fee_rate
        });

      } catch (err) {
        console.error('Error processing account.updated:', err);
        return res.status(500).json({ error: err.message });
      }
    }
  }

  // Return 200 for all other event types
  return res.status(200).json({ received: true });
}

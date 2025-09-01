// api/notify/create.js
import { createClient } from '@supabase/supabase-js';

/**
 * SECURE: uses SERVICE ROLE on server only (never expose to client).
 * Required env vars in your deploy:
 * - SUPABASE_URL=https://clkizksbvxjkoatdajgd.supabase.co
 * - SUPABASE_SERVICE_ROLE=*** your service role key ***
 */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  { auth: { persistSession: false } }
);

const TYPES = new Set(['like','order_paid','order_shipped','message','payout']);

export default async function handler(req, res) {
  // Only POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { user_id, type, title, body = null, link = null } = req.body || {};

    if (!user_id || !type || !title) {
      return res.status(400).json({ error: 'user_id, type, and title are required' });
    }
    if (!TYPES.has(type)) {
      return res.status(400).json({ error: 'Invalid type' });
    }

    const { data, error } = await supabase
      .from('notifications')
      .insert([{ user_id, type, title, body, link }])
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ ok: true, notification: data });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

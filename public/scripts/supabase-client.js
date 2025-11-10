// public/scripts/supabase-client.js
// Initializes Supabase globally for ThreadTalk and other site scripts

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// ---- Supabase project credentials ----
const SUPABASE_URL = 'https://clkizksbvxjkoatdajgd.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI';

// ---- Create Supabase client ----
window.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Quick connection check ----
console.log('✅ Supabase client loaded:', window.supabase !== undefined);

// Optional: silent connection test
(async () => {
  try {
    const { data, error } = await window.supabase.from('profiles').select('id').limit(1);
    if (error) console.warn('Supabase test error:', error.message);
    else console.log('Supabase connected.');
  } catch (err) {
    console.warn('Supabase connection test failed:', err.message);
  }
})();

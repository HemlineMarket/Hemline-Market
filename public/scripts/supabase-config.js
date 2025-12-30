// public/scripts/supabase-config.js
// Centralized Supabase configuration - single source of truth
// Include this file BEFORE any scripts that need Supabase

(function() {
  'use strict';
  
  // Supabase configuration
  window.HM_SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
  window.HM_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";
  
  // Create a shared Supabase client (lazy initialization)
  window.getSupabaseClient = function() {
    if (window._hmSupabaseClient) {
      return window._hmSupabaseClient;
    }
    
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
      console.error('[HM] Supabase JS not loaded yet');
      return null;
    }
    
    window._hmSupabaseClient = window.supabase.createClient(
      window.HM_SUPABASE_URL,
      window.HM_SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }
    );
    
    // Also set on HM namespace for backwards compatibility
    window.HM = window.HM || {};
    window.HM.supabase = window._hmSupabaseClient;
    window.supabase_client = window._hmSupabaseClient;
    
    return window._hmSupabaseClient;
  };
})();

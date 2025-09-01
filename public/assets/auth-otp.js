<!-- public/assets/auth-otp.js -->
<script type="module">
  import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

  // Supabase project (your values)
  const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";

  let _client;
  function client() {
    if (!_client) _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return _client;
  }

  /**
   * Public: send a passwordless sign-in code (magic link) to the given email.
   * Usage from any page:
   *   window.hmSendSignInCode(email).then(res => { ... });
   */
  window.hmSendSignInCode = async function(email) {
    try {
      if (!email || !/\S+@\S+\.\S+/.test(email)) {
        return { ok: false, error: "Enter a valid email." };
      }
      const { error } = await client().auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: "https://hemlinemarket.com/auth.html"
        }
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || "Unexpected error." };
    }
  };
</script>

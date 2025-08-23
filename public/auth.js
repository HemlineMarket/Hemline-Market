// Hemline — header auth status (works on any page that already loads env + supabase)
(async () => {
  // Wait for Supabase global
  let tries = 0;
  while (!window.supabase && tries < 40) {
    await new Promise(r => setTimeout(r, 100));
    tries++;
  }
  if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return;

  const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  // Insert a right-aligned status pill into the header
  const header = document.querySelector('header');
  if (!header) return;
  let pill = header.querySelector('#hm-auth-pill');
  if (!pill) {
    pill = document.createElement('button');
    pill.id = 'hm-auth-pill';
    pill.type = 'button';
    pill.style.cssText = 'float:right;margin-left:auto;border:1px solid #e5e7eb;border-radius:999px;background:#fff;padding:8px 12px;cursor:pointer';
    header.appendChild(pill);
  }

  async function render() {
    const { data } = await sb.auth.getSession();
    const user = data?.session?.user || null;
    if (user) {
      const label = user.email || 'Signed in';
      pill.textContent = `${label} · Sign out`;
      pill.onclick = async () => {
        await sb.auth.signOut();
        if (window.hm) hm.toast('Signed out.');
        await render();
      };
    } else {
      pill.textContent = 'Sign in';
      pill.onclick = () => {
        if (window.hm) hm.toast('Redirecting to sign-in…');
        // TODO: point to your real login page/route:
        window.location.href = '/index.html';
      };
    }
  }

  // Re-render on auth changes
  sb.auth.onAuthStateChange((_evt, _session) => render());
  render();
})();
<script src="/auth.js"></script>

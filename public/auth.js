// Hemline — auto header auth pill
(async () => {
  // Wait for Supabase global
  let tries = 0;
  while (!window.supabase && tries < 40) {
    await new Promise(r => setTimeout(r, 100));
    tries++;
  }
  if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return;

  const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  // Inject the script into the page automatically if header exists
  function ensurePill() {
    const header = document.querySelector('header');
    if (!header) return null;
    let pill = header.querySelector('#hm-auth-pill');
    if (!pill) {
      pill = document.createElement('button');
      pill.id = 'hm-auth-pill';
      pill.type = 'button';
      pill.style.cssText =
        'margin-left:auto;border:1px solid #e5e7eb;border-radius:999px;background:#fff;padding:8px 12px;cursor:pointer';
      header.appendChild(pill);
    }
    return pill;
  }

  async function render() {
    const pill = ensurePill();
    if (!pill) return;
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
        window.location.href = '/index.html'; // placeholder
      };
    }
  }

  sb.auth.onAuthStateChange(() => render());
  render();
})();

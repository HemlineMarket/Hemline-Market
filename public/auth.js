// Hemline — auto header auth pill + Cart(count) badge
(async () => {
  // Wait for Supabase globals
  let tries = 0;
  while (!window.supabase && tries < 40) { await new Promise(r => setTimeout(r, 100)); tries++; }
  if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return;

  const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  // Ensure header UI
  function ensureHeaderBits() {
    const header = document.querySelector('header');
    if (!header) return {};
    let pill = header.querySelector('#hm-auth-pill');
    if (!pill) {
      pill = document.createElement('button');
      pill.id = 'hm-auth-pill';
      pill.type = 'button';
      pill.style.cssText = 'margin-left:auto;border:1px solid #e5e7eb;border-radius:999px;background:#fff;padding:8px 12px;cursor:pointer';
      header.appendChild(pill);
    }
    let cart = header.querySelector('#hm-cart-pill');
    if (!cart) {
      cart = document.createElement('a');
      cart.id = 'hm-cart-pill';
      cart.href = '/cart.html';
      cart.style.cssText = 'margin-left:8px;border:1px solid #e5e7eb;border-radius:999px;background:#fff;padding:8px 12px;display:inline-flex;gap:8px;align-items:center;text-decoration:none;color:inherit';
      cart.innerHTML = `<span>Cart</span><span id="hm-cart-count" style="min-width:20px;text-align:center;border:1px solid #e5e7eb;border-radius:999px;padding:2px 6px;background:#f9fafb;font:12px/1 system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial, sans-serif;">0</span>`;
      header.appendChild(cart);
    }
    return { header, pill, cart, countEl: header.querySelector('#hm-cart-count') };
  }

  async function renderAuth() {
    const { pill } = ensureHeaderBits();
    if (!pill) return;
    const { data } = await sb.auth.getSession();
    const user = data?.session?.user || null;
    if (user) {
      const label = user.email || 'Signed in';
      pill.textContent = `${label} · Sign out`;
      pill.onclick = async () => {
        await sb.auth.signOut();
        if (window.hm) hm.toast('Signed out.');
        renderAuth(); // re-render after signout
        renderCart(); // reset cart count
      };
    } else {
      pill.textContent = 'Sign in';
      pill.onclick = () => {
        if (window.hm) hm.toast('Redirecting to sign-in…');
        window.location.href = '/signin.html';
      };
    }
  }

  async function renderCart() {
    const bits = ensureHeaderBits();
    if (!bits.countEl) return;
    const { data } = await sb.auth.getSession();
    const uid = data?.session?.user?.id || null;
    if (!uid) { bits.countEl.textContent = '0'; return; }

    try {
      // Sum qty for a quick count; falls back to row count if SUM unsupported
      const q = await sb.from('cart_items').select('qty');
      const rows = hm.guard(q, '');
      const total = rows.reduce((acc, r) => acc + (r.qty || 0), 0);
      bits.countEl.textContent = String(total || 0);
    } catch (_) {
      bits.countEl.textContent = '0';
    }
  }

  // Initial paint
  ensureHeaderBits();
  await renderAuth();
  await renderCart();

  // Update on auth changes and when tab regains focus
  sb.auth.onAuthStateChange(() => { renderAuth(); renderCart(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderCart(); });

  // Light polling to keep badge fresh if user stays on page
  setInterval(renderCart, 20000);
})();

// Hemline Market — global toast, guards, a11y tidy, + auto SEO meta injector
(function () {
  // ------- Toast UI -------
  let toastBox;
  function ensureToastUI() {
    if (toastBox) return;
    toastBox = document.createElement('div');
    toastBox.id = 'hm-toast';
    toastBox.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
      'max-width:90vw;padding:12px 16px;border:1px solid #e5e7eb;border-radius:12px;' +
      'background:#111827;color:#fff;font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;' +
      'box-shadow:0 10px 30px rgba(0,0,0,.25);opacity:0;pointer-events:none;transition:opacity .2s;' +
      'z-index:10000';
    document.body.appendChild(toastBox);
  }
  function toast(message, ms=3800) {
    ensureToastUI();
    toastBox.textContent = message;
    toastBox.style.opacity = '1';
    clearTimeout(toastBox._t);
    toastBox._t = setTimeout(() => (toastBox.style.opacity = '0'), ms);
  }

  // ------- Error normalization / guards -------
  function normalizeSupabaseError(err) {
    try {
      if (!err) return 'Something went wrong.';
      if (typeof err === 'string') return err;
      const m = (err.message || err.error || '').toLowerCase();
      if (m.includes('too many') || m.includes('rate')) return 'Slow down a sec—too many attempts. Try again in a moment.';
      if (m.includes('row level security') || m.includes('rls')) return 'You don’t have permission for that action.';
      if (m.includes('not null') || m.includes('missing')) return 'Required info is missing—please complete the fields.';
      if (m.includes('unique') || m.includes('duplicate')) return 'Looks like that was already submitted.';
      if (m.includes('invalid') || m.includes('bad input')) return 'Please check the values—something looks invalid.';
      return err.message || err.hint || 'Request failed.';
    } catch (_) { return 'Request failed.'; }
  }
  function guard(result, friendly) {
    if (!result) { toast(friendly || 'Request failed.'); throw new Error('No result'); }
    const { error } = result;
    if (error) { const msg = friendly || normalizeSupabaseError(error); toast(msg); throw error; }
    return result.data ?? result;
  }
  async function fetchWithRetry(url, opts={}, retries=2) {
    for (let i = 0; i <= retries; i++) {
      const res = await fetch(url, opts);
      if (res.ok) return res;
      if (![429,500,502,503,504].includes(res.status) || i === retries) return res;
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  window.hm = { toast, guard, normalizeSupabaseError, fetchWithRetry };

  // ------- a11y/status tidy (no HTML edits needed) -------
  document.addEventListener('DOMContentLoaded', () => {
    const statusEl = document.getElementById('status');
    if (statusEl && !statusEl.hasAttribute('aria-live')) statusEl.setAttribute('aria-live', 'polite');
    const path = (location.pathname || '').toLowerCase();
    if (statusEl && (path.endsWith('/listings.html') || path === '/listings.html')) statusEl.hidden = true;
  });

  // ------- Auto SEO Meta Injector -------
  // Adds sensible defaults for <meta name="description">, canonical, and Open Graph tags on every page.
  (function seoInject() {
    const d = document;
    const head = d.head || d.getElementsByTagName('head')[0];
    if (!head) return;

    const site = 'Hemline Market';
    const url = (location.origin || 'https://hemlinemarket.com') + location.pathname + (location.search || '');
    const titleFallback = (d.title && d.title.trim()) ? d.title.trim() : site;
    const descFallback = 'Discover curated fabric listings, save favorites, and build your cart — powered by Hemline Market.';

    // helpers
    const ensureMeta = (sel, createTag, attrs) => {
      let el = d.querySelector(sel);
      if (!el) { el = d.createElement(createTag); head.appendChild(el); }
      Object.entries(attrs).forEach(([k, v]) => { if (v && el.getAttribute(k) !== v) el.setAttribute(k, v); });
      return el;
    };

    // <title> (keep if page already set a specific one)
    if (!d.title || d.title.trim() === '') d.title = titleFallback;

    // Description
    ensureMeta('meta[name="description"]', 'meta', { name:'description', content: descFallback });

    // Canonical
    ensureMeta('link[rel="canonical"]', 'link', { rel:'canonical', href:url });

    // Open Graph basics
    ensureMeta('meta[property="og:title"]', 'meta', { property:'og:title', content: titleFallback });
    ensureMeta('meta[property="og:description"]', 'meta', { property:'og:description', content: descFallback });
    ensureMeta('meta[property="og:type"]', 'meta', { property:'og:type', content:'website' });
    ensureMeta('meta[property="og:url"]', 'meta', { property:'og:url', content:url });
    // Optional image placeholder (you can replace with brand image later)
    ensureMeta('meta[property="og:image"]', 'meta', { property:'og:image', content: (location.origin || 'https://hemlinemarket.com') + '/og-default.png' });

    // Twitter card
    ensureMeta('meta[name="twitter:card"]', 'meta', { name:'twitter:card', content:'summary_large_image' });
    ensureMeta('meta[name="twitter:title"]', 'meta', { name:'twitter:title', content:titleFallback });
    ensureMeta('meta[name="twitter:description"]', 'meta', { name:'twitter:description', content: descFallback });
  })();
})();

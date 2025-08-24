// Hemline Market — global toast, guards, a11y/SEO, error handlers, + MOBILE POLISH + FILTERS BAR
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

  // ------- a11y/status tidy -------
  document.addEventListener('DOMContentLoaded', () => {
    const statusEl = document.getElementById('status');
    if (statusEl && !statusEl.hasAttribute('aria-live')) statusEl.setAttribute('aria-live', 'polite');
    const path = (location.pathname || '').toLowerCase();
    if (statusEl && (path.endsWith('/listings.html') || path === '/listings.html')) statusEl.hidden = true;
  });

  // ------- Auto SEO Meta Injector -------
  (function seoInject() {
    const d = document; const head = d.head || d.getElementsByTagName('head')[0]; if (!head) return;
    const site = 'Hemline Market';
    const url = (location.origin || 'https://hemlinemarket.com') + location.pathname + (location.search || '');
    const titleFallback = (d.title && d.title.trim()) ? d.title.trim() : site;
    const descFallback = 'Discover curated fabric listings, save favorites, and build your cart — powered by Hemline Market.';
    const ensureMeta = (sel, createTag, attrs) => { let el = d.querySelector(sel); if (!el) { el = d.createElement(createTag); head.appendChild(el); } Object.entries(attrs).forEach(([k,v]) => { if (v && el.getAttribute(k) !== v) el.setAttribute(k,v); }); return el; };
    if (!d.title || d.title.trim() === '') d.title = titleFallback;
    ensureMeta('meta[name="description"]', 'meta', { name:'description', content: descFallback });
    ensureMeta('link[rel="canonical"]', 'link', { rel:'canonical', href:url });
    ensureMeta('meta[property="og:title"]', 'meta', { property:'og:title', content: titleFallback });
    ensureMeta('meta[property="og:description"]', 'meta', { property:'og:description', content: descFallback });
    ensureMeta('meta[property="og:type"]', 'meta', { property:'og:type', content:'website' });
    ensureMeta('meta[property="og:url"]', 'meta', { property:'og:url', content:url });
    ensureMeta('meta[property="og:image"]', 'meta', { property:'og:image', content:(location.origin||'https://hemlinemarket.com') + '/og-default.png' });
    ensureMeta('meta[name="twitter:card"]', 'meta', { name:'twitter:card', content:'summary_large_image' });
    ensureMeta('meta[name="twitter:title"]', 'meta', { name:'twitter:title', content:titleFallback });
    ensureMeta('meta[name="twitter:description"]', 'meta', { name:'twitter:description', content: descFallback });
  })();

  // ------- Global error & network handlers -------
  window.addEventListener('error', (e) => { try { toast(`Oops — ${(e && e.message) ? e.message : 'Unexpected error.'}`); } catch (_) {} });
  window.addEventListener('unhandledrejection', (e) => { try { const r = e && (e.reason?.message || e.reason) || 'Request failed.'; toast(`Request error — ${String(r)}`); } catch (_) {} });
  window.addEventListener('offline', () => toast('You’re offline. Actions will fail until connection returns.'));
  window.addEventListener('online', () => toast('Back online.'));

  // ------- MOBILE POLISH (auto-injected CSS, no HTML edits) -------
  (function injectMobileCSS(){
    const css =
`html,body{overflow-x:hidden}
*{-webkit-tap-highlight-color:transparent}
@media (max-width:560px){
  header{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .btn{padding:12px 14px !important;border-radius:12px}
  .heart{width:44px !important;height:44px !important}
  .qtybtn{width:42px !important;height:40px !important}
  .qtyval{min-width:44px !important}
  .card{border-radius:16px}
  .grid{gap:10px}
}
@media (pointer:coarse){
  button,.btn{min-height:44px}
}
`;
    const s = document.createElement('style');
    s.setAttribute('data-hm-mobile','1');
    s.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(s);
  })();

  // ------- FILTERS BAR (inject only on listings page) -------
  (function injectFiltersBar(){
    const path = (location.pathname || '').toLowerCase();
    if (!(path.endsWith('/listings.html') || path === '/listings.html')) return;
    if (document.getElementById('hm-filters-bar')) return;

    // Styles
    const css =
`.filters-wrap{position:sticky;top:56px;z-index:15;background:#fff;border-bottom:1px solid #e5e7eb}
.filters{max-width:1100px;margin:0 auto;padding:10px 16px;display:grid;gap:8px;grid-template-columns:repeat(6,minmax(0,1fr))}
.filters select,.filters input,.filters button{width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;background:#fff}
.filters .search{grid-column:span 2}
@media (max-width:900px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}.filters .search{grid-column:span 2}}`;
    const s = document.createElement('style');
    s.setAttribute('data-hm-filters','1');
    s.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(s);

    // Bar markup
    const wrap = document.createElement('div');
    wrap.className = 'filters-wrap';
    wrap.id = 'hm-filters-bar';
    wrap.innerHTML = `
      <div class="filters" id="filters">
        <select id="f-fabric"><option value="">Fabric</option><option>Cotton</option><option>Wool</option><option>Linen</option><option>Silk</option><option>Knit</option><option>Terry/Fleece</option></select>
        <select id="f-weight"><option value="">Weight</option><option>Light</option><option>Mid</option><option>Heavy</option></select>
        <select id="f-color"><option value="">Color</option><option>Black</option><option>White</option><option>Brown</option><option>Blue</option><option>Green</option><option>Red</option><option>Yellow</option><option>Pink</option><option>Purple</option></select>
        <select id="f-seller"><option value="">Seller</option></select>
        <select id="f-sort"><option value="">Sort</option><option value="newest">Newest</option><option value="priceLow">Price: Low → High</option><option value="priceHigh">Price: High → Low</option></select>
        <input id="f-search" class="search" type="search" placeholder="Search fabrics…">
        <button id="f-reset" type="button">Reset</button>
      </div>
    `;

    // Insert after the header so it's sticky under it
    const header = document.querySelector('header');
    if (header && header.parentNode) {
      header.parentNode.insertBefore(wrap, header.nextSibling);
    } else {
      document.body.insertBefore(wrap, document.body.firstChild);
    }

    // Wiring: emit a custom event with current filters
    const $ = (id)=>document.getElementById(id);
    const inputs = ['f-fabric','f-weight','f-color','f-seller','f-sort','f-search'].map($);
    function emit(){
      const detail = {
        fabric: $('f-fabric').value || null,
        weight: $('f-weight').value || null,
        color: $('f-color').value || null,
        seller: $('f-seller').value || null,
        sort: $('f-sort').value || null,
        q: $('f-search').value.trim() || null
      };
      document.dispatchEvent(new CustomEvent('hemline:filters',{detail}));
    }
    inputs.forEach(el=>el.addEventListener('input',emit));
    $('f-reset').addEventListener('click',()=>{inputs.forEach(el=>{if(el.tagName==='INPUT')el.value=''; else el.selectedIndex=0;}); emit();});
    emit();
  })();

})();

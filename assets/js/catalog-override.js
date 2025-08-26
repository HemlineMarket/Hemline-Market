<!-- FILE: assets/js/catalog-override.js -->
<script>
// Hemline Market — Catalog Hotfix Override
// Purpose: when legacy catalog.html is still served, this script:
// 1) Renames "Atelier" -> "Atelier Stash"
// 2) Removes duplicate skinny link row if present
// 3) Hides the old mega-filter panel (Sort/Stretch/Weight/...)
// 4) Injects a boutique filter bar (Content / Type / Category)
// 5) Parses each card's text to compute content/type/category reliably
// 6) Applies correct filtering using structured data attributes

(function () {
  if (window.__HM_CATALOG_OVERRIDE__) return;
  window.__HM_CATALOG_OVERRIDE__ = true;

  // --- utilities ---
  const $  = (sel, ctx=document) => ctx.querySelector(sel);
  const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));
  const norm = s => (s||"").toLowerCase();

  // Map of tokens -> buckets
  const CONTENT_TOKENS = {
    cotton: 'cotton', linen: 'linen', flax: 'linen',
    silk: 'silk', wool: 'wool', cashmere: 'wool',
    polyester: 'synthetic', nylon: 'synthetic',
    rayon: 'synthetic', viscose: 'synthetic', modal: 'synthetic',
    lyocell: 'synthetic', tencel: 'synthetic', acetate: 'synthetic'
  };

  const TYPE_TOKENS = [
    'crepe','satin','dobby','twill','jersey','chiffon','lace','denim','canvas','velvet'
  ];

  const NATURALS = new Set(['cotton','linen','silk','wool']);

  function computeContentCategory(text){
    text = norm(text);
    const hits = new Set();
    for (const key in CONTENT_TOKENS){
      if (text.includes(key)) hits.add(CONTENT_TOKENS[key] === 'synthetic' ? key : CONTENT_TOKENS[key]);
    }
    // pick primary "content" (first natural/specific if any; else synthetic/blend marker)
    let primary = '';
    for (const n of ['cotton','linen','silk','wool']) { if (text.includes(n)) { primary = n; break; } }
    if (!primary){
      for (const s of ['polyester','nylon','rayon','viscose','modal','lyocell','tencel','acetate']) {
        if (text.includes(s)) { primary = 'synthetic'; break; }
      }
    }
    // category: natural / synthetic / blend
    let hasNatural = ['cotton','linen','silk','wool'].some(k => text.includes(k));
    let hasSynthetic = ['polyester','nylon','rayon','viscose','modal','lyocell','tencel','acetate'].some(k => text.includes(k));
    let category = hasNatural && hasSynthetic ? 'blend' : (hasNatural ? 'natural' : (hasSynthetic ? 'synthetic' : ''));
    if (!primary && category==='blend') primary = 'blend';
    if (!primary && category==='synthetic') primary = 'synthetic';
    return { primary, category };
  }

  function computeType(text){
    text = norm(text);
    for (const t of TYPE_TOKENS){
      if (text.includes(t)) return t;
    }
    return '';
  }

  function renameAtelier(){
    $$('a').forEach(a=>{
      const txt = (a.textContent||'').trim();
      if (/^atelier$/i.test(txt)) a.textContent = 'Atelier Stash';
    });
  }

  function removeDuplicateSkinnyRow(){
    // If there is a skinny row of inline links above the main header, hide it.
    // Heuristic: a group of <a> links separated by spaces, before the big logo nav.
    const bodyChildren = Array.from(document.body.children).slice(0,3);
    bodyChildren.forEach(el=>{
      if (el.tagName==='A' || (el.querySelector && el.querySelector('a') && el.textContent.includes('Browse') && el.textContent.includes('Profile'))){
        el.style.display = 'none';
      }
    });
  }

  function hideLegacyFilterPanel(){
    // Look for labels like "Sort", "Stretch", "Weight (gsm)" etc.
    const candidates = $$('div,section').filter(node=>{
      const t = norm(node.textContent);
      return t.includes('sort') && t.includes('stretch') && t.includes('weight') && t.includes('price') && t.includes('fabric type');
    });
    candidates.forEach(n => n.style.display='none');
  }

  function injectBoutiqueFilters(){
    if ($('#hm-boutique-filters')) return;
    const bar = document.createElement('div');
    bar.id = 'hm-boutique-filters';
    bar.innerHTML = `
      <style>
        #hm-boutique-filters{padding:16px 20px;border-bottom:1px solid #eee;display:flex;gap:16px;flex-wrap:wrap;align-items:center}
        #hm-boutique-filters label{font-size:.9rem;font-weight:600;margin-right:8px}
        #hm-boutique-filters select{padding:6px 8px;border-radius:8px;border:1px solid #ccc;background:#fff}
        #hm-boutique-filters button{padding:6px 12px;border-radius:8px;border:1px solid #ccc;background:#f9f9f9;cursor:pointer}
        #hm-boutique-status{max-width:1200px;margin:12px auto -4px;text-align:center;color:#666}
      </style>
      <div>
        <label for="hm-fabric-content">Content</label>
        <select id="hm-fabric-content">
          <option value="">All</option>
          <option value="cotton">Cotton</option>
          <option value="linen">Linen</option>
          <option value="silk">Silk</option>
          <option value="wool">Wool</option>
          <option value="synthetic">Synthetic</option>
          <option value="blend">Blend</option>
        </select>
      </div>
      <div>
        <label for="hm-fabric-type">Type</label>
        <select id="hm-fabric-type">
          <option value="">All</option>
          <option value="crepe">Crepe</option>
          <option value="dobby">Dobby</option>
          <option value="jersey">Jersey</option>
          <option value="satin">Satin</option>
          <option value="twill">Twill</option>
          <option value="chiffon">Chiffon</option>
          <option value="lace">Lace</option>
          <option value="denim">Denim</option>
          <option value="canvas">Canvas</option>
          <option value="velvet">Velvet</option>
        </select>
      </div>
      <div>
        <label for="hm-fabric-category">Category</label>
        <select id="hm-fabric-category">
          <option value="">All</option>
          <option value="natural">Natural</option>
          <option value="synthetic">Synthetic</option>
          <option value="blend">Blend</option>
        </select>
      </div>
      <button id="hm-clear">Clear Filters</button>
    `;
    // Insert just below the first header/nav on the page
    const header = document.querySelector('header, .hm-header') || document.body;
    header.parentNode.insertBefore(bar, header.nextSibling);

    const status = document.createElement('div');
    status.id = 'hm-boutique-status';
    status.textContent = 'Showing all fabrics';
    header.parentNode.insertBefore(status, bar.nextSibling);
  }

  function tagCardsAndBind(){
    // Find card-like elements: look for repeated blocks with a price and "No image" placeholder or thumbnails.
    const cards = $$('[class*="card"], article, li').filter(el=>{
      const t = norm(el.textContent);
      return /\$\d+/.test(t) && (t.includes('fabric') || t.includes('silk') || t.includes('wool') || t.includes('cotton') || t.includes('linen'));
    });

    if (cards.length === 0) return;

    cards.forEach(card=>{
      // Skip if already tagged
      if (card.dataset && (card.dataset.content || card.dataset.type || card.dataset.category)) return;

      const t = norm(card.textContent);
      const type = computeType(t);
      const { primary: content, category } = computeContentCategory(t);

      if (content) card.dataset.content = content;
      if (type) card.dataset.type = type;
      if (category) card.dataset.category = category;
    });

    function apply(){
      const content  = $('#hm-fabric-content')?.value || '';
      const type     = $('#hm-fabric-type')?.value || '';
      const category = $('#hm-fabric-category')?.value || '';
      let count = 0;

      cards.forEach(card=>{
        const c = norm(card.dataset.content||'');
        const t = norm(card.dataset.type||'');
        const cat = norm(card.dataset.category||'');
        const show = (!content || c===content) && (!type || t===type) && (!category || cat===category);
        card.style.display = show ? '' : 'none';
        if (show) count++;
      });

      const s = $('#hm-boutique-status');
      if (s) s.textContent = count===0 ? 'No fabrics match these filters' : `Showing ${count} fabric${count>1?'s':''}`;
    }

    // Bind events
    ['hm-fabric-content','hm-fabric-type','hm-fabric-category'].forEach(id=>{
      const el = $('#'+id);
      if (el && !el.__hm_bound) { el.addEventListener('change', apply); el.__hm_bound=true; }
    });
    const clear = $('#hm-clear');
    if (clear && !clear.__hm_bound){
      clear.addEventListener('click', ()=>{
        ['hm-fabric-content','hm-fabric-type','hm-fabric-category'].forEach(id=>{ const el = $('#'+id); if (el) el.value=''; });
        apply();
      });
      clear.__hm_bound = true;
    }

    apply(); // initial
  }

  function run() {
    renameAtelier();
    removeDuplicateSkinnyRow();
    hideLegacyFilterPanel();
    injectBoutiqueFilters();
    tagCardsAndBind();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
</script>

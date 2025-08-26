<!-- FILE: assets/js/catalog-filters.js -->
<script>
// Hemline Market — Catalog Filters (robust init + status)
(function(){
  function qs(id){ return document.getElementById(id); }
  function all(sel){ return Array.from(document.querySelectorAll(sel)); }

  function applyFilters() {
    const content  = (qs('fabric-content')?.value || '').trim();
    const type     = (qs('fabric-type')?.value || '').trim();
    const category = (qs('fabric-category')?.value || '').trim();

    const cards = all('.card');
    let visibleCount = 0;

    cards.forEach(card => {
      // Prefer structured data attributes; fall back to text if missing.
      const c   = (card.dataset.content  || '').toLowerCase();
      const t   = (card.dataset.type     || '').toLowerCase();
      const cat = (card.dataset.category || '').toLowerCase();

      let show = true;
      if (content  && c   !== content)  show = false;
      if (type     && t   !== type)     show = false;
      if (category && cat !== category) show = false;

      card.style.display = show ? 'block' : 'none';
      if (show) visibleCount++;
    });

    const status = qs('catalog-status');
    if (status){
      status.textContent = visibleCount === 0
        ? 'No fabrics match these filters'
        : 'Showing ' + visibleCount + ' fabric' + (visibleCount > 1 ? 's' : '');
    }
  }

  function clearFilters(){
    if (qs('fabric-content'))  qs('fabric-content').value = '';
    if (qs('fabric-type'))     qs('fabric-type').value = '';
    if (qs('fabric-category')) qs('fabric-category').value = '';
    all('.card').forEach(c => c.style.display = 'block');
    applyFilters();
  }

  // Initialize once DOM is ready (works with defer and non-defer).
  function init(){
    ['fabric-content','fabric-type','fabric-category'].forEach(id=>{
      const el = qs(id);
      if (el && !el._hm_bound){
        el.addEventListener('change', applyFilters);
        el._hm_bound = true;
      }
    });
    const clearBtn = qs('clear-filters');
    if (clearBtn && !clearBtn._hm_bound){
      clearBtn.addEventListener('click', clearFilters);
      clearBtn._hm_bound = true;
    }
    applyFilters(); // run once on load so state is correct
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init, { once:true });
  } else {
    init();
  }
})();
</script>

<!-- FILE: assets/js/catalog-filters.js -->
<script>
// Hemline Market — Catalog Filters
(function(){
  function applyFilters() {
    const content = document.getElementById('fabric-content').value;
    const type = document.getElementById('fabric-type').value;
    const category = document.getElementById('fabric-category').value;
    const cards = document.querySelectorAll('.card');

    cards.forEach(card => {
      const c = (card.querySelector('p:nth-of-type(1)')?.textContent || "").toLowerCase();
      const t = (card.querySelector('p:nth-of-type(2)')?.textContent || "").toLowerCase();

      let show = true;

      if (content && !c.includes(content)) show = false;
      if (type && !t.includes(type)) show = false;

      if (category) {
        if (category === 'natural') {
          if (!c.includes('cotton') && !c.includes('wool') && !c.includes('silk') && !c.includes('linen')) {
            show = false;
          }
        }
        if (category === 'synthetic') {
          if (!c.includes('poly') && !c.includes('nylon') && !c.includes('rayon')) {
            show = false;
          }
        }
        if (category === 'blend') {
          if (!c.includes('blend')) {
            show = false;
          }
        }
      }

      card.style.display = show ? 'block' : 'none';
    });
  }

  ['fabric-content','fabric-type','fabric-category'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', applyFilters);
  });
})();
</script>

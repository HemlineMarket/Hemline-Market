<!-- FILE: assets/js/catalog-filters.js -->
<script>
// Hemline Market — Catalog Filters (data-attribute based)
(function(){
  function applyFilters() {
    const content = document.getElementById('fabric-content').value;
    const type = document.getElementById('fabric-type').value;
    const category = document.getElementById('fabric-category').value;
    const cards = document.querySelectorAll('.card');

    cards.forEach(card => {
      const c = card.dataset.content || "";
      const t = card.dataset.type || "";
      const cat = card.dataset.category || "";
      let show = true;

      if (content && c !== content) show = false;
      if (type && t !== type) show = false;
      if (category && cat !== category) show = false;

      card.style.display = show ? 'block' : 'none';
    });
  }

  ['fabric-content','fabric-type','fabric-category'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', applyFilters);
  });
})();
</script>

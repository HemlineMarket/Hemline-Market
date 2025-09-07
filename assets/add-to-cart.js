<script>
/* Shared Add-to-Cart helper
   - Prevents navigation when button sits inside a link
   - Ensures yards is a NUMBER (defaults to 1 if missing; notions should pass 0)
   - Stores amount in cents under `amount`
   - Keeps seller grouping: sellerId + sellerName
*/
(function(){
  const LS = 'hm_cart';

  const read = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch(_) { return []; } };
  const write = (arr) => {
    localStorage.setItem(LS, JSON.stringify(arr));
    if (window.HM_CART_BADGE_UPDATE) window.HM_CART_BADGE_UPDATE(arr);
  };

  // "3", "3 yd", " 2.25yards " → 3 / 2.25 ; invalid → 0
  function toYardsNumber(v){
    if (v === undefined || v === null) return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const s = String(v).replace(/[^0-9.]/g,'');
    const n = Number(s);
    return isFinite(n) ? n : 0;
  }

  function addToCart(raw){
    const item = {
      id: String(raw.id || raw.listingId || raw.slug || Date.now()),
      name: raw.name || 'Fabric',
      amount: Number(raw.amount ?? raw.price ?? 0),    // cents
      qty: Math.max(1, Number(raw.qty ?? 1)),
      // DEFAULT YARDS = 1 if not provided (so fabrics from Browse work immediately)
      yards: (function(){
        const y = toYardsNumber(raw.yards);
        return y > 0 ? y : 1; // notions should explicitly pass 0 via data-yards="0"
      })(),
      sellerId: String(raw.sellerId || raw.seller_id || raw.seller || 'default_seller'),
      sellerName: raw.sellerName || raw.seller || 'Seller',
      photo: raw.photo || ''
    };

    const cart = read();
    const i = cart.findIndex(x => x.id === item.id && (x.sellerId || 'default_seller') === item.sellerId);
    if (i >= 0) {
      cart[i].qty += item.qty;
      if (item.yards) cart[i].yards = item.yards; // prefer latest yards selection
      write(cart);
    } else {
      cart.push(item);
      write(cart);
    }
  }

  // One delegated click handler for any [data-add-to-cart] button
  document.addEventListener('click', function(e){
    const el = e.target.closest('[data-add-to-cart]');
    if (!el) return;

    // Stop link navigation and bubbling from parent <a> wrappers
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

    addToCart({
      id: el.dataset.id,
      name: el.dataset.name,
      amount: el.dataset.amount ?? el.dataset.price,  // cents
      qty: el.dataset.qty,
      yards: el.dataset.yards,                        // if missing → defaults to 1
      sellerId: el.dataset.sellerId,
      sellerName: el.dataset.sellerName,
      photo: el.dataset.photo
    });

    // quick visual feedback
    try { el.disabled = true; setTimeout(()=> el.disabled = false, 500); } catch(_) {}
  });

  // Optional programmatic API
  window.HM_ADD_TO_CART = addToCart;
})();
</script>

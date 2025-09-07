<script>
// Shared Add-to-Cart helper for all listing/product pages
(function(){
  const LS = 'hm_cart';

  // Read / write
  const read = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch(_) { return []; } };
  const write = (arr) => {
    localStorage.setItem(LS, JSON.stringify(arr));
    if (window.HM_CART_BADGE_UPDATE) window.HM_CART_BADGE_UPDATE(arr);
  };

  // Defensive: turn "3", "3.0", "3 yd", "  2.25yards " → 3 / 3.0 / 2.25
  function toYardsNumber(v){
    if (v === undefined || v === null) return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const s = String(v).replace(/[^0-9.]/g,''); // keep digits and dot
    const n = Number(s);
    return isFinite(n) ? n : 0;
  }

  // Add or merge an item
  function addToCart(raw){
    // Normalize
    const item = {
      id: String(raw.id || raw.listingId || raw.slug || Date.now()),
      name: raw.name || 'Fabric',
      // Amount in cents (cart uses `amount`)
      amount: Number(raw.amount ?? raw.price ?? 0),  // supports either `amount` or `price`
      qty: Math.max(1, Number(raw.qty ?? 1)),
      yards: toYardsNumber(raw.yards),              // <— KEY: numeric yards
      sellerId: String(raw.sellerId || raw.seller_id || raw.seller || 'default_seller'),
      sellerName: raw.sellerName || raw.seller || 'Seller',
      photo: raw.photo || ''
    };

    // Merge by same listing + same seller (so qty increases)
    const cart = read();
    const i = cart.findIndex(x => x.id === item.id && (x.sellerId || 'default_seller') === item.sellerId);
    if (i >= 0) {
      cart[i].qty += item.qty;
      // if yards provided again (e.g., user re-adds same listing with different yards choice), prefer latest
      if (item.yards) cart[i].yards = item.yards;
      write(cart);
    } else {
      cart.push(item);
      write(cart);
    }
  }

  // Wire up any button/link with data-add-to-cart on the page
  // Expected data-* attributes (strings are OK; we normalize):
  // data-id, data-name, data-amount (cents) or data-price (cents), data-qty, data-yards, data-seller-id, data-seller-name, data-photo
  document.addEventListener('click', function(e){
    const el = e.target.closest('[data-add-to-cart]');
    if (!el) return;
    e.preventDefault();

    addToCart({
      id: el.dataset.id,
      name: el.dataset.name,
      amount: el.dataset.amount ?? el.dataset.price,   // cents
      qty: el.dataset.qty,
      yards: el.dataset.yards,                         // "3", "3 yd", 3 -> all OK
      sellerId: el.dataset.sellerId,
      sellerName: el.dataset.sellerName,
      photo: el.dataset.photo
    });

    // Simple affordance; you can replace with a toast
    try { el.disabled = true; setTimeout(()=> el.disabled = false, 600); } catch(_) {}
  });

  // Expose for programmatic calls if needed
  window.HM_ADD_TO_CART = addToCart;
})();
</script>

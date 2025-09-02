// scripts/cart.js
// Hemline Market – minimal cart stored in localStorage.
// Public API: Cart.add(item), Cart.setQty(id, qty), Cart.remove(id), Cart.clear(), Cart.get(), Cart.count(), Cart.totalCents()

(function () {
  // NOTE: keep this key stable across pages (browse.html, cart.html, etc.)
  const LS_KEY = 'hm_cart_v1';

  /* ========== storage helpers ========== */
  function read() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
    catch { return []; }
  }
  function write(items) {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
    updateBadge();
  }
  function findIndex(items, id) {
    return items.findIndex(i => i.id === String(id));
  }

  /* ========== normalize input ========== */
  function normalize(item) {
    // required: id, name, price (in cents)
    // optional: currency, quantity, image, url
    return {
      id: String(item.id),
      name: String(item.name || ''),
      price: Number(item.price || 0), // cents
      currency: String(item.currency || 'usd').toLowerCase(),
      quantity: Math.max(1, Number(item.quantity || 1)),
      image: item.image || '',
      url: item.url || ''
    };
  }

  /* ========== header cart badge ========== */
  function updateBadge() {
    // any header icon can include: <span class="cart-badge" data-cart-badge></span>
    const el = document.querySelector('[data-cart-badge]');
    if (!el) return; // page might not have the header

    const totalQty = read().reduce((n, i) => n + (Number(i.quantity) || 0), 0);
    if (totalQty > 0) {
      el.textContent = totalQty > 99 ? '99+' : String(totalQty);
      el.style.display = 'inline-flex';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  // expose badge updater so other pages can call it (cart.html does after render)
  window.HM_CART_BADGE_UPDATE = updateBadge;

  // keep badge in sync across tabs/windows
  window.addEventListener('storage', (e) => {
    if (e.key === LS_KEY) updateBadge();
  });

  /* ========== public API ========== */
  const Cart = {
    add(item) {
      const it = normalize(item);
      const items = read();
      const idx = findIndex(items, it.id);
      if (idx >= 0) {
        items[idx].quantity += it.quantity;
      } else {
        items.push(it);
      }
      write(items);
      return items;
    },
    setQty(id, qty) {
      const q = Math.max(0, Number(qty || 0));
      const items = read();
      const idx = findIndex(items, id);
      if (idx < 0) return items;
      if (q === 0) items.splice(idx, 1);
      else items[idx].quantity = q;
      write(items);
      return items;
    },
    remove(id) {
      const items = read().filter(i => i.id !== String(id));
      write(items);
      return items;
    },
    clear() {
      write([]);
      return [];
    },
    get() {
      return read();
    },
    count() {
      return read().reduce((n, i) => n + (Number(i.quantity) || 0), 0);
    },
    totalCents() {
      return read().reduce((sum, i) => sum + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
    }
  };

  // expose globally
  window.Cart = Cart;

  // initialize badge on load (also handles direct visits to cart.html)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateBadge);
  } else {
    updateBadge();
  }
})();

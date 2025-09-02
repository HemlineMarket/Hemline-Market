// scripts/cart.js
// Hemline Market – minimal cart stored in localStorage.
// Public API: Cart.add(item), Cart.setQty(id, qty), Cart.remove(id), Cart.get(), Cart.clear(), Cart.count()

(function () {
  const LS_KEY = 'hm_cart_v1';

  function read() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
    catch { return []; }
  }
  function write(items) {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
    updateBadge();
  }

  function normalize(item) {
    // required: id, name, price (in cents), currency, quantity, image, url
    return {
      id: String(item.id),
      name: String(item.name || ''),
      price: Number(item.price || 0),      // cents
      currency: String(item.currency || 'usd').toLowerCase(),
      quantity: Math.max(1, Number(item.quantity || 1)),
      image: item.image || '',
      url: item.url || ''
    };
  }

  function findIndex(items, id) {
    return items.findIndex(i => i.id === String(id));
  }

  function updateBadge() {
    const el = document.querySelector('[data-cart-badge]');
    if (!el) return;
    const total = read().reduce((n, i) => n + i.quantity, 0);
    el.textContent = total > 99 ? '99+' : String(total);
    el.style.display = total ? 'inline-flex' : 'none';
  }

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
      if (q === 0) { items.splice(idx, 1); }
      else { items[idx].quantity = q; }
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
      return read().reduce((n, i) => n + i.quantity, 0);
    },
    totalCents() {
      return read().reduce((sum, i) => sum + i.price * i.quantity, 0);
    }
  };

  // expose globally
  window.Cart = Cart;

  // initialize badge on load
  document.addEventListener('DOMContentLoaded', updateBadge);
})();

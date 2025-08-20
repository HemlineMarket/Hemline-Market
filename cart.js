/* Hemline Market - minimal cart stored in localStorage */
(() => {
  const KEY = 'hm_cart_v1';

  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || '{"items":[]}'); }
    catch { return { items: [] }; }
  };
  const write = (data) => localStorage.setItem(KEY, JSON.stringify(data));

  const api = {
    getCart() { return read(); },
    clear() { write({ items: [] }); },
    addItem(item) {
      // item: {id, title, seller_id, unit_price_cents, qty}
      const cart = read();
      const i = cart.items.findIndex(x => x.id === item.id);
      if (i >= 0) { cart.items[i].qty += item.qty || 1; }
      else { cart.items.push({ ...item, qty: item.qty || 1 }); }
      write(cart);
      return cart;
    },
    setQty(id, qty) {
      const cart = read();
      const i = cart.items.findIndex(x => x.id === id);
      if (i >= 0) {
        if (qty <= 0) cart.items.splice(i, 1);
        else cart.items[i].qty = qty;
        write(cart);
      }
      return cart;
    },
    remove(id) {
      const cart = read();
      const i = cart.items.findIndex(x => x.id === id);
      if (i >= 0) { cart.items.splice(i, 1); write(cart); }
      return cart;
    },
    totals() {
      const { items } = read();
      const subtotal = items.reduce((s, it) => s + it.unit_price_cents * it.qty, 0);
      return { subtotal_cents: subtotal, currency: 'usd' };
    }
  };

  // Expose globally as window.HEM_CART
  window.HEM_CART = api;
})();

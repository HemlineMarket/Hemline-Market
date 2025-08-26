/* Hemline Market — Cart Store (Part 13, Step 7)
   File: assets/js/cart-store.js
   Purpose:
     - Keep a simple cart in localStorage ("hm_cart": array of items).
     - Increment header #cart-count on add; decrement on toast Undo.
     - Works alongside add-to-cart-toast.js (no changes needed there).

   Behavior:
     - Clicking any [data-add-to-cart] will add an item {name, ts}.
     - If the toast provides an Undo button, we listen for its click and remove the last added item.
     - Exposes window.HMCART API for future pages (cart.html) to read items.

   Safe to include multiple times.
*/
(function () {
  if (window.__HM_CART_STORE__) return;
  window.__HM_CART_STORE__ = true;

  // ---------- storage helpers ----------
  var KEY = 'hm_cart';

  function readCart() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function writeCart(items) {
    try {
      localStorage.setItem(KEY, JSON.stringify(items || []));
    } catch (_) {}
  }

  function addItem(name) {
    var items = readCart();
    items.push({ name: String(name || 'Item'), ts: Date.now() });
    writeCart(items);
    bumpBadge(+1);
  }

  function removeLastItem() {
    var items = readCart();
    if (items.length > 0) {
      items.pop();
      writeCart(items);
      bumpBadge(-1);
    }
  }

  function getCount() {
    return readCart().length;
  }

  // ---------- badge sync ----------
  function bumpBadge(delta) {
    var badge = document.getElementById('cart-count') || document.querySelector('[data-cart-count]');
    if (!badge) return;
    var n = parseInt(badge.textContent || '0', 10) || 0;
    n = Math.max(0, n + (delta || 0));
    badge.textContent = String(n);
    badge.classList.add('hm-bump');
    setTimeout(function(){ badge.classList.remove('hm-bump'); }, 350);
  }

  function syncBadgeToStore() {
    var badge = document.getElementById('cart-count') || document.querySelector('[data-cart-count]');
    if (!badge) return;
    var n = getCount();
    badge.textContent = String(n);
  }

  // ---------- bind to add-to-cart buttons ----------
  function bindButtons() {
    var btns = Array.from(document.querySelectorAll('[data-add-to-cart]'));
    btns.forEach(function (btn) {
      if (btn.__hm_cart_bound) return;
      btn.__hm_cart_bound = true;
      btn.addEventListener('click', function () {
        var name = btn.getAttribute('data-item') || (btn.textContent || 'Item');
        addItem(name.trim());
      });
    });
  }

  // ---------- hook toast Undo (no modifications to toast file needed) ----------
  // The toast places a button with class ".undo" inside ".hm-toast".
  // We delegate clicks there to remove the last-added item for this session.
  function bindToastUndo() {
    document.addEventListener('click', function (e) {
      var el = e.target;
      if (!el) return;
      if (el.matches && el.matches('.hm-toast .undo')) {
        // Remove the most recent item (optimistic)
        removeLastItem();
      }
    });
  }

  // ---------- public API ----------
  window.HMCART = {
    getAll: readCart,
    clear: function () { writeCart([]); syncBadgeToStore(); },
    count: getCount,
    add: function (name) { addItem(name); },
    removeLast: function () { removeLastItem(); }
  };

  // ---------- init ----------
  function init() {
    syncBadgeToStore();
    bindButtons();
    bindToastUndo();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // Rebind if DOM changes (cards injected dynamically)
  var mo = new MutationObserver(function () { bindButtons(); });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();

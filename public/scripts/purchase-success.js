// File: public/scripts/purchase-success.js
// Clears local cart on Stripe success and hard-refreshes SOLD state everywhere.

(function () {
  const CART_KEY = "hm_cart";
  const SHIP_KEY = "hm_cart_shipping";

  function clearLocalCart() {
    try {
      localStorage.removeItem(CART_KEY);
      localStorage.removeItem(SHIP_KEY);
      if (window.HM_CART_BADGE_UPDATE) {
        window.HM_CART_BADGE_UPDATE([]);
      }
    } catch (_) {}
  }

  function purgeSoldFromAnyCachedViews() {
    try {
      const cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      if (!Array.isArray(cart) || !cart.length) return;

      const filtered = cart.filter(it => {
        const s = String(it.status || "").toUpperCase();
        return s !== "SOLD";
      });

      if (filtered.length !== cart.length) {
        localStorage.setItem(CART_KEY, JSON.stringify(filtered));
        if (window.HM_CART_BADGE_UPDATE) {
          window.HM_CART_BADGE_UPDATE(filtered);
        }
      }
    } catch (_) {}
  }

  async function init() {
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get("session_id");

    if (!sessionId) return;

    // 1) Clear cart for this browser
    clearLocalCart();

    // 2) Extra safety: remove SOLD items if any cache survived
    purgeSoldFromAnyCachedViews();
  }

  init();
})();

// File: public/scripts/purchase-success.js
// Clears local cart on Stripe success and hard-refreshes SOLD state everywhere.

(function () {
  const CART_KEY = "hm_cart";
  const SHIP_KEY = "hm_cart_shipping";

  // If you ever change param names on success.html, add them here.
  const LISTING_ID_PARAMS = ["listing_id", "listingId", "listing", "id"];

  function getParamAny(names) {
    try {
      const url = new URL(window.location.href);
      for (const n of names) {
        const v = url.searchParams.get(n);
        if (v) return String(v);
      }
    } catch (_) {}
    return "";
  }

  function normalizeId(v) {
    return String(v || "").trim();
  }

  function updateBadge(items) {
    try {
      if (window.HM_CART_BADGE_UPDATE) window.HM_CART_BADGE_UPDATE(items);
    } catch (_) {}
  }

  // Removes a specific purchased listing from hm_cart (if present).
  // This is safer than nuking the entire cart if your “success” page ever fires
  // in edge cases or you later support multi-item carts.
  function removePurchasedItemFromCart(purchasedListingId) {
    const listingId = normalizeId(purchasedListingId);
    if (!listingId) return;

    try {
      const cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      if (!Array.isArray(cart) || !cart.length) return;

      const filtered = cart.filter((it) => {
        const itListing =
          normalizeId(it.listing_id) ||
          normalizeId(it.listingId) ||
          normalizeId(it.listing) ||
          normalizeId(it.id); // some carts store listing id in id
        return itListing !== listingId;
      });

      if (filtered.length !== cart.length) {
        localStorage.setItem(CART_KEY, JSON.stringify(filtered));
        updateBadge(filtered);
      }
    } catch (_) {}
  }

  function clearLocalCart() {
    try {
      localStorage.removeItem(CART_KEY);
      localStorage.removeItem(SHIP_KEY);
      updateBadge([]);
    } catch (_) {}
  }

  function purgeSoldFromAnyCachedViews() {
    try {
      const cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      if (!Array.isArray(cart) || !cart.length) return;

      const filtered = cart.filter((it) => {
        const s = String(it.status || "").toUpperCase();
        return s !== "SOLD";
      });

      if (filtered.length !== cart.length) {
        localStorage.setItem(CART_KEY, JSON.stringify(filtered));
        updateBadge(filtered);
      }
    } catch (_) {}
  }

  async function init() {
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get("session_id");
    if (!sessionId) return;

    // If success page includes listing id, remove just that item first
    // (helps even if you later stop clearing the whole cart).
    const purchasedListingId = getParamAny(LISTING_ID_PARAMS);
    if (purchasedListingId) {
      removePurchasedItemFromCart(purchasedListingId);
    }

    // 1) Clear cart for this browser (your current behavior)
    clearLocalCart();

    // 2) Extra safety: remove SOLD items if any cache survived
    purgeSoldFromAnyCachedViews();
  }

  init();
})();

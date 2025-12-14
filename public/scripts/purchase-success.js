// File: public/scripts/purchase-success.js
// On Stripe success redirect, clear the local cart and (optionally) log the order.

(function () {
  const HM = window.HM || {};

  // ✅ Prefer the shared singleton client if present (matches checkout/sales/purchases pattern)
  const supabase = window.__hm_supabase || HM.supabase || null;

  const CART_KEY = "hm_cart";
  const SHIP_KEY = "hm_cart_shipping";

  function clearLocalCart() {
    try {
      localStorage.removeItem(CART_KEY);
      localStorage.removeItem(SHIP_KEY);

      if (window.HM_CART_BADGE_UPDATE) {
        try {
          window.HM_CART_BADGE_UPDATE([]);
        } catch (_) {}
      }

      console.log("[purchase-success] Cleared local cart storage");
    } catch (e) {
      console.warn("[purchase-success] Failed to clear local cart:", e);
    }
  }

  async function lookupOrder(sessionId) {
    if (!supabase) {
      console.warn("[purchase-success] Supabase missing; skipping order lookup");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("stripe_checkout", sessionId)
        .maybeSingle();

      if (error) {
        console.warn("[purchase-success] order lookup error", error);
        return;
      }
      if (!data) {
        console.warn("[purchase-success] No order found for this session");
        return;
      }

      console.log("[purchase-success] Order found:", data);
    } catch (e) {
      console.warn("[purchase-success] lookup exception:", e);
    }
  }

  async function init() {
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get("session_id");

    if (!sessionId) {
      console.log("[purchase-success] No session_id in URL; leaving cart alone.");
      return;
    }

    // We reached the Stripe success URL with a session_id:
    // clear the local cart for this browser.
    clearLocalCart();

    // Optional: log/verify the order row in Supabase (for debugging/display later).
    await lookupOrder(sessionId);
  }

  init();
})();

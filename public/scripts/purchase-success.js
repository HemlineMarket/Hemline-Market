// File: public/scripts/purchase-success.js
// Handles post-purchase cleanup.
// - Reads session_id from URL
// - Looks up the order in Supabase for logging/debug
// - Clears browser cart (localStorage) so purchased items disappear
// - Lets success.html handle all UI

(function () {
  const supabase = window.HM?.supabase;
  if (!supabase) {
    console.warn("[purchase-success] Supabase client missing on window.HM.supabase");
    return;
  }

  async function init() {
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get("session_id");

    if (!sessionId) {
      console.log("[purchase-success] No session_id found — skipping order lookup");
      // Still clear the cart if someone reached success page without query params
      localStorage.removeItem("hm_cart");
      localStorage.removeItem("hm_cart_shipping");
      return;
    }

    // Fetch order for developer visibility (not shown in UI)
    const { data: order, error } = await supabase
      .from("orders")
      .select("*")
      .eq("stripe_checkout", sessionId)
      .maybeSingle();

    if (error) {
      console.warn("[purchase-success] Order lookup error:", error);
    } else if (!order) {
      console.warn("[purchase-success] No order found for this session_id");
    } else {
      console.log("[purchase-success] Order found:", order);
    }

    // 🔥 CRITICAL FIX: Clear browser cart after successful checkout
    try {
      localStorage.removeItem("hm_cart");
      localStorage.removeItem("hm_cart_shipping");
      console.log("[purchase-success] Browser cart cleared");
    } catch (e) {
      console.warn("[purchase-success] Could not clear cart", e);
    }
  }

  init();
})();

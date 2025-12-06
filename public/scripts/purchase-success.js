// File: public/scripts/purchase-success.js
// Reads the Stripe session_id from URL, fetches the order for display accuracy,
// and logs issues quietly. UI on success.html handles all visual messaging.

(function () {
  const supabase = window.HM?.supabase;
  if (!supabase) {
    console.warn("[purchase-success] supabase missing");
    return;
  }

  async function init() {
    // Example: success.html?session_id=cs_test_123
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get("session_id");

    if (!sessionId) {
      console.log("[purchase-success] No session_id found — nothing to fetch");
      return;
    }

    // We expect orders.stripe_checkout to match session_id
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

    // (Optional) In the future, we can enhance the success page with dynamic summary.
    // For now we keep UI static for simplicity.
  }

  init();
})();

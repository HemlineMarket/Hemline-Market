// File: public/scripts/order-success.js
// Inserts a buyer notification after a successful purchase.

(async function () {
  const supabase = window.HM && window.HM.supabase;
  if (!supabase) return;

  async function waitForUser(maxMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const { data } = await supabase.auth.getSession();
      const user = data?.session?.user;
      if (user) return user;
      await new Promise((r) => setTimeout(r, 120));
    }
    return null;
  }

  const user = await waitForUser();
  if (!user) return;

  const params = new URLSearchParams(window.location.search);
  const paymentSessionId = params.get("session_id") || params.get("sid");
  if (!paymentSessionId) return;

  let order = null;
  try {
    const { data } = await supabase
      .from("orders")
      .select("*")
      .eq("stripe_payment_intent", paymentSessionId)
      .limit(1)
      .single();

    order = data;
  } catch (err) {
    return;
  }

  if (!order) return;

  try {
    const preview =
      order.listing_title ||
      `Order #${order.id}` ||
      "Your purchase is confirmed";

    await supabase.from("notifications").insert({
      user_id: order.buyer_id,
      actor_id: order.buyer_id,
      type: "purchase",
      title: "Your purchase is confirmed",
      body: preview,
      listing_id: order.listing_id,
      href: `purchases.html`,
      link: `purchases.html`,
      is_read: false,
      read_at: null,
      metadata: {
        listing_id: order.listing_id,
        order_id: order.id,
        stripe_session: paymentSessionId
      }
    });
  } catch (_) {}

})();

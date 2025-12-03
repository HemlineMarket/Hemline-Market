// File: public/scripts/order-success.js
// Runs on the order success / confirmation page.
// Inserts a buyer notification: “Your purchase is confirmed”.

(async function () {
  const supabase = window.HM && window.HM.supabase;
  if (!supabase) {
    console.warn("[order-success] No HM.supabase available.");
    return;
  }

  // ---------------------------
  // 1. Wait for session
  // ---------------------------
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
  if (!user) {
    console.warn("[order-success] No user session.");
    return;
  }

  // ---------------------------
  // 2. Read payment session id
  // ---------------------------
  const params = new URLSearchParams(window.location.search);
  const paymentSessionId = params.get("session_id") || params.get("sid");

  if (!paymentSessionId) {
    console.warn("[order-success] No session_id in URL.");
    return;
  }

  // ---------------------------
  // 3. Fetch the created order
  // ---------------------------
  let order = null;
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("stripe_payment_intent", paymentSessionId)
      .limit(1)
      .single();

    if (error) {
      console.warn("[order-success] Could not fetch order:", error);
      return;
    }

    order = data;
  } catch (err) {
    console.warn("[order-success] Exception fetching order:", err);
    return;
  }

  if (!order) {
    console.warn("[order-success] Order not found for session:", paymentSessionId);
    return;
  }

  // ---------------------------
  // 4. Insert BUYER notification
  // ---------------------------
  try {
    const preview =
      order.listing_title ||
      `Order #${order.id}` ||
      "Your purchase is confirmed";

    await supabase.from("notifications").insert({
      user_id: order.buyer_id,        // buyer gets notified
      actor_id: order.buyer_id,       // buyer triggered it
      type: "purchase",
      kind: "purchase",
      title: "Your purchase is confirmed",
      body: preview,
      href: `purchases.html`,
      link: `purchases.html`,
      listing_id: order.listing_id,
      metadata: {
        listing_id: order.listing_id,
        order_id: order.id,
        stripe_session: paymentSessionId
      }
    });
  } catch (notifErr) {
    console.warn("[order-success] Notification insert failed:", notifErr);
  }

  console.log("[order-success] Buyer notification complete.");
})();

// public/scripts/sales.js
// Shows all orders where the logged-in user is the SELLER.

import {
  formatMoney,
  formatDate,
  extractListingTitle,
  extractTotalCents,
} from "./orders-utils.js";

(async () => {
  const supabase = window.HM && window.HM.supabase;
  if (!supabase) {
    console.error("[sales] Missing Supabase client");
    return;
  }

  // Same session helper as purchases.js
  async function ensureSession(maxMs = 3000) {
    let {
      data: { session },
    } = await supabase.auth.getSession();
    const start = Date.now();
    while (!session?.user && Date.now() - start < maxMs) {
      await new Promise((r) => setTimeout(r, 120));
      ({
        data: { session },
      } = await supabase.auth.getSession());
    }
    return session;
  }

  const session = await ensureSession();
  if (!session || !session.user) {
    window.location.href = "auth.html?view=login";
    return;
  }

  const uid = session.user.id;

  const list =
    document.getElementById("ordersList") ||
    document.getElementById("salesList");
  const empty = document.getElementById("emptyState");

  if (!list || !empty) {
    console.error("[sales] Missing DOM nodes (#ordersList/#salesList or #emptyState)");
    return;
  }

  // Load orders where this user is the SELLER
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("seller_id", uid)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[sales] Load error:", error);
    empty.style.display = "block";
    empty.textContent =
      "We couldn’t load your sales. Please refresh and try again.";
    return;
  }

  if (!data || data.length === 0) {
    empty.style.display = "block";
    empty.textContent = "You haven’t sold anything yet.";
    list.innerHTML = "";
    return;
  }

  empty.style.display = "none";
  list.innerHTML = "";

  data.forEach((order) => {
    const card = document.createElement("div");
    card.className = "order-card";

    const title = extractListingTitle(order);
    const totalCents = extractTotalCents(order);
    const buyerEmail = order.buyer_email || "(buyer email not available)";

    card.innerHTML = `
      <div class="order-top">
        <span>Order #${String(order.id).slice(0, 8)}</span>
        <span>${formatDate(order.created_at)}</span>
      </div>

      <div class="order-status">
        Status: ${String(order.status || "PAID").toUpperCase()}
      </div>

      <div class="order-meta">
        Buyer: ${buyerEmail}<br/>
        Items + shipping total: ${formatMoney(totalCents)} ${order.currency || "USD"}
      </div>

      <div class="order-items">
        <div><span class="name">${title}</span></div>
      </div>

      <div class="order-actions"></div>
    `;

    const actions = card.querySelector(".order-actions");

    // View listing
    if (order.listing_id) {
      const link = document.createElement("a");
      link.className = "btn";
      link.href = `listing.html?id=${encodeURIComponent(order.listing_id)}`;
      link.textContent = "View listing";
      actions.appendChild(link);
    }

    // Message buyer
    if (order.buyer_id) {
      const msg = document.createElement("a");
      msg.className = "btn";
      msg.href =
        `messages.html?user=${encodeURIComponent(order.buyer_id)}` +
        `&order=${encodeURIComponent(order.id)}`;
      msg.textContent = "Message buyer";
      actions.appendChild(msg);
    }

    list.appendChild(card);
  });
})();

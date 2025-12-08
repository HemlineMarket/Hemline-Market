// public/scripts/sales.js
// Shows all orders where the logged-in user is the seller.

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

  // Reuse the same session helper pattern as purchases
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

  // Allow for either #ordersList or #salesList
  const list =
    document.getElementById("ordersList") ||
    document.getElementById("salesList");
  const empty = document.getElementById("emptyState");

  if (!list || !empty) {
    console.error(
      "[sales] Missing DOM nodes (#ordersList/#salesList or #emptyState)"
    );
    return;
  }

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

    card.innerHTML = `
      <div class="order-top">
        <span>Sale #${String(order.id).slice(0, 8)}</span>
        <span>${formatDate(order.created_at)}</span>
      </div>

      <div class="order-status">
        Buyer: ${order.buyer_email || "(unknown buyer)"}
      </div>

      <div class="order-meta">
        Total: ${formatMoney(totalCents)} ${order.currency || "USD"}
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

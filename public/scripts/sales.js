// public/scripts/sales.js
// Loads the logged-in seller’s sales and supports seller-side cancellation.

// IMPORTANT: use an absolute path so this works no matter where sales.html lives.
import {
  formatMoney,
  formatDate,
  extractListingTitle,
  extractTotalCents,
} from "/scripts/orders-utils.js";

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

  // DOM nodes (same IDs as your existing HTML)
  const list =
    document.getElementById("salesList") ||
    document.getElementById("ordersList");
  const empty =
    document.getElementById("emptySalesState") ||
    document.getElementById("emptyState");

  if (!list || !empty) {
    console.error(
      "[sales] Missing DOM nodes (#salesList/#ordersList or #emptySalesState/#emptyState)"
    );
    return;
  }

  // Load sales for this seller (RLS ensures seller_id = auth.uid())
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

  console.log("[sales] uid:", uid, "sales rows:", data?.length ?? 0);

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

    const rawStatus = order.status || "paid";
    const statusUpper = String(rawStatus).toUpperCase();

    const isCancelableStatus =
      statusUpper === "PAID" || statusUpper === "PENDING";

    const canceledAt = order.canceled_at
      ? new Date(order.canceled_at)
      : null;
    const cancelReason = order.cancel_reason || "";

    card.innerHTML = `
      <div class="order-top">
        <span>Sale #${String(order.id).slice(0, 8)}</span>
        <span>${formatDate(order.created_at)}</span>
      </div>

      <div class="order-status">
        Status: ${statusUpper}
      </div>

      <div class="order-meta">
        Total: ${formatMoney(totalCents)} ${order.currency || "USD"}
      </div>

      <div class="order-items">
        <div><span class="name">${title}</span></div>
      </div>

      <div class="order-actions"></div>
      <div class="order-cancel-note"></div>
    `;

    const actions = card.querySelector(".order-actions");
    const cancelNoteEl = card.querySelector(".order-cancel-note");

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

    // Existing cancel info (if any)
    if (canceledAt || cancelReason) {
      const parts = [];
      if (canceledAt) parts.push(`Canceled at ${formatDate(canceledAt)}`);
      if (cancelReason) parts.push(cancelReason);
      cancelNoteEl.textContent = parts.join(" • ");
    }

    // Seller cancel (RLS enforces seller_id = uid)
    if (isCancelableStatus) {
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "btn btn-secondary";
      cancelBtn.type = "button";
      cancelBtn.textContent = "Cancel order";

      cancelBtn.addEventListener("click", async () => {
        if (
          !window.confirm(
            "Cancel this order? The buyer will see this as seller-canceled."
          )
        ) {
          return;
        }

        const reasonInput =
          window.prompt(
            "Reason for cancellation? (e.g. damaged, unfound, changed mind)",
            "Seller canceled: item unavailable"
          ) || "Seller canceled: item unavailable";

        cancelBtn.disabled = true;
        cancelBtn.textContent = "Cancelling…";

        const payload = {
          status: "seller_canceled",
          canceled_at: new Date().toISOString(),
          canceled_by: uid,
          cancel_reason: reasonInput,
        };

        const { data: updated, error: cancelError } = await supabase
          .from("orders")
          .update(payload)
          .eq("id", order.id)
          .eq("seller_id", uid)
          .select("status, canceled_at, cancel_reason")
          .single();

        if (cancelError) {
          console.error("[sales] Cancel error:", cancelError);
          window.alert(
            "We couldn’t cancel this order. Please refresh and try again."
          );
          cancelBtn.disabled = false;
          cancelBtn.textContent = "Cancel order";
          return;
        }

        const statusEl = card.querySelector(".order-status");
        if (statusEl) {
          const newStatusUpper = String(
            updated?.status || "seller_canceled"
          ).toUpperCase();
          statusEl.textContent = `Status: ${newStatusUpper}`;
        }

        cancelBtn.remove();

        const updatedCanceledAt = updated?.canceled_at
          ? new Date(updated.canceled_at)
          : null;
        const updatedReason =
          updated?.cancel_reason || "Order cancelled by seller.";

        const parts = [];
        if (updatedCanceledAt)
          parts.push(`Canceled at ${formatDate(updatedCanceledAt)}`);
        if (updatedReason) parts.push(updatedReason);
        cancelNoteEl.textContent = parts.join(" • ");
      });

      actions.appendChild(cancelBtn);
    }

    list.appendChild(card);
  });
})();

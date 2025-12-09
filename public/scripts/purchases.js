// public/scripts/purchases.js
// Loads the logged-in buyer’s purchase history and supports 30-minute cancellation.

import {
  formatMoney,
  formatDate,
  extractListingTitle,
  extractTotalCents,
  cancellationWindowHtml,
} from "./orders-utils.js";

(async () => {
  const supabase = window.HM && window.HM.supabase;
  if (!supabase) {
    console.error("[purchases] Missing Supabase client");
    return;
  }

  // Ensure session
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

  // Allow for either #ordersList or #purchasesList in the HTML
  const list =
    document.getElementById("ordersList") ||
    document.getElementById("purchasesList");
  const empty = document.getElementById("emptyState");

  if (!list || !empty) {
    console.error(
      "[purchases] Missing DOM nodes (#ordersList/#purchasesList or #emptyState)"
    );
    return;
  }

  // Load this buyer’s orders
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("buyer_id", uid)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[purchases] Load error:", error);
    empty.style.display = "block";
    empty.textContent =
      "We couldn’t load your purchases. Please refresh and try again.";
    return;
  }

  if (!data || data.length === 0) {
    empty.style.display = "block";
    empty.textContent = "You haven’t purchased anything yet.";
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
    const cancelNoteHtml = cancellationWindowHtml(order);

    const createdAt = order.created_at ? new Date(order.created_at) : null;
    const now = new Date();

    const rawStatus = order.status || "paid";
    const statusUpper = String(rawStatus).toUpperCase();

    // Only treat PAID / PENDING as cancel-eligible; COMPLETED and others are final
    const isCancelableStatus =
      statusUpper === "PAID" || statusUpper === "PENDING";

    const within30Min =
      createdAt && now.getTime() - createdAt.getTime() <= 30 * 60 * 1000;

    const canCancel = isCancelableStatus && within30Min;

    card.innerHTML = `
      <div class="order-top">
        <span>Purchase #${String(order.id).slice(0, 8)}</span>
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
      <div class="order-cancel-note">${cancelNoteHtml || ""}</div>
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

    // Message seller
    if (order.seller_id) {
      const msg = document.createElement("a");
      msg.className = "btn";
      msg.href =
        `messages.html?user=${encodeURIComponent(order.seller_id)}` +
        `&order=${encodeURIComponent(order.id)}`;
      msg.textContent = "Message seller";
      actions.appendChild(msg);
    }

    // 30-minute cancellation (buyer side)
    if (canCancel) {
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "btn btn-secondary";
      cancelBtn.type = "button";
      cancelBtn.textContent = "Cancel order";

      cancelBtn.addEventListener("click", async () => {
        if (
          !window.confirm(
            "Cancel this order? This will release the listing and cannot be undone."
          )
        ) {
          return;
        }

        cancelBtn.disabled = true;
        cancelBtn.textContent = "Cancelling…";

        // Double-check the 30-minute window at click time
        const latestNow = new Date();
        const created = order.created_at ? new Date(order.created_at) : null;
        if (
          !created ||
          latestNow.getTime() - created.getTime() > 30 * 60 * 1000
        ) {
          window.alert(
            "This order can no longer be cancelled because the 30-minute window has passed."
          );
          cancelBtn.disabled = false;
          cancelBtn.textContent = "Cancel order";
          return;
        }

        // Update order as buyer-canceled and record metadata
        const cancelPayload = {
          status: "buyer_canceled",
          canceled_at: new Date().toISOString(),
          canceled_by: uid,
          cancel_reason: "Buyer canceled within 30 minutes.",
        };

        const { data: updated, error: cancelError } = await supabase
          .from("orders")
          .update(cancelPayload)
          .eq("id", order.id)
          .eq("buyer_id", uid)
          .select("status, canceled_at, cancel_reason")
          .single();

        if (cancelError) {
          console.error("[purchases] Cancel error:", cancelError);
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
            updated?.status || "buyer_canceled"
          ).toUpperCase();
          statusEl.textContent = `Status: ${newStatusUpper}`;
        }

        cancelBtn.remove();

        const noteEl = card.querySelector(".order-cancel-note");
        if (noteEl) {
          const reasonText =
            updated?.cancel_reason ||
            "Order cancelled within the 30-minute window.";
          noteEl.textContent = reasonText;
        }
      });

      actions.appendChild(cancelBtn);
    }

    list.appendChild(card);
  });
})();

// scripts/sales.js
// Hemline Market — Seller Sales page
//
// Requirements:
// - <div id="sales-root"></div> in account/sales.html
// - This script loaded with: <script type="module" src="/scripts/sales.js"></script>
// - scripts/supabase-client.js must export `supabase`

import { supabase } from "./supabase-client.js";

const salesRoot = document.getElementById("sales-root");
const loadingEl = document.getElementById("sales-loading");
const emptyEl = document.getElementById("sales-empty");
const errorEl = document.getElementById("sales-error");

function showLoading(show) {
  if (!loadingEl) return;
  loadingEl.style.display = show ? "flex" : "none";
}

function showError(message) {
  if (!errorEl) return;
  errorEl.textContent = message || "Something went wrong loading your sales.";
  errorEl.style.display = "block";
}

function showEmpty(show) {
  if (!emptyEl) return;
  emptyEl.style.display = show ? "block" : "none";
}

async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function canSellerCancel(order) {
  // Mirror RLS: only when status is paid/pending
  return order.status === "paid" || order.status === "pending";
}

function renderSales(orders) {
  if (!salesRoot) return;

  salesRoot.innerHTML = "";

  if (!orders || orders.length === 0) {
    showEmpty(true);
    return;
  }

  showEmpty(false);

  const list = document.createElement("div");
  list.className = "hm-sales-list";

  orders.forEach((order) => {
    const item = document.createElement("article");
    item.className = "hm-sales-item";

    const header = document.createElement("div");
    header.className = "hm-sales-header";

    const title = document.createElement("div");
    title.className = "hm-sales-title";
    // Use listing_title if you store it, otherwise show listing_id
    const listingLabel = order.listing_title || `Listing #${order.listing_id}`;
    title.textContent = listingLabel;

    const statusBadge = document.createElement("span");
    statusBadge.className = `hm-badge hm-badge-${order.status}`;
    statusBadge.textContent = order.status.replace("_", " ");

    header.appendChild(title);
    header.appendChild(statusBadge);

    const meta = document.createElement("div");
    meta.className = "hm-sales-meta";
    const created = formatDate(order.created_at);
    const buyer = order.buyer_name || order.buyer_email || "Buyer";
    const amount =
      order.total_amount != null
        ? `${(order.total_amount / 100).toFixed(2)} ${order.currency || ""}`
        : "";

    meta.textContent = `${buyer} • ${created}${amount ? " • " + amount : ""}`;

    const footer = document.createElement("div");
    footer.className = "hm-sales-footer";

    const left = document.createElement("div");
    left.className = "hm-sales-footer-left";

    if (order.canceled_at) {
      const cancelInfo = document.createElement("div");
      cancelInfo.className = "hm-sales-cancel-info";
      cancelInfo.textContent = `Canceled at ${formatDate(
        order.canceled_at
      )}${order.cancel_reason ? " • " + order.cancel_reason : ""}`;
      left.appendChild(cancelInfo);
    }

    const right = document.createElement("div");
    right.className = "hm-sales-footer-right";

    if (canSellerCancel(order)) {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "hm-button hm-button-outline hm-button-danger";
      cancelBtn.textContent = "Cancel order";
      cancelBtn.addEventListener("click", () =>
        handleSellerCancel(order.id, item)
      );
      right.appendChild(cancelBtn);
    }

    footer.appendChild(left);
    footer.appendChild(right);

    item.appendChild(header);
    item.appendChild(meta);
    item.appendChild(footer);

    list.appendChild(item);
  });

  salesRoot.appendChild(list);
}

async function handleSellerCancel(orderId, domNode) {
  const confirmCancel = window.confirm(
    "Cancel this order? The buyer will see this as seller-canceled."
  );
  if (!confirmCancel) return;

  try {
    // Optional prompt for reason
    const reason =
      window.prompt(
        "Reason for cancellation? (e.g. damaged, unfound, changed mind)",
        "Seller canceled: item unavailable"
      ) || "Seller canceled: item unavailable";

    const { error } = await supabase
      .from("orders")
      .update({
        status: "seller_canceled",
        canceled_at: new Date().toISOString(),
        cancel_reason: reason
      })
      .eq("id", orderId);

    if (error) {
      console.error(error);
      window.alert("Could not cancel order. Please try again.");
      return;
    }

    // Optimistic UI: mark the row as canceled
    if (domNode) {
      domNode.classList.add("hm-sales-item-canceled");
      const badge = domNode.querySelector(".hm-badge");
      if (badge) badge.textContent = "seller canceled";
      const buttons = domNode.querySelectorAll("button");
      buttons.forEach((btn) => (btn.disabled = true));
    }
  } catch (err) {
    console.error(err);
    window.alert("Could not cancel order. Please try again.");
  }
}

async function loadSales() {
  try {
    showLoading(true);
    showError(null);
    showEmpty(false);

    const user = await getCurrentUser();
    if (!user) {
      showLoading(false);
      if (salesRoot) {
        salesRoot.innerHTML =
          '<p class="hm-text-muted">Please sign in to view your sales.</p>';
      }
      return;
    }

    const { data: orders, error } = await supabase
      .from("orders")
      .select("*")
      .eq("seller_id", user.id)
      .order("created_at", { ascending: false });

    showLoading(false);

    if (error) {
      console.error(error);
      showError("Could not load your sales.");
      return;
    }

    renderSales(orders || []);
  } catch (err) {
    console.error(err);
    showLoading(false);
    showError("Could not load your sales.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadSales();
});

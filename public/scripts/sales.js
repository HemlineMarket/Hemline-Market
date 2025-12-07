// File: public/scripts/sales.js
// Shows seller's completed orders using the hemline_sales_view view.

(function () {
  const HM = window.HM || {};
  const supabase = HM.supabase;

  if (!supabase) {
    console.error("[sales] Supabase client missing on window.HM.supabase");
    return;
  }

  const ordersListEl = document.getElementById("ordersList");
  const emptyStateEl = document.getElementById("emptyState");

  function moneyFromCents(c) {
    if (c == null) return "$0.00";
    const v = c / 100;
    return v.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  async function ensureSession() {
    const { data } = await supabase.auth.getSession();
    return data.session || null;
  }

  function shortOrderId(stripeCheckout) {
    if (!stripeCheckout) return "";
    // Take last 6 chars as a lightweight order reference
    return stripeCheckout.slice(-6);
  }

  function renderEmpty(message) {
    if (ordersListEl) ordersListEl.innerHTML = "";
    if (emptyStateEl) {
      emptyStateEl.textContent = message || "You haven’t sold anything yet.";
      emptyStateEl.style.display = "block";
    }
  }

  function renderOrders(rows) {
    if (!ordersListEl) return;

    if (!rows || !rows.length) {
      renderEmpty("You haven’t sold anything yet.");
      return;
    }

    if (emptyStateEl) emptyStateEl.style.display = "none";
    ordersListEl.innerHTML = "";

    rows.forEach((row) => {
      const itemsCents = row.items_cents ?? 0;
      const shippingCents = row.shipping_cents ?? 0;
      const totalCents =
        row.total_cents != null ? row.total_cents : itemsCents + shippingCents;

      const listingTitle = row.listing_title || "Fabric purchase";
      const orderRef = shortOrderId(row.stripe_checkout);

      const createdAt = row.created_at ? new Date(row.created_at) : null;
      const dateLabel = createdAt
        ? createdAt.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "";

      const card = document.createElement("article");
      card.className = "order-card";

      card.innerHTML = `
        <div class="order-top">
          <div>
            <div>Order ${orderRef ? "#" + orderRef : ""}</div>
            <div class="order-meta">
              Status: <strong>PAID</strong>
              ${dateLabel ? " • " + dateLabel : ""}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:700;">${moneyFromCents(totalCents)}</div>
            <div class="order-meta">Total (items + shipping)</div>
          </div>
        </div>

        <div style="margin-bottom:6px;font-weight:600;">${listingTitle}</div>

        <div class="order-meta">
          Items: ${moneyFromCents(itemsCents)}
          • Shipping: ${moneyFromCents(shippingCents)}
        </div>

        <a class="btn" href="listing.html?id=${encodeURIComponent(
          row.listing_id
        )}">
          View listing
        </a>
      `;

      ordersListEl.appendChild(card);
    });
  }

  async function loadSales() {
    const session = await ensureSession();

    if (!session || !session.user) {
      renderEmpty("Sign in to see your sales.");
      return;
    }

    const sellerId = session.user.id;

    // Query the sales view we created in SQL
    const { data, error } = await supabase
      .from("hemline_sales_view")
      .select("*")
      .eq("seller_id", sellerId);

    if (error) {
      console.error("[sales] load error", error);
      renderEmpty("We couldn’t load your sales right now.");
      return;
    }

    renderOrders(data || []);
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadSales();
  });
})();

// File: public/scripts/sales.js
// Shows the current user's SALES (orders where they are the seller),
// using the `seller_orders_view` defined in SQL.

(function () {
  const HM = window.HM || {};
  const supabase = HM.supabase;

  if (!supabase) {
    console.warn("[sales] Supabase client missing on window.HM.supabase");
    return;
  }

  const ordersListEl = document.getElementById("ordersList");
  const emptyStateEl = document.getElementById("emptyState");

  function fmtMoney(cents) {
    if (cents == null) return "$0.00";
    const v = cents / 100;
    return v.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function shortId(id) {
    if (!id) return "";
    const s = String(id);
    return s.length > 8 ? s.slice(0, 8) : s;
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  async function ensureSession(maxMs = 3000) {
    const start = Date.now();
    let { data: { session } = { session: null } } = await supabase.auth.getSession();

    while (!session?.user && Date.now() - start < maxMs) {
      await new Promise((res) => setTimeout(res, 120));
      ({ data: { session } = { session: null } } =
        await supabase.auth.getSession());
    }
    return session || null;
  }

  function renderEmpty(message) {
    if (ordersListEl) ordersListEl.innerHTML = "";
    if (emptyStateEl) {
      emptyStateEl.textContent = message;
      emptyStateEl.style.display = "block";
    }
  }

  function renderOrders(rows) {
    if (!ordersListEl) return;

    ordersListEl.innerHTML = "";
    if (!rows || !rows.length) {
      renderEmpty("You haven’t sold anything yet.");
      return;
    }

    if (emptyStateEl) emptyStateEl.style.display = "none";

    rows.forEach((row) => {
      const card = document.createElement("article");
      card.className = "order-card";

      const orderId = shortId(row.id);
      const dateStr = fmtDate(row.created_at);
      const status = (row.status || "paid").toUpperCase();

      const itemsAmount = fmtMoney(row.items_cents || 0);
      const shippingAmount = fmtMoney(row.shipping_cents || 0);
      const totalAmount = fmtMoney(row.total_cents || 0);

      const title = row.listing_title || "Fabric purchase";

      card.innerHTML = `
        <div class="order-top">
          <div>Order #${orderId}</div>
          <div>${dateStr}</div>
        </div>
        <div class="order-meta">
          <div><strong>Status:</strong> ${status}</div>
          <div><strong>Listing:</strong> ${title}</div>
          <div>
            <strong>Items:</strong> ${itemsAmount}
            &nbsp;•&nbsp;
            <strong>Shipping:</strong> ${shippingAmount}
          </div>
          <div><strong>Total paid by buyer:</strong> ${totalAmount}</div>
        </div>
        <a href="listing.html?id=${encodeURIComponent(
          row.listing_id
        )}" class="btn">View listing</a>
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

    const { data, error } = await supabase
      .from("seller_orders_view")
      .select(
        "id, created_at, status, items_cents, shipping_cents, total_cents, listing_id, listing_title, seller_id"
      )
      .eq("seller_id", sellerId)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[sales] error loading sales", error);
      renderEmpty("We couldn’t load your sales right now.");
      return;
    }

    renderOrders(data || []);
  }

  document.addEventListener("DOMContentLoaded", loadSales);
})();

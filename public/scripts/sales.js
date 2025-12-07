// public/scripts/sales.js
// Shows orders where the current user is the SELLER.
// Uses Supabase join: orders + listings (via foreign key orders.listing_id → listings.id).

(function () {
  const HM = window.HM || {};
  const supabase = HM.supabase;

  if (!supabase) {
    console.error("[sales] Supabase client missing on window.HM.supabase");
    return;
  }

  const ordersListEl = document.getElementById("ordersList");
  const emptyStateEl = document.getElementById("emptyState");

  function fmtMoney(cents) {
    const v = (Number(cents) || 0) / 100;
    return v.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function shortDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function shortOrderId(stripeId, fallbackId) {
    if (stripeId && typeof stripeId === "string") {
      return "#" + stripeId.slice(-8);
    }
    if (fallbackId) {
      return "#" + String(fallbackId).slice(0, 8);
    }
    return "#—";
  }

  async function ensureSession(maxMs = 4000) {
    let {
      data: { session },
    } = await supabase.auth.getSession();

    const start = Date.now();
    while (!session?.user && Date.now() - start < maxMs) {
      await new Promise((res) => setTimeout(res, 120));
      ({
        data: { session },
      } = await supabase.auth.getSession());
    }
    return session || null;
  }

  function renderEmpty() {
    if (ordersListEl) ordersListEl.innerHTML = "";
    if (emptyStateEl) emptyStateEl.style.display = "block";
  }

  function renderError(message) {
    if (!ordersListEl) return;
    ordersListEl.innerHTML =
      '<p style="color:#b91c1c;font-size:14px;">' +
      (message || "We couldn’t load your sales. Please try again.") +
      "</p>";
    if (emptyStateEl) emptyStateEl.style.display = "none";
  }

  function renderSales(orders) {
    if (!ordersListEl) return;

    if (!orders || !orders.length) {
      renderEmpty();
      return;
    }

    if (emptyStateEl) emptyStateEl.style.display = "none";
    ordersListEl.innerHTML = "";

    orders.forEach((o) => {
      const listing = o.listings || {};
      const listingTitle = listing.title || "Fabric purchase";

      const itemsCents =
        o.items_cents != null
          ? Number(o.items_cents)
          : Math.max(
              (Number(o.total_cents) || 0) - (Number(o.shipping_cents) || 0),
              0
            );

      const shippingCents = Number(o.shipping_cents) || 0;
      const totalCents =
        o.total_cents != null
          ? Number(o.total_cents)
          : itemsCents + shippingCents;

      const orderNumber = shortOrderId(o.stripe_checkout, o.id);
      const created = shortDate(o.created_at);

      const card = document.createElement("article");
      card.className = "order-card";

      card.innerHTML = `
        <div class="order-top">
          <div>
            <div>${listingTitle}</div>
            <div class="order-meta">${created} · ${orderNumber}</div>
          </div>
          <div style="text-align:right;">
            <div><strong>${fmtMoney(totalCents)}</strong> total</div>
            <div class="order-meta">
              Items: ${fmtMoney(itemsCents)} · Shipping: ${fmtMoney(
        shippingCents
      )}
            </div>
          </div>
        </div>

        <div class="order-meta">
          Status: <strong>PAID</strong>
        </div>

        <a class="btn" href="listing.html?id=${encodeURIComponent(
          o.listing_id
        )}">View listing</a>
      `;

      ordersListEl.appendChild(card);
    });
  }

  async function loadSales() {
    const session = await ensureSession();
    if (!session || !session.user) {
      renderError("Sign in to see your sales.");
      return;
    }

    const sellerId = session.user.id;

    const { data, error } = await supabase
      .from("orders")
      .select(
        `
        id,
        created_at,
        items_cents,
        shipping_cents,
        total_cents,
        buyer_id,
        stripe_checkout,
        listing_id,
        listings!inner (
          id,
          seller_id,
          title
        )
      `
      )
      .eq("listings.seller_id", sellerId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[sales] orders query error", error);
      renderError("We couldn’t load your sales. Please try again.");
      return;
    }

    renderSales(data || []);
  }

  window.addEventListener("DOMContentLoaded", loadSales);
})();

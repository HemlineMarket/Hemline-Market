// public/scripts/sales.js
// Shows all orders for listings owned by the logged-in seller.

(function () {
  const supabase = window.HM && window.HM.supabase;
  if (!supabase) {
    console.error("[sales] Missing Supabase client");
    return;
  }

  const ordersList = document.getElementById("ordersList");
  const emptyState = document.getElementById("emptyState");

  if (!ordersList || !emptyState) {
    console.error("[sales] Missing #ordersList or #emptyState");
    return;
  }

  function formatMoneyCents(cents, currency) {
    const val = (Number(cents) || 0) / 100;
    const code = (currency || "USD").toUpperCase();
    return val.toLocaleString("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

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

  async function init() {
    const session = await ensureSession();
    if (!session || !session.user) {
      ordersList.innerHTML =
        '<p style="color:#6b7280;font-size:14px;">Please sign in to view sales.</p>';
      return;
    }

    const sellerId = session.user.id;

    // 1) Find all listings owned by this seller
    const { data: listings, error: listingsErr } = await supabase
      .from("listings")
      .select("id, title")
      .eq("seller_id", sellerId);

    if (listingsErr) {
      console.error("[sales] listings fetch error:", listingsErr);
      emptyState.style.display = "block";
      emptyState.textContent =
        "We couldn’t load your sales. Please refresh and try again.";
      ordersList.innerHTML = "";
      return;
    }

    const listingIds = (listings || [])
      .map((l) => l.id)
      .filter((id) => !!id);

    if (!listingIds.length) {
      emptyState.style.display = "block";
      emptyState.textContent = "You haven’t sold anything yet.";
      ordersList.innerHTML = "";
      return;
    }

    // 2) Load orders that reference those listings
    const { data: orders, error: ordersErr } = await supabase
      .from("orders")
      .select("*")
      .in("listing_id", listingIds)
      .order("created_at", { ascending: false });

    if (ordersErr) {
      console.error("[sales] orders fetch error:", ordersErr);
      emptyState.style.display = "block";
      emptyState.textContent =
        "We couldn’t load your sales. Please refresh and try again.";
      ordersList.innerHTML = "";
      return;
    }

    if (!orders || !orders.length) {
      emptyState.style.display = "block";
      emptyState.textContent = "You haven’t sold anything yet.";
      ordersList.innerHTML = "";
      return;
    }

    emptyState.style.display = "none";
    render(orders, listings);
  }

  function render(orders, listings) {
    const titleByListingId = {};
    (listings || []).forEach((l) => {
      if (l.id) {
        titleByListingId[l.id] = l.title || "Listing";
      }
    });

    ordersList.innerHTML = orders
      .map((order) => {
        const listingTitle =
          order.listing_title ||
          titleByListingId[order.listing_id] ||
          "Listing";

        const currency = order.currency || "USD";

        const itemsCents = Number(order.items_cents) || 0;
        const shippingCents = Number(order.shipping_cents) || 0;
        const totalCents =
          Number(order.total_cents) || itemsCents + shippingCents;

        const itemsMoney = formatMoneyCents(itemsCents, currency);
        const shippingMoney = formatMoneyCents(shippingCents, currency);
        const totalMoney = formatMoneyCents(totalCents, currency);

        const created = formatDate(order.created_at);
        const shortId = String(order.id || "").slice(0, 8);
        const status = String(order.status || "PAID").toUpperCase();

        const buyerId = order.buyer_id || "";
        const msgHref = buyerId
          ? `messages.html?user=${encodeURIComponent(
              buyerId
            )}&order=${encodeURIComponent(order.id)}`
          : "";

        return `
          <div class="order-card">
            <div class="order-top">
              <div>Sale #${shortId}</div>
              <div>${created}</div>
            </div>

            <div class="order-meta">
              <strong>${listingTitle}</strong><br/>
              Status: ${status}<br/>
              Item: ${itemsMoney}<br/>
              Shipping charged: ${shippingMoney}<br/>
              <strong>Buyer paid: ${totalMoney}</strong>
            </div>

            ${
              msgHref
                ? `<a href="${msgHref}" class="btn">Message buyer</a>`
                : ""
            }
          </div>
        `;
      })
      .join("");
  }

  init();
})();

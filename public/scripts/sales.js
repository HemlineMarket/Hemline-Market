// public/scripts/sales.js
// Shows all orders where the logged-in user is the seller.

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

  // Small helpers
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

  // Ensure we have a session (like purchases.js)
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

    // Load all orders where this user is the seller
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("seller_id", sellerId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[sales] Load error:", error);
      emptyState.style.display = "block";
      emptyState.textContent =
        "We couldn’t load your sales. Please refresh and try again.";
      ordersList.innerHTML = "";
      return;
    }

    if (!data || data.length === 0) {
      emptyState.style.display = "block";
      emptyState.textContent = "You haven’t sold anything yet.";
      ordersList.innerHTML = "";
      return;
    }

    emptyState.style.display = "none";
    render(data);
  }

  function render(rows) {
    ordersList.innerHTML = rows
      .map((order) => {
        const title =
          order.listing_title && String(order.listing_title).trim().length
            ? order.listing_title
            : "Listing";

        const buyerEmail = order.buyer_email || "(buyer email hidden)";
        const buyerId = order.buyer_id || "";

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

        const messageHref = buyerId
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
              <strong>${title}</strong><br/>
              Status: ${status}<br/>
              Buyer: ${buyerEmail}<br/>
              Item: ${itemsMoney}<br/>
              Shipping: ${shippingMoney}<br/>
              <strong>Total: ${totalMoney}</strong>
            </div>

            ${
              messageHref
                ? `<a href="${messageHref}" class="btn">Message buyer</a>`
                : ""
            }
          </div>
        `;
      })
      .join("");
  }

  init();
})();

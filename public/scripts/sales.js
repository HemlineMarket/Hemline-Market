// public/scripts/sales.js
// Loads all completed orders where the logged-in user is the seller.

(function () {
  const supabase = window.HM?.supabase;
  if (!supabase) return;

  const ordersList = document.getElementById("ordersList");
  const emptyState = document.getElementById("emptyState");

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      ordersList.innerHTML = `<p>Please sign in to view sales.</p>`;
      return;
    }

    const sellerId = user.id;

    const { data, error } = await supabase
      .from("seller_orders_view")
      .select("*")
      .eq("seller_id", sellerId)
      .order("created_at", { ascending: false });

    if (error) {
      ordersList.innerHTML = `<p>Could not load sales.</p>`;
      return;
    }

    if (!data || data.length === 0) {
      emptyState.style.display = "block";
      return;
    }

    emptyState.style.display = "none";
    render(data);
  }

  function render(rows) {
    ordersList.innerHTML = rows
      .map((o) => {
        const price = (o.items_cents || 0) / 100;
        const shipping = (o.shipping_cents || 0) / 100;
        const total = (o.total_cents || 0) / 100;

        return `
          <div class="order-card">
            <div class="order-top">
              <div>Order ${String(o.id).slice(0, 8)}</div>
              <div>${new Date(o.created_at).toLocaleDateString()}</div>
            </div>

            <div class="order-meta">
              <strong>${o.listing_title || o.listing_name || "Listing"}</strong><br/>
              Buyer: ${o.buyer_email || "(unknown)"}<br/>
              Item: $${price.toFixed(2)}<br/>
              Shipping: $${shipping.toFixed(2)}<br/>
              <strong>Total: $${total.toFixed(2)}</strong><br/>
            </div>

            <a href="messages.html?user=${o.buyer_id}" class="btn">
              Message Buyer
            </a>
          </div>
        `;
      })
      .join("");
  }

  init();
})();

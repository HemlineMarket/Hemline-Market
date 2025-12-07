// File: public/scripts/sales.js
// Show all orders where the current user owns the listing (seller).

(function () {
  const supabase = window.HM?.supabase;
  if (!supabase) {
    console.warn("[sales] missing supabase client");
    return;
  }

  const ordersList = document.getElementById("ordersList");
  const emptyState = document.getElementById("emptyState");

  async function init() {
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      ordersList.innerHTML =
        '<p style="color:#6b7280;font-size:14px;">Please sign in to view your sales.</p>';
      return;
    }

    const sellerId = user.id;

    // IMPORTANT: join orders → listings and filter by listings.seller_id
    const { data, error } = await supabase
      .from("orders")
      .select(
        `
        id,
        buyer_id,
        buyer_email,
        items_cents,
        shipping_cents,
        total_cents,
        listing_title,
        created_at,
        listings!inner(id,seller_id)
      `
      )
      .eq("listings.seller_id", sellerId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[sales] fetch error:", error);
      ordersList.innerHTML =
        '<p style="color:#991b1b;">Could not load sales.</p>';
      return;
    }

    if (!data || data.length === 0) {
      emptyState.style.display = "block";
      ordersList.innerHTML = "";
      return;
    }

    emptyState.style.display = "none";
    render(data);
  }

  function render(rows) {
    ordersList.innerHTML = rows
      .map((o) => {
        const items = (o.items_cents || 0) / 100;
        const shipping = (o.shipping_cents || 0) / 100;
        const total = (o.total_cents || 0) / 100;
        const dateStr = o.created_at
          ? new Date(o.created_at).toLocaleDateString()
          : "";

        return `
          <div class="order-card">
            <div class="order-top">
              <div>Order #${String(o.id).slice(0, 8)}</div>
              <div>${dateStr}</div>
            </div>

            <div class="order-meta">
              <strong>${o.listing_title || "Listing"}</strong><br/>
              Buyer: ${o.buyer_email || "(unknown)"}<br/>
              Items: $${items.toFixed(2)} • Shipping: $${shipping.toFixed(
          2
        )}<br/>
              <strong>Total: $${total.toFixed(2)}</strong>
            </div>

            ${
              o.buyer_id
                ? `<a href="messages.html?user=${encodeURIComponent(
                    o.buyer_id
                  )}" class="btn">Message buyer</a>`
                : ""
            }
          </div>
        `;
      })
      .join("");
  }

  init();
})();

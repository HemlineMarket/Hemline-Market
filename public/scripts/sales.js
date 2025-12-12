// public/scripts/sales.js
// Seller Sales page — Poshmark-style list

(async () => {
  const supabase = window.HM?.supabase;
  if (!supabase) {
    console.error("[sales] Supabase not available");
    return;
  }

  /* ---------- helpers ---------- */
  const $ = (id) => document.getElementById(id);

  const formatMoney = (cents) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
    }).format((cents || 0) / 100);

  const formatDate = (d) =>
    new Date(d).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const statusLabel = (s) => {
    const map = {
      PAID: "Sold",
      SHIPPED: "Shipped",
      IN_TRANSIT: "In Transit",
      DELIVERED: "Delivered",
      COMPLETED: "Completed",
      CANCELED: "Canceled",
      REFUNDED: "Refunded",
      PENDING: "Pending",
    };
    return map[s] || s;
  };

  /* ---------- session ---------- */
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    window.location.href = "auth.html?view=login";
    return;
  }

  const sellerId = session.user.id;

  const list = $("ordersList");
  const empty = $("emptyState");

  /* ---------- load sales ---------- */
  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      "id, status, created_at, total_cents, buyer_id, buyer_email, listing_title, listing_image_url"
    )
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[sales] load error", error);
    empty.style.display = "block";
    empty.textContent = "Unable to load sales.";
    return;
  }

  if (!orders || orders.length === 0) {
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  list.innerHTML = "";

  /* ---------- render ---------- */
  orders.forEach((o) => {
    const row = document.createElement("div");
    row.className = "order-card";
    row.style.display = "flex";
    row.style.gap = "12px";
    row.style.alignItems = "center";
    row.style.cursor = "pointer";

    row.innerHTML = `
      <div style="width:64px;height:64px;background:#f3f4f6;border-radius:8px;flex-shrink:0;overflow:hidden">
        ${
          o.listing_image_url
            ? `<img src="${o.listing_image_url}" style="width:100%;height:100%;object-fit:cover"/>`
            : ""
        }
      </div>

      <div style="flex:1">
        <div style="font-weight:600">${o.listing_title || "Listing"}</div>
        <div style="font-size:13px;color:#6b7280">
          ${statusLabel(o.status)} • ${formatDate(o.created_at)}
        </div>
        <div style="font-size:13px;color:#6b7280">
          Buyer: ${o.buyer_email || "—"}
        </div>
      </div>

      <div style="text-align:right">
        <div style="font-weight:700">${formatMoney(o.total_cents)}</div>
        <div style="font-size:18px;color:#9ca3af">›</div>
      </div>
    `;

    // future: navigate to order detail page
    // row.onclick = () => location.href = `sale.html?id=${o.id}`;

    list.appendChild(row);
  });
})();

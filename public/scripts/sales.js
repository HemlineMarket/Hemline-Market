// public/scripts/sales.js
// Seller Sales page — Poshmark-style list + self-diagnosis

(async () => {
  const supabase = window.HM?.supabase;
  if (!supabase) {
    console.error("[sales] Supabase not available");
    return;
  }

  const list = document.getElementById("ordersList");
  const empty = document.getElementById("emptyState");
  if (!list || !empty) return;

  const formatMoney = (cents) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(
      (cents || 0) / 100
    );

  const formatDate = (d) =>
    new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

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

  // Session
  const { data: sessionRes } = await supabase.auth.getSession();
  const session = sessionRes?.session;
  if (!session?.user) {
    window.location.href = "auth.html?view=login";
    return;
  }

  const uid = session.user.id;
  const email = session.user.email || "";

  // Quick counts (to explain empty state)
  const [{ count: sellerCount, error: sellerCountErr }, { count: buyerCount, error: buyerCountErr }] =
    await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("seller_id", uid),
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("buyer_id", uid),
    ]);

  if (sellerCountErr) console.error("[sales] sellerCount error", sellerCountErr);
  if (buyerCountErr) console.error("[sales] buyerCount error", buyerCountErr);

  // If no seller sales, explain WHY (wrong account most likely)
  if (!sellerCount || sellerCount === 0) {
    empty.style.display = "block";
    empty.innerHTML = `
      <div style="max-width:680px;margin:28px auto;padding:14px 16px;border:1px solid #e5e7eb;border-radius:12px;background:#fff">
        <div style="font-weight:700;margin-bottom:6px">No sales found for this account.</div>
        <div style="color:#6b7280;font-size:13px;line-height:1.5">
          Signed in as: <b>${email || "unknown"}</b><br/>
          User id: <code style="font-size:12px">${uid}</code><br/>
          Sales as seller: <b>${sellerCount ?? 0}</b><br/>
          Orders as buyer: <b>${buyerCount ?? 0}</b>
        </div>
        <div style="margin-top:10px;color:#6b7280;font-size:13px;line-height:1.5">
          If you created test orders under a different seller_id, sign into that seller account to see them here.
        </div>
      </div>
    `;
    list.innerHTML = "";
    return;
  }

  // Load sales
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, status, created_at, total_cents, buyer_email, listing_title, listing_image_url")
    .eq("seller_id", uid)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[sales] load error", error);
    empty.style.display = "block";
    empty.textContent = "Unable to load sales.";
    return;
  }

  if (!orders || orders.length === 0) {
    empty.style.display = "block";
    empty.textContent = "You haven’t sold anything yet.";
    list.innerHTML = "";
    return;
  }

  empty.style.display = "none";
  list.innerHTML = "";

  orders.forEach((o) => {
    const row = document.createElement("div");
    row.className = "order-card";
    row.style.display = "flex";
    row.style.gap = "12px";
    row.style.alignItems = "center";

    row.innerHTML = `
      <div style="width:64px;height:64px;background:#f3f4f6;border-radius:8px;flex-shrink:0;overflow:hidden">
        ${o.listing_image_url ? `<img src="${o.listing_image_url}" style="width:100%;height:100%;object-fit:cover"/>` : ""}
      </div>

      <div style="flex:1">
        <div style="font-weight:600">${o.listing_title || "Listing"}</div>
        <div style="font-size:13px;color:#6b7280">${statusLabel(o.status)} • ${formatDate(o.created_at)}</div>
        <div style="font-size:13px;color:#6b7280">Buyer: ${o.buyer_email || "—"}</div>
      </div>

      <div style="text-align:right">
        <div style="font-weight:700">${formatMoney(o.total_cents)}</div>
        <div style="font-size:18px;color:#9ca3af">›</div>
      </div>
    `;

    list.appendChild(row);
  });
})();

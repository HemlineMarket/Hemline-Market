// public/scripts/sales.js
// Seller Sales page — Poshmark-style list (clickable) + thumbnail fallbacks

(async () => {
  const supabase = window.HM?.supabase;
  if (!supabase) return;

  const list = document.getElementById("ordersList");
  const empty = document.getElementById("emptyState");
  if (!list || !empty) return;

  const formatMoney = (cents) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(
      (cents || 0) / 100
    );

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

  // Session
  const { data: sessionRes } = await supabase.auth.getSession();
  const session = sessionRes?.session;
  if (!session?.user) {
    window.location.href = "auth.html?view=login";
    return;
  }
  const sellerId = session.user.id;

  // Load sales
  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      "id, status, created_at, total_cents, buyer_email, listing_id, listing_title, listing_image_url, listing_snapshot"
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
    empty.textContent = "You haven’t sold anything yet.";
    list.innerHTML = "";
    return;
  }

  // Build a listing_id -> image_url map for missing thumbnails
  const needListingIds = Array.from(
    new Set(
      orders
        .map((o) => o.listing_id)
        .filter((id) => !!id)
        .filter((id) => {
          const o = orders.find((x) => x.listing_id === id);
          return !o?.listing_image_url;
        })
    )
  );

  const listingImageById = {};
  if (needListingIds.length > 0) {
    const { data: listings, error: listingsErr } = await supabase
      .from("listings")
      .select("id, image_url")
      .in("id", needListingIds);

    if (listingsErr) {
      console.warn("[sales] listings image lookup error", listingsErr);
    } else {
      (listings || []).forEach((l) => {
        if (l?.id && l?.image_url) listingImageById[l.id] = l.image_url;
      });
    }
  }

  const getThumb = (o) => {
    // 1) explicit cached column on orders
    if (o.listing_image_url) return o.listing_image_url;

    // 2) listings table lookup
    if (o.listing_id && listingImageById[o.listing_id]) return listingImageById[o.listing_id];

    // 3) snapshot fallbacks
    const snap = o.listing_snapshot || {};
    return (
      snap.image_url ||
      snap.image ||
      (Array.isArray(snap.images) ? snap.images[0] : null) ||
      null
    );
  };

  empty.style.display = "none";
  list.innerHTML = "";

  orders.forEach((o) => {
    const thumb = getThumb(o);
    const href = o.listing_id ? `listing.html?id=${encodeURIComponent(o.listing_id)}` : null;

    const row = document.createElement("div");
    row.className = "order-card";
    row.style.display = "flex";
    row.style.gap = "12px";
    row.style.alignItems = "center";
    row.style.cursor = href ? "pointer" : "default";

    if (href) {
      row.tabIndex = 0;
      row.setAttribute("role", "link");
      row.addEventListener("click", () => (window.location.href = href));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") window.location.href = href;
      });
    }

    row.innerHTML = `
      <div style="width:64px;height:64px;background:#f3f4f6;border-radius:8px;flex-shrink:0;overflow:hidden">
        ${
          thumb
            ? `<img src="${thumb}" alt="" style="width:100%;height:100%;object-fit:cover"/>`
            : ""
        }
      </div>

      <div style="flex:1">
        <div style="font-weight:600">${o.listing_title || "Listing"}</div>
        <div style="font-size:13px;color:#6b7280">${statusLabel(o.status)} • ${formatDate(
          o.created_at
        )}</div>
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

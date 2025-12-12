// public/scripts/sales.js
// Seller Sales page — Poshmark-style list (clickable) + cancel option + no empty thumbnail box

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

  // Look up missing thumbnails from listings table
  const needListingIds = Array.from(
    new Set(
      orders
        .map((o) => o.listing_id)
        .filter(Boolean)
        .filter((id) => {
          const o = orders.find((x) => x.listing_id === id);
          return !o?.listing_image_url;
        })
    )
  );

  const listingImageById = {};
  if (needListingIds.length > 0) {
    const { data: listings } = await supabase
      .from("listings")
      .select("id, image_url")
      .in("id", needListingIds);

    (listings || []).forEach((l) => {
      if (l?.id && l?.image_url) listingImageById[l.id] = l.image_url;
    });
  }

  const getThumb = (o) => {
    if (o.listing_image_url) return o.listing_image_url;
    if (o.listing_id && listingImageById[o.listing_id]) return listingImageById[o.listing_id];

    const snap = o.listing_snapshot || {};
    return (
      snap.image_url ||
      snap.image ||
      (Array.isArray(snap.images) ? snap.images[0] : null) ||
      null
    );
  };

  const isCancelable = (status) => {
    const s = String(status || "").toUpperCase();
    // Seller can cancel while it's essentially "just sold"
    return s === "PAID" || s === "PENDING";
  };

  async function cancelOrder(orderId) {
    const ok = window.confirm("Cancel this order? The buyer will be notified.");
    if (!ok) return { ok: false };

    const reason =
      window.prompt("Reason (shown to buyer):", "Seller canceled: item unavailable") ||
      "Seller canceled: item unavailable";

    const payload = {
      status: "CANCELED",
      canceled_at: new Date().toISOString(),
      canceled_by: sellerId,
      cancel_reason: reason,
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error: cancelErr } = await supabase
      .from("orders")
      .update(payload)
      .eq("id", orderId)
      .eq("seller_id", sellerId)
      .select("id, status, canceled_at, cancel_reason")
      .single();

    if (cancelErr) {
      console.error("[sales] cancel error", cancelErr);
      window.alert("Cancel failed. Please refresh and try again.");
      return { ok: false };
    }
    return { ok: true, updated };
  }

  empty.style.display = "none";
  list.innerHTML = "";

  orders.forEach((o) => {
    const thumb = getThumb(o);
    const listingHref = o.listing_id ? `listing.html?id=${encodeURIComponent(o.listing_id)}` : null;

    const row = document.createElement("div");
    row.className = "order-card";
    row.style.display = "flex";
    row.style.gap = "12px";
    row.style.alignItems = "center";

    // Only clickable if we actually have a listing to go to
    if (listingHref) {
      row.style.cursor = "pointer";
      row.tabIndex = 0;
      row.setAttribute("role", "link");
      row.addEventListener("click", (e) => {
        // don't navigate if user clicked the cancel button
        if (e.target.closest("[data-cancel-btn]")) return;
        window.location.href = listingHref;
      });
      row.addEventListener("keydown", (e) => {
        if (!listingHref) return;
        if (e.key === "Enter" || e.key === " ") window.location.href = listingHref;
      });
    }

    // Left: show thumbnail ONLY if we have one; make it a link
    const left = document.createElement("div");
    if (thumb && listingHref) {
      left.innerHTML = `
        <a href="${listingHref}" aria-label="View listing" style="display:block;width:64px;height:64px;border-radius:8px;overflow:hidden;background:#f3f4f6;flex-shrink:0">
          <img src="${thumb}" alt="" style="width:100%;height:100%;object-fit:cover"/>
        </a>
      `;
    } else if (thumb && !listingHref) {
      left.innerHTML = `
        <div style="width:64px;height:64px;border-radius:8px;overflow:hidden;background:#f3f4f6;flex-shrink:0">
          <img src="${thumb}" alt="" style="width:100%;height:100%;object-fit:cover"/>
        </div>
      `;
    } else {
      // No image: show nothing (per your preference)
      left.innerHTML = "";
    }

    const middle = document.createElement("div");
    middle.style.flex = "1";

    const statusText = statusLabel(o.status);
    middle.innerHTML = `
      <div style="font-weight:600">${o.listing_title || "Listing"}</div>
      <div class="sale-sub" style="font-size:13px;color:#6b7280">${statusText} • ${formatDate(
      o.created_at
    )}</div>
      <div style="font-size:13px;color:#6b7280">Buyer: ${o.buyer_email || "—"}</div>
      <div class="sale-actions" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"></div>
    `;

    const actions = middle.querySelector(".sale-actions");

    // Add "Cancel order" like Poshmark "Problems / Order Inquiry"
    if (isCancelable(o.status)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Cancel order";
      btn.setAttribute("data-cancel-btn", "1");
      btn.style.padding = "6px 10px";
      btn.style.borderRadius = "8px";
      btn.style.border = "1px solid #e5e7eb";
      btn.style.background = "#fff";
      btn.style.fontWeight = "600";
      btn.style.fontSize = "13px";
      btn.style.cursor = "pointer";

      btn.addEventListener("click", async (e) => {
        e.stopPropagation();

        btn.disabled = true;
        btn.textContent = "Canceling…";

        const res = await cancelOrder(o.id);

        if (!res.ok) {
          btn.disabled = false;
          btn.textContent = "Cancel order";
          return;
        }

        // Update UI in-place
        o.status = res.updated.status;
        const sub = middle.querySelector(".sale-sub");
        if (sub) sub.textContent = `${statusLabel(o.status)} • ${formatDate(o.created_at)}`;

        btn.remove();
      });

      actions.appendChild(btn);
    }

    const right = document.createElement("div");
    right.style.textAlign = "right";
    right.innerHTML = `
      <div style="font-weight:700">${formatMoney(o.total_cents)}</div>
      <div style="font-size:18px;color:#9ca3af">${listingHref ? "›" : ""}</div>
    `;

    // Build row
    if (left.innerHTML) row.appendChild(left);
    row.appendChild(middle);
    row.appendChild(right);

    list.appendChild(row);
  });
})();

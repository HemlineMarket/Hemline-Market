// public/scripts/sales.js
// Sales page — Browse-style price line + obvious listing link + shipping always + cancel w/ reason

(async () => {
  const supabase = window.HM?.supabase;
  if (!supabase) return;

  const list = document.getElementById("ordersList");
  const empty = document.getElementById("emptyState");
  if (!list || !empty) return;

  /* ---------------- helpers ---------------- */

  const money = (cents) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
      (Number(cents) || 0) / 100
    );

  const dateLabel = (d) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const statusLabel = (s) => {
    const map = { PAID: "Sold", PENDING: "Pending", SHIPPED: "Shipped", CANCELED: "Canceled", REFUNDED: "Refunded" };
    return map[String(s || "").toUpperCase()] || String(s || "");
  };

  const canCancel = (s) => ["PAID", "PENDING"].includes(String(s || "").toUpperCase());

  const getQty = (order) => {
    const items = order?.listing_snapshot?.items;
    if (Array.isArray(items) && items.length) {
      const sum = items.reduce((acc, it) => acc + (Number(it?.qty) || 0), 0);
      return sum > 0 ? sum : null;
    }
    return null;
  };

  const getCentsBreakdown = (order) => {
    // Always show shipping; if null, treat as 0 for now (until you wire real shipping).
    const total = Number(order?.total_cents) || 0;
    const shipping = Number(order?.shipping_cents);
    const shippingCents = Number.isFinite(shipping) ? shipping : 0;

    // Item cents = total - shipping (never negative)
    const itemsCents = Math.max(0, total - shippingCents);

    return { itemsCents, shippingCents, totalCents: total };
  };

  /* ---------------- session ---------------- */

  const { data: sess } = await supabase.auth.getSession();
  const session = sess?.session;
  if (!session?.user) {
    window.location.href = "auth.html?view=login";
    return;
  }
  const sellerId = session.user.id;

  /* ---------------- load orders ---------------- */

  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      `
      id,
      status,
      created_at,
      total_cents,
      shipping_cents,
      buyer_email,
      buyer_id,
      listing_id,
      listing_title,
      listing_image_url,
      listing_snapshot
    `
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

  empty.style.display = "none";
  list.innerHTML = "";

  /* ---------------- cancel ---------------- */

  async function cancelOrder(orderId, reason) {
    const { error: cancelErr } = await supabase
      .from("orders")
      .update({
        status: "CANCELED",
        canceled_at: new Date().toISOString(),
        canceled_by: sellerId,
        cancel_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .eq("seller_id", sellerId);

    if (cancelErr) {
      console.error("[sales] cancel error", cancelErr);
      alert("Cancel failed. Please try again.");
      return false;
    }
    return true;
  }

  /* ---------------- render ---------------- */

  orders.forEach((o) => {
    const qty = getQty(o);
    const { itemsCents, shippingCents, totalCents } = getCentsBreakdown(o);

    const listingHref = o.listing_id ? `listing.html?id=${encodeURIComponent(o.listing_id)}` : null;

    const card = document.createElement("div");
    card.className = "order-card";
    card.style.display = "flex";
    card.style.gap = "14px";
    card.style.alignItems = "center";

    // Whole-row click to listing (marketplace behavior)
    if (listingHref) {
      card.style.cursor = "pointer";
      card.tabIndex = 0;
      card.setAttribute("role", "link");
      card.addEventListener("click", (e) => {
        if (e.target.closest("[data-no-nav]")) return;
        window.location.href = listingHref;
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") window.location.href = listingHref;
      });
    }

    // Optional image (clickable). If missing, don’t show a blank square.
    if (o.listing_image_url) {
      const imgLink = document.createElement("a");
      imgLink.href = listingHref || "#";
      imgLink.setAttribute("data-no-nav", "1");
      imgLink.style.width = "64px";
      imgLink.style.height = "64px";
      imgLink.style.borderRadius = "10px";
      imgLink.style.overflow = "hidden";
      imgLink.style.background = "#f3f4f6";
      imgLink.innerHTML = `<img src="${o.listing_image_url}" style="width:100%;height:100%;object-fit:cover" />`;
      card.appendChild(imgLink);
    }

    // Middle content
    const mid = document.createElement("div");
    mid.style.flex = "1";

    const browseLine = qty
      ? `${money(itemsCents)} for ${qty} yards`
      : `Total: ${money(totalCents)}`;

    mid.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        ${
          listingHref
            ? `<a href="${listingHref}" data-no-nav="1"
                 style="font-weight:700;text-decoration:none;color:inherit">
                 ${o.listing_title || "Listing"}
               </a>`
            : `<div style="font-weight:700">${o.listing_title || "Listing"}</div>`
        }

        ${
          listingHref
            ? `<a href="${listingHref}" data-no-nav="1"
                 style="margin-left:auto;color:#6b7280;text-decoration:none;font-weight:700">
                 View listing ›
               </a>`
            : `<span style="margin-left:auto;color:#9ca3af">—</span>`
        }
      </div>

      <div style="font-size:13px;color:#6b7280;margin-top:2px">${browseLine}</div>
      <div style="font-size:13px;color:#6b7280">${statusLabel(o.status)} · ${dateLabel(o.created_at)}</div>
      <div style="font-size:13px;color:#6b7280">Buyer: ${o.buyer_email || "—"}</div>
      <div style="font-size:12px;color:#9ca3af;margin-top:2px">
        Shipping: ${money(shippingCents)} · Total spent: ${money(totalCents)}
      </div>

      <div class="actions" style="margin-top:10px" data-no-nav="1"></div>
    `;

    const actions = mid.querySelector(".actions");

    // Cancel controls
    if (canCancel(o.status)) {
      const select = document.createElement("select");
      select.innerHTML = `
        <option value="">Cancel reason…</option>
        <option value="Item unavailable">Item unavailable</option>
        <option value="Damaged / flawed">Damaged / flawed</option>
        <option value="Cannot ship in time">Cannot ship in time</option>
        <option value="Buyer requested cancellation">Buyer requested cancellation</option>
        <option value="Other">Other</option>
      `;
      select.style.height = "32px";
      select.style.borderRadius = "8px";
      select.style.border = "1px solid #e5e7eb";
      select.style.padding = "0 10px";
      select.style.background = "#fff";
      select.style.fontWeight = "600";
      select.style.fontSize = "13px";

      const btn = document.createElement("button");
      btn.textContent = "Cancel order";
      btn.type = "button";
      btn.style.marginLeft = "8px";
      btn.style.height = "32px";
      btn.style.padding = "0 12px";
      btn.style.borderRadius = "8px";
      btn.style.border = "1px solid #e5e7eb";
      btn.style.background = "#fff";
      btn.style.fontWeight = "700";
      btn.style.fontSize = "13px";
      btn.style.cursor = "pointer";

      btn.onclick = async () => {
        if (!select.value) {
          alert("Please select a cancellation reason.");
          return;
        }
        if (!confirm("Cancel this order?")) return;

        btn.disabled = true;
        const ok = await cancelOrder(o.id, select.value);
        if (ok) location.reload();
        btn.disabled = false;
      };

      actions.appendChild(select);
      actions.appendChild(btn);
    }

    card.appendChild(mid);
    list.appendChild(card);
  });
})();

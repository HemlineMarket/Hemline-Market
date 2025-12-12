// public/scripts/purchases.js
// Purchases page — mirrors sales.js behavior and fixes buyer_id / buyer_email mismatch

(async () => {
  const supabase = window.HM?.supabase;
  if (!supabase) {
    console.error("[purchases] Supabase not found on window.HM");
    return;
  }

  const list = document.getElementById("ordersList") || document.getElementById("purchasesList");
  const empty = document.getElementById("emptyState");

  if (!list || !empty) {
    console.error("[purchases] Missing DOM nodes");
    return;
  }

  /* ---------- helpers ---------- */

  const money = (cents) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format((Number(cents) || 0) / 100);

  const dateLabel = (d) =>
    new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const statusLabel = (s) => {
    const map = {
      PAID: "Paid",
      PENDING: "Pending",
      SHIPPED: "Shipped",
      CANCELED: "Canceled",
      REFUNDED: "Refunded",
      BUYER_CANCELED: "Canceled",
    };
    return map[String(s || "").toUpperCase()] || String(s || "");
  };

  const getQty = (order) => {
    const items = order?.listing_snapshot?.items;
    if (Array.isArray(items)) {
      const sum = items.reduce((a, i) => a + (Number(i?.qty) || 0), 0);
      return sum || null;
    }
    return null;
  };

  const getCentsBreakdown = (order) => {
    const total = Number(order?.total_cents) || 0;
    const shipping = Number(order?.shipping_cents);
    const shippingCents = Number.isFinite(shipping) ? shipping : 0;
    const itemsCents = Math.max(0, total - shippingCents);
    return { itemsCents, shippingCents, totalCents: total };
  };

  /* ---------- session ---------- */

  const { data: sess } = await supabase.auth.getSession();
  const session = sess?.session;

  if (!session?.user) {
    window.location.href = "auth.html?view=login";
    return;
  }

  const uid = session.user.id;
  const email = session.user.email;

  /* ---------- load purchases ---------- */

  const { data: orders, error } = await supabase
    .from("orders")
    .select(`
      id,
      status,
      created_at,
      total_cents,
      shipping_cents,
      listing_id,
      listing_title,
      listing_image_url,
      listing_snapshot,
      seller_id,
      buyer_id,
      buyer_email
    `)
    .or(`buyer_id.eq.${uid},buyer_email.eq.${email}`)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[purchases] load error", error);
    empty.style.display = "block";
    empty.textContent = "Unable to load purchases.";
    return;
  }

  if (!orders || orders.length === 0) {
    empty.style.display = "block";
    empty.textContent = "You haven’t purchased anything yet.";
    list.innerHTML = "";
    return;
  }

  empty.style.display = "none";
  list.innerHTML = "";

  /* ---------- render ---------- */

  orders.forEach((o) => {
    const qty = getQty(o);
    const { itemsCents, shippingCents, totalCents } = getCentsBreakdown(o);
    const listingHref = o.listing_id
      ? `listing.html?id=${encodeURIComponent(o.listing_id)}`
      : null;

    const card = document.createElement("div");
    card.className = "order-card";
    card.style.display = "flex";
    card.style.gap = "14px";
    card.style.alignItems = "center";

    if (listingHref) {
      card.style.cursor = "pointer";
      card.tabIndex = 0;
      card.setAttribute("role", "link");
      card.addEventListener("click", (e) => {
        if (e.target.closest("[data-no-nav]")) return;
        window.location.href = listingHref;
      });
    }

    if (o.listing_image_url) {
      const img = document.createElement("img");
      img.src = o.listing_image_url;
      img.style.width = "64px";
      img.style.height = "64px";
      img.style.objectFit = "cover";
      img.style.borderRadius = "10px";
      card.appendChild(img);
    }

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
            : ""
        }
      </div>

      <div style="font-size:13px;color:#6b7280;margin-top:2px">${browseLine}</div>
      <div style="font-size:13px;color:#6b7280">
        ${statusLabel(o.status)} · ${dateLabel(o.created_at)}
      </div>
      <div style="font-size:12px;color:#9ca3af;margin-top:2px">
        Shipping: ${money(shippingCents)} · Total: ${money(totalCents)}
      </div>

      <div class="actions" style="margin-top:10px" data-no-nav="1"></div>
    `;

    const actions = mid.querySelector(".actions");

    if (o.seller_id) {
      const msg = document.createElement("a");
      msg.href = `messages.html?user=${encodeURIComponent(o.seller_id)}&order=${encodeURIComponent(o.id)}`;
      msg.textContent = "Message seller";
      msg.style.fontWeight = "700";
      msg.style.fontSize = "13px";
      msg.style.textDecoration = "none";
      msg.style.color = "#6b7280";
      actions.appendChild(msg);
    }

    card.appendChild(mid);
    list.appendChild(card);
  });
})();

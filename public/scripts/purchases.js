// public/scripts/purchases.js
// Purchases page — Sales-style cards + robust query (buyer_id OR buyer_email) + shipping + listing link

(async () => {
  const supabase = window.HM?.supabase;
  if (!supabase) return;

  const list =
    document.getElementById("ordersList") ||
    document.getElementById("purchasesList");
  const empty = document.getElementById("emptyState");

  if (!list || !empty) return;

  /* ---------------- helpers ---------------- */

  const money = (cents) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
      (Number(cents) || 0) / 100
    );

  const dateLabel = (d) =>
    new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const statusLabel = (s) => {
    const up = String(s || "").toUpperCase();
    const map = {
      PAID: "Paid",
      PENDING: "Pending",
      SHIPPED: "Shipped",
      DELIVERED: "Delivered",
      CANCELED: "Canceled",
      REFUNDED: "Refunded",
      BUYER_CANCELED: "Canceled",
      SELLER_CANCELED: "Canceled",
    };
    return map[up] || (s ? String(s) : "—");
  };

  const getQty = (order) => {
    const items = order?.listing_snapshot?.items;
    if (Array.isArray(items) && items.length) {
      const sum = items.reduce((acc, it) => acc + (Number(it?.qty) || 0), 0);
      return sum > 0 ? sum : null;
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

  const withinMinutes = (createdAtIso, minutes) => {
    if (!createdAtIso) return false;
    const created = new Date(createdAtIso).getTime();
    const now = Date.now();
    return now - created <= minutes * 60 * 1000;
  };

  const canBuyerCancel = (order) => {
    const up = String(order?.status || "").toUpperCase();
    // Buyer cancel only while still PAID/PENDING and within 30 minutes.
    // IMPORTANT: do NOT reference shipped_at (not in your schema right now).
    return (up === "PAID" || up === "PENDING") && withinMinutes(order?.created_at, 30);
  };

  async function buyerCancel(orderId, buyerId) {
    const payload = {
      status: "CANCELED",
      canceled_at: new Date().toISOString(),
      canceled_by: buyerId,
      cancel_reason: "Buyer canceled within 30 minutes.",
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("orders")
      .update(payload)
      .eq("id", orderId)
      .eq("buyer_id", buyerId);

    if (error) {
      console.error("[purchases] cancel error", error);
      alert("Cancel failed. Please refresh and try again.");
      return false;
    }
    return true;
  }

  /* ---------------- session ---------------- */

  const { data: sess } = await supabase.auth.getSession();
  const session = sess?.session;

  if (!session?.user) {
    window.location.href = "auth.html?view=login";
    return;
  }

  const buyerId = session.user.id;
  const buyerEmail =
    session.user.email ||
    session.user.user_metadata?.email ||
    "";

  /* ---------------- load orders ---------------- */

  // KEY FIX:
  // - Some orders were created with buyer_email populated but buyer_id not matching the current session.
  // - We load by buyer_id OR buyer_email (fallback) so Purchases never appears empty incorrectly.
  let query = supabase
    .from("orders")
    .select(
      `
      id,
      status,
      created_at,
      total_cents,
      shipping_cents,
      buyer_id,
      buyer_email,
      seller_id,
      listing_id,
      listing_title,
      listing_image_url,
      listing_snapshot
    `
    )
    .order("created_at", { ascending: false });

  if (buyerEmail) {
    query = query.or(`buyer_id.eq.${buyerId},buyer_email.eq.${buyerEmail}`);
  } else {
    query = query.eq("buyer_id", buyerId);
  }

  const { data: orders, error } = await query;

  if (error) {
    console.error("[purchases] load error", error);
    empty.style.display = "block";
    empty.textContent =
      "We couldn’t load your purchases. Please refresh and try again.";
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

  /* ---------------- render ---------------- */

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
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") window.location.href = listingHref;
      });
    }

    // image tile
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
      <div style="font-size:12px;color:#9ca3af;margin-top:2px">
        Shipping: ${money(shippingCents)} · Total paid: ${money(totalCents)}
      </div>

      <div class="actions" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap" data-no-nav="1"></div>
    `;

    const actions = mid.querySelector(".actions");

    // Message seller
    if (o.seller_id) {
      const msg = document.createElement("a");
      msg.href = `messages.html?user=${encodeURIComponent(o.seller_id)}&order=${encodeURIComponent(o.id)}`;
      msg.textContent = "Message seller";
      msg.style.height = "32px";
      msg.style.display = "inline-flex";
      msg.style.alignItems = "center";
      msg.style.padding = "0 12px";
      msg.style.borderRadius = "8px";
      msg.style.border = "1px solid #e5e7eb";
      msg.style.background = "#fff";
      msg.style.fontWeight = "700";
      msg.style.fontSize = "13px";
      msg.style.textDecoration = "none";
      msg.style.color = "#111827";
      actions.appendChild(msg);
    }

    // Buyer cancel (UI only if eligible)
    if (canBuyerCancel(o)) {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.textContent = "Cancel";
      cancelBtn.style.height = "32px";
      cancelBtn.style.padding = "0 12px";
      cancelBtn.style.borderRadius = "8px";
      cancelBtn.style.border = "1px solid #e5e7eb";
      cancelBtn.style.background = "#fff";
      cancelBtn.style.fontWeight = "700";
      cancelBtn.style.fontSize = "13px";
      cancelBtn.style.cursor = "pointer";

      cancelBtn.onclick = async () => {
        if (!confirm("Cancel this order?")) return;
        cancelBtn.disabled = true;

        // re-check 30-min window at click time
        if (!withinMinutes(o.created_at, 30)) {
          alert("This order can no longer be canceled (30-minute window passed).");
          cancelBtn.disabled = false;
          return;
        }

        const ok = await buyerCancel(o.id, buyerId);
        if (ok) location.reload();
        cancelBtn.disabled = false;
      };

      actions.appendChild(cancelBtn);
    }

    card.appendChild(mid);
    list.appendChild(card);
  });
})();

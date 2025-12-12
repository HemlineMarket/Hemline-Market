// public/scripts/purchases.js
// Purchases page — loads buyer history (by buyer_id OR buyer_email) + compact cards

(async () => {
  const supabase = window.HM?.supabase;
  if (!supabase) {
    console.error("[purchases] Supabase client missing (window.HM.supabase).");
    return;
  }

  const list =
    document.getElementById("ordersList") ||
    document.getElementById("purchasesList");
  const empty = document.getElementById("emptyState");

  if (!list || !empty) {
    console.error("[purchases] Missing #ordersList/#purchasesList or #emptyState");
    return;
  }

  const money = (cents) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
      (Number(cents) || 0) / 100
    );

  const dateLabel = (d) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const statusLabel = (s) => {
    const map = {
      PAID: "Paid",
      PENDING: "Pending",
      SHIPPED: "Shipped",
      CANCELED: "Canceled",
      REFUNDED: "Refunded",
    };
    return map[String(s || "").toUpperCase()] || String(s || "");
  };

  const canBuyerCancel = (order) => {
    const st = String(order?.status || "").toUpperCase();
    if (!(st === "PAID" || st === "PENDING")) return false;

    const createdAt = order?.created_at ? new Date(order.created_at) : null;
    if (!createdAt) return false;

    // 30-minute cancellation window
    return Date.now() - createdAt.getTime() <= 30 * 60 * 1000;
  };

  const getCentsBreakdown = (order) => {
    const total = Number(order?.total_cents) || 0;
    const shipping = Number(order?.shipping_cents);
    const shippingCents = Number.isFinite(shipping) ? shipping : 0;
    const itemsCents = Math.max(0, total - shippingCents);
    return { itemsCents, shippingCents, totalCents: total };
  };

  // -------- session --------
  const { data: sess } = await supabase.auth.getSession();
  const session = sess?.session;

  if (!session?.user) {
    window.location.href = "auth.html?view=login";
    return;
  }

  const uid = session.user.id;
  const email = (session.user.email || "").trim();

  // -------- load orders (IMPORTANT: buyer_id OR buyer_email) --------
  // This is the key fix that makes old orders show even if buyer_id was null at purchase time.
  const orParts = [`buyer_id.eq.${uid}`];
  if (email) {
    // ilike needs wildcard-safe value; email is fine as-is for exact match.
    orParts.push(`buyer_email.ilike.${email}`);
  }

  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      `
      id,
      status,
      created_at,
      total_cents,
      shipping_cents,
      seller_id,
      seller_email,
      listing_id,
      listing_title,
      listing_image_url
    `
    )
    .or(orParts.join(","))
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[purchases] load error", error);
    empty.style.display = "block";
    empty.textContent = "Unable to load purchases.";
    list.innerHTML = "";
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

  // -------- cancel (buyer-side) --------
  async function buyerCancel(orderId) {
    const payload = {
      status: "CANCELED",
      canceled_at: new Date().toISOString(),
      canceled_by: uid,
      cancel_reason: "Buyer canceled within 30 minutes.",
      updated_at: new Date().toISOString(),
    };

    const { error: cancelErr } = await supabase
      .from("orders")
      .update(payload)
      .eq("id", orderId)
      // allow cancel only if this buyer matches (either id or email)
      .or(`buyer_id.eq.${uid}${email ? `,buyer_email.ilike.${email}` : ""}`);

    if (cancelErr) {
      console.error("[purchases] cancel error", cancelErr);
      alert("Cancel failed. Please try again.");
      return false;
    }
    return true;
  }

  // -------- render --------
  orders.forEach((o) => {
    const { itemsCents, shippingCents, totalCents } = getCentsBreakdown(o);
    const listingHref = o.listing_id ? `listing.html?id=${encodeURIComponent(o.listing_id)}` : null;

    const card = document.createElement("div");
    card.className = "order-card";
    card.style.display = "flex";
    card.style.gap = "14px";
    card.style.alignItems = "center";

    // Whole-row click to listing (if known)
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

    // Optional image
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

      <div style="font-size:13px;color:#6b7280;margin-top:2px">
        ${money(itemsCents)} + ${money(shippingCents)} shipping
      </div>

      <div style="font-size:13px;color:#6b7280">
        ${statusLabel(o.status)} · ${dateLabel(o.created_at)}
      </div>

      <div style="font-size:12px;color:#9ca3af;margin-top:2px">
        Total spent: ${money(totalCents)}
      </div>

      <div class="actions" style="margin-top:10px" data-no-nav="1"></div>
    `;

    const actions = mid.querySelector(".actions");

    // Message seller (if seller_id present)
    if (o.seller_id) {
      const msg = document.createElement("a");
      msg.href =
        `messages.html?user=${encodeURIComponent(o.seller_id)}` +
        `&order=${encodeURIComponent(o.id)}`;
      msg.textContent = "Message seller";
      msg.setAttribute("data-no-nav", "1");
      msg.style.display = "inline-flex";
      msg.style.alignItems = "center";
      msg.style.justifyContent = "center";
      msg.style.height = "32px";
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

    // Buyer cancel (30 min window)
    if (canBuyerCancel(o)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Cancel order";
      btn.setAttribute("data-no-nav", "1");
      btn.style.marginLeft = actions.children.length ? "8px" : "0";
      btn.style.height = "32px";
      btn.style.padding = "0 12px";
      btn.style.borderRadius = "8px";
      btn.style.border = "1px solid #e5e7eb";
      btn.style.background = "#fff";
      btn.style.fontWeight = "700";
      btn.style.fontSize = "13px";
      btn.style.cursor = "pointer";

      btn.onclick = async () => {
        if (!confirm("Cancel this order? This can’t be undone.")) return;
        btn.disabled = true;

        const ok = await buyerCancel(o.id);
        if (ok) location.reload();

        btn.disabled = false;
      };

      actions.appendChild(btn);
    }

    card.appendChild(mid);
    list.appendChild(card);
  });
})();

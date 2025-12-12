// public/scripts/purchases.js
// Purchases page — robust buyer matching (buyer_id first, then buyer_email fallback), Sales-style cards

(async () => {
  const supabase = window.HM?.supabase;
  if (!supabase) {
    console.error("[purchases] Supabase not found on window.HM");
    return;
  }

  const list =
    document.getElementById("ordersList") ||
    document.getElementById("purchasesList");
  const empty = document.getElementById("emptyState");

  if (!list || !empty) {
    console.error("[purchases] Missing DOM nodes (#ordersList/#purchasesList or #emptyState)");
    return;
  }

  /* ---------- helpers ---------- */

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
    const map = {
      PAID: "Paid",
      PENDING: "Pending",
      SHIPPED: "Shipped",
      CANCELED: "Canceled",
      REFUNDED: "Refunded",
      BUYER_CANCELED: "Canceled",
      SELLER_CANCELED: "Canceled",
    };
    return map[String(s || "").toUpperCase()] || String(s || "");
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
    const shippingRaw = Number(order?.shipping_cents);
    const shippingCents = Number.isFinite(shippingRaw) ? shippingRaw : 0;
    const itemsCents = Math.max(0, total - shippingCents);
    return { itemsCents, shippingCents, totalCents: total };
  };

  /* ---------- session ---------- */

  const { data: sess, error: sessErr } = await supabase.auth.getSession();
  if (sessErr) console.warn("[purchases] session error", sessErr);

  const session = sess?.session;
  if (!session?.user) {
    window.location.href = "auth.html?view=login";
    return;
  }

  const uid = session.user.id;
  const email = (session.user.email || "").trim();

  /* ---------- load orders (2-pass, no OR syntax) ---------- */

  // Keep select minimal + compatible with your sales schema
  const selectCols = `
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
  `;

  // Pass 1: buyer_id match
  let orders = [];
  {
    const { data, error } = await supabase
      .from("orders")
      .select(selectCols)
      .eq("buyer_id", uid)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[purchases] load error (buyer_id)", error);
      empty.style.display = "block";
      empty.textContent = "Unable to load purchases.";
      return;
    }
    orders = data || [];
  }

  // Pass 2: buyer_email fallback (case-insensitive) if pass 1 returned none
  if (orders.length === 0 && email) {
    const { data, error } = await supabase
      .from("orders")
      .select(selectCols)
      .ilike("buyer_email", email)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[purchases] load error (buyer_email)", error);
      empty.style.display = "block";
      empty.textContent = "Unable to load purchases.";
      return;
    }
    orders = data || [];
  }

  // De-dupe by id (in case you later add both matches)
  const seen = new Set();
  orders = orders.filter((o) => {
    const id = String(o?.id || "");
    if (!id) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  /* ---------- render ---------- */

  list.innerHTML = "";

  // Tiny debug line so we stop guessing who is logged in
  const debug = document.createElement("div");
  debug.style.margin = "0 0 10px";
  debug.style.fontSize = "12px";
  debug.style.color = "#6b7280";
  debug.textContent = `Signed in as: ${email || "unknown email"} · ${uid.slice(0, 8)}…`;
  list.appendChild(debug);

  if (!orders || orders.length === 0) {
    empty.style.display = "block";
    empty.textContent = "You haven’t purchased anything yet.";
    return;
  }

  empty.style.display = "none";

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

    // Whole-row click to listing
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

    // Message seller
    if (o.seller_id) {
      const msg = document.createElement("a");
      msg.href =
        `messages.html?user=${encodeURIComponent(o.seller_id)}` +
        `&order=${encodeURIComponent(o.id)}`;
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

// public/scripts/sales.js
// Sales page — Browse-style clarity, real totals, cancel w/ reason

(async () => {
  const supabase = window.HM?.supabase;
  if (!supabase) return;

  const list = document.getElementById("ordersList");
  const empty = document.getElementById("emptyState");
  if (!list || !empty) return;

  /* ---------------- helpers ---------------- */

  const money = (cents) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format((cents || 0) / 100);

  const dateLabel = (d) =>
    new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const statusLabel = (s) => {
    const map = {
      PAID: "Sold",
      PENDING: "Pending",
      SHIPPED: "Shipped",
      CANCELED: "Canceled",
      REFUNDED: "Refunded",
    };
    return map[String(s || "").toUpperCase()] || s;
  };

  const canCancel = (s) =>
    ["PAID", "PENDING"].includes(String(s || "").toUpperCase());

  const getQty = (order) => {
    const items = order?.listing_snapshot?.items;
    if (Array.isArray(items) && items[0]?.qty) {
      const q = Number(items[0].qty);
      if (Number.isFinite(q)) return q;
    }
    return null;
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
      listing_id,
      listing_title,
      listing_image_url,
      listing_snapshot
    `
    )
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
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
    const { error } = await supabase
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

    if (error) {
      alert("Cancel failed. Please try again.");
      console.error(error);
      return false;
    }
    return true;
  }

  /* ---------------- render ---------------- */

  orders.forEach((o) => {
    const qty = getQty(o);
    const listingHref = o.listing_id
      ? `listing.html?id=${encodeURIComponent(o.listing_id)}`
      : null;

    const total = money(o.total_cents);
    const shipping = money(o.shipping_cents || 0);

    const card = document.createElement("div");
    card.className = "order-card";
    card.style.display = "flex";
    card.style.gap = "14px";
    card.style.alignItems = "center";

    if (listingHref) {
      card.style.cursor = "pointer";
      card.addEventListener("click", (e) => {
        if (e.target.closest("[data-no-nav]")) return;
        window.location.href = listingHref;
      });
    }

    /* image (optional) */
    if (o.listing_image_url) {
      const imgWrap = document.createElement("a");
      imgWrap.href = listingHref || "#";
      imgWrap.setAttribute("data-no-nav", "1");
      imgWrap.style.width = "64px";
      imgWrap.style.height = "64px";
      imgWrap.style.borderRadius = "8px";
      imgWrap.style.overflow = "hidden";
      imgWrap.style.background = "#f3f4f6";
      imgWrap.innerHTML = `
        <img src="${o.listing_image_url}"
             style="width:100%;height:100%;object-fit:cover" />
      `;
      card.appendChild(imgWrap);
    }

    /* middle */
    const mid = document.createElement("div");
    mid.style.flex = "1";

    mid.innerHTML = `
      <div style="font-weight:600">${o.listing_title || "Listing"}</div>
      <div style="font-size:13px;color:#6b7280">
        ${qty ? `${money(o.total_cents)} for ${qty} yards` : `Total: ${total}`}
      </div>
      <div style="font-size:13px;color:#6b7280">
        ${statusLabel(o.status)} · ${dateLabel(o.created_at)}
      </div>
      <div style="font-size:13px;color:#6b7280">
        Buyer: ${o.buyer_email || "—"}
      </div>
      ${
        o.shipping_cents
          ? `<div style="font-size:12px;color:#9ca3af">Includes ${shipping} shipping</div>`
          : ""
      }
      <div class="actions" style="margin-top:8px"></div>
    `;

    const actions = mid.querySelector(".actions");

    if (canCancel(o.status)) {
      const select = document.createElement("select");
      select.setAttribute("data-no-nav", "1");
      select.innerHTML = `
        <option value="">Cancel reason…</option>
        <option>Item unavailable</option>
        <option>Damaged / flawed</option>
        <option>Cannot ship in time</option>
        <option>Buyer requested cancellation</option>
        <option>Other</option>
      `;
      select.style.height = "32px";
      select.style.borderRadius = "8px";
      select.style.border = "1px solid #e5e7eb";

      const btn = document.createElement("button");
      btn.textContent = "Cancel order";
      btn.setAttribute("data-no-nav", "1");
      btn.style.marginLeft = "8px";
      btn.style.height = "32px";
      btn.style.padding = "0 12px";
      btn.style.borderRadius = "8px";
      btn.style.border = "1px solid #e5e7eb";
      btn.style.fontWeight = "600";

      btn.onclick = async () => {
        if (!select.value) {
          alert("Please select a cancellation reason.");
          return;
        }
        const ok = confirm("Cancel this order?");
        if (!ok) return;

        btn.disabled = true;
        const success = await cancelOrder(o.id, select.value);
        if (success) location.reload();
        btn.disabled = false;
      };

      actions.appendChild(select);
      actions.appendChild(btn);
    }

    /* right */
    const right = document.createElement("div");
    right.setAttribute("data-no-nav", "1");
    right.style.textAlign = "right";
    right.innerHTML = `
      <div style="font-size:20px;color:#9ca3af">${listingHref ? "›" : ""}</div>
    `;

    card.appendChild(mid);
    card.appendChild(right);
    list.appendChild(card);
  });
})();

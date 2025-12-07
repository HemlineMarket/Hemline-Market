// File: public/scripts/sales.js
// Shows orders where the current user is the seller (your Sales page).

(function () {
  const HM = window.HM || {};
  const supabase = HM.supabase;

  if (!supabase) {
    console.warn("[sales] Supabase client missing on window.HM.supabase");
    return;
  }

  const listEl = document.getElementById("ordersList");
  const emptyEl = document.getElementById("emptyState");

  function fmtMoney(cents) {
    const n = Number(cents || 0) / 100;
    return n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    });
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function shortId(id) {
    if (!id) return "";
    return String(id).slice(0, 8);
  }

  async function ensureSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn("[sales] getSession error", error);
    }
    const session = data?.session || null;
    if (!session || !session.user) {
      // Require sign-in to see sales
      window.location.href = "auth.html?view=login";
      return null;
    }
    return session;
  }

  function renderEmpty() {
    if (listEl) listEl.innerHTML = "";
    if (emptyEl) emptyEl.style.display = "block";
  }

  function renderOrders(rows) {
    if (!listEl) return;
    listEl.innerHTML = "";

    if (!rows || !rows.length) {
      renderEmpty();
      return;
    }

    if (emptyEl) emptyEl.style.display = "none";

    rows.forEach((o) => {
      const card = document.createElement("article");
      card.className = "order-card";

      const created = fmtDate(o.created_at);
      const itemsMoney = fmtMoney(o.items_cents);
      const shippingMoney = fmtMoney(o.shipping_cents);
      const totalMoney = fmtMoney(o.total_cents);

      const appFee = Number(o.application_fee_amount || 0);
      const earningsCents = Number(o.total_cents || 0) - appFee;
      const earningsMoney = fmtMoney(earningsCents);

      const status = (o.status || "paid").toUpperCase();

      const buyerLabel = o.buyer_email
        ? `Buyer: ${o.buyer_email}`
        : "";

      const listingTitle = o.listing_title || o.listing_name || "Fabric purchase";
      const thumbUrl = o.listing_image_url || "";

      card.innerHTML = `
        <div class="order-top">
          <div>
            Purchase #${shortId(o.id)}
          </div>
          <div>${created}</div>
        </div>

        <div class="order-meta">
          <div><strong>Status:</strong> ${status}</div>
          <div>
            <strong>Your earnings:</strong> ${earningsMoney}
          </div>
          <div>
            <strong>Total paid by buyer:</strong> ${totalMoney}
            <span style="color:#6b7280;">
              (Items: ${itemsMoney} • Shipping: ${shippingMoney})
            </span>
          </div>
          <div style="margin-top:4px;">
            <strong>Listing:</strong> ${listingTitle}
          </div>
          ${buyerLabel ? `<div style="margin-top:2px;">${buyerLabel}</div>` : ""}
        </div>

        <div style="display:flex;align-items:center;gap:10px;margin-top:4px;">
          ${
            thumbUrl
              ? `<div style="width:52px;height:52px;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;background:#f9fafb;flex-shrink:0;">
                   <img src="${thumbUrl}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">
                 </div>`
              : ""
          }
          <a class="btn" href="listing.html?id=${encodeURIComponent(
            o.listing_id
          )}">View listing</a>
        </div>
      `;

      listEl.appendChild(card);
    });
  }

  async function loadSales() {
    const session = await ensureSession();
    if (!session) return;

    const userId = session.user.id;

    const { data, error } = await supabase
      .from("orders")
      .select(
        `
          id,
          listing_id,
          listing_title,
          listing_name,
          listing_image_url,
          seller_id,
          buyer_id,
          buyer_email,
          items_cents,
          shipping_cents,
          total_cents,
          application_fee_amount,
          status,
          stripe_checkout,
          created_at
        `
      )
      .eq("seller_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.warn("[sales] load error", error);
      renderEmpty();
      return;
    }

    renderOrders(data || []);
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadSales().catch((e) => {
      console.error("[sales] unexpected error", e);
      renderEmpty();
    });
  });
})();

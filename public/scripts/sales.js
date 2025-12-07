// scripts/sales.js
// Your Sales — orders where you are the seller.
// This does NOT touch purchases logic or listing queries.

(function () {
  const HM = window.HM || {};
  const supabase = HM.supabase;

  if (!supabase) {
    console.error("[sales] Supabase client not found on window.HM.supabase");
    return;
  }

  function formatMoney(cents) {
    const n = Number(cents || 0) / 100;
    return n.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
    });
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  async function ensureSession(maxWaitMs = 3000) {
    let {
      data: { session },
    } = await supabase.auth.getSession();
    const start = Date.now();

    while (!session?.user && Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 120));
      ({
        data: { session },
      } = await supabase.auth.getSession());
    }
    return session;
  }

  async function loadSales() {
    const list = document.getElementById("ordersList");
    const empty = document.getElementById("emptyState");

    if (!list || !empty) {
      console.warn("[sales] Missing container elements");
      return;
    }

    const session = await ensureSession();
    if (!session || !session.user) {
      window.location.href = "auth.html?view=login";
      return;
    }

    const uid = session.user.id;
    const email = session.user.email;

    // IMPORTANT: keep query simple and stable
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .or(`seller_id.eq.${uid},seller_email.eq.${email}`)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[sales] load error:", error);
      empty.style.display = "block";
      empty.textContent = "Unable to load sales.";
      return;
    }

    if (!data || !data.length) {
      empty.style.display = "block";
      list.innerHTML = "";
      return;
    }

    empty.style.display = "none";
    list.innerHTML = "";

    data.forEach((o) => {
      const card = document.createElement("div");
      card.className = "order-card";

      const snapshot = Array.isArray(o.listing_snapshot)
        ? o.listing_snapshot
        : [];
      const first = snapshot[0] || {};

      const title =
        o.listing_title ||
        o.listing_name ||
        first.name ||
        first.title ||
        "Fabric sale";

      // One-line fabric spec from snapshot (display-only, safe)
      const content =
        first.content ||
        first.fiber_content ||
        "";
      const width =
        first.width ||
        first.width_inches ||
        first.width_in ||
        "";
      let specText = "";
      if (content && width) {
        specText = `${content} · ${width} wide`;
      } else if (content) {
        specText = content;
      } else if (width) {
        specText = `${width} wide`;
      }
      const specHtml = specText
        ? `<div style="font-size:13px;color:#6b7280;margin-top:2px;margin-bottom:4px;">${specText}</div>`
        : "";

      const totalCents = Number(
        o.total_cents ??
          o.amount_total_cents ??
          o.amount_total ??
          0
      );

      const buyerLabel =
        o.buyer_email ||
        o.buyer_name ||
        "Buyer";

      const listingId = o.listing_id || first.listing_id || null;
      const viewLinkHtml = listingId
        ? `<a class="btn" href="listing.html?id=${encodeURIComponent(
            listingId
          )}">View listing</a>`
        : "";

      card.innerHTML = `
        <div class="order-top">
          <span>Order #${String(o.id).slice(0, 8)}</span>
          <span>${formatDate(o.created_at)}</span>
        </div>

        <div class="order-meta">
          <div>Buyer: <strong>${buyerLabel}</strong></div>
          <div>Total: <strong>${formatMoney(totalCents)} ${
        o.currency || "USD"
      }</strong></div>
        </div>

        <div>
          <div><strong>${title}</strong></div>
          ${specHtml}
          ${viewLinkHtml}
        </div>
      `;

      list.appendChild(card);
    });
  }

  window.addEventListener("DOMContentLoaded", () => {
    loadSales();
  });
})();

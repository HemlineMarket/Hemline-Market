// public/scripts/sales.js
// Loads all sales (orders where the logged-in user is the seller)
// Includes 30-minute cancellation window indicator.

(async () => {
  const supabase = window.HM && window.HM.supabase;
  if (!supabase) {
    console.error("[sales] Supabase client missing.");
    return;
  }

  function formatMoney(cents) {
    const n = Number(cents || 0) / 100;
    return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
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

  // Cancellation note for seller
  function cancellationWindowHtml(order) {
    if (!order.created_at) return "";

    const createdMs = new Date(order.created_at).getTime();
    const nowMs = Date.now();
    const diffMinutes = (nowMs - createdMs) / 60000;

    if (diffMinutes < 30) {
      const remaining = Math.max(0, Math.ceil(30 - diffMinutes));
      return `
        <div class="cancel-note" style="font-size:12px;color:#b45309;margin-top:6px;font-weight:600;">
          Buyer may request cancellation for another ${remaining} min.
        </div>
      `;
    }

    return `
      <div class="cancel-note" style="font-size:12px;color:#6b7280;margin-top:6px;">
        Cancellation window has closed.
      </div>
    `;
  }

  async function ensureSession(maxMs = 3000) {
    let { data: { session } } = await supabase.auth.getSession();
    const start = Date.now();

    while (!session?.user && Date.now() - start < maxMs) {
      await new Promise((r) => setTimeout(r, 120));
      ({ data: { session } } = await supabase.auth.getSession());
    }

    return session;
  }

  const session = await ensureSession();
  if (!session || !session.user) {
    window.location.href = "auth.html?view=login";
    return;
  }

  const uid = session.user.id;

  const list = document.getElementById("ordersList");
  const empty = document.getElementById("emptyState");

  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("seller_id", uid)
    .order("created_at", { ascending: false });

  if (error) {
    empty.style.display = "block";
    return;
  }

  if (!data || data.length === 0) {
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  list.innerHTML = "";

  data.forEach((o) => {
    const card = document.createElement("div");
    card.className = "order-card";

    const dateStr = formatDate(o.created_at);

    let listingTitle =
      o.listing_title ||
      o.listing_name ||
      "";

    const snapshot = o.listing_snapshot;
    if (!listingTitle && Array.isArray(snapshot) && snapshot.length) {
      listingTitle = snapshot[0].name || "Fabric sale";
    }
    if (!listingTitle) listingTitle = "Fabric sale";

    const amount = Number(
      o.total_cents ??
        o.amount_total_cents ??
        o.amount_total ??
        0
    );

    const cancelNote = cancellationWindowHtml(o);

    card.innerHTML = `
      <div class="order-top">
        <span>Sale</span>
        <span>${dateStr}</span>
      </div>

      <div class="order-meta">
        <strong>${listingTitle}</strong><br/>
        Total: ${formatMoney(amount)}<br/>
        Buyer: ${o.buyer_email || "—"}
      </div>

      <a class="btn"
         href="messages.html?user=${encodeURIComponent(o.buyer_id)}&sale=${encodeURIComponent(o.id)}">
        Message buyer
      </a>

      ${cancelNote}
    `;

    list.appendChild(card);
  });

  window.HM && window.HM.renderShell({ currentPage: "sales" });
})();

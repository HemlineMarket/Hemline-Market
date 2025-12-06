// File: public/scripts/sales.js
// Loads all sales (orders where the logged-in user is the seller).

(async () => {
  const supabase = window.HM && window.HM.supabase;
  if (!supabase) {
    console.error("[sales] Supabase client missing.");
    return;
  }

  // Utility: format money
  function formatMoney(cents) {
    const n = Number(cents || 0) / 100;
    return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
  }

  // Utility: date formatting
  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  // Ensure session
  async function ensureSession(maxMs = 3000) {
    let { data: { session } } = await supabase.auth.getSession();
    const start = Date.now();

    while (!session?.user && Date.now() - start < maxMs) {
      await new Promise(r => setTimeout(r, 120));
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

  // Query all sales where this user is the seller
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("seller_id", uid)
    .order("created_at", { ascending: false });

  const list = document.getElementById("ordersList");
  const empty = document.getElementById("emptyState");

  if (error) {
    console.error("[sales] load error:", error);
    empty.style.display = "block";
    return;
  }

  if (!data || data.length === 0) {
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  list.innerHTML = "";

  data.forEach(o => {
    const card = document.createElement("div");
    card.className = "order-card";

    const dateStr = formatDate(o.created_at);

    // Listing title
    let listingTitle =
      o.listing_title ||
      o.listing_name ||
      "";

    const snapshot = o.listing_snapshot;
    if (!listingTitle && Array.isArray(snapshot) && snapshot.length) {
      listingTitle = snapshot[0].name || "Fabric sale";
    }
    if (!listingTitle) listingTitle = "Fabric sale";

    // Total amount
    const amount = Number(
      o.total_cents ??
      o.amount_total_cents ??
      o.amount_total ??
      0
    );

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
         href="messages.html?user=${encodeURIComponent(o.buyer_id)}&order=${encodeURIComponent(o.id)}">
        Message buyer
      </a>
    `;

    list.appendChild(card);
  });

  // Highlight header nav
  window.HM && window.HM.renderShell({ currentPage: "sales" });
})();

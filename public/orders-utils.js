// public/scripts/orders-utils.js
// Shared helpers for Purchases + Sales pages

export function formatMoney(cents){
  const n = Number(cents || 0) / 100;
  return n.toLocaleString(undefined, { style:"currency", currency:"USD" });
}

export function formatDate(iso){
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined,{
    month:"short",
    day:"numeric",
    year:"numeric"
  });
}

// Derive a clean, human title from order row
export function extractListingTitle(order){
  let t =
    order.listing_title ||
    order.listing_name ||
    "";

  const ss = order.listing_snapshot;
  if (!t && Array.isArray(ss) && ss.length){
    t = ss[0].name || "Fabric";
  }
  return t || "Fabric";
}

// Derive total cents from all possible fields
export function extractTotalCents(order){
  return Number(
    order.total_cents ??
    order.amount_total_cents ??
    order.amount_total ??
    0
  );
}

// Determine if 30-min cancellation window is still open
export function cancellationWindowHtml(order){
  if (!order.created_at) return "";

  const createdMs = new Date(order.created_at).getTime();
  if (Number.isNaN(createdMs)) return "";

  const diff = (Date.now() - createdMs) / (60 * 1000);

  if (diff < 30){
    return `
      <div class="cancellation-note cancellation-open">
        You can still request cancellation within 30 minutes of purchase.
        Message the seller and mention “Cancel this purchase”.
      </div>
    `;
  }

  return `
    <div class="cancellation-note">
      If you need to cancel, message the seller through this purchase.
      Cancellations after shipping are handled case-by-case.
    </div>
  `;
}

// File: public/scripts/order-history-utils.js
// Shared helpers for Purchases + Sales pages.

// Money formatting -----------------------------------------------------------
export function formatMoney(cents) {
  const n = Number(cents || 0) / 100;
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD"
  });
}

// Date formatting ------------------------------------------------------------
export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

// Cancellation window helper -------------------------------------------------
export function buildCancellationNote(created_at) {
  if (!created_at) return "";

  const createdMs = new Date(created_at).getTime();
  if (Number.isNaN(createdMs)) return "";

  const diffMinutes = (Date.now() - createdMs) / (60 * 1000);

  if (diffMinutes < 30) {
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

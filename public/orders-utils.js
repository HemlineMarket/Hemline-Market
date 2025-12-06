// File: public/scripts/orders-utils.js
// Shared helpers for purchases.js and sales.js

// --- Money formatter ---
export function formatMoney(cents) {
  const n = Number(cents || 0) / 100;
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

// --- Date formatter ---
export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// --- Extract listing title ---
export function extractListingTitle(order) {
  let title =
    order.listing_title ||
    order.listing_name ||
    "";

  const snap = order.listing_snapshot;
  if (!title && Array.isArray(snap) && snap.length > 0) {
    title = snap[0].name || "Fabric";
  }

  return title || "Fabric";
}

// --- Extract total amount ---
export function extractTotalCents(order) {
  return Number(
    order.total_cents ??
    order.amount_total_cents ??
    order.amount_total ??
    0
  );
}

// --- 30-minute cancellation window notice ---
export function cancellationWindowHtml(order) {
  if (!order.created_at) return "";

  const createdMs = new Date(order.created_at).getTime();
  const diffMinutes = (Date.now() - createdMs) / 60000;

  if (diffMinutes < 30) {
    return `
      <div class="cancellation-note cancellation-open">
        You may request cancellation within 30 minutes of purchase.
        Contact the seller immediately.
      </div>
    `;
  }

  return `
    <div class="cancellation-note">
      Cancellation after the 30-minute window is seller discretion.
    </div>
  `;
}

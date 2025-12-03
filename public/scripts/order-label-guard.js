// File: public/scripts/order-label-guard.js
// Guards the "Create label" button until the 30-minute cancel window is over.
// Also inserts a notification for the seller when the label becomes available.

(function () {
  function $(id) {
    return document.getElementById(id);
  }

  // -----------------------------
  // 1. Fetch cancellation window
  // -----------------------------
  async function fetchCancelWindow(sessionId) {
    const url = `/api/orders/cancel_window?sid=${encodeURIComponent(sessionId)}`;

    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      throw new Error(`cancel_window HTTP ${res.status}`);
    }
    return res.json(); // { canShip, diffMs, created }
  }

  // --------------------------------------
  // 2. Apply UI state to button + message
  // --------------------------------------
  function applyState({ canShip, minutesLeft, createdIso }) {
    const btn = $("createLabelBtn");
    const msg = $("cancelWindowMessage");
    if (!btn || !msg) return;

    if (!canShip) {
      btn.disabled = true;

      if (typeof minutesLeft === "number" && minutesLeft > 0) {
        msg.textContent =
          `The buyer has a 30-minute cancellation window after purchase. ` +
          `Please do not ship yet. You can create the shipping label in about ` +
          `${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`;
      } else {
        msg.textContent =
          "The buyer has a 30-minute cancellation window after purchase. Please wait before creating a shipping label.";
      }
    } else {
      btn.disabled = false;
      msg.textContent =
        "The 30-minute cancellation window has passed. You can safely create and print the shipping label now.";
    }

    if (createdIso) {
      btn.setAttribute("data-order-created-at", createdIso);
    }
  }

  function minutesLeftFromDiff(diffMs) {
    const WINDOW = 30 * 60 * 1000;
    const remaining = WINDOW - diffMs;
    if (remaining <= 0) return 0;
    return Math.ceil(remaining / 60000);
  }

  // -----------------------------
  // 3. Init guard on page load
  // -----------------------------
  async function initGuard() {
    const btn = $("createLabelBtn");
    if (!btn) return; // Page doesn't have a label button.

    const msg = $("cancelWindowMessage");
    const sessionId = btn.getAttribute("data-stripe-session-id");

    if (!sessionId) {
      if (msg) {
        msg.textContent =
          "Note: buyers have 30 minutes to cancel. If the order is recent, wait before shipping.";
      }
      return;
    }

    msg.textContent = "Checking cancellation window…";
    btn.disabled = true;

    try {
      const data = await fetchCancelWindow(sessionId);
      const diffMs = typeof data.diffMs === "number" ? data.diffMs : 0;
      const minutesLeft = minutesLeftFromDiff(diffMs);

      applyState({
        canShip: !!data.canShip,
        minutesLeft,
        createdIso: data.created,
      });

      // -------------------------------------------
      // 4. INSERT NOTIFICATION WHEN LABEL UNLOCKS
      // -------------------------------------------
      if (data.canShip) {
        // We now load current user (seller)
        const supabase = window.HM && window.HM.supabase;
        if (!supabase) return;

        const { data: sess } = await supabase.auth.getSession();
        const sellerId = sess?.session?.user?.id;
        if (!sellerId) return;

        // Avoid spamming—only notify if FIRST unlock
        const alreadyNotified = btn.getAttribute("data-notified") === "1";
        if (alreadyNotified) return;

        btn.setAttribute("data-notified", "1");

        // Insert notification
        const title = "Shipping label is now available";
        const body = "The 30-minute cancel window has passed. You can now print the label.";

        await supabase.from("notifications").insert({
          user_id: sellerId,
          actor_id: sellerId,
          type: "listing_order",
          kind: "purchase",
          title,
          body,
          href: "orders.html",
          link: "orders.html",
          metadata: {
            label_unlocked: true,
            created_at: data.created,
            session_id: sessionId
          }
        });
      }
    } catch (err) {
      console.error("[order-label-guard] error", err);
      if (msg) {
        msg.textContent =
          "We couldn’t verify the cancellation window. If the order is new, wait 30 minutes before creating a label.";
      }
      btn.disabled = true;
    }
  }

  document.addEventListener("DOMContentLoaded", initGuard);
})();

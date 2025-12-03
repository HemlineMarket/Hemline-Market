// File: public/scripts/order-label-guard.js
// Guards the “Create shipping label” button until the 30-minute cancel window is over.
// Also notifies the seller the moment the label becomes available.

(function () {
  const $ = (id) => document.getElementById(id);

  // --------------------------------------------
  // 1. Ask backend if cancellation window passed
  // --------------------------------------------
  async function fetchCancelWindow(sessionId) {
    const url = `/api/orders/cancel_window?sid=${encodeURIComponent(sessionId)}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`cancel_window HTTP ${res.status}`);
    return res.json(); // { canShip, diffMs, created }
  }

  // Minutes left in the 30-min window
  function minutesLeftFromDiff(diffMs) {
    const WINDOW = 30 * 60 * 1000;
    const remaining = WINDOW - diffMs;
    if (remaining <= 0) return 0;
    return Math.ceil(remaining / 60000);
  }

  // --------------------------------------------
  // 2. Update UI state for button + message
  // --------------------------------------------
  function applyState({ canShip, minutesLeft, createdIso }) {
    const btn = $("createLabelBtn");
    const msg = $("cancelWindowMessage");
    if (!btn || !msg) return;

    if (!canShip) {
      btn.disabled = true;

      if (typeof minutesLeft === "number" && minutesLeft > 0) {
        msg.textContent =
          `The buyer has a 30-minute cancellation window. ` +
          `You can create the shipping label in about ${minutesLeft} ` +
          `minute${minutesLeft === 1 ? "" : "s"}.`;
      } else {
        msg.textContent =
          "The buyer has a 30-minute cancellation window. Please wait before creating a shipping label.";
      }
    } else {
      btn.disabled = false;
      msg.textContent =
        "The cancellation window has passed. You can safely create and print the shipping label now.";
    }

    if (createdIso) {
      btn.setAttribute("data-order-created-at", createdIso);
    }
  }

  // --------------------------------------------
  // 3. Init guard on page load
  // --------------------------------------------
  async function initGuard() {
    const btn = $("createLabelBtn");
    if (!btn) return;

    const msg = $("cancelWindowMessage");
    const sessionId = btn.getAttribute("data-stripe-session-id");

    // No session ID = no precise guard possible
    if (!sessionId) {
      if (msg) {
        msg.textContent =
          "Note: buyers have 30 minutes to cancel. If this order is recent, please wait before shipping.";
      }
      return;
    }

    btn.disabled = true;
    msg.textContent = "Checking cancellation window…";

    let result;
    try {
      result = await fetchCancelWindow(sessionId);
    } catch (err) {
      console.error("[order-label-guard] fetch error", err);
      msg.textContent =
        "We couldn’t verify the cancellation window. If the order is new, wait 30 minutes before creating a label.";
      btn.disabled = true;
      return;
    }

    const diffMs = typeof result.diffMs === "number" ? result.diffMs : 0;
    const minutesLeft = minutesLeftFromDiff(diffMs);

    applyState({
      canShip: !!result.canShip,
      minutesLeft,
      createdIso: result.created,
    });

    // --------------------------------------------------
    // 4. Send notification EXACTLY once when label unlocks
    // --------------------------------------------------
    if (!result.canShip) return;

    const supabase = window.HM && window.HM.supabase;
    if (!supabase) return;

    const { data: sess } = await supabase.auth.getSession();
    const sellerId = sess?.session?.user?.id;
    if (!sellerId) return;

    // Prevent duplicate notifications
    if (btn.getAttribute("data-notified") === "1") return;
    btn.setAttribute("data-notified", "1");

    try {
      await supabase.from("notifications").insert({
        user_id: sellerId,
        actor_id: sellerId,
        type: "listing_order",
        kind: "purchase",
        title: "Shipping label is now available",
        body: "The 30-minute cancel window has passed. You can now print the shipping label.",
        href: "orders.html",
        link: "orders.html",
        metadata: {
          label_unlocked: true,
          created_at: result.created,
          session_id: sessionId
        }
      });
    } catch (err) {
      console.error("[order-label-guard] notify error", err);
    }
  }

  document.addEventListener("DOMContentLoaded", initGuard);
})();

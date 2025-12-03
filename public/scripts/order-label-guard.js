// File: public/scripts/order-label-guard.js
// Guards the "Create label" button until the 30-minute cancel window is over.
// Expects your order page HTML to have:
//
// <button
//   id="createLabelBtn"
//   data-stripe-session-id="cs_test_123"
// >
//   Create shipping label
// </button>
//
// <p id="cancelWindowMessage" class="cancel-msg"></p>
//
// The script:
// - Calls /api/orders/cancel_window?sid=... using the session id
// - Disables the button + shows "buyer has 30 minutes to cancel"
// - Re-enables it after 30 minutes have passed

(function () {
  function $(id) {
    return document.getElementById(id);
  }

  async function fetchCancelWindow(sessionId) {
    const url = `/api/orders/cancel_window?sid=${encodeURIComponent(
      sessionId
    )}`;

    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      throw new Error(`cancel_window HTTP ${res.status}`);
    }
    return res.json();
  }

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
          "The buyer has a 30-minute cancellation window after purchase. Please wait before creating a shipping label or shipping the item.";
      }
    } else {
      btn.disabled = false;
      msg.textContent =
        "The 30-minute cancellation window has passed. You can safely create and print the shipping label now.";
    }

    // Optional: expose created time for debugging
    if (createdIso) {
      btn.setAttribute("data-order-created-at", createdIso);
    }
  }

  function minutesLeftFromDiff(diffMs) {
    const WINDOW_MS = 30 * 60 * 1000;
    const remaining = WINDOW_MS - diffMs;
    if (remaining <= 0) return 0;
    return Math.ceil(remaining / 60000);
  }

  async function initGuard() {
    const btn = $("createLabelBtn");
    if (!btn) return; // No button on this page

    const sessionId = btn.getAttribute("data-stripe-session-id");
    const msg = $("cancelWindowMessage");

    if (!sessionId) {
      // No session id → we can't enforce the window, so just show a generic warning.
      if (msg) {
        msg.textContent =
          "Note: buyers have 30 minutes after purchase to cancel. If this order was just paid, please wait at least 30 minutes before shipping.";
      }
      return;
    }

    if (msg) {
      msg.textContent = "Checking cancellation window…";
    }
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
    } catch (err) {
      console.error("[order-label-guard] error", err);
      if (msg) {
        msg.textContent =
          "We couldn’t verify the cancellation window. If this order is very recent, please wait 30 minutes before creating a shipping label.";
      }
      // In case of error, we leave the button disabled to be safe.
      btn.disabled = true;
    }
  }

  document.addEventListener("DOMContentLoaded", initGuard);
})();

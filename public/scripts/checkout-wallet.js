// public/scripts/checkout-wallet.js
// Adds "Apply balance" functionality to checkout page
// Add this script to checkout.html: <script src="scripts/checkout-wallet.js"></script>

(function() {
  'use strict';

  let userWalletBalance = 0;
  let applyWalletCredit = true;

  document.addEventListener('DOMContentLoaded', initCheckoutWallet);

  async function initCheckoutWallet() {
    const supabase = window.supabaseClient || window.HM?.supabase;
    if (!supabase) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await loadWalletForCheckout(session.access_token);
  }

  async function loadWalletForCheckout(token) {
    try {
      const res = await fetch('/api/wallet/balance', {
        headers: { 'Authorization': 'Bearer ' + token }
      });

      if (!res.ok) return;

      const data = await res.json();
      userWalletBalance = data.balance_cents;

      if (userWalletBalance > 0) {
        injectWalletUI(data.balance_dollars);
      }
    } catch (err) {
      console.error('[CheckoutWallet] Error:', err);
    }
  }

  function injectWalletUI(balanceDollars) {
    // Find the summary section - insert before the total
    const summaryLine = document.querySelector('.summary-line:last-of-type');
    if (!summaryLine) return;

    const walletHTML = `
      <div class="wallet-checkout-row" id="walletCheckoutRow">
        <label class="wallet-checkout-label">
          <input type="checkbox" id="applyWalletBalance" checked>
          <span>
            Use my balance: <strong>$${balanceDollars}</strong>
            <span class="wallet-discount" id="walletDiscount"></span>
          </span>
        </label>
      </div>
      <style>
        .wallet-checkout-row {
          background: #fef7f7;
          border: 1px solid #fecaca;
          border-radius: 8px;
          padding: 12px 14px;
          margin: 12px 0;
        }
        .wallet-checkout-label {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          font-size: 14px;
          color: #374151;
        }
        .wallet-checkout-label input[type="checkbox"] {
          width: 18px;
          height: 18px;
          accent-color: #991b1b;
        }
        .wallet-checkout-label strong {
          color: #991b1b;
        }
        .wallet-discount {
          color: #059669;
          font-weight: 600;
          margin-left: 4px;
        }
      </style>
    `;

    summaryLine.insertAdjacentHTML('beforebegin', walletHTML);

    // Wire up checkbox
    const checkbox = document.getElementById('applyWalletBalance');
    if (checkbox) {
      checkbox.addEventListener('change', updateWalletDiscount);
      updateWalletDiscount(); // Initial calculation
    }

    // Expose function globally for checkout to use
    window.getWalletCreditToApply = getWalletCreditToApply;
    window.walletBalanceCents = userWalletBalance;
  }

  function updateWalletDiscount() {
    const checkbox = document.getElementById('applyWalletBalance');
    const discountEl = document.getElementById('walletDiscount');
    
    applyWalletCredit = checkbox ? checkbox.checked : false;

    if (applyWalletCredit && userWalletBalance > 0) {
      // Get cart total from the page
      const totEl = document.getElementById('tot');
      let cartTotalCents = 0;
      if (totEl) {
        const text = totEl.textContent.replace(/[^0-9.]/g, '');
        cartTotalCents = Math.round(parseFloat(text) * 100) || 0;
      }

      const toApply = Math.min(userWalletBalance, cartTotalCents);
      if (discountEl) {
        discountEl.textContent = '(-$' + (toApply / 100).toFixed(2) + ')';
        discountEl.style.display = 'inline';
      }
    } else {
      if (discountEl) discountEl.style.display = 'none';
    }
  }

  function getWalletCreditToApply() {
    if (!applyWalletCredit || userWalletBalance <= 0) return 0;
    
    // Get cart total from the page
    const totEl = document.getElementById('tot');
    let cartTotalCents = 0;
    if (totEl) {
      const text = totEl.textContent.replace(/[^0-9.]/g, '');
      cartTotalCents = Math.round(parseFloat(text) * 100) || 0;
    }
    
    return Math.min(userWalletBalance, cartTotalCents);
  }
})();

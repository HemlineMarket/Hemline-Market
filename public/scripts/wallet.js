// public/scripts/wallet.js
// Hemline Market Wallet / Store Credit System
// Add this script to account.html: <script src="scripts/wallet.js"></script>

(function() {
  'use strict';

  // Wait for page to load
  document.addEventListener('DOMContentLoaded', initWallet);

  async function initWallet() {
    // Check if we have supabase
    const supabase = window.supabaseClient || window.HM?.supabase;
    if (!supabase) {
      console.warn('[Wallet] No supabase client found');
      return;
    }

    // Check if user is logged in
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    // Create and inject wallet section
    const walletHTML = createWalletHTML();
    const profileCard = document.querySelector('.hm-card');
    if (profileCard) {
      profileCard.insertAdjacentHTML('beforebegin', walletHTML);
    }

    // Load wallet data
    await loadWalletData(session.access_token);

    // Wire up withdraw button
    const withdrawBtn = document.getElementById('walletWithdrawBtn');
    if (withdrawBtn) {
      withdrawBtn.addEventListener('click', () => handleWithdraw(session.access_token));
    }
  }

  function createWalletHTML() {
    return `
    <section class="hm-card wallet-section" id="walletSection" style="display:none;">
      <div class="hm-card-header">Your Earnings</div>
      <div class="hm-card-body">
        <div class="wallet-content">
          <div class="wallet-balance-area">
            <div class="wallet-amount" id="walletAmount">$0.00</div>
            <div class="wallet-label">Available balance</div>
          </div>
          <div class="wallet-buttons">
            <a href="browse.html" class="btn">Shop Now</a>
            <button class="btn btn-primary" id="walletWithdrawBtn" disabled>Withdraw to Bank</button>
          </div>
        </div>
        <div class="wallet-history" id="walletHistory"></div>
      </div>
    </section>
    <style>
      .wallet-section { margin-bottom: 16px; }
      .wallet-content {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 16px;
      }
      .wallet-balance-area { display: flex; flex-direction: column; gap: 4px; }
      .wallet-amount { font-size: 32px; font-weight: 800; color: #991b1b; }
      .wallet-label { font-size: 14px; color: #6b7280; }
      .wallet-buttons { display: flex; gap: 12px; flex-wrap: wrap; }
      .wallet-buttons .btn {
        padding: 10px 20px;
        border-radius: 8px;
        font-weight: 600;
        font-size: 14px;
        text-decoration: none;
        cursor: pointer;
        border: 1px solid #d1d5db;
        background: #fff;
        color: #374151;
      }
      .wallet-buttons .btn:hover { background: #f9fafb; }
      .wallet-buttons .btn-primary {
        background: #991b1b;
        border-color: #991b1b;
        color: #fff;
      }
      .wallet-buttons .btn-primary:hover:not(:disabled) { background: #7f1d1d; }
      .wallet-buttons .btn-primary:disabled { background: #d1d5db; border-color: #d1d5db; cursor: not-allowed; }
      .wallet-history { margin-top: 20px; border-top: 1px solid #e5e7eb; padding-top: 16px; }
      .wallet-history:empty { display: none; }
      .wallet-history-title { font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 12px; }
      .wallet-tx {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 0;
        border-bottom: 1px solid #f3f4f6;
      }
      .wallet-tx:last-child { border-bottom: none; }
      .wallet-tx-info { display: flex; flex-direction: column; gap: 2px; }
      .wallet-tx-type { font-size: 14px; font-weight: 500; color: #111827; }
      .wallet-tx-date { font-size: 12px; color: #6b7280; }
      .wallet-tx-amount { font-size: 14px; font-weight: 600; }
      .wallet-tx-amount.credit { color: #059669; }
      .wallet-tx-amount.debit { color: #dc2626; }
      @media (max-width: 640px) {
        .wallet-content { flex-direction: column; align-items: flex-start; }
        .wallet-buttons { width: 100%; }
        .wallet-buttons .btn { flex: 1; text-align: center; }
      }
    </style>
    `;
  }

  async function loadWalletData(token) {
    try {
      // Fetch balance
      const balanceRes = await fetch('/api/wallet/balance', {
        headers: { 'Authorization': 'Bearer ' + token }
      });

      if (!balanceRes.ok) {
        console.warn('[Wallet] Could not fetch balance');
        return;
      }

      const balance = await balanceRes.json();

      // Show section if user has wallet or balance
      if (balance.has_wallet || balance.balance_cents > 0) {
        const section = document.getElementById('walletSection');
        const amountEl = document.getElementById('walletAmount');
        const withdrawBtn = document.getElementById('walletWithdrawBtn');

        if (section) section.style.display = 'block';
        if (amountEl) amountEl.textContent = '$' + balance.balance_dollars;
        if (withdrawBtn) withdrawBtn.disabled = balance.balance_cents < 100;

        // Store balance for withdraw
        window.__walletBalanceCents = balance.balance_cents;

        // Load transactions
        await loadTransactions(token);
      }
    } catch (err) {
      console.error('[Wallet] Load error:', err);
    }
  }

  async function loadTransactions(token) {
    try {
      const res = await fetch('/api/wallet/transactions?limit=5', {
        headers: { 'Authorization': 'Bearer ' + token }
      });

      if (!res.ok) return;

      const data = await res.json();
      const historyEl = document.getElementById('walletHistory');

      if (!data.transactions?.length || !historyEl) return;

      const typeLabels = {
        sale_proceeds: 'Sale',
        purchase: 'Purchase',
        refund: 'Refund',
        withdrawal: 'Withdrawal',
        adjustment: 'Adjustment'
      };

      let html = '<div class="wallet-history-title">Recent Activity</div>';

      data.transactions.forEach(tx => {
        const date = new Date(tx.created_at).toLocaleDateString();
        const sign = tx.is_credit ? '+' : '-';
        const cls = tx.is_credit ? 'credit' : 'debit';
        const label = typeLabels[tx.type] || tx.type;

        html += `
          <div class="wallet-tx">
            <div class="wallet-tx-info">
              <span class="wallet-tx-type">${label}</span>
              <span class="wallet-tx-date">${date}</span>
            </div>
            <span class="wallet-tx-amount ${cls}">${sign}$${tx.amount_dollars}</span>
          </div>
        `;
      });

      historyEl.innerHTML = html;
    } catch (err) {
      console.error('[Wallet] Transactions error:', err);
    }
  }

  async function handleWithdraw(token) {
    const balanceCents = window.__walletBalanceCents || 0;

    if (balanceCents < 100) {
      alert('Minimum withdrawal is $1.00');
      return;
    }

    const dollars = (balanceCents / 100).toFixed(2);
    if (!confirm('Withdraw $' + dollars + ' to your bank account?\n\nFunds arrive in 2-3 business days.')) {
      return;
    }

    const btn = document.getElementById('walletWithdrawBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Processing...';
    }

    try {
      const res = await fetch('/api/wallet/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        }
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Withdrawal failed');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Withdraw to Bank';
        }
        return;
      }

      alert('Success! $' + data.amount_dollars + ' is on its way to your bank.\n\nArrives in 2-3 business days.');

      // Refresh wallet display
      const supabase = window.supabaseClient || window.HM?.supabase;
      const { data: { session } } = await supabase.auth.getSession();
      if (session) await loadWalletData(session.access_token);

    } catch (err) {
      console.error('[Wallet] Withdraw error:', err);
      alert('Withdrawal failed. Please try again.');
    }

    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Withdraw to Bank';
    }
  }
})();

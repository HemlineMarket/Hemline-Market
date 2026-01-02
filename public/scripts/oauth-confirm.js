/**
 * Hemline Market — OAuth Login Confirmation
 * 
 * This script adds a security confirmation step after OAuth (Google/Apple) sign-ins.
 * On public computers, this helps prevent accidentally signing into the wrong account.
 * 
 * How it works:
 * 1. Detects OAuth return (URL contains access_token hash fragment)
 * 2. Shows a modal confirming which account the user just signed into
 * 3. User must confirm it's the right account or sign out
 */

(function() {
  'use strict';
  
  const STORAGE_KEY = 'hm_oauth_confirmed';
  const SESSION_KEY = 'hm_oauth_pending_confirmation';
  
  /**
   * Check if this page load is an OAuth return
   */
  function isOAuthReturn() {
    // Supabase OAuth returns include hash fragments with tokens
    const hash = window.location.hash;
    return hash.includes('access_token') || hash.includes('refresh_token');
  }
  
  /**
   * Check if user just came from auth page (clicked OAuth button)
   */
  function isFromAuthPage() {
    const referrer = document.referrer;
    return referrer.includes('auth.html') || referrer.includes('signin.html');
  }
  
  /**
   * Mark session as needing confirmation
   */
  function markPendingConfirmation(userId) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      userId: userId,
      timestamp: Date.now()
    }));
  }
  
  /**
   * Check if current session needs confirmation
   */
  function needsConfirmation(userId) {
    const pending = sessionStorage.getItem(SESSION_KEY);
    if (!pending) return false;
    
    try {
      const data = JSON.parse(pending);
      // Only show confirmation for the same user within 30 seconds of OAuth return
      return data.userId === userId && (Date.now() - data.timestamp) < 30000;
    } catch {
      return false;
    }
  }
  
  /**
   * Clear confirmation state
   */
  function clearConfirmation() {
    sessionStorage.removeItem(SESSION_KEY);
  }
  
  /**
   * Get the Supabase client
   */
  function getSupabase() {
    return window.HM?.supabase || window.supabase_client || window.supabaseClient;
  }
  
  /**
   * Create and show the confirmation modal
   */
  function showConfirmationModal(user, onConfirm, onSignOut) {
    // Remove any existing modal
    const existing = document.getElementById('hm-oauth-confirm-modal');
    if (existing) existing.remove();
    
    const email = user.email || 'Unknown email';
    const provider = user.app_metadata?.provider || 'OAuth';
    const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
    
    // Get user's name if available
    const name = user.user_metadata?.full_name || 
                 user.user_metadata?.name ||
                 user.user_metadata?.display_name ||
                 email.split('@')[0];
    
    // Get avatar if available
    const avatar = user.user_metadata?.avatar_url || 
                   user.user_metadata?.picture || 
                   null;
    
    const modal = document.createElement('div');
    modal.id = 'hm-oauth-confirm-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'oauth-confirm-title');
    
    modal.innerHTML = `
      <div class="hm-oauth-confirm-backdrop"></div>
      <div class="hm-oauth-confirm-content">
        <div class="hm-oauth-confirm-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 12l2 2 4-4"></path>
            <circle cx="12" cy="12" r="10"></circle>
          </svg>
        </div>
        
        <h2 id="oauth-confirm-title">Confirm Your Account</h2>
        
        <p class="hm-oauth-confirm-subtitle">
          You've signed in with ${providerName}. Please confirm this is your account:
        </p>
        
        <div class="hm-oauth-confirm-account">
          ${avatar ? `<img src="${avatar}" alt="" class="hm-oauth-confirm-avatar">` : `
            <div class="hm-oauth-confirm-avatar hm-oauth-confirm-avatar-placeholder">
              ${name.charAt(0).toUpperCase()}
            </div>
          `}
          <div class="hm-oauth-confirm-details">
            <div class="hm-oauth-confirm-name">${escapeHtml(name)}</div>
            <div class="hm-oauth-confirm-email">${escapeHtml(email)}</div>
          </div>
        </div>
        
        <div class="hm-oauth-confirm-warning">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>On a shared or public computer? Make sure this is <strong>your</strong> account.</span>
        </div>
        
        <div class="hm-oauth-confirm-actions">
          <button type="button" class="hm-oauth-confirm-btn hm-oauth-confirm-btn-primary" id="oauth-confirm-yes">
            Yes, this is me
          </button>
          <button type="button" class="hm-oauth-confirm-btn hm-oauth-confirm-btn-secondary" id="oauth-confirm-no">
            Not me — Sign out
          </button>
        </div>
      </div>
    `;
    
    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      #hm-oauth-confirm-modal {
        position: fixed;
        inset: 0;
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }
      
      .hm-oauth-confirm-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(4px);
      }
      
      .hm-oauth-confirm-content {
        position: relative;
        background: #fff;
        border-radius: 16px;
        padding: 32px;
        max-width: 420px;
        width: 100%;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
        text-align: center;
        animation: hm-oauth-slide-up 0.3s ease-out;
      }
      
      @keyframes hm-oauth-slide-up {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      
      .hm-oauth-confirm-icon {
        width: 64px;
        height: 64px;
        margin: 0 auto 16px;
        background: #dcfce7;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .hm-oauth-confirm-icon svg {
        width: 32px;
        height: 32px;
        stroke: #16a34a;
      }
      
      #oauth-confirm-title {
        margin: 0 0 8px;
        font-size: 22px;
        font-weight: 700;
        color: #111827;
      }
      
      .hm-oauth-confirm-subtitle {
        margin: 0 0 20px;
        color: #6b7280;
        font-size: 15px;
        line-height: 1.5;
      }
      
      .hm-oauth-confirm-account {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 16px;
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        text-align: left;
        margin-bottom: 16px;
      }
      
      .hm-oauth-confirm-avatar {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
      }
      
      .hm-oauth-confirm-avatar-placeholder {
        background: #991b1b;
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 20px;
      }
      
      .hm-oauth-confirm-details {
        flex: 1;
        min-width: 0;
      }
      
      .hm-oauth-confirm-name {
        font-weight: 600;
        color: #111827;
        font-size: 16px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      
      .hm-oauth-confirm-email {
        color: #6b7280;
        font-size: 14px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      
      .hm-oauth-confirm-warning {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 12px 14px;
        background: #fef3c7;
        border: 1px solid #fcd34d;
        border-radius: 10px;
        text-align: left;
        font-size: 13px;
        color: #92400e;
        margin-bottom: 24px;
      }
      
      .hm-oauth-confirm-warning svg {
        width: 18px;
        height: 18px;
        stroke: #d97706;
        flex-shrink: 0;
        margin-top: 1px;
      }
      
      .hm-oauth-confirm-warning strong {
        font-weight: 600;
      }
      
      .hm-oauth-confirm-actions {
        display: grid;
        gap: 10px;
      }
      
      .hm-oauth-confirm-btn {
        padding: 14px 20px;
        border-radius: 10px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        border: none;
        font-family: inherit;
      }
      
      .hm-oauth-confirm-btn-primary {
        background: #991b1b;
        color: #fff;
      }
      
      .hm-oauth-confirm-btn-primary:hover {
        background: #7f1d1d;
      }
      
      .hm-oauth-confirm-btn-secondary {
        background: #fff;
        color: #6b7280;
        border: 1px solid #e5e7eb;
      }
      
      .hm-oauth-confirm-btn-secondary:hover {
        background: #f9fafb;
        color: #374151;
        border-color: #d1d5db;
      }
      
      @media (max-width: 480px) {
        .hm-oauth-confirm-content {
          padding: 24px 20px;
        }
        
        .hm-oauth-confirm-account {
          padding: 12px;
        }
        
        .hm-oauth-confirm-avatar {
          width: 40px;
          height: 40px;
        }
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(modal);
    
    // Lock scroll
    document.body.style.overflow = 'hidden';
    
    // Wire up buttons
    document.getElementById('oauth-confirm-yes').addEventListener('click', () => {
      document.body.style.overflow = '';
      modal.remove();
      style.remove();
      onConfirm();
    });
    
    document.getElementById('oauth-confirm-no').addEventListener('click', () => {
      document.body.style.overflow = '';
      modal.remove();
      style.remove();
      onSignOut();
    });
    
    // Focus the primary button
    document.getElementById('oauth-confirm-yes').focus();
    
    // Trap focus within modal
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        const focusable = modal.querySelectorAll('button');
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
      
      // Prevent Escape from closing - user must choose
      if (e.key === 'Escape') {
        e.preventDefault();
      }
    });
  }
  
  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  
  /**
   * Main initialization
   */
  async function init() {
    // Wait for Supabase to be ready
    const waitForSupabase = () => {
      return new Promise((resolve) => {
        const check = () => {
          const sb = getSupabase();
          if (sb) {
            resolve(sb);
          } else {
            setTimeout(check, 50);
          }
        };
        check();
        // Timeout after 5 seconds
        setTimeout(() => resolve(null), 5000);
      });
    };
    
    const supabase = await waitForSupabase();
    if (!supabase) {
      console.warn('[OAuth Confirm] Supabase not available');
      return;
    }
    
    // Check if this is an OAuth return
    if (isOAuthReturn()) {
      // Get the session that was just created
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        // Check if this user signed in via OAuth (not password)
        const provider = session.user.app_metadata?.provider;
        if (provider && provider !== 'email') {
          // Mark this session as needing confirmation
          markPendingConfirmation(session.user.id);
          
          // Clean up URL hash
          if (window.history.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
          }
        }
      }
    }
    
    // Check if we need to show confirmation
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session?.user && needsConfirmation(session.user.id)) {
      showConfirmationModal(
        session.user,
        // On confirm
        () => {
          clearConfirmation();
          // Optionally save that this user confirmed on this device
          try {
            const confirmed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            if (!confirmed.includes(session.user.id)) {
              confirmed.push(session.user.id);
              // Keep only last 10 confirmed users
              while (confirmed.length > 10) confirmed.shift();
              localStorage.setItem(STORAGE_KEY, JSON.stringify(confirmed));
            }
          } catch {}
        },
        // On sign out
        async () => {
          clearConfirmation();
          try {
            await supabase.auth.signOut();
            // Redirect to auth page
            window.location.href = 'auth.html';
          } catch (err) {
            console.error('[OAuth Confirm] Sign out error:', err);
            alert('Error signing out. Please try again.');
          }
        }
      );
    }
  }
  
  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Small delay to ensure Supabase and other scripts are loaded
    setTimeout(init, 100);
  }
  
  // Also expose for manual triggering if needed
  window.HM = window.HM || {};
  window.HM.showOAuthConfirmation = function() {
    const supabase = getSupabase();
    if (!supabase) return;
    
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        showConfirmationModal(
          session.user,
          () => {},
          async () => {
            await supabase.auth.signOut();
            window.location.href = 'auth.html';
          }
        );
      }
    });
  };
})();

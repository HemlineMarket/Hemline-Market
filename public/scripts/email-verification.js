// public/scripts/email-verification.js
// Email verification check for Hemline Market

(function() {
  'use strict';
  
  // Check if the current user has verified their email
  // Returns: { verified: boolean, email: string|null }
  window.HM_checkEmailVerification = async function() {
    const supabase = window.getSupabaseClient ? window.getSupabaseClient() : 
                     (window.HM && window.HM.supabase) || window.supabase_client;
    
    if (!supabase) {
      return { verified: false, email: null, error: 'No Supabase client' };
    }
    
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      
      if (error || !user) {
        return { verified: false, email: null, error: error?.message || 'Not logged in' };
      }
      
      // Check email_confirmed_at field
      const verified = !!user.email_confirmed_at;
      
      return {
        verified: verified,
        email: user.email,
        confirmedAt: user.email_confirmed_at
      };
    } catch (e) {
      return { verified: false, email: null, error: e.message };
    }
  };
  
  // Require email verification before proceeding
  // Shows a modal/banner if not verified
  // Returns true if verified, false if not
  window.HM_requireEmailVerification = async function(options = {}) {
    const {
      redirectTo = null,           // URL to redirect to if not verified
      showBanner = true,           // Show a banner message
      bannerMessage = 'Please verify your email address to continue.',
      allowResend = true           // Show resend verification email button
    } = options;
    
    const result = await window.HM_checkEmailVerification();
    
    if (result.verified) {
      return true;
    }
    
    if (!result.email) {
      // Not logged in
      if (redirectTo) {
        window.location.href = '/auth.html?redirect=' + encodeURIComponent(redirectTo);
      }
      return false;
    }
    
    // User is logged in but email not verified
    if (showBanner) {
      window.HM_showVerificationBanner(result.email, bannerMessage, allowResend);
    }
    
    return false;
  };
  
  // Show verification banner
  window.HM_showVerificationBanner = function(email, message, allowResend) {
    // Remove existing banner
    const existing = document.getElementById('hm-verification-banner');
    if (existing) existing.remove();
    
    const banner = document.createElement('div');
    banner.id = 'hm-verification-banner';
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: #fef3c7;
      border-bottom: 1px solid #fcd34d;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      z-index: 10000;
      font-size: 14px;
      color: #92400e;
    `;
    
    banner.innerHTML = `
      <span>⚠️ ${message}</span>
      ${allowResend ? `
        <button id="hm-resend-verification" style="
          background: #991b1b;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
          font-size: 13px;
        ">Resend verification email</button>
      ` : ''}
      <button id="hm-close-verification" style="
        background: none;
        border: none;
        cursor: pointer;
        font-size: 18px;
        color: #92400e;
        padding: 4px 8px;
      ">×</button>
    `;
    
    document.body.insertBefore(banner, document.body.firstChild);
    
    // Adjust body padding
    document.body.style.paddingTop = banner.offsetHeight + 'px';
    
    // Close button
    document.getElementById('hm-close-verification')?.addEventListener('click', () => {
      banner.remove();
      document.body.style.paddingTop = '';
    });
    
    // Resend button
    if (allowResend) {
      document.getElementById('hm-resend-verification')?.addEventListener('click', async () => {
        const btn = document.getElementById('hm-resend-verification');
        btn.disabled = true;
        btn.textContent = 'Sending...';
        
        await window.HM_resendVerificationEmail();
        
        btn.textContent = 'Email sent!';
        setTimeout(() => {
          btn.textContent = 'Resend verification email';
          btn.disabled = false;
        }, 3000);
      });
    }
  };
  
  // Resend verification email
  window.HM_resendVerificationEmail = async function() {
    const supabase = window.getSupabaseClient ? window.getSupabaseClient() : 
                     (window.HM && window.HM.supabase) || window.supabase_client;
    
    if (!supabase) {
      alert('Could not send verification email. Please try again.');
      return false;
    }
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user?.email) {
        alert('No email address found. Please log in again.');
        return false;
      }
      
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: user.email,
        options: {
          emailRedirectTo: window.location.origin + '/auth.html'
        }
      });
      
      if (error) {
        alert('Could not send verification email: ' + error.message);
        return false;
      }
      
      return true;
    } catch (e) {
      alert('Could not send verification email. Please try again.');
      return false;
    }
  };
})();

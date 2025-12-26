// public/scripts/profile-check.js
// Shared profile completeness checker for Hemline Market
// Include this script on pages that require a complete profile (sell, checkout, etc.)

window.HM = window.HM || {};

window.HM.checkProfileComplete = function() {
  try {
    const raw = localStorage.getItem('hm_profile_complete');
    if (!raw) return { complete: false, hasRealName: false, hasAddress: false };
    return JSON.parse(raw);
  } catch (e) {
    return { complete: false, hasRealName: false, hasAddress: false };
  }
};

window.HM.requireCompleteProfile = function(options = {}) {
  const {
    redirectTo = 'account.html',
    message = 'Please complete your profile before continuing.',
    allowContinue = false
  } = options;

  const status = window.HM.checkProfileComplete();
  
  if (!status.complete) {
    const missing = [];
    if (!status.hasRealName) missing.push('your name');
    if (!status.hasAddress) missing.push('your shipping address');
    
    const fullMessage = message + '\n\nMissing: ' + missing.join(' and ');
    
    if (allowContinue) {
      if (!confirm(fullMessage + '\n\nGo to your account to complete your profile?')) {
        return status; // User chose to continue anyway
      }
    } else {
      alert(fullMessage);
    }
    
    window.location.href = redirectTo;
    return null; // Will redirect
  }
  
  return status;
};

// Show a warning banner on the current page
window.HM.showProfileWarningBanner = function(containerId, options = {}) {
  const status = window.HM.checkProfileComplete();
  if (status.complete) return false;
  
  const container = document.getElementById(containerId);
  if (!container) return false;
  
  const {
    message = 'Complete your profile to continue',
    buttonText = 'Complete Profile'
  } = options;
  
  const missing = [];
  if (!status.hasRealName) missing.push('name');
  if (!status.hasAddress) missing.push('shipping address');
  
  const banner = document.createElement('div');
  banner.className = 'hm-profile-warning-banner';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;padding:16px 20px;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;margin-bottom:20px;flex-wrap:wrap;">
      <span style="font-size:24px;">⚠️</span>
      <div style="flex:1;min-width:200px;">
        <strong style="color:#92400e;">${message}</strong>
        <p style="margin:4px 0 0;font-size:13px;color:#a16207;">Please add your ${missing.join(' and ')} first.</p>
      </div>
      <a href="account.html" style="padding:8px 16px;background:#991b1b;color:#fff;border-radius:999px;text-decoration:none;font-weight:600;font-size:13px;">${buttonText}</a>
    </div>
  `;
  
  container.insertBefore(banner, container.firstChild);
  return true;
};

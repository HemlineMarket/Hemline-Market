// content-filter.js
// Blocks off-platform payment methods in bios, descriptions, and messages

(function() {
  const BLOCKED_KEYWORDS = [
    'venmo',
    'paypal',
    'cashapp',
    'cash app',
    'zelle'
  ];

  function containsBlockedContent(text) {
    if (!text || typeof text !== 'string') return { blocked: false };
    
    const lowerText = text.toLowerCase();
    
    for (const keyword of BLOCKED_KEYWORDS) {
      if (lowerText.includes(keyword)) {
        return { 
          blocked: true, 
          reason: `Payment apps like "${keyword}" are not allowed. All transactions must go through Hemline Market.`
        };
      }
    }
    
    return { blocked: false };
  }

  function showBlockedWarning(inputEl, reason) {
    const existingWarning = inputEl.parentElement.querySelector('.content-filter-warning');
    if (existingWarning) existingWarning.remove();
    
    const warning = document.createElement('div');
    warning.className = 'content-filter-warning';
    warning.style.cssText = 'color:#991b1b;font-size:13px;margin-top:6px;padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;';
    warning.innerHTML = `<strong>⚠️ Not allowed:</strong> ${reason}`;
    
    inputEl.parentElement.appendChild(warning);
    inputEl.style.borderColor = '#991b1b';
  }

  function clearWarning(inputEl) {
    const existingWarning = inputEl.parentElement.querySelector('.content-filter-warning');
    if (existingWarning) existingWarning.remove();
    inputEl.style.borderColor = '';
  }

  function attachFilter(inputEl) {
    if (!inputEl || inputEl.dataset.contentFilterAttached) return;
    inputEl.dataset.contentFilterAttached = 'true';
    
    inputEl.addEventListener('input', function() {
      const result = containsBlockedContent(this.value);
      if (result.blocked) {
        showBlockedWarning(this, result.reason);
      } else {
        clearWarning(this);
      }
    });
  }

  function validateContent(text) {
    return !containsBlockedContent(text).blocked;
  }

  function autoAttach() {
    const selectors = ['#bio', '#description', '#desc', 'textarea[name="bio"]', 'textarea[name="description"]', 'textarea[name="desc"]'];
    selectors.forEach(selector => {
      const el = document.querySelector(selector);
      if (el) attachFilter(el);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoAttach);
  } else {
    autoAttach();
  }

  window.HMContentFilter = {
    validate: validateContent,
    check: containsBlockedContent,
    attachFilter: attachFilter
  };
})();

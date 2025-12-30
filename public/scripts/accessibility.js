// public/scripts/accessibility.js
// Accessibility improvements for Hemline Market

(function() {
  'use strict';
  
  // Create an aria-live region for announcing messages to screen readers
  function createAnnouncer() {
    if (document.getElementById('hm-announcer')) return;
    
    const announcer = document.createElement('div');
    announcer.id = 'hm-announcer';
    announcer.setAttribute('aria-live', 'polite');
    announcer.setAttribute('aria-atomic', 'true');
    announcer.setAttribute('role', 'status');
    announcer.style.cssText = 'position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden;';
    document.body.appendChild(announcer);
  }
  
  // Announce a message to screen readers
  window.HM_announce = function(message, priority) {
    createAnnouncer();
    const announcer = document.getElementById('hm-announcer');
    if (!announcer) return;
    
    // Set priority (polite or assertive)
    announcer.setAttribute('aria-live', priority === 'assertive' ? 'assertive' : 'polite');
    
    // Clear and set message (needs to change for screen reader to pick it up)
    announcer.textContent = '';
    setTimeout(() => {
      announcer.textContent = message;
    }, 100);
  };
  
  // Add skip link for keyboard navigation
  function addSkipLink() {
    if (document.getElementById('hm-skip-link')) return;
    
    const skip = document.createElement('a');
    skip.id = 'hm-skip-link';
    skip.href = '#maincontent';
    skip.textContent = 'Skip to main content';
    skip.style.cssText = `
      position: absolute;
      top: -40px;
      left: 0;
      background: #991b1b;
      color: #fff;
      padding: 8px 16px;
      z-index: 10000;
      text-decoration: none;
      font-weight: 700;
      border-radius: 0 0 8px 0;
      transition: top 0.2s;
    `;
    
    skip.addEventListener('focus', () => {
      skip.style.top = '0';
    });
    
    skip.addEventListener('blur', () => {
      skip.style.top = '-40px';
    });
    
    document.body.insertBefore(skip, document.body.firstChild);
  }
  
  // Ensure all images have alt text
  function auditImages() {
    const images = document.querySelectorAll('img:not([alt])');
    images.forEach(img => {
      img.setAttribute('alt', ''); // Decorative image default
    });
  }
  
  // Add focus visible styles for keyboard navigation
  function addFocusStyles() {
    if (document.getElementById('hm-focus-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'hm-focus-styles';
    style.textContent = `
      /* Visible focus ring for keyboard users */
      :focus-visible {
        outline: 2px solid #991b1b !important;
        outline-offset: 2px !important;
      }
      
      /* Remove default focus ring when using mouse */
      :focus:not(:focus-visible) {
        outline: none;
      }
      
      /* Ensure buttons and links have sufficient touch target size - only in main content */
      main button, main a, main [role="button"] {
        min-height: 44px;
        min-width: 44px;
      }
      
      /* Improve color contrast for muted text */
      .muted, .meta, [class*="muted"] {
        color: #4b5563 !important; /* Darker gray for better contrast */
      }
    `;
    document.head.appendChild(style);
  }
  
  // Handle reduced motion preference
  function handleReducedMotion() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const style = document.createElement('style');
      style.id = 'hm-reduced-motion';
      style.textContent = `
        *, *::before, *::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.01ms !important;
        }
      `;
      document.head.appendChild(style);
    }
  }
  
  // Initialize on DOM ready
  function init() {
    addSkipLink();
    auditImages();
    addFocusStyles();
    handleReducedMotion();
    createAnnouncer();
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

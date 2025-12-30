// public/scripts/sw-register.js
// Service Worker registration for Hemline Market

(function() {
  'use strict';
  
  // Only register in production and if supported
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(registration => {
          // Check for updates periodically
          setInterval(() => {
            registration.update();
          }, 60 * 60 * 1000); // Check every hour
          
          // Handle updates
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New version available - show update prompt
                if (window.HM_showUpdatePrompt) {
                  window.HM_showUpdatePrompt();
                }
              }
            });
          });
        })
        .catch(err => {
          // Service worker registration failed - not critical
        });
    });
  }
  
  // Function to show update prompt (can be customized)
  window.HM_showUpdatePrompt = function() {
    const shouldUpdate = confirm('A new version of Hemline Market is available. Refresh to update?');
    if (shouldUpdate) {
      window.location.reload();
    }
  };
  
  // Force update when requested
  window.HM_forceUpdate = function() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(registration => {
        registration.update();
      });
    }
  };
})();

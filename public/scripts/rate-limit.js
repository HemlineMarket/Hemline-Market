// public/scripts/rate-limit.js
// Client-side rate limiting for auth forms to prevent brute force attacks

(function() {
  'use strict';
  
  const STORAGE_KEY = 'hm_rate_limit';
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_DURATION_MS = 60 * 1000; // 1 minute
  const ATTEMPT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes - attempts expire after this
  
  function getAttempts() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const now = Date.now();
      
      // Clean up old attempts
      if (data.attempts && Array.isArray(data.attempts)) {
        data.attempts = data.attempts.filter(ts => now - ts < ATTEMPT_WINDOW_MS);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      }
      
      return data;
    } catch (e) {
      return { attempts: [], lockedUntil: 0 };
    }
  }
  
  function saveAttempts(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      // localStorage full or unavailable
    }
  }
  
  // Check if user is currently locked out
  // Returns { allowed: boolean, waitSeconds: number }
  window.HM_checkRateLimit = function() {
    const data = getAttempts();
    const now = Date.now();
    
    // Check if in lockout period
    if (data.lockedUntil && now < data.lockedUntil) {
      const waitSeconds = Math.ceil((data.lockedUntil - now) / 1000);
      return { allowed: false, waitSeconds: waitSeconds };
    }
    
    // Check attempt count
    const recentAttempts = (data.attempts || []).filter(ts => now - ts < ATTEMPT_WINDOW_MS);
    
    if (recentAttempts.length >= MAX_ATTEMPTS) {
      // Lock the user out
      data.lockedUntil = now + LOCKOUT_DURATION_MS;
      data.attempts = recentAttempts;
      saveAttempts(data);
      
      return { allowed: false, waitSeconds: Math.ceil(LOCKOUT_DURATION_MS / 1000) };
    }
    
    return { allowed: true, waitSeconds: 0 };
  };
  
  // Record a failed login attempt
  window.HM_recordFailedAttempt = function() {
    const data = getAttempts();
    const now = Date.now();
    
    if (!data.attempts) {
      data.attempts = [];
    }
    
    data.attempts.push(now);
    
    // Check if we should lock
    const recentAttempts = data.attempts.filter(ts => now - ts < ATTEMPT_WINDOW_MS);
    if (recentAttempts.length >= MAX_ATTEMPTS) {
      data.lockedUntil = now + LOCKOUT_DURATION_MS;
    }
    
    data.attempts = recentAttempts;
    saveAttempts(data);
  };
  
  // Clear rate limit on successful login
  window.HM_clearRateLimit = function() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // Ignore
    }
  };
  
  // Get remaining attempts before lockout
  window.HM_getRemainingAttempts = function() {
    const data = getAttempts();
    const now = Date.now();
    const recentAttempts = (data.attempts || []).filter(ts => now - ts < ATTEMPT_WINDOW_MS);
    return Math.max(0, MAX_ATTEMPTS - recentAttempts.length);
  };
})();

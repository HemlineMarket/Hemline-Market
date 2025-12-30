// public/sw.js
// Service Worker for Hemline Market - Offline support and caching

const CACHE_NAME = 'hemline-v1';
const STATIC_CACHE = 'hemline-static-v1';
const DYNAMIC_CACHE = 'hemline-dynamic-v1';

// Static assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/browse.html',
  '/auth.html',
  '/cart.html',
  '/styles/hm-modern.css',
  '/styles/hm-header.css',
  '/styles/hm-typography.css',
  '/styles/hm-footer.css',
  '/scripts/hm-shell.js',
  '/favicon.ico',
  '/images/favicon-16.png',
  '/images/favicon-32.png',
];

// Install event - cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map(key => {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') return;
  
  // Skip API requests - always go to network
  if (url.pathname.startsWith('/api/')) return;
  
  // Skip Supabase and Stripe requests
  if (url.hostname.includes('supabase') || url.hostname.includes('stripe')) return;
  
  // For HTML pages - network first, fallback to cache
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Clone and cache the response
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE).then(cache => {
            cache.put(request, clone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(request).then(cached => {
            return cached || caches.match('/index.html');
          });
        })
    );
    return;
  }
  
  // For images - cache first, fallback to network
  if (request.destination === 'image') {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        
        return fetch(request).then(response => {
          // Only cache successful responses
          if (response.ok) {
            const clone = response.clone();
            caches.open(DYNAMIC_CACHE).then(cache => {
              cache.put(request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }
  
  // For CSS/JS - stale while revalidate
  if (request.destination === 'style' || request.destination === 'script') {
    event.respondWith(
      caches.match(request).then(cached => {
        const fetchPromise = fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then(cache => {
              cache.put(request, clone);
            });
          }
          return response;
        });
        
        return cached || fetchPromise;
      })
    );
    return;
  }
  
  // Default - network first
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// Handle messages from the main thread
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});

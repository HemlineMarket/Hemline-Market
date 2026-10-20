// public/sw.js
// Retired. This worker uninstalls itself and clears every cache it ever
// created, so visitors who still have the old worker get fresh files
// on their next visit. Keep this file in place for a few months.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(client => client.navigate(client.url)))
  );
});

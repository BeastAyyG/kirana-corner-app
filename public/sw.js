// Kirana Corner service worker: offline shell + runtime cache.
// API responses are never cached (always live data); static assets use a
// cache-first strategy with a versioned cache that updates on activate.
const VERSION = 'kirana-v2.0.0';
const SHELL = [
  '/', '/index.html', '/app.js',
  '/css/base.css', '/css/views.css',
  '/js/config.js', '/js/format.js', '/js/art.js', '/js/api.js', '/js/state.js',
  '/js/ui.js', '/js/router.js', '/js/actions.js', '/js/basket-ops.js', '/js/main.js', '/js/install.js',
  '/manifest.webmanifest',
  '/icons/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return; // always network
  // dev servers: always go to network so local edits show up immediately
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return;

  // SPA navigations fall back to the cached shell when offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(VERSION).then(cache => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(VERSION).then(cache => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => cached);
    })
  );
});

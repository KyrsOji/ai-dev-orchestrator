const CACHE_NAME = 'taskboard-v2-cache-v1';
const OFFLINE_URL = '/taskboard-v2/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Precache offline page and manifest
    await cache.addAll([
      OFFLINE_URL,
      '/taskboard-v2/manifest.webmanifest',
      '/taskboard-v2/assets/icons/icon.svg'
    ]);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // cleanup old caches
    const keys = await caches.keys();
    await Promise.all(keys.map(k => { if (k !== CACHE_NAME) return caches.delete(k); return Promise.resolve(); }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  try {
    const req = event.request;
    // Navigation requests -> network first, fallback to offline page from cache
    if (req.mode === 'navigate') {
      event.respondWith((async () => {
        try {
          const preload = await event.preloadResponse;
          if (preload) return preload;
          const networkResponse = await fetch(req);
          return networkResponse;
        } catch (e) {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(OFFLINE_URL);
          return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      })());
      return;
    }

    // For other requests, try cache first then network
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        // optionally cache static GET responses
        if (req.method === 'GET' && resp && resp.status === 200 && req.url.startsWith(self.location.origin)) {
          try { cache.put(req, resp.clone()); } catch (e) { /* ignore */ }
        }
        return resp;
      } catch (e) {
        return cached || new Response('', { status: 502, statusText: 'Bad Gateway' });
      }
    })());
  } catch (e) {
    // swallow
  }
});

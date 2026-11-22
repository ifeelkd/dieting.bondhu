// Dieting Bondhu Service Worker — auto-updating offline-first strategy
const CACHE_NAME = 'db-v9';
const FONT_CACHE = 'db-fonts-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json'
];

// Handle skipWaiting message from client
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Install: pre-cache core shell & activate immediately without waiting
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS))
  );
});

// Activate: clean up outdated caches & claim all open clients immediately
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== FONT_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch handler
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 0. Version check: strictly bypass all caching
  if (url.pathname === '/version.json') {
    e.respondWith(fetch(e.request, { cache: 'no-store' }));
    return;
  }

  // 1. Google Fonts: Cache-first (fonts never change once downloaded)
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.open(FONT_CACHE).then(cache =>
        cache.match(e.request).then(cached =>
          cached || fetch(e.request).then(res => {
            if (res && res.status === 200) cache.put(e.request, res.clone());
            return res;
          })
        )
      )
    );
    return;
  }

  // 2. HTML navigation requests (/, /index.html): Network-First!
  // Always fetch fresh HTML from network so new updates show up immediately.
  // If offline or request fails, seamlessly fall back to cached shell.
  if (e.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(c => c || caches.match('/index.html')))
    );
    return;
  }

  // 3. Same-origin assets (icons, manifest): Stale-While-Revalidate
  // Return cached version fast, while fetching fresh copy in background.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const netFetch = fetch(e.request).then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return res;
        }).catch(() => null);

        return cached || netFetch;
      })
    );
    return;
  }

  // 4. Any external requests: Network with cache fallback
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

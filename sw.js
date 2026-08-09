// Cache-first service worker so the screen works offline.
// Bump VERSION on every deploy to refresh caches.
const VERSION = 'v30';
const CACHE = `dmsk-${VERSION}`;

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/base.css', 'css/layout.css', 'css/components.css',
  'includes/dndlogo1.png',
  'assets/favicon.svg', 'assets/art-logo.png', 'assets/icon-16.png', 'assets/icon-32.png',
  'assets/icon-180.png', 'assets/icon-192.png', 'assets/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for same-origin requests, falling back to cache when offline.
// Successful responses are cached, so js/ and data/ get cached on first use.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

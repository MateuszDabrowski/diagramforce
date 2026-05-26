/* Diagramforce service worker — offline app cache.
 *
 * The app is fully static. We use a cache-first strategy keyed on APP_VERSION
 * so that a version bump (changing APP_VERSION + all `?v=` query strings) lands
 * in a fresh cache and the old cache is purged on activation.
 *
 * IMPORTANT: keep APP_VERSION in lockstep with js/persistence.js — the manual
 * version bump documented in CLAUDE.md must update this file too.
 */

const APP_VERSION = '1.12.2';
const CACHE_NAME = `diagramforce-v${APP_VERSION}`;

// Same-origin assets to pre-cache on install. Anything not listed here is
// fetched on demand and cached opportunistically (still same-origin only).
// We deliberately do NOT pre-cache every SLDS sprite (~30 files / >1MB) —
// they're cached lazily as the user encounters icons.
const PRECACHE_URLS = [
  './',
  './index.html',
  // App CSS
  `./css/variables.css?v=${APP_VERSION}`,
  `./css/theme.css?v=${APP_VERSION}`,
  `./css/layout.css?v=${APP_VERSION}`,
  `./css/toolbar.css?v=${APP_VERSION}`,
  `./css/stencil.css?v=${APP_VERSION}`,
  `./css/properties.css?v=${APP_VERSION}`,
  `./css/tabs.css?v=${APP_VERSION}`,
  `./css/canvas.css?v=${APP_VERSION}`,
  `./css/modals.css?v=${APP_VERSION}`,
  // App JS
  `./js/app.js?v=${APP_VERSION}`,
  // Vendored libraries
  `./assets/vendor/joint.min.js?v=${APP_VERSION}`,
  `./assets/vendor/pako.min.js?v=${APP_VERSION}`,
  `./assets/vendor/gifenc.esm.js?v=${APP_VERSION}`,
  // Static images
  './assets/logo.png',
  './assets/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
      // Activate immediately on first install — no need to wait for tabs to close.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith('diagramforce-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle GETs.  POST etc. are passed through.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Cache same-origin only.  Cross-origin requests bypass the cache layer
  // entirely so we never store opaque responses.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;

    try {
      const response = await fetch(req);
      // Only cache successful, non-opaque responses.
      if (response && response.ok && response.type !== 'opaque') {
        // Clone before consuming — Response bodies are single-use.
        cache.put(req, response.clone()).catch(() => { /* quota errors are non-fatal */ });
      }
      return response;
    } catch (err) {
      // Offline + nothing in cache → return a 504 so the page surfaces a real
      // network error instead of hanging.
      return new Response('Offline and not cached', { status: 504, statusText: 'Gateway Timeout' });
    }
  })());
});

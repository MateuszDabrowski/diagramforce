/* Diagramforce service worker — offline app cache.
 *
 * The app is fully static. We use a cache-first strategy keyed on CACHE_VERSION
 * so that a version bump (changing CACHE_VERSION + all `?v=` query strings) lands
 * in a fresh cache and the old cache is purged on activation.
 *
 * CACHE_VERSION is the CACHE key `RELEASE.DEV_BUILD` (e.g. 1.17.0.3), NOT the
 * displayed release (js/persistence.js APP_VERSION = 1.17.0). `npm run bump`/`bump:dev`
 * keep CACHE_VERSION in lockstep with every `?v=`; version-consistency.test.js enforces it.
 */

const CACHE_VERSION = '1.18.1';
const CACHE_NAME = `diagramforce-v${CACHE_VERSION}`;

// Same-origin assets to pre-cache on install. Anything not listed here is
// fetched on demand and cached opportunistically (still same-origin only).
// We deliberately do NOT pre-cache every SLDS sprite (~30 files / >1MB) —
// they're cached lazily as the user encounters icons.
const PRECACHE_URLS = [
  './',
  './index.html',
  // Standalone legal pages (self-contained, no versioned assets; refreshed when the
  // cache name changes on each version bump).
  './privacy.html',
  './terms.html',
  './support.html',
  './assets/support.js',   // support.html's runtime email-obfuscation script (no ?v= — refreshed by cache name)
  // App CSS
  `./css/variables.css?v=${CACHE_VERSION}`,
  `./css/theme.css?v=${CACHE_VERSION}`,
  `./css/layout.css?v=${CACHE_VERSION}`,
  `./css/toolbar.css?v=${CACHE_VERSION}`,
  `./css/stencil.css?v=${CACHE_VERSION}`,
  `./css/properties.css?v=${CACHE_VERSION}`,
  `./css/tabs.css?v=${CACHE_VERSION}`,
  `./css/canvas.css?v=${CACHE_VERSION}`,
  `./css/modals.css?v=${CACHE_VERSION}`,
  // App JS — every statically-imported module the app needs to boot. All are
  // eager ES imports (no dynamic import() anywhere), so all are boot-critical:
  // omitting any one reintroduces the silent offline-crash this list prevents.
  `./js/a11y.js?v=${CACHE_VERSION}`,
  `./js/app.js?v=${CACHE_VERSION}`,
  `./js/brand-palette.js?v=${CACHE_VERSION}`,
  `./js/canvas.js?v=${CACHE_VERSION}`,
  `./js/canvas/context.js?v=${CACHE_VERSION}`,
  `./js/canvas/focus-state.js?v=${CACHE_VERSION}`,
  `./js/canvas/router.js?v=${CACHE_VERSION}`,
  `./js/canvas/auto-layout.js?v=${CACHE_VERSION}`,
  `./js/canvas/migration.js?v=${CACHE_VERSION}`,
  `./js/canvas/crossing-bumps.js?v=${CACHE_VERSION}`,
  `./js/canvas/viewport.js?v=${CACHE_VERSION}`,
  `./js/canvas/line-style.js?v=${CACHE_VERSION}`,
  `./js/canvas/mobile.js?v=${CACHE_VERSION}`,
  `./js/canvas/external-labels.js?v=${CACHE_VERSION}`,
  `./js/canvas/selection-viz.js?v=${CACHE_VERSION}`,
  `./js/canvas/spacing-guides.js?v=${CACHE_VERSION}`,
  `./js/canvas/embedding.js?v=${CACHE_VERSION}`,
  `./js/clipboard.js?v=${CACHE_VERSION}`,
  `./js/feedback.js?v=${CACHE_VERSION}`,
  `./js/history.js?v=${CACHE_VERSION}`,
  `./js/icons.js?v=${CACHE_VERSION}`,
  `./js/image-component.js?v=${CACHE_VERSION}`,
  `./js/keyboard.js?v=${CACHE_VERSION}`,
  `./js/markdown.js?v=${CACHE_VERSION}`,
  `./js/mermaid-import.js?v=${CACHE_VERSION}`,
  `./js/persistence.js?v=${CACHE_VERSION}`,
  `./js/persistence/context.js?v=${CACHE_VERSION}`,
  `./js/persistence/df-format.js?v=${CACHE_VERSION}`,
  `./js/persistence/diagram-schema.js?v=${CACHE_VERSION}`,
  `./js/persistence/image-export.js?v=${CACHE_VERSION}`,
  `./js/persistence/share-orchestration.js?v=${CACHE_VERSION}`,
  `./js/persistence/versioning.js?v=${CACHE_VERSION}`,
  `./js/persistence/json-pipeline.js?v=${CACHE_VERSION}`,
  `./js/persistence/storage.js?v=${CACHE_VERSION}`,
  `./js/properties.js?v=${CACHE_VERSION}`,
  `./js/selection.js?v=${CACHE_VERSION}`,
  `./js/shapes.js?v=${CACHE_VERSION}`,
  `./js/share-codec.js?v=${CACHE_VERSION}`,
  `./js/stencil.js?v=${CACHE_VERSION}`,
  `./js/components.js?v=${CACHE_VERSION}`,
  `./js/table-view.js?v=${CACHE_VERSION}`,
  `./js/walkthrough.js?v=${CACHE_VERSION}`,
  `./js/whats-new.js?v=${CACHE_VERSION}`,
  `./js/tabs.js?v=${CACHE_VERSION}`,
  `./js/templates.js?v=${CACHE_VERSION}`,
  `./js/theme.js?v=${CACHE_VERSION}`,
  `./js/toolbar.js?v=${CACHE_VERSION}`,
  `./js/util.js?v=${CACHE_VERSION}`,
  `./js/util/geometry.js?v=${CACHE_VERSION}`,
  // Vendored libraries
  `./assets/vendor/joint.min.js?v=${CACHE_VERSION}`,
  `./assets/vendor/pako.min.js?v=${CACHE_VERSION}`,
  `./assets/vendor/gifenc.esm.js?v=${CACHE_VERSION}`,
  // Static images
  './assets/logo.png',
  './assets/favicon.png',
  // PWA install assets (manifest + home-screen/dock icons)
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
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

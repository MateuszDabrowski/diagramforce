// SF Diagrams — App bootstrap
// Initializes all modules in order. JointJS is a global (loaded via CDN script tag).

import * as theme       from './theme.js?v=1.12.4';
import * as icons       from './icons.js?v=1.12.4';
import { getAllStencilSvgs } from './templates.js?v=1.12.4';
import * as shapes      from './shapes.js?v=1.12.4';
import * as canvas      from './canvas.js?v=1.12.4';
import * as stencil     from './stencil.js?v=1.12.4';
import * as selection   from './selection.js?v=1.12.4';
import * as history     from './history.js?v=1.12.4';
import * as clipboard   from './clipboard.js?v=1.12.4';
import * as keyboard    from './keyboard.js?v=1.12.4';
import * as toolbar     from './toolbar.js?v=1.12.4';
import * as properties  from './properties.js?v=1.12.4';
import * as persistence from './persistence.js?v=1.12.4';
import * as tabs        from './tabs.js?v=1.12.4';
import * as mermaidImport from './mermaid-import.js?v=1.12.4';

// Clickjacking defence. `frame-ancestors` / `X-Frame-Options` cannot be sent
// from a static GitHub Pages file, so the framing policy is enforced here.
// Scoped to the production origin so local dev and embedded previews still work.
if (window.top !== window.self && location.hostname === 'diagramforce.mateuszdabrowski.pl') {
  try {
    window.top.location = window.self.location.href;
  } catch {
    document.documentElement.style.display = 'none';
  }
}

async function main() {
  // Set app version in About modal
  const versionEl = document.getElementById('about-version');
  if (versionEl) versionEl.textContent = `v${persistence.APP_VERSION}`;

  // --- Phase 1: Foundation ---
  theme.init();

  // Load SLDS icon sprites into the DOM (async)
  await icons.init();

  // Register custom stencilSvg icons so they appear in icon pickers
  icons.registerStencilIcons(getAllStencilSvgs());

  // Normalize viewBoxes across all icon sets for consistent visual sizing
  icons.normalizeViewBoxes();

  // --- Phase 2: Canvas core ---
  shapes.register();
  canvas.setIconDataUriFn(icons.getIconDataUri);
  const { graph, paper } = canvas.init();

  // --- Phase 3: Stencil panel ---
  stencil.init(graph, paper);

  // --- Phase 4: Interaction ---
  selection.init(graph, paper);
  history.init(graph);
  clipboard.init(graph, paper, selection);

  const moduleRefs = {
    graph,
    paper,
    canvas,
    selection,
    history,
    clipboard,
    persistence,
    toolbar,
    theme,
    stencil,
    tabs,
    mermaidImport,
  };

  keyboard.init(moduleRefs);
  toolbar.init(moduleRefs);

  // --- Phase 5: Properties panel ---
  properties.init(graph, paper, selection);

  // --- Phase 6: Persistence (export/import only, no auto-load) ---
  persistence.init(graph, paper, canvas);

  // --- Phase 7: Tabs (restores session, manages auto-save) ---
  tabs.init(graph, paper, canvas, selection, history, persistence, stencil);
  tabs.setupAutoSave();

  // --- Phase 7b: Mermaid import (needs tabs + canvas + graph) ---
  mermaidImport.init(moduleRefs);

  // --- Phase 8: Mobile interactions ---
  canvas.initMobileDragHandles();

  // --- Phase 9: Check for shared diagram in URL hash ---
  persistence.loadFromURL();

  // --- Phase 10: beforeunload guard (Gap 21, v1.12.0) ---
  // Prevent silent data loss on ⌘R / browser close / back nav when any
  // open tab has uncommitted changes. Session backup catches most cases
  // but quota errors + Private Mode can break the safety net, so a
  // native confirmation is the last line of defence. Modern browsers
  // ignore the custom string (showing their own generic prompt) but
  // both the legacy `returnValue` and event.preventDefault() are
  // required for cross-browser support.
  window.addEventListener('beforeunload', evt => {
    if (!tabs.hasAnyDirty()) return;
    evt.preventDefault();
    evt.returnValue = '';
    return '';
  });
}

main().catch(err => {
  console.error('SF Diagrams: Initialization failed', err);
});

// --- Service worker (offline support) ---
// Same-origin only; falls through gracefully if the browser doesn't support it
// or the registration fails. Cache invalidation is handled inside sw.js by
// keying on APP_VERSION — a version bump lands in a fresh cache and old
// caches are purged on activation.
//
// DEVELOPMENT BYPASS: on localhost / 127.0.0.1 / file:// we actively
// UNREGISTER any existing service worker and skip registration. The
// cache-first strategy is great for shipped builds (offline-capable,
// fast loads) but murder during development — without a version bump
// after every edit, the SW serves stale CSS/JS and you have to use
// reset.html to see changes. Production hostnames keep the SW for the
// PWA experience. End users are NOT affected by this bypass.
const isDevHost = ['localhost', '127.0.0.1', '0.0.0.0', ''].includes(location.hostname)
  || location.protocol === 'file:';

if ('serviceWorker' in navigator) {
  if (isDevHost) {
    // Tear down any SW left behind by an earlier visit so dev edits land
    // immediately. Best-effort — failures are non-fatal.
    navigator.serviceWorker.getRegistrations()
      .then(regs => regs.forEach(r => r.unregister()))
      .catch(() => { /* ignore */ });
  } else {
    // Defer registration until after the load event so it doesn't compete
    // with the initial paint or app bootstrap.
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(err => {
        console.warn('SF Diagrams: Service worker registration failed', err);
      });
    });
  }
}

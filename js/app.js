// SF Diagrams — App bootstrap
// Initializes all modules in order. JointJS is a global (loaded via CDN script tag).

import * as theme       from './theme.js?v=1.15.3';
import * as icons       from './icons.js?v=1.15.3';
import { getAllStencilSvgs } from './components.js?v=1.15.3';
import * as shapes      from './shapes.js?v=1.15.3';
import * as canvas      from './canvas.js?v=1.15.3';
import * as stencil     from './stencil.js?v=1.15.3';
import * as selection   from './selection.js?v=1.15.3';
import * as history     from './history.js?v=1.15.3';
import * as clipboard   from './clipboard.js?v=1.15.3';
import * as templates    from './templates.js?v=1.15.3';
import * as keyboard    from './keyboard.js?v=1.15.3';
import * as toolbar     from './toolbar.js?v=1.15.3';
import * as properties  from './properties.js?v=1.15.3';
import * as persistence from './persistence.js?v=1.15.3';
import * as tabs        from './tabs.js?v=1.15.3';
import * as mermaidImport from './mermaid-import.js?v=1.15.3';
import * as tableView    from './table-view.js?v=1.15.3';
import * as walkthrough  from './walkthrough.js?v=1.15.3';
import * as a11y         from './a11y.js?v=1.15.3';

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

  // Custom templates library (capture from multi-select, drop from stencil).
  templates.init(graph, selection, history);

  // Data Mapping table view (read-only projection; toggled from the toolbar).
  tableView.init({ graph });

  const moduleRefs = {
    graph,
    paper,
    canvas,
    selection,
    history,
    clipboard,
    templates,
    persistence,
    toolbar,
    theme,
    stencil,
    tabs,
    mermaidImport,
    tableView,
    walkthrough,
  };

  keyboard.init(moduleRefs);
  toolbar.init(moduleRefs);

  // Contextual walkthrough — wires the Help toolbar button (Help is click-only; no
  // keyboard shortcut, so "?" stays free for text input). The active diagram type
  // (tabs.getActiveTabType) gates which step set runs at start().
  walkthrough.init(moduleRefs);

  // --- Phase 5: Properties panel ---
  properties.init(graph, paper, selection);

  // --- Phase 5b: Canvas accessibility — narrate selection to assistive tech ---
  a11y.init({ graph, selection });

  // --- Phase 6: Persistence (export/import only, no auto-load) ---
  persistence.init(graph, paper, canvas);

  // --- Phase 7: Tabs (restores session, manages auto-save) ---
  // Data Cloud mapping mode getters (v1.15.0) — set BEFORE tabs.init so the
  // DataObject view + property panel read the correct mode while the session
  // restore renders cells (mapping mode reveals every field's connectable ports).
  properties.setMappingModeGetter(() => tabs.getActiveMappingMode());
  shapes.setMappingModeGetter(() => tabs.getActiveMappingMode());
  canvas.setMappingModeGetter(() => tabs.getActiveMappingMode());

  tabs.init(graph, paper, canvas, selection, history, persistence, stencil);
  tabs.setupAutoSave();

  // Re-render the property panel whenever the tab or mapping mode changes.
  tabs.onChange(() => properties.refresh());

  // Tag captured templates with the active diagram type (metadata only — the
  // library is global, shown across every diagram type).
  templates.setDiagramTypeGetter(() => tabs.getActiveTabType());

  // Give persistence the templates API (read / export / merge-import) so the
  // Export Manager + backup-reminder overlay can include templates without a
  // circular import.
  persistence.setTemplatesBackupApi({
    getTemplates: templates.getTemplates,
    exportFn: templates.exportTemplatesJSON,
    importMerge: templates.importTemplatesArray,
  });

  // --- Phase 7b: Mermaid import (needs tabs + canvas + graph) ---
  mermaidImport.init(moduleRefs);

  // --- Phase 8: Mobile interactions ---
  canvas.initMobileDragHandles();

  // --- Phase 9: Check for shared diagram in URL hash ---
  persistence.loadFromURL();

  // --- Phase 9b: Periodic backup reminder ---
  // Deferred (setTimeout 0), mirroring the storage-pressure gauge, so it never
  // blocks first paint. Shows the "Backup your diagrams" overlay if it's been
  // ≥7 days since the last export (or since first content, if never exported).
  setTimeout(() => persistence.maybeShowBackupReminder(), 0);

  // First-visit walkthrough — runs only when `df_first_visit_help_shown` is absent. It waits
  // for a diagram canvas to exist (the first screen is usually the Create-New-Diagram overlay),
  // then starts the single guided tour. Defers its own paint and never touches the graph / history.
  walkthrough.maybeStartFirstRunTour();

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

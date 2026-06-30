// SF Diagrams — App bootstrap
// Initializes all modules in order. JointJS is a global (loaded via CDN script tag).

import * as theme       from './theme.js?v=1.19.1.1';
import * as icons       from './icons.js?v=1.19.1.1';
import { getAllStencilSvgs } from './components.js?v=1.19.1.1';
import * as shapes      from './shapes.js?v=1.19.1.1';
import * as canvas      from './canvas.js?v=1.19.1.1';
import * as stencil     from './stencil.js?v=1.19.1.1';
import * as selection   from './selection.js?v=1.19.1.1';
import * as history     from './history.js?v=1.19.1.1';
import * as clipboard   from './clipboard.js?v=1.19.1.1';
import * as templates    from './templates.js?v=1.19.1.1';
import * as keyboard    from './keyboard.js?v=1.19.1.1';
import * as toolbar     from './toolbar.js?v=1.19.1.1';
import * as properties  from './properties.js?v=1.19.1.1';
import * as persistence from './persistence.js?v=1.19.1.1';
import * as tabs        from './tabs.js?v=1.19.1.1';
import * as mermaidImport from './mermaid-import.js?v=1.19.1.1';
import * as tableView    from './table-view.js?v=1.19.1.1';
import * as walkthrough  from './walkthrough.js?v=1.19.1.1';
import * as whatsNew     from './whats-new.js?v=1.19.1.1';
import * as a11y         from './a11y.js?v=1.19.1.1';
import { seedDefaultPalette } from './brand-palette.js?v=1.19.1.1';

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
  // Set app version in About modal - and make it a button that re-opens "What's new" (keeps the release notes
  // reachable, and lets the author review them pre-release). Close the About modal first so they don't stack.
  const versionEl = document.getElementById('about-version');
  if (versionEl) {
    versionEl.textContent = `v${persistence.APP_VERSION}`;
    versionEl.setAttribute('role', 'button');
    versionEl.setAttribute('tabindex', '0');
    versionEl.title = "See what's new in this version";
    const openWhatsNew = () => {
      document.getElementById('btn-close-about')?.click();
      whatsNew.showWhatsNewNow();
    };
    versionEl.addEventListener('click', openWhatsNew);
    versionEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWhatsNew(); } });
  }

  // --- Phase 1: Foundation ---
  theme.init();

  // Pre-load the brand-colour swatches into every color picker's palette (once per browser).
  seedDefaultPalette();

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
  // While a diagram LOADS (graph.fromJSON + the post-load icon/link normalisations), history must NOT record:
  // those are not user edits. Wire the canvas loading flag so history skips them (else re-resolving a placeholder
  // icon href, or migrating a legacy connector, shows up as a phantom undoable change + marks the tab dirty).
  history.setLoadingGuard(canvas.isLoadingJSON);
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

  // Load localhost dev Google-Drive creds (gitignored dev/dev-config.json) BEFORE the toolbar gates the Drive UI on
  // isDriveConfigured() — so localhost shows Drive automatically, without committing creds. No-op on prod / no file.
  await persistence.ensureDriveConfig();

  keyboard.init(moduleRefs);
  toolbar.init(moduleRefs);

  // Contextual walkthrough — wires the Help toolbar button (Help is click-only; no
  // keyboard shortcut, so "?" stays free for text input). The active diagram type
  // (tabs.getActiveTabType) gates which step set runs at start().
  walkthrough.init(moduleRefs);

  // --- Phase 5: Properties panel ---
  properties.init(graph, paper, selection);
  // Canvas right-click "Auto size" reuses the properties-pane sizer (wired here to avoid a module cycle).
  selection.setAutoSizer(properties.autoSizeCell);
  // The canvas right-click menu mirrors the SAME bottom-of-properties actions per shape (#6) via this provider.
  selection.setActionProvider(properties.buildCellActions);
  // Connector right-click ER endpoint quick-set (→ / 1:1 / 1:M / M:1) → properties.setLinkEndpoints (item R1).
  selection.setEndpointSetter(properties.setLinkEndpoints);
  // Copy/Paste style clipboard for the MULTI-select right-click menu (single-element uses the action provider).
  selection.setStyleApi({ copy: properties.copyCellStyle, has: properties.hasStyleClip, paste: properties.pasteCellStyle });
  // Change Review "Apply as Highlight States" bakes the diff via the same Shape-state setter (wired to avoid a cycle).
  toolbar.setShapeStateApplier?.(properties.applyShapeState);
  // "Copy as PNG" right-click action — rasters the selection to the OS clipboard (paste into Slack/docs as an image).
  selection.setCopyAsPng(persistence.copyCellsAsPng);

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
  // DataObject collapse toggle → one undo entry (the `collapsed` prop + its follow-on resize).
  shapes.setDataObjectHistoryBatcher((fn) => { history.startBatch(); try { fn(); } finally { history.endBatch(); } });
  // Collapse/expand re-packs its lane (gap-close both ways) only when Auto-Fit Containers is on.
  shapes.setAutoFitGetter(() => canvas.isAutoSizingEnabled());
  canvas.setMappingModeGetter(() => tabs.getActiveMappingMode());

  tabs.init(graph, paper, canvas, selection, history, persistence, stencil);
  tabs.setupAutoSave();
  // Tab right-click "Compare" diffs the ACTIVE tab against the right-clicked one, in place (toolbar owns the
  // review overlay + banner; tabs just supplies which tab is the baseline).
  tabs.setCompareTabHandler?.(toolbar.compareActiveWithTab);

  // An open Data Mapping table edit session vetoes a tab switch until the user
  // resolves it (Save / Discard the unapplied field edits) — see table-view.guardLeave.
  tabs.setSwitchGuard((proceed) => tableView.guardLeave(proceed));
  // The diagram-edit guard's "Keep editing" returns to the Table view (clicking the toolbar toggle keeps
  // the session intact) after undoing the stray diagram change — see table-view.revertDiagramEdit (#5).
  tableView.setRequestTableView(() => document.getElementById('btn-view-table')?.click());

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
    syncWithDrive: templates.syncTemplatesWithDrive,   // item 17: remote-store calls this after a Drive connect
  });
  persistence.setThumbnailRenderer(templates.renderTemplateThumbnail);   // Phase C: the Review conflict modal's diff-highlighted preview cards

  // --- Phase 7b: Mermaid import (needs tabs + canvas + graph) ---
  mermaidImport.init(moduleRefs);

  // --- Phase 8: Mobile interactions ---
  canvas.initMobileDragHandles();

  // --- Phase 9: Check for shared diagram in URL hash ---
  persistence.loadFromURL();

  // --- Phase 9b: One-time "What's new" overlay on a new RELEASE (R23) ---
  // Replaces the per-load minor-version notice. Shows ONCE when a returning user
  // arrives on a newer major/minor build; a first-ever visitor is silently
  // recorded (the walkthrough owns their onboarding). Decision is synchronous so
  // we can skip the backup reminder this session and never stack two dialogs.
  whatsNew.init(persistence.APP_VERSION);
  // If the session was restored from an older release, hand What's-New the OLD session version as the baseline - a
  // user updating in from a pre-What's-New release has no seen-key yet, but they're returning, not brand-new (this is
  // why they used to get the old inline "Session Restored" notice instead of What's New). A MAJOR update already shows
  // the Compatibility Warning (a reset decision), so skip What's New there to avoid stacking two dialogs (it stays
  // reachable from the About modal's version chip).
  const sessionUpdate = tabs.getSessionUpdate ? tabs.getSessionUpdate() : null;
  const showedWhatsNew = sessionUpdate && sessionUpdate.diff === 'major'
    ? false
    : whatsNew.maybeShowWhatsNew(sessionUpdate ? sessionUpdate.fromVersion : null);

  // --- Phase 9c: Periodic backup reminder ---
  // Deferred (setTimeout 0), mirroring the storage-pressure gauge, so it never
  // blocks first paint. Shows the "Backup your diagrams" overlay if it's been
  // ≥7 days since the last export (or since first content, if never exported).
  // Skipped this session if the What's-New overlay is already taking the screen.
  setTimeout(() => { if (!showedWhatsNew) persistence.maybeShowBackupReminder(); }, 0);

  // Custom Templates Drive sync (item 17) — opportunistic boot pull+merge when a Drive token is already valid
  // this session (no sign-in popup). The connect-time sync (remote-store onDriveConnected) covers fresh logins.
  setTimeout(() => templates.syncTemplatesOnBoot(), 0);

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
    // When a NEW service worker (after a version bump) activates and claims this page, reload ONCE so
    // the fresh assets actually apply. Without this, the page keeps showing the old cached build until
    // a manual reload — the recurring "I bumped the version but see no change" trap, since the SW is
    // cache-first and the already-loaded page stays on the old assets. Skip the first-ever claim (no
    // prior controller → the page already loaded from the network, nothing stale to replace).
    const hadController = !!navigator.serviceWorker.controller;
    let swReloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (swReloading || !hadController) return;
      swReloading = true;
      window.location.reload();
    });
    // Defer registration until after the load event so it doesn't compete with the initial paint or
    // app bootstrap. `updateViaCache: 'none'` forces the browser to re-fetch sw.js fresh (not serve a
    // stale HTTP-cached copy), so a new version is detected promptly.
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(err => {
        console.warn('SF Diagrams: Service worker registration failed', err);
      });
    });
  }
}

// Toolbar — wires all button clicks to module actions
// Also keeps undo/redo button states in sync

import { diagramHasImage } from './image-component.js?v=1.19.5.8';
import { showToast, showError, confirmModal, trapFocus, buildModal } from './feedback.js?v=1.19.5.8';
import { resizeDataObjectToFit } from './components.js?v=1.19.5.8';
import { isAutoSizingEnabled, setAutoSizingEnabled, refitAllParents, isConnectorGroupingEnabled, setConnectorGroupingEnabled, rerouteAllLinks, isCrossingBumpsEnabled, setCrossingBumpsEnabled, isFocusDimmingEnabled, setFocusDimmingEnabled, isGridVisible } from './canvas.js?v=1.19.5.8';
import { escHtml, formatRelativeTime, countDiagramShapes, getDiagramTypeIcon, tabInGroup, formatBytes, gaugeLevel, isViewForkTab, diffGraphs } from './util.js?v=1.19.5.8';
import { storageRowHtml, groupSelectHtml, refreshSplitTableCounts, splitTableHeadHtml, bindSplitHeads, setTriStateCheckbox, SPLIT_CHEVRON_SVG, shareChipIconHtml, sharePillHtml, driveChipsHtml, tabRowChipsHtml } from './storage-ui.js?v=1.19.5.8';
import { dedupeSharedInWorkingCopies } from './persistence/drive-sync-logic.js?v=1.19.5.8';
import { exportObjectSchemaCsv } from './data-export.js?v=1.19.5.8';
import { renderTemplateThumbnail } from './templates.js?v=1.19.5.8';
import { showWhatsNewNow } from './whats-new.js?v=1.19.5.8';
import { kbd, SHORTCUT_GROUPS, MOUSE_TIPS, RIGHT_CLICK_TIPS } from './keyboard.js?v=1.19.5.8';
import { tctx, btn, setupDropdown, renderDriveSignIn } from './toolbar/context.js?v=1.19.5.8';
import { setupSyncControl } from './toolbar/sync-control.js?v=1.19.5.8';
import { showDriveHistoryModal } from './toolbar/drive-history.js?v=1.19.5.8';
import { showLoadManagerModal, hideLoadModal, showLoadModal, showDriveLibraryModal, showPasteImportModal } from './toolbar/load-manager.js?v=1.19.5.8';
import { showSaveModal, showSaveManagerModal } from './toolbar/save-manager.js?v=1.19.5.8';
import { setShapeStateApplier, compareActiveWithTab, openReviewPicker, reviewAgainstRevision } from './toolbar/review.js?v=1.19.5.8';
// Re-export for app.js: setShapeStateApplier (app.js:144) + compareActiveWithTab (app.js:170, optional-chained - a missing re-export silently kills tab right-click Compare).
export { setShapeStateApplier, compareActiveWithTab } from './toolbar/review.js?v=1.19.5.8';
import { setViewMode, updateDisplayMenuVisibility, updateDisplayToggleLabels, updateGanttToggleLabels, updateSequenceToggleLabels, refreshDisplayDotIndicator, isDisplayFlagOn, applyDisplayFlagToAll, dataObjectsAllCollapsed, getGanttTimelineSetting, applyToAllGanttTimelines } from './toolbar/display-options.js?v=1.19.5.8';
import { startFlowAnimation, stopFlowAnimation } from './toolbar/flow-animation.js?v=1.19.5.8';

let modules = {};
export function init(_modules) {
  modules = _modules;
  tctx.modules = _modules;

  // Collapsible storage rows on mobile: tapping a row's disclosure caret toggles its detail line
  // (storage chips / edited date) + the trailing action. Delegated once on the document so it works
  // inside ANY manager modal (Save / Load / Close-Tabs) regardless of when its DOM is built. The caret
  // is CSS-hidden on desktop, so this is effectively mobile-only. stopPropagation keeps the tap from
  // also toggling a row-level checkbox/label.
  document.addEventListener('click', (evt) => {
    const caret = evt.target.closest?.('.df-srow__disclosure');
    if (!caret) return;
    evt.preventDefault();
    evt.stopPropagation();
    const row = caret.closest('.df-srow');
    if (!row) return;
    const open = row.classList.toggle('df-srow--open');
    caret.setAttribute('aria-expanded', open ? 'true' : 'false');
    caret.setAttribute('aria-label', open ? 'Hide details' : 'Show details');
  });

  // Dropdown-style toggle: if THIS button's anchored manager is already the open one, a second click closes it
  // (like the Display menu); otherwise open it. buildModal stashes the trigger on `overlay.__dfAnchor`, so we can
  // tell which button owns the open panel. Opening another manager still swaps in one click (buildModal's
  // close-others), and the navbar stays clickable while a manager is open (.df-modal--anchored pointer-events).
  const toggleAnchored = (btnEl, open) => {
    const openM = document.querySelector('.df-modal--anchored');
    if (openM && openM.__dfAnchor === btnEl && typeof openM.__dfClose === 'function') { openM.__dfClose(); return; }
    // Single top-bar panel: close any open toolbar dropdown (Display / Drive) before opening a manager.
    document.querySelectorAll('.df-toolbar__dropdown--open').forEach(dd => dd.classList.remove('df-toolbar__dropdown--open'));
    open();
  };

  // Save → the Save Manager overlay directly (v1.17.0; the old dropdown's Export-JSON/CSV/Image items are now
  // per-row Export + the footer's "Export Selected" / "templates & backups" inside the manager).
  btn('btn-save').addEventListener('click', (e) => toggleAnchored(e.currentTarget, () => showSaveManagerModal()));

  // Share → the Share Manager overlay directly (v1.17.0; the old dropdown is gone). Right-click = the quick
  // "Copy Diagramforce Link" shortcut. Drive sharing lives inside the Share Manager.
  btn('btn-share-url').addEventListener('click', (e) => toggleAnchored(e.currentTarget, () => modules.persistence.shareAsURL()));
  document.getElementById('btn-share-url').addEventListener('contextmenu', (e) => { e.preventDefault(); modules.persistence.copyShareURL(); });
  // (Templates are now exported/imported through the general Export/Import-to-JSON
  // manager — no dedicated menu items.)

  // Share-as-URL is unavailable while the diagram contains image cells —
  // embedded image bytes blow past every messaging/chat URL-length limit.
  // We mirror the state on the dropdown menu item (with explanatory tooltip)
  // and also gate inside `persistence.shareAsURL` for the keyboard shortcut /
  // hamburger entry.
  const SHARE_DISABLED_MSG = 'URL sharing is unavailable while this diagram contains images. Use Save → Export to JSON to share, or remove every image to re-enable URL sharing.';
  // Not-connected + images: same as above, but also point at Google Drive (which stores images). Signing in is
  // what unlocks Share here (it flips `connected` → the image-mode Share Manager offers the Drive link), so the
  // copy says "Sign in", not "Save" - the disabled Share button can't itself start a save.
  const SHARE_DISABLED_MSG_DRIVE = 'URL sharing is unavailable while this diagram contains images. Sign in to Google Drive to share it (images and all), or use Save → Export to JSON - or remove every image to re-enable URL sharing.';
  // Connected + images: Share stays enabled — the Share Manager locks the link section and offers Drive sharing.
  const SHARE_IMAGE_DRIVE_MSG = 'Share via Google Drive (URL link sharing is unavailable while this diagram contains images)';
  const EMPTY_DIAGRAM_MSG = 'Add a shape to enable export.';
  const GIF_ENCODING_MSG = 'Wait until the current GIF export finishes.';
  const refreshShareAvailability = () => {
    const isEmpty = !modules.graph || modules.graph.getCells().length === 0;
    // GIF encoding lock — set by persistence.js while gifenc is busy; ALL
    // export items disable so the user can't queue a second slow encode.
    const gifBusy = modules.persistence.isGifEncodingInProgress?.() ?? false;
    // Share button (now the top-level navbar "Share") — disabled if the diagram has images OR is empty OR
    // GIF is encoding; otherwise its title carries the right-click-to-copy hint.
    const shareBtn = btn('btn-share-url');
    if (shareBtn) {
      const hasImg = diagramHasImage(modules.graph);
      const connected = !!modules.persistence.isDriveConnected?.();
      const driveOn = !!modules.persistence.isDriveConfigured?.();
      // Images block the URL link. A CONNECTED user can still share via Google Drive, so keep Share ENABLED —
      // the Share Manager (showShareModal image mode) locks the link section + offers the Drive link. Only a
      // NOT-connected user (URL is the only path) gets the disabled state.
      shareBtn.disabled = (hasImg && !connected) || isEmpty || gifBusy;
      shareBtn.title = isEmpty ? EMPTY_DIAGRAM_MSG
        : gifBusy ? GIF_ENCODING_MSG
        : hasImg ? (connected ? SHARE_IMAGE_DRIVE_MSG : (driveOn ? SHARE_DISABLED_MSG_DRIVE : SHARE_DISABLED_MSG))
        : 'Share - right-click to copy the link';
    }
    // Save button (top-level navbar "Save") — locked when the active diagram is empty (nothing to save) or GIF
    // is encoding, mirroring the Share lock so an empty canvas can't open a Save/Export that would no-op.
    const saveBtn = btn('btn-save');
    if (saveBtn) {
      saveBtn.disabled = isEmpty || gifBusy;
      saveBtn.title = gifBusy ? GIF_ENCODING_MSG : (isEmpty ? EMPTY_DIAGRAM_MSG : 'Save (Ctrl+S)');
    }
    // (Export/CSV gating moved into the Save Manager itself — per-row Export is enabled per diagram, and the
    // canvas-only image/CSV exports gate inside their own modals.)
  };
  if (modules.graph) {
    modules.graph.on('add', refreshShareAvailability);
    modules.graph.on('remove', refreshShareAvailability);
    // `graph.fromJSON()` (tab load, import, restore, share-load) fires a single
    // 'reset' — NOT per-cell 'add'/'remove' — so without this the export/share
    // items stayed stale-disabled after an import until the next tab switch.
    modules.graph.on('reset', refreshShareAvailability);
  }
  if (modules.tabs) modules.tabs.onChange(refreshShareAvailability);
  // Listen for GIF encoding state flips so the disable refreshes when
  // encoding starts/finishes.
  modules.persistence.setGifEncodingListener?.(refreshShareAvailability);
  refreshShareAvailability();

  // Wire save modal callback so persistence.namedSave() can also open it
  modules.persistence.setShowSaveModal(() => showSaveModal());
  // Wire Load-from-Browser modal so a bundle import can reveal the restored
  // diagrams (persistence opens it after saving them to localStorage).
  modules.persistence.setShowLoadModal?.((importStats) => showLoadModal(importStats));
  // Wire the "Your Drive diagrams" library so tabs.js's New-Diagram modal can offer cross-device restore.
  modules.persistence.setShowDriveLibrary?.(() => showDriveLibraryModal());
  // Wire the unified Load-from-Paste modal so the New-Diagram modal's "Open" tab can offer it.
  modules.persistence.setShowPasteImport?.(() => showPasteImportModal());

  // Load → the tabbed Load Manager overlay (Browser / Google Drive / File / Paste), opened directly. The old
  // per-source dropdown items are now its tabs.
  btn('btn-load').addEventListener('click', (e) => toggleAnchored(e.currentTarget, () => showLoadManagerModal()));

  // Consolidated cloud-sync control (Google Drive) — icon + menu left of Share Link.
  setupSyncControl();

  // Display dropdown (hidden for Gantt, some options data-model only)
  setupDropdown('btn-display');
  // Re-read the toggle checkmarks each time the Display button is clicked (menu open) - Collapse Objects can be
  // changed by the per-object chevron OUTSIDE this menu, so its checked state must reflect the live graph on open.
  btn('btn-display').addEventListener('click', () => updateDisplayToggleLabels());

  // Gap 14 (v1.12.0) — see `refreshDisplayDotIndicator()` at module scope.
  // Convenience alias inside init() so the local toggle handlers can call
  // it without prefixing.
  const _refreshDisplayDot = refreshDisplayDotIndicator;
  const btnApi = document.getElementById('btn-display-api');
  const btnLen = document.getElementById('btn-display-lengths');
  const btnKeysOnly = document.getElementById('btn-display-keys-only');
  btnApi.addEventListener('click', () => {
    const current = isDisplayFlagOn('showLabels');
    applyDisplayFlagToAll('showLabels', !current);
    updateDisplayToggleLabels();
  });
  btnLen.addEventListener('click', () => {
    const current = isDisplayFlagOn('showFieldLengths');
    applyDisplayFlagToAll('showFieldLengths', !current);
    updateDisplayToggleLabels();
  });
  // Object Relationships (Data Mapping) — view-only filter that hides/shows the
  // header-level ER relationship links so field-level mapping curves can be audited
  // in isolation. Drives canvas.setObjectRelationshipsVisible (no model mutation).
  const btnObjectRels = document.getElementById('btn-display-object-rels');
  btnObjectRels?.addEventListener('click', () => {
    const next = !modules.canvas.isObjectRelationshipsVisible();
    modules.canvas.setObjectRelationshipsVisible(next);
    btnObjectRels.classList.toggle('is-checked', next);
  });
  // Collapse Objects (Data Model / Data Mapping) — collapse EVERY DataObject to its header, or expand them all.
  // Checked only when ALL objects are collapsed (some-collapsed reads unchecked), so one click from a mixed state
  // collapses the rest. Reuses applyDisplayFlagToAll('collapsed', …) (one history batch) + the per-object resize.
  const btnCollapse = document.getElementById('btn-display-collapse');
  btnCollapse?.addEventListener('click', () => {
    const allCollapsed = dataObjectsAllCollapsed();
    applyDisplayFlagToAll('collapsed', !allCollapsed);   // not-all → collapse all (true); all → expand all (false)
    const graph = modules.graph;
    if (graph) graph.getElements().forEach(el => { if (el.get('type') === 'sf.DataObject') resizeDataObjectToFit(el); });
    updateDisplayToggleLabels();
  });
  // (Data Cloud mapping is now its own diagram TYPE — "Data Mapping" — so the old
  // per-diagram mapping-mode toggle was removed from the Display menu.)
  // Auto Sizing toggle (v1.11.6) — applies to all diagram types that support
  // embedding. Flipping the flag immediately re-fits every parent against its
  // current children (so re-enabling tightens everything that drifted while
  // disabled), or no-ops if the user just disabled it.
  const btnAutoSize = document.getElementById('btn-display-auto-size');
  const refreshAutoSizeLabel = () => {
    btnAutoSize?.classList.toggle('is-checked', isAutoSizingEnabled());
    _refreshDisplayDot();
  };
  refreshAutoSizeLabel();
  btnAutoSize?.addEventListener('click', () => {
    const next = !isAutoSizingEnabled();
    setAutoSizingEnabled(next);
    refreshAutoSizeLabel();
    // On re-enable, refit every embedding parent against its current children
    // so anything that drifted while auto-sizing was off snaps back.
    if (next) refitAllParents();
  });

  // Connector Grouping toggle (v1.11.10 — CR-5.1) — bundles links crowding the
  // same physical port into shared trunks by visual semantics. Default OFF.
  // Flipping it re-routes every link on the active graph so the change is
  // instant. Presentation-only — the graph data model is untouched.
  const btnGrouping = document.getElementById('btn-display-connector-grouping');
  const refreshGroupingLabel = () => {
    // Label is fixed ("Spread Overlapping Connectors"); state shown by the
    // checkbox icon. Checked (default) = spreading is on; unchecked = all
    // connectors converge at the port centre.
    btnGrouping?.classList.toggle('is-checked', isConnectorGroupingEnabled());
    _refreshDisplayDot();
  };
  refreshGroupingLabel();
  btnGrouping?.addEventListener('click', () => {
    setConnectorGroupingEnabled(!isConnectorGroupingEnabled());
    refreshGroupingLabel();
    rerouteAllLinks();
  });

  // Crossing Bumps toggle (CR-5.2 PoC) — EDA-style "jump over" arcs at
  // points where two connectors cross without being connected.  Pure
  // overlay rendering (no router or path mutation), so toggling just
  // pokes the overlay layer to clear / re-paint.  Default ON.
  const btnBumps = document.getElementById('btn-display-crossing-bumps');
  const refreshBumpsLabel = () => {
    btnBumps?.classList.toggle('is-checked', isCrossingBumpsEnabled());
    _refreshDisplayDot();
  };
  refreshBumpsLabel();
  btnBumps?.addEventListener('click', () => {
    setCrossingBumpsEnabled(!isCrossingBumpsEnabled());
    refreshBumpsLabel();
  });

  // Focus Dimming toggle (v1.12.4) — when off, selecting an element no
  // longer dims unrelated components/connectors. selection.js consults
  // isFocusDimmingEnabled() inside updateLinkDimming and short-circuits
  // when disabled; we call refreshDimming() here so flipping the toggle
  // re-applies (or clears) the overlay against the current selection
  // without needing the user to reselect. Default ON.
  const btnFocusDim = document.getElementById('btn-display-focus-dimming');
  const refreshFocusDimLabel = () => {
    btnFocusDim?.classList.toggle('is-checked', isFocusDimmingEnabled());
    _refreshDisplayDot();
  };
  refreshFocusDimLabel();
  btnFocusDim?.addEventListener('click', () => {
    setFocusDimmingEnabled(!isFocusDimmingEnabled());
    refreshFocusDimLabel();
    modules.selection?.refreshDimming?.();
  });

  // "Show Tab Group Labels" (default ON) — off hides the group-pill name (icon + count only) via a body
  // class. Pure presentation; persisted in localStorage. Applied on init so it survives reloads.
  const btnGroupLabels = document.getElementById('btn-display-group-labels');
  const showGroupLabels = () => localStorage.getItem('df.showGroupLabels') !== '0';
  const applyGroupLabels = () => {
    document.body.classList.toggle('df-hide-group-labels', !showGroupLabels());
    btnGroupLabels?.classList.toggle('is-checked', showGroupLabels());
  };
  applyGroupLabels();
  btnGroupLabels?.addEventListener('click', () => {
    localStorage.setItem('df.showGroupLabels', showGroupLabels() ? '0' : '1');
    applyGroupLabels();
  });

  btnKeysOnly.addEventListener('click', () => {
    const current = isDisplayFlagOn('keyFieldsOnly');
    applyDisplayFlagToAll('keyFieldsOnly', !current);
    // Toggling keyFieldsOnly changes how many field rows render → height needs
    // to follow, and any DataObject embedded in a Container/Zone may now
    // overflow / underflow its parent. resizeDataObjectToFit runs the same
    // height calc as a field add/remove and triggers the v1.11.0 downward
    // parent-grow when applicable.
    const graph = modules.graph;
    if (graph) {
      graph.getElements().forEach(el => {
        if (el.get('type') === 'sf.DataObject') resizeDataObjectToFit(el);
      });
    }
    updateDisplayToggleLabels();
  });

  // Gantt display toggles
  btn('btn-gantt-assignee').addEventListener('click', () => {
    const current = isDisplayFlagOn('showAssignee');
    applyDisplayFlagToAll('showAssignee', !current);
    updateGanttToggleLabels();
  });
  btn('btn-gantt-progress').addEventListener('click', () => {
    const current = isDisplayFlagOn('showProgress');
    applyDisplayFlagToAll('showProgress', !current);
    updateGanttToggleLabels();
  });

  // Gantt timeline week controls — apply to every GanttTimeline on the tab. First-day-of-week cycles Sun→Sat.
  btn('btn-gantt-week-start').addEventListener('click', () => {
    const opts = [1, 0, 6]; // Monday (ISO 8601) → Sunday (Americas) → Saturday (MENA)
    const cur = ((Number(getGanttTimelineSetting('weekStartDay', 1)) % 7) + 7) % 7;
    applyToAllGanttTimelines('weekStartDay', opts[(opts.indexOf(cur) + 1) % opts.length]);
    updateGanttToggleLabels();
  });
  btn('btn-gantt-weekend-start').addEventListener('click', () => {
    const opts = [6, 5]; // Saturday (Sat–Sun weekend) → Friday (Fri–Sat weekend)
    const cur = ((Number(getGanttTimelineSetting('weekendStartDay', 6)) % 7) + 7) % 7;
    applyToAllGanttTimelines('weekendStartDay', opts[(opts.indexOf(cur) + 1) % opts.length]);
    updateGanttToggleLabels();
  });
  // Project Summary Row — a read-only overview lane at the top of every timeline.
  btn('btn-gantt-project-summary').addEventListener('click', () => {
    const cur = getGanttTimelineSetting('showProjectSummary', false) === true;
    applyToAllGanttTimelines('showProjectSummary', !cur);
    updateGanttToggleLabels();
  });

  // Sequence display toggles — diagram-wide (applies to every Participant)
  btn('btn-sequence-bottom-labels').addEventListener('click', () => {
    const current = isDisplayFlagOn('showBottomLabel');
    applyDisplayFlagToAll('showBottomLabel', !current);
    updateSequenceToggleLabels();
  });

  // Sequence Auto Layout — unify port count + align lanes so same-index ports
  // share the same canvas Y, making connectors parallel.
  btn('btn-sequence-auto-layout').addEventListener('click', () => {
    document.getElementById('display-dropdown')?.classList.remove('df-toolbar__dropdown--open');
    const plan = modules.canvas.analyzeSequenceLayout();
    if (plan.status === 'empty') {
      showToast('Add at least two actors or participants with lifelines to use Auto Layout.', 'warning', { duration: 3500 });
      return;
    }
    const run = () => {
      modules.history.startBatch();
      try { modules.canvas.applySequenceAutoLayout(plan); }
      finally { modules.history.endBatch(); }
    };
    if (plan.status === 'ok') { run(); return; }
    showSequenceAutoLayoutConfirm(plan, run);
  });

  // Auto Layout — Process diagrams use the Mermaid-style hierarchical layout
  // (DFS back-edge detection + longest-path layering + barycentric ordering),
  // which handles cycles and branching far more cleanly than the generic
  // force-directed layout. All other diagram types keep the original layout.
  //
  // v1.12.1 — switched from startBatch/endBatch wrapping to the explicit
  // `recordPositionsBatch()` helper. The old approach relied on the
  // change:position debounced merge committing before endBatch closed,
  // which was unreliable under fast consecutive auto-layouts (e.g.
  // horizontal then vertical) — pending entries could leak across
  // batches and produce a single undo collapsing both layouts. The new
  // helper snapshots positions before and after, builds one explicit
  // composite, and bypasses the merge entirely.
  const runAutoLayout = (direction, opts) => {
    const type = modules.tabs.getActiveTabType?.();
    modules.history.recordPositionsBatch(() => {
      if (type === 'datamapping') {
        // Dedicated lane layout: top-aligned lanes + 36px-spaced objects inside Layer
        // zones. Mapping links are field-port anchored, so DON'T snap them to side ports.
        modules.canvas.applyDataMappingLayout();
      } else if (type === 'process') {
        // Process uses the barycentre layered layout (now WITH full-spine straightening, auto-layout.js), in
        // the chosen direction. Full-spine keeps a flow's SPINE straight - including the branch that CONTINUES
        // after a split (Start->Process->Decision->...->Terminator reads as a line) - which is what Mermaid's
        // hierarchical layout (the previous flat-flow path) could NOT do at single-child continuations.
        // autoLayout also treats BPMN pools / subprocesses / loops as rigid container units (children translate
        // along, staying inside) AND it's the undo-tested path, so it handles flat + contained flows alike.
        modules.canvas.autoLayout(direction, { align: 'barycenter' });
        try { modules.mermaidImport.snapLinksToPorts(modules.graph, direction); } catch {}
      } else {
        modules.canvas.autoLayout(direction, opts);
        try { modules.mermaidImport.snapLinksToPorts(modules.graph, direction); } catch {}
      }
    }, () => { try { modules.canvas.fitContent(); } catch {} });   // re-fit on undo/redo so the camera follows the layout
    document.getElementById('display-dropdown')?.classList.remove('df-toolbar__dropdown--open');
  };
  btn('btn-auto-layout-h').addEventListener('click', () => runAutoLayout('horizontal'));
  btn('btn-auto-layout-v').addEventListener('click', () => runAutoLayout('vertical'));
  // The promoted single "Auto Layout" (Data Model / Architecture / Org): Layered = barycentre
  // cross-alignment (children under parents). detectAxis reads the flow axis from the diagram's own
  // geometry (Stage C M2) instead of forcing vertical, so a left→right lane design isn't rotated into
  // a column; 'vertical' stays the fallback when the axis can't be read.
  btn('btn-auto-layout-layered')?.addEventListener('click', () => runAutoLayout('vertical', { align: 'barycenter', detectAxis: true }));

  // Re-face Connectors — a standalone tidy that re-attaches every link to the side port facing its other
  // end (the mermaid-import port heuristic, reused). Node positions are untouched; hand-routed links (manual
  // vertices) are skipped. recordPositionsBatch snapshots + diffs the source/target endpoints so the whole
  // re-port is ONE undo step (same path snapLinksToPorts rides after auto-layout); change:source/target then
  // reroutes each link. rerouteAllLinks() forces the redraw immediately rather than waiting on the rAF cascade.
  btn('btn-reface-connectors')?.addEventListener('click', () => {
    let changed = 0;
    modules.history.recordPositionsBatch(() => {
      try { changed = modules.mermaidImport.refaceConnectors(modules.graph); } catch {}
    });
    rerouteAllLinks();
    showToast(
      changed > 0
        ? `Re-faced ${changed} connector${changed === 1 ? '' : 's'} to face their targets ✓`
        : 'Connectors already face their targets - nothing to re-face.',
      changed > 0 ? 'success' : 'info',
    );
    document.getElementById('display-dropdown')?.classList.remove('df-toolbar__dropdown--open');
  });

  // Help menu — consolidates the old standalone ? (guided tour) + i (about) icons + What's new into ONE
  // dropdown. btn-help-tour is wired in walkthrough.js (start); the other two here.
  setupDropdown('btn-help');
  btn('btn-help-whatsnew')?.addEventListener('click', () => showWhatsNewNow());
  btn('btn-help-shortcuts')?.addEventListener('click', () => openShortcutsModal());
  btn('btn-help-about')?.addEventListener('click', () => showAboutModal());

  // Change Review — close the Display menu, then open the baseline picker.
  btn('btn-review-changes').addEventListener('click', () => {
    document.getElementById('display-dropdown')?.classList.remove('df-toolbar__dropdown--open');
    openReviewPicker();
  });

  // Diagram | Table view switch (Data Mapping)
  btn('btn-view-diagram').addEventListener('click', () => setViewMode('diagram'));
  btn('btn-view-table').addEventListener('click', () => setViewMode('table'));

  // Map bridge (Data Model only) — clone this model into a new Data Mapping diagram,
  // wrapping every object in a default "Source" layer. tabs.cloneToMappingTab() owns
  // the deep-clone + atomic load; here we just trigger it and confirm via a toast.
  document.getElementById('btn-map-bridge')?.addEventListener('click', () => {
    const newId = modules.tabs?.cloneToMappingTab?.();
    if (newId) showToast('Mapped - objects cloned into a new Data Mapping diagram.', 'success');
    else showToast('Nothing to map - add at least one object first.', 'info');
  });

  // Animate Connectors toggle — a standard Display checkbox (default OFF). While on, the "Export as Image"
  // overlay swaps PNG→GIF and hides static WEBP (it reads `.df-animate-flow` when it opens).
  btn('btn-animate-flow').addEventListener('click', () => {
    const paperEl = document.getElementById('paper');
    const isOn = paperEl.classList.toggle('df-animate-flow');
    document.getElementById('btn-animate-flow')?.classList.toggle('is-checked', isOn);
    if (isOn) startFlowAnimation(); else stopFlowAnimation();
  });

  // Update Display menu when tab changes
  if (modules.tabs) {
    modules.tabs.onChange(() => { updateDisplayMenuVisibility(); refreshDisplayDotIndicator(); });
    updateDisplayMenuVisibility();
  }

  // Undo / Redo
  btn('btn-undo').addEventListener('click', () => modules.history.undo());
  btn('btn-redo').addEventListener('click', () => modules.history.redo());

  modules.history.onChange(() => {
    const canUndo = modules.history.canUndo();
    const canRedo = modules.history.canRedo();
    btn('btn-undo').disabled = !canUndo;
    btn('btn-redo').disabled = !canRedo;
    // Sync mobile undo button
    const undoM = document.getElementById('btn-undo-mobile');
    if (undoM) undoM.disabled = !canUndo;
    // Sync hamburger menu undo/redo items
    const hMenu = document.getElementById('hamburger-menu');
    if (hMenu) {
      const hUndo = hMenu.querySelector('[data-action="undo"]');
      const hRedo = hMenu.querySelector('[data-action="redo"]');
      if (hUndo) hUndo.disabled = !canUndo;
      if (hRedo) hRedo.disabled = !canRedo;
    }
  });

  // Zoom
  btn('btn-zoom-in').addEventListener('click', () => modules.canvas.zoomIn());
  btn('btn-zoom-out').addEventListener('click', () => modules.canvas.zoomOut());
  btn('btn-zoom-fit').addEventListener('click', () => modules.canvas.fitContent());
  document.getElementById('zoom-level')?.addEventListener('click', () => modules.canvas.resetZoom?.());

  // Grid toggle
  // Snap to Grid — moved out of the center toolbar into the Display menu (v1.19.0).
  // Toggles the dot grid AND the drag-snap (paper gridSize 4 vs 1). Default ON.
  const btnSnapGrid = document.getElementById('btn-display-snap-grid');
  const refreshSnapGridLabel = () => {
    btnSnapGrid?.classList.toggle('is-checked', isGridVisible());
    _refreshDisplayDot();
  };
  refreshSnapGridLabel();
  btnSnapGrid?.addEventListener('click', () => {
    modules.canvas.toggleGrid();
    refreshSnapGridLabel();
  });

  // Theme toggle
  btn('btn-theme').addEventListener('click', () => {
    modules.theme.toggle();
    // Update grid color after theme change
    if (modules.canvas.refreshGrid) modules.canvas.refreshGrid();
    // Update icons on elements that use default (non-custom) label color
    if (modules.canvas.refreshIcons) modules.canvas.refreshIcons();
  });

  // Stencil toggle (class state managed by stencil module)
  btn('btn-toggle-stencil').addEventListener('click', () => {
    modules.stencil.toggle();
  });

  // (The Load overlay is a buildModal instance now — it wires its own close/escape; no static-modal close here.)

  // About modal (opened from the Help menu's "About" item, wired above; this is the modal's own close button)
  btn('btn-close-about').addEventListener('click', hideAboutModal);
  btn('about-modal-overlay').addEventListener('click', hideAboutModal);

  // Mobile fit-to-content button (duplicate of btn-zoom-fit)
  const fitMobile = document.getElementById('btn-zoom-fit-mobile');
  if (fitMobile) {
    fitMobile.addEventListener('click', () => modules.canvas.fitContent());
  }

  // Mobile undo button
  const undoMobile = document.getElementById('btn-undo-mobile');
  if (undoMobile) {
    undoMobile.addEventListener('click', () => modules.history.undo());
  }

  // Hamburger menu
  setupHamburgerMenu();

  // Close dropdowns on outside click
  document.addEventListener('click', (evt) => {
    document.querySelectorAll('.df-toolbar__dropdown--open').forEach(dd => {
      if (!dd.contains(evt.target)) dd.classList.remove('df-toolbar__dropdown--open');
    });
    // Also close hamburger menu
    const hWrap = document.querySelector('.df-toolbar__hamburger-wrap');
    if (hWrap && !hWrap.contains(evt.target)) {
      hWrap.classList.remove('df-toolbar__hamburger-wrap--open');
      const hBtn = document.getElementById('btn-hamburger');
      if (hBtn) hBtn.setAttribute('aria-expanded', 'false');
    }
  });

  // Adaptive zoom centering — switch to compact mode if overlap detected
  setupToolbarCentering();
}

// --- Dropdown helpers ---

// --- Load Modal ---

/**
 * Build the inline import-summary copy shown at the top of the Load modal right
 * after a bundle import. Leads with diagrams (this modal lists diagrams); a
 * trailing clause covers templates, which land in the stencil, not this list.
 */
// Shared "Drive sign-in needed" affordance for PASSIVE Drive surfaces (Load → Drive tab, Version history). ONE
// consistent look: an orange, centred "Sign in to Google Drive" button on its own line. Surfaces gate on
// `isSignedIn()` (a pure token check — NO getToken, so it can't pop OR briefly flash Google's account picker;
// see GOTCHAS 2.7c) and render this when there's no live token. The button is the ONLY place auth fires, and
// only on the user's click; `onSignedIn` re-renders the surface once a token lands.
// --- Load Manager (tabbed overlay: Browser / Google Drive / File / Paste) ---
// One overlay replaces the old Load dropdown + its three separate modals. Each tab renders into a shared pane
// and installs its own footer. The legacy entry names (showLoadModal / showDriveLibraryModal /
// showPasteImportModal) survive as thin redirects so the persistence callbacks + the New-Diagram modal keep
// working unchanged. `importStats` (optional) is passed by persistence right after a bundle import to render a
// transient success summary on the Browser tab.
/**
 * Build a unique save name: "Name YYYYMMDD", or "Name 2 YYYYMMDD" etc.
 * If the base name already ends with the date suffix, don't double it —
 * instead insert an autonumber before the date: "Name 2 YYYYMMDD".
 */
// --- Save Modal ---

// --- Sequence Auto Layout Confirmation Modal ---
// Shown when the current port counts differ across lanes (or any lane has
// custom port ratios) AND there are connectors that might shift. Lists each
// lane whose port layout will be regenerated so the user can see the impact
// before committing.
function showSequenceAutoLayoutConfirm(plan, onConfirm) {
  document.querySelector('.df-seq-autolayout-modal')?.remove();

  const rows = plan.mismatches.map(m => {
    const reason = m.hasCustomRatios
      ? `${m.count} ports, custom spacing`
      : `${m.count} port${m.count === 1 ? '' : 's'}`;
    return `
      <div class="df-modal__row">
        <span class="df-modal__row-name" style="flex:1">${escHtml(m.label)}</span>
        <span style="color:var(--text-secondary);font-size:12px">${escHtml(reason)} → ${plan.targetCount} evenly-spaced</span>
      </div>`;
  }).join('');

  const { footer, close } = buildModal({
    title: 'Auto Layout may shift connectors',
    className: 'df-save-modal df-seq-autolayout-modal',
    dialogClass: 'df-save-modal__dialog', // 520px
    bodyHtml: `
      <p style="margin:0 0 12px 0;color:var(--text-secondary);font-size:13px;line-height:1.5">
        Every lane will be set to <strong>${plan.targetCount} evenly-spaced ports</strong> so connectors between same-index ports become parallel. The lanes below will have their port layout regenerated - existing connectors on those lanes may move vertically.
      </p>
      <div class="df-modal__row-list">${rows}</div>`,
    footerHtml: '<button class="df-modal__btn df-modal__btn--primary df-seq-autolayout-apply" style="margin-left:auto">Apply Auto Layout</button>',
  });
  footer.querySelector('.df-seq-autolayout-apply').addEventListener('click', () => {
    close();
    onConfirm();
  });
}

// --- Load from Paste (unified) Modal ---
// One box that auto-detects Diagramforce JSON (single diagram / export bundle / templates) vs Mermaid code and
// loads either. Live feedback names the recognised format + target; unrecognised input is reported inline.
// Replaced the separate "Paste JSON" + "Paste Mermaid" modals (item 11). Mermaid → Diagramforce mappings:
/** Multi-select Save / Share to Google Drive — pick which OPEN diagrams to push to the user's
 *  own Drive, and optionally create "anyone with the link" share links. Reuses the Export
 *  Manager's row + select-all pattern. The active diagram is pre-selected, so "save this one"
 *  stays one click. Signs in once for the whole batch (handled in remoteStore.saveTabsToDrive). */
// SAVE MANAGER — the per-open-diagram "where is this saved, and save it" surface (the template for the future
// Share / Load managers). Lists every NON-EMPTY open diagram with a shape count and a chip per storage backend
// — Browser · My Drive · Shared Drive — and saves the checked rows to any available destination. The three
// chips map 1:1 to the three save actions. Drive controls appear only when Drive is configured; a Browser-only
// user sees just the Browser chip + a "Save to Browser" button. Sharing is intentionally NOT here — it lives in
// the Share Manager (Share as URL / the Drive share dialog), per the Save / Share / Load split.
// "Your Drive diagrams" — the personal library of the user's own masters in their My-Drive Diagramforce
// folder. List → Open / Delete (trash). Async (network + auth), so it owns its loading/empty/error states.

// ── Change Review (NBA-1, v1.19.0) — NON-DESTRUCTIVE diff visualisation ──────────────────────
// Pick a baseline (a Drive revision of THIS diagram, or another open tab), diff it against the live
// canvas, and tint Added / Changed / Removed via the transient review overlay (review-overlay.js).
// No model mutation, no dirty flag, no history. One review at a time; Escape or the bar exits.

// ── Keyboard shortcuts reference (Help → Keyboard shortcuts) ─────────────────
// Renders SHORTCUT_GROUPS / MOUSE_TIPS / RIGHT_CLICK_TIPS (single source of truth in keyboard.js) as a modal.
// Combos run through kbd() so macOS shows ⌘-glyphs and other platforms show Ctrl/Alt words.
function openShortcutsModal() {
  // kbd('+') would split to nothing (it splits on '+'); the +/- zoom keys are platform-neutral single keys.
  const keyBadges = (combo) => {
    if (combo === '+' || combo === '-') return `<kbd class="df-kbd">${escHtml(combo)}</kbd>`;
    return kbd(combo).split('+').map((k) => `<kbd class="df-kbd">${escHtml(k)}</kbd>`).join('<span class="df-kbd-sep">+</span>');
  };
  const row = (combo, desc) => `<div class="df-shortcuts__row"><span class="df-shortcuts__keys">${keyBadges(combo)}</span><span class="df-shortcuts__desc">${escHtml(desc)}</span></div>`;
  const plainRow = (k, d) => `<div class="df-shortcuts__row"><span class="df-shortcuts__keys df-shortcuts__keys--plain">${escHtml(k)}</span><span class="df-shortcuts__desc">${escHtml(d)}</span></div>`;
  const group = (g) => `<div class="df-shortcuts__group"><h3>${escHtml(g.title)}</h3>${g.items.map(([c, d]) => row(c, d)).join('')}</div>`;
  let bodyHtml = `<div class="df-shortcuts__grid">${SHORTCUT_GROUPS.map(group).join('')}</div>`;
  bodyHtml += `<div class="df-shortcuts__group df-shortcuts__group--wide"><h3>Mouse</h3>${MOUSE_TIPS.map(([k, d]) => plainRow(k, d)).join('')}</div>`;
  bodyHtml += `<div class="df-shortcuts__group df-shortcuts__group--wide"><h3>Right-click&hellip;</h3>${RIGHT_CLICK_TIPS.map(([k, d]) => plainRow(k, d)).join('')}</div>`;
  const { footer, close } = buildModal({
    title: 'Keyboard shortcuts', width: '480px', className: 'df-shortcuts-modal', bodyHtml,
    footerHtml: '<button class="df-modal__btn df-modal__btn--accent df-shortcuts__done">Done</button>',
  });
  footer?.querySelector('.df-shortcuts__done')?.addEventListener('click', () => close());
}

// --- Shared modal helpers ---

/** Wire up select-all checkbox + action button for any modal with row checkboxes.
 *  The check-all can live in the list header (top) or the footer; the action
 *  button is in the footer. */
// Focus-trap handles for the two statically-rendered modals (about + load).
// Stored module-scope so the show/hide pair on each can release cleanly.
let _aboutTrapRelease = null;

function showAboutModal() {
  const el = document.getElementById('about-modal');
  el.classList.remove('df-modal--hidden');
  document.body.classList.add('df-modal-open');
  _aboutTrapRelease = trapFocus(el, { onEscape: hideAboutModal });
}

function hideAboutModal() {
  _aboutTrapRelease?.(); _aboutTrapRelease = null;
  document.getElementById('about-modal').classList.add('df-modal--hidden');
  document.body.classList.remove('df-modal-open');
}

// ── Diagram | Table view switch (Data Mapping) ──────────────────────────────
function setupHamburgerMenu() {
  const hBtn = document.getElementById('btn-hamburger');
  const hWrap = hBtn?.closest('.df-toolbar__hamburger-wrap');
  if (!hBtn || !hWrap) return;

  hBtn.addEventListener('click', (evt) => {
    evt.stopPropagation();
    const isOpen = hWrap.classList.toggle('df-toolbar__hamburger-wrap--open');
    hBtn.setAttribute('aria-expanded', String(isOpen));
  });

  const menu = document.getElementById('hamburger-menu');
  if (!menu) return;

  menu.addEventListener('click', (evt) => {
    const item = evt.target.closest('[data-action]');
    if (!item) return;
    const action = item.dataset.action;

    // Close hamburger after action
    hWrap.classList.remove('df-toolbar__hamburger-wrap--open');
    hBtn.setAttribute('aria-expanded', 'false');

    switch (action) {
      // Save + Load open their full-overlay managers directly (mobile-friendly as-is); Display still surfaces
      // its desktop dropdown as a mobile overlay so every toggle is reachable.
      case 'save':
        showSaveManagerModal();
        break;
      case 'load':
        showLoadManagerModal();
        break;
      case 'display':
        openDropdownAsMobileOverlay(document.getElementById('display-dropdown'));
        break;
      case 'view-toggle':
        // Data Mapping Diagram|Table switch — the desktop segmented control lives in
        // .df-toolbar__left (hidden on mobile), so surface it here.
        setViewMode(modules.tableView?.isActive?.() ? 'diagram' : 'table');
        break;
      case 'map-bridge':
        // Delegate to the (mobile-hidden) desktop Map button's wired handler.
        document.getElementById('btn-map-bridge')?.click();
        break;
      case 'undo':
        modules.history.undo();
        break;
      case 'redo':
        modules.history.redo();
        break;
      case 'share':
        modules.persistence.shareAsURL();
        break;
      case 'theme':
        modules.theme.toggle();
        if (modules.canvas.refreshGrid) modules.canvas.refreshGrid();
        if (modules.canvas.refreshIcons) modules.canvas.refreshIcons();
        break;
      case 'walkthrough':
        document.getElementById('btn-help-tour')?.click();
        break;
      case 'whatsnew':
        showWhatsNewNow();
        break;
      case 'about':
        showAboutModal();
        break;
    }
  });
}

/**
 * Surface a toolbar dropdown's menu as a full-width mobile overlay. The menu is moved to
 * <body> (a placeholder marks its home) so it escapes any mobile-hidden ancestor, styled via
 * `.df-toolbar__menu--mobile-overlay`, and restored on the next item-click or outside tap. The
 * menu items keep their original click handlers (they ride along with the relocated element).
 */
function openDropdownAsMobileOverlay(dropdownEl) {
  const menu = dropdownEl?.querySelector('.df-toolbar__menu');
  if (!menu) return;
  const home = menu.parentNode;
  const anchor = document.createComment('df-menu-home');
  home.insertBefore(anchor, menu);
  document.body.appendChild(menu);
  menu.classList.add('df-toolbar__menu--mobile-overlay');

  const close = () => {
    menu.classList.remove('df-toolbar__menu--mobile-overlay');
    anchor.parentNode?.insertBefore(menu, anchor);   // restore to the dropdown
    anchor.remove();
    document.removeEventListener('pointerdown', onOutside, true);
    menu.removeEventListener('click', onItem);
  };
  const onOutside = (e) => { if (!menu.contains(e.target)) close(); };
  const onItem = (e) => { if (e.target.closest('.df-toolbar__menu-item')) close(); };

  menu.addEventListener('click', onItem);
  // Defer the outside-tap listener so the tap that opened this overlay doesn't close it.
  requestAnimationFrame(() => document.addEventListener('pointerdown', onOutside, true));
}

function setupToolbarCentering() {
  const toolbar = document.getElementById('toolbar');
  const left = toolbar.querySelector('.df-toolbar__left');
  const center = toolbar.querySelector('.df-toolbar__center');
  const right = toolbar.querySelector('.df-toolbar__right');
  if (!left || !center || !right) return;

  function checkOverlap() {
    // Temporarily remove compact to measure absolute-centered position
    toolbar.classList.remove('df-toolbar--compact');
    requestAnimationFrame(() => {
      const leftR = left.getBoundingClientRect().right;
      const rightL = right.getBoundingClientRect().left;
      const centerR = center.getBoundingClientRect();
      const pad = 12;
      if (centerR.left - pad < leftR || centerR.right + pad > rightL) {
        toolbar.classList.add('df-toolbar--compact');
      }
    });
  }

  const ro = new ResizeObserver(checkOverlap);
  ro.observe(toolbar);
  checkOverlap();
}

// ── Cloud-sync control (Google Drive) ────────────────────────────────────────
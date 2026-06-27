// Toolbar — wires all button clicks to module actions
// Also keeps undo/redo button states in sync

import { diagramHasImage } from './image-component.js?v=1.18.1';
import { showToast, showError, confirmModal, trapFocus, buildModal } from './feedback.js?v=1.18.1';
import { resizeDataObjectToFit } from './components.js?v=1.18.1';
import { isAutoSizingEnabled, setAutoSizingEnabled, refitAllParents, isConnectorGroupingEnabled, setConnectorGroupingEnabled, rerouteAllLinks, isCrossingBumpsEnabled, setCrossingBumpsEnabled, isFocusDimmingEnabled, setFocusDimmingEnabled } from './canvas.js?v=1.18.1';
import { escHtml, formatRelativeTime, countDiagramShapes, getDiagramTypeIcon, storageRowHtml, groupSelectHtml, tabInGroup, gaugeLevel, refreshSplitTableCounts, shareChipIconHtml, sharePillHtml, driveChipsHtml, isViewForkTab, diffGraphs } from './util.js?v=1.18.1';
import { dedupeSharedInWorkingCopies } from './persistence/drive-sync-logic.js?v=1.18.1';
import { exportObjectSchemaCsv } from './data-export.js?v=1.18.1';
import { renderTemplateThumbnail } from './templates.js?v=1.18.1';

let modules = {};
let _stencilWasOpenBeforeTable = false;   // restore stencil state when leaving Table mode

export function init(_modules) {
  modules = _modules;

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
  const runAutoLayout = (direction) => {
    const type = modules.tabs.getActiveTabType?.();
    modules.history.recordPositionsBatch(() => {
      if (type === 'datamapping') {
        // Dedicated lane layout: top-aligned lanes + 36px-spaced objects inside Layer
        // zones. Mapping links are field-port anchored, so DON'T snap them to side ports.
        modules.canvas.applyDataMappingLayout();
      } else if (type === 'process') {
        // BPMN pools / subprocesses / loops are embedding CONTAINERS. The mermaid
        // hierarchicalLayout lays every element out as a flat flow node — it positions a
        // container as a disconnected node while its children take their flow levels, so the
        // children spill OUTSIDE the container (and the top-anchored auto-fit can't pull the
        // frame back up). When the diagram uses containment, defer to the generic group-aware
        // autoLayout: it treats each container as a rigid unit (children translate along, so
        // they stay inside) and arranges the units + free nodes — and it's the undo-tested
        // path. A flat process (no containers / embedding) keeps the nicer hierarchical flow.
        const usesContainment = modules.graph.getElements().some(el => {
          const t = el.get('type');
          return t === 'sf.BpmnPool' || t === 'sf.BpmnSubprocess' || t === 'sf.BpmnLoop' || !!el.get('parent');
        });
        if (usesContainment) {
          modules.canvas.autoLayout(direction);
          try { modules.mermaidImport.snapLinksToPorts(modules.graph, direction); } catch {}
        } else {
          try {
            modules.mermaidImport.hierarchicalLayout(modules.graph, null, direction);
            modules.mermaidImport.snapLinksToPorts(modules.graph, direction);
            requestAnimationFrame(() => { try { modules.canvas.fitContent(); } catch {} });
          } catch (err) {
            console.warn('Process hierarchical layout failed, falling back:', err);
            modules.canvas.autoLayout(direction);
          }
        }
      } else {
        modules.canvas.autoLayout(direction);
        try { modules.mermaidImport.snapLinksToPorts(modules.graph, direction); } catch {}
      }
    });
    document.getElementById('display-dropdown')?.classList.remove('df-toolbar__dropdown--open');
  };
  btn('btn-auto-layout-h').addEventListener('click', () => runAutoLayout('horizontal'));
  btn('btn-auto-layout-v').addEventListener('click', () => runAutoLayout('vertical'));

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

  // Grid toggle
  btn('btn-grid').addEventListener('click', (evt) => {
    const on = modules.canvas.toggleGrid();
    evt.currentTarget.classList.toggle('df-toolbar__button--active', on);
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

  // About modal
  btn('btn-about').addEventListener('click', showAboutModal);
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

function setupDropdown(triggerId) {
  const trigger = btn(triggerId);
  const dropdown = trigger.closest('.df-toolbar__dropdown');
  const menu = dropdown.querySelector('.df-toolbar__menu');

  // Helper: list of focusable menu items, filtered live so disabled /
  // hidden entries are skipped during arrow navigation. Re-queried on
  // each call because some renderers rebuild the menu DOM at runtime
  // (e.g. Save when GIF encoding flips the export-disabled state).
  const focusables = () => Array.from(menu.querySelectorAll('.df-toolbar__menu-item'))
    .filter(el => !el.disabled && el.offsetParent !== null);

  const openMenu = () => {
    document.querySelectorAll('.df-toolbar__dropdown--open').forEach(dd => {
      if (dd !== dropdown) dd.classList.remove('df-toolbar__dropdown--open');
    });
    // Single top-bar panel: opening a toolbar dropdown closes any open anchored manager (Save / Load / Share).
    const openM = document.querySelector('.df-modal--anchored');
    if (openM && typeof openM.__dfClose === 'function') openM.__dfClose();
    // Button-merge (Display, scoped in CSS): the menu's top border resumes just past the trigger button.
    const setMergeW = () => menu.style.setProperty('--df-merge-w', `${Math.round(trigger.getBoundingClientRect().width)}px`);
    setMergeW();
    requestAnimationFrame(setMergeW);   // re-measure once the merged button's final width settles (lands the notch exactly)
    dropdown.classList.add('df-toolbar__dropdown--open');
  };
  const closeMenu = (restoreFocus = true) => {
    dropdown.classList.remove('df-toolbar__dropdown--open');
    if (restoreFocus) trigger.focus();
  };

  trigger.addEventListener('click', (evt) => {
    evt.stopPropagation();
    const isOpen = dropdown.classList.contains('df-toolbar__dropdown--open');
    if (isOpen) closeMenu(false);
    else openMenu();
  });

  // Gap 24 (v1.12.0) — keyboard activation on the trigger. ArrowDown /
  // Enter / Space open the menu and focus the first item; ArrowUp opens
  // and focuses the last (the "Reverse-tab into menu" convention used
  // by macOS menu bars and the ARIA Authoring Practices menu pattern).
  trigger.addEventListener('keydown', (evt) => {
    if (evt.key === 'ArrowDown' || evt.key === 'Enter' || evt.key === ' ') {
      evt.preventDefault();
      openMenu();
      focusables()[0]?.focus();
    } else if (evt.key === 'ArrowUp') {
      evt.preventDefault();
      openMenu();
      const items = focusables();
      items[items.length - 1]?.focus();
    }
  });

  // Gap 24 (v1.12.0) — keyboard nav inside the open menu. Arrow keys
  // cycle; Home/End jump; Escape closes and returns focus to the
  // trigger; Tab closes without restoring focus (so Tab continues into
  // the next toolbar item naturally).
  menu.addEventListener('keydown', (evt) => {
    const items = focusables();
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement);
    if (evt.key === 'ArrowDown') {
      evt.preventDefault();
      items[(idx + 1) % items.length].focus();
    } else if (evt.key === 'ArrowUp') {
      evt.preventDefault();
      items[(idx - 1 + items.length) % items.length].focus();
    } else if (evt.key === 'Home') {
      evt.preventDefault();
      items[0].focus();
    } else if (evt.key === 'End') {
      evt.preventDefault();
      items[items.length - 1].focus();
    } else if (evt.key === 'Escape') {
      evt.preventDefault();
      closeMenu(true);
    } else if (evt.key === 'Tab') {
      // Let Tab move out naturally; just close the menu so the next
      // toolbar button (not a hidden menu item) receives focus.
      closeMenu(false);
    }
  });

  // Close dropdown when a menu item is clicked
  dropdown.querySelectorAll('.df-toolbar__menu-item').forEach(item => {
    item.addEventListener('click', () => {
      dropdown.classList.remove('df-toolbar__dropdown--open');
    });
  });
}

// --- Load Modal ---

/**
 * Build the inline import-summary copy shown at the top of the Load modal right
 * after a bundle import. Leads with diagrams (this modal lists diagrams); a
 * trailing clause covers templates, which land in the stencil, not this list.
 */
function formatImportSummary({ imported = 0, skipped = 0, templates = 0, templatesSkipped = 0 } = {}) {
  const noun = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  // "Import complete" whenever ANYTHING new landed — including templates-only
  // (a template added IS something new, so "Nothing new" would be wrong).
  const head = (imported || templates) ? 'Import complete:' : 'Nothing new to import:';
  const items = [];
  if (imported)         items.push(`${noun(imported, 'diagram')} saved`);
  if (skipped)          items.push(`${noun(skipped, 'diagram')} skipped - already opened or saved in this browser`);
  if (templates)        items.push(`${noun(templates, 'template')} saved`);
  if (templatesSkipped) items.push(`${noun(templatesSkipped, 'template')} skipped - already in your stencil`);
  const lis = items.map(i => `<li>${i}</li>`).join('');
  return `<strong class="df-import-summary__head">${head}</strong><ul class="df-import-summary__list">${lis}</ul>`;
}

// --- Load Manager (tabbed overlay: Browser / Google Drive / File / Paste) ---
// One overlay replaces the old Load dropdown + its three separate modals. Each tab renders into a shared pane
// and installs its own footer. The legacy entry names (showLoadModal / showDriveLibraryModal /
// showPasteImportModal) survive as thin redirects so the persistence callbacks + the New-Diagram modal keep
// working unchanged. `importStats` (optional) is passed by persistence right after a bundle import to render a
// transient success summary on the Browser tab.
let _loadMgrClose = null;

function showLoadManagerModal(initialTab = null, importStats = null) {
  const p = modules.persistence;
  _loadMgrClose?.(); _loadMgrClose = null;                 // release any prior instance's focus trap
  document.querySelector('.df-load-manager-modal')?.remove();
  const driveOn = !!p.isDriveConfigured?.();

  const TABS = [
    { key: 'browser', label: 'Browser', icon: 'open_folder' },
    ...(driveOn ? [{ key: 'drive', label: 'Google Drive', icon: 'icon-gdrive' }] : []),
    { key: 'file', label: 'File', icon: 'upload' },
    { key: 'paste', label: 'Paste', icon: 'paste' },
  ];
  // No explicit tab (the no-arg Load button) defaults to Google Drive when SIGNED IN - a Drive user lands on
  // their cloud library; everyone else lands on Browser. Explicit callers ('paste' / 'browser' / 'drive') win.
  const driveDefault = !!p.isDriveConnected?.() && TABS.some(t => t.key === 'drive');
  let active = TABS.some(t => t.key === initialTab) ? initialTab : (driveDefault ? 'drive' : 'browser');
  const tabBtn = (t) => `<button class="df-load-mgr__tab${t.key === active ? ' is-active' : ''}" role="tab" data-tab="${t.key}" aria-selected="${t.key === active}"><svg class="df-toolbar__icon" aria-hidden="true"><use href="#${t.icon}"></use></svg><span>${escHtml(t.label)}</span></button>`;

  const { body, footer, close } = buildModal({
    title: 'Load & Import',
    className: 'df-load-manager-modal',
    origin: document.getElementById('btn-load'),   // scale-open from the Load button
    anchor: document.getElementById('btn-load'),   // anchored under the Load button (item 5) so the tab row never jumps
    dialogClass: 'df-load-mgr__dialog',
    bodyClass: 'df-modal__row-list',
    bodyHtml: `<div class="df-load-mgr__tabs" role="tablist">${TABS.map(tabBtn).join('')}</div><div class="df-load-mgr__pane"></div>`,
    footerHtml: '<span></span>',
  });
  _loadMgrClose = () => { _loadMgrClose = null; close(); };
  const pane = body.querySelector('.df-load-mgr__pane');

  const select = (key) => {
    active = key;
    body.querySelectorAll('.df-load-mgr__tab').forEach(b => {
      const on = b.dataset.tab === key; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
    });
    footer.innerHTML = '';
    pane.innerHTML = '';
    const ctx = { pane, footer, close };
    if (key === 'browser') renderBrowserLoadPane(ctx, importStats);
    else if (key === 'drive') renderDriveLoadPane(ctx);
    else if (key === 'file') renderFileLoadPane(ctx);
    else if (key === 'paste') renderPasteLoadPane(ctx);
    importStats = null;   // the import summary shows only on the first Browser render
  };
  body.querySelectorAll('.df-load-mgr__tab').forEach(b => b.addEventListener('click', () => select(b.dataset.tab)));
  select(active);

  // Heal stale/missing per-tab Drive links against the user's real owned files BEFORE the chips can mislead, so
  // the Browser tab's "My Drive"/"Shared Drive" and the Drive tab's "This browser" both agree with reality (the
  // chip-honesty fix). One network round-trip; re-render the active pane ONLY when the reconcile actually changed
  // a tab - re-rendering unconditionally re-fetched + flashed the Drive pane every open (the "loads twice" flicker).
  if (driveOn && p.isDriveConnected?.() && p.reconcileTabDriveLinks) {
    p.reconcileTabDriveLinks().then((changed) => { if (changed && document.body.contains(pane)) select(active); }).catch(() => { /* offline → keep optimistic chips */ });
  }
}

// Closes the Load Manager (used by the per-row Load buttons in buildLoadItem + the advisory links).
function hideLoadModal() { _loadMgrClose?.(); }

// Legacy entry points → the Load Manager on the matching tab (keeps persistence callbacks + New-Diagram wiring).
function showLoadModal(importStats = null) { showLoadManagerModal('browser', importStats); }
function showDriveLibraryModal() { if (modules.persistence.isDriveConfigured?.()) showLoadManagerModal('drive'); }
function showPasteImportModal() { showLoadManagerModal('paste'); }

// --- Load Manager: Browser pane (reopen a closed diagram from the named-saves shelf) ---

/** Browser storage-pressure gauge HTML (item #3) — uses the existing getStorageFootprint / STORAGE_WARNING_BYTES.
 *  Returns '' when the footprint is unknown (Private mode throws) or empty. Only width:% is inlined; labels escaped. */
function storagePressureHtml() {
  let used = 0;
  try { used = modules.persistence.getStorageFootprint?.() || 0; } catch { return ''; }
  if (!(used > 0)) return '';
  const warn = modules.persistence.STORAGE_WARNING_BYTES || 4_000_000;
  const level = gaugeLevel(used, warn);
  const pct = Math.min(100, Math.round((used / warn) * 100));
  const hint = level === 'ok' ? ''
    : '<p class="df-load-gauge__hint">Browser storage is filling up - export or delete saved diagrams to free space.</p>';
  return `<div class="df-load-gauge df-load-gauge--${level}">
      <div class="df-load-gauge__caption"><span>Browser storage</span><span>${escHtml((used / 1e6).toFixed(1))} MB used</span></div>
      <div class="df-load-gauge__track"><div class="df-load-gauge__fill" style="width:${pct}%"></div></div>
      ${hint}
    </div>`;
}

function renderBrowserLoadPane({ pane, footer }, importStats) {
  const driveOn = !!modules.persistence.isDriveConfigured?.();
  // Open session tabs (non-empty), computed up front so the advisory copy and the footer "Close & Delete"
  // button stay in lockstep: the affordance — and the line pointing at it — appear whenever there's anything
  // to manage (closed archives OR open tabs), never dangling.
  const typeLabel = (type) => (modules.tabs.DIAGRAM_TYPES?.[type]?.short) || 'Architecture';
  const groupById = new Map((modules.tabs.getGroups?.() || []).map((g) => [g.id, g]));
  const openTabs = (modules.tabs.getAllTabs() || [])
    .map((t) => ({ ...t, shapes: countDiagramShapes(modules.tabs.getTabGraphJSON(t.id)?.cells) }))
    .filter((t) => t.shapes > 0);
  // A closed archive that is ALSO open as a tab (linked by browserSaveName, e.g. right after you Load it) is the
  // SAME diagram - show it ONCE in the open section below, not duplicated as a "closed" archive (new #2: loading
  // an archive used to list it in both the closed AND open lists, as if the load wasn't recognised).
  const openSaveNames = new Set(openTabs.map((t) => t.browserSaveName).filter(Boolean));
  const saves = (modules.persistence.getNamedSaves() || []).filter((s) => !openSaveNames.has(s.name));
  const hasArchives = !!(saves && saves.length);
  const hasContent = hasArchives || openTabs.length > 0;

  // Transient import summary (green) — only right after a bundle import reopened us on this tab.
  if (importStats && (importStats.imported || importStats.skipped || importStats.templates || importStats.templatesSkipped)) {
    const summary = document.createElement('div');
    summary.className = 'df-modal__advisory df-modal__advisory--success df-import-summary';
    summary.innerHTML = formatImportSummary(importStats);
    pane.appendChild(summary);
  }

  // Plain intro hint (NOT the yellow .df-modal__advisory block) - reads like the Google Drive tab's top line.
  // Three inline links: "delete" → the Close & Delete browser-storage hub; "Google Drive" + "back up" → the
  // Save & Export manager (where Save-to-Drive and the JSON "Back up now" both live). The Google Drive clause is
  // shown only when Drive is configured for this origin (on a Drive-dark prod build it's dropped, leaving a clean
  // "...free up space, or back up to JSON.").
  const advisory = document.createElement('p');
  advisory.className = 'df-drive-save-modal__hint';
  const delLink = '<button type="button" class="df-modal__advisory-link df-load__manage-link">delete</button>';
  const driveLink = '<button type="button" class="df-modal__advisory-link df-load__drive-link">Google Drive</button>';
  const backupLink = '<button type="button" class="df-modal__advisory-link df-load__export-link">back up</button>';
  advisory.innerHTML = `Your diagrams are auto-saved in this browser, so they reopen after you close a tab. The browser can clear old ones if space runs low. ${delLink} ones you don't need to free up space, ${driveOn ? `sync all to ${driveLink} to keep them for good, or ` : 'or '}${backupLink} to JSON.`;
  advisory.querySelector('.df-load__manage-link')?.addEventListener('click', () => { hideLoadModal(); modules.tabs.showCloseTabsModal?.(); });
  advisory.querySelector('.df-load__export-link')?.addEventListener('click', () => { hideLoadModal(); showSaveManagerModal(); });
  advisory.querySelector('.df-load__drive-link')?.addEventListener('click', () => { hideLoadModal(); showSaveManagerModal(); });
  pane.appendChild(advisory);

  // Browser storage-pressure gauge (item #3) — built from the existing footprint/ceiling helpers so the user
  // can see how full this browser's store is (it's what evicts the list above under pressure).
  const gaugeHtml = storagePressureHtml();
  if (gaugeHtml) { const g = document.createElement('div'); g.innerHTML = gaugeHtml; pane.appendChild(g.firstElementChild); }

  // 1) CLOSED diagrams — the named-saves archive (reopen / delete). Shown first, with the bulk footer.
  if (hasArchives) {
    // Item 3 + review fix: the "Select all" bar FLOATS above the Closed table as a controls strip (a sibling, not
    // inside the collapsible rows) - so collapsing the table no longer hides the select-all. Mirrors Close & Delete.
    const header = document.createElement('div');
    header.className = 'df-modal__list-header df-split-table__controls';
    header.innerHTML = `<label class="df-modal__select-all"><input type="checkbox" class="df-modal__check-all"> Select all</label>`;
    pane.appendChild(header);
    const box = document.createElement('div');
    box.className = 'df-split-table df-modal__list-box';   // collapsible table (item 3), expanded by default
    box.innerHTML = `<div class="df-split-table__head" role="button" tabindex="0"><svg class="df-load-open__chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Closed in this browser</span><span class="df-split-table__count">${saves.length}</span></div>`;
    const rows = document.createElement('div');
    rows.className = 'df-split-table__rows';
    for (const save of saves) rows.appendChild(buildLoadItem(save));
    box.appendChild(rows);
    const closedHead = box.querySelector('.df-split-table__head');
    const toggleClosed = () => box.classList.toggle('is-collapsed');
    closedHead.addEventListener('click', toggleClosed);
    closedHead.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleClosed(); } });
    pane.appendChild(box);

    // 6.4: no per-row delete + no bulk "Delete Selected" here — deleting browser-stored diagrams (open tabs AND
    // closed archives) now lives in ONE place, the Close & Delete overlay, reached from the advisory link above
    // (no footer button - the footer holds only Load Selected).
    footer.innerHTML = `<button class="df-modal__btn df-modal__btn--accent df-modal__action-btn" style="margin-left:auto" disabled>Load Selected</button>`;
    const checkAll = header.querySelector('.df-modal__check-all');
    const loadBtn = footer.querySelector('.df-modal__action-btn');
    const rowChecks = () => [...pane.querySelectorAll('.df-modal__row-check')];
    const refresh = (expand = false) => {
      const cs = rowChecks(); const any = cs.some(c => c.checked); const all = cs.length > 0 && cs.every(c => c.checked);
      loadBtn.disabled = !any; checkAll.checked = all; checkAll.indeterminate = any && !all;
      // item 1: the Closed table's header count flips to "selected/total"; Select all also re-opens it if collapsed.
      refreshSplitTableCounts(pane, '.df-modal__row-check', { expand });
    };
    checkAll.addEventListener('change', () => { rowChecks().forEach(c => { c.checked = checkAll.checked; }); refresh(true); });
    pane.addEventListener('change', (e) => { if (e.target.matches('.df-modal__row-check')) refresh(); });
    loadBtn.addEventListener('click', async () => {
      const sel = rowChecks().filter(c => c.checked);
      // Coalesce the version notice: loading several old-version saves at once prompts ONCE per version (item 3).
      modules.persistence.beginVersionWarningBatch?.();
      try {
        for (const chk of sel) { if (await modules.persistence.loadNamedSave(chk.dataset.saveKey)) tagActiveBrowserSave(chk.dataset.saveName); }
      } finally { modules.persistence.endVersionWarningBatch?.(); }
      hideLoadModal();
    });
    refresh();
  }
  // (No archives → no footer: the footer was cleared on pane switch, and Close & Delete now lives in the
  // advisory link above, so there's nothing footer-worthy when the Browser tab holds only open diagrams.)

  // 2) OPEN diagrams — the current session tabs (auto-kept in this browser). Listed AFTER the archive so the
  // Browser tab matches the Save Manager's "This browser" chips and is never confusingly empty when you have
  // work. These are already open, so the action is "Go to tab" (switch), not "Load". Non-empty only (mirrors
  // the Save Manager); the active tab shows a disabled "Current". (typeLabel / groupById / openTabs are computed
  // at the top of this function so the footer above can gate on openTabs.)
  if (openTabs.length) {
    const grp = document.createElement('div');
    grp.className = 'df-split-table df-modal__list-box is-collapsed';   // collapsible table, collapsed by default (#5, item 3)
    grp.innerHTML = `<div class="df-split-table__head" role="button" tabindex="0"><svg class="df-load-open__chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Opened in this browser</span><span class="df-split-table__count">${openTabs.length}</span></div>`;
    const box = document.createElement('div');
    box.className = 'df-split-table__rows';
    for (const t of openTabs) {
      const rel = formatRelativeTime(t.lastModifiedAt || t.lastSavedAt);
      const tsrc = t.driveSharedSource;
      const tPill = (tsrc && tsrc.fileId && !isViewForkTab(t)) ? sharePillHtml(tsrc.canEdit, { sm: true }) : '';   // bug #4: the Copy/Collab pill was missing in Load -> Browser
      const tmp = document.createElement('template');
      tmp.innerHTML = storageRowHtml({
        active: t.isActive,   // active row → "current" pill + highlight (shared with the Save Manager)
        diagramType: t.diagramType, typeTitle: typeLabel(t.diagramType),
        name: t.name,
        groupBadge: modules.tabs.groupBadgeHtml?.(t.groupId ? groupById.get(t.groupId) : null) || '',   // group badge (item 11)
        count: t.shapes,
        metaLeft: `<span class="df-save-mgr__chips">${driveChipsHtml(t, { driveOn, onSharedDrive: !!t.driveDriveId, hasMyDriveBackup: !!t.driveHasMyDriveBackup })}${tPill}</span>`,   // same chips + pill as the Save Manager
        metaRight: rel ? `Edited ${rel}` : '',   // right-aligned edit time, mirroring the Save Manager rows
        // Already-open diagrams: Current / Go to tab are brand-orange WIRE (transparent); the action isn't a load.
        trailing: `<button class="df-modal__btn df-modal__btn--amber-outline df-load-open__go" data-id="${escHtml(t.id)}"${t.isActive ? ' disabled' : ''}>${t.isActive ? 'Current' : 'Go to tab'}</button>`,
      }).trim();
      const row = tmp.content.firstElementChild;
      row.querySelector('.df-load-open__go')?.addEventListener('click', () => { hideLoadModal(); modules.tabs.switchTab?.(t.id); });
      box.appendChild(row);
    }
    grp.appendChild(box);
    const head = grp.querySelector('.df-split-table__head');
    const toggle = () => grp.classList.toggle('is-collapsed');
    head?.addEventListener('click', toggle);
    head?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    pane.appendChild(grp);
  }

  // 3) Truly empty (nothing closed AND no non-empty open tab) — only on a fresh blank canvas.
  if (!hasContent) {
    const empty = document.createElement('p');
    empty.className = 'df-modal__empty';
    empty.textContent = 'No diagrams in this browser yet. Add some shapes and your diagrams appear here.';
    pane.appendChild(empty);
  }
}

// --- Load Manager: Google Drive pane ("Your Google Drive Diagrams" library) ---
function renderDriveLoadPane({ pane, footer, close }) {
  const p = modules.persistence;
  pane.innerHTML = `
    <p class="df-drive-save-modal__hint">Your Google Drive diagrams, plus ones shared to you (marked <strong>Shared File</strong>). Open them on any device. Delete moves a diagram to Drive trash for 30 days; only the owner can remove a file shared to you.</p>
    <div class="df-drive-library__body"><p style="padding:18px;text-align:center;color:var(--text-secondary)">Loading…</p></div>
    <div class="df-drive-library__more">
      <p class="df-drive-library__more-hint">Looking for a diagram that isn't listed - one you added to Drive yourself, or that lives on a team Shared Drive?</p>
      <button class="df-modal__btn df-modal__btn--accent df-drive-library__picker"><svg class="df-toolbar__icon" aria-hidden="true"><use href="#icon-gdrive"></use></svg>Search Google Drive</button>
    </div>`;
  footer.innerHTML = '<button class="df-modal__btn df-modal__btn--danger-outline df-drive-library__delete" style="margin-right:auto" disabled>Delete Selected</button><button class="df-modal__btn df-modal__btn--amber-outline df-drive-library__load" disabled>Load Selected</button>';
  const deleteBtn = footer.querySelector('.df-drive-library__delete');
  const loadBtn = footer.querySelector('.df-drive-library__load');
  const bodyBox = pane.querySelector('.df-drive-library__body');
  const status = (html) => { bodyBox.innerHTML = `<p style="padding:18px;text-align:center;color:var(--text-secondary)">${html}</p>`; deleteBtn.disabled = true; loadBtn.disabled = true; };
  // Item 8: search the whole Drive (incl. files added manually / on Shared Drives) via the Google Picker. The
  // library list above only shows the app's own .dgf masters; the picker reaches anything the user can open.
  pane.querySelector('.df-drive-library__picker')?.addEventListener('click', () => { close(); p.openFromDrive?.(); });

  // Chips parity with the Save Manager: a Drive file that's also OPEN locally shows its full storage chips; one
  // that isn't shows "My Drive ✓" with the browser chip off. Map open tabs by their linked Drive fileId.
  // Key open tabs by their linked Drive id - an OWN master by driveFileId, a Shared File by sharedSource.fileId
  // (item 3.4b: a shared file open in a tab has NO driveFileId, so it was missed here and its row wrongly read
  // "This browser" OFF while Load -> Browser showed it ON. Now both panes agree).
  const openByDrive = new Map((modules.tabs.getAllTabs() || [])
    .filter((t) => t.driveFileId || t.driveSharedSource?.fileId)
    .map((t) => [t.driveFileId || t.driveSharedSource.fileId, t]));
  const groupById = new Map((modules.tabs.getGroups?.() || []).map((g) => [g.id, g]));

  const rowHtml = (f) => {
    const type = f.appProperties?.dfType;
    const typeLabel = (modules.tabs.DIAGRAM_TYPES?.[type]?.short) || '';
    const shapes = f.appProperties?.dfShapes != null ? Number(f.appProperties.dfShapes) : null;
    const rel = formatRelativeTime(Date.parse(f.modifiedTime));
    const ot = openByDrive.get(f.id);
    // A file shared TO me (I'm not the owner) leaks into this list under drive.file. It is NOT in My Drive, so
    // show a "Shared File" chip instead of a green "My Drive" (item 8.1), and mark it so delete skips it (the
    // recipient can't trash a file they don't own - that's the 403). Open tabs keep their own Shared-File-model
    // chips. The "Shared with you" section adds who shared it + the access type (writer = Collaborate, reader = a
    // View / Copy share) from the capabilities + sharingUser/owners fields.
    // A working copy is an OWNED master that IS the recipient's editable copy of a shared-in file (the de-dup above
    // collapsed it + hid the original). It gets the shared-in treatment (Shared File chip + Copy/Collab pill) but,
    // being yours, keeps the plain Load button.
    const workingCopy = f._sharedInWorkingCopy;
    const notOwned = f.ownedByMe === false;
    // canEdit drives the Copy/Collab pill: for a working copy it's the SHARE's access (view=Copy, edit=Collab), NOT
    // your ownership of the copy; for a real not-owned file it's your write capability on it.
    const canEdit = workingCopy ? workingCopy.canEdit : !!(f.capabilities && f.capabilities.canEdit);
    const sharedIn = notOwned || !!workingCopy;
    // `driveId` is set only for files that live on a team Shared Drive. Such a file is the ACTUAL Shared-Drive copy
    // (often a near-duplicate of your My-Drive source master) - badge IT "Shared Drive", and rebuild a clean chipT
    // so it isn't also mislabeled "My Drive" from an open tab's own fileId (#1).
    const onSharedDrive = !!f.driveId;
    const chipT = onSharedDrive ? { driveSharedCopies: 0 }
      : ot || (workingCopy ? { driveFileId: f.id, driveSharedSource: { fileId: '_src', canEdit } }   // owned + linked = My Drive + Shared File chips
        : notOwned ? { driveSharedSource: { fileId: f.id, canEdit } }
          : { driveFileId: f.id });
    // A file shared TO you: who shared it + the access type (writer = Collaborate, reader = Copy) now live as a
    // pill on the top row + a "shared by X" tooltip on the Shared File chip, so the old dedicated third row is
    // gone (the row is two-line like every other). The chips drop the irrelevant "My Drive" (it is not in your
    // Drive) so "This browser" + "Shared File" carry the real status.
    const who = notOwned ? (f.sharingUser?.emailAddress || f.sharingUser?.displayName
      || f.owners?.[0]?.emailAddress || f.owners?.[0]?.displayName || 'someone') : '';
    // Copy/Collaborate pill marks the access level at a glance. It sits in the BOTTOM chip row right after the
    // "Shared File" chip (item 6) - the access type belongs with the Shared-File state, not up by the title - sized
    // to match that row (df-share-pill--sm).
    const sharePill = sharedIn ? sharePillHtml(canEdit, { sm: true, workingCopy: !!workingCopy }) : '';
    const groupBadge = (ot && ot.groupId ? (modules.tabs.groupBadgeHtml?.(groupById.get(ot.groupId)) || '') : '');
    const cloneBtn = `<button class="df-modal__btn df-modal__btn--amber-outline df-drive-library__clone" data-id="${escHtml(f.id)}" data-name="${escHtml(f.name)}"${canEdit ? '' : ' data-copy="1"'} title="Save your own independent copy in My Drive - it becomes your file (refreshable from the original; your edits don't sync back to the owner)">Clone</button>`;
    // data-can-edit carries the list's KNOWN Collab status (the "Collab" pill) into the open so the recipient's
    // tab share glyph appears immediately - even if the fresh ownership probe returns canEdit=null (Drive omits
    // capabilities right after a grant), which previously left the glyph hidden until the first edit (#3).
    // Mode C: an OWNED fork carries dfSharedFrom - thread it into the open so the refresh-only sharedSource is rebuilt
    // (Refresh-from-original survives a close+re-open), without re-classifying the fork as a shared-in tab.
    const forkAttrs = (!notOwned && f.appProperties?.dfSharedFrom)
      ? ` data-shared-from="${escHtml(f.appProperties.dfSharedFrom)}" data-shared-edit="${escHtml(f.appProperties.dfSharedEdit || '0')}"` : '';
    const loadBtn = `<button class="df-modal__btn df-modal__btn--accent df-drive-library__open" data-id="${escHtml(f.id)}" data-name="${escHtml(f.name)}"${notOwned ? ' data-shared="1"' : ''}${notOwned && canEdit ? ' data-can-edit="1"' : ''}${onSharedDrive ? ` data-drive-id="${escHtml(f.driveId)}"` : ''}${forkAttrs}>Load</button>`;
    // Mode C: a VIEW (Copy) share now opens with Load - it creates nothing on open and forks to your own
    // "(changed)" My-Drive copy the moment you edit it, so an explicit Clone is no longer needed. A Collaborate
    // share offers Load + a fork-now Clone; owned files + working copies offer the plain Load.
    const trailing = notOwned && canEdit
      ? `<div class="df-drive-library__actions">${loadBtn}${cloneBtn}</div>`
      : loadBtn;
    return storageRowHtml({
      checkbox: `<input type="checkbox" class="df-modal__row-check df-drive-library__check" data-id="${escHtml(f.id)}" data-name="${escHtml(f.name)}"${notOwned ? ' data-shared="1"' : ''}${notOwned && canEdit ? ' data-can-edit="1"' : ''}${onSharedDrive ? ` data-drive-id="${escHtml(f.driveId)}"` : ''}${forkAttrs}>`,
      diagramType: type || '', typeTitle: typeLabel, name: f.name.replace(/\.dgf$/i, ''),
      groupBadge,
      count: Number.isFinite(shapes) ? shapes : null,
      metaLeft: `<span class="df-save-mgr__chips">${driveChipsHtml(chipT, { driveOn: true, browserOn: !!ot, browserTitle: ot ? undefined : 'Not open in this browser right now', sharedFile: notOwned, onSharedDrive, hasMyDriveBackup: !!(ot && ot.driveHasMyDriveBackup), hideSharedCopies: true, sharedFileTitle: notOwned ? `Shared by ${who} - ${canEdit ? 'you can edit (Collab)' : 'view-only (Copy)'}` : undefined })}${sharePill}</span>`,
      metaRight: rel ? `Edited ${escHtml(rel)}` : 'in your Drive',
      trailing,
    });
  };

  const confirmDelete = async (ids, oneName) => {
    const ok = await confirmModal({
      title: ids.length === 1 ? 'Delete from Google Drive?' : `Delete ${ids.length} diagrams?`,
      message: `${ids.length === 1 ? `"${(oneName || '').replace(/\.dgf$/i, '')}" moves` : `${ids.length} diagrams move`} to Drive trash, recoverable for 30 days. Copies you shared out are not affected.`,
      okLabel: 'Move to trash', cancelLabel: 'Cancel', tone: 'danger',
    });
    if (!ok) return;
    let n = 0;
    for (const id of ids) if (await p.deleteDiagramFromDrive(id)) { p.forgetArchivesForDriveFile?.(id); n++; }
    if (n) showToast(`Moved ${n} diagram${n === 1 ? '' : 's'} to Drive trash ✓`, 'info');
    render();
  };

  const render = async () => {
    status('Loading…');
    let files;
    try { files = await p.listMyDiagrams(); }
    catch {
      bodyBox.innerHTML = `<p style="padding:18px;text-align:center;color:var(--text-secondary)">Could not load your Drive diagrams. <button class="df-modal__btn df-drive-library__retry">Retry</button></p>`;
      bodyBox.querySelector('.df-drive-library__retry')?.addEventListener('click', render);
      return;
    }
    // Hide files that aren't diagrams the user works on directly, so they don't read as a phantom second row:
    //  - My-Drive BACKUP mirrors (dfBackupOf) - the auto-kept copy of a Shared-Drive / direct-edit file.
    //  - recipient-editable SHARE copies (dfEditShareOf) - the copy a Collaborate share hands to the recipient; its
    //    surface is the Share Manager + the Review flow, not the library (screen 3). For copies created BEFORE that
    //    stamp, also drop any open tab's tracked edit-share copy fileId (cross-ref via getAllTabs().driveCopies).
    const _openTabs = modules.tabs.getAllTabs() || [];
    const _editShareIds = new Set();
    for (const t of _openTabs) for (const c of (t.driveCopies || [])) if (c && c.kind === 'edit-share' && c.fileId) _editShareIds.add(c.fileId);
    files = files.filter(f => !(f.appProperties && (f.appProperties.dfBackupOf || f.appProperties.dfEditShareOf)) && !_editShareIds.has(f.id));
    // Collapse a shared-in diagram (recipient's own working-copy master + the original) to ONE row: drop the original,
    // tag the surviving master `_sharedInWorkingCopy` so it re-homes under "Shared with you". Pure helper (unit-tested).
    files = dedupeSharedInWorkingCopies(files, _openTabs);
    if (!files.length) { status('No diagrams in your Google Drive yet. Save a diagram to Drive (or turn on auto-sync) and it appears here.'); return; }
    // Select-all + a "Select Tab Group" picklist (item #4): a Drive file's group is the group of its matching
    // open tab (via openByDrive). The picklist self-hides when there are no named groups.
    const groupPick = groupSelectHtml(modules.tabs.getGroups?.() || []);
    // Split into your own files vs files shared TO you (item 8). A "Shared with you" section reads as an invite
    // list - you can open them but not delete them (only the owner can). When there are no shared files, it's just
    // the single list as before (no redundant "Your Google Drive" header).
    // A working-copy-of-a-share is OWNED but belongs under "Shared with you" (it IS a shared-in diagram).
    const mine = files.filter(f => f.ownedByMe !== false && !f._sharedInWorkingCopy);
    const shared = files.filter(f => f.ownedByMe === false || f._sharedInWorkingCopy);
    // Item 2: each section is its OWN bordered, collapsible TABLE (like Load Browser's groups) - a header band with
    // a chevron + count capping its own rows - not two soft sub-sections sharing one box. Uncollapsed by default.
    const groupTable = (label, files) =>
      `<div class="df-modal__list-box df-drive-library__group"><div class="df-drive-library__section" role="button" tabindex="0"><svg class="df-load-open__chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${escHtml(label)}</span><span class="df-drive-library__section-count">${files.length}</span></div><div class="df-drive-library__group-rows">${files.map(rowHtml).join('')}</div></div>`;
    // The global Select-all + group-pick bar sits ABOVE both tables (it spans the whole multi-select).
    const controls = `<div class="df-modal__list-header df-drive-library__controls"><label class="df-modal__select-all"><input type="checkbox" class="df-drive-library__all"> Select all</label>${groupPick}</div>`;
    // Both present → two labelled, collapsible tables. Mine-only → a single flat table (no redundant header).
    // Shared-only → one "Shared with you" table.
    let tables;
    if (mine.length && shared.length) tables = groupTable('Your Google Drive', mine) + groupTable('Shared with you', shared);
    else if (mine.length) tables = `<div class="df-modal__list-box">${mine.map(rowHtml).join('')}</div>`;
    else tables = groupTable('Shared with you', shared);
    bodyBox.innerHTML = controls + tables;
    bodyBox.querySelectorAll('.df-drive-library__group .df-drive-library__section').forEach((h) => {
      const grp = h.closest('.df-drive-library__group');
      const tg = () => grp.classList.toggle('df-drive-library__group--collapsed');
      h.addEventListener('click', tg);
      h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tg(); } });
    });
    const checks = [...bodyBox.querySelectorAll('.df-drive-library__check')];
    const groupOfFile = (id) => openByDrive.get(id)?.groupId || null;
    const refresh = () => { const any = checks.some(c => c.checked); deleteBtn.disabled = !any; loadBtn.disabled = !any; };
    bodyBox.querySelector('.df-drive-library__all')?.addEventListener('change', (e) => { checks.forEach(c => { c.checked = e.target.checked; }); refresh(); });
    const groupSel = bodyBox.querySelector('.df-group-select');
    groupSel?.addEventListener('change', () => {
      const chosen = groupSel.value;
      if (chosen) checks.forEach(c => { c.checked = tabInGroup(groupOfFile(c.dataset.id), chosen); });
      groupSel.value = '';   // snap back to the placeholder (it's a picker, not a filter state)
      refresh();
    });
    checks.forEach(c => c.addEventListener('change', refresh));
    bodyBox.querySelectorAll('.df-drive-library__open').forEach(btn => btn.addEventListener('click', async () => { if (await p.openDriveDiagram(btn.dataset.id, btn.dataset.name, btn.dataset.shared !== '1', { knownCanEdit: btn.dataset.canEdit === '1', driveId: btn.dataset.driveId || null, sharedFrom: btn.dataset.sharedFrom || null, sharedEdit: btn.dataset.sharedEdit || null })) close(); }));
    // Clone a shared file into the user's own Drive as an editable copy, then close (it opens as a new tab) (item 2).
    bodyBox.querySelectorAll('.df-drive-library__clone').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { if (await p.cloneSharedToMyDrive?.(btn.dataset.id, btn.dataset.name)) close(); else btn.disabled = false; }
      catch { btn.disabled = false; }
    }));
  };
  deleteBtn.addEventListener('click', () => {
    const sel = [...bodyBox.querySelectorAll('.df-drive-library__check:checked')];
    // A file shared TO you can't be moved to trash by you (only its owner can - that's the 403). Trash only the
    // files you own; warn about any shared ones in the selection. Pass the single owned name so the confirm
    // dialog shows it (the missing-filename bug: confirmDelete was called with no name).
    const owned = sel.filter(c => c.dataset.shared !== '1');
    const sharedN = sel.length - owned.length;
    if (sharedN && !owned.length) {
      showToast(`Files shared to you can't be deleted here - only the owner can remove them.`, 'info');
      return;
    }
    if (sharedN) showToast(`${sharedN} shared file${sharedN === 1 ? '' : 's'} skipped - only the owner can delete.`, 'info');
    const ids = owned.map(c => c.dataset.id);
    if (ids.length) confirmDelete(ids, owned.length === 1 ? owned[0].dataset.name : null);
  });
  loadBtn.addEventListener('click', async () => {
    const sel = [...bodyBox.querySelectorAll('.df-drive-library__check:checked')];
    if (!sel.length) return;
    loadBtn.disabled = true;
    let opened = 0;
    // Coalesce the version notice across the batch (item 3) - one prompt per old version, not per file.
    p.beginVersionWarningBatch?.();
    try {
      for (const c of sel) { if (await p.openDriveDiagram(c.dataset.id, c.dataset.name, c.dataset.shared !== '1', { knownCanEdit: c.dataset.canEdit === '1', driveId: c.dataset.driveId || null, sharedFrom: c.dataset.sharedFrom || null, sharedEdit: c.dataset.sharedEdit || null })) opened++; }
    } finally { p.endVersionWarningBatch?.(); }
    if (opened) close(); else loadBtn.disabled = false;
  });
  render();
}

// --- Load Manager: File pane (open a .dgf / .json export by drop or picker) ---
function renderFileLoadPane({ pane, footer, close }) {
  pane.innerHTML = `
    <div class="df-load-file" tabindex="0" role="button" aria-label="Choose a file or drop it here">
      <svg class="df-load-file__icon" aria-hidden="true"><use href="#upload"></use></svg>
      <p class="df-load-file__title">Drop a diagram file here, or click to choose</p>
      <p class="df-load-file__sub">A Diagramforce <strong>.dgf</strong> or <strong>.json</strong> export - single diagram, group bundle, or templates.</p>
      <input type="file" class="df-load-file__input" accept=".dgf,.json,application/json" hidden>
    </div>`;
  footer.innerHTML = '<span class="df-load-mgr__foot-hint">Files load into a new tab.</span>';
  const zone = pane.querySelector('.df-load-file');
  const input = pane.querySelector('.df-load-file__input');
  const onFiles = async (files) => {
    const f = files && files[0];
    if (!f) return;
    let text;
    try { text = await f.text(); } catch { showError('Could not read that file.'); return; }
    close();   // close first; loadJSONText handles single/bundle/templates (a bundle reopens the Browser tab with a summary)
    await modules.persistence.loadJSONText(text, f.name.replace(/\.(dgf|json)$/i, ''));
  };
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => onFiles(input.files));
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('is-drag'); }));
  ['dragleave', 'dragend'].forEach(ev => zone.addEventListener(ev, () => zone.classList.remove('is-drag')));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('is-drag'); onFiles(e.dataTransfer?.files); });
}

// --- Load Manager: Paste pane (auto-detect Diagramforce JSON vs Mermaid) ---
function renderPasteLoadPane({ pane, footer, close }) {
  pane.innerHTML = `
    <div class="df-paste-modal">
      <p style="margin:0 0 var(--spacing-sm);color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">Paste Diagramforce JSON or Mermaid code - the format is detected automatically:</p>
      <textarea class="df-paste-modal__input" spellcheck="false" rows="9"
        placeholder='{ "diagramType": "architecture", "graph": { "cells": [ ... ] } }&#10;&#10;OR&#10;&#10;flowchart TD&#10;  A[Start] --> B[Decision]'
        style="width:100%;box-sizing:border-box;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;padding:8px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-panel);color:var(--text-primary);resize:vertical"></textarea>
      <p class="df-paste-modal__status" style="margin:var(--spacing-sm) 0 0;min-height:1.4em;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5"></p>
      <div class="df-paste-modal__formats">
        <div class="df-paste-modal__fmt" data-fmt="json">
          <div class="df-paste-modal__fmt-title">Diagramforce JSON</div>
          <div class="df-paste-modal__fmt-sub">A diagram exported via <strong>Save → Export to JSON</strong>, or generated with the <a href="https://github.com/MateuszDabrowski/diagramforce/blob/main/DIAGRAM_JSON_SPEC.md" target="_blank" rel="noopener" class="df-paste-modal__fmt-anchor">Diagramforce LLM Spec</a>.</div>
          <div class="df-paste-modal__fmt-detected" aria-live="polite"></div>
        </div>
        <div class="df-paste-modal__fmt" data-fmt="mermaid">
          <div class="df-paste-modal__fmt-title">Mermaid <span class="df-badge df-badge--beta">Beta</span></div>
          <ul class="df-paste-modal__fmt-list">
            <li data-mtype="flowchart" data-label="flowchart">flowchart</li><li data-mtype="graph" data-label="graph">graph</li><li data-mtype="state" data-label="stateDiagram">stateDiagram</li><li data-mtype="er" data-label="erDiagram">erDiagram</li><li data-mtype="sequence" data-label="sequenceDiagram">sequenceDiagram</li>
          </ul>
        </div>
      </div>
    </div>`;
  footer.innerHTML = '<button class="df-modal__btn df-modal__btn--accent df-paste-modal__load" style="margin-left:auto" disabled>Load</button>';
  const input = pane.querySelector('.df-paste-modal__input');
  const status = pane.querySelector('.df-paste-modal__status');
  const loadBtn = footer.querySelector('.df-paste-modal__load');
  const fmtCols = pane.querySelectorAll('.df-paste-modal__fmt');
  const jsonCol = pane.querySelector('.df-paste-modal__fmt[data-fmt="json"]');
  const mtypeEls = pane.querySelectorAll('.df-paste-modal__fmt-list [data-mtype]');
  const errColor = 'var(--color-error, #ba0517)';
  let mode = null;

  const jsonDetected = jsonCol?.querySelector('.df-paste-modal__fmt-detected');
  const resetHighlight = () => {
    fmtCols.forEach(c => c.classList.remove('is-on', 'is-err'));
    mtypeEls.forEach(li => { li.classList.remove('is-on'); li.textContent = li.dataset.label; });
    if (jsonDetected) jsonDetected.textContent = '';
  };
  const detect = (raw) => {
    const t = raw.trim();
    if (!t) return { kind: 'empty' };
    if (t[0] === '{' || t[0] === '[') {
      const d = modules.persistence.describePastedJSON(t);
      return d.ok ? { kind: 'json', rawType: d.rawType, diagramType: d.diagramType } : { kind: 'error', error: d.error };
    }
    const v = modules.mermaidImport.validateMermaid(t);
    if (v.ok) return { kind: 'mermaid', mtype: v.type };
    return { kind: 'error', error: 'Not recognised as Diagramforce JSON or a supported Mermaid diagram.' };
  };
  const validate = () => {
    resetHighlight();
    const d = detect(input.value);
    if (d.kind === 'empty') { mode = null; loadBtn.disabled = true; status.textContent = ''; return; }
    if (d.kind === 'error') { mode = null; loadBtn.disabled = true; status.style.color = errColor; status.textContent = d.error; fmtCols.forEach(c => c.classList.add('is-err')); return; }
    mode = d.kind;
    loadBtn.disabled = false;
    status.textContent = '';
    if (d.kind === 'json') {
      jsonCol?.classList.add('is-on');
      // Showcase what the paste will become: "<diagramType from JSON> → <friendly Diagram Type>" in brand green.
      if (jsonDetected && d.rawType) jsonDetected.innerHTML = `<code>${escHtml(d.rawType)}</code> → ${escHtml(typeLabelFor(d.diagramType))}`;
      return;
    }
    const li = [...mtypeEls].find(el => el.dataset.mtype === d.mtype);
    if (li) { li.classList.add('is-on'); li.textContent = `${li.dataset.label} → ${MERMAID_INFO[d.mtype]?.target || 'diagram'}`; }
  };
  input.addEventListener('input', validate);
  loadBtn.addEventListener('click', async () => {
    let ok = false;
    if (mode === 'json') ok = await modules.persistence.loadJSONText(input.value, 'Pasted');
    else if (mode === 'mermaid') ok = modules.mermaidImport.importMermaidText(input.value);
    if (ok) close();
  });
  setTimeout(() => input.focus(), 50);
}

/** After loading a browser named-save, tag the now-active tab so the Save Manager "In Browser" chip lights up. */
function tagActiveBrowserSave(name) {
  const active = (modules.tabs.getAllTabs() || []).find(t => t.isActive);
  if (active && name) modules.tabs.setTabBrowserSaveName(active.id, name);
}

/**
 * Build a unique save name: "Name YYYYMMDD", or "Name 2 YYYYMMDD" etc.
 * If the base name already ends with the date suffix, don't double it —
 * instead insert an autonumber before the date: "Name 2 YYYYMMDD".
 */
function uniqueSaveName(baseName, dateSuffix, existingNames) {
  // Strip trailing date if it already matches today's suffix
  let stem = baseName;
  if (stem.endsWith(` ${dateSuffix}`)) {
    stem = stem.slice(0, -(dateSuffix.length + 1));
  }
  // Also strip any existing autonumber before a date suffix: "Name 2 20260406" -> "Name"
  const autoNumDateRe = new RegExp(` \\d+ ${dateSuffix}$`);
  if (autoNumDateRe.test(stem)) {
    stem = stem.replace(autoNumDateRe, '');
  }

  // Try "Name YYYYMMDD" first
  let candidate = `${stem} ${dateSuffix}`;
  if (!existingNames.has(candidate)) return candidate;

  // Try "Name 2 YYYYMMDD", "Name 3 YYYYMMDD", etc.
  for (let n = 2; ; n++) {
    candidate = `${stem} ${n} ${dateSuffix}`;
    if (!existingNames.has(candidate)) return candidate;
  }
}

// --- Save Modal ---

function showSaveModal() {
  // Remove existing save modal if any
  document.querySelector('.df-save-modal')?.remove();

  const allTabs = modules.tabs.getAllTabs();
  // ISO-style YYYY-MM-DD suffix (e.g. "Draft 2026-05-30") — readable, and
  // matches the export filename date format. uniqueSaveName's strip/regex logic
  // treats the hyphens literally, so it stays collision-safe.
  const dateSuffix = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  // Collect existing save names to avoid duplicates
  const existingSaves = new Set(modules.persistence.getNamedSaves().map(s => s.name));

  const saveTypeLabel = (type) => (modules.tabs.DIAGRAM_TYPES?.[type]?.short) || 'Architecture';
  const groupById = new Map((modules.tabs.getGroups?.() || []).map(g => [g.id, g]));
  const tabRows = allTabs.map(tab => {
    const defaultName = uniqueSaveName(tab.name, dateSuffix, existingSaves);
    existingSaves.add(defaultName);   // so two same-named tabs don't both default to one name (would clobber)
    const rel = formatRelativeTime(tab.lastModifiedAt || tab.lastSavedAt);
    const groupBadge = modules.tabs.groupBadgeHtml?.(tab.groupId ? groupById.get(tab.groupId) : null) || '';
    return `
      <div class="df-modal__row${tab.isActive ? ' df-modal__row--active' : ''}">
        <input type="checkbox" class="df-modal__row-check" data-tab-id="${tab.id}" ${tab.isActive ? 'checked' : ''}>
        <span class="df-modal__row-icon">${getDiagramTypeIcon(tab.diagramType)}</span>
        <div class="df-modal__row-info df-save-modal__row-info">
          <input type="text" class="df-modal__row-name" data-tab-id="${tab.id}" value="${escHtml(defaultName)}" spellcheck="false">
          ${rel ? `<span class="df-modal__row-meta">Modified ${rel}</span>` : ''}
        </div>
        ${groupBadge}
        <span class="df-modal__row-badge">${escHtml(saveTypeLabel(tab.diagramType))}</span>
      </div>`;
  }).join('');

  const { overlay, body: bodyEl, footer, close } = buildModal({
    title: 'Save open diagrams',
    className: 'df-save-modal',
    dialogClass: 'df-save-modal__dialog', // 520px
    bodyClass: 'df-modal__row-list',
    bodyHtml: `
      <p class="df-modal__advisory">Browsers may periodically clear this list. For permanent storage, <button type="button" class="df-modal__advisory-link">back up to JSON</button> from Save &amp; Export.</p>
      <div class="df-modal__list-box">
        <div class="df-modal__list-header">
          <label class="df-modal__select-all"><input type="checkbox" class="df-modal__check-all"> Select all</label>
          ${groupSelectHtml(modules.tabs.getGroups?.() || [])}
        </div>
        ${tabRows}
      </div>`,
    footerHtml: '<button class="df-modal__btn df-modal__btn--primary df-modal__action-btn" style="margin-left:auto">Save Selected</button>',
  });

  // Advisory CTA — close this overlay, then open Save & Export (where the full-backup affordance now lives).
  bodyEl.querySelector('.df-modal__advisory-link')?.addEventListener('click', () => {
    close();
    showSaveManagerModal();
  });

  const updateSelectAll = wireSelectAll(bodyEl, footer, '.df-modal__row-check', () => {
    const selected = [];
    overlay.querySelectorAll('.df-modal__row-check:checked').forEach(c => {
      const tabId = c.dataset.tabId;
      const nameInput = overlay.querySelector(`.df-modal__row-name[data-tab-id="${tabId}"]`);
      selected.push({ tabId, name: nameInput?.value.trim() || tabId });
    });
    if (selected.length === 0) return;

    // Save each tab individually with its custom name. `writtenThisBatch` guards against two rows resolving to
    // the same name (e.g. the user typed identical names, or two same-named tabs) — the second would otherwise
    // overwrite the first's localStorage key. On collision, uniquify the later one so both diagrams persist.
    const saved = [];
    const writtenThisBatch = new Set();
    for (const { tabId, name: rawName } of selected) {
      const graphJSON = modules.tabs.getTabGraphJSON(tabId);
      const viewport = modules.tabs.getTabViewport(tabId);
      const diagramType = modules.tabs.getTabDiagramType(tabId);
      if (!graphJSON) continue;

      const name = writtenThisBatch.has(rawName) ? uniqueSaveName(rawName, dateSuffix, writtenThisBatch) : rawName;
      const key = 'sfdiag::save::' + name;
      const data = {
        name,
        timestamp: Date.now(),
        version: 1,
        appVersion: modules.persistence.APP_VERSION,
        diagramType,
        graph: graphJSON,
        viewport,
      };
      try {
        localStorage.setItem(key, JSON.stringify(data));
        writtenThisBatch.add(name);
        saved.push({ id: tabId, name });
      } catch (err) {
        showError(`Save failed for "${name}": ${err.message}`);
      }
    }

    // Rename the active tab to its save name (legacy behaviour), then stamp browserSaveName + clear dirty on
    // EVERY saved tab — so their Save Manager "In Browser" chips light up and no inactive tab is left dirty.
    // Use the FINAL written names (post-uniquify), not the raw selection, so the rename/chip match disk.
    const activeTab = allTabs.find(t => t.isActive);
    const activeSaved = saved.find(s => s.id === activeTab?.id);
    if (activeTab && activeSaved?.name) modules.tabs.renameActiveTab(activeSaved.name);
    modules.tabs.markTabsBrowserSaved(saved);

    close();
  });

  // "Select Tab Group" — REPLACES the selection with exactly the chosen group's tabs (or Ungrouped).
  const groupSel = bodyEl.querySelector('.df-group-select');
  if (groupSel) {
    const tabGroup = new Map(allTabs.map(t => [t.id, t.groupId || null]));
    groupSel.addEventListener('change', () => {
      const chosen = groupSel.value;
      if (chosen) bodyEl.querySelectorAll('.df-modal__row-check').forEach((cb) => { cb.checked = tabInGroup(tabGroup.get(cb.dataset.tabId), chosen); });
      groupSel.value = '';
      updateSelectAll();
    });
  }
}

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
const MERMAID_INFO = {
  flowchart: { name: 'flowchart', target: 'Process' },
  graph:     { name: 'graph', target: 'Process' },
  state:     { name: 'state diagram', target: 'Process' },
  er:        { name: 'ER diagram', target: 'Data Model' },
  sequence:  { name: 'sequence diagram', target: 'Sequence' },
};

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
function showSaveManagerModal() {
  const p = modules.persistence;
  // Opening Save & Export commits the active tab first — the same save a tab switch triggers — so the rows,
  // shape counts, "Edited" times and My Drive chips reflect the latest edits (and pending Drive work is flushed).
  // The returned promise resolves once that Drive flush actually writes/creates the file, so the chips can refresh.
  const committed = modules.tabs.commitActiveTab?.();
  document.querySelector('.df-save-manager-modal')?.remove();
  const driveOn = !!p.isDriveConfigured?.();

  const groupById = new Map((modules.tabs.getGroups?.() || []).map(g => [g.id, g]));
  const typeLabel = (type) => (modules.tabs.DIAGRAM_TYPES?.[type]?.short) || 'Architecture';
  // Nodes-only count (links carry source+target; elements don't) → "0 shapes" means a genuinely empty canvas.
  const nodeCount = (id) => countDiagramShapes(modules.tabs.getTabGraphJSON(id)?.cells);

  // Always hide empty (0-shape) diagrams — they're noise on a save surface.
  const tabs = modules.tabs.getAllTabs().map(t => ({ ...t, shapes: nodeCount(t.id) })).filter(t => t.shapes > 0);

  // Storage chips per row — shared driveChipsHtml so the Save Manager + Load Manager read identically. "This
  // browser" is ALWAYS on for an open diagram (auto-kept in the SESSION; not the named Browser Storage shelf,
  // which is written only on close/explicit save). My Drive lights from the LOCAL driveFileId; an async reconcile
  // pass (below) downgrades a stale link so the chip never claims a save that isn't there.
  const chipsFor = (t) => driveChipsHtml(t, { driveOn, onSharedDrive: !!t.driveDriveId, hasMyDriveBackup: !!t.driveHasMyDriveBackup });

  const tabRows = tabs.map(t => {
    // A tab opened from someone else's Shared File carries driveSharedSource. Surface the access level as a pill
    // (item 3.2 - parity with Load -> Drive) and a Clone action (item 3.3 - fork your own My Drive copy).
    const src = t.driveSharedSource;
    // Mode C: a VIEW FORK is the user's own file - no Copy/Collab pill, no Clone (it's already your own copy; the
    // sharedSource is only a refresh pointer). An un-forked shared file / Collab working copy keeps both.
    const shareable = src && src.fileId && !isViewForkTab(t);
    // Item #5: the Copy/Collab pill belongs on the BOTTOM chip row right after the "Shared File" chip (the access
    // type goes WITH the Shared-File state, not up by the title) - sized to that row (sm). Matches Load -> Drive.
    const sharePill = shareable ? sharePillHtml(src.canEdit === true, { sm: true }) : '';
    const groupBadge = (modules.tabs.groupBadgeHtml?.(t.groupId ? groupById.get(t.groupId) : null) || '');
    const rel = formatRelativeTime(t.lastModifiedAt || t.lastSavedAt);
    const exportBtn = `<button class="df-modal__btn df-modal__btn--accent df-save-mgr__export" data-id="${escHtml(t.id)}" title="Export this diagram">Export</button>`;
    const cloneBtn = shareable
      ? `<button class="df-modal__btn df-modal__btn--amber-outline df-save-mgr__clone" data-fileid="${escHtml(src.fileId)}" data-name="${escHtml(t.name)}" title="Save your own copy in My Drive (forks this shared file - your fork is independent)">Clone</button>`
      : '';
    return storageRowHtml({
      active: t.isActive,
      checkbox: `<input type="checkbox" class="df-modal__row-check" data-id="${escHtml(t.id)}" ${t.isActive ? 'checked' : ''}>`,
      diagramType: t.diagramType, typeTitle: typeLabel(t.diagramType), name: t.name,
      groupBadge, count: t.shapes,
      metaLeft: `<span class="df-save-mgr__chips">${chipsFor(t)}${sharePill}</span>`,
      metaRight: rel ? `Edited ${rel}` : '',
      trailing: cloneBtn ? `<div class="df-drive-library__actions">${cloneBtn}${exportBtn}</div>` : exportBtn,
    });
  }).join('');

  const listInner = tabs.length
    ? `<div class="df-modal__list-header"><label class="df-modal__select-all"><input type="checkbox" class="df-modal__check-all"> Select all</label>${groupSelectHtml(modules.tabs.getGroups?.() || [])}</div>${tabRows}`
    : '<p class="df-modal__empty">No diagrams to save yet - add some shapes to a diagram first.</p>';

  // Browser is automatic, so the footer holds only the manual Drive destinations. "Add to Shared Drive" is a
  // blue-wireframe secondary on the LEFT, shown only once Drive is CONNECTED. The primary save reads "Save to My
  // Drive" once connected (you're in, saving to your My Drive) vs "Save to Google Drive" (with the Drive glyph)
  // before connecting (it signs you in first).
  const connected = !!p.isDriveConnected?.();
  const autoSync = connected && !!p.isAutosyncOn?.();   // when on, My Drive saves happen automatically (no button needed)
  const GDRIVE_GLYPH = '<svg class="df-toolbar__icon" aria-hidden="true"><use href="#icon-gdrive"></use></svg>';
  const saveBtnLabel = connected
    ? `${GDRIVE_GLYPH}Save to My Drive`
    : `${GDRIVE_GLYPH}Save to Google Drive`;
  // Footer: LEFT = the blue-WIRE Google Drive actions; RIGHT = "Export Selected", the orange-FILL primary.
  // "Save to My Drive" is HIDDEN when auto-sync is on (Drive saving is automatic then); shown when auto-sync is
  // off / before connecting. "Add to Shared Drive" only when connected. The checkboxes drive them all.
  // (The old "Make offline" button was removed: open tabs already auto-save to the browser session + auto-archive
  // on close, and a Drive-evicted copy is recovered by reopening it from Load & Import → Google Drive.)
  const footerHtml = `
      ${driveOn && !autoSync ? `<button class="df-modal__btn df-save-mgr__drivebtn df-drive-save__save" disabled>${saveBtnLabel}</button>` : ''}
      ${driveOn && connected ? '<button class="df-modal__btn df-modal__btn--amber-outline df-save-mgr__shared" disabled><svg class="df-toolbar__icon" aria-hidden="true"><use href="#icon-gdrive"></use></svg>Add to Shared Drive</button>' : ''}
      <button class="df-modal__btn df-modal__btn--accent df-save-mgr__export-sel" style="margin-left:auto" disabled>Export Selected</button>`;

  const { overlay, footer, close } = buildModal({
    title: 'Save & Export',
    className: 'df-save-manager-modal',
    origin: document.getElementById('btn-save'),   // scale-open from the Save button
    anchor: document.getElementById('btn-save'),   // anchored under the Save button (item 5)
    dialogClass: 'df-save-mgr__dialog', // 600px (wider — room for the per-row Export action)
    bodyClass: 'df-modal__row-list',
    footerClass: 'df-save-mgr__footer',
    bodyHtml: `
      <p class="df-drive-save-modal__hint">Every open diagram is auto-saved to this browser${driveOn && autoSync ? ' and your <strong>Google Drive</strong>' : ''}.${driveOn ? (connected ? ` ${autoSync ? 'Add any to a team <strong>Shared Drive</strong>' : 'Save any to your <strong>Google Drive</strong> or a <strong>Shared Drive</strong>'}, or export a diagram from its row.` : ' Save any to your <strong>Google Drive</strong>, or export a diagram from its row.') : ' Export a diagram from its row.'}</p>
      <div class="df-modal__advisory df-save-mgr__backup">
        <span class="df-save-mgr__backup-text"></span>
        <button class="df-modal__btn df-save-mgr__backup-now">Back up now</button>
      </div>
      <div class="df-modal__list-box">${listInner}</div>`,
    footerHtml,
  });

  // Full-backup affordance (moved here from the retired Export-to-JSON overlay). "Back up now" exports EVERYTHING
  // (open tabs + browser saves + templates) into one JSON FILE downloaded to this device, and resets the
  // backup-reminder clock. The advisory is explicit that this is a downloaded JSON file SEPARATE from Google
  // Drive sync - otherwise a Drive-synced user is puzzled why it says "no backup" while their work is in Drive.
  const fmtBackupAdvisory = () => {
    const lb = modules.persistence.getLastBackupAt();
    return lb
      ? `Last JSON backup to this device: ${new Date(lb).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}.`
      : 'No JSON backup yet. Back up now saves everything as one JSON file on this device, separate from Drive sync.';
  };
  const backupText = overlay.querySelector('.df-save-mgr__backup-text');
  if (backupText) backupText.textContent = fmtBackupAdvisory(); // textContent — safe
  const backupNowBtn = overlay.querySelector('.df-save-mgr__backup-now');
  let backupRevertTimer = null;
  backupNowBtn?.addEventListener('click', () => {
    if (!modules.persistence.exportEverything()) return;
    if (backupText) backupText.textContent = fmtBackupAdvisory();
    backupNowBtn.classList.add('is-backed');
    backupNowBtn.textContent = '✓ Backed up!';
    clearTimeout(backupRevertTimer);
    backupRevertTimer = setTimeout(() => {
      backupNowBtn.classList.remove('is-backed');
      backupNowBtn.textContent = 'Back up now';
    }, 2000);
  });

  const checks = () => [...overlay.querySelectorAll('.df-modal__row-check')];
  const selectedIds = () => checks().filter(c => c.checked).map(c => c.dataset.id);
  const btnSave = footer?.querySelector('.df-drive-save__save');
  const btnShared = footer?.querySelector('.df-save-mgr__shared');
  const btnExportSel = footer?.querySelector('.df-save-mgr__export-sel');
  const actionBtns = [btnSave, btnShared, btnExportSel].filter(Boolean);
  const checkAll = overlay.querySelector('.df-modal__check-all');
  const refresh = () => {
    const cs = checks();
    const any = cs.some(c => c.checked);
    const all = cs.length > 0 && cs.every(c => c.checked);
    if (checkAll) { checkAll.checked = all; checkAll.indeterminate = !all && any; }   // tri-state, incl. the initial pass
    actionBtns.forEach(b => { b.disabled = !any; });
  };
  checkAll?.addEventListener('change', (e) => { checks().forEach(c => { c.checked = e.target.checked; }); refresh(); });
  checks().forEach(c => c.addEventListener('change', refresh));
  // "Select Tab Group" — REPLACES the selection: checks ONLY the rows whose tab is in the chosen group (or
  // Ungrouped) and unchecks everything else, so picking a group is "select exactly this group".
  const groupSel = overlay.querySelector('.df-group-select');
  if (groupSel) {
    const tabGroup = new Map(tabs.map((t) => [t.id, t.groupId || null]));
    groupSel.addEventListener('change', () => {
      const chosen = groupSel.value;
      if (chosen) checks().forEach((cb) => { cb.checked = tabInGroup(tabGroup.get(cb.dataset.id), chosen); });
      groupSel.value = '';
      refresh();
    });
  }
  refresh();

  // My Drive chip honesty: the chip renders synchronously from the LOCAL driveFileId so the modal opens
  // instantly, but that pointer can be stale (file trashed, or a link from a prior OAuth grant) OR not yet set
  // (the active tab's file is being created right now by commitActiveTab's flush). Re-read the live tabs and
  // re-render each row's My Drive chip whenever async Drive work settles, so the chip never lags an open.
  const refreshMyDriveChips = () => {
    const live = new Map((modules.tabs.getAllTabs?.() || []).map((t) => [t.id, t]));
    overlay.querySelectorAll('.df-modal__row-check').forEach((cb) => {
      const t = live.get(cb.dataset.id);
      const chipEl = cb.closest('.df-srow')?.querySelector('.df-save-mgr__chip--mydrive');
      if (!t || !chipEl) return;
      if (t.driveDriveId && !t.driveHasMyDriveBackup) {
        // The reconcile just HEALED this tab to a Shared-Drive file with no My-Drive backup yet (item 5): repurpose
        // the My-Drive slot as the "Shared Drive" chip in place, so the OPEN Save Manager flips on the same pass.
        // (Once a backup exists the full render shows a real "My Drive" + a separate "Shared Drive" chip.)
        chipEl.classList.remove('df-save-mgr__chip--mydrive');
        chipEl.classList.add('df-save-mgr__chip--shared', 'is-on');
        chipEl.title = 'Lives on a team Shared Drive - everyone with access edits the same file (edits flow both ways)';
        chipEl.innerHTML = shareChipIconHtml('both') + 'Shared Drive';
        return;
      }
      // My Drive on for an own master OR a Shared-Drive file mirrored into My Drive (the backup).
      const on = (!!t.driveFileId && !t.driveDriveId) || !!t.driveHasMyDriveBackup;
      chipEl.classList.toggle('is-on', on);
      chipEl.title = on ? 'Saved as a file you own in My Drive' : 'Not saved to My Drive yet';
      chipEl.innerHTML = (on ? DRIVE_CHIP_CHECK : '') + 'My Drive';
    });
  };
  if (driveOn && connected) {
    // (a) The active tab's commit-on-open flush may CREATE/update its file after the rows rendered → refresh once
    //     it settles so its "My Drive" chip turns on immediately (the "grey on first open, green on second" lag).
    if (committed && typeof committed.then === 'function') committed.then(refreshMyDriveChips).catch(() => {});
    // (b) reconcile against the live library: ADOPT same-named files for null/stale pointers + downgrade rows the
    //     user no longer owns, so a ✓ My Drive always matches "Your Google Drive Diagrams".
    if (p.reconcileTabDriveLinks) p.reconcileTabDriveLinks().then(refreshMyDriveChips).catch(() => { /* offline → keep optimistic chips */ });
  }

  // Save to Drive — each selected becomes a master file in My Drive.
  btnSave?.addEventListener('click', async () => {
    const ids = selectedIds(); if (!ids.length) return;
    btnSave.disabled = true; btnSave.textContent = 'Saving…';
    try {
      const results = await p.saveTabsToDrive(ids);
      const ok = results.filter(r => r.status === 'ok').length;
      const failed = results.filter(r => r.status === 'error');
      if (ok) showToast(`Saved ${ok} diagram${ok === 1 ? '' : 's'} to Google Drive ✓`, 'success');
      if (failed.length) { console.error('Diagramforce: Drive save failures:', failed); showError(`${failed.length} diagram${failed.length === 1 ? '' : 's'} could not be saved - see console.`); }
      close();
    } catch (e) { btnSave.disabled = false; btnSave.innerHTML = saveBtnLabel; showError('Could not save to Google Drive: ' + (e.message || 'unknown error')); }
  });

  // Add to Shared Drive — pick ONE folder, publish a copy of each selected diagram into it. (Icon + label, so
  // we disable rather than swap text, to avoid wiping the inline Drive icon.)
  btnShared?.addEventListener('click', async () => {
    const ids = selectedIds(); if (!ids.length) return;
    btnShared.disabled = true;
    try { if (await p.publishTabsToSharedDrive?.(ids)) close(); else btnShared.disabled = false; }
    catch (e) { btnShared.disabled = false; showError('Could not add to Shared Drive: ' + (e.message || 'unknown error')); }
  });

  // Export Selected — the checked diagrams as JSON (1 → single file, 2+ → a `diagramforce-export` bundle). Same
  // checkboxes that drive the Drive actions, so one selection serves every destination.
  btnExportSel?.addEventListener('click', () => {
    const ids = selectedIds(); if (!ids.length) return;
    const selTabs = ids.map((id) => tabs.find((t) => t.id === id)).filter(Boolean);
    openSelectedExportMenu(btnExportSel, selTabs);   // item 13: same format menu as a single Export
  });

  // (The "templates & backups" link to the Export Manager was removed from the Save Manager hint - it opened a
  // near-identical overlay; the Export Manager stays reachable from the Load Manager's Browser tab advisory.)

  // Per-row Export — a popover listing the formats directly (image formats inline, no separate overlay). JSON
  // exports from the stored graph (any tab); image + CSV need the live canvas, so they switch to that tab first
  // (closing the manager). While a flow animates on the active diagram, only GIF captures it (static formats are
  // hidden, mirroring the old image overlay); a GIF mid-encode hides the image formats entirely.
  const openRowExportMenu = (anchor, t) => {
    document.querySelector('.df-rowexport-pop')?.remove();
    const isData = t.diagramType === 'datamodel' || t.diagramType === 'datamapping';
    const animating = t.isActive && !!document.getElementById('paper')?.classList.contains('df-animate-flow');
    const gifBusy = !!p.isGifEncodingInProgress?.();
    const imageFmts = gifBusy ? []
      : animating
        ? [['gif', 'GIF'], ['gif-t', 'GIF (transparent)']]
        : [['png', 'PNG'], ['png-t', 'PNG (transparent)'], ['webp', 'WEBP'], ['webp-t', 'WEBP (transparent)'], ['svg', 'SVG'], ['svg-t', 'SVG (transparent)']];
    // Format glyph: a rounded rect with the format token inside ({ } for JSON, CSV, PNG/WEBP/SVG/GIF). Filled for
    // opaque outputs; a wire (transparent-fill) rect for the "(transparent)" variants - mirroring the output.
    const fmtGlyph = (fmt) => {
      const wire = fmt.endsWith('-t');
      const txt = fmt === 'json' ? '{ }' : fmt === 'csv' ? 'CSV' : fmt.replace('-t', '').toUpperCase();
      return `<span class="df-fmt-glyph${wire ? ' df-fmt-glyph--wire' : ''}" aria-hidden="true">${txt}</span>`;
    };
    const item = (fmt, label) => `<button class="df-tab-pop__item df-tab-pop__item--fmt" data-fmt="${fmt}">${fmtGlyph(fmt)}<span>Export as ${label}</span></button>`;
    const pop = document.createElement('div');
    pop.className = 'df-tab-pop df-tab-pop--menu df-rowexport-pop';
    pop.innerHTML =
      item('json', 'JSON')
      + (isData ? item('csv', 'CSV') : '')   // CSV sits right below JSON (both data/text formats)
      + (imageFmts.length ? '<div class="df-tab-pop__sep"></div>' + imageFmts.map(([f, l]) => item(f, l)).join('') : '');
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + 'px';
    pop.style.top = Math.max(8, Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 4)) + 'px';   // clamp tall menu into view
    const closePop = () => { pop.remove(); document.removeEventListener('pointerdown', onDoc, true); };
    const onDoc = (e) => { if (!pop.contains(e.target)) closePop(); };
    setTimeout(() => document.addEventListener('pointerdown', onDoc, true), 0);
    const toTabThen = (fn) => { closePop(); close(); if (!t.isActive) modules.tabs.switchTab?.(t.id); requestAnimationFrame(fn); };
    const exportImage = (fmt) => {
      const transparent = fmt.endsWith('-t');
      const base = fmt.replace('-t', '');
      if (base === 'png') p.exportPNG(transparent);
      else if (base === 'webp') p.exportWEBP(transparent);
      else if (base === 'svg') p.exportSVG(transparent);
      else if (base === 'gif') p.exportGIF(transparent);
    };
    pop.querySelectorAll('.df-tab-pop__item').forEach((b) => b.addEventListener('click', () => {
      const fmt = b.dataset.fmt;
      if (fmt === 'json') { closePop(); p.exportSelection({ tabIds: [t.id] }); return; }
      if (fmt === 'csv') { toTabThen(() => { if (t.diagramType === 'datamapping') modules.tableView?.exportMappingCsv?.(); else exportObjectSchemaCsv(modules.graph); }); return; }
      toTabThen(() => exportImage(fmt));   // image formats
    }));
  };
  overlay.querySelectorAll('.df-save-mgr__export').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const t = tabs.find((x) => x.id === b.dataset.id);
    if (t) openRowExportMenu(b, t);
  }));

  // Clone a shared file to My Drive from the Save Manager (item 3.3) - same action as the Load -> Drive row's
  // Clone (cloneSharedToMyDrive forks an independent owned copy). Closes the modal on success.
  overlay.querySelectorAll('.df-save-mgr__clone').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    b.disabled = true;
    try { if (await p.cloneSharedToMyDrive?.(b.dataset.fileid, b.dataset.name)) close(); else b.disabled = false; }
    catch { b.disabled = false; }
  }));

  // Export Selected → the SAME format menu as a single row's Export, but applied to every checked diagram (item
  // 13). JSON makes ONE bundle file (exportSelection); CSV + image formats make ONE FILE PER diagram, exported
  // sequentially because each needs its diagram on the live canvas (switch tab → render → export), spaced so the
  // browser doesn't drop the rapid downloads. GIF is omitted here (it's a per-diagram, mid-encode-locked format).
  const fmtGlyphSel = (fmt) => {
    const wire = fmt.endsWith('-t');
    const txt = fmt === 'json' ? '{ }' : fmt === 'csv' ? 'CSV' : fmt.replace('-t', '').toUpperCase();
    return `<span class="df-fmt-glyph${wire ? ' df-fmt-glyph--wire' : ''}" aria-hidden="true">${txt}</span>`;
  };
  const exportSelectedSequential = async (selTabs, fmt) => {
    const isCsv = fmt === 'csv';
    const targets = isCsv ? selTabs.filter((t) => t.diagramType === 'datamodel' || t.diagramType === 'datamapping') : selTabs;
    if (!targets.length) return;
    if (targets.length > 1) showToast(`Exporting ${targets.length} diagrams - allow multiple downloads if your browser asks.`, 'info');
    for (const t of targets) {
      if (!t.isActive) modules.tabs.switchTab?.(t.id);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));   // let the switched diagram render
      if (isCsv) {
        if (t.diagramType === 'datamapping') modules.tableView?.exportMappingCsv?.(); else exportObjectSchemaCsv(modules.graph);
      } else {
        const transparent = fmt.endsWith('-t'); const base = fmt.replace('-t', '');
        if (base === 'png') p.exportPNG(transparent);
        else if (base === 'webp') p.exportWEBP(transparent);
        else if (base === 'svg') p.exportSVG(transparent);
      }
      await new Promise((res) => setTimeout(res, 350));   // space downloads so the browser keeps them all
    }
  };
  const openSelectedExportMenu = (anchor, selTabs) => {
    if (!selTabs.length) return;
    document.querySelector('.df-rowexport-pop')?.remove();
    const anyData = selTabs.some((t) => t.diagramType === 'datamodel' || t.diagramType === 'datamapping');
    const imageFmts = [['png', 'PNG'], ['png-t', 'PNG (transparent)'], ['webp', 'WEBP'], ['webp-t', 'WEBP (transparent)'], ['svg', 'SVG'], ['svg-t', 'SVG (transparent)']];
    const item = (fmt, label) => `<button class="df-tab-pop__item df-tab-pop__item--fmt" data-fmt="${fmt}">${fmtGlyphSel(fmt)}<span>Export as ${label}</span></button>`;
    const pop = document.createElement('div');
    pop.className = 'df-tab-pop df-tab-pop--menu df-rowexport-pop';
    pop.innerHTML = item('json', 'JSON') + (anyData ? item('csv', 'CSV') : '') + '<div class="df-tab-pop__sep"></div>' + imageFmts.map(([f, l]) => item(f, l)).join('');
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
    pop.style.top = Math.max(8, r.top - pop.offsetHeight - 4) + 'px';   // open ABOVE the footer button
    const closePop = () => { pop.remove(); document.removeEventListener('pointerdown', onDoc, true); };
    const onDoc = (e) => { if (!pop.contains(e.target)) closePop(); };
    setTimeout(() => document.addEventListener('pointerdown', onDoc, true), 0);
    pop.querySelectorAll('.df-tab-pop__item').forEach((b) => b.addEventListener('click', () => {
      const fmt = b.dataset.fmt;
      closePop();
      if (fmt === 'json') { p.exportSelection({ tabIds: selTabs.map((t) => t.id) }); close(); return; }
      close();
      exportSelectedSequential(selTabs, fmt);
    }));
  };
}

// "Your Drive diagrams" — the personal library of the user's own masters in their My-Drive Diagramforce
// folder. List → Open / Delete (trash). Async (network + auth), so it owns its loading/empty/error states.

// Version history for the active synced diagram — list its Drive revisions newest-first with View / Restore
// / Pin. Mirrors the library modal's loading/empty/error scaffold. Restore is non-destructive (the current
// version is pushed into history); the populated list + actions need real Drive (manual test).
function showDriveHistoryModal() {
  const p = modules.persistence;
  if (!p.isDriveConfigured?.()) return;
  document.querySelector('.df-drive-history-modal')?.remove();

  const { body, footer, close } = buildModal({
    title: 'Version history',
    className: 'df-drive-history-modal',
    dialogClass: 'df-save-modal__dialog',   // 520px (shared)
    bodyClass: 'df-modal__row-list',
    bodyHtml: `
      <p class="df-drive-save-modal__hint" style="margin-bottom:6px">Past saves of this diagram in your Google Drive:</p>
      <ul class="df-history__legend">
        <li><strong>Open</strong> opens that version as an editable copy in a new tab - your current diagram stays untouched.</li>
        <li><strong>Restore</strong> brings it back as the current version (your current version stays in this list).</li>
        <li><strong>Pin</strong> keeps a version safe from Drive's automatic cleanup (about 30 days for unpinned ones).</li>
      </ul>
      <p class="df-drive-save-modal__hint" style="margin-top:6px">The most recent version is always kept, whether pinned or not.</p>
      <div class="df-drive-history__body"><p style="padding:18px;text-align:center;color:var(--text-secondary)">Loading…</p></div>`,
    footerHtml: '<button class="df-modal__btn df-modal__btn--primary df-drive-history__done" style="margin-left:auto">Done</button>',
  });
  footer.querySelector('.df-drive-history__done').addEventListener('click', close);
  const bodyBox = body.querySelector('.df-drive-history__body');
  const status = (html) => { bodyBox.innerHTML = `<p style="padding:18px;text-align:center;color:var(--text-secondary)">${html}</p>`; };

  const EYE = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>';
  // Rows reuse the shared two-line storage-row anatomy (storageRowHtml) so version history reads like the
  // Save / Load lists + gets the mobile collapse. The leading icon slot IS the eye preview-toggle (icon
  // override); the element count rides as a nameSuffix after the relative time; size · author is the detail
  // line; Open / Restore / Pin are the trailing actions. The rowwrap + preview-box wrap stays around it.
  const rowHtml = (r, prev) => {
    const pinned = !!r.keepForever;
    // data-prev-rev = the NEXT-older save, so the preview can diff "this save vs the previous" (Phase C, C2c).
    const prevAttr = prev && prev.id ? ` data-prev-rev="${escHtml(prev.id)}"` : '';
    const eye = `<button class="df-history__preview df-history__iconbtn" data-rev="${escHtml(r.id)}"${prevAttr} title="Preview this version" aria-label="Preview this version">${EYE}</button>`;
    const trailing =
      `<button class="df-modal__btn df-modal__btn--accent df-history__open" data-rev="${escHtml(r.id)}">Open</button>` +
      `<button class="df-modal__btn df-modal__btn--amber-outline df-history__restore" data-rev="${escHtml(r.id)}">Restore</button>` +
      `<button class="df-history__pin df-history__iconbtn${pinned ? ' is-pinned' : ''}" data-rev="${escHtml(r.id)}" data-keep="${pinned ? '1' : '0'}" title="${pinned ? 'Unpin (allow auto-cleanup)' : 'Pin (keep safe from auto-cleanup)'}" aria-label="${pinned ? 'Unpin' : 'Pin'}"><svg class="df-toolbar__icon" aria-hidden="true"><use href="#${pinned ? 'pinned' : 'pin'}"></use></svg></button>`;
    const inner = storageRowHtml({
      rowClass: 'df-history__row',
      icon: eye,
      leadingIcon: true,   // item 3: eye centres vertically across both lines; size·author line aligns under the time
      name: formatRelativeTime(Date.parse(r.modifiedTime)) || 'saved',
      nameSuffix: '<span class="df-history__count"></span>',
      metaLeft: `<span class="df-modal__row-meta">${escHtml(r.sizeLabel || '')}${r.by ? ' · ' + escHtml(r.by) : ''}</span>`,
      trailing,
    });
    return `<div class="df-history__rowwrap" data-rev="${escHtml(r.id)}">${inner}<div class="df-history__preview-box" hidden></div></div>`;
  };

  // Eye-preview: fetch THAT revision's content once (read-only, never touches the active diagram) and show a
  // thumbnail + element count inline under the row. Toggles; only one open at a time.
  const togglePreview = async (btn) => {
    const wrap = btn.closest('.df-history__rowwrap');
    const box = wrap.querySelector('.df-history__preview-box');
    const wasOpen = !box.hidden;
    bodyBox.querySelectorAll('.df-history__preview-box').forEach(b => { b.hidden = true; b.innerHTML = ''; });
    bodyBox.querySelectorAll('.df-history__preview').forEach(b => b.classList.remove('is-active'));
    if (wasOpen) return;   // second click → just close
    box.hidden = false;
    btn.classList.add('is-active');
    box.innerHTML = '<span class="df-history__preview-loading">Loading preview…</span>';
    const rev = await p.readRevision?.(btn.dataset.rev);
    if (box.hidden) return;   // user closed/switched while we awaited
    if (!rev || !rev.graph) { box.innerHTML = '<span class="df-history__preview-loading">Could not preview this version.</span>'; return; }
    const cells = rev.graph.cells || [];
    const n = countDiagramShapes(cells);
    // 15.1: the element count lives on the MAIN ROW (after the time, dot-separated), and stays once known even
    // after the preview collapses. 15.2: the diagram type is no longer shown in the preview.
    const countEl = wrap.querySelector('.df-history__count');
    if (countEl) countEl.textContent = ` · ${n} shape${n === 1 ? '' : 's'}`;
    // Phase C (C2c): diff this save against the PREVIOUS one so the preview highlights what changed since then
    // (green = added, amber = changed). Best-effort - a missing/unreadable previous revision just shows the plain
    // thumbnail (the oldest save has no previous, so no highlight, which is correct).
    let diff = null;
    const prevRev = btn.dataset.prevRev;
    if (prevRev) {
      try { const prev = await p.readRevision?.(prevRev); if (!box.hidden && prev && prev.graph) diff = diffGraphs(prev.graph, rev.graph); }
      catch { /* plain thumbnail */ }
    }
    if (box.hidden) return;
    box.innerHTML = '';
    // Item #12: a large preview that FILLS the modal width with a viewport-proportional height, the diagram
    // fit-to-content inside (renderTemplateThumbnail viewBox-fits). Render the mini-paper at ~the displayed box
    // size for a crisp clone (the CSS box is the source of visible size).
    const w = Math.max(280, Math.round(box.clientWidth - 24));   // minus the preview-box L+R padding (2x12)
    const ph = Math.min(Math.round(w * (window.innerHeight / window.innerWidth)), Math.round(window.innerHeight * 0.4));
    // Diff legend - only the keys that actually changed this save (added green / changed amber / removed red ghost).
    const keys = [];
    if (diff && diff.added && diff.added.size) keys.push(['add', 'Added']);
    if (diff && diff.changed && diff.changed.size) keys.push(['chg', 'Changed']);
    if (diff && diff.removedCells && diff.removedCells.length) keys.push(['del', 'Removed']);
    if (keys.length) {
      const legend = document.createElement('div');
      legend.className = 'df-history__preview-legend';
      legend.innerHTML = keys.map(([k, label]) => `<span class="df-diff-key df-diff-key--${k}">${label}</span>`).join('') +
        '<span class="df-history__preview-legend-since">since the previous save</span>';
      box.appendChild(legend);
    }
    const thumb = renderTemplateThumbnail({ cells }, w, ph, diff);
    thumb.classList.add('df-history__preview-thumb');
    box.appendChild(thumb);
  };

  const render = async () => {
    status('Loading…');
    let revs;
    try { revs = await p.listRevisions(); }
    catch {
      bodyBox.innerHTML = `<p style="padding:18px;text-align:center;color:var(--text-secondary)">Could not load version history. <button class="df-modal__btn df-drive-history__retry">Retry</button></p>`;
      bodyBox.querySelector('.df-drive-history__retry')?.addEventListener('click', render);
      return;
    }
    if (!revs.length) { status('No saved versions yet - save this diagram to Google Drive and they appear here.'); return; }
    bodyBox.innerHTML = `<div class="df-modal__list-box">${revs.map((r, i) => rowHtml(r, revs[i + 1])).join('')}</div>`;
    bodyBox.querySelectorAll('.df-history__preview').forEach(btn => btn.addEventListener('click', () => togglePreview(btn)));
    bodyBox.querySelectorAll('.df-history__open').forEach(btn => btn.addEventListener('click', async () => { if (await p.viewRevision(btn.dataset.rev)) close(); }));
    bodyBox.querySelectorAll('.df-history__restore').forEach(btn => btn.addEventListener('click', async () => {
      const ok = await confirmModal({ title: 'Restore this version?', message: 'This brings the selected version back as the current one. Your current version is not lost - it stays in this history list.', okLabel: 'Restore', cancelLabel: 'Cancel' });
      if (ok && await p.restoreRevision(btn.dataset.rev)) close();
    }));
    bodyBox.querySelectorAll('.df-history__pin').forEach(btn => btn.addEventListener('click', async () => {
      if (await p.pinRevision(btn.dataset.rev, btn.dataset.keep !== '1')) render();
    }));

    // Item 4: show the shape count on OPEN (not only after an eye-preview). Drive revision metadata carries NO
    // shape count, so we read each revision's content in the BACKGROUND - capped to the most recent dozen and 3
    // at a time, so a long history doesn't hammer Drive - and fill the per-row count as it arrives. Best-effort:
    // a failed/slow read just leaves that row count-less until its eye-preview fills it. `render()` re-runs reset
    // it, so a stale token guards against filling a torn-down list.
    const myRevs = revs.slice(0, 12);
    let qi = 0;
    const fillWorker = async () => {
      while (qi < myRevs.length) {
        const r = myRevs[qi++];
        let rev; try { rev = await p.readRevision?.(r.id); } catch { continue; }
        const el = bodyBox.querySelector(`.df-history__rowwrap[data-rev="${CSS.escape(r.id)}"] .df-history__count`);
        if (el && !el.textContent && rev?.graph?.cells) { const n = countDiagramShapes(rev.graph.cells); el.textContent = ` · ${n} shape${n === 1 ? '' : 's'}`; }
      }
    };
    Promise.all([fillWorker(), fillWorker(), fillWorker()]).catch(() => {});
  };
  render();
}
// --- Shared modal helpers ---

/** Wire up select-all checkbox + action button for any modal with row checkboxes.
 *  The check-all can live in the list header (top) or the footer; the action
 *  button is in the footer. */
function wireSelectAll(bodyEl, footerEl, checkSelector, onAction) {
  const checkAll = bodyEl.querySelector('.df-modal__check-all') || footerEl.querySelector('.df-modal__check-all');
  const actionBtn = footerEl.querySelector('.df-modal__action-btn');

  function update() {
    const checks = bodyEl.querySelectorAll(checkSelector);
    const anyChecked = [...checks].some(c => c.checked);
    const allChecked = checks.length > 0 && [...checks].every(c => c.checked);
    actionBtn.disabled = !anyChecked;
    checkAll.checked = allChecked;
    checkAll.indeterminate = anyChecked && !allChecked;
  }

  checkAll.addEventListener('change', () => {
    bodyEl.querySelectorAll(checkSelector).forEach(c => { c.checked = checkAll.checked; });
    update();
  });

  bodyEl.addEventListener('change', (e) => {
    if (e.target.matches(checkSelector)) update();
  });

  actionBtn.addEventListener('click', onAction);
  update();
  return update;   // let callers re-sync after programmatically checking rows (e.g. "Select all in group")
}

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

function buildLoadItem(save) {
  // Same shared two-line storage row as the Save Manager. Browser saves carry no group, so no group badge.
  // Trailing = per-row Load (deletion lives in Close & Delete now - item 6.4, no per-row trash here).
  const tmp = document.createElement('template');
  const rel = formatRelativeTime(save.timestamp) || 'just now';
  // Same chip builder as every other view so a closed archive reads identically (item 6): "This browser" +
  // "My Drive" (if archived with a driveFileId) + "Shared File" (amber, with the check, and its tooltip reflects
  // the Copy/Collaborate access stored in driveSharedSource.canEdit at open time - item 1). Force the Drive chips
  // on whenever this archive HAS Drive provenance, even if Drive is currently disconnected.
  const driveOn = !!modules.persistence.isDriveConfigured?.() || !!(save.driveFileId || save.driveSharedSource?.fileId);
  // 6.2: Expires before the (Last Modified) edited time, grouped on the right; storage chips stay on the left.
  const ssrc = save.driveSharedSource;
  const savePill = (ssrc && ssrc.fileId && !isViewForkTab(save)) ? sharePillHtml(ssrc.canEdit, { sm: true }) : '';   // bug #4: the Copy/Collab pill was missing on Load -> Browser archive rows
  tmp.innerHTML = storageRowHtml({
    checkbox: `<input type="checkbox" class="df-modal__row-check" data-save-key="${escHtml(save.key)}" data-save-name="${escHtml(save.name)}">`,
    diagramType: save.diagramType, typeTitle: typeLabelFor(save.diagramType), name: save.name, count: save.shapes,
    metaLeft: `<span class="df-save-mgr__chips">${driveChipsHtml(save, { driveOn, sharedFile: !!(save.driveSharedSource && save.driveSharedSource.fileId), onSharedDrive: !!save.driveDriveId })}${savePill}</span>`,
    metaRight: `${escHtml(expiryLabel(save))} · Last Modified ${escHtml(rel)}`,
    trailing: `<button class="df-modal__btn df-modal__btn--accent df-load__row-load">Load</button>`,
  }).trim();
  const item = tmp.content.firstElementChild;

  item.querySelector('.df-load__row-load').addEventListener('click', async () => {
    if (await modules.persistence.loadNamedSave(save.key)) {
      tagActiveBrowserSave(save.name);   // light up the Save Manager "In Browser" chip on the loaded tab
      hideLoadModal();
    }
  });
  return item;
}

/** The "expires in N days" chip text for a browser save (kept on the unified Load row, item #2). */
function expiryLabel(save) {
  const daysLeft = Math.ceil(save.expiresIn / (24 * 60 * 60 * 1000));
  return `expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
}
/** Short diagram-type label for a row icon's tooltip (shared by the Load rows). */
function typeLabelFor(type) { return (modules.tabs.DIAGRAM_TYPES?.[type]?.short) || 'Architecture'; }

// ── Diagram | Table view switch (Data Mapping) ──────────────────────────────
function setViewMode(mode) {
  const diag = document.getElementById('btn-view-diagram');
  const tab = document.getElementById('btn-view-table');
  const isTable = mode === 'table';
  const wasTable = !!modules.tableView?.isActive?.();
  if (isTable) modules.tableView?.show?.(); else modules.tableView?.hide?.();
  // Auto-hide the side panels in Table mode (the table wants the full width); restore the
  // stencil on the way back to Diagram (or any tab change away from Table). Act only on a
  // real transition so repeated diagram-mode calls don't clobber a manually-closed stencil.
  if (isTable && !wasTable) {
    _stencilWasOpenBeforeTable = modules.stencil ? !modules.stencil.isHidden() : false;
    modules.stencil?.hide?.();
    modules.selection?.clearSelection?.();   // hides the properties inspector
  } else if (!isTable && wasTable && _stencilWasOpenBeforeTable) {
    modules.stencil?.show?.();
  }
  diag?.classList.toggle('df-toolbar__segmented-option--active', !isTable);
  diag?.setAttribute('aria-checked', String(!isTable));
  tab?.classList.toggle('df-toolbar__segmented-option--active', isTable);
  tab?.setAttribute('aria-checked', String(isTable));
  // Keep the mobile hamburger's toggle label in sync with the current view.
  const hmbLabel = document.getElementById('hmb-view-toggle-label');
  if (hmbLabel) hmbLabel.textContent = isTable ? 'View as Diagram' : 'View as Table';
}

function updateDisplayMenuVisibility() {
  const dd = document.getElementById('display-dropdown');
  if (!dd || !modules.tabs) return;
  const type = modules.tabs.getActiveTabType();

  const isGantt = type === 'gantt';
  const isDataModel = type === 'datamodel';
  const isDataMapping = type === 'datamapping';
  const isDataObjectType = isDataModel || isDataMapping; // both use sf.DataObject
  const isSequence = type === 'sequence';

  // Diagram | Table view switch — shown for Data Mapping (lineage), Data Model (schema) and Gantt
  // (plan). Use inline display (not the `hidden` attr): `.df-toolbar__group { display:flex }`
  // outranks `[hidden]`, so the attribute alone wouldn't hide it. Reset to the Diagram view on any
  // tab change so the table never lingers showing another tab's data.
  const vsGroup = document.getElementById('view-switch-group');
  const vsSep = document.getElementById('view-switch-sep');
  const hasTable = isDataObjectType || isGantt;   // Data Mapping (lineage) + Data Model (schema) + Gantt (plan)
  if (vsGroup) vsGroup.style.display = hasTable ? '' : 'none';
  if (vsSep) vsSep.style.display = hasTable ? '' : 'none';
  if (modules.tableView?.isActive?.()) setViewMode('diagram');

  // Map bridge button — shown only for Data Model (clones it into a new Data Mapping
  // diagram). Sits in the same toolbar slot as the view switch; same inline-display rule.
  const mapGroup = document.getElementById('map-bridge-group');
  const mapSep = document.getElementById('map-bridge-sep');
  if (mapGroup) mapGroup.style.display = isDataModel ? '' : 'none';
  if (mapSep) mapSep.style.display = isDataModel ? '' : 'none';

  // Mirror the view-switch + map-bridge availability into the mobile hamburger.
  // The desktop toolbar groups live in .df-toolbar__left, which is hidden on mobile,
  // so without these the Table view + Map bridge were unreachable on a phone.
  const hmbView = document.getElementById('hmb-view-toggle');
  // Mirror the desktop gate (hasTable above): Data Mapping + Data Model + Gantt all have a Table view.
  // Data Model was omitted here, so on mobile its Table switch was unreachable (the desktop control is
  // CSS-hidden on narrow viewports, leaving the hamburger as the only path).
  if (hmbView) hmbView.style.display = (isDataObjectType || isGantt) ? '' : 'none';
  const hmbMap = document.getElementById('hmb-map');
  if (hmbMap) hmbMap.style.display = isDataModel ? '' : 'none';

  // Show/hide Gantt-specific options
  const ganttSep = document.getElementById('display-gantt-separator');
  const ganttAssignee = document.getElementById('btn-gantt-assignee');
  const ganttProgress = document.getElementById('btn-gantt-progress');
  const ganttWeekStart = document.getElementById('btn-gantt-week-start');
  const ganttWeekendStart = document.getElementById('btn-gantt-weekend-start');
  const ganttProjectSummary = document.getElementById('btn-gantt-project-summary');
  // Hide gantt separator always — auto-layout buttons (above) and gantt options are mutually exclusive
  if (ganttSep) ganttSep.style.display = 'none';
  if (ganttAssignee) ganttAssignee.style.display = isGantt ? '' : 'none';
  if (ganttProgress) ganttProgress.style.display = isGantt ? '' : 'none';
  if (ganttWeekStart) ganttWeekStart.style.display = isGantt ? '' : 'none';
  if (ganttWeekendStart) ganttWeekendStart.style.display = isGantt ? '' : 'none';
  if (ganttProjectSummary) ganttProjectSummary.style.display = isGantt ? '' : 'none';

  // The four "canvas-behaviour" toggles at the top (Auto-Fit Containers, Distributed
  // Connectors, Crossing Bumps, Focus Dimming) are meaningless for a Gantt chart — it
  // has no links to group/bump/dim, and auto-fit fights the timeline's own sizing and
  // visibly breaks it. Hide them (+ their separator) on Gantt. They stay global per-
  // browser prefs untouched for other types; auto-fit is additionally made inert for
  // the timeline at the source (embedding.js skips sf.GanttTimeline).
  ['btn-display-auto-size', 'btn-display-connector-grouping', 'btn-display-crossing-bumps', 'btn-display-focus-dimming']
    .forEach(id => { const b = document.getElementById(id); if (b) b.style.display = isGantt ? 'none' : ''; });
  const autoSizeSep = document.getElementById('display-auto-size-separator');
  if (autoSizeSep) autoSizeSep.style.display = isGantt ? 'none' : '';

  // Hide auto-layout buttons for Gantt (timeline-driven) and Sequence
  // (positions are meaningful along the lifeline axes).
  const hideAutoLayout = isGantt || isSequence;
  const autoH = document.getElementById('btn-auto-layout-h');
  const autoV = document.getElementById('btn-auto-layout-v');
  if (autoH) autoH.style.display = hideAutoLayout ? 'none' : '';
  // Data Mapping flows left→right across layers, so only horizontal layout applies:
  // hide the vertical option and drop the "Horizontal" qualifier from the label.
  if (autoV) autoV.style.display = (hideAutoLayout || isDataMapping) ? 'none' : '';
  const hLabel = document.getElementById('auto-layout-h-label');
  if (hLabel) hLabel.textContent = isDataMapping ? 'Auto Layout' : 'Horizontal Auto Layout';

  // DataObject display options — shown for both Data Model and Data Mapping tabs
  // (both use sf.DataObject). Mapping is its own diagram type now, so there's no
  // per-diagram mapping-mode toggle here.
  const apiBtn = document.getElementById('btn-display-api');
  const lenBtn = document.getElementById('btn-display-lengths');
  const keysBtn = document.getElementById('btn-display-keys-only');
  const dmSep = document.getElementById('display-dm-separator');
  if (apiBtn) apiBtn.style.display = isDataObjectType ? '' : 'none';
  if (lenBtn) lenBtn.style.display = isDataObjectType ? '' : 'none';
  if (keysBtn) keysBtn.style.display = isDataObjectType ? '' : 'none';
  const collapseBtn = document.getElementById('btn-display-collapse');
  if (collapseBtn) collapseBtn.style.display = isDataObjectType ? '' : 'none';
  // In a Data Mapping diagram the key-fields toggle filters to MAPPED fields.
  const koLabel = document.getElementById('keys-only-label');
  if (koLabel) koLabel.textContent = isDataMapping ? 'Mapped Fields Only' : 'Key Fields Only';
  // ALWAYS shown — this separator divides the unchecked toggle group (the DataObject
  // field toggles when present, always ending with Animate Connectors below) from the
  // Auto Layout actions / type-specific options beneath it, in EVERY diagram type.
  if (dmSep) dmSep.style.display = '';

  // Object Relationships toggle — Data Mapping only. It's a view-only filter, so reset
  // it to visible (default ON) on each tab change and reflect that in the checkmark.
  // (updateDisplayMenuVisibility only runs on tab change / init, never on menu open.)
  const relsBtn = document.getElementById('btn-display-object-rels');
  if (relsBtn) {
    relsBtn.style.display = isDataMapping ? '' : 'none';
    if (isDataMapping) {
      modules.canvas?.setObjectRelationshipsVisible?.(true);
      relsBtn.classList.add('is-checked');
    }
  }

  // Sequence-specific toggles — diagram-wide bottom participant label toggle,
  // shown above the sequence Auto Layout action (its own separator below).
  const seqBottomBtn = document.getElementById('btn-sequence-bottom-labels');
  if (seqBottomBtn) seqBottomBtn.style.display = isSequence ? '' : 'none';
  const seqSep = document.getElementById('display-sequence-separator');
  if (seqSep) seqSep.style.display = isSequence ? '' : 'none';
  const seqAutoBtn = document.getElementById('btn-sequence-auto-layout');
  if (seqAutoBtn) seqAutoBtn.style.display = isSequence ? '' : 'none';

  // Animate Connectors — an UNCHECKED-default toggle available in EVERY diagram
  // type (per request: even Org / Gantt, not just "flow" diagrams). It stays at its
  // HTML home as the LAST item of the unchecked toggle group (after the DataObject
  // field toggles when present); the always-shown dm-separator below keeps it
  // SEPARATED from the Auto Layout actions. No per-type reposition — being visually
  // separated from Auto Layout is the desired look. Because it's shown everywhere,
  // the animation is no longer force-stopped on tab change; it's a transient global
  // view state the user clears via the checkbox.
  const flowBtn = document.getElementById('btn-animate-flow');
  if (flowBtn) flowBtn.style.display = '';

  // Sequence: keep the toggles in ONE group. Bottom Participant Labels sits directly
  // ABOVE Animate Connectors (no divider between them, Animate stays the last toggle),
  // and the sequence separator becomes the single divider before the sequence Auto
  // Layout. So move Bottom Labels just above Animate and hide the (otherwise always-on)
  // dm-separator for this type — otherwise it + the sequence separator would split the
  // toggles into three stacked single-item groups.
  if (isSequence) {
    if (dmSep) dmSep.style.display = 'none';
    if (seqBottomBtn && flowBtn && seqBottomBtn.nextElementSibling !== flowBtn) {
      flowBtn.parentNode.insertBefore(seqBottomBtn, flowBtn);
    }
  }

  if (isGantt) {
    dd.style.display = '';
    updateGanttToggleLabels();
    return;
  }
  dd.style.display = '';
  if (isDataObjectType) updateDisplayToggleLabels();
  if (isSequence) updateSequenceToggleLabels();
}

// Display-menu toggle items use a fixed noun-phrase label plus an SVG
// checkbox icon whose check state is driven by a `.is-checked` class on the
// button. These helpers just toggle that class — the SVG (empty box + tick
// path) is pre-rendered in index.html and CSS shows/hides the tick.
function updateDisplayToggleLabels() {
  document.getElementById('btn-display-api')
    ?.classList.toggle('is-checked', isDisplayFlagOn('showLabels'));
  document.getElementById('btn-display-lengths')
    ?.classList.toggle('is-checked', isDisplayFlagOn('showFieldLengths'));
  document.getElementById('btn-display-keys-only')
    ?.classList.toggle('is-checked', isDisplayFlagOn('keyFieldsOnly'));
  document.getElementById('btn-display-collapse')
    ?.classList.toggle('is-checked', dataObjectsAllCollapsed());   // checked only when EVERY object is collapsed
  refreshDisplayDotIndicator();
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// GanttTimeline-only settings (weekStartDay, showWeekNumber) live as model props on the
// timeline cell — read from the first timeline on the tab (or a default when there is none).
function getGanttTimelineSetting(prop, fallback) {
  const graph = modules.graph;
  if (!graph) return fallback;
  const tl = graph.getElements().find(el => el.get('type') === 'sf.GanttTimeline');
  return tl ? (tl.get(prop) ?? fallback) : fallback;
}

// Apply a timeline setting to EVERY GanttTimeline on the tab, as a single undo entry.
function applyToAllGanttTimelines(prop, value) {
  const graph = modules.graph;
  if (!graph) return;
  const timelines = graph.getElements().filter(el => el.get('type') === 'sf.GanttTimeline');
  if (!timelines.length) return;
  modules.history.startBatch();
  try { timelines.forEach(tl => tl.set(prop, value)); }
  finally { modules.history.endBatch(); }
}

function updateGanttToggleLabels() {
  document.getElementById('btn-gantt-assignee')
    ?.classList.toggle('is-checked', isDisplayFlagOn('showAssignee'));
  document.getElementById('btn-gantt-progress')
    ?.classList.toggle('is-checked', isDisplayFlagOn('showProgress'));
  document.getElementById('btn-gantt-project-summary')
    ?.classList.toggle('is-checked', getGanttTimelineSetting('showProjectSummary', false) === true);
  const wsLabel = document.getElementById('gantt-week-start-label');
  if (wsLabel) {
    const wsd = ((Number(getGanttTimelineSetting('weekStartDay', 1)) % 7) + 7) % 7;
    wsLabel.textContent = `Week Starts: ${WEEKDAY_NAMES[wsd]}`;
  }
  const weLabel = document.getElementById('gantt-weekend-start-label');
  if (weLabel) {
    const wesd = ((Number(getGanttTimelineSetting('weekendStartDay', 6)) % 7) + 7) % 7;
    weLabel.textContent = `Weekend Starts: ${WEEKDAY_NAMES[wesd]}`;
  }
  refreshDisplayDotIndicator();
}

function updateSequenceToggleLabels() {
  document.getElementById('btn-sequence-bottom-labels')
    ?.classList.toggle('is-checked', isDisplayFlagOn('showBottomLabel'));
  refreshDisplayDotIndicator();
}

// Gap 14 (v1.12.0) — small dot on the Display toolbar button when any
// toggle is in a non-default state. Defaults pulled from the storage
// helpers (Auto Sizing defaults ON; Connector Grouping defaults OFF)
// and the data-model / gantt / sequence flag conventions in
// isDisplayFlagOn. Module-scope so the per-section label refreshers
// (updateDisplayToggleLabels / updateGanttToggleLabels /
// updateSequenceToggleLabels) can call it directly.

function refreshDisplayDotIndicator() {
  const btn = document.getElementById('btn-display');
  if (!btn) return;
  const nonDefault =
    isAutoSizingEnabled() === false ||
    // Connector Grouping defaults ON now (canvas.js → isConnectorGroupingEnabled),
    // so the non-default state is "currently off".
    isConnectorGroupingEnabled() === false ||
    // Crossing Bumps default ON (CR-5.2 PoC).
    isCrossingBumpsEnabled() === false ||
    // Focus Dimming default ON (v1.12.4).
    isFocusDimmingEnabled() === false ||
    isDisplayFlagOn('showLabels') ||
    isDisplayFlagOn('showFieldLengths') ||
    isDisplayFlagOn('keyFieldsOnly') ||
    // Gantt + sequence flags default ON — non-default = currently off.
    hasFlagFlippedOff('showAssignee') ||
    hasFlagFlippedOff('showProgress') ||
    hasFlagFlippedOff('showBottomLabel');
  // NOTE: the Gantt timeline view-preferences (Week Starts / Weekend Starts / Week Numbers)
  // are deliberately NOT counted here — they're regional/labelling choices that don't hide
  // any content, so they must not light the Display "eye" indicator.
  btn.classList.toggle('df-toolbar__button--has-active', nonDefault);
  // A6 (v1.12.0) — extend the tooltip when the dot is showing so the
  // amber indicator isn't conveyed by colour alone (WCAG 1.4.1). Strips
  // any prior suffix on every refresh so the base label stays clean.
  const base = btn.getAttribute('data-base-title') || btn.getAttribute('title') || 'Display options';
  if (!btn.hasAttribute('data-base-title')) btn.setAttribute('data-base-title', base);
  btn.setAttribute('title', nonDefault ? `${base} - some toggles active` : base);
}
function hasFlagFlippedOff(flag) {
  const graph = modules.graph;
  if (!graph) return false;
  const ganttFlags = ['showAssignee', 'showProgress'];
  const sequenceFlags = ['showBottomLabel'];
  const objs = graph.getElements().filter(el => {
    const t = el.get('type');
    if (ganttFlags.includes(flag)) return t.startsWith('sf.Gantt');
    if (sequenceFlags.includes(flag)) return t === 'sf.SequenceParticipant';
    return false;
  });
  if (objs.length === 0) return false;
  return objs.some(el => el.get(flag) === false);
}

function isDisplayFlagOn(flag) {
  const graph = modules.graph;
  if (!graph) return false;
  const ganttFlags = ['showAssignee', 'showProgress'];
  const sequenceFlags = ['showBottomLabel'];
  const isGanttFlag = ganttFlags.includes(flag);
  const isSequenceFlag = sequenceFlags.includes(flag);
  const objs = graph.getElements().filter(el => {
    const t = el.get('type');
    if (isGanttFlag) return t.startsWith('sf.Gantt');
    if (isSequenceFlag) return t === 'sf.SequenceParticipant';
    return t === 'sf.DataObject';
  });
  if (objs.length === 0) return false;
  // Default-on flags treat `undefined` as "shown" so a fresh diagram reads
  // correctly (showBottomLabel defaults to true in the shape definition;
  // Gantt flags default to true in renderGanttTaskProps).
  if (isGanttFlag || isSequenceFlag) return objs.some(el => el.get(flag) !== false);
  return objs.some(el => el.get(flag));
}

// Collapse Objects uses ALL-semantics (not the `.some()` of isDisplayFlagOn): the toggle is "checked" only when
// EVERY DataObject is collapsed, so a partially-collapsed diagram reads unchecked and one click collapses the rest.
function dataObjectsAllCollapsed() {
  const graph = modules.graph;
  if (!graph) return false;
  const objs = graph.getElements().filter(el => el.get('type') === 'sf.DataObject');
  return objs.length > 0 && objs.every(el => !!el.get('collapsed'));
}

function applyDisplayFlagToAll(flag, value) {
  const graph = modules.graph;
  if (!graph) return;
  const ganttFlags = ['showAssignee', 'showProgress'];
  const sequenceFlags = ['showBottomLabel'];
  const isGanttFlag = ganttFlags.includes(flag);
  const isSequenceFlag = sequenceFlags.includes(flag);
  // v1.12.1 fix — wrap the per-cell mutation in a history batch so a single
  // toggle of the Display flag (which touches N cells) collapses into ONE
  // undo entry, not N. Without this, toggling Bottom Participant Labels off
  // on a 10-participant diagram created 10 history entries, forcing the
  // user to press ⌘Z ten times to revert one click.
  modules.history.startBatch();
  try {
    graph.getElements().forEach(el => {
      const t = el.get('type');
      const matches = isGanttFlag ? t.startsWith('sf.Gantt')
        : isSequenceFlag ? t === 'sf.SequenceParticipant'
        : t === 'sf.DataObject';
      if (!matches) return;
      if (flag === 'showBottomLabel' && joint.shapes.sf.setParticipantBottomLabelVisible) {
        // Route through the helper so the header markup + port layout stay in
        // sync (mirrored header/accent/underline visibility, correct ports).
        joint.shapes.sf.setParticipantBottomLabelVisible(el, value);
      } else {
        el.set(flag, value);
      }
    });
  } finally {
    modules.history.endBatch();
  }
}

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
        document.getElementById('btn-help')?.click();
        break;
      case 'about':
        document.getElementById('btn-about')?.click();
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

// ── Flow animation overlays ──────────────────────────────────────
// Safari propagates stroke-dasharray into SVG <marker> content at
// the rendering level — CSS cannot override it.  We work around this
// by cloning each link's line path WITHOUT markers, then animating
// the clone.  The original path keeps its markers un-dashed.

let _flowObserver = null;
let _flowActive = false;

function startFlowAnimation() {
  _flowActive = true;
  syncFlowOverlays();

  const target = document.querySelector('#paper svg .joint-viewport')
              || document.querySelector('#paper svg');
  if (target) {
    _flowObserver = new MutationObserver((mutations) => {
      if (!_flowActive) return;
      // Ignore mutations caused by either overlay system. The line-style
      // overlay in canvas.js observes the same subtree; without this filter
      // the two systems pingpong every frame and the CSS animation restarts
      // before it can advance.
      if (!flowMutationsAffectRealLinks(mutations)) return;
      scheduleFlowSync();
    });
    _flowObserver.observe(target, { childList: true, subtree: true });
  }
}

function flowMutationsAffectRealLinks(mutations) {
  for (const m of mutations) {
    for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      const cls = n.getAttribute?.('class') || '';
      if (cls === 'df-flow-overlay' || cls === 'df-line-style-overlay') continue;
      return true;
    }
    for (const n of m.removedNodes) {
      if (n.nodeType !== 1) continue;
      const cls = n.getAttribute?.('class') || '';
      if (cls === 'df-flow-overlay' || cls === 'df-line-style-overlay') continue;
      return true;
    }
  }
  return false;
}

function stopFlowAnimation() {
  _flowActive = false;
  if (_flowObserver) { _flowObserver.disconnect(); _flowObserver = null; }
  document.querySelectorAll('.df-flow-overlay').forEach(el => el.remove());
}

let _flowSyncId = 0;
function scheduleFlowSync() {
  if (_flowSyncId) return;
  _flowSyncId = requestAnimationFrame(() => {
    _flowSyncId = 0;
    if (_flowActive) syncFlowOverlays();
  });
}

function syncFlowOverlays() {
  // Disconnect observer while we mutate the DOM to avoid feedback loops
  if (_flowObserver) _flowObserver.disconnect();

  // Remove stale overlays
  document.querySelectorAll('.df-flow-overlay').forEach(el => el.remove());

  // Clone each link line — strip markers, add animation class
  document.querySelectorAll('.joint-link [joint-selector="line"]').forEach(line => {
    const clone = line.cloneNode(false);
    clone.removeAttribute('marker-start');
    clone.removeAttribute('marker-end');
    clone.removeAttribute('marker-mid');
    clone.removeAttribute('joint-selector');
    clone.setAttribute('class', 'df-flow-overlay');
    line.parentNode.insertBefore(clone, line.nextSibling);
  });

  // Reconnect observer
  if (_flowActive && _flowObserver) {
    const target = document.querySelector('#paper svg .joint-viewport')
                || document.querySelector('#paper svg');
    if (target) {
      _flowObserver.observe(target, { childList: true, subtree: true });
    }
  }
}

function btn(id) {
  return document.getElementById(id);
}

// ── Cloud-sync control (Google Drive) ────────────────────────────────────────
// One icon (left of Share Link) + a state-aware dropdown menu. The Drive icon is
// colour + glyph coded by sync state via the SLDS sync family; the time text shows
// only when auto-sync is on. Self-gates: stays hidden unless Drive is configured.
// Short state explainer for the sync menu's first row (shown in every state). In the error
// state the row also becomes the reconnect button (see setupSyncControl).
function syncStatusText(st, connected = false) {
  const rel = st.lastSavedAt ? formatRelativeTime(st.lastSavedAt) : null;
  switch (st.state) {
    case 'saving':   return 'Saving to Google Drive…';
    case 'error':    return 'Google Drive sign-in expired.';
    case 'conflict': return 'This diagram changed on Google Drive.';
    case 'refresh':  return 'The original shared file has new changes.';
    case 'pending':  return 'Unsaved changes - they will sync to Google Drive.';
    case 'synced':   return rel ? `Synced to Google Drive · last saved ${rel}.` : 'Auto-sync is on - this diagram syncs to Google Drive once it has content.';
    // state 'off' splits on account-level connection: when connected it's just THIS diagram that isn't synced
    // yet (don't claim "not connected" while the menu offers Disconnect); otherwise the account truly isn't connected.
    default:         return connected ? "This diagram isn't synced to Google Drive yet." : 'Not connected to Google Drive yet.';
  }
}
function setupSyncControl() {
  const p = modules.persistence;
  if (!p.isDriveConfigured?.()) return;          // feature off for this origin
  const wrap = btn('sync-dropdown');
  const btnEl = btn('btn-sync');
  if (!wrap || !btnEl) return;
  wrap.removeAttribute('hidden');
  setupDropdown('btn-sync');

  const driveSvg  = btnEl.querySelector('.df-sync__drive');
  const textEl    = btnEl.querySelector('.df-sync__text');
  const menu      = wrap.querySelector('.df-sync__menu');
  const statusText = menu.querySelector('[data-sync-status-text]');
  const statusBtn = menu.querySelector('[data-sync-status-btn]');
  const closeMenu = () => wrap.classList.remove('df-toolbar__dropdown--open');

  // Saving spin: START it when saving begins, but never STOP it mid-rotation. The spin keeps
  // looping until a cycle boundary (`animationiteration`, fired at 360°≡0° = the upright rest
  // pose) at which point we re-check the live state and drop the class if saving has finished —
  // so the icon always completes its rotation and settles cleanly instead of snapping back.
  driveSvg?.addEventListener('animationiteration', () => {
    if (p.getDriveStatus?.().state !== 'saving') driveSvg.classList.remove('df-sync__drive--spin');
  });

  const render = () => {
    const st = p.getDriveStatus?.() || { state: 'off', showText: false, lastSavedAt: 0 };
    btnEl.dataset.state = st.state;
    if (st.state === 'saving') driveSvg?.classList.add('df-sync__drive--spin');   // stop is deferred to the cycle boundary above
    const isError = st.state === 'error';
    const isConflict = st.state === 'conflict';
    const isRefresh = st.state === 'refresh';   // the original shared file changed — pull available (item 6)
    const isAction = isError || isConflict || isRefresh;   // all put an actionable label + status-row affordance up
    // ONE icon, ONE href for every state — no swapping. CSS recolours the SAME detailed Drive logo per
    // [data-state]: greyed (off) / full colour (synced) / spinning (saving) / red-tinted (error) /
    // amber-tinted (conflict). Text appears for an action (red "Sign in" / amber "Review") and as a neutral
    // "Saving" label to the left of the icon while a save is in flight (alongside the spin animation).
    if (textEl) {
      if (isError) { textEl.textContent = 'Sign in'; textEl.style.display = ''; }
      else if (isConflict) { textEl.textContent = 'Review'; textEl.style.display = ''; }
      else if (isRefresh) { textEl.textContent = 'Refresh'; textEl.style.display = ''; }
      else if (st.state === 'saving') { textEl.textContent = 'Saving'; textEl.style.display = ''; }
      else textEl.style.display = 'none';
    }
    // Title hints the left-click (menu) + right-click (primary action) split.
    btnEl.title = isError ? 'Google Drive sign-in needed - left-click for menu, right-click to reconnect'
      : isConflict ? 'This diagram changed on Google Drive - left-click for menu, right-click to review'
      : isRefresh ? 'The original shared file has new changes - left-click for menu, right-click to refresh'
      : st.state === 'off' ? 'Google Drive - left-click for menu, right-click to sync this diagram'
      : st.state === 'saving' ? 'Saving to Google Drive…'
      : 'Google Drive sync - left-click for menu, right-click to sync now';

    // "Connected" = account-level (signed in, OR auto-sync on, OR any tab linked to a Drive file). It drives
    // BOTH the menu shape AND the status copy, so they can never contradict (no "Not connected" header while
    // the menu offers Disconnect). The per-active-tab sync state lives in syncStatusText's other branches.
    const connected = !!p.isDriveConnected?.();
    const auto = p.isAutosyncOn?.();
    // Menu first row: the state explainer (left) + the KEY contextual action as a wire button (right) - so the first
    // element under the icon is always the action that matters. Sign in (signed off) / Review (conflict) / Refresh
    // (upstream changed) / Sync now (connected + manual). No button when connected + auto-sync on + idle (nothing to do).
    if (statusText) statusText.textContent = syncStatusText(st, connected);
    if (statusBtn) {
      let label = '', tone = '';
      if (isError || !connected) { label = 'Sign in'; tone = 'error'; }
      else if (isConflict) { label = 'Review'; tone = 'conflict'; }
      else if (isRefresh) { label = 'Refresh'; tone = 'refresh'; }
      else if (!auto) { label = 'Sync now'; tone = 'sync'; }
      statusBtn.textContent = label;
      statusBtn.dataset.tone = tone;
      statusBtn.hidden = !label;
    }

    // Menu shape: not-connected shows only "Connect"; connected shows the Drive-unique set. Save & Export /
    // Load & Import are NOT here — they live on the always-present navbar, so the menu never duplicates them.
    const set = (sel, hide) => { const el = menu.querySelector(sel); if (el) el.hidden = hide; };
    set('[data-sync="enable"]', connected);
    // "Version history" — shown only when connected AND the active tab is linked to a Drive file (its revisions).
    const showHistory = connected && !!p.activeHasDriveFile?.();
    // "Refresh imported diagram" — shown ONLY when the active diagram was opened from a Drive link
    // (re-fetches the sender's latest). Independent of connected: a public link refreshes anonymously.
    const showReload = !!p.activeIsImported?.();
    // A FORK (own master + a refresh-only sharedSource) opens the original in a NEW tab, leaving your copy intact →
    // "Open the original shared diagram". An UN-forked view (sharedSource, no own master) re-pulls the original INTO
    // the current tab → "Refresh from the original". (reopenLatestFromDrive picks the same branch via hasOwnFork.)
    const reloadLabel = menu.querySelector('[data-sync-reload-label]');
    if (reloadLabel && showReload) reloadLabel.textContent = p.activeHasDriveFile?.() ? 'Open the original shared diagram' : 'Refresh from the original';
    set('[data-sync="history"]', !showHistory);
    set('[data-sync="reload"]', !showReload);
    set('[data-sync="autosync"]', !connected);
    set('[data-sync="disconnect"]', !connected);   // "Disconnect Google Drive" — only when connected (incl. red/error)
    // The rule above auto-sync earns its place only when there's a visible item on BOTH sides: a history/reload
    // item above AND a connected-only item (auto-sync/disconnect) below. Without the `connected` guard, a
    // not-connected recipient of a shared link (showReload true, everything below hidden) would leave this rule
    // adjacent to the always-on rule before About — a doubled divider.
    set('[data-sync-sep]', !(connected && (showHistory || showReload)));
    const autoItem = menu.querySelector('[data-sync="autosync"]');
    autoItem?.classList.toggle('is-checked', !!auto);   // Display-menu checkbox style
    // Not-connected users see an invitation ("Why Google Drive?"); once connected it's the reference doc.
    const aboutLabel = menu.querySelector('[data-sync-about-label]');
    if (aboutLabel) aboutLabel.textContent = connected ? 'About Google Drive Sync' : 'Why Google Drive?';
    autoItem?.setAttribute('aria-checked', auto ? 'true' : 'false');
    // The cadence note explains BOTH states (shown whenever connected): auto-sync ON = 2-min timer + boundary saves;
    // auto-sync OFF = boundary saves only (open/switch/close still persist, there's just no timer). The user asked
    // for the unchecked state to be described, not left blank.
    set('.df-sync__cadence', !connected);
    const cadenceNote = menu.querySelector('.df-sync__cadence-note');
    if (cadenceNote) cadenceNote.textContent = auto
      ? 'Saves every 2 minutes, and the moment you open, switch, or close a tab.'
      : 'Auto-save is off, but your work still saves the moment you open, switch, or close a tab.';
  };

  // Menu actions. Action items close the menu; the toggle + cadence keep it open.
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-sync]');
    if (!item) return;
    const action = item.dataset.sync;
    if (action === 'enable')      { closeMenu(); p.enableAutosync?.(); }
    else if (action === 'history') { closeMenu(); showDriveHistoryModal(); }
    else if (action === 'reload') { closeMenu(); p.reopenLatestFromDrive?.(); }
    else if (action === 'disconnect') {
      closeMenu();
      confirmModal({
        title: 'Disconnect Google Drive?',
        message: 'Diagramforce stops syncing and forgets the Drive links here, returning to the not-connected state. Your diagrams stay in your Google Drive - reconnect any time to pick them back up.',
        okLabel: 'Disconnect', cancelLabel: 'Cancel', tone: 'danger',
      }).then((ok) => { if (ok) { p.disconnectDrive?.(); showToast('Disconnected from Google Drive.', 'info'); } });
    }
    else if (action === 'about')  { closeMenu(); showSyncAbout(); }
    else if (action === 'autosync') {
      e.stopPropagation();
      if (p.isAutosyncOn?.()) p.disableAutosync?.(); else p.enableAutosync?.();
      render();
    }
  });

  // The KEY action wire button in the status row (Sign in / Review / Refresh / Sync now). It dispatches by the LIVE
  // state, so it's always the right action for what the button currently reads; it's only ever visible when there IS
  // an action (render hides it otherwise), so no no-op branch is needed.
  statusBtn?.addEventListener('click', () => {
    closeMenu();
    const st = p.getDriveStatus?.() || { state: 'off' };
    if (st.state === 'conflict') p.resolveActiveConflict?.();
    else if (st.state === 'refresh') p.reopenLatestFromDrive?.();
    else if (st.state === 'error' || !p.isDriveConnected?.()) p.signIn?.();
    else p.syncNow?.();   // connected + manual
  });

  // Right-click the icon = fire the primary action for the current state, skipping the menu.
  // error → reconnect (sign in); saving → no-op; everything else (off/synced/pending) → sync the
  // active diagram now (saveToDrive signs in first if needed). Suppress the browser context menu.
  btnEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    closeMenu();
    const state = btnEl.dataset.state;
    if (state === 'error') p.signIn?.();
    else if (state === 'conflict') p.resolveActiveConflict?.();
    else if (state === 'refresh') p.reopenLatestFromDrive?.();   // pull the original's latest (item 6)
    else if (state === 'saving') { /* already saving — nothing to do */ }
    else p.saveToDrive?.();
  });

  p.setDriveStatusListener?.(render);
  modules.tabs?.onChange?.(render);
  setInterval(render, 30000);   // keep "saved X ago" fresh + re-evaluate token expiry
  render();
}

function showSyncAbout() {
  const head = 'margin:14px 0 5px;color:var(--text-primary);font-size:var(--font-size-sm);font-weight:600;letter-spacing:.01em';
  const list = 'margin:0;padding-left:18px;display:flex;flex-direction:column;gap:5px';
  const { footer, close } = buildModal({
    title: 'About Google Drive sync',
    className: 'df-sync-about-modal',
    width: '500px',
    bodyStyle: 'padding:18px 22px',
    bodyHtml: `<div style="color:var(--text-secondary);line-height:1.5;font-size:var(--font-size-sm)">
      <div style="text-align:center;margin:0 0 6px"><svg width="44" height="44" aria-hidden="true"><use href="#icon-gdrive"></use></svg></div>

      <h4 style="${head};margin-top:0">Purpose</h4>
      <p style="margin:0">Back up and share your diagrams using <strong>your own</strong> Google Drive - no Diagramforce account, no server, nothing extra to manage. Each diagram becomes a regular file in a <strong>Diagramforce</strong> folder you own, so you stay in control and can stop sharing or delete it whenever you like.</p>

      <h4 style="${head}">Features</h4>
      <ul style="${list}">
        <li><strong>Auto-sync</strong> every open diagram - every couple of minutes while you work, and the moment you open, switch, or close a tab.</li>
        <li><strong>Save</strong> and <strong>Open</strong> individual diagrams on demand from this menu.</li>
        <li><strong>Share</strong> a short, always-up-to-date link from the toolbar's <strong>Share Diagram</strong> button - keep it public, limit it to your organisation, or invite specific people.</li>
        <li><strong>Refresh</strong> a diagram you opened from a shared link to pull the sender's latest version.</li>
      </ul>

      <h4 style="${head}">Security &amp; privacy</h4>
      <ul style="${list}">
        <li>Your diagrams live <strong>only in your Drive</strong> - Diagramforce has no servers and never sees them.</li>
        <li>The app can touch <strong>only the files it creates or you explicitly open</strong>, never the rest of your Drive.</li>
        <li><strong>Organisation</strong> sharing asks once, separately, for your email address - only to read your Workspace domain so the link can be limited to your org. It is never requested for anything else.</li>
        <li>Sign-in lasts an hour. When it expires the Drive icon turns <strong>red</strong> - reconnect from the menu's highlighted row. Your work stays saved in your browser until you do.</li>
      </ul>

      <p style="margin:14px 0 0;font-size:var(--font-size-xs)">Full details in the <a href="privacy.html" target="_blank" rel="noopener" class="df-about__link">Privacy Policy</a> and <a href="terms.html" target="_blank" rel="noopener" class="df-about__link">Terms of Use</a>.</p>
    </div>`,
    footerHtml: '<button class="df-modal__btn df-modal__btn--primary" data-action="ok">Got it</button>',
  });
  if (footer) footer.style.justifyContent = 'flex-end';
  document.querySelector('.df-sync-about-modal [data-action="ok"]')?.addEventListener('click', close);
}

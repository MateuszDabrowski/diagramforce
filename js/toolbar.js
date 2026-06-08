// Toolbar — wires all button clicks to module actions
// Also keeps undo/redo button states in sync

import { diagramHasImage } from './image-component.js?v=1.15.6';
import { showToast, showError, confirmModal, trapFocus, buildModal } from './feedback.js?v=1.15.6';
import { resizeDataObjectToFit } from './components.js?v=1.15.6';
import { isAutoSizingEnabled, setAutoSizingEnabled, refitAllParents, isConnectorGroupingEnabled, setConnectorGroupingEnabled, rerouteAllLinks, isCrossingBumpsEnabled, setCrossingBumpsEnabled, isFocusDimmingEnabled, setFocusDimmingEnabled } from './canvas.js?v=1.15.6';
import { escHtml, formatRelativeTime } from './util.js?v=1.15.6';

let modules = {};
let _stencilWasOpenBeforeTable = false;   // restore stencil state when leaving Table mode

export function init(_modules) {
  modules = _modules;

  // Save dropdown
  setupDropdown('btn-save');
  btn('btn-save-browser').addEventListener('click', () => showSaveModal());
  btn('btn-save-json').addEventListener('click', () => showExportModal());
  btn('btn-save-png').addEventListener('click', () => {
    if (document.getElementById('paper')?.classList.contains('df-animate-flow')) {
      modules.persistence.exportGIF(false);
    } else {
      modules.persistence.exportPNG(false);
    }
  });
  btn('btn-save-png-t').addEventListener('click', () => {
    if (document.getElementById('paper')?.classList.contains('df-animate-flow')) {
      modules.persistence.exportGIF(true);
    } else {
      modules.persistence.exportPNG(true);
    }
  });
  btn('btn-save-webp').addEventListener('click', () => modules.persistence.exportWEBP(false));
  btn('btn-save-webp-t').addEventListener('click', () => modules.persistence.exportWEBP(true));
  btn('btn-save-share').addEventListener('click', () => modules.persistence.shareAsURL());
  document.getElementById('btn-share-url').addEventListener('click', () => modules.persistence.shareAsURL());
  // (Templates are now exported/imported through the general Export/Import-to-JSON
  // manager — no dedicated menu items.)

  // Share-as-URL is unavailable while the diagram contains image cells —
  // embedded image bytes blow past every messaging/chat URL-length limit.
  // We mirror the state on the dropdown menu item (with explanatory tooltip)
  // and also gate inside `persistence.shareAsURL` for the keyboard shortcut /
  // hamburger entry.
  const SHARE_DISABLED_MSG = 'URL sharing is unavailable while this diagram contains images. Use Save → Export to JSON to share, or remove every image to re-enable URL sharing.';
  const EMPTY_DIAGRAM_MSG = 'Add a shape to enable export.';
  const GIF_ENCODING_MSG = 'Wait until the current GIF export finishes.';
  // Save-dropdown items that depend on the diagram having content. Each is
  // disabled when the active graph is empty so the user can't click into a
  // failure modal — replaces the old alert('Diagram is empty…') path.
  // Save-to-Browser is intentionally left enabled (an empty "Untitled" save
  // is still a valid checkpoint to come back to later). "Export to JSON" is
  // also NOT gated — it opens the Export Manager, which can export named saves
  // and templates even when the active canvas is empty.
  const EXPORT_BTN_IDS = ['btn-save-png', 'btn-save-png-t',
    'btn-save-webp', 'btn-save-webp-t'];
  const refreshShareAvailability = () => {
    const isEmpty = !modules.graph || modules.graph.getCells().length === 0;
    // GIF encoding lock — set by persistence.js while gifenc is busy; ALL
    // export items disable so the user can't queue a second slow encode.
    const gifBusy = modules.persistence.isGifEncodingInProgress?.() ?? false;
    // Share button — disabled if the diagram has images OR is empty OR GIF is encoding.
    const shareBtn = btn('btn-save-share');
    if (shareBtn) {
      const blocked = diagramHasImage(modules.graph);
      const disable = blocked || isEmpty || gifBusy;
      shareBtn.disabled = disable;
      shareBtn.title = blocked ? SHARE_DISABLED_MSG
        : gifBusy ? GIF_ENCODING_MSG
        : isEmpty ? EMPTY_DIAGRAM_MSG
        : '';
    }
    // Export items — disabled on empty graph OR while GIF encoding.
    for (const id of EXPORT_BTN_IDS) {
      const b = btn(id);
      if (!b) continue;
      const disable = isEmpty || gifBusy;
      b.disabled = disable;
      b.title = gifBusy ? GIF_ENCODING_MSG : (isEmpty ? EMPTY_DIAGRAM_MSG : '');
    }
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

  // Load dropdown
  setupDropdown('btn-load');
  btn('btn-load-browser').addEventListener('click', () => showLoadModal());
  btn('btn-load-json').addEventListener('click', () => modules.persistence.importJSON());
  btn('btn-load-paste-json').addEventListener('click', () => modules.persistence.pasteJSON());
  btn('btn-load-mermaid').addEventListener('click', () => showMermaidImportModal());

  // Display dropdown (hidden for Gantt, some options data-model only)
  setupDropdown('btn-display');

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

  // Gantt timeline week controls — apply to every GanttTimeline on the tab.
  // First-day-of-week cycles Sun→Sat; week-number toggles "W23" vs the start-date label.
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
  btn('btn-gantt-week-number').addEventListener('click', () => {
    const cur = getGanttTimelineSetting('showWeekNumber', false) === true;
    applyToAllGanttTimelines('showWeekNumber', !cur);
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
    if (newId) showToast('Mapped — objects cloned into a new Data Mapping diagram.', 'success');
    else showToast('Nothing to map — add at least one object first.', 'info');
  });

  // Animate Connectors toggle — a standard Display checkbox (default OFF). The
  // label is fixed; the checkbox tick reflects state (no more textContent swap,
  // which wiped the icon). While on, the PNG export becomes a GIF and the
  // static-only WEBP export is hidden — see updateExportButtons().
  btn('btn-animate-flow').addEventListener('click', () => {
    const paperEl = document.getElementById('paper');
    const isOn = paperEl.classList.toggle('df-animate-flow');
    document.getElementById('btn-animate-flow')?.classList.toggle('is-checked', isOn);
    updateExportButtons(isOn);
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

  // Load modal close
  btn('btn-close-load-modal').addEventListener('click', hideLoadModal);
  btn('load-modal-overlay').addEventListener('click', hideLoadModal);

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

// `importStats` (optional) is passed by persistence right after a bundle import
// — { imported, skipped, templates, templatesSkipped } — to render a transient
// summary banner. It's absent on every normal open (and on the post-delete
// rebuild), so the banner is naturally temporary.
function showLoadModal(importStats = null) {
  const saves = modules.persistence.getNamedSaves();
  const bodyEl = document.getElementById('load-modal-list');
  bodyEl.innerHTML = '';
  // Clean up any previous footer
  document.querySelector('.df-modal__footer--load')?.remove();

  // Transient import summary — sits at the very top, above the advisory, only
  // when we arrived here straight from an import. Green success variant.
  if (importStats && (importStats.imported || importStats.skipped || importStats.templates || importStats.templatesSkipped)) {
    const summary = document.createElement('div');
    summary.className = 'df-modal__advisory df-modal__advisory--success df-import-summary';
    summary.innerHTML = formatImportSummary(importStats);
    bodyEl.appendChild(summary);
  }

  // Persistence advisory — browsers can clear localStorage under storage
  // pressure, on profile reset, or via privacy settings. Saves are kept for
  // 90 days; for permanent storage, users should export to JSON.
  const advisory = document.createElement('p');
  advisory.className = 'df-modal__advisory';
  advisory.innerHTML = 'Browsers may periodically clear this list. For permanent storage, always <button type="button" class="df-modal__advisory-link">Export to JSON</button>.';
  advisory.querySelector('.df-modal__advisory-link').addEventListener('click', () => {
    hideLoadModal();      // close this overlay first…
    showExportModal();    // …then open Export to JSON
  });
  bodyEl.appendChild(advisory);

  if (!saves || saves.length === 0) {
    // Empty state — NO Select-all / list box / footer, just a clear message.
    const empty = document.createElement('p');
    empty.className = 'df-modal__empty';
    empty.textContent = 'No saved diagrams yet. Save a diagram to the browser and it will appear here.';
    bodyEl.appendChild(empty);
  } else {
    // Bordered list box (mirrors Close-Tabs): Select-all header + rows.
    const box = document.createElement('div');
    box.className = 'df-modal__list-box';

    const header = document.createElement('div');
    header.className = 'df-modal__list-header';
    header.innerHTML = `<label class="df-modal__select-all"><input type="checkbox" class="df-modal__check-all"> Select all</label>`;
    box.appendChild(header);

    for (const save of saves) {
      box.appendChild(buildLoadItem(save));
    }
    bodyEl.appendChild(box);

    // Footer: Delete Selected (left, danger) + Load Selected (right, primary).
    const dialog = bodyEl.closest('.df-modal__dialog');
    const footer = document.createElement('div');
    footer.className = 'df-modal__footer df-modal__footer--load';
    footer.innerHTML = `
      <button class="df-modal__btn df-modal__btn--danger df-modal__delete-btn" disabled>Delete Selected</button>
      <button class="df-modal__btn df-modal__btn--primary df-modal__action-btn" disabled>Load Selected</button>
    `;
    dialog.appendChild(footer);

    const checkAll = header.querySelector('.df-modal__check-all');
    const loadBtn = footer.querySelector('.df-modal__action-btn');
    const delBtn = footer.querySelector('.df-modal__delete-btn');
    const rowChecks = () => [...bodyEl.querySelectorAll('.df-modal__row-check')];
    const refresh = () => {
      const cs = rowChecks();
      const any = cs.some(c => c.checked);
      const all = cs.length > 0 && cs.every(c => c.checked);
      loadBtn.disabled = !any;
      delBtn.disabled = !any;
      checkAll.checked = all;
      checkAll.indeterminate = any && !all;
    };
    checkAll.addEventListener('change', () => { rowChecks().forEach(c => { c.checked = checkAll.checked; }); refresh(); });
    bodyEl.addEventListener('change', (e) => { if (e.target.matches('.df-modal__row-check')) refresh(); });

    loadBtn.addEventListener('click', async () => {
      const sel = rowChecks().filter(c => c.checked);
      for (const chk of sel) await modules.persistence.loadNamedSave(chk.dataset.saveKey);
      hideLoadModal();
    });

    delBtn.addEventListener('click', async () => {
      const sel = rowChecks().filter(c => c.checked);
      if (sel.length === 0) return;
      const ok = await confirmModal({
        title: 'Delete saved diagrams?',
        message: `Delete ${sel.length} saved diagram${sel.length === 1 ? '' : 's'} from this browser? This can't be undone.`,
        okLabel: 'Delete',
        tone: 'danger',
      });
      if (!ok) return;
      for (const chk of sel) modules.persistence.deleteNamedSave(chk.dataset.saveKey);
      showLoadModal(); // rebuild the list (deleted entries gone); modal stays open
    });

    refresh();
  }

  const el = document.getElementById('load-modal');
  el.classList.remove('df-modal--hidden');
  document.body.classList.add('df-modal-open');
  // Release any prior trap first — showLoadModal re-runs itself after a bulk
  // delete to rebuild the list, and we must not stack focus traps.
  _loadTrapRelease?.();
  _loadTrapRelease = trapFocus(el, { onEscape: hideLoadModal });
}

function hideLoadModal() {
  _loadTrapRelease?.(); _loadTrapRelease = null;
  document.getElementById('load-modal').classList.add('df-modal--hidden');
  document.body.classList.remove('df-modal-open');
  document.querySelector('.df-modal__footer--load')?.remove();
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
  const tabRows = allTabs.map(tab => {
    const defaultName = uniqueSaveName(tab.name, dateSuffix, existingSaves);
    const rel = formatRelativeTime(tab.lastModifiedAt || tab.lastSavedAt);
    return `
      <div class="df-modal__row${tab.isActive ? ' df-modal__row--active' : ''}">
        <input type="checkbox" class="df-modal__row-check" data-tab-id="${tab.id}" ${tab.isActive ? 'checked' : ''}>
        <span class="df-modal__row-icon">${getDiagramTypeIcon(tab.diagramType)}</span>
        <div class="df-modal__row-info df-save-modal__row-info">
          <input type="text" class="df-modal__row-name" data-tab-id="${tab.id}" value="${escHtml(defaultName)}" spellcheck="false">
          ${rel ? `<span class="df-modal__row-meta">Modified ${rel}</span>` : ''}
        </div>
        <span class="df-modal__row-badge">${escHtml(saveTypeLabel(tab.diagramType))}</span>
      </div>`;
  }).join('');

  const { overlay, body: bodyEl, footer, close } = buildModal({
    title: 'Save to Browser',
    className: 'df-save-modal',
    dialogClass: 'df-save-modal__dialog', // 520px
    bodyClass: 'df-modal__row-list',
    bodyHtml: `
      <p class="df-modal__advisory">Browsers may periodically clear this list. For permanent storage, always <button type="button" class="df-modal__advisory-link">Export to JSON</button>.</p>
      <div class="df-modal__list-box">
        <div class="df-modal__list-header">
          <label class="df-modal__select-all"><input type="checkbox" class="df-modal__check-all"> Select all</label>
        </div>
        ${tabRows}
      </div>`,
    footerHtml: '<button class="df-modal__btn df-modal__btn--primary df-modal__action-btn" style="margin-left:auto">Save Selected</button>',
  });

  // Advisory CTA — close this overlay, then open Export to JSON.
  bodyEl.querySelector('.df-modal__advisory-link')?.addEventListener('click', () => {
    close();
    showExportModal();
  });

  wireSelectAll(bodyEl, footer, '.df-modal__row-check', () => {
    const selected = [];
    overlay.querySelectorAll('.df-modal__row-check:checked').forEach(c => {
      const tabId = c.dataset.tabId;
      const nameInput = overlay.querySelector(`.df-modal__row-name[data-tab-id="${tabId}"]`);
      selected.push({ tabId, name: nameInput?.value.trim() || tabId });
    });
    if (selected.length === 0) return;

    // Save each tab individually with its custom name
    for (const { tabId, name } of selected) {
      const graphJSON = modules.tabs.getTabGraphJSON(tabId);
      const viewport = modules.tabs.getTabViewport(tabId);
      const diagramType = modules.tabs.getTabDiagramType(tabId);
      if (!graphJSON) continue;

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
      } catch (err) {
        showError(`Save failed for "${name}": ${err.message}`);
      }
    }

    // Mark active tab as saved if it was included
    const activeTab = allTabs.find(t => t.isActive);
    if (activeTab && selected.some(s => s.tabId === activeTab.id)) {
      const savedName = selected.find(s => s.tabId === activeTab.id)?.name;
      if (savedName) modules.tabs.renameActiveTab(savedName);
    }
    modules.tabs.markSaved('browser');

    close();
  });
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
        Every lane will be set to <strong>${plan.targetCount} evenly-spaced ports</strong> so connectors between same-index ports become parallel. The lanes below will have their port layout regenerated — existing connectors on those lanes may move vertically.
      </p>
      <div class="df-modal__row-list">${rows}</div>`,
    footerHtml: '<button class="df-modal__btn df-modal__btn--primary df-seq-autolayout-apply" style="margin-left:auto">Apply Auto Layout</button>',
  });
  footer.querySelector('.df-seq-autolayout-apply').addEventListener('click', () => {
    close();
    onConfirm();
  });
}

// --- Mermaid Import Modal ---

function showMermaidImportModal() {
  document.querySelector('.df-mermaid-modal')?.remove();

  const { dialog, body, footer, header, close } = buildModal({
    title: 'Paste Mermaid',
    className: 'df-mermaid-modal',
    width: '620px',
    bodyStyle: 'padding:var(--spacing-md) var(--spacing-lg)',
    bodyHtml: `
      <p style="margin:0 0 var(--spacing-sm);color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">
        Paste mermaid.js code:
      </p>
      <textarea class="df-mermaid-modal__input" spellcheck="false" rows="14"
        placeholder="flowchart TD&#10;  A[Start] --&gt; B{Decision}&#10;  B --&gt;|Yes| C[Process]&#10;  B --&gt;|No| D[End]"
        style="width:100%;box-sizing:border-box;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;padding:8px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-panel);color:var(--text-primary);resize:vertical"></textarea>
      <p class="df-mermaid-modal__supported" style="margin:var(--spacing-sm) 0 0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">
        <span class="df-mermaid-modal__supported-label">Supported:</span>
        <span data-type="graph"><strong>graph</strong> → Process</span>,
        <span data-type="flowchart"><strong>flowchart</strong> → Process</span>,
        <span data-type="state"><strong>stateDiagram</strong> → Process</span>,
        <span data-type="er"><strong>erDiagram</strong> → Data Model</span>,
        <span data-type="sequence"><strong>sequenceDiagram</strong> → Sequence</span>.
      </p>`,
    footerHtml: '<button class="df-modal__btn df-modal__btn--primary df-mermaid-modal__import" style="margin-left:auto" disabled>Load</button>',
  });
  dialog.style.maxWidth = '92vw'; // preserve prior inline override
  // Static "Beta" badge after the title text (title itself stays textContent-safe)
  header.querySelector('.df-modal__title').insertAdjacentHTML('beforeend',
    ' <span class="df-badge df-badge--beta" style="margin-left:8px;padding:2px 6px;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;border-radius:3px;background:var(--brand-amber, #F6B355);color:#1A1A1A;vertical-align:middle">Beta</span>');

  const input = body.querySelector('.df-mermaid-modal__input');
  const importBtn = footer.querySelector('.df-mermaid-modal__import');
  const supportedP = body.querySelector('.df-mermaid-modal__supported');
  const supportedLabel = body.querySelector('.df-mermaid-modal__supported-label');
  const supportedSpans = body.querySelectorAll('.df-mermaid-modal__supported [data-type]');

  const resetSpans = () => {
    supportedSpans.forEach(s => {
      s.style.color = '';
      s.style.fontWeight = '';
      s.style.textDecoration = '';
      s.style.opacity = '';
    });
  };
  const setIdle = () => {
    supportedP.style.color = 'var(--text-secondary)';
    supportedLabel.textContent = 'Supported:';
    resetSpans();
  };
  const setDetected = (type) => {
    supportedP.style.color = 'var(--text-secondary)';
    supportedLabel.textContent = 'Detected:';
    resetSpans();
    supportedSpans.forEach(s => {
      if (s.dataset.type === type) {
        s.style.color = 'var(--color-primary)';
        s.style.fontWeight = '600';
      } else {
        s.style.textDecoration = 'line-through';
        s.style.opacity = '0.55';
      }
    });
  };
  const setUnsupported = () => {
    supportedP.style.color = 'var(--color-error, #ba0517)';
    supportedLabel.textContent = 'Could not detect a supported diagram type.';
    resetSpans();
    supportedSpans.forEach(s => {
      s.style.textDecoration = 'line-through';
      s.style.opacity = '0.55';
    });
  };
  const validate = () => {
    const text = input.value;
    if (!text.trim()) {
      importBtn.disabled = true;
      setIdle();
      return;
    }
    const v = modules.mermaidImport.validateMermaid(text);
    if (v.ok) {
      importBtn.disabled = false;
      setDetected(v.type);
    } else {
      importBtn.disabled = true;
      setUnsupported();
    }
  };
  input.addEventListener('input', validate);

  importBtn.addEventListener('click', () => {
    const ok = modules.mermaidImport.importMermaidText(input.value);
    if (ok) close();
  });

  setTimeout(() => input.focus(), 50);
}

/** Export Manager — pick which diagrams (open tabs + named saves) and/or the
 *  Templates library to export. The active diagram is pre-selected, so the
 *  common "export current diagram" path is just one extra click. 1 element →
 *  native single-diagram / templates file; 2+ → a `diagramforce-export` bundle.
 *  A Select-All export resets the backup-reminder clock. */
function showExportModal() {
  document.querySelector('.df-export-modal')?.remove();

  const allTabs = modules.tabs.getAllTabs();
  const namedSaves = modules.persistence.getNamedSaves();
  const templateCount = modules.templates.getTemplates().length;

  // Human label for the right-accessory type badge (e.g. "Process", "Data Model").
  const typeLabel = (type) => (modules.tabs.DIAGRAM_TYPES?.[type]?.short) || 'Architecture';

  const tabRows = allTabs.map(t => {
    const rel = formatRelativeTime(t.lastModifiedAt || t.lastSavedAt);
    return `
    <div class="df-modal__row${t.isActive ? ' df-modal__row--active' : ''}">
      <input type="checkbox" class="df-modal__row-check" data-kind="tab" data-id="${escHtml(t.id)}" ${t.isActive ? 'checked' : ''}>
      <span class="df-modal__row-icon">${getDiagramTypeIcon(t.diagramType)}</span>
      <div class="df-modal__row-info">
        <span class="df-modal__row-label">${escHtml(t.name)}</span>
        <span class="df-modal__row-meta">${t.isActive ? 'current diagram' : 'open tab'}${rel ? ` · modified ${rel}` : ''}</span>
      </div>
      <span class="df-modal__row-badge">${escHtml(typeLabel(t.diagramType))}</span>
    </div>`;
  }).join('');

  const saveRows = namedSaves.map(s => {
    const rel = formatRelativeTime(s.timestamp);
    return `
    <div class="df-modal__row">
      <input type="checkbox" class="df-modal__row-check" data-kind="save" data-id="${escHtml(s.key)}">
      <span class="df-modal__row-icon">${getDiagramTypeIcon(s.diagramType)}</span>
      <div class="df-modal__row-info">
        <span class="df-modal__row-label">${escHtml(s.name)}</span>
        <span class="df-modal__row-meta">saved in browser${rel ? ` · ${rel}` : ''}</span>
      </div>
      <span class="df-modal__row-badge">${escHtml(typeLabel(s.diagramType))}</span>
    </div>`;
  }).join('');

  const templatesRow = templateCount > 0 ? `
    <div class="df-modal__row">
      <input type="checkbox" class="df-modal__row-check" data-kind="templates">
      <span class="df-modal__row-icon"><svg class="df-toolbar__icon" aria-hidden="true"><use href="#file"></use></svg></span>
      <div class="df-modal__row-info">
        <span class="df-modal__row-label">Templates</span>
        <span class="df-modal__row-meta">custom template library</span>
      </div>
      <span class="df-modal__row-badge">${templateCount}</span>
    </div>` : '';

  const fmtBackupAdvisory = () => {
    const lb = modules.persistence.getLastBackupAt();
    return lb
      ? `Last full backup: ${new Date(lb).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}.`
      : 'No full backup yet — use Back up now to back up everything.';
  };

  const { overlay, body: bodyEl, footer, close } = buildModal({
    title: 'Export to JSON',
    className: 'df-export-modal',
    dialogClass: 'df-save-modal__dialog', // 520px (shared with Save)
    bodyClass: 'df-modal__row-list',
    bodyHtml: `
      <div class="df-modal__advisory df-export-modal__advisory">
        <span class="df-export-modal__advisory-text"></span>
        <button class="df-modal__btn df-export-modal__backup-now">Back up now</button>
      </div>
      <div class="df-modal__list-box">
        <div class="df-modal__list-header">
          <label class="df-modal__select-all"><input type="checkbox" class="df-modal__check-all"> Select all</label>
        </div>
        ${tabRows}${saveRows}${templatesRow}
      </div>`,
    footerHtml: '<button class="df-modal__btn df-modal__btn--primary df-modal__action-btn" style="margin-left:auto" disabled>Export Selected</button>',
  });
  const advisoryText = bodyEl.querySelector('.df-export-modal__advisory-text');
  advisoryText.textContent = fmtBackupAdvisory(); // textContent — safe

  // "Back up now" — full backup of everything (resets the reminder clock); the
  // advisory date updates in place. The modal stays open. On success the button
  // flashes a brand-green "✓ Backed up!" for a beat, then reverts to the amber
  // outline (same affordance as the share "✓ Copied!" button).
  const backupNowBtn = bodyEl.querySelector('.df-export-modal__backup-now');
  let backupRevertTimer = null;
  backupNowBtn.addEventListener('click', () => {
    if (!modules.persistence.exportEverything()) return;
    advisoryText.textContent = fmtBackupAdvisory();
    backupNowBtn.classList.add('is-backed');
    backupNowBtn.textContent = '✓ Backed up!';
    clearTimeout(backupRevertTimer);
    backupRevertTimer = setTimeout(() => {
      backupNowBtn.classList.remove('is-backed');
      backupNowBtn.textContent = 'Back up now';
    }, 2000);
  });

  wireSelectAll(bodyEl, footer, '.df-modal__row-check', () => {
    const checks = [...overlay.querySelectorAll('.df-modal__row-check')];
    const checked = checks.filter(c => c.checked);
    if (checked.length === 0) return;
    const tabIds = checked.filter(c => c.dataset.kind === 'tab').map(c => c.dataset.id);
    const saveKeys = checked.filter(c => c.dataset.kind === 'save').map(c => c.dataset.id);
    const includeTemplates = checked.some(c => c.dataset.kind === 'templates');
    // Full backup = every row ticked (Select-All) → resets the reminder clock.
    const markBackup = checks.length > 0 && checks.every(c => c.checked);
    modules.persistence.exportSelection({ tabIds, saveKeys, includeTemplates }, { markBackup });
    close();
  });
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
}

function getDiagramTypeIcon(type) {
  const icons = {
    architecture: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="5" height="5" rx="1"/><rect x="10" y="1" width="5" height="5" rx="1"/><rect x="5.5" y="10" width="5" height="5" rx="1"/><path d="M3.5 6v2h9V6M8 8v2" stroke="currentColor" stroke-width="1" fill="none"/></svg>',
    process: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="7" y="5.5" width="5" height="5" rx="1"/><circle cx="3" cy="8" r="1"/><line x1="5.5" y1="8" x2="7" y2="8" stroke="currentColor" stroke-width="1.5"/></svg>',
    datamodel: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="1" width="6" height="3" rx="1"/><rect x="9" y="7" width="6" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="7" width="6" height="3" rx="1"/></svg>',
    datamapping: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="0.5" y="2" width="5" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="0.5" y="2" width="5" height="3" rx="1"/><rect x="10.5" y="2" width="5" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="10.5" y="2" width="5" height="3" rx="1"/><path d="M5.5 8 L10 8 M8.5 6.5 L10 8 L8.5 9.5" fill="none" stroke="currentColor" stroke-width="1"/><path d="M5.5 11 L10 11" stroke="currentColor" stroke-width="1" opacity="0.55"/></svg>',
    gantt: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="8" height="3" rx="1"/><rect x="4" y="7" width="9" height="3" rx="1" opacity="0.7"/><rect x="7" y="12" width="6" height="3" rx="1" opacity="0.5"/></svg>',
    org: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="5" y="1" width="6" height="4" rx="1"/><rect x="0.5" y="10" width="6" height="4" rx="1" opacity="0.7"/><rect x="9.5" y="10" width="6" height="4" rx="1" opacity="0.7"/><path d="M8 5v2H3.5V10M8 7h4.5V10" stroke="currentColor" stroke-width="1" fill="none"/></svg>',
  };
  return icons[type] || icons.architecture;
}

// Focus-trap handles for the two statically-rendered modals (about + load).
// Stored module-scope so the show/hide pair on each can release cleanly.
let _aboutTrapRelease = null;
let _loadTrapRelease = null;

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
  const item = document.createElement('div');
  item.className = 'df-modal__row';

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'df-modal__row-check';
  check.dataset.saveKey = save.key;

  const icon = document.createElement('span');
  icon.className = 'df-modal__row-icon';
  icon.innerHTML = getDiagramTypeIcon(save.diagramType);

  const info = document.createElement('div');
  info.className = 'df-modal__row-info';

  const name = document.createElement('span');
  name.className = 'df-modal__row-label';
  name.textContent = save.name;

  const meta = document.createElement('span');
  meta.className = 'df-modal__row-meta';
  meta.textContent = formatSaveMeta(save);

  info.appendChild(name);
  info.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'df-modal__row-actions';

  const loadBtn = document.createElement('button');
  loadBtn.className = 'df-modal__btn df-modal__btn--primary';
  loadBtn.textContent = 'Load';
  loadBtn.addEventListener('click', () => {
    if (modules.persistence.loadNamedSave(save.key)) {
      hideLoadModal();
    }
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'df-modal__btn df-modal__btn--danger';
  deleteBtn.title = 'Delete save';
  deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M6 2h4v1H6V2zm-3 2h10v1H3V4zm1 2h8l-.8 8H4.8L4 6zm2 1v5h1V7H6zm2 0v5h1V7H8z"/>
  </svg>`;
  deleteBtn.addEventListener('click', async () => {
    const ok = await confirmModal({
      title: 'Delete this save?',
      message: `"${save.name}" will be permanently removed from your browser. This cannot be undone.`,
      okLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (ok) {
      modules.persistence.deleteNamedSave(save.key);
      showToast(`Deleted "${save.name}"`, 'success');
      // Full rebuild (same as "Delete Selected") so the empty state renders
      // correctly when the last save goes. The old inline path did
      // `item.remove()` + `if (list.children.length === 0)`, but the body always
      // also holds the advisory + Select-all header, so that count was never 0
      // — leaving a headerful, rowless modal with no "no saves" message.
      showLoadModal();
    }
  });

  actions.appendChild(loadBtn);
  actions.appendChild(deleteBtn);

  item.appendChild(check);
  item.appendChild(icon);
  item.appendChild(info);
  item.appendChild(actions);
  return item;
}

function formatSaveMeta(save) {
  const savedAgo = formatRelativeTime(save.timestamp) || 'just now';
  const daysLeft = Math.ceil(save.expiresIn / (24 * 60 * 60 * 1000));
  const expiryStr = daysLeft <= 7
    ? `expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
    : `expires in ${daysLeft} days`;

  return `Saved ${savedAgo} · ${expiryStr}`;
}

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

  // Diagram | Table view switch — shown only for Data Mapping. Use inline display (not
  // the `hidden` attr): `.df-toolbar__group { display:flex }` outranks `[hidden]`, so the
  // attribute alone wouldn't hide it. Reset to the Diagram view on any tab change so the
  // table never lingers showing another tab's data.
  const vsGroup = document.getElementById('view-switch-group');
  const vsSep = document.getElementById('view-switch-sep');
  if (vsGroup) vsGroup.style.display = isDataMapping ? '' : 'none';
  if (vsSep) vsSep.style.display = isDataMapping ? '' : 'none';
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
  if (hmbView) hmbView.style.display = isDataMapping ? '' : 'none';
  const hmbMap = document.getElementById('hmb-map');
  if (hmbMap) hmbMap.style.display = isDataModel ? '' : 'none';

  // Show/hide Gantt-specific options
  const ganttSep = document.getElementById('display-gantt-separator');
  const ganttAssignee = document.getElementById('btn-gantt-assignee');
  const ganttProgress = document.getElementById('btn-gantt-progress');
  const ganttWeekStart = document.getElementById('btn-gantt-week-start');
  const ganttWeekendStart = document.getElementById('btn-gantt-weekend-start');
  const ganttWeekNumber = document.getElementById('btn-gantt-week-number');
  // Hide gantt separator always — auto-layout buttons (above) and gantt options are mutually exclusive
  if (ganttSep) ganttSep.style.display = 'none';
  if (ganttAssignee) ganttAssignee.style.display = isGantt ? '' : 'none';
  if (ganttProgress) ganttProgress.style.display = isGantt ? '' : 'none';
  if (ganttWeekStart) ganttWeekStart.style.display = isGantt ? '' : 'none';
  if (ganttWeekendStart) ganttWeekendStart.style.display = isGantt ? '' : 'none';
  if (ganttWeekNumber) ganttWeekNumber.style.display = isGantt ? '' : 'none';

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
  document.getElementById('btn-gantt-week-number')
    ?.classList.toggle('is-checked', getGanttTimelineSetting('showWeekNumber', false) === true);
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
  btn.setAttribute('title', nonDefault ? `${base} — some toggles active` : base);
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
      // Save / Load / Display all surface the real desktop dropdown as a mobile overlay, so
      // every option is reachable (Save's dropdown lives in the mobile-hidden toolbar group, so
      // the overlay helper relocates the menu to <body> to escape that hidden ancestor).
      case 'save':
        openDropdownAsMobileOverlay(document.getElementById('btn-save')?.closest('.df-toolbar__dropdown'));
        break;
      case 'load':
        openDropdownAsMobileOverlay(document.getElementById('btn-load')?.closest('.df-toolbar__dropdown'));
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

// Update only a menu item's text label, PRESERVING its leading <svg> icon.
// Setting `btn.textContent` would replace ALL child nodes including the icon —
// that was the "Save to GIF lost its icon while animating" bug.
function setMenuItemLabel(btnEl, label) {
  if (!btnEl) return;
  for (const node of btnEl.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      node.textContent = ` ${label}`;
      return;
    }
  }
  btnEl.appendChild(document.createTextNode(` ${label}`));
}

function updateExportButtons(animating) {
  // PNG export becomes a GIF while the flow is animating (the btn-save-png click
  // handlers in init() route to exportGIF when #paper has .df-animate-flow). Relabel
  // via setMenuItemLabel so the image icon survives the swap.
  setMenuItemLabel(document.getElementById('btn-save-png'), animating ? 'Save to GIF' : 'Save to PNG');
  setMenuItemLabel(document.getElementById('btn-save-png-t'), animating ? 'Save to transparent GIF' : 'Save to transparent PNG');
  // WEBP export captures only a single static frame, so it can't show the flow —
  // hide both WEBP options while animating (GIF is the animated raster export).
  const webp = document.getElementById('btn-save-webp');
  const webpT = document.getElementById('btn-save-webp-t');
  if (webp) webp.style.display = animating ? 'none' : '';
  if (webpT) webpT.style.display = animating ? 'none' : '';
}

function btn(id) {
  return document.getElementById(id);
}

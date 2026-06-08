// Tabs — multi-diagram tab management
// Each tab holds its own graph JSON, viewport, and undo/redo history.

import { APP_VERSION, classifyVersionDiff, normalizeDiagramType, isQuotaError, getStorageFootprint, STORAGE_WARNING_BYTES, compactGraphForSave } from './persistence.js?v=1.15.6';
import { escHtml, formatRelativeTime } from './util.js?v=1.15.6';
import { showError, showToast, buildModal } from './feedback.js?v=1.15.6';
import { createElementFromComponent } from './components.js?v=1.15.6';

let graph, paper, canvasModule, selectionModule, historyModule, persistenceModule, stencilModule;
let tabListEl;
const tabs = [];
let activeTabId = null;
let nextId = 1;
let pendingCloseAfterSave = null;
const onChangeCallbacks = [];

// Diagram types
export const DIAGRAM_TYPES = {
  architecture: { label: 'Architecture Diagram', short: 'Architecture' },
  process:      { label: 'Process Diagram',      short: 'Process' },
  sequence:     { label: 'Sequence Diagram',      short: 'Sequence' },
  datamodel:    { label: 'Data Model Diagram',   short: 'Data Model' },
  datamapping:  { label: 'Data Mapping Diagram', short: 'Data Mapping' },
  gantt:        { label: 'Gantt Chart',           short: 'Gantt' },
  org:          { label: 'Org Chart',             short: 'Org Chart' },
};

const STORAGE_KEY = 'sf-diagrams-tabs';

export function init(_graph, _paper, _canvas, _selection, _history, _persistence, _stencil) {
  graph = _graph;
  paper = _paper;
  canvasModule = _canvas;
  selectionModule = _selection;
  historyModule = _history;
  persistenceModule = _persistence;
  stencilModule = _stencil;

  tabListEl = document.getElementById('tab-list');

  // Gap 13 (v1.12.0) — gradient mask state on the tab list. CSS-side fade
  // hints at horizontal overflow; the listener toggles `--scrolled` /
  // `--scrolled-end` modifiers so the fade only renders where there's
  // actually clipped content. ResizeObserver covers the case where the
  // viewport shrinks and tabs that fit before now overflow.
  const refreshTabScrollMask = () => {
    if (!tabListEl) return;
    const { scrollLeft, scrollWidth, clientWidth } = tabListEl;
    const overflows = scrollWidth > clientWidth + 1;
    const atEnd = scrollLeft + clientWidth >= scrollWidth - 1;
    // The `--overflowing` modifier gates the base right-edge fade mask.
    // Without it, the mask would fade the rightmost tab's right border
    // even when nothing is clipped — the regression v1.12.1 fixes.
    tabListEl.classList.toggle('df-tabs__list--overflowing', overflows);
    tabListEl.classList.toggle('df-tabs__list--scrolled', overflows && scrollLeft > 0);
    tabListEl.classList.toggle('df-tabs__list--scrolled-end', overflows && atEnd);
  };
  tabListEl.addEventListener('scroll', refreshTabScrollMask, { passive: true });
  new ResizeObserver(refreshTabScrollMask).observe(tabListEl);
  // First-render check after the initial tab render lands.
  setTimeout(refreshTabScrollMask, 0);

  // + button opens new diagram modal
  document.getElementById('btn-new-tab').addEventListener('click', () => showNewDiagramModal());

  // Trash button opens multi-close modal
  document.getElementById('btn-close-tabs')?.addEventListener('click', () => showCloseTabsModal());

  // Wire up persistence hooks
  persistenceModule.setNewDiagramHandler(() => showNewDiagramModal());
  persistenceModule.onNamedSave((name) => renameActiveTab(name));
  persistenceModule.onSaveComplete((type) => markSaved(type));
  persistenceModule.setDiagramTypeGetter(() => getActiveTabType());
  persistenceModule.setTabNameGetter(() => getActiveTabName());
  persistenceModule.setAllTabsGetter(() => getAllTabs());
  persistenceModule.setTabGraphGetter((id) => getTabGraphJSON(id));
  persistenceModule.setTabViewportGetter((id) => getTabViewport(id));
  persistenceModule.setTabDiagramTypeGetter((id) => getTabDiagramType(id));
  persistenceModule.setTabMappingModeGetter((id) => getTabMappingMode(id));
  persistenceModule.setActiveMappingModeGetter(() => getActiveMappingMode());
  persistenceModule.setImportHandler((name, type, graphJSON, viewport, mappingMode) => {
    // Dismiss the new-diagram modal if it's open (e.g. first visit via share URL)
    document.querySelector('.df-new-modal')?.remove();
    // Back-compat: a pre-v1.15.0 Data Model diagram with mapping mode ON imports as
    // a first-class "Data Mapping" diagram (mapping is now its own type).
    let importType = type;
    if (mappingMode && normalizeDiagramType(type) === 'datamodel') importType = 'datamapping';
    const id = newTab(uniqueTabName(name), importType);
    // Carry the legacy flag forward too (harmless — the type already drives mapping).
    const importedTab = tabs.find(t => t.id === id);
    if (importedTab) importedTab.mappingMode = !!mappingMode;
    notifyChange();
    // The new tab is now active — load the graph into it
    canvasModule.setLoadingJSON(true);
    try { graph.fromJSON(graphJSON); canvasModule.migrateLinks(); canvasModule.migrateNodes(); } finally { canvasModule.setLoadingJSON(false); }
    // Loading content into a fresh tab IS a content event (markDirty is guarded
    // by isLoadingJSON, so it won't have stamped) — record it as the modified
    // time so imported / loaded / shared diagrams show a time like edited ones.
    const loadedTab = tabs.find(t => t.id === id);
    if (loadedTab) loadedTab.lastModifiedAt = Date.now();
    // Fit content to viewport after loading
    requestAnimationFrame(() => canvasModule.fitContent());
    // Persist immediately so the imported data survives a page refresh
    saveTabs();
  });

  // Restore tabs from localStorage or create a default one
  restoreTabs();
  render();

  // Notify listeners so toolbar Display menu, etc. update for the restored tab type
  notifyChange();

  // CR-7.1 / Gap 32 (v1.12.0) — boot-time storage-pressure check. Catches
  // the case where the user returns to the app with a near-full store
  // from previous sessions — by far the highest-value moment to warn,
  // since they have a fresh page to digest the toast before editing.
  // Deferred to a timeout so it doesn't slow first paint; the warning
  // toast itself fades after ~4 s either way.
  setTimeout(checkStoragePressure, 0);

  // Keep the active tab indicator aligned on resize/scroll
  window.addEventListener('resize', () => updateActiveTabIndicator());
  tabListEl.addEventListener('scroll', () => updateActiveTabIndicator());
}

function showNewDiagramModal() {
  // Remove any existing modal
  document.querySelector('.df-new-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'df-new-modal';
  overlay.innerHTML = `
    <div class="df-new-modal__backdrop"></div>
    <div class="df-new-modal__dialog">
      <h2 class="df-new-modal__title">Create New Diagram</h2>
      <div class="df-new-modal__grid">
        <button class="df-new-modal__card" data-type="architecture">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <rect x="4" y="4" width="18" height="14" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <rect x="42" y="4" width="18" height="14" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <rect x="23" y="30" width="18" height="14" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <path d="M13 18v6h38V18M32 24v6" stroke="var(--text-muted)" stroke-width="1.5" fill="none"/>
          </svg>
          <span class="df-new-modal__card-title">Architecture</span>
          <span class="df-new-modal__card-desc">Map system architecture, integrations, and infrastructure landscape.</span>
        </button>
        <button class="df-new-modal__card" data-type="datamodel">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <!-- Two objects, vertically offset (the small stagger) like a real schema relationship -->
            <rect x="3" y="5" width="18" height="22" rx="3" fill="none" stroke="var(--color-primary)" stroke-width="1.5"/>
            <rect x="3" y="5" width="18" height="8" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <rect x="43" y="21" width="18" height="22" rx="3" fill="none" stroke="var(--color-primary)" stroke-width="1.5"/>
            <rect x="43" y="21" width="18" height="8" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <!-- Orthogonal relationship connector, vertical leg centred between the objects so both
                 end-stubs are visible. Ends: "one" = a T-bar at the left object (stem runs right, no
                 line on the object side → reads as a T, not a cross); "zero or many" = open circle +
                 crow's foot at the right object. -->
            <g stroke="var(--text-secondary, #9AA0A6)" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 16 H29 V32 H40"/>
              <line x1="22" y1="12" x2="22" y2="20"/>
              <circle cx="36" cy="32" r="2.3" fill="var(--bg-app)"/>
              <path d="M40 32 L43 28 M40 32 L43 32 M40 32 L43 36"/>
            </g>
          </svg>
          <span class="df-new-modal__card-title">Data Model</span>
          <span class="df-new-modal__card-desc">Define objects, fields, and relationships like Schema Builder.</span>
        </button>
        <button class="df-new-modal__card" data-type="datamapping">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <rect x="3" y="9" width="22" height="30" rx="3" fill="none" stroke="var(--color-primary)" stroke-width="1.5"/>
            <rect x="3" y="9" width="22" height="8" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <rect x="39" y="9" width="22" height="30" rx="3" fill="none" stroke="var(--color-primary)" stroke-width="1.5"/>
            <rect x="39" y="9" width="22" height="8" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <path d="M25 24 L36 24 M32.5 20.5 L36 24 L32.5 27.5" fill="none" stroke="var(--color-accent)" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M25 32 L36 32 M32.5 28.5 L36 32 L32.5 35.5" fill="none" stroke="var(--color-accent)" stroke-width="1.5" stroke-linejoin="round" opacity="0.55"/>
          </svg>
          <span class="df-new-modal__card-title">Data Mapping</span>
          <span class="df-new-modal__card-desc">Map end-to-end data journey from source systems through Data Cloud pipelines to Activations.</span>
        </button>
        <button class="df-new-modal__card" data-type="process">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <circle cx="10" cy="24" r="6" fill="none" stroke="var(--color-primary)" stroke-width="2"/>
            <circle cx="10" cy="24" r="2.5" fill="var(--color-primary)"/>
            <rect x="22" y="17" width="20" height="14" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <path d="M48 16l8 8-8 8" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linejoin="round"/>
            <line x1="16" y1="24" x2="22" y2="24" stroke="var(--text-muted)" stroke-width="1.5"/>
            <line x1="42" y1="24" x2="48" y2="24" stroke="var(--text-muted)" stroke-width="1.5"/>
          </svg>
          <span class="df-new-modal__card-title">Process</span>
          <span class="df-new-modal__card-desc">Design business processes, flows, and BPMN workflows.</span>
        </button>
        <button class="df-new-modal__card" data-type="sequence">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <rect x="4" y="4" width="14" height="7" rx="2" fill="var(--color-primary)" opacity="0.85"/>
            <rect x="25" y="4" width="14" height="7" rx="2" fill="var(--color-primary)" opacity="0.65"/>
            <rect x="46" y="4" width="14" height="7" rx="2" fill="var(--color-primary)" opacity="0.5"/>
            <line x1="11" y1="11" x2="11" y2="44" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 2"/>
            <line x1="32" y1="11" x2="32" y2="44" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 2"/>
            <line x1="53" y1="11" x2="53" y2="44" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 2"/>
            <line x1="11" y1="20" x2="32" y2="20" stroke="var(--color-primary)" stroke-width="1.5"/>
            <polygon points="32,20 28,18 28,22" fill="var(--color-primary)"/>
            <line x1="32" y1="30" x2="53" y2="30" stroke="var(--color-primary)" stroke-width="1.5"/>
            <polygon points="53,30 49,28 49,32" fill="var(--color-primary)"/>
            <line x1="32" y1="38" x2="11" y2="38" stroke="var(--color-accent)" stroke-width="1" stroke-dasharray="3 2"/>
            <polygon points="11,38 15,36 15,40" fill="var(--color-accent)"/>
          </svg>
          <span class="df-new-modal__card-title">Sequence</span>
          <span class="df-new-modal__card-desc">Document request/response interactions between systems.</span>
        </button>
        <button class="df-new-modal__card" data-type="gantt">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <rect x="8" y="6" width="24" height="7" rx="2" fill="var(--color-primary)" opacity="0.8"/>
            <rect x="16" y="17" width="28" height="7" rx="2" fill="var(--color-primary)" opacity="0.6"/>
            <rect x="24" y="28" width="18" height="7" rx="2" fill="var(--color-primary)" opacity="0.4"/>
            <line x1="32" y1="13" x2="32" y2="17" stroke="var(--text-muted)" stroke-width="1"/>
            <line x1="42" y1="24" x2="42" y2="28" stroke="var(--text-muted)" stroke-width="1"/>
            <polygon points="30,35 33,28 36,35" fill="var(--color-accent)"/>
          </svg>
          <span class="df-new-modal__card-title">Gantt Chart</span>
          <span class="df-new-modal__card-desc">Plan project timelines, tasks, milestones, and dependencies.</span>
        </button>
        <button class="df-new-modal__card" data-type="org">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <rect x="20" y="2" width="24" height="14" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <rect x="2" y="28" width="24" height="14" rx="3" fill="var(--color-primary)" opacity="0.6"/>
            <rect x="38" y="28" width="24" height="14" rx="3" fill="var(--color-primary)" opacity="0.6"/>
            <line x1="32" y1="16" x2="32" y2="22" stroke="var(--text-muted)" stroke-width="1.5"/>
            <line x1="14" y1="22" x2="50" y2="22" stroke="var(--text-muted)" stroke-width="1.5"/>
            <line x1="14" y1="22" x2="14" y2="28" stroke="var(--text-muted)" stroke-width="1.5"/>
            <line x1="50" y1="22" x2="50" y2="28" stroke="var(--text-muted)" stroke-width="1.5"/>
          </svg>
          <span class="df-new-modal__card-title">Org Chart</span>
          <span class="df-new-modal__card-desc">Document team hierarchy, roles, and responsibilities.</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Card clicks
  overlay.querySelectorAll('.df-new-modal__card').forEach(card => {
    card.addEventListener('click', () => {
      const type = card.dataset.type;
      overlay.remove();
      const typeLabel = DIAGRAM_TYPES[type]?.short || 'Draft';
      const baseName = typeLabel + ' Draft';
      newTab(uniqueTabName(baseName), type);
    });
  });

  // Only allow dismissal when at least one tab already exists
  const canDismiss = tabs.length > 0;

  if (canDismiss) {
    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'df-new-modal__close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    closeBtn.addEventListener('click', () => { overlay.remove(); });
    overlay.querySelector('.df-new-modal__dialog').appendChild(closeBtn);

    // Close on backdrop click
    overlay.querySelector('.df-new-modal__backdrop').addEventListener('click', () => { overlay.remove(); });

    // Close on Escape
    const onKey = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
  }
}

function generateId() {
  return `tab-${nextId++}`;
}

/** Return a name that doesn't clash with any existing tab. */
function uniqueTabName(base) {
  const existing = new Set(tabs.map(t => t.name));
  if (!existing.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!existing.has(candidate)) return candidate;
  }
}

export function newTab(name = 'Draft', diagramType = 'architecture') {
  // Save current tab state before switching
  saveCurrentTabState();

  const id = generateId();
  tabs.push({ id, name, diagramType: normalizeDiagramType(diagramType), graphJSON: null, viewport: null, mappingMode: false, dirty: false, lastSavedAt: null, lastSaveType: null, lastModifiedAt: null });
  activateTab(id, true);
  render();
  return id;
}

/**
 * Map bridge (Data Model → Data Mapping). Deep-clones the current diagram's cells —
 * ids, field `fid`s, and coordinates all preserved — wraps every object in a default
 * "Source" layer, and loads the result into a brand-new Data Mapping tab named
 * "<name> Mapping". The graph stays the single source of truth: the wrapped clone is
 * assembled in memory and committed in ONE atomic `fromJSON` (guarded by
 * setLoadingJSON, so it's the new tab's initial content — no partial state, no flicker,
 * no spurious undo entry), exactly like the import path. Returns the new tab id, or
 * null when there are no objects to map.
 */
export function cloneToMappingTab() {
  // Snapshot the live canvas so toJSON reflects exactly what the user sees.
  saveCurrentTabState();
  const sourceName = getActiveTabName();
  const cells = Array.isArray(graph.toJSON().cells) ? graph.toJSON().cells : [];
  // Deep clone keeping ids/fids/positions intact — the new tab is a SEPARATE graph,
  // so reusing ids is safe and keeps mapping references aligned to the source model.
  const clones = cells.map(c => JSON.parse(JSON.stringify(c)));
  const objs = clones.filter(c => c.type === 'sf.DataObject');
  if (objs.length === 0) return null;   // nothing to wrap → no-op

  // Bounding box of the objects (position + size) for the Source wrapper.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity;
  for (const o of objs) {
    const p = o.position || { x: 0, y: 0 };
    const s = o.size || { width: 200, height: 80 };
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + s.width); maxY = Math.max(maxY, p.y + s.height);
    if (typeof o.z === 'number') minZ = Math.min(minZ, o.z);
  }
  const PAD = 48, TOP_PAD = 56;   // comfortable padding; extra at top for the zone label

  // Mint a real Source zone (carries the canonical Zone attrs + layerStage), sized to
  // encapsulate every object with padding, and placed behind them (lower z).
  const zone = createElementFromComponent(
    { type: 'sf.Zone', label: 'Source', accentColor: '#1D73C9', layerStage: 'source' },
    { x: minX - PAD, y: minY - TOP_PAD },
  );
  zone.resize((maxX - minX) + PAD * 2, (maxY - minY) + TOP_PAD + PAD);
  const zoneJSON = zone.toJSON();
  const zoneId = zoneJSON.id;
  zoneJSON.z = (minZ === Infinity ? 1 : minZ) - 1;
  zoneJSON.embeds = objs.map(o => o.id);

  // Re-parent every object into the Source zone; defensively drop any stale embeds on
  // other cells so an object can't end up double-parented (flat ER models have none).
  const objIds = new Set(objs.map(o => o.id));
  for (const c of clones) {
    if (c.type === 'sf.DataObject') c.parent = zoneId;
    else if (Array.isArray(c.embeds)) c.embeds = c.embeds.filter(id => !objIds.has(id));
  }

  // Open a fresh Data Mapping tab and commit the wrapped clone atomically (mirrors the
  // import handler — setLoadingJSON guards history/dirty; migrate normalizes the cells).
  const id = newTab(uniqueTabName(`${sourceName} Mapping`), 'datamapping');
  notifyChange();
  canvasModule.setLoadingJSON(true);
  try {
    graph.fromJSON({ cells: [zoneJSON, ...clones] });
    canvasModule.migrateLinks();
    canvasModule.migrateNodes();
  } finally {
    canvasModule.setLoadingJSON(false);
  }
  const t = tabs.find(x => x.id === id);
  if (t) { t.mappingMode = true; t.lastModifiedAt = Date.now(); }
  requestAnimationFrame(() => canvasModule.fitContent());
  saveTabs();
  notifyChange();
  return id;
}

export function closeTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;

  // If the tab has unsaved changes, ask for confirmation
  if (tab.dirty) {
    showCloseConfirmModal(id, tab.name);
    return;
  }

  doCloseTab(id);
}

function doCloseTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  // Last tab — remove it and show unclosable new-diagram modal
  if (tabs.length === 1) {
    tabs.splice(0, 1);
    activeTabId = null;
    selectionModule.clearSelection();
    canvasModule.setLoadingJSON(true);
    try { graph.fromJSON({ cells: [] }); } finally { canvasModule.setLoadingJSON(false); }
    canvasModule.setViewport({ zoom: 1, translate: { tx: 0, ty: 0 } });
    render();
    saveTabs();
    showNewDiagramModal();
    return;
  }

  tabs.splice(idx, 1);

  if (activeTabId === id) {
    // Switch to the closest remaining tab
    const newIdx = Math.min(idx, tabs.length - 1);
    activateTab(tabs[newIdx].id, false);
  }

  render();
  saveTabs();
}

function showCloseConfirmModal(tabId, tabName) {
  document.querySelector('.df-close-confirm-modal')?.remove();

  const { footer, close } = buildModal({
    title: 'Unsaved Changes',
    className: 'df-close-confirm-modal',
    zIndex: 3000,
    width: '380px',
    showClose: false, // decision dialog — dismiss via Cancel / backdrop / Escape
    bodyStyle: 'padding:var(--spacing-md) var(--spacing-lg)',
    bodyHtml: `
      <p style="margin:0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">
        <strong style="color:var(--text-primary)">${escHtml(tabName)}</strong> has unsaved changes that will be lost.
      </p>`,
    footerHtml: `
      <button class="df-close-confirm__btn df-close-confirm__btn--cancel" style="margin-right:auto">Cancel</button>
      <button class="df-close-confirm__btn df-close-confirm__btn--save">Save and Close</button>
      <button class="df-close-confirm__btn df-close-confirm__btn--discard">Discard</button>`,
  });

  footer.querySelector('.df-close-confirm__btn--cancel').addEventListener('click', close);

  footer.querySelector('.df-close-confirm__btn--save').addEventListener('click', () => {
    close();
    // Switch to the tab first if not active, then trigger save
    if (tabId !== activeTabId) switchTab(tabId);
    // Set flag so markSaved() will close the tab after save completes
    pendingCloseAfterSave = tabId;
    persistenceModule.namedSave();
  });

  footer.querySelector('.df-close-confirm__btn--discard').addEventListener('click', () => {
    close();
    // Force close without checking dirty again
    const tab = tabs.find(t => t.id === tabId);
    if (tab) tab.dirty = false;
    doCloseTab(tabId);
  });
}

function typeIconSvg(diagramType) {
  let inner;
  if (diagramType === 'process') {
    inner = '<circle cx="3" cy="8" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="7" y="5.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="3" cy="8" r="1" fill="currentColor"/><line x1="5.5" y1="8" x2="7" y2="8" stroke="currentColor" stroke-width="1.5"/>';
  } else if (diagramType === 'sequence') {
    inner = '<rect x="1" y="1" width="5" height="3" rx="0.5" fill="currentColor"/><rect x="10" y="1" width="5" height="3" rx="0.5" fill="currentColor"/><line x1="3.5" y1="4" x2="3.5" y2="15" stroke="currentColor" stroke-width="0.8" stroke-dasharray="1.5 1"/><line x1="12.5" y1="4" x2="12.5" y2="15" stroke="currentColor" stroke-width="0.8" stroke-dasharray="1.5 1"/><line x1="3.5" y1="8" x2="12.5" y2="8" stroke="currentColor" stroke-width="1"/><polygon points="12.5,8 10.5,7 10.5,9" fill="currentColor"/><line x1="12.5" y1="12" x2="3.5" y2="12" stroke="currentColor" stroke-width="0.8" stroke-dasharray="1.5 1"/><polygon points="3.5,12 5.5,11 5.5,13" fill="currentColor"/>';
  } else if (diagramType === 'datamodel') {
    inner = '<rect x="1" y="1" width="6" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="1" width="6" height="3" rx="1" fill="currentColor"/><rect x="9" y="7" width="6" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="7" width="6" height="3" rx="1" fill="currentColor"/><path d="M7 5L9 11" stroke="currentColor" stroke-width="1.2" fill="none"/>';
  } else if (diagramType === 'datamapping') {
    inner = '<rect x="0.5" y="2" width="5" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="0.5" y="2" width="5" height="3" rx="1" fill="currentColor"/><rect x="10.5" y="2" width="5" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="10.5" y="2" width="5" height="3" rx="1" fill="currentColor"/><path d="M5.5 8 L10 8 M8.5 6.5 L10 8 L8.5 9.5" fill="none" stroke="currentColor" stroke-width="1"/><path d="M5.5 11 L10 11" stroke="currentColor" stroke-width="1" opacity="0.55"/>';
  } else if (diagramType === 'gantt') {
    inner = '<rect x="1" y="2" width="8" height="3" rx="1" fill="currentColor"/><rect x="4" y="7" width="9" height="3" rx="1" fill="currentColor" opacity="0.7"/><rect x="7" y="12" width="6" height="3" rx="1" fill="currentColor" opacity="0.5"/>';
  } else if (diagramType === 'org') {
    inner = '<rect x="5" y="1" width="6" height="4" rx="1" fill="currentColor"/><rect x="0.5" y="10" width="6" height="4" rx="1" fill="currentColor" opacity="0.7"/><rect x="9.5" y="10" width="6" height="4" rx="1" fill="currentColor" opacity="0.7"/><path d="M8 5v2H3.5V10M8 7h4.5V10" stroke="currentColor" stroke-width="1" fill="none"/>';
  } else {
    inner = '<rect x="1" y="1" width="5" height="5" rx="1"/><rect x="10" y="1" width="5" height="5" rx="1"/><rect x="5.5" y="10" width="5" height="5" rx="1"/><path d="M3.5 6v2h9V6M8 8v2" stroke="currentColor" stroke-width="1" fill="none"/>';
  }
  return `<svg class="df-close-tabs__type-icon" viewBox="0 0 16 16" fill="currentColor">${inner}</svg>`;
}

function showCloseTabsModal() {
  if (tabs.length === 0) return;

  document.querySelector('.df-close-tabs-modal')?.remove();

  const rowsHtml = tabs.map(t => {
    const active = t.id === activeTabId ? ' (active)' : '';
    const typeLabel = DIAGRAM_TYPES[t.diagramType]?.short || 'Architecture';
    const rel = formatRelativeTime(t.lastModifiedAt || t.lastSavedAt);
    return `
      <label class="df-close-tabs__row" data-tab-id="${escHtml(t.id)}">
        <input type="checkbox" class="df-close-tabs__checkbox" data-tab-id="${escHtml(t.id)}" />
        ${typeIconSvg(t.diagramType)}
        ${t.dirty ? '<span class="df-close-tabs__dirty" title="Unsaved changes"></span>' : ''}
        <div class="df-close-tabs__info">
          <span class="df-close-tabs__name">${escHtml(t.name)}${active}</span>
          ${rel ? `<span class="df-close-tabs__meta">Modified ${rel}</span>` : ''}
        </div>
        <span class="df-close-tabs__badge">${escHtml(typeLabel)}</span>
      </label>`;
  }).join('');

  // dialog width (460px/90vw) comes from `.df-close-tabs-modal .df-modal__dialog` CSS
  const { body, footer, close } = buildModal({
    title: 'Close Multiple Tabs',
    className: 'df-close-tabs-modal',
    zIndex: 3000,
    bodyStyle: 'padding:var(--spacing-md) var(--spacing-lg)',
    bodyHtml: `
      <p style="margin:0 0 var(--spacing-sm);color:var(--text-secondary);font-size:var(--font-size-sm)">
        Select the tabs you want to close.
      </p>
      <div class="df-close-tabs__list">
        <label class="df-close-tabs__row df-close-tabs__row--header">
          <input type="checkbox" class="df-close-tabs__checkbox" data-role="select-all" />
          <span class="df-close-tabs__name">Select all</span>
        </label>
        ${rowsHtml}
      </div>`,
    footerHtml: '<button class="df-close-tabs__btn df-close-tabs__btn--primary" data-action="close" style="margin-left:auto" disabled>Close Selected</button>',
  });

  const selectAllEl = body.querySelector('[data-role="select-all"]');
  const rowBoxes = Array.from(body.querySelectorAll('.df-close-tabs__checkbox[data-tab-id]'));
  const closeBtn = footer.querySelector('[data-action="close"]');

  const updateState = () => {
    const checked = rowBoxes.filter(b => b.checked);
    closeBtn.disabled = checked.length === 0;
    closeBtn.textContent = checked.length > 1 ? `Close Selected (${checked.length})` : 'Close Selected';
    if (checked.length === 0) {
      selectAllEl.checked = false;
      selectAllEl.indeterminate = false;
    } else if (checked.length === rowBoxes.length) {
      selectAllEl.checked = true;
      selectAllEl.indeterminate = false;
    } else {
      selectAllEl.checked = false;
      selectAllEl.indeterminate = true;
    }
  };

  selectAllEl.addEventListener('change', () => {
    rowBoxes.forEach(b => { b.checked = selectAllEl.checked; });
    updateState();
  });
  rowBoxes.forEach(b => b.addEventListener('change', updateState));

  // Clicking the row (outside the native label-to-input propagation edge cases)
  // — rely on default label click behaviour, but make sure checkbox doesn't double-fire.
  body.querySelectorAll('.df-close-tabs__row[data-tab-id]').forEach(row => {
    row.addEventListener('click', (e) => {
      // The <label> already forwards clicks to the checkbox; just stop propagation
      // from the checkbox itself so it doesn't trigger twice.
      if (e.target.tagName === 'INPUT') e.stopPropagation();
    });
  });

  closeBtn.addEventListener('click', () => {
    const selectedIds = rowBoxes.filter(b => b.checked).map(b => b.dataset.tabId);
    if (selectedIds.length === 0) return;
    const dirtyIds = selectedIds.filter(id => tabs.find(t => t.id === id)?.dirty);
    if (dirtyIds.length > 0) {
      showMultiDiscardConfirm(
        dirtyIds.length,
        () => { close(); performMultiClose(selectedIds); },
        () => {
          close();
          persistenceModule.saveMultipleTabs(dirtyIds);
          performMultiClose(selectedIds);
        }
      );
    } else {
      close();
      performMultiClose(selectedIds);
    }
  });
}

function performMultiClose(ids) {
  // Mark all selected tabs as non-dirty so doCloseTab proceeds without prompting.
  for (const id of ids) {
    const tab = tabs.find(t => t.id === id);
    if (tab) tab.dirty = false;
  }
  // Close in reverse so splice indices stay stable and we don't churn the active tab.
  // If the active tab is in the set, doCloseTab will switch to the nearest remaining
  // one each time — which is the right behaviour.
  for (const id of [...ids]) {
    if (tabs.some(t => t.id === id)) doCloseTab(id);
  }
}

function showMultiDiscardConfirm(dirtyCount, onDiscard, onSaveAndClose) {
  const { footer, close } = buildModal({
    title: 'Unsaved Changes',
    zIndex: 3100,
    width: '460px',
    showClose: false, // decision dialog — dismiss via Cancel / backdrop / Escape
    bodyStyle: 'padding:var(--spacing-md) var(--spacing-lg)',
    bodyHtml: `
      <p style="margin:0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">
        <strong style="color:var(--text-primary)">${dirtyCount}</strong> of the selected tabs ${dirtyCount === 1 ? 'has' : 'have'} unsaved changes. Save to Browser Storage first, or close without saving?
      </p>`,
    footerHtml: `
      <button class="df-close-tabs__btn" data-action="cancel" style="margin-right:auto">Cancel</button>
      <button class="df-close-tabs__btn df-close-tabs__btn--save" data-action="save">Save and Close</button>
      <button class="df-close-tabs__btn df-close-tabs__btn--primary" data-action="confirm">Close Anyway</button>`,
  });
  footer.querySelector('[data-action="cancel"]').addEventListener('click', close);
  footer.querySelector('[data-action="save"]').addEventListener('click', () => { close(); onSaveAndClose(); });
  footer.querySelector('[data-action="confirm"]').addEventListener('click', () => { close(); onDiscard(); });
}

function switchTab(id) {
  if (id === activeTabId) return;
  saveCurrentTabState();
  activateTab(id, false);
  render();
}

function renameTab(id, name) {
  const tab = tabs.find(t => t.id === id);
  if (tab) {
    tab.name = name;
    render();
    saveTabs();
  }
}

export function renameActiveTab(name) {
  renameTab(activeTabId, name);
}

export function getActiveTabId() {
  return activeTabId;
}

export function getActiveTabName() {
  return tabs.find(t => t.id === activeTabId)?.name || 'Draft';
}

export function getActiveTabType() {
  return tabs.find(t => t.id === activeTabId)?.diagramType || 'architecture';
}

function markDirty() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  // Stamp the modified time on REAL edits only — the change handler also fires
  // during fromJSON loads / tab switches (guarded by canvas isLoadingJSON), and
  // those must not count as "modified".
  if (!canvasModule.isLoadingJSON?.()) {
    tab.lastModifiedAt = Date.now();
  }
  if (!tab.dirty) {
    tab.dirty = true;
    render();
  }
}

export function markSaved(saveType) {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) {
    tab.dirty = false;
    tab.lastSavedAt = Date.now();
    tab.lastSaveType = saveType;
    render();
  }

  // If a "Save and Close" was pending, close the tab now
  if (pendingCloseAfterSave) {
    const closeId = pendingCloseAfterSave;
    pendingCloseAfterSave = null;
    doCloseTab(closeId);
  }
}


/**
 * Gap 21 (v1.12.0) — true when any open tab has uncommitted changes that
 * the user hasn't yet persisted via Save-to-Browser / JSON export. Used by
 * the global `beforeunload` guard in app.js so a stray ⌘R / browser close
 * doesn't silently drop work. The session-restore safety net usually
 * catches refreshes, but quota errors and Private Mode can break it — the
 * native confirmation is a belt-and-braces guarantee.
 */
export function hasAnyDirty() {
  return tabs.some(t => t.dirty);
}

/** Return lightweight info for every open tab (used by save modal). */
export function getAllTabs() {
  return tabs.map(t => ({
    id: t.id,
    name: t.name,
    diagramType: t.diagramType,
    isActive: t.id === activeTabId,
    dirty: t.dirty,
    lastModifiedAt: t.lastModifiedAt || null,
    lastSavedAt: t.lastSavedAt || null,
  }));
}

/** Get the graph JSON for a specific tab. Active tab reads live graph. */
export function getTabGraphJSON(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return null;
  if (tab.id === activeTabId) return graph.toJSON();
  return tab.graphJSON;
}

/** Get viewport for a specific tab. */
export function getTabViewport(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return null;
  if (tab.id === activeTabId) return canvasModule.getViewport();
  return tab.viewport;
}

/** Get diagram type for a specific tab. */
export function getTabDiagramType(tabId) {
  return tabs.find(t => t.id === tabId)?.diagramType || 'architecture';
}

/** Data Cloud mapping mode (per-diagram). Gates the mapping-specific editing
 *  affordances; mappings/badges still render regardless, so shared diagrams show
 *  them. Persisted in the session tab state. */
export function getActiveMappingMode() {
  const tab = tabs.find(t => t.id === activeTabId);
  // Mapping mode is driven by the diagram TYPE (its own "Data Mapping" type); the
  // legacy per-tab `mappingMode` flag is still honoured for back-compat.
  return tab?.diagramType === 'datamapping' || !!tab?.mappingMode;
}
export function getTabMappingMode(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  return tab?.diagramType === 'datamapping' || !!tab?.mappingMode;
}
export function setActiveMappingMode(on) {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  tab.mappingMode = !!on;
  // Re-sync DataObject field ports so mapping ports appear/disappear immediately
  // (mapping ON = every field connectable; OFF = PK/FK + already-linked only).
  for (const el of graph.getElements()) {
    if (el.get('type') !== 'sf.DataObject') continue;
    const view = el.findView(paper);
    if (view && typeof view._syncFieldPorts === 'function') view._syncFieldPorts();
  }
  saveTabs();
  notifyChange();
}

export function onChange(cb) { onChangeCallbacks.push(cb); }
function notifyChange() { onChangeCallbacks.forEach(cb => cb()); }

// ── Internal ─────────────────────────────────────────────────────────

function saveCurrentTabState() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  tab.graphJSON = graph.toJSON();
  tab.viewport = canvasModule.getViewport();
  // Preserve undo/redo stacks for this tab
  tab.historyState = historyModule.save();
}

function activateTab(id, isFresh) {
  activeTabId = id;
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;

  selectionModule.clearSelection();

  // Restore per-tab undo/redo stacks (or clear for fresh tabs)
  if (isFresh || !tab.historyState) {
    historyModule.clear();
  } else {
    historyModule.restore(tab.historyState);
  }

  if (isFresh || !tab.graphJSON) {
    // Brand new tab — clear the canvas
    canvasModule.setLoadingJSON(true);
    try { graph.fromJSON({ cells: [] }); } finally { canvasModule.setLoadingJSON(false); }
    canvasModule.setViewport({ zoom: 1, translate: { tx: 0, ty: 0 } });
  } else {
    // Restore saved state
    canvasModule.setLoadingJSON(true);
    try { graph.fromJSON(tab.graphJSON); canvasModule.migrateLinks(); canvasModule.migrateNodes(); } finally { canvasModule.setLoadingJSON(false); }
    if (tab.viewport) canvasModule.setViewport(tab.viewport);
  }

  // Update stencil for diagram type
  if (stencilModule?.setDiagramType) {
    stencilModule.setDiagramType(tab.diagramType || 'architecture');
  }
  // Tell the canvas which empty-state ghost wireframe to show (CSS reads this).
  document.getElementById('canvas-container')?.setAttribute('data-diagram-type', tab.diagramType || 'architecture');

  saveTabs();
  notifyChange();
}

// ── Persistence ──────────────────────────────────────────────────────

function saveTabs() {
  try {
    // Save lightweight tab metadata (not graph data — that's per-tab autosave)
    const data = tabs.map(t => ({ id: t.id, name: t.name, dirty: t.dirty }));
    const meta = { activeTabId, nextId, appVersion: APP_VERSION, tabs: data };

    // Also save full graph state for each tab
    const full = tabs.map(t => ({
      id: t.id,
      name: t.name,
      diagramType: t.diagramType || 'architecture',
      mappingMode: t.mappingMode || false,
      dirty: t.dirty,
      lastSavedAt: t.lastSavedAt || null,
      lastSaveType: t.lastSaveType || null,
      lastModifiedAt: t.lastModifiedAt || null,
      // Compact each tab's graph (drop reconstructed-on-load ports/size/angle/icon/routing) so the
      // session blob — the heaviest, most-frequently-written localStorage entry — stays small.
      // compactGraphForSave deep-clones, so the live `t.graphJSON` is untouched; session restore
      // rebuilds everything via the common fromJSON + migrate path.
      graphJSON: compactGraphForSave(t.id === activeTabId ? graph.toJSON() : t.graphJSON),
      viewport: t.id === activeTabId ? canvasModule.getViewport() : t.viewport,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...meta, tabs: full }));
    // CR-7.1 / Gap 32 (v1.12.0) — proactive pressure check, sampled every
    // 5 successful saves. The deterministic counter (not random) makes
    // behaviour reproducible for debugging. The footprint loop itself is
    // O(keys) and well under a millisecond, so we could check on every
    // save without measurable cost — the sampling is purely to avoid
    // doing work whose result can't realistically change in <5 saves.
    if (++saveCounter % 5 === 0) checkStoragePressure();
  } catch (err) {
    // Gap 22 (v1.12.0) — distinguish quota errors so the user sees a
    // clear recovery path. Throttle the toast to once per session so we
    // don't spam during continuous editing — the user only needs the
    // warning the first time the backup starts dropping writes.
    if (isQuotaError(err) && !quotaToastShown) {
      quotaToastShown = true;
      showError('Browser storage full — session backup paused. Export to JSON or delete saved diagrams to make space.');
    }
    console.warn('SF Diagrams: Tab save failed:', err);
  }
}

// Module-level flag so the quota toast fires at most once per page load
// (Gap 22, v1.12.0). Reset by reload — that's the natural moment for the
// user to address the underlying storage issue.
let quotaToastShown = false;

// CR-7.1 / Gap 32 (v1.12.0) — pressure-gauge state. The counter sampling
// every 5 saves is documented above at the call site. The toast-shown
// flag ensures at most one pressure warning per page load — same
// throttling rationale as `quotaToastShown`: once shown, the user owns
// the next action, and re-firing every few saves would be nagging.
let saveCounter = 0;
let pressureToastShown = false;

/**
 * CR-7.1 / Gap 32 (v1.12.0) — read the current storage footprint and
 * fire a single warning toast if we're approaching the quota wall.
 * Idempotent after the first fire (the `pressureToastShown` flag stays
 * set until reload). Called once on boot and every 5th successful save.
 */
function checkStoragePressure() {
  if (pressureToastShown) return;
  let bytes;
  try {
    bytes = getStorageFootprint();
  } catch {
    // Defensive: some Private Mode contexts throw on `localStorage.length`
    // access. Bail silently — the worst case is no warning, never a crash.
    return;
  }
  if (bytes < STORAGE_WARNING_BYTES) return;
  pressureToastShown = true;
  showToast(
    'Browser storage almost full. Export to JSON and delete saved diagrams to free space.',
    'warning'
  );
}

/** Populate tabs array and load the active tab from parsed session data. */
function doRestoreTabData(data) {
  if (data.nextId) nextId = data.nextId;

  if (data.tabs?.length > 0) {
    for (const t of data.tabs) {
      // Back-compat: a pre-v1.15.0 Data Model diagram with mapping mode ON becomes
      // a first-class "Data Mapping" diagram (mapping is now its own type).
      let dt = normalizeDiagramType(t.diagramType);
      if (t.mappingMode && dt === 'datamodel') dt = 'datamapping';
      tabs.push({
        id: t.id,
        name: t.name || 'Draft',
        diagramType: dt,
        graphJSON: t.graphJSON || null,
        viewport: t.viewport || null,
        mappingMode: t.mappingMode || false,
        dirty: t.dirty || (!t.lastSavedAt && t.graphJSON?.cells?.length > 0) || false,
        lastSavedAt: t.lastSavedAt || null,
        lastSaveType: t.lastSaveType || null,
        // Persisted modified time wins; else fall back to the save time; else,
        // for a content-bearing tab from before this field existed, stamp now
        // (one-time migration — persisted on the next save, so it won't reset).
        lastModifiedAt: t.lastModifiedAt || t.lastSavedAt
          || (t.graphJSON?.cells?.length > 0 ? Date.now() : null),
      });
    }
    activeTabId = data.activeTabId || tabs[0].id;
  } else {
    const id = generateId();
    tabs.push({ id, name: 'Draft', diagramType: 'architecture', graphJSON: null, viewport: null, dirty: false, lastSavedAt: null, lastSaveType: null, lastModifiedAt: null });
    activeTabId = id;
  }

  // Load the active tab's state
  const active = tabs.find(t => t.id === activeTabId);
  if (active?.graphJSON) {
    canvasModule.setLoadingJSON(true);
    try { graph.fromJSON(active.graphJSON); canvasModule.migrateLinks(); canvasModule.migrateNodes(); } finally { canvasModule.setLoadingJSON(false); }
    if (active.viewport) canvasModule.setViewport(active.viewport);
  }
  // Set stencil for active tab's diagram type
  if (stencilModule?.setDiagramType) {
    stencilModule.setDiagramType(active?.diagramType || 'architecture');
  }
  // Seed the empty-state ghost-wireframe type on first paint (restore bypasses activateTab).
  document.getElementById('canvas-container')?.setAttribute('data-diagram-type', active?.diagramType || 'architecture');
}

function restoreTabs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // No saved tabs — show new diagram modal as starting point
      showNewDiagramModal();
      return;
    }

    const data = JSON.parse(raw);

    // Check stored version against current app version.
    // Sessions saved before versioning was introduced have no appVersion —
    // treat them as 1.0.0 (the last version without this field).
    const savedVersion = data.appVersion || '1.0.0';
    const diff = classifyVersionDiff(savedVersion);
    if (diff === 'major') {
      // Major version mismatch — ask user whether to reset or try loading
      showSessionVersionWarning(savedVersion, 'major').then(tryLoad => {
        if (tryLoad) {
          doRestoreTabData(data);
          saveTabs(); // stamp current version so warning doesn't repeat
        } else {
          localStorage.removeItem(STORAGE_KEY);
          showNewDiagramModal();
        }
        render();
      });
      return;
    }
    if (diff === 'minor') {
      // Minor version mismatch — show notice but restore normally
      showSessionVersionWarning(savedVersion, 'minor');
    }

    doRestoreTabData(data);

    if (diff !== 'none') {
      saveTabs(); // stamp current version so warning doesn't repeat
    }

  } catch (err) {
    console.warn('SF Diagrams: Tab restore failed:', err);
    if (tabs.length === 0) {
      const id = generateId();
      tabs.push({ id, name: 'Draft', diagramType: 'architecture', graphJSON: null, viewport: null, dirty: false, lastSavedAt: null, lastSaveType: null, lastModifiedAt: null });
      activeTabId = id;
    }
  }
}

/**
 * Show a warning when the auto-saved session version differs.
 * For major: returns Promise<boolean> — true = try loading, false = reset.
 * For minor: shows informational modal, returns Promise<void>.
 */
function showSessionVersionWarning(savedVersion, diff) {
  return new Promise(resolve => {
    const isMajor = diff === 'major';
    const title = isMajor ? 'Compatibility Warning' : 'Session Restored';
    const githubLink = `<a href="https://github.com/MateuszDabrowski/diagramforce" target="_blank" rel="noopener" style="color:var(--color-primary)">GitHub</a>`;
    const releasesLink = `<a href="https://github.com/MateuszDabrowski/diagramforce/releases" target="_blank" rel="noopener" style="color:var(--color-primary)">release notes</a>`;
    const message = isMajor
      ? `There were significant changes introduced since your last session.
         Your open tabs probably won't load correctly.`
      : `Check out the complete list of new features in the ${releasesLink}.`;
    const footerNote = isMajor
      ? `<p style="margin:0;color:var(--text-secondary)">
          Diagrams saved to Browser Storage or exported as JSON are not affected
          and can be loaded from the Load menu.
        </p>`
      : '';
    const backupBtn = isMajor
      ? `<button class="df-modal__btn" data-action="backup" style="margin-left:auto">Save as JSON</button>`
      : '';
    const buttons = isMajor
      ? `<button class="df-modal__btn" data-action="reset">Don't load</button>
         ${backupBtn}
         <button class="df-modal__btn df-modal__btn--primary" data-action="try">Try Anyway</button>`
      : `<button class="df-modal__btn df-modal__btn--primary" data-action="ok">OK</button>`;

    // Major resolves false unless "try" sets true; minor resolves undefined.
    let result = isMajor ? false : undefined;
    const { footer, close } = buildModal({
      title,
      zIndex: 10001,
      width: '440px',
      showClose: false,
      bodyStyle: 'padding:16px 20px',
      bodyHtml: `
        <p style="margin:0 0 12px">
          ${isMajor
            ? `Diagramforce has been updated from <strong>v${escHtml(savedVersion)}</strong> to <strong>v${escHtml(APP_VERSION)}</strong> (${githubLink}).`
            : `Diagramforce has been successfully updated to <strong>v${escHtml(APP_VERSION)}</strong>, and your diagrams have been safely preserved.`}
        </p>
        <p style="margin:0${footerNote ? ' 0 12px' : ''};color:var(--text-secondary)">
          ${message}
        </p>
        ${footerNote}`,
      footerHtml: buttons,
      onClose: () => resolve(result), // backdrop / Escape resolve the variant default
    });
    footer.style.justifyContent = 'flex-end';

    if (isMajor) {
      footer.querySelector('[data-action="reset"]').addEventListener('click', () => close());
      footer.querySelector('[data-action="backup"]')?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        if (btn.dataset.saved) return;
        // Export each auto-saved tab as a separate backup JSON file
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const sessionData = JSON.parse(raw);
            const sessionTabs = sessionData.tabs || [];
            const d = new Date();
            // YYYY-MM-DD (consistent with persistence.dateSuffix() and the
            // Save-modal name suffix) for the per-tab session backup filenames.
            const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            let backedUp = 0;
            for (const tab of sessionTabs) {
              if (!tab.graphJSON) continue;
              const backupData = {
                version: 1,
                appVersion: sessionData.appVersion || savedVersion || 'unknown',
                timestamp: Date.now(),
                title: tab.name || 'Backup',
                diagramType: tab.diagramType || 'architecture',
                graph: tab.graphJSON,
                viewport: tab.viewport || null,
              };
              const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
              const safeName = (tab.name || 'backup').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'backup';
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `df_backup_${safeName}_${stamp}.json`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setTimeout(() => URL.revokeObjectURL(a.href), 5000);
              backedUp++;
            }
            // A full safety-net backup just ran (one file per saved tab) — reset the
            // backup-reminder clock so the Export-Manager advisory + the weekly overlay
            // reflect it. Writes the SAME LAST_BACKUP_KEY the overlay's own Export uses;
            // without this the user saw "No full backup yet" right after pulling this
            // session backup. See storage.markFullBackup().
            if (backedUp > 0) persistenceModule.markFullBackup?.();
          }
        } catch (err) {
          console.warn('SF Diagrams: Session backup export failed:', err);
        }
        btn.textContent = 'Saved!';
        btn.style.background = '#2e844a';
        btn.style.color = '#fff';
        btn.style.borderColor = '#2e844a';
        btn.dataset.saved = '1';
      });
      footer.querySelector('[data-action="try"]').addEventListener('click', () => { result = true; close(); });
    } else {
      footer.querySelector('[data-action="ok"]').addEventListener('click', () => close());
    }
    // backdrop / Escape close → onClose resolves `result` (false major / undefined minor)
  });
}

// Auto-save tabs whenever graph changes (debounced)
let tabSaveTimer = null;
export function setupAutoSave() {
  graph.on('change add remove', () => {
    markDirty();
    clearTimeout(tabSaveTimer);
    tabSaveTimer = setTimeout(() => saveTabs(), 1000);
  });
}

// ── Render ───────────────────────────────────────────────────────────

function render() {
  tabListEl.innerHTML = '';

  // v1.12.1 safety net — if rendering hits zero tabs AND the new-diagram
  // modal isn't already open, pop it. Multi-close followed by any
  // interrupted modal sequence could otherwise leave the user stranded
  // on a blank app with no obvious recovery path. Belt-and-braces over
  // the explicit call in doCloseTab's last-tab branch (which can be
  // missed if doCloseTab itself throws mid-execution). Deferred one
  // tick so any in-flight state mutation settles before the modal
  // grabs focus.
  if (tabs.length === 0 && !document.querySelector('.df-new-modal')) {
    setTimeout(showNewDiagramModal, 0);
  }

  for (const tab of tabs) {
    const el = document.createElement('div');
    el.className = 'df-tab' +
      (tab.id === activeTabId ? ' df-tab--active' : '') +
      (tab.dirty ? ' df-tab--dirty' : '');
    el.dataset.tabId = tab.id;

    // Diagram type icon
    const typeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    typeIcon.setAttribute('class', 'df-tab__type-icon');
    typeIcon.setAttribute('width', '12');
    typeIcon.setAttribute('height', '12');
    typeIcon.setAttribute('viewBox', '0 0 16 16');
    typeIcon.setAttribute('fill', 'currentColor');
    if (tab.diagramType === 'process') {
      typeIcon.innerHTML = '<circle cx="3" cy="8" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="7" y="5.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="3" cy="8" r="1" fill="currentColor"/><line x1="5.5" y1="8" x2="7" y2="8" stroke="currentColor" stroke-width="1.5"/>';
    } else if (tab.diagramType === 'sequence') {
      typeIcon.innerHTML = '<rect x="1" y="1" width="5" height="3" rx="0.5" fill="currentColor"/><rect x="10" y="1" width="5" height="3" rx="0.5" fill="currentColor"/><line x1="3.5" y1="4" x2="3.5" y2="15" stroke="currentColor" stroke-width="0.8" stroke-dasharray="1.5 1"/><line x1="12.5" y1="4" x2="12.5" y2="15" stroke="currentColor" stroke-width="0.8" stroke-dasharray="1.5 1"/><line x1="3.5" y1="8" x2="12.5" y2="8" stroke="currentColor" stroke-width="1"/><polygon points="12.5,8 10.5,7 10.5,9" fill="currentColor"/><line x1="12.5" y1="12" x2="3.5" y2="12" stroke="currentColor" stroke-width="0.8" stroke-dasharray="1.5 1"/><polygon points="3.5,12 5.5,11 5.5,13" fill="currentColor"/>';
    } else if (tab.diagramType === 'datamodel') {
      typeIcon.innerHTML = '<rect x="1" y="1" width="6" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="1" width="6" height="3" rx="1" fill="currentColor"/><rect x="9" y="7" width="6" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="7" width="6" height="3" rx="1" fill="currentColor"/><path d="M7 5L9 11" stroke="currentColor" stroke-width="1.2" fill="none"/>';
    } else if (tab.diagramType === 'datamapping') {
      typeIcon.innerHTML = '<rect x="0.5" y="2" width="5" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="0.5" y="2" width="5" height="3" rx="1" fill="currentColor"/><rect x="10.5" y="2" width="5" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="10.5" y="2" width="5" height="3" rx="1" fill="currentColor"/><path d="M5.5 8 L10 8 M8.5 6.5 L10 8 L8.5 9.5" fill="none" stroke="currentColor" stroke-width="1"/><path d="M5.5 11 L10 11" stroke="currentColor" stroke-width="1" opacity="0.55"/>';
    } else if (tab.diagramType === 'gantt') {
      typeIcon.innerHTML = '<rect x="1" y="2" width="8" height="3" rx="1" fill="currentColor"/><rect x="4" y="7" width="9" height="3" rx="1" fill="currentColor" opacity="0.7"/><rect x="7" y="12" width="6" height="3" rx="1" fill="currentColor" opacity="0.5"/>';
    } else if (tab.diagramType === 'org') {
      typeIcon.innerHTML = '<rect x="5" y="1" width="6" height="4" rx="1" fill="currentColor"/><rect x="0.5" y="10" width="6" height="4" rx="1" fill="currentColor" opacity="0.7"/><rect x="9.5" y="10" width="6" height="4" rx="1" fill="currentColor" opacity="0.7"/><path d="M8 5v2H3.5V10M8 7h4.5V10" stroke="currentColor" stroke-width="1" fill="none"/>';
    } else {
      typeIcon.innerHTML = '<rect x="1" y="1" width="5" height="5" rx="1"/><rect x="10" y="1" width="5" height="5" rx="1"/><rect x="5.5" y="10" width="5" height="5" rx="1"/><path d="M3.5 6v2h9V6M8 8v2" stroke="currentColor" stroke-width="1" fill="none"/>';
    }

    const dot = document.createElement('span');
    dot.className = 'df-tab__dirty';
    // A7 (v1.12.0) — surface the dirty state in text so screen readers
    // and users with colour-vision deficiency aren't reliant on the
    // small muted dot alone (WCAG 1.4.1). aria-hidden on the visual dot
    // keeps the announcement from saying "bullet point" before the name.
    dot.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'df-tab__label';
    label.textContent = tab.name;

    // Compose the row title so the dirty hint reaches both pointer-hover
    // and screen-reader announcements via the same channel.
    el.setAttribute('title', tab.dirty ? `${tab.name} (unsaved)` : tab.name);
    el.setAttribute('aria-label', tab.dirty ? `${tab.name} — unsaved changes` : tab.name);

    const close = document.createElement('button');
    close.className = 'df-tab__close';
    close.title = 'Close tab';
    close.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/></svg>';
    close.addEventListener('click', (evt) => {
      evt.stopPropagation();
      closeTab(tab.id);
    });

    // Double-click to rename
    label.addEventListener('dblclick', (evt) => {
      evt.stopPropagation();
      startInlineRename(el, label, tab);
    });

    el.appendChild(typeIcon);
    el.appendChild(dot);
    el.appendChild(label);
    el.appendChild(close);

    // Drag-and-drop reorder
    el.draggable = true;
    el.addEventListener('dragstart', (evt) => {
      evt.dataTransfer.setData('text/plain', tab.id);
      evt.dataTransfer.effectAllowed = 'move';
      el.classList.add('df-tab--dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('df-tab--dragging');
      tabListEl.querySelectorAll('.df-tab--drag-over').forEach(t => t.classList.remove('df-tab--drag-over'));
    });
    el.addEventListener('dragover', (evt) => {
      evt.preventDefault();
      evt.dataTransfer.dropEffect = 'move';
      el.classList.add('df-tab--drag-over');
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('df-tab--drag-over');
    });
    el.addEventListener('drop', (evt) => {
      evt.preventDefault();
      el.classList.remove('df-tab--drag-over');
      const draggedId = evt.dataTransfer.getData('text/plain');
      if (draggedId === tab.id) return;
      const fromIdx = tabs.findIndex(t => t.id === draggedId);
      const toIdx = tabs.findIndex(t => t.id === tab.id);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = tabs.splice(fromIdx, 1);
      tabs.splice(toIdx, 0, moved);
      render();
      saveTabs();
    });

    el.addEventListener('click', () => switchTab(tab.id));

    tabListEl.appendChild(el);
  }

  // Position the ::after pseudo-element cover strip under the active tab
  updateActiveTabIndicator();
}

function updateActiveTabIndicator() {
  const tabBar = document.querySelector('.df-tabs');
  if (!tabBar) return;

  // Remove old line segments
  tabBar.querySelectorAll('.df-tab-line').forEach(el => el.remove());

  const activeEl = tabBar.querySelector('.df-tab--active');
  if (!activeEl) {
    // No active tab — full-width bottom line
    const line = document.createElement('div');
    line.className = 'df-tab-line';
    line.style.left = '0';
    line.style.right = '0';
    tabBar.appendChild(line);
    return;
  }

  const barRect = tabBar.getBoundingClientRect();
  const tabRect = activeEl.getBoundingClientRect();
  // Line goes up to the outside edge of the tab's left/right border (1px)
  const tabLeft = tabRect.left - barRect.left;
  const tabRight = tabRect.right - barRect.left;

  // Left line: from 0 to tab left edge
  const leftLine = document.createElement('div');
  leftLine.className = 'df-tab-line';
  leftLine.style.left = '0';
  leftLine.style.width = Math.max(0, tabLeft) + 'px';
  tabBar.appendChild(leftLine);

  // Right line: from tab right edge to end
  const rightLine = document.createElement('div');
  rightLine.className = 'df-tab-line';
  rightLine.style.left = tabRight + 'px';
  rightLine.style.right = '0';
  tabBar.appendChild(rightLine);
}

function startInlineRename(tabEl, labelEl, tab) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'df-tab__rename-input';
  input.value = tab.name;
  input.style.cssText = `
    width: ${Math.max(60, labelEl.offsetWidth + 8)}px;
    font-size: var(--font-size-sm);
    font-family: var(--font-family);
    font-weight: 500;
    border: 1px solid var(--color-primary);
    border-radius: 3px;
    background: var(--bg-app);
    color: var(--text-primary);
    padding: 0 4px;
    outline: none;
    height: 20px;
  `;

  const finish = () => {
    const newName = input.value.trim() || 'Draft';
    renameTab(tab.id, newName);
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter') { evt.preventDefault(); input.blur(); }
    if (evt.key === 'Escape') { input.value = tab.name; input.blur(); }
    evt.stopPropagation();
  });

  labelEl.replaceWith(input);
  input.focus();
  input.select();
}

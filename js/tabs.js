// Tabs — multi-diagram tab management
// Each tab holds its own graph JSON, viewport, and undo/redo history.

import { escHtml, APP_VERSION, classifyVersionDiff } from './persistence.js?v=1.7.1';

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
  gantt:        { label: 'Gantt Chart',           short: 'Gantt' },
  org:          { label: 'Organisation Diagram',  short: 'Organisation' },
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

  // + button opens new diagram modal
  document.getElementById('btn-new-tab').addEventListener('click', () => showNewDiagramModal());

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
  persistenceModule.setImportHandler((name, type, graphJSON, viewport) => {
    // Dismiss the new-diagram modal if it's open (e.g. first visit via share URL)
    document.querySelector('.sf-new-modal')?.remove();
    const id = newTab(uniqueTabName(name), type);
    // The new tab is now active — load the graph into it
    canvasModule.setLoadingJSON(true);
    try { graph.fromJSON(graphJSON); canvasModule.migrateLinks(); canvasModule.migrateNodes(); } finally { canvasModule.setLoadingJSON(false); }
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

  // Keep the active tab indicator aligned on resize/scroll
  window.addEventListener('resize', () => updateActiveTabIndicator());
  tabListEl.addEventListener('scroll', () => updateActiveTabIndicator());
}

function showNewDiagramModal() {
  // Remove any existing modal
  document.querySelector('.sf-new-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'sf-new-modal';
  overlay.innerHTML = `
    <div class="sf-new-modal__backdrop"></div>
    <div class="sf-new-modal__dialog">
      <h2 class="sf-new-modal__title">Create New Diagram</h2>
      <div class="sf-new-modal__grid">
        <button class="sf-new-modal__card" data-type="architecture">
          <svg class="sf-new-modal__icon" viewBox="0 0 64 48">
            <rect x="4" y="4" width="18" height="14" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <rect x="42" y="4" width="18" height="14" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <rect x="23" y="30" width="18" height="14" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <path d="M13 18v6h38V18M32 24v6" stroke="var(--text-muted)" stroke-width="1.5" fill="none"/>
          </svg>
          <span class="sf-new-modal__card-title">Architecture</span>
          <span class="sf-new-modal__card-desc">Map system architecture, integrations, and infrastructure landscape.</span>
        </button>
        <button class="sf-new-modal__card" data-type="process">
          <svg class="sf-new-modal__icon" viewBox="0 0 64 48">
            <circle cx="10" cy="24" r="6" fill="none" stroke="var(--color-primary)" stroke-width="2"/>
            <circle cx="10" cy="24" r="2.5" fill="var(--color-primary)"/>
            <rect x="22" y="17" width="20" height="14" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <path d="M48 16l8 8-8 8" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linejoin="round"/>
            <line x1="16" y1="24" x2="22" y2="24" stroke="var(--text-muted)" stroke-width="1.5"/>
            <line x1="42" y1="24" x2="48" y2="24" stroke="var(--text-muted)" stroke-width="1.5"/>
          </svg>
          <span class="sf-new-modal__card-title">Process</span>
          <span class="sf-new-modal__card-desc">Design business processes, flows, and BPMN workflows.</span>
        </button>
        <button class="sf-new-modal__card" data-type="sequence">
          <svg class="sf-new-modal__icon" viewBox="0 0 64 48">
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
          <span class="sf-new-modal__card-title">Sequence</span>
          <span class="sf-new-modal__card-desc">Document request / response interactions between systems.</span>
        </button>
        <button class="sf-new-modal__card" data-type="datamodel">
          <svg class="sf-new-modal__icon" viewBox="0 0 64 48">
            <rect x="2" y="4" width="24" height="28" rx="3" fill="none" stroke="var(--color-primary)" stroke-width="1.5"/>
            <rect x="2" y="4" width="24" height="9" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <rect x="38" y="16" width="24" height="28" rx="3" fill="none" stroke="var(--color-primary)" stroke-width="1.5"/>
            <rect x="38" y="16" width="24" height="9" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <line x1="26" y1="20" x2="38" y2="30" stroke="var(--text-muted)" stroke-width="1.5"/>
          </svg>
          <span class="sf-new-modal__card-title">Data Model</span>
          <span class="sf-new-modal__card-desc">Define objects, fields, and relationships like Schema Builder.</span>
        </button>
        <button class="sf-new-modal__card" data-type="gantt">
          <svg class="sf-new-modal__icon" viewBox="0 0 64 48">
            <rect x="8" y="6" width="24" height="7" rx="2" fill="var(--color-primary)" opacity="0.8"/>
            <rect x="16" y="17" width="28" height="7" rx="2" fill="var(--color-primary)" opacity="0.6"/>
            <rect x="24" y="28" width="18" height="7" rx="2" fill="var(--color-primary)" opacity="0.4"/>
            <line x1="32" y1="13" x2="32" y2="17" stroke="var(--text-muted)" stroke-width="1"/>
            <line x1="42" y1="24" x2="42" y2="28" stroke="var(--text-muted)" stroke-width="1"/>
            <polygon points="30,35 33,28 36,35" fill="var(--color-accent)"/>
          </svg>
          <span class="sf-new-modal__card-title">Gantt Chart</span>
          <span class="sf-new-modal__card-desc">Plan project timelines, tasks, milestones, and dependencies.</span>
        </button>
        <button class="sf-new-modal__card" data-type="org">
          <svg class="sf-new-modal__icon" viewBox="0 0 64 48">
            <rect x="20" y="2" width="24" height="14" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <rect x="2" y="28" width="24" height="14" rx="3" fill="var(--color-primary)" opacity="0.6"/>
            <rect x="38" y="28" width="24" height="14" rx="3" fill="var(--color-primary)" opacity="0.6"/>
            <line x1="32" y1="16" x2="32" y2="22" stroke="var(--text-muted)" stroke-width="1.5"/>
            <line x1="14" y1="22" x2="50" y2="22" stroke="var(--text-muted)" stroke-width="1.5"/>
            <line x1="14" y1="22" x2="14" y2="28" stroke="var(--text-muted)" stroke-width="1.5"/>
            <line x1="50" y1="22" x2="50" y2="28" stroke="var(--text-muted)" stroke-width="1.5"/>
          </svg>
          <span class="sf-new-modal__card-title">Organisation</span>
          <span class="sf-new-modal__card-desc">Document team hierarchy, roles, and responsibilities.</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Card clicks
  overlay.querySelectorAll('.sf-new-modal__card').forEach(card => {
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
    closeBtn.className = 'sf-new-modal__close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    closeBtn.addEventListener('click', () => { overlay.remove(); });
    overlay.querySelector('.sf-new-modal__dialog').appendChild(closeBtn);

    // Close on backdrop click
    overlay.querySelector('.sf-new-modal__backdrop').addEventListener('click', () => { overlay.remove(); });

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
  tabs.push({ id, name, diagramType, graphJSON: null, viewport: null, dirty: false, lastSavedAt: null, lastSaveType: null });
  activateTab(id, true);
  render();
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
  document.querySelector('.sf-close-confirm-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'sf-close-confirm-modal';
  overlay.innerHTML = `
    <div class="sf-modal" style="z-index:3000">
      <div class="sf-modal__overlay"></div>
      <div class="sf-modal__dialog" style="width:380px">
        <div class="sf-modal__header">
          <h2 class="sf-modal__title">Unsaved Changes</h2>
        </div>
        <div class="sf-modal__body" style="padding:var(--spacing-md) var(--spacing-lg)">
          <p style="margin:0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">
            <strong style="color:var(--text-primary)">${escHtml(tabName)}</strong> has unsaved changes that will be lost.
          </p>
        </div>
        <div style="display:flex;gap:var(--spacing-sm);padding:var(--spacing-sm) var(--spacing-lg) var(--spacing-md);justify-content:flex-end">
          <button class="sf-close-confirm__btn sf-close-confirm__btn--cancel">No</button>
          <button class="sf-close-confirm__btn sf-close-confirm__btn--save">Save and Close</button>
          <button class="sf-close-confirm__btn sf-close-confirm__btn--discard">Yes, Close</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();

  overlay.querySelector('.sf-modal__overlay').addEventListener('click', close);
  overlay.querySelector('.sf-close-confirm__btn--cancel').addEventListener('click', close);

  overlay.querySelector('.sf-close-confirm__btn--save').addEventListener('click', () => {
    close();
    // Switch to the tab first if not active, then trigger save
    if (tabId !== activeTabId) switchTab(tabId);
    // Set flag so markSaved() will close the tab after save completes
    pendingCloseAfterSave = tabId;
    persistenceModule.namedSave();
  });

  overlay.querySelector('.sf-close-confirm__btn--discard').addEventListener('click', () => {
    close();
    // Force close without checking dirty again
    const tab = tabs.find(t => t.id === tabId);
    if (tab) tab.dirty = false;
    doCloseTab(tabId);
  });
}

export function switchTab(id) {
  if (id === activeTabId) return;
  saveCurrentTabState();
  activateTab(id, false);
  render();
}

export function renameTab(id, name) {
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

export function markDirty() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && !tab.dirty) {
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
    updateLastSavedLabel();
  }

  // If a "Save and Close" was pending, close the tab now
  if (pendingCloseAfterSave) {
    const closeId = pendingCloseAfterSave;
    pendingCloseAfterSave = null;
    doCloseTab(closeId);
  }
}

export function getActiveTabSaveInfo() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab?.lastSavedAt) return null;
  return { lastSavedAt: tab.lastSavedAt, lastSaveType: tab.lastSaveType };
}

/** Return lightweight info for every open tab (used by save modal). */
export function getAllTabs() {
  return tabs.map(t => ({
    id: t.id,
    name: t.name,
    diagramType: t.diagramType,
    isActive: t.id === activeTabId,
    dirty: t.dirty,
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

export function onChange(cb) { onChangeCallbacks.push(cb); }
function notifyChange() { onChangeCallbacks.forEach(cb => cb()); updateLastSavedLabel(); }

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
      dirty: t.dirty,
      lastSavedAt: t.lastSavedAt || null,
      lastSaveType: t.lastSaveType || null,
      graphJSON: t.id === activeTabId ? graph.toJSON() : t.graphJSON,
      viewport: t.id === activeTabId ? canvasModule.getViewport() : t.viewport,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...meta, tabs: full }));
  } catch (err) {
    console.warn('SF Diagrams: Tab save failed:', err);
  }
}

function updateLastSavedLabel() {
  const el = document.getElementById('last-saved');
  if (!el) return;
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab?.lastSavedAt) {
    el.textContent = '';
    el.style.display = 'none';
    return;
  }
  const d = new Date(tab.lastSavedAt);
  const day = d.getDate().toString().padStart(2, '0');
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const typeLabel = tab.lastSaveType === 'json' ? 'JSON' : 'Browser';
  el.textContent = `Last Saved to ${typeLabel}: ${day} ${mon} ${h}:${m}`;
  el.style.display = '';
}

/** Populate tabs array and load the active tab from parsed session data. */
function doRestoreTabData(data) {
  if (data.nextId) nextId = data.nextId;

  if (data.tabs?.length > 0) {
    for (const t of data.tabs) {
      tabs.push({
        id: t.id,
        name: t.name || 'Draft',
        diagramType: t.diagramType || 'architecture',
        graphJSON: t.graphJSON || null,
        viewport: t.viewport || null,
        dirty: t.dirty || (!t.lastSavedAt && t.graphJSON?.cells?.length > 0) || false,
        lastSavedAt: t.lastSavedAt || null,
        lastSaveType: t.lastSaveType || null,
      });
    }
    activeTabId = data.activeTabId || tabs[0].id;
  } else {
    const id = generateId();
    tabs.push({ id, name: 'Draft', diagramType: 'architecture', graphJSON: null, viewport: null, dirty: false, lastSavedAt: null, lastSaveType: null });
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
        updateLastSavedLabel();
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
      tabs.push({ id, name: 'Draft', diagramType: 'architecture', graphJSON: null, viewport: null, dirty: false, lastSavedAt: null, lastSaveType: null });
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
    const overlay = document.createElement('div');
    overlay.className = 'sf-modal';
    overlay.style.zIndex = '10001';

    const isMajor = diff === 'major';
    const title = isMajor ? 'Compatibility Warning' : 'Session Restored';
    const message = isMajor
      ? `There were significant changes introduced since your last session.
         Your open tabs probably won't load correctly.`
      : `There have been some changes since your last session, but it should still work.
         If anything looks off, try re-adding the affected elements.`;
    const footerNote = isMajor
      ? `<p style="margin:0;color:var(--text-secondary)">
          Diagrams saved to Browser Storage or exported as JSON are not affected
          and can be loaded from the Load menu.
        </p>`
      : '';
    const backupBtn = isMajor
      ? `<button class="sf-modal__btn" data-action="backup" style="margin-left:auto">Save as JSON</button>`
      : '';
    const buttons = isMajor
      ? `<button class="sf-modal__btn" data-action="reset">Don't load</button>
         ${backupBtn}
         <button class="sf-modal__btn sf-modal__btn--primary" data-action="try">Try Anyway</button>`
      : `<button class="sf-modal__btn sf-modal__btn--primary" data-action="ok">OK</button>`;

    overlay.innerHTML = `
      <div class="sf-modal__overlay"></div>
      <div class="sf-modal__dialog" style="width:440px">
        <div class="sf-modal__header">
          <h2 class="sf-modal__title">${title}</h2>
        </div>
        <div class="sf-modal__body" style="padding:16px 20px">
          <p style="margin:0 0 12px">
            Diagramforce has been updated from <strong>v${escHtml(savedVersion)}</strong>
            to <strong>v${escHtml(APP_VERSION)}</strong>
            (<a href="https://github.com/MateuszDabrowski/diagramforce" target="_blank" rel="noopener" style="color:var(--color-primary)">GitHub</a>).
          </p>
          <p style="margin:0${footerNote ? ' 0 12px' : ''};color:var(--text-secondary)">
            ${message}
          </p>
          ${footerNote}
        </div>
        <div class="sf-modal__footer" style="justify-content:flex-end">
          ${buttons}
        </div>
      </div>`;

    if (isMajor) {
      overlay.querySelector('[data-action="reset"]').addEventListener('click', () => {
        overlay.remove();
        resolve(false);
      });
      overlay.querySelector('[data-action="backup"]')?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        if (btn.dataset.saved) return;
        // Export each auto-saved tab as a separate backup JSON file
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const sessionData = JSON.parse(raw);
            const sessionTabs = sessionData.tabs || [];
            const d = new Date();
            const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
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
              a.download = `${safeName}_backup_${stamp}.json`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            }
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
      overlay.querySelector('[data-action="try"]').addEventListener('click', () => {
        overlay.remove();
        resolve(true);
      });
      overlay.querySelector('.sf-modal__overlay').addEventListener('click', () => {
        overlay.remove();
        resolve(false);
      });
    } else {
      overlay.querySelector('[data-action="ok"]').addEventListener('click', () => {
        overlay.remove();
        resolve();
      });
      overlay.querySelector('.sf-modal__overlay').addEventListener('click', () => {
        overlay.remove();
        resolve();
      });
    }

    document.body.appendChild(overlay);
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

  for (const tab of tabs) {
    const el = document.createElement('div');
    el.className = 'sf-tab' +
      (tab.id === activeTabId ? ' sf-tab--active' : '') +
      (tab.dirty ? ' sf-tab--dirty' : '');
    el.dataset.tabId = tab.id;

    // Diagram type icon
    const typeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    typeIcon.setAttribute('class', 'sf-tab__type-icon');
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
    } else if (tab.diagramType === 'gantt') {
      typeIcon.innerHTML = '<rect x="1" y="2" width="8" height="3" rx="1" fill="currentColor"/><rect x="4" y="7" width="9" height="3" rx="1" fill="currentColor" opacity="0.7"/><rect x="7" y="12" width="6" height="3" rx="1" fill="currentColor" opacity="0.5"/>';
    } else if (tab.diagramType === 'org') {
      typeIcon.innerHTML = '<rect x="5" y="1" width="6" height="4" rx="1" fill="currentColor"/><rect x="0.5" y="10" width="6" height="4" rx="1" fill="currentColor" opacity="0.7"/><rect x="9.5" y="10" width="6" height="4" rx="1" fill="currentColor" opacity="0.7"/><path d="M8 5v2H3.5V10M8 7h4.5V10" stroke="currentColor" stroke-width="1" fill="none"/>';
    } else {
      typeIcon.innerHTML = '<rect x="1" y="1" width="5" height="5" rx="1"/><rect x="10" y="1" width="5" height="5" rx="1"/><rect x="5.5" y="10" width="5" height="5" rx="1"/><path d="M3.5 6v2h9V6M8 8v2" stroke="currentColor" stroke-width="1" fill="none"/>';
    }

    const dot = document.createElement('span');
    dot.className = 'sf-tab__dirty';

    const label = document.createElement('span');
    label.className = 'sf-tab__label';
    label.textContent = tab.name;

    const close = document.createElement('button');
    close.className = 'sf-tab__close';
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
      el.classList.add('sf-tab--dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('sf-tab--dragging');
      tabListEl.querySelectorAll('.sf-tab--drag-over').forEach(t => t.classList.remove('sf-tab--drag-over'));
    });
    el.addEventListener('dragover', (evt) => {
      evt.preventDefault();
      evt.dataTransfer.dropEffect = 'move';
      el.classList.add('sf-tab--drag-over');
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('sf-tab--drag-over');
    });
    el.addEventListener('drop', (evt) => {
      evt.preventDefault();
      el.classList.remove('sf-tab--drag-over');
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
  const tabBar = document.querySelector('.sf-tabs');
  if (!tabBar) return;

  // Remove old line segments
  tabBar.querySelectorAll('.sf-tab-line').forEach(el => el.remove());

  const activeEl = tabBar.querySelector('.sf-tab--active');
  if (!activeEl) {
    // No active tab — full-width bottom line
    const line = document.createElement('div');
    line.className = 'sf-tab-line';
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
  leftLine.className = 'sf-tab-line';
  leftLine.style.left = '0';
  leftLine.style.width = Math.max(0, tabLeft) + 'px';
  tabBar.appendChild(leftLine);

  // Right line: from tab right edge to end
  const rightLine = document.createElement('div');
  rightLine.className = 'sf-tab-line';
  rightLine.style.left = tabRight + 'px';
  rightLine.style.right = '0';
  tabBar.appendChild(rightLine);
}

function startInlineRename(tabEl, labelEl, tab) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'sf-tab__rename-input';
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

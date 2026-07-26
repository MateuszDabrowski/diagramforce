// Tabs — multi-diagram tab management
// Each tab holds its own graph JSON, viewport, and undo/redo history.

import { APP_VERSION, classifyVersionDiff, normalizeDiagramType, isQuotaError, getStorageFootprint, STORAGE_WARNING_BYTES, evictRedundantArchives, compactGraphForSave, triggerDownload, dateSuffix } from './persistence.js?v=1.21.0';
import { tbctx } from './tabs/context.js?v=1.21.0';
import { DIAGRAM_TYPES, diagramTypeIconMarkup } from './tabs/diagram-types.js?v=1.21.0';
import { showNewDiagramModal } from './tabs/new-diagram-modal.js?v=1.21.0';
import { showCloseConfirmModal, showCloseTabsModal } from './tabs/close-manager.js?v=1.21.0';
import { saveCurrentTabState, commitActiveTab, activateTab, saveTabs, checkStoragePressure, restoreTabs, getSessionUpdate, setupAutoSave } from './tabs/session-store.js?v=1.21.0';
export { commitActiveTab, getSessionUpdate, setupAutoSave };  // re-export: app.js/save-manager reach these via tctx.modules.tabs
export { showCloseTabsModal };  // re-export: toolbar/load-manager reaches it via tctx.modules.tabs
export { DIAGRAM_TYPES } from './tabs/diagram-types.js?v=1.21.0';
import { escHtml, formatRelativeTime, countDiagramShapes, tabInGroup, formatBytes, gaugeLevel, isViewForkTab, sanitizeCssColor, sanitizeFilenamePart } from './util.js?v=1.21.0';
import { storageRowHtml, groupSelectHtml, refreshSplitTableCounts, splitTableHtml, bindSplitHeads, setTriStateCheckbox, sharePillHtml, driveChipsHtml, tabRowChipsHtml } from './storage-ui.js?v=1.21.0';
import { tabShareRole, shareGlyphKind, archiveDedupName, serializeDriveFields, forkName, hasVerifiedMyDriveBackup } from './persistence/drive-sync-logic.js?v=1.21.0';
import { showError, showToast, buildModal, confirmModal } from './feedback.js?v=1.21.0';
import { wireMenuDismiss } from './menu.js?v=1.21.0';
import { createElementFromComponent, createGanttTimelineSeed, SVG } from './components.js?v=1.21.0';
import { applyGanttGeometry, layoutTimelineTasks } from './gantt-layout.js?v=1.21.0';
import { getPalette } from './brand-palette.js?v=1.21.0';
import { getAllIcons } from './icons.js?v=1.21.0';
import { getOfficialTemplates, loadOfficialTemplate, renderOfficialThumbnail } from './official-templates.js?v=1.21.0';

let graph, paper, canvasModule, selectionModule, historyModule, persistenceModule, stencilModule;
let tabListEl;

// R7 — a tiny fingerprint of a tab's collaboration state (what the share glyph keys off): the number of
// shared-out copies plus whether it has an editable / view-only upstream source. Cheap to recompute, so
// persistTabDrive can re-render the tab bar ONLY when this flips, never on a routine Drive save.
const tabShareSignature = (t) =>
  `${(t.driveCopies || []).filter(Boolean).length}|${t.driveSharedSource ? (t.driveSharedSource.canEdit === true ? 'e' : 'v') : ''}|${t.driveSharedInEdit ? 'die' : ''}|${t.driveDriveId ? 'sd' : ''}|${t.driveOutgoingGrants || 0}`;

const SVG_NS = 'http://www.w3.org/2000/svg';
/**
 * The tab-bar collaboration glyph for a tab, or null when this tab's edits do NOT reach other people (local /
 * view-only shared source). TWO distinct glyphs by DIRECTION: an OUTGOING external-link icon when YOU shared it
 * OUT (a master fanned to editable / Shared-Drive copies), vs the chain `#share_link` when it is a file shared
 * TO you that you can edit (incoming). The tooltip lives in a `<title>` CHILD (an SVG ignores a `title` attribute)
 * placed FIRST per the SVG/a11y convention.
 */
function buildShareGlyph(tab) {
  const role = tabShareRole({ copies: tab.driveCopies, sharedSource: tab.driveSharedSource, onSharedDrive: !!tab.driveDriveId, outgoingGrants: tab.driveOutgoingGrants || 0, ownFileId: tab.driveFileId, sharedInEdit: !!tab.driveSharedInEdit });
  const kind = shareGlyphKind(role);   // 'out' (your save wins) | 'in' (their save wins) | 'both' (collab) | null (local)
  if (!kind) return null;
  // 3-way directional glyph (by authority): out = #share_mobile, in = #share_link (chain), both = #socialshare. All
  // amber + 12px box (normalized to the tab's diagram-type icon); the ICON conveys the direction, not the colour.
  // (#share_mobile reads at the same visual weight as the others at 12px - the plain #share's exit arrow read off.)
  const ICON = { out: '#share_mobile', in: '#share_link', both: '#socialshare' };
  const glyph = document.createElementNS(SVG_NS, 'svg');
  glyph.setAttribute('class', `df-tab__shared df-tab__shared--${kind}`);
  glyph.setAttribute('width', '12');
  glyph.setAttribute('height', '12');
  glyph.setAttribute('aria-hidden', 'true');   // decorative; the share status is also in the tab's aria-label
  glyph.innerHTML = `<use href="${ICON[kind]}"></use>`;
  const src = tab.driveSharedSource;
  const sharedBy = src && src.sharedBy ? ` Shared by ${src.sharedBy}.` : '';
  const n = role === 'shared-out' ? (tab.driveCopies || []).filter(c => c && c.kind !== 'mydrive-backup').length : 0;
  const tip = kind === 'out'
    ? `You shared this diagram out to ${n} editable Google Drive cop${n === 1 ? 'y' : 'ies'}. Your edits push out to them; you keep the master, so your save wins (you resolve any conflict).`
    : kind === 'in'
      ? `A view-only file shared to you.${sharedBy} Your edits stay in your own copy - use Refresh to pull the owner's latest. Their save wins.`
      : role === 'shared-drive-master'
        ? `This diagram lives on a team Shared Drive - everyone with access edits the same file. Edits flow both ways: you overwrite and can be overwritten.`
        : `An editable file shared to you (Collaborate).${sharedBy} Your edits save back to the owner and theirs come to you - edits flow both ways.`;
  const titleEl = document.createElementNS(SVG_NS, 'title');
  titleEl.textContent = tip;
  glyph.insertBefore(titleEl, glyph.firstChild);   // title FIRST child (SVG/a11y convention; review fix)
  return glyph;
}

const { tabs, groups } = tbctx;   // shared array refs; live in js/tabs/context.js (tbctx), mutated in place
// Synthetic "Ungrouped" tab-bar group (v1.17.0): when ≥1 real group exists, the groupless tabs render inside a
// collapsible gray "Ungrouped" tray so the user can fold them away to focus on a group. It is NOT a real group
// (never in `groups[]`), so its only state is this collapse flag (persisted in the session blob).
const UNGROUPED_ID = '__ungrouped__';
let _dragKind = null;   // 'tab' | 'group' while a tab-bar drag is in flight (drives drop indicators)
let _dragGroupId = null;      // id of the group chip being dragged (so its own tray skips the drop line)
let _groupDropBefore;        // group id the dragged group will land BEFORE on drop (null = end; undefined = none)
const onChangeCallbacks = [];
// Optional veto/defer hook for leaving the active tab (set by app.js → table-view).
// Returns true to allow the switch immediately, or false to block now and re-invoke
// the supplied continuation once the user resolves (e.g. Save/Discard a table edit).
let _switchGuard = null;
export function setSwitchGuard(fn) { _switchGuard = fn; }
// Set by app.js to toolbar.compareActiveWithTab — the tab right-click "Compare" diffs the ACTIVE tab against
// the right-clicked one, in place (no tab switch).
let _compareTabHandler = null;
export function setCompareTabHandler(fn) { _compareTabHandler = fn; }

// Diagram types

/** Open a fresh tab of a given diagram type (name auto-derived) — the shared path for the
 *  new-diagram modal cards and the "+ Diagram" right-click type menu. */
function createDiagramOfType(type, groupId = null) {
  const label = DIAGRAM_TYPES[type]?.short || 'Draft';
  const id = newTab(uniqueTabName(`${label} Draft`), type);
  if (groupId && getGroup(groupId)) setTabGroup(id, groupId);   // create directly inside a group
  if (normalizeDiagramType(type) === 'gantt') seedFreshGantt();  // Phase 4.1: a fresh Gantt opens populated (timeline + dated bars)
  return id;
}

/** Phase 4.1: seed a freshly-created Gantt tab with a timeline + real dated, draggable bars so it opens as an
 *  editable schedule, not a blank canvas. Added under the load guard (no dirty / no history — it's the starting
 *  point), then saveCurrentTabState() populates the new tab's graphJSON (never empty - same guard the clone/import
 *  fix uses). The bars embed in the timeline and derive their x/width from their dates via applyGanttGeometry. */
function seedFreshGantt() {
  const { timeline, bars, milestones = [], marker } = createGanttTimelineSeed();
  canvasModule.setLoadingJSON(true);
  try {
    graph.addCell(timeline);
    // Bars + gate milestones + the Today marker all embed in the timeline; layoutTimelineTasks positions every type
    // (bars by order→Y + dates→X, milestones/markers by date→X with their seeded row Y) in one pass.
    for (const c of [...bars, ...milestones, ...(marker ? [marker] : [])]) { graph.addCell(c); timeline.embed(c); }
    layoutTimelineTasks(timeline);
  } finally { canvasModule.setLoadingJSON(false); }
  saveCurrentTabState();
  requestAnimationFrame(() => canvasModule.fitContent());
}


export function init(_graph, _paper, _canvas, _selection, _history, _persistence, _stencil) {
  graph = _graph;
  paper = _paper;
  canvasModule = _canvas;
  selectionModule = _selection;
  historyModule = _history;
  persistenceModule = _persistence;
  stencilModule = _stencil;
  tbctx.modules = { graph: _graph, paper: _paper, canvas: _canvas, selection: _selection, history: _history, persistence: _persistence, stencil: _stencil };
  // Forward-refs: cross-slice functions the tabs/ slices call through tbctx (avoids slice->facade import cycles).
  tbctx.saveTabs = saveTabs; tbctx.switchTab = switchTab; tbctx.closeTab = closeTab;
  tbctx.setTabGroup = setTabGroup; tbctx.showNewDiagramModal = showNewDiagramModal; tbctx.importDiagramAsTab = importDiagramAsTab;
  tbctx.createDiagramOfType = createDiagramOfType; tbctx.getGroup = getGroup;
  tbctx.deleteBrowserArchive = deleteBrowserArchive; tbctx.doCloseTab = doCloseTab; tbctx.forgetBrowserSaveName = forgetBrowserSaveName;
  tbctx.getGroups = getGroups; tbctx.getTabGraphJSON = getTabGraphJSON; tbctx.groupBadgeHtml = groupBadgeHtml;
  tbctx.generateId = generateId; tbctx.markDirty = markDirty; tbctx.notifyChange = notifyChange;
  tbctx.renameTab = renameTab; tbctx.render = render; tbctx.reorderTabsByGroup = reorderTabsByGroup;

  tabListEl = document.getElementById('tab-list');

  // Tab-row overflow affordance (v1.16.x). The « / » buttons (see updateScrollButtons) appear only
  // where there's clipped content; they replaced the old edge fade-mask, which dimmed the pinned group
  // pills. ResizeObserver re-runs the sizing/pin/button math when the viewport shrinks and tabs that fit
  // before now overflow. Click/touch the buttons to scroll ~70% of a page (smooth) — a11y, not just gesture.
  const scrollByPage = (dir) => tabListEl.scrollBy({ left: dir * Math.round(tabListEl.clientWidth * 0.7), behavior: 'smooth' });
  document.getElementById('btn-scroll-tabs-left')?.addEventListener('click', () => scrollByPage(-1));
  document.getElementById('btn-scroll-tabs-right')?.addEventListener('click', () => scrollByPage(1));
  tabListEl.addEventListener('scroll', updateScrollButtons, { passive: true });
  tabListEl.addEventListener('scroll', updatePins, { passive: true });   // refresh the pinned rail while scrolling
  new ResizeObserver(() => { sizeTabsUniform(); updateScrollButtons(); measurePins(); }).observe(tabListEl);
  // First-render check after the initial tab render lands.
  setTimeout(() => { sizeTabsUniform(); updateScrollButtons(); measurePins(); }, 0);

  // Dropping a tab on the tab-list's empty area (not on a tab/chip) ungroups it (it sits at the end).
  tabListEl.addEventListener('dragover', (e) => { if (e.target === tabListEl) e.preventDefault(); });
  tabListEl.addEventListener('drop', (e) => {
    if (e.target !== tabListEl) return;   // a tab or chip already handled it
    e.preventDefault();
    hideInsertionLine();
    const data = e.dataTransfer.getData('text/plain');
    if (data.startsWith('tab:')) { setTabGroup(data.slice(4), null); suppressTabHover(); }
  });

  // + button opens new diagram modal
  document.getElementById('btn-new-tab').addEventListener('click', () => showNewDiagramModal());
  // Right-click → quick per-type picker (alternative to the full modal).
  document.getElementById('btn-new-tab').addEventListener('contextmenu', (e) => { e.preventDefault(); openNewDiagramMenu(e.currentTarget); });

  // + Group button creates an empty group and lets the user name it inline.
  document.getElementById('btn-new-group')?.addEventListener('click', () => {
    const id = createGroup(uniqueGroupName('Group'));
    const chip = tabListEl.querySelector(`.df-tab-group[data-group-id="${id}"]`);
    const nameEl = chip?.querySelector('.df-tab-group__name');
    if (chip && nameEl) startGroupRename(chip, nameEl, getGroup(id));
  });

  // Mobile "+" → Diagram / Group picker (the labelled buttons are CSS-hidden on narrow viewports).
  document.getElementById('btn-new-mobile')?.addEventListener('click', (e) => openNewMobileMenu(e.currentTarget));

  // Trash button opens multi-close modal
  document.getElementById('btn-close-tabs')?.addEventListener('click', () => showCloseTabsModal());

  // Wire up persistence hooks
  persistenceModule.setNewDiagramHandler(() => showNewDiagramModal());
  persistenceModule.onNamedSave((name) => renameActiveTab(name));
  persistenceModule.onSaveComplete((type) => markSaved(type));
  persistenceModule.onDriveTabSaved?.((id) => markTabDriveSaved(id));
  persistenceModule.setDiagramTypeGetter(() => getActiveTabType());
  persistenceModule.setTabNameGetter(() => getActiveTabName());
  persistenceModule.setActiveTabIdGetter(() => getActiveTabId());
  persistenceModule.setGroupsGetter?.(() => getGroups());   // so a full backup carries group metadata (item 4)
  // Mirror Drive sync state into the tab + persist now, so a synced tab survives a reload.
  persistenceModule.setPersistTabDrive((id, meta) => {
    const t = tabs.find(x => x.id === id);
    if (!t) return;
    const prevShareSig = tabShareSignature(t);   // R7 — to know if the tab's collaboration glyph must change
    t.driveFileId = meta.driveFileId;
    t.driveSync = meta.driveSync;
    t.driveLastSavedAt = meta.driveLastSavedAt;
    t.driveImported = meta.driveImported;
    t.driveFolderId = meta.driveFolderId;
    t.driveDriveId = meta.driveDriveId;
    t.driveHeadRevisionId = meta.driveHeadRevisionId;
    t.driveLastHash = meta.driveLastHash;
    t.driveCopies = meta.driveCopies;
    t.driveSharedSource = meta.driveSharedSource;   // upstream shared file (Shared File model)
    t.driveSharedInEdit = meta.driveSharedInEdit || null;   // Phase B: fileId IS a directly-edited shared file (drives the glyph + chip)
    t.driveOutgoingGrants = meta.driveOutgoingGrants || 0;   // direct view/edit invites on the master → "shared out" glyph
    saveTabs();
    // Only re-render the tab bar when the share state actually flipped (a new copy shared, a source
    // gained edit rights), NOT on every routine Drive save — so the glyph appears live without flicker.
    if (tabShareSignature(t) !== prevShareSig) render();
  });
  persistenceModule.setAllTabsGetter(() => getAllTabs());
  persistenceModule.setTabGraphGetter((id) => getTabGraphJSON(id));
  persistenceModule.setTabViewportGetter((id) => getTabViewport(id));
  persistenceModule.setTabDiagramTypeGetter((id) => getTabDiagramType(id));
  persistenceModule.setTabMappingModeGetter((id) => getTabMappingMode(id));
  persistenceModule.setActiveMappingModeGetter(() => getActiveMappingMode());
  persistenceModule.setImportHandler((name, type, graphJSON, viewport, mappingMode, driveMeta = null, group = null) => {
    // Dismiss the new-diagram modal if it's open (e.g. first visit via share URL)
    document.querySelector('.df-new-modal')?.remove();
    // driveMeta (item 1.3): a loaded browser archive that was also in My Drive re-links to its master + shares.
    // group (#7): a single diagram saved from a tab group recreate-or-rejoins it.
    importDiagramAsTab(name, type, graphJSON, viewport, mappingMode, { driveMeta, group });
    saveTabs();   // persist immediately so the imported data survives a refresh
  });

  // Refresh-in-place: load the pulled latest INTO the active tab (no new tab) - only called when the tab is CLEAN
  // (no local edits), so there is nothing of the user's to preserve. Keeps the tab's name/type/Drive link; just
  // swaps the content + re-baselines (dirty off). Avoids the "every Refresh spawns a duplicate tab" clutter.
  persistenceModule.setReplaceActiveHandler((name, type, graphJSON, viewport, mappingMode) => {
    const tab = tabs.find(t => t.id === tbctx.activeTabId);
    if (!tab) return;
    canvasModule.setLoadingJSON(true);
    try { graph.fromJSON(graphJSON); canvasModule.migrateLinks(); canvasModule.migrateNodes(); } finally { canvasModule.setLoadingJSON(false); }
    tab.dirty = false; tab.lastModifiedAt = Date.now();   // freshly pulled = back in sync with the source
    render();
    requestAnimationFrame(() => canvasModule.fitContent());
    saveTabs();
  });

  // Group import (v1.16.0) — a `kind:'group'` bundle (from "Export group") restores
  // the whole working set: re-create the group, then open each diagram as a tab
  // inside it. Distinct from the generic-bundle path (which lands diagrams in
  // browser saves) because a group export is an intentional "bring my project back".
  persistenceModule.setImportGroupHandler((groupMetas, diagrams) => {
    document.querySelector('.df-new-modal')?.remove();
    // Re-create each group (deduped name) and map the export-time group name → new id.
    const nameToId = new Map();
    for (const gm of groupMetas) {
      const gid = createGroup(uniqueGroupName(gm.name || 'Group'), { icon: gm.icon || null, color: gm.color || null });
      nameToId.set(gm.name, gid);
    }
    // Single-group bundles tag nothing per-diagram — fall back to the lone group.
    const soleGroup = groupMetas.length === 1 ? nameToId.get(groupMetas[0].name) : null;
    let lastId = null;
    for (const d of diagrams) {
      const id = importDiagramAsTab(d.name, d.diagramType, d.graph, d.viewport, d.mappingMode, { fit: false });
      const t = tabs.find(x => x.id === id);
      if (t) t.groupId = (d.group && nameToId.get(d.group)) || soleGroup || null;
      lastId = id;
    }
    reorderTabsByGroup();
    if (lastId) activateTab(lastId, true);   // land on the last imported diagram
    render();
    requestAnimationFrame(() => canvasModule.fitContent());
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


function generateId() {
  return `tab-${tbctx.nextId++}`;
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

/** Return a group name that doesn't clash with any existing group. */
function uniqueGroupName(base) {
  const existing = new Set(groups.map(g => g.name));
  if (!existing.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!existing.has(candidate)) return candidate;
  }
}

// #7: a single diagram loaded from a tab GROUP should land back in that group. REJOIN an existing group of the same
// name (so two diagrams from the same group reunite, not split into duplicate groups); else create it from the saved
// meta. Returns the group id, or null for no/blank meta. (The multi-diagram bundle path always CREATES; this one
// rejoins, which matters when you reopen grouped diagrams one at a time.)
function recreateOrRejoinGroup(meta) {
  if (!meta || !meta.name) return null;
  const existing = groups.find(g => g.name === meta.name);
  if (existing) return existing.id;
  return createGroup(meta.name, { icon: meta.icon || null, color: meta.color || null });
}

export function newTab(name = 'Draft', diagramType = 'architecture') {
  // Save current tab state before switching
  saveCurrentTabState();

  const id = generateId();
  tabs.push({ id, name, diagramType: normalizeDiagramType(diagramType), groupId: null, graphJSON: null, viewport: null, mappingMode: false, dirty: false, lastSavedAt: null, lastSaveType: null, lastModifiedAt: null, browserSaveName: null });
  activateTab(id, true);
  render();
  return id;
}

/**
 * Open one imported diagram as a fresh tab and load its graph. Shared by the
 * single-diagram import handler and the group-import handler (which opens many
 * in a loop, suppressing the per-diagram fit via `{ fit: false }` and fitting
 * once at the end). Returns the new tab id. Does NOT call saveTabs — the caller
 * persists once it's done (one diagram, or the whole group).
 */
function importDiagramAsTab(name, type, graphJSON, viewport, mappingMode, { fit = true, driveMeta = null, group = null } = {}) {
  // Back-compat: a pre-v1.15.0 Data Model diagram with mapping mode ON imports as
  // a first-class "Data Mapping" diagram (mapping is now its own type).
  let importType = type;
  if (mappingMode && normalizeDiagramType(type) === 'datamodel') importType = 'datamapping';
  const id = newTab(uniqueTabName(name), importType);
  // Carry the legacy flag forward too (harmless — the type already drives mapping).
  const importedTab = tabs.find(t => t.id === id);
  if (importedTab) importedTab.mappingMode = !!mappingMode;
  notifyChange();
  // The new tab is now active — load the graph into it.
  canvasModule.setLoadingJSON(true);
  try { graph.fromJSON(graphJSON); canvasModule.migrateLinks(); canvasModule.migrateNodes(); } finally { canvasModule.setLoadingJSON(false); }
  // CRITICAL: newTab() created this tab with `graphJSON: null` and the load above only populated the LIVE
  // graph — so flush the live graph into THIS (now active) tab's stored snapshot immediately. Without it the
  // tab's graphJSON stays empty until the first tab-switch, and any activateTab() on it (a clone exported via
  // the tab menu, before the switchTab guard; a re-activation) would fromJSON({cells:[]}) and CLEAR the canvas
  // ("nothing to export"). This makes a freshly cloned / imported tab robust on its own.
  saveCurrentTabState();
  // Loading content into a fresh tab IS a content event (markDirty is guarded by
  // isLoadingJSON, so it won't have stamped) — record it as the modified time so
  // imported / loaded / shared diagrams show a time like edited ones.
  if (importedTab) importedTab.lastModifiedAt = Date.now();
  // Item 1.3: re-link a loaded archive to its Drive master + restore the shares it fanned out to. Runs after the
  // tab exists so adopt mirrors the meta onto the new tab object (chips + session); reconcile verifies on connect.
  if (driveMeta && (driveMeta.driveFileId || driveMeta.driveSharedSource)) {
    persistenceModule.adoptDriveMetaIntoTab?.(id, driveMeta);
  }
  // #7: a single diagram saved/exported from a tab GROUP carries its group meta - recreate-or-REJOIN that group
  // (by name) and drop this tab into it, so loading one diagram restores its group (not only multi-diagram bundles).
  // Done AFTER the load + render() to repaint the tab into its group (reorderTabsByGroup only sorts; it doesn't draw).
  if (importedTab && group && group.name) {
    importedTab.groupId = recreateOrRejoinGroup(group);
    reorderTabsByGroup();
    render();
  }
  if (fit) requestAnimationFrame(() => canvasModule.fitContent());
  // A freshly OPENED non-empty diagram persists to My Drive right away (when connected), not only after an edit.
  // Deferred a frame so a Drive-OPEN caller (importDriveFileById) has set s.fileId first - then saveTabNow dedupes
  // (already in Drive); a plain import (paste / JSON / refresh-latest, no fileId) CREATEs its master; an un-forked
  // view share is skipped inside saveTabNow (Mode C). No-op when not connected (the browser session already holds it).
  requestAnimationFrame(() => persistenceModule.saveTabNow?.(id));
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

  // Unsaved changes: when signed in to Drive we just SAVE on close (doCloseTab flushes to Drive below) - no data
  // loss, so no prompt, per the "closing always saves" directive. Only when NOT signed in (browser-only, real loss
  // risk) do we still ask Save / Close Anyway.
  if (tab.dirty && !persistenceModule.isSignedIn?.()) {
    showCloseConfirmModal(id, tab.name);
    return;
  }

  doCloseTab(id);
}

function doCloseTab(id, { archive = true } = {}) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  // #6: a closing tab persists to My Drive too (when connected) - a work boundary must not lose work. Fire-and-
  // forget: saveTabNow captures the tab's data synchronously (before the splice below) and writes in the background;
  // skipped for delete-closes (archive:false → the diagram is being removed, not saved) and for un-forked view shares
  // (Mode C, handled inside saveTabNow).
  if (archive) persistenceModule.saveTabNow?.(id);

  // Auto-archive a non-empty closing tab to a browser save so it can be reopened from Browser Storage later.
  // Skipped for delete-closes (archive:false). Best-effort — never blocks the close, EXCEPT when the archive
  // fails for a diagram with no Drive copy: that would be permanent silent loss of its only copy, so we stop
  // and let the user decide (export / free space / close anyway) instead of dropping it.
  if (archive) {
    const res = archiveTabToBrowser(id);
    if (res && res.lostBrowserOnly) { promptStorageFullOnClose(id); return; }
  }

  // Last tab — remove it and show unclosable new-diagram modal
  if (tabs.length === 1) {
    tabs.splice(0, 1);
    tbctx.activeTabId = null;
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

  if (tbctx.activeTabId === id) {
    // Switch to the closest remaining tab
    const newIdx = Math.min(idx, tabs.length - 1);
    activateTab(tabs[newIdx].id, false);
  }

  render();
  saveTabs();
}

// A collision-safe browser-archive name: "Name YYYY-MM-DD", then "Name 2 YYYY-MM-DD" … so two different
// diagrams never overwrite each other's archive (the no-clobber rule from the Save Manager review).
function uniqueArchiveName(base, existing) {
  const suffix = dateSuffix();
  let stem = (base || 'Diagram').replace(new RegExp(`( \\d+)? ${suffix}$`), '');   // don't compound the date
  let candidate = `${stem} ${suffix}`;
  if (!existing.has(candidate)) return candidate;
  for (let n = 2; ; n++) { candidate = `${stem} ${n} ${suffix}`; if (!existing.has(candidate)) return candidate; }
}

// Write a closing tab's diagram to a browser named-save so it can be reopened later. Reuses the tab's existing
// archive (update in place) ONLY when no OTHER open tab claims the same name — otherwise two tabs sharing a
// browserSaveName would overwrite each other (e.g. after loading the same save into two tabs, or a same-name
// batch save); the loser falls through to a fresh dated name. Tags the archive with `driveFileId` when the
// diagram is also in Drive (redundant → safe for quota-pressure eviction). On a quota error, sheds redundant
// archives and retries once. The whole body is guarded (some Private-Mode contexts throw even on read), so a
// failure degrades instead of aborting the close. Returns { ok, lostBrowserOnly }: lostBrowserOnly is true when
// the write ultimately failed for a diagram with NO Drive copy — its only copy is at risk, so the caller warns.
function archiveTabToBrowser(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return { ok: true };
  let name, write;
  try {
    const graphJSON = getTabGraphJSON(id);
    if (countDiagramShapes(graphJSON?.cells) === 0) return { ok: true };   // nothing worth keeping
    const saves = persistenceModule.getNamedSaves?.() || [];
    const existing = new Set(saves.map(s => s.name));
    // Reuse this tab's own archive in place (no-clobber), else dedup by Drive identity so re-loading the SAME Drive
    // diagram (a shared file arrives with no browserSaveName) REPLACES its archive instead of piling up dated
    // duplicates (#4). Both reuse paths skip a name another OPEN tab already claims. See archiveDedupName.
    const driveKey = (tab.driveSharedSource && tab.driveSharedSource.fileId) || tab.driveFileId || null;
    const otherOpenSaveNames = tabs.filter(t => t.id !== id).map(t => t.browserSaveName);
    const dd = archiveDedupName({ browserSaveName: tab.browserSaveName, driveKey, saves, otherOpenSaveNames });
    name = dd.reuse || uniqueArchiveName(tab.name, existing);
    const grp = tab.groupId ? getGroup(tab.groupId) : null;
    const data = {
      name, timestamp: Date.now(), version: 1, appVersion: APP_VERSION,
      diagramType: tab.diagramType, graph: compactGraphForSave(graphJSON), viewport: getTabViewport(id),
      group: grp ? { name: grp.name, icon: grp.icon || null, color: grp.color || null } : null,   // #7: reopen back into its group
      driveFileId: tab.driveFileId || null,   // present → redundant (reloadable from Drive) → eviction-eligible
      driveSharedSource: tab.driveSharedSource || null,   // so a CLOSED shared file still reads as shared (item 5)
      driveSharedInEdit: tab.driveSharedInEdit || null,   // Phase B: a CLOSED directly-edited shared file still reads as shared
      // Item 1.3: also stash the rest of the Drive linkage so LOADING this archive re-marks it "In My Drive" and
      // restores the shares it fanned out to (loadNamedSave → adoptDriveMetaIntoTab). Mirrors the session set.
      driveCopies: (tab.driveCopies && tab.driveCopies.length) ? tab.driveCopies : null,
      driveHeadRevisionId: tab.driveHeadRevisionId || null,
      driveLastHash: tab.driveLastHash || null,
      driveLastSavedAt: tab.driveLastSavedAt || null,
      driveImported: tab.driveImported || false,
      driveFolderId: tab.driveFolderId || null,
      driveDriveId: tab.driveDriveId || null,
      driveOutgoingGrants: tab.driveOutgoingGrants || 0,   // direct view/edit invites on the master → "shared out" glyph
    };
    write = () => localStorage.setItem('sfdiag::save::' + name, JSON.stringify(data));
    write();
  } catch (err) {
    if (persistenceModule.isQuotaError?.(err) && write) {
      persistenceModule.evictRedundantArchives?.(0);   // shed redundant Drive-backed copies, then retry once
      try { write(); tab.browserSaveName = name; return { ok: true }; }
      catch (e2) { return failArchive(tab, e2); }
    }
    return failArchive(tab, err);
  }
  tab.browserSaveName = name;
  return { ok: true };
}

// Archive write failed. A Drive-backed diagram is reloadable, so we just warn quietly and let the close proceed.
// A browser-ONLY diagram has no other copy → signal the caller so it can stop the close and ask the user.
function failArchive(tab, err) {
  console.warn('Diagramforce: could not archive closed tab:', err);
  // A clean Drive-backed tab is reloadable from Drive, so a failed browser archive is harmless. But a DIRTY tab's
  // unsaved delta is NOT guaranteed on Drive (the close's fire-and-forget saveTabNow can fail silently, and the
  // existing Drive copy is the PRIOR revision) - so if its only durable backstop (the browser archive) also fails,
  // warn rather than drop it silently. (Browser-only diagrams always warn.)
  return { ok: false, lostBrowserOnly: !tab.driveFileId || !!tab.dirty };
}

// The closing tab's only copy could not be saved (browser storage full / unavailable). Don't drop it silently:
// ask whether to close anyway (losing it) or keep it open so the user can export to JSON / free space first.
async function promptStorageFullOnClose(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  const proceed = await confirmModal({
    title: 'Browser storage full',
    message: `"${tab.name}" could not be saved to Browser Storage${tab.driveFileId ? ", and its Google Drive sync isn't confirmed" : ''}. Export your diagrams to JSON to be safe, or close anyway and risk losing unsaved changes.`,
    okLabel: 'Close anyway', cancelLabel: 'Keep open', tone: 'danger',
  });
  if (!proceed) return;
  tab.dirty = false;
  doCloseTab(id, { archive: false });   // user accepted the loss → force-close without re-attempting the archive
}

// Remove a browser archive by name (the "browser" half of a go-together delete). Also clears the mapping off
// any still-open tab so its Save Manager chip doesn't dangle.
function deleteBrowserArchive(name) {
  if (!name) return;
  persistenceModule.deleteNamedSave?.('sfdiag::save::' + name);
  forgetBrowserSaveName(name);
}


export function switchTab(id) {
  if (id === tbctx.activeTabId) return;
  // A module may veto/defer the switch — e.g. an open Data Mapping table edit session
  // prompts to Save/Discard the unapplied edits first. The guard returns false to block
  // now and re-invokes this continuation once the user resolves (then it returns true).
  if (_switchGuard && !_switchGuard(() => switchTab(id))) return;
  // Flush any pending Drive autosave for the OUTGOING tab before the graph swaps
  // (it reads the still-active graph synchronously). No dialog, best-effort.
  persistenceModule.flushDriveSave?.();
  saveCurrentTabState();
  // Capture the outgoing active tab's position so we can slide a focus bar from it to the new one.
  const oldActiveEl = tabListEl.querySelector('.df-tab--active');
  const oldActiveRect = oldActiveEl ? oldActiveEl.getBoundingClientRect() : null;
  // If the outgoing tab is the lingering active tab of a COLLAPSED group, it hides now — capture that
  // group's tray width so we can animate it shrinking (the tab visibly tucks back into the group).
  let shrinkGroupId = null, shrinkOldW = null;
  const old = tabs.find(t => t.id === tbctx.activeTabId);
  if (old && old.groupId) {
    const g = getGroup(old.groupId);
    if (g && g.collapsed) {
      const tray = tabListEl.querySelector(`.df-tab-group-tray[data-group-id="${g.id}"]`);
      if (tray) { shrinkGroupId = g.id; shrinkOldW = tray.getBoundingClientRect().width; }
    }
  }
  activateTab(id, false);
  render();
  if (shrinkGroupId != null) animateTrayWidth(shrinkGroupId, shrinkOldW);
  animateTabFocusSlide(oldActiveRect);
  flashCanvasSwitch();
  // The pointer rests on the just-clicked tab; "settle" it defocused (resting opaque bg, no hover lift)
  // until it actually moves — so the focus-slide reads as travelling BEHIND the now-opaque active tab,
  // and re-hovering it later restores the normal cue (item 1.2). Reuses the drag-drop hover guard.
  suppressTabHover();
}

/** A quick opacity fade on the canvas when switching tabs, so the content change registers. */
function flashCanvasSwitch() {
  const el = document.getElementById('paper');
  if (!el) return;
  el.classList.remove('df-paper--switching');
  void el.offsetWidth;   // restart the CSS animation
  el.classList.add('df-paper--switching');
}

/** Slide the active tab's "selection" (its dark, bordered background) along the tab row from the OLD
 *  active tab to the NEW one, so the focus change reads as the selection travelling through the list.
 *  No-op under prefers-reduced-motion. */
function animateTabFocusSlide(oldRect) {
  if (!oldRect || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const bar = tabListEl.parentElement;
  const newEl = bar?.querySelector('.df-tab--active');
  if (!bar || !newEl) return;
  const barRect = bar.getBoundingClientRect();
  const newRect = newEl.getBoundingClientRect();
  if (Math.abs(newRect.left - oldRect.left) < 2 && Math.abs(newRect.width - oldRect.width) < 2) return;
  const slide = document.createElement('div');
  slide.className = 'df-tab-focus-slide';
  const place = (r) => {
    slide.style.left = `${r.left - barRect.left}px`;
    slide.style.top = `${r.top - barRect.top}px`;
    slide.style.width = `${r.width}px`;
    slide.style.height = `${r.height}px`;
  };
  place(oldRect);
  // Scale the duration with the travel distance so a multi-tab jump GLIDES; decelerate curve (no
  // ease-in) so it starts moving immediately. The grey ghost rides ABOVE the in-between inactive tabs
  // but BELOW the opaque active tabs (z-index ladder in CSS), so it's visible mid-travel yet occluded
  // at the destination — removing it then is invisible (no blink), and no opacity fade is needed.
  const dist = Math.abs(newRect.left - oldRect.left);
  const dur = Math.round(Math.min(560, 230 + dist * 0.26));
  const ease = 'cubic-bezier(0, 0, 0.2, 1)';   // Material "decelerate": full speed at start, eases to a stop
  slide.style.transition = `left ${dur}ms ${ease}, top ${dur}ms ${ease}, width ${dur}ms ${ease}, height ${dur}ms ${ease}`;
  bar.appendChild(slide);
  void slide.offsetWidth;   // commit the start rect before transitioning
  place(newRect);
  const done = () => slide.remove();
  slide.addEventListener('transitionend', done);   // ends behind the active tab → removal is invisible
  setTimeout(done, dur + 100);   // fallback if transitionend doesn't fire
}

function renameTab(id, name) {
  const tab = tabs.find(t => t.id === id);
  if (tab) {
    const prev = tab.name;
    tab.name = name;
    render();
    saveTabs();
    // Keep the linked Drive master's FILE NAME in step with the tab (fire-and-forget; owned masters only,
    // silent when signed out - CR: a cloned "X (clone)" Drive file kept its stale name after the tab was renamed).
    if (name !== prev) persistenceModule.renameDriveMaster?.(id, name);
  }
}

export function renameActiveTab(name) {
  renameTab(tbctx.activeTabId, name);
}

export function getActiveTabId() {
  return tbctx.activeTabId;
}

export function getActiveTabName() {
  return tabs.find(t => t.id === tbctx.activeTabId)?.name || 'Draft';
}

export function getActiveTabType() {
  return tabs.find(t => t.id === tbctx.activeTabId)?.diagramType || 'architecture';
}

function markDirty() {
  const tab = tabs.find(t => t.id === tbctx.activeTabId);
  if (!tab) return;
  // The change handler ALSO fires during fromJSON loads / tab switches / the post-load icon+link migrations
  // (graph.fromJSON then migrateLinks/migrateNodes/refreshAllIconHrefs re-resolve placeholders + legacy formats).
  // NONE of those are real edits, so they must not stamp a modified time NOR mark the tab dirty. The previous code
  // guarded only the time stamp, so a hard refresh's migrations marked the RESTORED tab dirty + active-undo - the
  // reported "diagram shows changes after a hard refresh" bug. Guard the WHOLE thing (matches the documented intent).
  if (canvasModule.isLoadingJSON?.()) return;
  tab.lastModifiedAt = Date.now();
  if (!tab.dirty) {
    tab.dirty = true;
    render();
  }
}

function markSaved(saveType) {
  const tab = tabs.find(t => t.id === tbctx.activeTabId);
  if (tab) {
    tab.dirty = false;
    tab.lastSavedAt = Date.now();
    tab.lastSaveType = saveType;
    render();
  }
}

// A SPECIFIC tab (not necessarily the active one) finished syncing to Google Drive - clear its dirty dot. The
// autosave SWEEP saves many tabs in quick succession, so coalesce the re-render into one rAF instead of
// thrashing the tab bar per save. Drive is now a first-class "save" for the dot: before this, only browser
// saves (markSaved / markTabsBrowserSaved) ever cleared `dirty`, so a Drive-synced diagram looked permanently
// unsaved (and made the user think auto-sync wasn't running).
let _driveSavedRenderTimer = null;
function markTabDriveSaved(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab || !tab.dirty) return;
  tab.dirty = false;
  tab.lastSavedAt = Date.now();
  tab.lastSaveType = 'drive';
  if (_driveSavedRenderTimer) return;
  _driveSavedRenderTimer = setTimeout(() => { _driveSavedRenderTimer = null; render(); }, 60);
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
    groupId: t.groupId || null,   // lets exportSelection tag each diagram with its group
    isActive: t.id === tbctx.activeTabId,
    dirty: t.dirty,
    lastModifiedAt: t.lastModifiedAt || null,
    lastSavedAt: t.lastSavedAt || null,
    // Drive status for the Save-to-Drive modal's per-row chip.
    driveFileId: t.driveFileId || null,
    driveDriveId: t.driveDriveId || null,             // set → the file LIVES on a team Shared Drive → "Shared Drive" chip + tab glyph
    driveHasMyDriveBackup: hasVerifiedMyDriveBackup(t.driveCopies),   // a Shared-Drive file mirrored into My Drive → "My Drive" chip too. VERIFIED mirrors only: a bare pointer survives the user deleting the mirror in Drive, and the chip must not claim a file that is gone
    driveSharedCopies: (t.driveCopies || []).filter(c => c && c.kind === 'shared-drive').length,
    driveEditShares: (t.driveCopies || []).filter(c => c && c.kind === 'edit-share').length,   // # of editable copies fanned out (Collab/Copy) → "shared by you" out-chip
    driveCopies: (t.driveCopies && t.driveCopies.length) ? t.driveCopies : null,   // raw fan-out targets → lets the Load library cross-ref + hide recipient-editable copies created before the dfEditShareOf stamp
    driveOutgoingGrants: t.driveOutgoingGrants || 0,  // # of direct view/edit invites on the master → "shared by you" out-chip (D3)
    driveSharedSource: t.driveSharedSource || null,   // upstream shared file → Save Manager "Shared File" chip
    driveSharedInEdit: t.driveSharedInEdit || null,   // Phase B: fileId IS a directly-edited shared file → "Shared File" chip + 'both' glyph
    driveImported: t.driveImported || false,          // legacy imported flag (pre Shared File model)
    // Name this tab was last saved-to / loaded-from in the browser named-saves store (used by the Browser
    // Storage manager's reuse-in-place archive + forgetBrowserSaveName cleanup). The Save Manager's browser
    // chip is "This browser" (always on - session auto-save), NOT a getNamedSaves cross-check.
    browserSaveName: t.browserSaveName || null,
  }));
}

/** Record (or clear, with null) the browser named-save this tab maps to. Powers the Save Manager chip. */
export function setTabBrowserSaveName(tabId, name) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  tab.browserSaveName = name || null;
  saveCurrentTabState();
}

/**
 * A batch of tabs was just saved to the browser under given names. Stamp browserSaveName + clear `dirty` +
 * record the save time/type on EACH, then persist + re-render ONCE. Clearing dirty for every saved tab (not
 * just the active one) prevents inactive saved tabs from being left spuriously dirty — which otherwise
 * triggers a stray beforeunload prompt and a sticky dirty dot across reloads (adversarial-review finding).
 * `entries`: [{ id, name }].
 */
export function markTabsBrowserSaved(entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  const now = Date.now();
  let any = false;
  for (const { id, name } of entries) {
    const tab = tabs.find(t => t.id === id);
    if (!tab) continue;
    tab.browserSaveName = name || tab.browserSaveName || null;
    tab.dirty = false;
    tab.lastSavedAt = now;
    tab.lastSaveType = 'browser';
    any = true;
  }
  if (any) { saveCurrentTabState(); render(); }
}

/**
 * Forget a browser named-save mapping on every open tab — called when that save is DELETED. Without this the
 * tab's browserSaveName dangles: the Save Manager "In Browser" chip would re-light if a DIFFERENT diagram is
 * later saved under the freed name, and a re-save-in-place would clobber it (adversarial-review finding).
 */
function forgetBrowserSaveName(name) {
  if (!name) return;
  let changed = false;
  for (const tab of tabs) { if (tab.browserSaveName === name) { tab.browserSaveName = null; changed = true; } }
  if (changed) { saveCurrentTabState(); render(); }
}

/** Get the graph JSON for a specific tab. Active tab reads live graph. */
export function getTabGraphJSON(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return null;
  if (tab.id === tbctx.activeTabId) return graph.toJSON();
  return tab.graphJSON;
}

/** Get viewport for a specific tab. */
export function getTabViewport(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return null;
  if (tab.id === tbctx.activeTabId) return canvasModule.getViewport();
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
  const tab = tabs.find(t => t.id === tbctx.activeTabId);
  // Mapping mode is driven by the diagram TYPE (its own "Data Mapping" type); the
  // legacy per-tab `mappingMode` flag is still honoured for back-compat.
  return tab?.diagramType === 'datamapping' || !!tab?.mappingMode;
}
export function getTabMappingMode(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  return tab?.diagramType === 'datamapping' || !!tab?.mappingMode;
}
export function onChange(cb) { onChangeCallbacks.push(cb); }
function notifyChange() { onChangeCallbacks.forEach(cb => cb()); }

// ── Tab groups (v1.16.0) ─────────────────────────────────────────────
// A group is a named, optionally icon + accent-colour tagged folder of tabs. Each tab carries a
// `groupId` (null = ungrouped). Groups render as inline chips in the tab bar, each followed by its
// tabs; ungrouped tabs sit after every group. Visual order = groups[] order, then within each
// group the tabs[] order, then the ungrouped tabs[] order. reorderTabsByGroup() keeps `tabs` in
// that visual order so drag-reorder, render, and serialization all agree on one sequence.
function generateGroupId() { return `group-${tbctx.nextGroupId++}`; }
function getGroup(id) { return id ? groups.find(g => g.id === id) || null : null; }

// Rank a tab's group for ordering: its index in groups[], or "last" when ungrouped / orphaned.
function groupRank(groupId) {
  const i = groups.findIndex(g => g.id === groupId);
  return i === -1 ? groups.length : i;
}
// Stable-sort tabs into visual order (grouped contiguous in groups[] order, ungrouped last).
// Array.prototype.sort is stable (ES2019+), so each group's manual tab order is preserved.
function reorderTabsByGroup() {
  tabs.sort((a, b) => groupRank(a.groupId) - groupRank(b.groupId));
}

export function getGroups() {
  return groups.map(g => ({ id: g.id, name: g.name, icon: g.icon, color: g.color, collapsed: g.collapsed }));
}

/** HTML for a group badge (name + accent dot) shown on the Save / Close-tabs rows. '' when ungrouped.
 *  Exported so the Save modal (toolbar.js) renders it identically. `group` is a {name,color} object. */
export function groupBadgeHtml(group) {
  if (!group) return '';
  const color = sanitizeCssColor(group.color);   // safe to inline in style
  return `<span class="df-row-group-badge"${color ? ` style="--g:${color}"` : ''}><span>${escHtml(group.name)}</span></span>`;
}

/** Create a new (empty) group and return its id. */
function createGroup(name = 'Group', opts = {}) {
  const id = generateGroupId();
  // Default to the 'tabset' icon so a group always has one (render also falls back to it).
  groups.push({ id, name: (name || 'Group').trim() || 'Group', icon: opts.icon || 'tabset', color: opts.color || null, collapsed: false });
  saveTabs();
  render();
  notifyChange();
  return id;
}

/** Update a group's metadata (name / icon / color). Pass only the fields to change. */
function updateGroup(id, patch) {
  const g = getGroup(id);
  if (!g) return;
  if (patch.name != null) g.name = patch.name.trim() || g.name;
  if ('icon' in patch) g.icon = patch.icon || null;
  if ('color' in patch) g.color = patch.color || null;
  saveTabs();
  render();
}

function toggleGroupCollapsed(id) {
  if (id === UNGROUPED_ID) {
    // Synthetic Ungrouped group: collapse flag lives in `tbctx.ungroupedCollapsed`, not a `groups[]` entry.
    if (!tbctx.ungroupedCollapsed && !tabs.some(t => !t.groupId)) return;   // nothing to hide
    const oldTrayU = tabListEl.querySelector(`.df-tab-group-tray[data-group-id="${UNGROUPED_ID}"]`);
    const oldWU = oldTrayU ? oldTrayU.getBoundingClientRect().width : null;
    tbctx.ungroupedCollapsed = !tbctx.ungroupedCollapsed;
    saveTabs();
    render();
    animateTrayWidth(UNGROUPED_ID, oldWU);
    return;
  }
  const g = getGroup(id);
  if (!g) return;
  // An empty group can't be collapsed — there's nothing to hide.
  if (!g.collapsed && !tabs.some(t => t.groupId === id)) return;
  // Measure the tray's current width for a FLIP width animation across the re-render.
  const oldTray = tabListEl.querySelector(`.df-tab-group-tray[data-group-id="${id}"]`);
  const oldW = oldTray ? oldTray.getBoundingClientRect().width : null;
  g.collapsed = !g.collapsed;
  saveTabs();
  render();
  animateTrayWidth(id, oldW);
}

/** FLIP the tray width old → new so collapse/expand slides instead of snapping. The tabs are
 *  added/removed by render(); clipping the width change with overflow:hidden makes them appear to
 *  slide in / out. No-op under prefers-reduced-motion. */
function animateTrayWidth(id, oldW) {
  if (oldW == null) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const tray = tabListEl.querySelector(`.df-tab-group-tray[data-group-id="${id}"]`);
  if (!tray) return;
  const newW = tray.getBoundingClientRect().width;
  if (Math.abs(newW - oldW) < 1) return;
  tray.style.overflow = 'hidden';
  // CRITICAL: `overflow:hidden` makes this flex item's `min-width:auto` resolve to 0, so while the row
  // overflows (which it does mid-collapse — the other tabs have already widened) flex-shrink would
  // collapse the tray to its 3px padding for a frame, making the group VANISH before snapping back
  // (worst on the leftmost group). Pinning flex-shrink:0 holds the tray at exactly the animated width.
  tray.style.flexShrink = '0';
  tray.style.width = oldW + 'px';
  void tray.offsetWidth;   // force a reflow so the next width change transitions
  // 260ms on a decelerate curve — the old 180ms `ease` read as a quick "snap"; this glides.
  tray.style.transition = 'width 260ms cubic-bezier(0.4, 0, 0.2, 1)';
  tray.style.width = newW + 'px';
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    tray.style.transition = '';
    tray.style.width = '';
    tray.style.overflow = '';
    tray.style.flexShrink = '';
    tray.removeEventListener('transitionend', cleanup);
    // The collapse/expand changed the row's content width; re-check overflow (so an EXPAND that newly
    // overflows surfaces the « » arrows immediately, not only after the first scroll) and the pins.
    updateScrollButtons();
    measurePins();
  };
  tray.addEventListener('transitionend', cleanup);
  setTimeout(cleanup, 360);   // fallback if transitionend doesn't fire
}

/** Assign a tab to a group (or null to ungroup), keeping `tabs` in visual order. */
function setTabGroup(tabId, groupId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  tab.groupId = groupId || null;
  reorderTabsByGroup();
  saveTabs();
  render();
}

/** Reorder groups so `groupId` sits before the group `targetGroupId` (or last when null). */
function moveGroupBefore(groupId, targetGroupId) {
  const from = groups.findIndex(g => g.id === groupId);
  if (from === -1 || groupId === targetGroupId) return;
  const [moved] = groups.splice(from, 1);
  let to = targetGroupId ? groups.findIndex(g => g.id === targetGroupId) : groups.length;
  if (to === -1) to = groups.length;
  groups.splice(to, 0, moved);
  reorderTabsByGroup();
  saveTabs();
  render();
}

/** Delete a group; its tabs become ungrouped (the diagrams are kept). */
function deleteGroupKeepTabs(id) {
  for (const t of tabs) if (t.groupId === id) t.groupId = null;
  const i = groups.findIndex(g => g.id === id);
  if (i !== -1) groups.splice(i, 1);
  reorderTabsByGroup();
  saveTabs();
  render();
  notifyChange();
}

/** Delete a group AND close its diagrams (the explicit destructive choice). confirmDeleteGroup is
 *  the confirmation, so we don't re-prompt per dirty tab here. */
function deleteGroupWithTabs(id) {
  const doomed = new Set(tabs.filter(t => t.groupId === id).map(t => t.id));
  for (let i = tabs.length - 1; i >= 0; i--) if (doomed.has(tabs[i].id)) tabs.splice(i, 1);
  const gi = groups.findIndex(g => g.id === id);
  if (gi !== -1) groups.splice(gi, 1);
  if (doomed.has(tbctx.activeTabId)) {
    if (tabs.length === 0) {
      tbctx.activeTabId = null;
      selectionModule.clearSelection();
      canvasModule.setLoadingJSON(true);
      try { graph.fromJSON({ cells: [] }); } finally { canvasModule.setLoadingJSON(false); }
      canvasModule.setViewport({ zoom: 1, translate: { tx: 0, ty: 0 } });
      render(); saveTabs(); notifyChange();
      showNewDiagramModal();
      return;
    }
    activateTab(tabs[0].id, false);   // activateTab persists + notifies
  }
  reorderTabsByGroup();
  render(); saveTabs(); notifyChange();
}

/** The 3-option delete overlay: Cancel / Delete group (keep diagrams) / Delete group with diagrams. */
function confirmDeleteGroup(group) {
  document.querySelector('.df-delete-group-modal')?.remove();
  const groupTabs = tabs.filter(t => t.groupId === group.id);
  const n = groupTabs.length;
  const dirty = groupTabs.filter(t => t.dirty).length;
  const { footer, close } = buildModal({
    title: 'Delete group?',
    className: 'df-delete-group-modal',
    zIndex: 3000, width: '460px', showClose: false,
    bodyStyle: 'padding:var(--spacing-md) var(--spacing-lg)',
    bodyHtml: `
      <p style="margin:0 0 var(--spacing-sm);color:var(--text-primary);font-size:var(--font-size-sm);line-height:1.5">
        Delete <strong>${escHtml(group.name)}</strong>${n ? ` and its ${n} diagram${n === 1 ? '' : 's'}` : ''}?
      </p>
      <p style="margin:0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">
        <strong>Delete group</strong> keeps the diagram${n === 1 ? '' : 's'} (they become ungrouped).
        <strong>Delete group with diagrams</strong> also closes ${n === 1 ? 'it' : 'them'}${dirty ? ` - <strong style="color:var(--color-danger,#c23934)">${dirty} ha${dirty === 1 ? 's' : 've'} unsaved changes</strong>` : ''}.
      </p>`,
    footerHtml: `
      <button class="df-modal__btn" data-action="cancel" style="margin-right:auto">Cancel</button>
      <button class="df-modal__btn df-modal__btn--danger-outline" data-action="with">Delete group with diagrams</button>
      <button class="df-modal__btn df-modal__btn--danger" data-action="keep">Delete group</button>`,
  });
  footer.querySelector('[data-action="cancel"]').addEventListener('click', close);
  footer.querySelector('[data-action="keep"]').addEventListener('click', () => { close(); deleteGroupKeepTabs(group.id); });
  footer.querySelector('[data-action="with"]').addEventListener('click', () => { close(); deleteGroupWithTabs(group.id); });
}

// ── Floating menus / popovers (group ⋯ menu, colour + icon pickers, tab assignment) ──
let _floatClose = null;
function closeFloating() { if (_floatClose) { _floatClose(); _floatClose = null; } }
function openFloating(anchorEl, className, build) {
  closeFloating();
  const panel = document.createElement('div');
  panel.className = 'df-tab-pop' + (className ? ' ' + className : '');
  document.body.appendChild(panel);
  build(panel, closeFloating);
  // Anchor below the trigger, flipping/clamping to stay on-screen.
  const r = anchorEl.getBoundingClientRect();
  const w = panel.offsetWidth, h = panel.offsetHeight;
  let left = Math.min(r.left, window.innerWidth - w - 8);
  let top = r.bottom + 4;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
  panel.style.left = `${Math.max(8, left)}px`;
  panel.style.top = `${top}px`;
  // Shared dismissal lifecycle (V3): outside-mousedown close + Escape (stopPropagation so the canvas selection
  // survives). Same behaviour as before - now one implementation shared with the canvas right-click menu.
  const teardown = wireMenuDismiss(panel, closeFloating, { event: 'mousedown' });
  _floatClose = () => { teardown(); panel.remove(); };
}
function menuItem(label, onClick, opts = {}) {
  const b = document.createElement('button');
  const hasIcon = opts.icon || opts.iconSvg;
  b.className = 'df-tab-pop__item' + (hasIcon ? ' df-tab-pop__item--icon' : '') + (opts.danger ? ' df-tab-pop__item--danger' : '') + (opts.checked ? ' is-checked' : '') + (opts.className ? ' ' + opts.className : '');
  if (hasIcon) {
    // Leading icon: an SLDS sprite (`icon`) or raw inline markup (`iconSvg`, e.g. a diagram-type glyph).
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'df-toolbar__icon');
    svg.setAttribute('aria-hidden', 'true');
    if (opts.iconSvg) { svg.setAttribute('viewBox', '0 0 16 16'); svg.innerHTML = opts.iconSvg; }
    else { svg.innerHTML = `<use href="#${String(opts.icon).replace(/[^a-zA-Z0-9_-]/g, '')}"></use>`; }
    b.appendChild(svg);
    b.appendChild(document.createTextNode(label));
  } else {
    b.textContent = label;
  }
  b.addEventListener('click', () => { closeFloating(); onClick(); });
  return b;
}
function menuSep() { const d = document.createElement('div'); d.className = 'df-tab-pop__sep'; return d; }

function openGroupColorPopover(anchorEl, group) {
  openFloating(anchorEl, 'df-tab-pop--swatches', (panel) => {
    const grid = document.createElement('div');
    grid.className = 'df-tab-pop__swatches';
    const palette = [...new Set([...getPalette(), '#1d73c9', '#da4e55', '#f6b355', '#27ae60', '#ffffff', '#1c1e21'])];
    for (const hex of palette) {
      const sw = document.createElement('button');
      sw.className = 'df-tab-pop__swatch' + ((group.color || '').toLowerCase() === hex.toLowerCase() ? ' is-active' : '');
      sw.style.backgroundColor = hex; sw.title = hex;
      sw.addEventListener('click', () => { closeFloating(); updateGroup(group.id, { color: hex }); });
      grid.appendChild(sw);
    }
    panel.appendChild(grid);
    const row = document.createElement('div'); row.className = 'df-tab-pop__row';
    const custom = document.createElement('input');
    custom.type = 'color'; custom.value = group.color || '#1d73c9'; custom.className = 'df-tab-pop__color'; custom.title = 'Custom color';
    custom.addEventListener('input', () => updateGroup(group.id, { color: custom.value }));
    row.appendChild(custom);
    row.appendChild(menuItem('Reset color', () => updateGroup(group.id, { color: null }), { className: 'df-tab-pop__item--center' }));
    panel.appendChild(row);
  });
}

function openGroupIconPopover(anchorEl, group) {
  openFloating(anchorEl, 'df-tab-pop--icons', (panel) => {
    const search = document.createElement('input');
    search.type = 'search'; search.placeholder = 'Search icons…'; search.className = 'df-tab-pop__search';
    const grid = document.createElement('div'); grid.className = 'df-tab-pop__icons';
    const renderGrid = (q) => {
      grid.innerHTML = '';
      const list = (q ? getAllIcons().filter(i => i.name.toLowerCase().includes(q)) : getAllIcons()).slice(0, 60);
      for (const ic of list) {
        const b = document.createElement('button');
        b.className = 'df-tab-pop__icon' + (group.icon === ic.id ? ' is-active' : ''); b.title = ic.name;
        b.innerHTML = `<svg width="16" height="16"><use href="#${ic.id}"></use></svg>`;
        b.addEventListener('click', () => { closeFloating(); updateGroup(group.id, { icon: ic.id }); });
        grid.appendChild(b);
      }
    };
    renderGrid('');
    search.addEventListener('input', () => renderGrid(search.value.trim().toLowerCase()));
    panel.appendChild(search);
    if (group.icon) panel.appendChild(menuItem('Remove icon', () => updateGroup(group.id, { icon: null })));
    panel.appendChild(grid);
    setTimeout(() => search.focus(), 0);
  });
}

function openGroupMenu(anchorEl, group) {
  openFloating(anchorEl, 'df-tab-pop--menu', (panel) => {
    panel.appendChild(menuItem('New diagram in group', () => showNewDiagramModal(group.id), { icon: 'add' }));
    panel.appendChild(menuSep());
    panel.appendChild(menuItem(group.collapsed ? 'Expand group' : 'Collapse group', () => toggleGroupCollapsed(group.id), { icon: group.collapsed ? 'chevronright' : 'chevrondown' }));
    panel.appendChild(menuItem('Rename group', () => {
      const chip = tabListEl.querySelector(`.df-tab-group[data-group-id="${group.id}"]`);
      const nameEl = chip?.querySelector('.df-tab-group__name');
      if (chip && nameEl) startGroupRename(chip, nameEl, group);
    }, { icon: 'edit' }));
    panel.appendChild(menuItem('Set group color', () => openGroupColorPopover(anchorEl, group), { icon: 'color_swatch' }));
    panel.appendChild(menuItem('Set group icon', () => openGroupIconPopover(anchorEl, group), { icon: 'image' }));
    panel.appendChild(menuSep());
    if (tabs.some(t => t.groupId === group.id)) {
      panel.appendChild(menuItem('Export group to JSON', () => exportGroup(group.id), { icon: 'download' }));
      // Share the whole group via Google Drive (a classic URL can't carry a multi-diagram group) —
      // shown only when synced, since it needs Drive.
      if (persistenceModule.isDriveConnected?.()) {
        panel.appendChild(menuItem('Share group', () => shareGroup(group.id), { icon: 'share_link' }));
      }
      panel.appendChild(menuSep());
      panel.appendChild(menuItem('Ungroup all tabs', () => {
        for (const t of tabs) if (t.groupId === group.id) t.groupId = null;
        reorderTabsByGroup(); saveTabs(); render();
      }, { icon: 'unlinked' }));
    }
    panel.appendChild(menuItem('Delete group', () => confirmDeleteGroup(group), { danger: true, icon: 'delete' }));
  });
}

/** Context menu for the synthetic Ungrouped group (#10): Collapse/Expand, Export to JSON, Share - acting on the
 *  loose tabs (no rename/colour/delete/drag, which are meaningless for it). Collapse reads the module-level
 *  `tbctx.ungroupedCollapsed` flag (not a groups[] .collapsed). */
function openUngroupedMenu(anchorEl) {
  const hasTabs = tabs.some(t => !t.groupId);
  openFloating(anchorEl, 'df-tab-pop--menu', (panel) => {
    panel.appendChild(menuItem(
      tbctx.ungroupedCollapsed ? 'Expand group' : 'Collapse group',
      () => toggleGroupCollapsed(UNGROUPED_ID),
      { icon: tbctx.ungroupedCollapsed ? 'chevronright' : 'chevrondown' }
    ));
    if (hasTabs) {
      panel.appendChild(menuSep());
      panel.appendChild(menuItem('Export group to JSON', () => exportGroup(UNGROUPED_ID), { icon: 'download' }));
      if (persistenceModule.isDriveConnected?.()) {
        panel.appendChild(menuItem('Share group', () => shareGroup(UNGROUPED_ID), { icon: 'share_link' }));
      }
    }
  });
}

/**
 * Export a whole group as a `kind:'group'` bundle — round-trips the group's
 * name/icon/colour plus every diagram in it. Re-importing the file recreates the
 * group with its tabs (vs a plain bundle, which lands diagrams in browser saves).
 * Empty drafts are skipped by exportSelection; a fully-empty group → "nothing to
 * export" toast there.
 */
function exportGroup(groupId) {
  saveCurrentTabState();   // flush the active tab's live graph before reading tab graphs
  // The synthetic Ungrouped group (#10): export its loose tabs as a PLAIN bundle (no `groups` meta) so it
  // doesn't re-import as a literal "Ungrouped" named group.
  if (groupId === UNGROUPED_ID) {
    const tabIds = tabs.filter(t => !t.groupId).map(t => t.id);
    if (tabIds.length === 0) return;
    persistenceModule.exportSelection({ tabIds });
    return;
  }
  const g = getGroup(groupId);
  if (!g) return;
  const tabIds = tabs.filter(t => t.groupId === groupId).map(t => t.id);
  if (tabIds.length === 0) return;
  persistenceModule.exportSelection({ tabIds, groups: [{ id: g.id, name: g.name, icon: g.icon || null, color: g.color || null }] });
}

/** Share a whole group via Google Drive — saves each diagram to Drive, makes them public, and shows ONE
 *  group link (`#dfg=`) that opens them all and rebuilds the group, plus the per-diagram links. Drive-only
 *  (a classic URL can't carry a group). The group's colour + icon ride along so the recipient's group matches. */
function shareGroup(groupId) {
  saveCurrentTabState();
  // The synthetic Ungrouped group (#10): share its loose tabs under a generic "Ungrouped" group link.
  if (groupId === UNGROUPED_ID) {
    const tabIds = tabs.filter(t => !t.groupId).map(t => t.id);
    if (tabIds.length === 0) return;
    persistenceModule.shareGroupToDrive(tabIds, 'Ungrouped', { color: null, icon: null });
    return;
  }
  const g = getGroup(groupId);
  if (!g) return;
  const tabIds = tabs.filter(t => t.groupId === groupId).map(t => t.id);
  if (tabIds.length === 0) return;   // menu only offers Share when the group has diagrams
  persistenceModule.shareGroupToDrive(tabIds, g.name, { color: g.color || null, icon: g.icon || null });
}

// Mobile: the single "+" button opens a tiny menu choosing Diagram (full new-diagram modal) or Group
// (create + inline-rename), mirroring the two labelled desktop buttons that are hidden on narrow viewports.
function openNewMobileMenu(anchorEl) {
  openFloating(anchorEl, 'df-tab-pop--menu', (panel) => {
    panel.appendChild(menuItem('Diagram', () => showNewDiagramModal(), { icon: 'add' }));
    panel.appendChild(menuItem('Group', () => {
      const id = createGroup(uniqueGroupName('Group'));
      const chip = tabListEl.querySelector(`.df-tab-group[data-group-id="${id}"]`);
      const nameEl = chip?.querySelector('.df-tab-group__name');
      if (chip && nameEl) startGroupRename(chip, nameEl, getGroup(id));
    }, { icon: 'tabset' }));
  });
}

// Right-click "+ Diagram" → a quick type picker (icon + name per diagram type), bypassing the full
// new-diagram modal. Left-click still opens the modal.
function openNewDiagramMenu(anchorEl) {
  openFloating(anchorEl, 'df-tab-pop--menu', (panel) => {
    const header = document.createElement('div'); header.className = 'df-tab-pop__header'; header.textContent = 'New diagram';
    panel.appendChild(header);
    // Lead with the Salesforce data-modelling types, then the rest in their declared order.
    const lead = ['architecture', 'datamodel', 'datamapping'];
    const order = [...lead, ...Object.keys(DIAGRAM_TYPES).filter(t => !lead.includes(t))];
    for (const type of order) {
      panel.appendChild(menuItem(DIAGRAM_TYPES[type].short, () => createDiagramOfType(type), { iconSvg: diagramTypeIconMarkup(type) }));
    }
  });
}

// Clone glyph — the same line-art "duplicate" mark the canvas context menu + properties pane use (self-styled
// inside the <g> so it renders regardless of the menu icon's CSS).
const CLONE_GLYPH = '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="2"/><path d="M3 11H2.5A1.5 1.5 0 011 9.5V2.5A1.5 1.5 0 012.5 1h7A1.5 1.5 0 0111 2.5V3"/></g>';
// Two side-by-side panels — a "compare A vs B / diff view" mark (distinct from CLONE_GLYPH's OVERLAPPING
// rects). Kept in sync with the toolbar "Compare with" button icon in index.html.
const COMPARE_GLYPH = '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="5" height="10" rx="1.4"/><rect x="9" y="3" width="5" height="10" rx="1.4"/></g>';

// Right-click a tab → clone / export / share it, or assign it to a group (ungroup / create a new group).
function openTabGroupMenu(anchorEl, tab) {
  openFloating(anchorEl, 'df-tab-pop--menu', (panel) => {
    // Clone — an exact duplicate of this diagram as a NEW tab named "<name> (clone)". Deep-copies the cells into
    // a separate graph (ids may repeat across tabs - each tab is its own isolated graph), so the copy is
    // byte-identical in layout. importDiagramAsTab uniquifies the name and fits the new tab.
    panel.appendChild(menuItem('Clone', () => {
      saveCurrentTabState();   // flush the active tab's live graph so a clone of the ACTIVE tab is current
      const cells = (tab.id === tbctx.activeTabId ? graph.toJSON().cells : getTabGraphJSON(tab.id)?.cells) || [];
      const cloneCells = JSON.parse(JSON.stringify(cells));   // separate graph — never share cell object refs
      importDiagramAsTab(`${tab.name} (clone)`, tab.diagramType, { cells: cloneCells }, null, tab.mappingMode);
      saveTabs();
    }, { iconSvg: CLONE_GLYPH }));
    // Compare — diff the ACTIVE tab against THIS (right-clicked) tab, in place: stay on the open diagram and see
    // it tinted vs the one you right-clicked (the baseline). Does NOT switch tabs. Falls back to the picker if
    // no handler is wired or you right-clicked the active tab itself (can't diff against itself).
    panel.appendChild(menuItem('Compare', () => {
      if (_compareTabHandler) _compareTabHandler(tab);
      else { switchTab(tab.id); requestAnimationFrame(() => document.getElementById('btn-review-changes')?.click()); }
    }, { iconSvg: COMPARE_GLYPH }));
    panel.appendChild(menuSep());
    // Per-diagram export / share actions.
    panel.appendChild(menuItem('Export diagram to JSON', () => {
      saveCurrentTabState();   // flush the active tab's live graph before reading it
      persistenceModule.exportSelection({ tabIds: [tab.id] });
    }, { icon: 'download' }));
    // switchTab (NOT activateTab): on the ACTIVE tab it early-returns, so the LIVE canvas — including edits made
    // since the last tab switch — rasterizes as-is. activateTab() has no same-tab guard and re-runs
    // graph.fromJSON(tab.graphJSON), silently REVERTING the canvas to the stale stored snapshot. copyCellsAsPng
    // copies the whole tab (all elements) to the OS clipboard; `deferToNextFrame` lets the just-switched views render
    // before the raster (the clipboard write still registers inside this click gesture via the promise).
    panel.appendChild(menuItem('Copy as PNG', () => {
      switchTab(tab.id);
      persistenceModule.copyCellsAsPng(graph.getElements(), { deferToNextFrame: true });
    }, { icon: 'image' }));
    panel.appendChild(menuItem('Copy as PNG (transparent)', () => {
      switchTab(tab.id);
      persistenceModule.copyCellsAsPng(graph.getElements(), { deferToNextFrame: true, transparent: true });
    }, { icon: 'image' }));
    panel.appendChild(menuItem('Share diagram', () => {
      switchTab(tab.id);                   // same guard as PNG export: never fromJSON-revert the active tab to a stale snapshot before sharing
      persistenceModule.shareAsURL();
    }, { icon: 'share_link' }));
    panel.appendChild(menuSep());

    const header = document.createElement('div'); header.className = 'df-tab-pop__header'; header.textContent = 'Move to group';
    panel.appendChild(header);
    for (const g of groups) panel.appendChild(menuItem(g.name, () => setTabGroup(tab.id, g.id), { checked: tab.groupId === g.id, icon: g.icon || 'tabset' }));
    panel.appendChild(menuItem('Create new group', () => {
      const id = createGroup(uniqueGroupName('Group'));
      setTabGroup(tab.id, id);
      const chip = tabListEl.querySelector(`.df-tab-group[data-group-id="${id}"]`);
      const nameEl = chip?.querySelector('.df-tab-group__name');
      if (chip && nameEl) startGroupRename(chip, nameEl, getGroup(id));
    }, { icon: 'add' }));
    if (tab.groupId) { panel.appendChild(menuSep()); panel.appendChild(menuItem('Remove from group', () => setTabGroup(tab.id, null), { icon: 'unlinked' })); }
    // Close actions, set apart at the bottom. A Drive-synced tab gets Close and Delete FIRST (trash the master +
    // close), then the plain Close below it; a local-only tab gets just Close (nothing on Drive to delete). Plain
    // Close routes through the unsaved-changes guard when dirty.
    panel.appendChild(menuSep());
    if (tab.driveFileId) {
      panel.appendChild(menuItem('Close and Delete', async () => {
        const ok = await confirmModal({
          title: 'Close and delete from Google Drive?',
          message: 'This diagram moves to your Google Drive trash (recoverable for 30 days) and the tab closes. Any shared copies are unaffected.',
          okLabel: 'Move to trash', cancelLabel: 'Cancel', tone: 'danger',
        });
        if (!ok) return;
        if (await persistenceModule.deleteDiagramFromDrive?.(tab.driveFileId)) {
          showToast('Moved to Google Drive trash ✓', 'info');
          const t = tabs.find(x => x.id === tab.id);
          if (t) {
            t.dirty = false;          // already confirmed → don't re-prompt the unsaved-changes guard
            if (t.browserSaveName) deleteBrowserArchive(t.browserSaveName);   // go together: remove the browser copy too
          }
          doCloseTab(tab.id, { archive: false });   // deleting, so don't re-archive on close
        }
      }, { danger: true, icon: 'delete' }));
    }
    panel.appendChild(menuItem('Close', () => closeTab(tab.id), { icon: 'close' }));   // plain Close LAST (below Close and Delete)
  });
}

// ── Internal ─────────────────────────────────────────────────────────


// ── Drag insertion line (single shared element) ──────────────────────
// One absolutely-positioned bar in the tab bar, moved by JS to the centre of the gap a dragged
// tab will drop into. A single element means there's never a left-edge + right-edge pair.
let _insertionLine = null;
function showInsertionLine(el, after) {
  const bar = tabListEl.parentElement;   // .df-tabs (position: relative)
  if (!bar) return;
  if (!_insertionLine) { _insertionLine = document.createElement('div'); _insertionLine.className = 'df-tab-insertion'; }
  if (_insertionLine.parentElement !== bar) bar.appendChild(_insertionLine);
  const barRect = bar.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  // Centre of the ~2px gap on the chosen side, in bar coordinates (correct even when the list is scrolled).
  _insertionLine.style.left = ((after ? r.right + 1 : r.left - 1) - barRect.left) + 'px';
  _insertionLine.style.display = 'block';
  // The precise insertion line and a group "drop into me" highlight are mutually exclusive — showing
  // one clears the other (else a collapsed group could wear both: its tray highlight + a stray line).
  tabListEl.querySelectorAll('.df-tab-group-tray--drag-over').forEach((t) => t.classList.remove('df-tab-group-tray--drag-over'));
}
function hideInsertionLine() { if (_insertionLine) _insertionLine.style.display = 'none'; }

// After a drag-drop, render() rebuilds the tabs under a stationary cursor, leaving a stuck :hover
// (Chromium clears it only on the next pointer interaction) — so a tab just dropped into a group
// wore the group-hover tint. Guard the bar with `--no-hover` (CSS neutralises hover) and lift it on
// the first real pointer move/down.
function suppressTabHover() {
  const bar = tabListEl.parentElement;
  if (!bar) return;
  bar.classList.add('df-tabs--no-hover');
  const clear = () => {
    bar.classList.remove('df-tabs--no-hover');
    document.removeEventListener('pointermove', clear, true);
    document.removeEventListener('pointerdown', clear, true);
  };
  document.addEventListener('pointermove', clear, true);
  document.addEventListener('pointerdown', clear, true);
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
  if (tabs.length === 0 && !document.querySelector('.df-new-modal') && !persistenceModule.hasPendingUrlLoad?.()) {
    // ...but not while an Open-with / share launch is still mid-flight (A2) — its own sign-in / load modal owns the
    // screen. Once loadFromURL() has run it strips the URL, so a genuinely-stranded blank app (load failed, 0 tabs)
    // still re-offers New Diagram on the next render.
    setTimeout(showNewDiagramModal, 0);
  }

  const renderTab = (tab) => {
    const el = document.createElement('div');
    el.className = 'df-tab' +
      (tab.id === tbctx.activeTabId ? ' df-tab--active' : '') +
      (tab.dirty ? ' df-tab--dirty' : '') +
      (tab.groupId ? ' df-tab--grouped' : '');
    el.dataset.tabId = tab.id;
    // A grouped tab carries its group's accent colour (for the top strip linking it to the chip).
    if (tab.groupId) { const g = getGroup(tab.groupId); if (g?.color) el.style.setProperty('--group-accent', g.color); }

    // Diagram type icon
    const typeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    typeIcon.setAttribute('class', 'df-tab__type-icon');
    typeIcon.setAttribute('width', '12');
    typeIcon.setAttribute('height', '12');
    typeIcon.setAttribute('viewBox', '0 0 16 16');
    typeIcon.setAttribute('fill', 'currentColor');
    typeIcon.innerHTML = diagramTypeIconMarkup(tab.diagramType);

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

    // R7 — collaboration glyph: only when edits here reach OTHER people. Two glyphs by direction (out vs in);
    // see buildShareGlyph. Local-only + view-only shared sources show nothing.
    const shareGlyph = buildShareGlyph(tab);

    // Compose the row title so the dirty hint reaches both pointer-hover
    // and screen-reader announcements via the same channel.
    const sharedSuffix = shareGlyph ? ' - shared (your edits reach others)' : '';
    el.setAttribute('title', tab.dirty ? `${tab.name} (unsaved)` : tab.name);
    el.setAttribute('aria-label', (tab.dirty ? `${tab.name} - unsaved changes` : tab.name) + sharedSuffix);

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

    // Idea 1: the share glyph and the close button share ONE right-edge slot - the amber glyph shows at rest, and on
    // hover / active / keyboard-focus it swaps to the x, reclaiming the glyph's width for the tab name. The glyph is
    // decorative (pointer-events:none in CSS) so the close underneath always takes the click. On touch (no hover) the
    // two sit side by side instead (CSS .df-tab__end under @media (hover:none)), so the share cue never disappears.
    const end = document.createElement('div');
    end.className = 'df-tab__end';
    if (shareGlyph) end.appendChild(shareGlyph);
    end.appendChild(close);

    el.appendChild(typeIcon);
    el.appendChild(dot);
    el.appendChild(label);
    el.appendChild(end);

    // Drag-and-drop reorder
    el.draggable = true;
    el.addEventListener('dragstart', (evt) => {
      evt.dataTransfer.setData('text/plain', 'tab:' + tab.id);
      evt.dataTransfer.effectAllowed = 'move';
      _dragKind = 'tab';
      el.classList.add('df-tab--dragging');
    });
    el.addEventListener('dragend', () => {
      _dragKind = null;
      el.classList.remove('df-tab--dragging');
      hideInsertionLine();
      tabListEl.querySelectorAll('.df-tab-group-tray--drag-over').forEach(t => t.classList.remove('df-tab-group-tray--drag-over'));
    });
    el.addEventListener('dragover', (evt) => {
      evt.preventDefault();
      evt.dataTransfer.dropEffect = 'move';
      if (_dragKind !== 'tab') return;   // a group drag shows the tray border, not a tab insertion line
      // One centred insertion line on the side the tab will drop (left/right half of the hovered tab).
      const rect = el.getBoundingClientRect();
      const after = (evt.clientX - rect.left) > rect.width / 2;
      showInsertionLine(el, after);
    });
    el.addEventListener('drop', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();   // we handle the precise insertion here; don't let the tray also "join group"
      const rect = el.getBoundingClientRect();
      const after = (evt.clientX - rect.left) > rect.width / 2;   // recompute from the drop point (no class needed)
      hideInsertionLine();
      const data = evt.dataTransfer.getData('text/plain');
      if (data.startsWith('group:')) {
        // Group dropped onto a tab inside a tray: honour the before/after target the tray dragover computed
        // (so it matches the shown insertion line), falling back to "before this tab's group".
        const gid = data.slice(6);
        const before = _groupDropBefore === undefined ? tab.groupId : _groupDropBefore;
        _groupDropBefore = undefined;
        if (gid !== before) moveGroupBefore(gid, before);
        return;
      }
      const draggedId = data.replace(/^tab:/, '');
      if (draggedId === tab.id) return;
      const dragged = tabs.find(t => t.id === draggedId);
      if (!dragged) return;
      dragged.groupId = tab.groupId || null;   // a tab adopts the drop target's group (or ungroups)
      tabs.splice(tabs.findIndex(t => t.id === draggedId), 1);
      let toIdx = tabs.findIndex(t => t.id === tab.id);
      if (after) toIdx += 1;
      tabs.splice(toIdx, 0, dragged);
      reorderTabsByGroup();   // keep tabs in visual order
      render();
      suppressTabHover();     // don't leave the dropped tab wearing a stuck :hover tint
      saveTabs();
    });

    el.addEventListener('contextmenu', (e) => { e.preventDefault(); openTabGroupMenu(el, tab); });
    el.addEventListener('click', () => switchTab(tab.id));

    return el;
  };

  // A group header chip: collapse caret, optional icon, name, and (when collapsed) a count.
  const renderGroupChip = (group, count) => {
    const isUngrouped = group.id === UNGROUPED_ID;   // synthetic group: no menu / no drag / gray accent
    const collapsed = group.collapsed && count > 0;
    const chip = document.createElement('div');
    chip.className = 'df-tab-group' + (collapsed ? ' df-tab-group--collapsed' : '') + (count === 0 ? ' df-tab-group--empty' : '') + (isUngrouped ? ' df-tab-group--ungrouped' : '');
    chip.dataset.groupId = group.id;
    if (group.color) chip.style.setProperty('--group-accent', group.color);

    // Icon — always present; defaults to 'tabset' so a group never renders icon-less.
    const ic = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ic.setAttribute('class', 'df-tab-group__icon');
    ic.setAttribute('width', '12'); ic.setAttribute('height', '12');
    ic.innerHTML = `<use href="#${String(group.icon || 'tabset').replace(/[^a-zA-Z0-9_-]/g, '')}"></use>`;
    chip.appendChild(ic);

    const name = document.createElement('span');
    name.className = 'df-tab-group__name';
    name.textContent = group.name;
    name.title = group.name;
    chip.appendChild(name);

    // Right "lead" slot: the tab COUNT pill by default (always, collapsed or not), swapping to the ⋯
    // menu on hover — so the slot is never empty and the count keeps its badge style.
    const lead = document.createElement('div');
    lead.className = 'df-tab-group__lead';
    // Always show the count pill — an empty group reads as "0" rather than going badge-less.
    const countEl = document.createElement('span');
    countEl.className = 'df-tab-group__count';
    countEl.textContent = String(count);
    lead.appendChild(countEl);
    // Every chip gets the ⋯ options menu. The Ungrouped group routes to its slimmer menu (Collapse / Export /
    // Share only - no rename/colour/delete); real groups get the full menu.
    const menuBtn = document.createElement('button');
    menuBtn.className = 'df-tab-group__menu';
    menuBtn.title = 'Group options';
    menuBtn.setAttribute('aria-label', 'Group options');
    menuBtn.innerHTML = '<svg width="12" height="4" viewBox="0 0 12 4" fill="currentColor"><circle cx="2" cy="2" r="1.4"/><circle cx="6" cy="2" r="1.4"/><circle cx="10" cy="2" r="1.4"/></svg>';
    menuBtn.addEventListener('click', (e) => { e.stopPropagation(); isUngrouped ? openUngroupedMenu(menuBtn) : openGroupMenu(menuBtn, group); });
    lead.appendChild(menuBtn);
    chip.appendChild(lead);

    // Click toggles collapse (accordion). An EMPTY group can't be collapsed (nothing to hide).
    chip.title = count === 0 ? group.name : (collapsed ? 'Expand group' : 'Collapse group');
    chip.addEventListener('click', () => { if (count > 0) toggleGroupCollapsed(group.id); });

    // Both chips get a right-click menu (Ungrouped → its slimmer menu). Only REAL groups can be reordered/dragged.
    chip.addEventListener('contextmenu', (e) => { e.preventDefault(); isUngrouped ? openUngroupedMenu(chip) : openGroupMenu(chip, group); });
    if (!isUngrouped) {
      // Drag the chip to reorder groups (drops are handled by the surrounding tray).
      chip.draggable = true;
      chip.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', 'group:' + group.id);
        e.dataTransfer.effectAllowed = 'move';
        _dragKind = 'group';
        _dragGroupId = group.id;
        chip.classList.add('df-tab-group--dragging');
      });
      chip.addEventListener('dragend', () => {
        _dragKind = null; _dragGroupId = null; _groupDropBefore = undefined;
        chip.classList.remove('df-tab-group--dragging');
        hideInsertionLine();
        tabListEl.querySelectorAll('.df-tab-group-tray--drag-over').forEach(c => c.classList.remove('df-tab-group-tray--drag-over'));
      });
    }
    return chip;
  };

  // A group renders as a "tray" (chip + its tabs in tabs[] order) so it reads as one connected
  // unit with a soft accent bar; ungrouped tabs follow at the end.
  const wireTrayDrop = (tray, group) => {
    tray.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (_dragKind === 'group') {
        // Group reorder: show an insertion line at the LEFT (insert before this group) or RIGHT (after it = before
        // the next group) edge of the hovered tray. The Ungrouped tray is pinned last + can't be reordered, so it
        // never shows a target; nor does the dragged group's own tray.
        if (group.id === UNGROUPED_ID || group.id === _dragGroupId) { hideInsertionLine(); _groupDropBefore = undefined; return; }
        const r = tray.getBoundingClientRect();
        const after = e.clientX > r.left + r.width / 2;
        showInsertionLine(tray, after);
        if (after) {
          const idx = groups.findIndex(g => g.id === group.id);
          _groupDropBefore = (idx >= 0 && idx + 1 < groups.length) ? groups[idx + 1].id : null;   // null = end
        } else {
          _groupDropBefore = group.id;
        }
        return;
      }
      if (_dragKind !== 'tab') return;
      // If the pointer is over a child tab, that tab's handler owns the precise insertion line — don't
      // also light up the whole tray (the double-marker bug). Only a direct chip/tray hover = "drop into".
      if (e.target.closest && e.target.closest('.df-tab')) return;
      tray.classList.add('df-tab-group-tray--drag-over');
      hideInsertionLine();   // mutually exclusive with the precise insertion line
    });
    tray.addEventListener('dragleave', (e) => { if (!tray.contains(e.relatedTarget)) tray.classList.remove('df-tab-group-tray--drag-over'); });
    tray.addEventListener('drop', (e) => {
      e.preventDefault();
      tray.classList.remove('df-tab-group-tray--drag-over');
      hideInsertionLine();
      const data = e.dataTransfer.getData('text/plain');
      if (data.startsWith('group:')) {
        const gid = data.slice(6);
        if (group.id === UNGROUPED_ID) { _groupDropBefore = undefined; return; }   // can't reorder onto Ungrouped
        // Use the before/after target the dragover computed (null = move to the end); fall back to "before this".
        const before = _groupDropBefore === undefined ? group.id : _groupDropBefore;
        _groupDropBefore = undefined;
        if (gid !== before) moveGroupBefore(gid, before);
      }
      // Dropping a tab onto the Ungrouped tray removes it from its group (groupId → null); onto a real tray, joins it.
      else if (data.startsWith('tab:')) { setTabGroup(data.slice(4), group.id === UNGROUPED_ID ? null : group.id); suppressTabHover(); }   // a tab joins this group
    });
  };
  for (const group of groups) {
    const groupTabs = tabs.filter(t => t.groupId === group.id);
    const collapsed = group.collapsed && groupTabs.length > 0;   // an empty group is never collapsed
    const tray = document.createElement('div');
    tray.className = 'df-tab-group-tray' + (collapsed ? ' df-tab-group-tray--collapsed' : '');
    tray.dataset.groupId = group.id;
    if (group.color) tray.style.setProperty('--group-accent', group.color);
    tray.appendChild(renderGroupChip(group, groupTabs.length));
    if (collapsed) {
      // Collapsed: keep ONLY the active tab visible (the "lingering active tab") so you don't lose your place; it
      // hides too the moment you switch away. The `df-tab--lingering` class CONDENSES it (icon-only) so the group
      // visibly folds while the active tab stays clickable - it no longer reads as a full, un-collapsed tab.
      const active = groupTabs.find(t => t.id === tbctx.activeTabId);
      if (active) { const lt = renderTab(active); lt.classList.add('df-tab--lingering'); tray.appendChild(lt); }
    } else {
      for (const t of groupTabs) tray.appendChild(renderTab(t));
    }
    wireTrayDrop(tray, group);
    tabListEl.appendChild(tray);
  }
  // Ungrouped tabs: once at least one REAL group exists, wrap them in a collapsible gray "Ungrouped" tray (so
  // the user can fold them to focus on a group); otherwise render them bare as before.
  const ungroupedTabs = tabs.filter(t => !t.groupId);
  if (groups.length > 0 && ungroupedTabs.length > 0) {
    const ug = { id: UNGROUPED_ID, name: 'Ungrouped', icon: 'tabset', color: null, collapsed: tbctx.ungroupedCollapsed };
    const ugCollapsed = tbctx.ungroupedCollapsed && ungroupedTabs.length > 0;
    const tray = document.createElement('div');
    tray.className = 'df-tab-group-tray df-tab-group-tray--ungrouped' + (ugCollapsed ? ' df-tab-group-tray--collapsed' : '');
    tray.dataset.groupId = UNGROUPED_ID;
    tray.appendChild(renderGroupChip(ug, ungroupedTabs.length));
    // NOTE: ungrouped tabs deliberately keep NO `df-tab--grouped` marker (that means "in a NAMED group" —
    // delete-group/ungroup flows assert its absence). The tray's transparent-bg + gray hover come from the
    // `.df-tab-group-tray--ungrouped .df-tab` descendant CSS instead.
    const addUg = (t, lingering) => { const el = renderTab(t); if (lingering) el.classList.add('df-tab--lingering'); tray.appendChild(el); };
    if (ugCollapsed) {
      const active = ungroupedTabs.find(t => t.id === tbctx.activeTabId);
      if (active) addUg(active, true);   // keep the lingering active tab visible (condensed), like a real collapsed group
    } else {
      for (const t of ungroupedTabs) addUg(t);
    }
    wireTrayDrop(tray, ug);
    tabListEl.appendChild(tray);
  } else {
    for (const t of ungroupedTabs) tabListEl.appendChild(renderTab(t));
  }

  // Size tabs uniformly, set the « » buttons, THEN measure pins off the final layout. measurePins →
  // updatePins builds the rail and (last) calls updateActiveTabIndicator, so the bottom-bar gap lands
  // under the correct visible active element — no separate call needed here.
  sizeTabsUniform();
  updateScrollButtons();
  measurePins();
}

// ── Uniform tab widths ───────────────────────────────────────────────
// Tabs in a group tray and ungrouped tabs live in separate flex contexts, so flex alone sizes them
// differently. Compute ONE width for every tab from the available row space and apply it, so grouped
// and ungrouped tabs match. Squishes toward MIN as tabs are added; once there it overflows → scrolls.
const MIN_TAB_W = 120, MAX_TAB_W = 180;
function sizeTabsUniform() {
  if (!tabListEl) return;
  // Mobile keeps content-width tabs (its own CSS) — clear any desktop sizing.
  if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
    tabListEl.querySelectorAll('.df-tab').forEach(t => { t.style.width = ''; t.style.flex = ''; });
    return;
  }
  // A collapsed group's lingering active tab is CONDENSED to a fixed icon-only width, so it is EXCLUDED from the
  // uniform divide and counted as fixed overhead instead (else it would steal a full tab's width while showing
  // only an icon). Its width comes from CSS (.df-tab--lingering), so we clear any stale inline width.
  const LINGER_W = 38;
  let fixed = 0, tabCount = 0;
  for (const c of tabListEl.children) {
    if (c.classList.contains('df-tab-group-tray')) {
      const chip = c.querySelector('.df-tab-group');
      if (chip) fixed += chip.offsetWidth + 3;   // chip + its margin-right
      fixed += 3;                                  // tray padding-right
      tabCount += c.querySelectorAll('.df-tab:not(.df-tab--lingering)').length;
      fixed += c.querySelectorAll('.df-tab--lingering').length * (LINGER_W + 2);
    } else if (c.classList.contains('df-tab')) {
      tabCount += 1;
    }
  }
  tabListEl.querySelectorAll('.df-tab--lingering').forEach(t => { t.style.flex = ''; t.style.width = ''; });
  if (tabCount === 0) return;
  fixed += 2 * Math.max(0, tabListEl.children.length - 1);   // inter-item gaps (list gap)
  const w = Math.max(MIN_TAB_W, Math.min(MAX_TAB_W, Math.floor((tabListEl.clientWidth - fixed) / tabCount)));
  tabListEl.querySelectorAll('.df-tab:not(.df-tab--lingering)').forEach(t => { t.style.flex = '0 0 auto'; t.style.width = `${w}px`; });
}

// ── Pinned rail (group pills + active tab) ───────────────────────────
// Earlier versions transform-pinned the real chips inside the scroll container, which jittered (the
// transform lags one frame behind native scroll) and let tabs flow visibly behind the translucent
// pills. Instead, the real chips/tabs scroll NATIVELY (no transform → no jitter), and a separate,
// NON-scrolling "rail" overlay at each edge shows opaque PROXIES of whatever's scrolled out of view:
//   • left rail  — every group whose pill has scrolled off the left, STACKED, + the active tab if it's
//                  scrolled off the left (so the active diagram never fully hides).
//   • right rail — the active tab if it's scrolled off the RIGHT edge.
// The rail's opaque background (var(--bg-canvas)) means scrolling tabs never show through (uniform
// backing), and because the rail never moves with scroll there's nothing to jitter. `_pinGeom` caches
// each pinnable element's content-space left+width (re-measured on render/resize); updatePins() runs
// cheaply on scroll, rebuilding the proxy DOM only when the pinned SET changes.
let _pinGeom = null;
let _pinSig = '';

function measurePins() {
  if (!tabListEl) { _pinGeom = null; return; }
  const listRect = tabListEl.getBoundingClientRect();
  const s = tabListEl.scrollLeft;
  const contentLeft = (r) => Math.round(r.left - listRect.left + s);   // scroll-independent (content space)
  const contentRight = (r) => Math.round(r.right - listRect.left + s);
  const groups = [];
  // The synthetic Ungrouped tray never pins (it's the rightmost utility fold, and getGroup() can't resolve
  // its id) — exclude it so it doesn't push a phantom proxy entry that skews the rail width math.
  for (const chip of tabListEl.querySelectorAll('.df-tab-group:not(.df-tab-group--ungrouped)')) {
    const r = chip.getBoundingClientRect();
    const tray = chip.closest('.df-tab-group-tray');
    // contentRight = the right edge of the group's whole tray (chip + all its tabs): used to tell whether
    // the group's tabs still extend PAST the pinned rail (so the rail's last pill should blend into them).
    groups.push({ id: chip.dataset.groupId, base: contentLeft(r), w: Math.round(r.width), contentRight: contentRight((tray || chip).getBoundingClientRect()) });
  }
  let active = null;
  const activeEl = tabListEl.querySelector('.df-tab--active');
  if (activeEl) {
    const r = activeEl.getBoundingClientRect();
    active = { base: contentLeft(r), w: Math.round(r.width), groupId: tabs.find(t => t.id === tbctx.activeTabId)?.groupId || null };
  }
  _pinGeom = { groups, active };
  _pinSig = '';   // force a rebuild against the new geometry
  updatePins();
}

// Scroll the list so a pinned element's natural position is back in view (a little inset from the left).
function revealInList(targetScroll) {
  tabListEl?.scrollTo({ left: Math.max(0, Math.round(targetScroll)), behavior: 'smooth' });
}

function buildGroupPin(g, revealTo) {
  const group = getGroup(g.id);
  if (!group) return null;
  const count = tabs.filter(t => t.groupId === group.id).length;
  const chip = document.createElement('div');
  chip.className = 'df-tab-group df-tab-group--pinned';
  chip.dataset.groupId = group.id;
  if (group.color) chip.style.setProperty('--group-accent', group.color);
  const ic = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ic.setAttribute('class', 'df-tab-group__icon');
  ic.setAttribute('width', '12'); ic.setAttribute('height', '12');
  ic.innerHTML = `<use href="#${String(group.icon || 'tabset').replace(/[^a-zA-Z0-9_-]/g, '')}"></use>`;
  chip.appendChild(ic);
  const name = document.createElement('span');
  name.className = 'df-tab-group__name';
  name.textContent = group.name; name.title = group.name;
  chip.appendChild(name);
  if (count > 0) {
    const lead = document.createElement('div');
    lead.className = 'df-tab-group__lead';
    const c = document.createElement('span');
    c.className = 'df-tab-group__count'; c.textContent = String(count);
    lead.appendChild(c); chip.appendChild(lead);
  }
  chip.title = group.name;
  chip.addEventListener('click', () => revealInList(revealTo));   // click a pinned header → jump back to its group
  // Right-click a PINNED group header → the SAME menu as the unpinned chip (a pinned group must behave identically).
  chip.addEventListener('contextmenu', (e) => { e.preventDefault(); group.id === UNGROUPED_ID ? openUngroupedMenu(chip) : openGroupMenu(chip, group); });
  return chip;
}

function buildActivePin(a, revealTo) {
  const tab = tabs.find(t => t.id === tbctx.activeTabId);
  if (!tab) return null;
  const el = document.createElement('div');
  el.className = 'df-tab df-tab--active df-pin-tab'
    + (tab.dirty ? ' df-tab--dirty' : '')   // mirror the dirty dot so a dirty active tab doesn't shift on pin
    + (tab.groupId ? ' df-tab--grouped' : '');
  el.style.width = `${a.w}px`;   // match the real (uniform-shrunk) active tab's width — item 3
  // Set the group accent so the active-tab strip is the GROUP colour, matching the real grouped active
  // tab (which inherits it from its tray). A colourless group falls back to --color-primary via the
  // .df-pin-tab--grouped CSS default — WITHOUT this the proxy lost its accent and went generic grey.
  if (tab.groupId) { const g = getGroup(tab.groupId); if (g?.color) el.style.setProperty('--group-accent', g.color); }
  const ti = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ti.setAttribute('class', 'df-tab__type-icon');
  ti.setAttribute('width', '12'); ti.setAttribute('height', '12'); ti.setAttribute('viewBox', '0 0 16 16'); ti.setAttribute('fill', 'currentColor');
  ti.innerHTML = diagramTypeIconMarkup(tab.diagramType);
  el.appendChild(ti);
  const dot = document.createElement('span');   // dirty dot — hidden by CSS unless .df-tab--dirty (above)
  dot.className = 'df-tab__dirty';
  dot.setAttribute('aria-hidden', 'true');
  el.appendChild(dot);
  const label = document.createElement('span');
  label.className = 'df-tab__label';
  label.textContent = tab.name;
  el.appendChild(label);
  // NOTE: the pin proxy DELIBERATELY omits the share glyph (buildShareGlyph). The proxy is always in the DOM, so
  // a glyph here would render TWICE for a shared active tab (once on the real tab, once on the pin) and double the
  // count the R7 E2E asserts. The real tab carries the glyph; the pin stays glyph-free on purpose.
  // Mirror the real active tab's × so the pin doesn't visually "jump" (label reflow) and stays closeable.
  // stopPropagation keeps the × from also firing the reveal-in-list body click.
  const close = document.createElement('button');
  close.className = 'df-tab__close';
  close.title = 'Close tab';
  close.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/></svg>';
  close.addEventListener('click', (evt) => { evt.stopPropagation(); closeTab(tab.id); });
  el.appendChild(close);
  el.title = tab.name;
  el.addEventListener('click', () => revealInList(revealTo));
  // Right-click the ACTIVE-tab pin proxy → the SAME per-diagram menu as the real tab (Clone / Export / Share / …).
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); openTabGroupMenu(el, tab); });
  return el;
}

// A pinned group renders as a mini-TRAY (soft accent bar) holding the chip — and, when the active tab
// belongs to this group, the active proxy right after it, touching on the shared bar — so a pinned group
// looks identical to an unpinned one (item 2). Reuses the real tray/chip/active CSS.
function buildPinnedTray(g, activeGeom, groupRevealTo, activeRevealTo) {
  const group = getGroup(g.id);
  if (!group) return null;
  const tray = document.createElement('div');
  tray.className = 'df-tab-group-tray df-tab-group-tray--pinned';
  tray.dataset.groupId = group.id;
  if (group.color) tray.style.setProperty('--group-accent', group.color);
  const chip = buildGroupPin(g, groupRevealTo);
  if (chip) tray.appendChild(chip);
  if (activeGeom) { const ae = buildActivePin(activeGeom, activeRevealTo); if (ae) tray.appendChild(ae); }
  return tray;
}

function updatePins() {
  const leftRail = document.getElementById('tab-pinrail-left');
  const rightRail = document.getElementById('tab-pinrail-right');
  if (!tabListEl || !leftRail || !rightRail) return;
  if (!_pinGeom) { leftRail.hidden = true; rightRail.hidden = true; return; }
  const listRect = tabListEl.getBoundingClientRect();
  const barRect = tabListEl.parentElement.getBoundingClientRect();
  const listLeftInBar = listRect.left - barRect.left;
  const s = tabListEl.scrollLeft;
  const clientW = tabListEl.clientWidth;

  // Group pills scrolled off the left, stacked. A group pins as soon as its LEFT edge touches the rail's
  // current right edge (item 1). leftW (the rail's right edge) must reflect the FULL mini-tray: chip +
  // (when the active tab rides in this group) the interleaved active proxy + tray padding + rail gap —
  // else the next group slides ~a-tab-width UNDER the rail before pinning.
  const a = _pinGeom.active;
  const TRAY_PAD = 6, GAP = 2;   // chip margin-right (3) + tray padding-right (3); rail gap between trays
  const pinned = [];             // { g, hasActive }
  let leftW = 0, activeLeft = false;
  for (const g of _pinGeom.groups) {
    if (g.base >= s + leftW) continue;   // left edge not yet at the rail (groups after are further right)
    let trayW = g.w + TRAY_PAD, hasActive = false;
    if (a && a.groupId === g.id && a.base < s + leftW + g.w + 3) { hasActive = true; activeLeft = true; trayW += a.w; }
    pinned.push({ g, hasActive });
    leftW += trayW + GAP;
  }
  // Ungrouped active (or active whose group didn't pin): pin to the LEFT once its left edge touches.
  const activeStandalone = !!a && !activeLeft && (a.groupId === null || !pinned.some(p => p.g.id === a.groupId));
  if (activeStandalone && a.base <= s + leftW) { activeLeft = true; leftW += a.w + GAP; }
  let activeRight = false;
  if (a && !activeLeft && a.base + a.w >= s + clientW) activeRight = true;   // off the right edge

  const sig = pinned.map(p => p.g.id + (p.hasActive ? '*' : '')).join(',') + '|' + (activeLeft && activeStandalone ? 'AS' : '') + '|' + (activeRight ? 'AR' : '');
  if (sig !== _pinSig) {
    _pinSig = sig;
    const append = (rail, el) => { if (el) rail.appendChild(el); };
    // `cum` tracks the rail content to the LEFT of the item being placed; a proxy's "reveal" scroll
    // brings the real element just PAST that width (so a click never lands it back behind the rail — C).
    leftRail.innerHTML = '';
    let cum = 0;
    for (const { g, hasActive } of pinned) {
      const activeReveal = hasActive ? a.base - (cum + g.w + 3) - 8 : 0;
      append(leftRail, buildPinnedTray(g, hasActive ? a : null, g.base - cum - 8, activeReveal));
      cum += g.w + TRAY_PAD + (hasActive ? a.w : 0) + GAP;
    }
    if (activeStandalone && activeLeft) append(leftRail, buildActivePin(a, a.base - cum - 8));
    rightRail.innerHTML = '';
    if (activeRight && a) append(rightRail, buildActivePin(a, a.base + a.w - clientW + 8));
  }
  // Position the rails over the list edges (live — the list's left shifts when « shows/hides).
  leftRail.hidden = leftW === 0;
  leftRail.style.left = `${Math.round(listLeftInBar)}px`;
  rightRail.hidden = !activeRight;
  if (activeRight) {
    const railLeft = listLeftInBar + listRect.width - a.w;
    rightRail.style.left = `${Math.round(railLeft)}px`;
    // Extend the opaque rail PAST the list's right clip edge so it masks the 1-2px sliver of the clipped real
    // tab WebKit/Safari paints at that boundary (worse at fractional zoom — the "tab peeking next to the »"
    // bug). Reach the » arrow's left edge when it's shown (it's opaque + above the rail, so it caps the
    // extension); else a small fixed overhang into the bar gutter. The proxy stays flex-start at railLeft, so
    // its own geometry — and the bottom-bar gap under it — are unchanged.
    const rb = document.getElementById('btn-scroll-tabs-right');
    let rightEdge = listLeftInBar + listRect.width + 4;
    if (rb && !rb.hidden) rightEdge = rb.getBoundingClientRect().left - barRect.left;
    rightRail.style.width = `${Math.max(Math.round(a.w), Math.round(rightEdge - railLeft))}px`;
  }

  // Items 2/3: the LAST pinned GROUP blends into the scrolled tabs (flat right, no gap) when its OWN
  // tabs still extend past the rail; otherwise it caps (rounded right + a slight gap). Re-evaluated every
  // scroll — this flips as you scroll WITHIN vs PAST a group with no change to the pinned set.
  const lastGroup = (pinned.length && !(activeLeft && activeStandalone)) ? pinned[pinned.length - 1].g : null;
  leftRail.querySelectorAll('.df-tab-group-tray--pinned').forEach(t => t.classList.remove('df-tab-group-tray--blend-right', 'df-tab-group-tray--cap-right'));
  if (lastGroup) {
    const lastTray = leftRail.querySelector(`.df-tab-group-tray--pinned[data-group-id="${lastGroup.id}"]`);
    if (lastTray) {
      // Blend when the group's OWN tabs extend past the rail (visible right after the pinned pill); else
      // cap. Compare the group's content-right edge to the pill's MEASURED right edge (exact, vs the
      // approximate leftW) so the call doesn't misfire by a tray's padding.
      const trayRightInList = lastTray.getBoundingClientRect().right - listRect.left;
      lastTray.classList.add((lastGroup.contentRight - s) > trayRightInList + 2 ? 'df-tab-group-tray--blend-right' : 'df-tab-group-tray--cap-right');
    }
  }
  updateActiveTabIndicator();   // keep the bottom-bar gap under the VISIBLE active element (real or pinned proxy)
}

// ── Scroll affordance ────────────────────────────────────────────────
// The « / » buttons replace the old edge fade-mask (which dimmed the pinned pills) and give a
// click/touch/keyboard scroll target. Each shows ONLY when there's clipped content in its direction
// (`hidden` → display:none otherwise) — no reserved slot, so an empty row has no dead gutter on the
// sides. The brief reflow when « first appears is preferred over a permanent left gap.
function updateScrollButtons() {
  if (!tabListEl) return;
  const { scrollLeft, scrollWidth, clientWidth } = tabListEl;
  const overflows = scrollWidth > clientWidth + 1;
  const leftBtn = document.getElementById('btn-scroll-tabs-left');
  const rightBtn = document.getElementById('btn-scroll-tabs-right');
  if (leftBtn) leftBtn.hidden = !(overflows && scrollLeft > 0);
  if (rightBtn) rightBtn.hidden = !(overflows && scrollLeft + clientWidth < scrollWidth - 1);
}

function updateActiveTabIndicator() {
  const tabBar = document.querySelector('.df-tabs');
  if (!tabBar) return;

  // Remove old line segments
  tabBar.querySelectorAll('.df-tab-line').forEach(el => el.remove());

  // The gap goes under the VISIBLE active element: its pinned-rail proxy if the active tab is pinned
  // (the real one is then scrolled off-screen), otherwise the real active tab.
  const activeEl = tabBar.querySelector('.df-pin-tab') || tabBar.querySelector('.df-tab--active');
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

function startGroupRename(chipEl, nameEl, group) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'df-tab-group__rename-input';
  input.value = group.name;
  input.style.cssText = `width:${Math.max(60, nameEl.offsetWidth + 8)}px;font-size:var(--font-size-sm);font-family:var(--font-family);font-weight:600;border:1px solid var(--color-primary);border-radius:3px;background:var(--bg-app);color:var(--text-primary);padding:0 4px;outline:none;height:18px;`;
  const finish = () => updateGroup(group.id, { name: input.value.trim() || group.name });
  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter') { evt.preventDefault(); input.blur(); }
    if (evt.key === 'Escape') { input.value = group.name; input.blur(); }
    evt.stopPropagation();
  });
  nameEl.replaceWith(input);
  input.focus();
  input.select();
}

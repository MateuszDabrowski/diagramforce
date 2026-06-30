// Tabs — multi-diagram tab management
// Each tab holds its own graph JSON, viewport, and undo/redo history.

import { APP_VERSION, classifyVersionDiff, normalizeDiagramType, isQuotaError, getStorageFootprint, STORAGE_WARNING_BYTES, evictRedundantArchives, compactGraphForSave } from './persistence.js?v=1.19.0.49';
import { escHtml, formatRelativeTime, countDiagramShapes, storageRowHtml, groupSelectHtml, tabInGroup, formatBytes, gaugeLevel, refreshSplitTableCounts, sharePillHtml, driveChipsHtml, isViewForkTab } from './util.js?v=1.19.0.49';
import { tabShareRole, shareGlyphKind, archiveDedupName, serializeDriveFields, forkName } from './persistence/drive-sync-logic.js?v=1.19.0.49';
import { showError, showToast, buildModal, confirmModal } from './feedback.js?v=1.19.0.49';
import { createElementFromComponent, createGanttTimelineSeed, SVG } from './components.js?v=1.19.0.49';
import { applyGanttGeometry, layoutTimelineTasks } from './canvas/gantt-layout.js?v=1.19.0.49';
import { getPalette } from './brand-palette.js?v=1.19.0.49';
import { getAllIcons } from './icons.js?v=1.19.0.49';
import { getOfficialTemplates, loadOfficialTemplate, renderOfficialThumbnail } from './official-templates.js?v=1.19.0.49';

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

const tabs = [];
const groups = [];          // [{ id, name, icon|null, color|null, collapsed }] — tab groups (v1.16.0)
// Synthetic "Ungrouped" tab-bar group (v1.17.0): when ≥1 real group exists, the groupless tabs render inside a
// collapsible gray "Ungrouped" tray so the user can fold them away to focus on a group. It is NOT a real group
// (never in `groups[]`), so its only state is this collapse flag (persisted in the session blob).
const UNGROUPED_ID = '__ungrouped__';
let ungroupedCollapsed = false;
let activeTabId = null;
let nextId = 1;
let nextGroupId = 1;
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
export const DIAGRAM_TYPES = {
  architecture: { label: 'Architecture Diagram', short: 'Architecture' },
  process:      { label: 'Process Diagram',      short: 'Process' },
  sequence:     { label: 'Sequence Diagram',      short: 'Sequence' },
  datamodel:    { label: 'Data Model Diagram',   short: 'Data Model' },
  datamapping:  { label: 'Data Mapping Diagram', short: 'Data Mapping' },
  gantt:        { label: 'Gantt Chart',           short: 'Gantt' },
  org:          { label: 'Org Chart',             short: 'Org Chart' },
};

/** Inline SVG (viewBox 0 0 16 16, currentColor) for a diagram type's glyph — used both on each tab
 *  and in the "+ Diagram" right-click type menu, so they stay identical. */
function diagramTypeIconMarkup(type) {
  switch (type) {
    case 'process':     return '<circle cx="3" cy="8" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="7" y="5.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="3" cy="8" r="1" fill="currentColor"/><line x1="5.5" y1="8" x2="7" y2="8" stroke="currentColor" stroke-width="1.5"/>';
    case 'sequence':    return '<rect x="1" y="1" width="5" height="3" rx="0.5" fill="currentColor"/><rect x="10" y="1" width="5" height="3" rx="0.5" fill="currentColor"/><line x1="3.5" y1="4" x2="3.5" y2="15" stroke="currentColor" stroke-width="0.8" stroke-dasharray="1.5 1"/><line x1="12.5" y1="4" x2="12.5" y2="15" stroke="currentColor" stroke-width="0.8" stroke-dasharray="1.5 1"/><line x1="3.5" y1="8" x2="12.5" y2="8" stroke="currentColor" stroke-width="1"/><polygon points="12.5,8 10.5,7 10.5,9" fill="currentColor"/><line x1="12.5" y1="12" x2="3.5" y2="12" stroke="currentColor" stroke-width="0.8" stroke-dasharray="1.5 1"/><polygon points="3.5,12 5.5,11 5.5,13" fill="currentColor"/>';
    case 'datamodel':   return '<rect x="1" y="1" width="6" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="1" width="6" height="3" rx="1" fill="currentColor"/><rect x="9" y="7" width="6" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="7" width="6" height="3" rx="1" fill="currentColor"/><path d="M7 5L9 11" stroke="currentColor" stroke-width="1.2" fill="none"/>';
    case 'datamapping': return '<rect x="0.5" y="2" width="5" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="0.5" y="2" width="5" height="3" rx="1" fill="currentColor"/><rect x="10.5" y="2" width="5" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="10.5" y="2" width="5" height="3" rx="1" fill="currentColor"/><path d="M5.5 8 L10 8 M8.5 6.5 L10 8 L8.5 9.5" fill="none" stroke="currentColor" stroke-width="1"/><path d="M5.5 11 L10 11" stroke="currentColor" stroke-width="1" opacity="0.55"/>';
    case 'gantt':       return '<rect x="1" y="2" width="8" height="3" rx="1" fill="currentColor"/><rect x="4" y="7" width="9" height="3" rx="1" fill="currentColor" opacity="0.7"/><rect x="7" y="12" width="6" height="3" rx="1" fill="currentColor" opacity="0.5"/>';
    case 'org':         return '<rect x="5" y="1" width="6" height="4" rx="1" fill="currentColor"/><rect x="0.5" y="10" width="6" height="4" rx="1" fill="currentColor" opacity="0.7"/><rect x="9.5" y="10" width="6" height="4" rx="1" fill="currentColor" opacity="0.7"/><path d="M8 5v2H3.5V10M8 7h4.5V10" stroke="currentColor" stroke-width="1" fill="none"/>';
    // architecture (+ the unknown-type fallback): a merge-FLOW glyph - two components on the left feeding one on
    // the right (systems + integrations), echoing the architecture empty-state. Distinct from the org chart's
    // vertical 1-over-2 hierarchy.
    default:            return '<rect x="0.5" y="1.5" width="5.5" height="4" rx="1" fill="currentColor"/><rect x="0.5" y="10.5" width="5.5" height="4" rx="1" fill="currentColor"/><rect x="10" y="6" width="5.5" height="4" rx="1" fill="currentColor"/><path d="M6 3.5 H8 V8 H10 M6 12.5 H8 V8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>';
  }
}

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
    const tab = tabs.find(t => t.id === activeTabId);
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

function showNewDiagramModal(targetGroupId = null) {
  // Remove any existing modal
  document.querySelector('.df-new-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'df-new-modal';
  overlay.innerHTML = `
    <div class="df-new-modal__backdrop"></div>
    <div class="df-new-modal__dialog">
      <h2 class="df-new-modal__title">New Diagram</h2>
      <div class="df-new-modal__tabs" role="tablist">
        <button class="df-new-modal__tab is-active" data-tab="create" role="tab" aria-selected="true">Create</button>
        <button class="df-new-modal__tab" data-tab="open" role="tab" aria-selected="false">Load</button>
        <button class="df-new-modal__tab" data-tab="templates" role="tab" aria-selected="false">Templates</button>
      </div>
      <div class="df-new-modal__panels">
      <div class="df-new-modal__panel" data-tab="create">
      <div class="df-new-modal__grid">
        <button class="df-new-modal__card" data-type="architecture">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <rect x="2" y="5" width="22" height="14" rx="3" fill="var(--color-primary)" opacity="0.85"/>
            <rect x="2" y="29" width="22" height="14" rx="3" fill="var(--color-primary)" opacity="0.85"/>
            <rect x="40" y="17" width="22" height="14" rx="3" fill="var(--color-primary)" opacity="0.85"/>
            <path d="M24 12 H32 V24 H40 M24 36 H32 V24" fill="none" stroke="var(--color-primary)" stroke-width="2.4" stroke-linejoin="round"/>
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
      <div class="df-new-modal__panel" data-tab="open" hidden>
      <div class="df-new-modal__grid df-new-modal__grid--open">
        <button class="df-new-modal__card" data-action="load">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <!-- Window body extended ~+10px at the bottom (height 30 → 37) so the browser glyph is less squat. -->
            <rect x="6" y="9" width="52" height="37" rx="4" fill="none" stroke="var(--color-primary)" stroke-width="2.5"/>
            <path d="M6 20 H58" stroke="var(--color-primary)" stroke-width="2"/>
            <circle cx="13" cy="14.5" r="1.7" fill="var(--color-primary)"/>
            <circle cx="19" cy="14.5" r="1.7" fill="var(--color-primary)"/>
            <circle cx="25" cy="14.5" r="1.7" fill="var(--color-primary)"/>
            <rect x="32" y="12" width="20" height="5" rx="2.5" fill="var(--color-primary)" opacity="0.5"/>
          </svg>
          <span class="df-new-modal__card-title">Browser Storage</span>
          <span class="df-new-modal__card-desc">Open a diagram you saved in this browser.</span>
        </button>
        <button class="df-new-modal__card" data-action="import-json">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <path d="M18 4h20l10 10v30a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="none" stroke="var(--color-primary)" stroke-width="2.5"/>
            <path d="M38 4v10h10" fill="none" stroke="var(--color-primary)" stroke-width="2.5"/>
            <text x="32" y="38" text-anchor="middle" font-size="11" font-family="var(--font-family)" fill="var(--color-primary)" opacity="0.9">{ }</text>
          </svg>
          <span class="df-new-modal__card-title">JSON or DGF File</span>
          <span class="df-new-modal__card-desc">Open a Diagramforce .dgf or .json file from your computer.</span>
        </button>
        <button class="df-new-modal__card df-new-modal__card--paste" data-action="paste">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <rect x="15" y="6" width="34" height="40" rx="4" fill="none" stroke="var(--color-primary)" stroke-width="2.5"/>
            <rect x="24" y="3" width="16" height="8" rx="2.5" fill="var(--color-primary)" opacity="0.85"/>
            <line x1="22" y1="22" x2="42" y2="22" stroke="var(--text-muted)" stroke-width="2"/>
            <line x1="22" y1="30" x2="42" y2="30" stroke="var(--text-muted)" stroke-width="2"/>
            <line x1="22" y1="38" x2="34" y2="38" stroke="var(--text-muted)" stroke-width="2"/>
          </svg>
          <span class="df-new-modal__card-title">Paste</span>
          <span class="df-new-modal__card-desc">Paste Diagramforce JSON or Mermaid code - the format is detected automatically.</span>
        </button>
      </div>
      </div>
      <div class="df-new-modal__panel" data-tab="templates" hidden>
      <div class="df-new-modal__grid df-new-modal__grid--templates"></div>
      </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Cross-device restore: when Drive is available on this origin, append a card that opens
  // "Your Drive diagrams" so a fresh device can pull the user's masters (signs in on click if needed).
  if (persistenceModule.isDriveConfigured?.()) {
    const card = document.createElement('button');
    card.className = 'df-new-modal__card df-new-modal__card--drive';
    card.dataset.action = 'drive';
    card.innerHTML = `
      <svg class="df-new-modal__icon" viewBox="0 0 48 48" aria-hidden="true"><use href="#icon-gdrive"></use></svg>
      <span class="df-new-modal__card-title">Google Drive</span>
      <span class="df-new-modal__card-desc">Open a diagram you saved to your Google Drive, on any device.</span>`;
    // Insert as the 2nd card (right after Browser Storage): row 1 = Browser / Drive / File, row 2 = File + Paste.
    const openGrid = overlay.querySelector('.df-new-modal__grid--open');
    openGrid?.insertBefore(card, openGrid.children[1] || null);
  }

  // Tab switcher: "Create" (diagram types) vs "Open" (existing diagrams from Browser / Drive / File / Paste).
  const showPanel = (which) => {
    overlay.querySelectorAll('.df-new-modal__tab').forEach((t) => {
      const on = t.dataset.tab === which;
      t.classList.toggle('is-active', on); t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    overlay.querySelectorAll('.df-new-modal__panel').forEach((p) => { p.hidden = p.dataset.tab !== which; });
  };
  overlay.querySelectorAll('.df-new-modal__tab').forEach((t) => t.addEventListener('click', () => showPanel(t.dataset.tab)));

  // Card clicks — a "Create" card makes that diagram type (in the target group, if any); an "Open" card
  // routes to the matching opener (all of which open the result as a new tab).
  const OPEN_ACTIONS = {
    paste: () => persistenceModule.openPasteImport?.(),
    'import-json': () => persistenceModule.importJSON(),
    load: () => persistenceModule.openLoadModal?.(),
    drive: () => persistenceModule.openDriveLibrary?.(),
  };
  overlay.querySelectorAll('.df-new-modal__card').forEach(card => {
    card.addEventListener('click', () => {
      overlay.remove();
      const action = card.dataset.action;
      if (action && OPEN_ACTIONS[action]) { OPEN_ACTIONS[action](); return; }
      createDiagramOfType(card.dataset.type, targetGroupId);
    });
  });

  // ── Templates tab — official, curated starting points (official-templates.js). Built AFTER the
  // generic card wiring above so these cards get ONLY the open-as-new-tab handler below (not the
  // create-blank handler, which would fire createDiagramOfType(undefined) on a card with no type). ──
  const tmplMetas = getOfficialTemplates();
  const tmplGrid = overlay.querySelector('.df-new-modal__grid--templates');
  if (!tmplMetas.length) {
    // No official templates → drop the tab + panel so an empty "Templates" view never shows.
    overlay.querySelector('.df-new-modal__tab[data-tab="templates"]')?.remove();
    overlay.querySelector('.df-new-modal__panel[data-tab="templates"]')?.remove();
  } else if (tmplGrid) {
    const typeShort = (t) => DIAGRAM_TYPES[normalizeDiagramType(t)]?.short || 'Diagram';
    tmplMetas.forEach((meta) => {
      const card = document.createElement('button');
      card.className = 'df-new-modal__card df-new-modal__card--template';
      card.dataset.templateId = meta.id;
      const thumb = document.createElement('div');
      thumb.className = 'df-new-modal__thumb';
      thumb.innerHTML = '<span class="df-new-modal__thumb-loading" aria-hidden="true"></span>';
      const badge = document.createElement('span');
      badge.className = 'df-new-modal__card-badge';
      badge.textContent = typeShort(meta.diagramType);
      const title = document.createElement('span');
      title.className = 'df-new-modal__card-title';
      title.textContent = meta.name;
      const desc = document.createElement('span');
      desc.className = 'df-new-modal__card-desc';
      desc.textContent = meta.description || '';
      card.append(thumb, badge, title, desc);
      tmplGrid.appendChild(card);

      // Lazy thumbnail: fetch the cells (same-origin) + render a mini-paper. Best-effort - on
      // failure the placeholder stays (the card still opens via the cached/fresh fetch on click).
      renderOfficialThumbnail(meta.id).then((el) => {
        if (el && card.isConnected) { thumb.innerHTML = ''; thumb.appendChild(el); }
      }).catch(() => { /* keep the placeholder */ });

      // Open → a fresh tab seeded with the template (you edit your copy; the official file is untouched).
      card.addEventListener('click', async () => {
        if (card.dataset.busy) return;            // guard a double-tap during the fetch
        card.dataset.busy = '1';
        const loaded = await loadOfficialTemplate(meta.id);
        if (!loaded || !loaded.cells.length) {
          showError('Could not open this template. Check your connection and try again.');
          delete card.dataset.busy;
          return;
        }
        overlay.remove();
        // Deep-copy the cached cells so a repeat open (or fromJSON's reads) never mutates the cache.
        const cells = JSON.parse(JSON.stringify(loaded.cells));
        const id = importDiagramAsTab(meta.name, loaded.diagramType, { cells }, loaded.viewport, loaded.mappingMode, { fit: true });
        if (targetGroupId && getGroup(targetGroupId)) setTabGroup(id, targetGroupId);
      });
    });
  }

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

// A collision-safe browser-archive name: "Name YYYY-MM-DD", then "Name 2 YYYY-MM-DD" … so two different
// diagrams never overwrite each other's archive (the no-clobber rule from the Save Manager review).
function uniqueArchiveName(base, existing) {
  const d = new Date();
  const suffix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

function showCloseConfirmModal(tabId, tabName) {
  document.querySelector('.df-close-confirm-modal')?.remove();
  const tab = tabs.find(t => t.id === tabId);
  const hasDrive = !!tab?.driveFileId;
  const hasArchive = !!tab?.browserSaveName;
  const hasSavedCopy = hasDrive || hasArchive;
  // Where the durable copy lives — used both in the body copy and the Delete tooltip so the user knows exactly
  // what "Delete diagram" removes.
  const savedWhere = hasDrive && hasArchive ? 'Google Drive and Browser Storage'
    : hasDrive ? 'Google Drive' : 'Browser Storage';

  // Two distinct "don't keep the edits" outcomes once a saved copy exists (C6 fuller):
  //   • Discard changes — close, drop the unsaved edits, but KEEP the saved copy untouched.
  //   • Delete diagram  — remove the saved copy (Drive trash + browser archive) as well, then close.
  // For an unsaved-only diagram there's nothing saved to keep or delete, so it collapses to a single Discard.
  const bodyHtml = hasSavedCopy
    ? `<p style="margin:0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">
        <strong style="color:var(--text-primary)">${escHtml(tabName)}</strong> has unsaved changes.</p>
       <p style="margin:8px 0 0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">
        <strong style="color:var(--text-primary)">Discard</strong> drops these changes and keeps the last saved version in
        <strong style="color:var(--text-primary)">${savedWhere}</strong>.<br>
        <strong style="color:var(--text-primary)">Delete</strong> removes that saved copy too.</p>`
    : `<p style="margin:0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">
        <strong style="color:var(--text-primary)">${escHtml(tabName)}</strong> has unsaved changes that will be lost.</p>`;

  // Button order (saved-copy case): Cancel (far left) · Delete diagram · Discard and Close · Save and Close.
  // Discard sits between the destructive Delete and the safe Save so the escalation reads left→right.
  const footerHtml = hasSavedCopy
    ? `<button class="df-close-confirm__btn df-close-confirm__btn--cancel" style="margin-right:auto">Cancel</button>
      <button class="df-close-confirm__btn df-close-confirm__btn--delete" title="Drop the changes AND remove the saved copy from ${savedWhere}, then close">Delete</button>
      <button class="df-close-confirm__btn df-close-confirm__btn--discard" title="Drop the unsaved changes but keep the last saved version">Discard</button>
      <button class="df-close-confirm__btn df-close-confirm__btn--save">Save</button>`
    : `<button class="df-close-confirm__btn df-close-confirm__btn--cancel" style="margin-right:auto">Cancel</button>
      <button class="df-close-confirm__btn df-close-confirm__btn--discard" title="Drop the unsaved changes and close">Discard</button>
      <button class="df-close-confirm__btn df-close-confirm__btn--save">Save</button>`;

  const { footer, close } = buildModal({
    title: 'Unsaved Changes',
    className: 'df-close-confirm-modal',
    zIndex: 3000,
    // Wider when the 4th (Delete diagram) button is present so the row never cramps; the footer also wraps /
    // stacks on phones (css/modals.css).
    width: hasSavedCopy ? '560px' : '400px',
    showClose: false, // decision dialog — dismiss via Cancel / backdrop / Escape
    bodyStyle: 'padding:var(--spacing-md) var(--spacing-lg)',
    bodyHtml,
    footerHtml,
  });

  footer.querySelector('.df-close-confirm__btn--cancel').addEventListener('click', close);

  // Discard changes — drop the in-memory edits and close, KEEPING the saved copy (Drive file + browser archive
  // untouched). archive:false so the edited state is NOT written over the existing archive. For an unsaved-only
  // diagram this simply drops the work (there was no saved copy).
  footer.querySelector('.df-close-confirm__btn--discard').addEventListener('click', () => {
    close();
    const t = tabs.find(x => x.id === tabId);
    if (t) t.dirty = false;   // already confirmed → skip the dirty re-check on close
    doCloseTab(tabId, { archive: false });
  });

  // Delete diagram — remove the saved copy (Drive trash + browser archive go-together), then close. Only present
  // when a saved copy exists (the dialog itself is the confirm; Drive deletes go to the recoverable Drive trash).
  footer.querySelector('.df-close-confirm__btn--delete')?.addEventListener('click', async () => {
    close();
    const t = tabs.find(x => x.id === tabId);
    if (t?.driveFileId) await persistenceModule.deleteDiagramFromDrive?.(t.driveFileId);
    if (t) {
      if (t.browserSaveName) deleteBrowserArchive(t.browserSaveName);
      t.dirty = false;
    }
    doCloseTab(tabId, { archive: false });
  });

  footer.querySelector('.df-close-confirm__btn--save').addEventListener('click', () => {
    close();
    const t = tabs.find(x => x.id === tabId);
    if (t) t.dirty = false;   // user chose to keep it → not a discard
    // Save = keep the work: doCloseTab auto-archives it to Browser Storage (the item-8 model), then closes.
    doCloseTab(tabId);
  });
}

// Storage-pressure gauge for the Close & Delete overlay (mirrors the Load & Import one; reuses the
// .df-load-gauge CSS). Built from the persistence footprint helpers so you can watch the store empty as you
// prune. tabs.js has `persistence` but not `toolbar`, so this is a small local mirror of storagePressureHtml.
function storageGaugeHtml() {
  let used = 0;
  try { used = persistenceModule.getStorageFootprint?.() || 0; } catch { return ''; }
  if (!(used > 0)) return '';
  const warn = persistenceModule.STORAGE_WARNING_BYTES || 4_000_000;
  const level = gaugeLevel(used, warn);
  const pct = Math.min(100, Math.round((used / warn) * 100));
  const hint = level === 'ok' ? ''
    : '<p class="df-load-gauge__hint">Browser storage is filling up - delete saved diagrams to free space.</p>';
  return `<div class="df-load-gauge df-load-gauge--${level}" style="margin:0 0 var(--spacing-md)">
      <div class="df-load-gauge__caption"><span>Browser storage</span><span>${escHtml((used / 1e6).toFixed(1))} MB used</span></div>
      <div class="df-load-gauge__track"><div class="df-load-gauge__fill" style="width:${pct}%"></div></div>
      ${hint}
    </div>`;
}

// The single hub for deleting browser-stored diagrams: OPEN tabs (close + optional delete) AND CLOSED archives
// (delete-only). Shows the storage gauge + per-diagram weight so you can free space deliberately.
export function showCloseTabsModal() {
  // Drop any "Closed (in Browser Storage)" archive whose Drive file is currently OPEN as a tab: reopening a Drive-
  // backed closed tab leaves its browser archive behind, so it would otherwise list twice (Open Tabs + Closed) for
  // the same diagram. The archive stays in storage (a backup); it's just hidden here while the diagram is open.
  const openDriveIds = new Set(tabs.map(t => t.driveFileId).filter(Boolean));
  const archives = (persistenceModule.getNamedSaves?.() || []).filter(a => !(a.driveFileId && openDriveIds.has(a.driveFileId)));
  if (tabs.length === 0 && archives.length === 0) return;

  document.querySelector('.df-close-tabs-modal')?.remove();

  // Storage chips + Copy/Collab pill use the SAME shared builders as the Save/Load managers (driveChipsHtml /
  // sharePillHtml in util.js) so Close & Delete reads identically - including the greyed "My Drive (off)" chip for an
  // un-synced tab, which the old hand-rolled chips here used to omit (the inconsistency the user flagged).
  const driveOn = !!persistenceModule.isDriveConfigured?.();

  // OPEN TABS — closable + deletable. Weight (8.4) = serialized graph size.
  const openRowsHtml = tabs.map(t => {
    const typeLabel = DIAGRAM_TYPES[t.diagramType]?.short || 'Architecture';
    const rel = formatRelativeTime(t.lastModifiedAt || t.lastSavedAt);
    const g = t.groupId ? getGroup(t.groupId) : null;
    const graphJSON = getTabGraphJSON(t.id);
    const shapes = countDiagramShapes(graphJSON?.cells);
    const weight = formatBytes(JSON.stringify(graphJSON || {}).length);
    const sharedCount = (t.driveCopies || []).filter(c => c && c.kind === 'shared-drive').length;
    const hasBackup = (t.driveCopies || []).some(c => c && c.kind === 'mydrive-backup');
    const chipsHtml = driveChipsHtml({ ...t, driveSharedCopies: sharedCount }, { driveOn, onSharedDrive: !!t.driveDriveId, hasMyDriveBackup: hasBackup });
    const src = t.driveSharedSource;
    // Item #5: the Copy/Collab pill sits on the BOTTOM chip row right after the "Shared File" chip (sm), not up by
    // the title - the access type goes WITH the Shared-File state. Matches Load -> Drive + the Save Manager.
    const sharePill = (src && src.fileId && !isViewForkTab(t)) ? sharePillHtml(src.canEdit, { sm: true }) : '';   // a view fork is your own file → no pill
    const nameSuffix = t.dirty ? ' <span class="df-close-tabs__dirty" title="Unsaved changes"></span>' : '';
    return storageRowHtml({
      tag: 'label', rowClass: 'df-close-tabs__row', rowAttrs: `data-tab-id="${escHtml(t.id)}"`,
      active: t.id === activeTabId,
      checkbox: `<input type="checkbox" class="df-close-tabs__checkbox" data-tab-id="${escHtml(t.id)}" />`,
      diagramType: t.diagramType, typeTitle: typeLabel, name: t.name, nameSuffix,
      groupBadge: groupBadgeHtml(g), count: shapes,
      metaLeft: `<span class="df-save-mgr__chips">${chipsHtml}${sharePill}</span>`,
      metaRight: `${rel ? `Edited ${rel}` : ''}${weight ? `${rel ? ' · ' : ''}${weight}` : ''}`,
    });
  }).join('');

  // CLOSED ARCHIVES — delete-only (you can't "close" what isn't open). Weight = stored entry size.
  const archiveRowsHtml = archives.map(s => {
    const rel = formatRelativeTime(s.timestamp) || 'just now';
    const weight = formatBytes(s.bytes);
    const sharedCount = (s.driveCopies || []).filter(c => c && c.kind === 'shared-drive').length;
    const hasBackup = (s.driveCopies || []).some(c => c && c.kind === 'mydrive-backup');
    const chipsHtml = driveChipsHtml({ ...s, driveSharedCopies: sharedCount }, { driveOn, onSharedDrive: !!s.driveDriveId, hasMyDriveBackup: hasBackup });
    const asrc = s.driveSharedSource;
    const archivePill = (asrc && asrc.fileId && !isViewForkTab(s)) ? sharePillHtml(asrc.canEdit, { sm: true }) : '';   // a view fork is your own file → no pill
    return storageRowHtml({
      tag: 'label', rowClass: 'df-close-tabs__row', rowAttrs: `data-save-key="${escHtml(s.key)}"`,
      diagramType: s.diagramType, typeTitle: DIAGRAM_TYPES[s.diagramType]?.short || 'Architecture',
      name: s.name, count: s.shapes, groupBadge: '',
      checkbox: `<input type="checkbox" class="df-close-tabs__checkbox" data-save-key="${escHtml(s.key)}" data-save-name="${escHtml(s.name)}" />`,
      metaLeft: `<span class="df-save-mgr__chips">${chipsHtml}${archivePill}</span>`,
      metaRight: `Last Modified ${rel}${weight ? ` · ${weight}` : ''}`,   // "Last Modified" = a CLOSED archive (vs "Edited" for live tabs); matches the Load Manager archive rows
    });
  }).join('');

  // Item 3: when BOTH sections exist, render them as two separate bordered, collapsible TABLES (the same split
  // styling as Load -> Drive / Load -> Browser) - each a header band with a chevron + count. With only one section,
  // a single plain box (no redundant header), as before. The Select all + group-pick bar floats above both tables.
  const chevron = '<svg class="df-load-open__chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const splitTable = (label, count, rowsHtml) => `<div class="df-split-table df-modal__list-box"><div class="df-split-table__head" role="button" tabindex="0">${chevron}<span>${label}</span><span class="df-split-table__count">${count}</span></div><div class="df-split-table__rows">${rowsHtml}</div></div>`;
  const controlsHtml = `<div class="df-modal__list-header df-split-table__controls"><label class="df-modal__select-all"><input type="checkbox" class="df-close-tabs__checkbox" data-role="select-all" /> Select all</label>${groupSelectHtml(getGroups())}</div>`;
  const tablesHtml = (openRowsHtml && archiveRowsHtml)
    ? splitTable('Open tabs', tabs.length, openRowsHtml) + splitTable('Closed (in Browser Storage)', archives.length, archiveRowsHtml)
    : `<div class="df-modal__list-box">${openRowsHtml || archiveRowsHtml}</div>`;

  const { body, footer, close } = buildModal({
    title: 'Close & Delete',
    className: 'df-close-tabs-modal',
    zIndex: 3000,
    bodyStyle: 'padding:var(--spacing-md) var(--spacing-lg)',
    bodyHtml: `
      <p style="margin:0 0 var(--spacing-sm);color:var(--text-secondary);font-size:var(--font-size-sm)">
        Close open tabs, or delete any diagram from this browser to free space.
      </p>
      ${storageGaugeHtml()}
      ${controlsHtml}
      ${tablesHtml}`,
    footerHtml: `
      <button class="df-close-tabs__btn df-close-tabs__btn--danger" data-action="close-delete" style="margin-right:auto" disabled>Delete Selected</button>
      <button class="df-close-tabs__btn df-close-tabs__btn--accent" data-action="close" disabled>Close Selected</button>`,
  });

  const selectAllEl = body.querySelector('[data-role="select-all"]');
  const rowBoxes = Array.from(body.querySelectorAll('.df-close-tabs__checkbox')).filter(b => b.dataset.role !== 'select-all');
  const tabBoxes = () => rowBoxes.filter(b => b.dataset.tabId);
  const closeBtn = footer.querySelector('[data-action="close"]');
  const deleteBtn = footer.querySelector('[data-action="close-delete"]');

  // `expand` is true only for the bulk actions (Select all / Select Tab Group): a table that gains a selection is
  // auto-uncollapsed + its header count flips to "selected/total" (item 1). An individual row toggle just updates
  // the counts without forcing any table open.
  const updateState = (expand = false) => {
    const checked = rowBoxes.filter(b => b.checked);
    const openChecked = checked.filter(b => b.dataset.tabId);
    // Close Selected → open tabs only (archives aren't open). Delete Selected → ANYTHING selected (8.5).
    closeBtn.disabled = openChecked.length === 0;
    closeBtn.textContent = openChecked.length > 1 ? `Close Selected (${openChecked.length})` : 'Close Selected';
    deleteBtn.disabled = checked.length === 0;
    deleteBtn.textContent = checked.length > 1 ? `Delete Selected (${checked.length})` : 'Delete Selected';
    if (checked.length === 0) { selectAllEl.checked = false; selectAllEl.indeterminate = false; }
    else if (checked.length === rowBoxes.length) { selectAllEl.checked = true; selectAllEl.indeterminate = false; }
    else { selectAllEl.checked = false; selectAllEl.indeterminate = true; }
    refreshSplitTableCounts(body, '.df-close-tabs__checkbox', { expand });
  };

  selectAllEl.addEventListener('change', () => { rowBoxes.forEach(b => { b.checked = selectAllEl.checked; }); updateState(true); });
  rowBoxes.forEach(b => b.addEventListener('change', () => updateState()));

  // Collapse/expand each split-table (item 3) - the two tables read like the Load -> Drive / Browser ones.
  body.querySelectorAll('.df-split-table__head').forEach((h) => {
    const grp = h.closest('.df-split-table');
    const toggle = () => grp.classList.toggle('is-collapsed');
    h.addEventListener('click', toggle);
    h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });

  // "Select Tab Group" — replaces the selection with the chosen group's OPEN tabs (archives carry no group).
  const groupSel = body.querySelector('.df-group-select');
  if (groupSel) {
    const tabGroup = new Map(tabs.map(t => [t.id, t.groupId || null]));
    groupSel.addEventListener('change', () => {
      const chosen = groupSel.value;
      if (chosen) rowBoxes.forEach(b => { b.checked = !!b.dataset.tabId && tabInGroup(tabGroup.get(b.dataset.tabId), chosen); });
      groupSel.value = '';
      updateState(true);
    });
  }

  body.querySelectorAll('.df-close-tabs__row[data-tab-id], .df-close-tabs__row[data-save-key]').forEach(row => {
    row.addEventListener('click', (e) => { if (e.target.tagName === 'INPUT') e.stopPropagation(); });
  });

  // Close Selected — close the selected OPEN tabs (their browser archive is kept). Dirty tabs prompt.
  closeBtn.addEventListener('click', () => {
    const selectedIds = tabBoxes().filter(b => b.checked).map(b => b.dataset.tabId);
    if (selectedIds.length === 0) return;
    const dirtyIds = selectedIds.filter(id => tabs.find(t => t.id === id)?.dirty);
    if (dirtyIds.length > 0) {
      showMultiDiscardConfirm(dirtyIds.length,
        () => { close(); performMultiClose(selectedIds, { noArchiveIds: new Set(dirtyIds) }); },
        () => { close(); performMultiClose(selectedIds); });
    } else { close(); performMultiClose(selectedIds); }
  });

  // Delete Selected (8.5) — remove from browser storage entirely: open tabs → close + delete their existing
  // archive + Drive master (if synced); closed archives → delete the localStorage entry. Works for ANY selection.
  deleteBtn.addEventListener('click', async () => {
    const checked = rowBoxes.filter(b => b.checked);
    if (!checked.length) return;
    const tabIds = checked.filter(b => b.dataset.tabId).map(b => b.dataset.tabId);
    const saveItems = checked.filter(b => b.dataset.saveKey).map(b => ({ key: b.dataset.saveKey, name: b.dataset.saveName }));
    const driveTabs = tabIds.map(id => tabs.find(t => t.id === id)).filter(t => t && t.driveFileId);
    const browserTotal = tabIds.length + saveItems.length;
    const parts = [];
    if (tabIds.length) parts.push(`close ${tabIds.length} open tab${tabIds.length === 1 ? '' : 's'}`);
    parts.push(`remove ${browserTotal} diagram${browserTotal === 1 ? '' : 's'} from this browser`);
    if (driveTabs.length) parts.push(`move ${driveTabs.length} to your Google Drive trash (recoverable 30 days)`);
    const ok = await confirmModal({
      title: 'Delete selected diagrams?',
      message: `This will ${parts.join(', ')}. This can't be undone${driveTabs.length ? " (Drive's trash aside)" : ''}.`,
      okLabel: 'Delete', cancelLabel: 'Cancel', tone: 'danger',
    });
    if (!ok) return;
    close();
    for (const t of driveTabs) { try { await persistenceModule.deleteDiagramFromDrive(t.driveFileId); } catch (e) { console.warn('Diagramforce: Drive delete failed', t.id, e); } }
    // Remove the existing browser archive of EVERY selected open tab (synced or not), then the standalone archives.
    for (const id of tabIds) { const t = tabs.find(x => x.id === id); if (t?.browserSaveName) deleteBrowserArchive(t.browserSaveName); }
    for (const s of saveItems) { persistenceModule.deleteNamedSave?.(s.key); forgetBrowserSaveName(s.name); }
    // Close the open tabs WITHOUT re-archiving (we're deleting their browser copy).
    if (tabIds.length) performMultiClose(tabIds, { noArchiveIds: new Set(tabIds) });
  });
}

function performMultiClose(ids, { noArchiveIds = null } = {}) {
  // Mark all selected tabs as non-dirty so doCloseTab proceeds without prompting.
  for (const id of ids) {
    const tab = tabs.find(t => t.id === id);
    if (tab) tab.dirty = false;
  }
  // Close in reverse so splice indices stay stable and we don't churn the active tab.
  // If the active tab is in the set, doCloseTab will switch to the nearest remaining
  // one each time — which is the right behaviour. `noArchiveIds` are the delete-closed tabs
  // (their copies are being removed), so they skip the auto-archive; the rest archive normally.
  for (const id of [...ids]) {
    if (tabs.some(t => t.id === id)) doCloseTab(id, { archive: !(noArchiveIds && noArchiveIds.has(id)) });
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

export function switchTab(id) {
  if (id === activeTabId) return;
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
  const old = tabs.find(t => t.id === activeTabId);
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

export function markSaved(saveType) {
  const tab = tabs.find(t => t.id === activeTabId);
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
    isActive: t.id === activeTabId,
    dirty: t.dirty,
    lastModifiedAt: t.lastModifiedAt || null,
    lastSavedAt: t.lastSavedAt || null,
    // Drive status for the Save-to-Drive modal's per-row chip.
    driveFileId: t.driveFileId || null,
    driveDriveId: t.driveDriveId || null,             // set → the file LIVES on a team Shared Drive → "Shared Drive" chip + tab glyph
    driveHasMyDriveBackup: (t.driveCopies || []).some(c => c && c.kind === 'mydrive-backup'),   // a Shared-Drive file mirrored into My Drive → "My Drive" chip too
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
export function forgetBrowserSaveName(name) {
  if (!name) return;
  let changed = false;
  for (const tab of tabs) { if (tab.browserSaveName === name) { tab.browserSaveName = null; changed = true; } }
  if (changed) { saveCurrentTabState(); render(); }
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
export function onChange(cb) { onChangeCallbacks.push(cb); }
function notifyChange() { onChangeCallbacks.forEach(cb => cb()); }

// ── Tab groups (v1.16.0) ─────────────────────────────────────────────
// A group is a named, optionally icon + accent-colour tagged folder of tabs. Each tab carries a
// `groupId` (null = ungrouped). Groups render as inline chips in the tab bar, each followed by its
// tabs; ungrouped tabs sit after every group. Visual order = groups[] order, then within each
// group the tabs[] order, then the ungrouped tabs[] order. reorderTabsByGroup() keeps `tabs` in
// that visual order so drag-reorder, render, and serialization all agree on one sequence.
function generateGroupId() { return `group-${nextGroupId++}`; }
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
  const color = String(group.color || '').replace(/[^a-zA-Z0-9#(),.%\s-]/g, '');   // safe to inline in style
  return `<span class="df-row-group-badge"${color ? ` style="--g:${color}"` : ''}><span>${escHtml(group.name)}</span></span>`;
}

/** Create a new (empty) group and return its id. */
export function createGroup(name = 'Group', opts = {}) {
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
    // Synthetic Ungrouped group: collapse flag lives in `ungroupedCollapsed`, not a `groups[]` entry.
    if (!ungroupedCollapsed && !tabs.some(t => !t.groupId)) return;   // nothing to hide
    const oldTrayU = tabListEl.querySelector(`.df-tab-group-tray[data-group-id="${UNGROUPED_ID}"]`);
    const oldWU = oldTrayU ? oldTrayU.getBoundingClientRect().width : null;
    ungroupedCollapsed = !ungroupedCollapsed;
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
  if (doomed.has(activeTabId)) {
    if (tabs.length === 0) {
      activeTabId = null;
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
  const onDoc = (e) => { if (!panel.contains(e.target)) closeFloating(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeFloating(); } };
  setTimeout(() => { document.addEventListener('mousedown', onDoc, true); document.addEventListener('keydown', onKey, true); }, 0);
  _floatClose = () => { document.removeEventListener('mousedown', onDoc, true); document.removeEventListener('keydown', onKey, true); panel.remove(); };
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
 *  `ungroupedCollapsed` flag (not a groups[] .collapsed). */
function openUngroupedMenu(anchorEl) {
  const hasTabs = tabs.some(t => !t.groupId);
  openFloating(anchorEl, 'df-tab-pop--menu', (panel) => {
    panel.appendChild(menuItem(
      ungroupedCollapsed ? 'Expand group' : 'Collapse group',
      () => toggleGroupCollapsed(UNGROUPED_ID),
      { icon: ungroupedCollapsed ? 'chevronright' : 'chevrondown' }
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
// Matches the toolbar "Compare with" icon (a list + a change arrow).
const COMPARE_GLYPH = '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h6M3 8h4M3 12h7"/><path d="M12 3v8M12 3l-2 2M12 3l2 2"/></g>';

// Right-click a tab → clone / export / share it, or assign it to a group (ungroup / create a new group).
function openTabGroupMenu(anchorEl, tab) {
  openFloating(anchorEl, 'df-tab-pop--menu', (panel) => {
    // Clone — an exact duplicate of this diagram as a NEW tab named "<name> (clone)". Deep-copies the cells into
    // a separate graph (ids may repeat across tabs - each tab is its own isolated graph), so the copy is
    // byte-identical in layout. importDiagramAsTab uniquifies the name and fits the new tab.
    panel.appendChild(menuItem('Clone', () => {
      saveCurrentTabState();   // flush the active tab's live graph so a clone of the ACTIVE tab is current
      const cells = (tab.id === activeTabId ? graph.toJSON().cells : getTabGraphJSON(tab.id)?.cells) || [];
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

function saveCurrentTabState() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  tab.graphJSON = graph.toJSON();
  tab.viewport = canvasModule.getViewport();
  // Preserve undo/redo stacks for this tab
  tab.historyState = historyModule.save();
}

/** Persist the active tab's live graph to the browser session now AND flush any pending Drive autosave — the
 *  same "save" a tab switch performs (switchTab), exposed so an explicit surface (the Save & Export manager)
 *  can commit the current work before it reads tab state. Best-effort, no dialog: saveCurrentTabState captures
 *  the live graph into tab.graphJSON, saveTabs writes the session to localStorage, and flushDriveSave is a
 *  no-op unless auto-sync is on with a dirty, signed-in active tab (so it never spams Drive revisions). */
export function commitActiveTab() {
  saveCurrentTabState();
  saveTabs();
  // Returns the Drive-flush promise (resolved immediately when there's nothing to flush) so a caller can update
  // its UI once the active tab's Drive file is actually written/created.
  return persistenceModule.flushDriveSave?.() || Promise.resolve();
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
    const meta = { activeTabId, nextId, nextGroupId, appVersion: APP_VERSION, tabs: data, ungroupedCollapsed,
      groups: groups.map(g => ({ id: g.id, name: g.name, icon: g.icon || null, color: g.color || null, collapsed: !!g.collapsed })) };

    // Also save full graph state for each tab
    const full = tabs.map(t => ({
      id: t.id,
      name: t.name,
      diagramType: t.diagramType || 'architecture',
      groupId: t.groupId || null,
      mappingMode: t.mappingMode || false,
      dirty: t.dirty,
      lastSavedAt: t.lastSavedAt || null,
      lastSaveType: t.lastSaveType || null,
      lastModifiedAt: t.lastModifiedAt || null,
      browserSaveName: t.browserSaveName || null,   // Save Manager "In Browser" chip survives a reload
      // Google Drive sync state (Phase 2) — ONE canonical field list (serializeDriveFields) shared with the restore
      // path below, so a synced tab keeps syncing after a reload and no drive field can silently drift out of sync.
      ...serializeDriveFields(t),
      // Compact each tab's graph (drop reconstructed-on-load ports/size/angle/icon/routing) so the
      // session blob — the heaviest, most-frequently-written localStorage entry — stays small.
      // compactGraphForSave deep-clones, so the live `t.graphJSON` is untouched; session restore
      // rebuilds everything via the common fromJSON + migrate path.
      graphJSON: compactGraphForSave(t.id === activeTabId ? graph.toJSON() : t.graphJSON),
      viewport: t.id === activeTabId ? canvasModule.getViewport() : t.viewport,
    }));
    const payload = JSON.stringify({ ...meta, tabs: full });
    localStorage.setItem(STORAGE_KEY, payload);
    // CR-7.1 / Gap 32 (v1.12.0) — proactive pressure check, sampled every
    // 5 successful saves. The deterministic counter (not random) makes
    // behaviour reproducible for debugging. The footprint loop itself is
    // O(keys) and well under a millisecond, so we could check on every
    // save without measurable cost — the sampling is purely to avoid
    // doing work whose result can't realistically change in <5 saves.
    if (++saveCounter % 5 === 0) checkStoragePressure();
  } catch (err) {
    // Gap 22 (v1.12.0) — quota recovery. The SESSION blob is the heaviest, most-frequently-written entry, so
    // it's the first to hit the wall. Before pausing (which silently drops recent edits until reload), do what
    // the NAMED-SAVE path does: shed redundant Drive-backed archives (recoverable from Drive) and retry the
    // write ONCE. Only if the retry still fails do we warn + pause (throttled to once per session).
    if (isQuotaError(err)) {
      try {
        evictRedundantArchives(0);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...meta, tabs: full }));
        return;   // recovered - the backup is current again
      } catch (e2) {
        if (!quotaToastShown) {
          quotaToastShown = true;
          showError('Browser storage full - session backup paused. Export to JSON or delete saved diagrams to make space.');
        }
        console.warn('SF Diagrams: Tab save failed after evict+retry:', e2);
        return;
      }
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
  // Offload first: shed the OLDEST redundant (Drive-backed) browser archives — they're reloadable from Drive.
  // Only warn if we're STILL over after that, i.e. the remaining archives are browser-only / irreplaceable.
  let evicted = 0;
  try { evicted = evictRedundantArchives() || 0; bytes = getStorageFootprint(); } catch { /* keep last bytes */ }
  if (bytes < STORAGE_WARNING_BYTES) {
    if (evicted) console.info(`Diagramforce: freed browser storage by offloading ${evicted} Drive-backed archive${evicted === 1 ? '' : 's'} (still safe in Google Drive).`);
    return;
  }
  pressureToastShown = true;
  showToast(
    'Browser storage almost full. Export to JSON and delete saved diagrams to free space.',
    'warning'
  );
}

/** Populate tabs array and load the active tab from parsed session data. */
function doRestoreTabData(data) {
  if (data.nextId) nextId = data.nextId;
  if (data.nextGroupId) nextGroupId = data.nextGroupId;
  ungroupedCollapsed = !!data.ungroupedCollapsed;   // synthetic Ungrouped group's fold state

  // Restore tab groups (v1.16.0). Absent in pre-1.16 sessions → no groups, everything ungrouped.
  groups.length = 0;
  if (Array.isArray(data.groups)) {
    for (const g of data.groups) {
      if (!g || !g.id) continue;
      groups.push({ id: g.id, name: g.name || 'Group', icon: g.icon || null, color: g.color || null, collapsed: !!g.collapsed });
      // Keep the id counter ahead of any restored group (covers sessions written before nextGroupId existed).
      const n = parseInt(String(g.id).replace(/^group-/, ''), 10);
      if (Number.isFinite(n) && n >= nextGroupId) nextGroupId = n + 1;
    }
  }
  const groupIds = new Set(groups.map(g => g.id));

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
        groupId: groupIds.has(t.groupId) ? t.groupId : null,   // drop references to a deleted group
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
        browserSaveName: t.browserSaveName || null,
        // Same canonical Drive-field list as saveTabs (serializeDriveFields) — the two can't drift.
        ...serializeDriveFields(t),
      });
      // Re-seed remote-store's runtime sync state so a synced tab keeps syncing. A shared tab may have a
      // sharedSource but no own master yet, so hydrate when EITHER is present.
      if (t.driveFileId || t.driveSharedSource) persistenceModule.hydrateTabDrive?.(t.id, serializeDriveFields(t));
    }
    activeTabId = data.activeTabId || tabs[0].id;
  } else {
    const id = generateId();
    tabs.push({ id, name: 'Draft', diagramType: 'architecture', groupId: null, graphJSON: null, viewport: null, dirty: false, lastSavedAt: null, lastSaveType: null, lastModifiedAt: null });
    activeTabId = id;
  }
  reorderTabsByGroup();   // normalise to visual order (grouped contiguous, ungrouped last)

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
    // Record a real version update (minor/major) so app.js can show the What's-New overlay (the rich changelog). For a
    // MINOR update this REPLACES the old inline "Session Restored" notice; the MAJOR branch still asks about reset (a
    // potential-incompatibility decision) and What's New is skipped there (app.js) to avoid stacking two dialogs.
    if (diff === 'minor' || diff === 'major') _sessionUpdate = { fromVersion: savedVersion, diff };
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

// Set during session restore when the saved session was from an OLDER release: { fromVersion, diff }, else null.
// app.js reads it to drive the What's-New overlay (a returning user updating in from a pre-What's-New release has no
// seen-key, so the session version is the only reliable "last release I ran" signal). Captured BEFORE saveTabs()
// re-stamps the session to the current version.
let _sessionUpdate = null;
/** The version update detected on this session restore ({ fromVersion, diff:'minor'|'major' }) or null. */
export function getSessionUpdate() { return _sessionUpdate; }

/**
 * Show a warning when the auto-saved session version differs. Now used for MAJOR only (a reset decision) — a MINOR
 * update no longer shows this inline notice; the richer What's-New overlay (app.js) supersedes it.
 * For major: returns Promise<boolean> — true = try loading, false = reset.
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
      ? `<button class="df-modal__btn" data-action="backup" style="margin-left:auto">Export JSON</button>`
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
        btn.textContent = 'Exported!';
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
    // Capture "this is the FIRST real content edit on the active tab" BEFORE markDirty flips the flag. markDirty's
    // own isLoadingJSON guard means a load/restore/migration never counts; viewport + selection never reach here.
    const tab = tabs.find(t => t.id === activeTabId);
    const firstRealEdit = !!tab && !tab.dirty && !canvasModule.isLoadingJSON?.();
    markDirty();
    // Mode C: a VIEW (Copy) share diverges into the user's own copy on its first edit → rename to "(changed)".
    if (firstRealEdit) maybeForkViewShareOnEdit(tab);
    // Drive autosave — only on REAL edits (markDirty's same isLoadingJSON gate), so a
    // tab switch / open / restore doesn't trigger a Drive write.
    if (!canvasModule.isLoadingJSON?.()) persistenceModule.notifyDriveChange?.();
    clearTimeout(tabSaveTimer);
    tabSaveTimer = setTimeout(() => saveTabs(), 1000);
  });
}

// Mode C (shared-copy): a diagram opened from someone else's VIEW (Copy) share carries a `driveSharedSource` but no
// own My-Drive master (the open path intentionally mints nothing - that eager mint was the orphan/duplicate-row bug).
// The moment the user makes a real content edit it "diverges" into their own copy, so rename it to "<name> (changed)":
// the new master that the normal Drive autosave mints a beat later - and the tab itself - then both read as the
// user's fork, while Refresh still re-pulls the untouched original. Only a PROVEN view share (canEdit === false)
// forks; an editable (Collab) share keeps its name + writes back, and an unknown (null) share keeps its name until
// its access resolves. Idempotent: once a master exists (driveFileId set) it no longer matches, so it fires once.
function maybeForkViewShareOnEdit(tab) {
  const src = tab && tab.driveSharedSource;
  if (!src || !src.fileId || tab.driveFileId) return;   // not a master-less shared-in tab
  if (src.canEdit === true) return;                     // editable (Collab) share keeps its name + its own path
  // A PROVEN view share (canEdit === false) renames to "(changed)" - the divergence signal. An unknown (null) share
  // (e.g. a #gd= link whose access hasn't resolved) keeps its name but STILL gets its working copy minted below.
  if (src.canEdit === false) { const forked = forkName(tab.name); if (forked !== tab.name) renameTab(tab.id, forked); }
  // Mint the working copy NOW, independent of the auto-sync toggle: in MANUAL Drive mode notifyDriveChange never
  // schedules a save, which would strand the edit (tab renamed "(changed)" with no Drive file behind it). Fire-and-
  // forget; self-gates on a live token, so offline it defers to the sign-in sweep / a manual save.
  persistenceModule.forkSharedViewOnEdit?.(tab.id);
}

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
  if (tabs.length === 0 && !document.querySelector('.df-new-modal')) {
    setTimeout(showNewDiagramModal, 0);
  }

  const renderTab = (tab) => {
    const el = document.createElement('div');
    el.className = 'df-tab' +
      (tab.id === activeTabId ? ' df-tab--active' : '') +
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
      const active = groupTabs.find(t => t.id === activeTabId);
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
    const ug = { id: UNGROUPED_ID, name: 'Ungrouped', icon: 'tabset', color: null, collapsed: ungroupedCollapsed };
    const ugCollapsed = ungroupedCollapsed && ungroupedTabs.length > 0;
    const tray = document.createElement('div');
    tray.className = 'df-tab-group-tray df-tab-group-tray--ungrouped' + (ugCollapsed ? ' df-tab-group-tray--collapsed' : '');
    tray.dataset.groupId = UNGROUPED_ID;
    tray.appendChild(renderGroupChip(ug, ungroupedTabs.length));
    // NOTE: ungrouped tabs deliberately keep NO `df-tab--grouped` marker (that means "in a NAMED group" —
    // delete-group/ungroup flows assert its absence). The tray's transparent-bg + gray hover come from the
    // `.df-tab-group-tray--ungrouped .df-tab` descendant CSS instead.
    const addUg = (t, lingering) => { const el = renderTab(t); if (lingering) el.classList.add('df-tab--lingering'); tray.appendChild(el); };
    if (ugCollapsed) {
      const active = ungroupedTabs.find(t => t.id === activeTabId);
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
    active = { base: contentLeft(r), w: Math.round(r.width), groupId: tabs.find(t => t.id === activeTabId)?.groupId || null };
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
  const tab = tabs.find(t => t.id === activeTabId);
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

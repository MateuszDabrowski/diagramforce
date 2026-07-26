// Session store (CLEANUP S5 slice 3) — the localStorage tab/group session engine: per-tab state save,
// the sf-diagrams-tabs blob (save/restore), version-warning + auto-save wiring, and view-share fork-on-edit.
// Reads tabs/groups + graph/persistence from tbctx and reaches facade lifecycle fns (generateId/markDirty/
// notifyChange/renameTab/render/reorderTabsByGroup) via tbctx forward-refs at CALL time; imports the
// showNewDiagramModal slice directly (acyclic). Owns STORAGE_KEY + the _sessionUpdate flag.

import { tbctx } from './context.js?v=1.21.1';
import { showNewDiagramModal } from './new-diagram-modal.js?v=1.21.1';
import { APP_VERSION, STORAGE_WARNING_BYTES, classifyVersionDiff, compactGraphForSave, dateSuffix, evictRedundantArchives, getStorageFootprint, isQuotaError, normalizeDiagramType, triggerDownload } from '../persistence.js?v=1.21.1';
import { forkName, serializeDriveFields } from '../persistence/drive-sync-logic.js?v=1.21.1';
import { buildModal, showError, showToast } from '../feedback.js?v=1.21.1';
import { escHtml, sanitizeFilenamePart } from '../util.js?v=1.21.1';

const STORAGE_KEY = 'sf-diagrams-tabs';

export function saveCurrentTabState() {
  const { tabs } = tbctx;
  const { graph, canvas: canvasModule, history: historyModule } = tbctx.modules;
  const tab = tabs.find(t => t.id === tbctx.activeTabId);
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
  const { persistence: persistenceModule } = tbctx.modules;
  saveCurrentTabState();
  saveTabs();
  // Returns the Drive-flush promise (resolved immediately when there's nothing to flush) so a caller can update
  // its UI once the active tab's Drive file is actually written/created.
  return persistenceModule.flushDriveSave?.() || Promise.resolve();
}

export function activateTab(id, isFresh) {
  const { tabs } = tbctx;
  const { graph, canvas: canvasModule, selection: selectionModule, history: historyModule, stencil: stencilModule } = tbctx.modules;
  const { notifyChange } = tbctx;
  tbctx.activeTabId = id;
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

// P6: memoize the compacted form of each INACTIVE tab's graph. compactGraphForSave deep-clones and
// strips reconstructed-on-load fields (ports/size/angle/icon/routing) — expensive, yet saveTabs re-runs
// it for EVERY tab on EVERY 1s-debounced save even though an inactive tab's graphJSON is unchanged
// between saves (multi-MB of pointless deep-clone per edit-second with many tabs). Keyed on the
// graphJSON OBJECT identity: saveCurrentTabState (line 21) is the SOLE reassignment of tab.graphJSON
// and it is never mutated in place, so a fresh object (an edit / switch-away / import) MISSES the cache
// and recomputes while an unchanged one HITS — automatic, airtight invalidation with no bookkeeping.
// The cached clone is only stringified downstream, never mutated, so the payload stays byte-identical.
// The ACTIVE tab always recompacts its LIVE graph.toJSON() (it may have just changed → never cached).
const _compactCache = new WeakMap();   // graphJSON object -> compactGraphForSave(graphJSON)
function compactTabGraph(graphJSON) {
  if (!graphJSON || typeof graphJSON !== 'object') return compactGraphForSave(graphJSON);
  if (!_compactCache.has(graphJSON)) _compactCache.set(graphJSON, compactGraphForSave(graphJSON));
  return _compactCache.get(graphJSON);
}

export function saveTabs() {
  const { tabs, groups } = tbctx;
  const { graph, canvas: canvasModule } = tbctx.modules;
  try {
    // Save lightweight tab metadata (not graph data — that's per-tab autosave)
    const data = tabs.map(t => ({ id: t.id, name: t.name, dirty: t.dirty }));
    const meta = { activeTabId: tbctx.activeTabId, nextId: tbctx.nextId, nextGroupId: tbctx.nextGroupId, appVersion: APP_VERSION, tabs: data, ungroupedCollapsed: tbctx.ungroupedCollapsed,
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
      graphJSON: t.id === tbctx.activeTabId ? compactGraphForSave(graph.toJSON()) : compactTabGraph(t.graphJSON),
      viewport: t.id === tbctx.activeTabId ? canvasModule.getViewport() : t.viewport,
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
export function checkStoragePressure() {
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
  const { tabs, groups } = tbctx;
  const { persistence: persistenceModule, graph, canvas: canvasModule, stencil: stencilModule } = tbctx.modules;
  const { generateId, reorderTabsByGroup } = tbctx;
  if (data.nextId) tbctx.nextId = data.nextId;
  if (data.nextGroupId) tbctx.nextGroupId = data.nextGroupId;
  tbctx.ungroupedCollapsed = !!data.ungroupedCollapsed;   // synthetic Ungrouped group's fold state

  // Restore tab groups (v1.16.0). Absent in pre-1.16 sessions → no groups, everything ungrouped.
  groups.length = 0;
  if (Array.isArray(data.groups)) {
    for (const g of data.groups) {
      if (!g || !g.id) continue;
      groups.push({ id: g.id, name: g.name || 'Group', icon: g.icon || null, color: g.color || null, collapsed: !!g.collapsed });
      // Keep the id counter ahead of any restored group (covers sessions written before tbctx.nextGroupId existed).
      const n = parseInt(String(g.id).replace(/^group-/, ''), 10);
      if (Number.isFinite(n) && n >= tbctx.nextGroupId) tbctx.nextGroupId = n + 1;
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
    tbctx.activeTabId = data.activeTabId || tabs[0].id;
  } else {
    const id = generateId();
    tabs.push({ id, name: 'Draft', diagramType: 'architecture', groupId: null, graphJSON: null, viewport: null, dirty: false, lastSavedAt: null, lastSaveType: null, lastModifiedAt: null });
    tbctx.activeTabId = id;
  }
  reorderTabsByGroup();   // normalise to visual order (grouped contiguous, ungrouped last)

  // Load the active tab's state
  const active = tabs.find(t => t.id === tbctx.activeTabId);
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

export function restoreTabs() {
  const { tabs } = tbctx;
  const { persistence: persistenceModule } = tbctx.modules;
  const { generateId, render } = tbctx;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // No saved tabs — show the new-diagram modal as a starting point, UNLESS the URL is an Open-with /
      // share launch that loadFromURL() (Phase 9, after this) will populate a tab from: else the New-Diagram
      // overlay stacks OVER that flow's sign-in / share-load modal (A2). loadFromURL still runs and loads it;
      // if it fails leaving zero tabs, the render() safety net below re-offers New Diagram (URL then stripped).
      if (!persistenceModule.hasPendingUrlLoad?.()) showNewDiagramModal();
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
          if (!persistenceModule.hasPendingUrlLoad?.()) showNewDiagramModal();   // don't stack over an Open-with / share load (A2)
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
      tbctx.activeTabId = id;
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
  const { tabs } = tbctx;
  const { persistence: persistenceModule, graph } = tbctx.modules;
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
            const stamp = dateSuffix();   // YYYY-MM-DD for the per-tab session backup filenames
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
              const safeName = sanitizeFilenamePart(tab.name, 'backup');
              triggerDownload(URL.createObjectURL(blob), `df_backup_${safeName}_${stamp}.json`);
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
  const { tabs } = tbctx;
  const { persistence: persistenceModule, graph, canvas: canvasModule } = tbctx.modules;
  const { markDirty } = tbctx;
  graph.on('change add remove', () => {
    // Capture "this is the FIRST real content edit on the active tab" BEFORE markDirty flips the flag. markDirty's
    // own isLoadingJSON guard means a load/restore/migration never counts; viewport + selection never reach here.
    const tab = tabs.find(t => t.id === tbctx.activeTabId);
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
  const { persistence: persistenceModule } = tbctx.modules;
  const { renameTab } = tbctx;
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

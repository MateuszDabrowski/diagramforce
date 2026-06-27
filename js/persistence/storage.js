// Storage engine — the localStorage layer: named browser saves
// (save/load/delete + TTL sweep), the quota/footprint guards, export-to-disk
// (single + selection + full backup), and the periodic backup-reminder overlay.
// Extracted from persistence.js (Phase 3, Slice 3). A pctx-only reader: live
// graph/canvas, the tab getters + save/import callbacks, and the cross-cutting
// helpers (sanitizeGraphJSON, checkVersionWarning, normalizeDiagramType,
// dateSuffix, triggerDownload) all come from the persistence runtime context —
// so it imports no other sub-module (acyclic).

import { showToast, showError, confirmModal, buildModal } from '../feedback.js?v=1.18.1';
import { pctx } from './context.js?v=1.18.1';
import { compactGraphForSave } from './json-pipeline.js?v=1.18.1';
import { countDiagramShapes } from '../util.js?v=1.18.1';

// localStorage key scheme + retention (formerly top-of-persistence consts).
export const NAMED_SAVE_PREFIX = 'sfdiag::save::';
const SAVE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const LAST_BACKUP_KEY    = 'sfdiag::lastBackupAt';     // ms of last export-to-disk
const LAST_REMINDER_KEY  = 'sfdiag::lastBackupReminderAt'; // ms the overlay was last shown
const FIRST_CONTENT_KEY  = 'sfdiag::firstContentAt';   // ms of earliest stored diagram/template

// --- Named saves ---

export function namedSave() {
  const { showSaveModal: showSaveModalCallback } = pctx;
  // Delegate to save modal
  if (showSaveModalCallback) {
    showSaveModalCallback();
    return;
  }
  // Fallback: single-tab save via prompt
  namedSaveSingle();
}

/** Save a single tab (active) — used as fallback and internally. */
function namedSaveSingle() {
  const { tabNameCb: getTabNameCallback, graph, canvas: canvasModule, diagramTypeCb: getDiagramTypeCallback, mappingModeCb: getMappingModeCallback } = pctx;
  const defaultName = getTabNameCallback ? getTabNameCallback() : 'My Diagram';
  const existing = prompt('Save diagram as:', defaultName);
  if (!existing?.trim()) return;
  const name = existing.trim();
  saveSingleTab(name, graph.toJSON(), canvasModule.getViewport(),
    getDiagramTypeCallback ? getDiagramTypeCallback() : 'architecture',
    getMappingModeCallback ? getMappingModeCallback() : false);
}

async function saveSingleTab(name, graphJSON, viewport, diagramType, mappingMode = false, silent = false) {
  const { appVersion: APP_VERSION, onNamedSave: onNamedSaveCallback } = pctx;
  const key = NAMED_SAVE_PREFIX + name;
  const alreadyExists = localStorage.getItem(key) !== null;
  if (alreadyExists && !silent) {
    const ok = await confirmModal({
      title: 'Overwrite existing save?',
      message: `A save named "${name}" already exists.`,
      okLabel: 'Overwrite',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return false;
  }

  const data = {
    name,
    timestamp: Date.now(),
    version: 1,
    appVersion: APP_VERSION,
    diagramType,
    mappingMode,
    // Drop reconstructed-on-load data (DataObject ports) to shrink the localStorage footprint.
    graph: compactGraphForSave(graphJSON),
    viewport,
  };
  try {
    localStorage.setItem(key, JSON.stringify(data));
    if (!silent) {
      if (onNamedSaveCallback) onNamedSaveCallback(name);
      showToast(`Saved to browser ✓`, 'success');
    }
    return true;
  } catch (err) {
    // Gap 22 (v1.12.0) — distinguish quota errors from generic failures so
    // the user gets actionable recovery advice. Browsers report quota as
    // either `QuotaExceededError`, the legacy code 22, or (Firefox) the
    // numeric code 1014. A few Safari builds set neither — fall through
    // to the human-readable message as a last-resort check.
    if (isQuotaError(err)) {
      showError('Browser storage full - export to JSON to keep your work safe, then delete older saves.');
    } else {
      showError('Save failed: ' + (err.message || 'unknown error'));
    }
    return false;
  }
}

/**
 * Gap 22 (v1.12.0) — shared quota-error sniffer. Browsers disagree on the
 * exact shape of a `QuotaExceededError` (name vs. legacy numeric code vs.
 * Firefox's 1014), so we cast a wide net. Exported so tabs.js can reuse
 * the same heuristic for the session-backup writer.
 */
export function isQuotaError(err) {
  if (!err) return false;
  return (
    err.name === 'QuotaExceededError' ||
    err.code === 22 ||
    err.code === 1014 ||
    /quota/i.test(err.message || '')
  );
}

/**
 * CR-7.1 / Gap 32 (v1.12.0) — proactive storage-pressure gauge.
 *
 * Browsers cap localStorage around 5-10 MB. Once it fills, the session
 * backup silently starts dropping writes (Gap 22 surfaces this, but
 * after the fact). This helper measures current usage *before* the
 * brick wall so we can warn the user while they still have room.
 *
 * Cheap on purpose: O(keys), not O(bytes). UTF-16 string `.length` is
 * O(1) and `getItem()` returns a reference (no copy), so the per-key
 * work is constant. Typical Diagramforce store has 10-30 keys, so the
 * whole loop completes well under a millisecond even at the 5 MB
 * ceiling — safe to call after every save.
 *
 * Returns approximate bytes consumed by the entire localStorage of the
 * current origin (UTF-16, so character count × 2). Note: shared across
 * any other apps on the same origin — fine for `diagramforce.mateuszdabrowski.pl`
 * but worth knowing if the app is ever co-hosted.
 */
export function getStorageFootprint() {
  let bytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key == null) continue;
    const val = localStorage.getItem(key) || '';
    bytes += (key.length + val.length) * 2;
  }
  return bytes;
}

/**
 * CR-7.1 / Gap 32 (v1.12.0) — warning threshold for the storage gauge.
 *
 * 4 MB. Chrome / Firefox cap localStorage at ~10 MB, Safari at ~5 MB —
 * so 4 MB is roughly 40 % of the comfortable ceiling and 80 % of the
 * tight one. That's late enough to avoid nuisance toasts on the first
 * named save, but early enough that the user has room to export + delete
 * before hitting the wall.
 */
export const STORAGE_WARNING_BYTES = 4_000_000;

/**
 * Quota-pressure relief valve (v1.17.0). Evict the OLDEST-by-modified browser archives that are **Drive-backed**
 * — i.e. redundant, because the same diagram is also in the user's Google Drive and can be reloaded — until the
 * footprint drops under `targetBytes`. Stops early if no redundant archives remain.
 *
 * NEVER touches a **browser-only** archive (no `driveFileId`): that archive is the diagram's ONLY copy, so
 * evicting it would be permanent data loss. When only those remain over the line the caller falls back to the
 * backup reminder instead. Returns the number evicted.
 *
 * `targetBytes` defaults to the warning threshold (proactive trim); pass 0 from a hard quota-error path to shed
 * every redundant archive before retrying the write.
 */
export function evictRedundantArchives(targetBytes = STORAGE_WARNING_BYTES) {
  if (getStorageFootprint() <= targetBytes) return 0;
  const candidates = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(NAMED_SAVE_PREFIX)) continue;
    try {
      const data = JSON.parse(localStorage.getItem(key));
      // Redundant = also in the user's Drive (has a driveFileId) → reloadable, so safe to shed. A browser-only
      // archive has no driveFileId and is NEVER a candidate (it would be permanent data loss).
      if (data && data.driveFileId) candidates.push({ key, ts: data.timestamp || 0 });
    } catch { /* skip corrupt entry */ }
  }
  candidates.sort((a, b) => a.ts - b.ts);   // oldest first
  let evicted = 0;
  for (const c of candidates) {
    if (getStorageFootprint() <= targetBytes) break;
    localStorage.removeItem(c.key);
    evicted++;
  }
  return evicted;
}

/**
 * Delete every browser archive that was saved from a given Drive file (matched on the stored `driveFileId`).
 * The reliable "browser" half of a go-together delete from the Drive library (which knows the fileId but has
 * no open-tab context). Returns the number removed.
 */
export function forgetArchivesForDriveFile(fileId) {
  if (!fileId) return 0;
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(NAMED_SAVE_PREFIX)) continue;
    try { if (JSON.parse(localStorage.getItem(key))?.driveFileId === fileId) keys.push(key); } catch { /* skip */ }
  }
  for (const key of keys) localStorage.removeItem(key);
  return keys.length;
}

/**
 * Ask the browser to mark this origin's storage bucket as **persistent** so it
 * is exempt from automatic eviction — both storage-pressure clearing and
 * Safari's idle (≈7-day no-interaction) eviction. Covers the whole origin
 * bucket, which includes `localStorage` (named saves, custom templates, theme).
 *
 * Best-effort and idempotent: returns immediately `true` if already persistent,
 * `null` if the API is unavailable or the call throws, otherwise the browser's
 * grant decision. Grant is heuristic — Chrome/Firefox favour installed-PWA /
 * bookmarked / engaged origins (Diagramforce is an installable PWA, so its
 * installed users are exactly the grant target); Safari rarely grants for
 * non-home-screen sites. Because the grant is never guaranteed, this is one
 * layer of defence — the JSON backup (Save/Load Templates) is the unconditional
 * one. Firefox may surface a permission prompt, so callers should invoke this
 * from a meaningful user gesture (e.g. right after saving a template) rather
 * than blindly on load.
 */
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export function getNamedSaves() {
  const saves = [];
  const now = Date.now();
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key?.startsWith(NAMED_SAVE_PREFIX)) continue;
    try {
      const data = JSON.parse(localStorage.getItem(key));
      const age = now - (data.timestamp || 0);
      if (age > SAVE_TTL_MS) {
        localStorage.removeItem(key);
        continue;
      }
      saves.push({
        key,
        name: data.name || key.replace(NAMED_SAVE_PREFIX, ''),
        timestamp: data.timestamp,
        expiresIn: SAVE_TTL_MS - age,
        diagramType: data.diagramType || 'architecture',
        appVersion: data.appVersion || null,
        shapes: countDiagramShapes(data.graph?.cells),   // nodes-only count for the storage-row "N elements"
        driveFileId: data.driveFileId || null,           // present → also in My Drive (recorded at archive time)
        driveDriveId: data.driveDriveId || null,         // present → the file lives on a team Shared Drive (item 5: "Shared Drive" chip)
        driveSharedSource: data.driveSharedSource || null, // present → a file shared TO you (item 5: shows the Shared File chip)
        bytes: (localStorage.getItem(key) || '').length, // serialized footprint, for the storage-weight column
      });
    } catch (err) {
      console.warn('SF Diagrams: Skipping corrupt save entry:', key, err);
    }
  }
  return saves.sort((a, b) => b.timestamp - a.timestamp);
}

export async function loadNamedSave(key) {
  const { checkVersionWarning, sanitizeGraphJSON, onImport: onImportCallback, normalizeDiagramType, graph, canvas: canvasModule } = pctx;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) { showError('Save not found.'); return false; }
    const data = JSON.parse(raw);
    const savedVer = data.appVersion || null;
    const name = data.name || key.replace(NAMED_SAVE_PREFIX, '');
    const ok = await checkVersionWarning(savedVer, name, data);
    if (!ok) return false;
    if (data?.graph) sanitizeGraphJSON(data.graph);
    if (onImportCallback && data?.graph) {
      const type = normalizeDiagramType(data.diagramType);
      // Item 1.3: pass the archived Drive linkage (driveFileId + driveSharedSource + driveCopies + baseline) so
      // the loaded tab re-marks "In My Drive" and shows the shares it had, instead of becoming a browser-only tab.
      // #7: data.group recreate-or-rejoins the tab group this diagram was saved from.
      onImportCallback(name, type, data.graph, data.viewport, data.mappingMode, data, data.group || null);
    } else if (data?.graph) {
      canvasModule.setLoadingJSON(true);
      try { graph.fromJSON(data.graph); } finally { canvasModule.setLoadingJSON(false); }
      if (data?.viewport) canvasModule.setViewport(data.viewport);
    }
    return true;
  } catch (err) {
    showError('Failed to load: ' + err.message);
    return false;
  }
}

export function deleteNamedSave(key) {
  localStorage.removeItem(key);
}


// --- Import / Export ---

/** Build the canonical single-diagram file object (drop-in export shape).
 *  `group` (#7): {name,icon,color} when the source tab was in a tab group, so re-importing this single file
 *  recreate-or-rejoins that group (additive + back-compat - older readers ignore it). */
function buildSingleDiagram(name, diagramType, graphJSON, viewport, mappingMode = false, group = null) {
  const { appVersion: APP_VERSION } = pctx;
  return {
    version: 1,
    appVersion: APP_VERSION,
    timestamp: Date.now(),
    title: name,
    diagramType,
    mappingMode,
    graph: graphJSON,
    viewport: viewport || null,
    ...(group && group.name ? { group } : {}),
  };
}

function downloadSingleDiagram(name, diagramType, graphJSON, viewport, mappingMode = false, group = null) {
  const { triggerDownload, dateSuffix } = pctx;
  const data = buildSingleDiagram(name, diagramType, graphJSON, viewport, mappingMode, group);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const safeName = (name || 'diagram').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'diagram';
  triggerDownload(URL.createObjectURL(blob), `df_${safeName}_${dateSuffix()}.json`);
}

/** Record a FULL backup (Select-All export, or the reminder overlay's Export) —
 *  resets the backup-reminder clock. Partial / single / templates-only exports
 *  deliberately do NOT call this (per the "scoped to Select-All / overlay"
 *  rule). */
function markBackedUp() {
  try { localStorage.setItem(LAST_BACKUP_KEY, String(Date.now())); } catch { /* ignore */ }
}

/** ms of the last full backup, or 0 if never (shown in the Export Manager). */
export function getLastBackupAt() {
  return +localStorage.getItem(LAST_BACKUP_KEY) || 0;
}

/** Public: mark a full backup as just completed (resets the reminder clock + the
 *  Export-Manager "Last full backup" advisory). For full-backup paths OUTSIDE
 *  exportSelection — notably the session version-mismatch backup in tabs.js, which
 *  downloads every saved session tab as a safety net before a reset. Without this,
 *  that backup wrote files but the advisory still read "No full backup yet". */
export function markFullBackup() { markBackedUp(); }

/** Read a named save's diagram payload by key, or null if missing/corrupt. */
export function readNamedSave(key) {
  try {
    const data = JSON.parse(localStorage.getItem(key));
    if (!data?.graph) return null;
    return {
      name: data.name || key.replace(NAMED_SAVE_PREFIX, ''),
      diagramType: data.diagramType || 'architecture',
      mappingMode: data.mappingMode || false,
      graph: data.graph,
      viewport: data.viewport || null,
    };
  } catch { return null; }
}

/**
 * Export a user-chosen selection (Export Manager). Format adapts to the count so
 * common cases stay drop-in compatible:
 *   - 1 diagram, no templates → single-diagram file (`df_<name>_<date>.json`)
 *   - templates only          → templates file (`df_templates_<date>.json`)
 *   - 2+ elements             → `diagramforce-export` bundle (`df_backup_<date>.json` when
 *                               markBackup, else `df_export_<date>.json`)
 * A "Templates" selection counts as ONE element (the whole library). Named saves
 * whose name matches an included open tab are deduped (the tab is the live copy).
 * `markBackup` (Select-All export, or the reminder overlay) resets the reminder
 * clock. Returns true on a successful download.
 */
export function exportSelection({ tabIds = [], saveKeys = [], includeTemplates = false, groups = [] } = {}, { markBackup = false } = {}) {
  const { getAllTabs: getAllTabsCallback, getTabGraph: getTabGraphCallback, getTabDiagramType: getTabDiagramTypeCallback, getTabViewport: getTabViewportCallback, getTabMappingMode: getTabMappingModeCallback, appVersion: APP_VERSION, templatesBackupApi, triggerDownload, dateSuffix } = pctx;
  try {
    const diagrams = [];
    const tabs = getAllTabsCallback ? getAllTabsCallback() : [];
    const tabById = new Map(tabs.map(t => [t.id, t]));
    // Group export (v1.16.0): caller passes the groups [{id,name,icon,color}] whose
    // tabs are being exported. Each diagram is tagged with its group NAME so import
    // can re-group it; the bundle carries the group metadata under `groups`.
    // For a single-tab export the caller passes no `groups`; fall back to the live group registry so we can still
    // resolve THIS tab's group meta (#7). `isGroupExport` stays gated on the explicit param (bundle format only).
    const allGroups = (groups && groups.length) ? groups : (pctx.getGroups ? (pctx.getGroups() || []) : []);
    const groupById = new Map(allGroups.map(g => [g.id, g]));
    const isGroupExport = groups.length > 0;
    for (const id of tabIds) {
      const t = tabById.get(id); if (!t) continue;
      const g = getTabGraphCallback ? getTabGraphCallback(id) : null;
      if (!g || !Array.isArray(g.cells) || g.cells.length === 0) continue; // skip empty drafts
      const grp = t.groupId ? groupById.get(t.groupId) : null;
      diagrams.push({
        name: t.name,
        diagramType: getTabDiagramTypeCallback ? getTabDiagramTypeCallback(id) : 'architecture',
        mappingMode: getTabMappingModeCallback ? getTabMappingModeCallback(id) : false,
        graph: g,
        viewport: getTabViewportCallback ? getTabViewportCallback(id) : null,
        appVersion: APP_VERSION,   // stamp so the diagram's version round-trips on re-import
        ...(grp ? { group: grp.name } : {}),
      });
    }
    const tabNames = new Set(diagrams.map(d => d.name));
    for (const key of saveKeys) {
      const d = readNamedSave(key);
      if (!d || tabNames.has(d.name)) continue; // dedup vs an included open tab
      diagrams.push(d);
    }
    // Shrink every exported graph by dropping reconstructed-on-load data (DataObject ports).
    // compactGraphForSave returns a new object, so the open tabs' live graphs stay untouched.
    for (const d of diagrams) { d.graph = compactGraphForSave(d.graph); }
    const templates = includeTemplates ? (templatesBackupApi?.getTemplates?.() || []) : [];

    if (diagrams.length === 0 && templates.length === 0) {
      showToast('Nothing selected to export.', 'warning');
      return false;
    }

    // A group export always uses the bundle format (even for one diagram) so the
    // `groups` metadata + per-diagram `group` tag survive — the single-diagram
    // shortcut would strip them.
    let ok = true;
    if (diagrams.length === 1 && templates.length === 0 && !isGroupExport) {
      const d = diagrams[0];
      // #7: if the single diagram is an open tab inside a group, stamp the group meta so re-import restores it.
      const srcTab = tabIds.length === 1 ? tabById.get(tabIds[0]) : null;
      const g = srcTab && srcTab.groupId ? groupById.get(srcTab.groupId) : null;
      const grpMeta = g ? { name: g.name, icon: g.icon || null, color: g.color || null } : null;
      downloadSingleDiagram(d.name, d.diagramType, d.graph, d.viewport, d.mappingMode, grpMeta);
      showToast(`Exported "${d.name}" ✓`, 'success');
    } else if (diagrams.length === 0 && templates.length > 0) {
      ok = !!(templatesBackupApi?.exportFn?.());   // templates-only → templates file
    } else {
      const payload = { schema: 'diagramforce-export', version: 1, appVersion: APP_VERSION, exportedAt: Date.now() };
      // Groups actually represented in the exported diagrams. `kind:'group'` tells
      // the importer to restore these as grouped tabs (vs the default browser-saves).
      const usedGroups = groups.filter(g => diagrams.some(d => d.group === g.name));
      if (usedGroups.length) {
        payload.kind = 'group';
        payload.groups = usedGroups.map(g => ({ name: g.name, icon: g.icon || null, color: g.color || null }));
      }
      if (diagrams.length) payload.diagrams = diagrams;
      if (templates.length) payload.templates = templates;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      // Group export → df_group_<name>_<date>; full backup (Select-All / reminder
      // overlay) → df_backup_<date>; a partial multi-select export → df_export_<date>.
      let prefix = `df_${markBackup ? 'backup' : 'export'}`;
      if (usedGroups.length === 1) {
        const safe = usedGroups[0].name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'group';
        prefix = `df_group_${safe}`;
      }
      triggerDownload(URL.createObjectURL(blob), `${prefix}_${dateSuffix()}.json`);
      const parts = [];
      if (diagrams.length) parts.push(`${diagrams.length} diagram${diagrams.length === 1 ? '' : 's'}`);
      if (templates.length) parts.push(`${templates.length} template${templates.length === 1 ? '' : 's'}`);
      if (usedGroups.length === 1) showToast(`Exported group "${usedGroups[0].name}" (${parts.join(' + ')}) ✓`, 'success');
      else showToast(`Exported ${parts.join(' + ')} ✓`, 'success');
    }
    if (ok && markBackup) markBackedUp();
    return ok;
  } catch (err) {
    console.warn('SF Diagrams: export failed', err);
    showToast('Could not export.', 'error');
    return false;
  }
}

/** Export EVERYTHING (all non-empty tabs + named saves + templates) as a full
 *  backup. Used by the reminder overlay's single "Export" button. */
export function exportEverything() {
  const { getAllTabs: getAllTabsCallback, getGroups: getGroupsCallback, templatesBackupApi } = pctx;
  const tabIds = (getAllTabsCallback ? getAllTabsCallback() : []).map(t => t.id);
  const saveKeys = getNamedSaves().map(s => s.key);
  const includeTemplates = (templatesBackupApi?.getTemplates?.() || []).length > 0;
  // Pass the current groups so the backup carries group metadata (name/icon/colour + per-diagram tag) - loading
  // it then restores grouped diagrams back into their groups (item 4). exportSelection only marks the bundle
  // kind:'group' when a grouped diagram is actually included, so a group-less backup stays a plain bundle.
  const groups = getGroupsCallback ? getGroupsCallback() : [];
  return exportSelection({ tabIds, saveKeys, includeTemplates, groups }, { markBackup: true });
}

/** True when there's at least one non-empty open tab or named browser save. */
function backupHasDiagrams() {
  const { getAllTabs: getAllTabsCallback, getTabGraph: getTabGraphCallback } = pctx;
  const tabs = getAllTabsCallback ? getAllTabsCallback() : [];
  const tabHasContent = tabs.some(t => {
    const g = getTabGraphCallback ? getTabGraphCallback(t.id) : null;
    return g && Array.isArray(g.cells) && g.cells.length > 0;
  });
  return tabHasContent || getNamedSaves().length > 0;
}

/** Earliest moment the user had any diagram/template — the reminder anchor when
 *  they've never backed up. Cached in localStorage; derived (for existing users
 *  with no recorded value) from the earliest named-save / template timestamp,
 *  falling back to now. */
function getFirstContentAt(templates) {
  let v = +localStorage.getItem(FIRST_CONTENT_KEY) || 0;
  if (v) return v;
  let earliest = Infinity;
  for (const s of getNamedSaves()) if (s.timestamp) earliest = Math.min(earliest, s.timestamp);
  for (const t of (templates || [])) if (t.createdAt) earliest = Math.min(earliest, t.createdAt);
  if (!Number.isFinite(earliest)) earliest = Date.now();
  try { localStorage.setItem(FIRST_CONTENT_KEY, String(earliest)); } catch { /* ignore */ }
  return earliest;
}

/**
 * Boot check (run deferred via setTimeout(0), like the storage-pressure gauge):
 * show the backup reminder if it's been ≥7 days since the last export — or, if
 * the user has never exported, ≥7 days since their first diagram/template — AND
 * a reminder hasn't already been shown in the last 7 days (so dismissing it
 * without backing up doesn't re-pop every boot). No-ops if there's nothing to
 * back up. Never throws (must not block boot).
 */
export function maybeShowBackupReminder() {
  const { templatesBackupApi } = pctx;
  try {
    const templates = templatesBackupApi?.getTemplates?.() || [];
    const hasTemplates = templates.length > 0;
    const hasDiagrams = backupHasDiagrams();
    if (!hasTemplates && !hasDiagrams) return; // nothing to lose → no nag
    // Syncing to Google Drive already keeps the work safe off this browser, so the export-to-JSON nag is
    // redundant for connected users — skip it for them. Non-connected users still get reminded.
    if (pctx.isDriveConnected?.()) return;

    const now = Date.now();
    const lastBackup   = +localStorage.getItem(LAST_BACKUP_KEY) || 0;
    const lastReminder = +localStorage.getItem(LAST_REMINDER_KEY) || 0;

    if (now - lastReminder < BACKUP_INTERVAL_MS) return; // cooldown
    const since = lastBackup || getFirstContentAt(templates);
    if (now - since < BACKUP_INTERVAL_MS) return;

    try { localStorage.setItem(LAST_REMINDER_KEY, String(now)); } catch { /* ignore */ }
    showBackupReminderModal();
  } catch { /* never block boot */ }
}

/** The "Backup your diagrams" overlay. Close (left) + a single Export (right)
 *  that exports EVERYTHING (all diagrams + templates) as a full backup. Export
 *  turns brand-green "✓ Exported!" on success and the overlay auto-closes ~1s
 *  later. */
function showBackupReminderModal() {
  if (document.querySelector('.df-backup-modal')) return; // already open

  // Connected users are skipped upstream, so the only Drive-aware state left is configured-but-not-connected:
  // offer "Connect to Google Drive" as a durable cloud alternative to the local JSON export.
  const canConnect = !!pctx.isDriveConfigured?.();
  const { body, footer, close } = buildModal({
    title: 'Backup your diagrams',
    className: 'df-backup-modal',
    zIndex: 3000,
    width: '480px',
    bodyStyle: 'padding:var(--spacing-md) var(--spacing-lg)',
    bodyHtml: '<p class="df-backup-modal__msg" style="margin:0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5"></p>',
    footerHtml: `${canConnect ? '<button class="df-close-confirm__btn df-backup-modal__connect" style="margin-right:auto"><svg class="df-toolbar__icon" aria-hidden="true"><use href="#icon-gdrive"></use></svg>Connect Google Drive</button>' : ''}<button class="df-close-confirm__btn df-close-confirm__btn--save df-backup-modal__btn"${canConnect ? '' : ' style="margin-left:auto"'}>Export</button>`,
  });
  // textContent (not innerHTML) for the body copy — no interpolation risk.
  body.querySelector('.df-backup-modal__msg').textContent = canConnect
    ? "You've been using Diagramforce for a while! Since this app has no backend, your diagrams live in this browser, which can clear its cache. Connect Google Drive to keep them safe in the cloud, or download a JSON backup file to your computer."
    : "You've been using Diagramforce for a while! Since this app has no backend, your templates and diagrams live entirely in this browser. To ensure you never lose your work if your browser clears its cache, download a JSON backup file to your computer.";

  // Connect to Google Drive — durable cloud backup; sign in, then close (saving happens via the Save Manager).
  footer.querySelector('.df-backup-modal__connect')?.addEventListener('click', async () => {
    try { await pctx.driveSignIn?.(); } catch { /* the sign-in flow surfaces its own errors */ }
    close();
  });

  const exportBtn = footer.querySelector('.df-backup-modal__btn');
  exportBtn.addEventListener('click', () => {
    if (exportBtn.classList.contains('is-backed')) return;
    if (!exportEverything()) return; // nothing exported — leave as-is
    exportBtn.classList.add('is-backed');
    exportBtn.textContent = '✓ Exported!';
    exportBtn.disabled = true;
    setTimeout(close, 1000); // let the green state show for a beat, then close
  });
}

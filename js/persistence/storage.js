// Storage engine — the localStorage layer: named browser saves
// (save/load/delete + TTL sweep), the quota/footprint guards, export-to-disk
// (single + selection + full backup), and the periodic backup-reminder overlay.
// Extracted from persistence.js (Phase 3, Slice 3). A pctx-only reader: live
// graph/canvas, the tab getters + save/import callbacks, and the cross-cutting
// helpers (sanitizeGraphJSON, checkVersionWarning, normalizeDiagramType,
// dateSuffix, triggerDownload) all come from the persistence runtime context —
// so it imports no other sub-module (acyclic).

import { showToast, showError, confirmModal, buildModal } from '../feedback.js?v=1.15.6';
import { pctx } from './context.js?v=1.15.6';
import { compactGraphForSave } from './json-pipeline.js?v=1.15.6';

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

/** Save multiple tabs by id with a name prefix. */
export async function saveMultipleTabs(tabIds, namePrefix) {
  const { getAllTabs: getAllTabsCallback, getTabGraph: getTabGraphCallback, getTabViewport: getTabViewportCallback, getTabDiagramType: getTabDiagramTypeCallback, getTabMappingMode: getTabMappingModeCallback, onSaveComplete: onSaveCompleteCallback } = pctx;
  if (!getAllTabsCallback || !getTabGraphCallback) return;
  const allTabs = getAllTabsCallback();
  let savedCount = 0;
  const silent = tabIds.length > 1;
  for (const tabId of tabIds) {
    const tab = allTabs.find(t => t.id === tabId);
    if (!tab) continue;
    const graphJSON = getTabGraphCallback(tabId);
    const viewport = getTabViewportCallback ? getTabViewportCallback(tabId) : null;
    const diagramType = getTabDiagramTypeCallback ? getTabDiagramTypeCallback(tabId) : 'architecture';
    const mappingMode = getTabMappingModeCallback ? getTabMappingModeCallback(tabId) : false;
    if (!graphJSON) continue;
    // Use the tab name as save name (with date suffix)
    const saveName = namePrefix
      ? `${namePrefix} — ${tab.name}`
      : tab.name;
    const ok = await saveSingleTab(saveName, graphJSON, viewport, diagramType, mappingMode, silent);
    if (ok) savedCount++;
  }
  if (savedCount > 0 && onSaveCompleteCallback) {
    onSaveCompleteCallback('browser');
  }
  // For multi-tab saves, emit a single summary toast (single-tab path
  // already gets its own toast from saveSingleTab in non-silent mode).
  if (silent && savedCount > 0) {
    showToast(`Saved ${savedCount} ${savedCount === 1 ? 'tab' : 'tabs'} to browser ✓`, 'success');
  }
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
      showError('Browser storage full — export to JSON to keep your work safe, then delete older saves.');
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
      onImportCallback(name, type, data.graph, data.viewport, data.mappingMode);
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

/** Build the canonical single-diagram file object (drop-in export shape). */
function buildSingleDiagram(name, diagramType, graphJSON, viewport, mappingMode = false) {
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
  };
}

function downloadSingleDiagram(name, diagramType, graphJSON, viewport, mappingMode = false) {
  const { triggerDownload, dateSuffix } = pctx;
  const data = buildSingleDiagram(name, diagramType, graphJSON, viewport, mappingMode);
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
export function exportSelection({ tabIds = [], saveKeys = [], includeTemplates = false } = {}, { markBackup = false } = {}) {
  const { getAllTabs: getAllTabsCallback, getTabGraph: getTabGraphCallback, getTabDiagramType: getTabDiagramTypeCallback, getTabViewport: getTabViewportCallback, getTabMappingMode: getTabMappingModeCallback, appVersion: APP_VERSION, templatesBackupApi, triggerDownload, dateSuffix } = pctx;
  try {
    const diagrams = [];
    const tabs = getAllTabsCallback ? getAllTabsCallback() : [];
    const tabById = new Map(tabs.map(t => [t.id, t]));
    for (const id of tabIds) {
      const t = tabById.get(id); if (!t) continue;
      const g = getTabGraphCallback ? getTabGraphCallback(id) : null;
      if (!g || !Array.isArray(g.cells) || g.cells.length === 0) continue; // skip empty drafts
      diagrams.push({
        name: t.name,
        diagramType: getTabDiagramTypeCallback ? getTabDiagramTypeCallback(id) : 'architecture',
        mappingMode: getTabMappingModeCallback ? getTabMappingModeCallback(id) : false,
        graph: g,
        viewport: getTabViewportCallback ? getTabViewportCallback(id) : null,
        appVersion: APP_VERSION,   // stamp so the diagram's version round-trips on re-import
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

    let ok = true;
    if (diagrams.length === 1 && templates.length === 0) {
      const d = diagrams[0];
      downloadSingleDiagram(d.name, d.diagramType, d.graph, d.viewport, d.mappingMode);
      showToast(`Exported "${d.name}" ✓`, 'success');
    } else if (diagrams.length === 0 && templates.length > 0) {
      ok = !!(templatesBackupApi?.exportFn?.());   // templates-only → templates file
    } else {
      const payload = { schema: 'diagramforce-export', version: 1, appVersion: APP_VERSION, exportedAt: Date.now() };
      if (diagrams.length) payload.diagrams = diagrams;
      if (templates.length) payload.templates = templates;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      // Full backup (Select-All / reminder overlay) → df_backup_<date>; a partial
      // multi-select export → df_export_<date>. markBackup distinguishes the two.
      triggerDownload(URL.createObjectURL(blob), `df_${markBackup ? 'backup' : 'export'}_${dateSuffix()}.json`);
      const parts = [];
      if (diagrams.length) parts.push(`${diagrams.length} diagram${diagrams.length === 1 ? '' : 's'}`);
      if (templates.length) parts.push(`${templates.length} template${templates.length === 1 ? '' : 's'}`);
      showToast(`Exported ${parts.join(' + ')} ✓`, 'success');
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
  const { getAllTabs: getAllTabsCallback, templatesBackupApi } = pctx;
  const tabIds = (getAllTabsCallback ? getAllTabsCallback() : []).map(t => t.id);
  const saveKeys = getNamedSaves().map(s => s.key);
  const includeTemplates = (templatesBackupApi?.getTemplates?.() || []).length > 0;
  return exportSelection({ tabIds, saveKeys, includeTemplates }, { markBackup: true });
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

  const { body, footer, close } = buildModal({
    title: 'Backup your diagrams',
    className: 'df-backup-modal',
    zIndex: 3000,
    width: '480px',
    bodyStyle: 'padding:var(--spacing-md) var(--spacing-lg)',
    bodyHtml: '<p class="df-backup-modal__msg" style="margin:0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5"></p>',
    footerHtml: '<button class="df-close-confirm__btn df-close-confirm__btn--save df-backup-modal__btn" style="margin-left:auto">Export</button>',
  });
  // textContent (not innerHTML) for the body copy — no interpolation risk.
  body.querySelector('.df-backup-modal__msg').textContent =
    "You've been using Diagramforce for a while! Since this app has no backend, your templates and diagrams live entirely in this browser. To ensure you never lose your work if your browser clears its cache, export a backup to your computer.";

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

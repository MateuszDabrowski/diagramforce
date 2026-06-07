// Persistence — named saves, JSON import/export, PNG/GIF export
// (Auto-save is handled by the tabs module now.)

import { showToast, showError, confirmModal, trapFocus, buildModal } from './feedback.js?v=1.15.3';
import { escHtml, compareSemver, normalizeDateSuffix } from './util.js?v=1.15.3';
import { pctx } from './persistence/context.js?v=1.15.3';

// ── Facade (Phase 3, Slice 1): image export + share orchestration now live in
// sub-modules; re-exported here so the public surface is unchanged. ──
export { exportWEBP, exportPNG, isGifEncodingInProgress, setGifEncodingListener, exportGIF } from './persistence/image-export.js?v=1.15.3';
export { shareAsURL, loadFromURL } from './persistence/share-orchestration.js?v=1.15.3';
// versioning: contentSignature + classifyVersionDiff are public (tests/templates use them);
// checkVersionWarning is imported for internal use (loadNamedSave/loadJSONText) + pctx wiring.
import { contentSignature, classifyVersionDiff, checkVersionWarning } from './persistence/versioning.js?v=1.15.3';
export { contentSignature, classifyVersionDiff };
// json-pipeline: sanitizeGraphJSON is public AND used internally (loadNamedSave);
// importJSON / pasteJSON are public entry points.
import { sanitizeGraphJSON, importJSON, pasteJSON } from './persistence/json-pipeline.js?v=1.15.3';
export { sanitizeGraphJSON, importJSON, pasteJSON };
// storage: getNamedSaves/readNamedSave/NAMED_SAVE_PREFIX feed pctx (read by
// json-pipeline); the rest are the public storage surface.
import { getNamedSaves, readNamedSave, NAMED_SAVE_PREFIX } from './persistence/storage.js?v=1.15.3';
export {
  namedSave, saveMultipleTabs, isQuotaError, getStorageFootprint, STORAGE_WARNING_BYTES,
  requestPersistentStorage, getNamedSaves, loadNamedSave, deleteNamedSave, getLastBackupAt,
  exportSelection, exportEverything, maybeShowBackupReminder, markFullBackup,
} from './persistence/storage.js?v=1.15.3';

let graph, paper, canvasModule;
const APP_VERSION = '1.15.3';
export { APP_VERSION };
// Wire the version into pctx at module-eval (it's a constant) so the extracted
// version helpers work even before init() runs — e.g. unit tests calling
// classifyVersionDiff through the facade.
pctx.appVersion = APP_VERSION;


/** Map LLM-friendly diagram type aliases to the internal names used by the app. */
export function normalizeDiagramType(type) {
  const aliases = {
    organisation: 'org',
    organization: 'org',
    data: 'datamodel',
    datamodel: 'datamodel',
    datamapping: 'datamapping',
    mapping: 'datamapping',
    architecture: 'architecture',
    process: 'process',
    sequence: 'sequence',
    gantt: 'gantt',
    org: 'org',
  };
  return aliases[String(type || '').toLowerCase()] || 'architecture';
}

// Callback invoked after a successful named save (used by tabs to update tab name)
let onNamedSaveCallback = null;
export function onNamedSave(cb) { onNamedSaveCallback = cb; pctx.onNamedSave = cb; }

// Callback to mark tab as saved (set by tabs module)
let onSaveCompleteCallback = null;
export function onSaveComplete(cb) { onSaveCompleteCallback = cb; pctx.onSaveComplete = cb; }

// Callback for importing into a new tab (set by tabs module)
let onImportCallback = null;
export function setImportHandler(cb) { onImportCallback = cb; pctx.onImport = cb; }

// Callback to get current diagram type
let getDiagramTypeCallback = null;
export function setDiagramTypeGetter(cb) { getDiagramTypeCallback = cb; pctx.diagramTypeCb = cb; }

// Callback to get current tab name (used as default save name)
let getTabNameCallback = null;
export function setTabNameGetter(cb) { getTabNameCallback = cb; pctx.tabNameCb = cb; }

// Callback to get all open tabs (set by tabs module)
let getAllTabsCallback = null;
export function setAllTabsGetter(cb) { getAllTabsCallback = cb; pctx.getAllTabs = cb; }

// Callback to get a specific tab's graph JSON
let getTabGraphCallback = null;
export function setTabGraphGetter(cb) { getTabGraphCallback = cb; pctx.getTabGraph = cb; }

// Callback to get a specific tab's viewport
let getTabViewportCallback = null;
export function setTabViewportGetter(cb) { getTabViewportCallback = cb; pctx.getTabViewport = cb; }

// Callback to get a specific tab's diagram type
let getTabDiagramTypeCallback = null;
export function setTabDiagramTypeGetter(cb) { getTabDiagramTypeCallback = cb; pctx.getTabDiagramType = cb; }

// Callback to get a specific tab's Data Cloud mapping mode (v1.15.0)
let getTabMappingModeCallback = null;
export function setTabMappingModeGetter(cb) { getTabMappingModeCallback = cb; pctx.getTabMappingMode = cb; }

// Callback to get the ACTIVE tab's mapping mode (used by the share + single-save builders)
let getActiveMappingModeCallback = null;
export function setActiveMappingModeGetter(cb) { getActiveMappingModeCallback = cb; pctx.mappingModeCb = cb; }

// Templates module API (injected to avoid a circular import — templates.js
// imports persistence.js, not vice versa). { getTemplates, exportFn }.
let templatesBackupApi = null;
export function setTemplatesBackupApi(api) { templatesBackupApi = api; pctx.templatesBackupApi = api; }

// Callback to show save modal (set by toolbar)
let showSaveModalCallback = null;
export function setShowSaveModal(cb) { showSaveModalCallback = cb; pctx.showSaveModal = cb; }

// Callback to show the Load-from-Browser modal (set by toolbar) — used after a
// bundle import to reveal where the restored diagrams landed.
let showLoadModalCallback = null;
export function setShowLoadModal(cb) { showLoadModalCallback = cb; pctx.showLoadModal = cb; }

export function init(_graph, _paper, _canvas) {
  graph = _graph;
  paper = _paper;
  canvasModule = _canvas;
  // Wire the shared runtime context the extracted sub-modules read (Phase 3).
  pctx.graph = _graph;
  pctx.paper = _paper;
  pctx.canvas = _canvas;
  pctx.triggerDownload = triggerDownload;
  pctx.dateSuffix = dateSuffix;
  pctx.sanitizeGraphJSON = sanitizeGraphJSON;
  pctx.normalizeDiagramType = normalizeDiagramType;
  pctx.checkVersionWarning = checkVersionWarning;
  pctx.namedSavePrefix = NAMED_SAVE_PREFIX;
  pctx.getNamedSaves = getNamedSaves;
  pctx.readNamedSave = readNamedSave;
}

/** YYYY-MM-DD date string — the single source for every automatic date suffix
 *  in the app (export filenames, single-diagram/PNG/SVG/GIF downloads, the
 *  export bundle). Readable and ISO-ordered. */
export function dateSuffix() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Stable (sorted-key) stringify — order-independent, so two structurally
 *  identical objects hash the same. Backs import dedup. */

// newDiagram is now a thin wrapper — tabs module handles the actual logic.
// This keeps backward compat for keyboard.js (Ctrl+N).
let newDiagramHandler = null;
export function setNewDiagramHandler(fn) { newDiagramHandler = fn; }
export async function newDiagram() {
  if (newDiagramHandler) { newDiagramHandler(); return; }
  // Fallback (no tabs module)
  if (graph.getCells().length > 0) {
    const ok = await confirmModal({
      title: 'Start a new diagram?',
      message: 'Unsaved changes will be lost.',
      okLabel: 'Start new',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
  }
  graph.clear();
  canvasModule.setViewport({ zoom: 1, translate: { tx: 0, ty: 0 } });
}


export function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

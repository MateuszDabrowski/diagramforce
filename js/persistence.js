// Persistence — named saves, JSON import/export, PNG/GIF export
// (Auto-save is handled by the tabs module now.)

import { showToast, showError, confirmModal, trapFocus, buildModal } from './feedback.js?v=1.22.1';
import { escHtml, compareSemver, normalizeDateSuffix } from './util.js?v=1.22.1';
import { pctx } from './persistence/context.js?v=1.22.1';
export { assertPctxWired } from './persistence/context.js?v=1.22.1';   // S8 wiring self-check (app.js calls it at end of init)

// ── Facade (Phase 3, Slice 1): image export + share orchestration now live in
// sub-modules; re-exported here so the public surface is unchanged. ──
export { exportWEBP, exportPNG, exportSVG, copyCellsAsPng, isGifEncodingInProgress, setGifEncodingListener, exportGIF } from './persistence/image-export.js?v=1.22.1';
export { shareAsURL, copyShareURL, shareGroupToDrive, loadFromURL, hasPendingUrlLoad } from './persistence/share-orchestration.js?v=1.22.1';
// remote-store: user-owned cloud storage (Google Drive). Reads pctx like the other
// sub-modules; no separate init needed. Phase 1 = saveToDrive / openFromDrive.
export { ensureDriveConfig, isDriveConfigured, isDriveConnected, isSignedIn, saveToDrive, openFromDrive, enableAutosync, disableAutosync, disconnectDrive, isAutosyncOn, signIn, notifyDriveChange, flushDriveSave, saveTabNow, syncNow, getDriveStatus, setDriveStatusListener, setLoginHint, hydrateTabDrive, adoptDriveMetaIntoTab, saveTabsToDrive, shareActiveScoped, shareActiveEditable, activeShareCopies, activeShareStatus, listActiveShareGrants, removeGrant, removeShare, resolveCopyConflict, resolveActiveConflict, activeHasDriveFile, activeIsImported, reopenLatestFromDrive, loadDriveRef, openGroupFromLink, publishTabsToSharedDrive, listMyDiagrams, openDriveDiagram, cloneSharedToMyDrive, forkSharedViewOnEdit, deleteDiagramFromDrive, renameDriveMaster, listRevisions, viewRevision, restoreRevision, pinRevision, readRevision, pullTemplates, pushTemplates, reconcileTabDriveLinks } from './persistence/remote-store.js?v=1.22.1';
// versioning: contentSignature + classifyVersionDiff are public (tests/templates use them);
// checkVersionWarning is imported for internal use (loadNamedSave/loadJSONText) + pctx wiring.
// Local bindings (the re-export above doesn't create them) so init() can wire the Drive-aware backup gate.
import { isDriveConnected as _isDriveConnected, isDriveConfigured as _isDriveConfigured, signIn as _driveSignIn } from './persistence/remote-store.js?v=1.22.1';
import { contentSignature, classifyVersionDiff, checkVersionWarning } from './persistence/versioning.js?v=1.22.1';
export { contentSignature, classifyVersionDiff };
// Multi-load version-warning coalescing (item 3): wrap a Load-Selected loop in these so a shared old version
// prompts once, not per file.
export { beginVersionWarningBatch, endVersionWarningBatch } from './persistence/versioning.js?v=1.22.1';
// json-pipeline: sanitizeGraphJSON is public AND used internally (loadNamedSave);
// importJSON is a public entry point; loadJSONText + describePastedJSON back the unified Load-from-Paste modal.
import { sanitizeGraphJSON, compactGraphForSave, importJSON, loadJSONText, describePastedJSON } from './persistence/json-pipeline.js?v=1.22.1';
import { importFlowSource, looksLikeFlowXml, looksLikeFlowJson, stripHttpPreamble } from './persistence/flow-import.js?v=1.22.1';
import { buildDiagram as buildMappingDiagram, fromConnectPayload, parseMappingXmlAll,
  looksLikeMappingJson as _looksLikeMappingJson, looksLikeMappingXml } from './persistence/mapping-convert.js?v=1.22.1';
import { looksLikeDataGraphJson as _looksLikeDataGraphJson, parseDataGraph, buildDataGraphDiagram } from './persistence/datagraph-convert.js?v=1.22.1';
export { sanitizeGraphJSON, compactGraphForSave, importJSON, loadJSONText, describePastedJSON };
export { looksLikeFlowXml, looksLikeFlowJson };

// Salesforce Flow import (1.21.0): convert real Flow metadata (Tooling API JSON or a .flow-meta.xml
// source file) into a `flow` diagram, then load it through the SAME loadJSONText path every other import
// uses - so the result is sanitised, version-checked and tab-managed identically. The converter's
// warnings are surfaced to the user rather than swallowed: they are the only place it can say what it
// could not represent faithfully (an element type with no dedicated shape, a flow with no entry point,
// connectors pointing at deleted elements), and the validator cannot tell you any of that.
export function isFlowSourceText(text) {
  return looksLikeFlowXml(text) || looksLikeFlowJson(text);
}
export async function loadFlowSource(text, name) {
  let diagram, stats;
  // `name` is the dropped file's base name; for a .flow-meta.xml it is the ONLY place the flow's API name
  // exists, so hand it to the converter rather than using it for the tab title alone.
  try { ({ diagram, stats } = importFlowSource(text, { fileName: name || null })); }
  catch (e) { showToast(e.message || 'Could not read that Salesforce Flow.', 'error'); return false; }
  if (name) diagram.title = diagram.title || name;
  const ok = await loadJSONText(JSON.stringify(diagram), diagram.title);
  if (!ok) return false;
  const n = stats.warnings.length;
  if (n) showToast(`Flow imported with ${n} note${n === 1 ? '' : 's'}: ${stats.warnings[0]}${n > 1 ? ` (+${n - 1} more)` : ''}`, 'warning', { duration: 9000 });
  else showToast(`Imported ${stats.elements} elements and ${stats.links} connectors.`, 'success');
  return true;
}
// Data Cloud field mappings (1.22.0): the ONE-GET route into a `datamapping` diagram.
//
//   /services/data/vXX.0/ssot/data-model-object-mappings?dmoDeveloperName=ssot__Individual__dlm
//
// Why this exists when the CLI already converts mappings: that path needs a bulk metadata RETRIEVE, so it
// serves people who can authenticate the Salesforce CLI. This one is a single GET a user can run from
// Workbench's REST Explorer, which authenticates by browser OAuth and therefore works in orgs where the CLI's
// connected app is blocked. Being DMO-scoped it also needs no selection step - asking for one DMO IS the
// diagram. It is exactly the shape the Flow importer already takes, and it makes mappings behave the same way.
//
// It costs the two enrichments the metadata path carries: the Connect payload has no `isSourceFormula` and no
// `filterApplied`, so there are no Formula companion cards and no Expression / Rule values. Measured across a
// real org that is ~167 of 3661 field rows, about 5%. The toast says so rather than letting the user discover
// it by noticing something absent.
// Wrapped rather than re-exported, to strip Workbench's HTTP preamble first. Its REST Explorer renders the
// whole exchange - "Raw Response", the status line, a dozen headers - above the body, and people copy the lot.
// Since Workbench IS the route this feature exists for, requiring a hand-trimmed payload would break it for
// exactly the audience it serves. flow-import.js already solved this; reuse it rather than teaching the shared
// converter about an HTTP client it should know nothing about.
export const looksLikeMappingJson = (text) => _looksLikeMappingJson(stripHttpPreamble(String(text || '')))
  || looksLikeMappingXml(text);
/** A Data Cloud DATA GRAPH - either the `/ssot/data-graphs/<name>` definition or the preview payload copied
 *  out of the Data Cloud UI. See js/persistence/datagraph-convert.js for the two shapes and why both matter. */
export const looksLikeDataGraphJson = (text) => _looksLikeDataGraphJson(stripHttpPreamble(String(text || '')));

export async function loadDataGraph(text, name) {
  let built;
  try {
    const parsed = parseDataGraph(JSON.parse(stripHttpPreamble(String(text || ''))));
    built = buildDataGraphDiagram(parsed, { appVersion: pctx.appVersion, title: name || null });
  } catch (e) { showToast(e.message || 'Could not read that data graph.', 'error'); return false; }
  const ok = await loadJSONText(JSON.stringify(built.diagram), built.diagram.title);
  if (!ok) return false;
  const s = built.stats;
  // Say what the SOURCE could carry rather than a fixed caveat - a preview genuinely has less in it, and the
  // reader should know the labels they are looking at were derived rather than given.
  showToast(s.kind === 'preview'
    ? `${s.objects} objects, ${s.depth} levels. A preview payload has no labels or key flags - names are derived from the API names.`
    : `${s.objects} objects, ${s.depth} levels, from the data graph definition.`, 'success');
  return true;
}

export async function loadDataCloudMapping(text, name) {
  let diagram, stats;
  try {
    // XML or Connect JSON. The XML is the ObjectSourceTargetMap METADATA, and it is the only source that
    // carries formulas and filters - no Connect or Tooling endpoint exposes `isSourceFormula` at all, which is
    // why pasting the retrieved file is worth offering rather than only the one-GET response.
    const raw = String(text || '');
    const maps = looksLikeMappingXml(raw)
      ? parseMappingXmlAll(raw)
      : fromConnectPayload(JSON.parse(stripHttpPreamble(raw)));
    ({ diagram, stats } = buildMappingDiagram(maps, { title: name || null, appVersion: pctx.appVersion }));
  } catch (e) { showToast(e.message || 'Could not read those Data Cloud mappings.', 'error'); return false; }
  const ok = await loadJSONText(JSON.stringify(diagram), diagram.title);
  if (!ok) return false;
  // Say what the SOURCE could carry, not a fixed caveat: the XML has formulas and filters, the Connect
  // response cannot express either, and telling an XML user to "retrieve the metadata" they just pasted is
  // nonsense.
  const rich = stats.formulas > 0 || stats.filtered > 0 || looksLikeMappingXml(text);
  showToast(`Imported ${stats.fieldLinks} field mappings across ${stats.objectMaps} object mappings`
    + (rich
      ? `${stats.formulas ? `, ${stats.formulas} formula-sourced` : ''}${stats.filtered ? `, ${stats.filtered} filtered` : ''}.`
      : '. Formulas and filters are not in a Connect API response - paste the ObjectSourceTargetMap metadata for those.'),
  'success', { duration: 9000 });
  return true;
}

// storage: getNamedSaves/readNamedSave/NAMED_SAVE_PREFIX feed pctx (read by
// json-pipeline); the rest are the public storage surface.
import { getNamedSaves, readNamedSave, NAMED_SAVE_PREFIX } from './persistence/storage.js?v=1.22.1';
export {
  namedSave, isQuotaError, getStorageFootprint, getStorageBreakdown, STORAGE_WARNING_BYTES, evictRedundantArchives, forgetArchivesForDriveFile,
  requestPersistentStorage, getNamedSaves, loadNamedSave, deleteNamedSave, getLastBackupAt,
  exportSelection, exportEverything, maybeShowBackupReminder, markFullBackup,
} from './persistence/storage.js?v=1.22.1';

let graph, paper, canvasModule;
const APP_VERSION = '1.22.1';
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
    flow: 'flow',
    salesforceflow: 'flow',
    flowbuilder: 'flow',
    sfflow: 'flow',
  };
  return aliases[String(type || '').toLowerCase()] || 'architecture';
}

// Callback invoked after a successful named save (used by tabs to update tab name)
let onNamedSaveCallback = null;
export function onNamedSave(cb) { onNamedSaveCallback = cb; pctx.onNamedSave = cb; }

// Callback to mark tab as saved (set by tabs module)
let onSaveCompleteCallback = null;
export function onSaveComplete(cb) { onSaveCompleteCallback = cb; pctx.onSaveComplete = cb; }
// Per-tab Drive-saved hook: remote-store fires this with the tab id whenever that tab's content reaches Drive
// (or is confirmed already in sync), so tabs.js can clear the UI dirty dot for THAT tab - not just the active one.
export function onDriveTabSaved(cb) { pctx.onDriveTabSaved = cb; }

// Callback for importing into a new tab (set by tabs module)
let onImportCallback = null;
export function setImportHandler(cb) { onImportCallback = cb; pctx.onImport = cb; }
export function setReplaceActiveHandler(cb) { pctx.onReplaceActive = cb; }

// Callback for importing a `kind:'group'` bundle (set by tabs module): recreates
// the group(s) and opens each diagram as a tab inside. (groupMetas, diagrams) => void
let onImportGroupCallback = null;
export function setImportGroupHandler(cb) { onImportGroupCallback = cb; pctx.onImportGroup = cb; }

// Callback to get current diagram type
let getDiagramTypeCallback = null;
export function setDiagramTypeGetter(cb) { getDiagramTypeCallback = cb; pctx.diagramTypeCb = cb; }

// Callback to get current tab name (used as default save name)
let getTabNameCallback = null;
export function setTabNameGetter(cb) { getTabNameCallback = cb; pctx.tabNameCb = cb; }

// Callback to get the active tab id (remote-store keys driveFileId per tab).
export function setActiveTabIdGetter(cb) { pctx.activeTabIdCb = cb; }

// Callback to get the current tab groups ([{id,name,icon,color}]) — so a full backup carries group data.
export function setGroupsGetter(cb) { pctx.getGroups = cb; }

// Callback for remote-store to mirror Drive sync state into per-tab meta (survives reload).
export function setPersistTabDrive(cb) { pctx.persistTabDrive = cb; }

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
export function setThumbnailRenderer(fn) { pctx.renderThumbnail = fn; }   // templates.renderTemplateThumbnail — the Review modal's diff-highlighted preview cards

// Callback to show save modal (set by toolbar)
let showSaveModalCallback = null;
export function setShowSaveModal(cb) { showSaveModalCallback = cb; pctx.showSaveModal = cb; }

// Callback to show the Load-from-Browser modal (set by toolbar) — used after a
// bundle import to reveal where the restored diagrams landed.
let showLoadModalCallback = null;
export function setShowLoadModal(cb) { showLoadModalCallback = cb; pctx.showLoadModal = cb; }

// Callback to open the "Your Drive diagrams" library modal (set by toolbar) — invoked by tabs.js's
// New-Diagram modal so a fresh device can pull the user's masters from Drive.
export function setShowDriveLibrary(cb) { pctx.showDriveLibrary = cb; }
export function openDriveLibrary() { pctx.showDriveLibrary?.(); }

// Openers the New-Diagram modal's "Open" tab calls (toolbar owns these modals; tabs.js stays acyclic).
export function openLoadModal() { pctx.showLoadModal?.(); }
export function setShowPasteImport(cb) { pctx.showPasteImport = cb; }
export function openPasteImport() { pctx.showPasteImport?.(); }

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
  pctx.compactGraphForSave = compactGraphForSave;   // so Drive saves match every other persistence path (compacted)
  pctx.normalizeDiagramType = normalizeDiagramType;
  pctx.checkVersionWarning = checkVersionWarning;
  pctx.namedSavePrefix = NAMED_SAVE_PREFIX;
  pctx.getNamedSaves = getNamedSaves;
  pctx.readNamedSave = readNamedSave;
  // Drive-aware backup gate (storage.js reads these): skip the export-to-JSON nag when synced; offer Connect.
  pctx.isDriveConnected = _isDriveConnected;
  pctx.isDriveConfigured = _isDriveConfigured;
  pctx.driveSignIn = _driveSignIn;
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

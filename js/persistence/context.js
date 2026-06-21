// Shared runtime context for the persistence sub-modules (image-export,
// share-orchestration, ...). persistence.js is the single WRITER — it wires
// this object in init() (state refs + callback handles + cross-cutting helpers)
// — and the sub-modules are READERS. Centralising the live references here keeps
// the dependency graph acyclic: persistence.js imports its sub-modules (to
// re-export them); the sub-modules import only this context, never persistence.js
// back.
export const pctx = {
  // Live JointJS references (set in persistence.init()).
  graph: null,
  paper: null,
  canvas: null,
  appVersion: null,        // wired from persistence's single-source APP_VERSION

  // SYNC CONTRACT — there is deliberately NO isLoadingJSON slot in pctx. The
  //   JSON-load guard is owned by the CANVAS domain (canvas.js `_isLoadingJSON`
  //   ↔ `cctx.isLoadingJSON`, dual-written in setLoadingJSON). Persistence DRIVES
  //   it: json-pipeline.js / storage.js wrap graph.fromJSON() in
  //   canvasModule.setLoadingJSON(true)…(false). Do NOT add a parallel pctx copy
  //   or an event bus — see canvas/context.js for the full contract.

  // Registered callbacks (raw handles — may be null until the owner wires them).
  tabNameCb: null,         // () => string  — active tab / diagram name
  diagramTypeCb: null,     // () => string  — active diagram type
  activeTabIdCb: null,     // () => string  — active tab id (remote-store keys driveFileId by tab)
  persistTabDrive: null,   // (tabId, {driveFileId, driveSync, driveLastSavedAt, driveImported, driveFolderId, driveDriveId, driveHeadRevisionId, driveCopies}) => void — mirror Drive state into tab meta
  onImport: null,          // (name, type, graphJSON, viewport) => void
  onReplaceActive: null,   // (name, type, graphJSON, viewport, mappingMode) => void — load INTO the active tab in place (refresh)
  onImportGroup: null,     // (groupMetas, diagrams) => void  (kind:'group' bundle)
  getAllTabs: null,        // () => tab[]              (all open tabs, incl. groupId)
  getGroups: null,         // () => group[]            ([{id,name,icon,color}] — so a full backup carries group data)
  getTabGraph: null,       // (tabId) => graphJSON     (a tab's graph)
  showLoadModal: null,     // (importStats) => void    (reveal Load-from-Browser)
  showPasteImport: null,   // () => void               (open the unified Load-from-Paste modal — New-Diagram "Open" tab)
  templatesBackupApi: null,// { getTemplates, exportFn, importMerge }
  renderThumbnail: null,   // (template, size, height, diff) => HTMLElement — mini-paper preview (templates.js); diff highlights added/changed cells. Used by the Review conflict modal's side-by-side cards.
  getTabViewport: null,    // (tabId) => viewport
  getTabDiagramType: null, // (tabId) => type
  showSaveModal: null,     // () => void              (open Save-to-Browser)
  onNamedSave: null,       // (name) => void          (tab marked saved)
  onSaveComplete: null,    // (kind) => void          (post-save hook)
  onDriveTabSaved: null,   // (tabId) => void         (a SPECIFIC tab finished syncing to Drive → clear its dirty dot)
  // Storage primitives (still defined in persistence.js until Slice 3; read here).
  namedSavePrefix: null,   // localStorage key prefix for named saves
  getNamedSaves: null,     // () => save[]
  readNamedSave: null,     // (key) => { name, diagramType, graph, viewport } | null
  // Drive-aware backup gate (remote-store fns, wired in persistence.init) — storage.js skips the export nag
  // when synced and offers "Connect to Google Drive" on the reminder.
  isDriveConnected: null,  // () => boolean
  isDriveConfigured: null, // () => boolean
  driveSignIn: null,       // () => Promise<void>  (open the Drive sign-in flow)

  // Cross-cutting helpers shared with persistence.js, wired in init() so the
  // sub-modules don't import persistence.js (which would be circular).
  triggerDownload: null,      // (url, filename) => void
  dateSuffix: null,           // () => 'YYYY-MM-DD'
  sanitizeGraphJSON: null,    // (graphData) => graphData  (mutates in place)
  compactGraphForSave: null,  // (graphJSON) => graphJSON  (strip load-reconstructable data — used by every save path incl. Drive)
  normalizeDiagramType: null, // (type) => canonical type
  checkVersionWarning: null,  // async (savedVer, name, rawData) => boolean
};

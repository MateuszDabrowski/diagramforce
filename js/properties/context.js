// Properties runtime context (CLEANUP S2) — the live graph / paper / selection plus the property panel's five DOM
// refs, wired ONCE by properties.init() via wirePrctx(). The properties/ leaf modules (color-schema is data-only;
// the widget / field-editor / renderer slices to come) READ prctx at CALL time so they never import the facade
// back — the acyclic context pattern already used by persistence (pctx) and canvas (cctx). asUndoBatch lives here
// too since every widget wraps its writes in it.
import * as history from '../history.js?v=1.21.3';

export const prctx = {
  graph: null, paper: null, selection: null,
  panelEl: null, typeBadgeEl: null, titleEl: null, bodyEl: null, footerEl: null,
  // Rebuild the panel for the active cell (facade's showProperties(getActiveCell())). Injected so a widget
  // (e.g. multi-paste style) can re-render without importing the facade back.
  refresh: null,
  // The facade's showProperties(cell) dispatch. Injected so a renderer leaf can re-render a SPECIFIC cell
  // (e.g. after a toggle that changes which controls show) without importing the facade back.
  showProperties: null,
  // The facade's bindLiveGanttDates(cell, bindings) — reflects drag/resize date changes live in the Gantt panel.
  // Injected because the listener STATE it owns (activeGanttDateListener) is also cleared by showProperties, so it
  // stays facade-side; the Gantt renderer leaf binds through prctx.
  bindLiveGanttDates: null,
  // The facade's openTableEditorModal(cell) — the df.Table staged "Edit in Table" overlay. Injected so the core
  // renderer leaf (renderTableProps' button) can open it; it stays facade-side (the paper dblclick handler opens
  // it too).
  openTableEditorModal: null,
  // The facade's isMappingMode() — Data Cloud mapping mode is ON (reads mappingModeGetter, wired by app.js via
  // setMappingModeGetter). Injected so the core DataObject renderer can reveal its Data Cloud section.
  isMappingMode: null,
};

/** Wire the runtime context — called by properties.init() after the graph/paper/selection refs and the panel's
 *  DOM elements are resolved. Leaves read prctx.graph/.paper/.selection/.bodyEl/etc lazily (never at module top). */
export function wirePrctx(refs) {
  Object.assign(prctx, refs);
}

/** Wrap `fn` so its model mutations land as ONE undo entry. The single most-used widget helper. */
export function asUndoBatch(fn) {
  return (...args) => {
    history.startBatch();
    try { fn(...args); }
    finally { history.endBatch(); }
  };
}

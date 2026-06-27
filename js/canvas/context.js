// Shared runtime context for the canvas sub-modules (router, viewport,
// crossing-bumps, migration, interactions, ...). canvas.js is the single
// WRITER — it creates the JointJS graph/paper in init() and wires this object —
// and the sub-modules are READERS. One-way data flow keeps the dependency graph
// acyclic: canvas.js -> sub-module, never the reverse (mirrors the persistence
// `pctx` pattern from Phase 3).
//
// `graph` is the global JointJS namespace, available without import; everything
// instance-specific lives here.
export const cctx = {
  // ── Live JointJS instances (created + wired in canvas.init()) ──
  graph: null,
  paper: null,

  // ── Forward-ref closures (wired by canvas.js init() or a register*(cctx) hook) ──
  fitParentToChildren: null,            // (parent) => void  — embedding auto-fit (wired by registerEmbedding, Slice 12)
  scheduleCrossingBumpRecompute: null,  // () => void        — debounced bump redraw
  isConnectorGroupingEnabled: null,     // () => bool        — read by the router (display-flag, wired at module-eval)
  refreshAllIconHrefs: null,            // () => void        — re-resolve every icon href after a theme/viewBox change (wired in init(); read by migration.js)
  syncMappingTypeBadge: null,           // (link) => void    — rebuild a mapping link's type-code token label (wired in init(); read by migration.js on load)
  showGanttDateChip: null,              // (bar, startISO, endISO) => void — draw the live start-end date chip above a gantt bar (wired in init(); read by selection.js resize)
  clearGanttDateChip: null,             // () => void        — clear the gantt drag/resize overlay layer
  showGanttGroupInsertBar: null,        // (tl, localY) => void — draw the amber phase-insert bar (wired in init(); read by stencil.js dragover)

  // ── Viewport (Slice 6) — wired by registerViewportControls(cctx) ──
  getZoom: null,              // () => number    — live zoom scale (screen-space math)
  fitContent: null,           // () => void      — zoom/translate to fit content (auto-layout.js calls it)

  // ── Load guard (Slice 9) — the cctx MIRROR of canvas.js's module-scope
  //    `_isLoadingJSON`; read by the external-labels + embedding listeners to
  //    skip auto-placement / auto-fit during a JSON restore ──
  // SYNC CONTRACT: this mirror and canvas.js's private `_isLoadingJSON` are
  //   deliberately written TOGETHER in canvas.setLoadingJSON(). The private flag
  //   feeds the in-canvas guards; this cctx copy feeds the extracted sub-modules
  //   that can't see canvas.js's closure. persistence (json-pipeline/storage),
  //   tabs, and mermaid-import DRIVE it by calling setLoadingJSON() around
  //   graph.fromJSON(). Keep the dual-write — do NOT build an event bus for one
  //   boolean.
  isLoadingJSON: false,       // bool flag
};

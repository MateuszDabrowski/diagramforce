// Canvas module — manages the JointJS graph and paper
// Provides pan (drag blank area), zoom (mouse wheel + ctrl), grid

import { cctx } from './canvas/context.js?v=1.19.2.99';
export { assertCctxWired } from './canvas/context.js?v=1.19.2.99';   // S8 wiring self-check (app.js calls it at end of init)
import { registerSfRouter } from './canvas/router.js?v=1.19.2.99';
import { Z_BASE, Z_TIER_SPAN, Z_GANTT_DEP, tierNameForType, registerZTiers } from './canvas/z-tiers.js?v=1.19.2.99';
export { Z_BASE, Z_TIER_SPAN, tierNameForType };   // re-export for properties.js + properties/widgets.js (reorder controls)
import { setIconDataUriFn, refreshIcons, registerIconRefresh } from './canvas/icon-refresh.js?v=1.19.2.99';
export { setIconDataUriFn, refreshIcons };   // re-export: app.js (pre-init) + toolbar.js theme switch
import { applyMappingLinkStyle, applyRelationshipLinkStyle, applyGanttDepLinkStyle, syncMappingTypeBadge, syncFrequencyLabel, setMappingModeGetter, isObjectRelationshipsVisible, setObjectRelationshipsVisible, registerLinkStyles } from './canvas/link-styles.js?v=1.19.2.99';
export { applyMappingLinkStyle, applyRelationshipLinkStyle, applyGanttDepLinkStyle, syncMappingTypeBadge, syncFrequencyLabel, setMappingModeGetter, isObjectRelationshipsVisible, setObjectRelationshipsVisible };   // re-export for properties/toolbar/table-view
// S7 slice 3b: the interactive link BEHAVIOURS (port-drag default-link factory, the reroute
// cascade for connector grouping, the object-rel add-time hider, the frequency change:labels
// re-glue) extracted to ./canvas/link-runtime.js. buildDefaultLink feeds the paper config;
// registerLinkRuntime(cctx) mounts the graph listeners in init().
import { rerouteAllLinks, buildDefaultLink, registerLinkRuntime } from './canvas/link-runtime.js?v=1.19.2.99';
export { rerouteAllLinks };   // re-export for toolbar.js (connector-grouping toggle applies instantly)
// S7 slice 4: the link:connect classifier (Gantt-dep / mapping / ER / sequence-reply) + the
// DataObject-refresh-on-link-change listeners extracted to ./canvas/link-classifier.js.
import { registerLinkClassifier } from './canvas/link-classifier.js?v=1.19.2.99';
// The router reads the connector-grouping flag via cctx; wire it at module-eval
// (isConnectorGroupingEnabled is a hoisted function declaration below).
cctx.isConnectorGroupingEnabled = isConnectorGroupingEnabled;
// Phase 4 Slice 3: auto-layout domain extracted to ./canvas/auto-layout.js
export { autoLayout, applyDataMappingLayout, analyzeSequenceLayout, applySequenceAutoLayout } from './canvas/auto-layout.js?v=1.19.2.99';
// Phase 4 Slice 4: migration fixups extracted to ./canvas/migration.js
export { migrateLinks, updateSimpleNodeLayout, updateDataObjectHeaderLayout, updateContainerHeaderLayout, updateNoteIconLayout, migrateNodes } from './canvas/migration.js?v=1.19.2.99';
// Phase 4 Slice 5: crossing-bump calculation extracted to ./canvas/crossing-bumps.js
import { initCrossingBumps, getBumpLayer } from './canvas/crossing-bumps.js?v=1.19.2.99';
export { isCrossingBumpsEnabled, setCrossingBumpsEnabled } from './canvas/crossing-bumps.js?v=1.19.2.99';
// Change Review overlay (NBA-1) — transient, non-destructive diff visualisation. cctx-only (no init wiring needed).
export { enterReview, exitReview, isReviewing, getReviewSummary } from './canvas/review-overlay.js?v=1.19.2.99';
// Diagram check (NBA #3, refocused) — find + transiently highlight loose connectors. cctx-only.
export { findLooseConnectors, highlightLooseConnectors } from './canvas/diagram-check.js?v=1.19.2.99';
// Capture-visibility overlay (v1.19.2) — selecting a captor tints its captured children (green) vs
// overlapping-but-free shapes (amber). Driven by selection.onChange (wired in app.js). cctx-only.
export { syncCaptureOverlay } from './canvas/capture-overlay.js?v=1.19.2.99';
// Phase 4 Slice 6: viewport domain (zoom / pan / grid / get-set) extracted to ./canvas/viewport.js.
// getGridColor is used by the initial paper setup below; registerViewportControls
// is the bridge called in init(); the rest are re-exported unchanged for backward
// compat (toolbar/keyboard/tabs/persistence call them via the canvas facade).
import { registerViewportControls, getGridColor } from './canvas/viewport.js?v=1.19.2.99';
export { zoomIn, zoomOut, resetZoom, fitContent, toggleGrid, refreshGrid, isGridVisible, getViewport, setViewport } from './canvas/viewport.js?v=1.19.2.99';
// Phase 4 Slices 7-9 — the "Leaf Purge": non-interactive side-effect leaves.
// line-style + external-labels init functions are imported and called in init();
// the mobile pair is re-exported below for external (toolbar/tabs) callers.
import { startLineStyleOverlays } from './canvas/line-style.js?v=1.19.2.99';
import { initExternalLabelAutoplace } from './canvas/external-labels.js?v=1.19.2.99';
export { initMobileDragHandles, syncMobilePanelHeight } from './canvas/mobile.js?v=1.19.2.99';
// Phase 4 Slice 10: link hover/focus tinting extracted to ./canvas/selection-viz.js.
// Export-neutral (all internal) — registerSelectionViz(cctx) is called in init()
// after the cctx block; the tinting bridges to crossing-bumps via getBumpLayer().
import { registerSelectionViz } from './canvas/selection-viz.js?v=1.19.2.99';
// Phase 4 Slice 11: spacing/alignment guides extracted to ./canvas/spacing-guides.js.
// Export-neutral; registerSpacingGuides(cctx) is called in init() after the cctx
// block. The element:pointerup activation-lifeline snap stays here (its own listener).
import { registerSpacingGuides } from './canvas/spacing-guides.js?v=1.19.2.99';
// Phase 4 Slice 12 (finale): embedding mechanics extracted to ./canvas/embedding.js.
// canEmbed + findEmbeddingParent feed the paper's embeddingMode config below;
// registerEmbedding(cctx) mounts the 4 auto-fit graph triggers post-hydration.
// The 4 public entry points are re-exported (stencil.js/properties.js/toolbar.js).
import { canEmbed, findEmbeddingParent, registerEmbedding, HALO_PARENT_TYPES } from './canvas/embedding.js?v=1.19.2.99';
export { canEmbed, HALO_PARENT_TYPES };
export { enclosedCapturableShapes, groupChildrenInto } from './canvas/embedding.js?v=1.19.2.99';
// S7 slice 5: the Gantt drag/reorder cluster (drop-line + date chips + reorder-on-drop) extracted to
// ./canvas/gantt-drag.js; registerGanttDrag(cctx) mounts it (BEFORE registerEmbedding — see init()).
import { registerGanttDrag } from './canvas/gantt-drag.js?v=1.19.2.99';
// Gantt drop-layer chip forwarders — the PUBLIC facade over registerGanttDrag's cctx closures, so
// external callers (selection.js resize, stencil.js dragover) reach them through the canvas facade
// instead of importing the private cctx (S8). Optional-chained: a safe no-op until init() wires them.
export function showGanttDateChip(bar, start, end) { cctx.showGanttDateChip?.(bar, start, end); }
export function clearGanttDateChip() { cctx.clearGanttDateChip?.(); }
export function showGanttGroupInsertBar(tl, localY, thickness) { cctx.showGanttGroupInsertBar?.(tl, localY, thickness); }
export { isAutoSizingEnabled, setAutoSizingEnabled, refitAllParents, findHaloParent, tuckChildInside, showDropGhost, hideDropGhost, setDragSelectionBBox } from './canvas/embedding.js?v=1.19.2.99';


// ── Z-order tiers ────────────────────────────────────────────────────
// Rendering layer — higher z = closer to the viewer.
// Order (bottom → top):  Zone → Container → Node/Label → Link
//
//   Zone      :    0 –  499   (500 slots for within-zone ordering)
//   Container : 1000 – 1499
//   Node/Label: 2000 – 2499
//   Link      : 3000+
//
// NOTE: sorting must be APPROX (not EXACT). In @joint/core 4.0.4 the
// EXACT sort method (sortLayerViews) is missing, so EXACT silently falls
// back to insertion order.  APPROX inserts each view at the correct
// z-sorted DOM position and also re-sorts on cell.set('z') changes.
//
// IMPORTANT: z assignment uses an explicit isLoadingJSON guard so that
// graph.fromJSON() never clobbers saved z values on reload.

// JSON-load guard, set around every graph.fromJSON() call (by persistence's
// json-pipeline/storage, tabs.js, and mermaid-import) so the 'add' listener skips
// z-assignment and preserves the saved values.
//
// SYNC CONTRACT: `_isLoadingJSON` (the private flag, read by the many in-canvas
//   guards below) and `cctx.isLoadingJSON` (the mirror, read by the extracted
//   external-labels + embedding sub-modules that can't see this module's closure)
//   are deliberately written TOGETHER in setLoadingJSON(). This explicit dual-write
//   is the chosen design — do NOT desync them or build an event bus for one boolean.
let _isLoadingJSON = false;
cctx.isLoadingJSON = false; // mirror for the extracted sub-module load guards (Slice 9)
export function setLoadingJSON(v) { _isLoadingJSON = v; cctx.isLoadingJSON = v; }
export function isLoadingJSON() { return _isLoadingJSON; }

// Auto-sizing toggle (isAutoSizingEnabled/setAutoSizingEnabled) + refitAllParents
// moved to ./canvas/embedding.js (Slice 12); re-exported from the facade above.

// ── Connector grouping toggle (v1.11.10 — CR-5.1) ───────────────────
// When enabled, links that crowd the same physical port (same cell + port)
// are bundled into shared "trunks" by the sfManhattan router. Links are
// grouped by visual semantics at that port (lineStyle + marker shape on the
// touching end); each distinct semantic group gets its own offset trunk lane,
// so e.g. dashed crow's-foot links and solid arrows on one port read as two
// parallel trunks instead of a tangle. Purely presentation — the graph data
// model is untouched. Default OFF to preserve existing visuals. Persisted in
// localStorage, mirroring the Auto-Sizing toggle. The Display menu drives this
// via setConnectorGroupingEnabled(); flipping it re-routes every link.
const CONNECTOR_GROUP_LS_KEY = 'sfdiag::connectorGrouping';
// Default ON — distributed connectors visually separate parallel links into
// distinct trunks along the cell edge and make multi-relationship diagrams
// (ER, architecture) much easier to read. An explicit user opt-out is the
// only reason this returns false. Existing users with a prior choice keep it.
export function isConnectorGroupingEnabled() {
  try {
    const v = localStorage.getItem(CONNECTOR_GROUP_LS_KEY);
    if (v === null) return true;            // never set → default ON
    return v === 'true';                    // explicit user choice wins
  } catch { return true; }
}
export function setConnectorGroupingEnabled(v) {
  try { localStorage.setItem(CONNECTOR_GROUP_LS_KEY, String(!!v)); } catch {}
}


// ── Focus dimming toggle (v1.12.4) ──────────────────────────────────
// When the user selects an element, everything not directly connected
// to it is dimmed so the focus highlight reads at a glance. That's the
// behaviour most people want — but in dense diagrams users sometimes
// just want to inspect / drag a single shape without the rest of the
// canvas fading. This toggle lets them opt out. Default ON. The Display
// menu drives it via setFocusDimmingEnabled(); selection.js consults
// isFocusDimmingEnabled() inside updateLinkDimming and short-circuits
// when off, also clearing any lingering dim classes.
const FOCUS_DIMMING_LS_KEY = 'sfdiag::focusDimming';
export function isFocusDimmingEnabled() {
  try {
    const v = localStorage.getItem(FOCUS_DIMMING_LS_KEY);
    if (v === null) return true;            // never set → default ON
    return v === 'true';                    // explicit user choice wins
  } catch { return true; }
}
export function setFocusDimmingEnabled(v) {
  try { localStorage.setItem(FOCUS_DIMMING_LS_KEY, String(!!v)); } catch {}
}

// rerouteAllLinks + the port-drag defaultLink factory + the reroute cascade moved to
// ./canvas/link-runtime.js (S7 slice 3b); rerouteAllLinks re-exported from the facade above.

let graph, paper;
// Viewport state (currentZoom, ZOOM_MIN/MAX/STEP, isPanning, panStart, gridVisible)
// + the pan/zoom/grid handlers moved to ./canvas/viewport.js (Phase 4, Slice 6).

// getGridColor() moved to ./canvas/viewport.js (Slice 6) — imported above for
// the initial paper drawGrid config below.

// canEmbed (the embedding-rules single source of truth) + findEmbeddingParent
// moved to ./canvas/embedding.js (Slice 12); imported above and fed into the
// paper's validateEmbedding/findParentBy config. canEmbed re-exported.

// Perpendicular-exit orthogonal router with obstacle avoidance.
// Guarantees a 32px stub out from each port before routing, and never crosses
// non-endpoint elements. Falls back to JointJS manhattan when port info is unavailable.


export function init() {
  registerSfRouter();
  graph = new joint.dia.Graph({}, { cellNamespace: joint.shapes });

  // ── Z-order tiers (js/canvas/z-tiers.js): assign fresh drops to their tier + snap dragged cells back ──
  cctx.graph = graph;   // set right after graph creation so registerZTiers (+ later registrars) read the live graph before any cell load
  registerZTiers(cctx);

  // ── Sequence Participant: keep bottom mirror in sync with top header ──
  // Whenever the top label text, header fill or accent changes, mirror the
  // update onto the bottom header so the two stay consistent. Skipped during
  // diagram load — migrateNodes handles that case in one pass.
  graph.on('change:attrs', (cell) => {
    if (_isLoadingJSON) return;
    if (!cell.isElement()) return;
    if (cell.get('type') !== 'sf.SequenceParticipant') return;
    joint.shapes.sf.syncParticipantBottomLabel?.(cell);
  });

  paper = new joint.dia.Paper({
    el: document.getElementById('paper'),
    model: graph,
    width: '100%',
    height: '100%',
    gridSize: 4,
    drawGrid: { name: 'dot', args: { color: getGridColor(), scaleFactor: 4 } },
    background: { color: 'transparent' },
    async: true,
    sorting: joint.dia.Paper.sorting.APPROX,  // z-based insertion order
    // Render ALL link labels in the dedicated labels layer (above the cells layer) so
    // they're never occluded by an overlapping connector drawn later — notably the
    // Data Cloud mapping-type code badges, which sit on busy, overlapping stubs.
    labelsLayer: true,
    cellViewNamespace: joint.shapes,

    // Default link when dragging from a port. The PREVIEW style is chosen from the
    // SOURCE port's role so the live drag matches the link it will become:
    //   • a square FIELD (mapping) port, in mapping mode → amber bézier (sfMappingRouter/
    //     Connector) — the mapping look from the first pointermove (not relationship-then-
    //     flip-on-drop).
    //   • any round RELATIONSHIP port (top/bottom/er-*, or a field port in Data Model) →
    //     grey orthogonal sfManhattan — the custom router used everywhere else.
    // Port-drag preview link factory moved to ./canvas/link-runtime.js (S7 slice 3b).
    defaultLink: buildDefaultLink,

    defaultConnectionPoint: { name: 'sfConnectionPoint', args: { offset: 16 } },

    validateConnection: (cellViewS, magnetS, cellViewT, magnetT, end) => {
      // Allow self-connection when the two magnets (ports) are different —
      // useful for sequence diagram self-calls and data-model self-joins.
      // Block only when the user tries to connect the exact same port.
      if (cellViewS === cellViewT && magnetS && magnetT && magnetS === magnetT) return false;
      // When dragging source arrowhead, validate the source magnet
      if (end === 'source') {
        if (!magnetS) return false;
        return magnetS.getAttribute('magnet') === 'true';
      }
      // When dragging target arrowhead, validate the target magnet
      if (!magnetT) return false;
      return magnetT.getAttribute('magnet') === 'true';
    },

    validateMagnet: (cellView, magnet) => {
      return magnet.getAttribute('magnet') === 'true';
    },

    snapLinks: { radius: 30 },
    markAvailable: true,
    // Embedding highlight OFF (v1.14.1) — the dashed drop-ghost (embedding.js
    // showDropGhost) is now the capture affordance, so suppress JointJS's default
    // stroke-around-the-parent (the solid bordered halo with the padding gap).
    // The linking highlighters (default + magnet/element availability) are
    // restated verbatim so they survive replacing the highlighting object.
    highlighting: {
      default: { name: 'stroke', options: { padding: 3 } },
      magnetAvailability: { name: 'addClass', options: { className: 'available-magnet' } },
      elementAvailability: { name: 'addClass', options: { className: 'available-cell' } },
      embedding: false,
    },

    // Embedding: children snap inside container-like parents
    embeddingMode: true,
    frontParentOnEmbed: false,
    // Slice 12: candidate lookup + rule check delegate to ./canvas/embedding.js
    // (imported). Both run at drag time, when cctx.graph is live.
    findParentBy: findEmbeddingParent,
    validateEmbedding: (childView, parentView) => canEmbed(parentView.model.get('type'), childView.model.get('type')),

    interactive: {
      linkMove: true,
      labelMove: true,
      vertexAdd: true,
      vertexMove: true,
      vertexRemove: true,
      arrowheadMove: true,
    },
  });

  // The link:connect classifier (Gantt-dep / mapping / ER / sequence-reply) moved to
  // ./canvas/link-classifier.js (S7 slice 4), mounted by registerLinkClassifier(cctx) below.

  // Pan / zoom (wheel · trackpad pinch · touch) / grid input handlers moved to
  // ./canvas/viewport.js (Slice 6); attached via registerViewportControls(cctx)
  // once cctx.graph/paper are wired (see the cctx block lower in init()).

  // Click the external-link icon on sf.Link to open `url` in a new tab.
  // Uses click position (not evt.target) because some browsers retarget evt.target
  // to the body rect beneath the transparent iconHit. The icon occupies the rightmost
  // ~40px of the element, so we open the URL only when the click lands there.
  paper.on('element:pointerclick', (cellView, evt, x, y) => {
    if (cellView.model.get('type') !== 'sf.Link') return;
    const rawUrl = cellView.model.get('url');
    if (!rawUrl) return;
    // Link `url` can originate from an untrusted share URL / imported JSON.
    // Only open http(s)/mailto — block javascript:/data:/vbscript:/file: etc.
    let safeUrl;
    try {
      const normalized = /^[a-z][a-z0-9+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
      const parsed = new URL(normalized);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return;
      safeUrl = parsed.href;
    } catch { return; }
    const bbox = cellView.model.getBBox();
    if (x >= bbox.x + bbox.width - 40) {
      window.open(safeUrl, '_blank', 'noopener,noreferrer');
    }
  });

  // (Safari dasharray-overlay manager now started after the cctx block — Slice 8)

  // Phase 4: populate the canvas runtime context (cctx) the sub-modules read.
  // Single-writer, here in init(); see js/canvas/context.js.
  cctx.paper = paper;
  registerIconRefresh(cctx);   // sets cctx.refreshAllIconHrefs + cctx.freqClockUri (icon-refresh.js)
  registerLinkStyles(cctx);   // sets cctx.syncMappingTypeBadge + cctx.syncFrequencyLabel (link-styles.js)
  registerLinkRuntime(cctx);   // mounts the reroute cascade + object-rel add-hider + frequency change:labels re-glue (link-runtime.js)
  registerLinkClassifier(cctx);   // mounts the link:connect classifier + the DataObject-refresh-on-link-change listeners (link-classifier.js)

  // Slice 6: attach the viewport input handlers (pan / zoom / grid) and expose
  // cctx.getZoom + cctx.fitContent. Must run AFTER cctx.graph/paper are set
  // above, since the handlers + fitContent read the live paper from cctx.
  registerViewportControls(cctx);

  // Slice 8: start the Safari dasharray-overlay manager here (relocated from
  // earlier in init()) so it reads cctx.graph/paper, wired just above.
  startLineStyleOverlays();

  // Slice 10: bind the link hover/focus-tinting listeners (reads cctx.graph/paper;
  // relocated here from earlier in init() for the same post-hydration reason).
  registerSelectionViz(cctx);

  // Slice 11: bind the drag-snap / alignment-guide listeners (reads cctx.graph/paper).
  registerSpacingGuides(cctx);

  // The sequence-activation lifeline snap shares the element:pointerup signal but
  // is its own concern (snapActivationToLifeline is also called from the stencil
  // drop). spacing-guides owns the guide cleanup on pointerup; this handles only
  // the activation snap, so the two listeners stay independent.
  paper.on('element:pointerup', (cellView) => {
    if (cellView?.model?.get('type') === 'sf.SequenceActivation') {
      snapActivationToLifeline(cellView.model);
    }
  });

  // Gantt drag/reorder cluster (drop-line + live date chips + reorder-on-drop) moved to
  // ./canvas/gantt-drag.js (S7 slice 5). MUST be mounted BEFORE registerEmbedding below: a bar
  // drop mutates geometry inside its pointerup, and embedding's auto-fit reacts to the change events.
  registerGanttDrag(cctx);

  // Slice 12 (finale): mount the embedding auto-fit graph triggers
  // (change:parent / change:size / change:position / remove) + expose
  // cctx.fitParentToChildren. Reads cctx.graph; skips JSON restore via
  // cctx.isLoadingJSON. The fit engine + canEmbed + findEmbeddingParent live in
  // ./canvas/embedding.js.
  registerEmbedding(cctx);

  // The reroute cascade + the frequency change:labels re-glue moved to
  // ./canvas/link-runtime.js (S7 slice 3b); the link:connect classifier + the
  // DataObject-refresh-on-link-change listeners moved to ./canvas/link-classifier.js
  // (S7 slice 4). Both mounted by their register*() in the registrar cluster above.

  // ── Empty-canvas ghost wireframe ────────────────────────────────────
  // Toggle `.is-empty` on #canvas-container whenever the active graph has zero cells.
  // CSS then reveals the faint, type-specific best-practice blueprint (markup in
  // index.html #canvas-empty; the diagram type is set on the container by tabs.js, and
  // the blueprint is chosen by [data-diagram-type]). Per-tab — each tab's empty state
  // shows its blueprint until the first drop. Pure view state: never touches the graph
  // or undo history. `reset` covers tab switches (fromJSON); add/remove cover edits.
  const canvasContainer = paper.el.closest('#canvas-container') || document.getElementById('canvas-container');
  const refreshEmptyState = () => {
    canvasContainer?.classList.toggle('is-empty', graph.getCells().length === 0);
  };
  graph.on('add remove reset', refreshEmptyState);
  refreshEmptyState();

  cctx.scheduleCrossingBumpRecompute = initCrossingBumps();
  initExternalLabelAutoplace();

  return { graph, paper };
}


// Snap a SequenceActivation's horizontal centre to the nearest participant or
// actor lifeline when within a threshold, provided the activation overlaps the
// lifeline vertically. Used both by `element:pointerup` (drag within canvas)
// and by the stencil drop handler.
export function snapActivationToLifeline(cell, threshold = 30) {
  if (!cell || cell.get('type') !== 'sf.SequenceActivation') return;
  const actBBox = cell.getBBox();
  const actCx = actBBox.x + actBBox.width / 2;
  let bestDx = Infinity;
  let bestCx = null;
  for (const el of graph.getElements()) {
    const t = el.get('type');
    if (t !== 'sf.SequenceParticipant' && t !== 'sf.SequenceActor') continue;
    const bb = el.getBBox();
    const lifeTop = bb.y + (t === 'sf.SequenceActor' ? 92 : 48);
    const lifeBot = bb.y + bb.height;
    const overlapY = Math.min(actBBox.y + actBBox.height, lifeBot) - Math.max(actBBox.y, lifeTop);
    if (overlapY <= 0) continue;
    const cx = bb.x + bb.width / 2;
    const dx = Math.abs(cx - actCx);
    if (dx < bestDx) { bestDx = dx; bestCx = cx; }
  }
  if (bestCx != null && bestDx <= threshold) {
    cell.position(bestCx - actBBox.width / 2, actBBox.y);
  }
}

// setZoom / zoomIn / zoomOut / fitContent / toggleGrid / refreshGrid moved to
// ./canvas/viewport.js (Slice 6); re-exported from the facade at the top.


// getViewport / setViewport moved to ./canvas/viewport.js (Slice 6); re-exported
// from the facade at the top (per-tab viewport save/restore reads them via the
// canvas module in tabs.js / persistence.js).


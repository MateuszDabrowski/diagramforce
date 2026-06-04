// Canvas module — manages the JointJS graph and paper
// Provides pan (drag blank area), zoom (mouse wheel + ctrl), grid

import { cctx } from './canvas/context.js?v=1.14.1';
import { registerSfRouter } from './canvas/router.js?v=1.14.1';
// The router reads the connector-grouping flag via cctx; wire it at module-eval
// (isConnectorGroupingEnabled is a hoisted function declaration below).
cctx.isConnectorGroupingEnabled = isConnectorGroupingEnabled;
// Phase 4 Slice 3: auto-layout domain extracted to ./canvas/auto-layout.js
export { autoLayout, analyzeSequenceLayout, applySequenceAutoLayout } from './canvas/auto-layout.js?v=1.14.1';
// Phase 4 Slice 4: migration fixups extracted to ./canvas/migration.js
export { migrateLinks, updateSimpleNodeLayout, migrateNodes } from './canvas/migration.js?v=1.14.1';
// Phase 4 Slice 5: crossing-bump calculation extracted to ./canvas/crossing-bumps.js
import { initCrossingBumps, getBumpLayer } from './canvas/crossing-bumps.js?v=1.14.1';
export { isCrossingBumpsEnabled, setCrossingBumpsEnabled } from './canvas/crossing-bumps.js?v=1.14.1';
// Phase 4 Slice 6: viewport domain (zoom / pan / grid / get-set) extracted to ./canvas/viewport.js.
// getGridColor is used by the initial paper setup below; registerViewportControls
// is the bridge called in init(); the rest are re-exported unchanged for backward
// compat (toolbar/keyboard/tabs/persistence call them via the canvas facade).
import { registerViewportControls, getGridColor } from './canvas/viewport.js?v=1.14.1';
export { zoomIn, zoomOut, fitContent, toggleGrid, refreshGrid, getViewport, setViewport } from './canvas/viewport.js?v=1.14.1';
// Phase 4 Slices 7-9 — the "Leaf Purge": non-interactive side-effect leaves.
// line-style + external-labels init functions are imported (called in init());
// startLineStyleOverlays + the mobile pair were public exports, so re-export them
// to keep canvas.js's export boundary stable (app.js / properties.js import them).
import { startLineStyleOverlays } from './canvas/line-style.js?v=1.14.1';
import { initExternalLabelAutoplace } from './canvas/external-labels.js?v=1.14.1';
export { startLineStyleOverlays };
export { initMobileDragHandles, syncMobilePanelHeight } from './canvas/mobile.js?v=1.14.1';
// Phase 4 Slice 10: link hover/focus tinting extracted to ./canvas/selection-viz.js.
// Export-neutral (all internal) — registerSelectionViz(cctx) is called in init()
// after the cctx block; the tinting bridges to crossing-bumps via getBumpLayer().
import { registerSelectionViz } from './canvas/selection-viz.js?v=1.14.1';
// Phase 4 Slice 11: spacing/alignment guides extracted to ./canvas/spacing-guides.js.
// Export-neutral; registerSpacingGuides(cctx) is called in init() after the cctx
// block. The element:pointerup activation-lifeline snap stays here (its own listener).
import { registerSpacingGuides } from './canvas/spacing-guides.js?v=1.14.1';
// Phase 4 Slice 12 (finale): embedding mechanics extracted to ./canvas/embedding.js.
// canEmbed + findEmbeddingParent feed the paper's embeddingMode config below;
// registerEmbedding(cctx) mounts the 4 auto-fit graph triggers post-hydration.
// The 4 public entry points are re-exported (stencil.js/properties.js/toolbar.js).
import { canEmbed, findEmbeddingParent, registerEmbedding } from './canvas/embedding.js?v=1.14.1';
export { canEmbed };
export { isAutoSizingEnabled, setAutoSizingEnabled, refitAllParents, findHaloParent, tuckChildInside, showDropGhost, hideDropGhost } from './canvas/embedding.js?v=1.14.1';

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
export const Z_BASE = {
  'sf.Zone':           0,
  'sf.BpmnPool':       0,
  'sf.Container':      1000,
  'sf.BpmnSubprocess': 500,
  'sf.BpmnLoop':       500,
  'sf.SimpleNode':     2000,
  'sf.TextLabel':      2000,
  'sf.Line':           2000,
  'sf.Note':           2000,
  'sf.BpmnEvent':      2000,
  'sf.BpmnTask':       2000,
  'sf.BpmnGateway':    2000,
  'sf.BpmnDataObject': 2000,
  'sf.FlowProcess':    2000,
  'sf.FlowDecision':   2000,
  'sf.FlowTerminator': 2000,
  'sf.FlowDatabase':   2000,
  'sf.FlowDocument':   2000,
  'sf.FlowIO':         2000,
  'sf.FlowPredefined': 2000,
  'sf.FlowOffPage':    2000,
  'sf.Annotation':     2000,
  'sf.DataObject':     2000,
  'sf.GanttTask':      2000,
  'sf.GanttMilestone': 2000,
  'sf.GanttMarker':    2000,
  'sf.GanttTimeline':  1000,
  'sf.GanttGroup':     1000,
  'sf.OrgPerson':      2000,
  'sf.SequenceFragment':    500,   // subprocess tier — groups messages
  'sf.SequenceParticipant': 2000,  // node tier — participants + lifelines
  'sf.SequenceActor':       2000,
  'sf.SequenceActivation':  2200,  // above participant lifeline, below links
};
export const Z_TIER_SPAN = 499;   // 500 slots per tier (0–499 relative to base)
export const Z_LINK_BASE  = 3000;

// Plain-language tier names used by the property-panel reorder controls.
// One source of truth so per-renderer call sites don't have to memorise the
// "Node layer" / "Container layer" / "Zone layer" jargon (which also drifted
// inconsistent — sf.BpmnSubprocess and sf.BpmnLoop sit in the same z-tier
// but had different labels in properties.js). Grouping:
//   z <   500  → "backgrounds"   (Zone, BpmnPool)
//   z <  2000  → "containers"    (Container, BpmnSubprocess, BpmnLoop,
//                                 SequenceFragment, GanttTimeline, GanttGroup)
//   z >= 2000  → "shapes"        (every regular cell — SimpleNode, Note,
//                                 BpmnTask, OrgPerson, DataObject, etc.)
export function tierNameForType(type) {
  const base = Z_BASE[type] ?? 2000;
  if (base < 500) return 'backgrounds';
  if (base < 2000) return 'containers';
  return 'shapes';
}

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

// Synchronously re-run the router on every link in the active graph. Used by
// the toolbar so toggling connector grouping applies instantly. LinkView.update()
// recomputes the route (re-invoking sfManhattan) and repaints in place.
// After every re-route the crossing-bump overlay needs to recompute too —
// linkView.update() doesn't always trigger `paper.on('render:done')`, so
// the bumps would otherwise stay anchored to stale route coordinates and
// either float in empty space (where the old route used to cross) or
// stop showing at the new crossing points.
export function rerouteAllLinks() {
  if (!graph || !paper) return;
  graph.getLinks().forEach(l => {
    const lv = paper.findViewByModel(l);
    lv?.update?.();
  });
  cctx.scheduleCrossingBumpRecompute?.();
}

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

  // ── Z-order tier management ──────────────────────────────────────
  // Each element type lives in its own numeric tier so that the paper's
  // EXACT z-sort always keeps: Zones < Containers < Nodes/Labels < Links
  //
  // When a NEW element is dropped (its z === the tier base, i.e. a freshly
  // instantiated shape), we push it to max+1 within the tier so that each
  // successive drop lands on top of its peers.
  // When loading from JSON every cell already carries its saved z value
  // (which differs from base unless it was the very first of its kind),
  // so the listener leaves it untouched.
  graph.on('add', (cell) => {
    // When restoring from JSON every cell already carries its correct saved z —
    // skip all reassignment so we never clobber the persisted layer order.
    if (_isLoadingJSON) return;

    if (cell.isLink()) {
      // Always push new links to the top of the link tier
      const maxLinkZ = graph.getLinks()
        .filter(l => l !== cell)
        .reduce((m, l) => Math.max(m, l.get('z') ?? Z_LINK_BASE), Z_LINK_BASE - 1);
      cell.set('z', maxLinkZ + 1);
      return;
    }

    if (!cell.isElement()) return;
    const base = Z_BASE[cell.get('type')];
    if (base === undefined) return;

    // Unconditionally assign the correct tier z for every freshly dropped element.
    // (The _isLoadingJSON guard above already protects JSON-restored cells.)
    const sameTier = graph.getElements().filter(
      el => el !== cell && el.get('z') >= base && el.get('z') < base + Z_TIER_SPAN
    );
    const nextZ = sameTier.length > 0
      ? Math.max(...sameTier.map(el => el.get('z') ?? base)) + 1
      : base;
    cell.set('z', nextZ);
  });

  // ── Z-tier enforcement on any z change ──────────────────────────────
  // JointJS calls element.toFront() during drag when embeddingMode is on
  // (inside prepareEmbedding), which pushes the element above all others.
  // This listener restores the previous z so that dragging never reorders.
  graph.on('change:z', (cell) => {
    if (_isLoadingJSON) return;
    if (cell.isLink()) {
      const z = cell.get('z');
      if (z >= Z_LINK_BASE) return; // already in link tier
      // Restore previous z if it was valid, otherwise assign top of link tier
      const prevZ = cell.previous('z');
      if (prevZ != null && prevZ >= Z_LINK_BASE) {
        cell.set('z', prevZ);
      } else {
        const maxLinkZ = graph.getLinks()
          .filter(l => l !== cell)
          .reduce((m, l) => Math.max(m, l.get('z') ?? Z_LINK_BASE), Z_LINK_BASE - 1);
        cell.set('z', maxLinkZ + 1);
      }
      return;
    }
    if (!cell.isElement()) return;
    const base = Z_BASE[cell.get('type')];
    if (base === undefined) return;
    const z = cell.get('z');
    if (z >= base && z < base + Z_TIER_SPAN) return; // already in tier
    // Restore previous z if it was within this tier (drag didn't intend reorder)
    const prevZ = cell.previous('z');
    if (prevZ != null && prevZ >= base && prevZ < base + Z_TIER_SPAN) {
      cell.set('z', prevZ);
      return;
    }
    // Otherwise push to top of correct tier (e.g. type conversion)
    const sameTier = graph.getElements().filter(
      el => el !== cell && el.get('z') >= base && el.get('z') < base + Z_TIER_SPAN
    );
    const nextZ = sameTier.length > 0
      ? Math.max(...sameTier.map(el => el.get('z') ?? base)) + 1
      : base;
    cell.set('z', nextZ);
  });

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
    cellViewNamespace: joint.shapes,

    // Default link when dragging from a port
    defaultLink: () => new joint.shapes.standard.Link({
      z: 0,  // 0 triggers the 'add' listener to place it in the link tier (30 000+)
      attrs: {
        line: {
          stroke: '#888888',
          strokeWidth: 2,
          sourceMarker: {
            type: 'path',
            d: 'M 0 0 L -12 0',
            fill: 'none',
            stroke: '#888888',
            'stroke-width': 2,
            'stroke-dasharray': 'none',
          },
          targetMarker: {
            type: 'path',
            d: 'M 0 -6 L -14 0 L 0 6 z',
            'stroke-dasharray': 'none',
          },
        },
      },
      router: { name: 'sfManhattan' },
      connector: { name: 'rounded', args: { radius: 8 } },
    }),

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

  // --- UML sequence default: reply-style links get dashed stroke ------
  // Fires when the user releases an arrowhead onto a valid port. In UML a
  // message drawn from the source's LEFT-side port into the target's RIGHT-
  // side port represents a reply / return (visually: right-to-left), which
  // convention renders as a dashed line. We apply dashed only on the very
  // first successful connection of a fresh link, and only if the user has
  // not already set an explicit dash pattern — so editing an existing link
  // never silently overrides their choice.
  paper.on('link:connect', (linkView) => {
    const link = linkView.model;
    const src = link.get('source');
    const tgt = link.get('target');
    if (!src?.id || !tgt?.id || !src.port || !tgt.port) return;
    const srcCell = graph.getCell(src.id);
    const tgtCell = graph.getCell(tgt.id);
    if (!srcCell || !tgtCell) return;
    const SEQ_TYPES = new Set([
      'sf.SequenceParticipant', 'sf.SequenceActor', 'sf.SequenceActivation',
    ]);
    if (!SEQ_TYPES.has(srcCell.get('type')) || !SEQ_TYPES.has(tgtCell.get('type'))) return;
    const srcPort = srcCell.getPort(src.port);
    const tgtPort = tgtCell.getPort(tgt.port);
    if (srcPort?.group !== 'seq-left' || tgtPort?.group !== 'seq-right') return;
    // Write to the custom `lineStyle` prop (not `line/strokeDasharray`) so
    // the overlay manager renders the dashes without bleeding into the
    // arrowhead marker on Safari.
    const currentStyle = link.prop('lineStyle');
    if (currentStyle && currentStyle !== 'none') return;
    link.prop('lineStyle', '6 4');
  });

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
  cctx.graph = graph;
  cctx.paper = paper;
  cctx.refreshAllIconHrefs = refreshAllIconHrefs;

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

  // Slice 12 (finale): mount the embedding auto-fit graph triggers
  // (change:parent / change:size / change:position / remove) + expose
  // cctx.fitParentToChildren. Reads cctx.graph; skips JSON restore via
  // cctx.isLoadingJSON. The fit engine + canEmbed + findEmbeddingParent live in
  // ./canvas/embedding.js.
  registerEmbedding(cctx);

  // ── Cascading re-route for connector grouping (CR-5.1) ─────────────
  // JointJS only re-runs the router for the link that changed — but with
  // grouping enabled, adding/removing/restyling one link at a port changes
  // N (and the group ordering) for every OTHER link at that port too.
  // Without this trigger, the existing 3 links keep their N=3 positions when
  // a 4th is added, while the new one routes at N=4 — visual misalignment.
  //
  // Strategy: when any link-relevant or geometry-relevant event fires and
  // grouping is on, re-route every link in the active graph. Debounced
  // (rAF-scale) so a chain of related events collapses into one pass.
  // Reroute itself only calls LinkView.update(), which doesn't mutate the
  // model, so we don't re-enter this listener loop.
  let _rerouteScheduled = false;
  function scheduleReroute() {
    if (_isLoadingJSON) return;
    if (!isConnectorGroupingEnabled()) return;
    if (_rerouteScheduled) return;
    _rerouteScheduled = true;
    requestAnimationFrame(() => {
      _rerouteScheduled = false;
      rerouteAllLinks();
    });
  }
  graph.on('add', (cell) => { if (cell.isLink?.()) scheduleReroute(); });
  graph.on('remove', (cell) => { if (cell.isLink?.()) scheduleReroute(); });
  graph.on('change:source change:target change:attrs change:lineStyle', (cell) => {
    if (cell.isLink?.()) scheduleReroute();
  });
  // Cell move/resize affects edge length (size) and far-end ordering
  // (position). Element-only — link `change:position` would be the same as
  // changes above and already handled.
  graph.on('change:position change:size', (cell) => {
    if (cell.isElement?.()) scheduleReroute();
  });

  // ── Gap 3 (v1.12.0) — empty-canvas onboarding hint ─────────────────
  // Render a faded SVG text inside the joint-layers group reading
  // "Drag a shape from the sidebar to start →" whenever the active
  // graph has zero cells. Visibility toggles automatically on every
  // add/remove. Per-tab — each tab's empty state shows the hint until
  // its first drop. CSS `pointer-events: none` so it never blocks pan.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let hintEl = null;
  const ensureHint = () => {
    if (hintEl && hintEl.parentNode) return hintEl;
    const layers = paper.svg.querySelector('.joint-layers') || paper.svg;
    hintEl = document.createElementNS(SVG_NS, 'text');
    hintEl.setAttribute('class', 'sf-canvas-hint');
    hintEl.setAttribute('text-anchor', 'middle');
    hintEl.setAttribute('pointer-events', 'none');
    hintEl.textContent = 'Drag a shape from the sidebar to start →';
    layers.appendChild(hintEl);
    return hintEl;
  };
  const refreshHint = () => {
    const empty = graph.getCells().length === 0;
    if (!empty) {
      if (hintEl?.parentNode) hintEl.style.display = 'none';
      return;
    }
    const el = ensureHint();
    // Position at the visible viewport centre in model coordinates so the
    // hint stays put regardless of zoom / pan when the canvas is empty.
    const rect = paper.el.getBoundingClientRect();
    const scale = paper.scale().sx;
    const t = paper.translate();
    const mx = (rect.width / 2 - t.tx) / scale;
    const my = (rect.height / 2 - t.ty) / scale;
    el.setAttribute('x', String(mx));
    el.setAttribute('y', String(my));
    el.style.display = '';
  };
  graph.on('add remove', refreshHint);
  // Re-position on pan/zoom/resize so the hint follows the viewport centre.
  paper.on('translate scale', refreshHint);
  new ResizeObserver(refreshHint).observe(paper.el);
  refreshHint();

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

let _iconDataUriFn = null;
export function setIconDataUriFn(fn) { _iconDataUriFn = fn; }

export function refreshIcons() {
  if (!_iconDataUriFn) return;
  // After theme switch, update icon data URIs on elements using default label color
  const nodeText = getComputedStyle(document.documentElement).getPropertyValue('--node-text').trim();
  if (!nodeText) return;
  for (const el of graph.getElements()) {
    const type = el.get('type');
    if (type === 'sf.SimpleNode') {
      const iconHref = el.attr('icon/href');
      if (!iconHref) continue;
      // Only update icons whose label is still using the default (CSS var) color
      const labelFill = el.attr('label/fill');
      if (labelFill && !labelFill.startsWith('var(')) continue; // custom color, skip
      // Extract icon ID and regenerate with new theme color
      const idMatch = iconHref.match(/data-icon-id(?:%3D|=)(?:%22|")([^%"]+)(?:%22|")/);
      if (idMatch) {
        const iconId = decodeURIComponent(idMatch[1]);
        el.attr('icon/href', _iconDataUriFn(iconId, nodeText));
      }
    }
  }
}

/** Regenerate ALL icon data URIs on canvas elements so they use current normalized viewBoxes. */
function refreshAllIconHrefs() {
  if (!_iconDataUriFn) return;
  for (const el of graph.getElements()) {
    const type = el.get('type');
    if (type === 'sf.SimpleNode') {
      _refreshElementIcon(el, 'icon/href', 'label/fill');
    } else if (type === 'sf.Container') {
      _refreshElementIcon(el, 'headerIcon/href', null, '#FFFFFF');
    }
  }
}

function _refreshElementIcon(el, hrefAttr, fillAttr, defaultColor) {
  const iconHref = el.attr(hrefAttr);
  if (!iconHref) return;
  const idMatch = iconHref.match(/data-icon-id(?:%3D|=)(?:%22|")([^%"]+)(?:%22|")/);
  if (!idMatch) return;
  const iconId = decodeURIComponent(idMatch[1]);
  // Determine the icon color from the element's text color or the default
  let color = defaultColor;
  if (!color) {
    const labelFill = fillAttr ? el.attr(fillAttr) : null;
    color = (labelFill && !labelFill.startsWith('var('))
      ? labelFill
      : getComputedStyle(document.documentElement).getPropertyValue('--node-text').trim() || '#FFFFFF';
  }
  el.attr(hrefAttr, _iconDataUriFn(iconId, color));
}

// getViewport / setViewport moved to ./canvas/viewport.js (Slice 6); re-exported
// from the facade at the top (per-tab viewport save/restore reads them via the
// canvas module in tabs.js / persistence.js).


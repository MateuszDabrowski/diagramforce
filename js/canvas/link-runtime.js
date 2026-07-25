// Link runtime — the interactive link BEHAVIOURS extracted from canvas.js (S7 slice 3b):
// the port-drag default-link factory (buildDefaultLink), the synchronous reroute
// (rerouteAllLinks) + the debounced reroute cascade for connector grouping, the
// object-relationship 'add'-time visibility hider, and the frequency-overlay
// change:labels re-glue. registerLinkRuntime(cctx) mounts the graph listeners.
// Reads the live graph/paper + flags (isLoadingJSON, isConnectorGroupingEnabled,
// getMappingMode, scheduleCrossingBumpRecompute) via cctx; imports the style
// constant/helpers from link-styles.js. Uses the `joint` GLOBAL (never an import).

import { cctx } from './context.js?v=1.20.1';
import { MAPPING_LINK_COLOR, isObjectRelationshipsVisible, syncFrequencyLabel } from './link-styles.js?v=1.20.1';
import { beginRoutePass, endRoutePass } from './router.js?v=1.20.1';

// Synchronously re-run the router on every link in the active graph. Used by
// the toolbar so toggling connector grouping applies instantly. LinkView.update()
// recomputes the route (re-invoking sfManhattan) and repaints in place.
// After every re-route the crossing-bump overlay needs to recompute too —
// linkView.update() doesn't always trigger `paper.on('render:done')`, so
// the bumps would otherwise stay anchored to stale route coordinates and
// either float in empty space (where the old route used to cross) or
// stop showing at the new crossing points.
export function rerouteAllLinks() {
  const { graph, paper } = cctx;
  if (!graph || !paper) return;
  // P1: bracket the whole batch in ONE reroute pass so the router snapshots obstacle bboxes + the
  // portId→ends index ONCE instead of rebuilding them for every link. endRoutePass MUST run in the
  // `finally` — a leaked pass would feed stale geometry to later single-link reroutes.
  beginRoutePass(graph);
  try {
    graph.getLinks().forEach(l => {
      const lv = paper.findViewByModel(l);
      lv?.update?.();
    });
  } finally {
    endRoutePass();
  }
  cctx.scheduleCrossingBumpRecompute?.();
}

// Default link when dragging from a port. The PREVIEW style is chosen from the
// SOURCE port's role so the live drag matches the link it will become:
//   • a square FIELD (mapping) port, in mapping mode → amber bézier (sfMappingRouter/
//     Connector) — the mapping look from the first pointermove (not relationship-then-
//     flip-on-drop).
//   • any round RELATIONSHIP port (top/bottom/er-*, or a field port in Data Model) →
//     grey orthogonal sfManhattan — the custom router used everywhere else.
export function buildDefaultLink(cellView, magnet) {
  let sourceIsMappingPort = false, sourcePortGroup = '';
  try {
    const portId = magnet && cellView?.findAttribute?.('port', magnet);
    sourcePortGroup = (portId && cellView.model.getPort?.(portId)?.group) || '';
    const isField = sourcePortGroup === 'fieldLeft' || sourcePortGroup === 'fieldRight';
    sourceIsMappingPort = isField && !!(cctx.getMappingMode?.());
  } catch { /* fall through to the relationship preview */ }

  if (sourceIsMappingPort) {
    // Mapping bézier preview (amber). The arrow direction follows the SOURCE side
    // via sfMappingRouter's floating-target handling (see router note there).
    const link = new joint.shapes.standard.Link({ z: 0 });
    link.attr('line/stroke', MAPPING_LINK_COLOR);
    link.attr('line/strokeWidth', 1);
    link.attr('line/targetMarker', { type: 'path', d: 'M 0 -6 L -14 0 L 0 6 z' });
    link.attr('line/sourceMarker', { type: 'path', d: 'M 0 0 L -12 0', fill: 'none', stroke: MAPPING_LINK_COLOR, 'stroke-width': 1 });
    link.router({ name: 'sfMappingRouter' });
    link.connector('sfMappingConnector');
    link.prop('source/connectionPoint', { name: 'anchor', args: { offset: 12 } });
    return link;
  }

  // Gantt dependency preview — dragging from a task bar's port draws the SAME amber stub-free bézier the link
  // becomes on connect (applyGanttDepLinkStyle), instead of flashing the grey orthogonal sfManhattan route with
  // boxy loops (the "incorrect routing during connector drag" report). The connector handles the floating
  // target (no target port yet → approaches from the left), so the preview tracks the cursor cleanly.
  if (cellView?.model?.get('type') === 'sf.GanttTask') {
    const stroke = '#F6B355';   // brand amber — matches applyGanttDepLinkStyle
    const link = new joint.shapes.standard.Link({ z: 0 });
    link.attr('line/stroke', stroke);
    link.attr('line/strokeWidth', 1.5);
    link.attr('line/targetMarker', { type: 'path', d: 'M 0 -6 L -14 0 L 0 6 z' });
    link.attr('line/sourceMarker', { type: 'path', d: 'M 0 -7 L 0 7', fill: 'none', stroke, 'stroke-width': 1.5 });   // "one" tick (item 2)
    link.router('normal');
    link.connector('sfGanttDepConnector');
    return link;
  }

  // Relationship preview (grey, orthogonal sfManhattan — the custom router).
  return new joint.shapes.standard.Link({
    z: 0,  // 0 triggers the 'add' listener to place it in the link tier (30 000+)
    attrs: {
      line: {
        stroke: '#888888',
        strokeWidth: 2,
        sourceMarker: { type: 'path', d: 'M 0 0 L -12 0', fill: 'none', stroke: '#888888', 'stroke-width': 2, 'stroke-dasharray': 'none' },
        targetMarker: { type: 'path', d: 'M 0 -6 L -14 0 L 0 6 z', 'stroke-dasharray': 'none' },
      },
    },
    router: { name: 'sfManhattan' },
    connector: { name: 'rounded', args: { radius: 8 } },
  });
}

// Mount the link-behaviour graph listeners. Called in canvas.init() after cctx.graph/paper
// are wired. Reads the load guard + grouping flag + freq sync via cctx / link-styles.
export function registerLinkRuntime(cctx) {
  const { graph, paper } = cctx;

  // Keep the "Object Relationships" filter consistent: a relationship link added while
  // the filter is OFF must come in hidden too. (View-only — no model mutation.)
  graph.on('add', (cell) => {
    if (isObjectRelationshipsVisible()) return;
    if (!cell.isLink?.() || cell.prop('linkKind') === 'mapping') return;
    requestAnimationFrame(() => {
      const view = paper.findViewByModel(cell);
      if (view?.el) view.el.style.display = 'none';
    });
  });

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
    if (cctx.isLoadingJSON) return;
    if (!cctx.isConnectorGroupingEnabled?.()) return;
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

  // Frequency overlay tracks the user label: dragging the on-line label (labelMove) fires change:labels,
  // so re-glue the overlay underneath it (v1.16.1). Guarded by `connectionFrequency` (only architecture
  // links with a frequency) + a reentrancy flag so syncFrequencyLabel's own labels() write can't re-fire
  // this into a loop (the JSON-equality short-circuit also terminates it).
  let _syncingFreq = false;
  graph.on('change:labels', (cell) => {
    if (_syncingFreq || !cell.isLink?.() || !cell.prop('connectionFrequency')) return;
    _syncingFreq = true;
    try { syncFrequencyLabel(cell); } finally { _syncingFreq = false; }
  });
}

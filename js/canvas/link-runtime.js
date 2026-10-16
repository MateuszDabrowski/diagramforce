// Link runtime — the interactive link BEHAVIOURS extracted from canvas.js (S7 slice 3b):
// the port-drag default-link factory (buildDefaultLink), the synchronous reroute
// (rerouteAllLinks) + the debounced reroute cascade for connector grouping, the
// object-relationship 'add'-time visibility hider, and the frequency-overlay
// change:labels re-glue. registerLinkRuntime(cctx) mounts the graph listeners.
// Reads the live graph/paper + flags (isLoadingJSON, isConnectorGroupingEnabled,
// getMappingMode, scheduleCrossingBumpRecompute) via cctx; imports the style
// constant/helpers from link-styles.js. Uses the `joint` GLOBAL (never an import).

import { cctx } from './context.js?v=1.26.2';
import { MAPPING_LINK_COLOR, GANTT_DEP_STROKE, isObjectRelationshipsVisible, setObjectRelationshipsVisible, syncFrequencyLabel } from './link-styles.js?v=1.26.2';
import { beginRoutePass, endRoutePass, separateForeignRuns, endChangeMovesOthers, forgetSeparation, isSharedBusDiagram } from './router.js?v=1.26.2';

// Set by the cascade (scheduleReroute), cleared by every pass: when Auto Layout or Re-face has already routed
// synchronously, the queued frame's pass would repaint the same routes, so it is skipped.
let _rerouteDirty = false;

// Synchronously re-run the router on every link in the active graph. Used by
// the toolbar so toggling connector grouping applies instantly. LinkView.update()
// recomputes the route (re-invoking sfManhattan) and repaints in place.
// After every re-route the crossing-bump overlay needs to recompute too —
// linkView.update() doesn't always trigger `paper.on('render:done')`, so
// the bumps would otherwise stay anchored to stale route coordinates and
// either float in empty space (where the old route used to cross) or
// stop showing at the new crossing points.
// `separate: false` skips the separation of different-looking links: the cascade's passes during a pointer gesture
// (see registerLinkRuntime). Every other caller gets the full pass.
export function rerouteAllLinks({ separate = true } = {}) {
  routePass(null, separate);
}

// One reroute pass over `links` (every link when null, else a subset in graph order), separating when `separate`.
// rerouteAllLinks and the cascade below are its only callers.
function routePass(links, separate) {
  _rerouteDirty = false;   // the pass mutates no model, so nothing re-dirties it mid-pass
  const { graph, paper } = cctx;
  if (!graph || !paper) return;
  // Flush pending view updates BEFORE the pass. Moved cards leave their links flagged for an update. Flushed after the
  // pass (the label resolver flushes first thing), they re-routed each link alone, outside the pass, with no shared bus
  // or separation: Auto Layout placed its labels on those interim routes, the next frame's pass restored the final
  // ones, and two labels ended up on one spot (random-6, 2026-10-12).
  paper.updateViews();
  // P1: bracket the whole batch in ONE reroute pass so the router snapshots obstacle bboxes + the
  // portId→ends index ONCE instead of rebuilding them for every link. endRoutePass MUST run in the
  // `finally` — a leaked pass would feed stale geometry to later single-link reroutes.
  beginRoutePass(graph);
  try {
    for (const l of links || graph.getLinks()) paper.findViewByModel(l)?.update?.();
    if (separate) separateForeignRuns(graph, paper);   // inside the pass: the re-routes reuse its obstacle snapshot
  } finally {
    endRoutePass();
  }
  cctx.scheduleCrossingBumpRecompute?.();
}

// The links a gesture frame re-routes after `cellIds` moved: those with an end on a moved cell, plus every other link at
// those links' ports (the moved end changes their trunk order and anchors). In graph order, the order a full pass
// routes them in: a sibling's line is adopted only from the same pass (router.js sameLookSiblingRuns).
function linksAroundCells(graph, cellIds) {
  const links = graph.getLinks();
  const portKey = (end) => (end?.id && end.port ? `${end.id}::${end.port}` : null);
  const ports = new Set();
  const out = new Set();
  for (const l of links) {
    const s = l.get('source'), t = l.get('target');
    if (!cellIds.has(s?.id) && !cellIds.has(t?.id)) continue;
    out.add(l);
    const ks = portKey(s), kt = portKey(t);
    if (ks) ports.add(ks);
    if (kt) ports.add(kt);
  }
  if (ports.size) {
    for (const l of links) {
      if (!out.has(l) && (ports.has(portKey(l.get('source'))) || ports.has(portKey(l.get('target'))))) out.add(l);
    }
  }
  return links.filter((l) => out.has(l));
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
    const stroke = GANTT_DEP_STROKE;   // the line amber applyGanttDepLinkStyle paints on connect (#D17E0B on light)
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
  // A graph reset (tab switch, import, revision view) renders every link visible, so the flag must read
  // visible again too, or the hider above would hide the next connector the user draws.
  graph.on('reset', () => { if (!isObjectRelationshipsVisible()) setObjectRelationshipsVisible(true); });

  // ── Cascading re-route for connector grouping (CR-5.1) ─────────────
  // JointJS only re-runs the router for the link that changed — but with
  // grouping enabled, adding/removing/restyling one link at a port changes
  // N (and the group ordering) for every OTHER link at that port too.
  // Without this trigger, the existing 3 links keep their N=3 positions when
  // a 4th is added, while the new one routes at N=4 — visual misalignment.
  //
  // Strategy: when any link-relevant or geometry-relevant event fires and
  // grouping is on, re-route every link in the active graph (during a pointer
  // gesture, only the links around the moved cells: see the frame below).
  // Debounced (rAF-scale) so a chain of related events collapses into one pass.
  // Reroute itself only calls LinkView.update(), which doesn't mutate the
  // model, so we don't re-enter this listener loop.
  // Shared-bus types run it with grouping off too (the owner's call, 2026-10-15): the bus and the separation of
  // different-looking links do not depend on the flag, and both need the pass. Without it, a load separated the lines
  // and the next edit did not, so a diagram drew differently after a reload.
  let _rerouteScheduled = false;
  let _gesture = false, _separationDeferred = false;   // see the pointer-gesture block below
  // What the queued pass must cover: the elements moved since the last pass, or every link once anything else changed
  // (a link added, removed, restyled or re-ended). Only a gesture frame reads it.
  const _movedIds = new Set();
  let _allLinks = false;
  function scheduleReroute(movedId) {
    if (cctx.isLoadingJSON) return;
    if (!cctx.isConnectorGroupingEnabled?.() && !isSharedBusDiagram()) return;
    _rerouteDirty = true;
    if (movedId) _movedIds.add(movedId); else _allLinks = true;
    // The queued pass starts plain and separates again. Until it runs, the last pass's avoid sets only cost time: every
    // route of a moved card's links ran a strict search as well (the first drag frame of a 29-link card among 400
    // links: 96 ms, 42 ms without). The pass replaces those routes in the same frame, before anything is painted.
    forgetSeparation();
    if (_rerouteScheduled) return;
    _rerouteScheduled = true;
    requestAnimationFrame(() => {
      _rerouteScheduled = false;
      const moved = new Set(_movedIds), all = _allLinks;
      _movedIds.clear();
      _allLinks = false;
      if (!_rerouteDirty) return;
      const live = cctx.graph;
      // A gesture frame whose changes were all element moves re-routes only the links around the moved cells. A full
      // pass per drag frame grew with the whole diagram: 247 link updates and 15 ms of routing per frame to drag a card
      // with 7 links on a 150-card grid with 240 links (2026-10-15). Accepted cost: until the drop, unrelated links do
      // not detour around the moving card. The drop's full pass depends only on the geometry, so it settles the same.
      if (_gesture) {
        _separationDeferred = true;
        routePass(all || !live ? null : linksAroundCells(live, moved), false);
      } else rerouteAllLinks();
    });
  }

  // A pointer gesture on the canvas (a card drag, a resize, a connector drag). Its frames route without separating
  // different-looking links (and, when only elements moved, only the links around them), and its end runs one full
  // pass. Separation tries four full link updates per clashing pair and repeats up to three sweeps, from scratch every
  // frame: 55-100 ms per frame at 70-110 links in three looks, against 4-5 ms for the plain pass. A pass depends only
  // on the geometry, so the routes after the drop are the ones per-frame separation gave; only the frames in between
  // show different-looking lines that may overlap. Capture phase, so a resize handle that stops propagation still
  // counts. Keyboard nudges keep full passes: each press is a final state.
  paper.el.addEventListener('pointerdown', () => { _gesture = true; }, true);
  const endGesture = () => {
    if (!_gesture) return;
    _gesture = false;
    if (_separationDeferred) { _separationDeferred = false; scheduleReroute(); }
  };
  for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, endGesture, true);
  window.addEventListener('blur', (e) => { if (e.target === window) endGesture(); });   // the window itself, not a field
  graph.on('add', (cell) => { if (cell.isLink?.()) scheduleReroute(); });
  graph.on('remove', (cell) => { if (cell.isLink?.()) scheduleReroute(); });
  graph.on('change:attrs change:lineStyle', (cell) => {
    if (cell.isLink?.()) scheduleReroute();
  });
  // A vertex edit (Simplify path, a bend dragged, their undo) re-routes only that link. Without a pass the other link
  // of a different-looking pair stayed on its line, or kept a detour around a line that was gone, until an unrelated
  // edit (review S5-1). A bend drag starts with a pointerdown, so its frames get plain passes and the drop a full one.
  graph.on('change:vertices', (cell) => { if (cell.isLink?.()) scheduleReroute(); });
  // A dragged end crossing empty canvas is re-set to a new point on every pointermove. No other route depends on a
  // point end, so only snapping onto or off a cell schedules a pass (it was one full pass per frame of the drag).
  for (const end of ['source', 'target']) {
    graph.on(`change:${end}`, (cell) => {
      if (cell.isLink?.() && endChangeMovesOthers(cell.previous(end), cell.get(end))) scheduleReroute();
    });
  }
  // Cell move/resize affects edge length (size) and far-end ordering
  // (position). Element-only — link `change:position` would be the same as
  // changes above and already handled. The ids come from the events, not the
  // dragged view: multi-select peers (selection.js) and embedded children move
  // too.
  graph.on('change:position change:size', (cell) => {
    if (cell.isElement?.()) scheduleReroute(cell.id);
  });
  // Moved ids from before a reset (tab switch, import) name cells of the old diagram: a frame still queued routes all.
  graph.on('reset', () => { _movedIds.clear(); if (_rerouteScheduled) _allLinks = true; });

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

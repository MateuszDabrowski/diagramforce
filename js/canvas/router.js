// sfManhattan — the custom orthogonal link router (32px stubs, 16px obstacle
// padding, trunk bundling, sequence self-loop handling). Extracted from
// canvas.js (Phase 4, Slice 2). The router reads the graph from each routed
// link (`link.graph`), not the module graph, so its only runtime dependency is
// the connector-grouping flag — read through the canvas context (`cctx`). The
// pure geometry helpers (resolveCalc, segHitsBox, pathClear, tryRoute,
// orthoRoute) are hoisted to module level + exported so they can be
// characterised in tests/canvas-router.test.js.

import { cctx } from './context.js?v=1.26.5';
import { right, bottom, centerX, centerY } from '../util/geometry.js?v=1.26.5';
import { assignJoinLanes, assignSideLanes } from './join-lanes.js?v=1.26.5';

// ── Routing geometry constants ──
export const STUB = 32;  // distance from port to first turn — must exceed defaultConnectionPoint offset (16px) + arrow length (14px)
export const PAD = 16;   // clearance around obstacles (must be < STUB so stubs are outside padded zones)
// Exported because the container auto-fit (canvas/embedding.js) derives its wrap padding from them: a frame
// must clear a routed link's first turn (STUB) by PAD, or the connector draws ON the container border.
const CP_PERP_OFFSET = 16; // matches the original anchor offset — perpendicular stand-off from the cell edge to the visual line end
const SNAP_STRAIGHT = 4; // collapse a near-collinear orthogonal link to DEAD-STRAIGHT when its two ends' cross-axis
// coords differ by <= this (px). The few-px residual that barycentre/side-port centring leaves between a parent and a
// near-aligned child (the visible connector "jog") is below this; staying <= CP_PERP_OFFSET(16) keeps the corrective
// nub inside the perpendicular standoff, so the line reads straight with only a sub-pixel angle at the port.
// Per-link channel allocation height (CR-5.3 v2). Each link end at a crowded
// port gets its own channel, with this many pixels between adjacent channels —
// distinct lines the eye reads as separate connections, not a "close parallel
// pile". `applyChannelShift` is the only user. (Lived in canvas.js until the
// Slice 2 router extraction; the const stayed behind, leaving this an undefined
// cross-module reference — relocating it here closes that gap.)
const CHANNEL_HEIGHT = 16;
// Shared trunk and bus (2026-10-12, the owner's pick "B"). On these types the links leaving one port share one trunk
// and one bus and branch at their targets, instead of each taking its own CHANNEL_HEIGHT lane - the staircase the
// owner rejected on Auto Layout output, and the opposite of the shared-vertex fix a skill user made by hand. Flow
// keeps its lanes: decision outcomes are separate labelled branches, and a shared bus there measured worse (labels
// drifted off their decisions, a branch ran past cards). Data models joined in 1.25.8, together with 128 px between
// their columns after Auto Layout (layout-core DATAMODEL_COLUMN_GAP): at 64 px every field row's link turned onto the
// same line as the next column's. The other types are unchanged until someone measures them.
const SHARED_BUS_TYPES = new Set(['architecture', 'process', 'datamodel']);

// ── Per-reroute-pass cache (P1) ──────────────────────────────────────────────
// A reroute pass (link-runtime.js routePass: rerouteAllLinks, and the cascade after every move or link change) routes
// a batch of links; during a drag one runs every animation frame over the links around the moved cells.
// Without this, each link's router run rebuilt the FULL obstacle list (getBBox over all elements) and
// gatherPortEnds rescanned all links for port-ends (up to ~6x per link) → O(L·E + L²) per pass.
// beginRoutePass snapshots the obstacle bboxes + a portId→ends index ONCE; the router reads them for every
// link in the pass; the caller MUST call endRoutePass in a `finally` — a leaked pass would feed stale
// geometry to later single-link reroutes. Module-level because the router body is a per-call closure. The
// snapshot's `graph` is checked at read time so a cache from another tab's graph is never used.
// Element types that are NOT routing obstacles (routes may pass straight through them). Zones / text /
// notes / BPMN pools / Gantt frames are backdrops. Sequence shapes are semantically pass-through: in UML a
// message line may cross any lifeline / activation bar / fragment frame between its source and target, so
// treating them as obstacles would force inter-participant connectors to detour around full-height columns.
// (Per-link exclusions — a source/target's embedded parent container, a sequence self-loop's own cell — are
// applied separately at route time via excludeIds, since they depend on the link, not the element type.)
const OBSTACLE_SKIP_TYPES = new Set([
  'sf.Zone', 'sf.TextLabel', 'sf.Note', 'sf.BpmnPool', 'sf.BpmnDataObject', 'sf.GanttTimeline', 'sf.GanttGroup',
  'sf.SequenceParticipant', 'sf.SequenceActor', 'sf.SequenceActivation', 'sf.SequenceFragment',
]);
// Frames whose children route FROM INSIDE them (see the exclusion in sfManhattan). Mirrors embedding.js's
// HALO_PARENT_TYPES (the captors) plus the sequence lifelines that host activations; restated because router.js stays
// importable without the canvas graph modules (unit tests).
const FRAME_TYPES = new Set([
  'sf.Container', 'sf.Zone', 'sf.TaskGroup', 'sf.BpmnPool', 'sf.BpmnSubprocess', 'sf.BpmnLoop', 'sf.Task',
  'sf.SequenceParticipant', 'sf.SequenceActor',
]);
/** True when a side port's exit is blocked by a THIRD card: the router's first turn (STUB out from the side's middle)
 *  lands inside another obstacle's PAD-padded box. orthoRoute then has no clear candidate and falls back to its
 *  least-overlap route, a line straight through that card. Mirrors the router's obstacle set: pass-through types, the
 *  cell, the `ignore` cells (normally the link's other end) and every ancestor of either do not block. */
export function portExitBlocked(graph, cell, side, ignore = [], boxes = null) {
  const bb = cell.getBBox();
  const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
  const p = side === 'top' ? { x: cx, y: bb.y - STUB } : side === 'bottom' ? { x: cx, y: bb.y + bb.height + STUB }
    : side === 'left' ? { x: bb.x - STUB, y: cy } : { x: bb.x + bb.width + STUB, y: cy };
  const skip = new Set();
  for (const c of [cell, ...ignore]) {
    for (let a = c, seen = 0; a && seen < 64; a = a.getParentCell?.(), seen++) skip.add(a.id);
  }
  const inside = (b) => p.x > b.x - PAD && p.x < b.x + b.width + PAD && p.y > b.y - PAD && p.y < b.y + b.height + PAD;
  // `boxes` (from obstacleBoxes) spares a caller asking per link end from re-reading every element's bbox: Auto Layout's
  // port snap did 2600 calls over 700 elements in 211 ms that way (review 2026-10-15, E14). Same set, same answer.
  if (boxes) return boxes.some(({ id, box }) => !skip.has(id) && inside(box));
  return graph.getElements().some((el) => !skip.has(el.id) && !OBSTACLE_SKIP_TYPES.has(el.get('type')) && inside(el.getBBox()));
}

/** Every obstacle's bbox, read once: the open route pass's snapshot when there is one for `gr`, else a fresh one.
 *  Valid while nothing moves, so a port snap or re-face reads it once for all its links. */
export function obstacleBoxes(gr) {
  return (_routePass && _routePass.graph === gr) ? _routePass.boxes : snapshotBoxes(gr);
}
function snapshotBoxes(gr) {
  const boxes = [];
  for (const el of gr.getElements()) {
    if (OBSTACLE_SKIP_TYPES.has(el.get('type'))) continue;
    const bb = el.getBBox();
    if (bb) boxes.push({ id: el.id, box: { x: bb.x, y: bb.y, width: bb.width, height: bb.height } });
  }
  return boxes;
}

let _routePass = null;   // { graph, boxes: [{id, box}], portEnds: Map<"cellId::portId", [{link,end}]> } | null

/** Open a reroute pass: snapshot the obstacle bboxes + the portId→ends index for `gr` once, so every link
 *  routed until endRoutePass() reuses them instead of recomputing. Idempotent-ish: a second call re-snapshots. */
export function beginRoutePass(gr) {
  _avoidRuns.clear();   // every pass routes plainly first; separateForeignRuns then re-applies what is still needed
  _noCrossedZ.clear();
  _passNo++;
  routeStats.passes++;
  if (!gr) { _routePass = null; return; }
  _routePass = { graph: gr, ...snapshotRouteCaches(gr) };
}

// The obstacle boxes, the port -> link-ends index and the empty per-port caches the router reads for `gr`.
function snapshotRouteCaches(gr) {
  const boxes = snapshotBoxes(gr);
  const portEnds = new Map();
  const add = (id, port, link, end) => {
    if (!id || !port) return;
    const k = id + '::' + port;
    let arr = portEnds.get(k); if (!arr) portEnds.set(k, arr = []);
    arr.push({ link, end });
  };
  const links = gr.getLinks();
  for (const l of links) {
    const s = l.get('source'), t = l.get('target');
    add(s?.id, s?.port, l, 'source');
    add(t?.id, t?.port, l, 'target');
  }
  // trunk / channels: per-port results of trunkAnchorOffset / linkChannelIndex. Both depend only on the PORT's link
  // ends (not on which link asks), so inside a pass they are computed once per port instead of once per link end -
  // the O(k^2) per hub port the P1 fix left behind (200 links on one port: 212 ms per pass; audit 2026-09-23).
  // Outside a pass only `trunk` is used (routeCaches below). `links` is the list the index was built from, in graph
  // order: columnNeedsTargetLead scans it rather than read the graph a second time per flush.
  return { boxes, portEnds, links, trunk: new Map(), channels: new Map() };
}

/** Close the current reroute pass. MUST run in a `finally` around the batch (a leaked pass poisons later reroutes). */
export function endRoutePass() { _routePass = null; }

// Outside a pass the paper routes links one at a time: every load and tab switch routes every link that way before
// the pass routes them again, and every drag frame routes the moved card's links. Each of those calls rebuilt the
// obstacle list from every element, scanned every link for its port's ends and re-sorted the port's trunk order:
// routing 400 links that way took 76 ms against 31 ms inside a pass (review P4, 2026-10-15). _oopCaches holds the
// same snapshot outside a pass (32 ms; routes identical on the held-out corpus). It is good for one graph revision,
// which any graph event bumps, and for the current task only (a view render may resize a card silently), so a flush
// builds it once. Channel ranks stay per call outside a pass: they only read the port's own ends.
let _oopCaches = null;
const _graphRevs = new WeakMap();   // graph -> { n }: bumped by every event the graph fires
function graphRevision(gr) {
  let r = _graphRevs.get(gr);
  if (!r) { r = { n: 0 }; _graphRevs.set(gr, r); gr.on('all', () => { r.n++; }); }
  return r.n;
}
/** The caches the router reads for `gr`: the open pass's, else a snapshot for the current revision and task. */
function routeCaches(gr) {
  if (_routePass && _routePass.graph === gr) return _routePass;
  const rev = graphRevision(gr), type = cctx.getDiagramType?.();   // endSignature reads the diagram type
  const c = _oopCaches;
  if (c && c.graph === gr && c.rev === rev && c.type === type) return c;
  const fresh = _oopCaches = { graph: gr, rev, type, ...snapshotRouteCaches(gr) };
  queueMicrotask(() => { if (_oopCaches === fresh) _oopCaches = null; });
  return fresh;
}

// ── Pure geometry helpers (exported for tests) ──
// Best-effort calc() evaluator covering the handful of forms used by our
// shape definitions: calc(w), calc(h), calc(<r> * w [+ <o>]), calc(<r> * h
// [+ <o>]). Falls back to a plain number if no match.
export function resolveCalc(expr, w, h) {
  if (typeof expr === 'number') return expr;
  if (typeof expr !== 'string') return 0;
  // Matches `calc(ratio * dim)` or `calc(ratio * dim ± offset)`. The offset
  // group captures either a `+`-prefixed (possibly negative) number or a
  // `-`-prefixed positive number so both `+ -8` and `- 8` resolve correctly.
  const mul = expr.match(/calc\s*\(\s*([\d.]+)\s*\*\s*([whWH])\s*(?:([+-])\s*(-?[\d.]+))?\s*\)/);
  if (mul) {
    const ratio = parseFloat(mul[1]);
    const dim = mul[2].toLowerCase() === 'w' ? w : h;
    const sign = mul[3] === '-' ? -1 : 1;
    const offset = mul[4] ? sign * parseFloat(mul[4]) : 0;
    return ratio * dim + offset;
  }
  const plain = expr.match(/calc\s*\(\s*([whWH])\s*\)/);
  if (plain) return plain[1].toLowerCase() === 'w' ? w : h;
  const n = parseFloat(expr);
  return isNaN(n) ? 0 : n;
}

// Does an axis-aligned segment (a→b) intersect the padded bbox?
export function segHitsBox(ax, ay, bx, by, box) {
  const x1 = box.x - PAD, y1 = box.y - PAD;
  const x2 = right(box) + PAD, y2 = bottom(box) + PAD;
  if (ax === bx) { // vertical
    if (ax <= x1 || ax >= x2) return false;
    const lo = Math.min(ay, by), hi = Math.max(ay, by);
    return hi > y1 && lo < y2;
  }
  if (ay === by) { // horizontal
    if (ay <= y1 || ay >= y2) return false;
    const lo = Math.min(ax, bx), hi = Math.max(ax, bx);
    return hi > x1 && lo < x2;
  }
  return false;
}

export function pathClear(pts, obstacles) {
  for (let i = 0; i < pts.length - 1; i++) {
    for (const box of obstacles) {
      if (segHitsBox(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, box)) return false;
    }
  }
  return true;
}

// Length of an axis-aligned segment (a→b) lying inside a bbox expanded by `pad` (sibling of segHitsBox). 0 for
// a segment that clears the box or is diagonal. `pad` defaults to PAD (the router's clearance zone); a caller
// may pass 0 for overlap against the ACTUAL box rectangle.
export function segOverlapLen(ax, ay, bx, by, box, pad = PAD) {
  const x1 = box.x - pad, y1 = box.y - pad, x2 = right(box) + pad, y2 = bottom(box) + pad;
  if (ax === bx) { // vertical
    if (ax <= x1 || ax >= x2) return 0;
    const lo = Math.min(ay, by), hi = Math.max(ay, by);
    return Math.max(0, Math.min(hi, y2) - Math.max(lo, y1));
  }
  if (ay === by) { // horizontal
    if (ay <= y1 || ay >= y2) return 0;
    const lo = Math.min(ax, bx), hi = Math.max(ax, bx);
    return Math.max(0, Math.min(hi, x2) - Math.max(lo, x1));
  }
  return 0;
}

// Total PADDED-box overlap of a full candidate route a→…mid…→b — the cost the least-overlap fallback minimises.
// PADDED (not the actual box) on purpose: it also penalises routes that hug an obstacle EDGE, which is exactly
// where near-parallel links stack into a foreign-overlap PILE. Measured: padded ranking keeps foreign-overlap
// flat, whereas ranking by the actual box lets fallbacks edge-hug and pile (the banned trade).
function routeOverlap(a, mid, b, obstacles) {
  const pts = [a, ...mid, b];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    for (const box of obstacles) total += segOverlapLen(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, box);
  }
  return total;
}

// ── Different-looking links never share a line (2026-10-12, the owner's rule) ─────────────────────────────────────
// Links that LOOK the same (stroke colour + dash) may run on one line: they read as one trunk. Links that look
// different must not: with the shared bus on, a red dashed link landed on the same vertical as a green solid one -
// detours around a card all pick the same x, 20 px out - and the dashes hid which line went where. After a batch is
// routed, separateForeignRuns finds a run two different-looking links share (or run within RUN_TOL of), and re-routes
// one of them with the other's runs as soft obstacles (orthoRoute's `avoid`). Sharing a port does not exempt a pair:
// on mixed-hub a dashed and a solid link into one port merged for 73 px, and a solid/dashed pair between the same two
// cards ran as one line for 341 px. Same-look links are left to merge into one trunk. Only on SHARED_BUS_TYPES:
// elsewhere the per-link channels already keep lines apart.
const RUN_TOL = 10;  // different-looking runs closer than this read as one smudged line (8 px apart did, on mixed-hub)
const RUN_MIN = 6;   // a shared stretch shorter than this is a corner or a crossing, not a shared line
const _lastRuns = new Map();    // link id -> { pts, runs, look, pass } of the route the router last returned
let _passNo = 0;                // bumped per reroute pass: a sibling's line is adopted only from the SAME pass
const _avoidRuns = new Map();   // link id -> runs it must not share a line with (set by separateForeignRuns)
const _noCrossedZ = new Set();  // link ids that gave up their crossed-stub Z to a different-looking link (separation)
// The element under a canvas drag and the parent it had at pointerdown (embedding.js sets it). JointJS embeddingMode
// detaches a dragged child (parent -> null) until the drop, so the live parent made the child's home frame an obstacle to
// the child's own links for the whole drag: grabbing the card a trunk starts from, inside a container, bent the trunk
// 80 px onto a dashed line until the drop, even with no movement (2026-10-25). It only fills in a missing parent, so a
// lost pointerup cannot override a real one, and the next pointerdown replaces it.
let _dragHome = null;
export function setDragHome(id, parentId) { _dragHome = id && parentId ? { id, parentId } : null; }

const axisRun = (p, q) => {
  if (Math.abs(p.y - q.y) < 1 && Math.abs(p.x - q.x) >= 1) return { o: 'H', c: p.y, lo: Math.min(p.x, q.x), hi: Math.max(p.x, q.x) };
  if (Math.abs(p.x - q.x) < 1 && Math.abs(p.y - q.y) >= 1) return { o: 'V', c: p.x, lo: Math.min(p.y, q.y), hi: Math.max(p.y, q.y) };
  return null;
};
const runsOf = (pts) => { const out = []; for (let i = 0; i + 1 < pts.length; i++) { const r = axisRun(pts[i], pts[i + 1]); if (r) out.push(r); } return out; };
const sharesLine = (r, q) => r.o === q.o && Math.abs(r.c - q.c) <= RUN_TOL && Math.min(r.hi, q.hi) - Math.max(r.lo, q.lo) > RUN_MIN;

/** True when the polyline `pts` runs along one of `runs` for more than RUN_MIN px. Pure; exported for tests. */
export function hitsRuns(pts, runs) {
  for (const r of runsOf(pts)) for (const q of runs) if (sharesLine(r, q)) return true;
  return false;
}

/** What a reader sees of a link's line: its stroke colour and dash pattern. */
function linkLook(link) {
  const dash = link.get('lineStyle') || link.attr('line/strokeDasharray') || 'none';
  return `${String(link.attr('line/stroke') || '').toLowerCase()}|${dash}`;
}

function linksConflict(a, b) {
  if (!a || !b || a.look === b.look) return false;
  return a.runs.some((r) => b.runs.some((q) => sharesLine(r, q)));
}

/** After a batch of routes: re-route links that share a line with a different-looking link. Returns how many moved.
 *  `scope` (a Set of link ids, a drag frame's routed links): only pairs with a scoped link are checked, and only scoped
 *  links move; every other link keeps its settled line as an obstacle. Without it a drag frame skipped separation, and
 *  grabbing a card re-drew its trunk unseparated: a sibling's split point jumped 80 px onto a dashed line 8 px away, and
 *  back on the drop (the owner's "dancing connector", 2026-10-24). */
export function separateForeignRuns(gr, paper, scope = null) {
  if (!gr || !paper || !SHARED_BUS_TYPES.has(cctx.getDiagramType?.())) return 0;
  const links = gr.getLinks();
  // Only links sfManhattan routes take part. A link switched to another router (a data-model link set to Mapping) never
  // reaches sfManhattan again, so its last orthogonal route stayed here and other links were moved off a line that had
  // become a bezier, until a reload (review S5-5).
  const ids = new Set(links.filter((l) => l.router()?.name === 'sfManhattan').map((l) => l.id));
  for (const id of [..._lastRuns.keys()]) if (!ids.has(id)) { _lastRuns.delete(id); _avoidRuns.delete(id); }
  // Runs with Distributed Connectors off too (the owner's call, 2026-10-15): without it different-looking lines shared
  // runs, worse by eye on 5 of 8 random corpus diagrams. On these types the cascade runs in that mode as well, so a
  // pass follows every edit and load and edits route alike (link-runtime scheduleReroute).
  // A move can put a link onto a third link's line, so sweep again while anything moved (bounded).
  let total = 0;
  // A drag frame sweeps once: the extra sweeps settle chains of moves for the drop's full pass, and in a dense diagram a
  // pair that cannot be cleared was retried in each (2026-10-24).
  for (let sweep = 0; sweep < (scope ? 1 : SEPARATION_SWEEPS); sweep++) {
    const moved = separationSweep(links, paper, scope);
    total += moved;
    if (!moved) break;
  }
  return total;
}

const SEPARATION_SWEEPS = 3;

function separationSweep(links, paper, scope = null) {
  // Candidate pairs, bucketed by line so a big diagram is not an all-pairs scan.
  const buckets = new Map();
  links.forEach((l, i) => {
    for (const r of _lastRuns.get(l.id)?.runs || []) {
      const k = `${r.o}:${Math.round(r.c)}`;
      if (!buckets.has(k)) buckets.set(k, new Set());
      buckets.get(k).add(i);
    }
  });
  const pairs = new Set();
  links.forEach((l, i) => {
    // Scoped (a drag frame): only a scoped link's runs open a pair, so the scan costs the drag's few links, not all of
    // them - unscoped it took a frame on a 150-card grid from 1.2 to 11.8 ms (2026-10-24).
    if (scope && !scope.has(l.id)) return;
    for (const r of _lastRuns.get(l.id)?.runs || []) {
      for (let d = -RUN_TOL; d <= RUN_TOL; d++) {
        for (const j of buckets.get(`${r.o}:${Math.round(r.c) + d}`) || []) {
          if (j === i || (!scope && j < i)) continue;
          pairs.add(Math.min(i, j) * links.length + Math.max(i, j));
        }
      }
    }
  });
  const reroute = (link) => paper.findViewByModel(link)?.update?.();
  let moved = 0;
  for (const key of [...pairs].sort((p, q) => p - q)) {
    const first = links[Math.floor(key / links.length)], second = links[key % links.length];
    if (scope && !scope.has(first.id) && !scope.has(second.id)) continue;
    if (!linksConflict(_lastRuns.get(first.id), _lastRuns.get(second.id))) continue;
    // Try moving each link of the pair and keep the move that changes its route LEAST. Moving the later link by
    // default sent two red links 144 px down to a line hugging a container's cards, where moving the green link it
    // clashed with cost 12 px.
    let best = null;
    const movers = [[second, first], [first, second]].filter(([m]) => !scope || scope.has(m.id));
    if (movers.length === 1) {
      // One candidate (a drag frame's link against a settled one): no comparison to make, so keep the move if it clears
      // the pair, without the trial and revert re-routes - 56 strict searches a frame on a 150-card grid otherwise.
      const [mover, keeper] = movers[0];
      const before = _avoidRuns.get(mover.id);
      _avoidRuns.set(mover.id, (before || []).concat(_lastRuns.get(keeper.id).runs));
      reroute(mover);
      if (!linksConflict(_lastRuns.get(first.id), _lastRuns.get(second.id))) { moved++; continue; }
      if (before) _avoidRuns.set(mover.id, before); else _avoidRuns.delete(mover.id);
      reroute(mover);
      continue;
    }
    for (const [mover, keeper] of movers) {
      const before = _avoidRuns.get(mover.id), oldPts = _lastRuns.get(mover.id).pts;
      const trial = (before || []).concat(_lastRuns.get(keeper.id).runs);
      _avoidRuns.set(mover.id, trial);
      reroute(mover);
      if (!linksConflict(_lastRuns.get(first.id), _lastRuns.get(second.id))) {
        const shift = routeShift(oldPts, _lastRuns.get(mover.id).pts);
        if (!best || shift < best.shift) best = { mover, trial, shift };
      }
      if (before) _avoidRuns.set(mover.id, before); else _avoidRuns.delete(mover.id);
      reroute(mover);
    }
    if (best) { _avoidRuns.set(best.mover.id, best.trial); reroute(best.mover); moved++; continue; }
    // Neither move clears the pair, and one of them took a crossed-stub Z: two lines through one 48 px gap between
    // cards have a 16 px clear band, too narrow for either to move 10 px clear (random-1: a blue Z on a dark line for
    // 28 px). That link gives up its Z for the route it had before, then the other link moves as above.
    for (const [zLink, other] of [[first, second], [second, first]]) {
      if (!_lastRuns.get(zLink.id)?.z) continue;
      if (scope && (!scope.has(zLink.id) || !scope.has(other.id))) continue;
      _noCrossedZ.add(zLink.id); reroute(zLink);
      const before = _avoidRuns.get(other.id);
      _avoidRuns.set(other.id, (before || []).concat(_lastRuns.get(zLink.id).runs)); reroute(other);
      if (!linksConflict(_lastRuns.get(first.id), _lastRuns.get(second.id))) { moved++; break; }
      if (before) _avoidRuns.set(other.id, before); else _avoidRuns.delete(other.id);
      _noCrossedZ.delete(zLink.id); reroute(zLink); reroute(other);
    }
  }
  return moved;
}

/** How far a re-routed polyline strays from the old one: the largest distance from a new point to the old line. */
function routeShift(oldPts, newPts) {
  const toSeg = (p, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };
  let worst = 0;
  for (const p of newPts) {
    let d = Infinity;
    for (let i = 0; i + 1 < oldPts.length; i++) d = Math.min(d, toSeg(p, oldPts[i], oldPts[i + 1]));
    worst = Math.max(worst, d === Infinity ? 0 : d);
  }
  return worst;
}

/** A route can reach a port's stub from the CELL side and turn back: a detour line 20 px out (obstacle edge + PAD + 4)
 *  meets the stub 32 px out, and the line runs 12 px past the arrow and back - the hook beside Agentforce once its link
 *  left a red link's line. When the point before the stub lies on the stub's line between the visible line end
 *  (CP_PERP_OFFSET out) and the stub, the stub goes: the line then runs straight into the port. Mutates `route`. */
export function dropBacktrackingStub(route, dir, atEnd) {
  if (!dir || route.length < 3) return;
  const stub = atEnd ? route[route.length - 1] : route[0];
  const prev = atEnd ? route[route.length - 2] : route[1];
  const horiz = dir === 'left' || dir === 'right';
  if (horiz ? Math.abs(prev.y - stub.y) >= 1 : Math.abs(prev.x - stub.x) >= 1) return;   // not on the stub's line
  const out = (dir === 'right' || dir === 'bottom') ? 1 : -1;   // outward along the axis
  const k = horiz ? 'x' : 'y';
  const lineEnd = stub[k] - out * (STUB - CP_PERP_OFFSET);
  // Keep at least 4 px of line after the trim: between two cards 33 px apart a 1 px end segment turned the arrow
  // sideways (an arrowhead's direction comes from the last segment).
  if (out * (prev[k] - lineEnd) >= 4 && out * (stub[k] - prev[k]) > 0) { if (atEnd) route.pop(); else route.shift(); }
}

/** True when the active diagram routes with the shared trunk and bus (and so wants separateForeignRuns). */
export function isSharedBusDiagram() { return SHARED_BUS_TYPES.has(cctx.getDiagramType?.()); }

/** True when moving a link end from `prev` to `next` can change OTHER links' routes: the end was or is on a cell. A
 *  point end (an arrowhead dragged over empty canvas, which JointJS re-sets on every pointermove) routes straight and
 *  sits on no port, so a point-to-point move changes only its own link. Pure; exported for tests. */
export function endChangeMovesOthers(prev, next) { return !!(prev?.id || next?.id); }

/** Forget remembered routes and avoid-sets, e.g. when a different diagram loads into the paper. */
export function resetRouteMemory() { _lastRuns.clear(); _avoidRuns.clear(); _noCrossedZ.clear(); _oopCaches = null; }

/** Forget the last pass's avoid sets and Z give-ups once another pass is queued (link-runtime scheduleReroute): that
 *  pass starts plain anyway, and until it runs the sets only made each route outside a pass run a strict search. Not
 *  inside a pass, whose separation is using them. */
export function forgetSeparation() { if (!_routePass) { _avoidRuns.clear(); _noCrossedZ.clear(); } }

/** True when `p` lies strictly inside an obstacle's PAD-padded box: a route starting there is trapped. */
export function insidePadded(p, obstacles) {
  return obstacles.some((box) => p.x > box.x - PAD && p.x < right(box) + PAD && p.y > box.y - PAD && p.y < bottom(box) + PAD);
}

// Try a candidate route; return it if clear, or null.
export function tryRoute(a, mid, b, obstacles) {
  const pts = [a, ...mid, b];
  return pathClear(pts, obstacles) ? mid : null;
}

// Build an orthogonal route between two stub points, avoiding obstacles.
// Returns intermediate waypoints (NOT including a and b themselves).
// `avoid` (optional): axis runs of OTHER links this route must not share a line with (see separateForeignRuns). They
// are soft: the search first treats a candidate on one of them as blocked, and only if nothing qualifies does it run
// again exactly as it would without them - so avoiding a line can never make a route worse than it was.
export function orthoRoute(a, b, obstacles, avoid = null, prefer = null) {
  let plain = orthoSearch(a, b, obstacles, null, true);
  // Trunk unification (shared-bus types): `prefer` holds lines of links that share a port with this one and look the
  // same. When this route runs PARALLEL to one of them within ADOPT_DIST, take that line instead: two red links into
  // one port otherwise ran as a rectangle of horizontals 50 px apart, each Z on its own midpoint. Only near-duplicates
  // merge - adopting any sibling line made fan-out branches ride down a neighbour's drop before splitting off.
  if (prefer && prefer.length) {
    const own = runsOf([a, ...plain, b]);
    const near = prefer.filter((r) => own.some((q) => q.o === r.o && Math.abs(q.c - r.c) <= ADOPT_DIST
      && Math.min(q.hi, r.hi) - Math.max(q.lo, r.lo) > RUN_MIN));
    const merged = near.length ? adoptLine(a, b, obstacles, near) : null;
    if (merged && pathLength(a, merged, b) <= pathLength(a, plain, b)) plain = merged;
  }
  if (!avoid || !avoid.length) return plain;
  // Leave the line only by a route about as short as the plain one. With nothing in the way, a straight link on
  // another link's line found a U-detour (40 px out and back): the awkward-angle artefact that got Stage E reverted.
  // A route that stays on course is the same length (Manhattan), so the allowance only rejects detours.
  const strict = strictSearch(a, b, obstacles, avoid);
  return strict && pathLength(a, strict, b) <= pathLength(a, plain, b) + DETOUR_ALLOWANCE ? strict : plain;
}

// The strict search's last answer per avoid set (review P4-avoid, 2026-10-15). A link keeps its avoid set until the next
// pass, and each of its routes until then ran the same strict search again: separation's final re-route of the move it
// kept, and every route outside a pass (a flush of 400 links: 734 ms, 36 ms with this). The search depends only on its
// two ends, the obstacle boxes and the avoid set, so a call with all four unchanged returns the stored answer. Avoid
// sets are never edited (a change builds a new array), so the array is the key.
const _strictMemo = new WeakMap();   // avoid array -> { ax, ay, bx, by, boxes: Float64Array, mid }
/** Strict searches actually run (memo misses), and reroute passes opened. Read by the perf guards in shared-bus.spec.js. */
export const routeStats = { strictSearches: 0, passes: 0, passMs: 0 };   // passMs: time inside routePass (link-runtime.js)
function strictSearch(a, b, obstacles, avoid) {
  const m = _strictMemo.get(avoid);
  if (m && m.ax === a.x && m.ay === a.y && m.bx === b.x && m.by === b.y && sameBoxes(m.boxes, obstacles)) return copyPts(m.mid);
  routeStats.strictSearches++;
  const mid = orthoSearch(a, b, obstacles, avoid, false);
  const boxes = new Float64Array(obstacles.length * 4);
  obstacles.forEach((o, i) => { boxes[i * 4] = o.x; boxes[i * 4 + 1] = o.y; boxes[i * 4 + 2] = o.width; boxes[i * 4 + 3] = o.height; });
  _strictMemo.set(avoid, { ax: a.x, ay: a.y, bx: b.x, by: b.y, boxes, mid: copyPts(mid) });
  return mid;
}
const copyPts = (pts) => pts && pts.map((p) => ({ x: p.x, y: p.y }));
function sameBoxes(vals, obstacles) {
  if (vals.length !== obstacles.length * 4) return false;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    if (vals[i * 4] !== o.x || vals[i * 4 + 1] !== o.y || vals[i * 4 + 2] !== o.width || vals[i * 4 + 3] !== o.height) return false;
  }
  return true;
}

const ADOPT_DIST = 64;   // a same-looking sibling's line this close (two stubs) is the same corridor: merge onto it

/** A Z through one of `lines` (strictly between a and b, so no longer than the plain route) that is clear. */
function adoptLine(a, b, obstacles, lines) {
  for (const r of lines) {
    const mid = r.o === 'H'
      ? (r.c > Math.min(a.y, b.y) && r.c < Math.max(a.y, b.y) ? [{ x: a.x, y: r.c }, { x: b.x, y: r.c }] : null)
      : (r.c > Math.min(a.x, b.x) && r.c < Math.max(a.x, b.x) ? [{ x: r.c, y: a.y }, { x: r.c, y: b.y }] : null);
    if (mid && pathClear([a, ...mid, b], obstacles) && hitsRuns([a, ...mid, b], [r])) return mid;
  }
  return null;
}

const DETOUR_ALLOWANCE = 24;   // px a route may grow to leave another link's line
const pathLength = (a, mid, b) => {
  const pts = [a, ...mid, b];
  let len = 0;
  for (let i = 0; i + 1 < pts.length; i++) len += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
  return len;
};

function orthoSearch(a, b, obstacles, avoid, allowFallback) {
  const sameY = Math.abs(a.y - b.y) < 2;
  const sameX = Math.abs(a.x - b.x) < 2;

  // Pool the SHORT candidates (the two L's + two Z's) as they are generated. When every candidate is blocked,
  // the fallback returns the LEAST-overlap one from this pool instead of a blind through-node L (D1). A clear
  // route still returns immediately below (byte-identical to before), so the pool is only consulted on the
  // fallback path. `consider` records the candidate AND returns it when clear (so the early returns stand).
  // DELIBERATELY pool ONLY the short L/Z routes: the detour + S-route candidates are long obstacle-edge huggers,
  // and choosing one as a fallback would run it collinear with other links' detours → a foreign-overlap PILE,
  // i.e. trade tunneling for collinear overlap (the banned trade the gate caught). Short L/Z stay near the
  // direct path, so the least-overlap pick reduces over-node without spawning parallel corridors.
  const pool = [];
  // TRAPPED: a stub strictly inside an obstacle's padded box. Every candidate's first (or last) segment is
  // axis-aligned and starts (ends) inside that box, so segHitsBox fails ALL of them - the detour and S-route searches
  // below could only burn O(|y|·|x|·E) tests to reach the same fallback. Skipping them returns the identical route:
  // measured 1.3 s per link at 500 elements, on every drag frame, for one vertex 10 px off a node (audit 2026-09-23).
  const trapped = insidePadded(a, obstacles) || insidePadded(b, obstacles);
  const clear = (mid) => { const pts = [a, ...mid, b]; return pathClear(pts, obstacles) && !(avoid && hitsRuns(pts, avoid)); };
  const consider = (mid) => { pool.push(mid); return !trapped && clear(mid) ? mid : null; };

  // Coincident stub tips (within 2 px on both axes): facing ports 63-65 px apart, i.e. two STUBs. Every L and Z below
  // is skipped as degenerate on BOTH axes, so the search fell through to a detour and drew a U-hook down and back up
  // one line (2026-10-12, found authoring a skill layout at a 64 px gap). The tips already meet: nothing to route.
  if (sameX && sameY) return [];

  // --- L-shapes (one turn) — skip when degenerate ---
  if (!sameY && !sameX) {
    const r = consider([{ x: b.x, y: a.y }])
           ?? consider([{ x: a.x, y: b.y }]);
    if (r) return r;
  }

  // --- Z-shapes (two turns) — skip degenerate axis ---
  if (!sameY) {
    const my = Math.round((a.y + b.y) / 2);
    const r = consider([{ x: a.x, y: my }, { x: b.x, y: my }]);
    if (r) return r;
  }
  if (!sameX) {
    const mx = Math.round((a.x + b.x) / 2);
    const r = consider([{ x: mx, y: a.y }, { x: mx, y: b.y }]);
    if (r) return r;
  }

  // --- U-shapes / detours using obstacle-edge coordinates ---
  // Collect candidate y/x values from obstacle padded edges, plus fixed offsets.
  if (!trapped) {
  const yBelow = new Set(), yAbove = new Set(), xRight = new Set(), xLeft = new Set();
  for (const box of obstacles) {
    yBelow.add(bottom(box) + PAD + 4);
    yAbove.add(box.y - PAD - 4);
    xRight.add(right(box) + PAD + 4);
    xLeft.add(box.x - PAD - 4);
  }
  // Also add fixed offsets from the stub range
  const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
  for (const off of [40, 80, 160, 300]) {
    yBelow.add(maxY + off); yAbove.add(minY - off);
    xRight.add(maxX + off); xLeft.add(minX - off);
  }

  // Sort candidates: prefer closest to midpoint
  const midY = (a.y + b.y) / 2, midX = (a.x + b.x) / 2;
  const yCandidates = [...yBelow, ...yAbove].sort((p, q) => Math.abs(p - midY) - Math.abs(q - midY));
  const xCandidates = [...xRight, ...xLeft].sort((p, q) => Math.abs(p - midX) - Math.abs(q - midX));

  // Try vertical detour (go to detourY, cross horizontally, return). NOT pooled for the least-overlap fallback:
  // these are long obstacle-edge-hugging routes, and picking one as a fallback runs it collinear with other
  // links' detours → a foreign-overlap PILE (the banned trade). A clear detour is still returned immediately.
  for (const dy of yCandidates) {
    const mid = [{ x: a.x, y: dy }, { x: b.x, y: dy }];
    if (clear(mid)) return mid;
  }
  // Try horizontal detour (go to detourX, cross vertically, return)
  for (const dx of xCandidates) {
    const mid = [{ x: dx, y: a.y }, { x: dx, y: b.y }];
    if (clear(mid)) return mid;
  }

  // --- 5-segment S-route fallback: combine x and y detours ---
  const s = firstClearS(a, b, obstacles, yCandidates, xCandidates, avoid);
  if (s) return s;
  }   // !trapped

  // Last resort: nothing is clear. Return the LEAST-overlap short candidate (L/Z) rather than a blind
  // through-node L (D1). The blind L is included as the floor, so this is never worse than the old behaviour;
  // strict `<` keeps the earliest (simplest/shortest) candidate on ties, since the pool is already in
  // preference order. A strict (avoid) search has no fallback of its own: the plain search runs next.
  if (!allowFallback) return null;
  const blindL = [{ x: b.x, y: a.y }];
  pool.push(blindL);
  let best = blindL, bestOv = Infinity;
  for (const mid of pool) {
    const ov = routeOverlap(a, mid, b, obstacles);
    if (ov < bestOv) { bestOv = ov; best = mid; }
  }
  return best;
}

/** The S-route search: the first row `dy` of `ys`, and in it the first column `dx` of `xs`, whose route
 *  a -> (dx, a.y) -> (dx, dy) -> (b.x, dy) -> b clears every PAD-padded box and, given `avoid`, every avoided run.
 *  Testing each pair with pathClear and hitsRuns cost rows x columns x boxes: a strict search that found nothing took
 *  350-750 ms on a 300-card diagram, 34 s of a 36 s pass (review PERF-SEP, 2026-10-15). The first leg depends only on
 *  the column and the last only on the row; the two middle legs clear a box exactly when the row (column) stays on the
 *  near side of one bound read per column (row), with the comparisons segHitsBox makes. So each column and row is
 *  measured once, on first use, and every pair after that costs O(1) - the same answer as the pairwise loop
 *  (dev/tests/canvas-router.test.js checks it against that loop). Pure; exported for tests. */
export function firstClearS(a, b, obstacles, ys, xs, avoid = null) {
  const n = obstacles.length;
  const x1 = new Float64Array(n), y1 = new Float64Array(n), x2 = new Float64Array(n), y2 = new Float64Array(n);
  obstacles.forEach((o, i) => { x1[i] = o.x - PAD; y1[i] = o.y - PAD; x2[i] = right(o) + PAD; y2[i] = bottom(o) + PAD; });
  const segClear = (ax, ay, bx, by) => { for (const o of obstacles) if (segHitsBox(ax, ay, bx, by, o)) return false; return true; };
  const legHits = (p, q) => { const r = axisRun(p, q); return !!r && avoid.some((v) => sharesLine(r, v)); };
  // Column j: 0 = not measured, 1 = usable, 2 = its first leg is blocked. Its second leg (vertical at dx, from a.y)
  // enters a box once it passes `down` (going down) or `up` (going up).
  const colState = new Uint8Array(xs.length), down = new Float64Array(xs.length), up = new Float64Array(xs.length);
  const column = (j) => {
    if (colState[j]) return colState[j] === 1;
    const dx = xs[j];
    if (!segClear(a.x, a.y, dx, a.y) || (avoid && legHits(a, { x: dx, y: a.y }))) { colState[j] = 2; return false; }
    let d = Infinity, u = -Infinity;
    for (let i = 0; i < n; i++) {
      if (dx <= x1[i] || dx >= x2[i]) continue;
      if (a.y < y2[i] && y1[i] < d) d = y1[i];
      if (a.y > y1[i] && y2[i] > u) u = y2[i];
    }
    colState[j] = 1; down[j] = d; up[j] = u;
    return true;
  };
  for (const dy of ys) {
    // The row: its last leg is clear, and its third leg (horizontal at dy, to b.x) enters a box once its far end
    // passes `toRight` (right of b.x) or `toLeft` (left of it).
    if (!segClear(b.x, dy, b.x, b.y) || (avoid && legHits({ x: b.x, y: dy }, b))) continue;
    let toRight = Infinity, toLeft = -Infinity;
    for (let i = 0; i < n; i++) {
      if (dy <= y1[i] || dy >= y2[i]) continue;
      if (b.x < x2[i] && x1[i] < toRight) toRight = x1[i];
      if (b.x > x1[i] && x2[i] > toLeft) toLeft = x2[i];
    }
    for (let j = 0; j < xs.length; j++) {
      const dx = xs[j];
      if (dx >= b.x ? dx > toRight : dx < toLeft) continue;
      if (!column(j)) continue;
      if (dy >= a.y ? dy > down[j] : dy < up[j]) continue;
      const mid = [{ x: dx, y: a.y }, { x: dx, y: dy }, { x: b.x, y: dy }];
      if (avoid && (legHits(mid[0], mid[1]) || legHits(mid[1], mid[2]))) continue;
      return mid;
    }
  }
  return null;
}

/** Crossed stubs: facing ports (bottom->top, top->bottom, right->left, left->right) closer than two STUBs put each stub
 *  tip past the other. orthoRoute tries an L first, which runs along the source tip's line - past the target's tip -
 *  and climbs back to it: a hook beside the arrow (random-1 l9, Auto Layout cards 48 px apart with a trunk offset).
 *  The natural route is a Z through the middle of the gap. Both stubs then trim away (dropBacktrackingStub), leaving a
 *  clean Z between the visible line ends. Returns its two corners, or null when the stubs do not cross, the ends are
 *  aligned, or the gap leaves under 4 px of line at either end (cards under 40 px apart): there no route draws
 *  cleanly, and the trim would refuse anyway. Pure + exported for unit tests. */
export function crossedStubZ(from, to, srcDir, tgtDir) {
  const v = srcDir === 'bottom' && tgtDir === 'top' ? 1 : srcDir === 'top' && tgtDir === 'bottom' ? -1 : 0;
  const h = srcDir === 'right' && tgtDir === 'left' ? 1 : srcDir === 'left' && tgtDir === 'right' ? -1 : 0;
  const s = v || h;
  if (!s) return null;
  const k = v ? 'y' : 'x', c = v ? 'x' : 'y';
  const cross = s * (to[k] - from[k]);   // < 0: each tip lies past the other
  // The visible line ends sit STUB - CP_PERP_OFFSET inside the tips; each half of the gap between them must hold 4 px.
  if (cross >= 0 || cross + 2 * (STUB - CP_PERP_OFFSET) < 8 || Math.abs(to[c] - from[c]) < 1) return null;
  const m = Math.round((from[k] + to[k]) / 2);
  return v ? [{ x: from.x, y: m }, { x: to.x, y: m }] : [{ x: m, y: from.y }, { x: m, y: to.y }];
}

// Dead-straight snap. Given the two stub points + their exit directions, if they exit on directly OPPOSING
// perpendicular sides (bottom<->top => should be one VERTICAL line; right<->left => one HORIZONTAL line) and their
// cross-axis coords differ by <= SNAP_STRAIGHT px, return COPIES pulled onto a shared mid-axis so the link renders
// dead-straight (no few-px jog). Otherwise returns plain copies, unchanged. Pure + exported for unit tests.
// Non-opposing pairs (same side, or an L-by-design corner) are left alone, so this never flattens an intended bend;
// and a field-/er-* link only snaps when it genuinely faces left<->right, where a shared y is correct ER alignment.
export function snapStubsStraight(from, to, srcDir, tgtDir) {
  const a = { ...from }, b = { ...to };
  const vOpposed = (srcDir === 'bottom' && tgtDir === 'top') || (srcDir === 'top' && tgtDir === 'bottom');
  const hOpposed = (srcDir === 'right' && tgtDir === 'left') || (srcDir === 'left' && tgtDir === 'right');
  if (vOpposed && Math.abs(a.x - b.x) <= SNAP_STRAIGHT) {
    const sx = Math.round((a.x + b.x) / 2); a.x = sx; b.x = sx;
  } else if (hOpposed && Math.abs(a.y - b.y) <= SNAP_STRAIGHT) {
    const sy = Math.round((a.y + b.y) / 2); a.y = sy; b.y = sy;
  }
  return { from: a, to: b };
}

// ── Router registration ──
export function registerSfRouter() {


  // Return {dir, stub} for a given cell+port, or null.
  function getPortInfo(cell, portId, bbox) {
    if (!cell || !bbox) return null;
    const port = (cell.get('ports')?.items || []).find(p => p.id === portId);
    if (!port?.group) return null;
    const cx = centerX(bbox);
    const cy = centerY(bbox);
    switch (port.group) {
      case 'right':      return { dir: 'right',  stub: { x: right(bbox) + STUB, y: cy } };
      case 'left':       return { dir: 'left',   stub: { x: bbox.x - STUB, y: cy } };
      case 'bottom':     return { dir: 'bottom', stub: { x: cx, y: bottom(bbox) + STUB } };
      case 'top':        return { dir: 'top',    stub: { x: cx, y: bbox.y - STUB } };
      // Field-row ports AND the header-side ER ports (er-left/er-right) all sit on a side
      // edge with an absolute y from `args.y`, so they stub out horizontally the same way.
      // Without the er-* cases this fell through to `default: null` and sfManhattan degraded
      // to a straight line for any relationship touching a header-side port.
      case 'fieldRight':
      case 'erRight':    return { dir: 'right',  stub: { x: right(bbox) + STUB, y: bbox.y + (port.args?.y || cy) } };
      case 'fieldLeft':
      case 'erLeft':     return { dir: 'left',   stub: { x: bbox.x - STUB, y: bbox.y + (port.args?.y || cy) } };
      case 'seq-left': {
        // Anchor the stub to the port's actual x (not the cell edge) so
        // participant/actor lifeline ports (which sit at 0.5*w - offset, not
        // at the cell edge) stub out from the LIFELINE, not from the wide
        // header. Activations have port x = 0, which equals their left edge
        // — same result as before.
        const px = bbox.x + resolveCalc(port.args?.x, bbox.width, bbox.height);
        const py = bbox.y + resolveCalc(port.args?.y, bbox.width, bbox.height);
        return { dir: 'left',  stub: { x: px - STUB, y: py } };
      }
      case 'seq-right': {
        const px = bbox.x + resolveCalc(port.args?.x, bbox.width, bbox.height);
        const py = bbox.y + resolveCalc(port.args?.y, bbox.width, bbox.height);
        return { dir: 'right', stub: { x: px + STUB, y: py } };
      }
      default: return null;
    }
  }

  // ── Connector grouping (CR-5.1) ──────────────────────────────────
  // Visual signature of one link END at a port: links bundle into the same
  // trunk only when these match. Uses the custom `lineStyle` prop and the
  // marker SHAPE (path `d`) on the touching end — colour is intentionally
  // ignored so same-shape links of different colours still bundle.
  //
  // The `d` string is normalised so cosmetic differences (extra whitespace,
  // commas vs spaces, leading/trailing spaces) don't split visually-identical
  // markers into separate groups. Without this, a user-drawn link and an
  // imported link with the same marker shape but slightly different `d`
  // formatting would refuse to bundle.
  function endSignature(link, end) {
    const sig = baseEndSignature(link, end);
    // A loop from one port back to the SAME port (a Data Model self-relationship drawn top to top) whose two ends
    // look alike: as one group both ends sat on one point and the loop drew as a 32 px tick above the port. Each
    // end gets its own group, so the loop draws the converter's bracket. Ends that differ already split.
    if (isSamePortLoop(link) && sig === baseEndSignature(link, end === 'source' ? 'target' : 'source')) return `${sig}|${end}`;
    return sig;
  }

  function baseEndSignature(link, end) {
    const style = link.prop('lineStyle') || 'none';
    const marker = end === 'source'
      ? link.attr('line/sourceMarker')
      : link.attr('line/targetMarker');
    let d = (marker && marker.d) ? String(marker.d) : 'none';
    d = d.replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim();
    // Shared-bus types: one trunk per LOOK (colour + dash), the owner's rule. Keyed on style alone, a blue and a dark
    // link left one port from one point and shared their first stretch, or the whole line when straight: 71% of the
    // remaining clash as loaded, 55% after Auto Layout (held-out corpus, 2026-10-13).
    return isSharedBusDiagram() ? `${linkLook(link)}|${d}` : `${style}|${d}`;
  }

  /** Both ends on one port of one cell. Such a loop has no drawable shape unless its ends take two anchors, so its
   *  port spreads even with Spread Overlapping Connectors off (spreadsAtPort). */
  // Join lanes (Data Mapping only; SQL Studio's lineage brief, owner decision 2026-10-16). A relationship between two
  // cards of one column with both ends on one side runs on its bus's own vertical (join-lanes.js): every such link
  // turned STUB out of its port, so all of them shared one line. Built once per pass or graph revision.
  function joinLaneX(gr, link) {
    const type = cctx.getDiagramType?.();
    if (type !== 'datamapping' && type !== 'datamodel') return null;
    const caches = routeCaches(gr);
    if (!caches.joinLanes) caches.joinLanes = type === 'datamodel' ? buildSideLanes(gr) : buildJoinLanes(gr);
    return caches.joinLanes.get(link.id)?.x ?? null;
  }
  // Data models (owner decision 2026-10-16, option C): links beside one column AND links facing across a gap, as buses
  // anchored on their busiest port (assignSideLanes), so a hub's composite key reads as one line per key column.
  function buildSideLanes(gr) {
    const links = [];
    for (const l of gr.getLinks()) {
      if (l.get('linkKind') === 'mapping' || l.get('router')?.name !== 'sfManhattan' || (l.get('vertices') || []).length) continue;
      const s = l.get('source'), t = l.get('target');
      const sc = s?.id && gr.getCell(s.id), tc = t?.id && gr.getCell(t.id);
      if (!sc || !tc || sc === tc || !sc.isElement?.() || !tc.isElement?.()) continue;
      const sb = sc.getBBox(), tb = tc.getBBox();
      const si = getPortInfo(sc, s.port, sb), ti = getPortInfo(tc, t.port, tb);
      if (!si || !ti || (si.dir !== 'left' && si.dir !== 'right') || (ti.dir !== 'left' && ti.dir !== 'right')) continue;
      const sameColumn = Math.max(sb.x, tb.x) < Math.min(right(sb), right(tb));
      const facing = (si.dir === 'right' && ti.dir === 'left' && right(sb) < tb.x) || (si.dir === 'left' && ti.dir === 'right' && right(tb) < sb.x);
      if (!(sameColumn && si.dir === ti.dir) && !facing) continue;
      const end = (cell, def, info, b) => ({ key: `${cell.id}::${def.port}`, edge: info.dir === 'left' ? b.x : right(b), side: info.dir, y: info.stub.y });
      links.push({ id: l.id, ends: [end(sc, s, si, sb), end(tc, t, ti, tb)] });
    }
    return assignSideLanes(links, { stub: STUB });
  }
  function buildJoinLanes(gr) {
    const items = [];
    for (const l of gr.getLinks()) {
      if (l.get('linkKind') === 'mapping' || l.get('router')?.name !== 'sfManhattan' || (l.get('vertices') || []).length) continue;
      const s = l.get('source'), t = l.get('target');
      const sc = s?.id && gr.getCell(s.id), tc = t?.id && gr.getCell(t.id);
      if (!sc || !tc || sc === tc || !sc.isElement?.() || !tc.isElement?.()) continue;
      const sb = sc.getBBox(), tb = tc.getBBox();
      const si = getPortInfo(sc, s.port, sb), ti = getPortInfo(tc, t.port, tb);
      if (!si || !ti || si.dir !== ti.dir || (si.dir !== 'left' && si.dir !== 'right')) continue;
      if (Math.max(sb.x, tb.x) >= Math.min(right(sb), right(tb))) continue;   // not one column: an ordinary route
      items.push({ id: l.id, side: si.dir, edge: si.dir === 'left' ? Math.min(sb.x, tb.x) : Math.max(right(sb), right(tb)),
        ports: [`${s.id}::${s.port}`, `${t.id}::${t.port}`], y1: Math.min(si.stub.y, ti.stub.y), y2: Math.max(si.stub.y, ti.stub.y) });
    }
    return assignJoinLanes(items, { stub: STUB });
  }

  function isSamePortLoop(link) {
    const s = link.get('source'), t = link.get('target');
    return !!(s?.id && s.id === t?.id && s.port && s.port === t.port);
  }

  /** True when the link ends at this port spread along the edge: Spread Overlapping Connectors on, or the port carries a
   *  same-port loop. The router and the connection point must agree, or the line and its stub part and the end draws
   *  diagonally. Per PORT, not per link: spreading only the loop's ends ranked them among ends left at the centre, so
   *  one loop end sat where another link started and that link ran along the bracket's top line (review S5-7). */
  function spreadsAtPort(gr, cellId, portId) {
    if (cctx.isConnectorGroupingEnabled()) return true;
    if (!gr || !cellId || !portId) return false;
    const caches = routeCaches(gr);
    if (!caches.loopPorts) {
      caches.loopPorts = new Set();
      for (const l of gr.getLinks()) if (isSamePortLoop(l)) caches.loopPorts.add(`${l.get('source').id}::${l.get('source').port}`);
    }
    return caches.loopPorts.has(`${cellId}::${portId}`);
  }

  // All link ends touching a physical port (cell id + port id), regardless of
  // whether the link defines that port as its source or target.
  // The edge a link enters: its target cell's side and that side's coordinate (cards in one column share it).
  function targetEdgeKey(link) {
    const t = link.get('target'), tc = t?.id ? link.graph?.getCell(t.id) : null;
    const side = tc ? getSideForPort(tc, t.port) : null;
    if (!side) return null;
    const bb = tc.getBBox();
    const edge = side === 'left' ? bb.x : side === 'right' ? bb.x + bb.width : side === 'top' ? bb.y : bb.y + bb.height;
    return { key: `${side}:${Math.round(edge)}:${linkLook(link)}`, cell: tc, side };
  }
  // True when a same-looking link entering the same column edge has a crowded (trunk-offset) target port. One scan
  // builds every column's answer, kept with the route caches: per pass, and outside a pass per graph revision (P4), so a
  // flush scans once, not once per link. It was pass-only: a link re-routed alone, outside a pass, lost the 24 px
  // lead-out and got it back on reload. With Distributed Connectors off no pass followed an edit, so it stayed lost
  // (review S5-2).
  function columnNeedsTargetLead(link) {
    const gr = link.graph;
    if (!gr) return false;
    const me = targetEdgeKey(link);
    if (!me) return false;
    const caches = routeCaches(gr);
    let cols = caches.columnLead;
    if (!cols) {
      cols = new Map();
      for (const l of caches.links) {
        const k = targetEdgeKey(l);
        if (!k) continue;
        const off = trunkAnchorOffset(l, 'target', k.cell, k.side);
        if (off != null && Math.abs(off) > 1) cols.set(k.key, true);
        else if (!cols.has(k.key)) cols.set(k.key, false);
      }
      caches.columnLead = cols;
    }
    return cols.get(me.key) === true;
  }

  // Lines of the links that share a port with `link` and look the same (orthoRoute's `prefer`, which merges only onto
  // near-parallel ones). Inside a pass only runs drawn earlier in THAT pass count: right after Auto Layout the memory
  // still holds routes for the old card positions.
  function sameLookSiblingRuns(link, srcDef, tgtDef) {
    const gr = link.graph, look = linkLook(link), out = [];
    for (const def of [srcDef, tgtDef]) {
      if (!def?.id || !def.port) continue;
      // The port's ends come in graph order. In a pass, a sibling's line counts only if drawn in this pass, which in the
      // main loop means a sibling EARLIER in graph order. Outside a pass the same order rule applies: until 2026-10-24
      // any sibling's last line counted there, so a link refreshed outside a pass after load merged onto a LATER
      // sibling's line and the next full pass undid it - the first edit re-shaped a line it never touched (the owner's
      // Arada landscape: an amber link jumped 32 px on any drop).
      for (const e of gatherPortEnds(gr, def.id, def.port)) {
        if (!_routePass && e.link === link) break;
        if (e.link === link || linkLook(e.link) !== look) continue;
        const rec = _lastRuns.get(e.link.id);
        if (!rec || (_routePass && rec.pass !== _passNo)) continue;
        for (const r of rec.runs) out.push(r);
      }
    }
    return out;
  }

  function gatherPortEnds(gr, cellId, portId) {
    // P1: served from the port index (built in gr.getLinks() order, so the set + ordering match a scan of every
    // link exactly), the open pass's or, outside a pass, the snapshot routeCaches keeps per revision (P4).
    return routeCaches(gr).portEnds.get(cellId + '::' + portId) || [];
  }

  // Map a port group to a top/right/bottom/left side. Only standard four-side
  // ports are eligible for edge-fraction grouping; sequence lifeline ports and
  // DataObject field ports keep their natural anchor points (they're already
  // y-staggered, or carry UML semantics we don't want to disrupt).
  function portGroupToSide(group) {
    return (group === 'top' || group === 'right' || group === 'bottom' || group === 'left')
      ? group : null;
  }

  function getSideForPort(cell, portId) {
    if (!cell?.getPort || !portId) return null;
    const port = cell.getPort(portId);
    return portGroupToSide(port?.group);
  }

  // Edge-fraction offset for one link end at a congested port. When 2+ link
  // ends touch the same physical port, the cell's edge on that side is divided
  // into N+2 equal parts (where N = number of distinct semantic groups);
  // the two outer parts are corner buffers and the N inner parts each host
  // one group, anchored at its part's centre. Returns the signed offset from
  // the edge centre, along the edge's tangent direction. Null when the port
  // isn't congested or the side isn't standard.
  //
  // Same-signature link ends share the identical offset → they bundle into
  // one trunk. Different-signature groups land on distinct points spread
  // across the edge, so each crow's-foot variant / dashed line reads as its
  // own visual trunk anchored at its own spot on the cell border.
  // The offset a link end draws at along its edge. A crowded port's end takes its group's anchor (trunkAnchorOffset).
  // On shared-bus types an end alone on its port, facing a port where the link's OTHER end is shifted, takes the same
  // shift so the link draws straight. Left at the centre, it needed a jog through the gap between the cards, and when
  // a different-looking line also crossed that gap the jog gave way to a hook beside the arrow (random-8 and random-1,
  // cards 48 px apart). Only when the shifted point lies on this edge, clear of its rounded corners.
  const OPPOSITE = Object.assign(Object.create(null), { top: 'bottom', bottom: 'top', left: 'right', right: 'left' });
  const STRAIGHT_MARGIN = 12;
  function endAnchorOffset(link, end, cell, side) {
    const own = trunkAnchorOffset(link, end, cell, side);
    if (own != null || !side || !isSharedBusDiagram()) return own;
    const otherEnd = end === 'source' ? 'target' : 'source';
    const od = link.get(otherEnd);
    const oc = od?.id ? link.graph?.getCell(od.id) : null;
    const oSide = oc ? getSideForPort(oc, od.port) : null;
    if (!oSide || OPPOSITE[side] !== oSide) return null;
    const oOff = trunkAnchorOffset(link, otherEnd, oc, oSide);
    if (oOff == null || Math.abs(oOff) <= 1) return null;
    const bb = cell.getBBox(), ob = oc.getBBox();
    if (!bb || !ob) return null;
    // Facing: the other card lies beyond this side.
    const beyond = side === 'bottom' ? ob.y >= bottom(bb) : side === 'top' ? bottom(ob) <= bb.y
      : side === 'right' ? ob.x >= right(bb) : ob.x + ob.width <= bb.x;
    if (!beyond) return null;
    const vertical = side === 'top' || side === 'bottom';
    const want = (vertical ? centerX(ob) : centerY(ob)) + oOff;
    const lo = vertical ? bb.x : bb.y, hi = vertical ? right(bb) : bottom(bb);
    if (want < lo + STRAIGHT_MARGIN || want > hi - STRAIGHT_MARGIN) return null;
    return Math.round(want - (vertical ? centerX(bb) : centerY(bb)));
  }

  function trunkAnchorOffset(link, end, cell, side) {
    if (!side || !cell) return null;
    const gr = link.graph;
    if (!gr) return null;
    const portId = link.get(end)?.port;
    if (!portId) return null;
    const ends = gatherPortEnds(gr, cell.id, portId);
    if (ends.length < 2) return null;
    // NB no opposite-direction skip here (unlike linkChannelIndex below). When a port carries
    // one incoming + one outgoing link, the two lines share the SAME port anchor and stack
    // right on top of each other — exactly what Distributed Connectors exists to prevent. So
    // the trunk anchor MUST separate them on the cell edge (an earlier skip left them piled;
    // the `linkChannelIndex` skip even assumes "the trunk anchor already separates them", which
    // was false while this also skipped). The trunk-lead-out waypoint hides any exit jog, so the
    // separated entry reads clean — markers differing (arrow vs none) does NOT stop the lines
    // from overlapping, which was the wrong assumption the old skip rested on.

    // Bucket each end by visual signature, and collect the far-end coordinate
    // along the relevant axis for ordering (x for top/bottom edges, y for
    // left/right). Ordering groups by mean far-end coordinate keeps lines
    // largely parallel and prevents the auto-layout-creates-crossings issue
    // that pure alphabetical signature-sort produced.
    const tangentAxis = (side === 'top' || side === 'bottom') ? 'x' : 'y';
    const caches = routeCaches(gr), trunkKey = `${cell.id}::${portId}::${side}`;
    let order = caches.trunk.get(trunkKey);
    if (!order) {
    const buckets = new Map(); // signature → { coords: [], linkKey }
    for (const e of ends) {
      const sig = endSignature(e.link, e.end);
      let bucket = buckets.get(sig);
      if (!bucket) { bucket = { coords: [], linkKey: null }; buckets.set(sig, bucket); }
      const farRef = e.link.get(e.end === 'source' ? 'target' : 'source');
      const farCell = farRef?.id ? gr.getCell(farRef.id) : null;
      const farBB = farCell?.getBBox?.();
      if (farBB) {
        bucket.coords.push(tangentAxis === 'x'
          ? centerX(farBB)
          : centerY(farBB));
      }
      // Link-stable tiebreak key (min member link id). The SAME link presents
      // DIFFERENT signatures at its two ends (tail vs arrowhead), so a
      // signature-string tiebreak sorts that link into OPPOSITE lanes at its
      // two ports — a co-linear opposing pair then renders as two crossed
      // Z-jogs (the "short-connector fan-out loop"). The min-link-id is
      // identical viewed from either port, so tiebreaking on it gives the link
      // the same lane rank at both ends → it draws straight. See the sort below.
      const lid = String(e.link.id || '');
      if (bucket.linkKey == null || lid < bucket.linkKey) bucket.linkKey = lid;
    }
    const sigEntries = [...buckets.entries()].map(([sig, b]) => ({
      sig,
      linkKey: b.linkKey != null ? b.linkKey : sig,
      mean: b.coords.length ? b.coords.reduce((a, c) => a + c, 0) / b.coords.length : Infinity,
    }));
    // Primary: mean far-end coord (closest child gets closest anchor) — keeps
    // fans ordered by target position and crossing-free. Tiebreak (co-linear
    // case only): the group's member-link id so a link lands on the SAME lane
    // at both of its ports and renders straight instead of jogged. Final
    // tiebreak: signature, so the order stays fully deterministic.
    sigEntries.sort((a, b) =>
      a.mean - b.mean
      || (a.linkKey < b.linkKey ? -1 : a.linkKey > b.linkKey ? 1 : 0)
      || a.sig.localeCompare(b.sig));
    order = sigEntries.map(e => e.sig);
    caches.trunk.set(trunkKey, order);
    }
    const N = order.length;
    const G = order.indexOf(endSignature(link, end));
    if (G < 0) return null;

    const bb = cell.getBBox();
    if (!bb) return null;
    const edgeLen = tangentAxis === 'x' ? bb.width : bb.height;
    // Position of group G along the edge, normalised to [0,1]:
    // centre of the (G+1)-th interior part out of (N+2) total parts.
    // The visible jog this used to produce at the stub root is fixed in the
    // router itself via a perpendicular lead-out waypoint when an offset is
    // applied (see "trunk lead-out" block in joint.routers.sfManhattan) —
    // routing, not positioning, was the actual culprit.
    //
    // Math.round keeps the trunk offset on integer pixels. Without it
    // sub-pixel offsets (e.g. -0.125 * 195 = -24.375 px) put the router's
    // stub at a fractional x while JointJS rounds the connection point
    // to integer — the 0.5 px mismatch over the 16 px CP-to-stub segment
    // shows as a visible 2-4° tilt on the entering line and tilts the
    // endpoint marker accordingly. Integer offsets keep stub and CP
    // perfectly co-axial.
    const positionFraction = (G + 1.5) / (N + 2);
    return Math.round((positionFraction - 0.5) * edgeLen);
  }

  // Per-LINK channel index (CR-5.3 v2). Returns this link's position
  // among ALL link ends touching this port that head in the same
  // direction, OR null when there's nothing to spread.
  //
  // EVERY link gets its own channel — same-signature bundled links each
  // receive a distinct channel index based on target position, so they
  // fan out into visually separate buses instead of overlapping at a
  // single shared Y. This is what makes a hub-and-spoke diagram look
  // like 4 distinct connections instead of "1 line with a marker pile".
  function linkChannelIndex(link, end, cell, side) {
    if (!side || !cell) return null;
    // Self-loops bypass channel allocation. A self-loop's source and
    // target are on the same cell at different ports — its route
    // already needs to exit, go around, and come back, and adding a
    // channel offset to either end can push the lead into the cell
    // itself or otherwise produce the weird tangle reported in user
    // testing (two-node diagram with non-arrow trunk endings, then a
    // self-loop from field port back to top/bottom).
    if (link.get('source')?.id && link.get('source').id === link.get('target')?.id) return null;
    const gr = link.graph;
    if (!gr) return null;
    const portId = link.get(end)?.port;
    if (!portId) return null;
    const ends = gatherPortEnds(gr, cell.id, portId);
    if (ends.length < 2) return null;
    // Opposite-direction pair skip: exactly two ends at this port,
    // one source + one target. The trunk anchor already separates
    // them on the cell edge; adding a channel offset would create a
    // parallel "dance" of two lines at slightly different perpendicular
    // distances from the cell — visually noisier than helpful since
    // the two routes head to different targets anyway. The trunk
    // separation alone gives all the disambiguation needed.
    if (ends.length === 2 && ends[0].end !== ends[1].end) return null;
    // Inside a pass: every end of this port is ranked in ONE scan, then each link end is a map lookup.
    const passKey = (_routePass && _routePass.graph === gr) ? `${cell.id}::${portId}::${side}` : null;
    if (passKey) {
      let ranks = _routePass.channels.get(passKey);
      if (!ranks) { ranks = rankPortChannels(gr, cell, side, ends); _routePass.channels.set(passKey, ranks); }
      if (!ranks) return null;
      return ranks.get(`${link.id}|${end}`) || null;
    }
    const tangentAxis = (side === 'top' || side === 'bottom') ? 'x' : 'y';
    const bb = cell.getBBox();
    if (!bb) return null;
    const cellCenter = tangentAxis === 'x'
      ? centerX(bb)
      : centerY(bb);
    // Build a list of link-end records with target coordinate + direction.
    const records = ends.map(e => {
      const farRef = e.link.get(e.end === 'source' ? 'target' : 'source');
      const farCell = farRef?.id ? gr.getCell(farRef.id) : null;
      const farBB = farCell?.getBBox?.();
      if (!farBB) return null;
      const coord = tangentAxis === 'x'
        ? centerX(farBB)
        : centerY(farBB);
      return { linkEnd: e, coord, dir: coord <= cellCenter ? 'low' : 'high' };
    }).filter(Boolean);
    const myRec = records.find(r => r.linkEnd.link === link && r.linkEnd.end === end);
    if (!myRec) return null;
    // Direction-aware: only count same-direction siblings (opposite-
    // direction lines can share Y without visual conflict).
    const sameDir = records.filter(r => r.dir === myRec.dir);
    if (sameDir.length < 2) return null;
    // Sort by target coordinate so the leftmost / topmost target gets
    // channel 0 and channels increase consistently — keeps the visual
    // fan-out ordered with the targets it reaches.
    sameDir.sort((a, b) => a.coord - b.coord);
    const idx = sameDir.findIndex(r => r.linkEnd.link === link && r.linkEnd.end === end);
    if (idx < 0) return null;
    return { index: idx, count: sameDir.length };
  }

  // linkChannelIndex for EVERY end of one port at once: `${linkId}|${end}` -> { index, count } (absent = null). Same
  // records, same same-direction filter, same stable sort as the per-link path above, so the answers are identical.
  function rankPortChannels(gr, cell, side, ends) {
    const tangentAxis = (side === 'top' || side === 'bottom') ? 'x' : 'y';
    const bb = cell.getBBox();
    if (!bb) return null;
    const cellCenter = tangentAxis === 'x' ? centerX(bb) : centerY(bb);
    const records = ends.map(e => {
      const farRef = e.link.get(e.end === 'source' ? 'target' : 'source');
      const farCell = farRef?.id ? gr.getCell(farRef.id) : null;
      const farBB = farCell?.getBBox?.();
      if (!farBB) return null;
      const coord = tangentAxis === 'x' ? centerX(farBB) : centerY(farBB);
      return { linkEnd: e, coord, dir: coord <= cellCenter ? 'low' : 'high' };
    }).filter(Boolean);
    const out = new Map();
    for (const dir of ['low', 'high']) {
      const sameDir = records.filter(r => r.dir === dir);
      if (sameDir.length < 2) continue;
      sameDir.sort((a, b) => a.coord - b.coord);
      sameDir.forEach((r, index) => {
        const self = r.linkEnd.link;
        // Self-loops bypass channel allocation (see linkChannelIndex).
        if (self.get('source')?.id && self.get('source').id === self.get('target')?.id) return;
        out.set(`${self.id}|${r.linkEnd.end}`, { index, count: sameDir.length });
      });
    }
    return out;
  }

  // Shift a port's stub point along the edge tangent by `offset` so the
  // router exits perpendicular from the offset connection point (matching
  // what the custom connection-point function returns for the same link end).
  function applyTrunkOffset(info, side, offset) {
    if (offset == null || !info) return info;
    const stub = { x: info.stub.x, y: info.stub.y };
    if (side === 'top' || side === 'bottom') stub.x += offset;
    else stub.y += offset;
    return { dir: info.dir, stub };
  }


  joint.routers.sfManhattan = function(vertices, args, linkView) {
    const link = linkView.model;
    const gr = link.graph;

    // During arrowhead dragging or when link is detached, graph or endpoints
    // may be unavailable — fall back to simple routing to avoid errors.
    if (!gr) return vertices;

    const srcDef = link.get('source');
    const tgtDef = link.get('target');

    // If either end is a point (no id) — e.g. during arrowhead drag — use
    // a simple normal (straight-line) router. The manhattan router is too
    // expensive to call on every pointermove and can freeze the UI.
    // Proper routing kicks in once the arrowhead snaps to a port.
    // Every exit below that does not draw an sfManhattan route forgets the link's last one: separateForeignRuns reads the
    // memory, and a stale record kept "clashing" at a line that was gone, so the OTHER link of the pair moved off it.
    if (!srcDef?.id || !tgtDef?.id) {
      _lastRuns.delete(link.id);
      return joint.routers.normal(vertices, args, linkView);
    }

    const srcCell = gr.getCell(srcDef.id);
    const tgtCell = gr.getCell(tgtDef.id);

    // If cells have been removed from the graph (e.g. undo), bail out
    if (!srcCell || !tgtCell) { _lastRuns.delete(link.id); return vertices; }

    function getParent(cell) {
      const pid = cell?.get('parent') || (cell && cell.id === _dragHome?.id ? _dragHome.parentId : null);
      return pid ? gr.getCell(pid) : null;
    }

    const srcBBox = srcCell.getBBox();
    const tgtBBox = tgtCell.getBBox();
    let srcInfo = getPortInfo(srcCell, srcDef.port, srcBBox);
    let tgtInfo = getPortInfo(tgtCell, tgtDef.port, tgtBBox);

    // Self-loop on a sequence lifeline/activation: UML convention is to draw
    // self-messages on ONE side of the lifeline (exit right, loop down, re-
    // enter right). Without this override, a right-to-left self-loop would
    // either cross the lifeline visual or detour all the way above the
    // participant header. Force both stubs onto the source's exit side so the
    // link always stays on the same side of the lifeline.
    //
    // All three sequence shapes are lifeline-centred, so we compute the
    // anchor X from the cell's horizontal centre and stub out by the regular
    // STUB (32 px) measured from the port — matching inter-participant links
    // and guaranteeing a visible horizontal exit segment after the 16 px
    // defaultConnectionPoint offset is subtracted.
    if (srcCell === tgtCell && srcInfo && tgtInfo) {
      const type = srcCell.get('type');
      if (type === 'sf.SequenceParticipant' || type === 'sf.SequenceActor' || type === 'sf.SequenceActivation') {
        const side = srcInfo.dir === 'left' ? 'left' : 'right';
        const isNarrow = type === 'sf.SequenceActivation';
        // Port anchor X on the chosen side:
        //   Participants/Actors — port sits LIFELINE_PORT_OFFSET (8) off the
        //   cell's horizontal centre (which is the lifeline axis).
        //   Activations — ports sit on the cell edges (the narrow bar
        //   straddles the lifeline, so its edges ARE offset from the axis).
        const LIFELINE_PORT_OFFSET = 8;
        const anchorX = isNarrow
          ? (side === 'right' ? right(srcBBox) : srcBBox.x)
          : (centerX(srcBBox)
              + (side === 'right' ? LIFELINE_PORT_OFFSET : -LIFELINE_PORT_OFFSET));
        const stubX = side === 'right' ? anchorX + STUB : anchorX - STUB;
        srcInfo = { dir: side, stub: { x: stubX, y: srcInfo.stub.y } };
        tgtInfo = { dir: side, stub: { x: stubX, y: tgtInfo.stub.y } };
      }
    }

    if (!srcInfo || !tgtInfo) {
      _lastRuns.delete(link.id);
      return joint.routers.normal(vertices, args, linkView);
    }

    // Connector grouping (CR-5.1): when enabled, bundle links crowding the
    // same physical port into shared trunks distributed along the cell edge.
    // Applied per end independently and never to self-loops (handled by the
    // same-side override above). The router's stub for each end is shifted
    // along the edge tangent to match the corresponding offset connection
    // point computed by joint.connectionPoints.sfConnectionPoint, so the
    // stub-to-edge segment stays perpendicular and straight.
    // Hoisted so the route-building block below can read whether either end
    // has a non-trivial trunk offset and add a perpendicular lead-out.
    //
    // Self-loop note: trunk offset DOES apply to non-sequence self-loops
    // (a DataObject field-to-top loop should distribute alongside the
    // other regular links at that top port). The previous `srcCell !==
    // tgtCell` block was too broad — it skipped trunk offset for the
    // router but `sfConnectionPoint` still applied it, so the route's
    // target stub sat at (cx, ...) while the visible line endpoint sat
    // at (cx + offset, ...). The line drew diagonally between them, the
    // ~30° angled entry you observed. Now we apply trunk offset for ALL
    // links except the sequence-self-loop special case which is
    // handled by the same-side override above.
    const _isSequenceSelfLoop = srcCell === tgtCell && (
      srcCell.get('type') === 'sf.SequenceParticipant' ||
      srcCell.get('type') === 'sf.SequenceActor' ||
      srcCell.get('type') === 'sf.SequenceActivation'
    );
    let sOff = null, tOff = null;
    if (!_isSequenceSelfLoop) {
      const sSide = spreadsAtPort(gr, srcCell.id, srcDef.port) ? getSideForPort(srcCell, srcDef.port) : null;
      const tSide = spreadsAtPort(gr, tgtCell.id, tgtDef.port) ? getSideForPort(tgtCell, tgtDef.port) : null;
      sOff = sSide ? endAnchorOffset(link, 'source', srcCell, sSide) : null;
      tOff = tSide ? endAnchorOffset(link, 'target', tgtCell, tSide) : null;
      srcInfo = applyTrunkOffset(srcInfo, sSide, sOff);
      tgtInfo = applyTrunkOffset(tgtInfo, tSide, tOff);
    }

    // Build obstacle list — includes source and target so routes go AROUND them
    // (stubs are already outside the padded zones since STUB > PAD).
    // Exclude only: zones, text labels, parent containers of embedded nodes,
    // AND the source/target cell itself for SEQUENCE self-loops — the stub
    // override above places sequence self-loop stubs at lifeline±32 px (INSIDE
    // the cell's padded bbox for wide participants) so the cell must be pass-
    // through for its own loop to route. For every other self-loop the stubs
    // are outside the bbox, so keeping the cell as an obstacle forces the
    // route to go AROUND the node instead of cutting through it.
    const obstacles = [];
    const excludeIds = new Set();
    // Every FRAME an endpoint sits inside is pass-through for its own links - the whole ancestor chain, not only a
    // Container parent. A Task inside a Subprocess / Loop / TaskGroup (or a Task inside a TaskGroup) had its stub INSIDE
    // a padded obstacle: every such link routed through its siblings AND hit orthoRoute's worst case (60 elements:
    // 0.6 -> 22 ms per reroute pass). connector-routing-detail.md always said "their embedding container".
    for (const cell of [srcCell, tgtCell]) {
      const seen = new Set([cell.id]);
      let p = getParent(cell);
      while (p && !seen.has(p.id)) {
        seen.add(p.id);
        if (FRAME_TYPES.has(p.get('type'))) excludeIds.add(p.id);
        p = getParent(p);
      }
    }
    if (srcCell === tgtCell) {
      const t = srcCell.get('type');
      if (t === 'sf.SequenceParticipant' || t === 'sf.SequenceActor' || t === 'sf.SequenceActivation') {
        excludeIds.add(srcCell.id);
      }
    }

    // P1: reuse the snapshotted bboxes (getBBox run once for the whole pass, or outside a pass once per graph
    // revision, P4) and just apply this link's per-link exclusions. OBSTACLE_SKIP_TYPES was applied when the snapshot
    // was built, in graph order - see the note on OBSTACLE_SKIP_TYPES for why Zone/TextLabel/Note/BPMN-pool/Gantt/
    // Sequence shapes are pass-through for routing.
    for (const o of routeCaches(gr).boxes) if (!excludeIds.has(o.id)) obstacles.push(o.box);

    // Dead-straight snap (v1.19.0.28): pull a near-collinear opposing-side pair onto one shared axis so the link
    // renders with ZERO jog. Only LOCAL stub copies are nudged - no cell moves, nothing persists, it re-runs every
    // paint (self-heals after a drag). See snapStubsStraight.
    const { from, to } = snapStubsStraight(srcInfo.stub, tgtInfo.stub, srcInfo.dir, tgtInfo.dir);

    // A Data Mapping join on its own lane (joinLaneX): out to the lane, along it, back in. Taken only when nothing
    // stands in the way (a wider card further out in the column); otherwise the ordinary search below routes it.
    if (!vertices.length) {
      const lx = joinLaneX(gr, link);
      if (lx != null) {
        const lane = [from, { x: lx, y: from.y }, { x: lx, y: to.y }, to]
          .filter((p, i, a) => i === 0 || p.x !== a[i - 1].x || p.y !== a[i - 1].y);
        if (pathClear(lane, obstacles)) { remember(link, lane, false); return lane; }
      }
    }

    // --- Trunk lead-out -----------------------------------------------
    // When a stub is shifted along the cell edge by a non-zero trunk offset,
    // orthoRoute is free to turn immediately at the stub — and it usually
    // does, producing a visible horizontal jog right at the marker root.
    // The previous (G + 1.5) / (N + 2) spacing only hid this for the rare
    // case where a group's offset happened to be 0 (the middle of odd N).
    // The proper fix is in the route, not the position: insert one extra
    // waypoint past each offset stub along the same perpendicular direction,
    // so orthoRoute starts from there. The jog then happens LEAD_OUT pixels
    // further from the cell, hidden inside the orthogonal route geometry,
    // and the visible exit stays perpendicular for the full stub+lead-out
    // length regardless of N parity.
    const LEAD_OUT = 24;
    const extendPerp = (pt, dir, dist) => {
      switch (dir) {
        case 'top':    return { x: pt.x, y: pt.y - dist };
        case 'bottom': return { x: pt.x, y: pt.y + dist };
        case 'left':   return { x: pt.x - dist, y: pt.y };
        case 'right':  return { x: pt.x + dist, y: pt.y };
        default: return pt;
      }
    };
    // Per-link channel allocation (CR-5.3 v2). Each link end at a
    // crowded port gets its own srcLead.y / tgtLead.x channel so
    // sibling links fan out into visually distinct buses instead of
    // sharing one Y level. The lead-out point IS the channel pivot —
    // changing its position by N px deepens or shortens the
    // perpendicular run-up from the cell stub to the bus, and the bus
    // itself lands at the channel Y. The perpendicular stub stays
    // perfectly vertical (no angle artifacts).
    //
    // Direction-awareness: opposite-direction siblings (one going
    // left, one going right) skip the spread because their bus X
    // ranges don't overlap — they can share the same Y axis safely.
    // Match the same "all links except sequence self-loops" gating
    // used by the trunk offset block above. linkChannelIndex itself
    // still returns null for any self-loop (handled inside that fn).
    const _sSide = cctx.isConnectorGroupingEnabled() && !_isSequenceSelfLoop
      ? getSideForPort(srcCell, srcDef.port) : null;
    const _tSide = cctx.isConnectorGroupingEnabled() && !_isSequenceSelfLoop
      ? getSideForPort(tgtCell, tgtDef.port) : null;
    const _perLinkChannels = !SHARED_BUS_TYPES.has(cctx.getDiagramType?.());
    const _srcChannel = _perLinkChannels && _sSide ? linkChannelIndex(link, 'source', srcCell, _sSide) : null;
    const _tgtChannel = _perLinkChannels && _tSide ? linkChannelIndex(link, 'target', tgtCell, _tSide) : null;

    // Lead-out gate: ALSO require the perpendicular gap between
    // source and target stubs be large enough for two LEAD_OUTs +
    // guard to fit without inversion. Without this check, close-cell
    // pairs (gap < ~112 px) get srcLead pushed past tgtLead by the
    // default LEAD_OUT alone — orthoRoute then routes "down past the
    // target, sideways, and back up" producing the S-shape loop the
    // per-link channel clamp can't fix (the channel shift is +/- 8,
    // but the LEAD_OUT itself is +24).  When the gate fails, both
    // leads are skipped: route falls back to direct stub-to-stub
    // routing, which is naturally loop-free.
    const _perpDist = (srcInfo.dir === 'bottom' || srcInfo.dir === 'top')
      ? Math.abs(to.y - from.y)
      : Math.abs(to.x - from.x);
    const _leadOutSafe = _perpDist > (2 * LEAD_OUT + 16);

    // Lead-out is needed when EITHER a trunk offset exists (avoid the
    // horizontal-jog artifact at the stub root) OR a channel applies
    // (need a lead waypoint to shift). Single-link ports with no
    // sibling channel still skip the lead-out.
    // Shared-bus columns: a target lead-out comes from a crowded target port, so ONE link into a column of cards could
    // turn 24 px off the others' bus (MC Personalization -> Web at x = 1432 while its three siblings, and MC Engagement
    // -> Direct, turned at 1456: only Web's port carries two arrowhead styles). When any same-looking link into a
    // column edge takes one, all of them do, and they share one bus. Per fan-out was not enough: a link from another
    // source into the same column then crossed a branch right at its arrow. (Dropping lead-outs instead moved lines
    // into frames, where the label resolver - which treats frames as obstacles - could not move a label off a card.)
    const _needSrcLead = _leadOutSafe && ((sOff != null && Math.abs(sOff) > 1) || (_srcChannel != null));
    const _needTgtLead = _leadOutSafe && ((tOff != null && Math.abs(tOff) > 1) || (_tgtChannel != null)
      || (!_perLinkChannels && columnNeedsTargetLead(link)));
    let srcLead = _needSrcLead ? extendPerp(from, srcInfo.dir, LEAD_OUT) : null;
    let tgtLead = _needTgtLead ? extendPerp(to, tgtInfo.dir, LEAD_OUT) : null;

    // Per-link channel offset clamping (CR-5.5). The naive channel
    // offset can push srcLead past the opposite stub (tgtLead/to)
    // along the perpendicular axis, causing orthoRoute to emit an
    // S-shape "loop" route that goes deep-past-target then doubles
    // back. We clamp each link's offset against the OPPOSITE end's
    // stub position so the lead can never cross it (minus a 16 px
    // guard for the orthoRoute's first turn). Per-link is more
    // surgical than a global "disable channels for close cells"
    // gate: well-spaced sibling pairs in the same crowded port still
    // get full spread; only links whose specific target geometry
    // would cause inversion get clamped to a safe partial offset.
    const _channelGuard = 16;
    const applyChannelShift = (lead, side, channelInfo, oppositeStub) => {
      if (!lead || !channelInfo) return lead;
      let offset = (channelInfo.index - (channelInfo.count - 1) / 2) * CHANNEL_HEIGHT;
      if (oppositeStub) {
        if (side === 'bottom') {
          // Lead is below source; must stay above oppositeStub.y - guard.
          const maxOff = (oppositeStub.y - _channelGuard) - lead.y;
          if (offset > maxOff) offset = Math.max(0, maxOff);
        } else if (side === 'top') {
          // Lead is above source; must stay below oppositeStub.y + guard.
          const minOff = (oppositeStub.y + _channelGuard) - lead.y;
          if (offset < minOff) offset = Math.min(0, minOff);
        } else if (side === 'right') {
          const maxOff = (oppositeStub.x - _channelGuard) - lead.x;
          if (offset > maxOff) offset = Math.max(0, maxOff);
        } else if (side === 'left') {
          const minOff = (oppositeStub.x + _channelGuard) - lead.x;
          if (offset < minOff) offset = Math.min(0, minOff);
        }
      }
      if (side === 'top' || side === 'bottom') {
        return { x: lead.x, y: lead.y + offset };
      }
      return { x: lead.x + offset, y: lead.y };
    };
    // The opposite-stub bound prevents srcLead from crossing the target
    // stub and tgtLead from crossing the source stub. Using stubs (not
    // leads) as the bound avoids the chicken-and-egg of "both leads
    // depend on each other's final channel-shifted positions".
    srcLead = applyChannelShift(srcLead, _sSide, _srcChannel, to);
    tgtLead = applyChannelShift(tgtLead, _tSide, _tgtChannel, from);
    // A lead-out inside another card's padded box traps orthoRoute, whose fallback draws straight through the cards:
    // a link from the top of a column of cards 48 px apart to its bottom crossed the three between (random-8 l7).
    // From the stub itself the search goes around the column. So such a lead-out is skipped.
    if (srcLead && insidePadded(srcLead, obstacles)) srcLead = null;
    if (tgtLead && insidePadded(tgtLead, obstacles)) tgtLead = null;

    try {
      if (vertices.length > 0) {
        // User has manual vertices — respect them; no lead-out injection
        // (the user's vertices express the intended bend points already).
        const waypoints = [from, ...vertices, to];
        const route = [from];
        for (let i = 0; i < waypoints.length - 1; i++) {
          if (i > 0) route.push(waypoints[i]);
          route.push(...orthoRoute(waypoints[i], waypoints[i + 1], obstacles));
        }
        route.push(to);
        // Remember the real vertex route. Separation cannot move this link (avoid sets do not apply here), so a clash
        // with it moves the other link, off the line that is really drawn.
        remember(link, route, false);
        return route;
      }

      const orthoStart = srcLead || from;
      const orthoEnd   = tgtLead || to;
      const avoid = _perLinkChannels ? null : _avoidRuns.get(link.id);
      const prefer = _perLinkChannels ? null : sameLookSiblingRuns(link, srcDef, tgtDef);
      // Crossed stubs take the mid-gap Z when it is clear (see crossedStubZ); anything else goes to the search.
      const z = !srcLead && !tgtLead ? crossedStubZ(from, to, srcInfo.dir, tgtInfo.dir) : null;
      const zPts = z && [from, ...z, to];
      const mid = z && pathClear(zPts, obstacles) && !(avoid && hitsRuns(zPts, avoid)) && !_noCrossedZ.has(link.id) ? z
        : orthoRoute(orthoStart, orthoEnd, obstacles, avoid, prefer);
      const route = [from];
      if (srcLead) route.push(srcLead);
      route.push(...mid);
      if (tgtLead) route.push(tgtLead);
      route.push(to);
      dropBacktrackingStub(route, tgtInfo.dir, true);
      dropBacktrackingStub(route, srcInfo.dir, false);
      remember(link, route, mid === z);
      return route;
    } catch (_) {
      // Fallback to direct vertices if routing calculation errors
      _lastRuns.delete(link.id);
      return vertices;
    }
  };

  function remember(link, route, z) {
    _lastRuns.set(link.id, { pts: route.map((p) => ({ x: p.x, y: p.y })), runs: runsOf(route), look: linkLook(link), pass: _routePass ? _passNo : 0, z });
  }

  // ── Custom connection point (CR-5.1) ─────────────────────────────
  // When connector grouping is enabled and a physical port is congested
  // (≥2 link ends touch it), each link end's VISUAL termination is moved
  // along the cell's edge to its semantic group's anchor point — so the
  // line actually meets the cell border at a distinct spot, not all
  // crowding the single port centre. The router's stub for the same end
  // is shifted by the same amount, keeping the stub-to-edge segment
  // perpendicular and straight.
  //
  // Falls back to JointJS's standard `anchor` connection point (offset 16,
  // matching the original paper option) when grouping is off (a port carrying a same-port loop excepted), the port
  // isn't congested, or the side isn't one of top/right/bottom/left.
  joint.connectionPoints.sfConnectionPoint = function(line, view, magnet, opt, type, linkView) {
    const fallback = () => joint.connectionPoints.anchor(line, view, magnet, { offset: CP_PERP_OFFSET });
    try {
      const link = linkView?.model;
      const cell = view?.model;
      if (!link || !cell) return fallback();
      const end = link.get(type); // 'source' | 'target'
      if (!end?.port) return fallback();
      if (!spreadsAtPort(link.graph, cell.id, end.port)) return fallback();
      const side = getSideForPort(cell, end.port);
      if (!side) return fallback();
      const offset = endAnchorOffset(link, type, cell, side);
      if (offset == null) return fallback();
      const bb = cell.getBBox();
      const cx = centerX(bb);
      const cy = centerY(bb);
      // Must return a g.Point — JointJS calls .round() on the result.
      switch (side) {
        case 'top':    return new joint.g.Point(cx + offset, bb.y - CP_PERP_OFFSET);
        case 'bottom': return new joint.g.Point(cx + offset, bottom(bb) + CP_PERP_OFFSET);
        case 'left':   return new joint.g.Point(bb.x - CP_PERP_OFFSET, cy + offset);
        case 'right':  return new joint.g.Point(right(bb) + CP_PERP_OFFSET, cy + offset);
        default:       return fallback();
      }
    } catch (_) {
      return fallback();
    }
  };

}

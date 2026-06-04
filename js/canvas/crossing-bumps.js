// Crossing-bumps domain — EDA-style "jump-over" arcs where two orthogonal
// links cross without connecting. Extracted from canvas.js (Phase 4, Slice 5):
// detection/draw calculation, the overlay layer + debounced scheduler, and the
// Display toggle. The focus-tinting that re-strokes bump arcs on hover/select
// stays in canvas.js (selection-viz) and reads the layer via getBumpLayer().
// Reads the live graph/paper via cctx; initCrossingBumps() returns the scheduler
// for canvas.js to wire into cctx.scheduleCrossingBumpRecompute.
import { cctx } from './context.js?v=1.14.1';

// ── Bridge notation at link crossings (CR-5.2 PoC) ───────────────────
// EDA-style "jump over" arcs at points where two orthogonal links cross
// without being connected. The link drawn later (higher z, on top in SVG
// paint order) stays straight; the one underneath gets a small semi-
// circular bump arc going OVER the perpendicular line, making the non-
// connection explicit. Pure overlay layer — no mutation of JointJS link
// paths, so the documented Safari <marker>-cache and dasharray-bleed bugs
// (GOTCHAS §1.x) don't apply: we use only <rect>, <line>, <path>.
const CROSSING_BUMPS_LS_KEY = 'sfdiag::crossingBumps';
export function isCrossingBumpsEnabled() {
  try {
    const v = localStorage.getItem(CROSSING_BUMPS_LS_KEY);
    if (v === null) return true;          // default ON for the PoC
    return v === 'true';
  } catch { return true; }
}
export function setCrossingBumpsEnabled(v) {
  try { localStorage.setItem(CROSSING_BUMPS_LS_KEY, String(!!v)); } catch {}
  refreshCrossingBumps();
}

function refreshCrossingBumps() {
  if (typeof scheduleCrossingBumpRecompute === 'function') {
    scheduleCrossingBumpRecompute();
  }
}

// ── Bridge notation: crossing-bump overlay (CR-5.2 PoC) ─────────────
// See top-of-file `isCrossingBumpsEnabled` comment block for rationale.
// Implementation summary: collect every orthogonal segment from every
// link, find pairwise (horizontal × vertical) intersections that aren't
// near a vertex (T-junction at a trunk), and per crossing draw three
// SVG primitives in a dedicated overlay group sitting above the cells
// layer.  The link with the LOWER z bumps under the link with the
// higher z (JointJS paints higher-z later → on top → straight). Pure
// overlay — JointJS link paths are never touched.
const BUMP_RADIUS = 5;             // semicircle radius — diameter 10 px matches the "O" in the zero-to-many endpoint marker (a 5 5 arc)
const BUMP_DEBOUNCE_MS = 60;
// Buffer sized to distinguish two specific geometries:
//   - Stub overlap at a shared port: crossing point IS at a segment
//     endpoint (distance 0) → skipped because the line "ends here",
//     not actually crossing through.
//   - Channel-gap escape: crossing point is ~16 px from the segment
//     endpoint (one CHANNEL_HEIGHT) → still bumped because the line
//     visually crosses through the other line (just with a short upper
//     arm due to channel allocation).
// Buffer 8 sits between the two — catches the 0-px stub case while
// leaving the 16-px channel cases as legitimate visual crossings.
const BUMP_ENDPOINT_BUFFER = 8;
const BUMP_ORTHO_TOL = 1.5;        // tolerate up to 1.5 px of axis-drift when classifying a segment as H/V (was 0.5 — router output isn't always perfectly integer-aligned)
let _bumpLayer = null;
let _bumpRecomputeTimer = null;
let scheduleCrossingBumpRecompute = null;
// True while an element is being dragged. The bumps are a pure overlay
// recomputed from link routes, so we clear them on drag start and redraw once
// on drop — rather than re-running the O(S²) crossing detection + SVG rebuild
// every pointermove, which lagged a frame behind the live-rerouting connectors.
let _draggingElement = false;

export function initCrossingBumps() {
  const { graph, paper } = cctx;
  if (!paper || !graph) return;
  // Anchor the overlay inside the panned/zoomed layers group so it
  // tracks pan + zoom for free.  Insert just after the cells layer so
  // it paints above all links but below the tools layer (resize handles).
  const cellsLayer = paper.svg?.querySelector?.('.joint-cells-layer');
  const layersGroup = cellsLayer?.parentNode;
  if (!layersGroup) return;
  _bumpLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  _bumpLayer.setAttribute('class', 'sf-link-bumps');
  _bumpLayer.setAttribute('pointer-events', 'none');
  layersGroup.insertBefore(_bumpLayer, cellsLayer.nextSibling);

  scheduleCrossingBumpRecompute = () => {
    clearTimeout(_bumpRecomputeTimer);
    _bumpRecomputeTimer = setTimeout(recomputeCrossingBumps, BUMP_DEBOUNCE_MS);
  };

  // Recompute on anything that could change a route or stroke styling.
  graph.on(
    'add remove change:source change:target change:vertices change:router '
    + 'change:position change:size change:z change:attrs',
    scheduleCrossingBumpRecompute,
  );
  // Graph swap (tab switch, new diagram, JSON load) runs through graph.fromJSON
  // → resetCells, which fires a single 'reset' event — NOT the per-cell add /
  // remove the trigger above listens for. Without handling it the previous
  // graph's arcs survive the swap: they persist on a new (empty) diagram until
  // the next add (no render:done pass with zero cells), and flash on an incoming
  // tab until the debounced recompute catches up. Clear the overlay
  // SYNCHRONOUSLY here so stale arcs never outlive their graph, then schedule a
  // recompute to draw the incoming graph's bumps once its routes settle.
  graph.on('reset', () => {
    if (_bumpLayer) {
      while (_bumpLayer.firstChild) _bumpLayer.removeChild(_bumpLayer.firstChild);
    }
    scheduleCrossingBumpRecompute();
  });
  // render:done fires after each JointJS render pass completes — covers
  // route recomputation triggered by router toggles (Distributed
  // Connectors etc.) that don't fire a change:vertices event on the link.
  paper.on('render:done', scheduleCrossingBumpRecompute);
  // Belt-and-braces initial pass after first paint.
  setTimeout(scheduleCrossingBumpRecompute, 150);

  // Element-drag lifecycle: hide the bumps while an element is being dragged and
  // recompute them once on drop. Tracking the arcs per-frame would re-run the
  // O(S²) crossing detection and rebuild the overlay on every pointermove — and
  // they'd still visibly trail the live-rerouting connectors — so we clear on
  // drag start and redraw at the settled positions on release. (Pan/zoom need no
  // handling here: the overlay rides the .joint-layers transform for free.)
  paper.on('element:pointermove', () => {
    if (_draggingElement) return;
    _draggingElement = true;
    while (_bumpLayer.firstChild) _bumpLayer.removeChild(_bumpLayer.firstChild);
  });
  paper.on('element:pointerup', () => {
    const wasDragging = _draggingElement;
    _draggingElement = false;
    if (wasDragging) scheduleCrossingBumpRecompute();
  });

  // Sync bump opacity with selection-driven link dimming. The bumps live
  // in a separate SVG group and don't inherit the link view's CSS
  // class, so we have to re-apply opacity per-primitive when selection
  // changes. selection.js fires `sf:selection-dim-change` after it
  // toggles its dim classes.
  document.addEventListener('sf:selection-dim-change', refreshCrossingBumpOpacity);
  return scheduleCrossingBumpRecompute;
}

// Walk every tagged bump primitive and match its opacity to the dim
// state of the link it represents. Called from the selection-change
// listener; safe to call when no bumps exist (just iterates an empty
// NodeList). Far cheaper than a full re-render of the bump layer.
function refreshCrossingBumpOpacity() {
  if (!_bumpLayer) return;
  const dimmedLinkIds = new Set();
  document.querySelectorAll('.joint-link.sf-link-dimmed').forEach(el => {
    const id = el.getAttribute('model-id');
    if (id) dimmedLinkIds.add(id);
  });
  _bumpLayer.querySelectorAll('[data-link-id]').forEach(el => {
    const id = el.getAttribute('data-link-id');
    el.style.opacity = dimmedLinkIds.has(id) ? '0.18' : '';
  });
}

function recomputeCrossingBumps() {
  const { graph, paper } = cctx;
  if (!_bumpLayer || !graph || !paper) return;
  // Suppressed mid-drag: the bumps were cleared on drag start and stay hidden
  // until the drop (element:pointerup) recomputes them at the settled routes.
  if (_draggingElement) return;
  while (_bumpLayer.firstChild) _bumpLayer.removeChild(_bumpLayer.firstChild);
  if (!isCrossingBumpsEnabled()) return;

  // Collect every orthogonal segment with per-link styling.
  const segments = [];
  for (const link of graph.getLinks()) {
    const view = paper.findViewByModel(link);
    if (!view) continue;
    const linkSegs = getLinkOrthogonalSegments(view);
    if (linkSegs.length === 0) continue;
    const stroke = link.attr('line/stroke') || '#888888';
    const strokeWidth = +link.attr('line/strokeWidth') || 2;
    const z = link.get('z') || 0;
    for (const seg of linkSegs) {
      segments.push({ link, seg, stroke, strokeWidth, z });
    }
  }

  // Pairwise orthogonal-crossing detection.  O(S²) but S is small in
  // practice (tens of segments) and each test is cheap range arithmetic.
  //
  // Bus-cluster dedupe: when several sibling links share a horizontal
  // "bus" at the same Y and one V drop crosses through, every parallel
  // H produces a detection at the same (X, Y) — visually a stack of
  // identical arcs piled on each other.  Adjacent parallel routes at
  // slightly different Y values produce close-but-not-identical arcs,
  // also a visual mess.  Collapse both cases by rounding the crossing
  // position to an 8-px grid and skipping any later detection that
  // lands on a grid cell we've already drawn into.  Pairs with the
  // SMALLEST z difference (= more visually "adjacent" links) win the
  // grid cell — we collect first and sort by z-distance ascending.
  //
  // Same-port skip (v1.12.4): two links exiting the same port at one
  // cell (e.g., multiple lines from Decision's bottom port to different
  // targets) should NEVER bump against each other — they're related
  // routes from a shared anchor, not actual crossings. Without this
  // check, channel-allocated sibling stubs at the source produced false
  // bumps where one sibling's vertical stub crossed another sibling's
  // horizontal bus.
  const crossings = [];
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i];
      const b = segments[j];
      if (a.link === b.link) continue;       // same link self-bend — skip
      const cross = findOrthoCrossing(a.seg, b.seg, BUMP_ENDPOINT_BUFFER);
      if (!cross) continue;
      // No separate sibling/bundled check needed — the OR-endpoint
      // skip inside findOrthoCrossing handles every "lines branch or
      // meet" geometry (sibling stubs, escapes, T-junctions) by virtue
      // of the crossing being close to a segment endpoint in all those
      // cases. Only true 4-way crossings get past findOrthoCrossing.
      const [under, over] = a.z <= b.z ? [a, b] : [b, a];
      const underIsH = Math.abs(under.seg.a.y - under.seg.b.y) < BUMP_ORTHO_TOL;
      crossings.push({ cross, under, over, underIsH, zGap: Math.abs(a.z - b.z) });
    }
  }
  crossings.sort((x, y) => x.zGap - y.zGap);
  const drawnCells = new Set();
  const GRID = 8;
  for (const c of crossings) {
    const key = `${Math.round(c.cross.x / GRID)},${Math.round(c.cross.y / GRID)}`;
    if (drawnCells.has(key)) continue;
    drawnCells.add(key);
    drawBumpOverlay(_bumpLayer, c.cross.x, c.cross.y, c.underIsH, c.under, c.over);
  }
  // After a full re-render the primitives start at default opacity;
  // re-apply the current selection-dim state so newly-drawn bumps don't
  // pop to full brightness when selection-driven dimming is active.
  refreshCrossingBumpOpacity();
}

function getLinkOrthogonalSegments(linkView) {
  const route = linkView.route || [];
  const src = linkView.sourcePoint;
  const tgt = linkView.targetPoint;
  if (!src || !tgt) return [];
  const points = [
    { x: src.x, y: src.y },
    ...route.map(p => ({ x: p.x, y: p.y })),
    { x: tgt.x, y: tgt.y },
  ];
  // Stub-zone classification radius. Sized to cover STUB(32) + LEAD_OUT(24)
  // + max channel offset (~24 for 4 bundled siblings) + small slack = 90 px.
  // A segment is "in source stub" only when BOTH endpoints are inside this
  // radius from sourcePoint — so the V stub (port→srcStub→srcLead) qualifies
  // but the H bus (srcLead→busTurn, where busTurn reaches the target's x)
  // does NOT, because its busTurn endpoint sits far from the source whenever
  // the target is more than ~90 px away. That distinction is exactly what
  // separates the false-positive "sibling stubs overlap" case from the real
  // "V-drop crosses sibling's H-bus out in the middle of the route" case.
  const STUB_ZONE_DIST = 90;
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const isH = Math.abs(a.y - b.y) < BUMP_ORTHO_TOL;
    const isV = Math.abs(a.x - b.x) < BUMP_ORTHO_TOL;
    if (!isH && !isV) continue;
    const maxDistSrc = Math.max(
      Math.hypot(a.x - src.x, a.y - src.y),
      Math.hypot(b.x - src.x, b.y - src.y),
    );
    const maxDistTgt = Math.max(
      Math.hypot(a.x - tgt.x, a.y - tgt.y),
      Math.hypot(b.x - tgt.x, b.y - tgt.y),
    );
    out.push({
      a, b,
      inSourceStub: maxDistSrc <= STUB_ZONE_DIST,
      inTargetStub: maxDistTgt <= STUB_ZONE_DIST,
    });
  }
  return out;
}

function findOrthoCrossing(segA, segB, buffer) {
  const aIsH = Math.abs(segA.a.y - segA.b.y) < BUMP_ORTHO_TOL;
  const aIsV = Math.abs(segA.a.x - segA.b.x) < BUMP_ORTHO_TOL;
  const bIsH = Math.abs(segB.a.y - segB.b.y) < BUMP_ORTHO_TOL;
  const bIsV = Math.abs(segB.a.x - segB.b.x) < BUMP_ORTHO_TOL;
  if (!((aIsH && bIsV) || (aIsV && bIsH))) return null;
  const h = aIsH ? segA : segB;
  const v = aIsV ? segA : segB;
  const hY = h.a.y;
  const vX = v.a.x;
  const hXMin = Math.min(h.a.x, h.b.x);
  const hXMax = Math.max(h.a.x, h.b.x);
  const vYMin = Math.min(v.a.y, v.b.y);
  const vYMax = Math.max(v.a.y, v.b.y);

  // Step 1 — must geometrically overlap (cross point lies on both segments).
  if (vX < hXMin || vX > hXMax || hY < vYMin || hY > vYMax) return null;

  // Step 2 — only TRUE 4-way crossings get bumped: both segments must
  // pass THROUGH the crossing point (extend on both sides of it),
  // neither one ending at the crossing. This skips:
  //   - T-junctions (one segment ends at the crossing)
  //   - "Escape from parallel flow" (one sibling just turned a corner
  //     and the crossing sits close to that fresh corner)
  //   - Bundled-stub overlaps (sibling V-stubs at the same trunk x,
  //     crossing point close to one's lead endpoint)
  // All three of those visually represent "lines branching" or
  // "lines meeting", not actual crossings — drawing a bump on them
  // produces visual noise that the eye reads as confusing rather
  // than clarifying. Real 4-way crossings between unrelated routes
  // still get bumped because neither endpoint is close to the
  // crossing for either segment.
  const atHEnd = Math.abs(vX - h.a.x) < buffer || Math.abs(vX - h.b.x) < buffer;
  const atVEnd = Math.abs(hY - v.a.y) < buffer || Math.abs(hY - v.b.y) < buffer;
  if (atHEnd || atVEnd) return null;

  return { x: vX, y: hY };
}

function drawBumpOverlay(layer, cx, cy, underIsH, under, over) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const R = BUMP_RADIUS;
  const sw = under.strokeWidth;
  // Half stroke-width as the eraser's perpendicular half-height. The old
  // sw + 1 px buffer was visible against the grid dots — we minimise the
  // eraser to ~sw and rely on the arc + restoration segments overlapping
  // the line ends to mask anti-alias bleed.
  const eHalf = sw / 2;
  // Arc-end stubs that extend the arc 0.5 px PAST the eraser boundary on
  // each side, so the arc joins the bumped line cleanly without a visible
  // gap where the stroke caps meet perpendicular to each other.
  const STUB = 0.5;

  // 1. Eraser — minimal bg-coloured rect aligned along the bumped segment,
  //    just thick enough to hide the line's stroke at the crossing.
  const eraser = document.createElementNS(SVG_NS, 'rect');
  if (underIsH) {
    eraser.setAttribute('x', cx - R);
    eraser.setAttribute('y', cy - eHalf);
    eraser.setAttribute('width', R * 2);
    eraser.setAttribute('height', sw);
  } else {
    eraser.setAttribute('x', cx - eHalf);
    eraser.setAttribute('y', cy - R);
    eraser.setAttribute('width', sw);
    eraser.setAttribute('height', R * 2);
  }
  eraser.setAttribute('fill', 'var(--bg-canvas, #1A1A1A)');
  // No data-link-id on the eraser — it's always bg-coloured so dimming
  // wouldn't change anything visually.
  layer.appendChild(eraser);

  // 2. Restoration — short perpendicular segment in the THROUGH link's
  //    stroke that re-paints the line across the eraser gap, so the
  //    straight link reads as continuous through the crossing.
  const restore = document.createElementNS(SVG_NS, 'line');
  if (underIsH) {
    restore.setAttribute('x1', cx);
    restore.setAttribute('x2', cx);
    restore.setAttribute('y1', cy - eHalf);
    restore.setAttribute('y2', cy + eHalf);
  } else {
    restore.setAttribute('y1', cy);
    restore.setAttribute('y2', cy);
    restore.setAttribute('x1', cx - eHalf);
    restore.setAttribute('x2', cx + eHalf);
  }
  restore.setAttribute('stroke', over.stroke);
  restore.setAttribute('stroke-width', over.strokeWidth);
  restore.setAttribute('stroke-linecap', 'butt');
  // The restoration line paints the THROUGH link's stroke across the
  // eraser gap; its dim state follows the OVER link.
  restore.setAttribute('data-link-id', over.link.id);
  layer.appendChild(restore);

  // 3. Bump arc — semicircle in the BUMPED link's stroke. The path starts
  //    with a tiny straight stub OUTSIDE the eraser boundary, runs the
  //    semicircle, then ends with another tiny stub, so the arc joins
  //    the existing line stroke without a visible kink at the cap.
  //    `stroke-linecap: round` further smooths any sub-pixel transition.
  //    Direction convention: horizontal bumped lines arc UP, vertical
  //    bumped lines arc RIGHT — consistent across the diagram.
  const arc = document.createElementNS(SVG_NS, 'path');
  const d = underIsH
    ? `M ${cx - R - STUB} ${cy} L ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy} L ${cx + R + STUB} ${cy}`
    : `M ${cx} ${cy - R - STUB} L ${cx} ${cy - R} A ${R} ${R} 0 0 1 ${cx} ${cy + R} L ${cx} ${cy + R + STUB}`;
  arc.setAttribute('d', d);
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', under.stroke);
  arc.setAttribute('stroke-width', under.strokeWidth);
  arc.setAttribute('stroke-linecap', 'round');
  arc.setAttribute('stroke-linejoin', 'round');
  // Arc represents the BUMPED link going over the through line; dim
  // state follows the UNDER link.
  arc.setAttribute('data-link-id', under.link.id);
  layer.appendChild(arc);
}

// Accessor for the bump overlay layer — canvas.js focus-tinting re-strokes the
// bump arcs (data-link-id) on hover/select and reads the layer through this.
export function getBumpLayer() { return _bumpLayer; }

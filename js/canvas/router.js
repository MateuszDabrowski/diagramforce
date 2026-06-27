// sfManhattan — the custom orthogonal link router (32px stubs, 16px obstacle
// padding, trunk bundling, sequence self-loop handling). Extracted from
// canvas.js (Phase 4, Slice 2). The router reads the graph from each routed
// link (`link.graph`), not the module graph, so its only runtime dependency is
// the connector-grouping flag — read through the canvas context (`cctx`). The
// pure geometry helpers (resolveCalc, segHitsBox, pathClear, tryRoute,
// orthoRoute) are hoisted to module level + exported so they can be
// characterised in tests/canvas-router.test.js.

import { cctx } from './context.js?v=1.18.0.5';
import { right, bottom, centerX, centerY } from '../util/geometry.js?v=1.18.0.5';

// ── Routing geometry constants ──
const STUB = 32;  // distance from port to first turn — must exceed defaultConnectionPoint offset (16px) + arrow length (14px)
const PAD = 16;   // clearance around obstacles (must be < STUB so stubs are outside padded zones)
const CP_PERP_OFFSET = 16; // matches the original anchor offset — perpendicular stand-off from the cell edge to the visual line end
// Per-link channel allocation height (CR-5.3 v2). Each link end at a crowded
// port gets its own channel, with this many pixels between adjacent channels —
// distinct lines the eye reads as separate connections, not a "close parallel
// pile". `applyChannelShift` is the only user. (Lived in canvas.js until the
// Slice 2 router extraction; the const stayed behind, leaving this an undefined
// cross-module reference — relocating it here closes that gap.)
const CHANNEL_HEIGHT = 16;

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

// Try a candidate route; return it if clear, or null.
export function tryRoute(a, mid, b, obstacles) {
  const pts = [a, ...mid, b];
  return pathClear(pts, obstacles) ? mid : null;
}

// Build an orthogonal route between two stub points, avoiding obstacles.
// Returns intermediate waypoints (NOT including a and b themselves).
export function orthoRoute(a, b, obstacles) {
  const sameY = Math.abs(a.y - b.y) < 2;
  const sameX = Math.abs(a.x - b.x) < 2;

  // --- L-shapes (one turn) — skip when degenerate ---
  if (!sameY && !sameX) {
    const r = tryRoute(a, [{ x: b.x, y: a.y }], b, obstacles)
           ?? tryRoute(a, [{ x: a.x, y: b.y }], b, obstacles);
    if (r) return r;
  }

  // --- Z-shapes (two turns) — skip degenerate axis ---
  if (!sameY) {
    const my = Math.round((a.y + b.y) / 2);
    const r = tryRoute(a, [{ x: a.x, y: my }, { x: b.x, y: my }], b, obstacles);
    if (r) return r;
  }
  if (!sameX) {
    const mx = Math.round((a.x + b.x) / 2);
    const r = tryRoute(a, [{ x: mx, y: a.y }, { x: mx, y: b.y }], b, obstacles);
    if (r) return r;
  }

  // --- U-shapes / detours using obstacle-edge coordinates ---
  // Collect candidate y/x values from obstacle padded edges, plus fixed offsets.
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

  // Try vertical detour (go to detourY, cross horizontally, return)
  for (const dy of yCandidates) {
    const r = tryRoute(a, [{ x: a.x, y: dy }, { x: b.x, y: dy }], b, obstacles);
    if (r) return r;
  }
  // Try horizontal detour (go to detourX, cross vertically, return)
  for (const dx of xCandidates) {
    const r = tryRoute(a, [{ x: dx, y: a.y }, { x: dx, y: b.y }], b, obstacles);
    if (r) return r;
  }

  // --- 5-segment S-route fallback: combine x and y detours ---
  for (const dy of yCandidates) {
    for (const dx of xCandidates) {
      const r = tryRoute(a,
        [{ x: dx, y: a.y }, { x: dx, y: dy }, { x: b.x, y: dy }],
        b, obstacles);
      if (r) return r;
    }
  }

  // Last resort: straight L (visible overlap, better than nothing)
  return [{ x: b.x, y: a.y }];
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
    const style = link.prop('lineStyle') || 'none';
    const marker = end === 'source'
      ? link.attr('line/sourceMarker')
      : link.attr('line/targetMarker');
    let d = (marker && marker.d) ? String(marker.d) : 'none';
    d = d.replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim();
    return `${style}|${d}`;
  }

  // All link ends touching a physical port (cell id + port id), regardless of
  // whether the link defines that port as its source or target.
  function gatherPortEnds(gr, cellId, portId) {
    const ends = [];
    for (const l of gr.getLinks()) {
      const s = l.get('source');
      const t = l.get('target');
      if (s?.id === cellId && s.port === portId) ends.push({ link: l, end: 'source' });
      if (t?.id === cellId && t.port === portId) ends.push({ link: l, end: 'target' });
    }
    return ends;
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
    const buckets = new Map(); // signature → { coords: [], anySelf: boolean }
    for (const e of ends) {
      const sig = endSignature(e.link, e.end);
      let bucket = buckets.get(sig);
      if (!bucket) { bucket = { coords: [] }; buckets.set(sig, bucket); }
      const farRef = e.link.get(e.end === 'source' ? 'target' : 'source');
      const farCell = farRef?.id ? gr.getCell(farRef.id) : null;
      const farBB = farCell?.getBBox?.();
      if (farBB) {
        bucket.coords.push(tangentAxis === 'x'
          ? centerX(farBB)
          : centerY(farBB));
      }
    }
    const sigEntries = [...buckets.entries()].map(([sig, b]) => ({
      sig,
      mean: b.coords.length ? b.coords.reduce((a, c) => a + c, 0) / b.coords.length : Infinity,
    }));
    // Primary: mean far-end coord (closest child gets closest anchor).
    // Tiebreak: signature string so the order stays deterministic.
    sigEntries.sort((a, b) => a.mean - b.mean || a.sig.localeCompare(b.sig));
    const N = sigEntries.length;
    const G = sigEntries.findIndex(e => e.sig === endSignature(link, end));
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

  // Channel index for parallel-bus spreading (CR-5.3).  Returns the
  // link's index (G) within its DIRECTION-MATCHED sibling group (N
  // total) at this port, OR null when there's nothing to spread.
  //
  // Direction split: siblings whose targets sit on opposite sides of
  // the source cell's centre travel in opposite directions in the bus
  // area and their bus X ranges don't overlap — they can share the same
  // Y axis without visual conflict. Only same-direction siblings need
  // channel allocation (their bus X ranges DO overlap near the source).
  // This promotes "shared axis when no overlap" while still spreading
  // the cases where overlap would otherwise produce close-parallel piles.
  //
  // Duplicates trunkAnchorOffset's bucket build because the two end up
  // wanting different return shapes; deliberate duplication > over-
  // abstracted shared helper that mixes concerns.
  function trunkChannelIndex(link, end, cell, side) {
    if (!side || !cell) return null;
    const gr = link.graph;
    if (!gr) return null;
    const portId = link.get(end)?.port;
    if (!portId) return null;
    const ends = gatherPortEnds(gr, cell.id, portId);
    if (ends.length < 2) return null;
    const tangentAxis = (side === 'top' || side === 'bottom') ? 'x' : 'y';
    const buckets = new Map();
    for (const e of ends) {
      const sig = endSignature(e.link, e.end);
      let bucket = buckets.get(sig);
      if (!bucket) { bucket = { coords: [] }; buckets.set(sig, bucket); }
      const farRef = e.link.get(e.end === 'source' ? 'target' : 'source');
      const farCell = farRef?.id ? gr.getCell(farRef.id) : null;
      const farBB = farCell?.getBBox?.();
      if (farBB) {
        bucket.coords.push(tangentAxis === 'x'
          ? centerX(farBB)
          : centerY(farBB));
      }
    }
    const sigEntries = [...buckets.entries()].map(([sig, b]) => ({
      sig,
      mean: b.coords.length ? b.coords.reduce((a, c) => a + c, 0) / b.coords.length : Infinity,
    }));
    sigEntries.sort((a, b) => a.mean - b.mean || a.sig.localeCompare(b.sig));
    if (sigEntries.length < 2) return null;

    const mySig = endSignature(link, end);
    const myEntry = sigEntries.find(e => e.sig === mySig);
    if (!myEntry) return null;

    // Split by direction relative to the cell's centre on the tangent axis.
    const bb = cell.getBBox();
    if (!bb) return null;
    const cellCenter = tangentAxis === 'x'
      ? centerX(bb)
      : centerY(bb);
    const mySide = myEntry.mean <= cellCenter ? 'low' : 'high';
    const sameDirEntries = sigEntries.filter(e =>
      ((e.mean <= cellCenter) ? 'low' : 'high') === mySide
    );
    if (sameDirEntries.length < 2) return null;     // alone in this direction

    const G = sameDirEntries.findIndex(e => e.sig === mySig);
    if (G < 0) return null;
    return { index: G, count: sameDirEntries.length };
  }

  // Per-LINK channel index (CR-5.3 v2). Returns this link's position
  // among ALL link ends touching this port that head in the same
  // direction, OR null when there's nothing to spread.
  //
  // Differs from trunkChannelIndex in that EVERY link gets its own
  // channel — same-signature bundled links each receive a distinct
  // channel index based on target position, so they fan out into
  // visually separate buses instead of overlapping at a single shared Y.
  // This is what makes a hub-and-spoke diagram look like 4 distinct
  // connections instead of "1 line with a marker pile".
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
    if (!srcDef?.id || !tgtDef?.id) {
      return joint.routers.normal(vertices, args, linkView);
    }

    const srcCell = gr.getCell(srcDef.id);
    const tgtCell = gr.getCell(tgtDef.id);

    // If cells have been removed from the graph (e.g. undo), bail out
    if (!srcCell || !tgtCell) return vertices;

    function getParent(cell) {
      const pid = cell?.get('parent');
      return pid ? gr.getCell(pid) : null;
    }

    const srcParent = getParent(srcCell);
    const tgtParent = getParent(tgtCell);
    const EMBED_PARENT_TYPES = new Set(['sf.Container', 'sf.SequenceParticipant', 'sf.SequenceActor']);
    const srcEmbedded = EMBED_PARENT_TYPES.has(srcParent?.get('type'));
    const tgtEmbedded = EMBED_PARENT_TYPES.has(tgtParent?.get('type'));

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
    if (cctx.isConnectorGroupingEnabled() && !_isSequenceSelfLoop) {
      const sSide = getSideForPort(srcCell, srcDef.port);
      const tSide = getSideForPort(tgtCell, tgtDef.port);
      sOff = sSide ? trunkAnchorOffset(link, 'source', srcCell, sSide) : null;
      tOff = tSide ? trunkAnchorOffset(link, 'target', tgtCell, tSide) : null;
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
    if (srcEmbedded) excludeIds.add(srcParent.id);
    if (tgtEmbedded) excludeIds.add(tgtParent.id);
    if (srcCell === tgtCell) {
      const t = srcCell.get('type');
      if (t === 'sf.SequenceParticipant' || t === 'sf.SequenceActor' || t === 'sf.SequenceActivation') {
        excludeIds.add(srcCell.id);
      }
    }

    for (const el of gr.getElements()) {
      const type = el.get('type');
      if (type === 'sf.Zone' || type === 'sf.TextLabel' || type === 'sf.Note' || type === 'sf.BpmnPool' || type === 'sf.BpmnDataObject'
        || type === 'sf.GanttTimeline' || type === 'sf.GanttGroup') continue;
      // Sequence shapes are semantically pass-through — in UML a message line
      // may cross any lifeline between source and target. Treating them as
      // obstacles forces inter-participant connectors to detour around full-
      // height columns, which looks broken. Activations are excluded too so
      // messages can cross activation bars on intervening lifelines, and
      // Fragments (loop/alt/opt frames) are excluded because messages are
      // typically drawn THROUGH them. Self-loops still get the same-side
      // override above, which is independent of the obstacle set.
      if (type === 'sf.SequenceParticipant' || type === 'sf.SequenceActor'
        || type === 'sf.SequenceActivation' || type === 'sf.SequenceFragment') continue;
      if (excludeIds.has(el.id)) continue;
      const bb = el.getBBox();
      if (bb) obstacles.push({ x: bb.x, y: bb.y, width: bb.width, height: bb.height });
    }

    const from = srcInfo.stub;
    const to = tgtInfo.stub;

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
    const _srcChannel = _sSide ? linkChannelIndex(link, 'source', srcCell, _sSide) : null;
    const _tgtChannel = _tSide ? linkChannelIndex(link, 'target', tgtCell, _tSide) : null;

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
    const _needSrcLead = _leadOutSafe && ((sOff != null && Math.abs(sOff) > 1) || (_srcChannel != null));
    const _needTgtLead = _leadOutSafe && ((tOff != null && Math.abs(tOff) > 1) || (_tgtChannel != null));
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
        return route;
      }

      const orthoStart = srcLead || from;
      const orthoEnd   = tgtLead || to;
      const mid = orthoRoute(orthoStart, orthoEnd, obstacles);
      const route = [from];
      if (srcLead) route.push(srcLead);
      route.push(...mid);
      if (tgtLead) route.push(tgtLead);
      route.push(to);
      return route;
    } catch (_) {
      // Fallback to direct vertices if routing calculation errors
      return vertices;
    }
  };

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
  // matching the original paper option) when grouping is off, the port
  // isn't congested, or the side isn't one of top/right/bottom/left.
  joint.connectionPoints.sfConnectionPoint = function(line, view, magnet, opt, type, linkView) {
    const fallback = () => joint.connectionPoints.anchor(line, view, magnet, { offset: CP_PERP_OFFSET });
    try {
      if (!cctx.isConnectorGroupingEnabled()) return fallback();
      const link = linkView?.model;
      const cell = view?.model;
      if (!link || !cell) return fallback();
      const end = link.get(type); // 'source' | 'target'
      if (!end?.port) return fallback();
      const side = getSideForPort(cell, end.port);
      if (!side) return fallback();
      const offset = trunkAnchorOffset(link, type, cell, side);
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

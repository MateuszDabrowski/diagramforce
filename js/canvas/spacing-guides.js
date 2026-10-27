// Spacing guides — real-time alignment snapping + sequential-spacing rhythm
// detection with live edge-to-edge dimension labels, drawn while an element is
// dragged. Extracted from canvas.js (Phase 4, Slice 11).
//
// Two snap systems run on the element:pointermove stream:
//  1. Edge / centre alignment — snap the dragged element's edges/centre to
//     peers, with a connector-straightening override so a directly-linked
//     neighbour's centre wins (keeps the link dead straight).
//  2. Sequential spacing (CR-6.1) — detect an A→B rhythm on an axis and
//     magnetically pull the dragged element to the matching gap, with px labels.
// pointerdown lazily tags the drag; pointerup clears the cache + guide layer.
//
// Reads the live graph/paper via cctx; the guide <g> lives under .joint-layers so
// it inherits the paper transform. registerSpacingGuides(cctx) mounts the three
// listeners after cctx.graph/paper are wired. Export-neutral (all internal).
import { cctx } from './context.js?v=1.26.5';
import { right, bottom, centerX, centerY } from '../util/geometry.js?v=1.26.5';

/** `cell` sits somewhere inside `ancestor`. Replaces JointJS's isEmbeddedIn here, which walks ancestors with no
 *  visited set (a parent loop hangs the tab) and dereferences a missing parent (a dangling `parent` throws) - and this
 *  runs for every element on every pointermove, before the selection / embedding / history listeners (audit 2026-09-23). */
function isDescendantOf(cell, ancestor) {
  const g = cell.graph;
  if (!g || !ancestor) return false;
  const seen = new Set([cell.id]);
  let pid = cell.get('parent');
  while (pid != null && !seen.has(pid)) {
    if (pid === ancestor.id) return true;
    seen.add(pid);
    pid = g.getCell(pid)?.get('parent');
  }
  return false;
}

// ── Tolerances ──────────────────────────────────────────────────────
// Both snaps reach SNAP_PX SCREEN pixels, divided by the zoom (owner decision 2026-10-22). They were canvas units: 4 screen
// px at 50% zoom, 16 at 200%. And the even-spacing pull acted only strictly under 4 canvas px, the drag grid's step, so
// on a 4 px grid it never fired: the labels counted near misses (44px / 48px) while the card stepped past the spot.
const SNAP_PX = 8;
// findSequentialSpacing's default reach in canvas px, for callers without a zoom (the unit tests).
const SPACING_TOL = 10;

// ── State ───────────────────────────────────────────────────────────
// Cache built at pointerdown (lazily, on first move) so per-frame work is small;
// cleared at pointerup. Stores only the peer elements that share the dragged
// element's container context, skipping background shapes that carry no rhythm.
let _spacingDragContext = null;
let guideLayer = null;       // the <g class="df-alignment-guides"> overlay
// The other members of a multi-select drag. selection.js moves them one frame AFTER this module runs, so as peers or
// alignment targets they measured the selection against itself: the rhythm snap pulled the group back and the labels
// showed stale gaps (review H2-6). They, and their descendants, are excluded for the drag. The selection is read when
// the drag context is built on the first move, after every pointerdown listener has run, so the order the paper
// listeners were registered in does not matter. selection.js injects the getter at init.
let _getSelectedIds = () => null;
export function setSpacingSelectionSource(getter) { _getSelectedIds = getter; }
function coDraggedExclusions(moved) {
  const { graph } = cctx;
  const out = new Set();
  const ids = _getSelectedIds();
  // selection.js drags the whole selection along when the grabbed shape is one of several selected.
  if (!ids || ids.size < 2 || !ids.has(moved.id)) return out;
  for (const id of ids) {
    const c = id !== moved.id && graph.getCell(id);
    if (!c?.isElement?.()) continue;
    out.add(id);
    for (const d of c.getEmbeddedCells({ deep: true })) out.add(d.id);
  }
  return out;
}

// Background / group shapes that don't share rhythm with ordinary nodes. When an
// ORDINARY element is dragged these are skipped as peers (an object shouldn't space
// itself against a backdrop Zone). But when one of THESE is dragged it measures rhythm
// against its OWN type — so Layer zones / Pools / Notes can be spaced evenly against
// each other (the "keep layouts equidistant" case).
const NON_RHYTHM_TYPES = new Set([
  'sf.Zone', 'sf.TextLabel', 'sf.Note', 'sf.BpmnPool',
  'sf.GanttTimeline', 'sf.GanttGroup',
]);

function buildSpacingDragContext(moved, originParent) {
  const { graph } = cctx;
  if (!moved) return null;
  // A real drag of an embedded child detaches it (JointJS embeddingMode sets the
  // child's parent → null for the duration of the drag, re-embedding on drop). If
  // we read the *live* parent here it's null, so the still-embedded siblings (which
  // keep parent === zone) never match and the rhythm helper goes dark inside a
  // Zone/Container/Layer. Match against the parent captured at pointerdown instead.
  const homeParent = originParent !== undefined ? originParent : (moved.get('parent') || null);
  const movedType = moved.get('type');
  const movedIsGroup = NON_RHYTHM_TYPES.has(movedType);
  const excluded = coDraggedExclusions(moved);
  const peers = graph.getElements()
    .filter(el => {
      if (el.id === moved.id || excluded.has(el.id)) return false;
      if (el.id === homeParent) return false;          // never the container itself
      if (isDescendantOf(el, moved)) return false;
      if (isDescendantOf(moved, el)) return false;
      if (movedIsGroup) {
        // Dragging a Zone/Pool/Note/etc → rhythm against the SAME type only, so e.g.
        // Layer zones can be spaced evenly against each other.
        if (el.get('type') !== movedType) return false;
      } else if (NON_RHYTHM_TYPES.has(el.get('type'))) {
        return false;                                  // ordinary node ignores backdrops
      }
      return (el.get('parent') || null) === homeParent;
    })
    .map(el => ({ id: el.id, bb: el.getBBox() }));
  // Always return the context (peers may be empty) so the home parent stays
  // available to the edge-alignment pass; the spacing pass gates on peers.length.
  return { peers, originParent: homeParent, excluded };
}

// Look for a sequential rhythm where the dragged element extends or sits inside
// a pair of peers on the given axis, with edge-to-edge gaps matching within
// SPACING_TOL. Returns the closest match (smallest delta) or null. Three cases
// per pair (A, B) sorted by axis-center: A→B→Dragged, Dragged→A→B, A→Dragged→B.
// Exported for unit testing (S7 coverage gap — the router.js precedent). PURE: given the
// dragged element's bbox, the row/column peer bboxes ({bb}), and an axis ('x'|'y'), returns
// the closest sequential-rhythm match ({delta, expectedCenter, gap, A, B, proximity}) within
// SPACING_TOL, or null. Depends only on args + the util/geometry helpers + SPACING_TOL.
export function findSequentialSpacing(movedBB, peers, axis, tol = SPACING_TOL) {
  // Helper: get "near" and "far" edges along the axis
  const edgeNear = (bb) => axis === 'x' ? bb.x : bb.y;
  const edgeFar  = (bb) => axis === 'x' ? right(bb) : bottom(bb);
  // Row/column peers: must overlap with moved on the perpendicular axis.
  const movedPerpMin = axis === 'x' ? movedBB.y : movedBB.x;
  const movedPerpMax = movedPerpMin + (axis === 'x' ? movedBB.height : movedBB.width);
  const rowPeers = [];
  for (const p of peers) {
    const peerPerpMin = axis === 'x' ? p.bb.y : p.bb.x;
    const peerPerpMax = peerPerpMin + (axis === 'x' ? p.bb.height : p.bb.width);
    if (peerPerpMin < movedPerpMax && peerPerpMax > movedPerpMin) {
      rowPeers.push({
        bb: p.bb,
        near: edgeNear(p.bb),
        far: edgeFar(p.bb),
        center: (edgeNear(p.bb) + edgeFar(p.bb)) / 2,
      });
    }
  }
  if (rowPeers.length < 2) return null;
  rowPeers.sort((a, b) => a.center - b.center);

  const mNear = edgeNear(movedBB);
  const mFar  = edgeFar(movedBB);
  const mCenter = (mNear + mFar) / 2;

  let best = null;
  const considerMatch = (Apeer, Bpeer, expectedCenter, gap) => {
    const delta = Math.abs(mCenter - expectedCenter);
    if (delta > tol) return;
    // Spatial proximity tiebreaker: when multiple matches fall within
    // tolerance, pick the one whose peers sit nearest the dragged element
    // (the visually obvious rhythm), not a faraway pair that aligns by chance.
    const proximity = Math.abs(mCenter - Apeer.center)
                    + Math.abs(mCenter - Bpeer.center);
    if (!best
        || delta < best.delta
        || (delta === best.delta && proximity < best.proximity)) {
      best = { delta, expectedCenter, gap, A: Apeer.bb, B: Bpeer.bb, proximity };
    }
  };
  for (let i = 0; i < rowPeers.length - 1; i++) {
    const A = rowPeers[i];
    const B = rowPeers[i + 1];
    // Edge-to-edge gap between A and B (visible space).
    const gap = B.near - A.far;
    if (gap < 8) continue;     // pairs that touch or overlap — no rhythm

    // CASE 1: dragged extends sequence past B (A → B → Dragged)
    if (mCenter > B.center) {
      const expectedNear = B.far + gap;
      const expectedCenter = expectedNear + (mFar - mNear) / 2;
      considerMatch(A, B, expectedCenter, gap);
    }
    // CASE 2: dragged extends sequence before A (Dragged → A → B)
    if (mCenter < A.center) {
      const expectedFar = A.near - gap;
      const expectedCenter = expectedFar - (mFar - mNear) / 2;
      considerMatch(A, B, expectedCenter, gap);
    }
    // CASE 3: dragged sits BETWEEN A and B at equal edge-gap (A → D → B).
    // Equal-gap centres D between A.far and B.near regardless of D's width.
    if (mCenter > A.center && mCenter < B.center) {
      const innerSpan = B.near - A.far;
      const dWidth = mFar - mNear;
      const halfGap = (innerSpan - dWidth) / 2;
      if (halfGap >= 8) {
        considerMatch(A, B, (A.far + B.near) / 2, halfGap);
      }
    }
  }
  return best;
}

// Render two dimension lines + per-segment px labels showing the EDGE-TO-EDGE visible gaps, only when the two gaps are
// EQUAL (owner decision 2026-10-22): the labels confirm a snap. They used to show near misses too (44px / 52px), which
// read as the helper working while the card sat off the rhythm.
function drawSpacingDimensions(match, axis, movedBB) {
  const edges = (axis === 'x'
    ? [match.A, match.B, movedBB].map((b) => ({ near: b.x, far: right(b) }))
    : [match.A, match.B, movedBB].map((b) => ({ near: b.y, far: bottom(b) }))).sort((p, q) => p.near - q.near);
  if (Math.abs((edges[1].near - edges[0].far) - (edges[2].near - edges[1].far)) >= 0.5) return;
  const layer = getGuideLayer();
  const amber = 'var(--brand-amber, #F6B355)';
  const TICK = 4;
  const LABEL_OFFSET = 4;

  if (axis === 'x') {
    const allEdges = [
      { near: match.A.x,  far: right(match.A) },
      { near: match.B.x,  far: right(match.B) },
      { near: movedBB.x,  far: right(movedBB) },
    ].sort((p, q) => p.near - q.near);

    const baselineY = Math.max(
      bottom(match.A),
      bottom(match.B),
      bottom(movedBB),
    ) + 18;

    const gap1 = allEdges[1].near - allEdges[0].far;
    const gap2 = allEdges[2].near - allEdges[1].far;
    drawDimSegment(layer, allEdges[0].far, allEdges[1].near, baselineY, gap1, 'h', amber, TICK, LABEL_OFFSET);
    drawDimSegment(layer, allEdges[1].far, allEdges[2].near, baselineY, gap2, 'h', amber, TICK, LABEL_OFFSET);
  } else {
    const allEdges = [
      { near: match.A.y,  far: bottom(match.A) },
      { near: match.B.y,  far: bottom(match.B) },
      { near: movedBB.y,  far: bottom(movedBB) },
    ].sort((p, q) => p.near - q.near);

    const baselineX = Math.max(
      right(match.A),
      right(match.B),
      right(movedBB),
    ) + 18;

    const gap1 = allEdges[1].near - allEdges[0].far;
    const gap2 = allEdges[2].near - allEdges[1].far;
    // For 'v' orientation, p1/p2 are the Y endpoints and perp is the X baseline.
    drawDimSegment(layer, allEdges[0].far, allEdges[1].near, baselineX, gap1, 'v', amber, TICK, LABEL_OFFSET);
    drawDimSegment(layer, allEdges[1].far, allEdges[2].near, baselineX, gap2, 'v', amber, TICK, LABEL_OFFSET);
  }
}

function drawDimSegment(layer, p1, p2, perp, gap, orient, color, tick, labelOff) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const line = document.createElementNS(SVG_NS, 'line');
  const t1a = document.createElementNS(SVG_NS, 'line');
  const t1b = document.createElementNS(SVG_NS, 'line');
  const text = document.createElementNS(SVG_NS, 'text');
  if (orient === 'h') {
    // p1, p2 are X values; perp is the Y baseline.
    line.setAttribute('x1', p1); line.setAttribute('x2', p2);
    line.setAttribute('y1', perp); line.setAttribute('y2', perp);
    t1a.setAttribute('x1', p1); t1a.setAttribute('x2', p1);
    t1a.setAttribute('y1', perp - tick); t1a.setAttribute('y2', perp + tick);
    t1b.setAttribute('x1', p2); t1b.setAttribute('x2', p2);
    t1b.setAttribute('y1', perp - tick); t1b.setAttribute('y2', perp + tick);
    text.setAttribute('x', (p1 + p2) / 2);
    text.setAttribute('y', perp - labelOff);
    text.setAttribute('text-anchor', 'middle');
  } else {
    // p1, p2 are Y values; perp is the X baseline.
    line.setAttribute('x1', perp); line.setAttribute('x2', perp);
    line.setAttribute('y1', p1); line.setAttribute('y2', p2);
    t1a.setAttribute('x1', perp - tick); t1a.setAttribute('x2', perp + tick);
    t1a.setAttribute('y1', p1); t1a.setAttribute('y2', p1);
    t1b.setAttribute('x1', perp - tick); t1b.setAttribute('x2', perp + tick);
    t1b.setAttribute('y1', p2); t1b.setAttribute('y2', p2);
    text.setAttribute('x', perp + labelOff + 2);
    text.setAttribute('y', (p1 + p2) / 2 + 4);
    text.setAttribute('text-anchor', 'start');
  }
  for (const el of [line, t1a, t1b]) {
    el.setAttribute('stroke', color);
    el.setAttribute('stroke-width', 1);
    el.setAttribute('opacity', 0.85);
    layer.appendChild(el);
  }
  text.setAttribute('fill', color);
  text.setAttribute('font-size', '11');
  text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
  text.setAttribute('font-weight', '600');
  text.textContent = `${Math.round(gap)}px`;
  layer.appendChild(text);
}

function getGuideLayer() {
  const { paper } = cctx;
  if (!guideLayer || !guideLayer.parentNode) {
    guideLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    guideLayer.setAttribute('class', 'df-alignment-guides df-transient');   // df-transient: exports strip it
    // Append inside joint-layers so guides inherit the paper translate/scale transform
    const layers = paper.svg.querySelector('.joint-layers');
    if (layers) {
      layers.appendChild(guideLayer);
    } else {
      paper.svg.appendChild(guideLayer);
    }
  }
  return guideLayer;
}

function clearGuides() {
  if (guideLayer) guideLayer.innerHTML = '';
}

function drawGuide(x1, y1, x2, y2) {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  line.setAttribute('stroke', 'var(--color-primary)');
  line.setAttribute('stroke-width', 0.5);
  line.setAttribute('stroke-dasharray', '4 3');
  line.setAttribute('opacity', '0.7');
  getGuideLayer().appendChild(line);
}

// ── Registration: mount the drag-snap pointer listeners ─────────────
export function registerSpacingGuides(cctx) {
  const { paper, graph } = cctx;

  // Tag the drag at pointerdown; build the spacing context lazily on first move
  // so click-only interactions don't pay the cost.
  paper.on('element:pointerdown', (cellView) => {
    const moved = cellView?.model;
    if (!moved) { _spacingDragContext = null; return; }
    // Capture the home parent NOW — by the first pointermove an embedded child has
    // already been detached by embeddingMode, so this is our only chance to read it.
    _spacingDragContext = { pendingForId: moved.id, originParent: moved.get('parent') || null };
  });
  // Clear the drag cache AND the guide overlay on drop (the activation-lifeline
  // snap keeps its own element:pointerup in canvas.js).
  paper.on('element:pointerup', () => {
    _spacingDragContext = null;
    clearGuides();
  });

  paper.on('element:pointermove', (cellView, evt) => {
    clearGuides();
    const movedEl = cellView.model;
    // Gantt bars / milestones / markers do their OWN column + row snapping (canvas.js gantt drag) — alignment
    // guides here would fight that snap and add noise, so skip every Gantt shape.
    if (/^sf\.Gantt/.test(movedEl.get('type') || '')) return;
    // Option (Alt) held: place freely, with no snap and no guides (owner decision 2026-10-22). Cmd, Ctrl and Shift
    // already mean multi-select on the press; Option was unused during a drag. Read on every move, so it works mid-drag.
    if (evt?.altKey) return;
    // Guides are computed/drawn for everyone (so distance helpers show inside a Layer and
    // between Layer zones). The position SNAP is suppressed for ordinary containers whose
    // children shouldn't be tugged — but NOT for Layer/group shapes (Zones, Pools…): for
    // those, snapping the container to an even rhythm and carrying its children along is
    // exactly the "space layouts equidistantly" intent.
    const movedIsGroup = NON_RHYTHM_TYPES.has(movedEl.get('type'));
    const skipSnap = movedEl.getEmbeddedCells().length > 0 && !movedIsGroup;
    // Lazy-build the spacing context on the first frame of the drag, passing the
    // parent captured at pointerdown (the live parent is already null by now).
    if (_spacingDragContext?.pendingForId === movedEl.id) {
      _spacingDragContext = buildSpacingDragContext(movedEl, _spacingDragContext.originParent);
    }
    // The home container (if any) is detached from movedEl during the drag, so
    // isEmbeddedIn() no longer excludes it — drop it explicitly so the child never
    // edge-aligns to the very Zone/Container it sits inside.
    const homeParent = _spacingDragContext?.originParent || null;
    const excluded = _spacingDragContext?.excluded || new Set();   // co-selected shapes moving with this one
    const movedBBox = movedEl.getBBox();
    const movedType = movedEl.get('type');
    const tol = SNAP_PX / (paper.scale().sx || 1);
    const allElements = graph.getElements().filter(el => {
      if (el.id === movedEl.id || el.id === homeParent || excluded.has(el.id)) return false;
      if (isDescendantOf(el, movedEl) || isDescendantOf(movedEl, el)) return false;
      // When dragging a Zone/Pool/group, align only against the SAME type — otherwise the
      // children sitting inside OTHER zones pollute edge-alignment, and a stray child-edge
      // match suppresses the equal-distance (spacing) dimension between the zones.
      if (movedIsGroup && el.get('type') !== movedType) return false;
      return true;
    });

    // Find the nearest edge/centre alignment on X and Y independently.
    let bestX = null; // { dx, snapX, bb } — closest edge/centre match on X
    let bestY = null; // { dx, snapY, bb } — closest edge/centre match on Y

    const movedL = movedBBox.x, movedR = right(movedBBox), movedCx = centerX(movedBBox);
    const movedT = movedBBox.y, movedB = bottom(movedBBox), movedCy = centerY(movedBBox);

    for (const other of allElements) {
      const bb = other.getBBox();
      const oL = bb.x, oR = right(bb), oCx = centerX(bb);
      const oT = bb.y, oB = bottom(bb), oCy = centerY(bb);

      // X-axis: check moved edges vs other edges
      for (const [mv, ov] of [[movedL, oL], [movedL, oR], [movedR, oL], [movedR, oR], [movedCx, oCx]]) {
        const diff = ov - mv;
        if (Math.abs(diff) < tol && (!bestX || Math.abs(diff) < Math.abs(bestX.dx))) {
          bestX = { dx: diff, snapX: ov, bb };
        }
      }

      // Y-axis
      for (const [mv, ov] of [[movedT, oT], [movedT, oB], [movedB, oT], [movedB, oB], [movedCy, oCy]]) {
        const diff = ov - mv;
        if (Math.abs(diff) < tol && (!bestY || Math.abs(diff) < Math.abs(bestY.dx))) {
          bestY = { dx: diff, snapY: ov, bb };
        }
      }
    }

    // Connector-straightening snap. A directly-connected element's CENTRE takes
    // priority over ANY edge match on that axis, so the link between the two
    // reads exactly straight. Edge-alignment alone (e.g. a shared top edge)
    // leaves an odd-height neighbour's centre ~.5px off → the slightly-sloped
    // link the user reported. Only the axis whose centres are already near-
    // aligned fires — a horizontal link pins centre-Y (its cells sit far apart
    // in X), a vertical link pins centre-X — so it never tugs the off-axis.
    let connBestX = null, connBestY = null;
    for (const ce of graph.getNeighbors(movedEl)) {
      if (ce.id === movedEl.id || excluded.has(ce.id) || isDescendantOf(ce, movedEl) || isDescendantOf(movedEl, ce)) continue;
      const cb = ce.getBBox();
      const ceCx = centerX(cb), ceCy = centerY(cb);
      const ddx = ceCx - movedCx;
      if (Math.abs(ddx) < tol && (!connBestX || Math.abs(ddx) < Math.abs(connBestX.dx))) connBestX = { dx: ddx, snapX: ceCx, bb: cb };
      const ddy = ceCy - movedCy;
      if (Math.abs(ddy) < tol && (!connBestY || Math.abs(ddy) < Math.abs(connBestY.dx))) connBestY = { dx: ddy, snapY: ceCy, bb: cb };
    }
    if (connBestX) bestX = connBestX;
    if (connBestY) bestY = connBestY;

    // Even spacing (CR-6.1): the same-parent peers in the card's row (x) or column (y), within the same reach.
    const peers = _spacingDragContext?.peers || [];
    const spaceX = peers.length >= 2 ? findSequentialSpacing(movedBBox, peers, 'x', tol) : null;
    const spaceY = peers.length >= 2 ? findSequentialSpacing(movedBBox, peers, 'y', tol) : null;
    // One snap per axis, the NEARER of alignment and even spacing (a tie keeps the alignment). Until 2026-10-22 any
    // alignment within reach hid even spacing on that axis, so a card in another row whose edge sat near the spot made
    // equal gaps unreachable: the drag jumped from 4 px short of the spot straight to the alignment 6 px past it.
    const spaceDx = spaceX ? spaceX.expectedCenter - movedCx : 0;
    const spaceDy = spaceY ? spaceY.expectedCenter - movedCy : 0;
    const useSpaceX = !!spaceX && (!bestX || Math.abs(spaceDx) < Math.abs(bestX.dx));
    const useSpaceY = !!spaceY && (!bestY || Math.abs(spaceDy) < Math.abs(bestY.dx));
    const dx = useSpaceX ? spaceDx : (bestX ? bestX.dx : 0);
    const dy = useSpaceY ? spaceDy : (bestY ? bestY.dx : 0);

    if (!skipSnap && (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01)) {
      // translate (not position) so a snapped group carries its embedded children —
      // position() would move only the parent and leave the children behind.
      movedEl.translate(dx, dy, { skipHistory: true });
    }

    // Guides for everything that HOLDS at the final position, whichever snap won: alignment lines where an edge now
    // matches, and the equal-gap labels where the gaps are now equal. Drawn only for the winner until 2026-10-24, so a
    // card both evenly spaced and aligned with the next column (a tie, which keeps the alignment) showed no labels: the
    // middle card of an even stack looked unspaced (owner's test).
    const finalBBox = movedEl.getBBox();
    const fL = finalBBox.x, fR = right(finalBBox), fCx = centerX(finalBBox);
    const fT = finalBBox.y, fB = bottom(finalBBox), fCy = centerY(finalBBox);

    if (bestX) {
      const ob = bestX.bb;
      const oEdgesX = [ob.x, right(ob), centerX(ob)];
      const mEdgesX = [fL, fR, fCx];
      for (const mx of mEdgesX) {
        for (const ox of oEdgesX) {
          if (Math.abs(mx - ox) < 1) {
            const minY = Math.min(finalBBox.y, ob.y) - 10;
            const maxY = Math.max(fB, bottom(ob)) + 10;
            drawGuide(mx, minY, mx, maxY);
          }
        }
      }
    }
    if (bestY) {
      const ob = bestY.bb;
      const oEdgesY = [ob.y, bottom(ob), centerY(ob)];
      const mEdgesY = [fT, fB, fCy];
      for (const my of mEdgesY) {
        for (const oy of oEdgesY) {
          if (Math.abs(my - oy) < 1) {
            const minX = Math.min(finalBBox.x, ob.x) - 10;
            const maxX = Math.max(fR, right(ob)) + 10;
            drawGuide(minX, my, maxX, my);
          }
        }
      }
    }
    const heldX = peers.length >= 2 ? findSequentialSpacing(finalBBox, peers, 'x', 0.5) : null;
    const heldY = peers.length >= 2 ? findSequentialSpacing(finalBBox, peers, 'y', 0.5) : null;
    if (heldX) drawSpacingDimensions(heldX, 'x', finalBBox);
    if (heldY) drawSpacingDimensions(heldY, 'y', finalBBox);
  });
}

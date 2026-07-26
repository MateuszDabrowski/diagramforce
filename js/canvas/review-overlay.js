// Change Review overlay (NBA-1, v1.19.0) — a TRANSIENT, NON-DESTRUCTIVE diff visualisation.
// Given a diff (from util.diffGraphs(baseline, current)), it draws coloured outlines around the
// cells that were Added / Changed and red-dashed GHOST rects where cells were Removed - WITHOUT
// touching the model (no `borderStyle` prop, no dirty flag, no history).
//
// The transient-`<g>`-in-`.joint-layers` lifecycle (rides pan/zoom, redraws on move, auto-clears on a graph
// reset) is the shared overlay-layer.js kit; this module supplies its own diff-driven draw + coloured outline
// builder + the onExit callback (fired via the kit's onTeardown so a button / Escape / tab-switch exit all tear
// the caller's banner down the same way).
//
// Colours mirror the manual Shape-state palette (properties.js SHAPE_STATE_STYLES) so a review
// reads the same as a baked-in highlight: Added = green, Changed = amber, Removed = red.
import { cctx } from './context.js?v=1.21.1';
import { createOverlay } from './overlay-layer.js?v=1.21.1';

const SVGNS = 'http://www.w3.org/2000/svg';
const COL_ADDED = '#2E9E5B';
const COL_CHANGED = '#E8881A';
const COL_REMOVED = '#DA4E55';
const PAD = 7;   // outline inset beyond the cell bbox

let _diff = null;
let _onExit = null;

const overlay = createOverlay({
  className: 'df-review-overlay',
  events: 'change:position change:size add remove',
  onTeardown: () => {
    _diff = null;
    const cb = _onExit;
    _onExit = null;
    if (cb) { try { cb(); } catch { /* caller teardown best-effort */ } }
  },
});

export function isReviewing() { return overlay.isActive(); }

function outlineRect(x, y, w, h, color, dash, opacity = 1) {
  const r = document.createElementNS(SVGNS, 'rect');
  r.setAttribute('x', String(x));
  r.setAttribute('y', String(y));
  r.setAttribute('width', String(Math.max(0, w)));
  r.setAttribute('height', String(Math.max(0, h)));
  r.setAttribute('rx', '6');
  r.setAttribute('ry', '6');
  r.setAttribute('fill', 'none');
  r.setAttribute('stroke', color);
  r.setAttribute('stroke-width', '3');
  if (dash) r.setAttribute('stroke-dasharray', dash);
  // Crisp outline at any zoom (the layer is scaled by the paper transform).
  r.setAttribute('vector-effect', 'non-scaling-stroke');
  if (opacity !== 1) r.setAttribute('opacity', String(opacity));
  return r;
}

function draw() {
  const { graph } = cctx;
  const layer = overlay.layer();
  if (!layer || !_diff || !graph) return;
  overlay.clear();

  const outlineCell = (id, color, dash) => {
    const cell = graph.getCell(id);
    if (!cell || !cell.isElement?.()) return;   // links inherit their endpoints' state visually
    const bb = cell.getBBox?.();
    if (!bb || !(bb.width > 0)) return;
    layer.appendChild(outlineRect(bb.x - PAD, bb.y - PAD, bb.width + PAD * 2, bb.height + PAD * 2, color, dash));
  };

  for (const id of (_diff.added || [])) outlineCell(id, COL_ADDED, null);     // green, solid
  for (const id of (_diff.changed || [])) outlineCell(id, COL_CHANGED, '2 5'); // amber, dotted

  // Removed elements no longer exist in the live graph → ghost them at their original footprint
  // (from the baseline snapshot). Links can't be positioned, so element ghosts only.
  for (const rc of (_diff.removedCells || [])) {
    if (!rc || rc.source || rc.target) continue;
    const p = rc.position, s = rc.size;
    if (!p || !s) continue;
    layer.appendChild(outlineRect(p.x - PAD, p.y - PAD, s.width + PAD * 2, s.height + PAD * 2, COL_REMOVED, '7 4', 0.75));
  }
}
overlay.setDraw(draw);

/** Element-only counts for the banner (links/removed-links are not outlined). */
export function getReviewSummary() {
  if (!_diff) return { added: 0, changed: 0, removed: 0 };
  const { graph } = cctx;
  const isElem = (id) => { const c = graph?.getCell(id); return !!(c && c.isElement?.()); };
  return {
    added: [...(_diff.added || [])].filter(isElem).length,
    changed: [...(_diff.changed || [])].filter(isElem).length,
    removed: (_diff.removedCells || []).filter((c) => c && !c.source && !c.target && c.position && c.size).length,
  };
}

/** Start a review. `diff` = util.diffGraphs(baseline, current). `onExit` fires once on any exit
 *  (button, Escape, tab switch) so the caller can tear down its banner. */
export function enterReview(diff, onExit = null) {
  const { graph, paper } = cctx;
  if (!graph || !paper || !diff) return false;
  if (overlay.isActive()) exitReview();   // never stack two reviews
  _diff = diff;
  _onExit = onExit;
  return overlay.activate();              // draws + subscribes
}

export function exitReview() { overlay.deactivate(); }

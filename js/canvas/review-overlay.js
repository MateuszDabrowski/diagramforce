// Change Review overlay (NBA-1, v1.19.0) — a TRANSIENT, NON-DESTRUCTIVE diff visualisation.
// Given a diff (from util.diffGraphs(baseline, current)), it draws coloured outlines around the
// cells that were Added / Changed and red-dashed GHOST rects where cells were Removed - WITHOUT
// touching the model (no `borderStyle` prop, no dirty flag, no history). It rides the
// `.joint-layers` transform like the crossing-bump overlay, so it tracks pan/zoom for free, and
// redraws as cells move. Exiting clears the layer; a tab switch / graph swap auto-exits.
//
// Colours mirror the manual Shape-state palette (properties.js SHAPE_STATE_STYLES) so a review
// reads the same as a baked-in highlight: Added = green, Changed = amber, Removed = red.
import { cctx } from './context.js?v=1.19.1.1';

const SVGNS = 'http://www.w3.org/2000/svg';
const COL_ADDED = '#2E9E5B';
const COL_CHANGED = '#E8881A';
const COL_REMOVED = '#DA4E55';
const PAD = 7;   // outline inset beyond the cell bbox

let _layer = null;
let _diff = null;
let _reviewing = false;
let _onExit = null;
let _redraw = null;

export function isReviewing() { return _reviewing; }

function ensureLayer() {
  const { paper } = cctx;
  const cellsLayer = paper?.svg?.querySelector?.('.joint-cells-layer');
  const layersGroup = cellsLayer?.parentNode;
  if (!layersGroup) return null;
  if (_layer && _layer.parentNode) return _layer;
  _layer = document.createElementNS(SVGNS, 'g');
  _layer.setAttribute('class', 'df-review-overlay');
  _layer.setAttribute('pointer-events', 'none');
  // Above cells + links (and the bump layer), below the tools layer - same anchor the bumps use.
  layersGroup.insertBefore(_layer, cellsLayer.nextSibling);
  return _layer;
}

function clearLayer() {
  if (_layer) while (_layer.firstChild) _layer.removeChild(_layer.firstChild);
}

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
  const layer = ensureLayer();
  if (!layer || !_diff || !graph) return;
  clearLayer();

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
  if (_reviewing) exitReview();   // never stack two reviews
  _diff = diff;
  _onExit = onExit;
  _reviewing = true;
  draw();
  _redraw = () => { if (_reviewing) draw(); };
  graph.on('change:position change:size add remove', _redraw);
  paper.on('render:done', _redraw);
  graph.once('reset', exitReview);   // tab switch / new diagram / JSON load
  return true;
}

export function exitReview() {
  if (!_reviewing) return;
  const { graph, paper } = cctx;
  _reviewing = false;
  if (graph && _redraw) graph.off('change:position change:size add remove', _redraw);
  if (paper && _redraw) paper.off('render:done', _redraw);
  graph?.off?.('reset', exitReview);
  _redraw = null;
  clearLayer();
  if (_layer && _layer.parentNode) _layer.parentNode.removeChild(_layer);
  _layer = null;
  _diff = null;
  const cb = _onExit;
  _onExit = null;
  if (cb) { try { cb(); } catch { /* caller teardown best-effort */ } }
}

// Diagram check (NBA #3, refocused v1.19.0) — find LOOSE connectors (links not attached to a shape at
// both ends) and highlight them transiently on the canvas. Surfaced BEFORE an explicit save (the Save &
// Export manager runs findLooseConnectors and shows a banner), NOT on background autosync / session-persist.
//
// This replaces the original Check Diagram, which ran the load-time validateDiagram on the LIVE graph: on a
// sanitized live graph its only output was a "type-specific shape in the wrong diagramType" warning, which is
// now MISLEADING (cross-type "Other Shapes" are deliberately encouraged) while the real problem - a connector
// dangling in empty space - slipped through (validateDiagram's "dangling" means a MISSING-id reference, which
// the loader already drops; a free-endpoint link has no id to be missing). So we check the real thing instead.
//
// Overlay machinery mirrors review-overlay.js: an own `<g>` inside `.joint-layers` that rides the paper
// transform (tracks pan/zoom for free) and redraws as cells move; cleared on a graph reset (tab switch).
import { cctx } from './context.js?v=1.19.0.49';

const SVGNS = 'http://www.w3.org/2000/svg';
const COL = '#DA4E55';   // red — matches the issue / Removed palette
const PAD = 7;

let _layer = null;
let _redraw = null;
let _ids = [];

// A connector is "loose" when an end isn't attached to a shape. getSourceCell()/getTargetCell() return null
// for a FREE endpoint (drawn to empty canvas) — the genuine "dangling connector" case.
export function findLooseConnectors() {
  const { graph } = cctx;
  if (!graph) return [];
  return graph.getLinks().reduce((out, l) => {
    const sourceLoose = !l.getSourceCell();
    const targetLoose = !l.getTargetCell();
    if (sourceLoose || targetLoose) out.push({ id: l.id, sourceLoose, targetLoose });
    return out;
  }, []);
}

function ensureLayer() {
  const { paper } = cctx;
  const cellsLayer = paper?.svg?.querySelector?.('.joint-cells-layer');
  const layersGroup = cellsLayer?.parentNode;
  if (!layersGroup) return null;
  if (_layer && _layer.parentNode) return _layer;
  _layer = document.createElementNS(SVGNS, 'g');
  _layer.setAttribute('class', 'df-check-overlay');
  _layer.setAttribute('pointer-events', 'none');
  layersGroup.insertBefore(_layer, cellsLayer.nextSibling);
  return _layer;
}

function clearLayer() { if (_layer) while (_layer.firstChild) _layer.removeChild(_layer.firstChild); }

function outlineRect(x, y, w, h) {
  const r = document.createElementNS(SVGNS, 'rect');
  r.setAttribute('x', String(x)); r.setAttribute('y', String(y));
  r.setAttribute('width', String(Math.max(0, w))); r.setAttribute('height', String(Math.max(0, h)));
  r.setAttribute('rx', '6'); r.setAttribute('ry', '6');
  r.setAttribute('fill', 'none'); r.setAttribute('stroke', COL); r.setAttribute('stroke-width', '3');
  r.setAttribute('stroke-dasharray', '7 4'); r.setAttribute('vector-effect', 'non-scaling-stroke');
  return r;
}

// A filled red dot pinpointing the exact dangling end (the bbox alone can be a big, vague region).
function dot(x, y) {
  const c = document.createElementNS(SVGNS, 'circle');
  c.setAttribute('cx', String(x)); c.setAttribute('cy', String(y)); c.setAttribute('r', '7');
  c.setAttribute('fill', COL); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', '2');
  c.setAttribute('vector-effect', 'non-scaling-stroke');
  return c;
}

function freeEndPoint(link, end) {
  const p = link.get(end);                       // a free endpoint is stored as {x, y} (no id)
  return p && p.x != null && p.y != null ? p : null;
}

function draw() {
  const { graph } = cctx;
  const layer = ensureLayer();
  if (!layer || !graph) return;
  clearLayer();
  for (const id of _ids) {
    const l = graph.getCell(id);
    if (!l || !l.isLink?.()) continue;
    const bb = l.getBBox?.();
    if (bb) layer.appendChild(outlineRect(bb.x - PAD, bb.y - PAD, bb.width + PAD * 2, bb.height + PAD * 2));
    if (!l.getSourceCell()) { const p = freeEndPoint(l, 'source'); if (p) layer.appendChild(dot(p.x, p.y)); }
    if (!l.getTargetCell()) { const p = freeEndPoint(l, 'target'); if (p) layer.appendChild(dot(p.x, p.y)); }
  }
}

function looseBBox() {
  const { graph } = cctx;
  let bbox = null;
  for (const id of _ids) {
    const bb = graph.getCell(id)?.getBBox?.();
    if (bb) bbox = bbox ? bbox.union(bb) : bb.clone();
  }
  return bbox;
}

// Find loose connectors, outline them, and frame them so they're on-screen. Returns the count (0 = none,
// nothing drawn). Idempotent: re-running clears the previous highlight first.
export function highlightLooseConnectors() {
  const { graph, paper } = cctx;
  if (!graph || !paper) return 0;
  const loose = findLooseConnectors();
  clearLooseHighlight();
  _ids = loose.map((x) => x.id);
  if (!_ids.length) return 0;
  draw();
  const bb = looseBBox();
  if (bb) cctx.fitToCells?.(bb);
  _redraw = () => draw();
  graph.on('change:position change:size add remove', _redraw);
  paper.on('render:done', _redraw);
  graph.once('reset', clearLooseHighlight);   // tab switch / new diagram / JSON load
  return _ids.length;
}

export function clearLooseHighlight() {
  const { graph, paper } = cctx;
  if (graph && _redraw) graph.off('change:position change:size add remove', _redraw);
  if (paper && _redraw) paper.off('render:done', _redraw);
  graph?.off?.('reset', clearLooseHighlight);
  _redraw = null;
  _ids = [];
  clearLayer();
  if (_layer && _layer.parentNode) _layer.parentNode.removeChild(_layer);
  _layer = null;
}

// External-label auto-placement (CR-6.2) — extracted from canvas.js (Phase 4,
// Slice 9).
//
// Shapes with descriptions positioned OUTSIDE the body (Decision diamond, Event
// circle, DataObject) get their label side picked automatically based on which
// port sides have connecting links:
//   1st choice:  bottom (the current default)
//   2nd choice:  top
//   3rd choice:  right
//   4th choice:  left
//   fallback:    bottom (if all four sides are in use, accept the
//                collision rather than leave the label off-canvas)
//
// No save schema field — position is recomputed on every link topology change
// (add/remove, change:source, change:target) plus once at end of JSON load.
// Pure visual layout; the user doesn't need to think about it.
//
// Reads the live graph/paper + the load guard via the canvas context (cctx);
// canvas.js calls initExternalLabelAutoplace() once in init() after the cctx
// hydration block, and keeps cctx.isLoadingJSON synced in setLoadingJSON().
import { cctx } from './context.js?v=1.18.1';

const EXTERNAL_LABEL_SHAPES = new Set([
  'sf.BpmnEvent',
  'sf.BpmnGateway',
  'sf.BpmnDataObject',
]);

const LABEL_SIDE_ATTRS = {
  bottom: { x: 'calc(0.5 * w)', y: 'calc(h + 10)', textAnchor: 'middle', textVerticalAnchor: 'top' },
  top:    { x: 'calc(0.5 * w)', y: -10,            textAnchor: 'middle', textVerticalAnchor: 'bottom' },
  right:  { x: 'calc(w + 10)',  y: 'calc(0.5 * h)', textAnchor: 'start', textVerticalAnchor: 'middle' },
  left:   { x: -10,             y: 'calc(0.5 * h)', textAnchor: 'end',   textVerticalAnchor: 'middle' },
};

function computeUsedPortSides(cell) {
  const { graph } = cctx;
  const usedSides = new Set();
  if (!cell?.id || !graph) return usedSides;
  const cellId = cell.id;
  for (const link of graph.getLinks()) {
    const src = link.get('source');
    const tgt = link.get('target');
    if (src?.id === cellId && src.port) {
      const port = cell.getPort?.(src.port);
      if (port?.group) usedSides.add(port.group);
    }
    if (tgt?.id === cellId && tgt.port) {
      const port = cell.getPort?.(tgt.port);
      if (port?.group) usedSides.add(port.group);
    }
  }
  return usedSides;
}

function refreshExternalLabelPosition(cell) {
  const { paper } = cctx;
  if (!cell?.get || !paper) return;
  if (!EXTERNAL_LABEL_SHAPES.has(cell.get('type'))) return;
  const used = computeUsedPortSides(cell);
  // Priority: bottom (default) → top → right → left → bottom (fallback)
  const preferred = ['bottom', 'top', 'right', 'left'];
  let chosen = 'bottom';
  for (const side of preferred) {
    if (!used.has(side)) { chosen = side; break; }
  }
  const sideAttrs = LABEL_SIDE_ATTRS[chosen];
  const existing = cell.attr('label') || {};
  // Skip if already correct (avoids redundant attr writes that re-render
  // unnecessarily on every link change for unaffected cells).
  if (existing.x === sideAttrs.x && existing.y === sideAttrs.y
      && existing.textAnchor === sideAttrs.textAnchor
      && existing.textVerticalAnchor === sideAttrs.textVerticalAnchor) return;
  cell.attr('label', { ...existing, ...sideAttrs }, { silent: true });
  // silent: true keeps it out of history (auto-positioning isn't a
  // user-initiated change), but the view doesn't re-render on its own;
  // explicit view.update() pushes the new attrs through.
  paper.findViewByModel(cell)?.update?.();
}

export function initExternalLabelAutoplace() {
  const { graph, paper } = cctx;
  if (!paper || !graph) return;

  const refreshFromLink = (link) => {
    if (!link || cctx.isLoadingJSON) return;
    const srcId = link.get('source')?.id;
    const tgtId = link.get('target')?.id;
    if (srcId) refreshExternalLabelPosition(graph.getCell(srcId));
    if (tgtId) refreshExternalLabelPosition(graph.getCell(tgtId));
  };

  graph.on('add', (cell) => {
    if (cctx.isLoadingJSON) return;
    if (cell.isLink()) refreshFromLink(cell);
    else refreshExternalLabelPosition(cell);
  });
  graph.on('remove', (cell) => {
    if (cctx.isLoadingJSON) return;
    if (cell.isLink()) {
      // Link's endpoints are still on the model at removal time, so
      // refreshFromLink reads them before the GC sweeps the references.
      refreshFromLink(cell);
    }
  });
  graph.on('change:source change:target', refreshFromLink);

  // Initial pass — covers JSON-loaded diagrams and freshly-instantiated
  // diagrams where add events fired before this listener was wired up.
  // Deferred so it runs after the first paint and any post-load
  // bookkeeping.
  setTimeout(() => {
    for (const cell of graph.getElements()) {
      refreshExternalLabelPosition(cell);
    }
  }, 150);
}

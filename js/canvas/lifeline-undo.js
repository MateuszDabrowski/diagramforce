// Undoable sequence-lifeline rebuilds. Port rebuilds and the Actor lifeline toggle rewrite `ports` (and attrs / size),
// which history does not record - so an undo reverted the COUNT but left the ports, and undoing "Hide lifeline" showed
// a lifeline with no ports (audit 2026-09-23). Run the op with recording suppressed and push ONE command that restores
// the whole snapshot. Shared by the sequence property panel (properties/renderers-sequence.js) and Sequence Auto
// Layout (auto-layout.js), which called the raw rebuild and so lost the ports and custom spacing on undo (review
// H2-1). Inside an open batch the command lands in that batch, so the layout stays one undo step.
import * as history from '../history.js?v=1.26.3';
import { cctx } from './context.js?v=1.26.3';

function snapLifeline(cell) {
  const ratios = cell.get('lifelinePortRatios');
  return {
    ports: JSON.parse(JSON.stringify(cell.get('ports') || {})),
    count: cell.get('lifelinePortCount'),
    ratios: Array.isArray(ratios) ? ratios.slice() : null,
    show: cell.get('showLifeline'),
    attrs: JSON.parse(JSON.stringify(cell.get('attrs') || {})),
    size: { ...cell.size() },
  };
}

// The lane is looked up by id at replay: a tab switch or a delete-then-undo in between replaces the model instance
// (review J1-3). The rewrite also DELETES every message on a port that vanished (JointJS removes a link whose port is
// removed), and that removal was suppressed too, so the messages were gone for good (review J1-1). The command carries
// the JSON of those links: undo re-adds them once the ports are back, redo removes them again.
function applyLifeline(id, st, dropped, restoreLinks) {
  const graph = cctx.graph;
  const cell = graph?.getCell(id);
  if (!cell) return;
  history.setSuppressed(true);
  try {
    cell.prop('ports', JSON.parse(JSON.stringify(st.ports)), { rewrite: true });
    cell.set({ lifelinePortCount: st.count, showLifeline: st.show });
    if (st.ratios) cell.set('lifelinePortRatios', st.ratios.slice()); else cell.unset('lifelinePortRatios');
    cell.set('attrs', JSON.parse(JSON.stringify(st.attrs)));
    cell.resize(st.size.width, st.size.height);
    // After the ports: a link re-added before its port exists would be dropped again by the next port rewrite.
    if (restoreLinks) dropped.forEach(j => { if (!graph.getCell(j.id)) graph.addCell(JSON.parse(JSON.stringify(j))); });
    else dropped.forEach(j => graph.getCell(j.id)?.remove());
  } finally { history.setSuppressed(false); }
}

/** Run a lane op (port rebuild, lifeline toggle) as ONE undo step that also restores the messages it deleted. */
export function undoableLifelineOp(cell, op) {
  const id = cell.id;
  const graph = cctx.graph;
  const before = snapLifeline(cell);
  const linksBefore = graph ? graph.getConnectedLinks(cell).map(l => l.toJSON()) : [];
  history.flushPendingDragCommit();
  history.setSuppressed(true);
  let after;
  try { op(); history.flushPendingDragCommit(); after = snapLifeline(cell); } finally { history.setSuppressed(false); }
  const dropped = graph ? linksBefore.filter(j => !graph.getCell(j.id)) : [];
  if (dropped.length || JSON.stringify(after) !== JSON.stringify(before)) {
    history.recordCommand(() => applyLifeline(id, before, dropped, true), () => applyLifeline(id, after, dropped, false));
  }
}

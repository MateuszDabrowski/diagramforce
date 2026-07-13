// Gantt drag — the reorder-with-drop-line drag flow for Gantt bars / milestones / markers.
// Extracted from canvas.js (S7 slice 5). Dates stay the source of truth; dragging a SINGLE task
// locks its Y to its row, snaps X to a column live, and shows a horizontal drop line for the slot
// it will land in; on drop it reorders (group-aware) and re-dates. Milestones/markers snap their
// centre to a column live. It all lands in the drag's single history merge → one undo.
//
// registerGanttDrag(cctx) mounts the paper pointerdown/move/up listeners AND exposes 3 drop-layer
// chip closures on cctx (showGanttDateChip / clearGanttDateChip / showGanttGroupInsertBar) that the
// resize path (selection.js) + the stencil dragover (stencil.js) reuse. MUST be registered BEFORE
// registerEmbedding(cctx): a bar drop mutates geometry (position/size/dates) inside its pointerup,
// and embedding's auto-fit reacts to the resulting change events — so the drop must settle first.
// Reads cctx.graph/paper; imports the pure Gantt geometry helpers from gantt-layout.js.

import { deriveGanttDates, deriveGanttMilestoneDate, deriveGanttMarkerDate, resequenceGanttOrders, ganttTimelineFor, snapGanttX, snapGanttRowCentreY, ganttDropTarget, growTimelineToFitDates } from '../gantt-layout.js?v=1.19.3.8';

export function registerGanttDrag(cctx) {
  const { graph, paper } = cctx;

  // Gantt drag (Phase 2 + the v1.17.3 reorder redesign): dates stay the source of truth, and dragging is a
  // reorder-with-drop-line, not a free move. Grabbing a bar snapshots EVERY bar's geometry (so a multi-select bar
  // drag still re-dates all of them). While dragging a SINGLE task: its Y is LOCKED to its row (the row "stays
  // put", item 1), its X SNAPS to the nearest column live (item 3), and a horizontal DROP LINE shows the slot it
  // will land in (item 2). On drop the bar reorders into that slot — group-aware, so dropping it into another
  // group's region reassigns its group — and re-dates from the snapped X. Milestones/markers snap their centre to
  // a column live too (Y stays the manual row). It all lands in the drag's single history merge → one undo.
  let _ganttDragSnap = null, _ganttDragId = null, _ganttDrop = null;
  const _GANTT_DRAGGABLE = new Set(['sf.GanttTask', 'sf.GanttMilestone', 'sf.GanttMarker']);
  const SVG_NS_DROP = 'http://www.w3.org/2000/svg';
  let _ganttDropLayer = null;
  const ganttDropLayer = () => {
    if (!_ganttDropLayer || !_ganttDropLayer.parentNode) {
      _ganttDropLayer = document.createElementNS(SVG_NS_DROP, 'g');
      _ganttDropLayer.setAttribute('class', 'df-gantt-droplines');
      (paper.svg.querySelector('.joint-layers') || paper.svg).appendChild(_ganttDropLayer);
    }
    return _ganttDropLayer;
  };
  const clearGanttDropLine = () => { if (_ganttDropLayer) _ganttDropLayer.innerHTML = ''; };
  const _GD_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtGD = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${+m[3]} ${_GD_MON[+m[2] - 1]}` : ''; };
  const drawGanttDropLine = (tl, lineLocalY) => {   // caller clears the layer first
    const layer = ganttDropLayer();
    const x = tl.position().x, y = tl.position().y + lineLocalY, w = tl.size().width;
    const line = document.createElementNS(SVG_NS_DROP, 'line');
    line.setAttribute('x1', x); line.setAttribute('y1', y);
    line.setAttribute('x2', x + w); line.setAttribute('y2', y);
    line.setAttribute('stroke', 'var(--brand-amber, #F6B355)');
    line.setAttribute('stroke-width', 2); line.setAttribute('pointer-events', 'none');
    layer.appendChild(line);
    const dot = document.createElementNS(SVG_NS_DROP, 'circle');
    dot.setAttribute('cx', x + 4); dot.setAttribute('cy', y); dot.setAttribute('r', 3.5);
    dot.setAttribute('fill', 'var(--brand-amber, #F6B355)'); dot.setAttribute('pointer-events', 'none');
    layer.appendChild(dot);
  };
  // Issue 8: while dragging a task, show its current start - end dates in a chip above the bar.
  const drawGanttDragDates = (bar, start, end) => {
    const layer = ganttDropLayer();
    const cx = bar.position().x + bar.size().width / 2, ty = bar.position().y - 8;
    const text = `${fmtGD(start)} – ${fmtGD(end)}`;
    const t = document.createElementNS(SVG_NS_DROP, 'text');
    t.setAttribute('x', cx); t.setAttribute('y', ty);
    t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '11'); t.setAttribute('font-weight', '600');
    t.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    t.setAttribute('fill', 'var(--brand-amber, #F6B355)'); t.setAttribute('pointer-events', 'none');
    t.textContent = text; layer.appendChild(t);
  };
  // Issue 1: expose the date chip so a RESIZE (handled in selection.js, outside this paper-drag flow) can show the
  // same live start - end chip a drag does. The chip layer is shared; clear-then-draw keeps a single chip on screen.
  cctx.showGanttDateChip = (bar, start, end) => { clearGanttDropLine(); if (bar) drawGanttDragDates(bar, start, end); };
  cctx.clearGanttDateChip = () => clearGanttDropLine();
  // Issue 6: a brand-amber insertion BAR previewing where a dragged Project Phase (thick) or Task (thin, item 3 -
  // round H) will land (used by the stencil dragover, which sits outside this paper-drag flow). Shared layer; clear-then-draw.
  cctx.showGanttGroupInsertBar = (tl, localY, thickness = 5) => {
    clearGanttDropLine();
    const layer = ganttDropLayer();
    const x = tl.position().x, y = tl.position().y + localY, w = tl.size().width, h = thickness;
    const bar = document.createElementNS(SVG_NS_DROP, 'rect');
    bar.setAttribute('x', x); bar.setAttribute('y', y - h / 2); bar.setAttribute('width', w); bar.setAttribute('height', h);
    bar.setAttribute('rx', h / 2); bar.setAttribute('fill', 'var(--brand-amber, #F6B355)'); bar.setAttribute('pointer-events', 'none');
    layer.appendChild(bar);
  };

  paper.on('element:pointerdown', (cellView) => {
    const m = cellView?.model;
    if (!_GANTT_DRAGGABLE.has(m?.get('type'))) { _ganttDragSnap = null; _ganttDragId = null; _ganttDrop = null; return; }
    _ganttDragId = m.id; _ganttDrop = null;
    _ganttDragSnap = new Map();
    for (const e of graph.getElements()) {
      if (_GANTT_DRAGGABLE.has(e.get('type'))) _ganttDragSnap.set(e.id, { x: e.position().x, y: e.position().y, w: e.size().width });
    }
  });
  paper.on('element:pointermove', (cellView, evt, x, y) => {
    const m = cellView?.model;
    if (!_ganttDragSnap || !m || m.id !== _ganttDragId) return;
    const type = m.get('type');
    const tl = ganttTimelineFor(m);
    if (!tl) return;
    // A multi-select group drag (another bar moved too) keeps the old free-move behaviour — no lock / drop line.
    let multi = false;
    for (const [id, f] of _ganttDragSnap) { if (id === m.id) continue; const c = graph.getCell(id); if (c && (c.position().x !== f.x || c.position().y !== f.y)) { multi = true; break; } }
    if (multi) { clearGanttDropLine(); _ganttDrop = null; return; }
    clearGanttDropLine();
    if (type === 'sf.GanttTask') {
      const from = _ganttDragSnap.get(m.id);
      const sx = snapGanttX(tl, m.position().x);                 // X snaps to a column
      m.position(sx == null ? m.position().x : sx, from ? from.y : m.position().y, { gantt: true });   // Y locked to the row
      const tgt = ganttDropTarget(tl, y, m);                     // drop slot from the pointer
      _ganttDrop = tgt;
      if (tgt) drawGanttDropLine(tl, tgt.lineLocalY);
      const d = deriveGanttDates(m, tl);                         // live start - end dates above the bar (issue 8)
      if (d) drawGanttDragDates(m, d.start, d.end);
    } else {
      // Milestone / day marker: snap the CENTRE to a column (X) AND to the nearest row centre (Y) — so it lines up
      // on a task row instead of floating between rows.
      const w = m.size().width, h = m.size().height;
      const sx = snapGanttX(tl, m.position().x + w / 2);
      const sy = snapGanttRowCentreY(tl, m.position().y + h / 2);
      m.position(
        sx == null ? m.position().x : Math.round(sx - w / 2),
        sy == null ? m.position().y : Math.round(sy - h / 2),
        { gantt: true },
      );
    }
  });
  paper.on('element:pointerup', () => {
    const snap = _ganttDragSnap, drop = _ganttDrop, dragId = _ganttDragId;
    _ganttDragSnap = null; _ganttDrop = null; _ganttDragId = null;
    clearGanttDropLine();
    if (!snap) return;
    const reorderTLs = new Set();
    const growTLs = new Set();
    for (const e of graph.getElements()) {
      const type = e.get('type');
      if (!_GANTT_DRAGGABLE.has(type)) continue;
      const from = snap.get(e.id);
      if (!from) continue;
      const grabbed = e.id === dragId;
      const movedX = e.position().x !== from.x || e.size().width !== from.w;
      const movedY = Math.abs(e.position().y - from.y) > 6;
      if (movedX) { const tl = ganttTimelineFor(e); if (tl) growTLs.add(tl); }   // issue 5: may now run past the edge
      if (type === 'sf.GanttMilestone') { if (movedX) { const d = deriveGanttMilestoneDate(e); if (d) e.set('milestoneDate', d); } continue; }
      if (type === 'sf.GanttMarker') { if (movedX) { const d = deriveGanttMarkerDate(e); if (d) e.set('markerDate', d); } continue; }
      // Task. Re-date from the (snapped) X when it moved horizontally.
      if (movedX) { const d = deriveGanttDates(e); if (d) e.set({ startDate: d.start, endDate: d.end }); }
      // The grabbed task reorders into its DROP slot (group-aware): reassign its group + park it at the drop Y so
      // resequenceGanttOrders sorts it there. Other bars (multi-select) keep the Y-based reorder.
      if (grabbed && drop && drop.moved && e.get('order') != null) {
        const tl = ganttTimelineFor(e);
        if (tl) {
          if ((e.get('groupId') || null) !== (drop.groupId || null)) e.set('groupId', drop.groupId || null);
          e.position(e.position().x, drop.dropY, { gantt: true });
          reorderTLs.add(tl);
        }
      } else if (!grabbed && movedY && e.get('order') != null) {
        const tl = ganttTimelineFor(e); if (tl) reorderTLs.add(tl);
      }
    }
    for (const tl of reorderTLs) resequenceGanttOrders(tl);   // re-sequence order from the dropped Y + snap each bar
    for (const tl of growTLs) growTimelineToFitDates(tl);     // issue 5: grow any timeline whose element now runs past its right edge
  });
}

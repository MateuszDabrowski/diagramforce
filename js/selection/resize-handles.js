// Resize handles — the corner-drag resize interaction extracted from selection.js (S9). Raw SVG +
// vanilla-JS pointer drag (avoids JointJS event conflicts): four corner handles per selected view,
// live tracking guide lines, per-type constraints (min size, icon-mode square lock, df.Table/Gantt
// width-only, Gantt column snapping + live date chip + re-date on drop), and multi-select peer sync.
//
// initResizeHandles({ graph, paper, selectedIds }) wires the live refs (selectedIds is the SAME Set
// selection.js mutates - shared by reference, so peer collection sees the live selection). Reads
// history + the Gantt geometry helpers + the canvas date-chip forwarders.
import * as history from '../history.js?v=1.19.2.99';
import { deriveGanttDates, ganttTimelineFor, snapGanttX, growTimelineToFitDates } from '../gantt-layout.js?v=1.19.2.99';
import { showGanttDateChip, clearGanttDateChip } from '../canvas.js?v=1.19.2.99';

// Live refs wired by selection.init() via initResizeHandles.
let graph, paper, selectedIds;
export function initResizeHandles(ctx) { graph = ctx.graph; paper = ctx.paper; selectedIds = ctx.selectedIds; }

const SVG_NS = 'http://www.w3.org/2000/svg';
const RESIZE_CORNERS = [
  { cx: 0, cy: 0, cursor: 'nwse-resize' },
  { cx: 1, cy: 0, cursor: 'nesw-resize' },
  { cx: 0, cy: 1, cursor: 'nesw-resize' },
  { cx: 1, cy: 1, cursor: 'nwse-resize' },
];

export function addResizeHandles(view) {
  removeResizeHandles(view);
  view._sfHandles = [];
  const model = view.model;
  const grid = paper.options.gridSize || 16;
  const snapDelta = v => Math.round(v / grid) * grid;
  const type = model.get('type');
  // Activations are narrow strips sitting on top of participant lifelines —
  // their starting width is 12, so the minimum should be the same (not 80).
  const minW = (type === 'sf.SequenceActivation') ? 12 : 80;
  const minH = (type === 'sf.GanttTask' || type === 'sf.GanttMilestone') ? 24 : (type === 'sf.GanttGroup') ? 16 : 40;
  // df.Table height is content-owned (df.TableView measures wrapped markdown + resizes the model), so a table
  // resize is WIDTH-only — see the height/y lock in onMove. Corners show a horizontal cursor to signal it.
  const horizontalOnly = (type === 'df.Table' || type === 'sf.GanttTask');   // gantt bars resize WIDTH only (the row is fixed)

  const coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const handleSize = coarsePointer ? 20 : 12;
  const handleOffset = handleSize / 2;

  RESIZE_CORNERS.forEach(({ cx, cy, cursor }) => {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'df-resize-handle');   // tagged so image export (PNG/SVG/GIF) strips this selection chrome
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('width', String(handleSize));
    rect.setAttribute('height', String(handleSize));
    rect.setAttribute('x', String(-handleOffset));
    rect.setAttribute('y', String(-handleOffset));
    rect.setAttribute('fill', 'var(--selection-color)');
    rect.setAttribute('stroke', 'white');
    rect.setAttribute('stroke-width', '1.5');
    rect.setAttribute('rx', '2');
    rect.style.cursor = horizontalOnly ? 'ew-resize' : cursor;
    g.appendChild(rect);
    view.el.appendChild(g);
    view._sfHandles.push({ g, cx, cy });

    const onDown = (evt) => {
      evt.stopPropagation();
      evt.preventDefault();
      // v1.12.1 fix — wrap the entire drag in a history batch so the
      // hundreds of intermediate `position()` + `resize()` calls fired by
      // pointermove collapse into ONE undo entry instead of one per
      // frame. Without this, a 200-px drag created ~30 history entries
      // and required ~30 ⌘Z presses to revert one drag.
      history.startBatch();
      const startX = evt.clientX;
      const startY = evt.clientY;
      const origPos = { ...model.position() };
      const origSz  = { ...model.size() };

      // Collect peers: other selected elements of same type and same original size
      const peers = [];
      if (selectedIds.size > 1) {
        selectedIds.forEach(id => {
          if (id === model.id) return;
          const peer = graph.getCell(id);
          if (!peer?.isElement()) return;
          if (peer.get('type') !== type) return;
          const pSz = peer.size();
          if (Math.abs(pSz.width - origSz.width) < 1 && Math.abs(pSz.height - origSz.height) < 1) {
            peers.push({ model: peer, origPos: { ...peer.position() }, origSz: { ...pSz } });
          }
        });
      }

      // Create tracking guide lines for the edges being resized
      const guideH = document.createElementNS(SVG_NS, 'line');
      const guideV = document.createElementNS(SVG_NS, 'line');
      [guideH, guideV].forEach(ln => {
        ln.setAttribute('stroke', 'var(--color-primary)');
        ln.setAttribute('stroke-width', '0.5');
        ln.setAttribute('stroke-dasharray', '4 3');
        ln.setAttribute('opacity', '0.7');
        ln.style.pointerEvents = 'none';
      });
      const layersG = paper.svg.querySelector('.joint-layers');
      layersG.appendChild(guideH);
      layersG.appendChild(guideV);

      const updateGuides = (x, y, w, h) => {
        const edgeX = cx === 0 ? x : x + w;
        const edgeY = cy === 0 ? y : y + h;
        guideV.setAttribute('x1', edgeX);
        guideV.setAttribute('y1', y - 10000);
        guideV.setAttribute('x2', edgeX);
        guideV.setAttribute('y2', y + 10000);
        guideH.setAttribute('x1', x - 10000);
        guideH.setAttribute('y1', edgeY);
        guideH.setAttribute('x2', x + 10000);
        guideH.setAttribute('y2', edgeY);
      };

      const onMove = (e) => {
        const scale = paper.scale().sx;
        const dx = (e.clientX - startX) / scale;
        const dy = (e.clientY - startY) / scale;

        let newW, newH, newX, newY;
        if (cx === 1 && cy === 1) {
          newW = Math.max(minW, origSz.width  + snapDelta(dx));
          newH = Math.max(minH, origSz.height + snapDelta(dy));
          newX = origPos.x;
          newY = origPos.y;
        } else if (cx === 0 && cy === 1) {
          newW = Math.max(minW, origSz.width - snapDelta(dx));
          newH = Math.max(minH, origSz.height + snapDelta(dy));
          newX = origPos.x + (origSz.width - newW);
          newY = origPos.y;
        } else if (cx === 1 && cy === 0) {
          newW = Math.max(minW, origSz.width + snapDelta(dx));
          newH = Math.max(minH, origSz.height - snapDelta(dy));
          newX = origPos.x;
          newY = origPos.y + (origSz.height - newH);
        } else {
          newW = Math.max(minW, origSz.width  - snapDelta(dx));
          newH = Math.max(minH, origSz.height - snapDelta(dy));
          newX = origPos.x + (origSz.width - newW);
          newY = origPos.y + (origSz.height - newH);
        }

        // Constrain icon-mode nodes to square and update circle attrs
        if (model.get('iconMode')) {
          const s = Math.max(newW, newH);
          const origS = Math.max(origSz.width, origSz.height);
          newW = s; newH = s;
          if (cx === 0) newX = origPos.x + (origS - s);
          if (cy === 0) newY = origPos.y + (origS - s);
        }

        // Width-only for content-owned heights (df.Table) + Gantt bars: keep height + y put so the view's height
        // re-fit can't strand the table a few px lower after a top-corner drag. x still tracks a left-corner drag.
        if (horizontalOnly) { newH = origSz.height; newY = origPos.y; }

        // Gantt task: snap the resized EDGE to a day column live (just like dragging snaps the bar). The right edge
        // snaps when a right corner is dragged; the left edge (with the right fixed) when a left corner is dragged.
        if (type === 'sf.GanttTask') {
          const tl = ganttTimelineFor(model);
          if (tl) {
            if (cx === 1) {
              const r = snapGanttX(tl, newX + newW);
              if (r != null) newW = Math.max(minW, r - newX);
            } else if (cx === 0) {
              const rightFixed = origPos.x + origSz.width;
              const l = snapGanttX(tl, newX);
              if (l != null && l <= rightFixed - minW) { newX = l; newW = rightFixed - newX; }
            }
          }
        }

        // A df.Legend resize is a deliberate width → stop it auto-fitting back to the label (sticks until
        // "Auto size"). Set once at the start of the drag.
        if (type === 'df.Legend' && !model.get('manualWidth')) model.set('manualWidth', true);

        model.position(newX, newY);
        model.resize(newW, newH);
        // Issue 1: show the live start - end date chip above the bar while resizing, exactly like a drag does.
        if (type === 'sf.GanttTask') {
          const tl = ganttTimelineFor(model);
          const d = tl && deriveGanttDates(model, tl);
          if (d) showGanttDateChip(model, d.start, d.end);
        }
        if (model.get('iconMode')) {
          const r = newW / 2;
          model.attr('body/rx', r);
          model.attr('body/ry', r);
          const pad = Math.round(newW * 0.2);
          const iconSz = newW - pad * 2;
          model.attr('icon/x', pad);
          model.attr('icon/y', pad);
          model.attr('icon/width', iconSz);
          model.attr('icon/height', iconSz);
        }
        updateGuides(newX, newY, newW, newH);

        // Sync peers: same new size, adjust position by same delta relative to their anchor corner
        const dw = newW - origSz.width;
        const dh = newH - origSz.height;
        for (const p of peers) {
          p.model.resize(newW, newH);
          if (p.model.get('iconMode')) {
            const r = newW / 2;
            p.model.attr('body/rx', r);
            p.model.attr('body/ry', r);
            const pad = Math.round(newW * 0.2);
            const iconSz = newW - pad * 2;
            p.model.attr('icon/x', pad);
            p.model.attr('icon/y', pad);
            p.model.attr('icon/width', iconSz);
            p.model.attr('icon/height', iconSz);
          }
          // Only shift position for corners that move the origin
          let px = p.origPos.x;
          let py = p.origPos.y;
          if (cx === 0) px -= dw;
          if (cy === 0) py -= dh;
          p.model.position(px, py);
        }
      };

      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        guideH.remove();
        guideV.remove();
        // Gantt task resize → re-DATE from the new pixels. The canvas drag write-back can't see a handle resize
        // (the handle's pointerdown stops propagation, so paper's element:pointerup never fires for it), so do
        // it here. Dates are the source of truth → the GanttTaskView then re-snaps the bar to its columns.
        const grownTLs = new Set();
        for (const m of [model, ...peers.map(p => p.model)]) {
          if (m.get('type') === 'sf.GanttTask') {
            const d = deriveGanttDates(m); if (d) m.set({ startDate: d.start, endDate: d.end });
            const tl = ganttTimelineFor(m); if (tl) grownTLs.add(tl);
          }
        }
        clearGanttDateChip();                 // issue 1: remove the resize date chip
        grownTLs.forEach(tl => growTimelineToFitDates(tl));   // issue 5: extend the timeline if a bar now runs past its edge
        // Close the batch started in onDown — the whole drag is one undo step.
        history.endBatch();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    };

    g.addEventListener('pointerdown', onDown);
  });

  // Position handles and keep them updated on model changes. The tiny Gantt point shapes (milestone diamond / day
  // marker triangle) get the handles pushed a margin OUTSIDE their bbox so they don't cover the glyph + its labels.
  const mType = model.get('type');
  const margin = (mType === 'sf.GanttMilestone' || mType === 'sf.GanttMarker') ? 14 : 0;
  const along = (frac, size) => frac === 0 ? -margin : frac === 1 ? size + margin : frac * size;
  const updatePositions = () => {
    const { width, height } = model.size();
    view._sfHandles?.forEach(({ g, cx, cy }) =>
      g.setAttribute('transform', `translate(${along(cx, width)},${along(cy, height)})`)
    );
  };
  updatePositions();
  model.on('change:size change:position', updatePositions);
  view._sfHandleUpdater = updatePositions;
}

export function removeResizeHandles(view) {
  view._sfHandles?.forEach(({ g }) => g.remove());
  view._sfHandles = null;
  if (view._sfHandleUpdater) {
    view.model.off('change:size change:position', view._sfHandleUpdater);
    view._sfHandleUpdater = null;
  }
}

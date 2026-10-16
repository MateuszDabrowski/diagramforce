// Resize handles — the corner-drag resize interaction extracted from selection.js (S9). Raw SVG +
// vanilla-JS pointer drag (avoids JointJS event conflicts): four corner handles per selected view,
// live tracking guide lines, per-type constraints (min size, icon-mode square lock, df.Table/Gantt
// width-only, Gantt column snapping + live date chip + re-date on drop), and multi-select peer sync.
//
// initResizeHandles({ graph, paper, selectedIds }) wires the live refs (selectedIds is the SAME Set
// selection.js mutates - shared by reference, so peer collection sees the live selection). Reads
// history + the Gantt geometry helpers + the canvas date-chip forwarders.
import * as history from '../history.js?v=1.26.3';
import { deriveGanttDates, ganttTimelineFor, snapGanttX, growTimelineToFitDates } from '../gantt-layout.js?v=1.26.3';
import { showGanttDateChip, clearGanttDateChip } from '../canvas.js?v=1.26.3';
import { HALO_PARENT_TYPES } from '../canvas/embedding.js?v=1.26.3';

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

// Rotation helpers (review I7). JointJS rotates an element by `angle` about its centre, clockwise on screen.
const rotate = (x, y, cos, sin) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
/** The on-screen point of corner (fx, fy) (0 or 1 each) of a shape at pos/size rotated by `angle`. */
function cornerPoint(pos, size, angle, fx, fy) {
  const rad = angle * Math.PI / 180;
  const r = rotate((fx - 0.5) * size.width, (fy - 0.5) * size.height, Math.cos(rad), Math.sin(rad));
  return { x: pos.x + size.width / 2 + r.x, y: pos.y + size.height / 2 + r.y };
}
/** The top-left that keeps the corner opposite handle (cx, cy) where it was on screen when a shape rotated by `angle`
 *  goes from pos0/size0 to w x h. Rounded to 1/1000 px so a 90-degree drag does not leave float dust. */
function anchoredOrigin(pos0, size0, angle, cx, cy, w, h) {
  const fixed = cornerPoint(pos0, size0, angle, 1 - cx, 1 - cy);
  const rad = angle * Math.PI / 180;
  const r = rotate((0.5 - cx) * w, (0.5 - cy) * h, Math.cos(rad), Math.sin(rad));
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return { x: r3(fixed.x - r.x - w / 2), y: r3(fixed.y - r.y - h / 2) };
}

// [minW, minH] for shapes that may shrink BELOW their default size. Every other shape floors at its own default size,
// capped at the generic 80 x 40 (a 40 x 50 Data Object at 40 x 40, an Off-Page Link at 60 x 40, a Text label at
// 80 x 32): the generic floor alone left a small shape enlarged past 80 x 40 unable to drag back to its default
// (review I1 follow-up for these four, S3-5 for the rest). The drag floor below also never exceeds the size at drag start.
const SMALL_SHAPE_MIN = Object.assign(Object.create(null), {
  'sf.Line': [80, 4],
  'sf.BpmnEvent': [24, 24],
  'sf.BpmnGateway': [24, 24],
  'df.Pill': [16, 16],
});

export function addResizeHandles(view) {
  removeResizeHandles(view);
  view._sfHandles = [];
  const model = view.model;
  const grid = paper.options.gridSize || 16;
  const snapDelta = v => Math.round(v / grid) * grid;
  const type = model.get('type');
  // Activations are narrow strips sitting on top of participant lifelines —
  // their starting width is 12, so the minimum should be the same (not 80).
  const small = SMALL_SHAPE_MIN[type];
  const def = (typeof model.defaults === 'function' ? model.defaults() : model.defaults)?.size;
  const minW = small ? small[0] : (type === 'sf.SequenceActivation') ? 12 : Math.min(80, def?.width ?? 80);
  const minH = small ? small[1] : (type === 'sf.GanttTask' || type === 'sf.GanttMilestone') ? 24 : (type === 'sf.GanttGroup') ? 16
    : Math.min(40, def?.height ?? 40);
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
      // The floor never exceeds the shape's own size at drag start: a 120x8 divider Line, a 40x40 BPMN event or a
      // 32x32 Pill jumped to 80x40 on the first pixel of a drag (review I1).
      const floorW = Math.min(minW, origSz.width);
      const floorH = Math.min(minH, origSz.height);
      // A rotated shape's handles sit at its rotated corners (they live in the rotated view.el): turn the pointer
      // delta into the shape's own frame, and keep the opposite corner where it is on screen. The screen delta used
      // to land on the unrotated width and height, so a vertical divider could not be lengthened (review I7).
      const angle = model.angle() || 0;
      const rad = angle * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);

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
            peers.push({ model: peer, origPos: { ...peer.position() }, origSz: { ...pSz }, angle: peer.angle() || 0 });
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

      // The guides cross at the dragged corner, on screen (for a rotated shape too).
      const updateGuides = (x, y, w, h) => {
        const { x: edgeX, y: edgeY } = cornerPoint({ x, y }, { width: w, height: h }, angle, cx, cy);
        guideV.setAttribute('x1', edgeX);
        guideV.setAttribute('y1', edgeY - 10000);
        guideV.setAttribute('x2', edgeX);
        guideV.setAttribute('y2', edgeY + 10000);
        guideH.setAttribute('x1', edgeX - 10000);
        guideH.setAttribute('y1', edgeY);
        guideH.setAttribute('x2', edgeX + 10000);
        guideH.setAttribute('y2', edgeY);
      };

      const onMove = (e) => {
        const scale = paper.scale().sx;
        const sdx = (e.clientX - startX) / scale;
        const sdy = (e.clientY - startY) / scale;
        const dx = angle ? sdx * cos + sdy * sin : sdx;
        const dy = angle ? -sdx * sin + sdy * cos : sdy;

        let newW, newH, newX, newY;
        if (cx === 1 && cy === 1) {
          newW = Math.max(floorW, origSz.width  + snapDelta(dx));
          newH = Math.max(floorH, origSz.height + snapDelta(dy));
          newX = origPos.x;
          newY = origPos.y;
        } else if (cx === 0 && cy === 1) {
          newW = Math.max(floorW, origSz.width - snapDelta(dx));
          newH = Math.max(floorH, origSz.height + snapDelta(dy));
          newX = origPos.x + (origSz.width - newW);
          newY = origPos.y;
        } else if (cx === 1 && cy === 0) {
          newW = Math.max(floorW, origSz.width + snapDelta(dx));
          newH = Math.max(floorH, origSz.height - snapDelta(dy));
          newX = origPos.x;
          newY = origPos.y + (origSz.height - newH);
        } else {
          newW = Math.max(floorW, origSz.width  - snapDelta(dx));
          newH = Math.max(floorH, origSz.height - snapDelta(dy));
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
        // Under half a grid step, or a few screen pixels of hand jitter at a low zoom, is a press, not a resize: the bar
        // keeps its pixels, or the 80 px minimum and the day snap stretched a short bar on a click (review L6).
        if (type === 'sf.GanttTask' && (snapDelta(dx) === 0 || Math.abs(e.clientX - startX) < 4)) {
          newX = origPos.x; newW = origSz.width;
        } else if (type === 'sf.GanttTask') {
          const tl = ganttTimelineFor(model);
          if (tl) {
            if (cx === 1) {
              const r = snapGanttX(tl, newX + newW);
              if (r != null) newW = Math.max(floorW, r - newX);
            } else if (cx === 0) {
              const rightFixed = origPos.x + origSz.width;
              const l = snapGanttX(tl, newX);
              if (l != null && l <= rightFixed - floorW) { newX = l; newW = rightFixed - newX; }
            }
          }
        }

        // A df.Legend resize is a deliberate width → stop it auto-fitting back to the label (sticks until
        // "Auto size"). Set once at the start of the drag.
        if (type === 'df.Legend' && !model.get('manualWidth')) model.set('manualWidth', true);
        // Same idea for a container-ish frame: dragging its handle is a deliberate size, so pin it and stop
        // the embedding content-hug from snapping it back to its children on the next child drag. Cleared by
        // "Auto size". HALO_PARENT_TYPES is the exact set fitParentToChildren wraps.
        if (HALO_PARENT_TYPES.has(type) && !model.get('manualSize')) model.set('manualSize', true);

        // JointJS rotates about the centre, so the unrotated anchoring above drifts a rotated shape.
        if (angle) ({ x: newX, y: newY } = anchoredOrigin(origPos, origSz, angle, cx, cy, newW, newH));
        model.position(newX, newY);
        model.resize(newW, newH);
        // Issue 1: show the live start - end date chip above the bar while resizing, exactly like a drag does.
        if (type === 'sf.GanttTask') {
          const tl = ganttTimelineFor(model);
          const d = tl && deriveGanttDates(model, tl);
          // The edge NOT being dragged keeps its date (as onUp writes it), so the chip shows that date, not pixels.
          if (d) showGanttDateChip(model, cx === 0 ? d.start : (model.get('startDate') || d.start), cx === 0 ? (model.get('endDate') || d.end) : d.end);
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
          // Pin each synced peer as the grabbed one is pinned above (peers share its type); only the grabbed frame
          // was pinned, so the next card move inside a peer hugged it back (review I11).
          if (type === 'df.Legend' && !p.model.get('manualWidth')) p.model.set('manualWidth', true);
          if (HALO_PARENT_TYPES.has(type) && !p.model.get('manualSize')) p.model.set('manualSize', true);
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
          if (p.angle) ({ x: px, y: py } = anchoredOrigin(p.origPos, p.origSz, p.angle, cx, cy, newW, newH));
          p.model.position(px, py);
        }
      };

      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        guideH.remove();
        guideV.remove();
        // Gantt task resize → re-DATE from the new pixels. The canvas drag write-back can't see a handle resize
        // (the handle's pointerdown stops propagation, so paper's element:pointerup never fires for it), so do
        // it here. Dates are the source of truth → the GanttTaskView then re-snaps the bar to its columns.
        // Only the edge that moved is re-read (left handle → start, right handle → end), and an unmoved bar is not
        // re-dated at all: a bar is drawn at least 8 px wide, so reading BOTH edges back lengthened a short task
        // (review L6, the resize twin of deriveGanttMove).
        const grownTLs = new Set();
        for (const p of [{ model, origPos, origSz }, ...peers]) {
          const m = p.model;
          if (m.get('type') !== 'sf.GanttTask') continue;
          if (m.position().x === p.origPos.x && m.size().width === p.origSz.width) continue;
          const d = deriveGanttDates(m);
          if (d) m.set(cx === 0 ? { startDate: d.start } : { endDate: d.end });
          const tl = ganttTimelineFor(m); if (tl) grownTLs.add(tl);
        }
        clearGanttDateChip();                 // issue 1: remove the resize date chip
        grownTLs.forEach(tl => growTimelineToFitDates(tl));   // issue 5: extend the timeline if a bar now runs past its edge
        // Close the batch started in onDown — the whole drag is one undo step.
        history.endBatch();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      // A cancelled pointer (the OS took the touch, a palm, a system gesture) never sends pointerup: the history batch
      // stayed open and the move listener stayed live, so the next touch anywhere resized the shape to it (audit
      // 2026-09-23). End the resize where it stands, as a pointerup would.
      document.addEventListener('pointercancel', onUp);
    };

    g.addEventListener('pointerdown', onDown);
    // A finger also fires touchstart, which the preventDefault above does not cancel. JointJS binds the paper to
    // touchstart, so it bubbled there: the shape was dragged by the same delta it was resized by, and a held handle
    // opened the long-press menu (review S3-2). Stopping it here is enough; the canvas is touch-action: none.
    g.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
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

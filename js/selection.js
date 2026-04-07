// Selection manager — tracks selected elements
// Provides single-click, shift-click, rubber-band selection, and alignment ops

let graph, paper;
const selectedIds = new Set();
const onChangeCallbacks = [];

// --- Resize handles via raw SVG + vanilla JS drag (avoids JointJS event conflicts) ---
const SVG_NS = 'http://www.w3.org/2000/svg';
const RESIZE_CORNERS = [
  { cx: 0, cy: 0, cursor: 'nwse-resize' },
  { cx: 1, cy: 0, cursor: 'nesw-resize' },
  { cx: 0, cy: 1, cursor: 'nesw-resize' },
  { cx: 1, cy: 1, cursor: 'nwse-resize' },
];

function addResizeHandles(view) {
  removeResizeHandles(view);
  view._sfHandles = [];
  const model = view.model;
  const grid = paper.options.gridSize || 16;
  const snapDelta = v => Math.round(v / grid) * grid;
  const type = model.get('type');
  const minW = 80;
  const minH = (type === 'sf.GanttTask' || type === 'sf.GanttMilestone') ? 24 : (type === 'sf.GanttGroup') ? 16 : 40;

  RESIZE_CORNERS.forEach(({ cx, cy, cursor }) => {
    const g = document.createElementNS(SVG_NS, 'g');
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('width', '12');
    rect.setAttribute('height', '12');
    rect.setAttribute('x', '-6');
    rect.setAttribute('y', '-6');
    rect.setAttribute('fill', 'var(--selection-color)');
    rect.setAttribute('stroke', 'white');
    rect.setAttribute('stroke-width', '1.5');
    rect.setAttribute('rx', '2');
    rect.style.cursor = cursor;
    g.appendChild(rect);
    view.el.appendChild(g);
    view._sfHandles.push({ g, cx, cy });

    const onDown = (evt) => {
      evt.stopPropagation();
      evt.preventDefault();
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

        model.position(newX, newY);
        model.resize(newW, newH);
        updateGuides(newX, newY, newW, newH);

        // Sync peers: same new size, adjust position by same delta relative to their anchor corner
        const dw = newW - origSz.width;
        const dh = newH - origSz.height;
        for (const p of peers) {
          p.model.resize(newW, newH);
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
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    };

    g.addEventListener('pointerdown', onDown);
  });

  // Position handles and keep them updated on model changes
  const updatePositions = () => {
    const { width, height } = model.size();
    view._sfHandles?.forEach(({ g, cx, cy }) =>
      g.setAttribute('transform', `translate(${cx * width},${cy * height})`)
    );
  };
  updatePositions();
  model.on('change:size change:position', updatePositions);
  view._sfHandleUpdater = updatePositions;
}

function removeResizeHandles(view) {
  view._sfHandles?.forEach(({ g }) => g.remove());
  view._sfHandles = null;
  if (view._sfHandleUpdater) {
    view.model.off('change:size change:position', view._sfHandleUpdater);
    view._sfHandleUpdater = null;
  }
}

export function init(_graph, _paper) {
  graph = _graph;
  paper = _paper;

  // Track whether the user is dragging (to distinguish click vs drag for multi-select)
  let pointerDownId = null;
  let didDrag = false;

  // Use pointerdown (not pointerclick) so selection and properties panel
  // respond immediately on the first press — no double-click needed.
  // Helper: Cmd on Mac, Ctrl on Windows/Linux for multi-select
  const isMultiSelectKey = (evt) => evt.metaKey || evt.ctrlKey;

  paper.on('element:pointerdown', (cellView, evt) => {
    evt.stopPropagation();
    pointerDownId = cellView.model.id;
    didDrag = false;
    if (isMultiSelectKey(evt)) {
      toggle(cellView.model.id);
    } else if (!selectedIds.has(cellView.model.id)) {
      // Not in current selection — select only this one
      selectOnly(cellView.model.id);
    }
    // If already selected: keep multi-selection intact for potential group drag
  });

  paper.on('element:pointermove', () => {
    didDrag = true;
  });

  paper.on('element:pointerup', (cellView, evt) => {
    // If element was already selected, multi-select key wasn't held, and user didn't drag — then select only this element
    if (pointerDownId === cellView.model.id && !didDrag && !isMultiSelectKey(evt) && selectedIds.size > 1 && selectedIds.has(cellView.model.id)) {
      selectOnly(cellView.model.id);
    }
    pointerDownId = null;
    didDrag = false;
  });

  paper.on('link:pointerdown', (cellView, evt) => {
    evt.stopPropagation();
    const linkId = cellView.model.id;
    if (isMultiSelectKey(evt)) {
      toggle(linkId);
    } else if (!selectedIds.has(linkId)) {
      // Only re-select if not already selected — avoids destroying
      // arrowhead tools mid-drag which freezes the paper permanently.
      selectOnly(linkId);
    }
  });

  setupRubberBand();
  setupMultiDrag();
}

export function getSelectedIds() { return [...selectedIds]; }

export function getSelectedElements() {
  return [...selectedIds].map(id => graph.getCell(id)).filter(Boolean);
}

export function isSelected(id) { return selectedIds.has(id); }
export function getCount() { return selectedIds.size; }

export function addToSelection(id) {
  selectedIds.add(id);
  applyVisual(id);
  notifyChange();
}

export function selectOnly(id) {
  clearVisual();
  selectedIds.clear();
  selectedIds.add(id);
  applyVisual(id);
  notifyChange();
}

export function toggle(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    removeVisual(id);
  } else {
    selectedIds.add(id);
    applyVisual(id);
  }
  notifyChange();
}

export function clearSelection() {
  clearVisual();
  selectedIds.clear();
  notifyChange();
}

export function selectAll() {
  clearVisual();
  selectedIds.clear();
  graph.getCells().forEach(cell => {
    selectedIds.add(cell.id);
    applyVisual(cell.id);
  });
  notifyChange();
}

export function deleteSelected() {
  const cells = getSelectedElements();
  clearVisual();
  selectedIds.clear();
  notifyChange();
  // Remove after clearing selection to avoid visual glitches
  cells.forEach(cell => cell.remove());
}

export function onChange(cb) { onChangeCallbacks.push(cb); }
function notifyChange() { onChangeCallbacks.forEach(cb => cb(getSelectedIds())); }

function applyVisual(id) {
  const view = paper.findViewByModel(id);
  if (!view) return;
  view.el.classList.add('selected');

  if (view.model.isElement()) {
    addResizeHandles(view);
  } else if (view.model.isLink()) {
    const endpointAttrs = {
      d: 'M -6 -6 6 -6 6 6 -6 6 Z',
      fill: 'var(--color-primary, #3578E5)',
      stroke: '#fff',
      'stroke-width': 1.5,
      cursor: 'move',
      opacity: 0.75,
    };
    view.addTools(new joint.dia.ToolsView({
      tools: [
        new joint.linkTools.Vertices(),
        new joint.linkTools.SourceArrowhead({ attributes: { ...endpointAttrs, class: 'source-arrowhead' } }),
        new joint.linkTools.TargetArrowhead({ attributes: { ...endpointAttrs, class: 'target-arrowhead' } }),
      ],
    }));
  }
}

function removeVisual(id) {
  const view = paper.findViewByModel(id);
  if (!view) return;
  view.el.classList.remove('selected');
  removeResizeHandles(view);
  view.removeTools();
}

function clearVisual() {
  selectedIds.forEach(id => removeVisual(id));
}

// Multi-element drag — when dragging one selected element, move all others too.
// Also moves embedded children of selected containers/zones that aren't themselves selected.
function setupMultiDrag() {
  let draggedId = null;
  let lastPos = null;

  paper.on('element:pointerdown', (cellView) => {
    const id = cellView.model.id;
    if (selectedIds.size > 1 && selectedIds.has(id)) {
      draggedId = id;
      const pos = cellView.model.position();
      lastPos = { x: pos.x, y: pos.y };
    }
  });

  paper.on('element:pointermove', (cellView) => {
    if (!draggedId || cellView.model.id !== draggedId) return;
    const pos = cellView.model.position();
    const dx = pos.x - lastPos.x;
    const dy = pos.y - lastPos.y;
    if (dx === 0 && dy === 0) return;
    lastPos = { x: pos.x, y: pos.y };

    // Collect all IDs that will be moved by JointJS embedding (children of dragged element)
    const movedByEngine = new Set([draggedId]);
    function addEmbeds(cellId) {
      const c = graph.getCell(cellId);
      if (!c) return;
      (c.getEmbeddedCells() || []).forEach(child => {
        movedByEngine.add(child.id);
        addEmbeds(child.id);
      });
    }
    addEmbeds(draggedId);

    // Move other selected elements (and their embeds) that aren't already moved by the engine
    selectedIds.forEach(id => {
      if (movedByEngine.has(id)) return;
      const cell = graph.getCell(id);
      if (!cell?.isElement()) return;
      // Check if this element is a child of another selected element (already moved)
      const parentId = cell.get('parent');
      if (parentId && selectedIds.has(parentId)) return;
      const p = cell.position();
      cell.position(p.x + dx, p.y + dy);
      // JointJS will move embedded children automatically via the parent's position change
    });
  });

  paper.on('element:pointerup', () => {
    draggedId = null;
    lastPos = null;
  });
}

// Rubber-band selection (shift+drag on blank area)
function setupRubberBand() {
  let isSelecting = false;
  let startX, startY;
  let rectEl = null;

  paper.on('blank:pointerdown', (evt) => {
    if (!evt.shiftKey) {
      // Plain blank click — deselect all, let canvas.js handle pan
      clearSelection();
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      return;
    }
    // Shift+drag on blank — start rubber-band selection (prevent pan)
    evt.preventDefault();
    isSelecting = true;
    // Store raw client coords for clientToLocalPoint conversion
    // Store canvas-relative coords for the visual overlay
    const canvasRect = document.getElementById('canvas-container').getBoundingClientRect();
    startX = evt.clientX;
    startY = evt.clientY;

    rectEl = document.createElement('div');
    rectEl.className = 'sf-selection-rect';
    Object.assign(rectEl.style, {
      left: (evt.clientX - canvasRect.left) + 'px',
      top: (evt.clientY - canvasRect.top) + 'px',
      width: '0px',
      height: '0px',
    });
    document.getElementById('canvas-container').appendChild(rectEl);
  });

  document.addEventListener('mousemove', (evt) => {
    if (!isSelecting || !rectEl) return;
    const canvasRect = document.getElementById('canvas-container').getBoundingClientRect();
    const left = Math.min(startX, evt.clientX) - canvasRect.left;
    const top = Math.min(startY, evt.clientY) - canvasRect.top;
    const width = Math.abs(evt.clientX - startX);
    const height = Math.abs(evt.clientY - startY);

    Object.assign(rectEl.style, {
      left: left + 'px',
      top: top + 'px',
      width: width + 'px',
      height: height + 'px',
    });
  });

  document.addEventListener('mouseup', (evt) => {
    if (!isSelecting) return;
    isSelecting = false;
    rectEl?.remove();
    rectEl = null;

    // clientToLocalPoint takes raw client coords (handles paper offset internally)
    const tl = paper.clientToLocalPoint(Math.min(startX, evt.clientX), Math.min(startY, evt.clientY));
    const br = paper.clientToLocalPoint(Math.max(startX, evt.clientX), Math.max(startY, evt.clientY));
    const localRect = { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };

    // Only select if user dragged a meaningful area
    if (localRect.width < 4 && localRect.height < 4) return;

    clearVisual();
    selectedIds.clear();
    graph.getCells().forEach(cell => {
      if (cell.isLink()) return;
      const bbox = cell.getBBox();
      if (rectsIntersect(localRect, bbox)) {
        selectedIds.add(cell.id);
        applyVisual(cell.id);
      }
    });
    notifyChange();
  });
}

function rectsIntersect(a, b) {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

// --- Alignment operations ---

export function alignLeft() {
  const els = getSelectedElements().filter(e => e.isElement());
  if (els.length < 2) return;
  const minX = Math.min(...els.map(e => e.position().x));
  els.forEach(e => e.position(minX, e.position().y));
}

export function alignCenterH() {
  const els = getSelectedElements().filter(e => e.isElement());
  if (els.length < 2) return;
  const avg = els.reduce((s, e) => s + e.position().x + e.size().width / 2, 0) / els.length;
  els.forEach(e => e.position(avg - e.size().width / 2, e.position().y));
}

export function alignRight() {
  const els = getSelectedElements().filter(e => e.isElement());
  if (els.length < 2) return;
  const maxX = Math.max(...els.map(e => e.position().x + e.size().width));
  els.forEach(e => e.position(maxX - e.size().width, e.position().y));
}

export function alignTop() {
  const els = getSelectedElements().filter(e => e.isElement());
  if (els.length < 2) return;
  const minY = Math.min(...els.map(e => e.position().y));
  els.forEach(e => e.position(e.position().x, minY));
}

export function alignMiddle() {
  const els = getSelectedElements().filter(e => e.isElement());
  if (els.length < 2) return;
  const avg = els.reduce((s, e) => s + e.position().y + e.size().height / 2, 0) / els.length;
  els.forEach(e => e.position(e.position().x, avg - e.size().height / 2));
}

export function alignBottom() {
  const els = getSelectedElements().filter(e => e.isElement());
  if (els.length < 2) return;
  const maxY = Math.max(...els.map(e => e.position().y + e.size().height));
  els.forEach(e => e.position(e.position().x, maxY - e.size().height));
}

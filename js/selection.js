// Selection manager — tracks selected elements
// Provides single-click, shift-click, rubber-band selection, and alignment ops

import * as clipboard from './clipboard.js?v=1.17.2.11';
import * as history from './history.js?v=1.17.2.11';
import { isFocusDimmingEnabled, canEmbed, setDragSelectionBBox } from './canvas.js?v=1.17.2.11';
import { fieldFocus } from './canvas/focus-state.js?v=1.17.2.11';

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
  // Activations are narrow strips sitting on top of participant lifelines —
  // their starting width is 12, so the minimum should be the same (not 80).
  const minW = (type === 'sf.SequenceActivation') ? 12 : 80;
  const minH = (type === 'sf.GanttTask' || type === 'sf.GanttMilestone') ? 24 : (type === 'sf.GanttGroup') ? 16 : 40;

  const coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const handleSize = coarsePointer ? 20 : 12;
  const handleOffset = handleSize / 2;

  RESIZE_CORNERS.forEach(({ cx, cy, cursor }) => {
    const g = document.createElementNS(SVG_NS, 'g');
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('width', String(handleSize));
    rect.setAttribute('height', String(handleSize));
    rect.setAttribute('x', String(-handleOffset));
    rect.setAttribute('y', String(-handleOffset));
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

        model.position(newX, newY);
        model.resize(newW, newH);
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
        // Close the batch started in onDown — the whole drag is one undo step.
        history.endBatch();
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

  // The directed field-lineage graph is cached; any structural change to links
  // (add/remove/re-endpoint) or a bulk reset invalidates it.
  graph.on('add remove reset change:source change:target', invalidateFieldGraph);
  graph.on('change:linkKind', invalidateFieldGraph);

  // ── Field-hover flow trace (Data Mapping) ──────────────────────────────────
  // Hovering a field row lights that field's lineage across layers (same engine as
  // selecting a connector), transiently — moving off restores the selection's state.
  // No-op for fields that don't participate in a mapping link (so it's inert in
  // non-mapping diagrams). Suppressed while dragging.
  let _hoverFieldKey = null;
  const fieldRowAt = (target) => {
    const row = target?.closest?.('.do-field-row');
    if (!row) return null;
    const objEl = row.closest('[model-id]');
    const objId = objEl?.getAttribute('model-id');
    const fid = row.getAttribute('data-fid');
    if (!objId || !fid) return null;
    const cell = graph.getCell(objId);
    if (!cell || cell.get('type') !== 'sf.DataObject') return null;
    return { objId, fid, key: `${objId}::${fid}` };
  };
  const endHover = () => { if (_hoverFieldKey) { _hoverFieldKey = null; updateLinkDimming(); } };
  paper.el.addEventListener('mouseover', (e) => {
    if (pointerDownId !== null || !isFocusDimmingEnabled()) return;
    const hit = fieldRowAt(e.target);
    if (!hit) { endHover(); return; }
    if (hit.key === _hoverFieldKey) return;
    const fg = fieldGraph();
    if (!fg.fwd.has(hit.key) && !fg.bwd.has(hit.key)) { endHover(); return; } // unmapped field
    if (applyFieldFlowFocus({ hoverField: { objId: hit.objId, fid: hit.fid } })) _hoverFieldKey = hit.key;
  });
  paper.el.addEventListener('mouseleave', endHover);

  // Use pointerdown (not pointerclick) so selection and properties panel
  // respond immediately on the first press — no double-click needed.
  // Multi-select bindings: Cmd/Ctrl+click (legacy) and Shift+click
  // (industry-standard, matches Figma/Lucid). Shift+drag on the blank
  // canvas remains rubber-band — click vs drag disambiguates the two.
  const isMultiSelectKey = (evt) => evt.metaKey || evt.ctrlKey || evt.shiftKey;

  // Track touch pointers currently holding an element — enables two-finger
  // multi-select: one finger holds, second finger taps another element.
  const activeTouches = new Map(); // pointerId -> elementId

  paper.on('element:pointerdown', (cellView, evt) => {
    evt.stopPropagation();
    pointerDownId = cellView.model.id;
    didDrag = false;

    const isTouch = evt.pointerType === 'touch';
    const id = cellView.model.id;

    // Multi-touch multi-select: if another finger is already holding a different element, toggle.
    if (isTouch && activeTouches.size > 0) {
      let holdingDifferent = false;
      for (const heldId of activeTouches.values()) {
        if (heldId !== id) { holdingDifferent = true; break; }
      }
      if (holdingDifferent) {
        // Ensure the held element(s) are selected, then toggle this one.
        for (const heldId of activeTouches.values()) {
          if (!selectedIds.has(heldId)) addToSelection(heldId);
        }
        toggle(id);
        if (navigator.vibrate) navigator.vibrate(8);
        activeTouches.set(evt.pointerId, id);
        return;
      }
    }

    if (isTouch) {
      activeTouches.set(evt.pointerId, id);
      startLongPressMenu(cellView, evt);
    }

    if (isMultiSelectKey(evt)) {
      toggle(id);
    } else if (!selectedIds.has(id)) {
      // Not in current selection — select only this one
      selectOnly(id);
    }
    // If already selected: keep multi-selection intact for potential group drag
  });

  const clearTouch = (evt) => {
    if (evt.pointerId != null) activeTouches.delete(evt.pointerId);
  };
  paper.on('element:pointerup', (cellView, evt) => {
    clearTouch(evt);
    cancelLongPressMenu();
  });
  document.addEventListener('pointerup', clearTouch);
  document.addEventListener('pointercancel', (e) => { clearTouch(e); cancelLongPressMenu(); });

  paper.on('element:pointermove', () => {
    // First drag motion → clear connection-focus dimming so the user
    // can see all components clearly while positioning. Dimming
    // obscures the spatial context the user is reasoning about during
    // a drag (alignment, proximity, snap targets). We restore it on
    // pointerup below — re-evaluating against the (possibly new)
    // selection state via updateLinkDimming().
    if (!didDrag) {
      didDrag = true;
      suspendDimmingForDrag();
    }
    cancelLongPressMenu();
  });

  paper.on('element:pointerup', (cellView, evt) => {
    // If element was already selected, multi-select key wasn't held, and user didn't drag — then select only this element
    if (pointerDownId === cellView.model.id && !didDrag && !isMultiSelectKey(evt) && selectedIds.size > 1 && selectedIds.has(cellView.model.id)) {
      selectOnly(cellView.model.id);
    }
    pointerDownId = null;
    if (didDrag) {
      // Drag finished — restore dimming against the current selection
      // (which may have been refined by a click-without-drag path above).
      updateLinkDimming();
    }
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

  // Desktop right-click → a custom canvas context menu (replaces the browser default). On a cell, keep the
  // current multi-selection if the right-clicked cell is part of it, else select just that cell; on the blank
  // canvas, a Paste / Select-all menu. (Touch keeps its long-press menu, above.)
  const onCellContextMenu = (cellView, evt) => {
    evt.preventDefault();
    const model = cellView.model;
    const prev = getSelectedIds();   // capture BEFORE selectOnly, so "Add to selection" can merge the prior pick
    if (!selectedIds.has(model.id)) selectOnly(model.id);
    showContextMenu(evt.clientX, evt.clientY, model, { prevSelection: prev });
  };
  paper.on('element:contextmenu', onCellContextMenu);
  paper.on('link:contextmenu', onCellContextMenu);
  paper.on('blank:contextmenu', (evt) => {
    evt.preventDefault();
    showContextMenu(evt.clientX, evt.clientY, null);
  });

  // Touch long-press on the BLANK canvas opens the same Paste / Select-all menu (touch has no right-click).
  // The element long-press lives in element:pointerdown above; this is its blank-canvas counterpart. A
  // finger move (pan) or lift cancels it before it fires. Gating lives inside startLongPressMenu (coarse/width).
  paper.on('blank:pointerdown', (evt) => {
    if (evt.pointerType === 'touch') startLongPressMenu(null, evt);
  });
  paper.on('blank:pointermove', cancelLongPressMenu);
  paper.on('blank:pointerup', cancelLongPressMenu);

  // Paper-root pointer bracket for history batching (v1.12.4).
  //
  // JointJS link tools (SourceArrowhead, TargetArrowhead, Vertices) are
  // separate view objects that handle their own pointer events — they
  // DON'T emit `link:pointerdown` / `link:pointerup` on the paper.
  // Listening at the paper's root SVG catches every interaction
  // (cell click, body drag, tool drag, blank-area click), so the
  // arrowhead drag — which previously slipped past the link-level
  // bracket — is now wrapped in startBatch / endBatch like everything
  // else. Nested batches are safe (history.startBatch is depth-aware),
  // so the resize-handle batch in addResizeHandles still works.
  //
  // capture: true on pointerdown so we win the race against any inner
  // stopPropagation — resize handles call evt.stopPropagation in their
  // own onDown but we've already opened the batch by that point.
  //
  // pointerup must be DEFERRED, however. Our capture-phase document
  // pointerup runs BEFORE JointJS's tool-finalisation handlers (those
  // listen on bubble phase or directly on the tool element and fire
  // change:source / change:target synchronously on pointerup as the
  // link snaps to its final port). Closing the batch immediately would
  // leave that final endpoint change OUTSIDE the batch — which is
  // exactly the "captures multiple steps during drag" symptom users
  // reported. setTimeout(0) lets every sync handler fire first, then
  // closes the batch with the final change events folded in.
  //
  // A new pointerdown arriving before the deferred close clears the
  // pending timer and closes the prior batch synchronously, so two
  // back-to-back gestures don't collapse into one undo entry.
  let _pointerBatchOpen = false;
  let _pendingEndTimer = null;
  const closeBatchNow = () => {
    if (_pendingEndTimer) {
      clearTimeout(_pendingEndTimer);
      _pendingEndTimer = null;
    }
    if (_pointerBatchOpen) {
      history.endBatch();
      _pointerBatchOpen = false;
    }
  };
  const onPaperPointerDown = () => {
    // Close any prior batch that hasn't been flushed yet — a new
    // gesture starts a fresh undo entry.
    closeBatchNow();
    history.startBatch();
    _pointerBatchOpen = true;
  };
  const onPaperPointerEnd = () => {
    if (!_pointerBatchOpen || _pendingEndTimer) return;
    _pendingEndTimer = setTimeout(() => {
      _pendingEndTimer = null;
      if (_pointerBatchOpen) {
        history.endBatch();
        _pointerBatchOpen = false;
      }
    }, 0);
  };
  paper.el.addEventListener('pointerdown', onPaperPointerDown, true);
  // pointerup can land on the DOCUMENT if the pointer was released
  // outside the paper's bounding box (drag past the canvas edge), so
  // we listen at the document level for the close-side. pointercancel
  // covers the rare case where the OS preempts the gesture.
  document.addEventListener('pointerup', onPaperPointerEnd, true);
  document.addEventListener('pointercancel', onPaperPointerEnd, true);

  setupRubberBand();
  setupMultiDrag();
}

export function getSelectedIds() { return [...selectedIds]; }

export function getSelectedElements() {
  return [...selectedIds].map(id => graph.getCell(id)).filter(Boolean);
}

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
  if (!cells.length) return;
  if (navigator.vibrate && window.matchMedia?.('(pointer: coarse)').matches) {
    navigator.vibrate(25);
  }
  clearVisual();
  selectedIds.clear();
  notifyChange();
  // ONE undo step for the whole deletion. Each cell.remove() (plus the links JointJS
  // cascades) fires its own `remove` event → a command each; the batch composites them
  // so a single Cmd+Z restores the entire selection at once instead of one cell per tap.
  history.startBatch();
  try {
    // Remove after clearing selection to avoid visual glitches
    cells.forEach(cell => cell.remove());
  } finally {
    history.endBatch();
  }
}

export function onChange(cb) { onChangeCallbacks.push(cb); }

/** Public refresh for the dim overlay (v1.12.4). Called by the Display
 *  menu's Focus Dimming toggle so flipping the option re-applies (or
 *  clears) dimming against the current selection without needing the
 *  user to reselect. */
export function refreshDimming() { updateLinkDimming(); }
function notifyChange() {
  updateLinkDimming();
  onChangeCallbacks.forEach(cb => cb(getSelectedIds()));
}

// ── Connection-focus dimming (v1.12.4) ──────────────────────────────
// When one or more ELEMENTS are selected, fade everything in the
// diagram that doesn't touch the selection: links not connected to a
// selected element, AND elements that have at least one link but aren't
// connected to any selected element. Elements with no links at all
// (Zones, Notes, TextLabels, stray nodes) are left untouched — they
// can't have "connection focus" so dimming them would be confusing.
//
// Rules:
//   - No elements selected → clear all dimming (a bare link selection
//     keeps the focus-highlight code path doing its thing).
//   - One+ elements selected:
//       • Dim every link whose source.id AND target.id are BOTH NOT in
//         the selected-element set.
//       • Dim every element that HAS at least one link AND is not in
//         the connected set (= selected itself OR linked to a selected).
//       • Leave un-linked elements alone (Zones, Notes, etc.).
//   - A link that is itself selected stays visible even if it isn't
//     attached to a selected element (the user picked it deliberately).
//   - Hover overrides dim via CSS so the user can still inspect a
//     dimmed connection on demand.
//
// After applying classes, dispatch `sf:selection-dim-change` so the
// canvas bump-overlay can match opacity on its arc/restoration parts
// — the bumps live in a separate SVG group and don't inherit the link
// view's CSS class.
// Clear all dim classes immediately — used at the start of a drag so the
// user can see every component clearly while positioning. NOT a full
// reset of selection state; just the visual dimming overlay. The matching
// re-evaluation happens on pointerup via updateLinkDimming().
function suspendDimmingForDrag() {
  document.querySelectorAll('.joint-link.df-link-dimmed').forEach(el => {
    el.classList.remove('df-link-dimmed');
  });
  document.querySelectorAll('.joint-element.df-element-dimmed').forEach(el => {
    el.classList.remove('df-element-dimmed');
  });
  // Notify the bump-overlay so its tinted opacities clear too.
  document.dispatchEvent(new CustomEvent('sf:selection-dim-change'));
}

// ── Directed field-lineage engine (Data Mapping flow focus) ────────────────────
// Model: a directed graph of FIELDS. node = "objId::fid"; edge = a mapping link from
// source field (right port) → target field (left port). Data flows along edges
// left→right across layers (Source → DLO → DMO → …). Tracing one direction only (never
// reversing) is what keeps focus tight: from a field you follow its data forward and
// back, but you don't fan sideways into siblings that merely share a downstream target.
const _fidOfPort = port => (typeof port === 'string' && port.startsWith('field-'))
  ? port.replace(/^field-(left|right)-/, '') : null;
const _fieldKeyOfEp = ep => (ep && ep.id && _fidOfPort(ep.port)) ? `${ep.id}::${_fidOfPort(ep.port)}` : null;

let _fieldGraphCache = null;             // { fwd:Map<key,Set>, bwd:Map<key,Set>, links:[{id,sk,tk}] }
function invalidateFieldGraph() { _fieldGraphCache = null; }
function fieldGraph() {
  if (_fieldGraphCache) return _fieldGraphCache;
  const fwd = new Map(), bwd = new Map(), links = [];
  const add = (m, k, v) => { let s = m.get(k); if (!s) m.set(k, s = new Set()); s.add(v); };
  for (const l of graph.getLinks()) {
    if (l.prop('linkKind') !== 'mapping') continue;
    const sk = _fieldKeyOfEp(l.get('source')), tk = _fieldKeyOfEp(l.get('target'));
    if (!sk || !tk) continue;
    add(fwd, sk, tk); add(bwd, tk, sk);
    links.push({ id: l.id, sk, tk });
  }
  _fieldGraphCache = { fwd, bwd, links };
  return _fieldGraphCache;
}
// Walk ONE direction (no reversal) from the seed field-keys; returns reachable set incl. seeds.
function traceDir(seedKeys, dir) {
  const g = fieldGraph();
  const adj = dir === 'up' ? g.bwd : g.fwd;
  const seen = new Set(seedKeys);
  const queue = [...seedKeys];
  while (queue.length) {
    const next = adj.get(queue.pop());
    if (next) for (const n of next) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  }
  return seen;
}
// Compute the lineage field-set (+ which objects stay fully lit) for a flow selection/hover.
// linkSeeds: connector(s) → upstream(source) + downstream(target). objectSeeds: both
// directions from every field of the object (the object itself stays fully lit). hoverField:
// both directions from a single hovered field. Returns null when nothing traced.
function computeFieldLineage({ linkSeeds = [], objectSeeds = [], hoverField = null }) {
  if (!fieldGraph().links.length && !objectSeeds.length) return null;
  const fields = new Set();
  const fullyLit = new Set();
  const bothWays = (seedKeys) => { for (const k of traceDir(seedKeys, 'up')) fields.add(k); for (const k of traceDir(seedKeys, 'down')) fields.add(k); };
  for (const l of linkSeeds) {
    const sk = _fieldKeyOfEp(l.get('source')), tk = _fieldKeyOfEp(l.get('target'));
    if (!sk || !tk) continue;
    for (const k of traceDir([sk], 'up')) fields.add(k);
    for (const k of traceDir([tk], 'down')) fields.add(k);
    fields.add(sk); fields.add(tk);
  }
  for (const objId of objectSeeds) {
    const cell = graph.getCell(objId);
    if (!cell || cell.get('type') !== 'sf.DataObject') continue;
    fullyLit.add(objId);
    const seedKeys = (cell.get('fields') || []).filter(f => f && f.fid).map(f => `${objId}::${f.fid}`);
    if (seedKeys.length) bothWays(seedKeys);
  }
  if (hoverField?.objId && hoverField?.fid) bothWays([`${hoverField.objId}::${hoverField.fid}`]);
  return fields.size ? { fields, fullyLit } : null;
}
// Apply field-level flow focus: light lineage fields, dim the rest. Returns true if applied.
function applyFieldFlowFocus(opts) {
  if (!graph || !paper) return false;
  const lin = computeFieldLineage(opts);
  if (!lin) return false;
  const { fields, fullyLit } = lin;
  // On-thread mapping links = both endpoints on the lineage.
  const onThread = new Set();
  for (const e of fieldGraph().links) if (fields.has(e.sk) && fields.has(e.tk)) onThread.add(e.id);
  for (const link of graph.getLinks()) {
    const view = paper.findViewByModel(link);
    if (view?.el) view.el.classList.toggle('df-link-dimmed', !onThread.has(link.id));
  }
  // Object dimming (root-el class, survives row rebuilds) + collect the field-row keys
  // to fade. A whole object dims only when NONE of its fields are on the flow.
  const dimmedKeys = new Set();
  for (const el of graph.getElements()) {
    const view = paper.findViewByModel(el);
    if (el.get('type') !== 'sf.DataObject') { if (view?.el) view.el.classList.remove('df-element-dimmed'); continue; }
    const objId = el.id;
    const objFields = el.get('fields') || [];
    const hasLineageField = objFields.some(f => f && f.fid && fields.has(`${objId}::${f.fid}`));
    if (view?.el) view.el.classList.toggle('df-element-dimmed', !hasLineageField);
    // The selected object stays fully lit; on every other lineage object the rows that
    // aren't on the flow fade.
    if (hasLineageField && !fullyLit.has(objId)) {
      for (const f of objFields) if (f && f.fid && !fields.has(`${objId}::${f.fid}`)) dimmedKeys.add(`${objId}::${f.fid}`);
    }
  }
  // Record in shared focus-state so DataObjectView._renderFieldRows re-asserts it after
  // any later rebuild, then apply over the LIVE DOM rows (a mid-churn findViewByModel can
  // return a stale/detached view, so the document is the source of truth here).
  fieldFocus.dimmed = dimmedKeys;
  paper.svg.querySelectorAll('.do-field-row').forEach(r => {
    const fid = r.getAttribute('data-fid');
    const objId = r.closest('[model-id]')?.getAttribute('model-id');
    r.classList.toggle('df-field-dimmed', !!fid && !!objId && dimmedKeys.has(`${objId}::${fid}`));
  });
  document.dispatchEvent(new CustomEvent('sf:selection-dim-change'));
  return true;
}
function clearFieldRowDims() {
  fieldFocus.dimmed = null;
  document.querySelectorAll('.do-field-row.df-field-dimmed').forEach(el => el.classList.remove('df-field-dimmed'));
}

// Mapping-flow focus (Data Mapping): a selected mapping CONNECTOR traces its specific
// field thread; a selected DataObject traces its whole bidirectional lineage. Both are
// field-level (non-lineage rows dim). Returns true if it took over (selection touched a
// mapping link); false lets the generic element-focus path handle non-mapping selections.
function applyMappingFlowDimming(selectedLinkIds, selectedElementIds = new Set()) {
  if (!graph || !paper) return false;
  const linkSeeds = [];
  for (const id of selectedLinkIds) {
    const l = graph.getCell(id);
    if (l && l.isLink && l.isLink() && l.prop('linkKind') === 'mapping') linkSeeds.push(l);
  }
  // Only objects that actually participate in a mapping link trigger flow focus — an
  // isolated object has no flow and falls through to generic element focus.
  const mappingLinks = graph.getLinks().filter(l => l.prop('linkKind') === 'mapping');
  const objTouchesMapping = id => mappingLinks.some(l => l.get('source')?.id === id || l.get('target')?.id === id);
  const objectSeeds = [...selectedElementIds].filter(id => {
    const c = graph.getCell(id);
    return c && c.get && c.get('type') === 'sf.DataObject' && objTouchesMapping(id);
  });
  if (!linkSeeds.length && !objectSeeds.length) return false;
  return applyFieldFlowFocus({ linkSeeds, objectSeeds });
}

function updateLinkDimming() {
  if (!graph || !paper) return;

  // Focus Dimming toggle (Display menu) — when off, no element is ever
  // dimmed regardless of selection. Clear any classes left over from
  // before the user disabled it and bail. v1.12.4.
  if (!isFocusDimmingEnabled()) {
    document.querySelectorAll('.joint-link.df-link-dimmed').forEach(el => {
      el.classList.remove('df-link-dimmed');
    });
    document.querySelectorAll('.joint-element.df-element-dimmed').forEach(el => {
      el.classList.remove('df-element-dimmed');
    });
    clearFieldRowDims();
    document.dispatchEvent(new CustomEvent('sf:selection-dim-change'));
    return;
  }

  const selectedElementIds = new Set();
  const selectedLinkIds = new Set();
  for (const id of selectedIds) {
    const cell = graph.getCell(id);
    if (!cell) continue;
    if (cell.isElement()) selectedElementIds.add(id);
    else if (cell.isLink()) selectedLinkIds.add(id);
  }

  // Mapping-flow focus takes priority for ANY selection that touches a mapping link —
  // a selected mapping connector OR a selected DataObject that participates in one. It
  // lights the whole Source→DLO→DMO chain and dims the rest (including disconnected
  // objects). Returns false for non-mapping selections, which fall through to the
  // generic element/link focus below.
  if (applyMappingFlowDimming(selectedLinkIds, selectedElementIds)) return;
  // Not a mapping flow — any field-row dimming from a prior flow focus must be cleared
  // (the generic element/link focus below works at object level only).
  clearFieldRowDims();

  if (selectedElementIds.size === 0) {
    // Pure non-mapping link or empty selection — clear every dim class so prior
    // element-focused state doesn't linger.
    document.querySelectorAll('.joint-link.df-link-dimmed').forEach(el => {
      el.classList.remove('df-link-dimmed');
    });
    document.querySelectorAll('.joint-element.df-element-dimmed').forEach(el => {
      el.classList.remove('df-element-dimmed');
    });
    document.dispatchEvent(new CustomEvent('sf:selection-dim-change'));
    return;
  }

  // Expand the selection to include the embedded children of any
  // selected container, AND the parent container of any selected child.
  // This makes "select Marketing" implicitly cover Ariel inside (so
  // Marc → Ariel link stays visible), and "select Ariel" implicitly
  // covers Marketing (so the parent container doesn't dim out from
  // under its selected child). Recursive: handles nested containers.
  const expandedSelection = new Set(selectedElementIds);
  const addChildrenRecursive = (id) => {
    const cell = graph.getCell(id);
    if (!cell?.get) return;
    const embeds = cell.get('embeds') || [];
    for (const childId of embeds) {
      if (!expandedSelection.has(childId)) {
        expandedSelection.add(childId);
        addChildrenRecursive(childId);
      }
    }
  };
  const addParentChain = (id) => {
    const cell = graph.getCell(id);
    if (!cell?.get) return;
    const parentId = cell.get('parent');
    if (parentId && !expandedSelection.has(parentId)) {
      expandedSelection.add(parentId);
      addParentChain(parentId);
    }
  };
  for (const id of [...selectedElementIds]) {
    addChildrenRecursive(id);
    addParentChain(id);
  }

  // Which elements count as "connected" to the selection. For most diagram types this is
  // the DIRECT (one-hop) neighbour set. For flow / hierarchy types (process, org) it's the
  // FULL directed path through the selection — every ancestor (walking incoming links) AND
  // descendant (walking outgoing links) — mirroring the Data Mapping lineage trace, so a
  // selection lights its whole thread rather than just the closest steps.
  const activeType = document.getElementById('canvas-container')?.dataset.diagramType;
  const flowTrace = activeType === 'process' || activeType === 'org';
  const connectedElementIds = new Set(expandedSelection);
  const elementsWithLinks = new Set();
  if (flowTrace) {
    // Directed adjacency, then BFS down (descendants) + up (ancestors) from the seeds.
    const fwd = new Map(), bwd = new Map();
    const push = (m, k, v) => { let a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(v); };
    for (const link of graph.getLinks()) {
      const s = link.get('source')?.id;
      const t = link.get('target')?.id;
      if (s) elementsWithLinks.add(s);
      if (t) elementsWithLinks.add(t);
      if (s && t) { push(fwd, s, t); push(bwd, t, s); }
    }
    const walk = (adj) => {
      const queue = [...expandedSelection];
      while (queue.length) {
        for (const n of (adj.get(queue.pop()) || [])) {
          if (!connectedElementIds.has(n)) { connectedElementIds.add(n); queue.push(n); }
        }
      }
    };
    walk(fwd);   // descendants
    walk(bwd);   // ancestors
  } else {
    // One-hop: an element is connected if a link directly joins it to the selection.
    for (const link of graph.getLinks()) {
      const srcId = link.get('source')?.id;
      const tgtId = link.get('target')?.id;
      if (srcId) elementsWithLinks.add(srcId);
      if (tgtId) elementsWithLinks.add(tgtId);
      if (srcId && expandedSelection.has(srcId) && tgtId) connectedElementIds.add(tgtId);
      if (tgtId && expandedSelection.has(tgtId) && srcId) connectedElementIds.add(srcId);
    }
  }

  // ── Embedding-aware lit propagation, so a container and its contents share one fate ──
  // DOWN: a container reached via a LINK (the connector points at the container as a unit — e.g. a route
  // into "Data Cloud") lights its whole subtree. Restricted to link-ENDPOINT containers via
  // `elementsWithLinks` so an ancestor lit only because a child of it is selected does NOT also light its
  // siblings. (Selected containers are already covered by the addChildrenRecursive expansion above.)
  const litDescendants = (id) => {
    for (const childId of (graph.getCell(id)?.get('embeds') || [])) {
      if (!connectedElementIds.has(childId)) { connectedElementIds.add(childId); litDescendants(childId); }
    }
  };
  for (const id of [...connectedElementIds]) {
    const cell = graph.getCell(id);
    if (cell?.get && cell.get('type') === 'sf.Container' && elementsWithLinks.has(id)) litDescendants(id);
  }
  // UP: any container holding lit content stays lit, so it doesn't dim out from under a connected child.
  for (const id of [...connectedElementIds]) {
    let parentId = graph.getCell(id)?.get('parent');
    while (parentId && !connectedElementIds.has(parentId)) {
      connectedElementIds.add(parentId);
      parentId = graph.getCell(parentId)?.get('parent');
    }
  }

  // Apply link dimming. On a flow trace a connector lights only when BOTH ends are on the traced path;
  // otherwise (one-hop) when EITHER end is in the selection. Build the per-link decision first, then write
  // it to EVERY DOM node carrying that model-id — JointJS v4 renders the link's LINE in the cells layer
  // and its LABELS in a separate `joint-labels-layer`, each as its own `[model-id]` group, so updating
  // only findViewByModel's el would leave the label at full opacity (bright captions on dimmed links).
  const linkDim = new Map();
  for (const link of graph.getLinks()) {
    const srcId = link.get('source')?.id;
    const tgtId = link.get('target')?.id;
    const connected = flowTrace
      ? (srcId && connectedElementIds.has(srcId) && tgtId && connectedElementIds.has(tgtId))
      : ((srcId && expandedSelection.has(srcId)) || (tgtId && expandedSelection.has(tgtId)));
    linkDim.set(link.id, !connected && !selectedLinkIds.has(link.id));
  }
  for (const el of paper.el.querySelectorAll('.joint-link[model-id]')) {
    const dim = linkDim.get(el.getAttribute('model-id'));
    if (dim !== undefined) el.classList.toggle('df-link-dimmed', dim);
  }

  // Apply element dimming. A dim CANDIDATE is anything that's part of the diagram STRUCTURE — it has a
  // link, OR it's a Container, OR it's content embedded in a Container — so a whole group fades together.
  // Pure background (Zones/Layers) and standalone decorative shapes (Notes, TextLabels, link-less loose
  // nodes) are never candidates, keeping full opacity.
  const isDimmable = (el) => {
    const type = el.get('type');
    if (type === 'sf.Zone') return false;
    if (type === 'sf.Container') return true;
    if (elementsWithLinks.has(el.id)) return true;
    const parent = graph.getCell(el.get('parent'));
    return !!(parent?.get && parent.get('type') === 'sf.Container');
  };
  for (const el of graph.getElements()) {
    const view = paper.findViewByModel(el);
    if (!view?.el) continue;
    view.el.classList.toggle('df-element-dimmed', isDimmable(el) && !connectedElementIds.has(el.id));
  }

  document.dispatchEvent(new CustomEvent('sf:selection-dim-change'));
}

function applyVisual(id) {
  const view = paper.findViewByModel(id);
  if (!view) return;
  view.el.classList.add('selected');

  if (view.model.isElement()) {
    addResizeHandles(view);
  } else if (view.model.isLink()) {
    const endpointAttrs = {
      d: 'M -6 -6 6 -6 6 6 -6 6 Z',
      fill: 'var(--color-primary, #1D73C9)',
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
  // Pre-drag top-left of each container the selection currently sits in, so a container the
  // group is dragged fully OUT of can be restored to its original position (a mid-drop fit may
  // otherwise nudge it toward the departing children before they're un-embedded).
  const containerPosSnap = new Map();

  // Feed embedding.js the union bbox of the whole selection so the drop-ghost previews the
  // container growing to hold the ENTIRE group during a multi-drag (not just the element under
  // the pointer). embedding.js clears it on pointerup; null ⇒ single-drag ghost.
  const refreshDragGhostBBox = () => {
    const cells = [...selectedIds].map(s => graph.getCell(s)).filter(c => c && c.isElement && c.isElement());
    setDragSelectionBBox(cells.length ? graph.getCellsBBox(cells) : null);
  };

  paper.on('element:pointerdown', (cellView) => {
    const id = cellView.model.id;
    if (selectedIds.size > 1 && selectedIds.has(id)) {
      draggedId = id;
      const pos = cellView.model.position();
      lastPos = { x: pos.x, y: pos.y };
      refreshDragGhostBBox();
      containerPosSnap.clear();
      for (const sid of selectedIds) {
        const el = graph.getCell(sid);
        const pid = el && el.get('parent');
        if (pid && !containerPosSnap.has(pid)) {
          const p = graph.getCell(pid);
          if (p) { const pp = p.position(); containerPosSnap.set(pid, { x: pp.x, y: pp.y }); }
        }
      }
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

    // Keep the drop-ghost sized to the whole (now-moved) selection.
    refreshDragGhostBBox();
  });

  paper.on('element:pointerup', () => {
    // Multi-select group drop: JointJS's embeddingMode only embeds the element actually
    // under the pointer. If that element landed inside a container/zone/pool, pull the REST
    // of the selection into the SAME container too — so a group is captured in a single drag
    // instead of having to drop each element one by one.
    if (draggedId && selectedIds.size > 1) {
      const dragged = graph.getCell(draggedId);
      // The container the dragged element ended up in (JointJS embeds/un-embeds the
      // directly-dragged element via embeddingMode), or null if it landed on empty canvas.
      const cParentId = dragged && dragged.get('parent');
      const C = cParentId ? graph.getCell(cParentId) : null;
      const cType = C && C.get('type');
      const toEmbed = [];
      const toRelease = [];
      for (const id of selectedIds) {
        if (id === draggedId) continue;
        const el = graph.getCell(id);
        if (!el || !el.isElement || !el.isElement()) continue;
        if (C && id === C.id) continue;                  // never embed the container into itself
        const cur = el.get('parent');
        if (C && canEmbed(cType, el.get('type'))) {
          // CAPTURE — the group was dropped ON a container; pull every qualifying peer in.
          // No overlap needed: the container auto-fits to GROW around the whole selection,
          // so a flow far larger than the container still lands inside. Positions preserved.
          if (cur !== C.id) toEmbed.push(el);
        } else if (!C && cur) {
          // RELEASE — the group was dropped OUTSIDE any container (dragged element is free).
          // A peer still parented somewhere left with the group, so un-embed it; otherwise
          // its container keeps chasing the selection across the canvas (auto-fit follows it).
          const p = graph.getCell(cur);
          if (p) toRelease.push({ el, parent: p });
        }
      }
      // A snapshotted container can already be empty here — JointJS un-embeds the dragged
      // element on its own pointerup, which runs before this handler.
      const snapEmptyNow = [...containerPosSnap.keys()].some(pid => {
        const p = graph.getCell(pid);
        return p && (p.getEmbeddedCells() || []).length === 0;
      });
      if (toEmbed.length || toRelease.length || snapEmptyNow) {
        // One undo entry. The change:parent listener (embedding.js) refits each affected
        // container around its new / remaining children (and reverts an emptied one to its
        // default footprint).
        history.startBatch();
        try {
          for (const el of toEmbed) C.embed(el);
          for (const r of toRelease) r.parent.unembed(r.el);
          // Restore the pre-drag top-left of every container the group fully vacated — its size
          // was already reset to the default empty footprint by fitParentToChildren; this undoes
          // any nudge a mid-drop fit applied while it still held the departing children.
          for (const [pid, pos] of containerPosSnap) {
            const p = graph.getCell(pid);
            if (p && (p.getEmbeddedCells() || []).length === 0) p.position(pos.x, pos.y);
          }
        } finally { history.endBatch(); }
      }
    }
    containerPosSnap.clear();
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
    rectEl.className = 'df-selection-rect';
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

// ── Long-press context menu (touch / mobile) ──────────────────────
const LONG_PRESS_MS = 450;
let longPressTimer = null;
let longPressMenu = null;

function startLongPressMenu(cellView, evt) {
  // Touch entry to the canvas context menu. Gated on coarse pointer too (not just narrow width) so a TABLET
  // in desktop layout (>768px, touch, no hover, no right-click) still gets the menu - it is the only touch
  // route to Paste / Select-all and the per-element actions. `cellView` is null for a blank-canvas long-press.
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (!coarse && window.innerWidth > 768) return;
  cancelLongPressMenu();
  const clientX = evt.clientX;
  const clientY = evt.clientY;
  const model = cellView ? cellView.model : null;
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    // Ensure the element is selected so actions apply to it (no-op for a blank long-press).
    if (model && !selectedIds.has(model.id)) selectOnly(model.id);
    if (navigator.vibrate) navigator.vibrate(20);
    showContextMenu(clientX, clientY, model, { placement: 'above' });
  }, LONG_PRESS_MS);
}

function cancelLongPressMenu() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

// Per-element auto-size handler, registered by app.js (properties.autoSizeCell) — a callback so selection.js
// doesn't import properties.js (which imports selection — that would be a module cycle).
let _autoSizer = null;
export function setAutoSizer(fn) { _autoSizer = fn; }

// Link endpoint quick-set handler, registered by app.js (properties.setLinkEndpoints). Sets a link's source +
// target ER markers from a preset (→ / 1:1 / 1:M / M:1). A callback so selection.js doesn't import properties.js.
let _endpointSetter = null;
export function setEndpointSetter(fn) { _endpointSetter = fn; }
function applyEndpointPreset(srcKey, tgtKey) {
  if (!_endpointSetter) return;
  const links = getSelectedElements().filter(c => c.isLink && c.isLink());
  if (!links.length) return;
  history.startBatch();
  try { links.forEach(l => _endpointSetter(l, srcKey, tgtKey)); } finally { history.endBatch(); }
}

// Per-element action descriptor provider (properties.buildCellActions), registered by app.js — so the canvas
// right-click menu mirrors the SAME bottom-of-properties actions (clone variants, convert, order, auto size)
// for that shape type (#6). A callback, not an import, to avoid the selection<->properties module cycle.
let _actionProvider = null;
export function setActionProvider(fn) { _actionProvider = fn; }

// Copy/Paste STYLE clipboard (#1), registered by app.js → { copy, has, paste } from properties.js. Used by the
// MULTI-select context menu (the single-element menu gets these via _actionProvider/buildCellActions). A
// callback, not an import, to avoid the selection<->properties module cycle.
let _styleApi = null;
export function setStyleApi(api) { _styleApi = api; }

/** Reverse each selected connector's direction (swap source/target endpoints + flip any vertices). */
function reverseSelectedLinks() {
  const links = getSelectedElements().filter(c => c.isLink && c.isLink());
  if (!links.length) return;
  history.startBatch();
  try {
    links.forEach(l => {
      const src = l.get('source'); const tgt = l.get('target');
      l.set('source', tgt); l.set('target', src);
      const v = l.get('vertices');
      if (Array.isArray(v) && v.length) l.set('vertices', [...v].reverse());
    });
  } finally { history.endBatch(); }
}

/** Simplify each selected connector — drop manual waypoints so the router redraws a clean orthogonal path. */
function simplifySelectedLinks() {
  const links = getSelectedElements().filter(c => c.isLink && c.isLink());
  if (!links.length) return;
  history.startBatch();
  try { links.forEach(l => l.unset('vertices')); } finally { history.endBatch(); }
}

/** Auto-size each selected element via the registered sizer (properties.autoSizeCell). */
function autoSizeSelection() {
  if (!_autoSizer) return;
  const els = getSelectedElements().filter(c => c.isElement && c.isElement());
  if (!els.length) return;
  history.startBatch();
  try { els.forEach(c => _autoSizer(c)); } finally { history.endBatch(); }
}

// Canvas context-menu glyphs (item 18). Clone + Delete are the EXACT SVGs the properties pane uses, so the same
// action reads identically wherever it appears; the rest are matching 16-box line glyphs.
const _ctxSvg = (inner) => `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const CTX_ICON = {
  clone: _ctxSvg('<rect x="5" y="5" width="9" height="9" rx="2"/><path d="M3 11H2.5A1.5 1.5 0 011 9.5V2.5A1.5 1.5 0 012.5 1h7A1.5 1.5 0 0111 2.5V3"/>'),
  copy: _ctxSvg('<rect x="4" y="3" width="8" height="11" rx="1.5"/><path d="M6 3V1.8h4V3"/>'),
  delete: _ctxSvg('<path d="M3 4h10M6 4V2.5A.5.5 0 016.5 2h3a.5.5 0 01.5.5V4M4.5 4l.5 9.5h6l.5-9.5M7 7v4M9 7v4"/>'),
  paste: _ctxSvg('<rect x="3" y="3" width="10" height="11" rx="1.5"/><path d="M6 3V1.8h4V3M5.5 8h5M5.5 11h3.5"/>'),
  selectAll: _ctxSvg('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke-dasharray="2.4 1.8"/>'),
  addSel: _ctxSvg('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke-dasharray="2.4 1.8"/><path d="M8 5.5v5M5.5 8h5"/>'),
  reverse: _ctxSvg('<path d="M2 6h9M9 4l2 2-2 2M14 10H5M7 8l-2 2 2 2"/>'),
  // ER endpoint quick-set glyphs (line + the destination marker on the right): plain arrow, bar|bar (1:1),
  // bar→crow (1:M), crow→bar (M:1).
  endArrow:   _ctxSvg('<path d="M2 8h9M9 5l3 3-3 3"/>'),
  endOneOne:  _ctxSvg('<path d="M3 8h10M3 5v6M13 5v6"/>'),
  endOneMany: _ctxSvg('<path d="M3 8h10M3 5v6M13 5l-3 3 3 3"/>'),
  endManyOne: _ctxSvg('<path d="M3 8h10M3 5l3 3-3 3M13 5v6"/>'),
  simplify: _ctxSvg('<path d="M2 11h3.5l3-6H13"/><circle cx="2" cy="11" r="1"/><circle cx="13" cy="5" r="1"/>'),
  // Copy style = a paint droplet (sample the look); Paste style = a brush applying it (#1).
  copyStyle: _ctxSvg('<path d="M8 2c0 0 4 4.5 4 7a4 4 0 0 1-8 0c0-2.5 4-7 4-7z"/>'),
  pasteStyle: _ctxSvg('<path d="M12 3l1 1-5 5-1.5.5.5-1.5zM6.5 8.5L3 12l-1 2 2-1 3.5-3.5"/>'),
  autosize: _ctxSvg('<path d="M3 7V3h4M13 9v4H9M3 3l4 4M13 13l-4-4"/>'),
  saveShape: _ctxSvg('<path d="M4 2h8a1 1 0 011 1v11l-5-3-5 3V3a1 1 0 011-1z"/>'),   // bookmark = save to My Shapes
  // Convert / Bring-to-Front / Send-to-Back (#6) — filled glyphs matching the properties-panel buttons.
  convert: _ctxSvg('<path d="M1 4h11l-3-3M15 12H4l3 3"/>'),
  front: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12v2H2zM4 6h8v2H4zM6 10h4v4H6z"/></svg>',
  back: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6 2h4v4H6zM4 8h8v2H4zM2 12h12v2H2z"/></svg>',
  // Release contents: a (dashed) container with an arrow leaving it — un-embed all captured children.
  release: _ctxSvg('<rect x="2" y="3.5" width="7.5" height="9" rx="1.5" stroke-dasharray="2.2 1.6"/><path d="M8.5 8H14M11.5 5.5L14 8l-2.5 2.5"/>'),
};

/** Release contents: un-embed EVERY direct child of `parent` (they keep their positions) so the now-empty
 *  container can be deleted on its own — instead of dragging each captured element out first. One undo entry; the
 *  change:parent listener (embedding.js) then reverts the emptied container to its default footprint. */
function releaseEmbeddedChildren(parent) {
  const kids = (parent.getEmbeddedCells() || []).slice();   // copy: unembed mutates the parent's embeds array
  if (!kids.length) return;
  history.startBatch();
  try { for (const k of kids) parent.unembed(k); }
  finally { history.endBatch(); }
}
/**
 * The floating canvas context menu — shared by desktop right-click and the touch long-press. `model` is the
 * right-clicked cell, or `null` for the blank-canvas menu (Paste / Select all). `opts.placement`: 'cursor'
 * (default, desktop — drops below-right of the pointer) or 'above' (touch long-press — centered above the press).
 * `opts.prevSelection`: ids selected BEFORE the right-click, so a cell menu can offer "Add to selection".
 */
function showContextMenu(clientX, clientY, model, opts = {}) {
  closeContextMenu();
  const placement = opts.placement || 'cursor';

  const menu = document.createElement('div');
  menu.className = 'df-ctx-menu';

  const addItem = (label, action, { disabled = false, danger = false, icon = '' } = {}) => {
    const b = document.createElement('button');
    b.className = 'df-ctx-menu__item' + (danger ? ' df-ctx-menu__item--danger' : '');
    // Icon (item 18: same glyphs as the properties-pane actions) + label.
    b.innerHTML = `<span class="df-ctx-menu__icon" aria-hidden="true">${icon}</span><span>${label}</span>`;   // labels are static literals
    b.disabled = !!disabled;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (b.disabled) return;
      closeContextMenu();
      action();
    });
    menu.appendChild(b);
  };
  const addSep = () => { const s = document.createElement('div'); s.className = 'df-ctx-menu__sep'; menu.appendChild(s); };

  if (model) {
    // Component-specific menu mirroring the properties-pane actions, with the SAME icons. Links: Clone / Reverse
    // direction / Simplify path. Elements: Clone / Copy / Auto size. "Add to selection" (when a prior selection
    // exists) lets you build a multi-select via right-clicks. Both end in a danger Delete.
    const prev = (opts.prevSelection || []).filter((id) => id !== model.id);
    if (prev.length) {
      // Re-add the previously-selected cells alongside this one → a growing multi-select built by right-clicking.
      addItem('Add to selection', () => { prev.forEach((id) => addToSelection(id)); addToSelection(model.id); }, { icon: CTX_ICON.addSel });
    }
    if (model.isLink()) {
      addItem('Clone', () => clipboard.duplicate(), { icon: CTX_ICON.clone });
      if (_endpointSetter) {
        // Quick-set the most common ER endings without opening the properties marker pickers (item R1).
        addSep();
        addItem('Set to standard', () => applyEndpointPreset('none', 'arrow'), { icon: CTX_ICON.endArrow });
        addItem('Set to 1:1', () => applyEndpointPreset('one', 'one'), { icon: CTX_ICON.endOneOne });
        addItem('Set to 1:M', () => applyEndpointPreset('one', 'many'), { icon: CTX_ICON.endOneMany });
        addItem('Set to M:1', () => applyEndpointPreset('many', 'one'), { icon: CTX_ICON.endManyOne });
      }
      addSep();
      addItem('Reverse direction', () => reverseSelectedLinks(), { icon: CTX_ICON.reverse });
      addItem('Simplify path', () => simplifySelectedLinks(), { icon: CTX_ICON.simplify });
      addSep();   // set Delete apart (item R1)
    } else if (_actionProvider && selectedIds.size <= 1) {
      // Single element → mirror the FULL bottom-of-properties action set for this shape (#6): the 3 clone
      // variants, Copy, Convert(s), Bring to Front / Send to Back, Auto size. Separators between logical groups.
      const acts = _actionProvider(model) || [];
      let lastGroup = null;
      for (const a of acts) {
        if (lastGroup !== null && a.group !== lastGroup) addSep();
        lastGroup = a.group;
        addItem(a.label, a.handler, { icon: CTX_ICON[a.iconKey] || '' });
      }
      if (acts.length) addSep();
    } else {
      // Multi-select: the common whole-selection actions PLUS the per-shape actions that make sense uniformly
      // when EVERY selected element is the same type (clone-with-connectors variants, Convert, Order), each applied
      // to every element in one undo step (#8). A mixed-type selection keeps the reduced set. Copy style is offered
      // only for a single-type selection (mixing styles has no one source); Paste style always applies to all.
      const els = getSelectedElements().filter((c) => c.isElement && c.isElement());
      const homogeneous = els.length > 0 && new Set(els.map((c) => c.get('type'))).size === 1;
      const repActs = (homogeneous && _actionProvider) ? (_actionProvider(els[0]) || []) : [];
      addItem('Clone', () => clipboard.duplicate(), { icon: CTX_ICON.clone });
      // Mirror clone-variant / convert / order actions across the uniform selection. The plain Clone + Copy are
      // already in this menu, so they're skipped here.
      const multiActs = repActs.filter((a) => ['clone', 'convert', 'order'].includes(a.group) && a.label !== 'Clone' && a.label !== 'Copy');
      let lastGroup = null;
      for (const a of multiActs) {
        if (lastGroup !== null && a.group !== lastGroup) addSep();
        lastGroup = a.group;
        // Capture each element's own handler NOW (before any Convert mutates the graph), then run them all batched.
        const handlers = els.map((c) => (_actionProvider(c) || []).find((x) => x.label === a.label)?.handler).filter(Boolean);
        addItem(a.label, () => {
          history.startBatch();
          try { handlers.forEach((h) => { try { h(); } catch { /* one bad cell shouldn't abort the rest */ } }); }
          finally { history.endBatch(); }
        }, { icon: CTX_ICON[a.iconKey] || '' });
      }
      if (multiActs.length) addSep();
      addItem('Copy', () => clipboard.copy(), { icon: CTX_ICON.copy });
      if (_autoSizer) addItem('Auto size', () => autoSizeSelection(), { icon: CTX_ICON.autosize });
      if (_styleApi && !model.isLink()) {
        addSep();
        // Copy style needs ONE coherent source — only when the selection is a single styled type (item 8).
        if (repActs.some((a) => a.group === 'style')) addItem('Copy style', () => _styleApi.copy(els[0]), { icon: CTX_ICON.copyStyle });
        if (_styleApi.has()) addItem('Paste style', () => _styleApi.paste(els), { icon: CTX_ICON.pasteStyle });
      }
    }
    // Release contents: a container that captured children → un-embed them ALL at once (they keep their positions),
    // so the now-empty container can be deleted on its own instead of dragging each captured element out first.
    // Single element only, and only when it actually holds children.
    if (!model.isLink() && selectedIds.size <= 1 && (model.getEmbeddedCells() || []).length) {
      addSep();
      addItem('Release contents', () => releaseEmbeddedChildren(model), { icon: CTX_ICON.release });
    }
    addItem('Delete', () => {
      if (navigator.vibrate) navigator.vibrate(30);
      deleteSelected();
    }, { danger: true, icon: CTX_ICON.delete });
  } else {
    // Blank canvas — Paste (disabled when the clipboard is empty) + Select all.
    addItem('Paste', () => clipboard.paste(), { disabled: !clipboard.hasClipboard(), icon: CTX_ICON.paste });
    addItem('Select all', () => selectAll(), { icon: CTX_ICON.selectAll });
  }

  document.body.appendChild(menu);

  // Position — clamp to viewport.
  const mr = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x, y;
  if (placement === 'above') {
    x = clientX - mr.width / 2;
    y = clientY - mr.height - 12;
    if (y < 8) y = clientY + 16;
  } else {
    x = clientX + 2;     // drop from just below-right of the cursor
    y = clientY + 2;
  }
  x = Math.max(8, Math.min(vw - mr.width - 8, x));
  y = Math.max(8, Math.min(vh - mr.height - 8, y));
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  longPressMenu = menu;

  const dismiss = (e) => {
    if (menu.contains(e.target)) return;
    closeContextMenu();
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', dismiss, { once: true });
  }, 0);
}

function closeContextMenu() {
  if (longPressMenu) {
    longPressMenu.remove();
    longPressMenu = null;
  }
}

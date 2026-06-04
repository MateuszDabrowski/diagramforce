// Embedding — parent-child container mechanics. Extracted from canvas.js
// (Phase 4, Slice 12 — the final interactive domain).
//
// Hybrid split, because JointJS needs the embedding constraints as paper
// *constructor* options:
//  • canEmbed + findEmbeddingParent are imported by canvas.js straight into the
//    paper's embeddingMode config at instantiation time (they're called later,
//    at drag time, when cctx.graph is live).
//  • The auto-fit engine (fitParentToChildren) + its 4 graph triggers mount
//    post-hydration via registerEmbedding(cctx).
//  • The auto-sizing toggle is localStorage-backed.
// canvas.js re-exports canEmbed / isAutoSizingEnabled / setAutoSizingEnabled /
// refitAllParents for stencil.js (canEmbed) + properties.js (canEmbed) +
// toolbar.js (the toggle + refit). Reads graph/paper via cctx; export-stable.
import { cctx } from './context.js?v=1.14.1';

// ── Auto-sizing toggle (v1.11.6) ────────────────────────────────────
// Controls whether fitParentToChildren may grow/shrink a parent to its embedded
// children. Default ON, persisted in localStorage so the choice survives reloads.
const AUTO_SIZE_LS_KEY = 'sfdiag::autoSizing';
export function isAutoSizingEnabled() {
  try {
    const v = localStorage.getItem(AUTO_SIZE_LS_KEY);
    return v === null ? true : v === 'true';
  } catch { return true; }
}
export function setAutoSizingEnabled(v) {
  try { localStorage.setItem(AUTO_SIZE_LS_KEY, String(!!v)); } catch {}
}

// ── Embedding rules — single source of truth ────────────────────────
// The paper's validateEmbedding delegates here, and shape-conversion code in
// properties.js uses this to decide whether the converted cell can stay embedded
// in its previous parent (e.g. converting a Node to a Container should preserve
// embedding when the old parent is a Zone, but not another Container).
export function canEmbed(parentType, childType) {
  if (parentType === 'sf.Container') {
    return childType !== 'sf.Container' && childType !== 'sf.Zone';
  }
  if (parentType === 'sf.Zone') {
    return childType !== 'sf.Zone';
  }
  if (parentType === 'sf.BpmnPool') {
    return childType !== 'sf.BpmnPool';
  }
  if (parentType === 'sf.BpmnSubprocess') {
    return childType !== 'sf.BpmnPool' && childType !== 'sf.BpmnSubprocess';
  }
  if (parentType === 'sf.BpmnLoop') {
    return childType !== 'sf.BpmnPool' && childType !== 'sf.BpmnSubprocess' && childType !== 'sf.BpmnLoop';
  }
  if (parentType === 'sf.GanttTimeline') {
    return childType === 'sf.GanttTask' || childType === 'sf.GanttMilestone' || childType === 'sf.GanttMarker' || childType === 'sf.GanttGroup';
  }
  if (parentType === 'sf.SequenceParticipant' || parentType === 'sf.SequenceActor') {
    return childType === 'sf.SequenceActivation';
  }
  if (parentType === 'sf.Task') {
    return childType === 'sf.OrgPerson' || childType === 'sf.Container';
  }
  return false;
}

// ── Capture halo (v1.14.1) ──────────────────────────────────────────
// Auto-Fit hugs a container tightly to its children, leaving almost no interior
// to drop a NEW child into. The halo widens the *catch* area: an element whose
// centre lands within an inflated region around a container-like parent is still
// embedded. Generous below and to BOTH sides — the fit grows the bottom + left +
// right edges to wrap the child, so "drop just outside" works on three sides.
// Top is smaller: the header can't grow up, so a top drop just tucks below it.
const CAPTURE_HALO_BOTTOM = 64;
const CAPTURE_HALO_SIDE = 64;
const CAPTURE_HALO_TOP = 48;
// Only the free-form grouping parents opt into the halo. Structured parents
// (Gantt timeline, sequence participant/actor, Task RACI column) keep exact
// overlap — placement there is positional, not "anywhere inside".
const HALO_PARENT_TYPES = new Set([
  'sf.Container', 'sf.Zone', 'sf.BpmnPool', 'sf.BpmnSubprocess', 'sf.BpmnLoop',
]);

// Find a container-like parent whose capture region (visible bbox inflated by
// the halo) contains the child's centre, honouring canEmbed. Topmost (highest z)
// wins. Single definition shared by both capture paths — canvas drag (via
// findEmbeddingParent) and stencil drop (via stencil.js tryEmbed). Returns the
// parent element, or null.
export function findHaloParent(childBBox, childType, excludeId) {
  const { graph } = cctx;
  if (!graph) return null;
  const cx = childBBox.x + childBBox.width / 2;
  const cy = childBBox.y + childBBox.height / 2;
  let best = null;
  let bestZ = -Infinity;
  for (const el of graph.getElements()) {
    if (el.id === excludeId) continue;
    const type = el.get('type');
    if (!HALO_PARENT_TYPES.has(type)) continue;
    if (!canEmbed(type, childType)) continue;
    const b = el.getBBox();
    if (cx >= b.x - CAPTURE_HALO_SIDE && cx <= b.x + b.width + CAPTURE_HALO_SIDE
      && cy >= b.y - CAPTURE_HALO_TOP && cy <= b.y + b.height + CAPTURE_HALO_BOTTOM) {
      const z = el.get('z') || 0;
      if (z > bestZ) { bestZ = z; best = el; }
    }
  }
  return best;
}

// After a capture, tuck the child below the parent's TOP edge only — the one
// direction the fit can't grow (the header sits at the top, and content can't
// live above it). Left/right/bottom overflow is intentionally kept: the fit grows
// those edges to wrap the child (v1.14.1), so left/right/below drops wrap in
// place. No-op when the child already sits below the header (the common case).
export function tuckChildInside(child, parent) {
  const { paper } = cctx;
  if (!child || !parent) return;
  const cp = child.position();
  const pp = parent.position();
  const pad = (paper?.options.gridSize || 4) * (paper?.options.drawGrid?.args?.scaleFactor || 4);
  // Container carries a ~32px header bar; keep children clear of it. Zone / BPMN
  // groupers have no header.
  const headerPad = parent.get('type') === 'sf.Container' ? 32 : 0;
  const ny = Math.max(cp.y, pp.y + headerPad + pad);
  if (ny !== cp.y) child.position(cp.x, ny);
}

// ── Parent candidate lookup (paper findParentBy) ────────────────────
// Called by JointJS during an embedding-mode drag (cctx.graph is live by then).
// Gantt milestones/markers resolve up from a hit GanttTask to its Timeline.
export function findEmbeddingParent(elementView) {
  const { graph } = cctx;
  const childType = elementView.model.get('type');
  const bbox = elementView.model.getBBox();
  const candidates = graph.findModelsInArea(bbox).filter(
    (el) => el.id !== elementView.model.id
  );
  // For milestones/markers: if a GanttTask is found, replace it with its GanttTimeline ancestor
  if (childType === 'sf.GanttMilestone' || childType === 'sf.GanttMarker') {
    const resolved = [];
    const seen = new Set();
    for (const el of candidates) {
      let target = el;
      if (el.get('type') === 'sf.GanttTask') {
        const parentId = el.get('parent');
        if (parentId) {
          const parentEl = graph.getCell(parentId);
          if (parentEl && parentEl.get('type') === 'sf.GanttTimeline') {
            target = parentEl;
          }
        }
      }
      if (!seen.has(target.id)) {
        seen.add(target.id);
        resolved.push(target);
      }
    }
    return resolved;
  }
  // Capture halo: if the element doesn't overlap any container-like parent that
  // can hold it, fall back to the inflated catch region so a drop just outside
  // the border still embeds. Purely additive — a real overlap still wins.
  const hasContainerHit = candidates.some(
    (el) => HALO_PARENT_TYPES.has(el.get('type')) && canEmbed(el.get('type'), childType)
  );
  if (!hasContainerHit) {
    const halo = findHaloParent(bbox, childType, elementView.model.id);
    if (halo && !candidates.includes(halo)) candidates.push(halo);
  }
  return candidates;
}

// ── Auto-fit engine ─────────────────────────────────────────────────
// Don't shrink a parent below this height — a Container header bar is ~32 px, so
// 48 keeps a small body strip visible even for a single tiny child near the top.
const PARENT_FIT_MIN_HEIGHT = 48;
// …or below this width — keeps the header label (e.g. "Container") from
// overflowing when the right edge hugs a very narrow child.
const PARENT_FIT_MIN_WIDTH = 120;

function fitParentToChildren(parent) {
  const { graph, paper } = cctx;
  if (!isAutoSizingEnabled()) return;
  if (!parent || !parent.isElement || !parent.isElement()) return;
  // Filter by `parent` attribute directly — `parent.getEmbeddedCells()` reads
  // the parent's own `embeds` array, which JointJS may not have updated yet
  // during a synchronous remove/un-embed event.
  const children = graph.getElements().filter(c => c.get('parent') === parent.id);
  if (children.length === 0) return; // empty parent: leave it alone
  let maxBottom = -Infinity;
  let maxRight = -Infinity;
  let minLeft = Infinity;
  for (const c of children) {
    const p = c.position();
    const s = c.size();
    if (p.y + s.height > maxBottom) maxBottom = p.y + s.height;
    if (p.x + s.width > maxRight) maxRight = p.x + s.width;
    if (p.x < minLeft) minLeft = p.x;
  }
  const parentPos = parent.position();
  const parentSize = parent.size();
  // Padding = visible grid dot spacing (gridSize × drawGrid.scaleFactor).
  const PARENT_FIT_PADDING = (paper.options.gridSize || 4) * (paper.options.drawGrid?.args?.scaleFactor || 4);
  // Per-edge behaviour (v1.14.1):
  //   • TOP    — anchored. The header sits here and children are tucked below it,
  //              so the top never moves (a top drop tucks the child down, not up).
  //   • LEFT / RIGHT / BOTTOM — grow AND shrink to hug the content, so moving or
  //              deleting a child reclaims the slack on every side. Hugging the
  //              LEFT repositions the container (its top-left x shifts) — accepted
  //              per user preference; grow-only left avoided that slide but left
  //              stale slack. MIN_WIDTH/_HEIGHT floors keep the header label +
  //              accent bar from being clipped.
  // Children keep their absolute positions: a programmatic position()/resize()
  // does NOT cascade to embeds (only an interactive paper drag translates them).
  const newLeft = minLeft - PARENT_FIT_PADDING;        // hug left (grow AND shrink)
  const rightEdge = maxRight + PARENT_FIT_PADDING;      // hug right (grow AND shrink)
  const targetWidth = Math.max(PARENT_FIT_MIN_WIDTH, rightEdge - newLeft);
  const targetHeight = Math.max(PARENT_FIT_MIN_HEIGHT, (maxBottom + PARENT_FIT_PADDING) - parentPos.y);
  const movedLeft = Math.abs(parentPos.x - newLeft) > 0.5;
  if (!movedLeft && Math.abs(parentSize.width - targetWidth) < 1 && Math.abs(parentSize.height - targetHeight) < 1) return;
  if (movedLeft) parent.position(newLeft, parentPos.y);
  parent.resize(targetWidth, targetHeight);
}

// Walk every embedding parent and refit each one. Used by the toolbar to tighten
// everything up immediately after the user re-enables auto sizing.
export function refitAllParents() {
  const { graph } = cctx;
  if (!graph) return;
  const seen = new Set();
  graph.getElements().forEach(el => {
    const pid = el.get('parent');
    if (!pid || seen.has(pid)) return;
    seen.add(pid);
    const parent = graph.getCell(pid);
    if (parent) fitParentToChildren(parent);
  });
}

// ── Drop ghost overlay (v1.14.1) ────────────────────────────────────
// A dashed preview of the container a dragged/dropped element would land in,
// drawn at the container's WOULD-BE bounds (after tuck + bottom-fit) so the
// otherwise-invisible capture halo and the on-drop grow are visible BEFORE
// release. Pure overlay in the layers group (rides pan/zoom); shown on drag-
// move, hidden on drop. Shared by the canvas-move drag (registerEmbedding,
// below) and the stencil drop (stencil.js dragover) through showDropGhost/hide.
const GHOST_SVG_NS = 'http://www.w3.org/2000/svg';
let _ghostLayer = null;
let _ghostRect = null;

function ensureGhostLayer() {
  const { paper } = cctx;
  if (_ghostLayer || !paper?.svg) return _ghostLayer;
  const cellsLayer = paper.svg.querySelector('.joint-cells-layer');
  const layersGroup = cellsLayer?.parentNode;
  if (!layersGroup) return null;
  _ghostLayer = document.createElementNS(GHOST_SVG_NS, 'g');
  _ghostLayer.setAttribute('class', 'sf-drop-ghost');
  _ghostLayer.setAttribute('pointer-events', 'none');
  layersGroup.insertBefore(_ghostLayer, cellsLayer.nextSibling);
  return _ghostLayer;
}

// The single container-like parent that would capture childBBox on drop:
// topmost overlapping valid parent, else the halo parent. Scoped to the free-
// form groupers (HALO_PARENT_TYPES) — the same set the halo + tuck serve.
function findCaptureParent(childBBox, childType, excludeId) {
  const { graph } = cctx;
  if (!graph) return null;
  const overlap = graph.findModelsInArea(childBBox)
    .filter(el => el.id !== excludeId
      && HALO_PARENT_TYPES.has(el.get('type'))
      && canEmbed(el.get('type'), childType))
    .sort((a, b) => (b.get('z') || 0) - (a.get('z') || 0));
  if (overlap.length) return overlap[0];
  return findHaloParent(childBBox, childType, excludeId);
}

// Pure: the container's bounds after capturing childBBox — mirrors
// tuckChildInside + fitParentToChildren (top anchored; left/right/bottom hug).
// excludeId drops the dragged child from the existing-children scan when it's
// already embedded (so its old position doesn't inflate the preview).
function previewCapturedParentBounds(childBBox, parent, excludeId) {
  const { graph, paper } = cctx;
  if (!parent || !graph) return null;
  const pp = parent.position();
  const ps = parent.size();
  const pad = (paper?.options.gridSize || 4) * (paper?.options.drawGrid?.args?.scaleFactor || 4);
  const headerPad = parent.get('type') === 'sf.Container' ? 32 : 0;
  // Mirror fitParentToChildren: TOP clamps the child below the header (can't grow
  // up); LEFT/RIGHT/BOTTOM take the child where it lands and the frame wraps it.
  const tuckedTop = Math.max(childBBox.y, pp.y + headerPad + pad);
  let minLeft = childBBox.x;
  let maxRight = childBBox.x + childBBox.width;
  let maxBottom = tuckedTop + childBBox.height;
  for (const c of graph.getElements()) {
    if (c.get('parent') !== parent.id) continue;
    if (excludeId && c.id === excludeId) continue;
    const cp = c.position();
    const cs = c.size();
    if (cp.x < minLeft) minLeft = cp.x;
    if (cp.x + cs.width > maxRight) maxRight = cp.x + cs.width;
    if (cp.y + cs.height > maxBottom) maxBottom = cp.y + cs.height;
  }
  const newLeft = minLeft - pad;      // hug left (mirror the fit)
  const rightEdge = maxRight + pad;   // hug right
  return {
    x: newLeft,
    y: pp.y,
    width: Math.max(PARENT_FIT_MIN_WIDTH, rightEdge - newLeft),
    height: Math.max(PARENT_FIT_MIN_HEIGHT, (maxBottom + pad) - pp.y),
  };
}

// Show/refresh the dashed ghost for childBBox; hides it when nothing would
// capture. childType drives canEmbed; excludeId is the dragged element's own id
// (null for a not-yet-created stencil drop). Returns the would-be parent or null.
export function showDropGhost(childBBox, childType, excludeId) {
  const parent = findCaptureParent(childBBox, childType, excludeId);
  if (!parent) { hideDropGhost(); return null; }
  const b = previewCapturedParentBounds(childBBox, parent, excludeId);
  const layer = ensureGhostLayer();
  if (!b || !layer) { hideDropGhost(); return null; }
  if (!_ghostRect) {
    _ghostRect = document.createElementNS(GHOST_SVG_NS, 'rect');
    _ghostRect.setAttribute('class', 'sf-drop-ghost__rect');
    _ghostRect.setAttribute('rx', '8');
    layer.appendChild(_ghostRect);
  }
  _ghostRect.setAttribute('x', b.x);
  _ghostRect.setAttribute('y', b.y);
  _ghostRect.setAttribute('width', Math.max(0, b.width));
  _ghostRect.setAttribute('height', Math.max(0, b.height));
  _ghostRect.style.display = '';
  return parent;
}

export function hideDropGhost() {
  if (_ghostRect) _ghostRect.style.display = 'none';
}

// ── Registration: deferred auto-fit triggers (v1.14.1) ──────────────
// Mounted post-hydration. Skips JSON-restore via the synced cctx.isLoadingJSON
// guard (Slice 9). Also exposes cctx.fitParentToChildren (declared slot).
//
// DEFER-TO-DROP: fitting a parent on every change:position frame made the
// container floor chase a child being dragged upward — "the space disappears"
// mid-reposition. So during a canvas pointer-drag we only ACCUMULATE the
// affected parents and flush a single fit on element:pointerup. Mirrors the
// crossing-bumps / spacing-guides "recompute on drop" pattern. Stencil drops and
// programmatic embeds aren't pointer-drags (no element:pointerdown), so they
// still fit immediately through the same handlers.
export function registerEmbedding(cctx) {
  const { graph, paper } = cctx;
  cctx.fitParentToChildren = fitParentToChildren;

  // Drag state: _dragActive spans element:pointerdown→up; _dragMoved guards a
  // pure click (no move). _pendingParents collects parents to settle on drop.
  let _dragActive = false;
  let _dragMoved = false;
  const _pendingParents = new Set();
  const fitNow = (id) => { const p = id && graph.getCell(id); if (p) fitParentToChildren(p); };

  paper.on('element:pointerdown', () => { _dragActive = true; _dragMoved = false; hideDropGhost(); });
  paper.on('element:pointermove', (cellView) => {
    _dragMoved = true;
    // Live preview: dashed ghost of the container this element would land in.
    const m = cellView?.model;
    if (m?.isElement?.()) showDropGhost(m.getBBox(), m.get('type'), m.id);
  });
  paper.on('element:pointerup', (cellView) => {
    hideDropGhost();
    const moved = _dragActive && _dragMoved;
    _dragActive = false;
    _dragMoved = false;
    if (!moved) { _pendingParents.clear(); return; } // pure click — nothing settled
    // Tuck a halo-captured child fully inside its parent before the fit, so the
    // height-only grow never leaves it poking out a side/top.
    const model = cellView?.model;
    if (model?.isElement?.()) {
      const pid = model.get('parent');
      const parent = pid && graph.getCell(pid);
      if (parent && HALO_PARENT_TYPES.has(parent.get('type'))) {
        tuckChildInside(model, parent);
        _pendingParents.add(pid);
      }
    }
    _pendingParents.forEach(fitNow);
    _pendingParents.clear();
  });

  // Trigger 1: a cell becomes embedded (or un-embedded). Fit both parents — the
  // new one (may grow) and the previous one (may shrink). Deferred during drag.
  graph.on('change:parent', (cell, newParentId) => {
    if (cctx.isLoadingJSON) return;
    if (!cell.isElement || !cell.isElement()) return;
    const prevParentId = cell.previous('parent');
    if (_dragActive) {
      if (newParentId) _pendingParents.add(newParentId);
      if (prevParentId && prevParentId !== newParentId) _pendingParents.add(prevParentId);
      return;
    }
    if (newParentId) fitNow(newParentId);
    if (prevParentId && prevParentId !== newParentId) fitNow(prevParentId);
  });

  // Trigger 2: an embedded child resizes (e.g. DataObject after key-fields-only
  // toggle, or any cell after manual resize). Fit the parent. Deferred during drag.
  graph.on('change:size', (cell) => {
    if (cctx.isLoadingJSON) return;
    const parentId = cell.get('parent');
    if (!parentId) return;
    if (_dragActive) { _pendingParents.add(parentId); return; }
    fitNow(parentId);
  });

  // Trigger 3: an embedded child moves. Cascaded moves (parent dragging its
  // children along) don't change relative geometry, so fit is a no-op there —
  // but a user dragging the child within the parent should tighten/expand it,
  // ON DROP (deferred) rather than per-frame.
  graph.on('change:position', (cell) => {
    if (cctx.isLoadingJSON) return;
    const parentId = cell.get('parent');
    if (!parentId) return;
    if (_dragActive) { _pendingParents.add(parentId); return; }
    fitNow(parentId);
  });

  // Trigger 4: an embedded child is removed (deleted, cut, etc.). Fit the
  // surviving parent on the next tick — JointJS may still be cleaning up its
  // embeds-array when this fires. Not a drag, so always immediate.
  graph.on('remove', (cell) => {
    if (cctx.isLoadingJSON) return;
    const parentId = cell.get('parent') || cell.previous('parent');
    if (!parentId) return;
    const parent = graph.getCell(parentId);
    if (!parent) return;
    setTimeout(() => fitParentToChildren(parent), 0);
  });
}

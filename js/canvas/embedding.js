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
import { cctx } from './context.js?v=1.19.0.49';
import { isUndoRedoActive } from '../history.js?v=1.19.0.49';

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
    // Team: people + most nodes, but never another grouper — and never a bare Task
    // or Task Group (z 500 / 0 sit below the Team's 1000, so they'd hide behind it).
    return childType !== 'sf.Container' && childType !== 'sf.Zone'
      && childType !== 'sf.TaskGroup' && childType !== 'sf.Task';
  }
  if (parentType === 'sf.Zone') {
    // Department: any node / Team / loose Task, but not another section grouper.
    return childType !== 'sf.Zone' && childType !== 'sf.TaskGroup';
  }
  if (parentType === 'sf.TaskGroup') {
    // RACI section: groups Task cards (each Task carries its own Person/Team
    // assignees). Zone-tier (z 0), so only Tasks (z 500) stay above it.
    return childType === 'sf.Task';
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
// Gap-based catch margins: how close (in px) the dragged element's bbox must come
// to a container edge to be captured. Measured edge-to-edge, so the feel is the
// same regardless of how wide the child is. Sides + bottom are forgiving; the top
// is tiny because a container never grows upward (its header sits at the top).
const CAPTURE_HALO_BOTTOM = 80;
const CAPTURE_HALO_SIDE = 80;
const CAPTURE_HALO_TOP = 12;
// The grouping parents that opt into the halo + drop-ghost. Free-form groupers
// (Container, Zone, BPMN Pool/Subprocess/Loop) wrap a child wherever it lands.
// The RACI Task ALSO opts in (v1.15.0) — users need the capture highlight — but
// it is NOT free-form: a captured Person/Team card is tucked into the RIGHT
// column and the card grows right + down (never collapsing the fixed left
// label/description column), via the Task branches in tuckChildInside /
// previewCapturedParentBounds / fitParentToChildren below. Other structured
// parents (Gantt timeline, sequence participant/actor) stay exact-overlap.
const HALO_PARENT_TYPES = new Set([
  'sf.Container', 'sf.Zone', 'sf.TaskGroup', 'sf.BpmnPool', 'sf.BpmnSubprocess', 'sf.BpmnLoop', 'sf.Task',
]);

// A BpmnPool carries its label band down the LEFT edge (see shapes.js — header
// rect width 30). Children must clear it both when tucked on drop AND when the
// parent re-hugs its content, or the first step overlaps the rotated pool title.
const POOL_HEADER_W = 30;

// Find a container-like parent whose capture region (visible bbox inflated by the
// halo) the child's BBOX reaches, honouring canEmbed. Topmost (highest z) wins.
// Gap-based: capture fires when the child bbox comes within the halo margin of the
// container edge — i.e. the inflated container box intersects the child box. (The
// old centre-in-inflated-box test forced wide children to nearly touch, since the
// centre stayed far from the edge — that was why "the sides still need a touch".)
// Single definition shared by both capture paths — canvas drag (via
// findEmbeddingParent) and stencil drop (via stencil.js tryEmbed). Returns the
// parent element, or null.
export function findHaloParent(childBBox, childType, excludeId) {
  const { graph } = cctx;
  if (!graph) return null;
  const cl = childBBox.x, cr = childBBox.x + childBBox.width;
  const ct = childBBox.y, cb = childBBox.y + childBBox.height;
  let best = null;
  let bestZ = -Infinity;
  for (const el of graph.getElements()) {
    if (el.id === excludeId) continue;
    const type = el.get('type');
    if (!HALO_PARENT_TYPES.has(type)) continue;
    if (!canEmbed(type, childType)) continue;
    const b = el.getBBox();
    // AABB intersection of the child bbox with the container bbox inflated per side.
    if (cr >= b.x - CAPTURE_HALO_SIDE && cl <= b.x + b.width + CAPTURE_HALO_SIDE
      && cb >= b.y - CAPTURE_HALO_TOP && ct <= b.y + b.height + CAPTURE_HALO_BOTTOM) {
      const z = el.get('z') || 0;
      if (z > bestZ) { bestZ = z; best = el; }
    }
  }
  return best;
}

// ── RACI Task geometry (v1.15.0) ────────────────────────────────────
// The Task is a two-column card: a fixed LEFT column (name + description) and a
// RIGHT column that holds embedded Person/Team RACI cards. The left column width
// is `descriptionWidth`, clamped so the right column never drops below 100 px —
// this MUST mirror TaskView._effectiveDescWidth in shapes.js, or the tuck and the
// visible divider drift apart.
function taskRightColumnLeft(task) {
  const sz = task.size();
  const raw = task.get('descriptionWidth') ?? 260;
  return Math.max(120, Math.min(sz.width - 100, raw));
}

// Would-be {x,y,width,height} of a Task after wrapping its right-column cards +
// any `extraBBoxes` (an incoming drop, pre-embed). The TOP-LEFT and the left
// column never move; the card grows RIGHT + DOWN to hug the cards, floored at the
// stencil default (540×160) so an empty/sparse roster keeps a sensible footprint.
// Every considered bbox is clamped into the right column first, so a card dropped
// over the left label still sizes (and later tucks) as a right-column card.
function taskWrapBounds(task, extraBBoxes, excludeId) {
  const { graph, paper } = cctx;
  const pp = task.position();
  const pad = (paper?.options.gridSize || 4) * (paper?.options.drawGrid?.args?.scaleFactor || 4);
  const def = task.constructor?.prototype?.defaults?.size || { width: 540, height: 160 };
  const colLeft = pp.x + taskRightColumnLeft(task) + pad;
  const colTop = pp.y + pad;
  let maxRight = colLeft;     // at least the right-column start
  let maxBottom = colTop;
  const consider = (bx, by, bw, bh) => {
    const left = Math.max(bx, colLeft);
    const top = Math.max(by, colTop);
    if (left + bw > maxRight) maxRight = left + bw;
    if (top + bh > maxBottom) maxBottom = top + bh;
  };
  if (graph) {
    for (const c of graph.getElements()) {
      if (c.get('parent') !== task.id) continue;
      if (excludeId && c.id === excludeId) continue;
      const cp = c.position(), cs = c.size();
      consider(cp.x, cp.y, cs.width, cs.height);
    }
  }
  for (const b of (extraBBoxes || [])) consider(b.x, b.y, b.width, b.height);
  return {
    x: pp.x,
    y: pp.y,
    width: Math.max(def.width, (maxRight + pad) - pp.x),    // hug right, floor at default
    height: Math.max(def.height, (maxBottom + pad) - pp.y), // hug bottom, floor at default
  };
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
  const ptype = parent.get('type');
  // RACI Task: keep cards in the RIGHT column so the left stays for label/desc.
  // Clamp x past the divider and y below a small top margin (no top header bar).
  if (ptype === 'sf.Task') {
    const nx = Math.max(cp.x, pp.x + taskRightColumnLeft(parent) + pad);
    const ny = Math.max(cp.y, pp.y + pad);
    if (nx !== cp.x || ny !== cp.y) child.position(nx, ny);
    return;
  }
  // Container carries a ~32px TOP header bar; keep children clear of it. A TaskGroup
  // has a top-left section label, so reserve a slimmer band so its Tasks tuck below
  // it. Zone / BPMN groupers have no top header.
  const headerPad = ptype === 'sf.Container' ? 32 : (ptype === 'sf.TaskGroup' ? 28 : 0);
  const ny = Math.max(cp.y, pp.y + headerPad + pad);
  // A BpmnPool's header runs down the LEFT — tuck the child right past it so the
  // first step never lands on the rotated pool title. Other parents keep their
  // left overflow (a left drop wraps the parent leftward — see fitParentToChildren).
  const nx = ptype === 'sf.BpmnPool' ? Math.max(cp.x, pp.x + POOL_HEADER_W + pad) : cp.x;
  if (ny !== cp.y || nx !== cp.x) child.position(nx, ny);
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
  // A GanttTask's ONLY valid parent is its GanttTimeline. JointJS honours frontParentOnly (default TRUE) → it
  // considers only the LAST/front candidate; findModelsInArea returns the higher-z sibling BAR last, so without
  // this the front candidate is an invalid sibling task and JointJS UNEMBEDS the dragged bar (it drops out of
  // timelineBars → its panel row vanishes and the layout scrambles — the "dragging hides tasks" bug). Resolve
  // candidates to the timeline(s) the bar overlaps so the front candidate is always the timeline → it stays
  // embedded while reordering/re-dating. Dropped clear of every timeline → [] (unembed; the single-timeline
  // binding rule in ganttTimelineFor still keeps it bound).
  if (childType === 'sf.GanttTask') {
    const timelines = [];
    const seen = new Set();
    for (const el of candidates) {
      let tl = null;
      if (el.get('type') === 'sf.GanttTimeline') tl = el;
      else {
        const pid = el.get('parent');
        const p = pid && graph.getCell(pid);
        if (p && p.get('type') === 'sf.GanttTimeline') tl = p;
      }
      if (tl && !seen.has(tl.id)) { seen.add(tl.id); timelines.push(tl); }
    }
    return timelines;
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

// The min width a parent needs so its non-wrapping header TITLE (the Container's left-anchored `headerLabel`)
// stays fully visible — measured from the LIVE view's text bbox. Returns 0 for a centred / wrapping title (a
// centred label's bbox is width-dependent → circular; a wrapping one ellipsizes and never overflows) and when
// the view isn't rendered yet. `pad` matches the fit's edge padding so the title isn't flush to the border.
function headerLabelMinWidth(parent, paper, pad) {
  const el = paper?.findViewByModel?.(parent)?.el?.querySelector('[joint-selector="headerLabel"], [joint-selector="label"]');
  if (!el || el.getAttribute('text-anchor') !== 'start' || typeof el.getBBox !== 'function') return 0;
  try { const bb = el.getBBox(); return (bb && bb.width) ? Math.ceil(bb.x + bb.width + pad) : 0; } catch { return 0; }
}

function fitParentToChildren(parent) {
  const { graph, paper } = cctx;
  if (!isAutoSizingEnabled()) return;
  if (!parent || !parent.isElement || !parent.isElement()) return;
  // A GanttTimeline sizes ITSELF — its width is period-driven and its view auto-grows
  // the height to fit task rows (see GanttTimelineView._renderColumns). Content-hugging
  // it here fights that and visibly breaks the chart, so never auto-fit a timeline.
  if (parent.get('type') === 'sf.GanttTimeline') return;
  // A SequenceParticipant / SequenceActor OWNS its geometry: width is label-driven,
  // height IS the lifeline length (set on load + by the sequence auto-layout). Its
  // embedded Activations are narrow markers placed ALONG the lifeline at message
  // timings — they don't define the lane's extent. Hugging the frame to them would
  // yank the lifeline off its column and crush its height, so never auto-fit a lane.
  // (This was the "click a participant → it jumps right and shrinks" bug: a click is
  // almost always a sub-pixel micro-drag, which cascade-moves the embedded activations;
  // their change:position then triggered this generic content-hug on the lane.)
  const _seqType = parent.get('type');
  if (_seqType === 'sf.SequenceParticipant' || _seqType === 'sf.SequenceActor') return;
  // Filter by `parent` attribute directly — `parent.getEmbeddedCells()` reads
  // the parent's own `embeds` array, which JointJS may not have updated yet
  // during a synchronous remove/un-embed event.
  const children = graph.getElements().filter(c => c.get('parent') === parent.id);
  if (children.length === 0) {
    // Last child removed (e.g. a multi-select group dragged back out): revert the container
    // to its default EMPTY footprint instead of leaving it stretched around where its content
    // used to be. resize() keeps the top-left; the group-drag handler (selection.js) restores
    // the pre-drag position if a mid-drop fit had nudged it toward the departing children.
    let def = null;
    if (parent.get('type') === 'sf.BpmnPool') {
      def = parent.prop('poolDirection') === 'vertical' ? { width: 250, height: 600 } : { width: 600, height: 250 };
    } else {
      const d = parent.constructor?.prototype?.defaults?.size;
      if (d) def = { width: d.width, height: d.height };
    }
    if (def) {
      const s = parent.size();
      if (s.width !== def.width || s.height !== def.height) parent.resize(def.width, def.height);
    }
    return;
  }
  // RACI Task: a fixed two-column card, NOT a free-form container. Keep the
  // top-left + left label column anchored; grow only RIGHT + DOWN to wrap the
  // right-column cards (floored at the 540×160 stencil default). The generic
  // left-hugging fit below would slide the frame onto the first card and destroy
  // the label column, so the Task gets its own content-hug here.
  if (parent.get('type') === 'sf.Task') {
    const b = taskWrapBounds(parent, [], null);
    const s = parent.size();
    if (Math.abs(s.width - b.width) >= 1 || Math.abs(s.height - b.height) >= 1) {
      parent.resize(b.width, b.height);
    }
    return;
  }
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
  // A BpmnPool reserves its left header band; everything else hugs flush. Using a
  // wider left inset for pools means re-hugging never slides the title back over
  // the leftmost child — it grows the pool left until the header clears it.
  const leftInset = parent.get('type') === 'sf.BpmnPool' ? POOL_HEADER_W + PARENT_FIT_PADDING : PARENT_FIT_PADDING;
  const newLeft = minLeft - leftInset;                 // hug left (grow AND shrink)
  const rightEdge = maxRight + PARENT_FIT_PADDING;      // hug right (grow AND shrink)
  // Floor the width to the header title's rendered right edge so auto-fit keeps a long, non-wrapping title (the
  // Container's `headerLabel`) fully visible instead of clipping it — the reported "Financial Services Cloud" bug.
  const targetWidth = Math.max(PARENT_FIT_MIN_WIDTH, headerLabelMinWidth(parent, paper, PARENT_FIT_PADDING), rightEdge - newLeft);
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
  _ghostLayer.setAttribute('class', 'df-drop-ghost');
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
  // RACI Task: preview the card growing right + down to wrap the would-be card in
  // its right column (top-left + left column fixed) — mirrors the Task fit branch.
  if (parent.get('type') === 'sf.Task') return taskWrapBounds(parent, [childBBox], excludeId);
  const pp = parent.position();
  const ps = parent.size();
  const pad = (paper?.options.gridSize || 4) * (paper?.options.drawGrid?.args?.scaleFactor || 4);
  const ptype = parent.get('type');
  const headerPad = ptype === 'sf.Container' ? 32 : (ptype === 'sf.TaskGroup' ? 28 : 0);
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
    width: Math.max(PARENT_FIT_MIN_WIDTH, headerLabelMinWidth(parent, paper, pad), rightEdge - newLeft),   // keep the title visible (matches fitParentToChildren)
    height: Math.max(PARENT_FIT_MIN_HEIGHT, (maxBottom + pad) - pp.y),
  };
}

// Union bbox of the current MULTI-select drag, set by selection.js so the ghost can preview
// the container growing to hold the WHOLE selection (not just the element under the pointer).
// Null during single-element drags → the ghost falls back to the dragged element's own bbox.
let _dragSelectionBBox = null;
export function setDragSelectionBBox(bbox) { _dragSelectionBBox = bbox || null; }

// Show/refresh the dashed ghost; hides it when nothing would capture. `childBBox` (the element
// under the pointer) finds the would-be parent; `growBBox` (defaults to childBBox) is what the
// container is previewed wrapping — the whole multi-selection during a group drag. childType
// drives canEmbed; excludeId is the dragged element's own id (null for a stencil drop).
export function showDropGhost(childBBox, childType, excludeId, growBBox) {
  const parent = findCaptureParent(childBBox, childType, excludeId);
  if (!parent) { hideDropGhost(); return null; }
  const b = previewCapturedParentBounds(growBBox || childBBox, parent, excludeId);
  const layer = ensureGhostLayer();
  if (!b || !layer) { hideDropGhost(); return null; }
  if (!_ghostRect) {
    _ghostRect = document.createElementNS(GHOST_SVG_NS, 'rect');
    _ghostRect.setAttribute('class', 'df-drop-ghost__rect');
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
  cctx.refitAllParents = refitAllParents;

  // Drag state: _dragActive spans element:pointerdown→up; _dragMoved guards a
  // pure click (no move). _pendingParents collects parents to settle on drop.
  let _dragActive = false;
  let _dragMoved = false;
  const _pendingParents = new Set();
  const fitNow = (id) => { const p = id && graph.getCell(id); if (p) fitParentToChildren(p); };

  paper.on('element:pointerdown', () => { _dragActive = true; _dragMoved = false; hideDropGhost(); });
  paper.on('element:pointermove', (cellView) => {
    _dragMoved = true;
    // Live preview: dashed ghost of the container this element would land in. During a
    // multi-select group drag the preview grows to the whole selection (_dragSelectionBBox,
    // set by selection.js) so it shows everything will be captured, not just this element.
    const m = cellView?.model;
    if (m?.isElement?.()) showDropGhost(m.getBBox(), m.get('type'), m.id, _dragSelectionBBox);
  });
  paper.on('element:pointerup', (cellView) => {
    hideDropGhost();
    _dragSelectionBBox = null;   // always reset so the next (single) drag isn't sized to a stale union
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
    // RACI Task right-column discipline: tuck EVERY card of any settling Task —
    // covers a multi-select group drop where only the under-pointer card went
    // through the single tuck above. Idempotent for already-tucked cards.
    _pendingParents.forEach(pid => {
      const p = graph.getCell(pid);
      if (p && p.get('type') === 'sf.Task') {
        graph.getElements()
          .filter(c => c.get('parent') === pid)
          .forEach(c => tuckChildInside(c, p));
      }
    });
    _pendingParents.forEach(fitNow);
    _pendingParents.clear();
  });

  // Trigger 1: a cell becomes embedded (or un-embedded). Fit both parents — the
  // new one (may grow) and the previous one (may shrink). Deferred during drag.
  graph.on('change:parent', (cell, newParentId) => {
    if (cctx.isLoadingJSON || isUndoRedoActive()) return;   // undo/redo restores size+position exactly; don't re-fit over it
    if (!cell.isElement || !cell.isElement()) return;
    const prevParentId = cell.previous('parent');
    if (_dragActive) {
      if (newParentId) _pendingParents.add(newParentId);
      if (prevParentId && prevParentId !== newParentId) _pendingParents.add(prevParentId);
      return;
    }
    if (newParentId) {
      // Programmatic embed into a RACI Task / Task Group (e.g. selection.js
      // multi-select group capture, whose pointerup runs AFTER this module's — so
      // the peers arrive here in the immediate branch, not the deferred drag one).
      // Tuck each before the fit: a Task clamps cards into its right column, a Task
      // Group clamps its Tasks below the section label. A live single drag takes the
      // deferred branch above and tucks on element:pointerup instead.
      const np = graph.getCell(newParentId);
      const npType = np && np.get('type');
      if (npType === 'sf.Task' || npType === 'sf.TaskGroup') tuckChildInside(cell, np);
      fitNow(newParentId);
    }
    if (prevParentId && prevParentId !== newParentId) fitNow(prevParentId);
  });

  // Trigger 2: an embedded child resizes (e.g. DataObject after key-fields-only
  // toggle, or any cell after manual resize). Fit the parent. Deferred during drag.
  graph.on('change:size', (cell) => {
    if (cctx.isLoadingJSON || isUndoRedoActive()) return;   // undo/redo restores size+position exactly; don't re-fit over it
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
    if (cctx.isLoadingJSON || isUndoRedoActive()) return;   // undo/redo restores size+position exactly; don't re-fit over it
    const parentId = cell.get('parent');
    if (!parentId) return;
    if (_dragActive) { _pendingParents.add(parentId); return; }
    fitNow(parentId);
  });

  // Trigger 4: an embedded child is removed (deleted, cut, etc.). Fit the
  // surviving parent on the next tick — JointJS may still be cleaning up its
  // embeds-array when this fires. Not a drag, so always immediate.
  graph.on('remove', (cell) => {
    if (cctx.isLoadingJSON || isUndoRedoActive()) return;   // undo/redo restores size+position exactly; don't re-fit over it
    const parentId = cell.get('parent') || cell.previous('parent');
    if (!parentId) return;
    const parent = graph.getCell(parentId);
    if (!parent) return;
    setTimeout(() => fitParentToChildren(parent), 0);
  });
}

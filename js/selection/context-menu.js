// Canvas context menu — desktop right-click + touch long-press (S9, extracted from selection.js).
// The floating .df-ctx-menu (per-element / multi-select / blank-canvas variants), the touch long-press
// entry, and the grouping / link / auto-size helpers its items call. Reads the live graph + selection
// through an injected context (initContextMenu) so it never imports selection.js back (acyclic, like
// resize-handles.js). The 6 app.js-wired action APIs (auto-size, copy-as-PNG, endpoint-set,
// action-provider, style, capture) live here now; selection.js re-exports their setters + copySelectionAsPng
// so app.js / keyboard.js wiring is unchanged.

import * as clipboard from '../clipboard.js?v=1.21.1';
import * as history from '../history.js?v=1.21.1';
import { wireMenuDismiss } from '../menu.js?v=1.21.1';
import { saveSelectionAsTemplate } from '../templates.js?v=1.21.1';

// ── Injected selection context (wired by selection.init → initContextMenu). Read at CALL time; the
// selectedIds Set is shared BY REFERENCE with selection.js so the menu sees the live selection. ──
let graph;
let selectedIds;
let getSelectedElements, selectOnly, addToSelection, selectAll, deleteSelected;
export function initContextMenu(ctx) {
  graph = ctx.graph;
  selectedIds = ctx.selectedIds;
  getSelectedElements = ctx.getSelectedElements;
  selectOnly = ctx.selectOnly;
  addToSelection = ctx.addToSelection;
  selectAll = ctx.selectAll;
  deleteSelected = ctx.deleteSelected;
}

// ── Long-press context menu (touch / mobile) ──────────────────────
const LONG_PRESS_MS = 450;
let longPressTimer = null;
let longPressMenu = null;
let longPressMenuDismiss = null;   // wireMenuDismiss teardown for the open context menu (V3)

export function startLongPressMenu(cellView, evt) {
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

export function cancelLongPressMenu() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

// Per-element auto-size handler, registered by app.js (properties.autoSizeCell) — a callback so selection.js
// doesn't import properties.js (which imports selection — that would be a module cycle).
let _autoSizer = null;
export function setAutoSizer(fn) { _autoSizer = fn; }

// "Copy as PNG" — rasters the current selection to the OS clipboard (paste into Slack / docs / chat as an image).
// Wired in app.js to persistence.copyCellsAsPng. Absent → the menu item is hidden.
let _copyAsPng = null;
export function setCopyAsPng(fn) { _copyAsPng = fn; }
/** Copy the CURRENT selection to the OS clipboard as a PNG. `opts.silent` keeps it quiet (the Cmd+C overload path).
 *  No-op when nothing copyable is selected. */
export function copySelectionAsPng(opts) { _copyAsPng?.(getSelectedElements(), opts); }

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

// Embedding rules for the multi-select "Group" action (capture redesign stage d), registered by app.js →
// { canEmbed(parentType, childType), isCaptorType(type) } from canvas/embedding.js (canEmbed + a
// HALO_PARENT_TYPES membership test). A callback, not an import, to avoid the selection<->canvas cycle
// (the single source of truth for "who can embed what" stays in embedding.js).
let _captureApi = null;
export function setCaptureApi(api) { _captureApi = api; }

/** The Group target for a multi-selection, or null when Group shouldn't be offered. Group appears only when
 *  EXACTLY ONE selected element (a free-form captor - Container/Zone/BPMN/Task/TaskGroup) can legally embed
 *  every OTHER selected element; that one becomes the parent and the rest its children. Two captors that
 *  can't nest (e.g. two Containers, or a Container + Zone where neither embeds the other) → ambiguous → no
 *  Group. Nothing to do (all others already this captor's children) → no Group either. Structured parents
 *  (Gantt timeline, sequence lane) are excluded via isCaptorType - they use exact-overlap, not this. */
function groupTarget(els) {
  if (!_captureApi || !els || els.length < 2) return null;
  const candidates = els.filter((cap) =>
    _captureApi.isCaptorType(cap.get('type'))
    && els.every((c) => c === cap || _captureApi.canEmbed(cap.get('type'), c.get('type'))));
  if (candidates.length !== 1) return null;
  const captor = candidates[0];
  const children = els.filter((c) => c !== captor);
  if (!children.length || children.every((c) => c.get('parent') === captor.id)) return null;
  return { captor, children };
}

/** Embed each child into the captor in one undo entry. A child already in a DIFFERENT parent is un-embedded
 *  first (JointJS embed() throws on an already-embedded cell); one already in this captor is skipped.
 *  Positions are kept (like the multi-drag group capture) - the change:parent listener (embedding.js) then
 *  tucks any Task/TaskGroup child and auto-fits the captor around the new members. */
function groupIntoCaptor(captor, children) {
  history.startBatch();
  try {
    for (const c of children) {
      const pid = c.get('parent');
      if (pid === captor.id) continue;
      if (pid) { const p = graph.getCell(pid); if (p) p.unembed(c); }
      captor.embed(c);
    }
  } finally { history.endBatch(); }
}

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
  copyPng: _ctxSvg('<rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/><circle cx="5.5" cy="6.5" r="1"/><path d="M3 11.5l3-3 2 2 2.5-2.5 2.5 2.5"/>'),
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
  // Ungroup: a (dashed) container with an arrow leaving it — dissolve a group (release captured
  // children) or leave a group (pull a captured shape out of its parent).
  ungroup: _ctxSvg('<rect x="2" y="3.5" width="7.5" height="9" rx="1.5" stroke-dasharray="2.2 1.6"/><path d="M8.5 8H14M11.5 5.5L14 8l-2.5 2.5"/>'),
  // Group: a (dashed) container with an arrow entering it — capture the selected shapes into a container.
  group: _ctxSvg('<rect x="6.5" y="3.5" width="7.5" height="9" rx="1.5" stroke-dasharray="2.2 1.6"/><path d="M1.5 8H7M4.5 5.5L7 8l-2.5 2.5"/>'),
};

/** Whether a cell participates in any grouping — it either CAPTURED children (a captor) or IS captured
 *  (has a parent). Drives whether the Ungroup menu item is offered. */
function isGroupedCell(el) {
  return !!((el.getEmbeddedCells && (el.getEmbeddedCells() || []).length) || el.get('parent'));
}

/** Ungroup ONE element, role-first: a captor (holds children) DISSOLVES its group — un-embed every
 *  direct child (they keep their positions), so the now-empty container can be deleted on its own; a
 *  captured LEAF (no children of its own) instead LEAVES its group — un-embed itself from its parent.
 *  The captor role wins for a shape that is both, so a nested container spills its own contents (a
 *  further right-click then offers to pull the emptied container out of its parent). Caller batches
 *  history so one Cmd+Z reverses the whole ungroup; the change:parent listener (embedding.js) then
 *  reverts an emptied container to its default footprint. */
function ungroupElement(el) {
  const kids = (el.getEmbeddedCells() || []).slice();   // copy: unembed mutates the embeds array
  if (kids.length) { for (const k of kids) el.unembed(k); return; }
  const parent = el.get('parent') && graph.getCell(el.get('parent'));
  if (parent) parent.unembed(el);
}

/** Ungroup a set of elements in one undo entry (single-element menu passes [model]; the multi-select
 *  variant passes the whole selection, applying the role-based ungroup to each). Ungroup must leave the
 *  affected CONTAINER untouched: the embedding auto-fit (embedding.js) otherwise hugs the dwindling
 *  children and DRAGS the container's left edge (a captor emptied one child at a time drifts to where the
 *  last child was). So snapshot each affected container's position+size BEFORE and restore it AFTER — only
 *  the parent/child relationship changes, never the container's geometry. */
function ungroupCells(els) {
  const targets = (els || []).filter((c) => c && c.isElement && c.isElement() && isGroupedCell(c));
  if (!targets.length) return;
  // The containers whose geometry the ungroup would disturb: a captor being emptied, or a captured
  // child's parent losing that child. Snapshot each once.
  const pinned = new Map();   // id -> { el, pos, size }
  const pin = (container) => {
    if (container && !pinned.has(container.id)) pinned.set(container.id, { el: container, pos: { ...container.position() }, size: { ...container.size() } });
  };
  for (const el of targets) {
    if ((el.getEmbeddedCells() || []).length) pin(el);                                  // captor being emptied
    else { const p = el.get('parent') && graph.getCell(el.get('parent')); pin(p); }     // captured child's parent
  }
  history.startBatch();
  try {
    targets.forEach(ungroupElement);
    // Undo any auto-fit drift: restore each container to exactly where/what it was.
    for (const { el, pos, size } of pinned.values()) {
      const s = el.size();
      if (s.width !== size.width || s.height !== size.height) el.resize(size.width, size.height);
      const p = el.position();
      if (p.x !== pos.x || p.y !== pos.y) el.position(pos.x, pos.y);
    }
  } finally { history.endBatch(); }
}
/**
 * The floating canvas context menu — shared by desktop right-click and the touch long-press. `model` is the
 * right-clicked cell, or `null` for the blank-canvas menu (Paste / Select all). `opts.placement`: 'cursor'
 * (default, desktop — drops below-right of the pointer) or 'above' (touch long-press — centered above the press).
 * `opts.prevSelection`: ids selected BEFORE the right-click, so a cell menu can offer "Add to selection".
 */
export function showContextMenu(clientX, clientY, model, opts = {}) {
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
  // Idempotent: never emit a LEADING separator (nothing above it) or a CONSECUTIVE one. Several call sites add
  // a separator before a group of items that are each individually conditional (e.g. the style block always
  // seps then may add zero of Copy/Paste style) — without this guard a skipped group leaves a dangling sep that
  // stacks with the next group's sep into a double spacer. A trailing sep is stripped before the menu shows.
  const addSep = () => {
    const last = menu.lastElementChild;
    if (!last || last.classList.contains('df-ctx-menu__sep')) return;
    const s = document.createElement('div'); s.className = 'df-ctx-menu__sep'; menu.appendChild(s);
  };
  // "Copy as PNG" — raster the current selection to the clipboard (paste into Slack/docs/chat as an image).
  // Offered for any element selection (single or multi), never a bare link.
  const addCopyPng = () => { if (_copyAsPng) addItem('Copy as PNG', () => _copyAsPng(getSelectedElements()), { icon: CTX_ICON.copyPng }); };

  if (model) {
    // Component-specific menu mirroring the properties-pane actions, with the SAME icons. Links: Clone / Reverse
    // direction / Simplify path. Elements: Clone / Copy / Auto size. "Add to selection" (when a prior selection
    // exists) lets you build a multi-select via right-clicks. Both end in a danger Delete.
    const prev = (opts.prevSelection || []).filter((id) => id !== model.id);
    if (prev.length) {
      // Re-add the previously-selected cells alongside this one → a growing multi-select built by right-clicking.
      addItem('Add to selection', () => { prev.forEach((id) => addToSelection(id)); addToSelection(model.id); }, { icon: CTX_ICON.addSel });
      addSep();   // set "Add to selection" apart from the per-shape actions below (#1)
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
        if (a.label === 'Copy') addCopyPng();   // Copy as PNG sits directly under Copy, in the same group (#3)
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
      addCopyPng();
      if (_autoSizer) addItem('Auto size', () => autoSizeSelection(), { icon: CTX_ICON.autosize });
      // Save as Template — the whole-selection counterpart to single-select "Save Shape": capture every selected
      // shape + connector as one reusable My Templates block (mirrors the multi-select properties footer button).
      // Its own separated group, matching where Save Shape sits after Auto size in the single-element menu.
      addSep();
      addItem('Save as Template', () => saveSelectionAsTemplate(), { icon: CTX_ICON.saveShape });
      if (_styleApi && !model.isLink()) {
        addSep();
        // Copy style needs ONE coherent source — only when the selection is a single styled type (item 8).
        if (repActs.some((a) => a.group === 'style')) addItem('Copy style', () => _styleApi.copy(els[0]), { icon: CTX_ICON.copyStyle });
        if (_styleApi.has()) addItem('Paste style', () => _styleApi.paste(els), { icon: CTX_ICON.pasteStyle });
      }
      // Group / Ungroup (multi-select) — the grouping verbs, fenced together under one separator.
      //  • Group: when exactly one selected captor can embed every other selected element, capture them all
      //    into it (stage d). The inverse of a multi-select drag-into-a-container, without the drag.
      //  • Ungroup: the role-based ungroup applied to EVERY selected element in one undo entry — captors
      //    release their children, captured shapes leave their parent. Offered when any element is grouped.
      const _grp = groupTarget(els);
      const _showUngroup = els.some(isGroupedCell);
      if (_grp || _showUngroup) addSep();                          // fence the grouping verbs from the actions above
      if (_grp) addItem('Group', () => groupIntoCaptor(_grp.captor, _grp.children), { icon: CTX_ICON.group });
      if (_showUngroup) addItem('Ungroup', () => ungroupCells(els), { icon: CTX_ICON.ungroup });
      if (_grp || _showUngroup) addSep();                          // ...and fence the danger Delete below them
    }
    // Grouping verbs for a single element (before the danger Delete). "Group N inside" appears on a captor
    // (Zone/Container/...) that has un-grouped shapes sitting inside it (the capture-overlay's dashed-halo set)
    // — one click embeds them all, matching the floating Group pill. "Ungroup" (was "Release shapes") dissolves
    // a captor's group or leaves a group. The action loop above already adds a separator, so these need ONE
    // separator BELOW to fence off the danger Delete. The multi-select branch offers its own variants.
    if (!model.isLink() && selectedIds.size <= 1) {
      const enclosed = (_captureApi?.isCaptorType?.(model.get('type')) && _captureApi.enclosedShapes)
        ? (_captureApi.enclosedShapes(model) || []) : [];
      if (enclosed.length && _captureApi?.groupInto) {
        addItem(`Group ${enclosed.length} shape${enclosed.length === 1 ? '' : 's'} inside`, () => _captureApi.groupInto(model, enclosed), { icon: CTX_ICON.group });
      }
      if (isGroupedCell(model)) addItem('Ungroup', () => ungroupCells([model]), { icon: CTX_ICON.ungroup });
      if (enclosed.length || isGroupedCell(model)) addSep();
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

  // Strip any trailing separator (a group whose items were all conditionally skipped can leave one dangling).
  while (menu.lastElementChild?.classList.contains('df-ctx-menu__sep')) menu.lastElementChild.remove();

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
  // Shared dismissal lifecycle (V3): persistent outside-press close + Escape-closes-without-clearing-selection.
  longPressMenuDismiss = wireMenuDismiss(menu, closeContextMenu);
}

function closeContextMenu() {
  if (longPressMenuDismiss) { longPressMenuDismiss(); longPressMenuDismiss = null; }
  if (longPressMenu) {
    longPressMenu.remove();
    longPressMenu = null;
  }
}

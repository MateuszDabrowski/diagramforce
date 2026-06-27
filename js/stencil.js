// Stencil panel — draggable component library
// Organizes built-in components + saved templates by category, search, drag-to-canvas

import { COMPONENT_CATEGORIES, BPMN_CATEGORIES, DATAMODEL_CATEGORIES, DATAMAPPING_CATEGORIES, GANTT_CATEGORIES, ORG_CATEGORIES, SEQUENCE_CATEGORIES, createElementFromComponent, createGanttBarsFor } from './components.js?v=1.18.1';
import { applyGanttGeometry, deriveGanttMilestoneDate, deriveGanttMarkerDate, ganttTimelineFor, deriveGanttDates, backfillGanttOrders, layoutTimelineTasks, ganttDropTarget, ganttGroupInsertOrder, ganttGroupInsertSlotY, snapGanttRowCentreY, recolorGroupTasks } from './canvas/gantt-layout.js?v=1.18.1';
import { cctx } from './canvas/context.js?v=1.18.1';
import { getAllIcons, getCategories } from './icons.js?v=1.18.1';
import { updateSimpleNodeLayout, updateContainerHeaderLayout, snapActivationToLifeline, canEmbed, findHaloParent, tuckChildInside, showDropGhost, hideDropGhost } from './canvas.js?v=1.18.1';
import { startImageAddFlow } from './image-component.js?v=1.18.1';
import * as history from './history.js?v=1.18.1';
import { getTemplates, deleteTemplate, renderTemplateThumbnail, instantiateTemplate, onTemplatesChange } from './templates.js?v=1.18.1';
import { confirmModal } from './feedback.js?v=1.18.1';
import { DIAGRAM_TYPES } from './tabs.js?v=1.18.1'; // reader-friendly workspace labels (no cycle: tabs ⊄ stencil)

let graph, paper;
let panelEl, searchEl, bodyEl;
let currentDiagramType = 'architecture';

export function init(_graph, _paper) {
  graph = _graph;
  paper = _paper;
  panelEl = document.getElementById('stencil-panel');
  searchEl = document.getElementById('stencil-search');
  bodyEl = document.getElementById('stencil-categories');

  renderCategories();

  // Re-render when the saved-template library changes (save / delete) so the
  // "My {Type} Templates" / "My Other Templates" categories appear, update their
  // counts, or disappear.
  onTemplatesChange(() => renderCategories());

  // Gap 17 (v1.12.0) — clear-× button shows when the search has a value;
  // clicks wipe the field and re-run the filter so the user can return to
  // the full palette without selecting + deleting.
  const clearBtn = document.getElementById('btn-stencil-search-clear');
  const refreshClearVisibility = () => {
    if (!clearBtn) return;
    clearBtn.hidden = searchEl.value === '';
  };
  // Gap 28 (v1.12.0) — debounce the filter pass to 120 ms so fast typers
  // don't trigger one full re-render per keystroke. The clear-× visibility
  // refresh stays immediate (it's a single classList toggle) so the chrome
  // feels live even while the heavier category re-render is queued.
  // 120 ms picked over 150 to stay below the ~150 ms "feels instant"
  // threshold while still coalescing typical typing bursts.
  let filterTimer = null;
  searchEl.addEventListener('input', () => {
    refreshClearVisibility();
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      filterStencil(searchEl.value.trim().toLowerCase());
    }, 120);
  });
  clearBtn?.addEventListener('click', () => {
    searchEl.value = '';
    clearTimeout(filterTimer);
    filterStencil('');
    refreshClearVisibility();
    searchEl.focus();
  });
  refreshClearVisibility();

  setupDropZone();
  setupTouchDrag();

  const closeBtn = document.getElementById('btn-close-stencil');
  if (closeBtn) closeBtn.addEventListener('click', () => hide());
}

export function isHidden() {
  return panelEl.classList.contains('df-stencil--hidden');
}

export function show() {
  panelEl.classList.remove('df-stencil--hidden');
  const btn = document.getElementById('btn-toggle-stencil');
  if (btn) btn.classList.add('df-toolbar__button--active');
}

export function hide() {
  panelEl.classList.add('df-stencil--hidden');
  // Clear any drag-resized inline height (mobile bottom-sheet). Without this, an inline
  // `height` set by the resize handle OVERRIDES the `.df-stencil--hidden { height: 0 }` rule
  // (inline beats class), so the panel only loses its top border and stays open — the bug
  // where X / the toggle icon appeared to do nothing after resizing. Swipe-to-close already
  // clears it; this brings X + the toolbar toggle in line.
  panelEl.style.height = '';
  const btn = document.getElementById('btn-toggle-stencil');
  if (btn) btn.classList.remove('df-toolbar__button--active');
}

export function setDiagramType(type) {
  if (type === currentDiagramType) return;
  currentDiagramType = type;
  renderCategories();
  searchEl.value = '';
}

function renderCategories() {
  bodyEl.innerHTML = '';

  // The stencil is grouped into THREE bands (v1.17.0): "Custom {Type} Shapes" (the user's own saved shapes +
  // templates for THIS type), "{Type} Shapes" (this type's built-in shapes), and "Other Shapes" (everything for
  // the OTHER types). "My Shapes" = single shapes saved via Save Shape (kind:'shape'); "My Templates" = multi-
  // shape groups (kind unset). Both live in the template store, so they share thumbnail / drop / sync / delete.
  const allTemplates = getTemplates();
  const isShape = (t) => t.kind === 'shape';
  const myTemplates = allTemplates.filter((t) => !isShape(t));
  const myShapes = allTemplates.filter(isShape);
  const knownTypes = Object.keys(DIAGRAM_TYPES);
  const shortOf = (t) => DIAGRAM_TYPES[t]?.short || t || 'Other';
  const curShort = shortOf(currentDiagramType);

  // ── Group 1: Custom {Type} Shapes (current type's My Shapes + My Templates) ──
  const curShapes = myShapes.filter((t) => t.diagramType === currentDiagramType);
  const curTemplates = myTemplates.filter((t) => t.diagramType === currentDiagramType);
  if (curShapes.length || curTemplates.length) {
    bodyEl.appendChild(buildGroupHeader(`Custom ${curShort} Shapes`));
    if (curShapes.length) bodyEl.appendChild(buildTemplatesSection('My Shapes', `my-shapes-${currentDiagramType}`, curShapes));
    if (curTemplates.length) bodyEl.appendChild(buildTemplatesSection('My Templates', `my-templates-${currentDiagramType}`, curTemplates));
  }

  // ── Group 2: {Type} Shapes (the current type's built-in shapes + SLDS icons) ──
  bodyEl.appendChild(buildGroupHeader(`${curShort} Shapes`));
  const rawCategories = currentDiagramType === 'process' ? BPMN_CATEGORIES
                      : currentDiagramType === 'datamapping' ? DATAMAPPING_CATEGORIES
                      : currentDiagramType === 'datamodel' ? DATAMODEL_CATEGORIES
                      : currentDiagramType === 'gantt' ? GANTT_CATEGORIES
                      : currentDiagramType === 'org' ? ORG_CATEGORIES
                      : currentDiagramType === 'sequence' ? SEQUENCE_CATEGORIES
                      : COMPONENT_CATEGORIES;

  // Pin "Generic Shapes" to the top across every diagram type, but present it COLLAPSED by default everywhere EXCEPT
  // Architecture: only Architecture treats the generic set as its PRIMARY content (a plain Node / Container ARE its
  // building blocks). Every other type has type-specific shapes that matter more (BPMN tasks, the DataObject in its
  // "Objects" group, Mapping Layers, …), so the generic group folds away to keep those prominent. (Data Model/Mapping
  // joined this set in v1.17.1 once the DataObject moved OUT of Generic Shapes into its own "Objects" group — before
  // that, datamodel was left expanded because the DataObject led the generic group.)
  const TYPES_GENERIC_COLLAPSED = new Set(['process', 'gantt', 'org', 'sequence', 'datamodel', 'datamapping']);
  // Preset libraries that open COLLAPSED (item 4) — the Gantt project starter lists are long; expand on demand.
  const CATEGORIES_COLLAPSED_BY_DEFAULT = new Set(['gantt-phases', 'gantt-tasks', 'gantt-milestones']);
  const isGeneric = (c) => /generic/i.test(c.id || '') || c.label === 'Generic Shapes';
  const generic = rawCategories.find(isGeneric);
  // Big preset libraries start COLLAPSED so the panel isn't a giant scroll on open (round H item 4) — the user
  // expands the one they want. Shallow-clone so we never mutate the exported source array.
  const others = rawCategories.filter(c => !isGeneric(c))
    .map(c => CATEGORIES_COLLAPSED_BY_DEFAULT.has(c.id) ? { ...c, collapsed: true } : c);
  const categories = generic
    ? [
        // Shallow-clone so we never mutate the exported source array — the
        // `collapsed` flag must be per-render, not stick across re-renders
        // initiated from a different diagram type later.
        { ...generic, collapsed: TYPES_GENERIC_COLLAPSED.has(currentDiagramType) },
        ...others,
      ]
    : others;

  for (const category of categories) {
    bodyEl.appendChild(buildComponentSection(category));
  }

  // SLDS icon categories only for architecture diagrams
  if (currentDiagramType === 'architecture') {
    const cats = getCategories();
    // Show 'diagrams' (Custom) category first, then SLDS sprite categories
    const ordered = [...cats.filter(c => c === 'diagrams'), ...cats.filter(c => c !== 'diagrams')];
    for (const cat of ordered) {
      const icons = getAllIcons().filter(i => i.category === cat);
      if (icons.length === 0) continue;
      const displayLabel = cat === 'diagrams' ? 'Custom' : `SLDS: ${cat}`;
      bodyEl.appendChild(buildIconSection(cat, icons, displayLabel));
    }
  }

  // ── Group 3: Other Shapes — every OTHER type's My Shapes + My Templates + built-in shapes, grouped by type,
  // all collapsed, so a shape can be reused across diagram types. ──
  const unknownTypes = [...new Set(allTemplates.map((t) => t.diagramType).filter((t) => t && !knownTypes.includes(t)))];
  let otherShown = false;
  for (const type of [...knownTypes.filter((t) => t !== currentDiagramType), ...unknownTypes]) {
    const tShapes = myShapes.filter((t) => t.diagramType === type);
    const tTemplates = myTemplates.filter((t) => t.diagramType === type);
    const cross = knownTypes.includes(type) ? buildCrossTypeSection(type) : null;
    if (!tShapes.length && !tTemplates.length && !cross) continue;
    if (!otherShown) { bodyEl.appendChild(buildGroupHeader('Other Shapes')); otherShown = true; }
    const s = shortOf(type);
    if (tShapes.length) bodyEl.appendChild(buildTemplatesSection(`${s} · My Shapes`, `my-shapes-${type || 'untyped'}`, tShapes, true));
    if (tTemplates.length) bodyEl.appendChild(buildTemplatesSection(`${s} · My Templates`, `my-templates-${type || 'untyped'}`, tTemplates, true));
    if (cross) bodyEl.appendChild(cross);
  }
}

// A non-collapsible band divider that introduces a run of related sections (Custom {Type} Shapes / {Type}
// Shapes / Other Shapes). Distinct from a category header (no chevron / count - it's a grouping label).
function buildGroupHeader(label) {
  const h = document.createElement('div');
  h.className = 'df-stencil__group-header';
  const span = document.createElement('span');
  span.textContent = label;
  h.appendChild(span);
  return h;
}

function buildComponentSection(category) {
  const section = document.createElement('div');
  section.className = 'df-stencil__category' + (category.collapsed ? ' df-stencil__category--collapsed' : '');
  section.dataset.categoryId = category.id;

  const header = buildCategoryHeader(category.label, category.components.length);
  header.addEventListener('click', () => {
    section.classList.toggle('df-stencil__category--collapsed');
  });

  const items = document.createElement('div');
  items.className = 'df-stencil__items';

  for (const template of category.components) {
    items.appendChild(buildComponentItem(template));
  }

  section.appendChild(header);
  section.appendChild(items);
  return section;
}

// ── Feature 1.2: cross-type Shape sections ──
// Below the current diagram type's sections, surface the OTHER types' type-SPECIFIC shapes in one collapsed
// section each ("Process Shapes", "Data Model Shapes", …) so a shape can be reused across types. The generic
// shapes (Note/Container/…) are omitted - they already appear in the current type's own sections.
function categoriesForType(type) {
  return type === 'process' ? BPMN_CATEGORIES
       : type === 'datamapping' ? DATAMAPPING_CATEGORIES
       : type === 'datamodel' ? DATAMODEL_CATEGORIES
       : type === 'gantt' ? GANTT_CATEGORIES
       : type === 'org' ? ORG_CATEGORIES
       : type === 'sequence' ? SEQUENCE_CATEGORIES
       : COMPONENT_CATEGORIES;
}
function buildCrossTypeSection(type) {
  const isGeneric = (c) => /generic/i.test(c.id || '') || c.label === 'Generic Shapes';
  const comps = categoriesForType(type).filter((c) => !isGeneric(c)).flatMap((c) => c.components || []);
  if (comps.length === 0) return null;
  const short = DIAGRAM_TYPES[type]?.short || type;
  const section = document.createElement('div');
  section.className = 'df-stencil__category df-stencil__category--collapsed df-stencil__category--cross';
  section.dataset.categoryId = `cross-${type}`;
  const header = buildCategoryHeader(`${short} Shapes`, comps.length);
  header.addEventListener('click', () => section.classList.toggle('df-stencil__category--collapsed'));
  const items = document.createElement('div');
  items.className = 'df-stencil__items';
  for (const comp of comps) items.appendChild(buildComponentItem(comp));
  section.appendChild(header);
  section.appendChild(items);
  return section;
}

// ── Custom templates (user-saved; "template" is the internal name) ──
// One reusable section builder, called once per diagram type that has templates —
// "My {Type} Templates". Header label, categoryId, and initial collapsed state vary
// (the active workspace's group is expanded, the rest collapsed); everything else
// (thumbnail snapshot, drag/drop, hover-× delete via buildTemplateItem) is identical.
function buildTemplatesSection(label, categoryId, templates, collapsed = false) {
  const section = document.createElement('div');
  section.className = 'df-stencil__category' + (collapsed ? ' df-stencil__category--collapsed' : '');
  section.dataset.categoryId = categoryId;

  const header = buildCategoryHeader(label, templates.length);
  header.addEventListener('click', () => {
    section.classList.toggle('df-stencil__category--collapsed');
  });

  const items = document.createElement('div');
  items.className = 'df-stencil__items df-stencil__items--templates';

  for (const template of templates) {
    items.appendChild(buildTemplateItem(template));
  }

  section.appendChild(header);
  section.appendChild(items);
  return section;
}

function buildTemplateItem(template) {
  const item = document.createElement('div');
  item.className = 'df-stencil__item df-stencil__item--template';
  item.draggable = true;
  item.dataset.label = (template.name || '').toLowerCase();
  item.title = template.name || 'Template';

  // Static SVG thumbnail (rendered from a throwaway mini-paper).
  item.appendChild(renderTemplateThumbnail(template));

  const labelSpan = document.createElement('span');
  labelSpan.className = 'df-stencil__item-label';
  labelSpan.textContent = template.name || 'Template';
  item.appendChild(labelSpan);

  // Per-template delete (×) — appears on hover/focus.
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'df-template-delete';
  del.title = `Delete "${template.name}"`;
  del.setAttribute('aria-label', `Delete template "${template.name}"`);
  del.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  // Stop the parent's drag from starting when the user grabs the × button.
  del.addEventListener('mousedown', (e) => e.stopPropagation());
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await confirmModal({
      title: 'Delete template?',
      message: `Remove "${template.name}" from My Templates? This can't be undone.`,
      okLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) deleteTemplate(template.id);
  });
  item.appendChild(del);

  item._sfTemplateId = template.id;
  item._sfTemplateName = template.name;

  item.addEventListener('dragstart', (evt) => {
    evt.dataTransfer.setData('application/sf-diagrams-template', JSON.stringify({ id: template.id }));
    evt.dataTransfer.effectAllowed = 'copy';
  });

  item.addEventListener('dblclick', () => {
    instantiateTemplate(template.id, getCanvasCenterLocalPoint());
  });

  return item;
}

function buildIconSection(cat, icons, displayLabel) {
  const section = document.createElement('div');
  section.className = 'df-stencil__category df-stencil__category--collapsed';
  section.dataset.categoryId = `slds-${cat}`;

  const header = buildCategoryHeader(displayLabel || `SLDS: ${cat}`, icons.length);
  header.addEventListener('click', () => {
    section.classList.toggle('df-stencil__category--collapsed');
  });

  const grid = document.createElement('div');
  grid.className = 'df-stencil__items df-stencil__items--grid';

  for (const icon of icons) {
    const item = document.createElement('div');
    item.className = 'df-stencil__item df-stencil__item--icon';
    item.title = icon.name;
    item.dataset.iconId = icon.id;
    item.draggable = true;
    const safeId = icon.id.replace(/[^a-zA-Z0-9_-]/g, '');
    item.innerHTML = `<svg class="df-stencil__icon-preview"><use href="#${safeId}"></use></svg>`;

    const iconTpl = {
      type: 'sf.SimpleNode',
      label: icon.name.replace(/_/g, ' '),
      iconName: icon.id,
    };
    item._sfComponent = iconTpl;

    item.addEventListener('dragstart', (evt) => {
      evt.dataTransfer.setData('application/sf-diagrams', JSON.stringify(iconTpl));
      evt.dataTransfer.effectAllowed = 'copy';
      setDragPreview(evt, iconTpl);
    });
    // Double-click / double-tap adds to centre — the only add path on touch (HTML5 drag never fires from
    // touch). Mirrors buildComponentItem so SLDS sprites are reachable on a tablet, not just by mouse drag.
    item.addEventListener('dblclick', () => { addToCenter(iconTpl); });

    grid.appendChild(item);
  }

  section.appendChild(header);
  section.appendChild(grid);
  return section;
}

function buildCategoryHeader(label, count) {
  const header = document.createElement('div');
  header.className = 'df-stencil__category-header';
  // Chevron + label on the left, count on the right. The chevron sits inside
  // a wrapper so CSS can rotate it based on the parent category's collapsed
  // class (`.df-stencil__category--collapsed`).
  const left = document.createElement('span');
  left.className = 'df-stencil__category-label';
  left.innerHTML = `
    <svg class="df-stencil__category-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>${escapeHtml(label)}</span>`;
  const countSpan = document.createElement('span');
  countSpan.className = 'df-stencil__category-count';
  countSpan.textContent = count;
  header.appendChild(left);
  header.appendChild(countSpan);
  return header;
}

// Local HTML escape — kept inline so the stencil module has no
// cross-module dependency on persistence.js just for one helper.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildComponentItem(template) {
  const item = document.createElement('div');
  item.className = 'df-stencil__item';
  item.draggable = true;
  item.dataset.label = template.label?.toLowerCase() || '';

  // stencilSvg takes priority — allows custom logos even when iconName is set for the dropped element
  const safeIconName = (template.iconName || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const iconHtml = template.stencilSvg
    ? `<svg class="df-stencil__item-icon df-stencil__item-icon--svg" viewBox="0 0 20 20">${template.stencilSvg}</svg>`
    : safeIconName
    ? `<svg class="df-stencil__item-icon"><use href="#${safeIconName}"></use></svg>`
    : `<div class="df-stencil__item-icon df-stencil__item-icon--placeholder"></div>`;

  item.innerHTML = iconHtml;
  const labelSpan = document.createElement('span');
  labelSpan.className = 'df-stencil__item-label';
  labelSpan.textContent = template.label || '';
  item.appendChild(labelSpan);

  item._sfComponent = template;

  item.addEventListener('dragstart', (evt) => {
    evt.dataTransfer.setData('application/sf-diagrams', JSON.stringify(template));
    evt.dataTransfer.effectAllowed = 'copy';
    setDragPreview(evt, template);
    beginDropGhost(template);
  });
  item.addEventListener('dragend', endDropGhost);

  item.addEventListener('dblclick', () => {
    addToCenter(template);
  });

  return item;
}

// ── Drop ghost (v1.14.1) — desktop stencil drag ────────────────────
// HTML5 dragover can't read dataTransfer VALUES (only types), so probe the
// template once on dragstart for its size + type, then preview the would-be
// container with the shared showDropGhost during dragover. Cleared on
// dragleave / drop / dragend. (Touch drag keeps its own ghost element.)
let _ghostDragSize = null;
let _ghostDragType = null;
function beginDropGhost(template) {
  _ghostDragSize = null;
  _ghostDragType = null;
  if (!template || template.customDrop) return; // image / custom drop — no ghost
  try {
    const probe = createElementFromComponent(template, { x: 0, y: 0 });
    if (probe) { _ghostDragSize = probe.size(); _ghostDragType = probe.get('type'); }
  } catch { /* probe failed — just skip the ghost */ }
}
function endDropGhost() {
  _ghostDragSize = null;
  _ghostDragType = null;
  hideDropGhost();
  cctx.clearGanttDateChip?.();   // issue 6: also clear the phase-insert overlay bar
}
function refreshDropGhost(clientX, clientY) {
  if (!_ghostDragSize || !_ghostDragType) { hideDropGhost(); return; }
  // Point markers (milestone diamond / day marker triangle) are not box-shaped — the rounded-rect ghost reads as a
  // task. Skip it for them; the timeline's capture highlight already shows where the drop lands.
  if (_ghostDragType === 'sf.GanttMilestone' || _ghostDragType === 'sf.GanttMarker') { hideDropGhost(); return; }
  // A Project Phase drops as an INSERTED group row (issue 6), a Project Task slots into a row (item 3, round H) —
  // both preview an amber insertion bar at the slot they'd land in (phase thick, task thinner), not a rect ghost.
  if (_ghostDragType === 'sf.GanttGroup' || _ghostDragType === 'sf.GanttTask') {
    hideDropGhost();
    const pt = paper.clientToLocalPoint(clientX, clientY);
    const tls = graph.getElements().filter(e => e.get('type') === 'sf.GanttTimeline');
    const tl = tls.find(e => e.getBBox().containsPoint(pt)) || (tls.length === 1 ? tls[0] : null);
    if (tl && _ghostDragType === 'sf.GanttGroup') cctx.showGanttGroupInsertBar?.(tl, ganttGroupInsertSlotY(tl, pt.y));
    else if (tl) { const tgt = ganttDropTarget(tl, pt.y, null); cctx.showGanttGroupInsertBar?.(tl, tgt.lineLocalY, 2.5); }
    else cctx.clearGanttDateChip?.();
    return;
  }
  const pt = paper.clientToLocalPoint(clientX, clientY);
  const w = _ghostDragSize.width;
  const h = _ghostDragSize.height;
  // The drop centres the element on the cursor, so preview the same bbox.
  showDropGhost({ x: pt.x - w / 2, y: pt.y - h / 2, width: w, height: h }, _ghostDragType, null);
}

function setupDropZone() {
  const canvasEl = document.getElementById('canvas-container');

  // Gap 8 (v1.12.0) — during a stencil dragover, highlight the topmost
  // container-like cell beneath the cursor with the amber drop-target outline.
  // Uses its OWN class (`df-drop-target`, styled in canvas.css), NOT the link-drag
  // `.available-cell` — that one is port-only now (its body outline was removed
  // because the body is never a connection target). Resets on dragleave/drop. The
  // dragged template's TYPE isn't available from dragover events (only the MIME type
  // is), so we walk the cursor-point candidates and highlight the topmost cell that
  // COULD host a child via `canEmbed`.
  let _highlightedView = null;
  const clearDropHighlight = () => {
    if (_highlightedView?.el) _highlightedView.el.classList.remove('df-drop-target');
    _highlightedView = null;
  };
  const refreshDropHighlight = (clientX, clientY) => {
    const pt = paper.clientToLocalPoint(clientX, clientY);
    const candidates = graph.findModelsFromPoint(pt)
      .sort((a, b) => (b.get('z') || 0) - (a.get('z') || 0));
    let next = null;
    // A representative child each STRUCTURED parent accepts, so the "does it host anything?" probe is TRUE for it.
    // (Using a generic 'sf.SimpleNode' missed the Gantt timeline — it only accepts Gantt children — so the timeline
    // never lit up during a dragover. That was the "timeline shows no capture highlight" report.)
    const PROBE_CHILD = { 'sf.GanttTimeline': 'sf.GanttTask', 'sf.SequenceParticipant': 'sf.SequenceActivation', 'sf.SequenceActor': 'sf.SequenceActivation', 'sf.Task': 'sf.OrgPerson' };
    for (const cell of candidates) {
      const t = cell.get('type');
      // Match any STRUCTURED parent that accepts SOME child — cheap proxy for "container-like". Walking is short
      // (< 10 cells) so the per-frame cost is fine. The free-form groupers (Container/Zone/BPMN) show the dashed
      // drop-ghost instead, so only solid-highlight the structured parents here (else ghost + solid double up).
      const acceptsAnyChild = (t in PROBE_CHILD) && canEmbed(t, PROBE_CHILD[t]);
      if (acceptsAnyChild) { next = paper.findViewByModel(cell); break; }
    }
    if (next === _highlightedView) return;
    clearDropHighlight();
    if (next?.el) {
      next.el.classList.add('df-drop-target');
      _highlightedView = next;
    }
  };

  canvasEl.addEventListener('dragover', (evt) => {
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'copy';
    refreshDropHighlight(evt.clientX, evt.clientY);
    refreshDropGhost(evt.clientX, evt.clientY);
  });
  canvasEl.addEventListener('dragleave', (evt) => {
    // Only clear when the cursor actually leaves the canvas — dragleave
    // fires on every child boundary crossing too.
    if (evt.target === canvasEl) { clearDropHighlight(); hideDropGhost(); cctx.clearGanttDateChip?.(); }
  });

  canvasEl.addEventListener('drop', (evt) => {
    evt.preventDefault();
    clearDropHighlight();
    endDropGhost();

    // Custom template drop — instantiate with fresh cell IDs at the drop point.
    const templateData = evt.dataTransfer.getData('application/sf-diagrams-template');
    if (templateData) {
      let info;
      try { info = JSON.parse(templateData); } catch { return; }
      const localPoint = paper.clientToLocalPoint(evt.clientX, evt.clientY);
      instantiateTemplate(info.id, localPoint);
      return;
    }

    const data = evt.dataTransfer.getData('application/sf-diagrams');
    if (!data) return;

    let template;
    try {
      template = JSON.parse(data);
    } catch {
      return;
    }

    // Convert raw client coordinates to paper-local coordinates
    // clientToLocalPoint handles the paper offset internally — pass raw clientX/Y
    const localPoint = paper.clientToLocalPoint(evt.clientX, evt.clientY);

    // Image drops route through a callback flow that keeps the chain to
    // `input.click()` synchronous from this drop event — Safari rejects the
    // file picker otherwise. See js/image-component.js header comment.
    if (template.customDrop === 'image') {
      startImageAddFlow(graph, (result) => addImageCellAt(result, localPoint));
      return;
    }

    try {
      const gridSize = paper.options.gridSize || 4;

      // Create element at origin first, then center on drop point
      const element = createElementFromComponent(template, { x: 0, y: 0 });
      if (element) {
        applyDisplayFlags(element);
        const size = element.size();
        const cx = localPoint.x - size.width / 2;
        const cy = localPoint.y - size.height / 2;
        element.position(
          Math.round(cx / gridSize) * gridSize,
          Math.round(cy / gridSize) * gridSize,
        );
        if (element.get('type') === 'sf.GanttTimeline') {
          // Phase 4.6: a dropped timeline seeds a real plan (like a fresh Gantt) - all phases + their key tasks, gate
          // milestones, and a Today marker - so it's editable immediately, never a tasks[]-only timeline. Everything
          // lands in ONE history batch (one undo); layoutTimelineTasks positions every element type in one pass.
          const { bars, milestones = [], marker } = createGanttBarsFor(element);
          history.startBatch();
          try {
            graph.addCell(element);
            for (const c of [...bars, ...milestones, ...(marker ? [marker] : [])]) { graph.addCell(c); element.embed(c); }
            layoutTimelineTasks(element);
          } finally { history.endBatch(); }
        } else if (element.get('type') === 'sf.GanttGroup' && element.get('phaseLabel')) {
          // Item 4: a dropped Project Phase ADDS a timeline group (a header row), like a dropped task adds a task —
          // not a floating shape that does nothing. We never add the shape; we append a `groups[]` entry to the
          // timeline under the drop point (or the sole timeline). The plain "Summary Bar" GanttGroup (no
          // phaseLabel) still drops as a manual floating bar via the generic branch below.
          const pos = element.position(), sz = element.size();
          const pt = { x: pos.x + sz.width / 2, y: pos.y + sz.height / 2 };
          const timelines = graph.getElements().filter(e => e.get('type') === 'sf.GanttTimeline');
          let tl = timelines.find(e => e.getBBox().containsPoint(pt));
          if (!tl && timelines.length === 1) tl = timelines[0];
          if (tl) {
            const existing = (tl.get('groups') || []);
            const palette = ['#5B5FC7', '#1D73C9', '#2A9D8F', '#E8881A', '#DA4E55', '#7C5CBF'];
            // Insert at the drop position — by default (dropped below everything) at the BOTTOM (last), but a drop
            // onto a specific row inserts there; existing groups at/after that slot shift down (item 4).
            const at = ganttGroupInsertOrder(tl, pt.y);
            const gs = existing.map(g => ({ ...g, order: (g.order ?? 0) >= at ? (g.order ?? 0) + 1 : (g.order ?? 0) }));
            // Colour from the library phase (phaseColor) when present, else cycle the palette (the generic "Phase").
            const color = element.get('phaseColor') || palette[existing.length % palette.length];
            gs.push({ id: 'g' + Date.now() + '_' + existing.length, label: element.get('phaseLabel'), color, order: at });
            tl.set('groups', gs);   // single undoable change; the group row + its auto summary bar render from this
          }
        } else {
          graph.addCell(element);
          updateSimpleNodeLayout(element);
          updateContainerHeaderLayout(element);   // flush an icon-less Container's title left (no-op otherwise)
          tryEmbed(element);
          // Phase B1: a milestone dropped over a timeline is date-driven — seed its `milestoneDate` from the drop
          // column so it's real schedule data immediately (and snaps to that column via the view listener), the
          // same way a dropped bar seeds dates. No-op if it didn't land on a timeline (derive... → null).
          if (element.get('type') === 'sf.GanttMilestone') {
            const d = deriveGanttMilestoneDate(element);
            if (d) element.set('milestoneDate', d);
          }
          // Same for a Day Marker — seed `markerDate` from the drop column so it's dated (and its full-height
          // line draws) immediately AND it snaps onto the nearest day, instead of landing dateless mid-column
          // with no line (the "no line unless perfectly between two days" report).
          if (element.get('type') === 'sf.GanttMarker') {
            const d = deriveGanttMarkerDate(element);
            if (d) element.set('markerDate', d);
          }
          // Both point markers also snap their Y to the nearest ROW CENTRE on drop (issue 4) so they land lined up
          // on a task row instead of floating between rows (the X already snapped to a day via the date above).
          if (element.get('type') === 'sf.GanttMilestone' || element.get('type') === 'sf.GanttMarker') {
            const tl = ganttTimelineFor(element);
            const sy = tl && snapGanttRowCentreY(tl, element.position().y + element.size().height / 2);
            if (sy != null) element.position(element.position().x, Math.round(sy - element.size().height / 2));
          }
          // A dropped task bar must get an ORDER, or it floats at its drop Y while the panel rows it by `order` —
          // the "dragging scrambles / bars don't match their labels" bug (a chart built by dropping tasks scatters).
          // It also INHERITS the group it was dropped into (the group region at its drop Y) so it lands in a phase
          // and gets summarized. Seed dates from its drop column, then back-fill orders from every bar's current Y
          // (slotting the new bar among the rest) and re-lay-out so each bar snaps to its row + date column. One undo.
          if (element.get('type') === 'sf.GanttTask') {
            const tl = ganttTimelineFor(element);
            if (tl) {
              history.startBatch();
              try {
                const tgt = ganttDropTarget(tl, element.position().y + element.size().height / 2, null);
                if (tgt && tgt.groupId) element.set('groupId', tgt.groupId);
                if (!element.get('startDate') || !element.get('endDate')) {
                  const d = deriveGanttDates(element, tl);
                  if (d) element.set({ startDate: d.start, endDate: d.end });
                }
                backfillGanttOrders(tl);
                recolorGroupTasks(tl);   // issue 7: the dropped bar takes its group's colour (not the stencil default)
                layoutTimelineTasks(tl);
              } finally { history.endBatch(); }
            }
          }
          // Capture: drop-on-lifeline snaps activation's X to the lifeline centre.
          if (element.get('type') === 'sf.SequenceActivation') {
            snapActivationToLifeline(element);
          }
        }
      }
    } catch (err) {
      console.warn('SF Diagrams: Drop failed:', err);
    }
  });
}

/**
 * Place a processed image at the given local point. Caps the on-canvas
 * footprint so a 1280-wide source doesn't blow out the viewport — the user
 * can resize via the corner handles afterward.
 */
function addImageCellAt(result, localPoint) {
  if (!result) return;
  const { dataURI, width, height } = result;
  const MAX_DISPLAY = 320;
  let dispW = width, dispH = height;
  if (dispW > MAX_DISPLAY || dispH > MAX_DISPLAY) {
    const ratio = Math.min(MAX_DISPLAY / dispW, MAX_DISPLAY / dispH);
    dispW = Math.round(dispW * ratio);
    dispH = Math.round(dispH * ratio);
  }
  const gridSize = paper.options.gridSize || 4;
  const cx = Math.round((localPoint.x - dispW / 2) / gridSize) * gridSize;
  const cy = Math.round((localPoint.y - dispH / 2) / gridSize) * gridSize;

  const element = new joint.shapes.sf.Image({
    position: { x: cx, y: cy },
    size: { width: dispW, height: dispH },
    attrs: { image: { href: dataURI } },
  });
  graph.addCell(element);
  tryEmbed(element);
}

/** Paper-local point at the visible centre of the canvas, accounting for
 *  panels that overlap the canvas from the bottom on mobile. Shared by the
 *  template + template double-click "add to centre" flows. */
function getCanvasCenterLocalPoint() {
  const canvasEl = document.getElementById('canvas-container');
  const rect = canvasEl.getBoundingClientRect();
  let visibleTop = rect.top;
  let visibleBottom = rect.bottom;

  // On mobile, fixed-positioned panels overlap the canvas from the bottom
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    const stencilEl = document.querySelector('.df-stencil:not(.df-stencil--hidden)');
    const propsEl = document.querySelector('.df-properties:not(.df-properties--hidden)');
    // Use the highest panel top edge as the effective bottom of visible canvas
    if (stencilEl) {
      const sr = stencilEl.getBoundingClientRect();
      if (sr.top < visibleBottom) visibleBottom = sr.top;
    }
    if (propsEl) {
      const pr = propsEl.getBoundingClientRect();
      if (pr.top < visibleBottom) visibleBottom = pr.top;
    }
  }

  const centerClient = { x: rect.left + rect.width / 2, y: visibleTop + (visibleBottom - visibleTop) / 2 };
  return paper.clientToLocalPoint(centerClient.x, centerClient.y);
}

function addToCenter(template) {
  const localCenter = getCanvasCenterLocalPoint();
  const gridSize = paper.options.gridSize || 4;

  // Dblclick on the Image stencil — same callback flow as drag-drop so the
  // picker click stays in the user-gesture chain (Safari requirement).
  if (template.customDrop === 'image') {
    startImageAddFlow(graph, (result) => addImageCellAt(result, localCenter));
    return;
  }

  const element = createElementFromComponent(template, { x: 0, y: 0 });
  if (!element) return;
  applyDisplayFlags(element);

  const size = element.size();
  let cx = localCenter.x - size.width / 2;
  let cy = localCenter.y - size.height / 2;
  cx = Math.round(cx / gridSize) * gridSize;
  cy = Math.round(cy / gridSize) * gridSize;

  // Offset if there's already an element at the same position
  const OFFSET = 20;
  let attempts = 0;
  while (attempts < 20) {
    const occupied = graph.getElements().some(el => {
      const p = el.position();
      return Math.abs(p.x - cx) < 4 && Math.abs(p.y - cy) < 4;
    });
    if (!occupied) break;
    cx += OFFSET;
    cy += OFFSET;
    attempts++;
  }

  element.position(cx, cy);
  graph.addCell(element);
  updateSimpleNodeLayout(element);
  updateContainerHeaderLayout(element);   // flush an icon-less Container's title left (no-op otherwise)
}

/** Create a styled HTML drag preview that resembles the target shape */
function setDragPreview(evt, template) {
  const type = template.type || 'sf.SimpleNode';

  // Issue 8: point shapes (milestone diamond / day-marker triangle) are NOT box-shaped — a rounded-rect ghost reads
  // as a task. Give them a glyph drag image so the thing following the cursor is unmistakably a milestone / marker.
  if (type === 'sf.GanttMilestone' || type === 'sf.GanttMarker') {
    const cs = getComputedStyle(document.documentElement);
    const isMs = type === 'sf.GanttMilestone';
    const fill = isMs ? (cs.getPropertyValue('--brand-amber').trim() || '#F6B355') : (cs.getPropertyValue('--brand-red').trim() || '#DA4E55');
    const SZ = 30;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(SZ)); svg.setAttribute('height', String(SZ)); svg.setAttribute('viewBox', '0 0 30 30');
    svg.style.cssText = 'position:fixed;left:-9999px;top:-9999px;pointer-events:none;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.3));';
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', isMs ? 'M15 3 L27 15 L15 27 L3 15 Z' : 'M15 4 L27 26 L3 26 Z');   // diamond / upward triangle
    p.setAttribute('fill', fill);
    svg.appendChild(p);
    document.body.appendChild(svg);
    evt.dataTransfer.setDragImage(svg, SZ / 2, SZ / 2);
    requestAnimationFrame(() => svg.remove());
    return;
  }

  // Determine dimensions based on shape type
  let w = 140, h = 48;
  if (type === 'sf.Container') { w = 180; h = 100; }
  else if (type === 'sf.Zone') { w = 180; h = 100; }
  else if (type === 'sf.DataObject') { w = 180; h = 72; }
  else if (type === 'sf.Note') { w = 120; h = 64; }
  else if (type === 'sf.TextLabel') { w = 100; h = 24; }
  else if (type === 'sf.Line') { w = 120; h = 8; }
  else if (type.startsWith('sf.Bpmn') || type.startsWith('sf.Flow')) { w = 100; h = 48; }
  else if (type.startsWith('sf.Gantt')) { w = 160; h = 28; }
  else if (type === 'sf.OrgPerson') { w = 180; h = 72; }

  const ghost = document.createElement('div');
  // Compute colors from CSS vars (fallback for drag image which can't use CSS vars)
  const cs = getComputedStyle(document.documentElement);
  const bgColor = cs.getPropertyValue('--node-bg').trim() || '#2A2D32';
  const borderColor = cs.getPropertyValue('--node-border').trim() || '#444';
  const textColor = cs.getPropertyValue('--text-secondary').trim() || '#999';

  ghost.style.cssText = `
    position:fixed;left:-9999px;top:-9999px;
    width:${w}px;height:${h}px;
    background:${bgColor};
    border:1.5px solid ${borderColor};
    border-radius:8px;
    display:flex;align-items:center;justify-content:center;
    font-size:11px;color:${textColor};
    font-family:system-ui,sans-serif;
    box-shadow:0 4px 12px rgba(0,0,0,0.18);
    pointer-events:none;
  `;

  // Style variations — sanitize template-derived colors before applying to style
  const safeColor = (c) => /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#1D73C9';
  if (type === 'sf.Zone') ghost.style.borderStyle = 'dashed';
  if (type === 'sf.Note') ghost.style.background = '#FFF9C4';
  if (type === 'sf.DataObject') {
    ghost.style.borderTop = `4px solid ${safeColor(template.headerColor)}`;
    ghost.style.borderRadius = '6px';
  }
  if (type === 'sf.Container') {
    ghost.style.borderTop = `4px solid ${safeColor(template.accentColor)}`;
  }

  ghost.textContent = template.label || 'Shape';
  document.body.appendChild(ghost);
  evt.dataTransfer.setDragImage(ghost, w / 2, h / 2);

  // Clean up — browser captures the image synchronously after dragstart returns
  requestAnimationFrame(() => ghost.remove());
}

/** After drop, try to embed the element into a container/zone at its position */
function tryEmbed(element) {
  // Suppress change:parent recording: a stencil drop's `add` command already captures
  // the final embedded state (its JSON re-capture round-trips `parent`), so recording
  // the embed as its own command would split one drop into two undo steps.
  history.suppressEmbedTracking(() => {
    const bbox = element.getBBox();
    const childType = element.get('type');
    // 1) Exact overlap — topmost valid parent. canEmbed is the single source of
    //    truth for the type rules, keeping this in lockstep with the canvas-drag
    //    path and covering every parent type (incl. BpmnLoop, which the old inline
    //    list missed).
    const overlap = graph.findModelsInArea(bbox)
      .filter(el => el.id !== element.id)
      .sort((a, b) => (b.get('z') || 0) - (a.get('z') || 0));
    for (const candidate of overlap) {
      if (canEmbed(candidate.get('type'), childType)) {
        candidate.embed(element);
        return;
      }
    }
    // 2) No overlap — the capture halo lets a drop just OUTSIDE a container-like
    //    parent (especially just below it) still embed. Tuck the element inside
    //    first so the on-drop auto-fit grows the parent cleanly around it.
    const halo = findHaloParent(bbox, childType, element.id);
    if (halo) {
      tuckChildInside(element, halo);
      halo.embed(element);
    }
  });
}

/** Copy display flags (showLabels, showFieldLengths, keyFieldsOnly) from existing DataObjects to a new one */
function applyDisplayFlags(element) {
  if (element.get('type') !== 'sf.DataObject') return;
  const existing = graph.getElements().find(el => el.get('type') === 'sf.DataObject');
  if (!existing) return;
  const showLabels = existing.get('showLabels');
  const showFieldLengths = existing.get('showFieldLengths');
  const keyFieldsOnly = existing.get('keyFieldsOnly');
  if (showLabels != null) element.set('showLabels', showLabels);
  if (showFieldLengths != null) element.set('showFieldLengths', showFieldLengths);
  if (keyFieldsOnly != null) element.set('keyFieldsOnly', keyFieldsOnly);
}

function filterStencil(query) {
  const sections = bodyEl.querySelectorAll('.df-stencil__category');

  sections.forEach(section => {
    const items = section.querySelectorAll('.df-stencil__item');
    let visibleCount = 0;

    items.forEach(item => {
      const label = (item.querySelector('.df-stencil__item-label')?.textContent || item.title || '').toLowerCase();
      const matches = !query || label.includes(query);
      item.style.display = matches ? '' : 'none';
      if (matches) visibleCount++;
    });

    section.style.display = visibleCount > 0 || !query ? '' : 'none';

    // Auto-expand matching categories
    if (query && visibleCount > 0) {
      section.classList.remove('df-stencil__category--collapsed');
    }
  });
}

export function toggle() {
  if (isHidden()) show();
  else hide();
}

// ── Touch long-press → drag (HTML5 DnD doesn't work on touch) ──────
function setupTouchDrag() {
  let pressTimer = null;
  let activeItem = null;
  let activeTemplate = null;
  let activeTemplateId = null;
  let activeLabel = null;
  let ghost = null;
  let startXY = null;
  let dragging = false;

  const LONG_PRESS_MS = 350;
  const MOVE_CANCEL_PX = 10;

  const getTemplateFor = (itemEl) => {
    // Template items: rebuild from dataset/label — we only have label in dataset.
    // Easier: attach JSON directly during build. Fallback: find by iconId for icon-mode items.
    if (itemEl._sfComponent) return itemEl._sfComponent;
    return null;
  };

  const cancel = () => {
    clearTimeout(pressTimer);
    pressTimer = null;
    if (ghost) { ghost.remove(); ghost = null; }
    activeItem = null;
    activeTemplate = null;
    activeTemplateId = null;
    activeLabel = null;
    startXY = null;
    dragging = false;
  };

  const startDrag = (clientX, clientY) => {
    if (!activeTemplate && !activeTemplateId) return;
    dragging = true;
    if (navigator.vibrate) navigator.vibrate(15);
    // Create simple ghost following finger
    ghost = document.createElement('div');
    ghost.className = 'df-touch-drag-ghost';
    ghost.textContent = activeTemplate?.label || activeLabel || 'Shape';
    ghost.style.left = clientX + 'px';
    ghost.style.top = clientY + 'px';
    document.body.appendChild(ghost);
  };

  const onMove = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    if (!dragging && startXY) {
      const dx = t.clientX - startXY.x;
      const dy = t.clientY - startXY.y;
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX && !pressTimer) {
        // moved too far before long-press: abort
      } else if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
        cancel();
      }
      return;
    }
    if (dragging && ghost) {
      e.preventDefault();
      ghost.style.left = t.clientX + 'px';
      ghost.style.top = t.clientY + 'px';
    }
  };

  const onEnd = (e) => {
    if (dragging && (activeTemplate || activeTemplateId)) {
      const t = e.changedTouches?.[0];
      if (t) {
        const el = document.elementFromPoint(t.clientX, t.clientY);
        const canvasEl = document.getElementById('canvas-container');
        if (el && canvasEl.contains(el)) {
          if (activeTemplateId) {
            instantiateTemplate(activeTemplateId, paper.clientToLocalPoint(t.clientX, t.clientY));
          } else {
            dropTemplateAtClient(activeTemplate, t.clientX, t.clientY);
          }
        }
      }
    }
    cancel();
  };

  panelEl.addEventListener('touchstart', (e) => {
    // Enable touch-drag-to-canvas on any touch device, including a tablet in desktop layout (>768px) where
    // HTML5 drag-and-drop never fires. Keep it off for a wide screen with a FINE pointer (desktop + mouse),
    // which uses the native HTML5 drag path instead.
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (window.innerWidth > 768 && !coarse) return;
    const item = e.target.closest('.df-stencil__item');
    if (!item) return;
    const tpl = getTemplateFor(item);
    const templateId = item._sfTemplateId || null;
    if (!tpl && !templateId) return;
    activeItem = item;
    activeTemplate = tpl;
    activeTemplateId = templateId;
    activeLabel = item._sfTemplateName || null;
    const t = e.touches[0];
    startXY = { x: t.clientX, y: t.clientY };
    pressTimer = setTimeout(() => {
      pressTimer = null;
      startDrag(t.clientX, t.clientY);
    }, LONG_PRESS_MS);
  }, { passive: true });

  panelEl.addEventListener('touchmove', onMove, { passive: false });
  panelEl.addEventListener('touchend', onEnd);
  panelEl.addEventListener('touchcancel', cancel);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
}

function dropTemplateAtClient(template, clientX, clientY) {
  try {
    const localPoint = paper.clientToLocalPoint(clientX, clientY);
    if (template.customDrop === 'image') {
      startImageAddFlow(graph, (result) => addImageCellAt(result, localPoint));
      return;
    }
    const gridSize = paper.options.gridSize || 4;
    const element = createElementFromComponent(template, { x: 0, y: 0 });
    if (!element) return;
    applyDisplayFlags(element);
    const size = element.size();
    const cx = localPoint.x - size.width / 2;
    const cy = localPoint.y - size.height / 2;
    element.position(
      Math.round(cx / gridSize) * gridSize,
      Math.round(cy / gridSize) * gridSize,
    );
    graph.addCell(element);
    updateSimpleNodeLayout(element);
    updateContainerHeaderLayout(element);   // flush an icon-less Container's title left (no-op otherwise)
    tryEmbed(element);
    if (element.get('type') === 'sf.SequenceActivation') {
      snapActivationToLifeline(element);
    }
  } catch (err) {
    console.warn('SF Diagrams: Touch drop failed:', err);
  }
}

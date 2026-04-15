// Stencil panel — draggable component library
// Organizes templates by category, supports search, handles drag-to-canvas

import { TEMPLATE_CATEGORIES, BPMN_CATEGORIES, DATAMODEL_CATEGORIES, GANTT_CATEGORIES, ORG_CATEGORIES, createElementFromTemplate } from './templates.js?v=1.3.1';
import { getAllIcons, getCategories } from './icons.js?v=1.3.1';
import { updateSimpleNodeLayout } from './canvas.js?v=1.3.1';

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

  searchEl.addEventListener('input', () => {
    filterStencil(searchEl.value.trim().toLowerCase());
  });

  setupDropZone();
}

export function setDiagramType(type) {
  if (type === currentDiagramType) return;
  currentDiagramType = type;
  renderCategories();
  searchEl.value = '';
}

function renderCategories() {
  bodyEl.innerHTML = '';

  const categories = currentDiagramType === 'process' ? BPMN_CATEGORIES
                   : currentDiagramType === 'datamodel' ? DATAMODEL_CATEGORIES
                   : currentDiagramType === 'gantt' ? GANTT_CATEGORIES
                   : currentDiagramType === 'org' ? ORG_CATEGORIES
                   : TEMPLATE_CATEGORIES;

  for (const category of categories) {
    bodyEl.appendChild(buildTemplateSection(category));
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
}

function buildTemplateSection(category) {
  const section = document.createElement('div');
  section.className = 'sf-stencil__category' + (category.collapsed ? ' sf-stencil__category--collapsed' : '');
  section.dataset.categoryId = category.id;

  const header = buildCategoryHeader(category.label, category.templates.length);
  header.addEventListener('click', () => {
    section.classList.toggle('sf-stencil__category--collapsed');
  });

  const items = document.createElement('div');
  items.className = 'sf-stencil__items';

  for (const template of category.templates) {
    items.appendChild(buildTemplateItem(template));
  }

  section.appendChild(header);
  section.appendChild(items);
  return section;
}

function buildIconSection(cat, icons, displayLabel) {
  const section = document.createElement('div');
  section.className = 'sf-stencil__category sf-stencil__category--collapsed';
  section.dataset.categoryId = `slds-${cat}`;

  const header = buildCategoryHeader(displayLabel || `SLDS: ${cat}`, icons.length);
  header.addEventListener('click', () => {
    section.classList.toggle('sf-stencil__category--collapsed');
  });

  const grid = document.createElement('div');
  grid.className = 'sf-stencil__items sf-stencil__items--grid';

  for (const icon of icons) {
    const item = document.createElement('div');
    item.className = 'sf-stencil__item sf-stencil__item--icon';
    item.title = icon.name;
    item.dataset.iconId = icon.id;
    item.draggable = true;
    const safeId = icon.id.replace(/[^a-zA-Z0-9_-]/g, '');
    item.innerHTML = `<svg class="sf-stencil__icon-preview"><use href="#${safeId}"></use></svg>`;

    item.addEventListener('dragstart', (evt) => {
      const tpl = {
        type: 'sf.SimpleNode',
        label: icon.name.replace(/_/g, ' '),
        iconName: icon.id,
      };
      evt.dataTransfer.setData('application/sf-diagrams', JSON.stringify(tpl));
      evt.dataTransfer.effectAllowed = 'copy';
      setDragPreview(evt, tpl);
    });

    grid.appendChild(item);
  }

  section.appendChild(header);
  section.appendChild(grid);
  return section;
}

function buildCategoryHeader(label, count) {
  const header = document.createElement('div');
  header.className = 'sf-stencil__category-header';
  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;
  const countSpan = document.createElement('span');
  countSpan.className = 'sf-stencil__category-count';
  countSpan.textContent = count;
  header.appendChild(labelSpan);
  header.appendChild(countSpan);
  return header;
}

function buildTemplateItem(template) {
  const item = document.createElement('div');
  item.className = 'sf-stencil__item';
  item.draggable = true;
  item.dataset.label = template.label?.toLowerCase() || '';

  // stencilSvg takes priority — allows custom logos even when iconName is set for the dropped element
  const safeIconName = (template.iconName || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const iconHtml = template.stencilSvg
    ? `<svg class="sf-stencil__item-icon sf-stencil__item-icon--svg" viewBox="0 0 20 20">${template.stencilSvg}</svg>`
    : safeIconName
    ? `<svg class="sf-stencil__item-icon"><use href="#${safeIconName}"></use></svg>`
    : `<div class="sf-stencil__item-icon sf-stencil__item-icon--placeholder"></div>`;

  item.innerHTML = iconHtml;
  const labelSpan = document.createElement('span');
  labelSpan.className = 'sf-stencil__item-label';
  labelSpan.textContent = template.label || '';
  item.appendChild(labelSpan);

  item.addEventListener('dragstart', (evt) => {
    evt.dataTransfer.setData('application/sf-diagrams', JSON.stringify(template));
    evt.dataTransfer.effectAllowed = 'copy';
    setDragPreview(evt, template);
  });

  item.addEventListener('dblclick', () => {
    addToCenter(template);
  });

  return item;
}

function setupDropZone() {
  const canvasEl = document.getElementById('canvas-container');

  canvasEl.addEventListener('dragover', (evt) => {
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'copy';
  });

  canvasEl.addEventListener('drop', (evt) => {
    evt.preventDefault();
    const data = evt.dataTransfer.getData('application/sf-diagrams');
    if (!data) return;

    let template;
    try {
      template = JSON.parse(data);
    } catch {
      return;
    }

    try {
      // Convert raw client coordinates to paper-local coordinates
      // clientToLocalPoint handles the paper offset internally — pass raw clientX/Y
      const localPoint = paper.clientToLocalPoint(evt.clientX, evt.clientY);
      const gridSize = paper.options.gridSize || 4;

      // Create element at origin first, then center on drop point
      const element = createElementFromTemplate(template, { x: 0, y: 0 });
      if (element) {
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
        tryEmbed(element);
      }
    } catch (err) {
      console.warn('SF Diagrams: Drop failed:', err);
    }
  });
}

function addToCenter(template) {
  // Find the visible center of the canvas, accounting for overlapping panels on mobile
  const canvasEl = document.getElementById('canvas-container');
  const rect = canvasEl.getBoundingClientRect();
  let visibleTop = rect.top;
  let visibleBottom = rect.bottom;

  // On mobile, fixed-positioned panels overlap the canvas from the bottom
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    const stencilEl = document.querySelector('.sf-stencil:not(.sf-stencil--hidden)');
    const propsEl = document.querySelector('.sf-properties:not(.sf-properties--hidden)');
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
  const localCenter = paper.clientToLocalPoint(centerClient.x, centerClient.y);
  const gridSize = paper.options.gridSize || 4;

  const element = createElementFromTemplate(template, { x: 0, y: 0 });
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
}

/** Create a styled HTML drag preview that resembles the target shape */
function setDragPreview(evt, template) {
  const type = template.type || 'sf.SimpleNode';

  // Determine dimensions based on shape type
  let w = 140, h = 48;
  if (type === 'sf.Container') { w = 180; h = 100; }
  else if (type === 'sf.Zone') { w = 180; h = 100; }
  else if (type === 'sf.DataObject') { w = 180; h = 72; }
  else if (type === 'sf.Note') { w = 120; h = 64; }
  else if (type === 'sf.TextLabel') { w = 100; h = 24; }
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
  const bbox = element.getBBox();
  const candidates = graph.findModelsInArea(bbox)
    .filter(el => el.id !== element.id)
    .sort((a, b) => (b.get('z') || 0) - (a.get('z') || 0));
  // Find the topmost valid parent (Container or Zone)
  for (const candidate of candidates) {
    const parentType = candidate.get('type');
    const childType = element.get('type');
    let valid = false;
    if (parentType === 'sf.Container') {
      valid = childType !== 'sf.Container' && childType !== 'sf.Zone';
    } else if (parentType === 'sf.Zone') {
      valid = childType !== 'sf.Zone';
    } else if (parentType === 'sf.BpmnPool') {
      valid = childType !== 'sf.BpmnPool';
    } else if (parentType === 'sf.BpmnSubprocess') {
      valid = childType !== 'sf.BpmnPool' && childType !== 'sf.BpmnSubprocess';
    } else if (parentType === 'sf.GanttTimeline') {
      valid = childType === 'sf.GanttTask' || childType === 'sf.GanttMilestone' || childType === 'sf.GanttMarker' || childType === 'sf.GanttGroup';
    }
    if (valid) {
      candidate.embed(element);
      break;
    }
  }
}

/** Copy display flags (showLabels, showFieldLengths) from existing DataObjects to a new one */
function applyDisplayFlags(element) {
  if (element.get('type') !== 'sf.DataObject') return;
  const existing = graph.getElements().find(el => el.get('type') === 'sf.DataObject');
  if (!existing) return;
  const showLabels = existing.get('showLabels');
  const showFieldLengths = existing.get('showFieldLengths');
  if (showLabels != null) element.set('showLabels', showLabels);
  if (showFieldLengths != null) element.set('showFieldLengths', showFieldLengths);
}

function filterStencil(query) {
  const sections = bodyEl.querySelectorAll('.sf-stencil__category');

  sections.forEach(section => {
    const items = section.querySelectorAll('.sf-stencil__item');
    let visibleCount = 0;

    items.forEach(item => {
      const label = (item.querySelector('.sf-stencil__item-label')?.textContent || item.title || '').toLowerCase();
      const matches = !query || label.includes(query);
      item.style.display = matches ? '' : 'none';
      if (matches) visibleCount++;
    });

    section.style.display = visibleCount > 0 || !query ? '' : 'none';

    // Auto-expand matching categories
    if (query && visibleCount > 0) {
      section.classList.remove('sf-stencil__category--collapsed');
    }
  });
}

export function toggle() {
  panelEl.classList.toggle('sf-stencil--hidden');
}

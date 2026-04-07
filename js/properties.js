// Properties panel — left sidebar element inspector
// Properties are grouped into collapsible accordion sections

import { getAllIcons, getIconDataUri } from './icons.js';
import { Z_BASE, Z_TIER_SPAN, updateSimpleNodeLayout } from './canvas.js';
import { resizeDataObjectToFit, contrastTextColor } from './templates.js';
import { duplicate as clipboardDuplicate } from './clipboard.js';

/** Resolve a color value — if it's a CSS var(), compute the actual color; otherwise return as-is. */
function resolveColor(color) {
  if (!color) return '';
  if (color.startsWith('var(')) {
    return getComputedStyle(document.documentElement).getPropertyValue(
      color.replace(/^var\(/, '').replace(/\)$/, '').split(',')[0].trim()
    ).trim() || '#1C1E21';
  }
  return color;
}

// Human-readable display names for shape types
const TYPE_LABELS = {
  'sf.SimpleNode':     'Node',
  'sf.Container':      'Container',
  'sf.TextLabel':      'Text',
  'sf.Note':           'Note',
  'sf.Zone':           'Zone',
  'sf.BpmnEvent':      'Event',
  'sf.BpmnTask':       'Task',
  'sf.BpmnGateway':    'Gateway',
  'sf.BpmnSubprocess': 'Subprocess',
  'sf.BpmnLoop':       'Loop',
  'sf.BpmnPool':       'Pool',
  'sf.BpmnDataObject': 'Data Object',
  'sf.FlowProcess':    'Process',
  'sf.FlowDecision':   'Decision',
  'sf.FlowTerminator': 'Terminator',
  'sf.FlowDatabase':   'Database',
  'sf.FlowDocument':   'Document',
  'sf.FlowIO':         'Input / Output',
  'sf.FlowPredefined': 'Predefined Process',
  'sf.FlowOffPage':    'Off-Page Link',
  'sf.Annotation':     'Annotation',
  'sf.DataObject':     'Object',
  'sf.OrgPerson':      'Person',
  'sf.GanttTask':      'Task',
  'sf.GanttMilestone': 'Milestone',
  'sf.GanttTimeline':  'Timeline',
  'sf.GanttGroup':     'Group',
};

// Default sizes used by "Auto Size"
const DEFAULT_SIZES = {
  'sf.SimpleNode':     { width: 180, height: 64 },
  'sf.Container':      { width: 360, height: 240 },
  'sf.Zone':           { width: 400, height: 300 },
  'sf.TextLabel':      { width: 200, height: 32 },
  'sf.Note':           { width: 200, height: 120 },
  'sf.BpmnEvent':      { width: 40,  height: 40 },
  'sf.BpmnTask':       { width: 120, height: 60 },
  'sf.BpmnGateway':    { width: 48,  height: 48 },
  'sf.BpmnSubprocess': { width: 360, height: 240 },
  'sf.BpmnLoop':       { width: 360, height: 240 },
  'sf.BpmnPool':       { width: 600, height: 250 },
  'sf.BpmnDataObject': { width: 40,  height: 50 },
  'sf.FlowProcess':    { width: 120, height: 60 },
  'sf.FlowDecision':   { width: 120, height: 80 },
  'sf.FlowTerminator': { width: 120, height: 60 },
  'sf.FlowDatabase':   { width: 80,  height: 60 },
  'sf.FlowDocument':   { width: 120, height: 60 },
  'sf.FlowIO':         { width: 120, height: 60 },
  'sf.FlowPredefined': { width: 120, height: 60 },
  'sf.FlowOffPage':    { width: 60,  height: 60 },
  'sf.Annotation':     { width: 100, height: 120 },
  'sf.DataObject':     { width: 260, height: 80 },
  'sf.GanttTask':      { width: 240, height: 32 },
  'sf.GanttMilestone': { width: 24,  height: 24 },
  'sf.GanttTimeline':  { width: 960, height: 48 },
  'sf.GanttGroup':     { width: 360, height: 24 },
  'sf.OrgPerson':      { width: 280, height: 90 },
};

let graph, paper, selection;
let panelEl, typeBadgeEl, titleEl, bodyEl, footerEl;

export function init(_graph, _paper, _selection) {
  graph = _graph;
  paper = _paper;
  selection = _selection;

  panelEl     = document.getElementById('properties-panel');
  typeBadgeEl = document.getElementById('properties-type');
  titleEl     = document.getElementById('properties-title');
  bodyEl      = document.getElementById('properties-body');
  footerEl    = document.getElementById('properties-footer');

  document.getElementById('btn-close-properties').addEventListener('click', () => {
    panelEl.classList.add('sf-properties--hidden');
    selection.clearSelection();
  });

  selection.onChange((ids) => {
    cleanupCanvasHighlights();
    if (ids.length === 1) {
      const cell = graph.getCell(ids[0]);
      if (cell) showProperties(cell);
    } else if (ids.length > 1) {
      showMultiProperties(ids.length);
    } else {
      panelEl.classList.add('sf-properties--hidden');
      footerEl.innerHTML = '';
    }
  });

  // Double-click on element enters edit mode (focuses first input for label editing)
  paper.on('cell:pointerdblclick', (cellView) => {
    if (!cellView.model.isElement()) return;
    setTimeout(() => {
      const firstInput = bodyEl.querySelector('.sf-properties__input');
      if (firstInput) firstInput.focus();
    }, 50);
  });
}

/** Remove any lingering caret highlights from the canvas */
function cleanupCanvasHighlights() {
  document.querySelectorAll('.sf-canvas-caret').forEach(el => el.remove());
}

function showProperties(cell) {
  panelEl.classList.remove('sf-properties--hidden');
  bodyEl.innerHTML = '';
  footerEl.innerHTML = '';

  const type = cell.get('type') || '';
  const typeLabel = TYPE_LABELS[type] || type.replace('sf.', '') || 'Element';

  if (cell.isLink()) {
    typeBadgeEl.textContent = 'Connector';
    titleEl.textContent = cell.labels()?.[0]?.attrs?.text?.text || 'Unnamed';
  } else {
    typeBadgeEl.textContent = cell.get('iconMode') ? 'Icon' : typeLabel;
    const labelText = cell.get('_savedLabel') || cell.get('objectName') || cell.attr('label/text') || cell.attr('headerLabel/text') || '';
    titleEl.textContent = labelText || typeLabel;
  }

  if (type === 'sf.SimpleNode')       renderSimpleNodeProps(cell);
  else if (type === 'sf.Container')  renderContainerProps(cell);
  else if (type === 'sf.TextLabel')  renderTextLabelProps(cell);
  else if (type === 'sf.Note')       renderNoteProps(cell);
  else if (type === 'sf.Zone')       renderZoneProps(cell);
  else if (type === 'sf.BpmnEvent')  renderBpmnEventProps(cell);
  else if (type === 'sf.BpmnTask')   renderBpmnTaskProps(cell);
  else if (type === 'sf.BpmnGateway') renderBpmnGatewayProps(cell);
  else if (type === 'sf.BpmnSubprocess') renderBpmnSubprocessProps(cell);
  else if (type === 'sf.BpmnLoop')   renderBpmnLoopProps(cell);
  else if (type === 'sf.BpmnPool')   renderBpmnPoolProps(cell);
  else if (type === 'sf.BpmnDataObject') renderBpmnDataObjectProps(cell);
  else if (type === 'sf.Annotation')   renderAnnotationProps(cell);
  else if (type?.startsWith('sf.Flow')) renderFlowShapeProps(cell);
  else if (type === 'sf.DataObject') renderDataObjectProps(cell);
  else if (type === 'sf.GanttTask') renderGanttTaskProps(cell);
  else if (type === 'sf.GanttMilestone') renderGanttMilestoneProps(cell);
  else if (type === 'sf.GanttTimeline') renderGanttTimelineProps(cell);
  else if (type === 'sf.GanttGroup') renderGanttGroupProps(cell);
  else if (type === 'sf.OrgPerson') renderOrgPersonProps(cell);
  else if (cell.isLink())            renderLinkProps(cell);

  // Don't auto-focus inputs on single click — single click selects, double click edits.
}

function showMultiProperties(count) {
  panelEl.classList.remove('sf-properties--hidden');
  typeBadgeEl.textContent = 'Selection';
  titleEl.textContent = `${count} elements`;
  bodyEl.innerHTML = '';
  footerEl.innerHTML = '';

  const ids = selection.getSelectedIds();
  const cells = ids.map(id => graph.getCell(id)).filter(Boolean);
  const elements = cells.filter(c => c.isElement());

  if (elements.length === 0) {
    bodyEl.innerHTML = `<p class="sf-properties__multi-msg">No elements selected.</p>`;
    addDeleteBtn(footerEl, () => { graph.removeCells(cells); selection.clearSelection(); });
    return;
  }

  // ── Colors section (always shown) ──
  const colorSec = section(bodyEl, 'Colors');

  // Detect fill color: try body/fill, then accent/fill for containers
  function getFill(c) {
    return c.attr('body/fill') || c.attr('accent/fill') || c.attr('header/fill') || null;
  }
  function setFill(c, v) {
    const type = c.get('type');
    if (type === 'sf.Container') {
      c.attr('accent/fill', v);
    } else if (type === 'sf.DataObject') {
      c.attr('header/fill', v); c.attr('headerCover/fill', v);
    } else {
      c.attr('body/fill', v);
    }
    // Update text contrast for SimpleNode
    if (type === 'sf.SimpleNode') {
      const tc = contrastTextColor(v);
      if (tc) {
        c.attr('label/fill', tc);
        c.attr('subtitle/fill', tc);
        c.attr('subtitle/opacity', 0.7);
      }
    }
  }

  const fills = elements.map(getFill).filter(Boolean);
  const allSameFill = fills.length > 0 && fills.every(f => f === fills[0]);
  addColor(colorSec, 'Fill', allSameFill ? fills[0] : '#888888', v => {
    elements.forEach(c => setFill(c, v));
  });

  // Border color
  const borders = elements.map(c => c.attr('body/stroke')).filter(Boolean);
  const allSameBorder = borders.length > 0 && borders.every(b => b === borders[0]);
  addColor(colorSec, 'Border', allSameBorder ? borders[0] : '#888888', v => {
    elements.forEach(c => c.attr('body/stroke', v));
  });

  // Label color
  const labelFills = elements.map(c => c.attr('label/fill') || c.attr('headerLabel/fill')).filter(Boolean);
  const allSameLabel = labelFills.length > 0 && labelFills.every(l => l === labelFills[0]);
  addColor(colorSec, 'Label color', allSameLabel ? labelFills[0] : '#888888', v => {
    elements.forEach(c => {
      const type = c.get('type');
      if (type === 'sf.Container') c.attr('headerLabel/fill', v);
      else c.attr('label/fill', v);
    });
  });

  // ── Size section ──
  const types = new Set(elements.map(c => c.get('type')));
  const sizeSec = section(bodyEl, 'Size');
  const widths = elements.map(c => c.size().width);
  const heights = elements.map(c => c.size().height);
  const allSameW = widths.every(w => w === widths[0]);
  const allSameH = heights.every(h => h === heights[0]);
  addNumberPair(sizeSec,
    'Width', allSameW ? widths[0] : '', w => elements.forEach(c => c.resize(w, c.size().height)),
    'Height', allSameH ? heights[0] : '', h => elements.forEach(c => c.resize(c.size().width, h))
  );

  // ── Shared appearance (corner radius) ──
  const nodesWithRadius = elements.filter(c => c.get('type') === 'sf.SimpleNode');
  if (nodesWithRadius.length > 0) {
    const radii = nodesWithRadius.map(c => c.attr('body/rx') ?? 8);
    const allSameR = radii.every(r => r === radii[0]);
    addNumber(colorSec, 'Corner radius', allSameR ? radii[0] : 8, v => {
      nodesWithRadius.forEach(c => { c.attr('body/rx', v); c.attr('body/ry', v); });
    });
  }

  // ── Actions section (Order, Auto-size, Convert) ──
  const actionSec = section(bodyEl, 'Actions');

  // Order: Bring to Front / Send to Back
  const orderRow = document.createElement('div');
  orderRow.className = 'sf-prop-pair';

  const multiFrontBtn = document.createElement('button');
  multiFrontBtn.className = 'sf-properties__btn sf-properties__btn--order';
  multiFrontBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 2h12v2H2zM4 6h8v2H4zM6 10h4v4H6z"/>
    </svg>
    Bring to Front`;
  multiFrontBtn.addEventListener('click', () => {
    elements.forEach(c => {
      const type = c.get('type');
      const tierBase = Z_BASE[type] ?? 2000;
      const peers = graph.getElements().filter(el => !ids.includes(el.id) && el.get('z') >= tierBase && el.get('z') < tierBase + Z_TIER_SPAN);
      const maxZ = peers.length ? Math.max(...peers.map(el => el.get('z') ?? tierBase)) : tierBase;
      c.set('z', maxZ + 1);
    });
  });

  const multiBackBtn = document.createElement('button');
  multiBackBtn.className = 'sf-properties__btn sf-properties__btn--order';
  multiBackBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 2h4v4H6zM4 8h8v2H4zM2 12h12v2H2z"/>
    </svg>
    Send to Back`;
  multiBackBtn.addEventListener('click', () => {
    elements.forEach(c => {
      const type = c.get('type');
      const tierBase = Z_BASE[type] ?? 2000;
      const peers = graph.getElements().filter(el => !ids.includes(el.id) && el.get('z') >= tierBase && el.get('z') < tierBase + Z_TIER_SPAN);
      const minZ = peers.length ? Math.min(...peers.map(el => el.get('z') ?? tierBase)) : tierBase;
      c.set('z', Math.max(tierBase, minZ - 1));
    });
  });
  orderRow.appendChild(multiFrontBtn);
  orderRow.appendChild(multiBackBtn);
  actionSec.appendChild(orderRow);

  // Auto-size button
  addAutoSizeBtn(actionSec, () => {
    elements.forEach(c => {
      const type = c.get('type');
      if (type === 'sf.DataObject') {
        resizeDataObjectToFit(c);
      } else {
        const def = DEFAULT_SIZES[type];
        if (def) c.resize(def.width, def.height);
      }
    });
  });

  // ── Selection, Convert & Delete (footer) ──
  const allNodes = elements.every(c => c.get('type') === 'sf.SimpleNode');
  const allContainers = elements.every(c => c.get('type') === 'sf.Container');

  // Clone button (duplicates selection with connectors, like Cmd+D)
  const cloneWrap = document.createElement('div');
  cloneWrap.className = 'sf-clone-strip';
  const cloneBtn = document.createElement('button');
  cloneBtn.className = 'sf-properties__btn sf-properties__btn--clone';
  cloneBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="5" y="5" width="9" height="9" rx="2"/>
    <path d="M3 11H2.5A1.5 1.5 0 011 9.5V2.5A1.5 1.5 0 012.5 1h7A1.5 1.5 0 0111 2.5V3"/>
  </svg> Clone`;
  cloneBtn.addEventListener('click', () => { clipboardDuplicate(); });
  cloneWrap.appendChild(cloneBtn);
  footerEl.appendChild(cloneWrap);

  // Select All {type} — if selection is a single type, and NOT all of that type are already selected
  const typeCounts = {};
  elements.forEach(c => { const t = c.get('type'); typeCounts[t] = (typeCounts[t] || 0) + 1; });
  const typeEntries = Object.entries(typeCounts);
  if (typeEntries.length === 1) {
    const [typeName, count] = typeEntries[0];
    const totalOfType = graph.getElements().filter(c => c.get('type') === typeName).length;
    if (count < totalOfType) {
      const typeLabel = TYPE_LABELS[typeName] || typeName.replace('sf.', '');
      const plural = typeLabel.endsWith('s') || typeLabel.endsWith('x') ? typeLabel + 'es' : typeLabel + 's';
      addActionBtn(footerEl, `Select all ${plural}`, () => {
        selection.clearSelection();
        graph.getElements().filter(c => c.get('type') === typeName).forEach(c => selection.addToSelection(c.id));
      });
    }
  }

  // Select All — hide when all elements are already selected
  const allElements = graph.getElements();
  if (elements.length < allElements.length) {
    addActionBtn(footerEl, 'Select all', () => {
      selection.selectAll();
    });
  }

  // Convert buttons (if all are Nodes or all are Containers)
  if (allNodes) {
    addActionBtn(footerEl, 'Convert all to Container', () => {
      const selectedBefore = [...ids];
      selection.clearSelection();
      selectedBefore.forEach(id => {
        const c = graph.getCell(id);
        if (c && c.get('type') === 'sf.SimpleNode') convertToContainer(c);
      });
    });
    addActionBtn(footerEl, 'Convert all to Icon', () => {
      const selectedBefore = [...ids];
      selectedBefore.forEach(id => {
        const c = graph.getCell(id);
        if (c && c.get('type') === 'sf.SimpleNode') convertToIcon(c);
      });
    });
  }
  if (allContainers) {
    addActionBtn(footerEl, 'Convert all to Node', () => {
      const selectedBefore = [...ids];
      selection.clearSelection();
      selectedBefore.forEach(id => {
        const c = graph.getCell(id);
        if (c && c.get('type') === 'sf.Container') convertToNode(c);
      });
    });
  }

  // Delete All
  const delWrap = document.createElement('div');
  delWrap.className = 'sf-delete-strip';
  const delBtn = document.createElement('button');
  delBtn.className = 'sf-properties__btn sf-properties__btn--delete';
  delBtn.textContent = 'Delete all';
  delBtn.addEventListener('click', () => { graph.removeCells(cells); selection.clearSelection(); });
  delWrap.appendChild(delBtn);
  footerEl.appendChild(delWrap);
}

// ── Renderers per type ──────────────────────────────────────────────

/** Re-colour a cell's icon to match a new colour (used for fill/label colour changes). */
function recolorCellIcon(cell, newColor) {
  const iconHref = cell.attr('icon/href') || cell.attr('headerIcon/href');
  const attrPath = cell.attr('icon/href') ? 'icon/href' : 'headerIcon/href';
  if (!iconHref) return;
  const safeColor = newColor.replace(/[^a-zA-Z0-9#(),.\s%-]/g, '');
  const idMatch = iconHref.match(/data-icon-id(?:%3D|=)(?:%22|")([^%"]+)(?:%22|")/);
  if (idMatch) {
    const iconId = decodeURIComponent(idMatch[1]).replace(/[^a-zA-Z0-9_-]/g, '');
    cell.attr(attrPath, getIconDataUri(iconId, safeColor));
  } else {
    // Legacy path: replace fill attribute in decoded SVG data URI
    const decoded = decodeURIComponent(iconHref);
    const updated = decoded.replace(/fill="[^"]*"/, `fill="${safeColor}"`);
    cell.attr(attrPath, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(updated));
  }
}

function renderSimpleNodeProps(cell) {
  const isIcon = cell.get('iconMode');
  // Content
  const content = section(bodyEl, 'Content');
  const labelValue = isIcon ? (cell.get('_savedLabel') || '') : cell.attr('label/text');
  const subtitleValue = isIcon ? (cell.get('_savedSubtitle') || '') : cell.attr('subtitle/text');
  addText(content, 'Label', labelValue, v => {
    if (isIcon) {
      cell.set('_savedLabel', v);
    } else {
      cell.attr('label/text', v);
      updateSimpleNodeLayout(cell);
    }
    titleEl.textContent = v || 'Node';
  }, cell);
  addTextarea(content, 'Description', subtitleValue, v => {
    if (isIcon) {
      cell.set('_savedSubtitle', v);
    } else {
      cell.attr('subtitle/text', v);
      updateSimpleNodeLayout(cell);
    }
  });
  addIconPicker(content, 'Icon', cell.attr('icon/href'), v => { cell.attr('icon/href', v); updateSimpleNodeLayout(cell); },
    () => resolveColor(cell.attr('label/fill')) || getComputedStyle(document.documentElement).getPropertyValue('--node-text').trim() || '#1C1E21');

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill',          cell.attr('body/fill'),   v => {
    cell.attr('body/fill', v);
    const tc = contrastTextColor(v);
    if (tc) {
      cell.attr('label/fill', tc);
      cell.attr('subtitle/fill', tc);
      cell.attr('subtitle/opacity', 0.7);
      recolorCellIcon(cell, tc);
    }
  });
  addColor(appearance, 'Border',        cell.attr('body/stroke'), v => cell.attr('body/stroke', v));
  addColor(appearance, 'Label & Icon color',   cell.attr('label/fill'),  v => {
    cell.attr('label/fill', v);
    cell.attr('subtitle/fill', v);
    recolorCellIcon(cell, v);
  });
  addNumber(appearance, 'Corner radius', cell.attr('body/rx') ?? 8,
    v => { cell.attr('body/rx', v); cell.attr('body/ry', v); });

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES['sf.SimpleNode'];
    cell.resize(def.width, def.height);
  });
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell, 'Node layer');

  // Convert + Delete (in footer)
  if (cell.get('iconMode')) {
    addConvertBtn(footerEl, 'Convert to Node', () => convertFromIcon(cell));
  } else {
    addConvertBtn(footerEl, 'Convert to Container', () => convertToContainer(cell));
    addConvertBtn(footerEl, 'Convert to Icon', () => convertToIcon(cell));
  }
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderContainerProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Title', cell.attr('headerLabel/text'), v => {
    cell.attr('headerLabel/text', v);
    titleEl.textContent = v || 'Container';
  }, cell);
  addTextarea(content, 'Description', cell.attr('headerSubtitle/text'), v => cell.attr('headerSubtitle/text', v));
  addIconPicker(content, 'Icon', cell.attr('headerIcon/href'), v => cell.attr('headerIcon/href', v),
    () => resolveColor(cell.attr('headerLabel/fill')) || '#FFFFFF');

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Accent',      cell.attr('accent/fill'),     v => { cell.attr('accent/fill', v); cell.attr('accentFill/fill', v); });
  addColor(appearance, 'Fill',        cell.attr('body/fill'),        v => cell.attr('body/fill', v));
  addColor(appearance, 'Border',      cell.attr('body/stroke'),      v => cell.attr('body/stroke', v));
  addColor(appearance, 'Label & Icon color', cell.attr('headerLabel/fill'), v => {
    cell.attr('headerLabel/fill', v);
    recolorCellIcon(cell, v);
  });

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addAutoSizeBtn(size, () => {
    const embeds = cell.getEmbeddedCells().filter(c => c.isElement());
    if (embeds.length > 0) {
      try {
        cell.fitEmbeds({ padding: { top: 60, left: 20, right: 20, bottom: 20 } });
      } catch {
        const def = DEFAULT_SIZES['sf.Container'];
        cell.resize(def.width, def.height);
      }
    } else {
      const def = DEFAULT_SIZES['sf.Container'];
      cell.resize(def.width, def.height);
    }
  });
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell, 'Container layer');

  // Convert + Delete (in footer)
  addConvertBtn(footerEl, 'Convert to Node', () => convertToNode(cell));
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderTextLabelProps(cell) {
  const text = section(bodyEl, 'Text');
  addText(text, 'Content', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || 'Text';
  });
  addColor(text, 'Color',    cell.attr('label/fill'), v => cell.attr('label/fill', v));
  addNumber(text, 'Font size', cell.attr('label/fontSize') ?? 16,
    v => cell.attr('label/fontSize', v));
  addOrderButtons(text, cell, 'Node layer');

  // Delete (in footer)
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderNoteProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || 'Note';
  }, cell);
  addTextarea(content, 'Description', cell.attr('subtitle/text'), v => cell.attr('subtitle/text', v));
  addIconPicker(content, 'Icon', cell.attr('icon/href'), v => cell.attr('icon/href', v),
    () => cell.attr('label/fill') || '#5D4037');

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill',       cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Border',     cell.attr('body/stroke'), v => cell.attr('body/stroke', v));
  addColor(appearance, 'Label color', cell.attr('label/fill'),  v => {
    cell.attr('label/fill', v);
    cell.attr('subtitle/fill', v);
    recolorCellIcon(cell, v);
  });

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES['sf.Note'];
    cell.resize(def.width, def.height);
  });
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell, 'Node layer');

  // Footer
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderZoneProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || 'Zone';
  });

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => cell.attr('body/stroke', v));
  addColor(appearance, 'Fill',   cell.attr('body/fill'),   v => cell.attr('body/fill', v));

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES['sf.Zone'];
    cell.resize(def.width, def.height);
  });
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell, 'Zone layer');

  // Delete (in footer)
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderBpmnEventProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || 'Event';
  });
  addSelect(content, 'Event Type', cell.get('eventType') || 'start', [
    { value: 'start',        label: 'Start' },
    { value: 'intermediate', label: 'Intermediate' },
    { value: 'end',          label: 'End' },
  ], v => {
    cell.set('eventType', v);
    const sw = v === 'end' ? 3 : 2;
    cell.attr('body/strokeWidth', sw);
    if (v === 'intermediate') {
      cell.attr('innerRing/stroke', '#222222');
    } else {
      cell.attr('innerRing/stroke', 'none');
    }
  });

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill',   cell.attr('body/fill'),   v => {
    cell.attr('body/fill', v);
    const tc = contrastTextColor(v);
    if (tc) cell.attr('label/fill', tc);
  });
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => {
    cell.attr('body/stroke', v);
    cell.attr('innerRing/stroke', cell.get('eventType') === 'intermediate' ? v : 'none');
    cell.attr('icon/fill', v);
  });

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumber(size, 'Diameter', cell.size().width, v => cell.resize(v, v));
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell, 'Node layer');

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderBpmnTaskProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || 'Task';
  });
  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill',        cell.attr('body/fill'),   v => {
    cell.attr('body/fill', v);
    const tc = contrastTextColor(v);
    if (tc) cell.attr('label/fill', tc);
  });
  addColor(appearance, 'Border',      cell.attr('body/stroke'), v => cell.attr('body/stroke', v));
  addColor(appearance, 'Label color', cell.attr('label/fill'),  v => cell.attr('label/fill', v));
  addNumber(appearance, 'Corner radius', cell.attr('body/rx') ?? 8,
    v => { cell.attr('body/rx', v); cell.attr('body/ry', v); });

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES['sf.BpmnTask'];
    cell.resize(def.width, def.height);
  });
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell, 'Node layer');

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderBpmnGatewayProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || 'Gateway';
  });
  const markers = { exclusive: '\u00D7', parallel: '+', inclusive: '\u25CB', event: '\u25C7' };
  addSelect(content, 'Gateway Type', cell.get('gatewayType') || 'exclusive', [
    { value: 'exclusive', label: 'Exclusive (XOR)' },
    { value: 'parallel',  label: 'Parallel (AND)' },
    { value: 'inclusive',  label: 'Inclusive (OR)' },
    { value: 'event',     label: 'Event-based' },
  ], v => {
    cell.set('gatewayType', v);
    cell.attr('marker/text', markers[v] ?? '\u00D7');
  });

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill',   cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => cell.attr('body/stroke', v));

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumber(size, 'Size', cell.size().width, v => cell.resize(v, v));
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell, 'Node layer');

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderBpmnSubprocessProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || 'Subprocess';
  });

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill',   cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => cell.attr('body/stroke', v));

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES['sf.BpmnSubprocess'];
    cell.resize(def.width, def.height);
  });
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell, 'Container layer');

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderBpmnLoopProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || 'Loop';
  });

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill',   cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => cell.attr('body/stroke', v));

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES['sf.BpmnLoop'];
    cell.resize(def.width, def.height);
  });
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell, 'Container layer');

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderBpmnPoolProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || 'Pool';
  });

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill',        cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Border',      cell.attr('body/stroke'), v => cell.attr('body/stroke', v));
  addColor(appearance, 'Header fill', cell.attr('header/fill'), v => cell.attr('header/fill', v));
  addColor(appearance, 'Label color', cell.attr('label/fill'),  v => cell.attr('label/fill', v));

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell, 'Zone layer');

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderBpmnDataObjectProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || 'Data Object';
  });

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill',   cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => {
    cell.attr('body/stroke', v);
    cell.attr('fold/stroke', v);
  });

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell, 'Node layer');

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

// Common Salesforce field types for the type dropdown
const SF_FIELD_TYPES = [
  'Auto Number', 'Checkbox', 'Currency', 'Date', 'DateTime', 'Email',
  'Formula', 'ID', 'Lookup', 'Master-Detail', 'Number', 'Percent',
  'Phone', 'Picklist', 'Multi-Picklist', 'Rich Text Area',
  'Text', 'Text Area', 'Long Text Area', 'URL',
];

function renderDataObjectProps(cell) {
  // Object Name
  const content = section(bodyEl, 'Object');
  addText(content, 'Object Name', cell.get('objectName'), v => {
    cell.set('objectName', v);
    cell.attr('headerLabel/text', v);
    titleEl.textContent = v || 'Object';
  });
  addColor(content, 'Header Color', cell.get('headerColor') || '#1D73C9', v => {
    cell.set('headerColor', v);
    cell.attr('header/fill', v);
    cell.attr('headerCover/fill', v);
  });

  // Fields
  const fieldsSec = section(bodyEl, 'Fields');

  renderFieldEditor(fieldsSec, cell);

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumber(size, 'Width', cell.size().width, w => {
    cell.resize(w, cell.size().height);
  });
  addAutoSizeBtn(size, () => resizeDataObjectToFit(cell));
  addOrderButtons(size, cell, 'Node layer');

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderFieldEditor(parent, cell) {
  const fields = cell.get('fields') || [];
  const listEl = document.createElement('div');
  listEl.className = 'sf-field-list';

  function rebuild() {
    listEl.innerHTML = '';

    // Header row
    const hdr = document.createElement('div');
    hdr.className = 'sf-field-row sf-field-row--header';
    hdr.innerHTML = '<span>Key</span><span>API Name</span><span>Type</span><span></span>';
    listEl.appendChild(hdr);

    const currentFields = cell.get('fields') || [];
    currentFields.forEach((field, i) => {
      const row = document.createElement('div');
      row.className = 'sf-field-row';

      // Key type toggle
      const keyBtn = document.createElement('button');
      keyBtn.className = 'sf-field-key sf-field-key--' + (field.keyType || 'none');
      keyBtn.textContent = field.keyType === 'pk' ? 'PK' : field.keyType === 'fk' ? 'FK' : '—';
      keyBtn.title = 'Toggle key: None → PK → FK';
      keyBtn.addEventListener('click', () => {
        const cur = field.keyType;
        const next = cur === 'pk' ? 'fk' : cur === 'fk' ? null : 'pk';
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], keyType: next };
        cell.set('fields', updated);
        resizeDataObjectToFit(cell);
        rebuild();
      });

      // API Name input
      const apiInput = document.createElement('input');
      apiInput.type = 'text';
      apiInput.className = 'sf-field-input sf-field-input--api';
      apiInput.value = field.apiName || '';
      apiInput.placeholder = 'API Name';
      apiInput.addEventListener('input', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], apiName: apiInput.value };
        cell.set('fields', updated);
      });

      // Type select
      const typeSelect = document.createElement('select');
      typeSelect.className = 'sf-field-input sf-field-input--type';
      // Add current value if it's not in the list
      const allTypes = SF_FIELD_TYPES.includes(field.type) ? SF_FIELD_TYPES : [field.type, ...SF_FIELD_TYPES].filter(Boolean);
      allTypes.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        if (t === field.type) opt.selected = true;
        typeSelect.appendChild(opt);
      });
      typeSelect.addEventListener('change', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], type: typeSelect.value };
        cell.set('fields', updated);
      });

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'sf-field-delete';
      delBtn.textContent = '×';
      delBtn.title = 'Remove field';
      delBtn.addEventListener('click', () => {
        const updated = [...cell.get('fields')];
        updated.splice(i, 1);
        cell.set('fields', updated);
        resizeDataObjectToFit(cell);
        rebuild();
      });

      row.appendChild(keyBtn);
      row.appendChild(apiInput);
      row.appendChild(typeSelect);
      row.appendChild(delBtn);
      listEl.appendChild(row);
    });

    // Add field button
    const addBtn = document.createElement('button');
    addBtn.className = 'sf-properties__btn sf-properties__btn--add-field';
    addBtn.textContent = '+ Add Field';
    addBtn.addEventListener('click', () => {
      const updated = [...cell.get('fields'), { label: '', apiName: '', type: 'Text', keyType: null, length: '' }];
      cell.set('fields', updated);
      resizeDataObjectToFit(cell);
      rebuild();
    });
    listEl.appendChild(addBtn);

    // Edit in Table button
    const fullEditBtn = document.createElement('button');
    fullEditBtn.className = 'sf-properties__btn sf-properties__btn--full-edit';
    fullEditBtn.textContent = '⊞ Edit in Table';
    fullEditBtn.addEventListener('click', () => openFieldEditorModal(cell, rebuild));
    listEl.appendChild(fullEditBtn);
  }

  rebuild();
  parent.appendChild(listEl);
}

/* ── Full Edit Mode modal for DataObject fields ───────────── */

function openFieldEditorModal(cell, onClose) {
  // Remove any existing modal
  document.getElementById('field-editor-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'field-editor-modal';
  overlay.className = 'sf-modal';

  const fields = cell.get('fields') || [];

  overlay.innerHTML = `
    <div class="sf-modal__overlay sf-field-modal__backdrop"></div>
    <div class="sf-modal__dialog sf-field-modal__dialog">
      <div class="sf-modal__header">
        <h2 class="sf-modal__title">Edit Fields — ${cell.get('objectName') || 'Object'}</h2>
        <button class="sf-modal__close sf-field-modal__close" title="Close">✕</button>
      </div>
      <div class="sf-modal__body sf-field-modal__body"></div>
      <div class="sf-modal__footer sf-field-modal__footer">
        <button class="sf-properties__btn sf-properties__btn--add-field sf-field-modal__add">+ Add Field</button>
        <button class="sf-modal__btn sf-modal__btn--primary sf-field-modal__done">Done</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const bodyEl = overlay.querySelector('.sf-field-modal__body');

  function rebuildModal() {
    bodyEl.innerHTML = '';
    const currentFields = cell.get('fields') || [];

    // Header row
    const hdr = document.createElement('div');
    hdr.className = 'sf-field-modal__row sf-field-modal__row--header';
    hdr.innerHTML = '<span class="sf-field-modal__col--handle"></span><span class="sf-field-modal__col--key">Key</span><span class="sf-field-modal__col--api">API Name</span><span class="sf-field-modal__col--label">Label</span><span class="sf-field-modal__col--type">Type</span><span class="sf-field-modal__col--len">Length</span><span class="sf-field-modal__col--flag">Req</span><span class="sf-field-modal__col--flag">Decom</span><span class="sf-field-modal__col--del"></span>';
    bodyEl.appendChild(hdr);

    currentFields.forEach((field, i) => {
      const row = document.createElement('div');
      row.className = 'sf-field-modal__row';
      row.dataset.index = i;

      // Reorder handle
      const handle = document.createElement('span');
      handle.className = 'sf-field-modal__col--handle sf-field-modal__handle';
      handle.innerHTML = '⠿';
      handle.draggable = true;
      handle.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
        row.classList.add('sf-field-modal__row--dragging');
      });
      handle.addEventListener('dragend', () => row.classList.remove('sf-field-modal__row--dragging'));

      // Key toggle
      const keyBtn = document.createElement('button');
      keyBtn.className = 'sf-field-key sf-field-key--' + (field.keyType || 'none') + ' sf-field-modal__col--key';
      keyBtn.textContent = field.keyType === 'pk' ? 'PK' : field.keyType === 'fk' ? 'FK' : '—';
      keyBtn.title = 'Toggle key: None → PK → FK';
      keyBtn.addEventListener('click', () => {
        const next = field.keyType === 'pk' ? 'fk' : field.keyType === 'fk' ? null : 'pk';
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], keyType: next };
        cell.set('fields', updated);
        resizeDataObjectToFit(cell);
        rebuildModal();
      });

      // API Name
      const apiInput = document.createElement('input');
      apiInput.type = 'text';
      apiInput.className = 'sf-field-input sf-field-modal__col--api';
      apiInput.value = field.apiName || '';
      apiInput.placeholder = 'API Name';
      apiInput.addEventListener('input', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], apiName: apiInput.value };
        cell.set('fields', updated);
      });

      // Label
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'sf-field-input sf-field-modal__col--label';
      labelInput.value = field.label || '';
      labelInput.placeholder = 'Label';
      labelInput.addEventListener('input', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], label: labelInput.value };
        cell.set('fields', updated);
      });

      // Type
      const typeSelect = document.createElement('select');
      typeSelect.className = 'sf-field-input sf-field-modal__col--type';
      const allTypes = SF_FIELD_TYPES.includes(field.type) ? SF_FIELD_TYPES : [field.type, ...SF_FIELD_TYPES].filter(Boolean);
      allTypes.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        if (t === field.type) opt.selected = true;
        typeSelect.appendChild(opt);
      });
      typeSelect.addEventListener('change', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], type: typeSelect.value };
        cell.set('fields', updated);
      });

      // Length
      const lenInput = document.createElement('input');
      lenInput.type = 'text';
      lenInput.className = 'sf-field-input sf-field-modal__col--len';
      lenInput.value = field.length || '';
      lenInput.placeholder = '—';
      lenInput.addEventListener('input', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], length: lenInput.value };
        cell.set('fields', updated);
      });

      // Required checkbox
      const reqCheck = document.createElement('input');
      reqCheck.type = 'checkbox';
      reqCheck.className = 'sf-field-modal__check sf-field-modal__col--flag';
      reqCheck.checked = !!field.required;
      reqCheck.title = 'Required';
      reqCheck.addEventListener('change', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], required: reqCheck.checked };
        cell.set('fields', updated);
      });

      // Decommissioned checkbox
      const decomCheck = document.createElement('input');
      decomCheck.type = 'checkbox';
      decomCheck.className = 'sf-field-modal__check sf-field-modal__col--flag';
      decomCheck.checked = !!field.decommissioned;
      decomCheck.title = 'Decommissioned';
      decomCheck.addEventListener('change', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], decommissioned: decomCheck.checked };
        cell.set('fields', updated);
      });

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'sf-field-delete sf-field-modal__col--del';
      delBtn.textContent = '×';
      delBtn.title = 'Remove field';
      delBtn.addEventListener('click', () => {
        const updated = [...cell.get('fields')];
        updated.splice(i, 1);
        cell.set('fields', updated);
        resizeDataObjectToFit(cell);
        rebuildModal();
      });

      row.appendChild(handle);
      row.appendChild(keyBtn);
      row.appendChild(apiInput);
      row.appendChild(labelInput);
      row.appendChild(typeSelect);
      row.appendChild(lenInput);
      row.appendChild(reqCheck);
      row.appendChild(decomCheck);
      row.appendChild(delBtn);

      // Drop zone for reorder — show indicator line above or below
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        // Determine if dropping above or below center of row
        const rect = row.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        // Clear previous indicators on all rows
        bodyEl.querySelectorAll('.sf-field-modal__row').forEach(r => {
          r.classList.remove('sf-field-modal__row--drop-above', 'sf-field-modal__row--drop-below');
        });
        if (e.clientY < mid) {
          row.classList.add('sf-field-modal__row--drop-above');
        } else {
          row.classList.add('sf-field-modal__row--drop-below');
        }
      });
      row.addEventListener('dragleave', (e) => {
        // Only remove if leaving the row entirely
        if (!row.contains(e.relatedTarget)) {
          row.classList.remove('sf-field-modal__row--drop-above', 'sf-field-modal__row--drop-below');
        }
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const rect = row.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        const dropBelow = e.clientY >= mid;
        bodyEl.querySelectorAll('.sf-field-modal__row').forEach(r => {
          r.classList.remove('sf-field-modal__row--drop-above', 'sf-field-modal__row--drop-below');
        });
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
        let toIdx = dropBelow ? i + 1 : i;
        if (fromIdx === toIdx || fromIdx + 1 === toIdx) { /* no-op: same position */ return; }
        const updated = [...cell.get('fields')];
        const [moved] = updated.splice(fromIdx, 1);
        // Adjust target index after removal
        if (fromIdx < toIdx) toIdx--;
        updated.splice(toIdx, 0, moved);
        cell.set('fields', updated);
        resizeDataObjectToFit(cell);
        rebuildModal();
      });

      bodyEl.appendChild(row);
    });
  }

  rebuildModal();

  // Add field
  overlay.querySelector('.sf-field-modal__add').addEventListener('click', () => {
    const updated = [...cell.get('fields'), { label: '', apiName: '', type: 'Text', keyType: null, length: '' }];
    cell.set('fields', updated);
    resizeDataObjectToFit(cell);
    rebuildModal();
  });

  // Close handlers
  function close() {
    overlay.remove();
    if (onClose) onClose();
  }
  overlay.querySelector('.sf-field-modal__backdrop').addEventListener('click', close);
  overlay.querySelector('.sf-field-modal__close').addEventListener('click', close);
  overlay.querySelector('.sf-field-modal__done').addEventListener('click', close);
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

function renderFlowShapeProps(cell) {
  const type = cell.get('type');
  const typeLabel = TYPE_LABELS[type] || 'Shape';

  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || typeLabel;
  });

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill',        cell.attr('body/fill'),   v => {
    cell.attr('body/fill', v);
    const tc = contrastTextColor(v);
    if (tc) cell.attr('label/fill', tc);
  });
  addColor(appearance, 'Border',      cell.attr('body/stroke'), v => {
    cell.attr('body/stroke', v);
    // Sync internal strokes for compound shapes
    if (type === 'sf.FlowDatabase') cell.attr('top/stroke', v);
    if (type === 'sf.FlowPredefined') {
      cell.attr('lineLeft/stroke', v);
      cell.attr('lineRight/stroke', v);
    }
  });
  addColor(appearance, 'Label color', cell.attr('label/fill'),  v => cell.attr('label/fill', v));

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES[type];
    if (def) cell.resize(def.width, def.height);
  });
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell, 'Node layer');

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderAnnotationProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addTextarea(content, 'Text', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || 'Annotation';
  });

  // Bracket side
  const currentSide = cell.get('bracketSide') || 'left';
  addSelect(content, 'Bracket Side', currentSide, [
    { value: 'left',  label: 'Left' },
    { value: 'right', label: 'Right' },
  ], v => {
    cell.set('bracketSide', v);
    if (v === 'right') {
      // Bracket { on right edge, text on left
      cell.attr('bracket/d', 'M calc(w) 0 Q calc(w - 12) 0 calc(w - 12) calc(0.25 * h) L calc(w - 12) calc(0.45 * h) Q calc(w - 12) calc(0.5 * h) calc(w - 16) calc(0.5 * h) Q calc(w - 12) calc(0.5 * h) calc(w - 12) calc(0.55 * h) L calc(w - 12) calc(0.75 * h) Q calc(w - 12) calc(h) calc(w) calc(h)');
      cell.attr('label/x', 0);
      cell.attr('label/textAnchor', 'start');
      cell.attr('label/textWrap', { width: 'calc(w - 18)', maxLineCount: 6, ellipsis: true });
    } else {
      // Bracket } on left edge, text on right
      cell.attr('bracket/d', 'M 0 0 Q 12 0 12 calc(0.25 * h) L 12 calc(0.45 * h) Q 12 calc(0.5 * h) 16 calc(0.5 * h) Q 12 calc(0.5 * h) 12 calc(0.55 * h) L 12 calc(0.75 * h) Q 12 calc(h) 0 calc(h)');
      cell.attr('label/x', 18);
      cell.attr('label/textAnchor', 'start');
      cell.attr('label/textWrap', { width: 'calc(w - 18)', maxLineCount: 6, ellipsis: true });
    }
  });

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Bracket color', cell.attr('bracket/stroke'), v => cell.attr('bracket/stroke', v));
  addColor(appearance, 'Text color',    cell.attr('label/fill'),     v => cell.attr('label/fill', v));

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES['sf.Annotation'];
    cell.resize(def.width, def.height);
  });
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell, 'Node layer');

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

// ── Gantt shape renderers ──────────────────────────────────────────

function renderGanttTaskProps(cell) {
  // Content
  const content = section(bodyEl, 'Task');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    cell.set('taskLabel', v);
    titleEl.textContent = v || 'Task';
  });
  // Only show progress input if showProgress is enabled
  if (cell.get('showProgress') !== false) {
    addNumber(content, 'Progress (%)', cell.get('progress') ?? 0, v => {
      cell.set('progress', Math.max(0, Math.min(100, v)));
    });
  }
  // Only show assignee input if showAssignee is enabled
  if (cell.get('showAssignee') !== false) {
    addText(content, 'Assignee', cell.get('assignee') || '', v => {
      cell.set('assignee', v);
      cell.attr('assigneeLabel/text', v);
    });
  }

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Completion Bar', cell.attr('progressBar/fill') || '#1D73C9', v => {
    cell.attr('progressBar/fill', v);
  });
  addColor(appearance, 'Text', cell.get('userTextColor') || cell.attr('label/fill') || '#FFFFFF', v => {
    cell.set('userTextColor', v);
    cell.attr('label/fill', v);
    cell.attr('percentLabel/fill', v);
    cell.attr('assigneeLabel/fill', v);
  });
  addColor(appearance, 'Background', cell.attr('body/fill') || 'var(--node-bg)', v => {
    cell.attr('body/fill', v);
  });
  addColor(appearance, 'Border', cell.attr('body/stroke') || 'var(--node-border)', v => {
    cell.attr('body/stroke', v);
  });

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width', cell.size().width, w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES['sf.GanttTask'];
    cell.resize(def.width, def.height);
  });
  addOrderButtons(size, cell, 'Node layer');

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderGanttMilestoneProps(cell) {
  // Content
  const content = section(bodyEl, 'Milestone');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || 'Milestone';
  });
  addDate(content, 'Date', cell.get('milestoneDate') || '', v => cell.set('milestoneDate', v));

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill', cell.attr('body/fill') || '#F6B355', v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke') || '#D4942A', v => cell.attr('body/stroke', v));
  addColor(appearance, 'Label color', cell.attr('label/fill'), v => cell.attr('label/fill', v));

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumber(size, 'Size', cell.size().width, v => cell.resize(v, v));
  addOrderButtons(size, cell, 'Node layer');

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderGanttTimelineProps(cell) {
  const viewMode = cell.get('viewMode') || 'week';
  const periodLabel = viewMode === 'day' ? 'days' : viewMode === 'week' ? 'weeks' : 'months';

  // Title & Description
  const titleSec = section(bodyEl, 'Content');
  addText(titleSec, 'Title', cell.get('timelineTitle') || 'Tasks', v => {
    cell.set('timelineTitle', v);
  });
  addTextarea(titleSec, 'Description', cell.get('timelineDescription') || '', v => {
    cell.set('timelineDescription', v);
  });

  // Helper: calculate end date from start + periods
  function calcEndDate(startStr, periods, mode) {
    if (!startStr) return '';
    const d = new Date(startStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    if (mode === 'day') {
      d.setDate(d.getDate() + periods);
    } else if (mode === 'week') {
      d.setDate(d.getDate() + periods * 7);
    } else {
      d.setMonth(d.getMonth() + periods);
    }
    return d.toISOString().slice(0, 10);
  }

  // Helper: calculate periods from start to end
  function calcPeriods(startStr, endStr, mode) {
    if (!startStr || !endStr) return null;
    const s = new Date(startStr + 'T00:00:00');
    const e = new Date(endStr + 'T00:00:00');
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return null;
    if (mode === 'day') {
      return Math.max(1, Math.ceil((e - s) / 86400000) + 1);
    } else if (mode === 'week') {
      return Math.max(1, Math.ceil((e - s) / (7 * 86400000)));
    } else {
      return Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()));
    }
  }

  // Timeline settings
  const content = section(bodyEl, 'Timeline');

  // Start Date — changing it recalculates end date from periods
  addDate(content, 'Start Date', cell.get('startDate') || '', v => {
    cell.set('startDate', v);
    const end = calcEndDate(v, cell.get('numPeriods') || 12, cell.get('viewMode') || 'week');
    if (end) cell.set('endDate', end, { silent: true });
    showProperties(cell);
  });

  // End Date — changing it recalculates periods and resizes to keep column width constant
  addDate(content, 'End Date', cell.get('endDate') || calcEndDate(cell.get('startDate'), cell.get('numPeriods') || 12, viewMode), v => {
    cell.set('endDate', v);
    const oldPeriods = cell.get('numPeriods') || 12;
    const taskListW = (cell.get('tasks') || []).length ? (cell.get('taskListWidth') || 200) : 0;
    const currentWidth = cell.size().width;
    const timelineW = currentWidth - taskListW;
    const colW = timelineW / oldPeriods;
    const p = calcPeriods(cell.get('startDate'), v, cell.get('viewMode') || 'week');
    if (p) {
      const clamped = Math.max(2, Math.min(104, p));
      cell.set('numPeriods', clamped);
      const newWidth = Math.round(taskListW + colW * clamped);
      cell.resize(newWidth, cell.size().height);
    }
    showProperties(cell);
  });

  // Periods — number input with non-editable unit suffix
  addNumberWithSuffix(content, 'Periods', cell.get('numPeriods') || 12, periodLabel, v => {
    const clamped = Math.max(2, Math.min(104, v));
    const oldPeriods = cell.get('numPeriods') || 12;
    const taskListW = (cell.get('tasks') || []).length ? (cell.get('taskListWidth') || 200) : 0;
    const currentWidth = cell.size().width;
    const timelineW = currentWidth - taskListW;
    const colW = timelineW / oldPeriods;
    // Resize timeline to keep period width constant
    const newWidth = Math.round(taskListW + colW * clamped);
    cell.set('numPeriods', clamped);
    cell.resize(newWidth, cell.size().height);
    const end = calcEndDate(cell.get('startDate'), clamped, cell.get('viewMode') || 'week');
    if (end) cell.set('endDate', end, { silent: true });
    showProperties(cell);
  });

  // ── Tasks section ──
  const tasksSec = section(bodyEl, 'Tasks');
  renderTimelineTaskEditor(tasksSec, cell);

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Background', cell.attr('body/fill') || 'var(--bg-surface-raised)', v => {
    cell.attr('body/fill', v);
  });
  addColor(appearance, 'Top Row', cell.attr('topRow/fill') || 'var(--node-bg)', v => {
    cell.attr('topRow/fill', v);
  });
  addColor(appearance, 'Border', cell.attr('body/stroke') || 'var(--node-border)', v => {
    cell.attr('body/stroke', v);
    cell.attr('divider/stroke', v);
  });

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumber(size, 'Width', cell.size().width, w => cell.resize(w, cell.size().height));
  addOrderButtons(size, cell, 'Container layer');

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderGanttGroupProps(cell) {
  // Content
  const content = section(bodyEl, 'Phase');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || 'Phase';
  });

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Bar Color', cell.attr('body/fill') || '#2A2D32', v => {
    cell.attr('body/fill', v);
    cell.attr('leftProng/fill', v);
    cell.attr('rightProng/fill', v);
  });
  addColor(appearance, 'Label color', cell.attr('label/fill'), v => cell.attr('label/fill', v));

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumber(size, 'Width', cell.size().width, w => cell.resize(w, cell.size().height));
  addOrderButtons(size, cell, 'Container layer');

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderOrgPersonProps(cell) {
  // Person Info
  const info = section(bodyEl, 'Person');
  addText(info, 'Name', cell.get('personName') || '', v => {
    cell.set('personName', v);
    titleEl.textContent = v || 'Person';
  });
  addText(info, 'Position', cell.get('jobTitle') || '', v => cell.set('jobTitle', v));

  // Image / Avatar section
  const imageSec = section(bodyEl, 'Image');

  // Icon Text input (up to 4 characters)
  addText(imageSec, 'Icon Text', cell.get('iconText') || '', v => {
    cell.set('iconText', v.substring(0, 4));
  });

  // Photo upload
  const photoField = document.createElement('div');
  photoField.className = 'sf-prop-field';
  const photoLabel = document.createElement('div');
  photoLabel.className = 'sf-properties__label';
  photoLabel.textContent = 'Photo';

  const photoControls = document.createElement('div');
  photoControls.className = 'sf-prop-pair';

  const hasImage = !!cell.get('imageUrl');

  const ICON_UPLOAD = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v10M3 8h10"/></svg>`;
  const ICON_CHANGE = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4h11l-3-3M15 12H4l3 3"/></svg>`;
  const ICON_REMOVE = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h10M6 4V2.5A.5.5 0 016.5 2h3a.5.5 0 01.5.5V4M4.5 4l.5 9.5h6l.5-9.5"/></svg>`;

  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'sf-properties__btn sf-properties__btn--order';
  uploadBtn.innerHTML = hasImage ? `${ICON_CHANGE} Change` : `${ICON_UPLOAD} Upload`;

  const clearBtn = document.createElement('button');
  clearBtn.className = 'sf-properties__btn sf-properties__btn--order';
  clearBtn.innerHTML = `${ICON_REMOVE} Remove`;

  // Full-width upload when no image, 50/50 pair when image exists
  function updatePhotoLayout(show) {
    if (show) {
      photoControls.style.gridTemplateColumns = '1fr 1fr';
      clearBtn.style.display = '';
    } else {
      photoControls.style.gridTemplateColumns = '1fr';
      clearBtn.style.display = 'none';
    }
  }
  updatePhotoLayout(hasImage);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      cell.set('imageUrl', reader.result);
      uploadBtn.innerHTML = `${ICON_CHANGE} Change`;
      updatePhotoLayout(true);
    };
    reader.readAsDataURL(file);
  });

  uploadBtn.addEventListener('click', () => fileInput.click());
  clearBtn.addEventListener('click', () => {
    cell.set('imageUrl', '');
    uploadBtn.innerHTML = `${ICON_UPLOAD} Upload`;
    updatePhotoLayout(false);
  });

  photoControls.appendChild(uploadBtn);
  photoControls.appendChild(clearBtn);
  photoControls.appendChild(fileInput);
  photoField.appendChild(photoLabel);
  photoField.appendChild(photoControls);
  imageSec.appendChild(photoField);

  // Detail fields with reorderable list
  const DETAIL_FIELDS = {
    email:    'Email',
    phone:    'Phone',
    role:     'Role',
    stream:   'Stream',
    location: 'Location',
    company:  'Company',
  };

  const detailSec = section(bodyEl, 'Details');

  // Build reorderable detail rows
  function buildDetailList() {
    // Remove old detail rows
    detailSec.querySelectorAll('.sf-detail-row').forEach(r => r.remove());

    const currentOrder = cell.get('detailOrder') || Object.keys(DETAIL_FIELDS);
    currentOrder.forEach((key, idx) => {
      const row = document.createElement('div');
      row.className = 'sf-detail-row';
      row.draggable = true;
      row.dataset.key = key;

      // Drag handle
      const handle = document.createElement('span');
      handle.className = 'sf-detail-row__handle';
      handle.innerHTML = '⠿';
      handle.title = 'Drag to reorder';
      row.appendChild(handle);

      // Label
      const label = document.createElement('label');
      label.className = 'sf-properties__label';
      label.textContent = DETAIL_FIELDS[key] || key;
      label.style.minWidth = '56px';
      row.appendChild(label);

      // Input
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'sf-properties__input';
      input.value = cell.get(key) || '';
      input.addEventListener('input', () => cell.set(key, input.value));
      row.appendChild(input);

      // Drag events
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('sf-detail-row--dragging');
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('sf-detail-row--dragging');
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('sf-detail-row--over');
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('sf-detail-row--over');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('sf-detail-row--over');
        const draggedKey = detailSec.querySelector('.sf-detail-row--dragging')?.dataset.key;
        if (!draggedKey || draggedKey === key) return;
        const order = [...(cell.get('detailOrder') || Object.keys(DETAIL_FIELDS))];
        const fromIdx = order.indexOf(draggedKey);
        const toIdx = order.indexOf(key);
        if (fromIdx === -1 || toIdx === -1) return;
        order.splice(fromIdx, 1);
        order.splice(toIdx, 0, draggedKey);
        cell.set('detailOrder', order);
        buildDetailList();
      });

      detailSec.appendChild(row);
    });
  }
  buildDetailList();

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Accent Color', cell.attr('accentBar/fill') || '#1D73C9', v => {
    cell.attr('accentBar/fill', v);
    cell.attr('accentBarMask/fill', v);
  });

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addAutoSizeBtn(size, () => {
    // Reset height to minimum — _updateCard will auto-calculate correct height
    cell.resize(cell.size().width, 1, { silent: true });
    const view = paper.findViewByModel(cell);
    if (view?.update) view.update();
    // Notify handles/ports of final size
    cell.trigger('change:size');
  });
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell, 'Node layer');

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderLinkProps(cell) {
  // Label
  const labelSec = section(bodyEl, 'Label');
  const currentLabel = cell.labels()?.[0]?.attrs?.text?.text ?? '';
  const currentLabelSize = cell.labels()?.[0]?.attrs?.text?.fontSize ?? 13;
  addText(labelSec, 'Text', currentLabel, v => {
    const fontSize = cell.labels()?.[0]?.attrs?.text?.fontSize ?? 13;
    const lineColor = cell.attr('line/stroke') || '#888888';
    cell.labels([]);
    if (v) {
      cell.appendLabel({
        markup: [
          { tagName: 'rect', selector: 'body' },
          { tagName: 'text', selector: 'text' },
        ],
        attrs: {
          text: { text: v, fill: lineColor, fontSize, fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', textAnchor: 'middle', textVerticalAnchor: 'middle' },
          body: { ref: 'text', refWidth: 12, refHeight: 4, refX: -6, refY: -2, fill: 'var(--bg-canvas, #FFFFFF)', stroke: 'none', rx: 2, ry: 2 },
        },
        position: { distance: 0.5, offset: 0 },
      });
    }
    titleEl.textContent = v || 'Unnamed';
  });
  addNumber(labelSec, 'Text size', currentLabelSize, v => {
    const labels = cell.labels();
    if (labels.length > 0) {
      cell.label(0, { attrs: { text: { fontSize: Math.max(8, Math.min(24, v)) } } });
    }
  });

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Color', cell.attr('line/stroke') ?? '#888888',
    v => {
      // Full attrs replacement with sync rendering for Safari compatibility.
      // Arrow markers (no explicit fill/stroke) auto-inherit from line stroke.
      // ER markers with explicit stroke need manual sync.
      const allAttrs = JSON.parse(JSON.stringify(cell.get('attrs') || {}));
      if (!allAttrs.line) allAttrs.line = {};
      allAttrs.line.stroke = v;
      const sm = allAttrs.line.sourceMarker;
      if (sm && sm.stroke && sm.stroke !== 'none') sm.stroke = v;
      const tm = allAttrs.line.targetMarker;
      if (tm && tm.stroke && tm.stroke !== 'none') tm.stroke = v;
      cell.set('attrs', allAttrs);
      paper.updateViews();
      // Safari SVG marker cache workaround
      const view = paper.findViewByModel(cell);
      if (view?.el?.parentNode) {
        const parent = view.el.parentNode;
        const next = view.el.nextSibling;
        parent.removeChild(view.el);
        if (next) parent.insertBefore(view.el, next);
        else parent.appendChild(view.el);
      }
    });
  addNumber(appearance, 'Stroke width', cell.attr('line/strokeWidth') ?? 2,
    v => cell.attr('line/strokeWidth', v));
  addSelect(appearance, 'Line style', cell.attr('line/strokeDasharray') || 'none', [
    { value: 'none', label: 'Solid' },
    { value: '8 4',  label: 'Dashed' },
    { value: '2 4',  label: 'Dotted' },
  ], v => cell.attr('line/strokeDasharray', v === 'none' ? null : v));
  const stroke = cell.attr('line/stroke') || '#333333';
  // ER crow's foot markers — negative-x convention (toward element).
  // Crow's foot prongs fan out toward negative-x (toward the entity).
  // Explicit fill/stroke is set because ER markers are open paths (no
  // auto-inheritance from line).
  const markerDefs = {
    // None: simple stub line extending toward element (fills the connectionPoint gap)
    none:        { type: 'path', d: 'M 0 0 L -12 0', fill: 'none', stroke: stroke, 'stroke-width': 2 },
    // Arrow: NO explicit fill/stroke — JointJS auto-inherits from line stroke
    // and auto-trims the line at the marker boundary. Using JointJS native
    // coordinate convention: tip at negative-x, base at x=0.
    arrow:       { type: 'path', d: 'M 0 -6 L -14 0 L 0 6 z' },
    // ── ER notation (negative-x = toward element, positive-x = toward link) ──
    // One: bar at entity end (x=-12) + stem back to line (x=0)
    one:         { type: 'path', d: 'M -12 -8 L -12 8 M -12 0 L 0 0', fill: 'none', stroke: stroke, 'stroke-width': 2 },
    // Zero-or-One: circle (line side, edge at x=2) → connecting line → bar at x=-12 (entity side)
    zeroOne:     { type: 'path', d: 'M 2 0 a 5 5 0 1 1 -10 0 a 5 5 0 1 1 10 0 Z M -8 0 L -12 0 M -12 -8 L -12 8', fill: 'var(--bg-canvas, #1A1A1A)', stroke: stroke, 'stroke-width': 2 },
    // Many: crow's foot — 3 prongs fan toward element
    many:        { type: 'path', d: 'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0', fill: 'none', stroke: stroke, 'stroke-width': 2 },
    // One-or-Many: bar (line side) → crow's foot (entity side)
    oneMany:     { type: 'path', d: 'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0 M 3 -8 L 3 8', fill: 'none', stroke: stroke, 'stroke-width': 2 },
    // Zero-or-Many: circle (link side, 4px gap, bg-filled) → crow's foot (entity side, identical to many)
    zeroMany:    { type: 'path', d: 'M 4 0 a 5 5 0 1 1 10 0 a 5 5 0 1 1 -10 0 Z M -12 -8 L 0 0 M 0 0 L -12 8 M 0 0 L -12 0', fill: 'var(--bg-canvas, #1A1A1A)', stroke: stroke, 'stroke-width': 2 },
  };
  const markerOpts = [
    { value: 'none',      label: 'None' },
    { value: 'arrow',     label: 'Arrow' },
    { value: 'one',       label: 'One (1)' },
    { value: 'zeroOne',   label: 'Zero or One (0..1)' },
    { value: 'many',      label: 'Many (N)' },
    { value: 'oneMany',   label: 'One or Many (1..N)' },
    { value: 'zeroMany',  label: 'Zero or Many (0..N)' },
  ];
  function detectMarker(markerAttr) {
    if (!markerAttr) return 'none';
    const d = markerAttr.d ?? '';
    if (!d) return 'none';
    // Arrow: closed path with 'z'
    if (d.includes('z')) return 'arrow';
    // Crow's foot detection: has "L 0 0" vertex AND prong "L -12 8", or old format "L 12 0"
    const isCrowFoot = (d.includes('L 0 0') && /L\s*-12\s+8/.test(d)) || d.includes('L 12 0');
    const hasCircle = /a [345] [345]/.test(d);
    // Most specific first
    if (isCrowFoot && hasCircle) return 'zeroMany';
    if (isCrowFoot && /M [3-9] -8|M -?15/.test(d)) return 'oneMany';
    if (isCrowFoot) return 'many';
    if (hasCircle) return 'zeroOne';
    if (/M\s*-?\d+\s+-8\s*L\s*-?\d+\s+8/.test(d)) return 'one';
    return 'none';
  }
  function applyMarker(cell, markerKey, def) {
    // Build the full replacement attrs object — deep clone to break all references.
    const allAttrs = JSON.parse(JSON.stringify(cell.get('attrs') || {}));
    if (!allAttrs.line) allAttrs.line = {};
    if (def) {
      allAttrs.line[markerKey] = def;
    } else {
      delete allAttrs.line[markerKey];
    }
    cell.set('attrs', allAttrs);
    // Flush JointJS async view update queue synchronously.
    paper.updateViews();
    // Safari SVG marker cache workaround: Safari caches marker renderings
    // and doesn't repaint when <marker> content changes. Re-inserting the
    // link's SVG group element into the DOM forces a full re-render.
    const view = paper.findViewByModel(cell);
    if (view?.el?.parentNode) {
      const parent = view.el.parentNode;
      const next = view.el.nextSibling;
      parent.removeChild(view.el);
      if (next) parent.insertBefore(view.el, next);
      else parent.appendChild(view.el);
    }
  }
  // SVG thumbnails (36×18 viewBox, 0.8× scale from marker coords).
  // Mapping: connection point at x=20, thumb_x = 20 - marker_x * 0.8, thumb_y = 9 + marker_y * 0.8.
  // Entity side = right.  Marker elements at stroke-width 2, lead line at 1.5.
  const markerSvgs = {
    none:      '<line x1="2" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="2"/>',
    arrow:     '<line x1="2" y1="9" x2="20" y2="9" stroke="currentColor" stroke-width="1.5"/><path d="M 20 4 L 31 9 L 20 14 Z" fill="currentColor"/>',
    one:       '<line x1="2" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="2"/><line x1="30" y1="3" x2="30" y2="15" stroke="currentColor" stroke-width="2"/>',
    zeroOne:   '<line x1="2" y1="9" x2="18" y2="9" stroke="currentColor" stroke-width="1.5"/><circle cx="22" cy="9" r="4" fill="var(--bg-canvas, #1A1A1A)" stroke="currentColor" stroke-width="2"/><line x1="26" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="2"/><line x1="30" y1="3" x2="30" y2="15" stroke="currentColor" stroke-width="2"/>',
    many:      '<line x1="2" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="1.5"/><path d="M 30 3 L 20 9 L 30 15" fill="none" stroke="currentColor" stroke-width="2"/>',
    oneMany:   '<line x1="2" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="1.5"/><line x1="18" y1="3" x2="18" y2="15" stroke="currentColor" stroke-width="2"/><path d="M 30 3 L 20 9 L 30 15" fill="none" stroke="currentColor" stroke-width="2"/>',
    zeroMany:  '<line x1="2" y1="9" x2="9" y2="9" stroke="currentColor" stroke-width="1.5"/><circle cx="13" cy="9" r="4" fill="var(--bg-canvas, #1A1A1A)" stroke="currentColor" stroke-width="2"/><line x1="17" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="1.5"/><path d="M 30 3 L 20 9 L 30 15" fill="none" stroke="currentColor" stroke-width="2"/>',
  };
  addMarkerPicker(appearance, 'Source end', detectMarker(cell.attr('line/sourceMarker')), markerOpts, markerSvgs, v => {
    applyMarker(cell, 'sourceMarker', markerDefs[v]);
  });
  addMarkerPicker(appearance, 'Target end', detectMarker(cell.attr('line/targetMarker')), markerOpts, markerSvgs, v => {
    applyMarker(cell, 'targetMarker', markerDefs[v]);
  });

  // Simplify path button
  const simplifyBtn = document.createElement('button');
  simplifyBtn.className = 'sf-properties__btn sf-properties__btn--auto-size';
  simplifyBtn.style.marginTop = '6px';
  simplifyBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M2 13 L14 3" stroke-linecap="round"/>
      <circle cx="2" cy="13" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="14" cy="3" r="1.5" fill="currentColor" stroke="none"/>
    </svg>
    Simplify path`;
  simplifyBtn.addEventListener('click', () => {
    cell.vertices([]);
    cell.connector('rounded', { radius: 8 });
  });
  appearance.appendChild(simplifyBtn);

  // Delete (in footer)
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

// ── Accordion section builder ───────────────────────────────────────

function section(parent, title, open = true) {
  const wrap = document.createElement('div');
  wrap.className = 'sf-section' + (open ? '' : ' sf-section--collapsed');

  const hdr = document.createElement('div');
  hdr.className = 'sf-section__header';
  hdr.innerHTML = `
    <span>${title}</span>
    <svg class="sf-section__chevron" viewBox="0 0 10 6" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 0 L5 6 L10 0 Z"/>
    </svg>`;
  hdr.addEventListener('click', () => wrap.classList.toggle('sf-section--collapsed'));

  const body = document.createElement('div');
  body.className = 'sf-section__body';

  wrap.appendChild(hdr);
  wrap.appendChild(body);
  parent.appendChild(wrap);
  return body;
}

// ── Order buttons (inlined into Size & Order section) ─────────────
// Bring to Front / Send to Back operate WITHIN the element's z-tier
// so that type-based layering (Zone < Container < Node) is never violated.

function addOrderButtons(sec, cell, layerLabel) {
  // Layer label
  const hint = document.createElement('div');
  hint.className = 'sf-prop-order-hint';
  hint.textContent = `Layer: ${layerLabel}`;
  sec.appendChild(hint);

  const btnRow = document.createElement('div');
  btnRow.className = 'sf-prop-pair';

  const type = cell.get('type');
  const tierBase = Z_BASE[type] ?? 20000;
  const tierMax  = tierBase + Z_TIER_SPAN;

  function sameTierElements() {
    return graph.getElements().filter(
      el => el !== cell && el.get('z') >= tierBase && el.get('z') < tierMax
    );
  }

  // Bring to Front
  const frontBtn = document.createElement('button');
  frontBtn.className = 'sf-properties__btn sf-properties__btn--order';
  frontBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 2h12v2H2zM4 6h8v2H4zM6 10h4v4H6z"/>
    </svg>
    Bring to Front`;
  frontBtn.title = `Bring to front within ${layerLabel}`;
  frontBtn.addEventListener('click', () => {
    const peers = sameTierElements();
    const maxZ = peers.length
      ? Math.max(...peers.map(el => el.get('z') ?? tierBase))
      : tierBase;
    cell.set('z', maxZ + 1);
  });

  // Send to Back
  const backBtn = document.createElement('button');
  backBtn.className = 'sf-properties__btn sf-properties__btn--order';
  backBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 2h4v4H6zM4 8h8v2H4zM2 12h12v2H2z"/>
    </svg>
    Send to Back`;
  backBtn.title = `Send to back within ${layerLabel}`;
  backBtn.addEventListener('click', () => {
    const peers = sameTierElements();
    const minZ = peers.length
      ? Math.min(...peers.map(el => el.get('z') ?? tierBase))
      : tierBase;
    cell.set('z', Math.max(tierBase, minZ - 1));
  });

  btnRow.appendChild(frontBtn);
  btnRow.appendChild(backBtn);
  sec.appendChild(btnRow);
}

// ── Standalone convert button (not inside accordion) ───────────────

function addActionBtn(parent, label, onClick) {
  const wrap = document.createElement('div');
  wrap.className = 'sf-convert-strip';
  const btn = document.createElement('button');
  btn.className = 'sf-properties__btn sf-properties__btn--convert';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  wrap.appendChild(btn);
  parent.appendChild(wrap);
}

function addConvertBtn(parent, label, onClick) {
  const wrap = document.createElement('div');
  wrap.className = 'sf-convert-strip';
  const btn = document.createElement('button');
  btn.className = 'sf-properties__btn sf-properties__btn--convert';
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1 4h11l-3-3M15 12H4l3 3"/>
  </svg> ${label}`;
  btn.addEventListener('click', onClick);
  wrap.appendChild(btn);
  parent.appendChild(wrap);
}

// ── Clone button ────────────────────────────────────────────────────

function addCloneBtn(parent, cell) {
  const wrap = document.createElement('div');
  wrap.className = 'sf-clone-strip';
  const btn = document.createElement('button');
  btn.className = 'sf-properties__btn sf-properties__btn--clone';
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="5" y="5" width="9" height="9" rx="2"/>
    <path d="M3 11H2.5A1.5 1.5 0 011 9.5V2.5A1.5 1.5 0 012.5 1h7A1.5 1.5 0 0111 2.5V3"/>
  </svg> Clone`;
  btn.addEventListener('click', () => {
    const clone = cell.clone();
    const pos = cell.position();
    const size = cell.size();
    clone.position(pos.x + size.width + 16, pos.y);
    clone.unset('parent');
    clone.unset('embeds');
    graph.addCell(clone);
    selection.selectOnly(clone.id);
  });
  wrap.appendChild(btn);
  parent.appendChild(wrap);
}

// ── Delete button (red, bottom of panel) ─────────────────────────────

function addDeleteBtn(parent, onClick) {
  const wrap = document.createElement('div');
  wrap.className = 'sf-delete-strip';
  const btn = document.createElement('button');
  btn.className = 'sf-properties__btn sf-properties__btn--delete';
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 4h10M6 4V2.5A.5.5 0 016.5 2h3a.5.5 0 01.5.5V4M4.5 4l.5 9.5h6l.5-9.5M7 7v4M9 7v4"/>
  </svg> Delete`;
  btn.addEventListener('click', onClick);
  wrap.appendChild(btn);
  parent.appendChild(wrap);
}

// ── Field builders ──────────────────────────────────────────────────

function field(parent, label) {
  const f = document.createElement('div');
  f.className = 'sf-prop-field';
  if (label) {
    const l = document.createElement('div');
    l.className = 'sf-properties__label';
    l.textContent = label;
    f.appendChild(l);
  }
  parent.appendChild(f);
  return f;
}

function addText(parent, label, value, onChange, cell) {
  const f = field(parent, label);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'sf-properties__input';
  input.value = value ?? '';
  input.addEventListener('input', () => onChange(input.value));
  // Highlight label on canvas when editing (auto-detect cell from selection if not passed)
  const targetCell = cell || getActiveCell();
  if (targetCell) wireCanvasLabelHighlight(input, targetCell);
  f.appendChild(input);
}

/** Get the currently selected single cell */
function getActiveCell() {
  const ids = selection.getSelectedIds();
  if (ids.length !== 1) return null;
  return graph.getCell(ids[0]) || null;
}

/** Show a red blinking caret on the canvas label when the input is focused */
function wireCanvasLabelHighlight(input, cell) {
  let caretEl = null;

  function getLabelTextEl() {
    const view = paper.findViewByModel(cell);
    if (!view) return null;
    return view.el.querySelector('text[joint-selector="label"]')
        || view.el.querySelector('text[joint-selector="headerLabel"]');
  }

  function updateCaret() {
    const textEl = getLabelTextEl();
    if (!textEl || !caretEl) return;

    const pos = input.selectionStart ?? 0;
    const text = textEl.textContent || '';

    try {
      let x, y, h;
      const numChars = textEl.getNumberOfChars();
      if (numChars === 0 || text.length === 0) {
        const box = textEl.getBBox();
        x = box.x; y = box.y; h = box.height || 14;
      } else {
        const charIdx = Math.min(pos, numChars - 1);
        const extent = textEl.getExtentOfChar(charIdx);
        h = extent.height; y = extent.y;
        x = pos >= numChars
          ? textEl.getEndPositionOfChar(numChars - 1).x
          : textEl.getStartPositionOfChar(charIdx).x;
      }
      caretEl.setAttribute('x1', x); caretEl.setAttribute('y1', y);
      caretEl.setAttribute('x2', x); caretEl.setAttribute('y2', y + h);
    } catch {
      caretEl.setAttribute('x1', 0); caretEl.setAttribute('y1', 0);
      caretEl.setAttribute('x2', 0); caretEl.setAttribute('y2', 0);
    }
  }

  const addHighlight = () => {
    const view = paper.findViewByModel(cell);
    if (!view) return;

    caretEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    caretEl.setAttribute('class', 'sf-canvas-caret');
    caretEl.setAttribute('stroke', 'var(--selection-color)');
    caretEl.setAttribute('stroke-width', '1.5');
    view.el.appendChild(caretEl);

    // Place cursor at end of text for consistent caret position (fixes Safari)
    const len = input.value.length;
    input.setSelectionRange(len, len);
    updateCaret();
  };

  const removeHighlight = () => {
    if (caretEl) { caretEl.remove(); caretEl = null; }
  };

  input.addEventListener('focus', addHighlight);
  input.addEventListener('blur', removeHighlight);
  input.addEventListener('keyup', updateCaret);
  input.addEventListener('click', updateCaret);
  input.addEventListener('input', () => requestAnimationFrame(updateCaret));
}

function addDate(parent, label, value, onChange) {
  const f = field(parent, label);
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;display:flex;gap:4px;align-items:center;';

  // Hidden native date picker — used only for its calendar popup
  const picker = document.createElement('input');
  picker.type = 'date';
  picker.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none;';

  // Visible text input showing DD/MM/YYYY (manual entry)
  const display = document.createElement('input');
  display.type = 'text';
  display.className = 'sf-properties__input';
  display.placeholder = 'DD/MM/YYYY';
  display.style.flex = '1';

  // Calendar icon button
  const calBtn = document.createElement('button');
  calBtn.type = 'button';
  calBtn.title = 'Pick date';
  calBtn.style.cssText = 'background:none;border:1px solid var(--border-color);border-radius:4px;padding:3px 5px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);flex-shrink:0;';
  calBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="3" width="12" height="11" rx="1.5"/><line x1="2" y1="6" x2="14" y2="6"/><line x1="5" y1="1.5" x2="5" y2="4.5"/><line x1="11" y1="1.5" x2="11" y2="4.5"/></svg>';

  // Convert YYYY-MM-DD to DD/MM/YYYY for display
  function toDisplay(isoVal) {
    if (isoVal && /^\d{4}-\d{2}-\d{2}$/.test(isoVal)) {
      const [y, m, d] = isoVal.split('-');
      return `${d}/${m}/${y}`;
    }
    return isoVal || '';
  }

  // Parse DD/MM/YYYY to YYYY-MM-DD
  function toISO(displayVal) {
    const match = displayVal.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
      return `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(displayVal.trim())) return displayVal.trim();
    return null;
  }

  display.value = toDisplay(value);
  picker.value = value || '';

  // Manual text entry — commit on change/enter
  display.addEventListener('change', () => {
    const iso = toISO(display.value);
    if (iso) {
      picker.value = iso;
      onChange(iso);
    }
  });

  // Calendar button opens the native date picker
  calBtn.addEventListener('click', () => {
    try { picker.showPicker(); } catch { picker.focus(); picker.click(); }
  });

  // Calendar selection updates text display
  picker.addEventListener('change', () => {
    display.value = toDisplay(picker.value);
    onChange(picker.value);
  });

  wrap.appendChild(picker);
  wrap.appendChild(display);
  wrap.appendChild(calBtn);
  f.appendChild(wrap);
}

function addTextarea(parent, label, value, onChange) {
  const f = field(parent, label);
  const ta = document.createElement('textarea');
  ta.className = 'sf-properties__input sf-properties__textarea';
  ta.value = value ?? '';
  // Auto-size: show one more line than current text
  const autoSize = () => {
    const lines = (ta.value.match(/\n/g) || []).length + 1;
    ta.rows = lines + 1;
  };
  autoSize();
  ta.addEventListener('input', () => { onChange(ta.value); autoSize(); });
  f.appendChild(ta);
}

function addColor(parent, label, value, onChange) {
  const f = field(parent, label);
  const row = document.createElement('div');
  row.className = 'sf-prop-color-row';

  const hex = toHex(value);

  const swatch = document.createElement('input');
  swatch.type = 'color';
  swatch.className = 'sf-properties__color';
  swatch.value = hex;

  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.className = 'sf-properties__input';
  // Always display as hex — never raw CSS vars or rgba strings
  textInput.value = value ? hex : '';

  swatch.addEventListener('input', () => {
    textInput.value = swatch.value;
    onChange(swatch.value);
  });
  textInput.addEventListener('change', () => {
    const h = toHex(textInput.value);
    swatch.value = h;
    textInput.value = h;
    onChange(h);
  });

  row.appendChild(swatch);
  row.appendChild(textInput);
  f.appendChild(row);
}

function addNumber(parent, label, value, onChange) {
  const f = field(parent, label);
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'sf-properties__input';
  input.value = value ?? 0;
  input.min = 1;
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (!isNaN(v) && v > 0) onChange(v);
  });
  f.appendChild(input);
}

function addNumberPair(parent, labelA, valueA, onChangeA, labelB, valueB, onChangeB) {
  const pair = document.createElement('div');
  pair.className = 'sf-prop-pair';

  [
    [labelA, valueA, onChangeA],
    [labelB, valueB, onChangeB],
  ].forEach(([lbl, val, onCh]) => {
    const f = document.createElement('div');
    f.className = 'sf-prop-field';
    const l = document.createElement('div');
    l.className = 'sf-properties__label';
    l.textContent = lbl;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'sf-properties__input';
    inp.value = val ?? 0;
    inp.min = 1;
    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      if (!isNaN(v) && v > 0) onCh(v);
    });
    f.appendChild(l);
    f.appendChild(inp);
    pair.appendChild(f);
  });

  parent.appendChild(pair);
}

function addAutoSizeBtn(parent, onClick) {
  const btn = document.createElement('button');
  btn.className = 'sf-properties__btn sf-properties__btn--auto-size';
  btn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 1h5v2H3v3H1V1zm9 0h5v5h-2V3h-3V1zM1 10h2v3h3v2H1v-5zm12 3h-3v2h5v-5h-2v3z"/>
    </svg>
    Auto Size`;
  btn.title = 'Fit to default minimum size (or fit embedded content)';
  btn.addEventListener('click', onClick);
  parent.appendChild(btn);
}

const TYPE_PLURALS = {
  'sf.SimpleNode':     'Nodes',
  'sf.Container':      'Containers',
  'sf.Zone':           'Zones',
  'sf.Note':           'Notes',
  'sf.BpmnEvent':      'Events',
  'sf.BpmnTask':       'Tasks',
  'sf.BpmnGateway':    'Gateways',
  'sf.BpmnSubprocess': 'Subprocesses',
  'sf.BpmnLoop':       'Loops',
  'sf.BpmnPool':       'Pools',
  'sf.BpmnDataObject': 'Data Objects',
  'sf.FlowProcess':    'Processes',
  'sf.FlowDecision':   'Decisions',
  'sf.FlowTerminator': 'Terminators',
  'sf.FlowDatabase':   'Databases',
  'sf.FlowDocument':   'Documents',
  'sf.FlowIO':         'Input / Outputs',
  'sf.FlowPredefined': 'Predefined Processes',
  'sf.FlowOffPage':    'Off-Page Links',
  'sf.Annotation':     'Annotations',
  'sf.DataObject':     'Objects',
  'sf.OrgPerson':      'Persons',
  'sf.GanttTask':      'Tasks',
  'sf.GanttMilestone': 'Milestones',
  'sf.GanttTimeline':  'Timelines',
  'sf.GanttGroup':     'Groups',
};

function addApplySizeBtn(parent, cell) {
  const type = cell.get('type');
  const typePlural = TYPE_PLURALS[type] || 'Shapes';
  const btn = document.createElement('button');
  btn.className = 'sf-properties__btn sf-properties__btn--apply-size';
  btn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 1h5v2H3v3H1V1zm9 0h5v5h-2V3h-3V1zM1 10h2v3h3v2H1v-5zm12 3h-3v2h5v-5h-2v3z"/>
      <circle cx="8" cy="8" r="2"/>
    </svg>
    Apply this size to all ${typePlural}`;
  btn.title = `Resize every ${typePlural.toLowerCase()} to match this element's width and height`;
  btn.addEventListener('click', () => {
    const { width, height } = cell.size();
    graph.getElements().forEach(el => {
      if (el.get('type') === type && el.id !== cell.id) {
        el.resize(width, height);
        // Force view to re-render with new size (async paper may skip queued updates)
        const view = paper.findViewByModel(el);
        if (view?.update) view.update();
        // Re-fire so selection handles + ports reposition to final size
        el.trigger('change:size');
      }
    });
  });
  parent.appendChild(btn);
}

function addNumberWithSuffix(parent, label, value, suffix, onChange) {
  const f = field(parent, label);
  const row = document.createElement('div');
  row.className = 'sf-prop-input-with-suffix';
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'sf-properties__input';
  input.value = value ?? 0;
  input.min = 1;
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (!isNaN(v) && v > 0) onChange(v);
  });
  const span = document.createElement('span');
  span.className = 'sf-properties__input-suffix';
  span.textContent = suffix;
  row.appendChild(input);
  row.appendChild(span);
  f.appendChild(row);
}

function renderTimelineTaskEditor(parent, cell) {
  const listEl = document.createElement('div');
  listEl.className = 'sf-timeline-task-list';

  // Drag state
  let dragIdx = null;

  function rebuild() {
    listEl.innerHTML = '';
    const currentTasks = cell.get('tasks') || [];

    currentTasks.forEach((task, i) => {
      const row = document.createElement('div');
      const isTask = task.type !== 'group';
      row.className = 'sf-timeline-task-row'
        + (isTask ? ' sf-timeline-task-row--task' : '')
        + (!isTask ? ' sf-timeline-task-row--group' : '');
      row.dataset.index = i;

      // Drag handle
      const dragHandle = document.createElement('span');
      dragHandle.className = 'sf-timeline-task-drag';
      dragHandle.innerHTML = '<svg viewBox="0 0 10 14" fill="currentColor"><circle cx="3" cy="2" r="1.2"/><circle cx="7" cy="2" r="1.2"/><circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="3" cy="12" r="1.2"/><circle cx="7" cy="12" r="1.2"/></svg>';
      dragHandle.draggable = true;
      dragHandle.addEventListener('dragstart', (evt) => {
        dragIdx = i;
        evt.dataTransfer.effectAllowed = 'move';
        evt.dataTransfer.setData('text/plain', String(i));
        row.style.opacity = '0.4';
      });
      dragHandle.addEventListener('dragend', () => {
        dragIdx = null;
        row.style.opacity = '';
        listEl.querySelectorAll('.sf-timeline-task-row--drag-over').forEach(r => r.classList.remove('sf-timeline-task-row--drag-over'));
      });
      row.appendChild(dragHandle);

      // Drop target on the row itself
      row.addEventListener('dragover', (evt) => {
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'move';
        row.classList.add('sf-timeline-task-row--drag-over');
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('sf-timeline-task-row--drag-over');
      });
      row.addEventListener('drop', (evt) => {
        evt.preventDefault();
        row.classList.remove('sf-timeline-task-row--drag-over');
        const fromIdx = parseInt(evt.dataTransfer.getData('text/plain'), 10);
        const toIdx = i;
        if (isNaN(fromIdx) || fromIdx === toIdx) return;
        const updated = [...cell.get('tasks')];
        const [moved] = updated.splice(fromIdx, 1);
        // If a task is dropped onto/after a group, assign it to that group
        if (moved.type === 'task') {
          const target = updated[Math.min(toIdx, updated.length - 1)];
          if (target?.type === 'group') {
            moved.groupId = target.id;
          } else if (target?.groupId) {
            moved.groupId = target.groupId;
          }
        }
        updated.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved);
        cell.set('tasks', updated);
        rebuild();
      });

      // Color indicator
      const colorBtn = document.createElement('input');
      colorBtn.type = 'color';
      colorBtn.className = 'sf-timeline-task-color';
      colorBtn.value = toHex(task.color || '#1D73C9');
      colorBtn.addEventListener('input', () => {
        const updated = [...cell.get('tasks')];
        updated[i] = { ...updated[i], color: colorBtn.value };
        cell.set('tasks', updated);
      });
      row.appendChild(colorBtn);

      // Label input
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'sf-properties__input sf-timeline-task-label';
      labelInput.value = task.label || '';
      labelInput.placeholder = task.type === 'group' ? 'Group name' : 'Task name';
      labelInput.addEventListener('input', () => {
        const updated = [...cell.get('tasks')];
        updated[i] = { ...updated[i], label: labelInput.value };
        cell.set('tasks', updated);
      });
      row.appendChild(labelInput);

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'sf-field-delete';
      delBtn.textContent = '×';
      delBtn.title = 'Remove';
      delBtn.addEventListener('click', () => {
        const updated = [...cell.get('tasks')];
        // If deleting a group, also remove its children
        if (task.type === 'group') {
          const filtered = updated.filter((t, idx) => idx !== i && t.groupId !== task.id);
          cell.set('tasks', filtered);
        } else {
          updated.splice(i, 1);
          cell.set('tasks', updated);
        }
        rebuild();
      });
      row.appendChild(delBtn);

      listEl.appendChild(row);
    });

    // Add buttons
    const btnRow = document.createElement('div');
    btnRow.className = 'sf-timeline-task-actions';

    const addGroupBtn = document.createElement('button');
    addGroupBtn.className = 'sf-properties__btn sf-properties__btn--add-field';
    addGroupBtn.textContent = '+ Group';
    addGroupBtn.addEventListener('click', () => {
      const updated = [...cell.get('tasks')];
      const id = 'g' + Date.now();
      updated.push({ id, type: 'group', label: 'New Group', color: '#5B5FC7' });
      cell.set('tasks', updated);
      rebuild();
    });

    const addTaskBtn = document.createElement('button');
    addTaskBtn.className = 'sf-properties__btn sf-properties__btn--add-field';
    addTaskBtn.textContent = '+ Task';
    addTaskBtn.addEventListener('click', () => {
      const updated = [...cell.get('tasks')];
      const lastGroup = [...updated].reverse().find(t => t.type === 'group');
      const id = 't' + Date.now();
      updated.push({ id, type: 'task', label: 'New Task', groupId: lastGroup?.id || null, color: '#1D73C9' });
      cell.set('tasks', updated);
      rebuild();
    });

    btnRow.appendChild(addGroupBtn);
    btnRow.appendChild(addTaskBtn);
    listEl.appendChild(btnRow);
  }

  rebuild();
  parent.appendChild(listEl);
}

function addSelect(parent, label, value, options, onChange) {
  const f = field(parent, label);
  const sel = document.createElement('select');
  sel.className = 'sf-properties__select';
  options.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === value) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => onChange(sel.value));
  f.appendChild(sel);
}

function addMarkerPicker(parent, label, current, options, svgs, onChange) {
  const f = field(parent, label);
  const wrap = document.createElement('div');
  wrap.className = 'sf-marker-picker';

  // Current selected display
  const btn = document.createElement('button');
  btn.className = 'sf-marker-picker__btn';
  const updateBtn = (val) => {
    const opt = options.find(o => o.value === val) || options[0];
    const svg = svgs[val] || '';
    btn.innerHTML = svg
      ? `<svg width="32" height="18" viewBox="0 0 36 18">${svg}</svg><span>${opt.label}</span>`
      : `<span>${opt.label}</span>`;
  };
  updateBtn(current);

  // Dropdown list
  const list = document.createElement('div');
  list.className = 'sf-marker-picker__list';
  list.style.display = 'none';
  options.forEach(opt => {
    const item = document.createElement('button');
    item.className = 'sf-marker-picker__item';
    if (opt.value === current) item.classList.add('sf-marker-picker__item--active');
    const svg = svgs[opt.value] || '';
    item.innerHTML = svg
      ? `<svg width="32" height="18" viewBox="0 0 36 18">${svg}</svg><span>${opt.label}</span>`
      : `<span>${opt.label}</span>`;
    item.addEventListener('click', () => {
      list.querySelectorAll('.sf-marker-picker__item--active').forEach(el => el.classList.remove('sf-marker-picker__item--active'));
      item.classList.add('sf-marker-picker__item--active');
      updateBtn(opt.value);
      list.style.display = 'none';
      onChange(opt.value);
    });
    list.appendChild(item);
  });

  btn.addEventListener('click', () => {
    list.style.display = list.style.display === 'none' ? 'flex' : 'none';
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) list.style.display = 'none';
  });

  wrap.appendChild(btn);
  wrap.appendChild(list);
  f.appendChild(wrap);
}

function addIconPicker(parent, label, currentHref, onChange, iconColorGetter) {
  const f = field(parent, label);

  // Detect current icon name from href (data URI contains data-icon-id attribute)
  let currentIconName = '';
  let currentIconId = '';
  if (currentHref) {
    const idMatch = currentHref.match(/data-icon-id(?:%3D|=)(?:%22|")([^%"]+)(?:%22|")/);
    if (idMatch) {
      currentIconId = decodeURIComponent(idMatch[1]).replace(/[^a-zA-Z0-9_-]/g, '');
      const allIcons = getAllIcons();
      const found = allIcons.find(i => i.id === currentIconId);
      if (found) currentIconName = found.name;
    }
  }

  // Unified icon field: preview + name OR search input
  const wrap = document.createElement('div');
  wrap.style.position = 'relative';

  const inputRow = document.createElement('div');
  inputRow.className = 'sf-prop-icon-preview';
  inputRow.style.cursor = 'text';

  const swatch = document.createElement('div');
  swatch.className = 'sf-prop-icon-swatch';

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'sf-prop-icon-search-input';
  search.placeholder = 'Search icons\u2026';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'sf-prop-icon-clear';
  clearBtn.innerHTML = '\u00D7';
  clearBtn.title = 'Remove icon';
  clearBtn.type = 'button';

  let hasIcon = !!currentHref;

  function setIconMode(iconId, iconName, href) {
    hasIcon = true;
    if (iconId) {
      const safeIconId = iconId.replace(/[^a-zA-Z0-9_-]/g, '');
      swatch.innerHTML = `<svg width="20" height="20" fill="var(--text-primary)"><use href="#${safeIconId}"></use></svg>`;
    } else if (href) {
      // Try to extract icon ID from data URI for readable display
      const match = href.match(/data-icon-id(?:%3D|=)(?:%22|")([^%"]+)(?:%22|")/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
        swatch.innerHTML = `<svg width="20" height="20" fill="var(--text-primary)"><use href="#${safeId}"></use></svg>`;
      } else {
        const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        img.setAttribute('href', href);
        img.setAttribute('width', '20');
        img.setAttribute('height', '20');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '20');
        svg.setAttribute('height', '20');
        svg.appendChild(img);
        swatch.replaceChildren(svg);
      }
    }
    search.value = iconName || 'Custom';
    search.readOnly = true;
    search.style.cursor = 'default';
    clearBtn.style.display = 'flex';
  }

  function setSearchMode() {
    hasIcon = false;
    swatch.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="var(--text-muted)"><path d="M6.5 1a5.5 5.5 0 014.38 8.82l3.65 3.65a.75.75 0 01-1.06 1.06l-3.65-3.65A5.5 5.5 0 116.5 1zm0 1.5a4 4 0 100 8 4 4 0 000-8z"/></svg>`;
    search.value = '';
    search.readOnly = false;
    search.style.cursor = '';
    clearBtn.style.display = 'none';
    onChange('');
  }

  // Initialize state
  if (hasIcon) {
    setIconMode(currentIconId, currentIconName, currentHref);
  } else {
    swatch.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="var(--text-muted)"><path d="M6.5 1a5.5 5.5 0 014.38 8.82l3.65 3.65a.75.75 0 01-1.06 1.06l-3.65-3.65A5.5 5.5 0 116.5 1zm0 1.5a4 4 0 100 8 4 4 0 000-8z"/></svg>`;
    clearBtn.style.display = 'none';
  }

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setSearchMode();
    search.focus();
  });

  inputRow.addEventListener('click', () => {
    if (hasIcon) {
      // #6: Click on current icon to switch to search mode (keeping the icon until a new one is picked)
      search.readOnly = false;
      search.style.cursor = '';
      search.value = '';
      search.focus();
      showDropdown('');
      return;
    }
    search.focus();
  });

  // Dropdown
  const dropdown = document.createElement('div');
  dropdown.style.cssText = `
    position:absolute; top:100%; left:0; right:0; z-index:9999;
    background:var(--bg-surface-raised);
    border:1px solid var(--border-color);
    border-radius:var(--border-radius-sm);
    max-height:240px; overflow-y:auto;
    display:none; flex-wrap:wrap;
    padding:6px; gap:4px;
    box-shadow:var(--shadow-md);
  `;

  function showDropdown(query) {
    const q = (query || '').toLowerCase();
    const icons = q
      ? getAllIcons().filter(i => i.name.toLowerCase().includes(q)).slice(0, 48)
      : getAllIcons().slice(0, 48);
    dropdown.innerHTML = '';
    if (!icons.length) { dropdown.style.display = 'none'; return; }

    dropdown.style.display = 'flex';
    icons.forEach(icon => {
      const item = document.createElement('div');
      item.title = icon.name;
      item.style.cssText = 'width:40px;height:40px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:4px;flex-shrink:0;border:1px solid transparent;';
      item.innerHTML = `<svg width="28" height="28" fill="var(--text-primary)"><use href="#${icon.id}"></use></svg>`;
      item.addEventListener('mouseenter', () => { item.style.background = 'var(--toolbar-button-hover)'; item.style.borderColor = 'var(--border-color)'; });
      item.addEventListener('mouseleave', () => { item.style.background = ''; item.style.borderColor = 'transparent'; });
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        const iconColor = iconColorGetter ? iconColorGetter() : (getComputedStyle(document.documentElement).getPropertyValue('--node-text').trim() || '#1C1E21');
        const href = getIconDataUri(icon.id, iconColor);
        onChange(href);
        setIconMode(icon.id, icon.name, href);
        dropdown.style.display = 'none';
      });
      dropdown.appendChild(item);
    });
  }

  search.addEventListener('input', () => {
    showDropdown(search.value);
  });

  search.addEventListener('focus', () => {
    if (!hasIcon || !search.readOnly) {
      showDropdown(search.value);
    }
  });

  search.addEventListener('blur', () => setTimeout(() => { dropdown.style.display = 'none'; }, 150));

  inputRow.appendChild(swatch);
  inputRow.appendChild(search);
  inputRow.appendChild(clearBtn);
  wrap.appendChild(inputRow);
  wrap.appendChild(dropdown);
  f.appendChild(wrap);
}

// ── Element conversion ──────────────────────────────────────────────

function collectConnections(cell) {
  return graph.getConnectedLinks(cell).map(link => ({
    link,
    isSource: link.get('source')?.id === cell.id,
    isTarget: link.get('target')?.id === cell.id,
    sourcePort: link.get('source')?.port,
    targetPort: link.get('target')?.port,
  }));
}

function reconnectLinks(connections, newId) {
  connections.forEach(({ link, isSource, isTarget, sourcePort, targetPort }) => {
    if (isSource) link.set('source', { id: newId, port: sourcePort });
    if (isTarget) link.set('target', { id: newId, port: targetPort });
  });
}

function convertToContainer(cell) {
  const pos = cell.position();
  const size = cell.size();
  const connections = collectConnections(cell);
  const fillColor = cell.attr('body/fill') || '#1D73C9';
  const labelColor = cell.attr('label/fill') || '#ffffff';
  const container = new joint.shapes.sf.Container({
    position: pos,
    size: { width: Math.max(size.width, 360), height: Math.max(size.height, 240) },
    attrs: {
      headerLabel:    { text: cell.attr('label/text') || 'Container', fill: labelColor },
      headerIcon:     { href: cell.attr('icon/href') || '' },
      headerSubtitle: { text: cell.attr('subtitle/text') || '' },
      accent:         { fill: fillColor },
      accentFill:     { fill: fillColor },
    },
  });
  graph.addCell(container);
  reconnectLinks(connections, container.id);
  cell.remove();
  selection.selectOnly(container.id);
}

function convertToNode(cell) {
  const pos = cell.position();
  const def = DEFAULT_SIZES['sf.SimpleNode'];
  const connections = collectConnections(cell);
  cell.getEmbeddedCells().forEach(child => cell.unembed(child));
  const fillColor = cell.attr('accent/fill') || '#2A2D32';
  const tc = contrastTextColor(fillColor);
  const node = new joint.shapes.sf.SimpleNode({
    position: pos,
    size: { width: def.width, height: def.height },
    attrs: {
      label:    { text: cell.attr('headerLabel/text') || 'Node', fill: tc || '#ffffff' },
      subtitle: { text: cell.attr('headerSubtitle/text') || '', fill: tc || '#ffffff', opacity: 0.7 },
      icon:     { href: cell.attr('headerIcon/href') || '' },
      body:     { fill: fillColor },
    },
  });
  graph.addCell(node);
  updateSimpleNodeLayout(node);
  reconnectLinks(connections, node.id);
  cell.remove();
  selection.selectOnly(node.id);
}

function convertToIcon(cell) {
  // Convert a SimpleNode to icon mode — circle with icon only
  const pos = cell.position();
  const connections = collectConnections(cell);
  const fillColor = cell.attr('body/fill') || 'var(--node-bg)';
  const iconHref = cell.attr('icon/href') || '';
  // Store original data for round-trip
  const node = new joint.shapes.sf.SimpleNode({
    position: pos,
    size: { width: 64, height: 64 },
    iconMode: true,
    // Preserve original data for converting back
    _savedLabel: cell.attr('label/text') || '',
    _savedSubtitle: cell.attr('subtitle/text') || '',
    attrs: {
      body:     { fill: fillColor, rx: 32, ry: 32 },
      icon:     { href: iconHref, x: 16, y: 16, width: 32, height: 32 },
      label:    { text: '', visibility: 'hidden' },
      subtitle: { text: '', visibility: 'hidden' },
    },
  });
  graph.addCell(node);
  reconnectLinks(connections, node.id);
  cell.remove();
  selection.selectOnly(node.id);
}

function convertContainerToIcon(cell) {
  // Convert a Container to icon mode SimpleNode
  const pos = cell.position();
  const connections = collectConnections(cell);
  const fillColor = cell.attr('accent/fill') || 'var(--color-primary)';
  const iconHref = cell.attr('headerIcon/href') || '';
  cell.getEmbeddedCells().forEach(child => cell.unembed(child));
  const node = new joint.shapes.sf.SimpleNode({
    position: pos,
    size: { width: 64, height: 64 },
    iconMode: true,
    _savedLabel: cell.attr('headerLabel/text') || '',
    _savedSubtitle: cell.attr('headerSubtitle/text') || '',
    attrs: {
      body:     { fill: fillColor, rx: 32, ry: 32 },
      icon:     { href: iconHref, x: 16, y: 16, width: 32, height: 32 },
      label:    { text: '', visibility: 'hidden' },
      subtitle: { text: '', visibility: 'hidden' },
    },
  });
  graph.addCell(node);
  reconnectLinks(connections, node.id);
  cell.remove();
  selection.selectOnly(node.id);
}

function convertFromIcon(cell) {
  // Restore a SimpleNode from icon mode back to normal
  const pos = cell.position();
  const connections = collectConnections(cell);
  const fillColor = cell.attr('body/fill') || 'var(--node-bg)';
  const iconHref = cell.attr('icon/href') || '';
  const savedLabel = cell.get('_savedLabel') || 'Node';
  const savedSubtitle = cell.get('_savedSubtitle') || '';
  const tc = contrastTextColor(fillColor);
  const def = DEFAULT_SIZES['sf.SimpleNode'];
  const node = new joint.shapes.sf.SimpleNode({
    position: pos,
    size: { width: def.width, height: def.height },
    attrs: {
      body:     { fill: fillColor, rx: 8, ry: 8 },
      icon:     { href: iconHref, x: 12, y: 'calc(0.5 * h - 16)', width: 32, height: 32 },
      label:    { text: savedLabel, fill: tc || 'var(--node-text)', visibility: 'visible' },
      subtitle: { text: savedSubtitle, visibility: 'visible' },
    },
  });
  graph.addCell(node);
  reconnectLinks(connections, node.id);
  cell.remove();
  selection.selectOnly(node.id);
}

// ── Utility ─────────────────────────────────────────────────────────

function toHex(color) {
  if (!color) return '#000000';
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const [, r, g, b] = color.match(/^#(.)(.)(.)/);
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  // CSS variable, rgba, named color — parse via canvas
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = color;
    const hex = ctx.fillStyle;
    return /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000';
  } catch {
    return '#000000';
  }
}

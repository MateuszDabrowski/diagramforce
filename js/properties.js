// Properties panel — left sidebar element inspector
// Properties are grouped into collapsible accordion sections

import { wrapSelectionWithMarker } from './markdown.js?v=1.17.0.199';
import { confirmModal, showToast, buildModal } from './feedback.js?v=1.17.0.199';
import { getAllIcons, getIconDataUri } from './icons.js?v=1.17.0.199';
import { Z_BASE, Z_TIER_SPAN, tierNameForType, updateSimpleNodeLayout, updateDataObjectHeaderLayout, updateNoteIconLayout, syncMobilePanelHeight, canEmbed, applyMappingLinkStyle, applyRelationshipLinkStyle, syncMappingTypeBadge, syncFrequencyLabel } from './canvas.js?v=1.17.0.199';
import * as stencilModule from './stencil.js?v=1.17.0.199';
import { getPalette, addToPalette, removeFromPalette, onPaletteChange, PALETTE_MAX_SLOTS } from './brand-palette.js?v=1.17.0.199';
import { resizeDataObjectToFit, contrastTextColor, getStencilSvgDataUri, SVG as COMPONENT_SVG, extractLinkDomain } from './components.js?v=1.17.0.199';
import {
  duplicate as clipboardDuplicate,
  copy as clipboardCopy,
  cloneElementWithConnectors,
  countConnectors,
  countConnectedConnectors,
  cloneSelectionWithMode,
  countExternalConnectors,
  countExternalConnectedConnectors,
} from './clipboard.js?v=1.17.0.199';
import * as history from './history.js?v=1.17.0.199';
import { startImageAddFlow } from './image-component.js?v=1.17.0.199';
import { escHtml, sanitizeFilenamePart } from './util.js?v=1.17.0.199';
import { getActiveTabName } from './tabs.js?v=1.17.0.199';
import { saveSelectionAsTemplate, saveCellAsShape } from './templates.js?v=1.17.0.199';
import { newFid } from './shapes.js?v=1.17.0.199';

/**
 * Wrap a callback so every mutation inside it (potentially many
 * `cell.attr()` calls across one or more elements) is collapsed into a
 * SINGLE undo command. Without this, picking a colour on a SimpleNode
 * would push 4 separate commands (body/fill, label/fill, subtitle/fill,
 * subtitle/opacity) and Cmd+Z would only revert the last one.
 */
function asUndoBatch(fn) {
  return (...args) => {
    history.startBatch();
    try { fn(...args); }
    finally { history.endBatch(); }
  };
}

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
  'sf.Image':          'Image',
  'sf.Task':           'Task',
  'sf.TaskGroup':      'Task Group',
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
  'sf.Line':           'Line',
  'sf.Link':           'Link',
  'sf.DataObject':     'Object',
  'sf.OrgPerson':      'Person',
  'sf.GanttTask':      'Task',
  'sf.GanttMilestone': 'Milestone',
  'sf.GanttMarker':    'Today Marker',
  'sf.GanttTimeline':  'Timeline',
  'sf.GanttGroup':     'Group',
  'sf.SequenceParticipant': 'Participant',
  'sf.SequenceActor':       'Actor',
  'sf.SequenceActivation':  'Activation',
  'sf.SequenceFragment':    'Fragment',
};

/** The user-facing name of a cell (its label), or '' if unnamed. Single source of the
 *  label-accessor chain the inspector uses — reused by the a11y narrator. */
export function cellName(cell) {
  if (!cell) return '';
  if (cell.isLink?.()) return cell.labels?.()?.[0]?.attrs?.text?.text || '';
  return cell.get('_savedLabel') || cell.get('objectName')
    || cell.attr?.('label/text') || cell.attr?.('headerLabel/text') || '';
}

/** A concise screen-reader description of a cell: type + name (+ endpoints for connectors).
 *  e.g. "Object: Contact", "Node: Alpha", "Connector from Alpha to Beta". */
export function describeCell(cell) {
  if (!cell) return '';
  if (cell.isLink?.()) {
    const label = cellName(cell);
    const from = cellName(cell.getSourceCell?.());
    const to = cellName(cell.getTargetCell?.());
    const ends = (from || to) ? ` from ${from || 'a shape'} to ${to || 'a shape'}` : '';
    return `Connector${label ? ` ${label}` : ''}${ends}`;
  }
  const type = cell.get('type') || '';
  const typeLabel = cell.get('iconMode') ? 'Icon' : (TYPE_LABELS[type] || type.replace('sf.', '') || 'Element');
  const name = cellName(cell);
  return `${typeLabel}${name ? `: ${name}` : ''}`;
}

// Default sizes used by "Auto Size"
const DEFAULT_SIZES = {
  'sf.SimpleNode':     { width: 180, height: 64 },
  'sf.Container':      { width: 360, height: 240 },
  'sf.Zone':           { width: 400, height: 300 },
  'sf.TaskGroup':      { width: 640, height: 360 },
  'sf.TextLabel':      { width: 200, height: 32 },
  'sf.Note':           { width: 200, height: 120 },
  'sf.Image':          { width: 240, height: 180 },
  'sf.Task':           { width: 540, height: 160 },
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
  'sf.FlowIO':         { width: 140, height: 60 },
  'sf.FlowPredefined': { width: 120, height: 60 },
  'sf.FlowOffPage':    { width: 60,  height: 60 },
  'sf.Annotation':     { width: 100, height: 120 },
  'sf.Line':           { width: 200, height: 8 },
  'sf.Link':           { width: 220, height: 44 },
  'sf.DataObject':     { width: 260, height: 80 },
  'sf.GanttTask':      { width: 240, height: 32 },
  'sf.GanttMilestone': { width: 24,  height: 24 },
  'sf.GanttMarker':    { width: 20,  height: 16 },
  'sf.GanttTimeline':  { width: 960, height: 48 },
  'sf.GanttGroup':     { width: 360, height: 24 },
  'sf.OrgPerson':      { width: 280, height: 90 },
  'sf.SequenceParticipant': { width: 140, height: 360 },
  'sf.SequenceActor':       { width: 100, height: 340 },
  'sf.SequenceActivation':  { width: 12,  height: 80 },
  'sf.SequenceFragment':    { width: 400, height: 200 },
};

/** Auto-size one element to its sensible default: DataObjects fit their field rows; everything else resets to
 *  DEFAULT_SIZES for its type. The single source of truth shared by the properties-pane "Auto Size" button and
 *  the canvas right-click "Auto size" (wired via selection.setAutoSizer in app.js). No-op for links. */
export function autoSizeCell(cell) {
  if (!cell || !cell.isElement || !cell.isElement()) return;
  const type = cell.get('type');
  if (type === 'sf.DataObject') { resizeDataObjectToFit(cell); return; }
  // A Note fits its HEIGHT to the rendered description (item 1.2) rather than snapping to the default 200x120 -
  // its view measures the content and grows/shrinks to it. Fall back to the default size if the view is absent.
  if (type === 'sf.Note') {
    const view = paper.findViewByModel(cell);
    if (view && typeof view.fitNoteToContent === 'function') { view.fitNoteToContent(); return; }
  }
  const def = DEFAULT_SIZES[type];
  if (def) cell.resize(def.width, def.height);
}

// Per-type color field schema used by the multi-select Colors section.
// Each entry lists the color "slots" the type exposes in its single-element
// panel; multi-select intersects these by label so only colors that ALL
// selected types support are shown. Getters return the current value (or
// a type default); setters apply the same side-effects as the single-
// element renderer (e.g. SimpleNode Fill also updates text contrast).
const COLOR_SCHEMA = {
  'sf.SimpleNode': [
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => {
        c.attr('body/fill', v);
        const tc = contrastTextColor(v);
        if (tc) {
          c.attr('label/fill', tc);
          c.attr('subtitle/fill', tc);
          c.attr('subtitle/opacity', 0.7);
          recolorCellIcon(c, tc);   // R4: the icon must follow the contrast text colour, as in the single-node panel
        }
      } },
    { label: 'Border',
      get: c => c.attr('body/stroke'),
      set: (c, v) => c.attr('body/stroke', v) },
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      // R4: recolor the icon too (multi-select was only recolouring the text; the single-node panel does both).
      set: (c, v) => { c.attr('label/fill', v); c.attr('subtitle/fill', v); recolorCellIcon(c, v); } },
  ],
  'sf.Container': [
    { label: 'Accent',
      get: c => c.attr('accent/fill'),
      set: (c, v) => { c.attr('accent/fill', v); c.attr('accentFill/fill', v); } },
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Border',
      get: c => c.attr('body/stroke'),
      set: (c, v) => c.attr('body/stroke', v) },
    { label: 'Label color',
      get: c => c.attr('headerLabel/fill'),
      set: (c, v) => c.attr('headerLabel/fill', v) },
  ],
  'sf.TextLabel': [
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      set: (c, v) => c.attr('label/fill', v) },
  ],
  'sf.Zone': [
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Border',
      get: c => c.attr('body/stroke'),
      set: (c, v) => c.attr('body/stroke', v) },
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      set: (c, v) => c.attr('label/fill', v) },
  ],
  'sf.TaskGroup': [
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Border',
      get: c => c.attr('body/stroke'),
      set: (c, v) => c.attr('body/stroke', v) },
  ],
  'sf.Note': [
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Border',
      get: c => c.attr('body/stroke'),
      // The dog-ear fold tracks the border colour (fill + stroke) so the user controls the flipped corner (#8).
      set: (c, v) => { c.attr('body/stroke', v); c.attr('fold/stroke', v); c.attr('fold/fill', v); } },
  ],
  'sf.Line': [
    { label: 'Label color',
      get: c => c.attr('line/stroke'),
      set: (c, v) => c.attr('line/stroke', v) },
  ],
  'sf.Annotation': [
    { label: 'Bracket color',
      get: c => c.attr('bracket/stroke'),
      set: (c, v) => c.attr('bracket/stroke', v) },
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      set: (c, v) => c.attr('label/fill', v) },
  ],
  'sf.DataObject': [
    { label: 'Header fill',
      get: c => c.get('headerColor') || '#1D73C9',
      set: (c, v) => {
        c.set('headerColor', v);
        c.attr('header/fill', v);
        c.attr('headerCover/fill', v);
      } },
  ],
  'sf.OrgPerson': [
    { label: 'Accent',
      get: c => c.attr('accentBar/fill') || '#1D73C9',
      set: (c, v) => { c.attr('accentBar/fill', v); c.attr('accentBarMask/fill', v); } },
  ],
  'sf.GanttTask': [
    { label: 'Completion bar',
      get: c => c.attr('progressBar/fill') || '#1D73C9',
      set: (c, v) => c.attr('progressBar/fill', v) },
    { label: 'Label color',
      get: c => c.get('userTextColor') || c.attr('label/fill') || '#FFFFFF',
      set: (c, v) => { c.set('userTextColor', v); c.attr('label/fill', v); } },
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Border',
      get: c => c.attr('body/stroke'),
      set: (c, v) => c.attr('body/stroke', v) },
  ],
  'sf.GanttMilestone': [
    { label: 'Fill',
      get: c => c.attr('body/fill') || '#F6B355',
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Border',
      get: c => c.attr('body/stroke') || '#D4942A',
      set: (c, v) => c.attr('body/stroke', v) },
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      set: (c, v) => c.attr('label/fill', v) },
  ],
  'sf.GanttMarker': [
    { label: 'Fill',
      get: c => c.attr('body/fill') || '#DA4E55',
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Border',
      get: c => c.attr('body/stroke') || '#B03A40',
      set: (c, v) => c.attr('body/stroke', v) },
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      set: (c, v) => c.attr('label/fill', v) },
  ],
  'sf.GanttTimeline': [
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Top row',
      get: c => c.attr('topRow/fill'),
      set: (c, v) => c.attr('topRow/fill', v) },
    { label: 'Border',
      get: c => c.attr('body/stroke'),
      set: (c, v) => c.attr('body/stroke', v) },
  ],
  'sf.GanttGroup': [
    { label: 'Bar color',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      set: (c, v) => c.attr('label/fill', v) },
  ],
  'sf.SequenceParticipant': [
    { label: 'Accent',
      get: c => c.attr('headerAccent/fill'),
      set: (c, v) => {
        c.attr('headerAccent/fill', v);
        c.attr('header/stroke', v);
        c.attr('lifeline/stroke', v);
        c.attr('underline/stroke', v);
      } },
    { label: 'Fill',
      get: c => c.attr('header/fill'),
      set: (c, v) => c.attr('header/fill', v) },
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      set: (c, v) => c.attr('label/fill', v) },
  ],
  'sf.SequenceActor': [
    { label: 'Accent',
      get: c => c.attr('actorHead/stroke'),
      set: (c, v) => {
        c.attr('actorHead/stroke', v);
        c.attr('actorBody/stroke', v);
        c.attr('actorArms/stroke', v);
        c.attr('actorLegLeft/stroke', v);
        c.attr('actorLegRight/stroke', v);
        c.attr('lifeline/stroke', v);
      } },
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      set: (c, v) => c.attr('label/fill', v) },
  ],
  'sf.SequenceActivation': [
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Border',
      get: c => c.attr('body/stroke'),
      set: (c, v) => c.attr('body/stroke', v) },
  ],
  'sf.SequenceFragment': [
    { label: 'Border',
      get: c => c.attr('body/stroke'),
      set: (c, v) => {
        c.attr('body/stroke', v);
        c.attr('titleTab/stroke', v);
      } },
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Label color',
      get: c => c.attr('titleText/fill'),
      set: (c, v) => {
        c.attr('titleText/fill', v);
        c.attr('conditionText/fill', v);
      } },
  ],
};

// Default schema for BPMN / Flow shapes — Fill, Border, Label color.
const BASIC_COLOR_SCHEMA = [
  { label: 'Fill',
    get: c => c.attr('body/fill'),
    set: (c, v) => c.attr('body/fill', v) },
  { label: 'Border',
    get: c => c.attr('body/stroke'),
    set: (c, v) => c.attr('body/stroke', v) },
  { label: 'Label color',
    get: c => c.attr('label/fill'),
    set: (c, v) => c.attr('label/fill', v) },
];

// Shapes that share the basic (Fill / Border / Label color) schema.
[
  'sf.BpmnEvent', 'sf.BpmnTask', 'sf.BpmnGateway', 'sf.BpmnSubprocess',
  'sf.BpmnLoop', 'sf.BpmnDataObject',
  'sf.FlowProcess', 'sf.FlowDecision', 'sf.FlowTerminator', 'sf.FlowDatabase',
  'sf.FlowDocument', 'sf.FlowIO', 'sf.FlowPredefined', 'sf.FlowOffPage',
].forEach(t => { if (!COLOR_SCHEMA[t]) COLOR_SCHEMA[t] = BASIC_COLOR_SCHEMA; });

// Pool has an extra "Header fill".
COLOR_SCHEMA['sf.BpmnPool'] = [
  ...BASIC_COLOR_SCHEMA,
  { label: 'Header fill',
    get: c => c.attr('header/fill'),
    set: (c, v) => c.attr('header/fill', v) },
];

let graph, paper, selection;
let panelEl, typeBadgeEl, titleEl, bodyEl, footerEl;

// Data Cloud mapping mode — provided by tabs via app.js wiring. The DataObject
// property panel reveals its Data Cloud section only when this returns true, so
// the default Data Model panel is unchanged when mapping mode is off.
let mappingModeGetter = null;
export function setMappingModeGetter(fn) { mappingModeGetter = fn; }
export function isMappingMode() { return !!(mappingModeGetter && mappingModeGetter()); }

// Re-render the property panel for the current single selection (used when
// mapping mode toggles so the Data Cloud section appears/disappears live).
export function refresh() {
  const c = getActiveCell();
  if (c) showProperties(c);
}

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
    panelEl.classList.add('df-properties--hidden');
    restoreStencilAfterProperties();
    selection.clearSelection();
  });

  selection.onChange((ids) => {
    cleanupCanvasHighlights();
    // Dismiss any inline text editor (trigger blur to save and clean up)
    const activeEditor = document.querySelector('.df-inline-edit__input');
    if (activeEditor) activeEditor.blur();
    if (ids.length === 1) {
      const cell = graph.getCell(ids[0]);
      if (cell) showProperties(cell);
    } else if (ids.length > 1) {
      clearActiveSizeListener();
      showMultiProperties(ids.length);
    } else {
      clearActiveSizeListener();
      panelEl.classList.add('df-properties--hidden');
      footerEl.innerHTML = '';
      restoreStencilAfterProperties();
    }
  });

  // A freshly-drawn connector is tagged `linkKind:'mapping'` (or reclassified) by canvas's
  // `link:connect` handler, which can land AFTER the selection has already rendered the panel
  // with the generic connector fields. Re-render when the SELECTED link's `linkKind` changes so
  // the mapping-specific fields (Mapping type, Expression / rules) appear immediately — no
  // re-select needed. One persistent listener; fires only for the active cell, so it's cheap.
  graph.on('change:linkKind', (cell) => {
    if (getActiveCell()?.id === cell.id) refresh();
  });

  // Double-click on element opens inline text editor on canvas.
  // Links are handled separately (below) so that dblclick on empty link
  // segments keeps JointJS's vertex-add behaviour.
  paper.on('cell:pointerdblclick', (cellView, evt) => {
    if (cellView.model.isLink()) return;
    startInlineEdit(cellView, evt);
  });

  // For links: only dblclick on the existing label enters inline edit.
  // When a link is selected, JointJS overlays a vertex tool on top of the link
  // and intercepts pointer events — so we hit-test click coords against every
  // rendered label's bounding box instead of trusting evt.target.
  paper.el.addEventListener('dblclick', (evt) => {
    const x = evt.clientX, y = evt.clientY;
    const links = paper.el.querySelectorAll('.joint-link');
    for (const linkEl of links) {
      const labelNodes = linkEl.querySelectorAll('.labels .label, g[joint-selector="labels"] > g');
      if (!labelNodes.length) continue;
      for (const labelNode of labelNodes) {
        const r = labelNode.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        // Small hit-padding so clicking right at the edge still counts
        const pad = 2;
        if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) {
          const modelId = linkEl.getAttribute('model-id');
          const cell = graph.getCell(modelId);
          if (!cell || !cell.isLink()) return;
          const cellView = paper.findViewByModel(cell);
          if (!cellView) return;
          evt.stopPropagation();
          evt.stopImmediatePropagation();
          evt.preventDefault();
          startInlineEdit(cellView, evt);
          return;
        }
      }
    }
  }, true);

  // Dismiss inline editor on blank area click
  paper.on('blank:pointerdown', () => {
    const editor = document.querySelector('.df-inline-edit__input');
    if (editor) editor.blur();
  });
}

/** Remove any lingering caret highlights from the canvas */
function cleanupCanvasHighlights() {
  document.querySelectorAll('.df-canvas-caret').forEach(el => el.remove());
}

// ── Inline canvas text editing ──────────────────────────────────────

/**
 * Resolve the inline-edit target for a given cell.
 * Returns { kind, ... } where kind is 'attr' | 'model' | 'link', or null to skip.
 */
function getInlineEditTarget(cell) {
  if (cell.isLink()) return { kind: 'link' };
  const type = cell.get('type') || '';
  if (type === 'sf.Line') return null; // no label
  if (type === 'sf.OrgPerson') return { kind: 'model', prop: 'personName', selector: 'nameLabel' };
  if (type === 'sf.Container' || type === 'sf.DataObject') return { kind: 'attr', path: 'headerLabel/text', selector: 'headerLabel' };
  // A Note's main field is its multi-line description (subtitle), not the heading - edit that on double-click (R5).
  if (type === 'sf.Note') return { kind: 'attr', path: 'subtitle/text', selector: 'subtitle' };
  return { kind: 'attr', path: 'label/text', selector: 'label' };
}

/** Start inline text editing on the canvas overlay */
function startInlineEdit(cellView, evt) {
  document.querySelector('.df-inline-edit')?.remove();

  const cell = cellView.model;
  const type = cell.get('type') || '';
  const target = getInlineEditTarget(cell);
  if (!target) {
    setTimeout(() => {
      const firstInput = bodyEl.querySelector('.df-properties__input');
      if (firstInput) firstInput.focus();
    }, 50);
    return;
  }

  // Resolve current text, commit function, and source text element for positioning
  let currentText = '';
  let textEl = null;
  let commit = () => {};

  if (target.kind === 'link') {
    currentText = cell.labels()?.[0]?.attrs?.text?.text ?? '';
    textEl = cellView.el.querySelector('.labels text[joint-selector="text"]')
          || cellView.el.querySelector('text[joint-selector="text"]');
    commit = (newText) => {
      const labels = cell.labels();
      const fontSize = labels?.[0]?.attrs?.text?.fontSize ?? 13;
      const fillColor = cell.prop('fontColor') || cell.attr('line/stroke') || '#888888';   // Label color override (v1.16.1)
      // Single labels() call so the change emits exactly one `change:labels`
      // event — keeps undo/redo at one entry per edit.
      cell.labels(newText ? [{
        markup: [
          { tagName: 'rect', selector: 'body' },
          { tagName: 'text', selector: 'text' },
        ],
        attrs: {
          text: { text: newText, fill: fillColor, fontSize, fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', textAnchor: 'middle', textVerticalAnchor: 'middle' },
          body: { ref: 'text', refWidth: 12, refHeight: 4, refX: -6, refY: -2, fill: 'var(--bg-canvas, #FFFFFF)', stroke: 'none', rx: 2, ry: 2 },
        },
        position: { distance: 0.5, offset: 0 },
      }] : []);
      titleEl.textContent = newText || 'Unnamed';
    };
  } else if (target.kind === 'model') {
    currentText = cell.get(target.prop) || '';
    textEl = cellView.el.querySelector(`text[joint-selector="${target.selector}"]`);
    if (!textEl) return;
    commit = (newText) => cell.set(target.prop, newText);
  } else {
    currentText = cell.attr(target.path) || '';
    textEl = cellView.el.querySelector(`text[joint-selector="${target.selector}"]`);
    if (!textEl) return;
    commit = (newText) => cell.attr(target.path, newText);
  }

  const canvasContainer = document.getElementById('canvas-container');
  const containerRect = canvasContainer.getBoundingClientRect();
  const scale = paper.scale().sx;

  // Determine textarea geometry and font styling
  let left, top, width, height;
  let fontSize = 13 * scale;
  let fontWeight = 600;
  let fontFamily = 'system-ui, -apple-system, sans-serif';
  let textAnchor = 'middle';

  if (target.kind === 'link') {
    // Fit around label if present; otherwise anchor on the double-click point
    if (textEl) {
      const r = textEl.getBoundingClientRect();
      width = Math.max(r.width + 40, 100);
      height = Math.max(r.height + 10, 24);
      left = r.left + r.width / 2 - width / 2 - containerRect.left;
      top = r.top + r.height / 2 - height / 2 - containerRect.top;
      const computed = window.getComputedStyle(textEl);
      fontSize = parseFloat(textEl.getAttribute('font-size') || computed.fontSize || 13) * scale;
    } else {
      width = 120;
      height = 24 * scale;
      left = (evt?.clientX ?? containerRect.left + containerRect.width / 2) - width / 2 - containerRect.left;
      top = (evt?.clientY ?? containerRect.top + containerRect.height / 2) - height / 2 - containerRect.top;
    }
  } else if (target.kind === 'model' && target.prop === 'personName') {
    // Only cover the name-label area for OrgPerson
    const r = textEl.getBoundingClientRect();
    const pad = 2;
    left = r.left - containerRect.left - pad;
    top = r.top - containerRect.top - pad;
    width = Math.max(r.width + pad * 2, 160 * scale);
    height = Math.max(r.height + pad * 2, 22 * scale);
    const computed = window.getComputedStyle(textEl);
    fontSize = parseFloat(textEl.getAttribute('font-size') || computed.fontSize || 13) * scale;
    fontWeight = textEl.getAttribute('font-weight') || computed.fontWeight || 700;
    fontFamily = textEl.getAttribute('font-family') || computed.fontFamily || fontFamily;
    textAnchor = textEl.getAttribute('text-anchor') || 'start';
  } else if (type === 'sf.Note' && target.path === 'subtitle/text') {
    // Note description (R5): cover the subtitle AREA (model x:12 y:38, w-24 × h-48) - the hidden SVG text has a
    // zero bbox, so derive geometry from the note's on-screen box. Multi-line, left-aligned, top-anchored.
    const elRect = cellView.el.getBoundingClientRect();
    left = elRect.left + 12 * scale - containerRect.left;
    top = elRect.top + 38 * scale - containerRect.top;
    width = Math.max(elRect.width - 24 * scale, 60 * scale);
    height = Math.max(elRect.height - 48 * scale, 36 * scale);
    fontSize = (parseFloat(cell.attr('subtitle/fontSize')) || 11) * scale;
    fontWeight = 'normal';
    fontFamily = cell.attr('subtitle/fontFamily') || fontFamily;
    textAnchor = 'start';
  } else {
    // Cover just the label text area (not the whole element)
    const r = textEl.getBoundingClientRect();
    const elRect = cellView.el.getBoundingClientRect();
    const pad = 4;
    const minW = Math.min(elRect.width, 120 * scale);
    const minH = 22 * scale;
    if (r.width > 0 && r.height > 0) {
      width = Math.max(r.width + pad * 2, minW);
      width = Math.min(width, elRect.width + pad * 2);
      height = Math.max(r.height + pad * 2, minH);
      left = r.left + r.width / 2 - width / 2 - containerRect.left;
      top = r.top + r.height / 2 - height / 2 - containerRect.top;
    } else {
      // Empty label — center inside the element
      width = Math.min(Math.max(elRect.width * 0.8, minW), elRect.width);
      height = minH;
      left = elRect.left + elRect.width / 2 - width / 2 - containerRect.left;
      top = elRect.top + elRect.height / 2 - height / 2 - containerRect.top;
    }
    const computed = window.getComputedStyle(textEl);
    fontSize = parseFloat(textEl.getAttribute('font-size') || computed.fontSize || 13) * scale;
    fontWeight = textEl.getAttribute('font-weight') || computed.fontWeight || 'normal';
    fontFamily = textEl.getAttribute('font-family') || computed.fontFamily || fontFamily;
    textAnchor = textEl.getAttribute('text-anchor') || 'middle';
  }

  const overlay = document.createElement('div');
  overlay.className = 'df-inline-edit';

  const textarea = document.createElement('textarea');
  textarea.className = 'df-inline-edit__input';
  textarea.value = currentText;

  textarea.style.cssText = `
    position: absolute;
    left: ${left}px;
    top: ${top}px;
    width: ${width}px;
    height: ${height}px;
    font-size: ${fontSize}px;
    font-weight: ${fontWeight};
    font-family: ${fontFamily};
    text-align: ${textAnchor === 'middle' ? 'center' : 'left'};
    line-height: 1.3;
    color: var(--text-primary);
    background: var(--bg-canvas);
    border: 2px solid var(--selection-color);
    border-radius: 4px;
    padding: ${4 * scale}px ${6 * scale}px;
    outline: none;
    resize: none;
    overflow: hidden;
    z-index: 100;
    box-sizing: border-box;
  `;

  overlay.appendChild(textarea);
  canvasContainer.appendChild(overlay);

  // Hide the source text (and subtitle for primary label) while editing
  if (textEl) textEl.style.opacity = '0';
  const subtitleEl = target.kind === 'attr' && target.selector === 'label'
    ? cellView.el.querySelector('text[joint-selector="subtitle"]')
    : null;
  if (subtitleEl) subtitleEl.style.opacity = '0';

  // Grow the textarea vertically as the user adds lines (keeps centering fixed)
  const initialTop = top;
  const initialHeight = height;
  const autosize = () => {
    textarea.style.height = 'auto';
    const grown = Math.max(textarea.scrollHeight, initialHeight);
    textarea.style.height = grown + 'px';
    // Re-center vertically around the original midline so extra lines grow both ways
    textarea.style.top = (initialTop - (grown - initialHeight) / 2) + 'px';
  };
  textarea.addEventListener('input', autosize);

  textarea.focus();
  textarea.select();
  autosize();

  const finish = () => {
    if (overlay._finished) return;
    overlay._finished = true;

    const newText = textarea.value;
    if (newText !== currentText) {
      commit(newText);
      if (type === 'sf.SimpleNode') updateSimpleNodeLayout(cell);
      const ids = selection.getSelectedIds();
      if (ids.length === 1 && ids[0] === cell.id) showProperties(cell);
    }

    if (textEl) textEl.style.opacity = '';
    if (subtitleEl) subtitleEl.style.opacity = '';
    overlay.remove();
  };

  textarea.addEventListener('blur', finish);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      textarea.value = currentText;
      textarea.blur();
    }
    e.stopPropagation();
  });
}

// ── Mobile: hide stencil while properties is open, restore on close ──
let stencilWasOpen = false;

function hideStencilForProperties() {
  if (window.innerWidth > 768) return;
  if (stencilModule.isHidden && !stencilModule.isHidden()) {
    stencilWasOpen = true;
    stencilModule.hide();
  }
}

function restoreStencilAfterProperties() {
  if (window.innerWidth > 768) { stencilWasOpen = false; return; }
  if (stencilWasOpen && stencilModule.show) {
    stencilModule.show();
  }
  stencilWasOpen = false;
}

function showProperties(cell) {
  const wasHidden = panelEl.classList.contains('df-properties--hidden');
  panelEl.classList.remove('df-properties--hidden');
  if (wasHidden) hideStencilForProperties();
  syncMobilePanelHeight(panelEl);
  bodyEl.innerHTML = '';
  footerEl.innerHTML = '';

  const type = cell.get('type') || '';
  const typeLabel = TYPE_LABELS[type] || type.replace('sf.', '') || 'Element';

  if (cell.isLink()) {
    typeBadgeEl.textContent = 'Connector';
    // titleEl carries ONLY the user's label — if the connector has none, the
    // title row collapses (CSS `:empty { display: none }`). Previous behaviour
    // showed 'Unnamed' here, which duplicated information the badge already
    // gave and added zero signal.
    titleEl.textContent = cell.labels()?.[0]?.attrs?.text?.text || '';
  } else {
    typeBadgeEl.textContent = cell.get('iconMode') ? 'Icon' : typeLabel;
    const labelText = cell.get('_savedLabel') || cell.get('objectName') || cell.attr('label/text') || cell.attr('headerLabel/text') || '';
    // Same convention: titleEl is the user's label only. When empty, the
    // title row hides, leaving just the type badge above the first section.
    titleEl.textContent = labelText;
  }

  if (type === 'sf.SimpleNode')       renderSimpleNodeProps(cell);
  else if (type === 'sf.Container')  renderContainerProps(cell);
  else if (type === 'sf.TextLabel')  renderTextLabelProps(cell);
  else if (type === 'sf.Note')       renderNoteProps(cell);
  else if (type === 'sf.Zone')       renderZoneProps(cell);
  else if (type === 'sf.TaskGroup')  renderTaskGroupProps(cell);
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
  else if (type === 'sf.GanttMarker') renderGanttMarkerProps(cell);
  else if (type === 'sf.GanttTimeline') renderGanttTimelineProps(cell);
  else if (type === 'sf.GanttGroup') renderGanttGroupProps(cell);
  else if (type === 'sf.OrgPerson') renderOrgPersonProps(cell);
  else if (type === 'sf.Task')      renderTaskProps(cell);
  else if (type === 'sf.SequenceParticipant') renderSequenceParticipantProps(cell);
  else if (type === 'sf.SequenceActor')       renderSequenceActorProps(cell);
  else if (type === 'sf.SequenceActivation')  renderSequenceActivationProps(cell);
  else if (type === 'sf.SequenceFragment')    renderSequenceFragmentProps(cell);
  else if (type === 'sf.Line')     renderLineProps(cell);
  else if (type === 'sf.Link')     renderLinkElementProps(cell);
  else if (type === 'sf.Image')    renderImageProps(cell);
  else if (cell.isLink())            renderLinkProps(cell);

  // Generic: keep any "Width"/"Height" inputs in the rendered panel synced
  // with the live cell size, so corner-handle resizes update the numbers in
  // real time instead of waiting for the next selection cycle.
  bindLiveSizeInputs(cell);

  // Don't auto-focus inputs on single click — single click selects, double click edits.
}

// ── Live size sync ──────────────────────────────────────────────────
// Holds the currently-bound { cell, handler } so we can detach when the
// panel re-renders or hides. Detached listeners would otherwise keep firing
// against stale DOM references.
let activeSizeListener = null;

function clearActiveSizeListener() {
  if (!activeSizeListener) return;
  try { activeSizeListener.cell.off('change:size', activeSizeListener.fn); } catch {}
  activeSizeListener = null;
}

function bindLiveSizeInputs(cell) {
  clearActiveSizeListener();
  const findInput = (labelText) => {
    const lbl = [...bodyEl.querySelectorAll('.df-properties__label')]
      .find(l => l.textContent.trim() === labelText);
    return lbl?.parentElement?.querySelector('input[type="number"]') || null;
  };
  const widthInput = findInput('Width');
  const heightInput = findInput('Height');
  if (!widthInput && !heightInput) return;
  const fn = () => {
    const sz = cell.size();
    // Don't clobber a value the user is actively typing into.
    if (widthInput && document.activeElement !== widthInput) widthInput.value = sz.width;
    if (heightInput && document.activeElement !== heightInput) heightInput.value = sz.height;
  };
  cell.on('change:size', fn);
  activeSizeListener = { cell, fn };
}

function showMultiProperties(count) {
  const wasHidden = panelEl.classList.contains('df-properties--hidden');
  panelEl.classList.remove('df-properties--hidden');
  if (wasHidden) hideStencilForProperties();
  // Multi-select follows the same convention as single-select: the typeBadge
  // carries the system-supplied identifier (count + "Selected"), the titleEl
  // is reserved for the user's own content and stays empty here. The CSS
  // `:empty` rule collapses the title row so the panel looks structurally
  // identical to a single shape with no label.
  typeBadgeEl.textContent = `${count} Selected`;
  titleEl.textContent = '';
  bodyEl.innerHTML = '';
  footerEl.innerHTML = '';

  const ids = selection.getSelectedIds();
  const cells = ids.map(id => graph.getCell(id)).filter(Boolean);
  const elements = cells.filter(c => c.isElement());
  const links = cells.filter(c => c.isLink());

  // ── Connectors — shared appearance for the selected links (Colour / Line style / Line
  // width). Shown for ANY selection that includes links (pure-link or mixed) so many
  // connectors can be recoloured at once; each control applies to every selected link in ONE
  // undo step. (Previously a pure-link multi-select read "No elements selected" — no edits.)
  // refresh() only re-renders a SINGLE-cell panel, so the multi panel re-renders itself by
  // re-running showMultiProperties — needed when a control changes which fields apply
  // (Connection type → mapping fields appear/vanish; Mapping type → Expression discloses).
  const rerenderMulti = () => showMultiProperties(count);

  const renderConnectorSection = () => {
    if (links.length === 0) return;

    // ── Mapping (Data Cloud) — shown when EVERY selected link is a field→field connector, so a
    // batch of mappings (e.g. one source field fanned to several DMOs) can take one shared
    // Connection type / Mapping type / Expression in a single undo step. Mirrors the single-link
    // Content controls; each applies to every selected mapping link.
    const isFieldToField = (l) => {
      const s = l.get('source'), t = l.get('target');
      return typeof s?.port === 'string' && s.port.startsWith('field-')
          && typeof t?.port === 'string' && t.port.startsWith('field-');
    };
    if (links.every(isFieldToField)) {
      const mapSec = section(bodyEl, 'Mapping');
      const kinds = links.map(l => l.prop('linkKind') === 'mapping' ? 'mapping' : 'relationship');
      addSegmented(mapSec, 'Connection type', kinds[0], [
        { value: 'relationship', label: 'Relationship' },
        { value: 'mapping', label: 'Mapping' },
      ], v => {
        history.startBatch();
        try { links.forEach(l => applyLinkConnectionType(l, v)); } finally { history.endBatch(); }
        rerenderMulti();   // mapping fields appear (→ mapping) or vanish (→ relationship)
      });
      if (links.every(l => l.prop('linkKind') === 'mapping')) {
        const types = links.map(l => MAPPING_TYPES.includes(l.prop('mappingType')) ? l.prop('mappingType') : 'Standard');
        const sameType = types.every(t => t === types[0]);
        addSelect(mapSec, 'Mapping type', sameType ? types[0] : 'Standard',
          MAPPING_TYPES.map(t => ({ value: t, label: t })), v => {
            history.startBatch();
            try { links.forEach(l => applyLinkMappingType(l, v)); } finally { history.endBatch(); }
            rerenderMulti();   // Expression discloses/hides for the new shared type
          });
        // Expression / rules — disclosed once the selection shares a single non-Standard type
        // (the "same field, same transformation across DMOs" case). Blank = mixed: type to set all.
        if (sameType && types[0] !== 'Standard') {
          const exprs = links.map(l => l.prop('expressionRule') || l.prop('mappingLabel') || '');
          const sameExpr = exprs.every(e => e === exprs[0]);
          addText(mapSec, 'Expression / rules', sameExpr ? exprs[0] : '', v => {
            history.startBatch();
            try { links.forEach(l => applyLinkExpression(l, v)); } finally { history.endBatch(); }
          }, null, sameExpr ? undefined : { placeholder: 'Multiple - type to set all' });
        }
      }
    }

    const sec = section(bodyEl, 'Connectors');
    const strokes = links.map(l => l.attr('line/stroke')).filter(v => v != null && v !== '');
    const sameStroke = strokes.length === links.length && strokes.every(s => s === strokes[0]);
    addColorMulti(sec, 'Color', sameStroke ? strokes[0] : null, v => {
      history.startBatch();
      try { links.forEach(l => applyLinkStroke(l, v)); } finally { history.endBatch(); }
    });
    const styles = links.map(l => l.prop('lineStyle') || 'none');
    const sameStyle = styles.every(s => s === styles[0]);
    addSelect(sec, 'Line style', sameStyle ? styles[0] : 'none', LINK_LINE_STYLE_OPTS, v => {
      history.startBatch();
      try { links.forEach(l => applyLinkLineStyle(l, v)); } finally { history.endBatch(); }
    });
    const widths = links.map(l => l.attr('line/strokeWidth') ?? 2);
    const sameWidth = widths.every(w => w === widths[0]);
    addNumber(sec, 'Line width', sameWidth ? widths[0] : '', v => {
      history.startBatch();
      try { links.forEach(l => applyLinkStrokeWidth(l, v)); } finally { history.endBatch(); }
    });
  };

  if (elements.length === 0) {
    // Pure-connector selection — the element-centric sections below don't apply.
    if (links.length === 0) {
      bodyEl.innerHTML = `<p class="df-properties__multi-msg">No editable cells selected.</p>`;
    } else {
      renderConnectorSection();
    }
    addDeleteBtn(footerEl, () => { graph.removeCells(cells); selection.clearSelection(); });
    return;
  }

  // Mixed selection (elements + links): connector appearance first, then the element sections.
  renderConnectorSection();

  // ── Colors section — only shown when the selected types have at least
  // one shared color slot. We intersect each type's schema by label so we
  // never offer a color field that doesn't actually apply to every
  // selected element.
  const perTypeSchemas = elements.map(c => COLOR_SCHEMA[c.get('type')] || []);
  const sharedLabels = perTypeSchemas.length === 0 ? [] :
    perTypeSchemas[0]
      .map(e => e.label)
      .filter(label => perTypeSchemas.every(schema => schema.some(e => e.label === label)));

  if (sharedLabels.length > 0) {
    const colorSec = section(bodyEl, 'Appearance');
    sharedLabels.forEach(label => {
      // Collect current value + per-element setter for this label
      const entries = elements.map(c => {
        const schema = COLOR_SCHEMA[c.get('type')] || [];
        return { cell: c, entry: schema.find(e => e.label === label) };
      });
      const values = entries
        .map(({ cell, entry }) => entry?.get(cell))
        .filter(v => v != null && v !== '');
      const allSame = values.length === entries.length &&
        values.every(v => v === values[0]);
      addColorMulti(colorSec, label,
        allSame ? values[0] : null,
        v => entries.forEach(({ cell, entry }) => entry?.set(cell, v))
      );
    });
  }

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

  // ── Shared appearance (corner radius) — only for SimpleNodes ──
  // Only makes sense when EVERY selected element is a SimpleNode; otherwise
  // applying a corner radius to mixed types would be meaningless.
  if (elements.length > 0 && elements.every(c => c.get('type') === 'sf.SimpleNode')) {
    const appearanceSec = section(bodyEl, 'Appearance');
    const radii = elements.map(c => c.attr('body/rx') ?? 8);
    const allSameR = radii.every(r => r === radii[0]);
    addNumber(appearanceSec, 'Corner radius', allSameR ? radii[0] : 8, v => {
      elements.forEach(c => { c.attr('body/rx', v); c.attr('body/ry', v); });
    });
  }

  // ── Sequence lifeline — port count — only when every selected element is
  // a sequence shape with a configurable lifeline. For actors, the port
  // count only takes effect when their lifeline is currently shown (the
  // rebuilder still stores the count so it applies on next Show).
  const SEQ_WITH_PORTS = new Set([
    'sf.SequenceParticipant',
    'sf.SequenceActor',
    'sf.SequenceActivation',
  ]);
  if (elements.length > 1 && elements.every(c => SEQ_WITH_PORTS.has(c.get('type')))) {
    const seqSec = section(bodyEl, 'Lifeline');
    const counts = elements.map(c => c.get('lifelinePortCount') ?? (c.get('type') === 'sf.SequenceActivation' ? 2 : 5));
    const allSameCount = counts.every(n => n === counts[0]);
    addNumber(seqSec, 'Ports', allSameCount ? counts[0] : '', v => {
      const n = Math.max(1, v | 0);
      elements.forEach(c => {
        const t = c.get('type');
        if (t === 'sf.SequenceParticipant') joint.shapes.sf.rebuildSeqParticipantPorts(c, n);
        else if (t === 'sf.SequenceActor') {
          // Only rebuild ports when the actor's lifeline is actually visible;
          // otherwise just store the count so re-showing the lifeline picks
          // it up (rebuildSeqActorPorts sets lifelinePortCount either way).
          if (c.get('showLifeline')) joint.shapes.sf.rebuildSeqActorPorts(c, n);
          else c.set('lifelinePortCount', n);
        }
        else if (t === 'sf.SequenceActivation') joint.shapes.sf.rebuildSeqActivationPorts(c, n);
      });
    });
  }

  // ── Actions section (Order, Auto-size, Convert) ──
  const actionSec = section(bodyEl, 'Actions');

  // Order: Bring to Front / Send to Back
  const orderRow = document.createElement('div');
  orderRow.className = 'df-prop-pair';

  const multiFrontBtn = document.createElement('button');
  multiFrontBtn.className = 'df-properties__btn df-properties__btn--order';
  multiFrontBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 2h12v2H2zM4 6h8v2H4zM6 10h4v4H6z"/>
    </svg>
    Bring to Front`;
  multiFrontBtn.addEventListener('click', () => {
    history.startBatch();
    try {
      elements.forEach(c => {
        const type = c.get('type');
        const tierBase = Z_BASE[type] ?? 2000;
        const peers = graph.getElements().filter(el => !ids.includes(el.id) && el.get('z') >= tierBase && el.get('z') < tierBase + Z_TIER_SPAN);
        const maxZ = peers.length ? Math.max(...peers.map(el => el.get('z') ?? tierBase)) : tierBase;
        const oldZ = c.get('z'); const newZ = maxZ + 1;
        if (oldZ === newZ) return;
        c.set('z', newZ);
        const id = c.id;
        history.recordCommand(
          () => { const cc = graph.getCell(id); if (cc) cc.set('z', oldZ); },
          () => { const cc = graph.getCell(id); if (cc) cc.set('z', newZ); });
      });
    } finally { history.endBatch(); }
  });

  const multiBackBtn = document.createElement('button');
  multiBackBtn.className = 'df-properties__btn df-properties__btn--order';
  multiBackBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 2h4v4H6zM4 8h8v2H4zM2 12h12v2H2z"/>
    </svg>
    Send to Back`;
  multiBackBtn.addEventListener('click', () => {
    history.startBatch();
    try {
      elements.forEach(c => {
        const type = c.get('type');
        const tierBase = Z_BASE[type] ?? 2000;
        const peers = graph.getElements().filter(el => !ids.includes(el.id) && el.get('z') >= tierBase && el.get('z') < tierBase + Z_TIER_SPAN);
        const minZ = peers.length ? Math.min(...peers.map(el => el.get('z') ?? tierBase)) : tierBase;
        const oldZ = c.get('z'); const newZ = Math.max(tierBase, minZ - 1);
        if (oldZ === newZ) return;
        c.set('z', newZ);
        const id = c.id;
        history.recordCommand(
          () => { const cc = graph.getCell(id); if (cc) cc.set('z', oldZ); },
          () => { const cc = graph.getCell(id); if (cc) cc.set('z', newZ); });
      });
    } finally { history.endBatch(); }
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

  // Clone strip — primary "Clone" + optional connector-aware sub-buttons,
  // matching the single-element panel.
  const cloneWrap = document.createElement('div');
  cloneWrap.className = 'df-clone-strip';

  const primaryClone = document.createElement('button');
  primaryClone.className = 'df-properties__btn df-properties__btn--clone';
  primaryClone.innerHTML = `${CLONE_ICON_SVG} Clone`;
  primaryClone.addEventListener('click', () => { clipboardDuplicate(); });
  cloneWrap.appendChild(primaryClone);

  const externalCount = countExternalConnectors(elements);
  const externalConnectedCount = countExternalConnectedConnectors(elements);

  const addMultiCloneSub = (label, mode) => {
    const sub = document.createElement('button');
    sub.className = 'df-properties__btn df-properties__btn--clone df-properties__btn--clone-sub';
    sub.innerHTML = `${CLONE_ICON_SVG} Clone ${label}`;
    sub.addEventListener('click', () => cloneSelectionWithMode(mode));
    cloneWrap.appendChild(sub);
  };

  if (externalCount > 0) {
    addMultiCloneSub('with Connectors', 'dangling');
  }
  if (externalConnectedCount > 0) {
    addMultiCloneSub('with connected Connectors', 'connected');
  }

  footerEl.appendChild(cloneWrap);

  // Save as Template — pinned directly below the Clone strip. Shares the
  // footer-button base (`.df-properties__btn` + shared --convert/--clone
  // sizing), so it's dimensionally identical to the Clone button above it.
  addActionBtn(footerEl, 'Save as Template', () => saveSelectionAsTemplate());

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

  // Convert buttons (if all are Nodes or all are Containers). Gap 7
  // (v1.12.0) — surface the icon-mode-aware option too so a multi-select
  // of icon nodes mirrors the single-element panel's "Convert to Node".
  const allIconNodes = allNodes && elements.every(c => c.get('iconMode'));
  const noIconNodes = allNodes && elements.every(c => !c.get('iconMode'));
  if (allIconNodes) {
    addActionBtn(footerEl, 'Convert all to Node', () => {
      const selectedBefore = [...ids];
      selectedBefore.forEach(id => {
        const c = graph.getCell(id);
        if (c && c.get('type') === 'sf.SimpleNode' && c.get('iconMode')) convertFromIcon(c);
      });
    });
    addActionBtn(footerEl, 'Convert all to Container', () => {
      const selectedBefore = [...ids];
      selection.clearSelection();
      selectedBefore.forEach(id => {
        const c = graph.getCell(id);
        if (c && c.get('type') === 'sf.SimpleNode') convertToContainer(c);
      });
    });
  } else if (noIconNodes) {
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
  } else if (allNodes) {
    // Mixed (some icon, some regular SimpleNodes) — only the cross-type
    // conversion makes sense; "to Icon" would no-op on already-icons.
    addActionBtn(footerEl, 'Convert all to Container', () => {
      const selectedBefore = [...ids];
      selection.clearSelection();
      selectedBefore.forEach(id => {
        const c = graph.getCell(id);
        if (c && c.get('type') === 'sf.SimpleNode') convertToContainer(c);
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
    addActionBtn(footerEl, 'Convert all to Icon', () => {
      const selectedBefore = [...ids];
      selectedBefore.forEach(id => {
        const c = graph.getCell(id);
        if (c && c.get('type') === 'sf.Container') convertContainerToIcon(c);
      });
    });
  }

  // Delete All
  const delWrap = document.createElement('div');
  delWrap.className = 'df-delete-strip';
  const delBtn = document.createElement('button');
  delBtn.className = 'df-properties__btn df-properties__btn--delete';
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
    titleEl.textContent = v || '';
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
  addColor(appearance, 'Label color',   cell.attr('label/fill'),  v => {
    cell.attr('label/fill', v);
    cell.attr('subtitle/fill', v);
    recolorCellIcon(cell, v);
  });
  if (!isIcon) {
    addNumber(appearance, 'Corner radius', cell.attr('body/rx') ?? 8,
      v => { cell.attr('body/rx', v); cell.attr('body/ry', v); });
  }

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  if (isIcon) {
    addNumber(size, 'Size', cell.size().width, v => {
      cell.resize(v, v);
      const r = v / 2;
      cell.attr('body/rx', r);
      cell.attr('body/ry', r);
      const pad = Math.round(v * 0.2);
      const iconSz = v - pad * 2;
      cell.attr('icon/x', pad);
      cell.attr('icon/y', pad);
      cell.attr('icon/width', iconSz);
      cell.attr('icon/height', iconSz);
    });
  } else {
    addNumberPair(size,
      'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
      'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  }
  addAutoSizeBtn(size, () => {
    if (isIcon) {
      cell.resize(64, 64);
      cell.attr({ body: { rx: 32, ry: 32 }, icon: { x: 16, y: 16, width: 32, height: 32 } });
    } else {
      const def = DEFAULT_SIZES['sf.SimpleNode'];
      cell.resize(def.width, def.height);
    }
  });
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell);

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
  addText(content, 'Label', cell.attr('headerLabel/text'), v => {
    cell.attr('headerLabel/text', v);
    titleEl.textContent = v || '';
  }, cell);
  addTextarea(content, 'Description', cell.attr('headerSubtitle/text'), v => cell.attr('headerSubtitle/text', v));
  addIconPicker(content, 'Icon', cell.attr('headerIcon/href'), v => cell.attr('headerIcon/href', v),
    () => resolveColor(cell.attr('headerLabel/fill')) || '#FFFFFF');
  // Tags + RACI — primarily for the Team variant in Org Chart diagrams, but
  // available on every Container. Empty values render nothing on canvas, so
  // they're invisible until used.
  addChipInput(content, 'Tags', cell.get('tags') || [], v => cell.set('tags', v));
  addRaciPicker(content, 'RACI', cell.get('raci') || {}, v => cell.set('raci', v));

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Accent',      cell.attr('accent/fill'),     v => { cell.attr('accent/fill', v); cell.attr('accentFill/fill', v); });
  addColor(appearance, 'Fill',        cell.attr('body/fill'),        v => cell.attr('body/fill', v));
  addColor(appearance, 'Border',      cell.attr('body/stroke'),      v => cell.attr('body/stroke', v));
  addColor(appearance, 'Label color', cell.attr('headerLabel/fill'), v => {
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
  addOrderButtons(size, cell);

  // Convert + Delete (in footer)
  addConvertBtn(footerEl, 'Convert to Node', () => convertToNode(cell));
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderTextLabelProps(cell) {
  // Content — primary editable text only.
  const content = section(bodyEl, 'Content');
  const labelInput = addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
  });
  // CR-6.1: markdown shortcuts (Cmd+B/I/Shift+X/E) + hint below the input.
  wireMarkdownShortcuts(labelInput, content);

  // Appearance — typography styling. Sits in its own section so the panel
  // matches the universal Content / Appearance / Size & Order rhythm.
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Label color', cell.attr('label/fill'), v => cell.attr('label/fill', v));
  // Font size moved to the Size & Order section (item 1) - added generically there for every text shape.

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addRotationField(size, cell);
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES['sf.TextLabel'];
    cell.resize(def.width, def.height);
  });
  addOrderButtons(size, cell);

  // Delete (in footer)
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderLineProps(cell) {
  // Unicode box-drawing previews so the picklist shows a sample of each
  // stroke pattern alongside the name — native <select> can't render
  // inline SVG, but these chars are stable across macOS / Windows / Linux
  // system fonts and read as "what the line will look like".
  //
  // Layout: name (padded to a fixed width) → gap → line sample. Padding
  // is in non-breaking spaces ( ) because plain ASCII spaces are
  // collapsed/shrunk by most option renderers and the lines drift out of
  // alignment. The 8-char padEnd target is "Dashed" (6) + 2 spaces of
  // breathing room.
  // Em-space (U+2003) is a 1em typographic char that browsers don't
  // collapse in <option> text, unlike ASCII spaces. Strict column
  // alignment is impossible in a native <select> (the OS owns popup
  // font/spacing) so we use a consistent visible gap and tune line
  // samples to roughly equal visual length. Dashed is the reference;
  // Solid/Breaks were trimmed to match; Dotted uses U+00B7 middle dots
  // (U+2508 renders 3-dots-per-glyph and looks uneven with spaces).
  const EM = ' ';
  const GAP = EM + EM + EM;
  const LINE_STYLES = [
    { value: 'solid',  label: `Solid${GAP}─────` },
    { value: 'dashed', label: `Dashed${GAP}╌ ╌ ╌ ╌ ╌` },
    { value: 'dotted', label: `Dotted${GAP}· · · · · · ·` },
    { value: 'breaks', label: `Breaks${GAP}── ── ──` },
  ];

  function applyLineStyle(style) {
    // Wrap both writes in a single batch — `change:lineStyle` and
    // `change:attrs` each push their own undo entry otherwise, forcing
    // the user to hit Undo twice for a single Style change.
    history.startBatch();
    try {
      cell.set('lineStyle', style);
      // Patterns chosen to match the picklist previews 1:1 (the line has
      // stroke-linecap:round, so `0 6` paints round dots; `16 8` = clean
      // long-dashes). Previously dotted `3 4` read as small dashes and breaks
      // `16 8 2 8` was a dash-DOT — neither matched its preview.
      const dashMap = { solid: 'none', dashed: '12 6', dotted: '0 6', breaks: '16 8' };
      cell.attr('line/strokeDasharray', dashMap[style] || 'none');
    } finally {
      history.endBatch();
    }
  }

  // Content — optional caption rendered above the line. Empty by default.
  // Markdown supported, with the same shortcuts + hint as the Note description.
  const content = section(bodyEl, 'Content');
  const labelInput = addTextarea(content, 'Label', cell.attr('label/text') || '',
    v => cell.attr('label/text', v));
  wireMarkdownShortcuts(labelInput, content);

  // Appearance — canonical line ordering: Color → Line style → Line width
  // (identity first, then variant, then measurement).
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Color', cell.attr('line/stroke'), v => cell.attr('line/stroke', v));
  addSelect(appearance, 'Line style', cell.get('lineStyle') || 'solid', LINE_STYLES, v => applyLineStyle(v));
  addNumber(appearance, 'Line width', cell.attr('line/strokeWidth') ?? 2, v => cell.attr('line/strokeWidth', v));

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addRotationField(size, cell);
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES['sf.Line'];
    cell.resize(def.width, def.height);
  });
  addOrderButtons(size, cell);

  // Footer
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderLinkElementProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
  });
  addText(content, 'URL', cell.get('url') || '', v => {
    cell.set('url', v);
    const domain = extractLinkDomain(v);
    cell.attr('domain/text', domain);
    cell.attr('label/y', domain ? 'calc(0.5 * h - 8)' : 'calc(0.5 * h)');
  });

  // Appearance — canonical: Fill → Border → typography (Label color, Font size)
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill',   cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => cell.attr('body/stroke', v));
  addColor(appearance, 'Label color', cell.attr('label/fill'), v => {
    cell.attr('label/fill', v);
    cell.attr('iconImage/href', getStencilSvgDataUri(COMPONENT_SVG.linkIcon, v, 20));
  });
  // Font size moved to the Size & Order section (item 1) - added generically there for every text shape.

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES['sf.Link'];
    cell.resize(def.width, def.height);
  });
  addOrderButtons(size, cell);

  // Footer
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderNoteProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
  }, cell);
  // CR-6.1: the multi-line Description gets the markdown shortcuts + hint.
  // The single-line Label heading stays plain text — markdown there would
  // be inconsistent with the ellipsis/truncation behaviour.
  const descInput = addTextarea(content, 'Description', cell.attr('subtitle/text'),
    v => cell.attr('subtitle/text', v));
  wireMarkdownShortcuts(descInput, content);
  // Item 1.2: the icon picker also records whether the user CLEARED the icon (`iconCleared`), so the on-load
  // self-heal won't re-add the default light-bulb to a note the user deliberately emptied, and shifts the
  // heading left (to the description indent) when the icon is gone.
  addIconPicker(content, 'Icon', cell.attr('icon/href'), v => {
    cell.attr('icon/href', v);
    cell.set('iconCleared', !v);   // empty = user removed it; a picked icon clears the flag
    updateNoteIconLayout(cell);
  }, () => cell.attr('label/fill') || '#5D4037');

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill',       cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  // Border also recolours the folded corner (fold fill + stroke) so the user controls the dog-ear (#8).
  addColor(appearance, 'Border',     cell.attr('body/stroke'), v => { cell.attr('body/stroke', v); cell.attr('fold/stroke', v); cell.attr('fold/fill', v); });
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
  addOrderButtons(size, cell);

  // Footer
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderImageProps(cell) {
  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Border', cell.attr('body/stroke') ?? 'var(--node-border)',
    v => cell.attr('body/stroke', v));
  addNumber(appearance, 'Border width', cell.attr('body/strokeWidth') ?? 1,
    v => cell.attr('body/strokeWidth', Math.max(0, v)));
  // Corner radius — drives both the body's rounded border AND the image's
  // CSS clip-path so the photo itself is clipped to match the rounded edges
  // (an SVG <image> doesn't accept rx/ry directly, so clip-path is required).
  addNumber(appearance, 'Corner radius', cell.attr('body/rx') ?? 8, v => {
    const r = Math.max(0, v);
    history.startBatch();
    try {
      cell.attr('body/rx', r);
      cell.attr('body/ry', r);
      cell.attr('image/style', `clip-path:inset(0 round ${r}px);-webkit-clip-path:inset(0 round ${r}px)`);
    } finally {
      history.endBatch();
    }
  });

  // Replace image — runs the same pick+resize pipeline used for the initial
  // drop, then swaps the data URI in place.
  const replaceBtn = document.createElement('button');
  replaceBtn.className = 'df-properties__btn df-properties__btn--auto-size';
  replaceBtn.style.marginTop = '6px';
  replaceBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="2" y="3" width="12" height="10" rx="1.5"/>
      <circle cx="5" cy="6" r="1" fill="currentColor" stroke="none"/>
      <path d="M2 12l3-3 2 2 3-3 4 4"/>
    </svg>
    Replace image`;
  // Click handler stays SYNCHRONOUS into startImageAddFlow so Safari's
  // user-gesture chain reaches `input.click()` intact (same constraint as
  // the stencil drop path).
  replaceBtn.addEventListener('click', () => {
    startImageAddFlow(graph, (result) => {
      history.startBatch();
      try {
        cell.attr('image/href', result.dataURI);
        // Resize the cell to match the new image's aspect ratio while keeping
        // the user's chosen on-canvas footprint roughly intact.
        const current = cell.size();
        const { width: nw, height: nh } = result;
        if (nw && nh) {
          const ratio = Math.min(current.width / nw, current.height / nh);
          const w = Math.round(nw * ratio);
          const h = Math.round(nh * ratio);
          cell.resize(w, h);
        }
      } finally {
        history.endBatch();
      }
    });
  });
  appearance.appendChild(replaceBtn);

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addOrderButtons(size, cell);

  // Footer
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderZoneProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
  });

  // Appearance — canonical order: Fill → Border → Label colour
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill',   cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => cell.attr('body/stroke', v));
  addColor(appearance, 'Label color', cell.attr('label/fill') || 'var(--text-muted)', v => cell.attr('label/fill', v));

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
  addOrderButtons(size, cell);

  // Delete (in footer)
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

// RACI section grouper — same surface as a Zone (label + fill/border + size), but
// its own default size and "Task Group" identity. Drop Tasks inside to build a
// labelled section of RACI rows.
function renderTaskGroupProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
  });

  // Appearance — Fill → Border
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill',   cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => cell.attr('body/stroke', v));

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES['sf.TaskGroup'];
    cell.resize(def.width, def.height);
  });
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell);

  // Delete (in footer)
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderBpmnEventProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
  });
  addSelect(content, 'Type', cell.get('eventType') || 'start', [
    { value: 'start',        label: 'Start' },
    { value: 'intermediate', label: 'Intermediate' },
    { value: 'end',          label: 'End' },
  ], v => {
    cell.set('eventType', v);
    // Apply the per-type color/stroke palette used at creation time.
    if (v === 'end') {
      cell.attr('body/fill', '#F9E3E5');
      cell.attr('body/stroke', '#DA4E55');
      cell.attr('body/strokeWidth', 4);
      cell.attr('innerRing/stroke', 'none');
      cell.attr('icon/fill', '#DA4E55');
    } else if (v === 'intermediate') {
      cell.attr('body/fill', '#FDF1DC');
      cell.attr('body/stroke', '#F6B355');
      cell.attr('body/strokeWidth', 1.5);
      cell.attr('innerRing/stroke', '#F6B355');
      cell.attr('innerRing/strokeWidth', 1.5);
      cell.attr('icon/fill', '#F6B355');
    } else {
      cell.attr('body/fill', '#DCF1E2');
      cell.attr('body/stroke', '#4FAE7B');
      cell.attr('body/strokeWidth', 1.5);
      cell.attr('innerRing/stroke', 'none');
      cell.attr('icon/fill', '#4FAE7B');
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
  addOrderButtons(size, cell);

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderBpmnTaskProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
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
  addOrderButtons(size, cell);

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderBpmnGatewayProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
  });
  const markers = { exclusive: '\u00D7', parallel: '+', inclusive: '\u25CB', event: '\u25C7' };
  addSelect(content, 'Type', cell.get('gatewayType') || 'exclusive', [
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
  addOrderButtons(size, cell);

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderBpmnSubprocessProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
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
  addOrderButtons(size, cell);

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderBpmnLoopProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
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
  addOrderButtons(size, cell);

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderBpmnPoolProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
  });

  // Appearance — canonical: Fill → sub-element fills → Border → typography
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill',        cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Header fill', cell.attr('header/fill'), v => cell.attr('header/fill', v));
  addColor(appearance, 'Border',      cell.attr('body/stroke'), v => cell.attr('body/stroke', v));
  addColor(appearance, 'Label color', cell.attr('label/fill'),  v => cell.attr('label/fill', v));

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell);

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderBpmnDataObjectProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
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
  addOrderButtons(size, cell);

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

// Core Salesforce CRM field types + Data Cloud primitives (the shared dictionary used by
// both the sidebar field editor and the Edit Fields modal). 'Boolean' is the Data Cloud
// primitive alongside the CRM 'Checkbox'; both live in the Boolean compatibility group.
// Salesforce / Data Cloud field data types — the canonical picklist used by the
// DataObject field editor AND, re-exported, by the Data Mapping table edit mode so
// both surfaces offer the exact same options (single source of truth).
export const SF_FIELD_TYPES = [
  'Auto Number', 'Boolean', 'Checkbox', 'Currency', 'Date', 'DateTime', 'Email',
  'Formula', 'ID', 'Lookup', 'Master-Detail', 'Number', 'Percent',
  'Phone', 'Picklist', 'Multi-Picklist', 'Rich Text Area',
  'Text', 'Text Area', 'Long Text Area', 'URL',
];

function renderDataObjectProps(cell) {
  // Content (stores into `objectName` — placeholder hints at the data-model
  // semantic, but the UI label stays "Label" for cross-shape consistency).
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.get('objectName'), v => {
    cell.set('objectName', v);
    cell.attr('headerLabel/text', v);
    titleEl.textContent = v || '';
  }, cell, { placeholder: 'Object name' });
  // Optional contextual header icon — empty by default. Sits under the Label to
  // match the Node / Container icon picker. Account/Contact/Email/Snowflake etc.
  // make a large schema scannable. White to match the header label;
  // updateDataObjectHeaderLayout shows it + shifts the object name right (or
  // restores the left padding when cleared via the picker's × button → onChange('')).
  // addIconPicker batches its onChange, so the href + layout attr writes are one undo step.
  addIconPicker(content, 'Icon', cell.attr('headerIcon/href'),
    v => { cell.attr('headerIcon/href', v); updateDataObjectHeaderLayout(cell); },
    () => '#FFFFFF');

  // Data Cloud mapping metadata — shown only in mapping mode so the default
  // Data Model panel is unchanged when off. Stored as cell attrs (serialize
  // automatically); unset when blank so empty values aren't persisted.
  // Data Cloud category (Profile / Engagement / Other) lives in CONTENT — it's the
  // single object-level mapping attribute, so it no longer warrants its own section.
  // Shown only in mapping mode; a three-position segmented slider with no segment
  // active until the user picks one (uncategorised ⇒ no header badge). Category is
  // optional, so `allowDeselect` lets a click on the active segment clear it back to
  // uncategorised.
  if (isMappingMode()) {
    addSegmented(content, 'Category', cell.get('category') || '', [
      { value: 'Profile', label: 'Profile' },
      { value: 'Engagement', label: 'Engagement' },
      { value: 'Other', label: 'Other' },
    ], v => { cell.set('category', v); }, { allowDeselect: true });
  }

  // Fields lead — the rows are a DataObject's primary content, so they sit
  // directly under Content, ahead of the lighter Appearance (header colour) block.
  const fieldsSec = section(bodyEl, 'Fields');

  renderFieldEditor(fieldsSec, cell);

  // Appearance — header fill is an appearance property.
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Header fill', cell.get('headerColor') || '#1D73C9', v => {
    cell.set('headerColor', v);
    cell.attr('header/fill', v);
    cell.attr('headerCover/fill', v);
  }, { defaultValue: '#1D73C9' });

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumber(size, 'Width', cell.size().width, w => {
    cell.resize(w, cell.size().height);
  });
  addAutoSizeBtn(size, () => resizeDataObjectToFit(cell));
  addOrderButtons(size, cell);

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderFieldEditor(parent, cell) {
  const fields = cell.get('fields') || [];
  const listEl = document.createElement('div');
  listEl.className = 'df-field-list';

  function rebuild() {
    listEl.innerHTML = '';

    // Header row
    const hdr = document.createElement('div');
    hdr.className = 'df-field-row df-field-row--header';
    hdr.innerHTML = '<span>Key</span><span>API Name</span><span>Type</span><span></span>';
    listEl.appendChild(hdr);

    const currentFields = cell.get('fields') || [];
    currentFields.forEach((field, i) => {
      const row = document.createElement('div');
      row.className = 'df-field-row';

      // Key type toggle
      const keyBtn = document.createElement('button');
      keyBtn.className = 'df-field-key df-field-key--' + (field.keyType || 'none');
      keyBtn.textContent = field.keyType === 'pk' ? 'PK' : field.keyType === 'fk' ? 'FK' : field.keyType === 'fqk' ? 'FQK' : '—';
      keyBtn.title = 'Toggle key: None → PK → FK → FQK';
      keyBtn.addEventListener('click', () => {
        const cur = field.keyType;
        const next = cur === 'pk' ? 'fk' : cur === 'fk' ? 'fqk' : cur === 'fqk' ? null : 'pk';
        const updated = [...cell.get('fields')];
        // A primary / fully-qualified key is inherently mandatory — auto-mark required.
        updated[i] = { ...updated[i], keyType: next, ...(next === 'pk' || next === 'fqk' ? { required: true } : {}) };
        cell.set('fields', updated);
        resizeDataObjectToFit(cell);
        rebuild();
      });

      // API Name input
      const apiInput = document.createElement('input');
      apiInput.type = 'text';
      apiInput.className = 'df-field-input df-field-input--api';
      apiInput.value = field.apiName || '';
      apiInput.placeholder = 'API Name';
      apiInput.addEventListener('input', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], apiName: apiInput.value };
        cell.set('fields', updated);
      });

      // Type select
      const typeSelect = document.createElement('select');
      typeSelect.className = 'df-field-input df-field-input--type';
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
      delBtn.className = 'df-field-delete';
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
    addBtn.className = 'df-properties__btn df-properties__btn--add-field';
    addBtn.textContent = '+ Add Field';
    addBtn.addEventListener('click', () => {
      const updated = [...cell.get('fields'), { label: '', apiName: '', type: 'Text', keyType: null, length: '', sampleValues: '' }];
      cell.set('fields', updated);
      resizeDataObjectToFit(cell);
      rebuild();
    });
    listEl.appendChild(addBtn);

    // Edit in Table button
    const fullEditBtn = document.createElement('button');
    fullEditBtn.className = 'df-properties__btn df-properties__btn--full-edit';
    fullEditBtn.textContent = '⊞ Edit in Table';
    fullEditBtn.addEventListener('click', () => openFieldEditorModal(cell, rebuild));
    listEl.appendChild(fullEditBtn);
  }

  rebuild();
  parent.appendChild(listEl);
}

/* ── Full Edit Mode modal for DataObject fields ───────────── */

// A compact checkbox toggle matching the Display menu's checkbox (a square that shows
// a tick when on). Used for the field modal's Required / Deprecated columns
// instead of raw browser checkboxes, for app-consistent styling.
function makeFieldCheckToggle(checked, title, extraClass, onChange) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'df-field-modal__check-toggle' + (extraClass ? ' ' + extraClass : '') + (checked ? ' is-checked' : '');
  btn.title = title;
  btn.setAttribute('role', 'checkbox');
  btn.setAttribute('aria-checked', String(checked));
  btn.innerHTML = '<svg class="df-toolbar__checkbox" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path class="df-toolbar__checkbox-tick" d="M4.5 8l2.5 2.5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  btn.addEventListener('click', () => {
    const next = !btn.classList.contains('is-checked');
    btn.classList.toggle('is-checked', next);
    btn.setAttribute('aria-checked', String(next));
    onChange(next);
  });
  return btn;
}

function openFieldEditorModal(cell, onClose) {
  // Remove any existing modal
  document.getElementById('field-editor-modal')?.remove();

  // buildModal owns the scaffold + focus-trap + focus-restore + backdrop/✕/Escape
  // close. The bespoke borderless ✕ (closeClass + closeHtml) and footer scoping
  // (footerClass) come from the extended factory API; onClose fires the caller's
  // callback after teardown (matches the old close()).
  const { overlay, body: bodyEl, close } = buildModal({
    title: `Edit Fields - ${cell.get('objectName') || 'Object'}`, // textContent - buildModal escapes
    dialogClass: 'df-field-modal__dialog',
    bodyClass: 'df-field-modal__body',
    footerClass: 'df-field-modal__footer',
    closeClass: 'df-field-modal__close',
    closeHtml: '✕',
    footerHtml: `
      <button class="df-properties__btn df-properties__btn--add-field df-field-modal__add">+ Add Field</button>
      <button class="df-modal__btn df-modal__btn--primary df-field-modal__done">Done</button>`,
    onClose,
  });
  overlay.id = 'field-editor-modal';

  function rebuildModal() {
    bodyEl.innerHTML = '';
    const currentFields = cell.get('fields') || [];

    // Header row
    const hdr = document.createElement('div');
    hdr.className = 'df-field-modal__row df-field-modal__row--header';
    hdr.innerHTML = '<span class="df-field-modal__col--handle"></span><span class="df-field-modal__col--key">Key</span><span class="df-field-modal__col--api">API Name</span><span class="df-field-modal__col--label">Label</span><span class="df-field-modal__col--type">Type</span><span class="df-field-modal__col--len">Length</span><span class="df-field-modal__col--sample">Sample Values</span><span class="df-field-modal__col--req">REQUIRED</span><span class="df-field-modal__col--decom">DEPRECATED</span><span class="df-field-modal__col--del"></span>';
    bodyEl.appendChild(hdr);

    currentFields.forEach((field, i) => {
      const row = document.createElement('div');
      row.className = 'df-field-modal__row';
      row.dataset.index = i;

      // Reorder handle
      const handle = document.createElement('span');
      handle.className = 'df-field-modal__col--handle df-field-modal__handle';
      handle.innerHTML = '⠿';
      handle.draggable = true;
      handle.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
        row.classList.add('df-field-modal__row--dragging');
      });
      handle.addEventListener('dragend', () => row.classList.remove('df-field-modal__row--dragging'));

      // Key toggle
      const keyBtn = document.createElement('button');
      keyBtn.className = 'df-field-key df-field-key--' + (field.keyType || 'none') + ' df-field-modal__col--key';
      keyBtn.textContent = field.keyType === 'pk' ? 'PK' : field.keyType === 'fk' ? 'FK' : field.keyType === 'fqk' ? 'FQK' : '—';
      keyBtn.title = 'Toggle key: None → PK → FK → FQK';
      keyBtn.addEventListener('click', () => {
        const next = field.keyType === 'pk' ? 'fk' : field.keyType === 'fk' ? 'fqk' : field.keyType === 'fqk' ? null : 'pk';
        const updated = [...cell.get('fields')];
        // A primary / fully-qualified key is inherently mandatory — auto-mark required.
        updated[i] = { ...updated[i], keyType: next, ...(next === 'pk' || next === 'fqk' ? { required: true } : {}) };
        cell.set('fields', updated);
        resizeDataObjectToFit(cell);
        rebuildModal();
      });

      // API Name
      const apiInput = document.createElement('input');
      apiInput.type = 'text';
      apiInput.className = 'df-field-input df-field-modal__col--api';
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
      labelInput.className = 'df-field-input df-field-modal__col--label';
      labelInput.value = field.label || '';
      labelInput.placeholder = 'Label';
      labelInput.addEventListener('input', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], label: labelInput.value };
        cell.set('fields', updated);
      });

      // Type
      const typeSelect = document.createElement('select');
      typeSelect.className = 'df-field-input df-field-modal__col--type';
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
      lenInput.className = 'df-field-input df-field-modal__col--len';
      lenInput.value = field.length || '';
      lenInput.placeholder = '—';
      lenInput.addEventListener('input', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], length: lenInput.value };
        cell.set('fields', updated);
      });

      // Sample values (optional) — representative example values for the field, surfaced in
      // the Data Mapping table view and CSV exports. Display/export-only: never drawn on the node.
      const sampleInput = document.createElement('input');
      sampleInput.type = 'text';
      sampleInput.className = 'df-field-input df-field-modal__col--sample';
      sampleInput.value = field.sampleValues || '';
      sampleInput.placeholder = 'e.g. Acme, Globex';
      sampleInput.addEventListener('input', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], sampleValues: sampleInput.value };
        cell.set('fields', updated);
      });

      // Required + Deprecated — Display-menu-style checkbox toggles (a tick that
      // appears when on), not raw browser checkboxes, for app-consistent styling.
      const reqCheck = makeFieldCheckToggle(!!field.required, 'Required', 'df-field-modal__col--req', on => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], required: on };
        cell.set('fields', updated);
      });
      const decomCheck = makeFieldCheckToggle(!!field.deprecated, 'Deprecated', 'df-field-modal__col--decom', on => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], deprecated: on };
        cell.set('fields', updated);
      });

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'df-field-delete df-field-modal__col--del';
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
      row.appendChild(sampleInput);
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
        bodyEl.querySelectorAll('.df-field-modal__row').forEach(r => {
          r.classList.remove('df-field-modal__row--drop-above', 'df-field-modal__row--drop-below');
        });
        if (e.clientY < mid) {
          row.classList.add('df-field-modal__row--drop-above');
        } else {
          row.classList.add('df-field-modal__row--drop-below');
        }
      });
      row.addEventListener('dragleave', (e) => {
        // Only remove if leaving the row entirely
        if (!row.contains(e.relatedTarget)) {
          row.classList.remove('df-field-modal__row--drop-above', 'df-field-modal__row--drop-below');
        }
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const rect = row.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        const dropBelow = e.clientY >= mid;
        bodyEl.querySelectorAll('.df-field-modal__row').forEach(r => {
          r.classList.remove('df-field-modal__row--drop-above', 'df-field-modal__row--drop-below');
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
  overlay.querySelector('.df-field-modal__add').addEventListener('click', () => {
    const updated = [...cell.get('fields'), { label: '', apiName: '', type: 'Text', keyType: null, length: '' }];
    cell.set('fields', updated);
    resizeDataObjectToFit(cell);
    rebuildModal();
  });

  // Done closes; backdrop / ✕ / Escape are wired by buildModal.
  overlay.querySelector('.df-field-modal__done').addEventListener('click', close);

  // Import / Export Fields (CSV) — a persistent panel between the (rebuilt) field list
  // and the footer. Three exports/imports + a paste box; importing OVERWRITES every
  // field on this object (behind a confirmation), so the round-trip is: export →
  // edit in a spreadsheet → re-import.
  const dialog = overlay.querySelector('.df-field-modal__dialog');
  const footer = overlay.querySelector('.df-field-modal__footer');
  if (dialog && footer) {
    const objLabel = cell.get('objectName') || 'Object';
    const panel = document.createElement('details');
    panel.className = 'df-csv-tools';
    panel.innerHTML = `
      <summary class="df-csv-tools__summary">Import / Export Fields (CSV)</summary>
      <div class="df-csv-tools__body">
        <div class="df-csv-tools__row">
          <button type="button" class="df-modal__btn df-csv-tools__btn df-csv-tools__sample">Export Sample CSV</button>
          <button type="button" class="df-modal__btn df-csv-tools__btn df-csv-tools__export">Export Fields to CSV</button>
          <button type="button" class="df-modal__btn df-csv-tools__btn df-csv-tools__import-file">Import Fields from CSV…</button>
          <button type="button" class="df-modal__btn df-csv-tools__btn df-csv-tools__import-paste">Import Fields from Paste</button>
        </div>
        <textarea class="df-csv-tools__textarea" rows="4" spellcheck="false" placeholder="API Name,Label,Type,Length,Required,Deprecated,Key,Sample Values&#10;Id,Record ID,ID,,Yes,No,PK,003Ax00000ABCDE&#10;AccountId,Account,Lookup,,Yes,No,FK,001Ax00000XYZab&#10;Email__c,Email,Email,,No,No,,jane@example.com"></textarea>
        <p class="df-csv-tools__hint">Paste rows in the box above, then <strong>Import Fields from Paste</strong>. Columns: <strong>API&nbsp;Name, Label, Type, Length, Required, Deprecated, Key, Sample&nbsp;Values</strong> - a header row is auto-detected; importing <strong>overwrites every field</strong> on this object. Grab the Sample CSV for the full list of valid Type / Key values.</p>
        <span class="df-csv-tools__status" aria-live="polite"></span>
        <input type="file" accept=".csv,text/csv" class="df-csv-tools__file" hidden>
      </div>`;
    dialog.insertBefore(panel, footer);

    const status = panel.querySelector('.df-csv-tools__status');
    const ta = panel.querySelector('.df-csv-tools__textarea');
    const fileInput = panel.querySelector('.df-csv-tools__file');
    const setStatus = (msg, err) => { status.textContent = msg; status.classList.toggle('df-csv-tools__status--err', !!err); };

    // Import = OVERWRITE, behind a confirmation. The whole ingestion (field replace +
    // auto-resize) is wrapped in ONE explicit history batch so it collapses to a single
    // undo entry — flushPendingDragCommit folds the debounce-merged change:fields/size
    // into the open batch before it closes.
    const doImport = async (text) => {
      const parsed = parseBulkFields(text);
      if (!parsed.length) { setStatus('No valid rows found - check the format (see Sample CSV).', true); return; }
      const prevCount = (cell.get('fields') || []).length;
      const ok = await confirmModal({
        title: 'Overwrite fields?',
        message: `This replaces all ${prevCount} field${prevCount === 1 ? '' : 's'} on “${objLabel}” with ${parsed.length} imported field${parsed.length === 1 ? '' : 's'}. You can undo it afterwards.`,
        okLabel: 'Overwrite',
        cancelLabel: 'Cancel',
        tone: 'danger',
      });
      if (!ok) { setStatus('Import cancelled.'); return; }
      history.startBatch();
      try {
        cell.set('fields', parsed);              // OVERWRITE the whole field list
        resizeDataObjectToFit(cell);
        history.flushPendingDragCommit();        // fold field + size changes into this batch
      } finally {
        history.endBatch();
      }
      ta.value = '';
      setStatus(`Imported ${parsed.length} field${parsed.length === 1 ? '' : 's'} (replaced ${prevCount}).`);
      rebuildModal();
    };

    // Filesystem-safe, cross-platform filenames (df_ prefix; `_` between sections, `-`
    // within — tab + object names normalised via sanitizeFilenamePart).
    const tabPart = sanitizeFilenamePart(getActiveTabName(), 'tab');
    const objPart = sanitizeFilenamePart(objLabel, 'object');
    panel.querySelector('.df-csv-tools__sample').addEventListener('click', () => downloadCsv('df_object-sample.csv', buildSampleFieldsCsv()));
    panel.querySelector('.df-csv-tools__export').addEventListener('click', () => downloadCsv(`df_${tabPart}_${objPart}_fields.csv`, fieldsToCsv(cell.get('fields') || [])));
    panel.querySelector('.df-csv-tools__import-file').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { doImport(String(reader.result || '')); fileInput.value = ''; };
      reader.onerror = () => { setStatus('Could not read that file.', true); fileInput.value = ''; };
      reader.readAsText(file);
    });
    panel.querySelector('.df-csv-tools__import-paste').addEventListener('click', () => {
      if (!ta.value.trim()) { setStatus('Paste some CSV rows first.', true); return; }
      doImport(ta.value);
    });
  }
}

// Field ↔ CSV columns (the full set the editor exposes), in a fixed order shared by
// the Sample, Export, and Import paths.
const FIELD_CSV_COLUMNS = ['API Name', 'Label', 'Type', 'Length', 'Required', 'Deprecated', 'Key', 'Sample Values'];
const csvCell = v => { const s = String(v ?? '').trim(); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const keyToCsv = k => k === 'pk' ? 'PK' : k === 'fk' ? 'FK' : k === 'fqk' ? 'FQK' : '';

function fieldsToCsv(fields) {
  const rows = (fields || []).map(f => [
    f.apiName || '', f.label || '', f.type || '', f.length || '',
    f.required ? 'Yes' : 'No', f.deprecated ? 'Yes' : 'No', keyToCsv(f.keyType), f.sampleValues || '',
  ]);
  return '﻿' + [FIELD_CSV_COLUMNS, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}

// A documentation-grade template: canonical PK/FK/FQK rows up top, then one row per
// remaining Salesforce field type so every valid Type value is spelled out, plus a
// Required + a Deprecated example.
function buildSampleFieldsCsv() {
  const canonical = [
    ['Id', 'Record ID', 'ID', '', 'Yes', 'No', 'PK', '003Ax00000ABCDE'],
    ['AccountId', 'Account', 'Lookup', '', 'Yes', 'No', 'FK', '001Ax00000XYZab'],
    ['UnifiedId__c', 'Unified Profile Key', 'Text', '255', 'No', 'No', 'FQK', 'john.doe@example.com'],
  ];
  const used = new Set(canonical.map(r => r[2]));
  const rest = SF_FIELD_TYPES.filter(t => !used.has(t)).map(t => {
    const api = t.replace(/[^a-z0-9]+/gi, '') + '__c';
    const len = /text|char|area/i.test(t) ? '255' : '';
    return [api, `${t} Example`, t, len, 'No', 'No', '', ''];
  });
  const all = [...canonical, ...rest];
  if (all.length) all[all.length - 1][5] = 'Yes';   // last row demonstrates Deprecated
  return '﻿' + [FIELD_CSV_COLUMNS, ...all].map(r => r.map(csvCell).join(',')).join('\r\n');
}

function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Parse a CSV/TSV block into a FULL replacement field list. Delimiter = tab if any
// line has one, else comma. A header row (first cell is a known header token) maps
// columns by name; otherwise positional API Name, Label, Type, Length, Required,
// Deprecated, Key. Type falls back to the first cell that reads as a known SF
// type (then Text); Required/Deprecated accept Yes/true/1/x. Fresh fids per row.
function parseBulkFields(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return out;
  const delim = lines.some(l => l.includes('\t')) ? '\t' : ',';
  const split = l => l.split(delim).map(s => s.trim());
  const typeOf = v => SF_FIELD_TYPES.find(t => t.toLowerCase() === String(v).toLowerCase());
  const keyOf = v => {
    const k = String(v).toLowerCase().trim();
    if (k === 'pk' || /primary/.test(k)) return 'pk';
    if (k === 'fk' || /foreign/.test(k)) return 'fk';
    if (k === 'fqk' || /qualified/.test(k)) return 'fqk';
    return null;
  };
  const truthy = v => /^(y|yes|true|1|x|✓)$/i.test(String(v).trim());

  const firstLower = split(lines[0]).map(s => s.toLowerCase());
  const HEADER_FIRST = ['api name', 'api_name', 'apiname', 'api', 'name', 'field', 'field name', 'field api name'];
  let start = 0;
  let map = { api: 0, label: 1, type: 2, length: 3, required: 4, decom: 5, key: 6, sample: 7 };   // positional default
  if (HEADER_FIRST.includes(firstLower[0])) {
    start = 1;
    const find = re => firstLower.findIndex(h => re.test(h));
    map = {
      api: Math.max(0, find(/api|^name$|^field/)),
      label: find(/label|display/),
      type: find(/type/),
      length: find(/len/),
      required: find(/req/),
      decom: find(/deprecat|decom/),   // new "Deprecated" header + legacy "Decommissioned"
      key: find(/key|pk|fk|fqk/),
      sample: find(/sample|example/),
    };
  }

  const seen = new Set();
  for (let i = start; i < lines.length; i++) {
    const cols = split(lines[i]);
    const api = sanitizeFieldValue((map.api >= 0 ? cols[map.api] : cols[0]) || '');
    if (!api) continue;
    let type = (map.type >= 0 ? typeOf(cols[map.type]) : null) || '';
    if (!type) { for (let j = 0; j < cols.length; j++) { if (j === map.api) continue; const m = typeOf(cols[j]); if (m) { type = m; break; } } }
    if (!type) type = 'Text';
    const label = sanitizeFieldValue((map.label >= 0 && cols[map.label]) ? cols[map.label] : api);
    const length = sanitizeFieldValue((map.length >= 0 && cols[map.length]) ? cols[map.length] : '', 32);
    const deprecated = map.decom >= 0 ? truthy(cols[map.decom]) : false;
    let keyType = map.key >= 0 ? keyOf(cols[map.key]) : null;
    if (!keyType) { for (let j = 0; j < cols.length; j++) { const k = keyOf(cols[j]); if (k) { keyType = k; break; } } }
    // A PK / FQK is inherently mandatory; otherwise honour the Required column.
    const required = (keyType === 'pk' || keyType === 'fqk') ? true : (map.required >= 0 ? truthy(cols[map.required]) : false);
    const sampleValues = sanitizeFieldValue((map.sample >= 0 && cols[map.sample]) ? cols[map.sample] : '');
    const fid = newFid(seen); seen.add(fid);   // stable synthetic identity per imported row
    out.push({ label, apiName: api, type, keyType, length, required, deprecated, sampleValues, fid });
  }
  return out;
}

// Sanitise a pasted/imported field string — parity with sanitizeGraphJSON for untrusted
// input: drop control + zero-width chars, neutralise script-bearing URIs, trim, and cap
// length so a hostile paste can't inject markup, bloat the model, or break the renderer.
function sanitizeFieldValue(s, maxLen = 255) {
  let v = String(s ?? '').replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '');
  if (/^\s*(javascript|vbscript)\s*:|^\s*data\s*:\s*text\/html/i.test(v)) v = '';
  v = v.trim();
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

function renderFlowShapeProps(cell) {
  const type = cell.get('type');
  const typeLabel = TYPE_LABELS[type] || 'Shape';

  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
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
  addOrderButtons(size, cell);

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderAnnotationProps(cell) {
  // Content (uses addText for consistency — auto-grows on newlines, supports
  // markdown shortcuts, no need for a dedicated textarea widget).
  const content = section(bodyEl, 'Content');
  const labelInput = addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
  }, cell);
  // CR-6.1: markdown shortcuts (Cmd+B/I/Shift+X/E) + hint below the input.
  wireMarkdownShortcuts(labelInput, content);

  // Bracket side
  const currentSide = cell.get('bracketSide') || 'left';
  addSelect(content, 'Bracket side', currentSide, [
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

  // Note: the annotation label is auto-kept horizontal regardless of the
  // bracket's rotation (sf.AnnotationView counters the element angle), so no
  // manual text-rotation control is needed.

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Bracket color', cell.attr('bracket/stroke'), v => cell.attr('bracket/stroke', v));
  addColor(appearance, 'Label color',    cell.attr('label/fill'),     v => cell.attr('label/fill', v));

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addRotationField(size, cell);
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES['sf.Annotation'];
    cell.resize(def.width, def.height);
  });
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell);

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

// ── Gantt shape renderers ──────────────────────────────────────────

function renderGanttTaskProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    cell.set('taskLabel', v);
    titleEl.textContent = v || '';
  });
  // Only show progress input if showProgress is enabled
  if (cell.get('showProgress') !== false) {
    addNumber(content, 'Progress (%)', cell.get('progress') ?? 0, v => {
      cell.set('progress', Math.max(0, Math.min(100, v)));
    }, { min: 0, max: 100 });
  }
  // Only show assignee input if showAssignee is enabled
  if (cell.get('showAssignee') !== false) {
    addText(content, 'Assignee', cell.get('assignee') || '', v => {
      cell.set('assignee', v);
      cell.attr('assigneeLabel/text', v);
    });
  }

  // Appearance — canonical: Fill → Border → typography → custom features
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill', cell.attr('body/fill') || 'var(--node-bg)', v => {
    cell.attr('body/fill', v);
  });
  addColor(appearance, 'Border', cell.attr('body/stroke') || 'var(--node-border)', v => {
    cell.attr('body/stroke', v);
  });
  addColor(appearance, 'Label color', cell.get('userTextColor') || cell.attr('label/fill') || '#FFFFFF', v => {
    cell.set('userTextColor', v);
    cell.attr('label/fill', v);
    cell.attr('percentLabel/fill', v);
    cell.attr('assigneeLabel/fill', v);
  }, { defaultValue: '#FFFFFF' });
  addColor(appearance, 'Completion bar', cell.attr('progressBar/fill') || '#1D73C9', v => {
    cell.attr('progressBar/fill', v);
  }, { defaultValue: '#1D73C9' });

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width', cell.size().width, w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES['sf.GanttTask'];
    cell.resize(def.width, def.height);
  });
  addOrderButtons(size, cell);

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderGanttMilestoneProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
  });
  addDate(content, 'Date', cell.get('milestoneDate') || '', v => cell.set('milestoneDate', v));

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill', cell.attr('body/fill') || '#F6B355', v => cell.attr('body/fill', v), { defaultValue: '#F6B355' });
  addColor(appearance, 'Border', cell.attr('body/stroke') || '#D4942A', v => cell.attr('body/stroke', v), { defaultValue: '#D4942A' });
  addColor(appearance, 'Label color', cell.attr('label/fill'), v => cell.attr('label/fill', v));

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumber(size, 'Size', cell.size().width, v => cell.resize(v, v));
  addOrderButtons(size, cell);

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderGanttMarkerProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
  });

  // Direction toggle
  const dirRow = document.createElement('div');
  dirRow.className = 'df-prop-pair';
  const isDown = cell.get('pointDown') === true;

  const upBtn = document.createElement('button');
  upBtn.className = 'df-properties__btn df-properties__btn--order';
  upBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><polygon points="8,2 14,14 2,14"/></svg> Point Up`;
  upBtn.style.opacity = isDown ? '0.5' : '1';
  upBtn.addEventListener('click', () => {
    cell.set('pointDown', false);
    cell.attr('body/refPoints', '0,1 0.5,0 1,1');
    cell.attr('label/y', 'calc(h + 4)');
    cell.attr('label/textVerticalAnchor', 'top');
    upBtn.style.opacity = '1';
    downBtn.style.opacity = '0.5';
  });

  const downBtn = document.createElement('button');
  downBtn.className = 'df-properties__btn df-properties__btn--order';
  downBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><polygon points="2,2 14,2 8,14"/></svg> Point Down`;
  downBtn.style.opacity = isDown ? '1' : '0.5';
  downBtn.addEventListener('click', () => {
    cell.set('pointDown', true);
    cell.attr('body/refPoints', '0,0 1,0 0.5,1');
    cell.attr('label/y', -4);
    cell.attr('label/textVerticalAnchor', 'bottom');
    upBtn.style.opacity = '0.5';
    downBtn.style.opacity = '1';
  });

  dirRow.appendChild(upBtn);
  dirRow.appendChild(downBtn);
  content.appendChild(dirRow);

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill', cell.attr('body/fill') || '#DA4E55', v => cell.attr('body/fill', v), { defaultValue: '#DA4E55' });
  addColor(appearance, 'Border', cell.attr('body/stroke') || '#B03A40', v => cell.attr('body/stroke', v), { defaultValue: '#B03A40' });
  addColor(appearance, 'Label color', cell.attr('label/fill'), v => cell.attr('label/fill', v));

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumber(size, 'Size', cell.size().width, v => cell.resize(v, Math.round(v * 0.8)));
  addOrderButtons(size, cell);

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderGanttTimelineProps(cell) {
  const viewMode = cell.get('viewMode') || 'week';
  const periodLabel = viewMode === 'day' ? 'days' : viewMode === 'week' ? 'weeks' : 'months';

  // Title & Description
  const titleSec = section(bodyEl, 'Content');
  addText(titleSec, 'Label', cell.get('timelineTitle') || 'Tasks', v => {
    cell.set('timelineTitle', v);
    titleEl.textContent = v || '';
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
  addColor(appearance, 'Fill', cell.attr('body/fill') || 'var(--bg-surface-raised)', v => {
    cell.attr('body/fill', v);
  });
  addColor(appearance, 'Top row', cell.attr('topRow/fill') || 'var(--node-bg)', v => {
    cell.attr('topRow/fill', v);
  });
  addColor(appearance, 'Border', cell.attr('body/stroke') || 'var(--node-border)', v => {
    cell.attr('body/stroke', v);
    cell.attr('divider/stroke', v);
  });

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumber(size, 'Width', cell.size().width, w => cell.resize(w, cell.size().height));
  addOrderButtons(size, cell);

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderGanttGroupProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
  });

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Bar color', cell.attr('body/fill') || '#2A2D32', v => {
    cell.attr('body/fill', v);
    cell.attr('leftProng/fill', v);
    cell.attr('rightProng/fill', v);
  }, { defaultValue: '#2A2D32' });
  addColor(appearance, 'Label color', cell.attr('label/fill'), v => cell.attr('label/fill', v));

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumber(size, 'Width', cell.size().width, w => cell.resize(w, cell.size().height));
  addOrderButtons(size, cell);

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderOrgPersonProps(cell) {
  // Content (uniform section name across all shapes; stored fields keep their
  // historical prop names for back-compat — `personName`, `jobTitle`).
  const info = section(bodyEl, 'Content');
  addText(info, 'Label', cell.get('personName') || '', v => {
    cell.set('personName', v);
    titleEl.textContent = v || '';
  });
  // Description (multi-line) backed by `jobTitle` for back-compat. Placeholder
  // hints at the typical use ("job title") while leaving room for a project
  // role, team name, or any other short secondary label per user preference.
  addTextarea(info, 'Description', cell.get('jobTitle') || '',
    v => cell.set('jobTitle', v),
    { placeholder: 'job title' });

  // Mark-as-vacant toggle — dashed borders + faded text mark the card as a
  // recruitment placeholder or unassigned RACI slot. Lives in Content (a
  // status flag, not an aesthetic choice) immediately below Description so
  // the Appearance section stays exclusively about design tokens.
  addToggle(info, 'Mark as vacant', !!cell.get('vacant'),
    v => cell.set('vacant', v));

  // Tags — comma-separated chips at the bottom of the card
  addChipInput(info, 'Tags', cell.get('tags') || [], v => cell.set('tags', v));

  // RACI multi-pick — coloured pills in the top-right corner of the card
  addRaciPicker(info, 'RACI', cell.get('raci') || {}, v => cell.set('raci', v));

  // Image / Avatar section
  const imageSec = section(bodyEl, 'Image');

  // Icon Text input (up to 4 characters)
  addText(imageSec, 'Icon text', cell.get('iconText') || '', v => {
    cell.set('iconText', v.substring(0, 4));
  });

  // Photo upload
  const photoField = document.createElement('div');
  photoField.className = 'df-prop-field';
  const photoLabel = document.createElement('div');
  photoLabel.className = 'df-properties__label';
  photoLabel.textContent = 'Photo';

  const photoControls = document.createElement('div');
  photoControls.className = 'df-prop-pair';

  const hasImage = !!cell.get('imageUrl');

  const ICON_UPLOAD = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v10M3 8h10"/></svg>`;
  const ICON_CHANGE = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4h11l-3-3M15 12H4l3 3"/></svg>`;
  const ICON_REMOVE = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h10M6 4V2.5A.5.5 0 016.5 2h3a.5.5 0 01.5.5V4M4.5 4l.5 9.5h6l.5-9.5"/></svg>`;

  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'df-properties__btn df-properties__btn--order';
  uploadBtn.innerHTML = hasImage ? `${ICON_CHANGE} Change` : `${ICON_UPLOAD} Upload`;

  const clearBtn = document.createElement('button');
  clearBtn.className = 'df-properties__btn df-properties__btn--order';
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

  // Extensible details list — each entry is `{ label, value }`. Cells from
  // pre-v1.11 stored values on top-level fields (`email`/`phone`/...); the
  // OrgPersonView migrates those into `details` on first render so by the
  // time we see the cell here the array is populated. We still fall back to
  // a legacy build here in case the user opens the panel before the view's
  // render-side migration kicks in.
  const DEFAULT_DETAIL_LABELS = ['Email', 'Phone', 'Role', 'Stream', 'Location', 'Company'];
  const LEGACY_KEYS = { Email: 'email', Phone: 'phone', Role: 'role', Stream: 'stream', Location: 'location', Company: 'company' };

  const initialDetails = (() => {
    const stored = cell.get('details');
    if (Array.isArray(stored) && stored.length > 0) {
      return stored.map(d => ({ label: String(d?.label ?? ''), value: String(d?.value ?? '') }));
    }
    // Legacy migration fallback — order respects `detailOrder` if present.
    const order = cell.get('detailOrder') || ['email', 'phone', 'role', 'stream', 'location', 'company'];
    const labelByKey = { email: 'Email', phone: 'Phone', role: 'Role', stream: 'Stream', location: 'Location', company: 'Company' };
    return order.map(k => ({ label: labelByKey[k] || k, value: cell.get(k) || '' }));
  })();

  // Working copy — committed back to the cell on every mutation.
  let detailsState = [...initialDetails];
  const commitDetails = () => {
    // Mirror values back to legacy fields where the label matches a known
    // key, so cells saved by 1.11+ still degrade gracefully if loaded by an
    // older version that only knows about the hardcoded fields.
    cell.set('details', detailsState.map(d => ({ ...d })));
    for (const lbl of DEFAULT_DETAIL_LABELS) {
      const legacyKey = LEGACY_KEYS[lbl];
      const match = detailsState.find(d => d.label === lbl);
      cell.set(legacyKey, match ? match.value : '');
    }
  };

  const detailSec = section(bodyEl, 'Details');

  function buildDetailList() {
    detailSec.querySelectorAll('.df-detail-row, .df-detail-add').forEach(r => r.remove());

    detailsState.forEach((entry, idx) => {
      const row = document.createElement('div');
      row.className = 'df-detail-row';
      row.draggable = true;
      row.dataset.idx = String(idx);

      // Drag handle
      const handle = document.createElement('span');
      handle.className = 'df-detail-row__handle';
      handle.innerHTML = '⠿';
      handle.title = 'Drag to reorder';
      row.appendChild(handle);

      // Label input — plain text, freely editable
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'df-properties__input df-detail-row__label-input';
      labelInput.value = entry.label;
      labelInput.placeholder = 'Label';
      labelInput.addEventListener('input', () => {
        detailsState[idx].label = labelInput.value;
        commitDetails();
      });
      row.appendChild(labelInput);

      // Value input
      const valueInput = document.createElement('input');
      valueInput.type = 'text';
      valueInput.className = 'df-properties__input';
      valueInput.value = entry.value;
      valueInput.placeholder = 'Value';
      valueInput.addEventListener('input', () => {
        detailsState[idx].value = valueInput.value;
        commitDetails();
      });
      row.appendChild(valueInput);

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'df-detail-row__remove';
      removeBtn.innerHTML = '×';
      removeBtn.title = 'Remove';
      removeBtn.addEventListener('click', () => {
        detailsState.splice(idx, 1);
        commitDetails();
        buildDetailList();
      });
      row.appendChild(removeBtn);

      // Drag-and-drop to reorder
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('df-detail-row--dragging');
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('df-detail-row--dragging');
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('df-detail-row--over');
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('df-detail-row--over');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('df-detail-row--over');
        const draggingEl = detailSec.querySelector('.df-detail-row--dragging');
        if (!draggingEl || draggingEl === row) return;
        const fromIdx = parseInt(draggingEl.dataset.idx, 10);
        const toIdx = parseInt(row.dataset.idx, 10);
        if (Number.isNaN(fromIdx) || Number.isNaN(toIdx)) return;
        const [moved] = detailsState.splice(fromIdx, 1);
        detailsState.splice(toIdx, 0, moved);
        commitDetails();
        buildDetailList();
      });

      detailSec.appendChild(row);
    });

    // + Add detail button
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'df-properties__btn df-properties__btn--auto-size df-detail-add';
    addBtn.style.marginTop = '6px';
    addBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>
      Add detail`;
    addBtn.addEventListener('click', () => {
      detailsState.push({ label: '', value: '' });
      commitDetails();
      buildDetailList();
      // Focus the new label input so the user starts typing immediately
      const rows = detailSec.querySelectorAll('.df-detail-row');
      const last = rows[rows.length - 1];
      last?.querySelector('.df-detail-row__label-input')?.focus();
    });
    detailSec.appendChild(addBtn);
  }
  buildDetailList();

  // Appearance — design tokens only (the vacant toggle moved to Content
  // above, since it's a status flag rather than a colour choice).
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Accent', cell.attr('accentBar/fill') || '#1D73C9', v => {
    cell.attr('accentBar/fill', v);
    cell.attr('accentBarMask/fill', v);
  }, { defaultValue: '#1D73C9' });

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
  addOrderButtons(size, cell);

  // Delete
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderTaskProps(cell) {
  // Content — primary text only.
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.get('taskName') || '', v => {
    cell.set('taskName', v);
    titleEl.textContent = v || '';
  });
  addTextarea(content, 'Description', cell.get('taskDescription') || '',
    v => cell.set('taskDescription', v));

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill', cell.attr('body/fill') || 'var(--node-bg)',
    v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke') || 'var(--node-border)',
    v => cell.attr('body/stroke', v));

  // Size & Order — Description width lives here, alongside Width/Height,
  // since it's a layout/dimension property of the shape, not text content.
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  // Fixed left-column width — the right column absorbs any task resize so
  // the description column stays the size the user picked. Min clamp of
  // 120 px is enforced inside `_effectiveDescWidth` on the shape side.
  addNumber(size, 'Description width', cell.get('descriptionWidth') ?? 260, v => {
    cell.set('descriptionWidth', Math.max(120, v));
  });
  addOrderButtons(size, cell);

  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

// ── Sequence Diagram renderers ────────────────────────────────────

function renderSequenceParticipantProps(cell) {
  // Content
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
  }, cell);

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Accent',     cell.attr('headerAccent/fill'), v => {
    cell.attr('headerAccent/fill', v);
  });
  addColor(appearance, 'Fill',        cell.attr('header/fill'),       v => cell.attr('header/fill', v));
  addColor(appearance, 'Label color', cell.attr('label/fill'),        v => cell.attr('label/fill', v));

  // Lifeline — port count (ports auto-distribute evenly along the lifeline)
  const lifeline = section(bodyEl, 'Lifeline');
  addNumber(lifeline, 'Ports', cell.get('lifelinePortCount') ?? 5, v => {
    joint.shapes.sf.rebuildSeqParticipantPorts(cell, v);
  });

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES['sf.SequenceParticipant'];
    cell.resize(def.width, def.height);
  });
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell);

  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderSequenceActorProps(cell) {
  const content = section(bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    titleEl.textContent = v || '';
  }, cell);

  const appearance = section(bodyEl, 'Appearance');
  // Stick figure stroke (optional tint) — lifeline keeps its own theme-aware
  // default so hiding the figure tint doesn't also wipe the lifeline colour.
  addColor(appearance, 'Color', cell.attr('actorHead/stroke'), v => {
    cell.attr('actorHead/stroke', v);
    cell.attr('actorBody/stroke', v);
    cell.attr('actorArms/stroke', v);
    cell.attr('actorLegLeft/stroke', v);
    cell.attr('actorLegRight/stroke', v);
  });
  addColor(appearance, 'Label color', cell.attr('label/fill'), v => cell.attr('label/fill', v));

  // Lifeline — show/hide slider + port count (when shown)
  const showLifeline = cell.get('showLifeline') !== false;
  const lifeline = section(bodyEl, 'Lifeline');
  addSegmented(lifeline, 'Visibility', showLifeline, [
    { value: true,  label: 'Show' },
    { value: false, label: 'Hide' },
  ], v => {
    joint.shapes.sf.setActorLifelineVisible(cell, v);
    // Re-render the panel so the Ports field appears/disappears
    showProperties(cell);
  });
  if (showLifeline) {
    addNumber(lifeline, 'Ports', cell.get('lifelinePortCount') ?? 5, v => {
      joint.shapes.sf.rebuildSeqActorPorts(cell, v);
    });
  }

  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES['sf.SequenceActor'];
    // When lifeline hidden, auto-size to just the figure+label block
    const h = showLifeline ? def.height : 92;
    cell.resize(def.width, h);
  });
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell);

  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderSequenceActivationProps(cell) {
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill',   cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => cell.attr('body/stroke', v));

  // Lifeline — port count (auto-distributed evenly)
  const lifeline = section(bodyEl, 'Lifeline');
  addNumber(lifeline, 'Ports', cell.get('lifelinePortCount') ?? 2, v => {
    joint.shapes.sf.rebuildSeqActivationPorts(cell, v);
  });

  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES['sf.SequenceActivation'];
    cell.resize(def.width, def.height);
  });
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell);

  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

function renderSequenceFragmentProps(cell) {
  const FRAGMENT_TYPES = [
    { value: 'standard',    label: 'Standard' },
    { value: 'alternative', label: 'Alternative' },
  ];

  const setAlternativeVisibility = (isAlt) => {
    cell.attr('dividerLine/visibility', isAlt ? 'visible' : 'hidden');
    cell.attr('elseText/visibility', isAlt ? 'visible' : 'hidden');
    const elseCond = cell.get('elseCondition') || '';
    cell.attr('elseText/text', isAlt ? (elseCond ? `[${elseCond}]` : '[else]') : '');
  };

  // Content — canonical order: Label first, then Type, then condition fields.
  // labelInput is captured in the Type onChange below so the Type switch can
  // sync the visible Label when it's still on a default keyword.
  const content = section(bodyEl, 'Content');
  const labelInput = addText(content, 'Label', cell.get('fragmentLabel') || cell.attr('titleText/text') || '', v => {
    cell.set('fragmentLabel', v);
    cell.attr('titleText/text', v);
    titleEl.textContent = v || '';
    // Resize the trapezoidal tab to fit the new label.
    joint.shapes.sf.updateFragmentTitleTab?.(cell);
  });
  addSelect(content, 'Type', cell.get('fragmentType') || 'standard', FRAGMENT_TYPES, v => {
    cell.set('fragmentType', v);
    const isAlt = v === 'alternative';
    setAlternativeVisibility(isAlt);
    // Auto-adjust the label only when it still matches the default for the
    // previous type — preserves any custom text the user typed.
    const curLabel = cell.get('fragmentLabel') || cell.attr('titleText/text') || '';
    if (curLabel === 'loop' || curLabel === 'alt' || curLabel === '') {
      const newLabel = isAlt ? 'alt' : 'loop';
      cell.set('fragmentLabel', newLabel);
      cell.attr('titleText/text', newLabel);
      labelInput.value = newLabel;
      joint.shapes.sf.updateFragmentTitleTab?.(cell);
    }
  });
  addText(content, 'Condition', cell.get('condition') ?? 'if', v => {
    cell.set('condition', v);
    cell.attr('conditionText/text', v ? `[${v}]` : '');
  });
  addText(content, 'Else condition', cell.get('elseCondition') ?? 'else', v => {
    cell.set('elseCondition', v);
    const isAlt = (cell.get('fragmentType') || 'standard') === 'alternative';
    cell.attr('elseText/text', isAlt ? (v ? `[${v}]` : '[else]') : '');
  });

  // Appearance — canonical order: Fill → Border → Label color
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Fill', cell.attr('body/fill') || 'transparent', v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => {
    cell.attr('body/stroke', v);
    cell.attr('titleTab/stroke', v);
    cell.attr('dividerLine/stroke', v);
  });
  addColor(appearance, 'Label color', cell.attr('titleText/fill'), v => {
    cell.attr('titleText/fill', v);
    cell.attr('conditionText/fill', v);
    cell.attr('elseText/fill', v);
  });

  // Size & Order
  const size = section(bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addAutoSizeBtn(size, () => {
    const def = DEFAULT_SIZES['sf.SequenceFragment'];
    cell.resize(def.width, def.height);
  });
  addApplySizeBtn(size, cell);
  addOrderButtons(size, cell);

  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

// ── Shared connector-appearance setters ───────────────────────────────────────
// Used by BOTH the single-link panel (renderLinkProps) and the multi-select Connectors
// section so a one-link edit and a many-link edit behave identically. None of these opens a
// history batch — the CALLER wraps (one undo step per edit, however many links it touches).

// Connector line-style picklist (Solid / Dashed / Dotted) — em-space gap then a sample.
// `lineStyle` is a top-level prop (a bg-coloured overlay clone paints the dashes; the real
// path stays solid so arrow/ER markers render crisp on Safari — see startLineStyleOverlays).
const LINK_LINE_STYLE_OPTS = (() => {
  const G = '   ';
  return [
    { value: 'none', label: `Solid${G}─────` },
    { value: '8 4',  label: `Dashed${G}╌ ╌ ╌ ╌ ╌` },
    { value: '2 4',  label: `Dotted${G}· · · · · · ·` },
  ];
})();

// Line colour. Arrow markers auto-inherit from the line; ER/stub markers carry an explicit
// stroke that must track it; a mapping badge re-tints; and the link's SVG group is re-inserted
// to dodge Safari's <marker> cache (full attrs replacement + sync render — see applyMarker).
function applyLinkStroke(cell, v) {
  const allAttrs = JSON.parse(JSON.stringify(cell.get('attrs') || {}));
  if (!allAttrs.line) allAttrs.line = {};
  allAttrs.line.stroke = v;
  const sm = allAttrs.line.sourceMarker;
  if (sm && sm.stroke && sm.stroke !== 'none') sm.stroke = v;
  const tm = allAttrs.line.targetMarker;
  if (tm && tm.stroke && tm.stroke !== 'none') tm.stroke = v;
  cell.set('attrs', allAttrs);
  if (cell.prop('linkKind') === 'mapping') syncMappingTypeBadge(cell);
  paper.updateViews();
  const view = paper.findViewByModel(cell);
  if (view?.el?.parentNode) {
    const parent = view.el.parentNode;
    const next = view.el.nextSibling;
    parent.removeChild(view.el);
    if (next) parent.insertBefore(view.el, next);
    else parent.appendChild(view.el);
  }
}

// Line width. A plain "None" stub end (`M 0 0 L -12 0`) is a continuation of the line, so it
// tracks the width; decorated ends (arrow / crow's foot) keep their own weight.
function applyLinkStrokeWidth(cell, v) {
  cell.attr('line/strokeWidth', v);
  for (const end of ['sourceMarker', 'targetMarker']) {
    if (cell.attr(`line/${end}`)?.d === 'M 0 0 L -12 0') cell.attr(`line/${end}/stroke-width`, v);
  }
}

// Line style → the `lineStyle` prop (never `line/strokeDasharray`, which is force-cleared as
// defence-in-depth so the real path stays solid for crisp Safari markers).
function applyLinkLineStyle(cell, v) {
  cell.prop('lineStyle', v === 'none' ? null : v);
  if (cell.attr('line/strokeDasharray')) cell.attr('line/strokeDasharray', null);
}

// Canonical ER marker def for an endpoint key, built with the link's own stroke/width (mirrors the marker-picker
// `markerDefs`). Only the keys the quick-set presets need; null = remove the marker on that side.
function erMarkerDef(key, stroke, lineWidth) {
  switch (key) {
    case 'none':  return { type: 'path', d: 'M 0 0 L -12 0', fill: 'none', stroke, 'stroke-width': lineWidth, 'stroke-dasharray': 'none' };
    case 'arrow': return { type: 'path', d: 'M 0 -6 L -14 0 L 0 6 z', 'stroke-dasharray': 'none' };   // auto-inherits line stroke
    case 'one':   return { type: 'path', d: 'M -12 -8 L -12 8 M -12 0 L 0 0', fill: 'none', stroke, 'stroke-width': 2, 'stroke-dasharray': 'none' };
    case 'many':  return { type: 'path', d: 'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0', fill: 'none', stroke, 'stroke-width': 2, 'stroke-dasharray': 'none' };
    default: return null;
  }
}

/** Quick-set a link's source + target ER markers (connector right-click presets: → / 1:1 / 1:M / M:1). Each key
 *  is 'none' | 'arrow' | 'one' | 'many' (undefined = leave that side untouched). Applies BOTH ends in one attrs
 *  replacement + the Safari <marker>-cache re-insert (same as applyMarker), so a stale arrowhead never lingers. */
export function setLinkEndpoints(cell, sourceKey, targetKey) {
  if (!cell || !cell.isLink || !cell.isLink()) return;
  const stroke = cell.attr('line/stroke') || '#888888';
  const lineWidth = cell.attr('line/strokeWidth') || 2;
  const allAttrs = JSON.parse(JSON.stringify(cell.get('attrs') || {}));
  if (!allAttrs.line) allAttrs.line = {};
  const apply = (key, markerKey) => {
    if (key === undefined) return;
    const def = erMarkerDef(key, stroke, lineWidth);
    if (def) allAttrs.line[markerKey] = def; else delete allAttrs.line[markerKey];
  };
  apply(sourceKey, 'sourceMarker');
  apply(targetKey, 'targetMarker');
  cell.set('attrs', allAttrs);
  paper.updateViews();
  const view = paper.findViewByModel(cell);
  if (view?.el?.parentNode) {
    const parent = view.el.parentNode;
    const next = view.el.nextSibling;
    parent.removeChild(view.el);
    if (next) parent.insertBefore(view.el, next); else parent.appendChild(view.el);
  }
}

// ── Shared Data Cloud mapping setters (single-link panel + multi-select Mapping section) ──
// The 5-value transform picklist, shared so single + multi stay in lockstep.
const MAPPING_TYPES = ['Standard', 'Formula', 'Streaming Transform', 'Batch Transform', 'Calculated Insight'];

// Connection type for a field→field link: mapping ↔ relationship. Swaps `linkKind` and the
// whole router/connector/marker style. No history batch and no panel re-render — the caller
// owns both (it must re-render to disclose/hide the mapping fields).
function applyLinkConnectionType(cell, v) {
  if (v === 'mapping') { cell.prop('linkKind', 'mapping'); applyMappingLinkStyle(cell); }
  else { cell.prop('linkKind', null); applyRelationshipLinkStyle(cell); }
}
// Mapping transform type (Standard / Formula / …) + its connector code badge (F / ST / BT / CI).
function applyLinkMappingType(cell, v) {
  cell.prop('mappingType', v);
  syncMappingTypeBadge(cell);
}
// Expression / rule note (non-Standard types) → table Expression column + badge hover tooltip.
function applyLinkExpression(cell, v) {
  cell.prop('expressionRule', v || '');
  syncMappingTypeBadge(cell);
}
// Font colour (v1.16.1) — one control for ALL of a connector's text: the user label, the frequency
// overlay text, AND its clock icon. Stored as the `fontColor` prop; recolours the existing user label in
// place and re-derives the frequency overlay (syncFrequencyLabel reads `fontColor`).
function applyLinkFontColor(cell, v) {
  cell.prop('fontColor', v);
  const labels = cell.labels() || [];
  const idx = labels.findIndex(l => !(l?.attrs?.badgeBox) && !(l?.attrs?.freqText));   // the on-line user label
  if (idx >= 0) cell.label(idx, { attrs: { text: { fill: v } } });
  syncFrequencyLabel(cell);
}

function renderLinkProps(cell) {
  // Content — primary text only (Font size moved to Appearance for
  // consistency with every other shape's typography placement).
  const labelSec = section(bodyEl, 'Content');
  // A mapping link may also carry a mapping-type code badge (selector `badgeBox`), and an
  // architecture link a frequency overlay (selector `freqText`). Read the USER label past
  // both, and preserve them when the primary label is edited.
  const isBadge = l => !!(l?.attrs?.badgeBox);
  const isFreq = l => !!(l?.attrs?.freqText);
  const userLabel = (cell.labels() || []).find(l => !isBadge(l) && !isFreq(l));
  const currentLabel = userLabel?.attrs?.text?.text ?? '';
  const currentLabelSize = userLabel?.attrs?.text?.fontSize ?? 13;
  addText(labelSec, 'Label', currentLabel, v => {
    const fontSize = (cell.labels() || []).find(l => !isBadge(l) && !isFreq(l))?.attrs?.text?.fontSize ?? 13;
    // Font colour (v1.16.1) overrides the line-stroke default for the label text.
    const fillColor = cell.prop('fontColor') || cell.attr('line/stroke') || '#888888';
    // Keep the non-user labels (mapping badge + frequency overlay) when the label changes.
    const others = (cell.labels() || []).filter(l => isBadge(l) || isFreq(l));
    const arr = [];
    if (v) arr.push({
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'text', selector: 'text' },
      ],
      attrs: {
        text: { text: v, fill: fillColor, fontSize, fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', textAnchor: 'middle', textVerticalAnchor: 'middle' },
        body: { ref: 'text', refWidth: 12, refHeight: 4, refX: -6, refY: -2, fill: 'var(--bg-canvas, #FFFFFF)', stroke: 'none', rx: 2, ry: 2 },
      },
      position: { distance: 0.5, offset: 0 },
    });
    arr.push(...others);   // keep the F/ST/BT/CI badge and/or the frequency overlay
    cell.labels(arr);
    titleEl.textContent = v || '';
  });

  // Architecture only: integration-frequency overlay (clock icon + muted text below the
  // line). `connectionFrequency` is the authoritative prop; syncFrequencyLabel derives the
  // secondary label. addText already coalesces a focus session into one undo entry, so no
  // explicit history batch is needed (matches the Label setter).
  const isArchitecture = document.getElementById('canvas-container')?.dataset.diagramType === 'architecture';
  if (isArchitecture) {
    addText(labelSec, 'Frequency', cell.prop('connectionFrequency') || '', v => {
      cell.prop('connectionFrequency', v || '');
      syncFrequencyLabel(cell);
    }, cell, { placeholder: 'Real-time / Hourly / Daily' });
  }

  // Connection type is meaningful ONLY for a field→field link (a DataObject field
  // port on both ends): that link is a Data Cloud field mapping by default but can be
  // toggled to a plain ER relationship via a two-value slider. Every other connector
  // is just a relationship/line — no toggle is shown.
  const src = cell.get('source'); const tgt = cell.get('target');
  const isFieldToField = typeof src?.port === 'string' && src.port.startsWith('field-')
    && typeof tgt?.port === 'string' && tgt.port.startsWith('field-');
  if (isFieldToField) {
    const isMapping = cell.prop('linkKind') === 'mapping';
    addSegmented(labelSec, 'Connection type', isMapping ? 'mapping' : 'relationship', [
      { value: 'relationship', label: 'Relationship' },
      { value: 'mapping', label: 'Mapping' },
    ], v => {
      // One history step for the whole switch — it mutates linkKind + several attrs +
      // router + connector + connectionPoints (shared with the multi-select Mapping section).
      history.startBatch();
      try { applyLinkConnectionType(cell, v); } finally { history.endBatch(); }
      refresh();
    });

    // Data Cloud mapping properties — only meaningful for an ACTIVE field mapping.
    // Grouped under Content: the transform Mapping Type (a 5-value picklist), plus a
    // progressively-disclosed Expression note. Both feed the table view's MAPPING
    // TYPE / Mapping Label columns; non-Standard types also drop a code badge (F / ST
    // / BT / CI) on the connector's target stub via syncMappingTypeBadge.
    if (cell.prop('linkKind') === 'mapping') {
      const curType = MAPPING_TYPES.includes(cell.prop('mappingType')) ? cell.prop('mappingType') : 'Standard';
      addSelect(labelSec, 'Mapping type', curType,
        MAPPING_TYPES.map(t => ({ value: t, label: t })),
        v => {
          history.startBatch();
          try { applyLinkMappingType(cell, v); } finally { history.endBatch(); }
          refresh();   // re-render so the Expression field shows/hides for the new type
        });
      // Progressive disclosure: any non-Standard (computed) transform exposes the
      // Expression / rules note, bound to `expressionRule` → table Expression / Rule column.
      if (curType !== 'Standard') {
        addText(labelSec, 'Expression / rules', cell.prop('expressionRule') || cell.prop('mappingLabel') || '', v => {
          history.startBatch();
          try { applyLinkExpression(cell, v); } finally { history.endBatch(); }
        });
      }
    }
  }

  // Appearance
  const appearance = section(bodyEl, 'Appearance');
  addColor(appearance, 'Color', cell.attr('line/stroke') ?? '#888888',
    v => {
      // attrs + (mapping) badge label = one undo step; shared with the multi-select panel.
      history.startBatch();
      try { applyLinkStroke(cell, v); } finally { history.endBatch(); }
    });
  // Label color (v1.16.1) — recolours the label + frequency text + clock together; defaults to the line
  // color. Reset (↺) snaps back to the current line stroke. One undo step (label fill + freq rebuild).
  addColor(appearance, 'Label color', cell.prop('fontColor') || cell.attr('line/stroke') || '#888888',
    v => { history.startBatch(); try { applyLinkFontColor(cell, v); } finally { history.endBatch(); } },
    { defaultValue: cell.attr('line/stroke') || '#888888' });
  addSelect(appearance, 'Line style', cell.prop('lineStyle') || 'none', LINK_LINE_STYLE_OPTS,
    v => applyLinkLineStyle(cell, v));
  addNumber(appearance, 'Line width', cell.attr('line/strokeWidth') ?? 2,
    v => applyLinkStrokeWidth(cell, v));
  // Font size — connector label typography. Lives in Appearance for
  // consistency with the universal convention (text content in Content;
  // text styling in Appearance).
  addNumber(appearance, 'Font size', currentLabelSize, v => {
    const labels = cell.labels();
    if (labels.length > 0) {
      cell.label(0, { attrs: { text: { fontSize: Math.max(8, Math.min(24, v)) } } });
    }
  }, { min: 8, max: 24 });
  const stroke = cell.attr('line/stroke') || '#333333';
  const lineWidth = cell.attr('line/strokeWidth') ?? 2; // None stub follows the line weight
  // ER crow's foot markers — negative-x convention (toward element).
  // Crow's foot prongs fan out toward negative-x (toward the entity).
  // Explicit fill/stroke is set because ER markers are open paths (no
  // auto-inheritance from line).
  // All marker defs include `'stroke-dasharray': 'none'` so that when the
  // line is dashed/dotted, the marker geometry stays solid — browsers
  // (notably Safari) otherwise propagate the line's dasharray into marker
  // content at the rendering level, making arrowheads / ER notation look
  // broken.  For auto-inheriting markers (e.g. `arrow`), the explicit
  // 'none' does not override stroke/fill inheritance — it only pins the
  // dasharray.
  const markerDefs = {
    // None: simple stub line extending toward element (fills the connectionPoint gap)
    none:        { type: 'path', d: 'M 0 0 L -12 0', fill: 'none', stroke: stroke, 'stroke-width': lineWidth, 'stroke-dasharray': 'none' },
    // Arrow: NO explicit fill/stroke — JointJS auto-inherits from line stroke
    // and auto-trims the line at the marker boundary. Using JointJS native
    // coordinate convention: tip at negative-x, base at x=0.
    arrow:       { type: 'path', d: 'M 0 -6 L -14 0 L 0 6 z', 'stroke-dasharray': 'none' },
    // Line arrow (open V): two-stroke open arrowhead, no fill. Used for
    // async/open messages on sequence diagrams; also useful as a lighter
    // alternative to the filled arrow on any diagram type. Explicit fill/
    // stroke because this is an open path (won't auto-inherit like `arrow`).
    lineArrow:   { type: 'path', d: 'M 0 -6 L -14 0 L 0 6', fill: 'none', stroke: stroke, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': 'none' },
    // ── ER notation (negative-x = toward element, positive-x = toward link) ──
    // One: bar at entity end (x=-12) + stem back to line (x=0)
    one:         { type: 'path', d: 'M -12 -8 L -12 8 M -12 0 L 0 0', fill: 'none', stroke: stroke, 'stroke-width': 2, 'stroke-dasharray': 'none' },
    // Zero-or-One: circle (line side, edge at x=2) → connecting line → bar at x=-12 (entity side)
    zeroOne:     { type: 'path', d: 'M 2 0 a 5 5 0 1 1 -10 0 a 5 5 0 1 1 10 0 Z M -8 0 L -12 0 M -12 -8 L -12 8', fill: 'var(--bg-canvas, #1A1A1A)', stroke: stroke, 'stroke-width': 2, 'stroke-dasharray': 'none' },
    // Many: crow's foot — 3 prongs fan toward element
    many:        { type: 'path', d: 'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0', fill: 'none', stroke: stroke, 'stroke-width': 2, 'stroke-dasharray': 'none' },
    // One-or-Many: bar (line side) → crow's foot (entity side)
    oneMany:     { type: 'path', d: 'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0 M 3 -8 L 3 8', fill: 'none', stroke: stroke, 'stroke-width': 2, 'stroke-dasharray': 'none' },
    // Zero-or-Many: circle (link side, 4px gap, bg-filled) → crow's foot (entity side, identical to many)
    zeroMany:    { type: 'path', d: 'M 4 0 a 5 5 0 1 1 10 0 a 5 5 0 1 1 -10 0 Z M -12 -8 L 0 0 M 0 0 L -12 8 M 0 0 L -12 0', fill: 'var(--bg-canvas, #1A1A1A)', stroke: stroke, 'stroke-width': 2, 'stroke-dasharray': 'none' },
  };
  const markerOpts = [
    { value: 'none',      label: 'None' },
    { value: 'arrow',     label: 'Arrow' },
    { value: 'lineArrow', label: 'Line Arrow' },
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
    // Line Arrow: two strokes meeting at the tip `M 0 -6 L -14 0 L 0 6` — no
    // `z`, open V. Also accept the reversed-tip form that shipped in an earlier
    // 1.6.0 build so existing diagrams keep showing the picker as "Line Arrow".
    if (/M\s*0\s+-6\s+L\s*-14\s+0\s+L\s*0\s+6/.test(d)) return 'lineArrow';
    if (/M\s*-14\s+-6\s+L\s*0\s+0\s+L\s*-14\s+6/.test(d)) return 'lineArrow';
    // Crow's foot detection: at least one prong must ORIGINATE from the (0,0)
    // central vertex — i.e. an `(L|M) 0 0` command immediately followed by
    // `L -12 8` (or symmetric `L -12 -8`). Old format `L 12 0` kept for legacy
    // diagrams.
    // Why this stricter check: the "one" marker `M -12 -8 L -12 8 M -12 0 L 0 0`
    // *also* contains both `L 0 0` (the stem) and a segment ending at `-12 8`
    // (the vertical bar's far endpoint), so the previous looser regex
    // misdetected "one" as "many". A genuine crow's foot prong always starts
    // at (0,0); the "one" bar starts at (-12, -8).
    const isCrowFoot = /(?:L|M)\s*0\s+0\s+L\s*-12\s+-?8/.test(d) || d.includes('L 12 0');
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
    // Safari SVG marker cache workaround: Safari caches the link <path>'s
    // rendering keyed on the path element identity, and does NOT repaint when
    // a referenced <marker> changes — even when `marker-end` is updated to
    // point at a fresh marker id. The v1.11.0 attempt at minting a new
    // marker id via null → flush → set looked clean, but JointJS deduplicates
    // <marker> elements in <defs>: the second `set` would often re-bind to an
    // orphan marker from a previous swap, leaving Safari's cache valid and
    // the user staring at a stale arrowhead until reload. Re-inserting the
    // link's whole group invalidates the cache outright.
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
    lineArrow: '<line x1="2" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="1.5"/><path d="M 20 3 L 30 9 L 20 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>',
    one:       '<line x1="2" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="2"/><line x1="30" y1="3" x2="30" y2="15" stroke="currentColor" stroke-width="2"/>',
    zeroOne:   '<line x1="2" y1="9" x2="18" y2="9" stroke="currentColor" stroke-width="1.5"/><circle cx="22" cy="9" r="4" fill="var(--bg-canvas, #1A1A1A)" stroke="currentColor" stroke-width="2"/><line x1="26" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="2"/><line x1="30" y1="3" x2="30" y2="15" stroke="currentColor" stroke-width="2"/>',
    many:      '<line x1="2" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="1.5"/><path d="M 30 3 L 20 9 L 30 15" fill="none" stroke="currentColor" stroke-width="2"/>',
    oneMany:   '<line x1="2" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="1.5"/><line x1="18" y1="3" x2="18" y2="15" stroke="currentColor" stroke-width="2"/><path d="M 30 3 L 20 9 L 30 15" fill="none" stroke="currentColor" stroke-width="2"/>',
    zeroMany:  '<line x1="2" y1="9" x2="9" y2="9" stroke="currentColor" stroke-width="1.5"/><circle cx="13" cy="9" r="4" fill="var(--bg-canvas, #1A1A1A)" stroke="currentColor" stroke-width="2"/><line x1="17" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="1.5"/><path d="M 30 3 L 20 9 L 30 15" fill="none" stroke="currentColor" stroke-width="2"/>',
  };
  const lineStroke = cell.attr('line/stroke') || '#888888';
  addMarkerPicker(appearance, 'Source end', detectMarker(cell.attr('line/sourceMarker')), markerOpts, markerSvgs, v => {
    applyMarker(cell, 'sourceMarker', markerDefs[v]);
  }, { strokeColor: lineStroke });
  addMarkerPicker(appearance, 'Target end', detectMarker(cell.attr('line/targetMarker')), markerOpts, markerSvgs, v => {
    applyMarker(cell, 'targetMarker', markerDefs[v]);
  }, { strokeColor: lineStroke });

  // Reverse direction + Simplify path — generic link actions available on EVERY
  // connector (any diagram type), stacked at the foot of Appearance with Reverse
  // directly above Simplify, sharing one button style.
  const reverseBtn = document.createElement('button');
  reverseBtn.className = 'df-properties__btn df-properties__btn--auto-size';
  reverseBtn.style.marginTop = '6px';
  reverseBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M2 5 L13 5 M10 2 L13 5 L10 8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M14 11 L3 11 M6 8 L3 11 L6 14" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    Reverse direction`;
  reverseBtn.addEventListener('click', () => {
    // Swap endpoints — the link redraws in the opposite direction (markers follow
    // their ends). A single set keeps it one undo step.
    const s = cell.get('source'); const t = cell.get('target');
    cell.set({ source: t, target: s });
  });
  appearance.appendChild(reverseBtn);

  // Simplify path button
  const simplifyBtn = document.createElement('button');
  simplifyBtn.className = 'df-properties__btn df-properties__btn--auto-size';
  simplifyBtn.style.marginTop = '6px';
  simplifyBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M2 13 L14 3" stroke-linecap="round"/>
      <circle cx="2" cy="13" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="14" cy="3" r="1.5" fill="currentColor" stroke="none"/>
    </svg>
    Simplify path`;
  simplifyBtn.addEventListener('click', () => {
    // Two prop changes collapsed into one history command — Cmd+Z restores both
    // the prior vertices AND the prior connector in a single undo step.
    history.startBatch();
    try {
      cell.vertices([]);
      cell.connector('rounded', { radius: 8 });
    } finally {
      history.endBatch();
    }
  });
  appearance.appendChild(simplifyBtn);

  // Delete (in footer)
  addCloneBtn(footerEl, cell);
  addDeleteBtn(footerEl, () => { graph.removeCells([cell]); selection.clearSelection(); });
}

// ── Accordion section builder ───────────────────────────────────────

function section(parent, title, open = true) {
  const wrap = document.createElement('div');
  wrap.className = 'df-section' + (open ? '' : ' df-section--collapsed');

  const hdr = document.createElement('div');
  hdr.className = 'df-section__header';
  hdr.innerHTML = `
    <span>${title}</span>
    <svg class="df-section__chevron" viewBox="0 0 10 6" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 0 L5 6 L10 0 Z"/>
    </svg>`;
  hdr.addEventListener('click', () => wrap.classList.toggle('df-section--collapsed'));

  const body = document.createElement('div');
  body.className = 'df-section__body';

  wrap.appendChild(hdr);
  wrap.appendChild(body);
  parent.appendChild(wrap);
  return body;
}

// ── Order buttons (inlined into Size & Order section) ─────────────
// Bring to Front / Send to Back operate WITHIN the element's z-tier
// so that type-based layering (Zone < Container < Node) is never violated.

/**
 * Plain-language label for the peer set affected by Bring to Front /
 * Send to Back on this cell. Defaults to the generic z-tier name
 * (`backgrounds` / `containers` / `shapes`) but swaps in a more
 * diagram-specific phrase where the generic word reads awkwardly — e.g.
 * a Gantt user thinks in "timelines and groups", not "containers"; a
 * sequence-diagram user thinks in "fragments". The peer SET is unchanged
 * (still everything in the same z-tier on this tab's graph); only the
 * wording is sharpened.
 *
 * Order of precedence: per-type override → generic tier name.
 */
function orderPeerLabel(cell) {
  const type = cell.get('type');
  const SPECIFIC = {
    // Process — backgrounds tier is dominated by BpmnPool
    'sf.BpmnPool':            'pools',
    // Sequence — containers tier maps cleanly to fragments
    'sf.SequenceFragment':    'fragments',
    // Sequence — shapes tier dominated by participants / actors / activations
    'sf.SequenceParticipant': 'participants and actors',
    'sf.SequenceActor':       'participants and actors',
    'sf.SequenceActivation':  'participants and actors',
    // Gantt — containers tier maps to timelines + groups
    'sf.GanttTimeline':       'timelines and groups',
    'sf.GanttGroup':          'timelines and groups',
    // Gantt — shapes tier maps to tasks + milestones + markers
    'sf.GanttTask':           'tasks and milestones',
    'sf.GanttMilestone':      'tasks and milestones',
    'sf.GanttMarker':         'tasks and milestones',
  };
  return SPECIFIC[type] || tierNameForType(type);
}

/** Raise a cell above its same-tier peers (undoable). Shared by the properties Order button + the context menu. */
export function bringToFront(cell) {
  const type = cell.get('type');
  const tierBase = Z_BASE[type] ?? 20000;
  const tierMax = tierBase + Z_TIER_SPAN;
  const peers = graph.getElements().filter(el => el !== cell && el.get('z') >= tierBase && el.get('z') < tierMax);
  const maxZ = peers.length ? Math.max(...peers.map(el => el.get('z') ?? tierBase)) : tierBase;
  const oldZ = cell.get('z');
  const newZ = maxZ + 1;
  if (oldZ === newZ) return;
  cell.set('z', newZ);
  history.recordCommand(
    () => { const c = graph.getCell(cell.id); if (c) c.set('z', oldZ); },
    () => { const c = graph.getCell(cell.id); if (c) c.set('z', newZ); },
  );
}

/** Drop a cell below its same-tier peers (undoable). Shared by the properties Order button + the context menu. */
export function sendToBack(cell) {
  const type = cell.get('type');
  const tierBase = Z_BASE[type] ?? 20000;
  const tierMax = tierBase + Z_TIER_SPAN;
  const peers = graph.getElements().filter(el => el !== cell && el.get('z') >= tierBase && el.get('z') < tierMax);
  const minZ = peers.length ? Math.min(...peers.map(el => el.get('z') ?? tierBase)) : tierBase;
  const oldZ = cell.get('z');
  const newZ = Math.max(tierBase, minZ - 1);
  if (oldZ === newZ) return;
  cell.set('z', newZ);
  history.recordCommand(
    () => { const c = graph.getCell(cell.id); if (c) c.set('z', oldZ); },
    () => { const c = graph.getCell(cell.id); if (c) c.set('z', newZ); },
  );
}

// Primary text selectors a shape may use for its MAIN label, in priority order. Detecting which one a cell
// actually has (a non-null fontSize) lets ONE generic Font-size control serve every text-rendering shape, added
// uniformly to the Size & Order section (item 1). A shape whose label font is COMPUTED by a custom view
// (sf.OrgPerson sizes nameLabel/positionLabel dynamically in OrgPersonView; DataObject field rows are hard-coded)
// has none of these as an attr-driven primary label, so it gets no control here - correct, the value would not stick.
const FONT_LABEL_SELECTORS = ['label', 'headerLabel', 'titleText'];
function primaryFontSelector(cell) {
  for (const sel of FONT_LABEL_SELECTORS) {
    if (cell.attr && cell.attr(`${sel}/fontSize`) != null) return sel;
  }
  return null;
}
/** Append a single Font-size control for the cell's primary label, if it has an attr-driven one. Stores at
 *  `<selector>/fontSize` (the same path the existing TextLabel/Link controls used) so it is lossless + reversible. */
function addFontSizeControl(sec, cell) {
  const sel = primaryFontSelector(cell);
  if (!sel) return;
  addNumber(sec, 'Font size', cell.attr(`${sel}/fontSize`) ?? 13, (v) => cell.attr(`${sel}/fontSize`, v), { min: 6, max: 96 });
}

function addOrderButtons(sec, cell) {
  // Item 1: a Font-size control lives in EVERY shape's Size & Order section (this is the universal terminal call
  // of that section), placed above the z-order buttons. One definition covers all text shapes; the old per-shape
  // controls in Appearance (TextLabel / Link) were removed so it is not duplicated.
  addFontSizeControl(sec, cell);
  const peerLabel = orderPeerLabel(cell);

  const btnRow = document.createElement('div');
  // Order-specific modifier (v1.12.1) lets us visually group the buttons
  // with the hint below them rather than with whatever sits above
  // (typically the Width / Height inputs). Pure CSS-side change — the
  // base `.df-prop-pair` flex behaviour is preserved.
  btnRow.className = 'df-prop-pair df-prop-pair--order';

  // Bring to Front (the z-logic lives in the exported bringToFront/sendToBack, shared with the context menu)
  const frontBtn = document.createElement('button');
  frontBtn.className = 'df-properties__btn df-properties__btn--order';
  frontBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 2h12v2H2zM4 6h8v2H4zM6 10h4v4H6z"/>
    </svg>
    Bring to Front`;
  frontBtn.title = `Bring in front of other ${peerLabel}`;
  frontBtn.addEventListener('click', () => bringToFront(cell));   // shared with the context menu

  // Send to Back
  const backBtn = document.createElement('button');
  backBtn.className = 'df-properties__btn df-properties__btn--order';
  backBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 2h4v4H6zM4 8h8v2H4zM2 12h12v2H2z"/>
    </svg>
    Send to Back`;
  backBtn.title = `Send behind other ${peerLabel}`;
  backBtn.addEventListener('click', () => sendToBack(cell));   // shared with the context menu

  btnRow.appendChild(frontBtn);
  btnRow.appendChild(backBtn);
  sec.appendChild(btnRow);

  // Hint appears BELOW the buttons (v1.12.1) — the action is the headline,
  // the scope is the footnote. Previously rendered above, which competed
  // visually with the Width input directly above the section.
  const hint = document.createElement('div');
  hint.className = 'df-prop-order-hint';
  hint.textContent = `Move within other ${peerLabel}`;
  sec.appendChild(hint);
}

// ── Standalone convert button (not inside accordion) ───────────────

// Item 2: give every bottom action button the SAME glyph as the single-shape footer + the right-click menu.
// Auto-picked from the label so all addActionBtn callers (Save as Template / Save Shape / Select all / Convert
// all to X) get a matching icon without threading it through each multi-line call.
function autoActionIcon(label) {
  if (/^save/i.test(label)) return SAVE_SHAPE_ICON_SVG;
  if (/^select all/i.test(label)) return SELECT_ALL_ICON_SVG;
  if (/^convert/i.test(label)) return CONVERT_ICON_SVG;
  return '';
}
function addActionBtn(parent, label, onClick, iconSvg = '') {
  const wrap = document.createElement('div');
  wrap.className = 'df-convert-strip';
  const btn = document.createElement('button');
  btn.className = 'df-properties__btn df-properties__btn--convert';
  const icon = iconSvg || autoActionIcon(label);
  if (icon) btn.innerHTML = `${icon} ${escHtml(label)}`;
  else btn.textContent = label;
  btn.addEventListener('click', onClick);
  wrap.appendChild(btn);
  parent.appendChild(wrap);
}

function addConvertBtn(parent, label, onClick) {
  const wrap = document.createElement('div');
  wrap.className = 'df-convert-strip';
  const btn = document.createElement('button');
  btn.className = 'df-properties__btn df-properties__btn--convert';
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1 4h11l-3-3M15 12H4l3 3"/>
  </svg> ${label}`;
  btn.addEventListener('click', onClick);
  wrap.appendChild(btn);
  parent.appendChild(wrap);
}

// ── Clone button ────────────────────────────────────────────────────

const CLONE_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="5" y="5" width="9" height="9" rx="2"/>
    <path d="M3 11H2.5A1.5 1.5 0 011 9.5V2.5A1.5 1.5 0 012.5 1h7A1.5 1.5 0 0111 2.5V3"/>
  </svg>`;
// Copy-to-clipboard glyph (a clipboard) — distinct from Clone (in-place duplicate); matches the canvas menu's
// Copy icon. Copy lets you paste into another tab/diagram; Clone duplicates beside the original.
const COPY_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="3" width="8" height="11" rx="1.5"/>
    <path d="M6 3V1.8h4V3"/>
  </svg>`;
// Footer-button glyphs matching the right-click menu's CTX_ICON set (item 2): Save Shape = a bookmark, Select
// all = a dashed marquee, Convert = the swap arrows (the same path addConvertBtn draws).
const SAVE_SHAPE_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 2h8a1 1 0 011 1v11l-5-3-5 3V3a1 1 0 011-1z"/>
  </svg>`;
const SELECT_ALL_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke-dasharray="2.4 1.8"/>
  </svg>`;
const CONVERT_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1 4h11l-3-3M15 12H4l3 3"/>
  </svg>`;

/** Default clone behavior for a single cell: place a copy beside the original. */
function cloneCellPlain(cell) {
  const clone = cell.clone();
  if (cell.isElement()) {
    const pos = cell.position();
    const size = cell.size();
    clone.position(pos.x + size.width + 16, pos.y);
    clone.unset('parent');
    clone.unset('embeds');
  } else if (cell.isLink()) {
    // Offset vertices so the cloned link traces a parallel path
    const verts = clone.get('vertices');
    if (verts) clone.set('vertices', verts.map(v => ({ x: v.x + 24, y: v.y + 24 })));
  }
  graph.addCell(clone);
  selection.selectOnly(clone.id);
}

function addCloneBtn(parent, cell) {
  const wrap = document.createElement('div');
  wrap.className = 'df-clone-strip';

  // Always show a primary "Clone" button (plain duplicate — element only,
  // or parallel connector for links).
  const primary = document.createElement('button');
  primary.className = 'df-properties__btn df-properties__btn--clone';
  primary.innerHTML = `${CLONE_ICON_SVG} Clone`;
  primary.addEventListener('click', () => cloneCellPlain(cell));
  wrap.appendChild(primary);

  // For elements with attached connectors, surface the connector-aware
  // clone modes as stacked sub-buttons under the primary action.
  if (cell.isElement?.()) {
    const connectorCount = countConnectors(cell);
    const connectedCount = countConnectedConnectors(cell);

    const addSubBtn = (label, mode) => {
      const sub = document.createElement('button');
      sub.className = 'df-properties__btn df-properties__btn--clone df-properties__btn--clone-sub';
      sub.innerHTML = `${CLONE_ICON_SVG} Clone ${label}`;
      sub.addEventListener('click', () => cloneElementWithConnectors(cell, mode));
      wrap.appendChild(sub);
    };

    if (connectorCount > 0) {
      addSubBtn('with Connectors', 'dangling');
    }
    // Only show "connected Connectors" when at least one connector actually
    // links to another element — otherwise the option is functionally
    // identical to "with Connectors" and would just confuse users.
    if (connectedCount > 0) {
      addSubBtn('with connected Connectors', 'connected');
    }
  }

  // Copy to clipboard (paste into another tab / diagram) — a sibling to Clone, available for every cell.
  const copyBtn = document.createElement('button');
  copyBtn.className = 'df-properties__btn df-properties__btn--clone';
  copyBtn.innerHTML = `${COPY_ICON_SVG} Copy`;
  copyBtn.addEventListener('click', () => clipboardCopy());
  wrap.appendChild(copyBtn);

  parent.appendChild(wrap);

  // Save Shape (item 1) - the single-shape counterpart to the multi-select "Save as Template", in EVERY single-
  // element footer (addCloneBtn is the shared call), just above Delete. Same bookmark glyph as the right-click
  // menu's Save Shape. Images can't be saved (no thumbnail / storage).
  if (cell?.isElement?.() && cell.get('type') !== 'sf.Image') {
    addActionBtn(parent, 'Save Shape', () => saveCellAsShape(cell), SAVE_SHAPE_ICON_SVG);
  }
}

/**
 * The bottom-of-properties-panel actions for a single ELEMENT, as an ordered descriptor list, so the canvas
 * right-click menu can mirror them (#6). Same handlers the panel buttons call (clone variants, copy, convert,
 * order, auto size). Delete is NOT included - the context menu owns its danger Delete (deleteSelected).
 * Each item: { label, iconKey (CTX_ICON key in selection.js), group (for separators), handler }.
 * Wired into selection.js via setActionProvider in app.js (selection.js can't import properties.js - cycle).
 */
// ── Copy / Paste STYLE (colours only) — a type-aware style clipboard ──────────────
// captureCellStyle snapshots the cell's COLOR_SCHEMA colour slots BY LABEL; pasteCellStyle applies them to a
// TARGET via the target's OWN setters, so the correct attr paths + side-effects run (icon re-tint, text
// contrast) and only the labels both types share transfer (a Node's Fill/Border/Label colour lands on a
// Container too, ignoring slots the target lacks). One undo per paste. Colours only by design (the user picked
// that scope); fonts / line styles are out of scope. Module-scoped, so it clears on reload — expected.
let _styleClip = null;   // { type, styles: { [label]: value } }
export function hasStyleClip() { return !!_styleClip; }
/** Snapshot a cell's colour style into the clipboard. Returns true if anything was captured. */
export function copyCellStyle(cell) {
  const schema = cell && COLOR_SCHEMA[cell.get('type')];
  if (!schema) return false;
  const styles = {};
  for (const slot of schema) { const v = slot.get(cell); if (v != null && v !== '') styles[slot.label] = v; }
  if (!Object.keys(styles).length) return false;
  _styleClip = { type: cell.get('type'), styles };
  showToast('Style copied - right-click another shape to paste it', 'info');
  return true;
}
/** Apply the clipboard's colours to one cell via ITS schema's setters (label-matched). Returns true if any slot set. */
function applyClipStyle(cell, clip) {
  const schema = cell && COLOR_SCHEMA[cell.get('type')];
  if (!schema || !clip) return false;
  let any = false;
  for (const slot of schema) {
    if (Object.prototype.hasOwnProperty.call(clip.styles, slot.label)) { slot.set(cell, clip.styles[slot.label]); any = true; }
  }
  return any;
}
/** Paste the clipboard style onto every element in `cells` (one undo batch). Returns the count styled. */
export function pasteCellStyle(cells) {
  if (!_styleClip || !cells || !cells.length) return 0;
  let n = 0;
  history.startBatch();
  try { for (const c of cells) { if (c?.isElement?.() && applyClipStyle(c, _styleClip)) n++; } }
  finally { history.endBatch(); }
  if (n) { refresh(); showToast(`Style pasted to ${n} component${n === 1 ? '' : 's'} ✓`, 'success'); }
  return n;
}

export function buildCellActions(cell) {
  if (!cell || !cell.isElement?.()) return [];
  const type = cell.get('type');
  const iconMode = !!cell.get('iconMode');
  const acts = [];

  // Clone variants + Copy (the addCloneBtn set).
  acts.push({ label: 'Clone', iconKey: 'clone', group: 'clone', handler: () => cloneCellPlain(cell) });
  if (countConnectors(cell) > 0) acts.push({ label: 'Clone with Connectors', iconKey: 'clone', group: 'clone', handler: () => cloneElementWithConnectors(cell, 'dangling') });
  if (countConnectedConnectors(cell) > 0) acts.push({ label: 'Clone with connected Connectors', iconKey: 'clone', group: 'clone', handler: () => cloneElementWithConnectors(cell, 'connected') });
  acts.push({ label: 'Copy', iconKey: 'copy', group: 'clone', handler: () => clipboardCopy() });

  // Copy / Paste STYLE (colours) — its own group so it reads apart from the clipboard Copy above (#1).
  if (COLOR_SCHEMA[type]) {
    acts.push({ label: 'Copy style', iconKey: 'copyStyle', group: 'style', handler: () => copyCellStyle(cell) });
    if (hasStyleClip()) acts.push({ label: 'Paste style', iconKey: 'pasteStyle', group: 'style', handler: () => pasteCellStyle([cell]) });
  }

  // Convert (only where the panel offers it): SimpleNode <-> Container/Icon, Container -> Node.
  if (type === 'sf.SimpleNode' && !iconMode) {
    acts.push({ label: 'Convert to Container', iconKey: 'convert', group: 'convert', handler: () => convertToContainer(cell) });
    acts.push({ label: 'Convert to Icon', iconKey: 'convert', group: 'convert', handler: () => convertToIcon(cell) });
  } else if (type === 'sf.SimpleNode' && iconMode) {
    acts.push({ label: 'Convert to Node', iconKey: 'convert', group: 'convert', handler: () => convertFromIcon(cell) });
  } else if (type === 'sf.Container') {
    acts.push({ label: 'Convert to Node', iconKey: 'convert', group: 'convert', handler: () => convertToNode(cell) });
  }

  // Order (z within the same tier).
  acts.push({ label: 'Bring to Front', iconKey: 'front', group: 'order', handler: () => bringToFront(cell) });
  acts.push({ label: 'Send to Back', iconKey: 'back', group: 'order', handler: () => sendToBack(cell) });

  // Auto size (every element type except sf.Image, which the panel omits).
  if (type !== 'sf.Image') acts.push({ label: 'Auto size', iconKey: 'autosize', group: 'size', handler: () => autoSizeCell(cell) });

  // Save Shape - stash this shape (content + style) in My Shapes for reuse (the single-shape counterpart to the
  // multi-select "Save as Template"). Images can't be saved (storage). Its own group so it reads apart.
  if (type !== 'sf.Image') acts.push({ label: 'Save Shape', iconKey: 'saveShape', group: 'save', handler: () => saveCellAsShape(cell) });

  return acts;
}

// ── Delete button (red, bottom of panel) ─────────────────────────────

function addDeleteBtn(parent, onClick) {
  const wrap = document.createElement('div');
  wrap.className = 'df-delete-strip';
  const btn = document.createElement('button');
  btn.className = 'df-properties__btn df-properties__btn--delete';
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
  f.className = 'df-prop-field';
  if (label) {
    const l = document.createElement('div');
    l.className = 'df-properties__label';
    l.textContent = label;
    f.appendChild(l);
  }
  parent.appendChild(f);
  return f;
}

/**
 * CR-6.1 (v1.12.0) — wire markdown formatting shortcuts onto a text input or
 * textarea, and (optionally) append a subtle hint below it. Used by the
 * property-panel renderers for sf.TextLabel and sf.Note.
 *
 * Shortcuts mirror common markdown editors:
 *   Cmd/Ctrl + B        → wrap selection with **bold**
 *   Cmd/Ctrl + I        → wrap with *italic*
 *   Cmd/Ctrl + Shift+X  → wrap with ~~strike~~
 *   Cmd/Ctrl + E        → wrap with `code`
 *
 * After wrapping, dispatches an 'input' event so the field's existing
 * onChange wiring (and the focus-coalesced history batch) captures the
 * change naturally — no special history plumbing here.
 */
function wireMarkdownShortcuts(inputEl, hintParent) {
  if (!inputEl) return;
  const SHORTCUTS = {
    b: '**',
    i: '*',
    e: '`',
    // Strike uses Shift+X to avoid colliding with text-cut (Cmd+X).
  };
  inputEl.addEventListener('keydown', (evt) => {
    const mod = evt.ctrlKey || evt.metaKey;
    if (!mod) return;
    const key = evt.key.toLowerCase();
    let marker = null;
    if (evt.shiftKey && key === 'x') marker = '~~';
    else if (!evt.shiftKey && SHORTCUTS[key]) marker = SHORTCUTS[key];
    if (!marker) return;
    evt.preventDefault();
    if (wrapSelectionWithMarker(inputEl, marker)) {
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  if (hintParent) {
    const hint = document.createElement('div');
    hint.className = 'df-properties__hint';
    hint.innerHTML = 'Supports <strong>**bold**</strong>, <em>*italic*</em>, <del>~~strike~~</del>, <code>`code`</code>';
    hintParent.appendChild(hint);
  }
}

function addText(parent, label, value, onChange, cell, opts) {
  const f = field(parent, label);
  const input = document.createElement('textarea');
  input.className = 'df-properties__input df-properties__text-input';
  input.value = value ?? '';
  if (opts?.placeholder) input.placeholder = opts.placeholder;
  input.rows = 1;
  // Return the input so callers can imperatively sync its value (e.g. when
  // another control changes the underlying model and the field must reflect it).
  // Auto-size: grow to fit content, minimum 1 row
  const autoSize = () => {
    const lines = (input.value.match(/\n/g) || []).length + 1;
    input.rows = Math.max(1, lines);
  };
  autoSize();
  input.addEventListener('input', () => { onChange(input.value); autoSize(); });
  // Coalesce all per-keystroke graph events from a single focus session into
  // one undo entry — Cmd+Z restores the whole prior text in one click instead
  // of letter-by-letter.
  let editing = false;
  input.addEventListener('focus', () => {
    if (!editing) { history.startBatch(); editing = true; }
  });
  input.addEventListener('blur', () => {
    if (editing) { history.endBatch(); editing = false; }
  });
  // Highlight label on canvas when editing (auto-detect cell from selection if not passed)
  const targetCell = cell || getActiveCell();
  if (targetCell) wireCanvasLabelHighlight(input, targetCell);
  f.appendChild(input);
  return input;
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
    caretEl.setAttribute('class', 'df-canvas-caret');
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
  display.className = 'df-properties__input';
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

function addTextarea(parent, label, value, onChange, opts) {
  const f = field(parent, label);
  const ta = document.createElement('textarea');
  ta.className = 'df-properties__input df-properties__textarea';
  ta.value = value ?? '';
  if (opts?.placeholder) ta.placeholder = opts.placeholder;
  // Auto-size: show one more line than current text
  const autoSize = () => {
    const lines = (ta.value.match(/\n/g) || []).length + 1;
    ta.rows = lines + 1;
  };
  autoSize();
  ta.addEventListener('input', () => { onChange(ta.value); autoSize(); });
  // Coalesce per-keystroke events into one undo entry per focus session.
  let editing = false;
  ta.addEventListener('focus', () => {
    if (!editing) { history.startBatch(); editing = true; }
  });
  ta.addEventListener('blur', () => {
    if (editing) { history.endBatch(); editing = false; }
  });
  f.appendChild(ta);
  return ta;
}

/**
 * Chip-style tag input. Tokens commit on Enter/comma/blur. Each chip has an
 * × button. `onChange` receives the full string array on every mutation.
 *
 * Single-undo-batch per add/remove: one entry per chip mutation, not per
 * keystroke into the input itself (which doesn't change the model).
 */
function addChipInput(parent, label, values, onChange) {
  const f = field(parent, label);
  const wrap = document.createElement('div');
  wrap.className = 'df-chip-input';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'df-chip-input__input';
  let chips = Array.isArray(values) ? [...values] : [];

  const commitInput = () => {
    const raw = input.value.trim().replace(/,$/, '').trim();
    if (!raw) { input.value = ''; return false; }
    if (!chips.includes(raw)) {
      chips.push(raw);
      onChange([...chips]);
      renderChips();
    }
    input.value = '';
    return true;
  };

  const renderChips = () => {
    // Remove all existing chip elements (keep the input at the end)
    [...wrap.querySelectorAll('.df-chip')].forEach(c => c.remove());
    for (const tag of chips) {
      const chip = document.createElement('span');
      chip.className = 'df-chip';
      chip.textContent = tag;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'df-chip__remove';
      x.setAttribute('aria-label', `Remove ${tag}`);
      x.textContent = '×';
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        chips = chips.filter(t => t !== tag);
        onChange([...chips]);
        renderChips();
      });
      chip.appendChild(x);
      wrap.insertBefore(chip, input);
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitInput();
    } else if (e.key === 'Backspace' && input.value === '' && chips.length > 0) {
      // Backspace on empty input pops the last chip
      chips.pop();
      onChange([...chips]);
      renderChips();
    }
  });
  input.addEventListener('blur', () => commitInput());
  // Click anywhere in the wrap focuses the input — feels like a normal field.
  wrap.addEventListener('click', () => input.focus());

  wrap.appendChild(input);
  f.appendChild(wrap);
  renderChips();
  return wrap;
}

/**
 * RACI multi-pick segmented control. Each of R/A/C/I is independently
 * toggleable; selected buttons are color-coded (blue / red / amber / grey).
 * `value` is an object like `{ R: true, A: false, C: false, I: true }`.
 */
function addRaciPicker(parent, label, value, onChange) {
  const f = field(parent, label);
  const grid = document.createElement('div');
  grid.className = 'df-raci-picker';
  const state = { R: !!value?.R, A: !!value?.A, C: !!value?.C, I: !!value?.I };
  const NAMES = { R: 'Responsible', A: 'Accountable', C: 'Consulted', I: 'Informed' };
  for (const key of ['R', 'A', 'C', 'I']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'df-raci-picker__btn' + (state[key] ? ' df-raci-picker__btn--active' : '');
    btn.dataset.raci = key;
    btn.title = NAMES[key];
    btn.textContent = key;
    btn.addEventListener('click', () => {
      state[key] = !state[key];
      btn.classList.toggle('df-raci-picker__btn--active', state[key]);
      onChange({ ...state });
    });
    grid.appendChild(btn);
  }
  f.appendChild(grid);
}

function addColor(parent, label, value, onChange, opts = {}) {
  // Group every attr mutation the setter performs into one undo entry
  // (a SimpleNode Fill pick touches body/fill + label/fill + subtitle/fill
  // + subtitle/opacity — without batching, Cmd+Z would only revert one).
  const batched = asUndoBatch(onChange);

  const f = field(parent, label);
  const row = document.createElement('div');
  row.className = 'df-prop-color-row';

  const hex = toHex(value);

  const swatch = document.createElement('input');
  swatch.type = 'color';
  swatch.className = 'df-properties__color';
  swatch.value = hex;

  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.className = 'df-properties__input';
  // Always display as hex — never raw CSS vars or rgba strings
  textInput.value = value ? hex : '';

  // Track the last-known-good value so an invalid commit can revert cleanly.
  let lastValid = hex;

  // Gap 20 (v1.12.0) — optional reset-to-default ↺ button. When the field
  // declares a clear default value (e.g. brand blue for a Header fill), we
  // render a small icon button that snaps the swatch back to that default
  // and fires the onChange. The button is dimmed when the current value
  // already matches the default so users can see the "nothing to reset"
  // state at a glance.
  // Revert target: an explicit default if the field declares one (e.g. brand blue for
  // a Header fill), otherwise the value the field opened with — so EVERY colour input
  // can snap back to where it started. `resetRaw` keeps the original raw string
  // (rgba/var) so reverting restores translucency exactly, not a flattened hex.
  const resetRaw = opts.defaultValue != null ? opts.defaultValue : value;
  const defaultHex = resetRaw ? toHex(resetRaw) : null;
  let resetBtn = null;
  const refreshResetState = () => {
    if (!resetBtn) return;
    const matches = (lastValid || '').toLowerCase() === defaultHex.toLowerCase();
    resetBtn.classList.toggle('is-default', matches);
    resetBtn.disabled = matches;
  };

  swatch.addEventListener('input', () => {
    textInput.value = swatch.value;
    lastValid = swatch.value;
    batched(swatch.value);
    refreshResetState();
  });
  textInput.addEventListener('change', () => {
    // Gap 9 (v1.12.0) — strict hex validation. Accept 3, 4, 6, or 8-digit
    // hex with optional leading `#`. Anything else: revert to the last
    // valid value AND briefly flash a red border so the user sees their
    // input was rejected (no modal — text-level inline feedback only).
    const raw = textInput.value.trim();
    const stripped = raw.replace(/^#/, '');
    const isValidHex = /^[0-9a-fA-F]{3,8}$/.test(stripped) &&
      [3, 4, 6, 8].includes(stripped.length);
    if (!isValidHex && raw !== '') {
      textInput.value = lastValid;
      textInput.classList.add('df-properties__input--invalid');
      setTimeout(() => textInput.classList.remove('df-properties__input--invalid'), 400);
      return;
    }
    const h = toHex(raw);
    swatch.value = h;
    textInput.value = h;
    lastValid = h;
    batched(h);
    refreshResetState();
  });

  row.appendChild(swatch);
  row.appendChild(textInput);

  if (defaultHex) {
    resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'df-prop-color-reset';
    resetBtn.title = `${opts.defaultValue != null ? 'Reset to default' : 'Revert to original'} (${defaultHex})`;
    resetBtn.setAttribute('aria-label', 'Reset color to default');
    // Counter-clockwise arrow ↺ — matches the visual idiom users already
    // associate with "reset" / "undo" without conflicting with the toolbar
    // undo icon.
    resetBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.46-3.54"/><path d="M3 2.5V5h2.5"/></svg>`;
    resetBtn.addEventListener('click', () => {
      if (resetBtn.disabled) return;
      swatch.value = defaultHex;
      textInput.value = defaultHex;
      lastValid = defaultHex;
      batched(resetRaw);
      refreshResetState();
    });
    row.appendChild(resetBtn);
    refreshResetState();
  }

  f.appendChild(row);

  // Brand palette strip (v1.12.4) — saved swatches below the picker.
  // Click a swatch to apply; long-hover OR right-click reveals its × remove control (so a quick
  // click never deletes by accident); press + (right end) to bank the current color for reuse.
  // Subscribes to onPaletteChange so
  // multiple open pickers (e.g., Fill + Border + Label) stay in sync.
  const paletteRow = document.createElement('div');
  paletteRow.className = 'df-prop-palette-strip';
  f.appendChild(paletteRow);

  const applySwatch = (hex) => {
    swatch.value = hex;
    textInput.value = hex;
    lastValid = hex;
    batched(hex);
    refreshResetState();
  };

  const renderPalette = () => {
    paletteRow.replaceChildren();
    const palette = getPalette();
    for (const hex of palette) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'df-prop-palette-swatch';
      item.style.backgroundColor = hex;
      item.title = hex;
      item.setAttribute('aria-label', `Apply ${hex}`);
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('df-prop-palette-swatch__remove')) return;
        applySwatch(hex);
      });
      // Right-click reveals the × immediately (CSS otherwise only shows it after a LONG hover), so a
      // quick left-click always APPLIES the colour — no more deleting swatches you meant to apply.
      item.addEventListener('contextmenu', (e) => { e.preventDefault(); item.classList.add('is-removable'); });
      item.addEventListener('mouseleave', () => item.classList.remove('is-removable'));
      // × remove button — revealed only on long hover / right-click (see properties.css).
      const remove = document.createElement('span');
      remove.className = 'df-prop-palette-swatch__remove';
      remove.textContent = '×';
      remove.setAttribute('role', 'button');
      remove.setAttribute('aria-label', `Remove ${hex} from palette`);
      remove.title = 'Remove from palette';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFromPalette(hex);
      });
      item.appendChild(remove);
      paletteRow.appendChild(item);
    }
    // Save-current button — sits at the RIGHT end of the strip; a newly saved colour appends right
    // here (next to this +). When the palette is full, saving drops the oldest (left-most) swatch.
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'df-prop-palette-save';
    saveBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    saveBtn.setAttribute('aria-label', 'Save current color to palette');
    saveBtn.title = palette.length >= PALETTE_MAX_SLOTS
      ? `Palette full (${PALETTE_MAX_SLOTS}) - saving will replace the oldest`
      : 'Save current color to palette';
    saveBtn.addEventListener('click', () => {
      const ok = addToPalette(lastValid);
      if (ok) showToast(`Saved ${lastValid.toUpperCase()} to palette`, { duration: 1400 });
    });
    paletteRow.appendChild(saveBtn);
  };

  renderPalette();
  // Repaint when other open color pickers add/remove. Returned
  // unsubscribe is called via a one-shot cleanup tied to field removal —
  // properties panel rebuilds the field tree on selection change, so
  // when the parent node is removed from the DOM we drop the listener.
  const unsubscribe = onPaletteChange(() => renderPalette());
  // Use a MutationObserver on the parent to detect detachment. Cheap —
  // one observer per color picker, only watching child removal at the
  // properties panel root.
  const detachObserver = new MutationObserver(() => {
    if (!document.contains(paletteRow)) {
      unsubscribe();
      detachObserver.disconnect();
    }
  });
  // The properties panel always lives under #properties; observing its
  // subtree catches every selection-driven rebuild.
  const propsRoot = document.getElementById('properties');
  if (propsRoot) detachObserver.observe(propsRoot, { childList: true, subtree: true });
}

/**
 * Multi-select color field: when `value` is null the swatch stays muted
 * and the text input shows a "Multiple" placeholder so the user can see
 * the selected elements disagree on this colour. Picking a colour (either
 * via swatch or by typing a hex) applies it to every selected element.
 */
function addColorMulti(parent, label, value, onChange) {
  // Multi-select applies the colour to every selected element × every attr
  // in that element's setter → potentially dozens of change:attrs events.
  // Batch them so a single pick is one undo command.
  const batched = asUndoBatch(onChange);

  const f = field(parent, label);
  const row = document.createElement('div');
  row.className = 'df-prop-color-row';

  const mixed = value == null;
  const hex = mixed ? '#000000' : toHex(value);

  const swatch = document.createElement('input');
  swatch.type = 'color';
  swatch.className = 'df-properties__color';
  swatch.value = hex;
  if (mixed) swatch.classList.add('df-properties__color--mixed');

  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.className = 'df-properties__input';
  textInput.value = mixed ? '' : hex;
  if (mixed) textInput.placeholder = 'Multiple';

  const clearMixed = () => {
    swatch.classList.remove('df-properties__color--mixed');
    textInput.placeholder = '';
  };

  swatch.addEventListener('input', () => {
    clearMixed();
    textInput.value = swatch.value;
    batched(swatch.value);
  });
  textInput.addEventListener('change', () => {
    const h = toHex(textInput.value);
    clearMixed();
    swatch.value = h;
    textInput.value = h;
    batched(h);
  });

  row.appendChild(swatch);
  row.appendChild(textInput);
  f.appendChild(row);
}

/**
 * Number input. Optional `opts.min` / `opts.max` clamp the value on commit
 * AND reflect the clamped value back into the input. Default `min` is 1 so
 * existing callers keep their behaviour — pass a stricter floor for fields
 * that must never go to zero (font size, line width, etc. all benefit).
 */
function addNumber(parent, label, value, onChange, opts = {}) {
  const min = opts.min ?? 1;
  const max = opts.max;
  const f = field(parent, label);
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'df-properties__input';
  input.value = value ?? 0;
  input.min = min;
  if (max != null) input.max = max;
  // Gap 31 (v1.12.0) — track the last committed value so a cleared input
  // reverts to the *current* cell state rather than the stale value
  // captured at render time. Without this, editing 100 → 200 → clear
  // would snap the visible input back to 100 while the cell holds 200.
  let lastValid = value ?? min;
  input.addEventListener('change', () => {
    let v = parseFloat(input.value);
    if (isNaN(v)) { input.value = String(lastValid); return; }
    if (v < min) v = min;
    if (max != null && v > max) v = max;
    input.value = String(v); // reflect the clamped value
    lastValid = v;
    onChange(v);
  });
  f.appendChild(input);
}

/**
 * Side-by-side pair (Width / Height). Default minimum is **16 px** (one
 * grid unit) — a safe layout floor that prevents the "unselectable
 * single-pixel dot" footgun without overriding drag-resize, which still
 * enforces shape-specific stricter minimums (see `selection.js`). Caller
 * can override per-axis via `opts.minA` / `opts.minB`.
 */
function addNumberPair(parent, labelA, valueA, onChangeA, labelB, valueB, onChangeB, opts = {}) {
  const minA = opts.minA ?? 16;
  const minB = opts.minB ?? 16;
  const maxA = opts.maxA;
  const maxB = opts.maxB;
  const pair = document.createElement('div');
  pair.className = 'df-prop-pair';

  [
    [labelA, valueA, onChangeA, minA, maxA],
    [labelB, valueB, onChangeB, minB, maxB],
  ].forEach(([lbl, val, onCh, lo, hi]) => {
    const f = document.createElement('div');
    f.className = 'df-prop-field';
    const l = document.createElement('div');
    l.className = 'df-properties__label';
    l.textContent = lbl;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'df-properties__input';
    inp.value = val ?? 0;
    inp.min = lo;
    if (hi != null) inp.max = hi;
    // Gap 31 (v1.12.0) — track lastValid per-axis. See addNumber comment.
    let lastValid = val ?? lo;
    inp.addEventListener('change', () => {
      let v = parseFloat(inp.value);
      if (isNaN(v)) { inp.value = String(lastValid); return; }
      if (v < lo) v = lo;
      if (hi != null && v > hi) v = hi;
      inp.value = String(v); // reflect the clamped value
      lastValid = v;
      onCh(v);
    });
    f.appendChild(l);
    f.appendChild(inp);
    pair.appendChild(f);
  });

  parent.appendChild(pair);
}

// Generic rotation control: a degrees input + a quick "+90°" button. The caller
// supplies how to read/write the angle. Currently drives the shape Rotation
// (native `angle`); history merges a whole interaction (spinner / typing /
// repeated +90) into ONE undo step (see js/history.js change:angle).
function rotationField(parent, label, getDeg, setDeg) {
  const norm = a => ((Math.round(a) % 360) + 360) % 360;
  const f = field(parent, label);
  f.classList.add('df-prop-rotation');
  const row = document.createElement('div');
  row.className = 'df-prop-rotation-row';
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'df-properties__input';
  input.min = 0; input.max = 360;
  input.value = String(norm(getDeg() || 0));
  let lastValid = input.value;
  input.addEventListener('change', () => {
    const raw = parseFloat(input.value);
    if (isNaN(raw)) { input.value = lastValid; return; }
    const v = norm(raw);
    input.value = String(v); lastValid = input.value;
    setDeg(v);
  });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'df-prop-rotate-90';
  btn.textContent = '+90°';
  btn.title = 'Rotate 90° clockwise';
  btn.addEventListener('click', () => {
    const v = norm((getDeg() || 0) + 90);
    setDeg(v);
    input.value = String(v); lastValid = input.value;
  });
  row.appendChild(input);
  row.appendChild(btn);
  f.appendChild(row);
}

// Shape rotation — writes the native `angle` via cell.rotate().
function addRotationField(parent, cell) {
  rotationField(parent, 'Rotation', () => cell.angle(), v => cell.rotate(v, true));
}

// Shared auto-size glyph — the SAME stroke-style "fit" arrows the canvas right-click menu uses (#7), so the
// action reads identically in the sidebar and the menu. (Exported so selection.js's CTX_ICON reuses the path.)
export const AUTOSIZE_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V3h4M13 9v4H9M3 3l4 4M13 13l-4-4"/></svg>`;

function addAutoSizeBtn(parent, onClick) {
  const btn = document.createElement('button');
  btn.className = 'df-properties__btn df-properties__btn--auto-size';
  btn.innerHTML = `${AUTOSIZE_ICON_SVG} Auto Size`;
  btn.title = 'Fit to default minimum size (or fit embedded content)';
  btn.addEventListener('click', onClick);
  parent.appendChild(btn);
}

const TYPE_PLURALS = {
  'sf.SimpleNode':     'Nodes',
  'sf.Container':      'Containers',
  'sf.Zone':           'Zones',
  'sf.TaskGroup':      'Task Groups',
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
  'sf.GanttMarker':    'Markers',
  'sf.GanttTimeline':  'Timelines',
  'sf.GanttGroup':     'Groups',
};

function addApplySizeBtn(parent, cell) {
  const type = cell.get('type');
  const typePlural = TYPE_PLURALS[type] || 'Shapes';
  const btn = document.createElement('button');
  btn.className = 'df-properties__btn df-properties__btn--apply-size';
  btn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 1h5v2H3v3H1V1zm9 0h5v5h-2V3h-3V1zM1 10h2v3h3v2H1v-5zm12 3h-3v2h5v-5h-2v3z"/>
      <circle cx="8" cy="8" r="2"/>
    </svg>
    Apply this size to all ${typePlural}`;
  btn.title = `Resize every ${typePlural.toLowerCase()} to match this element's width and height`;
  btn.addEventListener('click', async () => {
    const { width, height } = cell.size();
    // Count peers BEFORE confirming so the dialog can quote the exact number
    // of cells the user is about to change — critical for "did I really
    // mean to resize 47 nodes?" moments.
    const peers = graph.getElements().filter(
      el => el.get('type') === type && el.id !== cell.id
    );
    if (peers.length === 0) return; // nothing to do
    const ok = await confirmModal({
      title: `Apply size to all ${typePlural.toLowerCase()}?`,
      // Wording note (v1.12.1): the old "This is undoable" was ambiguous —
      // English natively reads "undoable" as "cannot be undone" even though
      // the technical meaning is "can be undone". The new phrasing names
      // the keyboard shortcut so the user knows the safety net is one
      // keystroke away.
      message: `${peers.length} other ${peers.length === 1 ? typePlural.toLowerCase().replace(/s$/, '') : typePlural.toLowerCase()} on this diagram will be resized to ${Math.round(width)} × ${Math.round(height)} px. You can undo with ⌘Z (Ctrl+Z).`,
      okLabel: 'Apply',
      cancelLabel: 'Cancel',
      tone: 'primary',
    });
    if (!ok) return;
    // v1.12.1 fix — the previous loop combined el.resize() with a manual
    // view.update() and an extra change:size trigger. JointJS v4 async
    // paper coalesces same-microtask resizes, so only one peer ended up
    // visibly resized even though every peer model fired its event.
    // Atomic prop('size', ...) commits both dimensions in one set() call
    // and fires exactly one change:size that the view picks up on its
    // own. updateViews() at the end flushes the queued visual updates
    // as a single render.
    history.startBatch();
    try {
      peers.forEach(el => {
        el.prop('size', { width, height });
      });
    } finally {
      history.endBatch();
    }
    paper.updateViews();
    showToast(`Resized ${peers.length} ${peers.length === 1 ? typePlural.toLowerCase().replace(/s$/, '') : typePlural.toLowerCase()} ✓`, 'success');
  });
  parent.appendChild(btn);
}

function addNumberWithSuffix(parent, label, value, suffix, onChange) {
  const f = field(parent, label);
  const row = document.createElement('div');
  row.className = 'df-prop-input-with-suffix';
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'df-properties__input';
  input.value = value ?? 0;
  input.min = 1;
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (!isNaN(v) && v > 0) onChange(v);
  });
  const span = document.createElement('span');
  span.className = 'df-properties__input-suffix';
  span.textContent = suffix;
  row.appendChild(input);
  row.appendChild(span);
  f.appendChild(row);
}

function renderTimelineTaskEditor(parent, cell) {
  const listEl = document.createElement('div');
  listEl.className = 'df-timeline-task-list';

  // Drag state
  let dragIdx = null;

  function rebuild() {
    listEl.innerHTML = '';
    const currentTasks = cell.get('tasks') || [];

    currentTasks.forEach((task, i) => {
      const row = document.createElement('div');
      const isTask = task.type !== 'group';
      row.className = 'df-timeline-task-row'
        + (isTask ? ' df-timeline-task-row--task' : '')
        + (!isTask ? ' df-timeline-task-row--group' : '');
      row.dataset.index = i;

      // Drag handle
      const dragHandle = document.createElement('span');
      dragHandle.className = 'df-timeline-task-drag';
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
        listEl.querySelectorAll('.df-timeline-task-row--drag-over').forEach(r => r.classList.remove('df-timeline-task-row--drag-over'));
      });
      row.appendChild(dragHandle);

      // Drop target on the row itself
      row.addEventListener('dragover', (evt) => {
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'move';
        row.classList.add('df-timeline-task-row--drag-over');
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('df-timeline-task-row--drag-over');
      });
      row.addEventListener('drop', (evt) => {
        evt.preventDefault();
        row.classList.remove('df-timeline-task-row--drag-over');
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
      colorBtn.className = 'df-timeline-task-color';
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
      labelInput.className = 'df-properties__input df-timeline-task-label';
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
      delBtn.className = 'df-field-delete';
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
    btnRow.className = 'df-timeline-task-actions';

    const addGroupBtn = document.createElement('button');
    addGroupBtn.className = 'df-properties__btn df-properties__btn--add-field';
    addGroupBtn.textContent = '+ Group';
    addGroupBtn.addEventListener('click', () => {
      const updated = [...cell.get('tasks')];
      const id = 'g' + Date.now();
      updated.push({ id, type: 'group', label: 'New Group', color: '#5B5FC7' });
      cell.set('tasks', updated);
      rebuild();
    });

    const addTaskBtn = document.createElement('button');
    addTaskBtn.className = 'df-properties__btn df-properties__btn--add-field';
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

// Slide/switch toggle for boolean properties. `value` is a boolean; onChange
// fires with the new boolean. Styled via `.df-properties__toggle*` CSS.
function addToggle(parent, label, value, onChange) {
  const f = field(parent, label);
  const wrap = document.createElement('label');
  wrap.className = 'df-properties__toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'df-properties__toggle-input';
  input.checked = !!value;
  const track = document.createElement('span');
  track.className = 'df-properties__toggle-track';
  const thumb = document.createElement('span');
  thumb.className = 'df-properties__toggle-thumb';
  track.appendChild(thumb);
  wrap.appendChild(input);
  wrap.appendChild(track);
  input.addEventListener('change', () => onChange(input.checked));
  f.appendChild(wrap);
}

// Two-position segmented slider. Unlike addToggle (a plain on/off switch),
// this renders both options as labelled pill buttons inside a shared track,
// so each state has an explicit name (e.g. "Show" / "Hide"). `options` is
// `[{ value, label }, ...]`; `onChange` fires with the selected value when
// the user picks a different one.
function addSegmented(parent, label, value, options, onChange, opts = {}) {
  const f = field(parent, label);
  const wrap = document.createElement('div');
  wrap.className = 'df-properties__segmented';
  wrap.setAttribute('role', 'radiogroup');
  const buttons = [];
  const clearAll = () => buttons.forEach(b => {
    b.classList.remove('df-properties__segmented-option--active');
    b.setAttribute('aria-checked', 'false');
  });
  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'df-properties__segmented-option';
    btn.textContent = opt.label;
    btn.setAttribute('role', 'radio');
    const isActive = opt.value === value;
    btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    if (isActive) btn.classList.add('df-properties__segmented-option--active');
    btn.addEventListener('click', () => {
      if (btn.classList.contains('df-properties__segmented-option--active')) {
        // Re-clicking the active segment clears the choice — only where the control
        // models an optional value (allowDeselect); binary sliders stay no-op.
        if (!opts.allowDeselect) return;
        clearAll();
        onChange(opts.deselectValue ?? '');
        return;
      }
      clearAll();
      btn.classList.add('df-properties__segmented-option--active');
      btn.setAttribute('aria-checked', 'true');
      onChange(opt.value);
    });
    buttons.push(btn);
    wrap.appendChild(btn);
  });
  f.appendChild(wrap);
}

function addSelect(parent, label, value, options, onChange) {
  // Discrete control: one `change` per action. Batch onChange so a type switch that
  // also repaints multiple attrs (e.g. BpmnEvent / Gateway / SequenceFragment) is ONE
  // undo step — the type prop + every attr land together.
  onChange = asUndoBatch(onChange);
  const f = field(parent, label);
  const sel = document.createElement('select');
  sel.className = 'df-properties__select';
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


function addMarkerPicker(parent, label, current, options, svgs, onChange, opts = {}) {
  const f = field(parent, label);
  const wrap = document.createElement('div');
  wrap.className = 'df-marker-picker';
  // Gap 11 (v1.12.0) — when the caller passes the active line stroke, paint
  // the thumbnail SVGs in that colour by setting the wrapper's `color`
  // CSS property. The thumbs already use `currentColor` for stroke/fill,
  // so they inherit automatically. When omitted, fallback to the prior
  // currentColor (theme text colour).
  if (opts.strokeColor) wrap.style.color = opts.strokeColor;

  // Current selected display
  const btn = document.createElement('button');
  btn.className = 'df-marker-picker__btn';
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
  list.className = 'df-marker-picker__list';
  list.style.display = 'none';
  options.forEach(opt => {
    const item = document.createElement('button');
    item.className = 'df-marker-picker__item';
    if (opt.value === current) item.classList.add('df-marker-picker__item--active');
    const svg = svgs[opt.value] || '';
    item.innerHTML = svg
      ? `<svg width="32" height="18" viewBox="0 0 36 18">${svg}</svg><span>${opt.label}</span>`
      : `<span>${opt.label}</span>`;
    item.addEventListener('click', () => {
      list.querySelectorAll('.df-marker-picker__item--active').forEach(el => el.classList.remove('df-marker-picker__item--active'));
      item.classList.add('df-marker-picker__item--active');
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
  // Discrete control: batch onChange so the icon href + any layout attr writes the
  // caller makes (e.g. updateSimpleNodeLayout / updateDataObjectHeaderLayout) collapse
  // into ONE undo step — for the Node, Container, and DataObject header icon pickers.
  onChange = asUndoBatch(onChange);
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
  inputRow.className = 'df-prop-icon-preview';
  inputRow.style.cursor = 'text';

  const swatch = document.createElement('div');
  swatch.className = 'df-prop-icon-swatch';

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'df-prop-icon-search-input';
  search.placeholder = 'Search icons\u2026';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'df-prop-icon-clear';
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
      const safeIconId = icon.id.replace(/[^a-zA-Z0-9_-]/g, '');
      item.innerHTML = `<svg width="28" height="28" fill="var(--text-primary)"><use href="#${safeIconId}"></use></svg>`;
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

/**
 * After replacing `oldCell` with `newCell`, re-embed `newCell` in the same
 * parent IF the embedding rules allow it (e.g. a SimpleNode → Container
 * conversion stays embedded when the parent is a Zone, but not when the
 * parent is another Container). Call AFTER `graph.addCell(newCell)` but
 * BEFORE `oldCell.remove()` so the parent's `embeds` array is consistent
 * throughout. Silent no-op when there's no parent or canEmbed says no.
 */
function preserveParentEmbedding(oldCell, newCell) {
  const parentId = oldCell.get('parent');
  if (!parentId) return;
  const parent = graph.getCell(parentId);
  if (!parent) return;
  if (!canEmbed(parent.get('type'), newCell.get('type'))) return;
  // Suppress change:parent recording — the conversion's add(newCell) command already
  // captures the embedded state in its JSON (re-captured on undo with `parent`), so the
  // embed round-trips via the add/remove pair without a separate command.
  history.suppressEmbedTracking(() => parent.embed(newCell));
}

export function convertToContainer(cell) {
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
  history.startBatch();   // add + reconnect + remove = ONE undo step
  try {
    graph.addCell(container);
    preserveParentEmbedding(cell, container);
    reconnectLinks(connections, container.id);
    cell.remove();
    selection.selectOnly(container.id);
  } finally { history.endBatch(); }
}

export function convertToNode(cell) {
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
  history.startBatch();   // add + layout + reconnect + remove = ONE undo step
  try {
    graph.addCell(node);
    updateSimpleNodeLayout(node);
    preserveParentEmbedding(cell, node);
    reconnectLinks(connections, node.id);
    cell.remove();
    selection.selectOnly(node.id);
  } finally { history.endBatch(); }
}

export function convertToIcon(cell) {
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
  history.startBatch();   // add + reconnect + remove = ONE undo step (depth-safe if a convert-all batch is already open)
  try {
    graph.addCell(node);
    preserveParentEmbedding(cell, node);
    reconnectLinks(connections, node.id);
    cell.remove();
    selection.selectOnly(node.id);
  } finally { history.endBatch(); }
}

export function convertContainerToIcon(cell) {
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
  history.startBatch();   // add + reconnect + remove = ONE undo step (depth-safe if a convert-all batch is already open)
  try {
    graph.addCell(node);
    preserveParentEmbedding(cell, node);
    reconnectLinks(connections, node.id);
    cell.remove();
    selection.selectOnly(node.id);
  } finally { history.endBatch(); }
}

export function convertFromIcon(cell) {
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
  history.startBatch();   // add + reconnect + remove = ONE undo step (depth-safe if a convert-all batch is already open)
  try {
    graph.addCell(node);
    preserveParentEmbedding(cell, node);
    reconnectLinks(connections, node.id);
    cell.remove();
    selection.selectOnly(node.id);
  } finally { history.endBatch(); }
}

// ── Utility ─────────────────────────────────────────────────────────

function toHex(color) {
  if (!color) return '#000000';
  if (typeof color === 'string') color = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const [, r, g, b] = color.match(/^#(.)(.)(.)/);
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  // Accept hex without leading `#` (common when copy-pasting from design tools)
  if (/^[0-9a-f]{6}$/i.test(color)) return `#${color}`;
  if (/^[0-9a-f]{3}$/i.test(color)) {
    const [, r, g, b] = color.match(/^(.)(.)(.)/);
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  // CSS variable, rgb()/rgba(), named color — resolve via canvas. Canvas returns a
  // #rrggbb for opaque colours but an `rgba(r, g, b, a)` string when alpha < 1 — pull
  // the channels and drop alpha rather than falling through to #000000 (which made a
  // translucent fill, e.g. a Zone/Layer tint, read as black in the picker).
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = color;
    const resolved = ctx.fillStyle;
    if (/^#[0-9a-f]{6}$/i.test(resolved)) return resolved;
    const m = resolved.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) {
      const h = n => Math.max(0, Math.min(255, +n)).toString(16).padStart(2, '0');
      return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
    }
    return '#000000';
  } catch {
    return '#000000';
  }
}

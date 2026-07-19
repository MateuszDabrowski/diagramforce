// Properties panel — left sidebar element inspector
// Properties are grouped into collapsible accordion sections

import { wrapSelectionWithMarker } from './markdown.js?v=1.20.0.63';
import { ER_MARKER_D } from './er-markers.js?v=1.20.0.63';
import { cycleKeyType, keyImpliesRequired, keyTypeLabel, applyKeyType, newField } from './field-model.js?v=1.20.0.63';
import { COLOR_SCHEMA, recolorCellIcon } from './properties/color-schema.js?v=1.20.0.63';
import { wirePrctx, asUndoBatch } from './properties/context.js?v=1.20.0.63';
// Property-panel widget builders (CLEANUP S2 slice 3) — form fields, action buttons, pickers.
import {
  CLONE_ICON_SVG, addActionBtn, addApplySizeBtn, addAutoSizeBtn, addChipInput, addCloneBtn,
  addColor, addColorMulti, addConvertBtn, addDate, addDeleteBtn, addIconPicker,
  addMarkerPicker, addNumber, addNumberPair, addNumberWithSuffix, addOrderButtons, addRaciPicker,
  addRotationField, addSegmented, addSelect, addText, addTextarea, addToggle,
  bringToFront, cloneCellPlain, copyCellStyle, field, getActiveCell, hasStyleClip,
  pasteCellStyle, rotationField, section, sendToBack, toHex, wireMarkdownShortcuts,
} from './properties/widgets.js?v=1.20.0.63';
// Re-export the style-clipboard trio for app.js (selection.setStyleApi) — they live in widgets.js now.
export { copyCellStyle, hasStyleClip, pasteCellStyle } from './properties/widgets.js?v=1.20.0.63';
// DataObject field editor (CLEANUP S2 slice 4) — renderDataObjectProps + the dblclick handler call these back.
import { renderFieldEditor, openFieldEditorModal, makeFieldCheckToggle } from './properties/field-editor.js?v=1.20.0.63';
// SF_FIELD_TYPES lives in field-editor.js now; table-view.js still imports it from properties.js (this re-export).
export { SF_FIELD_TYPES } from './properties/field-editor.js?v=1.20.0.63';
// Link / connector panel (CLEANUP S2 slice 5) — the facade dispatch (showProperties) + the multi-select
// Connectors section use these; setLinkEndpoints is reached via properties.setLinkEndpoints (app.js), so re-export.
import { renderLinkProps, renderMappingControls, LINK_LINE_STYLE_OPTS, applyLinkStroke, applyLinkStrokeWidth, applyLinkLineStyle,
  applyLinkFontColor, applyLinkFontSize, LINK_MARKER_OPTS, LINK_MARKER_SVGS, buildLinkMarkerDefs, detectLinkMarker, applyLinkMarker } from './properties/link-props.js?v=1.20.0.63';
export { setLinkEndpoints } from './properties/link-props.js?v=1.20.0.63';
// Shape type metadata (CLEANUP S2 slice 6) — pure data maps shared by the facade + renderers + convert + autoSizeCell.
import { TYPE_LABELS, DEFAULT_SIZES } from './properties/type-meta.js?v=1.20.0.63';
// Shape-type conversion (CLEANUP S2 slice 6) — the renderers' Convert buttons + the right-click convert menu (via
// buildCellActions) call these; each rewires a cell in place preserving links + embedding.
import { convertToContainer, convertToNode, convertToIcon, convertContainerToIcon, convertFromIcon } from './properties/convert.js?v=1.20.0.63';
// Shared render tail (CLEANUP S2 slice 7) — every render*Props ends with finishStandardProps; autoSizeCell +
// buildCellActions are wired into selection via app.js (properties.autoSizeCell / .buildCellActions), so re-export.
import { finishStandardProps, autoSizeCell, buildCellActions } from './properties/render-core.js?v=1.20.0.63';
export { autoSizeCell, buildCellActions } from './properties/render-core.js?v=1.20.0.63';
// Per-family property renderers (CLEANUP S2 slice 8+) — the showProperties() dispatch calls these back.
import { renderSequenceParticipantProps, renderSequenceActorProps, renderSequenceActivationProps, renderSequenceFragmentProps } from './properties/renderers-sequence.js?v=1.20.0.63';
import { renderOrgPersonProps, renderTaskProps } from './properties/renderers-org.js?v=1.20.0.63';
import { renderGanttTaskProps, renderGanttMilestoneProps, renderGanttMarkerProps, renderGanttTimelineProps, renderGanttGroupProps } from './properties/renderers-gantt.js?v=1.20.0.63';
import { renderBpmnEventProps, renderBpmnTaskProps, renderBpmnGatewayProps, renderBpmnSubprocessProps, renderBpmnLoopProps, renderBpmnPoolProps, renderBpmnDataObjectProps, renderFlowShapeProps } from './properties/renderers-process.js?v=1.20.0.63';
import { renderFlowElementProps } from './properties/renderers-flow.js?v=1.20.0.63';
import { renderSimpleNodeProps, renderContainerProps, renderTextLabelProps, renderPillProps, renderLegendProps, renderTableProps, renderLineProps, renderLinkElementProps, renderNoteProps, renderImageProps, renderZoneProps, renderTaskGroupProps, renderDataObjectProps, renderAnnotationProps } from './properties/renderers-core.js?v=1.20.0.63';
import { triggerDownload } from './persistence.js?v=1.20.0.63';
import { confirmModal, showToast, buildModal } from './feedback.js?v=1.20.0.63';
import { getAllIcons, getIconDataUri } from './icons.js?v=1.20.0.63';
import { Z_BASE, Z_TIER_SPAN, tierNameForType, updateSimpleNodeLayout, updateDataObjectHeaderLayout, updateContainerHeaderLayout, updateNoteIconLayout, syncMobilePanelHeight, canEmbed, applyMappingLinkStyle, applyRelationshipLinkStyle, syncMappingTypeBadge, syncFrequencyLabel } from './canvas.js?v=1.20.0.63';
import * as stencilModule from './stencil.js?v=1.20.0.63';
import { getPalette, addToPalette, removeFromPalette, onPaletteChange, PALETTE_MAX_SLOTS } from './brand-palette.js?v=1.20.0.63';
import { resizeDataObjectToFit, contrastTextColor, getStencilSvgDataUri, SVG as COMPONENT_SVG, extractLinkDomain } from './components.js?v=1.20.0.63';
import {
  duplicate as clipboardDuplicate,
  copy as clipboardCopy,
  cloneElementWithConnectors,
  countConnectors,
  countConnectedConnectors,
  cloneSelectionWithMode,
  countExternalConnectors,
  countExternalConnectedConnectors,
} from './clipboard.js?v=1.20.0.63';
import * as history from './history.js?v=1.20.0.63';
import { startImageAddFlow } from './image-component.js?v=1.20.0.63';
import { escHtml, sanitizeFilenamePart, sanitizeCssColor } from './util.js?v=1.20.0.63';
import { getActiveTabName } from './tabs.js?v=1.20.0.63';
import { saveSelectionAsTemplate, saveCellAsShape } from './templates.js?v=1.20.0.63';
import { newFid } from './shapes.js?v=1.20.0.63';
import { timelineBars, applyGanttGeometry, resequenceGanttOrders, orderToY, ganttRowLayout, ganttTimelineFor, applyGanttGroupGeometry } from './gantt-layout.js?v=1.20.0.63';



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

let graph, paper, selection;
let panelEl, typeBadgeEl, titleEl, bodyEl, footerEl;

// Data Cloud mapping mode — provided by tabs via app.js wiring. The DataObject
// property panel reveals its Data Cloud section only when this returns true, so
// the default Data Model panel is unchanged when mapping mode is off.
let mappingModeGetter = null;
export function setMappingModeGetter(fn) { mappingModeGetter = fn; }
function isMappingMode() { return !!(mappingModeGetter && mappingModeGetter()); }

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

  // Publish the same refs to the properties/ leaves (S2). The facade keeps its own module-scoped copies for its
  // own code; the leaves read prctx.* at call time.
  wirePrctx({ graph, paper, selection, panelEl, typeBadgeEl, titleEl, bodyEl, footerEl, refresh, showProperties, bindLiveGanttDates, openTableEditorModal, isMappingMode });

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
      clearActiveGanttDateListener();
      showMultiProperties(ids.length);
    } else {
      clearActiveSizeListener();
      clearActiveGanttDateListener();
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
    // df.Table cells are MARKDOWN, multi-line content (not a single label), so a double-click opens the staged
    // "Edit in Table" overlay rather than starting an inline label edit.
    if (cellView.model.get('type') === 'df.Table') { openTableEditorModal(cellView.model); return; }
    // sf.DataObject mirrors that gesture: an object's "content" is its field schema, so a double-click opens its
    // per-object "Edit in Table" field editor (openFieldEditorModal) instead of an inline header rename — exactly
    // like df.Table above, NOT the whole-diagram Table view. `refresh` re-renders the inspector after it closes.
    if (cellView.model.get('type') === 'sf.DataObject') { openFieldEditorModal(cellView.model, refresh); return; }
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

// ── Shape state (review / diff border) ─────────────────────────────────
// A fast way to mark elements during a review without hand-picking colours. Shown as a 4-stop
// slider — None / Added / Removed / Changed — that paints the element's `body` stroke:
//   Added   → a thicker GREEN  border (net-new element)
//   Removed → a RED dashed     border (removed element)
//   Changed → an ORANGE dotted border (changed element)
//   None restores the shape's own border (default behaviour).
// The pre-override stroke is stashed in `_origBorder` so None is lossless (it restores whatever the
// border was, including user customisations). The choice persists as the top-level `borderStyle`
// prop — the prop KEY is kept stable across the "Highlight" → "Shape state" UI rename so older
// saves / share URLs keep working (do NOT rename `borderStyle` or `_origBorder`).
const SHAPE_STATE_STYLES = {
  bold:     { stroke: '#2E9E5B', strokeWidth: 3,   strokeDasharray: 'none'    },
  dotted:   { stroke: '#E8881A', strokeWidth: 2.5, strokeDasharray: '2 4'     },
  dashed:   { stroke: '#DA4E55', strokeWidth: 2.5, strokeDasharray: '7 4'     },
  deferred: { stroke: '#1D73C9', strokeWidth: 2.5, strokeDasharray: '7 4'      },
};
// Connector (link) variant of the SAME state palette — a link paints on `line`, and its dash is the top-level
// `lineStyle` prop, NEVER line/strokeDasharray (the Safari <marker> overlay owns that; see applyLinkLineStyle).
// lineStyle values: 'none' (solid) / '8 4' (dashed) / '2 4' (dotted). So a connector can be flagged Added/
// Changed/Removed/Deferred exactly like a shape, to highlight new / changed / removed / on-hold connections.
const LINK_STATE_STYLES = {
  bold:     { stroke: '#2E9E5B', strokeWidth: 3,   lineStyle: 'none' },  // Added    — green solid
  dotted:   { stroke: '#E8881A', strokeWidth: 2.5, lineStyle: '2 4'  },  // Changed  — orange dotted
  dashed:   { stroke: '#DA4E55', strokeWidth: 2.5, lineStyle: '8 4'  },  // Removed  — red dashed
  deferred: { stroke: '#1D73C9', strokeWidth: 2.5, lineStyle: '8 4'  },  // Deferred — blue dashed
};
// Row labels are the review SEMANTICS; the stored values stay the style keys (standard/bold/dotted/dashed/
// deferred) so the persisted `borderStyle` prop is unchanged. Order matches the review lifecycle the user asked
// for: None, Added, Changed, Removed, Deferred. `deferred` (violet dash-dot = on hold) joined in v1.17.3.
const SHAPE_STATE_OPTS = [
  { value: 'standard', label: 'None' },
  { value: 'bold',     label: 'Added' },
  { value: 'dotted',   label: 'Changed' },
  { value: 'dashed',   label: 'Removed' },
  { value: 'deferred', label: 'Deferred' },
];

// Most shapes paint the Shape-state border on `body`. df.Legend's `body` is a transparent full-bounds selection
// frame, so its Shape-state belongs on the visible `swatch` squircle instead — keyed here.
const SHAPE_STATE_TARGET = { 'df.Legend': 'swatch' };
// Links paint their state on `line`; shapes on `body` (or a per-type target). Drives both the target selector
// and the "does this cell support a state?" test in the panels.
const shapeStateSel = (cell) => cell.isLink?.() ? 'line' : (SHAPE_STATE_TARGET[cell.get('type')] || 'body');

// Exported so Change Review's "Apply as Highlight states" can bake a diff into real borderStyle props.
export function applyShapeState(cell, style) {
  if (cell.isLink?.()) { applyLinkState(cell, style); return; }
  const sel = shapeStateSel(cell);
  const prev = cell.get('borderStyle') || 'standard';
  if (style === prev) return;
  if (style === 'standard') {
    const orig = cell.get('_origBorder');
    if (orig) {
      cell.attr(`${sel}/stroke`, orig.stroke ?? null);
      cell.attr(`${sel}/strokeWidth`, orig.strokeWidth ?? null);
      cell.attr(`${sel}/strokeDasharray`, orig.strokeDasharray ?? null);
    }
    cell.set('borderStyle', null);
    cell.set('_origBorder', null);
    return;
  }
  // First override away from None: remember the shape's own stroke so None can restore it.
  if (prev === 'standard' || !cell.get('_origBorder')) {
    cell.set('_origBorder', {
      stroke: cell.attr(`${sel}/stroke`) ?? null,
      strokeWidth: cell.attr(`${sel}/strokeWidth`) ?? null,
      strokeDasharray: cell.attr(`${sel}/strokeDasharray`) ?? null,
    });
  }
  const s = SHAPE_STATE_STYLES[style];
  cell.set('borderStyle', style);
  cell.attr(`${sel}/stroke`, s.stroke);
  cell.attr(`${sel}/strokeWidth`, s.strokeWidth);
  cell.attr(`${sel}/strokeDasharray`, s.strokeDasharray);
}

// Connector Highlight State — mirrors applyShapeState, but drives the link's OWN styling setters (applyLinkStroke/
// StrokeWidth/LineStyle) so it cooperates with the lineStyle overlay + Safari <marker> re-insert instead of being
// wiped by them. Reuses the SAME `borderStyle` + `_origBorder` props (save/share/undo unchanged); on a link,
// `_origBorder` carries {stroke, strokeWidth, lineStyle}, restored losslessly on None.
function applyLinkState(cell, style) {
  const prev = cell.get('borderStyle') || 'standard';
  if (style === prev) return;
  if (style === 'standard') {
    const orig = cell.get('_origBorder');
    if (orig) {
      applyLinkStroke(cell, orig.stroke ?? '#888888');
      applyLinkStrokeWidth(cell, orig.strokeWidth ?? 2);
      applyLinkLineStyle(cell, orig.lineStyle ?? 'none');
    }
    cell.set('borderStyle', null);
    cell.set('_origBorder', null);
    return;
  }
  // First override away from None: remember the connector's own stroke/width/dash so None restores it losslessly.
  if (prev === 'standard' || !cell.get('_origBorder')) {
    cell.set('_origBorder', {
      stroke: cell.attr('line/stroke') ?? '#888888',
      strokeWidth: cell.attr('line/strokeWidth') ?? 2,
      lineStyle: cell.prop('lineStyle') ?? 'none',
    });
  }
  const s = LINK_STATE_STYLES[style];
  cell.set('borderStyle', style);
  applyLinkStroke(cell, s.stroke);
  applyLinkStrokeWidth(cell, s.strokeWidth);
  applyLinkLineStyle(cell, s.lineStyle);
}

// Build the five-state vertical list (None / Added / Changed / Removed / Deferred) into `body`: each row is the
// state's OWN border drawn directly on the checkbox (an SVG box stroked in the state's colour + dash, so the box
// IS the preview), beside its label. Single-select; selecting fills the box + shows the tick. `current` is the
// active state key; `onPick(value)` applies it. Shared by the single-element + multi-select panels.
function buildShapeStateList(body, current, onPick) {
  const list = document.createElement('div');
  list.className = 'df-shapestate';
  SHAPE_STATE_OPTS.forEach((opt) => {
    const s = SHAPE_STATE_STYLES[opt.value];   // undefined for None
    const stroke = s ? s.stroke : 'var(--text-muted)';
    const width = s ? s.strokeWidth : 1.5;
    const dash = s ? s.strokeDasharray : 'none';
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'df-shapestate__row' + (opt.value === current ? ' is-selected' : '');
    row.dataset.value = opt.value;
    row.setAttribute('role', 'checkbox');
    row.setAttribute('aria-checked', String(opt.value === current));
    row.style.setProperty('--df-shapestate-color', stroke);
    // The CSS border-style that matches this state's dash, for the SELECTED row's full-width border (the effect
    // moves off the checkbox onto the whole row on check). dash-dot has no CSS equivalent → `dashed`.
    row.style.setProperty('--df-shapestate-border-style', !s || dash === 'none' ? 'solid' : (dash === '2 4' ? 'dotted' : 'dashed'));
    // The checkbox border IS the example visual (when UNSELECTED): an SVG box stroked in the state's own colour +
    // dash pattern. On select, the box goes solid-filled with a tick and the dash effect moves to the whole row.
    row.innerHTML = `<span class="df-shapestate__check" aria-hidden="true">`
      + `<svg viewBox="0 0 20 20" width="20" height="20">`
      + `<rect class="df-shapestate__box" x="2.5" y="2.5" width="15" height="15" rx="4" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-dasharray="${dash}"/>`
      + `<path class="df-shapestate__tick" d="M6 10.5 L9 13.5 L14.5 7" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
      + `</svg></span>`
      + `<span class="df-shapestate__label">${opt.label}</span>`;
    row.addEventListener('click', () => {
      onPick(opt.value);
      list.querySelectorAll('.df-shapestate__row').forEach((r) => {
        const sel = r.dataset.value === opt.value;
        r.classList.toggle('is-selected', sel);
        r.setAttribute('aria-checked', String(sel));
      });
    });
    list.appendChild(row);
  });
  body.appendChild(list);
}

// Slot the Shape State `wrap` above the styling section (it's a structural/review attribute, so it reads above
// pure styling). Inserts before the FIRST styling section — "Appearance" (shapes / single connector / mixed) OR
// "Connectors" (a pure-link multi-select, whose styling section is named "Connectors", not "Appearance"). Without
// matching "Connectors" the section stayed appended BELOW it on a multi-connector panel while sitting ABOVE on a
// single connector — the reported inconsistency. Otherwise leaves it in place.
function placeShapeStateSection(wrap) {
  if (!wrap || wrap.parentElement !== bodyEl) return;
  // Slot it before the first styling/detail section so it reads right after Content on EVERY type: "Appearance"
  // (shapes / connector) or "Connectors" (multi-link) — and for flow elements, which have neither, "Flow Details"
  // (or "Size & Order" when the element has no details). Without the flow targets it stayed pinned to the bottom.
  const target = [...bodyEl.querySelectorAll('.df-section')].find(sec =>
    /^(Appearance|Connectors|Flow Details|Size & Order)$/i.test(sec.querySelector('.df-section__header span')?.textContent?.trim() || ''));
  if (target && target !== wrap) bodyEl.insertBefore(wrap, target);
}

// Whether the Highlight State section is expanded — remembered across re-renders so a state change (which
// re-renders the panel to refresh the Border colour control) keeps the section as the user left it.
let shapeStateOpen = false;

// Shared Shape-state control — its OWN collapsible section, COLLAPSED by default (it's a review/diff aid, not
// everyday styling), holding the five states stacked as styled checkbox rows. Shown for any cell with a paintable
// state target: a shape's `body` outline (boxes, pills, legends) OR a connector's `line` (v1.19.3.11). Body-less
// shapes are skipped.
function maybeAddShapeStateControl(cell) {
  if (cell.attr(shapeStateSel(cell)) === undefined) return;
  const body = section(bodyEl, 'Highlight State', shapeStateOpen);
  // Track expand/collapse (the section() header handler toggles the class before this fires).
  body.parentElement.querySelector('.df-section__header')?.addEventListener('click', () => {
    shapeStateOpen = !body.parentElement.classList.contains('df-section--collapsed');
  });
  buildShapeStateList(body, cell.get('borderStyle') || 'standard', asUndoBatch((v) => {
    applyShapeState(cell, v);
    showProperties(cell);   // re-render so the Border colour control (and swatches) reflect the new stroke (issue 2)
  }));
  placeShapeStateSection(body.parentElement);   // move between Content and Appearance
}

function showProperties(cell) {
  const wasHidden = panelEl.classList.contains('df-properties--hidden');
  panelEl.classList.remove('df-properties--hidden');
  if (wasHidden) hideStencilForProperties();
  syncMobilePanelHeight(panelEl);
  bodyEl.innerHTML = '';
  footerEl.innerHTML = '';
  clearActiveGanttDateListener();   // a prior gantt task's date binding (re-set below if this is a gantt task)

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
  else if (type?.startsWith('df.Flow')) renderFlowElementProps(cell);
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
  else if (type === 'df.Pill')     renderPillProps(cell);
  else if (type === 'df.Legend')   renderLegendProps(cell);
  else if (type === 'df.Table')    renderTableProps(cell);
  else if (type === 'sf.Link')     renderLinkElementProps(cell);
  else if (type === 'sf.Image')    renderImageProps(cell);
  else if (cell.isLink())            renderLinkProps(cell);

  // Shared Shape-state slider — appended as the last control of the Content (first) section, for every
  // element with a body outline (None / Added / Removed / Changed = the review/diff overlay).
  maybeAddShapeStateControl(cell);

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

// Round H item 1: keep the Gantt Schedule (Start/End Date) fields in sync with the model when the dates change from
// OUTSIDE the panel - a drag or resize commits new dates on mouse-up, so the open inspector must reflect them rather
// than showing the pre-drag value. A change:startDate/endDate listener fires once per interaction (the drag sets the
// dates on pointerup, not per move), so this updates exactly when the user stops.
let activeGanttDateListener = null;
function clearActiveGanttDateListener() {
  if (!activeGanttDateListener) return;
  const { cell, events, fn } = activeGanttDateListener;
  try { cell.off(events, fn); } catch {}
  activeGanttDateListener = null;
}
// `bindings` = [{ prop, handle }] — each handle's field reflects cell.get(prop) when that prop changes elsewhere.
function bindLiveGanttDates(cell, bindings) {
  clearActiveGanttDateListener();
  const events = bindings.map(b => `change:${b.prop}`).join(' ');
  const fn = () => bindings.forEach(b => b.handle.set(cell.get(b.prop) || ''));
  cell.on(events, fn);
  activeGanttDateListener = { cell, events, fn };
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
      // Same renderer as the single-link panel — here with the N selected links (shared/mixed values + batching).
      renderMappingControls(section(bodyEl, 'Mapping'), links, { onStructureChange: rerenderMulti });
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
    }, { mixed: !sameStyle });
    const widths = links.map(l => l.attr('line/strokeWidth') ?? 2);
    const sameWidth = widths.every(w => w === widths[0]);
    addNumber(sec, 'Line width', sameWidth ? widths[0] : '', v => {
      history.startBatch();
      try { links.forEach(l => applyLinkStrokeWidth(l, v)); } finally { history.endBatch(); }
    }, { placeholder: sameWidth ? undefined : 'Mixed' });

    // ── Bulk parity with the single-connector Appearance panel (v1.19.4.1): the fields that make sense to
    // mass-change — Label colour, Font size, and BOTH endpoint markers (bulk arrowheads) — plus Reverse / Simplify
    // as batch actions. Per-connector-UNIQUE fields (Label text, Frequency) are deliberately excluded. Each control
    // applies to every selected link in ONE undo step; markers rebuild per-cell so each keeps its own stroke.
    const fontColors = links.map(l => l.prop('fontColor') || l.attr('line/stroke') || '#888888');
    addColorMulti(sec, 'Label color', fontColors.every(c => c === fontColors[0]) ? fontColors[0] : null, v => {
      history.startBatch();
      try { links.forEach(l => applyLinkFontColor(l, v)); } finally { history.endBatch(); }
    });
    const sizes = links.map(l => l.labels()?.[0]?.attrs?.text?.fontSize ?? 13);
    const sameSize = sizes.every(s => s === sizes[0]);
    addNumber(sec, 'Font size', sameSize ? sizes[0] : '', v => {
      history.startBatch();
      try { links.forEach(l => applyLinkFontSize(l, v)); } finally { history.endBatch(); }
    }, { min: 8, max: 24, placeholder: sameSize ? undefined : 'Mixed' });
    const repStroke = links[0].attr('line/stroke') || '#888888';
    const bulkMarker = (side, key) => {
      const marks = links.map(l => detectLinkMarker(l.attr(`line/${key}`)));
      addMarkerPicker(sec, side, marks.every(m => m === marks[0]) ? marks[0] : null, LINK_MARKER_OPTS, LINK_MARKER_SVGS, v => {
        history.startBatch();
        try {
          links.forEach(l => applyLinkMarker(l, key,
            buildLinkMarkerDefs(l.attr('line/stroke') || '#333333', l.attr('line/strokeWidth') ?? 2)[v]));
        } finally { history.endBatch(); }
      }, { strokeColor: repStroke });
    };
    bulkMarker('Source end', 'sourceMarker');
    bulkMarker('Target end', 'targetMarker');

    // Reverse direction (swap endpoints) + Simplify path (clear vertices + round) — batch versions of the single
    // panel's foot buttons; each is one undo step across the whole selection.
    const bulkBtn = (label, svg, onClick) => {
      const b = document.createElement('button');
      b.className = 'df-properties__btn df-properties__btn--auto-size';
      b.style.marginTop = '6px';
      b.innerHTML = `${svg} ${label}`;
      b.addEventListener('click', () => { history.startBatch(); try { onClick(); } finally { history.endBatch(); } });
      sec.appendChild(b);
    };
    bulkBtn('Reverse direction',
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 5 L13 5 M10 2 L13 5 L10 8" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 11 L3 11 M6 8 L3 11 L6 14" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      () => links.forEach(l => { const s = l.get('source'), t = l.get('target'); l.set({ source: t, target: s }); }));
    bulkBtn('Simplify path',
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 13 L14 3" stroke-linecap="round"/><circle cx="2" cy="13" r="1.5" fill="currentColor" stroke="none"/><circle cx="14" cy="3" r="1.5" fill="currentColor" stroke="none"/></svg>',
      () => links.forEach(l => { l.vertices([]); l.connector('rounded', { radius: 8 }); }));
  };

  // Highlight State — the shared 5-state list applied to every selected shape (body) AND connector (line) in one
  // undo step. A local so BOTH the pure-connector branch and the element/mixed path below can place it; without
  // this a pure-link multi-select (which returns early) never showed the section.
  const addMultiHighlightState = () => {
    const hlCells = cells.filter(c => c.attr(shapeStateSel(c)) !== undefined);
    if (hlCells.length === 0) return;
    const hlVals = hlCells.map(c => c.get('borderStyle') || 'standard');
    const sameHl = hlVals.every(s => s === hlVals[0]);
    const hlSec = section(bodyEl, 'Highlight State', false);
    buildShapeStateList(hlSec, sameHl ? hlVals[0] : 'standard', v => {
      history.startBatch();
      try { hlCells.forEach(c => applyShapeState(c, v)); } finally { history.endBatch(); }
    });
    placeShapeStateSection(hlSec.parentElement);
  };

  if (elements.length === 0) {
    // Pure-connector selection — the element-centric sections below don't apply.
    if (links.length === 0) {
      bodyEl.innerHTML = `<p class="df-properties__multi-msg">No editable cells selected.</p>`;
    } else {
      renderConnectorSection();
      addMultiHighlightState();   // connectors get Highlight State too
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

  // ── Rotation — every element supports an angle, so offer a shared rotation. Shows the shared
  // angle (or 0 when mixed); setting applies to all selected elements in one undo step.
  const angles = elements.map(c => c.angle());
  const sameAngle = angles.every(a => a === angles[0]);
  rotationField(sizeSec, 'Rotation', () => sameAngle ? angles[0] : 0, v => {
    history.startBatch();
    try { elements.forEach(c => c.rotate(v, true)); } finally { history.endBatch(); }
  });

  // ── Font size — shared across every selected element that carries a label font size (text-bearing
  // shapes); shapes without one are unaffected. Blank = mixed sizes; type to set all.
  const fsCells = elements.filter(c => c.attr('label/fontSize') != null);
  if (fsCells.length > 0) {
    const fontSizes = fsCells.map(c => parseFloat(c.attr('label/fontSize')) || 13);
    const sameFS = fontSizes.every(s => s === fontSizes[0]);
    addNumber(sizeSec, 'Font size', sameFS ? fontSizes[0] : '', v => {
      history.startBatch();
      try { fsCells.forEach(c => c.attr('label/fontSize', v)); } finally { history.endBatch(); }
    }, { min: 6, max: 96 });
  }

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

  // ── Highlight state — shape (body) + connector (line), applied to the whole selection in one undo step
  // (mark a batch Added / Changed / Removed / Deferred). Same helper the pure-connector branch above uses.
  addMultiHighlightState();

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

  // Auto-size button — route through the SHARED sizer so it stays in sync with the single-select path
  // (which content-fits DataObject / Note / df.Table / df.Legend instead of forcing DEFAULT_SIZES).
  addAutoSizeBtn(actionSec, () => { elements.forEach(c => autoSizeCell(c)); });

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

function openTableEditorModal(cell) {
  const staleModal = document.getElementById('table-editor-modal');
  if (staleModal?.__dfClose) staleModal.__dfClose(); else staleModal?.remove();

  const getRows = () => (cell.get('rows') || []).map(r => [...r]);
  const snap = () => ({
    rows: getRows(),
    highlightFirstRow: !!cell.get('highlightFirstRow'),
    highlightFirstCol: !!cell.get('highlightFirstCol'),
    size: { ...cell.size() },
  });
  const applyState = (s) => {
    cell.set({ rows: s.rows.map(r => [...r]), highlightFirstRow: s.highlightFirstRow, highlightFirstCol: s.highlightFirstCol });
    cell.resize(s.size.width, s.size.height);
  };
  const before = snap();
  // SUPPRESS recording so the live preview edits never hit the undo stack (setLocked only blocks playback, NOT
  // recording — relying on it alone double-records). Also lock so a stray Cmd+Z mid-edit can't pop a prior entry.
  history.setSuppressed(true);
  history.setLocked(true);

  let saved = false, ended = false;
  function endSession() {
    if (ended) return; ended = true;
    let after = null;
    try {
      if (saved) after = snap();
      else applyState(before);              // revert the live edits (still suppressed → unrecorded)
      history.flushPendingDragCommit();     // while suppressed, the "commit" is a no-op that just DROPS the pending merge
    } finally {
      history.setSuppressed(false);         // always re-enable recording, even if snap/revert threw …
      history.setLocked(false);             // … so the app can never get stuck unable to undo
    }
    // ONE undo entry for the whole session (recorded only now that suppression is off).
    if (saved && after && JSON.stringify(before) !== JSON.stringify(after)) {
      history.recordCommand(() => applyState(before), () => applyState(after));
    }
  }

  const { overlay, body: modalBody, close } = buildModal({
    title: 'Edit Table',
    dialogClass: 'df-field-modal__dialog df-table-modal__dialog',
    bodyClass: 'df-field-modal__body',
    footerClass: 'df-table-modal__footer',
    closeClass: 'df-field-modal__close',
    closeHtml: '✕',
    footerHtml: '<button class="df-modal__btn df-table-modal__cancel">Cancel</button>'
              + '<button class="df-modal__btn df-modal__btn--primary df-table-modal__save">Save</button>',
    onClose: endSession,   // fires once on teardown (✕ / Escape / backdrop / either button) → commit-or-revert
  });
  overlay.id = 'table-editor-modal';
  overlay.querySelector('.df-table-modal__save')?.addEventListener('click', () => { saved = true; close(); });
  overlay.querySelector('.df-table-modal__cancel')?.addEventListener('click', () => { saved = false; close(); });

  const commit = (rows, newWidth) => {   // structural change (add/remove row/col) → resize + rebuild
    if (newWidth != null) cell.resize(Math.max(newWidth, 1), cell.size().height);
    cell.set('rows', rows);
    rebuild();
  };

  const delBtn = (title, onClick) => {
    const b = document.createElement('button');
    b.className = 'df-table-modal__del-btn'; b.type = 'button'; b.title = title; b.textContent = '×';
    b.addEventListener('click', onClick);
    return b;
  };
  const stripBtn = (text, cls, onClick) => {
    const b = document.createElement('button');
    b.className = 'df-table-modal__strip ' + cls; b.type = 'button'; b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  };
  const checkRow = (checked, label, onChange) => {
    const row = document.createElement('div');
    row.className = 'df-table-modal__check';
    const btn = makeFieldCheckToggle(checked, label, '', onChange);
    const span = document.createElement('span'); span.textContent = label;
    span.addEventListener('click', () => btn.click());
    row.appendChild(btn); row.appendChild(span);
    return row;
  };
  // Size every cell in a row to the TALLEST one — so a multi-line cell makes its whole row match (no short
  // siblings next to a tall cell), in BOTH the initial layout and live as the user types.
  const matchRowHeights = (ta) => {
    const grid = ta.closest('.df-table-modal__grid2');
    if (!grid) return;
    const gr = ta.style.gridRow;
    const group = [...grid.querySelectorAll('.df-table-modal__cell')].filter(t => t.style.gridRow === gr);
    group.forEach(t => { t.style.height = '0px'; t.style.height = Math.max(28, t.scrollHeight) + 'px'; });
    const max = Math.max(28, ...group.map(t => parseFloat(t.style.height) || 28));
    group.forEach(t => { t.style.height = max + 'px'; });
  };
  const cellEditor = (ri, ci, val, bold) => {
    const ta = document.createElement('textarea');
    ta.className = 'df-field-input df-table-modal__cell' + (bold ? ' is-bold' : '');
    ta.rows = 1; ta.value = val;
    ta.addEventListener('input', () => { const r = getRows(); (r[ri] = r[ri] || [])[ci] = ta.value; cell.set('rows', r); matchRowHeights(ta); });
    wireMarkdownShortcuts(ta, null);   // Cmd+B/I/E + Shift+X; the hint is shown once in the toolbar
    return ta;
  };

  function rebuild() {
    modalBody.innerHTML = '';
    const rows = getRows();
    const cols = Math.max(1, rows[0]?.length || 1);
    const hlRow = !!cell.get('highlightFirstRow');
    const hlCol = !!cell.get('highlightFirstCol');

    // Toolbar: Display-style highlight checkboxes + a markdown hint.
    const bar = document.createElement('div');
    bar.className = 'df-table-modal__bar';
    bar.appendChild(checkRow(hlRow, 'Highlight first row', (next) => { cell.set('highlightFirstRow', next); rebuild(); }));
    bar.appendChild(checkRow(hlCol, 'Highlight first column', (next) => { cell.set('highlightFirstCol', next); rebuild(); }));
    modalBody.appendChild(bar);
    const hint = document.createElement('div');
    hint.className = 'df-table-modal__hint';
    hint.innerHTML = 'Cells support <b>**bold**</b>, <i>*italic*</i>, ~~strike~~, <code>`code`</code> and multiple lines.';
    modalBody.appendChild(hint);

    // Grid: [row-× | data cols | +Col strip] × [col-× row | data rows | +Row strip].
    const grid = document.createElement('div');
    grid.className = 'df-table-modal__grid2';
    grid.style.gridTemplateColumns = `22px repeat(${cols}, minmax(88px, 1fr)) 34px`;
    const place = (el, gc, gr) => { el.style.gridColumn = String(gc); el.style.gridRow = String(gr); grid.appendChild(el); };

    // Top row: column-delete × above each column (confirmed).
    for (let c = 0; c < cols; c++) {
      const del = delBtn('Delete column', async () => {
        if (cols <= 1) return;
        const ok = await confirmModal({ title: 'Delete column?', message: 'The column and all of its cells will be removed.', okLabel: 'Delete column', tone: 'danger' });
        if (!ok) return;
        const r = getRows(); r.forEach(row => row.splice(c, 1));
        const newCols = Math.max(1, r[0]?.length || 1);
        const perCol = cell.size().width / cols;
        commit(r, Math.max(Math.round(cell.size().width - perCol), newCols * 48));
      });
      del.classList.add('df-table-modal__coldel');
      if (cols <= 1) del.disabled = true;
      place(del, c + 2, 1);
    }

    // Data rows: row-delete × on the LEFT + the markdown cells.
    rows.forEach((row, ri) => {
      const rdel = delBtn('Delete row', () => { if (rows.length <= 1) return; const r = getRows(); r.splice(ri, 1); commit(r); });
      rdel.classList.add('df-table-modal__rowdel');
      if (rows.length <= 1) rdel.disabled = true;
      place(rdel, 1, ri + 2);
      for (let ci = 0; ci < cols; ci++) {
        place(cellEditor(ri, ci, row[ci] ?? '', (hlRow && ri === 0) || (hlCol && ci === 0)), ci + 2, ri + 2);
      }
    });

    // Full-height "+ Column" strip on the right.
    const addCol = stripBtn('+ Column', 'df-table-modal__addcol', () => {
      const r = getRows(); r.forEach(row => row.push(''));
      const perCol = cell.size().width / cols;
      commit(r, Math.round(cell.size().width + perCol));
    });
    addCol.style.gridColumn = String(cols + 2); addCol.style.gridRow = `2 / span ${rows.length}`;
    grid.appendChild(addCol);

    // Full-width "+ Row" strip below.
    const addRow = stripBtn('+ Row', 'df-table-modal__addrow', () => { const r = getRows(); r.push(new Array(cols).fill('')); commit(r); });
    addRow.style.gridColumn = `2 / span ${cols}`; addRow.style.gridRow = String(rows.length + 2);
    grid.appendChild(addRow);

    modalBody.appendChild(grid);
    // Auto-size each row to its tallest cell (needs the elements in the DOM) — once per distinct grid row.
    requestAnimationFrame(() => {
      const seen = new Set();
      grid.querySelectorAll('.df-table-modal__cell').forEach(ta => { if (!seen.has(ta.style.gridRow)) { seen.add(ta.style.gridRow); matchRowHeights(ta); } });
    });
  }

  rebuild();
}

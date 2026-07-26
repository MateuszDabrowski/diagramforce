// Property-panel shared render tail (CLEANUP S2, slice 7) — the three functions every per-type renderer ends
// with, extracted so the renderer leaves (BPMN/Gantt/Org/Sequence/core) can import them without the facade:
//   autoSizeCell(cell) - the ONE per-type sizer (panel "Auto Size" + right-click + multi-select; DataObjects fit
//     field rows, Note/Container/OrgPerson own fits, else DEFAULT_SIZES); wired into selection via app.js.
//   buildCellActions(cell) - the single-element context-menu action descriptors (front/back, convert, clone,
//     copy/paste style, save-shape, delete); wired into selection via app.js.
//   finishStandardProps(cell, opts) - the shared Size & Order + footer tail every render*Props calls last.
// Reads graph/selection + the panel DOM refs (bodyEl/footerEl) via prctx; imports the convert/widgets/clipboard/
// components/type-meta leaves; never imports the facade. The facade re-exports autoSizeCell + buildCellActions
// (app.js namespace access) and the staying renderers import finishStandardProps + autoSizeCell back.
import { prctx } from './context.js?v=1.21.0';
import { cloneElementWithConnectors, copy as clipboardCopy, countConnectedConnectors, countConnectors } from '../clipboard.js?v=1.21.0';
import { resizeDataObjectToFit } from '../components.js?v=1.21.0';
import { saveCellAsShape } from '../templates.js?v=1.21.0';
import { COLOR_SCHEMA } from './color-schema.js?v=1.21.0';
import { convertFromIcon, convertToContainer, convertToIcon, convertToNode } from './convert.js?v=1.21.0';
import { DEFAULT_SIZES } from './type-meta.js?v=1.21.0';
import { addApplySizeBtn, addAutoSizeBtn, addCloneBtn, addConvertBtn, addDeleteBtn, addNumber, addNumberPair, addOrderButtons, addRotationField, bringToFront, cloneCellPlain, copyCellStyle, hasStyleClip, pasteCellStyle, section, sendToBack } from './widgets.js?v=1.21.0';

/** Auto-size one element to its sensible default: DataObjects fit their field rows; everything else resets to
 *  DEFAULT_SIZES for its type. The single source of truth shared by the properties-pane "Auto Size" button and
 *  the canvas right-click "Auto size" (wired via prctx.selection.setAutoSizer in app.js). No-op for links. */
export function autoSizeCell(cell) {
  if (!cell || !cell.isElement || !cell.isElement()) return;
  const type = cell.get('type');
  if (type === 'sf.DataObject') { resizeDataObjectToFit(cell); return; }
  // A Note fits its HEIGHT to the rendered description (item 1.2) rather than snapping to the default 200x120 -
  // its view measures the content and grows/shrinks to it. Fall back to the default size if the view is absent.
  if (type === 'sf.Note') {
    const view = prctx.paper.findViewByModel(cell);
    if (view && typeof view.fitNoteToContent === 'function') { view.fitNoteToContent(); return; }
  }
  // df.Table / df.Legend OWN their size at the model level (height from rows / width from the label). Re-run
  // their fit instead of forcing DEFAULT_SIZES, which would compress the rows or ignore the label until the
  // next edit.
  if (type === 'df.Table') {
    cell._normalize?.();   // rectangle + width floor (model)
    const view = prctx.paper.findViewByModel(cell);
    if (view && typeof view._renderTable === 'function') view._renderTable();   // re-measure + fit height (view)
    return;
  }
  if (type === 'df.Legend' && typeof cell._fitWidth === 'function') { cell.set('manualWidth', false); cell._fitWidth(); return; }   // Auto size = back to label-fit
  // V8 reconcile: fold in the smart per-type auto-sizes the property PANEL used to do on its own, so the
  // right-click "Auto size" (and multi-select Auto Size) reach the same result as the panel button.
  //  · Icon SimpleNode → a 64×64 square with the icon inset.
  if (type === 'sf.SimpleNode' && cell.get('iconMode')) {
    cell.resize(64, 64);
    cell.attr({ body: { rx: 32, ry: 32 }, icon: { x: 16, y: 16, width: 32, height: 32 } });
    return;
  }
  //  · Container → hug its embedded children (fall through to the default when it has none / fitEmbeds throws).
  if (type === 'sf.Container') {
    const embeds = cell.getEmbeddedCells().filter((c) => c.isElement());
    if (embeds.length > 0) {
      try { cell.fitEmbeds({ padding: { top: 60, left: 20, right: 20, bottom: 20 } }); return; } catch { /* fall through */ }
    }
  }
  //  · OrgPerson → reset height to 1 so the view's _updateCard auto-heights the card to its content, then notify
  //    handles/ports with a PROPERLY-ARG'd change:size (a bare trigger passes undefined to change:size handlers
  //    that read the cell → "undefined.get" - a latent bug the panel closure had, surfaced by the reconcile test).
  if (type === 'sf.OrgPerson') {
    cell.resize(cell.size().width, 1, { silent: true });
    const view = prctx.paper.findViewByModel(cell);
    if (view?.update) view.update();
    cell.trigger('change:size', cell, cell.size(), {});
    return;
  }
  //  · SequenceActor → the figure+label block (92 px) when the lifeline is hidden, else the default height.
  if (type === 'sf.SequenceActor') {
    const d = DEFAULT_SIZES['sf.SequenceActor'];
    if (d) cell.resize(d.width, cell.get('showLifeline') ? d.height : 92);
    return;
  }
  const def = DEFAULT_SIZES[type];
  if (def) cell.resize(def.width, def.height);
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
  // Copy in its OWN group ('copy') so a separator sits ABOVE it (apart from the Clone variants) and Copy as PNG
  // can join it directly below (context-menu builder in selection.js appends Copy as PNG after this item).
  acts.push({ label: 'Copy', iconKey: 'copy', group: 'copy', handler: () => clipboardCopy() });

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

// ── Standard props tail (Size & Order section + footer buttons) ──────

export function finishStandardProps(cell, { sizeMode = 'pair', squareLabel = 'Size', autoSize = false, applySize = false,
  rotation = false, sizeExtras = null, convert = null, clone = true } = {}) {
  const type = cell.get('type');
  const size = section(prctx.bodyEl, 'Size & Order');
  if (sizeMode === 'pair') {
    addNumberPair(size,
      'Width', cell.size().width, w => cell.resize(w, cell.size().height),
      'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  } else if (sizeMode === 'square') {
    addNumber(size, squareLabel, cell.size().width, v => cell.resize(v, v));
  } else if (sizeMode === 'widthOnly') {
    addNumber(size, 'Width', cell.size().width, w => cell.resize(w, cell.size().height));
  }
  if (sizeExtras) sizeExtras(size);
  if (rotation) addRotationField(size, cell);
  // autoSize: `true` routes the panel button through autoSizeCell — the SAME smart per-type sizer the right-click
  // "Auto size" uses (V8 reconcile), so the two buttons can't diverge. A FUNCTION is still accepted for any future
  // one-off, but the five formerly-divergent types now live in autoSizeCell instead.
  if (autoSize) addAutoSizeBtn(size, typeof autoSize === 'function' ? autoSize : () => autoSizeCell(cell));
  if (applySize) addApplySizeBtn(size, cell);
  addOrderButtons(size, cell);
  if (convert) convert.forEach(cv => addConvertBtn(prctx.footerEl, cv.label, cv.onClick));
  if (clone) addCloneBtn(prctx.footerEl, cell);
  addDeleteBtn(prctx.footerEl, () => { prctx.graph.removeCells([cell]); prctx.selection.clearSelection(); });
}

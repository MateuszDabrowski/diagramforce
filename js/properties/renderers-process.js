// Process-diagram property renderers (CLEANUP S2, slice 11) — the BPMN family (renderBpmnEvent/Task/Gateway/
// Subprocess/Loop/Pool/DataObjectProps) + the Flowchart renderFlowShapeProps (shared by every sf.Flow* shape).
// Build via widgets + finishStandardProps (render-core) + TYPE_LABELS (type-meta), reading graph + the panel DOM
// refs via prctx; never imports the facade. The showProperties() dispatch imports the eight back.
import { prctx } from './context.js?v=1.20.1';
import { contrastTextColor } from '../components.js?v=1.20.1';
import { finishStandardProps } from './render-core.js?v=1.20.1';
import { TYPE_LABELS } from './type-meta.js?v=1.20.1';
import { addColor, addNumber, addSelect, addText, section } from './widgets.js?v=1.20.1';

export function renderBpmnEventProps(cell) {
  // Content
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
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
  const appearance = section(prctx.bodyEl, 'Appearance');
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

  finishStandardProps(cell, { sizeMode: 'square', squareLabel: 'Diameter', applySize: true });
}

export function renderBpmnTaskProps(cell) {
  // Content
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
  });
  // Appearance
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill',        cell.attr('body/fill'),   v => {
    cell.attr('body/fill', v);
    const tc = contrastTextColor(v);
    if (tc) cell.attr('label/fill', tc);
  });
  addColor(appearance, 'Border',      cell.attr('body/stroke'), v => cell.attr('body/stroke', v));
  addColor(appearance, 'Label color', cell.attr('label/fill'),  v => cell.attr('label/fill', v));
  addNumber(appearance, 'Corner radius', cell.attr('body/rx') ?? 8,
    v => { cell.attr('body/rx', v); cell.attr('body/ry', v); });

  finishStandardProps(cell, { sizeMode: 'pair', autoSize: true, applySize: true });
}

export function renderBpmnGatewayProps(cell) {
  // Content
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
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
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill',   cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => cell.attr('body/stroke', v));

  finishStandardProps(cell, { sizeMode: 'square', squareLabel: 'Size', applySize: true });
}

export function renderBpmnSubprocessProps(cell) {
  // Content
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
  });

  // Appearance
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill',   cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => cell.attr('body/stroke', v));

  finishStandardProps(cell, { sizeMode: 'pair', autoSize: true, applySize: true });
}

export function renderBpmnLoopProps(cell) {
  // Content
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
  });

  // Appearance
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill',   cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => cell.attr('body/stroke', v));

  finishStandardProps(cell, { sizeMode: 'pair', autoSize: true, applySize: true });
}

export function renderBpmnPoolProps(cell) {
  // Content
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
  });

  // Appearance — canonical: Fill → sub-element fills → Border → typography
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill',        cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Header fill', cell.attr('header/fill'), v => cell.attr('header/fill', v));
  addColor(appearance, 'Border',      cell.attr('body/stroke'), v => cell.attr('body/stroke', v));
  addColor(appearance, 'Label color', cell.attr('label/fill'),  v => cell.attr('label/fill', v));

  finishStandardProps(cell, { sizeMode: 'pair', applySize: true });
}

export function renderBpmnDataObjectProps(cell) {
  // Content
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
  });

  // Appearance
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill',   cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => {
    cell.attr('body/stroke', v);
    cell.attr('fold/stroke', v);
  });

  finishStandardProps(cell, { sizeMode: 'pair', applySize: true });
}

export function renderFlowShapeProps(cell) {
  const type = cell.get('type');
  const typeLabel = TYPE_LABELS[type] || 'Shape';

  // Content
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
  });

  // Appearance
  const appearance = section(prctx.bodyEl, 'Appearance');
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

  finishStandardProps(cell, { sizeMode: 'pair', autoSize: true, applySize: true });
}

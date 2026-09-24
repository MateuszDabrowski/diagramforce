// Sequence-diagram property renderers (CLEANUP S2, slice 8) — renderSequenceParticipantProps / ActorProps /
// ActivationProps / FragmentProps. Each builds its panel via the widget builders + the shared render tail
// (finishStandardProps from render-core), reading graph/paper/selection + the panel DOM refs + the showProperties
// dispatch via prctx at CALL time; never imports the facade back. The facade's showProperties() dispatch imports
// these four back.
import * as history from '../history.js?v=1.24.2';
import { prctx } from './context.js?v=1.24.2';

// Port rebuilds and the Actor lifeline toggle rewrite `ports` (and attrs / size), which history does not record - so
// an undo reverted the COUNT but left the ports, and undoing "Hide lifeline" showed a lifeline with no ports
// (audit 2026-09-23). Run the op with recording suppressed and push ONE command that restores the whole snapshot.
function snapLifeline(cell) {
  const ratios = cell.get('lifelinePortRatios');
  return {
    ports: JSON.parse(JSON.stringify(cell.get('ports') || {})),
    count: cell.get('lifelinePortCount'),
    ratios: Array.isArray(ratios) ? ratios.slice() : null,
    show: cell.get('showLifeline'),
    attrs: JSON.parse(JSON.stringify(cell.get('attrs') || {})),
    size: { ...cell.size() },
  };
}
function applyLifeline(cell, st) {
  history.setSuppressed(true);
  try {
    cell.prop('ports', JSON.parse(JSON.stringify(st.ports)), { rewrite: true });
    cell.set({ lifelinePortCount: st.count, showLifeline: st.show });
    if (st.ratios) cell.set('lifelinePortRatios', st.ratios.slice()); else cell.unset('lifelinePortRatios');
    cell.set('attrs', JSON.parse(JSON.stringify(st.attrs)));
    cell.resize(st.size.width, st.size.height);
  } finally { history.setSuppressed(false); }
}
function undoableLifelineOp(cell, op) {
  const before = snapLifeline(cell);
  history.flushPendingDragCommit();
  history.setSuppressed(true);
  let after;
  try { op(); history.flushPendingDragCommit(); after = snapLifeline(cell); } finally { history.setSuppressed(false); }
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    history.recordCommand(() => applyLifeline(cell, before), () => applyLifeline(cell, after));
  }
}
import { finishStandardProps } from './render-core.js?v=1.24.2';
import { addColor, addNumber, addSegmented, addSelect, addText, section } from './widgets.js?v=1.24.2';

export function renderSequenceParticipantProps(cell) {
  // Content
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
  }, cell);

  // Appearance
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Accent',     cell.attr('headerAccent/fill'), v => {
    cell.attr('headerAccent/fill', v);
  });
  addColor(appearance, 'Fill',        cell.attr('header/fill'),       v => cell.attr('header/fill', v));
  addColor(appearance, 'Label color', cell.attr('label/fill'),        v => cell.attr('label/fill', v));

  // Lifeline — port count (ports auto-distribute evenly along the lifeline)
  const lifeline = section(prctx.bodyEl, 'Lifeline');
  addNumber(lifeline, 'Ports', cell.get('lifelinePortCount') ?? 5, v => {
    undoableLifelineOp(cell, () => joint.shapes.sf.rebuildSeqParticipantPorts(cell, v));
  });

  finishStandardProps(cell, { sizeMode: 'pair', autoSize: true, applySize: true });
}

export function renderSequenceActorProps(cell) {
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
  }, cell);

  const appearance = section(prctx.bodyEl, 'Appearance');
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
  const lifeline = section(prctx.bodyEl, 'Lifeline');
  addSegmented(lifeline, 'Visibility', showLifeline, [
    { value: true,  label: 'Show' },
    { value: false, label: 'Hide' },
  ], v => {
    undoableLifelineOp(cell, () => joint.shapes.sf.setActorLifelineVisible(cell, v));
    // Re-render the panel so the Ports field appears/disappears
    prctx.showProperties(cell);
  });
  if (showLifeline) {
    addNumber(lifeline, 'Ports', cell.get('lifelinePortCount') ?? 5, v => {
      undoableLifelineOp(cell, () => joint.shapes.sf.rebuildSeqActorPorts(cell, v));
    });
  }

  // Actor keeps its bespoke Auto Size (figure+label block when the lifeline is hidden) via an autoSize closure.
  finishStandardProps(cell, {
    sizeMode: 'pair',
    autoSize: true,
    applySize: true,
  });
}

export function renderSequenceActivationProps(cell) {
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill',   cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => cell.attr('body/stroke', v));

  // Lifeline — port count (auto-distributed evenly)
  const lifeline = section(prctx.bodyEl, 'Lifeline');
  addNumber(lifeline, 'Ports', cell.get('lifelinePortCount') ?? 2, v => {
    undoableLifelineOp(cell, () => joint.shapes.sf.rebuildSeqActivationPorts(cell, v));
  });

  finishStandardProps(cell, { sizeMode: 'pair', autoSize: true, applySize: true });
}

export function renderSequenceFragmentProps(cell) {
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
  const content = section(prctx.bodyEl, 'Content');
  const labelInput = addText(content, 'Label', cell.get('fragmentLabel') || cell.attr('titleText/text') || '', v => {
    cell.set('fragmentLabel', v);
    cell.attr('titleText/text', v);
    prctx.titleEl.textContent = v || '';
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
  const appearance = section(prctx.bodyEl, 'Appearance');
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

  finishStandardProps(cell, { sizeMode: 'pair', autoSize: true, applySize: true });
}

// Sequence-diagram property renderers (CLEANUP S2, slice 8) — renderSequenceParticipantProps / ActorProps /
// ActivationProps / FragmentProps. Each builds its panel via the widget builders + the shared render tail
// (finishStandardProps from render-core), reading graph/paper/selection + the panel DOM refs + the showProperties
// dispatch via prctx at CALL time; never imports the facade back. The facade's showProperties() dispatch imports
// these four back.
import { prctx } from './context.js?v=1.21.3';
import { finishStandardProps } from './render-core.js?v=1.21.3';
import { addColor, addNumber, addSegmented, addSelect, addText, section } from './widgets.js?v=1.21.3';

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
    joint.shapes.sf.rebuildSeqParticipantPorts(cell, v);
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
    joint.shapes.sf.setActorLifelineVisible(cell, v);
    // Re-render the panel so the Ports field appears/disappears
    prctx.showProperties(cell);
  });
  if (showLifeline) {
    addNumber(lifeline, 'Ports', cell.get('lifelinePortCount') ?? 5, v => {
      joint.shapes.sf.rebuildSeqActorPorts(cell, v);
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
    joint.shapes.sf.rebuildSeqActivationPorts(cell, v);
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

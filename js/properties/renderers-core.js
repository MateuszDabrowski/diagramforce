// Core / architecture property renderers (CLEANUP S2, slice 12 - the final renderer family) — renderSimpleNode /
// Container / TextLabel / Pill / Legend / Table / Line / LinkElement / Note / Image / Zone / TaskGroup /
// DataObject / AnnotationProps. These cover the Architecture + Data Model shapes plus the shared df.* shapes. Build
// via widgets + finishStandardProps (render-core), the convert helpers (SimpleNode<->Container/Icon buttons),
// renderFieldEditor (field-editor, the DataObject field list), startImageAddFlow (image-component), reading graph +
// the panel DOM refs + the showProperties dispatch + the df.Table openTableEditorModal overlay via prctx; never
// imports the facade. The showProperties() dispatch imports all 14 render*Props back.
import * as history from '../history.js?v=1.21.1';
import { prctx } from './context.js?v=1.21.1';
import { updateContainerHeaderLayout, updateDataObjectHeaderLayout, updateNoteIconLayout, updateSimpleNodeLayout } from '../canvas.js?v=1.21.1';
import { SVG as COMPONENT_SVG, contrastTextColor, extractLinkDomain, getStencilSvgDataUri, resizeDataObjectToFit } from '../components.js?v=1.21.1';
import { startImageAddFlow } from '../image-component.js?v=1.21.1';
import { recolorCellIcon } from './color-schema.js?v=1.21.1';
import { convertFromIcon, convertToContainer, convertToIcon, convertToNode } from './convert.js?v=1.21.1';
import { renderFieldEditor } from './field-editor.js?v=1.21.1';
import { finishStandardProps } from './render-core.js?v=1.21.1';
import { addAutoSizeBtn, addChipInput, addCloneBtn, addColor, addDeleteBtn, addIconPicker, addNumber, addNumberPair, addOrderButtons, addRaciPicker, addSegmented, addSelect, addText, addTextarea, section, wireMarkdownShortcuts } from './widgets.js?v=1.21.1';

export function renderSimpleNodeProps(cell) {
  const isIcon = cell.get('iconMode');
  // Content
  const content = section(prctx.bodyEl, 'Content');
  const labelValue = isIcon ? (cell.get('_savedLabel') || '') : cell.attr('label/text');
  const subtitleValue = isIcon ? (cell.get('_savedSubtitle') || '') : cell.attr('subtitle/text');
  addText(content, 'Label', labelValue, v => {
    if (isIcon) {
      cell.set('_savedLabel', v);
    } else {
      cell.attr('label/text', v);
      updateSimpleNodeLayout(cell);
    }
    prctx.titleEl.textContent = v || '';
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
  const appearance = section(prctx.bodyEl, 'Appearance');
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

  // An icon node keeps its bespoke square Size (with the rx/icon attrs) + its 64×64 Auto Size; converts differ by mode.
  finishStandardProps(cell, {
    sizeMode: 'none',
    sizeExtras: (s) => {
      if (isIcon) {
        addNumber(s, 'Size', cell.size().width, v => {
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
        addNumberPair(s,
          'Width', cell.size().width, w => cell.resize(w, cell.size().height),
          'Height', cell.size().height, h => cell.resize(cell.size().width, h));
      }
    },
    autoSize: true,
    applySize: true,
    convert: cell.get('iconMode')
      ? [{ label: 'Convert to Node', onClick: () => convertFromIcon(cell) }]
      : [{ label: 'Convert to Container', onClick: () => convertToContainer(cell) },
         { label: 'Convert to Icon', onClick: () => convertToIcon(cell) }],
  });
}

export function renderContainerProps(cell) {
  // Content
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('headerLabel/text'), v => {
    cell.attr('headerLabel/text', v);
    prctx.titleEl.textContent = v || '';
  }, cell);
  addTextarea(content, 'Description', cell.attr('headerSubtitle/text'), v => cell.attr('headerSubtitle/text', v));
  addIconPicker(content, 'Icon', cell.attr('headerIcon/href'), v => { cell.attr('headerIcon/href', v); updateContainerHeaderLayout(cell); },
    () => resolveColor(cell.attr('headerLabel/fill')) || '#FFFFFF');
  // Tags + RACI — primarily for the Team variant in Org Chart diagrams, but
  // available on every Container. Empty values render nothing on canvas, so
  // they're invisible until used.
  addChipInput(content, 'Tags', cell.get('tags') || [], v => cell.set('tags', v));
  addRaciPicker(content, 'RACI', cell.get('raci') || {}, v => cell.set('raci', v));

  // Appearance
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Accent',      cell.attr('accent/fill'),     v => { cell.attr('accent/fill', v); cell.attr('accentFill/fill', v); });
  addColor(appearance, 'Fill',        cell.attr('body/fill'),        v => cell.attr('body/fill', v));
  addColor(appearance, 'Border',      cell.attr('body/stroke'),      v => cell.attr('body/stroke', v));
  addColor(appearance, 'Label color', cell.attr('headerLabel/fill'), v => {
    cell.attr('headerLabel/fill', v);
    recolorCellIcon(cell, v);
  });

  // A Container's Auto Size hugs its embedded children (fitEmbeds) when it has any, else the default size.
  finishStandardProps(cell, {
    sizeMode: 'pair',
    autoSize: true,
    applySize: true,
    convert: [{ label: 'Convert to Node', onClick: () => convertToNode(cell) }],
  });
}

export function renderTextLabelProps(cell) {
  // Content — primary editable text only.
  const content = section(prctx.bodyEl, 'Content');
  const labelInput = addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
  });
  // CR-6.1: markdown shortcuts (Cmd+B/I/Shift+X/E) + hint below the input.
  wireMarkdownShortcuts(labelInput, content);

  // Appearance — typography styling. Sits in its own section so the panel
  // matches the universal Content / Appearance / Size & Order rhythm.
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Label color', cell.attr('label/fill'), v => cell.attr('label/fill', v));
  // Font size moved to the Size & Order section (item 1) - added generically there for every text shape.

  finishStandardProps(cell, { sizeMode: 'pair', rotation: true, autoSize: true });
}

// df.Pill — a number / short-label badge that auto-widths to its content (circle → pill).
export function renderPillProps(cell) {
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Text', String(cell.get('pillText') ?? ''), v => {
    cell.set('pillText', v);   // the PillView auto-widths + syncs the rendered label
    prctx.titleEl.textContent = v || 'Pill';
  });
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill', cell.attr('body/fill'), v => cell.attr('body/fill', v));
  addColor(appearance, 'Text color', cell.attr('label/fill'), v => cell.attr('label/fill', v));
  // Width auto-fits the text; height + rotation are free.
  finishStandardProps(cell, { sizeMode: 'pair', rotation: true });
}

// df.Legend — one legend KEY: a fillable swatch + a label. Drop several to build a colour key; each item
// carries its own Shape state, and the item auto-widths to its label.
export function renderLegendProps(cell) {
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);   // the model auto-widths to the new text
    prctx.titleEl.textContent = v || 'Legend';
  });
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill', cell.attr('swatch/fill'), v => cell.attr('swatch/fill', v));
  addColor(appearance, 'Label color', cell.attr('label/fill'), v => cell.attr('label/fill', v));
  // Width auto-fits the label until set here (then manualWidth sticks it).
  finishStandardProps(cell, { sizeMode: 'none', rotation: true, sizeExtras: (s) => {
    addNumberPair(s,
      'Width', cell.size().width, w => { cell.set('manualWidth', true); cell.resize(w, cell.size().height); },
      'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  } });
}

// df.Table — a minimal grid. Cells are edited in the shared "Edit in Table" overlay; the panel exposes the
// header-row toggle + fill / border. Height auto-fits the row count; width divides equally across the columns.
export function renderTableProps(cell) {
  const content = section(prctx.bodyEl, 'Content');
  // Optional caption rendered above the grid (left-aligned). Empty by default — nothing renders until set.
  addText(content, 'Label', cell.get('tableLabel') || '', v => {
    cell.set('tableLabel', v);
    prctx.titleEl.textContent = v || 'Table';
  });
  const editBtn = document.createElement('button');
  editBtn.className = 'df-properties__btn df-properties__btn--full-edit';
  editBtn.textContent = '⊞ Edit in Table';
  editBtn.addEventListener('click', () => prctx.openTableEditorModal(cell));
  content.appendChild(editBtn);

  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill', cell.get('tableFill') || 'var(--node-bg)', v => cell.set('tableFill', v), { defaultValue: 'var(--node-bg)' });
  addColor(appearance, 'Grid & Border', cell.get('tableBorder') || 'var(--node-border)', v => cell.set('tableBorder', v), { defaultValue: 'var(--node-border)' });
  addColor(appearance, 'Text color', cell.get('tableTextColor') || 'var(--text-primary)', v => cell.set('tableTextColor', v), { defaultValue: 'var(--text-primary)' });

  // Height auto-fits the cell content; width is free (columns divide it) + a Font size control.
  finishStandardProps(cell, { sizeMode: 'none', sizeExtras: (s) => {
    addNumber(s, 'Width', cell.size().width, w => cell.resize(Math.max(w, 48), cell.size().height), { min: 48 });
    addNumber(s, 'Font size', cell.get('fontSize') ?? 13, v => cell.set('fontSize', v), { min: 6, max: 96 });
  } });
}

/* ── Edit-in-Table overlay for a df.Table grid ───────────── */
// A staged editor over a markdown grid. Edits apply LIVE to the cell (the canvas previews as you type) but the
// whole session is history-LOCKED (setLocked) so the keystrokes don't pollute undo: Save records ONE undo entry
// (snapshot -> final), Cancel / ✕ / Escape reverts to the snapshot and records nothing. Layout: a Display-style
// "Highlight first row / first column" toolbar; a grid with the row-delete × on the LEFT of each row and the
// column-delete × on TOP of each column (column delete confirms); a full-width "+ Row" strip below and a
// full-height "+ Column" strip on the right. Cells are markdown textareas (multi-line, same shortcuts as the
// node description).

export function renderLineProps(cell) {
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
  const content = section(prctx.bodyEl, 'Content');
  const labelInput = addTextarea(content, 'Label', cell.attr('label/text') || '',
    v => cell.attr('label/text', v));
  wireMarkdownShortcuts(labelInput, content);

  // Appearance — canonical line ordering: Color → Line style → Line width
  // (identity first, then variant, then measurement).
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Color', cell.attr('line/stroke'), v => cell.attr('line/stroke', v));
  addSelect(appearance, 'Line style', cell.get('lineStyle') || 'solid', LINE_STYLES, v => applyLineStyle(v));
  addNumber(appearance, 'Line width', cell.attr('line/strokeWidth') ?? 2, v => cell.attr('line/strokeWidth', v));

  finishStandardProps(cell, { sizeMode: 'pair', rotation: true, autoSize: true });
}

export function renderLinkElementProps(cell) {
  // Content
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
  });
  addText(content, 'URL', cell.get('url') || '', v => {
    cell.set('url', v);
    const domain = extractLinkDomain(v);
    cell.attr('domain/text', domain);
    cell.attr('label/y', domain ? 'calc(0.5 * h - 8)' : 'calc(0.5 * h)');
  });

  // Appearance — canonical: Fill → Border → typography (Label color, Font size)
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill',   cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => cell.attr('body/stroke', v));
  addColor(appearance, 'Label color', cell.attr('label/fill'), v => {
    cell.attr('label/fill', v);
    cell.attr('iconImage/href', getStencilSvgDataUri(COMPONENT_SVG.linkIcon, v, 20));
  });
  // Font size moved to the Size & Order section (item 1) - added generically there for every text shape.

  finishStandardProps(cell, { sizeMode: 'pair', autoSize: true });
}

export function renderNoteProps(cell) {
  // Content
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
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
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill',       cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  // Border also recolours the folded corner (fold fill + stroke) so the user controls the dog-ear (#8).
  addColor(appearance, 'Border',     cell.attr('body/stroke'), v => { cell.attr('body/stroke', v); cell.attr('fold/stroke', v); cell.attr('fold/fill', v); });
  addColor(appearance, 'Label color', cell.attr('label/fill'),  v => {
    cell.attr('label/fill', v);
    cell.attr('subtitle/fill', v);
    recolorCellIcon(cell, v);
  });

  finishStandardProps(cell, { sizeMode: 'pair', autoSize: true, applySize: true });
}

export function renderImageProps(cell) {
  // Appearance
  const appearance = section(prctx.bodyEl, 'Appearance');
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
  const size = section(prctx.bodyEl, 'Size & Order');
  addNumberPair(size,
    'Width',  cell.size().width,  w => cell.resize(w, cell.size().height),
    'Height', cell.size().height, h => cell.resize(cell.size().width, h));
  addOrderButtons(size, cell);

  // Footer
  addCloneBtn(prctx.footerEl, cell);
  addDeleteBtn(prctx.footerEl, () => { prctx.graph.removeCells([cell]); prctx.selection.clearSelection(); });
}

export function renderZoneProps(cell) {
  // Content
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
  });

  // Appearance — canonical order: Fill → Border → Label colour
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill',   cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => cell.attr('body/stroke', v));
  addColor(appearance, 'Label color', cell.attr('label/fill') || 'var(--text-muted)', v => cell.attr('label/fill', v));

  finishStandardProps(cell, { sizeMode: 'pair', autoSize: true, applySize: true });
}

// RACI section grouper — same surface as a Zone (label + fill/border + size), but
// its own default size and "Task Group" identity. Drop Tasks inside to build a
// labelled section of RACI rows.
export function renderTaskGroupProps(cell) {
  // Content
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
  });

  // Appearance — Fill → Border
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill',   cell.attr('body/fill'),   v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke'), v => cell.attr('body/stroke', v));

  finishStandardProps(cell, { sizeMode: 'pair', autoSize: true, applySize: true });
}

// Core Salesforce CRM field types + Data Cloud primitives (the shared dictionary used by
// both the sidebar field editor and the Edit Fields modal). 'Boolean' is the Data Cloud
// primitive alongside the CRM 'Checkbox'; both live in the Boolean compatibility group.
// Salesforce / Data Cloud field data types — the canonical picklist used by the
// DataObject field editor AND, re-exported, by the Data Mapping table edit mode so
// both surfaces offer the exact same options (single source of truth).
export function renderDataObjectProps(cell) {
  // Content (stores into `objectName` — placeholder hints at the data-model
  // semantic, but the UI label stays "Label" for cross-shape consistency).
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.get('objectName'), v => {
    cell.set('objectName', v);
    cell.attr('headerLabel/text', v);
    prctx.titleEl.textContent = v || '';
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
  if (prctx.isMappingMode()) {
    addSegmented(content, 'Category', cell.get('category') || '', [
      { value: 'Profile', label: 'Profile' },
      { value: 'Engagement', label: 'Engagement' },
      { value: 'Other', label: 'Other' },
    ], v => { cell.set('category', v); }, { allowDeselect: true });
  }

  // Fields lead — the rows are a DataObject's primary content, so they sit
  // directly under Content, ahead of the lighter Appearance (header colour) block.
  const fieldsSec = section(prctx.bodyEl, 'Fields');

  renderFieldEditor(fieldsSec, cell);

  // Appearance — header fill is an appearance property.
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Header fill', cell.get('headerColor') || '#1D73C9', v => {
    cell.set('headerColor', v);
    cell.attr('header/fill', v);
    cell.attr('headerCover/fill', v);
  }, { defaultValue: '#1D73C9' });

  // Size & Order
  const size = section(prctx.bodyEl, 'Size & Order');
  addNumber(size, 'Width', cell.size().width, w => {
    cell.resize(w, cell.size().height);
  });
  addAutoSizeBtn(size, () => resizeDataObjectToFit(cell));
  addOrderButtons(size, cell);

  // Delete
  addCloneBtn(prctx.footerEl, cell);
  addDeleteBtn(prctx.footerEl, () => { prctx.graph.removeCells([cell]); prctx.selection.clearSelection(); });
}

export function renderAnnotationProps(cell) {
  // Content (uses addText for consistency — auto-grows on newlines, supports
  // markdown shortcuts, no need for a dedicated textarea widget).
  const content = section(prctx.bodyEl, 'Content');
  const labelInput = addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
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
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Bracket color', cell.attr('bracket/stroke'), v => cell.attr('bracket/stroke', v));
  addColor(appearance, 'Label color',    cell.attr('label/fill'),     v => cell.attr('label/fill', v));

  finishStandardProps(cell, { sizeMode: 'pair', rotation: true, autoSize: true, applySize: true });
}

// Resolve a CSS var() colour to its computed hex (for contrast maths); pass-through for literal colours. Pure DOM.
function resolveColor(color) {
  if (!color) return '';
  if (color.startsWith('var(')) {
    return getComputedStyle(document.documentElement).getPropertyValue(
      color.replace(/^var\(/, '').replace(/\)$/, '').split(',')[0].trim()
    ).trim() || '#1C1E21';
  }
  return color;
}

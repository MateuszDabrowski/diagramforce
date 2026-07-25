// Property-panel widget builders (CLEANUP S2, slice 3) — the ~50 form-field / action-button / picker builders
// extracted from properties.js. They read the live graph/paper/selection via prctx (context.js) at CALL time,
// take their target `parent` element as an argument, and never import the facade back. The renderers +
// finishStandardProps + buildCellActions (still in the facade) import these.
import { prctx, asUndoBatch } from './context.js?v=1.20.1';
import * as history from '../history.js?v=1.20.1';
import { copy as clipboardCopy, cloneElementWithConnectors, countConnectedConnectors, countConnectors } from '../clipboard.js?v=1.20.1';
import { wrapSelectionWithMarker } from '../markdown.js?v=1.20.1';
import { COLOR_SCHEMA } from './color-schema.js?v=1.20.1';
import { confirmModal, showToast } from '../feedback.js?v=1.20.1';
import { getAllIcons, getIconDataUri } from '../icons.js?v=1.20.1';
import { Z_BASE, Z_TIER_SPAN, tierNameForType, updateSimpleNodeLayout, updateDataObjectHeaderLayout } from '../canvas.js?v=1.20.1';
import { getPalette, addToPalette, removeFromPalette, onPaletteChange, PALETTE_MAX_SLOTS } from '../brand-palette.js?v=1.20.1';
import { escHtml } from '../util.js?v=1.20.1';
import { saveCellAsShape } from '../templates.js?v=1.20.1';

export function section(parent, title, open = true) {
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
export function orderPeerLabel(cell) {
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
  const peers = prctx.graph.getElements().filter(el => el !== cell && el.get('z') >= tierBase && el.get('z') < tierMax);
  const maxZ = peers.length ? Math.max(...peers.map(el => el.get('z') ?? tierBase)) : tierBase;
  const oldZ = cell.get('z');
  const newZ = maxZ + 1;
  if (oldZ === newZ) return;
  cell.set('z', newZ);
  history.recordCommand(
    () => { const c = prctx.graph.getCell(cell.id); if (c) c.set('z', oldZ); },
    () => { const c = prctx.graph.getCell(cell.id); if (c) c.set('z', newZ); },
  );
}

/** Drop a cell below its same-tier peers (undoable). Shared by the properties Order button + the context menu. */
export function sendToBack(cell) {
  const type = cell.get('type');
  const tierBase = Z_BASE[type] ?? 20000;
  const tierMax = tierBase + Z_TIER_SPAN;
  const peers = prctx.graph.getElements().filter(el => el !== cell && el.get('z') >= tierBase && el.get('z') < tierMax);
  const minZ = peers.length ? Math.min(...peers.map(el => el.get('z') ?? tierBase)) : tierBase;
  const oldZ = cell.get('z');
  const newZ = Math.max(tierBase, minZ - 1);
  if (oldZ === newZ) return;
  cell.set('z', newZ);
  history.recordCommand(
    () => { const c = prctx.graph.getCell(cell.id); if (c) c.set('z', oldZ); },
    () => { const c = prctx.graph.getCell(cell.id); if (c) c.set('z', newZ); },
  );
}

// Primary text selectors a shape may use for its MAIN label, in priority order. Detecting which one a cell
// actually has (a non-null fontSize) lets ONE generic Font-size control serve every text-rendering shape, added
// uniformly to the Size & Order section (item 1). A shape whose label font is COMPUTED by a custom view
// (sf.OrgPerson sizes nameLabel/positionLabel dynamically in OrgPersonView; DataObject field rows are hard-coded)
// has none of these as an attr-driven primary label, so it gets no control here - correct, the value would not stick.
export const FONT_LABEL_SELECTORS = ['label', 'headerLabel', 'titleText'];
export function primaryFontSelector(cell) {
  for (const sel of FONT_LABEL_SELECTORS) {
    if (cell.attr && cell.attr(`${sel}/fontSize`) != null) return sel;
  }
  return null;
}
/** Append a single Font-size control for the cell's primary label, if it has an attr-driven one. Stores at
 *  `<selector>/fontSize` (the same path the existing TextLabel/Link controls used) so it is lossless + reversible. */
export function addFontSizeControl(sec, cell) {
  const sel = primaryFontSelector(cell);
  if (!sel) return;
  addNumber(sec, 'Font size', cell.attr(`${sel}/fontSize`) ?? 13, (v) => cell.attr(`${sel}/fontSize`, v), { min: 6, max: 96 });
}

export function addOrderButtons(sec, cell) {
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
export function autoActionIcon(label) {
  if (/^save/i.test(label)) return SAVE_SHAPE_ICON_SVG;
  if (/^select all/i.test(label)) return SELECT_ALL_ICON_SVG;
  if (/^convert/i.test(label)) return CONVERT_ICON_SVG;
  return '';
}
export function addActionBtn(parent, label, onClick, iconSvg = '') {
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

export function addConvertBtn(parent, label, onClick) {
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

export const CLONE_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="5" y="5" width="9" height="9" rx="2"/>
    <path d="M3 11H2.5A1.5 1.5 0 011 9.5V2.5A1.5 1.5 0 012.5 1h7A1.5 1.5 0 0111 2.5V3"/>
  </svg>`;
// Copy-to-clipboard glyph (a clipboard) — distinct from Clone (in-place duplicate); matches the canvas menu's
// Copy icon. Copy lets you paste into another tab/diagram; Clone duplicates beside the original.
export const COPY_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="3" width="8" height="11" rx="1.5"/>
    <path d="M6 3V1.8h4V3"/>
  </svg>`;
// Footer-button glyphs matching the right-click menu's CTX_ICON set (item 2): Save Shape = a bookmark, Select
// all = a dashed marquee, Convert = the swap arrows (the same path addConvertBtn draws).
export const SAVE_SHAPE_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 2h8a1 1 0 011 1v11l-5-3-5 3V3a1 1 0 011-1z"/>
  </svg>`;
export const SELECT_ALL_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke-dasharray="2.4 1.8"/>
  </svg>`;
export const CONVERT_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1 4h11l-3-3M15 12H4l3 3"/>
  </svg>`;

/** Default clone behavior for a single cell: place a copy beside the original. */
export function cloneCellPlain(cell) {
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
  prctx.graph.addCell(clone);
  prctx.selection.selectOnly(clone.id);
}

export function addCloneBtn(parent, cell) {
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
export function applyClipStyle(cell, clip) {
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
  if (n) { prctx.refresh(); showToast(`Style pasted to ${n} component${n === 1 ? '' : 's'} ✓`, 'success'); }
  return n;
}


export function addDeleteBtn(parent, onClick) {
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

export function field(parent, label) {
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
export function wireMarkdownShortcuts(inputEl, hintParent) {
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

export function addText(parent, label, value, onChange, cell, opts) {
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
export function getActiveCell() {
  const ids = prctx.selection.getSelectedIds();
  if (ids.length !== 1) return null;
  return prctx.graph.getCell(ids[0]) || null;
}

/** Show a red blinking caret on the canvas label when the input is focused */
export function wireCanvasLabelHighlight(input, cell) {
  let caretEl = null;

  function getLabelTextEl() {
    const view = prctx.paper.findViewByModel(cell);
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
    const view = prctx.paper.findViewByModel(cell);
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

export function addDate(parent, label, value, onChange) {
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

  // Live setter — push a new ISO value into the field WITHOUT firing onChange (used to reflect a model change made
  // elsewhere, e.g. a drag/resize updating the dates). Never clobbers a value the user is actively typing.
  return {
    set(isoVal) {
      if (document.activeElement === display) return;
      display.value = toDisplay(isoVal || '');
      picker.value = isoVal || '';
    },
  };
}

export function addTextarea(parent, label, value, onChange, opts) {
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
export function addChipInput(parent, label, values, onChange) {
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
export function addRaciPicker(parent, label, value, onChange) {
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

/** Wire a native `<input type="color">` so a whole picker DRAG lands as ONE undo entry (P4). Applying +
 *  batching on EVERY streamed 'input' recorded dozens of undo entries per drag — enough to flush the
 *  100-entry stack and evict real history. Here: open ONE history batch on the first value event, apply
 *  each value LIVE but LEADING-EDGE THROTTLED to ~one per animation frame (so the setter's deep-clone +
 *  paper.updateViews + Safari re-insert don't run per streamed event), and close the batch on a short IDLE
 *  (no further value for IDLE_MS) or on 'blur'.
 *
 *  Why IDLE, not close-on-'change': the inline picker fires 'change' ONCE on commit, but the macOS system
 *  Colours panel (the colour WHEEL) fires 'change' CONTINUOUSLY while you drag — so closing the batch on
 *  'change' split one wheel drag back into dozens of entries. Treating both 'input' and 'change' as "a value
 *  arrived" and closing only when the stream goes quiet makes a whole continuous drag ONE entry regardless of
 *  which picker fired it (a deliberate >IDLE_MS pause mid-drag simply starts a fresh entry — acceptable). The
 *  open batch also coalesces every intra-drag change:attrs into ONE composite command with the correct
 *  pre-drag→final diff (a plain setSuppressed can't: cell.previous only remembers one step). `apply` is the
 *  RAW setter (this batch owns history); `onInput` runs synchronously every event for cheap UI mirroring. */
function wireColorSwatchDrag(swatch, apply, onInput) {
  let open = false, frameGuard = false, latest = null, idleTimer = 0;
  const IDLE_MS = 250;
  const close = () => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0; }
    if (!open) return;
    if (latest != null) { apply(latest); latest = null; }   // land the final coalesced value inside the batch
    open = false;
    history.endBatch();
  };
  const armIdle = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = setTimeout(close, IDLE_MS); };
  const onValue = () => {
    onInput?.(swatch.value);
    if (!open) { open = true; history.startBatch(); }
    if (!frameGuard) {
      // Leading edge — apply this frame's first value immediately (live feedback + synchronous for a scripted
      // event), then coalesce any further values in the same frame into one trailing apply.
      frameGuard = true;
      apply(swatch.value); latest = null;
      requestAnimationFrame(() => { frameGuard = false; if (latest != null) { apply(latest); latest = null; } });
    } else {
      latest = swatch.value;
    }
    armIdle();
  };
  swatch.addEventListener('input', onValue);
  swatch.addEventListener('change', onValue);   // NOT a close — macOS fires it mid-drag; idle/blur close instead
  swatch.addEventListener('blur', close);       // focus left the swatch → definitive end, close now
}

export function addColor(parent, label, value, onChange, opts = {}) {
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

  // The swatch DRAG is bracketed into ONE undo entry (P4) — see wireColorSwatchDrag. The synchronous
  // onInput mirrors the hex text + reset state on every event; the model apply (onChange) is batched +
  // throttled. Discrete commits (hex text, reset, palette) keep their own asUndoBatch below.
  wireColorSwatchDrag(swatch, onChange, () => {
    textInput.value = swatch.value;
    lastValid = swatch.value;
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
      // Arm the × delete only after a LONG CONTINUOUS hover (1.2s) or a right-click — never on a quick pass
      // or click (which APPLIES the colour). A JS timer drives the `is-removable` class so the × reveal
      // (opacity) and its click target (pointer-events) flip TOGETHER; a bare CSS hover-delay let browsers
      // make the delete target live BEFORE the × was visible, so clicking swatches to preview a colour deleted
      // them instead (user-reported). Moving between swatches quickly never arms one.
      let armTimer = 0;
      const disarm = () => { if (armTimer) { clearTimeout(armTimer); armTimer = 0; } item.classList.remove('is-removable'); };
      item.addEventListener('mouseenter', () => { if (armTimer) clearTimeout(armTimer); armTimer = setTimeout(() => item.classList.add('is-removable'), 1200); });
      item.addEventListener('mouseleave', disarm);
      item.addEventListener('contextmenu', (e) => { e.preventDefault(); item.classList.add('is-removable'); });   // right-click = arm now
      // × remove button — revealed + clickable only while the swatch is armed (is-removable); see properties.css.
      const remove = document.createElement('span');
      remove.className = 'df-prop-palette-swatch__remove';
      remove.textContent = '×';
      remove.setAttribute('role', 'button');
      remove.setAttribute('aria-label', `Remove ${hex} from palette`);
      remove.title = 'Remove from palette';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!item.classList.contains('is-removable')) return;   // only delete when armed (belt-and-suspenders vs a stray pointer-events window)
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
 * and the text input shows a "Mixed" placeholder so the user can see
 * the selected elements disagree on this colour. Picking a colour (either
 * via swatch or by typing a hex) applies it to every selected element.
 */
export function addColorMulti(parent, label, value, onChange) {
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
  if (mixed) textInput.placeholder = 'Mixed';

  const clearMixed = () => {
    swatch.classList.remove('df-properties__color--mixed');
    textInput.placeholder = '';
  };

  // Bracket the swatch drag into ONE undo entry (P4) — multi-select is the worst case (every selected
  // element × every attr per event). See wireColorSwatchDrag.
  wireColorSwatchDrag(swatch, onChange, () => {
    clearMixed();
    textInput.value = swatch.value;
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
export function addNumber(parent, label, value, onChange, opts = {}) {
  const min = opts.min ?? 1;
  const max = opts.max;
  const f = field(parent, label);
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'df-properties__input';
  input.value = value ?? 0;
  // Multi-select MIXED state: pass value '' + opts.placeholder 'Mixed' so a differing selection shows an empty
  // field hinting "Mixed" rather than a concrete (misleading) number. No-op for the usual single-value callers.
  if (opts.placeholder) input.placeholder = opts.placeholder;
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
export function addNumberPair(parent, labelA, valueA, onChangeA, labelB, valueB, onChangeB, opts = {}) {
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
export function rotationField(parent, label, getDeg, setDeg) {
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
export function addRotationField(parent, cell) {
  rotationField(parent, 'Rotation', () => cell.angle(), v => cell.rotate(v, true));
}

// Shared auto-size glyph — the SAME stroke-style "fit" arrows the canvas right-click menu uses (#7), so the
// action reads identically in the sidebar and the menu. (Exported so selection.js's CTX_ICON reuses the path.)
export const AUTOSIZE_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V3h4M13 9v4H9M3 3l4 4M13 13l-4-4"/></svg>`;

export function addAutoSizeBtn(parent, onClick) {
  const btn = document.createElement('button');
  btn.className = 'df-properties__btn df-properties__btn--auto-size';
  btn.innerHTML = `${AUTOSIZE_ICON_SVG} Auto Size`;
  btn.title = 'Fit to default minimum size (or fit embedded content)';
  btn.addEventListener('click', onClick);
  parent.appendChild(btn);
}

export const TYPE_PLURALS = {
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

// The shared "standard tail" every element renderer ends with (CLEANUP V8): a Size & Order section (Width/Height
// pair, a square Diameter/Size, or width-only; + optional Auto Size / Apply-to-all / rotation) followed by the
// Bring-to-Front/Send-to-Back order buttons, then the footer's Clone/Copy/Save + the danger Delete. The Auto Size
// closure and the Delete closure were byte-identical across ~34 renderers; both are derived here from the cell's
// own type (DEFAULT_SIZES[type]) so a renderer just declares which optional pieces it wants.
//  - sizeMode: 'pair' (Width+Height) | 'square' (one value, label from squareLabel) | 'widthOnly' | 'none'
//  - sizeExtras(sizeSectionEl): callback for a renderer's own extra Size & Order fields (e.g. a Task's
//    "Description width") - runs after the Width/Height row, before Auto Size.
//  - convert: [{label, onClick}] footer convert buttons (rendered before Clone, matching current order).

export function addApplySizeBtn(parent, cell) {
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
    const peers = prctx.graph.getElements().filter(
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
    prctx.paper.updateViews();
    showToast(`Resized ${peers.length} ${peers.length === 1 ? typePlural.toLowerCase().replace(/s$/, '') : typePlural.toLowerCase()} ✓`, 'success');
  });
  parent.appendChild(btn);
}

export function addNumberWithSuffix(parent, label, value, suffix, onChange) {
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


export function addToggle(parent, label, value, onChange) {
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
export function addSegmented(parent, label, value, options, onChange, opts = {}) {
  const f = field(parent, label);
  const wrap = document.createElement('div');
  wrap.className = 'df-properties__segmented';
  if (opts.className) wrap.classList.add(opts.className);   // e.g. --compact for a 4-stop slider
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

export function addSelect(parent, label, value, options, onChange, opts = {}) {
  // Discrete control: one `change` per action. Batch onChange so a type switch that
  // also repaints multiple attrs (e.g. BpmnEvent / Gateway / SequenceFragment) is ONE
  // undo step — the type prop + every attr land together.
  onChange = asUndoBatch(onChange);
  const f = field(parent, label);
  const sel = document.createElement('select');
  sel.className = 'df-properties__select';
  // Multi-select MIXED state (opt-in): a leading disabled "Mixed" option, shown selected until the user picks a
  // real value. Keeps a differing multi-selection from reading as one concrete value. Existing single-value
  // callers omit `opts.mixed`, so their behaviour is unchanged.
  if (opts.mixed) {
    const m = document.createElement('option');
    m.value = '__mixed__'; m.textContent = 'Mixed'; m.disabled = true; m.selected = true;
    sel.appendChild(m);
  }
  options.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (!opts.mixed && opt.value === value) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => onChange(sel.value));
  f.appendChild(sel);
}

// A FREE-TEXT combobox with a filtered suggestions dropdown — pick a common value or type anything (lossless).
// Preferred over addSelect when the value set is a long open enum (e.g. Flow processType/triggerType — 35/19
// values would be an unusable picklist). Built on a `contenteditable` div, NOT an `<input>`: a contenteditable is
// not a form control, so NO browser applies its autofill overlay (the sticky, unreadable grey background Chrome
// AND Safari painted on the old <input>+datalist). `suggestions` is an array of strings; `onChange(value)` fires
// on every edit and on picking a suggestion.
let _datalistSeq = 0;
export function addTextWithSuggestions(parent, label, value, suggestions, onChange, opts = {}) {
  const f = field(parent, label);
  const uid = `df-suggest-${++_datalistSeq}`;
  const wrap = document.createElement('div');
  wrap.className = 'df-suggest';
  const box = document.createElement('div');
  box.className = 'df-properties__input df-suggest__box';
  box.contentEditable = 'true';
  box.setAttribute('role', 'combobox');
  box.setAttribute('aria-autocomplete', 'list');
  box.setAttribute('aria-expanded', 'false');
  box.setAttribute('aria-controls', `${uid}-menu`);
  box.setAttribute('spellcheck', 'false');
  box.setAttribute('aria-label', label || 'value');
  if (opts.placeholder) box.dataset.placeholder = opts.placeholder;
  box.textContent = value ?? '';

  const menu = document.createElement('div');
  menu.className = 'df-suggest__menu';
  menu.id = `${uid}-menu`;
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;

  const readVal = () => box.textContent.replace(/[\r\n]+/g, '').trim();
  let cur = value ?? '';
  const commit = () => { const v = readVal(); if (v !== cur) { cur = v; onChange(v); } };

  let itemEls = [];        // the current option divs (rebuilt on every renderMenu)
  let activeIndex = -1;    // keyboard/hover highlight; -1 = none
  const setOpen = (open) => box.setAttribute('aria-expanded', open ? 'true' : 'false');

  // Highlight one option (keyboard arrows or mouse hover share this), keep it in view, and mirror to ARIA.
  const setActive = (i) => {
    activeIndex = i;
    itemEls.forEach((el, idx) => {
      const on = idx === i;
      el.classList.toggle('df-suggest__item--active', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (itemEls[i]) { box.setAttribute('aria-activedescendant', itemEls[i].id); itemEls[i].scrollIntoView({ block: 'nearest' }); }
    else box.removeAttribute('aria-activedescendant');
  };

  const pick = (s) => { box.textContent = s; cur = s; onChange(s); menu.hidden = true; setOpen(false); activeIndex = -1; };

  // Flip the menu ABOVE the box when there isn't room below inside the scrollable panel body (whose overflow
  // would otherwise clip the lower options behind the sticky footer). Cap the height to the space it lands in.
  const placeMenu = () => {
    const clipEl = box.closest('.df-properties__body');
    const cr = clipEl ? clipEl.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const br = box.getBoundingClientRect();
    const spaceBelow = cr.bottom - br.bottom;
    const spaceAbove = br.top - cr.top;
    const want = Math.min(menu.scrollHeight, 200);          // scrollHeight = full option list, ignoring max-height
    const up = spaceBelow < want && spaceAbove > spaceBelow;
    menu.classList.toggle('df-suggest__menu--up', up);
    menu.style.maxHeight = `${Math.max(96, Math.min(200, (up ? spaceAbove : spaceBelow) - 8))}px`;
  };

  const renderMenu = () => {
    const q = readVal().toLowerCase();
    const all = suggestions || [];
    // If the box already holds an exact suggestion (a value that was picked/seeded, not a partial query), offer the
    // WHOLE list so the user can switch away from it. Otherwise filter to substring matches of what they typed.
    const exact = all.some((s) => s.toLowerCase() === q);
    const list = (!q || exact) ? all : all.filter((s) => s.toLowerCase().includes(q));
    menu.textContent = '';
    itemEls = [];
    activeIndex = -1;
    if (!list.length) { menu.hidden = true; setOpen(false); return; }
    list.forEach((s, idx) => {
      const it = document.createElement('div');
      it.className = 'df-suggest__item';
      it.id = `${uid}-opt-${idx}`;
      it.setAttribute('role', 'option');
      it.textContent = s;
      // mousedown (not click) fires BEFORE the box's blur, so the selection lands before the menu closes.
      it.addEventListener('mousedown', (e) => { e.preventDefault(); pick(s); });
      it.addEventListener('mouseenter', () => setActive(idx));
      itemEls.push(it);
      menu.appendChild(it);
    });
    menu.hidden = false;
    setOpen(true);
    placeMenu();          // choose up/down + cap height now that the options are laid out
  };

  box.addEventListener('input', () => { commit(); renderMenu(); });
  box.addEventListener('focus', renderMenu);
  box.addEventListener('blur', () => { commit(); setTimeout(() => { menu.hidden = true; setOpen(false); }, 120); });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (menu.hidden) { renderMenu(); setActive(0); }        // open + land on the first option
      else setActive(Math.min(activeIndex + 1, itemEls.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!menu.hidden) setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!menu.hidden && activeIndex >= 0 && itemEls[activeIndex]) pick(itemEls[activeIndex].textContent);
      else { menu.hidden = true; setOpen(false); box.blur(); }   // no highlight → just commit the free-text
    } else if (e.key === 'Escape') {
      menu.hidden = true; setOpen(false); box.blur();
    }
  });
  // Keep it single-line + plain: strip any rich markup / newlines on paste.
  box.addEventListener('paste', (e) => {
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData)?.getData('text')?.replace(/[\r\n]+/g, ' ') || '';
    document.execCommand('insertText', false, t);
  });

  wrap.appendChild(box);
  wrap.appendChild(menu);
  f.appendChild(wrap);
  return box;
}


export function addMarkerPicker(parent, label, current, options, svgs, onChange, opts = {}) {
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
    const opt = options.find(o => o.value === val);
    // A `current` that matches no option = a multi-select MIXED state (the selected connectors carry different
    // markers). Show "Mixed" rather than silently falling back to options[0] ("None"), which read as "all None".
    if (!opt) { btn.innerHTML = '<span>Mixed</span>'; return; }
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

export function addIconPicker(parent, label, currentHref, onChange, iconColorGetter) {
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


export function toHex(color) {
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
  // A CSS custom property `var(--x)` is NOT resolved by canvas fillStyle — resolve it against the live cascade
  // FIRST, so a theme-var default (e.g. a label's `var(--text-primary)`) shows its real colour in the picker
  // instead of falling through to #000000 (the black-swatch bug on Legend / Pill / Text label colour fields).
  const varRef = /^var\(\s*(--[\w-]+)/.exec(color);
  if (varRef) {
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(varRef[1]).trim();
    if (resolved) color = resolved;
  }
  // rgb()/rgba(), named color — resolve via canvas. Canvas returns a #rrggbb for opaque colours but an
  // `rgba(r, g, b, a)` string when alpha < 1 — pull the channels and drop alpha rather than falling through to
  // #000000 (which made a translucent fill, e.g. a Zone/Layer tint, read as black in the picker).
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

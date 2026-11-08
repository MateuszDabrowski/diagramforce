// df.Venn property renderer (1.27.0), as redesigned in owner review (2026-11-08: the first panel mixed a join's
// regions with hand-set ones, and its dependencies were hard to follow). A "Shows" switch picks one of two jobs and
// the panel shows only that job's controls:
//   Join result  Venn (Result color), Tables (colour dot + name), Query written as SQL reads (FROM sub / [INNER
//                JOIN] de / ...). Circles; the join decides every region, so there is no region list.
//   Overlaps     Venn (Highlight color), Sets (colour dot + name + a highlight box), Overlaps (each overlap's text + a
//                highlight box). Ellipses; three sets can leave the centre open.
// A set's own area shows its name in both. Every edit writes a NEW array or object, so the change event fires and
// undo records it (history CONTENT_PROPS). Reads the panel DOM via prctx; never imports the facade.
import { prctx } from './context.js?v=1.27.0';
import { finishStandardProps } from './render-core.js?v=1.27.0';
import { addColor, addNumber, addSegmented, addText, section, wireColorSwatchDrag } from './widgets.js?v=1.27.0';
import { makeFieldCheckToggle } from './field-editor.js?v=1.27.0';
import { JOINS, SET_LETTERS, regionKeys, layoutRegionKeys, regionName, setDisplayName, vennModeOf, vennShapeFor, vennGeometry, regionAt, VENN_DEFAULT_SETS, VENN_HIGHLIGHT } from '../venn-model.js?v=1.27.0';
import { vennSets } from '../shapes/venn.js?v=1.27.0';

// The join pickers. The first table pair always has a join; a later one can wait ("Not joined"), which draws step
// one of a three-table join (the result of the first join, whatever the third table holds).
const JOIN_OPTS = Object.entries(JOINS).map(([value, j]) => ({ value, label: j.label }));
const LATER_JOIN_OPTS = [...JOIN_OPTS, { value: '', label: 'Not joined' }];

// Set by a double-click on an area of the canvas (properties.js): the next render focuses that area's words - a
// set's own area its name, an overlap its text.
let focusRegion = null;
export function requestRegionFocus(key) { focusRegion = key; }

/** The region of a df.Venn under a point in the cell's own coordinates (from its top-left), or null. */
export function vennRegionAt(cell, x, y) {
  const { width: w, height: h } = cell.size();
  const shape = vennShapeFor(vennModeOf({ mode: cell.get('vennMode'), joins: cell.get('joins') }));
  const geom = vennGeometry(shape, vennSets(cell).length, w, h, { sharedCentre: cell.get('sharedCentre') !== false });
  return regionAt(x, y, geom);
}

/** Toggle an area's highlight on a Venn showing overlaps (a click on the canvas, properties.js). A join decides its
 *  own regions, so it toggles nothing. Returns whether anything changed. */
export function toggleVennHighlight(cell, key) {
  if (vennModeOf({ mode: cell.get('vennMode'), joins: cell.get('joins') }) === 'join') return false;
  const regions = cell.get('regions') || {};
  const own = { ...(regions[key] || {}) };
  if (own.fill === 'on') delete own.fill; else own.fill = 'on';
  const next = { ...regions, [key]: own };
  if (!Object.keys(own).length) delete next[key];
  cell.set('regions', next);
  return true;
}

// A set's colour as a round swatch that opens the system colour picker; a drag is one undo step, as in addColor.
function colorDot(color, onChange, title) {
  const dot = document.createElement('input');
  dot.type = 'color';
  dot.className = 'df-venn-dot';
  dot.value = color;
  dot.title = title;
  dot.setAttribute('aria-label', title);
  wireColorSwatchDrag(dot, onChange);
  return dot;
}
const staticDot = (color) => {
  const d = document.createElement('span');
  d.className = 'df-venn-dot df-venn-dot--static';
  d.style.background = color;
  return d;
};
const row = (parent, cls = '') => {
  const r = document.createElement('div');
  r.className = 'df-venn-row' + (cls ? ' ' + cls : '');
  parent.appendChild(r);
  return r;
};

export function renderVennProps(cell) {
  const sets = vennSets(cell);
  const n = sets.length;
  const mode = vennModeOf({ mode: cell.get('vennMode'), joins: cell.get('joins') });
  const isJoin = mode === 'join';
  const regions = () => cell.get('regions') || {};
  const setRegion = (key, patch) => {
    const next = { ...regions(), [key]: { ...(regions()[key] || {}), ...patch } };
    for (const k of Object.keys(next[key])) if (next[key][k] === '' || next[key][k] == null || next[key][k] === false) delete next[key][k];
    if (!Object.keys(next[key]).length) delete next[key];
    cell.set('regions', next);
  };
  // A join needs a join type for every pair but the ones left "Not joined"; entering join mode, or adding a third
  // table there, starts the missing pairs at INNER JOIN so the picture is never empty.
  const completeJoins = (count) => {
    const j = (cell.get('joins') || []).slice(0, count - 1);
    if (!j[0]) j[0] = 'inner';
    return j;
  };
  const focusKey = focusRegion;
  focusRegion = null;
  let focusEl = null;

  const vennSec = section(prctx.bodyEl, 'Venn');
  addSegmented(vennSec, 'Shows', mode, [{ value: 'join', label: 'Join result' }, { value: 'overlaps', label: 'Overlaps' }], (v) => {
    if (v === mode) return;
    cell.set(v === 'join' ? { vennMode: v, joins: completeJoins(n) } : { vennMode: v });
    prctx.refresh?.();
  });
  addSegmented(vennSec, isJoin ? 'Tables' : 'Sets', n, [{ value: 2, label: '2' }, { value: 3, label: '3' }], (v) => {
    if (v === n) return;
    const next = Array.from({ length: v }, (_, i) => ({ ...(sets[i] || VENN_DEFAULT_SETS[i]) }));
    // Overlaps that do not exist with the new count go.
    const keep = new Set(regionKeys(v));
    const kept = Object.fromEntries(Object.entries(regions()).filter(([k]) => keep.has(k)));
    const joins = (cell.get('joins') || []).slice(0, v - 1);
    if (isJoin && v === 3 && joins.length === 1) joins.push('inner');
    cell.set({ sets: next, regions: kept, joins });
    prctx.refresh?.();
  });
  // No outline choice (owner review): a join draws circles, overlaps draw ellipses. Three ellipses can leave the
  // middle open - each pair overlaps, nothing lies in all three - so overlaps of three sets get that switch.
  const shape = vennShapeFor(mode);
  // A two-option slider like Shows and Sets above it (owner review: a lone on/off switch read as a different kind).
  if (n === 3 && !isJoin) {
    addSegmented(vennSec, 'Area shared by all three', cell.get('sharedCentre') !== false ? 'show' : 'hide',
      [{ value: 'show', label: 'Show' }, { value: 'hide', label: 'Hide' }], (v) => {
        cell.set('sharedCentre', v === 'show');
        prctx.refresh?.();   // the all-three overlap comes and goes
      });
  }
  // The colour of what the Venn marks sits with the Venn, apart from the Highlight State section below (owner review).
  addColor(vennSec, isJoin ? 'Result color' : 'Highlight color', cell.get('highlightColor') || VENN_HIGHLIGHT,
    (v) => cell.set('highlightColor', v), { defaultValue: VENN_HIGHLIGHT });

  // Tables / Sets: one row each, the colour dot then the name. A name can span lines (Enter) and take **bold**. Showing
  // overlaps, a box after the name highlights the set's own area, as the Overlaps boxes do theirs. The hint sits here,
  // where the boxes and the names first appear.
  const namesSec = section(prctx.bodyEl, isJoin ? 'Tables' : 'Sets');
  const hint = document.createElement('div');
  hint.className = 'df-properties__hint df-venn-hint';
  hint.textContent = isJoin ? 'Double-click a table\'s area on the canvas to jump to its name.'
    : 'Tick a box to highlight an area. Double-click an area on the canvas to jump to its words.';
  namesSec.appendChild(hint);
  const nameInputs = [];
  sets.forEach((s, i) => {
    const r = row(namesSec);
    r.dataset.set = SET_LETTERS[i];
    r.appendChild(colorDot(s.color, (v) => cell.set('sets', vennSets(cell).map((x, j) => (j === i ? { ...x, color: v } : x))),
      `${isJoin ? 'Table' : 'Set'} ${i + 1} color`));
    nameInputs[i] = addText(r, '', s.label, (v) => cell.set('sets', vennSets(cell).map((x, j) => (j === i ? { ...x, label: v } : x))), null,
      { placeholder: `${isJoin ? 'Table' : 'Set'} ${i + 1} name` });
    nameInputs[i].setAttribute('aria-label', `${isJoin ? 'Table' : 'Set'} ${i + 1} name`);
    if (focusKey === SET_LETTERS[i]) focusEl = nameInputs[i];
    if (!isJoin) {
      const key = SET_LETTERS[i];
      r.appendChild(makeFieldCheckToggle(regions()[key]?.fill === 'on', `Highlight ${regionName(key, sets)}`, 'df-venn-overlap__mark',
        (on) => setRegion(key, { fill: on ? 'on' : null })));
    }
  });

  if (isJoin) {
    // Query: the join as SQL reads it. The table names are the ones above; edit them there.
    const q = section(prctx.bodyEl, 'Query');
    // One grid for the whole query, so FROM and every join picker share a column as wide as the longest join name
    // (with a floor for a narrow panel), and the table names take the rest (owner: the names had room to spare
    // while "FULL EXCLUDING JOIN" was cut off).
    const grid = document.createElement('div');
    grid.className = 'df-venn-query';
    q.appendChild(grid);
    const tableCell = (i) => {
      const cellEl = document.createElement('span');
      cellEl.className = 'df-venn-query__name';
      cellEl.appendChild(staticDot(sets[i].color));
      const name = document.createElement('span');
      name.className = 'df-venn-query__table';
      name.textContent = String(sets[i].label || '').trim() ? setDisplayName(sets, i) : `Table ${i + 1}`;
      cellEl.appendChild(name);
      grid.appendChild(cellEl);
    };
    const kw = document.createElement('span');
    kw.className = 'df-venn-query__kw';
    kw.textContent = 'FROM';
    grid.appendChild(kw);
    tableCell(0);
    const joins = cell.get('joins') || [];
    for (let i = 1; i < n; i++) {
      const sel = document.createElement('select');
      sel.className = 'df-properties__select df-venn-query__join';
      sel.setAttribute('aria-label', `Join with ${setDisplayName(sets, i)}`);
      for (const o of (i === 1 ? JOIN_OPTS : LATER_JOIN_OPTS)) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        opt.selected = (joins[i - 1] || (i === 1 ? 'inner' : '')) === o.value;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => {
        const next = Array.from({ length: n - 1 }, (_, j) => (j === i - 1 ? sel.value : (cell.get('joins') || [])[j] || ''));
        while (next.length && !next[next.length - 1]) next.pop();   // only the joins picked so far, in order
        cell.set('joins', next);
      });
      grid.appendChild(sel);
      tableCell(i);
    }
  } else {
    // Overlaps: each overlap's text and a box that highlights it. A set's own area is its name, above.
    const o = section(prctx.bodyEl, 'Overlaps');
    for (const key of layoutRegionKeys(shape, n, cell.get('sharedCentre')).filter((k) => k.length > 1)) {
      const r = regions()[key] || {};
      const line = row(o, 'df-venn-overlap');
      line.dataset.region = key;
      const dots = document.createElement('span');
      dots.className = 'df-venn-dots';
      dots.title = regionName(key, sets);
      for (const l of key) dots.appendChild(staticDot(sets[SET_LETTERS.indexOf(l)].color));
      line.appendChild(dots);
      const input = addText(line, '', r.label || '', (v) => setRegion(key, { label: v }), null, { placeholder: 'Text' });
      input.setAttribute('aria-label', `${regionName(key, sets)} text`);
      if (focusKey === key) focusEl = input;
      line.appendChild(makeFieldCheckToggle(r.fill === 'on', `Highlight ${regionName(key, sets)}`, 'df-venn-overlap__mark',
        (on) => setRegion(key, { fill: on ? 'on' : null })));
    }
  }
  if (focusEl) requestAnimationFrame(() => { focusEl.scrollIntoView({ block: 'center' }); focusEl.focus(); });

  finishStandardProps(cell, { sizeMode: 'pair', sizeExtras: (s) => {
    addNumber(s, 'Font size', cell.get('fontSize') ?? 14, (v) => cell.set('fontSize', v), { min: 8, max: 72 });
  } });
}

// Flow Table view - the stacked-sections READ-ONLY render (1.22.2, extracted from table-view.js).
// Five sibling tables inside the shared scroller: the Elements spine (every flow element in execution
// order), Data Writes, the written-by-more-than-one-element field pivot, Decision Elements, and Assets
// (the marketing references, element-first - one row per element+reference, in execution order). Reads
// the live graph + the facade's icons via initFlowTable; never imports table-view.js back (acyclic,
// same rule gantt-plan.js states).
//
// WHY a sibling module and not another arm of table-view.js render(): that function interleaves the
// field/gantt EDIT-session markup per cell (renderEditableCell / cellChanged / revertCell / actCell are
// called inline), and flow `details` are import-only by design - there is no session to render and none
// to protect. It early-returns here instead, which also means the mapping-only `df-tbl__row--unmapped`
// rule and the schemaOf() markdown fallback are unreachable from flow rather than needing a flow arm.
//
// WHY N sibling tables and not one merged table with injected header rows: a single <table> computes
// ONE column grid, so Decision Elements' 5 columns would be forced to align under Data Writes' 7 -
// "Outcome" under "Op", same widths. That is the wrong table, not a styling nit.
import { escHtml, sanitizeFilenamePart, toMarkdownTable } from '../util.js?v=1.23.1';
import { getActiveTabName } from '../tabs.js?v=1.23.1';
import { triggerDownload } from '../persistence.js?v=1.23.1';
import { showToast, showError } from '../feedback.js?v=1.23.1';
import {
  buildFlowSections, sortRows, suppressColumns, exportCellText, flowFactsRows, flowResourceRows,
  parseFilter, rowMatchesFilter, FILTER_TITLE, FILTER_TITLE_INVALID,
} from './builders.js?v=1.23.1';
// The filter's aria-live result count rides the app's sr-only region (a11y.js imports only
// properties.js + util.js - no cycle). Called ONLY from the debounced input handler, never from
// renderFlowTable, so graph-change re-renders stay silent.
import { announce } from '../a11y.js?v=1.23.1';
// Click-to-focus (post-1.22.2): a row's nav button -> its element on the canvas. selectOnly is the same public
// call a canvas click lands on (selection.js's own pointer handler uses it), and cctx carries
// fitToCells, the frame-these-cells helper diagram-check.js uses. Both are acyclic from here:
// nothing in either chain imports the table-view modules back.
import { selectOnly } from '../selection.js?v=1.23.1';
import { cctx } from '../canvas/context.js?v=1.23.1';

export const FLOW_TABLE_TITLE = 'Flow Details';

// ── Injected context (wired by table-view.init → initFlowTable). The icons are `const`s in
// table-view.js; importing them back would be the cycle this module forbids, so they are passed in. ──
let graph = null, container = null, icons = {};
export function initFlowTable(ctx) {
  graph = ctx.graph;
  container = ctx.container;
  icons = ctx.icons || {};
}

// Per-SECTION sort, so a click on Decision Elements' "Outcome" cannot silently reorder Data Writes by a key it
// has no column for (sortRows would compare String(undefined ?? '') on every row: an arrow-less no-op
// the user reads as a broken sort). Correct by construction - section ids are fixed and column keys are
// unique per section - so no reset is needed on a tab or mode change, and the cross-mode sort-key bleed
// that exists in table-view.js cannot reach flow, which never reads it.
let _sort = new Map();          // gridId -> { key, dir }
// Deliberately NOT the facade's _showAllCols: this module must never import table-view.js back. One
// preference across all five sections is the correct semantic within flow.
let _showAllCols = false;
// Per-section collapse (the stencil's category-header language, on the tier1 band). Module-scoped and
// NEVER reset, for _sort's reason above: section ids are fixed, so the state stays correct by
// construction across tab and mode switches, and a collapsed band SAYS so on screen (rotated chevron,
// with the band's always-on insight still stating what it holds) - unlike a stale filter query, which
// hides rows silently and therefore DOES reset.
// Collapse is a VIEWING aid, not a row-selection contract: the exports read _lastGrids, never the
// DOM, so a collapsed section still exports in full - unlike the filter, whose narrowing is a stated
// export contract. The two compose: filtered rows of a collapsed section export per the filter.
let _collapsed = new Set();     // section ids ('elements' | 'writes' | 'contested' | 'decisions' | 'assets')
let _lastGrids = [];            // the rendered { id, title, cols, rows } - feeds CSV + Markdown
// ── Filter + Search (post-1.22.2) ── ONE query filters every section independently. Deliberately
// NOT the facade's _filterQuery (this module never imports table-view.js back); the facade's graph
// `reset` hook calls resetFlowTableFilter so both clear on the same signal - a stale query would
// silently hide rows of a diagram it was never typed against.
let _filterQuery = '';
let _filterTimer = null;        // the 120 ms debounce (the stencil search precedent, Gap 28)
let _filterAnnounced = false;   // last announcement had an active query -> clearing announces once

export function resetFlowTableFilter() {
  clearTimeout(_filterTimer);
  _filterTimer = null;
  _filterQuery = '';
  _filterAnnounced = false;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;

function toggleFlowSort(gridId, key) {
  const cur = _sort.get(gridId);
  if (cur && cur.key === key) {
    if (cur.dir === 'asc') _sort.set(gridId, { key, dir: 'desc' });
    else _sort.delete(gridId);            // asc -> desc -> unsorted, matching the other modes
  } else {
    _sort.set(gridId, { key, dir: 'asc' });
  }
  renderFlowTable();
}

// The stencil's category chevron, the same glyph ("like sections in the stencil" is the spec): points
// DOWN when expanded, CSS rotates it -90deg to point right when the table carries --collapsed.
const SEC_CHEVRON = `<svg class="df-tbl__sec-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function tableHtml(g) {
  const cols = g.cols;
  const collapsed = _collapsed.has(g.id);
  // The whole band is the toggle - the stencil's whole category header is, and a full-width coloured
  // strip is a generous target. role=button + tabindex + Enter/Space is the sortable-th pattern
  // below. The chevron renders on EVERY paint, expanded or not, rows or none: section geometry must
  // never differ between an empty and a populated paint of the same mode (the filter input learned
  // that the measured way), so only a user toggle may change the band, never a render.
  // The empty seccount span is the slot paintSeccount fills in place - the filter's " · N of M"
  // while a query is active, the section's structural insight otherwise - without a re-render
  // (which would drop the filter input's focus mid-typing).
  // Every colspan below is cols.length + 1: the nav column (the click-to-focus buttons) is CHROME
  // stamped by this function alone - it has no column def, so it can never leak into the filter
  // haystack (rowMatchesFilter reads g.cols), C2 suppression (suppressColumns reads the declared
  // set) or either export (both read g.cols/g.allCols) - but it IS a real rendered column the
  // band, the empty line and the no-matches line must all span.
  const tier1 = `<tr class="df-tbl__sections"><th colspan="${cols.length + 1}" class="df-tbl__sec df-tbl__sec--mdl" data-sec="${escHtml(g.id)}" role="button" tabindex="0" aria-expanded="${!collapsed}" title="Collapse or expand this section">${SEC_CHEVRON}${escHtml(g.title)}<span class="df-tbl__seccount"></span></th></tr>`;
  // The nav column's header th stays EMPTY: the column is chrome, not data - nothing to label,
  // nothing to sort.
  const tier2 = `<tr class="df-tbl__cols"><th class="df-tbl__nav"></th>${cols.map(c => {
    const sorted = g.sort.key === c.key;
    const cls = ((c.sortable ? ' df-tbl__th--sortable' : '') + (sorted ? ' df-tbl__th--sorted' : '')).trim();
    const arrow = sorted ? `<span class="df-tbl__sort-ind">${g.sort.dir === 'desc' ? '▼' : '▲'}</span>` : '';
    // data-grid rides ALONGSIDE data-sort so the existing `[data-sort="…"]` e2e selectors still match.
    const attr = c.sortable ? ` data-grid="${escHtml(g.id)}" data-sort="${escHtml(c.key)}" role="button" tabindex="0"` : '';
    return `<th class="${cls}"${attr}>${escHtml(c.label)}${arrow}</th>`;
  }).join('')}</tr>`;
  const body = g.rows.length
    ? g.rows.map(r => {
        // Click-to-focus, second design (owner-directed): the affordance is an explicit icon-only
        // BUTTON in a dedicated first cell, not the whole-row handler the first design shipped - a
        // click anywhere on a row yanking the reader to the canvas was too easy to hit mid-read,
        // with no way back. Only a row carrying a SINGLE element identity (_elId - the spine,
        // writes, decisions and assets rows, muted rows included) gets the button; the pivot's
        // rows name N elements each, so their nav cell renders EMPTY rather than not at all - the
        // section-geometry rule that killed the per-row affordance in the first design is exactly
        // what keeps this per-column one honest: the cell exists on every paint of every row. A
        // real <button> also gives the keyboard the path the row version deliberately punted on
        // (Tab reaches it, Enter/Space fire it, a screen reader hears the aria-label instead of a
        // flattened tr[role=button]). data-el stays on the TR as well: it is the row anchor the
        // properties panel's "Show in Table view" return path scrolls back to.
        const nav = r._elId
          ? `<button type="button" class="df-tbl__navbtn" data-el="${escHtml(String(r._elId))}" aria-label="Show on the diagram" title="Show on the diagram">${icons.diagram || ''}</button>`
          : '';
        const anchor = r._elId ? ` data-el="${escHtml(String(r._elId))}"` : '';
        return `<tr${anchor}><td class="df-tbl__nav">${nav}</td>${cols.map(c => {
        const cls = ((c.center ? ' df-tbl__center' : '') + (c.wrap ? ' df-tbl__cell--wrap' : '')).trim();
        const raw = String(r[c.key] ?? '');
        // A `+N more` truncation row is NOT a field write, and a trailing connector row is not an
        // imported outcome. Dimmed + italic via the existing placeholder span so neither can be misread
        // as one - a "+3 more" rendered plain invents a field with that name.
        const val = r._muted ? `<span class="df-tbl__placeholder">${escHtml(raw)}</span>` : escHtml(raw);
        return `<td class="${cls}">${val}</td>`;
      }).join('')}</tr>`;
      }).join('')
    : `<tr><td colspan="${cols.length + 1}" class="df-tbl__empty">${escHtml(g.empty)}</td></tr>`;
  // The modifier hides the tier2 column row + tbody TOGETHER via CSS (canvas.css) - the band alone
  // stays. Hiding at the table level, not per row, is what keeps collapse orthogonal to the filter's
  // per-row `hidden`: neither writes the other's state, so they can never fight.
  return `<table class="df-tbl__table${collapsed ? ' df-tbl__table--collapsed' : ''}" data-grid="${escHtml(g.id)}"><thead>${tier1}${tier2}</thead><tbody>${body}</tbody></table>`;
}

// ONE home for the band text, so render, the filter pass and the collapse toggle can never disagree.
// An active query paints " · N of M" on every section it filters, COLLAPSED OR NOT - a collapsed
// section must keep saying how much of it matches. Otherwise the band carries its section's structural
// INSIGHT - the counts the retired topbar note line carried, now living on the band they describe (one
// fact, one home) - expanded or collapsed and even at zero: a collapsed zero section must stay honest,
// and consistency beats prettiness. The insight subsumes the old collapsed-only row count: a band that
// always says "192 writes across 14 elements" needs no separate " · N rows".
function paintSeccount(g, count) {
  count.textContent = g._matches ? ` · ${g._matches.length} of ${g.rows.length}` : ` · ${g.insight}`;
}

// Toggling flips the DOM in place rather than re-rendering: a re-render would drop keyboard focus
// from the band mid-Enter (the same reason the filter pass never re-renders), and the in-place flip
// composes with the filter for free - collapse hides the tbody wholesale while the per-row `hidden`
// underneath stays untouched, so expanding while a query is active reveals exactly the FILTERED rows.
function toggleFlowSection(th) {
  const id = th.getAttribute('data-sec');
  if (_collapsed.has(id)) _collapsed.delete(id); else _collapsed.add(id);
  const collapsed = _collapsed.has(id);
  th.closest('table').classList.toggle('df-tbl__table--collapsed', collapsed);
  th.setAttribute('aria-expanded', String(!collapsed));
  // No seccount repaint: the band's text (the insight, or the filter's " · N of M") reads the same
  // collapsed or expanded, which is exactly what lets a collapsed band stay honest with zero work here.
}

export function renderFlowTable() {
  if (!container || !graph) return;
  const built = buildFlowSections(graph);
  const { elementCount, writeCount, writeElementCount, contestedCount, decisionCount, outcomeCount, assetRefCount, assetElementCount } = built;
  // Each band carries ITS OWN insight - the counts the retired topbar note line carried, in the same
  // grain wording, now sitting on the section they describe (one fact, one home). Honest and
  // consistent even at zero, rather than blank: a collapsed zero band must still say " · 0 writes
  // across 0 elements". The pivot's wording drops the "written by more than one element" tail its
  // band title already states. The element count leads on the spine because the spine does.
  const insights = {
    elements: plural(elementCount, 'element'),
    writes: `${plural(writeCount, 'write')} across ${plural(writeElementCount, 'element')}`,
    contested: plural(contestedCount, 'field'),
    // 'decisions' stays the counted noun although the band now reads 'Decision Elements': the
    // insight counts decisions, and 'across K decision elements' would be wordier, not clearer.
    decisions: `${plural(outcomeCount, 'outcome')} across ${plural(decisionCount, 'decision')}`,
    // The writes shape, on the element-first grain: references = the section's rendered rows, so the
    // band and the row count always agree (the filter's "N of M" reads M off the same rows).
    assets: `${plural(assetRefCount, 'asset reference')} across ${plural(assetElementCount, 'element')}`,
  };
  const grids = built.sections.map(sec => {
    const sort = _sort.get(sec.id) || { key: null, dir: 'asc' };
    const rows = sortRows(sec.rows, { sortKey: sort.key, sortDir: sort.dir });
    // C2 suppression runs PER SECTION on the sorted rows; `hidden` is the sum across sections and
    // drives the Show-All-Columns gate. On a flow with no imported apiNames the apiName columns vanish.
    const sup = suppressColumns(sec.columns, rows);
    // A section whose every cell is blank (a hand-drawn, unnamed decision with unlabelled branches)
    // would suppress to zero columns and emit colspan="0" - keep the declared set instead.
    const cols = (_showAllCols || !sup.cols.length) ? sec.columns : sup.cols;
    // When the zero-column guard above fires, the measurement was DISCARDED - counting its `hidden`
    // anyway made the toggle announce "5 all-blank columns hidden" while all 5 were on screen, and
    // clicking it changed nothing. `allCols` carries the DECLARED set for the CSV (below).
    return { id: sec.id, title: sec.title, empty: sec.empty, rows, cols, allCols: sec.columns, hidden: sup.cols.length ? sup.hidden : 0, sort, insight: insights[sec.id] };
  });
  _lastGrids = grids;
  const hidden = grids.reduce((n, g) => n + g.hidden, 0);

  // Stacked near-identical apologies read as a broken view; one honest line does not. The topbar
  // (title + filter + buttons) still renders, so the view is visibly complete rather than truncated. Since the
  // spine lists EVERY df.Flow* element, allEmpty now means a genuinely element-free canvas - a flow
  // with elements but no writes/decisions renders the spine plus the per-section empty lines instead.
  const allEmpty = grids.every(g => !g.rows.length);
  const payload = allEmpty
    ? `<table class="df-tbl__table" data-grid="empty"><tbody><tr><td class="df-tbl__empty">Nothing to document yet - this view lists a flow's elements, what they write and how they branch, and this canvas has no flow elements. Import a Flow from the Save menu, or add elements from the palette.</td></tr></tbody></table>`
    : grids.map(tableHtml).join('');

  const colsBtn = (hidden > 0 || _showAllCols)
    ? `<button type="button" id="tbl-show-cols" class="df-toolbar__menu-item df-toolbar__menu-item--icon df-toolbar__menu-item--toggle df-tbl__toggle${_showAllCols ? ' is-checked' : ''}" title="${hidden ? `${plural(hidden, 'all-blank column')} hidden - toggle the full column set` : 'Showing the full column set'}">${icons.check || ''}Show All Columns</button>`
    : '';
  // In model mode the right-edge push rides the Edit button, which flow does not render (read-only), so
  // it moves to Copy as Markdown - colsBtn stays left, Copy + CSV push right.
  // Both are suppressed on an all-empty flow: they would emit five header-only GFM tables and five
  // title+header CSV blocks in exactly the state the message above describes as having nothing.
  const mdBtn = allEmpty ? '' : `<button type="button" id="tbl-md" class="df-tbl__csv df-tbl__push" title="Copy every section as a Markdown table - paste into Confluence, Jira, Notion or GitHub">${icons.copy || ''}<span>Copy as Markdown</span></button>`;
  const csvBtn = allEmpty ? '' : `<button type="button" id="tbl-csv" class="df-tbl__csv" title="Export every section as one CSV file">${icons.download || ''}<span>Export Flow to CSV</span></button>`;
  // The input renders on EVERY paint - DISABLED when all-empty, never absent. It shared the export
  // buttons' absent-when-empty gate at first, and that class of gate is a measured flake source: the
  // grid twin's rows-gated input shifted every button right of it between an empty first paint and
  // the populated 80 ms re-render, landing coordinate clicks on nothing (1-2 per 65 firefox runs;
  // unconditional = 130/130). Topbar geometry must not change between paints of the same mode. The
  // export buttons stay gated - they sit at the topbar's far right, where appearing shifts nothing
  // that a test or a user is mid-click on. ONE query, applied to every section independently.
  const filterHtml = `<input type="search" id="tbl-filter" class="df-tbl__filter" placeholder="Filter rows" aria-label="Filter table rows" title="${escHtml(FILTER_TITLE)}" value="${escHtml(_filterQuery)}"${allEmpty ? ' disabled' : ''} />`;

  container.innerHTML = `<div class="df-tbl">
      <div class="df-tbl__topbar">
        <h2 class="df-tbl__title">${FLOW_TABLE_TITLE}</h2>
        ${filterHtml}
        ${colsBtn}${mdBtn}${csvBtn}
      </div>
      <div class="df-tbl__scroll"><div class="df-tbl__stack">${payload}</div></div>
    </div>`;
  alignSectionWidths();

  container.querySelector('#tbl-show-cols')?.addEventListener('click', () => { _showAllCols = !_showAllCols; renderFlowTable(); });
  container.querySelector('#tbl-csv')?.addEventListener('click', exportFlowCsv);
  container.querySelector('#tbl-md')?.addEventListener('click', copyFlowMarkdown);
  container.querySelectorAll('.df-tbl__th--sortable').forEach(th => {
    const go = () => toggleFlowSort(th.getAttribute('data-grid'), th.getAttribute('data-sort'));
    th.addEventListener('click', go);
    th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  // The section bands: same click + Enter/Space wiring as the sortable ths above. Scoped on
  // [data-sec] so the all-empty single-table state (which has no sections, hence no bands) wires zero.
  container.querySelectorAll('.df-tbl__sec[data-sec]').forEach(th => {
    const go = () => toggleFlowSection(th);
    th.addEventListener('click', go);
    th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  // Click-to-focus: the per-row nav BUTTONS tableHtml stamped - never the rows, which stay inert
  // by design: reading, selecting and drag-to-copy across cells must not be able to leave the
  // view by accident (the first design's whole-row handler was, owner-reported). The old
  // drag-select swallow retires with that handler - a discrete button cannot be hit by the tail
  // of a text drag. Enter/Space come free with <button>, unlike the role=button ths above.
  container.querySelectorAll('.df-tbl__navbtn').forEach(b => {
    b.addEventListener('click', () => focusFlowElement(b.getAttribute('data-el')));
  });
  const filterEl = container.querySelector('#tbl-filter');
  filterEl?.addEventListener('input', () => {
    // The query is written IMMEDIATELY (a graph-change re-render must paint the correct value=);
    // only the row pass + the announcement are debounced.
    _filterQuery = filterEl.value;
    clearTimeout(_filterTimer);
    _filterTimer = setTimeout(() => {
      const r = applyFlowFilter();
      if (r.active) { announce(`${r.n} of ${r.m} rows match across ${plural(r.s, 'section')}`); _filterAnnounced = true; }
      else if (_filterAnnounced) { announce('Filter cleared'); _filterAnnounced = false; }
    }, 120);
  });
  // Re-apply the surviving query after ANY re-render (per-section sort, Show All Columns, graph
  // change) - silently: only the debounced handler above may announce.
  applyFlowFilter();
}

// ── Section widths: five tables, one right edge ─────────────────────────────
// Each section is its own <table> (a single merged one would force Decision Elements' 5 columns to
// align under Data Writes' 7 - the reason the sections are siblings at all), and each is width:100%.
// The catch: percentage width resolves against the SCROLLER'S VISIBLE box, never its scrollWidth. So
// the moment one table overflows - the Elements spine at 1424px once the wrap columns got their
// min-width floor - the other four stay at the ~676px viewport and the stack renders ragged, each
// section ending at a different x.
//
// Fix: pin the stack to the WIDEST table's rendered width, then width:100% resolves against that for
// every section. `min-width`, not `width`, so a window resize past it hands sizing back to normal
// block layout instead of leaving a gap - no resize listener needed. Measured AFTER the innerHTML
// write and BEFORE the render-end applyFlowFilter, because hiding rows can only ever shrink a
// table's natural width: measuring with every row present makes the pin an upper bound that stays
// correct while the user filters or collapses. One extra reflow per render, none per keystroke.
// The one-frame catch, found by measuring rather than reasoning: table-view.js show() calls render()
// and only THEN clears container.hidden, so at render time every table measures offsetWidth 0 and a
// naive pin would silently store nothing. Measure now when the view is already up (a sort click, a
// graph change, a collapse), and otherwise retry ONCE on the next frame, by which time show() has
// un-hidden the container. Bounded to a single retry on purpose: a render that happens while the user
// sits on the Diagram view leaves the table unpinned rather than scheduling a frame callback forever,
// and the next real render pins it.
function alignSectionWidths(retry = true) {
  const stack = container?.querySelector('.df-tbl__stack');
  if (!stack) return;
  stack.style.minWidth = '';                      // re-measure from scratch, never off the last pin
  const tables = [...stack.querySelectorAll('.df-tbl__table')];
  if (tables.length < 2) return;                  // the all-empty single-table state needs no pinning
  const widest = Math.max(...tables.map(t => t.offsetWidth));
  if (widest > 0) { stack.style.minWidth = `${widest}px`; return; }
  if (retry) requestAnimationFrame(() => alignSectionWidths(false));
}

// ── Click-to-focus (post-1.22.2): a row's nav button -> its element on the canvas ──
// The table states facts ABOUT an element; the canvas holds it. This flip cashes in the _elId the
// spine build stamped as "the v2 click-to-focus hook", reusing the app's own idioms end to end:
// the view switch CLICKS #btn-view-diagram (the exact mirror of app.js's setRequestTableView, which
// clicks #btn-view-table - neither module may import the toolbar), selection goes through
// selection.js selectOnly (the same call a canvas pointerdown lands on, so the properties panel
// opens identically), and the framing is cctx.fitToCells - the helper diagram-check.js uses to
// frame the loose connectors it highlights. Selection and viewport are RUNTIME state: nothing here
// writes a cell prop, so a save after a focus is byte-identical to one before it.
function focusFlowElement(elId) {
  const el = graph?.getCell?.(elId);
  if (!el) return;   // deleted between paint and click - the 80 ms rerender is about to drop the row
  // Switch FIRST: fitToCells frames against paper.el's live rect, and the selection halo needs the
  // paper visible to be worth drawing - framing a hidden canvas and then revealing it works too,
  // but ordering it this way keeps the sequence readable as what it is: leave, select, frame.
  document.getElementById('btn-view-diagram')?.click();
  selectOnly(elId);
  cctx.fitToCells?.(el.getBBox());
}

// ── Filter + Search: the visibility pass ────────────────────────────────────
// The same pure-DOM contract as the facade's applyFilter (see table-view.js for the full why): a
// re-render would destroy the input mid-typing, so render emits every row and this toggles `hidden`
// in place. Per section: the haystack is that section's RENDERED g.cols, the seccount reads
// " · N of M", a filtered-to-zero section gets a lazy no-matches line that QUOTES the query (the
// structural empty copy never does), and a structurally-empty section keeps its structural line
// untouched and its band its structural INSIGHT (" · 0 of 0" is noise; " · 0 writes across 0
// elements" is the honest structural fact). The insights are never re-based by a query - the filter
// paints " · N of M" in their place, and clearing restores the insight, never a blank band.
function applyFlowFilter() {
  const inert = { active: false, n: 0, m: 0 };
  if (!container) return inert;
  const input = container.querySelector('#tbl-filter');
  if (!input) { for (const g of _lastGrids) g._matches = null; return inert; }
  const matcher = parseFilter(_filterQuery);
  input.classList.toggle('df-tbl__filter--invalid', !!matcher.invalid);
  if (matcher.invalid) { input.setAttribute('aria-invalid', 'true'); input.title = FILTER_TITLE_INVALID; }
  else { input.removeAttribute('aria-invalid'); input.title = FILTER_TITLE; }
  let n = 0, m = 0, s = 0;   // s = sections that PARTICIPATE (have structural rows) - the announcement must not claim the excluded ones
  for (const g of _lastGrids) {
    const table = container.querySelector(`table[data-grid="${g.id}"]`);   // fixed section ids - no escaping needed
    if (!table) continue;
    const tbody = table.querySelector('tbody');
    const count = table.querySelector('.df-tbl__seccount');
    let nomatch = tbody.querySelector('.df-tbl__nomatch');
    const trs = [...tbody.querySelectorAll('tr:not(.df-tbl__nomatch)')];
    if (matcher.empty || !g.rows.length) {
      trs.forEach(tr => { tr.hidden = false; });
      nomatch?.remove();
      g._matches = null;
      // Not a bare clear: paintSeccount repaints the structural insight (it owns the precedence),
      // so clearing the query restores the insight rather than blanking the band into silence.
      if (count) paintSeccount(g, count);
      continue;
    }
    s += 1;
    const matched = [];
    trs.forEach((tr, i) => {
      const row = g.rows[i];   // tableHtml emits g.rows in order, 1:1 with the body <tr>s
      const hit = !!row && rowMatchesFilter(row, g.cols, matcher);
      tr.hidden = !hit;
      if (hit && row) matched.push(row);
    });
    g._matches = matched;
    n += matched.length;
    m += g.rows.length;
    if (count) paintSeccount(g, count);   // " · N of M" - painted collapsed or not, by design
    if (!matched.length) {
      // Lazy, like the facade's: never emitted by render, so tbody row counts stay structural.
      if (!nomatch) {
        nomatch = document.createElement('tr');
        nomatch.className = 'df-tbl__nomatch';
        nomatch.appendChild(Object.assign(document.createElement('td'), { className: 'df-tbl__empty df-tbl__nomatch-cell' }));
        tbody.appendChild(nomatch);
      }
      const td = nomatch.querySelector('td');
      td.colSpan = (g.cols.length || 1) + 1;   // + 1 spans the nav chrome column too
      td.textContent = `No matches for "${_filterQuery.trim()}" in this section.`;   // textContent - no injection path
    } else {
      nomatch?.remove();
    }
  }
  return { active: !matcher.empty, n, m, s };
}

// tableHtml dims a `_muted` row so it cannot be read as data - a `+N more` cap row is not a field write,
// and a trailing connector row is not an imported outcome. That marker is CSS, and CSS survives neither a
// CSV cell nor a pasted Markdown row, so without this the flat forms assert exactly what the render
// refuses to: a field literally named "+3 more", and a canvas-only branch indistinguishable from an
// outcome the Flow declared. The note rides the row's IDENTITY column, so the row count and the declared
// column set both stay untouched.
const MUTED_NOTE = {
  writes: { key: 'field', note: '(not a field - further rows not shown, see the property panel)' },
  decisions: { key: 'outcome', note: '(from the canvas, not the imported outcome list)' },
};
const flatRow = (g, r, cols) => {
  const mark = r._muted ? MUTED_NOTE[g.id] : null;
  return cols.map(c => {
    // exportCellText applies the column's `exportJoin` (the spine's Previous/Next list-to-'; '
    // conversion) - the DOM keeps the newline list, the flat forms must stay one-line greppable.
    const v = exportCellText(c, r[c.key]);
    return (mark && c.key === mark.key) ? `${v} ${mark.note}`.trim() : v;
  });
};

// ONE file, one titled block per section separated by a blank line. Multiple triggerDownload calls get
// blocked by browsers, and five disjoint column sets have no valid flat form. A BOM keeps Excel honest about UTF-8;
// the multi-line writers cell is quoted like any other cell containing a newline.
//
// The CSV exports the DECLARED column set, not the C2-thinned one: every sibling mode does
// (exportRowsCsv defaults to COLUMNS, gantt passes GANTT_COLUMNS, model rebuilds via
// buildObjectSchemaCsv), and data-model-and-mapping.md states it - the CSV holds the full column
// contract, Copy as Markdown follows the VISIBLE set. A column that vanishes from a downstream file
// because it happened to be blank in this diagram breaks every consumer parsing by position.
// An ACTIVE filter narrows the export to the matched rows (export-what-you-see, the same contract
// as every sibling mode - see table-view.js exportCsv) and the `_filtered` filename suffix says so.
// `g._matches` is an ARRAY whenever a query is active ([] on a filtered-to-zero section - truthy,
// so the section block emits title + header and no rows, honestly); null when no query.
const filterActive = () => _lastGrids.some(g => g._matches);

function exportFlowCsv() {
  const esc = v => {
    const s = String(v ?? '').trim();
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // The identity header: the __flowmeta card's facts LEAD the file, in the same title+header+rows
  // block shape as the sections below, so the CSV can say which flow, status and version it
  // documents once it leaves the app - the canvas card does not travel with a .csv. The
  // __flowresources card follows on exactly the same terms (2026-08-15, the follow-up the facts
  // build named): the element rows keep referring to formulas, templates and variables the file
  // otherwise never defines. Fixed order Facts -> Resources -> sections: identity first, glossary
  // second, data last. Both are IDENTITY, not data selection: an active filter narrows ROWS, so
  // both cards export in full either way, and the `_filtered` filename suffix keeps describing the
  // row selection only. A flow missing either card (hand-drawn) exports without that block - no
  // empty headers. On screen both stay canvas cards, deliberately: the killed restatement must not
  // return through this file.
  const facts = flowFactsRows(graph);
  const factsBlock = facts.length
    ? [esc('Flow Facts'), 'Fact,Value', ...facts.map(r => r.map(esc).join(','))].join('\r\n')
    : null;
  const resources = flowResourceRows(graph);
  const resourcesBlock = resources.length
    ? [esc('Flow Resources'), 'Resource,Description', ...resources.map(r => r.map(esc).join(','))].join('\r\n')
    : null;
  const blocks = _lastGrids.map(g => [
    esc(g.title),
    g.allCols.map(c => esc(c.csv || c.label)).join(','),
    ...(g._matches || g.rows).map(r => flatRow(g, r, g.allCols).map(esc).join(',')),
  ].join('\r\n'));
  const parts = [factsBlock, resourcesBlock, ...blocks].filter(Boolean);
  const blob = new Blob(['﻿' + parts.join('\r\n\r\n')], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(URL.createObjectURL(blob), `df_${sanitizeFilenamePart(getActiveTabName(), 'tab')}_flow${filterActive() ? '_filtered' : ''}.csv`);
}

// toMarkdownTable already emits `### <title>`, escapes the pipes flow filter logic contains, and turns
// newlines into <br> so the multi-writer cell stays one GFM row.
function copyFlowMarkdown() {
  // The identity header, mirrored from the CSV above: a `### Flow Facts` table leads the paste so
  // the wiki page states which flow it documents, and `### Flow Resources` follows it on the same
  // terms (the glossary for everything the section rows reference). Same IDENTITY-not-selection
  // contract - an active filter narrows rows, never these cards, and the toast's N-of-M below
  // keeps counting ROWS only.
  const facts = flowFactsRows(graph);
  const factsMd = facts.length ? toMarkdownTable(['Fact', 'Value'], facts, 'Flow Facts') : '';
  const resources = flowResourceRows(graph);
  const resourcesMd = resources.length ? toMarkdownTable(['Resource', 'Description'], resources, 'Flow Resources') : '';
  const md = [factsMd, resourcesMd, ..._lastGrids
    .map(g => toMarkdownTable(g.cols.map(c => c.csv || c.label), (g._matches || g.rows).map(r => flatRow(g, r, g.cols)), g.title))]
    .filter(Boolean).join('\n\n');
  if (!md) { showError('There is nothing to copy yet.'); return; }
  if (!navigator.clipboard?.writeText) { showError('Clipboard copy is not available in this browser.'); return; }
  // The toast carries the N-of-M while filtered so a partial paste can never masquerade as whole.
  const toastMsg = filterActive()
    ? `Copied as Markdown (${_lastGrids.reduce((s, g) => s + (g._matches || g.rows).length, 0)} of ${_lastGrids.reduce((s, g) => s + g.rows.length, 0)} rows, filtered) - paste into Confluence, Jira, Notion or GitHub ✓`
    : 'Copied as Markdown - paste into Confluence, Jira, Notion or GitHub ✓';
  navigator.clipboard.writeText(md)
    .then(() => showToast(toastMsg, 'success'))
    .catch(() => showError('Could not copy to the clipboard.'));
}

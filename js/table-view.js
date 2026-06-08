// Data Mapping — table view (Phase 2 overhaul + CR refinements).
//
// A strictly READ-ONLY spreadsheet projection of the graph that mirrors the official
// CSV/Excel mapping contract. Grain = ONE row per active mapping link (linkKind
// 'mapping'); a source field mapped to N targets denormalises to N rows. Optional
// "Show Unmapped Fields" (on by default) appends a row per field with zero
// connections (blank target section). All editing stays on the canvas — the table
// never mutates the graph.
//
// Layout: a single wide <table> in an overflow-x:auto scroller, with a two-tier
// header — a blue "Data Objects" section (source columns) and an orange "Data Object
// Relationship" section (target columns). Headers are click-to-sort; the topbar
// carries a CSV export button and the Show/Hide-Unmapped toggle.
import { escHtml, sanitizeFilenamePart } from './util.js?v=1.15.6';
import { getActiveTabName } from './tabs.js?v=1.15.6';

let graph = null;
let container = null;      // #mapping-table-view
let paperEl = null;        // #paper (hidden while the table shows)
let _active = false;
let _showUnmapped = true;  // CR: on by default
let _sortKey = null;       // column key currently sorted by (null = graph order)
let _sortDir = 'asc';      // 'asc' | 'desc'
let _lastRows = [];        // rows as currently rendered — feeds the CSV export
let _rerenderTimer = null;

// Columns in render order. `section` drives the three coloured header blocks
// (src = Data Sources, map = Data Mapping, tgt = Data Targets) + the dividers. Display
// `label`s drop the Source/Target prefix (the section colour disambiguates); the `csv`
// label carries the prefix so a flat export stays unambiguous. The Target section mirrors
// the Source section column-for-column.
const COLUMNS = [
  { key: 'srcDataLayer',  label: 'Data Layer',    csv: 'Source Data Layer',     section: 'src', sortable: true },
  { key: 'srcObject',     label: 'Object Name',   csv: 'Source Object Name',    section: 'src', sortable: true },
  { key: 'srcCategory',   label: 'Category',      csv: 'Source Category',       section: 'src', sortable: true },
  { key: 'srcApi',        label: 'Field API Name', csv: 'Source Field API Name', section: 'src', sortable: true },
  { key: 'srcLabel',      label: 'Field Label',   csv: 'Source Field Label',    section: 'src', sortable: true },
  { key: 'srcType',       label: 'Data Type',     csv: 'Source Data Type',      section: 'src', sortable: true },
  { key: 'pk',            label: 'PK',            csv: 'Source PK',             section: 'src' },
  { key: 'fk',            label: 'FK',            csv: 'Source FK',             section: 'src' },
  { key: 'fqk',           label: 'FQK',           csv: 'Source FQK',            section: 'src' },
  { key: 'nullable',      label: 'Nullable',      csv: 'Source Nullable',       section: 'src' },
  // Deprecated flags are EXPORT-ONLY (kept out of the on-screen table for readability —
  // a deprecated field is shown instead by striking its API Name / Label). CSV-only.
  { key: 'srcDeprecated', label: 'Deprecated',    csv: 'Source Deprecated',     section: 'src', exportOnly: true },
  // Cardinality leads the Data Mapping section — derived from the TARGET object's
  // header-level ER relationship (crow's-foot end markers); em-dash when none.
  { key: 'cardinality',   label: 'Cardinality',      csv: 'Cardinality',         section: 'map', sortable: true },
  { key: 'mappingType',   label: 'Mapping Type',     section: 'map', sortable: true },
  { key: 'expressionRule', label: 'Expression / Rule', section: 'map' },
  { key: 'tgtDataLayer',  label: 'Data Layer',    csv: 'Target Data Layer',     section: 'tgt', sortable: true },
  { key: 'tgtObject',     label: 'Object Name',   csv: 'Target Object Name',    section: 'tgt', sortable: true },
  { key: 'tgtCategory',   label: 'Category',      csv: 'Target Category',       section: 'tgt', sortable: true },
  { key: 'tgtApi',        label: 'Field API Name', csv: 'Target Field API Name', section: 'tgt', sortable: true },
  { key: 'tgtLabel',      label: 'Field Label',   csv: 'Target Field Label',    section: 'tgt', sortable: true },
  { key: 'tgtType',       label: 'Data Type',     csv: 'Target Data Type',      section: 'tgt', sortable: true },
  { key: 'tgtPk',         label: 'PK',            csv: 'Target PK',             section: 'tgt' },
  { key: 'tgtFk',         label: 'FK',            csv: 'Target FK',             section: 'tgt' },
  { key: 'tgtFqk',        label: 'FQK',           csv: 'Target FQK',            section: 'tgt' },
  { key: 'tgtNullable',   label: 'Nullable',      csv: 'Target Nullable',       section: 'tgt' },
  { key: 'tgtDeprecated', label: 'Deprecated',    csv: 'Target Deprecated',     section: 'tgt', exportOnly: true },
];
// Columns shown in the on-screen table (export-only columns are CSV-only). The header
// colspans, section dividers, and row rendering all use VIS; the CSV export uses COLUMNS.
const VIS = COLUMNS.filter(c => !c.exportOnly);
const SRC_COUNT = VIS.filter(c => c.section === 'src').length;   // 10 (visible)
const MAP_COUNT = VIS.filter(c => c.section === 'map').length;   // 3 (visible)
const TGT_COUNT = VIS.filter(c => c.section === 'tgt').length;   // 10 (visible)
// VISIBLE column indices where a section boundary falls (for the vertical dividers).
const SECTION_STARTS = new Set(VIS.map((c, i) => (i > 0 && c.section !== VIS[i - 1].section) ? i : -1).filter(i => i > 0));

// Inline SLDS-style glyphs (no sprite symbols for these — same inline-SVG
// convention the toolbar buttons use).
const ICON_DOWNLOAD = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8v8"/><path d="M4.8 6.6 8 9.8l3.2-3.2"/><path d="M2.4 11.4v1.3a1.1 1.1 0 0 0 1.1 1.1h9a1.1 1.1 0 0 0 1.1-1.1v-1.3"/></svg>';
const ICON_CHECKBOX = '<svg class="df-toolbar__checkbox" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path class="df-toolbar__checkbox-tick" d="M4.5 8l2.5 2.5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_WARN = '<svg class="df-tbl__warn" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M7.13 1.85 .9 12.9a1 1 0 0 0 .87 1.5h12.46a1 1 0 0 0 .87-1.5L8.87 1.85a1 1 0 0 0-1.74 0Z" fill="#FE9339"/><rect x="7.15" y="5.4" width="1.7" height="4.5" rx="0.85" fill="#412700"/><circle cx="8" cy="11.7" r="0.95" fill="#412700"/></svg>';

export function init(modules) {
  graph = modules.graph;
  container = document.getElementById('mapping-table-view');
  paperEl = document.getElementById('paper');
  // Live refresh: re-evaluate + redraw whenever the active graph changes structurally
  // (guarded so it's inert while the diagram view is showing). Coalesced to one frame.
  if (graph) {
    // change:parent / change:embeds keep the Source/Target DATA LAYER columns live when an
    // object is dragged into or out of a mapping-layer zone (its parent container changes).
    graph.on('add remove reset change:source change:target change:fields change:attrs change:linkKind change:labels change:mappingType change:expressionRule change:parent change:embeds', scheduleRerender);
  }
}

function scheduleRerender() {
  if (!_active || _rerenderTimer) return;
  _rerenderTimer = setTimeout(() => { _rerenderTimer = null; if (_active) render(); }, 80);
}

export function isActive() { return _active; }

export function show() {
  if (!container) return;
  _active = true;
  render();                       // clean re-evaluation of the active graph cells
  container.hidden = false;
  if (paperEl) paperEl.style.visibility = 'hidden';
}

export function hide() {
  if (!container) return;
  _active = false;
  container.hidden = true;
  if (paperEl) paperEl.style.visibility = '';
}

// ── Property evaluation helpers ─────────────────────────────────────────────
const fidOfPort = port => (typeof port === 'string' && port.startsWith('field-'))
  ? port.replace(/^field-(left|right)-/, '') : null;
const objName = o => (o && o.attr && o.attr('headerLabel/text')) || (o && o.get('name')) || 'Object';
const fieldOf = (o, fid) => (o && fid) ? (o.get('fields') || []).find(f => f && f.fid === fid) : null;
const linkLabelText = l => l.labels?.()?.[0]?.attrs?.text?.text || '';
const yn = b => (b ? 'Yes' : '');

// A container's visual label (Zone → label/text, Container/DataObject → headerLabel/text).
const containerLabel = c => c ? (c.attr('label/text') || c.attr('headerLabel/text') || c.get('name') || '') : '';

// ── ER relationship metadata (Data Targets "Cardinality / Related Object / Related
// Field" columns) ──────────────────────────────────────────────────────────────────
// Map a single link END's crow's-foot / bar / circle marker `d` path to a cardinality
// token. Mirrors the detection in properties.js detectMarker but returns the readable
// token directly (e.g. crow's foot → "Many"). '' when the end has no ER marker.
function erEndToken(markerAttr) {
  const d = (markerAttr && markerAttr.d) || '';
  if (!d) return '';
  const crow = /(?:L|M)\s*0\s+0\s+L\s*-12\s+-?8/.test(d) || d.includes('L 12 0');
  const circle = /a [345] [345]/.test(d);
  if (crow && circle) return '0..Many';
  if (crow && /M [3-9] -8|M -?15/.test(d)) return '1..Many';
  if (crow) return 'Many';
  if (circle) return '0..1';
  if (/M\s*-?\d+\s+-8\s*L\s*-?\d+\s+8/.test(d)) return '1';
  return '';
}

// Cardinality token for the ER relationship between a mapping's two endpoint objects
// (linkKind !== 'mapping' — a header-level object↔object relationship, not the field mapping):
// a `source:target` pair read from the relationship's crow's-foot / bar / circle end markers
// (e.g. "1:Many"), oriented as srcObj-end : tgtObj-end. Em-dash when there's no ER relationship.
function cardinalityOf(srcObj, tgtObj) {
  if (!tgtObj || !graph) return '—';
  const erLinks = graph.getConnectedLinks(tgtObj).filter(l => l.prop('linkKind') !== 'mapping');
  if (!erLinks.length) return '—';
  // Prefer the ER link that actually spans THIS mapping's two endpoint objects, so a Source→DLO
  // row reports the Source↔DLO relationship — not the target's first/unrelated ER link. (The old
  // `erLinks[0]` was order-dependent: a DLO mapped from Source but also related to a DMO would
  // pick up whichever relationship happened to be first, e.g. show the DLO↔DMO cardinality.)
  const rel = (srcObj && erLinks.find(l => {
    const a = l.get('source')?.id, b = l.get('target')?.id;
    return (a === srcObj.id && b === tgtObj.id) || (a === tgtObj.id && b === srcObj.id);
  })) || erLinks[0];
  // Read the marker on each object's ACTUAL end so the token reads srcObj-end : tgtObj-end,
  // regardless of which direction the relationship link was drawn. Fall back to source/target
  // as-authored when an object isn't on the link (the erLinks[0] fallback above).
  const endOf = (obj, fallbackEnd) =>
    obj && rel.get('source')?.id === obj.id ? rel.attr('line/sourceMarker')
    : obj && rel.get('target')?.id === obj.id ? rel.attr('line/targetMarker')
    : rel.attr(`line/${fallbackEnd}`);
  const sTok = erEndToken(endOf(srcObj, 'sourceMarker'));
  const tTok = erEndToken(endOf(tgtObj, 'targetMarker'));
  return (sTok || tTok) ? `${sTok || '—'}:${tTok || '—'}` : '—';
}

// DATA LAYER = the parent zone/container (mapping layer) the object sits in, by
// traversing the graph parent vector. Loose objects render '[No Mapping Layer]'.
function dataLayerOf(obj) {
  if (!obj) return '[No Mapping Layer]';
  const pid = obj.get('parent');
  const parent = pid && graph.getCell(pid);
  if (!parent) return '[No Mapping Layer]';
  return containerLabel(parent) || '[Layer]';
}

// MAPPING TYPE = the Data Cloud transform classification. Reads the link's explicit
// `mappingType` prop (Standard / Formula / Streaming Transform / Batch Transform /
// Calculated Insight); falls back to the legacy transform/mappingRule, default 'Standard'.
const MAPPING_TYPES = ['Standard', 'Formula', 'Streaming Transform', 'Batch Transform', 'Calculated Insight'];
function mappingTypeOf(link) {
  const explicit = link.prop('mappingType');
  if (MAPPING_TYPES.includes(explicit)) return explicit;
  const t = String(link.prop('transform') ?? link.prop('mappingRule') ?? '').toLowerCase();
  if (t.includes('formula')) return 'Formula';
  if (t.includes('stream')) return 'Streaming Transform';
  if (t.includes('batch')) return 'Batch Transform';
  if (t.includes('calc') || t.includes('insight')) return 'Calculated Insight';
  return 'Standard';
}

// Cross-cloud compatibility matrix: each Salesforce/Data Cloud type maps to a coarse group.
// A Standard (direct-copy) mapping ACROSS groups needs a transform, so the table flags it.
// Master-Detail is grouped with Text (it's an ID-like relationship key). Types still left
// unlisted (Formula) are intentionally ungrouped → never flagged (we can't classify their
// effective type, so we don't raise a false alarm).
const TYPE_GROUP = {};
(function buildTypeGroups() {
  const add = (group, types) => types.forEach(t => { TYPE_GROUP[t.toLowerCase()] = group; });
  add('text', ['Text', 'ID', 'Lookup', 'Master-Detail', 'Phone', 'Email', 'URL', 'Picklist', 'Multi-Picklist', 'Text Area', 'Long Text Area', 'Rich Text Area', 'Auto Number']);
  add('number', ['Number', 'Currency', 'Percent']);
  add('boolean', ['Checkbox', 'Boolean']);
  add('date', ['Date']);
  add('datetime', ['DateTime']);
})();
const groupOf = type => TYPE_GROUP[String(type || '').toLowerCase()] || null;
// True only when BOTH types are classifiable AND fall in different groups.
const typeGroupsDiffer = (a, b) => { const ga = groupOf(a), gb = groupOf(b); return !!(ga && gb && ga !== gb); };

function srcCells(obj, field) {
  // A PK / FQK is mandatory, so it's never nullable even if `required` wasn't set explicitly.
  const notNull = field?.required || field?.keyType === 'pk' || field?.keyType === 'fqk';
  return {
    srcDataLayer: dataLayerOf(obj),
    srcObject: objName(obj),
    srcCategory: obj?.get('category') || '',   // Data Cloud category (Profile / Engagement / Other)
    srcApi: field?.apiName || '',
    srcLabel: field?.label || '',
    srcType: field?.type || '',
    pk: yn(field?.keyType === 'pk'),
    fk: yn(field?.keyType === 'fk'),
    fqk: yn(field?.keyType === 'fqk'),
    nullable: notNull ? 'No' : 'Yes',
    srcDeprecated: yn(!!field?.deprecated),   // export-only column
    _srcDeprecated: !!field?.deprecated,      // drives the strikethrough on the source field cells
  };
}

function buildData() {
  const objects = graph.getElements().filter(e => e.get('type') === 'sf.DataObject');
  const objById = new Map(objects.map(o => [o.id, o]));
  const mappingLinks = graph.getLinks().filter(l => l.prop('linkKind') === 'mapping');

  const rows = [];
  const participated = new Set();   // "objId::fid" touched by ANY mapping (source or target)
  const objsInvolved = new Set();   // distinct object ids spanned by the mappings

  for (const l of mappingLinks) {
    const s = l.get('source'), t = l.get('target');
    const sObj = objById.get(s?.id), tObj = objById.get(t?.id);
    if (!sObj || !tObj) continue;   // dangling endpoint (deleted object) — nothing to show
    objsInvolved.add(s.id); objsInvolved.add(t.id);
    const sFid = fidOfPort(s?.port), tFid = fidOfPort(t?.port);
    const sF = fieldOf(sObj, sFid), tF = fieldOf(tObj, tFid);
    if (sFid) participated.add(`${s.id}::${sFid}`);
    if (tFid) participated.add(`${t.id}::${tFid}`);
    const mType = mappingTypeOf(l);
    const sType = sF?.type || '', tType = tF?.type || '';
    // Cross-cloud sanity check: a STANDARD (direct copy) mapping across two different
    // compatibility GROUPS (e.g. Text → DateTime) needs a transform → flag it. Same-group
    // pairs (Text → Email) and any non-Standard mapping are fine.
    const warn = mType === 'Standard' && typeGroupsDiffer(sType, tType);
    // Expression / Rule: the link's transform note (`expressionRule`). Falls back to the
    // legacy `mappingLabel` prop, then the connector's visual label, for back-compat.
    const expr = (l.prop('expressionRule') || l.prop('mappingLabel') || linkLabelText(l) || '').trim();
    const tNotNull = tF?.required || tF?.keyType === 'pk' || tF?.keyType === 'fqk';
    rows.push({
      ...srcCells(sObj, sF),
      cardinality: cardinalityOf(sObj, tObj),    // the Source↔Target ER relationship (or em-dash)
      mappingType: mType,
      expressionRule: expr || '—',               // dimmed em-dash = clean pass-through
      tgtDataLayer: dataLayerOf(tObj),
      tgtObject: objName(tObj),
      tgtCategory: tObj.get('category') || '',
      tgtApi: tF?.apiName || '',
      tgtLabel: tF?.label || tF?.apiName || '',
      tgtType: tType,
      tgtPk: yn(tF?.keyType === 'pk'),
      tgtFk: yn(tF?.keyType === 'fk'),
      tgtFqk: yn(tF?.keyType === 'fqk'),
      tgtNullable: tNotNull ? 'No' : 'Yes',
      tgtDeprecated: yn(!!tF?.deprecated),   // export-only column
      _tgtDeprecated: !!tF?.deprecated,      // drives the strikethrough on the target field cells
      _warn: warn,
      _mapped: true,
    });
  }

  // Unmapped = a field touched by no mapping link at all.
  let unmappedCount = 0;
  for (const o of objects) for (const f of (o.get('fields') || [])) {
    if (f && f.fid && !participated.has(`${o.id}::${f.fid}`)) unmappedCount++;
  }
  if (_showUnmapped) {
    for (const o of objects) for (const f of (o.get('fields') || [])) {
      if (!f || !f.fid || participated.has(`${o.id}::${f.fid}`)) continue;
      rows.push({ ...srcCells(o, f), cardinality: '', mappingType: '', expressionRule: '', tgtDataLayer: '', tgtObject: '', tgtCategory: '', tgtApi: '', tgtLabel: '', tgtType: '', tgtPk: '', tgtFk: '', tgtFqk: '', tgtNullable: '', tgtDeprecated: '', _tgtDeprecated: false, _warn: false, _mapped: false });
    }
  }

  return { rows, mappingCount: rows.filter(r => r._mapped).length, objectCount: objsInvolved.size, unmappedCount };
}

// Stable, case-insensitive sort by the active column (graph order when unsorted).
function sortRows(rows) {
  if (!_sortKey) return rows;
  const dir = _sortDir === 'desc' ? -1 : 1;
  return rows
    .map((r, i) => [r, i])
    .sort((a, b) => {
      const av = String(a[0][_sortKey] ?? '').toLowerCase();
      const bv = String(b[0][_sortKey] ?? '').toLowerCase();
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a[1] - b[1];           // stable tiebreak on original index
    })
    .map(p => p[0]);
}

export function render() {
  if (!container || !graph) return;
  const built = buildData();
  const rows = sortRows(built.rows);
  _lastRows = rows;
  const { mappingCount, objectCount, unmappedCount } = built;

  const tier1 = `<tr class="df-tbl__sections">
      <th colspan="${SRC_COUNT}" class="df-tbl__sec df-tbl__sec--src">Data Sources</th>
      <th colspan="${MAP_COUNT}" class="df-tbl__sec df-tbl__sec--map">Data Mapping</th>
      <th colspan="${TGT_COUNT}" class="df-tbl__sec df-tbl__sec--tgt">Data Targets</th>
    </tr>`;
  const tier2 = `<tr class="df-tbl__cols">${VIS.map((c, i) => {
    const div = SECTION_STARTS.has(i) ? ' df-tbl__divider' : '';
    const sortable = c.sortable ? ' df-tbl__th--sortable' : '';
    const active = (_sortKey === c.key) ? ' df-tbl__th--sorted' : '';
    const arrow = (_sortKey === c.key) ? `<span class="df-tbl__sort-ind">${_sortDir === 'desc' ? '▼' : '▲'}</span>` : '';
    const attr = c.sortable ? ` data-sort="${c.key}" role="button" tabindex="0"` : '';
    return `<th class="${(div + sortable + active).trim()}"${attr}>${escHtml(c.label)}${arrow}</th>`;
  }).join('')}</tr>`;

  // Placeholders ([No Mapping Layer] / [Layer] / em-dash) render dimmed + italic.
  const cellHtml = (key, val) => {
    const s = String(val ?? '');
    const placeholder = ((key === 'srcDataLayer' || key === 'tgtDataLayer') && s.startsWith('[')) || ((key === 'expressionRule' || key === 'cardinality') && s === '—');
    return placeholder ? `<span class="df-tbl__placeholder">${escHtml(s)}</span>` : escHtml(s);
  };
  // A deprecated field is shown by striking its identity cells (API Name + Label) on
  // the relevant side. Source side keys: srcApi/srcLabel; target side: tgtApi/tgtLabel.
  const isStruck = (key, r) =>
    (r._srcDeprecated && (key === 'srcApi' || key === 'srcLabel')) ||
    (r._tgtDeprecated && (key === 'tgtApi' || key === 'tgtLabel'));
  const body = rows.length
    ? rows.map(r => `<tr${r._mapped ? '' : ' class="df-tbl__row--unmapped"'}>${VIS.map((c, i) => {
        const div = SECTION_STARTS.has(i) ? ' df-tbl__divider' : '';
        const center = c.center ? ' df-tbl__center' : '';
        const strike = isStruck(c.key, r) ? ' df-tbl__strike' : '';
        // The type-mismatch warning rides on the Mapping Type cell.
        const warn = (c.key === 'mappingType' && r._warn)
          ? `<span class="df-tbl__warn-wrap" title="Source type “${escHtml(r.srcType)}” ≠ target type “${escHtml(r.tgtType)}” on a Standard mapping — a Formula/Calculated transform may be required.">${ICON_WARN}</span>`
          : '';
        return `<td class="${(div + center + strike).trim()}">${cellHtml(c.key, r[c.key])}${warn}</td>`;
      }).join('')}</tr>`).join('')
    : `<tr><td colspan="${VIS.length}" class="df-tbl__empty">No mapping connectors on this diagram yet — draw field-to-field links on the canvas, then return here.</td></tr>`;

  const note = `${mappingCount} mapping${mappingCount === 1 ? '' : 's'} across ${objectCount} object${objectCount === 1 ? '' : 's'}` + (unmappedCount ? ` · ${unmappedCount} unmapped field${unmappedCount === 1 ? '' : 's'}` : '');
  const toggleLabel = 'Show Unmapped Fields';   // static label; the checkbox tick shows on/off state

  container.innerHTML = `<div class="df-tbl">
      <div class="df-tbl__topbar">
        <h2 class="df-tbl__title">Field Mapping</h2>
        <span class="df-tbl__note">${escHtml(note)}</span>
        <button type="button" id="tbl-show-unmapped" class="df-toolbar__menu-item df-toolbar__menu-item--icon df-toolbar__menu-item--toggle df-tbl__toggle${_showUnmapped ? ' is-checked' : ''}">${ICON_CHECKBOX}${escHtml(toggleLabel)}</button>
        <button type="button" id="tbl-csv" class="df-tbl__csv" title="Export the visible mapping rows as a CSV file">${ICON_DOWNLOAD}<span>Export Mapping to CSV</span></button>
      </div>
      <div class="df-tbl__scroll">
        <table class="df-tbl__table"><thead>${tier1}${tier2}</thead><tbody>${body}</tbody></table>
      </div>
    </div>`;

  container.querySelector('#tbl-show-unmapped')?.addEventListener('click', () => { _showUnmapped = !_showUnmapped; render(); });
  container.querySelector('#tbl-csv')?.addEventListener('click', exportCsv);
  container.querySelectorAll('.df-tbl__th--sortable').forEach(th => {
    const key = th.getAttribute('data-sort');
    const go = () => toggleSort(key);
    th.addEventListener('click', go);
    th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

function toggleSort(key) {
  if (_sortKey === key) {
    if (_sortDir === 'asc') _sortDir = 'desc';
    else { _sortKey = null; _sortDir = 'asc'; }   // asc → desc → unsorted
  } else {
    _sortKey = key; _sortDir = 'asc';
  }
  render();
}

// CSV export of exactly what's on screen (current sort + Show-Unmapped state).
// A BOM keeps Excel honest about UTF-8; display-only em-dashes are stripped.
function exportCsv() {
  const esc = v => {
    let s = String(v ?? '').trim();
    if (s === '—') s = '';
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // The export uses the prefixed `csv` label (Source/Target …) since the flat file loses
  // the colour-coded section headers that disambiguate the short on-screen labels.
  const header = COLUMNS.map(c => esc(c.csv || c.label)).join(',');
  const lines = _lastRows.map(r => COLUMNS.map(c => esc(r[c.key])).join(','));
  const csv = '﻿' + [header, ...lines].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `df_${sanitizeFilenamePart(getActiveTabName(), 'tab')}_mapping.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

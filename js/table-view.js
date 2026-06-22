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
import { escHtml, sanitizeFilenamePart } from './util.js?v=1.17.1.4';
import { getActiveTabName, getActiveTabType } from './tabs.js?v=1.17.1.4';
import { startBatch, endBatch, setLocked, undo } from './history.js?v=1.17.1.4';
import { SF_FIELD_TYPES } from './properties.js?v=1.17.1.4';
import { buildModal } from './feedback.js?v=1.17.1.4';
import { buildObjectSchemaCsv } from './data-export.js?v=1.17.1.4';

let graph = null;
let container = null;      // #mapping-table-view
let paperEl = null;        // #paper (hidden while the table shows)
let _active = false;
let _showUnmapped = true;  // CR: on by default
let _sortKey = null;       // column key currently sorted by (null = graph order)
let _sortDir = 'asc';      // 'asc' | 'desc'
let _lastRows = [];        // rows as currently rendered — feeds the CSV export
let _rerenderTimer = null;
// Which projection is showing: 'mapping' (Data Mapping lineage) or 'model' (Data Model per-field schema,
// v1.16.1). Set in show() from the active diagram type; stable while the table is up (a tab change resets
// the toolbar to Diagram view first).
let _mode = 'mapping';
const isModelMode = () => _mode === 'model';

// ── Inline FIELD-level edit session (Edit Fields → Save / Cancel) ──
// A session holds an unapplied working COPY of every editable field (keyed objId::fid),
// so undo/redo is locked, the diagram is the single committer on Save, and the draft
// survives a flip to the diagram view (to reference it). Nothing is written to the graph
// until Save — then the whole diff lands as ONE history entry.
let _editing = false;
let _draft = null;         // Map(objId::fid -> { objId, fid, apiName, label, type, sampleValues, keyType, required })
let _orig = null;          // frozen snapshot taken when the session opened (drives the diff + the changed-cell tint)
let _linkDraft = null;     // Map(linkId -> { linkId, mappingType, expressionRule }) — editable mapping-link props
let _linkOrig = null;      // frozen link-prop snapshot
let _applying = false;     // true only while Save writes to the graph — suppresses the diagram-edit watcher
let _guardOpen = false;    // a Save/Discard guard overlay is currently showing (don't stack a second)
let _requestTableView = null;   // () => switch the toolbar back to Table view (wired by app.js, used by #5)

// FIELD-LEVEL editable cells only (a quick way to fix typos / field names / types / keys / sample values).
// `kind` picks the control: text input, type picklist, mutually-exclusive key checkbox (pk/fk/fqk), or the
// Nullable checkbox (derived from required + key). Object-level (Object Name / Category / Data Layer) and
// mapping-level (Cardinality / Mapping Type / Expression) cells stay read-only — they affect a whole
// object/relationship and belong on the canvas.
const EDIT_COLS = {
  srcApi:           { side: 'src', kind: 'text',   prop: 'apiName' },
  srcLabel:         { side: 'src', kind: 'text',   prop: 'label' },
  srcType:          { side: 'src', kind: 'select', prop: 'type' },
  srcSampleValues:  { side: 'src', kind: 'text',   prop: 'sampleValues' },
  pk:               { side: 'src', kind: 'key',    token: 'pk' },
  fk:               { side: 'src', kind: 'key',    token: 'fk' },
  fqk:              { side: 'src', kind: 'key',    token: 'fqk' },
  nullable:         { side: 'src', kind: 'nullable' },
  tgtApi:           { side: 'tgt', kind: 'text',   prop: 'apiName' },
  tgtLabel:         { side: 'tgt', kind: 'text',   prop: 'label' },
  tgtType:          { side: 'tgt', kind: 'select', prop: 'type' },
  tgtSampleValues:  { side: 'tgt', kind: 'text',   prop: 'sampleValues' },
  tgtPk:            { side: 'tgt', kind: 'key',    token: 'pk' },
  tgtFk:            { side: 'tgt', kind: 'key',    token: 'fk' },
  tgtFqk:           { side: 'tgt', kind: 'key',    token: 'fqk' },
  tgtNullable:      { side: 'tgt', kind: 'nullable' },
  // Mapping-LEVEL (per mapping link, not per field) — editable only on a mapped row (one with a link).
  mappingType:      { kind: 'linkSelect', prop: 'mappingType' },
  expressionRule:   { kind: 'linkText',   prop: 'expressionRule' },
  // Data MODEL table only (single-sided per-field schema): Length text + Deprecated checkbox.
  srcLength:        { side: 'src', kind: 'text', prop: 'length' },
  srcDeprecatedEdit:{ side: 'src', kind: 'bool', prop: 'deprecated' },
};
// The field props a session may write (everything else on the field — fid — is preserved untouched).
// Drives the snapshot, the diff, and the apply. `required` + `deprecated` are compared as booleans.
const EDIT_PROPS = ['apiName', 'label', 'type', 'sampleValues', 'keyType', 'required', 'length', 'deprecated'];
const BOOL_PROPS = new Set(['required', 'deprecated']);
// Link props the session may write (mapping rows only).
const LINK_PROPS = ['mappingType', 'expressionRule'];
const linkDirty = (d, o) => !!o && LINK_PROPS.some(p => (d[p] ?? '') !== (o[p] ?? ''));

// Side → (objId, fid) accessor on a row; '' when that side has no field (e.g. an unmapped row's target).
const sideIds = (side, r) => side === 'src'
  ? { objId: r._srcObjId || '', fid: r._srcFid || '' }
  : { objId: r._tgtObjId || '', fid: r._tgtFid || '' };
const draftKeyOf = (objId, fid) => `${objId}::${fid}`;
// A field is Nullable unless it's explicitly required, or a PK / FQK (a key is inherently mandatory) —
// mirrors srcCells()/buildData()'s notNull rule and the diagram-view field editor's auto-required.
const isNullable = (d) => !!d && !(d.required || d.keyType === 'pk' || d.keyType === 'fqk');

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
  { key: 'srcSampleValues', label: 'Sample Values', csv: 'Source Sample Values', section: 'src', sortable: true },
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
  { key: 'tgtSampleValues', label: 'Sample Values', csv: 'Target Sample Values', section: 'tgt', sortable: true },
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

// ── Data MODEL schema table (v1.16.1) ───────────────────────────────────────
// One row per field across every object — the on-screen twin of the Data Model CSV export
// (data-export.js: Object, API Name, Label, Type, Length, Required, Deprecated, Key, Sample Values).
// Reuses the src* field keys (so the existing field edit-controls apply) + Length / Deprecated. Single
// section, no src/map/tgt dividers. The CSV button reuses buildObjectSchemaCsv for an identical export.
const MODEL_COLUMNS = [
  { key: 'srcObject',         label: 'Object',         section: 'mdl', sortable: true },   // read-only object name
  { key: 'srcApi',            label: 'Field API Name', section: 'mdl', sortable: true },
  { key: 'srcLabel',          label: 'Field Label',    section: 'mdl', sortable: true },
  { key: 'srcType',           label: 'Data Type',      section: 'mdl', sortable: true },
  { key: 'srcLength',         label: 'Length',         section: 'mdl', sortable: true },
  { key: 'pk',                label: 'PK',             section: 'mdl' },
  { key: 'fk',                label: 'FK',             section: 'mdl' },
  { key: 'fqk',               label: 'FQK',            section: 'mdl' },
  { key: 'nullable',          label: 'Nullable',       section: 'mdl' },
  { key: 'srcDeprecatedEdit', label: 'Deprecated',     section: 'mdl' },
  { key: 'srcSampleValues',   label: 'Sample Values',  section: 'mdl', sortable: true },
];
const NO_DIVIDERS = new Set();
const schemaOf = () => isModelMode() ? { cols: MODEL_COLUMNS, starts: NO_DIVIDERS } : { cols: VIS, starts: SECTION_STARTS };

// Inline SLDS-style glyphs (no sprite symbols for these — same inline-SVG
// convention the toolbar buttons use).
const ICON_DOWNLOAD = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8v8"/><path d="M4.8 6.6 8 9.8l3.2-3.2"/><path d="M2.4 11.4v1.3a1.1 1.1 0 0 0 1.1 1.1h9a1.1 1.1 0 0 0 1.1-1.1v-1.3"/></svg>';
const ICON_CHECKBOX = '<svg class="df-toolbar__checkbox" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path class="df-toolbar__checkbox-tick" d="M4.5 8l2.5 2.5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_WARN = '<svg class="df-tbl__warn" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M7.13 1.85 .9 12.9a1 1 0 0 0 .87 1.5h12.46a1 1 0 0 0 .87-1.5L8.87 1.85a1 1 0 0 0-1.74 0Z" fill="#FE9339"/><rect x="7.15" y="5.4" width="1.7" height="4.5" rx="0.85" fill="#412700"/><circle cx="8" cy="11.7" r="0.95" fill="#412700"/></svg>';
const ICON_PENCIL = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.4 2.3a1.3 1.3 0 0 1 1.8 0l.5.5a1.3 1.3 0 0 1 0 1.8L5.4 13.4l-3 .6.6-3z"/><path d="M10.3 3.4l2.3 2.3"/></svg>';
// Counter-clockwise revert arrow (per-row "reset to original").
const ICON_UNDO = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a5 5 0 1 1 1.5 3.5"/><path d="M3 4.5V8h3.5"/></svg>';

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
    // (#9) While a table edit session is OPEN but the user has flipped to the diagram view to
    // reference it, a genuine SCHEMA edit there means two sources are mutating the same model —
    // pop the Save/Discard guard. A tighter event set than the live-refresh one above (no attrs/
    // labels/position noise; reset is a tab swap, handled separately) so panning, recolouring, or
    // selecting in the diagram doesn't trip it.
    graph.on('add remove change:fields change:source change:target change:linkKind change:mappingType change:expressionRule change:category change:parent change:embeds', onDiagramSchemaEdit);
    // A graph swap (tab close/switch, session restore, import-replace) invalidates the draft —
    // abort the session silently so it can't zombie a lock or write into the wrong graph.
    graph.on('reset', abortSessionOnReset);
  }
}

function scheduleRerender() {
  // Never auto-rerender mid-edit — it would blow away the in-progress <input>s. (The Done handler
  // applies the edits itself and then re-renders.)
  if (!_active || _editing || _rerenderTimer) return;
  _rerenderTimer = setTimeout(() => { _rerenderTimer = null; if (_active && !_editing) render(); }, 80);
}

export function isActive() { return _active; }

// (#5) Lets the diagram-edit guard's "Keep editing" flip the toolbar back to Table view. Wired by app.js.
export function setRequestTableView(fn) { _requestTableView = fn; }

export function show() {
  if (!container) return;
  // Pick the projection from the active diagram type (datamodel → per-field schema, else mapping lineage).
  // Stable while the table is up — a tab change resets the toolbar to Diagram view first.
  if (!_editing) _mode = getActiveTabType?.() === 'datamodel' ? 'model' : 'mapping';
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
    srcSampleValues: field?.sampleValues || '',
    srcDeprecated: yn(!!field?.deprecated),   // export-only column
    _srcDeprecated: !!field?.deprecated,      // drives the strikethrough on the source field cells
    _srcObjId: obj?.id || '',                 // for inline field-level editing (maps a cell back to the field)
    _srcFid: field?.fid || '',
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
      tgtSampleValues: tF?.sampleValues || '',
      tgtDeprecated: yn(!!tF?.deprecated),   // export-only column
      _tgtDeprecated: !!tF?.deprecated,      // drives the strikethrough on the target field cells
      _tgtObjId: tObj.id,                    // for inline field-level editing of the target field
      _tgtFid: tFid || '',
      _linkId: l.id,                         // the mapping link — for editing Mapping Type / Expression
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
      rows.push({ ...srcCells(o, f), cardinality: '', mappingType: '', expressionRule: '', tgtDataLayer: '', tgtObject: '', tgtCategory: '', tgtApi: '', tgtLabel: '', tgtType: '', tgtPk: '', tgtFk: '', tgtFqk: '', tgtNullable: '', tgtSampleValues: '', tgtDeprecated: '', _tgtDeprecated: false, _warn: false, _mapped: false });
    }
  }

  return { rows, mappingCount: rows.filter(r => r._mapped).length, objectCount: objsInvolved.size, unmappedCount };
}

// Data MODEL projection: one row per field across every DataObject (graph order). Reuses srcCells so the
// shared field edit-controls + strikethrough work unchanged; adds Length + a Deprecated display cell.
function buildModelData() {
  const objects = graph.getElements().filter(e => e.get('type') === 'sf.DataObject');
  const rows = [];
  for (const o of objects) for (const f of (o.get('fields') || [])) {
    if (!f || !f.fid) continue;
    rows.push({ ...srcCells(o, f), srcLength: f.length || '', srcDeprecatedEdit: yn(!!f.deprecated), _mapped: false, _model: true });
  }
  return { rows, mappingCount: 0, objectCount: objects.length, unmappedCount: 0, fieldCount: rows.length };
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
  const isModel = isModelMode();
  const { cols, starts } = schemaOf();
  const built = isModel ? buildModelData() : buildData();
  const rows = sortRows(built.rows);
  _lastRows = rows;
  const { mappingCount, objectCount, unmappedCount, fieldCount } = built;

  const revHdr = _editing ? '<th rowspan="2" class="df-tbl__revcol" aria-label="Revert row"></th>' : '';
  const tier1 = isModel
    ? `<tr class="df-tbl__sections">${revHdr}<th colspan="${cols.length}" class="df-tbl__sec df-tbl__sec--mdl">Data Model</th></tr>`
    : `<tr class="df-tbl__sections">${revHdr}
        <th colspan="${SRC_COUNT}" class="df-tbl__sec df-tbl__sec--src">Data Sources</th>
        <th colspan="${MAP_COUNT}" class="df-tbl__sec df-tbl__sec--map">Data Mapping</th>
        <th colspan="${TGT_COUNT}" class="df-tbl__sec df-tbl__sec--tgt">Data Targets</th>
      </tr>`;
  const tier2 = `<tr class="df-tbl__cols">${cols.map((c, i) => {
    const div = starts.has(i) ? ' df-tbl__divider' : '';
    const sortable = (c.sortable && !_editing) ? ' df-tbl__th--sortable' : '';   // sorting is frozen mid-edit
    const active = (_sortKey === c.key) ? ' df-tbl__th--sorted' : '';
    const arrow = (_sortKey === c.key) ? `<span class="df-tbl__sort-ind">${_sortDir === 'desc' ? '▼' : '▲'}</span>` : '';
    const attr = (c.sortable && !_editing) ? ` data-sort="${c.key}" role="button" tabindex="0"` : '';
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
  // ── Edit mode: render an editable field cell from the DRAFT buffer ──
  // Text input / type picklist / mutually-exclusive key checkbox / Nullable checkbox — but ONLY when this
  // side has a real field on the row (so an unmapped row's empty target stays blank and no rows can be
  // conjured). Values come from the draft (the graph is untouched until Save). Returns null = not editable.
  const renderEditableCell = (key, r) => {
    const ec = EDIT_COLS[key];
    if (!ec) return null;
    // Mapping-LEVEL cells (Mapping Type picklist + Expression text) — editable only on a mapped row.
    if (ec.kind === 'linkSelect' || ec.kind === 'linkText') {
      const linkId = r._linkId;
      const d = linkId && _linkDraft?.get(linkId);
      if (!d) return null;
      const lk = escHtml(String(linkId));
      if (ec.kind === 'linkText') {
        const v = escHtml(String(d.expressionRule ?? ''));
        return `<input type="text" class="df-tbl__input" data-link="${lk}" data-lprop="expressionRule" value="${v}" placeholder="—" />`;
      }
      const cur = String(d.mappingType ?? 'Standard');
      const opts = MAPPING_TYPES.map(t => `<option value="${escHtml(t)}"${t === cur ? ' selected' : ''}>${escHtml(t)}</option>`).join('');
      return `<select class="df-tbl__input df-tbl__select" data-link="${lk}" data-lprop="mappingType">${opts}</select>`;
    }
    const { objId, fid } = sideIds(ec.side, r);
    if (!objId || !fid) return null;
    const d = _draft?.get(draftKeyOf(objId, fid));
    if (!d) return null;
    const k = escHtml(draftKeyOf(objId, fid));
    if (ec.kind === 'text') {
      const v = escHtml(String(d[ec.prop] ?? ''));
      return `<input type="text" class="df-tbl__input" data-k="${k}" data-prop="${ec.prop}" value="${v}" />`;
    }
    if (ec.kind === 'select') {
      const cur = String(d.type ?? '');
      // Keep a legacy/custom value selectable so opening the picker can't silently retype the field.
      const types = (!cur || SF_FIELD_TYPES.includes(cur)) ? SF_FIELD_TYPES : [cur, ...SF_FIELD_TYPES];
      const opts = types.map(t => `<option value="${escHtml(t)}"${t === cur ? ' selected' : ''}>${escHtml(t)}</option>`).join('');
      return `<select class="df-tbl__input df-tbl__select" data-k="${k}" data-prop="type">${opts}</select>`;
    }
    if (ec.kind === 'key') {
      const on = d.keyType === ec.token;
      return `<button type="button" class="df-tbl__check${on ? ' is-checked' : ''}" data-k="${k}" data-key="${ec.token}" role="checkbox" aria-checked="${on}" title="${ec.token.toUpperCase()}">${ICON_CHECKBOX}</button>`;
    }
    if (ec.kind === 'bool') {   // plain boolean checkbox (Deprecated) — no interdependencies
      const on = !!d[ec.prop];
      return `<button type="button" class="df-tbl__check${on ? ' is-checked' : ''}" data-k="${k}" data-bool="${ec.prop}" role="checkbox" aria-checked="${on}" title="Deprecated">${ICON_CHECKBOX}</button>`;
    }
    // nullable — derived from required + key; forced off (and locked) when the field is a PK / FQK.
    const forced = d.keyType === 'pk' || d.keyType === 'fqk';
    const on = isNullable(d);
    return `<button type="button" class="df-tbl__check${on ? ' is-checked' : ''}${forced ? ' df-tbl__check--locked' : ''}" data-k="${k}" data-nullable role="checkbox" aria-checked="${on}"${forced ? ' disabled aria-disabled="true" title="A PK / FQK is always mandatory"' : ' title="Nullable"'}>${ICON_CHECKBOX}</button>`;
  };
  // A cell shows the brand-amber "changed" tint when its draft value differs from the session snapshot.
  const cellChanged = (key, r) => {
    const ec = EDIT_COLS[key];
    if (!ec) return false;
    if (ec.kind === 'linkSelect' || ec.kind === 'linkText') {
      const linkId = r._linkId;
      const d = linkId && _linkDraft?.get(linkId), o = linkId && _linkOrig?.get(linkId);
      return !!d && !!o && (d[ec.prop] ?? '') !== (o[ec.prop] ?? '');
    }
    const { objId, fid } = sideIds(ec.side, r);
    if (!objId || !fid) return false;
    const dk = draftKeyOf(objId, fid);
    const d = _draft?.get(dk), o = _orig?.get(dk);
    if (!d || !o) return false;
    if (ec.kind === 'text' || ec.kind === 'select') return (d[ec.prop] ?? '') !== (o[ec.prop] ?? '');
    if (ec.kind === 'bool') return !!d[ec.prop] !== !!o[ec.prop];
    if (ec.kind === 'key') return (d.keyType === ec.token) !== (o.keyType === ec.token);
    return isNullable(d) !== isNullable(o);   // nullable
  };
  // Per-row revert button (#4) — leads each row in edit mode; shown only when the row has unsaved changes.
  // The cell always carries data-row so a live text/select edit (which doesn't re-render) can toggle the
  // button in place via updateRowRevert().
  const revertCell = (r) => !_editing ? '' :
    `<td class="df-tbl__revcol" data-row="${escHtml(rowKeyOf(r))}">${rowChanged(r) ? revertBtnHtml(r) : ''}</td>`;
  const body = rows.length
    ? rows.map(r => `<tr${!isModel && !r._mapped ? ' class="df-tbl__row--unmapped"' : ''}>${revertCell(r)}${cols.map((c, i) => {
        const div = starts.has(i) ? ' df-tbl__divider' : '';
        const center = c.center ? ' df-tbl__center' : '';
        const strike = isStruck(c.key, r) ? ' df-tbl__strike' : '';
        // The type-mismatch warning rides on the Mapping Type cell (read-only OR editable).
        const warn = (c.key === 'mappingType' && r._warn)
          ? `<span class="df-tbl__warn-wrap" title="Source type “${escHtml(r.srcType)}” ≠ target type “${escHtml(r.tgtType)}” on a Standard mapping - a Formula/Calculated transform may be required.">${ICON_WARN}</span>`
          : '';
        const ctrl = _editing ? renderEditableCell(c.key, r) : null;
        if (ctrl !== null) {
          const kind = EDIT_COLS[c.key].kind;
          const checkbox = kind === 'key' || kind === 'nullable' || kind === 'bool';
          const changed = cellChanged(c.key, r) ? ' df-tbl__cell--changed' : '';
          return `<td class="${('df-tbl__cell--edit' + (checkbox ? ' df-tbl__center' : '') + div + changed).trim()}">${ctrl}${warn}</td>`;
        }
        return `<td class="${(div + center + strike).trim()}">${cellHtml(c.key, r[c.key]) + warn}</td>`;
      }).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length + (_editing ? 1 : 0)}" class="df-tbl__empty">${isModel ? 'No fields yet - add objects and fields on the canvas, then return here.' : 'No mapping connectors on this diagram yet - draw field-to-field links on the canvas, then return here.'}</td></tr>`;

  // In edit mode the note becomes a live unsaved-change tally; otherwise a mode-specific summary.
  const changeCount = _editing ? pendingChangeCount() : 0;
  const note = _editing
    ? `${changeCount} unsaved change${changeCount === 1 ? '' : 's'}`
    : isModel
      ? `${fieldCount} field${fieldCount === 1 ? '' : 's'} across ${objectCount} object${objectCount === 1 ? '' : 's'}`
      : `${mappingCount} mapping${mappingCount === 1 ? '' : 's'} across ${objectCount} object${objectCount === 1 ? '' : 's'}` + (unmappedCount ? ` · ${unmappedCount} unmapped field${unmappedCount === 1 ? '' : 's'}` : '');
  const toggleLabel = 'Show Unmapped Fields';   // static label; the checkbox tick shows on/off state
  const csvLabel = isModel ? 'Export Schema to CSV' : 'Export Mapping to CSV';

  // Topbar — Edit mode: Cancel + Save. Model mode: Edit + CSV (no unmapped concept). Mapping mode:
  // Show-Unmapped (left) + Edit + CSV. The toggle/CSV/sort are withheld mid-edit (no row reshuffle).
  const editBtn = `<button type="button" id="tbl-edit" class="df-tbl__csv df-tbl__push" title="Edit field-level values inline (typos, names, types, keys, sample values)">${ICON_PENCIL}<span>Edit Fields</span></button>`;
  const csvBtn = `<button type="button" id="tbl-csv" class="df-tbl__csv" title="Export the visible rows as a CSV file">${ICON_DOWNLOAD}<span>${escHtml(csvLabel)}</span></button>`;
  const topbarActions = _editing
    ? `<button type="button" id="tbl-edit-cancel" class="df-tbl__csv df-tbl__push">Cancel</button>
       <button type="button" id="tbl-edit-save" class="df-tbl__csv df-tbl__csv--primary">Save</button>`
    : isModel
      ? `${editBtn}${csvBtn}`
      : `<button type="button" id="tbl-show-unmapped" class="df-toolbar__menu-item df-toolbar__menu-item--icon df-toolbar__menu-item--toggle df-tbl__toggle${_showUnmapped ? ' is-checked' : ''}">${ICON_CHECKBOX}${escHtml(toggleLabel)}</button>${editBtn}${csvBtn}`;

  container.innerHTML = `<div class="df-tbl${_editing ? ' df-tbl--editing' : ''}">
      <div class="df-tbl__topbar">
        <h2 class="df-tbl__title">${isModel ? 'Field Schema' : 'Field Mapping'}</h2>
        <span class="df-tbl__note" id="tbl-note">${escHtml(note)}</span>
        ${topbarActions}
      </div>
      <div class="df-tbl__scroll">
        <table class="df-tbl__table"><thead>${tier1}${tier2}</thead><tbody>${body}</tbody></table>
      </div>
    </div>`;

  if (_editing) {
    container.querySelector('#tbl-edit-save')?.addEventListener('click', saveEdits);
    container.querySelector('#tbl-edit-cancel')?.addEventListener('click', cancelEdits);
    // Text + picklist: update the draft live and re-tint the cell in place — no re-render (keeps caret).
    container.querySelectorAll('.df-tbl__input[data-prop]').forEach(el => {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => onFieldInput(el));
    });
    // Mapping-level (link) Mapping Type / Expression inputs — same live-update path, keyed by link id.
    container.querySelectorAll('.df-tbl__input[data-lprop]').forEach(el => {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => onLinkInput(el));
    });
    // Per-row revert (#4) — re-render after resetting the row's drafts so its cells + the revert button update.
    container.querySelectorAll('.df-tbl__revert').forEach(btn => btn.addEventListener('click', () => {
      const row = _lastRows.find(x => rowKeyOf(x) === btn.dataset.row);
      if (row) revertRow(row);
    }));
    // Key / Nullable checkboxes carry interdependencies (key ↔ required ↔ nullable), so a click mutates
    // the draft then re-renders so every dependent cell + tint updates together.
    container.querySelectorAll('.df-tbl__check[data-key]').forEach(el =>
      el.addEventListener('click', () => { toggleKey(el.dataset.k, el.dataset.key); render(); }));
    container.querySelectorAll('.df-tbl__check[data-nullable]:not([disabled])').forEach(el =>
      el.addEventListener('click', () => { toggleNullable(el.dataset.k); render(); }));
    container.querySelectorAll('.df-tbl__check[data-bool]').forEach(el =>
      el.addEventListener('click', () => { toggleBool(el.dataset.k, el.dataset.bool); render(); }));
    container.querySelector('.df-tbl__input')?.focus();   // land on the first editable cell
  } else {
    container.querySelector('#tbl-edit')?.addEventListener('click', beginEdit);
    container.querySelector('#tbl-show-unmapped')?.addEventListener('click', () => { _showUnmapped = !_showUnmapped; render(); });
    container.querySelector('#tbl-csv')?.addEventListener('click', exportCsv);
    container.querySelectorAll('.df-tbl__th--sortable').forEach(th => {
      const key = th.getAttribute('data-sort');
      const go = () => toggleSort(key);
      th.addEventListener('click', go);
      th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }
}

// ── Edit session lifecycle ──────────────────────────────────────────────────

// Open the session: snapshot every editable field referenced by the current rows into a frozen `_orig`
// + a mutable `_draft`, lock undo/redo, and re-render into edit mode.
function beginEdit() {
  if (_editing) return;
  buildDraft();
  _editing = true;
  setLocked(true);    // (#7) undo/redo can't run mid-edit — the draft is the only pending change
  render();
}

// Snapshot the editable props of each field that appears (as source or target) in the rendered rows.
// Keyed objId::fid so a field denormalised across N rows is snapshot once.
function buildDraft() {
  _draft = new Map();
  _orig = new Map();
  _linkDraft = new Map();
  _linkOrig = new Map();
  const snap = (objId, fid) => {
    if (!objId || !fid) return;
    const key = draftKeyOf(objId, fid);
    if (_draft.has(key)) return;
    const f = fieldOf(graph.getCell(objId), fid);
    if (!f) return;
    const s = { objId, fid, apiName: f.apiName || '', label: f.label || '', type: f.type || '', sampleValues: f.sampleValues || '', keyType: f.keyType || null, required: !!f.required, length: f.length || '', deprecated: !!f.deprecated };
    _orig.set(key, { ...s });
    _draft.set(key, { ...s });
  };
  // Mapping-link props (Mapping Type + Expression). Snapshot the EFFECTIVE expression the row shows
  // (prop → legacy fallback → visual label) so the input opens on the current text.
  const snapLink = (linkId) => {
    if (!linkId || _linkDraft.has(linkId)) return;
    const l = graph.getCell(linkId);
    if (!l) return;
    const s = { linkId, mappingType: mappingTypeOf(l), expressionRule: (l.prop('expressionRule') || l.prop('mappingLabel') || linkLabelText(l) || '').trim() };
    _linkOrig.set(linkId, { ...s });
    _linkDraft.set(linkId, { ...s });
  };
  for (const r of _lastRows) { snap(r._srcObjId, r._srcFid); snap(r._tgtObjId, r._tgtFid); snapLink(r._linkId); }
}

// True when a draft field differs from its snapshot on any editable prop (required compared as a boolean).
const fieldDirty = (d, o) => !!o && EDIT_PROPS.some(p => (BOOL_PROPS.has(p) ? !!d[p] !== !!o[p] : (d[p] ?? '') !== (o[p] ?? '')));

// Number of fields whose draft differs from the snapshot — counted per field (not per cell), so a
// denormalised field or a coupled key+nullable flip still reads as a single changed field.
function pendingChangeCount() {
  if (!_draft || !_orig) return 0;
  let n = 0;
  for (const [key, d] of _draft) if (fieldDirty(d, _orig.get(key))) n++;
  if (_linkDraft) for (const [id, d] of _linkDraft) if (linkDirty(d, _linkOrig.get(id))) n++;
  return n;
}

// Close the session: optionally commit the draft (one history entry), then drop the buffers + unlock
// undo/redo. Re-renders out of edit mode when the table is showing.
function endEditSession(commit) {
  if (commit) applyEdits();
  _editing = false;
  _draft = null;
  _orig = null;
  _linkDraft = null;
  _linkOrig = null;
  setLocked(false);   // (#10) buttons live again — Save's batch (if any) is now the top undo entry
  if (_active) render();
}

export function saveEdits() { if (_editing) endEditSession(true); }
export function cancelEdits() { if (_editing) endEditSession(false); }
export function isEditing() { return _editing; }

// Commit the draft → graph: for every field whose draft differs from its snapshot, write the merged props
// back, grouped per object into ONE `fields` set, all inside a single undo batch (#10). Existing fields
// only — nothing is added or removed. `_applying` suppresses the diagram-edit watcher (#9).
function applyEdits() {
  if (!graph || !_draft || !_orig) return;
  const byObj = new Map();   // objId -> Map(fid -> draftState)
  for (const [key, d] of _draft) {
    if (!fieldDirty(d, _orig.get(key))) continue;
    if (!byObj.has(d.objId)) byObj.set(d.objId, new Map());
    byObj.get(d.objId).set(d.fid, d);
  }
  const linkChanges = [...(_linkDraft || new Map())].filter(([id, d]) => linkDirty(d, _linkOrig.get(id)));
  if (!byObj.size && !linkChanges.length) return;
  _applying = true;
  startBatch();
  try {
    for (const [objId, changes] of byObj) {
      const o = graph.getCell(objId);
      if (!o?.get) continue;
      const fields = (o.get('fields') || []).map(f => {
        const d = f?.fid && changes.get(f.fid);
        if (!d) return f;
        const merged = { ...f };
        for (const p of EDIT_PROPS) merged[p] = d[p];   // writes every editable prop from the draft
        return merged;
      });
      o.set('fields', fields);   // DataObjectView re-renders the field rows; no resize (count is unchanged)
    }
    // Mapping-level props (one undo batch with the field writes). syncMappingTypeBadge runs off the
    // change:mappingType handler; the expression note is plain prop state read back by buildData.
    for (const [linkId, d] of linkChanges) {
      const l = graph.getCell(linkId);
      if (!l?.prop) continue;
      const o = _linkOrig.get(linkId);
      if (d.mappingType !== o.mappingType) l.prop('mappingType', d.mappingType);
      if ((d.expressionRule || '') !== (o.expressionRule || '')) l.prop('expressionRule', d.expressionRule);
    }
  } finally {
    endBatch();
    _applying = false;
  }
}

// ── Draft mutators (called from the in-cell controls) ───────────────────────

// Text / picklist input → write the draft prop, re-tint the cell in place, refresh the change tally.
function onFieldInput(el) {
  const d = _draft?.get(el.dataset.k);
  if (!d) return;
  d[el.dataset.prop] = el.value;
  const td = el.closest('td');
  if (td) {
    const o = _orig?.get(el.dataset.k);
    td.classList.toggle('df-tbl__cell--changed', !!o && (d[el.dataset.prop] ?? '') !== (o[el.dataset.prop] ?? ''));
  }
  updateRowRevert(el.closest('tr'));
  refreshChangeCount();
}

// Mapping-level (link) Mapping Type / Expression input → write the link draft, re-tint, refresh the tally.
function onLinkInput(el) {
  const d = _linkDraft?.get(el.dataset.link);
  if (!d) return;
  d[el.dataset.lprop] = el.value;
  const td = el.closest('td');
  if (td) {
    const o = _linkOrig?.get(el.dataset.link);
    td.classList.toggle('df-tbl__cell--changed', !!o && (d[el.dataset.lprop] ?? '') !== (o[el.dataset.lprop] ?? ''));
  }
  updateRowRevert(el.closest('tr'));
  refreshChangeCount();
}

// ── Per-row revert (#4) ─────────────────────────────────────────────────────
// A row's stable identity: its mapping link (mapped row) or its source field key (unmapped row).
const rowKeyOf = (r) => r._mapped ? String(r._linkId || '') : draftKeyOf(r._srcObjId || '', r._srcFid || '');
const revertBtnHtml = (r) => `<button type="button" class="df-tbl__revert" data-row="${escHtml(rowKeyOf(r))}" title="Revert this row to its original values" aria-label="Revert row">${ICON_UNDO}</button>`;
// Live-toggle a row's revert button after a text/select edit (those don't re-render, to keep the caret):
// show it the moment the row becomes changed, drop it when it returns to pristine.
function updateRowRevert(tr) {
  const cell = tr?.querySelector('.df-tbl__revcol');
  if (!cell) return;
  const row = _lastRows.find(x => rowKeyOf(x) === cell.dataset.row);
  if (!row) return;
  const changed = rowChanged(row), has = !!cell.querySelector('.df-tbl__revert');
  if (changed && !has) {
    cell.innerHTML = revertBtnHtml(row);
    cell.querySelector('.df-tbl__revert').addEventListener('click', () => revertRow(row));
  } else if (!changed && has) {
    cell.innerHTML = '';
  }
}
const rowFieldKeys = (r) => {
  const keys = [];
  if (r._srcObjId && r._srcFid) keys.push(draftKeyOf(r._srcObjId, r._srcFid));
  if (r._tgtObjId && r._tgtFid) keys.push(draftKeyOf(r._tgtObjId, r._tgtFid));
  return keys;
};
// True when any of the row's field/link drafts differ from their snapshot.
function rowChanged(r) {
  if (!_draft) return false;
  for (const k of rowFieldKeys(r)) { const d = _draft.get(k), o = _orig.get(k); if (d && o && fieldDirty(d, o)) return true; }
  if (r._linkId && _linkDraft) { const d = _linkDraft.get(r._linkId), o = _linkOrig.get(r._linkId); if (d && o && linkDirty(d, o)) return true; }
  return false;
}
// Reset just this row's field + link drafts back to their snapshots (a denormalised field reverts on
// every row it appears in — they share one draft entry), then re-render.
function revertRow(r) {
  if (!_draft) return;
  for (const k of rowFieldKeys(r)) if (_draft.has(k) && _orig.has(k)) _draft.set(k, { ..._orig.get(k) });
  if (r._linkId && _linkDraft?.has(r._linkId) && _linkOrig?.has(r._linkId)) _linkDraft.set(r._linkId, { ..._linkOrig.get(r._linkId) });
  render();
}

// Key checkbox (pk/fk/fqk) — mutually exclusive, so checking one clears the others (a field has ONE
// keyType). A PK / FQK is inherently mandatory → auto-mark required (mirrors the diagram field editor).
function toggleKey(key, token) {
  const d = _draft?.get(key);
  if (!d) return;
  if (d.keyType === token) d.keyType = null;
  else { d.keyType = token; if (token === 'pk' || token === 'fqk') d.required = true; }
}

// Nullable checkbox — the inverse of required. No-op for a PK / FQK (always mandatory; the box is locked).
function toggleNullable(key) {
  const d = _draft?.get(key);
  if (!d || d.keyType === 'pk' || d.keyType === 'fqk') return;
  d.required = isNullable(d);   // was nullable → become required (not-nullable), and vice-versa
}

// Plain boolean checkbox (Deprecated) — flip the draft prop.
function toggleBool(key, prop) {
  const d = _draft?.get(key);
  if (d) d[prop] = !d[prop];
}

function refreshChangeCount() {
  const el = container?.querySelector('#tbl-note');
  if (!el) return;
  const n = pendingChangeCount();
  el.textContent = `${n} unsaved change${n === 1 ? '' : 's'}`;
}

// ── Leave / dual-source guards ──────────────────────────────────────────────

// (#8) Tab-switch veto: with a session open, block the switch and prompt Save / Discard / Keep editing.
// `proceed` re-runs the original switch once the user resolves (Save or Discard closes the session first).
export function guardLeave(proceed) {
  if (!_editing) return true;     // nothing pending — allow the switch
  if (pendingChangeCount() === 0) { endEditSession(false); return true; }   // empty session — drop it silently, allow the switch
  if (_guardOpen) return false;   // already prompting — just block
  showEditGuard('leave', proceed);
  return false;
}

// (#9) A schema edit landed in the diagram view while a session is open elsewhere — surface the conflict.
function onDiagramSchemaEdit() {
  if (!_editing || _active || _applying || _guardOpen) return;
  if (pendingChangeCount() === 0) { endEditSession(false); return; }   // no table edits to protect — just drop the session
  showEditGuard('diagram', null);
}

// (#5) "Keep editing" in the diagram-edit guard: undo the change the user just made in the diagram view
// (it's the top history entry — recording isn't blocked, only undo execution) and keep the session open.
// Momentarily lift the undo lock, suppress the watcher during the revert, then re-lock.
function revertDiagramEdit() {
  setLocked(false);
  _applying = true;
  try { undo(); } finally { _applying = false; setLocked(true); }
}

// A graph swap (tab close/switch, session restore, import-replace) makes the draft meaningless — drop it
// silently so it can't zombie the undo lock or write into the wrong graph.
function abortSessionOnReset() {
  if (!_editing) return;
  _editing = false;
  _draft = null;
  _orig = null;
  _linkDraft = null;
  _linkOrig = null;
  setLocked(false);
}

// Shared Save / Discard overlay. `mode` 'leave' (tab switch) offers a third "Keep editing"; 'diagram'
// (dual-source) forces a resolution. `proceed` (leave mode) continues the blocked navigation afterwards.
function showEditGuard(mode, proceed) {
  if (_guardOpen) return;
  _guardOpen = true;
  const n = pendingChangeCount();
  const plural = n === 1 ? '' : 's';
  // Each button NAMES its target so it's unambiguous which changes it affects — important in 'diagram'
  // mode, where the user just edited the DIAGRAM. Discard/Save always act on the TABLE edits; the left
  // button is mode-specific: 'leave' aborts the tab switch ("Keep editing"); 'diagram' undoes the
  // just-made diagram change (#5) and returns to the table.
  const keepLabel = mode === 'diagram' ? 'Undo diagram change' : 'Keep editing';
  const { body, footer, close } = buildModal({
    title: 'Unsaved table edits',
    className: 'df-confirm-modal',
    zIndex: 10002,
    width: '520px',          // fit the explicit "… table edits" labels on one row
    showClose: false,
    dialogClass: 'df-confirm-modal__dialog',
    bodyClass: 'df-confirm-modal__body',
    footerClass: 'df-confirm-modal__footer',
    footerHtml: `<button type="button" class="df-modal__btn df-tbl-guard__keep" style="margin-right:auto">${escHtml(keepLabel)}</button>
      <button type="button" class="df-modal__btn df-modal__btn--danger df-tbl-guard__discard">Discard table edits</button>
      <button type="button" class="df-modal__btn df-modal__btn--primary df-tbl-guard__save">Save table edits</button>`,
    onClose: () => { _guardOpen = false; },
  });
  body.textContent = mode === 'diagram'
    ? `You have ${n} unsaved edit${plural} in the mapping table, and you just changed the diagram too. Save or discard your table edits (the diagram change stays), or undo the diagram change to keep editing the table.`
    : `You have ${n} unsaved edit${plural} in the mapping table. Save them to the diagram or discard them before leaving this tab.`;
  footer.querySelector('.df-tbl-guard__keep').addEventListener('click', () => {
    close();
    if (mode === 'diagram') { revertDiagramEdit(); _requestTableView?.(); }   // undo the diagram edit + go back to the table
  });
  footer.querySelector('.df-tbl-guard__discard').addEventListener('click', () => { close(); endEditSession(false); proceed?.(); });
  footer.querySelector('.df-tbl-guard__save').addEventListener('click', () => { close(); endEditSession(true); proceed?.(); });
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

// CSV export of a row set. A BOM keeps Excel honest about UTF-8; display-only em-dashes
// are stripped. The export uses the prefixed `csv` label (Source/Target …) since the flat
// file loses the colour-coded section headers that disambiguate the short on-screen labels.
function exportRowsCsv(rows) {
  const esc = v => {
    let s = String(v ?? '').trim();
    if (s === '—') s = '';
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = COLUMNS.map(c => esc(c.csv || c.label)).join(',');
  const lines = (rows || []).map(r => COLUMNS.map(c => esc(r[c.key])).join(','));
  downloadCsv('﻿' + [header, ...lines].join('\r\n'), 'mapping');
}

// Download a ready-made CSV string as df_<tab>_<suffix>.csv.
function downloadCsv(csv, suffix) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `df_${sanitizeFilenamePart(getActiveTabName(), 'tab')}_${suffix}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// In-view export button: the schema CSV in model mode (reuses data-export.js for an identical file),
// otherwise exactly the mapping rows on screen (current sort + Show-Unmapped state).
function exportCsv() {
  if (isModelMode()) downloadCsv(buildObjectSchemaCsv(graph), 'schema');
  else exportRowsCsv(_lastRows);
}

// Save → Export to CSV entry (Data Mapping): build the lineage rows fresh from the graph so
// it works whether or not the table view is open, using the default order + Show-Unmapped on.
export function exportMappingCsv() {
  if (!graph) return;
  exportRowsCsv(buildData().rows);
}

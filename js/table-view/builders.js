// Row-model builders for the Table view (S9 extraction). PURE projection logic: given a JointJS
// `graph` (the only external dependency) they compute the mapping / model / gantt row objects the
// facade renders. Extracted from table-view.js so the fragile ER-cardinality + mapping-type logic
// is Node-unit-testable against a FAKE graph (the graph is passed in, never read from module scope).
//
// The graph interface used here is narrow: getElements() / getLinks() / getCell(id) /
// getConnectedLinks(cell), and per-cell .id / .get(prop) / .attr(path) / .prop(name) / .labels().
// A test fake implementing just those drives every builder below.
import { keyImpliesRequired } from '../field-model.js?v=1.23.0';
import { ganttRowLayout, ganttDependencies } from '../gantt-layout.js?v=1.23.0';
import { durationDays } from '../gantt-scale.js?v=1.23.0';
import { FLOW_ELEMENTS } from '../shapes/flow.js?v=1.23.0';

// ── Property evaluation helpers (graph-free — operate on a passed cell) ──────
export const fidOfPort = port => (typeof port === 'string' && port.startsWith('field-'))
  ? port.replace(/^field-(left|right)-/, '') : null;
export const objName = o => (o && o.attr && o.attr('headerLabel/text')) || (o && o.get('name')) || 'Object';
export const fieldOf = (o, fid) => (o && fid) ? (o.get('fields') || []).find(f => f && f.fid === fid) : null;
export const linkLabelText = l => l.labels?.()?.[0]?.attrs?.text?.text || '';
export const yn = b => (b ? 'Yes' : '');

// A container's visual label (Zone → label/text, Container/DataObject → headerLabel/text).
export const containerLabel = c => c ? (c.attr('label/text') || c.attr('headerLabel/text') || c.get('name') || '') : '';

// ── ER relationship metadata (Data Targets "Cardinality / Related Object / Related
// Field" columns) ──────────────────────────────────────────────────────────────────
// Map a single link END's crow's-foot / bar / circle marker `d` path to a cardinality
// token. Mirrors the detection in properties.js detectMarker but returns the readable
// token directly (e.g. crow's foot → "Many"). '' when the end has no ER marker.
export function erEndToken(markerAttr) {
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
export function cardinalityOf(graph, srcObj, tgtObj) {
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
export function dataLayerOf(graph, obj) {
  if (!obj) return '[No Mapping Layer]';
  const pid = obj.get('parent');
  const parent = pid && graph.getCell(pid);
  if (!parent) return '[No Mapping Layer]';
  return containerLabel(parent) || '[Layer]';
}

// MAPPING TYPE = the Data Cloud transform classification. Reads the link's explicit
// `mappingType` prop (Standard / Formula / Streaming Transform / Batch Transform /
// Calculated Insight); falls back to the legacy transform/mappingRule, default 'Standard'.
export const MAPPING_TYPES = ['Standard', 'Formula', 'Streaming Transform', 'Batch Transform', 'Calculated Insight'];
export function mappingTypeOf(link) {
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
export const TYPE_GROUP = {};
(function buildTypeGroups() {
  const add = (group, types) => types.forEach(t => { TYPE_GROUP[t.toLowerCase()] = group; });
  add('text', ['Text', 'ID', 'Lookup', 'Master-Detail', 'Phone', 'Email', 'URL', 'Picklist', 'Multi-Picklist', 'Text Area', 'Long Text Area', 'Rich Text Area', 'Auto Number']);
  add('number', ['Number', 'Currency', 'Percent']);
  add('boolean', ['Checkbox', 'Boolean']);
  add('date', ['Date']);
  add('datetime', ['DateTime']);
})();
// W1 normaliser (1.22.0): fold real-world / warehouse type SPELLINGS into the same groups, so the
// cross-cloud warn can actually fire on authored diagrams. Measured 2026-08-07 across every bundled
// mapping template + org proof: ZERO warns fired anywhere, because the authored templates use strings
// like 'Date Time' (73 fields), varchar(255), nvarchar, timestamp and bit - none in TYPE_GROUP - and
// typeGroupsDiffer returns false when either side is unclassified. Normalising alone takes MCN Email
// from 59/93 to 93/93 both-sides-classifiable and fires its ONE genuine warn (bit -> Text on
// IsTestSend). Deliberately NOT an SF_FIELD_TYPES extension: the edit picklist stays Salesforce-only;
// these spellings arrive via CSV import / LLM authoring and only need to CLASSIFY, not to be offered.
export const groupOf = type => {
  const s = String(type || '').trim().toLowerCase();
  if (!s) return null;
  if (TYPE_GROUP[s]) return TYPE_GROUP[s];
  if (/^(n?varchar|n?char|string)/.test(s)) return 'text';                 // varchar(n) / nvarchar / char(n) / string
  if (s === 'date time' || /^(timestamp|datetime|smalldatetime)/.test(s)) return 'datetime';   // 'Date Time' with a space, timestamp, datetime2
  if (s === 'bit' || s === 'bool') return 'boolean';
  if (/^(int|bigint|smallint|tinyint|decimal|numeric|float|real|double)/.test(s)) return 'number';
  return null;
};
// True only when BOTH types are classifiable AND fall in different groups.
export const typeGroupsDiffer = (a, b) => { const ga = groupOf(a), gb = groupOf(b); return !!(ga && gb && ga !== gb); };

export function srcCells(graph, obj, field) {
  // A PK / FQK is mandatory, so it's never nullable even if `required` wasn't set explicitly.
  const notNull = field?.required || keyImpliesRequired(field?.keyType);
  return {
    srcDataLayer: dataLayerOf(graph, obj),
    srcObject: objName(obj),
    srcCategory: obj?.get('category') || '',   // Data Cloud category (Profile / Engagement / Other)
    srcApi: field?.apiName || '',
    // Label falls back to apiName, mirroring tgtLabel (and the canvas's label-first row render) -
    // the source side used to blank out where the target side showed the API name (M2, 1.22.0).
    srcLabel: field?.label || field?.apiName || '',
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

export function buildData(graph, { showUnmapped } = {}) {
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
    const tNotNull = tF?.required || keyImpliesRequired(tF?.keyType);
    rows.push({
      ...srcCells(graph, sObj, sF),
      cardinality: cardinalityOf(graph, sObj, tObj),    // the Source↔Target ER relationship (or em-dash)
      mappingType: mType,
      expressionRule: expr || '—',               // dimmed em-dash = clean pass-through
      tgtDataLayer: dataLayerOf(graph, tObj),
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
  if (showUnmapped) {
    for (const o of objects) for (const f of (o.get('fields') || [])) {
      if (!f || !f.fid || participated.has(`${o.id}::${f.fid}`)) continue;
      rows.push({ ...srcCells(graph, o, f), cardinality: '', mappingType: '', expressionRule: '', tgtDataLayer: '', tgtObject: '', tgtCategory: '', tgtApi: '', tgtLabel: '', tgtType: '', tgtPk: '', tgtFk: '', tgtFqk: '', tgtNullable: '', tgtSampleValues: '', tgtDeprecated: '', _tgtDeprecated: false, _warn: false, _mapped: false });
    }
  }

  return { rows, mappingCount: rows.filter(r => r._mapped).length, objectCount: objsInvolved.size, unmappedCount };
}

// C4 (1.22.0): which object does this field's relationship point at? Resolved from the ER links
// ANCHORED ON THE FIELD's port (field-left-<fid> / field-right-<fid>) - the model table showed
// PK/FK/FQK flags but never the counterpart, while 2 of 3 authored datamodel templates draw every
// relationship field-anchored (mce-email 15/15, mce-mobile 8/8; org proof 42/66 FKs). 'unlinked'
// marks ONLY a key row (FK/FQK) with no anchoring link - a PK is the referenced END of a
// relationship, not a reference, so it never reads 'unlinked'; a plain field stays blank.
// `markUnlinked` (buildModelData passes it per-diagram): a diagram whose relationships are ALL
// object-anchored (mcn-consent style, zero field-anchored ER links anywhere) cannot resolve ANY
// field, so 'unlinked' there would be 43 rows of false alarm about an authoring-style difference -
// the column stays blank instead and C2's all-empty suppression removes it.
export function referencesOf(graph, obj, field, markUnlinked = true) {
  if (!graph || !obj || !field?.fid) return '';
  const names = [];
  for (const l of graph.getConnectedLinks(obj)) {
    if (l.prop('linkKind') === 'mapping') continue;   // mapping links are lineage, not structure
    const s = l.get('source'), t = l.get('target');
    // The counterpart end of a link anchored on THIS field (either direction).
    const other = (s?.id === obj.id && fidOfPort(s?.port) === field.fid) ? t
      : (t?.id === obj.id && fidOfPort(t?.port) === field.fid) ? s : null;
    if (!other?.id) continue;
    const cell = graph.getCell(other.id);
    const name = cell ? objName(cell) : '';
    if (name && !names.includes(name)) names.push(name);
  }
  if (names.length) return names.join(', ');
  return (markUnlinked && (field.keyType === 'fk' || field.keyType === 'fqk')) ? 'unlinked' : '';
}

// Data MODEL projection: one row per field across every DataObject (graph order). Reuses srcCells so the
// shared field edit-controls + strikethrough work unchanged; adds Length + a Deprecated display cell +
// the References column (C4).
export function buildModelData(graph) {
  const objects = graph.getElements().filter(e => e.get('type') === 'sf.DataObject');
  // 'unlinked' is a knowable-reason cell only where field-anchored resolution is possible at all
  // (see referencesOf) - one pass over the links decides it for the whole diagram.
  const markUnlinked = graph.getLinks().some(l => l.prop('linkKind') !== 'mapping'
    && (fidOfPort(l.get('source')?.port) || fidOfPort(l.get('target')?.port)));
  const rows = [];
  for (const o of objects) for (const f of (o.get('fields') || [])) {
    if (!f || !f.fid) continue;
    rows.push({ ...srcCells(graph, o, f), srcLength: f.length || '', srcDeprecatedEdit: yn(!!f.deprecated), srcReferences: referencesOf(graph, o, f, markUnlinked), _mapped: false, _model: true });
  }
  return { rows, mappingCount: 0, objectCount: objects.length, unmappedCount: 0, fieldCount: rows.length };
}

// Phase 5: project the Gantt plan — one row per sf.GanttTask bar across every timeline, in ganttRowLayout
// order (grouped bars stay together). Dates are the source of truth; Duration / Dependencies / Group are
// derived. Read-only in phase 5. `_barId`/`_tlId` are carried for the (5b) edit write-back + per-row keys.
export function buildGanttData(graph) {
  const timelines = graph.getElements().filter(e => e.get('type') === 'sf.GanttTimeline');
  const labelOf = (id) => { const c = graph.getCell(id); return c ? (c.get('taskLabel') || c.attr('label/text') || 'Task') : id; };
  const rows = [];
  for (const tl of timelines) {
    const groups = tl.get('groups') || [];
    for (const lr of ganttRowLayout(tl)) {
      if (lr.kind !== 'bar') continue;
      const bar = lr.bar;
      const start = bar.get('startDate') || '', end = bar.get('endDate') || '';
      const dur = (start && end) ? durationDays(start, end) : null;
      const deps = ganttDependencies(bar).map(d => labelOf(d.predecessorId)).join(', ');
      const g = bar.get('groupId') ? groups.find(x => x.id === bar.get('groupId')) : null;
      const prog = bar.get('progress');
      rows.push({
        _barId: bar.id, _tlId: tl.id,
        name: bar.get('taskLabel') || bar.attr('label/text') || 'Task',
        start, end,
        duration: (dur != null) ? `${dur}d` : '',
        progress: (prog != null && prog !== '') ? `${prog}%` : '',
        assignee: bar.get('assignee') || '',
        dependencies: deps || '—',
        group: (g && g.label) || '—',
      });
    }
  }
  return { rows, taskCount: rows.length, timelineCount: timelines.length };
}

// C2 (1.22.0): read-mode column auto-suppression. A column that is BLANK in every rendered row
// ('' or the em-dash placeholder) is dropped from the visible set - measured on every real diagram
// in the corpus: Sample Values / Deprecated blank on 12/12, Length + FQK on 5/5 model tables, and
// 8 of 25 visible mapping columns blank on every imported mapping. Constant columns are KEPT
// (Nullable reading 'Yes' 118/118 is a fact, not noise) with ONE exception: when every type across
// the type column(s) is a single distinct value, the type check has nothing to compare, so the
// column(s) collapse into a note line instead of restating one word N times. Callers apply this in
// READ mode only - edit mode always renders the full set (the first sample value must be typeable
// into an empty column) - and the CSV export stays on the full column contract.
const BLANK_PLACEHOLDER = '\u2014';   // the em-dash placeholder cells render (escape: no literal dash in source)
export const isBlankCell = v => { const s = String(v ?? '').trim(); return s === '' || s === BLANK_PLACEHOLDER; };
export function suppressColumns(cols, rows) {
  if (!rows?.length) return { cols, hidden: 0, typeNote: '' };   // empty table: nothing to measure, hide nothing
  const TYPE_KEYS = ['srcType', 'tgtType'];
  const typeVals = new Set();
  for (const key of TYPE_KEYS) {
    if (!cols.some(c => c.key === key)) continue;
    for (const r of rows) if (!isBlankCell(r[key])) typeVals.add(String(r[key]).trim());
  }
  const collapseTypes = typeVals.size === 1;
  const keep = cols.filter(c => {
    if (collapseTypes && TYPE_KEYS.includes(c.key)) return false;
    return rows.some(r => !isBlankCell(r[c.key]));
  });
  return {
    cols: keep,
    hidden: cols.length - keep.length,
    typeNote: collapseTypes ? `all fields typed ${[...typeVals][0]} - type check has nothing to compare` : '',
  };
}

// ── F1-F3 (1.22.2): the Flow Table view projection ───────────────────────────
// Flow is the one diagram type whose cards carry far more in the PROPERTY PANEL than on the canvas -
// measured across four real flows, 31,393 chars of panel `details` against 6,282 on the cards, and 92%
// of cards carry panel-only facts. Reading that meant 91 one-at-a-time panel clicks with no search and
// no pinning. These builders project the two things the measurement said were worth a table: what the
// flow WRITES (incl. which fields more than one element writes - the "what stomps this field" answer,
// which was reachable nowhere in the app at any number of clicks) and how it BRANCHES.
//
// Column defs live HERE rather than beside VIS / MODEL_COLUMNS / GANTT_COLUMNS in table-view.js, on
// purpose: a section's `columns` travel WITH its `rows` inside the section object, so the renderer is a
// pure consumer and these unit tests can pin column keys without importing the renderer.
// `wrap: true` mirrors the existing `center: true` flag - see the .df-tbl__cell--wrap rule in canvas.css.
// The Elements spine columns. `exportJoin` is consumed by flow-table.js flatRow (via exportCellText
// below): the DOM renders a multi-link cell as a LIST (newline + the pre-line wrap rule), but the CSV
// and Markdown forms join with '; ' - verified on real CSVs that a newline join mangles line-based
// grep, the one consumption pattern a flat export exists to serve.
export const FLOW_ELEMENT_COLUMNS = Object.freeze([
  { key: 'element', label: 'Element', sortable: true },
  { key: 'apiName', label: 'apiName', sortable: true },
  { key: 'type', label: 'Type', sortable: true },
  { key: 'config', label: 'Configuration', wrap: true },
  { key: 'previous', label: 'Previous', wrap: true, exportJoin: '; ' },
  { key: 'next', label: 'Next', wrap: true, exportJoin: '; ' },
]);
export const FLOW_WRITE_COLUMNS = Object.freeze([
  { key: 'element', label: 'Element', sortable: true },
  { key: 'apiName', label: 'apiName', sortable: true },
  { key: 'op', label: 'Op', sortable: true },
  { key: 'object', label: 'Object', sortable: true },
  { key: 'where', label: 'Where', wrap: true },
  { key: 'field', label: 'Field', sortable: true },
  { key: 'value', label: 'Value', wrap: true },
]);
export const FLOW_PIVOT_COLUMNS = Object.freeze([
  { key: 'object', label: 'Object', sortable: true },
  { key: 'field', label: 'Field', sortable: true },
  // Deliberately NOT click-sortable: sortRows is lexicographic, so '10' would sort before '3'. The
  // section already arrives sorted by contention DESC, which IS the finding.
  { key: 'writerCount', label: 'Written by', csv: 'Written by (count)', center: true },
  { key: 'writers', label: 'Elements', wrap: true },
]);
export const FLOW_DECISION_COLUMNS = Object.freeze([
  // The LABEL speaks the spine's grammar - every identity-leading section opens Element | apiName.
  // The KEY deliberately stays 'decision': column keys are per-section (nothing shares or joins on
  // them), so renaming it would ripple through the row builder and every pin for zero reader-visible
  // change.
  { key: 'decision', label: 'Element', sortable: true },
  { key: 'apiName', label: 'apiName', sortable: true },
  { key: 'outcome', label: 'Outcome', sortable: true },
  { key: 'takenWhen', label: 'Taken when', wrap: true },
  { key: 'goesTo', label: 'Goes to', sortable: true, wrap: true },
]);
// Assets: element-first (owner-directed re-grain) - the same Element | apiName identity pair the
// writes and decision sections lead with, so every identity-carrying section reads in one grammar.
// The reference splits into Asset ID + Asset Name (splitAssetRef below - the resolver's own
// "id (Name)" shape, a producer contract); both reference cells wrap (a CMS id alone is ~85 chars).
// On a no-org flow every Asset Name is '' and generic C2 suppression folds the column away - no
// special case here or in the renderer. No multi-line cell remains, so no exportJoin either.
export const FLOW_ASSET_COLUMNS = Object.freeze([
  { key: 'element', label: 'Element', sortable: true },
  { key: 'apiName', label: 'apiName', sortable: true },
  { key: 'kind', label: 'Kind', sortable: true },
  { key: 'assetId', label: 'Asset ID', sortable: true, wrap: true },
  { key: 'assetName', label: 'Asset Name', sortable: true, wrap: true },
]);

const WRITE_OPS = {
  'df.FlowCreateRecords': 'Create',
  'df.FlowUpdateRecords': 'Update',
  'df.FlowDeleteRecords': 'Delete',
};
// A Create carrying match criteria is an UPSERT, and flow-convert.js argues that is the single fact a
// reader most needs ("could this create duplicates?"). This head row is the ONLY evidence: a Create
// never gets a `filters` prop - the converter deliberately routes the criteria into `details` instead,
// because `filters` reads as "where" on Get/Update/Delete and would say the wrong thing here.
const UPSERT_HEAD_LABEL = 'Matches existing on';
// A details row whose label is a Salesforce FIELD API NAME is a field write; every label the converter
// authors itself is a PHRASE containing a space ('Records from', 'Matches existing on', 'If several
// match'). Identifier-vs-phrase, not English-matching: 0 false positives across ~160 assignment labels
// on a real 14-Create flow, FSL__GanttLabel__c included. It also degrades SAFELY - a head row added
// later also contains a space, so it lands in Where rather than being misfiled as a field write, which
// is the failure that would corrupt the pivot.
const FIELD_API_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;
// capRows truncates ANY details array at 20 loud rows with exactly this row. It is not a field:
// rendered as one it invents a field called "+3 more"; dropped, a 30-field Create reads as a 20-field
// Create while the property panel tells the truth.
const TRUNCATION_RE = /^\+\d+ more$/;
// A Go To link's label is REWRITTEN at load to `${label} →` (link-styles.js flowGoToLabelAttrs, via
// migration.js) while the outcome row still says the bare name. Strip with the same rule link-styles.js
// uses, or every Go To branch's "Goes to" silently comes back blank - and it is invisible in the saved
// JSON, so a fixture test passes while the real app shows nothing.
const stripArrow = s => String(s || '').replace(/\s*→\s*$/, '').trim();
// `details` is DROPPED when empty (flow-convert.js skips zero-length arrays) and is not a shape default
// (FLOW_CONTENT_PROPS), so a hand-drawn card has none at all - never an empty array to iterate.
const detailsOf = el => { const d = el.get('details'); return Array.isArray(d) ? d : []; };
const displayName = el => String(el.get('name') || el.get('apiName') || '');

// id -> the name to SHOW for that element, qualified `Name [apiName]` only when the display name is
// ambiguous. Measured: one real decision's outcomes point at two different cells BOTH named "Create
// Bundle WO", so a bare name there answers nothing; on a unique name the apiName is noise.
function nameDisambiguator(graph) {
  const counts = new Map();
  for (const e of graph.getElements()) {
    const n = displayName(e);
    if (n) counts.set(n, (counts.get(n) || 0) + 1);
  }
  return (id) => {
    const el = id && graph.getCell(id);
    if (!el) return '';
    const n = displayName(el), api = el.get('apiName') || '';
    return (n && api && counts.get(n) > 1) ? `${n} [${api}]` : n;
  };
}

// ── The Elements spine (post-1.22.2): one row per flow element, in execution order ──
// The shipped three sections read only 48/215 elements (22%) across five real flows - 0/10 on a
// marketing journey, 3/93 on a flow whose machinery is 38 Apex Action calls - while 93% of elements
// carry real data. The spine is the lead section that covers ALL of them: one row per df.Flow* card,
// its per-kind scalar props, and its labelled incoming/outgoing connectors. It rides ABOVE the typed
// sections, never instead of them.

// type -> its FLOW_ELEMENTS row: the card-subtitle Type label, the per-kind `fields` list (which
// scalar props exist on this kind) and the per-element fieldLabels override (template -> Email/SMS/...).
const FLOW_DEF = new Map(FLOW_ELEMENTS.map(e => ['df.Flow' + e.cls, e]));

// Labels for the per-kind scalar props, mirroring the panel's FIELD_SPECS (properties/renderers-flow.js).
// A MIRROR, not an import, on purpose: FIELD_SPECS is module-private inside a renderer that imports the
// panel DOM stack, and pulling that chain in here would cost this module its Node-testability. The
// parity test in dev/tests/table-builders.test.js parses the renderer's SOURCE (registry-sync style),
// so a label drift fails CI instead of shipping a cell that disagrees with the panel.
export const FLOW_FIELD_LABELS = {
  processType: 'Process Type', triggerType: 'Trigger Type', object: 'Object', filters: 'Filters',
  components: 'Screen Components', actionName: 'Action Name', actionType: 'Action Type',
  flowName: 'Referenced Flow', waitEvents: 'Wait Events', stageSteps: 'Steps',
  assignmentItems: 'Assignments', outcomes: 'Outcomes', collectionReference: 'Collection',
  conditions: 'Conditions', transformTarget: 'Target', message: 'Error Message', template: 'Template',
  activation: 'Activation', configuration: 'Configuration',
};

// Configuration = the element's per-kind SCALAR props only, "Label: value" segments joined with the
// converter's own ' · '. The `details` rows are deliberately EXCLUDED - measured as the wall-of-text
// driver (31,393 panel chars across four flows) - and values stay verbatim per the free-text rule.
// The CELL is capped at ~200 chars: whole segments are dropped first ("+N more (see panel)"), and a
// single over-cap segment is sliced ("... (see panel)") - real, not hypothetical: a 632-char
// assignmentItems and a 293-char components both exist in the bundled specimens.
const CONFIG_CELL_CAP = 200;
function flowConfigCell(el, def) {
  const segs = [];
  for (const key of (def?.fields || [])) {
    const v = el.get(key);
    const s = v == null ? '' : String(v).trim();
    if (!s) continue;
    segs.push(`${def?.fieldLabels?.[key] || FLOW_FIELD_LABELS[key] || key}: ${s}`);
  }
  if (!segs.length) return '';
  const kept = [];
  let len = 0;
  for (const s of segs) {
    const next = len + (kept.length ? 3 : 0) + s.length;   // 3 = the ' · ' separator
    if (kept.length && next > CONFIG_CELL_CAP) break;      // always keep the first segment
    kept.push(s); len = next;
  }
  let text = kept.join(' · ');
  const dropped = segs.length - kept.length;
  const sliced = text.length > CONFIG_CELL_CAP;
  if (sliced) text = text.slice(0, CONFIG_CELL_CAP).trimEnd() + '...';
  if (dropped) text += ` +${dropped} more (see panel)`;
  else if (sliced) text += ' (see panel)';
  return text;
}

// One Previous/Next entry per CONNECTOR: "[label -> ] element-name", the connector label (fault labels
// included) prefixed when present. The label runs through stripArrow because a Go To label is rewritten
// at load to `${label} →` (same normalisation the decision join needs). Duplicate connectors are NOT
// deduped - a doubled edge is a finding on a hand-drawn draft, not noise.
const spineLinkEntry = (l, otherEndId, labelOf) => {
  const label = stripArrow(linkLabelText(l));
  const name = labelOf(otherEndId);
  return label ? `${label} -> ${name}` : name;
};

/** The spine rows, ordered by a BFS walk over outgoing links from the Start element - NEVER JSON cell
 *  order, which is a save artifact: measured 13-61% of adjacent pairs inverted across five real flows,
 *  listing a journey's waits before its emails. Flows contain CYCLES (20 loops on one real flow), so
 *  the walk carries a visited set and every element appears exactly once. Elements unreachable from
 *  Start are APPENDED in stable cell order - their blank Previous on a non-Start row is itself a
 *  finding on a hand-drawn draft. No Start element at all falls back to cell order without crashing
 *  (the walk visits nothing and the append emits everything). */
export function flowSpineRows(graph, labelOf) {
  // df.Flow* cards only: the __flowmeta/__flowresources df.Table cards and the sf.Link URL chip are
  // canvas furniture, not flow topology, and notes/labels can share the canvas too.
  const elements = graph.getElements().filter(e => String(e.get('type') || '').startsWith('df.Flow'));
  const idSet = new Set(elements.map(e => e.id));
  const order = [];
  const visited = new Set();
  // Every Start seeds the walk (in cell order): a converted flow has exactly one, but a hand-drawn
  // draft can hold two, and walking only the first would dump the second Start's whole branch into
  // the unreachable append.
  const queue = elements.filter(e => e.get('type') === 'df.FlowStart');
  for (const s of queue) visited.add(s.id);
  while (queue.length) {
    const el = queue.shift();
    order.push(el);
    for (const l of graph.getConnectedLinks(el)) {
      if (l.get('source')?.id !== el.id) continue;
      const tid = l.get('target')?.id;
      if (!tid || visited.has(tid) || !idSet.has(tid)) continue;
      visited.add(tid);
      queue.push(graph.getCell(tid));
    }
  }
  for (const el of elements) if (!visited.has(el.id)) order.push(el);

  return order.map(el => {
    const prev = [], next = [];
    for (const l of graph.getConnectedLinks(el)) {
      const s = l.get('source')?.id, t = l.get('target')?.id;
      // A self-loop lists in BOTH columns - it is one connector stating two facts about this element.
      if (t === el.id && idSet.has(s)) prev.push(spineLinkEntry(l, s, labelOf));
      if (s === el.id && idSet.has(t)) next.push(spineLinkEntry(l, t, labelOf));
    }
    const def = FLOW_DEF.get(el.get('type'));
    return {
      _elId: el.id,
      element: labelOf(el.id),
      apiName: el.get('apiName') || '',
      // An unknown df.Flow* type (a future class this build predates) degrades to its class suffix
      // rather than a blank - the row still identifies itself.
      type: def?.label || String(el.get('type')).replace(/^df\.Flow/, ''),
      config: flowConfigCell(el, def),
      previous: prev.join('\n'),
      next: next.join('\n'),
    };
  });
}

// The flat-export form of one cell: a column carrying `exportJoin` converts the DOM's newline list to
// that join. Lives HERE (not in flow-table.js flatRow, which calls it) so the join contract is pinned
// by the same Node tests that pin the column defs it rides on.
export const exportCellText = (col, v) => {
  const s = String(v ?? '');
  return col.exportJoin ? s.split('\n').join(col.exportJoin) : s;
};

// ── Flow Facts + Flow Resources (export-only): the converter card label/value rows ─────────
// The exports' IDENTITY header (facts) and its follow-up, the flow's resource glossary. There is
// deliberately NO on-screen section for either - both cards are already tables ON the canvas, and
// restating them in the view was analysed and killed (backlog, Flow Table View kill list). The
// EXPORT channel is different on named new information the kill never weighed: a CSV or Markdown
// handed to a colleague carries no canvas, so without these blocks the file said nothing about
// WHICH flow it documents (facts, shipped 2026-08-15) and nothing about the formulas, templates and
// variables its element rows keep referring to (resources, the follow-up the facts entry named).
// Both ride the exports only; the render path never calls either.
// The discriminator is the converter's FIXED cell id ('__flowmeta' / '__flowresources' -
// flow-convert.js emits both, migration.js resolves both by the same ids) - never "the first
// df.Table", which would grab the OTHER converter card or a user-authored table, and never
// tableLabel, which holds free text (the flow's own title on the facts card). Type and row shape
// are still checked per card: an LLM-authored save can put anything at a fixed id, and garbage must
// degrade to "no block", never crash an export mid-click. Rows come back VERBATIM (converter-
// authored free text - never parsed or reformatted here; CSV/GFM escaping is the writers' job) as
// FRESH pairs, so no caller can reach the live cell prop through the return.
function converterCardRows(graph, id) {
  const card = graph?.getCell?.(id);
  if (!card || card.get('type') !== 'df.Table') return [];
  const raw = card.get('rows');
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(r => Array.isArray(r) && String(r[0] ?? '').trim() !== '')   // a labelless row states nothing
    .map(r => [String(r[0]), String(r[1] ?? '')]);
}
export function flowFactsRows(graph) { return converterCardRows(graph, '__flowmeta'); }
export function flowResourceRows(graph) { return converterCardRows(graph, '__flowresources'); }

// F1: one row per DETAILS row, not one per element. `object` may be absent (an Update using
// inputReference converts with no `object` key at all) and `filters` is never set on a Create.
function flowWriteRows(graph) {
  const rows = [];
  for (const el of graph.getElements()) {
    const baseOp = WRITE_OPS[el.get('type')];
    if (!baseOp) continue;
    const assignments = [], context = [], truncations = [];
    for (const d of detailsOf(el)) {
      const label = String(d?.label ?? ''), value = String(d?.value ?? '');
      if (TRUNCATION_RE.test(label)) truncations.push({ label, value });
      else if (FIELD_API_RE.test(label)) assignments.push({ field: label, value });
      else context.push({ label, value });
    }
    // Reuse the converter's OWN authored phrasing verbatim rather than inventing new English, and the
    // ' · ' separator it already uses, so a head row added later self-documents in this column.
    const where = [String(el.get('filters') || ''), ...context.map(c => `${c.label}: ${c.value}`)]
      .filter(Boolean).join(' · ');
    const op = (baseOp === 'Create' && context.some(c => c.label === UPSERT_HEAD_LABEL)) ? 'Upsert' : baseOp;
    const base = {
      _elId: el.id,
      element: displayName(el),
      apiName: el.get('apiName') || '',
      op,
      object: el.get('object') || '',
      where,
    };
    // Element / apiName / Op / Object / Where repeat on EVERY row in the row model - never a rowspan,
    // never a blanked repeat: the headers are click-to-sort, and blanked repeats become lies after a sort.
    for (const a of assignments) rows.push({ ...base, field: a.field, value: a.value });
    // Zero assignments still emits ONE row. That is the `Records from` bulk-write case (real on Create
    // AND Update AND Delete) and the hand-drawn-card case; dropping it hides a real write from the one
    // table whose job is to list the writes.
    if (!assignments.length) rows.push({ ...base, field: '', value: '' });
    for (const t of truncations) rows.push({ ...base, field: t.label, value: t.value, _muted: true });
  }
  return rows;
}

// F2: which (object, field) pairs are written by more than one element, and by which.
function flowFieldPivot(writeRows, labelOf) {
  const groups = new Map();
  for (const r of writeRows) {
    if (r._muted || !r.field) continue;
    // An OBJECTLESS write can never be compared, so it is never grouped. The standard bulk-update shape
    // (`inputReference` + `inputAssignments` - "use the IDs from a record collection, and set their
    // fields individually") converts with no `object` key at all, so two such Updates on genuinely
    // DIFFERENT objects both key as ''. Grouping them reported a stomp that does not exist, and because
    // every such row's Object cell is blank, C2 then suppressed the Object column and removed the only
    // clue - a fabricated answer, unfalsifiable from the UI. Reproduced: two Updates setting `Status`,
    // one on ServiceAppointments and one on WorkOrders, rendered as "Status | 2 | two different values".
    // Dropping them costs a real conflict only when BOTH writers are objectless, which follows
    // flow-convert.js's own rule that a missing row invites a question while a wrong row ends it.
    if (!r.object) continue;
    // Key is object AND field. Measured: ten field names (Description, Subject, City, ContactId,
    // Country, Duration, DurationType, PostalCode, State, Street) each appear on BOTH
    // ServiceAppointment and WorkOrder in one real flow. Field-alone keying manufactures conflicts that
    // do not exist - the exact opposite of this section's purpose, and unfalsifiable from the UI.
    // The pipe separator cannot collide: a `field` reached this far only by matching FIELD_API_RE, so it
    // holds nothing outside [A-Za-z0-9_.] and can never carry the separator itself.
    const key = `${r.object}|${r.field}`;
    let g = groups.get(key);
    if (!g) { g = { object: r.object, field: r.field, writers: new Map() }; groups.set(key, g); }
    // Writers are DISTINCT elements: one element listing the same field twice is one writer, and the
    // first value is the one the property panel shows first.
    if (!g.writers.has(r._elId)) g.writers.set(r._elId, { label: labelOf(r._elId), op: r.op, value: r.value });
  }
  const rows = [];
  for (const g of groups.values()) {
    // N=1 answers nothing the writes section above does not already state verbatim; including it would
    // reproduce that whole section a second time.
    if (g.writers.size < 2) continue;
    rows.push({
      object: g.object,
      field: g.field,
      writerCount: String(g.writers.size),
      // One writer per line, and the VALUE is the actual answer: two elements writing the same value is
      // benign, two writing different values is the stomp.
      writers: [...g.writers.values()]
        .map(w => `${[w.label, `(${w.op})`].filter(Boolean).join(' ')}${w.value ? ` = ${w.value}` : ''}`)
        .join('\n'),
    });
  }
  // Contention DESC first - the most-written field is the finding.
  rows.sort((a, b) => (Number(b.writerCount) - Number(a.writerCount))
    || a.object.localeCompare(b.object) || a.field.localeCompare(b.field));
  return rows;
}

// F3: one row per decision OUTCOME, joined to the outbound connector whose label matches it, resolved
// to the TARGET element's name. Only df.FlowDecision - df.FlowEinsteinDecision is an actionCalls shape
// with no outcome rows.
function flowDecisionRows(graph, labelOf) {
  const rows = [];
  let outcomeCount = 0, decisionCount = 0;
  for (const el of graph.getElements()) {
    if (el.get('type') !== 'df.FlowDecision') continue;
    decisionCount++;
    const decision = displayName(el), apiName = el.get('apiName') || '';
    const byLabel = new Map();
    // getConnectedLinks + a source filter, not `{ outbound: true }` - the pattern used above and the
    // one the unit-test fake implements.
    for (const l of graph.getConnectedLinks(el)) {
      if (l.get('source')?.id !== el.id) continue;
      const key = stripArrow(linkLabelText(l));
      if (!byLabel.has(key)) byLabel.set(key, []);
      byLabel.get(key).push(l);
    }
    // Resolves whatever link list it is handed. Two links sharing a label resolve to BOTH - legal after a
    // copy/paste, and it is the bug the reader wants to see, not something to hide behind a first-match -
    // EXCEPT where the positional pairing below narrows the list first. A target the graph no longer holds
    // is skipped rather than rendered as a raw id.
    const targetsFor = links => (links || []).map(l => labelOf(l.get('target')?.id)).filter(Boolean).join(', ');
    // Flow enforces uniqueness on a rule's API NAME, not on its `label`, so two outcomes can legitimately
    // share one display label - and then the union below put BOTH targets in BOTH rows, so the row reading
    // "Same | v = 2" claimed to go somewhere it does not. When a label's outcome count and link count
    // agree, pair them POSITIONALLY instead: flow-convert.js walks `el.rules` once, pushing one details
    // row and exactly one edge per rule (a rule with no connector still emits one, via addDeadBranch), so
    // the Nth outcome carrying a label is the Nth link carrying it. When the counts disagree the order
    // proves nothing - a hand-drawn or copy/pasted duplicate connector - so it falls back to the union,
    // which is the bug the reader wants to see rather than a guess.
    const outcomesPerLabel = new Map();
    for (const d of detailsOf(el)) {
      const l = String(d?.label ?? '');
      if (TRUNCATION_RE.test(l)) continue;
      const k = stripArrow(l);
      outcomesPerLabel.set(k, (outcomesPerLabel.get(k) || 0) + 1);
    }
    const seenPerLabel = new Map();
    const used = new Set();
    for (const d of detailsOf(el)) {
      const outcome = String(d?.label ?? ''), takenWhen = String(d?.value ?? '');
      if (TRUNCATION_RE.test(outcome)) { rows.push({ _elId: el.id, decision, apiName, outcome, takenWhen, goesTo: '', _muted: true }); continue; }
      // The join key is NORMALISED on BOTH sides; the raw label is what the Outcome cell still shows.
      // The link side has always run through stripArrow, so an outcome label carrying stray whitespace
      // (authored diagram JSON can hold one - flow-xml.js trims every leaf, so an import cannot) missed
      // its own connector: a blank "Goes to" AND a spurious trailing muted row for the same branch.
      const key = stripArrow(outcome);
      const links = byLabel.get(key);
      const i = seenPerLabel.get(key) || 0;
      seenPerLabel.set(key, i + 1);
      const paired = (links && links.length === outcomesPerLabel.get(key)) ? [links[i]] : links;
      used.add(key);
      outcomeCount++;
      rows.push({ _elId: el.id, decision, apiName, outcome, takenWhen, goesTo: targetsFor(paired) });
    }
    // Every outbound connector the outcome list does not account for. This catches (a) the converter's
    // own 'Default Outcome' edge, drawn when a decision has a defaultConnector but no
    // defaultConnectorLabel, for which outcomeRows emits no row at all, and (b) every branch of a
    // HAND-DRAWN decision, which has no `details` whatsoever. Nothing is invented - `takenWhen` stays
    // blank, and the muted styling says "this came from the canvas, not from the imported outcome list".
    for (const [outcome, links] of byLabel) {
      if (used.has(outcome)) continue;
      rows.push({ _elId: el.id, decision, apiName, outcome, takenWhen: '', goesTo: targetsFor(links), _muted: true });
    }
  }
  return { rows, outcomeCount, decisionCount };
}

// ── Assets (post-1.22.2, owner-directed re-grain): the marketing references, element-first ────────
// One row per (element, asset reference) - segment, message content, subscription, sender, data graph -
// the same repeat-the-element grammar as the writes and decision sections, in spine (execution) order
// of the referencing element and details order within one element. The DEDUP-WITH-COUNT design this
// section shipped with is deliberately RETIRED, superseded by owner direction for cross-section
// consistency; the used-in-N-places finding remains discoverable by sorting on Asset ID, which groups
// the repeats. Everything is still read off the detail rows already on the cells (the converter
// resolved names at conversion time) - no org call here.
//
// The Kind vocabulary is DERIVED from what flow-convert.js emits, never invented here:
// - 'Data graph' / 'Segment' are the Start card's converter-authored row labels (flow-convert.js
//   startDetails: the `st.dataGraph` / `st.segment` emitters, beside 'Publish segment' which is a flag,
//   not an asset);
// - a send element's details are its RAW action input parameters (flow-convert.js actionParamRows
//   pushes `label: p.name` verbatim), so 'contentId' / 'communicationSubscriptionId' /
//   'commSubscriptionChannelTypeId' / 'senderId' are Salesforce's own parameter names. The CLI
//   resolver (flow-to-diagramforce.mjs resolveReferences, the --org path) appends ' (Name)' to the
//   VALUE in place - the resolver's own MECHANICAL output shape, a producer contract this section is
//   allowed to parse back apart (splitAssetRef below). The section shipped with the cell verbatim
//   under the free-text rule, but that over-applied it: the rule's real purpose - never corrupt
//   AUTHORED text - survives in splitAssetRef's fallback, which passes anything not in the
//   resolver's shape through whole. A flow converted without --org lists the same assets honestly,
//   just nameless (bare ids in Asset ID, a blank Asset Name).
// 'contentId' alone cannot name its channel - the same parameter carries email, SMS, WhatsApp, push
// and in-app content - so its Kind comes from the element TYPE, mirroring the ACTION_CLASS mapping
// that typed the card at conversion (flow-convert.js: sendEmailMessage -> df.FlowSendEmail,
// sendSmsMessage -> df.FlowSendSms, sendWhatsAppMessage / sendMobileAppMessage /
// sendMobileInAppMessage likewise). A contentId on any OTHER type (a send kind the converter maps to
// the generic df.FlowAction) is skipped rather than guessed at - the closed Kind list follows
// flow-convert.js's own rule that a missing row invites a question while a wrong row ends it.
const CONTENT_KIND = {
  'df.FlowSendEmail': 'Email content',
  'df.FlowSendSms': 'SMS content',
  'df.FlowSendWhatsApp': 'WhatsApp content',
  'df.FlowSendMobileApp': 'Mobile app content',
  'df.FlowSendMobileInApp': 'In-app content',
};
// These three labels identify their kind on their OWN: they are action parameter names (only an
// actionCalls-derived card can carry them), so they are matched wherever they appear - the same
// scoping the CLI resolver uses, which walks EVERY card's details rather than a type list.
const ID_ASSET_KIND = {
  communicationSubscriptionId: 'Subscription',
  commSubscriptionChannelTypeId: 'Subscription channel',
  senderId: 'Sender',
  // The CLASSIC Send Email action (flow-convert.js emailSimple, also typed df.FlowSendEmail) carries an
  // EmailTemplate reference, not CMS content - a kind the marketing audience owns wall-to-wall. Added as
  // a deliberate extension after review flagged it emitted-but-skipped; the id-only map is safe because
  // the label is an API param name, not a phrase (the Start-card collision rule below does not apply).
  emailTemplateId: 'Email template',
};
// The Start card's labels are converter-authored PHRASES, so they are honoured only on df.FlowStart -
// matching them on any card would let an action parameter that happens to be named 'Segment' collide.
const START_ASSET_KIND = { 'Segment': 'Segment', 'Data graph': 'Data graph' };

// "id (Name)" -> { assetId, assetName }. Parses ONE producer's format: flow-to-diagramforce.mjs
// resolveReferences appends ' (Name)' to the reference it resolved, so the shape is mechanical, not
// authored. Split at the FIRST ' (' and drop exactly ONE trailing ')' - sound because an id can never
// contain space+paren (Salesforce ids and CMS keys have no spaces), and first-match keeps NESTED
// parens inside the name intact: the real journey's '...EWA (Spring Arrivals Promotion Email (1))'
// names 'Spring Arrivals Promotion Email (1)'. Anything NOT in that shape - no ' (', or no trailing
// ')' - is NOT the resolver's output (a bare no-org id, the Data graph developer name, a hand-typed
// or unbalanced value) and passes through WHOLE as the id with a blank name: the free-text rule's
// never-corrupt-authored-text purpose lives in this fallback. Neither half is trimmed or reshaped
// beyond the split itself - what the converter wrote is what the two cells carry.
function splitAssetRef(v) {
  const cut = v.indexOf(' (');
  if (cut === -1 || !v.endsWith(')')) return { assetId: v, assetName: '' };
  return { assetId: v.slice(0, cut), assetName: v.slice(cut + 2, -1) };
}

// One row per qualifying DETAIL row: the referencing element leads (Element | apiName, through the
// shared disambiguator), then Kind and the split reference. `spineEls` is the execution-ordered
// element list the spine walk already produced - assets must read in the order a reader walks the
// flow, and recomputing the BFS here would fork it. Cards the spine does not list (non-df.Flow*)
// are still scanned AFTER it in graph order: the ID_ASSET_KIND labels match wherever they appear
// (the CLI resolver's own scoping, which walks every card), and narrowing that to flow cards would
// silently drop a reference an authored save put elsewhere. Repeats are NOT deduped - within one
// element a doubled reference is a finding (the writes grain's own rule), and across elements the
// repeat IS the grammar now. The `template` scalar on a send card is deliberately NEVER read: it
// duplicates the contentId detail row's key (flow-convert.js ACTION_CLASS routes
// contentKey(actionParam(el, 'contentId')) into `template`), and the DETAIL row is the richer form -
// it carries the full reference plus the resolved '(Name)'. Reading both would double-count one
// element's one reference; reading only the scalar would drop the name --org paid a query for.
// Each row carries ONE _elId - exactly what qualifies it for the nav-button cell the renderer
// stamps on identity-carrying rows (chrome only: no column def, so no filter/export/C2 surface).
function flowAssetRows(graph, labelOf, spineEls) {
  const rows = [];
  const addRef = (kind, value, el) => {
    const v = String(value ?? '');
    if (!v.trim()) return;   // an empty value names no asset
    rows.push({
      _elId: el.id,
      element: labelOf(el.id),
      apiName: el.get('apiName') || '',
      kind,
      // The split is projection only - what the converter wrote is what the two cells carry.
      ...splitAssetRef(v),
    });
  };
  const inSpine = new Set(spineEls.map(e => e.id));
  const scan = [...spineEls, ...graph.getElements().filter(e => !inSpine.has(e.id))];
  for (const el of scan) {
    const type = String(el.get('type') || '');
    const contentKind = CONTENT_KIND[type];
    const isStart = type === 'df.FlowStart';
    for (const d of detailsOf(el)) {
      const label = String(d?.label ?? '');
      // No TRUNCATION_RE guard, deliberately: the label maps are CLOSED literals, and none of them can
      // ever equal a '+N more' cap-row label, so a guard here would be unkillable belt-and-braces.
      if (isStart && START_ASSET_KIND[label]) addRef(START_ASSET_KIND[label], d?.value, el);
      else if (contentKind && label === 'contentId') addRef(contentKind, d?.value, el);
      else if (ID_ASSET_KIND[label]) addRef(ID_ASSET_KIND[label], d?.value, el);
    }
  }
  return rows;
}

/** The whole Flow Table view row model: five stacked sections (the Elements spine + the three typed
 *  drill-downs + Assets) + the counts the band insights report.
 *  Pure - `graph` is the only input (getElements / getCell / getConnectedLinks / cell.get / cell.labels).
 *  Blank cells are ALWAYS '' - isBlankCell above treats only '' and the em-dash as blank, so a hyphen
 *  placeholder here would defeat column suppression entirely and Show All Columns would never appear. */
export function buildFlowSections(graph) {
  const labelOf = nameDisambiguator(graph);
  const elementRows = flowSpineRows(graph, labelOf);
  const writeRows = flowWriteRows(graph);
  const contestedRows = flowFieldPivot(writeRows, labelOf);
  const { rows: decisionRows, outcomeCount, decisionCount } = flowDecisionRows(graph, labelOf);
  // Assets ride the spine's execution order - the ordered elements are recovered from the spine rows
  // rather than re-walked, so the two sections can never disagree about what "execution order" means.
  const assetRows = flowAssetRows(graph, labelOf, elementRows.map(r => graph.getCell(r._elId)));
  const anyFieldWrite = writeRows.some(r => !r._muted && r.field);
  return {
    sections: [
      {
        // The spine leads: it is the one section that covers EVERY element, so it is the section a
        // reader orients from before the typed drill-downs below.
        id: 'elements', title: 'Elements', columns: FLOW_ELEMENT_COLUMNS, rows: elementRows,
        // This line can only render if some OTHER section has rows while the spine has none, and every
        // typed section reads df.Flow* elements the spine also lists - so it is unreachable today and
        // exists as the crash-guard consistency contract every section carries.
        empty: 'No flow elements on this canvas.',
      },
      {
        id: 'writes', title: 'Data Writes', columns: FLOW_WRITE_COLUMNS, rows: writeRows,
        // Scoped to what this section actually SCANS (WRITE_OPS). "No record writes on this flow" was
        // false on a real flow whose only writes are actionCalls - the converter also emits
        // df.FlowCreateTask and df.FlowCreateCampaignMember, and both write records.
        empty: 'No Create, Update or Delete Records elements on this flow.',
      },
      {
        id: 'contested', title: 'Fields Written by More Than One Element', columns: FLOW_PIVOT_COLUMNS, rows: contestedRows,
        // Two-way, because the absence means different things - and NO contested field is a good
        // result, not a missing one, so neither reads like an apology.
        empty: anyFieldWrite ? 'No field is written by more than one element.' : 'No field-level writes to compare.',
      },
      {
        // 'Decision Elements', not 'Decisions': the band speaks the spine's grammar (the sections
        // list ELEMENTS), and the empty copy names the one type this section scans - the Data
        // Writes precedent ('Decision' is the card-subtitle Type; df.FlowEinsteinDecision has no
        // outcome rows and is out of scope, so "no decisions" would overclaim).
        id: 'decisions', title: 'Decision Elements', columns: FLOW_DECISION_COLUMNS, rows: decisionRows,
        empty: 'No Decision elements on this flow.',
      },
      {
        // Last on purpose: the typed sections keep their shipped order, and assets arrived last. The
        // empty copy names what the section actually SCANS (the Data Writes precedent) - segments,
        // the five content channels, subscriptions, senders, data graphs - not "no assets", which
        // would overclaim on a flow whose references simply are not the kinds read here.
        id: 'assets', title: 'Assets', columns: FLOW_ASSET_COLUMNS, rows: assetRows,
        empty: 'No segments, message content, subscriptions, senders or data graphs referenced by this flow.',
      },
    ],
    elementCount: elementRows.length,
    // GRAIN: rendered write ROWS, which is what the table below shows - NOT a field-write total. A Delete
    // with no assignments contributes 1, and a 25-field Create contributes the 20 the converter's cap
    // kept (the `+5 more` row is muted, so it is excluded). Kept deliberately: the note and the visible
    // rows agree, and the cap row states the remainder on screen.
    writeCount: writeRows.filter(r => !r._muted).length,   // truncation rows are not writes
    writeElementCount: new Set(writeRows.map(r => r._elId)).size,
    contestedCount: contestedRows.length,
    decisionCount,
    outcomeCount,
    // The writes shape: rendered asset ROWS (references) + the distinct elements referencing them.
    // assetRefCount MUST equal the section's row count - the filter's "N of M" invariant reads M off
    // the rows, and a band that disagrees with its own table is the bug the old dedup count risked.
    assetRefCount: assetRows.length,
    assetElementCount: new Set(assetRows.map(r => r._elId)).size,
  };
}

// ── Filter + Search (post-1.22.2): the PURE matching half of the table filter ─────────────────
// The DOM half (debounce, hidden-row toggling, count painting) lives in each renderer; this half is
// the contract worth pinning in Node tests - what a query MEANS, and what a row is matched against.
// The tooltip strings live here too because they document exactly this contract, and both renderers
// show them verbatim (one home for the copy, not one per topbar).
export const FILTER_TITLE = 'Case-insensitive text filter. Wrap in /slashes/ for a regular expression, /slashes/i for a case-insensitive one.';
export const FILTER_TITLE_INVALID = 'Invalid regular expression - matching the text literally';

/** parseFilter(raw) -> { empty, isRegex, invalid, test(cellText) }.
 *  Default = case-insensitive SUBSTRING. Wrapping the query in /slashes/ opts into a REGEX -
 *  case-SENSITIVE (regex is the expert mode; the default already covers insensitive), /slashes/i
 *  for an insensitive one. The form is STRICT (both slashes, non-empty pattern, flag '' or 'i'):
 *  a lone '/', '//', an unterminated '/x' or any other flag ('/x/g') is not a regex attempt, it is
 *  literal text. A pattern that fails to COMPILE ('/[/') must never throw out of here - typing is
 *  the one context where an exception is guaranteed to fire mid-word - so it falls back to literal
 *  substring on the RAW query (slashes included: the user typed them, the cells may hold them) and
 *  reports invalid: true so the renderer can tint the input instead of toasting every keystroke. */
export function parseFilter(raw) {
  const q = String(raw ?? '').trim();
  if (!q) return { empty: true, isRegex: false, invalid: false, test: () => true };
  const literal = (invalid) => {
    const needle = q.toLowerCase();
    return { empty: false, isRegex: false, invalid, test: s => String(s).toLowerCase().includes(needle) };
  };
  const m = /^\/(.+)\/(i?)$/.exec(q);
  if (!m) return literal(false);
  let re;
  try { re = new RegExp(m[1], m[2]); } catch { return literal(true); }   // compilation is the ONLY throw site
  return { empty: false, isRegex: true, invalid: false, test: s => re.test(String(s)) };
}

/** A row matches when ANY of the passed columns' cell text matches - per-cell OR, never a
 *  cross-cell join (a regex spanning two columns is meaningless to someone reading columns).
 *  `cols` is the RENDERED set, so exportOnly columns and `_`-prefixed internals are never
 *  searched: what matches is exactly what the user can see. */
export function rowMatchesFilter(row, cols, matcher) {
  if (!matcher || matcher.empty) return true;
  return cols.some(c => matcher.test(String(row[c.key] ?? '')));
}

// Stable, case-insensitive sort by the active column (graph order when unsorted).
export function sortRows(rows, { sortKey, sortDir } = {}) {
  if (!sortKey) return rows;
  const dir = sortDir === 'desc' ? -1 : 1;
  return rows
    .map((r, i) => [r, i])
    .sort((a, b) => {
      const av = String(a[0][sortKey] ?? '').toLowerCase();
      const bv = String(b[0][sortKey] ?? '').toLowerCase();
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a[1] - b[1];           // stable tiebreak on original index
    })
    .map(p => p[0]);
}

// Row-model builders for the Table view (S9 extraction). PURE projection logic: given a JointJS
// `graph` (the only external dependency) they compute the mapping / model / gantt row objects the
// facade renders. Extracted from table-view.js so the fragile ER-cardinality + mapping-type logic
// is Node-unit-testable against a FAKE graph (the graph is passed in, never read from module scope).
//
// The graph interface used here is narrow: getElements() / getLinks() / getCell(id) /
// getConnectedLinks(cell), and per-cell .id / .get(prop) / .attr(path) / .prop(name) / .labels().
// A test fake implementing just those drives every builder below.
import { keyImpliesRequired } from '../field-model.js?v=1.21.4';
import { ganttRowLayout, ganttDependencies } from '../gantt-layout.js?v=1.21.4';
import { durationDays } from '../gantt-scale.js?v=1.21.4';

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
export const groupOf = type => TYPE_GROUP[String(type || '').toLowerCase()] || null;
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

// Data MODEL projection: one row per field across every DataObject (graph order). Reuses srcCells so the
// shared field edit-controls + strikethrough work unchanged; adds Length + a Deprecated display cell.
export function buildModelData(graph) {
  const objects = graph.getElements().filter(e => e.get('type') === 'sf.DataObject');
  const rows = [];
  for (const o of objects) for (const f of (o.get('fields') || [])) {
    if (!f || !f.fid) continue;
    rows.push({ ...srcCells(graph, o, f), srcLength: f.length || '', srcDeprecatedEdit: yn(!!f.deprecated), _mapped: false, _model: true });
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

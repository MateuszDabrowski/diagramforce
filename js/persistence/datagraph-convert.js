// Data Cloud DATA GRAPH -> a Diagramforce Data Model diagram (1.22.0).
//
// A data graph is a TREE, not a mesh: one primary DMO, related objects hanging off it, each with their own.
// So the layout is a column per DEPTH with siblings stacked and each parent centred on its own subtree - the
// diagram reads the way the JSON does. A square grid would lose the one thing the reader came for.
//
// TWO INPUT SHAPES, both accepted, because the org offers both and they answer different questions:
//
//   1. The DEFINITION, from `/services/data/vXX.0/ssot/data-graphs/<DeveloperName>`: a `sourceObject` with
//      `label`, `name`, `fields[]` and `relatedObjects[]`, recursing. The RICHER one - real object and field
//      labels, `dataType`, and `isDGRootKeyField` / `isKeyColumn` flags, so the cards can mark their keys
//      accurately rather than by naming convention.
//
//   2. The PREVIEW payload, which is what the Data Cloud UI shows and what a user can copy straight out of it:
//        { "ssot__FirstName__c": <TEXT>, "IndividualIdentityLink__dlm": [ { … } ] }
//      Scalar keys are FIELDS of the current node; a key whose value is an ARRAY is a related object. The array
//      entries are sample ROWS of one type, so they are MERGED rather than drawn N times - and merged rather
//      than "take the first", because a preview omits nulls, so row 1 is not the schema.
//
// This file is the source of truth for both the app's paste path and the CLI script. The copy under
// `cowork-skill/diagramforce/scripts/` is a HAND copy (package:skill only zips that directory, it does not
// generate it) - byte-identity is enforced by dev/tests/skill-sync.test.js, same as flow-convert.js.

const CARD_W = 380;                     // narrower than the ERD's - a tree gets wide fast
const COL_GAP = 140, ROW_GAP = 56;
const HEADER_H = 32, ROW_H = 22, CARD_PAD = 18;
// One accent per tree DEPTH, so adjacent entries are the two columns a reader compares side by side.
// RESTATED from DF_ACCENT_CYCLE in js/persistence/diagram-palette.js (prefix of 7) rather than imported - this
// file is import-free so it can be hand-copied to the skill verbatim; dev/tests/diagram-palette.test.js fails
// if these drift from the palette. Every entry clears 3:1 on BOTH the light (#FAFAFA) and dark (#1A1A1A)
// canvas; the previous set had #E8912D at 2.36 and #12B76A at 2.51 on light, and a data graph is shared by URL
// into whichever theme the reader happens to run.
const ACCENTS = ['#1D73C9', '#BE5C2A', '#008B46', '#B652A7', '#00849E', '#DA4E55', '#8467C9'];

/** A Data Cloud DMO name reads as `ssot__ContactPointEmail__dlm`; a card wants "Contact Point Email". */
export const humaniseDmo = (name) => String(name || '')
  .replace(/__dlm$|__dll$|__c$/i, '')
  .replace(/^ssot__/i, '')
  .replace(/^KQ_/i, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/_+/g, ' ')
  .trim() || String(name || '');

/** `<TEXT>` / `<NUMBER>` / `<DATE>` -> a type the card understands. A preview with REAL data instead of the
 *  placeholders says just as much, so infer from the value too. */
function previewType(v) {
  if (v === null || v === undefined) return 'Text';
  const s = String(v);
  const tag = (/^<([A-Z]+)>$/.exec(s.trim()) || [])[1];
  if (tag) {
    return { TEXT: 'Text', NUMBER: 'Number', DATE: 'Date', DATETIME: 'DateTime', BOOLEAN: 'Checkbox' }[tag] || 'Text';
  }
  if (typeof v === 'number') return 'Number';
  if (typeof v === 'boolean') return 'Checkbox';
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return 'DateTime';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'Date';
  return 'Text';
}

// A preview carries no key flags, so these are the platform's own naming conventions - `ssot__Id__c` is the
// object's id and `KQ_` prefixes a key qualifier. Only used for the preview shape; the definition states them.
const looksKey = (api) => /^ssot__Id__c$/i.test(api);
// CASE-SENSITIVE `Id__c` on purpose: the /i form badged `Paid__c`, `Valid__c`, `Void__c`, `Grid__c` - any
// name ending in lowercase "id" - as foreign keys. `…Id__c` is the platform's own casing for a reference
// field; an all-lowercase real FK merely loses its badge, which is the milder failure than a confidently
// wrong one, and the CLI already warns that preview keys come from naming convention.
const looksFk = (api) => /^KQ_/i.test(api) || (/Id__c$/.test(api) && !/^ssot__Id__c$/i.test(api));

function fromDefinition(doc) {
  // Tolerant of shape lies: `fields: 5` or a null relatedObject entry arrives from hand-edited payloads, and
  // an uncaught TypeError here surfaces raw engine text in the paste toast. Wrong-typed collections read as
  // empty; null entries are skipped.
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  const node = (o) => ({
    name: o.name || o.projectedName || o.referenceDeveloperName || humaniseDmo(o.label),
    label: o.label || humaniseDmo(o.name),
    fields: arr(o.fields).map((f) => ({
      apiName: f.sourceFieldName || f.name,
      label: f.sourceFieldLabel || humaniseDmo(f.sourceFieldName || f.name),
      type: f.dataType || 'Text',
      // `isDGRootKeyField` is the graph's own primary key; `isKeyColumn` is a join key on a related object.
      keyType: f.isDGRootKeyField ? 'pk' : (f.isKeyColumn ? 'fk' : null),
    })),
    // `path[]` names the JOIN this related object hangs off - the parent field and the child field. The preview
    // payload cannot know this, which is why the edge label is definition-only.
    join: (() => {
      const p = (o.path || [])[0];
      if (!p) return null;
      return { parent: p.parentFieldName || p.parentFieldLabel, child: p.fieldName || p.fieldLabel };
    })(),
    children: arr(o.relatedObjects).map(node),
  });
  const root = node(doc.sourceObject || doc);
  return { root, name: doc.label || doc.name || root.label, kind: 'definition', meta: doc };
}

function fromPreview(doc, rootName) {
  const build = (obj, name, label) => {
    const fields = [], children = [];
    for (const [k, v] of Object.entries(obj || {})) {
      if (Array.isArray(v)) {
        const merged = {};
        for (const row of v) if (row && typeof row === 'object' && !Array.isArray(row)) Object.assign(merged, row);
        children.push(build(merged, k, humaniseDmo(k)));
      } else if (v && typeof v === 'object') {
        children.push(build(v, k, humaniseDmo(k)));          // a to-ONE related object
      } else {
        fields.push({ apiName: k, label: humaniseDmo(k), type: previewType(v),
          keyType: looksKey(k) ? 'pk' : (looksFk(k) ? 'fk' : null) });
      }
    }
    return { name, label, fields, children };
  };
  const root = build(doc, rootName || 'DataGraph', rootName ? humaniseDmo(rootName) : 'Data Graph');
  return { root, name: root.label, kind: 'preview' };
}

/**
 * Is this text a data graph? Deliberately strict, because it runs in the paste detector's chain ahead of the
 * generic "is this a Diagramforce document" describer - a false positive there produces a baffling error on a
 * perfectly good diagram. Two signals, and BOTH reject anything carrying `graph` / `diagramType`, which is what
 * lets a real Diagramforce document fall through.
 */
export function looksLikeDataGraphJson(text) {
  const t = String(text || '').trim();
  if (t[0] !== '{') return false;
  let doc;
  try { doc = JSON.parse(t); } catch { return false; }
  if (!doc || typeof doc !== 'object' || doc.graph || doc.diagramType) return false;
  if (doc.sourceObject && (doc.sourceObject.fields || doc.sourceObject.relatedObjects)) return true;
  // The LIST endpoint's shape is claimed ON PURPOSE: the paste card itself tells the user to fetch
  // /ssot/data-graphs/metadata to see what the org has, so pasting that response is a predictable first move.
  // Claiming it routes the paste to parseDataGraph, whose targeted "that is the LIST - fetch ONE by name"
  // error reaches the toast; unclaimed, the describer answered with a generic "Not recognised".
  if (Array.isArray(doc.dataGraphMetadata)) return true;
  // The preview shape: at least one key naming a Data Cloud object (`__dlm` / `__dll`) whose value is an array
  // or a nested object. A bare `{"a__dlm": 3}` is not a graph, and neither is a diagram that happens to mention
  // one in a label.
  return Object.entries(doc).some(([k, v]) => /__dl[lm]$/i.test(k)
    && (Array.isArray(v) || (v && typeof v === 'object')));
}

export function parseDataGraph(doc, rootName) {
  if (doc && typeof doc === 'object') {
    if (Array.isArray(doc.dataGraphMetadata)) {
      throw new Error('That is the data-graph LIST. Fetch ONE by name: /services/data/v64.0/ssot/data-graphs/<DeveloperName>.');
    }
    if (doc.sourceObject || Array.isArray(doc.relatedObjects)) return fromDefinition(doc);
  }
  return fromPreview(doc, rootName);
}

/** Depth-first, so a card's index is stable and the layout can walk levels. */
function flatten(root) {
  const out = [];
  const walk = (n, depth, parent) => {
    const i = out.length;
    out.push({ node: n, depth, parent });
    for (const c of n.children) walk(c, depth + 1, i);
  };
  walk(root, 0, null);
  return out;
}


/** "every 30 minutes" from `{ frequency: 30, timeGranularity: 'minute' }`, and the plural handled. */
function scheduleText(cfg) {
  const sch = cfg?.schedule;
  if (!sch || sch.frequency == null) return null;
  const n = Number(sch.frequency);
  const unit = String(sch.timeGranularity || 'minute').toLowerCase();
  return `every ${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** A Salesforce Connect date reads "Tue Jun 16 08:08:20 GMT 2026"; the card wants the day. */
const dayOf = (v) => {
  const m = /\b([A-Z][a-z]{2})\s+(\d{1,2})\b.*\b(\d{4})\b/.exec(String(v || ''));
  return m ? `${m[3]}-${m[1]}-${String(m[2]).padStart(2, '0')}` : (v ? String(v) : null);
};

/**
 * The graph's own facts, as a key/value card beside the tree - the same idea as a flow's meta card. Everything
 * here comes from the DEFINITION; a preview payload carries none of it, so the card is simply absent for a
 * paste. Rows are omitted rather than printed empty: a card of "-" tells the reader nothing and pushes the
 * facts that do exist off the top.
 */
function metaRows(doc) {
  if (!doc || typeof doc !== 'object') return [];
  const rows = [];
  const push = (k, v) => { if (v !== null && v !== undefined && String(v).trim() !== '') rows.push([k, String(v)]); };
  push('API Name', doc.name);
  push('Type', doc.type);                                   // 'realtime' | 'batch'
  push('Status', doc.status);
  push('Data space', doc.dataspaceName);
  push('Primary object', doc.primaryObjectLabel && doc.primaryObjectName
    ? `${doc.primaryObjectLabel} (${doc.primaryObjectName})` : doc.primaryObjectLabel || doc.primaryObjectName);
  push('Full refresh', scheduleText(doc.fullRefreshConfig));
  // `enabled: false` is a REAL answer here, unlike an unset flag - a reader deciding whether the graph is fresh
  // needs to know incremental refresh is off, not to be left guessing from its absence.
  if (doc.incrementalRefreshConfig) {
    push('Incremental refresh', doc.incrementalRefreshConfig.enabled
      ? (scheduleText(doc.incrementalRefreshConfig) || 'on') : 'off');
  }
  if (doc.isRealTimeToggleEnabled != null) push('Real time', doc.isRealTimeToggleEnabled ? 'yes' : 'no');
  if (doc.isRecordCachingDisabled != null) push('Record caching', doc.isRecordCachingDisabled ? 'off' : 'on');
  if (Number(doc.cacheDurationInDays) > 0) push('Cache duration', `${doc.cacheDurationInDays} days`);
  if (Number(doc.maxRecordsCached) > 0) push('Max records cached', doc.maxRecordsCached);
  if (doc.sessionEnd != null) push('Session ends after', `${doc.sessionEnd} ${String(doc.sessionEndTimeUnit || '').toLowerCase()}`.trim());
  push('Id DMO', doc.idDmoName);
  push('Values DMO', doc.valuesDmoName);
  push('Description', doc.description);
  push('Created', dayOf(doc.createdDate));
  push('Last modified', dayOf(doc.modifiedDate));
  push('Version', doc.version);
  return rows;
}

const ONE = 'M -12 -8 L -12 8 M -12 0 L 0 0';
const MANY = 'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0 M 3 -8 L 3 8';

export function buildDataGraphDiagram(parsed, { appVersion = '1.22.0', title = null } = {}) {
  const flat = flatten(parsed.root);
  const usedFids = new Set();
  const fidFor = (obj, api) => {
    const base = `${obj}_${api}`.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    let fid = base, n = 2;
    while (usedFids.has(fid)) fid = `${base}_${n++}`;
    usedFids.add(fid);
    return fid;
  };

  const h = (i) => HEADER_H + flat[i].node.fields.length * ROW_H + CARD_PAD;
  // Bottom-up, so a parent can be placed against the block its children occupy.
  const kids = flat.map((_, i) => flat.reduce((acc, e, j) => (e.parent === i ? acc.concat(j) : acc), []));
  const y = new Array(flat.length).fill(0);
  let cursor = 0;
  const place = (i) => {
    if (!kids[i].length) { y[i] = cursor; cursor += h(i) + ROW_GAP; return; }
    for (const k of kids[i]) place(k);
    const kk = kids[i];
    const top = y[kk[0]], bottom = y[kk[kk.length - 1]] + h(kk[kk.length - 1]);
    y[i] = top + (bottom - top) / 2 - h(i) / 2;
  };
  place(0);
  const minY = Math.min(...y);

  const cells = flat.map((e, i) => {
    const accent = ACCENTS[e.depth % ACCENTS.length];
    return {
      id: `dg-obj-${i}`, type: 'sf.DataObject', z: 2000,
      position: { x: 40 + e.depth * (CARD_W + COL_GAP), y: Math.round(40 + y[i] - minY) },
      size: { width: CARD_W, height: h(i) },
      // BOTH are required, and so are all three colour slots. `objectName` / `headerColor` are what the
      // properties PANEL reads; `attrs.headerLabel.text` / `attrs.header.fill` / `attrs.headerCover.fill` are
      // what actually RENDERS, and nothing syncs one to the other on load. Authoring only the props draws a row
      // of identically-blue cards all captioned "Object".
      objectName: e.node.label,
      headerColor: accent,
      attrs: { headerLabel: { text: e.node.label }, header: { fill: accent }, headerCover: { fill: accent } },
      showLabels: true, showFieldLengths: false,
      fields: e.node.fields.map((f) => ({
        label: f.label || f.apiName, apiName: f.apiName, type: f.type || 'Text',
        keyType: f.keyType ?? null, fid: fidFor(e.node.name || `n${e.depth}`, f.apiName),
      })),
    };
  });

  // Every edge in a data graph is to-MANY by construction: the preview renders each related object as an ARRAY,
  // and the definition's `relatedObjects` is the same relationship seen from the schema side. So the crow's foot
  // always sits at the CHILD end.
  //
  // OBJECT-level ports, not field ports, even though the definition DOES name the join (`path[]` carries the
  // parent and child field). Anchoring to those rows would look right on a definition and be undrawable on a
  // preview, which knows nothing about them - two visibly different diagrams from one data graph. The join is
  // said in the edge LABEL instead, which degrades honestly: present when the payload told us, absent when it
  // did not.
  let li = 0;
  for (let i = 0; i < flat.length; i++) {
    const p = flat[i].parent;
    if (p == null) continue;
    const accent = ACCENTS[flat[p].depth % ACCENTS.length];
    const join = flat[i].node.join;
    cells.push({
      id: `dg-rel-${++li}`, type: 'standard.Link', z: 3000,
      // The join, when the payload named it. This is the one thing a definition knows that a preview cannot,
      // and it is what turns "these two are related" into "related HOW" - which is the question a reader of a
      // data graph actually has.
      ...(join?.parent && join?.child
        ? { labels: [{ position: { distance: 0.5, offset: 0 },
            attrs: { text: { text: `${join.parent} = ${join.child}`, fontSize: 10, fill: accent } } }] }
        : {}),
      source: { id: `dg-obj-${p}`, port: 'er-right', magnet: 'circle' },
      target: { id: `dg-obj-${i}`, port: 'er-left', magnet: 'circle' },
      router: { name: 'sfManhattan' },
      connector: { name: 'rounded', args: { radius: 8 } },
      attrs: { line: {
        stroke: accent, strokeWidth: 2,
        sourceMarker: { d: ONE, fill: 'none', stroke: accent, 'stroke-width': 2, 'stroke-dasharray': 'none' },
        targetMarker: { d: MANY, fill: 'none', stroke: accent, 'stroke-width': 2, 'stroke-dasharray': 'none' },
      } },
    });
  }

  // ── The graph's own facts, beside the tree ────────────────────────────────────────────────────────────────
  // Placed in its own column to the LEFT of the root, and the tree shifted right to make room, rather than
  // above it: a data graph reads left-to-right, and a card sitting on top of the root would be the first thing
  // the eye hits on the way in.
  const meta = metaRows(parsed.meta);
  if (meta.length) {
    const META_W = 360, ROWH = 26, LABELH = 26;
    const metaH = LABELH + meta.length * ROWH + 12;
    for (const c of cells) if (c.position) c.position.x += META_W + COL_GAP;
    const rootY = cells[0]?.position?.y ?? 40;
    cells.push({
      id: '__dgmeta', type: 'df.Table', z: 2300,
      position: { x: 40, y: rootY },
      size: { width: META_W, height: metaH },
      tableLabel: parsed.name,
      rows: meta,
      highlightFirstRow: false,   // a key/value card: the LEFT column is the header, not the top row
      highlightFirstCol: true,
      // Imported data, not authored prose - a Description is a plain-text field in Salesforce, so reading its
      // `*` as markdown would be a coincidence rather than an intent. Same boundary the flow meta card draws.
      plainCells: true,
    });
  }

  return {
    diagram: {
      version: 1, appVersion, title: title || parsed.name,
      diagramType: 'datamodel', mappingMode: false,
      graph: { cells },
    },
    stats: { objects: flat.length, links: li, metaRows: meta.length, depth: Math.max(...flat.map((e) => e.depth)) + 1, kind: parsed.kind },
  };
}

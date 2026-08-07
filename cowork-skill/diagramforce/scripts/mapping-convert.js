// Data Cloud field mappings -> a `datamapping` diagram.
//
// Shared VERBATIM with cowork-skill/diagramforce/scripts/mapping-convert.js (a test enforces byte-identity),
// for the same reason flow-convert.js and flow-xml.js are: the app and the skill must produce byte-identical
// diagrams from the same mappings, whichever route the user took to get them.
//
// ── Two source shapes, one converter ─────────────────────────────────────────────────────────────────────────
// `ObjectSourceTargetMap` METADATA (`sf project retrieve start -m "ObjectSourceTargetMap:*"`) is the richer
// one: it carries `isSourceFormula` / `sourceFormula` and `filterApplied`, so the diagram gets its Formula
// companion cards and its Expression / Rule values. It is bulk, so it needs a `--only` selection.
//
// The CONNECT API (`/ssot/data-model-object-mappings?dmoDeveloperName=<DMO>`) is the accessible one: ONE GET,
// pasteable from Workbench's REST Explorer, which authenticates by browser OAuth and therefore works in orgs
// where the Salesforce CLI's connected app is blocked. Being DMO-scoped, it also solves the selection problem
// for free - the DMO you asked about IS the diagram. It costs the two enrichments above: measured across a
// real org, that is ~167 of 3661 field rows, about 5%. Everything structural survives, and it adds `status`.
//
// Both normalise to the same shape before `buildDiagram` sees them:
//   { name, source, target, fields: [{ sourceField, targetField, isFormula, formula, filtered, filterOp }] }

/** `Prospect_Home__dll.AnnualRevenue__c` -> ['Prospect_Home__dll', 'AnnualRevenue__c'].
 *  A BARE name (which is what the Connect API returns) yields [null, name], and the caller then falls back to
 *  the map's own source/target object - so the two payload shapes need no special-casing downstream. */
export const splitRef = (q) => { const i = String(q || '').indexOf('.'); return i < 0 ? [null, q] : [q.slice(0, i), q.slice(i + 1)]; };
/** Strip the Data Cloud suffixes and namespace for a readable card title / field label. */
export const pretty = (s) => String(s || '').replace(/__dll$|__dlm$/i, '').replace(/^ssot__/i, '').replace(/__c$/i, '');

/** Minimal XML reader for this one flat, known shape - no dependency. Text in, normalised maps out, so the
 *  file reading stays with the CLI and this module works unchanged in a browser. */
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) : null;
};
const blocks = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1]);
const decode = (s) => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** One `*.objectSourceTargetMap-meta.xml` document -> a normalised map, or null when it is not one. */
export function parseMappingXml(xml) {
  const source = tag(xml, 'sourceObjectName');
  const target = tag(xml, 'targetObjectName');
  if (!source || !target) return null;
  const fields = blocks(xml, 'fieldSourceTargetMaps').map((b) => ({
    sourceField: tag(b, 'sourceField'),          // null on a formula-sourced map - `<sourceField xsi:nil="true"/>`
    targetField: tag(b, 'targetField'),
    isFormula: /<isSourceFormula>true<\/isSourceFormula>/.test(b),
    formula: tag(b, 'sourceFormula'),
    filtered: /<filterApplied>true<\/filterApplied>/.test(b),
    filterOp: tag(b, 'filterOperationType'),
    creationType: tag(b, 'creationType'),
  })).filter((f) => f.targetField);
  return { name: tag(xml, 'masterLabel') || source, source, target, fields };
}

/** A `/ssot/data-model-object-mappings` response -> normalised maps. The payload carries only the developer
 *  names of each side and of each field pair, so every map here is a plain Standard copy: the Connect shape
 *  has nowhere to express a formula or a filter, and inventing one would be worse than reporting fewer. */
export function fromConnectPayload(json) {
  const list = Array.isArray(json?.objectSourceTargetMaps) ? json.objectSourceTargetMaps : [];
  return list.map((m) => ({
    name: m.developerName || m.sourceEntityDeveloperName,
    source: m.sourceEntityDeveloperName,
    target: m.targetEntityDeveloperName,
    status: m.status || null,
    fields: (m.fieldMappings || []).map((f) => ({
      // UNQUALIFIED here, unlike the metadata path. splitRef returns [null, name] for those, and buildDiagram
      // then falls back to the map's own source/target - so both shapes converge with no branch.
      sourceField: f.sourceFieldDeveloperName || null,
      targetField: f.targetFieldDeveloperName || null,
      isFormula: false, formula: null, filtered: false, filterOp: null,
    })).filter((f) => f.targetField && f.sourceField),
  })).filter((m) => m.source && m.target);
}

/** True when the text is a Connect API data-model-object-mappings response. Deliberately narrow: it must not
 *  claim a Diagramforce document (which carries `graph`/`diagramType`) or a Flow. */
export function looksLikeMappingXml(text) {
  return /^\s*(<\?xml[^>]*\?>\s*)?<ObjectSourceTargetMap[\s>]/.test(String(text || ''));
}
/** Every `<ObjectSourceTargetMap>` in a pasted blob. Salesforce writes ONE PER FILE, but a user pasting
 *  several concatenated - or a whole retrieve - should not be told to do it one at a time. */
export function parseMappingXmlAll(text) {
  const t = String(text || '');
  const docs = [...t.matchAll(/<ObjectSourceTargetMap[\s>][\s\S]*?<\/ObjectSourceTargetMap>/g)].map((m) => m[0]);
  return (docs.length ? docs : [t]).map(parseMappingXml).filter(Boolean);
}

export function looksLikeMappingJson(text) {
  const t = String(text || '').trim();
  if (t[0] !== '{') return false;
  if (!/"objectSourceTargetMaps"\s*:/.test(t)) return false;
  try {
    const d = JSON.parse(t);
    return !d.graph && !d.diagramType && Array.isArray(d.objectSourceTargetMaps);
  } catch { return false; }
}

// Layers, left to right. This is the Data Cloud pipeline, and the datamapping diagram type models it directly:
// a Zone per stage, carrying `layerStage`, which is what makes it a LAYER rather than a decorative box.
// A zone that carries only `layerStage` renders as the generic "Layer" preset, so an imported diagram sat
// beside a hand-built one looked like a different tool made it - and, worse, read as a CUSTOM layer
// duplicating the built-in. `layerStage` is what the app READS; the accent is what the reader sees.
//
// The accents were the OOTB Mapping Layer ones from js/components.js. Two of the four could not stay: the DLO
// amber #F6B355 scored 1.75:1 and the Activation green #27AE60 2.75:1 against the light canvas (#FAFAFA), and
// a zone accent is a stroke plus a label, not a filled block - at 1.75 the lane boundary is a suggestion.
// Both moved DOWN IN LIGHTNESS ONLY, hue held, so Source-blue / DLO-amber / DMO-red / Activation-green still
// read as themselves: amber L* 77.6 -> 50.5 at hue 78 (was 75), green L* 63.0 -> 50.6 at hue 150 (unchanged).
// Source blue and DMO red are byte-identical to before - they already cleared both floors.
// RESTATED from js/persistence/diagram-palette.js (import-free file, hand-copied to the skill);
// dev/tests/diagram-palette.test.js fails if they drift.
//
// The stencil presets (js/components.js) and the bundled templates/*.json carried the OLD amber and green for
// one release, so a converted DLO lane was a shade darker than one dragged fresh from the stencil. They have
// caught up, and the parity is now asserted rather than promised: dev/tests/shipped-palette.test.js compares
// these five literals against the stencil block and against every staged lane in every shipped template.
const STAGES = [
  { key: 'source', label: 'Source', color: '#1D73C9' },
  { key: 'datastream', label: 'Data Stream', color: '#1D73C9' },
  { key: 'dlo', label: 'Data Lake Object', color: '#A06F03' },
  { key: 'dmo', label: 'Data Model Object', color: '#DA4E55' },
  { key: 'activation', label: 'Activation', color: '#008B46' },
];
/** `#A06F03` -> `rgba(160,111,3,0.05)`. Mirrors hexToRgba in components.js, inlined because this module is
 *  shared with the skill and must not import app code. */
const rgba05 = (hex) => {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.05)`;
};
// The suffix IS the stage - Data Cloud names are structural, not cosmetic. Deriving it beats trusting a map's
// source/target ROLE: a DLO is the target of its data stream's ingest map and the source of its DMO maps, so
// role-based staging puts the same object in two layers (or, worse, silently merges the data stream into the
// DLO zone - which is exactly what the first cut of this did on `Contact_Home -> Contact_Home__dll`).
// A suffix-less name - an ingest map's sourceObjectName, e.g. `Prospect_Home` - is the SOURCE object, and it
// belongs in the Source layer (owner: "DSOs should be in Source layer"). Every official template, the stencil,
// applyDataMappingLayout and DIAGRAM_JSON_SPEC agree: the Data Stream layer is NOT where source objects live,
// it models what the stream ADDS on the way to the DLO - the formulas. The first cut staged suffix-less names
// 'datastream', which put the DSO and its formulas companion in one shared lane and emitted no Source zone.
const stageOf = (name) => (/__dlm$/i.test(name) ? 'dmo' : /__dll$/i.test(name) ? 'dlo' : 'source');
// GEOMETRY, measured off templates/data360-contact-mapping.json rather than chosen. Every one of these was
// wrong in the first cut, and the result read as a different tool's output: lanes too narrow and too close,
// cards too wide for the lane they sit in.
//   zone 292 wide on a 492 pitch (so a 200px gutter for the connectors), card 260 inset 16, first card 44 down
//   (clearing the zone label), 36 between cards, 16 of bottom padding.
const CARD_W = 260, ZONE_W = 292, LANE_PITCH = 492;
const ZONE_INSET_X = 16, ZONE_TOP = 44, CARD_GAP = 36, ZONE_BOTTOM = 16;
const HEADER_H = 44, ROW_H = 22, PAD = 12;

/** Full field lists per object, from a `/ssot/data-model-objects` catalogue. Merged in by `opts.catalogue` so
 *  a card can show the fields that are NOT mapped as well as the ones that are - the view you need when the
 *  conversation is "which of these still needs mapping?" rather than "what does this mapping do?". */
export function fieldCatalogue(json) {
  const out = new Map();
  for (const o of (json?.dataModelObject || json?.dataLakeObject || [])) {
    if (!o?.name) continue;
    out.set(o.name, (o.fields || []).map((f) => ({ apiName: f.name, label: f.label || f.name })).filter((f) => f.apiName));
  }
  return out;
}

/** DMO-to-DMO relationships out of a `/ssot/metadata?entityType=DataModelObject` payload (one, or an array of
 *  them). The org DECLARES these - `fromEntity`/`toEntity` plus a real `cardinality` - and it is the same array
 *  the Data Cloud UI's Relationships tab renders, so a mapping diagram can state the model's own structure
 *  between DMO cards it is already drawing instead of falling back to the ingest default.
 *
 *  DEDUPED, because the payload states each relationship TWICE - once under each end's entity. Measured on a
 *  real org: 137 entities, 442 rows, 222 distinct, 0 naming an entity the payload does not define.
 *
 *  The two ATTRIBUTE names are part of the identity, not decoration: 6 of the 213 ordered pairs are related
 *  through more than one field pair, and those are genuinely different relationships even though the diagram
 *  draws one connector per pair. Cardinality is deliberately NOT in the key - measured, no 4-tuple ever
 *  disagreed with itself, so including it could only ever have hidden a contradiction. */
export function entityRelationships(json) {
  const out = new Map();
  for (const payload of (Array.isArray(json) ? json : [json])) {
    for (const e of (payload?.metadata || [])) {
      for (const r of (e?.relationships || [])) {
        if (!r?.fromEntity || !r?.toEntity) continue;
        const k = [r.fromEntity, r.fromEntityAttribute, r.toEntity, r.toEntityAttribute].join('\u0000');
        if (!out.has(k)) out.set(k, { from: r.fromEntity, to: r.toEntity, cardinality: r.cardinality || null });
      }
    }
  }
  return [...out.values()];
}

/** The org's source -> stream -> DLO chain out of `/ssot/data-streams` (one page or an array of pages - the
 *  caller follows `nextPageUrl`; the endpoint's offset paging is 1-indexed and SKIPS, so ONLY that chain is
 *  complete - see limits/gotchas-testing.md). Keyed by the DLO name lower-cased, because the DLO card is the
 *  end a mapping canvas already has.
 *
 *  `connectorDetails` is null on every Ingestion API stream (measured: 14 of 58 in the org this was built
 *  against), and only CRM-connector streams state a `sourceObject` (30 of 58) - StreamingApp and UploadedFiles
 *  streams name the CONNECTOR and nothing narrower. So `sourceObject` may be null while `connectorName` is
 *  not, and both may be null; the consumer degrades per level rather than inventing the missing link. */
export function streamLineage(json) {
  const out = new Map();
  for (const payload of (Array.isArray(json) ? json : [json])) {
    for (const s of (payload?.dataStreams || [])) {
      const dlo = s?.dataLakeObjectInfo?.name;
      if (!s?.name || !dlo) continue;
      const cd = s.connectorInfo?.connectorDetails || null;
      out.set(String(dlo).toLowerCase(), {
        stream: s.name, dlo,
        connectorType: s.connectorInfo?.connectorType || null,
        connectorName: cd?.name || null,
        sourceObject: cd?.sourceObject || null,
      });
    }
  }
  return out;
}

export function buildDiagram(maps, opts = {}) {
  // THROW, never exit - this module runs in a browser too, where there is no process to exit and the caller
  // needs to show a message rather than have the tab die.
  if (!maps.length) throw new Error('No mappings found in that input.');

  // ── Collect the objects and the FIELDS each one actually participates with ──
  // Only mapped fields are drawn. A DLO can carry 87 fields with 42 mapped (measured); showing the other 45
  // would fill the card with rows that no link touches, which is the opposite of what a mapping diagram is for.
  const objs = new Map();   // name -> { name, stage, synthetic?, fields: Map<apiName,{...}> }
  const want = (name, opts) => {
    if (!objs.has(name)) objs.set(name, { name, stage: stageOf(name), fields: new Map(), ...opts });
    return objs.get(name);
  };
  const rels = [];
  let formulaCount = 0, filteredCount = 0, unmapped = 0, prunedUpstream = 0;
  for (const m of maps) {
    want(m.source); want(m.target);
    for (const f of m.fields) {
      const [tObj, tFld] = splitRef(f.targetField);
      // The field references are fully qualified; trust the qualifier over the file's source/targetObjectName
      // when they disagree, because a single map can read from or write into more than one object.
      const tCard = want(tObj || m.target);
      if (!tCard.fields.has(tFld)) tCard.fields.set(tFld, { apiName: tFld, label: pretty(tFld) });
      if (f.isFormula) {
        formulaCount++;
        // A formula map has NO source field - it computes a literal or an expression. (Measured across a real
        // org: 153 of 153 formula maps had `<sourceField xsi:nil="true"/>`.) So there is no field on the left to
        // link FROM - but that does NOT mean the mapping cannot be drawn.
        //
        // The official `data360-contact-mapping` template hit exactly this (on these very fields, `DataSource`
        // and `DataSourceObject`) and answered it with a companion card - "Data Stream Formulas" - carrying one
        // row per formula-populated target field, with real `mappingType: 'Formula'` links running out of it.
        // That is the sanctioned convention, so follow it rather than inventing somewhere else to put the
        // expression: it earns the 'F' badge on the canvas and lands the formula in the table's
        // **Expression / Rule** column, which is the column that means this.
        // (The template leaves `expressionRule` unset; the retrieve gives us the actual formula text, so
        // setting it is strictly better - it also drives the badge's hover tooltip.)
        // WHERE the companion lives: an ingest-side companion (source object -> DLO) goes in the DATA STREAM
        // layer - that layer exists to model what the stream computes on the way in, and it is exactly where
        // the template puts its own companion (a separate Data Stream zone stacked below Source, NOT the
        // source object's zone). A DLO-to-DMO formula companion stays in the DLO's lane, beside the object
        // whose read it transforms.
        // Key by the RAW source name, not the prettified one: `Contact_Home` (a data stream) and
        // `Contact_Home__dll` (its DLO) both prettify to `Contact_Home`, so a prettified key would merge their
        // two companions into one card sitting in whichever layer happened to register first.
        const srcStage = stageOf(m.source);
        const host = want(`${m.source} formulas`,
          { stage: srcStage === 'source' ? 'datastream' : srcStage, label: `${pretty(m.source)} Formulas` });
        // Key the row by the TARGET field, so the two sides read as a matched pair.
        if (!host.fields.has(tFld)) host.fields.set(tFld, { apiName: tFld, label: pretty(tFld) });
        rels.push({ from: [host.name, tFld], to: [tCard.name, tFld],
          mappingType: 'Formula', expression: f.formula || null, srcObj: m.source });
        continue;
      }
      const [sObj, sFld] = splitRef(f.sourceField);
      if (!sFld) continue;
      const sCard = want(sObj || m.source);
      if (!sCard.fields.has(sFld)) sCard.fields.set(sFld, { apiName: sFld, label: pretty(sFld) });
      if (f.filtered) filteredCount++;
      rels.push({ from: [sCard.name, sFld], to: [tCard.name, tFld], filtered: f.filtered, filterOp: f.filterOp });
    }
  }
  // ── Left-to-left FORMULA INPUT connectors ──────────────────────────────────────────────────────────────────
  // Owner convention, and the official template draws it: a formula that READS source data gets a left-to-left
  // connector from each referenced source field row into its formula row - the template's Name row takes two
  // (FirstName and LastName feed a concat), while its static rows (DataSource, SfdcOrganizationId, ...) take
  // none. The expression syntax gives the references away: `sourceField['IsConverted']`.
  //
  // A POST-pass over the collected rels, not inline in the field loop: a formula can reference a column whose
  // direct mapping registers LATER in the same file, and resolving early would mint a duplicate row for it.
  // Refs are matched against the source card's rows tolerantly (formulas say `IsConverted`, direct rows say
  // `IsConverted__c` - measured across CRM, csv and V2 streams, every stream column suffixes __c); a referenced
  // column with no direct mapping gains a row, which the prune below removes again if its formula dies.
  //
  // `formulaField[...]` is the OTHER accessor real orgs write (15 refs measured org-wide): it names a DERIVED
  // field - another formula's output in the SAME stream - so its row, when it exists, is a row on the SAME
  // "<Stream> Formulas" companion the referencing formula lives on, and the chain draws left-to-left between
  // two rows of one card (probe-verified: sfMappingRouter loops it off the left edge, readably, even for
  // adjacent rows). Resolved against EXISTING companion rows ONLY, never minting: measured, 13 of the org's 15
  // refs name a directly-mapped column instead (`formulaField['EventDateTime']` where EventDateTime__c is a
  // plain copy) - the accessor CLAIMS a derived field, and drawing it into the source column would assert
  // semantics the metadata does not state. Those stay unresolved and are COUNTED (stats.formulaChainUnresolved,
  // stamped per referencing rel so the count follows the prune like every other stat here).
  const accessorRefs = (expr, accessor) => [...new Set(
    [...String(expr || '').matchAll(new RegExp(`${accessor}\\s*\\[\\s*(['"])([^'"\\]]+)\\1\\s*\\]`, 'g'))]
      .map((mm) => mm[2]))];
  const tolerant = (card, ref) => (card ? [...card.fields.keys()].find((k) => k === ref
    || k.toLowerCase() === `${ref}__c`.toLowerCase() || k.toLowerCase() === ref.toLowerCase()) : undefined);
  for (const r of [...rels]) {
    if (r.mappingType !== 'Formula' || !r.srcObj) continue;
    const sCard = objs.get(r.srcObj);
    if (sCard) {
      for (const ref of accessorRefs(r.expression, 'sourceField')) {
        const api = tolerant(sCard, ref) || `${ref}__c`;
        if (!sCard.fields.has(api)) sCard.fields.set(api, { apiName: api, label: pretty(api) });
        rels.push({ from: [sCard.name, api], to: r.from.slice(), leftLeft: true });
      }
    }
    const host = objs.get(r.from[0]);   // the "<Stream> Formulas" companion this formula's row lives on
    for (const ref of accessorRefs(r.expression, 'formulaField')) {
      const hit = tolerant(host, ref);
      // A hit that is the referencing row ITSELF (a formula naming its own output) would be a same-port
      // degenerate link - counted with the unresolved rather than drawn. 0 in the measured corpus.
      if (!hit || hit === r.from[1]) { r.chainUnresolved = (r.chainUnresolved || 0) + 1; continue; }
      rels.push({ from: [host.name, hit], to: r.from.slice(), leftLeft: true, chain: true });
    }
  }

  // PRUNE the upstream that goes nowhere. A data stream's ingest map writes essentially everything it carries
  // while the DLO -> DMO maps are selective, so completing the lineage drags in a great deal of noise: on a
  // real ContactPointEmail selection, 238 of 266 DLO fields were dead ends - Contact_Home showed 81 fields of
  // which 8 reached the DMO. Those rows and their connectors say nothing about the mapping being documented.
  //
  // So in MAPPED-ONLY mode (the default), keep a mapping only if its target field can still REACH a data model
  // object. Computed as a backward reachability walk from the DMO fields, so a longer chain prunes correctly
  // rather than one hop at a time.
  //
  // NOT done when a field catalogue was supplied: that mode exists to answer "which fields still need
  // mapping?", and there the fields that go nowhere are exactly the point.
  if (!opts.catalogue?.size) {
    const key = (o, f) => `${o}\u0000${f}`;
    const useful = new Set();
    for (const r of rels) if (stageOf(r.to[0]) === 'dmo') useful.add(key(...r.to));
    for (let pass = 0; pass < 12; pass++) {
      let grew = false;
      for (const r of rels) {
        if (useful.has(key(...r.to)) && !useful.has(key(...r.from))) { useful.add(key(...r.from)); grew = true; }
      }
      if (!grew) break;
    }
    const kept = rels.filter((r) => useful.has(key(...r.to)));
    prunedUpstream = rels.length - kept.length;
    rels.length = 0; rels.push(...kept);
    // Drop the field ROWS that no surviving mapping touches, or the cards keep their 81 rows with 8 links.
    const touched = new Set(rels.flatMap((r) => [key(...r.from), key(...r.to)]));
    for (const o of objs.values()) {
      for (const f of [...o.fields.keys()]) if (!touched.has(key(o.name, f))) o.fields.delete(f);
    }
  }

  // UNMAPPED fields, when a catalogue was supplied. Mapped-only is the right default - a DLO can carry 87
  // fields with 42 mapped, and the other 45 are rows no connector touches. But "which fields still need
  // mapping?" is a real conversation, and it needs the gaps visible. The app's table view already has a Show
  // Unmapped Fields toggle for exactly this, so an unmapped row is a first-class thing here.
  if (opts.catalogue?.size) {
    for (const o of objs.values()) {
      for (const f of opts.catalogue.get(o.name) || []) {
        // No flag on the field: the app DERIVES "unmapped" from whether a link touches it (that is what the
        // table view's Show Unmapped Fields toggle reads), so a flag here would be a second source of truth.
        if (!o.fields.has(f.apiName)) { o.fields.set(f.apiName, { apiName: f.apiName, label: f.label }); unmapped++; }
      }
    }
  }
  // An object nobody mapped a field to or from would draw as an empty card; drop it rather than show a stub.
  for (const [k, o] of objs) if (!o.fields.size) objs.delete(k);

  // ── Source facts from the ORG (opts.streams, built by streamLineage) ───────────────────────────────────────
  // Without it, everything left of the DLO lane is NAMED from the mapping metadata: an ingest map's
  // sourceObjectName IS the stream's name (`Prospect_Home`), so the lane shows the stream wearing a Source
  // caption while the actual origin - the `Prospect` object read through the SalesforceDotCom_Home connector -
  // is nowhere on the canvas. `/ssot/data-streams` states the real chain, so when the caller supplies it:
  //   · a connector-backed stream states its origin ON ITS OWN CARD - a `Source: Prospect
  //     (SalesforceDotCom_Home)` details row, first row of the card, object and pipe both org-declared. The
  //     first cut drew the origin as a separate HEADER-ONLY card with an object edge into the stream; the
  //     owner's review ("What value does empty object give?") measured that box at nothing - the org states
  //     the source's NAME, not its schema, and a name fits on a row. Same call as the IR importer removal:
  //     see approaches/index.md "Stream-lineage upstream source cards".
  //   · a stream that states a connector but no source object (StreamingApp / UploadedFiles) says
  //     `Source: via <connector>` - the org names the pipe and nothing narrower.
  //   · an Ingestion API stream has NO upstream anywhere (connectorDetails is null on all 14 in the measured
  //     org), so its card SAYS so instead of inventing one - the "(Ingestion API)" header caption stays.
  //   · a stream whose ingest map is not in the selection is minted carrying just its details row - the
  //     Connect path carries no ingest maps at all, and this is what gives that path a Source lane it
  //     never had.
  // AFTER the empty-card drop above, deliberately: a minted stream card may carry no field rows (Ingestion
  // API on the Connect path), and a chain the org states must not be culled as "nobody mapped it".
  let streamsMatched = 0, streamsIngestApi = 0, dlosWithoutStream = 0, streamSources = 0;
  const lineageEdges = [];
  if (opts.streams) {
    const keyByLower = new Map([...objs.keys()].map((k) => [k.toLowerCase(), k]));
    for (const dlo of [...objs.values()]) {
      // ` formulas` companions share the 'dlo' stage but are drawing devices, not DLOs - same exclusion the
      // object-relationship pass makes.
      if (dlo.stage !== 'dlo' || / formulas$/i.test(dlo.name)) continue;
      const entry = opts.streams.get(String(dlo.name).toLowerCase());
      if (!entry) { dlosWithoutStream++; continue; }
      streamsMatched++;
      // The stream's card is the DSO the ingest maps drew (the two share a name, case-insensitively - these
      // names come from different endpoints).
      const sKey = keyByLower.get(entry.stream.toLowerCase()) || entry.stream;
      const sCard = want(sKey, { stage: 'source', label: pretty(entry.stream) });
      if (entry.sourceObject || entry.connectorName) {
        // The row states the object AND the pipe it arrives through - the same system-plus-object reading the
        // official template hand-writes as "Salesforce CRM Contact", one row instead of one box.
        const srcText = entry.sourceObject
          ? `Source: ${entry.sourceObject} (${entry.connectorName || entry.connectorType})`
          : `Source: via ${entry.connectorName}`;
        // FIRST row, ahead of the ingest field rows - it captions the card, it does not extend the schema.
        // `detail: true` keeps it out of the Text type column; label === apiName so the renderer dedupes and
        // shows the string once. A stream feeding several selected DLOs stamps the row once (Map key).
        if (!sCard.fields.has(srcText)) {
          streamSources++;
          sCard.fields = new Map([[srcText, { apiName: srcText, label: srcText, detail: true }], ...sCard.fields]);
        }
      } else {
        // No connector detail = Ingestion API: the upstream is whatever external system calls the API, which
        // the org cannot name - say so on the card rather than let the stream read as self-originating.
        streamsIngestApi++;
        sCard.label = `${sCard.label || pretty(sCard.name)} (Ingestion API)`;
      }
      lineageEdges.push([sCard.name, dlo.name]);
    }
  }

  // ── Cards ──────────────────────────────────────────────────────────────────
  const usedFids = new Set();
  const fid = (obj, api) => {
    const slug = (x) => String(x).replace(/__c$|__dll$|__dlm$/i, '').replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '').toLowerCase();
    let base = `${slug(obj).slice(0, 12)}_${slug(api).slice(0, 16)}`, f = base, n = 2;
    while (usedFids.has(f)) f = `${base}_${n++}`;
    usedFids.add(f);
    return f;
  };
  const cells = [];
  const cardOf = new Map();
  // Only lay out the stages that are actually present - a DLO-to-DMO selection should not carry an empty
  // Data Stream column, and the column X must not leave a hole where that stage would have been.
  const present = STAGES.filter((s) => [...objs.values()].some((o) => o.stage === s.key));

  // COLUMN BANDS, not one column per stage: Source and Data Stream share the leftmost band, Data Stream
  // STACKED below Source - the geometry every official template draws, the layout applyDataMappingLayout
  // enforces (its typeOf maps 'datastream' into the source band), and what DIAGRAM_JSON_SPEC prescribes
  // ("Not its own column: stack this Zone in the Source column, below the Source Zone"). Template-measured
  // gap: source zone h=836, datastream zone y=892 - 56px, the same ZONE_GAP the layout uses. When no source
  // card survives (a formulas-only ingest, or a pure DLO-to-DMO selection), Data Stream takes the band alone
  // at y=0 - the pre-1.22.0 single-zone behaviour.
  // Category lookup, case-insensitive on the raw API name. `opts.categories` maps object API names to
  // ALREADY-normalised app values (Profile / Engagement / Other - see normaliseCategory); a card with no entry
  // OMITS the key entirely, exactly as the official templates do for Source and Data Stream cards.
  const catByName = new Map(Object.entries(opts.categories || {}).map(([k, v]) => [String(k).toLowerCase(), v]));
  let categorised = 0;

  const ZONE_GAP = 56;
  const bandOf = new Map();
  {
    let band = 0;
    for (const s of present) {
      if (s.key === 'datastream' && bandOf.has('source')) { bandOf.set('datastream', bandOf.get('source')); continue; }
      bandOf.set(s.key, band++);
    }
  }
  let sourceZoneBottom = null;   // set when the source zone is emitted; STAGES order puts source first

  present.forEach((stage) => {
    const members = [...objs.values()].filter((o) => o.stage === stage.key);
    const zoneX = bandOf.get(stage.key) * LANE_PITCH;
    const zoneY = (stage.key === 'datastream' && sourceZoneBottom != null) ? sourceZoneBottom + ZONE_GAP : 0;
    let y = zoneY + ZONE_TOP;
    members.forEach((o, i) => {
      // A `detail` row (the stream's org-stated source) gets an EMPTY type: "Text" would claim the row is a
      // field of the schema, and the blank type column is what gives the full-width label room to render.
      const fields = [...o.fields.values()].map((f) => ({
        label: f.label, apiName: f.apiName, type: f.detail ? '' : 'Text', keyType: null, fid: fid(o.name, f.apiName),
      }));
      const cat = catByName.get(String(o.name).toLowerCase()) || null;
      if (cat) categorised++;
      const cell = {
        id: `${stage.key}-${i}`, type: 'sf.DataObject', z: 2000,
        position: { x: zoneX + ZONE_INSET_X, y },
        size: { width: CARD_W, height: HEADER_H + fields.length * ROW_H + PAD },
        // BOTH of these matter: `objectName` is the property the app edits, `attrs.headerLabel.text` is what
        // actually renders, and nothing syncs one to the other on load.
        objectName: o.label || pretty(o.name),
        // The org's own category, when the caller supplied one (CLI --org / --categories). A synthetic
        // Formulas companion can never match an org API name, so it stays keyless by construction.
        ...(cat ? { category: cat } : {}),
        attrs: { headerLabel: { text: o.label || pretty(o.name) } },
        // The card header takes the LAYER's accent, as every card in the official template does - it is what
        // makes a lane read as one thing at a glance.
        headerColor: stage.color,
        showLabels: true, showFieldLengths: false,
        fields,
      };
      cardOf.set(o.name, { cell, byApi: new Map(fields.map((f) => [f.apiName, f])) });
      cells.push(cell);
      y += cell.size.height + CARD_GAP;
    });
    const zid = `zone-${stage.key}`;
    if (stage.key === 'source') sourceZoneBottom = (y - CARD_GAP) + ZONE_BOTTOM;
    cells.push({
      id: zid, type: 'sf.Zone', z: 0,
      position: { x: zoneX, y: zoneY },
      size: { width: ZONE_W, height: (y - CARD_GAP) - zoneY + ZONE_BOTTOM },
      // `layerStage` ALONE is not enough. It is what the app reads to resolve an object's stage, but a zone
      // carrying only that renders as the generic "Layer" preset - so an imported diagram looked like it used
      // CUSTOM layers duplicating the built-in ones. An OOTB Mapping Layer is `layerStage` PLUS these three
      // accent attrs; see createElementFromComponent in js/components.js, which is what dropping one from the
      // stencil produces.
      layerStage: stage.key,
      attrs: {
        body: { stroke: stage.color, fill: rgba05(stage.color) },
        label: { text: stage.label, fill: stage.color },
      },
      embeds: members.map((o) => cardOf.get(o.name).cell.id),
    });
    members.forEach((o) => { cardOf.get(o.name).cell.parent = zid; });
  });

  // ── Mapping links ──────────────────────────────────────────────────────────
  let li = 0;
  for (const r of rels) {
    const a = cardOf.get(r.from[0]), b = cardOf.get(r.to[0]);
    if (!a || !b) continue;
    const af = a.byApi.get(r.from[1]), bf = b.byApi.get(r.to[1]);
    if (!af || !bf) continue;
    // LEFT-TO-LEFT formula inputs: both ends anchor on the LEFT edge, the template's own convention for "this
    // formula READS that field" - visibly different from the left-to-right data flow, which is the point.
    // Plain Standard link, no expressionRule: the expression already rides the companion's Formula link.
    if (r.leftLeft) {
      cells.push({
        id: `map-${li++}`, type: 'standard.Link', z: 3000,
        source: { id: a.cell.id, port: `field-left-${af.fid}` },
        target: { id: b.cell.id, port: `field-left-${bf.fid}` },
        linkKind: 'mapping', mappingType: 'Standard',
      });
      continue;
    }
    // SIDED field ports: the link leaves one card's RIGHT edge and enters the next card's LEFT edge, which is
    // what makes a mapping diagram read left-to-right. (Plain `field-<fid>` is not a port in mapping mode, and
    // `er-left`/`er-right` are the ERD's object-level pair.) Pick the sides from the actual column order so a
    // back-reference does not draw a link that loops all the way around both cards. DEFENSIVE: measured across
    // a real org, 0 of 3661 rows had a field qualifier that disagreed with its file's declared object pair, so
    // this only fires on a reversed or cross-qualified map. Covered by a synthetic case in the tests.
    const fwd = a.cell.position.x <= b.cell.position.x;
    cells.push({
      id: `map-${li++}`, type: 'standard.Link', z: 3000,
      source: { id: a.cell.id, port: `field-${fwd ? 'right' : 'left'}-${af.fid}` },
      target: { id: b.cell.id, port: `field-${fwd ? 'left' : 'right'}-${bf.fid}` },
      linkKind: 'mapping',
      // `Formula` earns the 'F' badge on the connector; `Standard` is a direct copy and deliberately gets none,
      // so a mix of the two into one field still reads cleanly.
      mappingType: r.mappingType || 'Standard',
      // Expression / Rule - the formula for a Formula map, the filter for a filtered one. Both surface in the
      // table column of that name and in the badge's hover tooltip.
      ...(r.expression ? { expressionRule: r.expression }
        : r.filtered ? { expressionRule: `filtered (${r.filterOp || 'Equal'})` } : {}),
    });
  }

  // ── Object-level RELATIONSHIP connectors, header to header ─────────────────────────────────────────────────
  // The bundled Data Mapping templates draw one per object PAIR alongside the field mappings, and the owner's
  // ask was to match them: "add object-level relationship connectors between Data Mapping headers, so that it
  // also shows one to many etc like on the Data Mapping template".
  //
  // Same convention as those templates, byte for byte: `er-right` -> `er-left` with `magnet: 'circle'`, ONE at
  // the source end, and at the target either ONE or ONE-OR-MANY.
  //
  // WHERE THE CARDINALITY COMES FROM, and where it does not. `/services/data/vXX.0/ssot/metadata?entityName=<DMO>`
  // returns a `relationships[]` array carrying a real `cardinality` (`ONETOONE` / `NTOONE`) - it is what the Data
  // Cloud UI's own Relationships tab renders. That is DMO-to-DMO though, and a mapping diagram's pairs are
  // datastream -> DLO -> DMO, which no API states a cardinality for. So:
  //   · a pair the caller supplied a cardinality for uses it;
  //   · every other pair draws ONE -> ONE-OR-MANY, because an ingest genuinely IS to-many (a data stream feeds
  //     many rows into its DLO, and a DLO feeds many into its DMO) - and that is what the templates draw too.
  // The line stays deliberately plain: this is structure, not a mapping, so it must not compete with the amber
  // field connectors running between the same two cards.
  const REL_ONE = 'M -12 -8 L -12 8 M -12 0 L 0 0';
  const REL_ONE_MANY = 'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0 M 3 -8 L 3 8';
  // DF_NEUTRAL_LINK, restated (see diagram-palette.js). "Plain" has to mean low CHROMA, not low contrast:
  // #98A2B3 was 2.47:1 on the light canvas, which made the object-level structure a rumour rather than a
  // subdued line. Same L* as the accents, chroma 4.
  const REL_GREY = '#74797F';
  // Its OWN counter. `li` is the field-link count and `stats.fieldLinks` reports it, so sharing it would have
  // the summary claim object-level connectors as field mappings.
  let ri = 0, dmoRels = 0, dmoRelsOffCanvas = 0, dmoRelsSelf = 0;
  if (opts.objectRelationships !== false) {
    const seen = new Set();
    /** ONE connector between two cards, whichever pass asked for it. `toMany` puts the crow's foot at the
     *  TARGET end, so a caller states a to-many relationship PARENT FIRST. Returns whether it drew. */
    const objRel = (fromName, toName, toMany) => {
      const a = cardOf.get(fromName), b = cardOf.get(toName);
      if (!a || !b || a.cell.id === b.cell.id) return false;
      // ONE connector per object PAIR, however many fields they share - and the pair is UNORDERED, or a
      // reciprocal mapping (a field read back out of the DMO) draws a second line straight over the first. The
      // declared relationship set below makes that reachable rather than theoretical: 8 of the org's 213
      // ordered DMO pairs are stated in BOTH directions.
      const key = [a.cell.id, b.cell.id].sort().join('\u0000');
      if (seen.has(key)) return false;
      seen.add(key);
      const fwd = a.cell.position.x <= b.cell.position.x;
      cells.push({
        id: `objrel-${ri++}`, type: 'standard.Link', z: 2900,   // UNDER the mapping links (3000)
        source: { id: a.cell.id, port: fwd ? 'er-right' : 'er-left', magnet: 'circle' },
        // SAME COLUMN leaves on the SAME side. Two DMOs both live in the DMO lane, so er-right -> er-left
        // between them exits the right edge and then has to come back round to a left edge at the same x - a
        // horseshoe over every card stacked in between, and a real org draws 100+ of these. Same-side is not an
        // invention: templates/mcn-consent-data-model.json draws its four near-column relationships
        // `er-right -> er-right` for exactly this geometry. RIGHT and not left because the lane's left gutter
        // is where the amber field-mapping links run, and structure must not compete with them.
        target: { id: b.cell.id, magnet: 'circle',
          port: a.cell.position.x === b.cell.position.x ? 'er-right' : fwd ? 'er-left' : 'er-right' },
        router: { name: 'sfManhattan' },
        connector: { name: 'rounded', args: { radius: 8 } },
        attrs: { line: {
          stroke: REL_GREY, strokeWidth: 2,
          sourceMarker: { d: REL_ONE, fill: 'none', stroke: REL_GREY, 'stroke-width': 2, 'stroke-dasharray': 'none' },
          targetMarker: { d: toMany ? REL_ONE_MANY : REL_ONE, fill: 'none', stroke: REL_GREY, 'stroke-width': 2, 'stroke-dasharray': 'none' },
        } },
      });
      return true;
    };
    for (const r of rels) {
      // NOT from a Formulas companion. That card is a drawing device - it exists because a formula mapping has
      // no source field of its own - and it is not an object in the org, so an ER relationship leaving it would
      // assert a structure that does not exist. Its FIELD links are real and stay.
      if (/ formulas$/i.test(r.from[0]) || / formulas$/i.test(r.to[0])) continue;
      const card = opts.cardinality?.[`${r.from[0]}\u0000${r.to[0]}`];
      objRel(r.from[0], r.to[0], card ? card !== 'ONETOONE' : true);
    }
    // ── Source lineage edges (opts.streams) ──────────────────────────────────────────────────────────────────
    // The org-stated stream -> DLO hop (the origin itself is a details row on the stream card, not an edge).
    // The pair usually exists already (its ingest field maps connected it in the loop above) and the pair
    // dedupe makes this a no-op there - the edge only materialises where no field-level ingest detail was
    // available, which is every Connect-path stream.
    // to-many at the stream end for the same reason the pipeline default is: an ingest genuinely IS to-many.
    for (const [from, to] of lineageEdges) objRel(from, to, true);
    // ── DECLARED DMO-to-DMO relationships (`opts.relationships`, built by entityRelationships) ────────────────
    // Everything above pairs datastream -> DLO -> DMO, which no API states a cardinality for. The DMO LAYER is
    // the exception: the org declares its own relationships there, so these are MEASURED, not assumed.
    //
    // SCOPED BY THE CANVAS, which is the whole design. A standalone whole-DMO ERD would draw 137 cards of which
    // only 62 are mapped - 55% catalogue nobody asked for. Drawing a relationship only where BOTH ends are
    // already cards keeps the diagram about what the user selected, and it costs nothing: those cards exist
    // either way, so this is connectors over a canvas that is already right.
    //
    // Case-insensitive on the API name, the same rule the category lookup uses one screen up: these names come
    // from a different endpoint than the mapping metadata, and Salesforce API names are case-insensitive.
    //
    // NTOONE reads `from` MANY -> `to` ONE, so the connector is stated PARENT FIRST (`to` as the source end) to
    // land the crow's foot on the child - the source-is-ONE convention the pipeline connectors already use.
    const cardKeyOf = new Map([...cardOf.keys()].map((k) => [k.toLowerCase(), k]));
    for (const r of (opts.relationships || [])) {
      const from = cardKeyOf.get(String(r.from || '').toLowerCase());
      const to = cardKeyOf.get(String(r.to || '').toLowerCase());
      // The two undrawable cases are COUNTED rather than dropped quietly, because each hides something a
      // reader would otherwise have no way to know is missing. Measured on a real org: 6 of the 222 declared
      // relationships are self-references, which a header-to-header connector cannot express - the ERD
      // importer draws those on FIELD ports, and this diagram type has no field to hang them on. A pair the
      // pipeline pass already connected needs no second line and is not a loss, so it is not counted.
      if (!from || !to) { dmoRelsOffCanvas++; continue; }
      if (from === to) { dmoRelsSelf++; continue; }
      if (objRel(to, from, r.cardinality !== 'ONETOONE')) dmoRels++;
    }
  }

  return {
    diagram: {
      version: 1, appVersion: opts.appVersion || '1.22.0',
      title: opts.title || 'Data Cloud Mappings',
      diagramType: 'datamapping', mappingMode: true,
      graph: { cells },
    },
    stats: {
      objectMaps: maps.length,
      layers: present.map((s) => `${s.label} ${[...objs.values()].filter((o) => o.stage === s.key).length}`),
      fieldLinks: li,
      objectLinks: ri,
      // The subset of `objectLinks` that came from the org's DECLARED DMO-to-DMO model rather than from an
      // inferred pipeline pair, plus the two kinds of declared relationship this canvas cannot draw. Those two
      // are the scoping rule made visible - same discipline as the off-canvas DMO note: say what the picture
      // leaves out rather than let it look complete.
      dmoRels, dmoRelsOffCanvas, dmoRelsSelf,
      // Counted from the SURVIVING relationships, not from the parse. The prune below can remove a formula
      // whose target field never reaches a DMO, and reporting the pre-prune total said "25 formula-sourced"
      // on a diagram that draws 10.
      formulas: rels.filter((r) => r.mappingType === 'Formula').length,
      // Left-to-left inputs that SURVIVED the prune - a formula input dies with its formula.
      formulaInputs: rels.filter((r) => r.leftLeft && !r.chain).length,
      // Formula-to-formula chains (`formulaField[...]`), same-card left-to-left, that survived the prune - a
      // chain dies when the formula it FEEDS dies (the backward walk then keeps the fed-FROM row alive).
      formulaChains: rels.filter((r) => r.chain).length,
      // Refs that named a derived field with no formula row to land on - counted off the SURVIVING referencing
      // formulas, same discipline as `formulas` above, so a pruned formula does not report its dangling refs.
      formulaChainUnresolved: rels.filter((r) => r.mappingType === 'Formula')
        .reduce((n, r) => n + (r.chainUnresolved || 0), 0),
      filtered: rels.filter((r) => r.filtered).length,
      unmapped, prunedUpstream, categorised,
      // Source-lane lineage - meaningful only when `opts.streams` was supplied (fact mode); all zero without.
      // The wrapper's report is REQUIRED to say which mode named the lane, and these are what it says it with.
      // `streamSources` counts the org-stated source FACTS found - they render as details rows on the stream
      // cards now, not as cards of their own.
      streamsMatched, streamSources, streamsIngestApi, dlosWithoutStream,
      cells: cells.length,
    },
  };
}

/** The org's category vocabulary -> the app's DataObject picklist (Profile / Engagement / Other). `Related`
 *  maps to Other on direct template evidence: AccountContact is Salesforce's standard Related-category DMO and
 *  the official data360 template hand-sets it to Other. Any unknown non-empty value lands in Other too - the
 *  object IS categorised in the org, and Other is the app's residual bucket. Empty means "do not stamp". */
export const normaliseCategory = (v) => {
  const s = String(v || '').trim();
  if (!s) return null;
  const t = s.toLowerCase();
  return t === 'profile' ? 'Profile' : t === 'engagement' ? 'Engagement' : 'Other';
};

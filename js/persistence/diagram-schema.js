// Diagram-schema leaf — ZERO-dependency, no DOM, no JointJS. The single source of truth for what the loader accepts,
// plus a PURE validator the dev CLI runs (dev/scripts/validate-diagram.mjs) so an LLM-authored diagram can be checked
// BEFORE it ships, surfacing the failures the app heals/drops silently on load. json-pipeline.js imports the
// ALLOWED_CELL_TYPES + MAX_CELL_COUNT from here so the app and the validator can never drift. The validator REPORTS;
// it never reconstructs (the loader already rebuilds ports / re-routes / re-lays-out on load).

// Cap mirrored from the loader (sanitizeGraphJSON throws above this).
export const MAX_CELL_COUNT = 2000;

// ── Props that render only through attrs (owner call, 2026-09-25) ────────────────────────────────────────────────
// Several shapes carry a top-level prop that DESCRIBES the look (`headerColor`, `lineStyle`, `eventType`, ...) while
// the view draws only the matching `attrs`. The stencil and the properties panel write both, so anything made in the
// app agrees with itself; JSON written by a converter, an LLM or the spec's own examples often set only the prop, and
// rendered the class default. One table, three readers: the loader applies an authored prop to attrs it finds still
// at their class default (js/canvas/migration.js), the validator warns when an authored prop and authored attrs
// DISAGREE (below), and the panel and stencil take their values from the same tables. Lookup tables are
// prototype-free: they are indexed by values out of user JSON.
const table = (o) => Object.assign(Object.create(null), o);
export const DASH_BY_LINE_STYLE = table({ solid: 'none', dashed: '12 6', dotted: '0 6', breaks: '16 8' });
export const BRACKET_PATHS = table({
  right: 'M calc(w) 0 Q calc(w - 12) 0 calc(w - 12) calc(0.25 * h) L calc(w - 12) calc(0.45 * h) Q calc(w - 12) calc(0.5 * h) calc(w - 16) calc(0.5 * h) Q calc(w - 12) calc(0.5 * h) calc(w - 12) calc(0.55 * h) L calc(w - 12) calc(0.75 * h) Q calc(w - 12) calc(h) calc(w) calc(h)',
  left: 'M 0 0 Q 12 0 12 calc(0.25 * h) L 12 calc(0.45 * h) Q 12 calc(0.5 * h) 16 calc(0.5 * h) Q 12 calc(0.5 * h) 12 calc(0.55 * h) L 12 calc(0.75 * h) Q 12 calc(h) 0 calc(h)',
});
export const BRACKET_LABEL_X = table({ right: 0, left: 18 });
// `external` was #F6B355 (1.75:1 on the light canvas); the palette's amber clears 3:1 on both.
export const SEQ_ROLE_ACCENT = table({ generic: '#8A9099', salesforce: '#2E844A', api: '#1D73C9', external: '#A06F03', actor: '#8A9099' });
export const BPMN_EVENT_STYLE = table({
  start:        { 'body/fill': '#DCF1E2', 'body/stroke': '#008B46', 'body/strokeWidth': 1.5, 'innerRing/stroke': 'none', 'icon/fill': '#008B46' },
  intermediate: { 'body/fill': '#FDF1DC', 'body/stroke': '#A06F03', 'body/strokeWidth': 1.5, 'innerRing/stroke': '#A06F03', 'innerRing/strokeWidth': 1.5, 'icon/fill': '#A06F03' },
  end:          { 'body/fill': '#F9E3E5', 'body/stroke': '#DA4E55', 'body/strokeWidth': 4, 'innerRing/stroke': 'none', 'icon/fill': '#DA4E55' },
});
export const BPMN_GATEWAY_GLYPH = table({ exclusive: '×', parallel: '+', inclusive: '○', event: '◇' });

// Per type: each rule names its prop, the prop's class default (a prop AT its default was not authored - except
// where `always` says the default is itself a look worth applying), the attrs it wants, and the attr values that
// mean "untouched" (the class defaults; `undefined` always counts). Keep `dflt` / `untouched` equal to the shape
// classes' own defaults - dev/tests/e2e/prop-attrs.spec.js reads them off the live classes and fails on drift.
export const PROP_ATTR_RULES = table({
  'sf.DataObject': [
    { prop: 'objectName', dflt: 'Object', want: (v) => ({ 'headerLabel/text': v }), untouched: { 'headerLabel/text': ['Object'] } },
    { prop: 'headerColor', dflt: '#1D73C9', want: (v) => ({ 'header/fill': v, 'headerCover/fill': v }),
      untouched: { 'header/fill': ['#1D73C9'], 'headerCover/fill': ['#1D73C9'] } },
  ],
  'sf.Line': [
    { prop: 'lineStyle', dflt: 'solid', values: Object.keys(DASH_BY_LINE_STYLE),
      want: (v) => ({ 'line/strokeDasharray': DASH_BY_LINE_STYLE[v] }), untouched: { 'line/strokeDasharray': ['none'] } },
  ],
  'sf.Annotation': [
    { prop: 'bracketSide', dflt: 'right', values: Object.keys(BRACKET_PATHS),
      want: (v) => ({ 'bracket/d': BRACKET_PATHS[v], 'label/x': BRACKET_LABEL_X[v] }),
      untouched: { 'bracket/d': [BRACKET_PATHS.right], 'label/x': [0] } },
  ],
  'sf.SequenceParticipant': [
    { prop: 'participantRole', dflt: 'generic', values: Object.keys(SEQ_ROLE_ACCENT),
      want: (v) => ({ 'headerAccent/fill': SEQ_ROLE_ACCENT[v], 'headerBottomAccent/fill': SEQ_ROLE_ACCENT[v] }),
      untouched: { 'headerAccent/fill': ['var(--color-primary)'], 'headerBottomAccent/fill': ['var(--color-primary)'] } },
  ],
  'sf.SequenceFragment': [
    { prop: 'fragmentLabel', dflt: 'loop', want: (v) => ({ 'titleText/text': v }), untouched: { 'titleText/text': ['loop'] } },
    { prop: 'condition', dflt: '', want: (v) => ({ 'conditionText/text': `[${v}]` }), untouched: { 'conditionText/text': [''] } },
    { prop: 'fragmentType', dflt: 'standard', values: ['standard', 'alternative'],
      want: (v, get) => (v === 'alternative' ? {
        'dividerLine/visibility': 'visible', 'elseText/visibility': 'visible',
        'elseText/text': get('elseCondition') ? `[${get('elseCondition')}]` : '[else]',
      } : null),
      untouched: { 'dividerLine/visibility': ['hidden'], 'elseText/visibility': ['hidden'], 'elseText/text': [''] } },
  ],
  // `always`: the class's own default look (white body, black ring) is no event type at all, so even the default
  // `start` is applied - otherwise every hand-written start event renders as neither start nor anything else.
  'sf.BpmnEvent': [
    { prop: 'eventType', dflt: 'start', always: true, values: Object.keys(BPMN_EVENT_STYLE),
      want: (v) => BPMN_EVENT_STYLE[v],
      untouched: { 'body/fill': ['#FFFFFF'], 'body/stroke': ['#222222'], 'body/strokeWidth': [1.5], 'innerRing/stroke': ['none'],
        'innerRing/strokeWidth': [1], 'icon/fill': ['#222222'] } },
  ],
  // `always` for the same reason, from the other side: a BLANK glyph is never a look anyone chose (the stencil and
  // the panel always set one), so even the default `exclusive` fills an empty marker.
  'sf.BpmnGateway': [
    { prop: 'gatewayType', dflt: 'exclusive', always: true, values: Object.keys(BPMN_GATEWAY_GLYPH),
      want: (v) => ({ 'marker/text': BPMN_GATEWAY_GLYPH[v] }), untouched: { 'marker/text': [BPMN_GATEWAY_GLYPH.exclusive, ''] } },
  ],
});

/**
 * What a cell's authored props mean for its attrs. Pure: `get(prop)` and `getAttr('a/b')` read either a live JointJS
 * cell (class defaults merged in) or plain JSON (absent = undefined), so the loader and the validator share it.
 * Returns `{ patches, conflicts, unknown }`: `patches` are attr writes for props whose target attrs are all still
 * untouched; `conflicts` name an authored prop whose authored attr says something else (the attr renders, so the
 * loader leaves it); `unknown` names a prop value the table does not know (nothing to apply).
 */
export function propAttrPlan(type, get, getAttr) {
  const patches = {}, conflicts = [], unknown = [];
  for (const r of PROP_ATTR_RULES[type] || []) {
    const v = get(r.prop);
    if (v === undefined || v === null || (!r.always && v === r.dflt)) continue;
    if (r.values && !r.values.includes(v)) { unknown.push({ prop: r.prop, value: v, values: r.values }); continue; }
    const want = r.want(v, get);
    if (!want) continue;
    const mine = {}, clash = [];
    for (const [path, value] of Object.entries(want)) {
      const cur = getAttr(path);
      if (cur === value) continue;
      if (cur === undefined || (r.untouched[path] || []).includes(cur)) mine[path] = value;
      else clash.push({ path, cur, value });
    }
    // All or nothing per prop: half-applying a look (a red cover over a blue header) is worse than either.
    if (clash.length) conflicts.push({ prop: r.prop, value: v, clash });
    else Object.assign(patches, mine);
  }
  return { patches, conflicts, unknown };
}

// Every cell `type` the app will render. A cell with any other type is SILENTLY DROPPED on load (a deliberate
// security choice - a noisy error would let an attacker probe the allowlist), which is exactly the one failure an
// author can't see without this validator.
export const ALLOWED_CELL_TYPES = new Set([
  // Architecture
  'sf.SimpleNode', 'sf.Container', 'sf.Zone', 'sf.TextLabel', 'sf.Note',
  'sf.Annotation', 'sf.Image', 'sf.Link', 'sf.Line', 'sf.Task',
  // BPMN / Process
  'sf.BpmnEvent', 'sf.BpmnTask', 'sf.BpmnGateway', 'sf.BpmnSubprocess',
  'sf.BpmnLoop', 'sf.BpmnPool', 'sf.BpmnDataObject',
  // Flow
  'sf.FlowProcess', 'sf.FlowDecision', 'sf.FlowTerminator', 'sf.FlowDatabase',
  'sf.FlowDocument', 'sf.FlowIO', 'sf.FlowPredefined', 'sf.FlowOffPage',
  // Data Model
  'sf.DataObject',
  // Org Chart
  'sf.OrgPerson',
  // sf.TaskGroup (RACI section grouper, registered in shapes.js since v1.15) was MISSING from the loader allowlist,
  // so a saved org diagram containing one had that cell silently dropped on load. Added here (the loader imports this
  // set) to close that gap - the allowlist's own contract is to mirror the shapes registered in shapes.js.
  'sf.TaskGroup',
  // Gantt
  'sf.GanttTask', 'sf.GanttMilestone', 'sf.GanttMarker', 'sf.GanttTimeline',
  'sf.GanttGroup',
  // Sequence
  'sf.SequenceParticipant', 'sf.SequenceActor', 'sf.SequenceActivation',
  'sf.SequenceFragment',
  // Flow (Salesforce Flow elements; net-new df.* — distinct from the legacy sf.Flow* flowchart family above)
  'df.FlowStart', 'df.FlowEnd', 'df.FlowScreen', 'df.FlowAction', 'df.FlowSubflow',
  'df.FlowSendToFlow', 'df.FlowSendEmail', 'df.FlowSendSms', 'df.FlowSendWhatsApp',
  'df.FlowSendToData360', 'df.FlowSendMobileApp', 'df.FlowSendMobileInApp', 'df.FlowForwardToBot',
  'df.FlowRunAgent', 'df.FlowCreateCampaignMember', 'df.FlowCreateTask', 'df.FlowExit',
  'df.FlowAssignment', 'df.FlowDecision', 'df.FlowLoop', 'df.FlowTransform', 'df.FlowPathExperiment',
  'df.FlowCollectionSort', 'df.FlowCollectionFilter',
  'df.FlowWait', 'df.FlowWaitUntilDate', 'df.FlowWaitUntilEvent',
  'df.FlowEinsteinDecision', 'df.FlowDetermineCrmRecord',
  'df.FlowGetRecords', 'df.FlowCreateRecords', 'df.FlowUpdateRecords', 'df.FlowDeleteRecords',
  'df.FlowRollback',
  'df.FlowStage',
  'df.FlowPlaceholder',
  // Generic (df.* net-new shapes; sf.* legacy kept for save back-compat)
  'df.Pill', 'df.Legend', 'df.Table', 'df.Placeholder',
  // JointJS link
  'standard.Link',
]);

const VALID_DIAGRAM_TYPES = new Set(['architecture', 'process', 'datamodel', 'datamapping', 'org', 'gantt', 'sequence', 'flow']);
// Aliases the loader normalises (kept lenient).
const DIAGRAM_TYPE_ALIASES = Object.assign(Object.create(null), { data: 'datamodel', datamodel: 'datamodel', organisation: 'org', organization: 'org', mapping: 'datamapping', salesforceflow: 'flow', flowbuilder: 'flow', sfflow: 'flow' });

/** The diagram type(s) a TYPE-SPECIFIC shape belongs to. Cross-type generics (Note/TextLabel/Line/Image/Pill/Legend/
 *  Table/Link/Container/Zone/SimpleNode/Annotation/Task) return null - they're valid anywhere, so no warning. */
export function shapeHomeTypes(cellType) {
  if (typeof cellType !== 'string') return null;
  if (cellType.startsWith('sf.Bpmn') || cellType.startsWith('sf.Flow')) return ['process'];
  if (cellType.startsWith('df.Flow')) return ['flow'];   // net-new Salesforce Flow elements (distinct namespace from sf.Flow*)
  if (cellType === 'sf.DataObject') return ['datamodel', 'datamapping'];
  if (cellType === 'sf.OrgPerson') return ['org'];
  if (cellType.startsWith('sf.Gantt')) return ['gantt'];
  if (cellType.startsWith('sf.Sequence')) return ['sequence'];
  return null;
}

const isLink = (c) => c && typeof c === 'object' && c.source != null && c.target != null;

/**
 * Validate ONE diagram envelope. Pure - no I/O, no DOM. Reads cells from `diagram.graph.cells` (canonical) or
 * `diagram.cells` (bare graph). Returns { errors, warnings } as arrays of plain strings. ERRORS are things the loader
 * drops/throws on (the diagram won't import as authored); WARNINGS are best-practice / silent-degrade issues.
 */
export function validateDiagram(diagram) {
  const errors = [];
  const warnings = [];
  if (!diagram || typeof diagram !== 'object') return { errors: ['Top level is not a JSON object.'], warnings };

  const cells = Array.isArray(diagram.graph?.cells) ? diagram.graph.cells
    : Array.isArray(diagram.cells) ? diagram.cells : null;
  if (!cells) return { errors: ['Missing cells array (expected `graph.cells` or `cells`).'], warnings };

  if (cells.length > MAX_CELL_COUNT) errors.push(`Too many cells: ${cells.length} > ${MAX_CELL_COUNT} (load THROWS).`);

  // diagramType (the loader falls back to `architecture` when missing/unknown, silently disabling type-gated UI).
  const rawType = diagram.diagramType;
  // Case-insensitive, like the app (persistence.normalizeDiagramType lowercases): "Flow" opens as a flow, so warning
  // that it "opens as architecture" was false (audit 2026-09-23).
  const lower = typeof rawType === 'string' ? rawType.trim().toLowerCase() : rawType;
  const type = DIAGRAM_TYPE_ALIASES[lower] || lower;
  if (rawType == null) warnings.push('Missing `diagramType` - the diagram opens as "architecture", hiding the type-specific stencil + controls.');
  else if (!VALID_DIAGRAM_TYPES.has(type)) warnings.push(`Unknown diagramType "${rawType}" - opens as "architecture". Use one of: ${[...VALID_DIAGRAM_TYPES].join(', ')}.`);
  if (diagram.appVersion == null) warnings.push('Missing `appVersion` - set it to the current app version so the version-warning logic behaves.');

  const ids = new Set();
  const seen = new Set();
  const byId = new Map();   // id -> cell (first occurrence) - powers the reciprocity / field-port checks below.
  // First pass: collect valid cell ids (for the dangling-link check) + structural/allowlist/dup checks.
  for (const c of cells) {
    if (!c || typeof c !== 'object') { errors.push('A cell is not an object (dropped on load).'); continue; }
    const id = c.id;
    const ct = c.type;
    if (typeof id !== 'string' || !id) errors.push(`Cell missing a string \`id\` (type ${JSON.stringify(ct)}).`);
    else { if (seen.has(id)) errors.push(`Duplicate cell id "${id}".`); else byId.set(id, c); seen.add(id); ids.add(id); }
    if (typeof ct !== 'string' || !ct) { errors.push(`Cell "${id ?? '?'}" missing a string \`type\`.`); continue; }
    if (!ALLOWED_CELL_TYPES.has(ct)) {
      errors.push(`Cell "${id ?? '?'}" has unknown type "${ct}" - SILENTLY DROPPED on load (not in the shape allowlist).`);
      continue;
    }
    // Best-practice: a type-specific shape used in the wrong diagram type (only warns when diagramType is known).
    const home = shapeHomeTypes(ct);
    if (home && type && VALID_DIAGRAM_TYPES.has(type) && !home.includes(type)) {
      warnings.push(`Cell "${id}" is a ${ct} (a ${home.join('/')} shape) but diagramType is "${type}".`);
    }
  }

  // Second pass: dangling links (the loader drops a link whose source/target id isn't present).
  for (const c of cells) {
    if (!isLink(c)) continue;
    for (const end of ['source', 'target']) {
      const ref = c[end];
      const rid = ref && typeof ref === 'object' ? ref.id : undefined;
      if (rid != null && !ids.has(rid)) {
        errors.push(`Link "${c.id ?? '?'}" ${end} references missing cell "${rid}" - the link is DROPPED on load.`);
      }
    }
  }

  // Third pass: dangling `parent` / `embeds` (the loader STRIPS a parent whose cell isn't present). Not just
  // cosmetic - a link/element with a parent attr pointing at a missing cell makes JointJS throw "Embedding of
  // already embedded cells" on a node drag (the reparent skips the unembed but still embeds), FREEZING the canvas
  // until reload. The loader now strips these, so this is a warning (the diagram still loads + works), but an
  // author should fix the id so the intended grouping survives.
  for (const c of cells) {
    if (!c || typeof c !== 'object') continue;
    if (c.parent != null && !ids.has(c.parent)) {
      warnings.push(`Cell "${c.id ?? '?'}" has \`parent\` "${c.parent}" referencing a missing cell - the parent ref is STRIPPED on load (use a real cell id to keep the grouping).`);
    }
    if (Array.isArray(c.embeds)) {
      for (const eid of c.embeds) {
        if (!ids.has(eid)) warnings.push(`Cell "${c.id ?? '?'}" \`embeds\` a missing cell "${eid}" - pruned on load.`);
      }
    }
  }

  // Type-specific QUIET-DEGRADE traps (documented in DIAGRAM_JSON_SPEC.md "Common authoring mistakes"). Unlike the
  // generic failures above, the loader neither drops nor heals these - the cell loads but renders WRONG, so an author
  // can't see the mistake without this check. All WARNINGS (the diagram still imports).

  // One-sided embed: both cells are present but the parent<->embeds relationship is declared on only one side.
  // json-pipeline.js S6 only strips parent/embeds pointing at a MISSING cell; it does NOT reconcile a half-declared
  // embed. JointJS reads `parent` and `embeds` as independent attributes, so a one-sided embed group-moves /
  // reparents asymmetrically. The spec tells authors to set BOTH sides (child `parent` AND the id in parent `embeds`).
  for (const c of cells) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string') continue;
    if (typeof c.parent === 'string' && ids.has(c.parent)) {
      const p = byId.get(c.parent);
      const embeds = Array.isArray(p?.embeds) ? p.embeds : [];
      if (!embeds.includes(c.id)) {
        warnings.push(`Cell "${c.id}" sets \`parent\` "${c.parent}" but that cell's \`embeds\` doesn't list "${c.id}" - set BOTH sides (the loader won't reconcile a one-sided embed).`);
      }
    }
    if (Array.isArray(c.embeds)) {
      for (const eid of c.embeds) {
        if (!ids.has(eid)) continue;   // missing-child case already warned above
        const child = byId.get(eid);
        if (child && child.parent !== c.id) {
          warnings.push(`Cell "${c.id}" \`embeds\` "${eid}" but that cell's \`parent\` is ${child.parent == null ? 'unset' : `"${child.parent}"`}, not "${c.id}" - set BOTH sides.`);
        }
      }
    }
  }

  // ZERO-sided embed: a frame whose bounds geometrically enclose elements that declare NO relationship to it
  // (neither in its `embeds[]` nor carrying `parent`). The one-sided check above cannot see this - it only walks
  // declared links - so a generated diagram with five containers and 17 free-floating cards inside them validates
  // CLEAN while every container is a decorative rectangle: the frame doesn't group-move, doesn't content-hug, and
  // dragging it leaves its cards behind. Geometry is the only signal available here, so require FULL containment
  // of >= 2 elements before warning - one stray overlap is a layout accident, a whole stack is a missed embed.
  // Salesforce Flow diagrams are the one type where a Zone behind cards is CORRECT: the flow converter draws its
  // stage bands as plain backdrops on purpose (cowork-skill/.../flow-convert.js "Deliberately NOT embeds/parent" -
  // an embedded band would drag its members around on an in-app Auto Layout). Warning there was a false positive
  // on every generated flow (1.23.2 audit), which would have pushed a warnings-clean policy into breaking the
  // documented behaviour. Capture is a structural claim on every other type.
  const CAPTURE_FRAMES = new Set(type === 'flow' ? [] : ['sf.Container', 'sf.Zone', 'sf.TaskGroup', 'sf.BpmnPool', 'sf.BpmnSubprocess', 'sf.BpmnLoop']);
  // Whether frame `p` could own a nested frame `ch` - mirrors canEmbed in js/canvas/embedding.js for the frame
  // pairs (a Zone cannot embed a Zone or a TaskGroup; a Container cannot embed a Container / Zone / TaskGroup /
  // Task; a TaskGroup owns only Tasks). Kept inline because this module is a zero-dependency leaf.
  const frameCanEmbed = (p, ch) => (
    p === 'sf.Zone' ? (ch !== 'sf.Zone' && ch !== 'sf.TaskGroup')
    : p === 'sf.Container' ? !['sf.Container', 'sf.Zone', 'sf.TaskGroup', 'sf.Task'].includes(ch)
    : p === 'sf.TaskGroup' ? ch === 'sf.Task'
    : p === 'sf.BpmnPool' ? ch !== 'sf.BpmnPool'
    : p === 'sf.BpmnSubprocess' ? (ch !== 'sf.BpmnPool' && ch !== 'sf.BpmnSubprocess')
    : p === 'sf.BpmnLoop' ? !['sf.BpmnPool', 'sf.BpmnSubprocess', 'sf.BpmnLoop'].includes(ch)
    : false);
  const boxOf = (c) => (c && c.position && c.size
    && Number.isFinite(c.position.x) && Number.isFinite(c.position.y)
    && Number.isFinite(c.size.width) && Number.isFinite(c.size.height))
    ? { x: c.position.x, y: c.position.y, w: c.size.width, h: c.size.height } : null;
  for (const c of cells) {
    if (!c || !CAPTURE_FRAMES.has(c.type)) continue;
    // A frame that declares SOME children is still checked for the rest: the old early-continue on a non-empty
    // `embeds` let a lane with one captured card and four loose ones through silently (1.23.2 audit).
    const declared = new Set(Array.isArray(c.embeds) ? c.embeds : []);
    const fb = boxOf(c);
    if (!fb) continue;
    const inside = [];
    for (const o of cells) {
      if (!o || o === c || typeof o.id !== 'string') continue;
      if (o.parent != null || declared.has(o.id)) continue;   // already owned by some frame, or declared by this one
      // An UNOWNED nested frame counts as a loose child when this frame could own it: the spec's own
      // Department-Zone-over-Team-Containers pattern validated clean with the Containers unowned (1.23.2 audit).
      // A nesting the app forbids (Zone in Zone, TaskGroup in Zone) can never be captured, so it is not a miss.
      if (CAPTURE_FRAMES.has(o.type) && !frameCanEmbed(c.type, o.type)) continue;
      const ob = boxOf(o);
      if (!ob) continue;
      if (ob.x >= fb.x && ob.y >= fb.y && ob.x + ob.w <= fb.x + fb.w && ob.y + ob.h <= fb.y + fb.h) inside.push(o.id);
    }
    if (inside.length >= 2) {
      const partial = declared.size ? ` (it already declares ${declared.size})` : '';
      warnings.push(`Cell "${c.id}" (${c.type}) visually contains ${inside.length} undeclared element(s) (${inside.slice(0, 3).join(', ')}${inside.length > 3 ? ', …' : ''})${partial} - none of them set \`parent\` and none is in its \`embeds\`, so the frame is DECORATIVE for them (it won't group-move or auto-size with them, and dragging it leaves them behind). Set BOTH sides: the ids in \`embeds[]\` AND \`parent: "${c.id}"\` on each child.`);
    }
  }

  // Data Model relationships (1.23.2 audit). sf.DataObject's port ring is ONLY port-top / port-bottom (plus the
  // header er-left / er-right and the field-<side>-<fid> ports): a link naming port-left / port-right on one does
  // not throw - JointJS anchors it to the body and the line lands mid-card - so it is a quiet-degrade trap. And a
  // non-mapping link between two DataObjects with NO ER marker on either end loads fine but carries no cardinality:
  // the Table view's Relationships grid and the mapping grid's Cardinality column both read an em-dash for it.
  if (type === 'datamodel' || type === 'datamapping') {
    const isDataObject = (id) => byId.get(id)?.type === 'sf.DataObject';
    const ER_MARKER = /L\s*-12\s+-?8|a [345] [345]|M\s*-?\d+\s+-8\s*L\s*-?\d+\s+8/;   // crow / circle / bar (erEndToken's tests)
    for (const c of cells) {
      if (!c || c.type !== 'standard.Link') continue;
      const s = c.source, t = c.target;
      for (const end of [s, t]) {
        if (end && isDataObject(end.id) && (end.port === 'port-left' || end.port === 'port-right')) {
          warnings.push(`Link "${c.id ?? '?'}" anchors on "${end.port}" of "${end.id}", but an sf.DataObject has no left/right ring ports (only port-top / port-bottom, the header er-left / er-right, and field-<side>-<fid>) - the line lands on the card body. Use er-left / er-right for an object-level relationship, or a field port for a field-level one.`);
        }
      }
      if (c.linkKind === 'mapping' || !s?.id || !t?.id || !isDataObject(s.id) || !isDataObject(t.id)) continue;
      const line = c.attrs?.line || {};
      const has = (m) => !!(m && typeof m.d === 'string' && ER_MARKER.test(m.d));
      if (has(line.sourceMarker) !== has(line.targetMarker)) {
        warnings.push(`Link "${c.id ?? '?'}" relates "${s.id}" to "${t.id}" with an ER marker on ONE end only - the Table view reads the other end as an em-dash (e.g. "1:—"). Set both \`sourceMarker\` and \`targetMarker\`.`);
      } else if (!has(line.sourceMarker) && !has(line.targetMarker)) {
        warnings.push(`Link "${c.id ?? '?'}" relates "${s.id}" to "${t.id}" with no ER marker on either end - it loads, but carries no cardinality (the Table view reads an em-dash). Set \`attrs.line.sourceMarker\` / \`targetMarker\` to the Marker Types ER paths (bar = 1, crow's foot = Many, circle = 0), drawn FROM the one end TO the many end.`);
      }
    }
  }

  // Gantt: `order` IS the row slot - two GanttTasks with the same order collide in one row. (A MISSING order is
  // auto-healed from the bar's Y on load, so only the un-healed duplicate is flagged.)
  const ganttRow = new Map();   // order value -> first task id that claimed it
  for (const c of cells) {
    if (!c || c.type !== 'sf.GanttTask' || typeof c.order !== 'number') continue;
    if (ganttRow.has(c.order)) {
      warnings.push(`GanttTask "${c.id ?? '?'}" reuses \`order\` ${c.order} (already used by "${ganttRow.get(c.order)}") - each bar needs a distinct 0-based row slot.`);
    } else ganttRow.set(c.order, c.id ?? '?');
  }

  // OrgPerson: the name must be the TOP-LEVEL `personName` - the view overwrites attrs.nameLabel from it every
  // render, so a name placed only in attrs paints once then vanishes. A `vacant` slot may legitimately have none.
  for (const c of cells) {
    if (!c || c.type !== 'sf.OrgPerson') continue;
    const hasName = typeof c.personName === 'string' && c.personName.trim() !== '';
    if (!hasName && c.vacant !== true) {
      warnings.push(`OrgPerson "${c.id ?? '?'}" has no top-level \`personName\` - put the name there (not in attrs.nameLabel), or set \`vacant: true\`.`);
    }
  }

  // A link with no `router` falls back to JointJS's default, a STRAIGHT line - right for a sequence message, a
  // diagonal everywhere else. The loader adds the router for only three kinds (migrateLinks): Flow connectors (an
  // end on a df.Flow* card, or a legacy `connectorKind`), mapping links and Gantt dependencies. The JSON spec's
  // own Org example shipped without one and this validator called it clean (fixed 2026-09-24). One grouped
  // warning, not one per link: a generator that forgets routers forgets them on every link.
  if (type !== 'sequence') {
    const healed = (c) => c.linkKind === 'mapping' || c.linkKind === 'ganttDep' || c.connectorKind != null
      || [c.source, c.target].some((e) => String(byId.get(e?.id)?.type || '').startsWith('df.Flow'));
    const bare = cells.filter((c) => c && c.type === 'standard.Link' && c.router == null && !healed(c));
    if (bare.length) {
      const ids = bare.slice(0, 3).map((c) => `"${c.id ?? '?'}"`).join(', ') + (bare.length > 3 ? ', …' : '');
      warnings.push(`${bare.length} link(s) have no \`router\` (${ids}) - outside a Flow, the loader does not add one, so each renders as a straight DIAGONAL line. Add "router": { "name": "sfManhattan" } and "connector": { "name": "rounded", "args": { "radius": 8 } }.`);
    }
  }

  // DataObject field ports: a link end referencing `field-{left,right}-<fid>` must name a fid that exists on that
  // object's `fields` - a stale fid builds no port, so the link end dangles. Only checked when the object's fields
  // actually carry fids (generators MAY omit them; the app assigns on load) and the ref isn't the legacy numeric
  // index form (`field-left-3`, which migrateLinks re-keys), to avoid false positives.
  const FIELD_PORT = /^field-(?:left|right)-(.+)$/;
  for (const c of cells) {
    if (!isLink(c)) continue;
    for (const end of ['source', 'target']) {
      const ref = c[end];
      if (!ref || typeof ref !== 'object' || typeof ref.port !== 'string' || typeof ref.id !== 'string') continue;
      const m = FIELD_PORT.exec(ref.port);
      if (!m || /^\d+$/.test(m[1])) continue;
      const obj = byId.get(ref.id);
      if (!obj || obj.type !== 'sf.DataObject' || !Array.isArray(obj.fields)) continue;
      const fids = obj.fields.map((f) => f && f.fid).filter((x) => typeof x === 'string');
      if (fids.length && !fids.includes(m[1])) {
        warnings.push(`Link "${c.id ?? '?'}" ${end} port "${ref.port}" references field id "${m[1]}" not on DataObject "${ref.id}" - copy a real \`fid\` from its fields (a stale one builds no port, so the end dangles).`);
      }
    }
  }

  // BpmnGateway: the decision glyph lives in `attrs.marker.text` and is NOT derived from `gatewayType` on load
  // (it's applied only at stencil-drop). Since 2026-09-25 the loader DOES derive it (propAttrPlan above), so an
  // authored gateway without a glyph renders right; what still renders wrong is covered by the prop/attrs check below.

  // Props vs attrs (propAttrPlan): the loader applies an authored prop only to attrs still at their class default,
  // so a prop and an authored attr that DISAGREE render the attr and ignore the prop - the author meant one of them.
  for (const c of cells) {
    if (!c || typeof c.type !== 'string') continue;
    const plan = propAttrPlan(c.type, (k) => c[k], (path) => {
      const [a, b] = path.split('/');
      return c.attrs?.[a]?.[b];
    });
    for (const u of plan.unknown) {
      warnings.push(`${c.type} "${c.id ?? '?'}" has \`${u.prop}\` "${u.value}", which is not one of ${u.values.join(' / ')} - nothing renders from it.`);
    }
    for (const k of plan.conflicts) {
      const said = k.clash.map((x) => `attrs.${x.path.replace('/', '.')} is ${JSON.stringify(x.cur)} (the prop means ${JSON.stringify(x.value)})`).join('; ');
      warnings.push(`${c.type} "${c.id ?? '?'}" has \`${k.prop}\` "${k.value}" but ${said} - the attrs render and the prop is ignored. Make them agree, or drop the attrs and let the loader apply the prop.`);
    }
  }

  return { errors, warnings };
}

/** Validate a single diagram OR a `diagramforce-export` bundle (validates each `diagrams[]` entry). Returns an array
 *  of { name, errors, warnings } so the CLI can report per-diagram. */
export function validateFile(json) {
  if (json && json.schema === 'diagramforce-export' && Array.isArray(json.diagrams)) {
    return json.diagrams.map((d, i) => ({ name: d?.name || `diagrams[${i}]`, ...validateDiagram(d) }));
  }
  return [{ name: json?.title || 'diagram', ...validateDiagram(json) }];
}

// Salesforce Flow metadata -> Diagramforce `flow` diagram JSON. THE SOURCE OF TRUTH for that conversion,
// shared verbatim by the app (Load & Import) and the Cowork skill's CLI - dev/tests/skill-sync.test.js
// fails if the two drift.
//
// Input: what the Salesforce Tooling API returns for a flow version -
//   GET /services/data/vXX.0/tooling/sobjects/Flow/301...
// Pass the whole response envelope or just its `Metadata` object; either works. (The app also accepts a
// `.flow-meta.xml` source file, which flow-import.js turns into this same shape before calling in.)
//
// Layout: Flow Builder persists locationX/locationY for classic flows, writes ZEROS for some builders
// (Marketing Cloud Next "Journey" flows), and can persist only a partial set. Unless EVERY element has a
// coordinate this falls back to the app's own tidy-tree layout so the flow still reads like Flow Builder.
//
// ZERO IMPORTS AND NO DOM BY DESIGN. The two things that differ between a browser and a Node CLI - the
// layout function and the app version - are INJECTED via opts rather than imported, so this exact file
// runs unchanged in both. Do not add an import here; it would break the verbatim-copy contract (the app
// rewrites every import with a `?v=` cache key, which the skill's copy must not carry).

// Card geometry + z-tiers. These MIRROR the app's own (FLOW_W/FLOW_H in js/shapes/flow.js, Z_ELEMENT /
// Z_LINK in js/canvas/z-tiers.js) and are restated rather than imported to keep this file import-free.
const W = 210, H = 56, Z_EL = 2000, Z_LINK = 3000;
const FAULT_RED = '#EA001E';
const GOTO_BLUE = '#0B5CAB';

// ── value helpers ────────────────────────────────────────────────────────────
// A Flow `value` object carries ~14-21 keys with exactly one non-null. The key set GROWS with API version,
// so never assume a fixed shape - probe in priority order and fall back to "first non-null".
const VALUE_KEYS = ['stringValue', 'booleanValue', 'numberValue', 'dateValue', 'dateTimeValue', 'timeValue', 'formulaExpression', 'apexValue'];
function pickValue(v) {
  if (v == null) return null;
  if (typeof v !== 'object') return String(v);
  if (v.elementReference) return `{!${v.elementReference}}`;
  for (const k of VALUE_KEYS) if (v[k] != null) return String(v[k]);
  for (const [k, val] of Object.entries(v)) {
    if (val == null || k === 'processMetadataValues' || Array.isArray(val) || typeof val === 'object') continue;
    return String(val);
  }
  return null;
}
// conditionLogic is 'and', 'or', OR a custom formula over condition NUMBERS ("1 AND (2 OR 3)"). Collapsing
// that third case to AND does not lose information, it ASSERTS SOMETHING FALSE - the reader is told every
// condition must hold when only some must. A missing row invites a question; a wrong row ends it. So a
// custom formula numbers its conditions and prints the formula verbatim.
const isCustomLogic = (logic) => {
  const v = String(logic || '').trim().toLowerCase();
  return v !== '' && v !== 'and' && v !== 'or';
};
const joinLogic = (logic) => (String(logic || 'and').toLowerCase() === 'or' ? ' OR ' : ' AND ');
function joinConditions(parts, logic) {
  if (!parts.length) return null;
  if (!isCustomLogic(logic)) return parts.join(joinLogic(logic));
  return parts.map((p, i) => `${i + 1}: ${p}`).join(' \u00b7 ') + ` (logic: ${String(logic).trim()})`;
}
// Flow's condition operators are CamelCase enum names ("EqualTo"), which read as noise in a documentation
// table - "DetailsChoice EqualTo {!No}" takes a beat to parse. Render the comparison operators as symbols and
// the wordy ones as words. Anything unmapped falls back to the raw enum de-camel-cased, so a new operator
// degrades to readable English rather than disappearing.
const OPERATOR = {
  EqualTo: '=', NotEqualTo: '\u2260',
  GreaterThan: '>', GreaterThanOrEqualTo: '\u2265', LessThan: '<', LessThanOrEqualTo: '\u2264',
  Contains: 'contains', StartsWith: 'starts with', EndsWith: 'ends with',
  IsNull: 'is null', IsChanged: 'changed', IsBlank: 'is blank',
  WasSet: 'was set', WasSelected: 'was selected', WasVisited: 'was visited',
  In: 'in', NotIn: 'not in',
};
const readOperator = (op) => OPERATOR[op] || String(op || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
const summarizeFilters = (filters, logic) => joinConditions((filters || [])
  .map((f) => [f.field, readOperator(f.operator), pickValue(f.value)].filter(Boolean).join(' ')), logic);
const summarizeConditions = (conds, logic) => joinConditions((conds || [])
  .map((c) => [c.leftValueReference, readOperator(c.operator), pickValue(c.rightValue)].filter(Boolean).join(' ')), logic);
const actionParam = (el, name) => {
  const p = (el.inputParameters || []).find((x) => x.name === name);
  return p ? pickValue(p.value) : null;
};
// A CMS content reference is a fully-qualified path -
// "marketing--Default_Content_Workspace.sfdc_cms__email--MCY7J44O4PBNCAHJCRL5UGNFJ7HI". Flow Builder shows
// only the trailing key ("Content Key"), which is the part a person can actually match against the asset,
// so surface that on the card. The full reference stays in the Metadata rows, unabridged.
const contentKey = (ref) => {
  const s = String(ref || '');
  const tail = s.split('--').pop();
  return tail && tail !== s ? tail : (s || null);
};
// ── details rows ─────────────────────────────────────────────────────────────
// A card's per-kind `fields` are one-line summaries sized for a 210px card. The metadata carries a lot more
// than that, and for DOCUMENTATION the detail is the point - "Update Records on Case" is far less useful than
// knowing WHICH fields it sets. `details` is the existing `[{label, value}]` row array (shipped 1.11 for org
// Person cards): free text, arbitrary rows, so it stays inside decision #9 - no parsing, no validation, no
// typed schema. It renders as a read-only table in the property panel, never on the card itself.
const DETAIL_CAP = 20;   // a 60-field screen would otherwise bury the panel
function capRows(out) {
  if (out.length <= DETAIL_CAP) return out;
  const extra = out.length - DETAIL_CAP;
  return out.slice(0, DETAIL_CAP).concat([{ label: `+${extra} more`, value: 'not shown' }]);
}
function rows(list, toRow) {
  const out = [];
  // Tolerate a NON-ARRAY. XML has no arrays, so a repeated child that appears exactly once arrives as a bare
  // object unless flow-import.js's schema hint lists it - and a missing hint used to crash the whole import
  // here (for..of over an object throws), turning one absent key into a total failure on an ordinary flow.
  // Degrading to a single row keeps a schema-hint gap lossy instead of fatal.
  const items = Array.isArray(list) ? list : (list && typeof list === 'object' ? [list] : []);
  for (const item of items) {
    const r = toRow(item);
    if (r && r.label) out.push({ label: String(r.label), value: r.value == null ? '' : String(r.value) });
  }
  return capRows(out);
}
/** Field assignments an element WRITES - the single most useful fact a Create/Update card was missing. */
const assignmentRows = (el) => rows(el.inputAssignments, (a) => ({ label: a.field, value: pickValue(a.value) }));
/** Fields a Get Records READS OUT into flow variables (`field` -> `assignToReference`). */
const outputRows = (el) => rows(el.outputAssignments, (o) => ({ label: o.field, value: `-> {!${o.assignToReference}}` }));
// A screen component's meaning is NOT in `fieldType`. For a ComponentInstance - which is most of a modern
// screen - fieldType literally reads "ComponentInstance" for every row, saying nothing. What identifies it
// is `extensionName` (pi:combobox, flowruntime:choiceLookup, pi:progressIndicator), and what a PERSON calls
// it is either the component's `label` input parameter or, for the built-in field types, `fieldText`.
// Measured on a real Account Engagement flow: 26 of 33 rows said only "ComponentInstance".
//
// `fieldText` is only usable as a label when it is plain text - on a DisplayText block it is a blob of
// styled HTML, which is prose to render, not a name.
const plainText = (t) => {
  const v = String(t || '').trim();
  return v && !/[<>]/.test(v) ? v : null;
};
const LABEL_MAX = 60;
const screenFieldLabel = (f) => {
  const labelParam = (f.inputParameters || []).find((p) => p.name === 'label');
  const fromParam = labelParam && plainText(pickValue(labelParam.value));
  // fieldText is the LABEL on an input/choice field but the BODY on a DisplayText block. Even unformatted,
  // a body is a paragraph - putting it in the key column turns the table into wrapped prose - so it is
  // never a label there, and elsewhere only when short enough to read as a name.
  const fromText = f.fieldType === 'DisplayText' ? null : plainText(f.fieldText);
  const label = fromParam || (fromText && fromText.length <= LABEL_MAX ? fromText : null);
  return label || f.name;
};
/** Screen components: what the user sees, which component renders it, and when it is shown at all.
 *  A visibilityRule is real branching logic that lives INSIDE a screen rather than on the canvas - a
 *  component gated on a variable never appears as a connector, so without this the reader cannot tell a
 *  screen that always shows six fields from one that shows three of six depending on how the flow was
 *  launched. It rides the same row as the component rather than adding a second one. */
const screenRows = (el) => rows(el.fields, (f) => {
  const label = screenFieldLabel(f);
  const shown = summarizeConditions(f.visibilityRule?.conditions, f.visibilityRule?.conditionLogic);
  return {
    label,
    // The API NAME rides along whenever it differs from the label. Labels are not unique the way names are
    // - two components can legitimately share one - and the name is what every other element references,
    // so dropping it would make a row impossible to trace back.
    value: [
      f.extensionName || f.fieldType || '',
      label !== f.name ? f.name : null,
      shown && `shown when ${shown}`,
    ].filter(Boolean).join(' \u00b7 '),
  };
});
/** Each decision outcome and the condition that selects it. */
const outcomeRows = (el) => {
  const out = rows(el.rules, (r) => ({
    label: r.label || r.name,
    value: summarizeConditions(r.conditions, r.conditionLogic) || '',
  }));
  // The default outcome has no conditions by definition - it is "everything else" - but it IS a branch the
  // reader sees on the canvas, so listing it keeps the table and the diagram in agreement.
  if (el.defaultConnectorLabel) out.push({ label: String(el.defaultConnectorLabel), value: 'otherwise (no conditions)' });
  return out;
};
// An action's input parameters, so an Action card documents what it was actually called with. Parameters
// that are PRESENT BUT UNSET (fromAddress, replyToName, ... on a Send Email) are dropped: Salesforce emits
// the full parameter list whether or not it is configured, and a column of em-dashes buries the handful of
// rows that say something.
//
// ...and then WHERE THE RESULT GOES, which was missing entirely. A Get Records already documents its
// `outputAssignments` as "Subject -> {!vSubject}"; an actionCall's `outputParameters` is the identical
// concept under a different key and was simply never wired, so on an action-driven flow every hop
// documented its inputs and none documented its output. `storeOutputAutomatically` is the other half: the
// action stores its result under its OWN name (referenced elsewhere as `{!Element.field}`), which is why
// those elements carry an EMPTY outputParameters list and still feed the rest of the flow.
const actionParamRows = (el) => {
  const out = [];
  for (const p of el.inputParameters || []) {
    const v = pickValue(p.value);
    if (p.name && v != null && String(v).trim() !== '') out.push({ label: p.name, value: String(v) });
  }
  for (const o of el.outputParameters || []) {
    if (o.assignToReference) out.push({ label: o.name || 'output', value: `-> {!${o.assignToReference}}` });
  }
  // storeOutputAutomatically: the element stores its result under ITSELF, and the rest of the flow reaches
  // it as {!Element.someOutput} - NOT as {!Element}. Naming a field we cannot know would be a confidently
  // wrong expression, which is worse than a vague true one, so say only what is certain.
  if (!el.outputParameters?.length && el.storeOutputAutomatically) {
    out.push({ label: 'Output', value: `stored on the element (referenced as {!${el.name}.<output>})` });
  }
  // Cap ONCE over the whole list. Capping inputs and outputs separately put a "+N more" marker in the
  // MIDDLE of the table with rows still listed underneath - which reads as a rendering fault.
  return capRows(out);
};

// A wait event's label/name is generated as `<Prefix>_<parent wait element's name>` -
// "Event_Occurs_Wait_Until_Reply_EMAIL_3", "Timeout_Wait_Until_Reply_EMAIL_3". Flow Builder shows just the
// prefix ("Event Occurs", "Timeout"), which is what the branch actually means, so strip the parent's name
// and de-underscore what is left. A pure "el_0" placeholder carries no meaning at all - fall back to the
// duration there, which is the one useful thing a timed wait branch can say.
function waitEventLabel(ev, parentName) {
  const raw = ev.label || ev.name || '';
  let stem = raw;
  if (parentName && stem.length > parentName.length && stem.endsWith(parentName)) {
    stem = stem.slice(0, -parentName.length).replace(/_+$/, '');
  }
  stem = stem.replace(/_+/g, ' ').trim();
  if (stem && !/^el \d+$/i.test(stem)) return stem;
  if (ev.offset != null && ev.offsetUnit) return `${ev.offset} ${ev.offsetUnit}`;
  return null;
}
/** A wait's branches with what each one waits FOR - the duration the branch label no longer carries. */
const waitRows = (el) => rows(el.waitEvents, (ev) => ({
  label: waitEventLabel(ev, el.name) || ev.name,
  // WHAT it waits for, not just how long. An event branch has no offset and often no conditions either -
  // the thing it waits on lives in inputParameters (and recordTriggerType for a record event) - so those
  // branches rendered as a label beside an empty cell: "the flow waits" without saying for what.
  value: [
    ev.offset != null && ev.offsetUnit ? `after ${ev.offset} ${ev.offsetUnit}` : null,
    ev.recordTriggerType ? `on record ${ev.recordTriggerType}` : null,
    ...(ev.inputParameters || []).map((p) => {
      const v = pickValue(p.value);
      return v == null || String(v).trim() === '' ? null : `${p.name} ${v}`;
    }),
    summarizeConditions(ev.conditions, ev.conditionLogic),
  ].filter(Boolean).join(' \u00b7 '),
}));

// ── actionCalls -> a specific class when the actionType identifies one, else the generic Action card ──
// A TABLE, not a switch, so adding a mapping is one row and the whole vocabulary is readable at a glance.
// Matched against `actionType` first, then `actionName` (some orgs carry the discriminator only in the name).
//
// Deliberately ABSENT: df.FlowSendToFlow, df.FlowSendToData360, df.FlowEinsteinDecision and
// df.FlowDetermineCrmRecord. Those four shapes exist in the stencil for hand-drawing, but FLOW_ELEMENTS
// gives them the SAME metadata source as their plain siblings (`subflows` for Send to a Flow, `actionCalls`
// for the other three) - the metadata carries no field that separates them. Guessing an actionType string
// would silently MISLABEL real elements, which is worse than the generic card, so they stay unmapped until
// a real flow supplies the discriminator. df.FlowExit is different: FLOW_ELEMENTS documents its trigger
// (REMOVE_FROM_FLOW), so it is mapped below.
const ACTION_CLASS = {
  sendEmailMessage: ['df.FlowSendEmail', (el) => ({ template: contentKey(actionParam(el, 'contentId')) })],
  // Classic CRM email actions - the pre-Marketing-Cloud-Next vocabulary, and by far the most common in
  // ordinary orgs. They were missing entirely, so every "Send Email" in a classic flow drew as a bare Action.
  emailSimple: ['df.FlowSendEmail', (el) => ({ template: actionParam(el, 'emailTemplateId') || actionParam(el, 'emailSubject') })],
  emailAlert: ['df.FlowSendEmail', (el) => ({ template: el.actionName || null })],
  sendSmsMessage: ['df.FlowSendSms', (el) => ({ template: contentKey(actionParam(el, 'contentId')) })],
  sendWhatsAppMessage: ['df.FlowSendWhatsApp', (el) => ({ template: contentKey(actionParam(el, 'contentId')) })],
  sendMobileAppMessage: ['df.FlowSendMobileApp', (el) => ({ template: contentKey(actionParam(el, 'contentId')) })],
  sendMobileInAppMessage: ['df.FlowSendMobileInApp', (el) => ({ template: contentKey(actionParam(el, 'contentId')) })],
  forwardToBotOrAgent: ['df.FlowForwardToBot', (el) => ({ actionName: el.actionName })],
  GENERATE_AI_AGENT_RESPONSE: ['df.FlowRunAgent', (el) => ({ actionName: el.actionName })],
  createCampaignMember: ['df.FlowCreateCampaignMember', (el) => ({ actionName: el.actionName, object: 'CampaignMember' })],
  createTask: ['df.FlowCreateTask', (el) => ({ actionName: el.actionName })],
  REMOVE_FROM_FLOW: ['df.FlowExit', () => ({})],
};
function actionType(el) {
  const hit = ACTION_CLASS[String(el.actionType || '')] || ACTION_CLASS[String(el.actionName || '')];
  if (hit) return [hit[0], hit[1](el)];
  return ['df.FlowAction', { actionName: el.actionName, actionType: el.actionType }];
}
// The FULL ManageableState enum, phrased for a reader rather than echoed raw. Two distinctions the earlier
// whitelist got wrong: `installedEditable` is how second-generation and unlocked packages install (and was
// missed entirely, so those flows looked home-grown); and `released`/`beta` mean this org is the package
// SOURCE, so calling them "managed package" content would be backwards. Unknown values pass through rather
// than vanish - Salesforce can add a state, and a raw value beats a silent drop.
const PACKAGE_STATE = {
  installed: 'installed from a package (not editable here)',
  installedEditable: 'installed from an unlocked/2GP package (editable)',
  deprecated: 'deprecated package component',
  deprecatedEditable: 'deprecated package component (editable)',
  released: 'this org is the package source (released)',
  beta: 'this org is the package source (beta)',
  deleted: 'marked for deletion in the package',
};
function packageState(raw) {
  const v = String(raw || '').trim();
  if (!v || /^unmanaged$/i.test(v)) return null;   // the org's own flow - the row means nothing
  return PACKAGE_STATE[v] || v;
}

// One side of a flow's public interface, as "name (Type)" with collections marked. Capped: a flow with 30
// inputs has a design problem, and a card is not the place to discover it.
const SIGNATURE_CAP = 12;
function varSignature(variables, flag) {
  const picked = (variables || []).filter((v) => v && v[flag] && v.name);
  if (!picked.length) return null;
  const shown = picked.slice(0, SIGNATURE_CAP).map((v) => {
    const type = v.apexClass || v.objectType || v.dataType;
    return type ? `${v.name} (${type}${v.isCollection ? '[]' : ''})` : v.name;
  });
  const extra = picked.length - shown.length;
  return shown.join(', ') + (extra > 0 ? `, +${extra} more` : '');
}

// Flow Builder's Loop panel renders iterationOrder as a sentence, not the raw enum.
const ITERATION_ORDER = { Asc: 'First item to last item', Desc: 'Last item to first item' };
const WAIT_SUBTYPE = { WaitDuration: 'df.FlowWait', WaitUntilDate: 'df.FlowWaitUntilDate', WaitUntilTime: 'df.FlowWaitUntilDate', WaitUntilEvent: 'df.FlowWaitUntilEvent' };
// collectionProcessors: an explicit subtype map. A substring test for "Sort" used to decide this, so every
// non-Sort subtype (RecommendationMap included) was silently relabelled "Collection Filter" - a wrong card,
// not a missing one. Anything unmapped now falls back to Filter AND names itself in the warnings.
const COLLECTION_PROCESSOR_SUBTYPE = {
  SortCollectionProcessor: 'df.FlowCollectionSort',
  FilterCollectionProcessor: 'df.FlowCollectionFilter',
  RecommendationMapCollectionProcessor: 'df.FlowCollectionFilter',
};

// Each collection -> [cell type (or resolver), per-kind field extractor].
const COLLECTIONS = [
  ['screens', () => 'df.FlowScreen', (e) => {
    const all = e.fields || [];
    // DisplayText blocks are prose, not inputs - lead with the interactive fields so the card says what the
    // screen ASKS, and cap the list: a 13-screen flow otherwise writes paragraphs onto a 210px card.
    const interactive = all.filter((f) => f.fieldType && f.fieldType !== 'DisplayText');
    // List them ALL. This is a multi-line panel field, not the 210px card label (the card shows only the
    // element name), so the old slice(0,4) + "(+6 more)" hid information for no layout benefit. Interactive
    // fields lead so the summary opens with what the screen ASKS; DisplayText prose follows.
    const ordered = [...interactive, ...all.filter((f) => !interactive.includes(f))];
    return { components: ordered.map((f) => f.name).join(', ') || null, details: screenRows(e) };
  }],
  // Orchestrator stages have NO dedicated df.Flow* class (the spec's Flow Shapes table stops at the
  // standard element set), so they degrade to the generic Action card with their steps as the summary.
  // Recorded as a warning per run - a df.FlowStage shape would be the faithful fix.
  ['orchestratedStages', () => 'df.FlowAction', (e) => ({
    actionName: (e.stageSteps || []).map((s) => s.label || s.name).join(' → ') || null,
    actionType: 'Orchestrator stage',
  })],
  ['subflows', () => 'df.FlowSubflow', (e) => ({ flowName: e.flowName })],
  ['assignments', () => 'df.FlowAssignment', (e) => ({ assignmentItems: (e.assignmentItems || []).map((a) => `${a.assignToReference} ${a.operator || '='} ${pickValue(a.value)}`).join('; ') || null })],
  ['decisions', () => 'df.FlowDecision', (e) => ({ outcomes: (e.rules || []).map((r) => r.label || r.name).concat(e.defaultConnectorLabel ? [e.defaultConnectorLabel] : []).join(', ') || null, details: outcomeRows(e) })],
  ['loops', () => 'df.FlowLoop', (e) => ({
    collectionReference: e.collectionReference,
    details: [
      { label: 'Collection', value: e.collectionReference || '' },
      // Flow Builder calls this "Direction" and spells the enum out; Asc/Desc alone reads as jargon.
      { label: 'Direction', value: ITERATION_ORDER[e.iterationOrder] || e.iterationOrder || '' },
      { label: 'Loop variable', value: e.assignNextValueToReference || '' },
    ].filter((r) => r.value),
  })],
  ['transforms', () => 'df.FlowTransform', (e) => ({ transformTarget: e.objectType || e.transformTarget || null })],
  ['recordLookups', () => 'df.FlowGetRecords', (e) => ({ object: e.object, filters: summarizeFilters(e.filters, e.filterLogic), details: outputRows(e) })],
  ['recordCreates', () => 'df.FlowCreateRecords', (e) => ({ object: e.object, details: assignmentRows(e) })],
  ['recordUpdates', () => 'df.FlowUpdateRecords', (e) => ({ object: e.object, filters: summarizeFilters(e.filters, e.filterLogic), details: assignmentRows(e) })],
  ['recordDeletes', () => 'df.FlowDeleteRecords', (e) => ({ object: e.object, filters: summarizeFilters(e.filters, e.filterLogic) })],
  ['recordRollbacks', () => 'df.FlowRollback', () => ({})],
  ['experiments', () => 'df.FlowPathExperiment', (e) => ({ outcomes: (e.experimentPaths || []).map((p) => p.name).join(', ') || null })],
  ['collectionProcessors', (e, warn) => {
    const sub = String(e.elementSubtype || e.collectionProcessorType || '');
    const cls = COLLECTION_PROCESSOR_SUBTYPE[sub];
    if (!cls && sub) warn(`collectionProcessor subtype "${sub}" has no dedicated shape - drawn as Collection Filter`);
    return cls || 'df.FlowCollectionFilter';
  }, (e) => ({ collectionReference: e.collectionReference, conditions: summarizeConditions(e.conditions, e.conditionLogic) })],
  ['waits', (e) => WAIT_SUBTYPE[e.elementSubtype] || 'df.FlowWait',
    (e) => ({ waitEvents: (e.waitEvents || []).map((ev) => waitEventLabel(ev, e.name)).filter(Boolean).join(', ') || null, details: waitRows(e) })],
  ['actionCalls', (e) => actionType(e)[0], (e) => ({ ...actionType(e)[1], details: actionParamRows(e) })],
  // Elements with no dedicated shape yet. They are listed EXPLICITLY (rather than left to the catch-all
  // below) so their cards carry a useful summary instead of a bare name. Custom Error in particular is a
  // current, common element - it was being dropped outright, which also killed every connector aimed at it.
  ['customErrors', () => 'df.FlowAction', (e) => ({
    actionType: 'Custom Error',
    actionName: (e.customErrorMessages || []).map((m) => m.errorMessage).filter(Boolean).join(' · ') || null,
  })],
  ['apexPluginCalls', () => 'df.FlowAction', (e) => ({ actionType: 'Apex Plugin', actionName: e.apexClass || null })],
  ['steps', () => 'df.FlowAction', () => ({ actionType: 'Step (legacy)' })],
];
// Keys handled above - the catch-all scan skips these.
const HANDLED_KEYS = new Set(COLLECTIONS.map(([k]) => k));
// A connector can live under any of these; used both to route edges and to RECOGNISE an unknown collection
// as a set of flow ELEMENTS (rather than resources like `variables` / `choices`, which carry none).
const CONNECTOR_KEYS = ['connector', 'connectors', 'faultConnector', 'defaultConnector', 'nextValueConnector', 'noMoreValuesConnector'];

function convert(input, opts = {}) {
  // A managed-package flow returns the envelope with `Metadata: null` - Salesforce withholds a packaged
  // flow's definition from subscribers. Falling through to `|| input` then treats the ENVELOPE as the
  // metadata: no element collections, so an empty Start -> End diagram, carrying a confident "Package:
  // installed" card. That is the single most likely real-world input for this row, so name it.
  if (input && typeof input === 'object' && 'Metadata' in input && input.Metadata == null) {
    throw new Error("This flow's definition is not readable: the Tooling API returned no Metadata. "
      + 'That is what a MANAGED PACKAGE flow looks like to a subscriber org - Salesforce withholds a '
      + 'packaged flow\'s internals. Ask the package publisher for the diagram, or convert a flow your own '
      + 'org authored.');
  }
  const md = input?.Metadata || input;
  if (!md || typeof md !== 'object') throw new Error('No Flow Metadata found in input');
  const title = input?.MasterLabel || md.label || 'Imported Flow';
  const cells = [];
  const edges = [];          // { source, target, kind, label }
  const nodes = [];          // for layout
  const coords = new Map();  // id -> {x,y} from metadata
  const seen = new Set();
  const warnings = [];

  const addNode = (id, type, name, extra, el) => {
    if (seen.has(id)) { warnings.push(`duplicate element name "${id}" - second one skipped`); return false; }
    seen.add(id);
    const cell = { id, type, position: { x: 0, y: 0 }, size: { width: W, height: H }, z: Z_EL, name };
    if (el?.name) cell.apiName = el.name;
    if (el?.description) cell.description = String(el.description).replace(/\s+/g, ' ').trim();
    for (const [k, v] of Object.entries(extra || {})) {
      if (v == null || v === '') continue;
      // `details` is a row ARRAY, not a summary string - String()ing it would yield "[object Object]".
      if (Array.isArray(v)) { if (v.length) cell[k] = v; continue; }
      cell[k] = String(v);
    }
    cells.push(cell);
    nodes.push({ id, w: W, h: H });
    coords.set(id, { x: Number(el?.locationX) || 0, y: Number(el?.locationY) || 0 });
    return true;
  };
  const addEdge = (source, target, connector, label, kind) => {
    if (!connector?.targetReference && !target) return;
    const styleKind = kind || (connector?.isGoTo ? 'goto' : 'regular');
    // A faultConnector can ALSO be a Go To (isGoTo) - real flows point many faults at one shared error
    // screen that way. Paint it as a fault (red) but keep it OUT of the spanning tree like any Go To:
    // as a fault LATERAL the shared screen would be ranked beside whichever element referenced it first
    // and drag the trunk sideways.
    const layoutKind = (styleKind === 'fault' && connector?.isGoTo) ? 'goto' : styleKind;
    edges.push({ source, target: target || connector.targetReference, kind: styleKind, layoutKind, label: label || null });
  };
  const addDeadBranch = (source, label) => edges.push({ source, target: null, kind: 'regular', layoutKind: 'regular', label: label || null, needsEnd: true });

  // ── Start (UI-only label; the metadata `start` has no name) ──
  const START_ID = '__start';
  const st = md.start || {};
  // Start's details. Its Flow Details fields cover the trigger basics, but everything that explains WHEN and
  // HOW the flow runs lived only in the raw metadata: entry conditions, each scheduled path's offset, the
  // record-trigger mode, and the builder's own processMetadataValues (CanvasMode / OriginBuilderType - which
  // is how you tell a Marketing Cloud Next journey from a classic flow). A screen flow legitimately has none
  // of these, in which case the section simply does not render.
  const startDetails = [
    ...(st.recordTriggerType ? [{ label: 'Record trigger', value: String(st.recordTriggerType) }] : []),
    ...(st.doesRequireRecordChangedToMeetCriteria ? [{ label: 'Only on change', value: 'yes' }] : []),
    ...(st.schedule ? [{ label: 'Schedule', value: [st.schedule.frequency, st.schedule.startDate, st.schedule.startTime?.timeValue].filter(Boolean).join(' \u00b7 ') }] : []),
    ...(st.filters?.length ? [{ label: 'Entry conditions', value: summarizeFilters(st.filters, st.filterLogic) || '' }] : []),
    ...rows(st.scheduledPaths, (sp) => ({
      label: sp.label || sp.name,
      value: [sp.offsetNumber != null ? `${sp.offsetNumber} ${sp.offsetUnit || ''}`.trim() : null, sp.timeSource].filter(Boolean).join(' after ') || 'immediately',
    })),
    ...rows(md.processMetadataValues, (m) => ({ label: m.name, value: pickValue(m.value) })),
  ].filter((r) => r.value != null && String(r.value).trim() !== '');

  addNode(START_ID, 'df.FlowStart', (st.label || '').trim() || 'Start', {
    details: startDetails,
    processType: md.processType,
    triggerType: st.triggerType,
    object: st.object,
    filters: summarizeFilters(st.filters, st.filterLogic),
    configuration: [st.segment && `segment ${st.segment}`, st.dataGraph && `data graph ${st.dataGraph}`,
      st.schedule?.frequency && `schedule ${st.schedule.frequency}`, st.recordTriggerType].filter(Boolean).join(' · ') || null,
  }, st);
  // The entry point comes in TWO forms. Modern flows nest `start.connector`; plenty of others (and every
  // flow whose Start is implicit) instead name the first element in a top-level `startElementReference`.
  // Reading only the first shape turned those into a bare Start -> End with the whole flow orphaned beside it.
  if (st.connector) addEdge(START_ID, null, st.connector);
  else if (md.startElementReference) addEdge(START_ID, md.startElementReference, { targetReference: md.startElementReference });
  else warnings.push('flow declares no entry point (no start.connector and no startElementReference) - Start left unconnected');
  for (const p of st.scheduledPaths || []) addEdge(START_ID, null, p.connector, p.label || p.name);

  // ── Every other collection ──
  const warn = (m) => warnings.push(m);
  for (const [key, typeOf, fieldsOf] of COLLECTIONS) {
    for (const el of md[key] || []) {
      if (!el?.name) { warnings.push(`${key} entry without a name - skipped`); continue; }
      if (!addNode(el.name, typeOf(el, warn), el.label || el.name, fieldsOf(el), el)) continue;

      // Connectors live in a DIFFERENT place per element type - this is the whole edge model.
      if (key === 'decisions') {
        for (const r of el.rules || []) {
          if (r.connector) addEdge(el.name, null, r.connector, r.label || r.name);
          else addDeadBranch(el.name, r.label || r.name);
        }
        // A decision ALWAYS has a default path in Flow Builder, so a null defaultConnector with a real
        // label ("Yes"/"No") is a branch that ends - draw it. (Waits are different: their auto-generated
        // "Default Path" label with no connector is boilerplate, so those are skipped.)
        if (el.defaultConnector) addEdge(el.name, null, el.defaultConnector, el.defaultConnectorLabel || 'Default Outcome');
        else if (el.defaultConnectorLabel) addDeadBranch(el.name, el.defaultConnectorLabel);
      } else if (key === 'waits') {
        for (const ev of el.waitEvents || []) {
          if (ev.connector) addEdge(el.name, null, ev.connector, waitEventLabel(ev, el.name));
          else addDeadBranch(el.name, waitEventLabel(ev, el.name));
        }
        if (el.defaultConnector) addEdge(el.name, null, el.defaultConnector, el.defaultConnectorLabel || null);
      } else if (key === 'loops') {
        addEdge(el.name, null, el.nextValueConnector, 'For Each', el.nextValueConnector?.isGoTo ? 'goto' : 'loopNext');
        addEdge(el.name, null, el.noMoreValuesConnector, 'After Last', el.noMoreValuesConnector?.isGoTo ? 'goto' : 'loopExit');
      } else if (key === 'experiments') {
        // A Path Experiment branches exactly like a decision. Its paths were read for the CARD summary but
        // never for EDGES, so every experiment drew as a dead end and its whole downstream vanished.
        for (const p of el.experimentPaths || []) {
          if (p.connector) addEdge(el.name, null, p.connector, p.name || p.label);
          else addDeadBranch(el.name, p.name || p.label);
        }
      } else {
        addEdge(el.name, null, el.connector);
        // Legacy `steps` carry a `connectors` ARRAY rather than a single `connector`.
        for (const c of el.connectors || []) addEdge(el.name, null, c, c.label || null);
      }
      if (el.faultConnector) addEdge(el.name, null, el.faultConnector, 'Fault', 'fault');
    }
  }

  // ── Catch-all: any element collection this converter does not know about ────────────────────────────
  // The list above is a whitelist, and a whitelist silently DROPS whatever Salesforce adds next - which
  // then also kills every connector pointing at the dropped element ("references a missing element").
  // orchestratedStages and customErrors both cost us exactly that. So: sweep whatever is left, treat any
  // array of named objects that carries a connector or a canvas coordinate as elements, draw them as
  // generic Action cards, and SAY SO. Resources (variables, choices, formulas, textTemplates) have
  // neither marker and are skipped.
  for (const [key, val] of Object.entries(md)) {
    if (HANDLED_KEYS.has(key) || !Array.isArray(val) || !val.length) continue;
    const looksLikeElements = val.every((e) => e && typeof e === 'object' && e.name)
      && val.some((e) => e.locationX != null || CONNECTOR_KEYS.some((k) => e[k] != null));
    if (!looksLikeElements) continue;
    warnings.push(`${val.length} "${key}" element(s) have no dedicated shape - drawn as generic Action cards`);
    for (const el of val) {
      if (!addNode(el.name, 'df.FlowAction', el.label || el.name, { actionType: key }, el)) continue;
      addEdge(el.name, null, el.connector);
      for (const c of el.connectors || []) addEdge(el.name, null, c, c.label || null);
      if (el.faultConnector) addEdge(el.name, null, el.faultConnector, 'Fault', 'fault');
    }
  }

  // ── Synthesised End cards (df.FlowEnd is UI-only - no metadata element) ──
  // Two cases: a declared branch that goes nowhere (decision outcome / wait event with a null connector),
  // and an element with no outgoing connector at all.
  let endN = 0;
  const newEnd = () => {
    const id = `__end_${++endN}`;
    addNode(id, 'df.FlowEnd', 'End', {}, null);
    return id;
  };

  // ORDER MATTERS. Drop the dead edges FIRST, then decide who still needs an End. Doing it the other way
  // round (as this did) computed "has an outgoing edge" from a set that still contained edges pointing at
  // deleted elements - so an element whose ONLY connector was dead looked satisfied, got no synthesised
  // End, and rendered as a dangling card with nothing leaving it.
  const live = new Set(cells.map((c) => c.id));
  const kept = edges.filter((e) => {
    if (!e.target && e.needsEnd) return true;                 // a declared dead branch - gets its End below
    if (live.has(e.source) && live.has(e.target)) return true;
    warnings.push(`connector ${e.source} -> ${e.target} references a missing element - dropped`);
    return false;
  });

  for (const e of kept) if (e.needsEnd && !e.target) { e.target = newEnd(); delete e.needsEnd; }
  const hasOut = new Set(kept.filter((e) => e.target).map((e) => e.source));
  for (const c of [...cells]) {
    if (c.type === 'df.FlowEnd' || hasOut.has(c.id)) continue;
    kept.push({ source: c.id, target: newEnd(), kind: 'regular', layoutKind: 'regular', label: null });
  }
  // Collections that ARE converted but have no dedicated `df.Flow*` shape yet, so they land on the generic
  // Action card. Announce every one of them: the card is drawn and the graph stays connected, but the
  // reader would otherwise have no way to tell a Custom Error from an Apex action. (The catch-all above
  // warns for collections this converter does not know at all; this warns for the ones it knows but
  // cannot draw faithfully.)
  const NO_SHAPE_YET = [
    ['orchestratedStages', 'Orchestrator stage', 'df.FlowStage'],
    ['customErrors', 'Custom Error element', 'df.FlowCustomError'],
    ['apexPluginCalls', 'Apex Plugin call', 'df.FlowApexPlugin'],
    ['steps', 'legacy Step element', 'df.FlowStep'],
  ];
  for (const [key, label, shape] of NO_SHAPE_YET) {
    const n = md[key]?.length;
    if (n) warnings.push(`${n} ${label}(s) drawn as generic Action cards - Diagramforce has no ${shape} shape`);
  }

  // ── Layout: real coordinates when the builder persisted them, else the app's tidy tree ──
  // "Some coordinates exist" is NOT the same as "the coordinates are usable". The old all-or-nothing test
  // meant one stray positioned element put the whole flow in coordinate mode, and every element without a
  // coordinate then piled up at (0,0) - a diagram that validates clean and is unreadable. Count instead,
  // and fall back to the tidy tree (which needs no coordinates at all) when the set is incomplete. The
  // synthesised Ends never have coordinates by construction, so they are excluded from the count, as is
  // Start, which is repositioned onto its successor's column below regardless.
  const realCells = cells.filter((c) => c.type !== 'df.FlowEnd' && c.id !== START_ID);
  const positioned = realCells.filter((c) => { const p = coords.get(c.id); return p && (p.x || p.y); });
  const anyCoords = positioned.length > 0;
  if (anyCoords && positioned.length < realCells.length) {
    const missing = realCells.length - positioned.length;
    warnings.push(`${missing} of ${realCells.length} elements have no canvas coordinates - laid out with the tidy tree instead of the metadata's partial set`);
  }
  const useCoords = anyCoords && positioned.length === realCells.length;
  let layoutMode;
  if (useCoords && !opts.forceLayout) {
    layoutMode = 'metadata coordinates';
    for (const c of cells) {
      const p = coords.get(c.id);
      if (p && (p.x || p.y)) { c.position = { x: p.x, y: p.y }; continue; }
      c.position = { x: 0, y: 0 };                    // synthesised End cards have none
    }
    // Flow Builder's Start node is NARROWER than a standard element, so its stored top-left sits a fixed
    // ~126px left of the spine (measured identical across every real flow). Diagramforce draws every card
    // at one width, so that offset shows up as Start hanging off to the side. Snap it onto its successor's
    // column instead of trusting the raw coordinate - self-correcting, and no magic constant to maintain.
    const startCell = cells.find((c) => c.id === START_ID);
    const firstHop = kept.find((e) => e.source === START_ID);
    const hopCell = firstHop && cells.find((c) => c.id === firstHop.target);
    if (startCell && hopCell) startCell.position = { x: hopCell.position.x, y: startCell.position.y };

    // Place each synthesised End under its source. The metadata gives Ends no coordinate, and a naive
    // "source + 160" lands on top of a real element whenever a sibling branch already occupies that slot
    // (a decision's dead-end outcome vs the element directly below it), so nudge right until the slot is free.
    const placed = cells.filter((c) => c.type !== 'df.FlowEnd');
    const collides = (x, y) => placed.some((c) => Math.abs(c.position.x - x) < W + 24 && Math.abs(c.position.y - y) < H + 24);
    for (const e of kept) {
      const tgt = cells.find((c) => c.id === e.target);
      const src = cells.find((c) => c.id === e.source);
      if (tgt?.type !== 'df.FlowEnd' || !src) continue;
      let x = src.position.x; const y = src.position.y + 160;
      while (collides(x, y)) x += W + 64;
      tgt.position = { x, y };
      placed.push(tgt);
    }
  } else {
    layoutMode = 'computed (tidy tree) - metadata had no coordinates';
    const pos = opts.computeFlowLayout({ nodes, edges: kept.map((e) => ({ source: e.source, target: e.target, kind: e.layoutKind || e.kind })) });
    for (const c of cells) { const p = pos.get(c.id); if (p) c.position = { x: Math.round(p.x), y: Math.round(p.y) }; }
  }

  // ── Links ──
  // Anchor EVERY connector to one of the four baked-in ports. Without a port JointJS anchors to the
  // element centre, so the orthogonal router has nothing to work against and lines cut diagonally
  // straight across the cards - which is exactly what the spec's "connect between the baked-in ports"
  // instruction exists to prevent.
  const elById = new Map(cells.filter((c) => c.type !== 'standard.Link').map((c) => [c.id, c]));
  const OPPOSITE = { 'port-top': 'port-bottom', 'port-bottom': 'port-top', 'port-left': 'port-right', 'port-right': 'port-left' };
  const endpoints = (e) => {
    const a = elById.get(e.source), b = elById.get(e.target);
    if (!a || !b) return ['port-bottom', 'port-top'];
    const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y;
    // Fault and Go To leave the SIDE of a card by convention, so they read as an aside rather than as
    // the main path down the spine - the same way Flow Builder draws them.
    if (e.kind === 'fault' || e.kind === 'goto') {
      const out = dx >= 0 ? 'port-right' : 'port-left';
      return [out, Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? 'port-top' : 'port-bottom') : OPPOSITE[out]];
    }
    // A flow reads top-to-bottom, so ANY step to a different row leaves the bottom and enters the top -
    // the orthogonal router draws the horizontal jog. Do NOT pick by dominant axis: a branch that moves
    // further sideways than down (a decision to a child in the next row, say dx 264 / dy 120) would then
    // exit the side and curl back on itself. Sides are only right when the two cards truly share a row.
    // A connector pointing UP is a RETURN path - overwhelmingly a loop's back-edge, where the body's last
    // element feeds the iteration back to the Loop card sitting above it. Routing that top-to-bottom drives
    // the line straight back up THROUGH the loop body it just came out of, which is what made loops
    // unreadable. Flow Builder wraps it around the side instead, so do the same: leave a side and re-enter
    // the SAME side, giving the U-turn that reads as "go round and repeat" rather than a crossing.
    // Left by default (matching Flow Builder); right only when the target genuinely sits to the right.
    if (dy < 0 && Math.abs(dy) >= H) {
      const side = dx > W / 2 ? 'port-right' : 'port-left';
      return [side, side];
    }
    if (Math.abs(dy) >= H) return ['port-bottom', 'port-top'];
    return dx >= 0 ? ['port-right', 'port-left'] : ['port-left', 'port-right'];
  };

  let li = 0;
  for (const e of kept) {
    const [sPort, tPort] = endpoints(e);
    const link = { id: `lnk_${++li}`, type: 'standard.Link', z: Z_LINK, source: { id: e.source, port: sPort }, target: { id: e.target, port: tPort } };
    if (e.kind === 'fault') link.attrs = { line: { stroke: FAULT_RED } };
    else if (e.kind === 'goto') link.attrs = { line: { stroke: GOTO_BLUE } };
    // Author NO label `position`. The app places an unpositioned flow label itself, and it can do it better than
    // we can from here: it knows the resolved route, so a branch label lands near its TARGET (each branch owns
    // that column) while a fault, a Go To, or a rank-skipping empty branch stays near the source. Computing a
    // distance here instead is what produced the two failure modes we shipped: at the link midpoint the siblings
    // drift apart down their own branches, and near the source they pile onto the shared first stub.
    // Go To: author ONLY the branch name. The loader renders a Go To label as blue italic and APPENDS the
    // "→" itself (stripping just a trailing one), so passing "No → Retry Screen" came out as
    // "No → Retry Screen →". Pass "No" and it renders "No →"; pass nothing and it seeds the destination.
    if (e.label) link.labels = [{ attrs: { text: { text: String(e.label) } } }];
    cells.push(link);
  }

  // ── Flow-level metadata card ─────────────────────────────────────────────────────────────────────────
  // Everything about the FLOW rather than any one element - status, API version, run mode, the resource
  // inventory - had nowhere to live: the Start card holds only what the Start element itself declares, so all
  // of this was simply dropped on import. It rides a `df.Table`, which is already in the generic shapes band
  // every diagram type carries, so this needs no new shape, no schema change and no spec grammar.
  //
  // Added LAST, deliberately. It is not a flow element: it must not reach the layout (which would rank it as
  // a node), the End synthesis (which gives every outgoing-link-less cell an End) or the port/link pass.
  const meta = [
    ['API Name', input?.FullName || md.fullName],
    ['Type', md.processType],
    // Provenance. An INSTALLED flow comes from a managed package - which is why every element here carries a
    // namespace prefix, and why the reader cannot edit it in their own org. That is a first-order fact about
    // a flow and it lives on the envelope, not in the element graph.
    ['Package', packageState(input?.ManageableState)],
    // A strict true, not truthiness: an XML-sourced envelope can carry the STRING "false", which is truthy.
    ['Template', (input?.IsTemplate === true || md.isTemplate === true) ? 'yes' : null],
    ['Status', [input?.Status || md.status, input?.VersionNumber != null ? `(v${input.VersionNumber})` : null].filter(Boolean).join(' ')],
    ['API Version', md.apiVersion != null ? `v${md.apiVersion}` : null],
    ['Run Mode', md.runInMode],
    ['Interview Label', md.interviewLabel],
    ['Description', md.description],
    // Date only - the time is noise on a card. Guarded: a blind slice of a non-ISO timestamp (a SOAP or
    // serialised source can hand back an epoch integer) would print 10 digits under a "Last modified" label,
    // which a reader takes as a date.
    ['Last modified', /^\d{4}-\d{2}-\d{2}/.test(String(input?.LastModifiedDate || ''))
      ? String(input.LastModifiedDate).slice(0, 10) : null],
    // The flow's SIGNATURE. For anything invoked from elsewhere - a subflow, an autolaunched flow, a
    // template like this one - the isInput/isOutput variables ARE the contract, and a bare count ("62
    // variables") teases that without answering it. Listed as name (Type), collections marked [], because
    // passing a collection where a scalar is expected is the usual integration mistake. Only the interface,
    // never all 62: the rest are internal working storage and would bury the card.
    ['Inputs', varSignature(md.variables, 'isInput')],
    ['Outputs', varSignature(md.variables, 'isOutput')],
    ['Resources', ['variables', 'constants', 'formulas', 'textTemplates', 'choices', 'dynamicChoiceSets']
      .map((k) => (Array.isArray(md[k]) && md[k].length ? `${md[k].length} ${k}` : null)).filter(Boolean).join(', ')],
  ].filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => [k, String(v).replace(/\s+/g, ' ').trim()]);

  if (meta.length) {
    const startCell = cells.find((c) => c.id === START_ID);
    const TABLE_W = 330, ROW_H = 28, LINE_H = 19, LABEL_H = 26, GAP = 90;
    // The view re-measures and GROWS DOWNWARD from position.y, so an under-estimate here lands the card on top
    // of Start - which is exactly what a flat rows*ROW_H estimate did: df.Table wraps long cell text, and a
    // real flow Description is several lines on its own. Estimate per row from the wrapped line count. The
    // value column is ~60% of TABLE_W at 13px, so ~30 characters per line.
    const VALUE_COLS = 30;
    const estH = LABEL_H + meta.reduce((h, [, v]) => {
      const lines = Math.max(1, Math.ceil(String(v).length / VALUE_COLS));
      return h + Math.max(ROW_H, lines * LINE_H + 9);
    }, 0);
    cells.push({
      id: '__flowmeta',
      type: 'df.Table',
      position: {
        x: (startCell?.position.x ?? 0) + (W - TABLE_W) / 2,   // centred on the Start column
        y: (startCell?.position.y ?? 0) - estH - GAP,
      },
      size: { width: TABLE_W, height: estH },
      z: 2300,
      tableLabel: title,
      rows: meta,
      highlightFirstRow: false,   // a key/value card: the LEFT column is the header, not the top row
      highlightFirstCol: true,
    });
  }

  const diagram = {
    version: 1,
    appVersion: opts.appVersion || '1',
    title,
    diagramType: 'flow',
    graph: { cells },
  };
  const stats = {
    elements: cells.filter((c) => c.type !== 'standard.Link').length,
    links: li,
    goto: kept.filter((e) => e.kind === 'goto').length,
    fault: kept.filter((e) => e.kind === 'fault').length,
    ends: endN,
    layoutMode,
    warnings,
  };
  return { diagram, stats };
}


/**
 * Convert Salesforce Flow metadata into a Diagramforce `flow` diagram.
 * @param {object} input - the Tooling API response, or just its `Metadata` object.
 * @param {object} opts
 * @param {(g:{nodes:Array,edges:Array}) => Map} opts.computeFlowLayout - the app's tidy-tree layout.
 * @param {string} [opts.appVersion] - stamped into the envelope.
 * @param {boolean} [opts.forceLayout] - ignore metadata coordinates and always compute.
 * @returns {{diagram: object, stats: object}}
 */
export function convertFlowMetadata(input, opts = {}) {
  return convert(input, opts);
}

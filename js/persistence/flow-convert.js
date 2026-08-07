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
// These two are NOT free colour choices, and the both-themes palette rule does not reach them: a flow connector
// stores no type prop, so `flowConnectorType()` in js/canvas/link-styles.js derives the type FROM THE STROKE -
// red is Fault, this exact blue is Go To, anything else is Standard. The value is a protocol token the renderer
// parses, so changing it here alone would not recolour a Go To, it would stop the app recognising one: no dotted
// line, no blue italic destination label, and then repainted standard grey on load.
//
// FAULT_RED is fine anyway - Salesforce's brand red scores 4.45 light / 3.74 dark, clearing both floors.
// GOTO_BLUE does NOT: 6.42 light but 2.60 on the dark canvas, under the 3:1 floor. Left as-is deliberately.
// Fixing it is a coordinated change - link-styles.js FLOW_GOTO_COLOR (accepting the old hex too, or every
// already-saved flow loses its Go To identity), this constant, DIAGRAM_JSON_SPEC.md, and the two e2e specs that
// author the hex - and it is tracked in Documentation/backlog/backlog.md rather than half-done here.
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
  // The cap counts only the rows the panel SHOWS. A `quiet` row - an explicitly-false flag - renders inside a
  // collapsed disclosure, so letting it consume the budget would push a real row behind "+N more" to make room
  // for something nobody is looking at.
  const quiet = out.filter((r) => r.quiet);
  const loud = out.filter((r) => !r.quiet);
  if (loud.length <= DETAIL_CAP) return loud.concat(quiet);
  const extra = loud.length - DETAIL_CAP;
  return loud.slice(0, DETAIL_CAP).concat([{ label: `+${extra} more`, value: 'not shown' }], quiet);
}
// Tolerate a NON-ARRAY. XML has no arrays, so a repeated child that appears exactly once arrives as a bare
// object unless flow-import.js's schema hint lists it - and a missing hint used to crash the whole import
// (for..of over an object throws), turning one absent key into a total failure on an ordinary flow.
// Degrading to a single item keeps a schema-hint gap lossy instead of fatal.
//
// SCALARS count too. The original form kept `typeof v === 'object'`, which silently swallowed a repeated
// scalar child: a screen field with exactly one `<choiceReferences>Month</choiceReferences>` arrived as the
// string "Month", asList returned [], and the row's whole `choices: …` clause disappeared - 50 fields across
// 24 of 339 real org flows. The schema hint has been corrected for the keys we know about, but that list can
// only ever lag what Salesforce adds next, and this converter's own rule is to never assume a fixed shape.
// So the fallback is the general one. A scalar landing where a list of OBJECTS was expected is still dropped
// downstream (`rows()` needs a `label`), exactly as it was before - this only stops the loss being silent
// where the item legitimately IS a scalar.
const asList = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));
function rows(list, toRow) {
  const out = [];
  const items = asList(list);
  for (const item of items) {
    const r = toRow(item);
    if (r && r.label) out.push({ label: String(r.label), value: r.value == null ? '' : String(r.value) });
  }
  return capRows(out);
}
// Setting a field to NOTHING is a real instruction, not a gap. Two metadata shapes say it - no `<value>` child
// at all, and an explicit `<value><stringValue></stringValue></value>` - and both rendered as a blank cell,
// which reads as the converter having failed to parse something. 14 rows across a 339-flow corpus did exactly
// that, in flows whose whole purpose is to clear a field (one is named `Set_arrival_windows_in_1969_to_Null`).
//
// The third case is deliberately NOT called the same thing: a `value` that IS present but yields nothing from
// pickValue means we could not READ it, which is not the same as knowing it is empty. This file's own rule is
// that a missing row invites a question while a wrong row ends it, so an unreadable value says so.
const assignedValue = (a) => {
  if (a.value == null) return '(no value)';
  const v = pickValue(a.value);
  if (v === '') return '(no value)';
  return v == null ? '(value not shown)' : v;
};
/** Field assignments an element WRITES - the single most useful fact a Create/Update card was missing. */
const assignmentRows = (el) => rows(el.inputAssignments, (a) => ({ label: a.field, value: assignedValue(a) }));
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
/** Prose out of a rich-text field. Distinct from `plainText`, which REJECTS markup: a screen field's label has
 *  a fallback (the field name) so refusing a formatted one is safe, but a choice's text has none - dropping it
 *  loses the only description of that option. Rich text is authored in the Flow Builder editor, so it arrives
 *  as `<p>`-wrapped runs with inline styles; without this the reader gets the style attributes and the
 *  character cap spends itself on markup instead of the sentence. */
const strippedText = (t) => String(t || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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
// A screen field can CONTAIN fields: `regionContainerType` Section / Column nest their real inputs one or two
// levels down. Walking only the top level documented the layout scaffolding ("Section1, Column1") and hid every
// input the screen actually asks for - and modern screens are sectioned by default, so that is the common case.
//
// Recurse on the PRESENCE of `f.fields`, never on the enum: `regionContainerType` appears nowhere in this repo
// outside a backlog note - no fixture, no test - and this file's own rule (see the header) is that the key set
// grows with API version, so never assume a fixed shape.
//
// The walker must NOT call rows(): rows() applies capRows itself, so per-level calls would cap per level and
// reproduce the mid-table "+N more" that actionParamRows was fixed for. It appends to ONE flat array which
// screenRows caps ONCE at the end.
const SCREEN_DEPTH_CAP = 6;   // Section > Column > field is 2 - this only guards a malformed tree
function screenFieldRows(list, out, prefix, depth = 0, choiceIdx = null) {
  if (depth > SCREEN_DEPTH_CAP) return out;
  for (const f of asList(list)) {
    const label = screenFieldLabel(f);
    const kids = asList(f.fields);
    const shown = summarizeConditions(f.visibilityRule?.conditions, f.visibilityRule?.conditionLogic);
    // A container is scaffolding, so its children REPLACE it - unless it says something they do not. A section
    // gated on a variable is real in-screen branching that never appears as a connector (the same argument that
    // put `shown when` on component rows), and a childless container is only evidenced by its own row.
    if (label && (!kids.length || shown)) {
      out.push({
        label: prefix ? `${prefix} / ${label}` : label,
        // The API NAME rides along whenever it differs from the label. Labels are not unique the way names are
        // - two components can legitimately share one - and the name is what every other element references,
        // so dropping it would make a row impossible to trace back.
        value: [
          f.extensionName || f.fieldType || '',
          label !== f.name ? f.name : null,
          // A dropdown documented as merely EXISTING is the "choices are a count, not a source" defect at the
          // exact place the reader is looking. Name the choice sets it draws from.
          asList(f.choiceReferences).length ? `choices: ${describeChoices(f.choiceReferences, choiceIdx)}` : null,
          f.isRequired === true || f.isRequired === 'true' ? 'required' : null,
          // What the field is PRE-FILLED with, what it TELLS the user, and what it REJECTS - all documentation,
          // all previously dropped. The validation MESSAGE over the formula: the message is what a person sees,
          // the formula is developer detail, and only one belongs in a 58%-wide column. Formula only when there
          // is no message, so a rule is never invisible.
          pickValue(f.defaultValue) ? `default ${pickValue(f.defaultValue)}` : null,
          plainText(f.helpText) ? `help: ${plainText(f.helpText)}` : null,
          f.validationRule?.errorMessage ? `rejects with "${plainText(f.validationRule.errorMessage) || ''}"`
            : (f.validationRule?.formulaExpression ? `validated: ${f.validationRule.formulaExpression}` : null),
          shown && `shown when ${shown}`,
        ].filter(Boolean).join(' \u00b7 '),
      });
    }
    // PREFIX, not indent: the panel renders this label through escHtml into a plain <th> with no `white-space`
    // rule, so leading spaces collapse and an indent is invisible unless U+00A0 is smuggled into the saved JSON
    // and the share URL - presentation inside data. Only a USER-NAMED container earns one; `label !== f.name` is
    // the same test the value column already uses, so Flow Builder's auto-generated Section1 / Column1 stay
    // transparent instead of spending a line of a 42%-wide column on themselves.
    if (kids.length) {
      const named = label && label !== f.name ? label : null;
      screenFieldRows(kids, out, [prefix, named].filter(Boolean).join(' / '), depth + 1, choiceIdx);
    }
  }
  return out;
}
const screenRows = (el, choiceIdx) => capRows(screenFieldRows(el.fields, [], '', 0, choiceIdx));
/** Leaves only, in order - what the screen actually asks, with the containers dropped. */
function flattenScreenFields(list, out = [], depth = 0) {
  if (depth > SCREEN_DEPTH_CAP) return out;
  for (const f of asList(list)) {
    const kids = asList(f.fields);
    if (kids.length) flattenScreenFields(kids, out, depth + 1);
    else out.push(f);
  }
  return out;
}
/** Orchestrator / approval stage steps: what each step is, and who it falls to. For an approval flow this IS
 *  the content - a stage named "Legal Review" says nothing without the assignee and the step kind. */
const STEP_KIND = { stepApproval: 'approval', stepBackground: 'background', stepInteractive: 'interactive' };
const stageStepRows = (el) => rows(el.stageSteps, (st) => ({
  label: st.label || st.name,
  value: [
    STEP_KIND[st.actionType] || st.actionType || '',
    (st.label || st.name) !== st.name ? st.name : null,
    // assigneeType is User / Group; the reference is the actual user or group. Several assignees are legal.
    asList(st.assignees).map((a) => a.assignee?.stringValue || a.assignee?.elementReference || a.assigneeType)
      .filter(Boolean).join(', ') || null,
  ].filter(Boolean).join(' \u00b7 '),
}));

// \u2500\u2500 Stage step EXPANSION (opts.expandStages) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// OFF BY DEFAULT, and that is a contract rather than a preference: this changes a converted orchestration's cell
// count, its ids and its whole layout, and orchestrations have been importable since 1.21.2. Every existing
// import must keep producing exactly what it produced yesterday, so the expansion is reached only by an explicit
// opt-in (`--expand-stages` on the CLI).
//
// What it buys: the rows above are the ONLY place a step's approver currently lives, and they live in a panel
// nobody opens while reading a diagram. On the canvas the stage is one card reading "Legal Review / Stage" - it
// names the queue and answers none of the questions an approval audit actually asks (who signs, is the record
// locked, what gates the next step). Expanded, the stage becomes a BAND: the stage card, then one card per step.
//
// Steps reuse EXISTING shapes rather than getting a df.FlowStageStep of their own. That is not a shortcut - an
// approval step IS an action call (Salesforce's own standard_approvals__EvaluateApproval), a background step
// invokes a flow, and an interactive step puts a screen in front of a person - so the card a reader already
// knows how to read is the correct card.
const STEP_SHAPE = {
  stepApproval: 'df.FlowAction',
  stepBackground: 'df.FlowSubflow',
  // UNTESTED against real metadata: the flow this was built from has no interactive step, and neither does any
  // flow in the 339-flow corpus. Mapped anyway because the shape is unarguable and drawing it as a generic
  // Action would be a worse guess - but the card stays conservative (`components` is left UNSET, since an
  // interactive step names an action, not a field list, so any value would be invented) and the run warns.
  stepInteractive: 'df.FlowScreen',
};
/** `Legal_Reviewers` -> `Legal Reviewers`. A public group is STORED by API name and RECOGNISED by its label. */
const humanName = (s) => String(s || '').replace(/_/g, ' ').trim();
const ASSIGNEE_KIND = { Group: 'Public group', User: 'User', Queue: 'Queue' };
/** WHO the step falls to, and whether that is a fixed group or a per-record user - the first question an
 *  approval audit asks, and the one difference `stageStepRows` above flattens away. An elementReference is
 *  resolved AT RUNTIME ({!Get_Record_Data.Outputs.coachUsername} is a different person on every record), so it
 *  prints as the reference rather than being dressed up as a name we do not have. */
function assigneeText(a) {
  const kind = ASSIGNEE_KIND[a?.assigneeType] || a?.assigneeType || 'Assignee';
  const ref = a?.assignee?.elementReference;
  if (ref) return `${kind} {!${ref}}`;
  const raw = pickValue(a?.assignee);
  if (!raw) return kind;
  // Both forms, label first: the row reads as English and still greps against the org's metadata.
  const human = humanName(raw);
  return human !== raw ? `${kind} ${human} (${raw})` : `${kind} ${raw}`;
}
// `standard_approvals__EvaluateApproval` is Salesforce's OWN approval action with a fixed three-parameter
// contract, so its `ActionInput__` prefix is plumbing and the names can be read out in English. Any OTHER
// action keeps its raw parameter name: that is the author's own identifier and the only trace from the card
// back to the metadata, which is worth more than the two words renaming it would save.
const APPROVAL_INPUT = {
  ActionInput__RecordId: 'Record',
  ActionInput__CustomEmailSubject: 'Email subject',
  ActionInput__CustomEmailBody: 'Email body',
};
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Which fields the rest of the flow reads off a step's output. A background step exists to PRODUCE something,
 *  and nothing on its card said what: `outputParameters` is empty on every real step measured, because an
 *  orchestration step stores its result on itself and the flow reaches it as `{!<step>.Outputs.<field>}`. So
 *  the answer is not in the step at all - it is in the references elsewhere in the flow, which is what this
 *  scans for. First-seen order; the field name is what the reader greps. */
function stepOutputsRead(stepName, serialized) {
  if (!stepName) return null;
  const seen = [];
  const re = new RegExp(escapeRe(stepName) + '\\.Outputs\\.([A-Za-z0-9_]+)', 'g');
  for (const m of String(serialized).matchAll(re)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen.length ? seen.join(', ') : null;
}
/** A step's panel rows: the audit questions first - what kind of step, who it falls to, whether the record is
 *  locked while it waits, what has to be true before it starts - then the action's own parameters. */
function stepRows(st, ctx) {
  const out = [];
  const type = String(st.actionType || '');
  const kind = STEP_KIND[type] || type || 'unknown';
  out.push({ label: 'Step type', value: `${kind.charAt(0).toUpperCase()}${kind.slice(1)} step${type ? ` (${type})` : ''}` });

  const who = asList(st.assignees).map(assigneeText).filter(Boolean);
  if (who.length) out.push({ label: type === 'stepApproval' ? 'Approver' : 'Assigned to', value: who.join(', ') });
  // A background step runs unattended BY DEFINITION, so saying so is an answer. A HUMAN step with no assignee
  // is a finding about the flow - somebody has to act on it and the metadata names nobody - so the two must
  // not read the same way.
  else out.push({ label: 'Assigned to', value: type === 'stepBackground' ? 'Nobody - runs unattended' : 'nobody named in the metadata' });

  // Record locking is an approval concept (Salesforce locks the record while the approval is pending) and "No"
  // is as much of an answer as "Yes" when the question is whether the record could change under the approver -
  // so an approval step always states it, and any other kind only when locking is actually on.
  const locks = st.shouldLock === true || st.shouldLock === 'true';
  if (type === 'stepApproval' || locks) out.push({ label: 'Record locked while pending', value: locks ? 'Yes' : 'No' });

  // ORCHESTRATOR SEMANTICS, stated exactly. A step with no entry conditions starts when the STAGE does, not
  // when the card above it finishes. The band draws steps in document order because that is the order the
  // metadata declares them and a reader needs a reading order - but that chain is not a dependency unless an
  // entry condition makes it one, so an ungated LATER step must not inherit the first step's (accurate)
  // "as soon as the stage opens" and quietly turn a reading order into a claim about sequencing.
  const entry = summarizeConditions(st.entryConditions, st.entryConditionLogic);
  out.push({ label: 'Entry conditions', value: entry || (ctx.first
    ? 'None - runs as soon as the stage opens'
    : 'None - starts with the stage, not gated on the step above') });
  const exit = summarizeConditions(st.exitConditions, st.exitConditionLogic);
  if (exit) out.push({ label: 'Exit conditions', value: exit });
  if (st.entryActionName) out.push({ label: 'Entry action', value: String(st.entryActionName) });
  if (st.exitActionName) out.push({ label: 'Exit action', value: String(st.exitActionName) });
  // df.FlowScreen has no card field an action name fits into, so without this row an interactive step would
  // draw as a card that never says what it runs.
  if (type === 'stepInteractive' && st.actionName) out.push({ label: 'Screen action', value: String(st.actionName) });

  for (const p of asList(st.inputParameters)) {
    if (!p?.name) continue;
    const label = APPROVAL_INPUT[p.name] || `Input ${p.name}`;
    // Same rule as actionParamRows: an explicitly-false flag IS an answer and rides the collapsed disclosure,
    // while a parameter Salesforce emitted but nobody set says nothing and is dropped.
    const falseFlag = p.value?.booleanValue != null && String(p.value.booleanValue).trim() === 'false';
    const v = pickValue(p.value);
    if (falseFlag) out.push({ label, value: 'false', quiet: true });
    else if (v != null && String(v).trim() !== '') out.push({ label, value: String(v) });
  }
  for (const o of asList(st.outputParameters)) {
    if (o?.name && o.assignToReference) out.push({ label: o.name, value: `-> {!${o.assignToReference}}` });
  }
  if (ctx.outputsRead) out.push({ label: 'Outputs read downstream', value: ctx.outputsRead });
  // The two flags that decide what an approver may DO. Both are false on every step measured, and both are
  // still worth stating - "the approver cannot edit the record" is exactly what somebody auditing an approval
  // wants confirmed - so they ride the collapsed disclosure. Human steps only: neither means anything on a
  // step with no assignee.
  if (type !== 'stepBackground') {
    const yn = (v) => (v === true || v === 'true' ? 'Yes' : 'No');
    out.push({ label: 'Approver can edit the record', value: yn(st.canAssigneeEdit), quiet: st.canAssigneeEdit !== true });
    out.push({ label: 'Runs as the assignee', value: yn(st.runAsUser), quiet: st.runAsUser !== true });
  }
  return capRows(out);
}
/** "1 approval step, then 1 background step" - what the stage card owes the reader once every step has a card
 *  of its own and the per-step rows would only say it twice. Consecutive steps of one kind collapse to a count. */
function stageStepSummary(steps) {
  const runs = [];
  for (const st of steps) {
    const kind = STEP_KIND[st.actionType] || st.actionType || 'step';
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.n++;
    else runs.push({ kind, n: 1 });
  }
  return runs.map((r) => `${r.n} ${r.kind} step${r.n === 1 ? '' : 's'}`).join(', then ') || null;
}
/** The one fact about a stage that no step card can carry. */
const stageExitText = (el) => summarizeConditions(el.exitConditions, el.exitConditionLogic)
  || 'None - the stage ends when its steps complete';
/** An entry condition as a CONNECTOR label. The full condition stays on the card; the label drops the qualifier
 *  when it names the step the connector is LEAVING, because the connector already says that - the difference
 *  between "approvalDecision = Approve" and a 64-character reference nobody reads at link size. */
function stepEdgeLabel(text, prevStepName) {
  if (!text) return null;
  let v = String(text);
  if (prevStepName) v = v.split(`${prevStepName}.Outputs.`).join('').split(`${prevStepName}.`).join('');
  return capText(v, 60);
}
// The stage BAND: dashed, and behind everything on the Zone tier (z 0), so it reads as a region rather than as
// another card. `#1D73C9` and NOT the df.FlowStage chip's own navy `#032D60`: a band outline has to survive both
// canvas themes and that navy scores 1.33:1 on the dark one. This is `blue` from js/persistence/diagram-palette.js
// (4.63 light / 3.60 dark), restated rather than imported because this file is import-free by contract - see the
// header. BAND_FILL is the same colour at 5%.
const BAND_BLUE = '#1D73C9';
const BAND_FILL = 'rgba(29, 115, 201, 0.05)';
// Asymmetric on purpose: the band's own label sits inside the top edge, so the top needs room for it.
const BAND_PAD_X = 24, BAND_PAD_TOP = 34, BAND_PAD_BOTTOM = 24;

/** How a data element gets its records IN. `inputAssignments` is field-by-field; `inputReference` is a whole
 *  collection - the standard bulk pattern inside a loop, and the one that rendered a completely EMPTY card. */
const inputRows = (el) => {
  const assigned = assignmentRows(el);
  if (assigned.length) return assigned;
  return el.inputReference ? [{ label: 'Records from', value: `{!${el.inputReference}}` }] : [];
};
// What a Create matches on when it is really an UPSERT. Salesforce spells `operationMultMatchingRecords` as an
// enum; phrase it, because "UpdateFirstRecord" in a documentation table is a puzzle rather than an answer.
// Unknown values pass through raw - Salesforce can add one, and the raw value beats a silent drop.
const MULT_MATCH = {
  UpdateFirstRecord: 'update the first match only',
  UpdateLatestRecord: 'update the most recent match only',   // the value every upsert in the sample org used
  UpdateAllRecords: 'update every match',
  ThrowError: 'fail with an error',
};
const createRows = (el) => {
  const rows = inputRows(el);
  const match = summarizeFilters(el.filters, el.filterLogic);
  // Prepend: "this is an upsert" reframes every assignment row below it, so it has to be read first. Guarded
  // against the 20-row cap already applied by inputRows - capRows would otherwise be able to drop it.
  const head = [];
  if (match) head.push({ label: 'Matches existing on', value: match });
  if (el.operationMultMatchingRecords) {
    head.push({ label: 'If several match', value: MULT_MATCH[el.operationMultMatchingRecords] || String(el.operationMultMatchingRecords) });
  }
  return head.length ? head.concat(rows) : rows;
};
/** How a Get Records hands results OUT. Three shapes, and only one was documented: `outputAssignments`
 *  (field -> variable), `outputReference` (whole result into one variable), and `storeOutputAutomatically`
 *  (referenced as {!Element.field}). On modern flows the latter two are the common ones. */
const getOutputRows = (el) => {
  const rows = [];
  // ONLY when it deviates from the default. `getFirstRecordOnly: false` is the norm, so a "Returns: all
  // matching records" row on every Get card states the assumption the reader already holds - noise that
  // pushes real content toward the 20-row cap. Flow Builder likewise surfaces only the toggle.
  if (el.getFirstRecordOnly === true || el.getFirstRecordOnly === 'true') {
    rows.push({ label: 'Returns', value: 'the first matching record only' });
  }
  if (el.queriedFields?.length) rows.push({ label: 'Fields read', value: asList(el.queriedFields).join(', ') });
  if (el.sortField) rows.push({ label: 'Sorted by', value: `${el.sortField}${el.sortOrder ? ` ${SORT_ORDER[el.sortOrder] || el.sortOrder}` : ''}` });
  const assigned = outputRows(el);
  if (assigned.length) return rows.concat(assigned);
  if (el.outputReference) rows.push({ label: 'Stored in', value: `{!${el.outputReference}}` });
  else if (el.storeOutputAutomatically) rows.push({ label: 'Stored', value: `on the element (referenced as {!${el.name}.<field>})` });
  return rows;
};
/** A subflow's parameter list is the only thing that makes it comprehensible - by definition its internals are
 *  not on this canvas. */
const subflowRows = (el) => {
  const rows = rows2(el.inputAssignments, (a) => ({ label: a.name, value: `= ${pickValue(a.value)}` }));
  for (const o of asList(el.outputAssignments)) {
    if (o.name) rows.push({ label: o.name, value: `-> {!${o.assignToReference}}` });
  }
  if (!asList(el.outputAssignments).length && el.storeOutputAutomatically) {
    rows.push({ label: 'Outputs', value: `stored on the element (referenced as {!${el.name}.<output>})` });
  }
  return capRows(rows);
};
/** rows() caps internally, which is wrong when a caller concatenates several sources - use this and cap once. */
function rows2(list, toRow) {
  const out = [];
  for (const item of asList(list)) {
    const r = toRow(item);
    if (r && r.label) out.push({ label: String(r.label), value: r.value == null ? '' : String(r.value) });
  }
  return out;
}
const SORT_ORDER = { Asc: 'ascending', Desc: 'descending' };
// Flow Builder spells these out; the raw enum reads as jargon and, for RecordField, as a field name.
const TIME_SOURCE = { RecordTriggerEvent: 'the trigger', RecordField: 'a record field' };
/** Collection Sort / Filter / Map. A Sort card that never says WHICH field it sorts by is decorative. */
const collectionRows = (el) => {
  const rows = [];
  if (el.collectionReference) rows.push({ label: 'Collection', value: `{!${el.collectionReference}}` });
  for (const o of asList(el.sortOptions)) {
    rows.push({ label: 'Sort by', value: [o.sortField, SORT_ORDER[o.sortOrder] || o.sortOrder].filter(Boolean).join(' ') });
  }
  const cond = summarizeConditions(el.conditions, el.conditionLogic);
  if (cond) rows.push({ label: 'Keep when', value: cond });
  for (const m of asList(el.mapItems)) {
    rows.push({ label: m.assignToFieldReference || 'Maps', value: `${m.operator === 'Assign' || !m.operator ? '=' : m.operator} ${pickValue(m.value)}` });
  }
  if (el.formula) rows.push({ label: 'Formula', value: el.formula });
  if (el.limit != null) rows.push({ label: 'Limit', value: String(el.limit) });
  return capRows(rows);
};
/** What a Transform actually writes, field by field. */
const transformRows = (el) => {
  const rows = [];
  for (const tv of asList(el.transformValues)) {
    for (const a of asList(tv.transformValueActions)) {
      const target = a.outputFieldApiName || a.transformType || '';
      if (target) rows.push({ label: target, value: `${a.transformType && a.outputFieldApiName ? a.transformType + ' ' : ''}${pickValue(a.value) || ''}`.trim() });
    }
  }
  return capRows(rows);
};

/** name -> a one-line description of what a choice reference actually offers. Built once per flow, because a
 *  dynamicChoiceSet is a RESOURCE with no card of its own: without this the reader sees that a dropdown exists,
 *  sees the reference name, and can never find out what is in it. */
function buildChoiceIndex(md) {
  const idx = new Map();
  for (const c of asList(md.choices)) if (c.name) idx.set(c.name, c.label || pickValue(c.value) || null);
  for (const d of asList(md.dynamicChoiceSets)) {
    if (!d.name) continue;
    const where = summarizeFilters(d.filters, d.filterLogic);
    // TWO shapes, and only the record-backed one was handled. A PICKLIST-backed set draws its options from a
    // field's picklist values (`picklistObject` + `picklistField`) and carries NO `object`/`displayField` - so
    // every clause below evaluated empty, the entry resolved to null, and describeChoices fell back to the bare
    // reference name: the reader saw a dropdown exists and could never find out what fills it. That is 37 of the
    // 61 dynamic choice sets in a real org, i.e. the MAJORITY shape.
    // NB the nil fields arrive as EMPTY STRINGS, not undefined (`<object xsi:nil="true"/>` -> ''), so this has
    // to test truthiness rather than presence.
    const source = d.picklistObject && d.picklistField
      ? `${d.picklistObject}.${d.picklistField} picklist`
      : (d.object && d.displayField ? `${d.object}.${d.displayField}` : (d.object || d.displayField || null));
    idx.set(d.name, [
      source,
      where && `where ${where}`,
      d.sortField && `by ${d.sortField}${d.sortOrder ? ` ${SORT_ORDER[d.sortOrder] || d.sortOrder}` : ''}`,
      d.limit != null && `top ${d.limit}`,
    ].filter(Boolean).join(', ') || null);
  }
  return idx;
}
/** "dcs_Reasons (Case.Subject, where ...)" - keeps the reference AND names the source. */
const describeChoices = (refs, idx) => asList(refs)
  .map((r) => { const d = idx?.get(r); return d ? `${r} (${d})` : r; })
  .join(', ');

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
    // ...and a FALSE flag is dropped for the same reason an unset parameter is. Salesforce writes every boolean
    // whether or not it was touched, and `false` IS the default, so its absence says exactly what its presence
    // would. Measured on a real Send Email Message action: 3 of its 10 rows were `false` - 30% of the card
    // asserting nothing, crowding the 4 rows that meant something (real-use feedback 2026-07-27: "czy generuje
    // wiecej szumu informacyjnego"). Keyed on `booleanValue` specifically, so a stringValue that happens to read
    // "false" is left alone - that one WAS authored.
    const falseFlag = p.value?.booleanValue != null && String(p.value.booleanValue).trim() === 'false';
    // A false flag is KEPT, marked `quiet`, and rendered in a collapsed disclosure. It used to be dropped
    // outright on the grounds that Salesforce writes every boolean whether or not it was touched - but the
    // owner, looking at a real Send Email card, made the case that "off" IS an answer: `isTemplate: false`
    // says this is not a template, and a reader cannot get that from an absence.
    //
    // Only explicitly-false BOOLEANS. An UNSET parameter stays dropped, because it genuinely says nothing -
    // Salesforce writes the whole parameter list, so an untouched `replyToName` is noise, not information.
    // Measured across 60 real flows / 96 action cards: keeping the false flags is +5% of detail rows (12 of
    // 262), where unset parameters would be a further +8%.
    if (p.name && falseFlag) out.push({ label: p.name, value: 'false', quiet: true });
    else if (p.name && v != null && String(v).trim() !== '') out.push({ label: p.name, value: String(v) });
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
/** The wait mechanisms Flow Builder names in plain language; anything unmapped prints its own API name. */
const WAIT_EVENT_TYPE = {
  AlarmEvent: 'absolute time alarm',
  DateRefAlarmEvent: 'alarm relative to a record date',
};
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
/** `trgrOnEmailResponseEngagement` -> "Email Response Engagement". Salesforce names a marketing wait's trigger
 *  with a `trgrOn` prefix and camelCase, which is precise and unreadable; the prefix carries no information the
 *  row's own position does not, so it goes. */
const automationEventText = (raw) => String(raw || '')
  .replace(/^trgrOn/i, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/_+/g, ' ')
  .trim();

/** A wait's branches with what each one waits FOR - the duration the branch label no longer carries. */
const waitRows = (el) => rows(el.waitEvents, (ev) => ({
  label: waitEventLabel(ev, el.name) || ev.name,
  // WHAT it waits for, not just how long. An event branch has no offset and often no conditions either -
  // the thing it waits on lives in inputParameters (and recordTriggerType for a record event) - so those
  // branches rendered as a label beside an empty cell: "the flow waits" without saying for what.
  value: [
    ev.offset != null && ev.offsetUnit ? `after ${ev.offset} ${ev.offsetUnit}` : null,
    // The AWAITED EVENT leads the row (after a duration, which reads as the headline on a timed branch),
    // because it is the answer to "what is this step waiting for". A marketing wait carries it as
    // `automationEventType` (`trgrOnEmailResponseEngagement`) and nothing else on the branch says it: the row
    // read "on record Create · associatedContent {!email_3…}", which describes the MECHANISM without ever
    // naming the event. Reported: "without the step label I wouldn't know what the awaited event is" - and a
    // step label is the one part of a flow a human is free to write badly.
    ev.automationEventType ? automationEventText(ev.automationEventType) : null,
    // The MECHANISM, only when nothing else reveals it. Beside "after 2 Days" the eventType is noise; beside a
    // NAMED event it is noise twice over - so it renders only on a branch with no offset and no named event
    // (a plain platform-event or date-referenced branch, where it is the single thing that says how the flow
    // resumes). Before this gate the enum printed AHEAD of the named event, contradicting the ordering this
    // comment promises - caught in release review.
    ev.offset == null && !ev.automationEventType && ev.eventType
      ? `${WAIT_EVENT_TYPE[ev.eventType] || ev.eventType}` : null,
    // WHICH object a record-change branch watches. `recordTriggerType` below says Create/Update; without the
    // object that is "waits for a record to be created" with the record left unnamed.
    ev.object ? `on ${ev.object}` : null,
    ev.recordTriggerType ? `on record ${ev.recordTriggerType}` : null,
    // WHEN a date-based branch resumes. `resumeDateReference` is the common shape - a field or variable the
    // flow waits on - and without it such a branch renders as its mechanism alone ("Alarm Event"), which is
    // the same gap `automationEventType` closed for the marketing wait.
    ev.resumeDateReference ? `resumes at {!${ev.resumeDateReference}}` : null,
    ev.resumeDate ? `resumes ${ev.resumeDate}${ev.resumeTime ? ` ${ev.resumeTime}` : ''}` : null,
    ...(ev.inputParameters || []).map((p) => {
      const v = pickValue(p.value);
      return v == null || String(v).trim() === '' ? null : `${p.name} ${v}`;
    }),
    summarizeConditions(ev.conditions, ev.conditionLogic),
    // Where the event's result LANDS. A platform-event or alarm branch that stores its payload was documented
    // as a branch that simply happens - the reader could not tell what became available afterwards.
    ...asList(ev.outputParameters).map((o) => (o.name ? `${o.name} -> {!${o.assignToReference}}` : null)),
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

// One side of a flow's public interface, as "name (Type)" with collections marked. The interface IS the
// contract, so it is listed IN FULL up to a per-item cap - a flow with 30 inputs has a design problem, and a
// card is not the place to discover it, but 10 real inputs deserve their 10 names (the owner's call on the
// measured Bulk Asset Copy flow: "+6 more" on a summary card answers nothing). There USED to be a second cap
// by rendered length (150 chars, "~5 wrapped lines at ~30 chars per line") - a fossil calibrated to the
// 330px-era table. The table is 500px now, the height estimator scales to any value length per row, and the
// load pass re-seats the Resources card below from the MEASURED card height, so a long row cannot collide
// with anything. A char budget also recreates the same complaint on the next flow with longer names; the
// item cap bounds true pathology and accounts for itself via "+N more".
const SIGNATURE_CAP = 12;
function varSignature(variables, flag) {
  const picked = (variables || []).filter((v) => v && v[flag] && v.name);
  if (!picked.length) return null;
  const label = (v) => {
    const type = v.apexClass || v.objectType || v.dataType;
    return type ? `${v.name} (${type}${v.isCollection ? '[]' : ''})` : v.name;
  };
  const shown = picked.slice(0, SIGNATURE_CAP).map(label);
  const extra = picked.length - shown.length;
  return shown.join(', ') + (extra > 0 ? `, +${extra} more` : '');
}

// ── Resources ────────────────────────────────────────────────────────────────────────────────────────────
// A flow's RESOURCES - formulas, text templates, choice sets, constants, variables - have no card of their
// own, so until now the only thing said about them was a count on the flow card ("1 formulas"). For seeing
// the flow that is fine; for DOCUMENTING it the count is the whole gap: the card says a formula exists and
// never what it computes, names a Send Email's template and never what it sends.
//
// The inclusion rule, stated once: a resource earns a row iff it has NO card on the canvas AND carries
// AUTHORED meaning. That admits formulas, templates, choice sets, constants and DESCRIBED variables; it
// excludes elements (they have cards), and it excludes machine-generated noise - measured across 339 real
// flows, most of the 252 static choices are Flow Builder's own `S_<uuid>` screen plumbing, whose meaning is
// already resolved at the point of use by describeChoices.
// [metadata key, singular, plural] - drives the flow card's inventory row. Order is the reading order.
const RESOURCE_KINDS = [
  ['variables', 'variable', 'variables'],
  ['constants', 'constant', 'constants'],
  ['formulas', 'formula', 'formulas'],
  ['textTemplates', 'text template', 'text templates'],
  ['choices', 'choice', 'choices'],
  ['dynamicChoiceSets', 'choice set', 'choice sets'],
];
const RES_VALUE_CAP = 240;   // one long formula is documentation; a 674-char HTML template is a wall
/** Truncate, and SAY how much was cut - "…" alone lets a reader mistake a fragment for the whole thing. */
const capText = (s, n = RES_VALUE_CAP) => {
  const v = String(s ?? '').replace(/\s+/g, ' ').trim();
  return v.length <= n ? v : `${v.slice(0, n)}... (+${v.length - n} chars)`;
};
/** A QUOTED excerpt whose truncation residue sits OUTSIDE the quotes. `"a b c... (+13 chars)"` reads as though
 *  the residue were part of the text and the closing quote a typo; `"a b c..." (+13 chars)` reads as an excerpt
 *  with a note about what was cut. Reported as "cut values (with +13 chars\" ...)". */
/** Average rendered width of a character in a df.Table cell at 13px, measured in the browser across four real
 *  samples (prose 6.29, a sentence 6.32, a formula 5.80, an API name 7.32). The API-name figure is the widest
 *  and the LEFT column is full of API names, so the conservative one is the one to use: over-estimating a card's
 *  height is harmless - the view shrinks the box - while under-estimating drops it onto whatever is below.
 *  Both tables derive their characters-per-column from this and their own width, so neither can be left stale
 *  when a width changes. dev/tests/e2e/flow-card-height.spec.js checks the result against the RENDER. */
const CHAR_W = 7.32;

/** Row count above which the Resources card ships COLLAPSED. Set from the geometry it competes with: the flow
 *  card beside it runs ~600px, and a Resources row is ~28px, so ~20 rows is where this card stops being an
 *  annotation and starts being the tallest thing on the canvas. */
const RES_COLLAPSE_ABOVE = 20;

const capQuoted = (s, n) => {
  const v = String(s ?? '').replace(/\s+/g, ' ').trim();
  return v.length <= n ? `"${v}"` : `"${v.slice(0, n)}..." (+${v.length - n} chars)`;
};
// XML arrives escaped, and an expression full of &apos;/&quot; is unreadable as documentation. The DOM path
// unescapes for us; the raw-string path (and any &amp;-double-escape) does not.
const unescapeXml = (s) => String(s ?? '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
/** `{!Account.Name}` references inside a template or formula - what it actually PULLS. Harvested from the
 *  RAW text, deliberately BEFORE any tag-stripping: a template whose whole content is
 *  `<img src="{!Get_Account_Owner.FullPhotoUrl}">` keeps its meaning only in that attribute, so stripping
 *  tags first deletes the one thing worth reporting. */
const MERGE_CAP = 4;
function mergeFields(raw) {
  const seen = [];
  for (const m of String(raw ?? '').matchAll(/\{!([A-Za-z0-9_.$]+)\}/g)) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  if (!seen.length) return null;
  const shown = seen.slice(0, MERGE_CAP).map((r) => `{!${r}}`).join(', ');
  return seen.length > MERGE_CAP ? `${shown}, +${seen.length - MERGE_CAP} more` : shown;
}
/** Flow Builder names its inline screen choices `S_<32 hex>` (and older ones with a uuid). Those are
 *  plumbing, not authored resources - listing 252 of them would bury the six a human actually named. */
const isMachineName = (n) => /^S_[0-9a-f]{8}(_[0-9a-f]{4}){3}_[0-9a-f]{12}$/i.test(String(n || ''))
  || /^S_[0-9a-f]{32}$/i.test(String(n || ''));
const typeOf = (v) => v.apexClass || v.objectType || v.dataType || null;

/** [name, description] pairs for every resource worth glossing. Order is by KIND so the card reads in
 *  sections without needing header rows the user could sort away. */
function resourceRows(md, choiceIdx) {
  const out = [];
  const push = (name, parts) => {
    const v = parts.filter(Boolean).join(' · ');
    if (name && v) out.push([String(name), v]);
  };
  for (const f of asList(md.formulas)) {
    push(f.name, [`Formula${f.dataType ? ` (${f.dataType})` : ''}`,
      f.expression ? `= ${capText(unescapeXml(f.expression))}` : null]);
  }
  for (const t of asList(md.textTemplates)) {
    const raw = unescapeXml(t.text || '');
    const isHtml = t.isViewedAsPlainText === false || t.isViewedAsPlainText === 'false';
    const stripped = strippedText(raw);
    // The size is only worth printing when the reader cannot see the thing itself. A short template shows in
    // full inside the quotes, and "73 chars" next to "Select the products with cancel fee." is a fact about a
    // string the reader is already looking at. Reported: "resources again show more than I think it should,
    // with number of characters for a text template that asks for selection of type, or even nothing".
    //
    // So it survives in exactly the two cases where it still carries information:
    //   · the excerpt was CUT - though `capQuoted` already appends its own "(+N chars)", so a leading count
    //     would be the same fact twice; it is the markup-heavy case below that needs it;
    //   · there is no prose to quote at all (an image-only or empty template), where the length is the only
    //     size signal the row can give.
    const shown = stripped ? capQuoted(stripped, 120) : null;
    const sizeIsNews = !stripped;
    push(t.name, [
      `Text template (${isHtml ? 'HTML' : 'plain text'})`,
      sizeIsNews ? (raw ? `${raw.length} chars` : 'empty') : null,
      mergeFields(raw) && `uses ${mergeFields(raw)}`,
      // A template that is ALL markup (the measured image-only one) has no prose to excerpt - say so rather
      // than print an empty quote the reader reads as a converter failure.
      shown || (raw ? 'no text outside the markup' : null),
    ]);
  }
  for (const d of asList(md.dynamicChoiceSets)) {
    push(d.name, [`Choice set${d.dataType ? ` (${d.dataType})` : ''}`, choiceIdx?.get(d.name) || null]);
  }
  for (const c of asList(md.choices)) {
    if (isMachineName(c.name)) continue;   // counted below, never listed
    // 8 of the measured choices carry rich text, so the raw value would print `<p><i style="font-size: 11px;">`
    // and cut the sentence off at the cap. Strip first, THEN cap, so the 80 characters go to the prose.
    const label = strippedText(c.choiceText || c.label);
    // Value BEFORE the excerpt. The value is the short, precise fact - it is what the flow compares against -
    // and trailing it after a long quoted label produced `"...(+13 chars)" · = 2`, read as "weird = 1 / = 2
    // after another dot". `stores` also distinguishes it from a formula's `=`, which means something else: a
    // formula EQUALS an expression, whereas a choice STORES a value while SHOWING a label.
    push(c.name, [`Choice${c.dataType ? ` (${c.dataType})` : ''}`,
      pickValue(c.value) ? `stores ${capText(pickValue(c.value), 40)}` : null,
      // 120, matching the text-template excerpt. At 330px wide an 80-character cap was already three lines; the
      // table is 500 now, and cutting a choice 13 characters short of the end is the "cut values" complaint.
      label ? capQuoted(label, 120) : null]);
  }
  for (const c of asList(md.constants)) {
    push(c.name, [`Constant${c.dataType ? ` (${c.dataType})` : ''}`,
      pickValue(c.value) != null && pickValue(c.value) !== '' ? `= ${capText(pickValue(c.value), 120)}` : null]);
  }
  // Variables: the DESCRIBED ones only. 277 of 2152 measured carry a description, and that is the author's own
  // signal that this one is worth explaining - a far better filter than any heuristic, and it keeps a flow with
  // 62 working variables from drowning the card. The interface (isInput/isOutput) is already on the flow card.
  for (const v of asList(md.variables)) {
    if (!v.description) continue;
    push(v.name, [`Variable${typeOf(v) ? ` (${typeOf(v)}${v.isCollection ? '[]' : ''})` : ''}`,
      capText(v.description, 160)]);
  }
  // Account for what the curation above omits, so the card reconciles with the flow card's full inventory row
  // (its "62 variables" against this card's one described row read as a defect until the difference is stated -
  // the same accounted-for rule the mapping converter applies to DLO fields it prunes). Guarded on out.length:
  // a flow with nothing WORTH listing still gets no card at all, and the accounting row must never conjure one.
  const omittedVars = asList(md.variables).filter((v) => v && !v.description).length;
  const machineChoices = asList(md.choices).filter((c) => c && isMachineName(c.name)).length;
  if (out.length && (omittedVars || machineChoices)) {
    push('Not listed', [
      omittedVars ? `${omittedVars} ${omittedVars === 1 ? 'variable' : 'variables'} without ${omittedVars === 1 ? 'a description' : 'descriptions'}` : null,
      machineChoices ? `${machineChoices} auto-generated screen ${machineChoices === 1 ? 'choice' : 'choices'}` : null,
    ]);
  }
  return out;
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
  ['screens', () => 'df.FlowScreen', (e, ctx) => {
    // Leaves, not the top level: on a sectioned screen the top level is Section1 / Column1, so the summary
    // used to name the scaffolding and never the inputs. Flattening also stops a RegionContainer counting as
    // "interactive" merely because it has a fieldType.
    const all = flattenScreenFields(e.fields);
    // DisplayText blocks are prose, not inputs - lead with the interactive fields so the card says what the
    // screen ASKS, and cap the list: a 13-screen flow otherwise writes paragraphs onto a 210px card.
    const interactive = all.filter((f) => f.fieldType && f.fieldType !== 'DisplayText');
    // List them ALL. This is a multi-line panel field, not the 210px card label (the card shows only the
    // element name), so the old slice(0,4) + "(+6 more)" hid information for no layout benefit. Interactive
    // fields lead so the summary opens with what the screen ASKS; DisplayText prose follows.
    const ordered = [...interactive, ...all.filter((f) => !interactive.includes(f))];
    return { components: ordered.map((f) => f.name).join(', ') || null, details: screenRows(e, ctx?.choiceIdx) };
  }],
  // Orchestrator stages have NO dedicated df.Flow* class (the spec's Flow Shapes table stops at the
  // standard element set), so they degrade to the generic Action card with their steps as the summary.
  // Recorded as a warning per run - a df.FlowStage shape would be the faithful fix.
  // Orchestrator / ApprovalWorkflow. Connectors need NO special handling: this falls into the generic `else`
  // below, which already routes `connector` / `connectors[]`, and `faultConnector` is handled for every
  // collection - which is why stages were never dropped even while they drew as generic Action cards.
  ['orchestratedStages', () => 'df.FlowStage', (e, ctx) => ({
    stageSteps: asList(e.stageSteps).map((s) => s.label || s.name).join(' → ') || null,
    // EXPANDED, each step has a card carrying its own rows, so repeating them here would be the same content
    // twice in two places that can disagree. What the stage card still owes the reader is the SHAPE of the band
    // (how many steps, of which kinds) and its own exit condition, which belongs to no step.
    details: ctx?.expandStages && asList(e.stageSteps).length
      ? [{ label: 'Steps', value: stageStepSummary(asList(e.stageSteps)) },
        { label: 'Exit conditions', value: stageExitText(e) }]
      : stageStepRows(e),
  })],
  ['subflows', () => 'df.FlowSubflow', (e) => ({ flowName: e.flowName, details: subflowRows(e) })],
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
  ['transforms', () => 'df.FlowTransform', (e) => ({ transformTarget: e.objectType || e.transformTarget || null, details: transformRows(e) })],
  ['recordLookups', () => 'df.FlowGetRecords', (e) => ({ object: e.object, filters: summarizeFilters(e.filters, e.filterLogic), details: getOutputRows(e) })],
  // A Create with `filters` is an UPSERT: the filters are MATCHING criteria, not a query, and
  // `operationMultMatchingRecords` is what happens when more than one record matches. Both were dropped, so an
  // upsert was indistinguishable from a plain insert on the card - a real behavioural difference, and the one
  // a reader most needs when auditing "could this create duplicates?". Labelled explicitly rather than reusing
  // the `filters` prop, which reads as "where" on Get/Update/Delete and would say the wrong thing here.
  ['recordCreates', () => 'df.FlowCreateRecords', (e) => ({ object: e.object, details: createRows(e) })],
  ['recordUpdates', () => 'df.FlowUpdateRecords', (e) => ({ object: e.object, filters: summarizeFilters(e.filters, e.filterLogic), details: inputRows(e) })],
  ['recordDeletes', () => 'df.FlowDeleteRecords', (e) => ({ object: e.object, filters: summarizeFilters(e.filters, e.filterLogic), details: inputRows(e) })],
  ['recordRollbacks', () => 'df.FlowRollback', () => ({})],
  ['experiments', () => 'df.FlowPathExperiment', (e) => ({ outcomes: (e.experimentPaths || []).map((p) => p.name).join(', ') || null })],
  ['collectionProcessors', (e, warn) => {
    const sub = String(e.elementSubtype || e.collectionProcessorType || '');
    const cls = COLLECTION_PROCESSOR_SUBTYPE[sub];
    if (!cls && sub) warn(`collectionProcessor subtype "${sub}" has no dedicated shape - drawn as Collection Filter`);
    return cls || 'df.FlowCollectionFilter';
  }, (e) => ({ collectionReference: e.collectionReference, conditions: summarizeConditions(e.conditions, e.conditionLogic), details: collectionRows(e) })],
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
    ...(st.schedule ? [{ label: 'Schedule', value: describeSchedule(st.schedule) }] : []),
    ...(st.filters?.length ? [{ label: 'Entry conditions', value: summarizeFilters(st.filters, st.filterLogic) || '' }] : []),
    // Data Cloud SEGMENT-triggered flows. `publishSegment` was the named backlog gap, but it never travels
    // alone - the same start also carries the segment id and the data graph, and reporting one of the three
    // would leave the reader knowing a segment is involved and not which. Named as Salesforce names them and
    // reported raw, deliberately: the exact runtime meaning of publishSegment is not something this converter
    // should assert, and `Record trigger` above already sets the precedent of passing an enum through.
    ...(st.dataGraph ? [{ label: 'Data graph', value: String(st.dataGraph) }] : []),
    ...(st.segment ? [{ label: 'Segment', value: String(st.segment) }] : []),
    ...(st.publishSegment === true || st.publishSegment === 'true'
      ? [{ label: 'Publish segment', value: 'yes' }] : []),
    ...rows(st.scheduledPaths, (sp) => ({
      label: sp.label || sp.name,
      // TIME_SOURCE, not the raw enum: "5 Days after RecordField" reads like a field name and is a TYPE name.
      // When the source IS a record field, sp.recordField names it - which is what the reader wanted.
      value: [
        sp.offsetNumber != null ? `${sp.offsetNumber} ${sp.offsetUnit || ''}`.trim() : null,
        sp.timeSource === 'RecordField' ? (sp.recordField || 'a record field') : (TIME_SOURCE[sp.timeSource] || sp.timeSource),
      ].filter(Boolean).join(' after ') || 'immediately',
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
  const expandStages = !!opts.expandStages;
  const stepIds = new Set();   // the expanded step cards - excluded from the metadata-coordinate test below
  const bands = [];            // { id, label, memberIds } - drawn AFTER layout, from where the cards landed
  // Flow-wide context for the extractors, which otherwise only see their own element.
  const convertCtx = { choiceIdx: buildChoiceIndex(md), expandStages };
  // Serialised ONCE and only when it is asked for: stepOutputsRead scans the whole flow per background step,
  // and re-stringifying a 300KB metadata blob per step would be quadratic for a documentation row.
  let mdText = null;
  const serialized = () => (mdText === null ? (mdText = JSON.stringify(md)) : mdText);

  // Turn one stage's `stageSteps` into cards chained under the stage card, in document order, and return the id
  // the stage's OWN outgoing connectors should now leave from. That is the LAST step, not the stage: the stage
  // does not continue until its steps are done, so a connector still leaving the stage card would draw a path
  // that skips the work. A stage with NO steps is left completely alone and gets no band - an empty rectangle
  // labelled "Stage: Archive" around a single card is decoration, not documentation.
  const expandStage = (stage) => {
    const steps = asList(stage.stageSteps).filter((s) => s && (s.name || s.label));
    if (!steps.length) return stage.name;
    const memberIds = [stage.name];
    let prev = stage.name, prevStep = null;
    steps.forEach((st, i) => {
      // The `step_` prefix is what keeps a step id out of the element namespace, but it cannot GUARANTEE that -
      // a flow is free to contain an element literally called `step_Publish_Article`. Qualify rather than let
      // addNode drop the card and silently break the rest of the chain with it.
      let id = `step_${st.name || `${stage.name}_${i + 1}`}`;
      if (seen.has(id)) id = `step_${stage.name}_${st.name || i + 1}`;
      const type = STEP_SHAPE[st.actionType] || 'df.FlowAction';
      if (!STEP_SHAPE[st.actionType]) {
        warnings.push(`stage step "${st.label || st.name}" has actionType "${st.actionType || '(none)'}", `
          + 'which has no shape mapping - drawn as a generic Action card');
      } else if (st.actionType === 'stepInteractive') {
        warnings.push(`stage step "${st.label || st.name}" is an interactive step, drawn as a Screen card - `
          + 'that mapping has never been checked against real interactive-step metadata, so read its card twice');
      }
      const props = {
        details: stepRows(st, {
          first: i === 0,
          // Only a background step earns the scan: a human step's result is the approval decision, which the
          // next step's entry condition already spells out on the connector.
          outputsRead: st.actionType === 'stepBackground' ? stepOutputsRead(st.name, serialized()) : null,
        }),
      };
      if (type === 'df.FlowSubflow') props.flowName = st.actionName;
      else if (type === 'df.FlowAction') { props.actionName = st.actionName; props.actionType = st.actionType; }
      if (!addNode(id, type, st.label || st.name, props, st)) return;
      edges.push({
        source: prev, target: id, kind: 'regular', layoutKind: 'regular',
        label: stepEdgeLabel(summarizeConditions(st.entryConditions, st.entryConditionLogic), prevStep),
      });
      memberIds.push(id);
      prev = id;
      prevStep = st.name;
    });
    if (memberIds.length < 2) return stage.name;   // every step lost its id race - no band, no rerouting
    for (const id of memberIds.slice(1)) stepIds.add(id);
    bands.push({ id: `zone_${stage.name}`, label: `Stage: ${stage.label || stage.name}`, memberIds });
    return prev;
  };

  for (const [key, typeOf, fieldsOf] of COLLECTIONS) {
    for (const el of md[key] || []) {
      if (!el?.name) { warnings.push(`${key} entry without a name - skipped`); continue; }
      if (!addNode(el.name, typeOf(el, warn), el.label || el.name, fieldsOf(el, convertCtx), el)) continue;
      // Where this element's outgoing connectors leave from. Identical to the element for everything except an
      // EXPANDED stage, whose continuation hangs off its last step.
      const outFrom = (key === 'orchestratedStages' && expandStages) ? expandStage(el) : el.name;

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
        addEdge(outFrom, null, el.connector);
        // Legacy `steps` carry a `connectors` ARRAY rather than a single `connector`.
        for (const c of el.connectors || []) addEdge(outFrom, null, c, c.label || null);
      }
      // The fault stays on the ELEMENT, not on `outFrom`. The metadata hangs a faultConnector off the STAGE, so
      // that is what failed; attributing it to the last step would be a claim the metadata does not make.
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

  // Who can the flow actually GET to? Everything runs from Start - a flow has no second entry point - so
  // anything this walk does not reach is dead metadata: a screen the author replaced and left behind, a branch
  // detached mid-rewrite. Both the End synthesis and the warning below read this one set, so they cannot
  // disagree about what is dead.
  const outgoing = new Map();
  for (const e of kept) {
    if (!e.target) continue;
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source).push(e.target);
  }
  const reachable = new Set([START_ID]);
  const stack = [START_ID];
  while (stack.length) {
    for (const t of outgoing.get(stack.pop()) || []) {
      if (!reachable.has(t)) { reachable.add(t); stack.push(t); }
    }
  }

  const hasOut = new Set(kept.filter((e) => e.target).map((e) => e.source));
  for (const c of [...cells]) {
    if (c.type === 'df.FlowEnd' || hasOut.has(c.id)) continue;
    // An UNREACHABLE element gets no End. Flow Builder draws none either - free-form never draws End at all,
    // and a detached element in auto-layout is not on a path that can terminate - but the reason is stronger
    // than fidelity: an End says "this is where a path finishes", and a path that cannot start has no finish.
    // Attaching one turned a single abandoned screen into a tidy two-card island that read as a deliberate
    // sub-flow, which is a WRONG claim about the flow rather than a missing one. The warning below still names
    // it, so the finding is reported rather than dressed up.
    if (!reachable.has(c.id)) continue;
    const endId = newEnd();
    reachable.add(endId);
    kept.push({ source: c.id, target: endId, kind: 'regular', layoutKind: 'regular', label: null });
  }
  // Collections that ARE converted but have no dedicated `df.Flow*` shape yet, so they land on the generic
  // Action card. Announce every one of them: the card is drawn and the graph stays connected, but the
  // reader would otherwise have no way to tell a Custom Error from an Apex action. (The catch-all above
  // warns for collections this converter does not know at all; this warns for the ones it knows but
  // cannot draw faithfully.)
  const NO_SHAPE_YET = [
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
  //
  // EXPANDED STEPS are excluded from this count for the same reason the synthesised Ends are: Flow Builder
  // stores locationX/locationY on a stage and NOTHING AT ALL on a step, so a step has no coordinate to be
  // missing. Counting them would make every expanded orchestration look like a partial-coordinate flow and
  // report the wrong reason for the fallback below.
  const realCells = cells.filter((c) => c.type !== 'df.FlowEnd' && c.id !== START_ID && !stepIds.has(c.id));
  const positioned = realCells.filter((c) => { const p = coords.get(c.id); return p && (p.x || p.y); });
  const anyCoords = positioned.length > 0;
  if (anyCoords && positioned.length < realCells.length) {
    const missing = realCells.length - positioned.length;
    warnings.push(`${missing} of ${realCells.length} elements have no canvas coordinates - laid out with the tidy tree instead of the metadata's partial set`);
  }
  // Expansion FORFEITS the metadata layout, and there is no partial credit available: honouring the stages'
  // own coordinates while the steps had none would pile every step onto (0,0). The tidy tree needs no
  // coordinates, and it is what puts a step directly under its stage - which is what makes a band a band.
  if (anyCoords && stepIds.size) {
    warnings.push('stage steps were expanded, and Flow Builder stores no canvas coordinate for a step - the '
      + "whole flow was laid out with the tidy tree instead of the metadata's own coordinates");
  }
  const useCoords = anyCoords && positioned.length === realCells.length && !stepIds.size;
  // Does a set of positions put any two REAL cards on top of each other? Flow Builder's coordinates are for
  // ITS canvas at ITS card size; Diagramforce draws every element at one 210x56 card, so a free-form flow that
  // a human dragged into place there can collide badly here. Measured across 339 flows from a real org: 300
  // used metadata coordinates and 106 of them - 35% - overlapped, the worst with 27 colliding pairs.
  const overlapCount = (list) => {
    const c = list.filter((x) => x.position && x.size && x.id !== '__flowmeta' && x.id !== '__flowresources');
    let n = 0;
    for (let i = 0; i < c.length; i++) {
      for (let j = i + 1; j < c.length; j++) {
        const a = c[i], b = c[j];
        if (a.position.x < b.position.x + b.size.width && b.position.x < a.position.x + a.size.width
          && a.position.y < b.position.y + b.size.height && b.position.y < a.position.y + a.size.height) n++;
      }
    }
    return n;
  };
  // A BAND is handed to the layout as ONE node - the stage, carrying its steps as `stack` - rather than as a
  // stage plus N ranked siblings. That is what keeps a stage and its steps in one column, and it is not a
  // convenience: ranked separately they are subject to the layout's same-rank resolver, which pushes a card
  // right to clear a fault lateral WITHOUT moving its parent. Measured on dev/tests/fixtures/orchestration-flow.json
  // before this: a stage held column 2 while its own step was pushed to column 2.5, and the band drawn round the
  // pair then contained the unrelated fault card sitting between them.
  //
  // The band is a legitimate unit to rank, not a fudge: a stage and its steps have exactly one way in and one
  // way out and nothing branches between them. So the layout sees edges into the STAGE and out of the STAGE
  // (`anchor`), the step-to-step edges collapse to self-edges and are dropped, and computeFlowLayout hands back
  // a position for every member.
  const bandOf = new Map();   // step id -> the stage id whose band owns it
  for (const b of bands) for (const id of b.memberIds.slice(1)) bandOf.set(id, b.memberIds[0]);
  const anchor = (id) => bandOf.get(id) || id;
  const tidyLayout = () => {
    const stacked = new Map(bands.map((b) => [b.memberIds[0], b.memberIds.slice(1).map((id) => ({ id, h: H }))]));
    const layoutNodes = nodes.filter((n) => !bandOf.has(n.id))
      .map((n) => (stacked.has(n.id) ? { ...n, stack: stacked.get(n.id) } : n));
    const pos = opts.computeFlowLayout({
      nodes: layoutNodes,
      edges: kept.map((e) => ({ source: anchor(e.source), target: anchor(e.target), kind: e.layoutKind || e.kind })),
    });
    for (const c of cells) { const p = pos.get(c.id); if (p) c.position = { x: Math.round(p.x), y: Math.round(p.y) }; }
  };

  // UNREACHABLE elements. A flow can carry an element nothing connects to - a screen the author replaced and
  // left behind, a branch detached during a rewrite. The converter draws it faithfully, which is right, but
  // silently: it lands off to one side looking like a layout glitch when it is actually a finding about the
  // FLOW. Saying so turns "why is that card floating there" into "that element is dead". Start is excluded -
  // having no inbound connector is its whole job.
  // Reachability, not just "has an inbound connector": a detached A -> B pair gave B an inbound edge, so only
  // A was ever named and B looked like a legitimate destination. Both are dead.
  const orphans = cells
    .filter((c) => c.type !== 'standard.Link' && c.id !== START_ID && c.type !== 'df.FlowEnd'
      && !reachable.has(c.id))
    .map((c) => c.id);
  if (orphans.length) {
    warnings.push(`${orphans.length} element(s) have no incoming connector and are unreachable: `
      + `${orphans.slice(0, 5).join(', ')}${orphans.length > 5 ? `, +${orphans.length - 5} more` : ''}`);
  }

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

    // The author's own layout is worth keeping when it READS, and worthless when it does not. Cards sitting on
    // top of each other are never acceptable, and the tidy tree resolved every one of those 106 flows to zero
    // overlaps - so when the metadata layout collides, take the computed one and SAY WHY. Same precedent as
    // the partial-coordinates fallback above: honest degradation beats a diagram nobody can read.
    const collisions = overlapCount(cells);
    if (collisions) {
      layoutMode = 'computed (tidy tree) - the metadata coordinates overlapped';
      warnings.push(`the flow's own canvas coordinates put ${collisions} pair(s) of cards on top of each other `
        + 'at this card size, so the tidy tree layout was used instead');
      tidyLayout();
    }
  } else {
    layoutMode = anyCoords && stepIds.size
      ? 'computed (tidy tree) - stage steps were expanded, and a step has no metadata coordinate'
      : 'computed (tidy tree) - metadata had no coordinates';
    tidyLayout();
  }

  // ── Stage bands ────────────────────────────────────────────────────────────
  // AFTER the layout, never before. A band is the bounding box of cards computeFlowLayout has already placed,
  // which is the whole reason the layout function owns the placement: a hand-authored band on a fixed stride
  // is only correct until a stage gains a step or a branch changes width.
  //
  // Pushed into `cells` HERE - after the End synthesis, before the links - so it reaches neither. A zone is not
  // a flow element: it must never be ranked, never be given an End, and never be wired to a port. It IS in
  // `cells` before the two annotation tables are placed, on purpose, so their left margin clears the band
  // rather than the cards inside it.
  //
  // Deliberately NOT `embeds`/`parent`. Embedding would make the band the cards' JointJS parent, which moves
  // and resizes with them - and the app's auto-layout writes element positions directly, so re-running it
  // inside the app would drag every band's members around by their band. A plain rectangle behind the cards
  // survives a re-layout; a parent does not.
  for (const b of bands) {
    const members = b.memberIds.map((id) => cells.find((c) => c.id === id)).filter((c) => c?.position && c?.size);
    if (!members.length) continue;
    const x0 = Math.min(...members.map((c) => c.position.x));
    const y0 = Math.min(...members.map((c) => c.position.y));
    const x1 = Math.max(...members.map((c) => c.position.x + c.size.width));
    const y1 = Math.max(...members.map((c) => c.position.y + c.size.height));
    cells.push({
      id: b.id,
      type: 'sf.Zone',
      position: { x: x0 - BAND_PAD_X, y: y0 - BAND_PAD_TOP },
      size: { width: (x1 - x0) + BAND_PAD_X * 2, height: (y1 - y0) + BAND_PAD_TOP + BAND_PAD_BOTTOM },
      z: 0,
      attrs: {
        body: {
          width: 'calc(w)', height: 'calc(h)', rx: 8, ry: 8,
          fill: BAND_FILL, stroke: BAND_BLUE, strokeWidth: 1, strokeDasharray: '8 4',
        },
        label: {
          x: 10, y: 16, textAnchor: 'start', textVerticalAnchor: 'middle',
          fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
          // The LABEL is theme-driven, unlike the outline: it sits on the canvas background rather than on the
          // band's own 5% tint, so the app's own muted-text token is both correct and automatically readable
          // in either theme.
          fill: 'var(--text-muted)', fontWeight: '600', text: b.label,
          textWrap: { width: 'calc(w - 24)', maxLineCount: 1, ellipsis: true },
        },
      },
    });
  }

  // ── Links ──
  // Anchor EVERY connector to one of the four baked-in ports. Without a port JointJS anchors to the
  // element centre, so the orthogonal router has nothing to work against and lines cut diagonally
  // straight across the cards - which is exactly what the spec's "connect between the baked-in ports"
  // instruction exists to prevent.
  const elById = new Map(cells.filter((c) => c.type !== 'standard.Link').map((c) => [c.id, c]));
  const endpoints = (e) => {
    const a = elById.get(e.source), b = elById.get(e.target);
    if (!a || !b) return ['port-bottom', 'port-top'];
    return flowLinkPorts(a.position, b.position, e.kind);
  };
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

  let li = 0;
  for (const e of kept) {
    const [sPort, tPort] = endpoints(e);
    const link = { id: `lnk_${++li}`, type: 'standard.Link', z: Z_LINK, source: { id: e.source, port: sPort }, target: { id: e.target, port: tPort } };
    if (e.kind === 'fault') link.attrs = { line: { stroke: FAULT_RED } };
    else if (e.kind === 'goto') link.attrs = { line: { stroke: GOTO_BLUE } };
    // A Loop's two branches carry a durable `flowKind`, which is what earns them an arrowhead in the app
    // (js/canvas/link-styles.js). They keep the spine's grey and stay solid, so unlike a fault or a Go To their
    // stroke cannot identify them - and a marker is not allowed to stand in for identity, because a re-anchor
    // re-applies the style from the type. A prop survives the re-anchor; an attr would be rewritten by it.
    else if (e.kind === 'loopNext' || e.kind === 'loopExit') link.flowKind = 'loop';
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
  // The flow's API NAME. The row has always existed; it was the VALUE that was missing. A Tooling response
  // carries `FullName` on the envelope and some sources carry `md.fullName`, but a .flow-meta.xml carries
  // NEITHER: in SFDX source format the API name lives ONLY in the FILE NAME
  // (Gather_Scent_Preferences_Campaign_Flow.flow-meta.xml) and never inside the document. So the row resolved to
  // null and was filtered out, and an XML-imported flow showed no API name at all - reported from real use
  // 2026-07-27, where it is the identifier needed to pull the flow again via CLI. The importer now passes the
  // dropped file's base name in as `opts.fullName`.
  //
  // `derivedName` matters for the emit decision below: a name read from the ENVELOPE is authored metadata, but
  // one recovered from a file name is inferred by us, and inferring one fact is not a reason to add a card to
  // somebody's canvas when the flow carries nothing else.
  const apiName = input?.FullName || md.fullName || opts.fullName || null;
  const derivedName = !input?.FullName && !md.fullName && !!opts.fullName;
  const meta = [
    ['API Name', apiName],
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
    // The full inventory, still counted here even when the Resources card lists them - the card is filtered
    // (described variables only, machine-named choices folded away) and this row is what it reconciles against.
    // Names are HUMANISED and pluralised: the raw keys printed "1 formulas" and the camelCase "textTemplates".
    ['Resources', RESOURCE_KINDS
      .map(([k, one, many]) => {
        const n = asList(md[k]).length;
        return n ? `${n} ${n === 1 ? one : many}` : null;
      }).filter(Boolean).join(', ')],
  ].filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => [k, String(v).replace(/\s+/g, ' ').trim()]);

  // Emit only when there is something to say. A DERIVED API name does not count on its own - see `derivedName`.
  // In practice every real flow carries processType / status / apiVersion, so this only ever bites a degenerate
  // one; the point is that the card never appears just because we inferred a name from a file path.
  const substantive = meta.filter(([k]) => !(derivedName && k === 'API Name')).length;
  if (substantive) {
    const startCell = cells.find((c) => c.id === START_ID);
    // 500 wide (was 330). A flow is tall and narrow and these tables live in the left margin, so width is the
    // axis there is spare of - and at 330 a Description, an Interview Label or a formula wrapped to four or five
    // lines and the truncations bit early. The column x is derived from this, so the block simply starts further
    // left; nothing else moves.
    const TABLE_W = 500, ROW_H = 28, LINE_H = 19, LABEL_H = 26, GAP = 90;
    // The view re-measures and GROWS DOWNWARD from position.y, so an under-estimate here lands the card on top
    // of Start - which is exactly what a flat rows*ROW_H estimate did, and what the numbers below got wrong a
    // second time. The old comment claimed "the value column is ~60% of TABLE_W", but js/shapes/core.js sizes
    // columns with `colW = width / cols` - they are EQUAL. Two columns of a 330px table are 165px each, less
    // 12px of padding, which is about 24 characters at 13px, not 30. Estimating 30 under-counted the wrapped
    // lines, and a flow with a long Description put the card 37px OVER Start (estimate 468, render 595).
    // The view also takes each row's height as the max across BOTH columns, so measure both: labels like
    // "Interview Label" and "Last modified" wrap on their own at 24 characters.
    // dev/tests/e2e/flow-card-height.spec.js compares the estimate against the RENDER, because that is the
    // only place the truth lives - position.y is derived from estH, so a JSON-only check is tautological.
    const VALUE_COLS = Math.floor((TABLE_W / 2 - 12) / CHAR_W);
    const linesOf = (t) => Math.max(1, Math.ceil(String(t).length / VALUE_COLS));
    const estH = LABEL_H + meta.reduce((h, [k, v]) =>
      h + Math.max(ROW_H, Math.max(linesOf(k), linesOf(v)) * LINE_H + 9), 0);
    // LEFT of the flow, not above it. A flow is tall and narrow - the ID&V sample is 16 cards deep and one
    // card wide - so stacking annotation above Start makes an already-tall diagram taller, on a monitor that
    // is wider than it is high. A left column uses the axis the flow does not.
    const leftX = cells.reduce((m, c) => (c.position && c.size && c.id !== '__flowmeta'
      ? Math.min(m, c.position.x) : m), Infinity);
    const colX = (Number.isFinite(leftX) ? leftX : (startCell?.position.x ?? 0)) - TABLE_W - GAP;
    const topY = cells.reduce((m, c) => (c.position && c.id !== '__flowmeta'
      ? Math.min(m, c.position.y) : m), Infinity);
    cells.push({
      id: '__flowmeta',
      type: 'df.Table',
      position: { x: colX, y: Number.isFinite(topY) ? topY : 0 },
      size: { width: TABLE_W, height: estH },
      z: 2300,
      tableLabel: title,
      rows: meta,
      highlightFirstRow: false,   // a key/value card: the LEFT column is the header, not the top row
      highlightFirstCol: true,
      // Every cell here is IMPORTED data, not authored prose - a Salesforce Description is a plain-text field,
      // so interpreting its `*` as markdown is a coincidence rather than an intent. Two flows in a 339-flow
      // sample have descriptions that render as accidental italics today; a description containing `2 * 3 * 4`
      // would lose its operators the same way a formula does. The provenance boundary is the rule: a converter
      // emits data and sets plainCells, a USER authoring a df.Table gets markdown.
      plainCells: true,
    });
  }

  // ── Open in Salesforce ─────────────────────────────────────────────────────
  // A link card back to the flow in the platform, so a diagram handed to someone is one click from the real
  // thing rather than a name they have to go and search for.
  //
  // It needs an ORG URL, and NEITHER source carries one: a `.flow-meta.xml` has no instance and no id, and a
  // Tooling response has the `301...` id but still no instance. So the caller supplies `opts.orgUrl`, and
  // without it no card is emitted - a link to a guessed host would be worse than none.
  //
  // With an id we can deep-link into Flow Builder. Without one (the XML path) the best available target is the
  // Flows list in Setup, which is honest but weaker - so the card SAYS which it is rather than looking like a
  // deep link that lands somewhere general.
  const orgUrl = String(opts.orgUrl || '').trim().replace(/\/+$/, '');
  if (orgUrl) {
    // `opts.flowId` lets a caller supply an id the SOURCE does not carry - the CLI resolves one from the org
    // for a .flow-meta.xml, whose file name is the API name but which holds no id.
    const flowId = opts.flowId || input?.Id || input?.id || null;
    const url = flowId
      ? `${orgUrl}/builder_platform_interaction/flowBuilder.app?flowId=${encodeURIComponent(flowId)}`
      : `${orgUrl}/lightning/setup/Flows/home`;
    const metaCard = cells.find((c) => c.id === '__flowmeta');
    const startCell = cells.find((c) => c.id === START_ID);
    const LINK_W = 220, LINK_H = 44;
    // ABOVE the flow card, centred on it, so it reads as part of that summary block. Above rather than below
    // ON PURPOSE: the flow card's height is an ESTIMATE and the view grows it downward, so anything placed
    // under it can be swallowed by an under-estimate - measured at -1px on the first attempt. Nothing sits
    // above the card, so this cannot collide however far the estimate is out.
    const lx = metaCard ? metaCard.position.x + (metaCard.size.width - LINK_W) / 2
      : (startCell?.position.x ?? 0) + (W - LINK_W) / 2;
    const ly = metaCard ? metaCard.position.y - LINK_H - 16
      : (startCell?.position.y ?? 0) - LINK_H - 24;
    cells.push({
      id: '__flowlink',
      type: 'sf.Link',
      position: { x: lx, y: ly },
      size: { width: LINK_W, height: LINK_H },
      z: 2300,
      url,
      attrs: {
        label: { text: flowId ? 'Open in Flow Builder' : 'Open Flows in Setup' },
        // The whole URL on hover. The old sublabel showed a truncated host ("ma1781552930809. ...") which
        // told the reader nothing and cost the label its vertical centring.
      },
    });
    if (!flowId) {
      warnings.push('the org link points at the Flows list, not this flow - a .flow-meta.xml carries no flow id, '
        + 'so convert the Tooling API response instead if you want a direct link');
    }
  }

  // ── Resources card ─────────────────────────────────────────────────────────
  // A SIDEBAR to the right of the flow body, not another card stacked above Start. A flow is tall and thin, so
  // HEIGHT is the scarce axis - fit-to-screen is height-bound, and every pixel added above Start zooms the whole
  // diagram out. To the right, height is absorbed by the flow's own height and costs nothing. It also takes the
  // load off the height ESTIMATE: __flowmeta has to guess high or it lands on top of Start, whereas nothing sits
  // below this card, so guessing low is free.
  // Added LAST, for the same reason __flowmeta is: it must not reach the layout, the End synthesis or the link
  // pass, all of which have already run.
  const resRows = resourceRows(md, convertCtx.choiceIdx);
  if (resRows.length) {
    // Same width as the flow card above it - two tables of different widths in one column read as a mistake.
    const RES_W = 500, ROW_H = 28, LINE_H = 19, LABEL_H = 26;   // matches the flow card - one column, one width
    // Columns are UNIFORM - js/shapes/core.js uses `colW = width / cols`, NOT a weighted split - so each of the
    // two columns is 220px wide, about 28 characters per wrapped line at 13px. Estimate from the WIDER of the
    // two cells: this is the first table whose left column carries long API names, and the view sizes each row
    // by the max across both columns.
    const RES_COLS = Math.floor((RES_W / 2 - 12) / CHAR_W);   // same derivation as the flow card
    const lines = (s) => Math.max(1, Math.ceil(String(s).length / RES_COLS));
    const estH = LABEL_H + resRows.reduce((h, [k, v]) =>
      h + Math.max(ROW_H, Math.max(lines(k), lines(v)) * LINE_H + 9), 0);
    // Directly UNDER the flow card, in the SAME left column, so the two read as one block of documentation
    // running down the side of the flow rather than as two tables in different places.
    const metaCard = cells.find((c) => c.id === '__flowmeta');
    const colX = metaCard ? metaCard.position.x : cells.reduce((m, c) => (c.position && c.size
      ? Math.max(m, c.position.x + c.size.width) : m), 0);
    const top = metaCard ? metaCard.position.y + metaCard.size.height + 40
      : cells.reduce((m, c) => (c.position && c.id !== '__flowmeta' ? Math.min(m, c.position.y) : m), Infinity);
    cells.push({
      id: '__flowresources',
      type: 'df.Table',
      position: { x: colX, y: Number.isFinite(top) ? top : 0 },
      size: { width: RES_W, height: estH },
      z: 2300,
      tableLabel: 'Resources',
      rows: resRows,
      highlightFirstRow: false,   // like __flowmeta, the LEFT column is the header
      highlightFirstCol: true,
      // Cells hold CODE - a formula's `*` operators are markdown italic markers, so without this
      // `{!Quantity} * {!UnitPrice} * 1.23` renders with the operators deleted. See js/shapes/markdown-fo.js.
      plainCells: true,
      // Ships COLLAPSED once it would outgrow the flow card above it. Short cards stay open - the four rows on a
      // typical flow are the reason this card exists, and hiding them by default would undo that - but a
      // 40-row card is ~1100px against the flow card's ~600px, and it turns the annotation column into the
      // tallest thing on the canvas. Collapsed it is one row, and one click from all of it.
      ...(resRows.length > RES_COLLAPSE_ABOVE ? { collapsed: true } : {}),
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
    steps: stepIds.size,
    bands: bands.length,
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
 * @param {boolean} [opts.expandStages] - draw one card per orchestration STEP inside a stage band. Off by
 *   default and must stay that way: it changes the cell count, the ids and the layout of every orchestration
 *   already importable today. Forces the computed layout, because a step has no metadata coordinate.
 * @returns {{diagram: object, stats: object}}
 */
const OPPOSITE = { 'port-top': 'port-bottom', 'port-bottom': 'port-top', 'port-left': 'port-right', 'port-right': 'port-left' };
/** Which of the four baked-in ports a connector should leave from and arrive at, given the two cards' positions
 *  and the connector kind ('fault' | 'goto' | anything else). EXPORTED because the app needs the identical rule
 *  on the LOAD path: a hand- or LLM-authored flow link that omits `source.port`/`target.port` anchors to the
 *  element CENTRE, so sfManhattan has nothing to work against and the line cuts diagonally across the cards. The
 *  diagram validates, loads, and looks broken. Sharing this function is what keeps a repaired-on-load diagram
 *  identical to a converted one instead of merely similar. Pure - takes positions, returns port ids. */
export function flowLinkPorts(aPos, bPos, kind) {
  if (!aPos || !bPos) return ['port-bottom', 'port-top'];
  const dx = bPos.x - aPos.x, dy = bPos.y - aPos.y;
  // Fault and Go To leave the SIDE of a card by convention, so they read as an aside rather than as
  // the main path down the spine - the same way Flow Builder draws them.
  if (kind === 'fault' || kind === 'goto') {
    const out = dx >= 0 ? 'port-right' : 'port-left';
    // SIDE TO SIDE wherever it can be. The old rule entered the TOP or BOTTOM whenever the vertical distance
    // dominated - which on a flow, where ranks are stacked, is nearly always. So a Go To left the side of one
    // card and dived into the top of another, crossing the spine to get there and colliding with the main
    // path's own top-entry. Leaving a side and arriving at a side keeps the aside in the margin, which is where
    // it belongs and how Flow Builder draws it. Reported: "Go to connector might look better side to side".
    //
    // Two shapes qualify, and the test for both is the same as the return-path rule's: the target must be CLEAR
    // OF THE SOURCE CARD horizontally. Otherwise the two cards overlap, and a line leaving the right side at
    // x+W has to travel back PAST a target whose left edge is barely right of the source's - the double-back
    // that made side entry wrong for a near-vertical aside in the first place. There, top entry is still right.
    //   · pointing UP - a Go To is usually a back-edge - re-enters the SAME side, the U-turn that reads as "go
    //     round and repeat" rather than a line crossing the card it came from;
    //   · pointing DOWN enters the OPPOSITE side, so the two stubs face each other.
    if (dy < 0 || Math.abs(dx) >= W) return [out, dy < 0 ? out : OPPOSITE[out]];
    return [out, dy < 0 ? 'port-bottom' : 'port-top'];
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
    // "Genuinely to the right" has to mean CLEAR OF THE SOURCE CARD, not merely a positive dx. At `dx > W/2`
    // a target only 137px right of a 210px-wide card counted as right-hand - so the two cards overlapped
    // horizontally and the return path still wrapped round the right, travelling the length of the branch
    // content that lives there. Requiring a full card width means an overlapping pair takes the default left
    // gutter, which in a tidy-tree layout is the empty side.
    const side = dx > W ? 'port-right' : 'port-left';
    return [side, side];
  }
  if (Math.abs(dy) >= H) return ['port-bottom', 'port-top'];
  return dx >= 0 ? ['port-right', 'port-left'] : ['port-left', 'port-right'];
}

/** Frequency -> the unit an interval counts in, so `frequencyNumber` can be read out in English. */
const SCHEDULE_UNIT = { Hourly: 'hours', Daily: 'days', Weekly: 'weeks', Monthly: 'months' };
/** "every 2 hours - from 2026-07-21 16:15". Two things were being dropped here, both reported from a real org:
 *  - `frequencyNumber` was never read, so a flow running every 2 hours was documented as plain "Hourly" - the
 *    schedule looked twice as frequent as it is.
 *  - `startTime` was read as `.timeValue`, but it is a PLAIN STRING in both a .flow-meta.xml and a Tooling
 *    response, so the time silently vanished on every path (our own fixture included). Accept both shapes. */
function describeSchedule(sc) {
  if (!sc) return null;
  const n = Number(sc.frequencyNumber);
  const unit = SCHEDULE_UNIT[sc.frequency];
  // Only an interval GREATER than 1 is worth spelling out - "every 1 hours" is worse than "Hourly".
  const every = Number.isFinite(n) && n > 1 && unit ? `every ${n} ${unit}` : (sc.frequency || null);
  const raw = typeof sc.startTime === 'string' ? sc.startTime : sc.startTime?.timeValue;
  const time = raw ? String(raw).replace(/\.\d+Z?$/, '').replace(/:00$/, '') : null;
  const from = [sc.startDate, time].filter(Boolean).join(' ');
  // dayOfMonthToRun is only meaningful on a Monthly schedule; it is present as 0 on every other frequency.
  const day = sc.frequency === 'Monthly' && Number(sc.dayOfMonthToRun) > 0 ? `on day ${sc.dayOfMonthToRun}` : null;
  return [every, day, from && `from ${from}`].filter(Boolean).join(' \u00b7 ') || null;
}

export function convertFlowMetadata(input, opts = {}) {
  return convert(input, opts);
}

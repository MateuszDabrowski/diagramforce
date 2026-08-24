// Flow-diagram property renderer (S1) — one renderer for all df.Flow* element classes. Uniform Content section
// (Name / API Name / Description) + a per-kind "Flow Details" section whose fields come from the shared
// FLOW_ELEMENTS table (js/shapes/flow.js). Fields are FREE TEXT (decision #9 — no parsing/validation); the Start's
// Trigger Type / Process Type add a datalist of the most popular values as suggestions (free-text, not a picklist).
// Edits write TOP-LEVEL model props (undoable via history CONTENT_PROPS). Reads graph + panel DOM via prctx; never
// imports the facade. showProperties() imports it back.
import { prctx } from './context.js?v=1.23.1';
import { finishStandardProps } from './render-core.js?v=1.23.1';
import { addActionBtn, addSelect, addText, addTextarea, addTextWithSuggestions, section } from './widgets.js?v=1.23.1';
import { escHtml } from '../util.js?v=1.23.1';
import { FLOW_ELEMENTS } from '../shapes/flow.js?v=1.23.1';
import { convertFlowPlaceholderTo } from './convert.js?v=1.23.1';
// Cycle-safe: tabs.js never imports the properties stack (the properties FACADE already imports
// getActiveTabName from it), and the type gate below needs the live tab type at render time.
import { getActiveTabType } from '../tabs.js?v=1.23.1';

// Start's Process Type / Trigger Type are FREE TEXT with a datalist of the MOST POPULAR Salesforce values as
// suggestions (a 35-value picklist was unusable — owner feedback 2026-07-19). Type anything; the datalist just
// offers the common cases. The COMPLETE standard Metadata API enum lives in DIAGRAM_JSON_SPEC.md for reference.
const PROCESS_TYPE_SUGGESTIONS = ['AutoLaunchedFlow', 'Flow', 'Orchestrator', 'EvaluationFlow', 'Survey', 'Journey',
  'PromptFlow', 'CheckoutFlow', 'RoutingFlow', 'Workflow', 'CustomEvent', 'InvocableProcess'];
const TRIGGER_TYPE_SUGGESTIONS = ['RecordAfterSave', 'RecordBeforeSave', 'RecordBeforeDelete', 'Scheduled',
  'PlatformEvent', 'DataCloudDataChange', 'Segment', 'AutomationEvent'];

// Per-kind field metadata: human label + whether it wants a multi-line box (summaries) vs a single input, or a
// free-text input with a datalist of `suggestions`. Keys match the `fields` arrays in FLOW_ELEMENTS. A key with no
// entry falls back to a title-cased label.
const FIELD_SPECS = {
  processType:         { label: 'Process Type', suggestions: PROCESS_TYPE_SUGGESTIONS },
  triggerType:         { label: 'Trigger Type', suggestions: TRIGGER_TYPE_SUGGESTIONS },
  object:              { label: 'Object' },
  filters:             { label: 'Filters', multiline: true },
  components:          { label: 'Screen Components', multiline: true },
  actionName:          { label: 'Action Name' },
  actionType:          { label: 'Action Type' },
  flowName:            { label: 'Referenced Flow' },
  waitEvents:          { label: 'Wait Events', multiline: true },
  // A stage lists several steps, same as waitEvents / outcomes. Without an entry the panel falls back to
  // the raw key and the field reads "stageSteps".
  stageSteps:          { label: 'Steps', multiline: true },
  assignmentItems:     { label: 'Assignments', multiline: true },
  outcomes:            { label: 'Outcomes', multiline: true },
  collectionReference: { label: 'Collection' },
  conditions:          { label: 'Conditions', multiline: true },
  transformTarget:     { label: 'Target' },
  message:             { label: 'Error Message', multiline: true },
  // Messaging sends: `template` is the CMS/content reference; its LABEL is overridden per element via
  // el.fieldLabels (Email / SMS / Message / Push Notification Message / In-App Message). `activation` is the
  // Data 360 API-activation reference (a data-export config, not message content).
  template:            { label: 'Template' },
  activation:          { label: 'Activation' },
  // Start-only free-text for arbitrary setup notes (schedule cadence, entry conditions, etc.).
  configuration:       { label: 'Configuration', multiline: true },
};

export function renderFlowElementProps(cell) {
  const type = cell.get('type');
  const el = FLOW_ELEMENTS.find((e) => 'df.Flow' + e.cls === type);

  // Content — the uniform trio present on every element.
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Name', cell.get('name') || '', (v) => {
    cell.set('name', v);
    prctx.titleEl.textContent = v || '';
  });
  addText(content, 'API Name', cell.get('apiName') || '', (v) => cell.set('apiName', v));
  addTextarea(content, 'Description', cell.get('description') || '', (v) => cell.set('description', v));

  // The way OUT of a Placeholder. Flow has 34 element classes and no generic node, so unlike the architecture
  // placeholder this cannot be a style preset - the user picks the class and the cell is swapped for a real one.
  // A SELECT, not 34 Convert buttons. Deleting-and-redrawing was the alternative, and JointJS takes every
  // connected link with a removed cell, so a placeholder wired into the middle of a flow would cost the user all
  // of its connectors. Converting keeps them (plus position, embedding and selection) in ONE undo step.
  if (type === 'df.FlowPlaceholder') {
    const become = section(prctx.bodyEl, 'Resolve');
    const opts = FLOW_ELEMENTS
      .filter((e) => e.cls !== 'Placeholder')
      .map((e) => ({ value: 'df.Flow' + e.cls, label: e.label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    addSelect(become, 'Convert to', '', [{ value: '', label: 'Pick an element type...' }, ...opts], (v) => {
      if (v) convertFlowPlaceholderTo(cell, v);
    });
  }

  // Flow Details — the element's per-kind fields (empty section is skipped, e.g. End / Roll Back Records).
  const fields = el?.fields || [];
  if (fields.length) {
    const details = section(prctx.bodyEl, 'Flow Details');
    for (const key of fields) {
      const spec = FIELD_SPECS[key] || { label: key };
      const label = el?.fieldLabels?.[key] || spec.label;   // per-element label override (messaging channel names)
      const val = cell.get(key) || '';
      const write = (v) => cell.set(key, v);
      if (spec.suggestions) {
        // Free-text + datalist of popular values — type anything (lossless), the dropdown just offers common cases.
        addTextWithSuggestions(details, label, val, spec.suggestions, write);
      } else if (spec.multiline) addTextarea(details, label, val, write);
      else addText(details, label, val, write);
    }
  }

  // Metadata — the `details` row array, rendered as a compact two-column table (1.21.0). Where "Flow Details"
  // above holds the element's KEY facts as one-line fields sized for the card, this holds the long tail the card
  // has no room for: which fields a Create/Update actually writes, which fields a Get reads out and into what,
  // a screen's full component list with types, each decision outcome's condition, an action's parameters.
  //
  // Read-only on purpose. These rows are IMPORTED FACTS about a real flow - an editable grid would invite them
  // to drift from the org they describe, and nothing in the app keys off them (unlike a DataObject's typed
  // fields, which mapping links resolve against - which is why that one needs a full editor and this does not).
  // Stays inside decision #9: free text, no parsing, no schema.
  const rows = cell.get('details');
  if (Array.isArray(rows) && rows.length) {
    const meta = section(prctx.bodyEl, 'Metadata');
    // Two groups. LOUD rows are what the element actually does; QUIET rows are flags Salesforce wrote as
    // `false`. The owner's call, looking at a real Send Email card: "those false values are actually useful
    // information... just collapsed by default". So they are kept and folded away rather than dropped - "off"
    // is an answer, and a reader cannot get it from an absence.
    const loud = rows.filter((r) => !r?.quiet);
    const quiet = rows.filter((r) => r?.quiet);
    const tableFor = (list) => {
      const t = document.createElement('table');
      t.className = 'df-prop-detail-table';
      t.innerHTML = list.map((r) => {
        const label = escHtml(String(r?.label ?? ''));
        const value = escHtml(String(r?.value ?? ''));
        return `<tr><th scope="row">${label}</th><td>${value || '<span class="df-prop-detail-table__empty">-</span>'}</td></tr>`;
      }).join('');
      return t;
    };
    if (loud.length) meta.appendChild(tableFor(loud));

    if (quiet.length) {
      // A native <details>, not a custom toggle: it is collapsed by default, keyboard-reachable and
      // screen-reader-announced for free, and it carries its own open/closed state without any of ours.
      const d = document.createElement('details');
      d.className = 'df-prop-detail-more';
      const sm = document.createElement('summary');
      sm.textContent = `${quiet.length} setting${quiet.length === 1 ? '' : 's'} turned off`;
      d.appendChild(sm);
      d.appendChild(tableFor(quiet));
      meta.appendChild(d);
    }

    // State the remaining SUPPRESSION RULE. Explicitly-false flags are now kept (above); what is still dropped
    // at import is the UNSET parameter, and that stays dropped because it genuinely says nothing - Salesforce
    // writes the whole parameter list whether or not it was configured, so an untouched `replyToName` is noise.
    // Measured across 60 real flows / 96 action cards: the false flags are +5% of detail rows, the unset ones a
    // further +8% that would say nothing at all.
    //
    // Still a NOTE rather than a toggle for the unset ones, and for the original reason: they are dropped at
    // IMPORT and are not in the diagram to reveal, so a toggle would mean persisting them - in localStorage,
    // every save and every share URL. And because this is a panel string rather than baked data, it is right
    // for flows imported BEFORE this release too, which storing rows never could be.
    const note = document.createElement('p');
    note.className = 'df-prop-detail-note';
    note.textContent = 'Parameters that were never set are hidden.';
    meta.appendChild(note);
  }

  // The way BACK from click-to-focus (owner-directed, the return half of the table's nav-button
  // design): jump to the Table view and land on THIS element's spine row. It sits directly under
  // the Metadata block - "Metadata section" is where the owner asked for it - but hangs off the
  // panel BODY rather than inside that section, because an element with no `details` renders no
  // Metadata at all and the return path must exist on every flow element regardless. Gated on the
  // TAB type, not the cell type: the Table toggle exists per tab (hasTable, display-options.js),
  // and a df.Flow* card sitting on some other tab type must not click a hidden toggle into the
  // wrong projection. View, scroll and highlight are all runtime state - nothing here writes a
  // cell prop, so a save after the jump is byte-identical.
  if (getActiveTabType() === 'flow') {
    addActionBtn(prctx.bodyEl, 'Show in Table view', () => {
      // The same toolbar-button idiom focusFlowElement uses in the other direction (flow-table.js
      // clicks #btn-view-diagram) - neither module may import the toolbar, and the click renders
      // the table synchronously, so the row exists before the query below runs. tr[data-el] is the
      // row anchor tableHtml stamps; the first match in document order is the SPINE row (the spine
      // is section one and lists every element). A row hidden by the user's own collapse or filter
      // is left where it is - scrollIntoView on a hidden row is a no-op, and silently rewriting
      // that state to force a reveal would fight the user to win a scroll.
      document.getElementById('btn-view-table')?.click();
      const row = document.querySelector(`#mapping-table-view tbody tr[data-el="${CSS.escape(String(cell.id))}"]`);
      if (!row) return;   // same guard class as focusFlowElement's: the element outran its render
      // The hidden-row half of that decision, made explicit: a collapsed section's tbody is
      // display:none, so its rows have no offsetParent - and while the scroll would no-op on its
      // own, the flash class would NOT: parked on the hidden row, its one-shot animation fires
      // whenever the user later expands the section, a surprise highlight disconnected from any
      // action. Return before both; the user lands at the top with their collapse respected.
      if (!row.offsetParent) return;
      row.scrollIntoView({ block: 'center' });
      // One-shot flash, restarted around a reflow so a repeat visit flashes again; the class then
      // stays (an ended animation paints nothing), keeping the landing a stable observable fact.
      row.classList.remove('df-tbl__row--flash');
      void row.offsetWidth;
      row.classList.add('df-tbl__row--flash');
    });
  }

  finishStandardProps(cell, { sizeMode: 'pair', autoSize: true, applySize: true });
}

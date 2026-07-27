// Flow-diagram property renderer (S1) — one renderer for all df.Flow* element classes. Uniform Content section
// (Name / API Name / Description) + a per-kind "Flow Details" section whose fields come from the shared
// FLOW_ELEMENTS table (js/shapes/flow.js). Fields are FREE TEXT (decision #9 — no parsing/validation); the Start's
// Trigger Type / Process Type add a datalist of the most popular values as suggestions (free-text, not a picklist).
// Edits write TOP-LEVEL model props (undoable via history CONTENT_PROPS). Reads graph + panel DOM via prctx; never
// imports the facade. showProperties() imports it back.
import { prctx } from './context.js?v=1.21.3';
import { finishStandardProps } from './render-core.js?v=1.21.3';
import { addText, addTextarea, addTextWithSuggestions, section } from './widgets.js?v=1.21.3';
import { escHtml } from '../util.js?v=1.21.3';
import { FLOW_ELEMENTS } from '../shapes/flow.js?v=1.21.3';

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
    const table = document.createElement('table');
    table.className = 'df-prop-detail-table';
    table.innerHTML = rows.map((r) => {
      const label = escHtml(String(r?.label ?? ''));
      const value = escHtml(String(r?.value ?? ''));
      return `<tr><th scope="row">${label}</th><td>${value || '<span class="df-prop-detail-table__empty">-</span>'}</td></tr>`;
    }).join('');
    meta.appendChild(table);
  }

  finishStandardProps(cell, { sizeMode: 'pair', autoSize: true, applySize: true });
}

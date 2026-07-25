// Salesforce Flow elements (df.Flow*) — the 'flow' diagram type's primary shapes (S1). registerFlow() is called
// by shapes.js register() AFTER registerCore() (which creates the joint.shapes.df namespace these attach to).
//
// ONE declarative table (FLOW_ELEMENTS) drives BOTH surfaces so the roster can never drift:
//   - this leaf's joint.dia.Element.define() loop (the 34 shape classes)
//   - FLOW_CATEGORIES + createElementFromComponent in components.js (imports FLOW_ELEMENTS from here)
// The three parity registries (ALLOWED_CELL_TYPES in persistence/diagram-schema.js, TYPE_LABELS + DEFAULT_SIZES
// in properties/type-meta.js) MUST list every 'df.Flow<cls>' as LITERAL lines — the registry-sync test parses
// their SOURCE text, so they can't be generated from this table. Keep them in step by hand (dev/tests/registry-sync).
//
// Element taxonomy + metadata-element names verified verbatim against the Metadata API Flow reference (2026-07-18).
// Per-kind field KEYS use the real subtype field name where a 1:1 field exists (triggerType, object, filters,
// actionName, actionType, flowName, waitEvents, collectionReference, conditions, assignmentItems); the rest are
// pragmatic free-text summary keys (components, outcomes, transformTarget, message, template, activation) per
// decision #9. `fieldLabels` overrides a field's panel label per element (the messaging sends label `template`
// per channel: Email / SMS / Message / Push Notification Message / In-App Message, matching Flow Builder). Every card
// icon is a verified SLDS STANDARD-sprite symbol id read from real Flow Builder HTML exports (S5) and baked WHITE
// on the category chip (getIconDataUri returns '' for an unknown id → invisible blank).
// NB per-kind keys avoid JointJS built-in cell attributes (source/target/vertices/router) — `transformTarget`,
// not `target`, so a change-listener never misfires on a link's endpoint change (caught in S1 e2e).

import { portGroups, portItems } from './ports.js?v=1.20.1';
import { getIconDataUri } from '../icons.js?v=1.20.1';

// Uniform card size for every element (decision #8/S1: "Uniform default size for all classes"). MUST equal the
// DEFAULT_SIZES entries in properties/type-meta.js or "Auto Size" snaps to a different box.
export const FLOW_W = 210;
export const FLOW_H = 56;

// Category colours + per-element icon tokens are VERIFIED against two real Flow Builder HTML exports
// (2026-07-18): the icon `standard:*` token and the icon-chip background were read from the exported DOM's
// computed styles. Flow Builder colours by PALETTE SECTION (not metadata type) - e.g. Einstein Decision is an
// `actionCall` but sits in the Logic section, so it is orange, not navy. The chip holds a WHITE standard glyph
// (icons.js bakes `getIconDataUri(token, '#FFFFFF')`; standard sprites win the id-collision so the token resolves
// to the colourful-icon glyph rendered white). ~4 tokens marked (best-match) weren't in either export - the
// closest SLDS standard/utility glyph, swap-in-ready when a top-up export arrives.
const C = {
  start:       '#0B827C', // teal        (measured)
  end:         '#EA001E', // red         (measured)
  interaction: '#032D60', // navy        (measured) - most Interaction elements
  screen:      '#1B96FF', // bright blue (measured) - Screen renders its own lighter blue, not the navy
  logic:       '#DD7A01', // orange      (measured)
  data:        '#FF538A', // pink        (measured)
};

// The single source of truth. cls → class suffix (df.Flow<cls>); icon → SLDS symbol id (standard sprite unless
// noted); accent → chip colour (palette section); meta → the Flow metadata element (documentation only);
// fields → per-kind free-text prop keys.
export const FLOW_ELEMENTS = [
  // ── Start / End ── (round: the two terminal nodes use a CIRCLE chip in Flow Builder, not the element squircle)
  { cls: 'Start',                label: 'Start',                            icon: 'df-flow-start',        accent: C.start,       meta: 'start',              fields: ['processType', 'triggerType', 'object', 'filters', 'configuration'], round: true, iconDx: 2 }, // teal circle + custom EQUILATERAL play triangle (nudged right to optically centre the centroid)
  { cls: 'End',                  label: 'End',                              icon: 'stop',                 accent: C.end,         meta: '(UI-only)',          fields: [], round: true },                                     // red circle + stop square
  // ── Interaction (navy) ───────────────────────────────────────────────────
  { cls: 'Screen',               label: 'Screen',                           icon: 'screen',               accent: C.screen,      meta: 'screens',            fields: ['components'] },                                       // Screen uses its own bright blue (measured)
  { cls: 'Action',               label: 'Action',                           icon: 'custom_notification',  accent: C.interaction, meta: 'actionCalls',        fields: ['actionName', 'actionType'] },
  { cls: 'Subflow',              label: 'Subflow',                          icon: 'flow',                 accent: C.interaction, meta: 'subflows',           fields: ['flowName'] },
  { cls: 'SendToFlow',           label: 'Send to a Flow',                   icon: 'sales_cadence',        accent: C.interaction, meta: 'subflows',           fields: ['flowName'] },
  // The messaging sends reference CMS/Marketing CONTENT: the primary field is labelled per channel in Flow Builder
  // (Email / SMS / Message / Push Notification Message / In-App Message) via `fieldLabels`, over a shared `template`
  // key. Send to Data 360 references an ACTIVATION definition (not content) → its own `activation` key.
  { cls: 'SendEmail',            label: 'Send Email Message',               icon: 'email',                accent: C.interaction, meta: 'actionCalls',        fields: ['template'], fieldLabels: { template: 'Email' } },
  { cls: 'SendSms',              label: 'Send SMS Message',                 icon: 'sms',                  accent: C.interaction, meta: 'actionCalls',        fields: ['template'], fieldLabels: { template: 'SMS' } },
  { cls: 'SendWhatsApp',         label: 'Send WhatsApp Message',            icon: 'whatsapp',             accent: C.interaction, meta: 'actionCalls',        fields: ['template'], fieldLabels: { template: 'Message' } },   // Flow Builder labels it 'Message' (owner-confirmed; help doc says 'WhatsApp')
  { cls: 'SendToData360',        label: 'Send to Data 360 Activation',      icon: 'custom_notification',  accent: C.interaction, meta: 'actionCalls',        fields: ['activation'] },                                       // references an API activation definition, not message content
  { cls: 'SendMobileApp',        label: 'Send Mobile App Message',          icon: 'custom_notification',  accent: C.interaction, meta: 'actionCalls',        fields: ['template'], fieldLabels: { template: 'Push Notification Message' } },
  { cls: 'SendMobileInApp',      label: 'Send Mobile In-App Message',       icon: 'custom_notification',  accent: C.interaction, meta: 'actionCalls',        fields: ['template'], fieldLabels: { template: 'In-App Message' } },  // best-match icon (same action family)
  { cls: 'ForwardToBot',         label: 'Forward to Bot or Agent',          icon: 'bot',                  accent: C.interaction, meta: 'actionCalls',        fields: ['actionName'] },
  { cls: 'RunAgent',             label: 'Run Agent',                        icon: 'agent_astro',          accent: C.interaction, meta: 'actionCalls (GENERATE_AI_AGENT_RESPONSE)', fields: ['actionName'] },
  { cls: 'CreateCampaignMember', label: 'Create Campaign Member',           icon: 'custom_notification',  accent: C.interaction, meta: 'actionCalls',        fields: ['actionName', 'object'] },
  { cls: 'CreateTask',           label: 'Create Task',                      icon: 'custom_notification',  accent: C.interaction, meta: 'actionCalls',        fields: ['actionName'] },
  { cls: 'Exit',                 label: 'Exit from a Flow',                 icon: 'outcome',              accent: C.interaction, meta: '(UI-only, REMOVE_FROM_FLOW)', fields: [] },
  // ── Logic (orange) ───────────────────────────────────────────────────────
  { cls: 'Assignment',           label: 'Assignment',                       icon: 'assignment',           accent: C.logic,       meta: 'assignments',        fields: ['assignmentItems'] },
  { cls: 'Decision',             label: 'Decision',                         icon: 'decision',             accent: C.logic,       meta: 'decisions',          fields: ['outcomes'] },
  { cls: 'Loop',                 label: 'Loop',                             icon: 'loop',                 accent: C.logic,       meta: 'loops',              fields: ['collectionReference'] },
  { cls: 'Transform',            label: 'Transform',                        icon: 'data_mapping',         accent: C.logic,       meta: 'transforms',         fields: ['transformTarget'] },
  { cls: 'PathExperiment',       label: 'Path Experiment',                  icon: 'path_experiment',      accent: C.logic,       meta: 'experiments',        fields: ['outcomes'] },
  { cls: 'CollectionSort',       label: 'Collection Sort',                  icon: 'sort',                 accent: C.logic,       meta: 'collectionProcessors', fields: ['collectionReference'] },
  { cls: 'CollectionFilter',     label: 'Collection Filter',                icon: 'filter',               accent: C.logic,       meta: 'collectionProcessors', fields: ['collectionReference', 'conditions'] },
  { cls: 'Wait',                 label: 'Wait for Amount of Time',          icon: 'today',                accent: C.logic,       meta: 'waits',              fields: ['waitEvents'] },
  { cls: 'WaitUntilDate',        label: 'Wait Until Date',                  icon: 'today',                accent: C.logic,       meta: 'waits',              fields: ['waitEvents'] },
  { cls: 'WaitUntilEvent',       label: 'Wait Until Event',                 icon: 'today',                accent: C.logic,       meta: 'waits',              fields: ['waitEvents'] },
  { cls: 'EinsteinDecision',     label: 'Einstein Decision',                icon: 'story',                accent: C.logic,       meta: 'actionCalls',        fields: ['actionName'] },
  { cls: 'DetermineCrmRecord',   label: 'Determine CRM Record for Individual', icon: 'record',            accent: C.logic,       meta: 'actionCalls',        fields: ['actionName'] },
  // ── Data (pink) ──────────────────────────────────────────────────────────
  { cls: 'GetRecords',           label: 'Get Records',                      icon: 'record_lookup',        accent: C.data,        meta: 'recordLookups',      fields: ['object', 'filters'] },
  { cls: 'CreateRecords',        label: 'Create Records',                   icon: 'record_create',        accent: C.data,        meta: 'recordCreates',      fields: ['object'] },
  { cls: 'UpdateRecords',        label: 'Update Records',                   icon: 'record_update',        accent: C.data,        meta: 'recordUpdates',      fields: ['object', 'filters'] },
  { cls: 'DeleteRecords',        label: 'Delete Records',                   icon: 'record_delete',        accent: C.data,        meta: 'recordDeletes',      fields: ['object', 'filters'] },
  { cls: 'Rollback',             label: 'Roll Back Records',                icon: 'recent',               accent: C.data,        meta: 'recordRollbacks',    fields: [] },                                                  // standard:recent (export-verified)
  // NB: Recommendation Assignment + Custom Error were REMOVED (2026-07-19, owner) - their icons couldn't be found
  // in Salesforce to verify; re-add when a real export confirms them.
];

// Every per-kind field key across the roster, plus the uniform trio — imported by history.js CONTENT_PROPS
// (so edits are undoable) and by the property renderer. De-duplicated + stable-ordered.
export const FLOW_CONTENT_PROPS = [
  'name', 'apiName', 'description',
  ...[...new Set(FLOW_ELEMENTS.flatMap((e) => e.fields))],
];

export function registerFlow() {
  for (const el of FLOW_ELEMENTS) {
    // The 32px chip sits at x=8 (centre x=24). Square element icons fill a 24px box; the ROUND terminal nodes
    // (Start/End) take a SMALLER 14px glyph so the white shape reads as a small square/triangle inside the circle
    // (matching Flow Builder), and `iconDx` optically re-centres an asymmetric glyph (the play triangle).
    const iconSz = el.round ? 14 : 24;
    const iconX = 24 - iconSz / 2 + (el.iconDx || 0);
    const iconY = `calc(0.5 * h - ${iconSz / 2})`;
    joint.dia.Element.define(
      'df.Flow' + el.cls,
      {
        size: { width: FLOW_W, height: FLOW_H },
        z: 2000, // Node tier (2000-2499) — same as every other primary card
        // Top-level content props (the persisted schema; a future flow-import extension maps onto these).
        // `name` seeds the visible label; apiName/description/per-kind fields default empty so they don't
        // bloat saves until authored.
        name: el.label,
        attrs: {
          body: {
            width: 'calc(w)', height: 'calc(h)', rx: 8, ry: 8,
            fill: 'var(--node-bg)', stroke: 'var(--node-border)', strokeWidth: 1,
          },
          iconChip: {
            x: 8, y: 'calc(0.5 * h - 16)', width: 32, height: 32,
            rx: el.round ? 16 : 8, ry: el.round ? 16 : 8,   // round → full circle (Start/End); else element squircle
            fill: el.accent,
          },
          icon: {
            x: iconX, y: iconY, width: iconSz, height: iconSz, href: '',
          },
          label: {
            x: 52, y: 'calc(0.5 * h)',
            textAnchor: 'start', textVerticalAnchor: 'middle',
            fontSize: 13, fontFamily: 'system-ui, -apple-system, sans-serif',
            fill: 'var(--node-text)', text: el.label,
            textWrap: { width: 'calc(w - 64)', maxLineCount: 2, ellipsis: true },
          },
          subtitle: {
            x: 52, y: 'calc(0.5 * h + 14)',
            textAnchor: 'start', textVerticalAnchor: 'middle',
            fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
            fill: 'var(--node-subtitle)', text: '', visibility: 'hidden',
            textWrap: { width: 'calc(w - 64)', maxLineCount: 1, ellipsis: true },
          },
        },
        ports: { groups: portGroups, items: portItems },
      },
      {
        markup: [
          { tagName: 'rect', selector: 'body' },
          { tagName: 'rect', selector: 'iconChip' },
          { tagName: 'image', selector: 'icon' },
          { tagName: 'text', selector: 'label' },
          { tagName: 'text', selector: 'subtitle' },
        ],
        // Model-level binding (df.Pill pattern — NEVER a view render(), which the async paper drops; gotcha 11.50).
        // `name` → the visible label (top); the ELEMENT TYPE → the grey subtitle below it, mirroring the Flow
        // Builder canvas (Name on top, element type underneath). apiName is an editable panel field for
        // documentation but is NOT shown on the card. When name is re-centred by S3 layout or edited in the panel,
        // the card repaints from the model.
        // The icon is INTRINSIC to the element type, so bake the canonical white SLDS glyph onto the chip whenever
        // it's missing — this makes an LLM-authored cell (which never sets icon/href) self-iconize, exactly like a
        // stencil drop. This is the FRESH-DROP path (empty href). A RELOAD restores a slimmed `data-icon-id`
        // placeholder (non-empty), so this guard skips it; icon-refresh.js's df.Flow* branch re-resolves that
        // placeholder to the white glyph on load (missing that branch broke every flow icon on refresh).
        initialize() {
          joint.dia.Element.prototype.initialize.apply(this, arguments);
          this.on('change:name', () => this._syncFlowText());
          this._syncFlowText();
          if (!this.attr('icon/href')) {
            const href = getIconDataUri(el.icon, '#FFFFFF', 24);
            if (href) this.attr('icon/href', href);
          }
        },
        _syncFlowText() {
          const typeLabel = el.label;
          const name = this.get('name');
          const nameStr = typeof name === 'string' ? name.trim() : '';
          // A DISTINCT name shows on top with the element TYPE beneath it ("Segment Flow / Start"). An EMPTY name
          // (or a name equal to the type) shows the TYPE as the single line — the card is NEVER blank (it used to
          // go fully empty when the Name field was cleared, since the subtitle also hid).
          const named = nameStr !== '' && nameStr !== typeLabel;
          this.attr('label/text', named ? name : typeLabel);
          this.attr('subtitle/text', typeLabel);
          this.attr('subtitle/visibility', named ? 'visible' : 'hidden');
          // Nudge the label up when the type line shows so the pair stays visually centred.
          this.attr('label/y', named ? 'calc(0.5 * h - 8)' : 'calc(0.5 * h)');
        },
      }
    );
  }
}

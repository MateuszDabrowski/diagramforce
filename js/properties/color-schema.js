// Per-type colour-field schema + icon recolour (CLEANUP S2, slice 1) — extracted from properties.js so the
// style-clip helpers (copyCellStyle/pasteCellStyle, which read COLOR_SCHEMA) can later move to properties/widgets.js
// without a cycle back to the facade. Never imports properties.js.
import { getIconDataUri } from '../icons.js?v=1.21.0';
import { sanitizeCssColor } from '../util.js?v=1.21.0';
import { contrastTextColor } from '../components.js?v=1.21.0';

/** Re-colour a cell's icon to match a new colour (used for fill/label colour changes). */
export function recolorCellIcon(cell, newColor) {
  const iconHref = cell.attr('icon/href') || cell.attr('headerIcon/href');
  const attrPath = cell.attr('icon/href') ? 'icon/href' : 'headerIcon/href';
  if (!iconHref) return;
  const safeColor = sanitizeCssColor(newColor);
  const idMatch = iconHref.match(/data-icon-id(?:%3D|=)(?:%22|")([^%"]+)(?:%22|")/);
  if (idMatch) {
    const iconId = decodeURIComponent(idMatch[1]).replace(/[^a-zA-Z0-9_-]/g, '');
    cell.attr(attrPath, getIconDataUri(iconId, safeColor));
  } else {
    // Legacy path: replace fill attribute in decoded SVG data URI
    const decoded = decodeURIComponent(iconHref);
    const updated = decoded.replace(/fill="[^"]*"/, `fill="${safeColor}"`);
    cell.attr(attrPath, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(updated));
  }
}

// Per-type color field schema used by the multi-select Colors section.
// Each entry lists the color "slots" the type exposes in its single-element
// panel; multi-select intersects these by label so only colors that ALL
// selected types support are shown. Getters return the current value (or
// a type default); setters apply the same side-effects as the single-
// element renderer (e.g. SimpleNode Fill also updates text contrast).
export const COLOR_SCHEMA = {
  'sf.SimpleNode': [
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => {
        c.attr('body/fill', v);
        const tc = contrastTextColor(v);
        if (tc) {
          c.attr('label/fill', tc);
          c.attr('subtitle/fill', tc);
          c.attr('subtitle/opacity', 0.7);
          recolorCellIcon(c, tc);   // R4: the icon must follow the contrast text colour, as in the single-node panel
        }
      } },
    { label: 'Border',
      get: c => c.attr('body/stroke'),
      set: (c, v) => c.attr('body/stroke', v) },
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      // R4: recolor the icon too (multi-select was only recolouring the text; the single-node panel does both).
      set: (c, v) => { c.attr('label/fill', v); c.attr('subtitle/fill', v); recolorCellIcon(c, v); } },
  ],
  'sf.Container': [
    { label: 'Accent',
      get: c => c.attr('accent/fill'),
      set: (c, v) => { c.attr('accent/fill', v); c.attr('accentFill/fill', v); } },
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Border',
      get: c => c.attr('body/stroke'),
      set: (c, v) => c.attr('body/stroke', v) },
    { label: 'Label color',
      get: c => c.attr('headerLabel/fill'),
      set: (c, v) => c.attr('headerLabel/fill', v) },
  ],
  'sf.TextLabel': [
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      set: (c, v) => c.attr('label/fill', v) },
  ],
  'sf.Zone': [
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Border',
      get: c => c.attr('body/stroke'),
      set: (c, v) => c.attr('body/stroke', v) },
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      set: (c, v) => c.attr('label/fill', v) },
  ],
  'sf.TaskGroup': [
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Border',
      get: c => c.attr('body/stroke'),
      set: (c, v) => c.attr('body/stroke', v) },
  ],
  'sf.Note': [
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Border',
      get: c => c.attr('body/stroke'),
      // The dog-ear fold tracks the border colour (fill + stroke) so the user controls the flipped corner (#8).
      set: (c, v) => { c.attr('body/stroke', v); c.attr('fold/stroke', v); c.attr('fold/fill', v); } },
  ],
  'sf.Line': [
    { label: 'Label color',
      get: c => c.attr('line/stroke'),
      set: (c, v) => c.attr('line/stroke', v) },
  ],
  'sf.Annotation': [
    { label: 'Bracket color',
      get: c => c.attr('bracket/stroke'),
      set: (c, v) => c.attr('bracket/stroke', v) },
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      set: (c, v) => c.attr('label/fill', v) },
  ],
  'sf.DataObject': [
    { label: 'Header fill',
      get: c => c.get('headerColor') || '#1D73C9',
      set: (c, v) => {
        c.set('headerColor', v);
        c.attr('header/fill', v);
        c.attr('headerCover/fill', v);
      } },
  ],
  'sf.OrgPerson': [
    { label: 'Accent',
      get: c => c.attr('accentBar/fill') || '#1D73C9',
      set: (c, v) => { c.attr('accentBar/fill', v); c.attr('accentBarMask/fill', v); } },
  ],
  'sf.GanttTask': [
    { label: 'Completion bar',
      get: c => c.attr('progressBar/fill') || '#1D73C9',
      set: (c, v) => { c.attr('progressBar/fill', v); c.set('colorManual', true); } },   // manual → stops following the group
    { label: 'Label color',
      get: c => c.get('userTextColor') || c.attr('label/fill') || '#FFFFFF',
      set: (c, v) => { c.set('userTextColor', v); c.attr('label/fill', v); } },
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Border',
      get: c => c.attr('body/stroke'),
      set: (c, v) => c.attr('body/stroke', v) },
  ],
  'sf.GanttMilestone': [
    { label: 'Fill',
      get: c => c.attr('body/fill') || '#F6B355',
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Border',
      get: c => c.attr('body/stroke') || '#D4942A',
      set: (c, v) => c.attr('body/stroke', v) },
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      set: (c, v) => c.attr('label/fill', v) },
  ],
  'sf.GanttMarker': [
    { label: 'Fill',
      get: c => c.attr('body/fill') || '#DA4E55',
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Border',
      get: c => c.attr('body/stroke') || '#B03A40',
      set: (c, v) => c.attr('body/stroke', v) },
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      set: (c, v) => c.attr('label/fill', v) },
  ],
  'sf.GanttTimeline': [
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Top row',
      get: c => c.attr('topRow/fill'),
      set: (c, v) => c.attr('topRow/fill', v) },
    { label: 'Border',
      get: c => c.attr('body/stroke'),
      set: (c, v) => c.attr('body/stroke', v) },
  ],
  'sf.GanttGroup': [
    { label: 'Bar color',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      set: (c, v) => c.attr('label/fill', v) },
  ],
  'sf.SequenceParticipant': [
    { label: 'Accent',
      get: c => c.attr('headerAccent/fill'),
      set: (c, v) => {
        c.attr('headerAccent/fill', v);
        c.attr('header/stroke', v);
        c.attr('lifeline/stroke', v);
        c.attr('underline/stroke', v);
      } },
    { label: 'Fill',
      get: c => c.attr('header/fill'),
      set: (c, v) => c.attr('header/fill', v) },
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      set: (c, v) => c.attr('label/fill', v) },
  ],
  'sf.SequenceActor': [
    { label: 'Accent',
      get: c => c.attr('actorHead/stroke'),
      set: (c, v) => {
        c.attr('actorHead/stroke', v);
        c.attr('actorBody/stroke', v);
        c.attr('actorArms/stroke', v);
        c.attr('actorLegLeft/stroke', v);
        c.attr('actorLegRight/stroke', v);
        c.attr('lifeline/stroke', v);
      } },
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      set: (c, v) => c.attr('label/fill', v) },
  ],
  'sf.SequenceActivation': [
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Border',
      get: c => c.attr('body/stroke'),
      set: (c, v) => c.attr('body/stroke', v) },
  ],
  'sf.SequenceFragment': [
    { label: 'Border',
      get: c => c.attr('body/stroke'),
      set: (c, v) => {
        c.attr('body/stroke', v);
        c.attr('titleTab/stroke', v);
      } },
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Label color',
      get: c => c.attr('titleText/fill'),
      set: (c, v) => {
        c.attr('titleText/fill', v);
        c.attr('conditionText/fill', v);
      } },
  ],
};

// Default schema for BPMN / Flow shapes — Fill, Border, Label color.
const BASIC_COLOR_SCHEMA = [
  { label: 'Fill',
    get: c => c.attr('body/fill'),
    set: (c, v) => c.attr('body/fill', v) },
  { label: 'Border',
    get: c => c.attr('body/stroke'),
    set: (c, v) => c.attr('body/stroke', v) },
  { label: 'Label color',
    get: c => c.attr('label/fill'),
    set: (c, v) => c.attr('label/fill', v) },
];

// Shapes that share the basic (Fill / Border / Label color) schema.
[
  'sf.BpmnEvent', 'sf.BpmnTask', 'sf.BpmnGateway', 'sf.BpmnSubprocess',
  'sf.BpmnLoop', 'sf.BpmnDataObject',
  'sf.FlowProcess', 'sf.FlowDecision', 'sf.FlowTerminator', 'sf.FlowDatabase',
  'sf.FlowDocument', 'sf.FlowIO', 'sf.FlowPredefined', 'sf.FlowOffPage',
].forEach(t => { if (!COLOR_SCHEMA[t]) COLOR_SCHEMA[t] = BASIC_COLOR_SCHEMA; });

// Pool has an extra "Header fill".
COLOR_SCHEMA['sf.BpmnPool'] = [
  ...BASIC_COLOR_SCHEMA,
  { label: 'Header fill',
    get: c => c.attr('header/fill'),
    set: (c, v) => c.attr('header/fill', v) },
];

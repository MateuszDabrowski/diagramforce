// Per-type colour-field schema + icon recolour (CLEANUP S2, slice 1) — extracted from properties.js so the
// style-clip helpers (copyCellStyle/pasteCellStyle, which read COLOR_SCHEMA) can later move to properties/widgets.js
// without a cycle back to the facade. Never imports properties.js.
import { getIconDataUri } from '../icons.js?v=1.26.6';
import { sanitizeCssColor } from '../util.js?v=1.26.6';
import { contrastTextColor } from '../components.js?v=1.26.6';

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
// copy-paste-style.spec.js compares every slot with the panel control of the same label (review S4-3), so a side
// effect added to a panel setter must be added here too.
export const COLOR_SCHEMA = Object.assign(Object.create(null), {
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
      // The header icon follows the label colour, as in the single panel (gotcha 2.13a; review J2-16).
      set: (c, v) => { c.attr('headerLabel/fill', v); recolorCellIcon(c, v); } },
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
  // 'Color', as the single panel calls it. Slots match BY LABEL, and as 'Label color' a node's text colour pasted
  // onto a Line became its stroke - white text made the line invisible on the light canvas (review J2-16).
  'sf.Line': [
    { label: 'Color',
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
      set: (c, v) => {
        c.set('userTextColor', v);
        c.attr('label/fill', v);
        c.attr('percentLabel/fill', v);
        c.attr('assigneeLabel/fill', v);
      } },
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
      set: (c, v) => { c.attr('body/stroke', v); c.attr('divider/stroke', v); } },
  ],
  'sf.GanttGroup': [
    { label: 'Bar color',
      get: c => c.attr('body/fill'),
      set: (c, v) => { c.attr('body/fill', v); c.attr('leftProng/fill', v); c.attr('rightProng/fill', v); } },
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      set: (c, v) => c.attr('label/fill', v) },
  ],
  // The panel's Accent paints only the accent bar; the header border, lifeline and underline keep their theme colours.
  'sf.SequenceParticipant': [
    { label: 'Accent',
      get: c => c.attr('headerAccent/fill'),
      set: (c, v) => c.attr('headerAccent/fill', v) },
    { label: 'Fill',
      get: c => c.attr('header/fill'),
      set: (c, v) => c.attr('header/fill', v) },
    { label: 'Label color',
      get: c => c.attr('label/fill'),
      set: (c, v) => c.attr('label/fill', v) },
  ],
  // 'Color', as the panel calls it, and the figure only: the lifeline keeps its theme colour.
  'sf.SequenceActor': [
    { label: 'Color',
      get: c => c.attr('actorHead/stroke'),
      set: (c, v) => {
        c.attr('actorHead/stroke', v);
        c.attr('actorBody/stroke', v);
        c.attr('actorArms/stroke', v);
        c.attr('actorLegLeft/stroke', v);
        c.attr('actorLegRight/stroke', v);
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
        c.attr('dividerLine/stroke', v);
      } },
    { label: 'Fill',
      get: c => c.attr('body/fill'),
      set: (c, v) => c.attr('body/fill', v) },
    { label: 'Label color',
      get: c => c.attr('titleText/fill'),
      set: (c, v) => {
        c.attr('titleText/fill', v);
        c.attr('conditionText/fill', v);
        c.attr('elseText/fill', v);
      } },
  ],
});

// BPMN / Flow shapes: Fill, Border, Label color, with each type's own side effects as in its panel
// (renderers-process.js). `contrast`: Fill also sets a readable label colour. `border(c, v)`: the parts that follow
// the outline (an event's inner ring and glyph, a data object's fold, a cylinder's top, the predefined bars).
const basicColorSchema = ({ contrast = false, border = null } = {}) => [
  { label: 'Fill',
    get: c => c.attr('body/fill'),
    set: (c, v) => {
      c.attr('body/fill', v);
      const tc = contrast ? contrastTextColor(v) : null;
      if (tc) c.attr('label/fill', tc);
    } },
  { label: 'Border',
    get: c => c.attr('body/stroke'),
    set: (c, v) => { c.attr('body/stroke', v); border?.(c, v); } },
  { label: 'Label color',
    get: c => c.attr('label/fill'),
    set: (c, v) => c.attr('label/fill', v) },
];
const PLAIN = basicColorSchema();
const CONTRAST = basicColorSchema({ contrast: true });
Object.assign(COLOR_SCHEMA, {
  'sf.BpmnEvent': basicColorSchema({ contrast: true, border: (c, v) => {
    c.attr('innerRing/stroke', c.get('eventType') === 'intermediate' ? v : 'none');
    c.attr('icon/fill', v);
  } }),
  'sf.BpmnTask':       CONTRAST,
  'sf.BpmnGateway':    PLAIN,
  'sf.BpmnSubprocess': PLAIN,
  'sf.BpmnLoop':       PLAIN,
  'sf.BpmnDataObject': basicColorSchema({ border: (c, v) => c.attr('fold/stroke', v) }),
  'sf.FlowProcess':    CONTRAST,
  'sf.FlowDecision':   CONTRAST,
  'sf.FlowTerminator': CONTRAST,
  'sf.FlowDatabase':   basicColorSchema({ contrast: true, border: (c, v) => c.attr('top/stroke', v) }),
  'sf.FlowDocument':   CONTRAST,
  'sf.FlowIO':         CONTRAST,
  'sf.FlowPredefined': basicColorSchema({ contrast: true, border: (c, v) => { c.attr('lineLeft/stroke', v); c.attr('lineRight/stroke', v); } }),
  'sf.FlowOffPage':    CONTRAST,
  // Pool has an extra "Header fill".
  'sf.BpmnPool': [
    ...PLAIN,
    { label: 'Header fill',
      get: c => c.attr('header/fill'),
      set: (c, v) => c.attr('header/fill', v) },
  ],
});

// Stencil kit — the shared building blocks every diagram type's stencil category array is built
// from (S9). Extracted from components.js so the per-type category files (components/<type>.js) can
// import them without pulling in the whole 1600-line module. Zero deps (pure data + builders):
//   • node() / container() — component-descriptor factories (read-only templates; the element
//     factory clones them on drop, never mutates them).
//   • SVG — the 20×20 stroke-based stencil glyph map (also re-exported by components.js for
//     properties.js / tabs.js / renderers-core.js).
//   • GENERIC_SHAPES — the shared "Generic Shapes" set, identical across every type.

export function node(label, iconName, options = {}) {
  return { type: 'sf.SimpleNode', label, iconName, ...options };
}

export function container(label, iconName, accentColor, options = {}) {
  return { type: 'sf.Container', label, iconName, accentColor, ...options };
}

// Stencil SVG icons (20×20 viewBox, stroke-based, no fill by default)
export const SVG = {
  node:       '<rect x="3" y="4" width="14" height="12" rx="3" /><circle cx="10" cy="10" r="2" fill="currentColor" stroke="none"/>',
  container:  '<rect x="2" y="3" width="16" height="14" rx="2" /><line x1="2" y1="7" x2="18" y2="7"/><circle cx="5.5" cy="5" r="1" fill="currentColor" stroke="none"/>',
  text:       '<line x1="5" y1="4" x2="15" y2="4"/><line x1="10" y1="4" x2="10" y2="16"/><line x1="7" y1="16" x2="13" y2="16"/>',
  note:       '<path d="M4 3h9l3 3v11H4z"/><path d="M13 3v3h3"/>',
  zone:       '<rect x="2" y="3" width="16" height="14" rx="1" stroke-dasharray="3 2"/><line x1="4" y1="6" x2="10" y2="6" stroke-width="1" opacity="0.5"/>',
  line:       '<line x1="2" y1="10" x2="18" y2="10" stroke-width="2" stroke-linecap="round"/>',
  image:      '<rect x="2" y="3" width="16" height="14" rx="2"/><circle cx="6.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/><path d="M3 16l4-5 3 3 3-4 4 5"/>',
  pill:       '<rect x="5" y="5" width="10" height="10" rx="5"/><text x="10" y="10.2" font-size="7" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="currentColor" stroke="none">1</text>',
  // legend — a filled swatch + a text bar beside it (one colour key)
  legend:     '<rect x="3" y="6.5" width="7" height="7" rx="2" fill="currentColor" stroke="none"/><rect x="12" y="8" width="6" height="2" rx="1" fill="currentColor" stroke="none"/><rect x="12" y="12" width="4" height="1.6" rx="0.8" fill="currentColor" stroke="none"/>',
  // table — a 3×3 grid outline (header row implied by the heavier top band)
  table:      '<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><line x1="2.5" y1="7.5" x2="17.5" y2="7.5"/><line x1="2.5" y1="12" x2="17.5" y2="12"/><line x1="7.5" y1="3.5" x2="7.5" y2="16.5"/><line x1="12.5" y1="3.5" x2="12.5" y2="16.5"/>',
  // linkIcon — external-link glyph (SVG Repo "External_Link"), translated to crop
  // the 24×24 source into the 20×20 viewBox and with the arrow head pulled one
  // unit toward the shape centre (M19 5 instead of M20 4).
  linkIcon:   '<g transform="translate(-3 -2)" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.0002 5H8.2002C7.08009 5 6.51962 5 6.0918 5.21799C5.71547 5.40973 5.40973 5.71547 5.21799 6.0918C5 6.51962 5 7.08009 5 8.2002V15.8002C5 16.9203 5 17.4801 5.21799 17.9079C5.40973 18.2842 5.71547 18.5905 6.0918 18.7822C6.5192 19 7.07899 19 8.19691 19H15.8031C16.921 19 17.48 19 17.9074 18.7822C18.2837 18.5905 18.5905 18.2839 18.7822 17.9076C19 17.4802 19 16.921 19 15.8031V14M19 9V5M19 5H15M19 5L13 11"/></g>',
  // link — stencil thumbnail: terminator pill with ONLY the arrow portion of the
  // external-link glyph centered inside (no inner square — readable at 20×20).
  link:       '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="5" width="18" height="10" rx="5" stroke-width="1.5"/><path d="M7.5 12.5 L12.5 7.5 M10 7.5 H12.5 V10" stroke-width="1.3"/></g>',
  // Flowchart
  flowProcess:    '<rect x="2" y="4" width="16" height="12" rx="2"/>',
  flowDecision:   '<path d="M10 3L18 10L10 17L2 10Z"/>',
  flowTerminator: '<rect x="2" y="5" width="16" height="10" rx="5"/><rect x="8" y="8" width="4" height="4" rx="0.5" fill="currentColor" stroke="none"/>',
  flowDatabase:   '<ellipse cx="10" cy="6" rx="7" ry="3"/><path d="M3 6v8c0 1.66 3.13 3 7 3s7-1.34 7-3V6" fill="none"/>',
  flowDocument:   '<path d="M3 4h14v10c-2.3-1.5-4.7-1.5-7 0s-4.7 1.5-7 0z"/>',
  flowIO:         '<path d="M6 4h12l-4 12H2z"/>',
  flowPredefined: '<rect x="2" y="4" width="16" height="12" rx="1"/><line x1="5" y1="4" x2="5" y2="16"/><line x1="15" y1="4" x2="15" y2="16"/>',
  // Org
  orgPerson:     '<rect x="2" y="3" width="16" height="14" rx="3"/><line x1="2" y1="6" x2="18" y2="6" stroke-width="1.5"/><circle cx="7" cy="11" r="2" stroke-width="0.8"/><line x1="11" y1="10" x2="16" y2="10" stroke-width="1"/><line x1="11" y1="13" x2="15" y2="13" stroke-width="0.8" opacity="0.5"/>',
  orgDepartment: '<rect x="2" y="3" width="16" height="14" rx="1" stroke-dasharray="3 2"/><circle cx="7" cy="8" r="1.5" stroke-width="0.8"/><circle cx="13" cy="8" r="1.5" stroke-width="0.8"/><circle cx="10" cy="13" r="1.5" stroke-width="0.8"/>',
  orgTeam:       '<rect x="2" y="3" width="16" height="14" rx="2"/><rect x="2" y="5" width="2" height="10" rx="1" fill="currentColor" stroke="none" opacity="0.6"/><text x="7" y="8" font-size="4" font-weight="bold" fill="currentColor" stroke="none" opacity="0.5">Team</text><circle cx="8" cy="13" r="1.5" stroke-width="0.8"/><circle cx="13" cy="13" r="1.5" stroke-width="0.8"/>',
  orgTask:       '<rect x="2" y="5" width="16" height="10" rx="2"/><line x1="10" y1="5" x2="10" y2="15"/><line x1="3.5" y1="8.5" x2="8.5" y2="8.5" stroke-width="1.2"/><line x1="3.5" y1="11.5" x2="7" y2="11.5" stroke-width="0.9" opacity="0.7"/><circle cx="14" cy="10" r="1.5" stroke-width="0.8"/>',
  orgTaskGroup:  '<rect x="1.5" y="2.5" width="17" height="15" rx="2" stroke-dasharray="3 2"/><rect x="4" y="6" width="12" height="3.4" rx="1"/><rect x="4" y="11" width="12" height="3.4" rx="1"/>',
  // BPMN Events
  eventStart:        '<circle cx="10" cy="10" r="7" stroke-width="1.5"/>',
  eventEnd:          '<circle cx="10" cy="10" r="7" stroke-width="4"/>',
  eventIntermediate: '<circle cx="10" cy="10" r="7" stroke-width="1.5"/><circle cx="10" cy="10" r="4.5" stroke-width="1.5"/>',
  // BPMN Activities
  task:       '<rect x="2" y="4" width="16" height="12" rx="3"/>',
  subprocess: '<rect x="2" y="4" width="16" height="12" rx="3"/><rect x="7.5" y="12" width="5" height="3.5" rx="0.5" fill="none" stroke-width="0.8"/><line x1="10" y1="12.5" x2="10" y2="15" stroke-width="0.8"/><line x1="8.5" y1="13.75" x2="11.5" y2="13.75" stroke-width="0.8"/>',
  loop:       '<rect x="2" y="4" width="16" height="12" rx="3"/><use href="#refresh" x="7" y="11" width="6" height="6" fill="currentColor"/>',
  // BPMN Gateways
  gatewayExcl: '<path d="M10 2L18 10L10 18L2 10Z"/><path d="M7.5 7.5l5 5M12.5 7.5l-5 5" stroke-width="1.5"/>',
  gatewayPar:  '<path d="M10 2L18 10L10 18L2 10Z"/><line x1="10" y1="6" x2="10" y2="14" stroke-width="1.5"/><line x1="6" y1="10" x2="14" y2="10" stroke-width="1.5"/>',
  gatewayIncl: '<path d="M10 2L18 10L10 18L2 10Z"/><circle cx="10" cy="10" r="3" stroke-width="1.5"/>',
  gatewayEvt:  '<path d="M10 2L18 10L10 18L2 10Z"/><circle cx="10" cy="10" r="3.5" stroke-width="1"/><circle cx="10" cy="10" r="2" stroke-width="1"/>',
  // BPMN other
  dataObject: '<path d="M5 2h7l3 3v13H5z"/><path d="M12 2v3h3"/>',
  poolH:      '<rect x="1" y="4" width="18" height="12" rx="1"/><line x1="5" y1="4" x2="5" y2="16"/>',
  poolV:      '<rect x="1" y="2" width="18" height="16" rx="1"/><line x1="1" y1="6" x2="19" y2="6"/>',
  flowStart:  '<rect x="2" y="5" width="16" height="10" rx="5"/><path d="M8 8l4 2-4 2z" fill="currentColor" stroke="none"/>',
  flowOffPage: '<path d="M4 3h12v8l-6 6-6-6z"/>',
  annotation: '<line x1="2" y1="8" x2="10" y2="8" stroke-width="1" opacity="0.5"/><line x1="2" y1="11" x2="8" y2="11" stroke-width="1" opacity="0.5"/><path d="M18 3 Q14 3 14 6 L14 8.5 Q14 10 12 10 Q14 10 14 11.5 L14 14 Q14 17 18 17" fill="none"/>',
  // Data Model
  dataTable:  '<rect x="2" y="3" width="16" height="14" rx="2"/><rect x="2" y="3" width="16" height="5" rx="2" fill="currentColor" stroke="none" opacity="0.4"/><line x1="5" y1="11" x2="15" y2="11" stroke-width="1" opacity="0.4"/><line x1="5" y1="14" x2="12" y2="14" stroke-width="1" opacity="0.4"/>',
  // Sequence Diagram
  seqParticipant: '<rect x="3" y="2" width="14" height="5" rx="1"/><line x1="10" y1="7" x2="10" y2="18" stroke-dasharray="2 2"/>',
  seqActor:       '<circle cx="10" cy="4" r="2" stroke-width="1.2"/><line x1="10" y1="6" x2="10" y2="11" stroke-width="1.2"/><line x1="7" y1="8" x2="13" y2="8" stroke-width="1.2"/><line x1="10" y1="11" x2="8" y2="13" stroke-width="1.2"/><line x1="10" y1="11" x2="12" y2="13" stroke-width="1.2"/><line x1="10" y1="14" x2="10" y2="18" stroke-dasharray="2 2"/>',
  seqActivation:  '<rect x="8" y="3" width="4" height="14" fill="currentColor" stroke="none" opacity="0.4"/><rect x="8" y="3" width="4" height="14" stroke-width="1"/>',
  seqFragment:    '<rect x="2" y="3" width="16" height="14" rx="1"/><path d="M2 3 L8 3 L9 5 L9 7 L2 7 Z" fill="currentColor" stroke="none" opacity="0.2"/><text x="3" y="6" font-size="3" font-weight="bold" fill="currentColor" stroke="none">loop</text>',
};

// The shared "Generic Shapes" set — IDENTICAL across EVERY diagram type (harmonised v1.17.1), so the same building
// blocks (a plain Node, a Container, a Zone, plus the annotation + connector shapes) are reachable everywhere. The
// type-specific PRIMARY shapes (DataObject, OrgPerson, BPMN tasks, sequence participants, Gantt tasks, …) and the
// Data-Mapping layer Zones live in their OWN categories. Shared by reference: these defs are read-only templates
// (the element factory clones them on drop, never mutates them), so one array is safe across all the *_CATEGORIES.
export const GENERIC_SHAPES = [
  { type: 'sf.SimpleNode',  label: 'Node',       iconName: null, stencilSvg: SVG.node, noCanvasIcon: true },
  { type: 'sf.Container',   label: 'Container',  iconName: null, accentColor: '#1D73C9', stencilSvg: SVG.container },
  { type: 'sf.Zone',        label: 'Zone',       stencilSvg: SVG.zone  },
  { type: 'sf.Note',        label: 'Note',       stencilSvg: SVG.note  },
  { type: 'sf.TextLabel',   label: 'Text',       stencilSvg: SVG.text  },
  { type: 'sf.Annotation',  label: 'Annotation', stencilSvg: SVG.annotation },
  { type: 'sf.Line',        label: 'Line',       stencilSvg: SVG.line  },
  { type: 'sf.Link',        label: 'Link',       url: 'https://', stencilSvg: SVG.link },
  { type: 'sf.Image',       label: 'Image',      stencilSvg: SVG.image, customDrop: 'image' },
  { type: 'df.Pill',        label: 'Pill',       stencilSvg: SVG.pill  },
  { type: 'df.Legend',      label: 'Legend',     stencilSvg: SVG.legend },
  { type: 'df.Table',       label: 'Table',      stencilSvg: SVG.table  },
];

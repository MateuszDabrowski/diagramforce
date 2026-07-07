// Diagram-type registry (CLEANUP S5) — the 7 workspace types (label/short) + their inline SVG glyphs. Pure data
// + a pure switch; zero imports. Shared by tabs.js (tab bar / new-diagram picker) and stencil.js (workspace
// labels), so it lives in a leaf both import without a cycle.

export const DIAGRAM_TYPES = {
  architecture: { label: 'Architecture Diagram', short: 'Architecture' },
  process:      { label: 'Process Diagram',      short: 'Process' },
  sequence:     { label: 'Sequence Diagram',      short: 'Sequence' },
  datamodel:    { label: 'Data Model Diagram',   short: 'Data Model' },
  datamapping:  { label: 'Data Mapping Diagram', short: 'Data Mapping' },
  gantt:        { label: 'Gantt Chart',           short: 'Gantt' },
  org:          { label: 'Org Chart',             short: 'Org Chart' },
};

/** Inline SVG (viewBox 0 0 16 16, currentColor) for a diagram type's glyph — used both on each tab
 *  and in the "+ Diagram" right-click type menu, so they stay identical. */
export function diagramTypeIconMarkup(type) {
  switch (type) {
    case 'process':     return '<circle cx="3" cy="8" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="7" y="5.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="3" cy="8" r="1" fill="currentColor"/><line x1="5.5" y1="8" x2="7" y2="8" stroke="currentColor" stroke-width="1.5"/>';
    case 'sequence':    return '<rect x="1" y="1" width="5" height="3" rx="0.5" fill="currentColor"/><rect x="10" y="1" width="5" height="3" rx="0.5" fill="currentColor"/><line x1="3.5" y1="4" x2="3.5" y2="15" stroke="currentColor" stroke-width="0.8" stroke-dasharray="1.5 1"/><line x1="12.5" y1="4" x2="12.5" y2="15" stroke="currentColor" stroke-width="0.8" stroke-dasharray="1.5 1"/><line x1="3.5" y1="8" x2="12.5" y2="8" stroke="currentColor" stroke-width="1"/><polygon points="12.5,8 10.5,7 10.5,9" fill="currentColor"/><line x1="12.5" y1="12" x2="3.5" y2="12" stroke="currentColor" stroke-width="0.8" stroke-dasharray="1.5 1"/><polygon points="3.5,12 5.5,11 5.5,13" fill="currentColor"/>';
    case 'datamodel':   return '<rect x="1" y="1" width="6" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="1" width="6" height="3" rx="1" fill="currentColor"/><rect x="9" y="7" width="6" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="7" width="6" height="3" rx="1" fill="currentColor"/><path d="M7 5L9 11" stroke="currentColor" stroke-width="1.2" fill="none"/>';
    case 'datamapping': return '<rect x="0.5" y="2" width="5" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="0.5" y="2" width="5" height="3" rx="1" fill="currentColor"/><rect x="10.5" y="2" width="5" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="10.5" y="2" width="5" height="3" rx="1" fill="currentColor"/><path d="M5.5 8 L10 8 M8.5 6.5 L10 8 L8.5 9.5" fill="none" stroke="currentColor" stroke-width="1"/><path d="M5.5 11 L10 11" stroke="currentColor" stroke-width="1" opacity="0.55"/>';
    case 'gantt':       return '<rect x="1" y="2" width="8" height="3" rx="1" fill="currentColor"/><rect x="4" y="7" width="9" height="3" rx="1" fill="currentColor" opacity="0.7"/><rect x="7" y="12" width="6" height="3" rx="1" fill="currentColor" opacity="0.5"/>';
    case 'org':         return '<rect x="5" y="1" width="6" height="4" rx="1" fill="currentColor"/><rect x="0.5" y="10" width="6" height="4" rx="1" fill="currentColor" opacity="0.7"/><rect x="9.5" y="10" width="6" height="4" rx="1" fill="currentColor" opacity="0.7"/><path d="M8 5v2H3.5V10M8 7h4.5V10" stroke="currentColor" stroke-width="1" fill="none"/>';
    // architecture (+ the unknown-type fallback): a merge-FLOW glyph - two components on the left feeding one on
    // the right (systems + integrations), echoing the architecture empty-state. Distinct from the org chart's
    // vertical 1-over-2 hierarchy.
    default:            return '<rect x="0.5" y="1.5" width="5.5" height="4" rx="1" fill="currentColor"/><rect x="0.5" y="10.5" width="5.5" height="4" rx="1" fill="currentColor"/><rect x="10" y="6" width="5.5" height="4" rx="1" fill="currentColor"/><path d="M6 3.5 H8 V8 H10 M6 12.5 H8 V8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>';
  }
}

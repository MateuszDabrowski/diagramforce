// Canonical ER-notation marker path strings — the single source for the SVG `d` of each cardinality / crow's-foot
// endpoint. Zero-dep leaf. Coordinate convention: negative-x = toward the element, positive-x = toward the link
// (see CLAUDE.md "ER Marker Definitions").
//
// These strings are SERIALIZED into saves and share URLs. They must never change value: a new visual is a NEW
// key, never an edit to an existing string, or every diagram already saved with that marker would silently
// change on load. dev/tests/er-markers.test.js freezes them.
//
// Consumers: js/properties.js (the marker picker `markerDefs` + the quick-set `erMarkerDef` presets) and
// js/mermaid-import.js (`erMarkerPath`). Each wraps a `d` in its own def object (the wrapper shapes differ:
// dasharray present/absent, fill per marker) — only the paths are shared. js/canvas/migration.js deliberately
// keeps its OWN legacy literals: those are historical normalisation targets that must stay byte-frozen even if
// this canonical set ever evolves, so they never import from here.
export const ER_MARKER_D = {
  none:      'M 0 0 L -12 0',
  arrow:     'M 0 -6 L -14 0 L 0 6 z',
  lineArrow: 'M 0 -6 L -14 0 L 0 6',
  one:       'M -12 -8 L -12 8 M -12 0 L 0 0',
  zeroOne:   'M 2 0 a 5 5 0 1 1 -10 0 a 5 5 0 1 1 10 0 Z M -8 0 L -12 0 M -12 -8 L -12 8',
  many:      'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0',
  oneMany:   'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0 M 3 -8 L 3 8',
  zeroMany:  'M 4 0 a 5 5 0 1 1 10 0 a 5 5 0 1 1 -10 0 Z M -12 -8 L 0 0 M 0 0 L -12 8 M 0 0 L -12 0',
};

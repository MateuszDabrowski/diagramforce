// Canvas module — manages the JointJS graph and paper
// Provides pan (drag blank area), zoom (mouse wheel + ctrl), grid

import { cctx } from './canvas/context.js?v=1.17.2.11';
import { registerSfRouter } from './canvas/router.js?v=1.17.2.11';
// The router reads the connector-grouping flag via cctx; wire it at module-eval
// (isConnectorGroupingEnabled is a hoisted function declaration below).
cctx.isConnectorGroupingEnabled = isConnectorGroupingEnabled;
// Phase 4 Slice 3: auto-layout domain extracted to ./canvas/auto-layout.js
export { autoLayout, applyDataMappingLayout, analyzeSequenceLayout, applySequenceAutoLayout } from './canvas/auto-layout.js?v=1.17.2.11';
// Phase 4 Slice 4: migration fixups extracted to ./canvas/migration.js
export { migrateLinks, updateSimpleNodeLayout, updateDataObjectHeaderLayout, updateNoteIconLayout, migrateNodes } from './canvas/migration.js?v=1.17.2.11';
// Phase 4 Slice 5: crossing-bump calculation extracted to ./canvas/crossing-bumps.js
import { initCrossingBumps, getBumpLayer } from './canvas/crossing-bumps.js?v=1.17.2.11';
export { isCrossingBumpsEnabled, setCrossingBumpsEnabled } from './canvas/crossing-bumps.js?v=1.17.2.11';
// Phase 4 Slice 6: viewport domain (zoom / pan / grid / get-set) extracted to ./canvas/viewport.js.
// getGridColor is used by the initial paper setup below; registerViewportControls
// is the bridge called in init(); the rest are re-exported unchanged for backward
// compat (toolbar/keyboard/tabs/persistence call them via the canvas facade).
import { registerViewportControls, getGridColor } from './canvas/viewport.js?v=1.17.2.11';
export { zoomIn, zoomOut, fitContent, toggleGrid, refreshGrid, getViewport, setViewport } from './canvas/viewport.js?v=1.17.2.11';
// Phase 4 Slices 7-9 — the "Leaf Purge": non-interactive side-effect leaves.
// line-style + external-labels init functions are imported (called in init());
// startLineStyleOverlays + the mobile pair were public exports, so re-export them
// to keep canvas.js's export boundary stable (app.js / properties.js import them).
import { startLineStyleOverlays } from './canvas/line-style.js?v=1.17.2.11';
import { initExternalLabelAutoplace } from './canvas/external-labels.js?v=1.17.2.11';
export { startLineStyleOverlays };
export { initMobileDragHandles, syncMobilePanelHeight } from './canvas/mobile.js?v=1.17.2.11';
// Phase 4 Slice 10: link hover/focus tinting extracted to ./canvas/selection-viz.js.
// Export-neutral (all internal) — registerSelectionViz(cctx) is called in init()
// after the cctx block; the tinting bridges to crossing-bumps via getBumpLayer().
import { registerSelectionViz } from './canvas/selection-viz.js?v=1.17.2.11';
// Phase 4 Slice 11: spacing/alignment guides extracted to ./canvas/spacing-guides.js.
// Export-neutral; registerSpacingGuides(cctx) is called in init() after the cctx
// block. The element:pointerup activation-lifeline snap stays here (its own listener).
import { registerSpacingGuides } from './canvas/spacing-guides.js?v=1.17.2.11';
// Phase 4 Slice 12 (finale): embedding mechanics extracted to ./canvas/embedding.js.
// canEmbed + findEmbeddingParent feed the paper's embeddingMode config below;
// registerEmbedding(cctx) mounts the 4 auto-fit graph triggers post-hydration.
// The 4 public entry points are re-exported (stencil.js/properties.js/toolbar.js).
import { canEmbed, findEmbeddingParent, registerEmbedding } from './canvas/embedding.js?v=1.17.2.11';
export { canEmbed };
import { deriveGanttDates } from './canvas/gantt-layout.js?v=1.17.2.11';
export { isAutoSizingEnabled, setAutoSizingEnabled, refitAllParents, findHaloParent, tuckChildInside, showDropGhost, hideDropGhost, setDragSelectionBBox } from './canvas/embedding.js?v=1.17.2.11';

// ── Data Cloud mapping links ─────────────────────────────────────────
// A field→field link drawn while mapping mode is on is a source→DMO mapping
// (distinct from a PK→FK ER relationship): tagged linkKind:'mapping' with a
// distinct colour + a single direction arrow. mappingModeGetter is wired from
// app.js (reads the active tab's mapping mode). applyMappingLinkStyle is shared
// with properties.js (panel reclassify).
let mappingModeGetter = null;
export function setMappingModeGetter(fn) { mappingModeGetter = fn; }

const MAPPING_LINK_COLOR = '#F6B355'; // brand amber/accent — distinguishes mappings from grey ER links

// Router for Data Cloud mapping links: a short horizontal stub off each field port
// (left ports exit left, right ports exit right) so the line leaves and arrives
// perpendicular to the object edge and never runs parallel to (or hugs) it. The
// smooth connector then rounds the diagonal between the two stubs. Registered
// globally so the name resolves for both freshly-drawn and loaded (migrated) links.
joint.routers.sfMappingRouter = function (vertices, opt, linkView) {
  const STUB = 48;   // longer perpendicular stub — leaves room for the mapping-type badge
  const sa = linkView.sourceAnchor;
  const ta = linkView.targetAnchor;
  if (!sa || !ta) return vertices || [];
  const sPort = String(linkView.model.get('source')?.port || '');
  const tPort = String(linkView.model.get('target')?.port || '');
  const sDir = sPort.startsWith('field-left-') ? -1 : 1;
  // Target side: a real field port uses its own side. A FLOATING target (mid-drag, no
  // port yet) mirrors the source so the preview arrow points the way the line EXITS the
  // source — source on a left port → arrow points left; right port → arrow points right
  // (instead of always forcing it left).
  const tHasFieldPort = tPort.startsWith('field-');
  const tDir = tHasFieldPort ? (tPort.startsWith('field-left-') ? -1 : 1) : -sDir;
  const route = [{ x: sa.x + sDir * STUB, y: sa.y }];
  if (vertices && vertices.length) route.push(...vertices);
  route.push({ x: ta.x + tDir * STUB, y: ta.y });
  return route;
};

// Connector for mapping links: a STRAIGHT horizontal stub off each port (which
// guarantees a true perpendicular entry/exit that never runs parallel to the edge —
// a plain smooth connector rounds the stub away and lets the line approach at an
// angle), then a cubic bézier with horizontal control handles smoothing the diagonal
// between the two stub ends. Reads the stub points sfMappingRouter produced.
joint.connectors.sfMappingConnector = function (sourcePoint, targetPoint, route) {
  const s = sourcePoint, t = targetPoint;
  if (!route || route.length < 2) return `M ${s.x} ${s.y} L ${t.x} ${t.y}`;
  const s2 = route[0];                    // source stub end
  const t2 = route[route.length - 1];     // target stub end
  const sDir = Math.sign(s2.x - s.x) || 1;
  const tDir = Math.sign(t2.x - t.x) || -1;
  const h = Math.max(30, Math.abs(t2.x - s2.x) * 0.5);
  const c1x = s2.x + sDir * h, c2x = t2.x + tDir * h;
  return `M ${s.x} ${s.y} L ${s2.x} ${s2.y} C ${c1x} ${s2.y} ${c2x} ${t2.y} ${t2.x} ${t2.y} L ${t.x} ${t.y}`;
};

export function applyMappingLinkStyle(link) {
  // Clear any existing markers FIRST. `cell.attr(path, obj)` MERGES, so without this a
  // marker left over from the relationship style (fill:'none', stroke:#888) would bleed
  // into the new arrow — producing a hollow, grey-bordered arrowhead that ignores the
  // line colour when a link is switched relationship → mapping.
  link.removeAttr('line/sourceMarker');
  link.removeAttr('line/targetMarker');
  link.attr('line/stroke', MAPPING_LINK_COLOR);
  // Thin (1px) — mapping links read as light reference lines (like the Data Cloud
  // canvas), not heavy ER relationships. The default standard.Link stroke is 2px.
  link.attr('line/strokeWidth', 1);
  // Directional: target arrow (no explicit fill/stroke → auto-inherits the line
  // colour, per the marker convention); plain source stub.
  link.attr('line/targetMarker', { type: 'path', d: 'M 0 -6 L -14 0 L 0 6 z' });
  link.attr('line/sourceMarker', { type: 'path', d: 'M 0 0 L -12 0', fill: 'none', stroke: MAPPING_LINK_COLOR, 'stroke-width': 1 });
  // sfMappingRouter adds a short horizontal stub off each field port so the line
  // exits/enters perpendicular and never runs parallel to (or hugs) the object
  // edge; the smooth connector rounds the diagonal between the two stubs.
  link.router({ name: 'sfMappingRouter' });
  link.connector('sfMappingConnector');
  // Pin to the field-port anchor with a small outward offset (12px): the line reads
  // as landing on its specific port, the entry is a clean 90°, and the arrow tip
  // sits right at the object edge (~2px in) instead of diving over the field text.
  link.prop('source/connectionPoint', { name: 'anchor', args: { offset: 12 } });
  link.prop('target/connectionPoint', { name: 'anchor', args: { offset: 12 } });
  // Data Cloud transform classification — default a fresh mapping to 'Standard'
  // (direct copy) without clobbering an existing Formula/Calculated choice. The
  // table view's MAPPING TYPE column and the link inspector picker both read it.
  if (!link.prop('mappingType')) link.prop('mappingType', 'Standard');
  syncMappingTypeBadge(link);
}

// Short codes shown as a small badge on the connector's TARGET stub when a mapping
// uses anything other than a direct (Standard) copy — surfaces non-trivial transforms
// on the canvas where they'd otherwise hide behind overlapping parallel lines.
// Standard (direct copy) gets NO token — only non-direct transforms are flagged, so a
// mix of Standard + transform mappings into one field reads cleanly.
export const MAPPING_TYPE_CODE = {
  'Formula': 'F',
  'Streaming Transform': 'ST',
  'Batch Transform': 'BT',
  'Calculated Insight': 'CI',
};
// A type-code badge label is distinguished from a user label by its `badgeBox` selector.
const isMappingTypeBadge = l => !!(l && l.attrs && l.attrs.badgeBox);

// `color` is the connector's own line stroke, so the badge reads as part of the line:
// a canvas-coloured (effectively transparent) fill that masks the line behind the
// letters, a 1px border in the connector colour, and the code in the same colour.
// `tooltip` becomes an SVG <title> child so resting the pointer on the small F/CI/ST/BT
// token reveals the full mapping type + its Expression / Rule (the browser's own
// hover-intent delay means a quick mouse-through doesn't trigger it) — a fast way to read
// a transform's rule without opening the inspector.
function mappingTypeBadgeLabel(code, color, tooltip) {
  return {
    markup: [
      { tagName: 'title', selector: 'badgeTitle' },
      { tagName: 'rect', selector: 'badgeBox' },
      { tagName: 'text', selector: 'badgeText' },
    ],
    attrs: {
      badgeTitle: { text: tooltip || code },
      badgeText: { text: code, fill: color, fontSize: 9, fontWeight: 700, fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', textAnchor: 'middle', textVerticalAnchor: 'middle' },
      badgeBox: { ref: 'badgeText', refWidth: 10, refHeight: 6, refX: -5, refY: -3, fill: 'var(--bg-canvas, #FFFFFF)', stroke: color, 'stroke-width': 1, rx: 3, ry: 3 },
    },
    // Negative distance measures back from the TARGET end; -20 px lands on the straight
    // target stub (48 px router stub − 12 px connectionPoint offset = 36 px of stub),
    // close to the target object and clear of the bézier bend.
    position: { distance: -20, offset: 0 },
  };
}

// Ensure a mapping link's labels reflect its `mappingType`: keep any user label, and
// add (non-Standard) or remove (Standard) the type-code badge on the target stub, tinted
// to the connector's own colour. Idempotent — safe to call on every change / (re)styling.
export function syncMappingTypeBadge(link) {
  // Default an unset type to 'Standard' so every mapping link shows a token ('S' by
  // default), matching the table view's mappingType fallback.
  const type = link.prop('mappingType') || 'Standard';
  const code = MAPPING_TYPE_CODE[type];
  const userLabel = (link.labels() || []).find(l => !isMappingTypeBadge(l));
  const arr = [];
  if (userLabel) arr.push(userLabel);
  if (code) {
    // Hover tooltip: full type name + the Expression / Rule when one is set.
    const rule = (link.prop('expressionRule') || '').trim();
    const tooltip = rule ? `${type}: ${rule}` : type;
    arr.push(mappingTypeBadgeLabel(code, link.attr('line/stroke') || MAPPING_LINK_COLOR, tooltip));
  }
  // Idempotent: skip the set when nothing changes — avoids spurious change:labels
  // (history churn on load, redundant re-renders).
  if (JSON.stringify(link.labels() || []) === JSON.stringify(arr)) return;
  link.labels(arr);
}

// ── Architecture connection-frequency overlay ──────────────────────────────
// A secondary link label (small clock icon + muted text, e.g. "Nightly") rendered
// clear of the connector line. The `connectionFrequency` cell prop is the single
// source of truth; this label is a derived view, identified by its `freqText`
// selector. Colour is a fixed neutral grey (#888) — legible on both light and dark
// canvases, so it needs no per-theme regeneration (unlike a baked theme token).
const FREQ_LABEL_COLOR = '#888888';
const isFrequencyLabel = l => !!(l && l.attrs && l.attrs.freqText);
// The frequency overlay SHARES the user label's `position` (so the two move as one draggable block,
// v1.16.1) and bakes its vertical separation into the markup instead — `freqText.y` draws the icon+text
// combo ~22px BELOW the shared anchor (screen-down, since labels aren't rotated), keeping it clear of the
// on-line user label regardless of segment orientation. `position` is the user label's current position
// (defaults to the midpoint when there's no user label / it was never dragged).
function frequencyLabelSpec(text, position, color = FREQ_LABEL_COLOR, fontSize = 11) {
  return {
    markup: [
      { tagName: 'rect', selector: 'freqBg' },
      { tagName: 'image', selector: 'clockIcon' },
      { tagName: 'text', selector: 'freqText' },
    ],
    attrs: {
      // Canvas-coloured mask behind the combo so the connector line BREAKS behind the overlay
      // (same trick as the user label's body rect) — crucial on a vertical segment where the
      // line would otherwise run straight through the text. Wraps the whole icon+text combo
      // with a small symmetric pad. Rendered first in markup → sits behind icon + text.
      freqBg: {
        ref: 'freqText', refWidth: 24, refHeight: 4, refX: -20, refY: -2,
        fill: 'var(--bg-canvas, #FFFFFF)', stroke: 'none', rx: 2, ry: 2,
        'pointer-events': 'none',
      },
      // Text is middle-anchored and nudged right by half the icon footprint (8px), and the
      // icon is pinned to the text's LEFT edge via `ref` — so the icon+text combo is exactly
      // CENTERED on the link anchor for any text length. `y: 22` drops it below the user label.
      // Rendered at 24px for crispness, shown at 12px. Empty href degrades to text-only.
      // pointer-events:none so the label never blocks the link's own drag/select hit area.
      freqText: {
        text, fill: color, fontSize, fontWeight: 500,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        textAnchor: 'middle', textVerticalAnchor: 'middle', x: 8, y: 22,
        'pointer-events': 'none',
      },
      clockIcon: {
        href: _iconDataUriFn ? _iconDataUriFn('clock', color, 24) : '',
        width: 12, height: 12, ref: 'freqText', refX: 0, x: -16, refY: 0.5, y: -6,
        'pointer-events': 'none',
      },
    },
    // Clone the user label's position so the overlay tracks it (moves together as one block). A deep
    // clone keeps the two label objects from sharing a mutable reference.
    position: position ? JSON.parse(JSON.stringify(position)) : { distance: 0.5, offset: 0 },
  };
}
// Ensure a link's labels reflect its `connectionFrequency`: keep every non-frequency
// label (the user label + any mapping badge), then append the clock+text label when
// the prop is non-empty (remove it when blank). Idempotent — safe on every change/load.
export function syncFrequencyLabel(link) {
  const freq = (link.prop('connectionFrequency') || '').trim();
  const labels = link.labels() || [];
  const kept = labels.filter(l => !isFrequencyLabel(l));
  // Glue the overlay to the USER label's position (the on-line text label, not the F/ST/BT/CI type badge)
  // so dragging the label drags the frequency with it. No user label → ride the midpoint.
  const userLabel = kept.find(l => !isMappingTypeBadge(l));
  // Connector font colour (v1.16.1) drives the freq text + clock; falls back to the neutral grey.
  const color = link.prop('fontColor') || FREQ_LABEL_COLOR;
  // Frequency text reads ~2px smaller than the user label (tracks Font size changes); floored at 8.
  const freqSize = Math.max(8, (userLabel?.attrs?.text?.fontSize ?? 13) - 2);
  const arr = freq ? [...kept, frequencyLabelSpec(freq, userLabel?.position, color, freqSize)] : kept;
  if (JSON.stringify(labels) === JSON.stringify(arr)) return;
  link.labels(arr);
}

// Revert a link to plain ER-relationship styling (used when the panel reclassifies
// a mapping back to a relationship): grey, orthogonal sfManhattan routing, plain
// stub ends (the user re-picks cardinality markers as needed).
export function applyRelationshipLinkStyle(link) {
  // Relationship connectors default to 2px — heavier than Data Mapping's thin 1px
  // reference lines — so the type switch reads as a real change. The "None" stub ends
  // track that width so neither end is thicker/thinner than the line. Clear markers first
  // (attr merges) so a mapping arrow's path can't survive underneath the new stub.
  const sw = 2;
  link.removeAttr('line/sourceMarker');
  link.removeAttr('line/targetMarker');
  link.attr('line/stroke', '#888888');
  link.attr('line/strokeWidth', sw);
  link.attr('line/targetMarker', { type: 'path', d: 'M 0 0 L -12 0', fill: 'none', stroke: '#888888', 'stroke-width': sw });
  link.attr('line/sourceMarker', { type: 'path', d: 'M 0 0 L -12 0', fill: 'none', stroke: '#888888', 'stroke-width': sw });
  link.router({ name: 'sfManhattan' });
  link.connector('rounded', { radius: 8 });
  // Restore the default connection-point offset (only mapping links pin to the port anchor).
  link.removeProp('source/connectionPoint');
  link.removeProp('target/connectionPoint');
}


// ── Object-relationship (ER) link visibility — the Data Mapping "Object Relationships"
// Display toggle. A pure VIEW filter (never persisted, never mutates the model): hides
// every ER relationship link (linkKind !== 'mapping') so architects can audit field-level
// mapping curves without the header-level relationship lines. Default ON (visible). Reset
// to visible on tab change by the toolbar; a fresh tab load renders all links visible.
let objectRelsVisible = true;
export function isObjectRelationshipsVisible() { return objectRelsVisible; }
export function setObjectRelationshipsVisible(v) {
  objectRelsVisible = v !== false;
  applyObjectRelsVisibility();
}
function applyObjectRelsVisibility() {
  if (!graph || !paper) return;
  for (const link of graph.getLinks()) {
    if (link.prop('linkKind') === 'mapping') continue;   // mapping curves always show
    const view = paper.findViewByModel(link);
    if (view?.el) view.el.style.display = objectRelsVisible ? '' : 'none';
  }
}

// ── Z-order tiers ────────────────────────────────────────────────────
// Rendering layer — higher z = closer to the viewer.
// Order (bottom → top):  Zone → Container → Node/Label → Link
//
//   Zone      :    0 –  499   (500 slots for within-zone ordering)
//   Container : 1000 – 1499
//   Node/Label: 2000 – 2499
//   Link      : 3000+
//
// NOTE: sorting must be APPROX (not EXACT). In @joint/core 4.0.4 the
// EXACT sort method (sortLayerViews) is missing, so EXACT silently falls
// back to insertion order.  APPROX inserts each view at the correct
// z-sorted DOM position and also re-sorts on cell.set('z') changes.
//
// IMPORTANT: z assignment uses an explicit isLoadingJSON guard so that
// graph.fromJSON() never clobbers saved z values on reload.
export const Z_BASE = {
  'sf.Zone':           0,
  'sf.TaskGroup':      0,   // RACI section grouper — Zone tier, behind its embedded Tasks (500)
  'sf.BpmnPool':       0,
  'sf.Container':      1000,
  'sf.BpmnSubprocess': 500,
  'sf.BpmnLoop':       500,
  'sf.Task':           500,   // RACI card — embeds Person(2000)/Team(1000), so it MUST stay below them. Without a tier entry the change:z listener let JointJS's drag toFront() strand it on top, "eating" its cards.
  'sf.SimpleNode':     2000,
  'sf.TextLabel':      2000,
  'sf.Line':           2000,
  'sf.Note':           2000,
  'sf.BpmnEvent':      2000,
  'sf.BpmnTask':       2000,
  'sf.BpmnGateway':    2000,
  'sf.BpmnDataObject': 2000,
  'sf.FlowProcess':    2000,
  'sf.FlowDecision':   2000,
  'sf.FlowTerminator': 2000,
  'sf.FlowDatabase':   2000,
  'sf.FlowDocument':   2000,
  'sf.FlowIO':         2000,
  'sf.FlowPredefined': 2000,
  'sf.FlowOffPage':    2000,
  'sf.Annotation':     2000,
  'sf.DataObject':     2000,
  'sf.GanttTask':      2000,
  'sf.GanttMilestone': 2000,
  'sf.GanttMarker':    2000,
  'sf.GanttTimeline':  1000,
  'sf.GanttGroup':     1000,
  'sf.OrgPerson':      2000,
  'sf.SequenceFragment':    500,   // subprocess tier — groups messages
  'sf.SequenceParticipant': 2000,  // node tier — participants + lifelines
  'sf.SequenceActor':       2000,
  'sf.SequenceActivation':  2200,  // above participant lifeline, below links
};
export const Z_TIER_SPAN = 499;   // 500 slots per tier (0–499 relative to base)
export const Z_LINK_BASE  = 3000;

// Plain-language tier names used by the property-panel reorder controls.
// One source of truth so per-renderer call sites don't have to memorise the
// "Node layer" / "Container layer" / "Zone layer" jargon (which also drifted
// inconsistent — sf.BpmnSubprocess and sf.BpmnLoop sit in the same z-tier
// but had different labels in properties.js). Grouping:
//   z <   500  → "backgrounds"   (Zone, BpmnPool)
//   z <  2000  → "containers"    (Container, BpmnSubprocess, BpmnLoop,
//                                 SequenceFragment, GanttTimeline, GanttGroup)
//   z >= 2000  → "shapes"        (every regular cell — SimpleNode, Note,
//                                 BpmnTask, OrgPerson, DataObject, etc.)
export function tierNameForType(type) {
  const base = Z_BASE[type] ?? 2000;
  if (base < 500) return 'backgrounds';
  if (base < 2000) return 'containers';
  return 'shapes';
}

// JSON-load guard, set around every graph.fromJSON() call (by persistence's
// json-pipeline/storage, tabs.js, and mermaid-import) so the 'add' listener skips
// z-assignment and preserves the saved values.
//
// SYNC CONTRACT: `_isLoadingJSON` (the private flag, read by the many in-canvas
//   guards below) and `cctx.isLoadingJSON` (the mirror, read by the extracted
//   external-labels + embedding sub-modules that can't see this module's closure)
//   are deliberately written TOGETHER in setLoadingJSON(). This explicit dual-write
//   is the chosen design — do NOT desync them or build an event bus for one boolean.
let _isLoadingJSON = false;
cctx.isLoadingJSON = false; // mirror for the extracted sub-module load guards (Slice 9)
export function setLoadingJSON(v) { _isLoadingJSON = v; cctx.isLoadingJSON = v; }
export function isLoadingJSON() { return _isLoadingJSON; }

// Auto-sizing toggle (isAutoSizingEnabled/setAutoSizingEnabled) + refitAllParents
// moved to ./canvas/embedding.js (Slice 12); re-exported from the facade above.

// ── Connector grouping toggle (v1.11.10 — CR-5.1) ───────────────────
// When enabled, links that crowd the same physical port (same cell + port)
// are bundled into shared "trunks" by the sfManhattan router. Links are
// grouped by visual semantics at that port (lineStyle + marker shape on the
// touching end); each distinct semantic group gets its own offset trunk lane,
// so e.g. dashed crow's-foot links and solid arrows on one port read as two
// parallel trunks instead of a tangle. Purely presentation — the graph data
// model is untouched. Default OFF to preserve existing visuals. Persisted in
// localStorage, mirroring the Auto-Sizing toggle. The Display menu drives this
// via setConnectorGroupingEnabled(); flipping it re-routes every link.
const CONNECTOR_GROUP_LS_KEY = 'sfdiag::connectorGrouping';
// Default ON — distributed connectors visually separate parallel links into
// distinct trunks along the cell edge and make multi-relationship diagrams
// (ER, architecture) much easier to read. An explicit user opt-out is the
// only reason this returns false. Existing users with a prior choice keep it.
export function isConnectorGroupingEnabled() {
  try {
    const v = localStorage.getItem(CONNECTOR_GROUP_LS_KEY);
    if (v === null) return true;            // never set → default ON
    return v === 'true';                    // explicit user choice wins
  } catch { return true; }
}
export function setConnectorGroupingEnabled(v) {
  try { localStorage.setItem(CONNECTOR_GROUP_LS_KEY, String(!!v)); } catch {}
}


// ── Focus dimming toggle (v1.12.4) ──────────────────────────────────
// When the user selects an element, everything not directly connected
// to it is dimmed so the focus highlight reads at a glance. That's the
// behaviour most people want — but in dense diagrams users sometimes
// just want to inspect / drag a single shape without the rest of the
// canvas fading. This toggle lets them opt out. Default ON. The Display
// menu drives it via setFocusDimmingEnabled(); selection.js consults
// isFocusDimmingEnabled() inside updateLinkDimming and short-circuits
// when off, also clearing any lingering dim classes.
const FOCUS_DIMMING_LS_KEY = 'sfdiag::focusDimming';
export function isFocusDimmingEnabled() {
  try {
    const v = localStorage.getItem(FOCUS_DIMMING_LS_KEY);
    if (v === null) return true;            // never set → default ON
    return v === 'true';                    // explicit user choice wins
  } catch { return true; }
}
export function setFocusDimmingEnabled(v) {
  try { localStorage.setItem(FOCUS_DIMMING_LS_KEY, String(!!v)); } catch {}
}

// Synchronously re-run the router on every link in the active graph. Used by
// the toolbar so toggling connector grouping applies instantly. LinkView.update()
// recomputes the route (re-invoking sfManhattan) and repaints in place.
// After every re-route the crossing-bump overlay needs to recompute too —
// linkView.update() doesn't always trigger `paper.on('render:done')`, so
// the bumps would otherwise stay anchored to stale route coordinates and
// either float in empty space (where the old route used to cross) or
// stop showing at the new crossing points.
export function rerouteAllLinks() {
  if (!graph || !paper) return;
  graph.getLinks().forEach(l => {
    const lv = paper.findViewByModel(l);
    lv?.update?.();
  });
  cctx.scheduleCrossingBumpRecompute?.();
}

let graph, paper;
// Viewport state (currentZoom, ZOOM_MIN/MAX/STEP, isPanning, panStart, gridVisible)
// + the pan/zoom/grid handlers moved to ./canvas/viewport.js (Phase 4, Slice 6).

// getGridColor() moved to ./canvas/viewport.js (Slice 6) — imported above for
// the initial paper drawGrid config below.

// canEmbed (the embedding-rules single source of truth) + findEmbeddingParent
// moved to ./canvas/embedding.js (Slice 12); imported above and fed into the
// paper's validateEmbedding/findParentBy config. canEmbed re-exported.

// Perpendicular-exit orthogonal router with obstacle avoidance.
// Guarantees a 32px stub out from each port before routing, and never crosses
// non-endpoint elements. Falls back to JointJS manhattan when port info is unavailable.


export function init() {
  registerSfRouter();
  graph = new joint.dia.Graph({}, { cellNamespace: joint.shapes });

  // ── Z-order tier management ──────────────────────────────────────
  // Each element type lives in its own numeric tier so that the paper's
  // EXACT z-sort always keeps: Zones < Containers < Nodes/Labels < Links
  //
  // When a NEW element is dropped (its z === the tier base, i.e. a freshly
  // instantiated shape), we push it to max+1 within the tier so that each
  // successive drop lands on top of its peers.
  // When loading from JSON every cell already carries its saved z value
  // (which differs from base unless it was the very first of its kind),
  // so the listener leaves it untouched.
  graph.on('add', (cell) => {
    // When restoring from JSON every cell already carries its correct saved z —
    // skip all reassignment so we never clobber the persisted layer order.
    if (_isLoadingJSON) return;

    if (cell.isLink()) {
      // Always push new links to the top of the link tier
      const maxLinkZ = graph.getLinks()
        .filter(l => l !== cell)
        .reduce((m, l) => Math.max(m, l.get('z') ?? Z_LINK_BASE), Z_LINK_BASE - 1);
      cell.set('z', maxLinkZ + 1);
      return;
    }

    if (!cell.isElement()) return;
    const base = Z_BASE[cell.get('type')];
    if (base === undefined) return;

    // Unconditionally assign the correct tier z for every freshly dropped element.
    // (The _isLoadingJSON guard above already protects JSON-restored cells.)
    const sameTier = graph.getElements().filter(
      el => el !== cell && el.get('z') >= base && el.get('z') < base + Z_TIER_SPAN
    );
    const nextZ = sameTier.length > 0
      ? Math.max(...sameTier.map(el => el.get('z') ?? base)) + 1
      : base;
    cell.set('z', nextZ);
  });

  // ── Z-tier enforcement on any z change ──────────────────────────────
  // JointJS calls element.toFront() during drag when embeddingMode is on
  // (inside prepareEmbedding), which pushes the element above all others.
  // This listener restores the previous z so that dragging never reorders.
  graph.on('change:z', (cell) => {
    if (_isLoadingJSON) return;
    if (cell.isLink()) {
      const z = cell.get('z');
      if (z >= Z_LINK_BASE) return; // already in link tier
      // Restore previous z if it was valid, otherwise assign top of link tier
      const prevZ = cell.previous('z');
      if (prevZ != null && prevZ >= Z_LINK_BASE) {
        cell.set('z', prevZ);
      } else {
        const maxLinkZ = graph.getLinks()
          .filter(l => l !== cell)
          .reduce((m, l) => Math.max(m, l.get('z') ?? Z_LINK_BASE), Z_LINK_BASE - 1);
        cell.set('z', maxLinkZ + 1);
      }
      return;
    }
    if (!cell.isElement()) return;
    const base = Z_BASE[cell.get('type')];
    if (base === undefined) return;
    const z = cell.get('z');
    if (z >= base && z < base + Z_TIER_SPAN) return; // already in tier
    // Restore previous z if it was within this tier (drag didn't intend reorder)
    const prevZ = cell.previous('z');
    if (prevZ != null && prevZ >= base && prevZ < base + Z_TIER_SPAN) {
      cell.set('z', prevZ);
      return;
    }
    // Otherwise push to top of correct tier (e.g. type conversion)
    const sameTier = graph.getElements().filter(
      el => el !== cell && el.get('z') >= base && el.get('z') < base + Z_TIER_SPAN
    );
    const nextZ = sameTier.length > 0
      ? Math.max(...sameTier.map(el => el.get('z') ?? base)) + 1
      : base;
    cell.set('z', nextZ);
  });

  // ── Sequence Participant: keep bottom mirror in sync with top header ──
  // Whenever the top label text, header fill or accent changes, mirror the
  // update onto the bottom header so the two stay consistent. Skipped during
  // diagram load — migrateNodes handles that case in one pass.
  graph.on('change:attrs', (cell) => {
    if (_isLoadingJSON) return;
    if (!cell.isElement()) return;
    if (cell.get('type') !== 'sf.SequenceParticipant') return;
    joint.shapes.sf.syncParticipantBottomLabel?.(cell);
  });

  paper = new joint.dia.Paper({
    el: document.getElementById('paper'),
    model: graph,
    width: '100%',
    height: '100%',
    gridSize: 4,
    drawGrid: { name: 'dot', args: { color: getGridColor(), scaleFactor: 4 } },
    background: { color: 'transparent' },
    async: true,
    sorting: joint.dia.Paper.sorting.APPROX,  // z-based insertion order
    // Render ALL link labels in the dedicated labels layer (above the cells layer) so
    // they're never occluded by an overlapping connector drawn later — notably the
    // Data Cloud mapping-type code badges, which sit on busy, overlapping stubs.
    labelsLayer: true,
    cellViewNamespace: joint.shapes,

    // Default link when dragging from a port. The PREVIEW style is chosen from the
    // SOURCE port's role so the live drag matches the link it will become:
    //   • a square FIELD (mapping) port, in mapping mode → amber bézier (sfMappingRouter/
    //     Connector) — the mapping look from the first pointermove (not relationship-then-
    //     flip-on-drop).
    //   • any round RELATIONSHIP port (top/bottom/er-*, or a field port in Data Model) →
    //     grey orthogonal sfManhattan — the custom router used everywhere else.
    defaultLink: (cellView, magnet) => {
      let sourceIsMappingPort = false, sourcePortGroup = '';
      try {
        const portId = magnet && cellView?.findAttribute?.('port', magnet);
        sourcePortGroup = (portId && cellView.model.getPort?.(portId)?.group) || '';
        const isField = sourcePortGroup === 'fieldLeft' || sourcePortGroup === 'fieldRight';
        sourceIsMappingPort = isField && !!(mappingModeGetter && mappingModeGetter());
      } catch { /* fall through to the relationship preview */ }

      if (sourceIsMappingPort) {
        // Mapping bézier preview (amber). The arrow direction follows the SOURCE side
        // via sfMappingRouter's floating-target handling (see router note there).
        const link = new joint.shapes.standard.Link({ z: 0 });
        link.attr('line/stroke', MAPPING_LINK_COLOR);
        link.attr('line/strokeWidth', 1);
        link.attr('line/targetMarker', { type: 'path', d: 'M 0 -6 L -14 0 L 0 6 z' });
        link.attr('line/sourceMarker', { type: 'path', d: 'M 0 0 L -12 0', fill: 'none', stroke: MAPPING_LINK_COLOR, 'stroke-width': 1 });
        link.router({ name: 'sfMappingRouter' });
        link.connector('sfMappingConnector');
        link.prop('source/connectionPoint', { name: 'anchor', args: { offset: 12 } });
        return link;
      }

      // Relationship preview (grey, orthogonal sfManhattan — the custom router).
      return new joint.shapes.standard.Link({
        z: 0,  // 0 triggers the 'add' listener to place it in the link tier (30 000+)
        attrs: {
          line: {
            stroke: '#888888',
            strokeWidth: 2,
            sourceMarker: { type: 'path', d: 'M 0 0 L -12 0', fill: 'none', stroke: '#888888', 'stroke-width': 2, 'stroke-dasharray': 'none' },
            targetMarker: { type: 'path', d: 'M 0 -6 L -14 0 L 0 6 z', 'stroke-dasharray': 'none' },
          },
        },
        router: { name: 'sfManhattan' },
        connector: { name: 'rounded', args: { radius: 8 } },
      });
    },

    defaultConnectionPoint: { name: 'sfConnectionPoint', args: { offset: 16 } },

    validateConnection: (cellViewS, magnetS, cellViewT, magnetT, end) => {
      // Allow self-connection when the two magnets (ports) are different —
      // useful for sequence diagram self-calls and data-model self-joins.
      // Block only when the user tries to connect the exact same port.
      if (cellViewS === cellViewT && magnetS && magnetT && magnetS === magnetT) return false;
      // When dragging source arrowhead, validate the source magnet
      if (end === 'source') {
        if (!magnetS) return false;
        return magnetS.getAttribute('magnet') === 'true';
      }
      // When dragging target arrowhead, validate the target magnet
      if (!magnetT) return false;
      return magnetT.getAttribute('magnet') === 'true';
    },

    validateMagnet: (cellView, magnet) => {
      return magnet.getAttribute('magnet') === 'true';
    },

    snapLinks: { radius: 30 },
    markAvailable: true,
    // Embedding highlight OFF (v1.14.1) — the dashed drop-ghost (embedding.js
    // showDropGhost) is now the capture affordance, so suppress JointJS's default
    // stroke-around-the-parent (the solid bordered halo with the padding gap).
    // The linking highlighters (default + magnet/element availability) are
    // restated verbatim so they survive replacing the highlighting object.
    highlighting: {
      default: { name: 'stroke', options: { padding: 3 } },
      magnetAvailability: { name: 'addClass', options: { className: 'available-magnet' } },
      elementAvailability: { name: 'addClass', options: { className: 'available-cell' } },
      embedding: false,
    },

    // Embedding: children snap inside container-like parents
    embeddingMode: true,
    frontParentOnEmbed: false,
    // Slice 12: candidate lookup + rule check delegate to ./canvas/embedding.js
    // (imported). Both run at drag time, when cctx.graph is live.
    findParentBy: findEmbeddingParent,
    validateEmbedding: (childView, parentView) => canEmbed(parentView.model.get('type'), childView.model.get('type')),

    interactive: {
      linkMove: true,
      labelMove: true,
      vertexAdd: true,
      vertexMove: true,
      vertexRemove: true,
      arrowheadMove: true,
    },
  });

  // --- UML sequence default: reply-style links get dashed stroke ------
  // Fires when the user releases an arrowhead onto a valid port. In UML a
  // message drawn from the source's LEFT-side port into the target's RIGHT-
  // side port represents a reply / return (visually: right-to-left), which
  // convention renders as a dashed line. We apply dashed only on the very
  // first successful connection of a fresh link, and only if the user has
  // not already set an explicit dash pattern — so editing an existing link
  // never silently overrides their choice.
  paper.on('link:connect', (linkView, evt, newCellView, newCellMagnet, arrowhead) => {
    const link = linkView.model;
    const src = link.get('source');
    const tgt = link.get('target');
    if (!src?.id || !tgt?.id || !src.port || !tgt.port) return;
    const srcCell = graph.getCell(src.id);
    const tgtCell = graph.getCell(tgt.id);
    if (!srcCell || !tgtCell) return;
    // Data Cloud mapping link: a field→field link drawn while mapping mode is on
    // becomes a source→DMO mapping (distinct from a PK→FK ER relationship). The
    // properties panel can reclassify it afterwards.
    if (mappingModeGetter && mappingModeGetter()
        && srcCell.get('type') === 'sf.DataObject' && tgtCell.get('type') === 'sf.DataObject'
        && String(src.port).startsWith('field-') && String(tgt.port).startsWith('field-')) {
      if (link.prop('linkKind') !== 'mapping') {
        link.prop('linkKind', 'mapping');
        applyMappingLinkStyle(link);
      }
      return;
    }
    // Data Model relationship: a link between two DataObjects when NOT in mapping mode
    // is an ER relationship — give it the relationship style (grey, orthogonal
    // sfManhattan, plain ends) so Data Model links read distinctly from Data Mapping's
    // amber mapping connectors. The panel can re-pick cardinality markers afterwards.
    if (srcCell.get('type') === 'sf.DataObject' && tgtCell.get('type') === 'sf.DataObject') {
      if (link.prop('linkKind') !== 'mapping') {
        // link:connect fires both for a freshly-DRAWN link AND when an existing link's end is
        // dragged to a new port (re-anchor). Only a brand-new link should (re)apply the default
        // relationship style — otherwise dragging a One↔Many link to a different port wipes its
        // crow's-foot markers back to plain ends (reported bug). Re-anchor = the moved end had a
        // real cell id before this drop; we ALSO bail when the link already carries ER
        // cardinality, as a belt-and-braces guard so a configured relationship is never reset.
        const reAnchor = !!link.previous(arrowhead || 'target')?.id;
        const isErCard = m => !!(m?.d) && m.d !== 'M 0 0 L -12 0';
        const hasCardinality = isErCard(link.attr('line/sourceMarker')) || isErCard(link.attr('line/targetMarker'));
        if (!reAnchor && !hasCardinality) {
          applyRelationshipLinkStyle(link);
          // A relationship drawn from a header SIDE port (er-left/er-right) defaults to
          // One ↔ One-or-Many (the common parent→child FK shape) instead of plain ends.
          if (String(src.port).startsWith('er-') || String(tgt.port).startsWith('er-')) {
            const stroke = link.attr('line/stroke') || '#888888';
            link.attr('line/sourceMarker', { type: 'path', d: 'M -12 -8 L -12 8 M -12 0 L 0 0', fill: 'none', stroke, 'stroke-width': 2, 'stroke-dasharray': 'none' });          // one
            link.attr('line/targetMarker', { type: 'path', d: 'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0 M 3 -8 L 3 8', fill: 'none', stroke, 'stroke-width': 2, 'stroke-dasharray': 'none' }); // oneMany
          }
        }
      }
      return;
    }
    const SEQ_TYPES = new Set([
      'sf.SequenceParticipant', 'sf.SequenceActor', 'sf.SequenceActivation',
    ]);
    if (!SEQ_TYPES.has(srcCell.get('type')) || !SEQ_TYPES.has(tgtCell.get('type'))) return;
    const srcPort = srcCell.getPort(src.port);
    const tgtPort = tgtCell.getPort(tgt.port);
    if (srcPort?.group !== 'seq-left' || tgtPort?.group !== 'seq-right') return;
    // Write to the custom `lineStyle` prop (not `line/strokeDasharray`) so
    // the overlay manager renders the dashes without bleeding into the
    // arrowhead marker on Safari.
    const currentStyle = link.prop('lineStyle');
    if (currentStyle && currentStyle !== 'none') return;
    link.prop('lineStyle', '6 4');
  });

  // Keep the "Object Relationships" filter consistent: a relationship link added while
  // the filter is OFF must come in hidden too. (View-only — no model mutation.)
  graph.on('add', (cell) => {
    if (objectRelsVisible) return;
    if (!cell.isLink?.() || cell.prop('linkKind') === 'mapping') return;
    requestAnimationFrame(() => {
      const view = paper.findViewByModel(cell);
      if (view?.el) view.el.style.display = 'none';
    });
  });

  // Pan / zoom (wheel · trackpad pinch · touch) / grid input handlers moved to
  // ./canvas/viewport.js (Slice 6); attached via registerViewportControls(cctx)
  // once cctx.graph/paper are wired (see the cctx block lower in init()).

  // Click the external-link icon on sf.Link to open `url` in a new tab.
  // Uses click position (not evt.target) because some browsers retarget evt.target
  // to the body rect beneath the transparent iconHit. The icon occupies the rightmost
  // ~40px of the element, so we open the URL only when the click lands there.
  paper.on('element:pointerclick', (cellView, evt, x, y) => {
    if (cellView.model.get('type') !== 'sf.Link') return;
    const rawUrl = cellView.model.get('url');
    if (!rawUrl) return;
    // Link `url` can originate from an untrusted share URL / imported JSON.
    // Only open http(s)/mailto — block javascript:/data:/vbscript:/file: etc.
    let safeUrl;
    try {
      const normalized = /^[a-z][a-z0-9+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
      const parsed = new URL(normalized);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return;
      safeUrl = parsed.href;
    } catch { return; }
    const bbox = cellView.model.getBBox();
    if (x >= bbox.x + bbox.width - 40) {
      window.open(safeUrl, '_blank', 'noopener,noreferrer');
    }
  });

  // (Safari dasharray-overlay manager now started after the cctx block — Slice 8)

  // Phase 4: populate the canvas runtime context (cctx) the sub-modules read.
  // Single-writer, here in init(); see js/canvas/context.js.
  cctx.graph = graph;
  cctx.paper = paper;
  cctx.refreshAllIconHrefs = refreshAllIconHrefs;
  cctx.syncMappingTypeBadge = syncMappingTypeBadge;   // migration.js re-tokenizes mapping links on load
  cctx.syncFrequencyLabel = syncFrequencyLabel;       // migration.js rebuilds the frequency overlay on load
  // selection-viz.js recolours the frequency clock <image> on focus by swapping its href to a
  // tinted render (reads the icon generator lazily, so it's fine that setIconDataUriFn runs later).
  cctx.freqClockUri = (color) => (_iconDataUriFn ? _iconDataUriFn('clock', color, 24) : '');

  // Slice 6: attach the viewport input handlers (pan / zoom / grid) and expose
  // cctx.getZoom + cctx.fitContent. Must run AFTER cctx.graph/paper are set
  // above, since the handlers + fitContent read the live paper from cctx.
  registerViewportControls(cctx);

  // Slice 8: start the Safari dasharray-overlay manager here (relocated from
  // earlier in init()) so it reads cctx.graph/paper, wired just above.
  startLineStyleOverlays();

  // Slice 10: bind the link hover/focus-tinting listeners (reads cctx.graph/paper;
  // relocated here from earlier in init() for the same post-hydration reason).
  registerSelectionViz(cctx);

  // Slice 11: bind the drag-snap / alignment-guide listeners (reads cctx.graph/paper).
  registerSpacingGuides(cctx);

  // The sequence-activation lifeline snap shares the element:pointerup signal but
  // is its own concern (snapActivationToLifeline is also called from the stencil
  // drop). spacing-guides owns the guide cleanup on pointerup; this handles only
  // the activation snap, so the two listeners stay independent.
  paper.on('element:pointerup', (cellView) => {
    if (cellView?.model?.get('type') === 'sf.SequenceActivation') {
      snapActivationToLifeline(cellView.model);
    }
  });

  // Gantt drag write-back (Phase 2): dragging or resizing a task bar re-DATES it - dates stay the source of truth.
  // Grabbing a bar snapshots EVERY bar's geometry (so a multi-select bar drag re-dates all of them); on pointerup we
  // derive new start/end from the pixels (xToDate) of each bar that MOVED and set them. The view's
  // change:startDate/change:endDate listener then snaps each bar to its exact column. It all lands in the drag's
  // single history merge (same idle window) -> one undo; a click that didn't move is a no-op (never spuriously
  // re-dates). Bars not bound to a resolvable timeline (deriveGanttDates -> null) are skipped.
  let _ganttDragSnap = null;
  paper.on('element:pointerdown', (cellView) => {
    if (cellView?.model?.get('type') !== 'sf.GanttTask') { _ganttDragSnap = null; return; }
    _ganttDragSnap = new Map();
    for (const e of graph.getElements()) {
      if (e.get('type') === 'sf.GanttTask') _ganttDragSnap.set(e.id, { x: e.position().x, w: e.size().width });
    }
  });
  paper.on('element:pointerup', () => {
    const snap = _ganttDragSnap;
    _ganttDragSnap = null;
    if (!snap) return;
    for (const e of graph.getElements()) {
      if (e.get('type') !== 'sf.GanttTask') continue;
      const from = snap.get(e.id);
      if (!from || (e.position().x === from.x && e.size().width === from.w)) continue;   // unmoved
      const d = deriveGanttDates(e);
      if (d) e.set({ startDate: d.start, endDate: d.end });   // view listener re-derives geometry → bar snaps to its date
    }
  });

  // Slice 12 (finale): mount the embedding auto-fit graph triggers
  // (change:parent / change:size / change:position / remove) + expose
  // cctx.fitParentToChildren. Reads cctx.graph; skips JSON restore via
  // cctx.isLoadingJSON. The fit engine + canEmbed + findEmbeddingParent live in
  // ./canvas/embedding.js.
  registerEmbedding(cctx);

  // ── Cascading re-route for connector grouping (CR-5.1) ─────────────
  // JointJS only re-runs the router for the link that changed — but with
  // grouping enabled, adding/removing/restyling one link at a port changes
  // N (and the group ordering) for every OTHER link at that port too.
  // Without this trigger, the existing 3 links keep their N=3 positions when
  // a 4th is added, while the new one routes at N=4 — visual misalignment.
  //
  // Strategy: when any link-relevant or geometry-relevant event fires and
  // grouping is on, re-route every link in the active graph. Debounced
  // (rAF-scale) so a chain of related events collapses into one pass.
  // Reroute itself only calls LinkView.update(), which doesn't mutate the
  // model, so we don't re-enter this listener loop.
  let _rerouteScheduled = false;
  function scheduleReroute() {
    if (_isLoadingJSON) return;
    if (!isConnectorGroupingEnabled()) return;
    if (_rerouteScheduled) return;
    _rerouteScheduled = true;
    requestAnimationFrame(() => {
      _rerouteScheduled = false;
      rerouteAllLinks();
    });
  }
  graph.on('add', (cell) => { if (cell.isLink?.()) scheduleReroute(); });
  graph.on('remove', (cell) => { if (cell.isLink?.()) scheduleReroute(); });
  graph.on('change:source change:target change:attrs change:lineStyle', (cell) => {
    if (cell.isLink?.()) scheduleReroute();
  });

  // Frequency overlay tracks the user label: dragging the on-line label (labelMove) fires change:labels,
  // so re-glue the overlay underneath it (v1.16.1). Guarded by `connectionFrequency` (only architecture
  // links with a frequency) + a reentrancy flag so syncFrequencyLabel's own labels() write can't re-fire
  // this into a loop (the JSON-equality short-circuit also terminates it).
  let _syncingFreq = false;
  graph.on('change:labels', (cell) => {
    if (_syncingFreq || !cell.isLink?.() || !cell.prop('connectionFrequency')) return;
    _syncingFreq = true;
    try { syncFrequencyLabel(cell); } finally { _syncingFreq = false; }
  });

  // A mapping link connecting/disconnecting changes its DataObjects' mapped-field count
  // (the X/Y header pill) and which fields are visible under "Show Only Mapped" — but a
  // link add/remove/re-endpoint doesn't fire any change event on the element, so refresh
  // the touched DataObject views explicitly.
  const refreshDataObjectById = (id) => {
    const cell = id && graph.getCell(id);
    if (cell && cell.get('type') === 'sf.DataObject') {
      const view = paper.findViewByModel(cell);
      view?._renderFieldRows?.();
      view?._syncFieldPorts?.();
      view?._renderBadges?.();
    }
  };
  const refreshLinkedDataObjects = (link) => {
    refreshDataObjectById(link.get('source')?.id);
    refreshDataObjectById(link.get('target')?.id);
  };
  graph.on('add', (cell) => { if (cell.isLink?.()) refreshLinkedDataObjects(cell); });
  graph.on('remove', (cell) => { if (cell.isLink?.()) refreshLinkedDataObjects(cell); });
  // On re-endpoint, refresh BOTH the new AND the PREVIOUS endpoint object — otherwise an
  // object a link is DRAGGED AWAY FROM never updates (its mapped X/Y pill stays stale).
  // `remove` works because the link still names both ends; a drag only names the new one.
  graph.on('change:source', (cell) => {
    if (!cell.isLink?.()) return;
    refreshDataObjectById(cell.get('source')?.id);
    refreshDataObjectById(cell.previous('source')?.id);
  });
  graph.on('change:target', (cell) => {
    if (!cell.isLink?.()) return;
    refreshDataObjectById(cell.get('target')?.id);
    refreshDataObjectById(cell.previous('target')?.id);
  });
  // Cell move/resize affects edge length (size) and far-end ordering
  // (position). Element-only — link `change:position` would be the same as
  // changes above and already handled.
  graph.on('change:position change:size', (cell) => {
    if (cell.isElement?.()) scheduleReroute();
  });

  // ── Empty-canvas ghost wireframe ────────────────────────────────────
  // Toggle `.is-empty` on #canvas-container whenever the active graph has zero cells.
  // CSS then reveals the faint, type-specific best-practice blueprint (markup in
  // index.html #canvas-empty; the diagram type is set on the container by tabs.js, and
  // the blueprint is chosen by [data-diagram-type]). Per-tab — each tab's empty state
  // shows its blueprint until the first drop. Pure view state: never touches the graph
  // or undo history. `reset` covers tab switches (fromJSON); add/remove cover edits.
  const canvasContainer = paper.el.closest('#canvas-container') || document.getElementById('canvas-container');
  const refreshEmptyState = () => {
    canvasContainer?.classList.toggle('is-empty', graph.getCells().length === 0);
  };
  graph.on('add remove reset', refreshEmptyState);
  refreshEmptyState();

  cctx.scheduleCrossingBumpRecompute = initCrossingBumps();
  initExternalLabelAutoplace();

  return { graph, paper };
}


// Snap a SequenceActivation's horizontal centre to the nearest participant or
// actor lifeline when within a threshold, provided the activation overlaps the
// lifeline vertically. Used both by `element:pointerup` (drag within canvas)
// and by the stencil drop handler.
export function snapActivationToLifeline(cell, threshold = 30) {
  if (!cell || cell.get('type') !== 'sf.SequenceActivation') return;
  const actBBox = cell.getBBox();
  const actCx = actBBox.x + actBBox.width / 2;
  let bestDx = Infinity;
  let bestCx = null;
  for (const el of graph.getElements()) {
    const t = el.get('type');
    if (t !== 'sf.SequenceParticipant' && t !== 'sf.SequenceActor') continue;
    const bb = el.getBBox();
    const lifeTop = bb.y + (t === 'sf.SequenceActor' ? 92 : 48);
    const lifeBot = bb.y + bb.height;
    const overlapY = Math.min(actBBox.y + actBBox.height, lifeBot) - Math.max(actBBox.y, lifeTop);
    if (overlapY <= 0) continue;
    const cx = bb.x + bb.width / 2;
    const dx = Math.abs(cx - actCx);
    if (dx < bestDx) { bestDx = dx; bestCx = cx; }
  }
  if (bestCx != null && bestDx <= threshold) {
    cell.position(bestCx - actBBox.width / 2, actBBox.y);
  }
}

// setZoom / zoomIn / zoomOut / fitContent / toggleGrid / refreshGrid moved to
// ./canvas/viewport.js (Slice 6); re-exported from the facade at the top.

let _iconDataUriFn = null;
export function setIconDataUriFn(fn) { _iconDataUriFn = fn; }

export function refreshIcons() {
  if (!_iconDataUriFn) return;
  // After theme switch, update icon data URIs on elements using default label color
  const nodeText = getComputedStyle(document.documentElement).getPropertyValue('--node-text').trim();
  if (!nodeText) return;
  for (const el of graph.getElements()) {
    const type = el.get('type');
    if (type === 'sf.SimpleNode') {
      const iconHref = el.attr('icon/href');
      if (!iconHref) continue;
      // Only update icons whose label is still using the default (CSS var) color
      const labelFill = el.attr('label/fill');
      if (labelFill && !labelFill.startsWith('var(')) continue; // custom color, skip
      // Extract icon ID and regenerate with new theme color
      const idMatch = iconHref.match(/data-icon-id(?:%3D|=)(?:%22|")([^%"]+)(?:%22|")/);
      if (idMatch) {
        const iconId = decodeURIComponent(idMatch[1]);
        el.attr('icon/href', _iconDataUriFn(iconId, nodeText));
      }
    }
  }
}

/** Regenerate ALL icon data URIs on canvas elements so they use current normalized viewBoxes. */
function refreshAllIconHrefs() {
  if (!_iconDataUriFn) return;
  for (const el of graph.getElements()) {
    const type = el.get('type');
    if (type === 'sf.SimpleNode') {
      _refreshElementIcon(el, 'icon/href', 'label/fill');
    } else if (type === 'sf.Container') {
      _refreshElementIcon(el, 'headerIcon/href', null, '#FFFFFF');
    } else if (type === 'sf.DataObject') {
      // Optional header icon (Account/Contact/Snowflake…) — white, like the Container's,
      // matching the white header label on the coloured header bar.
      _refreshElementIcon(el, 'headerIcon/href', null, '#FFFFFF');
    } else if (type === 'sf.Note') {
      // The Note icon (light-bulb by default) was being lost on the save round-trip: slimForShare keeps only a
      // `data-icon-id` placeholder, and this loop skipped Notes - so the placeholder never re-resolved to the
      // full SVG (it rendered empty). Re-resolve it from label/fill (the note text colour). An empty href -
      // i.e. a user-cleared icon - no-ops in _refreshElementIcon, so cleared notes stay cleared. (item 1.2)
      _refreshElementIcon(el, 'icon/href', 'label/fill');
    }
  }
}

function _refreshElementIcon(el, hrefAttr, fillAttr, defaultColor) {
  const iconHref = el.attr(hrefAttr);
  if (!iconHref) return;
  const idMatch = iconHref.match(/data-icon-id(?:%3D|=)(?:%22|")([^%"]+)(?:%22|")/);
  if (!idMatch) return;
  const iconId = decodeURIComponent(idMatch[1]);
  // Determine the icon color from the element's text color or the default
  let color = defaultColor;
  if (!color) {
    const labelFill = fillAttr ? el.attr(fillAttr) : null;
    color = (labelFill && !labelFill.startsWith('var('))
      ? labelFill
      : getComputedStyle(document.documentElement).getPropertyValue('--node-text').trim() || '#FFFFFF';
  }
  el.attr(hrefAttr, _iconDataUriFn(iconId, color));
}

// getViewport / setViewport moved to ./canvas/viewport.js (Slice 6); re-exported
// from the facade at the top (per-tab viewport save/restore reads them via the
// canvas module in tabs.js / persistence.js).


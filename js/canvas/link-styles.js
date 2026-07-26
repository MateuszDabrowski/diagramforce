// Link styles — how a connector is painted, badged, and labelled. Extracted from canvas.js
// (Phase 4 / S7 slice 3). The apply*/sync* helpers set attrs on a PASSED link (no graph walk
// except applyObjectRelsVisibility, which reads cctx.graph/paper): Data Cloud mapping style +
// type badge, ER relationship style, Gantt-dependency style, and the on-line frequency overlay
// (its clock glyph via cctx.freqClockUri from icon-refresh). setMappingModeGetter injects the
// active-tab mapping-mode reader onto cctx.getMappingMode (app.js wires it; cctx exists at import,
// so it's never init-gated). registerLinkStyles(cctx) exposes sync* on cctx for migration.js.
// Uses the `joint` GLOBAL (JointJS is a global script, never an import). rerouteAllLinks + the
// paper defaultLink factory + the reroute cascade stay in canvas.js (S7 slice 3b).

import { cctx } from './context.js?v=1.21.2';
import { Z_GANTT_DEP } from './z-tiers.js?v=1.21.2';

// ── Data Cloud mapping links ─────────────────────────────────────────
// A field→field link drawn while mapping mode is on is a source→DMO mapping
// (distinct from a PK→FK ER relationship): tagged linkKind:'mapping' with a
// distinct colour + a single direction arrow. mappingModeGetter is wired from
// app.js (reads the active tab's mapping mode). applyMappingLinkStyle is shared
// with properties.js (panel reclassify).
export function setMappingModeGetter(fn) { cctx.getMappingMode = fn; }

export const MAPPING_LINK_COLOR = '#F6B355'; // brand amber/accent — distinguishes mappings from grey ER links (canvas.js reroute/defaultLink import it)

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

// Round an orthogonal point list into a path with `r`-radius corners (quadratic joins), deduping coincident points.
function roundedOrthoPath(rawPts, r) {
  const pts = [];
  for (const p of rawPts) {
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5) pts.push(p);
  }
  if (pts.length < 2) return pts.length ? `M ${pts[0].x} ${pts[0].y}` : '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], prev = pts[i - 1], next = pts[i + 1];
    const len1 = Math.hypot(p.x - prev.x, p.y - prev.y), len2 = Math.hypot(next.x - p.x, next.y - p.y);
    const rr = Math.min(r, len1 / 2, len2 / 2);
    const a = { x: p.x + (prev.x - p.x) / (len1 || 1) * rr, y: p.y + (prev.y - p.y) / (len1 || 1) * rr };
    const b = { x: p.x + (next.x - p.x) / (len2 || 1) * rr, y: p.y + (next.y - p.y) / (len2 || 1) * rr };
    d += ` L ${a.x} ${a.y} Q ${p.x} ${p.y} ${b.x} ${b.y}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L ${last.x} ${last.y}`;
}

// Connector for Gantt DEPENDENCIES: a classic orthogonal "elbow" step with rounded corners (the MS-Project / standard
// Gantt dependency look), NOT a generic bézier arrow. It exits the predecessor's port on a short stub, steps to the
// successor's row, and enters the successor's port on a short stub. When the successor OVERLAPS the predecessor (it
// starts before the predecessor's right edge + stubs - frequent in real plans) it WRAPS between the two rows instead
// of diving back through the bars. Reads the ports off the link (defaults: source-right → target-left, FS).
joint.connectors.sfGanttDepConnector = function (sourcePoint, targetPoint, route, opt, linkView) {
  const sp = String(linkView?.model?.get('source')?.port || '');
  const tp = String(linkView?.model?.get('target')?.port || '');
  const sDir = sp.includes('left') ? -1 : 1;     // exit in the source port's facing direction (default right)
  const tDir = tp.includes('right') ? 1 : -1;    // approach the target from its facing side (default left)
  // Pin the endpoints to the bar's edge midpoint (lands on the port whether bound to a port or the body). The TARGET
  // is pulled ARROW px OUTWARD (away from the bar) so the 14px arrowhead's TIP lands AT the edge, not 14px deep
  // inside. Live-draw fallback: the resolved connection points when a view isn't available yet.
  const ARROW = 13;
  const bboxOf = (view) => { const m = view?.model; return (m && typeof m.getBBox === 'function') ? m.getBBox() : null; };
  const sb = bboxOf(linkView?.sourceView);
  const tb = bboxOf(linkView?.targetView);
  const s = sb ? { x: sDir > 0 ? sb.x + sb.width : sb.x, y: sb.y + sb.height / 2 } : sourcePoint;
  const t = tb ? { x: (tDir > 0 ? tb.x + tb.width : tb.x) + tDir * ARROW, y: tb.y + tb.height / 2 } : targetPoint;
  const STUB = 14;
  const A = { x: s.x + sDir * STUB, y: s.y };     // source exit stub
  const D = { x: t.x + tDir * STUB, y: t.y };     // target entry stub
  const pts = [s, A];
  // Route the long horizontal along the SOURCE task's NEAR border (top if the target is above it, bottom if below)
  // plus a small gap, then a SINGLE vertical jump to the target row. So the horizontal hugs the source row's own gap
  // and never floats at the midpoint between rows - where, for tasks that aren't directly stacked, it would overlay
  // the bars in between. (The vertical jump is a thin line; only the horizontal run was overlaying elements.)
  const dir = Math.sign(t.y - s.y);   // +1 = target below, -1 = above, 0 = same row
  if (dir !== 0 && sb) {
    const borderY = dir > 0 ? sb.y + sb.height + 6 : sb.y - 6;
    pts.push({ x: A.x, y: borderY }, { x: D.x, y: borderY });
  }
  pts.push(D, t);
  return roundedOrthoPath(pts, 6);
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
const MAPPING_TYPE_CODE = {
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
        href: cctx.freqClockUri?.(color) || '',
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

// A Gantt dependency link (Phase 3): a brand-amber arrow INTO the successor bar. Clear markers first (attrs
// merge). The target arrow carries NO explicit fill/stroke so it auto-inherits the line colour + auto-trims the
// line (CLAUDE.md "Link Markers").
export function applyGanttDepLinkStyle(link) {
  const stroke = '#F6B355';   // brand amber
  link.removeAttr('line/sourceMarker');
  link.removeAttr('line/targetMarker');
  link.attr('line/stroke', stroke);
  link.attr('line/strokeWidth', 1.5);
  // Source = a "one" tick (a single perpendicular bar, ER one-notation) so the START reads as a dependency origin,
  // not a plain line end (item 2). Target = the solid arrowhead into the successor.
  link.attr('line/sourceMarker', { type: 'path', d: 'M 0 -7 L 0 7', fill: 'none', stroke, 'stroke-width': 1.5 });
  link.attr('line/targetMarker', { type: 'path', d: 'M 0 -6 L -14 0 L 0 6 z' });
  link.router('normal');                       // straight points → the connector owns the elbow geometry
  link.connector('sfGanttDepConnector');       // the standard Gantt orthogonal dependency elbow (wraps on overlap)
  link.set('z', Z_GANTT_DEP);                  // render BELOW the bars so a crossing tucks behind them, not over
  // Anchor at the PORT with NO outward offset so the endpoints sit EXACTLY on the bars' edge midpoints (item 2);
  // the connector itself re-pins to the edge midpoint, so this just keeps JointJS from routing to the bbox edge.
  link.prop('source/connectionPoint', { name: 'anchor' });
  link.prop('target/connectionPoint', { name: 'anchor' });
}


// ── Flow connectors ──────────────────────────────────────────────────
// A flow connector is a PLAIN standard.Link between two df.Flow* cells with THREE types (Salesforce's own terms):
// Standard, Fault, and Go To ("Outgoing Go To" - a jump to an existing element). There is NO separate stored prop -
// the type is a pure SHORTCUT over the normal connector options (line colour + line style + label colour), so
// `flowConnectorType` DERIVES it from the STROKE COLOUR: red = Fault (dashed); blue = Go To (dotted); grey =
// Standard (solid). (flow_ref_connectors). Both ends use the panel's "None" ending (a `M 0 0 L -12 0` line-
// continuation stub, NOT an empty marker): the paper's `sfConnectionPoint` holds each endpoint ~16px off the
// boundary (room a real arrow fills), and the stub bridges that gap so the line TOUCHES the card.
const FLOW_LINK_COLOR = '#5C5C5C';   // Salesforce standard connector grey (export-measured rgb(92,92,92))
const FLOW_FAULT_COLOR = '#EA001E';  // Salesforce fault red (export-measured) — the fault path is RED + DASHED
const FLOW_GOTO_COLOR = '#0B5CAB';   // SLDS blue-40 (--slds-g-color-palette-blue-40, export-measured) — a Go To's LINE + label are both this blue
const FLOW_FAULT_DASH = '8 4';       // panel LINK_LINE_STYLE_OPTS "Dashed" — so the Line Style control reads "Dashed"
const FLOW_GOTO_DASH = '2 4';        // panel LINK_LINE_STYLE_OPTS "Dotted" — a Go To is blue + DOTTED

/** Derive the connector TYPE from its STROKE COLOUR (no stored prop), symmetric with Fault: red = Fault; blue =
 *  Go To (Salesforce "Outgoing Go To" — a jump to an existing element, drawn blue + dotted); else Standard. */
export function flowConnectorType(link) {
  const stroke = String(link.attr('line/stroke') || '').toUpperCase();
  if (stroke === FLOW_FAULT_COLOR) return 'fault';
  if (stroke === FLOW_GOTO_COLOR) return 'goto';
  return 'standard';
}
/** Back-compat shim (migration + older callers): true iff the connector is a Fault. */
export function isFlowFaultLink(link) { return flowConnectorType(link) === 'fault'; }

/** The destination element's name, for seeding a Go To connector's label (Salesforce labels an Outgoing Go To with
 *  the target element's name). Empty when the target has no name or isn't resolvable yet. */
export function flowGoToDestName(link) {
  const t = link.get('target');
  const cell = t && t.id ? cctx.graph?.getCell(t.id) : null;
  const n = cell?.get?.('name');
  return typeof n === 'string' && n.trim() ? n.trim() : '';
}

// A flow connector label is a white PILL with a thin rounded border (Flow Builder look) — the PERSISTENT form of
// the pill that selection-viz draws on hover (a rect with `rx` = half its height). Neutral border; the text tracks
// the connector colour (grey / fault red). `rx/ry` clamp to a pill on the short sides at the runtime rect height.
const FLOW_LABEL_BORDER = 'var(--border-color, #C9C9C9)';
export function flowLabelAttrs(text, color, position) {
  return {
    markup: [{ tagName: 'rect', selector: 'body' }, { tagName: 'text', selector: 'text' }],
    attrs: {
      text: { text, fill: color, fontSize: 13, fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', textAnchor: 'middle', textVerticalAnchor: 'middle' },
      body: { ref: 'text', refWidth: 20, refHeight: 12, refX: -10, refY: -6, fill: 'var(--bg-canvas, #FFFFFF)', stroke: FLOW_LABEL_BORDER, 'stroke-width': 1, rx: 12, ry: 12 },
    },
    position: position || { distance: 0.5, offset: 0 },
  };
}

// A Go To connector's label is NOT the bordered pill — Flow Builder renders an "Outgoing Go To" as BLUE ITALIC text
// carrying the DESTINATION element's name + a "→" arrow (measured: `.text-*-goto { color: blue-40; font-style:
// italic }`). No border; just a canvas-bg mask so the dotted line breaks behind the text. `name` is the raw
// destination name (the arrow is appended here; a trailing arrow in `name` is stripped so it never doubles).
export function flowGoToLabelAttrs(name, position) {
  const base = String(name || '').replace(/\s*→\s*$/, '').trim() || 'Go To';
  return {
    markup: [{ tagName: 'rect', selector: 'body' }, { tagName: 'text', selector: 'text' }],
    attrs: {
      text: { text: `${base} →`, fill: FLOW_GOTO_COLOR, fontStyle: 'italic', fontSize: 13, fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', textAnchor: 'middle', textVerticalAnchor: 'middle' },
      body: { ref: 'text', refWidth: 12, refHeight: 6, refX: -6, refY: -3, fill: 'var(--bg-canvas, #FFFFFF)', stroke: 'none', rx: 2, ry: 2 },
    },
    position: position || { distance: 0.5, offset: 0 },
  };
}

// Default placement for an UNPOSITIONED flow connector label (flow diagrams only — authored/dragged positions are
// always preserved). Every outcome of a decision leaves the SAME port, so the branches share their first stub:
// anything anchored near the source piles the sibling pills on top of each other (32 px STUB + a 13 px pill is not
// enough room for two). A branch label therefore rides near its TARGET, where each branch owns its own column.
// Two exceptions stay near the source, both because "leaves here" is the thing being said:
//   • Fault / Go To — matches Flow Builder's pill sitting right beside the element it exits.
//   • A branch that SKIPS ranks (an empty outcome dropping to a distant merge) — near-target would strand its
//     label rows below the decision it belongs to, and having no neighbouring rank it has nothing to collide with.
const FLOW_LABEL_NEAR_SOURCE = { distance: 44, offset: 0 };
const FLOW_LABEL_NEAR_TARGET = { distance: -40, offset: 0 };
const FLOW_RANK_SKIP = 192;   // > ~1.5 rows (56 px card + 72 px ROW_GAP) ⇒ the target is not the next rank down
function defaultFlowLabelPosition(link, type) {
  if (type !== 'standard') return FLOW_LABEL_NEAR_SOURCE;
  const g = cctx.graph;
  const s = g?.getCell(link.get('source')?.id), t = g?.getCell(link.get('target')?.id);
  if (!s?.position || !t?.position) return FLOW_LABEL_NEAR_SOURCE;
  const dy = t.position().y - s.position().y;
  return dy > 0 && dy <= FLOW_RANK_SKIP ? FLOW_LABEL_NEAR_TARGET : FLOW_LABEL_NEAR_SOURCE;
}

/** Apply a flow connector preset — a shortcut over the standard connector props (line colour + line style + label
 *  colour) plus the "None" stub ends. Standard = grey solid; Fault = red dashed; Go To = grey dotted (a jump to an
 *  existing element). Accepts { type: 'standard'|'fault'|'goto' } (preferred) or the legacy { fault } boolean.
 *  Idempotent. */
export function applyFlowLinkStyle(link, opts = {}) {
  const type = opts.type || (opts.fault ? 'fault' : 'standard');
  const color = type === 'fault' ? FLOW_FAULT_COLOR : type === 'goto' ? FLOW_GOTO_COLOR : FLOW_LINK_COLOR;
  const dash = type === 'fault' ? FLOW_FAULT_DASH : type === 'goto' ? FLOW_GOTO_DASH : null;
  const width = link.attr('line/strokeWidth') ?? 2;
  const noneEnd = { type: 'path', d: 'M 0 0 L -12 0', fill: 'none', stroke: color, 'stroke-width': width, 'stroke-dasharray': 'none' };
  link.attr('line/stroke', color);
  link.attr('line/targetMarker', noneEnd);
  link.attr('line/sourceMarker', noneEnd);
  // Dash via the `lineStyle` overlay prop — NEVER line/strokeDasharray (it bleeds into the open-stroke marker on
  // Safari; the overlay manager owns the dash render, gotcha 1.1). Fault = Dashed ('8 4'), Go To = Dotted ('2 4'),
  // Standard = Solid (null). Uses the panel's OWN dash values so the Line Style control shows the matching option.
  link.prop('lineStyle', dash);
  // Labels. Go To is special: its label IS the destination reference, rendered as blue italic "Name →" (no pill) —
  // preserve an authored label's text (arrow-stripped), else derive the target's name. Standard/Fault restyle to the
  // bordered PILL in the type colour; Fault seeds "Fault" when unlabelled; Standard seeds nothing.
  const existing = link.labels() || [];
  const fallbackPos = defaultFlowLabelPosition(link, type);
  if (type === 'goto') {
    const authored = existing.find((l) => l?.attrs?.text?.text)?.attrs?.text?.text;
    link.labels([flowGoToLabelAttrs(authored || flowGoToDestName(link), existing[0]?.position || fallbackPos)]);
  } else {
    const styled = existing.map((l) => (l?.attrs?.text?.text ? flowLabelAttrs(l.attrs.text.text, color, l.position || fallbackPos) : l));
    if (type === 'fault' && !styled.some((l) => l?.attrs?.text?.text)) styled.push(flowLabelAttrs('Fault', color, fallbackPos));
    if (styled.length) link.labels(styled);
  }
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
  const { graph, paper } = cctx;
  if (!graph || !paper) return;
  for (const link of graph.getLinks()) {
    if (link.prop('linkKind') === 'mapping') continue;   // mapping curves always show
    const view = paper.findViewByModel(link);
    if (view?.el) view.el.style.display = objectRelsVisible ? '' : 'none';
  }
}

export function registerLinkStyles(cctx) {
  // migration.js re-tokenizes mapping links + rebuilds the frequency overlay on load.
  cctx.syncMappingTypeBadge = syncMappingTypeBadge;
  cctx.syncFrequencyLabel = syncFrequencyLabel;
  // migration.js re-applies the flow connector style on load (so the "None" stub ends touch the cards) + upgrades
  // any legacy connectorKind. flowConnectorType derives Standard/Fault/Go To from the persisted (stroke, dash).
  cctx.applyFlowLinkStyle = applyFlowLinkStyle;
  cctx.isFlowFaultLink = isFlowFaultLink;
  cctx.flowConnectorType = flowConnectorType;
}

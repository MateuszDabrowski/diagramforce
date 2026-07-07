// Link / connector property panel (CLEANUP S2, slice 5) — the single-link renderLinkProps + its ER-marker
// machinery (erMarkerDef, the nested markerDefs/detectMarker/applyMarker with the Safari <marker>-cache re-insert),
// the shared connector-appearance setters (LINK_LINE_STYLE_OPTS / applyLinkStroke / applyLinkStrokeWidth /
// applyLinkLineStyle / applyLinkFontColor / applyLinkConnectionType / applyLinkMappingType / applyLinkExpression),
// setLinkEndpoints (the connector right-click ER quick-set, reached via properties.setLinkEndpoints), and
// renderMappingControls (shared by the single-link panel AND the facade multi-select Connectors section). Reads
// the live graph/paper/selection + refresh via prctx at CALL time; never imports the facade back. The facade
// re-imports renderLinkProps + renderMappingControls + the 4 line-style setters (multi-select + dispatch) and
// re-exports setLinkEndpoints for app.js.
import * as history from '../history.js?v=1.19.2.99';
import { prctx } from './context.js?v=1.19.2.99';
import { applyMappingLinkStyle, applyRelationshipLinkStyle, syncFrequencyLabel, syncMappingTypeBadge } from '../canvas.js?v=1.19.2.99';
import { ER_MARKER_D } from '../er-markers.js?v=1.19.2.99';
import { addCloneBtn, addColor, addDeleteBtn, addMarkerPicker, addNumber, addSegmented, addSelect, addText, section } from './widgets.js?v=1.19.2.99';

// ── Shared connector-appearance setters ───────────────────────────────────────
// Used by BOTH the single-link panel (renderLinkProps) and the multi-select Connectors
// section so a one-link edit and a many-link edit behave identically. None of these opens a
// history batch — the CALLER wraps (one undo step per edit, however many links it touches).

// Connector line-style picklist (Solid / Dashed / Dotted) — em-space gap then a sample.
// `lineStyle` is a top-level prop (a bg-coloured overlay clone paints the dashes; the real
// path stays solid so arrow/ER markers render crisp on Safari — see startLineStyleOverlays).
export const LINK_LINE_STYLE_OPTS = (() => {
  const G = '   ';
  return [
    { value: 'none', label: `Solid${G}─────` },
    { value: '8 4',  label: `Dashed${G}╌ ╌ ╌ ╌ ╌` },
    { value: '2 4',  label: `Dotted${G}· · · · · · ·` },
  ];
})();

// Line colour. Arrow markers auto-inherit from the line; ER/stub markers carry an explicit
// stroke that must track it; a mapping badge re-tints; and the link's SVG group is re-inserted
// to dodge Safari's <marker> cache (full attrs replacement + sync render — see applyMarker).
// Apply new attrs to a link and force a repaint, including the deliberate Safari SVG-marker-cache workaround.
// Deep-clones attrs (breaking all references), lets `mutate(line, allAttrs, cell)` make the change on the clone,
// sets, runs the optional `afterSet(cell)` (a dependent update that must ride the SAME flush, e.g. the mapping
// badge), flushes JointJS's async view queue, then RE-INSERTS the link's whole SVG group into the DOM.
//
// Why the re-insert: Safari caches the link <path>'s rendering keyed on the path element identity and does NOT
// repaint when a referenced <marker> changes — even when `marker-end` points at a fresh marker id. The v1.11.0
// attempt at minting a new marker id via null → flush → set looked clean, but JointJS deduplicates <marker>
// elements in <defs>, so the second set often re-bound to an orphan marker from a previous swap, leaving
// Safari's cache valid and the user staring at a stale arrowhead until reload. Re-inserting the whole group
// invalidates the cache outright. Guarded on WebKit by dev/tests/e2e/marker.spec.js.
export function setLinkAttrsAndRepaint(cell, mutate, afterSet) {
  const allAttrs = JSON.parse(JSON.stringify(cell.get('attrs') || {}));
  if (!allAttrs.line) allAttrs.line = {};
  mutate(allAttrs.line, allAttrs, cell);
  cell.set('attrs', allAttrs);
  afterSet?.(cell);
  prctx.paper.updateViews();
  const view = prctx.paper.findViewByModel(cell);
  if (view?.el?.parentNode) {
    const parent = view.el.parentNode;
    const next = view.el.nextSibling;
    parent.removeChild(view.el);
    if (next) parent.insertBefore(view.el, next);
    else parent.appendChild(view.el);
  }
}

export function applyLinkStroke(cell, v) {
  setLinkAttrsAndRepaint(cell, (line) => {
    line.stroke = v;
    if (line.sourceMarker?.stroke && line.sourceMarker.stroke !== 'none') line.sourceMarker.stroke = v;
    if (line.targetMarker?.stroke && line.targetMarker.stroke !== 'none') line.targetMarker.stroke = v;
  }, (c) => { if (c.prop('linkKind') === 'mapping') syncMappingTypeBadge(c); });
}

// Line width. A plain "None" stub end (`M 0 0 L -12 0`) is a continuation of the line, so it
// tracks the width; decorated ends (arrow / crow's foot) keep their own weight.
export function applyLinkStrokeWidth(cell, v) {
  cell.attr('line/strokeWidth', v);
  for (const end of ['sourceMarker', 'targetMarker']) {
    if (cell.attr(`line/${end}`)?.d === 'M 0 0 L -12 0') cell.attr(`line/${end}/stroke-width`, v);
  }
}

// Line style → the `lineStyle` prop (never `line/strokeDasharray`, which is force-cleared as
// defence-in-depth so the real path stays solid for crisp Safari markers).
export function applyLinkLineStyle(cell, v) {
  cell.prop('lineStyle', v === 'none' ? null : v);
  if (cell.attr('line/strokeDasharray')) cell.attr('line/strokeDasharray', null);
}

// Canonical ER marker def for an endpoint key, built with the link's own stroke/width (mirrors the marker-picker
// `markerDefs`). Only the keys the quick-set presets need; null = remove the marker on that side.
export function erMarkerDef(key, stroke, lineWidth) {
  switch (key) {
    case 'none':  return { type: 'path', d: ER_MARKER_D.none, fill: 'none', stroke, 'stroke-width': lineWidth, 'stroke-dasharray': 'none' };
    case 'arrow': return { type: 'path', d: ER_MARKER_D.arrow, 'stroke-dasharray': 'none' };   // auto-inherits line stroke
    case 'one':   return { type: 'path', d: ER_MARKER_D.one, fill: 'none', stroke, 'stroke-width': 2, 'stroke-dasharray': 'none' };
    case 'many':  return { type: 'path', d: ER_MARKER_D.many, fill: 'none', stroke, 'stroke-width': 2, 'stroke-dasharray': 'none' };
    default: return null;
  }
}

/** Quick-set a link's source + target ER markers (connector right-click presets: → / 1:1 / 1:M / M:1). Each key
 *  is 'none' | 'arrow' | 'one' | 'many' (undefined = leave that side untouched). Applies BOTH ends in one attrs
 *  replacement + the Safari <marker>-cache re-insert (same as applyMarker), so a stale arrowhead never lingers. */
export function setLinkEndpoints(cell, sourceKey, targetKey) {
  if (!cell || !cell.isLink || !cell.isLink()) return;
  const stroke = cell.attr('line/stroke') || '#888888';
  const lineWidth = cell.attr('line/strokeWidth') || 2;
  setLinkAttrsAndRepaint(cell, (line) => {
    const apply = (key, markerKey) => {
      if (key === undefined) return;
      const def = erMarkerDef(key, stroke, lineWidth);
      if (def) line[markerKey] = def; else delete line[markerKey];
    };
    apply(sourceKey, 'sourceMarker');
    apply(targetKey, 'targetMarker');
  });
}

// ── Shared Data Cloud mapping setters (single-link panel + multi-select Mapping section) ──
// The 5-value transform picklist, shared so single + multi stay in lockstep.
export const MAPPING_TYPES = ['Standard', 'Formula', 'Streaming Transform', 'Batch Transform', 'Calculated Insight'];

// Gantt dependency types (Phase 3): which ends of the predecessor/successor bars the relationship ties.
export const GANTT_DEP_TYPE_OPTS = [
  { value: 'FS', label: 'Finish → Start (FS)' },
  { value: 'SS', label: 'Start → Start (SS)' },
  { value: 'FF', label: 'Finish → Finish (FF)' },
  { value: 'SF', label: 'Start → Finish (SF)' },
];

// Connection type for a field→field link: mapping ↔ relationship. Swaps `linkKind` and the
// whole router/connector/marker style. No history batch and no panel re-render — the caller
// owns both (it must re-render to disclose/hide the mapping fields).
export function applyLinkConnectionType(cell, v) {
  if (v === 'mapping') { cell.prop('linkKind', 'mapping'); applyMappingLinkStyle(cell); }
  else { cell.prop('linkKind', null); applyRelationshipLinkStyle(cell); }
}
// Mapping transform type (Standard / Formula / …) + its connector code badge (F / ST / BT / CI).
export function applyLinkMappingType(cell, v) {
  cell.prop('mappingType', v);
  syncMappingTypeBadge(cell);
}
// Expression / rule note (non-Standard types) → table Expression column + badge hover tooltip.
export function applyLinkExpression(cell, v) {
  cell.prop('expressionRule', v || '');
  syncMappingTypeBadge(cell);
}
// Font colour (v1.16.1) — one control for ALL of a connector's text: the user label, the frequency
// overlay text, AND its clock icon. Stored as the `fontColor` prop; recolours the existing user label in
// place and re-derives the frequency overlay (syncFrequencyLabel reads `fontColor`).
export function applyLinkFontColor(cell, v) {
  cell.prop('fontColor', v);
  const labels = cell.labels() || [];
  const idx = labels.findIndex(l => !(l?.attrs?.badgeBox) && !(l?.attrs?.freqText));   // the on-line user label
  if (idx >= 0) cell.label(idx, { attrs: { text: { fill: v } } });
  syncFrequencyLabel(cell);
}

// The Data Cloud mapping controls — the Connection-type → Mapping-type → Expression progressive-disclosure chain —
// rendered into `sec`, shared by the single-link panel (renderLinkProps passes [cell]) and the multi-select
// Mapping section (showMultiProperties passes the N selected links). Takes 1..n FIELD-TO-FIELD links (the caller
// gates eligibility + owns the target section); computes shared/"mixed" values and batches every write across all
// links; `onStructureChange` re-renders the panel when a control changes what the others should disclose. The
// single-link case is exactly n=1 (every value reads "same"), so the two panels can no longer drift (V6).
export function renderMappingControls(sec, links, { onStructureChange } = {}) {
  if (!links.length) return;
  const rerender = () => { if (typeof onStructureChange === 'function') onStructureChange(); };

  // Connection type (relationship ↔ mapping). kinds[0] is the single value for n=1 and the lead value for a mix.
  const kinds = links.map(l => l.prop('linkKind') === 'mapping' ? 'mapping' : 'relationship');
  addSegmented(sec, 'Connection type', kinds[0], [
    { value: 'relationship', label: 'Relationship' },
    { value: 'mapping', label: 'Mapping' },
  ], v => {
    history.startBatch();
    try { links.forEach(l => applyLinkConnectionType(l, v)); } finally { history.endBatch(); }
    rerender();   // mapping fields appear (→ mapping) or vanish (→ relationship)
  });

  // Mapping transform type + progressively-disclosed Expression — only when EVERY selected link is a mapping.
  if (links.every(l => l.prop('linkKind') === 'mapping')) {
    const types = links.map(l => MAPPING_TYPES.includes(l.prop('mappingType')) ? l.prop('mappingType') : 'Standard');
    const sameType = types.every(t => t === types[0]);
    addSelect(sec, 'Mapping type', sameType ? types[0] : 'Standard',
      MAPPING_TYPES.map(t => ({ value: t, label: t })), v => {
        history.startBatch();
        try { links.forEach(l => applyLinkMappingType(l, v)); } finally { history.endBatch(); }
        rerender();   // Expression discloses/hides for the new shared type
      });
    // Expression / rules — disclosed once the selection shares a single non-Standard type. Blank + placeholder
    // when the selection's expressions are mixed (type to set all).
    if (sameType && types[0] !== 'Standard') {
      const exprs = links.map(l => l.prop('expressionRule') || l.prop('mappingLabel') || '');
      const sameExpr = exprs.every(e => e === exprs[0]);
      addText(sec, 'Expression / rules', sameExpr ? exprs[0] : '', v => {
        history.startBatch();
        try { links.forEach(l => applyLinkExpression(l, v)); } finally { history.endBatch(); }
      }, null, sameExpr ? undefined : { placeholder: 'Multiple - type to set all' });
    }
  }
}

export function renderLinkProps(cell) {
  // Content — primary text only (Font size moved to Appearance for
  // consistency with every other shape's typography placement).
  const labelSec = section(prctx.bodyEl, 'Content');
  // A mapping link may also carry a mapping-type code badge (selector `badgeBox`), and an
  // architecture link a frequency overlay (selector `freqText`). Read the USER label past
  // both, and preserve them when the primary label is edited.
  const isBadge = l => !!(l?.attrs?.badgeBox);
  const isFreq = l => !!(l?.attrs?.freqText);
  const userLabel = (cell.labels() || []).find(l => !isBadge(l) && !isFreq(l));
  const currentLabel = userLabel?.attrs?.text?.text ?? '';
  const currentLabelSize = userLabel?.attrs?.text?.fontSize ?? 13;
  addText(labelSec, 'Label', currentLabel, v => {
    const fontSize = (cell.labels() || []).find(l => !isBadge(l) && !isFreq(l))?.attrs?.text?.fontSize ?? 13;
    // Font colour (v1.16.1) overrides the line-stroke default for the label text.
    const fillColor = cell.prop('fontColor') || cell.attr('line/stroke') || '#888888';
    // Keep the non-user labels (mapping badge + frequency overlay) when the label changes.
    const others = (cell.labels() || []).filter(l => isBadge(l) || isFreq(l));
    const arr = [];
    if (v) arr.push({
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'text', selector: 'text' },
      ],
      attrs: {
        text: { text: v, fill: fillColor, fontSize, fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', textAnchor: 'middle', textVerticalAnchor: 'middle' },
        body: { ref: 'text', refWidth: 12, refHeight: 4, refX: -6, refY: -2, fill: 'var(--bg-canvas, #FFFFFF)', stroke: 'none', rx: 2, ry: 2 },
      },
      position: { distance: 0.5, offset: 0 },
    });
    arr.push(...others);   // keep the F/ST/BT/CI badge and/or the frequency overlay
    cell.labels(arr);
    prctx.titleEl.textContent = v || '';
  });

  // Architecture only: integration-frequency overlay (clock icon + muted text below the
  // line). `connectionFrequency` is the authoritative prop; syncFrequencyLabel derives the
  // secondary label. addText already coalesces a focus session into one undo entry, so no
  // explicit history batch is needed (matches the Label setter).
  const isArchitecture = document.getElementById('canvas-container')?.dataset.diagramType === 'architecture';
  if (isArchitecture) {
    addText(labelSec, 'Frequency', cell.prop('connectionFrequency') || '', v => {
      cell.prop('connectionFrequency', v || '');
      syncFrequencyLabel(cell);
    }, cell, { placeholder: 'Real-time / Hourly / Daily' });
  }

  // Connection type is meaningful ONLY for a field→field link (a DataObject field
  // port on both ends): that link is a Data Cloud field mapping by default but can be
  // toggled to a plain ER relationship via a two-value slider. Every other connector
  // is just a relationship/line — no toggle is shown.
  const src = cell.get('source'); const tgt = cell.get('target');
  const isFieldToField = typeof src?.port === 'string' && src.port.startsWith('field-')
    && typeof tgt?.port === 'string' && tgt.port.startsWith('field-');
  if (isFieldToField) {
    // The Connection-type / Mapping-type / Expression chain — the SAME renderer the multi-select Mapping section
    // uses, with a single-link selection (n=1). One history step per switch; refresh() re-discloses on change.
    renderMappingControls(labelSec, [cell], { onStructureChange: prctx.refresh });
  }

  // Gantt dependency (Phase 3): the depType (FS/SS/FF/SF) + lag (days) ARE the data the Table view and a
  // future critical-path read. `depType` defaults to FS when unset; `lag` defaults to 0 (negative = lead).
  if (cell.prop('linkKind') === 'ganttDep') {
    const depSec = section(prctx.bodyEl, 'Dependency');
    addSelect(depSec, 'Type', cell.prop('depType') || 'FS', GANTT_DEP_TYPE_OPTS, v => cell.prop('depType', v));
    addNumber(depSec, 'Lag (days)', cell.prop('lag') ?? 0, v => cell.prop('lag', Math.round(v || 0)));
  }

  // Appearance
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Color', cell.attr('line/stroke') ?? '#888888',
    v => {
      // attrs + (mapping) badge label = one undo step; shared with the multi-select panel.
      history.startBatch();
      try { applyLinkStroke(cell, v); } finally { history.endBatch(); }
    });
  // Label color (v1.16.1) — recolours the label + frequency text + clock together; defaults to the line
  // color. Reset (↺) snaps back to the current line stroke. One undo step (label fill + freq rebuild).
  addColor(appearance, 'Label color', cell.prop('fontColor') || cell.attr('line/stroke') || '#888888',
    v => { history.startBatch(); try { applyLinkFontColor(cell, v); } finally { history.endBatch(); } },
    { defaultValue: cell.attr('line/stroke') || '#888888' });
  addSelect(appearance, 'Line style', cell.prop('lineStyle') || 'none', LINK_LINE_STYLE_OPTS,
    v => applyLinkLineStyle(cell, v));
  addNumber(appearance, 'Line width', cell.attr('line/strokeWidth') ?? 2,
    v => applyLinkStrokeWidth(cell, v));
  // Font size — connector label typography. Lives in Appearance for
  // consistency with the universal convention (text content in Content;
  // text styling in Appearance).
  addNumber(appearance, 'Font size', currentLabelSize, v => {
    const labels = cell.labels();
    if (labels.length > 0) {
      cell.label(0, { attrs: { text: { fontSize: Math.max(8, Math.min(24, v)) } } });
    }
  }, { min: 8, max: 24 });
  const stroke = cell.attr('line/stroke') || '#333333';
  const lineWidth = cell.attr('line/strokeWidth') ?? 2; // None stub follows the line weight
  // ER crow's foot markers — negative-x convention (toward element).
  // Crow's foot prongs fan out toward negative-x (toward the entity).
  // Explicit fill/stroke is set because ER markers are open paths (no
  // auto-inheritance from line).
  // All marker defs include `'stroke-dasharray': 'none'` so that when the
  // line is dashed/dotted, the marker geometry stays solid — browsers
  // (notably Safari) otherwise propagate the line's dasharray into marker
  // content at the rendering level, making arrowheads / ER notation look
  // broken.  For auto-inheriting markers (e.g. `arrow`), the explicit
  // 'none' does not override stroke/fill inheritance — it only pins the
  // dasharray.
  const markerDefs = {
    // None: simple stub line extending toward element (fills the connectionPoint gap)
    none:        { type: 'path', d: ER_MARKER_D.none, fill: 'none', stroke: stroke, 'stroke-width': lineWidth, 'stroke-dasharray': 'none' },
    // Arrow: NO explicit fill/stroke — JointJS auto-inherits from line stroke
    // and auto-trims the line at the marker boundary. Using JointJS native
    // coordinate convention: tip at negative-x, base at x=0.
    arrow:       { type: 'path', d: ER_MARKER_D.arrow, 'stroke-dasharray': 'none' },
    // Line arrow (open V): two-stroke open arrowhead, no fill. Used for
    // async/open messages on sequence diagrams; also useful as a lighter
    // alternative to the filled arrow on any diagram type. Explicit fill/
    // stroke because this is an open path (won't auto-inherit like `arrow`).
    lineArrow:   { type: 'path', d: ER_MARKER_D.lineArrow, fill: 'none', stroke: stroke, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': 'none' },
    // ── ER notation (negative-x = toward element, positive-x = toward link) ──
    // One: bar at entity end (x=-12) + stem back to line (x=0)
    one:         { type: 'path', d: ER_MARKER_D.one, fill: 'none', stroke: stroke, 'stroke-width': 2, 'stroke-dasharray': 'none' },
    // Zero-or-One: circle (line side, edge at x=2) → connecting line → bar at x=-12 (entity side)
    zeroOne:     { type: 'path', d: ER_MARKER_D.zeroOne, fill: 'var(--bg-canvas, #1A1A1A)', stroke: stroke, 'stroke-width': 2, 'stroke-dasharray': 'none' },
    // Many: crow's foot — 3 prongs fan toward element
    many:        { type: 'path', d: ER_MARKER_D.many, fill: 'none', stroke: stroke, 'stroke-width': 2, 'stroke-dasharray': 'none' },
    // One-or-Many: bar (line side) → crow's foot (entity side)
    oneMany:     { type: 'path', d: ER_MARKER_D.oneMany, fill: 'none', stroke: stroke, 'stroke-width': 2, 'stroke-dasharray': 'none' },
    // Zero-or-Many: circle (link side, 4px gap, bg-filled) → crow's foot (entity side, identical to many)
    zeroMany:    { type: 'path', d: ER_MARKER_D.zeroMany, fill: 'var(--bg-canvas, #1A1A1A)', stroke: stroke, 'stroke-width': 2, 'stroke-dasharray': 'none' },
  };
  const markerOpts = [
    { value: 'none',      label: 'None' },
    { value: 'arrow',     label: 'Arrow' },
    { value: 'lineArrow', label: 'Line Arrow' },
    { value: 'one',       label: 'One (1)' },
    { value: 'zeroOne',   label: 'Zero or One (0..1)' },
    { value: 'many',      label: 'Many (N)' },
    { value: 'oneMany',   label: 'One or Many (1..N)' },
    { value: 'zeroMany',  label: 'Zero or Many (0..N)' },
  ];
  function detectMarker(markerAttr) {
    if (!markerAttr) return 'none';
    const d = markerAttr.d ?? '';
    if (!d) return 'none';
    // Arrow: closed path with 'z'
    if (d.includes('z')) return 'arrow';
    // Line Arrow: two strokes meeting at the tip `M 0 -6 L -14 0 L 0 6` — no
    // `z`, open V. Also accept the reversed-tip form that shipped in an earlier
    // 1.6.0 build so existing diagrams keep showing the picker as "Line Arrow".
    if (/M\s*0\s+-6\s+L\s*-14\s+0\s+L\s*0\s+6/.test(d)) return 'lineArrow';
    if (/M\s*-14\s+-6\s+L\s*0\s+0\s+L\s*-14\s+6/.test(d)) return 'lineArrow';
    // Crow's foot detection: at least one prong must ORIGINATE from the (0,0)
    // central vertex — i.e. an `(L|M) 0 0` command immediately followed by
    // `L -12 8` (or symmetric `L -12 -8`). Old format `L 12 0` kept for legacy
    // diagrams.
    // Why this stricter check: the "one" marker `M -12 -8 L -12 8 M -12 0 L 0 0`
    // *also* contains both `L 0 0` (the stem) and a segment ending at `-12 8`
    // (the vertical bar's far endpoint), so the previous looser regex
    // misdetected "one" as "many". A genuine crow's foot prong always starts
    // at (0,0); the "one" bar starts at (-12, -8).
    const isCrowFoot = /(?:L|M)\s*0\s+0\s+L\s*-12\s+-?8/.test(d) || d.includes('L 12 0');
    const hasCircle = /a [345] [345]/.test(d);
    // Most specific first
    if (isCrowFoot && hasCircle) return 'zeroMany';
    if (isCrowFoot && /M [3-9] -8|M -?15/.test(d)) return 'oneMany';
    if (isCrowFoot) return 'many';
    if (hasCircle) return 'zeroOne';
    if (/M\s*-?\d+\s+-8\s*L\s*-?\d+\s+8/.test(d)) return 'one';
    return 'none';
  }
  function applyMarker(cell, markerKey, def) {
    setLinkAttrsAndRepaint(cell, (line) => {
      if (def) line[markerKey] = def;
      else delete line[markerKey];
    });
  }
  // SVG thumbnails (36×18 viewBox, 0.8× scale from marker coords).
  // Mapping: connection point at x=20, thumb_x = 20 - marker_x * 0.8, thumb_y = 9 + marker_y * 0.8.
  // Entity side = right.  Marker elements at stroke-width 2, lead line at 1.5.
  const markerSvgs = {
    none:      '<line x1="2" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="2"/>',
    arrow:     '<line x1="2" y1="9" x2="20" y2="9" stroke="currentColor" stroke-width="1.5"/><path d="M 20 4 L 31 9 L 20 14 Z" fill="currentColor"/>',
    lineArrow: '<line x1="2" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="1.5"/><path d="M 20 3 L 30 9 L 20 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>',
    one:       '<line x1="2" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="2"/><line x1="30" y1="3" x2="30" y2="15" stroke="currentColor" stroke-width="2"/>',
    zeroOne:   '<line x1="2" y1="9" x2="18" y2="9" stroke="currentColor" stroke-width="1.5"/><circle cx="22" cy="9" r="4" fill="var(--bg-canvas, #1A1A1A)" stroke="currentColor" stroke-width="2"/><line x1="26" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="2"/><line x1="30" y1="3" x2="30" y2="15" stroke="currentColor" stroke-width="2"/>',
    many:      '<line x1="2" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="1.5"/><path d="M 30 3 L 20 9 L 30 15" fill="none" stroke="currentColor" stroke-width="2"/>',
    oneMany:   '<line x1="2" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="1.5"/><line x1="18" y1="3" x2="18" y2="15" stroke="currentColor" stroke-width="2"/><path d="M 30 3 L 20 9 L 30 15" fill="none" stroke="currentColor" stroke-width="2"/>',
    zeroMany:  '<line x1="2" y1="9" x2="9" y2="9" stroke="currentColor" stroke-width="1.5"/><circle cx="13" cy="9" r="4" fill="var(--bg-canvas, #1A1A1A)" stroke="currentColor" stroke-width="2"/><line x1="17" y1="9" x2="30" y2="9" stroke="currentColor" stroke-width="1.5"/><path d="M 30 3 L 20 9 L 30 15" fill="none" stroke="currentColor" stroke-width="2"/>',
  };
  const lineStroke = cell.attr('line/stroke') || '#888888';
  addMarkerPicker(appearance, 'Source end', detectMarker(cell.attr('line/sourceMarker')), markerOpts, markerSvgs, v => {
    applyMarker(cell, 'sourceMarker', markerDefs[v]);
  }, { strokeColor: lineStroke });
  addMarkerPicker(appearance, 'Target end', detectMarker(cell.attr('line/targetMarker')), markerOpts, markerSvgs, v => {
    applyMarker(cell, 'targetMarker', markerDefs[v]);
  }, { strokeColor: lineStroke });

  // Reverse direction + Simplify path — generic link actions available on EVERY
  // connector (any diagram type), stacked at the foot of Appearance with Reverse
  // directly above Simplify, sharing one button style.
  const reverseBtn = document.createElement('button');
  reverseBtn.className = 'df-properties__btn df-properties__btn--auto-size';
  reverseBtn.style.marginTop = '6px';
  reverseBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M2 5 L13 5 M10 2 L13 5 L10 8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M14 11 L3 11 M6 8 L3 11 L6 14" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    Reverse direction`;
  reverseBtn.addEventListener('click', () => {
    // Swap endpoints — the link redraws in the opposite direction (markers follow
    // their ends). A single set keeps it one undo step.
    const s = cell.get('source'); const t = cell.get('target');
    cell.set({ source: t, target: s });
  });
  appearance.appendChild(reverseBtn);

  // Simplify path button
  const simplifyBtn = document.createElement('button');
  simplifyBtn.className = 'df-properties__btn df-properties__btn--auto-size';
  simplifyBtn.style.marginTop = '6px';
  simplifyBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M2 13 L14 3" stroke-linecap="round"/>
      <circle cx="2" cy="13" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="14" cy="3" r="1.5" fill="currentColor" stroke="none"/>
    </svg>
    Simplify path`;
  simplifyBtn.addEventListener('click', () => {
    // Two prop changes collapsed into one history command — Cmd+Z restores both
    // the prior vertices AND the prior connector in a single undo step.
    history.startBatch();
    try {
      cell.vertices([]);
      cell.connector('rounded', { radius: 8 });
    } finally {
      history.endBatch();
    }
  });
  appearance.appendChild(simplifyBtn);

  // Delete (in footer)
  addCloneBtn(prctx.footerEl, cell);
  addDeleteBtn(prctx.footerEl, () => { prctx.graph.removeCells([cell]); prctx.selection.clearSelection(); });
}

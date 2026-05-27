// Canvas module — manages the JointJS graph and paper
// Provides pan (drag blank area), zoom (mouse wheel + ctrl), grid

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
  'sf.BpmnPool':       0,
  'sf.Container':      1000,
  'sf.BpmnSubprocess': 500,
  'sf.BpmnLoop':       500,
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

// Flag set by persistence.js around every graph.fromJSON() call so the
// 'add' listener skips z-assignment and preserves the saved values.
let _isLoadingJSON = false;
export function setLoadingJSON(v) { _isLoadingJSON = v; }

// ── Auto-sizing toggle (v1.11.6) ────────────────────────────────────
// Controls whether `fitParentToChildren` is allowed to grow/shrink a
// parent based on its embedded children. Default ON. Persisted in
// localStorage so the user's choice survives reloads. The toolbar's
// Display menu drives this via setAutoSizingEnabled().
const AUTO_SIZE_LS_KEY = 'sfdiag::autoSizing';
export function isAutoSizingEnabled() {
  try {
    const v = localStorage.getItem(AUTO_SIZE_LS_KEY);
    return v === null ? true : v === 'true';
  } catch { return true; }
}
export function setAutoSizingEnabled(v) {
  try { localStorage.setItem(AUTO_SIZE_LS_KEY, String(!!v)); } catch {}
}
// Late-bound to the closure created inside init() — assigned there so the
// helper has access to the current graph/paper. `refitAllParents()` walks
// every embedding parent in the graph and refits each one. Used by the
// toolbar to tighten everything up immediately after the user re-enables
// auto sizing.
let fitParentToChildrenImpl = null;
export function refitAllParents() {
  if (!fitParentToChildrenImpl) return;
  // Built lazily so this function works regardless of when init() finished.
  // We can't reach `graph` from outside init's closure, so we walk parent
  // ids from the embedded children we can see here.
  // The fit helper already iterates children itself — we just need to know
  // which parents to feed it.
  // Recover graph via the joint global: any cellView's `paper.model` reaches
  // the graph, but cleaner is to expose it via the helper's own use of
  // graph.getElements internally. So we cheat: fitParentToChildrenImpl
  // reads `graph` from its closure, we just need to pass it the parent.
  // Helper keeps its own ref to graph through closure capture above.
  if (!_graphRef) return;
  const seen = new Set();
  _graphRef.getElements().forEach(el => {
    const pid = el.get('parent');
    if (!pid || seen.has(pid)) return;
    seen.add(pid);
    const parent = _graphRef.getCell(pid);
    if (parent) fitParentToChildrenImpl(parent);
  });
}
let _graphRef = null;

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

// ── Bridge notation at link crossings (CR-5.2 PoC) ───────────────────
// EDA-style "jump over" arcs at points where two orthogonal links cross
// without being connected. The link drawn later (higher z, on top in SVG
// paint order) stays straight; the one underneath gets a small semi-
// circular bump arc going OVER the perpendicular line, making the non-
// connection explicit. Pure overlay layer — no mutation of JointJS link
// paths, so the documented Safari <marker>-cache and dasharray-bleed bugs
// (GOTCHAS §1.x) don't apply: we use only <rect>, <line>, <path>.
const CROSSING_BUMPS_LS_KEY = 'sfdiag::crossingBumps';
export function isCrossingBumpsEnabled() {
  try {
    const v = localStorage.getItem(CROSSING_BUMPS_LS_KEY);
    if (v === null) return true;          // default ON for the PoC
    return v === 'true';
  } catch { return true; }
}
export function setCrossingBumpsEnabled(v) {
  try { localStorage.setItem(CROSSING_BUMPS_LS_KEY, String(!!v)); } catch {}
  refreshCrossingBumps();
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
export function refreshCrossingBumps() {
  if (typeof scheduleCrossingBumpRecompute === 'function') {
    scheduleCrossingBumpRecompute();
  }
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
  if (typeof scheduleCrossingBumpRecompute === 'function') {
    scheduleCrossingBumpRecompute();
  }
}

let graph, paper;
let currentZoom = 1;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.1;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let gridVisible = true;

const GRID_COLOR_DARK = 'rgba(255,255,255,0.15)';
const GRID_COLOR_LIGHT = 'rgba(0,0,0,0.25)';

function getGridColor() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? GRID_COLOR_DARK : GRID_COLOR_LIGHT;
}

/**
 * Single source of truth for embedding rules. The paper's `validateEmbedding`
 * delegates here, and shape-conversion code in properties.js uses this to
 * decide whether the converted cell can stay embedded in its previous parent
 * (e.g. converting a Node to a Container should preserve embedding when the
 * old parent is a Zone, but not when the old parent is another Container).
 */
export function canEmbed(parentType, childType) {
  if (parentType === 'sf.Container') {
    return childType !== 'sf.Container' && childType !== 'sf.Zone';
  }
  if (parentType === 'sf.Zone') {
    return childType !== 'sf.Zone';
  }
  if (parentType === 'sf.BpmnPool') {
    return childType !== 'sf.BpmnPool';
  }
  if (parentType === 'sf.BpmnSubprocess') {
    return childType !== 'sf.BpmnPool' && childType !== 'sf.BpmnSubprocess';
  }
  if (parentType === 'sf.BpmnLoop') {
    return childType !== 'sf.BpmnPool' && childType !== 'sf.BpmnSubprocess' && childType !== 'sf.BpmnLoop';
  }
  if (parentType === 'sf.GanttTimeline') {
    return childType === 'sf.GanttTask' || childType === 'sf.GanttMilestone' || childType === 'sf.GanttMarker' || childType === 'sf.GanttGroup';
  }
  if (parentType === 'sf.SequenceParticipant' || parentType === 'sf.SequenceActor') {
    return childType === 'sf.SequenceActivation';
  }
  if (parentType === 'sf.Task') {
    return childType === 'sf.OrgPerson' || childType === 'sf.Container';
  }
  return false;
}

// Perpendicular-exit orthogonal router with obstacle avoidance.
// Guarantees a 32px stub out from each port before routing, and never crosses
// non-endpoint elements. Falls back to JointJS manhattan when port info is unavailable.
function registerSfRouter() {
  const STUB = 32;  // distance from port to first turn — must exceed defaultConnectionPoint offset (16px) + arrow length (14px)
  const PAD = 16;   // clearance around obstacles (must be < STUB so stubs are outside padded zones)
  const CP_PERP_OFFSET = 16; // matches the original anchor offset — perpendicular stand-off from the cell edge to the visual line end

  // Best-effort calc() evaluator covering the handful of forms used by our
  // shape definitions: calc(w), calc(h), calc(<r> * w [+ <o>]), calc(<r> * h
  // [+ <o>]). Falls back to a plain number if no match.
  function resolveCalc(expr, w, h) {
    if (typeof expr === 'number') return expr;
    if (typeof expr !== 'string') return 0;
    // Matches `calc(ratio * dim)` or `calc(ratio * dim ± offset)`. The offset
    // group captures either a `+`-prefixed (possibly negative) number or a
    // `-`-prefixed positive number so both `+ -8` and `- 8` resolve correctly.
    const mul = expr.match(/calc\s*\(\s*([\d.]+)\s*\*\s*([whWH])\s*(?:([+-])\s*(-?[\d.]+))?\s*\)/);
    if (mul) {
      const ratio = parseFloat(mul[1]);
      const dim = mul[2].toLowerCase() === 'w' ? w : h;
      const sign = mul[3] === '-' ? -1 : 1;
      const offset = mul[4] ? sign * parseFloat(mul[4]) : 0;
      return ratio * dim + offset;
    }
    const plain = expr.match(/calc\s*\(\s*([whWH])\s*\)/);
    if (plain) return plain[1].toLowerCase() === 'w' ? w : h;
    const n = parseFloat(expr);
    return isNaN(n) ? 0 : n;
  }

  // Return {dir, stub} for a given cell+port, or null.
  function getPortInfo(cell, portId, bbox) {
    if (!cell || !bbox) return null;
    const port = (cell.get('ports')?.items || []).find(p => p.id === portId);
    if (!port?.group) return null;
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    switch (port.group) {
      case 'right':      return { dir: 'right',  stub: { x: bbox.x + bbox.width + STUB, y: cy } };
      case 'left':       return { dir: 'left',   stub: { x: bbox.x - STUB, y: cy } };
      case 'bottom':     return { dir: 'bottom', stub: { x: cx, y: bbox.y + bbox.height + STUB } };
      case 'top':        return { dir: 'top',    stub: { x: cx, y: bbox.y - STUB } };
      case 'fieldRight': return { dir: 'right',  stub: { x: bbox.x + bbox.width + STUB, y: bbox.y + (port.args?.y || cy) } };
      case 'fieldLeft':  return { dir: 'left',   stub: { x: bbox.x - STUB, y: bbox.y + (port.args?.y || cy) } };
      case 'seq-left': {
        // Anchor the stub to the port's actual x (not the cell edge) so
        // participant/actor lifeline ports (which sit at 0.5*w - offset, not
        // at the cell edge) stub out from the LIFELINE, not from the wide
        // header. Activations have port x = 0, which equals their left edge
        // — same result as before.
        const px = bbox.x + resolveCalc(port.args?.x, bbox.width, bbox.height);
        const py = bbox.y + resolveCalc(port.args?.y, bbox.width, bbox.height);
        return { dir: 'left',  stub: { x: px - STUB, y: py } };
      }
      case 'seq-right': {
        const px = bbox.x + resolveCalc(port.args?.x, bbox.width, bbox.height);
        const py = bbox.y + resolveCalc(port.args?.y, bbox.width, bbox.height);
        return { dir: 'right', stub: { x: px + STUB, y: py } };
      }
      default: return null;
    }
  }

  // ── Connector grouping (CR-5.1) ──────────────────────────────────
  // Visual signature of one link END at a port: links bundle into the same
  // trunk only when these match. Uses the custom `lineStyle` prop and the
  // marker SHAPE (path `d`) on the touching end — colour is intentionally
  // ignored so same-shape links of different colours still bundle.
  //
  // The `d` string is normalised so cosmetic differences (extra whitespace,
  // commas vs spaces, leading/trailing spaces) don't split visually-identical
  // markers into separate groups. Without this, a user-drawn link and an
  // imported link with the same marker shape but slightly different `d`
  // formatting would refuse to bundle.
  function endSignature(link, end) {
    const style = link.prop('lineStyle') || 'none';
    const marker = end === 'source'
      ? link.attr('line/sourceMarker')
      : link.attr('line/targetMarker');
    let d = (marker && marker.d) ? String(marker.d) : 'none';
    d = d.replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim();
    return `${style}|${d}`;
  }

  // All link ends touching a physical port (cell id + port id), regardless of
  // whether the link defines that port as its source or target.
  function gatherPortEnds(gr, cellId, portId) {
    const ends = [];
    for (const l of gr.getLinks()) {
      const s = l.get('source');
      const t = l.get('target');
      if (s?.id === cellId && s.port === portId) ends.push({ link: l, end: 'source' });
      if (t?.id === cellId && t.port === portId) ends.push({ link: l, end: 'target' });
    }
    return ends;
  }

  // Map a port group to a top/right/bottom/left side. Only standard four-side
  // ports are eligible for edge-fraction grouping; sequence lifeline ports and
  // DataObject field ports keep their natural anchor points (they're already
  // y-staggered, or carry UML semantics we don't want to disrupt).
  function portGroupToSide(group) {
    return (group === 'top' || group === 'right' || group === 'bottom' || group === 'left')
      ? group : null;
  }

  function getSideForPort(cell, portId) {
    if (!cell?.getPort || !portId) return null;
    const port = cell.getPort(portId);
    return portGroupToSide(port?.group);
  }

  // Edge-fraction offset for one link end at a congested port. When 2+ link
  // ends touch the same physical port, the cell's edge on that side is divided
  // into N+2 equal parts (where N = number of distinct semantic groups);
  // the two outer parts are corner buffers and the N inner parts each host
  // one group, anchored at its part's centre. Returns the signed offset from
  // the edge centre, along the edge's tangent direction. Null when the port
  // isn't congested or the side isn't standard.
  //
  // Same-signature link ends share the identical offset → they bundle into
  // one trunk. Different-signature groups land on distinct points spread
  // across the edge, so each crow's-foot variant / dashed line reads as its
  // own visual trunk anchored at its own spot on the cell border.
  function trunkAnchorOffset(link, end, cell, side) {
    if (!side || !cell) return null;
    const gr = link.graph;
    if (!gr) return null;
    const portId = link.get(end)?.port;
    if (!portId) return null;
    const ends = gatherPortEnds(gr, cell.id, portId);
    if (ends.length < 2) return null;
    // Opposite-direction pair skip — same condition as in linkChannelIndex.
    // For exactly two ends with one source + one target sharing a port
    // (e.g., one link exits the port, another link enters it), trunk
    // separation isn't needed either — the markers on outgoing vs
    // incoming links rarely collide visually (BPMN: outgoing has no
    // source marker, incoming has target arrow; ER: source markers
    // tend to be on one end only). Without the trunk Y-step the
    // incoming line reaches the port at its natural Y, matching the
    // outgoing line's exit, and the visible "dance" at the cell edge
    // disappears.
    if (ends.length === 2 && ends[0].end !== ends[1].end) return null;

    // Bucket each end by visual signature, and collect the far-end coordinate
    // along the relevant axis for ordering (x for top/bottom edges, y for
    // left/right). Ordering groups by mean far-end coordinate keeps lines
    // largely parallel and prevents the auto-layout-creates-crossings issue
    // that pure alphabetical signature-sort produced.
    const tangentAxis = (side === 'top' || side === 'bottom') ? 'x' : 'y';
    const buckets = new Map(); // signature → { coords: [], anySelf: boolean }
    for (const e of ends) {
      const sig = endSignature(e.link, e.end);
      let bucket = buckets.get(sig);
      if (!bucket) { bucket = { coords: [] }; buckets.set(sig, bucket); }
      const farRef = e.link.get(e.end === 'source' ? 'target' : 'source');
      const farCell = farRef?.id ? gr.getCell(farRef.id) : null;
      const farBB = farCell?.getBBox?.();
      if (farBB) {
        bucket.coords.push(tangentAxis === 'x'
          ? farBB.x + farBB.width / 2
          : farBB.y + farBB.height / 2);
      }
    }
    const sigEntries = [...buckets.entries()].map(([sig, b]) => ({
      sig,
      mean: b.coords.length ? b.coords.reduce((a, c) => a + c, 0) / b.coords.length : Infinity,
    }));
    // Primary: mean far-end coord (closest child gets closest anchor).
    // Tiebreak: signature string so the order stays deterministic.
    sigEntries.sort((a, b) => a.mean - b.mean || a.sig.localeCompare(b.sig));
    const N = sigEntries.length;
    const G = sigEntries.findIndex(e => e.sig === endSignature(link, end));
    if (G < 0) return null;

    const bb = cell.getBBox();
    if (!bb) return null;
    const edgeLen = tangentAxis === 'x' ? bb.width : bb.height;
    // Position of group G along the edge, normalised to [0,1]:
    // centre of the (G+1)-th interior part out of (N+2) total parts.
    // The visible jog this used to produce at the stub root is fixed in the
    // router itself via a perpendicular lead-out waypoint when an offset is
    // applied (see "trunk lead-out" block in joint.routers.sfManhattan) —
    // routing, not positioning, was the actual culprit.
    //
    // Math.round keeps the trunk offset on integer pixels. Without it
    // sub-pixel offsets (e.g. -0.125 * 195 = -24.375 px) put the router's
    // stub at a fractional x while JointJS rounds the connection point
    // to integer — the 0.5 px mismatch over the 16 px CP-to-stub segment
    // shows as a visible 2-4° tilt on the entering line and tilts the
    // endpoint marker accordingly. Integer offsets keep stub and CP
    // perfectly co-axial.
    const positionFraction = (G + 1.5) / (N + 2);
    return Math.round((positionFraction - 0.5) * edgeLen);
  }

  // Channel index for parallel-bus spreading (CR-5.3).  Returns the
  // link's index (G) within its DIRECTION-MATCHED sibling group (N
  // total) at this port, OR null when there's nothing to spread.
  //
  // Direction split: siblings whose targets sit on opposite sides of
  // the source cell's centre travel in opposite directions in the bus
  // area and their bus X ranges don't overlap — they can share the same
  // Y axis without visual conflict. Only same-direction siblings need
  // channel allocation (their bus X ranges DO overlap near the source).
  // This promotes "shared axis when no overlap" while still spreading
  // the cases where overlap would otherwise produce close-parallel piles.
  //
  // Duplicates trunkAnchorOffset's bucket build because the two end up
  // wanting different return shapes; deliberate duplication > over-
  // abstracted shared helper that mixes concerns.
  function trunkChannelIndex(link, end, cell, side) {
    if (!side || !cell) return null;
    const gr = link.graph;
    if (!gr) return null;
    const portId = link.get(end)?.port;
    if (!portId) return null;
    const ends = gatherPortEnds(gr, cell.id, portId);
    if (ends.length < 2) return null;
    const tangentAxis = (side === 'top' || side === 'bottom') ? 'x' : 'y';
    const buckets = new Map();
    for (const e of ends) {
      const sig = endSignature(e.link, e.end);
      let bucket = buckets.get(sig);
      if (!bucket) { bucket = { coords: [] }; buckets.set(sig, bucket); }
      const farRef = e.link.get(e.end === 'source' ? 'target' : 'source');
      const farCell = farRef?.id ? gr.getCell(farRef.id) : null;
      const farBB = farCell?.getBBox?.();
      if (farBB) {
        bucket.coords.push(tangentAxis === 'x'
          ? farBB.x + farBB.width / 2
          : farBB.y + farBB.height / 2);
      }
    }
    const sigEntries = [...buckets.entries()].map(([sig, b]) => ({
      sig,
      mean: b.coords.length ? b.coords.reduce((a, c) => a + c, 0) / b.coords.length : Infinity,
    }));
    sigEntries.sort((a, b) => a.mean - b.mean || a.sig.localeCompare(b.sig));
    if (sigEntries.length < 2) return null;

    const mySig = endSignature(link, end);
    const myEntry = sigEntries.find(e => e.sig === mySig);
    if (!myEntry) return null;

    // Split by direction relative to the cell's centre on the tangent axis.
    const bb = cell.getBBox();
    if (!bb) return null;
    const cellCenter = tangentAxis === 'x'
      ? bb.x + bb.width / 2
      : bb.y + bb.height / 2;
    const mySide = myEntry.mean <= cellCenter ? 'low' : 'high';
    const sameDirEntries = sigEntries.filter(e =>
      ((e.mean <= cellCenter) ? 'low' : 'high') === mySide
    );
    if (sameDirEntries.length < 2) return null;     // alone in this direction

    const G = sameDirEntries.findIndex(e => e.sig === mySig);
    if (G < 0) return null;
    return { index: G, count: sameDirEntries.length };
  }

  // Per-LINK channel index (CR-5.3 v2). Returns this link's position
  // among ALL link ends touching this port that head in the same
  // direction, OR null when there's nothing to spread.
  //
  // Differs from trunkChannelIndex in that EVERY link gets its own
  // channel — same-signature bundled links each receive a distinct
  // channel index based on target position, so they fan out into
  // visually separate buses instead of overlapping at a single shared Y.
  // This is what makes a hub-and-spoke diagram look like 4 distinct
  // connections instead of "1 line with a marker pile".
  function linkChannelIndex(link, end, cell, side) {
    if (!side || !cell) return null;
    // Self-loops bypass channel allocation. A self-loop's source and
    // target are on the same cell at different ports — its route
    // already needs to exit, go around, and come back, and adding a
    // channel offset to either end can push the lead into the cell
    // itself or otherwise produce the weird tangle reported in user
    // testing (two-node diagram with non-arrow trunk endings, then a
    // self-loop from field port back to top/bottom).
    if (link.get('source')?.id && link.get('source').id === link.get('target')?.id) return null;
    const gr = link.graph;
    if (!gr) return null;
    const portId = link.get(end)?.port;
    if (!portId) return null;
    const ends = gatherPortEnds(gr, cell.id, portId);
    if (ends.length < 2) return null;
    // Opposite-direction pair skip: exactly two ends at this port,
    // one source + one target. The trunk anchor already separates
    // them on the cell edge; adding a channel offset would create a
    // parallel "dance" of two lines at slightly different perpendicular
    // distances from the cell — visually noisier than helpful since
    // the two routes head to different targets anyway. The trunk
    // separation alone gives all the disambiguation needed.
    if (ends.length === 2 && ends[0].end !== ends[1].end) return null;
    const tangentAxis = (side === 'top' || side === 'bottom') ? 'x' : 'y';
    const bb = cell.getBBox();
    if (!bb) return null;
    const cellCenter = tangentAxis === 'x'
      ? bb.x + bb.width / 2
      : bb.y + bb.height / 2;
    // Build a list of link-end records with target coordinate + direction.
    const records = ends.map(e => {
      const farRef = e.link.get(e.end === 'source' ? 'target' : 'source');
      const farCell = farRef?.id ? gr.getCell(farRef.id) : null;
      const farBB = farCell?.getBBox?.();
      if (!farBB) return null;
      const coord = tangentAxis === 'x'
        ? farBB.x + farBB.width / 2
        : farBB.y + farBB.height / 2;
      return { linkEnd: e, coord, dir: coord <= cellCenter ? 'low' : 'high' };
    }).filter(Boolean);
    const myRec = records.find(r => r.linkEnd.link === link && r.linkEnd.end === end);
    if (!myRec) return null;
    // Direction-aware: only count same-direction siblings (opposite-
    // direction lines can share Y without visual conflict).
    const sameDir = records.filter(r => r.dir === myRec.dir);
    if (sameDir.length < 2) return null;
    // Sort by target coordinate so the leftmost / topmost target gets
    // channel 0 and channels increase consistently — keeps the visual
    // fan-out ordered with the targets it reaches.
    sameDir.sort((a, b) => a.coord - b.coord);
    const idx = sameDir.findIndex(r => r.linkEnd.link === link && r.linkEnd.end === end);
    if (idx < 0) return null;
    return { index: idx, count: sameDir.length };
  }

  // Shift a port's stub point along the edge tangent by `offset` so the
  // router exits perpendicular from the offset connection point (matching
  // what the custom connection-point function returns for the same link end).
  function applyTrunkOffset(info, side, offset) {
    if (offset == null || !info) return info;
    const stub = { x: info.stub.x, y: info.stub.y };
    if (side === 'top' || side === 'bottom') stub.x += offset;
    else stub.y += offset;
    return { dir: info.dir, stub };
  }

  // Does an axis-aligned segment (a→b) intersect the padded bbox?
  function segHitsBox(ax, ay, bx, by, box) {
    const x1 = box.x - PAD, y1 = box.y - PAD;
    const x2 = box.x + box.width + PAD, y2 = box.y + box.height + PAD;
    if (ax === bx) { // vertical
      if (ax <= x1 || ax >= x2) return false;
      const lo = Math.min(ay, by), hi = Math.max(ay, by);
      return hi > y1 && lo < y2;
    }
    if (ay === by) { // horizontal
      if (ay <= y1 || ay >= y2) return false;
      const lo = Math.min(ax, bx), hi = Math.max(ax, bx);
      return hi > x1 && lo < x2;
    }
    return false;
  }

  function pathClear(pts, obstacles) {
    for (let i = 0; i < pts.length - 1; i++) {
      for (const box of obstacles) {
        if (segHitsBox(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, box)) return false;
      }
    }
    return true;
  }

  // Try a candidate route; return it if clear, or null.
  function tryRoute(a, mid, b, obstacles) {
    const pts = [a, ...mid, b];
    return pathClear(pts, obstacles) ? mid : null;
  }

  // Build an orthogonal route between two stub points, avoiding obstacles.
  // Returns intermediate waypoints (NOT including a and b themselves).
  function orthoRoute(a, b, obstacles) {
    const sameY = Math.abs(a.y - b.y) < 2;
    const sameX = Math.abs(a.x - b.x) < 2;

    // --- L-shapes (one turn) — skip when degenerate ---
    if (!sameY && !sameX) {
      const r = tryRoute(a, [{ x: b.x, y: a.y }], b, obstacles)
             ?? tryRoute(a, [{ x: a.x, y: b.y }], b, obstacles);
      if (r) return r;
    }

    // --- Z-shapes (two turns) — skip degenerate axis ---
    if (!sameY) {
      const my = Math.round((a.y + b.y) / 2);
      const r = tryRoute(a, [{ x: a.x, y: my }, { x: b.x, y: my }], b, obstacles);
      if (r) return r;
    }
    if (!sameX) {
      const mx = Math.round((a.x + b.x) / 2);
      const r = tryRoute(a, [{ x: mx, y: a.y }, { x: mx, y: b.y }], b, obstacles);
      if (r) return r;
    }

    // --- U-shapes / detours using obstacle-edge coordinates ---
    // Collect candidate y/x values from obstacle padded edges, plus fixed offsets.
    const yBelow = new Set(), yAbove = new Set(), xRight = new Set(), xLeft = new Set();
    for (const box of obstacles) {
      yBelow.add(box.y + box.height + PAD + 4);
      yAbove.add(box.y - PAD - 4);
      xRight.add(box.x + box.width + PAD + 4);
      xLeft.add(box.x - PAD - 4);
    }
    // Also add fixed offsets from the stub range
    const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
    for (const off of [40, 80, 160, 300]) {
      yBelow.add(maxY + off); yAbove.add(minY - off);
      xRight.add(maxX + off); xLeft.add(minX - off);
    }

    // Sort candidates: prefer closest to midpoint
    const midY = (a.y + b.y) / 2, midX = (a.x + b.x) / 2;
    const yCandidates = [...yBelow, ...yAbove].sort((p, q) => Math.abs(p - midY) - Math.abs(q - midY));
    const xCandidates = [...xRight, ...xLeft].sort((p, q) => Math.abs(p - midX) - Math.abs(q - midX));

    // Try vertical detour (go to detourY, cross horizontally, return)
    for (const dy of yCandidates) {
      const r = tryRoute(a, [{ x: a.x, y: dy }, { x: b.x, y: dy }], b, obstacles);
      if (r) return r;
    }
    // Try horizontal detour (go to detourX, cross vertically, return)
    for (const dx of xCandidates) {
      const r = tryRoute(a, [{ x: dx, y: a.y }, { x: dx, y: b.y }], b, obstacles);
      if (r) return r;
    }

    // --- 5-segment S-route fallback: combine x and y detours ---
    for (const dy of yCandidates) {
      for (const dx of xCandidates) {
        const r = tryRoute(a,
          [{ x: dx, y: a.y }, { x: dx, y: dy }, { x: b.x, y: dy }],
          b, obstacles);
        if (r) return r;
      }
    }

    // Last resort: straight L (visible overlap, better than nothing)
    return [{ x: b.x, y: a.y }];
  }

  joint.routers.sfManhattan = function(vertices, args, linkView) {
    const link = linkView.model;
    const gr = link.graph;

    // During arrowhead dragging or when link is detached, graph or endpoints
    // may be unavailable — fall back to simple routing to avoid errors.
    if (!gr) return vertices;

    const srcDef = link.get('source');
    const tgtDef = link.get('target');

    // If either end is a point (no id) — e.g. during arrowhead drag — use
    // a simple normal (straight-line) router. The manhattan router is too
    // expensive to call on every pointermove and can freeze the UI.
    // Proper routing kicks in once the arrowhead snaps to a port.
    if (!srcDef?.id || !tgtDef?.id) {
      return joint.routers.normal(vertices, args, linkView);
    }

    const srcCell = gr.getCell(srcDef.id);
    const tgtCell = gr.getCell(tgtDef.id);

    // If cells have been removed from the graph (e.g. undo), bail out
    if (!srcCell || !tgtCell) return vertices;

    function getParent(cell) {
      const pid = cell?.get('parent');
      return pid ? gr.getCell(pid) : null;
    }

    const srcParent = getParent(srcCell);
    const tgtParent = getParent(tgtCell);
    const EMBED_PARENT_TYPES = new Set(['sf.Container', 'sf.SequenceParticipant', 'sf.SequenceActor']);
    const srcEmbedded = EMBED_PARENT_TYPES.has(srcParent?.get('type'));
    const tgtEmbedded = EMBED_PARENT_TYPES.has(tgtParent?.get('type'));

    const srcBBox = srcCell.getBBox();
    const tgtBBox = tgtCell.getBBox();
    let srcInfo = getPortInfo(srcCell, srcDef.port, srcBBox);
    let tgtInfo = getPortInfo(tgtCell, tgtDef.port, tgtBBox);

    // Self-loop on a sequence lifeline/activation: UML convention is to draw
    // self-messages on ONE side of the lifeline (exit right, loop down, re-
    // enter right). Without this override, a right-to-left self-loop would
    // either cross the lifeline visual or detour all the way above the
    // participant header. Force both stubs onto the source's exit side so the
    // link always stays on the same side of the lifeline.
    //
    // All three sequence shapes are lifeline-centred, so we compute the
    // anchor X from the cell's horizontal centre and stub out by the regular
    // STUB (32 px) measured from the port — matching inter-participant links
    // and guaranteeing a visible horizontal exit segment after the 16 px
    // defaultConnectionPoint offset is subtracted.
    if (srcCell === tgtCell && srcInfo && tgtInfo) {
      const type = srcCell.get('type');
      if (type === 'sf.SequenceParticipant' || type === 'sf.SequenceActor' || type === 'sf.SequenceActivation') {
        const side = srcInfo.dir === 'left' ? 'left' : 'right';
        const isNarrow = type === 'sf.SequenceActivation';
        // Port anchor X on the chosen side:
        //   Participants/Actors — port sits LIFELINE_PORT_OFFSET (8) off the
        //   cell's horizontal centre (which is the lifeline axis).
        //   Activations — ports sit on the cell edges (the narrow bar
        //   straddles the lifeline, so its edges ARE offset from the axis).
        const LIFELINE_PORT_OFFSET = 8;
        const anchorX = isNarrow
          ? (side === 'right' ? srcBBox.x + srcBBox.width : srcBBox.x)
          : (srcBBox.x + srcBBox.width / 2
              + (side === 'right' ? LIFELINE_PORT_OFFSET : -LIFELINE_PORT_OFFSET));
        const stubX = side === 'right' ? anchorX + STUB : anchorX - STUB;
        srcInfo = { dir: side, stub: { x: stubX, y: srcInfo.stub.y } };
        tgtInfo = { dir: side, stub: { x: stubX, y: tgtInfo.stub.y } };
      }
    }

    if (!srcInfo || !tgtInfo) {
      return joint.routers.normal(vertices, args, linkView);
    }

    // Connector grouping (CR-5.1): when enabled, bundle links crowding the
    // same physical port into shared trunks distributed along the cell edge.
    // Applied per end independently and never to self-loops (handled by the
    // same-side override above). The router's stub for each end is shifted
    // along the edge tangent to match the corresponding offset connection
    // point computed by joint.connectionPoints.sfConnectionPoint, so the
    // stub-to-edge segment stays perpendicular and straight.
    // Hoisted so the route-building block below can read whether either end
    // has a non-trivial trunk offset and add a perpendicular lead-out.
    //
    // Self-loop note: trunk offset DOES apply to non-sequence self-loops
    // (a DataObject field-to-top loop should distribute alongside the
    // other regular links at that top port). The previous `srcCell !==
    // tgtCell` block was too broad — it skipped trunk offset for the
    // router but `sfConnectionPoint` still applied it, so the route's
    // target stub sat at (cx, ...) while the visible line endpoint sat
    // at (cx + offset, ...). The line drew diagonally between them, the
    // ~30° angled entry you observed. Now we apply trunk offset for ALL
    // links except the sequence-self-loop special case which is
    // handled by the same-side override above.
    const _isSequenceSelfLoop = srcCell === tgtCell && (
      srcCell.get('type') === 'sf.SequenceParticipant' ||
      srcCell.get('type') === 'sf.SequenceActor' ||
      srcCell.get('type') === 'sf.SequenceActivation'
    );
    let sOff = null, tOff = null;
    if (isConnectorGroupingEnabled() && !_isSequenceSelfLoop) {
      const sSide = getSideForPort(srcCell, srcDef.port);
      const tSide = getSideForPort(tgtCell, tgtDef.port);
      sOff = sSide ? trunkAnchorOffset(link, 'source', srcCell, sSide) : null;
      tOff = tSide ? trunkAnchorOffset(link, 'target', tgtCell, tSide) : null;
      srcInfo = applyTrunkOffset(srcInfo, sSide, sOff);
      tgtInfo = applyTrunkOffset(tgtInfo, tSide, tOff);
    }

    // Build obstacle list — includes source and target so routes go AROUND them
    // (stubs are already outside the padded zones since STUB > PAD).
    // Exclude only: zones, text labels, parent containers of embedded nodes,
    // AND the source/target cell itself for SEQUENCE self-loops — the stub
    // override above places sequence self-loop stubs at lifeline±32 px (INSIDE
    // the cell's padded bbox for wide participants) so the cell must be pass-
    // through for its own loop to route. For every other self-loop the stubs
    // are outside the bbox, so keeping the cell as an obstacle forces the
    // route to go AROUND the node instead of cutting through it.
    const obstacles = [];
    const excludeIds = new Set();
    if (srcEmbedded) excludeIds.add(srcParent.id);
    if (tgtEmbedded) excludeIds.add(tgtParent.id);
    if (srcCell === tgtCell) {
      const t = srcCell.get('type');
      if (t === 'sf.SequenceParticipant' || t === 'sf.SequenceActor' || t === 'sf.SequenceActivation') {
        excludeIds.add(srcCell.id);
      }
    }

    for (const el of gr.getElements()) {
      const type = el.get('type');
      if (type === 'sf.Zone' || type === 'sf.TextLabel' || type === 'sf.Note' || type === 'sf.BpmnPool' || type === 'sf.BpmnDataObject'
        || type === 'sf.GanttTimeline' || type === 'sf.GanttGroup') continue;
      // Sequence shapes are semantically pass-through — in UML a message line
      // may cross any lifeline between source and target. Treating them as
      // obstacles forces inter-participant connectors to detour around full-
      // height columns, which looks broken. Activations are excluded too so
      // messages can cross activation bars on intervening lifelines, and
      // Fragments (loop/alt/opt frames) are excluded because messages are
      // typically drawn THROUGH them. Self-loops still get the same-side
      // override above, which is independent of the obstacle set.
      if (type === 'sf.SequenceParticipant' || type === 'sf.SequenceActor'
        || type === 'sf.SequenceActivation' || type === 'sf.SequenceFragment') continue;
      if (excludeIds.has(el.id)) continue;
      const bb = el.getBBox();
      if (bb) obstacles.push({ x: bb.x, y: bb.y, width: bb.width, height: bb.height });
    }

    const from = srcInfo.stub;
    const to = tgtInfo.stub;

    // --- Trunk lead-out -----------------------------------------------
    // When a stub is shifted along the cell edge by a non-zero trunk offset,
    // orthoRoute is free to turn immediately at the stub — and it usually
    // does, producing a visible horizontal jog right at the marker root.
    // The previous (G + 1.5) / (N + 2) spacing only hid this for the rare
    // case where a group's offset happened to be 0 (the middle of odd N).
    // The proper fix is in the route, not the position: insert one extra
    // waypoint past each offset stub along the same perpendicular direction,
    // so orthoRoute starts from there. The jog then happens LEAD_OUT pixels
    // further from the cell, hidden inside the orthogonal route geometry,
    // and the visible exit stays perpendicular for the full stub+lead-out
    // length regardless of N parity.
    const LEAD_OUT = 24;
    const extendPerp = (pt, dir, dist) => {
      switch (dir) {
        case 'top':    return { x: pt.x, y: pt.y - dist };
        case 'bottom': return { x: pt.x, y: pt.y + dist };
        case 'left':   return { x: pt.x - dist, y: pt.y };
        case 'right':  return { x: pt.x + dist, y: pt.y };
        default: return pt;
      }
    };
    // Per-link channel allocation (CR-5.3 v2). Each link end at a
    // crowded port gets its own srcLead.y / tgtLead.x channel so
    // sibling links fan out into visually distinct buses instead of
    // sharing one Y level. The lead-out point IS the channel pivot —
    // changing its position by N px deepens or shortens the
    // perpendicular run-up from the cell stub to the bus, and the bus
    // itself lands at the channel Y. The perpendicular stub stays
    // perfectly vertical (no angle artifacts).
    //
    // Direction-awareness: opposite-direction siblings (one going
    // left, one going right) skip the spread because their bus X
    // ranges don't overlap — they can share the same Y axis safely.
    // Match the same "all links except sequence self-loops" gating
    // used by the trunk offset block above. linkChannelIndex itself
    // still returns null for any self-loop (handled inside that fn).
    const _sSide = isConnectorGroupingEnabled() && !_isSequenceSelfLoop
      ? getSideForPort(srcCell, srcDef.port) : null;
    const _tSide = isConnectorGroupingEnabled() && !_isSequenceSelfLoop
      ? getSideForPort(tgtCell, tgtDef.port) : null;
    const _srcChannel = _sSide ? linkChannelIndex(link, 'source', srcCell, _sSide) : null;
    const _tgtChannel = _tSide ? linkChannelIndex(link, 'target', tgtCell, _tSide) : null;

    // Lead-out gate: ALSO require the perpendicular gap between
    // source and target stubs be large enough for two LEAD_OUTs +
    // guard to fit without inversion. Without this check, close-cell
    // pairs (gap < ~112 px) get srcLead pushed past tgtLead by the
    // default LEAD_OUT alone — orthoRoute then routes "down past the
    // target, sideways, and back up" producing the S-shape loop the
    // per-link channel clamp can't fix (the channel shift is +/- 8,
    // but the LEAD_OUT itself is +24).  When the gate fails, both
    // leads are skipped: route falls back to direct stub-to-stub
    // routing, which is naturally loop-free.
    const _perpDist = (srcInfo.dir === 'bottom' || srcInfo.dir === 'top')
      ? Math.abs(to.y - from.y)
      : Math.abs(to.x - from.x);
    const _leadOutSafe = _perpDist > (2 * LEAD_OUT + 16);

    // Lead-out is needed when EITHER a trunk offset exists (avoid the
    // horizontal-jog artifact at the stub root) OR a channel applies
    // (need a lead waypoint to shift). Single-link ports with no
    // sibling channel still skip the lead-out.
    const _needSrcLead = _leadOutSafe && ((sOff != null && Math.abs(sOff) > 1) || (_srcChannel != null));
    const _needTgtLead = _leadOutSafe && ((tOff != null && Math.abs(tOff) > 1) || (_tgtChannel != null));
    let srcLead = _needSrcLead ? extendPerp(from, srcInfo.dir, LEAD_OUT) : null;
    let tgtLead = _needTgtLead ? extendPerp(to, tgtInfo.dir, LEAD_OUT) : null;

    // Per-link channel offset clamping (CR-5.5). The naive channel
    // offset can push srcLead past the opposite stub (tgtLead/to)
    // along the perpendicular axis, causing orthoRoute to emit an
    // S-shape "loop" route that goes deep-past-target then doubles
    // back. We clamp each link's offset against the OPPOSITE end's
    // stub position so the lead can never cross it (minus a 16 px
    // guard for the orthoRoute's first turn). Per-link is more
    // surgical than a global "disable channels for close cells"
    // gate: well-spaced sibling pairs in the same crowded port still
    // get full spread; only links whose specific target geometry
    // would cause inversion get clamped to a safe partial offset.
    const _channelGuard = 16;
    const applyChannelShift = (lead, side, channelInfo, oppositeStub) => {
      if (!lead || !channelInfo) return lead;
      let offset = (channelInfo.index - (channelInfo.count - 1) / 2) * CHANNEL_HEIGHT;
      if (oppositeStub) {
        if (side === 'bottom') {
          // Lead is below source; must stay above oppositeStub.y - guard.
          const maxOff = (oppositeStub.y - _channelGuard) - lead.y;
          if (offset > maxOff) offset = Math.max(0, maxOff);
        } else if (side === 'top') {
          // Lead is above source; must stay below oppositeStub.y + guard.
          const minOff = (oppositeStub.y + _channelGuard) - lead.y;
          if (offset < minOff) offset = Math.min(0, minOff);
        } else if (side === 'right') {
          const maxOff = (oppositeStub.x - _channelGuard) - lead.x;
          if (offset > maxOff) offset = Math.max(0, maxOff);
        } else if (side === 'left') {
          const minOff = (oppositeStub.x + _channelGuard) - lead.x;
          if (offset < minOff) offset = Math.min(0, minOff);
        }
      }
      if (side === 'top' || side === 'bottom') {
        return { x: lead.x, y: lead.y + offset };
      }
      return { x: lead.x + offset, y: lead.y };
    };
    // The opposite-stub bound prevents srcLead from crossing the target
    // stub and tgtLead from crossing the source stub. Using stubs (not
    // leads) as the bound avoids the chicken-and-egg of "both leads
    // depend on each other's final channel-shifted positions".
    srcLead = applyChannelShift(srcLead, _sSide, _srcChannel, to);
    tgtLead = applyChannelShift(tgtLead, _tSide, _tgtChannel, from);

    try {
      if (vertices.length > 0) {
        // User has manual vertices — respect them; no lead-out injection
        // (the user's vertices express the intended bend points already).
        const waypoints = [from, ...vertices, to];
        const route = [from];
        for (let i = 0; i < waypoints.length - 1; i++) {
          if (i > 0) route.push(waypoints[i]);
          route.push(...orthoRoute(waypoints[i], waypoints[i + 1], obstacles));
        }
        route.push(to);
        return route;
      }

      const orthoStart = srcLead || from;
      const orthoEnd   = tgtLead || to;
      const mid = orthoRoute(orthoStart, orthoEnd, obstacles);
      const route = [from];
      if (srcLead) route.push(srcLead);
      route.push(...mid);
      if (tgtLead) route.push(tgtLead);
      route.push(to);
      return route;
    } catch (_) {
      // Fallback to direct vertices if routing calculation errors
      return vertices;
    }
  };

  // ── Custom connection point (CR-5.1) ─────────────────────────────
  // When connector grouping is enabled and a physical port is congested
  // (≥2 link ends touch it), each link end's VISUAL termination is moved
  // along the cell's edge to its semantic group's anchor point — so the
  // line actually meets the cell border at a distinct spot, not all
  // crowding the single port centre. The router's stub for the same end
  // is shifted by the same amount, keeping the stub-to-edge segment
  // perpendicular and straight.
  //
  // Falls back to JointJS's standard `anchor` connection point (offset 16,
  // matching the original paper option) when grouping is off, the port
  // isn't congested, or the side isn't one of top/right/bottom/left.
  joint.connectionPoints.sfConnectionPoint = function(line, view, magnet, opt, type, linkView) {
    const fallback = () => joint.connectionPoints.anchor(line, view, magnet, { offset: CP_PERP_OFFSET });
    try {
      if (!isConnectorGroupingEnabled()) return fallback();
      const link = linkView?.model;
      const cell = view?.model;
      if (!link || !cell) return fallback();
      const end = link.get(type); // 'source' | 'target'
      if (!end?.port) return fallback();
      const side = getSideForPort(cell, end.port);
      if (!side) return fallback();
      const offset = trunkAnchorOffset(link, type, cell, side);
      if (offset == null) return fallback();
      const bb = cell.getBBox();
      const cx = bb.x + bb.width / 2;
      const cy = bb.y + bb.height / 2;
      // Must return a g.Point — JointJS calls .round() on the result.
      switch (side) {
        case 'top':    return new joint.g.Point(cx + offset, bb.y - CP_PERP_OFFSET);
        case 'bottom': return new joint.g.Point(cx + offset, bb.y + bb.height + CP_PERP_OFFSET);
        case 'left':   return new joint.g.Point(bb.x - CP_PERP_OFFSET, cy + offset);
        case 'right':  return new joint.g.Point(bb.x + bb.width + CP_PERP_OFFSET, cy + offset);
        default:       return fallback();
      }
    } catch (_) {
      return fallback();
    }
  };

}


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
    cellViewNamespace: joint.shapes,

    // Default link when dragging from a port
    defaultLink: () => new joint.shapes.standard.Link({
      z: 0,  // 0 triggers the 'add' listener to place it in the link tier (30 000+)
      attrs: {
        line: {
          stroke: '#888888',
          strokeWidth: 2,
          sourceMarker: {
            type: 'path',
            d: 'M 0 0 L -12 0',
            fill: 'none',
            stroke: '#888888',
            'stroke-width': 2,
            'stroke-dasharray': 'none',
          },
          targetMarker: {
            type: 'path',
            d: 'M 0 -6 L -14 0 L 0 6 z',
            'stroke-dasharray': 'none',
          },
        },
      },
      router: { name: 'sfManhattan' },
      connector: { name: 'rounded', args: { radius: 8 } },
    }),

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

    // Embedding: children snap inside container-like parents
    embeddingMode: true,
    frontParentOnEmbed: false,
    findParentBy: (elementView) => {
      const childType = elementView.model.get('type');
      const bbox = elementView.model.getBBox();
      const candidates = graph.findModelsInArea(bbox).filter(
        (el) => el.id !== elementView.model.id
      );
      // For milestones/markers: if a GanttTask is found, replace it with its GanttTimeline ancestor
      if (childType === 'sf.GanttMilestone' || childType === 'sf.GanttMarker') {
        const resolved = [];
        const seen = new Set();
        for (const el of candidates) {
          let target = el;
          if (el.get('type') === 'sf.GanttTask') {
            const parentId = el.get('parent');
            if (parentId) {
              const parentEl = graph.getCell(parentId);
              if (parentEl && parentEl.get('type') === 'sf.GanttTimeline') {
                target = parentEl;
              }
            }
          }
          if (!seen.has(target.id)) {
            seen.add(target.id);
            resolved.push(target);
          }
        }
        return resolved;
      }
      return candidates;
    },
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
  paper.on('link:connect', (linkView) => {
    const link = linkView.model;
    const src = link.get('source');
    const tgt = link.get('target');
    if (!src?.id || !tgt?.id || !src.port || !tgt.port) return;
    const srcCell = graph.getCell(src.id);
    const tgtCell = graph.getCell(tgt.id);
    if (!srcCell || !tgtCell) return;
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

  // --- Focus highlight: bring hovered/selected link to top of render order ─
  //
  // SVG has no z-index — paint order is DOM document order, so a link is
  // visible above another link only if its <g> appears LATER in the parent.
  // When multiple connectors overlap (common in ER and architecture
  // diagrams with shared anchor points or middle-segment crossings), the
  // user can't tell which line they're inspecting. Bringing the hovered /
  // clicked link to the end of its parent group lifts it above the rest
  // while focused, and we restore the original order on mouseleave (unless
  // the link is selected — selection itself counts as a sustained focus).
  //
  // The restore step is what keeps the canvas from drifting into "every
  // link ever hovered is permanently on top" entropy over a long session.
  // We stash the original next-sibling and put it back when focus ends.
  const linkOriginalNext = new WeakMap();
  const bringLinkToFront = (linkView) => {
    const el = linkView?.el;
    const parent = el?.parentNode;
    if (!el || !parent) return;
    if (el === parent.lastChild) return;
    if (!linkOriginalNext.has(linkView)) {
      linkOriginalNext.set(linkView, el.nextSibling);
    }
    parent.appendChild(el);
  };
  const restoreLinkOrder = (linkView) => {
    const el = linkView?.el;
    const parent = el?.parentNode;
    if (!el || !parent) return;
    if (!linkOriginalNext.has(linkView)) return;
    const next = linkOriginalNext.get(linkView);
    linkOriginalNext.delete(linkView);
    // The saved next-sibling may have been removed (e.g. the link it
    // pointed to was deleted). If so, fall back to appendChild — the link
    // stays at the end, which is a harmless drift; better than throwing.
    try {
      if (next && next.parentNode === parent) parent.insertBefore(el, next);
      else parent.appendChild(el);
    } catch { /* defensive — DOM in unexpected state */ }
  };

  // --- Marker tint (source/target arrowheads + ER notation) -------------
  //
  // CSS can recolour the line via `[joint-selector="line"]`, but JointJS
  // v4 renders sourceMarker/targetMarker as inline SVG <path> children
  // with their own explicit `stroke` / `fill` attributes — those
  // attributes have higher specificity than CSS-inherited stroke, so the
  // markers stay grey even when the line turns blue/red on focus. To get
  // an end-to-end recolour we walk the link's DOM, snapshot every marker
  // path's stroke/fill, overwrite with --selection-color while focused,
  // then restore on unfocus.
  //
  // We skip the `wrapper` (transparent hit area) and the `line` itself
  // (already CSS-driven). Fills that are 'none' / 'transparent' /
  // reference the canvas bg variable are left alone — those are
  // "decorative gaps" in open-stroke markers (e.g. the zero-or-one circle
  // is filled with --bg-canvas to mask the underlying line) and tinting
  // them would break the masking effect.
  // Map (not WeakMap) — we need to iterate the set on each selection-
  // clearing pointerdown to find links that lost their .selected class
  // without firing a link-level event of their own (e.g. clicking blank
  // canvas deselects a link but doesn't trigger link:mouseleave).
  const linkMarkerOriginals = new Map();
  const SELECTION_COLOR_FALLBACK = '#1D73C9';
  const getSelectionColor = () => {
    try {
      const c = getComputedStyle(document.documentElement)
        .getPropertyValue('--selection-color').trim();
      return c || SELECTION_COLOR_FALLBACK;
    } catch { return SELECTION_COLOR_FALLBACK; }
  };
  const isPreservedFill = (val) => {
    if (!val) return true;
    const v = val.trim().toLowerCase();
    return v === 'none' || v === 'transparent' || v.includes('bg-canvas');
  };
  const tintPath = (p, color, saved) => {
    const origStroke = p.getAttribute('stroke');
    const origFill = p.getAttribute('fill');
    saved.push({ el: p, origStroke, origFill });
    // Override stroke unconditionally — markers either have an explicit
    // stroke we want to swap, or none (auto-inherit) in which case
    // setting it makes the recolour explicit and visible.
    p.setAttribute('stroke', color);
    // Only override "real" fills — leave masking fills (none / bg) intact
    // so the circular open-stroke markers keep their visual notch.
    if (!isPreservedFill(origFill)) p.setAttribute('fill', color);
  };
  // Counter for unique clone-marker IDs. JointJS pools shared <marker>
  // defs (every link with the same arrow style points at the SAME
  // <marker>), so tinting the def in place leaks the colour to every
  // sibling link. We clone the marker, give it a fresh id, tint the
  // clone, and re-point the focused line at the clone. Restore puts the
  // original ref back and removes the clone.
  let focusMarkerCloneSeq = 0;
  const tintLinkMarkers = (linkView) => {
    const el = linkView?.el;
    if (!el || linkMarkerOriginals.has(linkView)) return;
    const color = getSelectionColor();
    const saved = [];           // direct path tints (inline marker case)
    const markerSwaps = [];     // { lineEl, attrName, origRef, cloneEl }

    // (A) Inline marker paths — JointJS v4 may render
    // sourceMarker/targetMarker as <path> children of the link group
    // (with a joint-selector like "line"/"sourceMarker"). Those aren't
    // shared between links so tinting them in place is safe.
    el.querySelectorAll('path').forEach(p => {
      const sel = p.getAttribute('joint-selector');
      if (sel === 'wrapper' || sel === 'line') return;
      tintPath(p, color, saved);
    });

    // (B) <marker> defs — the shared-pool rendering path. Clone, tint
    // the clone, swap the line's marker-start / marker-end ref.
    const line = el.querySelector('[joint-selector="line"]');
    const root = el.ownerSVGElement;
    const defs = root?.querySelector('defs');
    if (line && root && defs) {
      for (const attrName of ['marker-start', 'marker-end']) {
        const ref = line.getAttribute(attrName);
        if (!ref) continue;
        const m = ref.match(/url\(#([^)]+)\)/);
        if (!m) continue;
        const origMarker = root.getElementById(m[1]);
        if (!origMarker) continue;
        const cloneId = `sf-focus-marker-${++focusMarkerCloneSeq}`;
        const cloneEl = origMarker.cloneNode(true);
        cloneEl.setAttribute('id', cloneId);
        cloneEl.querySelectorAll('path').forEach(p => {
          const origFill = p.getAttribute('fill');
          p.setAttribute('stroke', color);
          if (!isPreservedFill(origFill)) p.setAttribute('fill', color);
        });
        defs.appendChild(cloneEl);
        markerSwaps.push({ lineEl: line, attrName, origRef: ref, cloneEl });
        line.setAttribute(attrName, `url(#${cloneId})`);
      }
    }

    linkMarkerOriginals.set(linkView, { saved, markerSwaps });
  };
  const restoreLinkMarkers = (linkView) => {
    const data = linkMarkerOriginals.get(linkView);
    if (!data) return;
    linkMarkerOriginals.delete(linkView);
    const { saved, markerSwaps } = data;
    saved.forEach(({ el, origStroke, origFill }) => {
      if (origStroke == null) el.removeAttribute('stroke');
      else el.setAttribute('stroke', origStroke);
      if (origFill == null) el.removeAttribute('fill');
      else el.setAttribute('fill', origFill);
    });
    markerSwaps.forEach(({ lineEl, attrName, origRef, cloneEl }) => {
      // Only put origRef back if the line is still pointing at OUR clone.
      // If the user changed the marker style mid-focus (e.g. swapped the
      // target end via the property picker while the link was selected),
      // JointJS re-rendered the line with a fresh `url(#new-marker-id)` —
      // our origRef is now stale and writing it back would resurrect the
      // pre-change marker on deselect. The clone is removed unconditionally
      // because it has no further purpose either way.
      const currentRef = lineEl.getAttribute(attrName) || '';
      if (currentRef.includes(cloneEl.id)) {
        lineEl.setAttribute(attrName, origRef);
      }
      cloneEl.parentNode?.removeChild(cloneEl);
    });
  };

  // Sweep tinted links and restore any that are no longer focused —
  // i.e. neither hovered (:hover) nor selected (.selected). Called from
  // pointerdown handlers that could clear selection without firing a
  // link-level event on the just-deselected link.
  //
  // Deferred via queueMicrotask so selection.js's pointerdown handler
  // (registered AFTER canvas.init by app.js) gets to add/remove .selected
  // first. Without this defer, sweeping during link:pointerdown would
  // see the just-deselected link still marked .selected and leave it tinted.
  // Bump tinting on focus — when a link is hovered or selected, also
  // re-stroke any bump arcs/restoration lines tagged with its id so
  // the focus colour runs end-to-end with the line.  Mirrors the
  // marker-tinting pattern: a per-link-id Set tracks which links are
  // currently tinted, the sweep restores stale entries.
  const _bumpsTinted = new Set();
  const tintLinkBumps = (linkView) => {
    if (!_bumpLayer) return;
    const linkId = linkView?.model?.id;
    if (!linkId || _bumpsTinted.has(linkId)) return;
    _bumpsTinted.add(linkId);
    const color = getSelectionColor();
    _bumpLayer.querySelectorAll(`[data-link-id="${CSS.escape(String(linkId))}"]`).forEach(el => {
      if (!el.hasAttribute('data-orig-stroke')) {
        el.setAttribute('data-orig-stroke', el.getAttribute('stroke') ?? '');
      }
      el.setAttribute('stroke', color);
    });
  };
  const restoreLinkBumps = (linkView) => {
    if (!_bumpLayer) return;
    const linkId = linkView?.model?.id;
    if (!linkId || !_bumpsTinted.has(linkId)) return;
    _bumpsTinted.delete(linkId);
    _bumpLayer.querySelectorAll(`[data-link-id="${CSS.escape(String(linkId))}"]`).forEach(el => {
      const orig = el.getAttribute('data-orig-stroke');
      if (orig == null) return;
      if (orig) el.setAttribute('stroke', orig);
      else el.removeAttribute('stroke');
      el.removeAttribute('data-orig-stroke');
    });
  };

  const sweepStaleMarkerTints = () => queueMicrotask(() => {
    for (const linkView of [...linkMarkerOriginals.keys()]) {
      const el = linkView?.el;
      if (!el) { linkMarkerOriginals.delete(linkView); continue; }
      const stillFocused = el.classList.contains('selected') || el.matches(':hover');
      if (!stillFocused) {
        restoreLinkMarkers(linkView);
        restoreLinkOrder(linkView);
      }
    }
    // Sweep stale bump tints alongside markers — same focus semantics.
    for (const linkId of [..._bumpsTinted]) {
      const view = paper.findViewByModel(linkId);
      const stillFocused = view?.el?.classList.contains('selected')
                        || view?.el?.matches(':hover');
      if (!stillFocused) restoreLinkBumps(view || { model: { id: linkId } });
    }
  });

  paper.on('link:mouseenter', (linkView) => {
    bringLinkToFront(linkView);
    tintLinkMarkers(linkView);
    tintLinkBumps(linkView);
  });
  paper.on('link:mouseleave', (linkView) => {
    // Keep selected links lifted — selection is sustained focus.
    if (linkView?.el?.classList.contains('selected')) return;
    restoreLinkOrder(linkView);
    restoreLinkMarkers(linkView);
    restoreLinkBumps(linkView);
  });
  paper.on('link:pointerdown', (linkView) => {
    bringLinkToFront(linkView);
    tintLinkMarkers(linkView);
    tintLinkBumps(linkView);
    // Clicking link A deselects link B; sweep restores B's markers/bumps.
    sweepStaleMarkerTints();
  });
  paper.on('blank:pointerdown', sweepStaleMarkerTints);
  paper.on('element:pointerdown', sweepStaleMarkerTints);

  // When attrs change on a currently-focused link (most commonly: the
  // user changing source/target end style via the property picker while
  // the link is selected), JointJS re-renders the line with a fresh
  // marker URL. Our clone is now orphaned and the line is showing the
  // new (un-tinted) marker. Defer one microtask so JointJS finishes its
  // re-render, then tear down our stale tint and re-tint against the
  // freshly rendered markers so the focus colour stays consistent.
  graph.on('change:attrs', (cell) => {
    if (!cell.isLink()) return;
    const linkView = paper.findViewByModel(cell);
    if (!linkView || !linkMarkerOriginals.has(linkView)) return;
    queueMicrotask(() => {
      if (!linkMarkerOriginals.has(linkView)) return;
      restoreLinkMarkers(linkView);
      tintLinkMarkers(linkView);
    });
  });

  // --- Pan (drag on blank canvas area) ---
  paper.on('blank:pointerdown', (evt) => {
    if (evt.shiftKey) return; // shift+drag is rubber-band in selection.js
    if (evt.pointerType === 'touch') return; // touch pan handled separately
    isPanning = true;
    panStart = { x: evt.clientX, y: evt.clientY };
    document.body.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (evt) => {
    if (!isPanning) return;
    const dx = evt.clientX - panStart.x;
    const dy = evt.clientY - panStart.y;
    panStart = { x: evt.clientX, y: evt.clientY };
    const t = paper.translate();
    paper.translate(t.tx + dx, t.ty + dy);
  });

  document.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      document.body.style.cursor = '';
    }
  });

  // --- Touch: single-finger pan + pinch-to-zoom ---
  let touchPanStart = null;
  let touchPinchDist = null;
  let touchPinchZoom = null;
  let touchPinchCenter = null;

  const canvasEl = document.getElementById('canvas-container');

  canvasEl.addEventListener('touchstart', (evt) => {
    if (evt.touches.length === 1) {
      // Single-finger → pan
      touchPanStart = { x: evt.touches[0].clientX, y: evt.touches[0].clientY };
      touchPinchDist = null;
    } else if (evt.touches.length === 2) {
      // Two-finger → pinch zoom
      touchPanStart = null;
      const dx = evt.touches[1].clientX - evt.touches[0].clientX;
      const dy = evt.touches[1].clientY - evt.touches[0].clientY;
      touchPinchDist = Math.hypot(dx, dy);
      touchPinchZoom = currentZoom;
      touchPinchCenter = {
        x: (evt.touches[0].clientX + evt.touches[1].clientX) / 2,
        y: (evt.touches[0].clientY + evt.touches[1].clientY) / 2,
      };
      evt.preventDefault();
    }
  }, { passive: false });

  canvasEl.addEventListener('touchmove', (evt) => {
    if (evt.touches.length === 1 && touchPanStart) {
      // Single-finger pan
      const dx = evt.touches[0].clientX - touchPanStart.x;
      const dy = evt.touches[0].clientY - touchPanStart.y;
      touchPanStart = { x: evt.touches[0].clientX, y: evt.touches[0].clientY };
      const t = paper.translate();
      paper.translate(t.tx + dx, t.ty + dy);
      evt.preventDefault();
    } else if (evt.touches.length === 2 && touchPinchDist != null) {
      // Pinch zoom
      const dx = evt.touches[1].clientX - evt.touches[0].clientX;
      const dy = evt.touches[1].clientY - evt.touches[0].clientY;
      const dist = Math.hypot(dx, dy);
      const scale = dist / touchPinchDist;
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, touchPinchZoom * scale));
      if (newZoom !== currentZoom) {
        const paperRect = paper.el.getBoundingClientRect();
        const cx = touchPinchCenter.x - paperRect.left;
        const cy = touchPinchCenter.y - paperRect.top;
        const t = paper.translate();
        const s = newZoom / currentZoom;
        paper.scale(newZoom, newZoom);
        paper.translate(cx - s * (cx - t.tx), cy - s * (cy - t.ty));
        currentZoom = newZoom;
        updateZoomDisplay();
      }
      evt.preventDefault();
    }
  }, { passive: false });

  canvasEl.addEventListener('touchend', () => {
    touchPanStart = null;
    if (touchPinchDist != null) {
      touchPinchDist = null;
      touchPinchZoom = null;
      touchPinchCenter = null;
    }
  });

  // --- Zoom (pinch) and Pan (two-finger scroll) ---
  paper.el.addEventListener('wheel', (evt) => {
    evt.preventDefault();

    // On macOS, pinch gesture sets ctrlKey=true; two-finger scroll sets ctrlKey=false
    if (!evt.ctrlKey) {
      // Two-finger scroll → pan the canvas
      const t = paper.translate();
      paper.translate(t.tx - evt.deltaX, t.ty - evt.deltaY);
      return;
    }

    // Pinch → zoom toward cursor (proportional to pinch speed)
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX,
      currentZoom * Math.pow(0.996, evt.deltaY)
    ));
    if (newZoom === currentZoom) return;

    const paperRect = paper.el.getBoundingClientRect();
    const mouseX = evt.clientX - paperRect.left;
    const mouseY = evt.clientY - paperRect.top;
    const t = paper.translate();
    const scale = newZoom / currentZoom;
    const newTx = mouseX - scale * (mouseX - t.tx);
    const newTy = mouseY - scale * (mouseY - t.ty);

    paper.scale(newZoom, newZoom);
    paper.translate(newTx, newTy);
    currentZoom = newZoom;
    updateZoomDisplay();
  }, { passive: false });

  // --- Node-edge alignment snapping (guides) ---
  const SNAP_THRESHOLD = 8; // px in model space
  // Sequential-spacing detection (CR-6.1) — DETECTION tolerance for
  // "show the hint" (10 px, slightly looser than edge SNAP_THRESHOLD
  // so the dimension lines appear as the user approaches the rhythm).
  // SNAP tolerance is tighter (4 px, the grid step) — magnetic pull
  // only fires when the user is "fighting" the last few pixels, so it
  // doesn't yank them off course when they're still deliberately
  // positioning between rhythms.
  const SPACING_TOL = 10;
  const SPACING_SNAP_TOL = 4;

  // Cache built at pointerdown so the per-frame work in pointermove is
  // small. Cleared at pointerup. Stores only the peer elements that
  // share the dragged element's container context — un-embedded peers
  // when the dragged is un-embedded, or same-parent peers when it's
  // inside a container. Skips Zones / TextLabels / Notes (background
  // shapes that don't carry layout rhythm).
  let _spacingDragContext = null;
  function buildSpacingDragContext(moved) {
    if (!moved) return null;
    const movedParent = moved.get('parent') || null;
    const NON_RHYTHM_TYPES = new Set([
      'sf.Zone', 'sf.TextLabel', 'sf.Note', 'sf.BpmnPool',
      'sf.GanttTimeline', 'sf.GanttGroup',
    ]);
    const peers = graph.getElements()
      .filter(el => {
        if (el.id === moved.id) return false;
        if (el.isEmbeddedIn(moved)) return false;
        if (moved.isEmbeddedIn(el)) return false;
        if (NON_RHYTHM_TYPES.has(el.get('type'))) return false;
        return (el.get('parent') || null) === movedParent;
      })
      .map(el => ({ id: el.id, bb: el.getBBox() }));
    return peers.length >= 2 ? { peers } : null;
  }

  // Look for a sequential rhythm where the dragged element extends or
  // sits inside a pair of peers on the given axis, with edge-to-edge
  // gaps matching within SPACING_TOL. Returns the closest match (smallest
  // delta) or null.
  //
  // Three cases handled per pair (A, B) sorted by axis-center:
  //   A → B → Dragged    (gap on right side matches A↔B gap)
  //   Dragged → A → B    (gap on left side matches A↔B gap)
  //   A → Dragged → B    (Dragged sits between A and B at equal gap to each)
  //
  // Gaps are EDGE-TO-EDGE — the visible space between elements, not
  // their center-to-center distance — so different-sized shapes still
  // register a rhythm match when their visible spacing is consistent.
  function findSequentialSpacing(movedBB, peers, axis) {
    // Helper: get "near" and "far" edges along the axis
    const edgeNear = (bb) => axis === 'x' ? bb.x : bb.y;
    const edgeFar  = (bb) => axis === 'x'
      ? bb.x + bb.width
      : bb.y + bb.height;
    // Row/column peers: must overlap with moved on the perpendicular axis.
    const movedPerpMin = axis === 'x' ? movedBB.y : movedBB.x;
    const movedPerpMax = movedPerpMin + (axis === 'x' ? movedBB.height : movedBB.width);
    const rowPeers = [];
    for (const p of peers) {
      const peerPerpMin = axis === 'x' ? p.bb.y : p.bb.x;
      const peerPerpMax = peerPerpMin + (axis === 'x' ? p.bb.height : p.bb.width);
      if (peerPerpMin < movedPerpMax && peerPerpMax > movedPerpMin) {
        rowPeers.push({
          bb: p.bb,
          near: edgeNear(p.bb),
          far: edgeFar(p.bb),
          center: (edgeNear(p.bb) + edgeFar(p.bb)) / 2,
        });
      }
    }
    if (rowPeers.length < 2) return null;
    rowPeers.sort((a, b) => a.center - b.center);

    const mNear = edgeNear(movedBB);
    const mFar  = edgeFar(movedBB);
    const mCenter = (mNear + mFar) / 2;

    let best = null;
    const considerMatch = (Apeer, Bpeer, expectedCenter, gap) => {
      const delta = Math.abs(mCenter - expectedCenter);
      if (delta > SPACING_TOL) return;
      // Spatial proximity: how far the peers sit from the dragged
      // element on the axis. Closer peers (smaller sum-of-distances)
      // are the visually obvious rhythm — when multiple matches fall
      // within tolerance, pick the one with the nearest peers. Without
      // this tiebreaker, a faraway pair could "win" over the closer,
      // visually-relevant pair just because its expected position
      // happens to align by chance.
      const proximity = Math.abs(mCenter - Apeer.center)
                      + Math.abs(mCenter - Bpeer.center);
      if (!best
          || delta < best.delta
          || (delta === best.delta && proximity < best.proximity)) {
        best = { delta, expectedCenter, gap, A: Apeer.bb, B: Bpeer.bb, proximity };
      }
    };
    for (let i = 0; i < rowPeers.length - 1; i++) {
      const A = rowPeers[i];
      const B = rowPeers[i + 1];
      // Edge-to-edge gap between A and B (visible space).
      const gap = B.near - A.far;
      if (gap < 8) continue;     // pairs that touch or overlap — no rhythm

      // CASE 1: dragged extends sequence past B (A → B → Dragged)
      //   Required: D.near = B.far + gap  →  D.center = B.far + gap + D.width/2
      if (mCenter > B.center) {
        const expectedNear = B.far + gap;
        const expectedCenter = expectedNear + (mFar - mNear) / 2;
        considerMatch(A, B, expectedCenter, gap);
      }
      // CASE 2: dragged extends sequence before A (Dragged → A → B)
      //   Required: D.far = A.near - gap  →  D.center = A.near - gap - D.width/2
      if (mCenter < A.center) {
        const expectedFar = A.near - gap;
        const expectedCenter = expectedFar - (mFar - mNear) / 2;
        considerMatch(A, B, expectedCenter, gap);
      }
      // CASE 3: dragged sits BETWEEN A and B at equal edge-gap (A → D → B)
      //   Required: D.near - A.far = B.near - D.far
      //   Solving: 2 * D.center = (A.far + B.near) + (D.far - D.near)
      //          = A.far + B.near + D.width
      //   But D.width cancels out: equal-gap means D is centered between
      //   A.far and B.near, regardless of D's own width.
      //   D.center = (A.far + B.near) / 2
      //   Gap shown = ((B.near - A.far) - D.width) / 2
      if (mCenter > A.center && mCenter < B.center) {
        const innerSpan = B.near - A.far;
        const dWidth = mFar - mNear;
        const halfGap = (innerSpan - dWidth) / 2;
        if (halfGap >= 8) {
          considerMatch(A, B, (A.far + B.near) / 2, halfGap);
        }
      }
    }
    return best;
  }

  // Render two dimension lines + per-segment px labels showing the
  // EDGE-TO-EDGE visible gaps. Labels reflect actual current distance
  // — they update live as the user drags within the snap tolerance,
  // so "180px / 180px" → "182px / 178px" → "180px / 180px" reads as
  // continuous feedback rather than a fixed rhythm match.
  function drawSpacingDimensions(match, axis, movedBB) {
    const layer = getGuideLayer();
    const amber = 'var(--brand-amber, #F6B355)';
    const TICK = 4;
    const LABEL_OFFSET = 4;

    if (axis === 'x') {
      // Three element near/far X edges + the dragged element's edges,
      // sorted left→right so we can pair adjacent edges into two gaps.
      const allEdges = [
        { near: match.A.x,                far: match.A.x + match.A.width },
        { near: match.B.x,                far: match.B.x + match.B.width },
        { near: movedBB.x,                far: movedBB.x + movedBB.width },
      ].sort((p, q) => p.near - q.near);

      const baselineY = Math.max(
        match.A.y + match.A.height,
        match.B.y + match.B.height,
        movedBB.y + movedBB.height,
      ) + 18;

      // Two gaps: between elements 0–1 and 1–2 in sorted order
      const gap1 = allEdges[1].near - allEdges[0].far;
      const gap2 = allEdges[2].near - allEdges[1].far;
      drawDimSegment(layer, allEdges[0].far, allEdges[1].near, baselineY, gap1, 'h', amber, TICK, LABEL_OFFSET);
      drawDimSegment(layer, allEdges[1].far, allEdges[2].near, baselineY, gap2, 'h', amber, TICK, LABEL_OFFSET);
    } else {
      const allEdges = [
        { near: match.A.y,                far: match.A.y + match.A.height },
        { near: match.B.y,                far: match.B.y + match.B.height },
        { near: movedBB.y,                far: movedBB.y + movedBB.height },
      ].sort((p, q) => p.near - q.near);

      const baselineX = Math.max(
        match.A.x + match.A.width,
        match.B.x + match.B.width,
        movedBB.x + movedBB.width,
      ) + 18;

      const gap1 = allEdges[1].near - allEdges[0].far;
      const gap2 = allEdges[2].near - allEdges[1].far;
      // drawDimSegment signature: (layer, p1, p2, perp, gap, orient).
      // For 'v' orientation, p1/p2 are Y endpoints and perp is the X
      // baseline. The previous code had them swapped, sending the
      // baselineX through as p1 — drawing the line in arbitrary
      // coordinates depending on whatever Y value landed in perp.
      drawDimSegment(layer, allEdges[0].far, allEdges[1].near, baselineX, gap1, 'v', amber, TICK, LABEL_OFFSET);
      drawDimSegment(layer, allEdges[1].far, allEdges[2].near, baselineX, gap2, 'v', amber, TICK, LABEL_OFFSET);
    }
  }

  function drawDimSegment(layer, p1, p2, perp, gap, orient, color, tick, labelOff) {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const line = document.createElementNS(SVG_NS, 'line');
    const t1a = document.createElementNS(SVG_NS, 'line');
    const t1b = document.createElementNS(SVG_NS, 'line');
    const text = document.createElementNS(SVG_NS, 'text');
    if (orient === 'h') {
      // p1, p2 are X values; perp is the Y baseline.
      line.setAttribute('x1', p1); line.setAttribute('x2', p2);
      line.setAttribute('y1', perp); line.setAttribute('y2', perp);
      t1a.setAttribute('x1', p1); t1a.setAttribute('x2', p1);
      t1a.setAttribute('y1', perp - tick); t1a.setAttribute('y2', perp + tick);
      t1b.setAttribute('x1', p2); t1b.setAttribute('x2', p2);
      t1b.setAttribute('y1', perp - tick); t1b.setAttribute('y2', perp + tick);
      text.setAttribute('x', (p1 + p2) / 2);
      text.setAttribute('y', perp - labelOff);
      text.setAttribute('text-anchor', 'middle');
    } else {
      // p1, p2 are Y values; perp is the X baseline.
      line.setAttribute('x1', perp); line.setAttribute('x2', perp);
      line.setAttribute('y1', p1); line.setAttribute('y2', p2);
      t1a.setAttribute('x1', perp - tick); t1a.setAttribute('x2', perp + tick);
      t1a.setAttribute('y1', p1); t1a.setAttribute('y2', p1);
      t1b.setAttribute('x1', perp - tick); t1b.setAttribute('x2', perp + tick);
      t1b.setAttribute('y1', p2); t1b.setAttribute('y2', p2);
      text.setAttribute('x', perp + labelOff + 2);
      text.setAttribute('y', (p1 + p2) / 2 + 4);
      text.setAttribute('text-anchor', 'start');
    }
    for (const el of [line, t1a, t1b]) {
      el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', 1);
      el.setAttribute('opacity', 0.85);
      layer.appendChild(el);
    }
    text.setAttribute('fill', color);
    text.setAttribute('font-size', '11');
    text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    text.setAttribute('font-weight', '600');
    text.textContent = `${Math.round(gap)}px`;
    layer.appendChild(text);
  }
  let guideLayer = null;

  function getGuideLayer() {
    if (!guideLayer || !guideLayer.parentNode) {
      guideLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      guideLayer.setAttribute('class', 'sf-alignment-guides');
      // Append inside joint-layers so guides inherit the paper translate/scale transform
      const layers = paper.svg.querySelector('.joint-layers');
      if (layers) {
        layers.appendChild(guideLayer);
      } else {
        paper.svg.appendChild(guideLayer);
      }
    }
    return guideLayer;
  }

  function clearGuides() {
    if (guideLayer) guideLayer.innerHTML = '';
  }

  function drawGuide(x1, y1, x2, y2) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', 'var(--color-primary)');
    line.setAttribute('stroke-width', 0.5);
    line.setAttribute('stroke-dasharray', '4 3');
    line.setAttribute('opacity', '0.7');
    getGuideLayer().appendChild(line);
  }

  // Build the spacing-detection context at drag start (= when the
  // first pointermove confirms a drag is happening). We use a lazy
  // build inside the move handler so we don't pay this cost on every
  // pointerdown — most clicks don't turn into drags.
  paper.on('element:pointerdown', (cellView) => {
    const moved = cellView?.model;
    if (!moved) { _spacingDragContext = null; return; }
    // Defer the actual build until first move to save click-only cost;
    // tag it with the cell id so the build can be lazy and idempotent.
    _spacingDragContext = { pendingForId: moved.id };
  });
  paper.on('element:pointerup', () => {
    _spacingDragContext = null;
  });

  paper.on('element:pointermove', (cellView) => {
    clearGuides();
    const movedEl = cellView.model;
    // Skip snap-to-grid for embedded children — they move with their parent
    // Also skip for elements with embedded children to prevent drift
    if (movedEl.get('parent') || movedEl.getEmbeddedCells().length) return;
    // Lazy-build the spacing context on the first frame of the drag.
    if (_spacingDragContext?.pendingForId === movedEl.id) {
      _spacingDragContext = buildSpacingDragContext(movedEl);
    }
    const movedBBox = movedEl.getBBox();
    const allElements = graph.getElements().filter(el =>
      el.id !== movedEl.id && !el.isEmbeddedIn(movedEl) && !movedEl.isEmbeddedIn(el)
    );

    // Find best snap for X and Y independently, tracking which edges matched
    let bestX = null; // { dx, movedVal, otherVal, others: [{bb}] }
    let bestY = null;

    const movedL = movedBBox.x, movedR = movedBBox.x + movedBBox.width, movedCx = movedBBox.x + movedBBox.width / 2;
    const movedT = movedBBox.y, movedB = movedBBox.y + movedBBox.height, movedCy = movedBBox.y + movedBBox.height / 2;

    for (const other of allElements) {
      const bb = other.getBBox();
      const oL = bb.x, oR = bb.x + bb.width, oCx = bb.x + bb.width / 2;
      const oT = bb.y, oB = bb.y + bb.height, oCy = bb.y + bb.height / 2;

      // X-axis: check moved edges vs other edges
      for (const [mv, ov] of [[movedL, oL], [movedL, oR], [movedR, oL], [movedR, oR], [movedCx, oCx]]) {
        const diff = ov - mv;
        if (Math.abs(diff) < SNAP_THRESHOLD && (!bestX || Math.abs(diff) < Math.abs(bestX.dx))) {
          bestX = { dx: diff, snapX: ov, bb };
        }
      }

      // Y-axis
      for (const [mv, ov] of [[movedT, oT], [movedT, oB], [movedB, oT], [movedB, oB], [movedCy, oCy]]) {
        const diff = ov - mv;
        if (Math.abs(diff) < SNAP_THRESHOLD && (!bestY || Math.abs(diff) < Math.abs(bestY.dx))) {
          bestY = { dx: diff, snapY: ov, bb };
        }
      }
    }

    const dx = bestX ? bestX.dx : 0;
    const dy = bestY ? bestY.dx : 0;

    if (dx !== 0 || dy !== 0) {
      const pos = movedEl.position();
      movedEl.position(pos.x + dx, pos.y + dy, { skipHistory: true });
    }

    // Draw guides only for the snapped axis, plus any secondary edge matches on the same element
    const finalBBox = movedEl.getBBox();
    const fL = finalBBox.x, fR = finalBBox.x + finalBBox.width, fCx = finalBBox.x + finalBBox.width / 2;
    const fT = finalBBox.y, fB = finalBBox.y + finalBBox.height, fCy = finalBBox.y + finalBBox.height / 2;

    if (bestX) {
      const ob = bestX.bb;
      const oEdgesX = [ob.x, ob.x + ob.width, ob.x + ob.width / 2];
      const mEdgesX = [fL, fR, fCx];
      for (const mx of mEdgesX) {
        for (const ox of oEdgesX) {
          if (Math.abs(mx - ox) < 1) {
            const minY = Math.min(finalBBox.y, ob.y) - 10;
            const maxY = Math.max(fB, ob.y + ob.height) + 10;
            drawGuide(mx, minY, mx, maxY);
          }
        }
      }
    }
    if (bestY) {
      const ob = bestY.bb;
      const oEdgesY = [ob.y, ob.y + ob.height, ob.y + ob.height / 2];
      const mEdgesY = [fT, fB, fCy];
      for (const my of mEdgesY) {
        for (const oy of oEdgesY) {
          if (Math.abs(my - oy) < 1) {
            const minX = Math.min(finalBBox.x, ob.x) - 10;
            const maxX = Math.max(fR, ob.x + ob.width) + 10;
            drawGuide(minX, my, maxX, my);
          }
        }
      }
    }

    // Sequential-spacing hint + snap (CR-6.1) — only on axes where edge
    // alignment didn't fire. Absolute alignment beats relative spacing
    // per the priority matrix; we don't want both axes of guide on the
    // same axis.
    //
    // Magnetic snap: when a match is found, pull the dragged element
    // to the exact expectedCenter so the labels read "55px / 55px"
    // instead of "54px / 56px". Same skipHistory contract as the edge
    // alignment snap above — the move is part of the active drag, not
    // a separate undo step.
    if (_spacingDragContext?.peers) {
      const peers = _spacingDragContext.peers;
      // X-axis spacing
      if (!bestX) {
        const matchX = findSequentialSpacing(finalBBox, peers, 'x');
        if (matchX) {
          const movedCx = finalBBox.x + finalBBox.width / 2;
          const dxSnap = matchX.expectedCenter - movedCx;
          // Magnetic pull only within the snap tolerance — outside that
          // range we show the hint but let the user keep deliberate
          // placement. Inside, we pull to exact match so labels read
          // "180px / 180px" instead of "182px / 178px".
          if (Math.abs(dxSnap) > 0.5 && Math.abs(dxSnap) < SPACING_SNAP_TOL) {
            const pos = movedEl.position();
            movedEl.position(pos.x + dxSnap, pos.y, { skipHistory: true });
          }
          drawSpacingDimensions(matchX, 'x', movedEl.getBBox());
        }
      }
      // Y-axis spacing
      if (!bestY) {
        const fresh = movedEl.getBBox();   // refresh in case X-snap moved us
        const matchY = findSequentialSpacing(fresh, peers, 'y');
        if (matchY) {
          const movedCy = fresh.y + fresh.height / 2;
          const dySnap = matchY.expectedCenter - movedCy;
          if (Math.abs(dySnap) > 0.5 && Math.abs(dySnap) < SPACING_SNAP_TOL) {
            const pos = movedEl.position();
            movedEl.position(pos.x, pos.y + dySnap, { skipHistory: true });
          }
          drawSpacingDimensions(matchY, 'y', movedEl.getBBox());
        }
      }
    }
  });

  paper.on('element:pointerup', (cellView) => {
    clearGuides();
    if (cellView?.model?.get('type') === 'sf.SequenceActivation') {
      snapActivationToLifeline(cellView.model);
    }
  });

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

  // Start the dashed/dotted line overlay manager (Safari-safe rendering).
  // Must run after the paper is mounted so the SVG viewport exists.
  startLineStyleOverlays();

  // Generalisation of v1.11.0 CR-3.2 (DataObject parent grow). When any cell
  // is embedded in a parent (Container, Zone, BpmnPool, etc.) — whether by
  // user drag, JSON load, or programmatic embedding — the parent's bottom
  // edge tracks the lowest child + 1 grid dot (16 px). Top, left, and right
  // edges are never pushed, so the parent's layout anchor stays intact and
  // Manhattan routing above the parent doesn't shift. The fit grows AND
  // shrinks: removing or shrinking a child also pulls the parent's bottom
  // back up.
  //
  // Padding = visible grid dot spacing (gridSize × drawGrid.scaleFactor).
  const PARENT_FIT_PADDING = (paper.options.gridSize || 4) * (paper.options.drawGrid?.args?.scaleFactor || 4);
  // Don't shrink a parent below this height — a Container header bar is
  // ~32 px on its own, so 48 keeps a small body strip visible even if a
  // pathological diagram has a single tiny child near the parent's top.
  const PARENT_FIT_MIN_HEIGHT = 48;

  // Expose the fit helper + a graph reference so the toolbar can refit
  // everything when the user re-enables auto sizing. Late-binding because
  // the closure depends on the `graph` and `paper` instances created above.
  fitParentToChildrenImpl = fitParentToChildren;
  _graphRef = graph;

  function fitParentToChildren(parent) {
    if (!isAutoSizingEnabled()) return;
    if (!parent || !parent.isElement || !parent.isElement()) return;
    // Filter by `parent` attribute directly — `parent.getEmbeddedCells()` reads
    // the parent's own `embeds` array, which JointJS may not have updated yet
    // during a synchronous remove/un-embed event.
    const children = graph.getElements().filter(c => c.get('parent') === parent.id);
    if (children.length === 0) return; // empty parent: leave it alone
    let maxBottom = -Infinity;
    for (const c of children) {
      const p = c.position();
      const s = c.size();
      const bottom = p.y + s.height;
      if (bottom > maxBottom) maxBottom = bottom;
    }
    const parentPos = parent.position();
    const parentSize = parent.size();
    const requiredHeight = (maxBottom + PARENT_FIT_PADDING) - parentPos.y;
    const targetHeight = Math.max(PARENT_FIT_MIN_HEIGHT, requiredHeight);
    if (Math.abs(parentSize.height - targetHeight) < 1) return; // already at right size
    parent.resize(parentSize.width, targetHeight);
  }

  // Trigger 1: a cell becomes embedded (or un-embedded). Fit both parents:
  // the new one (may grow) and the previous one (may shrink).
  graph.on('change:parent', (cell, newParentId) => {
    if (_isLoadingJSON) return;
    if (!cell.isElement || !cell.isElement()) return;
    const prevParentId = cell.previous('parent');
    if (newParentId) {
      const np = graph.getCell(newParentId);
      if (np) fitParentToChildren(np);
    }
    if (prevParentId && prevParentId !== newParentId) {
      const pp = graph.getCell(prevParentId);
      if (pp) fitParentToChildren(pp);
    }
  });

  // Trigger 2: an embedded child resizes (e.g. DataObject after key-fields-only
  // toggle, or any cell after manual resize). Fit the parent.
  graph.on('change:size', (cell) => {
    if (_isLoadingJSON) return;
    const parentId = cell.get('parent');
    if (!parentId) return;
    const parent = graph.getCell(parentId);
    if (parent) fitParentToChildren(parent);
  });

  // Trigger 3: an embedded child moves. Cascaded moves (parent dragging its
  // children along) don't change the relative geometry, so fit is a no-op
  // in that case — but a user dragging the child within the parent should
  // tighten or expand the parent.
  graph.on('change:position', (cell) => {
    if (_isLoadingJSON) return;
    const parentId = cell.get('parent');
    if (!parentId) return;
    const parent = graph.getCell(parentId);
    if (parent) fitParentToChildren(parent);
  });

  // Trigger 4: an embedded child is removed (deleted, cut, etc.). Fit the
  // surviving parent on the next tick — JointJS may still be cleaning up its
  // embeds-array when this fires.
  graph.on('remove', (cell) => {
    if (_isLoadingJSON) return;
    const parentId = cell.get('parent') || cell.previous('parent');
    if (!parentId) return;
    const parent = graph.getCell(parentId);
    if (!parent) return;
    setTimeout(() => fitParentToChildren(parent), 0);
  });

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
  // Cell move/resize affects edge length (size) and far-end ordering
  // (position). Element-only — link `change:position` would be the same as
  // changes above and already handled.
  graph.on('change:position change:size', (cell) => {
    if (cell.isElement?.()) scheduleReroute();
  });

  // ── Gap 3 (v1.12.0) — empty-canvas onboarding hint ─────────────────
  // Render a faded SVG text inside the joint-layers group reading
  // "Drag a shape from the sidebar to start →" whenever the active
  // graph has zero cells. Visibility toggles automatically on every
  // add/remove. Per-tab — each tab's empty state shows the hint until
  // its first drop. CSS `pointer-events: none` so it never blocks pan.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let hintEl = null;
  const ensureHint = () => {
    if (hintEl && hintEl.parentNode) return hintEl;
    const layers = paper.svg.querySelector('.joint-layers') || paper.svg;
    hintEl = document.createElementNS(SVG_NS, 'text');
    hintEl.setAttribute('class', 'sf-canvas-hint');
    hintEl.setAttribute('text-anchor', 'middle');
    hintEl.setAttribute('pointer-events', 'none');
    hintEl.textContent = 'Drag a shape from the sidebar to start →';
    layers.appendChild(hintEl);
    return hintEl;
  };
  const refreshHint = () => {
    const empty = graph.getCells().length === 0;
    if (!empty) {
      if (hintEl?.parentNode) hintEl.style.display = 'none';
      return;
    }
    const el = ensureHint();
    // Position at the visible viewport centre in model coordinates so the
    // hint stays put regardless of zoom / pan when the canvas is empty.
    const rect = paper.el.getBoundingClientRect();
    const scale = paper.scale().sx;
    const t = paper.translate();
    const mx = (rect.width / 2 - t.tx) / scale;
    const my = (rect.height / 2 - t.ty) / scale;
    el.setAttribute('x', String(mx));
    el.setAttribute('y', String(my));
    el.style.display = '';
  };
  graph.on('add remove', refreshHint);
  // Re-position on pan/zoom/resize so the hint follows the viewport centre.
  paper.on('translate scale', refreshHint);
  new ResizeObserver(refreshHint).observe(paper.el);
  refreshHint();

  initCrossingBumps();
  initExternalLabelAutoplace();

  return { graph, paper };
}

// ── Bridge notation: crossing-bump overlay (CR-5.2 PoC) ─────────────
// See top-of-file `isCrossingBumpsEnabled` comment block for rationale.
// Implementation summary: collect every orthogonal segment from every
// link, find pairwise (horizontal × vertical) intersections that aren't
// near a vertex (T-junction at a trunk), and per crossing draw three
// SVG primitives in a dedicated overlay group sitting above the cells
// layer.  The link with the LOWER z bumps under the link with the
// higher z (JointJS paints higher-z later → on top → straight). Pure
// overlay — JointJS link paths are never touched.
const BUMP_RADIUS = 5;             // semicircle radius — diameter 10 px matches the "O" in the zero-to-many endpoint marker (a 5 5 arc)
const BUMP_DEBOUNCE_MS = 60;
// Buffer sized to distinguish two specific geometries:
//   - Stub overlap at a shared port: crossing point IS at a segment
//     endpoint (distance 0) → skipped because the line "ends here",
//     not actually crossing through.
//   - Channel-gap escape: crossing point is ~16 px from the segment
//     endpoint (one CHANNEL_HEIGHT) → still bumped because the line
//     visually crosses through the other line (just with a short upper
//     arm due to channel allocation).
// Buffer 8 sits between the two — catches the 0-px stub case while
// leaving the 16-px channel cases as legitimate visual crossings.
const BUMP_ENDPOINT_BUFFER = 8;
const BUMP_ORTHO_TOL = 1.5;        // tolerate up to 1.5 px of axis-drift when classifying a segment as H/V (was 0.5 — router output isn't always perfectly integer-aligned)
// Per-link channel allocation height (CR-5.3 v2). Each link end at a
// crowded port gets its own channel, with this many pixels between
// adjacent channels. Sized for clearly distinct lines that the eye
// reads as separate connections rather than a "close parallel pile".
// Previous iterations: 6 px (looked close-parallel, user rejected),
// 0 / disabled (merging lost the per-link distinction the user wants).
const CHANNEL_HEIGHT = 16;
let _bumpLayer = null;
let _bumpRecomputeTimer = null;
let scheduleCrossingBumpRecompute = null;

// ── External-label auto-placement (CR-6.2) ──────────────────────────
// Shapes with descriptions positioned OUTSIDE the body (Decision
// diamond, Event circle, DataObject) get their label side picked
// automatically based on which port sides have connecting links:
//   1st choice:  bottom (the current default)
//   2nd choice:  top
//   3rd choice:  right
//   4th choice:  left
//   fallback:    bottom (if all four sides are in use, accept the
//                collision rather than leave the label off-canvas)
//
// No save schema field — position is recomputed on every link
// topology change (add/remove, change:source, change:target) plus
// once at end of JSON load. Pure visual layout; the user doesn't
// need to think about it.
const EXTERNAL_LABEL_SHAPES = new Set([
  'sf.BpmnEvent',
  'sf.BpmnGateway',
  'sf.BpmnDataObject',
]);

const LABEL_SIDE_ATTRS = {
  bottom: { x: 'calc(0.5 * w)', y: 'calc(h + 10)', textAnchor: 'middle', textVerticalAnchor: 'top' },
  top:    { x: 'calc(0.5 * w)', y: -10,            textAnchor: 'middle', textVerticalAnchor: 'bottom' },
  right:  { x: 'calc(w + 10)',  y: 'calc(0.5 * h)', textAnchor: 'start', textVerticalAnchor: 'middle' },
  left:   { x: -10,             y: 'calc(0.5 * h)', textAnchor: 'end',   textVerticalAnchor: 'middle' },
};

function computeUsedPortSides(cell) {
  const usedSides = new Set();
  if (!cell?.id || !graph) return usedSides;
  const cellId = cell.id;
  for (const link of graph.getLinks()) {
    const src = link.get('source');
    const tgt = link.get('target');
    if (src?.id === cellId && src.port) {
      const port = cell.getPort?.(src.port);
      if (port?.group) usedSides.add(port.group);
    }
    if (tgt?.id === cellId && tgt.port) {
      const port = cell.getPort?.(tgt.port);
      if (port?.group) usedSides.add(port.group);
    }
  }
  return usedSides;
}

function refreshExternalLabelPosition(cell) {
  if (!cell?.get || !paper) return;
  if (!EXTERNAL_LABEL_SHAPES.has(cell.get('type'))) return;
  const used = computeUsedPortSides(cell);
  // Priority: bottom (default) → top → right → left → bottom (fallback)
  const preferred = ['bottom', 'top', 'right', 'left'];
  let chosen = 'bottom';
  for (const side of preferred) {
    if (!used.has(side)) { chosen = side; break; }
  }
  const sideAttrs = LABEL_SIDE_ATTRS[chosen];
  const existing = cell.attr('label') || {};
  // Skip if already correct (avoids redundant attr writes that re-render
  // unnecessarily on every link change for unaffected cells).
  if (existing.x === sideAttrs.x && existing.y === sideAttrs.y
      && existing.textAnchor === sideAttrs.textAnchor
      && existing.textVerticalAnchor === sideAttrs.textVerticalAnchor) return;
  cell.attr('label', { ...existing, ...sideAttrs }, { silent: true });
  // silent: true keeps it out of history (auto-positioning isn't a
  // user-initiated change), but the view doesn't re-render on its own;
  // explicit view.update() pushes the new attrs through.
  paper.findViewByModel(cell)?.update?.();
}

function initExternalLabelAutoplace() {
  if (!paper || !graph) return;

  const refreshFromLink = (link) => {
    if (!link || _isLoadingJSON) return;
    const srcId = link.get('source')?.id;
    const tgtId = link.get('target')?.id;
    if (srcId) refreshExternalLabelPosition(graph.getCell(srcId));
    if (tgtId) refreshExternalLabelPosition(graph.getCell(tgtId));
  };

  graph.on('add', (cell) => {
    if (_isLoadingJSON) return;
    if (cell.isLink()) refreshFromLink(cell);
    else refreshExternalLabelPosition(cell);
  });
  graph.on('remove', (cell) => {
    if (_isLoadingJSON) return;
    if (cell.isLink()) {
      // Link's endpoints are still on the model at removal time, so
      // refreshFromLink reads them before the GC sweeps the references.
      refreshFromLink(cell);
    }
  });
  graph.on('change:source change:target', refreshFromLink);

  // Initial pass — covers JSON-loaded diagrams and freshly-instantiated
  // diagrams where add events fired before this listener was wired up.
  // Deferred so it runs after the first paint and any post-load
  // bookkeeping.
  setTimeout(() => {
    for (const cell of graph.getElements()) {
      refreshExternalLabelPosition(cell);
    }
  }, 150);
}

function initCrossingBumps() {
  if (!paper || !graph) return;
  // Anchor the overlay inside the panned/zoomed layers group so it
  // tracks pan + zoom for free.  Insert just after the cells layer so
  // it paints above all links but below the tools layer (resize handles).
  const cellsLayer = paper.svg?.querySelector?.('.joint-cells-layer');
  const layersGroup = cellsLayer?.parentNode;
  if (!layersGroup) return;
  _bumpLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  _bumpLayer.setAttribute('class', 'sf-link-bumps');
  _bumpLayer.setAttribute('pointer-events', 'none');
  layersGroup.insertBefore(_bumpLayer, cellsLayer.nextSibling);

  scheduleCrossingBumpRecompute = () => {
    clearTimeout(_bumpRecomputeTimer);
    _bumpRecomputeTimer = setTimeout(recomputeCrossingBumps, BUMP_DEBOUNCE_MS);
  };

  // Recompute on anything that could change a route or stroke styling.
  graph.on(
    'add remove change:source change:target change:vertices change:router '
    + 'change:position change:size change:z change:attrs',
    scheduleCrossingBumpRecompute,
  );
  // render:done fires after each JointJS render pass completes — covers
  // route recomputation triggered by router toggles (Distributed
  // Connectors etc.) that don't fire a change:vertices event on the link.
  paper.on('render:done', scheduleCrossingBumpRecompute);
  // Belt-and-braces initial pass after first paint.
  setTimeout(scheduleCrossingBumpRecompute, 150);

  // Sync bump opacity with selection-driven link dimming. The bumps live
  // in a separate SVG group and don't inherit the link view's CSS
  // class, so we have to re-apply opacity per-primitive when selection
  // changes. selection.js fires `sf:selection-dim-change` after it
  // toggles its dim classes.
  document.addEventListener('sf:selection-dim-change', refreshCrossingBumpOpacity);
}

// Walk every tagged bump primitive and match its opacity to the dim
// state of the link it represents. Called from the selection-change
// listener; safe to call when no bumps exist (just iterates an empty
// NodeList). Far cheaper than a full re-render of the bump layer.
function refreshCrossingBumpOpacity() {
  if (!_bumpLayer) return;
  const dimmedLinkIds = new Set();
  document.querySelectorAll('.joint-link.sf-link-dimmed').forEach(el => {
    const id = el.getAttribute('model-id');
    if (id) dimmedLinkIds.add(id);
  });
  _bumpLayer.querySelectorAll('[data-link-id]').forEach(el => {
    const id = el.getAttribute('data-link-id');
    el.style.opacity = dimmedLinkIds.has(id) ? '0.18' : '';
  });
}

function recomputeCrossingBumps() {
  if (!_bumpLayer || !graph || !paper) return;
  while (_bumpLayer.firstChild) _bumpLayer.removeChild(_bumpLayer.firstChild);
  if (!isCrossingBumpsEnabled()) return;

  // Collect every orthogonal segment with per-link styling.
  const segments = [];
  for (const link of graph.getLinks()) {
    const view = paper.findViewByModel(link);
    if (!view) continue;
    const linkSegs = getLinkOrthogonalSegments(view);
    if (linkSegs.length === 0) continue;
    const stroke = link.attr('line/stroke') || '#888888';
    const strokeWidth = +link.attr('line/strokeWidth') || 2;
    const z = link.get('z') || 0;
    for (const seg of linkSegs) {
      segments.push({ link, seg, stroke, strokeWidth, z });
    }
  }

  // Pairwise orthogonal-crossing detection.  O(S²) but S is small in
  // practice (tens of segments) and each test is cheap range arithmetic.
  //
  // Bus-cluster dedupe: when several sibling links share a horizontal
  // "bus" at the same Y and one V drop crosses through, every parallel
  // H produces a detection at the same (X, Y) — visually a stack of
  // identical arcs piled on each other.  Adjacent parallel routes at
  // slightly different Y values produce close-but-not-identical arcs,
  // also a visual mess.  Collapse both cases by rounding the crossing
  // position to an 8-px grid and skipping any later detection that
  // lands on a grid cell we've already drawn into.  Pairs with the
  // SMALLEST z difference (= more visually "adjacent" links) win the
  // grid cell — we collect first and sort by z-distance ascending.
  //
  // Same-port skip (v1.12.4): two links exiting the same port at one
  // cell (e.g., multiple lines from Decision's bottom port to different
  // targets) should NEVER bump against each other — they're related
  // routes from a shared anchor, not actual crossings. Without this
  // check, channel-allocated sibling stubs at the source produced false
  // bumps where one sibling's vertical stub crossed another sibling's
  // horizontal bus.
  const crossings = [];
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i];
      const b = segments[j];
      if (a.link === b.link) continue;       // same link self-bend — skip
      const cross = findOrthoCrossing(a.seg, b.seg, BUMP_ENDPOINT_BUFFER);
      if (!cross) continue;
      // No separate sibling/bundled check needed — the OR-endpoint
      // skip inside findOrthoCrossing handles every "lines branch or
      // meet" geometry (sibling stubs, escapes, T-junctions) by virtue
      // of the crossing being close to a segment endpoint in all those
      // cases. Only true 4-way crossings get past findOrthoCrossing.
      const [under, over] = a.z <= b.z ? [a, b] : [b, a];
      const underIsH = Math.abs(under.seg.a.y - under.seg.b.y) < BUMP_ORTHO_TOL;
      crossings.push({ cross, under, over, underIsH, zGap: Math.abs(a.z - b.z) });
    }
  }
  crossings.sort((x, y) => x.zGap - y.zGap);
  const drawnCells = new Set();
  const GRID = 8;
  for (const c of crossings) {
    const key = `${Math.round(c.cross.x / GRID)},${Math.round(c.cross.y / GRID)}`;
    if (drawnCells.has(key)) continue;
    drawnCells.add(key);
    drawBumpOverlay(_bumpLayer, c.cross.x, c.cross.y, c.underIsH, c.under, c.over);
  }
  // After a full re-render the primitives start at default opacity;
  // re-apply the current selection-dim state so newly-drawn bumps don't
  // pop to full brightness when selection-driven dimming is active.
  refreshCrossingBumpOpacity();
}

// Module-level mirror of registerSfRouter's endSignature — same logic,
// reachable from outside the router closure. Used by the bump detector
// to recognise BUNDLED siblings (same trunk, same channel allocation
// pool) which is the specific case where V-stubs overlap and produce
// false-positive crossings near the shared port.
function _bumpEndSignature(link, end) {
  const style = link.prop('lineStyle') || 'none';
  const marker = end === 'source'
    ? link.attr('line/sourceMarker')
    : link.attr('line/targetMarker');
  let d = (marker && marker.d) ? String(marker.d) : 'none';
  d = d.replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return `${style}|${d}`;
}

// Returns true when two links are BUNDLED at a shared port (= same
// trunk because same source/target signature) AND at least one of the
// two candidate segments is classified as "stub-zone" relative to that
// shared port. This is the precise condition under which sibling
// V-stubs and H-bus-starts produce false-positive crossings, while
// real crossings further down the line (V-drops crossing other
// siblings' H-buses out in the middle of the route) escape the skip
// because their V-drop segment endpoints reach well past the stub zone.
function isBundledStubCrossing(linkA, linkB, segA, segB) {
  const portMatch = (refA, refB) =>
    refA?.id && refB?.id && refA.id === refB.id
    && refA.port && refB.port && refA.port === refB.port;
  const aSrc = linkA.get('source');
  const aTgt = linkA.get('target');
  const bSrc = linkB.get('source');
  const bTgt = linkB.get('target');

  if (portMatch(aSrc, bSrc)
      && _bumpEndSignature(linkA, 'source') === _bumpEndSignature(linkB, 'source')
      && (segA.inSourceStub || segB.inSourceStub)) return true;
  if (portMatch(aTgt, bTgt)
      && _bumpEndSignature(linkA, 'target') === _bumpEndSignature(linkB, 'target')
      && (segA.inTargetStub || segB.inTargetStub)) return true;
  if (portMatch(aSrc, bTgt)
      && _bumpEndSignature(linkA, 'source') === _bumpEndSignature(linkB, 'target')
      && (segA.inSourceStub || segB.inTargetStub)) return true;
  if (portMatch(aTgt, bSrc)
      && _bumpEndSignature(linkA, 'target') === _bumpEndSignature(linkB, 'source')
      && (segA.inTargetStub || segB.inSourceStub)) return true;
  return false;
}

function getLinkOrthogonalSegments(linkView) {
  const route = linkView.route || [];
  const src = linkView.sourcePoint;
  const tgt = linkView.targetPoint;
  if (!src || !tgt) return [];
  const points = [
    { x: src.x, y: src.y },
    ...route.map(p => ({ x: p.x, y: p.y })),
    { x: tgt.x, y: tgt.y },
  ];
  // Stub-zone classification radius. Sized to cover STUB(32) + LEAD_OUT(24)
  // + max channel offset (~24 for 4 bundled siblings) + small slack = 90 px.
  // A segment is "in source stub" only when BOTH endpoints are inside this
  // radius from sourcePoint — so the V stub (port→srcStub→srcLead) qualifies
  // but the H bus (srcLead→busTurn, where busTurn reaches the target's x)
  // does NOT, because its busTurn endpoint sits far from the source whenever
  // the target is more than ~90 px away. That distinction is exactly what
  // separates the false-positive "sibling stubs overlap" case from the real
  // "V-drop crosses sibling's H-bus out in the middle of the route" case.
  const STUB_ZONE_DIST = 90;
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const isH = Math.abs(a.y - b.y) < BUMP_ORTHO_TOL;
    const isV = Math.abs(a.x - b.x) < BUMP_ORTHO_TOL;
    if (!isH && !isV) continue;
    const maxDistSrc = Math.max(
      Math.hypot(a.x - src.x, a.y - src.y),
      Math.hypot(b.x - src.x, b.y - src.y),
    );
    const maxDistTgt = Math.max(
      Math.hypot(a.x - tgt.x, a.y - tgt.y),
      Math.hypot(b.x - tgt.x, b.y - tgt.y),
    );
    out.push({
      a, b,
      inSourceStub: maxDistSrc <= STUB_ZONE_DIST,
      inTargetStub: maxDistTgt <= STUB_ZONE_DIST,
    });
  }
  return out;
}

function findOrthoCrossing(segA, segB, buffer) {
  const aIsH = Math.abs(segA.a.y - segA.b.y) < BUMP_ORTHO_TOL;
  const aIsV = Math.abs(segA.a.x - segA.b.x) < BUMP_ORTHO_TOL;
  const bIsH = Math.abs(segB.a.y - segB.b.y) < BUMP_ORTHO_TOL;
  const bIsV = Math.abs(segB.a.x - segB.b.x) < BUMP_ORTHO_TOL;
  if (!((aIsH && bIsV) || (aIsV && bIsH))) return null;
  const h = aIsH ? segA : segB;
  const v = aIsV ? segA : segB;
  const hY = h.a.y;
  const vX = v.a.x;
  const hXMin = Math.min(h.a.x, h.b.x);
  const hXMax = Math.max(h.a.x, h.b.x);
  const vYMin = Math.min(v.a.y, v.b.y);
  const vYMax = Math.max(v.a.y, v.b.y);

  // Step 1 — must geometrically overlap (cross point lies on both segments).
  if (vX < hXMin || vX > hXMax || hY < vYMin || hY > vYMax) return null;

  // Step 2 — only TRUE 4-way crossings get bumped: both segments must
  // pass THROUGH the crossing point (extend on both sides of it),
  // neither one ending at the crossing. This skips:
  //   - T-junctions (one segment ends at the crossing)
  //   - "Escape from parallel flow" (one sibling just turned a corner
  //     and the crossing sits close to that fresh corner)
  //   - Bundled-stub overlaps (sibling V-stubs at the same trunk x,
  //     crossing point close to one's lead endpoint)
  // All three of those visually represent "lines branching" or
  // "lines meeting", not actual crossings — drawing a bump on them
  // produces visual noise that the eye reads as confusing rather
  // than clarifying. Real 4-way crossings between unrelated routes
  // still get bumped because neither endpoint is close to the
  // crossing for either segment.
  const atHEnd = Math.abs(vX - h.a.x) < buffer || Math.abs(vX - h.b.x) < buffer;
  const atVEnd = Math.abs(hY - v.a.y) < buffer || Math.abs(hY - v.b.y) < buffer;
  if (atHEnd || atVEnd) return null;

  return { x: vX, y: hY };
}

function drawBumpOverlay(layer, cx, cy, underIsH, under, over) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const R = BUMP_RADIUS;
  const sw = under.strokeWidth;
  // Half stroke-width as the eraser's perpendicular half-height. The old
  // sw + 1 px buffer was visible against the grid dots — we minimise the
  // eraser to ~sw and rely on the arc + restoration segments overlapping
  // the line ends to mask anti-alias bleed.
  const eHalf = sw / 2;
  // Arc-end stubs that extend the arc 0.5 px PAST the eraser boundary on
  // each side, so the arc joins the bumped line cleanly without a visible
  // gap where the stroke caps meet perpendicular to each other.
  const STUB = 0.5;

  // 1. Eraser — minimal bg-coloured rect aligned along the bumped segment,
  //    just thick enough to hide the line's stroke at the crossing.
  const eraser = document.createElementNS(SVG_NS, 'rect');
  if (underIsH) {
    eraser.setAttribute('x', cx - R);
    eraser.setAttribute('y', cy - eHalf);
    eraser.setAttribute('width', R * 2);
    eraser.setAttribute('height', sw);
  } else {
    eraser.setAttribute('x', cx - eHalf);
    eraser.setAttribute('y', cy - R);
    eraser.setAttribute('width', sw);
    eraser.setAttribute('height', R * 2);
  }
  eraser.setAttribute('fill', 'var(--bg-canvas, #1A1A1A)');
  // No data-link-id on the eraser — it's always bg-coloured so dimming
  // wouldn't change anything visually.
  layer.appendChild(eraser);

  // 2. Restoration — short perpendicular segment in the THROUGH link's
  //    stroke that re-paints the line across the eraser gap, so the
  //    straight link reads as continuous through the crossing.
  const restore = document.createElementNS(SVG_NS, 'line');
  if (underIsH) {
    restore.setAttribute('x1', cx);
    restore.setAttribute('x2', cx);
    restore.setAttribute('y1', cy - eHalf);
    restore.setAttribute('y2', cy + eHalf);
  } else {
    restore.setAttribute('y1', cy);
    restore.setAttribute('y2', cy);
    restore.setAttribute('x1', cx - eHalf);
    restore.setAttribute('x2', cx + eHalf);
  }
  restore.setAttribute('stroke', over.stroke);
  restore.setAttribute('stroke-width', over.strokeWidth);
  restore.setAttribute('stroke-linecap', 'butt');
  // The restoration line paints the THROUGH link's stroke across the
  // eraser gap; its dim state follows the OVER link.
  restore.setAttribute('data-link-id', over.link.id);
  layer.appendChild(restore);

  // 3. Bump arc — semicircle in the BUMPED link's stroke. The path starts
  //    with a tiny straight stub OUTSIDE the eraser boundary, runs the
  //    semicircle, then ends with another tiny stub, so the arc joins
  //    the existing line stroke without a visible kink at the cap.
  //    `stroke-linecap: round` further smooths any sub-pixel transition.
  //    Direction convention: horizontal bumped lines arc UP, vertical
  //    bumped lines arc RIGHT — consistent across the diagram.
  const arc = document.createElementNS(SVG_NS, 'path');
  const d = underIsH
    ? `M ${cx - R - STUB} ${cy} L ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy} L ${cx + R + STUB} ${cy}`
    : `M ${cx} ${cy - R - STUB} L ${cx} ${cy - R} A ${R} ${R} 0 0 1 ${cx} ${cy + R} L ${cx} ${cy + R + STUB}`;
  arc.setAttribute('d', d);
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', under.stroke);
  arc.setAttribute('stroke-width', under.strokeWidth);
  arc.setAttribute('stroke-linecap', 'round');
  arc.setAttribute('stroke-linejoin', 'round');
  // Arc represents the BUMPED link going over the through line; dim
  // state follows the UNDER link.
  arc.setAttribute('data-link-id', under.link.id);
  layer.appendChild(arc);
}

function updateZoomDisplay() {
  const el = document.getElementById('zoom-level');
  if (el) el.textContent = `${Math.round(currentZoom * 100)}%`;
}

export function getGraph() { return graph; }
export function getPaper() { return paper; }
export function getZoom() { return currentZoom; }

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

export function setZoom(zoom) {
  currentZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
  paper.scale(currentZoom, currentZoom);
  updateZoomDisplay();
}

export function zoomIn() { setZoom(currentZoom + ZOOM_STEP); }
export function zoomOut() { setZoom(currentZoom - ZOOM_STEP); }

export function fitContent() {
  if (graph.getCells().length === 0) return;

  // Reset transform to get clean model-space content bbox
  paper.translate(0, 0);
  paper.scale(1, 1);

  const contentBBox = paper.getContentBBox({ useModelGeometry: true });
  if (!contentBBox || contentBBox.width === 0 || contentBBox.height === 0) return;

  // Get paper visible area
  const paperRect = paper.el.getBoundingClientRect();
  const padding = 60;

  // Compute scale to fit content with padding
  const scaleX = (paperRect.width - padding * 2) / contentBBox.width;
  const scaleY = (paperRect.height - padding * 2) / contentBBox.height;
  const newZoom = Math.min(scaleX, scaleY, 2); // maxScale: 2

  paper.scale(newZoom, newZoom);

  // Center: translate so content center aligns with paper center
  const cx = contentBBox.x + contentBBox.width / 2;
  const cy = contentBBox.y + contentBBox.height / 2;
  const tx = paperRect.width / 2 - cx * newZoom;
  const ty = paperRect.height / 2 - cy * newZoom;
  paper.translate(tx, ty);

  currentZoom = newZoom;
  updateZoomDisplay();
}

export function toggleGrid() {
  gridVisible = !gridVisible;
  if (gridVisible) {
    paper.setGridSize(4);
    paper.setGrid({ name: 'dot', args: { color: getGridColor(), scaleFactor: 4 } });
  } else {
    paper.setGridSize(1);
    paper.setGrid(false);
  }
  return gridVisible;
}

export function refreshGrid() {
  if (gridVisible) {
    paper.setGrid({ name: 'dot', args: { color: getGridColor(), scaleFactor: 4 } });
  }
}

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
export function refreshAllIconHrefs() {
  if (!_iconDataUriFn) return;
  for (const el of graph.getElements()) {
    const type = el.get('type');
    if (type === 'sf.SimpleNode') {
      _refreshElementIcon(el, 'icon/href', 'label/fill');
    } else if (type === 'sf.Container') {
      _refreshElementIcon(el, 'headerIcon/href', null, '#FFFFFF');
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

export function getViewport() {
  return {
    zoom: currentZoom,
    translate: paper.translate(),
  };
}

export function setViewport({ zoom, translate } = {}) {
  if (zoom != null) setZoom(zoom);
  if (translate != null) paper.translate(translate.tx, translate.ty);
}

// ── Line-style overlays (dashed / dotted connectors) ────────────────
// Safari propagates stroke-dasharray into SVG <marker> content at the
// rendering level, making arrowheads/ER markers render dashed whenever
// the line is dashed — no combination of marker attributes or CSS can
// override this.  Same workaround as flow animation (toolbar.js): keep
// the real line + markers SOLID, then overlay a clone painted in the
// canvas background colour that "erases" stripes to simulate the dash
// pattern.  The user's choice is stored on `cell.prop('lineStyle')`
// so it never lands on `line/strokeDasharray`.
//
// Overlay dasharray is the user's pair reversed:
//   "8 4"  (dashed)  → overlay "4 8"  (erase 4px, show 8px solid line)
//   "2 4"  (dotted)  → overlay "4 2"  (erase 4px, show 2px solid line)
// The overlay stroke width matches the underlying line so gaps are
// fully erased.

let _lineStyleObserver = null;
let _lineStyleSyncId = 0;

// A mutation only matters to the overlay systems if it touches something
// other than an overlay path — the overlays themselves shouldn't trigger
// another re-sync.
function mutationsAffectRealLinks(mutations) {
  for (const m of mutations) {
    for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      const cls = n.getAttribute?.('class') || '';
      if (cls === 'sf-flow-overlay' || cls === 'sf-line-style-overlay') continue;
      return true;
    }
    for (const n of m.removedNodes) {
      if (n.nodeType !== 1) continue;
      const cls = n.getAttribute?.('class') || '';
      if (cls === 'sf-flow-overlay' || cls === 'sf-line-style-overlay') continue;
      return true;
    }
  }
  return false;
}

function scheduleLineStyleSync() {
  if (_lineStyleSyncId) return;
  _lineStyleSyncId = requestAnimationFrame(() => {
    _lineStyleSyncId = 0;
    syncLineStyleOverlays();
  });
}

export function syncLineStyleOverlays() {
  if (!paper || !graph) return;
  // Disconnect the observer while we mutate the DOM to prevent feedback loops.
  if (_lineStyleObserver) _lineStyleObserver.disconnect();
  try {
    // Remove stale overlays
    document.querySelectorAll('.sf-line-style-overlay').forEach(el => el.remove());

    for (const link of graph.getLinks()) {
      const style = link.prop('lineStyle');
      if (!style || style === 'none') continue;

      const linkEl = document.querySelector(`.joint-link[model-id="${link.id}"]`);
      if (!linkEl) continue;
      const lineEl = linkEl.querySelector('[joint-selector="line"]');
      if (!lineEl) continue;

      const clone = lineEl.cloneNode(false);
      clone.removeAttribute('marker-start');
      clone.removeAttribute('marker-end');
      clone.removeAttribute('marker-mid');
      clone.removeAttribute('joint-selector');
      clone.setAttribute('class', 'sf-line-style-overlay');

      // Invert the user's dasharray so the overlay erases the right stripes.
      const parts = String(style).trim().split(/\s+/);
      const inverted = parts.length === 2 ? `${parts[1]} ${parts[0]}` : String(style);
      clone.setAttribute('stroke-dasharray', inverted);

      lineEl.parentNode.insertBefore(clone, lineEl.nextSibling);
    }
  } finally {
    // Reconnect the observer
    if (_lineStyleObserver) {
      const target = document.querySelector('#paper svg .joint-viewport')
                  || document.querySelector('#paper svg');
      if (target) _lineStyleObserver.observe(target, { childList: true, subtree: true });
    }
  }
}

export function startLineStyleOverlays() {
  if (_lineStyleObserver) return;
  const target = document.querySelector('#paper svg .joint-viewport')
              || document.querySelector('#paper svg');
  if (!target) return;
  _lineStyleObserver = new MutationObserver((mutations) => {
    // Ignore mutations caused by either overlay system adding/removing its
    // own paths. Without this filter the flow-animation observer (toolbar.js)
    // and this one trigger each other every frame, which destroys and
    // recreates the flow overlay faster than its CSS animation can advance
    // — the animation appears frozen on any link that also has a lineStyle.
    if (!mutationsAffectRealLinks(mutations)) return;
    scheduleLineStyleSync();
  });
  _lineStyleObserver.observe(target, { childList: true, subtree: true });

  // Re-sync when a link's lineStyle prop changes, or when links are added/removed.
  graph.on('change:lineStyle', scheduleLineStyleSync);
  graph.on('add remove', (cell) => {
    if (cell.isLink && cell.isLink()) scheduleLineStyleSync();
  });

  // Re-sync overlays whenever any geometry change could move a link's path.
  // The MutationObserver above only watches childList/subtree, so JointJS's
  // attribute-only updates (e.g. the `d` attribute on the link path during a
  // drag of a connected element) slip past it and the overlay stays pinned to
  // the link's old geometry — leaving the dashed line briefly solid until the
  // user releases the pointer. RAF debouncing in scheduleLineStyleSync keeps
  // this cheap even during a continuous drag.
  graph.on(
    'change:position change:size change:vertices change:source change:target',
    scheduleLineStyleSync,
  );

  scheduleLineStyleSync();
}

// ── Migrate link labels to use canvas-bg rect + connector-colored text ──
export function migrateLinks() {
  for (const link of graph.getLinks()) {
    // Ensure links have a sourceMarker (older diagrams may lack one)
    if (!link.attr('line/sourceMarker')) {
      const stroke = link.attr('line/stroke') || '#888888';
      link.attr('line/sourceMarker', {
        type: 'path',
        d: 'M 0 0 L -12 0',
        fill: 'none',
        stroke,
        'stroke-width': 2,
      });
    }

    // Migrate old arrow markers to native JointJS convention
    //
    // Skip migration for paths already in the current canonical form —
    // the old-format heuristics (especially hasCrowFoot) can misidentify
    // canonical paths that happen to share substring patterns (e.g. the
    // canonical "one" path contains both `L 0 0` and `L -12 8`, which
    // would otherwise be re-written to "many" on every load).
    const CANONICAL_MARKER_PATHS = new Set([
      'M 0 0 L -12 0',
      'M 0 -6 L -14 0 L 0 6 z',
      'M 0 -6 L -14 0 L 0 6',
      'M -14 -6 L 0 0 L -14 6', // legacy reversed form shipped in an earlier 1.6.0 build
      'M -12 -8 L -12 8 M -12 0 L 0 0',
      'M 2 0 a 5 5 0 1 1 -10 0 a 5 5 0 1 1 10 0 Z M -8 0 L -12 0 M -12 -8 L -12 8',
      'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0',
      'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0 M 3 -8 L 3 8',
      'M 4 0 a 5 5 0 1 1 10 0 a 5 5 0 1 1 -10 0 Z M -12 -8 L 0 0 M 0 0 L -12 8 M 0 0 L -12 0',
    ]);

    for (const key of ['sourceMarker', 'targetMarker']) {
      const m = link.attr(`line/${key}`);
      if (!m?.d) continue;
      const d = m.d;
      if (CANONICAL_MARKER_PATHS.has(d)) continue; // already up to date
      // Old arrow: M 14 -6 0 0 14 6 z → new: M 0 -6 L -14 0 L 0 6 z
      if (d.includes('14 -6') && d.includes('z')) {
        link.attr(`line/${key}`, { type: 'path', d: 'M 0 -6 L -14 0 L 0 6 z' });
      }
      // Old ER markers: convert to canonical new paths
      else if (m.fill === 'none' || m.fill?.startsWith('var(')) {
        const stroke = m.stroke || link.attr('line/stroke') || '#888888';
        const hasCrowFoot = (d.includes('L 0 0') && /L\s*-12\s+8/.test(d)) || d.includes('L 12 0');
        const hasCircle = /a [345] [345]/.test(d);
        const hasBar = /M\s*-?15\s/.test(d) || /M\s*[3-9]\s+-8/.test(d)
          || /M\s*0\s+-8\s*L\s*0\s+8/.test(d) || /M\s*-1[14]\s+-8/.test(d);
        let newD;
        if (hasCrowFoot && hasCircle) {
          newD = 'M 4 0 a 5 5 0 1 1 10 0 a 5 5 0 1 1 -10 0 Z M -12 -8 L 0 0 M 0 0 L -12 8 M 0 0 L -12 0'; // zeroMany
        } else if (hasCrowFoot && hasBar) {
          newD = 'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0 M 3 -8 L 3 8'; // oneMany
        } else if (hasCrowFoot) {
          newD = 'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0'; // many
        } else if (hasCircle) {
          newD = 'M 2 0 a 5 5 0 1 1 -10 0 a 5 5 0 1 1 10 0 Z M -8 0 L -12 0 M -12 -8 L -12 8'; // zeroOne
        } else if (/M\s*-?\d+\s+-8\s*L\s*-?\d+\s+8/.test(d)) {
          newD = 'M -12 -8 L -12 8 M -12 0 L 0 0'; // one (bar at entity end)
        } else {
          continue;
        }
        const sw = 2;
        const markerFill = hasCircle ? 'var(--bg-canvas, #1A1A1A)' : 'none';
        link.attr(`line/${key}`, { type: 'path', d: newD, fill: markerFill, stroke, 'stroke-width': sw });
      }
    }

    // Pin `stroke-dasharray: 'none'` on every marker as defence in depth
    // (handles browsers that respect marker-level attribute overrides —
    // Chrome, Firefox).  Safari ignores this because it propagates the
    // line's dasharray into marker content at the renderer level; for
    // Safari we also render a bg-coloured overlay (startLineStyleOverlays)
    // so the real line never carries a dasharray in the first place.
    for (const key of ['sourceMarker', 'targetMarker']) {
      const m = link.attr(`line/${key}`);
      if (m && m['stroke-dasharray'] !== 'none') {
        link.attr(`line/${key}`, { ...m, 'stroke-dasharray': 'none' });
      }
    }

    // Legacy migration: move `line/strokeDasharray` onto `cell.prop('lineStyle')`
    // so the real line renders solid (markers stay crisp) while the overlay
    // manager paints the dashes.  Skip links that are already migrated.
    const legacyDash = link.attr('line/strokeDasharray');
    if (legacyDash && typeof legacyDash === 'string' && legacyDash !== 'none' && !link.prop('lineStyle')) {
      link.prop('lineStyle', legacyDash);
      link.attr('line/strokeDasharray', null);
    } else if (legacyDash && link.prop('lineStyle')) {
      // Belt-and-suspenders: if both are set (shouldn't happen), clear the line attr.
      link.attr('line/strokeDasharray', null);
    }

    const labels = link.labels();
    if (!labels || !labels.length) continue;
    const lineColor = link.attr('line/stroke') || '#888888';
    const newLabels = labels.map(lbl => {
      const text = lbl.attrs?.text?.text || lbl.attrs?.label?.text || '';
      if (!text) return lbl;
      const fontSize = lbl.attrs?.text?.fontSize ?? 13;
      return {
        markup: [
          { tagName: 'rect', selector: 'body' },
          { tagName: 'text', selector: 'text' },
        ],
        attrs: {
          text: { text, fill: lineColor, fontSize, fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', textAnchor: 'middle', textVerticalAnchor: 'middle' },
          body: { ref: 'text', refWidth: 12, refHeight: 4, refX: -6, refY: -2, fill: 'var(--bg-canvas, #FFFFFF)', stroke: 'none', rx: 2, ry: 2 },
        },
        position: lbl.position || { distance: 0.5 },
      };
    });
    link.labels(newLabels);
  }

  // Force all link views to re-render (clears stale routing/connection-point caches)
  paper.updateViews();
}

// ── SimpleNode dynamic layout ───────────────────────────────────────
// Adjusts icon/label/subtitle positioning based on content:
//  - Text only (no icon): label centered
//  - Icon + text (no description): icon+text pair centered
//  - With description: icon+text top-left, description below full-width

export function updateSimpleNodeLayout(cell) {
  if (cell.get('type') !== 'sf.SimpleNode') return;
  if (cell.get('iconMode')) return;

  const hasIcon = !!cell.attr('icon/href');
  const hasDescription = !!(cell.attr('subtitle/text'));

  if (hasDescription) {
    // Icon+label centered in header row, description below spanning full width
    if (hasIcon) {
      cell.attr({
        icon: { x: 12, y: 8, width: 32, height: 32 },
        label: {
          x: 'calc(0.5*w + 20)', y: 24,
          textAnchor: 'middle', textVerticalAnchor: 'middle',
          textWrap: { width: 'calc(w - 64)', maxLineCount: 1, ellipsis: true },
        },
        subtitle: {
          x: 12, y: 42, visibility: 'visible',
          textAnchor: 'start', textVerticalAnchor: 'top',
          textWrap: { width: 'calc(w - 24)', height: 'calc(h - 48)', ellipsis: true },
        },
      });
    } else {
      cell.attr({
        icon: { width: 0, height: 0 },
        label: {
          x: 12, y: 16,
          textAnchor: 'start', textVerticalAnchor: 'middle',
          textWrap: { width: 'calc(w - 24)', maxLineCount: 1, ellipsis: true },
        },
        subtitle: {
          x: 12, y: 32, visibility: 'visible',
          textAnchor: 'start', textVerticalAnchor: 'top',
          textWrap: { width: 'calc(w - 24)', height: 'calc(h - 38)', ellipsis: true },
        },
      });
    }
  } else if (hasIcon) {
    // Icon left, text centered in remaining space, vertically aligned with icon center
    cell.attr({
      icon: { x: 12, y: 'calc(0.5*h - 16)', width: 32, height: 32 },
      label: {
        x: 'calc(0.5*w + 20)', y: 'calc(0.5*h)',
        textAnchor: 'middle', textVerticalAnchor: 'middle',
        textWrap: { width: 'calc(w - 64)', maxLineCount: 4, ellipsis: true },
      },
      subtitle: { visibility: 'hidden' },
    });
  } else {
    // Text only — centered
    cell.attr({
      icon: { width: 0, height: 0 },
      label: {
        x: 'calc(0.5*w)', y: 'calc(0.5*h)',
        textAnchor: 'middle', textVerticalAnchor: 'middle',
        textWrap: { width: 'calc(w - 24)', maxLineCount: 4, ellipsis: true },
      },
      subtitle: { visibility: 'hidden' },
    });
  }
}

export function migrateNodes() {
  for (const el of graph.getElements()) {
    if (el.get('type') === 'sf.SimpleNode' && !el.get('iconMode')) {
      updateSimpleNodeLayout(el);
    }
    // Migrate Container from old left-accent to new top-bar accent
    if (el.get('type') === 'sf.Container') {
      migrateContainer(el);
    }
    // Migrate SequenceFragment: condition used to sit beside the title tab at
    // (x=72, y=14); it now sits below the tab at (x=8, y=34) on its own line.
    // Also recompute the trapezoid path so it adapts to the current label.
    if (el.get('type') === 'sf.SequenceFragment') {
      const cx = el.attr('conditionText/x');
      const cy = el.attr('conditionText/y');
      if (cx === 72 || cy === 14 || cx == null || cy == null) {
        el.attr('conditionText/x', 8);
        el.attr('conditionText/y', 34);
        el.attr('conditionText/textAnchor', 'start');
        el.attr('conditionText/textVerticalAnchor', 'middle');
      }
      joint.shapes.sf.updateFragmentTitleTab?.(el);
    }
    // Migrate SequenceParticipant: older saves have no bottom header/label
    // attrs and no showBottomLabel property. New diagrams default showBottom
    // to true; existing diagrams inherit true as well so the label mirror
    // appears on load — users can hide via the properties panel.
    if (el.get('type') === 'sf.SequenceParticipant') {
      const hasBottomAttrs = el.attr('labelBottom/text') !== undefined;
      // Always sync label text and accent/fill in case the top changed while
      // this diagram was open without syncing.
      joint.shapes.sf.syncParticipantBottomLabel?.(el);
      if (!hasBottomAttrs && el.get('showBottomLabel') === undefined) {
        el.set('showBottomLabel', true);
      }
      const show = el.get('showBottomLabel') !== false;
      const v = show ? 'visible' : 'hidden';
      el.attr('headerBottom/visibility', v);
      el.attr('headerBottomAccent/visibility', v);
      el.attr('labelBottom/visibility', v);
      el.attr('underlineBottom/visibility', v);
      // Rebuild ports so the symmetric [headerOffset, h - bottomOffset] port
      // distribution (added alongside the bottom-label feature) applies to
      // older participants that were saved with the old top-only spacing.
      // Skip when the user customised port ratios so we don't trample edits.
      if (!el.get('lifelinePortRatios')) {
        const n = el.get('lifelinePortCount') || 5;
        joint.shapes.sf.rebuildSeqParticipantPorts?.(el, n);
      }
    }
    // SequenceActor: the shape defaults hide the lifeline + its hitbox and
    // ship with an empty port list, so importing a JSON that sets
    // `showLifeline: true` leaves the actor stuck looking collapsed until the
    // user toggles visibility in the properties panel — and that toggle
    // rewrites the port list, which can detach any links still pointing at
    // the original port IDs. Realize the stored state here so imports and
    // session restores match what the author saved.
    if (el.get('type') === 'sf.SequenceActor' && el.get('showLifeline')) {
      el.attr('lifeline/visibility', 'visible');
      el.attr('lifelineHitbox/visibility', 'visible');
      el.attr('lifelineHitbox/magnet', true);
      // Only seed ports when none were saved — preserves link endpoints when
      // the JSON already ships the port list.
      const items = el.prop('ports/items');
      if (!Array.isArray(items) || items.length === 0) {
        const n = el.get('lifelinePortCount') || 5;
        const ratios = el.get('lifelinePortRatios');
        joint.shapes.sf.rebuildSeqActorPorts?.(el, n, ratios);
      }
    }
  }
  // Regenerate icon data URIs so all icons use current normalized viewBoxes
  refreshAllIconHrefs();
}

function migrateContainer(el) {
  const accentW = el.attr('accent/width');
  // Old containers had accent width=4 (left bar) — migrate to top bar
  if (accentW === 4 || accentW === '4') {
    const accentColor = el.attr('accent/fill') || 'var(--color-primary)';
    el.attr({
      accent: { x: 1, y: 1, width: 'calc(w - 2)', height: 40, rx: 11, ry: 11, fill: accentColor },
      accentFill: { x: 1, y: 20, width: 'calc(w - 2)', height: 21, fill: accentColor },
      headerIcon: { x: 12, y: 9 },
      headerLabel: { x: 44, y: 21, fill: '#FFFFFF' },
      headerSubtitle: { y: 50 },
    });
  }
  // Ensure accentFill exists for containers that don't have it yet
  if (!el.attr('accentFill/fill')) {
    const accentColor = el.attr('accent/fill') || 'var(--color-primary)';
    el.attr('accentFill/fill', accentColor);
  }
}

// ── Mobile bottom-sheet drag handles ─────────────────────────────────
const MOBILE_BP = 768;

// Shared localStorage key for both panels — they share the same height
const PANEL_HEIGHT_KEY = 'sf-panel-h';

/** Apply saved panel height to a target element (mobile only). */
function restorePanelHeight(target) {
  if (window.innerWidth > MOBILE_BP) return;
  const savedH = localStorage.getItem(PANEL_HEIGHT_KEY);
  if (savedH) {
    const h = Math.max(80, Math.min(window.innerHeight * 0.8, parseInt(savedH, 10)));
    target.style.height = h + 'px';
  }
}

export function initMobileDragHandles() {
  document.querySelectorAll('.sf-drag-handle').forEach(handle => {
    // Skip if already initialized
    if (handle.dataset.dragInit) return;
    handle.dataset.dragInit = '1';

    const targetId = handle.dataset.target;
    const target = document.getElementById(targetId);
    if (!target) return;

    // Gap 25 (v1.12.0) — make the handle a real a11y citizen. Without
    // these attributes it's a bare <div> with `cursor: ns-resize`,
    // discoverable only by sighted pointer users. The `separator` role
    // with `aria-orientation="horizontal"` is the ARIA-defined match for
    // a draggable splitter that resizes adjacent regions.
    if (!handle.hasAttribute('role'))            handle.setAttribute('role', 'separator');
    if (!handle.hasAttribute('aria-orientation')) handle.setAttribute('aria-orientation', 'horizontal');
    if (!handle.hasAttribute('aria-label'))      handle.setAttribute('aria-label', 'Resize panel — use arrow keys');
    if (!handle.hasAttribute('tabindex'))        handle.setAttribute('tabindex', '0');

    // Gap 25 (v1.12.0) — keyboard nudge. Up/Down adjust height by 16 px
    // (one grid unit); PageUp/PageDown by 64 px for coarse moves;
    // Home/End jump to min/max. Mirrors the splitter pattern in the
    // ARIA Authoring Practices Guide.
    handle.addEventListener('keydown', (evt) => {
      if (window.innerWidth > MOBILE_BP) return;
      const step = (evt.key === 'PageUp' || evt.key === 'PageDown') ? 64 : 16;
      const curH = target.getBoundingClientRect().height;
      const maxH = window.innerHeight * 0.8;
      let newH = curH;
      if (evt.key === 'ArrowUp' || evt.key === 'PageUp')         newH = Math.min(maxH, curH + step);
      else if (evt.key === 'ArrowDown' || evt.key === 'PageDown') newH = Math.max(80,   curH - step);
      else if (evt.key === 'Home')                                newH = maxH;
      else if (evt.key === 'End')                                 newH = 80;
      else return;
      evt.preventDefault();
      target.style.height = newH + 'px';
      localStorage.setItem(PANEL_HEIGHT_KEY, Math.round(newH));
    });

    restorePanelHeight(target);

    // Use pointer events — works for both mouse and touch
    handle.addEventListener('pointerdown', (evt) => {
      // Only act on mobile
      if (window.innerWidth > MOBILE_BP) return;

      evt.preventDefault();
      evt.stopPropagation();
      handle.setPointerCapture(evt.pointerId);

      const startY = evt.clientY;
      const startT = Date.now();
      const startH = target.getBoundingClientRect().height;
      let lastY = startY;
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';

      const onMove = (e) => {
        lastY = e.clientY;
        const delta = startY - e.clientY;
        const maxH = window.innerHeight * 0.8;
        const newH = Math.max(80, Math.min(maxH, startH + delta));
        target.style.height = newH + 'px';
      };

      const onEnd = () => {
        document.body.style.userSelect = '';
        document.body.style.webkitUserSelect = '';
        const dt = Date.now() - startT;
        const totalDown = lastY - startY;

        // Swipe-down to collapse: fast downward flick OR large downward drag.
        const isSwipeDown = (dt < 300 && totalDown > 50) || totalDown > 120;
        if (isSwipeDown) {
          target.style.height = '';
          if (target.id === 'properties-panel') {
            target.classList.add('sf-properties--hidden');
          } else if (target.id === 'stencil-panel') {
            target.classList.add('sf-stencil--hidden');
            const btn = document.getElementById('btn-toggle-stencil');
            if (btn) btn.classList.remove('sf-toolbar__button--active');
          }
        } else {
          const finalH = Math.round(target.getBoundingClientRect().height);
          localStorage.setItem(PANEL_HEIGHT_KEY, finalH);
        }
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onEnd);
        handle.removeEventListener('pointercancel', onEnd);
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onEnd);
      handle.addEventListener('pointercancel', onEnd);
    });
  });
}

/** Sync properties panel height to shared panel height when it opens (mobile). */
export function syncMobilePanelHeight(panelEl) {
  if (window.innerWidth > MOBILE_BP || !panelEl) return;
  restorePanelHeight(panelEl);
}

// ── Auto Layout (improved force-directed with tight packing) ─────────
// Groups (containers, zones, pools) are treated as single layout units —
// their embedded children move with them and maintain relative positions.
export function autoLayout(direction) {
  const elements = graph.getElements();
  if (elements.length < 2) return;


  const links = graph.getLinks();
  const grid = paper.options.gridSize || 16;

  // Identify parent types that act as groups
  const GROUP_TYPES = new Set(['sf.Container', 'sf.Zone', 'sf.BpmnPool', 'sf.BpmnSubprocess', 'sf.BpmnLoop']);

  // Build a set of embedded child IDs — these are excluded from top-level layout
  const embeddedIds = new Set();
  elements.forEach(el => {
    if (el.get('parent')) embeddedIds.add(el.id);
  });

  // Top-level elements to lay out (not embedded children, not bare zones without embeds)
  const layoutEls = elements.filter(el => {
    if (embeddedIds.has(el.id)) return false;
    return true;
  });
  if (layoutEls.length < 2) return;

  // For each layout element, compute its effective size (including embedded children)
  const sizes = new Map();
  layoutEls.forEach(el => {
    const s = el.size();
    sizes.set(el.id, { w: s.width, h: s.height });
  });

  // Build directed + undirected adjacency from links
  const adj = new Map();       // undirected — for connected components
  const adjOut = new Map();    // directed — source→target for layering
  const adjIn = new Map();     // directed — target←source for layering
  layoutEls.forEach(el => {
    adj.set(el.id, new Set());
    adjOut.set(el.id, new Set());
    adjIn.set(el.id, new Set());
  });

  // Helper: resolve an element ID to its top-level layout ID
  function toLayoutId(cellId) {
    if (adj.has(cellId)) return cellId;
    const cell = graph.getCell(cellId);
    const parentId = cell?.get('parent');
    if (parentId && adj.has(parentId)) return parentId;
    // Nested deeper — walk up
    let cur = cell;
    while (cur) {
      const pid = cur.get('parent');
      if (!pid) break;
      if (adj.has(pid)) return pid;
      cur = graph.getCell(pid);
    }
    return null;
  }

  const layoutLinks = links.filter(link => {
    const sId = toLayoutId(link.get('source')?.id);
    const tId = toLayoutId(link.get('target')?.id);
    return sId && tId && sId !== tId && adj.has(sId) && adj.has(tId);
  });
  layoutLinks.forEach(link => {
    const sId = toLayoutId(link.get('source')?.id);
    const tId = toLayoutId(link.get('target')?.id);
    adj.get(sId).add(tId);
    adj.get(tId).add(sId);
    adjOut.get(sId).add(tId);
    adjIn.get(tId).add(sId);
  });

  // Find connected components
  const visited = new Set();
  const components = [];
  for (const el of layoutEls) {
    if (visited.has(el.id)) continue;
    const comp = [];
    const stack = [el.id];
    while (stack.length) {
      const id = stack.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      comp.push(id);
      for (const n of (adj.get(id) || [])) {
        if (!visited.has(n)) stack.push(n);
      }
    }
    components.push(comp);
  }

  const pos = new Map();

  // Detect diagram type to choose layout direction
  // Flow/BPMN → horizontal (left-to-right), everything else → vertical (top-to-bottom)
  let isHorizontal;
  if (direction === 'horizontal') {
    isHorizontal = true;
  } else if (direction === 'vertical') {
    isHorizontal = false;
  } else {
    // Auto-detect based on element types
    const HORIZONTAL_TYPES = new Set([
      'sf.FlowProcess', 'sf.FlowDecision', 'sf.FlowTerminator', 'sf.FlowDatabase',
      'sf.FlowDocument', 'sf.FlowIO', 'sf.FlowPredefined',
      'sf.BpmnEvent', 'sf.BpmnTask', 'sf.BpmnGateway', 'sf.BpmnSubprocess', 'sf.BpmnLoop',
    ]);
    const horizCount = layoutEls.filter(el => HORIZONTAL_TYPES.has(el.get('type'))).length;
    isHorizontal = horizCount > layoutEls.length / 2;
  }

  const GAP_X = isHorizontal ? 80 : 64;  // must exceed 2× router STUB (20) + PAD (16) = 56
  const GAP_Y = isHorizontal ? 64 : 80;

  function layoutComponent(ids) {
    if (ids.length === 1) {
      pos.set(ids[0], { x: 0, y: 0 });
      return;
    }

    const idSet = new Set(ids);

    // Use longest-path layering based on directed edges for proper flow direction.
    // Assign each node a layer = longest path from any root (node with no in-edges in this component).
    const level = new Map();

    // Find roots: nodes with no incoming edges within this component
    const roots = ids.filter(id => {
      const inEdges = adjIn.get(id) || new Set();
      return ![...inEdges].some(n => idSet.has(n));
    });
    // If there's a cycle (no roots), fall back to the highest out-degree node
    if (roots.length === 0) roots.push(ids.reduce((best, id) => (adjOut.get(id) || new Set()).size > (adjOut.get(best) || new Set()).size ? id : best, ids[0]));

    // BFS/topological longest-path assignment.
    // Cycle guard: a longest simple path in a graph with N nodes is at most N-1,
    // so clamp level updates there — otherwise a back-edge (e.g. B→C→D→B) would
    // re-push nodes indefinitely and hang the layout.
    const maxLevel = ids.length - 1;
    const queue = [...roots];
    roots.forEach(r => level.set(r, 0));
    while (queue.length) {
      const id = queue.shift();
      const l = level.get(id);
      for (const n of (adjOut.get(id) || [])) {
        if (!idSet.has(n)) continue;
        const newLevel = l + 1;
        if (newLevel > maxLevel) continue;
        if (!level.has(n) || level.get(n) < newLevel) {
          level.set(n, newLevel);
          queue.push(n);
        }
      }
    }
    // Assign unvisited nodes (disconnected within component) via undirected BFS
    for (const id of ids) {
      if (!level.has(id)) {
        level.set(id, 0);
        const bfsQ = [id];
        while (bfsQ.length) {
          const cur = bfsQ.shift();
          for (const n of (adj.get(cur) || [])) {
            if (idSet.has(n) && !level.has(n)) {
              level.set(n, level.get(cur) + 1);
              bfsQ.push(n);
            }
          }
        }
      }
    }

    // Group by layer
    const layers = new Map();
    for (const id of ids) {
      const l = level.get(id) ?? 0;
      if (!layers.has(l)) layers.set(l, []);
      layers.get(l).push(id);
    }

    const sortedLevels = [...layers.keys()].sort((a, b) => a - b);

    // --- Barycentric crossing-reduction pass ---
    // Assign initial order indices within each layer (preserve natural order)
    const orderIndex = new Map(); // id → index within its layer
    for (const l of sortedLevels) {
      const layer = layers.get(l);
      layer.forEach((id, i) => orderIndex.set(id, i));
    }

    // Collect edges between adjacent layers using directed edges resolved to this component
    function edgesBetween(layerA, layerB) {
      const setB = new Set(layerB);
      const posA = new Map();
      layerA.forEach((id, i) => posA.set(id, i));
      const posB = new Map();
      layerB.forEach((id, i) => posB.set(id, i));
      const edges = [];
      for (const aId of layerA) {
        for (const n of (adjOut.get(aId) || [])) {
          if (setB.has(n)) edges.push([posA.get(aId), posB.get(n)]);
        }
        for (const n of (adjIn.get(aId) || [])) {
          if (setB.has(n)) edges.push([posA.get(aId), posB.get(n)]);
        }
      }
      return edges;
    }

    // Count crossings between two adjacent layers
    function countCrossings(layerA, layerB) {
      const edges = edgesBetween(layerA, layerB);
      let crossings = 0;
      for (let i = 0; i < edges.length; i++) {
        for (let j = i + 1; j < edges.length; j++) {
          if ((edges[i][0] - edges[j][0]) * (edges[i][1] - edges[j][1]) < 0) crossings++;
        }
      }
      return crossings;
    }

    // Total crossings across all adjacent layer pairs
    function totalCrossings() {
      let total = 0;
      for (let li = 0; li < sortedLevels.length - 1; li++) {
        total += countCrossings(layers.get(sortedLevels[li]), layers.get(sortedLevels[li + 1]));
      }
      return total;
    }

    // Neighbors connected to a specific adjacent layer (both directions)
    function neighborsInLayer(id, layerSet) {
      const result = [];
      for (const n of (adjOut.get(id) || [])) { if (layerSet.has(n)) result.push(n); }
      for (const n of (adjIn.get(id) || [])) { if (layerSet.has(n)) result.push(n); }
      return result;
    }

    // Snapshot the best ordering found so far
    let bestCrossings = totalCrossings();
    const bestOrder = new Map();
    for (const l of sortedLevels) {
      bestOrder.set(l, [...layers.get(l)]);
    }

    // Run multiple sweeps of barycentric ordering
    const NUM_SWEEPS = 6;
    for (let sweep = 0; sweep < NUM_SWEEPS; sweep++) {
      // Forward sweep (layer 0 → N): order each layer by avg index of predecessors in previous layer
      for (let li = 1; li < sortedLevels.length; li++) {
        const layer = layers.get(sortedLevels[li]);
        const prevLayer = layers.get(sortedLevels[li - 1]);
        const prevSet = new Set(prevLayer);
        const prevPos = new Map();
        prevLayer.forEach((id, i) => prevPos.set(id, i));

        const bary = new Map();
        for (const id of layer) {
          const nbrs = neighborsInLayer(id, prevSet);
          if (nbrs.length > 0) {
            bary.set(id, nbrs.reduce((s, n) => s + prevPos.get(n), 0) / nbrs.length);
          } else {
            bary.set(id, orderIndex.get(id) ?? 0);
          }
        }
        layer.sort((a, b) => bary.get(a) - bary.get(b));
        layer.forEach((id, i) => orderIndex.set(id, i));
      }

      // Backward sweep (layer N → 0): order each layer by avg index of successors in next layer
      for (let li = sortedLevels.length - 2; li >= 0; li--) {
        const layer = layers.get(sortedLevels[li]);
        const nextLayer = layers.get(sortedLevels[li + 1]);
        const nextSet = new Set(nextLayer);
        const nextPos = new Map();
        nextLayer.forEach((id, i) => nextPos.set(id, i));

        // Two-phase placement to avoid leaf siblings stealing the center
        // slot from a branching node. Branching nodes are anchored at a
        // position proportional to the center-of-mass of their children in
        // the next layer; leaves are then slotted into remaining positions
        // preserving their current relative order.
        const branching = [];
        const leaves = [];
        for (const id of layer) {
          const nbrs = neighborsInLayer(id, nextSet);
          if (nbrs.length > 0) {
            const avgNext = nbrs.reduce((s, n) => s + nextPos.get(n), 0) / nbrs.length;
            // Map [0, nextLayer.length-1] → [0, layer.length-1].
            // When the next layer has a single node, every branching node has
            // the same anchor (0); the collision loop below then shifts them
            // into distinct slots preserving avgNext order.
            const scale = nextLayer.length > 1 ? (layer.length - 1) / (nextLayer.length - 1) : 0;
            const targetPos = Math.round(avgNext * scale);
            branching.push({ id, targetPos, avgNext });
          } else {
            leaves.push(id);
          }
        }
        // Assign branching nodes to their target slots (resolve collisions
        // by shifting to the nearest free slot).
        const slots = new Array(layer.length).fill(null);
        branching.sort((a, b) => a.avgNext - b.avgNext);
        for (const b of branching) {
          let p = Math.max(0, Math.min(layer.length - 1, b.targetPos));
          if (slots[p] !== null) {
            // Find nearest free slot
            let found = -1;
            for (let d = 1; d < layer.length; d++) {
              if (p - d >= 0 && slots[p - d] === null) { found = p - d; break; }
              if (p + d < layer.length && slots[p + d] === null) { found = p + d; break; }
            }
            if (found >= 0) p = found;
          }
          slots[p] = b.id;
        }
        // Fill remaining slots with leaves in their current order
        let lIdx = 0;
        for (let i = 0; i < slots.length; i++) {
          if (slots[i] === null) {
            while (lIdx < leaves.length && leaves[lIdx] === undefined) lIdx++;
            slots[i] = leaves[lIdx++];
          }
        }
        layer.length = 0;
        layer.push(...slots);
        layer.forEach((id, i) => orderIndex.set(id, i));
      }

      // Track the best ordering seen so far.
      // Use `<=` so later (converged) orderings overwrite earlier ties —
      // the initial order may already have zero layer-pair crossings but
      // still produce physically crossed routes.
      const cur = totalCrossings();
      if (cur <= bestCrossings) {
        bestCrossings = cur;
        for (const l of sortedLevels) {
          bestOrder.set(l, [...layers.get(l)]);
        }
      }
    }

    // Restore the best ordering found across all sweeps
    for (const l of sortedLevels) {
      const layer = layers.get(l);
      const best = bestOrder.get(l);
      layer.length = 0;
      layer.push(...best);
      layer.forEach((id, i) => orderIndex.set(id, i));
    }

    // Adjacent-exchange refinement: swap neighboring pairs if it reduces total crossings
    for (let pass = 0; pass < 3; pass++) {
      for (let li = 0; li < sortedLevels.length; li++) {
        const layer = layers.get(sortedLevels[li]);
        if (layer.length < 2) continue;
        // Gather adjacent layers (check crossings against both neighbors)
        const adjLayers = [];
        if (li > 0) adjLayers.push(layers.get(sortedLevels[li - 1]));
        if (li < sortedLevels.length - 1) adjLayers.push(layers.get(sortedLevels[li + 1]));
        if (adjLayers.length === 0) continue;

        let improved = true;
        while (improved) {
          improved = false;
          for (let i = 0; i < layer.length - 1; i++) {
            let before = 0;
            for (const al of adjLayers) before += countCrossings(layer, al);
            // Swap
            [layer[i], layer[i + 1]] = [layer[i + 1], layer[i]];
            let after = 0;
            for (const al of adjLayers) after += countCrossings(layer, al);
            if (after < before) {
              improved = true; // keep swap
            } else {
              // Undo swap
              [layer[i], layer[i + 1]] = [layer[i + 1], layer[i]];
            }
          }
        }
        layer.forEach((id, i) => orderIndex.set(id, i));
      }
    }

    // --- Position layers using the optimized ordering ---
    if (isHorizontal) {
      let x = 0;
      for (const l of sortedLevels) {
        const col = layers.get(l);
        let y = 0, maxW = 0;
        for (const id of col) {
          const sz = sizes.get(id);
          pos.set(id, { x, y });
          y += sz.h + GAP_Y;
          maxW = Math.max(maxW, sz.w);
        }
        const offset = -(y - GAP_Y) / 2;
        for (const id of col) { pos.get(id).y += offset; }
        // Align single-element columns with predecessors
        if (col.length === 1 && l > sortedLevels[0]) {
          const id = col[0], sz = sizes.get(id);
          const preds = [...(adjIn.get(id) || [])].filter(n => pos.has(n));
          if (preds.length) {
            const avgCY = preds.reduce((s, n) => s + pos.get(n).y + (sizes.get(n)?.h || 0) / 2, 0) / preds.length;
            pos.get(id).y = avgCY - sz.h / 2;
          }
        }
        x += maxW + GAP_X;
      }
    } else {
      // Vertical: layers are rows (top-to-bottom)
      let y = 0;
      for (const l of sortedLevels) {
        const row = layers.get(l);
        let x = 0, maxH = 0;
        for (const id of row) {
          const sz = sizes.get(id);
          pos.set(id, { x, y });
          x += sz.w + GAP_X;
          maxH = Math.max(maxH, sz.h);
        }
        const offset = -(x - GAP_X) / 2;
        for (const id of row) { pos.get(id).x += offset; }
        // Align single-element rows with predecessors
        if (row.length === 1 && l > sortedLevels[0]) {
          const id = row[0], sz = sizes.get(id);
          const preds = [...(adjIn.get(id) || [])].filter(n => pos.has(n));
          if (preds.length) {
            const avgCX = preds.reduce((s, n) => s + pos.get(n).x + (sizes.get(n)?.w || 0) / 2, 0) / preds.length;
            pos.get(id).x = avgCX - sz.w / 2;
          }
        }
        y += maxH + GAP_Y;
      }
    }
  }

  components.forEach(comp => layoutComponent(comp));

  // Arrange disconnected components: horizontal stacks side-by-side, vertical stacks top-to-bottom
  const COMP_GAP = 64;
  if (isHorizontal) {
    let compX = 0;
    for (const comp of components) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const id of comp) { const p = pos.get(id), sz = sizes.get(id); minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + sz.w); maxY = Math.max(maxY, p.y + sz.h); }
      for (const id of comp) { const p = pos.get(id); p.x += compX - minX; p.y += -minY; }
      compX += (maxX - minX) + COMP_GAP;
    }
  } else {
    let compY = 0;
    for (const comp of components) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const id of comp) { const p = pos.get(id), sz = sizes.get(id); minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + sz.w); maxY = Math.max(maxY, p.y + sz.h); }
      for (const id of comp) { const p = pos.get(id); p.x += -minX; p.y += compY - minY; }
      compY += (maxY - minY) + COMP_GAP;
    }
  }

  // Overlap removal — prefer horizontal push to preserve layer structure
  const MIN_SEP = 56;
  const ids = [...pos.keys()];
  for (let iter = 0; iter < 80; iter++) {
    let anyOverlap = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i]), b = pos.get(ids[j]);
        const sa = sizes.get(ids[i]), sb = sizes.get(ids[j]);
        const ax = a.x + sa.w / 2, ay = a.y + sa.h / 2;
        const bx = b.x + sb.w / 2, by = b.y + sb.h / 2;
        const dx = bx - ax, dy = by - ay;
        const overlapX = (sa.w + sb.w) / 2 + MIN_SEP - Math.abs(dx);
        const overlapY = (sa.h + sb.h) / 2 + MIN_SEP - Math.abs(dy);
        if (overlapX > 0 && overlapY > 0) {
          anyOverlap = true;
          // Always push horizontally to preserve layer rows
          const push = overlapX / 2 + 1;
          if (dx >= 0) { a.x -= push; b.x += push; } else { a.x += push; b.x -= push; }
        }
      }
    }
    if (!anyOverlap) break;
  }

  // Apply positions — move parents and let embedded children follow
  let globalMinX = Infinity, globalMinY = Infinity;
  for (const [, p] of pos) {
    globalMinX = Math.min(globalMinX, p.x);
    globalMinY = Math.min(globalMinY, p.y);
  }
  const PAD = grid * 4;
  layoutEls.forEach(el => {
    const p = pos.get(el.id);
    if (!p) return;
    const newX = Math.round((p.x - globalMinX + PAD) / grid) * grid;
    const newY = Math.round((p.y - globalMinY + PAD) / grid) * grid;
    const oldPos = el.position();
    const dx = newX - oldPos.x;
    const dy = newY - oldPos.y;
    // Move the element — JointJS automatically moves embedded children
    el.translate(dx, dy);
  });


  fitContent();
}

// ── Sequence Auto Layout ─────────────────────────────────────────────
// Unifies port count across every lane (SequenceParticipant + SequenceActor
// with lifeline shown) and aligns them vertically so same-index ports share
// the same canvas Y — connectors between e.g. "port 3" on different lanes
// become perfectly parallel.
//
// Port formulas (see js/shapes.js):
//   Participant: Py(i) = 48 + r_i * (h - 96)         [topOffset=48, botOffset=48]
//   Actor:       Py(i) = 92 + r_i * (h - 92)         [topOffset=92, botOffset=0]
// With r_i = (i+1)/(n+1). To align across lanes we need common
//   Ls = pos.y + topOffset       (lifeline start canvas Y)
//   Sp = h - topOffset - botOffset  (lifeline span)
//   n  = lifelinePortCount
const SEQ_LANE_GEO = {
  'sf.SequenceParticipant': { top: 48, bottom: 48 },
  'sf.SequenceActor':       { top: 92, bottom: 0  },
};

function _getSequenceLanes() {
  return graph.getElements().filter(el => {
    const t = el.get('type');
    if (t === 'sf.SequenceParticipant') return true;
    if (t === 'sf.SequenceActor' && el.get('showLifeline') === true) return true;
    return false;
  });
}

function _laneLabel(el) {
  const txt = el.attr('label/text') || el.attr('labelBottom/text') || '';
  return String(txt).trim() || '(unnamed lane)';
}

export function analyzeSequenceLayout() {
  const lanes = _getSequenceLanes();
  if (lanes.length < 2) {
    return { status: 'empty', lanes: [], mismatches: [] };
  }
  const info = lanes.map(el => {
    const t = el.get('type');
    const geo = SEQ_LANE_GEO[t];
    const pos = el.position();
    const size = el.size();
    const count = el.get('lifelinePortCount') || 5;
    const ratios = el.get('lifelinePortRatios');
    const hasCustomRatios = Array.isArray(ratios) && ratios.length === count;
    return {
      id: el.id,
      cell: el,
      type: t,
      label: _laneLabel(el),
      count,
      hasCustomRatios,
      top: geo.top,
      bottom: geo.bottom,
      ls: pos.y + geo.top,
      sp: size.height - geo.top - geo.bottom,
    };
  });

  const counts = info.map(l => l.count);
  const targetCount = Math.max(...counts);
  const sorted = [...info.map(l => l.ls)].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const targetLs = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const targetSp = Math.max(...info.map(l => l.sp));

  const mismatches = info
    .filter(l => l.count !== targetCount || l.hasCustomRatios)
    .map(l => ({ id: l.id, label: l.label, count: l.count, hasCustomRatios: l.hasCustomRatios }));

  const hasLinks = graph.getLinks().length > 0;
  const status = (mismatches.length > 0 && hasLinks) ? 'would-change' : 'ok';

  return {
    status,
    lanes: info,
    targetCount,
    targetLs: Math.round(targetLs),
    targetSp: Math.round(targetSp),
    mismatches,
  };
}

export function applySequenceAutoLayout(plan) {
  if (!plan || !plan.lanes || plan.lanes.length < 2) return;
  const { lanes, targetCount, targetLs, targetSp } = plan;

  // Per-lane Y delta (how far each lane's top-left moves down).
  const laneDy = new Map();
  for (const l of lanes) {
    laneDy.set(l.id, (targetLs - l.top) - l.cell.position().y);
  }

  // Spec-style diagrams (as documented in DIAGRAM_JSON_SPEC.md and produced
  // by LLMs) anchor messages to lanes via `topLeft` + fixed `dy`. The anchor
  // resolves to `pos.y + dy` in canvas coords, so shifting a lane would shift
  // every message attached to it. Compensate by subtracting the lane's move
  // from each topLeft anchor so message canvas Y stays put.
  const laneIds = new Set(lanes.map(l => l.id));
  for (const link of graph.getLinks()) {
    for (const endKey of ['source', 'target']) {
      const end = link.get(endKey);
      if (!end || !end.id || !laneIds.has(end.id)) continue;
      const anchor = end.anchor;
      if (!anchor || anchor.name !== 'topLeft') continue;
      const dy = laneDy.get(end.id) || 0;
      if (dy === 0) continue;
      const curDy = anchor.args?.dy || 0;
      link.prop([endKey, 'anchor', 'args', 'dy'], curDy - dy);
    }
  }

  // Move + resize lanes. Use `position()` (non-cascading) so embedded
  // activations keep their canvas Y — their role is to mark when a lane is
  // "active" at a specific message timing, which must stay put to match the
  // compensated message anchors above.
  for (const l of lanes) {
    const dy = laneDy.get(l.id) || 0;
    const curPos = l.cell.position();
    const newH = targetSp + l.top + l.bottom;
    if (dy !== 0) l.cell.position(curPos.x, curPos.y + dy);
    const curSize = l.cell.size();
    if (Math.abs(curSize.height - newH) > 0.5) {
      l.cell.resize(curSize.width, newH);
    }
    if (l.type === 'sf.SequenceParticipant') {
      joint.shapes.sf.rebuildSeqParticipantPorts(l.cell, targetCount);
    } else {
      joint.shapes.sf.rebuildSeqActorPorts(l.cell, targetCount);
    }
  }
}

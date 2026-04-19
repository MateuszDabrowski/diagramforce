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

// Flag set by persistence.js around every graph.fromJSON() call so the
// 'add' listener skips z-assignment and preserves the saved values.
let _isLoadingJSON = false;
export function setLoadingJSON(v) { _isLoadingJSON = v; }

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

// Perpendicular-exit orthogonal router with obstacle avoidance.
// Guarantees a 32px stub out from each port before routing, and never crosses
// non-endpoint elements. Falls back to JointJS manhattan when port info is unavailable.
function registerSfRouter() {
  const STUB = 32;  // distance from port to first turn — must exceed defaultConnectionPoint offset (16px) + arrow length (14px)
  const PAD = 16;   // clearance around obstacles (must be < STUB so stubs are outside padded zones)

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

    try {
      if (vertices.length > 0) {
        const waypoints = [from, ...vertices, to];
        const route = [from];
        for (let i = 0; i < waypoints.length - 1; i++) {
          if (i > 0) route.push(waypoints[i]);
          route.push(...orthoRoute(waypoints[i], waypoints[i + 1], obstacles));
        }
        route.push(to);
        return route;
      }

      return [from, ...orthoRoute(from, to, obstacles), to];
    } catch (_) {
      // Fallback to direct vertices if routing calculation errors
      return vertices;
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
          },
          targetMarker: {
            type: 'path',
            d: 'M 0 -6 L -14 0 L 0 6 z',
          },
        },
      },
      router: { name: 'sfManhattan' },
      connector: { name: 'rounded', args: { radius: 8 } },
    }),

    defaultConnectionPoint: { name: 'anchor', args: { offset: 16 } },

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
    validateEmbedding: (childView, parentView) => {
      const parentType = parentView.model.get('type');
      const childType = childView.model.get('type');
      // Container accepts Nodes, Notes, Texts (not other Containers or Zones)
      if (parentType === 'sf.Container') {
        return childType !== 'sf.Container' && childType !== 'sf.Zone';
      }
      // Zone accepts everything except other Zones
      if (parentType === 'sf.Zone') {
        return childType !== 'sf.Zone';
      }
      // BpmnPool accepts any BPMN/Flow shape (including subprocesses and loops)
      if (parentType === 'sf.BpmnPool') {
        return childType !== 'sf.BpmnPool';
      }
      // BpmnSubprocess accepts BPMN shapes except pools and other subprocesses
      if (parentType === 'sf.BpmnSubprocess') {
        return childType !== 'sf.BpmnPool' && childType !== 'sf.BpmnSubprocess';
      }
      // BpmnLoop accepts BPMN shapes except pools, subprocesses and other loops
      if (parentType === 'sf.BpmnLoop') {
        return childType !== 'sf.BpmnPool' && childType !== 'sf.BpmnSubprocess' && childType !== 'sf.BpmnLoop';
      }
      // GanttTimeline accepts GanttTask, GanttMilestone, GanttGroup
      if (parentType === 'sf.GanttTimeline') {
        return childType === 'sf.GanttTask' || childType === 'sf.GanttMilestone' || childType === 'sf.GanttMarker' || childType === 'sf.GanttGroup';
      }
      // Sequence: Participant and Actor lifelines capture Activations (like a
      // Zone captures Nodes) so moving the lifeline carries the activation.
      if (parentType === 'sf.SequenceParticipant' || parentType === 'sf.SequenceActor') {
        return childType === 'sf.SequenceActivation';
      }
      return false;
    },

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
    const currentDash = link.attr('line/strokeDasharray');
    if (currentDash && currentDash !== 'none') return;
    link.attr('line/strokeDasharray', '6 4');
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

  paper.on('element:pointermove', (cellView) => {
    clearGuides();
    const movedEl = cellView.model;
    // Skip snap-to-grid for embedded children — they move with their parent
    // Also skip for elements with embedded children to prevent drift
    if (movedEl.get('parent') || movedEl.getEmbeddedCells().length) return;
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
  });

  paper.on('element:pointerup', (cellView) => {
    clearGuides();
    if (cellView?.model?.get('type') === 'sf.SequenceActivation') {
      snapActivationToLifeline(cellView.model);
    }
  });

  return { graph, paper };
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

    restorePanelHeight(target);

    // Use pointer events — works for both mouse and touch
    handle.addEventListener('pointerdown', (evt) => {
      // Only act on mobile
      if (window.innerWidth > MOBILE_BP) return;

      evt.preventDefault();
      evt.stopPropagation();
      handle.setPointerCapture(evt.pointerId);

      const startY = evt.clientY;
      const startH = target.getBoundingClientRect().height;
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';

      const onMove = (e) => {
        const delta = startY - e.clientY;
        const maxH = window.innerHeight * 0.8;
        const newH = Math.max(80, Math.min(maxH, startH + delta));
        target.style.height = newH + 'px';
      };

      const onEnd = () => {
        document.body.style.userSelect = '';
        document.body.style.webkitUserSelect = '';
        const finalH = Math.round(target.getBoundingClientRect().height);
        localStorage.setItem(PANEL_HEIGHT_KEY, finalH);
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

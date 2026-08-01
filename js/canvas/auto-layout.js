// Auto-layout domain — extracted from canvas.js (Phase 4, Slice 3).
// Force-directed layout (autoLayout) + sequence-diagram lane alignment
// (analyzeSequenceLayout / applySequenceAutoLayout). Reads the live graph,
// paper, and fitContent through the canvas context (cctx); canvas.js is the
// sole writer and wires cctx.fitContent in init().
import { cctx } from './context.js?v=1.22.0';
// The layered engine, extracted pure (Stage C C2) so it can also drive scoped group interiors (C5).
import { layoutGraphSubset, detectFlowAxis } from './layout-core.js?v=1.22.0';
// Flow tree layout (S3) — pure, does NOT use the barycentre core (avoids the F7 join defect).
import { computeFlowLayout } from './flow-layout.js?v=1.22.0';
import { flowConnectorType } from './link-styles.js?v=1.22.0';
import { resolveFlowLabelCollisions } from './flow-label-placement.js?v=1.22.0';


// ── Auto Layout (improved force-directed with tight packing) ─────────
// Groups (containers, zones, pools) are treated as single layout units —
// their embedded children move with them and maintain relative positions.
export function autoLayout(direction, opts = {}) {
  const { graph, paper, fitContent } = cctx;
  // v2 "Layered" (opts.align==='barycenter'): same ranks + crossing-minimised order as the default,
  // but the final COORDINATE step pulls each node toward its neighbours' barycentre so children sit
  // under their parents (the default only centres each layer by order). Default path is unchanged.
  const align = opts.align === 'barycenter' ? 'barycenter' : 'sequential';
  // Always frame the SETTLED layout. Refit group parents first (a BpmnPool reserves
  // its left header band; containers/zones hug their children) so their bounds are
  // real, fit once now, then once more on the next frame — embedding refits and
  // resize events can fire async, which would otherwise leave the fit slightly off.
  const fitAfterLayout = () => {
    cctx.refitAllParents?.();
    fitContent();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { cctx.fitContent?.(); });
  };
  const elements = graph.getElements();
  if (elements.length < 2) { if (elements.length) fitAfterLayout(); return; }


  const links = graph.getLinks();
  const grid = paper.options.gridSize || 16;

  // Identify parent types that act as groups
  const GROUP_TYPES = new Set(['sf.Container', 'sf.Zone', 'sf.BpmnPool', 'sf.BpmnSubprocess', 'sf.BpmnLoop']);

  // Build a set of embedded child IDs — these are excluded from top-level layout
  const embeddedIds = new Set();
  elements.forEach(el => {
    if (el.get('parent')) embeddedIds.add(el.id);
  });

  // PARKED ANNOTATIONS (Stage A): a free-floating Note / TextLabel / Legend / Image with NO connectors isn't part
  // of the flow - ranking it into the layout drags it into the diagram and overlaps content (the reported bug).
  // Pull these out of the layout and re-park them as a tidy right-hand margin AFTER the content settles. Only
  // UNCONNECTED, top-level ones (an annotation wired to a node stays in the flow).
  // `df.Table` is here for the converter-authored FACTS cards - a flow's `__flowmeta` / `__flowresources`, a
  // data graph's `__dgmeta`. They gloss the diagram rather than take part in it, and ranking one drags it into
  // the content: measured on a Profile data graph, the facts card landed at the BOTTOM of the tree, reported as
  // "it would be better if Table could be either on the side or above the first element". `isParkable` requires
  // NO connectors, so a table someone wired into their diagram stays in the layout where it belongs.
  const ANNOTATION_TYPES = new Set(['sf.Note', 'sf.TextLabel', 'df.Legend', 'sf.Image', 'df.Table']);
  const connectedIds = new Set();
  for (const l of links) { const s = l.get('source')?.id, t = l.get('target')?.id; if (s) connectedIds.add(s); if (t) connectedIds.add(t); }
  const isParkable = (el) => ANNOTATION_TYPES.has(el.get('type')) && !el.get('parent') && !connectedIds.has(el.id);
  const parkedAnnotations = elements.filter(isParkable);

  // Top-level elements to lay out (not embedded children, not parked annotations)
  const layoutEls = elements.filter(el => {
    if (embeddedIds.has(el.id)) return false;
    if (isParkable(el)) return false;
    return true;
  });
  if (layoutEls.length < 2) { fitAfterLayout(); return; }

  // Park the unconnected annotations in the right margin, stacked top-to-bottom (preserving their order), clear
  // of the laid-out content. Called AFTER content positions settle. Position changes are captured by the
  // recordPositionsBatch wrapper in runAutoLayout, so this undoes with the rest of the auto-layout.
  function parkAnnotations() {
    if (!parkedAnnotations.length) return;
    const bb = graph.getCellsBBox(layoutEls);
    if (!bb) return;
    const marginX = Math.round(bb.x + bb.width + grid * 6);
    let y = Math.round(bb.y);
    parkedAnnotations.slice().sort((a, b) => a.position().y - b.position().y).forEach((a) => {
      const cur = a.position();
      a.translate(marginX - cur.x, y - cur.y);
      y += a.size().height + 32;
    });
  }

  // Layout UNITS: each top-level element as a box. Sizes are the element's own size —
  // embedded children ride along with their parent (groups are rigid units on this path).
  const units = layoutEls.map((el) => {
    const s = el.size();
    return { id: el.id, w: s.width, h: s.height };
  });
  const unitIds = new Set(units.map((u) => u.id));

  // Helper: resolve an element ID to its top-level layout ID
  function toLayoutId(cellId) {
    if (unitIds.has(cellId)) return cellId;
    const cell = graph.getCell(cellId);
    const parentId = cell?.get('parent');
    if (parentId && unitIds.has(parentId)) return parentId;
    // Nested deeper — walk up
    let cur = cell;
    while (cur) {
      const pid = cur.get('parent');
      if (!pid) break;
      if (unitIds.has(pid)) return pid;
      cur = graph.getCell(pid);
    }
    return null;
  }

  // Resolve every link onto the units it connects. Self-edges and links whose endpoints don't
  // resolve are dropped (layoutGraphSubset also guards, but keep the intent visible here).
  const edges = [];
  for (const link of links) {
    const sId = toLayoutId(link.get('source')?.id);
    const tId = toLayoutId(link.get('target')?.id);
    if (sId && tId && sId !== tId) edges.push({ source: sId, target: tId });
  }

  // Detect diagram type to choose layout direction
  // Flow/BPMN → horizontal (left-to-right), everything else → vertical (top-to-bottom)
  // The AXIS is the caller's decision, not the engine's — Stage C M2 will override this in laneMode.
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

  // GEOMETRIC AXIS DETECTION (Stage C M2) — opt-in via opts.detectAxis (the promoted "Auto Layout"
  // button). The button hard-codes 'vertical', so a diagram a human drew LEFT→RIGHT (numbered lanes
  // running across the page) is otherwise rotated into an unreadable tall column. Read the intended
  // axis back out of the EXISTING geometry and let it win — but ONLY in "lane mode", i.e. a diagram
  // that is mostly grouped content (≥2 top-level Zone/Container groups AND ≥50% of cells embedded).
  // The gate matters: a hub diagram can have 2 containers sitting side-by-side (wide x-spread) while
  // its real flow is vertical — mixed-hub is exactly that (28% embedded), so it stays OFF this path.
  if (opts.detectAxis) {
    const groups = layoutEls.filter((el) => {
      const t = el.get('type');
      return t === 'sf.Zone' || t === 'sf.Container';
    });
    const laneMode = groups.length >= 2 && (embeddedIds.size / elements.length) >= 0.5;
    if (laneMode) {
      // Read the axis from the LANE (group) arrangement — that is where the author's intent lives.
      const boxes = groups.map((g) => { const p = g.position(), s = g.size(); return { x: p.x, y: p.y, w: s.width, h: s.height }; });
      const axis = detectFlowAxis(boxes);
      if (axis.confident) isHorizontal = axis.isHorizontal;   // ambiguous spread ⇒ keep the caller's default
    }
  }

  // The layered engine (Stage C C2): ranks + crossing reduction + coordinates + component
  // stacking + overlap removal. Pure — returns local, unrounded coordinates.
  // Gaps come from the engine's defaults (GAP_X/GAP_Y keyed on the axis).
  // breakCycles (Stage C M6): architecture diagrams legitimately contain feedback edges
  // (reports/analytics flowing back upstream). Ranking on the raw graph let those poison the
  // longest-path levels — the mixed-hub fixture collapsed to a single 12-node rank (a 3729px smear)
  // and the lane diagram's flow order inverted. Ignore back-edges when RANKING; they still render.
  //
  // maxRankExtent / rankMedianFactor (M7): wrap a rank wider than max(1400, 2 × median rank) into
  // sub-rows. Both numbers are MEASURED, not guessed (dev/scripts/measure-layout.mjs): on mixed-hub
  // the cap takes aspect 2.92 → 1.38 and total connector skew 8497 → 3786, and it fires on no other
  // fixture. The plan's original 3× factor was tried and is worse on every metric (1.67 / 5211).
  const pos = layoutGraphSubset(units, edges, {
    isHorizontal, align, breakCycles: true,
    maxRankExtent: opts.maxRankExtent ?? 1400, rankMedianFactor: opts.rankMedianFactor ?? 2,
  });

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
    // Translate the whole layout to a grid-aligned origin (PAD) but keep EXACT relative positions - round to
    // INTEGER, not to the grid. A per-node grid-snap (`round(x/grid)*grid`) rounds two centre-aligned nodes of
    // DIFFERENT widths to DIFFERENT centres (e.g. a 120-wide Process at 384 and its aligned 60-wide child land on
    // 384 and 416 -> centres 444 vs 446), which jogs an otherwise-straight connector. Integer rounding shifts both
    // by the same fractional amount, so aligned centres stay aligned and the connector renders dead-straight.
    const newX = Math.round(p.x - globalMinX + PAD);
    const newY = Math.round(p.y - globalMinY + PAD);
    const oldPos = el.position();
    const dx = newX - oldPos.x;
    const dy = newY - oldPos.y;
    // Move the element — JointJS automatically moves embedded children
    el.translate(dx, dy);
  });

  parkAnnotations();   // re-park unconnected Note/TextLabel/Legend/Image to the right margin (Stage A)

  fitAfterLayout();
}

// ── Data Mapping Auto Layout ─────────────────────────────────────────
// One COLUMN per layer TYPE — every Source zone shares a column, every DLO zone the
// next, etc. — with the Data Cloud flow running left→right:
//   Custom → Source → DLO → DMO → Activation, then flow-depth columns of free objects.
// Same-type zones stack vertically within their column. All columns top-align at TOP.
// Object + zone order WITHIN a column is chosen by a barycentre sweep that shortens the
// total connector length (connected objects line up across columns). Unzoned objects each
// form a singleton unit in a flow-depth column appended at the right.
export function applyDataMappingLayout() {
  const { graph, fitContent } = cctx;
  const objects = graph.getElements().filter(e => e.get('type') === 'sf.DataObject');
  if (objects.length < 2) return;
  const zones = graph.getElements().filter(e => e.get('type') === 'sf.Zone');

  const OBJ_GAP = 36;   // vertical gap between objects within a zone
  const ZONE_GAP = 56;  // vertical gap between stacked zones in one column
  const LANE_GAP = 200; // horizontal gap between columns
  const PAD = 16;       // zone inner side/bottom padding
  const HEAD = 44;      // zone inner top inset (clears the layer label)
  const TOP = 0;        // shared upper edge for every column

  // Undirected object↔object mapping adjacency (for the barycentre).
  const objIds = new Set(objects.map(o => o.id));
  const adj = new Map(objects.map(o => [o.id, []]));
  // Directed incoming (free objects → flow-depth).
  const inn = new Map(objects.map(o => [o.id, []]));
  for (const l of graph.getLinks()) {
    if (l.prop('linkKind') !== 'mapping') continue;
    const s = l.get('source')?.id, t = l.get('target')?.id;
    if (objIds.has(s) && objIds.has(t) && s !== t) { adj.get(s).push(t); adj.get(t).push(s); inn.get(t).push(s); }
  }

  // Classify zones into type-columns. A unit = one zone + its objects (or, for a free
  // object, a zone-less singleton). Column order = TYPE_ORDER, free columns appended.
  const TYPE_ORDER = ['custom', 'source', 'dlo', 'dmo', 'activation'];
  // `datastream` shares the SOURCE band (same blue): it lays out in the leftmost column,
  // stacked directly below the Source zone(s) — see the source-column sort below.
  const typeOf = s => {
    if (s === 'datastream') return 'source';
    return (s === 'source' || s === 'dlo' || s === 'dmo' || s === 'activation') ? s : 'custom';
  };
  const unitsByType = new Map();
  const laned = new Set();
  for (const z of zones) {
    const kids = (z.get('embeds') || []).map(id => graph.getCell(id)).filter(c => c && c.get('type') === 'sf.DataObject');
    if (!kids.length) continue;
    kids.forEach(k => laned.add(k.id));
    const t = typeOf(z.get('layerStage'));
    if (!unitsByType.has(t)) unitsByType.set(t, []);
    unitsByType.get(t).push({ zone: z, objects: kids });
  }
  const columns = [];
  for (const t of TYPE_ORDER) if (unitsByType.has(t)) columns.push({ units: unitsByType.get(t) });

  // Free (unzoned) objects → flow-depth pseudo-columns appended after the typed ones.
  const free = objects.filter(o => !laned.has(o.id));
  if (free.length) {
    const freeSet = new Set(free.map(o => o.id));
    const depth = new Map();
    const calc = (id, seen) => {
      if (depth.has(id)) return depth.get(id);
      if (seen.has(id)) return 0;          // cycle guard
      seen.add(id);
      let d = 0;
      for (const p of inn.get(id)) if (freeSet.has(p)) d = Math.max(d, calc(p, seen) + 1);
      seen.delete(id); depth.set(id, d); return d;
    };
    free.forEach(o => calc(o.id, new Set()));
    const byDepth = new Map();
    free.forEach(o => { const d = depth.get(o.id); if (!byDepth.has(d)) byDepth.set(d, []); byDepth.get(d).push(o); });
    [...byDepth.keys()].sort((a, b) => a - b).forEach(d =>
      columns.push({ units: byDepth.get(d).map(o => ({ zone: null, objects: [o] })) }));
  }
  if (!columns.length) return;

  // Live centre-y per object, seeded from current positions; restack() rewrites it.
  const cy = new Map(objects.map(o => [o.id, o.position().y + o.size().height / 2]));
  // Stack a column top→down in its CURRENT unit/object order, recording each object's y
  // (in `_objY`) and refreshing `cy`. All columns start at TOP, so they top-align.
  const restack = (col) => {
    let y = TOP;
    for (const u of col.units) {
      u._objY = new Map();
      if (u.zone) y += HEAD;
      for (const o of u.objects) {
        const h = o.size().height;
        u._objY.set(o.id, y);
        cy.set(o.id, y + h / 2);
        y += h + OBJ_GAP;
      }
      y -= OBJ_GAP;
      if (u.zone) y += PAD;
      y += ZONE_GAP;
    }
  };
  columns.forEach(restack);

  // Barycentre sweeps: order objects within a unit, and units within a column, by the
  // mean centre-y of their connected neighbours — pulling connected objects level and
  // shortening connectors. Alternating L→R / R→L passes propagate both ways.
  const bary = (id) => { const ns = adj.get(id); if (!ns.length) return cy.get(id); let s = 0; for (const n of ns) s += cy.get(n); return s / ns.length; };
  for (let pass = 0; pass < 4; pass++) {
    const order = (pass % 2 === 0) ? columns : [...columns].reverse();
    for (const col of order) {
      for (const u of col.units) u.objects.sort((a, b) => bary(a.id) - bary(b.id));
      const uMean = u => u.objects.reduce((s, o) => s + bary(o.id), 0) / u.objects.length;
      col.units.sort((a, b) => {
        // Pin Data Stream zones BELOW Source zones in the shared leftmost band (same blue,
        // conceptually "below Source") — regardless of barycentre, which would otherwise let a
        // Data Stream lane float above Source.
        const sa = a.zone?.get('layerStage') === 'datastream' ? 1 : 0;
        const sb = b.zone?.get('layerStage') === 'datastream' ? 1 : 0;
        if (sa !== sb) return sa - sb;
        return uMean(a) - uMean(b);
      });
      restack(col);
    }
  }

  // Final placement: assign x per column, then position/resize zones + objects.
  let cursorX = 0;
  for (const col of columns) {
    const allObjs = col.units.flatMap(u => u.objects);
    const maxW = Math.max(...allObjs.map(o => o.size().width));
    const hasZone = col.units.some(u => u.zone);
    const colW = maxW + (hasZone ? PAD * 2 : 0);
    const contentX = cursorX + (hasZone ? PAD : 0);
    for (const u of col.units) {
      if (u.zone) {
        const firstO = u.objects[0], lastO = u.objects[u.objects.length - 1];
        const top = u._objY.get(firstO.id) - HEAD;
        const bottom = u._objY.get(lastO.id) + lastO.size().height + PAD;
        u.zone.position(Math.round(cursorX), Math.round(top));
        u.zone.resize(Math.round(colW), Math.round(bottom - top));
      }
      for (const o of u.objects) {
        o.position(Math.round(contentX + (maxW - o.size().width) / 2), Math.round(u._objY.get(o.id)));
      }
    }
    cursorX += colW + LANE_GAP;
  }

  fitContent();
}

// ── Flow Auto Layout (S3) ────────────────────────────────────────────
// A type-owned vertical tree layout for the 'flow' diagram type. Reads df.Flow* elements + their standard.Link
// edges (fault edges — derived from the red style — route off to the side), computes positions with the PURE
// tree layout (computeFlowLayout — NOT the
// barycentre core), and writes element positions ONLY (never link vertices). Anchored at the current top-left so
// the layout doesn't teleport; the toolbar wraps this in recordPositionsBatch (one undo entry) + snapLinksToPorts
// (facing-port attach) + a re-fit. Links re-route through sfManhattan on the next render.
export function applyFlowLayout() {
  const { graph } = cctx;
  const elements = graph.getElements().filter((e) => String(e.get('type')).startsWith('df.Flow'));
  if (elements.length < 2) return;
  const ids = new Set(elements.map((e) => e.id));
  // Pass each node's CURRENT centre-x so the layout keeps sibling branches in the left-to-right order the user
  // arranged them (rather than re-ordering by link-creation order).
  const nodes = elements.map((e) => ({ id: e.id, w: e.size().width, h: e.size().height, cx: e.position().x + e.size().width / 2 }));
  const edges = [];
  const flowLinks = [];
  for (const l of graph.getLinks()) {
    const s = l.get('source')?.id, t = l.get('target')?.id;
    if (ids.has(s) && ids.has(t)) {
      // Classify by connector TYPE: Fault = lateral, Go To = a cross-reference that must NOT shape the tree (a
      // forward Go To would otherwise drag its target down like a real edge), Standard = the spine.
      const t3 = flowConnectorType(l);
      edges.push({ source: s, target: t, kind: t3 === 'fault' ? 'fault' : t3 === 'goto' ? 'goto' : 'regular' });
      flowLinks.push(l);
    }
  }
  const pos = computeFlowLayout({ nodes, edges });
  // Anchor at the current bounding-box top-left so the tree lands roughly where the flow already is.
  let ox = Infinity, oy = Infinity;
  for (const e of elements) { const p = e.position(); if (p.x < ox) ox = p.x; if (p.y < oy) oy = p.y; }
  for (const e of elements) {
    const p = pos.get(e.id);
    if (p) e.position(Math.round(ox + p.x), Math.round(oy + p.y));
  }
  // Re-snap each flow link's ports + clear stale vertices + re-centre its label. A flow is a strict TOP-DOWN
  // tree, so a link snaps by VERTICAL direction (parent above child → source-bottom / target-top), NOT by the
  // generic "facing port" heuristic which, when a branch sits a full column to the side, wrongly picks the side
  // ports (the reported decision-fork side-attach). A GO TO is a free cross-reference — leave its user-set ports.
  for (const l of flowLinks) {
    if ((l.get('vertices') || []).length) l.set('vertices', []);
    const labels = l.labels?.() || [];
    if (labels.length) l.labels(labels.map((lb) => ({ ...lb, position: { distance: 0.5, offset: 0 } })));
    if (flowConnectorType(l) === 'goto') continue;
    const s = graph.getCell(l.get('source')?.id), t = graph.getCell(l.get('target')?.id);
    if (!s || !t) continue;
    const down = (t.position().y + t.size().height / 2) >= (s.position().y + s.size().height / 2);
    const sp = down ? 'port-bottom' : 'port-top', tp = down ? 'port-top' : 'port-bottom';
    if (s.getPort?.(sp)) l.source({ id: s.id, port: sp });
    if (t.getPort?.(tp)) l.target({ id: t.id, port: tp });
  }
  // ...then RESOLVE the labels we just re-centred. Auto Layout resets every label to `distance: 0.5` above,
  // which is the right SEED - every route has changed - but on a Decision fan-out it puts two ~250px pills at the
  // midpoints of two connectors sharing a source, and they land on each other. Reported as "auto layout on Flows
  // still overlays the labels even when they can be cleanly positioned manually".
  //
  // Safe to call here, and only here, because this whole function runs inside `recordPositionsBatch` (see
  // js/toolbar.js runAutoLayout): that batch sets `_suppressPositionTracking`, so the per-change `change:labels`
  // listener bails, and the batch captures the label diffs itself as part of the SAME undo step. Calling the
  // resolver from a bare `render:done` instead would push its own command and clear the redo stack.
  // `preferTargetCentre`: the labels were just reset to the path midpoint two loops up, so the resolver must
  // not treat that midpoint as a placement worth preserving - it should start from the point on each path that
  // sits over the card the connector points at, and only search outward from there.
  resolveFlowLabelCollisions(cctx, { preferTargetCentre: true });

  // Frame by the ELEMENTS bbox via fitToCells — NOT paper.getContentBBox, which returns a degenerate zero box
  // when a link view (a loop back-edge) resolves late, slamming the zoom. Fit now AND on the next frame: the
  // immediate fit can read a not-yet-laid-out paper rect (→ a clamped-min zoom), the rAF fit corrects it once
  // the paper has its real size. The element positions are final, so the bbox is stable across both.
  const fit = () => { const bb = graph.getCellsBBox(elements); if (bb && cctx.fitToCells) cctx.fitToCells(bb); };
  fit();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fit);
}

/**
 * Target-centred label placement for NON-flow diagrams - the datamodel Auto Layout's second pass (1.22.0).
 * The same resolver applyFlowLayout uses, opened up via `scope: 'any'` (no df.Flow gate). Call AFTER
 * snapLinksToPorts inside recordPositionsBatch, for the same undo-batching
 * reason documented above resolveFlowLabelCollisions' call in applyFlowLayout: the batch captures the label
 * diffs as part of the one layout undo step. `preferTargetCentre` because snapLinksToPorts has just reset
 * every label to its path midpoint - a seed, not a placement worth preserving.
 */
export function resolveConnectorLabels(opts = {}) {
  resolveFlowLabelCollisions(cctx, { preferTargetCentre: true, scope: 'any', ...opts });
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
  const { graph } = cctx;
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
  const { graph } = cctx;
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
  const { graph } = cctx;
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

  // ── X-spacing (v1.15.1) ─────────────────────────────────────────────
  // Auto Layout is an explicit "tidy" action, so even out the horizontal lifeline
  // spacing too. Keep the OUTERMOST two lanes fixed — preserves the diagram's overall
  // span and (importantly) any full-width alt/loop fragment frame, whose edges align
  // with the outer lanes — and redistribute the INTERIOR lanes at equal centre
  // intervals. Messages need NO dx compensation (unlike the dy case): a message's
  // `topLeft` anchor dx is relative to the lane's left edge, so the endpoint rides the
  // lifeline as the lane moves. position() is non-cascading, so embedded activations
  // stay put here and are re-centred (below) onto the lane's new lifeline.
  const centerX = (cell) => cell.position().x + cell.size().width / 2;
  const ordered = [...lanes].sort((a, b) => centerX(a.cell) - centerX(b.cell));

  // Record each fragment's spanned lanes + its original padding BEFORE the move, so we
  // can re-wrap it afterwards. (Endpoints stay fixed, so a full-width fragment is a
  // no-op; only a fragment around interior-only lanes actually shifts.)
  const fragSpans = graph.getElements()
    .filter(el => el.get('type') === 'sf.SequenceFragment')
    .map(f => {
      const fb = f.getBBox();
      const inside = ordered.filter(l => { const c = centerX(l.cell); return c >= fb.x && c <= fb.x + fb.width; });
      const cs = inside.map(l => centerX(l.cell));
      return {
        frag: f,
        lanes: inside,
        leftPad: cs.length ? fb.x - Math.min(...cs) : 0,           // ≤ 0 (frame extends left of first lifeline)
        rightPad: cs.length ? (fb.x + fb.width) - Math.max(...cs) : 0, // ≥ 0
      };
    });

  if (ordered.length >= 3) {
    const firstC = centerX(ordered[0].cell);
    const lastC = centerX(ordered[ordered.length - 1].cell);
    const step = (lastC - firstC) / (ordered.length - 1);
    ordered.forEach((l, i) => {
      const dx = (firstC + i * step) - centerX(l.cell);
      if (Math.abs(dx) > 0.5) { const p = l.cell.position(); l.cell.position(p.x + dx, p.y); }
    });
  }

  // Re-wrap fragments around their (now-moved) spanned lanes, preserving original
  // padding + y/height. No-op when the spanned lanes didn't move.
  for (const { frag, lanes: spanned, leftPad, rightPad } of fragSpans) {
    if (!spanned.length) continue;
    const cs = spanned.map(l => centerX(l.cell));
    const left = Math.min(...cs) + leftPad;
    const newW = Math.max(60, (Math.max(...cs) + rightPad) - left);
    const fp = frag.position(), fs = frag.size();
    if (Math.abs(fp.x - left) > 0.5 || Math.abs(fs.width - newW) > 0.5) {
      frag.position(left, fp.y);
      frag.resize(newW, fs.height);
    }
  }

  // ── Activation re-centre (v1.15.1) ──────────────────────────────────
  // Pin every embedded SequenceActivation to its lane's lifeline X — fixes authoring
  // drift (e.g. a bar dropped a few px off-centre) and pulls activations along when
  // their lane shifted in X above. X-only, so the message-timing Y the dy compensation
  // preserved stays untouched.
  for (const l of lanes) {
    const lifeX = centerX(l.cell);
    for (const c of graph.getElements()) {
      if (c.get('parent') !== l.id || c.get('type') !== 'sf.SequenceActivation') continue;
      const cs = c.size(), cp = c.position();
      const targetX = lifeX - cs.width / 2;
      if (Math.abs(cp.x - targetX) > 0.5) c.position(targetX, cp.y);
    }
  }
}

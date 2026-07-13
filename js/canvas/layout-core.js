// Layered graph layout CORE (Stage C, slice C2) — extracted VERBATIM from auto-layout.js.
//
// PURE: no JointJS, no DOM, no cctx. Given a set of layout UNITS (already-resolved top-level
// boxes: `{id, w, h}`) and the EDGES between them (`{source, target}` in unit-id space), it
// returns a `Map<id, {x, y}>` of local coordinates. The caller owns everything graph-shaped:
// resolving cells to units, deciding the flow axis, translating the result onto the canvas.
//
// This is the engine behind both diagram-wide layout AND (from C5) each scoped group interior,
// which is exactly why it takes its units/edges as arguments instead of reading a graph.
//
// The algorithm, unchanged: longest-path ("Sugiyama") leveling with a cycle clamp → barycentric
// crossing reduction (6 sweeps, best-ordering snapshot) → adjacent-exchange refinement →
// coordinate assignment (`align:'barycenter'` packs the cross-axis toward neighbour barycentres
// with full-spine straightening; `'sequential'` centres each layer) → component stacking →
// pairwise overlap removal.
//
// Behaviour is pinned two ways: `dev/tests/layout-core.test.js` (pure unit tests) and the
// browser equivalence capture `dev/tests/e2e/stage-c-golden.spec.js` + `dev/scripts/diff-golden.mjs`,
// which proved this extraction byte-identical across 40 graph × direction × align combinations.
//
// GOTCHAS inherited from the original (do NOT "fix" without measuring — see
// Documentation/Diagramforce-AutoLayout-StageC.md §3b prior art):
//  - Coordinates come out UNROUNDED and un-translated. The caller must translate the whole
//    layout by one global offset and round to INTEGER — never grid-snap per node (different-width
//    centre-aligned nodes snap to different centres and kink the connector; reverted in 1.19.0.29).
//  - Gaps are ALIGNMENT constants, not routing room. Widening them measurably WORSENS routing
//    ("more space = worse routing", proven twice: Connector Lanes lever 2, alongBump).
//  - Iteration order is the determinism contract: `units` order fixes adjacency, component and
//    layer order. Callers must pass a stable order (JointJS collection order is insertion order).

/** Default gaps mirror the original: the along-axis gap must exceed 2× router STUB (20) + PAD (16) = 56. */
export const DEFAULT_GAPS = {
  horizontal: { gapX: 80, gapY: 64 },
  vertical: { gapX: 64, gapY: 80 },
  compGap: 64,   // between disconnected components
  minSep: 56,    // pairwise overlap-removal separation
};

/**
 * Detect the FLOW AXIS a diagram was drawn on, from the spread of its boxes' centroids (Stage C M2).
 *
 * The promoted "Auto Layout" button hard-codes vertical, so a diagram a human drew left→right gets
 * rotated into an unreadable column. This reads the intent back out of the existing geometry: if the
 * boxes spread wider along x than y, it was a horizontal flow.
 *
 * PURE + deterministic. Pass the boxes whose arrangement carries the intent — the top-level GROUP
 * boxes (zones/containers) when there are ≥2, otherwise all top-level boxes.
 *
 * @param {Array<{x:number,y:number,w:number,h:number}>} boxes
 * @param {number} [ratio=1.2] one axis must exceed the other by this factor to be "confident".
 * @returns {{isHorizontal: boolean, confident: boolean}} confident=false ⇒ the spreads are too close
 *          to call (e.g. a freshly-dropped column, or a square arrangement); the caller should keep
 *          its own default rather than trust a coin-flip.
 */
export function detectFlowAxis(boxes, ratio = 1.2) {
  if (!boxes || boxes.length < 2) return { isHorizontal: false, confident: false };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const b of boxes) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    x0 = Math.min(x0, cx); x1 = Math.max(x1, cx);
    y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
  }
  const xSpread = x1 - x0, ySpread = y1 - y0;
  if (xSpread > ySpread * ratio) return { isHorizontal: true, confident: true };
  if (ySpread > xSpread * ratio) return { isHorizontal: false, confident: true };
  return { isHorizontal: false, confident: false };   // too square to call
}

/**
 * Lay out a set of units and the edges between them.
 *
 * @param {Array<{id: string, w: number, h: number}>} units  Stable order — defines determinism.
 * @param {Array<{source: string, target: string}>} edges    Unit-id space. Self-edges and edges
 *        touching an unknown id are ignored (the caller's `toLayoutId` resolution may drop them).
 * @param {{isHorizontal?: boolean, align?: 'barycenter'|'sequential', breakCycles?: boolean,
 *          maxRankExtent?: number, rankMedianFactor?: number,
 *          gapX?: number, gapY?: number, compGap?: number, minSep?: number}} [opts]
 * @returns {Map<string, {x: number, y: number}>} local, unrounded, un-translated positions.
 */
export function layoutGraphSubset(units, edges = [], opts = {}) {
  const isHorizontal = !!opts.isHorizontal;
  // Mirrors autoLayout: anything that isn't exactly 'barycenter' is the legacy sequential path.
  const align = opts.align === 'barycenter' ? 'barycenter' : 'sequential';
  // M6 (C3): ignore back-edges when ranking. Opt-in so the C2 characterization stays pinnable.
  const breakCycles = !!opts.breakCycles;
  // M7 (C3): wrap an over-wide rank into sub-rows. 0/undefined disables it (the C2 baseline).
  // Cap = max(maxRankExtent, rankMedianFactor × median rank extent) — see the wrap block below.
  const maxRankExtent = opts.maxRankExtent ?? 0;
  const rankMedianFactor = opts.rankMedianFactor ?? 3;
  const dflt = isHorizontal ? DEFAULT_GAPS.horizontal : DEFAULT_GAPS.vertical;
  const GAP_X = opts.gapX ?? dflt.gapX;
  const GAP_Y = opts.gapY ?? dflt.gapY;

  const pos = new Map();
  if (!units.length) return pos;

  const sizes = new Map();
  units.forEach((u) => { sizes.set(u.id, { w: u.w, h: u.h }); });

  // Build directed + undirected adjacency (undirected → connected components; directed → layering).
  const adj = new Map();       // undirected — for connected components
  const adjOut = new Map();    // directed — source→target for layering
  const adjIn = new Map();     // directed — target←source for layering
  units.forEach((u) => {
    adj.set(u.id, new Set());
    adjOut.set(u.id, new Set());
    adjIn.set(u.id, new Set());
  });

  // Accept the edges once (same guards as before), keeping the caller's order — the determinism contract.
  const kept = [];
  for (const e of edges) {
    const sId = e.source, tId = e.target;
    if (!sId || !tId || sId === tId || !adj.has(sId) || !adj.has(tId)) continue;
    kept.push([sId, tId]);
    // The UNDIRECTED graph always keeps every edge: connected components must not split just
    // because an edge happens to close a cycle.
    adj.get(sId).add(tId);
    adj.get(tId).add(sId);
  }

  // ── M6 — cycle breaking (C3) ────────────────────────────────────────────────────────────────
  // Longest-path leveling only makes sense on a DAG. With a back-edge present the old code merely
  // CLAMPED runaway levels (a hang guard), so a feedback edge poisoned the ranks: on the mixed-hub
  // fixture two back-edges collapsed 13 units into rank sizes 12,1 — the measured 3729px single-rank
  // smear (F5) — and on horizontal-lanes they inverted the lane order (F4: 1,3,2,4).
  // Classify edges with the ITERATIVE DFS gray/black colouring already proven in this repo
  // (js/mermaid-import.js hierarchicalLayout — kept for Mermaid import when that path was unwired
  // from the toolbar for spine/embedding/undo reasons that never impugned its cycle handling).
  // Back-edges are dropped from the DIRECTED adjacency only, so they are ignored by leveling,
  // crossing reduction, barycentre packing and spine straightening alike — but they are still real
  // links and sfManhattan still routes them. Iterative, not recursive: a long chain would blow the
  // JS stack. Deterministic: `units` order seeds the DFS, and edge insertion order fixes each
  // node's out-list order.
  const backEdges = new Set();   // "src|tgt"
  if (breakCycles) {
    const fullOut = new Map();
    units.forEach((u) => fullOut.set(u.id, []));
    const seenEdge = new Set();
    for (const [s, t] of kept) {
      const key = `${s}|${t}`;
      if (seenEdge.has(key)) continue;   // parallel edges collapse, matching the Set-based adjacency
      seenEdge.add(key);
      fullOut.get(s).push(t);
    }
    // DFS START ORDER IS NOT COSMETIC — it decides WHICH edge of a cycle is called the back-edge.
    // Seed from in-degree-zero SOURCES first so the walk follows the natural flow. Starting mid-graph
    // makes the DFS climb a forward edge and brand it a back-edge: on horizontal-lanes the cell order
    // put lane 3 first, so `lane2 -> lane3` (a FORWARD edge) was dropped instead of the `lane3 -> lane2`
    // feedback edge — which broke the lane-1 -> lane-2 connector (skew 0 -> 314px) while "fixing" cycles.
    // Sources first, then everything else, both in `units` order → still fully deterministic.
    const indeg = new Map();
    units.forEach((u) => indeg.set(u.id, 0));
    for (const t of seenEdge) indeg.set(t.split('|')[1], indeg.get(t.split('|')[1]) + 1);
    const startOrder = [
      ...units.filter((u) => indeg.get(u.id) === 0),
      ...units.filter((u) => indeg.get(u.id) !== 0),
    ];

    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map();
    units.forEach((u) => color.set(u.id, WHITE));
    for (const u of startOrder) {
      if (color.get(u.id) !== WHITE) continue;
      color.set(u.id, GRAY);
      const stack = [{ id: u.id, i: 0 }];
      while (stack.length) {
        const top = stack[stack.length - 1];
        const outs = fullOut.get(top.id);
        if (top.i < outs.length) {
          const v = outs[top.i++];
          const c = color.get(v);
          if (c === WHITE) { color.set(v, GRAY); stack.push({ id: v, i: 0 }); }
          else if (c === GRAY) backEdges.add(`${top.id}|${v}`);   // points at an ancestor → a cycle
        } else {
          color.set(top.id, BLACK);
          stack.pop();
        }
      }
    }
  }

  // Directed adjacency drives leveling + ordering + coordinates. With M6 on it is the induced DAG.
  for (const [sId, tId] of kept) {
    if (backEdges.has(`${sId}|${tId}`)) continue;
    adjOut.get(sId).add(tId);
    adjIn.get(tId).add(sId);
  }

  // Find connected components (units order → component order: the determinism contract).
  const visited = new Set();
  const components = [];
  for (const u of units) {
    if (visited.has(u.id)) continue;
    const comp = [];
    const stack = [u.id];
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

    // ── M7 — rank-width cap (C3) ──────────────────────────────────────────────────────────────
    // A weakly-connected diagram dumps most of its nodes into one rank: the mixed-hub fixture put 8
    // of 13 units on a single row, a 1912px band that rendered as a 3729px smear at aspect 6.3 (F5).
    // Wrap an over-wide rank into sub-rows, preserving the crossing-minimised ORDER (so a wrap never
    // undoes the barycentric work), and splice them in as consecutive ranks.
    //
    // Safe because longest-path leveling puts every DAG edge strictly BETWEEN layers — a layer has no
    // internal edges — so sub-rows introduce no edge that runs backwards or sideways. (M6 guarantees
    // the DAG; with cycles left in, a back-edge could sit inside a layer and this would be unsound,
    // which is why the wrap is gated on the same opt-in as everything else in C3.)
    //
    // The cap deliberately scales with the diagram (`3 × median rank extent`) and never drops below
    // an absolute floor: a diagram whose ranks are ALL wide is wide on purpose, and shredding it into
    // sub-rows would lengthen every connector. Gaps are alignment constants, never routing room
    // ("more space = worse routing"), so wrapping trades width for depth without touching them.
    if (maxRankExtent > 0 && sortedLevels.length) {
      const crossOf = (id) => (isHorizontal ? sizes.get(id).h : sizes.get(id).w);
      const crossGapW = isHorizontal ? GAP_Y : GAP_X;
      const extentOf = (row) => row.reduce((s, id) => s + crossOf(id), 0) + Math.max(0, row.length - 1) * crossGapW;

      const extents = sortedLevels.map((l) => extentOf(layers.get(l))).sort((a, b) => a - b);
      const mid = extents.length >> 1;
      const median = extents.length % 2 ? extents[mid] : (extents[mid - 1] + extents[mid]) / 2;
      const cap = Math.max(maxRankExtent, rankMedianFactor * median);

      const rebuilt = [];
      for (const l of sortedLevels) {
        const layer = layers.get(l);
        if (layer.length < 2 || extentOf(layer) <= cap) { rebuilt.push(layer); continue; }
        // Greedy fill in the optimised order: start a new sub-row only when the next node would
        // overflow the cap. A single node wider than the cap still gets its own row (never dropped).
        let row = [];
        for (const id of layer) {
          if (row.length && extentOf([...row, id]) > cap) { rebuilt.push(row); row = []; }
          row.push(id);
        }
        if (row.length) rebuilt.push(row);
      }

      if (rebuilt.length !== sortedLevels.length) {
        layers.clear();
        sortedLevels.length = 0;
        rebuilt.forEach((row, i) => { layers.set(i, row); sortedLevels.push(i); });
        for (const l of sortedLevels) layers.get(l).forEach((id, i) => orderIndex.set(id, i));
      }
    }

    // --- Position layers using the optimized ordering ---
    if (align === 'barycenter') {
      // v2 "Layered": keep the optimised ranks + order, but pull each node's CROSS-axis toward the
      // barycentre of its linked neighbours (children sit under their parents), packed in order with a
      // min gap so the order + non-overlap survive. Along-axis (the rank) is fixed per layer.
      const crossSz = (id) => (isHorizontal ? sizes.get(id).h : sizes.get(id).w);
      const alongSz = (id) => (isHorizontal ? sizes.get(id).w : sizes.get(id).h);
      const crossGap = isHorizontal ? GAP_Y : GAP_X;
      const alongGap = isHorizontal ? GAP_X : GAP_Y;
      // Along-axis coord per layer = cumulative max extent of the previous layers.
      const alongAt = new Map();
      let aCur = 0;
      for (const l of sortedLevels) {
        alongAt.set(l, aCur);
        let mx = 0; for (const id of layers.get(l)) mx = Math.max(mx, alongSz(id));
        aCur += mx + alongGap;
      }
      // Seed cross positions sequentially by the optimised order.
      const cross = new Map();
      for (const l of sortedLevels) { let c = 0; for (const id of layers.get(l)) { cross.set(id, c); c += crossSz(id) + crossGap; } }
      const neigh = (id) => { const r = []; for (const n of (adjOut.get(id) || [])) if (cross.has(n)) r.push(n); for (const n of (adjIn.get(id) || [])) if (cross.has(n)) r.push(n); return r; };
      // Order-preserving pack toward the neighbour barycentre.
      const packLayer = (layer) => {
        let prevEnd = -Infinity;
        for (const id of layer) {
          const ns = neigh(id);
          let want = ns.length ? ns.reduce((s, n) => s + cross.get(n) + crossSz(n) / 2, 0) / ns.length - crossSz(id) / 2 : cross.get(id);
          if (prevEnd > -Infinity && want < prevEnd + crossGap) want = prevEnd + crossGap;
          cross.set(id, want);
          prevEnd = want + crossSz(id);
        }
      };
      for (let sweep = 0; sweep < 8; sweep++) {
        for (let i = 0; i < sortedLevels.length; i++) packLayer(layers.get(sortedLevels[i]));            // down
        for (let i = sortedLevels.length - 1; i >= 0; i--) packLayer(layers.get(sortedLevels[i]));        // up
      }
      // Descendant sets (node + everything reachable via adjOut within this component), built bottom-up so a
      // parent unions its children's sets. Longest-path leveling makes every adjOut edge go to a strictly
      // higher level, so children are finalised before their parents in this deepest-first pass.
      const descendants = new Map();
      for (const id of ids) descendants.set(id, new Set([id]));
      for (let li = sortedLevels.length - 1; li >= 0; li--) {
        for (const id of layers.get(sortedLevels[li])) {
          const set = descendants.get(id);
          for (const ch of (adjOut.get(id) || [])) if (descendants.has(ch)) for (const d of descendants.get(ch)) set.add(d);
        }
      }
      const shiftSubtree = (id, delta) => { if (!delta) return; for (const d of descendants.get(id)) cross.set(d, cross.get(d) + delta); };

      // Straighten single-child SPINES (internal nodes too, not just leaves): a node whose parent has exactly
      // ONE child should sit directly under/across that parent - a straight connector. Shift the node's WHOLE
      // subtree by the same delta so the branch stays attached. Top-down so each parent is final before its
      // child aligns; a MULTI-child parent is never moved, so its children keep the barycentre spread and the
      // spine keeps running straight AFTER a split (Start->Process->Decision->...->Terminator stays a line).
      for (const l of sortedLevels) {
        for (const id of layers.get(l)) {
          const parents = [...(adjIn.get(id) || [])].filter((p) => cross.has(p));
          if (parents.length === 1 && [...(adjOut.get(parents[0]) || [])].filter((k) => cross.has(k)).length === 1) {
            shiftSubtree(id, (cross.get(parents[0]) + crossSz(parents[0]) / 2 - crossSz(id) / 2) - cross.get(id));
          }
        }
      }
      // Re-clamp each layer in order to remove any overlaps the cascades introduced; shift a colliding node's
      // whole subtree (so a straightened spine stays straight). Shallow->deep so parents settle before kids.
      for (const l of sortedLevels) {
        let prevEnd = -Infinity;
        for (const id of layers.get(l)) {
          if (prevEnd > -Infinity && cross.get(id) < prevEnd + crossGap) shiftSubtree(id, (prevEnd + crossGap) - cross.get(id));
          prevEnd = cross.get(id) + crossSz(id);
        }
      }
      for (const l of sortedLevels) for (const id of layers.get(l)) {
        pos.set(id, isHorizontal ? { x: alongAt.get(l), y: cross.get(id) } : { x: cross.get(id), y: alongAt.get(l) });
      }
    } else if (isHorizontal) {
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
  const COMP_GAP = opts.compGap ?? DEFAULT_GAPS.compGap;
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
  const MIN_SEP = opts.minSep ?? DEFAULT_GAPS.minSep;
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
  return pos;
}

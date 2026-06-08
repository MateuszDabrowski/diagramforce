// Auto-layout domain — extracted from canvas.js (Phase 4, Slice 3).
// Force-directed layout (autoLayout) + sequence-diagram lane alignment
// (analyzeSequenceLayout / applySequenceAutoLayout). Reads the live graph,
// paper, and fitContent through the canvas context (cctx); canvas.js is the
// sole writer and wires cctx.fitContent in init().
import { cctx } from './context.js?v=1.15.6';


// ── Auto Layout (improved force-directed with tight packing) ─────────
// Groups (containers, zones, pools) are treated as single layout units —
// their embedded children move with them and maintain relative positions.
export function autoLayout(direction) {
  const { graph, paper, fitContent } = cctx;
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

  // Top-level elements to lay out (not embedded children, not bare zones without embeds)
  const layoutEls = elements.filter(el => {
    if (embeddedIds.has(el.id)) return false;
    return true;
  });
  if (layoutEls.length < 2) { fitAfterLayout(); return; }

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

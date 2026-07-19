// Flow tree layout (S3) — a PURE, DOM-free vertical tree layout for the 'flow' diagram type. computeFlowLayout
// takes a topology and returns top-left positions; applyFlowLayout (js/canvas/auto-layout.js) is the JointJS
// wrapper. Kept pure + zero-import so dev/tests/flow-layout.test.js can exercise the ranking/column logic
// directly (the measurement gate).
//
// WHY its own layout and NOT layout-core's barycentre: the barycentre coordinate pass mis-centres a merge/join
// node over the AVERAGE of neighbour centres under min-gap clamps, which drifts a straight trunk and off-centres
// a join when branches have unequal widths (the pinned F7 defect; four fixes measured worse). This is instead a
// deterministic Reingold-Tilford TIDY TREE over a DFS spanning tree: a single-child chain inherits its parent's
// column exactly (a dead-straight spine), and a parent sits at the midpoint of its children's span (a decision
// centres over its branches). A merge aligns with its FIRST branch — the spine continuation — while the other
// branch's connector merges in, which is exactly Flow Builder's look. It writes element positions ONLY (never
// link vertices — the locked stale-vertex ban); links re-route via sfManhattan after placement.
//
// Edge model:
//   - SHAPING edges (regular / outcome / defaultOutcome / loopNext / loopExit) build the spanning tree + ranks.
//   - FAULT edges are LATERALS: the error node is appended beside its source (one rank below, one column over),
//     never orphaned to the top and never bending the trunk.
//   - GO TO edges are EXCLUDED entirely (a cross-reference, not structure): a forward Go To would otherwise rank
//     its target below the reference source and tangle the layout; the dotted connector just routes freely.
//   - BACK-edges (a loop body's edge back up to its loop) are dropped by the DFS so ranking stays a DAG.

// Gaps leave room for the connector STUB ends. Each flow connector endpoint sits ~16px off the card boundary
// (`sfConnectionPoint`) with a 12px "None" stub bridging it, so a connector needs ~28px of clearance per end. Too
// tight a gap squeezes the stub + the orthogonal elbow into a cramped zig-zag (the reported artifact). 72/64 give
// the trunk, the branch forks, and a Go To's dotted jump room to route cleanly.
const ROW_GAP = 72;   // vertical gap between ranks
const COL_GAP = 64;   // horizontal gap between adjacent columns

/**
 * @param {{ nodes: {id:string,w:number,h:number}[], edges: {source:string,target:string,kind?:string}[] }} topology
 * @returns {Map<string,{x:number,y:number}>} top-left position per node id
 */
export function computeFlowLayout(topology) {
  const nodes = topology?.nodes || [];
  const edges = (topology?.edges || []).filter((e) => e && e.source !== e.target);
  const out = new Map();
  if (!nodes.length) return out;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const valid = (e) => byId.has(e.source) && byId.has(e.target);
  // Go To edges are cross-references, NOT structure — excluded from ranking + the tree entirely (a forward Go To
  // would otherwise rank its target below the reference source and tangle the layout; the dotted connector just
  // routes between wherever the two elements land). Fault edges are laterals; everything else shapes the tree.
  const shaping = edges.filter((e) => valid(e) && e.kind !== 'fault' && e.kind !== 'goto');
  const faults = edges.filter((e) => valid(e) && e.kind === 'fault');

  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of shaping) adj.get(e.source).push(e.target);
  const fwdIn = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of shaping) fwdIn.set(e.target, fwdIn.get(e.target) + 1);

  // DFS: build the spanning tree (first-visit children), dropping back-edges (target on the stack) so cycles
  // break, and produce a finish-order → topological order.
  const children = new Map(nodes.map((n) => [n.id, []]));
  const state = new Map();   // 1 = on-stack, 2 = done
  const topo = [];
  const dfs = (u) => {
    state.set(u, 1);
    for (const v of adj.get(u)) {
      if (state.get(v) === 1) continue;                 // back-edge → drop
      if (state.get(v) === undefined) { children.get(u).push(v); dfs(v); }   // tree edge
      // else v is done: a cross/forward edge — used for ranking, not for the tree shape
    }
    state.set(u, 2);
    topo.push(u);
  };
  const roots = nodes.filter((n) => fwdIn.get(n.id) === 0).map((n) => n.id);
  for (const r of (roots.length ? roots : [nodes[0].id])) if (state.get(r) === undefined) dfs(r);
  for (const n of nodes) if (state.get(n.id) === undefined) dfs(n.id);   // strand from an all-cycle component
  topo.reverse();
  const topoIdx = new Map(topo.map((id, i) => [id, i]));

  // Rank = longest path over every FORWARD shaping edge (topoIdx increases), so a merge sinks below ALL parents.
  const rank = new Map(nodes.map((n) => [n.id, 0]));
  for (const u of topo) for (const v of adj.get(u)) {
    if (topoIdx.get(u) < topoIdx.get(v)) rank.set(v, Math.max(rank.get(v), rank.get(u) + 1));
  }

  // Tidy-tree columns over the spanning forest: leaves take the next free column, a parent centres on its
  // children's span. Single child → parent shares the child's column (straight spine). No overlaps: every leaf
  // gets its own column.
  const col = new Map();
  let cursor = 0;
  const place = (u) => {
    const kids = children.get(u);
    if (!kids.length) { col.set(u, cursor++); return; }
    // Order siblings left-to-right by their CURRENT centre-x (when provided), so auto-layout keeps a decision's
    // branches in the arrangement the user drew instead of re-ordering by link-creation order. Falls back to the
    // DFS order when no `cx` is available (e.g. the pure unit fixtures). Stable for equal / missing values.
    const kx = (id) => byId.get(id)?.cx;
    const ordered = kids.every((k) => kx(k) == null) ? kids
      : kids.map((id, i) => [id, i]).sort((a, b) => ((kx(a[0]) ?? 0) - (kx(b[0]) ?? 0)) || (a[1] - b[1])).map((e) => e[0]);
    for (const k of ordered) place(k);
    col.set(u, (col.get(ordered[0]) + col.get(ordered[ordered.length - 1])) / 2);
  };
  const isChild = new Set([...children.values()].flat());
  // A fault-only target has no shaping parent, so it would otherwise be placed as a forest root at the TOP.
  // Exclude it here; the fault loop below appends it beside its source instead.
  const faultTargets = new Set(faults.map((e) => e.target));
  for (const id of topo) if (!isChild.has(id) && !col.has(id) && !faultTargets.has(id)) place(id);

  // Fault laterals: append each error node (and any short handler chain below it) beside its source — one rank
  // down, one column over — so it reads as a side path and never bends the trunk. Iterate so a handler reached
  // only after its source is placed still lands.
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of faults) {
      if (col.has(e.target) || !col.has(e.source)) continue;
      rank.set(e.target, rank.get(e.source) + 1);
      col.set(e.target, col.get(e.source) + 1);
      grew = true;
      // Walk the error node's own forward shaping subtree straight down.
      const stack = [e.target];
      while (stack.length) {
        const u = stack.pop();
        for (const v of adj.get(u)) {
          if (col.has(v)) continue;
          col.set(v, col.get(u));
          rank.set(v, Math.max(rank.get(v), rank.get(u) + 1));
          stack.push(v);
        }
      }
    }
  }
  for (const n of nodes) if (!col.has(n.id)) col.set(n.id, cursor++);   // fully-disconnected safety net

  // Final safety: resolve any residual same-rank overlap (chiefly fault appendages) to a minimum 1-column gap,
  // pushing right. The tidy tree already spaces the trunk + branches, so this only nudges laterals.
  const ranks = [];
  for (const n of nodes) (ranks[rank.get(n.id)] ||= []).push(n.id);
  for (const row of ranks) {
    if (!row) continue;
    row.sort((a, b) => col.get(a) - col.get(b) || topoIdx.get(a) - topoIdx.get(b));
    let prev = -Infinity;
    for (const id of row) { const x = Math.max(col.get(id), prev + 1); col.set(id, x); prev = x; }
  }
  let minCol = Infinity;
  for (const c of col.values()) if (c < minCol) minCol = c;

  // Pixels. Uniform column pitch (flow cards share a width) keeps aligned centres aligned; a fractional column
  // (a centred parent) lands mid-way between its children. y stacks ranks by the rank's tallest card + ROW_GAP.
  const colPitch = Math.max(...nodes.map((n) => n.w)) + COL_GAP;
  const rowY = [];
  let y = 0;
  for (let r = 0; r < ranks.length; r++) {
    const h = ranks[r] ? Math.max(...ranks[r].map((id) => byId.get(id).h)) : 0;
    rowY[r] = y;
    y += h + ROW_GAP;
  }
  for (const n of nodes) {
    const r = rank.get(n.id);
    const rowH = ranks[r] ? Math.max(...ranks[r].map((id) => byId.get(id).h)) : n.h;
    out.set(n.id, {
      x: Math.round((col.get(n.id) - minCol) * colPitch),
      y: Math.round(rowY[r] + (rowH - n.h) / 2),
    });
  }
  return out;
}

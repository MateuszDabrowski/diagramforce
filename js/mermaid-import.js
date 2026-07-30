// Mermaid Import — convert mermaid.js source into a diagramforce diagram.
//
// Supported diagram types (v1 — beta):
//   graph                        → Process  (BPMN shapes)
//   flowchart / flowchart-elk   → Process  (BPMN shapes)
//   stateDiagram / stateDiagram-v2 → Process (BPMN shapes)
//   erDiagram                    → Data Model (DataObject)
//   sequenceDiagram              → Sequence (participants, lifelines, messages)
//
// The parser is a hand-written, line-oriented, best-effort tokenizer — it
// does NOT use the real mermaid grammar and will not handle every edge case.
// It aims to cover the most common mermaid snippets produced by LLMs and docs.

import { createElementFromComponent } from './components.js?v=1.21.7';
import { ER_MARKER_D } from './er-markers.js?v=1.21.7';
import { showError, showToast } from './feedback.js?v=1.21.7';
// Gantt geometry is DERIVED from dates - the importer emits data and these place every pixel, the same
// functions the load migration uses. Nothing here computes a bar's x or width.
import { applyGanttGeometry, applyGanttMilestoneGeometry, backfillGanttOrders, layoutTimelineTasks, orderToY }
  from './gantt-layout.js?v=1.21.7';

let modules = {};

export function init(_modules) {
  modules = _modules;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Light validation — checks whether the text *looks* like mermaid.
 * Returns { ok: true, type } or { ok: false, error }.
 */
export function validateMermaid(text) {
  if (!text || !text.trim()) return { ok: false, error: 'Empty input.' };
  const { body } = parseFrontmatter(text);
  const type = detectDiagramType(body);
  if (!type) {
    return { ok: false, error: 'Could not detect a supported diagram type. Expected one of: graph, flowchart, stateDiagram, erDiagram, sequenceDiagram.' };
  }
  return { ok: true, type };
}

/**
 * Strip `---\n<yaml>\n---` frontmatter block. Returns the fm title (if any)
 * plus the remaining body.
 */
function parseFrontmatter(text) {
  const m = /^\s*---\s*\n([\s\S]*?)\n---\s*\n?/.exec(text);
  if (!m) return { title: null, body: text };
  const titleMatch = /^\s*title\s*:\s*(.+?)\s*$/m.exec(m[1]);
  let title = titleMatch ? titleMatch[1].trim() : null;
  if (title && ((title.startsWith('"') && title.endsWith('"')) || (title.startsWith("'") && title.endsWith("'")))) {
    title = title.slice(1, -1);
  }
  return { title, body: text.slice(m[0].length) };
}

/**
 * Parse + import mermaid text into a new tab.
 * Returns true on success, false on failure (with error toast shown).
 */
export function importMermaidText(text, opts = {}) {
  if (!text || !text.trim()) { showError('Mermaid import failed: empty input.'); return false; }
  const { title: fmTitle, body } = parseFrontmatter(text);
  const type = detectDiagramType(body);
  if (!type) { showError('Mermaid import failed: unsupported diagram type.'); return false; }

  let parsed;
  try {
    parsed = parseMermaid(body, type, opts.target);
  } catch (err) {
    console.error('Mermaid parse error:', err);
    showError('Mermaid import failed: ' + err.message);
    return false;
  }
  // A Gantt is a SCHEDULE, not a node-and-edge graph: it carries `tasks`, never `elements`, and its geometry
  // comes from dates rather than from a layout. Branch before the node guard below, which would otherwise
  // reject every gantt as empty.
  if (parsed?.diagramType === 'gantt') return buildGantt(parsed, modules);

  if (!parsed || !parsed.elements || parsed.elements.length === 0) {
    showError('Mermaid import failed: no nodes found.');
    return false;
  }

  // Frontmatter title takes precedence; fall back to inline title, then default.
  const baseName = fmTitle || parsed.title || defaultTabName(parsed.diagramType);
  const tabName = dedupeTabName(baseName);
  modules.tabs.newTab(tabName, parsed.diagramType);

  const isSequence = !!parsed.isSequence;

  // mermaid-id -> cell, hoisted out of the build block so the layout + Zone steps below can resolve each
  // subgraph's members (the parser records membership by MERMAID id, not by JointJS cell id).
  const byIdForGroups = new Map();

  // Build elements into the live graph of the freshly activated tab.
  modules.canvas.setLoadingJSON(true);
  try {
    const graph = modules.graph;
    graph.clear();

    // Create elements first (they reference each other by mermaid-id)
    const byId = byIdForGroups;
    let x = 0, y = 0;
    for (const el of parsed.elements) {
      // Sequence-parsed elements already carry absolute positions — honour them.
      const pos = el.position ? { x: el.position.x, y: el.position.y } : { x, y };
      const cell = createElementFromComponent(el.component, pos);
      if (!cell) continue;
      if (el.size) cell.resize(el.size.width, el.size.height);
      // Sequence actors default to showLifeline=false (standalone UML actor).
      // In an imported sequence diagram the actor is an active participant in
      // the message flow — force its lifeline on so the dashed line is
      // visible down the full imported height.
      if (cell.get('type') === 'sf.SequenceActor' && !cell.get('showLifeline')) {
        joint.shapes.sf.setActorLifelineVisible?.(cell, true);
        // setActor… resets size to DEFAULT; restore the imported height.
        if (el.size) cell.resize(el.size.width, el.size.height);
      }
      graph.addCell(cell);
      byId.set(el.id, cell);
      if (!el.position) {
        x += 220; // arbitrary stagger — autoLayout will fix
        if (x > 1200) { x = 0; y += 160; }
      }
    }

    // Links
    for (const lk of (parsed.links || [])) {
      const src = byId.get(lk.source);
      const tgt = byId.get(lk.target);
      if (!src || !tgt) continue;
      const link = isSequence
        ? buildSequenceLink(lk, src, tgt)
        : buildLink(lk, src, tgt);
      if (link) graph.addCell(link);
    }

    // Migration hooks — keeps marker attrs consistent
    if (modules.canvas.migrateLinks) modules.canvas.migrateLinks();
    if (modules.canvas.migrateNodes) modules.canvas.migrateNodes();
  } finally {
    modules.canvas.setLoadingJSON(false);
  }

  // Sequence diagrams are positioned precisely during parsing, so skip the
  // hierarchical layout + port-snapping that would otherwise disturb the
  // carefully-aligned lifelines / messages.
  if (isSequence) {
    requestAnimationFrame(() => {
      try { modules.canvas.fitContent(); } catch {}
    });
    showToast(`Imported ${parsed.elements.length} ${parsed.elements.length === 1 ? 'shape' : 'shapes'} from Mermaid`, 'success');
    return true;
  }

  // Auto-layout. `groupOf` bands the cross axis by subgraph so each group's Zone is a clean stripe; without it
  // a group whose members sit at different ranks would need a box spanning the whole diagram, and six such boxes
  // overlap (measured on the reported sample: 6 overlapping pairs out of 15).
  const direction = parsed.direction || 'horizontal';
  const groupOf = new Map();
  for (const g of (parsed.groups || [])) {
    for (const mid of g.memberIds) { const c = byIdForGroups.get(mid); if (c) groupOf.set(c.id, g.key); }
  }
  try {
    hierarchicalLayout(modules.graph, parsed, direction, groupOf.size ? groupOf : null);
  } catch (err) {
    console.warn('hierarchicalLayout failed, falling back to canvas.autoLayout:', err);
    try { modules.canvas.autoLayout(direction); } catch {}
  }
  // Zones LAST: one in the graph while hierarchicalLayout runs would be ranked as a node.
  if (parsed.groups?.length) {
    try {
      createSubgraphZones(modules.graph, parsed.groups, byIdForGroups, createElementFromComponent);
    } catch (err) { console.warn('subgraph zones failed:', err); }
  }
  // After layout, snap link endpoints to the nearest side ports so the
  // router draws clean orthogonal connections into the element borders
  // rather than passing through their centers.
  snapLinksToPorts(modules.graph, direction);
  requestAnimationFrame(() => {
    try { modules.canvas.fitContent(); } catch {}
  });
  showToast(`Imported ${parsed.elements.length} ${parsed.elements.length === 1 ? 'shape' : 'shapes'} from Mermaid`, 'success');
  return true;
}

/**
 * For every link in the graph, pick the best source/target port based on the
 * relative positions of the two endpoint elements after auto-layout.
 * Uses the `port-top`/`port-right`/`port-bottom`/`port-left` ports that every
 * sf.* shape exposes.
 */
export function snapLinksToPorts(graph, direction) {
  const links = graph.getLinks();
  for (const link of links) {
    const src = link.getSourceElement?.();
    const tgt = link.getTargetElement?.();
    if (!src || !tgt) continue;
    if (src === tgt) continue;   // leave self-loops + their routing untouched
    // Stage B: auto-layout RE-ARRANGED the nodes, so any manual vertices from the OLD positions are now stale -
    // they route the link down-and-around through empty space (the reported architecture tangle). Clear them so
    // the link re-routes fresh on the new layout. Captured by recordPositionsBatch, so it undoes with the layout.
    if ((link.get('vertices') || []).length) link.set('vertices', []);
    // Stage C M8: for the same reason the label's stored position.distance/offset (hand-placed on the OLD
    // route) is now meaningless - it commonly lands ON a node after re-layout. Re-centre every label on the
    // fresh connector (distance 0.5, offset 0). Also captured by recordPositionsBatch → one undo step.
    const labels = link.labels?.() || [];
    if (labels.length) {
      link.labels(labels.map((l) => ({ ...l, position: { distance: 0.5, offset: 0 } })));
    }
    const { srcPort, tgtPort, srcIsFieldPort, tgtIsFieldPort } = pickFacingPorts(link, src, tgt, direction);
    if (!srcIsFieldPort && src.getPort?.(srcPort)) link.source({ id: src.id, port: srcPort });
    if (!tgtIsFieldPort && tgt.getPort?.(tgtPort)) link.target({ id: tgt.id, port: tgtPort });
  }
}

/**
 * The port-facing heuristic, factored out so both post-layout snapping
 * (snapLinksToPorts) and the standalone Re-face Connectors action share ONE
 * source of truth. Given a link and its two endpoint elements, returns which
 * side port each end should attach to so the connector exits toward the other
 * box: left<->right when the boxes sit side by side, top<->bottom when stacked.
 * `direction` biases the choice to the layout's flow axis ('vertical' /
 * 'horizontal'); pass null/undefined for pure geometry (longer-axis wins).
 * Also reports whether either end sits on a DataObject field port, which the
 * caller must leave alone (ER cardinality lives on those).
 */
export function pickFacingPorts(link, src, tgt, direction) {
  const sb = src.getBBox();
  const tb = tgt.getBBox();
  const dx = (tb.x + tb.width / 2) - (sb.x + sb.width / 2);
  const dy = (tb.y + tb.height / 2) - (sb.y + sb.height / 2);
  const srcIsDO = src.get('type') === 'sf.DataObject';
  const tgtIsDO = tgt.get('type') === 'sf.DataObject';
  // DataObjects carry explicit field-level ports (`field-left-*` /
  // `field-right-*`) attached to PK/FK rows. Those connections are
  // semantically meaningful — losing them would collapse an ER diagram
  // back to object-level arrows. Preserve any field port the user has
  // already wired up; only snap ends still at the generic object-level ports.
  const srcPortId = link.get('source')?.port || '';
  const tgtPortId = link.get('target')?.port || '';
  const srcIsFieldPort = typeof srcPortId === 'string' && srcPortId.startsWith('field-');
  const tgtIsFieldPort = typeof tgtPortId === 'string' && tgtPortId.startsWith('field-');
  let srcPort, tgtPort;
  // DataObject only has top/bottom static ports at the object level —
  // never pick left/right.
  if (srcIsDO || tgtIsDO) {
    if (dy >= 0) { srcPort = 'port-bottom'; tgtPort = 'port-top'; }
    else         { srcPort = 'port-top';    tgtPort = 'port-bottom'; }
  } else {
    // Geometry-primary: attach to the side actually FACING the other box - the
    // larger delta wins (side by side → left/right; stacked → top/bottom). The
    // layout `direction` only breaks an exact tie toward the flow axis; it no
    // longer FORCES that axis. The old `direction === 'vertical' → |dy| > 1`
    // rule re-ported every clearly-sideways cross-zone edge to top/bottom, so a
    // horizontal-flow architecture came out of a vertical auto-layout with all
    // ports on the wrong side - the hooked "auto-layout tangle". Longer-axis
    // facing fixes that while staying identical for a clean single-axis flow
    // (a vertical stack still has |dy| ≫ |dx| → top/bottom).
    const ax = Math.abs(dx), ay = Math.abs(dy);
    let useVertical;
    if (ay > ax) useVertical = true;
    else if (ax > ay) useVertical = false;
    else useVertical = direction !== 'horizontal';   // exact tie → prefer the flow axis
    if (useVertical) {
      if (dy >= 0) { srcPort = 'port-bottom'; tgtPort = 'port-top'; }
      else         { srcPort = 'port-top';    tgtPort = 'port-bottom'; }
    } else {
      if (dx >= 0) { srcPort = 'port-right'; tgtPort = 'port-left'; }
      else         { srcPort = 'port-left';  tgtPort = 'port-right'; }
    }
  }
  return { srcPort, tgtPort, srcIsFieldPort, tgtIsFieldPort };
}

/**
 * Standalone "Re-face Connectors" tidy: re-attach every link to the side port
 * pointing at its other end (pure geometry — no layout direction). Unlike
 * snapLinksToPorts, this is NOT a post-auto-layout step, so it is deliberately
 * conservative:
 *   - links carrying MANUAL VERTICES are skipped entirely — a user-routed
 *     connector is sacred, and re-facing its ends would fight its waypoints;
 *   - vertices are never cleared and labels are never re-centred;
 *   - self-loops, danglers, and DataObject field ports are left untouched.
 * Returns the count of links whose ports actually changed. The caller wraps
 * the call in a history batch (one undo step) and reroutes afterwards.
 */
export function refaceConnectors(graph) {
  let changed = 0;
  for (const link of graph.getLinks()) {
    const src = link.getSourceElement?.();
    const tgt = link.getTargetElement?.();
    if (!src || !tgt || src === tgt) continue;          // danglers + self-loops
    if ((link.get('vertices') || []).length) continue;  // user route is sacred
    const { srcPort, tgtPort, srcIsFieldPort, tgtIsFieldPort } = pickFacingPorts(link, src, tgt, null);
    const curS = link.get('source')?.port;
    const curT = link.get('target')?.port;
    let touched = false;
    if (!srcIsFieldPort && srcPort !== curS && src.getPort?.(srcPort)) { link.source({ id: src.id, port: srcPort }); touched = true; }
    if (!tgtIsFieldPort && tgtPort !== curT && tgt.getPort?.(tgtPort)) { link.target({ id: tgt.id, port: tgtPort }); touched = true; }
    if (touched) changed++;
  }
  return changed;
}

/**
 * Deduplicate a tab name against existing tabs by appending " 2", " 3", etc.
 */
function dedupeTabName(baseName) {
  const existing = new Set((modules.tabs.getAllTabs() || []).map(t => t.name));
  if (!existing.has(baseName)) return baseName;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${baseName} ${n}`;
    if (!existing.has(candidate)) return candidate;
  }
  return baseName;
}

/**
 * Custom hierarchical layout that handles cycles cleanly.
 *
 * 1. DFS-classify edges into tree/forward/back edges (gray/black coloring).
 * 2. Longest-path layering on the DAG induced by non-back edges.
 * 3. Barycentric ordering within each layer to reduce crossings.
 * 4. Place nodes on a grid; back-edges are still routed by sfManhattan.
 */
/** `groupOf` (cell id -> subgraph key) bands the CROSS axis so every member of a subgraph shares a lane and the
 *  Zone drawn around it is a clean stripe. Nodes keep their LAYER - that is the flow reading and is not ours to
 *  move - so a group whose members sit at different ranks becomes a WIDE band, which is exactly what mermaid
 *  renders. Groups may overlap freely along the flow axis; what must never overlap is the cross axis. */
function hierarchicalLayout(graph, _parsed, direction, groupOf = null) {
  const elements = graph.getElements();
  if (elements.length === 0) return;
  const H_GAP = 80;   // space between layers
  const V_GAP = 60;   // space between siblings
  const cellW = 180, cellH = 90;

  const ids = elements.map(e => e.id);
  const idSet = new Set(ids);
  const adjOut = new Map(ids.map(id => [id, []]));
  const adjIn  = new Map(ids.map(id => [id, []]));
  for (const link of graph.getLinks()) {
    const s = link.get('source')?.id;
    const t = link.get('target')?.id;
    if (!s || !t || !idSet.has(s) || !idSet.has(t) || s === t) continue;
    adjOut.get(s).push(t);
    adjIn.get(t).push(s);
  }

  // DFS classification — detect back-edges so they are ignored during layering
  const color = new Map(); // id → 0 white, 1 gray, 2 black
  ids.forEach(id => color.set(id, 0));
  const backEdges = new Set(); // "src|tgt"
  const dfs = (u) => {
    const stack = [{ id: u, i: 0 }];
    color.set(u, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const outs = adjOut.get(top.id);
      if (top.i < outs.length) {
        const v = outs[top.i++];
        const c = color.get(v);
        if (c === 0) { color.set(v, 1); stack.push({ id: v, i: 0 }); }
        else if (c === 1) { backEdges.add(`${top.id}|${v}`); }
      } else {
        color.set(top.id, 2);
        stack.pop();
      }
    }
  };
  for (const id of ids) if (color.get(id) === 0) dfs(id);

  // Build DAG (non-back edges) for layering
  const dagOut = new Map(ids.map(id => [id, []]));
  const dagIn  = new Map(ids.map(id => [id, []]));
  for (const s of ids) {
    for (const t of adjOut.get(s)) {
      if (backEdges.has(`${s}|${t}`)) continue;
      dagOut.get(s).push(t);
      dagIn.get(t).push(s);
    }
  }

  // Longest-path layering (Kahn-style topo with level = max(parent)+1)
  const level = new Map();
  const indeg = new Map(ids.map(id => [id, dagIn.get(id).length]));
  const queue = [];
  for (const id of ids) if (indeg.get(id) === 0) { level.set(id, 0); queue.push(id); }
  while (queue.length) {
    const u = queue.shift();
    const lu = level.get(u);
    for (const v of dagOut.get(u)) {
      const lv = Math.max(level.get(v) ?? 0, lu + 1);
      level.set(v, lv);
      indeg.set(v, indeg.get(v) - 1);
      if (indeg.get(v) === 0) queue.push(v);
    }
  }
  // Any remaining nodes (shouldn't happen post-DAG) → level 0
  for (const id of ids) if (!level.has(id)) level.set(id, 0);

  // Group by layer
  const layers = [];
  for (const id of ids) {
    const l = level.get(id);
    if (!layers[l]) layers[l] = [];
    layers[l].push(id);
  }

  // Barycentric ordering: a few sweeps top-down then bottom-up
  const orderIndex = new Map();
  layers.forEach(layer => layer.forEach((id, i) => orderIndex.set(id, i)));
  const bary = (id, adjMap) => {
    const ns = adjMap.get(id).filter(n => idSet.has(n));
    if (ns.length === 0) return orderIndex.get(id);
    let sum = 0;
    for (const n of ns) sum += orderIndex.get(n) ?? 0;
    return sum / ns.length;
  };
  for (let sweep = 0; sweep < 4; sweep++) {
    // Top-down using parents (dagIn)
    for (let i = 1; i < layers.length; i++) {
      layers[i].sort((a, b) => bary(a, dagIn) - bary(b, dagIn));
      layers[i].forEach((id, idx) => orderIndex.set(id, idx));
    }
    // Bottom-up using children (dagOut)
    for (let i = layers.length - 2; i >= 0; i--) {
      layers[i].sort((a, b) => bary(a, dagOut) - bary(b, dagOut));
      layers[i].forEach((id, idx) => orderIndex.set(id, idx));
    }
  }

  // Position
  const vertical = direction === 'vertical';
  const maxWidth = Math.max(...layers.map(l => l.length));
  const byModelId = new Map(elements.map(e => [e.id, e]));

  // ── Banded placement when subgraphs are present ────────────────────────────
  // Each group owns a contiguous slice of the cross axis. Band ORDER follows the earliest layer any of its
  // members reaches, so the bands read in flow order rather than in declaration order.
  const bandOf = new Map();     // cell id -> band key ('' = ungrouped)
  for (const id of ids) bandOf.set(id, (groupOf && groupOf.get(id)) || '');
  const usingBands = groupOf && new Set(bandOf.values()).size > 1;

  if (usingBands) {
    const firstLayer = new Map();
    for (const id of ids) {
      const b = bandOf.get(id), l = level.get(id);
      if (!firstLayer.has(b) || l < firstLayer.get(b)) firstLayer.set(b, l);
    }
    const bands = [...firstLayer.keys()].sort((a, b) => (firstLayer.get(a) - firstLayer.get(b))
      || String(a).localeCompare(String(b)));
    // A band is as thick as the MOST members it ever has in a single layer.
    const thickness = new Map(bands.map((b) => [b, 1]));
    layers.forEach((layer) => {
      const perBand = new Map();
      layer.forEach((id) => perBand.set(bandOf.get(id), (perBand.get(bandOf.get(id)) || 0) + 1));
      for (const [b, n] of perBand) if (n > (thickness.get(b) || 1)) thickness.set(b, n);
    });
    const step = cellH + V_GAP;
    const bandTop = new Map();
    let acc = 0;
    // BAND_GAP leaves room between two Zones so their borders never touch or read as one box.
    const BAND_GAP = 70;
    for (const b of bands) { bandTop.set(b, acc); acc += thickness.get(b) * step + BAND_GAP; }

    layers.forEach((layer, layerIdx) => {
      const seen = new Map();
      layer.forEach((id) => {
        const cell = byModelId.get(id);
        if (!cell) return;
        const b = bandOf.get(id);
        const lane = seen.get(b) || 0;
        seen.set(b, lane + 1);
        const along = layerIdx * (cellW + H_GAP);
        const across = bandTop.get(b) + lane * step;
        if (vertical) cell.position(across, along); else cell.position(along, across);
      });
    });
    return;
  }

  layers.forEach((layer, layerIdx) => {
    const count = layer.length;
    layer.forEach((id, i) => {
      const cell = byModelId.get(id);
      if (!cell) return;
      const bb = cell.getBBox();
      const w = bb.width || cellW;
      const h = bb.height || cellH;
      // Center each layer around 0
      const laneSpan = maxWidth * (cellW + V_GAP);
      const laneStep = count > 0 ? laneSpan / (count + 1) : laneSpan / 2;
      const offset = laneStep * (i + 1) - laneSpan / 2;
      let x, y;
      if (vertical) {
        x = offset - w / 2;
        y = layerIdx * (cellH + H_GAP);
      } else {
        x = layerIdx * (cellW + H_GAP);
        y = offset - h / 2;
      }
      cell.position(x, y);
    });
  });
}

/** Draw an sf.Zone around each subgraph AFTER layout and embed its members. Layout-first is deliberate: a Zone
 *  in the graph while hierarchicalLayout runs would be ranked as a node. Zones sit at z 0 (behind everything),
 *  so an enclosing stripe never hides the cards it contains. */
function createSubgraphZones(graph, groups, byId, createElementFromComponent) {
  const PAD_X = 26, PAD_TOP = 38, PAD_BOTTOM = 22;
  for (const g of groups) {
    const members = g.memberIds.map((mid) => byId.get(mid)).filter(Boolean);
    if (!members.length) continue;
    const bs = members.map((m) => m.getBBox());
    const x1 = Math.min(...bs.map((b) => b.x)) - PAD_X;
    const y1 = Math.min(...bs.map((b) => b.y)) - PAD_TOP;
    const x2 = Math.max(...bs.map((b) => b.x + b.width)) + PAD_X;
    const y2 = Math.max(...bs.map((b) => b.y + b.height)) + PAD_BOTTOM;
    const zone = createElementFromComponent({ type: 'sf.Zone', label: g.title }, { x: x1, y: y1 });
    if (!zone) continue;
    zone.resize(x2 - x1, y2 - y1);
    graph.addCell(zone);
    // Embed AFTER adding both, so the parent's `embeds` array and each child's `parent` stay consistent.
    for (const m of members) zone.embed(m);
  }
}


/** Build a Gantt from the parsed schedule. Emits DATA - a timeline plus dated, ordered, grouped bars - and lets
 *  `applyGanttGeometry` compute every pixel, exactly as an LLM-authored Gantt JSON is handled on load. That is
 *  what makes this tractable: when gantt support was dropped in beta a bar carried a manual x/width, so an
 *  importer had to do axis maths it had no business doing. */
function buildGantt(parsed, modules) {
  const graph = modules.graph;
  const name = dedupeTabName(parsed.title || 'Imported Plan');
  modules.tabs.newTab(name, 'gantt');
  // Row index for a MILESTONE. Milestones are NOT part of ganttRowLayout, so their row is the caller's job, and
  // a source index is the wrong number to use: ganttRowLayout interleaves a header row per group, so a bar's
  // visual row is its index PLUS the groups above it. Using the raw index put the milestone on top of a bar.
  // They go after every bar instead - unambiguous, never collides, and reads as "events at the end of the plan".
  // Declared out here because the geometry pass that reads it runs after the try/finally below.
  const msRow = new Map();
  const barRows = (parsed.timeline.groups?.length || 0)
    + parsed.tasks.filter((t) => !(t.milestone || t.startDate === t.endDate)).length;
  modules.canvas.setLoadingJSON(true);
  let tl;
  try {
    graph.clear();
    tl = createElementFromComponent({
      type: 'sf.GanttTimeline', label: parsed.title || 'Timeline',
      viewMode: parsed.timeline.viewMode, numPeriods: parsed.timeline.numPeriods,
    }, { x: 0, y: 0 });
    if (!tl) throw new Error('could not create the timeline');
    tl.set('startDate', parsed.timeline.startDate);
    tl.set('groups', parsed.timeline.groups);
    graph.addCell(tl);

    const byId = new Map();
    parsed.tasks.forEach((t, i) => {
      // A zero-length task is a MILESTONE in mermaid whether or not it is tagged one - that is what `0d` means.
      const isMilestone = t.milestone || t.startDate === t.endDate;
      const cell = isMilestone
        ? new joint.shapes.sf.GanttMilestone({ milestoneDate: t.startDate, attrs: { label: { text: t.label } } })
        : new joint.shapes.sf.GanttTask({
          order: i, groupId: t.groupId, taskLabel: t.label,
          startDate: t.startDate, endDate: t.endDate,
          // `done` is complete, `active` is in flight - the only two mermaid states with a progress meaning.
          progress: t.tags.includes('done') ? 100 : t.tags.includes('active') ? 50 : 0,
          attrs: { label: { text: t.label } },
        });
      graph.addCell(cell);
      tl.embed(cell);
      if (isMilestone) msRow.set(cell.id, barRows + msRow.size);
      byId.set(t.id, cell);
    });

    // `after` is finish-to-start by definition, which is exactly what the Gantt dependency model stores.
    for (const lk of parsed.links) {
      const src = byId.get(lk.source), tgt = byId.get(lk.target);
      if (!src || !tgt || src.get('type') !== 'sf.GanttTask' || tgt.get('type') !== 'sf.GanttTask') continue;
      const link = new joint.shapes.standard.Link({
        source: { id: src.id, port: 'port-right' }, target: { id: tgt.id, port: 'port-left' },
      });
      link.prop('linkKind', 'ganttDep');
      link.prop('depType', lk.depType || 'FS');
      graph.addCell(link);
    }
  } finally {
    modules.canvas.setLoadingJSON(false);
  }

  // Geometry LAST, once every bar and group is in place - the same order the load migration uses.
  //
  // Measured, because the obvious reading of this block is wrong: the BARS do not need it. A GanttTask view
  // re-derives its own geometry on `change:startDate`/`endDate`, so setting dates at construction is enough -
  // removing either applyGanttGeometry or layoutTimelineTasks here changes nothing. What IS load-bearing is the
  // MILESTONE branch (a milestone is not part of ganttRowLayout, so nothing else gives it a row) and
  // backfillGanttOrders. The task calls stay because they are idempotent and keep this correct if that view
  // behaviour ever changes - but they are a belt, not the braces.
  try {
    if (backfillGanttOrders(tl)) layoutTimelineTasks(tl);
    for (const el of graph.getElements()) {
      if (el.get('type') === 'sf.GanttTask' && el.get('startDate')) applyGanttGeometry(el, tl);
      if (el.get('type') === 'sf.GanttMilestone') {
        // applyGanttMilestoneGeometry sets X from the date and KEEPS the existing Y - a milestone is not part of
        // ganttRowLayout, so its row is the caller's job. Without this every milestone sat at y=0, i.e. inside
        // the timeline HEADER, which reads as a stray diamond in the axis rather than an event on the plan.
        const row = msRow.get(el.id);
        if (row != null) el.position(el.position().x, orderToY(tl, row) - 4, { gantt: true });
        applyGanttMilestoneGeometry(el, tl);
      }
    }
    layoutTimelineTasks(tl);
  } catch (err) { console.warn('gantt geometry failed:', err); }

  requestAnimationFrame(() => { try { modules.canvas.fitContent(); } catch {} });
  const n = parsed.tasks.length;
  const w = parsed.warnings || [];
  if (w.length) showToast(`Imported ${n} task${n === 1 ? '' : 's'} — ${w[0]}`, 'warning', { duration: 9000 });
  else showToast(`Imported ${n} task${n === 1 ? '' : 's'} from Mermaid`, 'success');
  return true;
}

function defaultTabName(type) {
  const names = {
    process: 'Imported Process',
    architecture: 'Imported Architecture',
    datamodel: 'Imported Data Model',
    sequence: 'Imported Sequence',
  };
  return names[type] || 'Imported Diagram';
}

// ─── Detection ─────────────────────────────────────────────────────────────

export function detectDiagramType(text) {
  const lines = text.split('\n');
  for (let raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    // Skip directive blocks like %%{init: ...}%%
    if (/^flowchart(-elk)?\b/i.test(line)) return 'flowchart';
    if (/^graph\b/i.test(line))            return 'graph';
    if (/^stateDiagram(-v2)?\b/i.test(line)) return 'state';
    if (/^erDiagram\b/i.test(line))        return 'er';
    if (/^sequenceDiagram\b/i.test(line))  return 'sequence';
    // gantt was dropped in beta because a Gantt was POSITIONAL then - importing one meant computing bar geometry
    // against an axis. The 1.2x Gantt rework flipped that ("the schedule is authored as data; the app computes
    // every pixel"), so the importer now emits dates and lets applyGanttGeometry place them. Re-added 1.21.7.
    if (/^gantt\b/i.test(line))            return 'gantt';
    // First non-empty line with none of the above → unsupported
    return null;
  }
  return null;
}


// ─── Gantt ─────────────────────────────────────────────────────────────────
// Mermaid's gantt grammar, mapped onto the data-first Gantt model. NOTHING here computes a pixel: the builder
// emits a timeline + dated bars and `applyGanttGeometry` places them, which is the whole reason this is
// tractable now and was not when gantt support was dropped in beta.
//
//   gantt
//     title Project
//     dateFormat YYYY-MM-DD
//     section Discovery
//     Research      :a1, 2026-06-01, 10d
//     Interviews    :after a1, 5d
//     Sign-off      :milestone, m1, 2026-06-20, 0d
//
// Task grammar after the colon: `[tags,] [id,] [start,] <end|duration>` where a tag is done/active/crit/
// milestone, start is a date or `after <id>[ <id>...]`, and an omitted start means "when the previous task ends"
// (mermaid's rule). Resolution is therefore ITERATIVE - `after` can point forward - with a pass cap so a cycle
// or a dangling reference degrades to the chart start plus a warning instead of hanging.
const GANTT_TAGS = new Set(['done', 'active', 'crit', 'milestone', 'vert']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DURATION = /^(\d+(?:\.\d+)?)\s*(ms|[dwhms])$/i;

const gDate = (iso) => new Date(`${iso}T00:00:00`);
const gIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const gAdd = (iso, days) => { const d = gDate(iso); d.setDate(d.getDate() + days); return gIso(d); };
const gDiff = (a, b) => Math.round((gDate(b) - gDate(a)) / 86400000);

/** A duration token in DAYS. Diagramforce's axis is day-granular, so sub-day units collapse to one day. */
function durationDays(tok) {
  const m = String(tok).trim().match(DURATION);
  if (!m) return null;
  const n = parseFloat(m[1]), unit = m[2].toLowerCase();
  // NOT clamped to a minimum here: `0d` is how mermaid writes a MILESTONE, and clamping it to one day turned
  // every milestone into a one-day bar. The caller applies the floor, because only it knows whether a
  // zero-length task is legitimate.
  if (unit === 'd') return Math.round(n);
  if (unit === 'w') return Math.round(n * 7);
  return 0;   // h / m / s / ms — sub-day on a day-granular axis
}

export function parseGantt(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('%%'));
  let title = '';
  const warnings = [];
  const groups = [];            // { id, label, order }
  const tasks = [];             // { id, label, tags, startSpec, afterIds, durDays, endDate, groupId, order }
  let openGroup = null;
  const unsupported = new Set();

  for (const line of lines) {
    if (/^gantt\b/i.test(line)) continue;
    let m;
    if ((m = line.match(/^title\s+(.+)$/i))) { title = m[1].trim(); continue; }
    if ((m = line.match(/^section\s+(.+)$/i))) {
      const label = m[1].trim();
      openGroup = { id: `g${groups.length + 1}`, label, order: groups.length };
      groups.push(openGroup);
      continue;
    }
    if (/^(dateFormat|axisFormat|excludes|includes|tickInterval|todayMarker|weekday|inclusiveEndDates)\b/i.test(line)) {
      const kw = line.split(/\s+/)[0];
      // dateFormat is the one we genuinely act on, and only to confirm it is ISO - anything else is a parse risk
      // we do not take, because a mis-read date silently produces a plausible WRONG schedule.
      if (/^dateFormat$/i.test(kw)) {
        const fmt = line.replace(/^dateFormat\s+/i, '').trim();
        if (fmt && !/^YYYY-MM-DD$/i.test(fmt)) unsupported.add(`dateFormat ${fmt} (only YYYY-MM-DD is read)`);
      } else unsupported.add(kw);
      continue;
    }
    const ci = line.indexOf(':');
    if (ci < 0) continue;
    const label = line.slice(0, ci).trim();
    const parts = line.slice(ci + 1).split(',').map((x) => x.trim()).filter(Boolean);
    if (!label || !parts.length) continue;

    const tags = [];
    while (parts.length && GANTT_TAGS.has(parts[0].toLowerCase())) tags.push(parts.shift().toLowerCase());
    // An id is present only when the next token is neither a date, an `after` clause, nor a duration.
    let id = null;
    if (parts.length > 1 && !ISO_DATE.test(parts[0]) && !/^after\s/i.test(parts[0]) && !DURATION.test(parts[0])) {
      id = parts.shift();
    }
    let startSpec = 'prev', afterIds = [], startDate = null;
    if (parts.length && ISO_DATE.test(parts[0])) { startSpec = 'date'; startDate = parts.shift(); }
    else if (parts.length && /^after\s/i.test(parts[0])) {
      startSpec = 'after';
      afterIds = parts.shift().replace(/^after\s+/i, '').split(/\s+/).filter(Boolean);
    }
    let durDays = null, endDate = null;
    if (parts.length) {
      if (ISO_DATE.test(parts[0])) endDate = parts.shift();
      else { const d = durationDays(parts[0]); if (d !== null) { durDays = d; parts.shift(); } }
    }
    tasks.push({ id: id || `t${tasks.length + 1}`, label, tags, startSpec, afterIds, startDate, endDate,
      durDays, groupId: openGroup ? openGroup.id : null, order: tasks.length,
      milestone: tags.includes('milestone') });
  }

  // ── Resolve dates. Iterative: `after` may point at a task declared later. ──
  const byId = new Map(tasks.map((t) => [t.id, t]));
  // Tolerates undefined: `after ghost` resolves byId.get() to nothing, and dereferencing that CRASHED the
  // whole import rather than degrading to the anchored-with-a-warning path below.
  const endOf = (t) => (t && t.startDate && t.endDate) ? t.endDate : null;
  let passes = 0;
  for (; passes < tasks.length + 2; passes++) {
    let moved = false;
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      if (t.startDate && t.endDate) continue;
      if (!t.startDate) {
        if (t.startSpec === 'after') {
          const ends = t.afterIds.map((a) => endOf(byId.get(a))).filter(Boolean);
          if (ends.length === t.afterIds.length && ends.length) t.startDate = ends.sort().at(-1);
        } else if (t.startSpec === 'prev') {
          const prev = tasks[i - 1];
          if (!prev) t.startDate = null;             // first task with no date — anchored below
          else if (endOf(prev)) t.startDate = endOf(prev);
        }
      }
      if (t.startDate && !t.endDate) {
        const d = t.durDays == null ? (t.milestone ? 0 : 1) : t.durDays;
        t.endDate = gAdd(t.startDate, Math.max(d, t.milestone ? 0 : 1));
        moved = true;
      } else if (t.startDate) moved = true;
    }
    if (!moved) break;
  }

  const dated = tasks.filter((t) => t.startDate);
  const anchor = dated.length ? dated.map((t) => t.startDate).sort()[0] : gIso(new Date());
  const stranded = tasks.filter((t) => !t.startDate);
  if (stranded.length) {
    warnings.push(`${stranded.length} task(s) had no resolvable start (an unknown or circular \`after\`): `
      + `${stranded.map((t) => t.label).join(', ')} — anchored at ${anchor}.`);
    for (const t of stranded) {
      t.startDate = anchor;
      t.endDate = gAdd(anchor, t.milestone ? 0 : Math.max(t.durDays ?? 1, 1));
    }
  }
  if (unsupported.size) {
    warnings.push(`Not imported (no equivalent on a Diagramforce Gantt): ${[...unsupported].join(', ')}.`);
  }

  // ── Timeline window + view mode. Derived, never authored. ──
  const starts = tasks.map((t) => t.startDate).sort();
  const ends = tasks.map((t) => t.endDate).sort();
  const from = starts[0] || anchor;
  const to = ends.at(-1) || gAdd(from, 7);
  const span = Math.max(1, gDiff(from, to));
  const viewMode = span <= 31 ? 'day' : span <= 182 ? 'week' : 'month';
  const perPeriod = viewMode === 'day' ? 1 : viewMode === 'week' ? 7 : 30;
  const numPeriods = Math.max(4, Math.ceil(span / perPeriod) + 1);

  // Dependencies: `after` IS a finish-to-start link, which is exactly linkKind 'ganttDep' + depType 'FS'.
  const links = [];
  for (const t of tasks) {
    for (const a of t.afterIds) if (byId.has(a)) links.push({ source: a, target: t.id, depType: 'FS' });
  }

  return {
    diagramType: 'gantt', title, direction: 'horizontal',
    timeline: { startDate: from, viewMode, numPeriods, groups: groups.map((g) => ({ ...g, color: '#5B5FC7' })) },
    tasks, links, warnings,
    elements: [], // built by the gantt path, not the generic element loop
  };
}

// ─── Top-level dispatch ────────────────────────────────────────────────────

export function parseMermaid(text, kind, target) {
  // Strip %% comments and directive blocks
  const cleaned = stripComments(text);
  switch (kind) {
    // A flowchart legitimately maps to THREE app types - the shapes differ, the graph does not - so the caller
    // picks. Defaulting to 'process' keeps every existing paste byte-identical.
    case 'flowchart': return parseFlowchart(cleaned, target || 'process');
    case 'graph':     return parseFlowchart(cleaned, target || 'process');
    case 'state':     return parseStateDiagram(cleaned);
    case 'er':        return parseErDiagram(cleaned);
    case 'sequence':  return parseSequenceDiagram(cleaned);
    case 'gantt':     return parseGantt(cleaned);
  }
  return null;
}

function stripComments(text) {
  return text
    .replace(/%%\{[\s\S]*?\}%%/g, '')   // directive blocks
    .replace(/^\s*%%.*$/gm, '');         // single-line comments
}

// ─── Flowchart / graph parser ──────────────────────────────────────────────

// Node shape patterns — order matters (longest/most-specific first)
// Each entry: { open, close, shapeKey }
const FLOW_SHAPES = [
  { open: '([',  close: '])',  shape: 'stadium' },
  { open: '[[',  close: ']]',  shape: 'subroutine' },
  { open: '[(',  close: ')]',  shape: 'cylinder' },
  { open: '((',  close: '))',  shape: 'circle' },
  { open: '{{',  close: '}}',  shape: 'hexagon' },
  { open: '[/',  close: '/]',  shape: 'parallelogram' },
  { open: '[\\', close: '\\]', shape: 'parallelogram' },
  { open: '>',   close: ']',   shape: 'asymmetric' },
  { open: '[',   close: ']',   shape: 'rect' },
  { open: '(',   close: ')',   shape: 'round' },
  { open: '{',   close: '}',   shape: 'rhombus' },
];

export function parseFlowchart(text, targetType) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const elementsById = new Map();
  const links = [];
  let title = null;
  let direction = 'horizontal';

  // Direction hint from `flowchart TD` / `graph LR` header
  if (lines[0]) {
    const dm = /^(?:flowchart|graph)(?:-elk)?\s+(TD|TB|BT|LR|RL)/i.exec(lines[0]);
    if (dm) {
      const d = dm[1].toUpperCase();
      direction = (d === 'TD' || d === 'TB' || d === 'BT') ? 'vertical' : 'horizontal';
    }
  }

  const ensureNode = (id, label, shape) => {
    if (elementsById.has(id)) {
      // Upgrade label/shape if previously unlabeled
      const existing = elementsById.get(id);
      if (label && !existing._labeled) {
        existing.label = label;
        existing.shape = shape;
        existing._labeled = true;
        existing.component = flowComponent(label, shape, targetType);
      }
      return existing;
    }
    const node = {
      id,
      label: label || id,
      shape,
      _labeled: !!label,
      component: flowComponent(label || id, shape, targetType),
    };
    elementsById.set(id, node);
    return node;
  };

  // `subgraph <Name>` / `subgraph id[Title]` ... `end` groups its members. Previously both keywords were simply
  // skipped, so the member nodes still parsed (they sit on their own lines) and the GROUPING was silently lost -
  // reported from real use 2026-07-27 on a flowchart whose six groups all vanished.
  //
  // Membership is recorded on FIRST MENTION inside a subgraph, and the INNERMOST open one wins. Mermaid allows
  // nesting; Diagramforce cannot (`canEmbed('sf.Zone','sf.Zone')` is false), so nesting flattens to the innermost
  // group and the outer one is reported as dropped rather than silently ignored.
  const groups = [];                 // { key, title, memberIds: [] } in declaration order
  const groupByKey = new Map();
  const groupOfNode = new Map();     // nodeId -> group key (innermost)
  const openStack = [];
  const droppedOuter = new Set();

  // First line is the header (flowchart TD / graph LR) — skip
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && /^(flowchart|graph)/i.test(line)) continue;
    if (/^title\s+/i.test(line)) { title = line.replace(/^title\s+/i, '').trim(); continue; }

    const sg = line.match(/^subgraph\s+(.+)$/i);
    if (sg) {
      // `subgraph Name`, `subgraph id[Title]`, `subgraph id["Title"]` — the bracketed form names the id first.
      const raw = sg[1].trim();
      const m = raw.match(/^([^\s[\]{}()]+)\s*[[({]\s*"?(.*?)"?\s*[\])}]\s*$/);
      const key = (m ? m[1] : raw).trim();
      const label = (m ? m[2] : raw).trim() || key;
      if (openStack.length) droppedOuter.add(openStack[openStack.length - 1]);
      if (!groupByKey.has(key)) {
        const g = { key, title: label, memberIds: [] };
        groupByKey.set(key, g);
        groups.push(g);
      }
      openStack.push(key);
      continue;
    }
    if (/^end\b/i.test(line)) { openStack.pop(); continue; }
    if (/^(direction|classDef|class|click|style|linkStyle)\b/i.test(line)) continue;

    // Parse links on this line (may contain multiple sequential: A --> B --> C)
    const before = new Set(elementsById.keys());
    parseFlowLineEdges(line, ensureNode, links);
    // Claim every node this line INTRODUCED for the innermost open subgraph. Claiming only new ids is what makes
    // `A --> B` outside a subgraph leave an already-grouped A where it was.
    if (openStack.length) {
      const key = openStack[openStack.length - 1];
      for (const id of elementsById.keys()) {
        if (before.has(id) || groupOfNode.has(id)) continue;
        groupOfNode.set(id, key);
        groupByKey.get(key).memberIds.push(id);
      }
    }
  }

  const warnings = [];
  if (droppedOuter.size) {
    warnings.push(`Nested subgraphs flattened to the innermost group: ${[...droppedOuter].join(', ')} `
      + 'kept its label but not its members (a Zone cannot contain another Zone).');
  }

  return {
    diagramType: targetType,
    title,
    direction,
    elements: [...elementsById.values()],
    links,
    groups: groups.filter((g) => g.memberIds.length),
    warnings,
  };
}

/**
 * Parse one flowchart line into nodes+edges.
 * Handles sequential chains like "A --> B --> C" and single standalone nodes.
 */
function parseFlowLineEdges(line, ensureNode, links) {
  // Find all edges on this line. Grammar:
  //   <nodeRef> <edge> <nodeRef> [<edge> <nodeRef>]...
  // where nodeRef is `ID[label]` or `ID` etc., and edge is `-->`, `---`, `-.->`, `==>`, etc.
  // We tokenize by scanning left-to-right.
  let pos = 0;
  const len = line.length;

  // Parse first node ref
  let prev = scanNodeRef(line, pos);
  if (!prev) return; // not a node line
  pos = prev.next;
  let prevNode = ensureNode(prev.id, prev.label, prev.shape);

  while (pos < len) {
    // Skip whitespace
    while (pos < len && /\s/.test(line[pos])) pos++;
    if (pos >= len) break;

    // Try to parse an edge
    const edge = scanEdge(line, pos);
    if (!edge) break;
    pos = edge.next;

    // Skip whitespace, then parse next node
    while (pos < len && /\s/.test(line[pos])) pos++;
    const nxt = scanNodeRef(line, pos);
    if (!nxt) break;
    pos = nxt.next;

    const nxtNode = ensureNode(nxt.id, nxt.label, nxt.shape);
    links.push({
      source: prevNode.id,
      target: nxtNode.id,
      label: edge.label || '',
      style: edge.style, // 'solid' | 'dotted' | 'thick'
      arrow: edge.arrow, // true/false
    });
    prevNode = nxtNode;
  }
}

/** Scan a node reference starting at pos. Returns { id, label, shape, next } or null. */
function scanNodeRef(line, pos) {
  // Node id = alnum + _ - . :
  const idRe = /[A-Za-z0-9_\-.:]+/y;
  idRe.lastIndex = pos;
  const m = idRe.exec(line);
  if (!m) return null;
  const id = m[0];
  let next = idRe.lastIndex;

  // Check for a shape block immediately after the id
  for (const sh of FLOW_SHAPES) {
    if (line.startsWith(sh.open, next)) {
      const bodyStart = next + sh.open.length;
      const closeIdx = line.indexOf(sh.close, bodyStart);
      if (closeIdx === -1) continue;
      let label = line.slice(bodyStart, closeIdx).trim();
      label = unquoteLabel(label);
      return { id, label, shape: sh.shape, next: closeIdx + sh.close.length };
    }
  }
  return { id, label: null, shape: 'rect', next };
}

/** Strip surrounding quotes and decode mermaid HTML entities. */
function unquoteLabel(s) {
  if (!s) return s;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s.replace(/<br\s*\/?>/gi, '\n').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/** Scan an edge starting at pos. Returns { style, arrow, label, next } or null. */
function scanEdge(line, pos) {
  // Patterns we support (ordered so longer matches first):
  //   -- text -->     (labelled solid with arrow)
  //   -- text ---     (labelled solid no arrow)
  //   -.text.->       (labelled dotted)
  //   == text ==>     (labelled thick)
  //   -->|text|       (handled after the arrow itself)
  //   -->   ---   -.->   ==>   ----
  const remaining = line.slice(pos);

  // Pattern: `-- label -->` or `-- label ---`
  let m = /^--\s*([^-][^|]*?)\s*-->/.exec(remaining);
  if (m) return { style: 'solid', arrow: true, label: m[1].trim(), next: pos + m[0].length };
  m = /^--\s*([^-][^|]*?)\s*---/.exec(remaining);
  if (m) return { style: 'solid', arrow: false, label: m[1].trim(), next: pos + m[0].length };

  // Pattern: `== label ==>`
  m = /^==\s*([^=][^|]*?)\s*==>/.exec(remaining);
  if (m) return { style: 'thick', arrow: true, label: m[1].trim(), next: pos + m[0].length };

  // Pattern: `-. label .->`
  m = /^-\.\s*([^.]+?)\s*\.->/.exec(remaining);
  if (m) return { style: 'dotted', arrow: true, label: m[1].trim(), next: pos + m[0].length };

  // Plain arrows
  m = /^(-\.->|--+>|==+>|--+-|==+=|-\.\.->)/.exec(remaining);
  if (m) {
    const tok = m[0];
    let style = 'solid', arrow = true;
    if (tok.startsWith('-.'))       style = 'dotted';
    else if (tok.startsWith('=='))  style = 'thick';
    if (!tok.includes('>')) arrow = false;
    let next = pos + tok.length;

    // Check for trailing `|label|`
    let label = '';
    const rest = line.slice(next);
    const lm = /^\s*\|([^|]*)\|/.exec(rest);
    if (lm) { label = lm[1].trim(); next += lm[0].length; }

    return { style, arrow, label, next };
  }
  return null;
}

/** Build a component object for a flowchart node based on shape + target diagram type. */
function flowComponent(label, shape, targetType) {
  if (targetType === 'architecture') {
    // Everything maps to SimpleNode in architecture
    return { type: 'sf.SimpleNode', label };
  }
  if (targetType === 'org') {
    // An org chart written in mermaid is a flowchart of manager -> report edges; mermaid has no org syntax, so
    // there is nothing to detect and the TARGET is a caller's choice. Node shape is meaningless here (nobody
    // writes a rhombus person), so every node becomes a person and the label is the NAME - `personName` is what
    // the card renders and what the org tooling reads, so putting it only in `label` would leave the card blank.
    // `Jane Doe - CTO` splits on the first dash because that is how people actually write these; without the
    // split the whole string lands in the name and the job-title row stays empty.
    const m = String(label).match(/^(.*?)\s+[-\u2013]\s+(.+)$/);
    return m
      ? { type: 'sf.OrgPerson', label: m[1].trim(), personName: m[1].trim(), jobTitle: m[2].trim() }
      : { type: 'sf.OrgPerson', label, personName: label };
  }
  // targetType === 'process' → BPMN shapes
  switch (shape) {
    case 'stadium':
    case 'circle':
      return { type: 'sf.BpmnEvent', label, eventType: 'start' };
    case 'rhombus':
    case 'hexagon':
      return { type: 'sf.BpmnGateway', label, gatewayType: 'exclusive' };
    case 'subroutine':
      return { type: 'sf.BpmnSubprocess', label };
    case 'cylinder':
      return { type: 'sf.FlowDatabase', label };
    case 'parallelogram':
      return { type: 'sf.FlowIO', label };
    case 'asymmetric':
      return { type: 'sf.FlowOffPage', label };
    case 'rect':
    case 'round':
    default:
      return { type: 'sf.BpmnTask', label };
  }
}

// ─── State diagram parser ──────────────────────────────────────────────────

export function parseStateDiagram(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const elementsById = new Map();
  const links = [];
  let title = null;

  let startId = null, endId = null;
  const getStart = () => {
    if (!startId) {
      startId = '__start__';
      elementsById.set(startId, { id: startId, label: '', component: { type: 'sf.BpmnEvent', label: '', eventType: 'start' } });
    }
    return startId;
  };
  const getEnd = () => {
    if (!endId) {
      endId = '__end__';
      elementsById.set(endId, { id: endId, label: '', component: { type: 'sf.BpmnEvent', label: '', eventType: 'end' } });
    }
    return endId;
  };
  const ensureState = (id) => {
    if (id === '[*]') return null;
    if (elementsById.has(id)) return elementsById.get(id);
    const node = { id, label: id, component: { type: 'sf.BpmnTask', label: id } };
    elementsById.set(id, node);
    return node;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && /^stateDiagram/i.test(line)) continue;
    if (/^title\s+/i.test(line)) { title = line.replace(/^title\s+/i, '').trim(); continue; }
    if (/^(state|note|direction|\[\*\]\s*:)/i.test(line) && !/-->/.test(line)) continue;

    // Transition: A --> B : label
    const m = /^(\S+)\s*-->\s*(\S+)\s*(?::\s*(.*))?$/.exec(line);
    if (!m) continue;
    const [, lhs, rhs, label] = m;
    const srcId = lhs === '[*]' ? getStart() : ensureState(lhs)?.id;
    const tgtId = rhs === '[*]' ? getEnd()   : ensureState(rhs)?.id;
    if (!srcId || !tgtId) continue;
    links.push({ source: srcId, target: tgtId, label: (label || '').trim(), style: 'solid', arrow: true });
  }

  return { diagramType: 'process', title, direction: 'vertical', elements: [...elementsById.values()], links };
}

// ─── ER diagram parser ─────────────────────────────────────────────────────

export function parseErDiagram(text) {
  const lines = text.split('\n');
  const entities = new Map(); // name → { fields: [] }
  const rels = [];
  let title = null;

  // Ensure helper
  const ensureEntity = (name) => {
    if (!entities.has(name)) entities.set(name, { name, fields: [] });
    return entities.get(name);
  };

  // Block-state: when we see `ENTITY {`, subsequent lines are fields until `}`
  let currentBlock = null;
  for (let raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (/^erDiagram\b/i.test(line)) continue;
    if (/^title\s+/i.test(line)) { title = line.replace(/^title\s+/i, '').trim(); continue; }

    if (currentBlock) {
      if (line === '}') { currentBlock = null; continue; }
      // Field syntax:  type name [PK|FK|UK] "comment"
      const fm = /^(\S+)\s+(\S+)(?:\s+(PK|FK|UK))?(?:\s+"([^"]*)")?$/.exec(line);
      if (fm) {
        const [, fType, fName, key] = fm;
        currentBlock.fields.push({
          label: fName,
          apiName: fName,
          type: fType,
          keyType: key === 'PK' ? 'pk' : key === 'FK' ? 'fk' : null,
        });
      }
      continue;
    }

    // Block opener: `CUSTOMER {`
    const bm = /^([A-Za-z_][\w-]*)\s*\{$/.exec(line);
    if (bm) {
      currentBlock = ensureEntity(bm[1]);
      continue;
    }

    // Relationship: `CUSTOMER ||--o{ ORDER : places`
    const rm = /^([A-Za-z_][\w-]*)\s+([|}o][|o}]?)(--|\.\.)([|{o][|o{]?)\s+([A-Za-z_][\w-]*)(?:\s*:\s*(.*))?$/.exec(line);
    if (rm) {
      const [, leftName, leftCard, , rightCard, rightName, label] = rm;
      ensureEntity(leftName);
      ensureEntity(rightName);
      rels.push({
        source: leftName,
        target: rightName,
        label: (label || '').trim(),
        sourceMarker: erMarkerFromLeft(leftCard),
        targetMarker: erMarkerFromRight(rightCard),
      });
    }
  }

  // Build elements
  const elements = [];
  for (const [name, ent] of entities) {
    elements.push({
      id: name,
      label: name,
      component: {
        type: 'sf.DataObject',
        label: name,
        objectName: name,
        fields: ent.fields.length > 0 ? ent.fields : [
          { label: 'Id', apiName: 'Id', type: 'ID', keyType: 'pk' },
        ],
      },
    });
  }

  // Convert relationships into links with ER markers
  const links = rels.map(r => ({
    source: r.source,
    target: r.target,
    label: r.label,
    erSource: r.sourceMarker,
    erTarget: r.targetMarker,
  }));

  return { diagramType: 'datamodel', title, direction: 'horizontal', elements, links };
}

/** Left side card (before the dashes) → marker name for the SOURCE end of the link. */
function erMarkerFromLeft(card) {
  // Mermaid: `||` one, `|o` zeroOne, `}|` oneMany, `}o` zeroMany
  switch (card) {
    case '||': return 'one';
    case '|o': return 'zeroOne';
    case '}|': return 'oneMany';
    case '}o': return 'zeroMany';
    default:   return 'none';
  }
}
function erMarkerFromRight(card) {
  // Right side mirror: `||`, `o|`, `|{`, `o{`
  switch (card) {
    case '||': return 'one';
    case 'o|': return 'zeroOne';
    case '|{': return 'oneMany';
    case 'o{': return 'zeroMany';
    default:   return 'none';
  }
}

// ─── Link construction ────────────────────────────────────────────────────

/**
 * Build a JointJS link from a parsed link spec.
 * Handles flowchart edges (arrow/dotted/thick/labelled) and ER markers.
 */
function buildLink(lk, src, tgt) {
  const strokeColor = '#888888';
  const strokeWidth = lk.style === 'thick' ? 3 : 2;
  const dashArray = lk.style === 'dotted' ? '4 4' : null;

  // Target marker
  let targetMarker;
  if (lk.erTarget) {
    targetMarker = erMarkerPath(lk.erTarget, strokeColor);
  } else if (lk.arrow === false) {
    targetMarker = { type: 'path', d: ER_MARKER_D.none, fill: 'none', stroke: strokeColor, 'stroke-width': 2 };
  } else {
    targetMarker = { type: 'path', d: ER_MARKER_D.arrow };
  }

  // Source marker
  let sourceMarker;
  if (lk.erSource) {
    sourceMarker = erMarkerPath(lk.erSource, strokeColor);
  } else {
    sourceMarker = { type: 'path', d: ER_MARKER_D.none, fill: 'none', stroke: strokeColor, 'stroke-width': 2 };
  }

  const lineAttrs = {
    stroke: strokeColor,
    strokeWidth,
    sourceMarker,
    targetMarker,
  };

  const link = new joint.shapes.standard.Link({
    source: { id: src.id },
    target: { id: tgt.id },
    attrs: { line: lineAttrs },
    router: { name: 'sfManhattan' },
    connector: { name: 'rounded', args: { radius: 8 } },
    z: 0,
  });
  // Dashed lines use `cell.prop('lineStyle')` so the overlay manager can
  // paint dashes without bleeding into marker content on Safari.
  if (dashArray) link.prop('lineStyle', dashArray);

  if (lk.label) {
    link.labels([{
      position: 0.5,
      attrs: {
        text: { text: lk.label, fontSize: 11, fill: 'var(--text-primary)' },
      },
    }]);
  }
  return link;
}

// ─── Sequence diagram parser ───────────────────────────────────────────────
//
// Mermaid sequenceDiagram syntax — covers the common subset:
//
//   sequenceDiagram
//       title My Flow
//       autonumber
//       participant Alice as Alice Smith
//       actor User
//       Alice->>Bob: Hello
//       Bob-->>Alice: Hi back
//       Alice->>+Bob: Activate
//       Bob-->>-Alice: Deactivate
//       Alice-)Bob: Async
//       Bob--)Alice: Async reply
//       Note left of Alice: note
//       Note right of Bob: note
//       Note over Alice,Bob: spans both
//       activate Bob
//       deactivate Bob
//       loop Every minute
//         Alice->>Bob: check
//       end
//       alt success
//         Alice->>Bob: ok
//       else failure
//         Alice->>Bob: fail
//       end
//
// Message operators (Mermaid → our arrow style):
//   ->>    solid line, solid arrow        (synchronous request)
//   -->>   dashed line, solid arrow       (synchronous response)
//   ->     solid line, open arrow         (legacy sync)
//   -->    dashed line, open arrow        (legacy response)
//   -)     solid line, open arrow, async  (fire-and-forget)
//   --)    dashed line, open arrow, async (async response)
//   -x / --x  solid/dashed, lost message (rendered as solid arrow for now)
//
// Layout constants are tuned to match the manually-drawn participants:
//   LIFELINE_X_START   left margin of the leftmost participant
//   LIFELINE_X_GAP     horizontal gap between participant centers
//   MESSAGE_Y_START    Y of the first message (below the header)
//   MESSAGE_Y_GAP      vertical gap between successive messages
//   FRAGMENT_PADDING   top/bottom padding inside a fragment box
//
const SEQ_CONST = {
  LIFELINE_X_START: 60,
  LIFELINE_X_GAP: 220,
  MESSAGE_Y_START: 120,
  MESSAGE_Y_GAP: 48,
  FRAGMENT_PAD_TOP: 28,
  FRAGMENT_PAD_BOTTOM: 18,
  FRAGMENT_PAD_X: 28,
  PARTICIPANT_W: 140,
  ACTOR_W: 100,
  PARTICIPANT_HEADER_Y: 40,
  ACTIVATION_W: 12,
  NOTE_W: 160,
  NOTE_H: 56,
  NOTE_GAP: 12,
};

// Role-colour map mirrors SEQ_ACCENT in components.js. Actor is kept neutral
// grey to match the generic participant default — sequence diagrams read
// cleaner when only roles with a semantic colour (Salesforce green, API blue,
// External amber) stand out visually.
const SEQ_ROLE_COLORS = {
  generic:    '#8A9099',
  salesforce: '#2E844A',
  api:        '#1D73C9',
  external:   '#F6B355',
  actor:      '#8A9099',
};

/** Guess a participant role from its id / displayed label. */
function inferSequenceRole(id, label) {
  const hay = `${id || ''} ${label || ''}`.toLowerCase();
  if (/\b(salesforce|sfdc|crm|sales cloud|service cloud|marketing cloud|mulesoft)\b/.test(hay)) return 'salesforce';
  if (/\b(api|system|service|microservice|integration|endpoint|server|gateway|broker|queue|bus)\b/.test(hay)) return 'api';
  if (/\b(external|partner|third[- ]?party|vendor|sap|ofbiz|ecommerce|ftp|legacy)\b/.test(hay)) return 'external';
  return 'generic';
}

/**
 * Parse a mermaid `sequenceDiagram` block into an internal representation
 * with absolute positions pre-computed for every element.
 *
 * Returns the standard parser payload plus `isSequence: true` so that the
 * importer can skip auto-layout / port-snapping.
 */
export function parseSequenceDiagram(text) {
  const lines = text.split('\n');

  // ── Pass 1: tokenise into a flat event stream ───────────────────────────
  const participants = new Map(); // id → { id, label, role, isActor, order }
  const events = []; // { kind: 'msg'|'note'|'activate'|'deactivate'|'fragStart'|'fragElse'|'fragEnd', ... }
  let title = null;
  let autonumber = false;
  let autoNum = 0;
  let order = 0;

  const ensureParticipant = (id, opts = {}) => {
    if (!id) return null;
    if (participants.has(id)) {
      const p = participants.get(id);
      if (opts.label) p.label = opts.label;
      if (opts.isActor) p.isActor = true;
      return p;
    }
    const label = opts.label || id;
    const isActor = !!opts.isActor;
    const role = isActor ? 'actor' : inferSequenceRole(id, label);
    const p = { id, label, role, isActor, order: order++ };
    participants.set(id, p);
    return p;
  };

  for (let raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (/^sequenceDiagram\b/i.test(line)) continue;

    // title MyTitle
    let m = /^title\s+(.*)$/i.exec(line);
    if (m) { title = m[1].trim(); continue; }

    // autonumber
    if (/^autonumber\b/i.test(line)) { autonumber = true; continue; }

    // participant Foo as Foo Bar   |  participant Foo
    m = /^participant\s+(\S+)(?:\s+as\s+(.+))?$/i.exec(line);
    if (m) { ensureParticipant(m[1], { label: unquoteLabel((m[2] || m[1]).trim()) }); continue; }

    // actor Foo as Foo Bar | actor Foo
    m = /^actor\s+(\S+)(?:\s+as\s+(.+))?$/i.exec(line);
    if (m) { ensureParticipant(m[1], { label: unquoteLabel((m[2] || m[1]).trim()), isActor: true }); continue; }

    // activate Foo   |   deactivate Foo
    m = /^activate\s+(\S+)$/i.exec(line);
    if (m) { ensureParticipant(m[1]); events.push({ kind: 'activate', id: m[1] }); continue; }
    m = /^deactivate\s+(\S+)$/i.exec(line);
    if (m) { ensureParticipant(m[1]); events.push({ kind: 'deactivate', id: m[1] }); continue; }

    // Note left of X: text   |  Note right of X: text  |  Note over X,Y: text
    m = /^note\s+(left of|right of|over)\s+([^:]+):\s*(.*)$/i.exec(line);
    if (m) {
      const side = m[1].toLowerCase();
      const targets = m[2].split(',').map(s => s.trim()).filter(Boolean);
      targets.forEach(t => ensureParticipant(t));
      events.push({ kind: 'note', side, targets, text: unquoteLabel(m[3].trim()) });
      continue;
    }

    // Fragment openers: loop / alt / opt / par / critical / break  <condition>
    m = /^(loop|alt|opt|par|critical|break)\b\s*(.*)$/i.exec(line);
    if (m) {
      events.push({ kind: 'fragStart', type: m[1].toLowerCase(), condition: (m[2] || '').trim() });
      continue;
    }
    // else / and / option  <condition>  — alternative branch inside a fragment
    m = /^(else|and|option)\b\s*(.*)$/i.exec(line);
    if (m) {
      events.push({ kind: 'fragElse', branch: m[1].toLowerCase(), condition: (m[2] || '').trim() });
      continue;
    }
    // end — closes the most recent fragment
    if (/^end\b/i.test(line)) { events.push({ kind: 'fragEnd' }); continue; }

    // Message: `Src OP [+|-]Tgt : label`
    // OP ∈ {->>, -->>, ->, -->, -), --), -x, --x}
    const msgRe = /^(\S+?)\s*(->>|-->>|->|-->|-\)|--\)|-x|--x)\s*([+-]?)(\S+?)\s*:\s*(.*)$/;
    m = msgRe.exec(line);
    if (m) {
      const [, srcId, op, actFlag, tgtId, label] = m;
      ensureParticipant(srcId);
      ensureParticipant(tgtId);
      if (actFlag === '+') events.push({ kind: 'activate', id: tgtId });
      let text = unquoteLabel(label.trim());
      if (autonumber) { autoNum += 1; text = `${autoNum}. ${text}`; }
      const style = (op === '-->>' || op === '-->' || op === '--)' || op === '--x') ? 'dashed' : 'solid';
      const arrow = (op === '->>' || op === '-->>') ? 'solid'
                   : (op === '-)' || op === '--)') ? 'openAsync'
                   : (op === '-x' || op === '--x') ? 'lost'
                   : 'open';
      events.push({ kind: 'msg', src: srcId, tgt: tgtId, style, arrow, label: text });
      if (actFlag === '-') events.push({ kind: 'deactivate', id: tgtId });
      continue;
    }

    // Unknown line — silently skip (helps survive odd mermaid extensions)
  }

  // ── Pass 2: assign participant X positions and determine message Ys ─────
  const partList = [...participants.values()].sort((a, b) => a.order - b.order);
  const partX = new Map();
  partList.forEach((p, i) => {
    const centerX = SEQ_CONST.LIFELINE_X_START + (SEQ_CONST.PARTICIPANT_W / 2) + i * SEQ_CONST.LIFELINE_X_GAP;
    partX.set(p.id, centerX);
  });

  // Walk the event stream computing Y per message and tracking activation stacks.
  // Message Y starts just below the header band.
  let curY = SEQ_CONST.MESSAGE_Y_START;
  const messages = []; // { src, tgt, y, style, arrow, label }
  const notes = [];    // { x, y, w, h, text }
  const activations = []; // { partId, startY, endY }
  const fragments = []; // { type, condition, topY, bottomY, minId, maxId, branches: [{ y, label }] }
  const fragmentStack = [];
  const activeStack = new Map(); // partId → array of { startY }

  const partIdsInvolved = (evtIds) => {
    const xs = evtIds.map(id => partX.get(id)).filter(x => x != null);
    if (!xs.length) return null;
    return { min: Math.min(...xs), max: Math.max(...xs) };
  };
  const touchFragments = (evtIds) => {
    if (!fragmentStack.length) return;
    for (const f of fragmentStack) {
      for (const id of evtIds) {
        if (partX.has(id)) {
          if (f.minId == null || partX.get(id) < partX.get(f.minId)) f.minId = id;
          if (f.maxId == null || partX.get(id) > partX.get(f.maxId)) f.maxId = id;
        }
      }
    }
  };

  for (const evt of events) {
    if (evt.kind === 'msg') {
      const y = curY;
      messages.push({ ...evt, y });
      touchFragments([evt.src, evt.tgt]);
      curY += SEQ_CONST.MESSAGE_Y_GAP;
    } else if (evt.kind === 'note') {
      const y = curY;
      const span = partIdsInvolved(evt.targets);
      let nx, nw;
      if (evt.side === 'over') {
        if (evt.targets.length === 1 && span) {
          nx = span.min - SEQ_CONST.NOTE_W / 2;
          nw = SEQ_CONST.NOTE_W;
        } else if (span) {
          nx = span.min - SEQ_CONST.PARTICIPANT_W / 2 - 10;
          nw = (span.max - span.min) + SEQ_CONST.PARTICIPANT_W + 20;
        } else continue;
      } else if (evt.side === 'left of' && span) {
        nx = span.min - SEQ_CONST.PARTICIPANT_W / 2 - SEQ_CONST.NOTE_W - SEQ_CONST.NOTE_GAP;
        nw = SEQ_CONST.NOTE_W;
      } else if (evt.side === 'right of' && span) {
        nx = span.max + SEQ_CONST.PARTICIPANT_W / 2 + SEQ_CONST.NOTE_GAP;
        nw = SEQ_CONST.NOTE_W;
      } else continue;
      notes.push({ x: nx, y: y - SEQ_CONST.NOTE_H / 2 + SEQ_CONST.MESSAGE_Y_GAP / 2, w: nw, h: SEQ_CONST.NOTE_H, text: evt.text });
      touchFragments(evt.targets);
      curY += SEQ_CONST.MESSAGE_Y_GAP;
    } else if (evt.kind === 'activate') {
      if (!activeStack.has(evt.id)) activeStack.set(evt.id, []);
      activeStack.get(evt.id).push({ startY: curY - 6 });
    } else if (evt.kind === 'deactivate') {
      const stack = activeStack.get(evt.id);
      if (stack && stack.length) {
        const a = stack.pop();
        activations.push({ partId: evt.id, startY: a.startY, endY: curY - SEQ_CONST.MESSAGE_Y_GAP + 10 });
      }
    } else if (evt.kind === 'fragStart') {
      fragmentStack.push({
        type: evt.type,
        condition: evt.condition,
        topY: curY - 18,
        branches: [],
        minId: null,
        maxId: null,
      });
    } else if (evt.kind === 'fragElse') {
      const f = fragmentStack[fragmentStack.length - 1];
      if (f) f.branches.push({ y: curY - 10, label: evt.condition || evt.branch });
    } else if (evt.kind === 'fragEnd') {
      const f = fragmentStack.pop();
      if (f) {
        f.bottomY = curY + SEQ_CONST.FRAGMENT_PAD_BOTTOM;
        fragments.push(f);
        curY += 10; // small gap after fragment closes
      }
    }
  }
  // Flush any leftover open activations so they render even if mermaid omitted `deactivate`
  for (const [id, stack] of activeStack) {
    while (stack.length) {
      const a = stack.pop();
      activations.push({ partId: id, startY: a.startY, endY: curY - 6 });
    }
  }

  // Total vertical extent: tallest participant needs to cover every event plus
  // the 48px bottom-header mirror that sits below the lifeline (new default —
  // mirrors the top header at the foot for long interactions).
  const totalHeight = Math.max(curY + 40, SEQ_CONST.MESSAGE_Y_START + 80) + 48;

  // ── Pass 3: materialise elements + links ────────────────────────────────
  const elements = [];
  const links = [];

  // Participants / actors
  for (const p of partList) {
    const centerX = partX.get(p.id);
    const accent = SEQ_ROLE_COLORS[p.role] || SEQ_ROLE_COLORS.generic;
    if (p.isActor) {
      const w = SEQ_CONST.ACTOR_W;
      const x = centerX - w / 2;
      elements.push({
        id: p.id,
        position: { x, y: SEQ_CONST.PARTICIPANT_HEADER_Y },
        size: { width: w, height: totalHeight },
        component: {
          type: 'sf.SequenceActor',
          label: p.label,
          role: 'actor',
          accentColor: accent,
        },
      });
    } else {
      const w = SEQ_CONST.PARTICIPANT_W;
      const x = centerX - w / 2;
      elements.push({
        id: p.id,
        position: { x, y: SEQ_CONST.PARTICIPANT_HEADER_Y },
        size: { width: w, height: totalHeight },
        component: {
          type: 'sf.SequenceParticipant',
          label: p.label,
          role: p.role,
          accentColor: accent,
        },
      });
    }
  }

  // Fragments — rendered first (behind messages) via z-order assignment in the shape
  fragments.forEach((f, idx) => {
    const minX = f.minId != null ? partX.get(f.minId) : SEQ_CONST.LIFELINE_X_START + SEQ_CONST.PARTICIPANT_W / 2;
    const maxX = f.maxId != null ? partX.get(f.maxId) : minX + SEQ_CONST.LIFELINE_X_GAP;
    const x = minX - SEQ_CONST.FRAGMENT_PAD_X;
    const y = f.topY;
    const w = (maxX - minX) + SEQ_CONST.FRAGMENT_PAD_X * 2;
    const h = f.bottomY - f.topY;
    elements.push({
      id: `__frag_${idx}`,
      position: { x, y },
      size: { width: w, height: h },
      component: {
        type: 'sf.SequenceFragment',
        label: f.type,
        fragmentType: f.type,
        condition: f.condition,
      },
    });
  });

  // Activation boxes
  activations.forEach((a, idx) => {
    const centerX = partX.get(a.partId);
    if (centerX == null) return;
    const x = centerX - SEQ_CONST.ACTIVATION_W / 2;
    const y = a.startY;
    const h = Math.max(a.endY - a.startY, 20);
    elements.push({
      id: `__act_${idx}`,
      position: { x, y },
      size: { width: SEQ_CONST.ACTIVATION_W, height: h },
      component: { type: 'sf.SequenceActivation', label: '' },
    });
  });

  // Notes — reuse sf.Note for simple inline notes
  notes.forEach((n, idx) => {
    elements.push({
      id: `__note_${idx}`,
      position: { x: n.x, y: n.y },
      size: { width: n.w, height: n.h },
      component: { type: 'sf.Note', label: n.text },
    });
  });

  // Messages → links (positions encoded so buildSequenceLink can anchor on Y)
  for (const m of messages) {
    links.push({
      source: m.src,
      target: m.tgt,
      label: m.label,
      y: m.y,
      style: m.style,    // 'solid' | 'dashed'
      arrow: m.arrow,    // 'solid' | 'open' | 'openAsync' | 'lost'
    });
  }

  return {
    diagramType: 'sequence',
    isSequence: true,
    title,
    elements,
    links,
  };
}

/**
 * Build a JointJS link for a sequence message. Uses `topLeft` anchors with
 * an explicit `dy` so the arrow attaches at the correct Y on both lifelines,
 * regardless of their dynamic heights.
 */
function buildSequenceLink(lk, src, tgt) {
  const strokeColor = '#5E6B7A';
  const strokeWidth = 2;
  const dashed = lk.style === 'dashed';

  // Source marker: never a marker tail — just trim the line.
  const sourceMarker = { type: 'path', d: 'M 0 0 L -6 0', fill: 'none', stroke: strokeColor, 'stroke-width': 2 };

  // Target marker — open V-head for async / open, filled triangle for sync.
  let targetMarker;
  if (lk.arrow === 'openAsync' || lk.arrow === 'open') {
    targetMarker = { type: 'path', d: ER_MARKER_D.lineArrow, fill: 'none', stroke: strokeColor, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
  } else if (lk.arrow === 'lost') {
    // Simple X at the tip to indicate lost message
    targetMarker = { type: 'path', d: 'M -10 -6 L 0 6 M -10 6 L 0 -6', fill: 'none', stroke: strokeColor, 'stroke-width': 2 };
  } else {
    targetMarker = { type: 'path', d: ER_MARKER_D.arrow };
  }

  const srcW = (src.get('size') || {}).width || 140;
  const tgtW = (tgt.get('size') || {}).width || 140;

  const lineAttrs = {
    stroke: strokeColor,
    strokeWidth,
    sourceMarker,
    targetMarker,
  };

  const link = new joint.shapes.standard.Link({
    source: {
      id: src.id,
      anchor: { name: 'topLeft', args: { dx: srcW / 2, dy: lk.y } },
    },
    target: {
      id: tgt.id,
      anchor: { name: 'topLeft', args: { dx: tgtW / 2, dy: lk.y } },
    },
    connectionPoint: { name: 'anchor' },
    router: { name: 'normal' },
    connector: { name: 'normal' },
    attrs: { line: lineAttrs },
    z: 3000,
  });
  // Dashed lines use `cell.prop('lineStyle')` so the overlay manager can
  // paint dashes without bleeding into marker content on Safari. Use the panel's own "Dashed" value ('8 4' from
  // LINK_LINE_STYLE_OPTS) so the Line Style control matches (a '6 4' reads as a non-match → falls back to Solid).
  if (dashed) link.prop('lineStyle', '8 4');

  if (lk.label) {
    link.labels([{
      position: { distance: 0.5, offset: -10 },
      attrs: {
        text: { text: lk.label, fontSize: 11, fill: 'var(--text-primary)' },
      },
    }]);
  }
  return link;
}

/** ER marker path spec matching js/properties.js definitions. */
function erMarkerPath(name, stroke) {
  const BG = 'var(--bg-canvas, #1A1A1A)';
  switch (name) {
    case 'one':
      return { type: 'path', d: ER_MARKER_D.one, fill: 'none', stroke, 'stroke-width': 2 };
    case 'zeroOne':
      return { type: 'path', d: ER_MARKER_D.zeroOne, fill: BG, stroke, 'stroke-width': 2 };
    case 'many':
      return { type: 'path', d: ER_MARKER_D.many, fill: 'none', stroke, 'stroke-width': 2 };
    case 'oneMany':
      return { type: 'path', d: ER_MARKER_D.oneMany, fill: 'none', stroke, 'stroke-width': 2 };
    case 'zeroMany':
      return { type: 'path', d: ER_MARKER_D.zeroMany, fill: BG, stroke, 'stroke-width': 2 };
    case 'none':
    default:
      return { type: 'path', d: ER_MARKER_D.none, fill: 'none', stroke, 'stroke-width': 2 };
  }
}

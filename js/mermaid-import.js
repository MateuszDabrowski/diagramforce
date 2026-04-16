// Mermaid Import — convert mermaid.js source into a diagramforce diagram.
//
// Supported diagram types (v1 — beta):
//   graph                        → Process  (BPMN shapes)
//   flowchart / flowchart-elk   → Process  (BPMN shapes)
//   stateDiagram / stateDiagram-v2 → Process (BPMN shapes)
//   erDiagram                    → Data Model (DataObject)
//
// The parser is a hand-written, line-oriented, best-effort tokenizer — it
// does NOT use the real mermaid grammar and will not handle every edge case.
// It aims to cover the most common mermaid snippets produced by LLMs and docs.

import { createElementFromTemplate } from './templates.js?v=1.4.1';

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
    return { ok: false, error: 'Could not detect a supported diagram type. Expected one of: graph, flowchart, stateDiagram, erDiagram.' };
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
 * Returns true on success, false on failure (with alert shown).
 */
export function importMermaidText(text) {
  if (!text || !text.trim()) { alert('Mermaid import failed: Empty input.'); return false; }
  const { title: fmTitle, body } = parseFrontmatter(text);
  const type = detectDiagramType(body);
  if (!type) { alert('Mermaid import failed: Could not detect a supported diagram type.'); return false; }

  let parsed;
  try {
    parsed = parseMermaid(body, type);
  } catch (err) {
    console.error('Mermaid parse error:', err);
    alert('Mermaid import failed: ' + err.message);
    return false;
  }
  if (!parsed || !parsed.elements || parsed.elements.length === 0) {
    alert('Mermaid import failed: no nodes found.');
    return false;
  }

  // Frontmatter title takes precedence; fall back to inline title, then default.
  const baseName = fmTitle || parsed.title || defaultTabName(parsed.diagramType);
  const tabName = dedupeTabName(baseName);
  modules.tabs.newTab(tabName, parsed.diagramType);

  // Build elements into the live graph of the freshly activated tab.
  modules.canvas.setLoadingJSON(true);
  try {
    const graph = modules.graph;
    graph.clear();

    // Create elements first (they reference each other by mermaid-id)
    const byId = new Map();
    let x = 0, y = 0;
    for (const el of parsed.elements) {
      const cell = createElementFromTemplate(el.template, { x, y });
      if (!cell) continue;
      if (el.size) cell.resize(el.size.width, el.size.height);
      graph.addCell(cell);
      byId.set(el.id, cell);
      x += 220; // arbitrary stagger — autoLayout will fix
      if (x > 1200) { x = 0; y += 160; }
    }

    // Links
    for (const lk of (parsed.links || [])) {
      const src = byId.get(lk.source);
      const tgt = byId.get(lk.target);
      if (!src || !tgt) continue;
      const link = buildLink(lk, src, tgt);
      if (link) graph.addCell(link);
    }

    // Migration hooks — keeps marker attrs consistent
    if (modules.canvas.migrateLinks) modules.canvas.migrateLinks();
    if (modules.canvas.migrateNodes) modules.canvas.migrateNodes();
  } finally {
    modules.canvas.setLoadingJSON(false);
  }

  // Auto-layout
  const direction = parsed.direction || 'horizontal';
  try {
    hierarchicalLayout(modules.graph, parsed, direction);
  } catch (err) {
    console.warn('hierarchicalLayout failed, falling back to canvas.autoLayout:', err);
    try { modules.canvas.autoLayout(direction); } catch {}
  }
  // After layout, snap link endpoints to the nearest side ports so the
  // router draws clean orthogonal connections into the element borders
  // rather than passing through their centers.
  snapLinksToPorts(modules.graph, direction);
  requestAnimationFrame(() => {
    try { modules.canvas.fitContent(); } catch {}
  });
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
    const sb = src.getBBox();
    const tb = tgt.getBBox();
    const dx = (tb.x + tb.width / 2) - (sb.x + sb.width / 2);
    const dy = (tb.y + tb.height / 2) - (sb.y + sb.height / 2);
    const srcIsDO = src.get('type') === 'sf.DataObject';
    const tgtIsDO = tgt.get('type') === 'sf.DataObject';
    let srcPort, tgtPort;
    // DataObject only has top/bottom static ports — never pick left/right.
    if (srcIsDO || tgtIsDO) {
      if (dy >= 0) { srcPort = 'port-bottom'; tgtPort = 'port-top'; }
      else         { srcPort = 'port-top';    tgtPort = 'port-bottom'; }
    } else {
      // Prefer the axis matching the layout direction so cross-layer edges
      // always exit on the "flow" side (e.g. vertical layout → top/bottom).
      // Fall back to the longer axis when direction isn't specified.
      let useVertical;
      if (direction === 'vertical') useVertical = Math.abs(dy) > 1;
      else if (direction === 'horizontal') useVertical = Math.abs(dx) <= 1;
      else useVertical = Math.abs(dy) > Math.abs(dx);
      if (useVertical) {
        if (dy >= 0) { srcPort = 'port-bottom'; tgtPort = 'port-top'; }
        else         { srcPort = 'port-top';    tgtPort = 'port-bottom'; }
      } else {
        if (dx >= 0) { srcPort = 'port-right'; tgtPort = 'port-left'; }
        else         { srcPort = 'port-left';  tgtPort = 'port-right'; }
      }
    }
    if (src.getPort?.(srcPort)) link.source({ id: src.id, port: srcPort });
    if (tgt.getPort?.(tgtPort)) link.target({ id: tgt.id, port: tgtPort });
  }
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
export function hierarchicalLayout(graph, _parsed, direction) {
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

function defaultTabName(type) {
  const names = {
    process: 'Imported Process',
    architecture: 'Imported Architecture',
    datamodel: 'Imported Data Model',
  };
  return names[type] || 'Imported Diagram';
}

// ─── Detection ─────────────────────────────────────────────────────────────

function detectDiagramType(text) {
  const lines = text.split('\n');
  for (let raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    // Skip directive blocks like %%{init: ...}%%
    if (/^flowchart(-elk)?\b/i.test(line)) return 'flowchart';
    if (/^graph\b/i.test(line))            return 'graph';
    if (/^stateDiagram(-v2)?\b/i.test(line)) return 'state';
    if (/^erDiagram\b/i.test(line))        return 'er';
    // gantt intentionally unsupported (removed in beta)
    // First non-empty line with none of the above → unsupported
    return null;
  }
  return null;
}

// ─── Top-level dispatch ────────────────────────────────────────────────────

function parseMermaid(text, kind) {
  // Strip %% comments and directive blocks
  const cleaned = stripComments(text);
  switch (kind) {
    case 'flowchart': return parseFlowchart(cleaned, 'process');
    case 'graph':     return parseFlowchart(cleaned, 'process');
    case 'state':     return parseStateDiagram(cleaned);
    case 'er':        return parseErDiagram(cleaned);
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

function parseFlowchart(text, targetType) {
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
        existing.template = flowTemplate(label, shape, targetType);
      }
      return existing;
    }
    const node = {
      id,
      label: label || id,
      shape,
      _labeled: !!label,
      template: flowTemplate(label || id, shape, targetType),
    };
    elementsById.set(id, node);
    return node;
  };

  // First line is the header (flowchart TD / graph LR) — skip
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && /^(flowchart|graph)/i.test(line)) continue;
    if (/^title\s+/i.test(line)) { title = line.replace(/^title\s+/i, '').trim(); continue; }
    if (/^(subgraph|end|direction|classDef|class|click|style|linkStyle)\b/i.test(line)) continue;

    // Parse links on this line (may contain multiple sequential: A --> B --> C)
    parseFlowLineEdges(line, ensureNode, links);
  }

  return {
    diagramType: targetType,
    title,
    direction,
    elements: [...elementsById.values()],
    links,
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

/** Build a template object for a flowchart node based on shape + target diagram type. */
function flowTemplate(label, shape, targetType) {
  if (targetType === 'architecture') {
    // Everything maps to SimpleNode in architecture
    return { type: 'sf.SimpleNode', label };
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

function parseStateDiagram(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const elementsById = new Map();
  const links = [];
  let title = null;

  let startId = null, endId = null;
  const getStart = () => {
    if (!startId) {
      startId = '__start__';
      elementsById.set(startId, { id: startId, label: '', template: { type: 'sf.BpmnEvent', label: '', eventType: 'start' } });
    }
    return startId;
  };
  const getEnd = () => {
    if (!endId) {
      endId = '__end__';
      elementsById.set(endId, { id: endId, label: '', template: { type: 'sf.BpmnEvent', label: '', eventType: 'end' } });
    }
    return endId;
  };
  const ensureState = (id) => {
    if (id === '[*]') return null;
    if (elementsById.has(id)) return elementsById.get(id);
    const node = { id, label: id, template: { type: 'sf.BpmnTask', label: id } };
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

function parseErDiagram(text) {
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
      template: {
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
    targetMarker = { type: 'path', d: 'M 0 0 L -12 0', fill: 'none', stroke: strokeColor, 'stroke-width': 2 };
  } else {
    targetMarker = { type: 'path', d: 'M 0 -6 L -14 0 L 0 6 z' };
  }

  // Source marker
  let sourceMarker;
  if (lk.erSource) {
    sourceMarker = erMarkerPath(lk.erSource, strokeColor);
  } else {
    sourceMarker = { type: 'path', d: 'M 0 0 L -12 0', fill: 'none', stroke: strokeColor, 'stroke-width': 2 };
  }

  const lineAttrs = {
    stroke: strokeColor,
    strokeWidth,
    sourceMarker,
    targetMarker,
  };
  if (dashArray) lineAttrs.strokeDasharray = dashArray;

  const link = new joint.shapes.standard.Link({
    source: { id: src.id },
    target: { id: tgt.id },
    attrs: { line: lineAttrs },
    router: { name: 'sfManhattan' },
    connector: { name: 'rounded', args: { radius: 8 } },
    z: 0,
  });

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

/** ER marker path spec matching js/properties.js definitions. */
function erMarkerPath(name, stroke) {
  const BG = 'var(--bg-canvas, #1A1A1A)';
  switch (name) {
    case 'one':
      return { type: 'path', d: 'M -12 -8 L -12 8 M -12 0 L 0 0', fill: 'none', stroke, 'stroke-width': 2 };
    case 'zeroOne':
      return { type: 'path', d: 'M 2 0 a 5 5 0 1 1 -10 0 a 5 5 0 1 1 10 0 Z M -8 0 L -12 0 M -12 -8 L -12 8', fill: BG, stroke, 'stroke-width': 2 };
    case 'many':
      return { type: 'path', d: 'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0', fill: 'none', stroke, 'stroke-width': 2 };
    case 'oneMany':
      return { type: 'path', d: 'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0 M 3 -8 L 3 8', fill: 'none', stroke, 'stroke-width': 2 };
    case 'zeroMany':
      return { type: 'path', d: 'M 4 0 a 5 5 0 1 1 10 0 a 5 5 0 1 1 -10 0 Z M -12 -8 L 0 0 M 0 0 L -12 8 M 0 0 L -12 0', fill: BG, stroke, 'stroke-width': 2 };
    case 'none':
    default:
      return { type: 'path', d: 'M 0 0 L -12 0', fill: 'none', stroke, 'stroke-width': 2 };
  }
}

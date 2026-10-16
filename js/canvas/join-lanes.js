// Join lanes in a Data Mapping (SQL Studio's lineage brief, owner decision 2026-10-16: option B). A lineage draws each
// join between two source tables as a grey relationship link on field ports, both ends on the same side of cards
// stacked in one column. Every such link turned 32 px out of its port, so all of them ran on one vertical and a
// reader could not tell which field joined which. Each BUS gets its own vertical instead: joins that share a field
// port are one bus (a composite key on a hub table reads as one line per key column, touching every table that
// joins on it), and buses whose vertical spans overlap take different lanes, 16 px apart, the shortest innermost so
// nested spans do not cross. Pure: the router draws the lanes, Auto Layout leaves room for them.

export const JOIN_LANE_GAP = 16;
const COLUMN_TOL = 64;   // cards whose outer edges are this close stand in one column

/**
 * items: [{ id, side: 'left' | 'right', edge, ports: [key, key], y1, y2 }] - one per join link. `edge` is the cards'
 * outer edge on that side (the smaller x for 'left'), `ports` the two port keys, y1 <= y2 the ports' heights.
 * Returns Map(id -> { lane, x }): x is the lane's vertical, `stub` px out from the column's outermost edge plus one
 * JOIN_LANE_GAP per lane. A column's lane count is max(lane) + 1 over its items.
 */
export function assignJoinLanes(items, { stub = 32, gap = JOIN_LANE_GAP } = {}) {
  const out = new Map();
  for (const side of ['left', 'right']) {
    const sideItems = items.filter((it) => it.side === side).sort((a, b) => a.edge - b.edge);
    // Columns: cards whose outer edges lie within COLUMN_TOL of the previous one's.
    const columns = [];
    for (const it of sideItems) {
      const col = columns[columns.length - 1];
      if (col && it.edge - col[col.length - 1].edge <= COLUMN_TOL) col.push(it); else columns.push([it]);
    }
    for (const col of columns) {
      const origin = side === 'left' ? Math.min(...col.map((it) => it.edge)) : Math.max(...col.map((it) => it.edge));
      // Buses: joins that share a port (union-find over the port keys).
      const parent = col.map((_, i) => i);
      const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      const byPort = new Map();
      col.forEach((it, i) => it.ports.forEach((k) => {
        if (byPort.has(k)) parent[find(i)] = find(byPort.get(k)); else byPort.set(k, i);
      }));
      const buses = new Map();
      col.forEach((it, i) => {
        const r = find(i);
        const b = buses.get(r) || { members: [], y1: Infinity, y2: -Infinity };
        b.members.push(it); b.y1 = Math.min(b.y1, it.y1); b.y2 = Math.max(b.y2, it.y2);
        buses.set(r, b);
      });
      // Lanes: shortest span innermost; each bus takes the innermost lane no overlapping bus holds (touching overlaps).
      const placed = [];
      const order = [...buses.values()].sort((a, b) => (a.y2 - a.y1) - (b.y2 - b.y1) || a.y1 - b.y1);
      for (const b of order) {
        let lane = 0;
        while (placed.some((p) => p.lane === lane && p.y1 <= b.y2 && b.y1 <= p.y2)) lane++;
        b.lane = lane; placed.push(b);
        const x = side === 'left' ? origin - stub - gap * lane : origin + stub + gap * lane;
        for (const m of b.members) out.set(m.id, { lane, x });
      }
    }
  }
  return out;
}

/** How many lanes a set of items needs on each side: { left, right }. 0 when none. */
export function joinLaneCounts(lanes, items) {
  const counts = { left: 0, right: 0 };
  for (const it of items) {
    const l = lanes.get(it.id);
    if (l) counts[it.side] = Math.max(counts[it.side], l.lane + 1);
  }
  return counts;
}

const sideOf = (port) => (/^(field-left-|er-left$)/.test(String(port || '')) ? 'left'
  : /^(field-right-|er-right$)/.test(String(port || '')) ? 'right' : null);

/** A DataObject port's height inside its card, from the JSON alone: the header is 32 px and each field row 22 px, the
 *  port at the row's middle; the header's er-left / er-right sit mid-header. Null for a collapsed or key-only card,
 *  whose rows the JSON does not settle. */
function portYInCard(card, port) {
  if (!card || card.type !== 'sf.DataObject' || card.collapsed || card.keyFieldsOnly) return null;
  if (port === 'er-left' || port === 'er-right') return 16;
  const m = /^field-(?:left|right)-(.+)$/.exec(String(port || ''));
  if (!m) return null;
  const i = (card.fields || []).findIndex((f) => f && f.fid === m[1]);
  return i < 0 ? null : 32 + i * 22 + 11;
}

/** The join links of a Data Mapping JSON, as assignJoinLanes items, grouped by the zone that holds both cards. */
export function joinItemsByZone(cells) {
  const byId = new Map(cells.filter((c) => c && c.id).map((c) => [c.id, c]));
  const out = new Map();
  for (const l of cells) {
    if (!l || l.type !== 'standard.Link' || l.linkKind === 'mapping' || l.router?.name !== 'sfManhattan' || (l.vertices || []).length) continue;
    const sc = byId.get(l.source?.id), tc = byId.get(l.target?.id);
    if (!sc || !tc || sc === tc || !sc.parent || sc.parent !== tc.parent) continue;
    const side = sideOf(l.source.port);
    if (!side || side !== sideOf(l.target.port)) continue;
    const sy = portYInCard(sc, l.source.port), ty = portYInCard(tc, l.target.port);
    if (sy == null || ty == null) continue;
    const sb = { x: sc.position.x, r: sc.position.x + sc.size.width }, tb = { x: tc.position.x, r: tc.position.x + tc.size.width };
    if (Math.max(sb.x, tb.x) >= Math.min(sb.r, tb.r)) continue;   // not one column
    const y1 = sc.position.y + sy, y2 = tc.position.y + ty;
    const item = { id: l.id, side, edge: side === 'left' ? Math.min(sb.x, tb.x) : Math.max(sb.r, tb.r),
      ports: [`${sc.id}::${l.source.port}`, `${tc.id}::${l.target.port}`], y1: Math.min(y1, y2), y2: Math.max(y1, y2) };
    if (!out.has(sc.parent)) out.set(sc.parent, []);
    out.get(sc.parent).push(item);
  }
  return out;
}

/** An imported Data Mapping (SQL Studio sends the standard 48 px of zone padding): grow each zone outward by the room
 *  its join lanes need, so the outer lanes draw inside the dashed border. The first lane fits the 48 px (32 px stub, 16
 *  clear); each further lane needs `gap` more. Cards stay where they are. Mutates the JSON zones; returns how many grew. */
export function widenZonesForJoinLanes(cells, { stub = 32, gap = JOIN_LANE_GAP, clear = 16 } = {}) {
  let grown = 0;
  const byId = new Map(cells.filter((c) => c && c.id).map((c) => [c.id, c]));
  for (const [zoneId, items] of joinItemsByZone(cells)) {
    const zone = byId.get(zoneId);
    if (!zone || zone.type !== 'sf.Zone' || !zone.position || !zone.size) continue;
    const counts = joinLaneCounts(assignJoinLanes(items, { stub, gap }), items);
    const left = items.filter((it) => it.side === 'left'), right = items.filter((it) => it.side === 'right');
    if (counts.left > 0) {
      const need = stub + clear + gap * (counts.left - 1);
      const have = Math.min(...left.map((it) => it.edge)) - zone.position.x;
      if (have < need) { zone.position.x -= need - have; zone.size.width += need - have; grown++; }
    }
    if (counts.right > 0) {
      const need = stub + clear + gap * (counts.right - 1);
      const have = zone.position.x + zone.size.width - Math.max(...right.map((it) => it.edge));
      if (have < need) { zone.size.width += need - have; grown++; }
    }
  }
  return grown;
}

/** The lanes the joins between `cardIds` need on each side, from a live graph (positions and port args as drawn):
 *  { left, right }. The zone fit reads it so a zone hugging its cards keeps room for them. */
export function liveJoinLaneCounts(graph, cardIds) {
  const ids = cardIds instanceof Set ? cardIds : new Set(cardIds);
  const portY = (cell, port) => (cell?.get('ports')?.items || []).find((q) => q.id === port)?.args?.y;
  const items = [];
  for (const l of graph.getLinks()) {
    if (l.get('linkKind') === 'mapping' || l.get('router')?.name !== 'sfManhattan' || (l.get('vertices') || []).length) continue;
    const s = l.get('source'), t = l.get('target');
    if (!ids.has(s?.id) || !ids.has(t?.id) || s.id === t.id) continue;
    const side = sideOf(s.port);
    if (!side || side !== sideOf(t.port)) continue;
    const sc = graph.getCell(s.id), tc = graph.getCell(t.id);
    const sy = portY(sc, s.port), ty = portY(tc, t.port);
    if (typeof sy !== 'number' || typeof ty !== 'number') continue;
    const sp = sc.position(), tp = tc.position(), sw = sc.size().width, tw = tc.size().width;
    if (Math.max(sp.x, tp.x) >= Math.min(sp.x + sw, tp.x + tw)) continue;   // not one column
    const y1 = sp.y + sy, y2 = tp.y + ty;
    items.push({ id: l.id, side, edge: side === 'left' ? Math.min(sp.x, tp.x) : Math.max(sp.x + sw, tp.x + tw),
      ports: [`${s.id}::${s.port}`, `${t.id}::${t.port}`], y1: Math.min(y1, y2), y2: Math.max(y1, y2) });
  }
  return joinLaneCounts(assignJoinLanes(items), items);
}

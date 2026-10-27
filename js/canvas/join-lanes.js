// Join lanes in a Data Mapping (SQL Studio's lineage brief, owner decision 2026-10-16: option B). A lineage draws each
// join between two source tables as a grey relationship link on field ports, both ends on the same side of cards
// stacked in one column. Every such link turned 32 px out of its port, so all of them ran on one vertical and a
// reader could not tell which field joined which. Each BUS gets its own vertical instead: joins that share a field
// port are one bus (a composite key on a hub table reads as one line per key column, touching every table that
// joins on it), and buses whose vertical spans overlap take different lanes, 16 px apart, the shortest innermost so
// nested spans do not cross. Pure: the router draws the lanes, Auto Layout leaves room for them.

import { JOIN_LANE_GAP, JOIN_COLUMN_TOL, joinPortSide, assignJoinLanes, joinLaneCounts, joinItemsByZone } from '../persistence/diagram-schema.js?v=1.26.5';

// The lane assignment for a Data Mapping column (assignJoinLanes, joinLaneCounts, joinItemsByZone) is pure and JSON-only,
// so it lives in diagram-schema.js, where the validator counts lanes too (2026-10-19). Re-exported for the app.
export { JOIN_LANE_GAP, assignJoinLanes, joinLaneCounts };
const COLUMN_TOL = JOIN_COLUMN_TOL;   // cards whose outer edges are this close stand in one column
const LEVEL_TOL = 4;     // two stubs closer than this in y read as one line
const sideOf = joinPortSide;

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

/**
 * Data model lanes (owner decision 2026-10-16, option C): every link between two cards whose ports face a gap, or sit
 * on one side of a column, is grouped into buses (links sharing a port). A bus runs on its own vertical next to its
 * ANCHOR - the end whose port carries the most links (the hub's key field) - so a composite key reads as one line per
 * key column. links: [{ id, ends: [{ key, edge, side: 'left' | 'right', y }, { ... }] }]: `edge` is the x of the
 * card edge the port sits on. Lanes start `stub` out of the anchor's edge, `gap` apart; when the opposite card stands
 * too close, the spacing shrinks to fit, down to 6 px, and below that the group keeps ordinary routes (no entry).
 * Returns Map(id -> { lane, x }).
 */
export function assignSideLanes(links, { stub = 32, gap = JOIN_LANE_GAP, clear = 8, minGap = 6 } = {}) {
  const out = new Map();
  const degree = new Map();
  for (const l of links) for (const e of l.ends) degree.set(e.key, (degree.get(e.key) || 0) + 1);
  const parent = links.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const byKey = new Map();
  links.forEach((l, i) => l.ends.forEach((e) => { if (byKey.has(e.key)) parent[find(i)] = find(byKey.get(e.key)); else byKey.set(e.key, i); }));
  const buses = new Map();
  links.forEach((l, i) => { const r = find(i); if (!buses.has(r)) buses.set(r, []); buses.get(r).push(l); });
  // Each bus: its anchor end (most links on its port; ties go to the first), direction and span.
  const items = [...buses.values()].map((members) => {
    let anchor = members[0].ends[0];
    for (const l of members) for (const e of l.ends) if (degree.get(e.key) > degree.get(anchor.key)) anchor = e;
    const dir = anchor.side === 'right' ? 1 : -1;
    const ys = members.flatMap((l) => l.ends.map((e) => e.y));
    // How far a lane may go: short of the stub of any far end that faces back across the gap.
    let limit = dir > 0 ? Infinity : -Infinity;
    for (const l of members) for (const e of l.ends) {
      if (e.key === anchor.key || e.side === anchor.side) continue;
      limit = dir > 0 ? Math.min(limit, e.edge - stub - clear) : Math.max(limit, e.edge + stub + clear);
    }
    return { members, anchor, dir, y1: Math.min(...ys), y2: Math.max(...ys), limit };
  });
  // Groups: one per side of one column (anchor edges within COLUMN_TOL, same direction).
  for (const dir of [1, -1]) {
    const its = items.filter((b) => b.dir === dir).sort((a, b) => a.anchor.edge - b.anchor.edge);
    const groups = [];
    for (const b of its) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(b.anchor.edge - g[g.length - 1].anchor.edge) <= COLUMN_TOL) g.push(b); else groups.push([b]);
    }
    for (const g of groups) {
      const origin = dir > 0 ? Math.max(...g.map((b) => b.anchor.edge)) : Math.min(...g.map((b) => b.anchor.edge));
      // Shortest bus innermost, with one order constraint: a bus whose far end sits level with another bus's end on
      // the anchor side runs outside it. Inside, its far stub ran along the other bus's anchor stub on one line (16 px
      // on MCE Mobile's _Subscribers after Auto Layout, where the second-level card is top-aligned with its table).
      const ysOn = (b, anchorSide) => b.members.flatMap((l) => l.ends.filter((e) => (e.side === b.anchor.side) === anchorSide).map((e) => e.y));
      const level = (ys, zs) => ys.some((y) => zs.some((z) => Math.abs(y - z) < LEVEL_TOL));
      const inside = new Map(g.map((b) => [b, g.filter((a) => a !== b && level(ysOn(b, false), ysOn(a, true)))]));
      const left = [...g].sort((a, c) => (a.y2 - a.y1) - (c.y2 - c.y1) || a.y1 - c.y1);
      const placed = [];
      while (left.length) {
        let i = left.findIndex((b) => inside.get(b).every((a) => !left.includes(a)));
        if (i < 0) i = 0;   // a cycle: the shortest goes first and one pair keeps the shared stub
        const b = left.splice(i, 1)[0];
        let lane = Math.max(0, ...inside.get(b).filter((a) => placed.includes(a)).map((a) => a.lane + 1));
        while (placed.some((p) => p.lane === lane && p.y1 <= b.y2 && b.y1 <= p.y2)) lane++;
        b.lane = lane; placed.push(b);
      }
      const n = Math.max(...g.map((b) => b.lane)) + 1;
      // One lane is today's trunk and bus (the 1.25.8 look, centred in the gap): lanes only where buses would share a line.
      if (n < 2) continue;
      const limit = dir > 0 ? Math.min(...g.map((b) => b.limit)) : Math.max(...g.map((b) => b.limit));
      const room = dir > 0 ? limit - (origin + stub) : (origin - stub) - limit;
      let step = gap;
      if (n > 1 && room < gap * (n - 1)) step = room / (n - 1);
      if (room < 0 || step < minGap) continue;   // no room: these keep ordinary routes
      for (const b of g) {
        const x = origin + dir * (stub + step * b.lane);
        for (const l of b.members) out.set(l.id, { lane: b.lane, x });
      }
    }
  }
  return out;
}

/**
 * Join colours (owner decision 2026-10-16, option C step 3): one colour per join field. links: [{ id, ends: [{ key, x,
 * y }, { ... }] }], the joins still drawn in the default grey, with `key` naming the field (one key for both sides of a
 * row). Joins that share a field are one bus, as for the lanes. Buses take `palette` in turn, top to bottom by their
 * busiest field (then left to right), so neighbouring key columns get neighbouring entries. Returns { colours:
 * Map(id -> colour), buses } or null under two buses (one colour tells the reader nothing grey did not).
 */
export function planJoinColours(links, palette) {
  if (!palette?.length || !links.length) return null;
  const parent = links.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const byKey = new Map();
  const degree = new Map();
  links.forEach((l, i) => l.ends.forEach((e) => {
    degree.set(e.key, (degree.get(e.key) || 0) + 1);
    if (byKey.has(e.key)) parent[find(i)] = find(byKey.get(e.key)); else byKey.set(e.key, i);
  }));
  const buses = new Map();
  links.forEach((l, i) => { const r = find(i); if (!buses.has(r)) buses.set(r, []); buses.get(r).push(l); });
  if (buses.size < 2) return null;
  const ordered = [...buses.entries()].map(([first, members]) => {
    let anchor = members[0].ends[0];
    for (const l of members) for (const e of l.ends) if (degree.get(e.key) > degree.get(anchor.key)) anchor = e;
    return { first, members, anchor };
  }).sort((a, b) => (a.anchor.y - b.anchor.y) || (a.anchor.x - b.anchor.x) || (a.first - b.first));
  const colours = new Map();
  ordered.forEach((b, i) => { for (const l of b.members) colours.set(l.id, palette[i % palette.length]); });
  return { colours, buses: ordered.length };
}

// Global bus routing — DRAFT, behind a flag (default OFF). js/canvas/bus-routing.js
//
// THE PROBLEM it targets: a HUB FAN — one orthogonal field port that feeds many targets (e.g. a PK that maps to
// N foreign keys stacked down the next column) — today fans into N near-parallel connectors that pile up. The
// past "spacing lever" attempt proved adding room makes this router WORSE; the fix must be ALIGNMENT. So this
// pass collapses each hub fan onto ONE shared vertical TRUNK in the corridor: every member exits the source,
// rides the same trunk x, then taps off horizontally to its own target row. N piled diagonals become one bus.
//
// HARD SCOPE (locked with the user): ORTHOGONAL sfManhattan links ONLY. Mapping connectors (`linkKind:'mapping'`,
// the bezier sfMappingConnector) are NEVER touched — they use a different router and are explicitly excluded
// here too. Self-loops, manual-vertex links, and non-field-anchored links are skipped.
//
// Integration: a per-graph memoised plan (Map<linkId, trunkX>), built lazily, invalidated on graph change
// (mirrors crossing-bumps' lifecycle). The sfManhattan router consults busTrunkXForLink() per link and, when it
// returns a trunk x, emits [source -> (trunkX, srcY) -> (trunkX, tgtY) -> target] as the route (the existing
// manual-vertices path shape). When the flag is OFF the function returns null for every link → zero behaviour
// change, so it can be A/B'd before any promotion.

const STUB = 32;            // must match the router's STUB (port -> first turn)
const CHANNEL_HEIGHT = 16;  // distinct trunks in one corridor sit this far apart (alignment, NOT widening a fan)
const MIN_FAN = 3;          // only consolidate a port that feeds >= this many targets (a real hub)

const FLAG_KEY = 'sfdiag::busRouting';
export function isBusRoutingEnabled() { try { return localStorage.getItem(FLAG_KEY) === '1'; } catch { return false; } }
export function setBusRoutingEnabled(on) { try { localStorage.setItem(FLAG_KEY, on ? '1' : '0'); } catch { /* private mode */ } }

let _rev = 0;
let _cache = { rev: -1, graph: null, plan: null };

/** Bind invalidation listeners once per graph (called from canvas.init). Any structural change bumps a revision
 *  counter; the plan rebuilds lazily on the next router call. Same signal set as crossing-bumps. */
export function registerBusRouting(graph) {
  if (!graph) return;
  graph.on('add remove change:source change:target change:position change:size reset', () => { _rev++; });
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const isMapping = (l) => { try { return l.prop && l.prop('linkKind') === 'mapping'; } catch { return false; } };

function buildPlan(graph) {
  const trunkByLink = new Map();
  // 1. Bucket eligible links by their SOURCE field port (the hub key). Eligible = orthogonal (never mapping),
  //    left-to-right field connection (source field-right-* -> target field-left-*), both ends resolvable.
  const hubs = new Map();
  for (const l of graph.getLinks()) {
    if (isMapping(l)) continue;                                  // NEVER touch mapping connectors
    const s = l.get('source'), t = l.get('target');
    if (!s || !t || !s.id || !t.id) continue;
    if (typeof s.port !== 'string' || typeof t.port !== 'string') continue;
    if (!s.port.startsWith('field-right-') || !t.port.startsWith('field-left-')) continue;
    const key = `${s.id}::${s.port}`;
    let hub = hubs.get(key);
    if (!hub) hubs.set(key, hub = { sourceId: s.id, links: [] });
    hub.links.push(l);
  }
  // 2. Per source cell (corridor = its right edge), keep only real hubs (fan >= MIN_FAN), measure their fan.
  const byCorridor = new Map();
  for (const hub of hubs.values()) {
    if (hub.links.length < MIN_FAN) continue;
    const cell = graph.getCell(hub.sourceId); if (!cell) continue;
    const bb = cell.getBBox(); if (!bb) continue;
    hub.rightEdge = bb.x + bb.width;
    const tys = [], tlefts = [];
    for (const l of hub.links) { const tc = graph.getCell(l.get('target').id); if (tc) { const tb = tc.getBBox(); if (tb) { tys.push(tb.y + tb.height / 2); tlefts.push(tb.x); } } }
    hub.meanTargetY = mean(tys);
    hub.minTargetLeft = tlefts.length ? Math.min(...tlefts) : Infinity;
    const corr = Math.round(hub.rightEdge);
    let list = byCorridor.get(corr); if (!list) byCorridor.set(corr, list = []);
    list.push(hub);
  }
  // 3. Within a corridor, order hubs by mean target Y (closest child -> closest trunk, the router's existing
  //    ordering rule) and assign each ONE trunk x on a CHANNEL_HEIGHT grid just past the source edge. Clamp so
  //    a trunk never lands inside a target cell; skip a hub with no room rather than force a bad route.
  for (const list of byCorridor.values()) {
    list.sort((a, b) => a.meanTargetY - b.meanTargetY);
    list.forEach((hub, i) => {
      let trunkX = hub.rightEdge + STUB + i * CHANNEL_HEIGHT;
      if (Number.isFinite(hub.minTargetLeft)) trunkX = Math.min(trunkX, hub.minTargetLeft - STUB);
      if (trunkX <= hub.rightEdge + 1) return;   // corridor too narrow for a trunk - leave to the normal router
      for (const l of hub.links) trunkByLink.set(l.id, trunkX);
    });
  }
  return { trunkByLink };
}

function getBusPlan(graph) {
  if (_cache.rev !== _rev || _cache.graph !== graph) _cache = { rev: _rev, graph, plan: buildPlan(graph) };
  return _cache.plan;
}

/** The shared trunk x for a hub-member link, or null when: the flag is off, the link isn't a hub member, or it's
 *  a mapping/ineligible link. The router builds [from -> (trunkX, from.y) -> (trunkX, to.y) -> to] from this. */
export function busTrunkXForLink(graph, link) {
  if (!isBusRoutingEnabled() || !graph || !link) return null;
  const x = getBusPlan(graph).trunkByLink.get(link.id);
  return x == null ? null : x;
}

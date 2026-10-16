// The connectors under the pointer on a shared trunk (owner, 2026-10-16). Links leaving one port share a trunk and
// split near their targets, so a pointer on the trunk is over several connectors at once, and the hover halo lit only
// the one drawn on top: on a hub's JobID trunk it showed a single table, as if the trunk led nowhere else. The rule is
// "every connector under the pointer": on a trunk that is the whole bus, on a branch one link. A crossing is not a
// shared run (the other line is perpendicular), and lanes 16 px apart are separate runs. Pure: selection-viz.js feeds
// it the rendered polylines.

/** Distance from p to the segment a-b. */
function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * polylines: Map(id -> [{x, y}, ...]) of each link's rendered path (source point, route, target point). Returns the
 * ids of the OTHER links with a horizontal or vertical run on the same line as the hovered link's segment nearest `p`,
 * covering the point of that segment under `p` (within `tol` px). A diagonal segment shares nothing.
 */
export function linksOnRunAt(polylines, id, p, tol = 1) {
  const own = polylines.get(id);
  if (!own || own.length < 2 || !p) return [];
  let best = null;
  for (let i = 0; i + 1 < own.length; i++) {
    const d = distToSegment(p, own[i], own[i + 1]);
    if (!best || d < best.d) best = { a: own[i], b: own[i + 1], d };
  }
  const { a, b } = best;
  const horiz = Math.abs(a.y - b.y) <= tol && Math.abs(a.x - b.x) > tol;
  const vert = Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) > tol;
  if (!horiz && !vert) return [];
  const clamp = (v, lo, hi) => Math.max(Math.min(lo, hi), Math.min(Math.max(lo, hi), v));
  const q = horiz ? { x: clamp(p.x, a.x, b.x), y: a.y } : { x: a.x, y: clamp(p.y, a.y, b.y) };
  const out = [];
  for (const [other, pts] of polylines) {
    if (other === id || !pts || pts.length < 2) continue;
    for (let i = 0; i + 1 < pts.length; i++) {
      const c = pts[i], d = pts[i + 1];
      const on = horiz
        ? Math.abs(c.y - d.y) <= tol && Math.abs(c.y - q.y) <= tol && q.x >= Math.min(c.x, d.x) - tol && q.x <= Math.max(c.x, d.x) + tol
        : Math.abs(c.x - d.x) <= tol && Math.abs(c.x - q.x) <= tol && q.y >= Math.min(c.y, d.y) - tol && q.y <= Math.max(c.y, d.y) + tol;
      if (on) { out.push(other); break; }
    }
  }
  return out;
}

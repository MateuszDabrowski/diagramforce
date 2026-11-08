// df.Venn region model - the pure rules behind the Venn shape (js/shapes/venn.js), its panel
// (js/properties/renderers-venn.js) and the spec. Zero-dep leaf: no DOM, no graph, so it is unit-tested directly
// (dev/tests/venn-model.test.js).
//
// A Venn has 2 or 3 sets, A / B / C in order. A REGION is the area inside exactly some of the sets, named by their
// letters: 'A' is A only, 'AB' is A and B but not C, 'ABC' is all three. Two sets have 3 regions, three have 7.
// A Venn shows one of two things (`vennMode`, owner review 2026-11-08 - one panel for both read as tangled):
//   'join'      the rows a SQL join returns, drawn as circles: `joins` (one join type per pair of tables, read left to
//               right) fill the regions the join keeps, in one colour. Coloured means returned; nothing else is marked
//               (an EXCLUDING join's dropped overlap was grey at first - a second colour to decode, owner review).
//   'overlaps'  what the sets have in common, drawn as ellipses: each overlap can carry text, and any region - a set's
//               own area included - can be highlighted ('on', or any hex).
// A set's own area always shows the set's name. Each mode keeps the other's settings, so switching loses nothing.

export const SET_LETTERS = ['A', 'B', 'C'];

/** Region keys for `n` sets, singles first, then pairs, then the triple. */
export function regionKeys(n) {
  return n === 3 ? ['A', 'B', 'C', 'AB', 'AC', 'BC', 'ABC'] : ['A', 'B', 'AB'];
}

// SQL joins as predicates over "is the row in the left side" (x) and "in the right side" (y). An EXCLUDING join is
// the LEFT / RIGHT / FULL join with `WHERE <other side> IS NULL`: it keeps one side's unmatched rows only.
export const JOINS = Object.freeze(Object.assign(Object.create(null), {
  inner:          { label: 'INNER JOIN',           keep: (x, y) => x && y },
  left:           { label: 'LEFT JOIN',            keep: (x) => x },
  right:          { label: 'RIGHT JOIN',           keep: (x, y) => y },
  full:           { label: 'FULL JOIN',            keep: (x, y) => x || y },
  leftExcluding:  { label: 'LEFT EXCLUDING JOIN',  keep: (x, y) => x && !y },
  rightExcluding: { label: 'RIGHT EXCLUDING JOIN', keep: (x, y) => y && !x },
  fullExcluding:  { label: 'FULL EXCLUDING JOIN',  keep: (x, y) => x !== y },
}));

/** The regions a `joins` list fills: { key: 'on' } for every region the join returns. Joins read left to right:
 *  (A join1 B) join2 C. They apply in order up to the first one not picked, so three sets with only the first join
 *  show that join's result whatever the third set holds - step 1 of a three-table join (the owner's cheat sheet; the
 *  first version decided nothing until both were picked). No first join, or an unknown join type among the ones
 *  applied, fills nothing. */
export function joinRegions(joins, n) {
  const list = (Array.isArray(joins) ? joins : []).slice(0, n - 1);
  const missing = list.findIndex((j) => !j);
  const applied = missing < 0 ? list : list.slice(0, missing);
  if (!applied.length || applied.some((j) => !JOINS[j])) return {};
  const out = {};
  for (const key of regionKeys(n)) {
    const inSet = SET_LETTERS.slice(0, n).map((l) => key.includes(l));
    let keep = inSet[0];
    for (let i = 1; i <= applied.length; i++) keep = JOINS[applied[i - 1]].keep(keep, inSet[i]);
    if (keep) out[key] = 'on';
  }
  return out;
}

/** The mode a Venn shows: its `vennMode`, or, when that is missing (an authored file), 'join' if it has joins. */
export function vennModeOf({ mode, joins }) {
  if (mode === 'join' || mode === 'overlaps') return mode;
  return Array.isArray(joins) && joins.some(Boolean) ? 'join' : 'overlaps';
}

/** The outline a mode draws (owner review, 2026-11-08: one choice fewer): a join's circles, as in a SQL cheat sheet;
 *  overlaps' ellipses, which fit longer names and can leave the centre open. */
export const vennShapeFor = (mode) => (mode === 'join' ? 'circles' : 'ellipses');

const isHex = (v) => /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(v || ''));
/** What a region shows: 'on' (the highlight colour), a hex, or 'none'. A join decides every region; overlaps fill
 *  only the regions highlighted by hand, a set's own area included. */
export function regionFill(key, { regions, joins, n, mode }) {
  if (vennModeOf({ mode, joins }) === 'join') return joinRegions(joins, n)[key] || 'none';
  const own = regions?.[key]?.fill;
  return own === 'on' || isHex(own) ? own : 'none';
}

// Set outlines in a unit space, fitted uniformly into the shape's box. `ellipses` with three sets is the petal
// layout: each ellipse lies along one side of a triangle and crosses the other two near the corners. Two shapes:
// - a SHARED centre (the default): 1 long, 0.74 wide, centres pulled in to 0.8 of the side midpoints. Measured at
//   360 x 300 as the room at each area's roomiest point (owner, 2026-11-08: a value in the centre - "Diagramforce"
//   where Diagrams, Salesforce and Free meet - spilled over the outlines): set areas 38 px, pairs 50, centre 45. The
//   first shape (1.15 x 0.56 at the midpoints) left the centre 8 px; 0.8 wide gave 50 but read as circles.
// - an OPEN centre (`sharedCentre: false`, the owner's petal picture): 1.15 x 0.42 at the side midpoints. The
//   triangle's centre is 0.5 from each side, so 0.42 leaves it outside all three: each pair overlaps, nothing lies
//   in all three.
// Circles get no open-centre option: three equal circles share no centre only when their centres are over sqrt(3)
// radii apart, which leaves each pair an overlap at most 0.27 of a radius wide, too thin for a label.
const SQRT3 = Math.sqrt(3);
const UNIT = Object.assign(Object.create(null), {
  circles2:  [{ cx: -0.62, cy: 0, rx: 1, ry: 1, rot: 0 }, { cx: 0.62, cy: 0, rx: 1, ry: 1, rot: 0 }],
  ellipses2: [{ cx: -0.55, cy: 0, rx: 1.25, ry: 0.8, rot: 0 }, { cx: 0.55, cy: 0, rx: 1.25, ry: 0.8, rot: 0 }],
  circles3:  [{ cx: -0.6, cy: -0.35, rx: 1, ry: 1, rot: 0 }, { cx: 0.6, cy: -0.35, rx: 1, ry: 1, rot: 0 },
              { cx: 0, cy: 0.6, rx: 1, ry: 1, rot: 0 }],
  ellipses3: [{ cx: -SQRT3 / 4 * 0.8, cy: -0.25 * 0.8, rx: 1, ry: 0.74, rot: -60 }, { cx: SQRT3 / 4 * 0.8, cy: -0.25 * 0.8, rx: 1, ry: 0.74, rot: 60 },
              { cx: 0, cy: 0.5 * 0.8, rx: 1, ry: 0.74, rot: 0 }],
  ellipses3open: [{ cx: -SQRT3 / 4, cy: -0.25, rx: 1.15, ry: 0.42, rot: -60 }, { cx: SQRT3 / 4, cy: -0.25, rx: 1.15, ry: 0.42, rot: 60 },
              { cx: 0, cy: 0.5, rx: 1.15, ry: 0.42, rot: 0 }],
});

/** Whether a layout has no region shared by all three sets: three ellipses with `sharedCentre: false`. */
export const hasOpenCentre = (shape, n, sharedCentre) => n === 3 && shape === 'ellipses' && sharedCentre === false;
/** The regions a layout can draw: every region, less the all-three one when the centre is open. */
export function layoutRegionKeys(shape, n, sharedCentre) {
  return regionKeys(n).filter((k) => !(k === 'ABC' && hasOpenCentre(shape, n, sharedCentre)));
}
const MARGIN = 4;   // room for the outline stroke inside the box

/** The set outlines for a w x h box: [{ cx, cy, rx, ry, rot }] in local px, rot in degrees. */
export function vennGeometry(shape, n, w, h, { sharedCentre = true } = {}) {
  const unit = hasOpenCentre(shape, n, sharedCentre) ? UNIT.ellipses3open
    : UNIT[`${shape === 'ellipses' ? 'ellipses' : 'circles'}${n === 3 ? 3 : 2}`];
  // A rotated ellipse's half extents along x and y.
  const half = (e) => {
    const t = (e.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    return [Math.hypot(e.rx * c, e.ry * s), Math.hypot(e.rx * s, e.ry * c)];
  };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of unit) {
    const [hx, hy] = half(e);
    x0 = Math.min(x0, e.cx - hx); x1 = Math.max(x1, e.cx + hx);
    y0 = Math.min(y0, e.cy - hy); y1 = Math.max(y1, e.cy + hy);
  }
  const k = Math.max(0, Math.min((w - 2 * MARGIN) / (x1 - x0), (h - 2 * MARGIN) / (y1 - y0)));
  const ox = w / 2 - ((x0 + x1) / 2) * k, oy = h / 2 - ((y0 + y1) / 2) * k;
  return unit.map((e) => ({ cx: ox + e.cx * k, cy: oy + e.cy * k, rx: e.rx * k, ry: e.ry * k, rot: e.rot }));
}

const inside = (e, x, y) => {
  const t = (-e.rot * Math.PI) / 180, dx = x - e.cx, dy = y - e.cy;
  const u = dx * Math.cos(t) - dy * Math.sin(t), v = dx * Math.sin(t) + dy * Math.cos(t);
  return (u / e.rx) ** 2 + (v / e.ry) ** 2 <= 1;
};

/** The region key at a local point, or null outside every set. */
export function regionAt(x, y, geom) {
  const key = geom.map((e, i) => (e.rx > 0 && inside(e, x, y) ? SET_LETTERS[i] : '')).join('');
  return key || null;
}

/** A label point per region: the grid cell farthest from the region's edge (a chamfer distance transform over a grid
 *  of about 48 cells on the long side), so a label sits in the roomiest part of an irregular region. Returns
 *  { key: { x, y, room } }, `room` being that distance in px; a region too small to sample is left out. */
export function regionAnchors(geom, w, h) {
  const step = Math.max(w, h) / 48;
  const cols = Math.max(1, Math.round(w / step)), rows = Math.max(1, Math.round(h / step));
  const key = [], dist = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    key[r * cols + c] = regionAt((c + 0.5) * (w / cols), (r + 0.5) * (h / rows), geom);
  }
  // Distance (in cells) to the nearest cell of another region or the box edge: two chamfer passes, 1 / 1.4.
  const BIG = 1e9;
  for (let i = 0; i < key.length; i++) dist[i] = key[i] ? BIG : 0;
  const relax = (r, c, dr, dc, cost) => {
    const rr = r + dr, cc = c + dc, i = r * cols + c;
    const d = rr < 0 || rr >= rows || cc < 0 || cc >= cols ? cost : (key[rr * cols + cc] === key[i] ? dist[rr * cols + cc] + cost : cost);
    if (d < dist[i]) dist[i] = d;
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (key[r * cols + c]) {
    relax(r, c, 0, -1, 1); relax(r, c, -1, 0, 1); relax(r, c, -1, -1, 1.4); relax(r, c, -1, 1, 1.4);
  }
  for (let r = rows - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) if (key[r * cols + c]) {
    relax(r, c, 0, 1, 1); relax(r, c, 1, 0, 1); relax(r, c, 1, 1, 1.4); relax(r, c, 1, -1, 1.4);
  }
  const best = {};
  for (let i = 0; i < key.length; i++) {
    const k = key[i];
    if (k && (!best[k] || dist[i] > best[k].d)) best[k] = { d: dist[i], i };
  }
  // A symmetric region has its farthest cells in tied pairs either side of its axis, and taking the first left the
  // label half a cell off-centre ("webinar" under three circles; owner, 2026-11-08). Average the tied cells, unless
  // they are apart and their mean falls outside the region (a crescent's two horns), then keep the first.
  const cellX = (i) => ((i % cols) + 0.5) * (w / cols), cellY = (i) => (Math.floor(i / cols) + 0.5) * (h / rows);
  const out = {};
  for (const [k, { d, i }] of Object.entries(best)) {
    let sx = 0, sy = 0, count = 0;
    for (let j = 0; j < key.length; j++) if (key[j] === k && Math.abs(dist[j] - d) < 1e-9) { sx += cellX(j); sy += cellY(j); count++; }
    const mean = { x: sx / count, y: sy / count };
    const at = regionAt(mean.x, mean.y, geom) === k ? mean : { x: cellX(i), y: cellY(i) };
    out[k] = { ...at, room: d * step };
  }
  return out;
}

/** A set's name for people, on one line: its label without `**` or line breaks, or "Set 2" when it has none. */
export function setDisplayName(sets, i) {
  return String(sets[i]?.label || '').replace(/\*\*/g, '').replace(/\s*\n\s*/g, ' ').trim() || `Set ${i + 1}`;
}

/** A region's name for people: "sub only", "sub + de", "Set 1 + Set 2 + Set 3". */
export function regionName(key, sets) {
  const names = [...key].map((l) => setDisplayName(sets, SET_LETTERS.indexOf(l)));
  return names.length === 1 ? `${names[0]} only` : names.join(' + ');
}

/** The stencil default and the fallback for a missing prop. Colours from the both-themes palette
 *  (persistence/diagram-palette.js): blue, orange, purple. */
export const VENN_DEFAULT_SETS = [
  { label: 'A', color: '#1D73C9' }, { label: 'B', color: '#BE5C2A' }, { label: 'C', color: '#B652A7' },
];
export const VENN_HIGHLIGHT = '#DA4E55';

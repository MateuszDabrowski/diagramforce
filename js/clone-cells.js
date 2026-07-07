// Clone-cells-for-insert (CLEANUP V7) — the ONE JSON-level "deep-copy these cells with fresh ids" step shared by
// the clipboard paste and the template drop. Both need: mint a new id for every cell, rewrite intra-selection
// references (link source/target, and parent/embeds when grouping is kept) to those new ids, and offset the whole
// group by a delta. They had diverged: paste hand-harvested the new ids via a temporary graph 'add' listener and
// always DROPPED parent/embeds; instantiateTemplate pre-minted an idMap and REMAPPED them. This is templates.js's
// (more complete) version, generalised with a `keepContainment` switch so each caller keeps its CURRENT behaviour.
//
// Zero-dep leaf (no graph / no history / no selection — the caller owns addCells, the undo batch, and selection),
// so the id-regeneration + containment + offset logic is unit-tested directly (dev/tests/clone-cells.test.js).

/** Fresh cell ID — JointJS uuid when available, else crypto / random fallback. Uses `globalThis` (not `window`)
 *  so it also works under Node for the unit tests; in the browser `globalThis === window`. */
export function newCellId() {
  try {
    if (typeof joint !== 'undefined' && joint.util?.uuid) return joint.util.uuid();
  } catch { /* fall through */ }
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'pat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * Deep-clone an array of cell JSON snapshots (elements and/or links) for insertion into the graph, giving each a
 * fresh id. Returns `{ clones, idMap }` — the caller does `graph.addCells(clones)` (inside its own history batch)
 * and owns selection. Pure: never touches the graph.
 *
 * - Every cell with an id gets a freshly-minted one; the map is built UP FRONT so links (and parent/embeds) can
 *   reference the new ids regardless of array order.
 * - Link `source.id` / `target.id` are always remapped through the idMap (so a pasted/dropped connector wires to
 *   the new copies, not the originals). An endpoint id not in the map is left as-is (self-contained selections
 *   never hit this: copy() only stores links whose BOTH ends are selected).
 * - `keepContainment: true` remaps `parent` (dropped if its parent isn't in the set) and filters `embeds` through
 *   the idMap → the group survives the copy (template drop). `false` DELETES both → the copy is flat/un-grouped
 *   (paste: copy() only snapshots the selected elements, not a container's unselected children, so a remapped
 *   parent could dangle — dropping is the load-bearing choice).
 * - `dx` / `dy` offset each cell's `position` and every link `vertex`.
 *
 * @param {object[]} cells - cell JSON snapshots (from toJSON() or a template); elements should precede links.
 * @param {{ dx?: number, dy?: number, keepContainment?: boolean }} [opts]
 * @returns {{ clones: object[], idMap: Map<any, any> }}
 */
export function cloneCellsForInsert(cells, { dx = 0, dy = 0, keepContainment = false } = {}) {
  const idMap = new Map();
  cells.forEach((c) => { if (c && c.id != null) idMap.set(c.id, newCellId()); });

  const clones = cells.map((json) => {
    const clone = JSON.parse(JSON.stringify(json));
    clone.id = idMap.get(json.id) || newCellId();

    if (keepContainment) {
      if (clone.parent) {
        const np = idMap.get(clone.parent);
        if (np) clone.parent = np; else delete clone.parent;
      }
      if (Array.isArray(clone.embeds)) {
        clone.embeds = clone.embeds.map((e) => idMap.get(e)).filter(Boolean);
      }
    } else {
      delete clone.parent;
      delete clone.embeds;
    }

    if (clone.source?.id) {
      const ns = idMap.get(clone.source.id);
      if (ns) clone.source = { ...clone.source, id: ns };
    }
    if (clone.target?.id) {
      const nt = idMap.get(clone.target.id);
      if (nt) clone.target = { ...clone.target, id: nt };
    }

    if (clone.position) clone.position = { x: clone.position.x + dx, y: clone.position.y + dy };
    if (Array.isArray(clone.vertices)) {
      clone.vertices = clone.vertices.map((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
    return clone;
  });

  return { clones, idMap };
}

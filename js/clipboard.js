// Clipboard — copy, paste, and duplicate selected elements

import * as history from './history.js?v=1.26.1';
import { cloneCellsForInsert } from './clone-cells.js?v=1.26.1';
import { reslotInsertedGanttBars, reslotClonedGanttItem } from './gantt-layout.js?v=1.26.1';

const reslotGanttClones = (clones) => reslotInsertedGanttBars(graph, clones);   // see gantt-layout.js

// Length (in px) of the "stub" used when a cloned connector dangles —
// keeps the free endpoint a comfortable, predictable distance from the
// cloned component instead of trailing off toward the original peer.
const DANGLING_STUB_LENGTH = 100;

let graph, paper, selection;
let clipboardCells = []; // Array of element JSON snapshots
let clipboardLinks = []; // Array of link JSON snapshots between copied elements
let pasteOffset = 0;    // Increments each paste to offset position

export function init(_graph, _paper, _selection) {
  graph = _graph;
  paper = _paper;
  selection = _selection;
}

/** True when there's something to paste — drives the canvas right-click "Paste" enabled state. */
export function hasClipboard() { return clipboardCells.length > 0; }

/** The ids of `roots` plus every embedded descendant ELEMENT (a grouper brings its whole subtree; link ids in `embeds`
 *  are skipped). The one expansion copy, duplicate and every Clone path share, so they always copy the same set. */
function withDescendants(roots) {
  const ids = new Set(roots.map(el => el.id));
  const add = (id) => {
    for (const childId of (graph.getCell(id)?.get('embeds') || [])) {
      const child = graph.getCell(childId);
      if (child?.isElement?.() && !ids.has(childId)) { ids.add(childId); add(childId); }
    }
  };
  roots.forEach(el => add(el.id));
  return ids;
}

/** Clone `roots` with their subtrees and every link whose both ends are in that set, offset by dx/dy, and add them to
 *  the graph: the step duplicate() and every Clone path share. Containment is remapped through the copy
 *  (keepContainment), so a cloned Zone keeps its children embedded; a root's own parent is not in the set and is
 *  dropped. A cloned Gantt bar, milestone or marker re-binds to its source's timeline (reslotClonedGanttItem: with
 *  two timelines the fallback in ganttTimelineFor finds none). Every touched timeline re-slots its rows, so a bar copy
 *  takes its own row; a milestone or marker copy is dated where it lands, on that column and a row centre. Panel and right-click Clone used to strip parent/embeds and copy no children, so a Zone cloned to an empty
 *  shell while Cmd+D on it copied everything inside (owner call 2026-10-15). The caller owns the history batch and
 *  the selection. Returns the idMap (old id -> new id) and the ids of the links cloned with it. */
function insertSubtreeClones(roots, { dx = 0, dy = 0 } = {}) {
  const expanded = withDescendants(roots);
  const innerLinks = graph.getLinks().filter(l => expanded.has(l.get('source')?.id) && expanded.has(l.get('target')?.id));
  const { clones, idMap } = cloneCellsForInsert(
    [...[...expanded].map(id => graph.getCell(id).toJSON()), ...innerLinks.map(l => l.toJSON())],
    { dx, dy, keepContainment: true });
  graph.addCells(clones);
  for (const root of roots) reslotClonedGanttItem(root, graph.getCell(idMap.get(root.id)));
  reslotGanttClones(clones);
  return { idMap, innerLinkIds: new Set(innerLinks.map(l => l.id)) };
}

export function copy() {
  const selected = selection.getSelectedElements().filter(c => c.isElement());
  if (selected.length === 0) return;
  // Expand to include the embedded DESCENDANTS of any selected grouper (Container / Zone / Pool / …), so
  // copying a lone-selected grouper captures its whole subtree instead of an empty shell — the reported
  // "click a Zone, Ctrl+C/V pastes an empty box" bug. Selecting a grouper puts only IT in selectedIds
  // (children aren't auto-selected), so without this the clipboard held just the grouper. Recursive →
  // nested groupers; link ids in `embeds` are skipped (the endpoint pass below re-copies links). A marquee that
  // already selected the children directly still works — they're in the set.
  const elementIds = withDescendants(selected);
  clipboardCells = [...elementIds].map(id => graph.getCell(id).toJSON());

  // Copy every link whose BOTH endpoints are in the (expanded) set — captures a grouper's internal links too.
  clipboardLinks = [];
  graph.getLinks().forEach(link => {
    const srcId = link.get('source')?.id;
    const tgtId = link.get('target')?.id;
    if (srcId && tgtId && elementIds.has(srcId) && elementIds.has(tgtId)) {
      clipboardLinks.push(link.toJSON());
    }
  });

  pasteOffset = 0;
}

export function paste() {
  if (clipboardCells.length === 0) return;
  pasteOffset += 24;

  selection.clearSelection();

  // Clone every copied element + link with fresh, PRE-MINTED ids (V7 shared helper) — links rewire to the new
  // element ids, positions/vertices shift by pasteOffset. keepContainment:true remaps parent/embeds THROUGH the
  // idMap, so a copied grouper's descendants re-embed into the CLONED grouper (copy() now snapshots the whole
  // subtree). A child whose parent wasn't copied has its parent dropped (cloneCellsForInsert guards the dangle),
  // so a partial marquee still pastes those as free cells. Elements first so links resolve endpoints in the one
  // addCells batch.
  const { clones } = cloneCellsForInsert([...clipboardCells, ...clipboardLinks],
    { dx: pasteOffset, dy: pasteOffset, keepContainment: true });

  // One undo step for the whole paste — addCells composites every clone so a single Cmd+Z removes the entire paste.
  history.startBatch();
  try {
    graph.addCells(clones);
    reslotGanttClones(clones);
    // Select the pasted ELEMENTS only (the idMap now covers link ids too); links carry source/target in their JSON.
    selection.selectMany(clones.filter(c => !(c.source || c.target)).map(c => c.id));
  } finally {
    history.endBatch();
  }
}

export function duplicate() {
  const allCells = selection.getSelectedElements();
  const elements = allCells.filter(c => c.isElement());
  const selectedLinks = allCells.filter(c => c.isLink());
  if (elements.length === 0 && selectedLinks.length === 0) return;
  const elementIds = new Set(elements.map(el => el.id));

  selection.clearSelection();

  // Duplicate = paste in place, +24px, through insertSubtreeClones: a grouper brings its whole subtree, kept EMBEDDED in
  // the copy, and links whose both ends are duplicated come along, rewired. It used to strip parent/embeds from every
  // clone and never included a grouper's children: Cmd+D on a lone Zone gave an empty shell, and a marquee duplicate
  // looked grouped but left the children behind on the first drag (audit 2026-09-23).
  // One undo step for the whole duplicate (all cloned elements + links).
  history.startBatch();
  try {
  const { idMap, innerLinkIds: interSelectionLinkIds } = insertSubtreeClones(elements, { dx: 24, dy: 24 });
  // Select the duplicated ELEMENTS the user selected (their duplicated children ride along inside them), plus the
  // duplicated links below, in one selection update.
  const newSelection = [...elementIds].map(id => idMap.get(id));

  // Duplicate explicitly selected links (Cmd+D on a link).
  // If a link's endpoint was also cloned, rewire to the new clone; otherwise
  // detach that endpoint so the duplicate sits as a free-floating connector
  // offset from the original (both ends unconnected when the link was the
  // only thing selected).
  const offset = { x: 24, y: 24 };

  // Resolve a connected endpoint to a plain coordinate near where the line
  // currently meets that side, then shift it by the duplicate offset so the
  // clone doesn't sit on top of the original.
  const detachEndpoint = (endpoint) => {
    if (endpoint?.id) {
      const peerCell = graph.getCell(endpoint.id);
      if (peerCell?.isElement?.()) {
        const pp = peerCell.position();
        const ps = peerCell.size();
        return { x: pp.x + ps.width / 2 + offset.x, y: pp.y + ps.height / 2 + offset.y };
      }
    }
    if (typeof endpoint?.x === 'number' && typeof endpoint?.y === 'number') {
      return { x: endpoint.x + offset.x, y: endpoint.y + offset.y };
    }
    return { x: offset.x, y: offset.y };
  };

  selectedLinks.forEach(link => {
    if (interSelectionLinkIds.has(link.id)) return;
    const clone = link.clone();
    const src = link.get('source');
    const tgt = link.get('target');
    if (src) {
      clone.set('source', src.id && idMap.has(src.id)
        ? { ...src, id: idMap.get(src.id) }
        : detachEndpoint(src));
    }
    if (tgt) {
      clone.set('target', tgt.id && idMap.has(tgt.id)
        ? { ...tgt, id: idMap.get(tgt.id) }
        : detachEndpoint(tgt));
    }
    // Offset vertices so the duplicate traces a parallel path
    const verts = clone.get('vertices');
    if (verts) {
      clone.set('vertices', verts.map(v => ({ x: v.x + offset.x, y: v.y + offset.y })));
    }
    graph.addCell(clone);
    newSelection.push(clone.id);
  });
  selection.selectMany(newSelection);
  } finally {
    history.endBatch();
  }
}

/**
 * Clone a single element with three connector-handling modes:
 *   - 'none'      → element only (its subtree and the links inside it come along, as with every clone)
 *   - 'dangling'  → element + each attached connector; cloned connectors are
 *                   attached to the new element on one side, with the other
 *                   side disconnected (anchored to a coordinate near where
 *                   the original endpoint sat)
 *   - 'connected' → element + each attached connector; cloned connectors are
 *                   attached to the new element on one side and to the SAME
 *                   peer cell as the original on the other side
 * The clone sits one width + 16 px to the right of the original. A grouper's attached connectors include its
 * descendants' (classified against the expanded set, like the multi-select variant).
 *
 * Returns the cloned element so callers can reposition / select it.
 */
/** One undo step for the clone AND every connector it brings (audit 2026-09-23): each addCell was its own entry, so
 *  the first Cmd+Z after "Clone with Connectors" removed a single cloned connector. */
export function cloneElementWithConnectors(cell, mode = 'none') {
  if (!cell || !cell.isElement || !cell.isElement()) return null;
  history.startBatch();
  try {
    const idMap = cloneWithConnectorsInner([cell], mode, { x: cell.size().width + 16, y: 0 });
    const clone = graph.getCell(idMap.get(cell.id));
    selection.selectOnly(clone.id);
    return clone;
  } finally { history.endBatch(); }
}

/** Clone `roots` (with their subtrees, via insertSubtreeClones) offset by `offset`, then, unless mode is 'none', every
 *  EXTERNAL connector: one end inside the expanded set, the other outside (another cell or a free point). Links with
 *  both ends inside came along with the subtree. The single-element and multi-select variants both run this, so a
 *  right-clicked Zone and a marquee over the same shapes clone the same thing. Returns the idMap. */
function cloneWithConnectorsInner(roots, mode, offset) {
  // Read the external links BEFORE the clones exist, so a cloned link is never itself mistaken for one.
  const ids = withDescendants(roots);
  const connectors = mode === 'none' ? [] : graph.getLinks().filter(l => ids.has(l.get('source')?.id) !== ids.has(l.get('target')?.id));
  const { idMap } = insertSubtreeClones(roots, { dx: offset.x, dy: offset.y });

  connectors.forEach(link => {
    const src = link.get('source') || {};
    const tgt = link.get('target') || {};
    const sIn = ids.has(src.id);
    const insideKey  = sIn ? 'source' : 'target';
    const outsideKey = sIn ? 'target' : 'source';
    const insideEnd  = sIn ? src : tgt;
    const outsideEnd = sIn ? tgt : src;
    const linkClone = link.clone();
    linkClone.set(insideKey, { ...insideEnd, id: idMap.get(insideEnd.id) });

    let isDangling = false;
    if (mode === 'connected') {
      linkClone.set(outsideKey, { ...outsideEnd });
    } else {
      // 'dangling': a DANGLING_STUB_LENGTH (100px) stub straight out from the cloned cell along the cardinal axis the
      // original connector left along. Snapping to the nearest cardinal keeps the stub aligned with the orthogonal
      // router and preserves the original "shape" of the connector (right-going stays right, downward stays down).
      // The clone's centre is read live: a re-slotted Gantt bar is not where the offset alone would put it.
      const insideOriginal = graph.getCell(insideEnd.id);
      const insideClone    = graph.getCell(idMap.get(insideEnd.id));
      const op = insideOriginal.position(), os = insideOriginal.size();
      const cellCenter  = { x: op.x + os.width / 2, y: op.y + os.height / 2 };
      const cp = insideClone.position(), cs = insideClone.size();
      const cloneCenter = { x: cp.x + cs.width / 2, y: cp.y + cs.height / 2 };

      let dx = 0, dy = 0;
      if (outsideEnd?.id) {
        const peerCell = graph.getCell(outsideEnd.id);
        if (peerCell?.isElement?.()) {
          const pp = peerCell.position();
          const ps = peerCell.size();
          dx = (pp.x + ps.width / 2) - cellCenter.x;
          dy = (pp.y + ps.height / 2) - cellCenter.y;
        }
      } else if (typeof outsideEnd?.x === 'number' && typeof outsideEnd?.y === 'number') {
        dx = outsideEnd.x - cellCenter.x;
        dy = outsideEnd.y - cellCenter.y;
      }
      if (dx === 0 && dy === 0) dx = 1; // default to right

      linkClone.set(outsideKey, (Math.abs(dx) >= Math.abs(dy))
        ? { x: cloneCenter.x + Math.sign(dx) * DANGLING_STUB_LENGTH, y: cloneCenter.y }
        : { x: cloneCenter.x, y: cloneCenter.y + Math.sign(dy) * DANGLING_STUB_LENGTH });
      isDangling = true;
    }

    // Vertices: when 'connected' we mirror the original path by offsetting its vertices. When 'dangling' we drop
    // them — the stub is a clean 100px line and stale vertices would fall outside it and zig-zag.
    if (isDangling) {
      linkClone.unset('vertices');
    } else {
      const verts = linkClone.get('vertices');
      if (verts) linkClone.set('vertices', verts.map(v => ({ x: v.x + offset.x, y: v.y + offset.y })));
    }

    graph.addCell(linkClone);
  });
  return idMap;
}

/** Count connectors (links) attached to a given cell — used by the UI to decide whether to surface the
 *  connector-clone options. Counts what "Clone with Connectors" would clone: a grouper's descendants' connectors
 *  too, and not a link that stays inside the cell's own subtree (that one comes along with every clone). */
export function countConnectors(cell) {
  return cell?.id ? countExternalConnectors([cell]) : 0;
}

/** Count connectors attached to `cell` whose OTHER endpoint is connected to a different cell (not just dangling at
 *  a coordinate). Used to decide whether the "with connected Connectors" clone option is meaningful — it has no
 *  effect when every connector dangles, so we hide it in that case. */
export function countConnectedConnectors(cell) {
  return cell?.id ? countExternalConnectedConnectors([cell]) : 0;
}

/** Count connectors that have ONE endpoint inside the given set of element
 *  cells (with their embedded descendants) and the OTHER endpoint outside
 *  (either a different cell or a dangling coordinate). These are the
 *  connectors the "with Connectors" clone options will additionally clone. */
export function countExternalConnectors(cells) {
  const ids = withDescendants((cells || []).filter(c => c?.id));
  if (ids.size === 0) return 0;
  return graph.getLinks().filter(l => {
    const sId = l.get('source')?.id;
    const tId = l.get('target')?.id;
    const sIn = sId && ids.has(sId);
    const tIn = tId && ids.has(tId);
    return (sIn && !tIn) || (!sIn && tIn);
  }).length;
}

/** Count external connectors (as above) whose OUTSIDE endpoint is connected
 *  to a real cell (not dangling). Used to decide whether the
 *  "with connected Connectors" option is meaningful. */
export function countExternalConnectedConnectors(cells) {
  const ids = withDescendants((cells || []).filter(c => c?.id));
  if (ids.size === 0) return 0;
  return graph.getLinks().filter(l => {
    const sId = l.get('source')?.id;
    const tId = l.get('target')?.id;
    const sIn = sId && ids.has(sId);
    const tIn = tId && ids.has(tId);
    if (sIn && !tIn) return !!tId;
    if (tIn && !sIn) return !!sId;
    return false;
  }).length;
}

/** Multi-select clone: duplicate every selected element (with its subtree),
 *  preserve connectors inside that set (rewired to clones), and additionally
 *  clone every EXTERNAL connector (one end in the set, one end outside).
 *  The clones sit 24 px down and right, like Cmd+D. Containment is kept as
 *  paste and Cmd+D keep it: a selected frame's children land in its copy
 *  (review D4, 2026-10-15), and a cloned Gantt bar gets its own row.
 *
 *  Modes:
 *    - 'dangling'  → outside end becomes a free coordinate stub 100px out
 *                    from the cloned cell on the inside side
 *    - 'connected' → outside end keeps its original peer reference, so the
 *                    cloned connector also wires to that same outside cell
 */
/** One undo step for the clone AND every connector it brings (audit 2026-09-23): each addCell was its own entry, so
 *  the first Cmd+Z after "Clone with Connectors" removed a single cloned connector. */
export function cloneSelectionWithMode(mode = 'dangling') {
  const elements = selection.getSelectedElements().filter(c => c.isElement());
  if (elements.length === 0) return;
  history.startBatch();
  try {
    selection.clearSelection();
    const idMap = cloneWithConnectorsInner(elements, mode, { x: 24, y: 24 });
    selection.selectMany(elements.map(el => idMap.get(el.id)));
  } finally { history.endBatch(); }
}

// Clipboard — copy, paste, and duplicate selected elements

import * as history from './history.js?v=1.15.7';

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

export function copy() {
  const allCells = selection.getSelectedElements();
  const elements = allCells.filter(c => c.isElement());
  if (elements.length === 0) return;
  const elementIds = new Set(elements.map(el => el.id));
  clipboardCells = elements.map(el => el.toJSON());

  // Also copy links that connect two selected elements
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

  // Map old element IDs to new IDs
  const idMap = new Map();

  // Listen for 'add' events to capture newly created cell IDs
  let lastAdded = null;
  const onAdd = (cell) => { lastAdded = cell; };
  graph.on('add', onAdd);

  // One undo step for the whole paste — every cloned element + link is one `add`
  // command; the batch composites them so a single Cmd+Z removes the entire paste.
  history.startBatch();
  try {
    clipboardCells.forEach(json => {
      const clone = JSON.parse(JSON.stringify(json));
      const oldId = clone.id;
      delete clone.id;
      delete clone.parent;
      delete clone.embeds;

      if (clone.position) {
        clone.position.x += pasteOffset;
        clone.position.y += pasteOffset;
      }

      lastAdded = null;
      graph.addCell(clone);
      if (lastAdded && lastAdded.isElement()) {
        idMap.set(oldId, lastAdded.id);
        selection.addToSelection(lastAdded.id);
      }
    });

    // Recreate links between cloned elements
    clipboardLinks.forEach(json => {
      const clone = JSON.parse(JSON.stringify(json));
      delete clone.id;

      const newSrcId = idMap.get(clone.source?.id);
      const newTgtId = idMap.get(clone.target?.id);
      if (!newSrcId || !newTgtId) return;

      clone.source = { ...clone.source, id: newSrcId };
      clone.target = { ...clone.target, id: newTgtId };

      // Offset vertices if any
      if (clone.vertices) {
        clone.vertices = clone.vertices.map(v => ({ x: v.x + pasteOffset, y: v.y + pasteOffset }));
      }

      graph.addCell(clone);
    });
  } finally {
    graph.off('add', onAdd);
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

  // Map old IDs to new cloned elements
  const idMap = new Map();

  // One undo step for the whole duplicate (all cloned elements + links).
  history.startBatch();
  try {
  elements.forEach(el => {
    const clone = el.clone();
    const pos = el.position();
    clone.position(pos.x + 24, pos.y + 24);
    // Don't carry over parent/embed relationships
    clone.unset('parent');
    clone.unset('embeds');
    graph.addCell(clone);
    idMap.set(el.id, clone.id);
    selection.addToSelection(clone.id);
  });

  // Track which links are cloned via the inter-selection pass so we don't
  // double-clone them when they're also explicitly selected.
  const interSelectionLinkIds = new Set();

  // Duplicate links between selected elements (rewire to cloned endpoints)
  graph.getLinks().forEach(link => {
    const srcId = link.get('source')?.id;
    const tgtId = link.get('target')?.id;
    if (srcId && tgtId && elementIds.has(srcId) && elementIds.has(tgtId)) {
      interSelectionLinkIds.add(link.id);
      const clone = link.clone();
      clone.set('source', { ...link.get('source'), id: idMap.get(srcId) });
      clone.set('target', { ...link.get('target'), id: idMap.get(tgtId) });
      // Offset vertices
      const verts = clone.get('vertices');
      if (verts) {
        clone.set('vertices', verts.map(v => ({ x: v.x + 24, y: v.y + 24 })));
      }
      graph.addCell(clone);
    }
  });

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
    selection.addToSelection(clone.id);
  });
  } finally {
    history.endBatch();
  }
}

/**
 * Clone a single element with three connector-handling modes:
 *   - 'none'      → element only (current default behavior)
 *   - 'dangling'  → element + each attached connector; cloned connectors are
 *                   attached to the new element on one side, with the other
 *                   side disconnected (anchored to a coordinate near where
 *                   the original endpoint sat)
 *   - 'connected' → element + each attached connector; cloned connectors are
 *                   attached to the new element on one side and to the SAME
 *                   peer cell as the original on the other side
 *
 * Returns the cloned element so callers can reposition / select it.
 */
export function cloneElementWithConnectors(cell, mode = 'none') {
  if (!cell || !cell.isElement || !cell.isElement()) return null;

  const size = cell.size();
  const pos = cell.position();
  const offset = { x: size.width + 16, y: 0 };

  const elementClone = cell.clone();
  elementClone.position(pos.x + offset.x, pos.y + offset.y);
  elementClone.unset('parent');
  elementClone.unset('embeds');
  graph.addCell(elementClone);

  if (mode !== 'none') {
    const connectors = graph.getLinks().filter(l => {
      const s = l.get('source')?.id;
      const t = l.get('target')?.id;
      return s === cell.id || t === cell.id;
    });

    // Centre of the original and cloned cells — used to figure out which
    // cardinal direction (right / left / up / down) the connector exits the
    // cell, so the dangling stub leaves the clone the same way the original
    // connector left its cell.
    const cellCenter  = { x: pos.x + size.width / 2, y: pos.y + size.height / 2 };
    const cloneCenter = { x: cellCenter.x + offset.x, y: cellCenter.y + offset.y };

    connectors.forEach(link => {
      const src = link.get('source') || {};
      const tgt = link.get('target') || {};
      const linkClone = link.clone();

      // Dangling endpoint: extend DANGLING_STUB_LENGTH (100px) straight out
      // from the cloned cell along the cardinal axis the original connector
      // left along. Snapping to the nearest cardinal keeps the stub aligned
      // with the orthogonal router and preserves the original "shape" of
      // the connector (right-going stays right, downward stays downward).
      const danglingCoord = (peerEndpoint) => {
        let dx = 0, dy = 0;
        if (peerEndpoint?.id) {
          const peerCell = graph.getCell(peerEndpoint.id);
          if (peerCell?.isElement?.()) {
            const pp = peerCell.position();
            const ps = peerCell.size();
            dx = (pp.x + ps.width / 2) - cellCenter.x;
            dy = (pp.y + ps.height / 2) - cellCenter.y;
          }
        } else if (typeof peerEndpoint?.x === 'number' && typeof peerEndpoint?.y === 'number') {
          dx = peerEndpoint.x - cellCenter.x;
          dy = peerEndpoint.y - cellCenter.y;
        }
        if (dx === 0 && dy === 0) dx = 1; // default to right
        if (Math.abs(dx) >= Math.abs(dy)) {
          return { x: cloneCenter.x + Math.sign(dx) * DANGLING_STUB_LENGTH, y: cloneCenter.y };
        }
        return { x: cloneCenter.x, y: cloneCenter.y + Math.sign(dy) * DANGLING_STUB_LENGTH };
      };

      let newSource, newTarget, isDangling = false;
      if (src.id === cell.id) {
        newSource = { ...src, id: elementClone.id };
        if (mode === 'connected') {
          newTarget = { ...tgt };
        } else {
          newTarget = danglingCoord(tgt);
          isDangling = true;
        }
      } else {
        newTarget = { ...tgt, id: elementClone.id };
        if (mode === 'connected') {
          newSource = { ...src };
        } else {
          newSource = danglingCoord(src);
          isDangling = true;
        }
      }

      linkClone.set('source', newSource);
      linkClone.set('target', newTarget);

      // Vertices: when 'connected' we mirror the original path by offsetting
      // its vertices. When 'dangling' we drop them — the stub is a clean
      // 100px line and stale vertices would otherwise fall outside the stub
      // and produce zig-zags.
      if (isDangling) {
        linkClone.unset('vertices');
      } else {
        const verts = linkClone.get('vertices');
        if (verts) {
          linkClone.set('vertices', verts.map(v => ({ x: v.x + offset.x, y: v.y + offset.y })));
        }
      }

      graph.addCell(linkClone);
    });
  }

  selection.selectOnly(elementClone.id);
  return elementClone;
}

/** Count connectors (links) attached to a given cell — used by the UI to
 *  decide whether to surface the connector-clone options. */
export function countConnectors(cell) {
  if (!cell?.id) return 0;
  return graph.getLinks().filter(l =>
    l.get('source')?.id === cell.id || l.get('target')?.id === cell.id
  ).length;
}

/** Count connectors attached to `cell` whose OTHER endpoint is connected to
 *  a different cell (not just dangling at a coordinate). Used to decide
 *  whether the "with connected Connectors" clone option is meaningful — it
 *  has no effect when every connector dangles, so we hide it in that case. */
export function countConnectedConnectors(cell) {
  if (!cell?.id) return 0;
  return graph.getLinks().filter(l => {
    const src = l.get('source');
    const tgt = l.get('target');
    if (src?.id === cell.id) return !!tgt?.id && tgt.id !== cell.id;
    if (tgt?.id === cell.id) return !!src?.id && src.id !== cell.id;
    return false;
  }).length;
}

/** Count connectors that have ONE endpoint inside the given set of element
 *  cells and the OTHER endpoint outside (either a different cell or a
 *  dangling coordinate). These are the connectors the multi-select
 *  "with Connectors" clone option will additionally clone. */
export function countExternalConnectors(cells) {
  const ids = new Set((cells || []).map(c => c?.id).filter(Boolean));
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
 *  to a real cell (not dangling). Used to decide whether the multi-select
 *  "with connected Connectors" option is meaningful. */
export function countExternalConnectedConnectors(cells) {
  const ids = new Set((cells || []).map(c => c?.id).filter(Boolean));
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

/** Multi-select clone: duplicate every selected element, preserve
 *  inter-selection connectors (rewired to clones), and additionally
 *  clone every EXTERNAL connector (one end in selection, one end outside).
 *
 *  Modes:
 *    - 'dangling'  → outside end becomes a free coordinate stub 100px to
 *                    the right of the cloned cell on the inside side
 *    - 'connected' → outside end keeps its original peer reference, so the
 *                    cloned connector also wires to that same outside cell
 */
export function cloneSelectionWithMode(mode = 'dangling') {
  const allCells = selection.getSelectedElements();
  const elements = allCells.filter(c => c.isElement());
  if (elements.length === 0) return;
  const elementIds = new Set(elements.map(e => e.id));

  const offset = { x: 24, y: 24 };

  selection.clearSelection();
  const idMap = new Map();

  // Clone elements first
  elements.forEach(el => {
    const clone = el.clone();
    const pos = el.position();
    clone.position(pos.x + offset.x, pos.y + offset.y);
    clone.unset('parent');
    clone.unset('embeds');
    graph.addCell(clone);
    idMap.set(el.id, clone.id);
    selection.addToSelection(clone.id);
  });

  // Walk every link in the graph once
  graph.getLinks().forEach(link => {
    const src = link.get('source') || {};
    const tgt = link.get('target') || {};
    const sId = src.id;
    const tId = tgt.id;
    const sIn = sId && elementIds.has(sId);
    const tIn = tId && elementIds.has(tId);
    if (!sIn && !tIn) return;

    const linkClone = link.clone();

    let isDangling = false;

    if (sIn && tIn) {
      // Inter-selection: rewire both ends to clones
      linkClone.set('source', { ...src, id: idMap.get(sId) });
      linkClone.set('target', { ...tgt, id: idMap.get(tId) });
    } else {
      // External connector: rewire the inside end to the clone, then
      // either keep the outside peer ('connected') or extend a 100px
      // straight stub in the cardinal direction the original connector
      // exited along ('dangling').
      const insideKey  = sIn ? 'source' : 'target';
      const outsideKey = sIn ? 'target' : 'source';
      const insideEnd  = sIn ? src : tgt;
      const outsideEnd = sIn ? tgt : src;
      const insideOriginal = graph.getCell(insideEnd.id);
      const insideClone    = graph.getCell(idMap.get(insideEnd.id));

      linkClone.set(insideKey, { ...insideEnd, id: idMap.get(insideEnd.id) });

      if (mode === 'connected') {
        linkClone.set(outsideKey, { ...outsideEnd });
      } else {
        // 'dangling' — snap-to-cardinal 100px stub matching original exit
        const op = insideOriginal.position();
        const os = insideOriginal.size();
        const cellCenter  = { x: op.x + os.width / 2, y: op.y + os.height / 2 };
        const cp = insideClone.position();
        const cs = insideClone.size();
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
        if (dx === 0 && dy === 0) dx = 1;

        const stub = (Math.abs(dx) >= Math.abs(dy))
          ? { x: cloneCenter.x + Math.sign(dx) * DANGLING_STUB_LENGTH, y: cloneCenter.y }
          : { x: cloneCenter.x, y: cloneCenter.y + Math.sign(dy) * DANGLING_STUB_LENGTH };

        linkClone.set(outsideKey, stub);
        isDangling = true;
      }
    }

    // Vertices: drop them on dangling stubs (would zig-zag outside the
    // 100px segment); offset them otherwise so the path is parallel-shifted.
    if (isDangling) {
      linkClone.unset('vertices');
    } else {
      const verts = linkClone.get('vertices');
      if (verts) {
        linkClone.set('vertices', verts.map(v => ({ x: v.x + offset.x, y: v.y + offset.y })));
      }
    }

    graph.addCell(linkClone);
  });
}

// Clipboard — copy, paste, and duplicate selected elements

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
  }
}

export function duplicate() {
  const allCells = selection.getSelectedElements();
  const elements = allCells.filter(c => c.isElement());
  if (elements.length === 0) return;
  const elementIds = new Set(elements.map(el => el.id));

  selection.clearSelection();

  // Map old IDs to new cloned elements
  const idMap = new Map();

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

  // Duplicate links between selected elements
  graph.getLinks().forEach(link => {
    const srcId = link.get('source')?.id;
    const tgtId = link.get('target')?.id;
    if (srcId && tgtId && elementIds.has(srcId) && elementIds.has(tgtId)) {
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
}

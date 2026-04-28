// Undo/Redo manager — custom command pattern implementation
// Listens to JointJS graph events and records reversible commands

let graph;
const undoStack = [];
const redoStack = [];
const MAX_STACK = 100;
let isUndoRedoing = false;
let isBatching = false;
let currentBatch = null;
const onChangeCallbacks = [];

export function init(_graph) {
  graph = _graph;

  graph.on('add', (cell) => {
    if (isUndoRedoing) return;
    const id = cell.id;
    // Capture the initial JSON as a fallback. For links created via port-drag,
    // the `add` event fires BEFORE the arrowhead is dropped on a target port,
    // so this snapshot has target set to a point, not to `{ id, port }`.
    // The undo handler re-captures the live JSON just before removing the
    // cell — that captures the fully-connected link state (as well as any
    // attribute edits made after creation), so redo restores the cell in its
    // final form rather than its moment-of-creation form.
    let capturedJson = cell.toJSON();
    pushCommand({
      undo: () => {
        const c = graph.getCell(id);
        if (c) {
          capturedJson = c.toJSON();
          c.remove();
        }
      },
      redo: () => graph.addCell(capturedJson),
    });
  });

  graph.on('remove', (cell) => {
    if (isUndoRedoing) return;
    const json = cell.toJSON();
    pushCommand({
      undo: () => graph.addCell(json),
      redo: () => {
        const c = graph.getCell(json.id);
        if (c) c.remove();
      },
    });
  });

  graph.on('change:position', (cell) => {
    if (isUndoRedoing) return;
    const oldPos = cell.previous('position');
    const newPos = { ...cell.get('position') };
    if (!oldPos) return;
    const id = cell.id;
    pushCommand({
      undo: () => { const c = graph.getCell(id); if (c) c.position(oldPos.x, oldPos.y); },
      redo: () => { const c = graph.getCell(id); if (c) c.position(newPos.x, newPos.y); },
    });
  });

  graph.on('change:size', (cell) => {
    if (isUndoRedoing) return;
    const oldSize = cell.previous('size');
    const newSize = { ...cell.get('size') };
    if (!oldSize) return;
    const id = cell.id;
    pushCommand({
      undo: () => { const c = graph.getCell(id); if (c) c.resize(oldSize.width, oldSize.height); },
      redo: () => { const c = graph.getCell(id); if (c) c.resize(newSize.width, newSize.height); },
    });
  });

  graph.on('change:attrs', (cell) => {
    if (isUndoRedoing) return;
    const oldAttrs = cell.previous('attrs');
    if (!oldAttrs) return;
    const newAttrs = JSON.parse(JSON.stringify(cell.get('attrs')));
    const oldAttrsCopy = JSON.parse(JSON.stringify(oldAttrs));
    const id = cell.id;
    pushCommand({
      undo: () => { const c = graph.getCell(id); if (c) c.set('attrs', oldAttrsCopy); },
      redo: () => { const c = graph.getCell(id); if (c) c.set('attrs', newAttrs); },
    });
  });

  // Link labels — `cell.labels()`, `cell.label()`, and `cell.appendLabel()` all
  // mutate the `labels` property, NOT `attrs`, so `change:attrs` never fires.
  // Without this handler, editing or removing a connector label is invisible to
  // undo/redo.
  graph.on('change:labels', (cell) => {
    if (isUndoRedoing) return;
    const oldLabels = cell.previous('labels');
    const newLabels = cell.get('labels');
    const oldStr = JSON.stringify(oldLabels ?? []);
    const newStr = JSON.stringify(newLabels ?? []);
    if (oldStr === newStr) return;
    const oldCopy = JSON.parse(oldStr);
    const newCopy = JSON.parse(newStr);
    const id = cell.id;
    pushCommand({
      undo: () => { const c = graph.getCell(id); if (c) c.labels(oldCopy); },
      redo: () => { const c = graph.getCell(id); if (c) c.labels(newCopy); },
    });
  });

  // Custom `lineStyle` prop (Safari-safe dashed/dotted connectors).
  // Stored separately from `line/strokeDasharray` so the real line never
  // carries a dasharray; see canvas.js → startLineStyleOverlays().
  graph.on('change:lineStyle', (cell) => {
    if (isUndoRedoing) return;
    const oldStyle = cell.previous('lineStyle') ?? null;
    const newStyle = cell.get('lineStyle') ?? null;
    if (oldStyle === newStyle) return;
    const id = cell.id;
    pushCommand({
      undo: () => { const c = graph.getCell(id); if (c) c.prop('lineStyle', oldStyle); },
      redo: () => { const c = graph.getCell(id); if (c) c.prop('lineStyle', newStyle); },
    });
  });
}

function pushCommand(cmd) {
  if (isBatching && currentBatch !== null) {
    currentBatch.push(cmd);
    return;
  }
  undoStack.push(cmd);
  if (undoStack.length > MAX_STACK) undoStack.shift();
  redoStack.length = 0;
  notifyChange();
}

export function undo() {
  if (undoStack.length === 0) return;
  isUndoRedoing = true;
  const cmd = undoStack.pop();
  try {
    if (Array.isArray(cmd)) {
      for (let i = cmd.length - 1; i >= 0; i--) cmd[i].undo();
    } else {
      cmd.undo();
    }
    redoStack.push(cmd);
  } finally {
    isUndoRedoing = false;
  }
  notifyChange();
}

export function redo() {
  if (redoStack.length === 0) return;
  isUndoRedoing = true;
  const cmd = redoStack.pop();
  try {
    if (Array.isArray(cmd)) {
      cmd.forEach(c => c.redo());
    } else {
      cmd.redo();
    }
    undoStack.push(cmd);
  } finally {
    isUndoRedoing = false;
  }
  notifyChange();
}

export function startBatch() {
  isBatching = true;
  currentBatch = [];
}

export function endBatch() {
  isBatching = false;
  if (currentBatch && currentBatch.length > 0) {
    undoStack.push(currentBatch);
    if (undoStack.length > MAX_STACK) undoStack.shift();
    redoStack.length = 0;
    notifyChange();
  }
  currentBatch = null;
}

export function clear() {
  undoStack.length = 0;
  redoStack.length = 0;
  notifyChange();
}

/** Snapshot current stacks (for per-tab persistence). */
export function save() {
  return { undo: [...undoStack], redo: [...redoStack] };
}

/** Restore previously saved stacks (for per-tab persistence). */
export function restore(state) {
  undoStack.length = 0;
  redoStack.length = 0;
  if (state) {
    undoStack.push(...state.undo);
    redoStack.push(...state.redo);
  }
  notifyChange();
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

export function onChange(cb) { onChangeCallbacks.push(cb); }
function notifyChange() { onChangeCallbacks.forEach(cb => cb()); }

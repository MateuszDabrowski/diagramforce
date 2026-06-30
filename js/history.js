// Undo/Redo manager — custom command pattern implementation
// Listens to JointJS graph events and records reversible commands

let graph;
const undoStack = [];
const redoStack = [];
const MAX_STACK = 100;
let isUndoRedoing = false;
let isBatching = false;
let currentBatch = null;
// Generic lock — when set, undo()/redo() no-op and canUndo()/canRedo() report
// false (so the toolbar buttons + keyboard shortcuts disable). The stacks stay
// intact, so flipping the lock off restores the exact prior availability. Used by
// the Data Mapping table edit session, where undo/redo mid-edit would mutate the
// graph out from under the open draft (the table holds an unapplied working copy).
let locked = false;
// While SUPPRESSED, recording is muted entirely: pushCommand no-ops (no undo entry, no redo-stack clear). Used
// by a LIVE edit session (the Edit-in-Table overlay) that writes to the graph for canvas preview but wants the
// whole session to land as ONE explicit recordCommand on Save (and nothing on Cancel). Distinct from `locked`,
// which only blocks undo/redo PLAYBACK — it does NOT mute recording, so it can't suppress live edits on its own.
let suppressed = false;
// While a diagram is being LOADED (graph.fromJSON + the post-load migrateLinks/migrateNodes/refreshAllIconHrefs
// normalisations, which fire per-cell change events), recording must be OFF: those are not user edits, so they
// must not land on the undo stack or mark the tab dirty. canvas.isLoadingJSON is wired in here via setLoadingGuard
// (app.js). Without this, e.g. re-resolving a placeholder icon href on load showed up as a phantom undoable change.
let loadingGuard = null;
export function setLoadingGuard(fn) { loadingGuard = fn; }
const onChangeCallbacks = [];

// ── Drag-aware merge for continuous position/size/vertex changes ──
// JointJS fires `change:position` (and `change:size`, `change:vertices`) on
// every pointer-move during an interactive drag — a 30-pixel drag can produce
// dozens of events. Without merging, the user has to tap undo for each step
// to walk a dragged element back to where it started.
//
// Strategy: when a continuous-change event fires, we record only the FIRST
// oldValue per cell-and-property pair, keep updating the latest newValue, and
// commit a single merged command after a short idle window (DRAG_IDLE_MS).
// `flushPendingDragCommit()` is also invoked at the start of undo()/redo()
// so a fast Cmd+Z immediately after a drop still finds the drag on the stack.
const DRAG_IDLE_MS = 80;
const pendingChanges = new Map();   // cellId → { position?, size?, angle?, vertices?, source?, target?, fields?, expressionRule?, props? }
let pendingCommitTimer = null;

const _clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

// ── Content props (top-level model props that ARE the source of truth a custom
// view renders from, but live OUTSIDE `attrs`, so the change:attrs handler never
// sees them). Without recording these, editing an object name / category / RACI /
// person details / Gantt date / sequence condition is invisible to undo. They are
// routed through the same debounced pendingChanges merge as field/expression edits
// so per-keystroke typing collapses to one entry, and so a content prop set ALONGSIDE
// a recorded `attrs` change (e.g. objectName + headerLabel/text inside addText's
// focus-session batch) coalesces into the SAME single undo step.
//
// Deliberately EXCLUDED: `z` (auto-assigned by the canvas z-tier system — recorded
// explicitly by the reorder buttons via recordCommand instead, so the auto-assignment
// on every drop/drag isn't logged as undo noise); `parent`/`embeds` (embedding — see
// note in GOTCHAS); and the Gantt Display-menu view prefs `weekStartDay` /
// `showWeekNumber` / `weekendStartDay` / `showProjectSummary` (intentionally
// non-undoable preferences — persisted as model props, just not on the undo stack).
const CONTENT_PROPS = [
  // DataObject
  'objectName', 'category', 'headerColor',
  // Task (RACI card)
  'taskName', 'taskDescription', 'descriptionWidth',
  // OrgPerson (mirrors OrgPersonView's change-listener set)
  'personName', 'jobTitle', 'email', 'phone', 'role', 'stream', 'location',
  'company', 'details', 'detailOrder', 'imageUrl', 'iconText', 'vacant',
  // Container (Team) + OrgPerson shared
  'tags', 'raci',
  // BPMN type switches (also repaint via attrs; the type prop itself must restore too)
  'eventType', 'gatewayType', 'taskType', 'poolDirection',
  // Gantt content
  'taskLabel', 'assignee', 'progress', 'barColor', 'colorManual', 'milestoneDate', 'markerDate', 'pointDown',
  'startDate', 'endDate', 'todayDate', 'numPeriods', 'timelineTitle', 'timelineDescription', 'userTextColor',
  // Sequence
  'participantRole', 'lifelinePortCount', 'showBottomLabel', 'showLifeline',
  'fragmentType', 'fragmentLabel', 'condition', 'elseCondition',
  // Architecture link + Link element + bracket annotation + Gantt structure
  // (`groupId` = a bar's group membership; `order` = its row slot; `groups` = the timeline's group headers —
  //  all set only by explicit reorder / regroup / add-task ops, so they belong in undo, unlike auto-assigned `z`)
  'connectionFrequency', 'fontColor', 'url', 'bracketSide', 'tasks', 'groupId', 'order', 'groups',
  // Generic df.* shapes: Table grid (rows + caption + per-row/col highlight + font size + fill/border), edited
  // via the Edit-in-Table overlay + the property panel. (headerRow kept for back-compat undo of legacy tables.)
  'rows', 'headerRow', 'tableLabel', 'highlightFirstRow', 'highlightFirstCol', 'fontSize', 'tableFill', 'tableBorder', 'tableTextColor',
  // df.Legend: a user-pinned width (set by the Width control / a resize, cleared by Auto size) — undoable.
  'manualWidth',
  // Gantt dependency link (Phase 3): typed predecessor relationship props (linkKind has its own handler)
  'depType', 'lag',
];

function schedulePendingDragCommit() {
  if (pendingCommitTimer) clearTimeout(pendingCommitTimer);
  pendingCommitTimer = setTimeout(() => {
    pendingCommitTimer = null;
    commitPendingDrag();
  }, DRAG_IDLE_MS);
}

function commitPendingDrag() {
  if (pendingCommitTimer) { clearTimeout(pendingCommitTimer); pendingCommitTimer = null; }
  if (pendingChanges.size === 0) return;

  const undos = [];
  const redos = [];
  for (const [id, entry] of pendingChanges) {
    if (entry.position) {
      const { oldPos, newPos } = entry.position;
      if (oldPos.x !== newPos.x || oldPos.y !== newPos.y) {
        const ox = oldPos.x, oy = oldPos.y, nx = newPos.x, ny = newPos.y;
        undos.push(() => { const c = graph.getCell(id); if (c) c.position(ox, oy); });
        redos.push(() => { const c = graph.getCell(id); if (c) c.position(nx, ny); });
      }
    }
    if (entry.size) {
      const { oldSize, newSize } = entry.size;
      if (oldSize.width !== newSize.width || oldSize.height !== newSize.height) {
        const ow = oldSize.width, oh = oldSize.height, nw = newSize.width, nh = newSize.height;
        undos.push(() => { const c = graph.getCell(id); if (c) c.resize(ow, oh); });
        redos.push(() => { const c = graph.getCell(id); if (c) c.resize(nw, nh); });
      }
    }
    if (entry.angle) {
      const { oldAngle, newAngle } = entry.angle;
      if (oldAngle !== newAngle) {
        undos.push(() => { const c = graph.getCell(id); if (c) c.set('angle', oldAngle); });
        redos.push(() => { const c = graph.getCell(id); if (c) c.set('angle', newAngle); });
      }
    }
    if (entry.vertices) {
      const { oldV, newV } = entry.vertices;
      const oldStr = JSON.stringify(oldV), newStr = JSON.stringify(newV);
      if (oldStr !== newStr) {
        const oc = JSON.parse(oldStr), nc = JSON.parse(newStr);
        undos.push(() => { const c = graph.getCell(id); if (c) c.vertices(oc); });
        redos.push(() => { const c = graph.getCell(id); if (c) c.vertices(nc); });
      }
    }
    // Link source / target re-wiring during an arrowhead drag. Merge
    // captures the FIRST source/target seen and the LAST, so multi-step
    // hover changes collapse to a single undo entry.
    if (entry.source) {
      const { oldS, newS } = entry.source;
      const oldStr = JSON.stringify(oldS), newStr = JSON.stringify(newS);
      if (oldStr !== newStr) {
        const oc = JSON.parse(oldStr), nc = JSON.parse(newStr);
        undos.push(() => { const c = graph.getCell(id); if (c) c.source(oc); });
        redos.push(() => { const c = graph.getCell(id); if (c) c.source(nc); });
      }
    }
    if (entry.target) {
      const { oldT, newT } = entry.target;
      const oldStr = JSON.stringify(oldT), newStr = JSON.stringify(newT);
      if (oldStr !== newStr) {
        const oc = JSON.parse(oldStr), nc = JSON.parse(newStr);
        undos.push(() => { const c = graph.getCell(id); if (c) c.target(oc); });
        redos.push(() => { const c = graph.getCell(id); if (c) c.target(nc); });
      }
    }
    // DataObject field-array edits — per-keystroke editor input + bulk CSV import
    // all merge to one entry per idle window (a bulk paste is a single set, so it
    // stays one atomic command on its own).
    if (entry.fields) {
      const { oldF, newF } = entry.fields;
      const oldStr = JSON.stringify(oldF), newStr = JSON.stringify(newF);
      if (oldStr !== newStr) {
        const oc = JSON.parse(oldStr), nc = JSON.parse(newStr);
        undos.push(() => { const c = graph.getCell(id); if (c) c.set('fields', oc); });
        redos.push(() => { const c = graph.getCell(id); if (c) c.set('fields', nc); });
      }
    }
    // Mapping expression/rule note typed in the link inspector (Data Cloud
    // Formula/Calculated transforms). Merged like field edits so typing collapses.
    if (entry.expressionRule) {
      const { oldML, newML } = entry.expressionRule;
      if (oldML !== newML) {
        undos.push(() => { const c = graph.getCell(id); if (c) c.prop('expressionRule', oldML); });
        redos.push(() => { const c = graph.getCell(id); if (c) c.prop('expressionRule', newML); });
      }
    }
    // Generic content props (CONTENT_PROPS) — names / category / RACI / dates / etc.
    // One undo/redo pair per changed prop; multiple props edited in the same idle
    // window land in the same merged command.
    if (entry.props) {
      for (const name in entry.props) {
        const { old: ov, new: nv } = entry.props[name];
        if (JSON.stringify(ov ?? null) === JSON.stringify(nv ?? null)) continue;
        const oc = _clone(ov), nc = _clone(nv);
        undos.push(() => { const c = graph.getCell(id); if (c) c.set(name, oc); });
        redos.push(() => { const c = graph.getCell(id); if (c) c.set(name, nc); });
      }
    }
  }
  pendingChanges.clear();

  if (undos.length === 0) return;
  if (undos.length === 1) {
    pushCommand({ undo: undos[0], redo: redos[0] });
  } else {
    // Multi-cell or multi-property drag (e.g. group move, resize-with-peers):
    // wrap as one composite command so a single undo restores the whole motion.
    pushCommand({
      undo: () => { for (let i = undos.length - 1; i >= 0; i--) undos[i](); },
      redo: () => { redos.forEach(fn => fn()); },
    });
  }
}

/** Public hook so callers (e.g. undo/redo) can force any pending drag merge to land first. */
export function flushPendingDragCommit() { commitPendingDrag(); }

/** True while an undo()/redo() is replaying commands. Listeners that MUTATE the model in response to graph
 *  changes (e.g. the embedding auto-fit) must bail during a replay, or they clobber the exact state the
 *  command restores — a restored position re-triggers the parent fit, which then over-rides the restored size. */
export function isUndoRedoActive() { return isUndoRedoing; }

export function init(_graph) {
  graph = _graph;

  graph.on('add', (cell) => {
    if (isUndoRedoing || loadingGuard?.()) return;
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
    if (isUndoRedoing || loadingGuard?.()) return;
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
    if (isUndoRedoing || loadingGuard?.()) return;
    // v1.12.1 — `recordPositionsBatch()` snapshots positions itself and
    // doesn't want the debounced merge to double-record the same moves.
    if (_suppressPositionTracking) return;
    const oldPos = cell.previous('position');
    if (!oldPos) return;
    const newPos = { ...cell.get('position') };
    const id = cell.id;
    let entry = pendingChanges.get(id);
    if (!entry) { entry = {}; pendingChanges.set(id, entry); }
    if (!entry.position) {
      // First position-change for this cell in this drag — pin the original oldPos.
      entry.position = { oldPos: { ...oldPos }, newPos };
    } else {
      // Subsequent move during the same drag — keep the original oldPos, refresh newPos.
      entry.position.newPos = newPos;
    }
    schedulePendingDragCommit();
  });

  graph.on('change:size', (cell) => {
    if (isUndoRedoing || loadingGuard?.()) return;
    if (_suppressPositionTracking) return;  // recordPositionsBatch captures sizes itself
    const oldSize = cell.previous('size');
    if (!oldSize) return;
    const newSize = { ...cell.get('size') };
    const id = cell.id;
    let entry = pendingChanges.get(id);
    if (!entry) { entry = {}; pendingChanges.set(id, entry); }
    if (!entry.size) {
      entry.size = { oldSize: { ...oldSize }, newSize };
    } else {
      entry.size.newSize = newSize;
    }
    schedulePendingDragCommit();
  });

  // Rotation (the `angle` property, set via the Rotation field / +90 button).
  // change:attrs/size/position never fire for a rotate. Merge through
  // pendingChanges like a drag so a whole rotation interaction — spinner clicks,
  // typing, repeated +90 — collapses to a SINGLE undo step (keeps the FIRST
  // oldAngle + the LATEST newAngle), not one entry per degree.
  graph.on('change:angle', (cell) => {
    if (isUndoRedoing || loadingGuard?.()) return;
    const id = cell.id;
    const newAngle = cell.get('angle') ?? 0;
    let entry = pendingChanges.get(id);
    if (!entry) { entry = {}; pendingChanges.set(id, entry); }
    if (!entry.angle) {
      entry.angle = { oldAngle: cell.previous('angle') ?? 0, newAngle };
    } else {
      entry.angle.newAngle = newAngle;
    }
    schedulePendingDragCommit();
  });

  graph.on('change:attrs', (cell) => {
    if (isUndoRedoing || loadingGuard?.()) return;
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

  // linkKind (Data Mapping: 'mapping' vs relationship) is a top-level prop, not attrs,
  // so change:attrs never fires for it. Record it so undo/redo of a Connection-type
  // switch restores the kind (and the property panel's slider) too, not just the visual.
  graph.on('change:linkKind', (cell) => {
    if (isUndoRedoing || loadingGuard?.()) return;
    const oldKind = cell.previous('linkKind') ?? null;
    const newKind = cell.get('linkKind') ?? null;
    if (oldKind === newKind) return;
    const id = cell.id;
    pushCommand({
      undo: () => { const c = graph.getCell(id); if (c) c.prop('linkKind', oldKind); },
      redo: () => { const c = graph.getCell(id); if (c) c.prop('linkKind', newKind); },
    });
  });

  // Link labels — `cell.labels()`, `cell.label()`, and `cell.appendLabel()` all
  // mutate the `labels` property, NOT `attrs`, so `change:attrs` never fires.
  // Without this handler, editing or removing a connector label is invisible to
  // undo/redo.
  graph.on('change:labels', (cell) => {
    if (isUndoRedoing || loadingGuard?.()) return;
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

  // Link vertices — added/dragged/cleared via `cell.vertices(...)`. Stored on
  // the link model directly, so neither `change:attrs` nor `change:labels`
  // captures changes. Without this handler the "Simplify path" action and any
  // user drag that creates or removes vertices is invisible to undo/redo.
  // Routed through the same pending-drag merge so a vertex drag collapses to
  // one undo command instead of one per pointer-move.
  graph.on('change:vertices', (cell) => {
    if (isUndoRedoing || loadingGuard?.()) return;
    if (_suppressPositionTracking) return;   // recordPositionsBatch captures vertices itself (one undo step)
    const oldV = cell.previous('vertices') ?? [];
    const newV = cell.get('vertices') ?? [];
    if (JSON.stringify(oldV) === JSON.stringify(newV)) return;
    const id = cell.id;
    let entry = pendingChanges.get(id);
    if (!entry) { entry = {}; pendingChanges.set(id, entry); }
    if (!entry.vertices) {
      entry.vertices = { oldV: JSON.parse(JSON.stringify(oldV)), newV: JSON.parse(JSON.stringify(newV)) };
    } else {
      entry.vertices.newV = JSON.parse(JSON.stringify(newV));
    }
    schedulePendingDragCommit();
  });

  // Link connector — `cell.connector(name, args)` swaps how the line is drawn
  // (e.g. straight vs rounded). Same blind-spot as vertices above.
  graph.on('change:connector', (cell) => {
    if (isUndoRedoing || loadingGuard?.()) return;
    const oldC = cell.previous('connector') ?? null;
    const newC = cell.get('connector') ?? null;
    const oldStr = JSON.stringify(oldC);
    const newStr = JSON.stringify(newC);
    if (oldStr === newStr) return;
    const oldCopy = oldC ? JSON.parse(oldStr) : null;
    const newCopy = newC ? JSON.parse(newStr) : null;
    const id = cell.id;
    pushCommand({
      undo: () => { const c = graph.getCell(id); if (c) c.prop('connector', oldCopy); },
      redo: () => { const c = graph.getCell(id); if (c) c.prop('connector', newCopy); },
    });
  });

  // Link source / target — fired when `link.source({id, port})` or
  // `link.target(...)` is called (port re-wiring, reconnecting a link
  // to a different cell, OR the user dragging an arrowhead end across
  // multiple hover targets before releasing). Routed through the same
  // pendingChanges merge as change:vertices so an arrowhead drag —
  // which fires change:source / change:target every time the user
  // hovers a different valid port mid-drag — collapses to ONE undo
  // entry instead of one per port-hover step. v1.12.4.
  graph.on('change:source', (cell) => {
    if (isUndoRedoing || loadingGuard?.()) return;
    if (_suppressPositionTracking) return;  // recordPositionsBatch handles this
    const oldSrc = cell.previous('source');
    const newSrc = cell.get('source');
    if (oldSrc == null && newSrc == null) return;
    const oldStr = JSON.stringify(oldSrc ?? null);
    const newStr = JSON.stringify(newSrc ?? null);
    if (oldStr === newStr) return;
    const id = cell.id;
    let entry = pendingChanges.get(id);
    if (!entry) { entry = {}; pendingChanges.set(id, entry); }
    if (!entry.source) {
      // First source-change in this drag — pin original.
      entry.source = { oldS: JSON.parse(oldStr), newS: JSON.parse(newStr) };
    } else {
      // Subsequent change in same drag — refresh newS, keep oldS.
      entry.source.newS = JSON.parse(newStr);
    }
    schedulePendingDragCommit();
  });
  graph.on('change:target', (cell) => {
    if (isUndoRedoing || loadingGuard?.()) return;
    if (_suppressPositionTracking) return;
    const oldTgt = cell.previous('target');
    const newTgt = cell.get('target');
    if (oldTgt == null && newTgt == null) return;
    const oldStr = JSON.stringify(oldTgt ?? null);
    const newStr = JSON.stringify(newTgt ?? null);
    if (oldStr === newStr) return;
    const id = cell.id;
    let entry = pendingChanges.get(id);
    if (!entry) { entry = {}; pendingChanges.set(id, entry); }
    if (!entry.target) {
      entry.target = { oldT: JSON.parse(oldStr), newT: JSON.parse(newStr) };
    } else {
      entry.target.newT = JSON.parse(newStr);
    }
    schedulePendingDragCommit();
  });

  // Custom `lineStyle` prop (Safari-safe dashed/dotted connectors).
  // Stored separately from `line/strokeDasharray` so the real line never
  // carries a dasharray; see canvas.js → startLineStyleOverlays().
  graph.on('change:lineStyle', (cell) => {
    if (isUndoRedoing || loadingGuard?.()) return;
    const oldStyle = cell.previous('lineStyle') ?? null;
    const newStyle = cell.get('lineStyle') ?? null;
    if (oldStyle === newStyle) return;
    const id = cell.id;
    pushCommand({
      undo: () => { const c = graph.getCell(id); if (c) c.prop('lineStyle', oldStyle); },
      redo: () => { const c = graph.getCell(id); if (c) c.prop('lineStyle', newStyle); },
    });
  });

  // DataObject `fields` array — edited via the inline/modal field editor and the
  // bulk CSV import. It's a top-level prop, so change:attrs never fires for it.
  // Routed through the pendingChanges merge so a stream of per-keystroke editor
  // edits collapses to one undo entry per idle window, while a bulk import (a
  // single `set`) commits as its own atomic command.
  graph.on('change:fields', (cell) => {
    if (isUndoRedoing || loadingGuard?.()) return;
    if (_suppressPositionTracking) return;
    const oldF = cell.previous('fields') ?? [];
    const newF = cell.get('fields') ?? [];
    if (JSON.stringify(oldF) === JSON.stringify(newF)) return;
    const id = cell.id;
    let entry = pendingChanges.get(id);
    if (!entry) { entry = {}; pendingChanges.set(id, entry); }
    if (!entry.fields) entry.fields = { oldF: JSON.parse(JSON.stringify(oldF)), newF: JSON.parse(JSON.stringify(newF)) };
    else entry.fields.newF = JSON.parse(JSON.stringify(newF));
    schedulePendingDragCommit();
  });

  // Mapping Type (Data Cloud transform: Standard / Formula / Calculated). A
  // discrete segmented-control click on a top-level prop → one undo per switch.
  graph.on('change:mappingType', (cell) => {
    if (isUndoRedoing || loadingGuard?.()) return;
    const oldT = cell.previous('mappingType') ?? null;
    const newT = cell.get('mappingType') ?? null;
    if (oldT === newT) return;
    const id = cell.id;
    pushCommand({
      undo: () => { const c = graph.getCell(id); if (c) c.prop('mappingType', oldT); },
      redo: () => { const c = graph.getCell(id); if (c) c.prop('mappingType', newT); },
    });
  });

  // Mapping expression/rule note (expressionRule) — typed in the link inspector's
  // progressive-disclosure Expression field. Debounce-merged like field edits.
  graph.on('change:expressionRule', (cell) => {
    if (isUndoRedoing || loadingGuard?.()) return;
    const oldML = cell.previous('expressionRule') ?? '';
    const newML = cell.get('expressionRule') ?? '';
    if (oldML === newML) return;
    const id = cell.id;
    let entry = pendingChanges.get(id);
    if (!entry) { entry = {}; pendingChanges.set(id, entry); }
    if (!entry.expressionRule) entry.expressionRule = { oldML, newML };
    else entry.expressionRule.newML = newML;
    schedulePendingDragCommit();
  });

  // Embedding (`parent` / `embeds`) — `cell.embed()`/`unembed()` and the paper's
  // embeddingMode set a child's `parent` (and the parent's `embeds` array), firing
  // change:parent. Record it so dragging an EXISTING element INTO or OUT of a container
  // is undoable — reverting position alone would otherwise leave it wrongly embedded.
  // Undo/redo go through `restoreParent`, which uses embed/unembed so BOTH sides
  // (child `parent` + parent `embeds`) stay consistent. Discrete (one finalizeEmbedding
  // per drop) → immediate push (lands in the open pointer/selection batch alongside the
  // position change). SUPPRESSED for add-then-embed flows (stencil drop, conversions)
  // where the `add` command already round-trips the embed via its captured JSON — see
  // suppressEmbedTracking; recording there would split the drop into two undo steps.
  graph.on('change:parent', (cell) => {
    if (isUndoRedoing || _suppressParentTracking) return;
    const oldParentId = cell.previous('parent') ?? null;
    const newParentId = cell.get('parent') ?? null;
    if (oldParentId === newParentId) return;
    const childId = cell.id;
    pushCommand({
      undo: () => restoreParent(childId, oldParentId),
      redo: () => restoreParent(childId, newParentId),
    });
  });

  // Generic content-prop recording (CONTENT_PROPS) — one merged handler per prop.
  // Routes through pendingChanges so typing collapses, and so a prop set inside a
  // property-panel batch (addText/addColor) coalesces with its sibling attr change.
  CONTENT_PROPS.forEach((name) => {
    graph.on('change:' + name, (cell) => {
      if (isUndoRedoing || loadingGuard?.()) return;
      const oldVal = cell.previous(name);
      const newVal = cell.get(name);
      if (JSON.stringify(oldVal ?? null) === JSON.stringify(newVal ?? null)) return;
      const id = cell.id;
      let entry = pendingChanges.get(id);
      if (!entry) { entry = {}; pendingChanges.set(id, entry); }
      if (!entry.props) entry.props = {};
      // Keep the FIRST oldVal seen in this window; always refresh to the latest newVal.
      if (!(name in entry.props)) entry.props[name] = { old: _clone(oldVal), new: _clone(newVal) };
      else entry.props[name].new = _clone(newVal);
      schedulePendingDragCommit();
    });
  });
}

/**
 * Push an explicit reversible command (respects an open batch). For discrete model
 * mutations that aren't covered by the change-listeners — e.g. the z-order reorder
 * buttons, where `z` is auto-assigned by the canvas tier system so it can't be a
 * blanket change:z listener (that would log every drop/drag). The caller has already
 * applied the change; this just records how to undo/redo it.
 */
export function recordCommand(undo, redo) {
  if (typeof undo !== 'function' || typeof redo !== 'function') return;
  pushCommand({ undo, redo });
}

function pushCommand(cmd) {
  if (suppressed) return;   // muted session (Edit-in-Table live edits) — no entry, redo stack preserved
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
  if (locked) return;
  // Land any in-flight drag merge first so a fast Cmd+Z right after a drop
  // doesn't undo the wrong action (or no action at all).
  commitPendingDrag();
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
  if (locked) return;
  commitPendingDrag();
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

/**
 * Atomic snapshot-based history helper for programmatic batch operations
 * like Auto-Layout (v1.12.1).
 *
 * The change:position handler routes events through a debounced merge
 * that fires 80 ms later — that's the right behaviour for interactive
 * drags, but it makes startBatch/endBatch wrapping unreliable for
 * programmatic operations because the merge can outlive the batch's
 * close. Worse, `snapLinksToPorts()` (called after every auto-layout)
 * fires `change:source` / `change:target` events on links to switch
 * which port each end connects to, and history has no handlers for
 * those events at all — so undo would restore positions but leave the
 * connectors snapped to whatever port the layout chose.
 *
 * This helper sidesteps both issues. It snapshots every element's
 * position AND every link's source/target endpoint BEFORE running the
 * callback, sets a suppression flag so the change:position handler
 * doesn't double-record into pendingChanges, runs the callback, then
 * snapshots AFTER, builds ONE composite command from the full diff
 * (positions + link endpoints) and pushes it to the undo stack.
 *
 * Use this for operations that move multiple elements OR re-wire link
 * endpoints programmatically — auto-layout, alignment actions, anything
 * that should collapse N changes into a single undo step.
 */
// `afterRestore` (optional) runs at the END of both undo AND redo of this batch — used by auto-layout to
// re-fit the viewport so the camera follows the restored layout (otherwise undo restores positions but the
// camera stays where the layout's fit left it, leaving the diagram off-screen until a manual Fit).
export function recordPositionsBatch(callback, afterRestore = null) {
  // Land any pending interactive-drag merge first so its entry doesn't
  // get blended into the programmatic snapshot below.
  commitPendingDrag();

  // Snapshot positions of every element + endpoints of every link
  // BEFORE the callback fires its mutations.
  const beforePos = new Map();
  const beforeSize = new Map();
  for (const el of graph.getElements()) {
    beforePos.set(el.id, { ...el.position() });
    beforeSize.set(el.id, { ...el.size() });
  }
  const beforeEndpoints = new Map();
  const beforeVertices = new Map();
  for (const link of graph.getLinks()) {
    beforeEndpoints.set(link.id, {
      source: JSON.parse(JSON.stringify(link.get('source') || {})),
      target: JSON.parse(JSON.stringify(link.get('target') || {})),
    });
    beforeVertices.set(link.id, JSON.stringify(link.get('vertices') ?? []));
  }

  // Suppress the change:position handler's pendingChanges recording for
  // the duration of the callback — we'll record the diff ourselves.
  const prevSuppress = _suppressPositionTracking;
  _suppressPositionTracking = true;
  try {
    callback();
  } finally {
    _suppressPositionTracking = prevSuppress;
  }

  // Snapshot AFTER; build per-cell undo/redo from the diff.
  const undos = [];
  const redos = [];

  // 1. Position diffs.
  for (const el of graph.getElements()) {
    const oldPos = beforePos.get(el.id);
    const newPos = { ...el.position() };
    if (!oldPos) continue;
    if (oldPos.x === newPos.x && oldPos.y === newPos.y) continue;
    const id = el.id;
    const ox = oldPos.x, oy = oldPos.y, nx = newPos.x, ny = newPos.y;
    undos.push(() => { const c = graph.getCell(id); if (c) c.position(ox, oy); });
    redos.push(() => { const c = graph.getCell(id); if (c) c.position(nx, ny); });
  }

  // 1b. Size diffs — a layout that resizes (e.g. Data Mapping lanes hugging their
  //     objects) changes element sizes; fold them into the same single undo step.
  for (const el of graph.getElements()) {
    const oldSize = beforeSize.get(el.id);
    const newSize = { ...el.size() };
    if (!oldSize) continue;
    if (oldSize.width === newSize.width && oldSize.height === newSize.height) continue;
    const id = el.id;
    const ow = oldSize.width, oh = oldSize.height, nw = newSize.width, nh = newSize.height;
    undos.push(() => { const c = graph.getCell(id); if (c) c.resize(ow, oh); });
    redos.push(() => { const c = graph.getCell(id); if (c) c.resize(nw, nh); });
  }

  // 2. Link endpoint diffs — `snapLinksToPorts()` is the main producer.
  //    `link.source({…})` and `link.target({…})` fire change:source /
  //    change:target which history would otherwise miss entirely.
  for (const link of graph.getLinks()) {
    const oldEp = beforeEndpoints.get(link.id);
    if (!oldEp) continue;
    const newSource = link.get('source') || {};
    const newTarget = link.get('target') || {};
    const oldSrcStr = JSON.stringify(oldEp.source);
    const newSrcStr = JSON.stringify(newSource);
    const oldTgtStr = JSON.stringify(oldEp.target);
    const newTgtStr = JSON.stringify(newTarget);
    const id = link.id;
    if (oldSrcStr !== newSrcStr) {
      const oldSrc = JSON.parse(oldSrcStr);
      const newSrc = JSON.parse(newSrcStr);
      undos.push(() => { const c = graph.getCell(id); if (c) c.source(oldSrc); });
      redos.push(() => { const c = graph.getCell(id); if (c) c.source(newSrc); });
    }
    if (oldTgtStr !== newTgtStr) {
      const oldTgt = JSON.parse(oldTgtStr);
      const newTgt = JSON.parse(newTgtStr);
      undos.push(() => { const c = graph.getCell(id); if (c) c.target(oldTgt); });
      redos.push(() => { const c = graph.getCell(id); if (c) c.target(newTgt); });
    }
  }

  // 3. Link vertex diffs — if the batch reroutes a link (e.g. re-porting changes its path), the vertices
  //    change must ride in THIS one command. Without it the change:vertices listener (not suppressed during
  //    the batch) committed a SEPARATE pending entry, so the layout took two undos (the leaked "one connector"
  //    undo). Captured here + that listener now bails during the batch (single, coherent undo step).
  for (const link of graph.getLinks()) {
    const oldVStr = beforeVertices.get(link.id);
    if (oldVStr == null) continue;
    const newVStr = JSON.stringify(link.get('vertices') ?? []);
    if (oldVStr === newVStr) continue;
    const id = link.id;
    const oldV = JSON.parse(oldVStr);
    const newV = JSON.parse(newVStr);
    undos.push(() => { const c = graph.getCell(id); if (c) c.set('vertices', oldV); });
    redos.push(() => { const c = graph.getCell(id); if (c) c.set('vertices', newV); });
  }

  if (undos.length === 0) return;

  pushCommand({
    undo: () => { for (let i = undos.length - 1; i >= 0; i--) undos[i](); afterRestore?.(); },
    redo: () => { redos.forEach(fn => fn()); afterRestore?.(); },
  });
}

let _suppressPositionTracking = false;
let _suppressParentTracking = false;

// Restore a child's embedding to `targetParentId` (null = top-level) via JointJS
// embed/unembed so the parent's `embeds` array stays in sync with the child's `parent`.
// Used by the change:parent undo/redo commands. The embed/unembed it performs fire
// change:parent again, but the listener bails while isUndoRedoing is true.
function restoreParent(childId, targetParentId) {
  if (!graph) return;
  const child = graph.getCell(childId);
  if (!child) return;
  const currentParentId = child.get('parent') ?? null;
  if (currentParentId === targetParentId) return;
  if (currentParentId) { const cp = graph.getCell(currentParentId); if (cp) cp.unembed(child); }
  if (targetParentId) { const tp = graph.getCell(targetParentId); if (tp) tp.embed(child); }
}

/**
 * Run `fn` without recording change:parent. For add-then-embed flows (stencil drop,
 * shape conversions) where the cell's `add` command already captures the final embedded
 * state in its JSON — recording the embed separately would split one drop into two undo
 * steps. Drags / multi-select capture do NOT use this, so their embeds stay undoable.
 */
export function suppressEmbedTracking(fn) {
  const prev = _suppressParentTracking;
  _suppressParentTracking = true;
  try { return fn(); }
  finally { _suppressParentTracking = prev; }
}

// Nesting depth — multiple startBatch calls now stack instead of
// overwriting each other (the previous "always reset currentBatch"
// behaviour silently dropped the outer batch's contents whenever an
// inner code path opened its own batch on top). Outermost endBatch
// commits; inner endBatch just decrements depth.
let batchDepth = 0;

export function startBatch() {
  // Only flush + initialise on the OUTERMOST start. Nested starts share
  // the existing currentBatch so their pushCommand calls land in the
  // same composite — paper-level pointer brackets + resize-handle
  // brackets can now coexist without clobbering each other.
  if (batchDepth === 0) {
    commitPendingDrag();
    currentBatch = [];
    isBatching = true;
  }
  batchDepth++;
}

export function endBatch() {
  // Unmatched endBatch (no open batch) — defensive bail. Don't decrement
  // below zero or pretend to commit.
  if (batchDepth === 0) return;
  batchDepth--;
  // Inner endBatch — still nested. Don't commit yet; the outermost
  // call below will flush everything together.
  if (batchDepth > 0) return;

  // Outermost endBatch — commit pending merges first while
  // isBatching === true so they route into currentBatch correctly,
  // then close the batch and push it as one composite command.
  commitPendingDrag();

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
  // Drop any in-flight drag merge along with the rest of the history.
  if (pendingCommitTimer) { clearTimeout(pendingCommitTimer); pendingCommitTimer = null; }
  pendingChanges.clear();
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

export function canUndo() { return !locked && undoStack.length > 0; }
export function canRedo() { return !locked && redoStack.length > 0; }

// Lock / unlock undo+redo. notifyChange() fires so the toolbar refreshes the
// button disabled-state immediately (it reads canUndo()/canRedo()).
export function setLocked(v) { locked = !!v; notifyChange(); }
export function setSuppressed(v) { suppressed = !!v; }

export function onChange(cb) { onChangeCallbacks.push(cb); }
function notifyChange() { onChangeCallbacks.forEach(cb => cb()); }

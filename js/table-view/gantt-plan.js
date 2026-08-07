// Gantt project-plan table — live structural editing ops (S9, extracted from table-view.js).
// The Gantt table's LIVE (non-drafted) edits: Add / Delete / Reorder a task, and the predecessor
// (ganttDep link) dependency editor. Each mutates the graph IMMEDIATELY as its own undo entry, then
// re-syncs the bar draft + re-renders via the injected syncGanttDraft/render callbacks. The DRAFTED
// cell edits (name / dates / progress / group) + buildGanttData stay in the facade — they share the
// draft-session state machine (_barDraft/_barOrig), which this module never touches. Reads the live
// graph + facade callbacks via initGanttPlan; never imports table-view.js back (acyclic).

import { escHtml } from '../util.js?v=1.22.1';
import { startBatch, endBatch } from '../history.js?v=1.22.1';
import { ganttTimelineFor, timelineBars, resequenceGanttOrders, layoutTimelineTasks, applyGanttGeometry, orderToY } from '../gantt-layout.js?v=1.22.1';
import { applyGanttDepLinkStyle } from '../canvas.js?v=1.22.1';
import { buildModal } from '../feedback.js?v=1.22.1';

// ── Injected context (wired by table-view.init → initGanttPlan). Read at CALL time. `graph` is the
// live JointJS graph; syncGanttDraft/render/isEditSession are facade functions the structural ops
// call after mutating the graph (syncGanttDraft re-snapshots the shared bar draft, render re-draws). ──
let graph, syncGanttDraft, render, isEditSession;
export function initGanttPlan(ctx) {
  graph = ctx.graph;
  syncGanttDraft = ctx.syncGanttDraft;
  render = ctx.render;
  isEditSession = ctx.isEditSession;
}

// + Add task → a dated bar (next order, start → +7 days) embedded in `tl`, mirroring the timeline panel's
// "+ Task". Immediate + undoable; the new row is then editable inline.
export function addGanttTask(tlId) {
  const tl = tlId && graph.getCell(tlId);
  if (!tl) return;
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const startStr = tl.get('startDate') || isoOf(new Date());
  const ed = new Date(startStr + 'T00:00:00'); ed.setDate(ed.getDate() + 7);
  const order = timelineBars(tl).length;
  startBatch();
  try {
    const bar = new joint.shapes.sf.GanttTask({ order, groupId: null, taskLabel: 'New Task', startDate: startStr, endDate: isoOf(ed), attrs: { label: { text: 'New Task' } } });
    graph.addCell(bar);
    tl.embed(bar);
    if (!applyGanttGeometry(bar, tl)) bar.position(tl.position().x + (tl.get('taskListWidth') || 200), orderToY(tl, order), { gantt: true });
  } finally { endBatch(); }
  syncGanttDraft();
  render();
}

// Delete a task row → remove the bar cell + close the order gap. Immediate + undoable (matches the panel).
export function deleteGanttBar(barId) {
  const bar = barId && graph.getCell(barId);
  if (!bar) return;
  const tl = ganttTimelineFor(bar);
  startBatch();
  try { graph.removeCells([bar]); if (tl) resequenceGanttOrders(tl); } finally { endBatch(); }
  syncGanttDraft();
  render();
}

// Reorder: move the dragged bar to before `toBarId` (drop target), rewrite `order`, re-layout. Immediate +
// undoable, mirroring the panel's drag-reorder (splice in timelineBars order, renumber, re-snap).
export function reorderGanttBar(fromBarId, toBarId) {
  const moved = fromBarId && graph.getCell(fromBarId);
  const target = toBarId && graph.getCell(toBarId);
  if (!moved || !target || moved === target) return;
  const tl = ganttTimelineFor(moved);
  if (!tl || ganttTimelineFor(target) !== tl) return;   // only reorder within one timeline
  const ordered = timelineBars(tl);
  const fromIdx = ordered.indexOf(moved), toIdx = ordered.indexOf(target);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
  const [m] = ordered.splice(fromIdx, 1);
  ordered.splice(toIdx > fromIdx ? toIdx : toIdx + 1, 0, m);   // insert AFTER the drop target (matches the below-indicator)
  startBatch();
  try {
    // A drop across groups also adopts the target's group (so the bar lands where it visually dropped).
    if ((moved.get('groupId') || null) !== (target.get('groupId') || null)) moved.set('groupId', target.get('groupId') || null);
    ordered.forEach((b, idx) => { if (b.get('order') !== idx) b.set('order', idx); });
    // Derive Y FROM the new order (like the panel's reorder) — NOT resequenceGanttOrders, which would re-sort
    // by current Y and undo the move (the bars haven't physically moved yet).
    layoutTimelineTasks(tl);
  } finally { endBatch(); }
  syncGanttDraft();
  render();
}

// ── Dependencies editor (Phase 5c) — predecessor ganttDep links ─────────────
// A task's deps are inbound standard.Links tagged linkKind:'ganttDep' (depType FS/SS/FF/SF + lag), NOT a
// scalar prop — so they're edited LIVE (each add/remove/change its own undo entry) in a small anchored editor,
// not in the Save/Cancel draft. The deps cell shows the derived summary + opens this on click.
const ganttDepLinks = (barId) => {
  const bar = barId && graph.getCell(barId);
  return bar ? graph.getConnectedLinks(bar, { inbound: true }).filter(l => l.prop('linkKind') === 'ganttDep') : [];
};
const ganttSiblingTasks = (barId) => {
  const bar = barId && graph.getCell(barId);
  const tl = bar && ganttTimelineFor(bar);
  return tl ? timelineBars(tl).filter(b => b.id !== barId) : [];
};
const depBatch = (fn) => { startBatch(); try { fn(); } finally { endBatch(); } };

export function openDepEditor(barId, anchorEl) {
  const bar = barId && graph.getCell(barId);
  if (!bar) return;
  const name = bar.get('taskLabel') || bar.attr('label/text') || 'Task';
  const m = buildModal({
    title: `Dependencies: ${name}`,
    // Anchored modals hide the header, so the body carries its own heading; a Done button gives a clear close
    // (Escape + clicking the scrim also close it).
    bodyHtml: `<div class="df-dep-editor__head">Predecessors of <strong>${escHtml(String(name))}</strong></div><div class="df-dep-editor" id="df-dep-editor"></div>`,
    footerHtml: '<button type="button" id="df-dep-done" class="df-tbl__csv df-tbl__csv--primary">Done</button>',
    anchor: anchorEl, width: 380,
    onClose: () => { if (isEditSession()) render(); },   // refresh the deps-cell summary behind the modal
  });
  renderDepList(m.body.querySelector('#df-dep-editor'), barId);
  m.overlay.querySelector('#df-dep-done')?.addEventListener('click', m.close);
}

// (Re)draw the predecessor list into the editor host. Each control mutates the graph live, then re-draws.
function renderDepList(host, barId) {
  if (!host) return;
  const links = ganttDepLinks(barId);
  const siblings = ganttSiblingTasks(barId);
  const nameOf = (id) => { const c = id && graph.getCell(id); return c ? (c.get('taskLabel') || c.attr('label/text') || 'Task') : String(id || ''); };
  host.innerHTML = '';

  if (!links.length) {
    const p = document.createElement('p');
    p.className = 'df-dep-editor__empty';
    p.textContent = siblings.length ? 'No dependencies yet.' : 'No other tasks in this timeline to depend on.';
    host.appendChild(p);
  }

  for (const link of links) {
    const row = document.createElement('div');
    row.className = 'df-dep-editor__row';
    const curPred = link.get('source') && link.get('source').id;

    const predSel = document.createElement('select');
    predSel.className = 'df-properties__input df-dep-editor__pred';
    predSel.title = 'Predecessor task';
    // Candidates = siblings NOT already a predecessor via another link (so a repoint can't duplicate one),
    // always keeping THIS link's own current source selectable.
    const usedByOthers = new Set(links.filter(l => l !== link).map(l => l.get('source') && l.get('source').id));
    // If the current predecessor isn't a sibling (a cross-timeline dep drawn on the canvas), surface it as a
    // selected option so the select faithfully shows the real predecessor instead of auto-picking a wrong one.
    if (curPred && !siblings.some(s => s.id === curPred)) {
      const o = document.createElement('option');
      o.value = curPred; o.textContent = `${nameOf(curPred)} (other timeline)`; o.selected = true;
      predSel.appendChild(o);
    }
    for (const s of siblings) {
      if (s.id !== curPred && usedByOthers.has(s.id)) continue;   // already used by another dependency
      const o = document.createElement('option');
      o.value = s.id; o.textContent = nameOf(s.id); if (s.id === curPred) o.selected = true;
      predSel.appendChild(o);
    }
    // Repoint, then re-derive the whole editor (the Add button's availability + other rows' option sets change).
    predSel.addEventListener('change', () => { depBatch(() => link.source({ id: predSel.value, port: 'port-right' })); renderDepList(host, barId); });
    row.appendChild(predSel);

    const del = document.createElement('button');
    del.type = 'button'; del.className = 'df-field-delete'; del.textContent = '×'; del.title = 'Remove dependency';
    del.addEventListener('click', () => { depBatch(() => graph.removeCells([link])); renderDepList(host, barId); });
    row.appendChild(del);

    host.appendChild(row);
  }

  const usedPreds = new Set(links.map(l => l.get('source') && l.get('source').id));
  const avail = siblings.filter(s => !usedPreds.has(s.id));
  const add = document.createElement('button');
  add.type = 'button'; add.className = 'df-properties__btn df-properties__btn--add-field df-dep-editor__add';
  add.textContent = '+ Add dependency';
  if (!avail.length) { add.disabled = true; add.title = siblings.length ? 'Every other task is already a predecessor' : 'No other tasks in this timeline'; }
  add.addEventListener('click', () => {
    const pred = avail[0];
    if (!pred) return;
    depBatch(() => {
      const link = new joint.shapes.standard.Link({ source: { id: pred.id, port: 'port-right' }, target: { id: barId, port: 'port-left' } });
      link.prop('linkKind', 'ganttDep');
      graph.addCell(link);
      applyGanttDepLinkStyle(link);
    });
    renderDepList(host, barId);
  });
  host.appendChild(add);
}

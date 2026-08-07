// Gantt-chart property renderers (CLEANUP S2, slice 10) — renderGanttTask/Milestone/Marker/Timeline/GroupProps
// plus the timeline task editors renderTimelineTaskEditor / renderBarTaskEditor (the anchored predecessor-link +
// bar CRUD). Build via widgets + finishStandardProps (render-core) + the gantt-layout helpers, reading graph +
// the panel DOM refs + the showProperties dispatch via prctx (add/delete/reorder re-render the panel); never
// imports the facade. The showProperties() dispatch imports the five render*Props back.
import * as history from '../history.js?v=1.22.1';
import { asUndoBatch, prctx } from './context.js?v=1.22.1';
import { applyGanttGeometry, applyGanttGroupGeometry, ganttRowLayout, ganttTimelineFor, orderToY, resequenceGanttOrders, timelineBars } from '../gantt-layout.js?v=1.22.1';
import { finishStandardProps } from './render-core.js?v=1.22.1';
import { addCloneBtn, addColor, addDate, field, addDeleteBtn, addNumber, addNumberWithSuffix, addOrderButtons, addSelect, addText, addTextarea, section, toHex } from './widgets.js?v=1.22.1';

export function renderGanttTaskProps(cell) {
  // Content
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    cell.set('taskLabel', v);
    prctx.titleEl.textContent = v || '';
  });
  // Only show progress input if showProgress is enabled
  if (cell.get('showProgress') !== false) {
    addNumber(content, 'Progress (%)', cell.get('progress') ?? 0, v => {
      cell.set('progress', Math.max(0, Math.min(100, v)));
    }, { min: 0, max: 100 });
  }
  // Only show assignee input if showAssignee is enabled. Autocompletes from the assignees already used in THIS
  // diagram (issue 5) via a native <datalist>, so populating people is a couple of keystrokes.
  if (cell.get('showAssignee') !== false) {
    const f = field(content, 'Assignee');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'df-properties__input';
    input.value = cell.get('assignee') || '';
    input.placeholder = 'Assignee';
    const others = [...new Set((cell.graph?.getElements() || [])
      .filter(e => e.get('type') === 'sf.GanttTask' && e.id !== cell.id)
      .map(e => (e.get('assignee') || '').trim()).filter(Boolean))].sort();
    if (others.length) {
      const dl = document.createElement('datalist');
      dl.id = 'df-assignee-suggestions';
      others.forEach((a) => { const o = document.createElement('option'); o.value = a; dl.appendChild(o); });
      f.appendChild(dl);
      input.setAttribute('list', dl.id);
    }
    input.addEventListener('input', asUndoBatch(() => { cell.set('assignee', input.value); cell.attr('assigneeLabel/text', input.value); }));
    f.appendChild(input);
  }

  // Schedule — the DATES drive the bar's position + width on the timeline (gantt-scale): editing a date moves the bar
  // to its column. A bar with no dates stays where it's dragged (back-compat). Bind a task to a timeline by dropping
  // it onto one (or by having a single timeline in the diagram).
  const schedule = section(prctx.bodyEl, 'Schedule');
  const startHandle = addDate(schedule, 'Start Date', cell.get('startDate') || '', v => cell.set('startDate', v));
  const endHandle = addDate(schedule, 'End Date', cell.get('endDate') || '', v => cell.set('endDate', v));
  prctx.bindLiveGanttDates(cell, [{ prop: 'startDate', handle: startHandle }, { prop: 'endDate', handle: endHandle }]);   // item 1: reflect drag/resize live (on mouse-up)

  // Appearance — canonical: Fill → Border → typography → custom features
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill', cell.attr('body/fill') || 'var(--node-bg)', v => {
    cell.attr('body/fill', v);
  });
  addColor(appearance, 'Border', cell.attr('body/stroke') || 'var(--node-border)', v => {
    cell.attr('body/stroke', v);
  });
  addColor(appearance, 'Label color', cell.get('userTextColor') || cell.attr('label/fill') || '#FFFFFF', v => {
    cell.set('userTextColor', v);
    cell.attr('label/fill', v);
    cell.attr('percentLabel/fill', v);
    cell.attr('assigneeLabel/fill', v);
  }, { defaultValue: '#FFFFFF' });
  addColor(appearance, 'Completion bar', cell.attr('progressBar/fill') || '#1D73C9', v => {
    cell.attr('progressBar/fill', v);
    cell.set('colorManual', true);   // manual colour → stops following the group (issue 6)
  }, { defaultValue: '#1D73C9' });

  finishStandardProps(cell, { sizeMode: 'pair', autoSize: true });
}

export function renderGanttMilestoneProps(cell) {
  // Content
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
  });
  prctx.bindLiveGanttDates(cell, [{ prop: 'milestoneDate', handle: addDate(content, 'Date', cell.get('milestoneDate') || '', v => cell.set('milestoneDate', v)) }]);   // item 1: live on drag

  // Appearance
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill', cell.attr('body/fill') || '#F6B355', v => cell.attr('body/fill', v), { defaultValue: '#F6B355' });
  addColor(appearance, 'Border', cell.attr('body/stroke') || '#D4942A', v => cell.attr('body/stroke', v), { defaultValue: '#D4942A' });
  addColor(appearance, 'Label color', cell.attr('label/fill'), v => cell.attr('label/fill', v));

  finishStandardProps(cell, { sizeMode: 'square', squareLabel: 'Size' });
}

export function renderGanttMarkerProps(cell) {
  // Content
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
  });
  // Phase 6: a date snaps the triangle to that column (data-first, like a milestone). Blank = free manual position.
  prctx.bindLiveGanttDates(cell, [{ prop: 'markerDate', handle: addDate(content, 'Date', cell.get('markerDate') || '', v => cell.set('markerDate', v)) }]);   // item 1: live on drag

  // Direction toggle
  const dirRow = document.createElement('div');
  dirRow.className = 'df-prop-pair';
  const isDown = cell.get('pointDown') === true;

  const upBtn = document.createElement('button');
  upBtn.className = 'df-properties__btn df-properties__btn--order';
  upBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><polygon points="8,2 14,14 2,14"/></svg> Point Up`;

  const downBtn = document.createElement('button');
  downBtn.className = 'df-properties__btn df-properties__btn--order';
  downBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><polygon points="2,2 14,2 8,14"/></svg> Point Down`;

  // Issue 4: the ACTIVE direction follows the primary brand colour (blue in light, red in dark) — the SVG triangle
  // inherits via currentColor, so the selected button + its arrow read as brand; the inactive one stays muted.
  const applyDirStyle = (down) => {
    upBtn.style.color = down ? '' : 'var(--color-primary)';
    upBtn.style.borderColor = down ? '' : 'var(--color-primary)';
    upBtn.style.opacity = down ? '0.55' : '1';
    downBtn.style.color = down ? 'var(--color-primary)' : '';
    downBtn.style.borderColor = down ? 'var(--color-primary)' : '';
    downBtn.style.opacity = down ? '1' : '0.55';
  };
  applyDirStyle(isDown);
  upBtn.addEventListener('click', () => {
    cell.set('pointDown', false);
    cell.attr('body/refPoints', '0,1 0.5,0 1,1');
    cell.attr('label/y', 'calc(h + 4)');
    cell.attr('label/textVerticalAnchor', 'top');
    applyDirStyle(false);
  });
  downBtn.addEventListener('click', () => {
    cell.set('pointDown', true);
    cell.attr('body/refPoints', '0,0 1,0 0.5,1');
    cell.attr('label/y', -4);
    cell.attr('label/textVerticalAnchor', 'bottom');
    applyDirStyle(true);
  });

  dirRow.appendChild(upBtn);
  dirRow.appendChild(downBtn);
  content.appendChild(dirRow);

  // Appearance
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill', cell.attr('body/fill') || '#DA4E55', v => cell.attr('body/fill', v), { defaultValue: '#DA4E55' });
  addColor(appearance, 'Border', cell.attr('body/stroke') || '#B03A40', v => cell.attr('body/stroke', v), { defaultValue: '#B03A40' });
  addColor(appearance, 'Label color', cell.attr('label/fill'), v => cell.attr('label/fill', v));

  // Size & Order
  const size = section(prctx.bodyEl, 'Size & Order');
  addNumber(size, 'Size', cell.size().width, v => cell.resize(v, Math.round(v * 0.8)));
  addOrderButtons(size, cell);

  // Delete
  addCloneBtn(prctx.footerEl, cell);
  addDeleteBtn(prctx.footerEl, () => { prctx.graph.removeCells([cell]); prctx.selection.clearSelection(); });
}

export function renderGanttTimelineProps(cell) {
  const viewMode = cell.get('viewMode') || 'week';
  const periodLabel = viewMode === 'day' ? 'days' : viewMode === 'week' ? 'weeks' : 'months';

  // Title & Description
  const titleSec = section(prctx.bodyEl, 'Content');
  addText(titleSec, 'Label', cell.get('timelineTitle') || 'Tasks', v => {
    cell.set('timelineTitle', v);
    prctx.titleEl.textContent = v || '';
  });
  addTextarea(titleSec, 'Description', cell.get('timelineDescription') || '', v => {
    cell.set('timelineDescription', v);
  });

  // Helper: calculate end date from start + periods
  function calcEndDate(startStr, periods, mode) {
    if (!startStr) return '';
    const d = new Date(startStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    if (mode === 'day') {
      d.setDate(d.getDate() + periods);
    } else if (mode === 'week') {
      d.setDate(d.getDate() + periods * 7);
    } else {
      d.setMonth(d.getMonth() + periods);
    }
    return d.toISOString().slice(0, 10);
  }

  // Helper: calculate periods from start to end
  function calcPeriods(startStr, endStr, mode) {
    if (!startStr || !endStr) return null;
    const s = new Date(startStr + 'T00:00:00');
    const e = new Date(endStr + 'T00:00:00');
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return null;
    if (mode === 'day') {
      return Math.max(1, Math.ceil((e - s) / 86400000) + 1);
    } else if (mode === 'week') {
      return Math.max(1, Math.ceil((e - s) / (7 * 86400000)));
    } else {
      return Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()));
    }
  }

  // Timeline settings
  const content = section(prctx.bodyEl, 'Timeline');

  // Start Date — changing it recalculates end date from periods
  addDate(content, 'Start Date', cell.get('startDate') || '', v => {
    cell.set('startDate', v);
    const end = calcEndDate(v, cell.get('numPeriods') || 12, cell.get('viewMode') || 'week');
    if (end) cell.set('endDate', end, { silent: true });
    prctx.showProperties(cell);
  });

  // End Date — changing it recalculates periods and resizes to keep column width constant
  addDate(content, 'End Date', cell.get('endDate') || calcEndDate(cell.get('startDate'), cell.get('numPeriods') || 12, viewMode), v => {
    cell.set('endDate', v);
    const oldPeriods = cell.get('numPeriods') || 12;
    const taskListW = (cell.get('tasks') || []).length ? (cell.get('taskListWidth') || 200) : 0;
    const currentWidth = cell.size().width;
    const timelineW = currentWidth - taskListW;
    const colW = timelineW / oldPeriods;
    const p = calcPeriods(cell.get('startDate'), v, cell.get('viewMode') || 'week');
    if (p) {
      const clamped = Math.max(2, Math.min(104, p));
      cell.set('numPeriods', clamped);
      const newWidth = Math.round(taskListW + colW * clamped);
      cell.resize(newWidth, cell.size().height);
    }
    prctx.showProperties(cell);
  });

  // Phase 6: Today line — a date draws a full-height dashed line at that column (blank = no line).
  addDate(content, 'Today line', cell.get('todayDate') || '', v => cell.set('todayDate', v));

  // Periods — number input with non-editable unit suffix
  addNumberWithSuffix(content, 'Periods', cell.get('numPeriods') || 12, periodLabel, v => {
    const clamped = Math.max(2, Math.min(104, v));
    const oldPeriods = cell.get('numPeriods') || 12;
    const taskListW = (cell.get('tasks') || []).length ? (cell.get('taskListWidth') || 200) : 0;
    const currentWidth = cell.size().width;
    const timelineW = currentWidth - taskListW;
    const colW = timelineW / oldPeriods;
    // Resize timeline to keep period width constant
    const newWidth = Math.round(taskListW + colW * clamped);
    cell.set('numPeriods', clamped);
    cell.resize(newWidth, cell.size().height);
    const end = calcEndDate(cell.get('startDate'), clamped, cell.get('viewMode') || 'week');
    if (end) cell.set('endDate', end, { silent: true });
    prctx.showProperties(cell);
  });

  // ── Tasks section ──
  const tasksSec = section(prctx.bodyEl, 'Tasks');
  renderTimelineTaskEditor(tasksSec, cell);

  // Appearance
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill', cell.attr('body/fill') || 'var(--bg-surface-raised)', v => {
    cell.attr('body/fill', v);
  });
  addColor(appearance, 'Top row', cell.attr('topRow/fill') || 'var(--node-bg)', v => {
    cell.attr('topRow/fill', v);
  });
  addColor(appearance, 'Border', cell.attr('body/stroke') || 'var(--node-border)', v => {
    cell.attr('body/stroke', v);
    cell.attr('divider/stroke', v);
  });

  finishStandardProps(cell, { sizeMode: 'widthOnly' });
}

export function renderGanttGroupProps(cell) {
  // Content
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.attr('label/text'), v => {
    cell.attr('label/text', v);
    prctx.titleEl.textContent = v || '';
  });

  // Phase 6: link this summary bar to a timeline GROUP → it auto-spans that group's tasks (x+width derived).
  const tl = ganttTimelineFor(cell);
  const groups = (tl && tl.get('groups')) || [];
  const linkedId = cell.get('groupId') || '';
  const opts = [{ value: '', label: 'None (manual width)' }, ...groups.map(g => ({ value: String(g.id), label: g.label || 'Group' }))];
  addSelect(content, 'Spans group', linkedId, opts, v => {
    cell.set('groupId', v || null);
    if (v) applyGanttGroupGeometry(cell);   // snap to the group's span immediately
    prctx.showProperties(cell);                   // re-render (the Width control hides when linked)
  });

  // Appearance
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Bar color', cell.attr('body/fill') || '#2A2D32', v => {
    cell.attr('body/fill', v);
    cell.attr('leftProng/fill', v);
    cell.attr('rightProng/fill', v);
  }, { defaultValue: '#2A2D32' });
  addColor(appearance, 'Label color', cell.attr('label/fill'), v => cell.attr('label/fill', v));

  // Width is manual only when UNLINKED; a linked group's width spans its tasks (derived).
  finishStandardProps(cell, { sizeMode: 'none', sizeExtras: (s) => {
    if (!cell.get('groupId')) addNumber(s, 'Width', cell.size().width, w => cell.resize(w, cell.size().height));
  } });
}

export function renderTimelineTaskEditor(parent, cell) {
  // Phase 4.6: bars + groups[] are the ONLY model — every timeline reaches here with bars (fresh seed / stencil
  // drop) or gets migrated to bars on load, and an empty timeline still gets the +Task / +Group buttons. The
  // legacy tasks[] editor is gone.
  renderBarTaskEditor(parent, cell);
}

// Phase 4.4/4.5b.2: CRUD the BAR cells (sf.GanttTask) + the timeline's groups[] — both are the source of truth.
// The editor list mirrors the unified ganttRowLayout (group headers interleaved with their bars), so the panel
// (the 4.2 subscription) and the editor agree. A bar is dragged onto a group header to JOIN it; deleting a group
// ORPHANS its bars to ungrouped (never deletes the user's scheduled cells). Group reordering is deferred.
export function renderBarTaskEditor(parent, cell) {
  const listEl = document.createElement('div');
  listEl.className = 'df-timeline-task-list';

  // Drop a dragged BAR (its index in timelineBars, carried in the drag data) onto this group → set its groupId.
  function assignBarToGroup(fromIdx, groupId) {
    const bars = timelineBars(cell);
    const moved = bars[Number(fromIdx)];
    if (!moved || (moved.get('groupId') || null) === (groupId || null)) return;
    history.startBatch();
    try { moved.set('groupId', groupId); resequenceGanttOrders(cell); } finally { history.endBatch(); }
    rebuild();
  }

  // Issue 5: reorder a GROUP (drag it by its handle) — insert it before `beforeGroupId` (null = the end) and renumber
  // every group's `order`; its tasks follow because the layout sorts groups by order.
  function reorderGroup(fromId, beforeGroupId) {
    if (!fromId || fromId === beforeGroupId) return;
    let gs = (cell.get('groups') || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const fromIdx = gs.findIndex(g => g.id === fromId);
    if (fromIdx < 0) return;
    const [moved] = gs.splice(fromIdx, 1);
    let to = beforeGroupId ? gs.findIndex(g => g.id === beforeGroupId) : gs.length;
    if (to < 0) to = gs.length;
    gs.splice(to, 0, moved);
    gs = gs.map((g, idx) => ({ ...g, order: idx }));
    history.startBatch();
    try { cell.set('groups', gs); resequenceGanttOrders(cell); } finally { history.endBatch(); }
    rebuild();
  }

  // A drag handle that carries `dragData` (a bar index, or "group:<id>"); shared by group + bar rows.
  const DRAG_SVG = '<svg viewBox="0 0 10 14" fill="currentColor"><circle cx="3" cy="2" r="1.2"/><circle cx="7" cy="2" r="1.2"/><circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="3" cy="12" r="1.2"/><circle cx="7" cy="12" r="1.2"/></svg>';
  function makeDragHandle(dragData, row) {
    const h = document.createElement('span');
    h.className = 'df-timeline-task-drag';
    h.innerHTML = DRAG_SVG;
    h.draggable = true;
    h.addEventListener('dragstart', (evt) => { evt.dataTransfer.effectAllowed = 'move'; evt.dataTransfer.setData('text/plain', dragData); row.style.opacity = '0.4'; });
    h.addEventListener('dragend', () => { row.style.opacity = ''; listEl.querySelectorAll('.df-timeline-task-row--drag-over').forEach(r => r.classList.remove('df-timeline-task-row--drag-over')); });
    return h;
  }

  function renderGroupRow(group) {
    const row = document.createElement('div');
    row.className = 'df-timeline-task-row df-timeline-task-row--group';

    // A bar dropped onto the group header joins the group; a GROUP dropped here reorders before this group.
    row.addEventListener('dragover', (evt) => { evt.preventDefault(); evt.dataTransfer.dropEffect = 'move'; row.classList.add('df-timeline-task-row--drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('df-timeline-task-row--drag-over'));
    row.addEventListener('drop', (evt) => {
      evt.preventDefault();
      row.classList.remove('df-timeline-task-row--drag-over');
      const data = evt.dataTransfer.getData('text/plain');
      if (data.startsWith('group:')) reorderGroup(data.slice(6), group.id);
      else if (data !== '') assignBarToGroup(data, group.id);
    });

    // Drag handle → reorder this group among the groups (issue 5).
    row.appendChild(makeDragHandle('group:' + group.id, row));

    // Colour → groups[i].color (immutable rewrite; the panel header indicator reads it).
    const colorBtn = document.createElement('input');
    colorBtn.type = 'color';
    colorBtn.className = 'df-timeline-task-color';
    colorBtn.value = toHex(group.color || '#5B5FC7');
    colorBtn.addEventListener('input', asUndoBatch(() => {
      const gs = (cell.get('groups') || []).map(g => g.id === group.id ? { ...g, color: colorBtn.value } : g);
      cell.set('groups', gs);
    }));
    row.appendChild(colorBtn);

    // Label → groups[i].label.
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'df-properties__input df-timeline-task-label';
    labelInput.value = group.label || '';
    labelInput.placeholder = 'Group name';
    labelInput.addEventListener('input', asUndoBatch(() => {
      const gs = (cell.get('groups') || []).map(g => g.id === group.id ? { ...g, label: labelInput.value } : g);
      cell.set('groups', gs);
    }));
    row.appendChild(labelInput);

    // Delete → ORPHAN the group's bars to ungrouped (keep the scheduled cells), then drop the group.
    const delBtn = document.createElement('button');
    delBtn.className = 'df-field-delete';
    delBtn.textContent = '×';
    delBtn.title = 'Remove group (keeps its tasks)';
    delBtn.addEventListener('click', () => {
      history.startBatch();
      try {
        timelineBars(cell).filter(b => b.get('groupId') === group.id).forEach(b => b.set('groupId', null));
        cell.set('groups', (cell.get('groups') || []).filter(g => g.id !== group.id));
        resequenceGanttOrders(cell);
      } finally { history.endBatch(); }
      rebuild();
    });
    row.appendChild(delBtn);

    listEl.appendChild(row);
  }

  function renderBarRow(bar, i) {
    const row = document.createElement('div');
    row.className = 'df-timeline-task-row df-timeline-task-row--task';
    row.dataset.index = i;

    // Drag handle → reorder among bars (rewrite `order` + re-layout); the drag data is the bar index.
    const dragHandle = document.createElement('span');
    dragHandle.className = 'df-timeline-task-drag';
    dragHandle.innerHTML = '<svg viewBox="0 0 10 14" fill="currentColor"><circle cx="3" cy="2" r="1.2"/><circle cx="7" cy="2" r="1.2"/><circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="3" cy="12" r="1.2"/><circle cx="7" cy="12" r="1.2"/></svg>';
    dragHandle.draggable = true;
    dragHandle.addEventListener('dragstart', (evt) => {
      evt.dataTransfer.effectAllowed = 'move';
      evt.dataTransfer.setData('text/plain', String(i));
      row.style.opacity = '0.4';
    });
    dragHandle.addEventListener('dragend', () => {
      row.style.opacity = '';
      listEl.querySelectorAll('.df-timeline-task-row--drag-over').forEach(r => r.classList.remove('df-timeline-task-row--drag-over'));
    });
    row.appendChild(dragHandle);

    row.addEventListener('dragover', (evt) => { evt.preventDefault(); evt.dataTransfer.dropEffect = 'move'; row.classList.add('df-timeline-task-row--drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('df-timeline-task-row--drag-over'));
    row.addEventListener('drop', (evt) => {
      evt.preventDefault();
      row.classList.remove('df-timeline-task-row--drag-over');
      const data = evt.dataTransfer.getData('text/plain');
      if (data.startsWith('group:')) { reorderGroup(data.slice(6), bar.get('groupId') || null); return; }   // group → before this task's group
      const fromIdx = parseInt(data, 10);
      const toIdx = i;
      if (isNaN(fromIdx) || fromIdx === toIdx) return;
      const ordered = timelineBars(cell);
      const [moved] = ordered.splice(fromIdx, 1);
      ordered.splice(toIdx > fromIdx ? toIdx : toIdx + 1, 0, moved);   // insert AFTER the drop target (matches the below-indicator)
      history.startBatch();
      try {
        ordered.forEach((b, idx) => { if (b.get('order') !== idx) b.set('order', idx); });
        ordered.forEach(b => applyGanttGeometry(b, cell));
      } finally { history.endBatch(); }
      rebuild();
    });

    // Colour → the bar's progress fill (the panel row dot reads the same attr).
    const colorBtn = document.createElement('input');
    colorBtn.type = 'color';
    colorBtn.className = 'df-timeline-task-color';
    colorBtn.value = toHex(bar.attr('progressBar/fill') || '#1D73C9');
    colorBtn.addEventListener('input', asUndoBatch(() => { bar.attr('progressBar/fill', colorBtn.value); bar.set('colorManual', true); }));
    row.appendChild(colorBtn);

    // Label → taskLabel + the rendered on-bar text. Don't rebuild on input (keeps focus while typing).
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'df-properties__input df-timeline-task-label';
    labelInput.value = bar.get('taskLabel') || bar.attr('label/text') || '';
    labelInput.placeholder = 'Task name';
    labelInput.addEventListener('input', asUndoBatch(() => { bar.set('taskLabel', labelInput.value); bar.attr('label/text', labelInput.value); }));
    row.appendChild(labelInput);

    // Delete → remove the bar CELL + close the order gap.
    const delBtn = document.createElement('button');
    delBtn.className = 'df-field-delete';
    delBtn.textContent = '×';
    delBtn.title = 'Remove';
    delBtn.addEventListener('click', () => {
      history.startBatch();
      try { prctx.graph.removeCells([bar]); resequenceGanttOrders(cell); } finally { history.endBatch(); }
      rebuild();
    });
    row.appendChild(delBtn);

    listEl.appendChild(row);
  }

  function rebuild() {
    listEl.innerHTML = '';
    // Mirror the unified layout: group headers interleaved with their bars (bar rows carry their bar index).
    let barIdx = 0;
    ganttRowLayout(cell).forEach((lr) => {
      if (lr.kind === 'group') {
        const group = (cell.get('groups') || []).find(g => g.id === lr.id);
        if (group) renderGroupRow(group);
      } else {
        renderBarRow(lr.bar, barIdx++);
      }
    });

    const btnRow = document.createElement('div');
    btnRow.className = 'df-timeline-task-actions';

    // + Group → append a group header to groups[]. Bars are dragged onto it to join.
    const addGroupBtn = document.createElement('button');
    addGroupBtn.className = 'df-properties__btn df-properties__btn--add-field';
    addGroupBtn.textContent = '+ Group';
    addGroupBtn.addEventListener('click', asUndoBatch(() => {
      const gs = [...(cell.get('groups') || [])];
      gs.push({ id: 'g' + Date.now() + '_' + gs.length, label: 'New Group', color: '#5B5FC7', order: gs.length });
      cell.set('groups', gs);
      rebuild();
    }));
    btnRow.appendChild(addGroupBtn);

    // + Task → a dated bar (next order, start → +7 days), embedded in the timeline. One undo.
    const addTaskBtn = document.createElement('button');
    addTaskBtn.className = 'df-properties__btn df-properties__btn--add-field';
    addTaskBtn.textContent = '+ Task';
    addTaskBtn.addEventListener('click', () => {
      const order = timelineBars(cell).length;
      const pad = (n) => String(n).padStart(2, '0');
      const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const startStr = cell.get('startDate') || isoOf(new Date());
      const ed = new Date(startStr + 'T00:00:00'); ed.setDate(ed.getDate() + 7);
      history.startBatch();
      try {
        const bar = new joint.shapes.sf.GanttTask({ order, groupId: null, taskLabel: 'New Task', startDate: startStr, endDate: isoOf(ed), attrs: { label: { text: 'New Task' } } });
        prctx.graph.addCell(bar);
        cell.embed(bar);
        if (!applyGanttGeometry(bar, cell)) bar.position(cell.position().x + (cell.get('taskListWidth') || 200), orderToY(cell, order), { gantt: true });
      } finally { history.endBatch(); }
      rebuild();
    });
    btnRow.appendChild(addTaskBtn);
    listEl.appendChild(btnRow);
  }

  rebuild();
  parent.appendChild(listEl);
}

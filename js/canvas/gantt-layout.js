// Gantt geometry binding: makes a task bar's x + width DERIVE from its start/end DATES (via the pure gantt-scale
// engine) against its timeline's axis. The dates become the single source of truth — edit a date (property panel /
// table / LLM-authored JSON) and the bar moves to the right column. Shared by the shapes views (live edits +
// timeline re-layout) and the load migration (migrateNodes). Back-compat: a task with no dates, or no resolvable
// timeline, keeps its manual pixel position untouched.
import { dateToX, spanWidth, xToDate } from './gantt-scale.js?v=1.19.1.1';

/** The timeline a task belongs to: its embed parent if that's a timeline, else the SINGLE timeline in the graph (so
 *  an LLM/table needn't set embedding when there's only one). Null when ambiguous (multiple, none) and not embedded. */
export function ganttTimelineFor(task) {
  const parent = task.getParentCell && task.getParentCell();
  if (parent && parent.get('type') === 'sf.GanttTimeline') return parent;
  const graph = task.graph;
  if (!graph) return null;
  const tls = graph.getElements().filter((e) => e.get('type') === 'sf.GanttTimeline');
  return tls.length === 1 ? tls[0] : null;
}

/** How many dated/undated GanttTask BARS are bound to this timeline (embedded in it, or — when it's the sole
 *  timeline — every bar in the graph; same binding rule as ganttTimelineFor). Phase 4.0: the axis left-panel
 *  reserves space when there are label rows OR bars, so bars become first-class without needing `tasks[]`. */
export function timelineBarCount(tl) {
  const graph = tl && tl.graph;
  if (!graph) return 0;
  let n = 0;
  for (const e of graph.getElements()) {
    if (e.get('type') === 'sf.GanttTask' && ganttTimelineFor(e) === tl) n++;
  }
  return n;
}

/** Phase 4.2: project the timeline's left-panel ROWS from its BARS — the bars own the record, the panel is
 *  derived. Each bound GanttTask becomes a row { id, label, color, cy } where `cy` is the bar's centre Y RELATIVE
 *  to the timeline (so the row label aligns to the bar). Sorted top-to-bottom. Returns [] when the timeline has no
 *  bars, so the caller falls back to the legacy `tasks[]` label rows (back-compat until the 4.5 migration). */
export function timelineRows(tl) {
  const graph = tl && tl.graph;
  if (!graph) return [];
  const ty = tl.position().y;
  const rows = [];
  for (const e of graph.getElements()) {
    if (e.get('type') === 'sf.GanttTask' && ganttTimelineFor(e) === tl) {
      rows.push({
        id: e.id,
        label: e.get('taskLabel') || e.attr('label/text') || 'Task',
        color: e.attr('progressBar/fill') || null,
        cy: e.position().y + e.size().height / 2 - ty,
      });
    }
  }
  rows.sort((a, b) => a.cy - b.cy);
  return rows;
}

/** The GanttTask bar CELLS bound to this timeline, sorted by `order` (orderless bars sink to the end). Phase 4.4:
 *  the task-list editor CRUDs these cells directly — bars are the source of truth. */
export function timelineBars(tl) {
  const graph = tl && tl.graph;
  if (!graph) return [];
  return graph.getElements()
    .filter(e => e.get('type') === 'sf.GanttTask' && ganttTimelineFor(e) === tl)
    .sort((a, b) => (a.get('order') ?? 1e9) - (b.get('order') ?? 1e9));
}

/** Phase 4.5b: the UNIFIED ordered ROW list — group headers interleaved with their bars, then ungrouped bars.
 *  BOTH the panel (_renderColumns) and the geometry (orderToY via barRowIndex) consume THIS, so they can never
 *  disagree. Returns [{ kind:'group'|'bar', rowIndex, id, label, color, groupId, bar? }] top-to-bottom. With no
 *  groups it is exactly the bars in `order` (rowIndex === order) → byte-identical to the pre-4.5b layout. A bar
 *  whose `groupId` references a missing group falls back to ungrouped (renders normally, never vanishes). */
export function ganttRowLayout(tl) {
  const bars = timelineBars(tl);
  const groups = ((tl && tl.get('groups')) || []).slice().sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
  const byGroup = new Map();
  const ungrouped = [];
  for (const b of bars) {
    const gid = b.get('groupId') || null;
    if (gid && groups.some(g => g.id === gid)) {
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid).push(b);
    } else { ungrouped.push(b); }
  }
  const rows = [];
  let rowIndex = 0;
  const barRow = (b, gid) => ({ kind: 'bar', rowIndex: rowIndex++, id: b.id, bar: b, groupId: gid,
    label: b.get('taskLabel') || b.attr('label/text') || 'Task', color: b.attr('progressBar/fill') || null });
  for (const g of groups) {
    rows.push({ kind: 'group', rowIndex: rowIndex++, id: g.id, label: g.label, color: g.color || null, groupId: g.id });
    for (const b of (byGroup.get(g.id) || [])) rows.push(barRow(b, g.id));
  }
  for (const b of ungrouped) rows.push(barRow(b, null));
  return rows;
}

const rowIndexIn = (layout, bar) => {
  const row = layout.find(r => r.kind === 'bar' && r.id === bar.id);
  return row ? row.rowIndex : (bar.get('order') ?? 0);
};

/** The unified row index for one bar (its slot, counting the group headers above it). */
export function barRowIndex(bar, tl = ganttTimelineFor(bar)) {
  return tl ? rowIndexIn(ganttRowLayout(tl), bar) : (bar.get('order') ?? 0);
}

/** Phase 3: this task's PREDECESSORS — derived (never stored as a `dependsOn` array) from the inbound
 *  `ganttDep` links, which ARE the source of truth. Each → { predecessorId, depType, lag, linkId }.
 *  `depType` defaults to FS, `lag` to 0. The Table view + a future critical-path read THIS. */
export function ganttDependencies(task) {
  const graph = task && task.graph;
  if (!graph) return [];
  return graph.getConnectedLinks(task, { inbound: true })
    .filter(l => l.prop('linkKind') === 'ganttDep')
    .map(l => ({
      predecessorId: l.get('source') && l.get('source').id || null,
      depType: l.prop('depType') || 'FS',
      lag: l.prop('lag') || 0,
      linkId: l.id,
    }))
    .filter(d => d.predecessorId);
}

/** The timeline-axis props bag gantt-scale needs, read from the timeline MODEL. */
function axisProps(tl) {
  return {
    x: tl.position().x, width: tl.size().width,
    taskListWidth: tl.get('taskListWidth'), numPeriods: tl.get('numPeriods'),
    viewMode: tl.get('viewMode'), startDate: tl.get('startDate'),
    weekStartDay: tl.get('weekStartDay'), tasksLen: (tl.get('tasks') || []).length,
    barCount: timelineBarCount(tl),
  };
}

// Row-layout constants — MUST match GanttTimelineView._renderColumns (shapes.js): the header is dateH(48) +
// phaseRow(40); a 32-tall bar is centred in a 48-tall row by +8. Shared so the seed, the Y-from-order geometry,
// and the panel projection never drift apart.
export const GANTT_HEADER_H = 88;
export const GANTT_BAR_DY = 8;
// Phase 6: the optional "Project Summary" overview lane (Display menu toggle → timeline.showProjectSummary). When
// on it sits between the header and the first row, so the WHOLE header band — and every bar/panel-row below —
// shifts down by this much. orderToY + the view's headerH BOTH read ganttHeaderH so they never drift.
export const GANTT_SUMMARY_ROW_H = 44;

// The Timeline Summary lane stacks each GROUP in its own SUBROW (so overlapping group spans never collide) + one
// subrow for the milestone/marker glyphs. The lane grows with the group count.
export const GANTT_SUMMARY_GROUP_H = 16;    // a group subrow
export const GANTT_SUMMARY_MARKER_H = 24;   // the milestone/marker subrow (glyph + label)
/** Height of the Timeline Summary lane for `tl` — one subrow per group + the marker subrow, floored at the base. */
export function ganttSummaryLaneH(tl) {
  const n = ((tl && tl.get('groups')) || []).length;
  return Math.max(GANTT_SUMMARY_ROW_H, n * GANTT_SUMMARY_GROUP_H + GANTT_SUMMARY_MARKER_H + 8);
}

/** Effective header height for a timeline: dates(48) + a band below them. With the Timeline Summary lane ON, that
 *  band IS the lane (per-group subrows). With it OFF the band is the 40px phase row ONLY when there's a description
 *  to show there — otherwise it collapses to 0 so the first row sits directly under the dates (no empty gap). */
export function ganttHeaderH(tl) {
  if (tl && tl.get('showProjectSummary')) return 48 + ganttSummaryLaneH(tl);
  const hasDesc = !!(tl && (tl.get('timelineDescription') || '').trim());
  return 48 + (hasDesc ? 40 : 0);
}

/** Issue 7: recolour every NON-manual bar bound to `tl` to its group's current colour. Covers the cases the
 *  per-task `change:groupId` listener can't see: a group's colour edited (`change:groups` on the timeline) or a
 *  fresh seed/drop. A bar with `colorManual` (user picked a colour) is left alone; an ungrouped bar is left alone. */
export function recolorGroupTasks(tl) {
  if (!tl) return;
  const groups = tl.get('groups') || [];
  for (const bar of timelineBars(tl)) {
    if (bar.get('colorManual')) continue;
    const grp = groups.find((g) => g.id === bar.get('groupId'));
    if (grp && grp.color && bar.attr('progressBar/fill') !== grp.color) bar.attr('progressBar/fill', grp.color);
  }
}

/** Issue 5: grow a timeline so it covers every bound element's date. When a task (or milestone/marker) is dragged or
 *  resized so its end falls past the axis, extend `numPeriods` (and the timeline WIDTH by the same number of columns,
 *  so column width stays constant - the timeline physically grows to the right, it doesn't just cram more columns in).
 *  GROW-only: pulling a task back in never shrinks the timeline. Returns true when it grew. */
export function growTimelineToFitDates(tl) {
  if (!tl) return false;
  const vm = tl.get('viewMode') || 'week';
  const start = tl.get('startDate');
  if (!start) return false;
  const base = new Date(start + 'T00:00:00');
  let maxEnd = null;
  const consider = (iso) => { if (iso && (!maxEnd || iso > maxEnd)) maxEnd = iso; };
  const graph = tl.graph;
  if (!graph) return false;
  for (const e of graph.getElements()) {
    if (ganttTimelineFor(e) !== tl) continue;
    const t = e.get('type');
    if (t === 'sf.GanttTask') consider(e.get('endDate'));
    else if (t === 'sf.GanttMilestone') consider(e.get('milestoneDate'));
    else if (t === 'sf.GanttMarker') consider(e.get('markerDate'));
  }
  if (!maxEnd) return false;
  const end = new Date(maxEnd + 'T00:00:00');
  const dayMs = 86400000;
  let needed;
  if (vm === 'day') needed = Math.ceil((end - base) / dayMs);
  else if (vm === 'month') needed = (end.getFullYear() - base.getFullYear()) * 12 + (end.getMonth() - base.getMonth()) + (end.getDate() > base.getDate() ? 1 : 0);
  else needed = Math.ceil((end - base) / (7 * dayMs));
  needed += 1;   // one column of breathing room past the last element
  const cur = tl.get('numPeriods') || 12;
  if (needed <= cur) return false;
  const taskListWidth = tl.get('taskListWidth') || 200;
  const colW = (tl.size().width - taskListWidth) / cur;
  tl.set('numPeriods', needed);
  tl.resize(Math.round(taskListWidth + needed * colW), tl.size().height);
  return true;
}

/** Absolute canvas Y a bar should sit at for a given `order` row index (timeline-relative + the timeline's y). */
export function orderToY(tl, order) {
  const rowHeight = Math.max(tl.get('rowHeight') || 48, 48);
  return tl.position().y + ganttHeaderH(tl) + order * rowHeight + GANTT_BAR_DY;
}

/** Live drag column snap (item 3): snap an absolute x (a bar's left edge, or a milestone/marker centre) to the
 *  nearest period-column boundary on tl's axis. Returns the snapped x (same space as input), or null (no axis). */
export function snapGanttX(tl, x) {
  if (!tl) return null;
  const t = axisProps(tl);
  const iso = xToDate(t, x);
  if (!iso) return null;
  const sx = dateToX(t, iso);
  return sx == null ? null : Math.round(sx);
}

/** Live drag ROW snap: the absolute Y of the nearest row CENTRE to `centreY`, so a dragged milestone / day marker
 *  lines up on a task row instead of floating between rows. Clamped to the existing rows. Null when no rows. */
export function snapGanttRowCentreY(tl, centreY) {
  if (!tl) return null;
  const rows = ganttRowLayout(tl);
  if (!rows.length) return null;
  const rowHeight = Math.max(tl.get('rowHeight') || 48, 48);
  const top0 = tl.position().y + ganttHeaderH(tl);   // top of row 0
  let idx = Math.round((centreY - top0 - rowHeight / 2) / rowHeight);
  idx = Math.max(0, Math.min(rows.length - 1, idx));
  return top0 + idx * rowHeight + rowHeight / 2;
}

/** Reorder-drag drop target (items 1-2): from the pointer's ABSOLUTE y over a timeline, the row slot the dragged
 *  bar would drop into. Returns { groupId, dropY, lineLocalY, slot, moved } — `groupId` is the group the slot
 *  falls in (inherited from the row just above, so dropping into a group's region joins it; null = ungrouped
 *  tail), `dropY` is the ABSOLUTE y to park the bar at so resequenceGanttOrders sorts it into that slot,
 *  `lineLocalY` is the timeline-local y to draw the drop line, and `moved` is false when the slot is the bar's
 *  CURRENT position (a pure horizontal drag → keep the bar's group + order, never reassign). Null when no rows. */
export function ganttDropTarget(tl, pointerY, draggedBar) {
  const rows = ganttRowLayout(tl);
  if (!rows.length) return null;
  const rowHeight = Math.max(tl.get('rowHeight') || 48, 48);
  const headerLocal = ganttHeaderH(tl);
  const localY = pointerY - tl.position().y;
  const minSlot = rows[0].kind === 'group' ? 1 : 0;   // can't insert above a leading group header
  let slot = Math.round((localY - headerLocal) / rowHeight);
  slot = Math.max(minSlot, Math.min(rows.length, slot));
  const lineLocalY = headerLocal + slot * rowHeight;
  // A real move? The dragged bar currently occupies some rowIndex; inserting at its own slot or the one just below
  // is a no-op. On a no-op, KEEP the bar's group (the row-above heuristic would wrongly reassign at a group edge).
  const cur = draggedBar ? rows.find(r => r.kind === 'bar' && r.id === draggedBar.id) : null;
  const curIdx = cur ? cur.rowIndex : -1;
  const moved = !(slot === curIdx || slot === curIdx + 1);
  let groupId;
  if (!moved && draggedBar) groupId = draggedBar.get('groupId') || null;
  else { const above = slot > 0 ? rows[slot - 1] : null; groupId = above ? (above.groupId ?? null) : null; }
  return { groupId, dropY: tl.position().y + lineLocalY, lineLocalY, slot, moved };
}

/** Where in the group `order` sequence a NEW group dropped at absolute `pointerY` should land — the count of group
 *  headers above the drop row. Default (dropped below everything) → groups.length (appended LAST). Lets a Project
 *  Phase drop insert at a specific place yet append at the bottom by default. */
export function ganttGroupInsertOrder(tl, pointerY) {
  const rows = ganttRowLayout(tl);
  const rowHeight = Math.max(tl.get('rowHeight') || 48, 48);
  const localY = pointerY - tl.position().y;
  const slot = Math.max(0, Math.min(rows.length, Math.round((localY - ganttHeaderH(tl)) / rowHeight)));
  let groupsAbove = 0;
  for (let i = 0; i < slot && i < rows.length; i++) if (rows[i].kind === 'group') groupsAbove++;
  return groupsAbove;
}

/** Issue 6: the TIMELINE-LOCAL Y of the insertion line for a phase/group drop at `pointerY` - the top edge of the
 *  slot the group would land in (slot 0 = above the first row), so the drop-target bar previews exactly where it goes. */
export function ganttGroupInsertSlotY(tl, pointerY) {
  const rows = ganttRowLayout(tl);
  const rowHeight = Math.max(tl.get('rowHeight') || 48, 48);
  const localY = pointerY - tl.position().y;
  const slot = Math.max(0, Math.min(rows.length, Math.round((localY - ganttHeaderH(tl)) / rowHeight)));
  return ganttHeaderH(tl) + slot * rowHeight;
}

/** Position + size a GanttTask bar from its dates (x/width) and its `order` row index (Y). Returns true when it
 *  derived geometry, false when it left the bar's manual pixels alone (no dates / no timeline / unparseable). The
 *  `{ gantt:true }` change opt marks these as layout-driven so the drag write-back can tell them from a user move.
 *  Phase 4.3: the Y derives from `order` (snaps to a row slot); an orderless bar keeps its manual Y (back-compat
 *  until the 4.5 migration assigns order). */
export function applyGanttGeometryWithLayout(task, tl, layout) {
  const start = task.get('startDate'), end = task.get('endDate');
  if (!start || !end || !tl) return false;
  const t = axisProps(tl);
  const x = dateToX(t, start);
  const w = spanWidth(t, start, end);
  if (x == null || w == null) return false;
  const order = task.get('order');
  const y = (order != null) ? orderToY(tl, rowIndexIn(layout, task)) : task.position().y;
  task.position(Math.round(x), Math.round(y), { gantt: true });
  task.resize(Math.max(8, Math.round(w)), task.size().height, { gantt: true });
  return true;
}
export function applyGanttGeometry(task, tl = ganttTimelineFor(task)) {
  return tl ? applyGanttGeometryWithLayout(task, tl, ganttRowLayout(tl)) : false;
}

/** Re-derive every dated bar that belongs to `tl` — called when the timeline's axis (start / viewMode / numPeriods /
 *  width / groups) changes, so the bars track the ruler. Builds the row layout ONCE (avoids O(n^2)). */
export function layoutTimelineTasks(tl) {
  const graph = tl.graph;
  if (!graph) return;
  const layout = ganttRowLayout(tl);
  for (const e of graph.getElements()) {
    const type = e.get('type');
    if (type === 'sf.GanttTask' && ganttTimelineFor(e) === tl) applyGanttGeometryWithLayout(e, tl, layout);
    // Milestones + dated markers track the same axis (dates → x), so a ruler change slides them too.
    else if (type === 'sf.GanttMilestone' && ganttTimelineFor(e) === tl) applyGanttMilestoneGeometry(e, tl);
    else if (type === 'sf.GanttMarker' && ganttTimelineFor(e) === tl) applyGanttMarkerGeometry(e, tl);
    // A linked summary bar spans its group's tasks (date-based → order-independent vs the bars above).
    else if (type === 'sf.GanttGroup' && ganttTimelineFor(e) === tl) applyGanttGroupGeometry(e, tl);
  }
}

/** The timeline's bars in their CURRENT visual (Y) order, GROUP-AWARE (sorted by Y within each group, groups by
 *  their order, then ungrouped by Y) — the canonical `order` sequence the panel + geometry agree on. Shared by the
 *  drag re-sequence and the load back-fill so both assign identical orders. */
function ganttBarsByVisualOrder(tl, bars) {
  const groups = ((tl && tl.get('groups')) || []).slice().sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
  const byY = (gid) => bars.filter(b => (b.get('groupId') || null) === gid).sort((a, b) => a.position().y - b.position().y);
  const seq = [];
  for (const g of groups) seq.push(...byY(g.id));
  seq.push(...bars.filter(b => { const gid = b.get('groupId') || null; return !gid || !groups.some(g => g.id === gid); }).sort((a, b) => a.position().y - b.position().y));
  return seq;
}

/** Phase 4.3: after a VERTICAL drag, re-sequence the timeline's bars' `order` from their CURRENT Y, then snap each
 *  back to its slot. Phase 4.5b: GROUP-AWARE — bars sort by Y WITHIN their group (then group order), so a small
 *  vertical nudge never jumps groups; group reassignment-by-drag is a later increment. No-op for an orderless
 *  (legacy) timeline. */
export function resequenceGanttOrders(tl) {
  const bars = timelineBars(tl);
  if (!bars.length || bars.every(b => b.get('order') == null)) return;
  const seq = ganttBarsByVisualOrder(tl, bars);
  seq.forEach((b, i) => { if (b.get('order') !== i) b.set('order', i); });
  const layout = ganttRowLayout(tl);
  seq.forEach(b => applyGanttGeometryWithLayout(b, tl, layout));
}

/** Load heal: a GanttTask with NO `order` keeps its MANUAL Y (applyGanttGeometryWithLayout), but the panel places
 *  its row by `order`-sorted `ganttRowLayout` — so an orderless bar paints in the WRONG row vs its label. Stencil
 *  drops produce orderless bars, and a chart built that way scatters. This assigns every bound bar an `order` from
 *  its CURRENT visual (Y) position — preserving the author's layout — whenever ANY bar lacks one, so every bar then
 *  snaps to its panel row. No-op once every bar already has an order. Returns true when it back-filled. */
export function backfillGanttOrders(tl) {
  const bars = timelineBars(tl);
  if (!bars.length || bars.every(b => b.get('order') != null)) return false;
  ganttBarsByVisualOrder(tl, bars).forEach((b, i) => b.set('order', i));
  return true;
}

/** The next free `order` for a bar APPENDED to a timeline (one past the current max) — used when a stencil-dropped
 *  GanttTask needs an order so it lands as a new last row instead of an unsnapped orphan. */
export function nextGanttOrder(tl) {
  const bars = timelineBars(tl);
  let max = -1;
  for (const b of bars) { const o = b.get('order'); if (o != null && o > max) max = o; }
  return max + 1;
}

/** Derive a bar's { start, end } ISO dates from its CURRENT x/width — the inverse of applyGanttGeometry. Used by the
 *  drag/resize write-back (drop a bar a column over → it re-dates) and the load back-fill. Null when there's no
 *  resolvable timeline/axis. */
export function deriveGanttDates(task, tl = ganttTimelineFor(task)) {
  if (!tl) return null;
  const t = axisProps(tl);
  const start = xToDate(t, task.position().x);
  const end = xToDate(t, task.position().x + task.size().width);
  return (start && end) ? { start, end } : null;
}

/** Load-migration back-fill (Phase 2): a DATELESS bar bound to a timeline gains start/end dates DERIVED from its
 *  current pixels — so an old (pre-dates) Gantt diagram becomes real schedule DATA (for the Table view / LLM)
 *  WITHOUT moving the bar on screen. No-op if it's already dated or has no resolvable timeline. Returns true when it
 *  back-filled. Called only from migrateNodes (under the load guard → no history / no markDirty). */
export function backfillGanttDates(task, tl = ganttTimelineFor(task)) {
  if (task.get('startDate') && task.get('endDate')) return false;
  const d = deriveGanttDates(task, tl);
  if (!d) return false;
  task.set({ startDate: d.start, endDate: d.end });
  return true;
}

/** A milestone is a point-in-time marker: its `milestoneDate` is the source of truth, just like a bar's start/end.
 *  Position the diamond so its CENTRE sits on that date's column; Y stays MANUAL (the user picks the row). Returns
 *  true when it derived geometry. {gantt:true} marks the move layout-driven so the drag write-back ignores it. */
export function applyGanttMilestoneGeometry(ms, tl = ganttTimelineFor(ms)) {
  const date = ms.get('milestoneDate');
  if (!date || !tl) return false;
  const x = dateToX(axisProps(tl), date);
  if (x == null) return false;
  ms.position(Math.round(x - ms.size().width / 2), ms.position().y, { gantt: true });
  return true;
}

/** Inverse of applyGanttMilestoneGeometry: a milestone's `milestoneDate` from its current CENTRE x — used by the
 *  drag write-back (drag the diamond a column over → it re-dates). Null when there's no resolvable timeline/axis. */
export function deriveGanttMilestoneDate(ms, tl = ganttTimelineFor(ms)) {
  if (!tl) return null;
  return xToDate(axisProps(tl), ms.position().x + ms.size().width / 2) || null;
}

/** Phase 6: a GanttMarker triangle is a point-in-time marker too — its `markerDate` drives the column (centre on
 *  the date); Y stays manual. Mirrors applyGanttMilestoneGeometry. */
export function applyGanttMarkerGeometry(mk, tl = ganttTimelineFor(mk)) {
  const date = mk.get('markerDate');
  if (!date || !tl) return false;
  const x = dateToX(axisProps(tl), date);
  if (x == null) return false;
  mk.position(Math.round(x - mk.size().width / 2), mk.position().y, { gantt: true });
  return true;
}
/** Inverse: a marker's `markerDate` from its current CENTRE x (drag write-back). */
export function deriveGanttMarkerDate(mk, tl = ganttTimelineFor(mk)) {
  if (!tl) return null;
  return xToDate(axisProps(tl), mk.position().x + mk.size().width / 2) || null;
}

/** Phase 6: the TIMELINE-LOCAL x (relative to the timeline's own origin, so the view can draw in its SVG coords)
 *  for a date on the axis. Used by GanttTimelineView to draw the `todayDate` line + the GanttGroup span. Null when
 *  unparseable / no axis. */
export function dateToLocalX(tl, date) {
  if (!tl || !date) return null;
  const x = dateToX(axisProps(tl), date);
  return x == null ? null : x - tl.position().x;
}

/** Phase 6: a GanttGroup summary bar LINKED to a timeline group (its `groupId`) AUTO-SPANS that group's tasks —
 *  x+width derive from the earliest task's left edge to the latest task's right edge (date-based via dateToX /
 *  spanWidth, so it never depends on bar-processing order). Y stays MANUAL (the user's row). Returns true when it
 *  spanned; false (manual pixels kept) for an UNLINKED group (no groupId, back-compat), no dated members, or no
 *  axis. */
export function applyGanttGroupGeometry(grp, tl = ganttTimelineFor(grp)) {
  const gid = grp.get('groupId');
  if (!gid || !tl) return false;
  const t = axisProps(tl);
  let left = null, right = null;
  for (const b of timelineBars(tl)) {
    if ((b.get('groupId') || null) !== gid) continue;
    const s = b.get('startDate'), e = b.get('endDate');
    if (!s || !e) continue;
    const x = dateToX(t, s), w = spanWidth(t, s, e);
    if (x == null || w == null) continue;
    // Round per-bar exactly as applyGanttGeometryWithLayout does (round(x), round(w)) so the group's edges
    // COINCIDE with the member bars' rendered edges instead of drifting a pixel.
    const barLeft = Math.round(x), barRight = Math.round(x) + Math.round(w);
    if (left == null || barLeft < left) left = barLeft;
    if (right == null || barRight > right) right = barRight;
  }
  if (left == null || right == null) return false;
  grp.position(left, grp.position().y, { gantt: true });
  grp.resize(Math.max(8, right - left), grp.size().height, { gantt: true });
  return true;
}

/** Phase 6: the auto summary bar a GROUP ROW draws in the timeline area — the span of every dated task in the
 *  group (min left → max right) plus the duration-weighted % progress across them, in TIMELINE-LOCAL x (so the
 *  view can draw in its own SVG coords). Null when the group has no dated tasks. Mirrors applyGanttGroupGeometry's
 *  per-bar rounding so the summary edges coincide with the member bars. */
export function ganttGroupSummary(tl, gid) {
  if (!tl || !gid) return null;
  const t = axisProps(tl);
  const tx = tl.position().x;
  let left = null, right = null, totalW = 0, doneW = 0;
  for (const b of timelineBars(tl)) {
    if ((b.get('groupId') || null) !== gid) continue;
    const s = b.get('startDate'), e = b.get('endDate');
    if (!s || !e) continue;
    const x = dateToX(t, s), w = spanWidth(t, s, e);
    if (x == null || w == null) continue;
    const barLeft = Math.round(x), barW = Math.max(0, Math.round(w)), barRight = barLeft + barW;
    if (left == null || barLeft < left) left = barLeft;
    if (right == null || barRight > right) right = barRight;
    totalW += barW;
    doneW += barW * (Math.max(0, Math.min(100, Number(b.get('progress')) || 0)) / 100);
  }
  if (left == null) return null;
  return { x0: left - tx, x1: right - tx, progress: totalW > 0 ? Math.round((doneW / totalW) * 100) : 0 };
}

/** Phase 4.5 / 4.5b.3 load migration: a LEGACY `tasks[]` timeline (label rows, no bound bars) becomes real bars —
 *  one per task row, embedded + dated (a staggered 1-period span from the timeline start, today-fallback) +
 *  ordered — and its legacy GROUP rows become `groups[]` (the task rows carry their `groupId` onto the bar). So old
 *  diagrams (flat OR grouped) get the unified bar+group behaviour, and 4.6 can drop the `tasks[]` fallback.
 *  IDEMPOTENT (skips the moment any bar is bound → re-load never duplicates), and NO-MOVE (only ever CREATES on a
 *  0-bar timeline; existing bars/timelines untouched). `tasks[]` is left in place (the panel/editor prefer bars).
 *  Called only from migrateNodes (under the load guard → no history / no markDirty). Returns the bars created. */
export function migrateGanttTimeline(tl) {
  if (!tl || tl.get('type') !== 'sf.GanttTimeline' || !tl.graph) return [];
  if (timelineBars(tl).length > 0) return [];                        // (b)+(c): already has bars → skip (idempotent)
  const tasks = tl.get('tasks') || [];
  const taskRows = tasks.filter(r => r && r.type !== 'group');
  if (!taskRows.length) return [];

  // 4.5b.3: legacy group ROWS → groups[] (preserve order). A task row's `groupId` already references a group
  // row's id, so the created bar's groupId binds to the right new group. Set once (no-dirty under the load guard).
  const groupRows = tasks.filter(r => r && r.type === 'group');
  if (groupRows.length && !(tl.get('groups') || []).length) {
    tl.set('groups', groupRows.map((g, gi) => ({ id: g.id, label: g.label || 'Group', color: g.color || '#5B5FC7', order: gi })));
  }

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const vm = tl.get('viewMode') || 'week';
  const base = new Date((tl.get('startDate') || iso(new Date())) + 'T00:00:00');   // empty startDate → today
  const span = (k) => {
    const s = new Date(base), e = new Date(base);
    if (vm === 'day')        { s.setDate(base.getDate() + k);     e.setDate(base.getDate() + k + 1); }
    else if (vm === 'month') { s.setMonth(base.getMonth() + k);   e.setMonth(base.getMonth() + k + 1); }
    else                     { s.setDate(base.getDate() + k * 7); e.setDate(base.getDate() + (k + 1) * 7); }
    return { start: iso(s), end: iso(e) };
  };

  const created = [];
  taskRows.forEach((row, k) => {
    const label = row.label || 'Task';
    const { start, end } = span(k);
    const bar = new joint.shapes.sf.GanttTask({
      order: k, groupId: row.groupId || null, taskLabel: label, startDate: start, endDate: end,
      attrs: { label: { text: label }, progressBar: { fill: row.color || '#1D73C9' } },
    });
    tl.graph.addCell(bar);
    tl.embed(bar);
    if (!applyGanttGeometry(bar, tl)) bar.position(tl.position().x + (tl.get('taskListWidth') || 200), orderToY(tl, k), { gantt: true });
    created.push(bar);
  });
  return created;
}

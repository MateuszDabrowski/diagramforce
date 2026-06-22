// Gantt geometry binding: makes a task bar's x + width DERIVE from its start/end DATES (via the pure gantt-scale
// engine) against its timeline's axis. The dates become the single source of truth — edit a date (property panel /
// table / LLM-authored JSON) and the bar moves to the right column. Shared by the shapes views (live edits +
// timeline re-layout) and the load migration (migrateNodes). Back-compat: a task with no dates, or no resolvable
// timeline, keeps its manual pixel position untouched.
import { dateToX, spanWidth, xToDate } from './gantt-scale.js?v=1.17.2.11';

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

/** The timeline-axis props bag gantt-scale needs, read from the timeline MODEL. */
function axisProps(tl) {
  return {
    x: tl.position().x, width: tl.size().width,
    taskListWidth: tl.get('taskListWidth'), numPeriods: tl.get('numPeriods'),
    viewMode: tl.get('viewMode'), startDate: tl.get('startDate'),
    weekStartDay: tl.get('weekStartDay'), tasksLen: (tl.get('tasks') || []).length,
  };
}

/** Position + size a GanttTask bar from its dates. Returns true when it derived geometry, false when it left the
 *  bar's manual pixels alone (no dates / no timeline / unparseable). The `{ gantt:true }` change opt marks these as
 *  layout-driven so a future drag write-back (Phase 2) can ignore them and avoid a feedback loop. */
export function applyGanttGeometry(task, tl = ganttTimelineFor(task)) {
  const start = task.get('startDate'), end = task.get('endDate');
  if (!start || !end || !tl) return false;
  const t = axisProps(tl);
  const x = dateToX(t, start);
  const w = spanWidth(t, start, end);
  if (x == null || w == null) return false;
  task.position(Math.round(x), task.position().y, { gantt: true });
  task.resize(Math.max(8, Math.round(w)), task.size().height, { gantt: true });
  return true;
}

/** Re-derive every dated bar that belongs to `tl` — called when the timeline's axis (start / viewMode / numPeriods /
 *  width) changes, so the bars track the ruler. Bars without dates are left as-is. */
export function layoutTimelineTasks(tl) {
  const graph = tl.graph;
  if (!graph) return;
  for (const e of graph.getElements()) {
    if (e.get('type') === 'sf.GanttTask' && ganttTimelineFor(e) === tl) applyGanttGeometry(e, tl);
  }
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

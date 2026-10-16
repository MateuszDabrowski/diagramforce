// Pure date<->pixel mapping for the Gantt timeline axis. Zero-dependency leaf, unit-tested (tests/gantt-scale.test.js).
//
// This is the INVERSE of the column math in GanttTimelineView._renderColumns (shapes.js): the date columns are
// equal-width — colW = (width - taskListWidth) / numPeriods — starting from a SNAPPED origin (week → back to
// weekStartDay; month → 1st-of-month; day → unchanged). A task bar's absolute x is therefore
//   timeline.x + taskListWidth + periodsFromOrigin(date) * colW
// and xToDate is the inverse (for drag write-back). `t` is a plain props bag pulled from the timeline MODEL
//   { x, width, taskListWidth, numPeriods, viewMode, startDate, weekStartDay, rowsLen }
// so these functions stay pure (no JointJS, no Date.now) and testable. They return null when geometry can't be
// derived (no/invalid startDate) — the caller then falls back to the bar's manual pixel position (back-compat).

const DAY_MS = 86400000;
const wrap7 = (n) => ((Number(n) % 7) + 7) % 7;
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

/** Width (px) of the left task-list panel: `taskListWidth` (default 200) when the timeline draws any row, 0 when it
 *  draws none. `rowsLen` is `ganttRowLayout(tl).length` (group headers AND bars), the count the view reserves the
 *  panel by. Counting bars alone put the axis 200 px left of the drawn columns on a phases-only timeline, and the
 *  legacy `tasks[]` count reserved a panel the view never drew (review L4/L7, 2026-10-15). */
export function leftOffset(t) {
  return (t.rowsLen || 0) > 0 ? (t.taskListWidth || 200) : 0;
}

/** Pixels per period column. */
export function colWidth(t) {
  return (t.width - leftOffset(t)) / (t.numPeriods || 12);
}

/** The snapped column origin as a local-midnight Date, or null when startDate is missing/invalid. */
export function originDate(t) {
  if (!t.startDate) return null;
  const d = new Date(t.startDate + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const vm = t.viewMode || 'week';
  if (vm === 'week') {
    const wsd = wrap7(t.weekStartDay ?? 1);
    d.setDate(d.getDate() - ((d.getDay() - wsd + 7) % 7));   // back to the configured first-day-of-week
  } else if (vm === 'month') {
    d.setDate(1);
  }
  return d;
}

/** Periods (fractional columns) from origin to date, in the timeline's view unit. */
// Whole CALENDAR days between two local-midnight dates. Elapsed milliseconds are not days across a DST change (a 23 h
// or 25 h day), which put every bar, milestone and the today-line 1/24 of a column off the grid after the clocks
// changed (audit 2026-09-23). Plain dates: counted on their calendar fields, in UTC, where every day is 24 h.
const calendarDays = (a, b) =>
  (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS;

function periodsFromOrigin(origin, date, viewMode) {
  if (viewMode === 'day') return calendarDays(origin, date);
  if (viewMode === 'month') {
    const months = (date.getFullYear() - origin.getFullYear()) * 12 + (date.getMonth() - origin.getMonth());
    return months + (date.getDate() - 1) / daysInMonth(date.getFullYear(), date.getMonth());   // month-aware fraction
  }
  return calendarDays(origin, date) / 7;   // week
}

/** Absolute canvas X for an ISO date (YYYY-MM-DD) on the timeline, or null when not derivable. */
export function dateToX(t, iso) {
  const origin = originDate(t);
  if (!origin || !iso) return null;
  const date = new Date(iso + 'T00:00:00');
  if (isNaN(date.getTime())) return null;
  return (t.x || 0) + leftOffset(t) + periodsFromOrigin(origin, date, t.viewMode || 'week') * colWidth(t);
}

/** How many whole periods the axis needs so `endISO` is on it (dateToX(endISO) <= the right edge): counted from the
 *  SNAPPED origin, the columns the view draws, with a partial period rounded up. Calendar days, so a DST change adds
 *  no column. Null when either date is missing or invalid. The inverse of axisEdgeDate. Counting from the unsnapped
 *  start left a mid-month or mid-week End Date off the axis, and elapsed milliseconds added a column across the
 *  autumn clock change (review L2, L9). */
export function periodsToReach(t, endISO) {
  const origin = originDate(t);
  if (!origin || !endISO) return null;
  const end = new Date(endISO + 'T00:00:00');
  if (isNaN(end.getTime())) return null;
  return Math.ceil(periodsFromOrigin(origin, end, t.viewMode || 'week'));
}

/** The `numPeriods` an axis must grow to so `endISO` is on it, or null when it already is. A date inside the last
 *  column, or exactly on the right edge, needs nothing: the old rule grew on `reach >= numPeriods`, so any date edit
 *  on a plan that filled the axis added a column and moved the End Date (review S6-3). Past the edge it is the periods
 *  to reach the date plus `spare` columns (one by default), capped at `max` and never below the current count. */
export function grownPeriods(t, endISO, max, spare = 1) {
  const reach = periodsToReach(t, endISO);
  const cur = Number(t.numPeriods) || 12;
  if (reach == null || reach <= cur) return null;
  const needed = Math.min(reach + spare, Math.max(cur, max));
  return Number.isFinite(needed) && needed > cur ? needed : null;
}

/** The date `n` whole periods after the snapped origin, as YYYY-MM-DD: the left edge of column `n`. Null when the start
 *  is missing or invalid. A starter plan dates its phases with this: counted from the UNSNAPPED start, the last phase
 *  ran up to six days past the right edge on any day but the week's first (review S6-1). */
export function periodDate(t, n) {
  const d = originDate(t);
  if (!d) return null;
  const k = Math.round(Number(n) || 0);
  const vm = t.viewMode || 'week';
  if (vm === 'day') d.setDate(d.getDate() + k);
  else if (vm === 'month') d.setMonth(d.getMonth() + k);   // the origin is the 1st, so no month-end overflow
  else d.setDate(d.getDate() + k * 7);
  return toISO(d);
}

/** How many whole periods the axis needs to DRAW `endISO`'s day: the periods that reach the day after it. A timeline's
 *  End Date is inclusive (owner call, review L2, 2026-10-15): End 10 Jun in day view draws the 10 Jun column, and in
 *  week or month view the week or month it falls in. Null when either date is missing or invalid. The inverse of
 *  axisEndDate. */
export function periodsThrough(t, endISO) {
  return periodsToReach(t, addDaysISO(endISO, 1));
}

/** The date at the axis's right edge: the snapped origin plus `numPeriods` periods, as YYYY-MM-DD. A bar's `endDate`
 *  is an edge too, so a bar that ends here fills the last column. Null when the start is missing or invalid. */
export function axisEdgeDate(t) {
  return periodDate(t, Number(t.numPeriods) || 12);
}

/** The last day the axis draws, the day before its right edge, as YYYY-MM-DD: a timeline's End Date. Null when the
 *  start is missing or invalid. Until review L2 the End Date was the edge itself, so its own day was not drawn. */
export function axisEndDate(t) {
  const edge = axisEdgeDate(t);
  return edge && addDaysISO(edge, -1);
}

/** Width (px) of a [startISO, endISO] span on the timeline (clamped >= 0), or null when not derivable. */
export function spanWidth(t, startISO, endISO) {
  const a = dateToX(t, startISO), b = dateToX(t, endISO);
  if (a == null || b == null) return null;
  return Math.max(0, b - a);
}

const pad2 = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Inverse of dateToX: the ISO date (YYYY-MM-DD) at absolute canvas X, snapped to whole days. For drag write-back. */
export function xToDate(t, x) {
  const origin = originDate(t);
  if (!origin) return null;
  const cw = colWidth(t);
  if (!(cw > 0)) return null;
  const cols = ((x || 0) - (t.x || 0) - leftOffset(t)) / cw;
  const d = new Date(origin);
  const vm = t.viewMode || 'week';
  if (vm === 'day') d.setDate(d.getDate() + Math.round(cols));
  else if (vm === 'week') d.setDate(d.getDate() + Math.round(cols * 7));
  else {   // month: advance whole months, then the day-fraction within the landed month
    const whole = Math.floor(cols);
    d.setMonth(d.getMonth() + whole);
    d.setDate(Math.round((cols - whole) * daysInMonth(d.getFullYear(), d.getMonth())) + 1);
  }
  return toISO(d);
}

// Phase 5 (Table view): pure whole-day arithmetic on YYYY-MM-DD strings, parsed at LOCAL midnight (the
// gantt-layout ISO idiom) so there's no UTC off-by-one. `durationDays` = end − start in days (a bar's span);
// `addDaysISO` = start + N days, the inverse used when the table edits Duration.
export function durationDays(startISO, endISO) {
  if (!startISO || !endISO) return null;
  const s = new Date(startISO + 'T00:00:00'), e = new Date(endISO + 'T00:00:00');
  if (isNaN(s) || isNaN(e)) return null;
  return Math.round((e - s) / 86400000);
}
export function addDaysISO(startISO, days) {
  if (!startISO) return startISO;
  const d = new Date(startISO + 'T00:00:00');
  if (isNaN(d)) return startISO;
  d.setDate(d.getDate() + Math.round(Number(days) || 0));
  return toISO(d);
}

/** A Date as its LOCAL calendar day, 'YYYY-MM-DD'. `toISOString().slice(0, 10)` is the UTC day: for a date built at
 *  local midnight it is the PREVIOUS day in every UTC+ zone, so a timeline's End Date came out a day early in Warsaw,
 *  Tokyo or Sydney and the saved value depended on where its author sat (audit 2026-09-23). */
export function localISODate(d) { return toISO(d); }

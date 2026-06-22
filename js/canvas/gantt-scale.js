// Pure date<->pixel mapping for the Gantt timeline axis. Zero-dependency leaf, unit-tested (tests/gantt-scale.test.js).
//
// This is the INVERSE of the column math in GanttTimelineView._renderColumns (shapes.js): the date columns are
// equal-width — colW = (width - taskListWidth) / numPeriods — starting from a SNAPPED origin (week → back to
// weekStartDay; month → 1st-of-month; day → unchanged). A task bar's absolute x is therefore
//   timeline.x + taskListWidth + periodsFromOrigin(date) * colW
// and xToDate is the inverse (for drag write-back). `t` is a plain props bag pulled from the timeline MODEL
//   { x, width, taskListWidth, numPeriods, viewMode, startDate, weekStartDay, tasksLen }
// so these functions stay pure (no JointJS, no Date.now) and testable. They return null when geometry can't be
// derived (no/invalid startDate) — the caller then falls back to the bar's manual pixel position (back-compat).

const DAY_MS = 86400000;
const wrap7 = (n) => ((Number(n) % 7) + 7) % 7;
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

/** Width (px) of the left task-list panel — 0 when the timeline has no rows (matches the view). */
export function leftOffset(t) {
  return (t.tasksLen > 0) ? (t.taskListWidth || 200) : 0;
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
function periodsFromOrigin(origin, date, viewMode) {
  if (viewMode === 'day') return (date - origin) / DAY_MS;
  if (viewMode === 'month') {
    const months = (date.getFullYear() - origin.getFullYear()) * 12 + (date.getMonth() - origin.getMonth());
    return months + (date.getDate() - 1) / daysInMonth(date.getFullYear(), date.getMonth());   // month-aware fraction
  }
  return (date - origin) / DAY_MS / 7;   // week
}

/** Absolute canvas X for an ISO date (YYYY-MM-DD) on the timeline, or null when not derivable. */
export function dateToX(t, iso) {
  const origin = originDate(t);
  if (!origin || !iso) return null;
  const date = new Date(iso + 'T00:00:00');
  if (isNaN(date.getTime())) return null;
  return (t.x || 0) + leftOffset(t) + periodsFromOrigin(origin, date, t.viewMode || 'week') * colWidth(t);
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

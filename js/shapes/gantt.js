// Gantt-chart shapes (GanttTask/Milestone/Marker/Timeline/Group) (CLEANUP S3). registerGantt() is called by shapes.js register(); it defines the block's
// JointJS shapes/views. Reads the shared leaves (ports/markdown-fo/fields/context) + app modules; never the facade.

import { GANTT_SUMMARY_GROUP_H, GANTT_SUMMARY_MARKER_H, applyGanttGeometry, applyGanttGroupGeometry, applyGanttMarkerGeometry, applyGanttMilestoneGeometry, dateToLocalX, ganttGroupSummary, ganttRowLayout, ganttSummaryLaneH, ganttTimelineFor, layoutTimelineTasks, recolorGroupTasks } from '../gantt-layout.js?v=1.19.3.8';

export function registerGantt() {
  // --- GanttTask ---
  // Horizontal bar: colored progress fill + gray remainder + label.
  // progress: 0–100 stored as model property, rendered by custom view.
  joint.dia.Element.define(
    'sf.GanttTask',
    {
      size: { width: 240, height: 32 },
      z: 2000,
      taskLabel: 'Task',
      progress: 0,
      startDate: '',
      endDate: '',
      assignee: '',
      groupId: null,          // 4.5b: id of the timeline group this bar belongs to, or null = ungrouped
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          rx: 4,
          ry: 4,
          fill: 'var(--node-bg)',
          stroke: 'var(--node-border)',
          strokeWidth: 1,
        },
        progressBar: {
          width: 0,
          height: 'calc(h)',
          rx: 4,
          ry: 4,
          fill: '#1D73C9',
          stroke: 'none',
        },
        label: {
          x: 8,
          y: 'calc(0.5 * h)',
          textAnchor: 'start',
          textVerticalAnchor: 'middle',
          fontSize: 12,
          fontWeight: 600,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--node-text)',
          text: 'Task',
          textWrap: { width: 'calc(w - 16)', maxLineCount: 1, ellipsis: true },
        },
        percentLabel: {
          x: 'calc(w - 8)',
          y: 'calc(0.5 * h - 4)',
          textAnchor: 'end',
          textVerticalAnchor: 'middle',
          fontSize: 10,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: '',
        },
        assigneeLabel: {
          x: 'calc(w - 8)',
          y: 'calc(0.5 * h + 8)',
          textAnchor: 'end',
          textVerticalAnchor: 'middle',
          fontSize: 9,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: '',
        },
      },
      ports: {
        groups: {
          left: {
            position: { name: 'left' },
            attrs: { circle: { r: 4, magnet: true, fill: 'var(--port-color, #1D73C9)', stroke: '#FFFFFF', strokeWidth: 1.5 } },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
          right: {
            position: { name: 'right' },
            attrs: { circle: { r: 4, magnet: true, fill: 'var(--port-color, #1D73C9)', stroke: '#FFFFFF', strokeWidth: 1.5 } },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
        },
        items: [
          { id: 'port-left', group: 'left' },
          { id: 'port-right', group: 'right' },
        ],
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'rect', selector: 'progressBar' },
        { tagName: 'text', selector: 'label' },
        { tagName: 'text', selector: 'percentLabel' },
        { tagName: 'text', selector: 'assigneeLabel' },
      ],
    }
  );

  // Custom view for GanttTask — updates progress bar width
  joint.shapes.sf.GanttTaskView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      this.listenTo(this.model, 'change:progress', () => this._updateProgress());
      this.listenTo(this.model, 'change:assignee change:showAssignee change:showProgress', () => this._updateDisplay());
      // Dates are the source of truth: editing start/end re-derives the bar's x + width on the timeline (gantt-scale).
      this.listenTo(this.model, 'change:startDate change:endDate', () => applyGanttGeometry(this.model));
      // Issue 6: a task's bar colour follows its GROUP — when it joins/changes a group (drop / drag / editor), recolour
      // its progress bar to the group's colour, UNLESS the user set a colour manually (`colorManual`). Fires only on a
      // groupId CHANGE (not initial load), so saved per-task colours are preserved.
      this.listenTo(this.model, 'change:groupId', () => {
        if (this.model.get('colorManual')) return;
        const tl = ganttTimelineFor(this.model);
        const gid = this.model.get('groupId');
        const grp = gid && tl && (tl.get('groups') || []).find((g) => g.id === gid);
        if (grp && grp.color) this.model.attr('progressBar/fill', grp.color);
      });
    },
    update() {
      joint.dia.ElementView.prototype.update.apply(this, arguments);
      this._updateProgress();
      this._updateDisplay();
    },
    _updateDisplay() {
      // Delegate to _updateProgress which handles all text, colors, and visibility
      this._updateProgress();
    },
    _updateProgress() {
      const model = this.model;
      const progress = Math.max(0, Math.min(100, model.get('progress') || 0));
      const { width } = model.size();
      const barWidth = Math.round(width * progress / 100);
      model.attr('progressBar/width', barWidth, { silent: true });

      const showProgress = model.get('showProgress') !== false;
      model.attr('percentLabel/text', showProgress && progress > 0 ? `${progress}%` : '', { silent: true });

      // Only override body fill if the user hasn't set a custom background color.
      // Custom means anything other than the two auto-managed values.
      const currentFill = model.attr('body/fill');
      const isDefaultFill = !currentFill || currentFill === 'var(--node-bg)' || currentFill === 'var(--gantt-task-uncompleted)';
      let bodyFill;
      if (isDefaultFill) {
        bodyFill = (progress > 0 && progress < 100) ? 'var(--gantt-task-uncompleted)' : 'var(--node-bg)';
        model.attr('body/fill', bodyFill, { silent: true });
      } else {
        bodyFill = currentFill;
      }

      // Text color: respect user override, otherwise auto-compute from progress
      const userTextColor = model.get('userTextColor');
      const labelColor = userTextColor || (progress > 0 ? '#FFFFFF' : 'var(--node-text)');
      const pctColor = userTextColor || (progress > 0 ? '#FFFFFF' : 'var(--text-secondary)');
      const assigneeColor = userTextColor || (progress > 0 ? '#FFFFFF' : 'var(--text-secondary)');
      model.attr('label/fill', labelColor, { silent: true });
      model.attr('percentLabel/fill', pctColor, { silent: true });
      model.attr('assigneeLabel/fill', assigneeColor, { silent: true });

      // Show/hide assignee
      const showAssignee = model.get('showAssignee') !== false;
      const assignee = model.get('assignee') || '';
      model.attr('assigneeLabel/text', showAssignee ? assignee : '', { silent: true });

      // Force view re-render of attrs
      const progressBarEl = this.el.querySelector('[joint-selector="progressBar"]');
      if (progressBarEl) progressBarEl.setAttribute('width', String(barWidth));
      const bodyEl = this.el.querySelector('[joint-selector="body"]');
      if (bodyEl) bodyEl.setAttribute('fill', bodyFill);
      const pctEl = this.el.querySelector('[joint-selector="percentLabel"]');
      if (pctEl) {
        pctEl.textContent = showProgress && progress > 0 ? `${progress}%` : '';
        pctEl.setAttribute('fill', pctColor);
      }
      const labelEl = this.el.querySelector('[joint-selector="label"]');
      if (labelEl) labelEl.setAttribute('fill', labelColor);
      const assigneeEl = this.el.querySelector('[joint-selector="assigneeLabel"]');
      if (assigneeEl) {
        assigneeEl.textContent = showAssignee ? assignee : '';
        assigneeEl.setAttribute('fill', assigneeColor);
      }
    },
  });

  // --- GanttMilestone ---
  // Diamond marker for key project milestones.
  joint.dia.Element.define(
    'sf.GanttMilestone',
    {
      size: { width: 24, height: 24 },
      z: 2000,
      milestoneDate: '',
      attrs: {
        body: {
          refPoints: '0,0.5 0.5,0 1,0.5 0.5,1',
          fill: '#F6B355',
          stroke: '#D4942A',
          strokeWidth: 1.5,
        },
        label: {
          x: 'calc(0.5 * w)',
          y: -4,
          textAnchor: 'middle',
          textVerticalAnchor: 'bottom',
          fontSize: 11,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-primary)',
          text: 'Milestone',
        },
        dateLabel: {   // ALWAYS-on date caption below the diamond (like the Day Marker)
          x: 'calc(0.5 * w)',
          y: 'calc(h + 4)',
          textAnchor: 'middle',
          textVerticalAnchor: 'top',
          fontSize: 10,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: '',
        },
      },
      ports: {
        groups: {
          left: {
            position: { name: 'left' },
            attrs: { circle: { r: 4, magnet: true, fill: '#F6B355', stroke: '#FFFFFF', strokeWidth: 1.5 } },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
          right: {
            position: { name: 'right' },
            attrs: { circle: { r: 4, magnet: true, fill: '#F6B355', stroke: '#FFFFFF', strokeWidth: 1.5 } },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
        },
        items: [
          { id: 'port-left', group: 'left' },
          { id: 'port-right', group: 'right' },
        ],
      },
    },
    {
      markup: [
        { tagName: 'polygon', selector: 'body' },
        { tagName: 'text', selector: 'label' },
        { tagName: 'text', selector: 'dateLabel' },
      ],
    }
  );

  // Custom view for GanttMilestone — `milestoneDate` is the source of truth, mirroring GanttTaskView for bars:
  // editing the date (panel / JSON / programmatic) slides the diamond to that column instead of being a silent
  // no-op. X derives from the date; Y stays where the user placed it (see applyGanttMilestoneGeometry). The
  // diamond ALWAYS shows its date as a caption (issue 9), like the Day Marker.
  joint.shapes.sf.GanttMilestoneView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      this.model.attr('dateLabel/text', fmtGanttDate(this.model.get('milestoneDate')), { silent: true });
      this.listenTo(this.model, 'change:milestoneDate', () => {
        applyGanttMilestoneGeometry(this.model);
        this.model.attr('dateLabel/text', fmtGanttDate(this.model.get('milestoneDate')));
      });
    },
  });

  // Short, locale-stable date caption for a Gantt marker ("24 Jun"). Empty for an unset/invalid date.
  const _GANTT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtGanttDate(iso) {
    if (!iso || typeof iso !== 'string') return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return '';
    const mon = _GANTT_MONTHS[Number(m[2]) - 1];
    return mon ? `${Number(m[3])} ${mon}` : '';
  }

  // --- GanttMarker ---
  // Upward-pointing triangle that marks a day on a Gantt chart (not necessarily today).
  // Can be embedded in a GanttTimeline like a milestone; shows its date as a caption.
  joint.dia.Element.define(
    'sf.GanttMarker',
    {
      size: { width: 20, height: 16 },
      z: 2000,
      pointDown: false,
      markerDate: '',   // Phase 6: when set, the triangle's x derives from this date (mirrors a milestone)
      attrs: {
        body: {
          refPoints: '0,1 0.5,0 1,1',
          fill: '#DA4E55',
          stroke: '#B03A40',
          strokeWidth: 1.5,
        },
        label: {
          x: 'calc(0.5 * w)',
          y: 'calc(h + 4)',
          textAnchor: 'middle',
          textVerticalAnchor: 'top',
          fontSize: 10,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-primary)',
          text: 'Day',
        },
        // A small date caption below the label (the view fills it from markerDate).
        dateLabel: {
          x: 'calc(0.5 * w)',
          y: 'calc(h + 17)',
          textAnchor: 'middle',
          textVerticalAnchor: 'top',
          fontSize: 9,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: '',
        },
      },
      ports: {
        groups: {
          left: {
            position: { name: 'left' },
            attrs: { circle: { r: 4, magnet: true, fill: '#DA4E55', stroke: '#FFFFFF', strokeWidth: 1.5 } },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
          right: {
            position: { name: 'right' },
            attrs: { circle: { r: 4, magnet: true, fill: '#DA4E55', stroke: '#FFFFFF', strokeWidth: 1.5 } },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
        },
        items: [
          { id: 'port-left', group: 'left' },
          { id: 'port-right', group: 'right' },
        ],
      },
    },
    {
      markup: [
        { tagName: 'polygon', selector: 'body' },
        { tagName: 'text', selector: 'label' },
        { tagName: 'text', selector: 'dateLabel' },
      ],
    }
  );

  // Custom view for GanttMarker — like GanttMilestoneView, `markerDate` (when set) is the source of truth:
  // editing the date slides the triangle to that column. The date also shows as a caption under the label.
  joint.shapes.sf.GanttMarkerView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      const sync = () => { applyGanttMarkerGeometry(this.model); this.model.attr('dateLabel/text', fmtGanttDate(this.model.get('markerDate'))); };
      this.listenTo(this.model, 'change:markerDate', sync);
      this.model.attr('dateLabel/text', fmtGanttDate(this.model.get('markerDate')), { silent: true });
    },
  });

  // --- GanttTimeline ---
  // Auto-calculated week/month header. Renders a two-row header:
  // top row shows months, bottom row shows weeks (or vice versa).
  // Custom view dynamically creates SVG column elements.
  joint.dia.Element.define(
    'sf.GanttTimeline',
    {
      size: { width: 960, height: 48 },
      z: 1000,
      startDate: '',          // YYYY-MM-DD format
      endDate: '',            // YYYY-MM-DD format (auto-calculated or manual)
      todayDate: '',          // Phase 6: YYYY-MM-DD — draws a full-height "today" line at this date's column
      viewMode: 'week',       // 'day', 'week' or 'month'
      numPeriods: 12,         // number of columns to show
      tasks: [],              // LEGACY (pre-4.5b): array of { id, type:'group'|'task', label, groupId?, color? }
      groups: [],             // 4.5b: [{ id, label, color, order }] group header rows; bars reference one via groupId
      taskListWidth: 200,     // width of the left task list panel
      rowHeight: 48,          // height per task row (tall enough for embedded elements)
      timelineTitle: 'Tasks',      // replaces the hardcoded "Tasks" header
      timelineDescription: '',     // description text below title
      weekStartDay: 1,             // first day of week (week-view column split): 1=Mon, 0=Sun, 6=Sat
      showWeekNumber: false,       // week view: label columns "W23" instead of the week start date
      weekendStartDay: 6,          // first weekend day (day-view shading): 6=Sat (Sat–Sun) or 5=Fri (Fri–Sat)
      showProjectSummary: false,   // Phase 6: a read-only overview lane at the top — every group summary bar +
                                   // milestone + day marker condensed into one row (Display menu toggle)
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          fill: 'var(--bg-surface-raised)',
          stroke: 'var(--node-border)',
          strokeWidth: 1,
          rx: 4,
          ry: 4,
        },
        topRow: {
          width: 'calc(w)',
          height: 24,
          fill: 'var(--node-bg)',
          stroke: 'none',
          rx: 4,
          ry: 4,
          pointerEvents: 'none',
        },
        divider: {
          x1: 0,
          y1: 24,
          x2: 'calc(w)',
          y2: 24,
          stroke: 'var(--node-border)',
          strokeWidth: 0.5,
          pointerEvents: 'none',
        },
      },
      ports: { groups: {}, items: [] },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'rect', selector: 'topRow' },
        { tagName: 'line', selector: 'divider' },
        // Dynamic column labels added by GanttTimelineView
        { tagName: 'g', selector: 'columns', attributes: { 'pointer-events': 'none' } },
      ],
    }
  );

  // Custom view for GanttTimeline — renders date columns dynamically
  joint.shapes.sf.GanttTimelineView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      // Re-draw the ruler AND re-position dated task bars whenever the axis changes (the bars track the timeline).
      this.listenTo(this.model, 'change:startDate change:endDate change:todayDate change:viewMode change:numPeriods change:size change:tasks change:groups change:taskListWidth change:rowHeight change:timelineTitle change:timelineDescription change:weekStartDay change:showWeekNumber change:weekendStartDay change:showProjectSummary', () => { this._renderColumns(); layoutTimelineTasks(this.model); });
      // Issue 7: a group's colour change must reach its bars — the per-task `change:groupId` listener can't see a
      // `change:groups` edit (recolour in the group editor / properties), so recolour all non-manual bars here.
      this.listenTo(this.model, 'change:groups', () => recolorGroupTasks(this.model));
      // Phase 4.2: the left panel is DERIVED from the bars, so re-render it when a GanttTask bar is added /
      // removed / moved / resized / relabelled. rAF-debounced; _renderColumns only touches this view's columns
      // group + silent attrs (no graph mutation), so there is no redraw loop.
      this._panelRaf = false;
      const reRenderPanel = () => {
        if (this._panelRaf) return;
        this._panelRaf = true;
        requestAnimationFrame(() => { this._panelRaf = false; this._renderColumns(); });
      };
      if (this.model.graph) {
        this.listenTo(this.model.graph, 'add remove change:position change:size change:taskLabel change:groupId change:markerDate change:milestoneDate change:progress change:startDate change:endDate', (cell) => {
          const ct = cell?.get?.('type');
          // Re-draw on a task change (panel rows + group summary bars react to dates/progress) OR a marker/
          // milestone change (the event lines + glyph columns + the Timeline Summary lane).
          if (ct === 'sf.GanttTask' || ct === 'sf.GanttMarker' || ct === 'sf.GanttMilestone') reRenderPanel();
        });
      }
    },
    update() {
      joint.dia.ElementView.prototype.update.apply(this, arguments);
      this._renderColumns();
    },

    _getVisibleTasks() {
      return this.model.get('tasks') || [];
    },

    _renderColumns() {
      const model = this.model;
      const viewMode = model.get('viewMode') || 'week';
      const numPeriods = model.get('numPeriods') || 12;
      const startStr = model.get('startDate') || '';
      const weekStartDay = ((Number(model.get('weekStartDay') ?? 1) % 7) + 7) % 7; // 0..6
      const showWeekNumber = model.get('showWeekNumber') === true;
      const weekendStartDay = ((Number(model.get('weekendStartDay') ?? 6) % 7) + 7) % 7; // 6=Sat / 5=Fri
      // Phase 4.6: the left panel derives PURELY from the unified bar+group layout (group headers interleaved with
      // their bars) — the bars own the record. A legacy tasks[]-only timeline can't reach here: migrateGanttTimeline
      // converts it to bars on load, the stencil drop seeds bars, and a fresh Gantt seeds bars.
      const layout = ganttRowLayout(model);
      const rowCount = layout.length;
      const taskListWidth = rowCount ? (model.get('taskListWidth') || 200) : 0;
      const rowHeight = Math.max(model.get('rowHeight') || 48, 48);
      const dateH = 48;            // total height for the two date rows
      const topH = dateH / 2;      // top date row height
      const botH = dateH / 2;      // bottom date row height
      // Timeline Summary overview lane (Display toggle). When ON it REPLACES the band below the dates with a lane
      // that has one SUBROW per group + a marker subrow (grows with the group count). When OFF the band is the 40px
      // phase row ONLY if there's a description; otherwise it collapses to 0 (no empty gap). headerH matches
      // ganttHeaderH so bars + panel stay aligned.
      const summaryOn = model.get('showProjectSummary');
      const summaryH = summaryOn ? ganttSummaryLaneH(model) : 0;
      const hasDesc = !!(model.get('timelineDescription') || '').trim();
      const phaseRowH = summaryOn ? 0 : (hasDesc ? 40 : 0);
      const headerH = dateH + phaseRowH + summaryH;

      // Unified row list. Each layout row (group header OR bar) sits at the DETERMINISTIC slot
      // `headerH + rowIndex*rowHeight` — the SAME index the geometry uses for the bar's Y — so the panel and the
      // bars can never disagree (and a mid-drag bar no longer jolts the panel). `rowY` is timeline-local top.
      const rows = layout.map(r => ({ type: r.kind === 'group' ? 'group' : 'task', label: r.label, color: r.color, groupId: r.groupId, rowY: headerH + r.rowIndex * rowHeight }));

      // Auto-resize height to fit the rows (lowest row bottom, min one row below the header).
      const totalHeight = rows.length ? Math.max(headerH + rowHeight, ...rows.map(r => r.rowY + rowHeight)) : headerH;
      const { width } = model.size();
      if (model.size().height !== totalHeight) {
        model.resize(width, totalHeight, { silent: true });
        model.attr('body/height', totalHeight, { silent: true });
      }
      // Keep topRow and divider aligned with the date header area
      model.attr('topRow/x', taskListWidth, { silent: true });
      model.attr('topRow/width', width - taskListWidth, { silent: true });
      model.attr('topRow/height', topH, { silent: true });
      model.attr('divider/x1', taskListWidth, { silent: true });
      model.attr('divider/y1', topH, { silent: true });
      model.attr('divider/y2', topH, { silent: true });
      // Apply to DOM immediately (silent attrs don't trigger re-render)
      const bodyEl = this.el.querySelector('[joint-selector="body"]');
      if (bodyEl) { bodyEl.setAttribute('height', totalHeight); bodyEl.setAttribute('width', width); }
      const topRowEl = this.el.querySelector('[joint-selector="topRow"]');
      if (topRowEl) { topRowEl.setAttribute('x', taskListWidth); topRowEl.setAttribute('width', width - taskListWidth); topRowEl.setAttribute('height', topH); }
      const dividerEl = this.el.querySelector('[joint-selector="divider"]');
      if (dividerEl) { dividerEl.setAttribute('x1', taskListWidth); dividerEl.setAttribute('y1', topH); dividerEl.setAttribute('y2', topH); }
      const height = totalHeight;

      const colGroup = this.el.querySelector('[joint-selector="columns"]');
      if (!colGroup) return;
      colGroup.innerHTML = '';

      const start = startStr ? new Date(startStr + 'T00:00:00') : new Date();
      if (isNaN(start.getTime())) return;

      // Snap start to the configured first-day-of-week (week view) or 1st of month (month view)
      if (viewMode === 'week') {
        const day = start.getDay();
        start.setDate(start.getDate() - ((day - weekStartDay + 7) % 7));
      } else if (viewMode === 'month') {
        start.setDate(1);
      }

      const timelineW = width - taskListWidth;
      const colW = timelineW / numPeriods;
      const SVG_NS = 'http://www.w3.org/2000/svg';
      const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

      // Helpers — all non-interactive elements get pointer-events:none
      const mkText = (x, y, text, size, weight, fill) => {
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('x', x); t.setAttribute('y', y);
        t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'central');
        t.setAttribute('font-size', size); t.setAttribute('font-weight', weight);
        t.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
        t.setAttribute('fill', fill);
        t.setAttribute('pointer-events', 'none');
        t.textContent = text;
        return t;
      };
      const mkRect = (x, y, w, h, fill) => {
        const r = document.createElementNS(SVG_NS, 'rect');
        r.setAttribute('x', x); r.setAttribute('y', y);
        r.setAttribute('width', w); r.setAttribute('height', h);
        r.setAttribute('fill', fill);
        r.setAttribute('pointer-events', 'none');
        return r;
      };
      const mkLine = (x1, y1, x2, y2, sw) => {
        const l = document.createElementNS(SVG_NS, 'line');
        l.setAttribute('x1', x1); l.setAttribute('y1', y1);
        l.setAttribute('x2', x2); l.setAttribute('y2', y2);
        l.setAttribute('stroke', 'var(--node-border)'); l.setAttribute('stroke-width', sw);
        l.setAttribute('pointer-events', 'none');
        return l;
      };

      // Offset X for task list panel
      const oX = taskListWidth;

      if (viewMode === 'day') {
        // Day view: top row = weeks/months, bottom row = individual dates
        const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const days = [];
        const d = new Date(start);
        for (let i = 0; i < numPeriods; i++) {
          days.push({ date: new Date(d), x: oX + i * colW });
          d.setDate(d.getDate() + 1);
        }

        // Group days by month for top row
        const monthSpans = [];
        let curMonth = -1, curYear = -1, spanStart = oX;
        days.forEach((day) => {
          const m = day.date.getMonth();
          const y = day.date.getFullYear();
          if (m !== curMonth || y !== curYear) {
            if (curMonth >= 0) monthSpans.push({ month: curMonth, year: curYear, startX: spanStart, endX: day.x });
            curMonth = m; curYear = y; spanStart = day.x;
          }
        });
        if (curMonth >= 0) monthSpans.push({ month: curMonth, year: curYear, startX: spanStart, endX: width });

        // Draw month spans (top row)
        monthSpans.forEach((ms, i) => {
          const spanW = ms.endX - ms.startX;
          if (i % 2 === 1) colGroup.appendChild(mkRect(ms.startX, 0, spanW, topH, 'var(--stencil-item-hover)'));
          if (ms.startX > oX) colGroup.appendChild(mkLine(ms.startX, 0, ms.startX, height, '0.5'));
          colGroup.appendChild(mkText(ms.startX + spanW / 2, topH / 2, `${MONTHS_SHORT[ms.month]} ${ms.year}`, '11', '700', 'var(--text-primary)'));
        });

        // Weekend column highlight across ALL rows (header + tasks). The 2-day weekend
        // block runs from weekendStartDay (6=Sat → Sat–Sun; 5=Fri → Fri–Sat).
        days.forEach((day) => {
          const dow = day.date.getDay();
          const isWeekend = dow === weekendStartDay || dow === (weekendStartDay + 1) % 7;
          if (isWeekend) colGroup.appendChild(mkRect(day.x, topH, colW, height - topH, 'var(--stencil-item-hover)'));
        });

        // Draw day labels (bottom row)
        days.forEach((day, i) => {
          if (i > 0) colGroup.appendChild(mkLine(day.x, topH, day.x, height, '0.3'));
          const label = colW > 40 ? `${DAYS_SHORT[day.date.getDay()]} ${day.date.getDate()}`
            : colW > 28 ? `${DAYS_SHORT[day.date.getDay()].charAt(0)} ${day.date.getDate()}`
            : String(day.date.getDate());
          colGroup.appendChild(mkText(day.x + colW / 2, topH + botH / 2, label, '9', '500', 'var(--text-secondary)'));
        });
      } else if (viewMode === 'week') {
        // Top row: months that span across weeks
        // Bottom row: week start dates ("3 Apr") OR week numbers ("W14") per showWeekNumber
        const weeks = [];
        const d = new Date(start);
        for (let i = 0; i < numPeriods; i++) {
          weeks.push({ start: new Date(d), x: oX + i * colW });
          d.setDate(d.getDate() + 7);
        }

        // Week number counted from the week containing Jan 1 of that date's year,
        // relative to the configured first-day-of-week (so it tracks weekStartDay).
        const weekNumberFor = (wd) => {
          const jan1 = new Date(wd.getFullYear(), 0, 1);
          const firstWeekStart = new Date(jan1);
          firstWeekStart.setDate(jan1.getDate() - ((jan1.getDay() - weekStartDay + 7) % 7));
          return Math.floor(Math.round((wd - firstWeekStart) / 86400000) / 7) + 1;
        };

        // Group weeks by month for top row
        const monthSpans = [];
        let curMonth = -1, curYear = -1, spanStart = oX;
        weeks.forEach((w) => {
          const m = w.start.getMonth();
          const y = w.start.getFullYear();
          if (m !== curMonth || y !== curYear) {
            if (curMonth >= 0) monthSpans.push({ month: curMonth, year: curYear, startX: spanStart, endX: w.x });
            curMonth = m; curYear = y; spanStart = w.x;
          }
        });
        if (curMonth >= 0) monthSpans.push({ month: curMonth, year: curYear, startX: spanStart, endX: width });

        // Draw month spans (top row)
        monthSpans.forEach((ms, i) => {
          const spanW = ms.endX - ms.startX;
          if (i % 2 === 1) colGroup.appendChild(mkRect(ms.startX, 0, spanW, topH, 'var(--stencil-item-hover)'));
          if (ms.startX > oX) colGroup.appendChild(mkLine(ms.startX, 0, ms.startX, height, '0.5'));
          colGroup.appendChild(mkText(ms.startX + spanW / 2, topH / 2, `${MONTHS_SHORT[ms.month]} ${ms.year}`, '11', '700', 'var(--text-primary)'));
        });

        // Draw week labels (bottom row)
        weeks.forEach((w, i) => {
          if (i % 2 === 1) colGroup.appendChild(mkRect(w.x, topH, colW, botH, 'var(--stencil-item-hover)'));
          if (i > 0) colGroup.appendChild(mkLine(w.x, topH, w.x, height, '0.3'));
          const wkLabel = showWeekNumber
            ? `W${weekNumberFor(w.start)}`
            : `${w.start.getDate()} ${MONTHS_SHORT[w.start.getMonth()]}`;
          colGroup.appendChild(mkText(w.x + colW / 2, topH + botH / 2,
            wkLabel, '10', '500', 'var(--text-secondary)'));
        });
      } else {
        // Month view: top row = years, bottom row = month names
        const months = [];
        const d = new Date(start);
        for (let i = 0; i < numPeriods; i++) {
          months.push({ month: d.getMonth(), year: d.getFullYear(), x: oX + i * colW });
          d.setMonth(d.getMonth() + 1);
        }

        // Group months by year for top row
        const yearSpans = [];
        let curYear2 = -1, spanStart2 = oX;
        months.forEach((m) => {
          if (m.year !== curYear2) {
            if (curYear2 >= 0) yearSpans.push({ year: curYear2, startX: spanStart2, endX: m.x });
            curYear2 = m.year; spanStart2 = m.x;
          }
        });
        if (curYear2 >= 0) yearSpans.push({ year: curYear2, startX: spanStart2, endX: width });

        // Draw year spans (top row)
        yearSpans.forEach((ys, i) => {
          const spanW = ys.endX - ys.startX;
          if (i % 2 === 1) colGroup.appendChild(mkRect(ys.startX, 0, spanW, topH, 'var(--stencil-item-hover)'));
          if (ys.startX > oX) colGroup.appendChild(mkLine(ys.startX, 0, ys.startX, height, '0.5'));
          colGroup.appendChild(mkText(ys.startX + spanW / 2, topH / 2, String(ys.year), '11', '700', 'var(--text-primary)'));
        });

        // Draw month labels (bottom row)
        months.forEach((m, i) => {
          if (i % 2 === 1) colGroup.appendChild(mkRect(m.x, topH, colW, botH, 'var(--stencil-item-hover)'));
          if (i > 0) colGroup.appendChild(mkLine(m.x, topH, m.x, height, '0.3'));
          colGroup.appendChild(mkText(m.x + colW / 2, topH + botH / 2, MONTHS_SHORT[m.month], '10', '500', 'var(--text-secondary)'));
        });
      }

      // Bottom border line below dates when there are no rows (empty timeline)
      if (rows.length === 0) {
        colGroup.appendChild(mkLine(0, dateH, width, dateH, '0.5'));
      }

      // ── Task list panel (left side) ──
      if (rows.length > 0) {
        // Task list background
        colGroup.appendChild(mkRect(0, 0, taskListWidth, height, 'var(--bg-surface-raised)'));
        // Divider between task list and timeline
        colGroup.appendChild(mkLine(taskListWidth, 0, taskListWidth, height, '1'));
        // Title in top row (always)
        colGroup.appendChild(mkText(taskListWidth / 2, topH / 2, model.get('timelineTitle') || 'Tasks', '11', '700', 'var(--text-primary)'));
        // Description: merged bottom-date-row + phase-row area (botH + phaseRowH)
        const desc = model.get('timelineDescription') || '';
        if (desc) {
          const descY = topH + 2;
          const descH = botH + phaseRowH - 4;
          const fo = document.createElementNS(SVG_NS, 'foreignObject');
          fo.setAttribute('x', '6');
          fo.setAttribute('y', String(descY));
          fo.setAttribute('width', String(taskListWidth - 12));
          fo.setAttribute('height', String(descH));
          fo.setAttribute('pointer-events', 'none');
          const div = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
          div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
          div.style.cssText = `font-size:9px;font-family:system-ui,-apple-system,sans-serif;color:var(--text-secondary);line-height:1.3;overflow:hidden;text-align:left;word-break:break-word;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;`;
          div.textContent = desc;
          fo.appendChild(div);
          colGroup.appendChild(fo);
        }
        // Horizontal header lines
        colGroup.appendChild(mkLine(0, topH, taskListWidth, topH, '0.3'));   // title / description separator (task list only)
        colGroup.appendChild(mkLine(taskListWidth, dateH, width, dateH, '0.3')); // dates/phase separator (timeline area only)
        colGroup.appendChild(mkLine(0, headerH, width, headerH, '0.5'));      // header/task-rows separator

        // ── Project Summary overview lane ──────────────────────────────────────────────────────────────────
        // A READ-ONLY condensation of the whole plan into ONE row: every group summary bar, milestone diamond,
        // and day-marker triangle for this timeline, drawn at their date columns. For a big Gantt it's a single
        // glance at the shape of the project. Purely derived SVG (no cells) → never selectable / draggable.
        if (summaryH) {
          const bandTop = dateH + phaseRowH;            // sits below the dates, above the first task row
          const groupsArr = (model.get('groups')) || [];
          colGroup.appendChild(mkRect(oX, bandTop, width - oX, summaryH, 'var(--stencil-item-hover)'));
          colGroup.appendChild(mkLine(0, bandTop, width, bandTop, '0.4'));   // separator above the lane
          const sumLabel = document.createElementNS(SVG_NS, 'text');
          sumLabel.setAttribute('x', '12'); sumLabel.setAttribute('y', String(bandTop + summaryH / 2));
          sumLabel.setAttribute('text-anchor', 'start'); sumLabel.setAttribute('dominant-baseline', 'central');
          sumLabel.setAttribute('font-size', '10'); sumLabel.setAttribute('font-weight', '700');
          sumLabel.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
          sumLabel.setAttribute('fill', 'var(--text-secondary)'); sumLabel.setAttribute('pointer-events', 'none');
          sumLabel.textContent = 'Timeline Summary'; colGroup.appendChild(sumLabel);
          const inGrid = (lx) => lx != null && lx >= oX - 0.5 && lx <= width + 0.5;
          const mkGlyph = (d, fill) => { const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); p.setAttribute('fill', fill); p.setAttribute('pointer-events', 'none'); return p; };
          // Milestones (amber diamond) + day markers (red triangle) share the TOP subrow (issue 3) — events read as the
          // headline of the summary, with the group spans stacked beneath them.
          const my = bandTop + 9;
          const g = model.graph;
          if (g) {
            for (const e of g.getElements()) {
              const t = e.get('type');
              if (t !== 'sf.GanttMilestone' && t !== 'sf.GanttMarker') continue;
              if (ganttTimelineFor(e) !== model) continue;
              const mx = dateToLocalX(model, t === 'sf.GanttMilestone' ? e.get('milestoneDate') : e.get('markerDate'));
              if (!inGrid(mx)) continue;
              if (t === 'sf.GanttMilestone') colGroup.appendChild(mkGlyph(`M ${mx} ${my - 6} L ${mx + 6} ${my} L ${mx} ${my + 6} L ${mx - 6} ${my} Z`, 'var(--brand-amber, #F6B355)'));
              else colGroup.appendChild(mkGlyph(`M ${mx - 6} ${my + 6} L ${mx + 6} ${my + 6} L ${mx} ${my - 6} Z`, 'var(--brand-red, #DA4E55)'));
              const lbl = e.attr('label/text');
              if (lbl) colGroup.appendChild(mkText(mx, my + 14, lbl, '9', '500', 'var(--text-secondary)'));   // issue 10: lane label
            }
          }
          // Each GROUP gets its OWN SUBROW (issue 2) below the marker row, so overlapping group spans never collide — a
          // read-only copy of its derived span + progress (`ganttGroupSummary`, the same source as the group rows).
          const gBase = bandTop + GANTT_SUMMARY_MARKER_H;
          groupsArr.forEach((grp, gi) => {
            const sum = ganttGroupSummary(model, grp.id);
            if (!sum) return;
            const x0 = Math.max(sum.x0, oX), x1 = Math.min(sum.x1, width);
            if (x1 <= x0) return;
            const gy = gBase + gi * GANTT_SUMMARY_GROUP_H + GANTT_SUMMARY_GROUP_H / 2;
            const col = grp.color || 'var(--gantt-phase-fill, #2A2D32)';
            const track = mkRect(x0, gy - 4, x1 - x0, 8, col);
            track.setAttribute('rx', '2'); track.setAttribute('opacity', '0.25'); colGroup.appendChild(track);
            const fillW = Math.round((x1 - x0) * sum.progress / 100);
            if (fillW > 0) { const fill = mkRect(x0, gy - 4, fillW, 8, col); fill.setAttribute('rx', '2'); colGroup.appendChild(fill); }
            // Group NAME at the bar's left edge (item 1) — OUTLINED (theme text fill + canvas-bg stroke via
            // paint-order) so it stays legible on any fill, in either theme, whether the bar is empty or completed.
            if (grp.label) {
              const t = document.createElementNS(SVG_NS, 'text');
              t.setAttribute('x', String(x0 + 5)); t.setAttribute('y', String(gy));
              t.setAttribute('text-anchor', 'start'); t.setAttribute('dominant-baseline', 'central');
              t.setAttribute('font-size', '9'); t.setAttribute('font-weight', '700');
              t.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
              t.setAttribute('fill', 'var(--text-primary)'); t.setAttribute('stroke', 'var(--bg-canvas, #1A1A1A)');
              t.setAttribute('stroke-width', '2.5'); t.setAttribute('paint-order', 'stroke');
              t.setAttribute('pointer-events', 'none'); t.textContent = grp.label;
              colGroup.appendChild(t);
            }
          });
        }

        // Row backgrounds + alternating stripes for timeline area
        rows.forEach((task, i) => {
          const rowY = task.rowY;
          // Alternating row stripe across full width
          if (i % 2 === 1) colGroup.appendChild(mkRect(0, rowY, width, rowHeight, 'var(--stencil-item-hover)'));
          // Separator line
          colGroup.appendChild(mkLine(0, rowY, width, rowY, '0.3'));

          if (task.type === 'group') {
            // Group row: color indicator + bold label
            if (task.color) {
              const indicator = document.createElementNS(SVG_NS, 'rect');
              indicator.setAttribute('x', '8');
              indicator.setAttribute('y', String(rowY + rowHeight / 2 - 5));
              indicator.setAttribute('width', '3');
              indicator.setAttribute('height', '10');
              indicator.setAttribute('rx', '1');
              indicator.setAttribute('fill', task.color);
              indicator.setAttribute('pointer-events', 'none');
              colGroup.appendChild(indicator);
            }

            const groupLabel = document.createElementNS(SVG_NS, 'text');
            groupLabel.setAttribute('x', task.color ? '16' : '8');
            groupLabel.setAttribute('y', String(rowY + rowHeight / 2));
            groupLabel.setAttribute('text-anchor', 'start');
            groupLabel.setAttribute('dominant-baseline', 'central');
            groupLabel.setAttribute('font-size', '11');
            groupLabel.setAttribute('font-weight', '700');
            groupLabel.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
            groupLabel.setAttribute('fill', 'var(--text-primary)');
            groupLabel.setAttribute('pointer-events', 'none');
            groupLabel.textContent = task.label || 'Group';
            colGroup.appendChild(groupLabel);

            // Auto summary/progress bar (Phase 6, item 5): the group row draws a bar spanning all its tasks
            // (min start → max end), filled by the duration-weighted % done, group-coloured — no separate shape
            // needed. Derived live from the member bars' dates/progress.
            const sum = ganttGroupSummary(model, task.groupId);
            if (sum) {
              const bx0 = Math.max(sum.x0, taskListWidth);
              const bx1 = Math.min(sum.x1, width);
              if (bx1 > bx0) {
                const barH = 10, by = rowY + rowHeight / 2 - barH / 2;
                const col = task.color || 'var(--gantt-phase-fill, #2A2D32)';
                const track = mkRect(bx0, by, bx1 - bx0, barH, col);
                track.setAttribute('rx', '3'); track.setAttribute('opacity', '0.22'); colGroup.appendChild(track);
                const fillW = Math.round((bx1 - bx0) * sum.progress / 100);
                if (fillW > 0) { const fill = mkRect(bx0, by, fillW, barH, col); fill.setAttribute('rx', '3'); colGroup.appendChild(fill); }
                if (bx1 + 34 < width) colGroup.appendChild(mkText(bx1 + 18, rowY + rowHeight / 2, `${sum.progress}%`, '10', '600', 'var(--text-secondary)'));
              }
            }
          } else {
            // Task row: indented text with optional color dot
            const indent = task.groupId ? 32 : 12;

            if (task.color) {
              const dot = document.createElementNS(SVG_NS, 'circle');
              dot.setAttribute('cx', String(indent));
              dot.setAttribute('cy', String(rowY + rowHeight / 2));
              dot.setAttribute('r', '3');
              dot.setAttribute('fill', task.color || 'var(--color-primary)');
              dot.setAttribute('pointer-events', 'none');
              colGroup.appendChild(dot);
            }

            const taskLabel = document.createElementNS(SVG_NS, 'text');
            taskLabel.setAttribute('x', String(task.color ? indent + 8 : indent));
            taskLabel.setAttribute('y', String(rowY + rowHeight / 2));
            taskLabel.setAttribute('text-anchor', 'start');
            taskLabel.setAttribute('dominant-baseline', 'central');
            taskLabel.setAttribute('font-size', '11');
            taskLabel.setAttribute('font-weight', '400');
            taskLabel.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
            taskLabel.setAttribute('fill', 'var(--text-secondary)');
            taskLabel.setAttribute('pointer-events', 'none');
            taskLabel.textContent = task.label || 'Task';
            colGroup.appendChild(taskLabel);
          }
        });
      }

      // ── Event lines: the timeline's today line + a dotted FULL-HEIGHT line at each marker / milestone, so an
      //    event reads across the whole timeline (down through the bars), not just where its glyph sits. ──
      const evtLine = (lx, color, dash) => {
        if (lx == null || lx < taskListWidth - 0.5 || lx > width + 0.5) return;
        const ln = document.createElementNS(SVG_NS, 'line');
        ln.setAttribute('x1', lx); ln.setAttribute('y1', 0); ln.setAttribute('x2', lx); ln.setAttribute('y2', height);
        ln.setAttribute('stroke', color); ln.setAttribute('stroke-width', '1.5');
        ln.setAttribute('stroke-dasharray', dash); ln.setAttribute('stroke-opacity', '0.8');
        ln.setAttribute('pointer-events', 'none');
        colGroup.appendChild(ln);
      };
      if (model.get('todayDate')) evtLine(dateToLocalX(model, model.get('todayDate')), 'var(--brand-red, #DA4E55)', '4 3');
      const graph = model.graph;
      if (graph) {
        for (const e of graph.getElements()) {
          const t = e.get('type');
          if (t === 'sf.GanttMarker') { if (ganttTimelineFor(e) === model) evtLine(dateToLocalX(model, e.get('markerDate')), 'var(--brand-red, #DA4E55)', '2 3'); }
          else if (t === 'sf.GanttMilestone') { if (ganttTimelineFor(e) === model) evtLine(dateToLocalX(model, e.get('milestoneDate')), 'var(--brand-amber, #F6B355)', '2 3'); }
        }
      }
    },
  });

  // --- GanttGroup ---
  // Summary / parent task bar with bracket indicators on either end.
  // Visually a darker bar with small downward prongs at each end.
  joint.dia.Element.define(
    'sf.GanttGroup',
    {
      size: { width: 360, height: 24 },
      z: 1000,
      groupId: null,   // Phase 6: when set to a timeline group's id, x+width AUTO-SPAN that group's tasks
      attrs: {
        body: {
          width: 'calc(w)',
          height: 8,
          y: 0,
          fill: 'var(--gantt-phase-fill, #2A2D32)',
          stroke: 'none',
        },
        leftProng: {
          d: 'M 0 0 L 0 8 L 6 0',
          fill: 'var(--gantt-phase-fill, #2A2D32)',
          stroke: 'none',
        },
        rightProng: {
          d: 'M 0 0 L 0 8 L -6 0',
          fill: 'var(--gantt-phase-fill, #2A2D32)',
          stroke: 'none',
          transform: 'translate(calc(w), 0)',
        },
        label: {
          x: 4,
          y: 16,
          textAnchor: 'start',
          textVerticalAnchor: 'top',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-primary)',
          text: 'Phase',
        },
      },
      ports: {
        groups: {
          left: {
            position: { name: 'left' },
            attrs: { circle: { r: 4, magnet: true, fill: '#2A2D32', stroke: '#FFFFFF', strokeWidth: 1.5 } },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
          right: {
            position: { name: 'right' },
            attrs: { circle: { r: 4, magnet: true, fill: '#2A2D32', stroke: '#FFFFFF', strokeWidth: 1.5 } },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
        },
        items: [
          { id: 'port-left', group: 'left' },
          { id: 'port-right', group: 'right' },
        ],
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'path', selector: 'leftProng' },
        { tagName: 'path', selector: 'rightProng' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // Custom view for GanttGroup — when `groupId` links it to a timeline group, x+width AUTO-SPAN that group's
  // tasks. Re-derives on any member's dates/membership change, on add/remove, and snaps x/width back after a
  // user drag/resize that ISN'T our own {gantt:true} layout move (so it reads as x-locked but Y-free, like a
  // derived bar). An UNLINKED group (no groupId) is freely manual (back-compat).
  joint.shapes.sf.GanttGroupView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      const reSpan = () => { if (this.model.get('groupId')) applyGanttGroupGeometry(this.model); };
      this.listenTo(this.model, 'change:groupId', reSpan);
      this.listenTo(this.model, 'change:position change:size', (m, val, opt) => { if (!(opt && opt.gantt)) reSpan(); });
      if (this.model.graph) {
        this.listenTo(this.model.graph, 'add remove change:startDate change:endDate change:groupId', (cell) => {
          if (cell && cell.get && cell.get('type') === 'sf.GanttTask') reSpan();
        });
      }
    },
  });

}

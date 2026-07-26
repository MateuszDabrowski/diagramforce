// Display-menu options (CLEANUP S4) — view mode (Diagram/Table), the per-flag toggle labels + dot indicator, and the Gantt/Sequence display settings. Reads tctx.modules + canvas/components/util inside function bodies.
import { isAutoSizingEnabled, isConnectorGroupingEnabled, isCrossingBumpsEnabled, isFocusDimmingEnabled, isGridVisible } from '../canvas.js?v=1.21.2';
import { btn, tctx } from './context.js?v=1.21.2';

let _stencilWasOpenBeforeTable = false;   // restore stencil state when leaving Table mode

export function setViewMode(mode) {
  const diag = document.getElementById('btn-view-diagram');
  const tab = document.getElementById('btn-view-table');
  const isTable = mode === 'table';
  const wasTable = !!tctx.modules.tableView?.isActive?.();
  if (isTable) tctx.modules.tableView?.show?.(); else tctx.modules.tableView?.hide?.();
  // Auto-hide the side panels in Table mode (the table wants the full width); restore the
  // stencil on the way back to Diagram (or any tab change away from Table). Act only on a
  // real transition so repeated diagram-mode calls don't clobber a manually-closed stencil.
  if (isTable && !wasTable) {
    _stencilWasOpenBeforeTable = tctx.modules.stencil ? !tctx.modules.stencil.isHidden() : false;
    tctx.modules.stencil?.hide?.();
    tctx.modules.selection?.clearSelection?.();   // hides the properties inspector
  } else if (!isTable && wasTable && _stencilWasOpenBeforeTable) {
    tctx.modules.stencil?.show?.();
  }
  diag?.classList.toggle('df-toolbar__segmented-option--active', !isTable);
  diag?.setAttribute('aria-checked', String(!isTable));
  tab?.classList.toggle('df-toolbar__segmented-option--active', isTable);
  tab?.setAttribute('aria-checked', String(isTable));
  // Keep the mobile hamburger's toggle label in sync with the current view.
  const hmbLabel = document.getElementById('hmb-view-toggle-label');
  if (hmbLabel) hmbLabel.textContent = isTable ? 'View as Diagram' : 'View as Table';
}

export function updateDisplayMenuVisibility() {
  const dd = document.getElementById('display-dropdown');
  if (!dd || !tctx.modules.tabs) return;
  const type = tctx.modules.tabs.getActiveTabType();

  const isGantt = type === 'gantt';
  const isDataModel = type === 'datamodel';
  const isDataMapping = type === 'datamapping';
  const isDataObjectType = isDataModel || isDataMapping; // both use sf.DataObject
  const isSequence = type === 'sequence';

  // Diagram | Table view switch — shown for Data Mapping (lineage), Data Model (schema) and Gantt
  // (plan). Use inline display (not the `hidden` attr): `.df-toolbar__group { display:flex }`
  // outranks `[hidden]`, so the attribute alone wouldn't hide it. Reset to the Diagram view on any
  // tab change so the table never lingers showing another tab's data.
  const vsGroup = document.getElementById('view-switch-group');
  const vsSep = document.getElementById('view-switch-sep');
  const hasTable = isDataObjectType || isGantt;   // Data Mapping (lineage) + Data Model (schema) + Gantt (plan)
  if (vsGroup) vsGroup.style.display = hasTable ? '' : 'none';
  if (vsSep) vsSep.style.display = hasTable ? '' : 'none';
  if (tctx.modules.tableView?.isActive?.()) setViewMode('diagram');

  // Map bridge button — shown only for Data Model (clones it into a new Data Mapping
  // diagram). Sits in the same toolbar slot as the view switch; same inline-display rule.
  const mapGroup = document.getElementById('map-bridge-group');
  const mapSep = document.getElementById('map-bridge-sep');
  if (mapGroup) mapGroup.style.display = isDataModel ? '' : 'none';
  if (mapSep) mapSep.style.display = isDataModel ? '' : 'none';

  // Mirror the view-switch + map-bridge availability into the mobile hamburger.
  // The desktop toolbar groups live in .df-toolbar__left, which is hidden on mobile,
  // so without these the Table view + Map bridge were unreachable on a phone.
  const hmbView = document.getElementById('hmb-view-toggle');
  // Mirror the desktop gate (hasTable above): Data Mapping + Data Model + Gantt all have a Table view.
  // Data Model was omitted here, so on mobile its Table switch was unreachable (the desktop control is
  // CSS-hidden on narrow viewports, leaving the hamburger as the only path).
  if (hmbView) hmbView.style.display = (isDataObjectType || isGantt) ? '' : 'none';
  const hmbMap = document.getElementById('hmb-map');
  if (hmbMap) hmbMap.style.display = isDataModel ? '' : 'none';

  // Show/hide Gantt-specific options
  const ganttSep = document.getElementById('display-gantt-separator');
  const ganttAssignee = document.getElementById('btn-gantt-assignee');
  const ganttProgress = document.getElementById('btn-gantt-progress');
  const ganttWeekStart = document.getElementById('btn-gantt-week-start');
  const ganttWeekendStart = document.getElementById('btn-gantt-weekend-start');
  const ganttProjectSummary = document.getElementById('btn-gantt-project-summary');
  // Hide gantt separator always — auto-layout buttons (above) and gantt options are mutually exclusive
  if (ganttSep) ganttSep.style.display = 'none';
  if (ganttAssignee) ganttAssignee.style.display = isGantt ? '' : 'none';
  if (ganttProgress) ganttProgress.style.display = isGantt ? '' : 'none';
  if (ganttWeekStart) ganttWeekStart.style.display = isGantt ? '' : 'none';
  if (ganttWeekendStart) ganttWeekendStart.style.display = isGantt ? '' : 'none';
  if (ganttProjectSummary) ganttProjectSummary.style.display = isGantt ? '' : 'none';

  // The four "canvas-behaviour" toggles at the top (Auto-Fit Containers, Distributed
  // Connectors, Crossing Bumps, Focus Dimming) are meaningless for a Gantt chart — it
  // has no links to group/bump/dim, and auto-fit fights the timeline's own sizing and
  // visibly breaks it. Hide them (+ their separator) on Gantt. They stay global per-
  // browser prefs untouched for other types; auto-fit is additionally made inert for
  // the timeline at the source (embedding.js skips sf.GanttTimeline).
  ['btn-display-auto-size', 'btn-display-connector-grouping', 'btn-display-crossing-bumps', 'btn-display-focus-dimming']
    .forEach(id => { const b = document.getElementById(id); if (b) b.style.display = isGantt ? 'none' : ''; });
  const autoSizeSep = document.getElementById('display-auto-size-separator');
  if (autoSizeSep) autoSizeSep.style.display = isGantt ? 'none' : '';

  // Hide auto-layout buttons for Gantt (timeline-driven) and Sequence
  // (positions are meaningful along the lifeline axes).
  const hideAutoLayout = isGantt || isSequence;
  // Layered (barycentre) PROMOTION (v1.19.0): validated equal-or-better, and with full-spine straightening it
  // now draws straight reporting/flow lines too - so for Data Model, Architecture AND Org it's the SOLE
  // auto-layout: Horizontal/Vertical are hidden and Layered drops its "(beta)" tag, reading simply
  // "Auto Layout". (The PoC toolbar Auto-Layout dropdown was removed - auto-layout lives only in this menu.)
  // Org RE-PROMOTED (v1.19.0.27): the earlier weave was the fan-out gap bump sitting the chief too high (since
  // removed in .26); with the default gap, barycentre routes the chief->pillar connectors cleanly (one
  // distribution bar + clean drops), so Org joins the promoted set.
  // Flow joins the promoted set: a SINGLE "Auto Layout" entry (Horizontal/Vertical hidden). It routes to the
  // type-owned vertical tree layout via runAutoLayout's `flow` branch, not the barycentre core.
  const layeredPromoted = isDataModel || type === 'architecture' || type === 'org' || type === 'flow';
  const autoH = document.getElementById('btn-auto-layout-h');
  const autoV = document.getElementById('btn-auto-layout-v');
  if (autoH) autoH.style.display = (hideAutoLayout || layeredPromoted) ? 'none' : '';
  // Data Mapping flows left→right across layers, so only horizontal layout applies:
  // hide the vertical option and drop the "Horizontal" qualifier from the label.
  if (autoV) autoV.style.display = (hideAutoLayout || isDataMapping || layeredPromoted) ? 'none' : '';
  // Layered shows wherever the generic auto-layout applies (NOT Data Mapping, which has its own lane layout,
  // nor Gantt/Sequence). For the promoted types it's the SOLE option, relabelled "Auto Layout". For Process
  // it's hidden because Horizontal/Vertical ARE its layout (Mermaid hierarchical) - no separate "Layered".
  const autoLayered = document.getElementById('btn-auto-layout-layered');
  if (autoLayered) autoLayered.style.display = (hideAutoLayout || isDataMapping || type === 'process') ? 'none' : '';
  const layeredLabel = document.getElementById('auto-layout-layered-label');
  if (layeredLabel) layeredLabel.textContent = layeredPromoted ? 'Auto Layout' : 'Layered Auto Layout (beta)';
  const hLabel = document.getElementById('auto-layout-h-label');
  if (hLabel) hLabel.textContent = isDataMapping ? 'Auto Layout' : 'Horizontal Auto Layout';
  // Re-face Connectors: a link tidy for any 4-side-port diagram. Hidden for the same types as auto-layout
  // (Gantt has no free links; Sequence positions are lifeline-meaningful and its links aren't 4-side-port).
  const refaceBtn = document.getElementById('btn-reface-connectors');
  if (refaceBtn) refaceBtn.style.display = hideAutoLayout ? 'none' : '';

  // DataObject display options — shown for both Data Model and Data Mapping tabs
  // (both use sf.DataObject). Mapping is its own diagram type now, so there's no
  // per-diagram mapping-mode toggle here.
  const apiBtn = document.getElementById('btn-display-api');
  const lenBtn = document.getElementById('btn-display-lengths');
  const keysBtn = document.getElementById('btn-display-keys-only');
  const dmSep = document.getElementById('display-dm-separator');
  if (apiBtn) apiBtn.style.display = isDataObjectType ? '' : 'none';
  if (lenBtn) lenBtn.style.display = isDataObjectType ? '' : 'none';
  if (keysBtn) keysBtn.style.display = isDataObjectType ? '' : 'none';
  const collapseBtn = document.getElementById('btn-display-collapse');
  if (collapseBtn) collapseBtn.style.display = isDataObjectType ? '' : 'none';
  // In a Data Mapping diagram the key-fields toggle filters to MAPPED fields.
  const koLabel = document.getElementById('keys-only-label');
  if (koLabel) koLabel.textContent = isDataMapping ? 'Mapped Fields Only' : 'Key Fields Only';
  // ALWAYS shown — this separator divides the unchecked toggle group (the DataObject
  // field toggles when present, always ending with Animate Connectors below) from the
  // Auto Layout actions / type-specific options beneath it, in EVERY diagram type.
  if (dmSep) dmSep.style.display = '';

  // Object Relationships toggle — Data Mapping only. It's a view-only filter, so reset
  // it to visible (default ON) on each tab change and reflect that in the checkmark.
  // (updateDisplayMenuVisibility only runs on tab change / init, never on menu open.)
  const relsBtn = document.getElementById('btn-display-object-rels');
  if (relsBtn) {
    relsBtn.style.display = isDataMapping ? '' : 'none';
    if (isDataMapping) {
      tctx.modules.canvas?.setObjectRelationshipsVisible?.(true);
      relsBtn.classList.add('is-checked');
    }
  }

  // Sequence-specific toggles — diagram-wide bottom participant label toggle,
  // shown above the sequence Auto Layout action (its own separator below).
  const seqBottomBtn = document.getElementById('btn-sequence-bottom-labels');
  if (seqBottomBtn) seqBottomBtn.style.display = isSequence ? '' : 'none';
  const seqSep = document.getElementById('display-sequence-separator');
  if (seqSep) seqSep.style.display = isSequence ? '' : 'none';
  const seqAutoBtn = document.getElementById('btn-sequence-auto-layout');
  if (seqAutoBtn) seqAutoBtn.style.display = isSequence ? '' : 'none';

  // Animate Connectors — an UNCHECKED-default toggle available in EVERY diagram
  // type (per request: even Org / Gantt, not just "flow" diagrams). It stays at its
  // HTML home as the LAST item of the unchecked toggle group (after the DataObject
  // field toggles when present); the always-shown dm-separator below keeps it
  // SEPARATED from the Auto Layout actions. No per-type reposition — being visually
  // separated from Auto Layout is the desired look. Because it's shown everywhere,
  // the animation is no longer force-stopped on tab change; it's a transient global
  // view state the user clears via the checkbox.
  const flowBtn = document.getElementById('btn-animate-flow');
  if (flowBtn) flowBtn.style.display = '';

  // Sequence: keep the toggles in ONE group. Bottom Participant Labels sits directly
  // ABOVE Animate Connectors (no divider between them, Animate stays the last toggle),
  // and the sequence separator becomes the single divider before the sequence Auto
  // Layout. So move Bottom Labels just above Animate and hide the (otherwise always-on)
  // dm-separator for this type — otherwise it + the sequence separator would split the
  // toggles into three stacked single-item groups.
  if (isSequence) {
    if (dmSep) dmSep.style.display = 'none';
    if (seqBottomBtn && flowBtn && seqBottomBtn.nextElementSibling !== flowBtn) {
      flowBtn.parentNode.insertBefore(seqBottomBtn, flowBtn);
    }
  }

  if (isGantt) {
    dd.style.display = '';
    updateGanttToggleLabels();
    return;
  }
  dd.style.display = '';
  if (isDataObjectType) updateDisplayToggleLabels();
  if (isSequence) updateSequenceToggleLabels();
}

// Display-menu toggle items use a fixed noun-phrase label plus an SVG
// checkbox icon whose check state is driven by a `.is-checked` class on the
// button. These helpers just toggle that class — the SVG (empty box + tick
// path) is pre-rendered in index.html and CSS shows/hides the tick.
export function updateDisplayToggleLabels() {
  document.getElementById('btn-display-api')
    ?.classList.toggle('is-checked', isDisplayFlagOn('showLabels'));
  document.getElementById('btn-display-lengths')
    ?.classList.toggle('is-checked', isDisplayFlagOn('showFieldLengths'));
  document.getElementById('btn-display-keys-only')
    ?.classList.toggle('is-checked', isDisplayFlagOn('keyFieldsOnly'));
  document.getElementById('btn-display-collapse')
    ?.classList.toggle('is-checked', dataObjectsAllCollapsed());   // checked only when EVERY object is collapsed
  refreshDisplayDotIndicator();
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// GanttTimeline-only settings (weekStartDay, showWeekNumber) live as model props on the
// timeline cell — read from the first timeline on the tab (or a default when there is none).
export function getGanttTimelineSetting(prop, fallback) {
  const graph = tctx.modules.graph;
  if (!graph) return fallback;
  const tl = graph.getElements().find(el => el.get('type') === 'sf.GanttTimeline');
  return tl ? (tl.get(prop) ?? fallback) : fallback;
}

// Apply a timeline setting to EVERY GanttTimeline on the tab, as a single undo entry.
export function applyToAllGanttTimelines(prop, value) {
  const graph = tctx.modules.graph;
  if (!graph) return;
  const timelines = graph.getElements().filter(el => el.get('type') === 'sf.GanttTimeline');
  if (!timelines.length) return;
  tctx.modules.history.startBatch();
  try { timelines.forEach(tl => tl.set(prop, value)); }
  finally { tctx.modules.history.endBatch(); }
}

export function updateGanttToggleLabels() {
  document.getElementById('btn-gantt-assignee')
    ?.classList.toggle('is-checked', isDisplayFlagOn('showAssignee'));
  document.getElementById('btn-gantt-progress')
    ?.classList.toggle('is-checked', isDisplayFlagOn('showProgress'));
  document.getElementById('btn-gantt-project-summary')
    ?.classList.toggle('is-checked', getGanttTimelineSetting('showProjectSummary', false) === true);
  const wsLabel = document.getElementById('gantt-week-start-label');
  if (wsLabel) {
    const wsd = ((Number(getGanttTimelineSetting('weekStartDay', 1)) % 7) + 7) % 7;
    wsLabel.textContent = `Week Starts: ${WEEKDAY_NAMES[wsd]}`;
  }
  const weLabel = document.getElementById('gantt-weekend-start-label');
  if (weLabel) {
    const wesd = ((Number(getGanttTimelineSetting('weekendStartDay', 6)) % 7) + 7) % 7;
    weLabel.textContent = `Weekend Starts: ${WEEKDAY_NAMES[wesd]}`;
  }
  refreshDisplayDotIndicator();
}

export function updateSequenceToggleLabels() {
  document.getElementById('btn-sequence-bottom-labels')
    ?.classList.toggle('is-checked', isDisplayFlagOn('showBottomLabel'));
  refreshDisplayDotIndicator();
}

// Gap 14 (v1.12.0) — small dot on the Display toolbar button when any
// toggle is in a non-default state. Defaults pulled from the storage
// helpers (Auto Sizing defaults ON; Connector Grouping defaults OFF)
// and the data-model / gantt / sequence flag conventions in
// isDisplayFlagOn. Module-scope so the per-section label refreshers
// (updateDisplayToggleLabels / updateGanttToggleLabels /
// updateSequenceToggleLabels) can call it directly.

export function refreshDisplayDotIndicator() {
  const btn = document.getElementById('btn-display');
  if (!btn) return;
  const nonDefault =
    // Snap to Grid defaults ON — non-default = currently off.
    isGridVisible() === false ||
    isAutoSizingEnabled() === false ||
    // Connector Grouping defaults ON now (canvas.js → isConnectorGroupingEnabled),
    // so the non-default state is "currently off".
    isConnectorGroupingEnabled() === false ||
    // Crossing Bumps default ON (CR-5.2 PoC).
    isCrossingBumpsEnabled() === false ||
    // Focus Dimming default ON (v1.12.4).
    isFocusDimmingEnabled() === false ||
    isDisplayFlagOn('showLabels') ||
    isDisplayFlagOn('showFieldLengths') ||
    isDisplayFlagOn('keyFieldsOnly') ||
    // Gantt + sequence flags default ON — non-default = currently off.
    hasFlagFlippedOff('showAssignee') ||
    hasFlagFlippedOff('showProgress') ||
    hasFlagFlippedOff('showBottomLabel');
  // NOTE: the Gantt timeline view-preferences (Week Starts / Weekend Starts / Week Numbers)
  // are deliberately NOT counted here — they're regional/labelling choices that don't hide
  // any content, so they must not light the Display "eye" indicator.
  btn.classList.toggle('df-toolbar__button--has-active', nonDefault);
  // A6 (v1.12.0) — extend the tooltip when the dot is showing so the
  // amber indicator isn't conveyed by colour alone (WCAG 1.4.1). Strips
  // any prior suffix on every refresh so the base label stays clean.
  const base = btn.getAttribute('data-base-title') || btn.getAttribute('title') || 'View options';
  if (!btn.hasAttribute('data-base-title')) btn.setAttribute('data-base-title', base);
  btn.setAttribute('title', nonDefault ? `${base} - some toggles active` : base);
}
function hasFlagFlippedOff(flag) {
  const graph = tctx.modules.graph;
  if (!graph) return false;
  const ganttFlags = ['showAssignee', 'showProgress'];
  const sequenceFlags = ['showBottomLabel'];
  const objs = graph.getElements().filter(el => {
    const t = el.get('type');
    if (ganttFlags.includes(flag)) return t.startsWith('sf.Gantt');
    if (sequenceFlags.includes(flag)) return t === 'sf.SequenceParticipant';
    return false;
  });
  if (objs.length === 0) return false;
  return objs.some(el => el.get(flag) === false);
}

export function isDisplayFlagOn(flag) {
  const graph = tctx.modules.graph;
  if (!graph) return false;
  const ganttFlags = ['showAssignee', 'showProgress'];
  const sequenceFlags = ['showBottomLabel'];
  const isGanttFlag = ganttFlags.includes(flag);
  const isSequenceFlag = sequenceFlags.includes(flag);
  const objs = graph.getElements().filter(el => {
    const t = el.get('type');
    if (isGanttFlag) return t.startsWith('sf.Gantt');
    if (isSequenceFlag) return t === 'sf.SequenceParticipant';
    return t === 'sf.DataObject';
  });
  if (objs.length === 0) return false;
  // Default-on flags treat `undefined` as "shown" so a fresh diagram reads
  // correctly (showBottomLabel defaults to true in the shape definition;
  // Gantt flags default to true in renderGanttTaskProps).
  if (isGanttFlag || isSequenceFlag) return objs.some(el => el.get(flag) !== false);
  return objs.some(el => el.get(flag));
}

// Collapse Objects uses ALL-semantics (not the `.some()` of isDisplayFlagOn): the toggle is "checked" only when
// EVERY DataObject is collapsed, so a partially-collapsed diagram reads unchecked and one click collapses the rest.
export function dataObjectsAllCollapsed() {
  const graph = tctx.modules.graph;
  if (!graph) return false;
  const objs = graph.getElements().filter(el => el.get('type') === 'sf.DataObject');
  return objs.length > 0 && objs.every(el => !!el.get('collapsed'));
}

export function applyDisplayFlagToAll(flag, value) {
  const graph = tctx.modules.graph;
  if (!graph) return;
  const ganttFlags = ['showAssignee', 'showProgress'];
  const sequenceFlags = ['showBottomLabel'];
  const isGanttFlag = ganttFlags.includes(flag);
  const isSequenceFlag = sequenceFlags.includes(flag);
  // v1.12.1 fix — wrap the per-cell mutation in a history batch so a single
  // toggle of the Display flag (which touches N cells) collapses into ONE
  // undo entry, not N. Without this, toggling Bottom Participant Labels off
  // on a 10-participant diagram created 10 history entries, forcing the
  // user to press ⌘Z ten times to revert one click.
  tctx.modules.history.startBatch();
  try {
    graph.getElements().forEach(el => {
      const t = el.get('type');
      const matches = isGanttFlag ? t.startsWith('sf.Gantt')
        : isSequenceFlag ? t === 'sf.SequenceParticipant'
        : t === 'sf.DataObject';
      if (!matches) return;
      if (flag === 'showBottomLabel' && joint.shapes.sf.setParticipantBottomLabelVisible) {
        // Route through the helper so the header markup + port layout stay in
        // sync (mirrored header/accent/underline visibility, correct ports).
        joint.shapes.sf.setParticipantBottomLabelVisible(el, value);
      } else {
        el.set(flag, value);
      }
    });
  } finally {
    tctx.modules.history.endBatch();
  }
}

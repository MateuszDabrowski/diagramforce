// Z-tier ordering — the per-type z bands + their enforcement listeners. Extracted from
// canvas.js (Phase 4 / S7 slice 1). Every shape type maps to a base z "tier"; the 'add'
// listener assigns a fresh cell the next free z in its tier, and the 'change:z' listener
// snaps a cell back into its tier after JointJS's drag-time toFront() (embeddingMode) so
// dragging never silently reorders layers. Links live in their own tier (3000+), except
// Gantt dependency links which tuck under the bars (Z_GANTT_DEP).
//
// registerZTiers(cctx) MUST run BEFORE the first cell is added (so cctx.graph is assigned
// right after graph creation in canvas.init(), then this is called immediately). The
// _isLoadingJSON guard (via cctx.isLoadingJSON) keeps graph.fromJSON() from clobbering
// saved z values on reload. Reads the live graph via cctx; the constants + tierNameForType
// are re-exported by canvas.js for properties.js / properties/widgets.js (reorder controls).
import { cctx } from './context.js?v=1.21.5';

export const Z_BASE = {
  'sf.Zone':           0,
  'sf.TaskGroup':      0,   // RACI section grouper — Zone tier, behind its embedded Tasks (500)
  'sf.BpmnPool':       0,
  'sf.Container':      1000,
  'sf.BpmnSubprocess': 500,
  'sf.BpmnLoop':       500,
  'sf.Task':           500,   // RACI card — embeds Person(2000)/Team(1000), so it MUST stay below them. Without a tier entry the change:z listener let JointJS's drag toFront() strand it on top, "eating" its cards.
  'sf.SimpleNode':     2000,
  'sf.TextLabel':      2000,
  'sf.Line':           2000,
  'sf.Note':           2000,
  'sf.BpmnEvent':      2000,
  'sf.BpmnTask':       2000,
  'sf.BpmnGateway':    2000,
  'sf.BpmnDataObject': 2000,
  'sf.FlowProcess':    2000,
  'sf.FlowDecision':   2000,
  'sf.FlowTerminator': 2000,
  'sf.FlowDatabase':   2000,
  'sf.FlowDocument':   2000,
  'sf.FlowIO':         2000,
  'sf.FlowPredefined': 2000,
  'sf.FlowOffPage':    2000,
  'sf.Annotation':     2000,
  'sf.DataObject':     2000,
  'sf.GanttTask':      2000,
  'sf.GanttMilestone': 2000,
  'sf.GanttMarker':    2000,
  'sf.GanttTimeline':  1000,
  'sf.GanttGroup':     1000,
  'sf.OrgPerson':      2000,
  'sf.SequenceFragment':    500,   // subprocess tier — groups messages
  'sf.SequenceParticipant': 2000,  // node tier — participants + lifelines
  'sf.SequenceActor':       2000,
  'sf.SequenceActivation':  2200,  // above participant lifeline, below links
};
export const Z_TIER_SPAN = 499;   // 500 slots per tier (0–499 relative to base)
const Z_LINK_BASE  = 3000;
// Gantt dependency links render BELOW the task bars (2000 tier) but above the timeline grid (1000), so a connector
// crossing a row tucks BEHIND the bars instead of overlaying them. Exempt from the normal link tier (3000+).
export const Z_GANTT_DEP  = 1900;

// Plain-language tier names used by the property-panel reorder controls.
// One source of truth so per-renderer call sites don't have to memorise the
// "Node layer" / "Container layer" / "Zone layer" jargon (which also drifted
// inconsistent — sf.BpmnSubprocess and sf.BpmnLoop sit in the same z-tier
// but had different labels in properties.js). Grouping:
//   z <   500  → "backgrounds"   (Zone, BpmnPool)
//   z <  2000  → "containers"    (Container, BpmnSubprocess, BpmnLoop,
//                                 SequenceFragment, GanttTimeline, GanttGroup)
//   z >= 2000  → "shapes"        (every regular cell — SimpleNode, Note,
//                                 BpmnTask, OrgPerson, DataObject, etc.)
export function tierNameForType(type) {
  const base = Z_BASE[type] ?? 2000;
  if (base < 500) return 'backgrounds';
  if (base < 2000) return 'containers';
  return 'shapes';
}

export function registerZTiers(cctx) {
  const { graph } = cctx;

  // ── Fresh-drop z assignment ──────────────────────────────────────────
  // Assign each newly dropped cell the next free z within its tier, so a
  // successive drop lands on top of its peers. When loading from JSON every
  // cell already carries its saved z, so the isLoadingJSON guard leaves it alone.
  graph.on('add', (cell) => {
    // When restoring from JSON every cell already carries its correct saved z —
    // skip all reassignment so we never clobber the persisted layer order.
    if (cctx.isLoadingJSON) return;

    if (cell.isLink()) {
      // Gantt dependency links sit BELOW the bars (e.g. a pasted dep) — keep them out of the link tier.
      if (cell.prop('linkKind') === 'ganttDep') { cell.set('z', Z_GANTT_DEP); return; }
      // Always push new links to the top of the link tier
      const maxLinkZ = graph.getLinks()
        .filter(l => l !== cell)
        .reduce((m, l) => Math.max(m, l.get('z') ?? Z_LINK_BASE), Z_LINK_BASE - 1);
      cell.set('z', maxLinkZ + 1);
      return;
    }

    if (!cell.isElement()) return;
    const base = Z_BASE[cell.get('type')];
    if (base === undefined) return;

    // Unconditionally assign the correct tier z for every freshly dropped element.
    // (The isLoadingJSON guard above already protects JSON-restored cells.)
    const sameTier = graph.getElements().filter(
      el => el !== cell && el.get('z') >= base && el.get('z') < base + Z_TIER_SPAN
    );
    const nextZ = sameTier.length > 0
      ? Math.max(...sameTier.map(el => el.get('z') ?? base)) + 1
      : base;
    cell.set('z', nextZ);
  });

  // ── Z-tier enforcement on any z change ──────────────────────────────
  // JointJS calls element.toFront() during drag when embeddingMode is on
  // (inside prepareEmbedding), which pushes the element above all others.
  // This listener restores the previous z so that dragging never reorders.
  graph.on('change:z', (cell) => {
    if (cctx.isLoadingJSON) return;
    if (cell.isLink()) {
      // Gantt dependency links deliberately sit below the bar tier — don't yank them back into the link tier.
      if (cell.prop('linkKind') === 'ganttDep') return;
      const z = cell.get('z');
      if (z >= Z_LINK_BASE) return; // already in link tier
      // Restore previous z if it was valid, otherwise assign top of link tier
      const prevZ = cell.previous('z');
      if (prevZ != null && prevZ >= Z_LINK_BASE) {
        cell.set('z', prevZ);
      } else {
        const maxLinkZ = graph.getLinks()
          .filter(l => l !== cell)
          .reduce((m, l) => Math.max(m, l.get('z') ?? Z_LINK_BASE), Z_LINK_BASE - 1);
        cell.set('z', maxLinkZ + 1);
      }
      return;
    }
    if (!cell.isElement()) return;
    const base = Z_BASE[cell.get('type')];
    if (base === undefined) return;
    const z = cell.get('z');
    if (z >= base && z < base + Z_TIER_SPAN) return; // already in tier
    // Restore previous z if it was within this tier (drag didn't intend reorder)
    const prevZ = cell.previous('z');
    if (prevZ != null && prevZ >= base && prevZ < base + Z_TIER_SPAN) {
      cell.set('z', prevZ);
      return;
    }
    // Otherwise push to top of correct tier (e.g. type conversion)
    const sameTier = graph.getElements().filter(
      el => el !== cell && el.get('z') >= base && el.get('z') < base + Z_TIER_SPAN
    );
    const nextZ = sameTier.length > 0
      ? Math.max(...sameTier.map(el => el.get('z') ?? base)) + 1
      : base;
    cell.set('z', nextZ);
  });
}

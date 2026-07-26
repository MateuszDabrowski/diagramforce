// Link classifier — turns a freshly-drawn connection into the right KIND of link, and keeps
// DataObject views in sync when links change. Extracted from canvas.js (S7 slice 4).
//
// registerLinkClassifier(cctx) mounts two things on the live graph/paper:
//   1. paper.on('link:connect') — on the first successful connection, classify the link by the
//      cells + ports it touches (Gantt dependency / Data Cloud mapping / Data Model ER
//      relationship / UML sequence reply) and apply the matching style. Re-anchoring an existing
//      link is guarded so a configured relationship is never reset.
//   2. graph add/remove/change:source/change:target — a mapping link (dis)connecting changes its
//      DataObjects' mapped-field pill + visible fields, but a link add/remove/re-endpoint fires no
//      change event on the ELEMENT, so refresh the touched DataObject views explicitly.
//
// Reads cctx.graph/paper + cctx.getMappingMode; imports the apply* stylers from link-styles.js.

import { cctx } from './context.js?v=1.21.0';
import { applyGanttDepLinkStyle, applyMappingLinkStyle, applyRelationshipLinkStyle, applyFlowLinkStyle } from './link-styles.js?v=1.21.0';

export function registerLinkClassifier(cctx) {
  const { graph, paper } = cctx;

  // --- UML sequence default: reply-style links get dashed stroke ------
  // Fires when the user releases an arrowhead onto a valid port. In UML a
  // message drawn from the source's LEFT-side port into the target's RIGHT-
  // side port represents a reply / return (visually: right-to-left), which
  // convention renders as a dashed line. We apply dashed only on the very
  // first successful connection of a fresh link, and only if the user has
  // not already set an explicit dash pattern — so editing an existing link
  // never silently overrides their choice.
  paper.on('link:connect', (linkView, evt, newCellView, newCellMagnet, arrowhead) => {
    const link = linkView.model;
    const src = link.get('source');
    const tgt = link.get('target');
    if (!src?.id || !tgt?.id) return;
    const srcCell = graph.getCell(src.id);
    const tgtCell = graph.getCell(tgt.id);
    if (!srcCell || !tgtCell) return;
    // Gantt dependency: ANY link drawn between two GanttTask bars is a predecessor relationship — the source of
    // truth for the Table view's Dependencies column. Ports are OPTIONAL here (snapLinks can drop onto the bar
    // without a port), unlike the ER / mapping / sequence classifiers below which key off the specific port. So
    // just connecting two tasks IS a dependency. The `linkKind !== 'ganttDep'` guard alone protects a re-anchor
    // (an existing dep is already tagged → skip + don't re-style) — do NOT also gate on a `previous(target)` id:
    // when bars are EMBEDDED, snapLinks pre-sets the target during the drag, so that read is a false re-anchor
    // and would skip tagging a brand-new dependency (the reported "connector doesn't become a dependency" bug).
    if (srcCell.get('type') === 'sf.GanttTask' && tgtCell.get('type') === 'sf.GanttTask') {
      if (link.prop('linkKind') !== 'ganttDep') {
        link.prop('linkKind', 'ganttDep');
        applyGanttDepLinkStyle(link);
      }
      return;
    }
    // Flow connector: a link OUT of a flow element becomes a plain Standard connector (grey, "None" stub ends so it
    // TOUCHES the cards). Types are just Standard/Fault, set from the panel later; there is no connectorKind prop.
    // The stub-marker presence is the guard - a re-route (already a flow connector) keeps the user's Standard/Fault
    // choice instead of resetting it. df.Flow* never appears on non-flow diagrams, so this self-gates to flow.
    if (String(srcCell.get('type')).startsWith('df.Flow')) {
      if (link.attr('line/targetMarker/d') !== 'M 0 0 L -12 0') applyFlowLinkStyle(link, { fault: false });
      return;
    }
    // The remaining classifiers (mapping / ER / sequence) all key off the specific port → require both.
    if (!src.port || !tgt.port) return;
    // Data Cloud mapping link: a field→field link drawn while mapping mode is on
    // becomes a source→DMO mapping (distinct from a PK→FK ER relationship). The
    // properties panel can reclassify it afterwards.
    if (cctx.getMappingMode?.()
        && srcCell.get('type') === 'sf.DataObject' && tgtCell.get('type') === 'sf.DataObject'
        && String(src.port).startsWith('field-') && String(tgt.port).startsWith('field-')) {
      if (link.prop('linkKind') !== 'mapping') {
        link.prop('linkKind', 'mapping');
        applyMappingLinkStyle(link);
      }
      return;
    }
    // Data Model relationship: a link between two DataObjects when NOT in mapping mode
    // is an ER relationship — give it the relationship style (grey, orthogonal
    // sfManhattan, plain ends) so Data Model links read distinctly from Data Mapping's
    // amber mapping connectors. The panel can re-pick cardinality markers afterwards.
    if (srcCell.get('type') === 'sf.DataObject' && tgtCell.get('type') === 'sf.DataObject') {
      if (link.prop('linkKind') !== 'mapping') {
        // link:connect fires both for a freshly-DRAWN link AND when an existing link's end is
        // dragged to a new port (re-anchor). Only a brand-new link should (re)apply the default
        // relationship style — otherwise dragging a One↔Many link to a different port wipes its
        // crow's-foot markers back to plain ends (reported bug). Re-anchor = the moved end had a
        // real cell id before this drop; we ALSO bail when the link already carries ER
        // cardinality, as a belt-and-braces guard so a configured relationship is never reset.
        const reAnchor = !!link.previous(arrowhead || 'target')?.id;
        const isErCard = m => !!(m?.d) && m.d !== 'M 0 0 L -12 0';
        const hasCardinality = isErCard(link.attr('line/sourceMarker')) || isErCard(link.attr('line/targetMarker'));
        if (!reAnchor && !hasCardinality) {
          applyRelationshipLinkStyle(link);
          // A relationship drawn from a header SIDE port (er-left/er-right) defaults to
          // One ↔ One-or-Many (the common parent→child FK shape) instead of plain ends.
          if (String(src.port).startsWith('er-') || String(tgt.port).startsWith('er-')) {
            const stroke = link.attr('line/stroke') || '#888888';
            link.attr('line/sourceMarker', { type: 'path', d: 'M -12 -8 L -12 8 M -12 0 L 0 0', fill: 'none', stroke, 'stroke-width': 2, 'stroke-dasharray': 'none' });          // one
            link.attr('line/targetMarker', { type: 'path', d: 'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0 M 3 -8 L 3 8', fill: 'none', stroke, 'stroke-width': 2, 'stroke-dasharray': 'none' }); // oneMany
          }
        }
      }
      return;
    }
    const SEQ_TYPES = new Set([
      'sf.SequenceParticipant', 'sf.SequenceActor', 'sf.SequenceActivation',
    ]);
    if (!SEQ_TYPES.has(srcCell.get('type')) || !SEQ_TYPES.has(tgtCell.get('type'))) return;
    const srcPort = srcCell.getPort(src.port);
    const tgtPort = tgtCell.getPort(tgt.port);
    if (srcPort?.group !== 'seq-left' || tgtPort?.group !== 'seq-right') return;
    // Write to the custom `lineStyle` prop (not `line/strokeDasharray`) so
    // the overlay manager renders the dashes without bleeding into the
    // arrowhead marker on Safari.
    const currentStyle = link.prop('lineStyle');
    if (currentStyle && currentStyle !== 'none') return;
    link.prop('lineStyle', '8 4');   // the panel's LINK_LINE_STYLE_OPTS "Dashed" value, so the Line Style control shows Dashed (not a '6 4' that reads as Solid)
  });

  // A mapping link connecting/disconnecting changes its DataObjects' mapped-field count
  // (the X/Y header pill) and which fields are visible under "Show Only Mapped" — but a
  // link add/remove/re-endpoint doesn't fire any change event on the element, so refresh
  // the touched DataObject views explicitly.
  const refreshDataObjectById = (id) => {
    const cell = id && graph.getCell(id);
    if (cell && cell.get('type') === 'sf.DataObject') {
      const view = paper.findViewByModel(cell);
      view?._renderFieldRows?.();
      view?._syncFieldPorts?.();
      view?._renderBadges?.();
    }
  };
  const refreshLinkedDataObjects = (link) => {
    refreshDataObjectById(link.get('source')?.id);
    refreshDataObjectById(link.get('target')?.id);
  };
  graph.on('add', (cell) => { if (cell.isLink?.()) refreshLinkedDataObjects(cell); });
  graph.on('remove', (cell) => { if (cell.isLink?.()) refreshLinkedDataObjects(cell); });
  // On re-endpoint, refresh BOTH the new AND the PREVIOUS endpoint object — otherwise an
  // object a link is DRAGGED AWAY FROM never updates (its mapped X/Y pill stays stale).
  // `remove` works because the link still names both ends; a drag only names the new one.
  graph.on('change:source', (cell) => {
    if (!cell.isLink?.()) return;
    refreshDataObjectById(cell.get('source')?.id);
    refreshDataObjectById(cell.previous('source')?.id);
  });
  graph.on('change:target', (cell) => {
    if (!cell.isLink?.()) return;
    refreshDataObjectById(cell.get('target')?.id);
    refreshDataObjectById(cell.previous('target')?.id);
  });
}

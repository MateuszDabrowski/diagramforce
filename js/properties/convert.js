// Shape-type conversion (CLEANUP S2, slice 6) — the SimpleNode<->Container<->Icon conversions that rewire a
// cell in place: collectConnections/reconnectLinks (preserve links across the swap), preserveParentEmbedding
// (keep the container parent), and convertToContainer/convertToNode/convertToIcon/convertContainerToIcon/
// convertFromIcon. Each mints the replacement shape, re-attaches links + embedding, and swaps in ONE undo batch.
// Reads the live graph/selection via prctx; never imports the facade back. The facade renderers + buildCellActions
// import the 5 convertTo* back (they wire the panel's Convert buttons + the right-click convert menu).
import * as history from '../history.js?v=1.21.1';
import { prctx } from './context.js?v=1.21.1';
import { canEmbed, updateContainerHeaderLayout, updateSimpleNodeLayout } from '../canvas.js?v=1.21.1';
import { contrastTextColor } from '../components.js?v=1.21.1';
import { DEFAULT_SIZES } from './type-meta.js?v=1.21.1';

export function collectConnections(cell) {
  return prctx.graph.getConnectedLinks(cell).map(link => ({
    link,
    isSource: link.get('source')?.id === cell.id,
    isTarget: link.get('target')?.id === cell.id,
    sourcePort: link.get('source')?.port,
    targetPort: link.get('target')?.port,
  }));
}

export function reconnectLinks(connections, newId) {
  connections.forEach(({ link, isSource, isTarget, sourcePort, targetPort }) => {
    if (isSource) link.set('source', { id: newId, port: sourcePort });
    if (isTarget) link.set('target', { id: newId, port: targetPort });
  });
}

/**
 * After replacing `oldCell` with `newCell`, re-embed `newCell` in the same
 * parent IF the embedding rules allow it (e.g. a SimpleNode → Container
 * conversion stays embedded when the parent is a Zone, but not when the
 * parent is another Container). Call AFTER `prctx.graph.addCell(newCell)` but
 * BEFORE `oldCell.remove()` so the parent's `embeds` array is consistent
 * throughout. Silent no-op when there's no parent or canEmbed says no.
 */
export function preserveParentEmbedding(oldCell, newCell) {
  const parentId = oldCell.get('parent');
  if (!parentId) return;
  const parent = prctx.graph.getCell(parentId);
  if (!parent) return;
  if (!canEmbed(parent.get('type'), newCell.get('type'))) return;
  // Suppress change:parent recording — the conversion's add(newCell) command already
  // captures the embedded state in its JSON (re-captured on undo with `parent`), so the
  // embed round-trips via the add/remove pair without a separate command.
  history.suppressEmbedTracking(() => parent.embed(newCell));
}

export function convertToContainer(cell) {
  const pos = cell.position();
  const size = cell.size();
  const connections = collectConnections(cell);
  const fillColor = cell.attr('body/fill') || '#1D73C9';
  const labelColor = cell.attr('label/fill') || '#ffffff';
  const container = new joint.shapes.sf.Container({
    position: pos,
    size: { width: Math.max(size.width, 360), height: Math.max(size.height, 240) },
    attrs: {
      headerLabel:    { text: cell.attr('label/text') || 'Container', fill: labelColor },
      headerIcon:     { href: cell.attr('icon/href') || '' },
      headerSubtitle: { text: cell.attr('subtitle/text') || '' },
      accent:         { fill: fillColor },
      accentFill:     { fill: fillColor },
    },
  });
  history.startBatch();   // add + reconnect + remove = ONE undo step
  try {
    prctx.graph.addCell(container);
    updateContainerHeaderLayout(container);   // a node-without-icon → container flushes its title left
    preserveParentEmbedding(cell, container);
    reconnectLinks(connections, container.id);
    cell.remove();
    prctx.selection.selectOnly(container.id);
  } finally { history.endBatch(); }
}

export function convertToNode(cell) {
  const pos = cell.position();
  const def = DEFAULT_SIZES['sf.SimpleNode'];
  const connections = collectConnections(cell);
  cell.getEmbeddedCells().forEach(child => cell.unembed(child));
  const fillColor = cell.attr('accent/fill') || '#2A2D32';
  const tc = contrastTextColor(fillColor);
  const node = new joint.shapes.sf.SimpleNode({
    position: pos,
    size: { width: def.width, height: def.height },
    attrs: {
      label:    { text: cell.attr('headerLabel/text') || 'Node', fill: tc || '#ffffff' },
      subtitle: { text: cell.attr('headerSubtitle/text') || '', fill: tc || '#ffffff', opacity: 0.7 },
      icon:     { href: cell.attr('headerIcon/href') || '' },
      body:     { fill: fillColor },
    },
  });
  history.startBatch();   // add + layout + reconnect + remove = ONE undo step
  try {
    prctx.graph.addCell(node);
    updateSimpleNodeLayout(node);
    preserveParentEmbedding(cell, node);
    reconnectLinks(connections, node.id);
    cell.remove();
    prctx.selection.selectOnly(node.id);
  } finally { history.endBatch(); }
}

export function convertToIcon(cell) {
  // Convert a SimpleNode to icon mode — circle with icon only
  const pos = cell.position();
  const connections = collectConnections(cell);
  const fillColor = cell.attr('body/fill') || 'var(--node-bg)';
  const iconHref = cell.attr('icon/href') || '';
  // Store original data for round-trip
  const node = new joint.shapes.sf.SimpleNode({
    position: pos,
    size: { width: 64, height: 64 },
    iconMode: true,
    // Preserve original data for converting back
    _savedLabel: cell.attr('label/text') || '',
    _savedSubtitle: cell.attr('subtitle/text') || '',
    attrs: {
      body:     { fill: fillColor, rx: 32, ry: 32 },
      icon:     { href: iconHref, x: 16, y: 16, width: 32, height: 32 },
      label:    { text: '', visibility: 'hidden' },
      subtitle: { text: '', visibility: 'hidden' },
    },
  });
  history.startBatch();   // add + reconnect + remove = ONE undo step (depth-safe if a convert-all batch is already open)
  try {
    prctx.graph.addCell(node);
    preserveParentEmbedding(cell, node);
    reconnectLinks(connections, node.id);
    cell.remove();
    prctx.selection.selectOnly(node.id);
  } finally { history.endBatch(); }
}

export function convertContainerToIcon(cell) {
  // Convert a Container to icon mode SimpleNode
  const pos = cell.position();
  const connections = collectConnections(cell);
  const fillColor = cell.attr('accent/fill') || 'var(--color-primary)';
  const iconHref = cell.attr('headerIcon/href') || '';
  cell.getEmbeddedCells().forEach(child => cell.unembed(child));
  const node = new joint.shapes.sf.SimpleNode({
    position: pos,
    size: { width: 64, height: 64 },
    iconMode: true,
    _savedLabel: cell.attr('headerLabel/text') || '',
    _savedSubtitle: cell.attr('headerSubtitle/text') || '',
    attrs: {
      body:     { fill: fillColor, rx: 32, ry: 32 },
      icon:     { href: iconHref, x: 16, y: 16, width: 32, height: 32 },
      label:    { text: '', visibility: 'hidden' },
      subtitle: { text: '', visibility: 'hidden' },
    },
  });
  history.startBatch();   // add + reconnect + remove = ONE undo step (depth-safe if a convert-all batch is already open)
  try {
    prctx.graph.addCell(node);
    preserveParentEmbedding(cell, node);
    reconnectLinks(connections, node.id);
    cell.remove();
    prctx.selection.selectOnly(node.id);
  } finally { history.endBatch(); }
}

export function convertFromIcon(cell) {
  // Restore a SimpleNode from icon mode back to normal
  const pos = cell.position();
  const connections = collectConnections(cell);
  const fillColor = cell.attr('body/fill') || 'var(--node-bg)';
  const iconHref = cell.attr('icon/href') || '';
  const savedLabel = cell.get('_savedLabel') || 'Node';
  const savedSubtitle = cell.get('_savedSubtitle') || '';
  const tc = contrastTextColor(fillColor);
  const def = DEFAULT_SIZES['sf.SimpleNode'];
  const node = new joint.shapes.sf.SimpleNode({
    position: pos,
    size: { width: def.width, height: def.height },
    attrs: {
      body:     { fill: fillColor, rx: 8, ry: 8 },
      icon:     { href: iconHref, x: 12, y: 'calc(0.5 * h - 16)', width: 32, height: 32 },
      label:    { text: savedLabel, fill: tc || 'var(--node-text)', visibility: 'visible' },
      subtitle: { text: savedSubtitle, visibility: 'visible' },
    },
  });
  history.startBatch();   // add + reconnect + remove = ONE undo step (depth-safe if a convert-all batch is already open)
  try {
    prctx.graph.addCell(node);
    preserveParentEmbedding(cell, node);
    reconnectLinks(connections, node.id);
    cell.remove();
    prctx.selection.selectOnly(node.id);
  } finally { history.endBatch(); }
}

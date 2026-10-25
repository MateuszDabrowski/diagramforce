// Flow-animation overlays (CLEANUP S4) — Safari-safe marker-less link clones that animate the dash. The facade calls start/stopFlowAnimation from the Display toggle; the clone and in-place copy are line-style.js's.
import { cloneOverlay, copyOverlayAttrs } from '../canvas/line-style.js?v=1.26.4';

// ── Flow animation overlays ──────────────────────────────────────
// Safari propagates stroke-dasharray into SVG <marker> content at
// the rendering level — CSS cannot override it.  We work around this
// by cloning each link's line path WITHOUT markers, then animating
// the clone.  The original path keeps its markers un-dashed.

let _flowObserver = null;
let _flowActive = false;

export function startFlowAnimation() {
  _flowActive = true;
  syncFlowOverlays();

  const target = flowObserverTarget();
  if (target) {
    _flowObserver = new MutationObserver((mutations) => {
      if (!_flowActive) return;
      // Ignore mutations caused by either overlay system. The line-style
      // overlay in canvas.js observes the same subtree; without this filter
      // the two systems pingpong every frame and the CSS animation restarts
      // before it can advance.
      if (!flowMutationsAffectRealLinks(mutations)) return;
      // A drag rewrites `d` on each connected line every frame, and undo restores a width in place. Copy them onto that
      // line's overlay: rebuilding every overlay cost O(all links) per frame and restarted every dash animation.
      if (mutations.every((m) => m.type === 'attributes') && copyOverlayPaths(mutations)) return;
      scheduleFlowSync();
    });
    _flowObserver.observe(target, FLOW_OBSERVE);
  }
}

// The cells layer (`.joint-viewport` does not exist in JointJS 4, so this watched the whole paper SVG), and the `d`
// attribute of link paths too: JointJS reroutes a link during a drag by rewriting `d` IN PLACE, which a
// childList-only observer never sees, so the animated copy stayed on the link's old route (audit 2026-09-23; the
// same gap line-style.js closed for its own overlay). `stroke-width` too: undo restores a width in place, and the
// overlay kept the width it was cloned at, so the dashes erased a thin stripe of a thick line (review S5-4).
const FLOW_OBSERVE = { childList: true, subtree: true, attributes: true, attributeFilter: ['d', 'stroke-width'] };
function flowObserverTarget() {
  const svg = document.querySelector('#paper svg');
  return svg?.querySelector('.joint-cells-layer') || svg || null;
}

function flowMutationsAffectRealLinks(mutations) {
  for (const m of mutations) {
    if (m.type === 'attributes') {
      const cls = m.target.getAttribute?.('class') || '';
      if (cls !== 'df-flow-overlay' && cls !== 'df-line-style-overlay' && m.target.closest?.('.joint-link')) return true;
      continue;
    }
    for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      const cls = n.getAttribute?.('class') || '';
      if (cls === 'df-flow-overlay' || cls === 'df-line-style-overlay') continue;
      return true;
    }
    for (const n of m.removedNodes) {
      if (n.nodeType !== 1) continue;
      const cls = n.getAttribute?.('class') || '';
      if (cls === 'df-flow-overlay' || cls === 'df-line-style-overlay') continue;
      return true;
    }
  }
  return false;
}

// Copy each changed line onto its own overlay, in place. False when a line has no overlay yet (the caller syncs).
function copyOverlayPaths(mutations) {
  for (const m of mutations) {
    const line = m.target;
    if (line.getAttribute?.('joint-selector') !== 'line') continue;   // the hit-area wrapper, the selection halo
    const overlay = line.parentNode?.querySelector(':scope > .df-flow-overlay');
    if (!overlay) return false;
    copyOverlayAttrs(line, overlay);
  }
  _flowObserver?.takeRecords();   // the overlay writes above are ours
  return true;
}

export function stopFlowAnimation() {
  _flowActive = false;
  if (_flowObserver) { _flowObserver.disconnect(); _flowObserver = null; }
  document.querySelectorAll('.df-flow-overlay').forEach(el => el.remove());
}

let _flowSyncId = 0;
function scheduleFlowSync() {
  if (_flowSyncId) return;
  _flowSyncId = requestAnimationFrame(() => {
    _flowSyncId = 0;
    if (_flowActive) syncFlowOverlays();
  });
}

function syncFlowOverlays() {
  // Disconnect observer while we mutate the DOM to avoid feedback loops
  if (_flowObserver) _flowObserver.disconnect();

  // Scoped to the main paper's cells layer: a document-wide query also cloned the lines of other JointJS papers
  // (template thumbnails, history previews).
  const root = flowObserverTarget() || document;

  // Update each line's overlay in place and clone only a missing one: a removed and re-cloned overlay restarts its
  // CSS animation, and any change in the cells layer (a hovered connector lifted to the top, a selected card's resize
  // handles) sent every dash back to the start of its cycle at once (review S5-3). Then drop the orphans.
  const kept = new Set();
  root.querySelectorAll('.joint-link [joint-selector="line"]').forEach(line => {
    const overlay = line.parentNode.querySelector(':scope > .df-flow-overlay');
    if (overlay) copyOverlayAttrs(line, overlay);
    kept.add(overlay || cloneOverlay(line, 'df-flow-overlay'));
  });
  root.querySelectorAll('.df-flow-overlay').forEach(el => { if (!kept.has(el)) el.remove(); });

  // Reconnect observer
  if (_flowActive && _flowObserver) {
    const target = flowObserverTarget();
    if (target) _flowObserver.observe(target, FLOW_OBSERVE);
  }
}

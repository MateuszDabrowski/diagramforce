// Line-style overlays (dashed / dotted connectors) — extracted from canvas.js
// (Phase 4, Slice 8).
//
// Safari propagates stroke-dasharray into SVG <marker> content at the rendering
// level, making arrowheads/ER markers render dashed whenever the line is dashed
// — no combination of marker attributes or CSS can override this. Same
// workaround as flow animation (toolbar.js): keep the real line + markers SOLID,
// then overlay a clone painted in the canvas background colour that "erases"
// stripes to simulate the dash pattern. The user's choice is stored on
// `cell.prop('lineStyle')` so it never lands on `line/strokeDasharray`.
//
// Overlay dasharray is the user's pair reversed:
//   "8 4"  (dashed)  → overlay "4 8"  (erase 4px, show 8px solid line)
//   "2 4"  (dotted)  → overlay "4 2"  (erase 4px, show 2px solid line)
// The overlay stroke width matches the underlying line so gaps are fully erased.
//
// Reads the live graph/paper via the canvas context (cctx); the observer +
// sync-id are private module state (nothing else reads them). canvas.js calls
// startLineStyleOverlays() once in init() AFTER cctx.graph/paper are wired.
import { cctx } from './context.js?v=1.15.1';

let _lineStyleObserver = null;
let _lineStyleSyncId = 0;

// A mutation only matters to the overlay systems if it touches something
// other than an overlay path — the overlays themselves shouldn't trigger
// another re-sync.
function mutationsAffectRealLinks(mutations) {
  for (const m of mutations) {
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

function scheduleLineStyleSync() {
  if (_lineStyleSyncId) return;
  _lineStyleSyncId = requestAnimationFrame(() => {
    _lineStyleSyncId = 0;
    syncLineStyleOverlays();
  });
}

function syncLineStyleOverlays() {
  const { graph, paper } = cctx;
  if (!paper || !graph) return;
  // Disconnect the observer while we mutate the DOM to prevent feedback loops.
  if (_lineStyleObserver) _lineStyleObserver.disconnect();
  try {
    // Remove stale overlays
    document.querySelectorAll('.df-line-style-overlay').forEach(el => el.remove());

    for (const link of graph.getLinks()) {
      const style = link.prop('lineStyle');
      if (!style || style === 'none') continue;

      const linkEl = document.querySelector(`.joint-link[model-id="${link.id}"]`);
      if (!linkEl) continue;
      const lineEl = linkEl.querySelector('[joint-selector="line"]');
      if (!lineEl) continue;

      const clone = lineEl.cloneNode(false);
      clone.removeAttribute('marker-start');
      clone.removeAttribute('marker-end');
      clone.removeAttribute('marker-mid');
      clone.removeAttribute('joint-selector');
      clone.setAttribute('class', 'df-line-style-overlay');

      // Invert the user's dasharray so the overlay erases the right stripes.
      const parts = String(style).trim().split(/\s+/);
      const inverted = parts.length === 2 ? `${parts[1]} ${parts[0]}` : String(style);
      clone.setAttribute('stroke-dasharray', inverted);

      lineEl.parentNode.insertBefore(clone, lineEl.nextSibling);
    }
  } finally {
    // Reconnect the observer
    if (_lineStyleObserver) {
      const target = document.querySelector('#paper svg .joint-viewport')
                  || document.querySelector('#paper svg');
      if (target) _lineStyleObserver.observe(target, { childList: true, subtree: true });
    }
  }
}

export function startLineStyleOverlays() {
  const { graph } = cctx;
  if (_lineStyleObserver) return;
  const target = document.querySelector('#paper svg .joint-viewport')
              || document.querySelector('#paper svg');
  if (!target) return;
  _lineStyleObserver = new MutationObserver((mutations) => {
    // Ignore mutations caused by either overlay system adding/removing its
    // own paths. Without this filter the flow-animation observer (toolbar.js)
    // and this one trigger each other every frame, which destroys and
    // recreates the flow overlay faster than its CSS animation can advance
    // — the animation appears frozen on any link that also has a lineStyle.
    if (!mutationsAffectRealLinks(mutations)) return;
    scheduleLineStyleSync();
  });
  _lineStyleObserver.observe(target, { childList: true, subtree: true });

  // Re-sync when a link's lineStyle prop changes, or when links are added/removed.
  graph.on('change:lineStyle', scheduleLineStyleSync);
  graph.on('add remove', (cell) => {
    if (cell.isLink && cell.isLink()) scheduleLineStyleSync();
  });

  // Re-sync overlays whenever any geometry change could move a link's path.
  // The MutationObserver above only watches childList/subtree, so JointJS's
  // attribute-only updates (e.g. the `d` attribute on the link path during a
  // drag of a connected element) slip past it and the overlay stays pinned to
  // the link's old geometry — leaving the dashed line briefly solid until the
  // user releases the pointer. RAF debouncing in scheduleLineStyleSync keeps
  // this cheap even during a continuous drag.
  graph.on(
    'change:position change:size change:vertices change:source change:target',
    scheduleLineStyleSync,
  );

  scheduleLineStyleSync();
}

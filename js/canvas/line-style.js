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
import { cctx } from './context.js?v=1.26.5';

let _lineStyleObserver = null;
let _lineStyleSyncId = 0;

// A mutation only matters to the overlay systems if it touches something
// other than an overlay path — the overlays themselves shouldn't trigger
// another re-sync.
function mutationsAffectRealLinks(mutations) {
  for (const m of mutations) {
    if (m.type === 'attributes') {
      // A link path's `d` rewritten in place: JointJS re-routes that way, and a re-route with no model change (the
      // Spread Overlapping Connectors toggle, a colour change on another link at the same port) fires no graph event.
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

function scheduleLineStyleSync() {
  if (_lineStyleSyncId) return;
  _lineStyleSyncId = requestAnimationFrame(() => {
    _lineStyleSyncId = 0;
    syncLineStyleOverlays();
  });
}

// What an overlay never takes from its line: the markers (the reason for the copy), the JointJS selector and the
// overlay's own class.
const NOT_COPIED = new Set(['marker-start', 'marker-end', 'marker-mid', 'joint-selector', 'class']);

/** A marker-less copy of `line` with class `cls`, inserted right after it. Shared with flow-animation.js. */
export function cloneOverlay(line, cls) {
  const clone = line.cloneNode(false);
  for (const name of NOT_COPIED) clone.removeAttribute(name);
  clone.setAttribute('class', cls);
  line.parentNode.insertBefore(clone, line.nextSibling);
  return clone;
}

/** Bring an existing overlay's attributes in line with its line, in place (`d` after a re-route, `stroke-width` after a
 *  width change or its undo). Re-cloning on every sync restarted each animated dash (Animate Connectors) whenever
 *  anything in the cells layer changed (review S5-3). `own` names attributes the overlay sets itself. */
export function copyOverlayAttrs(line, overlay, own = []) {
  const skip = (name) => NOT_COPIED.has(name) || own.includes(name);
  for (const { name, value } of line.attributes) if (!skip(name) && overlay.getAttribute(name) !== value) overlay.setAttribute(name, value);
  for (const { name } of [...overlay.attributes]) if (!skip(name) && !line.hasAttribute(name)) overlay.removeAttribute(name);
}

function syncLineStyleOverlays() {
  const { graph, paper } = cctx;
  if (!paper || !graph) return;
  // Disconnect the observer while we mutate the DOM to prevent feedback loops.
  if (_lineStyleObserver) _lineStyleObserver.disconnect();
  try {
    // Update each overlay in place, clone only a missing one, then drop the overlays no dashed link claimed.
    const kept = new Set();
    for (const link of graph.getLinks()) {
      const style = link.prop('lineStyle');
      if (!style || style === 'none') continue;

      // The view, not a document-wide selector: O(1) per link instead of a DOM scan per link on every drag frame, and
      // no selector built from an id (an imported id containing `"` threw here and left every dashed link solid,
      // audit 2026-09-23).
      const linkEl = paper.findViewByModel(link)?.el;
      if (!linkEl) continue;
      const lineEl = linkEl.querySelector('[joint-selector="line"]');
      if (!lineEl) continue;

      let overlay = lineEl.parentNode.querySelector(':scope > .df-line-style-overlay');
      if (overlay) copyOverlayAttrs(lineEl, overlay, ['stroke-dasharray']);
      else overlay = cloneOverlay(lineEl, 'df-line-style-overlay');

      // Invert the user's dasharray so the overlay erases the right stripes.
      const parts = String(style).trim().split(/\s+/);
      const inverted = parts.length === 2 ? `${parts[1]} ${parts[0]}` : String(style);
      if (overlay.getAttribute('stroke-dasharray') !== inverted) overlay.setAttribute('stroke-dasharray', inverted);
      kept.add(overlay);
    }
    paper.el.querySelectorAll('.df-line-style-overlay').forEach(el => { if (!kept.has(el)) el.remove(); });
  } finally {
    // Reconnect the observer
    if (_lineStyleObserver) {
      const target = lineStyleObserverTarget();
      if (target) _lineStyleObserver.observe(target, OBSERVE);
    }
  }
}

// Child changes AND the `d` attribute of link paths: the overlay is a clone that keeps the `d` it was made with.
const OBSERVE = { childList: true, subtree: true, attributes: true, attributeFilter: ['d'] };

/** What the overlay observer watches: the CELLS layer. `.joint-viewport` (the old target) does not exist in JointJS 4,
 *  so it fell back to the whole paper SVG, and every bump, guide or drop ghost scheduled a full resync. */
function lineStyleObserverTarget() {
  const svg = cctx.paper?.svg || document.querySelector('#paper svg');
  return svg?.querySelector('.joint-cells-layer') || svg || null;
}

export function startLineStyleOverlays() {
  const { graph } = cctx;
  if (_lineStyleObserver) return;
  const target = lineStyleObserverTarget();
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
  _lineStyleObserver.observe(target, OBSERVE);

  // Re-sync when a link's lineStyle prop or attrs change (the clone copies stroke-width at sync time), or when links
  // are added/removed.
  graph.on('change:lineStyle change:attrs', scheduleLineStyleSync);
  graph.on('add remove', (cell) => {
    if (cell.isLink && cell.isLink()) scheduleLineStyleSync();
  });

  // Re-sync overlays whenever any geometry change could move a link's path. The observer above sees `d` rewrites
  // too since 1.25.9 (a re-route with no model change fires none of these); the events stay so a model change
  // resyncs even before its view renders. RAF debouncing in scheduleLineStyleSync keeps this cheap during a drag.
  graph.on(
    'change:position change:size change:vertices change:source change:target',
    scheduleLineStyleSync,
  );

  scheduleLineStyleSync();
}

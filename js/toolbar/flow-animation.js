// Flow-animation overlays (CLEANUP S4) — Safari-safe marker-less link clones that animate the dash. Self-contained (no modules, no imports); the facade calls start/stopFlowAnimation from the Display toggle.

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

  const target = document.querySelector('#paper svg .joint-viewport')
              || document.querySelector('#paper svg');
  if (target) {
    _flowObserver = new MutationObserver((mutations) => {
      if (!_flowActive) return;
      // Ignore mutations caused by either overlay system. The line-style
      // overlay in canvas.js observes the same subtree; without this filter
      // the two systems pingpong every frame and the CSS animation restarts
      // before it can advance.
      if (!flowMutationsAffectRealLinks(mutations)) return;
      scheduleFlowSync();
    });
    _flowObserver.observe(target, { childList: true, subtree: true });
  }
}

function flowMutationsAffectRealLinks(mutations) {
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

  // Remove stale overlays
  document.querySelectorAll('.df-flow-overlay').forEach(el => el.remove());

  // Clone each link line — strip markers, add animation class
  document.querySelectorAll('.joint-link [joint-selector="line"]').forEach(line => {
    const clone = line.cloneNode(false);
    clone.removeAttribute('marker-start');
    clone.removeAttribute('marker-end');
    clone.removeAttribute('marker-mid');
    clone.removeAttribute('joint-selector');
    clone.setAttribute('class', 'df-flow-overlay');
    line.parentNode.insertBefore(clone, line.nextSibling);
  });

  // Reconnect observer
  if (_flowActive && _flowObserver) {
    const target = document.querySelector('#paper svg .joint-viewport')
                || document.querySelector('#paper svg');
    if (target) {
      _flowObserver.observe(target, { childList: true, subtree: true });
    }
  }
}

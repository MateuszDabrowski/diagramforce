// Shared transient-overlay lifecycle (CLEANUP V1). Three canvas overlays — review-overlay.js (Change Review),
// diagram-check.js (loose connectors), capture-overlay.js (capture halos) — each drew into an own `<g>` inside
// `.joint-layers` and had a byte-for-byte-identical lifecycle: create the layer after `.joint-cells-layer` (so it
// rides the paper pan/zoom transform for free), redraw on graph move/add/remove + paper `render:done`, and
// auto-clear on a graph `reset` (tab switch / new diagram / JSON load). That machinery lived in triplicate, so a
// fix to one silently missed the others. This is the single source; each overlay keeps only its own draw() +
// public API + rect/halo builders (those DELIBERATELY differ per overlay — stroke width, dash, opacity).
//
// createOverlay({ className, events, onTeardown }) returns:
//   layer()      → the (memoised) <g>, created on first use; draw fns append their SVG here
//   clear()      → empty the <g>
//   setDraw(fn)  → register the per-overlay draw callback
//   draw()       → run the draw callback now (callers guard when appropriate)
//   activate()   → first call: draw + subscribe (move/size/render:done + once('reset') → deactivate).
//                  Re-entry while active: just redraws (no stacked listeners) — capture's same-captor refresh.
//   deactivate() → unsubscribe, clear + remove the <g>, run onTeardown (reset the overlay's own state / fire a
//                  caller banner). Idempotent: a no-op when not active.
//   isActive()   → activation state (review exposes this as isReviewing()).
import { cctx } from './context.js?v=1.19.5.8';

const SVGNS = 'http://www.w3.org/2000/svg';

export function createOverlay({ className, events, onTeardown } = {}) {
  let layer = null;
  let redraw = null;      // the bound listener (kept so we can .off the exact reference)
  let drawFn = () => {};
  let active = false;

  function ensureLayer() {
    const { paper } = cctx;
    const cellsLayer = paper?.svg?.querySelector?.('.joint-cells-layer');
    const layersGroup = cellsLayer?.parentNode;
    if (!layersGroup) return null;
    if (layer && layer.parentNode) return layer;
    layer = document.createElementNS(SVGNS, 'g');
    layer.setAttribute('class', className);
    layer.setAttribute('pointer-events', 'none');
    // Above cells + links (below the tools layer) — the same anchor the crossing-bump overlay uses, so the
    // overlay is painted in the scaled layer group and tracks pan/zoom without any per-frame transform math.
    layersGroup.insertBefore(layer, cellsLayer.nextSibling);
    return layer;
  }

  function clearLayer() {
    if (layer) while (layer.firstChild) layer.removeChild(layer.firstChild);
  }

  const api = {
    isActive: () => active,
    layer: ensureLayer,
    clear: clearLayer,
    setDraw(fn) { drawFn = fn; },
    draw() { drawFn(); },
    activate() {
      const { graph, paper } = cctx;
      if (!graph || !paper) return false;
      if (active) { drawFn(); return true; }   // re-entry: refresh only — never stack a second listener set
      active = true;
      drawFn();
      redraw = () => { if (active) drawFn(); };
      graph.on(events, redraw);
      paper.on('render:done', redraw);
      graph.once('reset', api.deactivate);   // tab switch / new diagram / JSON load
      return true;
    },
    deactivate() {
      if (!active) return;
      const { graph, paper } = cctx;
      active = false;
      if (graph && redraw) graph.off(events, redraw);
      if (paper && redraw) paper.off('render:done', redraw);
      graph?.off?.('reset', api.deactivate);
      redraw = null;
      clearLayer();
      if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
      layer = null;
      if (onTeardown) { try { onTeardown(); } catch { /* per-overlay teardown is best-effort */ } }
    },
  };
  return api;
}

// Viewport domain — user-space navigation: zoom (wheel / trackpad pinch / touch
// pinch / buttons), pan (mouse drag / two-finger / touch), the dot grid, and
// viewport get/set for per-tab restore. Extracted from canvas.js (Phase 4,
// Slice 6).
//
// All viewport state + input handlers live here. canvas.js stays the single
// writer of the canvas context (cctx): it creates the JointJS graph/paper, wires
// them onto cctx in init(), then calls registerViewportControls(cctx) to attach
// the listeners and expose `getZoom` + `fitContent` back onto cctx for the
// sub-modules that need them (e.g. auto-layout.js calls cctx.fitContent()).
import { cctx } from './context.js?v=1.15.6';
import { centerX, centerY, clamp } from '../util/geometry.js?v=1.15.6';

// ── Zoom + grid state ───────────────────────────────────────────────
let currentZoom = 1;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.1;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let gridVisible = true;

// ── Grid colour (theme-aware) ───────────────────────────────────────
// Shared with canvas.js's initial paper setup (imported there), hence exported.
const GRID_COLOR_DARK = 'rgba(255,255,255,0.15)';
const GRID_COLOR_LIGHT = 'rgba(0,0,0,0.25)';

export function getGridColor() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? GRID_COLOR_DARK : GRID_COLOR_LIGHT;
}

function updateZoomDisplay() {
  const el = document.getElementById('zoom-level');
  if (el) el.textContent = `${Math.round(currentZoom * 100)}%`;
}

function setZoom(zoom) {
  const { paper } = cctx;
  currentZoom = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
  paper.scale(currentZoom, currentZoom);
  updateZoomDisplay();
}

export function zoomIn() { setZoom(currentZoom + ZOOM_STEP); }
export function zoomOut() { setZoom(currentZoom - ZOOM_STEP); }

export function fitContent() {
  const { graph, paper } = cctx;
  if (graph.getCells().length === 0) return;

  // Reset transform to get clean model-space content bbox
  paper.translate(0, 0);
  paper.scale(1, 1);

  const contentBBox = paper.getContentBBox({ useModelGeometry: true });
  if (!contentBBox || contentBBox.width === 0 || contentBBox.height === 0) return;

  // Get paper visible area
  const paperRect = paper.el.getBoundingClientRect();
  const padding = 60;

  // Compute scale to fit content with padding
  const scaleX = (paperRect.width - padding * 2) / contentBBox.width;
  const scaleY = (paperRect.height - padding * 2) / contentBBox.height;
  const newZoom = Math.min(scaleX, scaleY, 2); // maxScale: 2

  paper.scale(newZoom, newZoom);

  // Center: translate so content center aligns with paper center
  const cx = centerX(contentBBox);
  const cy = centerY(contentBBox);
  const tx = paperRect.width / 2 - cx * newZoom;
  const ty = paperRect.height / 2 - cy * newZoom;
  paper.translate(tx, ty);

  currentZoom = newZoom;
  updateZoomDisplay();
}

export function toggleGrid() {
  const { paper } = cctx;
  gridVisible = !gridVisible;
  if (gridVisible) {
    paper.setGridSize(4);
    paper.setGrid({ name: 'dot', args: { color: getGridColor(), scaleFactor: 4 } });
  } else {
    paper.setGridSize(1);
    paper.setGrid(false);
  }
  return gridVisible;
}

export function refreshGrid() {
  const { paper } = cctx;
  if (gridVisible) {
    paper.setGrid({ name: 'dot', args: { color: getGridColor(), scaleFactor: 4 } });
  }
}

export function getViewport() {
  const { paper } = cctx;
  return {
    zoom: currentZoom,
    translate: paper.translate(),
  };
}

export function setViewport({ zoom, translate } = {}) {
  const { paper } = cctx;
  if (zoom != null) setZoom(zoom);
  if (translate != null) paper.translate(translate.tx, translate.ty);
}

// ── Input handlers — pan + pinch/zoom ───────────────────────────────
// The Bridge: canvas.js calls this once in init() (after cctx.graph/paper are
// wired) to attach every pointer/touch/gesture/wheel listener and to expose the
// forward-ref zoom getter + fitContent onto cctx for the sub-modules.
export function registerViewportControls(cctx) {
  const { paper } = cctx;

  // --- Pan (drag on blank canvas area) ---
  paper.on('blank:pointerdown', (evt) => {
    if (evt.shiftKey) return; // shift+drag is rubber-band in selection.js
    if (evt.pointerType === 'touch') return; // touch pan handled separately
    isPanning = true;
    panStart = { x: evt.clientX, y: evt.clientY };
    document.body.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (evt) => {
    if (!isPanning) return;
    const dx = evt.clientX - panStart.x;
    const dy = evt.clientY - panStart.y;
    panStart = { x: evt.clientX, y: evt.clientY };
    const t = paper.translate();
    paper.translate(t.tx + dx, t.ty + dy);
  });

  document.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      document.body.style.cursor = '';
    }
  });

  // --- Touch: single-finger pan + pinch-to-zoom ---
  let touchPanStart = null;
  let touchPinchDist = null;
  let touchPinchZoom = null;
  let touchPinchCenter = null;

  const canvasEl = document.getElementById('canvas-container');

  canvasEl.addEventListener('touchstart', (evt) => {
    if (evt.touches.length === 1) {
      // Single-finger → pan
      touchPanStart = { x: evt.touches[0].clientX, y: evt.touches[0].clientY };
      touchPinchDist = null;
    } else if (evt.touches.length === 2) {
      // Two-finger → pinch zoom
      touchPanStart = null;
      const dx = evt.touches[1].clientX - evt.touches[0].clientX;
      const dy = evt.touches[1].clientY - evt.touches[0].clientY;
      touchPinchDist = Math.hypot(dx, dy);
      touchPinchZoom = currentZoom;
      touchPinchCenter = {
        x: (evt.touches[0].clientX + evt.touches[1].clientX) / 2,
        y: (evt.touches[0].clientY + evt.touches[1].clientY) / 2,
      };
      evt.preventDefault();
    }
  }, { passive: false });

  canvasEl.addEventListener('touchmove', (evt) => {
    if (evt.touches.length === 1 && touchPanStart) {
      // Single-finger pan
      const dx = evt.touches[0].clientX - touchPanStart.x;
      const dy = evt.touches[0].clientY - touchPanStart.y;
      touchPanStart = { x: evt.touches[0].clientX, y: evt.touches[0].clientY };
      const t = paper.translate();
      paper.translate(t.tx + dx, t.ty + dy);
      evt.preventDefault();
    } else if (evt.touches.length === 2 && touchPinchDist != null) {
      // Pinch zoom
      const dx = evt.touches[1].clientX - evt.touches[0].clientX;
      const dy = evt.touches[1].clientY - evt.touches[0].clientY;
      const dist = Math.hypot(dx, dy);
      const scale = dist / touchPinchDist;
      const newZoom = clamp(touchPinchZoom * scale, ZOOM_MIN, ZOOM_MAX);
      if (newZoom !== currentZoom) {
        const paperRect = paper.el.getBoundingClientRect();
        const cx = touchPinchCenter.x - paperRect.left;
        const cy = touchPinchCenter.y - paperRect.top;
        const t = paper.translate();
        const s = newZoom / currentZoom;
        paper.scale(newZoom, newZoom);
        paper.translate(cx - s * (cx - t.tx), cy - s * (cy - t.ty));
        currentZoom = newZoom;
        updateZoomDisplay();
      }
      evt.preventDefault();
    }
  }, { passive: false });

  canvasEl.addEventListener('touchend', () => {
    touchPanStart = null;
    if (touchPinchDist != null) {
      touchPinchDist = null;
      touchPinchZoom = null;
      touchPinchCenter = null;
    }
  });

  // iOS Safari ignores `touch-action` for its non-standard pinch "gesture"
  // events and will viewport-zoom the whole page — which, after a panel
  // reflow, can strand the UI chrome off-screen and lock the user out. The
  // canvas drives its own pinch via the touch handlers above and the
  // trackpad-gesture handlers below (paper.scale), so suppress the browser's
  // gesture-zoom document-wide. The canvas-level gesture handlers below run
  // first and preventDefault too, so this only governs non-canvas areas.
  ['gesturestart', 'gesturechange'].forEach((type) => {
    document.addEventListener(type, (evt) => evt.preventDefault(), { passive: false });
  });

  // Anchor-zoom: set the zoom level while keeping the canvas point currently
  // under (clientX, clientY) visually fixed. Shared by the wheel-pinch handler
  // and the Safari trackpad-gesture handlers so every pinch input agrees.
  const zoomToClientPoint = (newZoom, clientX, clientY) => {
    const paperRect = paper.el.getBoundingClientRect();
    const px = clientX - paperRect.left;
    const py = clientY - paperRect.top;
    const t = paper.translate();
    const scale = newZoom / currentZoom;
    paper.scale(newZoom, newZoom);
    paper.translate(px - scale * (px - t.tx), py - scale * (py - t.ty));
    currentZoom = newZoom;
    updateZoomDisplay();
  };

  // Safari/WebKit emits proprietary gesture events for a desktop trackpad pinch
  // (Chrome instead synthesizes ctrl+wheel, handled below — and never fires
  // these, so the handlers are inert there). Without this, Safari's only pinch
  // signal is a weak ctrl+wheel residual that crawls. `evt.scale` is cumulative
  // from gesturestart (1.0 at start), so multiply the baseline captured then;
  // anchor to the gesture centroid (clientX/clientY).
  let gestureBaselineZoom = null;
  paper.el.addEventListener('gesturestart', (evt) => {
    evt.preventDefault();
    gestureBaselineZoom = currentZoom;
  }, { passive: false });
  paper.el.addEventListener('gesturechange', (evt) => {
    evt.preventDefault();
    if (gestureBaselineZoom == null) return;
    const newZoom = clamp(gestureBaselineZoom * evt.scale, ZOOM_MIN, ZOOM_MAX);
    if (newZoom !== currentZoom) zoomToClientPoint(newZoom, evt.clientX, evt.clientY);
  }, { passive: false });
  paper.el.addEventListener('gestureend', (evt) => {
    evt.preventDefault();
    gestureBaselineZoom = null;
  }, { passive: false });

  // --- Zoom (pinch) and Pan (two-finger scroll) ---
  paper.el.addEventListener('wheel', (evt) => {
    evt.preventDefault();

    // On macOS, pinch gesture sets ctrlKey=true; two-finger scroll sets ctrlKey=false
    if (!evt.ctrlKey) {
      // Two-finger scroll → pan the canvas
      const t = paper.translate();
      paper.translate(t.tx - evt.deltaX, t.ty - evt.deltaY);
      return;
    }

    // Skip ctrl+wheel pinch while a Safari trackpad gesture is driving the
    // zoom, so the two paths never double-count on a browser that emits both.
    if (gestureBaselineZoom != null) return;

    // Pinch → zoom toward cursor (proportional to pinch speed)
    const newZoom = clamp(currentZoom * Math.pow(0.996, evt.deltaY), ZOOM_MIN, ZOOM_MAX);
    if (newZoom === currentZoom) return;
    zoomToClientPoint(newZoom, evt.clientX, evt.clientY);
  }, { passive: false });

  // ── Expose viewport state to the sub-modules via cctx (one-way, like the
  //    other forward-refs). getZoom is read where screen-space math needs the
  //    live scale; fitContent is called by auto-layout.js after a layout pass.
  cctx.getZoom = () => currentZoom;
  cctx.fitContent = fitContent;
}

// Mobile bottom-sheet drag handles — touch/pointer resize + swipe-collapse for
// the stencil and properties panels on narrow viewports, plus shared panel-
// height persistence. Extracted from canvas.js (Phase 4, Slice 7).
//
// Pure DOM / window / localStorage — no JointJS graph or paper, so this leaf
// needs no canvas context (cctx). initMobileDragHandles is called by app.js;
// syncMobilePanelHeight by properties.js (both via the canvas facade re-export).

const MOBILE_BP = 768;

// Shared localStorage key for both panels — they share the same height
const PANEL_HEIGHT_KEY = 'df-panel-h';

/** Apply saved panel height to a target element (mobile only). */
function restorePanelHeight(target) {
  if (window.innerWidth > MOBILE_BP) return;
  const savedH = localStorage.getItem(PANEL_HEIGHT_KEY);
  if (savedH) {
    const h = Math.max(80, Math.min(window.innerHeight * 0.8, parseInt(savedH, 10)));
    target.style.height = h + 'px';
  }
}

export function initMobileDragHandles() {
  document.querySelectorAll('.df-drag-handle').forEach(handle => {
    // Skip if already initialized
    if (handle.dataset.dragInit) return;
    handle.dataset.dragInit = '1';

    const targetId = handle.dataset.target;
    const target = document.getElementById(targetId);
    if (!target) return;

    // Gap 25 (v1.12.0) — make the handle a real a11y citizen. Without
    // these attributes it's a bare <div> with `cursor: ns-resize`,
    // discoverable only by sighted pointer users. The `separator` role
    // with `aria-orientation="horizontal"` is the ARIA-defined match for
    // a draggable splitter that resizes adjacent regions.
    if (!handle.hasAttribute('role'))            handle.setAttribute('role', 'separator');
    if (!handle.hasAttribute('aria-orientation')) handle.setAttribute('aria-orientation', 'horizontal');
    if (!handle.hasAttribute('aria-label'))      handle.setAttribute('aria-label', 'Resize panel — use arrow keys');
    if (!handle.hasAttribute('tabindex'))        handle.setAttribute('tabindex', '0');

    // Gap 25 (v1.12.0) — keyboard nudge. Up/Down adjust height by 16 px
    // (one grid unit); PageUp/PageDown by 64 px for coarse moves;
    // Home/End jump to min/max. Mirrors the splitter pattern in the
    // ARIA Authoring Practices Guide.
    handle.addEventListener('keydown', (evt) => {
      if (window.innerWidth > MOBILE_BP) return;
      const step = (evt.key === 'PageUp' || evt.key === 'PageDown') ? 64 : 16;
      const curH = target.getBoundingClientRect().height;
      const maxH = window.innerHeight * 0.8;
      let newH = curH;
      if (evt.key === 'ArrowUp' || evt.key === 'PageUp')         newH = Math.min(maxH, curH + step);
      else if (evt.key === 'ArrowDown' || evt.key === 'PageDown') newH = Math.max(80,   curH - step);
      else if (evt.key === 'Home')                                newH = maxH;
      else if (evt.key === 'End')                                 newH = 80;
      else return;
      evt.preventDefault();
      target.style.height = newH + 'px';
      localStorage.setItem(PANEL_HEIGHT_KEY, Math.round(newH));
    });

    restorePanelHeight(target);

    // Use pointer events — works for both mouse and touch
    handle.addEventListener('pointerdown', (evt) => {
      // Only act on mobile
      if (window.innerWidth > MOBILE_BP) return;

      evt.preventDefault();
      evt.stopPropagation();
      handle.setPointerCapture(evt.pointerId);

      const startY = evt.clientY;
      const startT = Date.now();
      const startH = target.getBoundingClientRect().height;
      let lastY = startY;
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';

      const onMove = (e) => {
        lastY = e.clientY;
        const delta = startY - e.clientY;
        const maxH = window.innerHeight * 0.8;
        const newH = Math.max(80, Math.min(maxH, startH + delta));
        target.style.height = newH + 'px';
      };

      const onEnd = () => {
        document.body.style.userSelect = '';
        document.body.style.webkitUserSelect = '';
        const dt = Date.now() - startT;
        const totalDown = lastY - startY;

        // Swipe-down to collapse: fast downward flick OR large downward drag.
        const isSwipeDown = (dt < 300 && totalDown > 50) || totalDown > 120;
        if (isSwipeDown) {
          target.style.height = '';
          if (target.id === 'properties-panel') {
            target.classList.add('df-properties--hidden');
          } else if (target.id === 'stencil-panel') {
            target.classList.add('df-stencil--hidden');
            const btn = document.getElementById('btn-toggle-stencil');
            if (btn) btn.classList.remove('df-toolbar__button--active');
          }
        } else {
          const finalH = Math.round(target.getBoundingClientRect().height);
          localStorage.setItem(PANEL_HEIGHT_KEY, finalH);
        }
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onEnd);
        handle.removeEventListener('pointercancel', onEnd);
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onEnd);
      handle.addEventListener('pointercancel', onEnd);
    });
  });
}

/** Sync properties panel height to shared panel height when it opens (mobile). */
export function syncMobilePanelHeight(panelEl) {
  if (window.innerWidth > MOBILE_BP || !panelEl) return;
  restorePanelHeight(panelEl);
}

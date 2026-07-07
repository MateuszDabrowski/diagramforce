// Shared dismissal lifecycle for the app's two custom popup surfaces — the canvas right-click menu
// (selection.js `.df-ctx-menu`) and the tab popovers (tabs.js `.df-tab-pop`). ONE implementation of the three
// things a transient popup must get right, so the two surfaces can't drift apart on them (CLEANUP V3):
//
//   1. Outside-press closes — a PERSISTENT capture-phase listener. The canvas menu used `{ once: true }`, which
//      self-removed on the FIRST press even when that press was INSIDE the menu (the handler returned without
//      closing), permanently breaking outside-dismissal for the rest of the menu's life. A persistent listener
//      that simply ignores inside presses fixes it.
//   2. Escape closes AND stops propagation (capture-phase) — so the app's global Escape handler (keyboard.js,
//      bubble-phase) never runs while a menu is open. The canvas menu had NO Escape handler, so Escape fell
//      through and cleared the canvas selection out from under the still-open menu.
//   3. A teardown that removes both listeners, returned to the caller to invoke from its own close path.
//
// The listeners attach on the next tick (setTimeout 0) so the very press/right-click that OPENED the menu doesn't
// immediately dismiss it. `event` is the outside-press event to watch: 'pointerdown' for the touch-capable canvas
// menu, 'mousedown' for the desktop-only tab popovers — kept per-surface so neither regresses.

/**
 * Wire outside-press + Escape dismissal for a popup `panel`. Calls `onClose` when the user presses outside the
 * panel or hits Escape (Escape's propagation is stopped so no global handler also fires). Returns a teardown that
 * removes both document listeners (and cancels the deferred attach if the popup closes before the next tick) —
 * the caller MUST call it from its close path so the listeners never leak.
 *
 * @param {HTMLElement} panel - the popup root; a press inside it is ignored.
 * @param {() => void} onClose - invoked to close the popup (typically the caller's own close function).
 * @param {{ event?: 'pointerdown' | 'mousedown' }} [opts]
 * @returns {() => void} teardown
 */
export function wireMenuDismiss(panel, onClose, { event = 'pointerdown' } = {}) {
  const onPress = (e) => { if (!panel.contains(e.target)) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
  const timer = setTimeout(() => {
    document.addEventListener(event, onPress, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
  return () => {
    clearTimeout(timer);
    document.removeEventListener(event, onPress, true);
    document.removeEventListener('keydown', onKey, true);
  };
}

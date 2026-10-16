// Unified feedback primitives (v1.12.0 Phase 1)
//
// Two helpers that replace every remaining native `window.alert()` and
// `window.confirm()` in the codebase — and provide a non-blocking success
// channel for silent actions (save, export, load).
//
//   showToast(message, kind?)     — non-blocking, auto-dismisses after 4s
//   confirmModal(opts) → Promise  — resolves to true (ok) or false (cancel)
//
// Both stay inside the existing SLDS-flavoured visual language: toasts
// inherit theme tokens from CSS custom properties; the confirm modal
// reuses the established `.df-modal` structure so it looks identical to
// every other dialog in the app.
//
// Zero-framework, vanilla ES module. Idempotent — calling showToast many
// times stacks toasts; calling confirmModal during another open modal
// stacks z-indices so the new one sits on top.

// ── Toast ─────────────────────────────────────────────────────────

const TOAST_DEFAULT_DURATION = 4000;
let toastContainerEl = null;

function ensureToastContainer() {
  if (toastContainerEl && toastContainerEl.isConnected) { positionToastContainer(); return toastContainerEl; }
  toastContainerEl = document.createElement('div');
  toastContainerEl.className = 'df-toast-container';
  toastContainerEl.setAttribute('role', 'status');
  toastContainerEl.setAttribute('aria-live', 'polite');
  toastContainerEl.setAttribute('aria-atomic', 'true');
  document.body.appendChild(toastContainerEl);
  positionToastContainer();
  return toastContainerEl;
}

/** Toasts sit at the TOP, centered, just below the tab bar — that's where the user's eyes are (the menus +
 *  the actions that fire toasts live up there). Measured from the live tab-bar bottom so it tracks navbar
 *  height / wrapping / mobile; falls back to a sane offset if the tab bar isn't mounted yet. */
function positionToastContainer() {
  if (!toastContainerEl) return;
  let top = 80;   // fallback ≈ toolbar + tab bar
  try { const r = document.querySelector('.df-tabs')?.getBoundingClientRect(); if (r && r.bottom > 0) top = r.bottom + 12; }
  catch { /* keep fallback */ }
  toastContainerEl.style.top = `${Math.round(top)}px`;
}

/**
 * Show a transient, non-blocking notification.
 *
 * @param {string} message  Plain text to display.
 * @param {'success'|'info'|'warning'|'error'} [kind='info']  Visual variant.
 * @param {object} [opts]   { duration?: number — ms before auto-dismiss,
 *                            action?: { label, onClick } — one button after the message (1.25.2),
 *                            sticky?: true — no auto-dismiss; a close button instead (1.25.2),
 *                            multiline?: true — keep the message's line breaks (1.25.9; every message wraps),
 *                            dismissOnClick?: false — a click on the body does not close it (S8-3),
 *                            onClose?: fn — also run when the close button is clicked (S8-3) }
 * @returns {Function}      Dismiss handle. Also exposes `.update(message)` which
 *                          rewrites the toast text in place (used by long-running
 *                          operations like GIF export to show frame N/M progress
 *                          without flashing the toast in and out — Gap 27).
 */
/** The text a toast shows. A success toast already draws a check icon, so a trailing " ✓" in its message (about 24
 *  callers) would show two; drop it here, once, rather than at every call site (Q11). Other kinds keep theirs. */
export function toastMessageText(message, kind) {
  const text = String(message);
  return kind === 'success' ? text.replace(/\s*✓\s*$/, '') : text;
}

export function showToast(message, kind = 'info', opts = {}) {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `df-toast df-toast--${kind}`;
  toast.setAttribute('role', kind === 'error' || kind === 'warning' ? 'alert' : 'status');

  // Inline SVG icon per kind — tiny, currentColor-driven so it follows the
  // toast's text colour and works in both light and dark themes.
  const ICONS = Object.assign(Object.create(null), {
    success: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6 10.5L3.5 8l-1 1L6 12.5l8-8-1-1L6 10.5z" fill="currentColor"/></svg>',
    info:    '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 6.5V12M8 4.5h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    warning: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 1.5L1 14h14L8 1.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6V10M8 12h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    error:   '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 5l6 6M11 5l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  });
  toast.innerHTML = `
    <span class="df-toast__icon">${ICONS[kind] || ICONS.info}</span>
    <span class="df-toast__message"></span>
  `;
  // Use textContent for the message so user-supplied strings can't inject markup.
  const messageEl = toast.querySelector('.df-toast__message');
  messageEl.textContent = toastMessageText(message, kind);
  // A list (the flow import's notes) needs its line breaks: a plain toast wraps its message but collapses them.
  if (opts.multiline) toast.classList.add('df-toast--multiline');
  container.appendChild(toast);

  // Trigger the enter animation on the next frame so the initial style
  // transition has a starting point to interpolate from.
  requestAnimationFrame(() => toast.classList.add('df-toast--shown'));

  const duration = opts.duration ?? TOAST_DEFAULT_DURATION;
  let dismissTimer = null;
  let leaving = false;
  const dismiss = () => {
    // Once only: a second call would re-measure the half-collapsed box and restart the collapse.
    if (leaving || !toast.isConnected) return;
    leaving = true;
    clearTimeout(dismissTimer);
    toast.classList.remove('df-toast--shown');
    // The 120 ms exit fade (--df-motion-fast, css/modals.css) plays first. The leaving toast is out of the
    // accessibility tree at once (aria-hidden), so it never stands in for a live one. It still takes clicks while it
    // fades, so the second click of a double-click does not reach the canvas; `leaving` makes those clicks no-ops.
    toast.setAttribute('aria-hidden', 'true');
    // Then the box collapses (and the 8px gap under it), so the newer toasts below slide up into its place.
    // Removing it straight after the fade made each of them jump by its height in one frame.
    setTimeout(() => {
      if (!toast.isConnected) return;
      toast.style.height = `${toast.offsetHeight}px`;
      void toast.offsetHeight;   // commit the pinned height as the start of the collapse
      toast.classList.add('df-toast--collapsing');
      toast.style.height = '0px';
      const remove = () => toast.remove();
      // The toast's own height only: a hover transition on the action or close button bubbles up here too.
      toast.addEventListener('transitionend', (e) => { if (e.target === toast && e.propertyName === 'height') remove(); });
      setTimeout(remove, 400);   // fallback when no transitionend comes (a hidden tab, a cancelled transition)
    }, 160);
  };
  // A progress toast whose close means Cancel opts out (review S8-3): a stray click hid the GIF's only Cancel while
  // the encode ran on.
  if (opts.dismissOnClick !== false) toast.addEventListener('click', dismiss);
  // A STICKY toast (1.25.2) waits for the user: an actionable hint that closed itself after 12 s was gone before the
  // owner could use it in the live check. No timer (setTimeout(fn, Infinity) would fire at once), and a visible close
  // button, so the way out is not only "click anywhere on it".
  const sticky = opts.sticky === true;
  if (!sticky) dismissTimer = setTimeout(dismiss, duration);
  // An ACTION toast (1.25.2, the B4 link-open hint): one button after the message, or several from `opts.actions`
  // (the join colour prompt's Colour joins / Keep grey). The toast still dismisses on any click; a button runs its
  // action as well. A `secondary` button is the quieter way out.
  const actions = (Array.isArray(opts.actions) ? opts.actions : [opts.action]).filter((a) => a && a.label);
  if (actions.length) toast.classList.add('df-toast--action');
  if (actions.length > 1) toast.classList.add('df-toast--multi-action');   // on a phone the buttons go under the message
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = action.secondary ? 'df-toast__action df-toast__action--secondary' : 'df-toast__action';
    btn.textContent = String(action.label);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (leaving) return;   // a second Enter on the still-focused button while the toast leaves
      dismiss();
      try { action.onClick?.(); } catch (err) { console.error('Diagramforce: toast action failed:', err); }
    });
    toast.appendChild(btn);
  }
  if (sticky) {
    toast.classList.add('df-toast--sticky');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'df-toast__close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      if (leaving) return;   // a second click, or a toast its caller already released (the GIF finished)
      dismiss();
      try { opts.onClose?.(); } catch (err) { console.error('Diagramforce: toast close failed:', err); }
    });
    toast.appendChild(close);
  }

  // Gap 27 (v1.12.0) — live message update for long-running operations.
  // Attaching as a property on the dismiss function (which is itself a
  // function/object) keeps the original `const release = showToast(…); release();`
  // pattern intact while opening a `release.update(…)` channel for callers
  // that need it. Disconnected toasts are a silent no-op so callers don't
  // need to defensively check whether the user dismissed mid-update.
  //
  // A4 (v1.12.0) — in-place textContent writes inside an aria-live region
  // are not reliably re-announced (VoiceOver in particular often misses
  // them). To make sure screen-reader users hear progress updates, we
  // clear the text, then re-write on the next frame so the live region
  // sees a "real" mutation. Visually imperceptible (~16 ms blank).
  dismiss.update = (newMessage) => {
    if (!toast.isConnected) return;
    messageEl.textContent = '';
    requestAnimationFrame(() => {
      if (!toast.isConnected) return;
      messageEl.textContent = toastMessageText(newMessage, kind);
    });
  };
  return dismiss;
}

/** An import's notes as one warning toast: `<head> with N notes:`, up to five notes one per line, then "+N more,
 *  listed in the browser console", and the full list in the console as `Diagramforce: <label> import notes`. The
 *  Flow and Mermaid imports both call it, so their formats cannot drift (they were two copies; S7-4 review). */
export function showImportNotes(head, notes, label) {
  console.info(`Diagramforce: ${label} import notes\n${notes.map((w) => `- ${w}`).join('\n')}`);
  return showToast(importNotesText(head, notes), 'warning',
    { duration: 9000 + 3000 * (Math.min(notes.length, IMPORT_NOTES_SHOWN) - 1), multiline: true });
}
const IMPORT_NOTES_SHOWN = 5;
/** The toast text of showImportNotes. */
export function importNotesText(head, notes) {
  const n = notes.length;
  const lines = notes.slice(0, IMPORT_NOTES_SHOWN).map((w) => `- ${w}`);
  if (n > IMPORT_NOTES_SHOWN) lines.push(`+${n - IMPORT_NOTES_SHOWN} more, listed in the browser console`);
  return `${head} with ${n} note${n === 1 ? '' : 's'}:\n${lines.join('\n')}`;
}

// ── Focus trap (a11y, v1.12.0) ────────────────────────────────────

/**
 * CSS selector matching elements that should be reachable via Tab. Kept in
 * one place so all modals trap focus over the same set. Excludes hidden /
 * disabled / negative-tabindex elements via attribute selectors.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  // Natively focusable too. The trap moves focus itself on every Tab, so anything missing here is unreachable by
  // keyboard inside a modal: the Group share pane's collapsed "Individual diagram links" summary was (review R9).
  'details > summary:first-of-type',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// The trap focuses its list itself (below), and focus() on an invisible element is a no-op, so one invisible entry
// stalls Tab for good (review M4: the New Diagram modal's Create cards stay laid out but visibility:hidden). Skip
// display:none and visibility:hidden (checkVisibility, with a computed-style fallback), zero-size boxes, and
// anything under [inert] or an aria-hidden ancestor inside the dialog. The focused element always stays listed.
function isTabbable(el, rootEl) {
  if (el === document.activeElement) return true;
  if (el.closest('[inert]')) return false;
  const hidden = el.closest('[aria-hidden="true"]');
  if (hidden && rootEl.contains(hidden)) return false;
  const visible = el.checkVisibility
    ? el.checkVisibility({ visibilityProperty: true })
    : el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible';
  if (!visible) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

function getTabbables(rootEl) {
  if (!rootEl) return [];
  return Array.from(rootEl.querySelectorAll(FOCUSABLE_SELECTOR)).filter(el => isTabbable(el, rootEl));
}

/**
 * Trap Tab / Shift+Tab focus inside `rootEl`. While the trap is active, every
 * Tab moves to the next focusable child in DOM order (Shift+Tab: previous),
 * wrapping at both ends, in every engine. Pressing Escape calls `opts.onEscape` if
 * supplied (typical: dismisses the modal).
 *
 * Returns a release function that unbinds the listener. Idempotent.
 *
 * Usage (every modal that needs a trap):
 *   const release = trapFocus(modalEl, { onEscape: closeModal });
 *   // …on close…
 *   release();
 */
// A stack of active focus traps. Only the TOPMOST trap handles Escape / Tab, so a nested modal (e.g. the
// column-delete confirm opened OVER the Edit-Table overlay) dismisses ITSELF on Escape without also closing the
// modal beneath it (which would revert the whole edit session). Without this, both capture-phase document
// listeners fire and the outer trap — registered first — closes first.
const _trapStack = [];
export function trapFocus(rootEl, opts = {}) {
  if (!rootEl) return () => {};
  const onEscape = opts.onEscape;
  const token = {};
  _trapStack.push(token);
  const onKeydown = (evt) => {
    if (_trapStack[_trapStack.length - 1] !== token) return;   // not the top modal → let the top one handle it
    if (evt.key === 'Escape' && onEscape) {
      evt.preventDefault();
      // The modal owns this Escape. Without stopPropagation (this listener is capture-phase, so it runs first) the same
      // key also reached keyboard.js - clearing the canvas selection, leaving Present - and review.js, leaving Change
      // Review, all behind a dialog the user was only closing (audit 2026-09-23).
      evt.stopPropagation();
      onEscape();
      return;
    }
    if (evt.key !== 'Tab') return;
    const tabbables = getTabbables(rootEl);
    if (tabbables.length === 0) {
      // No focusable children — keep focus on the modal root so Tab
      // doesn't drop the user back into the page behind it.
      evt.preventDefault();
      if (rootEl.tabIndex < 0) rootEl.tabIndex = -1;
      rootEl.focus({ preventScroll: true });
      return;
    }
    // The trap moves focus on EVERY Tab, not only at the ends. Left to the browser, a middle Tab followed the engine's
    // own order, and Safari's default skips buttons: from a button-only dialog (New Diagram, confirms) focus jumped to
    // the next text field behind the modal (review 2026-10-15). DOM order, wrapping at both ends.
    // A candidate that refuses focus anyway is stepped over, so Tab never stalls on it (review M4).
    evt.preventDefault();
    const n = tabbables.length;
    const step = evt.shiftKey ? -1 : 1;
    const i = tabbables.indexOf(document.activeElement);
    const from = i === -1 ? (evt.shiftKey ? n : -1) : i;
    for (let k = 1; k <= n; k++) {
      const next = tabbables[(((from + step * k) % n) + n) % n];
      next.focus();
      if (document.activeElement === next) return;
    }
  };
  // Capture phase so the trap runs before any inner handlers can swallow Tab.
  document.addEventListener('keydown', onKeydown, true);
  return () => {
    const i = _trapStack.indexOf(token);
    if (i >= 0) _trapStack.splice(i, 1);
    document.removeEventListener('keydown', onKeydown, true);
  };
}

// ── Generic modal scaffold ────────────────────────────────────────

// When the last buildModal() closed, so a modal opened in the same click (a chained dialog) can skip its scrim
// fade-in. 100 ms covers a synchronous chain and one awaited microtask hop, far below a human re-open.
const MODAL_SWAP_MS = 100;
let _lastModalClosedAt = -Infinity;

/**
 * Build, mount, and wire a standard `.df-modal` dialog. Centralises the
 * overlay backdrop + `.df-modal__dialog` + header (title + optional ✕) + body +
 * optional footer, installs the focus trap, restores focus on close, and wires
 * backdrop-click / ✕ / Escape → close. Returns the live nodes so the caller can
 * attach handlers to its own body/footer buttons. Replaces ~15-20 lines of
 * hand-rolled scaffolding per modal.
 *
 * @param {object} opts
 * @param {string}  opts.title            Header heading (set via textContent — safe).
 * @param {string} [opts.bodyHtml='']     Inner HTML of the body (caller-owned; caller escapes user content).
 * @param {string} [opts.footerHtml]      Inner HTML of the footer; omit/null for no footer.
 * @param {string} [opts.width]           Dialog width, e.g. '480px'.
 * @param {number|string} [opts.zIndex=3000] Stacking context.
 * @param {string} [opts.className='']    Extra class(es) on the `.df-modal` root (scoping/cleanup).
 * @param {string} [opts.dialogClass='']  Extra class(es) on `.df-modal__dialog`.
 * @param {string} [opts.bodyClass='']    Extra class(es) on `.df-modal__body` (e.g. 'df-modal__row-list').
 * @param {string} [opts.bodyStyle='']    Inline style on the body.
 * @param {string} [opts.footerClass='']  Extra class(es) on `.df-modal__footer` (e.g. 'df-field-modal__footer').
 * @param {boolean}[opts.showClose=true]  Render the top-right ✕ dismiss button.
 * @param {string} [opts.closeClass='']   Replaces the ✕ button's default `df-toolbar__button` styling with the caller's own (the `df-modal__close` wiring hook is always kept). Use for bespoke close buttons.
 * @param {string} [opts.closeHtml='']    Custom inner HTML for the ✕ button (defaults to the SLDS close SVG). Use e.g. a plain text '✕'.
 * @param {Function}[opts.onClose]        Called after the modal is removed (cleanup hook).
 * @param {Function}[opts.onEscape]       Escape handler; defaults to close().
 * @returns {{ overlay:HTMLElement, dialog:HTMLElement, header:HTMLElement, body:HTMLElement, footer:HTMLElement|null, close:Function }}
 */
export function buildModal(opts = {}) {
  const {
    title = '', bodyHtml = '', footerHtml = null, width, zIndex = 3000,
    className = '', dialogClass = '', bodyClass = '', bodyStyle = '', footerClass = '',
    showClose = true, closeClass = '', closeHtml = '', onClose, onEscape, origin = null, anchor = null,
    backdropClose = true,   // false = a click on the scrim does NOT close (a notice the user must act on)
  } = opts;

  const prevFocus = document.activeElement;
  const titleId = `df-modal-title-${Math.random().toString(36).slice(2, 8)}`;

  const overlay = document.createElement('div');
  overlay.className = `df-modal${className ? ' ' + className : ''}${anchor ? ' df-modal--anchored' : ''}`;
  // A modal that replaces one closed a moment ago keeps its scrim solid (no CSS fade-in), so the dim does not
  // blink off and on between two dialogs (css/modals.css, motion).
  if (performance.now() - _lastModalClosedAt < MODAL_SWAP_MS) overlay.classList.add('df-modal--swap');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', titleId);
  overlay.style.zIndex = String(zIndex);

  // `df-modal__close` is always present (buildModal wires the click); `closeClass`
  // swaps the default toolbar-button styling, `closeHtml` swaps the ✕ glyph.
  const closeBtnClass = closeClass ? `df-modal__close ${closeClass}` : 'df-toolbar__button df-modal__close';
  const closeInner = closeHtml || '<svg class="df-toolbar__icon" aria-hidden="true"><use href="#close"></use></svg>';
  const closeBtn = showClose ? `<button class="${closeBtnClass}" aria-label="Close">${closeInner}</button>` : '';
  overlay.innerHTML = `
    <div class="df-modal__overlay"></div>
    <div class="df-modal__dialog${dialogClass ? ' ' + dialogClass : ''}"${width ? ` style="width:${width}"` : ''}>
      <div class="df-modal__header">
        <h2 id="${titleId}" class="df-modal__title"></h2>
        ${closeBtn}
      </div>
      <div class="df-modal__body${bodyClass ? ' ' + bodyClass : ''}"${bodyStyle ? ` style="${bodyStyle}"` : ''}>${bodyHtml}</div>
      ${footerHtml != null ? `<div class="df-modal__footer${footerClass ? ' ' + footerClass : ''}">${footerHtml}</div>` : ''}
    </div>`;
  overlay.querySelector('.df-modal__title').textContent = title; // textContent — no title injection
  // Anchored managers hide the header (the merged trigger button is the title), so the visually-hidden h2 can't
  // name the dialog — give the overlay a direct aria-label instead so screen readers still announce it.
  if (anchor && title) { overlay.setAttribute('aria-label', title); overlay.removeAttribute('aria-labelledby'); }

  document.body.appendChild(overlay);

  let replacingAnchored = false;   // set when this anchored manager replaced an already-open one (swap, no scrim blink)

  // Anchored placement (opt-in via `anchor`, an element — e.g. the navbar button that opened this): the dialog's
  // top-left sits just under the button's bottom-left (like the Display dropdown), instead of viewport-centred.
  // This keeps the three storage managers uniform + their tab strip from jumping vertically as panes change
  // height (the content grows DOWNWARD from a fixed top). Skipped on mobile (≤768px) — the CSS override there
  // restores a centred/stretched dialog. Re-runs on resize; the listener is torn down in close().
  if (anchor && typeof anchor.getBoundingClientRect === 'function') {
    // The bright top bar lets you click straight to another manager — close any other open anchored one first
    // (so two panels never stack and the previous trigger un-merges). If one WAS open, we're swapping panels
    // under the same scrim, so the entry animation below skips the scrim fade (else it dips off→on = a blink).
    document.querySelectorAll('.df-modal--anchored').forEach((m) => {
      if (m !== overlay && typeof m.__dfClose === 'function') { m.__dfClose(); replacingAnchored = true; }
    });
    const dlg = overlay.querySelector('.df-modal__dialog');
    const MERGE = 'df-toolbar__button--panel-open';
    const reposition = () => {
      if (window.matchMedia('(max-width: 768px)').matches) {
        dlg.style.left = ''; dlg.style.top = ''; anchor.classList?.remove(MERGE);
        dlg.classList.remove('df-modal__dialog--merged'); return;
      }
      const a = anchor.getBoundingClientRect();
      const w = dlg.offsetWidth || dlg.getBoundingClientRect().width;
      const margin = 8;
      let left = Math.min(a.left, window.innerWidth - w - margin);   // clamp so a wide dialog never overflows right
      left = Math.max(margin, left);
      // Snap to the DEVICE-pixel grid (not integer CSS px). At devicePixelRatio 2, an integer CSS-px value always
      // lands on an EVEN device pixel — so a button whose left edge sits on an ODD device pixel (e.g. Load/Share,
      // but not Save) would have the panel's left border 1 device-px off the button's, jogging the merged shape's
      // side border at the seam. Rounding `left` to the device grid makes the panel's left border COINCIDE with the
      // button's. `top` is FLOORED to the device grid so the panel always sits at or just inside the button's
      // bottom (overlap < 1 device-px, never a gap — a rounded-up top would leak a 1-device-px toolbar hairline).
      const dpr = window.devicePixelRatio || 1;
      const snap = (v) => Math.round(v * dpr) / dpr;        // nearest device px — borders coincide
      const snapFloor = (v) => Math.floor(v * dpr) / dpr;   // largest device px <= v — overlap, never gap
      dlg.style.left = `${snap(left)}px`;
      // Cover the button's bottom (overlap, never a gap) so the panel MERGES with the active button (which drops
      // its bottom border + takes the panel surface, like the active tab joining the canvas). The dialog squares
      // its top corners + redraws its top border only PAST the button (--df-merge-w = button width), so the border
      // flows around to the button's edge. Skip the merge when the dialog clamped away from the button's left.
      dlg.style.top = `${snapFloor(a.bottom)}px`;
      const merged = Math.abs(left - a.left) < 1;
      anchor.classList?.toggle(MERGE, merged);
      dlg.classList.toggle('df-modal__dialog--merged', merged);
      dlg.style.setProperty('--df-merge-w', `${snap(a.width)}px`);
    };
    reposition();
    requestAnimationFrame(reposition);     // re-measure once the button's final width settled (so --df-merge-w,
                                           // the top-border notch, lands exactly at the button's right edge)
    window.addEventListener('resize', reposition);
    overlay.__dfReposition = reposition;   // stashed so close() can remove the listener
    overlay.__dfAnchor = anchor;           // so close() un-merges the trigger button
  }

  // Origin-aware entry (opt-in via `origin`, an element — e.g. the navbar button that opened this): the dialog
  // scales up FROM the trigger's position instead of just appearing. transform-origin is the trigger's centre
  // expressed relative to the (already-centred) dialog box. Honours prefers-reduced-motion (then it just snaps).
  if (origin && typeof origin.getBoundingClientRect === 'function'
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const dlg = overlay.querySelector('.df-modal__dialog');
    const ov = overlay.querySelector('.df-modal__overlay');
    try {
      const o = origin.getBoundingClientRect();
      // Opt out of the CSS entry pop (css/modals.css) BEFORE measuring the dialog: mid-pop its rect is scaled.
      overlay.classList.add('df-modal--origin');
      const d = dlg.getBoundingClientRect();
      if ((o.width || o.height) && (d.width || d.height)) {
        dlg.style.transformOrigin = `${(o.left + o.width / 2) - d.left}px ${(o.top + o.height / 2) - d.top}px`;
        dlg.style.transform = 'scale(0.9)';
        dlg.style.opacity = '0';
        // Swapping managers under an already-present scrim: leave the scrim solid (don't fade it 0→1) so it
        // doesn't blink off/on. The dialog still scales in for a panel-swap cue. The swap rule above counts too: the
        // chained opens (Paste's bundle reopening Load, Load's "back up" link) close the old panel first, so
        // replacingAnchored alone missed them and the scrim blinked (review S8-7).
        const keepScrim = replacingAnchored || overlay.classList.contains('df-modal--swap');
        if (ov && !keepScrim) ov.style.opacity = '0';
        void dlg.offsetWidth;   // commit the initial state before transitioning
        // Motion-system tokens (css/variables.css), resolved by the browser from the inline value.
        dlg.style.transition = 'transform var(--df-motion-base) var(--df-ease-out), opacity var(--df-motion-base) var(--df-ease-out)';
        if (ov && !keepScrim) { ov.style.transition = 'opacity var(--df-motion-fast) var(--df-ease-out)'; ov.style.opacity = ''; }
        dlg.style.transform = 'scale(1)';
        dlg.style.opacity = '';
        const cleanup = () => {   // clear inline styles so resize / Safari repaint aren't affected later
          dlg.style.transition = ''; dlg.style.transform = ''; dlg.style.transformOrigin = '';
          if (ov) ov.style.transition = '';
          dlg.removeEventListener('transitionend', cleanup);
        };
        dlg.addEventListener('transitionend', cleanup);
      } else overlay.classList.remove('df-modal--origin');   // nothing to grow from (a hidden button): CSS pop instead
    } catch { /* entry animation is best-effort */ }
  }

  let releaseTrap = () => {};
  let closed = false;
  const close = () => {
    // Once only. A caller holding a stale close (the Paste pane after a bundle import reopened Load with its summary)
    // would otherwise un-merge the trigger button the NEW panel owns and move focus a second time (review D11).
    if (closed) return;
    closed = true;
    _lastModalClosedAt = performance.now();
    releaseTrap();
    if (overlay.__dfReposition) window.removeEventListener('resize', overlay.__dfReposition);
    overlay.__dfAnchor?.classList?.remove('df-toolbar__button--panel-open');   // un-merge the trigger button
    overlay.remove();
    if (prevFocus && typeof prevFocus.focus === 'function') {
      try { prevFocus.focus(); } catch { /* element may be gone */ }
    }
    onClose?.();
  };
  overlay.__dfClose = close;   // so a newly-opened anchored manager can close this one (single-panel rule)
  releaseTrap = trapFocus(overlay, { onEscape: onEscape || close });
  if (backdropClose) overlay.querySelector('.df-modal__overlay').addEventListener('click', close);
  overlay.querySelector('.df-modal__close')?.addEventListener('click', close);

  return {
    overlay,
    dialog: overlay.querySelector('.df-modal__dialog'),
    header: overlay.querySelector('.df-modal__header'),
    body: overlay.querySelector('.df-modal__body'),
    footer: overlay.querySelector('.df-modal__footer'),
    close,
  };
}

// ── Confirm modal ─────────────────────────────────────────────────

/**
 * Custom-styled confirmation modal that replaces `window.confirm()`.
 *
 * @param {object} opts
 * @param {string} opts.title           Heading text.
 * @param {string} [opts.message]       Body text (plain).
 * @param {string} [opts.okLabel='OK']  Primary button label.
 * @param {string} [opts.cancelLabel='Cancel']  Secondary button label.
 * @param {'primary'|'danger'} [opts.tone='primary']  Visual tone of the OK button.
 *
 * @returns {Promise<boolean>}  Resolves true if the user confirmed, false if cancelled / escaped / overlay-clicked.
 *
 * S2 (v1.12.0) — the previous `opts.html` raw-HTML escape hatch was
 * removed. It had no call sites in the codebase and provided an XSS
 * surface that future contributors could accidentally feed unescaped
 * user content into. Callers needing rich content can compose plain
 * text with newlines, or build their own modal via the same `.df-modal`
 * primitives if a one-off needs HTML formatting.
 */
export function confirmModal(opts) {
  const {
    title,
    message = '',
    okLabel = 'OK',
    cancelLabel = 'Cancel',
    tone = 'primary',
    cancelTone = null,   // 'amber' → the secondary button is an amber-wire action (a real alternative, not a plain dismiss)
  } = opts || {};

  return new Promise((resolve) => {
    let result = false; // resolve value; flips true only on OK / Enter
    // buildModal owns the scaffold + focus-trap + focus-restore; this dialog has
    // no ✕ (showClose:false) and resolves via the result/onClose pattern.
    const { body, footer, close } = buildModal({
      title: title || '',
      className: 'df-confirm-modal',
      zIndex: 10002,
      showClose: false,
      dialogClass: 'df-confirm-modal__dialog',
      bodyClass: 'df-confirm-modal__body',
      footerClass: 'df-confirm-modal__footer',
      footerHtml: `
        <button class="df-modal__btn df-confirm-modal__cancel"></button>
        <button class="df-modal__btn df-modal__btn--${tone === 'danger' ? 'danger' : 'primary'} df-confirm-modal__ok"></button>`,
      // Escape / backdrop / cancel resolve false; cleanup the Enter handler here.
      onClose: () => { document.removeEventListener('keydown', onEnter, true); resolve(result); },
    });
    // textContent everywhere — no raw-HTML path is available (see S2 note above).
    body.textContent = message;
    const okBtn = footer.querySelector('.df-confirm-modal__ok');
    const cancelBtn = footer.querySelector('.df-confirm-modal__cancel');
    okBtn.textContent = okLabel;
    cancelBtn.textContent = cancelLabel;
    if (cancelTone === 'amber') cancelBtn.classList.add('df-modal__btn--amber-outline');   // a real alternative action, not a plain dismiss

    okBtn.addEventListener('click', () => { result = true; close(); });
    cancelBtn.addEventListener('click', () => close());

    // Separate handler for Enter — the focus trap handles Tab + Escape, but
    // Enter as "confirm" is a convention this modal owns.
    function onEnter(evt) {
      if (evt.key !== 'Enter' || evt.isComposing) return;
      const tag = (evt.target && evt.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      // A FOCUSED BUTTON answers Enter itself (native activation), so Enter on Cancel cancels. This handler used to
      // confirm whatever had focus - and preventDefault() swallowed the focused button's own click - so on a danger
      // prompt, where Cancel is focused as the safety default, Enter ran the destructive action (audit 2026-09-23,
      // P0-6: "Close anyway" on full storage, Delete, Move to trash, Revoke access, Delete column).
      if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT') return;
      // With focus on neither button, Enter confirms only a NON-destructive prompt.
      if (tone === 'danger') return;
      evt.preventDefault();
      result = true;
      close();
    }
    document.addEventListener('keydown', onEnter, true);

    // Focus the cancel button by default — safety bias for destructive prompts.
    // Non-destructive (tone:'primary') focuses OK so Enter confirms naturally.
    const defaultBtn = tone === 'danger' ? cancelBtn : okBtn;
    setTimeout(() => defaultBtn?.focus(), 0);
  });
}

/**
 * Convenience for showing an error toast when a user-facing operation
 * failed. Encapsulates the common `showToast(msg, 'error', …)` pattern; it
 * keeps the default duration (TOAST_DEFAULT_DURATION) unless `opts.duration`
 * says otherwise, and a click dismisses it like any toast.
 */
export function showError(message, opts = {}) {
  return showToast(message, 'error', opts);
}

// ── Prompt modal (single text input) ──────────────────────────────

/**
 * Single-line text-input modal — the input-bearing sibling of confirmModal.
 * Used where the app needs one short string from the user (e.g. naming a
 * custom pattern) without falling back to the native, unstyled `prompt()`.
 * Reuses the `.df-modal` / `.df-confirm-modal` structure + focus trap so it
 * looks and behaves like every other dialog.
 *
 * @param {object} opts
 * @param {string} opts.title                Heading text.
 * @param {string|Node} [opts.message]       Body above the input. A string is
 *                  set via textContent (XSS-safe); a DOM Node is appended as-is
 *                  (caller is responsible for building it safely).
 * @param {string} [opts.label]              Field label (plain).
 * @param {string} [opts.defaultValue='']    Pre-filled value (selected on open).
 * @param {string} [opts.placeholder='']
 * @param {string} [opts.okLabel='Save']
 * @param {string} [opts.cancelLabel='Cancel']
 * @param {number} [opts.maxLength=80]
 * @param {boolean} [opts.allowEmpty=false]  When false (default), an empty
 *                  submit resolves to null (treated as cancel). When true, an
 *                  empty submit resolves to '' so the caller can apply its own
 *                  fallback — only real cancel/escape/overlay return null.
 * @param {boolean} [opts.requireValue=false]  When true, the primary button is
 *                  disabled (and Enter is gated) until the field is non-empty.
 *
 * @returns {Promise<string|null>}  Trimmed value on confirm; null on cancel /
 *                                  escape / overlay-click (and on empty submit
 *                                  unless `allowEmpty` is set, where it's '').
 */
export function promptModal(opts) {
  const {
    title,
    message = '',
    label = '',
    defaultValue = '',
    placeholder = '',
    okLabel = 'Save',
    cancelLabel = 'Cancel',
    maxLength = 80,
    allowEmpty = false,
    requireValue = false,
  } = opts || {};

  return new Promise((resolve) => {
    const inputId = `df-prompt-input-${Math.random().toString(36).slice(2, 8)}`;
    let result = null; // resolve value; set by submit(). null = cancel/escape.
    const { body, footer, close } = buildModal({
      title: title || '',
      className: 'df-confirm-modal df-prompt-modal',
      zIndex: 10002,
      showClose: false,
      dialogClass: 'df-confirm-modal__dialog',
      bodyClass: 'df-confirm-modal__body',
      footerClass: 'df-confirm-modal__footer',
      bodyHtml: `
        <p class="df-prompt-modal__message"></p>
        <label class="df-prompt-modal__label" for="${inputId}"></label>
        <input id="${inputId}" type="text" class="df-prompt-modal__input" spellcheck="false" autocomplete="off">`,
      footerHtml: `
        <button class="df-modal__btn df-confirm-modal__cancel"></button>
        <button class="df-modal__btn df-modal__btn--primary df-confirm-modal__ok"></button>`,
      onClose: () => resolve(result), // backdrop / Escape / cancel resolve null
    });
    const msgEl = body.querySelector('.df-prompt-modal__message');
    if (message instanceof Node) msgEl.appendChild(message);
    else if (message) msgEl.textContent = message;
    else msgEl.remove();
    const labelEl = body.querySelector('.df-prompt-modal__label');
    if (label) labelEl.textContent = label; else labelEl.remove();
    const okBtn = footer.querySelector('.df-confirm-modal__ok');
    const cancelBtn = footer.querySelector('.df-confirm-modal__cancel');
    okBtn.textContent = okLabel;
    cancelBtn.textContent = cancelLabel;

    const input = body.querySelector('.df-prompt-modal__input');
    input.value = defaultValue;
    input.maxLength = maxLength;
    if (placeholder) input.placeholder = placeholder;

    // Empty input resolves to null (treated as cancel) unless `allowEmpty` is
    // set, in which case it resolves to '' so the caller can apply a fallback.
    // When `requireValue` is set, an empty submit is blocked outright.
    const submit = () => {
      const v = input.value.trim();
      if (v === '' && requireValue) return;
      result = (v === '' ? (allowEmpty ? '' : null) : v);
      close();
    };

    okBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', () => close());
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' && !evt.isComposing) { evt.preventDefault(); submit(); }   // not mid-IME-composition
    });

    // requireValue — keep the primary button disabled until the field is
    // non-empty (Enter is gated in submit() too).
    if (requireValue) {
      input.required = true;  // drives the CSS red-empty / blue-filled border
      const refreshOk = () => { okBtn.disabled = input.value.trim() === ''; };
      input.addEventListener('input', refreshOk);
      refreshOk();
    }

    // Focus + select the default so the user can type over it immediately.
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

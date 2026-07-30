// Toolbar runtime context + shared helpers (CLEANUP S4) — tctx.modules is the module map wired ONCE by
// toolbar.init(); the manager-modal slices read tctx.modules.X INSIDE function bodies (never at module top, which
// runs before init). btn/setupDropdown/renderDriveSignIn moved here FIRST because init + several slices share them
// — keeping them on the facade would force a slice→facade import cycle.
import { escHtml } from '../util.js?v=1.21.7';
import { showError } from '../feedback.js?v=1.21.7';

export const tctx = { modules: null };

export function btn(id) {
  return document.getElementById(id);
}

export function setupDropdown(triggerId) {
  const trigger = btn(triggerId);
  const dropdown = trigger.closest('.df-toolbar__dropdown');
  const menu = dropdown.querySelector('.df-toolbar__menu');

  // Helper: list of focusable menu items, filtered live so disabled /
  // hidden entries are skipped during arrow navigation. Re-queried on
  // each call because some renderers rebuild the menu DOM at runtime
  // (e.g. Save when GIF encoding flips the export-disabled state).
  const focusables = () => Array.from(menu.querySelectorAll('.df-toolbar__menu-item'))
    .filter(el => !el.disabled && el.offsetParent !== null);

  const openMenu = () => {
    document.querySelectorAll('.df-toolbar__dropdown--open').forEach(dd => {
      if (dd !== dropdown) dd.classList.remove('df-toolbar__dropdown--open');
    });
    // Single top-bar panel: opening a toolbar dropdown closes any open anchored manager (Save / Load / Share).
    const openM = document.querySelector('.df-modal--anchored');
    if (openM && typeof openM.__dfClose === 'function') openM.__dfClose();
    // Button-merge (Display, scoped in CSS): the menu's top border resumes just past the trigger button.
    const setMergeW = () => menu.style.setProperty('--df-merge-w', `${Math.round(trigger.getBoundingClientRect().width)}px`);
    setMergeW();
    requestAnimationFrame(setMergeW);   // re-measure once the merged button's final width settles (lands the notch exactly)
    dropdown.classList.add('df-toolbar__dropdown--open');
  };
  const closeMenu = (restoreFocus = true) => {
    dropdown.classList.remove('df-toolbar__dropdown--open');
    if (restoreFocus) trigger.focus();
  };

  trigger.addEventListener('click', (evt) => {
    evt.stopPropagation();
    const isOpen = dropdown.classList.contains('df-toolbar__dropdown--open');
    if (isOpen) closeMenu(false);
    else openMenu();
  });

  // Gap 24 (v1.12.0) — keyboard activation on the trigger. ArrowDown /
  // Enter / Space open the menu and focus the first item; ArrowUp opens
  // and focuses the last (the "Reverse-tab into menu" convention used
  // by macOS menu bars and the ARIA Authoring Practices menu pattern).
  trigger.addEventListener('keydown', (evt) => {
    if (evt.key === 'ArrowDown' || evt.key === 'Enter' || evt.key === ' ') {
      evt.preventDefault();
      openMenu();
      focusables()[0]?.focus();
    } else if (evt.key === 'ArrowUp') {
      evt.preventDefault();
      openMenu();
      const items = focusables();
      items[items.length - 1]?.focus();
    }
  });

  // Gap 24 (v1.12.0) — keyboard nav inside the open menu. Arrow keys
  // cycle; Home/End jump; Escape closes and returns focus to the
  // trigger; Tab closes without restoring focus (so Tab continues into
  // the next toolbar item naturally).
  menu.addEventListener('keydown', (evt) => {
    const items = focusables();
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement);
    if (evt.key === 'ArrowDown') {
      evt.preventDefault();
      items[(idx + 1) % items.length].focus();
    } else if (evt.key === 'ArrowUp') {
      evt.preventDefault();
      items[(idx - 1 + items.length) % items.length].focus();
    } else if (evt.key === 'Home') {
      evt.preventDefault();
      items[0].focus();
    } else if (evt.key === 'End') {
      evt.preventDefault();
      items[items.length - 1].focus();
    } else if (evt.key === 'Escape') {
      evt.preventDefault();
      closeMenu(true);
    } else if (evt.key === 'Tab') {
      // Let Tab move out naturally; just close the menu so the next
      // toolbar button (not a hidden menu item) receives focus.
      closeMenu(false);
    }
  });

  // Close dropdown when a menu item is clicked
  dropdown.querySelectorAll('.df-toolbar__menu-item').forEach(item => {
    item.addEventListener('click', () => {
      dropdown.classList.remove('df-toolbar__dropdown--open');
    });
  });
}

export function renderDriveSignIn(container, message, onSignedIn) {
  if (!container) return;
  container.innerHTML = `<div style="padding:26px 18px;color:var(--text-secondary)">`
    + `<p style="margin:0 0 14px">${escHtml(message)}</p>`
    + `<div style="text-align:center"><button type="button" class="df-modal__btn df-modal__btn--accent df-drive-signin__btn">Sign in to Google Drive</button></div></div>`;
  const btn = container.querySelector('.df-drive-signin__btn');
  btn?.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Signing in…';
    try { await tctx.modules.persistence.signIn?.(); }
    catch (e) { if (!/cancel/i.test(e?.message || '')) showError(e?.message || 'Google sign-in failed.'); }
    if (tctx.modules.persistence.isSignedIn?.()) { onSignedIn?.(); return; }
    btn.disabled = false; btn.textContent = 'Sign in to Google Drive';
  });
}

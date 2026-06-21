// Keyboard shortcut manager
// Binds key combos to app module actions

let modules = {};

// ── Platform-aware key-combo formatting (Gap #6, v1.12.0) ────────────
// Detect macOS once at module load. `navigator.platform` is technically
// deprecated but still the most reliable cross-browser signal and works in
// every browser the app targets. Modern UA-Client-Hints (`userAgentData`)
// is preferred when available — Chrome / Edge / Vivaldi report it; Safari
// and Firefox still fall back to `navigator.platform`.
const IS_MAC = (() => {
  const uaPlatform = navigator.userAgentData?.platform;
  if (uaPlatform) return /mac/i.test(uaPlatform);
  return /Mac/.test(navigator.platform || navigator.userAgent || '');
})();

// Token → symbol mapping. macOS uses the Apple key glyphs (⌘ ⌥ ⌃ ⇧);
// every other platform uses the plain English words separated by `+`.
const MAC_TOKENS = { Ctrl: '⌘', Cmd: '⌘', Meta: '⌘', Alt: '⌥', Option: '⌥', Shift: '⇧' };
const PC_TOKENS  = { Ctrl: 'Ctrl', Cmd: 'Ctrl', Meta: 'Ctrl', Alt: 'Alt', Option: 'Alt', Shift: 'Shift' };

/**
 * Format a key combo for tooltips / hint text. Accepts tokens separated by
 * `+`, e.g. `kbd('Ctrl+S')` → `'⌘S'` on macOS, `'Ctrl+S'` on Windows/Linux.
 *
 * Note: `Ctrl` is treated as the canonical "primary modifier" token — on
 * macOS it maps to ⌘ (Command), not ⌃ (Control), because the app's actual
 * shortcut handlers accept either Ctrl or Cmd as `mod`. This matches user
 * mental model — a Mac user reads "Ctrl+S" in source and thinks "⌘S".
 *
 * Final glyphs on macOS are joined without a `+` separator (Apple HIG
 * convention: "⌘S", "⌘⇧Z"). Other platforms use plain "Ctrl+S".
 */
function kbd(combo) {
  if (typeof combo !== 'string' || !combo) return '';
  const parts = combo.split('+').map(p => p.trim()).filter(Boolean);
  if (IS_MAC) {
    return parts.map(p => MAC_TOKENS[p] ?? p).join('');
  }
  return parts.map(p => PC_TOKENS[p] ?? p).join('+');
}

/**
 * Rewrite every static `(Ctrl+…)` substring inside the toolbar tooltips at
 * boot, so the HTML can stay platform-neutral while users see the right
 * glyphs. Idempotent — running it twice is harmless because the kbd()
 * output never contains a literal "Ctrl+" on macOS.
 */
function applyPlatformShortcutsToTooltips() {
  // Match `(Ctrl+X)`, `(Ctrl+Shift+Z)`, etc. inside a title=. Outer parens
  // are preserved; only the combo inside gets rewritten when it contains
  // at least one named modifier (Ctrl/Shift/Alt/Cmd/Meta). Bare-token
  // tooltips like "(+)" or "(-)" aren't matched and pass through untouched.
  const COMBO_RE = /\((?:Ctrl|Shift|Alt|Cmd|Meta)(?:\+[^)]+)?\)/g;
  document.querySelectorAll('[title]').forEach(el => {
    const original = el.getAttribute('title');
    if (!original) return;
    const rewritten = original.replace(COMBO_RE, (match) => {
      const combo = match.slice(1, -1); // strip the outer parens
      return `(${kbd(combo)})`;
    });
    if (rewritten !== original) el.setAttribute('title', rewritten);
  });
}

export function init(_modules) {
  modules = _modules;
  document.addEventListener('keydown', handleKeydown);
  applyPlatformShortcutsToTooltips();
}

function handleKeydown(evt) {
  const { ctrlKey, metaKey, shiftKey } = evt;
  const rawKey = evt.key;
  const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;
  const mod = ctrlKey || metaKey;

  // Skip when typing in a form field
  const tag = evt.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || evt.target.isContentEditable) return;

  // While the guided walkthrough is open it owns the keyboard (Tab/Escape via trapFocus,
  // arrows via its own handler) — don't fire canvas shortcuts behind the overlay.
  if (modules.walkthrough?.isActive?.()) return;

  // Ctrl/Cmd+Z — Undo
  if (mod && !shiftKey && key === 'z') {
    evt.preventDefault();
    modules.history.undo();
    return;
  }

  // Ctrl/Cmd+Shift+Z or Ctrl+Y — Redo
  if (mod && shiftKey && key === 'z') {
    evt.preventDefault();
    modules.history.redo();
    return;
  }
  if (mod && !shiftKey && key === 'y') {
    evt.preventDefault();
    modules.history.redo();
    return;
  }

  // Ctrl+A — Select all, or select label text if single element selected
  if (mod && key === 'a') {
    if (modules.selection.getCount() === 1) {
      // Single element selected — focus and select label text in properties panel
      const labelInput = document.querySelector('.df-properties__body .df-properties__input');
      if (labelInput) {
        evt.preventDefault();
        labelInput.focus();
        labelInput.select();
        return;
      }
    }
    evt.preventDefault();
    modules.selection.selectAll();
    return;
  }

  // Ctrl+C — Copy
  if (mod && key === 'c') {
    evt.preventDefault();
    modules.clipboard.copy();
    return;
  }

  // Ctrl+V — Paste
  if (mod && key === 'v') {
    evt.preventDefault();
    modules.clipboard.paste();
    return;
  }

  // Ctrl+D — Duplicate
  if (mod && key === 'd') {
    evt.preventDefault();
    modules.clipboard.duplicate();
    return;
  }

  // Delete / Backspace — Delete selected
  if (key === 'Delete' || key === 'Backspace') {
    evt.preventDefault();
    modules.selection.deleteSelected();
    return;
  }

  // Ctrl+S — open Save & Export (delegate to the navbar Save button so the shortcut and the button
  // land in the exact same manager, instead of the old prompt-based namedSave).
  if (mod && key === 's') {
    evt.preventDefault();
    document.getElementById('btn-save')?.click();
    return;
  }

  // Ctrl+O — open Load & Import (delegate to the navbar Load button so the shortcut opens the tabbed
  // manager, instead of a bare OS file picker).
  if (mod && key === 'o') {
    evt.preventDefault();
    document.getElementById('btn-load')?.click();
    return;
  }

  // Ctrl+N — New diagram
  if (mod && key === 'n') {
    evt.preventDefault();
    modules.persistence.newDiagram();
    return;
  }

  // Ctrl+0 — Fit to content
  if (mod && key === '0') {
    evt.preventDefault();
    modules.canvas.fitContent();
    return;
  }

  // + / = — Zoom in
  if (!mod && (key === '+' || key === '=')) {
    evt.preventDefault();
    modules.canvas.zoomIn();
    return;
  }

  // - — Zoom out
  if (!mod && key === '-') {
    evt.preventDefault();
    modules.canvas.zoomOut();
    return;
  }

  // Arrow keys — nudge selected elements
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
    const elements = modules.selection.getSelectedElements().filter(e => e.isElement());
    if (elements.length === 0) return;
    evt.preventDefault();
    const step = shiftKey ? 16 : 4;
    const dx = key === 'ArrowRight' ? step : key === 'ArrowLeft' ? -step : 0;
    const dy = key === 'ArrowDown' ? step : key === 'ArrowUp' ? -step : 0;
    elements.forEach(el => {
      const pos = el.position();
      el.position(pos.x + dx, pos.y + dy);
    });
    return;
  }

  // Ctrl+W — Close current tab
  if (mod && key === 'w') {
    evt.preventDefault();
    modules.tabs?.closeTab(modules.tabs.getActiveTabId());
    return;
  }

  // Escape — Clear selection
  if (key === 'Escape') {
    modules.selection.clearSelection();
    return;
  }

  // Printable character with element selected → auto-focus label input
  if (!mod && key.length === 1 && modules.selection.getCount() === 1) {
    const panel = document.querySelector('.df-properties__body');
    const labelInput = panel?.querySelector('.df-properties__input');
    if (labelInput) {
      labelInput.focus();
      // Don't prevent default — let the character be typed into the input
      return;
    }
  }
}

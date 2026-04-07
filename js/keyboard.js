// Keyboard shortcut manager
// Binds key combos to app module actions

let modules = {};

export function init(_modules) {
  modules = _modules;
  document.addEventListener('keydown', handleKeydown);
}

function handleKeydown(evt) {
  const { ctrlKey, metaKey, shiftKey } = evt;
  const rawKey = evt.key;
  const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;
  const mod = ctrlKey || metaKey;

  // Skip when typing in a form field
  const tag = evt.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || evt.target.isContentEditable) return;

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
      const labelInput = document.querySelector('.sf-properties__body .sf-properties__input');
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

  // Ctrl+S — Named save
  if (mod && key === 's') {
    evt.preventDefault();
    modules.persistence.namedSave();
    return;
  }

  // Ctrl+O — Import JSON
  if (mod && key === 'o') {
    evt.preventDefault();
    modules.persistence.importJSON();
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
    const panel = document.querySelector('.sf-properties__body');
    const labelInput = panel?.querySelector('.sf-properties__input');
    if (labelInput) {
      labelInput.focus();
      // Don't prevent default — let the character be typed into the input
      return;
    }
  }
}

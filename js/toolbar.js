// Toolbar — wires all button clicks to module actions
// Also keeps undo/redo button states in sync

let modules = {};

export function init(_modules) {
  modules = _modules;

  // Save dropdown
  setupDropdown('btn-save');
  btn('btn-save-browser').addEventListener('click', () => showSaveModal());
  btn('btn-save-json').addEventListener('click', () => modules.persistence.exportJSON());
  btn('btn-save-png').addEventListener('click', () => modules.persistence.exportPNG(false));
  btn('btn-save-png-t').addEventListener('click', () => modules.persistence.exportPNG(true));
  document.getElementById('btn-share-url').addEventListener('click', () => modules.persistence.shareAsURL());

  // Wire save modal callback so persistence.namedSave() can also open it
  modules.persistence.setShowSaveModal(() => showSaveModal());

  // Load dropdown
  setupDropdown('btn-load');
  btn('btn-load-browser').addEventListener('click', () => showLoadModal());
  btn('btn-load-json').addEventListener('click', () => modules.persistence.importJSON());

  // Display dropdown (hidden for Gantt, some options data-model only)
  setupDropdown('btn-display');
  const btnApi = document.getElementById('btn-display-api');
  const btnLen = document.getElementById('btn-display-lengths');
  btnApi.addEventListener('click', () => {
    const current = isDisplayFlagOn('showLabels');
    applyDisplayFlagToAll('showLabels', !current);
    updateDisplayToggleLabels();
  });
  btnLen.addEventListener('click', () => {
    const current = isDisplayFlagOn('showFieldLengths');
    applyDisplayFlagToAll('showFieldLengths', !current);
    updateDisplayToggleLabels();
  });

  // Gantt display toggles
  btn('btn-gantt-assignee').addEventListener('click', () => {
    const current = isDisplayFlagOn('showAssignee');
    applyDisplayFlagToAll('showAssignee', !current);
    updateGanttToggleLabels();
  });
  btn('btn-gantt-progress').addEventListener('click', () => {
    const current = isDisplayFlagOn('showProgress');
    applyDisplayFlagToAll('showProgress', !current);
    updateGanttToggleLabels();
  });

  // Auto Layout
  btn('btn-auto-layout-h').addEventListener('click', () => {
    modules.canvas.autoLayout('horizontal');
    document.getElementById('display-dropdown')?.classList.remove('sf-toolbar__dropdown--open');
  });
  btn('btn-auto-layout-v').addEventListener('click', () => {
    modules.canvas.autoLayout('vertical');
    document.getElementById('display-dropdown')?.classList.remove('sf-toolbar__dropdown--open');
  });

  // Update Display menu when tab changes
  if (modules.tabs) {
    modules.tabs.onChange(() => updateDisplayMenuVisibility());
    updateDisplayMenuVisibility();
  }

  // Undo / Redo
  btn('btn-undo').addEventListener('click', () => modules.history.undo());
  btn('btn-redo').addEventListener('click', () => modules.history.redo());

  modules.history.onChange(() => {
    btn('btn-undo').disabled = !modules.history.canUndo();
    btn('btn-redo').disabled = !modules.history.canRedo();
  });

  // Zoom
  btn('btn-zoom-in').addEventListener('click', () => modules.canvas.zoomIn());
  btn('btn-zoom-out').addEventListener('click', () => modules.canvas.zoomOut());
  btn('btn-zoom-fit').addEventListener('click', () => modules.canvas.fitContent());

  // Grid toggle
  btn('btn-grid').addEventListener('click', (evt) => {
    const on = modules.canvas.toggleGrid();
    evt.currentTarget.classList.toggle('sf-toolbar__button--active', on);
  });

  // Theme toggle
  btn('btn-theme').addEventListener('click', () => {
    modules.theme.toggle();
    // Update grid color after theme change
    if (modules.canvas.refreshGrid) modules.canvas.refreshGrid();
    // Update icons on elements that use default (non-custom) label color
    if (modules.canvas.refreshIcons) modules.canvas.refreshIcons();
  });

  // Stencil toggle
  btn('btn-toggle-stencil').addEventListener('click', (evt) => {
    modules.stencil.toggle();
    evt.currentTarget.classList.toggle('sf-toolbar__button--active');
  });

  // Load modal close
  btn('btn-close-load-modal').addEventListener('click', hideLoadModal);
  btn('load-modal-overlay').addEventListener('click', hideLoadModal);

  // About modal
  btn('btn-about').addEventListener('click', showAboutModal);
  btn('btn-close-about').addEventListener('click', hideAboutModal);
  btn('about-modal-overlay').addEventListener('click', hideAboutModal);

  // Close dropdowns on outside click
  document.addEventListener('click', (evt) => {
    document.querySelectorAll('.sf-toolbar__dropdown--open').forEach(dd => {
      if (!dd.contains(evt.target)) dd.classList.remove('sf-toolbar__dropdown--open');
    });
  });

  // Adaptive zoom centering — switch to compact mode if overlap detected
  setupToolbarCentering();
}

// --- Dropdown helpers ---

function setupDropdown(triggerId) {
  const trigger = btn(triggerId);
  const dropdown = trigger.closest('.sf-toolbar__dropdown');
  trigger.addEventListener('click', (evt) => {
    evt.stopPropagation();
    // Close other dropdowns
    document.querySelectorAll('.sf-toolbar__dropdown--open').forEach(dd => {
      if (dd !== dropdown) dd.classList.remove('sf-toolbar__dropdown--open');
    });
    dropdown.classList.toggle('sf-toolbar__dropdown--open');
  });
  // Close dropdown when a menu item is clicked
  dropdown.querySelectorAll('.sf-toolbar__menu-item').forEach(item => {
    item.addEventListener('click', () => {
      dropdown.classList.remove('sf-toolbar__dropdown--open');
    });
  });
}

// --- Load Modal ---

function showLoadModal() {
  const saves = modules.persistence.getNamedSaves();
  const bodyEl = document.getElementById('load-modal-list');
  bodyEl.innerHTML = '';
  // Clean up any previous footer
  document.querySelector('.sf-modal__footer--load')?.remove();

  if (saves.length === 0) {
    bodyEl.innerHTML = '<p class="sf-modal__empty">No saved diagrams found.</p>';
  } else {
    for (const save of saves) {
      bodyEl.appendChild(buildLoadItem(save));
    }

    // Footer with select-all + Load Selected
    const dialog = bodyEl.closest('.sf-modal__dialog');
    const footer = document.createElement('div');
    footer.className = 'sf-modal__footer sf-modal__footer--load';
    footer.innerHTML = `
      <label class="sf-modal__select-all">
        <input type="checkbox" class="sf-modal__check-all"> Select all
      </label>
      <button class="sf-modal__btn sf-modal__btn--primary sf-modal__action-btn" disabled>Load Selected</button>
    `;
    dialog.appendChild(footer);

    wireSelectAll(bodyEl, footer, '.sf-modal__row-check', () => {
      const selected = [...bodyEl.querySelectorAll('.sf-modal__row-check:checked')];
      for (const chk of selected) {
        modules.persistence.loadNamedSave(chk.dataset.saveKey);
      }
      hideLoadModal();
    });
  }

  document.getElementById('load-modal').classList.remove('sf-modal--hidden');
  document.body.classList.add('sf-modal-open');
}

function hideLoadModal() {
  document.getElementById('load-modal').classList.add('sf-modal--hidden');
  document.body.classList.remove('sf-modal-open');
  document.querySelector('.sf-modal__footer--load')?.remove();
}

/**
 * Build a unique save name: "Name YYYYMMDD", or "Name 2 YYYYMMDD" etc.
 * If the base name already ends with the date suffix, don't double it —
 * instead insert an autonumber before the date: "Name 2 YYYYMMDD".
 */
function uniqueSaveName(baseName, dateSuffix, existingNames) {
  // Strip trailing date if it already matches today's suffix
  let stem = baseName;
  if (stem.endsWith(` ${dateSuffix}`)) {
    stem = stem.slice(0, -(dateSuffix.length + 1));
  }
  // Also strip any existing autonumber before a date suffix: "Name 2 20260406" -> "Name"
  const autoNumDateRe = new RegExp(` \\d+ ${dateSuffix}$`);
  if (autoNumDateRe.test(stem)) {
    stem = stem.replace(autoNumDateRe, '');
  }

  // Try "Name YYYYMMDD" first
  let candidate = `${stem} ${dateSuffix}`;
  if (!existingNames.has(candidate)) return candidate;

  // Try "Name 2 YYYYMMDD", "Name 3 YYYYMMDD", etc.
  for (let n = 2; ; n++) {
    candidate = `${stem} ${n} ${dateSuffix}`;
    if (!existingNames.has(candidate)) return candidate;
  }
}

// --- Save Modal ---

function showSaveModal() {
  // Remove existing save modal if any
  document.querySelector('.sf-save-modal')?.remove();

  const allTabs = modules.tabs.getAllTabs();
  const dateSuffix = (() => {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  })();

  const overlay = document.createElement('div');
  overlay.className = 'sf-save-modal sf-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  // Collect existing save names to avoid duplicates
  const existingSaves = new Set(modules.persistence.getNamedSaves().map(s => s.name));

  const tabRows = allTabs.map(tab => {
    const defaultName = uniqueSaveName(tab.name, dateSuffix, existingSaves);
    return `
      <div class="sf-modal__row${tab.isActive ? ' sf-modal__row--active' : ''}">
        <input type="checkbox" class="sf-modal__row-check" data-tab-id="${tab.id}" ${tab.isActive ? 'checked' : ''}>
        <span class="sf-modal__row-icon">${getDiagramTypeIcon(tab.diagramType)}</span>
        <input type="text" class="sf-modal__row-name" data-tab-id="${tab.id}" value="${escHtml(defaultName)}" spellcheck="false">
      </div>`;
  }).join('');

  overlay.innerHTML = `
    <div class="sf-modal__overlay sf-save-modal__backdrop"></div>
    <div class="sf-modal__dialog sf-save-modal__dialog">
      <div class="sf-modal__header">
        <h2 class="sf-modal__title">Save to Browser</h2>
        <button class="sf-toolbar__button sf-save-modal__close" aria-label="Close">
          <svg class="sf-toolbar__icon"><use href="#close"></use></svg>
        </button>
      </div>
      <div class="sf-modal__body sf-modal__row-list">
        ${tabRows}
      </div>
      <div class="sf-modal__footer">
        <label class="sf-modal__select-all">
          <input type="checkbox" class="sf-modal__check-all"> Select all
        </label>
        <button class="sf-modal__btn sf-modal__btn--primary sf-modal__action-btn">Save Selected</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close handlers
  const close = () => overlay.remove();
  overlay.querySelector('.sf-save-modal__backdrop').addEventListener('click', close);
  overlay.querySelector('.sf-save-modal__close').addEventListener('click', close);
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);

  const bodyEl = overlay.querySelector('.sf-modal__body');
  const footer = overlay.querySelector('.sf-modal__footer');

  wireSelectAll(bodyEl, footer, '.sf-modal__row-check', () => {
    const selected = [];
    overlay.querySelectorAll('.sf-modal__row-check:checked').forEach(c => {
      const tabId = c.dataset.tabId;
      const nameInput = overlay.querySelector(`.sf-modal__row-name[data-tab-id="${tabId}"]`);
      selected.push({ tabId, name: nameInput?.value.trim() || tabId });
    });
    if (selected.length === 0) return;

    // Save each tab individually with its custom name
    for (const { tabId, name } of selected) {
      const graphJSON = modules.tabs.getTabGraphJSON(tabId);
      const viewport = modules.tabs.getTabViewport(tabId);
      const diagramType = modules.tabs.getTabDiagramType(tabId);
      if (!graphJSON) continue;

      const key = 'sfdiag::save::' + name;
      const data = {
        name,
        timestamp: Date.now(),
        version: 1,
        diagramType,
        graph: graphJSON,
        viewport,
      };
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch (err) {
        alert(`Save failed for "${name}": ${err.message}`);
      }
    }

    // Mark active tab as saved if it was included
    const activeTab = allTabs.find(t => t.isActive);
    if (activeTab && selected.some(s => s.tabId === activeTab.id)) {
      const savedName = selected.find(s => s.tabId === activeTab.id)?.name;
      if (savedName) modules.tabs.renameActiveTab(savedName);
    }
    modules.tabs.markSaved('browser');

    close();
  });
}

// --- Shared modal helpers ---

/** Wire up select-all checkbox + action button for any modal with row checkboxes. */
function wireSelectAll(bodyEl, footerEl, checkSelector, onAction) {
  const checkAll = footerEl.querySelector('.sf-modal__check-all');
  const actionBtn = footerEl.querySelector('.sf-modal__action-btn');

  function update() {
    const checks = bodyEl.querySelectorAll(checkSelector);
    const anyChecked = [...checks].some(c => c.checked);
    const allChecked = checks.length > 0 && [...checks].every(c => c.checked);
    actionBtn.disabled = !anyChecked;
    checkAll.checked = allChecked;
    checkAll.indeterminate = anyChecked && !allChecked;
  }

  checkAll.addEventListener('change', () => {
    bodyEl.querySelectorAll(checkSelector).forEach(c => { c.checked = checkAll.checked; });
    update();
  });

  bodyEl.addEventListener('change', (e) => {
    if (e.target.matches(checkSelector)) update();
  });

  actionBtn.addEventListener('click', onAction);
  update();
}

function getDiagramTypeIcon(type) {
  const icons = {
    architecture: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="5" height="5" rx="1"/><rect x="10" y="1" width="5" height="5" rx="1"/><rect x="5.5" y="10" width="5" height="5" rx="1"/><path d="M3.5 6v2h9V6M8 8v2" stroke="currentColor" stroke-width="1" fill="none"/></svg>',
    process: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="7" y="5.5" width="5" height="5" rx="1"/><circle cx="3" cy="8" r="1"/><line x1="5.5" y1="8" x2="7" y2="8" stroke="currentColor" stroke-width="1.5"/></svg>',
    datamodel: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="1" width="6" height="3" rx="1"/><rect x="9" y="7" width="6" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="7" width="6" height="3" rx="1"/></svg>',
    gantt: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="8" height="3" rx="1"/><rect x="4" y="7" width="9" height="3" rx="1" opacity="0.7"/><rect x="7" y="12" width="6" height="3" rx="1" opacity="0.5"/></svg>',
    org: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="5" y="1" width="6" height="4" rx="1"/><rect x="0.5" y="10" width="6" height="4" rx="1" opacity="0.7"/><rect x="9.5" y="10" width="6" height="4" rx="1" opacity="0.7"/><path d="M8 5v2H3.5V10M8 7h4.5V10" stroke="currentColor" stroke-width="1" fill="none"/></svg>',
  };
  return icons[type] || icons.architecture;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showAboutModal() {
  document.getElementById('about-modal').classList.remove('sf-modal--hidden');
  document.body.classList.add('sf-modal-open');
}

function hideAboutModal() {
  document.getElementById('about-modal').classList.add('sf-modal--hidden');
  document.body.classList.remove('sf-modal-open');
}

function buildLoadItem(save) {
  const item = document.createElement('div');
  item.className = 'sf-modal__row';

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'sf-modal__row-check';
  check.dataset.saveKey = save.key;

  const icon = document.createElement('span');
  icon.className = 'sf-modal__row-icon';
  icon.innerHTML = getDiagramTypeIcon(save.diagramType);

  const info = document.createElement('div');
  info.className = 'sf-modal__row-info';

  const name = document.createElement('span');
  name.className = 'sf-modal__row-label';
  name.textContent = save.name;

  const meta = document.createElement('span');
  meta.className = 'sf-modal__row-meta';
  meta.textContent = formatSaveMeta(save);

  info.appendChild(name);
  info.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'sf-modal__row-actions';

  const loadBtn = document.createElement('button');
  loadBtn.className = 'sf-modal__btn sf-modal__btn--primary';
  loadBtn.textContent = 'Load';
  loadBtn.addEventListener('click', () => {
    if (modules.persistence.loadNamedSave(save.key)) {
      hideLoadModal();
    }
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'sf-modal__btn sf-modal__btn--danger';
  deleteBtn.title = 'Delete save';
  deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M6 2h4v1H6V2zm-3 2h10v1H3V4zm1 2h8l-.8 8H4.8L4 6zm2 1v5h1V7H6zm2 0v5h1V7H8z"/>
  </svg>`;
  deleteBtn.addEventListener('click', () => {
    if (confirm(`Delete "${save.name}"?`)) {
      modules.persistence.deleteNamedSave(save.key);
      item.remove();
      const list = document.getElementById('load-modal-list');
      if (list.children.length === 0) {
        list.innerHTML = '<p class="sf-modal__empty">No saved diagrams found.</p>';
        document.querySelector('.sf-modal__footer--load')?.remove();
      }
    }
  });

  actions.appendChild(loadBtn);
  actions.appendChild(deleteBtn);

  item.appendChild(check);
  item.appendChild(icon);
  item.appendChild(info);
  item.appendChild(actions);
  return item;
}

function formatSaveMeta(save) {
  const now = Date.now();
  const ageSec = Math.floor((now - save.timestamp) / 1000);
  let savedAgo;
  if (ageSec < 60) savedAgo = 'just now';
  else if (ageSec < 3600) savedAgo = `${Math.floor(ageSec / 60)}m ago`;
  else if (ageSec < 86400) savedAgo = `${Math.floor(ageSec / 3600)}h ago`;
  else savedAgo = `${Math.floor(ageSec / 86400)}d ago`;

  const daysLeft = Math.ceil(save.expiresIn / (24 * 60 * 60 * 1000));
  const expiryStr = daysLeft <= 7
    ? `expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
    : `expires in ${daysLeft} days`;

  return `Saved ${savedAgo} · ${expiryStr}`;
}

function updateDisplayMenuVisibility() {
  const dd = document.getElementById('display-dropdown');
  if (!dd || !modules.tabs) return;
  const type = modules.tabs.getActiveTabType();

  const isGantt = type === 'gantt';
  const isDataModel = type === 'datamodel';

  // Show/hide Gantt-specific options
  const ganttSep = document.getElementById('display-gantt-separator');
  const ganttAssignee = document.getElementById('btn-gantt-assignee');
  const ganttProgress = document.getElementById('btn-gantt-progress');
  // Hide gantt separator always — auto-layout buttons (above) and gantt options are mutually exclusive
  if (ganttSep) ganttSep.style.display = 'none';
  if (ganttAssignee) ganttAssignee.style.display = isGantt ? '' : 'none';
  if (ganttProgress) ganttProgress.style.display = isGantt ? '' : 'none';

  // Hide auto-layout buttons for Gantt (layout is timeline-driven)
  const autoH = document.getElementById('btn-auto-layout-h');
  const autoV = document.getElementById('btn-auto-layout-v');
  if (autoH) autoH.style.display = isGantt ? 'none' : '';
  if (autoV) autoV.style.display = isGantt ? 'none' : '';

  // Show data-model-specific options only for datamodel tabs
  const apiBtn = document.getElementById('btn-display-api');
  const lenBtn = document.getElementById('btn-display-lengths');
  const dmSep = document.getElementById('display-dm-separator');
  if (apiBtn) apiBtn.style.display = isDataModel ? '' : 'none';
  if (lenBtn) lenBtn.style.display = isDataModel ? '' : 'none';
  if (dmSep) dmSep.style.display = isDataModel ? '' : 'none';

  if (isGantt) {
    dd.style.display = '';
    updateGanttToggleLabels();
    return;
  }
  dd.style.display = '';
  if (isDataModel) updateDisplayToggleLabels();
}

function updateDisplayToggleLabels() {
  const labelsOn = isDisplayFlagOn('showLabels');
  const lenOn = isDisplayFlagOn('showFieldLengths');
  const apiBtn = document.getElementById('btn-display-api');
  const lenBtn = document.getElementById('btn-display-lengths');
  if (apiBtn) apiBtn.textContent = labelsOn ? 'Hide Labels' : 'Show Labels';
  if (lenBtn) lenBtn.textContent = lenOn ? 'Hide Field Lengths' : 'Show Field Lengths';
}

function updateGanttToggleLabels() {
  const assigneeOn = isDisplayFlagOn('showAssignee');
  const progressOn = isDisplayFlagOn('showProgress');
  const assigneeBtn = document.getElementById('btn-gantt-assignee');
  const progressBtn = document.getElementById('btn-gantt-progress');
  if (assigneeBtn) assigneeBtn.textContent = assigneeOn ? 'Hide Assigned Person' : 'Show Assigned Person';
  if (progressBtn) progressBtn.textContent = progressOn ? 'Hide Completion %' : 'Show Completion %';
}

function isDisplayFlagOn(flag) {
  const graph = modules.graph;
  if (!graph) return false;
  const ganttFlags = ['showAssignee', 'showProgress'];
  const isGanttFlag = ganttFlags.includes(flag);
  const objs = graph.getElements().filter(el => {
    const t = el.get('type');
    return isGanttFlag ? t.startsWith('sf.Gantt') : t === 'sf.DataObject';
  });
  if (objs.length === 0) return false;
  // For Gantt flags, undefined means "shown" (matches renderGanttTaskProps logic)
  if (isGanttFlag) return objs.some(el => el.get(flag) !== false);
  return objs.some(el => el.get(flag));
}

function applyDisplayFlagToAll(flag, value) {
  const graph = modules.graph;
  if (!graph) return;
  const ganttFlags = ['showAssignee', 'showProgress'];
  const isGanttFlag = ganttFlags.includes(flag);
  graph.getElements().forEach(el => {
    const t = el.get('type');
    if (isGanttFlag ? t.startsWith('sf.Gantt') : t === 'sf.DataObject') {
      el.set(flag, value);
    }
  });
}

function setupToolbarCentering() {
  const toolbar = document.getElementById('toolbar');
  const left = toolbar.querySelector('.sf-toolbar__left');
  const center = toolbar.querySelector('.sf-toolbar__center');
  const right = toolbar.querySelector('.sf-toolbar__right');
  if (!left || !center || !right) return;

  function checkOverlap() {
    // Temporarily remove compact to measure absolute-centered position
    toolbar.classList.remove('sf-toolbar--compact');
    requestAnimationFrame(() => {
      const leftR = left.getBoundingClientRect().right;
      const rightL = right.getBoundingClientRect().left;
      const centerR = center.getBoundingClientRect();
      const pad = 12;
      if (centerR.left - pad < leftR || centerR.right + pad > rightL) {
        toolbar.classList.add('sf-toolbar--compact');
      }
    });
  }

  const ro = new ResizeObserver(checkOverlap);
  ro.observe(toolbar);
  checkOverlap();
}

function btn(id) {
  return document.getElementById(id);
}

// Load manager (CLEANUP S4) — the Load Manager modal (Browser / Drive library / File / Paste-import panes) + its row/expiry/type helpers + the mermaid type map. Reads tctx.modules; imports showSaveManagerModal (save-manager) + renderDriveSignIn (context) - one-way slice edges.
import { buildModal, confirmModal, showError, showToast } from '../feedback.js?v=1.20.0.63';
import { dedupeSharedInWorkingCopies } from '../persistence/drive-sync-logic.js?v=1.20.0.63';
import { SPLIT_CHEVRON_SVG, bindSplitHeads, driveChipsHtml, groupSelectHtml, refreshSplitTableCounts, setTriStateCheckbox, sharePillHtml, splitTableHeadHtml, storageRowHtml, tabRowChipsHtml } from '../storage-ui.js?v=1.20.0.63';
import { countDiagramShapes, escHtml, formatBytes, formatRelativeTime, gaugeLevel, isViewForkTab, tabInGroup } from '../util.js?v=1.20.0.63';
import { btn, renderDriveSignIn, tctx } from './context.js?v=1.20.0.63';
import { showSaveManagerModal } from './save-manager.js?v=1.20.0.63';

function formatImportSummary({ imported = 0, skipped = 0, templates = 0, templatesSkipped = 0 } = {}) {
  const noun = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  // "Import complete" whenever ANYTHING new landed — including templates-only
  // (a template added IS something new, so "Nothing new" would be wrong).
  const head = (imported || templates) ? 'Import complete:' : 'Nothing new to import:';
  const items = [];
  if (imported)         items.push(`${noun(imported, 'diagram')} saved`);
  if (skipped)          items.push(`${noun(skipped, 'diagram')} skipped - already opened or saved in this browser`);
  if (templates)        items.push(`${noun(templates, 'template')} saved`);
  if (templatesSkipped) items.push(`${noun(templatesSkipped, 'template')} skipped - already in your stencil`);
  const lis = items.map(i => `<li>${i}</li>`).join('');
  return `<strong class="df-import-summary__head">${head}</strong><ul class="df-import-summary__list">${lis}</ul>`;
}

let _loadMgrClose = null;

export function showLoadManagerModal(initialTab = null, importStats = null) {
  const p = tctx.modules.persistence;
  _loadMgrClose?.(); _loadMgrClose = null;                 // release any prior instance's focus trap
  document.querySelector('.df-load-manager-modal')?.remove();
  const driveOn = !!p.isDriveConfigured?.();

  const TABS = [
    { key: 'browser', label: 'Browser', icon: 'open_folder' },
    ...(driveOn ? [{ key: 'drive', label: 'Google Drive', icon: 'icon-gdrive' }] : []),
    { key: 'file', label: 'File', icon: 'upload' },
    { key: 'paste', label: 'Paste', icon: 'paste' },
  ];
  // No explicit tab (the no-arg Load button) defaults to Google Drive when SIGNED IN - a Drive user lands on
  // their cloud library; everyone else lands on Browser. Explicit callers ('paste' / 'browser' / 'drive') win.
  const driveDefault = !!p.isDriveConnected?.() && TABS.some(t => t.key === 'drive');
  let active = TABS.some(t => t.key === initialTab) ? initialTab : (driveDefault ? 'drive' : 'browser');
  const tabBtn = (t) => `<button class="df-load-mgr__tab${t.key === active ? ' is-active' : ''}" role="tab" data-tab="${t.key}" aria-selected="${t.key === active}"><svg class="df-toolbar__icon" aria-hidden="true"><use href="#${t.icon}"></use></svg><span>${escHtml(t.label)}</span></button>`;

  const { body, footer, close } = buildModal({
    title: 'Load & Import',
    className: 'df-load-manager-modal',
    origin: document.getElementById('btn-load'),   // scale-open from the Load button
    anchor: document.getElementById('btn-load'),   // anchored under the Load button (item 5) so the tab row never jumps
    dialogClass: 'df-load-mgr__dialog',
    bodyClass: 'df-modal__row-list',
    bodyHtml: `<div class="df-load-mgr__tabs" role="tablist">${TABS.map(tabBtn).join('')}</div><div class="df-load-mgr__pane"></div>`,
    footerHtml: '<span></span>',
  });
  _loadMgrClose = () => { _loadMgrClose = null; close(); };
  const pane = body.querySelector('.df-load-mgr__pane');

  const select = (key) => {
    active = key;
    body.querySelectorAll('.df-load-mgr__tab').forEach(b => {
      const on = b.dataset.tab === key; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
    });
    footer.innerHTML = '';
    pane.innerHTML = '';
    const ctx = { pane, footer, close };
    if (key === 'browser') renderBrowserLoadPane(ctx, importStats);
    else if (key === 'drive') renderDriveLoadPane(ctx);
    else if (key === 'file') renderFileLoadPane(ctx);
    else if (key === 'paste') renderPasteLoadPane(ctx);
    importStats = null;   // the import summary shows only on the first Browser render
  };
  body.querySelectorAll('.df-load-mgr__tab').forEach(b => b.addEventListener('click', () => select(b.dataset.tab)));
  select(active);

  // Heal stale/missing per-tab Drive links against the user's real owned files BEFORE the chips can mislead, so
  // the Browser tab's "My Drive"/"Shared Drive" and the Drive tab's "This browser" both agree with reality (the
  // chip-honesty fix). One network round-trip; re-render the active pane ONLY when the reconcile actually changed
  // a tab - re-rendering unconditionally re-fetched + flashed the Drive pane every open (the "loads twice" flicker).
  if (driveOn && p.isDriveConnected?.() && p.reconcileTabDriveLinks) {
    p.reconcileTabDriveLinks().then((changed) => { if (changed && document.body.contains(pane)) select(active); }).catch(() => { /* offline → keep optimistic chips */ });
  }
}

// Closes the Load Manager (used by the per-row Load buttons in buildLoadItem + the advisory links).
export function hideLoadModal() { _loadMgrClose?.(); }

// Legacy entry points → the Load Manager on the matching tab (keeps persistence callbacks + New-Diagram wiring).
export function showLoadModal(importStats = null) { showLoadManagerModal('browser', importStats); }
export function showDriveLibraryModal() { if (tctx.modules.persistence.isDriveConfigured?.()) showLoadManagerModal('drive'); }
export function showPasteImportModal() { showLoadManagerModal('paste'); }

// --- Load Manager: Browser pane (reopen a closed diagram from the named-saves shelf) ---

/** Browser storage-pressure gauge HTML (item #3) — uses the existing getStorageFootprint / STORAGE_WARNING_BYTES.
 *  Returns '' when the footprint is unknown (Private mode throws) or empty. Only width:% is inlined; labels escaped. */
function storagePressureHtml() {
  let used = 0;
  try { used = tctx.modules.persistence.getStorageFootprint?.() || 0; } catch { return ''; }
  if (!(used > 0)) return '';
  const warn = tctx.modules.persistence.STORAGE_WARNING_BYTES || 4_000_000;
  const level = gaugeLevel(used, warn);
  const pct = Math.min(100, Math.round((used / warn) * 100));
  const hint = level === 'ok' ? ''
    : '<p class="df-load-gauge__hint">Browser storage is filling up - export or delete saved diagrams to free space.</p>';
  // Itemise the total so it reconciles with the rows below (the session blob / templates / settings are real
  // bytes the delete lists can't free) - same subline as the Close & Delete gauge.
  let breakdown = '';
  try {
    const bd = tctx.modules.persistence.getStorageBreakdown?.();
    if (bd) breakdown = `<div class="df-load-gauge__caption" style="font-size:var(--font-size-xs);color:var(--text-muted)"><span>Diagrams ${escHtml(formatBytes(bd.diagrams))} · My Templates ${escHtml(formatBytes(bd.templates))} · App data ${escHtml(formatBytes(bd.app))}</span></div>`;
  } catch { /* gauge stays total-only */ }
  return `<div class="df-load-gauge df-load-gauge--${level}">
      <div class="df-load-gauge__caption"><span>Browser storage</span><span>${escHtml((used / 1e6).toFixed(1))} MB used</span></div>
      <div class="df-load-gauge__track"><div class="df-load-gauge__fill" style="width:${pct}%"></div></div>
      ${breakdown}
      ${hint}
    </div>`;
}

function renderBrowserLoadPane({ pane, footer }, importStats) {
  const driveOn = !!tctx.modules.persistence.isDriveConfigured?.();
  // Open session tabs (non-empty), computed up front so the advisory copy and the footer "Close & Delete"
  // button stay in lockstep: the affordance — and the line pointing at it — appear whenever there's anything
  // to manage (closed archives OR open tabs), never dangling.
  const typeLabel = (type) => (tctx.modules.tabs.DIAGRAM_TYPES?.[type]?.short) || 'Architecture';
  const groupById = new Map((tctx.modules.tabs.getGroups?.() || []).map((g) => [g.id, g]));
  const openTabs = (tctx.modules.tabs.getAllTabs() || [])
    .map((t) => ({ ...t, shapes: countDiagramShapes(tctx.modules.tabs.getTabGraphJSON(t.id)?.cells) }))
    .filter((t) => t.shapes > 0);
  // A closed archive that is ALSO open as a tab (linked by browserSaveName, e.g. right after you Load it) is the
  // SAME diagram - show it ONCE in the open section below, not duplicated as a "closed" archive (new #2: loading
  // an archive used to list it in both the closed AND open lists, as if the load wasn't recognised).
  const openSaveNames = new Set(openTabs.map((t) => t.browserSaveName).filter(Boolean));
  const saves = (tctx.modules.persistence.getNamedSaves() || []).filter((s) => !openSaveNames.has(s.name));
  const hasArchives = !!(saves && saves.length);
  const hasContent = hasArchives || openTabs.length > 0;

  // Transient import summary (green) — only right after a bundle import reopened us on this tab.
  if (importStats && (importStats.imported || importStats.skipped || importStats.templates || importStats.templatesSkipped)) {
    const summary = document.createElement('div');
    summary.className = 'df-modal__advisory df-modal__advisory--success df-import-summary';
    summary.innerHTML = formatImportSummary(importStats);
    pane.appendChild(summary);
  }

  // Plain intro hint (NOT the yellow .df-modal__advisory block) - reads like the Google Drive tab's top line.
  // Three inline links: "delete" → the Close & Delete browser-storage hub; "Google Drive" + "back up" → the
  // Save & Export manager (where Save-to-Drive and the JSON "Back up now" both live). The Google Drive clause is
  // shown only when Drive is configured for this origin (on a Drive-dark prod build it's dropped, leaving a clean
  // "...free up space, or back up to JSON.").
  const advisory = document.createElement('p');
  advisory.className = 'df-drive-save-modal__hint';
  const delLink = '<button type="button" class="df-modal__advisory-link df-load__manage-link">delete</button>';
  const driveLink = '<button type="button" class="df-modal__advisory-link df-load__drive-link">Google Drive</button>';
  const backupLink = '<button type="button" class="df-modal__advisory-link df-load__export-link">back up</button>';
  advisory.innerHTML = `Your diagrams are auto-saved in this browser, so they reopen after you close a tab. The browser can clear old ones if space runs low. ${delLink} ones you don't need to free up space, ${driveOn ? `sync all to ${driveLink} to keep them for good, or ` : 'or '}${backupLink} to JSON.`;
  advisory.querySelector('.df-load__manage-link')?.addEventListener('click', () => { hideLoadModal(); tctx.modules.tabs.showCloseTabsModal?.(); });
  advisory.querySelector('.df-load__export-link')?.addEventListener('click', () => { hideLoadModal(); showSaveManagerModal(); });
  advisory.querySelector('.df-load__drive-link')?.addEventListener('click', () => { hideLoadModal(); showSaveManagerModal(); });
  pane.appendChild(advisory);

  // Browser storage-pressure gauge (item #3) — built from the existing footprint/ceiling helpers so the user
  // can see how full this browser's store is (it's what evicts the list above under pressure).
  const gaugeHtml = storagePressureHtml();
  if (gaugeHtml) { const g = document.createElement('div'); g.innerHTML = gaugeHtml; pane.appendChild(g.firstElementChild); }

  // 1) CLOSED diagrams — the named-saves archive (reopen / delete). Shown first, with the bulk footer.
  if (hasArchives) {
    // Item 3 + review fix: the "Select all" bar FLOATS above the Closed table as a controls strip (a sibling, not
    // inside the collapsible rows) - so collapsing the table no longer hides the select-all. Mirrors Close & Delete.
    const header = document.createElement('div');
    header.className = 'df-modal__list-header df-split-table__controls';
    header.innerHTML = `<label class="df-modal__select-all"><input type="checkbox" class="df-modal__check-all"> Select all</label>`;
    pane.appendChild(header);
    const box = document.createElement('div');
    box.className = 'df-split-table df-modal__list-box';   // collapsible table (item 3), expanded by default
    box.innerHTML = splitTableHeadHtml('Closed in this browser', saves.length);
    const rows = document.createElement('div');
    rows.className = 'df-split-table__rows';
    for (const save of saves) rows.appendChild(buildLoadItem(save));
    box.appendChild(rows);
    bindSplitHeads(box);
    pane.appendChild(box);

    // 6.4: no per-row delete + no bulk "Delete Selected" here — deleting browser-stored diagrams (open tabs AND
    // closed archives) now lives in ONE place, the Close & Delete overlay, reached from the advisory link above
    // (no footer button - the footer holds only Load Selected).
    footer.innerHTML = `<button class="df-modal__btn df-modal__btn--accent df-modal__action-btn" style="margin-left:auto" disabled>Load Selected</button>`;
    const checkAll = header.querySelector('.df-modal__check-all');
    const loadBtn = footer.querySelector('.df-modal__action-btn');
    const rowChecks = () => [...pane.querySelectorAll('.df-modal__row-check')];
    const refresh = (expand = false) => {
      const cs = rowChecks(); const checked = cs.filter(c => c.checked).length;
      loadBtn.disabled = checked === 0; setTriStateCheckbox(checkAll, checked, cs.length);
      // item 1: the Closed table's header count flips to "selected/total"; Select all also re-opens it if collapsed.
      refreshSplitTableCounts(pane, '.df-modal__row-check', { expand });
    };
    checkAll.addEventListener('change', () => { rowChecks().forEach(c => { c.checked = checkAll.checked; }); refresh(true); });
    pane.addEventListener('change', (e) => { if (e.target.matches('.df-modal__row-check')) refresh(); });
    loadBtn.addEventListener('click', async () => {
      const sel = rowChecks().filter(c => c.checked);
      // Coalesce the version notice: loading several old-version saves at once prompts ONCE per version (item 3).
      tctx.modules.persistence.beginVersionWarningBatch?.();
      try {
        for (const chk of sel) { if (await tctx.modules.persistence.loadNamedSave(chk.dataset.saveKey)) tagActiveBrowserSave(chk.dataset.saveName); }
      } finally { tctx.modules.persistence.endVersionWarningBatch?.(); }
      hideLoadModal();
    });
    refresh();
  }
  // (No archives → no footer: the footer was cleared on pane switch, and Close & Delete now lives in the
  // advisory link above, so there's nothing footer-worthy when the Browser tab holds only open diagrams.)

  // 2) OPEN diagrams — the current session tabs (auto-kept in this browser). Listed AFTER the archive so the
  // Browser tab matches the Save Manager's "This browser" chips and is never confusingly empty when you have
  // work. These are already open, so the action is "Go to tab" (switch), not "Load". Non-empty only (mirrors
  // the Save Manager); the active tab shows a disabled "Current". (typeLabel / groupById / openTabs are computed
  // at the top of this function so the footer above can gate on openTabs.)
  if (openTabs.length) {
    const grp = document.createElement('div');
    grp.className = 'df-split-table df-modal__list-box is-collapsed';   // collapsible table, collapsed by default (#5, item 3)
    grp.innerHTML = splitTableHeadHtml('Opened in this browser', openTabs.length);
    const box = document.createElement('div');
    box.className = 'df-split-table__rows';
    for (const t of openTabs) {
      const rel = formatRelativeTime(t.lastModifiedAt || t.lastSavedAt);
      const tmp = document.createElement('template');
      tmp.innerHTML = storageRowHtml({
        active: t.isActive,   // active row → "current" pill + highlight (shared with the Save Manager)
        diagramType: t.diagramType, typeTitle: typeLabel(t.diagramType),
        name: t.name,
        groupBadge: tctx.modules.tabs.groupBadgeHtml?.(t.groupId ? groupById.get(t.groupId) : null) || '',   // group badge (item 11)
        count: t.shapes,
        metaLeft: tabRowChipsHtml(t, { driveOn }),   // shared: chips + Copy/Collab pill from t.driveCopies (bug #4 fixed once, everywhere)
        metaRight: rel ? `Edited ${rel}` : '',   // right-aligned edit time, mirroring the Save Manager rows
        // Already-open diagrams: Current / Go to tab are brand-orange WIRE (transparent); the action isn't a load.
        trailing: `<button class="df-modal__btn df-modal__btn--amber-outline df-load-open__go" data-id="${escHtml(t.id)}"${t.isActive ? ' disabled' : ''}>${t.isActive ? 'Current' : 'Go to tab'}</button>`,
      }).trim();
      const row = tmp.content.firstElementChild;
      row.querySelector('.df-load-open__go')?.addEventListener('click', () => { hideLoadModal(); tctx.modules.tabs.switchTab?.(t.id); });
      box.appendChild(row);
    }
    grp.appendChild(box);
    bindSplitHeads(grp);
    pane.appendChild(grp);
  }

  // 3) Truly empty (nothing closed AND no non-empty open tab) — only on a fresh blank canvas.
  if (!hasContent) {
    const empty = document.createElement('p');
    empty.className = 'df-modal__empty';
    empty.textContent = 'No diagrams in this browser yet. Add some shapes and your diagrams appear here.';
    pane.appendChild(empty);
  }
}

// --- Load Manager: Google Drive pane ("Your Google Drive Diagrams" library) ---
function renderDriveLoadPane({ pane, footer, close }) {
  const p = tctx.modules.persistence;
  pane.innerHTML = `
    <p class="df-drive-save-modal__hint">Your Google Drive diagrams, plus ones shared to you (marked <strong>Shared File</strong>). Open them on any device. Delete moves a diagram to Drive trash for 30 days; only the owner can remove a file shared to you.</p>
    <div class="df-drive-library__body"><p style="padding:18px;text-align:center;color:var(--text-secondary)">Loading…</p></div>
    <div class="df-drive-library__more">
      <p class="df-drive-library__more-hint">Looking for a diagram that isn't listed - one you added to Drive yourself, or that lives on a team Shared Drive?</p>
      <button class="df-modal__btn df-modal__btn--accent df-drive-library__picker"><svg class="df-toolbar__icon" aria-hidden="true"><use href="#icon-gdrive"></use></svg>Search Google Drive</button>
    </div>`;
  footer.innerHTML = '<button class="df-modal__btn df-modal__btn--danger-outline df-drive-library__delete" style="margin-right:auto" disabled>Delete Selected</button><button class="df-modal__btn df-modal__btn--amber-outline df-drive-library__load" disabled>Load Selected</button>';
  const deleteBtn = footer.querySelector('.df-drive-library__delete');
  const loadBtn = footer.querySelector('.df-drive-library__load');
  const bodyBox = pane.querySelector('.df-drive-library__body');
  const status = (html) => { bodyBox.innerHTML = `<p style="padding:18px;text-align:center;color:var(--text-secondary)">${html}</p>`; deleteBtn.disabled = true; loadBtn.disabled = true; };
  // Item 8: search the whole Drive (incl. files added manually / on Shared Drives) via the Google Picker. The
  // library list above only shows the app's own .dgf masters; the picker reaches anything the user can open.
  pane.querySelector('.df-drive-library__picker')?.addEventListener('click', () => { close(); p.openFromDrive?.(); });

  // Chips parity with the Save Manager: a Drive file that's also OPEN locally shows its full storage chips; one
  // that isn't shows "My Drive ✓" with the browser chip off. Map open tabs by their linked Drive fileId.
  // Key open tabs by their linked Drive id - an OWN master by driveFileId, a Shared File by sharedSource.fileId
  // (item 3.4b: a shared file open in a tab has NO driveFileId, so it was missed here and its row wrongly read
  // "This browser" OFF while Load -> Browser showed it ON. Now both panes agree).
  const openByDrive = new Map((tctx.modules.tabs.getAllTabs() || [])
    .filter((t) => t.driveFileId || t.driveSharedSource?.fileId)
    .map((t) => [t.driveFileId || t.driveSharedSource.fileId, t]));
  const groupById = new Map((tctx.modules.tabs.getGroups?.() || []).map((g) => [g.id, g]));

  const rowHtml = (f) => {
    const type = f.appProperties?.dfType;
    const typeLabel = (tctx.modules.tabs.DIAGRAM_TYPES?.[type]?.short) || '';
    const shapes = f.appProperties?.dfShapes != null ? Number(f.appProperties.dfShapes) : null;
    const rel = formatRelativeTime(Date.parse(f.modifiedTime));
    const ot = openByDrive.get(f.id);
    // A file shared TO me (I'm not the owner) leaks into this list under drive.file. It is NOT in My Drive, so
    // show a "Shared File" chip instead of a green "My Drive" (item 8.1), and mark it so delete skips it (the
    // recipient can't trash a file they don't own - that's the 403). Open tabs keep their own Shared-File-model
    // chips. The "Shared with you" section adds who shared it + the access type (writer = Collaborate, reader = a
    // View / Copy share) from the capabilities + sharingUser/owners fields.
    // A working copy is an OWNED master that IS the recipient's editable copy of a shared-in file (the de-dup above
    // collapsed it + hid the original). It gets the shared-in treatment (Shared File chip + Copy/Collab pill) but,
    // being yours, keeps the plain Load button.
    const workingCopy = f._sharedInWorkingCopy;
    const notOwned = f.ownedByMe === false;
    // canEdit drives the Copy/Collab pill: for a working copy it's the SHARE's access (view=Copy, edit=Collab), NOT
    // your ownership of the copy; for a real not-owned file it's your write capability on it.
    const canEdit = workingCopy ? workingCopy.canEdit : !!(f.capabilities && f.capabilities.canEdit);
    const sharedIn = notOwned || !!workingCopy;
    // `driveId` is set only for files that live on a team Shared Drive. Such a file is the ACTUAL Shared-Drive copy
    // (often a near-duplicate of your My-Drive source master) - badge IT "Shared Drive", and rebuild a clean chipT
    // so it isn't also mislabeled "My Drive" from an open tab's own fileId (#1).
    const onSharedDrive = !!f.driveId;
    const chipT = onSharedDrive ? { driveSharedCopies: 0 }
      : ot || (workingCopy ? { driveFileId: f.id, driveSharedSource: { fileId: '_src', canEdit } }   // owned + linked = My Drive + Shared File chips
        : notOwned ? { driveSharedSource: { fileId: f.id, canEdit } }
          : { driveFileId: f.id });
    // A file shared TO you: who shared it + the access type (writer = Collaborate, reader = Copy) now live as a
    // pill on the top row + a "shared by X" tooltip on the Shared File chip, so the old dedicated third row is
    // gone (the row is two-line like every other). The chips drop the irrelevant "My Drive" (it is not in your
    // Drive) so "This browser" + "Shared File" carry the real status.
    const who = notOwned ? (f.sharingUser?.emailAddress || f.sharingUser?.displayName
      || f.owners?.[0]?.emailAddress || f.owners?.[0]?.displayName || 'someone') : '';
    // Copy/Collaborate pill marks the access level at a glance. It sits in the BOTTOM chip row right after the
    // "Shared File" chip (item 6) - the access type belongs with the Shared-File state, not up by the title - sized
    // to match that row (df-share-pill--sm).
    const sharePill = sharedIn ? sharePillHtml(canEdit, { sm: true, workingCopy: !!workingCopy }) : '';
    const groupBadge = (ot && ot.groupId ? (tctx.modules.tabs.groupBadgeHtml?.(groupById.get(ot.groupId)) || '') : '');
    const cloneBtn = `<button class="df-modal__btn df-modal__btn--amber-outline df-drive-library__clone" data-id="${escHtml(f.id)}" data-name="${escHtml(f.name)}"${canEdit ? '' : ' data-copy="1"'} title="Save your own independent copy in My Drive - it becomes your file (refreshable from the original; your edits don't sync back to the owner)">Clone</button>`;
    // data-can-edit carries the list's KNOWN Collab status (the "Collab" pill) into the open so the recipient's
    // tab share glyph appears immediately - even if the fresh ownership probe returns canEdit=null (Drive omits
    // capabilities right after a grant), which previously left the glyph hidden until the first edit (#3).
    // Mode C: an OWNED fork carries dfSharedFrom - thread it into the open so the refresh-only sharedSource is rebuilt
    // (Refresh-from-original survives a close+re-open), without re-classifying the fork as a shared-in tab.
    const forkAttrs = (!notOwned && f.appProperties?.dfSharedFrom)
      ? ` data-shared-from="${escHtml(f.appProperties.dfSharedFrom)}" data-shared-edit="${escHtml(f.appProperties.dfSharedEdit || '0')}"` : '';
    const loadBtn = `<button class="df-modal__btn df-modal__btn--accent df-drive-library__open" data-id="${escHtml(f.id)}" data-name="${escHtml(f.name)}"${notOwned ? ' data-shared="1"' : ''}${notOwned && canEdit ? ' data-can-edit="1"' : ''}${onSharedDrive ? ` data-drive-id="${escHtml(f.driveId)}"` : ''}${forkAttrs}>Load</button>`;
    // Mode C: a VIEW (Copy) share now opens with Load - it creates nothing on open and forks to your own
    // "(changed)" My-Drive copy the moment you edit it, so an explicit Clone is no longer needed. A Collaborate
    // share offers Load + a fork-now Clone; owned files + working copies offer the plain Load.
    const trailing = notOwned && canEdit
      ? `<div class="df-drive-library__actions">${loadBtn}${cloneBtn}</div>`
      : loadBtn;
    return storageRowHtml({
      checkbox: `<input type="checkbox" class="df-modal__row-check df-drive-library__check" data-id="${escHtml(f.id)}" data-name="${escHtml(f.name)}"${notOwned ? ' data-shared="1"' : ''}${notOwned && canEdit ? ' data-can-edit="1"' : ''}${onSharedDrive ? ` data-drive-id="${escHtml(f.driveId)}"` : ''}${forkAttrs}>`,
      diagramType: type || '', typeTitle: typeLabel, name: f.name.replace(/\.dgf$/i, ''),
      groupBadge,
      count: Number.isFinite(shapes) ? shapes : null,
      metaLeft: `<span class="df-save-mgr__chips">${driveChipsHtml(chipT, { driveOn: true, browserOn: !!ot, browserTitle: ot ? undefined : 'Not open in this browser right now', sharedFile: notOwned, onSharedDrive, hasMyDriveBackup: !!(ot && ot.driveHasMyDriveBackup), hideSharedCopies: true, sharedFileTitle: notOwned ? `Shared by ${who} - ${canEdit ? 'you can edit (Collab)' : 'view-only (Copy)'}` : undefined })}${sharePill}</span>`,
      metaRight: rel ? `Edited ${escHtml(rel)}` : 'in your Drive',
      trailing,
    });
  };

  const confirmDelete = async (ids, oneName) => {
    const ok = await confirmModal({
      title: ids.length === 1 ? 'Delete from Google Drive?' : `Delete ${ids.length} diagrams?`,
      message: `${ids.length === 1 ? `"${(oneName || '').replace(/\.dgf$/i, '')}" moves` : `${ids.length} diagrams move`} to Drive trash, recoverable for 30 days. Copies you shared out are not affected.`,
      okLabel: 'Move to trash', cancelLabel: 'Cancel', tone: 'danger',
    });
    if (!ok) return;
    let n = 0;
    for (const id of ids) if (await p.deleteDiagramFromDrive(id)) { p.forgetArchivesForDriveFile?.(id); n++; }
    if (n) showToast(`Moved ${n} diagram${n === 1 ? '' : 's'} to Drive trash ✓`, 'info');
    render();
  };

  const render = async () => {
    status('Loading…');
    // Passive surface → gate on a LIVE token (`isSignedIn` = tokenValid, a PURE check — no getToken, so it can't
    // pop Google's picker OR briefly flash it). Not signed in (incl. a TIMED-OUT red Drive) → the shared explicit
    // Sign-in, consistent with Version history / Compare; only the button click authenticates.
    if (!p.isSignedIn?.()) { renderDriveSignIn(bodyBox, 'Sign in to Google Drive to see your saved diagrams.', render); return; }
    let files;
    try { files = await p.listMyDiagrams(); }
    catch {
      bodyBox.innerHTML = `<p style="padding:18px;text-align:center;color:var(--text-secondary)">Could not load your Drive diagrams. <button class="df-modal__btn df-drive-library__retry">Retry</button></p>`;
      bodyBox.querySelector('.df-drive-library__retry')?.addEventListener('click', render);
      return;
    }
    // Hide files that aren't diagrams the user works on directly, so they don't read as a phantom second row:
    //  - My-Drive BACKUP mirrors (dfBackupOf) - the auto-kept copy of a Shared-Drive / direct-edit file.
    //  - recipient-editable SHARE copies (dfEditShareOf) - the copy a Collaborate share hands to the recipient; its
    //    surface is the Share Manager + the Review flow, not the library (screen 3). For copies created BEFORE that
    //    stamp, also drop any open tab's tracked edit-share copy fileId (cross-ref via getAllTabs().driveCopies).
    const _openTabs = tctx.modules.tabs.getAllTabs() || [];
    const _editShareIds = new Set();
    for (const t of _openTabs) for (const c of (t.driveCopies || [])) if (c && c.kind === 'edit-share' && c.fileId) _editShareIds.add(c.fileId);
    files = files.filter(f => !(f.appProperties && (f.appProperties.dfBackupOf || f.appProperties.dfEditShareOf)) && !_editShareIds.has(f.id));
    // Collapse a shared-in diagram (recipient's own working-copy master + the original) to ONE row: drop the original,
    // tag the surviving master `_sharedInWorkingCopy` so it re-homes under "Shared with you". Pure helper (unit-tested).
    files = dedupeSharedInWorkingCopies(files, _openTabs);
    if (!files.length) { status('No diagrams in your Google Drive yet. Save a diagram to Drive (or turn on auto-sync) and it appears here.'); return; }
    // Select-all + a "Select Tab Group" picklist (item #4): a Drive file's group is the group of its matching
    // open tab (via openByDrive). The picklist self-hides when there are no named groups.
    const groupPick = groupSelectHtml(tctx.modules.tabs.getGroups?.() || []);
    // Split into your own files vs files shared TO you (item 8). A "Shared with you" section reads as an invite
    // list - you can open them but not delete them (only the owner can). When there are no shared files, it's just
    // the single list as before (no redundant "Your Google Drive" header).
    // A working-copy-of-a-share is OWNED but belongs under "Shared with you" (it IS a shared-in diagram).
    const mine = files.filter(f => f.ownedByMe !== false && !f._sharedInWorkingCopy);
    const shared = files.filter(f => f.ownedByMe === false || f._sharedInWorkingCopy);
    // Item 2: each section is its OWN bordered, collapsible TABLE (like Load Browser's groups) - a header band with
    // a chevron + count capping its own rows - not two soft sub-sections sharing one box. Uncollapsed by default.
    const groupTable = (label, files) =>
      `<div class="df-modal__list-box df-drive-library__group"><div class="df-drive-library__section" role="button" tabindex="0">${SPLIT_CHEVRON_SVG}<span>${escHtml(label)}</span><span class="df-drive-library__section-count">${files.length}</span></div><div class="df-drive-library__group-rows">${files.map(rowHtml).join('')}</div></div>`;
    // The global Select-all + group-pick bar sits ABOVE both tables (it spans the whole multi-select).
    const controls = `<div class="df-modal__list-header df-drive-library__controls"><label class="df-modal__select-all"><input type="checkbox" class="df-drive-library__all"> Select all</label>${groupPick}</div>`;
    // Both present → two labelled, collapsible tables. Mine-only → a single flat table (no redundant header).
    // Shared-only → one "Shared with you" table.
    let tables;
    if (mine.length && shared.length) tables = groupTable('Your Google Drive', mine) + groupTable('Shared with you', shared);
    else if (mine.length) tables = `<div class="df-modal__list-box">${mine.map(rowHtml).join('')}</div>`;
    else tables = groupTable('Shared with you', shared);
    bodyBox.innerHTML = controls + tables;
    bodyBox.querySelectorAll('.df-drive-library__group .df-drive-library__section').forEach((h) => {
      const grp = h.closest('.df-drive-library__group');
      const tg = () => grp.classList.toggle('df-drive-library__group--collapsed');
      h.addEventListener('click', tg);
      h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tg(); } });
    });
    const checks = [...bodyBox.querySelectorAll('.df-drive-library__check')];
    const groupOfFile = (id) => openByDrive.get(id)?.groupId || null;
    // The Drive-library select-all is deliberately NON-tri-state (only gates the buttons; never shows an
    // indeterminate dash) — do not route it through setTriStateCheckbox to "unify" it. Its section headers also
    // use their own `.df-drive-library__section` markup (not `.df-split-table__head`), so bindSplitHeads/
    // splitTableHeadHtml intentionally skip it too; only the chevron SVG is shared (SPLIT_CHEVRON_SVG).
    const refresh = () => { const any = checks.some(c => c.checked); deleteBtn.disabled = !any; loadBtn.disabled = !any; };
    bodyBox.querySelector('.df-drive-library__all')?.addEventListener('change', (e) => { checks.forEach(c => { c.checked = e.target.checked; }); refresh(); });
    const groupSel = bodyBox.querySelector('.df-group-select');
    groupSel?.addEventListener('change', () => {
      const chosen = groupSel.value;
      if (chosen) checks.forEach(c => { c.checked = tabInGroup(groupOfFile(c.dataset.id), chosen); });
      groupSel.value = '';   // snap back to the placeholder (it's a picker, not a filter state)
      refresh();
    });
    checks.forEach(c => c.addEventListener('change', refresh));
    bodyBox.querySelectorAll('.df-drive-library__open').forEach(btn => btn.addEventListener('click', async () => { if (await p.openDriveDiagram(btn.dataset.id, btn.dataset.name, btn.dataset.shared !== '1', { knownCanEdit: btn.dataset.canEdit === '1', driveId: btn.dataset.driveId || null, sharedFrom: btn.dataset.sharedFrom || null, sharedEdit: btn.dataset.sharedEdit || null })) close(); }));
    // Clone a shared file into the user's own Drive as an editable copy, then close (it opens as a new tab) (item 2).
    bodyBox.querySelectorAll('.df-drive-library__clone').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { if (await p.cloneSharedToMyDrive?.(btn.dataset.id, btn.dataset.name)) close(); else btn.disabled = false; }
      catch { btn.disabled = false; }
    }));
  };
  deleteBtn.addEventListener('click', () => {
    const sel = [...bodyBox.querySelectorAll('.df-drive-library__check:checked')];
    // A file shared TO you can't be moved to trash by you (only its owner can - that's the 403). Trash only the
    // files you own; warn about any shared ones in the selection. Pass the single owned name so the confirm
    // dialog shows it (the missing-filename bug: confirmDelete was called with no name).
    const owned = sel.filter(c => c.dataset.shared !== '1');
    const sharedN = sel.length - owned.length;
    if (sharedN && !owned.length) {
      showToast(`Files shared to you can't be deleted here - only the owner can remove them.`, 'info');
      return;
    }
    if (sharedN) showToast(`${sharedN} shared file${sharedN === 1 ? '' : 's'} skipped - only the owner can delete.`, 'info');
    const ids = owned.map(c => c.dataset.id);
    if (ids.length) confirmDelete(ids, owned.length === 1 ? owned[0].dataset.name : null);
  });
  loadBtn.addEventListener('click', async () => {
    const sel = [...bodyBox.querySelectorAll('.df-drive-library__check:checked')];
    if (!sel.length) return;
    loadBtn.disabled = true;
    let opened = 0;
    // Coalesce the version notice across the batch (item 3) - one prompt per old version, not per file.
    p.beginVersionWarningBatch?.();
    try {
      for (const c of sel) { if (await p.openDriveDiagram(c.dataset.id, c.dataset.name, c.dataset.shared !== '1', { knownCanEdit: c.dataset.canEdit === '1', driveId: c.dataset.driveId || null, sharedFrom: c.dataset.sharedFrom || null, sharedEdit: c.dataset.sharedEdit || null })) opened++; }
    } finally { p.endVersionWarningBatch?.(); }
    if (opened) close(); else loadBtn.disabled = false;
  });
  render();
}

// --- Load Manager: File pane (open a .dgf / .json export by drop or picker) ---
function renderFileLoadPane({ pane, footer, close }) {
  pane.innerHTML = `
    <div class="df-load-file" tabindex="0" role="button" aria-label="Choose a file or drop it here">
      <svg class="df-load-file__icon" aria-hidden="true"><use href="#upload"></use></svg>
      <p class="df-load-file__title">Drop a diagram file here, or click to choose</p>
      <p class="df-load-file__sub">A Diagramforce <strong>.dgf</strong> or <strong>.json</strong> export - single diagram, group bundle, or templates.</p>
      <input type="file" class="df-load-file__input" accept=".dgf,.json,application/json" hidden>
    </div>`;
  footer.innerHTML = '<span class="df-load-mgr__foot-hint">Files load into a new tab.</span>';
  const zone = pane.querySelector('.df-load-file');
  const input = pane.querySelector('.df-load-file__input');
  const onFiles = async (files) => {
    const f = files && files[0];
    if (!f) return;
    let text;
    try { text = await f.text(); } catch { showError('Could not read that file.'); return; }
    close();   // close first; loadJSONText handles single/bundle/templates (a bundle reopens the Browser tab with a summary)
    await tctx.modules.persistence.loadJSONText(text, f.name.replace(/\.(dgf|json)$/i, ''));
  };
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => onFiles(input.files));
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('is-drag'); }));
  ['dragleave', 'dragend'].forEach(ev => zone.addEventListener(ev, () => zone.classList.remove('is-drag')));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('is-drag'); onFiles(e.dataTransfer?.files); });
}

// --- Load Manager: Paste pane (auto-detect Diagramforce JSON vs Mermaid) ---
function renderPasteLoadPane({ pane, footer, close }) {
  pane.innerHTML = `
    <div class="df-paste-modal">
      <p style="margin:0 0 var(--spacing-sm);color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">Paste Diagramforce JSON or Mermaid code - the format is detected automatically:</p>
      <textarea class="df-paste-modal__input" spellcheck="false" rows="9"
        placeholder='{ "diagramType": "architecture", "graph": { "cells": [ ... ] } }&#10;&#10;OR&#10;&#10;flowchart TD&#10;  A[Start] --> B[Decision]'
        style="width:100%;box-sizing:border-box;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;padding:8px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-panel);color:var(--text-primary);resize:vertical"></textarea>
      <p class="df-paste-modal__status" style="margin:var(--spacing-sm) 0 0;min-height:1.4em;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5"></p>
      <div class="df-paste-modal__formats">
        <div class="df-paste-modal__fmt" data-fmt="json">
          <div class="df-paste-modal__fmt-title">Diagramforce JSON</div>
          <div class="df-paste-modal__fmt-sub">A diagram exported via <strong>Save → Export to JSON</strong>, or generated with the <a href="https://github.com/MateuszDabrowski/diagramforce/blob/main/DIAGRAM_JSON_SPEC.md" target="_blank" rel="noopener" class="df-paste-modal__fmt-anchor">Diagramforce LLM Spec</a>.</div>
          <div class="df-paste-modal__fmt-detected" aria-live="polite"></div>
        </div>
        <div class="df-paste-modal__fmt" data-fmt="mermaid">
          <div class="df-paste-modal__fmt-title">Mermaid <span class="df-badge df-badge--beta">Beta</span></div>
          <ul class="df-paste-modal__fmt-list">
            <li data-mtype="flowchart" data-label="flowchart">flowchart</li><li data-mtype="graph" data-label="graph">graph</li><li data-mtype="state" data-label="stateDiagram">stateDiagram</li><li data-mtype="er" data-label="erDiagram">erDiagram</li><li data-mtype="sequence" data-label="sequenceDiagram">sequenceDiagram</li>
          </ul>
        </div>
      </div>
    </div>`;
  footer.innerHTML = '<button class="df-modal__btn df-modal__btn--accent df-paste-modal__load" style="margin-left:auto" disabled>Load</button>';
  const input = pane.querySelector('.df-paste-modal__input');
  const status = pane.querySelector('.df-paste-modal__status');
  const loadBtn = footer.querySelector('.df-paste-modal__load');
  const fmtCols = pane.querySelectorAll('.df-paste-modal__fmt');
  const jsonCol = pane.querySelector('.df-paste-modal__fmt[data-fmt="json"]');
  const mtypeEls = pane.querySelectorAll('.df-paste-modal__fmt-list [data-mtype]');
  const errColor = 'var(--color-danger)';
  let mode = null;

  const jsonDetected = jsonCol?.querySelector('.df-paste-modal__fmt-detected');
  const resetHighlight = () => {
    fmtCols.forEach(c => c.classList.remove('is-on', 'is-err'));
    mtypeEls.forEach(li => { li.classList.remove('is-on'); li.textContent = li.dataset.label; });
    if (jsonDetected) jsonDetected.textContent = '';
  };
  const detect = (raw) => {
    const t = raw.trim();
    if (!t) return { kind: 'empty' };
    if (t[0] === '{' || t[0] === '[') {
      const d = tctx.modules.persistence.describePastedJSON(t);
      return d.ok ? { kind: 'json', rawType: d.rawType, diagramType: d.diagramType } : { kind: 'error', error: d.error };
    }
    const v = tctx.modules.mermaidImport.validateMermaid(t);
    if (v.ok) return { kind: 'mermaid', mtype: v.type };
    return { kind: 'error', error: 'Not recognised as Diagramforce JSON or a supported Mermaid diagram.' };
  };
  const validate = () => {
    resetHighlight();
    const d = detect(input.value);
    if (d.kind === 'empty') { mode = null; loadBtn.disabled = true; status.textContent = ''; return; }
    if (d.kind === 'error') { mode = null; loadBtn.disabled = true; status.style.color = errColor; status.textContent = d.error; fmtCols.forEach(c => c.classList.add('is-err')); return; }
    mode = d.kind;
    loadBtn.disabled = false;
    status.textContent = '';
    if (d.kind === 'json') {
      jsonCol?.classList.add('is-on');
      // Showcase what the paste will become: "<diagramType from JSON> → <friendly Diagram Type>" in brand green.
      if (jsonDetected && d.rawType) jsonDetected.innerHTML = `<code>${escHtml(d.rawType)}</code> → ${escHtml(typeLabelFor(d.diagramType))}`;
      return;
    }
    const li = [...mtypeEls].find(el => el.dataset.mtype === d.mtype);
    if (li) { li.classList.add('is-on'); li.textContent = `${li.dataset.label} → ${MERMAID_INFO[d.mtype]?.target || 'diagram'}`; }
  };
  input.addEventListener('input', validate);
  loadBtn.addEventListener('click', async () => {
    let ok = false;
    if (mode === 'json') ok = await tctx.modules.persistence.loadJSONText(input.value, 'Pasted');
    else if (mode === 'mermaid') ok = tctx.modules.mermaidImport.importMermaidText(input.value);
    if (ok) close();
  });
  setTimeout(() => input.focus(), 50);
}

/** After loading a browser named-save, tag the now-active tab so the Save Manager "In Browser" chip lights up. */
function tagActiveBrowserSave(name) {
  const active = (tctx.modules.tabs.getAllTabs() || []).find(t => t.isActive);
  if (active && name) tctx.modules.tabs.setTabBrowserSaveName(active.id, name);
}

const MERMAID_INFO = {
  flowchart: { name: 'flowchart', target: 'Process' },
  graph:     { name: 'graph', target: 'Process' },
  state:     { name: 'state diagram', target: 'Process' },
  er:        { name: 'ER diagram', target: 'Data Model' },
  sequence:  { name: 'sequence diagram', target: 'Sequence' },
};

function buildLoadItem(save) {
  // Same shared two-line storage row as the Save Manager. Browser saves carry no group, so no group badge.
  // Trailing = per-row Load (deletion lives in Close & Delete now - item 6.4, no per-row trash here).
  const tmp = document.createElement('template');
  const rel = formatRelativeTime(save.timestamp) || 'just now';
  // Same chip builder as every other view so a closed archive reads identically (item 6): "This browser" +
  // "My Drive" (if archived with a driveFileId) + "Shared File" (amber, with the check, and its tooltip reflects
  // the Copy/Collaborate access stored in driveSharedSource.canEdit at open time - item 1). Force the Drive chips
  // on whenever this archive HAS Drive provenance, even if Drive is currently disconnected.
  const driveOn = !!tctx.modules.persistence.isDriveConfigured?.() || !!(save.driveFileId || save.driveSharedSource?.fileId);
  // 6.2: Expires before the (Last Modified) edited time, grouped on the right; storage chips stay on the left.
  const ssrc = save.driveSharedSource;
  const savePill = (ssrc && ssrc.fileId && !isViewForkTab(save)) ? sharePillHtml(ssrc.canEdit, { sm: true }) : '';   // bug #4: the Copy/Collab pill was missing on Load -> Browser archive rows
  tmp.innerHTML = storageRowHtml({
    checkbox: `<input type="checkbox" class="df-modal__row-check" data-save-key="${escHtml(save.key)}" data-save-name="${escHtml(save.name)}">`,
    diagramType: save.diagramType, typeTitle: typeLabelFor(save.diagramType), name: save.name, count: save.shapes,
    metaLeft: `<span class="df-save-mgr__chips">${driveChipsHtml(save, { driveOn, sharedFile: !!(save.driveSharedSource && save.driveSharedSource.fileId), onSharedDrive: !!save.driveDriveId })}${savePill}</span>`,
    metaRight: `${escHtml(expiryLabel(save))} · Last Modified ${escHtml(rel)}`,
    trailing: `<button class="df-modal__btn df-modal__btn--accent df-load__row-load">Load</button>`,
  }).trim();
  const item = tmp.content.firstElementChild;

  item.querySelector('.df-load__row-load').addEventListener('click', async () => {
    if (await tctx.modules.persistence.loadNamedSave(save.key)) {
      tagActiveBrowserSave(save.name);   // light up the Save Manager "In Browser" chip on the loaded tab
      hideLoadModal();
    }
  });
  return item;
}

/** The "expires in N days" chip text for a browser save (kept on the unified Load row, item #2). */
function expiryLabel(save) {
  const daysLeft = Math.ceil(save.expiresIn / (24 * 60 * 60 * 1000));
  return `expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
}
/** Short diagram-type label for a row icon's tooltip (shared by the Load rows). */
function typeLabelFor(type) { return (tctx.modules.tabs.DIAGRAM_TYPES?.[type]?.short) || 'Architecture'; }

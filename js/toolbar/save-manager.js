// Save & Export manager (CLEANUP S4) — the quick Save modal + the full Save Manager (browser saves, Drive copies, export selection) + uniqueSaveName/wireSelectAll. Reads tctx.modules inside function bodies. load-manager imports showSaveManagerModal (slice->slice).
import { exportObjectSchemaCsv } from '../data-export.js?v=1.21.7';
import { buildModal, showError, showToast } from '../feedback.js?v=1.21.7';
import { driveChipsHtml, groupSelectHtml, setTriStateCheckbox, shareChipIconHtml, storageRowHtml, tabRowChipsHtml } from '../storage-ui.js?v=1.21.7';
import { countDiagramShapes, escHtml, formatRelativeTime, getDiagramTypeIcon, isViewForkTab, tabInGroup } from '../util.js?v=1.21.7';
import { btn, tctx } from './context.js?v=1.21.7';

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

export function showSaveModal() {
  // Remove existing save modal if any
  document.querySelector('.df-save-modal')?.remove();

  const allTabs = tctx.modules.tabs.getAllTabs();
  // ISO-style YYYY-MM-DD suffix (e.g. "Draft 2026-05-30") — readable, and
  // matches the export filename date format. uniqueSaveName's strip/regex logic
  // treats the hyphens literally, so it stays collision-safe.
  const dateSuffix = tctx.modules.persistence.dateSuffix();

  // Collect existing save names to avoid duplicates
  const existingSaves = new Set(tctx.modules.persistence.getNamedSaves().map(s => s.name));

  const saveTypeLabel = (type) => (tctx.modules.tabs.DIAGRAM_TYPES?.[type]?.short) || 'Architecture';
  const groupById = new Map((tctx.modules.tabs.getGroups?.() || []).map(g => [g.id, g]));
  const tabRows = allTabs.map(tab => {
    const defaultName = uniqueSaveName(tab.name, dateSuffix, existingSaves);
    existingSaves.add(defaultName);   // so two same-named tabs don't both default to one name (would clobber)
    const rel = formatRelativeTime(tab.lastModifiedAt || tab.lastSavedAt);
    const groupBadge = tctx.modules.tabs.groupBadgeHtml?.(tab.groupId ? groupById.get(tab.groupId) : null) || '';
    return `
      <div class="df-modal__row${tab.isActive ? ' df-modal__row--active' : ''}">
        <input type="checkbox" class="df-modal__row-check" data-tab-id="${tab.id}" ${tab.isActive ? 'checked' : ''}>
        <span class="df-modal__row-icon">${getDiagramTypeIcon(tab.diagramType)}</span>
        <div class="df-modal__row-info df-save-modal__row-info">
          <input type="text" class="df-modal__row-name" data-tab-id="${tab.id}" value="${escHtml(defaultName)}" spellcheck="false">
          ${rel ? `<span class="df-modal__row-meta">Modified ${rel}</span>` : ''}
        </div>
        ${groupBadge}
        <span class="df-modal__row-badge">${escHtml(saveTypeLabel(tab.diagramType))}</span>
      </div>`;
  }).join('');

  const { overlay, body: bodyEl, footer, close } = buildModal({
    title: 'Save open diagrams',
    className: 'df-save-modal',
    dialogClass: 'df-save-modal__dialog', // 520px
    bodyClass: 'df-modal__row-list',
    bodyHtml: `
      <p class="df-modal__advisory">Browsers may periodically clear this list. For permanent storage, <button type="button" class="df-modal__advisory-link">back up to JSON</button> from Save &amp; Export.</p>
      <div class="df-modal__list-box">
        <div class="df-modal__list-header">
          <label class="df-modal__select-all"><input type="checkbox" class="df-modal__check-all"> Select all</label>
          ${groupSelectHtml(tctx.modules.tabs.getGroups?.() || [])}
        </div>
        ${tabRows}
      </div>`,
    footerHtml: '<button class="df-modal__btn df-modal__btn--primary df-modal__action-btn" style="margin-left:auto">Save Selected</button>',
  });

  // Advisory CTA — close this overlay, then open Save & Export (where the full-backup affordance now lives).
  bodyEl.querySelector('.df-modal__advisory-link')?.addEventListener('click', () => {
    close();
    showSaveManagerModal();
  });

  const updateSelectAll = wireSelectAll(bodyEl, footer, '.df-modal__row-check', () => {
    const selected = [];
    overlay.querySelectorAll('.df-modal__row-check:checked').forEach(c => {
      const tabId = c.dataset.tabId;
      const nameInput = overlay.querySelector(`.df-modal__row-name[data-tab-id="${tabId}"]`);
      selected.push({ tabId, name: nameInput?.value.trim() || tabId });
    });
    if (selected.length === 0) return;

    // Save each tab individually with its custom name. `writtenThisBatch` guards against two rows resolving to
    // the same name (e.g. the user typed identical names, or two same-named tabs) — the second would otherwise
    // overwrite the first's localStorage key. On collision, uniquify the later one so both diagrams persist.
    const saved = [];
    const writtenThisBatch = new Set();
    for (const { tabId, name: rawName } of selected) {
      const graphJSON = tctx.modules.tabs.getTabGraphJSON(tabId);
      const viewport = tctx.modules.tabs.getTabViewport(tabId);
      const diagramType = tctx.modules.tabs.getTabDiagramType(tabId);
      if (!graphJSON) continue;

      const name = writtenThisBatch.has(rawName) ? uniqueSaveName(rawName, dateSuffix, writtenThisBatch) : rawName;
      const key = 'sfdiag::save::' + name;
      const data = {
        name,
        timestamp: Date.now(),
        version: 1,
        appVersion: tctx.modules.persistence.APP_VERSION,
        diagramType,
        graph: graphJSON,
        viewport,
      };
      try {
        localStorage.setItem(key, JSON.stringify(data));
        writtenThisBatch.add(name);
        saved.push({ id: tabId, name });
      } catch (err) {
        showError(`Save failed for "${name}": ${err.message}`);
      }
    }

    // Rename the active tab to its save name (legacy behaviour), then stamp browserSaveName + clear dirty on
    // EVERY saved tab — so their Save Manager "In Browser" chips light up and no inactive tab is left dirty.
    // Use the FINAL written names (post-uniquify), not the raw selection, so the rename/chip match disk.
    const activeTab = allTabs.find(t => t.isActive);
    const activeSaved = saved.find(s => s.id === activeTab?.id);
    if (activeTab && activeSaved?.name) tctx.modules.tabs.renameActiveTab(activeSaved.name);
    tctx.modules.tabs.markTabsBrowserSaved(saved);

    close();
  });

  // "Select Tab Group" — REPLACES the selection with exactly the chosen group's tabs (or Ungrouped).
  const groupSel = bodyEl.querySelector('.df-group-select');
  if (groupSel) {
    const tabGroup = new Map(allTabs.map(t => [t.id, t.groupId || null]));
    groupSel.addEventListener('change', () => {
      const chosen = groupSel.value;
      if (chosen) bodyEl.querySelectorAll('.df-modal__row-check').forEach((cb) => { cb.checked = tabInGroup(tabGroup.get(cb.dataset.tabId), chosen); });
      groupSel.value = '';
      updateSelectAll();
    });
  }
}

export function showSaveManagerModal() {
  const p = tctx.modules.persistence;
  // Opening Save & Export commits the active tab first — the same save a tab switch triggers — so the rows,
  // shape counts, "Edited" times and My Drive chips reflect the latest edits (and pending Drive work is flushed).
  // The returned promise resolves once that Drive flush actually writes/creates the file, so the chips can refresh.
  const committed = tctx.modules.tabs.commitActiveTab?.();
  document.querySelector('.df-save-manager-modal')?.remove();
  const driveOn = !!p.isDriveConfigured?.();

  const groupById = new Map((tctx.modules.tabs.getGroups?.() || []).map(g => [g.id, g]));
  const typeLabel = (type) => (tctx.modules.tabs.DIAGRAM_TYPES?.[type]?.short) || 'Architecture';
  // Nodes-only count (links carry source+target; elements don't) → "0 shapes" means a genuinely empty canvas.
  const nodeCount = (id) => countDiagramShapes(tctx.modules.tabs.getTabGraphJSON(id)?.cells);

  // Always hide empty (0-shape) diagrams — they're noise on a save surface.
  const tabs = tctx.modules.tabs.getAllTabs().map(t => ({ ...t, shapes: nodeCount(t.id) })).filter(t => t.shapes > 0);

  // Storage chips per row — shared driveChipsHtml so the Save Manager + Load Manager read identically. "This
  // browser" is ALWAYS on for an open diagram (auto-kept in the SESSION; not the named Browser Storage shelf,
  // which is written only on close/explicit save). My Drive lights from the LOCAL driveFileId; an async reconcile
  // pass (below) downgrades a stale link so the chip never claims a save that isn't there.
  const tabRows = tabs.map(t => {
    // A tab opened from someone else's Shared File carries driveSharedSource. Surface the access level as a pill
    // (item 3.2 - parity with Load -> Drive) and a Clone action (item 3.3 - fork your own My Drive copy).
    const src = t.driveSharedSource;
    // Mode C: a VIEW FORK is the user's own file - no Clone (it's already your own copy; the sharedSource is only a
    // refresh pointer). An un-forked shared file / Collab working copy keeps it. (The Copy/Collab pill itself is
    // rendered inside tabRowChipsHtml now - one derivation shared with Load + Close.)
    const shareable = src && src.fileId && !isViewForkTab(t);
    const groupBadge = (tctx.modules.tabs.groupBadgeHtml?.(t.groupId ? groupById.get(t.groupId) : null) || '');
    const rel = formatRelativeTime(t.lastModifiedAt || t.lastSavedAt);
    const exportBtn = `<button class="df-modal__btn df-modal__btn--accent df-save-mgr__export" data-id="${escHtml(t.id)}" title="Export this diagram">Export</button>`;
    const cloneBtn = shareable
      ? `<button class="df-modal__btn df-modal__btn--amber-outline df-save-mgr__clone" data-fileid="${escHtml(src.fileId)}" data-name="${escHtml(t.name)}" title="Save your own copy in My Drive (forks this shared file - your fork is independent)">Clone</button>`
      : '';
    return storageRowHtml({
      active: t.isActive,
      checkbox: `<input type="checkbox" class="df-modal__row-check" data-id="${escHtml(t.id)}" ${t.isActive ? 'checked' : ''}>`,
      diagramType: t.diagramType, typeTitle: typeLabel(t.diagramType), name: t.name,
      groupBadge, count: t.shapes,
      metaLeft: tabRowChipsHtml(t, { driveOn }),   // shared: chips + Copy/Collab pill (one derivation with Load + Close)
      metaRight: rel ? `Edited ${rel}` : '',
      trailing: cloneBtn ? `<div class="df-drive-library__actions">${cloneBtn}${exportBtn}</div>` : exportBtn,
    });
  }).join('');

  const listInner = tabs.length
    ? `<div class="df-modal__list-header"><label class="df-modal__select-all"><input type="checkbox" class="df-modal__check-all"> Select all</label>${groupSelectHtml(tctx.modules.tabs.getGroups?.() || [])}</div>${tabRows}`
    : '<p class="df-modal__empty">No diagrams to save yet - add some shapes to a diagram first.</p>';

  // Browser is automatic, so the footer holds only the manual Drive destinations. "Add to Shared Drive" is a
  // blue-wireframe secondary on the LEFT, shown only once Drive is CONNECTED. The primary save reads "Save to My
  // Drive" once connected (you're in, saving to your My Drive) vs "Save to Google Drive" (with the Drive glyph)
  // before connecting (it signs you in first).
  const connected = !!p.isDriveConnected?.();
  const autoSync = connected && !!p.isAutosyncOn?.();   // when on, My Drive saves happen automatically (no button needed)
  const GDRIVE_GLYPH = '<svg class="df-toolbar__icon" aria-hidden="true"><use href="#icon-gdrive"></use></svg>';
  const saveBtnLabel = connected
    ? `${GDRIVE_GLYPH}Save to My Drive`
    : `${GDRIVE_GLYPH}Save to Google Drive`;
  // Footer: LEFT = the blue-WIRE Google Drive actions; RIGHT = "Export Selected", the orange-FILL primary.
  // "Save to My Drive" is HIDDEN when auto-sync is on (Drive saving is automatic then); shown when auto-sync is
  // off / before connecting. "Add to Shared Drive" only when connected. The checkboxes drive them all.
  // (The old "Make offline" button was removed: open tabs already auto-save to the browser session + auto-archive
  // on close, and a Drive-evicted copy is recovered by reopening it from Load & Import → Google Drive.)
  const footerHtml = `
      ${driveOn && !autoSync ? `<button class="df-modal__btn df-save-mgr__drivebtn df-drive-save__save" disabled>${saveBtnLabel}</button>` : ''}
      ${driveOn && connected ? '<button class="df-modal__btn df-modal__btn--amber-outline df-save-mgr__shared" disabled><svg class="df-toolbar__icon" aria-hidden="true"><use href="#icon-gdrive"></use></svg>Add to Shared Drive</button>' : ''}
      <button class="df-modal__btn df-modal__btn--accent df-save-mgr__export-sel" style="margin-left:auto" disabled>Export Selected</button>`;

  // Pre-save check (NBA #3, refocused): the explicit-save hub is the ONE right place to surface loose
  // connectors (links not attached at both ends) - never on background autosync. Non-blocking: a banner with
  // a "Review on canvas" action that highlights them; saving still works (loose ends may be intentional WIP).
  const looseCount = (tctx.modules.canvas?.findLooseConnectors?.() || []).length;
  const ALERT_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.8l6.5 11.4H1.5L8 1.8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6.4v3.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.4" r="0.9" fill="currentColor"/></svg>';
  const looseBanner = looseCount ? `
      <div class="df-save-mgr__loose" role="alert">
        <span class="df-save-mgr__loose-icon">${ALERT_SVG}</span>
        <span class="df-save-mgr__loose-text">${looseCount} connector${looseCount === 1 ? " isn't" : "s aren't"} attached at both ends in this diagram.</span>
        <button class="df-modal__btn df-modal__btn--amber-outline df-save-mgr__loose-review">Review on canvas</button>
      </div>` : '';

  const { overlay, footer, close } = buildModal({
    title: 'Save & Export',
    className: 'df-save-manager-modal',
    origin: document.getElementById('btn-save'),   // scale-open from the Save button
    anchor: document.getElementById('btn-save'),   // anchored under the Save button (item 5)
    dialogClass: 'df-save-mgr__dialog', // 600px (wider — room for the per-row Export action)
    bodyClass: 'df-modal__row-list',
    footerClass: 'df-save-mgr__footer',
    bodyHtml: `${looseBanner}
      <p class="df-drive-save-modal__hint">Every open diagram is auto-saved to this browser${driveOn && autoSync ? ' and your <strong>Google Drive</strong>' : ''}.${driveOn ? (connected ? ` ${autoSync ? 'Add any to a team <strong>Shared Drive</strong>' : 'Save any to your <strong>Google Drive</strong> or a <strong>Shared Drive</strong>'}, or export a diagram from its row.` : ' Save any to your <strong>Google Drive</strong>, or export a diagram from its row.') : ' Export a diagram from its row.'}</p>
      <div class="df-modal__advisory df-save-mgr__backup">
        <span class="df-save-mgr__backup-text"></span>
        <button class="df-modal__btn df-save-mgr__backup-now">Back up now</button>
      </div>
      <div class="df-modal__list-box">${listInner}</div>`,
    footerHtml,
  });

  // "Review on canvas" — close the manager, highlight the loose connectors and frame them in view.
  overlay.querySelector('.df-save-mgr__loose-review')?.addEventListener('click', () => {
    close();
    const n = tctx.modules.canvas?.highlightLooseConnectors?.() || 0;
    if (n) showToast(`${n} loose connector${n === 1 ? '' : 's'} highlighted - reconnect or delete ${n === 1 ? 'it' : 'them'}.`, 'info');
  });

  // Full-backup affordance (moved here from the retired Export-to-JSON overlay). "Back up now" exports EVERYTHING
  // (open tabs + browser saves + templates) into one JSON FILE downloaded to this device, and resets the
  // backup-reminder clock. The advisory is explicit that this is a downloaded JSON file SEPARATE from Google
  // Drive sync - otherwise a Drive-synced user is puzzled why it says "no backup" while their work is in Drive.
  const fmtBackupAdvisory = () => {
    const lb = tctx.modules.persistence.getLastBackupAt();
    return lb
      ? `Last JSON backup to this device: ${new Date(lb).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}.`
      : 'No JSON backup yet. Back up now saves everything as one JSON file on this device, separate from Drive sync.';
  };
  const backupText = overlay.querySelector('.df-save-mgr__backup-text');
  if (backupText) backupText.textContent = fmtBackupAdvisory(); // textContent — safe
  const backupNowBtn = overlay.querySelector('.df-save-mgr__backup-now');
  let backupRevertTimer = null;
  backupNowBtn?.addEventListener('click', () => {
    if (!tctx.modules.persistence.exportEverything()) return;
    if (backupText) backupText.textContent = fmtBackupAdvisory();
    backupNowBtn.classList.add('is-backed');
    backupNowBtn.textContent = '✓ Backed up!';
    clearTimeout(backupRevertTimer);
    backupRevertTimer = setTimeout(() => {
      backupNowBtn.classList.remove('is-backed');
      backupNowBtn.textContent = 'Back up now';
    }, 2000);
  });

  const checks = () => [...overlay.querySelectorAll('.df-modal__row-check')];
  const selectedIds = () => checks().filter(c => c.checked).map(c => c.dataset.id);
  const btnSave = footer?.querySelector('.df-drive-save__save');
  const btnShared = footer?.querySelector('.df-save-mgr__shared');
  const btnExportSel = footer?.querySelector('.df-save-mgr__export-sel');
  const actionBtns = [btnSave, btnShared, btnExportSel].filter(Boolean);
  const checkAll = overlay.querySelector('.df-modal__check-all');
  const refresh = () => {
    const cs = checks();
    const checked = cs.filter(c => c.checked).length;
    setTriStateCheckbox(checkAll, checked, cs.length);   // tri-state, incl. the initial pass (no-op if checkAll absent)
    actionBtns.forEach(b => { b.disabled = checked === 0; });
  };
  checkAll?.addEventListener('change', (e) => { checks().forEach(c => { c.checked = e.target.checked; }); refresh(); });
  checks().forEach(c => c.addEventListener('change', refresh));
  // "Select Tab Group" — REPLACES the selection: checks ONLY the rows whose tab is in the chosen group (or
  // Ungrouped) and unchecks everything else, so picking a group is "select exactly this group".
  const groupSel = overlay.querySelector('.df-group-select');
  if (groupSel) {
    const tabGroup = new Map(tabs.map((t) => [t.id, t.groupId || null]));
    groupSel.addEventListener('change', () => {
      const chosen = groupSel.value;
      if (chosen) checks().forEach((cb) => { cb.checked = tabInGroup(tabGroup.get(cb.dataset.id), chosen); });
      groupSel.value = '';
      refresh();
    });
  }
  refresh();

  // My Drive chip honesty: the chip renders synchronously from the LOCAL driveFileId so the modal opens
  // instantly, but that pointer can be stale (file trashed, or a link from a prior OAuth grant) OR not yet set
  // (the active tab's file is being created right now by commitActiveTab's flush). Re-read the live tabs and
  // re-render each row's My Drive chip whenever async Drive work settles, so the chip never lags an open.
  const refreshMyDriveChips = () => {
    const live = new Map((tctx.modules.tabs.getAllTabs?.() || []).map((t) => [t.id, t]));
    overlay.querySelectorAll('.df-modal__row-check').forEach((cb) => {
      const t = live.get(cb.dataset.id);
      const chipEl = cb.closest('.df-srow')?.querySelector('.df-save-mgr__chip--mydrive');
      if (!t || !chipEl) return;
      if (t.driveDriveId && !t.driveHasMyDriveBackup) {
        // The reconcile just HEALED this tab to a Shared-Drive file with no My-Drive backup yet (item 5): repurpose
        // the My-Drive slot as the "Shared Drive" chip in place, so the OPEN Save Manager flips on the same pass.
        // (Once a backup exists the full render shows a real "My Drive" + a separate "Shared Drive" chip.)
        chipEl.classList.remove('df-save-mgr__chip--mydrive');
        chipEl.classList.add('df-save-mgr__chip--shared', 'is-on');
        chipEl.title = 'Lives on a team Shared Drive - everyone with access edits the same file (edits flow both ways)';
        chipEl.innerHTML = shareChipIconHtml('both') + 'Shared Drive';
        return;
      }
      // My Drive on for an own master OR a Shared-Drive file mirrored into My Drive (the backup).
      const on = (!!t.driveFileId && !t.driveDriveId) || !!t.driveHasMyDriveBackup;
      chipEl.classList.toggle('is-on', on);
      chipEl.title = on ? 'Saved as a file you own in My Drive' : 'Not saved to My Drive yet';
      chipEl.innerHTML = (on ? DRIVE_CHIP_CHECK : '') + 'My Drive';
    });
  };
  if (driveOn && connected) {
    // (a) The active tab's commit-on-open flush may CREATE/update its file after the rows rendered → refresh once
    //     it settles so its "My Drive" chip turns on immediately (the "grey on first open, green on second" lag).
    if (committed && typeof committed.then === 'function') committed.then(refreshMyDriveChips).catch(() => {});
    // (b) reconcile against the live library: ADOPT same-named files for null/stale pointers + downgrade rows the
    //     user no longer owns, so a ✓ My Drive always matches "Your Google Drive Diagrams".
    if (p.reconcileTabDriveLinks) p.reconcileTabDriveLinks().then(refreshMyDriveChips).catch(() => { /* offline → keep optimistic chips */ });
  }

  // Save to Drive — each selected becomes a master file in My Drive.
  btnSave?.addEventListener('click', async () => {
    const ids = selectedIds(); if (!ids.length) return;
    btnSave.disabled = true; btnSave.textContent = 'Saving…';
    try {
      const results = await p.saveTabsToDrive(ids);
      const ok = results.filter(r => r.status === 'ok').length;
      const failed = results.filter(r => r.status === 'error');
      if (ok) showToast(`Saved ${ok} diagram${ok === 1 ? '' : 's'} to Google Drive ✓`, 'success');
      if (failed.length) { console.error('Diagramforce: Drive save failures:', failed); showError(`${failed.length} diagram${failed.length === 1 ? '' : 's'} could not be saved - see console.`); }
      close();
    } catch (e) { btnSave.disabled = false; btnSave.innerHTML = saveBtnLabel; showError('Could not save to Google Drive: ' + (e.message || 'unknown error')); }
  });

  // Add to Shared Drive — pick ONE folder, publish a copy of each selected diagram into it. (Icon + label, so
  // we disable rather than swap text, to avoid wiping the inline Drive icon.)
  btnShared?.addEventListener('click', async () => {
    const ids = selectedIds(); if (!ids.length) return;
    btnShared.disabled = true;
    try { if (await p.publishTabsToSharedDrive?.(ids)) close(); else btnShared.disabled = false; }
    catch (e) { btnShared.disabled = false; showError('Could not add to Shared Drive: ' + (e.message || 'unknown error')); }
  });

  // Export Selected — the checked diagrams as JSON (1 → single file, 2+ → a `diagramforce-export` bundle). Same
  // checkboxes that drive the Drive actions, so one selection serves every destination.
  btnExportSel?.addEventListener('click', () => {
    const ids = selectedIds(); if (!ids.length) return;
    const selTabs = ids.map((id) => tabs.find((t) => t.id === id)).filter(Boolean);
    openSelectedExportMenu(btnExportSel, selTabs);   // item 13: same format menu as a single Export
  });

  // (The "templates & backups" link to the Export Manager was removed from the Save Manager hint - it opened a
  // near-identical overlay; the Export Manager stays reachable from the Load Manager's Browser tab advisory.)

  // Per-row Export — a popover listing the formats directly (image formats inline, no separate overlay). JSON
  // exports from the stored graph (any tab); image + CSV need the live canvas, so they switch to that tab first
  // (closing the manager). While a flow animates on the active diagram, only GIF captures it (static formats are
  // hidden, mirroring the old image overlay); a GIF mid-encode hides the image formats entirely.
  const openRowExportMenu = (anchor, t) => {
    document.querySelector('.df-rowexport-pop')?.remove();
    const isData = t.diagramType === 'datamodel' || t.diagramType === 'datamapping';
    const animating = t.isActive && !!document.getElementById('paper')?.classList.contains('df-animate-flow');
    const gifBusy = !!p.isGifEncodingInProgress?.();
    const imageFmts = gifBusy ? []
      : animating
        ? [['gif', 'GIF'], ['gif-t', 'GIF (transparent)']]
        : [['png', 'PNG'], ['png-t', 'PNG (transparent)'], ['webp', 'WEBP'], ['webp-t', 'WEBP (transparent)'], ['svg', 'SVG'], ['svg-t', 'SVG (transparent)']];
    // Format glyph: a rounded rect with the format token inside ({ } for JSON, CSV, PNG/WEBP/SVG/GIF). Filled for
    // opaque outputs; a wire (transparent-fill) rect for the "(transparent)" variants - mirroring the output.
    const fmtGlyph = (fmt) => {
      const wire = fmt.endsWith('-t');
      const txt = fmt === 'json' ? '{ }' : fmt === 'csv' ? 'CSV' : fmt.replace('-t', '').toUpperCase();
      return `<span class="df-fmt-glyph${wire ? ' df-fmt-glyph--wire' : ''}" aria-hidden="true">${txt}</span>`;
    };
    const item = (fmt, label) => `<button class="df-tab-pop__item df-tab-pop__item--fmt" data-fmt="${fmt}">${fmtGlyph(fmt)}<span>Export as ${label}</span></button>`;
    const pop = document.createElement('div');
    pop.className = 'df-tab-pop df-tab-pop--menu df-rowexport-pop';
    pop.innerHTML =
      item('json', 'JSON')
      + (isData ? item('csv', 'CSV') : '')   // CSV sits right below JSON (both data/text formats)
      + (imageFmts.length ? '<div class="df-tab-pop__sep"></div>' + imageFmts.map(([f, l]) => item(f, l)).join('') : '');
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + 'px';
    pop.style.top = Math.max(8, Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 4)) + 'px';   // clamp tall menu into view
    const closePop = () => { pop.remove(); document.removeEventListener('pointerdown', onDoc, true); };
    const onDoc = (e) => { if (!pop.contains(e.target)) closePop(); };
    setTimeout(() => document.addEventListener('pointerdown', onDoc, true), 0);
    const toTabThen = (fn) => { closePop(); close(); if (!t.isActive) tctx.modules.tabs.switchTab?.(t.id); requestAnimationFrame(fn); };
    const exportImage = (fmt) => {
      const transparent = fmt.endsWith('-t');
      const base = fmt.replace('-t', '');
      if (base === 'png') p.exportPNG(transparent);
      else if (base === 'webp') p.exportWEBP(transparent);
      else if (base === 'svg') p.exportSVG(transparent);
      else if (base === 'gif') p.exportGIF(transparent);
    };
    pop.querySelectorAll('.df-tab-pop__item').forEach((b) => b.addEventListener('click', () => {
      const fmt = b.dataset.fmt;
      if (fmt === 'json') { closePop(); p.exportSelection({ tabIds: [t.id] }); return; }
      if (fmt === 'csv') { toTabThen(() => { if (t.diagramType === 'datamapping') tctx.modules.tableView?.exportMappingCsv?.(); else exportObjectSchemaCsv(tctx.modules.graph); }); return; }
      toTabThen(() => exportImage(fmt));   // image formats
    }));
  };
  overlay.querySelectorAll('.df-save-mgr__export').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const t = tabs.find((x) => x.id === b.dataset.id);
    if (t) openRowExportMenu(b, t);
  }));

  // Clone a shared file to My Drive from the Save Manager (item 3.3) - same action as the Load -> Drive row's
  // Clone (cloneSharedToMyDrive forks an independent owned copy). Closes the modal on success.
  overlay.querySelectorAll('.df-save-mgr__clone').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    b.disabled = true;
    try { if (await p.cloneSharedToMyDrive?.(b.dataset.fileid, b.dataset.name)) close(); else b.disabled = false; }
    catch { b.disabled = false; }
  }));

  // Export Selected → the SAME format menu as a single row's Export, but applied to every checked diagram (item
  // 13). JSON makes ONE bundle file (exportSelection); CSV + image formats make ONE FILE PER diagram, exported
  // sequentially because each needs its diagram on the live canvas (switch tab → render → export), spaced so the
  // browser doesn't drop the rapid downloads. GIF is omitted here (it's a per-diagram, mid-encode-locked format).
  const fmtGlyphSel = (fmt) => {
    const wire = fmt.endsWith('-t');
    const txt = fmt === 'json' ? '{ }' : fmt === 'csv' ? 'CSV' : fmt.replace('-t', '').toUpperCase();
    return `<span class="df-fmt-glyph${wire ? ' df-fmt-glyph--wire' : ''}" aria-hidden="true">${txt}</span>`;
  };
  const exportSelectedSequential = async (selTabs, fmt) => {
    const isCsv = fmt === 'csv';
    const targets = isCsv ? selTabs.filter((t) => t.diagramType === 'datamodel' || t.diagramType === 'datamapping') : selTabs;
    if (!targets.length) return;
    if (targets.length > 1) showToast(`Exporting ${targets.length} diagrams - allow multiple downloads if your browser asks.`, 'info');
    for (const t of targets) {
      if (!t.isActive) tctx.modules.tabs.switchTab?.(t.id);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));   // let the switched diagram render
      if (isCsv) {
        if (t.diagramType === 'datamapping') tctx.modules.tableView?.exportMappingCsv?.(); else exportObjectSchemaCsv(tctx.modules.graph);
      } else {
        const transparent = fmt.endsWith('-t'); const base = fmt.replace('-t', '');
        if (base === 'png') p.exportPNG(transparent);
        else if (base === 'webp') p.exportWEBP(transparent);
        else if (base === 'svg') p.exportSVG(transparent);
      }
      await new Promise((res) => setTimeout(res, 350));   // space downloads so the browser keeps them all
    }
  };
  const openSelectedExportMenu = (anchor, selTabs) => {
    if (!selTabs.length) return;
    document.querySelector('.df-rowexport-pop')?.remove();
    const anyData = selTabs.some((t) => t.diagramType === 'datamodel' || t.diagramType === 'datamapping');
    const imageFmts = [['png', 'PNG'], ['png-t', 'PNG (transparent)'], ['webp', 'WEBP'], ['webp-t', 'WEBP (transparent)'], ['svg', 'SVG'], ['svg-t', 'SVG (transparent)']];
    const item = (fmt, label) => `<button class="df-tab-pop__item df-tab-pop__item--fmt" data-fmt="${fmt}">${fmtGlyphSel(fmt)}<span>Export as ${label}</span></button>`;
    const pop = document.createElement('div');
    pop.className = 'df-tab-pop df-tab-pop--menu df-rowexport-pop';
    pop.innerHTML = item('json', 'JSON') + (anyData ? item('csv', 'CSV') : '') + '<div class="df-tab-pop__sep"></div>' + imageFmts.map(([f, l]) => item(f, l)).join('');
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
    pop.style.top = Math.max(8, r.top - pop.offsetHeight - 4) + 'px';   // open ABOVE the footer button
    const closePop = () => { pop.remove(); document.removeEventListener('pointerdown', onDoc, true); };
    const onDoc = (e) => { if (!pop.contains(e.target)) closePop(); };
    setTimeout(() => document.addEventListener('pointerdown', onDoc, true), 0);
    pop.querySelectorAll('.df-tab-pop__item').forEach((b) => b.addEventListener('click', () => {
      const fmt = b.dataset.fmt;
      closePop();
      if (fmt === 'json') { p.exportSelection({ tabIds: selTabs.map((t) => t.id) }); close(); return; }
      close();
      exportSelectedSequential(selTabs, fmt);
    }));
  };
}

function wireSelectAll(bodyEl, footerEl, checkSelector, onAction) {
  const checkAll = bodyEl.querySelector('.df-modal__check-all') || footerEl.querySelector('.df-modal__check-all');
  const actionBtn = footerEl.querySelector('.df-modal__action-btn');

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
  return update;   // let callers re-sync after programmatically checking rows (e.g. "Select all in group")
}

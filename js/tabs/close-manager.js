// Close & Delete manager (CLEANUP S5 slice 2) — the browser-storage hub modal (open tabs + archives,
// storage gauge, per-tab Drive chips, bulk close/delete) + the single-tab close-confirm + multi-discard
// dialogs. Reads tabs/persistence from tbctx and reaches close/archive mechanics + group rendering
// (doCloseTab/deleteBrowserArchive/forgetBrowserSaveName/getGroup/getGroups/getTabGraphJSON/groupBadgeHtml)
// via tbctx forward-refs at CALL time; never imports the facade back.

import { tbctx } from './context.js?v=1.21.7';
import { DIAGRAM_TYPES } from './diagram-types.js?v=1.21.7';
import { buildModal, confirmModal, showToast } from '../feedback.js?v=1.21.7';
import { bindSplitHeads, driveChipsHtml, groupSelectHtml, refreshSplitTableCounts, setTriStateCheckbox, splitTableHtml, storageRowHtml, tabRowChipsHtml } from '../storage-ui.js?v=1.21.7';
import { countDiagramShapes, escHtml, formatBytes, formatRelativeTime, gaugeLevel, tabInGroup } from '../util.js?v=1.21.7';

export function showCloseConfirmModal(tabId, tabName) {
  const { tabs } = tbctx;
  const { persistence: persistenceModule } = tbctx.modules;
  const { deleteBrowserArchive, doCloseTab } = tbctx;
  document.querySelector('.df-close-confirm-modal')?.remove();
  const tab = tabs.find(t => t.id === tabId);
  const hasDrive = !!tab?.driveFileId;
  const hasArchive = !!tab?.browserSaveName;
  const hasSavedCopy = hasDrive || hasArchive;
  // Where the durable copy lives — used both in the body copy and the Delete tooltip so the user knows exactly
  // what "Delete diagram" removes.
  const savedWhere = hasDrive && hasArchive ? 'Google Drive and Browser Storage'
    : hasDrive ? 'Google Drive' : 'Browser Storage';

  // Two distinct "don't keep the edits" outcomes once a saved copy exists (C6 fuller):
  //   • Discard changes — close, drop the unsaved edits, but KEEP the saved copy untouched.
  //   • Delete diagram  — remove the saved copy (Drive trash + browser archive) as well, then close.
  // For an unsaved-only diagram there's nothing saved to keep or delete, so it collapses to a single Discard.
  const bodyHtml = hasSavedCopy
    ? `<p style="margin:0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">
        <strong style="color:var(--text-primary)">${escHtml(tabName)}</strong> has unsaved changes.</p>
       <p style="margin:8px 0 0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">
        <strong style="color:var(--text-primary)">Discard</strong> drops these changes and keeps the last saved version in
        <strong style="color:var(--text-primary)">${savedWhere}</strong>.<br>
        <strong style="color:var(--text-primary)">Delete</strong> removes that saved copy too.</p>`
    : `<p style="margin:0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">
        <strong style="color:var(--text-primary)">${escHtml(tabName)}</strong> has unsaved changes that will be lost.</p>`;

  // Button order (saved-copy case): Cancel (far left) · Delete diagram · Discard and Close · Save and Close.
  // Discard sits between the destructive Delete and the safe Save so the escalation reads left→right.
  // Canonical .df-modal__btn buttons (C2); data-action decouples the JS hooks from the styling classes.
  const footerHtml = hasSavedCopy
    ? `<button class="df-modal__btn" data-action="cancel" style="margin-right:auto">Cancel</button>
      <button class="df-modal__btn df-modal__btn--danger-outline" data-action="delete" title="Drop the changes AND remove the saved copy from ${savedWhere}, then close">Delete</button>
      <button class="df-modal__btn df-modal__btn--discard" data-action="discard" title="Drop the unsaved changes but keep the last saved version">Discard</button>
      <button class="df-modal__btn df-modal__btn--primary" data-action="save">Save</button>`
    : `<button class="df-modal__btn" data-action="cancel" style="margin-right:auto">Cancel</button>
      <button class="df-modal__btn df-modal__btn--discard" data-action="discard" title="Drop the unsaved changes and close">Discard</button>
      <button class="df-modal__btn df-modal__btn--primary" data-action="save">Save</button>`;

  const { footer, close } = buildModal({
    title: 'Unsaved Changes',
    className: 'df-close-confirm-modal',
    zIndex: 3000,
    // Wider when the 4th (Delete diagram) button is present so the row never cramps; the footer also wraps /
    // stacks on phones (css/modals.css).
    width: hasSavedCopy ? '560px' : '400px',
    showClose: false, // decision dialog — dismiss via Cancel / backdrop / Escape
    bodyStyle: 'padding:var(--spacing-md) var(--spacing-lg)',
    bodyHtml,
    footerHtml,
  });

  footer.querySelector('[data-action="cancel"]').addEventListener('click', close);

  // Discard changes — drop the in-memory edits and close, KEEPING the saved copy (Drive file + browser archive
  // untouched). archive:false so the edited state is NOT written over the existing archive. For an unsaved-only
  // diagram this simply drops the work (there was no saved copy).
  footer.querySelector('[data-action="discard"]').addEventListener('click', () => {
    close();
    const t = tabs.find(x => x.id === tabId);
    if (t) t.dirty = false;   // already confirmed → skip the dirty re-check on close
    doCloseTab(tabId, { archive: false });
  });

  // Delete diagram — remove the saved copy (Drive trash + browser archive go-together), then close. Only present
  // when a saved copy exists (the dialog itself is the confirm; Drive deletes go to the recoverable Drive trash).
  // A FAILED Drive delete (signed out → blocked/cancelled sign-in popup, network) must NOT close the tab: the tab
  // is the user's in-app handle on that Drive file - closing it strands the file in Drive with no Diagramforce
  // context to find and delete it (CR, prod). Keep the tab AND its browser archive so they can sign in and retry.
  footer.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    close();
    const t = tabs.find(x => x.id === tabId);
    if (t?.driveFileId) {
      const deleted = await persistenceModule.deleteDiagramFromDrive?.(t.driveFileId);
      if (!deleted) { showToast('Nothing was deleted - the tab stays open. Sign in to Google Drive and try again.', 'info'); return; }
    }
    if (t) {
      if (t.browserSaveName) deleteBrowserArchive(t.browserSaveName);
      t.dirty = false;
    }
    doCloseTab(tabId, { archive: false });
  });

  footer.querySelector('[data-action="save"]').addEventListener('click', () => {
    close();
    const t = tabs.find(x => x.id === tabId);
    if (t) t.dirty = false;   // user chose to keep it → not a discard
    // Save = keep the work: doCloseTab auto-archives it to Browser Storage (the item-8 model), then closes.
    doCloseTab(tabId);
  });
}

// Storage-pressure gauge for the Close & Delete overlay (mirrors the Load & Import one; reuses the
// .df-load-gauge CSS). Built from the persistence footprint helpers so you can watch the store empty as you
// prune. tabs.js has `persistence` but not `toolbar`, so this is a small local mirror of storagePressureHtml.
function storageGaugeHtml() {
  const { persistence: persistenceModule } = tbctx.modules;
  let used = 0;
  try { used = persistenceModule.getStorageFootprint?.() || 0; } catch { return ''; }
  if (!(used > 0)) return '';
  const warn = persistenceModule.STORAGE_WARNING_BYTES || 4_000_000;
  const level = gaugeLevel(used, warn);
  const pct = Math.min(100, Math.round((used / warn) * 100));
  const hint = level === 'ok' ? ''
    : '<p class="df-load-gauge__hint">Browser storage is filling up - delete saved diagrams to free space.</p>';
  // Itemise the total so it reconciles with the lists below: the session blob (a live copy of every open tab),
  // My Templates and app settings are real bytes the delete rows can't free (CR: "1.9 MB used" vs ~0.5 MB of rows).
  let breakdown = '';
  try {
    const bd = persistenceModule.getStorageBreakdown?.();
    if (bd) breakdown = `<div class="df-load-gauge__caption" style="font-size:var(--font-size-xs);color:var(--text-muted)"><span>Diagrams ${escHtml(formatBytes(bd.diagrams))} · My Templates ${escHtml(formatBytes(bd.templates))} · App data ${escHtml(formatBytes(bd.app))}</span></div>`;
  } catch { /* gauge stays total-only */ }
  return `<div class="df-load-gauge df-load-gauge--${level}" style="margin:0 0 var(--spacing-md)">
      <div class="df-load-gauge__caption"><span>Browser storage</span><span>${escHtml((used / 1e6).toFixed(1))} MB used</span></div>
      <div class="df-load-gauge__track"><div class="df-load-gauge__fill" style="width:${pct}%"></div></div>
      ${breakdown}
      ${hint}
    </div>`;
}

// The single hub for deleting browser-stored diagrams: OPEN tabs (close + optional delete) AND CLOSED archives
// (delete-only). Shows the storage gauge + per-diagram weight so you can free space deliberately.
export function showCloseTabsModal() {
  const { tabs } = tbctx;
  const { persistence: persistenceModule } = tbctx.modules;
  const { deleteBrowserArchive, forgetBrowserSaveName, getGroup, getGroups, getTabGraphJSON, groupBadgeHtml } = tbctx;
  // Drop any "Closed (in Browser Storage)" archive whose Drive file is currently OPEN as a tab: reopening a Drive-
  // backed closed tab leaves its browser archive behind, so it would otherwise list twice (Open Tabs + Closed) for
  // the same diagram. The archive stays in storage (a backup); it's just hidden here while the diagram is open.
  const openDriveIds = new Set(tabs.map(t => t.driveFileId).filter(Boolean));
  const archives = (persistenceModule.getNamedSaves?.() || []).filter(a => !(a.driveFileId && openDriveIds.has(a.driveFileId)));
  if (tabs.length === 0 && archives.length === 0) return;

  document.querySelector('.df-close-tabs-modal')?.remove();

  // Storage chips + Copy/Collab pill use the SAME shared builders as the Save/Load managers (driveChipsHtml /
  // sharePillHtml in util.js) so Close & Delete reads identically - including the greyed "My Drive (off)" chip for an
  // un-synced tab, which the old hand-rolled chips here used to omit (the inconsistency the user flagged).
  const driveOn = !!persistenceModule.isDriveConfigured?.();

  // OPEN TABS — closable + deletable. Weight (8.4) = serialized graph size.
  const openRowsHtml = tabs.map(t => {
    const typeLabel = DIAGRAM_TYPES[t.diagramType]?.short || 'Architecture';
    const rel = formatRelativeTime(t.lastModifiedAt || t.lastSavedAt);
    const g = t.groupId ? getGroup(t.groupId) : null;
    const graphJSON = getTabGraphJSON(t.id);
    const shapes = countDiagramShapes(graphJSON?.cells);
    const weight = formatBytes(JSON.stringify(graphJSON || {}).length);
    const nameSuffix = t.dirty ? ' <span class="df-close-tabs__dirty" title="Unsaved changes"></span>' : '';
    return storageRowHtml({
      tag: 'label', rowClass: 'df-close-tabs__row', rowAttrs: `data-tab-id="${escHtml(t.id)}"`,
      active: t.id === tbctx.activeTabId,
      checkbox: `<input type="checkbox" class="df-close-tabs__checkbox" data-tab-id="${escHtml(t.id)}" />`,
      diagramType: t.diagramType, typeTitle: typeLabel, name: t.name, nameSuffix,
      groupBadge: groupBadgeHtml(g), count: shapes,
      metaLeft: tabRowChipsHtml(t, { driveOn }),   // shared: chips + Copy/Collab pill from t.driveCopies (one derivation)
      metaRight: `${rel ? `Edited ${rel}` : ''}${weight ? `${rel ? ' · ' : ''}${weight}` : ''}`,
    });
  }).join('');

  // CLOSED ARCHIVES — delete-only (you can't "close" what isn't open). Weight = stored entry size.
  const archiveRowsHtml = archives.map(s => {
    const rel = formatRelativeTime(s.timestamp) || 'just now';
    const weight = formatBytes(s.bytes);
    return storageRowHtml({
      tag: 'label', rowClass: 'df-close-tabs__row', rowAttrs: `data-save-key="${escHtml(s.key)}"`,
      diagramType: s.diagramType, typeTitle: DIAGRAM_TYPES[s.diagramType]?.short || 'Architecture',
      name: s.name, count: s.shapes, groupBadge: '',
      checkbox: `<input type="checkbox" class="df-close-tabs__checkbox" data-save-key="${escHtml(s.key)}" data-save-name="${escHtml(s.name)}" />`,
      metaLeft: tabRowChipsHtml(s, { driveOn }),   // shared: chips + Copy/Collab pill (one derivation)
      metaRight: `Last Modified ${rel}${weight ? ` · ${weight}` : ''}`,   // "Last Modified" = a CLOSED archive (vs "Edited" for live tabs); matches the Load Manager archive rows
    });
  }).join('');

  // Item 3: when BOTH sections exist, render them as two separate bordered, collapsible TABLES (the same split
  // styling as Load -> Drive / Load -> Browser) - each a header band with a chevron + count. With only one section,
  // a single plain box (no redundant header), as before. The Select all + group-pick bar floats above both tables.
  const splitTable = (label, count, rowsHtml) => splitTableHtml({ label, count, rows: rowsHtml });
  const controlsHtml = `<div class="df-modal__list-header df-split-table__controls"><label class="df-modal__select-all"><input type="checkbox" class="df-close-tabs__checkbox" data-role="select-all" /> Select all</label>${groupSelectHtml(getGroups())}</div>`;
  const tablesHtml = (openRowsHtml && archiveRowsHtml)
    ? splitTable('Open tabs', tabs.length, openRowsHtml) + splitTable('Closed (in Browser Storage)', archives.length, archiveRowsHtml)
    : `<div class="df-modal__list-box">${openRowsHtml || archiveRowsHtml}</div>`;
  // "Closed (on Google Drive)" (CR): the user's OWN Drive .dgf files that are NOT open as a tab, listed with
  // Diagramforce context (name/date/provenance) so they can be deleted from HERE instead of guessing in the raw
  // Drive UI. Populated async after the modal opens (listMyDiagrams is a network read); sign-in gated.
  const driveBoxHtml = persistenceModule.isDriveConfigured?.() ? '<div class="df-close-tabs__drive-box"></div>' : '';

  const { body, footer, close } = buildModal({
    title: 'Close & Delete',
    className: 'df-close-tabs-modal',
    zIndex: 3000,
    bodyStyle: 'padding:var(--spacing-md) var(--spacing-lg)',
    bodyHtml: `
      <p style="margin:0 0 var(--spacing-sm);color:var(--text-secondary);font-size:var(--font-size-sm)">
        Close open tabs, or delete any diagram from this browser to free space.
      </p>
      ${storageGaugeHtml()}
      ${controlsHtml}
      ${tablesHtml}${driveBoxHtml}`,
    footerHtml: `
      <button class="df-modal__btn df-modal__btn--danger-outline" data-action="close-delete" style="margin-right:auto" disabled>Delete Selected</button>
      <button class="df-modal__btn df-modal__btn--danger" data-action="close" disabled>Close Selected</button>`,
  });

  const selectAllEl = body.querySelector('[data-role="select-all"]');
  // `let` + collectBoxes(): the "On Google Drive" rows arrive ASYNC (listMyDiagrams), so the box set is
  // re-gathered after injection; the injected boxes get the same change handler at that point.
  let rowBoxes = [];
  const collectBoxes = () => { rowBoxes = Array.from(body.querySelectorAll('.df-close-tabs__checkbox')).filter(b => b.dataset.role !== 'select-all'); };
  collectBoxes();
  const tabBoxes = () => rowBoxes.filter(b => b.dataset.tabId);
  const closeBtn = footer.querySelector('[data-action="close"]');
  const deleteBtn = footer.querySelector('[data-action="close-delete"]');

  // `expand` is true only for the bulk actions (Select all / Select Tab Group): a table that gains a selection is
  // auto-uncollapsed + its header count flips to "selected/total" (item 1). An individual row toggle just updates
  // the counts without forcing any table open.
  const updateState = (expand = false) => {
    const checked = rowBoxes.filter(b => b.checked);
    const openChecked = checked.filter(b => b.dataset.tabId);
    // Close Selected → open tabs only (archives aren't open). Delete Selected → ANYTHING selected (8.5).
    closeBtn.disabled = openChecked.length === 0;
    closeBtn.textContent = openChecked.length > 1 ? `Close Selected (${openChecked.length})` : 'Close Selected';
    deleteBtn.disabled = checked.length === 0;
    deleteBtn.textContent = checked.length > 1 ? `Delete Selected (${checked.length})` : 'Delete Selected';
    setTriStateCheckbox(selectAllEl, checked.length, rowBoxes.length);
    refreshSplitTableCounts(body, '.df-close-tabs__checkbox', { expand });
  };

  selectAllEl.addEventListener('change', () => { rowBoxes.forEach(b => { b.checked = selectAllEl.checked; }); updateState(true); });
  rowBoxes.forEach(b => b.addEventListener('change', () => updateState()));

  // Collapse/expand each split-table (item 3) - the two tables read like the Load -> Drive / Browser ones.
  bindSplitHeads(body);

  // ── "Closed (on Google Drive)" (CR) ────────────────────────────────────────────────────────────────
  // The user's OWN Drive .dgf files not open as a tab, with Diagramforce context (name / provenance / date), so
  // Drive files can be deleted from HERE with full context instead of guessing among raw .dgf rows in Drive's UI.
  // Sign-in gated (isSignedIn is a pure token check - no popup); the button below is the only place auth fires.
  const driveBox = body.querySelector('.df-close-tabs__drive-box');
  const populateDrive = async () => {
    if (!driveBox) return;
    if (!persistenceModule.isSignedIn?.()) {
      driveBox.innerHTML = splitTable('Closed (on Google Drive)', '·',
        `<div style="padding:22px 18px;color:var(--text-secondary)">
          <p style="margin:0 0 14px">Sign in to Google Drive to see and delete the diagrams stored in your Drive.</p>
          <div style="text-align:center"><button type="button" class="df-modal__btn df-modal__btn--accent df-drive-signin__btn">Sign in to Google Drive</button></div>
        </div>`);
      bindSplitHeads(driveBox);
      const btn = driveBox.querySelector('.df-drive-signin__btn');
      btn?.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Signing in…';
        try { await persistenceModule.signIn?.(); } catch { /* cancelled/blocked - reset below */ }
        if (persistenceModule.isSignedIn?.()) { populateDrive(); return; }
        btn.disabled = false; btn.textContent = 'Sign in to Google Drive';
      });
      return;
    }
    let files = [];
    try { files = (await persistenceModule.listMyDiagrams?.()) || []; }
    catch { driveBox.innerHTML = ''; return; }   // listing failed - hide rather than mislead
    const openIds = new Set(tabs.map(t => t.driveFileId).filter(Boolean));
    // Own files only, minus ones open as a tab (their OPEN row already deletes the master). Provenance stamps
    // (dfBackupOf / dfEditShareOf / dfSharedFrom) become a plain-language suffix - the "which of these is safe
    // to delete?" context Drive's own UI can't give.
    const rows = files.filter(f => f && f.ownedByMe !== false && !openIds.has(f.id)).map(f => {
      const ap = f.appProperties || {};
      const kind = ap.dfBackupOf ? 'backup of a shared file' : ap.dfEditShareOf ? 'copy shared with someone' : ap.dfSharedFrom ? 'your copy of a shared file' : '';
      const rel = f.modifiedTime ? formatRelativeTime(new Date(f.modifiedTime).getTime()) : '';
      const name = String(f.name || 'Diagram').replace(/\.dgf$/i, '');
      return storageRowHtml({
        tag: 'label', rowClass: 'df-close-tabs__row',
        checkbox: `<input type="checkbox" class="df-close-tabs__checkbox" data-drive-id="${escHtml(f.id)}"${f.capabilities && f.capabilities.canDelete === false ? ' disabled' : ''} />`,
        name: escHtml(name),
        nameSuffix: kind ? ` <span class="df-srow__meta">(${escHtml(kind)})</span>` : '',
        // Wrap the chips in .df-save-mgr__chips (like tabRowChipsHtml) so they pack tightly on the left: the
        // bottom row is `justify-content: space-between`, so bare chips would spread apart (This browser ··· My
        // Drive) — the wrapper makes them ONE flex child, with the date pushed to the right.
        metaLeft: `<span class="df-save-mgr__chips">${driveChipsHtml({ driveFileId: f.id, driveSync: true }, { driveOn: true, onSharedDrive: !!f.driveId })}</span>`,
        metaRight: rel ? `Last Modified ${escHtml(rel)}` : 'in your Drive',
      });
    }).join('');
    driveBox.innerHTML = rows ? splitTable('Closed (on Google Drive)', files.filter(f => f && f.ownedByMe !== false && !openIds.has(f.id)).length, rows) : '';
    bindSplitHeads(driveBox);
    collectBoxes();
    driveBox.querySelectorAll('.df-close-tabs__checkbox').forEach(b => b.addEventListener('change', () => updateState()));
    refreshSplitTableCounts(body, '.df-close-tabs__checkbox', {});
  };
  populateDrive();

  // "Select Tab Group" — replaces the selection with the chosen group's OPEN tabs (archives carry no group).
  const groupSel = body.querySelector('.df-group-select');
  if (groupSel) {
    const tabGroup = new Map(tabs.map(t => [t.id, t.groupId || null]));
    groupSel.addEventListener('change', () => {
      const chosen = groupSel.value;
      if (chosen) rowBoxes.forEach(b => { b.checked = !!b.dataset.tabId && tabInGroup(tabGroup.get(b.dataset.tabId), chosen); });
      groupSel.value = '';
      updateState(true);
    });
  }

  body.querySelectorAll('.df-close-tabs__row[data-tab-id], .df-close-tabs__row[data-save-key]').forEach(row => {
    row.addEventListener('click', (e) => { if (e.target.tagName === 'INPUT') e.stopPropagation(); });
  });

  // Close Selected — close the selected OPEN tabs (their browser archive is kept). Dirty tabs prompt.
  closeBtn.addEventListener('click', () => {
    const selectedIds = tabBoxes().filter(b => b.checked).map(b => b.dataset.tabId);
    if (selectedIds.length === 0) return;
    const dirtyIds = selectedIds.filter(id => tabs.find(t => t.id === id)?.dirty);
    if (dirtyIds.length > 0) {
      showMultiDiscardConfirm(dirtyIds.length,
        () => { close(); performMultiClose(selectedIds, { noArchiveIds: new Set(dirtyIds) }); },
        () => { close(); performMultiClose(selectedIds); });
    } else { close(); performMultiClose(selectedIds); }
  });

  // Delete Selected (8.5) — remove from browser storage entirely: open tabs → close + delete their existing
  // archive + Drive master (if synced); closed archives → delete the localStorage entry. Works for ANY selection.
  deleteBtn.addEventListener('click', async () => {
    const checked = rowBoxes.filter(b => b.checked);
    if (!checked.length) return;
    const tabIds = checked.filter(b => b.dataset.tabId).map(b => b.dataset.tabId);
    const saveItems = checked.filter(b => b.dataset.saveKey).map(b => ({ key: b.dataset.saveKey, name: b.dataset.saveName }));
    const driveOnly = checked.filter(b => b.dataset.driveId).map(b => b.dataset.driveId);   // "Closed (on Google Drive)" rows
    const driveTabs = tabIds.map(id => tabs.find(t => t.id === id)).filter(t => t && t.driveFileId);
    const driveDeletes = driveTabs.length + driveOnly.length;
    const browserTotal = tabIds.length + saveItems.length;
    const parts = [];
    if (tabIds.length) parts.push(`close ${tabIds.length} open tab${tabIds.length === 1 ? '' : 's'}`);
    if (browserTotal) parts.push(`remove ${browserTotal} diagram${browserTotal === 1 ? '' : 's'} from this browser`);
    if (driveDeletes) parts.push(`move ${driveDeletes} to your Google Drive trash (recoverable 30 days)`);
    const ok = await confirmModal({
      title: 'Delete selected diagrams?',
      message: `This will ${parts.join(', ')}. This can't be undone${driveDeletes ? " (Drive's trash aside)" : ''}.`,
      okLabel: 'Delete', cancelLabel: 'Cancel', tone: 'danger',
    });
    if (!ok) return;
    close();
    // A FAILED Drive delete (signed out → blocked/cancelled sign-in popup, network) keeps that tab OPEN with its
    // archive intact: the tab is the user's in-app handle on the Drive file - closing it would strand the file in
    // Drive with no Diagramforce context to find and delete it (CR, prod - mirrors the single-tab close dialog).
    const failedDrive = new Set();
    for (const t of driveTabs) {
      let deleted = false;
      try { deleted = await persistenceModule.deleteDiagramFromDrive(t.driveFileId); }
      catch (e) { console.warn('Diagramforce: Drive delete failed', t.id, e); }
      if (!deleted) failedDrive.add(t.id);
    }
    // Drive-only rows: trash each; a failure keeps nothing to close (no tab) - it's just reported.
    let driveOnlyFailed = 0;
    for (const fid of driveOnly) {
      let deleted = false;
      try { deleted = await persistenceModule.deleteDiagramFromDrive(fid); }
      catch (e) { console.warn('Diagramforce: Drive delete failed', fid, e); }
      if (deleted) persistenceModule.forgetArchivesForDriveFile?.(fid);   // archives pointing at a trashed file drop their chip
      else driveOnlyFailed++;
    }
    const closableIds = tabIds.filter(id => !failedDrive.has(id));
    // Remove the existing browser archive of every DELETABLE open tab (synced or not), then the standalone archives.
    for (const id of closableIds) { const t = tabs.find(x => x.id === id); if (t?.browserSaveName) deleteBrowserArchive(t.browserSaveName); }
    for (const s of saveItems) { persistenceModule.deleteNamedSave?.(s.key); forgetBrowserSaveName(s.name); }
    const failedCount = failedDrive.size + driveOnlyFailed;
    if (failedCount) showToast(`${failedCount} diagram${failedCount === 1 ? '' : 's'} couldn't be deleted from Google Drive - sign in and try again${failedDrive.size ? ` (${failedDrive.size === 1 ? 'its tab stays' : 'their tabs stay'} open)` : ''}.`, 'info');
    // Close the deletable open tabs WITHOUT re-archiving (we're deleting their browser copy).
    if (closableIds.length) performMultiClose(closableIds, { noArchiveIds: new Set(closableIds) });
  });
}

function performMultiClose(ids, { noArchiveIds = null } = {}) {
  const { tabs } = tbctx;
  const { doCloseTab } = tbctx;
  // Mark all selected tabs as non-dirty so doCloseTab proceeds without prompting.
  for (const id of ids) {
    const tab = tabs.find(t => t.id === id);
    if (tab) tab.dirty = false;
  }
  // Close in reverse so splice indices stay stable and we don't churn the active tab.
  // If the active tab is in the set, doCloseTab will switch to the nearest remaining
  // one each time — which is the right behaviour. `noArchiveIds` are the delete-closed tabs
  // (their copies are being removed), so they skip the auto-archive; the rest archive normally.
  for (const id of [...ids]) {
    if (tabs.some(t => t.id === id)) doCloseTab(id, { archive: !(noArchiveIds && noArchiveIds.has(id)) });
  }
}

function showMultiDiscardConfirm(dirtyCount, onDiscard, onSaveAndClose) {
  const { tabs } = tbctx;
  const { footer, close } = buildModal({
    title: 'Unsaved Changes',
    zIndex: 3100,
    width: '460px',
    showClose: false, // decision dialog — dismiss via Cancel / backdrop / Escape
    bodyStyle: 'padding:var(--spacing-md) var(--spacing-lg)',
    bodyHtml: `
      <p style="margin:0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">
        <strong style="color:var(--text-primary)">${dirtyCount}</strong> of the selected tabs ${dirtyCount === 1 ? 'has' : 'have'} unsaved changes. Save to Browser Storage first, or close without saving?
      </p>`,
    footerHtml: `
      <button class="df-modal__btn" data-action="cancel" style="margin-right:auto">Cancel</button>
      <button class="df-modal__btn df-modal__btn--primary" data-action="save">Save and Close</button>
      <button class="df-modal__btn df-modal__btn--danger" data-action="confirm">Close Anyway</button>`,
  });
  footer.querySelector('[data-action="cancel"]').addEventListener('click', close);
  footer.querySelector('[data-action="save"]').addEventListener('click', () => { close(); onSaveAndClose(); });
  footer.querySelector('[data-action="confirm"]').addEventListener('click', () => { close(); onDiscard(); });
}

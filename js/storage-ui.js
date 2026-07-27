// Storage-manager UI emitters (CLEANUP S1) — moved out of the documented-pure util.js. These build (or, for the
// split-table + tri-state helpers, mutate) DOM for the Save / Load / Close managers' rows, chips, collapsible
// split tables, and select-alls (including the V4/V5 helpers). Depends only on the genuinely-pure helpers that
// stay in util.js + the zero-dep drive-sync-logic leaf (hasVerifiedMyDriveBackup — the chip's honesty rule).
import { escHtml, getDiagramTypeIcon, isViewForkTab } from './util.js?v=1.21.4';
import { hasVerifiedMyDriveBackup } from './persistence/drive-sync-logic.js?v=1.21.4';

export function storageRowHtml({ tag = 'div', rowClass = '', rowAttrs = '', active = false, checkbox = '',
  diagramType = '', typeTitle = '', icon: iconOverride = '', leadingIcon = false, name = '', nameSuffix = '', groupBadge = '', count = null,
  metaLeft = '', metaCenter = '', metaRight = '', trailing = '' } = {}) {
  const countHtml = (count != null) ? `<span class="df-srow__count">${count} shape${count === 1 ? '' : 's'}</span>` : '';
  // `icon` lets a caller drop a custom leading element into the icon slot (e.g. Version history's eye-preview
  // toggle) instead of the diagram-type / generic-file icon. Default keeps the type/file icon (unchanged).
  const icon = iconOverride || (diagramType ? getDiagramTypeIcon(diagramType) : '<svg class="df-toolbar__icon" aria-hidden="true"><use href="#file"></use></svg>');
  // `leadingIcon` HOISTS the icon out of the top line into a row-level leading column. The row is `align-items:
  // center`, so the icon then centres VERTICALLY across both lines, and the name + meta lines share one left
  // indent (so the detail line starts under the name, not under the icon). Version history opts in for its
  // eye-preview toggle; the Save/Load lists keep the inline icon. The optional title rides on the slot.
  const leadIconHtml = leadingIcon ? `<span class="df-srow__lead-icon"${typeTitle ? ` title="${escHtml(typeTitle)}"` : ''}>${icon}</span>` : '';
  // `metaCenter` is an OPTIONAL third line below the chips line — used for shared-file provenance in the Drive
  // library ("Shared file · shared by X · Copy/Collaborate"). Owned rows omit it and stay two-line.
  // On mobile the row collapses to its top line (icon + name + count); the detail lines (chips / shared / date)
  // and the trailing action hide behind a disclosure caret so a long list stays scannable. Only add the caret
  // when there's something to reveal. Desktop ignores it (CSS-hidden) and shows everything inline as before.
  const hasDetails = !!(metaLeft || metaCenter || metaRight || trailing);
  const disclosure = hasDetails
    ? '<button type="button" class="df-srow__disclosure" aria-label="Show details" aria-expanded="false" tabindex="-1"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg></button>'
    : '';
  return `
    <${tag} class="df-modal__row df-srow${leadingIcon ? ' df-srow--lead' : ''}${hasDetails ? ' df-srow--collapsible' : ''}${active ? ' df-modal__row--active' : ''}${rowClass ? ' ' + rowClass : ''}"${rowAttrs ? ' ' + rowAttrs : ''}>
      ${checkbox}
      ${leadIconHtml}
      <div class="df-modal__row-info df-srow__info">
        <div class="df-srow__line df-srow__line--top">
          ${leadingIcon ? '' : `<span class="df-srow__icon"${typeTitle ? ` title="${escHtml(typeTitle)}"` : ''}>${icon}</span>`}
          <span class="df-modal__row-label" title="${escHtml(name)}">${escHtml(name)}${nameSuffix}</span>
          ${active ? '<span class="df-load-open__badge">current</span>' : ''}
          <span class="df-srow__right">${groupBadge}${countHtml}</span>
          ${disclosure}
        </div>
        <div class="df-srow__line df-srow__line--bottom">
          ${metaLeft || '<span></span>'}
          ${metaRight ? `<span class="df-srow__date">${escHtml(metaRight)}</span>` : ''}
        </div>
        ${metaCenter ? `<div class="df-srow__line df-srow__line--shared">${metaCenter}</div>` : ''}
      </div>
      ${trailing}
    </${tag}>`;
}

/**
 * The directional share-chip icon SVG for a storage row (matches the 3-way tab glyph: `shareGlyphKind`):
 *   'out' → #share (your save wins), 'in' → #share_link / the chain (their save wins), 'both' → #socialshare
 *   (collaboration / Shared Drive, edits flow both ways). Used on the amber "Shared Drive / Shared File" chips in
 *   the Save Manager, Load, and Close & Delete rows so the chip reads the same direction as the tab. Filled,
 *   currentColor; same 16-viewBox box as the other chip checks.
 */
export function shareChipIconHtml(kind) {
  const id = kind === 'out' ? 'share_mobile' : kind === 'both' ? 'socialshare' : 'share_link';
  return `<svg class="df-save-mgr__check df-save-mgr__check--link" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><use href="#${id}"></use></svg>`;
}

/**
 * The Copy/Collab "share type" pill — one canonical builder for every storage/share row that marks a shared-in
 * diagram's access level: `canEdit` true → "Collab" (editable, syncs back), false → "Copy" (view-only clone).
 * Used by the Save Manager + Close & Delete (top-line, full size), the Load > Drive row (`sm` compact variant),
 * and the Share roster section headers (`sm` + custom/empty title). Pure string.
 *   - sm:          the compact `--sm` variant (Load row + roster header)
 *   - workingCopy: the row is the recipient's own editable copy → a "Load opens your copy" tooltip
 *   - title:       override the tooltip ('' suppresses it, e.g. the roster header)
 */
export function sharePillHtml(canEdit, { sm = false, workingCopy = false, title } = {}) {
  const kind = canEdit ? 'collab' : 'copy';
  const tip = title !== undefined ? title
    : workingCopy ? 'Your editable copy of a shared file - Load opens your copy'
      : canEdit ? 'You can edit this shared file (Collab) - your edits save back to the owner'
        : 'View-only share (Copy) - clone it to edit your own copy';
  return `<span class="df-share-pill${sm ? ' df-share-pill--sm' : ''} df-share-pill--${kind}"${tip ? ` title="${escHtml(tip)}"` : ''}>${canEdit ? 'Collab' : 'Copy'}</span>`;
}

/** Storage chips for a diagram row — "This browser · My Drive · Shared Drive ×N · Shared File" — the SINGLE
 * builder shared by the Save Manager, Load Manager, AND Close & Delete so all three read identically. `t` is a
 * tab-like object carrying driveFileId / driveSharedCopies / driveSharedSource. `browserOn` lets a Drive-library
 * row that isn't open locally turn the browser chip off. */
const DRIVE_CHIP_CHECK = '<svg class="df-save-mgr__check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function driveChip(label, on, title, cls = '', icon = null) {
  const glyph = on ? (icon || DRIVE_CHIP_CHECK) : '';
  return `<span class="df-save-mgr__chip${on ? ' is-on' : ''}${cls ? ' ' + cls : ''}"${title ? ` title="${escHtml(title)}"` : ''}>${glyph}${escHtml(label)}</span>`;
}

export function driveChipsHtml(t, { driveOn = false, browserOn = true, browserTitle, sharedFile = false, sharedFileTitle, onSharedDrive = false, hasMyDriveBackup = false, hideSharedCopies = false } = {}) {
  const out = [driveChip('This browser', browserOn, browserTitle || 'Auto-kept in this browser - reopens on reload. Closing it archives a copy you can reload from Browser Storage.')];
  if (driveOn) {
    // A Phase-B directly-edited shared file (Collab/received-editable) is FOREIGN like a Shared-Drive file: the master
    // lives on the owner's Drive, not yours - only the backup mirror sits in your My Drive.
    const sharedInEdit = !!t.driveSharedInEdit;
    const foreign = onSharedDrive || sharedInEdit;
    // Order: This browser → My Drive → Shared Drive. "My Drive" is on for an own master in My Drive OR a foreign file
    // MIRRORED into My Drive (the auto-backup), so a Shared-Drive/Collab diagram reads "My Drive (backup) + Shared …".
    const inMyDrive = (!!t.driveFileId && !foreign) || hasMyDriveBackup;
    if (inMyDrive) {
      out.push(driveChip('My Drive', true, hasMyDriveBackup && foreign ? 'A backup copy is kept in your My Drive' : 'Saved as a file you own in My Drive', 'df-save-mgr__chip--mydrive'));
    } else if (!foreign && !(sharedFile && !t.driveFileId)) {
      // A file shared TO you is not in YOUR My Drive, so the always-off "My Drive" chip was misleading on those rows.
      // Omit it for a shared file you have no own master of; the "Shared File" chip below carries its real status. A
      // not-yet-saved local tab still shows the OFF chip ("not saved to My Drive yet").
      out.push(driveChip('My Drive', !!t.driveFileId, t.driveFileId ? 'Saved as a file you own in My Drive' : 'Not saved to My Drive yet', 'df-save-mgr__chip--mydrive'));
    }
    if (onSharedDrive) {
      // The file ITSELF lives on a team Shared Drive (its own driveId). Shared Drive = everyone with access edits the
      // same file → the "both ways" glyph (#socialshare).
      out.push(driveChip('Shared Drive', true, 'Lives on a team Shared Drive - everyone with access edits the same file (edits flow both ways)', 'df-save-mgr__chip--shared', shareChipIconHtml('both')));
    }
    const sc = t.driveSharedCopies || 0;
    // In the Load → Drive list `hideSharedCopies` suppresses this fan-out count on the SOURCE master (the copies it
    // fanned out appear as their own rows there). YOU published these copies out → the "out, your save wins" glyph.
    if (!hideSharedCopies && sc > 0) out.push(driveChip(sc > 1 ? `Shared Drive ×${sc}` : 'Shared Drive', true, `You published this out to ${sc} Shared Drive${sc === 1 ? '' : 's'} - your master is the source`, 'df-save-mgr__chip--shared', shareChipIconHtml('out')));
    const src = t.driveSharedSource;
    // Mode C: a VIEW FORK is the user's OWN file (own master + a refresh-only view pointer) → not a shared file, so the
    // Shared-File chip is suppressed (isViewForkTab). A true shared-in file / Collab working copy still shows it.
    if (src && src.fileId && !isViewForkTab(t)) {
      // Shared File: an editable (Collab) source writes both ways (#socialshare); a view-only (Copy) source is one-way
      // IN - their save wins, you Refresh to pull (the chain, #share_link). A diverged source is worth flagging.
      const conflict = !!src.conflict;
      const statusTip = conflict ? 'The shared file changed - Refresh to reconcile'
        : src.canEdit ? 'A file shared to you that you can edit (Collab) - edits flow both ways (your edits save back to the source)'
          : 'A view-only file shared to you (Copy) - your edits stay in your own copy; Refresh to pull theirs (their save wins)';
      out.push(driveChip('Shared File', true, sharedFileTitle || statusTip, 'df-save-mgr__chip--shared', shareChipIconHtml(src.canEdit ? 'both' : 'in')));
    } else if (sharedInEdit) {
      // Phase B: a file shared TO you that you edit DIRECTLY (Collab/received-editable) - your edits save straight to
      // the shared file, so edits flow BOTH ways (#socialshare), and a private backup mirror is kept in your My Drive.
      out.push(driveChip('Shared File', true, sharedFileTitle || 'A file shared to you that you edit directly - your edits save straight to the shared file (edits flow both ways)', 'df-save-mgr__chip--shared', shareChipIconHtml('both')));
    } else if ((t.driveOutgoingGrants || 0) > 0 || (t.driveEditShares || 0) > 0 || (t.driveCopies || []).some((c) => c && c.kind === 'edit-share')) {
      // D3 ("shared by you"): a file YOU shared OUT via a Copy/Collab grant or an editable copy. Directional "Shared
      // File" chip with the OUT icon (#share_mobile) + a "shared by you" tooltip - so the chip reads in (received) vs
      // out (you shared it). It's still YOUR file; your saves keep it up to date and you can revoke access.
      out.push(driveChip('Shared File', true, sharedFileTitle || 'You shared this file with others (Copy/Collab) - it stays your file; your saves keep it up to date, and you can revoke access any time', 'df-save-mgr__chip--shared', shareChipIconHtml('out')));
    }
  }
  return out.join('');
}

/**
 * The bottom-row storage chips + Copy/Collab share pill for ONE open-tab / archive row — the piece the Save, Load,
 * and Close managers each rebuilt (and had drifted on). Returns the full `<span class="df-save-mgr__chips">…</span>`.
 *
 * Derives `hasMyDriveBackup` and the shared-copy count from the ONE raw source of truth, `tab.driveCopies`, so a
 * getAllTabs summary (flags precomputed) and a live tab (raw array only) render identically. `driveCopies` is null
 * when empty on summaries and raw on live tabs — `(… || [])` covers both. This resolves the two prior drifts the
 * cleanup flagged: the hasMyDriveBackup source (was derived in two places) and the share pill's canEdit test
 * (was `=== true` in the Save Manager, truthy elsewhere → standardized here to truthy, matching Load -> Drive).
 */
export function tabRowChipsHtml(tab, { driveOn = false } = {}) {
  const copies = tab.driveCopies || [];
  const sharedCopies = copies.filter((c) => c && c.kind === 'shared-drive').length;
  // A bare `mydrive-backup` pointer is NOT evidence the mirror exists — deleting it in Drive left the pointer behind
  // and the chip kept claiming "My Drive" for a file that was gone. Require the `verifiedAt` stamp a create, a
  // successful fan-out write, or a reconcile probe sets (hasVerifiedMyDriveBackup). A legacy entry reads unverified
  // until the next reconcile confirms it (chip off, one sync) or prunes it (chip off, honestly).
  const hasMyDriveBackup = hasVerifiedMyDriveBackup(copies);
  const chips = driveChipsHtml({ ...tab, driveSharedCopies: sharedCopies }, { driveOn, onSharedDrive: !!tab.driveDriveId, hasMyDriveBackup });
  const src = tab.driveSharedSource;
  // A VIEW FORK is your own file → no pill (only a refresh pointer). Otherwise the pill shows access (Collab/Copy).
  const sharePill = (src && src.fileId && !isViewForkTab(tab)) ? sharePillHtml(!!src.canEdit, { sm: true }) : '';
  return `<span class="df-save-mgr__chips">${chips}${sharePill}</span>`;
}

/**
 * Refresh the `.df-split-table__count` badge of every collapsible split table in `container` to read
 * "selected/total" (e.g. `3/8`) whenever rows are checked, or just the plain total when none are. A table with no
 * checkboxes (a navigation-only section, e.g. Load -> Browser's "Open in this browser") is left untouched.
 * When `expand` is true (a Select-all / Select-Tab-Group action, NOT an individual row toggle), any table that now
 * holds a selection is auto-uncollapsed so the user can see what got picked. (item 1)
 * @param {Element} container - the modal body holding the `.df-split-table` blocks.
 * @param {string} checkboxSelector - selector matching a row checkbox (e.g. '.df-modal__row-check').
 * @param {{expand?: boolean}} [opts]
 */
export function refreshSplitTableCounts(container, checkboxSelector, { expand = false } = {}) {
  if (!container) return;
  container.querySelectorAll('.df-split-table').forEach((table) => {
    const rowsBox = table.querySelector('.df-split-table__rows');
    const countEl = table.querySelector('.df-split-table__count');
    if (!rowsBox || !countEl) return;
    const boxes = rowsBox.querySelectorAll(checkboxSelector);
    if (!boxes.length) return;   // navigation-only table (no row checkboxes) keeps its static total
    const checked = [...boxes].filter((b) => b.checked).length;
    countEl.textContent = checked ? `${checked}/${boxes.length}` : `${boxes.length}`;
    if (expand && checked > 0) table.classList.remove('is-collapsed');
  });
}

/**
 * The chevron glyph capping every collapsible section header — the standard split tables (`.df-split-table__head`)
 * AND the Load -> Drive library sections (`.df-drive-library__section`, which keep their own wrapper classes but
 * share this one SVG). One definition so the chevron can't drift between the six places it used to be pasted.
 */
export const SPLIT_CHEVRON_SVG = '<svg class="df-load-open__chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * The standard collapsible split-table header band: chevron + label + count. Pure string. Shared by the Load,
 * Save, and Close managers. (The Drive-library section header is deliberately a DIFFERENT structure — it uses
 * SPLIT_CHEVRON_SVG but its own classes — so it is not built from this.)
 */
export function splitTableHeadHtml(label, count) {
  return `<div class="df-split-table__head" role="button" tabindex="0">${SPLIT_CHEVRON_SVG}<span>${label}</span><span class="df-split-table__count">${count}</span></div>`;
}

/**
 * A whole collapsible split table: the header band + a `.df-split-table__rows` box holding `rows` (an HTML string).
 * `collapsed` starts it closed; `boxClass` is the manager list-box skin. Pair with bindSplitHeads() to wire the
 * collapse toggle after insertion.
 */
export function splitTableHtml({ label, count, rows = '', collapsed = false, boxClass = 'df-modal__list-box' }) {
  return `<div class="df-split-table ${boxClass}${collapsed ? ' is-collapsed' : ''}">${splitTableHeadHtml(label, count)}<div class="df-split-table__rows">${rows}</div></div>`;
}

/**
 * Wire collapse/expand on every `.df-split-table__head` under `root`: a click or Enter/Space toggles `is-collapsed`
 * on the enclosing `.df-split-table`. Call once per freshly-rendered head (the managers re-render sub-boxes async,
 * so pass the specific container that was just populated). No-op on a missing root.
 */
export function bindSplitHeads(root) {
  if (!root) return;
  root.querySelectorAll('.df-split-table__head').forEach((h) => {
    const grp = h.closest('.df-split-table');
    if (!grp) return;
    const toggle = () => grp.classList.toggle('is-collapsed');
    h.addEventListener('click', toggle);
    h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
}

/**
 * Set a "Select all" checkbox to the correct tri-state for `checked` of `total` row checkboxes: ticked when all are
 * selected, indeterminate when some are, clear when none. The one derivation the Load / Save / Close managers each
 * hand-rolled (and which had already drifted in wording). No-op on a null element (matches the old `if (checkAll)`
 * guards). The Drive-library select-all deliberately does NOT use this — it stays non-tri-state.
 */
export function setTriStateCheckbox(el, checked, total) {
  if (!el) return;
  el.checked = total > 0 && checked === total;
  el.indeterminate = checked > 0 && checked < total;
}

/**
 * The "Select all in a tab group" picklist for the diagram-select screens (Save Manager / Close Tabs / Export).
 * Returns a `<select class="df-group-select">` listing each tab group + a virtual **Ungrouped** option (only
 * meaningful once at least one real group exists — captures tabs with no `groupId`). Returns '' when there are
 * no groups (then the plain "Select all" is enough). The caller wires the change handler (it owns the
 * tab→group map + the checkbox shape) and resets the select to the placeholder after each pick.
 */
export function groupSelectHtml(groups) {
  const gs = Array.isArray(groups) ? groups.filter(Boolean) : [];
  if (!gs.length) return '';
  const opts = gs.map((g) => `<option value="${escHtml(g.id)}">${escHtml(g.name || 'Group')}</option>`).join('');
  return `<select class="df-group-select" aria-label="Select only the diagrams in a tab group"><option value="">Select Tab Group…</option>${opts}<option value="__ungrouped__">Ungrouped</option></select>`;
}

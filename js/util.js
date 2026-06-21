// Shared pure utilities — zero dependencies, zero DOM, zero JointJS.
//
// Everything here is a pure function (output depends only on input, no side
// effects beyond reading Date.now()). Consolidated from copies that had drifted
// across persistence.js / toolbar.js / tabs.js / markdown.js so there is exactly
// ONE implementation of each, directly unit-tested in tests/util.test.js.
//
// Keep this module dependency-free: it is imported by low-level modules (incl.
// the markdown security boundary), so importing app modules from here would risk
// import cycles.

/**
 * HTML-escape a string for safe interpolation into innerHTML / a <foreignObject>.
 * SECURITY PRIMITIVE: `&` is escaped FIRST so the entities introduced by the
 * later passes are not double-escaped. The relative order of " ' < > does not
 * affect the output (no entity contains another of those characters).
 */
export function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Relative-time label for a timestamp: "just now" / "Nm ago" / "Nh ago" /
 * "Nd ago". Returns null for a falsy timestamp (so callers can omit the line).
 */
export function formatRelativeTime(ts) {
  if (!ts) return null;
  const ageSec = Math.floor((Date.now() - ts) / 1000);
  if (ageSec < 60) return 'just now';
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  return `${Math.floor(ageSec / 86400)}d ago`;
}

/** Compare two semver strings. Returns -1 if a<b, 0 if equal, 1 if a>b. A falsy
 *  `a` sorts first, a falsy `b` sorts last. */
export function compareSemver(a, b) {
  if (!a) return -1;
  if (!b) return 1;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

/**
 * Heal a legacy trailing " YYYYMMDD" name suffix to " YYYY-MM-DD" (only when the
 * 8 digits parse as a plausible date). Lets pre-hyphen backups re-import with a
 * consistent, readable date suffix. No-op for names without such a suffix or with
 * non-date digits (e.g. "Order 12345678").
 */
export function normalizeDateSuffix(name) {
  return String(name || '').replace(/ (\d{4})(\d{2})(\d{2})$/, (full, y, mo, d) => {
    const mm = +mo, dd = +d;
    return (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) ? ` ${y}-${mo}-${d}` : full;
  });
}

// Characters illegal in a filename on Windows + control chars + zero-width chars.
// Built via new RegExp from an all-ASCII escape string so no literal control chars
// ever live in the source.
const FILENAME_BAD = new RegExp('[<>:"/\\\\|?*\\u0000-\\u001F\\u200B-\\u200D\\uFEFF]', 'g');

/**
 * Normalise an arbitrary string (a tab name, object name, …) into a single,
 * cross-platform-safe download-filename PART (no extension). Strips characters
 * illegal on Windows (`< > : " / \ | ? *`) + control + zero-width chars, trims
 * leading/trailing dots & spaces (also Windows-illegal), collapses whitespace to
 * single dashes, and caps length. Returns `fallback` when nothing usable remains
 * so a file always gets a name. Safe on Windows, macOS, and Linux.
 */
export function sanitizeFilenamePart(s, fallback = 'untitled') {
  let v = String(s ?? '')
    .replace(FILENAME_BAD, '')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')   // no leading / trailing dots or spaces (Windows)
    .replace(/[\s_]+/g, '-')           // spaces + underscores → single dash (a `_` is reserved
                                       // as the inter-section separator in CSV filenames)
    .replace(/-+/g, '-');              // collapse runs of dashes
  if (!v) v = fallback;
  return v.slice(0, 80);
}

/**
 * Parse a CSS colour string to `[r, g, b]` ONLY when it is an explicit, ~opaque solid —
 * a `#rgb` / `#rrggbb` hex, or `rgb()/rgba()` with alpha ≥ 0.6. Returns null for `var(...)`
 * references, `none`/`transparent`, translucent fills (alpha < 0.6, which mostly show the
 * canvas behind them), and named colours. Used to decide whether a hardcoded node fill is a
 * real, theme-independent colour we can compute text contrast against.
 */
export function parseSolidColor(c) {
  if (typeof c !== 'string') return null;
  const s = c.trim();
  if (!s || s.startsWith('var(') || s === 'none' || s === 'transparent') return null;
  let m = s.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean);
    if (p.length >= 3) {
      const a = p[3] === undefined ? 1 : parseFloat(p[3]);
      if (!(a >= 0.6)) return null;            // translucent ⇒ shows the canvas ⇒ treat as theme
      return [parseInt(p[0], 10), parseInt(p[1], 10), parseInt(p[2], 10)];
    }
  }
  return null;
}

/**
 * Given an explicit `body.fill`, the label + subtitle colours that contrast it (dark text on a
 * light body, light text on a dark body) — or null when the body is theme-adaptive/translucent
 * (caller keeps the theme defaults). Threshold uses Rec. 709 perceptual luminance. The returned
 * hexes match the light/dark `--node-text` tokens so a recoloured node matches its native peers.
 */
export function nodeContrastText(bodyFill) {
  const rgb = parseSolidColor(bodyFill);
  if (!rgb) return null;
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  return lum > 0.6
    ? { label: '#1C1E21', subtitle: 'rgba(0, 0, 0, 0.55)' }       // light body ⇒ dark text
    : { label: '#F5F6F7', subtitle: 'rgba(255, 255, 255, 0.6)' }; // dark body ⇒ light text
}

/**
 * Count the SHAPES (nodes, not links) in a JointJS `graph.toJSON()` cells array.
 * JointJS serializes elements and links into one `cells` array; links carry both `source` and `target`,
 * elements don't — so "nodes only" is `!(c.source && c.target)`. Used by the Save Manager to show a shape
 * count and to treat 0 as "empty" (hidden). Tolerates null/non-array input → 0.
 */
export function countDiagramShapes(cells) {
  if (!Array.isArray(cells)) return 0;
  return cells.filter(c => c && !(c.source && c.target)).length;
}

/** Inline SVG glyph for a diagram type — the per-type icon shown in storage-row lists (Save Manager, Browser
 *  Storage, Drive library, Export, Close-Tabs). Pure string; falls back to the architecture glyph. */
export function getDiagramTypeIcon(type) {
  const icons = {
    architecture: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="5" height="5" rx="1"/><rect x="10" y="1" width="5" height="5" rx="1"/><rect x="5.5" y="10" width="5" height="5" rx="1"/><path d="M3.5 6v2h9V6M8 8v2" stroke="currentColor" stroke-width="1" fill="none"/></svg>',
    process: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="7" y="5.5" width="5" height="5" rx="1"/><circle cx="3" cy="8" r="1"/><line x1="5.5" y1="8" x2="7" y2="8" stroke="currentColor" stroke-width="1.5"/></svg>',
    datamodel: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="1" width="6" height="3" rx="1"/><rect x="9" y="7" width="6" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="7" width="6" height="3" rx="1"/></svg>',
    datamapping: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="0.5" y="2" width="5" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="0.5" y="2" width="5" height="3" rx="1"/><rect x="10.5" y="2" width="5" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="10.5" y="2" width="5" height="3" rx="1"/><path d="M5.5 8 L10 8 M8.5 6.5 L10 8 L8.5 9.5" fill="none" stroke="currentColor" stroke-width="1"/><path d="M5.5 11 L10 11" stroke="currentColor" stroke-width="1" opacity="0.55"/></svg>',
    gantt: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="8" height="3" rx="1"/><rect x="4" y="7" width="9" height="3" rx="1" opacity="0.7"/><rect x="7" y="12" width="6" height="3" rx="1" opacity="0.5"/></svg>',
    org: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="5" y="1" width="6" height="4" rx="1"/><rect x="0.5" y="10" width="6" height="4" rx="1" opacity="0.7"/><rect x="9.5" y="10" width="6" height="4" rx="1" opacity="0.7"/><path d="M8 5v2H3.5V10M8 7h4.5V10" stroke="currentColor" stroke-width="1" fill="none"/></svg>',
  };
  return icons[type] || icons.architecture;
}

/**
 * Shared two-line storage row — the SINGLE source for every per-diagram list (Save Manager, Browser Storage,
 * Drive library, Export-to-JSON, Close Multiple Tabs) so they read identically. Line 1: [type icon] name
 * [group badge] [N elements]. Line 2: metaLeft (left) … metaRight (right). The type icon sits ON the name line;
 * the checkbox aligns to that top line. Raw-HTML slots the caller controls: `checkbox`, `metaLeft`, `trailing`
 * (per-row actions), `nameSuffix` (e.g. an "(active)" tag / dirty dot). `tag`/`rowClass`/`rowAttrs` let the
 * Close-Tabs list render a clickable <label data-tab-id>. Returns an HTML string.
 */
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
/** Mode C: a VIEW FORK is the user's OWN file - it has its own My-Drive master (`driveFileId`) yet keeps a refresh-only
 *  VIEW `driveSharedSource` pointer (canEdit !== true) to the original it was forked from. It is NOT a "shared with you"
 *  file: the chip/pill renderers use this to suppress the Shared-File chip + Copy/Collab pill (mirrors the same
 *  carve-out in `tabShareRole`). An un-forked view (no own master) or a Collab working copy (editable) is NOT a fork. */
export function isViewForkTab(t) {
  return !!(t && t.driveFileId && t.driveSharedSource && t.driveSharedSource.canEdit !== true);
}

/** Deterministic JSON: deep-sorts object keys so two cells from different serializations (or app versions) compare
 *  equal when their content is equal. Used by diffGraphs. */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

/**
 * Element-level diff between two diagram graphs (saved `{cells:[...]}` form), matched by cell `id`. Powers the
 * Review modal's side-by-side highlight (yours vs Google Drive) and the Version History preview (this save vs the
 * previous one). Pure; unit-tested.
 *   @param base    the "before" graph (the OTHER version / the previous save)
 *   @param current the "after" graph (the one being shown)
 *   @returns {{ added:Set, removed:Set, changed:Set, removedCells:Array }} cell-id sets - present-in-current-only /
 *            present-in-base-only / present-in-both-but-content-differs - plus `removedCells`, the actual base cell
 *            objects that were removed (so a single-diagram preview can GHOST them; the two-card Review modal leaves
 *            them out, since each card's removed = the other card's `added`).
 */
export function diffGraphs(base, current) {
  const cellsOf = (g) => (g && Array.isArray(g.cells) ? g.cells : []).filter((c) => c && c.id != null);
  const mapA = new Map(cellsOf(base).map((c) => [c.id, c]));
  const mapB = new Map(cellsOf(current).map((c) => [c.id, c]));
  const added = new Set(), removed = new Set(), changed = new Set();
  for (const [id, cb] of mapB) {
    const ca = mapA.get(id);
    if (!ca) added.add(id);
    else if (stableStringify(ca) !== stableStringify(cb)) changed.add(id);
  }
  const removedCells = [];
  for (const [id, ca] of mapA) if (!mapB.has(id)) { removed.add(id); removedCells.push(ca); }
  return { added, removed, changed, removedCells };
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

/**
 * Given a chosen group value from `groupSelectHtml` (a group id, or `'__ungrouped__'`), return whether a tab
 * with `groupId` belongs to it. Pure — shared by every screen's change handler so the membership rule is one
 * place. `'__ungrouped__'` matches tabs with no group; a real id matches exactly.
 */
export function tabInGroup(groupId, chosen) {
  if (!chosen) return false;
  return chosen === '__ungrouped__' ? !groupId : groupId === chosen;
}

/**
 * Storage-pressure level for the Load Manager Browser gauge (item #3): 'ok' (<70% of the warning ceiling),
 * 'near' (70-99%), or 'full' (>=100%). Pure so the thresholds are unit-tested. `used`/`warn` are byte counts.
 */
export function gaugeLevel(used, warn) {
  const w = Number(warn) || 0;
  if (w <= 0) return 'ok';
  const pct = (Number(used) || 0) / w;
  if (pct >= 1) return 'full';
  if (pct >= 0.7) return 'near';
  return 'ok';
}

/**
 * Human byte size for the storage-weight column ("12 KB", "1.4 MB"). Pure. < 1 KB rounds up to "1 KB" so a
 * non-empty diagram never reads "0 KB". Returns '' for a non-finite/negative input.
 */
export function formatBytes(bytes) {
  const b = Number(bytes);
  if (!Number.isFinite(b) || b < 0) return '';
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}

/**
 * Merge a remote Custom Templates library into the local one with DELETE PROPAGATION via tombstones (item 17,
 * v1.17.0). Pure + dependency-injected (`sigOf(template)` = content signature) so it's unit-testable.
 *
 * Both sides carry `templates` + a `deleted` tombstone list (`{id, name, deletedAt}`). The merge:
 *   1. Unions the tombstones (newest `deletedAt` per id) and prunes any older than `ttlMs` (vs `now`).
 *   2. Additively unions the templates (local first; new remote ones added; content/id dups skipped) -
 *      EXCEPT any id present in the combined tombstone set, which is removed (a delete propagates).
 *   3. Caps at `max`, newest `createdAt` first.
 *
 * Returns { templates, deleted, incomingDeletions, changed }. `incomingDeletions` = templates still present
 * locally that a REMOTE tombstone (one the local side didn't have) would remove - the caller confirms these
 * with the user before applying (or "Keep" to resurrect). `changed` = the local templates OR tombstones differ.
 */
export function mergeTemplatesWithTombstones({ localTemplates = [], localDeleted = [], remoteTemplates = [], remoteDeleted = [], sigOf, max = Infinity, now = 0, ttlMs = Infinity } = {}) {
  const arr = (a) => (Array.isArray(a) ? a : []);
  // 1) Combine tombstones (newest per id), prune stale ones.
  const tomb = new Map();
  for (const d of [...arr(localDeleted), ...arr(remoteDeleted)]) {
    if (!d || d.id == null) continue;
    const prev = tomb.get(d.id);
    if (!prev || (d.deletedAt || 0) > (prev.deletedAt || 0)) tomb.set(d.id, { id: d.id, name: d.name, deletedAt: d.deletedAt || 0 });
  }
  const deleted = [...tomb.values()].filter((d) => (now && ttlMs !== Infinity) ? (now - (d.deletedAt || 0)) <= ttlMs : true);
  const deletedIds = new Set(deleted.map((d) => d.id));
  const localDeletedIds = new Set(arr(localDeleted).map((d) => d && d.id));

  // 2) Additive union minus tombstoned ids; track local templates removed by a REMOTE-only tombstone.
  const out = [];
  const ids = new Set();
  const sigs = new Set();
  const incomingDeletions = [];
  for (const t of arr(localTemplates)) {
    if (!t) continue;
    if (t.id != null && deletedIds.has(t.id)) {
      if (!localDeletedIds.has(t.id)) incomingDeletions.push(t);   // deleted on another device → confirm before removing here
      continue;
    }
    if (t.id != null) ids.add(t.id);
    sigs.add(sigOf(t));
    out.push(t);
  }
  for (const t of arr(remoteTemplates)) {
    if (!t || (t.id != null && ids.has(t.id))) continue;
    if (t.id != null && deletedIds.has(t.id)) continue;            // tombstoned remote template → don't resurrect
    const s = sigOf(t);
    if (sigs.has(s)) continue;
    out.push(t); if (t.id != null) ids.add(t.id); sigs.add(s);
  }
  // 3) cap to the newest `max`, then sort CANONICALLY (createdAt asc, id asc) so two devices converge on the
  //    SAME order → the push dedupe-hash matches and no-op pull→push doesn't churn a revision (review finding).
  let templates = out;
  if (out.length > max) templates = out.slice().sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0)).slice(0, max);
  templates = templates.slice().sort((a, b) => (a?.createdAt || 0) - (b?.createdAt || 0) || String(a?.id).localeCompare(String(b?.id)));

  // `changed` is order-INSENSITIVE (set membership): a pure reorder must not rewrite the local library, so the
  // user's stencil order is preserved until a real add/remove. Compares template id-sets + tombstone id-sets.
  const sameSet = (a, b) => { const x = a.slice().sort(); const y = b.slice().sort(); return x.length === y.length && x.every((v, i) => v === y[i]); };
  const changed = !sameSet(templates.map((t) => t && t.id), arr(localTemplates).map((t) => t && t.id))
    || !sameSet(deleted.map((d) => d.id), arr(localDeleted).map((d) => d && d.id));
  return { templates, deleted, incomingDeletions, changed };
}

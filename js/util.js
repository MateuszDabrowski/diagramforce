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
 * The single implementation of the CLAUDE.md-documented colour-sanitization primitive. Strips every character
 * outside the safe CSS/SVG colour set before a value is interpolated into a style string or an SVG attribute.
 * Keeps hex, rgb()/hsl() function syntax, `%`, whitespace (needed INSIDE rgb(...)/hsl(...)), and CSS `var()`;
 * drops anything an attacker could use to break out of the value (quotes, `;`, `<`, `>`, `url(`, backslashes).
 * Coerces to string + trims so a null never throws and surrounding whitespace never leaks; returns `fallback`
 * when nothing safe survives. This is a security boundary — keep it as the ONE copy (see M3).
 */
export function sanitizeCssColor(color, fallback = '') {
  const s = String(color || '').replace(/[^a-zA-Z0-9#(),.\s%-]/g, '').trim();
  return s || fallback;
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
    architecture: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="0.5" y="1.5" width="5.5" height="4" rx="1"/><rect x="0.5" y="10.5" width="5.5" height="4" rx="1"/><rect x="10" y="6" width="5.5" height="4" rx="1"/><path d="M6 3.5 H8 V8 H10 M6 12.5 H8 V8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
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
/** Mode C: a VIEW FORK is the user's OWN file - it has its own My-Drive master (`driveFileId`) yet keeps a refresh-only
 *  VIEW `driveSharedSource` pointer (canEdit !== true) to the original it was forked from. It is NOT a "shared with you"
 *  file: the chip/pill renderers use this to suppress the Shared-File chip + Copy/Collab pill (mirrors the same
 *  carve-out in `tabShareRole`). An un-forked view (no own master) or a Collab working copy (editable) is NOT a fork. */
export function isViewForkTab(t) {
  return !!(t && t.driveFileId && t.driveSharedSource && t.driveSharedSource.canEdit !== true);
}

/** Deterministic JSON: deep-sorts object keys so two cells from different serializations (or app versions) compare
 *  equal when their content is equal. Used by diffGraphs. */
export function stableStringify(v) {
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
// STRUCTURAL, layout-independent diff (v1.19.0.30). Returns added/changed (CURRENT cell ids), removed (BASE
// ids) + removedCells (BASE cell objects, for the ghost overlay). Two improvements over a naive id+whole-cell
// compare: (1) LAYOUT is ignored - position / z / angle / link vertices never count as a change, so moving a
// shape or re-laying-out (or shifting) the WHOLE diagram reads as "no change". (2) Shapes are matched ACROSS
// the two diagrams even when their ids differ (two diagrams built independently from the same source have
// content-equal cells with different ids): elements pair by id, then by layout-stripped content signature;
// links then pair by their endpoints REMAPPED through that element correspondence. So the diff focuses on the
// genuine content/structure delta, not the layout. (Was: id-only match + whole-cell stringify -> a shifted or
// independently-built copy lit up every shape.)
export function diffGraphs(base, current) {
  const cellsOf = (g) => (g && Array.isArray(g.cells) ? g.cells : []).filter((c) => c && c.id != null);
  const baseCells = cellsOf(base), curCells = cellsOf(current);
  const isLink = (c) => !!(c && (c.source || c.target));
  // VIEW-STATE props - excluded from the diff ENTIRELY (a move, a collapse, a "key fields only" toggle is not a
  // content change). My Templates also regenerates every cell id on capture/drop, so the per-cell `id` + the
  // structural id-refs (`parent`/`embeds`, link `source`/`target`) are matched/canonicalised, never compared raw.
  const VIEW = new Set(['position', 'z', 'angle', 'collapsed', 'keyFieldsOnly']);
  const stripView = (c) => { const o = {}; for (const k in (c || {})) if (!VIEW.has(k)) o[k] = c[k]; return o; };
  // Cross-id MATCH signature: VIEW + id/parent/embeds removed (a faithful clone has identical content, fresh ids).
  const elemSig = (c) => { const o = stripView(c); delete o.id; delete o.parent; delete o.embeds; return stableStringify(o); };
  // Looser identity key for an EDITED clone (content not byte-identical): type + its name/label.
  const labelKey = (c) => { const a = c.attrs || {}; const t = String(c.objectName ?? a.headerLabel?.text ?? a.label?.text ?? a.text?.text ?? c.personName ?? c.tableLabel ?? '').trim(); return t ? `${c.type}|${t.toLowerCase()}` : null; };

  const elemsA = baseCells.filter((c) => !isLink(c)), elemsB = curCells.filter((c) => !isLink(c));
  const linksA = baseCells.filter(isLink), linksB = curCells.filter(isLink);
  const corr = new Map();      // base id -> current id (the SAME shape across the two diagrams)
  const matchedB = new Set();  // current ids already paired
  const changed = new Set();
  const remapId = (id) => (corr.has(id) ? corr.get(id) : id);
  const elemBById = new Map(elemsB.map((c) => [c.id, c]));

  // Pair still-unmatched A elements to still-unmatched B elements by a key fn (skips null keys + paired cells).
  const pairBy = (keyFn) => {
    const m = new Map();
    for (const cb of elemsB) { if (matchedB.has(cb.id)) continue; const k = keyFn(cb); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(cb); }
    for (const ca of elemsA) { if (corr.has(ca.id)) continue; const k = keyFn(ca); if (k == null) continue; const bucket = m.get(k); if (bucket && bucket.length) { const cb = bucket.shift(); corr.set(ca.id, cb.id); matchedB.add(cb.id); } }
  };
  // Pass 1: by ID (same diagram, edited). Pass 2: by exact content signature (a faithful clone, regenerated ids).
  // Pass 3: by loose name key (an EDITED clone - paired so the edit reads as one "changed", not add+remove).
  for (const ca of elemsA) { const cb = elemBById.get(ca.id); if (cb) { corr.set(ca.id, cb.id); matchedB.add(cb.id); } }
  pairBy(elemSig);
  pairBy(labelKey);

  // Element "changed": a matched pair that still differs once VIEW-state is stripped AND parent/embeds are
  // canonicalised into the current id-space + order-normalised (so SAME containment via different child ids isn't
  // a false change). A sig-matched pair is equal by construction; id-/label-matched pairs may genuinely differ.
  for (const ca of elemsA) {
    const bid = corr.get(ca.id); if (bid == null) continue;
    const cb = elemBById.get(bid); if (!cb) continue;
    const caCanon = stripView(ca); delete caCanon.id;
    if (caCanon.parent != null) caCanon.parent = remapId(caCanon.parent);
    if (Array.isArray(caCanon.embeds)) caCanon.embeds = caCanon.embeds.map(remapId).sort();
    const cbCanon = stripView(cb); delete cbCanon.id;
    if (Array.isArray(cbCanon.embeds)) cbCanon.embeds = cbCanon.embeds.slice().sort();
    if (stableStringify(caCanon) !== stableStringify(cbCanon)) changed.add(bid);
  }

  // Links matched by ENDPOINTS - the cell id remapped through corr; the field-port fid is STABLE across a clone.
  const endKey = (l, remap) => { const s = l.source || {}, t = l.target || {}; const sid = remap ? remapId(s.id) : s.id, tid = remap ? remapId(t.id) : t.id; return `${sid ?? ''}:${s.port || ''}>${tid ?? ''}:${t.port || ''}`; };
  const linkSig = (l) => { const o = stripView(l); delete o.id; delete o.source; delete o.target; delete o.vertices; return stableStringify(o); };
  const linkBByEnds = new Map();
  for (const lb of linksB) { const k = endKey(lb, false); if (!linkBByEnds.has(k)) linkBByEnds.set(k, []); linkBByEnds.get(k).push(lb); }
  for (const la of linksA) { const bucket = linkBByEnds.get(endKey(la, true)); if (bucket && bucket.length) { const lb = bucket.shift(); corr.set(la.id, lb.id); matchedB.add(lb.id); if (linkSig(la) !== linkSig(lb)) changed.add(lb.id); } }

  // Leftovers: genuinely added (current, unpaired) / removed (base, unpaired).
  const added = new Set(), removed = new Set(), removedCells = [];
  for (const cb of curCells) if (!matchedB.has(cb.id)) added.add(cb.id);
  for (const ca of baseCells) if (!corr.has(ca.id)) { removed.add(ca.id); removedCells.push(ca); }
  return { added, removed, changed, removedCells };
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

/** Render a GitHub-Flavored-Markdown table from `headers` (string[]) + `rows` (cell[][]).
 *  Cells are coerced to string; a pipe is escaped (`\|`) and newlines become `<br>` so a multi-line
 *  cell stays inside one GFM row. A boolean coerces to ✓ / blank (nicer than "true"/"false" in docs).
 *  An optional `title` is emitted as a `### ` heading above the table. Returns '' for no headers. */
export function toMarkdownTable(headers, rows = [], title = '') {
  const cols = Array.isArray(headers) ? headers : [];
  if (!cols.length) return '';
  const cell = (v) => {
    if (typeof v === 'boolean') return v ? '✓' : '';
    return String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();
  };
  const head = `| ${cols.map(cell).join(' | ')} |`;
  const sep = `| ${cols.map(() => '---').join(' | ')} |`;
  const body = (Array.isArray(rows) ? rows : []).map((r) => `| ${(Array.isArray(r) ? r : []).map(cell).join(' | ')} |`);
  const table = [head, sep, ...body].join('\n');
  return title ? `### ${cell(title)}\n\n${table}` : table;
}

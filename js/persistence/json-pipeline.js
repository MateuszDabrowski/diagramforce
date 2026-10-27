// JSON pipeline — untrusted-graph sanitisation + the load/import path for every
// Diagramforce file format (single diagram, export bundle, templates), driven by
// the Load manager's File and Paste panes and a window drop (loadJSONText
// + describePastedJSON). Extracted
// from persistence.js (Phase 3, Slice 2). sanitizeGraphJSON is PURE (consts only)
// so unit tests reach it through the facade with no init(). Everything else is
// runtime-only and reads live state/callbacks from the persistence context (pctx);
// version checks + dedup signatures come from the leaf versioning module.

import { contentSignature, checkVersionWarning } from './versioning.js?v=1.26.6';
import { normalizeDateSuffix } from '../util.js?v=1.26.6';
import { escHtml } from '../util.js?v=1.26.6';
import { showToast, showError } from '../feedback.js?v=1.26.6';
import { pctx } from './context.js?v=1.26.6';
import { slimForShare } from '../share-codec.js?v=1.26.6';
// The allowlist + cap live in a ZERO-dep leaf (diagram-schema.js) so the dev validator (dev/scripts/validate-diagram.mjs)
// and this loader share ONE source of truth - add a new shape there and both update. (S4/v1.12.0 allowlist; drops any
// cell whose type isn't registered, so a crafted share URL can't ship an unknown type the renderer never expected.)
import { ALLOWED_CELL_TYPES, MAX_CELL_COUNT } from './diagram-schema.js?v=1.26.6';
import { widenZonesForJoinLanes } from '../canvas/join-lanes.js?v=1.26.6';

/** Sanitise graph JSON from untrusted sources (share URLs, imports).
 *  Strips event-handler attributes and javascript: URIs to prevent XSS. */

// SVG elements a cell's `markup` may build. Serialised markup is legitimately there - link labels (rect + text), port
// groups (rect / circle), the shipped templates (rect, text, title, circle) - so it cannot simply be deleted. But JointJS
// builds every node with createElementNS, so an unchecked `markup` let a share link, paste, postMessage or Drive file
// put <script>, <foreignObject> + <iframe> (frame-src allows docs/drive.google.com) or a full-canvas <a> on the canvas
// (audit 2026-09-23, P1-14). Anything outside this set is dropped with its subtree.
const SAFE_MARKUP_TAGS = new Set([
  'g', 'rect', 'circle', 'ellipse', 'line', 'path', 'polygon', 'polyline', 'text', 'tspan', 'title', 'desc',
  'image', 'use', 'defs', 'clipPath', 'linearGradient', 'radialGradient', 'stop',
]);
const SVG_NS = 'http://www.w3.org/2000/svg';
// Deeper than any real diagram nests; a crafted file past it is rejected with a message instead of a RangeError.
const MAX_JSON_DEPTH = 64;
// Keys whose STRING value is free text the user typed - rendered as SVG text, never dereferenced as a URL - so text
// that merely STARTS with "JavaScript:" ("JavaScript: upgrade LWC libraries") survives instead of being blanked on
// every reload. Exempt only when the value IS a string: an object under one of these keys (attrs.text is the
// link-label selector) is still scanned like any other.
const FREE_TEXT_KEYS = new Set([
  'text', 'rows', 'tableLabel', 'taskName', 'taskLabel', 'taskDescription', 'description', 'name', 'label', 'value',
  'subtitle', 'title', 'notes', 'note', 'comment', 'apiName', 'helpText', 'assignee', 'pillText', 'sampleValues',
]);

/** Script-bearing URI after the characters a URL parser ignores (tabs, newlines, NULs, spaces, C1 controls) are gone:
 *  `java\tscript:` and `\x01javascript:` are both `javascript:` to the browser. */
function isScriptUri(val) {
  const squashed = String(val).replace(/[\u0000-\u0020\u007f-\u009f]/g, '').toLowerCase();
  return squashed.startsWith('javascript:') || squashed.startsWith('vbscript:') || squashed.startsWith('data:text/html');
}

/** Keep only safe SVG nodes in a JointJS markup array (recursively), and strip their risky attributes. Returns the
 *  cleaned array, or undefined when nothing safe is left. A STRING markup is refused outright: JointJS parses it as
 *  raw SVG/HTML, and the app never writes one. */
function sanitizeMarkup(markup, depth) {
  if (depth > MAX_JSON_DEPTH) throw new Error('Diagram JSON is nested too deeply.');
  if (!Array.isArray(markup)) {
    if (markup && typeof markup === 'object') return sanitizeMarkup([markup], depth);
    return undefined;
  }
  const out = [];
  for (const node of markup) {
    if (!node || typeof node !== 'object' || typeof node.tagName !== 'string') continue;
    if (!SAFE_MARKUP_TAGS.has(node.tagName)) continue;
    if (node.namespaceURI != null && node.namespaceURI !== SVG_NS) continue;
    const clean = { ...node };
    if (clean.attributes && typeof clean.attributes === 'object') {
      const attrs = {};
      for (const [k, v] of Object.entries(clean.attributes)) {
        if (/^on/i.test(k)) continue;
        if (typeof v === 'string' && isScriptUri(v)) continue;
        // <use> may only point inside the document; anything else could pull in outside markup.
        if (node.tagName === 'use' && /href$/i.test(k) && !String(v).startsWith('#')) continue;
        attrs[k] = v;
      }
      clean.attributes = attrs;
    }
    if (clean.children !== undefined) {
      const kids = sanitizeMarkup(clean.children, depth + 1);
      if (kids) clean.children = kids; else delete clean.children;
    }
    out.push(clean);
  }
  return out.length ? out : undefined;
}

/** Break `parent` loops. A self-parent or an A<->B loop loads, is saved, and then hangs the tab on the first drag
 *  (JointJS walks ancestors with no visited set) - on every reload (audit 2026-09-23, P1-16). Each loop is cut at the
 *  cell where the walk closes it; returns how many were cut. */
function breakParentCycles(cells) {
  const byId = new Map();
  for (const c of cells) if (c && c.id != null) byId.set(c.id, c);
  const settled = new Set();
  let cut = 0;
  for (const start of cells) {
    if (!start || start.id == null || settled.has(start.id)) continue;
    const path = new Set();
    let cur = start;
    while (cur && cur.parent != null && !settled.has(cur.id)) {
      path.add(cur.id);
      if (cur.parent === cur.id || path.has(cur.parent)) {
        const p = byId.get(cur.parent);
        if (p && Array.isArray(p.embeds)) p.embeds = p.embeds.filter((id) => id !== cur.id);
        delete cur.parent;
        cut++;
        break;
      }
      cur = byId.get(cur.parent);
    }
    for (const id of path) settled.add(id);
  }
  return cut;
}

/** Sanitise graph JSON from untrusted sources (share URLs, imports, Drive files, templates, session restore).
 *  Drops unsafe markup, event handlers and script URIs, dangling references and parent loops. `keepUnknownTypes`
 *  (session restore only) leaves cells of an unregistered type in place, so a diagram written by a NEWER release is
 *  kept for the load guard to protect instead of being silently thinned on the next save. */
export function sanitizeGraphJSON(graphData, { keepUnknownTypes = false, stats = null } = {}) {
  if (!graphData || !Array.isArray(graphData.cells)) return graphData;
  if (graphData.cells.length > MAX_CELL_COUNT) {
    throw new Error(`Diagram exceeds maximum element count (${MAX_CELL_COUNT}).`);
  }
  const stripAttrs = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object') return;
    if (depth > MAX_JSON_DEPTH) throw new Error('Diagram JSON is nested too deeply.');
    for (const key of Object.keys(obj)) {
      // Drop prototype-pollution vectors from untrusted JSON.
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        delete obj[key];
        continue;
      }
      // Remove event handler attributes (onclick, onload, etc.)
      if (/^on[a-z]/i.test(key)) { delete obj[key]; continue; }
      const val = obj[key];
      // A df.Table `rows` grid is free text cell by cell (rendered as SVG text): keep it whole while it IS a grid of
      // plain values; anything else under `rows` is scanned like any other object.
      if (key === 'rows' && Array.isArray(val)
          && val.every((r) => Array.isArray(r) && r.every((x) => x == null || typeof x !== 'object'))) continue;
      // JointJS special attribute `html` writes raw HTML into the node. The app never sets it.
      if (key === 'html') { delete obj[key]; continue; }
      if (key === 'markup') {
        const clean = sanitizeMarkup(val, depth + 1);
        if (clean) obj[key] = clean; else delete obj[key];
        continue;
      }
      // A marker or gradient definition names the element JointJS creates by its `type`.
      if (val && typeof val === 'object' && !Array.isArray(val) && typeof val.type === 'string'
          && (/Marker$/.test(key) || key === 'fill' || key === 'stroke')
          && !SAFE_MARKUP_TAGS.has(val.type) && !['path', 'circle', 'rect', 'ellipse', 'polygon', 'polyline', 'image'].includes(val.type)) {
        delete obj[key];
        continue;
      }
      if (typeof val === 'string') {
        // Free text keeps its words; every other string (url / href / xlink:href / src / style / any unknown
        // attribute) has a script URI neutralised. data:image/* is intentionally left intact - image cells rely on it.
        if (!FREE_TEXT_KEYS.has(key) && isScriptUri(val)) obj[key] = '';
      } else if (typeof val === 'object' && val !== null) {
        stripAttrs(val, depth + 1);
      }
    }
  };
  // S4 (v1.12.0) — drop any cell whose type isn't in the registered shape
  // allowlist. Closes the fuzzing surface where a crafted share URL could
  // ship a cell with an unknown `type` that JointJS would silently render
  // with default attrs (or worse, with attrs the app's renderer never
  // expected to handle). Name no type — a noisy error would help an
  // attacker probe the allowlist boundaries. `stats` (an object the caller
  // passes) gets counts only, so a load can say what it skipped (review D9).
  if (stats) Object.assign(stats, { unknownShapes: 0, unknownLinks: 0, danglingLinks: 0 });
  graphData.cells = graphData.cells.filter((c) => {
    if (c && typeof c === 'object' && typeof c.type === 'string' && (keepUnknownTypes || ALLOWED_CELL_TYPES.has(c.type))) return true;
    if (stats) { if (c?.source || c?.target) stats.unknownLinks++; else stats.unknownShapes++; }
    return false;
  });
  // S5 (v1.15.5) — drop links whose source/target references a cell that isn't
  // present. An LLM-authored diagram frequently names an object in a link that
  // it never actually defines (or mistypes the id) — exactly the Gemini failure
  // mode. Without this guard, graph.fromJSON throws "LinkView: invalid target
  // cell" and the ENTIRE diagram fails to load; one dangling reference
  // shouldn't sink an otherwise-valid diagram, so we drop just the bad link.
  // Point endpoints ({x,y} with no id) and same-file references are untouched.
  const validIds = new Set();
  for (const c of graphData.cells) { if (c.id != null) validIds.add(c.id); }
  const droppedLinkIds = [];
  graphData.cells = graphData.cells.filter((c) => {
    const srcId = c.source?.id, tgtId = c.target?.id;
    if ((srcId != null && !validIds.has(srcId)) || (tgtId != null && !validIds.has(tgtId))) {
      droppedLinkIds.push(c.id ?? '(unnamed link)');
      return false;
    }
    return true;
  });
  if (stats) stats.danglingLinks = droppedLinkIds.length;
  if (droppedLinkIds.length) {
    console.warn(
      `Diagramforce: skipped ${droppedLinkIds.length} link(s) referencing a missing cell:`,
      droppedLinkIds,
    );
  }
  // S6 (v1.19.0) — strip a `parent` that references a cell which ISN'T present, and prune `embeds` of any
  // missing child. An LLM / template author routinely sets a link or element `parent` to a SEMANTIC id
  // ("zone-orchestration", "container-…") that never matches a real cell id. This is not cosmetic: JointJS's
  // embed() reads the `parent` ATTRIBUTE. On a node drag, JointJS re-homes the node's connected LINKS to their
  // endpoints' common ancestor (link.reparent → ancestor.embed(link)); a link whose `parent` attr is set but
  // whose parent CELL is missing makes getParentCell() null, so reparent SKIPS the unembed yet still calls
  // embed() — which throws "Embedding of already embedded cells is not allowed." That throw is UNCAUGHT on
  // pointerup, wedging JointJS's drag state → the whole canvas freezes (no selection, no Cmd+A) until reload.
  // Dropping the orphan parent makes the cell free and the reparent a clean no-op. (Reported: "moving a node
  // over a container that is over a zone freezes" — the dragged node's link endpoints resolved to the real
  // container as common ancestor, tripping the stale-parent reparent.)
  const presentIds = new Set();
  for (const c of graphData.cells) { if (c.id != null) presentIds.add(c.id); }
  let strippedParents = 0;
  for (const c of graphData.cells) {
    if (c.parent != null && !presentIds.has(c.parent)) { delete c.parent; strippedParents++; }
    if (Array.isArray(c.embeds)) {
      const kept = c.embeds.filter((id) => presentIds.has(id));
      if (kept.length !== c.embeds.length) c.embeds = kept;
    }
  }
  if (strippedParents) {
    console.warn(`Diagramforce: stripped ${strippedParents} dangling parent reference(s) (parent cell not found).`);
  }
  const cycles = breakParentCycles(graphData.cells);
  if (cycles) console.warn(`Diagramforce: cut ${cycles} parent loop(s) (a cell nested inside itself).`);
  for (const cell of graphData.cells) { stripAttrs(cell); }
  return graphData;
}

/**
 * Shrink a graph JSON for persistence — named saves, JSON export, AND the session auto-save —
 * by dropping data the app fully reconstructs on load. Works for **every diagram type**, not
 * just datamapping.
 *
 * Two lossless layers (lossless because their reconstruction all runs on the COMMON load path —
 * `fromJSON` + `migrateLinks` + `migrateNodes`, which includes `refreshAllIconHrefs` and
 * `_syncFieldPorts` — the same path named-save load / JSON import / session restore use):
 *   1. **`slimForShare`** (share-codec) — the exact slimmer already proven on share URLs. For
 *      ALL shapes it drops a default `ports`/`size` block, `angle:0`, mapping-link routing, and
 *      icon artwork (→ a compact `data-icon-id` placeholder the icon registry re-resolves).
 *   2. **DataObject `ports`** — slimForShare keeps these when they DIFFER from the shape default
 *      (the generated field/ER ports of datamodel/datamapping), but `_syncFieldPorts` rebuilds
 *      them on every load, so drop them too. This is the bulk of a field-heavy save (~87 % of a
 *      7-field object).
 *
 * `slimForShare` deep-clones, so the input is never mutated (safe on a shared in-memory
 * `tab.graphJSON`) and the delete below is free.
 *
 * Deliberately does NOT strip link `attrs`: `migrateLinks` is idempotent and does NOT rebuild a
 * mapping link's `line/stroke` (colour) or target arrow when they're absent, so stripping them
 * would be lossy (it would drop user colour / width customisations). Links stay verbatim.
 */
export function compactGraphForSave(graphJSON) {
  if (!graphJSON || !Array.isArray(graphJSON.cells)) return graphJSON;
  const out = slimForShare(graphJSON);
  for (const c of out.cells || []) {
    if (c && c.type === 'sf.DataObject') delete c.ports;
  }
  return out;
}

/** Restore a bundled diagram as a named browser save (collision-safe name).
 *  Non-destructive: doesn't touch open tabs — the diagram lands in
 *  Load → Load from Browser. Sanitises the (untrusted) graph first. The session archive on "Don't load"
 *  (session-store archiveSessionOnReset) passes the rest: `keepUnknownTypes` keeps cells of a type this build does not
 *  know (the session may come from a newer release), `overwrite` writes to exactly `name` (the tab's own archive,
 *  updated in place as a close does), and `extra` adds fields such as the Drive link (the fields below win). */
export function restoreDiagramAsSave(name, diagramType, graphJSON, viewport, appVersion, mappingMode, group = null, { keepUnknownTypes = false, overwrite = false, extra = null } = {}) {
  const { normalizeDiagramType, namedSavePrefix: NAMED_SAVE_PREFIX, appVersion: APP_VERSION } = pctx;
  if (!graphJSON) return false;
  try { sanitizeGraphJSON(graphJSON, { keepUnknownTypes }); } catch { return false; }
  const base = normalizeDateSuffix(String(name || 'Imported')).slice(0, 80) || 'Imported';
  let finalName = overwrite ? String(name) : base;
  for (let n = 2; !overwrite && localStorage.getItem(NAMED_SAVE_PREFIX + finalName) !== null; n++) {
    finalName = `${base} (${n})`;
  }
  try {
    localStorage.setItem(NAMED_SAVE_PREFIX + finalName, JSON.stringify({
      ...(extra || {}),
      name: finalName,
      timestamp: Date.now(),
      diagramType: normalizeDiagramType(diagramType),
      mappingMode: !!mappingMode,
      graph: graphJSON,
      viewport: viewport || null,
      // Preserve the diagram's original version so re-imports stay honest;
      // fall back to the current app version when the source carried none.
      appVersion: appVersion || APP_VERSION,
      // An archive's tab-group meta (#7), so loading it later rejoins the group it was closed from.
      ...(group ? { group } : {}),
    }));
    return true;
  } catch (err) {
    // 'quota' is not "skipped - already saved": the caller reports full storage instead (audit 2026-09-23).
    return /quota/i.test(`${err?.name} ${err?.message}`) ? 'quota' : false;   // QuotaExceededError / NS_ERROR_DOM_QUOTA_REACHED
  }
}

/** The import dedup key: the content signature of the COMPACTED cells. Exports and named saves are compacted, an open
 *  tab's graph is live (`angle: 0`, default sizes, ports, icon art), so signing raw cells never matched an open tab.
 *  compactGraphForSave deep-clones: the graph passed in is never touched. A null or non-object cell is dropped first,
 *  as sanitizeGraphJSON drops it: slimForShare reads `cell.attrs` and threw on one, before the per-diagram try, so one
 *  null cell lost a whole bundle import with no message (review R1). */
export function importSignature(cells) {
  const objects = Array.isArray(cells) ? cells.filter((c) => c && typeof c === 'object') : [];
  return contentSignature(compactGraphForSave({ cells: objects }).cells);
}

/** An archive's `group` meta ({name, icon, color}) from an untrusted file, or null. A bare string is a group-bundle
 *  TAG, not meta (splitGroupBundle). */
function groupMetaOf(g) {
  if (!g || typeof g !== 'object' || typeof g.name !== 'string' || !g.name) return null;
  return { name: g.name.slice(0, 60), icon: typeof g.icon === 'string' ? g.icon : null, color: typeof g.color === 'string' ? g.color : null };
}

/**
 * Split a `kind:'group'` bundle's diagrams. A diagram TAGGED with a group name reopens as a tab in that group; an
 * untagged one follows the plain bundle rule (dedup, then browser saves). A file that tags no diagram is a legacy group
 * export, so all of them go to its group. `backup` = tagged and untagged together: only a full backup writes that
 * ("Export group" tags every diagram), and a backup restored into the browser that made it must not duplicate the
 * grouped tabs still open there. A backup since 2026-10-15 also says so (`backup: true`, read by loadJSONText): one
 * whose every tab is grouped, with no archive, has no untagged entry to tell it apart. Before this split, every untagged entry of a backup (ungrouped tabs, every closed
 * archive) opened as a tab and, with one group in the file, joined it (review D1, 2026-10-15).
 */
export function splitGroupBundle(diagrams) {
  const all = Array.isArray(diagrams) ? diagrams : [];
  const isTagged = (d) => typeof d?.group === 'string' && d.group !== '';
  const grouped = all.filter(isTagged);
  if (!grouped.length) return { grouped: all, loose: [], backup: false, tagged: false };
  const loose = all.filter((d) => !isTagged(d));
  return { grouped, loose, backup: loose.length > 0, tagged: true };
}

/** Content-signature + name sets of every existing diagram (open tabs + named
 *  saves) — the dedup reference for an import. */
function collectExistingDiagrams() {
  const { getAllTabs: getAllTabsCallback, getTabGraph: getTabGraphCallback, getNamedSaves, readNamedSave } = pctx;
  const sigs = new Set();
  const names = new Set();
  const tabSigs = new Set();   // open tabs only: what a backup's grouped diagrams are checked against
  for (const t of (getAllTabsCallback ? getAllTabsCallback() : [])) {
    if (t.name) names.add(t.name);
    const g = getTabGraphCallback ? getTabGraphCallback(t.id) : null;
    if (g?.cells) { const sig = importSignature(g.cells); sigs.add(sig); tabSigs.add(sig); }
  }
  for (const s of getNamedSaves()) {
    names.add(s.name);
    const d = readNamedSave(s.key);
    if (d?.graph?.cells) sigs.add(importSignature(d.graph.cells));
  }
  return { sigs, names, tabSigs };
}

/** Tell the user which diagrams of a multi-diagram file were skipped, and why. */
function reportRejected(rejected) {
  const names = rejected.slice(0, 3).map((r) => `"${r.name}"`).join(', ') + (rejected.length > 3 ? ` and ${rejected.length - 3} more` : '');
  showError(`Skipped ${rejected.length} diagram${rejected.length === 1 ? '' : 's'} that could not be loaded (${names}): ${rejected[0].reason}`);
}

/** Dedup + rename a bundle's diagrams against what already exists:
 *   - exact content match (same `graph.cells`) → **skipped** (no duplicate)
 *   - name match but different content → name gets **" (Restored)"**
 *  Also dedups within the file, and sanitises each kept graph. Returns the
 *  prepared `{name, diagramType, graph, viewport}` list to open or save. */
function prepareImportedDiagrams(rawDiagrams) {
  const { normalizeDiagramType } = pctx;
  const { sigs, names } = collectExistingDiagrams();
  const seen = new Set();
  const out = [];
  out.rejected = [];   // { name, reason } - one bad diagram must not abort the whole bundle
  for (const d of rawDiagrams) {
    const cells = d?.graph?.cells;
    if (!Array.isArray(cells)) continue;
    const sig = importSignature(cells);
    if (sigs.has(sig) || seen.has(sig)) continue;   // exact duplicate → skip
    seen.add(sig);
    // A throw here (over MAX_CELL_COUNT, nested too deeply) used to escape loadJSONText and abort EVERY diagram and
    // template in the backup with no message (audit 2026-09-23). Skip that one diagram and say so.
    try { sanitizeGraphJSON(d.graph); }
    catch (err) { out.rejected.push({ name: String(d.name || 'Imported'), reason: err.message }); continue; }
    let name = String(d.name || 'Imported').slice(0, 80) || 'Imported';
    if (names.has(name)) name = `${name} (Restored)`;
    names.add(name);
    out.push({ name, diagramType: normalizeDiagramType(d.diagramType), mappingMode: d.mappingMode || false, graph: d.graph, viewport: d.viewport || null, appVersion: d.appVersion || null, group: groupMetaOf(d.group) });
  }
  return out;
}

/** Dedup a bundle's diagrams, then land the new ones as browser saves. Reports skipped-as-unloadable diagrams and
 *  full storage itself. Returns `{ saved, storageFull, rejected }` (counts). */
function saveBundleDiagrams(rawDiagrams, bundleAppVersion) {
  const diagrams = prepareImportedDiagrams(rawDiagrams);   // dedup + rename + sanitise
  if (diagrams.rejected.length) reportRejected(diagrams.rejected);
  let saved = 0;
  let storageFull = 0;
  for (const d of diagrams) {
    // Preserve each diagram's own version, else the bundle's, else current.
    const r = restoreDiagramAsSave(d.name, d.diagramType, d.graph, d.viewport, d.appVersion || bundleAppVersion, d.mappingMode, d.group);
    if (r === true) saved++;
    else if (r === 'quota') storageFull++;
  }
  // A save that failed on FULL STORAGE is not an "already saved" skip - the summary would say it was.
  if (storageFull) showError(`Browser storage is full: ${storageFull} diagram${storageFull === 1 ? '' : 's'} from this file could not be saved. Free some space (Close & Delete) and import it again.`);
  return { saved, storageFull, rejected: diagrams.rejected.length };
}

/** Merge a file's templates into My Templates. Returns importTemplatesArray's tally `{ added, duplicates, full,
 *  invalid }`, so the summary and toasts can say why a template did not land (review D10). */
function mergeTemplates(rawTemplates) {
  const { templatesBackupApi } = pctx;
  const ts = { added: 0, duplicates: 0, full: 0, invalid: 0 };
  if (rawTemplates.length && templatesBackupApi?.importMerge) ts.added = templatesBackupApi.importMerge(rawTemplates, ts) || 0;
  return ts;
}

/** The import summary's template lines, from mergeTemplates' tally. */
const templateStats = (ts) => ({ templates: ts.added, templatesSkipped: ts.duplicates, templatesFull: ts.full, templatesInvalid: ts.invalid });

/**
 * The warning a single-diagram load or replace shows, or null when it has nothing to warn about (review D9).
 * `stats` is sanitizeGraphJSON's; `rawType` is the diagramType the file named. A named type normalizeDiagramType does
 * not know falls back to Architecture, so the warning says so. Counts only, never cell type names: the allowlist
 * stays unprobed, and `npm run validate` names them.
 */
export function loadWarning(verb, name, stats, rawType) {
  const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  const items = [];
  if (stats.unknownShapes) items.push(`${n(stats.unknownShapes, 'shape')} of an unknown type`);
  if (stats.unknownLinks) items.push(`${n(stats.unknownLinks, 'connector')} of an unknown type`);
  if (stats.danglingLinks) items.push(`${n(stats.danglingLinks, 'connector')} ${stats.unknownShapes ? 'to a missing shape' : "pointing to a shape that isn't in the file"}`);
  const list = items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0];
  const raw = rawType == null ? '' : String(rawType);
  const unknownType = raw !== '' && raw.toLowerCase() !== 'architecture' && pctx.normalizeDiagramType(raw) === 'architecture';
  if (unknownType) {
    return `${verb} "${name}" as Architecture: the file's diagramType "${raw.slice(0, 40)}" is not one Diagramforce knows.`
      + (list ? ` Skipped ${list}.` : '');
  }
  return list ? `${verb} "${name}" - skipped ${list}.` : null;
}

/**
 * Parse a JSON string and import it — handles every Diagramforce file format:
 *   - `diagramforce-export` bundle (+ legacy `diagramforce-diagrams`): diagrams
 *     are restored as named browser saves (then the Load-from-Browser modal
 *     opens so the user sees them); templates merged into the library.
 *   - `diagramforce-templates`: merged into the template library.
 *   - single diagram (`{graph,…}`): opened as a new tab (the original behaviour).
 * Used by the Load manager's File and Paste panes, a window drop and the postMessage import. Returns
 * true on success.
 */
/** An imported Data Mapping's zones grow by the room its join lanes need (join-lanes.js): SQL Studio 1.4.0 sends 48 px
 *  of padding, so the outer lanes drew on or past the dashed border. Imports only; a session restore keeps its zones. */
function fitJoinLanes(graph, diagramType) {
  if (diagramType === 'datamapping' && Array.isArray(graph?.cells)) widenZonesForJoinLanes(graph.cells);
}

export async function loadJSONText(jsonText, fallbackName, { singleDiagramOnly = false } = {}) {
  const { templatesBackupApi, showLoadModal: showLoadModalCallback, onImport: onImportCallback, normalizeDiagramType, graph, canvas: canvasModule } = pctx;
  let data;
  try { data = driveEnvelopeKeys(JSON.parse(jsonText)); }
  catch (err) { showError(`Failed to load ${fallbackName ? `"${fallbackName}"` : 'JSON'}: ${err.message}`); return false; }

  const isBundle = data?.schema === 'diagramforce-export' || data?.schema === 'diagramforce-diagrams'
    || (Array.isArray(data?.diagrams) && !data.graph);
  // Classify BEFORE the version check (review D8): a JSON that is no Diagramforce document has no appVersion, so it
  // raised the major "Compatibility Warning" first and only then "No graph data found".
  if (!isBundle && !data?.graph && !Array.isArray(data?.cells) && !Array.isArray(data?.templates)
      && data?.schema !== 'diagramforce-templates') {
    showError(`Failed to load ${fallbackName ? `"${fallbackName}"` : 'JSON'}: No graph data found in JSON.`);
    return false;
  }

  // Inside a try: a throw here rejected loadJSONText, and Paste > Load's click handler does not catch it.
  let okVer;
  try { okVer = await checkVersionWarning(data.appVersion || null, String(data.title || fallbackName || 'Imported'), data); }
  catch (err) { showError(`Failed to load ${fallbackName ? `"${fallbackName}"` : 'JSON'}: ${err.message}`); return false; }
  if (!okVer) return false;

  // A `kind:'group'` bundle (from "Export group") round-trips a whole working set:
  // recreate the group(s) and open each diagram as a grouped tab, rather than the
  // default bundle behaviour (land diagrams in browser saves).
  const isGroupBundle = isBundle && data.kind === 'group'
    && Array.isArray(data.groups) && data.groups.length > 0 && pctx.onImportGroup;
  const isTemplatesOnly = !isBundle && (data.schema === 'diagramforce-templates'
    || (Array.isArray(data.templates) && !data.graph && !Array.isArray(data.diagrams)));
  // The postMessage import (external-import.js) opens exactly one diagram, never writes saves or templates.
  if (singleDiagramOnly && (isBundle || isTemplatesOnly)) {
    showError('The site that opened Diagramforce sent a bundle or a templates file. Only a single diagram can be opened this way - import the file from Load & Import instead.');
    return false;
  }

  // ── Group bundle: recreate the group(s) + open the TAGGED diagrams as grouped tabs ──
  // Untagged diagrams (a full backup's ungrouped tabs and closed archives) follow the plain bundle rule instead.
  if (isGroupBundle) {
    const { normalizeDiagramType, onImportGroup } = pctx;
    const { grouped, loose, backup: mixed, tagged } = splitGroupBundle(data.diagrams);
    // Back up now writes `backup: true`. The tag mix alone misses a backup whose every entry is a grouped tab (R2).
    const backup = data.backup === true || mixed;
    const openSigs = backup ? collectExistingDiagrams().tabSigs : null;
    const diagrams = [];
    const rejected = [];
    let alreadyOpen = 0;
    for (const d of grouped) {
      if (!Array.isArray(d?.graph?.cells)) continue;
      if (openSigs && openSigs.has(importSignature(d.graph.cells))) { alreadyOpen++; continue; }
      // drop endpoint-less links etc. (same as every import path); one unloadable diagram is skipped, not fatal
      try { sanitizeGraphJSON(d.graph); }
      catch (err) { rejected.push({ name: String(d.name || 'Imported'), reason: err.message }); continue; }
      diagrams.push({
        name: String(d.name || 'Imported').slice(0, 80) || 'Imported',
        diagramType: normalizeDiagramType(d.diagramType),
        mappingMode: d.mappingMode || false,
        graph: d.graph,
        viewport: d.viewport || null,
        group: typeof d.group === 'string' ? d.group.slice(0, 60) : null,   // cut like the group names below, so they match
        appVersion: d.appVersion || data.appVersion || null,
      });
    }
    if (rejected.length) reportRejected(rejected);
    const groupMetas = data.groups.map(g => ({ name: String(g.name || 'Group').slice(0, 60), icon: g.icon || null, color: g.color || null }));
    // Recreate only the groups something opens into, or a backup restored where its grouped tabs are still open
    // leaves an empty "Project X 2". An untagged (legacy) file keeps its groups: its sole group takes every diagram.
    const usedMetas = tagged ? groupMetas.filter((gm) => diagrams.some((d) => d.group === gm.name)) : groupMetas;
    if (diagrams.length) onImportGroup(usedMetas, diagrams);
    const looseResult = loose.length ? saveBundleDiagrams(loose, data.appVersion) : { saved: 0, storageFull: 0, rejected: 0 };
    // A full backup can be a kind:'group' bundle that ALSO carries templates - import them too so a restore
    // doesn't silently drop the user's template library (item 4).
    const ts = mergeTemplates(Array.isArray(data.templates) ? data.templates : []);
    const tc = ts.added;
    // A backup: the Load > Browser summary says what opened, what was saved and what was already here.
    if (backup && showLoadModalCallback) {
      showLoadModalCallback({
        opened: diagrams.length,
        imported: looseResult.saved,
        skipped: alreadyOpen + Math.max(0, loose.length - looseResult.saved - looseResult.storageFull - looseResult.rejected),
        ...templateStats(ts),
      });
      return true;
    }
    if (diagrams.length === 0) {
      if (!rejected.length) showToast('No diagrams found in that group file.', 'warning');
      return true;
    }
    const gLabel = usedMetas.length === 1 ? `group "${usedMetas[0].name}"` : `${usedMetas.length} groups`;
    const tLabel = tc ? ` + ${tc} template${tc === 1 ? '' : 's'}` : '';
    showToast(`Imported ${gLabel} - ${diagrams.length} diagram${diagrams.length === 1 ? '' : 's'}${tLabel} ✓`, 'success');
    return true;
  }

  // ── Bundle: dedup + rename, restore to browser saves, then SHOW the user ──
  // Diagrams are saved to localStorage (not force-opened as tabs) and the
  // Load-from-Browser modal is opened so the user sees exactly where their
  // files landed and can pick what to open.
  if (isBundle) {
    const rawDiagrams = Array.isArray(data.diagrams) ? data.diagrams : [];
    const rawTemplates = Array.isArray(data.templates) ? data.templates : [];
    // A bundle that carries exactly ONE diagram (and no templates) opens DIRECTLY as a tab - same as a
    // single-diagram export - instead of landing in browser saves and reopening the Load manager (item 2). A
    // multi-diagram backup still lands in saves + shows the summary (you don't want 10 tabs forced open).
    if (rawDiagrams.length === 1 && rawTemplates.length === 0 && onImportCallback) {
      const d = rawDiagrams[0];
      if (Array.isArray(d?.graph?.cells)) {
        const stats = {};
        try { sanitizeGraphJSON(d.graph, { stats }); }
        catch (err) { showError(`Failed to load ${fallbackName ? `"${fallbackName}"` : 'JSON'}: ${err.message}`); return false; }
        fitJoinLanes(d.graph, normalizeDiagramType(d.diagramType));
        const nm = String(d.name || d.title || fallbackName || 'Imported').slice(0, 80) || 'Imported';
        // #7: a 1-diagram bundle's per-diagram `group` is a bare NAME tag (bundle meta lives in data.groups, handled
        // by the onImportGroup path above) - wrap it so recreate-or-rejoin works by name.
        const grp = typeof d.group === 'string' ? { name: d.group } : (d.group || null);
        onImportCallback(nm, normalizeDiagramType(d.diagramType), d.graph, d.viewport || null, d.mappingMode || false, null, grp);
        const warning = loadWarning('Loaded', nm, stats, d.diagramType);
        if (warning) showToast(warning, 'warning', { duration: 8000 });
        else showToast(`Loaded "${nm}" ✓`, 'success');
        return true;
      }
    }
    const { saved, storageFull, rejected } = saveBundleDiagrams(rawDiagrams, data.appVersion);
    const ts = mergeTemplates(rawTemplates);
    const tc = ts.added;

    // Import tally. "skipped" = file entries that did NOT become new saves
    // because an exact content-copy is already open (as a tab) or saved here.
    const stats = {
      imported: saved,
      skipped: Math.max(0, rawDiagrams.length - saved - storageFull - rejected),
      ...templateStats(ts),
    };

    // If the file carried diagrams, reveal the Load-from-Browser modal and let
    // it render an inline import summary at the top. That modal is the right
    // surface: the user is already looking there for their files, and the
    // summary explains why one may be absent from the list (it's an open tab,
    // or an exact duplicate). This replaces the fleeting toast for this path.
    if (rawDiagrams.length && showLoadModalCallback) {
      showLoadModalCallback(stats);
      return true;
    }

    // Templates-only file (no modal to host the banner), or no modal wired →
    // fall back to a toast.
    if (saved || tc) {
      const parts = [];
      if (saved) parts.push(`${saved} diagram${saved === 1 ? '' : 's'}`);
      if (tc) parts.push(`${tc} template${tc === 1 ? '' : 's'}`);
      showToast(`Restored ${parts.join(' and ')} ✓`, 'success');
    } else if (rawDiagrams.length || rawTemplates.length) {
      showToast('Everything in this file is already in your browser.', 'info');
    } else {
      showToast('Nothing to import from this file.', 'warning');
    }
    return true;
  }

  // ── Templates-only file ──
  if (isTemplatesOnly) {
    if (!templatesBackupApi?.importMerge) { showError('Templates import is unavailable.'); return false; }
    const ts = mergeTemplates(Array.isArray(data.templates) ? data.templates : []);
    const n = ts.added;
    const tpl = (k) => `${k} template${k === 1 ? '' : 's'}`;
    // A re-imported export is not "no valid templates" (review D10): say it is already here, or that the library is full.
    if (n === 0 && ts.full) return false;   // importTemplatesArray has already said the library is full
    if (n === 0 && ts.duplicates) {
      showToast(`Nothing new to import: ${tpl(ts.duplicates)} already in your library${ts.invalid ? `, ${ts.invalid} could not be read` : ''}.`, 'info');
      return true;
    }
    if (n === 0) { showError('No valid templates found in that file.'); return false; }
    if (ts.full) showToast(`Imported ${tpl(n)} - your template library is full, ${ts.full} more not imported.`, 'warning');
    else showToast(`Imported ${tpl(n)} ✓`, 'success');
    return true;
  }

  // ── Single diagram → new tab (original behaviour) ──
  // A BARE graph ({cells} with no `graph` envelope) is what JointJS's graph.toJSON() emits and what the validator
  // (diagram-schema.js validateDiagram) accepts; open it as the canonical {graph: {cells}} instead of failing with
  // "No graph data found" on a file the validator called valid.
  if (!data?.graph && Array.isArray(data?.cells)) {
    const { cells, ...rest } = data;
    data = { ...rest, graph: { cells } };
  }
  try {
    // `name` is the envelope a NAMED BROWSER SAVE uses (restoreDiagramAsSave writes {name, …}); `title` is
    // what an authored/exported file carries. Preferring both over the filename matters for the
    // domain-move rescue path, where the old host hands over raw named saves as .dgf files - without
    // this the tab was labelled "Marketing Journey.dgf", extension and all, instead of its real name.
    // String(): a numeric <label> in a Flow XML, or a numeric title in any JSON, became a numeric tab name, and the
    // tab bar's `.trim()` threw on it (audit 2026-09-23).
    const name = String(data.title || data.name || fallbackName || 'Imported');
    // What sanitise skipped (unknown-type cells, links to a missing shape - the common LLM-output errors), so the
    // user is told while the diagram still loads instead of failing wholesale.
    const stats = { unknownShapes: 0, unknownLinks: 0, danglingLinks: 0 };
    if (data?.graph) sanitizeGraphJSON(data.graph, { stats });   // a throw lands in the catch below, which reports it
    if (data?.graph) fitJoinLanes(data.graph, normalizeDiagramType(data.diagramType));
    if (onImportCallback && data?.graph) {
      // #7: a single-diagram file can carry its tab-group meta ({name,icon,color}) so import recreate-or-rejoins it.
      onImportCallback(name, normalizeDiagramType(data.diagramType), data.graph, data.viewport, data.mappingMode, null, data.group || null);
      // A generator that wrote rough positions asks for Auto Layout: the app proposes it, never runs it on its own.
      if (data.suggestAutoLayout === true) pctx.onSuggestAutoLayout?.(name);
    } else if (data?.graph) {
      canvasModule.setLoadingJSON(true);
      try { graph.fromJSON(data.graph); } finally { canvasModule.setLoadingJSON(false); }
      if (data?.viewport) canvasModule.setViewport(data.viewport);
    } else {
      throw new Error('No graph data found in JSON.');
    }
    const warning = loadWarning('Loaded', name, stats, data.diagramType);
    if (warning) showToast(warning, 'warning', { duration: 8000 });
    else showToast(`Loaded "${name}" ✓`, 'success');
    return true;
  } catch (err) {
    showError(`Failed to load ${fallbackName ? `"${fallbackName}"` : 'JSON'}: ${err.message}`);
    return false;
  }
}

/**
 * A Drive file (`.dgf`, remote-store currentDiagramData) names its type and version `type` and `av`; an export names
 * them `diagramType` and `appVersion`. The File pane, a drop and Paste read only the export keys, so a .dgf downloaded
 * from Drive and opened here raised the major Compatibility Warning ("unknown (no version)") and opened a data model as
 * architecture (owner, 2026-10-16). Fill the export keys from the Drive ones on a single-diagram envelope; an export's
 * own keys win. Returns the same object.
 */
export function driveEnvelopeKeys(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !data.graph) return data;
  if (data.diagramType == null && typeof data.type === 'string') data.diagramType = data.type;
  if (data.appVersion == null && typeof data.av === 'string') data.appVersion = data.av;
  return data;
}

/**
 * The one diagram a parsed document holds, or null. Two shapes qualify: a single-diagram file (`{graph:{cells}}`), and
 * an export bundle carrying exactly one diagram and no templates (loadJSONText opens that one as a tab too). Returns
 * `{ graph, diagramType, name, appVersion }` with `diagramType` as written (undefined when the file names none). Pure:
 * the Paste pane's Replace gate and replaceActiveWithJSONText read the same answer.
 */
export function singleDiagramOf(data) {
  if (!data || typeof data !== 'object') return null;
  if (Array.isArray(data.graph?.cells)) {
    return { graph: data.graph, diagramType: data.diagramType || undefined, name: data.title || data.name, appVersion: data.appVersion };
  }
  // A bare graph ({cells}, no envelope) is one diagram too - as loadJSONText opens it.
  if (!data.graph && Array.isArray(data.cells) && !Array.isArray(data.diagrams) && !Array.isArray(data.templates)) {
    return { graph: { cells: data.cells }, diagramType: data.diagramType || undefined, name: data.title || data.name, appVersion: data.appVersion };
  }
  const ds = Array.isArray(data.diagrams) ? data.diagrams : null;
  const ts = Array.isArray(data.templates) ? data.templates : [];
  if (ds && ds.length === 1 && ts.length === 0 && Array.isArray(ds[0]?.graph?.cells)) {
    const d = ds[0];
    return { graph: d.graph, diagramType: d.diagramType || undefined, name: d.name || d.title, appVersion: d.appVersion || data.appVersion };
  }
  return null;
}

/**
 * Replace the ACTIVE tab's content with a pasted diagram, in place: the tab keeps its name, type, group and Drive
 * link, so the next save writes the new content to the same file (Drive keeps the old one in its version history).
 * For iterating on a diagram with an LLM - export, have it edited, paste it back - without a new tab and a new Drive
 * file each round. Only a diagram of the tab's own type is accepted: the type is fixed when a tab is made (stencil,
 * type tools), and a file that names no type takes the tab's. tabs.js does the swap as ONE undo step and a real edit
 * (dirty, Drive autosave, the view-share fork). Returns true when the swap ran or is waiting on the table-edit guard.
 */
export async function replaceActiveWithJSONText(jsonText) {
  const { normalizeDiagramType, diagramTypeCb, tabNameCb, onReplaceContent } = pctx;
  let data;
  try { data = driveEnvelopeKeys(JSON.parse(jsonText)); }
  catch (err) { showError(`Failed to read the JSON: ${err.message}`); return false; }
  const d = singleDiagramOf(data);
  if (!d) { showError('Replace takes a single diagram. Use Load for a bundle or a templates file.'); return false; }
  const tabType = diagramTypeCb ? diagramTypeCb() : 'architecture';
  if (d.diagramType && normalizeDiagramType(d.diagramType) !== tabType) {
    showError(`The open tab is a ${tabType} diagram and this JSON is ${normalizeDiagramType(d.diagramType)}. Use Load to open it in a new tab.`);
    return false;
  }
  const okVer = await checkVersionWarning(d.appVersion || null, String(d.name || 'Pasted'), data);
  if (!okVer) return false;
  const stats = {};
  try { sanitizeGraphJSON(d.graph, { stats }); }
  catch (err) { showError(`Failed to load the pasted diagram: ${err.message}`); return false; }
  fitJoinLanes(d.graph, normalizeDiagramType(d.diagramType));
  if (!onReplaceContent) { showError('Replace is unavailable.'); return false; }
  const name = tabNameCb ? tabNameCb() : 'Diagram';
  return onReplaceContent(d.graph, () => {
    const warning = loadWarning('Replaced', name, stats, d.diagramType);
    if (warning) {
      showToast(warning, 'warning', { duration: 8000 });
    } else {
      showToast(`Replaced "${name}" ✓ - Undo brings the old version back.`, 'success');
    }
  });
}

/**
 * Classify pasted text as Diagramforce JSON (single diagram, bare `{cells}` graph, export bundle, templates file) for the unified
 * Load-from-Paste modal's live feedback. Returns { ok: true, label } (HTML, safe to inject) or { ok: false,
 * error } (plain text). The same shapes `loadJSONText` accepts. Mermaid is detected separately (mermaid-import).
 */
export function describePastedJSON(text) {
  const { normalizeDiagramType } = pctx;
  const t = (text || '').trim();
  if (!t) return { ok: false, error: 'Empty input.' };
  let data;
  try { data = driveEnvelopeKeys(JSON.parse(t)); }
  catch (err) { return { ok: false, error: `Invalid JSON: ${err.message}` }; }
  const isBundle = data?.schema === 'diagramforce-export' || data?.schema === 'diagramforce-diagrams' || Array.isArray(data?.diagrams);
  const isTemplates = data?.schema === 'diagramforce-templates' || (Array.isArray(data?.templates) && !data?.graph && !Array.isArray(data?.diagrams));
  // `single` = the document holds exactly one diagram (singleDiagramOf), so it can Replace the open tab; `typed` =
  // it names its own diagramType (an untyped one takes the tab's).
  const one = singleDiagramOf(data);
  const single = one ? { single: true, typed: !!one.diagramType } : {};
  if (data?.graph?.cells) {
    const norm = normalizeDiagramType(data.diagramType);
    // `rawType` = the diagramType string as it appears in the pasted JSON (may be an alias, e.g. "organization");
    // `diagramType` = the normalised internal type. The Paste pane shows "rawType → friendly label".
    return { ok: true, diagramType: norm, rawType: String(data.diagramType || norm), ...single, label: `<strong>${escHtml(data.title || 'Untitled')}</strong> (${escHtml(norm)}, ${data.graph.cells.length} cells)` };
  }
  // A bare graph ({cells}, no envelope) is one diagram, as loadJSONText and singleDiagramOf take it (1.25.0). This
  // gate called it "Unrecognised format", so it opened by file and not from the paste box (review D6).
  if (!data?.graph && Array.isArray(data?.cells) && one) {
    const norm = normalizeDiagramType(data.diagramType);
    return { ok: true, diagramType: norm, rawType: String(data.diagramType || norm), ...single, label: `<strong>${escHtml(data.title || data.name || 'Untitled')}</strong> (${escHtml(norm)}, ${data.cells.length} cells)` };
  }
  if (isBundle) {
    const dN = Array.isArray(data.diagrams) ? data.diagrams.length : 0;
    const tN = Array.isArray(data.templates) ? data.templates.length : 0;
    const typeOf = one ? { diagramType: normalizeDiagramType(one.diagramType) } : {};
    return { ok: true, ...typeOf, ...single, label: `Bundle - ${dN} diagram${dN === 1 ? '' : 's'}${tN ? `, ${tN} template${tN === 1 ? '' : 's'}` : ''}` };
  }
  if (isTemplates) {
    const tN = Array.isArray(data.templates) ? data.templates.length : 0;
    return { ok: true, label: `Templates - ${tN} template${tN === 1 ? '' : 's'}` };
  }
  return { ok: false, error: 'Unrecognised format (no graph, diagrams, or templates).' };
}

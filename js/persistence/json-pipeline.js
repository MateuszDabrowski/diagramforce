// JSON pipeline — untrusted-graph sanitisation + the load/import path for every
// Diagramforce file format (single diagram, export bundle, templates), driven by
// the file picker (importJSON) and the unified Load-from-Paste modal (loadJSONText
// + describePastedJSON). Extracted
// from persistence.js (Phase 3, Slice 2). sanitizeGraphJSON is PURE (consts only)
// so unit tests reach it through the facade with no init(). Everything else is
// runtime-only and reads live state/callbacks from the persistence context (pctx);
// version checks + dedup signatures come from the leaf versioning module.

import { contentSignature, checkVersionWarning } from './versioning.js?v=1.18.0.5';
import { KNOWN_EXT_RE } from './df-format.js?v=1.18.0.5';
import { normalizeDateSuffix } from '../util.js?v=1.18.0.5';
import { escHtml } from '../util.js?v=1.18.0.5';
import { showToast, showError, buildModal } from '../feedback.js?v=1.18.0.5';
import { pctx } from './context.js?v=1.18.0.5';
import { slimForShare } from '../share-codec.js?v=1.18.0.5';
// The allowlist + cap live in a ZERO-dep leaf (diagram-schema.js) so the dev validator (dev/scripts/validate-diagram.mjs)
// and this loader share ONE source of truth - add a new shape there and both update. (S4/v1.12.0 allowlist; drops any
// cell whose type isn't registered, so a crafted share URL can't ship an unknown type the renderer never expected.)
import { ALLOWED_CELL_TYPES, MAX_CELL_COUNT } from './diagram-schema.js?v=1.18.0.5';

/** Sanitise graph JSON from untrusted sources (share URLs, imports).
 *  Strips event-handler attributes and javascript: URIs to prevent XSS. */

export function sanitizeGraphJSON(graphData) {
  if (!graphData || !Array.isArray(graphData.cells)) return graphData;
  if (graphData.cells.length > MAX_CELL_COUNT) {
    throw new Error(`Diagram exceeds maximum element count (${MAX_CELL_COUNT}).`);
  }
  const stripAttrs = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      // Drop prototype-pollution vectors from untrusted JSON.
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        delete obj[key];
        continue;
      }
      // Remove event handler attributes (onclick, onload, etc.)
      if (/^on[a-z]/i.test(key)) { delete obj[key]; continue; }
      // EXEMPT free-text content from URI-neutralisation: a df.Table `rows` grid and a label's `text` are
      // rendered as SVG textContent (and via a link-less markdown parser) — NEVER dereferenced as a URL — so a
      // cell/label that merely STARTS with "javascript:" must survive verbatim instead of being silently blanked
      // on reload. We exempt by KEY (not by narrowing to href/src), so the conservative posture is unchanged for
      // every real sink — url / href / xlink:href / src and any unknown attribute still get neutralised below.
      if (key === 'rows' || key === 'text' || key === 'tableLabel') continue;
      const val = obj[key];
      // Neutralise script-bearing URIs (javascript:/vbscript:/data:text/html).
      // data:image/* is intentionally left intact — image cells rely on it.
      if (typeof val === 'string'
          && /^\s*(javascript|vbscript)\s*:|^\s*data\s*:\s*text\/html/i.test(val)) {
        obj[key] = '';
      } else if (typeof val === 'object' && val !== null) {
        stripAttrs(val);
      }
    }
  };
  // S4 (v1.12.0) — drop any cell whose type isn't in the registered shape
  // allowlist. Closes the fuzzing surface where a crafted share URL could
  // ship a cell with an unknown `type` that JointJS would silently render
  // with default attrs (or worse, with attrs the app's renderer never
  // expected to handle). Drop silently — a noisy error would help an
  // attacker probe the allowlist boundaries.
  graphData.cells = graphData.cells.filter(c =>
    c && typeof c === 'object' && typeof c.type === 'string' && ALLOWED_CELL_TYPES.has(c.type)
  );
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
  if (droppedLinkIds.length) {
    console.warn(
      `Diagramforce: skipped ${droppedLinkIds.length} link(s) referencing a missing cell:`,
      droppedLinkIds,
    );
  }
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

export function importJSON() {
  const input = document.getElementById('file-input');
  input.onchange = (evt) => {
    const files = Array.from(evt.target.files);
    if (!files.length) return;
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const fallbackName = file.name.replace(KNOWN_EXT_RE, '') || 'Imported';
        await loadJSONText(e.target.result, fallbackName);
      };
      reader.readAsText(file);
    }
    input.value = '';
  };
  input.click();
}

/** Restore a bundled diagram as a named browser save (collision-safe name).
 *  Non-destructive: doesn't touch open tabs — the diagram lands in
 *  Load → Load from Browser. Sanitises the (untrusted) graph first. */
function restoreDiagramAsSave(name, diagramType, graphJSON, viewport, appVersion, mappingMode) {
  const { normalizeDiagramType, namedSavePrefix: NAMED_SAVE_PREFIX, appVersion: APP_VERSION } = pctx;
  if (!graphJSON) return false;
  sanitizeGraphJSON(graphJSON);
  const base = normalizeDateSuffix(String(name || 'Imported')).slice(0, 80) || 'Imported';
  let finalName = base;
  for (let n = 2; localStorage.getItem(NAMED_SAVE_PREFIX + finalName) !== null; n++) {
    finalName = `${base} (${n})`;
  }
  try {
    localStorage.setItem(NAMED_SAVE_PREFIX + finalName, JSON.stringify({
      name: finalName,
      timestamp: Date.now(),
      diagramType: normalizeDiagramType(diagramType),
      mappingMode: !!mappingMode,
      graph: graphJSON,
      viewport: viewport || null,
      // Preserve the diagram's original version so re-imports stay honest;
      // fall back to the current app version when the source carried none.
      appVersion: appVersion || APP_VERSION,
    }));
    return true;
  } catch { return false; }
}

/** Content-signature + name sets of every existing diagram (open tabs + named
 *  saves) — the dedup reference for an import. */
function collectExistingDiagrams() {
  const { getAllTabs: getAllTabsCallback, getTabGraph: getTabGraphCallback, getNamedSaves, readNamedSave } = pctx;
  const sigs = new Set();
  const names = new Set();
  for (const t of (getAllTabsCallback ? getAllTabsCallback() : [])) {
    if (t.name) names.add(t.name);
    const g = getTabGraphCallback ? getTabGraphCallback(t.id) : null;
    if (g?.cells) sigs.add(contentSignature(g.cells));
  }
  for (const s of getNamedSaves()) {
    names.add(s.name);
    const d = readNamedSave(s.key);
    if (d?.graph?.cells) sigs.add(contentSignature(d.graph.cells));
  }
  return { sigs, names };
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
  for (const d of rawDiagrams) {
    const cells = d?.graph?.cells;
    if (!Array.isArray(cells)) continue;
    const sig = contentSignature(cells);
    if (sigs.has(sig) || seen.has(sig)) continue;   // exact duplicate → skip
    seen.add(sig);
    sanitizeGraphJSON(d.graph);
    let name = String(d.name || 'Imported').slice(0, 80) || 'Imported';
    if (names.has(name)) name = `${name} (Restored)`;
    names.add(name);
    out.push({ name, diagramType: normalizeDiagramType(d.diagramType), mappingMode: d.mappingMode || false, graph: d.graph, viewport: d.viewport || null, appVersion: d.appVersion || null });
  }
  return out;
}

/**
 * Parse a JSON string and import it — handles every Diagramforce file format:
 *   - `diagramforce-export` bundle (+ legacy `diagramforce-diagrams`): diagrams
 *     are restored as named browser saves (then the Load-from-Browser modal
 *     opens so the user sees them); templates merged into the library.
 *   - `diagramforce-templates`: merged into the template library.
 *   - single diagram (`{graph,…}`): opened as a new tab (the original behaviour).
 * Used by `importJSON` (file picker) and the unified Load-from-Paste modal. Returns
 * true on success.
 */
export async function loadJSONText(jsonText, fallbackName) {
  const { templatesBackupApi, showLoadModal: showLoadModalCallback, onImport: onImportCallback, normalizeDiagramType, graph, canvas: canvasModule } = pctx;
  let data;
  try { data = JSON.parse(jsonText); }
  catch (err) { showError(`Failed to load ${fallbackName ? `"${fallbackName}"` : 'JSON'}: ${err.message}`); return false; }

  const okVer = await checkVersionWarning(data.appVersion || null, data.title || fallbackName || 'Imported', data);
  if (!okVer) return false;

  const isBundle = data.schema === 'diagramforce-export' || data.schema === 'diagramforce-diagrams'
    || (Array.isArray(data.diagrams) && !data.graph);
  // A `kind:'group'` bundle (from "Export group") round-trips a whole working set:
  // recreate the group(s) and open each diagram as a grouped tab, rather than the
  // default bundle behaviour (land diagrams in browser saves).
  const isGroupBundle = isBundle && data.kind === 'group'
    && Array.isArray(data.groups) && data.groups.length > 0 && pctx.onImportGroup;
  const isTemplatesOnly = !isBundle && (data.schema === 'diagramforce-templates'
    || (Array.isArray(data.templates) && !data.graph && !Array.isArray(data.diagrams)));

  // ── Group bundle: recreate the group + open its diagrams as grouped tabs ──
  if (isGroupBundle) {
    const { normalizeDiagramType, onImportGroup } = pctx;
    const diagrams = [];
    for (const d of (Array.isArray(data.diagrams) ? data.diagrams : [])) {
      if (!Array.isArray(d?.graph?.cells)) continue;
      sanitizeGraphJSON(d.graph);   // drop endpoint-less links etc. (same as every import path)
      diagrams.push({
        name: String(d.name || 'Imported').slice(0, 80) || 'Imported',
        diagramType: normalizeDiagramType(d.diagramType),
        mappingMode: d.mappingMode || false,
        graph: d.graph,
        viewport: d.viewport || null,
        group: d.group || null,
        appVersion: d.appVersion || data.appVersion || null,
      });
    }
    if (diagrams.length === 0) { showToast('No diagrams found in that group file.', 'warning'); return true; }
    const groupMetas = data.groups.map(g => ({ name: String(g.name || 'Group').slice(0, 60), icon: g.icon || null, color: g.color || null }));
    onImportGroup(groupMetas, diagrams);
    // A full backup can be a kind:'group' bundle that ALSO carries templates - import them too so a restore
    // doesn't silently drop the user's template library (item 4).
    const tc = (Array.isArray(data.templates) && data.templates.length && templatesBackupApi?.importMerge)
      ? (templatesBackupApi.importMerge(data.templates) || 0) : 0;
    const gLabel = groupMetas.length === 1 ? `group "${groupMetas[0].name}"` : `${groupMetas.length} groups`;
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
        sanitizeGraphJSON(d.graph);
        const nm = String(d.name || d.title || fallbackName || 'Imported').slice(0, 80) || 'Imported';
        // #7: a 1-diagram bundle's per-diagram `group` is a bare NAME tag (bundle meta lives in data.groups, handled
        // by the onImportGroup path above) - wrap it so recreate-or-rejoin works by name.
        const grp = typeof d.group === 'string' ? { name: d.group } : (d.group || null);
        onImportCallback(nm, normalizeDiagramType(d.diagramType), d.graph, d.viewport || null, d.mappingMode || false, null, grp);
        showToast(`Loaded "${nm}" ✓`, 'success');
        return true;
      }
    }
    const diagrams = prepareImportedDiagrams(rawDiagrams);   // dedup + rename + sanitise

    let saved = 0;
    for (const d of diagrams) {
      // Preserve each diagram's own version, else the bundle's, else current.
      if (restoreDiagramAsSave(d.name, d.diagramType, d.graph, d.viewport, d.appVersion || data.appVersion, d.mappingMode)) saved++;
    }
    const tc = (rawTemplates.length && templatesBackupApi?.importMerge)
      ? (templatesBackupApi.importMerge(rawTemplates) || 0) : 0;

    // Import tally. "skipped" = file entries that did NOT become new saves
    // because an exact content-copy is already open (as a tab) or saved here.
    const stats = {
      imported: saved,
      skipped: Math.max(0, rawDiagrams.length - saved),
      templates: tc,
      templatesSkipped: Math.max(0, rawTemplates.length - tc),
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
    const n = templatesBackupApi.importMerge(data.templates || []) || 0;
    if (n === 0) { showError('No valid templates found in that file.'); return false; }
    showToast(`Imported ${n} template${n === 1 ? '' : 's'} ✓`, 'success');
    return true;
  }

  // ── Single diagram → new tab (original behaviour) ──
  try {
    const name = data.title || fallbackName || 'Imported';
    // Count endpoint-links before/after sanitise so we can tell the user how many
    // pointed at a missing shape and were skipped (the common LLM-output error) —
    // the diagram still loads instead of failing wholesale.
    const countLinks = (g) => (g?.cells || []).filter((c) => c && (c.source || c.target)).length;
    let droppedLinks = 0;
    if (data?.graph) {
      const before = countLinks(data.graph);
      sanitizeGraphJSON(data.graph);
      droppedLinks = Math.max(0, before - countLinks(data.graph));
    }
    if (onImportCallback && data?.graph) {
      // #7: a single-diagram file can carry its tab-group meta ({name,icon,color}) so import recreate-or-rejoins it.
      onImportCallback(name, normalizeDiagramType(data.diagramType), data.graph, data.viewport, data.mappingMode, null, data.group || null);
    } else if (data?.graph) {
      canvasModule.setLoadingJSON(true);
      try { graph.fromJSON(data.graph); } finally { canvasModule.setLoadingJSON(false); }
      if (data?.viewport) canvasModule.setViewport(data.viewport);
    } else {
      throw new Error('No graph data found in JSON.');
    }
    if (droppedLinks > 0) {
      showToast(
        `Loaded "${name}" - skipped ${droppedLinks} connector${droppedLinks === 1 ? '' : 's'} `
        + `pointing to a shape that isn't in the file.`,
        'warning',
      );
    } else {
      showToast(`Loaded "${name}" ✓`, 'success');
    }
    return true;
  } catch (err) {
    showError(`Failed to load ${fallbackName ? `"${fallbackName}"` : 'JSON'}: ${err.message}`);
    return false;
  }
}

/**
 * Paste-from-JSON modal: shows a textarea, validates the input is parseable
 * JSON with a `graph` field, and loads it via the same pipeline as `importJSON`.
 */
/**
 * Classify pasted text as Diagramforce JSON (single diagram / export bundle / templates file) for the unified
 * Load-from-Paste modal's live feedback. Returns { ok: true, label } (HTML, safe to inject) or { ok: false,
 * error } (plain text). The same shapes `loadJSONText` accepts. Mermaid is detected separately (mermaid-import).
 */
export function describePastedJSON(text) {
  const { normalizeDiagramType } = pctx;
  const t = (text || '').trim();
  if (!t) return { ok: false, error: 'Empty input.' };
  let data;
  try { data = JSON.parse(t); }
  catch (err) { return { ok: false, error: `Invalid JSON: ${err.message}` }; }
  const isBundle = data?.schema === 'diagramforce-export' || data?.schema === 'diagramforce-diagrams' || Array.isArray(data?.diagrams);
  const isTemplates = data?.schema === 'diagramforce-templates' || (Array.isArray(data?.templates) && !data?.graph && !Array.isArray(data?.diagrams));
  if (data?.graph?.cells) {
    const norm = normalizeDiagramType(data.diagramType);
    // `rawType` = the diagramType string as it appears in the pasted JSON (may be an alias, e.g. "organization");
    // `diagramType` = the normalised internal type. The Paste pane shows "rawType → friendly label".
    return { ok: true, diagramType: norm, rawType: String(data.diagramType || norm), label: `<strong>${escHtml(data.title || 'Untitled')}</strong> (${escHtml(norm)}, ${data.graph.cells.length} cells)` };
  }
  if (isBundle) {
    const dN = Array.isArray(data.diagrams) ? data.diagrams.length : 0;
    const tN = Array.isArray(data.templates) ? data.templates.length : 0;
    return { ok: true, label: `Bundle - ${dN} diagram${dN === 1 ? '' : 's'}${tN ? `, ${tN} template${tN === 1 ? '' : 's'}` : ''}` };
  }
  if (isTemplates) {
    const tN = Array.isArray(data.templates) ? data.templates.length : 0;
    return { ok: true, label: `Templates - ${tN} template${tN === 1 ? '' : 's'}` };
  }
  return { ok: false, error: 'Unrecognised format (no graph, diagrams, or templates).' };
}

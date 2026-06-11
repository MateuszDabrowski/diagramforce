// Custom Templates — user-defined, reusable groups of shapes + connectors.
//
// Naming: a "template" here is a user-saved GROUP captured from a
// multi-selection. Distinct from components.js, which defines the built-in
// single-shape stencil entries ("components"). Code and UI both say "template"
// for this feature and "component" for an individual built-in shape.
//
// A template is a serialized subgraph (the selected elements + their embedded
// descendants + the links between any two captured cells), captured from a
// multi-selection. Templates live in a single GLOBAL localStorage array
// (sfdiag::customTemplates) and are shown in every diagram type's stencil.
// They are NOT part of any diagram's save schema, so they neither bloat
// browser saves / shares nor affect the save-schema version tier.
//
//   Capture   → saveSelectionAsTemplate()  (button in the multi-select panel)
//   Library   → getTemplates / deleteTemplate + renderTemplateThumbnail (stencil)
//   Instance  → instantiateTemplate()       (stencil drop, with fresh cell IDs)
//
// Drop-time ID regeneration is the critical bit: dropping the same template
// twice would otherwise create duplicate cell IDs and break JointJS. Every
// cell gets a fresh ID and all parent / embeds / source / target references
// are rewritten to match before the cells are added to the live graph.

import { showToast, promptModal } from './feedback.js?v=1.16.1';
import { APP_VERSION, sanitizeGraphJSON, triggerDownload, dateSuffix, requestPersistentStorage, contentSignature } from './persistence.js?v=1.16.1';

const STORAGE_KEY = 'sfdiag::customTemplates';
// Self-describing format tag for the Save/Load-Templates-as-JSON backup file.
const EXPORT_SCHEMA = 'diagramforce-templates';
// Once-per-session guard for the persist() request (durability layer 1).
let persistRequested = false;
const MAX_TEMPLATES = 60;            // library cap — keeps the stencil usable
const MAX_CELLS_PER_TEMPLATE = 200;  // sanity cap per template

let graph, selection, history;
let getDiagramType = () => 'architecture';
const changeCallbacks = [];

export function init(_graph, _selection, _history) {
  graph = _graph;
  selection = _selection;
  history = _history;
}

/** Set a getter returning the active diagram type — stored as template metadata. */
export function setDiagramTypeGetter(fn) {
  if (typeof fn === 'function') getDiagramType = fn;
}

/** Subscribe to library changes (add / delete) so the stencil can re-render. */
export function onTemplatesChange(cb) {
  if (typeof cb === 'function') changeCallbacks.push(cb);
}
function notifyChange() {
  changeCallbacks.forEach(cb => {
    try { cb(); } catch (e) { console.warn('SF Diagrams: template change handler failed', e); }
  });
}

// ── Storage ─────────────────────────────────────────────────────────

export function getTemplates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    console.warn('SF Diagrams: could not read custom templates', err);
    return [];
  }
}

function writeTemplates(templates) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

export function deleteTemplate(id) {
  const next = getTemplates().filter(p => p.id !== id);
  try {
    writeTemplates(next);
  } catch (err) {
    showToast('Could not update template library.', 'error');
    return;
  }
  notifyChange();
}

/** Deep-copy + sanitise a template's cells before they ever touch a graph.
 *  `localStorage` is only semi-trusted (a rogue extension/script could tamper),
 *  so template cells run through the same `sanitizeGraphJSON` every other
 *  localStorage → graph path uses (drops type-foreign cells, strips `on*`
 *  handlers / `javascript:` URIs / proto-pollution keys). Returns [] on
 *  failure so callers degrade gracefully. */
function safeTemplateCells(template) {
  if (!Array.isArray(template?.cells)) return [];
  try {
    const copy = template.cells.map(c => JSON.parse(JSON.stringify(c)));
    const safe = sanitizeGraphJSON({ cells: copy });
    return Array.isArray(safe?.cells) ? safe.cells : [];
  } catch (err) {
    console.warn('SF Diagrams: template failed sanitisation', err);
    return [];
  }
}

// ── Capture ─────────────────────────────────────────────────────────

/** Fresh cell ID — JointJS uuid when available, else crypto / random fallback. */
function newCellId() {
  try {
    if (typeof joint !== 'undefined' && joint.util?.uuid) return joint.util.uuid();
  } catch { /* fall through */ }
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return 'pat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * Capture the current multi-selection as a reusable template.
 *
 * Uses graph.getSubgraph(elements, { deep: true }) so embedded children and the
 * links between any two captured cells come along, then serializes to JSON.
 * Aborts (with an amber toast) if the selection contains an sf.Image — Base64
 * image bytes would balloon the localStorage footprint (the sf.Image guardrail).
 */
export function saveSelectionAsTemplate() {
  if (!graph || !selection) return;

  const ids = selection.getSelectedIds();
  const selected = ids.map(id => graph.getCell(id)).filter(Boolean);
  const elements = selected.filter(c => c.isElement());
  if (elements.length === 0) {
    showToast('Select at least one shape to save as a template.', 'warning');
    return;
  }

  // getSubgraph(elements, { deep: true }) → the elements + their embedded
  // descendants + any link whose BOTH endpoints are inside that set. Passing
  // only elements (no links) keeps the capture self-contained: links that
  // dangle out to unselected shapes are excluded rather than pulling those
  // outside shapes in.
  const subgraph = graph.getSubgraph(elements, { deep: true });

  if (subgraph.some(c => c.get('type') === 'sf.Image')) {
    showToast('Templates cannot contain images to preserve storage space.', 'warning');
    return;
  }
  if (subgraph.length > MAX_CELLS_PER_TEMPLATE) {
    showToast(`Template is too large (max ${MAX_CELLS_PER_TEMPLATE} elements).`, 'warning');
    return;
  }
  const existing = getTemplates();
  if (existing.length >= MAX_TEMPLATES) {
    showToast(`Template library is full (max ${MAX_TEMPLATES}). Delete one first.`, 'warning');
    return;
  }

  const cellsJSON = subgraph.map(c => c.toJSON());
  // Counts reflect what was actually CAPTURED (subgraph incl. embedded children
  // + inter-cell links), not just the directly-selected cells — so the body
  // confirms exactly what the bounding box caught.
  const elementCount = subgraph.filter(c => c.isElement()).length;
  const linkCount = subgraph.length - elementCount;
  const componentText = `${elementCount} component${elementCount === 1 ? '' : 's'}`;
  const connectorText = `${linkCount} connector${linkCount === 1 ? '' : 's'}`;
  // Body with the counts in bold, e.g. "**8 components** and **10 connectors**
  // selected." Built as DOM nodes (counts are integers → no injection risk).
  const bold = (t) => { const s = document.createElement('strong'); s.textContent = t; return s; };
  const messageNode = document.createElement('span');
  messageNode.appendChild(bold(componentText));
  if (linkCount > 0) {
    messageNode.appendChild(document.createTextNode(' and '));
    messageNode.appendChild(bold(connectorText));
  }
  messageNode.appendChild(document.createTextNode(' selected.'));
  // Defensive fallback — requireValue blocks an empty Save, so this won't
  // normally be reached, but keeps the tile labelled if it ever is.
  const fallbackName = `Template ${existing.length + 1}`;

  promptModal({
    title: 'Save as Template',
    message: messageNode,
    defaultValue: '',
    placeholder: 'Template Name',
    okLabel: 'Save',
    requireValue: true,
  }).then(name => {
    if (name == null) return; // cancelled / escaped
    const finalName = name.trim() || fallbackName;
    const template = {
      id: newCellId(),
      name: finalName,
      diagramType: getDiagramType(),
      appVersion: APP_VERSION,
      createdAt: Date.now(),
      cells: cellsJSON,
    };
    const templates = getTemplates();
    templates.push(template);
    try {
      writeTemplates(templates);
    } catch (err) {
      showToast('Could not save template — browser storage may be full.', 'error');
      return;
    }
    notifyChange();
    showToast(`Saved "${finalName}" to My Templates ✓`, 'success');

    // Durability layer 1 — ask the browser to keep this origin's storage
    // (best-effort; tied to this save gesture so any Firefox prompt is
    // contextual). Once per session is enough. The user-facing "back this up"
    // reminder is handled separately by the periodic backup overlay
    // (persistence.maybeShowBackupReminder), not a per-save toast.
    if (!persistRequested) {
      persistRequested = true;
      requestPersistentStorage();
    }
  });
}

// ── Instantiate (drop) ──────────────────────────────────────────────

/**
 * Add a saved template to the live graph at `dropPoint` (paper-local coords),
 * centred on that point. Every cell receives a fresh ID; parent / embeds and
 * link source / target references are rewritten to the new IDs so repeated
 * drops never collide. The whole insertion is one undo step.
 */
export function instantiateTemplate(templateId, dropPoint) {
  if (!graph) return;
  const template = getTemplates().find(p => p.id === templateId);
  if (!template) return;

  const cells = safeTemplateCells(template);
  if (cells.length === 0) return;

  const idMap = new Map();
  cells.forEach(c => { if (c.id != null) idMap.set(c.id, newCellId()); });

  // Bounding box of the positioned cells so we can centre the group on the
  // drop point (mirrors how single-shape drops centre on the cursor).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  cells.forEach(c => {
    if (c.position && c.size) {
      minX = Math.min(minX, c.position.x);
      minY = Math.min(minY, c.position.y);
      maxX = Math.max(maxX, c.position.x + c.size.width);
      maxY = Math.max(maxY, c.position.y + c.size.height);
    }
  });
  const hasBox = Number.isFinite(minX);
  const dx = (hasBox && dropPoint) ? Math.round(dropPoint.x - (minX + (maxX - minX) / 2)) : 0;
  const dy = (hasBox && dropPoint) ? Math.round(dropPoint.y - (minY + (maxY - minY) / 2)) : 0;

  const clones = cells.map(json => {
    const clone = JSON.parse(JSON.stringify(json));
    clone.id = idMap.get(json.id) || newCellId();

    if (clone.parent) {
      const np = idMap.get(clone.parent);
      if (np) clone.parent = np; else delete clone.parent;
    }
    if (Array.isArray(clone.embeds)) {
      clone.embeds = clone.embeds.map(e => idMap.get(e)).filter(Boolean);
    }
    if (clone.source?.id) {
      const ns = idMap.get(clone.source.id);
      if (ns) clone.source = { ...clone.source, id: ns };
    }
    if (clone.target?.id) {
      const nt = idMap.get(clone.target.id);
      if (nt) clone.target = { ...clone.target, id: nt };
    }
    if (clone.position) clone.position = { x: clone.position.x + dx, y: clone.position.y + dy };
    if (Array.isArray(clone.vertices)) {
      clone.vertices = clone.vertices.map(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
    return clone;
  });

  if (history?.startBatch) history.startBatch();
  try {
    graph.addCells(clones);
  } finally {
    if (history?.endBatch) history.endBatch();
  }

  // Select the new top-level elements (skip links + embedded children) so the
  // dropped group is immediately movable and the properties panel reflects it.
  if (selection) {
    selection.clearSelection();
    clones.forEach(c => {
      const isLink = !!(c.source || c.target);
      if (!isLink && !c.parent) selection.addToSelection(c.id);
    });
  }
}

// ── Thumbnail (mini read-only paper) ────────────────────────────────

/**
 * Render a template as a static, self-contained SVG thumbnail.
 *
 * Spins up a throwaway read-only joint.dia.Paper (async:false, so the SVG is
 * populated synchronously), fits the content via a viewBox, snapshots the SVG
 * markup, then tears the paper down — no live papers are retained in the
 * stencil. Icons are baked as data URIs in the cells, so the cloned SVG is
 * fully self-contained (SLDS `<use href="#…">` sprites also resolve, since the
 * cloned SVG is appended into the same document).
 *
 * Returns a wrapper <div> containing the cloned SVG, fit to `size`×`size`.
 */
export function renderTemplateThumbnail(template, size = 76) {
  const wrap = document.createElement('div');
  wrap.className = 'df-template-thumb';

  const cells = safeTemplateCells(template);
  if (typeof joint === 'undefined' || cells.length === 0) {
    return wrap;
  }

  // Off-screen host so any DOM-measuring view code still works during render.
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;left:-99999px;top:0;width:${size}px;height:${size}px;`;
  document.body.appendChild(host);

  let svgClone = null;
  let miniPaper = null;
  try {
    const miniGraph = new joint.dia.Graph({}, { cellNamespace: joint.shapes });
    miniPaper = new joint.dia.Paper({
      el: host,
      model: miniGraph,
      width: size,
      height: size,
      interactive: false,
      async: false,
      sorting: joint.dia.Paper.sorting.APPROX,
      background: { color: 'transparent' },
      cellViewNamespace: joint.shapes,
    });
    miniGraph.fromJSON({ cells });

    const bbox = miniPaper.getContentBBox({ useModelGeometry: true });
    if (bbox && bbox.width > 0 && bbox.height > 0) {
      const pad = Math.max(4, Math.min(bbox.width, bbox.height) * 0.06);
      const vb = `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`;
      miniPaper.svg.setAttribute('viewBox', vb);
      miniPaper.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    }
    svgClone = miniPaper.svg.cloneNode(true);
  } catch (err) {
    console.warn('SF Diagrams: template thumbnail render failed', err);
  } finally {
    try { miniPaper?.remove(); } catch { /* ignore */ }
    host.remove();
  }

  if (svgClone) {
    svgClone.removeAttribute('style');
    svgClone.setAttribute('width', String(size));
    svgClone.setAttribute('height', String(size));
    svgClone.classList.add('df-template-thumb__svg');
    wrap.appendChild(svgClone);
  }
  return wrap;
}

// ── Backup: JSON export / import (durability layer 2) ────────────────
// localStorage is the ONLY in-browser store (no backend, no account) and the
// browser can evict it. A downloaded JSON file is the unconditional backup —
// the same "export for permanence" escape hatch the app gives browser saves.

/** Download the whole template library as a self-describing JSON file.
 *  Returns true on a successful download (used by the backup overlay to mark
 *  its button done), false otherwise. */
export function exportTemplatesJSON() {
  const templates = getTemplates();
  if (templates.length === 0) {
    showToast('No templates to export yet.', 'warning');
    return false;
  }
  try {
    const payload = {
      schema: EXPORT_SCHEMA,
      version: 1,
      appVersion: APP_VERSION,
      exportedAt: Date.now(),
      templates,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    triggerDownload(URL.createObjectURL(blob), `df_templates_${dateSuffix()}.json`);
    showToast(`Exported ${templates.length} template${templates.length === 1 ? '' : 's'} ✓`, 'success');
    return true;
  } catch (err) {
    console.warn('SF Diagrams: template export failed', err);
    showToast('Could not export templates.', 'error');
    return false;
  }
}

/** MERGE an array of imported templates into the library and return the number
 *  added. Non-destructive: existing templates are kept; imported ones get fresh
 *  IDs (so they never collide) and their cells are sanitised — the source is
 *  untrusted (a JSON file), same trust level as a pasted/shared diagram. Shows
 *  its own WARNING toast for "library full"; the caller (persistence import)
 *  shows the success toast. Driven by the general Import-from-JSON flow — there
 *  is no longer a templates-specific file picker. */
export function importTemplatesArray(incoming) {
  if (!Array.isArray(incoming)) return 0;
  const existing = getTemplates();
  const room = MAX_TEMPLATES - existing.length;
  if (room <= 0) {
    showToast(`Template library is full (max ${MAX_TEMPLATES}). Delete some first.`, 'warning');
    return 0;
  }
  // Dedup by exact cell content; rename on name-collision-with-different-content.
  const existingSigs = new Set(existing.map(t => contentSignature(t.cells || [])));
  const existingNames = new Set(existing.map(t => t.name));
  let added = 0;
  for (const t of incoming) {
    if (added >= room) break;
    const cells = safeTemplateCells(t);            // sanitise — untrusted file content
    if (!cells.length) continue;                    // malformed / empty → skip
    const sig = contentSignature(cells);
    if (existingSigs.has(sig)) continue;            // exact duplicate → skip
    let name = (typeof t.name === 'string' && t.name.trim()) ? t.name.trim().slice(0, 80) : `Template ${existing.length + 1}`;
    if (existingNames.has(name)) name = `${name} (Restored)`;
    existingSigs.add(sig);
    existingNames.add(name);
    existing.push({
      id: newCellId(),                              // fresh ID → never collides with current library
      name,
      diagramType: typeof t.diagramType === 'string' ? t.diagramType : 'architecture',
      appVersion: typeof t.appVersion === 'string' ? t.appVersion : APP_VERSION,
      createdAt: Date.now(),
      cells,
    });
    added++;
  }
  if (added === 0) return 0;
  try {
    writeTemplates(existing);
  } catch {
    showToast('Could not save imported templates — storage may be full.', 'error');
    return 0;
  }
  notifyChange();
  return added;
}

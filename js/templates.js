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

import { showToast, promptModal, confirmModal } from './feedback.js?v=1.17.2.11';
import { APP_VERSION, sanitizeGraphJSON, triggerDownload, dateSuffix, requestPersistentStorage, contentSignature, isDriveConnected, isSignedIn, pullTemplates, pushTemplates } from './persistence.js?v=1.17.2.11';
import { mergeTemplatesWithTombstones } from './util.js?v=1.17.2.11';

const STORAGE_KEY = 'sfdiag::customTemplates';
// Tombstones for deletes that must PROPAGATE across devices (item 17): {id, name, deletedAt}. Without these a
// union merge would resurrect a template deleted on another device. Pruned after TOMBSTONE_TTL_MS.
const STORAGE_KEY_DELETED = 'sfdiag::customTemplatesDeleted';
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;   // 90 days — long enough for any offline device to catch up
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

// ── Google Drive sync (item 17, v1.17.0) ────────────────────────────────────
// The whole library is mirrored to ONE Drive file (remote-store.pushTemplates / pullTemplates) so templates
// follow the user across devices. Deletes PROPAGATE via tombstones (the deleted-id list synced alongside the
// templates); a delete on one device removes the template on the others, with a confirmation overlay before
// anything disappears locally. All Drive calls are best-effort + opportunistic (no-op without a valid token).
let _drivePushTimer = null;
const sigOf = (t) => contentSignature(t?.cells || []);

/** The local tombstone list ({id, name, deletedAt}). */
function getDeletedTombstones() {
  try { const a = JSON.parse(localStorage.getItem(STORAGE_KEY_DELETED) || '[]'); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function writeDeletedTombstones(list) {
  try { localStorage.setItem(STORAGE_KEY_DELETED, JSON.stringify(Array.isArray(list) ? list : [])); } catch { /* private mode / full */ }
}

/** Debounced push of the current library + tombstones to Drive after a local add / delete / import. Best-effort. */
function scheduleDrivePush() {
  if (!isDriveConnected?.()) return;
  if (_drivePushTimer) clearTimeout(_drivePushTimer);
  _drivePushTimer = setTimeout(() => {
    _drivePushTimer = null;
    try { pushTemplates(getTemplates(), getDeletedTombstones()); } catch { /* best-effort */ }
  }, 1500);
}

/** Pull the Drive library + tombstones, merge with DELETE PROPAGATION, then push the merged set back. Deletes
 *  made on another device that would remove templates still present here are surfaced in a confirmation overlay
 *  first (Remove vs Keep/resurrect). Called on Drive connect (remote-store) + once on boot when signed in.
 *  Safe to call when not connected (no-ops). */
export async function syncTemplatesWithDrive() {
  if (!isDriveConnected?.()) return;
  let remote = null;
  try { remote = await pullTemplates(); } catch { remote = null; }
  if (remote == null) {
    // No remote file yet (or unreadable) → seed Drive from this device's library + tombstones.
    try { await pushTemplates(getTemplates(), getDeletedTombstones()); } catch { /* best-effort */ }
    return;
  }
  const res = mergeTemplatesWithTombstones({
    localTemplates: getTemplates(), localDeleted: getDeletedTombstones(),
    remoteTemplates: remote.templates, remoteDeleted: remote.deleted,
    sigOf, max: MAX_TEMPLATES, now: Date.now(), ttlMs: TOMBSTONE_TTL_MS,
  });

  // Templates deleted on another device that are still here → confirm before they vanish locally.
  if (res.incomingDeletions.length) {
    const names = res.incomingDeletions.map((t) => `• ${t.name || 'Untitled template'}`).join('\n');
    const remove = await confirmModal({
      title: 'Templates deleted on another device',
      message: `These template${res.incomingDeletions.length === 1 ? ' was' : 's were'} deleted on another device:\n\n${names}\n\nRemove ${res.incomingDeletions.length === 1 ? 'it' : 'them'} here too?`,
      okLabel: 'Remove them', cancelLabel: 'Keep them', tone: 'danger',
    });
    if (!remove) {
      // KEEP/resurrect: drop those tombstones + put the templates back, then push so the resurrection propagates.
      const keepIds = new Set(res.incomingDeletions.map((t) => t.id));
      res.templates = [...res.templates, ...res.incomingDeletions];
      res.deleted = res.deleted.filter((d) => !keepIds.has(d.id));
    }
  }

  try { writeTemplates(res.templates); writeDeletedTombstones(res.deleted); notifyChange(); }
  catch { /* storage full → keep remote in Drive, local unchanged */ }
  // Push the merged result so other devices converge (deduped if identical to what we pulled).
  try { await pushTemplates(res.templates, res.deleted); } catch { /* best-effort */ }
}

/** Boot hook: if a Drive token is already valid this session, opportunistically sync (no sign-in popup). */
export function syncTemplatesOnBoot() {
  if (isSignedIn?.()) { syncTemplatesWithDrive(); }
}

export function deleteTemplate(id) {
  const removed = getTemplates().find(p => p.id === id);
  const next = getTemplates().filter(p => p.id !== id);
  try {
    writeTemplates(next);
  } catch (err) {
    showToast('Could not update template library.', 'error');
    return;
  }
  // Record a tombstone so the deletion PROPAGATES across devices (item 17) instead of being resurrected by a merge.
  if (removed) {
    const tombs = getDeletedTombstones().filter((d) => d && d.id !== id);
    tombs.push({ id, name: removed.name || '', deletedAt: Date.now() });
    writeDeletedTombstones(tombs);
  }
  notifyChange();
  scheduleDrivePush();   // mirror the deletion + tombstone to Drive
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
  const componentText = `${elementCount} shape${elementCount === 1 ? '' : 's'}`;
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
      showToast('Could not save template - browser storage may be full.', 'error');
      return;
    }
    notifyChange();
    scheduleDrivePush();   // mirror the new template to Drive (if connected)
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

/**
 * "My Shapes" - save ONE shape (with its full content + style + embedded children) for reuse, the single-shape
 * counterpart to a multi-shape Template. It is a normal stored template tagged `kind:'shape'`, so it reuses the
 * whole template pipeline (thumbnail, drop-with-fresh-ids, Drive sync, delete). Captured from a given cell (the
 * right-clicked / selected element), not the whole selection.
 */
export function saveCellAsShape(cell) {
  if (!graph || !cell?.isElement?.()) { showToast('Select a shape to save.', 'warning'); return; }
  const subgraph = graph.getSubgraph([cell], { deep: true });
  if (subgraph.some(c => c.get('type') === 'sf.Image')) {
    showToast('Shapes cannot include images to preserve storage space.', 'warning'); return;
  }
  const existing = getTemplates();
  if (existing.length >= MAX_TEMPLATES) {
    showToast(`Your shape + template library is full (max ${MAX_TEMPLATES}). Delete one first.`, 'warning'); return;
  }
  const cellsJSON = subgraph.map(c => c.toJSON());
  const guess = String(cell.attr('label/text') || cell.attr('subtitle/text') || '').trim().slice(0, 40);
  promptModal({
    title: 'Save Shape',
    message: 'Save this shape - with its content and style - to My Shapes, ready to drop into any diagram.',
    defaultValue: guess,
    placeholder: 'Shape name',
    okLabel: 'Save',
    requireValue: true,
  }).then(name => {
    if (name == null) return;
    const finalName = name.trim() || `Shape ${existing.length + 1}`;
    const shape = {
      id: newCellId(), name: finalName, kind: 'shape',
      diagramType: getDiagramType(), appVersion: APP_VERSION, createdAt: Date.now(), cells: cellsJSON,
    };
    const templates = getTemplates();
    templates.push(shape);
    try { writeTemplates(templates); }
    catch { showToast('Could not save - browser storage may be full.', 'error'); return; }
    notifyChange();
    scheduleDrivePush();
    showToast(`Saved "${finalName}" to My Shapes ✓`, 'success');
    if (!persistRequested) { persistRequested = true; requestPersistentStorage(); }
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
export function renderTemplateThumbnail(template, size = 76, height = size, diff = null) {
  const wrap = document.createElement('div');
  wrap.className = 'df-template-thumb';

  const cells = safeTemplateCells(template);

  // Removals (Version History preview): cells that existed in the PREVIOUS version but not this one are GHOSTED -
  // rendered faded with a red-dashed outline - so a deletion reads as clearly as an addition. They come from
  // diff.removedCells (the base cells). A removed LINK is kept only when both endpoints resolve in the combined set
  // (a dangling ghost link can't be positioned). The two-card Review modal omits removedCells, so this stays empty there.
  const presentIds = new Set(cells.map((c) => c && c.id).filter((id) => id != null));
  const removedIds = new Set();
  const ghostCells = [];
  if (diff && Array.isArray(diff.removedCells) && diff.removedCells.length) {
    const isLink = (c) => !!(c && c.source && c.target);
    const candidates = diff.removedCells.filter((c) => c && c.id != null && !presentIds.has(c.id));
    const resolvable = new Set([...presentIds, ...candidates.map((c) => c.id)]);
    for (const c of candidates) {
      if (isLink(c)) {
        const s = c.source && c.source.id, t = c.target && c.target.id;
        if ((s && !resolvable.has(s)) || (t && !resolvable.has(t))) continue;   // dangling endpoint → skip
      }
      removedIds.add(c.id);
      ghostCells.push(c);
    }
  }

  if (typeof joint === 'undefined' || (cells.length === 0 && ghostCells.length === 0)) {
    return wrap;
  }

  // Off-screen host so any DOM-measuring view code still works during render.
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;left:-99999px;top:0;width:${size}px;height:${height}px;`;
  document.body.appendChild(host);

  let svgClone = null;
  let miniPaper = null;
  try {
    const miniGraph = new joint.dia.Graph({}, { cellNamespace: joint.shapes });
    miniPaper = new joint.dia.Paper({
      el: host,
      model: miniGraph,
      width: size,
      height,
      interactive: false,
      async: false,
      sorting: joint.dia.Paper.sorting.APPROX,
      background: { color: 'transparent' },
      cellViewNamespace: joint.shapes,
      // Match the MAIN canvas's connection point (registered globally as sfConnectionPoint at canvas init) so preview
      // links read identically: the 16px offset keeps arrowheads OFF the shapes, and routing to distinct field ports
      // is preserved instead of collapsing every link onto one anchor (version-history / template thumbnails, #6).
      defaultConnectionPoint: { name: 'sfConnectionPoint', args: { offset: 16 } },
      // The compacted save (compactGraphForSave) DROPS link routing - the MAIN canvas rebuilds it via migrateLinks on
      // load, but this throwaway paper does a raw fromJSON, so without these the links draw as straight diagonals.
      // These match the main canvas's defaults; mapping links get sfMappingRouter re-applied below (per linkKind).
      defaultRouter: { name: 'sfManhattan' },
      defaultConnector: { name: 'rounded', args: { radius: 8 } },
    });
    miniGraph.fromJSON({ cells: ghostCells.length ? [...cells, ...ghostCells] : cells });
    // Re-apply the mapping router/connector the compacted save dropped (mirrors migrateLinks) so Data Cloud mapping
    // links read as the smooth left→right beziers, not the default orthogonal/straight routing. `linkKind` survives
    // compaction even though the router/connector don't.
    for (const link of miniGraph.getLinks()) {
      if (link.prop('linkKind') === 'mapping') {
        link.router({ name: 'sfMappingRouter' });
        link.connector('sfMappingConnector');
        link.prop('source/connectionPoint', { name: 'anchor', args: { offset: 12 } });
        link.prop('target/connectionPoint', { name: 'anchor', args: { offset: 12 } });
      }
    }
    // Fade the ghosted (removed) cells so they read as faint "was here, now gone" shapes behind the current diagram.
    if (removedIds.size) {
      for (const cell of miniGraph.getCells()) {
        if (!removedIds.has(cell.id)) continue;
        const view = miniPaper.findViewByModel(cell);
        if (view && view.el) view.el.style.opacity = '0.4';
      }
    }

    const bbox = miniPaper.getContentBBox({ useModelGeometry: true });
    if (bbox && bbox.width > 0 && bbox.height > 0) {
      const pad = Math.max(4, Math.min(bbox.width, bbox.height) * 0.06);
      const vb = `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`;
      miniPaper.svg.setAttribute('viewBox', vb);
      miniPaper.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    }
    // Phase C diff highlight: outline each ADDED element green and each CHANGED element amber (dashed), drawn into
    // the same model-coordinate space as the cells (the paper has no pan/zoom, so getBBox is in viewBox units).
    // non-scaling-stroke keeps the outline crisp regardless of how far the viewBox is scaled to fit the thumbnail.
    if (diff && (diff.added || diff.changed || removedIds.size)) {
      const NS = 'http://www.w3.org/2000/svg';
      for (const el of miniGraph.getElements()) {
        const added = !!(diff.added && diff.added.has(el.id));
        const removed = removedIds.has(el.id);
        const changed = !added && !removed && !!(diff.changed && diff.changed.has(el.id));
        if (!added && !changed && !removed) continue;
        const bb = el.getBBox();
        if (!bb || !(bb.width > 0)) continue;
        const r = document.createElementNS(NS, 'rect');
        r.setAttribute('x', String(bb.x - 3)); r.setAttribute('y', String(bb.y - 3));
        r.setAttribute('width', String(bb.width + 6)); r.setAttribute('height', String(bb.height + 6));
        r.setAttribute('rx', '4'); r.setAttribute('fill', 'none');
        // green = added, amber-dashed = changed, red-dashed = removed (ghosted)
        r.setAttribute('stroke', removed ? '#C23934' : added ? '#1D9E75' : '#BA7517');
        r.setAttribute('stroke-width', '2.5'); r.setAttribute('vector-effect', 'non-scaling-stroke');
        if (changed || removed) r.setAttribute('stroke-dasharray', '5 3');
        miniPaper.svg.appendChild(r);
      }
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
    svgClone.setAttribute('height', String(height));
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
    showToast('Could not save imported templates - storage may be full.', 'error');
    return 0;
  }
  notifyChange();
  scheduleDrivePush();   // mirror imported templates to Drive (if connected)
  return added;
}

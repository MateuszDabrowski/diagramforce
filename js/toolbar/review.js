// Change Review (CLEANUP S4) — the picker + banner + Apply-as-Highlights orchestration over util.diffGraphs and the canvas review-overlay. Reads tctx.modules inside function bodies; drive-history calls reviewAgainstRevision (slice->slice).
import { buildModal, showError, showToast } from '../feedback.js?v=1.22.1';
import { storageRowHtml, tabRowChipsHtml } from '../storage-ui.js?v=1.22.1';
import { countDiagramShapes, diffGraphs, escHtml, formatRelativeTime } from '../util.js?v=1.22.1';
import { tctx } from './context.js?v=1.22.1';

function currentGraphJSON() {
  return tctx.modules.graph ? tctx.modules.graph.toJSON() : { cells: [] };
}

let _reviewBanner = null;
let _reviewKeyHandler = null;
let _reviewDiff = null;          // the active review's diff, kept so "Apply" can bake it
let _shapeStateApplier = null;   // properties.applyShapeState, wired by app.js (no module cycle)

/** Wire the Shape-state setter (properties.applyShapeState) used by "Apply as Highlight states". */
export function setShapeStateApplier(fn) { _shapeStateApplier = fn; }

/** Bake the current review's diff into real borderStyle props (Added → green, Changed → amber), one
 *  undoable batch, then exit. Removed elements are gone from the graph, so they can't be highlighted. */
function applyReviewAsHighlights() {
  const g = tctx.modules.graph;
  if (!_reviewDiff || !_shapeStateApplier || !g) { tctx.modules.canvas?.exitReview?.(); return; }
  const bake = (ids, style) => { for (const id of ids || []) { const c = g.getCell(id); if (c?.isElement?.()) _shapeStateApplier(c, style); } };
  tctx.modules.history?.startBatch?.();
  try { bake(_reviewDiff.added, 'bold'); bake(_reviewDiff.changed, 'dotted'); }
  finally { tctx.modules.history?.endBatch?.(); }
  tctx.modules.canvas?.exitReview?.();
  showToast('Applied the changes as Highlight states - save to keep them ✓', 'success');
}

function removeReviewBanner() {
  if (_reviewBanner) { _reviewBanner.remove(); _reviewBanner = null; }
  if (_reviewKeyHandler) { document.removeEventListener('keydown', _reviewKeyHandler); _reviewKeyHandler = null; }
}

function showReviewBanner(label) {
  removeReviewBanner();
  const s = tctx.modules.canvas?.getReviewSummary?.() || { added: 0, changed: 0, removed: 0 };
  const bar = document.createElement('div');
  bar.className = 'df-review-bar';
  bar.setAttribute('role', 'status');
  const part = (cls, n, word) => (n ? `<span class="df-review-bar__stat df-review-bar__stat--${cls}"><i></i>${n} ${word}</span>` : '');
  const stats = [part('add', s.added, 'added'), part('chg', s.changed, 'changed'), part('del', s.removed, 'removed')].filter(Boolean).join('');
  // "Apply" bakes Added/Changed into borderStyle - only offer it when there's something to bake.
  const canApply = !!_shapeStateApplier && (s.added + s.changed) > 0;
  const applyBtn = canApply
    ? '<button type="button" class="df-modal__btn df-modal__btn--accent df-review-bar__apply" title="Set the Added/Changed shapes’ Highlight State so the diff is saved with the diagram">Apply as Highlight States</button>'
    : '';
  bar.innerHTML =
    `<span class="df-review-bar__title">Comparing with <strong>${escHtml(label || 'a baseline')}</strong></span>` +
    `<span class="df-review-bar__stats">${stats || '<span class="df-review-bar__stat">No element-level changes</span>'}</span>` +
    applyBtn +
    `<button type="button" class="df-modal__btn df-review-bar__exit">Exit</button>`;
  document.body.appendChild(bar);
  bar.querySelector('.df-review-bar__apply')?.addEventListener('click', applyReviewAsHighlights);
  bar.querySelector('.df-review-bar__exit').addEventListener('click', () => tctx.modules.canvas?.exitReview?.());
  _reviewKeyHandler = (e) => { if (e.key === 'Escape') tctx.modules.canvas?.exitReview?.(); };
  document.addEventListener('keydown', _reviewKeyHandler);
  _reviewBanner = bar;
}

/** Diff a baseline {cells} graph against the live canvas and enter the review overlay. */
function startReview(baselineGraph, label) {
  if (!baselineGraph) { showError('Could not read that baseline.'); return; }
  const diff = diffGraphs(baselineGraph, currentGraphJSON());
  const started = tctx.modules.canvas?.enterReview?.(diff, () => { _reviewDiff = null; removeReviewBanner(); });
  if (!started) { showError('Could not start the change review.'); return; }
  _reviewDiff = diff;
  showReviewBanner(label);
}

/** Jump straight to reviewing the current diagram against a specific Drive revision id. */
export async function reviewAgainstRevision(revId, label) {
  const rev = await tctx.modules.persistence?.readRevision?.(revId);
  if (!rev?.graph) { showError('Could not load that version.'); return; }
  startReview(rev.graph, label);
}

/** The "Review changes…" picker — other open tabs + (if Drive-synced) this diagram's revisions. */
export async function openReviewPicker() {
  if (tctx.modules.canvas?.isReviewing?.()) tctx.modules.canvas.exitReview();   // restart cleanly
  const p = tctx.modules.persistence;
  const t = tctx.modules.tabs;
  const activeId = t?.getActiveTabId?.();
  const otherTabs = (t?.getAllTabs?.() || []).filter((x) => x.id !== activeId);
  const hasDriveFile = !!p?.activeHasDriveFile?.();
  // Only AUTO-list Drive revisions when a valid token already exists (silent, no overlay). Listing them
  // when signed-out would force getToken() -> an unsolicited Google sign-in overlay just from opening this
  // picker, and closing that overlay was crashing the app. When signed-out we offer an EXPLICIT sign-in
  // instead - the user opts in, nothing pops on its own.
  const driveReady = hasDriveFile && !!p?.isSignedIn?.();

  const { body, close } = buildModal({ title: 'Compare with…', width: '460px', className: 'df-review-picker' });
  const desc = document.createElement('p');
  desc.className = 'df-review-picker__desc';
  desc.textContent = 'Compare the current diagram against a baseline. Added, changed and removed shapes are tinted on the canvas - nothing is modified.';
  body.appendChild(desc);

  const section = (titleText) => { const h = document.createElement('h3'); h.className = 'df-review-picker__h'; h.textContent = titleText; body.appendChild(h); };
  // Baseline rows reuse the Save/Load storage-row table (storageRowHtml) for visual consistency + fuller
  // detail (type icon, shape count, storage chips, edited date). The action lives on the trailing "Compare"
  // button; the global mobile-disclosure handler (delegated on document) still works on these rows.
  const driveOn = !!p?.isDriveConfigured?.();
  const groupById = new Map((t?.getGroups?.() || []).map((g) => [g.id, g]));
  const typeLabel = (type) => (t?.DIAGRAM_TYPES?.[type]?.short) || 'Architecture';
  const activeType = (t?.getAllTabs?.() || []).find((x) => x.id === activeId)?.diagramType || '';
  const COMPARE_BTN = '<button type="button" class="df-modal__btn df-modal__btn--accent df-review-pick__go" style="margin-left:auto">Compare</button>';
  const addRow = (html, onClick) => {
    const tmp = document.createElement('template');
    tmp.innerHTML = html.trim();
    const row = tmp.content.firstElementChild;
    if (!row) return;
    row.querySelector('.df-review-pick__go')?.addEventListener('click', onClick);
    body.appendChild(row);
  };
  const simpleBtn = (label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'df-modal__btn df-modal__btn--accent df-review-picker__signin';
    b.textContent = label; b.addEventListener('click', onClick); body.appendChild(b);
  };

  let any = false;
  if (otherTabs.length) {
    any = true;
    section('Another open tab');
    otherTabs.forEach((tab) => {
      const shapes = countDiagramShapes(t.getTabGraphJSON(tab.id)?.cells);
      const groupBadge = (t.groupBadgeHtml?.(tab.groupId ? groupById.get(tab.groupId) : null) || '');
      const rel = formatRelativeTime(tab.lastModifiedAt || tab.lastSavedAt);
      addRow(storageRowHtml({
        diagramType: tab.diagramType, typeTitle: typeLabel(tab.diagramType), name: tab.name || 'Untitled',
        groupBadge, count: shapes,
        metaLeft: tabRowChipsHtml(tab, { driveOn }),   // shared: chips + Copy/Collab pill (one derivation)
        metaRight: rel ? `Edited ${rel}` : '',
        trailing: COMPARE_BTN,
      }), () => { const g = t.getTabGraphJSON(tab.id); close(); startReview(g, tab.name || 'another tab'); });
    });
  }

  if (driveReady) {
    section('A previous version (Drive)');
    const loading = document.createElement('p');
    loading.className = 'df-review-picker__sub'; loading.textContent = 'Loading version history…';
    body.appendChild(loading);
    let revs = null;
    try { revs = await p.listRevisions(); } catch { /* handled below */ }
    loading.remove();
    if (!revs) { const e = document.createElement('p'); e.className = 'df-review-picker__sub'; e.textContent = 'Could not load version history.'; body.appendChild(e); }
    else if (!revs.length) { const e = document.createElement('p'); e.className = 'df-review-picker__sub'; e.textContent = 'No saved versions yet.'; body.appendChild(e); }
    else {
      any = true;
      revs.forEach((r) => {
        const when = formatRelativeTime(Date.parse(r.modifiedTime)) || 'saved';   // revisions are past versions of THIS diagram → its type icon
        addRow(storageRowHtml({
          diagramType: activeType, typeTitle: typeLabel(activeType), name: when,
          metaLeft: `<span class="df-modal__row-meta">${escHtml(r.sizeLabel || '')}${r.by ? ' · ' + escHtml(r.by) : ''}</span>`,
          trailing: COMPARE_BTN,
        }), async () => { close(); await reviewAgainstRevision(r.id, when); });
      });
    }
  } else if (hasDriveFile) {
    // Drive-linked tab, but signed out: offer an explicit sign-in (no auto-overlay). Re-open the picker
    // once signed in so the saved versions appear.
    any = true;
    section('A previous version (Drive)');
    const e = document.createElement('p');
    e.className = 'df-review-picker__sub';
    e.textContent = 'Sign in to Google Drive to compare against a saved version.';
    body.appendChild(e);
    simpleBtn('Sign in to Google Drive', async () => {
      try { await p.signIn?.(); } catch { /* signIn surfaces its own toast on cancel/failure */ }
      if (p?.isSignedIn?.()) { close(); openReviewPicker(); }
    });
  }

  if (!any && !hasDriveFile) {
    const e = document.createElement('p');
    e.className = 'df-review-picker__empty';
    e.textContent = 'Open another diagram in a second tab, or save this one to Google Drive, to compare against it.';
    body.appendChild(e);
  }
}

/**
 * Compare the CURRENTLY ACTIVE tab against another tab IN PLACE - the diff overlay is drawn on the active
 * canvas with `tab` as the baseline. Wired to the tab right-click "Compare" (tabs.js): the user stays on their
 * open tab and right-clicks the one to compare against, so it must NOT switch tabs (the old behaviour switched
 * to the right-clicked tab, then opened the picker). Right-clicking the active tab itself can't diff against
 * itself, so we fall back to the picker so they can choose a baseline.
 */
export function compareActiveWithTab(tab) {
  if (!tab) return;
  const t = tctx.modules.tabs;
  if (tctx.modules.canvas?.isReviewing?.()) tctx.modules.canvas.exitReview();   // restart cleanly if already reviewing
  if (tab.id === t?.getActiveTabId?.()) { openReviewPicker(); return; }
  const baseline = t?.getTabGraphJSON?.(tab.id);
  if (!baseline) { showError('Could not read that diagram to compare against.'); return; }
  startReview(baseline, tab.name || 'another tab');
}

// Drive version history (CLEANUP S4) — lists the active synced diagram Drive revisions (View / Restore / Pin / eye-preview / Review). Reads tctx.modules; imports renderDriveSignIn (context) + reviewAgainstRevision (review) - one-way slice edges. sync-control calls showDriveHistoryModal.
import { buildModal, confirmModal } from '../feedback.js?v=1.19.4.4';
import { storageRowHtml } from '../storage-ui.js?v=1.19.4.4';
import { renderTemplateThumbnail } from '../templates.js?v=1.19.4.4';
import { countDiagramShapes, diffGraphs, escHtml, formatRelativeTime } from '../util.js?v=1.19.4.4';
import { btn, renderDriveSignIn, tctx } from './context.js?v=1.19.4.4';
import { reviewAgainstRevision } from './review.js?v=1.19.4.4';

// Version history for the active synced diagram — list its Drive revisions newest-first with View / Restore
// / Pin. Mirrors the library modal's loading/empty/error scaffold. Restore is non-destructive (the current
// version is pushed into history); the populated list + actions need real Drive (manual test).
export function showDriveHistoryModal() {
  const p = tctx.modules.persistence;
  if (!p.isDriveConfigured?.()) return;
  document.querySelector('.df-drive-history-modal')?.remove();

  const { body, footer, close } = buildModal({
    title: 'Version history',
    className: 'df-drive-history-modal',
    dialogClass: 'df-save-modal__dialog',   // 520px (shared)
    bodyClass: 'df-modal__row-list',
    bodyHtml: `
      <p class="df-drive-save-modal__hint" style="margin-bottom:6px">Past saves of this diagram in your Google Drive:</p>
      <ul class="df-history__legend">
        <li><strong>Open</strong> opens that version as an editable copy in a new tab - your current diagram stays untouched.</li>
        <li><strong>Restore</strong> brings it back as the current version (your current version stays in this list).</li>
        <li><strong>Pin</strong> keeps a version safe from Drive's automatic cleanup (about 30 days for unpinned ones).</li>
      </ul>
      <p class="df-drive-save-modal__hint" style="margin-top:6px">The most recent version is always kept, whether pinned or not.</p>
      <div class="df-drive-history__body"><p style="padding:18px;text-align:center;color:var(--text-secondary)">Loading…</p></div>`,
    footerHtml: '<button class="df-modal__btn df-modal__btn--primary df-drive-history__done" style="margin-left:auto">Done</button>',
  });
  footer.querySelector('.df-drive-history__done').addEventListener('click', close);
  const bodyBox = body.querySelector('.df-drive-history__body');
  const status = (html) => { bodyBox.innerHTML = `<p style="padding:18px;text-align:center;color:var(--text-secondary)">${html}</p>`; };

  const EYE = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>';
  // Rows reuse the shared two-line storage-row anatomy (storageRowHtml) so version history reads like the
  // Save / Load lists + gets the mobile collapse. The leading icon slot IS the eye preview-toggle (icon
  // override); the element count rides as a nameSuffix after the relative time; size · author is the detail
  // line; Open / Restore / Pin are the trailing actions. The rowwrap + preview-box wrap stays around it.
  const rowHtml = (r, prev) => {
    const pinned = !!r.keepForever;
    // data-prev-rev = the NEXT-older save, so the preview can diff "this save vs the previous" (Phase C, C2c).
    const prevAttr = prev && prev.id ? ` data-prev-rev="${escHtml(prev.id)}"` : '';
    const eye = `<button class="df-history__preview df-history__iconbtn" data-rev="${escHtml(r.id)}"${prevAttr} title="Preview this version" aria-label="Preview this version">${EYE}</button>`;
    const trailing =
      `<button class="df-modal__btn df-history__review" data-rev="${escHtml(r.id)}" title="Tint what changed between this version and the current diagram">Review</button>` +
      `<button class="df-modal__btn df-modal__btn--accent df-history__open" data-rev="${escHtml(r.id)}">Open</button>` +
      `<button class="df-modal__btn df-modal__btn--amber-outline df-history__restore" data-rev="${escHtml(r.id)}">Restore</button>` +
      `<button class="df-history__pin df-history__iconbtn${pinned ? ' is-pinned' : ''}" data-rev="${escHtml(r.id)}" data-keep="${pinned ? '1' : '0'}" title="${pinned ? 'Unpin (allow auto-cleanup)' : 'Pin (keep safe from auto-cleanup)'}" aria-label="${pinned ? 'Unpin' : 'Pin'}"><svg class="df-toolbar__icon" aria-hidden="true"><use href="#${pinned ? 'pinned' : 'pin'}"></use></svg></button>`;
    const inner = storageRowHtml({
      rowClass: 'df-history__row',
      icon: eye,
      leadingIcon: true,   // item 3: eye centres vertically across both lines; size·author line aligns under the time
      name: formatRelativeTime(Date.parse(r.modifiedTime)) || 'saved',
      nameSuffix: '<span class="df-history__count"></span>',
      metaLeft: `<span class="df-modal__row-meta">${escHtml(r.sizeLabel || '')}${r.by ? ' · ' + escHtml(r.by) : ''}</span>`,
      trailing,
    });
    return `<div class="df-history__rowwrap" data-rev="${escHtml(r.id)}">${inner}<div class="df-history__preview-box" hidden></div></div>`;
  };

  // Eye-preview: fetch THAT revision's content once (read-only, never touches the active diagram) and show a
  // thumbnail + element count inline under the row. Toggles; only one open at a time.
  const togglePreview = async (btn) => {
    const wrap = btn.closest('.df-history__rowwrap');
    const box = wrap.querySelector('.df-history__preview-box');
    const wasOpen = !box.hidden;
    bodyBox.querySelectorAll('.df-history__preview-box').forEach(b => { b.hidden = true; b.innerHTML = ''; });
    bodyBox.querySelectorAll('.df-history__preview').forEach(b => b.classList.remove('is-active'));
    if (wasOpen) return;   // second click → just close
    box.hidden = false;
    btn.classList.add('is-active');
    box.innerHTML = '<span class="df-history__preview-loading">Loading preview…</span>';
    const rev = await p.readRevision?.(btn.dataset.rev);
    if (box.hidden) return;   // user closed/switched while we awaited
    if (!rev || !rev.graph) { box.innerHTML = '<span class="df-history__preview-loading">Could not preview this version.</span>'; return; }
    const cells = rev.graph.cells || [];
    const n = countDiagramShapes(cells);
    // 15.1: the element count lives on the MAIN ROW (after the time, dot-separated), and stays once known even
    // after the preview collapses. 15.2: the diagram type is no longer shown in the preview.
    const countEl = wrap.querySelector('.df-history__count');
    if (countEl) countEl.textContent = ` · ${n} shape${n === 1 ? '' : 's'}`;
    // Phase C (C2c): diff this save against the PREVIOUS one so the preview highlights what changed since then
    // (green = added, amber = changed). Best-effort - a missing/unreadable previous revision just shows the plain
    // thumbnail (the oldest save has no previous, so no highlight, which is correct).
    let diff = null;
    const prevRev = btn.dataset.prevRev;
    if (prevRev) {
      try { const prev = await p.readRevision?.(prevRev); if (!box.hidden && prev && prev.graph) diff = diffGraphs(prev.graph, rev.graph); }
      catch { /* plain thumbnail */ }
    }
    if (box.hidden) return;
    box.innerHTML = '';
    // Item #12: a large preview that FILLS the modal width with a viewport-proportional height, the diagram
    // fit-to-content inside (renderTemplateThumbnail viewBox-fits). Render the mini-paper at ~the displayed box
    // size for a crisp clone (the CSS box is the source of visible size).
    const w = Math.max(280, Math.round(box.clientWidth - 24));   // minus the preview-box L+R padding (2x12)
    const ph = Math.min(Math.round(w * (window.innerHeight / window.innerWidth)), Math.round(window.innerHeight * 0.4));
    // Diff legend - only the keys that actually changed this save (added green / changed amber / removed red ghost).
    const keys = [];
    if (diff && diff.added && diff.added.size) keys.push(['add', 'Added']);
    if (diff && diff.changed && diff.changed.size) keys.push(['chg', 'Changed']);
    if (diff && diff.removedCells && diff.removedCells.length) keys.push(['del', 'Removed']);
    if (keys.length) {
      const legend = document.createElement('div');
      legend.className = 'df-history__preview-legend';
      legend.innerHTML = keys.map(([k, label]) => `<span class="df-diff-key df-diff-key--${k}">${label}</span>`).join('') +
        '<span class="df-history__preview-legend-since">since the previous save</span>';
      box.appendChild(legend);
    }
    const thumb = renderTemplateThumbnail({ cells }, w, ph, diff);
    thumb.classList.add('df-history__preview-thumb');
    box.appendChild(thumb);
  };

  const render = async () => {
    // Signed-out (token lapsed) but the tab is still Drive-linked: do NOT auto-call listRevisions, which would
    // force an unsolicited Google sign-in overlay on open. Offer the SHARED explicit Sign-in (orange, centred -
    // matching Load + Compare), never an auto-popup.
    if (p.activeHasDriveFile?.() && !p.isSignedIn?.()) {
      renderDriveSignIn(bodyBox, "Sign in to Google Drive to see this diagram's saved versions.", render);
      return;
    }
    status('Loading…');
    let revs;
    try { revs = await p.listRevisions(); }
    catch {
      bodyBox.innerHTML = `<p style="padding:18px;text-align:center;color:var(--text-secondary)">Could not load version history. <button class="df-modal__btn df-drive-history__retry">Retry</button></p>`;
      bodyBox.querySelector('.df-drive-history__retry')?.addEventListener('click', render);
      return;
    }
    if (!revs.length) { status('No saved versions yet - save this diagram to Google Drive and they appear here.'); return; }
    bodyBox.innerHTML = `<div class="df-modal__list-box">${revs.map((r, i) => rowHtml(r, revs[i + 1])).join('')}</div>`;
    bodyBox.querySelectorAll('.df-history__preview').forEach(btn => btn.addEventListener('click', () => togglePreview(btn)));
    bodyBox.querySelectorAll('.df-history__open').forEach(btn => btn.addEventListener('click', async () => { if (await p.viewRevision(btn.dataset.rev)) close(); }));
    bodyBox.querySelectorAll('.df-history__review').forEach(btn => btn.addEventListener('click', async () => {
      const when = formatRelativeTime(Date.parse((revs.find(r => r.id === btn.dataset.rev) || {}).modifiedTime)) || 'that version';
      close();
      await reviewAgainstRevision(btn.dataset.rev, when);
    }));
    bodyBox.querySelectorAll('.df-history__restore').forEach(btn => btn.addEventListener('click', async () => {
      const ok = await confirmModal({ title: 'Restore this version?', message: 'This brings the selected version back as the current one. Your current version is not lost - it stays in this history list.', okLabel: 'Restore', cancelLabel: 'Cancel' });
      if (ok && await p.restoreRevision(btn.dataset.rev)) close();
    }));
    bodyBox.querySelectorAll('.df-history__pin').forEach(btn => btn.addEventListener('click', async () => {
      if (await p.pinRevision(btn.dataset.rev, btn.dataset.keep !== '1')) render();
    }));

    // Item 4: show the shape count on OPEN (not only after an eye-preview). Drive revision metadata carries NO
    // shape count, so we read each revision's content in the BACKGROUND - capped to the most recent dozen and 3
    // at a time, so a long history doesn't hammer Drive - and fill the per-row count as it arrives. Best-effort:
    // a failed/slow read just leaves that row count-less until its eye-preview fills it. `render()` re-runs reset
    // it, so a stale token guards against filling a torn-down list.
    const myRevs = revs.slice(0, 12);
    let qi = 0;
    const fillWorker = async () => {
      while (qi < myRevs.length) {
        const r = myRevs[qi++];
        let rev; try { rev = await p.readRevision?.(r.id); } catch { continue; }
        const el = bodyBox.querySelector(`.df-history__rowwrap[data-rev="${CSS.escape(r.id)}"] .df-history__count`);
        if (el && !el.textContent && rev?.graph?.cells) { const n = countDiagramShapes(rev.graph.cells); el.textContent = ` · ${n} shape${n === 1 ? '' : 's'}`; }
      }
    };
    Promise.all([fillWorker(), fillWorker(), fillWorker()]).catch(() => {});
  };
  render();
}

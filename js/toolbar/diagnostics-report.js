// Help > Copy diagnostics (2026-09-24): one plain-text report a user can paste into a bug report.
//
// It carries COUNTS and states, never content: no diagram names, file ids, account emails or cell data. The user
// sees the whole text before copying, and nothing is sent anywhere by the app (limits/security.md, "Data
// privacy"). Recorded failures come from js/diagnostics.js; their messages can name a diagram, which the dialog says.
import { buildModal, showToast } from '../feedback.js?v=1.24.6';
import { formatBytes } from '../util.js?v=1.24.6';
import { recentErrors } from '../diagnostics.js?v=1.24.6';
import { isSessionHalted } from '../tabs/single-window.js?v=1.24.6';
import { getStorageBreakdown, NAMED_SAVE_PREFIX } from '../persistence/storage.js?v=1.24.6';
import { tctx } from './context.js?v=1.24.6';

const safe = (fn, fallback = 'unavailable') => { try { const v = fn(); return v ?? fallback; } catch { return fallback; } };
const time = (ms) => new Date(ms).toISOString().slice(11, 19);
const countBy = (arr, key) => arr.reduce((m, x) => { const k = key(x) || 'unknown'; m[k] = (m[k] || 0) + 1; return m; }, {});
const list = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';

/** The report text. Async only for the origin storage estimate. */
export async function buildDiagnosticsReport(modules = tctx.modules || {}) {
  const lines = [];
  const p = modules.persistence || {};
  const cacheKey = safe(() => (document.querySelector('script[type="module"][src*="app.js"]')?.src.match(/\?v=([\d.]+)/) || [])[1], '?');
  lines.push(`Diagramforce diagnostics - ${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}`);
  lines.push(`Version: ${safe(() => p.APP_VERSION, '?')} (cache ${cacheKey})   Host: ${location.host || 'file'}`);
  lines.push(`Browser: ${navigator.userAgent}`);
  const coarse = safe(() => matchMedia('(pointer: coarse)').matches, false);
  lines.push(`Screen: ${innerWidth}x${innerHeight} @${devicePixelRatio}x, ${coarse ? 'touch' : 'mouse'} pointer, ${navigator.onLine ? 'online' : 'OFFLINE'}, ${navigator.language}`);
  lines.push(`Service worker: ${navigator.serviceWorker?.controller ? 'active' : 'none'}   Window: ${safe(() => (isSessionHalted() ? 'superseded by another window (not saving)' : 'owns the session'))}`);

  const b = safe(() => getStorageBreakdown(), null);
  let quota = '';
  try {
    const est = await navigator.storage?.estimate?.();
    if (est && est.quota) quota = `; origin ${formatBytes(est.usage || 0)} of ${formatBytes(est.quota)}`;
  } catch { /* estimate unsupported */ }
  lines.push(b ? `Storage: localStorage ${formatBytes(b.total)} (diagrams ${formatBytes(b.diagrams)}, templates ${formatBytes(b.templates)}, app ${formatBytes(b.app)})${quota}` : 'Storage: unavailable');

  const tabs = safe(() => modules.tabs?.getAllTabs?.() || [], []);
  let session = {};
  try { session = JSON.parse(localStorage.getItem('sf-diagrams-tabs') || '{}') || {}; } catch { /* unreadable session */ }
  const stored = Array.isArray(session.tabs) ? session.tabs : [];
  lines.push(`Tabs: ${tabs.length} open (${list(countBy(tabs, (t) => t.diagramType))}); ${tabs.filter((t) => t.dirty).length} unsaved; `
    + `${tabs.filter((t) => t.driveFileId).length} linked to Drive (${stored.filter((t) => t.driveLocalOnly).length} look-only, `
    + `${stored.filter((t) => t.driveSharedInEdit || t.driveSharedSource).length} shared)`);
  let saves = 0;
  try { for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith(NAMED_SAVE_PREFIX)) saves++; } catch { /* storage blocked */ }
  lines.push(`Browser saves: ${saves}`);
  lines.push(`Drive: ${safe(() => (p.isDriveConfigured?.() ? 'configured' : 'not configured'))}; `
    + `${safe(() => (p.isSignedIn?.() ? 'signed in' : 'signed out'))}; auto-sync ${safe(() => (p.isAutosyncOn?.() ? 'on' : 'off'))}; `
    + `status ${safe(() => p.getDriveStatus?.()?.state || 'off')}`);

  const errs = recentErrors();
  lines.push('');
  lines.push(errs.length ? `Recent errors (${errs.length}, oldest first):` : 'Recent errors: none recorded in this tab.');
  for (const e of errs) {
    const head = `${time(e.at)}  ${e.kind.padEnd(13)} ${e.where}  ${e.name ? `${e.name}: ` : ''}${e.message}${e.count > 1 ? `  (x${e.count})` : ''}${e.earlier ? '  [before a reload]' : ''}`;
    lines.push(`  ${head}`);
    for (const frame of e.stack) lines.push(`      ${frame}`);
  }
  return lines.join('\n');
}

/** Help > Copy diagnostics: show the report, then copy it on request. */
export async function openDiagnosticsModal(modules = tctx.modules || {}) {
  const text = await buildDiagnosticsReport(modules);
  const m = buildModal({
    title: 'Copy diagnostics',
    className: 'df-diagnostics-modal',
    width: '640px',
    bodyHtml: `<p class="df-diagnostics__lead">A plain-text summary for a bug report: the version, your browser, storage use, tab and Drive counts,
      and any errors this tab recorded, including before a reload. It holds no diagram content, but an error message can mention a diagram's
      name, so read it before you send it. Nothing is sent anywhere unless you paste it.</p>
      <textarea class="df-diagnostics__text" readonly spellcheck="false" aria-label="Diagnostics report"></textarea>`,
    footerHtml: '<button class="df-modal__btn df-diagnostics__close">Close</button><button class="df-modal__btn df-modal__btn--primary df-diagnostics__copy">Copy</button>',
  });
  const area = m.body.querySelector('.df-diagnostics__text');
  area.value = text;
  m.footer.querySelector('.df-diagnostics__close').addEventListener('click', () => m.close());
  m.footer.querySelector('.df-diagnostics__copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Diagnostics copied', 'success');
      m.close();
    } catch {
      area.focus();
      area.select();
      showToast('Could not copy automatically - the text is selected, press Cmd/Ctrl+C.', 'warning');
    }
  });
  return m;
}

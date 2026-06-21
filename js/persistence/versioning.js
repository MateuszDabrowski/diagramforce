// Versioning — version-mismatch classification + the "loaded with an older
// version" warning modal, plus the content-signature dedup helpers. Extracted
// from persistence.js (Phase 3, Slice 2). A leaf: depends only on the
// persistence runtime context (`pctx`: appVersion + triggerDownload/dateSuffix
// for the backup button), util, and feedback — never on another sub-module.

import { compareSemver } from '../util.js?v=1.17.0.199';
import { escHtml } from '../util.js?v=1.17.0.199';
import { buildModal } from '../feedback.js?v=1.17.0.199';
import { pctx } from './context.js?v=1.17.0.199';

function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

/** Content signature of a cell array (a diagram's `graph.cells` or a template's
 *  `cells`). Two imports with the same signature are exact duplicates. Exported
 *  so templates.js shares identical dedup logic. */
export function contentSignature(cells) {
  return stableStringify(cells || []);
}

/**
 * Classify the version difference between saved and current app version.
 * Returns 'none' | 'patch' | 'minor' | 'major'.
 */
export function classifyVersionDiff(savedVersion) {
  const { appVersion: APP_VERSION } = pctx;
  if (!savedVersion) return 'major'; // no version at all — treat as major
  const saved = savedVersion.split('.').map(Number);
  const current = APP_VERSION.split('.').map(Number);
  if (saved[0] !== current[0]) return 'major';
  if (saved[1] !== current[1]) return 'minor';
  if (saved[2] !== current[2]) return 'patch';
  return 'none';
}

/**
 * Show a warning modal if the loaded data was saved with an older app version.
 * Returns a Promise that resolves to true (user wants to continue) or false.
 *
 * - Patch differences: no warning (silent load)
 * - Minor differences: no warning (R23, v1.17.0) — minor releases stay
 *   backward-compatible, so an older minor loads cleanly. Surfacing a notice on
 *   every minor was noise for shared links and a maintenance drag given how
 *   often minors ship; the one-time "What's new" overlay (js/whats-new.js)
 *   communicates app updates instead. Only a MAJOR mismatch (a breaking
 *   persistence change) still warns.
 * - Major differences: strong warning (probably won't load)
 * - No version info: treated as major
 */
// Multi-load coalescing (item 3): when a single user action loads MANY files (Load Selected in the Browser /
// Drive tabs), wrap the loop in begin/endVersionWarningBatch so a shared old version prompts ONCE, not per file.
// The decision (load anyway / cancel) is cached per distinct version string and reused for the rest of the batch.
let _versionBatchActive = false;
const _versionBatchDecisions = new Map();   // savedVersion string -> boolean (the user's answer)
export function beginVersionWarningBatch() { _versionBatchActive = true; _versionBatchDecisions.clear(); }
export function endVersionWarningBatch() { _versionBatchActive = false; _versionBatchDecisions.clear(); }

export function checkVersionWarning(savedAppVersion, sourceName, rawData) {
  const { appVersion: APP_VERSION } = pctx;
  if (compareSemver(savedAppVersion, APP_VERSION) >= 0) {
    return Promise.resolve(true); // same or newer — load without warning
  }
  const diff = classifyVersionDiff(savedAppVersion);
  if (diff !== 'major') {
    // none / patch / minor — load silently. Only a MAJOR mismatch (breaking
    // persistence change) is worth interrupting the load for (R23, v1.17.0).
    return Promise.resolve(true);
  }
  // In a batch, reuse the answer already given for this version (sequential awaits → the cache is set by the
  // time the next file is checked). One modal per distinct old version instead of one per file.
  const key = String(savedAppVersion || '(none)');
  if (_versionBatchActive && _versionBatchDecisions.has(key)) {
    return Promise.resolve(_versionBatchDecisions.get(key));
  }
  const p = showVersionWarningModal(savedAppVersion, sourceName, diff, rawData);
  if (_versionBatchActive) return p.then((ok) => { _versionBatchDecisions.set(key, ok); return ok; });
  return p;
}

function showVersionWarningModal(savedVersion, sourceName, diff, rawData) {
  const { appVersion: APP_VERSION, triggerDownload, dateSuffix } = pctx;
  return new Promise(resolve => {
    const savedLabel = savedVersion || 'unknown (no version)';
    const isMajor = diff === 'major';
    const title = isMajor ? 'Compatibility Warning' : 'Version Notice';
    const message = isMajor
      ? 'There were significant changes introduced since this diagram was saved. Your save probably won\'t load correctly.'
      : 'There have been some changes since this diagram was saved, but it should still work.';
    const loadLabel = isMajor ? 'Try Anyway' : 'Continue';

    let result = false; // becomes true only when the user picks "load"
    const { footer, close } = buildModal({
      title, // buildModal escapes via textContent
      zIndex: 10001,
      width: '440px',
      showClose: false, // decision dialog — dismiss via buttons / backdrop / Escape
      bodyStyle: 'padding:16px 20px',
      bodyHtml: `
        <p style="margin:0 0 12px">
          <strong>${escHtml(sourceName || 'This diagram')}</strong> was saved with
          <strong>v${escHtml(savedLabel)}</strong>, but the current app version is
          <strong>v${escHtml(APP_VERSION)}</strong>
          (<a href="https://github.com/MateuszDabrowski/diagramforce" target="_blank" rel="noopener" style="color:var(--color-primary)">GitHub</a>).
        </p>
        <p style="margin:0;color:var(--text-secondary)">
          ${message}
        </p>`,
      footerHtml: `
        <button class="df-modal__btn" data-action="cancel">Don't load</button>
        <button class="df-modal__btn" data-action="backup" style="margin-left:auto">Export JSON</button>
        <button class="df-modal__btn df-modal__btn--primary" data-action="load">${loadLabel}</button>`,
      onClose: () => resolve(result), // backdrop / Escape / cancel resolve false
    });
    footer.style.justifyContent = 'flex-end';

    footer.querySelector('[data-action="cancel"]').addEventListener('click', () => close());
    footer.querySelector('[data-action="backup"]').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      if (btn.dataset.saved) return;
      // Export the incoming diagram data as-is (the old version) as a backup
      const exportData = rawData ? JSON.parse(JSON.stringify(rawData)) : null;
      if (exportData) {
        // Normalise structure — share URLs use compact keys (v, av, name, type)
        const backupData = {
          version: exportData.version || exportData.v || 1,
          appVersion: exportData.appVersion || exportData.av || savedVersion || 'unknown',
          timestamp: exportData.timestamp || Date.now(),
          title: exportData.title || exportData.name || sourceName || 'Backup',
          diagramType: exportData.diagramType || exportData.type || 'architecture',
          graph: exportData.graph,
          viewport: exportData.viewport || null,
        };
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const safeName = (backupData.title).replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'backup';
        triggerDownload(URL.createObjectURL(blob), `df_backup_${safeName}_${dateSuffix()}.json`);
      }
      btn.textContent = 'Exported!';
      btn.style.background = '#2e844a';
      btn.style.color = '#fff';
      btn.style.borderColor = '#2e844a';
      btn.dataset.saved = '1';
    });
    footer.querySelector('[data-action="load"]').addEventListener('click', () => { result = true; close(); });
  });
}

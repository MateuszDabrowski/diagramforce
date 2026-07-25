// Domain-move localStorage bridge - NEW HOST ONLY (diagramforce.com).
//
// When the app is served from diagramforce.com, this offers a one-click "bring my
// diagrams over" flow that pulls the browser-only localStorage from the OLD origin
// (diagramforce.mateuszdabrowski.pl) and merges it into this origin's store.
// Every entry point is gated on location.hostname === NEW_HOST, so the whole
// module is a pure no-op on the old host and in tests (localhost / node).
//
// Why a top-level popup + postMessage (not a hidden iframe): localStorage is
// origin-scoped, and browser storage partitioning hands a cross-site IFRAME an
// EMPTY partitioned bucket - only a TOP-LEVEL first-party context on the old
// origin can read the real store. The old origin serves a minimal /migrate page
// from a Cloudflare Worker (the app itself no longer serves there after cutover -
// GitHub Pages serves exactly one custom domain per repo). The button is a user
// gesture so the popup isn't blocked; the Worker's /migrate page posts the store
// back with targetOrigin pinned to https://diagramforce.com, and we verify
// event.origin here - so the data only ever flows old -> new, both ends checked.
//
// See Documentation/backlog/domain-migration.md + dev/cloudflare/migrate-worker.js.

import { showToast } from '../feedback.js?v=1.20.1';
import { showWhatsNewNow } from '../whats-new.js?v=1.20.1';
import { importTemplatesArray } from '../templates.js?v=1.20.1';
import { NAMED_SAVE_PREFIX } from './storage.js?v=1.20.1';

const NEW_HOST = 'diagramforce.com';
const OLD_ORIGIN = 'https://diagramforce.mateuszdabrowski.pl';
const MIGRATED_KEY = 'df.migrated';
const PROMPTED_KEY = 'df_migration_prompted';
const SESSION_KEY = 'sf-diagrams-tabs';
const TEMPLATES_KEY = 'sfdiag::customTemplates';
const TEMPLATES_DELETED_KEY = 'sfdiag::customTemplatesDeleted';

// User preferences carried verbatim (adopt the old origin's choices). Diagrams, the
// session blob and templates get special handling below. Everything NOT listed here
// or matched as a named save is deliberately dropped (dev cred seeds, df.migrated,
// per-device panel height, backup-clock timestamps, the onboarding gate keys).
const SETTINGS_KEYS = [
  'sf-diagrams-theme',
  'sfdiag::brandColors', 'sfdiag::brandColorsSeeded',
  'sfdiag::connectorGrouping', 'sfdiag::focusDimming', 'sfdiag::crossingBumps', 'sfdiag::autoSizing',
  'df.showGroupLabels',
  'df.gdrive.autosync', 'df.gdrive.folderId', 'df.gdrive.templatesFileId',
];

export function isNewHost() { return typeof location !== 'undefined' && location.hostname === NEW_HOST; }
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode / quota */ } }

/**
 * New-host boot hook: force-show the "we've moved - bring your diagrams over" card
 * ONCE. The card lives in the 1.20.0 What's-New entry (injected only on this host,
 * in whats-new.js). No-op on the old host, once migration is done, or once already
 * prompted this browser. Returns true when it showed (so the boot sequence skips
 * the other deferred overlays). It stays reachable from Help / About afterwards.
 */
export function maybeShowMovedEntry() {
  if (!isNewHost()) return false;
  if (lsGet(MIGRATED_KEY) || lsGet(PROMPTED_KEY)) return false;
  lsSet(PROMPTED_KEY, '1');   // show once automatically; re-openable from the Help menu
  showWhatsNewNow();          // renders WHATS_NEW[0] incl. the injected "moved" highlight + button
  return true;
}

/**
 * Wired to the "Bring my diagrams over" button (a user gesture, so the popup isn't
 * blocked). Opens the old origin's /migrate page top-level, receives its
 * localStorage via an origin-checked postMessage, merges, flags, reloads.
 */
export function startDomainMigration() {
  if (!isNewHost()) return;
  const win = window.open(OLD_ORIGIN + '/migrate', 'df-migrate', 'width=460,height=340');
  if (!win) {
    showToast('Please allow pop-ups for diagramforce.com, then click "Bring my diagrams over" again.', 'warning', { duration: 6000 });
    return;
  }
  let done = false;
  const onMessage = (ev) => {
    if (ev.origin !== OLD_ORIGIN) return;                  // only the old origin may hand us data
    if (!ev.data || ev.data.type !== 'df-migration-data') return;
    done = true;
    cleanup();
    try { win.close(); } catch { /* ignore */ }
    finishMigration(ev.data.store && typeof ev.data.store === 'object' ? ev.data.store : {});
  };
  const timer = setTimeout(() => {
    if (done) return;
    cleanup();
    showToast('Could not reach the old site. Please try again, or allow pop-ups first.', 'warning', { duration: 6000 });
  }, 30000);
  function cleanup() { clearTimeout(timer); window.removeEventListener('message', onMessage); }
  window.addEventListener('message', onMessage);
}

function finishMigration(store) {
  const summary = applyMigration(store);
  if (summary.saves + summary.templates + (summary.session ? 1 : 0) === 0) {
    lsSet(MIGRATED_KEY, '1');   // nothing to carry - don't nag again
    showToast('No browser-saved diagrams were found on the old address.', 'info', { duration: 5000 });
    return;
  }
  lsSet(MIGRATED_KEY, '1');     // set LAST, after every data key is written
  const parts = [];
  if (summary.saves) parts.push(`${summary.saves} saved diagram${summary.saves === 1 ? '' : 's'}`);
  if (summary.templates) parts.push(`${summary.templates} template${summary.templates === 1 ? '' : 's'}`);
  showToast(`Brought over ${parts.join(' and ') || 'your work'} - reloading...`, 'success', { duration: 2500 });
  setTimeout(() => location.reload(), 900);   // reboot so the restored session/saves take effect
}

/** Merge the old-origin localStorage `store` into this origin. Allowlisted keys only;
 *  collision-safe for named saves + templates; the session blob is overwritten only
 *  when this origin is still a fresh empty Draft (never clobbers real new-origin work). */
function applyMigration(store) {
  let saves = 0, templates = 0, session = false;
  // 1. Preferences - adopt the old origin's choices verbatim.
  for (const k of SETTINGS_KEYS) if (store[k] != null) lsSet(k, store[k]);
  // 2. Custom templates - union-merge (dedup by content, rename on name clash). Carry the delete tombstones.
  if (store[TEMPLATES_KEY]) {
    try {
      const arr = JSON.parse(store[TEMPLATES_KEY]);
      if (Array.isArray(arr) && arr.length) templates = importTemplatesArray(arr) || 0;
    } catch { /* malformed - skip */ }
  }
  if (store[TEMPLATES_DELETED_KEY] && !lsGet(TEMPLATES_DELETED_KEY)) lsSet(TEMPLATES_DELETED_KEY, store[TEMPLATES_DELETED_KEY]);
  // 3. Named browser saves - copy; rename on a name clash with different content.
  for (const k of Object.keys(store)) {
    if (!k.startsWith(NAMED_SAVE_PREFIX)) continue;
    const existing = lsGet(k);
    if (existing == null || existing === store[k]) {
      lsSet(k, store[k]);
    } else {
      const renamed = renameSave(k, store[k]);
      lsSet(renamed.key, renamed.value);
    }
    saves++;
  }
  // 4. Working session - overwrite ONLY if this origin is still an empty Draft.
  if (store[SESSION_KEY] && sessionIsFresh()) { lsSet(SESSION_KEY, store[SESSION_KEY]); session = true; }
  return { saves, templates, session };
}

/** Find a free "<name> (N)" key for a same-name-different-content save clash, and
 *  patch the stored value's `name` so the Save Manager shows the new label. */
function renameSave(origKey, value) {
  const base = origKey.slice(NAMED_SAVE_PREFIX.length);
  let n = 2, key;
  do { key = `${NAMED_SAVE_PREFIX}${base} (${n})`; n++; } while (lsGet(key) != null);
  let out = value;
  try { const v = JSON.parse(value); v.name = `${base} (${n - 1})`; out = JSON.stringify(v); } catch { /* keep raw */ }
  return { key, value: out };
}

/** True when this origin's session is still a default empty Draft (no content-bearing
 *  tab), so overwriting it with the old session can't destroy real new-origin work. */
function sessionIsFresh() {
  const raw = lsGet(SESSION_KEY);
  if (!raw) return true;
  try {
    const s = JSON.parse(raw);
    const tabs = Array.isArray(s.tabs) ? s.tabs : [];
    if (!tabs.length) return true;
    return tabs.every(t => {
      const cells = t && t.graphJSON && Array.isArray(t.graphJSON.cells) ? t.graphJSON.cells : [];
      return cells.length === 0;
    });
  } catch { return true; }
}

// Exposed for unit tests (dev/tests/migration-bridge.test.js). The merge is the one
// part that touches user diagram data, so its rules (allowlist, collision-safe save
// renaming, fresh-session gate) are covered headlessly. NOT part of the public API.
export const _test = { applyMigration, renameSave, sessionIsFresh, SETTINGS_KEYS };

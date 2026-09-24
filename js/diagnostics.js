// Recent failures, kept in memory for Help > Copy diagnostics (2026-09-24).
//
// WHY. 108 catch blocks in js/ swallowed their error with nothing left behind, so a report like "it didn't save"
// arrived with no evidence and every diagnosis started from a guess. The fix is not a crash reporter: the app has
// no backend and sends nothing anywhere (limits/security.md, "Data privacy"). Failures are recorded HERE, for this
// tab only, and leave the browser only when the user copies the report and chooses to send it.
//
// What feeds it:
//   - noteError(where, err): the catches whose silence hid a real failure (a Drive sweep step, a templates sync, a
//     corrupt browser save, an Auto Layout step, a malformed share link). Cosmetic catches (focus restore,
//     animations, preference writes) stay silent on purpose.
//   - installErrorCapture(): uncaught errors, unhandled promise rejections, and the app's own console.error /
//     console.warn calls. The console methods are wrapped, never replaced: the original still runs.
//
// The log is mirrored to sessionStorage, so it survives a reload of the same tab: the usual reaction to "it didn't
// save" is to reload, which would otherwise wipe the evidence. sessionStorage is per tab and cleared when the tab
// closes; nothing is sent anywhere. Entries from an earlier load of the tab are marked in the report.
//
// No imports and no DOM work at load, so any module can import it without a cycle.

const MAX_ENTRIES = 50;
const MAX_TEXT = 300;
const STORE_KEY = 'df.diagnostics.log';
const PAGE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const entries = hydrate();
let installed = false;

function store() {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }   // blocked storage throws on access
}
function hydrate() {
  try {
    const raw = store()?.getItem(STORE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((e) => e && typeof e.at === 'number' && typeof e.where === 'string').slice(-MAX_ENTRIES) : [];
  } catch { return []; }   // unreadable log: start fresh
}
function persist() {
  try { store()?.setItem(STORE_KEY, JSON.stringify(entries)); } catch { /* full or blocked: the in-memory log still works */ }
}

const clip = (s, n = MAX_TEXT) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function describe(err) {
  if (err == null) return { name: '', message: '' };
  if (typeof err === 'string') return { name: '', message: err };
  const name = err.name || err.constructor?.name || '';
  let message = err.message;
  if (message == null) { try { message = JSON.stringify(err); } catch { message = String(err); } }
  // Two frames are enough to place it; a full stack is noise in a pasted report.
  const stack = typeof err.stack === 'string' ? err.stack.split('\n').filter((l) => /\w/.test(l)).slice(1, 3).map((l) => l.trim()) : [];
  return { name: name === 'Error' ? '' : name, message, stack };
}

function push(kind, where, err) {
  const d = describe(err);
  const last = entries[entries.length - 1];
  // A failure repeating in a loop (a sweep retrying every tab) is one line with a count, not fifty.
  if (last && last.page === PAGE_ID && last.kind === kind && last.where === where && last.message === clip(d.message)) {
    last.count += 1;
    last.at = Date.now();
    persist();
    return;
  }
  entries.push({ at: Date.now(), page: PAGE_ID, kind, where: clip(where, 80), name: d.name, message: clip(d.message), stack: d.stack || [], count: 1 });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  persist();
}

/** Record a failure a catch block handled on purpose. `where` names the operation, e.g. 'drive:reconcile'. */
export function noteError(where, err) {
  try { push('caught', where, err); } catch { /* the recorder must never throw into its caller */ }
}

/** The recorded failures, oldest first (copies). `earlier` marks one recorded before this tab last reloaded. */
export function recentErrors() {
  return entries.map((e) => ({ ...e, stack: [...(e.stack || [])], earlier: e.page !== PAGE_ID }));
}

/** For tests: forget everything recorded, in memory and in the tab's sessionStorage. */
export function clearErrors() {
  entries.length = 0;
  try { store()?.removeItem(STORE_KEY); } catch { /* blocked storage */ }
}

/** Capture uncaught errors, unhandled rejections and console.error / console.warn. Call once at boot. */
export function installErrorCapture(win = typeof window !== 'undefined' ? window : null) {
  if (installed || !win) return;
  installed = true;
  win.addEventListener('error', (ev) => {
    // A resource that failed to load (an <img>, a <script>, an SVG <image>) reports on its element, with no error
    // object. An SVG element's href is an SVGAnimatedString; the URL is its baseVal.
    const t = ev.target && ev.target !== win ? ev.target : null;
    const target = t ? (t.src || (t.href && typeof t.href === 'object' ? t.href.baseVal : t.href) || t.getAttribute?.('href') || '') : null;
    // Only a failed NETWORK load is evidence. Saves store icons as a stub (`data:image/svg+xml,<svg
    // data-icon-id=".."/>`) that refreshAllIconHrefs swaps for the full icon right after render, and an <image> with
    // an empty href fails the same way: every boot logged two or three of these, which would bury real failures.
    if (t && !/^https?:/i.test(target)) return;
    push('uncaught', t ? `resource ${clip(target, 60)}` : `${clip(ev.filename || '', 60)}:${ev.lineno || 0}`, ev.error || ev.message || 'load failed');
  }, true);
  win.addEventListener('unhandledrejection', (ev) => push('unhandled', 'promise', ev.reason));
  const con = win.console;
  for (const level of ['error', 'warn']) {
    const original = con?.[level];
    if (typeof original !== 'function') continue;
    con[level] = function (...args) {
      try {
        const err = args.find((a) => a instanceof Error);
        const text = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');
        push(`console.${level}`, 'console', err ? { name: err.name || 'Error', message: text, stack: err.stack } : text);
      } catch { /* never break logging */ }
      return original.apply(this, args);
    };
  }
}

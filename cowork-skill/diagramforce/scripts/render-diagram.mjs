#!/usr/bin/env node
// Render Diagramforce diagram JSON to a PNG, SVG or WEBP file with a local headless browser - for pipelines that
// build a diagram from Salesforce / Data Cloud metadata and put the image straight into documentation.
//
//   node render-diagram.mjs diagram.json [more.json ...] [--out <file|dir>] [--format png|svg|webp]
//        [--theme light|dark] [--transparent] [--app <url>] [--browser <path>] [--timeout <seconds>]
//
// How it works: it starts a Chromium-family browser headless (Chrome, Edge, Chromium, Brave, Vivaldi, or a browser
// Playwright downloaded), opens Diagramforce with its public render message (how-to-use/web-integration.md, "Get an image
// back"), and writes the image the app's own Save-menu export produces - so the file looks exactly like an export
// from the app. The diagram JSON only ever goes into that local browser: the app is static files with no server
// (default https://diagramforce.com; pass --app for a local or pinned copy). Zero npm dependencies: the browser is
// driven over the DevTools Protocol with Node's built-in WebSocket (Node 22+).
//
// Every file is validated first (the checks validate-diagram.mjs runs); a file with errors is skipped, not rendered.
// Output: one file per input, next to the input unless --out names a file (one input) or a folder.
// Exit code: 0 when every file rendered, 1 when any failed, 2 for a usage error or no browser.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFile } from './diagram-schema.js';

export const DEFAULT_APP = 'https://diagramforce.com/';
// The version this skill's bundled spec targets (its "Spec snapshot: vX" marker), as the converters read it.
export const SPEC_VERSION = (() => {
  try { return (readFileSync(new URL('../references/DIAGRAM_JSON_SPEC.md', import.meta.url), 'utf8').match(/Spec snapshot: v([\d.]+)/) || [])[1] || '1.0.0'; }
  catch { return '1.0.0'; }
})();
const FORMATS = ['png', 'svg', 'webp'];
const COMMAND_TIMEOUT_MS = 30000;

// ── Arguments ───────────────────────────────────────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const opts = { inputs: [], out: null, format: null, theme: 'light', transparent: false, app: DEFAULT_APP, browser: null, timeoutMs: 60000 };
  const need = (i, flag) => { if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' || a === '-o') opts.out = need(i++, a);
    else if (a === '--format') opts.format = need(i++, a).toLowerCase();
    else if (a === '--theme') opts.theme = need(i++, a).toLowerCase();
    else if (a === '--transparent') opts.transparent = true;
    else if (a === '--app') opts.app = need(i++, a);
    else if (a === '--browser') opts.browser = need(i++, a);
    else if (a === '--timeout') opts.timeoutMs = Number(need(i++, a)) * 1000;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else opts.inputs.push(a);
  }
  if (!opts.format && opts.out && FORMATS.includes(extname(opts.out).slice(1).toLowerCase())) opts.format = extname(opts.out).slice(1).toLowerCase();
  opts.format ||= 'png';
  if (!FORMATS.includes(opts.format)) throw new Error(`--format must be one of ${FORMATS.join(', ')}`);
  if (!['light', 'dark'].includes(opts.theme)) throw new Error('--theme must be light or dark');
  if (!(opts.timeoutMs > 0)) throw new Error('--timeout must be a number of seconds');
  try { opts.app = new URL(opts.app).href; } catch { throw new Error(`--app is not a URL: ${opts.app}`); }
  if (!opts.help && !opts.inputs.length) throw new Error('give at least one diagram JSON file');
  return opts;
}

// Where each input's image goes: --out as a FILE (one input, image extension), --out as a folder, or next to the input.
export function outputPathFor(input, { out, format, inputsCount }) {
  const name = basename(input, extname(input)) + '.' + format;
  if (!out) return join(dirname(input), name);
  const looksLikeFile = FORMATS.includes(extname(out).slice(1).toLowerCase());
  if (looksLikeFile && inputsCount === 1) return out;
  if (looksLikeFile) throw new Error('--out names one file, but several inputs were given - pass a folder instead');
  return join(out, name);
}

// ── Finding a browser ───────────────────────────────────────────────────────────────────────────────────────
// Chromium-family only (the DevTools Protocol). Order: explicit, environment, installed browsers, then Playwright's
// download cache.
export function browserCandidates({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  const list = [];
  for (const k of ['DIAGRAMFORCE_BROWSER', 'CHROME_PATH']) if (env[k]) list.push(env[k]);
  if (platform === 'darwin') {
    for (const root of ['/Applications', join(home, 'Applications')]) {
      list.push(`${root}/Google Chrome.app/Contents/MacOS/Google Chrome`, `${root}/Chromium.app/Contents/MacOS/Chromium`,
        `${root}/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`, `${root}/Brave Browser.app/Contents/MacOS/Brave Browser`,
        `${root}/Vivaldi.app/Contents/MacOS/Vivaldi`);
    }
  } else if (platform === 'win32') {
    for (const base of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)) {
      list.push(join(base, 'Google/Chrome/Application/chrome.exe'), join(base, 'Microsoft/Edge/Application/msedge.exe'),
        join(base, 'Chromium/Application/chrome.exe'), join(base, 'BraveSoftware/Brave-Browser/Application/brave.exe'),
        join(base, 'Vivaldi/Application/vivaldi.exe'));
    }
  } else {
    for (const dir of String(env.PATH || '').split(delimiter).filter(Boolean)) {
      for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser', 'vivaldi', 'vivaldi-stable']) list.push(join(dir, bin));
    }
  }
  const cache = env.PLAYWRIGHT_BROWSERS_PATH
    || (platform === 'darwin' ? join(home, 'Library/Caches/ms-playwright')
      : platform === 'win32' ? join(env.LOCALAPPDATA || home, 'ms-playwright') : join(home, '.cache/ms-playwright'));
  list.push(...playwrightBrowsers(cache, platform));
  return list;
}

// Newest first: the headless shell (smallest), then full Chromium builds.
function playwrightBrowsers(cache, platform) {
  let dirs = [];
  try { dirs = readdirSync(cache); } catch { return []; }
  const byVersion = (prefix) => dirs.filter((d) => d.startsWith(prefix)).sort((a, b) => Number(b.split('-').pop()) - Number(a.split('-').pop()));
  const exe = platform === 'win32' ? '.exe' : '';
  const out = [];
  for (const d of byVersion('chromium_headless_shell-')) {
    for (const sub of safeList(join(cache, d))) out.push(join(cache, d, sub, 'chrome-headless-shell' + exe));
  }
  for (const d of byVersion('chromium-')) {
    for (const sub of safeList(join(cache, d))) {
      out.push(join(cache, d, sub, 'Chromium.app/Contents/MacOS/Chromium'), join(cache, d, sub, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        join(cache, d, sub, 'chrome' + exe));
    }
  }
  return out;
}
const safeList = (p) => { try { return readdirSync(p); } catch { return []; } };

export function findBrowser(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  return browserCandidates().find((p) => { try { return statSync(p).isFile(); } catch { return false; } }) || null;
}

// ── The browser and the DevTools Protocol ───────────────────────────────────────────────────────────────────
// Linux refuses Chromium's sandbox in two common places: as root in a container, and on Ubuntu 23.10+ where AppArmor
// blocks the unprivileged user namespaces the sandbox needs - unless the browser ships its own AppArmor profile, which a
// distro package does and a downloaded build (Playwright's cache, a zip) does not. The browser then dies on a signal
// before it is ready: `exited (null)` on GitHub's Ubuntu runner, the first time the 1.25.0 tag ran this (2026-10-06).
// So: start with the sandbox, and only when the browser dies before it is ready start it once more without, and say
// so. Playwright launches every Chromium without it by default, and what renders is the user's own diagram in the app
// they chose. The browser's own last error line goes into the message, so the next failure explains itself.
export function launchArgs(profile, { noSandbox = false } = {}) {
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
    // Full Chrome blocks a window.open without a user gesture (the headless shell does not); the opener needs it.
    '--disable-popup-blocking', 'about:blank'];
  return noSandbox ? ['--no-sandbox', ...args] : args;
}
async function launch(browserPath) {
  try { return await launchOnce(browserPath, { noSandbox: process.getuid?.() === 0 }); }
  catch (e) {
    if (!e.earlyExit || e.noSandbox) throw e;
    console.error(`⚠ the browser stopped before it was ready (${e.detail}) - retrying without its sandbox`);
    return launchOnce(browserPath, { noSandbox: true });
  }
}
async function launchOnce(browserPath, { noSandbox }) {
  const profile = mkdtempSync(join(tmpdir(), 'diagramforce-render-'));
  const proc = spawn(browserPath, launchArgs(profile, { noSandbox }), { stdio: ['ignore', 'ignore', 'pipe'] });
  const dropProfile = () => { try { rmSync(profile, { recursive: true, force: true }); } catch { /* busy */ } };
  let buf = '';
  const wsUrl = await new Promise((res, rej) => {
    const t = setTimeout(() => { proc.kill('SIGKILL'); dropProfile(); rej(new Error(`the browser did not start: ${browserPath}`)); }, 20000);
    proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); res(m[1]); } });
    proc.on('exit', (code, signal) => {
      clearTimeout(t);
      dropProfile();
      // The line that names the problem, not the stack trace Chromium prints under a FATAL.
      const lines = buf.split('\n').map((l) => l.trim()).filter(Boolean);
      const lastLine = lines.filter((l) => /FATAL|ERROR/.test(l)).pop() || lines.pop() || 'no error output';
      const detail = `${signal || `exit ${code}`}: ${lastLine.slice(0, 200)}`;
      rej(Object.assign(new Error(`the browser exited before it was ready (${detail}): ${browserPath}`), { earlyExit: true, noSandbox, detail }));
    });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => { proc.kill('SIGKILL'); dropProfile(); rej(new Error('could not connect to the browser')); }, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const waiters = new Set();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message)); else res(msg.result);
      return;
    }
    for (const w of waiters) if (w.test(msg)) { waiters.delete(w); w.res(msg); }
  });
  // Every command gets an answer or an error: a browser that accepts the connection and then goes quiet must fail with
  // a message, never hang the pipeline.
  const send = (method, params = {}, sessionId, ms = COMMAND_TIMEOUT_MS) => new Promise((res, rej) => {
    const i = ++id;
    const t = setTimeout(() => { if (pending.delete(i)) rej(new Error(`the browser did not answer ${method}`)); }, ms);
    pending.set(i, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  const waitFor = (test, ms, what) => new Promise((res, rej) => {
    const w = { test, res };
    waiters.add(w);
    setTimeout(() => { if (waiters.delete(w)) rej(new Error(`timed out waiting for ${what}`)); }, ms);
  });
  // Ask the browser to quit, then SIGTERM, then SIGKILL: a busy Vivaldi ignored SIGTERM and outlived the CLI.
  const exited = new Promise((res) => proc.once('exit', res));
  const close = async () => {
    await Promise.race([send('Browser.close').catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
    try { ws.close(); } catch { /* gone */ }
    proc.kill('SIGTERM');
    const t = setTimeout(() => proc.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(t);
    dropProfile();
  };
  return { send, waitFor, close };
}

const evaluate = async (cdp, sessionId, expression, ms) => {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId, ms);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

// One diagram: an opener page on the app's origin opens the app (on about:blank first, so its colour scheme, the
// first-run tour and the service-worker bypass are set before it boots), then hands it the render message from
// how-to-use/web-integration.md and waits for the image. Both pages are closed afterwards.
async function renderOne(cdp, json, { app, format, theme, transparent, timeoutMs }) {
  const origin = new URL(app).origin;
  await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage,indexeddb,service_workers,cache_storage' }).catch(() => {});
  // The opener tab is navigated with Page.navigate and polled until loaded, never Page.enable'd: Vivaldi answers no
  // page-level command (Page.enable, Runtime.evaluate) on a tab until it has navigated to a real page, and does not
  // navigate a tab created with a URL.
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: opener } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  let popupId = null;
  try {
    await cdp.send('Page.navigate', { url: new URL('manifest.json', app).href }, opener);
    const until = Date.now() + timeoutMs;
    for (;;) {
      const state = await evaluate(cdp, opener, `location.origin === ${JSON.stringify(origin)} && document.readyState === 'complete'`, 2000).catch(() => false);
      if (state) break;
      if (Date.now() > until) throw new Error(`${origin} did not load (offline, or a wrong --app?)`);
      await new Promise((r) => setTimeout(r, 100));
    }

    const created = cdp.waitFor((m) => m.method === 'Target.targetCreated' && m.params.targetInfo.openerId === targetId, 10000, 'the app tab');
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    await evaluate(cdp, opener, `(() => {
      const json = ${JSON.stringify(json)}, req = ${JSON.stringify({ source: 'diagramforce', type: 'render', v: 1, id: 1, format, transparent })};
      window.__dfWin = window.open('about:blank', '_blank');
      window.__dfResult = new Promise((resolve) => addEventListener('message', (e) => {
        const d = e.data;
        if (e.source !== window.__dfWin || d?.source !== 'diagramforce') return;
        if (d.type === 'ready') window.__dfWin.postMessage({ ...req, json }, location.origin);
        else if (d.type === 'rendered' || d.type === 'render-error') resolve(d);
      }));
    })()`);
    popupId = (await created).params.targetInfo.targetId;
    const { sessionId: popup } = await cdp.send('Target.attachToTarget', { targetId: popupId, flatten: true });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }, popup);
    await cdp.send('Network.enable', {}, popup);
    await cdp.send('Network.setBypassServiceWorker', { bypass: true }, popup);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('df_first_visit_help_shown', 'true'); } catch {}" }, popup);
    await evaluate(cdp, opener, `window.__dfWin.location.href = ${JSON.stringify(new URL('#import=postmessage', app).href)}`);

    const reply = await Promise.race([
      evaluate(cdp, opener, 'window.__dfResult', timeoutMs + 5000),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`no reply from ${origin} within ${timeoutMs / 1000}s (offline, a wrong --app, or an app version without render)`)), timeoutMs)),
    ]);
    if (reply.type === 'render-error') throw new Error(reply.error || 'render failed');
    return reply;
  } finally {
    if (popupId) await cdp.send('Target.closeTarget', { targetId: popupId }).catch(() => {});
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

export function dataUrlToBuffer(dataUrl) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(String(dataUrl));
  if (!m) throw new Error('the app returned no image');
  return m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
}

const HELP = `Render Diagramforce JSON to an image with a local headless browser.

  node render-diagram.mjs diagram.json [more.json ...] [options]

  --out <file|dir>        output file (one input) or folder; default: next to each input
  --format png|svg|webp   default png, or taken from --out's extension
  --theme light|dark      default light
  --transparent           no background
  --app <url>             Diagramforce to use (default ${DEFAULT_APP}); a local copy works offline
  --browser <path>        a Chrome / Edge / Chromium / Brave / Vivaldi binary (default: found automatically)
  --timeout <seconds>     per diagram, default 60`;

/** The raster's scale against the diagram's own size, from the cells' bounding box. A browser canvas is capped at
 *  8192 px a side, so the app's 2x export shrinks a big diagram: a 68-role whole-org chart came out 8192 px wide for
 *  a 13974 px SVG, its text unreadable, and nothing said so (found verifying the skill, 1.25.3). The box ignores
 *  link routes and the export margin, so it overstates the size slightly and errs towards warning. SVG is never
 *  capped: Infinity. */
export function rasterScale(job, img) {
  if (/\.svg$/i.test(job.out)) return Infinity;
  let cells = [];
  try { cells = JSON.parse(job.text)?.graph?.cells || []; } catch { return Infinity; }
  const boxes = cells.filter((c) => c?.position && c?.size);
  if (!boxes.length) return Infinity;
  const w = Math.max(...boxes.map((c) => c.position.x + c.size.width)) - Math.min(...boxes.map((c) => c.position.x));
  const h = Math.max(...boxes.map((c) => c.position.y + c.size.height)) - Math.min(...boxes.map((c) => c.position.y));
  return Math.min(w > 0 ? img.width / w : Infinity, h > 0 ? img.height / h : Infinity);
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`✗ ${e.message}\n\n${HELP}`); process.exit(2); }
  if (opts.help) { console.log(HELP); return; }
  const browser = findBrowser(opts.browser);
  if (!browser) {
    console.error(opts.browser ? `✗ no browser at ${opts.browser}`
      : '✗ no Chromium-family browser found (Safari and Firefox cannot be driven this way). Install Google Chrome,\n'
        + '  Microsoft Edge, Chromium, Brave or Vivaldi, or run\n'
        + '    npx playwright install chromium-headless-shell\n  or pass --browser <path>.');
    process.exit(2);
  }
  let failed = 0;
  const jobs = [];
  for (const input of opts.inputs) {
    let text, json;
    try { text = readFileSync(input, 'utf8'); json = JSON.parse(text); } catch (e) { console.log(`✗ ${input}: ${e.message}`); failed++; continue; }
    const errors = validateFile(json).flatMap((r) => r.errors);
    if (errors.length) { console.log(`✗ ${input}: not rendered - ${errors.length} validation error(s), run validate-diagram.mjs`); failed++; continue; }
    // A file with no appVersion opens behind the app's compatibility dialog, which nobody can answer headless. Stamp
    // the version this skill's spec targets, as the converters do, and say so (the input file is not changed).
    if (json && !json.appVersion) {
      json.appVersion = SPEC_VERSION;
      text = JSON.stringify(json);
      console.log(`⚠ ${input}: no appVersion - rendered as ${SPEC_VERSION} (add "appVersion" to the file)`);
    }
    let out;
    try { out = outputPathFor(input, { out: opts.out, format: opts.format, inputsCount: opts.inputs.length }); } catch (e) { console.error(`✗ ${e.message}`); process.exit(2); }
    jobs.push({ input, text, out });
  }
  if (jobs.length) {
    let cdp;
    try { cdp = await launch(browser); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
    try {
      for (const job of jobs) {
        try {
          const t0 = Date.now();
          const img = await renderOne(cdp, job.text, opts);
          mkdirSync(dirname(resolve(job.out)), { recursive: true });
          writeFileSync(job.out, dataUrlToBuffer(img.dataUrl));
          const kb = Math.round(statSync(job.out).size / 1024);
          console.log(`✓ ${job.out}  ${img.width} x ${img.height}  ${kb} KB  ${Date.now() - t0} ms`);
          const scale = rasterScale(job, img);
          if (scale < 1) {
            console.log(`⚠ ${job.out}: drawn at ${scale.toFixed(2)}x - past the 8192 px canvas cap, so small text may not`
              + ' read. Render to .svg for full size, or draw less (a role chart takes --root).');
          }
        } catch (e) { console.log(`✗ ${job.input}: ${e.message}`); failed++; }
      }
    } finally { await cdp.close(); }
  }
  process.exit(failed ? 1 : 0);
}

// Entry point: compare REAL paths. The module URL is symlink-resolved and percent-encoded while argv[1] is as typed,
// so a plain comparison skips main() under "Application Support" or a symlinked folder (skill-cli-paths.test.js).
const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) main();

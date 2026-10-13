#!/usr/bin/env node
// Is there a newer Diagramforce skill? Compares the release this skill was built for (its spec's "Spec snapshot") with
// the release diagramforce.com runs (the CACHE_VERSION in the live sw.js, the one file that always says what prod
// runs), and prints ONE line when the site is newer. The skill cannot replace itself - it lives in the user's claude.ai
// account - so the line says how to update.
//
//   node scripts/check-update.mjs
//
// Prints exactly one line: "ℹ ..." when a newer skill exists (the only line worth relaying to the user), "✓ ..." when
// this one is current, "· ..." when the site could not be reached (a chat sandbox without network, a timeout, anything
// unexpected). The check never blocks or alarms: exit code is always 0. It fetches one small public file from
// diagramforce.com and sends nothing about the user or their diagrams.
// Zero dependencies (Node 18+ fetch).
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SITE = 'https://diagramforce.com/';
export const TIMEOUT_MS = 2000;

/** The release this skill was built for, from its bundled spec's "Spec snapshot: vX" marker. */
export const SKILL_VERSION = (() => {
  try { return (readFileSync(new URL('../references/DIAGRAM_JSON_SPEC.md', import.meta.url), 'utf8').match(/Spec snapshot: v([\d.]+)/) || [])[1] || null; }
  catch { return null; }
})();

/** [major, minor, patch] from a version or cache key ("1.25.4", "1.25.4.3"), else null. */
export function parseVersion(s) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(s ?? ''));
  return m ? m.slice(1, 4).map(Number) : null;
}

/** True when release `a` is newer than release `b` (a dev cache key's fourth part is ignored). */
export function isNewer(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** The release in a sw.js text, from its `const CACHE_VERSION = '…'` line, else null. */
export function liveVersionFrom(swText) {
  return (/CACHE_VERSION\s*=\s*['"]([\d.]+)['"]/.exec(String(swText ?? '')) || [])[1] || null;
}

export function updateMessage(current, latest) {
  return `ℹ A newer Diagramforce skill is available: this one is ${current}, the latest is ${latest}. `
    + `Download it from ${SITE} (the ? Help menu > Diagram with AI > Download skill), then in the Claude app or on claude.ai open `
    + 'Settings > Skills, remove the old "diagramforce" skill and upload the new file (an upload with the same name fails while the old '
    + 'one is there). Diagrams made with this version still open fine: the update brings newer guidance and checks.';
}

/** { current, latest, newer, message } from the live site, or null when it could not be read. Never throws. */
export async function checkForUpdate({ site = SITE, current = SKILL_VERSION, timeoutMs = TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  if (!parseVersion(current) || typeof fetchImpl !== 'function') return null;
  try {
    // A cache-busting query reaches the origin: the CDN edge serves the previous sw.js for hours after a release.
    const res = await fetchImpl(new URL(`sw.js?cb=${Date.now()}`, site), { signal: AbortSignal.timeout(timeoutMs) });
    if (!res?.ok) return null;
    const latest = liveVersionFrom(await res.text());
    if (!latest) return null;
    const newer = isNewer(latest, current);
    return { current, latest, newer, message: newer ? updateMessage(current, latest) : `✓ This Diagramforce skill (${current}) is current.` };
  } catch {
    return null;
  }
}

// Entry point: compare REAL paths (symlinked or "Application Support" installs, as in render-diagram.mjs).
const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  const found = await checkForUpdate();
  console.log(found ? found.message : '· Could not check for a newer Diagramforce skill (no network here) - carry on.');
}

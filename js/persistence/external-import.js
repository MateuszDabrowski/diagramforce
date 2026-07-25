// External-site import bridge — lets a THIRD-PARTY web app hand a diagram to Diagramforce and have
// it open in a NEW TAB, with the payload passed via window.postMessage (never the URL, so there is
// no share-URL size ceiling — a data-mapping diagram that blows past the ~8000-char URL limit still
// works). The public contract + a copy-paste opener snippet live in DIAGRAM_JSON_SPEC.md ("Open a
// diagram from another site"). Behaviour: functions/save-share.md. Threat model: limits/gotchas-security.md.
//
// Flow (all client-side, no backend):
//   1. The other site runs `window.open('https://diagramforce…/#import=postmessage')` — WITHOUT
//      `noopener`, because it needs the returned window handle — and listens for our ready ping.
//   2. On boot Phase 9, if the trigger hash is present, startExternalImport() registers a message
//      listener and posts { source:'diagramforce', type:'ready' } back to window.opener.
//   3. The site replies { source:'diagramforce', type:'import', json:'<Diagramforce JSON string>' }.
//   4. We hand the STRING to loadJSONText — the same appVersion-check + sanitizeGraphJSON + open-as-tab
//      path used by file/paste import — so nothing here trusts the payload more than a pasted file.
//
// Security posture is COMMUNITY-OPEN (no origin allowlist) — deliberately, because:
//   - Only the window that opened THIS tab can postMessage to it, so "any origin" really means "any
//     site the user actually clicked a button on", not "anyone on the internet".
//   - Content risk is bounded by sanitizeGraphJSON (2000-cell cap, prototype-pollution / on* / script
//     -URI stripping) — the SAME control that already gates the origin-agnostic, unsigned #diagram=
//     share-URL import. So this adds no new content surface.
//   - We never post user data back (the ready ping is contentless) and reject oversized payloads.

// Boot trigger. Kept in sync with hasPendingUrlLoad() in share-orchestration.js, which suppresses the
// New-Diagram modal while we wait. Deliberately distinct from a possible future `#import=df1.<payload>`
// hash variant (a payload IN the URL) — that would carry `df<n>.`, this exact token does not.
const TRIGGER = /[#&]import=postmessage\b/;
const READY = { source: 'diagramforce', type: 'ready', v: 1 };
const MAX_JSON_BYTES = 8 * 1024 * 1024;   // mirror the share-decode decompression-bomb guard
const DEFAULT_TIMEOUT_MS = 12000;

/** True when the app was opened by another site in live-import (postMessage) mode. PURE — mirrored by
 *  hasPendingUrlLoad() so the New-Diagram overlay stays down while we wait for the payload. */
export function isExternalImportBoot() {
  try { return TRIGGER.test(window.location.hash || ''); } catch { return false; }
}

/** Boot Phase 9 hook (app.js), run ONLY when isExternalImportBoot() is true. Registers the message
 *  listener, announces readiness to the opener, and falls back to onTimeout() if no diagram arrives.
 *  @param {(jsonText:string)=>any} onImportJSON  loadJSONText — appVersion-check + sanitize + open tab
 *  @param {()=>void} [onTimeout]  reveal the normal new-diagram flow when nothing is ever pushed
 *  @param {number} [timeoutMs] */
export function startExternalImport({ onImportJSON, onTimeout, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  // Drop the trigger from the URL so a refresh doesn't re-enter import-wait mode (matches the share /
  // Drive load paths, which replaceState their hash away). hasPendingUrlLoad already ran in Phase 7.
  try { history.replaceState(null, '', window.location.pathname); } catch { /* noop */ }

  let settled = false;
  const timer = setTimeout(() => { if (!settled) { settled = true; onTimeout?.(); } }, timeoutMs);

  window.addEventListener('message', (ev) => {
    const d = ev.data;
    // Strict discriminator: Google's auth library, browser extensions, and other frames all
    // postMessage into pages — react ONLY to our exact envelope. No origin check by design
    // (community-open — see file header); the payload is sanitised downstream regardless.
    if (!d || d.source !== 'diagramforce' || d.type !== 'import' || typeof d.json !== 'string') return;
    if (d.json.length > MAX_JSON_BYTES) return;   // oversized → ignore (loadJSONText also caps cells)
    clearTimeout(timer);
    settled = true;                 // cancels the fallback; the listener stays live so a follow-up push
    onImportJSON(d.json);           // opens another tab (each import routes through loadJSONText).
  });

  // Announce readiness AFTER the listener is live, so the opener (which waits for this) never races us.
  // targetOrigin '*' is safe: the ping carries no data and we don't know the opener's origin.
  try { window.opener?.postMessage(READY, '*'); } catch { /* cross-origin opener quirk → rely on timeout */ }
}

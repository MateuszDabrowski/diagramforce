// External-site import bridge — lets a THIRD-PARTY web app hand a diagram to Diagramforce and have
// it open in a NEW TAB, with the payload passed via window.postMessage (never the URL, so there is
// no share-URL size ceiling — a data-mapping diagram that blows past the ~8000-char URL limit still
// works). The public contract + a copy-paste opener snippet live in DIAGRAM_JSON_SPEC.md ("Open a
// diagram from another site"). Behaviour: functions/save-share.md. Threat model: limits/security.md.
//
// Flow (all client-side, no backend):
//   1. The other site runs `window.open('https://diagramforce…/#import=postmessage')` — WITHOUT
//      `noopener`, because it needs the returned window handle — and listens for our ready ping.
//   2. On boot Phase 9, if the trigger hash is present, startExternalImport() registers a message
//      listener and posts { source:'diagramforce', type:'ready' } back to window.opener.
//   3. The site replies { source:'diagramforce', type:'import', json:'<Diagramforce JSON string>' }.
//   4. We hand the STRING to loadJSONText — the same appVersion-check + sanitizeGraphJSON + open-as-tab
//      path used by file/paste import — so nothing here trusts the payload more than a pasted file.
//   5. RENDER variant (headless pipelines, the skill's render-diagram.mjs): the site sends
//      { source:'diagramforce', type:'render', v:1, id, json, format:'png'|'svg'|'webp', transparent } instead.
//      We import it exactly like step 4, render THAT tab with the Save-menu export pipeline, and reply to the
//      requester only: { type:'rendered', v:1, id, format, mime, dataUrl, width, height } or
//      { type:'render-error', v:1, id, error }.
//
// Security posture is COMMUNITY-OPEN (no origin allowlist) — deliberately, because:
//   - Only the window that opened THIS tab can postMessage to it, so "any origin" really means "any
//     site the user actually clicked a button on", not "anyone on the internet".
//   - Content risk is bounded by sanitizeGraphJSON (2000-cell cap, prototype-pollution / on* / script
//     -URI stripping) — the SAME control that already gates the origin-agnostic, unsigned #diagram=
//     share-URL import. So this adds no new content surface.
//   - We never post USER data back. The ready ping is contentless; a render reply carries only an image of the
//     diagram the requester itself just sent, addressed to the requester's own origin (ev.origin, never '*'),
//     and only if the tab the import opened is still the one on screen when the image is taken (onRender's
//     guard) - so a tab switch mid-render can never hand over another diagram. Oversized payloads are refused.

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
 *  @param {(jsonText:string, opts:{format:string, transparent:boolean})=>Promise<object>} [onRender]  import, then
 *         render the tab it opened; resolves {format, mime, dataUrl, width, height}, rejects with a readable error
 *  @param {()=>void} [onTimeout]  reveal the normal new-diagram flow when nothing is ever pushed
 *  @param {number} [timeoutMs] */
export function startExternalImport({ onImportJSON, onRender, onTimeout, timeoutMs = DEFAULT_TIMEOUT_MS }) {
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
    if (!d || d.source !== 'diagramforce' || (d.type !== 'import' && d.type !== 'render') || typeof d.json !== 'string') return;
    // Only the window that OPENED this tab - what the header above says, now enforced. Any other frame or window that
    // holds a handle to this tab (a frame the app itself embeds, a later-opened popup) is ignored.
    if (!window.opener || ev.source !== window.opener) return;
    if (d.json.length > MAX_JSON_BYTES) return;   // oversized → ignore (loadJSONText also caps cells)
    clearTimeout(timer);
    settled = true;                 // cancels the fallback; the listener stays live so a follow-up push
    if (d.type === 'import') { onImportJSON(d.json); return; }   // opens another tab (each routes through loadJSONText)
    handleRender(ev, d, onRender);
  });

  // Announce readiness AFTER the listener is live, so the opener (which waits for this) never races us.
  // targetOrigin '*' is safe: the ping carries no data and we don't know the opener's origin.
  try { window.opener?.postMessage(READY, '*'); } catch { /* cross-origin opener quirk → rely on timeout */ }
}

// The render reply goes to the REQUESTER'S origin only. An opaque-origin requester (a file:// page, a sandboxed frame)
// has no origin we could address, and '*' would hand the image to whatever document that window holds by the time
// we answer - so it gets a contentless error instead.
const RENDER_TIMEOUT_MS = 30000;
function handleRender(ev, d, onRender) {
  const id = typeof d.id === 'string' || typeof d.id === 'number' ? d.id : null;
  const send = (msg, origin) => { try { ev.source.postMessage({ source: 'diagramforce', v: 1, id, ...msg }, origin); } catch { /* opener gone */ } };
  if (!ev.origin || ev.origin === 'null') { send({ type: 'render-error', error: 'render needs an http(s) page as the opener' }, '*'); return; }
  if (typeof onRender !== 'function') { send({ type: 'render-error', error: 'render is not available' }, ev.origin); return; }
  const opts = { format: ['png', 'svg', 'webp'].includes(d.format) ? d.format : 'png', transparent: d.transparent === true };
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('render timed out (a dialog may be waiting in the Diagramforce tab)')), RENDER_TIMEOUT_MS); });
  Promise.race([Promise.resolve().then(() => onRender(d.json, opts)), timeout])
    .then((img) => send({ type: 'rendered', ...img }, ev.origin),
      (err) => send({ type: 'render-error', error: String(err?.message || err || 'render failed') }, ev.origin))
    .finally(() => clearTimeout(timer));
}

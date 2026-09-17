/**
 * host-env.js - what the page can know about the app hosting it.
 *
 * Diagramforce runs in browsers, and in Slot (the macOS mail wrapper by the same author), where it is a tab
 * inside a Google account's own web session. Slot announces itself with a frozen `window.slot` object carrying
 * its version - set by Slot on Diagramforce's own hosts only, never through the user agent, which Slot keeps as
 * Safari's for Google's sake. Nothing else is on it: not the account, not an email. What the marker changes here
 * is exactly one thing - a popup blocker. Slot lets a page open a window without a click, so the GIS token popup
 * that a browser blocks outside a gesture completes on its own, and the ~1 h Drive token can be refreshed and
 * the connection restored on boot without the user clicking the red icon. Every rule in this file is gated on
 * the marker so browser behaviour is byte-for-byte unchanged (adversarial-review scope, 2026-09-13).
 *
 * What the marker cannot fix: Google's Picker. It is a third-party iframe, and in an app's WKWebView that frame is
 * reported as having storage access and sent no cookies - WebKit's defect, reported to Apple 2026-09-21 - so the two
 * Picker doors (Load's whole-Drive search, Add to Shared Drive) decline in Slot with a sentence; see
 * `pickerUnavailableInSlot` in remote-store.js.
 *
 * Pure: no DOM, no timers - the tested half. remote-store.js owns the side effects.
 */

/** True inside Slot: a `window.slot` object with a string `version`. Anything else - absent, a bare truthy,
 *  a number - is not Slot. Reads through a try so a hostile `window` getter cannot throw out of boot. */
export function isInSlot(win = (typeof window !== 'undefined' ? window : undefined)) {
  try {
    const s = win && win.slot;
    return !!s && typeof s === 'object' && typeof s.version === 'string' && s.version.length > 0;
  } catch { return false; }
}

/** When to refresh a token silently: 60 s before it expires, never sooner than 5 s from now (a token handed back
 *  already-expired must not spin), and at once (0) when it has already lapsed. Milliseconds. */
export function silentRefreshDelay(expiryMs, nowMs = Date.now()) {
  if (!Number.isFinite(expiryMs) || !Number.isFinite(nowMs)) return 0;
  const untilExpiry = expiryMs - nowMs;
  if (untilExpiry <= 0) return 0;
  return Math.max(5000, untilExpiry - 60000);
}

/** Whether boot should reconnect Drive without a click. All three, or nothing: inside Slot, Drive configured for
 *  this origin, and the user connected here before (the auto-sync key is SET - '1' or '0' - which an explicit
 *  Disconnect clears, so "disconnect" stays disconnected across reloads). */
export function shouldAutoConnect({ inSlot, configured, autosyncKey }) {
  return inSlot === true && configured === true && autosyncKey != null;
}

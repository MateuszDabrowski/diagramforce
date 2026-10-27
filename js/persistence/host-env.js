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
 * `pickerUnavailableInSlot` in remote-store.js. On macOS 27.2 the frame carries the session (Slot's test,
 * 2026-10-26), so Slot may say the Picker works with `window.slot.picker === true`; see `pickerBlockedInSlot`.
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

// Localhost testing only: remote-store sets it from `"slotPicker": true` in the gitignored dev/dev-config.json, which
// never ships, so a dev build can try the Picker inside Slot before Slot sends the flag.
let _devPickerInSlot = false;
export function allowPickerInSlotForDev(on) { _devPickerInSlot = on === true; }

/** True when the Picker doors should decline: inside Slot, unless Slot says the Picker can sign in there with
 *  `window.slot.picker === true` (macOS 27.2 and later; on 27.0 the Picker frame got no cookies, FB24880571). Only a
 *  real `true` counts, as with the marker's version. A browser is never blocked. */
export function pickerBlockedInSlot(win = (typeof window !== 'undefined' ? window : undefined)) {
  if (!isInSlot(win) || _devPickerInSlot) return false;
  try { return win.slot.picker !== true; } catch { return true; }
}

/** What the Picker doors say inside Slot, instead of opening Google's dead end (Slot's review, 2026-10-15). One home,
 *  so every door uses the same words. Drive's own Open with grants the app the file under drive.file, and Slot drops
 *  the launch into its running tab as #gd=, so that is the route that works for a file the app was never given. */
export const SLOT_PICKER_NOTE = "Needs a browser: Google's file picker can't sign in inside Slot.";
export const SLOT_OPEN_IN_BROWSER = 'Right-click the Diagramforce tab and choose Open in Browser to use it there.';
export const SLOT_OPEN_WITH_ROUTE = "In this account's Drive tab, open Shared with me, right-click the file and choose "
  + 'Open with > Diagramforce. It opens in this tab.';

/** When to refresh a token silently: 60 s before it expires, never sooner than 5 s from now (a token handed back
 *  already-expired must not spin), and at once (0) when it has already lapsed. Milliseconds. */
export function silentRefreshDelay(expiryMs, nowMs = Date.now()) {
  if (!Number.isFinite(expiryMs) || !Number.isFinite(nowMs)) return 0;
  const untilExpiry = expiryMs - nowMs;
  if (untilExpiry <= 0) return 0;
  return Math.max(5000, untilExpiry - 60000);
}

/** The account to name in Google's token request (GIS `login_hint`). A Drive "Open with" launch names its account and
 *  wins everywhere. Inside Slot, the account this tab connected with before (`df.gdrive.account`, raw JSON): Slot's
 *  log of 2026-10-27 showed a personal account where Google would not pick the account by itself - the boot
 *  reconnect's `prompt: 'none'` window closed with no answer and the Drive icon got the chooser - while a Workspace
 *  account signed straight in. A browser gets no stored-account hint, so its account choice is unchanged. */
export function tokenLoginHint({ inSlot, openWithHint, storedAccount }) {
  if (openWithHint) return openWithHint;
  if (inSlot !== true) return null;
  try {
    const email = JSON.parse(storedAccount || 'null')?.email;
    return typeof email === 'string' && email.includes('@') ? email.trim() : null;
  } catch { return null; }
}

/** Whether boot should reconnect Drive without a click. All three, or nothing: inside Slot, Drive configured for
 *  this origin, and the user connected here before (the auto-sync key is SET - '1' or '0' - which an explicit
 *  Disconnect clears, so "disconnect" stays disconnected across reloads). */
export function shouldAutoConnect({ inSlot, configured, autosyncKey }) {
  return inSlot === true && configured === true && autosyncKey != null;
}

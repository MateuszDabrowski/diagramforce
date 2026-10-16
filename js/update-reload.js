// Update reload - WHEN the page reloads after a new service worker takes over (production only; app.js wires it).
//
// The reload itself is still needed: a page left on the old build keeps its old modules while the new SW serves the
// new ones (limits/gotchas-storage-tabs.md 3.5). It used to fire the moment `controllerchange` arrived, which on a
// returning user's first boot after a deploy is a few seconds in - exactly while a link is being opened. The link's
// hash or query is already stripped by then, so the reload lost a private Drive file's sign-in prompt, an
// Open-with launch and an unapplied Table-view edit with no trace (review 2026-10-15, B2). Now it waits until none
// of those is in progress. Then it reloads by itself only when that loses nothing; otherwise a toast offers the reload
// and the user chooses (owner decision 2026-10-15). A leaf: no imports, so remote-store and share-orchestration can
// hold it.

let _holds = 0;

/** Keep a pending update reload from firing until `work` settles (a URL open: a Drive file, a group, Open with).
 *  Returns `work` unchanged, so a caller can wrap a call in place. */
export function holdUpdateReload(work) {
  _holds++;
  Promise.resolve(work).catch(() => {}).finally(() => { _holds--; });
  return work;
}

export function isUpdateReloadHeld() { return _holds > 0; }

/** Why an update reload must wait right now, or null when it may run. Pure. */
export function updateReloadBlocker({ urlOpen = false, tableEditing = false, modalOpen = false } = {}) {
  if (urlOpen) return 'url-open';
  if (tableEditing) return 'table-edit';
  if (modalOpen) return 'modal';
  return null;
}

/** What a reload would lose right now, or null when it loses nothing. Pure. `history`: an undo or redo step on any
 *  tab (a reload starts every tab with empty stacks). `unsavedEdits`: an edited tab the browser session could not
 *  save (the beforeunload guard's question). `typing`: focus in a text field, whose text may not be applied yet. */
export function updateReloadLoss({ history = false, unsavedEdits = false, typing = false } = {}) {
  if (history) return 'history';
  if (unsavedEdits) return 'unsaved';
  if (typing) return 'typing';
  return null;
}

/** What a page RELEASE would lose right now. Slot asks this before it releases the tab by its own rules (the hourly
 *  rule, the two-tab limit, Free Memory) and keeps a tab that answers yes (owner decision with Slot, 2026-10-15).
 *  Only work that exists nowhere else counts: unapplied Table-view edits, a label being typed on the canvas, a Drive
 *  write not finished, an edit the browser session could not save. Undo history does NOT count: any edit leaves
 *  some, so counting it would keep an edited tab for the page's life. It goes with the page, as when Safari discards
 *  a tab. Pure; the reasons are for Slot's log. */
export function releaseLoss({ tableEdits = false, labelTyping = false, drivePush = false, unsavedEdits = false } = {}) {
  const reasons = [];
  if (tableEdits) reasons.push('table-edits');
  if (labelTyping) reasons.push('label-typing');
  if (drivePush) reasons.push('drive-push');
  if (unsavedEdits) reasons.push('browser-save-failed');
  return { unsaved: reasons.length > 0, reasons };
}

/** Reload once nothing is in progress: now if idle, else on the next check (every `pollMs`, and on every
 *  visibility change, since a hidden page's timers are throttled). `getState` returns the updateReloadBlocker
 *  input. Once idle, a reload that would lose something (`getLoss`, the updateReloadLoss input) calls `offer`
 *  instead, once. Returns a cancel function. */
export function reloadWhenIdle({ getState, getLoss = () => ({}), reload, offer = reload, doc = document, pollMs = 1000, timers = globalThis }) {
  let done = false;
  let timer = null;
  const stop = () => {
    done = true;
    if (timer != null) timers.clearInterval(timer);
    doc.removeEventListener('visibilitychange', attempt);
  };
  function attempt() {
    if (done || updateReloadBlocker(getState())) return;
    stop();
    if (updateReloadLoss(getLoss())) offer();
    else reload();
  }
  attempt();
  if (!done) {
    timer = timers.setInterval(attempt, pollMs);
    doc.addEventListener('visibilitychange', attempt);
  }
  return stop;
}

// What app.js does when a new version has taken over. It is wired on every host, while only production's service
// worker calls updateReady (controllerchange): the SW is off on dev hosts and blocked in Playwright, so e2e calls it.
let _onUpdateReady = null;
export function setUpdateReadyHandler(fn) { _onUpdateReady = typeof fn === 'function' ? fn : null; }
export function updateReady() { _onUpdateReady?.(); }

// One active window (LOCKED 2026-09-23, backlog/decisions.md). Every window of the app on one origin shares ONE
// session key (sf-diagrams-tabs), and each used to write its whole in-memory tab list there, last writer wins: the
// window you LEFT wrote its stale copy on hide, and tabs made in one window vanished on the other's next save
// (audit 2026-09-23, P0-3).
//
// The rule: the NEWEST window owns the session. At boot a window writes its id to OWNER_KEY; every write of the
// session first checks that key still holds its own id. A window that finds another id there has been superseded -
// it stops writing and covers itself with a notice whose one action reloads it. The reload re-reads the owner's
// latest session and makes THIS window the newest, which supersedes the other one in turn.
//
// The ownership token lives in localStorage, not only on a BroadcastChannel, so the check is synchronous and
// survives what a message can miss: a window frozen in the back/forward cache, a browser without the channel, a
// window that never heard the claim. The `storage` event is only the fast path that raises the notice at once.
//
// Handing the session BACK ("Use this window") asks the owner to flush first: the requester writes a HANDOFF token,
// the owner sees it, writes its pending edits, then yields; the requester reloads a moment later and reads them.
//
// Also the switch the domain-move bridge needs: it writes the migrated session itself and then reloads, and the
// reload's pagehide flush used to write the blank new-origin session straight over it (audit P0-2).

import { buildModal } from '../feedback.js?v=1.24.2';

export const OWNER_KEY = 'df.sessionOwner';
const HANDOFF_PREFIX = 'handoff:';
const HANDOFF_WAIT_MS = 300;   // time the owner gets to flush before the requester reloads and reads

const myId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let halted = false;        // true once superseded (or halted by the bridge): no more session writes from here
let started = false;
let beforeYield = null;    // session-store's forced final flush, run when the owner is asked to hand over
let notice = null;

function readOwner() { try { return localStorage.getItem(OWNER_KEY); } catch { return undefined; } }
function writeOwner(v) { try { localStorage.setItem(OWNER_KEY, v); return true; } catch { return false; } }

/** Stop every session write from this window, with no notice. The domain-move bridge calls it before it writes the
 *  migrated session and reloads, so the reload's flush cannot overwrite what it just wrote. */
export function haltSessionWrites() { halted = true; }

/** session-store registers its forced flush here, so a handoff can save this window's last edits before it yields. */
export function setBeforeYield(fn) { beforeYield = typeof fn === 'function' ? fn : null; }

/** Claim the session for this window. Call once at boot, BEFORE the session is restored, so an older window stops
 *  writing before this one's first save. */
export function claimSession() {
  if (started) return;
  started = true;
  writeOwner(myId);
  try {
    window.addEventListener('storage', (ev) => {
      if (ev.key !== OWNER_KEY || halted) return;
      if (ev.newValue === myId) return;
      if (ev.newValue == null) { writeOwner(myId); return; }   // storage cleared elsewhere - keep owning it
      // Another window asked for the session back: write our pending edits FIRST (it has not read yet), then yield.
      if (ev.newValue.startsWith(HANDOFF_PREFIX) && beforeYield) {
        try { beforeYield(); } catch { /* the yield still has to happen */ }
      }
      yieldSession();
    });
  } catch { /* no window - nothing to coordinate */ }
}

/** True when this window may write the session now. The one guard every session write goes through. */
export function canWriteSession() {
  if (halted) return false;
  if (!started) return true;              // pre-claim (unit contexts, early boot) - nothing to defer to yet
  const owner = readOwner();
  if (owner === undefined) return true;   // localStorage unreadable - no coordination is possible, keep today's path
  if (owner === myId) return true;
  if (owner === null) return writeOwner(myId);   // cleared (reset page, devtools) - re-claim rather than go silent
  yieldSession();
  return false;
}

export function isSessionHalted() { return halted; }

function yieldSession() {
  if (halted) return;
  halted = true;
  showNotice();
}

function showNotice() {
  if (notice || typeof document === 'undefined') return;
  notice = buildModal({
    title: 'Diagramforce is open in another window',
    className: 'df-single-window',
    width: '420px',
    showClose: false,
    backdropClose: false,
    onEscape: () => {},   // nothing to dismiss to: this window no longer saves
    zIndex: 9000,
    bodyHtml: '<p class="df-single-window__text"></p>',
    footerHtml: '<button class="df-modal__btn df-modal__btn--primary df-single-window__take"></button>',
  });
  notice.body.querySelector('.df-single-window__text').textContent =
    'Only one window saves your diagrams at a time, and a newer one is open. This window has stopped saving, so '
    + 'nothing you do here is kept. Your work in the other window is safe.';
  const take = notice.footer.querySelector('.df-single-window__take');
  take.textContent = 'Use this window';
  take.addEventListener('click', () => {
    take.disabled = true;
    // Ask the current owner to flush and yield, then reload so this window boots as the newest and reads it all.
    writeOwner(HANDOFF_PREFIX + myId);
    setTimeout(() => { try { location.reload(); } catch { /* ignore */ } }, HANDOFF_WAIT_MS);
  });
  setTimeout(() => { try { take.focus(); } catch { /* ignore */ } }, 0);
}

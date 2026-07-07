// Cloud-sync control (CLEANUP S4) — the Drive sync icon + state-aware dropdown (sign-in status row / sync-now / history / auto-sync toggle / disconnect / about). Connecting is the status-row "Sign in" button (signIn), NOT a menu item. Reads tctx.modules; imports btn+setupDropdown (context) + showDriveHistoryModal (drive-history) - one-way slice edges. init calls setupSyncControl.
import { buildModal, confirmModal, showToast } from '../feedback.js?v=1.19.2.99';
import { formatRelativeTime } from '../util.js?v=1.19.2.99';
import { btn, setupDropdown, tctx } from './context.js?v=1.19.2.99';
import { showDriveHistoryModal } from './drive-history.js?v=1.19.2.99';

// One icon (left of Share Link) + a state-aware dropdown menu. The Drive icon is
// colour + glyph coded by sync state via the SLDS sync family; the time text shows
// only when auto-sync is on. Self-gates: stays hidden unless Drive is configured.
// Short state explainer for the sync menu's first row (shown in every state). In the error
// state the row also becomes the reconnect button (see setupSyncControl).
function syncStatusText(st, connected = false) {
  const rel = st.lastSavedAt ? formatRelativeTime(st.lastSavedAt) : null;
  switch (st.state) {
    case 'saving':   return 'Saving to Google Drive…';
    case 'error':    return 'Signed out of Google Drive - sign in to reconnect.';
    case 'conflict': return 'This diagram changed on Google Drive.';
    case 'refresh':  return 'The original shared file has new changes.';
    case 'pending':  return 'Unsaved changes - they will sync to Google Drive.';
    case 'synced':   return rel ? `Synced to Google Drive · last saved ${rel}.` : 'Auto-sync is on - this diagram syncs to Google Drive once it has content.';
    // state 'off' splits on account-level connection: when connected it's just THIS diagram that isn't synced
    // yet (don't claim "not connected" while the menu offers Disconnect); otherwise the account truly isn't connected.
    default:         return connected ? "This diagram isn't synced to Google Drive yet." : 'Not connected to Google Drive yet.';
  }
}
export function setupSyncControl() {
  const p = tctx.modules.persistence;
  if (!p.isDriveConfigured?.()) return;          // feature off for this origin
  const wrap = btn('sync-dropdown');
  const btnEl = btn('btn-sync');
  if (!wrap || !btnEl) return;
  wrap.removeAttribute('hidden');
  setupDropdown('btn-sync');

  const driveSvg  = btnEl.querySelector('.df-sync__drive');
  const textEl    = btnEl.querySelector('.df-sync__text');
  const menu      = wrap.querySelector('.df-sync__menu');
  const statusText = menu.querySelector('[data-sync-status-text]');
  const statusBtn = menu.querySelector('[data-sync-status-btn]');
  const closeMenu = () => wrap.classList.remove('df-toolbar__dropdown--open');

  // Saving spin: START it when saving begins, but never STOP it mid-rotation. The spin keeps
  // looping until a cycle boundary (`animationiteration`, fired at 360°≡0° = the upright rest
  // pose) at which point we re-check the live state and drop the class if saving has finished —
  // so the icon always completes its rotation and settles cleanly instead of snapping back.
  driveSvg?.addEventListener('animationiteration', () => {
    if (p.getDriveStatus?.().state !== 'saving') driveSvg.classList.remove('df-sync__drive--spin');
  });

  const render = () => {
    const st = p.getDriveStatus?.() || { state: 'off', showText: false, lastSavedAt: 0 };
    btnEl.dataset.state = st.state;
    if (st.state === 'saving') driveSvg?.classList.add('df-sync__drive--spin');   // stop is deferred to the cycle boundary above
    const isError = st.state === 'error';
    const isConflict = st.state === 'conflict';
    const isRefresh = st.state === 'refresh';   // the original shared file changed — pull available (item 6)
    const isAction = isError || isConflict || isRefresh;   // all put an actionable label + status-row affordance up
    // ONE icon, ONE href for every state — no swapping. CSS recolours the SAME detailed Drive logo per
    // [data-state]: greyed (off) / full colour (synced) / spinning (saving) / red-tinted (error) /
    // amber-tinted (conflict). Text appears for an action (red "Sign in" / amber "Review") and as a neutral
    // "Saving" label to the left of the icon while a save is in flight (alongside the spin animation).
    if (textEl) {
      if (isError) { textEl.textContent = 'Sign in'; textEl.style.display = ''; }
      else if (isConflict) { textEl.textContent = 'Review'; textEl.style.display = ''; }
      else if (isRefresh) { textEl.textContent = 'Refresh'; textEl.style.display = ''; }
      else if (st.state === 'saving') { textEl.textContent = 'Saving'; textEl.style.display = ''; }
      else textEl.style.display = 'none';
    }
    // Title hints the left-click (menu) + right-click (primary action) split.
    btnEl.title = isError ? 'Google Drive sign-in needed - left-click for menu, right-click to reconnect'
      : isConflict ? 'This diagram changed on Google Drive - left-click for menu, right-click to review'
      : isRefresh ? 'The original shared file has new changes - left-click for menu, right-click to refresh'
      : st.state === 'off' ? 'Google Drive - left-click for menu, right-click to sync this diagram'
      : st.state === 'saving' ? 'Saving to Google Drive…'
      : 'Google Drive sync - left-click for menu, right-click to sync now';

    // "Connected" = account-level (signed in, OR auto-sync on, OR any tab linked to a Drive file). It drives
    // BOTH the menu shape AND the status copy, so they can never contradict (no "Not connected" header while
    // the menu offers Disconnect). The per-active-tab sync state lives in syncStatusText's other branches.
    const connected = !!p.isDriveConnected?.();
    const auto = p.isAutosyncOn?.();
    // Menu first row: the state explainer (left) + the KEY contextual action as a wire button (right) - so the first
    // element under the icon is always the action that matters. Sign in (signed off) / Review (conflict) / Refresh
    // (upstream changed) / Sync now (connected + manual). No button when connected + auto-sync on + idle (nothing to do).
    if (statusText) statusText.textContent = syncStatusText(st, connected);
    if (statusBtn) {
      let label = '', tone = '';
      if (isError || !connected) { label = 'Sign in'; tone = 'error'; }
      else if (isConflict) { label = 'Review'; tone = 'conflict'; }
      else if (isRefresh) { label = 'Refresh'; tone = 'refresh'; }
      else if (!auto) { label = 'Sync now'; tone = 'sync'; }
      statusBtn.textContent = label;
      statusBtn.dataset.tone = tone;
      statusBtn.hidden = !label;
    }

    // Menu shape: not-connected shows only "Connect"; connected shows the Drive-unique set. Save & Export /
    // Load & Import are NOT here — they live on the always-present navbar, so the menu never duplicates them.
    const set = (sel, hide) => { const el = menu.querySelector(sel); if (el) el.hidden = hide; };
    // "Version history" — shown only when connected AND the active tab is linked to a Drive file (its revisions).
    const showHistory = connected && !!p.activeHasDriveFile?.();
    // "Refresh imported diagram" — shown ONLY when the active diagram was opened from a Drive link
    // (re-fetches the sender's latest). Independent of connected: a public link refreshes anonymously.
    const showReload = !!p.activeIsImported?.();
    // A FORK (own master + a refresh-only sharedSource) opens the original in a NEW tab, leaving your copy intact →
    // "Open the original shared diagram". An UN-forked view (sharedSource, no own master) re-pulls the original INTO
    // the current tab → "Refresh from the original". (reopenLatestFromDrive picks the same branch via hasOwnFork.)
    const reloadLabel = menu.querySelector('[data-sync-reload-label]');
    if (reloadLabel && showReload) reloadLabel.textContent = p.activeHasDriveFile?.() ? 'Open the original shared diagram' : 'Refresh from the original';
    set('[data-sync="history"]', !showHistory);
    set('[data-sync="reload"]', !showReload);
    set('[data-sync="autosync"]', !connected);
    set('[data-sync="disconnect"]', !connected);   // "Disconnect Google Drive" — only when connected (incl. red/error)
    // The rule above auto-sync earns its place only when there's a visible item on BOTH sides: a history/reload
    // item above AND a connected-only item (auto-sync/disconnect) below. Without the `connected` guard, a
    // not-connected recipient of a shared link (showReload true, everything below hidden) would leave this rule
    // adjacent to the always-on rule before About — a doubled divider.
    set('[data-sync-sep]', !(connected && (showHistory || showReload)));
    // The divider before Disconnect/About only earns its place when connected (its connected-only items show);
    // when signed out it would just stack under the status-row divider (a doubled line above "Why Google Drive?").
    set('[data-sync-sep2]', !connected);
    const autoItem = menu.querySelector('[data-sync="autosync"]');
    autoItem?.classList.toggle('is-checked', !!auto);   // Display-menu checkbox style
    // Not-connected users see an invitation ("Why Google Drive?"); once connected it's the reference doc.
    const aboutLabel = menu.querySelector('[data-sync-about-label]');
    if (aboutLabel) aboutLabel.textContent = connected ? 'About Google Drive Sync' : 'Why Google Drive?';
    autoItem?.setAttribute('aria-checked', auto ? 'true' : 'false');
    // The cadence note explains BOTH states (shown whenever connected): auto-sync ON = 2-min timer + boundary saves;
    // auto-sync OFF = boundary saves only (open/switch/close still persist, there's just no timer). The user asked
    // for the unchecked state to be described, not left blank.
    set('.df-sync__cadence', !connected);
    const cadenceNote = menu.querySelector('.df-sync__cadence-note');
    if (cadenceNote) cadenceNote.textContent = auto
      ? 'Saves every 2 minutes, and the moment you open, switch, or close a tab.'
      : 'Auto-save is off, but your work still saves the moment you open, switch, or close a tab.';
  };

  // Menu actions. Action items close the menu; the toggle + cadence keep it open.
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-sync]');
    if (!item) return;
    const action = item.dataset.sync;
    if (action === 'history') { closeMenu(); showDriveHistoryModal(); }
    else if (action === 'reload') { closeMenu(); p.reopenLatestFromDrive?.(); }
    else if (action === 'disconnect') {
      closeMenu();
      confirmModal({
        title: 'Disconnect Google Drive?',
        message: 'Diagramforce stops syncing and forgets the Drive links here, returning to the not-connected state. Your diagrams stay in your Google Drive - reconnect any time to pick them back up.',
        okLabel: 'Disconnect', cancelLabel: 'Cancel', tone: 'danger',
      }).then((ok) => { if (ok) { p.disconnectDrive?.(); showToast('Disconnected from Google Drive.', 'info'); } });
    }
    else if (action === 'about')  { closeMenu(); showSyncAbout(); }
    else if (action === 'autosync') {
      e.stopPropagation();
      if (p.isAutosyncOn?.()) p.disableAutosync?.(); else p.enableAutosync?.();
      render();
    }
  });

  // The KEY action wire button in the status row (Sign in / Review / Refresh / Sync now). It dispatches by the LIVE
  // state, so it's always the right action for what the button currently reads; it's only ever visible when there IS
  // an action (render hides it otherwise), so no no-op branch is needed.
  statusBtn?.addEventListener('click', () => {
    closeMenu();
    const st = p.getDriveStatus?.() || { state: 'off' };
    if (st.state === 'conflict') p.resolveActiveConflict?.();
    else if (st.state === 'refresh') p.reopenLatestFromDrive?.();
    else if (st.state === 'error' || !p.isDriveConnected?.()) p.signIn?.();
    else p.syncNow?.();   // connected + manual
  });

  // Right-click the icon = fire the primary action for the current state, skipping the menu.
  // error → reconnect (sign in); saving → no-op; everything else (off/synced/pending) → sync the
  // active diagram now (saveToDrive signs in first if needed). Suppress the browser context menu.
  btnEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    closeMenu();
    const state = btnEl.dataset.state;
    if (state === 'error') p.signIn?.();
    else if (state === 'conflict') p.resolveActiveConflict?.();
    else if (state === 'refresh') p.reopenLatestFromDrive?.();   // pull the original's latest (item 6)
    else if (state === 'saving') { /* already saving — nothing to do */ }
    else p.saveToDrive?.();
  });

  p.setDriveStatusListener?.(render);
  tctx.modules.tabs?.onChange?.(render);
  setInterval(render, 30000);   // keep "saved X ago" fresh + re-evaluate token expiry
  render();
}

function showSyncAbout() {
  const head = 'margin:14px 0 5px;color:var(--text-primary);font-size:var(--font-size-sm);font-weight:600;letter-spacing:.01em';
  const list = 'margin:0;padding-left:18px;display:flex;flex-direction:column;gap:5px';
  const { footer, close } = buildModal({
    title: 'About Google Drive sync',
    className: 'df-sync-about-modal',
    width: '500px',
    bodyStyle: 'padding:18px 22px',
    bodyHtml: `<div style="color:var(--text-secondary);line-height:1.5;font-size:var(--font-size-sm)">
      <div style="text-align:center;margin:0 0 6px"><svg width="44" height="44" aria-hidden="true"><use href="#icon-gdrive"></use></svg></div>

      <h4 style="${head};margin-top:0">Purpose</h4>
      <p style="margin:0">Back up and share your diagrams using <strong>your own</strong> Google Drive - no Diagramforce account, no server, nothing extra to manage. Each diagram becomes a regular file in a <strong>Diagramforce</strong> folder you own, so you stay in control and can stop sharing or delete it whenever you like. Diagramforce is a verified <a href="https://workspace.google.com/marketplace/app/diagramforce/873718407054" target="_blank" rel="noopener" class="df-about__link">Google Workspace Marketplace app</a>.</p>

      <h4 style="${head}">Features</h4>
      <ul style="${list}">
        <li><strong>Auto-sync</strong> every open diagram - every couple of minutes while you work, and the moment you open, switch, or close a tab.</li>
        <li><strong>Save</strong> and <strong>Open</strong> individual diagrams on demand from this menu.</li>
        <li><strong>Share</strong> a short, always-up-to-date link from the toolbar's <strong>Share Diagram</strong> button - keep it public, limit it to your organisation, or invite specific people.</li>
        <li><strong>Refresh</strong> a diagram you opened from a shared link to pull the sender's latest version.</li>
      </ul>

      <h4 style="${head}">Security &amp; privacy</h4>
      <ul style="${list}">
        <li>Your diagrams live <strong>only in your Drive</strong> - Diagramforce has no servers and never sees them.</li>
        <li>The app can touch <strong>only the files it creates or you explicitly open</strong>, never the rest of your Drive.</li>
        <li><strong>Organisation</strong> sharing asks once, separately, for your email address - only to read your Workspace domain so the link can be limited to your org. It is never requested for anything else.</li>
        <li>Sign-in lasts an hour. When it expires the Drive icon turns <strong>red</strong> - reconnect from the menu's highlighted row. Your work stays saved in your browser until you do.</li>
      </ul>

      <p style="margin:14px 0 0;font-size:var(--font-size-xs)">Full details in the <a href="privacy.html" target="_blank" rel="noopener" class="df-about__link">Privacy Policy</a> and <a href="terms.html" target="_blank" rel="noopener" class="df-about__link">Terms of Use</a>.</p>
    </div>`,
    footerHtml: '<button class="df-modal__btn df-modal__btn--primary" data-action="ok">Got it</button>',
  });
  if (footer) footer.style.justifyContent = 'flex-end';
  document.querySelector('.df-sync-about-modal [data-action="ok"]')?.addEventListener('click', close);
}

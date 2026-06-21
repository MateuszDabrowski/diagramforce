// Share orchestration — build/parse the #diagram=... share-URL hash via the
// versioned share codec, and the Share / share-error modals. Extracted from
// persistence.js (Phase 3, Slice 1). The live graph, the tab-name/type getters,
// the import handler, and the sanitize/normalize/version-check helpers come from
// the persistence runtime context, wired in persistence.init(). Legacy decode
// uses the global `pako`.

import { decodeShareV1, encodeShareV2, decodeShareV2, encodeGroupLink, decodeGroupLink, slimForShare } from '../share-codec.js?v=1.17.0.199';
import { diagramHasImage } from '../image-component.js?v=1.17.0.199';
import { showToast, showError, buildModal, confirmModal } from '../feedback.js?v=1.17.0.199';
import { escHtml, sharePillHtml } from '../util.js?v=1.17.0.199';
import { pctx } from './context.js?v=1.17.0.199';
import { shareGlyphKind } from './drive-sync-logic.js?v=1.17.0.199';
import { isDriveConfigured, isDriveConnected, shareActiveScoped, shareActiveEditable, activeShareCopies, activeShareStatus, listActiveShareGrants, removeGrant, removeShare, resolveCopyConflict, saveTabsToDrive, publishTabsToSharedDrive, signIn, loadDriveRef, openGroupFromLink } from './remote-store.js?v=1.17.0.199';

/** Build the single public group share URL (`#dfg=g1.…`) — carries the member Drive file ids + the group's
 *  display metadata, NOT diagram content (each diagram lives in its own Drive file). */
function buildGroupShareURL({ name, ids, color, icon }) {
  return `${window.location.origin}${window.location.pathname}#dfg=${encodeGroupLink({ name, ids, color, icon })}`;
}

/** Build the inline `#diagram=` share URL for the active diagram. Throws if encoding fails.
 *  Slims load-reconstructable data (default ports/size, mapping-link routing, icon artwork)
 *  before the v2 codec (key-min + dictionary) — lossless after the import path rebuilds it. */
function buildShareURL() {
  const { graph, appVersion: APP_VERSION, tabNameCb, diagramTypeCb, mappingModeCb } = pctx;
  const data = {
    v: 1,
    av: APP_VERSION,
    name: tabNameCb(),
    type: diagramTypeCb(),
    mappingMode: mappingModeCb ? mappingModeCb() : false,
    graph: slimForShare(graph.toJSON()),
  };
  return `${window.location.origin}${window.location.pathname}#diagram=${encodeShareV2(data)}`;
}

export function shareAsURL() {
  const { graph, tabNameCb, diagramTypeCb } = pctx;
  if (!tabNameCb || !diagramTypeCb) return;
  // Belt-and-braces: the dropdown button is already disabled when images are
  // present, but keyboard shortcut / hamburger entry / `share` action route
  // straight into this function and need the same gate.
  if (diagramHasImage(graph)) { showShareModal(null, { reason: 'image' }); return; }
  try {
    showShareModal(buildShareURL());
  } catch (err) {
    console.error('SF Diagrams: Share URL failed:', err);
    showError('Failed to generate share URL - diagram may be too large.');
  }
}

/** Right-click the Share-URL toolbar icon: copy the inline link straight to the clipboard — no
 *  modal. Images can't be URL-shared, so those fall back to the explanatory modal; a blocked
 *  clipboard also falls back to the modal so the link is never lost. */
export function copyShareURL() {
  const { graph, tabNameCb, diagramTypeCb } = pctx;
  if (!tabNameCb || !diagramTypeCb) return;
  if (diagramHasImage(graph)) { showShareModal(null, { reason: 'image' }); return; }
  let url;
  try { url = buildShareURL(); }
  catch (err) {
    console.error('SF Diagrams: Share URL failed:', err);
    showError('Failed to generate share URL - diagram may be too large.');
    return;
  }
  navigator.clipboard.writeText(url).then(
    () => showToast('Share link copied ✓', 'success'),
    () => showShareModal(url),
  );
}

/** Share a whole tab-group via Google Drive: save + publicly share each diagram, then list the short
 *  `#gd=` links (one per diagram) with per-row + copy-all. Drive-only (a classic URL can't carry a
 *  group). Backs the group pill's "Share group". */
export async function shareGroupToDrive(tabIds, label, meta = {}) {
  if (!isDriveConnected()) { showError('Sign in to Google Drive first to share a group.'); return; }
  if (!Array.isArray(tabIds) || !tabIds.length) return;
  document.querySelector('.df-group-share-modal')?.remove();
  const { body, footer, close } = buildModal({
    title: `Share "${label}"`,   // buildModal escapes the title via textContent
    className: 'df-group-share-modal',
    width: '520px',
    bodyStyle: 'padding:16px 20px',
    bodyHtml: `<p class="df-drive-save-modal__hint">Preparing ${tabIds.length} diagram${tabIds.length === 1 ? '' : 's'} for sharing…</p>`,
    footerHtml: '<button class="df-modal__btn df-modal__btn--primary df-group-share__done" style="margin-left:auto">Done</button>',
  });
  footer.querySelector('.df-group-share__done').addEventListener('click', close);

  // Save each diagram to Drive + make it public ("anyone with the link can view"). The single group link
  // below opens them all; the per-diagram links are kept for granular sharing. Collaboration / org access
  // stays out of the single-link model (it's per-file) — point the user to Add to Shared Drive for that.
  let results;
  try { results = await saveTabsToDrive(tabIds, { share: true }); }
  catch (e) { close(); showError('Could not share the group: ' + (e.message || 'unknown error')); return; }

  const ok = results.filter((r) => r.status === 'ok' && r.shareUrl && r.fileId);
  const empty = results.filter((r) => r.status === 'empty').length;
  const failed = results.filter((r) => r.status === 'error');
  if (failed.length) console.error('Diagramforce: group share failures:', failed);

  let groupUrl = '';
  try { if (ok.length) groupUrl = buildGroupShareURL({ name: label, ids: ok.map((r) => r.fileId), color: meta.color || null, icon: meta.icon || null }); }
  catch (e) { console.error('Diagramforce: could not build the group link:', e); }

  const skipNote = (empty || failed.length)
    ? `<p class="df-group-share__skip" style="margin:6px 0 0;color:var(--text-secondary);font-size:var(--font-size-sm)">${empty ? `${empty} empty diagram${empty === 1 ? '' : 's'} skipped.` : ''}${empty && failed.length ? ' ' : ''}${failed.length ? `${failed.length} couldn't be shared (see console).` : ''}</p>`
    : '';

  if (!ok.length) {
    body.innerHTML = `<p class="df-drive-save-modal__hint">No diagrams could be shared.</p>${skipNote}`;
    return;
  }

  // Primary: one public group link that opens every diagram and rebuilds the group on the other side.
  const groupSection = groupUrl
    ? `<div class="df-share__section">
         <div class="df-share__label">Group link</div>
         <p class="df-group-share__lead" style="margin:0 0 8px;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.45">One link opens all ${ok.length} diagram${ok.length === 1 ? '' : 's'} and recreates the group. Anyone with the link can view the latest version - no Google account needed.</p>
         <div class="df-share__row">
           <input class="df-share__field df-group-share__groupfield" type="text" readonly value="${escHtml(groupUrl)}" aria-label="Group share link">
           <button class="df-modal__btn df-modal__btn--primary df-share__copy df-group-share__copygroup" data-link="${escHtml(groupUrl)}">Copy</button>
         </div>
       </div>`
    : '';

  // Secondary: the individual diagram links (collapsed under a small heading) for one-off sharing.
  const rows = ok.map((r) => `
    <div class="df-share__row" style="margin-bottom:6px">
      <span style="flex-shrink:0;font-size:var(--font-size-sm);color:var(--text-secondary);max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(r.name)}">${escHtml(r.name)}</span>
      <input class="df-share__field" type="text" readonly value="${escHtml(r.shareUrl)}" aria-label="Link for ${escHtml(r.name)}">
      <button class="df-modal__btn df-share__copy" data-link="${escHtml(r.shareUrl)}">Copy</button>
    </div>`).join('');
  const individualSection = `
    <details class="df-group-share__individual" style="margin-top:14px">
      <summary style="cursor:pointer;color:var(--text-secondary);font-size:var(--font-size-sm)">Individual diagram links (${ok.length})</summary>
      <div style="margin-top:8px">${rows}</div>
    </details>`;

  // Footnote: collaboration / organisation is per-file, so it lives on the Shared Drive path, not here.
  const collabNote = `
    <p class="df-group-share__collab" style="margin:14px 0 0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.45">
      Need people to <strong>edit</strong> these diagrams or limit them to your <strong>organisation</strong>?
      Use <strong>Save -&gt; select the group's diagrams -&gt; Add to Shared Drive</strong> instead - the group link is view-only.
    </p>`;

  body.innerHTML = groupSection + individualSection + collabNote + skipNote;

  // Copy buttons (group + per-diagram) — flash a check on success.
  const flash = (btn) => { const o = btn.textContent; btn.textContent = '✓ Copied!'; btn.classList.add('is-copied'); setTimeout(() => { btn.textContent = o; btn.classList.remove('is-copied'); }, 1500); };
  body.querySelectorAll('.df-share__copy').forEach((btn) => {
    btn.addEventListener('click', () => navigator.clipboard.writeText(btn.dataset.link).then(() => flash(btn), () => showToast('Could not copy automatically.', 'warning')));
  });

  // Auto-copy the group link (it's the headline action), like the single-diagram Create-link flow.
  if (groupUrl) {
    try { await navigator.clipboard.writeText(groupUrl); showToast('Group link created and copied to clipboard ✓', 'success'); }
    catch { /* clipboard blocked — the Copy button is still right there */ }
  }
}

export async function loadFromURL() {
  const { sanitizeGraphJSON, normalizeDiagramType, checkVersionWarning, onImport: onImportCallback } = pctx;
  // Google Drive "Open with Diagramforce" / "New" — Drive loads the app with a `?state=` QUERY param
  // (URL-encoded JSON {ids,action,...}). `open` opens the file id (via the #gd= read path); `create`/`new`
  // falls through to the normal new-diagram boot. ACTIVATION needs the Cloud Console Drive UI integration
  // + prod creds (see Documentation/Diagramforce-Extended-Share.md §"Open with"); until then this never fires.
  const stateRaw = new URLSearchParams(window.location.search).get('state');
  if (stateRaw) {
    history.replaceState(null, '', window.location.pathname);
    let st = null; try { st = JSON.parse(stateRaw); } catch { /* malformed → ignore, normal boot */ }
    const action = st && (st.action || 'open');
    if (st && action === 'open' && Array.isArray(st.ids) && st.ids.length) {
      // Drive "Multiple file support": open EVERY selected file as its own tab. Sequential so each
      // lands as a separate tab through the import pipeline; one failure doesn't abort the rest.
      // (Each loadDriveRef does anon read → Picker fallback → restricted-open modal — no gesture needed.)
      for (const id of st.ids) { try { await loadDriveRef(id); } catch (e) { console.error('Diagramforce: Open-with failed for', id, e); } }
      return true;
    }
    return false;   // 'create'/'new' (or unrecognised) → normal empty-app / new-diagram boot
    // (Future: a 'create' New-URL could carry a parent folderId to seed the first Drive save — deferred.)
  }
  const hash = window.location.hash;
  // Google Drive GROUP link (#dfg=g1.<base64url>) — opens every member file as a grouped tab and rebuilds
  // the group. Checked before #gd= (a single file): the payload is the group codec, not a bare file id.
  const dfgMatch = hash.match(/[#&]dfg=(g\d+\.[A-Za-z0-9_-]+)/);
  if (dfgMatch) {
    history.replaceState(null, '', window.location.pathname);
    let payload = null;
    try { payload = decodeGroupLink(dfgMatch[1]); }
    catch { showShareLoadError('This Google Drive group link is invalid. Please ask the sender for a new one.'); return false; }
    const opened = await openGroupFromLink(payload);
    if (!opened) showShareLoadError('Could not open this shared group. The diagrams may be private, or the link may be out of date - ask the sender to re-share.');
    return opened;
  }
  // Google Drive reference link (#gd=<fileId>) — short + live. remote-store reads it
  // (zero-sign-in anonymous read, Picker fallback) and funnels through the import pipeline.
  const gdMatch = hash.match(/[#&]gd=([A-Za-z0-9_-]+)/);
  if (gdMatch) {
    history.replaceState(null, '', window.location.pathname);
    return loadDriveRef(gdMatch[1]);
  }
  if (!hash || !hash.includes('diagram=')) return false;

  // Versioned codec match (`v1.<base64url>`) takes precedence; falls through
  // to the legacy raw-deflate path for URLs created before this codec landed.
  const verMatch = hash.match(/diagram=v(\d+)\.([A-Za-z0-9_-]+)/);
  const legacyMatch = !verMatch && hash.match(/diagram=([A-Za-z0-9_-]+)/);
  if (!verMatch && !legacyMatch) {
    showShareLoadError('This share link is invalid. Please check that you copied the whole link, or ask the sender for a new one.');
    history.replaceState(null, '', window.location.pathname);
    return false;
  }

  try {
    let data;
    if (verMatch) {
      const ver = parseInt(verMatch[1], 10);
      // Every shipped decoder stays alive (forward links from a newer build are the
      // only ones we can't read). v2 is current; v1 covers links made before it.
      if (ver === 2) {
        data = decodeShareV2(`v2.${verMatch[2]}`);
      } else if (ver === 1) {
        data = decodeShareV1(`v1.${verMatch[2]}`);
      } else {
        showShareLoadError('This share link was created by a newer version of Diagramforce. Please ask the sender to update their link.');
        history.replaceState(null, '', window.location.pathname);
        return false;
      }
    } else {
      // Legacy: raw deflate, no preset dictionary, no key minification.
      let base64 = legacyMatch[1].replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) base64 += '=';
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const json = pako.inflateRaw(bytes, { to: 'string' });
      // Decompression-bomb guard: a legitimate share is far under this ceiling.
      if (json.length > 8 * 1024 * 1024) throw new Error('Share payload too large');
      data = JSON.parse(json);
    }

    if (!data.graph || !data.type) {
      showShareLoadError('This share link is invalid. Please check that you copied the whole link, or ask the sender for a new one.');
      history.replaceState(null, '', window.location.pathname);
      return false;
    }

    // Sanitize graph data from untrusted URL source
    sanitizeGraphJSON(data.graph);

    // Clear the hash so it doesn't reload on refresh
    history.replaceState(null, '', window.location.pathname);

    const savedVer = data.av || null;
    const ok = await checkVersionWarning(savedVer, data.name || 'Shared Diagram', data);
    if (!ok) return false;

    // Import the diagram using the existing import handler
    if (onImportCallback) {
      const type = normalizeDiagramType(data.type);
      onImportCallback(data.name || 'Shared Diagram', type, data.graph, data.viewport || null, data.mappingMode);
      return true;
    }
    return false;
  } catch (err) {
    console.error('SF Diagrams: Failed to load shared diagram:', err);
    showShareLoadError('This share link is invalid. Please check that you copied the whole link, or ask the sender for a new one.');
    history.replaceState(null, '', window.location.pathname);
    return false;
  }
}

/** Show a non-blocking error toast for share-URL load failures. */
function showShareLoadError(message, title = "Couldn't load shared diagram") {
  document.querySelector('.df-share-error-modal')?.remove();
  const { footer, close } = buildModal({
    title, // buildModal escapes via textContent
    className: 'df-share-error-modal',
    zIndex: 10001,
    width: '440px',
    showClose: false, // dismiss via OK button / backdrop / Escape
    bodyStyle: 'padding:16px 20px',
    bodyHtml: `<p style="margin:0;color:var(--text-secondary);line-height:1.5">${escHtml(message)}</p>`,
    footerHtml: '<button class="df-modal__btn df-modal__btn--primary" data-action="dismiss">OK</button>',
  });
  footer.style.justifyContent = 'flex-end';
  footer.querySelector('[data-action="dismiss"]').addEventListener('click', close);
}

// (i) pros/cons copy for each link type — surfaces the tradeoffs from the link analysis so users
// pick the right one. Plain data; rendered into a toggle-able panel next to each section label.
const SHARE_INFO = {
  classic: {
    how: 'The whole diagram is packed into the link itself.',
    pros: ['Opens with no account, even offline', 'Nothing is stored anywhere but the link', 'A frozen snapshot of this exact version'],
    cons: ['Long - some chats / emails / QR codes truncate it', "Can't include images", "Recipients won't see your later edits"],
  },
  drive: {
    how: "A short link to this diagram's file in your Google Drive - it always opens your latest save.",
    pros: ['Short, and a constant length', 'Always up to date - edit freely, the link stays valid', 'You choose who can open it (below)', "Public doesn't require recipient to have Google Account"],
    cons: ['Shares the file from your Google Drive', 'Breaks if you delete the file or stop sharing', 'Invite requires recipient to have Google Account'],
  },
  // Explains the two share TYPES (Copy vs Collab) the rows below are tagged with - point form, not pros/cons.
  shares: {
    how: 'How each person can use what you shared with them:',
    points: [
      { label: 'Copy', text: 'view-only - they get their own copy to edit; your file stays read-only to them.' },
      { label: 'Collab', text: 'they can edit, and their changes sync back so you both work on the same diagram.' },
    ],
  },
};
function infoPanelHtml(key) {
  const i = SHARE_INFO[key];
  const body = i.points
    ? `<ul class="df-share__info-points">${i.points.map((p) => `<li><strong>${escHtml(p.label)}</strong> - ${escHtml(p.text)}</li>`).join('')}</ul>`
    : `<div class="df-share__info-cols">
        <ul class="df-share__pros" aria-label="Pros">${i.pros.map((p) => `<li>${escHtml(p)}</li>`).join('')}</ul>
        <ul class="df-share__cons" aria-label="Cons">${i.cons.map((c) => `<li>${escHtml(c)}</li>`).join('')}</ul>
      </div>`;
  return `<div class="df-share__info-panel" data-panel="${key}" hidden role="note">
      <p class="df-share__info-how">${escHtml(i.how)}</p>
      ${body}
    </div>`;
}
const INFO_GLYPH = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11zM7.1 6.6h1.8V12H7.1zM8 3.4a1.05 1.05 0 1 1 0 2.1 1.05 1.05 0 0 1 0-2.1z"/></svg>';

function showShareModal(url, opts = {}) {
  document.querySelector('.df-share-modal')?.remove();

  // images can't be URL-shared (too big) — but the Drive link still can (it stores the whole file).
  const isWarning = opts.reason === 'image';
  const connected = isDriveConfigured() && isDriveConnected();
  // Past this length, chat apps / email / QR codes start truncating the classic link.
  const LONG_URL_WARN = 8000;
  const tooLong = !isWarning && typeof url === 'string' && url.length > LONG_URL_WARN;
  const longWarnHtml = tooLong
    ? `<div class="df-share-modal__longwarn" role="alert">
         <p style="margin:0 0 4px;font-weight:600;color:var(--text-primary)">This Diagramforce link is very long (${url.length.toLocaleString()} characters).</p>
         <p style="margin:0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">Some chat apps, email clients, and QR codes truncate long URLs.${connected ? ' Use the <strong>Google Drive link</strong> below for a short one,' : ' Sync to Google Drive for a short link,'} or <strong>Save → Export to JSON</strong> and send the file.</p>
       </div>`
    : '';

  // Section 1: the classic (inline) link — OR, for image diagrams (too big for a URL), a note.
  // Pros/cons panel sits between the label and the field; Copy is the primary action.
  const classicSection = `
    <div class="df-share__section">
      <div class="df-share__label">Diagramforce link <button type="button" class="df-share__info-btn" data-info="classic" aria-label="About the Diagramforce link" aria-expanded="false">${INFO_GLYPH}</button></div>
      ${infoPanelHtml('classic')}
      ${isWarning
        ? `<p class="df-share__warn-text" style="margin:0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">Diagrams with images are too large for a Diagramforce link.${connected ? ' Use the <strong>Google Drive link</strong> below - it stores the whole diagram, images and all.' : ' Sync to Google Drive (below), or use <strong>Save → Export to JSON</strong>.'}</p>`
        : `<div class="df-share__row">
             <input type="text" class="df-share-modal__url df-share__field" readonly aria-readonly="true" aria-label="Classic shareable link" spellcheck="false">
             <button type="button" class="df-modal__btn df-modal__btn--primary df-share__copy" data-copy="classic">Copy</button>
           </div>`}
      ${longWarnHtml}
    </div>`;

  // Section 2: the Google Drive link — short + live, with a Public/Invite/Organisation audience pill.
  // Shown only once connected; configured-but-not-connected users get an unlock prompt instead.
  // Organisation auto-scopes to the signed-in user's Workspace domain (no input). Invite (specific
  // people) takes emails. Public needs no field.
  const driveSection = connected
    ? `<div class="df-share__section df-share__drive">
        <div class="df-share__label">Google Drive link <button type="button" class="df-share__info-btn" data-info="drive" aria-label="About the Google Drive link" aria-expanded="false">${INFO_GLYPH}</button></div>
        ${infoPanelHtml('drive')}
        <div class="df-share__pill-row">
          <div class="df-share__pill" role="radiogroup" aria-label="Who can open the Drive link">
            <button type="button" class="df-share__pill-opt is-active" data-scope="anyone" role="radio" aria-checked="true">Public</button>
            <button type="button" class="df-share__pill-opt" data-scope="user" role="radio" aria-checked="false">Invite</button>
            <button type="button" class="df-share__pill-opt" data-scope="domain" role="radio" aria-checked="false">Organisation</button>
          </div>
          <div class="df-share__access-row" hidden>
            <div class="df-share__access" role="radiogroup" aria-label="Access for recipients">
              <button type="button" class="df-share__access-opt is-active" data-access="view" role="radio" aria-checked="true" title="View-only - recipients can open but not change your file; if they edit, it forks to their own copy">Copy</button>
              <button type="button" class="df-share__access-opt" data-access="edit" role="radio" aria-checked="false" title="Editable - recipients edit a copy; their changes come back to you to review">Collaborate</button>
            </div>
          </div>
        </div>
        <p class="df-share__scope-explainer" style="margin:0 0 var(--spacing-sm);color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.45"></p>
        <div class="df-share__scope-field" data-for="user" hidden>
          <div class="df-share__email-field"><span class="df-share__email-pills"></span><input type="text" class="df-share__emails" placeholder="trailblazer@gmail.com" aria-label="Email addresses"></div>
        </div>
        <div class="df-share__create-row">
          <span class="df-share__create-note" hidden>Sharing link will automatically trigger Google Drive notification email</span>
          <button type="button" class="df-modal__btn df-modal__btn--primary df-share__create">Share link</button>
        </div>
        <div class="df-share__row df-share__gd-result" hidden>
          <input type="text" class="df-share__field df-share__gd-field" readonly aria-label="Google Drive share link" spellcheck="false">
          <button type="button" class="df-modal__btn df-share__copy" data-copy="drive">Copy</button>
        </div>
        <div class="df-share__shared-drive">
          <span class="df-share__shared-drive-hint">Put an editable copy in a team Shared Drive so everyone there can edit it together.</span>
          <button type="button" class="df-modal__btn df-modal__btn--amber-outline df-share__add-drive"><svg class="df-toolbar__icon" aria-hidden="true"><use href="#icon-gdrive"></use></svg>Add to Shared Drive</button>
        </div>
        <div class="df-share__status-section">
          <div class="df-share__label">Google Drive shares <button type="button" class="df-share__info-btn" data-info="shares" aria-label="What Copy and Collab mean" aria-expanded="false">${INFO_GLYPH}</button></div>
          ${infoPanelHtml('shares')}
          <div class="df-share__status" role="status"></div>
          <div class="df-share__people" hidden></div>
        </div>
      </div>`
    : isDriveConfigured()
      ? `<div class="df-share__unlock">
          <p style="margin:0 0 var(--spacing-sm);color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">Sync to <strong>Google Drive</strong> to unlock a <strong>short, always-up-to-date</strong> link you can keep public, share with specific people, or limit to your organisation.</p>
          <button type="button" class="df-modal__btn df-share__connect"><svg class="df-toolbar__icon" aria-hidden="true"><use href="#icon-gdrive"></use></svg>Connect Google Drive</button>
        </div>`
      : '';

  const { body, close } = buildModal({
    title: 'Share Diagram',
    className: 'df-share-modal',
    origin: document.getElementById('btn-share-url'),   // scale-open from the Share button
    anchor: document.getElementById('btn-share-url'),   // anchored under the Share button (item 5)
    zIndex: 3000, width: '480px',
    bodyStyle: 'padding:var(--spacing-md) var(--spacing-lg)',
    bodyHtml: classicSection + driveSection,
    footerHtml: null,
  });

  const urlInput = body.querySelector('.df-share-modal__url');   // null in the image case (no classic link)
  if (urlInput) urlInput.value = url;

  // (i) toggles — reveal/hide the pros/cons panel for a section.
  body.querySelectorAll('.df-share__info-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = body.querySelector(`.df-share__info-panel[data-panel="${btn.dataset.info}"]`);
      const open = panel?.hasAttribute('hidden');
      if (panel) panel.toggleAttribute('hidden', !open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  // Copy buttons (classic + drive) — copy the adjacent field, flash "✓ Copied!".
  const copyFrom = (btn, field) => {
    if (!field?.value) return;
    navigator.clipboard.writeText(field.value).then(() => {
      const o = btn.textContent; btn.textContent = '✓ Copied!'; btn.classList.add('is-copied');
      setTimeout(() => { btn.textContent = o; btn.classList.remove('is-copied'); }, 2000);
    }).catch(() => { field.select(); showToast('Could not copy automatically - press ⌘C / Ctrl+C on the selected link.', 'warning'); });
  };
  body.querySelectorAll('.df-share__copy').forEach((btn) => {
    btn.addEventListener('click', () => copyFrom(btn, body.querySelector(btn.dataset.copy === 'drive' ? '.df-share__gd-field' : '.df-share-modal__url')));
  });

  // "Connect Google Drive" — sign in, then reopen the overlay (now connected → Drive section). Use innerHTML, not
  // textContent, so the Drive glyph survives the connecting/error label swaps.
  body.querySelector('.df-share__connect')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; const glyph = '<svg class="df-toolbar__icon" aria-hidden="true"><use href="#icon-gdrive"></use></svg>';
    b.disabled = true; b.innerHTML = glyph + 'Connecting…';
    try { await signIn(); close(); shareAsURL(); }
    catch (err) { b.disabled = false; b.innerHTML = glyph + 'Connect Google Drive'; showError('Could not connect to Google Drive: ' + (err.message || 'unknown error')); }
  });

  // Drive section: access level (view/edit) + audience pill + Create + the shared-copies list.
  if (connected) {
    const accessOpts = [...body.querySelectorAll('.df-share__access-opt')];
    const accessOf = () => accessOpts.find((o) => o.classList.contains('is-active'))?.dataset.access || 'view';
    const pillOpts = [...body.querySelectorAll('.df-share__pill-opt')];
    const scopeOf = () => pillOpts.find((o) => o.classList.contains('is-active'))?.dataset.scope || 'anyone';
    const gdResult = body.querySelector('.df-share__gd-result');
    const gdField = body.querySelector('.df-share__gd-field');
    const createBtn = body.querySelector('.df-share__create');
    const peopleBox = body.querySelector('.df-share__people');
    const explainer = body.querySelector('.df-share__scope-explainer');
    const accessRow = body.querySelector('.df-share__access-row');
    // The Copy/Collaborate toggle applies to Invite AND Organisation (item 3); Public is always view-only.
    const createNote = body.querySelector('.df-share__create-note');
    const syncScopeFields = () => {
      const scope = scopeOf();
      body.querySelectorAll('.df-share__scope-field').forEach((el) => { el.hidden = el.dataset.for !== scope; });
      if (accessRow) accessRow.hidden = !(scope === 'user' || scope === 'domain');
      // The notification-email note is only true for Invite (specific people get an email); Public / Organisation don't.
      if (createNote) createNote.hidden = scope !== 'user';
    };

    // One plain-language line per option. The view/edit choice now applies to Invite + Organisation. No em-dashes.
    const explainerText = () => {
      const scope = scopeOf();
      if (scope === 'anyone') return 'Anyone with the link can view the latest version. No Google account needed.';
      if (scope === 'domain') {
        return accessOf() === 'edit'
          ? 'Everyone in your Google Workspace organisation gets an editable copy they can change together. Your saves push to it; if someone edits it, you will see it flagged here to review. Your own master stays separate. Drive keeps a version history (Drive menu) so you can roll back.'
          : 'Anyone in your Google Workspace organisation can open and view the latest version - they see your edits on refresh but cannot change your file (it stays view-only). Drive keeps a version history (Drive menu) so you can roll back.';
      }
      return accessOf() === 'edit'
        ? 'People you invite get their own editable copy. Your saves push to their copy; if they edit it too, you will see it flagged here to review. Drive keeps a version history (Drive menu) so you can roll back.'
        : 'People you invite open it signed in with the invited account. They can tweak their own local copy or refresh it to pull your latest, but cannot save changes back to your file.';
    };
    const refreshExplainer = () => { if (explainer) explainer.textContent = explainerText(); };

    // Public is view-only, so reset the Copy/Collaborate toggle to a clean "Copy" default when entering it —
    // otherwise returning to Invite/Organisation would silently show a stale "Collaborate" as if pre-selected.
    const resetAccess = () => accessOpts.forEach((o) => {
      const on = o.dataset.access === 'view'; o.classList.toggle('is-active', on); o.setAttribute('aria-checked', on ? 'true' : 'false');
    });

    const pickScope = (opt) => {
      pillOpts.forEach((o) => { const on = o === opt; o.classList.toggle('is-active', on); o.setAttribute('aria-checked', on ? 'true' : 'false'); });
      if (scopeOf() === 'anyone') resetAccess();
      syncScopeFields();
      refreshExplainer();
      gdResult.hidden = true; createBtn.textContent = 'Share link';   // scope changed → re-create
    };
    // The Copy/Collaborate choice applies to Invite + Organisation; Public links are always view-only.
    // syncScopeFields() first keeps the access-row visibility in step (consistent with pickScope).
    const applyAccess = () => {
      syncScopeFields();
      refreshExplainer();
      gdResult.hidden = true; createBtn.textContent = 'Share link';
    };

    // R8 — the "Sharing" status block: at-a-glance, is THIS diagram shared, with whom, and how. Uses only
    // what the app itself tracks (the copies you shared out + the file you opened from someone), plus a link
    // to Google Drive's own sharing dialog for the authoritative "who has access" (incl. view-only recipients
    // the app can't enumerate). Re-rendered alongside the copies list so it stays in step after Create/Resolve.
    const statusBox = body.querySelector('.df-share__status');
    const renderShareStatus = (grants = []) => {
      if (!statusBox) return;
      const st = activeShareStatus ? activeShareStatus() : { role: 'local', copies: [], source: null, manageUrl: null };
      // Direct grants = people / the public link you invited DIRECTLY on this master (reader/writer permissions, no
      // copy file). activeShareStatus's role classifier only sees driveCopies + sharedSource, so a master shared
      // ONLY via Invite would read "Not shared yet" while the roster below lists the invitees - the contradiction.
      // Count them here so the summary stays honest.
      const directGrants = (grants || []).filter((g) => g && !g.inherited);
      const grantPeople = directGrants.filter((g) => g.scope !== 'anyone').length;
      const anyoneLink = directGrants.some((g) => g.scope === 'anyone');
      // The status glyph must MATCH the tab glyph for the same role (the user reads one cue in two places). Source it
      // from the same shareGlyphKind() the tab uses: out -> #share_mobile, in -> #share_link, both -> #socialshare.
      const GLYPH_ICON = { out: 'share_mobile', in: 'share_link', both: 'socialshare' };
      let icon = GLYPH_ICON[shareGlyphKind(st.role)] || '';
      let text = '', manageUrl = '', manageLabel = '';
      if (st.role === 'shared-out') {
        // A Shared Drive copy is a PLACE (many people), not a person, so count drives + people separately and
        // word each correctly (item 7.3 - a Shared-Drive-only share must not read "Shared with 1 person").
        const sd = st.copies.filter((c) => c.kind === 'shared-drive').length;
        const ppl = st.copies.length - sd;
        const parts = [];
        if (ppl) parts.push(`${ppl} ${ppl === 1 ? 'person' : 'people'} as ${ppl === 1 ? 'an editable copy' : 'editable copies'}`);
        if (sd) parts.push(`${sd} team Shared Drive${sd === 1 ? '' : 's'}`);
        text = `<strong>Shared with ${parts.join(' and ') || 'others'}.</strong> Your saves keep ${st.copies.length === 1 ? 'it' : 'them'} up to date; the details are listed below.`;
        if (st.manageUrl) { manageUrl = st.manageUrl; manageLabel = 'Manage'; }
      } else if (st.role === 'shared-in-edit') {
        text = `<strong>You opened this from a shared file you can edit.</strong> Your saves sync back to the owner, so changes here reach other people.`;
        if (st.source?.manageUrl) { manageUrl = st.source.manageUrl; manageLabel = 'View original'; }
      } else if (st.role === 'shared-in-view') {
        // No "View original" button: it only opened the source in Drive's read-only viewer (and could 404 under
        // drive.file). The action a view-only recipient actually wants - pull the owner's latest into their copy - is
        // already offered by the navbar Drive icon's Refresh when the original changes, so this block is text only.
        text = `<strong>You opened this from a view-only shared file.</strong> Your edits save to your own copy only - they do not change the original or reach anyone else.`;
      } else if (st.role === 'shared-drive-master') {
        // The file lives on a team Shared Drive: access is granted by Drive membership, not by you per-file. Point to
        // Drive for the authoritative roster + any access change.
        text = `<strong>On a team Shared Drive.</strong> Everyone with access to this Shared Drive can open and edit this diagram, and their edits reach you too. Membership is managed in Google Drive, not here.`;
        if (st.manageUrl) { manageUrl = st.manageUrl; manageLabel = 'Manage'; }
      } else if (grantPeople || anyoneLink) {
        // Your own master, shared ONLY via direct Invite grants (no editable copies) - the role is 'local' but it IS
        // shared, so don't read "Not shared yet". Glyph = the outgoing one (your edits reach them).
        icon = GLYPH_ICON.out;
        const parts = [];
        if (grantPeople) parts.push(`${grantPeople} ${grantPeople === 1 ? 'person' : 'people'}`);
        if (anyoneLink) parts.push('anyone with the link');
        text = `<strong>Shared with ${parts.join(' and ')}.</strong> They see your latest version; the details are listed below.`;
        if (st.manageUrl) { manageUrl = st.manageUrl; manageLabel = 'Manage'; }
      } else {
        text = `<strong>Not shared yet.</strong> Only you can see this diagram. Create a Google Drive link above to share it with others.`;
      }
      // One row: [glyph] [text ............] [Manage button] - the glyph + button are vertically centered to the text.
      const manageBtn = manageUrl
        ? `<a class="df-share__manage-btn" href="${escHtml(manageUrl)}" target="_blank" rel="noopener">${manageLabel} ↗</a>`
        : '';
      statusBox.innerHTML =
        `<div class="df-share__status-row">${icon ? `<svg class="df-share__status-icon" aria-hidden="true"><use href="#${icon}"></use></svg>` : ''}<span class="df-share__status-text">${text}</span>${manageBtn}</div>`;
    };

    // Unified "Google Drive shares" roster: every share is bucketed into EDIT / VIEW / SHARED DRIVE sections (in
    // that order, each shown only if non-empty), so a diagram shared multiple ways shows EACH method. Two sources
    // merge:
    //  - LIVE permissions.list grants (listActiveShareGrants): a DIRECT writer -> Edit, reader/commenter -> View, an
    //    INHERITED Shared-Drive member -> Shared Drive (read-only - you can't revoke Drive-level access from here).
    //  - local copies (activeShareCopies): an editable (Collaborate) copy -> Edit, a published shared-drive copy ->
    //    Shared Drive. (mydrive-backup is a private mirror - skipped.)
    // Each section header carries its own glyph so the glyph matches the explanation (edit / view / shared-drive).
    // Best-effort: a failed permissions.list just omits the grant rows (copies still render).
    // Renders the LOCAL copies immediately (no network wait), then merges the LIVE permissions.list grants when they
    // arrive (best-effort - a blocked/failed/absent token leaves the copies-only view). Never `await`s the grants
    // fetch before painting, so the modal isn't blocked on a slow / popup-gated token call.
    const renderDriveShares = () => {
      if (!peopleBox) { renderShareStatus(); return; }
      const copies = activeShareCopies ? activeShareCopies() : [];
      const roleLabel = (role) => role === 'reader' ? 'Can view' : role === 'commenter' ? 'Can comment' : 'Can edit';
      const paint = (grants) => {
      renderShareStatus(grants);   // status reflects the live grants too (so direct invites stop reading "Not shared yet")
      const edit = [], view = [], sharedDrive = [];
      for (const g of grants) {
        if (g.inherited) sharedDrive.push({ kind: 'member', permId: g.permissionId, who: g.recipient, sub: roleLabel(g.role) });
        else if (g.role === 'writer') edit.push({ kind: 'grant', permId: g.permissionId, who: g.recipient });
        else view.push({ kind: 'grant', permId: g.permissionId, who: g.recipient });
      }
      for (const c of copies) {
        if (c.kind === 'mydrive-backup') continue;   // private mirror - never a "share"
        const row = { kind: 'copy', fileId: c.fileId, who: c.label, conflict: c.conflict, shareUrl: c.shareUrl };
        (c.kind === 'shared-drive' ? sharedDrive : edit).push(row);
      }
      const rowHtml = (r) => {
        if (r.kind === 'member') return `
          <div class="df-share__copy-row" data-perm="${escHtml(r.permId || '')}">
            <span class="df-share__copy-label"><span class="df-share__copy-type">${r.sub}</span><span class="df-share__copy-who"> · ${escHtml(r.who)}</span></span>
            <span class="df-share__copy-status" title="Access comes from membership of the team Shared Drive. Change it from Google Drive (the link above), not here.">via Shared Drive</span>
          </div>`;
        if (r.kind === 'grant') return `
          <div class="df-share__copy-row" data-perm="${escHtml(r.permId)}">
            <span class="df-share__copy-label df-share__copy-who">${escHtml(r.who)}</span>
            <span class="df-share__copy-status" title="A direct invite on your diagram - they see your latest at this link.">invite</span>
            <button type="button" class="df-modal__btn df-share__copy-remove" data-revoke title="Revoke this invite - the recipient loses access to your diagram. Your file is not affected and you can re-share any time.">Revoke</button>
          </div>`;
        return `
          <div class="df-share__copy-row${r.conflict ? ' is-conflict' : ''}" data-file="${escHtml(r.fileId)}">
            <span class="df-share__copy-label df-share__copy-who">${escHtml(r.who)}</span>
            <span class="df-share__copy-status" title="${r.conflict ? 'The recipient changed this copy. Resolve it before your next save so you do not overwrite their work.' : 'Your saves keep flowing to this shared copy, so the recipient always has your latest.'}">${r.conflict ? 'edited by recipient' : 'in sync'}</span>
            ${r.conflict
              ? '<button type="button" class="df-modal__btn df-share__copy-resolve" data-resolve>Resolve</button>'
              : '<button type="button" class="df-modal__btn df-modal__btn--amber-outline df-share__copy-copy" data-copylink>Copy link</button>'}
            <button type="button" class="df-modal__btn df-share__copy-remove" data-remove title="Revoke this share - the recipients lose access (the copy moves to your Drive trash, recoverable 30 days)">Revoke</button>
          </div>`;
      };
      // No emoji glyphs. Each section carries a Copy/Collab PILL naming the Diagramforce share type: Can edit = Collab
      // (editable, syncs back), Can view = Copy (view-only clone), Shared Drive = Collab too (every member can edit).
      // The (i) by the section title explains the two. Each section is a collapsible bordered table, like the
      // Load > Google Drive groups (chevron in the head toggles `--collapsed`); expanded by default.
      const SECTIONS = [
        { title: 'Can edit', type: 'collab', rows: edit },
        { title: 'Can view', type: 'copy', rows: view },
        { title: 'Shared Drive', type: 'collab', rows: sharedDrive },
      ];
      const typePill = (t) => t ? sharePillHtml(t === 'collab', { sm: true, title: '' }) : '';
      const CHEVRON = '<svg class="df-load-open__chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const html = SECTIONS.filter((sec) => sec.rows.length).map((sec) => `
        <div class="df-share__group">
          <div class="df-share__group-head" role="button" tabindex="0" aria-expanded="true">${CHEVRON}${sec.title}${typePill(sec.type)}<span class="df-share__group-count">${sec.rows.length}</span></div>
          <div class="df-share__group-rows">${sec.rows.map(rowHtml).join('')}</div>
        </div>`).join('');
      peopleBox.innerHTML = html;
      peopleBox.hidden = !html;
      // Collapse / expand a section by clicking (or Enter/Space on) its head, like the Load > Drive groups.
      peopleBox.querySelectorAll('.df-share__group-head').forEach((head) => {
        const toggle = () => {
          const grp = head.closest('.df-share__group');
          const collapsed = grp.classList.toggle('df-share__group--collapsed');
          head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        };
        head.addEventListener('click', toggle);
        head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      });
      // Action wiring (delegated on peopleBox). Members have no action (managed in Drive).
      peopleBox.querySelectorAll('[data-revoke]').forEach((btn) => btn.addEventListener('click', async () => {
        const permissionId = btn.closest('[data-perm]')?.dataset.perm;
        const g = grants.find((x) => x.permissionId === permissionId);
        if (!g) return;
        const ok = await confirmModal({
          title: 'Revoke this invite?',
          message: `${g.recipient === 'Anyone with the link' ? 'Anyone with the link' : `"${g.recipient}"`} will lose access to your diagram. Your file is not affected and you can re-share any time.`,
          okLabel: 'Revoke access', cancelLabel: 'Cancel', tone: 'danger',
        });
        if (!ok) return;
        btn.disabled = true;
        try {
          if (await removeGrant(permissionId)) { renderDriveShares(); showToast('Access revoked ✓', 'success'); }
          else { btn.disabled = false; showError('Could not revoke access.'); }
        } catch (e) { btn.disabled = false; showError('Could not revoke access: ' + (e.message || 'unknown error')); }
      }));
      peopleBox.querySelectorAll('[data-resolve]').forEach((btn) => btn.addEventListener('click', async () => {
        const fileId = btn.closest('[data-file]')?.dataset.file;
        if (fileId) { await resolveCopyConflict(fileId); renderDriveShares(); }
      }));
      peopleBox.querySelectorAll('[data-copylink]').forEach((btn) => btn.addEventListener('click', () => {
        const fileId = btn.closest('[data-file]')?.dataset.file;
        const c = copies.find((x) => x.fileId === fileId);
        if (!c) return;
        navigator.clipboard.writeText(c.shareUrl).then(() => { const o = btn.textContent; btn.textContent = '✓ Copied!'; btn.classList.add('is-copied'); setTimeout(() => { btn.textContent = o; btn.classList.remove('is-copied'); }, 1500); })
          .catch(() => showToast('Could not copy automatically.', 'warning'));
      }));
      peopleBox.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', async () => {
        const fileId = btn.closest('[data-file]')?.dataset.file;
        const c = copies.find((x) => x.fileId === fileId);
        if (!c) return;
        const ok = await confirmModal({
          title: 'Stop sharing this copy?',
          message: `"${c.label}" will be moved to your Google Drive trash, so the people you shared it with lose access (recoverable for 30 days). Your own diagram is not affected.`,
          okLabel: 'Remove share', cancelLabel: 'Cancel', tone: 'danger',
        });
        if (!ok) return;
        btn.disabled = true;
        try {
          if (await removeShare(fileId)) { renderDriveShares(); showToast('Share removed ✓', 'success'); }
          else { btn.disabled = false; showError('Could not remove the share.'); }
        } catch (e) { btn.disabled = false; showError('Could not remove the share: ' + (e.message || 'unknown error')); }
      }));
      };   // end paint
      paint([]);   // immediate: the local copies (Edit / Shared Drive) - no network wait
      // then merge the live permissions.list grants (Edit / View / Shared-Drive members) when they resolve
      if (listActiveShareGrants) listActiveShareGrants().then((g) => paint(g || [])).catch(() => {});
    };

    accessOpts.forEach((opt) => opt.addEventListener('click', () => {
      accessOpts.forEach((o) => { const on = o === opt; o.classList.toggle('is-active', on); o.setAttribute('aria-checked', on ? 'true' : 'false'); });
      applyAccess();
    }));
    pillOpts.forEach((opt) => opt.addEventListener('click', () => pickScope(opt)));

    // Email PILL field (item 9): space / comma / semicolon / Enter (or blur, or a multi-address paste) turns the
    // buffer into a removable pill, so multiple recipients can be added in one go. getEmails() = pills + the live
    // buffer; clearEmails() empties it after an invite (item 8).
    const emailInput = body.querySelector('.df-share__emails');
    const emailPills = body.querySelector('.df-share__email-pills');
    const emailList = [];
    const renderPills = () => {
      emailPills.innerHTML = emailList.map((e, i) => `<span class="df-share__email-pill">${escHtml(e)}<button type="button" class="df-share__email-x" data-i="${i}" aria-label="Remove ${escHtml(e)}">×</button></span>`).join('');
    };
    const addPill = (raw) => {
      const v = String(raw || '').trim().replace(/[,;\s]+$/, '');
      if (v && !emailList.includes(v)) { emailList.push(v); renderPills(); }
    };
    const commitBuffer = () => { const v = emailInput.value.trim(); if (v) { addPill(v); emailInput.value = ''; } };
    const clearEmails = () => { emailList.length = 0; renderPills(); emailInput.value = ''; };
    const getEmails = () => { const buf = emailInput.value.trim(); return [...emailList, ...(buf ? [buf] : [])].filter(Boolean); };
    if (emailInput && emailPills) {
      emailInput.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === ',' || e.key === ';' || e.key === 'Enter') { e.preventDefault(); commitBuffer(); }
        else if (e.key === 'Backspace' && !emailInput.value && emailList.length) { emailList.pop(); renderPills(); }
      });
      emailInput.addEventListener('blur', commitBuffer);
      emailInput.addEventListener('paste', (e) => {
        const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
        if (/[,;\s]/.test(text)) { e.preventDefault(); text.split(/[\s,;]+/).forEach(addPill); }
      });
      emailPills.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { emailList.splice(Number(b.dataset.i), 1); renderPills(); } });
      body.querySelector('.df-share__email-field')?.addEventListener('click', (e) => { if (e.target.classList.contains('df-share__email-field')) emailInput.focus(); });
    }

    createBtn.addEventListener('click', async () => {
      const scope = scopeOf();
      const access = (scope === 'user' || scope === 'domain') ? accessOf() : 'view';   // Copy/Collaborate: Invite + Organisation
      const domain = body.querySelector('.df-share__domain')?.value.trim() || '';   // none in UI → auto-resolved from the account
      const emails = getEmails();
      const orig = createBtn.textContent; createBtn.disabled = true; createBtn.textContent = 'Working…';
      try {
        const gdUrl = access === 'edit'
          ? await shareActiveEditable({ scope, emails, domain })   // Collaborate: editable copy for the invited people OR the whole org
          : await shareActiveScoped({ scope, domain, emails });
        gdField.value = gdUrl; gdResult.hidden = false;
        // Auto-copy the fresh link (item 8) — that's what you want it for. Falls back to select-the-field
        // if the clipboard is blocked (the Copy button stays available either way).
        let copied = false;
        try { await navigator.clipboard.writeText(gdUrl); copied = true; } catch { /* clipboard blocked */ }
        createBtn.textContent = access === 'edit' ? 'Share another' : 'Update link'; createBtn.disabled = false;
        if (copied) showToast('Link created and copied to clipboard ✓', 'success');
        else { gdField.focus(); gdField.select(); }
        clearEmails();   // empty the recipient field so the next person can be invited (item 8)
        renderDriveShares();
      } catch (err) {
        createBtn.textContent = orig; createBtn.disabled = false;
        showError('Could not create the Google Drive link: ' + (err.message || 'unknown error'));
      }
    });

    // Item 3 — "Add to Shared Drive" sits below the link controls and works regardless of the chosen scope:
    // it opens the Google Picker to choose a team Shared Drive folder, copies an editable diagram there, and
    // registers it as a Shared-Drive copy (so it appears in the list above). Mirrors the Save menu action.
    const addDriveBtn = body.querySelector('.df-share__add-drive');
    addDriveBtn?.addEventListener('click', async () => {
      const tabId = pctx.activeTabIdCb ? pctx.activeTabIdCb() : null;
      if (!tabId) return;
      const orig = addDriveBtn.textContent; addDriveBtn.disabled = true; addDriveBtn.textContent = 'Choose a folder…';
      try {
        if (await publishTabsToSharedDrive([tabId])) { showToast('Added to a Shared Drive ✓', 'success'); renderDriveShares(); }
      } catch (err) {
        showError('Could not add to a Shared Drive: ' + (err.message || 'unknown error'));
      } finally {
        addDriveBtn.textContent = orig; addDriveBtn.disabled = false;
      }
    });

    applyAccess();
    renderDriveShares();
  }

  setTimeout(() => urlInput?.select(), 50);
}

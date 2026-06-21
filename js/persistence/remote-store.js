// Remote store — user-owned cloud storage for diagrams (Google Drive first), with
// NO backend. Phase 1 (Documentation/Diagramforce-Extended-Share.md §8): "Save to
// Google Drive" + "Open from Google Drive". The diagram lives in the END-USER's own
// Drive, owned by them; the developer's Cloud project is only the app's API identity
// (it stores nothing). Validated end-to-end by spike/gdrive-spike.html.
//
// Layering: this is a persistence sub-module. It READS the runtime context (`pctx`)
// that persistence.init() wires, exactly like share-orchestration.js — it never
// imports persistence.js back (keeps the dependency graph acyclic). Save/open reuse
// the SAME load pipeline as share/import: sanitizeGraphJSON → checkVersionWarning →
// onImport. The inline-URL + localStorage paths are untouched and remain the
// offline / signed-out / Drive-unavailable fallback.
//
// Google credentials are PUBLIC by design (the OAuth client id is public; the API
// key is referrer-locked to Drive+Picker, so a copy buys at most quota — never
// data). They are resolved per-origin below.

import { showToast, showError, buildModal, confirmModal } from '../feedback.js?v=1.17.0.199';
import { pctx } from './context.js?v=1.17.0.199';
import { driveFileName, DGF_MIME, PICKER_MIMES, myDiagramsQuery } from './df-format.js?v=1.17.0.199';
import { revisionMoved, upsertCopy, removeCopy, conflictActions, shouldFanOut, sortRevisions, revisionSizeLabel, healDecision, importsToUnflag, sharedSourcePushDecision, importedFileRole, isRecognizedDgfMaster, reconcileTabFileLinks, tabShareRole, sharedMasterDeleteDecision, revisionAuthorLabel, upstreamNoticeDecision } from './drive-sync-logic.js?v=1.17.0.199';
import { countDiagramShapes, compareSemver, escHtml, formatRelativeTime, diffGraphs } from '../util.js?v=1.17.0.199';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
// `email` is requested SEPARATELY + lazily (incremental auth) — ONLY the first time someone uses
// "Organisation" sharing, so a normal connect / save / public / invite share never widens the
// consent screen. Non-sensitive basic scope.
const EMAIL_SCOPE = 'openid email';
const GIS_SRC  = 'https://accounts.google.com/gsi/client';
const GAPI_SRC = 'https://apis.google.com/js/api.js';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const API    = 'https://www.googleapis.com/drive/v3/files';

// Per-origin Google config. PROD is embedded (and meant to be) — fill it when the
// prod origin + referrer-locked key are registered (see Extended-Share doc §5).
// localhost embeds the DEV creds (below) so the feature works in every dev browser /
// incognito without per-browser seeding. Empty clientId ⇒ feature self-gates off.
const DEV_CREDS = {
  // Dev OAuth client + API key, referrer-locked to http://localhost:* (the preview origin).
  // PUBLIC + low-risk: a copy works ONLY from localhost, buys at most dev quota, exposes no data.
  // Embedded so the feature works in every dev browser / incognito with no per-browser seeding.
  // Rotate freely in Cloud Console; remove if you'd rather not ship a dev key (Security §3.1).
  clientId: '873718407054-1kfdhkvijmte6s3eob21mfj3nb6g7596.apps.googleusercontent.com',
  apiKey: 'AIzaSyDzynIFVZCp4OfkYzSLKZN-IebkasT4JqM',
};
const GOOGLE_CONFIG = {
  // PROD creds — PUBLIC by design (client-side Google app, no secret used). Safety comes from the locks, not
  // secrecy: the OAuth client is restricted to the JS origin https://diagramforce.mateuszdabrowski.pl, and the
  // API key is HTTP-referrer-locked to the same + restricted to the Drive + Picker APIs. A copied value works
  // ONLY from this site and buys at most this project's free quota — it exposes no user data. The OAuth client
  // *secret* is NOT part of the GIS token flow and is deliberately NOT stored here. (Setup: Drive-Setup.md.)
  'diagramforce.mateuszdabrowski.pl': {
    clientId: '873718407054-pag1jhjql4f96l7u8vsv195uvadppfuf.apps.googleusercontent.com',
    apiKey: 'AIzaSyC56ShCUdPEll_aaMs0JjqDnOCBUWkS3wQ',
  },
  'localhost': DEV_CREDS,
  '127.0.0.1': DEV_CREDS,
};
function googleConfig() {
  const fixed = GOOGLE_CONFIG[location.hostname];
  if (fixed && fixed.clientId) return fixed;
  // Dev fallback — seed once per browser:
  //   localStorage.setItem('df.gdrive.clientId', '…'); localStorage.setItem('df.gdrive.apiKey', '…')
  return {
    clientId: localStorage.getItem('df.gdrive.clientId') || '',
    apiKey:   localStorage.getItem('df.gdrive.apiKey')   || '',
  };
}

/** Is Drive configured for this origin? Gates whether the menu items are shown. */
export function isDriveConfigured() {
  const { clientId, apiKey } = googleConfig();
  return !!(clientId && apiKey);
}

// ── lazy script loading (don't pull Google's SDKs for users who never use Drive) ──
const _scripts = new Map();
function loadScript(src) {
  if (_scripts.has(src)) return _scripts.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
  _scripts.set(src, p);
  return p;
}

// ── auth: GIS token client (client-side, no secret). ~1h tokens, no refresh. ──
let _tokenClient = null;
let _accessToken = null;
let _tokenExpiry = 0;
// Valid = present AND not within 30 s of its ~1 h expiry. Lets the UI show "sign in"
// proactively (red) instead of waiting for a save to fail and discover the dead token.
function tokenValid() { return !!_accessToken && Date.now() < _tokenExpiry - 30000; }

function getToken({ prompt = '' } = {}) {
  const { clientId } = googleConfig();
  if (!clientId) return Promise.reject(new Error('Google Drive is not configured for this origin.'));
  // Reuse a still-valid token silently instead of re-invoking the GIS client every time (item 5): each
  // `requestAccessToken` can surface Google's account picker when several accounts are signed in, so an action
  // that calls getToken repeatedly (e.g. inviting N people -> N createPermission calls) kept popping the picker
  // even though we were already authenticated. Only a forced prompt (re-consent / account switch) skips the cache.
  if (prompt === '' && tokenValid()) return Promise.resolve(_accessToken);
  return loadScript(GIS_SRC).then(() => new Promise((resolve, reject) => {
    if (!_tokenClient) {
      _tokenClient = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: DRIVE_SCOPE, callback: () => {} });
    }
    // The callback is reassigned each call so it resolves THIS request's promise.
    _tokenClient.callback = (resp) => {
      if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
      _accessToken = resp.access_token;
      _tokenExpiry = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      // Connecting defaults auto-sync ON ("auto-save whenever connected"). Only when the key is UNSET (the very
      // first connect) - a later explicit toggle to '0' (manual mode) is respected, never re-enabled on re-auth.
      if (localStorage.getItem(LS.autosync) == null) localStorage.setItem(LS.autosync, '1');
      // A fresh token means we're connected again — clear every tab's needs-signin flag and refresh the navbar
      // NOW, instead of leaving the red "Sign in" icon up until the next cadence tick (the reported ~30 s lag
      // after re-authing via the Save Manager / a share flow).
      driveByTab.forEach((st) => { if (st && st.needsSignin) st.needsSignin = false; });
      notify();
      // Wire the page-hide flush NOW that we're connected - NOT only on the auto-sync path. Work-boundary saves
      // (switch/open/close already fire auto-independently; this adds leave-the-page) must run in manual mode too,
      // so closing the window flushes the active tab's edits even with Auto-sync Diagrams unchecked. Idempotent.
      wireHiddenFlush();
      // Start the recurring upstream poll now we're connected - so shared-file changes surface even while idle, not
      // only after the next local edit/save (idempotent; cleared on disconnect).
      startUpstreamPoll();
      resolve(_accessToken);
    };
    _tokenClient.requestAccessToken({ prompt });
  }));
}

// Separate token client for the `email` scope — its own consent, requested only on demand (org
// sharing). Returns an access token that can read userinfo. We never store it; the derived email is
// cached instead, so this prompts at most once per session.
let _emailTokenClient = null;
function getEmailToken() {
  const { clientId } = googleConfig();
  if (!clientId) return Promise.reject(new Error('Google Drive is not configured for this origin.'));
  return loadScript(GIS_SRC).then(() => new Promise((resolve, reject) => {
    if (!_emailTokenClient) {
      _emailTokenClient = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: EMAIL_SCOPE, callback: () => {} });
    }
    _emailTokenClient.callback = (resp) => {
      if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
      resolve(resp.access_token);
    };
    _emailTokenClient.requestAccessToken({ prompt: '' });
  }));
}

// ── small fetch helpers ──
async function readErr(res) {
  try { return `${res.status} ${(await res.json())?.error?.message || res.statusText}`; }
  catch { return `${res.status} ${res.statusText}`; }
}
function multipartBody(metadata, jsonStr, boundary) {
  return (
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${jsonStr}\r\n--${boundary}--`
  );
}

// ── Per-tab Drive sync state ─────────────────────────────────────────────────
// Keyed by tab id, so re-saving a tab UPDATES its file (stable id ⇒ short link stays
// valid) and each tab syncs independently. The persistable bits (fileId, sync,
// lastSavedAt) are mirrored into tab meta via pctx.persistTabDrive so a sync survives
// a reload (re-seeded by hydrateTabDrive on session restore).
const driveByTab = new Map();   // tabId -> per-tab Drive state (see tabState below)
const activeTabId = () => (pctx.activeTabIdCb ? pctx.activeTabIdCb() : '__single__');
function tabState(id) {
  let s = driveByTab.get(id);
  if (!s) {
    s = {
      fileId: null,            // the MASTER file id (My Drive) — or the source id of a diagram opened from a link
      headRevisionId: null,    // master's Drive head revision at our last write/read → cross-device divergence baseline
      modifiedTime: null,      // master's modifiedTime at last sync (display / tie-break)
      conflict: false,         // a write was paused because the remote moved under us (autosave can't pop a modal)
      copies: [],              // fan-out targets {fileId, driveId, folderId, label, lastRevisionId, lastPushedAt, conflict}
      // The UPSTREAM file this diagram was opened from via a #gd= share link (Shared File model). The user keeps
      // their own My Drive master in `fileId`; `sharedSource` is a fan-out target written back to ONLY when the
      // user has writer permission. {fileId, canEdit (null=unknown), lastRevisionId, lastPushedAt, conflict}.
      sharedSource: null,
      // Phase B: when set, `fileId` IS a file shared TO the user that they edit DIRECTLY (a Collab/received-editable
      // share, or a team Shared-Drive file) - the ONE source of truth, no working copy, no write-back. {sharedBy}.
      // A private My-Drive backup mirror (a kind:'mydrive-backup' copy) is minted on the first save.
      sharedInEdit: null,
      outgoingGrants: 0,   // # of direct view/edit invites you granted on this master (live-reconciled via listActiveShareGrants)
      folderId: null, driveId: null, folderName: null,   // a picked Shared-Drive folder → a COPY target (NOT the master's home)
      lastSavedAt: 0, lastHash: null, dirty: false, saving: false, needsSignin: false,
    };
    driveByTab.set(id, s);
  }
  return s;
}

// ── Settings (localStorage; provider-scoped so other providers can reuse the seam) ──
const LS = { autosync: 'df.gdrive.autosync', cadence: 'df.gdrive.cadence', folder: 'df.gdrive.folderId' };
const CADENCE_DEFAULT = 120000;   // 2 min — conservative to keep Drive revisions sparse
export function isAutosyncOn() { return localStorage.getItem(LS.autosync) === '1'; }
export function getCadence() { return localStorage.getItem(LS.cadence) || String(CADENCE_DEFAULT); }
export function setCadence(v) { localStorage.setItem(LS.cadence, String(v)); }
export function isSignedIn() { return tokenValid(); }
/** "Connected" once signed in, auto-sync is on, or a tab the USER saved has a Drive file — gates the menu
 *  shape. An IMPORTED tab (opened from a `#gd=` share link, possibly anonymously / logged out) must NOT
 *  count: a view-only recipient should get the recipient menu (Connect + Refresh), not the full owner menu
 *  with Version history (item 10). isSignedIn covers the case where the user opened their OWN file. */
export function isDriveConnected() {
  if (isSignedIn() || isAutosyncOn()) return true;
  for (const s of driveByTab.values()) if (s.fileId && !s.imported) return true;
  return false;
}

// ── "Diagramforce" Drive folder (created once; all synced files live there) ──────
let _folderPromise = null;
async function ensureFolder(token) {
  const cached = localStorage.getItem(LS.folder);
  if (cached) return cached;
  if (_folderPromise) return _folderPromise;
  _folderPromise = (async () => {
    try {
      // App-created folders are visible under drive.file — reuse one if localStorage was cleared.
      const q = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and name='Diagramforce' and trashed=false");
      const f = await fetch(`${API}?q=${q}&fields=files(id)&spaces=drive&supportsAllDrives=true`, { headers: { Authorization: 'Bearer ' + token } });
      if (f.ok) { const j = await f.json(); if (j.files?.[0]?.id) { localStorage.setItem(LS.folder, j.files[0].id); return j.files[0].id; } }
      const c = await fetch(API + '?fields=id&supportsAllDrives=true', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Diagramforce', mimeType: 'application/vnd.google-apps.folder' }),
      });
      if (!c.ok) return null;   // non-fatal: the file just lands in My Drive root instead
      const j = await c.json(); localStorage.setItem(LS.folder, j.id); return j.id;
    } catch { return null; }
  })();
  return _folderPromise;
}

let _statusListener = null;
// Count of tabs mid-write RIGHT NOW (any tab, not just the active one). doSave bumps it around its writeFile
// so getDriveStatus can animate the navbar for background-tab saves during a sign-in / cadence sweep (item #1).
let _savingCount = 0;
/** The navbar registers here; called on every Drive-state change for the active tab. */
export function setDriveStatusListener(cb) { _statusListener = cb; }
function notify() { try { _statusListener?.(); } catch { /* ignore */ } }

/**
 * Drive sync status for the ACTIVE tab — drives the navbar icon's colour + glyph + text.
 * state: off | synced | pending | saving | error.  showText: only when auto-sync is on
 * (per design — the icon alone otherwise).
 */
export function getDriveStatus() {
  const auto = isAutosyncOn();
  const s = driveByTab.get(activeTabId());
  // Auto-syncing but the ~1 h token has lapsed → show red "sign in" NOW (don't keep
  // showing blue "synced" when the next save would actually fail). Manual mode needs no live token.
  if (auto && !tokenValid()) return { state: 'error', showText: true, lastSavedAt: s?.lastSavedAt || 0 };
  let state = 'off';
  if (s && s.needsSignin) state = 'error';
  else if (s && (s.conflict || (s.copies || []).some((c) => c && c.conflict))) state = 'conflict';   // paused — needs Pull/Keep/Fork
  else if (s && ((s.sharedSource && s.sharedSource.upstreamChanged) || s.upstreamChanged)) state = 'refresh';   // the shared file changed upstream — pull available (item 6 + B2 direct-edit)
  else if (s && s.saving) state = 'saving';
  else if (s && s.dirty) state = 'pending';
  else if (s && s.fileId) state = 'synced';
  else if (auto) state = 'synced';        // auto on, nothing pending/saved yet → idle/ok
  // ANY tab saving (incl. a background tab during a multi-tab sweep) animates the navbar - the active-tab
  // check above only covers the active tab, so a sign-in/cadence sweep of OTHER tabs would never spin. The
  // global counter surfaces it as one continuous spin. Never mask the higher-priority error/conflict states.
  if (_savingCount > 0 && state !== 'error' && state !== 'conflict' && state !== 'refresh') state = 'saving';
  // Conflict + Refresh show their text even in manual mode — the user must act, an icon alone is too quiet.
  return { state, showText: auto || state === 'conflict' || state === 'refresh', lastSavedAt: s?.lastSavedAt || 0 };
}

function persistState(id, s) {
  pctx.persistTabDrive?.(id, {
    driveFileId: s.fileId, driveSync: true, driveLastSavedAt: s.lastSavedAt, driveImported: !!s.imported,
    driveFolderId: s.folderId || null, driveDriveId: s.driveId || null,
    driveHeadRevisionId: s.headRevisionId || null,
    // Persist the content-dedupe hash so a no-change manual save after a RELOAD still dedupes (else the first
    // post-reload save always spawned a spurious revision — reported version-history bug).
    driveLastHash: s.lastHash || null,
    driveCopies: s.copies && s.copies.length ? s.copies : null,
    driveSharedSource: s.sharedSource || null,   // the upstream shared file (Shared File fan-out model)
    driveSharedInEdit: s.sharedInEdit || null,   // Phase B: fileId IS a shared file edited directly (no working copy)
    driveOutgoingGrants: s.outgoingGrants || 0,  // # of direct view/edit invites on the master → tab "shared out" glyph
  });
}

/** Re-seed runtime sync state from persisted tab meta (session restore). */
export function hydrateTabDrive(id, meta) {
  if (!meta || (!meta.driveFileId && !meta.driveSharedSource)) return;   // a shared tab may have NO own master yet
  const s = tabState(id);
  s.fileId = meta.driveFileId || null;
  // The upstream shared file (Shared File model). A tab opened from a #gd= link can carry a sharedSource with
  // no own master yet (fileId null) until its first save.
  s.sharedSource = meta.driveSharedSource || null;
  s.sharedInEdit = meta.driveSharedInEdit || null;   // Phase B: fileId is a directly-edited shared file (no working copy to mint)
  s.outgoingGrants = meta.driveOutgoingGrants || 0;   // survives reload so the "shared out" glyph stays until the next live reconcile
  s.lastSavedAt = meta.driveLastSavedAt || 0;
  // Survives reload so "Refresh imported diagram" stays available on a Drive-opened tab.
  s.imported = !!meta.driveImported;
  // Cross-device divergence baseline + fan-out copy targets (Phase 2) survive a reload too, so the
  // lost-update guard + "push but never clobber" keep working after a session restore.
  s.headRevisionId = meta.driveHeadRevisionId || null;
  s.lastHash = meta.driveLastHash || null;   // restore the dedupe baseline so a no-change save post-reload skips
  s.copies = Array.isArray(meta.driveCopies) ? meta.driveCopies : [];
  // A picked Shared-Drive folder is now a COPY target (not the master's home); folderId + driveId
  // are enough to re-create that copy on the next save. The folder NAME is runtime-only display.
  s.folderId = meta.driveFolderId || null;
  s.driveId = meta.driveDriveId || null;
  // An EDITABLE (Collab) shared-in tab RESTORED from the session may carry a sharedSource but never had its own
  // My-Drive working copy minted; link/create it now so the My-Drive chip lights + the Load list de-dups. Self-gates
  // on a live token, so at restore-time it's usually a no-op; the sign-in sweep then mints it. Best-effort.
  // Mode C: a VIEW (Copy) share (canEdit !== true) deliberately stays master-less - it forks to a "(changed)" copy
  // only on the first edit - so it is NOT minted here (that eager mint was the orphan/duplicate-row source).
  if (s.sharedSource && s.sharedSource.fileId && !s.fileId && s.sharedSource.canEdit === true) ensureSharedWorkingCopy(id).catch(() => {});
}

/** Item 1.3: re-link a freshly LOADED browser archive to its Drive master + restore the shares it fanned out
 *  to. hydrateTabDrive only seeds runtime state (it assumes the tab object already carries the meta, true on
 *  session restore); a just-imported tab does NOT, so we also persistState to MIRROR it onto the tab object
 *  (the "In My Drive" chip + Shared-copies list + session). The next connect's reconcile verifies the fileId,
 *  so a since-deleted master self-heals (clears the link + re-saves) rather than pointing at a ghost. */
export function adoptDriveMetaIntoTab(id, meta) {
  if (!meta || (!meta.driveFileId && !meta.driveSharedSource)) return;
  hydrateTabDrive(id, meta);
  persistState(id, tabState(id));
}

/** Build the share-style payload (active tab) the load pipeline already understands. */
/** The ACTIVE tab's live graph, COMPACTED like every other save path (session + JSON export). The Drive
 *  save used to send the full `graph.toJSON()` — much larger files, and a serialization volatile enough
 *  that "unchanged" re-saves still differed → a spurious Drive revision each time. Compacting matches the
 *  stored `.dgf` + makes the dedupe hash stable. (Non-active tabs read `getTabGraph`, already compacted.) */
function liveGraphForSave() {
  const g = pctx.graph.toJSON();
  return pctx.compactGraphForSave ? pctx.compactGraphForSave(g) : g;
}

// #7: {name,icon,color} of a tab's group, or null. Stamped into the .dgf so opening one diagram from Drive
// recreate-or-rejoins its tab group. NOT part of the dedupe hash (g/n/t/m only), so it never spawns a revision.
function groupMetaForTab(tab) {
  const gid = tab && tab.groupId;
  if (!gid || !pctx.getGroups) return null;
  const g = (pctx.getGroups() || []).find((x) => x && x.id === gid);
  return g ? { name: g.name, icon: g.icon || null, color: g.color || null } : null;
}

function currentDiagramData() {
  const aid = pctx.activeTabIdCb ? pctx.activeTabIdCb() : null;
  const activeTab = aid && pctx.getAllTabs ? (pctx.getAllTabs() || []).find((t) => t && t.id === aid) : null;
  const group = groupMetaForTab(activeTab);
  return {
    v: 1,
    av: pctx.appVersion,
    name: pctx.tabNameCb ? pctx.tabNameCb() : 'Diagram',
    type: pctx.diagramTypeCb ? pctx.diagramTypeCb() : 'architecture',
    mappingMode: pctx.mappingModeCb ? pctx.mappingModeCb() : false,
    graph: liveGraphForSave(),
    viewport: pctx.getTabViewport && pctx.activeTabIdCb ? pctx.getTabViewport(pctx.activeTabIdCb()) : null,
    ...(group ? { group } : {}),
  };
}

/** Same payload for ANY tab — active tab from the live graph, others from stored JSON. */
function dataForTab(tab) {
  const isActive = tab.id === activeTabId();
  // COMPACT the graph for BOTH active and non-active tabs. The active path already compacts (liveGraphForSave);
  // a non-active tab must compact its stored graph the SAME way, else its content-hash (raw) never matches the
  // baseline written while it was active (compacted) — which made every autosync re-save an unchanged non-active
  // tab and spawn a no-change Drive revision. Compacting both keeps the dedupe hash basis consistent.
  const stored = pctx.getTabGraph ? pctx.getTabGraph(tab.id) : null;
  const graph = isActive
    ? liveGraphForSave()
    : (stored && pctx.compactGraphForSave ? pctx.compactGraphForSave(stored) : stored);
  const group = groupMetaForTab(tab);   // #7
  return {
    v: 1,
    av: pctx.appVersion,
    name: tab.name || 'Diagram',
    type: pctx.normalizeDiagramType(tab.diagramType || 'architecture'),
    mappingMode: pctx.getTabMappingMode ? pctx.getTabMappingMode(tab.id) : false,
    graph,
    viewport: pctx.getTabViewport ? pctx.getTabViewport(tab.id) : null,
    ...(group ? { group } : {}),
  };
}

// One-time-per-session guard so the (network) reconcile runs at most once, lazily, on the first sweep.
let _driveReconcileDone = false;
// A just-created file can lag a few seconds before files.get/list see it; don't probe-and-clear a recently-saved
// master (that could clear a link the create just made and spawn a duplicate). Only reconcile links older than this.
const RECONCILE_FRESH_MS = 60000;
/** Reconcile the per-tab Drive links once per session:
 *   1. LEGACY `imported:true` tabs (pre Shared File model) — need the owner's `listMyDiagrams` LIST to tell an
 *      own mis-flagged file from a real third-party share (ownership isn't on a single-file GET under
 *      `drive.file`): fileId IS owned → un-flag (sync in place); NOT owned → convert to the Shared File model
 *      (old fileId becomes the upstream `sharedSource`). The list is fetched ONLY when such tabs exist.
 *   2. OWN masters — clear the link on DIRECT per-file evidence via a `remoteMeta` probe, NEVER on list
 *      non-membership: a 404/403 (`healDecision 'recreate'`), a `trashed:true`, OR the file is not a recognizable
 *      Diagramforce master (`isRecognizedDgfMaster`: lacks the `.dgf` MIME/name AND `appProperties.dfType` — e.g.
 *      a stale pointer at a legacy `.diagramforce.json` from a pre-`.dgf` dev build, which `listMyDiagrams` can't
 *      see, so the diagram stays forever "already up to date" against a file that never appears in the library).
 *      A live `.dgf` master is KEPT even when `listMyDiagrams` lagged / renamed / MIME-downgraded / paginated past
 *      it — so we never orphan it into a duplicate (or fork a Picker-opened shared file). A cleared link
 *      (fileId/lastHash/headRevisionId/modifiedTime → null) makes the next sweep RECREATE a fresh `.dgf` (the
 *      content-hash dedupe would otherwise skip the write forever). A freshness guard skips masters saved < 60 s ago.
 *  Non-fatal: a list/probe failure leaves everything as-is for a later retry. */
async function reconcileDriveLinks() {
  const entries = [...driveByTab.entries()];
  const legacy = entries.filter(([, s]) => s.imported && s.fileId);
  const ownMasters = entries.filter(([, s]) => s.fileId && !s.imported && !s.sharedSource);
  if (!legacy.length && !ownMasters.length) return;
  try {
    let token = tokenValid() ? _accessToken : null;
    if (!token) token = await getToken({ prompt: '' });

    if (legacy.length) {
      const owned = await listMyDiagrams();
      const ids = new Set((owned || []).map((f) => f.id));
      const ownedToUnflag = new Set(importsToUnflag(legacy.map(([id, s]) => ({ id, fileId: s.fileId, imported: true })), ids));
      for (const [id, s] of legacy) {
        if (ownedToUnflag.has(id)) {
          s.imported = false;   // own master mis-flagged → sync in place
        } else {
          s.sharedSource = { fileId: s.fileId, canEdit: null, lastRevisionId: s.headRevisionId || null, lastPushedAt: 0, conflict: false };
          s.fileId = null; s.imported = false; s.headRevisionId = null; s.lastHash = null;   // own master created on next save
        }
        persistState(id, s);
      }
    }

    const now = Date.now();
    for (const [id, s] of ownMasters) {
      if (now - (s.lastSavedAt || 0) <= RECONCILE_FRESH_MS) continue;   // just saved → a create can lag files.get; skip
      let dead = false;
      try {
        const meta = await remoteMeta(s.fileId, token);
        if (meta && meta.trashed) dead = true;                            // user trashed it in Drive → re-save as a fresh master
        else if (!isRecognizedDgfMaster(meta, DGF_MIME)) dead = true;     // exists but NOT a .dgf master (legacy .json / foreign) → recreate
        // else: a live `.dgf` master (even if listMyDiagrams lagged/paginated past it) → KEEP, never duplicate.
      } catch (e) {
        if (healDecision(e && e.status, { imported: false }) === 'recreate') dead = true;   // 404 gone / 403 no-access
        // network / 5xx / 401 → leave the link as-is for a later session
      }
      if (dead) {
        s.fileId = null; s.lastHash = null; s.headRevisionId = null; s.modifiedTime = null;   // dead link → recreate next sweep
        persistState(id, s);
      }
    }
    notify();
  } catch { /* a list / probe failure just leaves the links as-is — synced interactively or on a later session */ }
}

/** Content-hash of a diagram's save-relevant fields - the EXACT basis doSave uses for dedupe, so the heal can
 *  tell "this remote file IS my diagram" from "they diverged". */
function dataHash(d) {
  return hashStr(JSON.stringify({ g: d.graph, n: d.name, t: pctx.normalizeDiagramType(d.type), m: !!d.mappingMode }));
}

/**
 * Reconcile EVERY open own-master tab's Drive link against the user's ACTUAL owned files, so the three storage
 * views all agree with Drive reality (the chip-honesty fix). Without this, a diagram genuinely in My Drive shows
 * "My Drive" OFF because THIS browser's tab carried a null/stale `fileId` (created on another device, or never
 * re-linked) - and the next save would CREATE A DUPLICATE instead of updating the existing file.
 *
 * SAFETY (adversarial-review hardening): a tab only ADOPTS a same-named file when (a) the file is OWNED by the
 * user (ownedByMe filter - never a foreign shared `.dgf`) AND (b) its CONTENT matches the local tab. On a match
 * we set `lastHash` so the immediate sweep dedupe-SKIPS the write (no revision, no clobber). On a mismatch we do
 * NOT adopt - the tab stays unlinked and a later save creates a fresh master (a recoverable duplicate is far
 * safer than silently overwriting a newer remote version). Stale-pointer CLEARING stays with the probe-based
 * reconcileDriveLinks (recently-saved guarded), so a lagged list never false-clears a valid link.
 * Run when a manager opens + before a sign-in sweep. Opportunistic on the token; skips imported/shared-source tabs.
 */
export async function reconcileTabDriveLinks() {
  // Opportunistic: only with a valid token already in hand - never pop a sign-in on a manager open (that would
  // hang/annoy). The sign-in / enableAutosync sweep runs this right after obtaining a token, so the heal still
  // happens; a manager opened before any token shows last-known chips until the next sweep.
  if (!isDriveConfigured() || !tokenValid()) return;
  const token = _accessToken;
  let owned;
  try { owned = await listMyDiagrams(); } catch { return; }
  owned = (owned || []).filter((f) => f && f.ownedByMe !== false && !(f.appProperties && (f.appProperties.dfBackupOf || f.appProperties.dfEditShareOf)));   // own masters only — never a foreign shared file, a My-Drive backup mirror, or a recipient-editable share copy (which shares the master's NAME, so the name-match heal must skip it)
  const allTabs = pctx.getAllTabs ? pctx.getAllTabs() : [];
  // Only the user's OWN-master, content-bearing tabs are candidates: an imported/shared-source tab points at
  // someone else's file (never a My-Drive master), and an empty draft has nothing to link.
  const candidates = [];
  const localData = new Map();
  for (const tab of allTabs) {
    const s = tabState(tab.id);
    if (s.imported || s.sharedSource) continue;
    const data = dataForTab(tab);
    if (!data.graph || !(data.graph.cells && data.graph.cells.length)) continue;
    candidates.push({ id: tab.id, name: data.name, fileId: s.fileId || null });
    localData.set(tab.id, data);
  }
  // item 5: the owned listing already carries each file's `driveId` (set only when the file LIVES on a team Shared
  // Drive). The original open discarded it, so existing tabs read "My Drive" / show no glyph. Capture (or correct)
  // it onto every own-master tab here, so a manager open / sign-in sweep HEALS already-open tabs - no reopen needed.
  const ownedById = new Map(owned.map((f) => [f.id, f]));
  const decisions = reconcileTabFileLinks(candidates, owned, driveFileName);
  let changed = false;
  for (const d of decisions) {
    if (d.action !== 'adopt') continue;   // 'keep' is a no-op; the helper no longer emits 'clear'
    // Decisions are keyed by `tabId` (reconcileTabFileLinks' contract) — NOT `id`. Indexing by the wrong key
    // made `localData.get()` return undefined and `dataHash(undefined)` THROW; because that throw was outside
    // the fetch try/catch it aborted the whole sign-in sweep BEFORE any tab saved (the "tabs not synced on
    // sign-in" bug). The whole body is now guarded so a future shape mismatch degrades to "this tab didn't
    // adopt", never a dead sweep.
    try {
      // CONTENT-VERIFY: read the candidate file and only link when it IS this diagram (same content).
      const res = await fetch(`${API}/${encodeURIComponent(d.fileId)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok) continue;
      const remote = JSON.parse(await res.text());
      if (!remote || !remote.graph) continue;
      const local = localData.get(d.tabId);
      if (!local || dataHash(local) !== dataHash(remote)) continue;   // missing/diverged → do NOT adopt (never clobber a newer remote)
      const s = tabState(d.tabId);
      s.fileId = d.fileId; s.headRevisionId = d.headRevisionId || null; s.modifiedTime = null;
      s.lastHash = dataHash(local); s.imported = false;     // lastHash set → the next sweep dedupe-SKIPS (no write, no revision)
      persistState(d.tabId, s); changed = true;
    } catch { /* one bad decision must never abort the sweep — skip it, keep going */ }
  }
  // Shared-Drive capture pass (item 5): for EVERY own-master tab now linked to a real owned file, sync the tab's
  // driveDriveId to that file's driveId. Runs for adopted AND already-linked tabs, so a tab that was opened before
  // the capture existed (its driveDriveId is null) gets healed and reads "Shared Drive" across every surface.
  for (const tab of candidates) {
    const s = tabState(tab.id);
    if (!s.fileId) continue;
    const f = ownedById.get(s.fileId);
    if (!f) continue;
    const driveId = f.driveId || null;
    if ((s.driveId || null) !== driveId) { s.driveId = driveId; persistState(tab.id, s); changed = true; }
  }
  if (changed) notify();
  return changed;   // the Load pane re-renders ONLY when something changed (kills the double-load flicker)
}

/** Sync EVERY open diagram to Drive (the promise is "all diagrams", not just the active
 *  one). Skips empty tabs so blank drafts don't clutter the Drive folder. Returns count. */
async function syncAllDiagrams() {
  if (!_driveReconcileDone) { _driveReconcileDone = true; await reconcileDriveLinks(); }
  // Adopt existing same-named Drive files for any tab whose link is stale/missing BEFORE the sweep, so a
  // re-save updates the real file instead of spawning a duplicate (and the chips read honestly afterwards).
  await reconcileTabDriveLinks();
  const tabs = pctx.getAllTabs ? pctx.getAllTabs() : [];
  let n = 0;
  for (const tab of tabs) {
    const data = dataForTab(tab);
    if (!data.graph || !(data.graph.cells && data.graph.cells.length)) continue;   // skip empty
    await doSave(tab.id, { interactive: false, data });
    n++;
  }
  // Item 6 — proactive upstream-change detection (shared-source / shared copies / direct-edit). Metadata-only, no
  // writes; extracted into pollUpstreamAll so the recurring idle poll (startUpstreamPoll) runs the SAME checks even
  // when the user is just viewing (the autosave tick only fires after a local edit).
  await pollUpstreamAll();
  return n;
}

/**
 * The metadata-only upstream-change sweep (no writes): for every open tab, has its shared SOURCE, an editable COPY it
 * shared out, or a DIRECT-EDIT shared file it holds gained newer revisions? Each helper flags Refresh/Review and is
 * idempotent (skips already-flagged), so this is safe to run repeatedly. Reuses a live token; never prompts sign-in.
 * Driven by BOTH syncAllDiagrams (after the save sweep) and the recurring idle poll below - the latter closes the
 * "an idle sharer/receiver never polled, so a change only showed after a manual save" gap (screen 4).
 */
let _pollInFlight = false;
async function pollUpstreamAll() {
  // Re-entrancy guard: the recurring interval AND syncAllDiagrams both drive this on the same cadence. Each check
  // reads-then-sets its flag across an `await remoteMeta`, so two overlapping sweeps could both pass the guard for
  // the same copy and double-toast. Serialising them removes that race (a skipped tick just runs next cadence).
  if (_pollInFlight) return;
  const token = tokenValid() ? _accessToken : null;
  if (!token) return;
  _pollInFlight = true;
  try {
    const tabs = pctx.getAllTabs ? pctx.getAllTabs() : [];
    for (const tab of tabs) {
      try {
        await checkSharedSourceUpstream(tab.id, token);
        await checkCopiesUpstream(tab.id, token);
        await checkDirectEditUpstream(tab.id, token);
      } catch { /* per-tab best-effort; one unreadable tab never aborts the sweep */ }
    }
  } finally { _pollInFlight = false; }
}

/**
 * B2 (receiver side): proactively detect when the OWNER or another collaborator changed a Phase-B DIRECT-EDIT shared
 * file under you (s.fileId IS the shared file). upstreamNoticeDecision picks the surface:
 *   - 'conflict' (you have unsaved edits + it moved) → pause + the navbar Review (resolveMasterConflict, diff preview),
 *   - 'notice'   (someone else changed it, you're clean) → a non-blocking "X changed this file" toast + navbar Refresh,
 *   - 'rebase'   (your own save from another device, you're clean) → a quiet Refresh (no toast).
 * s.headRevisionId is the baseline (set at open); a null baseline is seeded silently so only a SUBSEQUENT move flags.
 * s.upstreamChanged / s.upstreamAuthor are RUNTIME-only (re-detected each sweep; never persisted). Best-effort.
 */
async function checkDirectEditUpstream(id, token) {
  const s = driveByTab.get(id);
  if (!s || !s.sharedInEdit || !s.fileId) return;
  let meta = null;
  try { meta = await remoteMeta(s.fileId, token, true); } catch { return; }
  const head = meta && meta.headRevisionId;
  if (!head) return;
  if (s.headRevisionId == null) { s.headRevisionId = head; persistState(id, s); return; }   // baseline silently
  const decision = upstreamNoticeDecision({ headChanged: revisionMoved(s.headRevisionId, head), lastByMe: !!(meta.lastModifyingUser && meta.lastModifyingUser.me), hasLocalEdits: !!s.dirty });
  if (decision === 'none') {
    if (s.upstreamChanged) { s.upstreamChanged = false; s.upstreamAuthor = null; notify(); }
    return;
  }
  if (decision === 'conflict') {
    if (!s.conflict) { s.conflict = true; persistState(id, s); notify(); }   // pause autosave + navbar Review
    return;
  }
  // 'notice' (someone else) or 'rebase' (you, elsewhere) → Refresh available. The author names only the notice case.
  if (!s.upstreamChanged) {
    s.upstreamChanged = true;
    s.upstreamAuthor = decision === 'notice' ? revisionAuthorLabel(meta.lastModifyingUser) : null;
    notify();
    if (decision === 'notice' && id === activeTabId()) showToast(`${s.upstreamAuthor || 'Someone'} changed this file. Refresh to get the latest.`, 'info');
  }
}

/**
 * B2 (sharer side): proactively detect when a RECIPIENT edited a copy you shared - on the cadence sweep instead of
 * only on your NEXT save (the reported "I didn't see their change until I manually saved" gap). For each editable
 * (edit-share) copy whose Drive head moved past what we last pushed, flag `copy.conflict` - the SAME flag
 * fanOutToCopies sets - so the navbar offers Review (resolveCopyConflict, now with the side-by-side diff). Sets the
 * flag only; the user resolves at their pace. Metadata-only GET per copy; best-effort (an unreadable copy is skipped).
 */
async function checkCopiesUpstream(id, token) {
  const s = driveByTab.get(id);
  const copies = (s && s.copies) || [];
  let newlyDiverged = false;
  for (const c of copies) {
    if (!c || c.kind !== 'edit-share' || !c.fileId || c.lastRevisionId == null || c.conflict) continue;
    let head = null;
    try { head = (await remoteMeta(c.fileId, token)).headRevisionId || null; } catch { continue; }
    if (head && revisionMoved(c.lastRevisionId, head)) { c.conflict = true; newlyDiverged = true; }
  }
  if (newlyDiverged) {
    persistState(id, s); notify();
    const tab = (pctx.getAllTabs ? pctx.getAllTabs() : []).find((t) => t && t.id === id);
    showToast(`A diagram you shared was edited${tab && tab.name ? ` - "${tab.name}"` : ''}. Open it and Review to reconcile.`, 'info');
  }
}

/**
 * Has the upstream shared SOURCE (the file a tab was opened from) gained newer revisions than we've seen? Sets
 * `sharedSource.upstreamChanged` so getDriveStatus surfaces the 'refresh' state. `lastRevisionId` is the head we
 * last reconciled with (set on open / push / refresh); a null baseline (a `#gd=` view link never seeded one) is
 * recorded silently on first sight so only a SUBSEQUENT move flags. Best-effort: an unreadable source is skipped.
 */
async function checkSharedSourceUpstream(id, token) {
  const s = driveByTab.get(id);
  const src = s && s.sharedSource;
  if (!src || !src.fileId) return;
  let head = null;
  try { head = (await remoteMeta(src.fileId, token)).headRevisionId || null; } catch { return; }
  if (!head) return;
  if (src.lastRevisionId == null) { src.lastRevisionId = head; persistState(id, s); return; }   // baseline silently
  const changed = revisionMoved(src.lastRevisionId, head);
  if (changed && !src.upstreamChanged) { src.upstreamChanged = true; persistState(id, s); notify(); }
  else if (!changed && src.upstreamChanged) { src.upstreamChanged = false; persistState(id, s); notify(); }
}

// ── Low-level Drive read/write (shared by master-save, copy-create, copy-update) ──
/** Read just the divergence-relevant metadata of a file. Throws a typed Error (`.status`) on failure.
 *  `trashed` + the identity fields (`name`/`mimeType`/`appProperties`) let the once-per-session reconcile tell a
 *  live `.dgf` master from a trashed file (200 + trashed:true, NOT a 404) or a stale pointer at a non-Diagramforce
 *  file (e.g. a leftover legacy `.diagramforce.json`). The divergence callers only read `headRevisionId`, so the
 *  extra fields are inert for them. */
async function remoteMeta(fileId, token, withUser = false) {
  // withUser adds lastModifyingUser (who made the head revision + the `me` flag) for B2's "X changed this file" poll;
  // omitted by default so the hot divergence-check GETs stay minimal.
  const fields = 'headRevisionId,modifiedTime,trashed,name,mimeType,appProperties' + (withUser ? ',lastModifyingUser(displayName,emailAddress,me)' : '');
  const res = await fetch(`${API}/${encodeURIComponent(fileId)}?fields=${fields}&supportsAllDrives=true`, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) { const e = new Error(await readErr(res)); e.status = res.status; throw e; }
  return res.json();   // { headRevisionId, modifiedTime, trashed, name, mimeType, appProperties, lastModifyingUser? }
}

/**
 * The single Drive write path. fileId null ⇒ CREATE (multipart, in target.folderId); else ⇒ in-place
 * media UPDATE. Always returns { id, headRevisionId, modifiedTime } so the caller can re-baseline its
 * divergence tracking. Throws a typed Error (`.status`) on failure so callers map 401 → needs-signin.
 */
async function writeFile(fileId, data, target, token) {
  const jsonStr = JSON.stringify(data);
  const FIELDS = 'id,headRevisionId,modifiedTime';
  // appProperties carry the per-file metadata the library lists WITHOUT reading each file's bytes:
  // dfType (the per-type icon) + dfShapes (the "N elements" count). Values must be strings. Both are sent on
  // every write — including in-place updates — via multipart so the count stays fresh as the diagram changes.
  // Callers may merge EXTRA appProperties via target.appProperties (e.g. a My-Drive backup tags itself dfBackupOf
  // so the Load list can hide it). Drive PATCH MERGES appProperties, so a tag set on CREATE survives in-place updates.
  const appProperties = { dfType: data.type || 'architecture', dfShapes: String(countDiagramShapes(data.graph?.cells)), ...(target && target.appProperties ? target.appProperties : {}) };
  const boundary = 'df_' + Math.abs(hashStr(jsonStr)).toString(36);
  let res;
  if (fileId) {
    // In-place UPDATE: appProperties-ONLY metadata (no name/mimeType/parents) so a file the user renamed or
    // moved in Drive keeps its name/location — only the bytes + the count/type refresh.
    res = await fetch(`${UPLOAD}/${encodeURIComponent(fileId)}?uploadType=multipart&fields=${FIELDS}&supportsAllDrives=true`, {
      method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + boundary },
      body: multipartBody({ appProperties }, jsonStr, boundary),
    });
  } else {
    // CREATE: custom vendor MIME (set pre-prod, before any files exist) → reliable Drive "Open with" matching +
    // makes Diagramforce the default opener (not Drive's JSON viewer). The bytes are still JSON; the anonymous
    // public read (alt=media) is MIME-agnostic.
    const metadata = { name: driveFileName(data.name), mimeType: DGF_MIME, appProperties };
    if (target && target.folderId) metadata.parents = [target.folderId];
    res = await fetch(`${UPLOAD}?uploadType=multipart&fields=${FIELDS}&supportsAllDrives=true`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + boundary }, body: multipartBody(metadata, jsonStr, boundary),
    });
  }
  if (!res.ok) { const e = new Error(await readErr(res)); e.status = res.status; throw e; }
  return res.json();
}

// ── The save engine (create first time, in-place update after) ───────────────
// interactive=true  → menu/Save-now: may pop the Google consent dialog + the Pull/Keep/Fork modal + toasts.
// interactive=false → autosave/flush: NEVER pops a dialog — on divergence it PAUSES (sets s.conflict) instead.
// flush=true        → tab close/hide: silent like autosave, but DOES fan out to shared copies.
async function doSave(id, { interactive, flush = false, data: dataOverride } = {}) {
  const s = tabState(id);
  if (s.saving) return;
  // A diagram OPENED from a share link (imported) is someone else's file the user may only be able to read —
  // automatic saves must NEVER push to it (that would 403 for a View share, or silently overwrite the sender's
  // master). Auto-save / sync-all / flush skip it; only an explicit (interactive) save attempts a write.
  if (!interactive && s.imported) { s.dirty = false; notify(); return; }
  // Snapshot the graph SYNCHRONOUSLY (before any await) so a tab switch mid-save can't capture the
  // wrong tab's content — pctx.graph always reflects the ACTIVE tab. dataOverride lets "sync all
  // diagrams" save a NON-active tab from its stored graph.
  const data = dataOverride || currentDiagramData();
  const jsonStr = JSON.stringify(data);   // the full body written to Drive (includes viewport)
  // Dedupe on CONTENT only — graph + name + type + mappingMode, NOT the viewport. A pan/zoom changes the
  // viewport but not the diagram; hashing the whole payload made every pan-then-save spawn a new Drive
  // revision. The viewport still rides along in the body (so it's restored) — it just doesn't, alone, save.
  const hash = hashStr(JSON.stringify({ g: data.graph, n: data.name, t: data.type, m: data.mappingMode }));

  // Content-hash dedupe — skip the MASTER write (and the divergence GET below) entirely if nothing changed
  // since the last save. Only meaningful once a file exists. BUT the fan-out targets (shared copies + the
  // upstream Shared File source) may still be behind — e.g. the master already autosaved this change on a
  // periodic tick (which doesn't fan out). So on an interactive save / flush, still push to those targets even
  // when the master itself is up to date, so "Edit access writes back to the source" isn't starved by the tick.
  if (s.fileId && s.lastHash === hash) {
    s.dirty = false;
    pctx.onDriveTabSaved?.(id);   // content matches Drive → this tab is in sync; clear its UI dirty dot
    // The master is already up to date, but two things may still be missing: a Shared-Drive file's private My-Drive
    // backup (created lazily + one-time), and the fan-out to shared copies / the upstream source (the tick that
    // synced the master doesn't fan out). Do both when a token is in hand - the sweep reuses its cached token; an
    // interactive save may prompt. Without this, the backup is starved: the tick keeps the master in sync, so every
    // interactive/flush save dedupe-skips here and never reaches the write-success backup call.
    const needsFanOut = shouldFanOut({ interactive, flush }) && (s.copies.length || (s.sharedSource && s.sharedSource.fileId));
    if (s.driveId || needsFanOut) {
      let tok = tokenValid() ? _accessToken : null;
      if (!tok && interactive) { try { tok = await getToken({ prompt: '' }); } catch { tok = null; } }
      if (tok) {
        await ensureMyDriveBackup(id, data, tok);   // no-op unless this is a Shared-Drive file missing its backup
        if (needsFanOut) await fanOutAll(id, data, tok, interactive);
      }
    }
    notify();
    if (interactive) showToast('Already up to date ✓', 'info');
    return;
  }

  let token = tokenValid() ? _accessToken : null;
  if (!token) {
    if (!interactive) { s.needsSignin = true; notify(); return; }   // autosave never pops a dialog
    // prompt:'' — GIS shows consent only on the genuine FIRST grant and skips it once Google remembers it
    // (forcing 'consent' re-prompted the grant after every reload/token lapse — the reported re-auth bug).
    try { token = await getToken({ prompt: '' }); }
    catch (e) {
      if (/access_denied|popup|closed|cancel/i.test(e.message)) { showToast('Google sign-in cancelled.', 'info'); return; }
      showError(e.message); return;
    }
  }

  // Pre-save lost-update guard: did the MASTER move on Drive since our last sync (another device)?
  // We only reach here with a real local change to push (dedupe above), so the GET is well-bounded.
  if (s.fileId && s.headRevisionId) {
    let remote = null;
    try {
      remote = await remoteMeta(s.fileId, token);
    } catch (e) {
      // 401 → re-auth prompt.
      if (e && e.status === 401) { _accessToken = null; s.needsSignin = true; notify(); if (interactive) showError('Google sign-in expired - click the Drive icon to sign in again.'); return; }
      // 404/403 = the master is GONE (trashed/deleted in Drive, or access lost). Don't defer forever (which would
      // leave the diagram permanently "synced" but absent) — clear the dead link and fall through to a fresh
      // CREATE, the same self-heal the write-path catch does. (`healDecision` only recreates for an own master.)
      if (healDecision(e && e.status, { imported: !!s.imported }) === 'recreate') {
        s.fileId = null; s.headRevisionId = null; s.modifiedTime = null; s.lastHash = null;
      } else {
        // FAIL CLOSED on anything else (network blip / 5xx / 429): we could NOT verify the remote base, so we must
        // NOT overwrite — that would be the silent cross-device clobber this guard prevents. Defer; next save retries.
        if (interactive) showError('Could not check the latest version on Google Drive - please try again.');
        return;
      }
    }
    if (remote && revisionMoved(s.headRevisionId, remote.headRevisionId)) {
      if (!interactive) { s.conflict = true; notify(); return; }   // autosave/flush pause — no silent clobber
      const proceed = await resolveMasterConflict(id, data, hash, token);
      if (proceed !== 'keep') return;   // pull/fork handled inside; dismiss aborts. 'keep' falls through to overwrite.
    }
  }

  s.saving = true; s.needsSignin = false; _savingCount++; notify();   // _savingCount drives the navbar spin for ANY tab
  try {
    const folderId = s.fileId ? null : await ensureFolder(token);   // the master always lives in My Drive
    const wasNew = !s.fileId;
    // On CREATE of a tab opened FROM a shared source, the new file is the recipient's own editable working copy of
    // that shared diagram. Stamp the upstream source id so the Load list can collapse the working copy + the original
    // to ONE row even after this tab is closed (when the open-tab linkage is gone). writeFile merges appProperties and
    // Drive PATCH preserves them, so it survives in-place updates.
    const sharedFromProps = (wasNew && s.sharedSource && s.sharedSource.fileId)
      ? { appProperties: { dfSharedFrom: s.sharedSource.fileId, dfSharedEdit: s.sharedSource.canEdit ? '1' : '0' } }
      : null;
    const meta = await writeFile(s.fileId, data, { folderId, ...(sharedFromProps || {}) }, token);
    s.saving = false; _savingCount = Math.max(0, _savingCount - 1);
    s.fileId = meta.id; s.headRevisionId = meta.headRevisionId || null; s.modifiedTime = meta.modifiedTime || null;
    s.dirty = false; s.conflict = false; s.lastSavedAt = Date.now(); s.lastHash = hash;
    persistState(id, s); notify();
    pctx.onDriveTabSaved?.(id);   // this tab's content reached Drive → clear its UI dirty dot (any tab, not just active)
    if (interactive) showToast(wasNew ? 'Now syncing to Google Drive ✓' : 'Synced to Google Drive ✓', 'success');
    // A Shared-Drive-resident file ALSO gets a private My-Drive backup mirror (if missing) so it's in the user's own
    // Drive too. Run it on EVERY successful write - NOT under shouldFanOut - because the interactive/flush path is
    // rarely reached for a file the cheap autosync tick keeps in sync (the next interactive save then dedupe-skips).
    // The backup's own guards make it a no-op for non-Shared-Drive files and a one-time create otherwise.
    await ensureMyDriveBackup(id, data, token);
    // Fan out to shared copies + the upstream Shared File source — only on interactive saves + the close/hide
    // flush (not the autosave tick). The user's own master above is always saved regardless.
    if (shouldFanOut({ interactive, flush })) {
      await fanOutAll(id, data, token, interactive);
    }
  } catch (err) {
    s.saving = false; _savingCount = Math.max(0, _savingCount - 1);
    if (err && err.status === 401) { _accessToken = null; s.needsSignin = true; notify(); if (interactive) showError('Google sign-in expired - click the Drive icon to sign in again.'); return; }
    // Self-heal a dead/inaccessible OWN master: a 404 (file trashed/deleted in Drive) or 403 (we lost access
    // to a file we created — e.g. a prior OAuth grant) means the stored fileId is a dead link. Rather than fail
    // forever and keep showing a false "synced", clear the link and retry ONCE as a CREATE so the user's work
    // lands as a fresh master. `_healing` guards against an infinite loop if the CREATE also fails.
    if (!s._healing && healDecision(err && err.status, { imported: !!s.imported }) === 'recreate') {
      s._healing = true;
      s.fileId = null; s.headRevisionId = null; s.modifiedTime = null; s.lastHash = null;
      persistState(id, s); notify();
      try { return await doSave(id, { interactive, flush, data }); }
      finally { s._healing = false; }
    }
    notify();
    console.error('Diagramforce: Sync to Drive failed:', err);
    if (interactive) showError('Could not sync to Google Drive: ' + (err?.message || 'see console for details.'));
  }
}

// ── Divergence resolution: the Pull / Keep / Fork modal + its outcomes ────────
/** Generic 3-way conflict dialog. Resolves to 'pull' | 'keep' | 'fork' | null (dismissed).
 *  Takes the BA-friendly `conflictActions(...)` object: an `intro` (the situation, in plain words) plus a
 *  label + a one-line `*Desc` consequence for each option, rendered as a list so a non-technical user can see
 *  what each button does before clicking. `summaryHtml` is still honoured as a fallback for any older caller. */
function showConflictModal({ title, intro, summaryHtml, pullLabel, pullDesc, keepLabel, keepDesc, forkLabel, forkDesc, localPreview = null, remotePreview = null }) {
  return new Promise((resolve) => {
    let result = null;
    // The three options are a SELECTION (radio), not instant actions: picking one highlights the preview card(s) it
    // will USE, then Cancel / Confirm at the bottom act on the choice. `uses` = which side(s) survive: keep → yours,
    // fork → both, pull → the Google Drive version. Order keep · fork · pull.
    const opts = [
      { act: 'keep', label: keepLabel, desc: keepDesc, uses: 'local' },
      { act: 'fork', label: forkLabel, desc: forkDesc, uses: 'local remote' },
      { act: 'pull', label: pullLabel, desc: pullDesc, uses: 'remote' },
    ].filter((o) => o.label);
    // Grid tracks the ACTUAL option count (a refresh dialog drops "Keep mine" → 2 columns, not a gap in a fixed 3).
    const optsHtml = opts.length
      ? `<div class="df-conflict__opts" role="radiogroup" style="grid-template-columns:repeat(${opts.length},1fr)">${opts.map((o) => `<button type="button" class="df-conflict__opt" role="radio" aria-checked="false" data-act="${o.act}" data-uses="${o.uses}"><strong>${o.label}</strong>${o.desc ? `<span>${o.desc}</span>` : ''}</button>`).join('')}</div>`
      : '';
    // Phase C: side-by-side preview cards (yours vs Google Drive) - a diff-highlighted thumbnail (green=added,
    // amber=changed) + author · time · shape count, so the choice is informed. Only when BOTH previews are supplied
    // AND the thumbnail renderer is wired (it degrades to the text-only modal otherwise - e.g. an unreadable remote).
    const hasPreview = !!(localPreview && remotePreview && pctx.renderThumbnail);
    const shapesLabel = (n) => `${n || 0} shape${(n || 0) === 1 ? '' : 's'}`;
    const cardHtml = (key, head, p) => `
      <div class="df-conflict__card" data-card="${key}">
        <div class="df-conflict__card-head">${escHtml(head)}</div>
        <div class="df-conflict__thumb" data-thumb="${key}"></div>
        <div class="df-conflict__card-meta">${escHtml(p.by || '')}${p.by && p.when ? ' · ' : ''}${escHtml(p.when || '')}<br><strong>${shapesLabel(p.shapes)}</strong></div>
      </div>`;
    const previewHtml = hasPreview
      ? `<div class="df-conflict__preview">${cardHtml('local', 'Your diagram', localPreview)}${cardHtml('remote', 'Google Drive diagram', remotePreview)}</div>`
      : '';
    const { body, footer, close } = buildModal({
      title, className: 'df-conflict-modal', width: hasPreview ? '560px' : '500px', zIndex: 10001, showClose: false,
      bodyStyle: 'padding:16px 20px',
      bodyHtml: `<p style="margin:0 0 14px;color:var(--text-secondary);line-height:1.5">${intro || summaryHtml || ''}</p>${previewHtml}${optsHtml}`,
      // Confirm is brand-amber (--accent, filled, dark text), not blue: resolving a conflict is a significant,
      // potentially-overwriting action, so it reads as elevated. Disabled until an option is picked.
      footerHtml: '<button class="df-modal__btn" data-act="cancel" style="margin-right:auto">Cancel</button>' +
        '<button class="df-modal__btn df-modal__btn--accent" data-act="confirm" disabled>Confirm</button>',
      onClose: () => resolve(result),   // Esc / backdrop / Cancel → null (decide later; the conflict stays on the navbar)
    });
    if (hasPreview) {
      for (const [key, p] of [['local', localPreview], ['remote', remotePreview]]) {
        const slot = body.querySelector(`[data-thumb="${key}"]`);
        if (!slot) continue;
        try { slot.appendChild(pctx.renderThumbnail({ cells: (p.graph && p.graph.cells) || [] }, 150, 96, p.diff)); }
        catch { /* preview is best-effort; the choice still works without it */ }
      }
    }
    let selected = null;
    const confirmBtn = footer.querySelector('[data-act="confirm"]');
    body.querySelectorAll('.df-conflict__opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        selected = btn.dataset.act;
        const uses = (btn.dataset.uses || '').split(' ');
        body.querySelectorAll('.df-conflict__opt').forEach((b) => { const on = b === btn; b.classList.toggle('is-selected', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
        body.querySelectorAll('.df-conflict__card').forEach((c) => c.classList.toggle('is-selected', uses.includes(c.dataset.card)));
        confirmBtn.disabled = false;
      });
    });
    confirmBtn.addEventListener('click', () => { if (selected) { result = selected; close(); } });
    footer.querySelector('[data-act="cancel"]').addEventListener('click', () => { result = null; close(); });
  });
}

/**
 * The MASTER changed on another device. Ask Pull / Keep / Fork. Returns 'keep' to tell doSave to
 * overwrite the remote with local; 'pull'/'fork'/null are handled here (doSave then aborts its write).
 */
/**
 * Open Drive `data` as a NEW tab linked to the master `fileId`, then unlink the ORIGINAL tab (it becomes a
 * local-only backup of whatever it held). The single path for "the Drive content becomes your working tab;
 * your prior content stays as a backup" — shared by the master-conflict *pull* and a revision *restore*.
 * Runs the untrusted-source chain (sanitize → version-check → onImport). Returns true on success, false if
 * the version-warning was declined. The import model always spawns a NEW tab, which is why we transfer the
 * linkage rather than mutate the old tab in place. `alreadyValidated` lets a caller that MUST sanitize +
 * version-check BEFORE its own irreversible step (e.g. restore's writeFile) do so without a double prompt.
 */
async function adoptDriveFileIntoNewTab({ oldTabId, data, fileId, copies, label, token, alreadyValidated = false }) {
  if (!data || !data.graph || !data.type) throw new Error('unreadable');
  if (!alreadyValidated) {
    pctx.sanitizeGraphJSON(data.graph);
    const ok = await pctx.checkVersionWarning(data.av || null, data.name || label || 'Diagram', data);
    if (!ok) return false;
  }
  // #7: keep a pulled/restored diagram in its tab group (the .dgf carries the group meta written at save time).
  pctx.onImport(label || data.name || 'Diagram', pctx.normalizeDiagramType(data.type), data.graph, data.viewport || null, data.mappingMode, null, data.group || null);
  const newId = activeTabId();
  const ns = tabState(newId);
  ns.fileId = fileId; ns.imported = true; ns.copies = copies || []; ns.dirty = false; ns.conflict = false; ns.lastHash = null;
  try { ns.headRevisionId = (await remoteMeta(fileId, token)).headRevisionId || null; } catch { /* baseline optional */ }
  persistState(newId, ns);
  if (oldTabId && oldTabId !== newId) clearTabDriveState(oldTabId);   // original tab → local-only backup
  notify();
  return true;
}

/** Phase C: build the Review modal's two preview cards. Fetches the REMOTE version's content + its head-revision
 *  author/date, and diffs each side against the other so the thumbnails highlight what's added/changed. Best-effort:
 *  returns {} on any failure, so the modal degrades to the text-only options. */
async function buildConflictPreviews({ localData, remoteFileId, token, localBy = 'you', localWhen = 'just now', remoteByFallback = null }) {
  try {
    const remoteData = await fetchGraphAuthed(remoteFileId);
    if (!remoteData || !remoteData.graph || !localData || !localData.graph) return {};
    let by = remoteByFallback, when = '';
    try {
      const res = await fetch(`${API}/${encodeURIComponent(remoteFileId)}?fields=modifiedTime,lastModifyingUser(displayName,emailAddress,me)&supportsAllDrives=true`, { headers: { Authorization: 'Bearer ' + token } });
      if (res.ok) { const m = await res.json(); by = revisionAuthorLabel(m.lastModifyingUser) || by; when = formatRelativeTime(Date.parse(m.modifiedTime)) || ''; }
    } catch { /* meta is best-effort */ }
    const lg = localData.graph, rg = remoteData.graph;
    // Two-card Review: each card highlights its own added + changed. Drop removedCells - a cell removed here is the
    // OTHER card's `added`, so ghosting it would double-show the same shape (green on one card, red ghost on the other).
    const noGhost = (d) => ({ added: d.added, removed: d.removed, changed: d.changed });
    return {
      localPreview: { graph: lg, shapes: countDiagramShapes(lg.cells), by: localBy, when: localWhen, diff: noGhost(diffGraphs(rg, lg)) },
      remotePreview: { graph: rg, shapes: countDiagramShapes(rg.cells), by, when, diff: noGhost(diffGraphs(lg, rg)) },
    };
  } catch { return {}; }
}

async function resolveMasterConflict(id, localData, localHash, token) {
  const s = tabState(id);
  const preview = await buildConflictPreviews({ localData, remoteFileId: s.fileId, token });
  const choice = await showConflictModal({ ...conflictActions('master'), ...preview });
  if (choice === 'pull') {
    try {
      const data = await fetchGraphAuthed(s.fileId);
      if (!data || !data.graph || !data.type) { showError('Could not load the Google Drive version.'); return null; }
      if (id === activeTabId() && pctx.onReplaceActive) {
        // B3: "Keep Google Drive" replaces YOUR screen with the Drive version IN PLACE (one tab), not a new tab.
        // The user explicitly chose Drive's over theirs (Keep both is the keep-yours option); the tab stays linked
        // to the same file + re-baselines so the next edit saves cleanly on top.
        pctx.sanitizeGraphJSON(data.graph);
        const ok = await pctx.checkVersionWarning(data.av || null, data.name || 'Diagram', data);
        if (!ok) return null;
        pctx.onReplaceActive(data.name || 'Diagram', pctx.normalizeDiagramType(data.type), data.graph, data.viewport || null, data.mappingMode);
        s.conflict = false; s.dirty = false; s.lastHash = null;
        try { s.headRevisionId = (await remoteMeta(s.fileId, token)).headRevisionId || null; } catch { s.headRevisionId = null; }
        persistState(id, s); notify();
        showToast('Switched to the Google Drive version ✓', 'success');
      } else {
        // Non-active tab (rare) → fall back to a new tab so we never replace the wrong canvas.
        const ok = await adoptDriveFileIntoNewTab({ oldTabId: id, data, fileId: s.fileId, copies: s.copies, label: `${(data && data.name) || 'Diagram'} (Drive)`, token });
        if (ok) showToast('Loaded the Google Drive version into a new tab ✓', 'success');
      }
    } catch { showError('Could not load the Google Drive version.'); }
    return null;
  }
  if (choice === 'fork') {
    try {
      const meta = await writeFile(null, localData, { folderId: await ensureFolder(token) }, token);
      s.fileId = meta.id; s.headRevisionId = meta.headRevisionId || null; s.modifiedTime = meta.modifiedTime || null;
      s.conflict = false; s.dirty = false; s.lastHash = localHash; s.lastSavedAt = Date.now();
      persistState(id, s); notify();
      showToast('Saved as a new Google Drive diagram ✓', 'success');
    } catch { showError('Could not save a new copy to Google Drive.'); }
    return null;
  }
  if (choice === 'keep') { s.conflict = false; return 'keep'; }   // doSave overwrites the remote
  return null;                                                    // dismissed → leave as-is
}

/**
 * Push the master to each shared copy — "push but never clobber". For each copy, compare its head
 * revision to what we last pushed: unchanged → overwrite with the master; changed (the recipient
 * edited it) → flag it conflicted (surfaced in the Share Manager + the navbar) and DON'T overwrite.
 */
/** A file that LIVES on a team Shared Drive (s.driveId set) is not in the user's personal My Drive. Mirror it into
 *  My Drive as a PRIVATE backup copy (kind:'mydrive-backup', tagged dfBackupOf so the Load list hides it) so the
 *  "every diagram → your Google Drive" promise holds + they keep a copy if they lose Shared-Drive access. Created
 *  ONCE (when missing); thereafter it's a normal fan-out copy that the save sweep keeps current. Best-effort: a
 *  failure just leaves it to the next interactive save. The Shared-Drive file stays the MAIN (edits save there). */
async function ensureMyDriveBackup(id, data, token) {
  const s = tabState(id);
  // A backup mirror is for a master that ISN'T in the user's own My Drive: a team Shared-Drive file (s.driveId) OR a
  // Phase-B direct-edit shared file (s.sharedInEdit - foreign-owned but writable). Both risk loss of access, so we
  // keep a private My-Drive copy. An own My-Drive master needs none.
  if ((!s.driveId && !s.sharedInEdit) || !s.fileId) return;
  if ((s.copies || []).some((c) => c && c.kind === 'mydrive-backup')) return;     // already mirrored
  try {
    const folderId = await ensureFolder(token);
    const meta = await writeFile(null, data, { folderId, appProperties: { dfBackupOf: s.fileId } }, token);
    s.copies = upsertCopy(s.copies, { fileId: meta.id, kind: 'mydrive-backup', label: 'My Drive backup', lastRevisionId: meta.headRevisionId || null, lastPushedAt: Date.now(), conflict: false });
    persistState(id, s); notify();
  } catch (e) { console.warn('Diagramforce: My-Drive backup create failed', e); }   // retry on the next save
}

async function fanOutToCopies(id, data, token, interactive) {
  const s = tabState(id);
  let changed = false;
  for (const copy of s.copies) {
    let remote = null;
    try { remote = await remoteMeta(copy.fileId, token); } catch { continue; }   // unreadable now → try next time
    // A My-Drive backup is a PRIVATE one-way mirror (the user never edits it directly), so always overwrite it -
    // skip the recipient-edited conflict guard that protects genuine shared copies from a clobber.
    if (copy.kind !== 'mydrive-backup' && revisionMoved(copy.lastRevisionId, remote.headRevisionId)) {
      if (!copy.conflict) { copy.conflict = true; changed = true; }               // recipient edited → never clobber
      continue;
    }
    try {
      const meta = await writeFile(copy.fileId, data, null, token);
      copy.lastRevisionId = meta.headRevisionId || null; copy.lastPushedAt = Date.now(); copy.conflict = false; changed = true;
    } catch { /* leave for the next fan-out */ }
  }
  if (changed) { persistState(id, s); notify(); }
  if (interactive && s.copies.some((c) => c.conflict)) showToast('A shared copy was edited - open Share to review.', 'info');
}

/** Push the just-saved master out to ALL downstream/upstream Drive targets: the user's published shared COPIES
 *  and the upstream Shared File SOURCE. Called only on interactive saves + the close/hide flush (shouldFanOut),
 *  including from the dedupe path so a target that's behind the master still catches up. */
async function fanOutAll(id, data, token, interactive) {
  const s = tabState(id);
  if (s.copies.length) await fanOutToCopies(id, data, token, interactive);
  if (s.sharedSource && s.sharedSource.fileId) await pushToSharedSource(id, data, token, interactive);
}

/** Does the signed-in user have WRITER permission on a file? Used to decide whether edits to a tab opened from
 *  a `#gd=` share may be pushed back to the upstream source. Returns false on any read error (fail safe). */
async function canEditFile(fileId, token) {
  try {
    const res = await fetch(`${API}/${encodeURIComponent(fileId)}?fields=capabilities(canEdit)&supportsAllDrives=true`, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return false;
    const j = await res.json();
    return !!(j.capabilities && j.capabilities.canEdit);
  } catch { return false; }
}

/**
 * Shared File fan-out: push the user's edits BACK to the upstream file the diagram was opened from — but only
 * when they have writer permission (a View share never touches the sender's file) and the source hasn't moved
 * under them ("push but never clobber", like copies). The user's own My Drive master is always saved separately
 * (doSave above); this is the optional write-back to the shared source. Permission is detected lazily + cached.
 */
async function pushToSharedSource(id, data, token, interactive) {
  const s = tabState(id);
  const src = s.sharedSource;
  if (!src || !src.fileId) return;
  if (src.canEdit == null) { src.canEdit = await canEditFile(src.fileId, token); persistState(id, s); notify(); }
  let moved = false;
  if (src.canEdit && src.lastRevisionId) {
    let remote = null;
    try { remote = await remoteMeta(src.fileId, token); } catch { return; }   // unreadable now → try next time
    moved = revisionMoved(src.lastRevisionId, remote.headRevisionId);
  }
  const decision = sharedSourcePushDecision({ canEdit: !!src.canEdit, moved });
  if (decision === 'skip-readonly') return;                       // view-only: edits live in My Drive only
  if (decision === 'flag-conflict') {
    if (!src.conflict) { src.conflict = true; persistState(id, s); notify(); }
    if (interactive) showToast('The shared file changed - use Refresh to pull the latest before it syncs back.', 'info');
    return;
  }
  try {
    const meta = await writeFile(src.fileId, data, null, token);
    src.lastRevisionId = meta.headRevisionId || null; src.lastPushedAt = Date.now(); src.conflict = false;
    persistState(id, s); notify();
  } catch { /* leave for the next push */ }
}

/** Menu "Save to Google Drive" / navbar click — interactive (may prompt) + toasts. */
export async function saveToDrive() {
  if (!isDriveConfigured()) { showError('Google Drive is not configured for this origin.'); return; }
  if (!pctx.graph) return;
  return doSave(activeTabId(), { interactive: true });
}

/** "Enable sync" — interactive sign-in, turn auto-sync on, and sync ALL open diagrams now
 *  (the promise is every diagram, not just the active one). */
export async function enableAutosync() {
  if (!isDriveConfigured()) { showError('Google Drive is not configured for this origin.'); return; }
  try { await getToken({ prompt: '' }); }   // prompt:'' — consent only on first grant; no re-prompt after reload
  catch (e) { if (!/access_denied|popup|closed|cancel/i.test(e.message)) showError(e.message); return; }
  localStorage.setItem(LS.autosync, '1');
  notify();
  _driveReconcileDone = false;   // a fresh connect re-checks Drive state (catches files deleted/moved out-of-band)
  try {
    const n = await syncAllDiagrams();
    showToast(`Auto-sync on - ${n} diagram${n === 1 ? '' : 's'} synced to Google Drive ✓`, 'success');
  } catch (err) {
    console.error('Diagramforce: initial sync-all failed:', err);
    showError('Auto-sync is on, but the initial sync hit an error - see console.');
  }
  try { await pctx.templatesBackupApi?.syncWithDrive?.(); } catch { /* templates sync is best-effort */ }
}
export function disableAutosync() {
  localStorage.setItem(LS.autosync, '0');
  if (_autosaveTimer) { clearTimeout(_autosaveTimer); _autosaveTimer = null; }
  notify();
}

/** Fully DISCONNECT Google Drive (the user is done with it / wants out of the red re-auth loop): forget the
 *  token + auto-sync AND clear every tab's Drive link, so the app reverts to the grey "not connected" state.
 *  The user's files stay untouched in their Drive - reconnecting + saving (or opening from the Drive library)
 *  re-establishes the links. */
export function disconnectDrive() {
  _accessToken = null; _tokenExpiry = 0;
  localStorage.setItem(LS.autosync, '0');
  if (_autosaveTimer) { clearTimeout(_autosaveTimer); _autosaveTimer = null; }
  stopUpstreamPoll();
  _driveReconcileDone = false;   // a future reconnect re-checks Drive state from scratch
  for (const id of [...driveByTab.keys()]) clearTabDriveState(id);   // clearTabDriveState persists + we notify below
  notify();
}

/** Re-authorise after the ~1 h token lapses (clicking the red icon). Usually no consent
 *  screen — Google remembers the grant. Resumes auto-sync of all diagrams on success. */
export async function signIn() {
  try { await getToken({ prompt: '' }); }
  catch (e) { if (!/access_denied|popup|closed|cancel/i.test(e.message)) showError(e.message); return; }
  notify();
  // A fresh sign-in always re-checks Drive state and syncs everything not in sync (the user's expectation on
  // login), not only when auto-sync is already on. Reset the once-per-session reconcile guard so the dead-link
  // probe re-runs — this is what recreates masters whose files were deleted/trashed in Drive while we were away.
  _driveReconcileDone = false;
  try { await syncAllDiagrams(); } catch (err) { console.error('Diagramforce: resume sync failed:', err); }
  try { await pctx.templatesBackupApi?.syncWithDrive?.(); } catch { /* templates sync is best-effort */ }
}

// ── Autosave (Phase 2 + redesign) ────────────────────────────────────────────
let _autosaveTimer = null;
let _hiddenFlushWired = false;
function wireHiddenFlush() {
  if (_hiddenFlushWired) return;
  _hiddenFlushWired = true;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDriveSave(); });
}

// Schedules a save `cadence` ms after the FIRST unsaved edit (periodic, not per-keystroke
// debounce) so a long editing burst still gets saved on the cadence. 'onclose' = only flush.
// The tick sweeps EVERY open non-empty tab (syncAllDiagrams), not just the active one — the user's
// directive is "every open diagram is saved to My Drive when connected". The per-tab content-hash
// dedupe (doSave) means only genuinely-changed tabs actually write, so the sweep stays quota-cheap.
// Recurring metadata-only upstream poll, INDEPENDENT of edits + the auto-sync toggle. The autosave setTimeout only
// arms on a local edit, so an idle sharer/receiver never detected an upstream change until their next manual save
// (screen 4). This interval runs pollUpstreamAll every cadence while connected; it only READS metadata (no writes,
// no sign-in prompt) and each check is idempotent, so it's quota-cheap and never spams. Started on token success,
// cleared on disconnect (mirrors _autosaveTimer's lifecycle).
let _upstreamPollTimer = null;
function startUpstreamPoll() {
  if (_upstreamPollTimer) return;
  _upstreamPollTimer = setInterval(() => { void pollUpstreamAll(); }, CADENCE_DEFAULT);
}
function stopUpstreamPoll() {
  if (_upstreamPollTimer) { clearInterval(_upstreamPollTimer); _upstreamPollTimer = null; }
}

function scheduleAutosave() {
  if (_autosaveTimer) return;
  // Single fixed cadence now (the picker was removed for one 2-min default + always-on work-ending saves). Ignore
  // any STALE df.gdrive.cadence value a pre-update session may have stored (30000 / 300000 / 'onclose').
  const ms = CADENCE_DEFAULT;
  _autosaveTimer = setTimeout(() => {
    _autosaveTimer = null;
    void syncAllDiagrams();
  }, ms);
}

/** Called by tabs.js on each REAL graph edit. Marks the active tab dirty; auto-saves it
 *  on the cadence when auto-sync is on (lazy-creating its Drive file on first write). */
export function notifyDriveChange() {
  const id = activeTabId();
  const s = tabState(id);
  const auto = isAutosyncOn();
  if (!auto && !s.fileId) return;     // not tracked & auto-sync off → ignore
  s.dirty = true; notify();
  if (!auto) return;                  // manual mode: reflect "unsaved", but don't auto-write
  scheduleAutosave();
  wireHiddenFlush();
}

/** Flush a pending auto-save NOW (tab switch / page hide). No dialog. INDEPENDENT of the auto-sync toggle: a work
 *  boundary must never lose the active tab's edits, so it flushes whenever a token is live + the tab is dirty - even
 *  in manual Drive mode (where the periodic tick is off). Unlike the tick, the flush DOES fan out to shared copies. */
export function flushDriveSave() {
  if (_autosaveTimer) { clearTimeout(_autosaveTimer); _autosaveTimer = null; }
  const id = activeTabId();
  const s = driveByTab.get(id);
  // Return the in-flight save promise so callers that care (e.g. the Save & Export manager opening on the active
  // tab) can re-read the chips AFTER the flush sets/creates the file — otherwise the active row's "My Drive" chip
  // lags one open. Fire-and-forget callers (tab switch, visibilitychange) just ignore the return.
  if (s && s.dirty && !s.saving && _accessToken) return doSave(id, { interactive: false, flush: true });
  return Promise.resolve();
}

/** Save a SPECIFIC tab to My Drive NOW - independent of the auto-sync toggle + the dirty flag - for the work
 *  boundaries the user expects to never lose work: opening a non-empty diagram, and closing a tab. (Switch uses
 *  flushDriveSave on the still-active outgoing tab.) Passes the tab's OWN data via dataForTab, so a background
 *  (non-active) close saves its own content, not the active graph. No-op when not signed in / no token (boundaries
 *  never pop a sign-in), the tab is empty, or it's already in sync (doSave's hash dedupe skips the write). */
export function saveTabNow(id) {
  if (!_accessToken) return Promise.resolve();                    // connected-only; never prompts at a boundary
  const tab = (pctx.getAllTabs ? pctx.getAllTabs() : []).find((t) => t && t.id === id);
  if (!tab) return Promise.resolve();
  const s = driveByTab.get(id);
  if (s && s.saving) return Promise.resolve();
  // Mode C: an un-forked VIEW (Copy) share (sharedSource set, no own master yet) mints NOTHING at a boundary - it
  // forks only on a real EDIT (forkSharedViewOnEdit). Without this, opening/closing a view you only LOOKED at would
  // re-create the orphan working copy A1 deliberately removed.
  if (s && s.sharedSource && s.sharedSource.fileId && !s.fileId) return Promise.resolve();
  // A clean tab already linked to Drive (e.g. you just OPENED a synced master) needs no write - skip the redundant
  // boundary PATCH that would otherwise spend an API call + a Drive revision on every open of an unchanged file. A
  // NEW import (no fileId) or a DIRTY tab still saves (that's the whole point of the boundary).
  if (s && s.fileId && !tab.dirty) return Promise.resolve();
  const data = dataForTab(tab);
  if (!data || !data.graph || !(data.graph.cells && data.graph.cells.length)) return Promise.resolve();   // skip empty
  return doSave(id, { interactive: false, flush: true, data }).catch(() => {});
}

/** Manual one-shot "Sync now": push EVERY open non-empty tab to My Drive immediately, WITHOUT turning on auto-sync -
 *  for a user in manual Drive mode who wants a full sync on demand (and may not know the boundary saves exist).
 *  Prompts sign-in if the token has lapsed (an explicit user action, so a dialog is fine); does NOT flip the auto-sync
 *  toggle (getToken's first-connect default only fires when the key is UNSET, and a manual-mode user's key is '0').
 *  Reuses the same `syncAllDiagrams` sweep that enableAutosync / sign-in run. */
export async function syncNow() {
  if (!isDriveConfigured()) { showError('Google Drive is not configured for this origin.'); return; }
  try { await getToken({ prompt: '' }); }
  catch (e) {
    if (/access_denied|popup|closed|cancel/i.test(e.message)) { showToast('Google sign-in cancelled.', 'info'); return; }
    showError(e.message); return;
  }
  try {
    const n = await syncAllDiagrams();
    showToast(`Synced ${n} diagram${n === 1 ? '' : 's'} to Google Drive ✓`, 'success');
  } catch (err) {
    console.error('Diagramforce: Sync now failed:', err);
    showError('Sync hit an error - see console for details.');
  }
}

// ── Phase 1: OPEN ──────────────────────────────────────────────────────────────
/** Pick a Diagramforce file from the user's Drive (Google Picker) and load it. */
export async function openFromDrive({ title, sharedFirst } = {}) {
  if (!isDriveConfigured()) { showError('Google Drive is not configured for this origin.'); return; }
  try {
    let token = tokenValid() ? _accessToken : null;   // reuse a still-valid token → no re-prompt within the hour
    if (!token) token = await getToken({ prompt: '' });
    const { apiKey, clientId } = googleConfig();
    await loadScript(GAPI_SRC);
    await new Promise((resolve, reject) => gapi.load('picker', { callback: resolve, onerror: reject }));

    // setAppId(<project number>) is MANDATORY for drive.file — it binds the picked
    // file's access grant to this Cloud project; without it the follow-up files.get
    // 404s (validated in Phase 0). The project number is the client-id prefix.
    const appId = clientId.split('-')[0];
    const myView = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes(PICKER_MIMES)
      .setMode(google.picker.DocsViewMode.LIST);
    // "Shared with me" — lets a recipient of a privately-shared (`type:user`/`type:domain`) link
    // find the file, which isn't in their own Drive. Owner-open still uses the first (My Drive) tab.
    const sharedView = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes(PICKER_MIMES)
      .setOwnedByMe(false)
      .setMode(google.picker.DocsViewMode.LIST);
    // Shared Drives — a SEPARATE view: setEnableDrives shows only shared drives and must NOT be
    // combined with setOwnedByMe. Lets a team open a diagram saved into a Shared Drive folder.
    const sharedDrivesView = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes(PICKER_MIMES)
      .setEnableDrives(true)
      .setMode(google.picker.DocsViewMode.LIST);
    // sharedFirst (item #11 recovery): when a privately-shared link 404'd, lead with "Shared with me" so the
    // recipient lands on the right tab - the file isn't in their own My Drive.
    const builder = new google.picker.PickerBuilder()
      .setAppId(appId)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey);
    if (sharedFirst) { builder.addView(sharedView).addView(myView).addView(sharedDrivesView); }
    else { builder.addView(myView).addView(sharedView).addView(sharedDrivesView); }
    const picker = builder
      .setTitle(title || 'Open a Diagramforce diagram from Drive')
      .setCallback((d) => { if (d.action === google.picker.Action.PICKED) loadPickedFile(d.docs[0], token); })
      .build();
    picker.setVisible(true);
  } catch (err) {
    if (/access_denied|popup|closed|cancel/i.test(err.message)) { showToast('Google sign-in cancelled.', 'info'); return; }
    console.error('Diagramforce: Open from Drive failed:', err);
    showError('Could not open the Google Picker - see console for details.');
  }
}

function loadPickedFile(doc, token) { return importDriveFileById(doc.id, doc.name, token); }

/** One metadata probe for a just-opened file: ownership (own-master vs Shared File model), writer capability
 *  (prefill the Shared File write-back permission), and the head-revision baseline (cross-device guard) — all in
 *  one GET. `canEdit` is null when Drive omits `capabilities` (→ pushToSharedSource detects it lazily later).
 *  Throws a typed Error (`.status`) on failure so the caller can fall back to treating the file as a master. */
async function fileOwnership(fileId, token) {
  const res = await fetch(`${API}/${encodeURIComponent(fileId)}?fields=ownedByMe,capabilities(canEdit),headRevisionId,sharingUser(displayName,emailAddress),owners(displayName,emailAddress)&supportsAllDrives=true`, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) { const e = new Error(await readErr(res)); e.status = res.status; throw e; }
  const j = await res.json();
  const caps = j.capabilities;
  // Who shared it with you (for the tab/tooltip "shared by X"): the explicit sharingUser if present, else the owner.
  const sharedBy = j.sharingUser?.displayName || j.sharingUser?.emailAddress
    || j.owners?.[0]?.displayName || j.owners?.[0]?.emailAddress || null;
  return {
    ownedByMe: j.ownedByMe,
    // `sharingUser` is set ONLY when this file was explicitly shared WITH you (a direct invite) - NOT on your own
    // files. It's a reliable "this is a share received" signal even when Drive omits `ownedByMe` on a fresh grant.
    sharedWithMe: !!j.sharingUser,
    canEdit: caps && typeof caps.canEdit === 'boolean' ? caps.canEdit : null,
    headRevisionId: j.headRevisionId || null,
    sharedBy,
  };
}

/** When a tab is opened FROM a shared source (view or edit), eagerly give it its own My-Drive WORKING COPY so it
 *  reads consistently everywhere: the My-Drive chip lights, and the Load list collapses the working copy + the
 *  original to ONE row (the de-dup keys off the master's `dfSharedFrom` stamp). Without this, the master is only
 *  minted lazily on the first EDIT, so a never-edited view-share stays master-less (chip off, two Load rows).
 *  Two paths, both gated on a LIVE token (never prompts):
 *   - ADOPT an owned master already stamped `dfSharedFrom === source` (a re-open of a copy this app made before).
 *     Link it only - NEVER write - so the existing copy's content is untouched (the de-dup already hides the source
 *     via that durable stamp, so this just lights the open tab's chip + avoids minting a duplicate).
 *   - else CREATE one via doSave (its create path stamps `dfSharedFrom` + sets `s.fileId`). The new file's content
 *     is exactly what was just opened (the source), so there's nothing to lose.
 *  Best-effort: on any failure the master is simply minted later by the first edit / sign-in sweep, as before.
 *  Legacy orphan copies (no stamp) are intentionally NOT name-adopted (user choice - zero mis-match risk); opening
 *  their source mints a fresh stamped master and the orphan is a one-time manual cleanup. */
/** Mode C: find the user's OWN forked working copy of a shared SOURCE - an owned master stamped
 *  `dfSharedFrom === sourceId` (the "(changed)" copy minted on the first edit of a view share). Returns the Drive
 *  file ({id,name,...}) or null. Best-effort: an unreadable listing yields null (the open just proceeds normally).
 *  listMyDiagrams manages its own (cached) token, so this never double-prompts. */
async function findForkOf(sourceId) {
  if (!sourceId) return null;
  try {
    const owned = await listMyDiagrams();
    return (owned || []).find((f) => f && f.ownedByMe !== false && f.appProperties && f.appProperties.dfSharedFrom === sourceId) || null;
  } catch { return null; }
}

/** Mode C: when about to open a fresh VIEW of a shared SOURCE, offer to open the user's EXISTING forked working copy
 *  instead (if one exists), so they don't view the original alongside their own "(changed)" fork. Returns the fork's
 *  file when the user chose it (caller should open THAT instead), else null (open the original as normal). The Load
 *  list already de-dups the in-app library, so this mainly catches the Picker / Search / public-link direct opens
 *  (incl. cross-device, where the fork lives in your Drive). Best-effort + non-blocking on any lookup failure. */
async function offerExistingFork(sourceId, sourceName) {
  const fork = await findForkOf(sourceId);
  if (!fork) return null;
  const clean = (n) => String(n || '').replace(/\.dgf$/i, '');
  const useFork = await confirmModal({
    title: 'Open your working copy?',
    message: `You already have your own copy of "${clean(sourceName)}" - "${clean(fork.name)}". Open that instead of a fresh view of the original?`,
    okLabel: 'Open my copy', cancelLabel: 'Open the original', cancelTone: 'amber',
  });
  return useFork ? fork : null;
}

async function ensureSharedWorkingCopy(id) {
  const s = tabState(id);
  if (!s || s.fileId || !s.sharedSource || !s.sharedSource.fileId) return;   // already linked, or not shared-in
  if (!tokenValid()) return;   // no token → defer to the next edit / sign-in sweep (unchanged behaviour)
  const srcId = s.sharedSource.fileId;
  try {
    let owned = [];
    try { owned = await listMyDiagrams(); } catch { owned = []; }
    const match = (owned || []).find((f) => f && f.ownedByMe !== false && f.appProperties && f.appProperties.dfSharedFrom === srcId);
    const s2 = tabState(id);
    if (!s2 || s2.fileId || !s2.sharedSource || s2.sharedSource.fileId !== srcId) return;   // state moved on while listing
    if (match) {
      // Re-home an existing stamped copy: link only, don't touch its bytes.
      s2.fileId = match.id; s2.headRevisionId = match.headRevisionId || null; s2.lastHash = null;
      persistState(id, s2); notify();
    } else if (id === activeTabId()) {
      // Create the working copy from the just-opened content. Active-only so doSave's currentDiagramData() is correct
      // (if the user already switched tabs, the next edit / sweep mints it instead).
      await doSave(id, { interactive: false });
    }
  } catch { /* best-effort: leave it for the next edit / sweep */ }
}

/** Mode C: mint a VIEW (Copy) share's working copy the moment it's first EDITED - INDEPENDENT of the auto-sync
 *  toggle. Editing a shared view is the user's explicit intent to diverge into their own My-Drive copy (the model),
 *  so it must NOT depend on auto-sync being on: in MANUAL Drive mode `notifyDriveChange` early-returns without ever
 *  scheduling a save, which would otherwise leave the tab renamed "(changed)" with no file behind it (the bug the
 *  live test + the adversarial review both hit). Delegates to `ensureSharedWorkingCopy` (adopt an existing stamped
 *  fork, else CREATE via a non-interactive `doSave` - which writes whenever a token is live, regardless of auto-sync).
 *  Self-gates on a live token; offline, the sign-in sweep mints it later. No-op for an editable (Collab) share
 *  (it keeps its own eager path) and for an already-forked tab. */
export async function forkSharedViewOnEdit(id) {
  const s = tabState(id);
  if (!s || s.fileId || !s.sharedSource || !s.sharedSource.fileId) return;   // already has a master / not shared-in
  if (s.sharedSource.canEdit === true) return;                               // editable share keeps its own path
  await ensureSharedWorkingCopy(id);
}

/** Phase B: turn a tab into a DIRECT-EDIT shared master - `fileId` IS the foreign-but-writable shared file
 *  (Collab/received-editable or a team Shared-Drive file), the ONE source of truth. No working copy, no write-back:
 *  edits save straight to `fileId`; a private My-Drive backup mirror is minted on the first save (ensureMyDriveBackup,
 *  via the sharedInEdit guard). Clears any sharedSource - this file IS the upstream, there's no separate one to track. */
function setDirectEditMaster(id, s, fileId, sharedBy, headRev) {
  s.fileId = fileId; s.imported = false;
  s.sharedInEdit = { sharedBy: sharedBy || null };
  s.sharedSource = null;
  s.headRevisionId = headRev || null;
  s.lastHash = null; s.lastSavedAt = Date.now();
  s.copies = Array.isArray(s.copies) ? s.copies : [];
  s.conflict = false;
  persistState(id, s); notify();
}

/** Read a Drive file by id + import it as the active tab, marking the tab synced to that file. Shared by
 *  the Picker (loadPickedFile) and the "Your Drive diagrams" library (openDriveDiagram). Same
 *  untrusted-source path as share/import: sanitize → checkVersionWarning → onImport.
 *  `assumeOwned` (library path) skips the ownership probe — `listMyDiagrams` only ever returns the user's OWN
 *  masters, so it's guaranteed owned. The Picker, by contrast, has "Shared with me" / "Shared Drives" views, so
 *  a foreign-owned file can be picked; it gets the Shared File model (own My Drive copy + write-back) via
 *  `importedFileRole`, exactly like a `#gd=` share link, instead of being mis-modelled as the user's master.
 *  Returns bool. */
async function importDriveFileById(fileId, fallbackName, token, { assumeOwned = false, knownCanEdit = false, driveId = null, sharedFrom = null, sharedEdit = null } = {}) {
  try {
    const res = await fetch(`${API}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) { showError('Could not read the file from Drive: ' + await readErr(res)); return false; }
    const data = JSON.parse(await res.text());
    if (!data.graph || !data.type) { showError(`"${fallbackName}" isn't a Diagramforce diagram.`); return false; }

    // Same untrusted-source path as the share URL + JSON import.
    pctx.sanitizeGraphJSON(data.graph);
    const ok = await pctx.checkVersionWarning(data.av || null, data.name || fallbackName, data);
    if (!ok) return false;
    if (!pctx.onImport) return false;

    // Ownership probe (Picker only — the Picker doc carries no reliable ownership flag). The library passes
    // assumeOwned, so it's skipped there. A failed probe leaves `meta` null ⇒ importedFileRole treats unknown
    // ownership as 'master' (conservative — never mis-model an owned file as shared on a transient read error).
    let meta = null;
    if (!assumeOwned) { try { meta = await fileOwnership(fileId, token); } catch { meta = null; } }
    const role = importedFileRole({ assumeOwned, ownedByMe: meta ? meta.ownedByMe : null, sharedWithMe: !!(meta && meta.sharedWithMe) });

    // Mode C: opening someone else's shared file - if the user ALREADY forked their own "(changed)" working copy of
    // it, offer to open THAT instead of a fresh view (assumeOwned: it's their master → role 'master', no recursion).
    if (role === 'shared-source') {
      const fork = await offerExistingFork(fileId, data.name || fallbackName);
      if (fork) return importDriveFileById(fork.id, fork.name, token, { assumeOwned: true });
    }

    const type = pctx.normalizeDiagramType(data.type);
    // #7: data.group ({name,icon,color}) recreate-or-rejoins the tab group this diagram was saved from (the owner's
    // group name for a file you own; harmless local group for a shared file). driveMeta=null - this fn sets the
    // Drive linkage itself below.
    pctx.onImport(data.name || fallbackName, type, data.graph, data.viewport || null, data.mappingMode, null, data.group || null);
    const aid = activeTabId();
    const s = tabState(aid);

    if (role === 'shared-source') {
      // Seed canEdit from the probe; if it came back null (Drive omits capabilities right after a grant), fall back
      // to the library row's KNOWN Collab status (knownCanEdit) so edit access is recognised immediately.
      const seedCanEdit = (meta && meta.canEdit != null) ? meta.canEdit : (knownCanEdit === true ? true : null);
      const sharedBy = meta ? meta.sharedBy : null;
      if (seedCanEdit === true) {
        // Phase B: a Collab/received-EDITABLE share opens as a DIRECT-EDIT master - `fileId` IS the shared file (the
        // ONE source of truth). No working copy + write-back; the private My-Drive backup mirror is minted on the
        // first save. Seed the head revision so the first save is conflict-aware (cross-device lost-update guard).
        let headRev = meta ? meta.headRevisionId : null;
        if (headRev == null) { try { headRev = (await remoteMeta(fileId, token)).headRevisionId || null; } catch { headRev = null; } }
        setDirectEditMaster(aid, s, fileId, sharedBy, headRev);
        showToast(`Opened shared "${data.name || fallbackName}" from Drive ✓`, 'success');
        return true;
      }
      // VIEW (Copy) or UNKNOWN canEdit → Mode C view: NO own master (created on the first edit). It forks to a
      // "<name> (changed)" copy only when first edited, so a never-edited view stays one clean "Shared with you" row.
      s.fileId = null; s.imported = false;
      s.sharedSource = { fileId, canEdit: seedCanEdit, lastRevisionId: meta ? meta.headRevisionId : null, lastPushedAt: 0, conflict: false, sharedBy };
      s.headRevisionId = null; s.lastHash = null; s.lastSavedAt = Date.now();
      s.copies = []; s.conflict = false;
      persistState(aid, s); notify();
      showToast(`Opened shared "${data.name || fallbackName}" from Drive ✓`, 'success');
      // If canEdit was UNKNOWN at open (Drive omits `capabilities` right after a Picker grant), probe ONCE more: an
      // EDITABLE result PROMOTES this view to a Phase-B direct-edit master; a view-only result just records canEdit.
      if (seedCanEdit == null) {
        canEditFile(fileId, token).then(async (ce) => {
          const s2 = tabState(aid);
          if (!s2.sharedSource || s2.sharedSource.fileId !== fileId || s2.fileId) return;   // moved on / already forked
          if (ce === true) {
            let headRev = null; try { headRev = (await remoteMeta(fileId, token)).headRevisionId || null; } catch { headRev = null; }
            setDirectEditMaster(aid, s2, fileId, s2.sharedSource.sharedBy, headRev);
          } else if (s2.sharedSource.canEdit !== ce) {
            s2.sharedSource.canEdit = ce; persistState(aid, s2); notify();
          }
        }).catch(() => { /* leave canEdit null; the next edit's path resolves it */ });
      }
      return true;
    }

    // Owned → this is the user's master. Mark it synced (imported:false) so edits autosave back and a later sync
    // updates it, not a duplicate. (imported:true was the legacy share flag — superseded by the Shared File model.)
    s.fileId = fileId; s.imported = false; s.dirty = false; s.lastSavedAt = Date.now(); s.lastHash = null;
    s.copies = []; s.conflict = false;
    // Mode C: a re-opened FORK is an owned master that carries the `dfSharedFrom` stamp (threaded in from the Load
    // row's appProperties). Rebuild its sharedSource as a REFRESH-ONLY pointer to the original so "Refresh from
    // original" keeps working - the fork classifies as an OWNED file (tabShareRole's ownFileId carve-out), NOT as a
    // shared-in tab, so there's no shared glyph and no "Shared with you" row. Without the stamp, no sharedSource.
    s.sharedSource = sharedFrom
      ? { fileId: sharedFrom, canEdit: sharedEdit === '1', lastRevisionId: null, lastPushedAt: 0, conflict: false }
      : null;
    // Capture whether this owned master LIVES on a team Shared Drive (its own driveId). The library path passes the
    // value through from listMyDiagrams (the probe is skipped under assumeOwned, so meta has none); a probed open
    // (Picker) gets it from meta. persistState below writes it to driveDriveId, so the Save Manager / Load Browser /
    // Close & Delete chips and the tab glyph all read "Shared Drive" instead of "My Drive" / nothing (item 5).
    s.driveId = driveId || (meta && meta.driveId) || null;
    // Baseline the head revision so a later save here is conflict-aware (cross-device lost-update guard). Reuse the
    // probe's value when we have it (Picker-owned); the library path (no probe) reads it with a small remoteMeta.
    s.headRevisionId = meta ? meta.headRevisionId : null;
    if (s.headRevisionId == null) { try { s.headRevisionId = (await remoteMeta(fileId, token)).headRevisionId || null; } catch { s.headRevisionId = null; } }
    persistState(aid, s); notify();
    showToast(`Opened "${data.name || fallbackName}" from Drive ✓`, 'success');
    return true;
  } catch (err) {
    console.error('Diagramforce: load Drive file failed:', err);
    showError('Could not load the diagram from Drive - it may be malformed.');
    return false;
  }
}

// ── Phase 1: personal "Your Drive diagrams" library (list / open / trash) ─────────
/** List the user's own Diagramforce masters — the `.dgf` files this app created in the My-Drive
 *  "Diagramforce" folder. Under `drive.file`, files.list only ever returns app-created/opened files, so
 *  this is exactly the owner's masters. Returns [{id,name,modifiedTime}] newest-first ([] if no folder). */
export async function listMyDiagrams() {
  if (!isDriveConfigured()) throw new Error('Google Drive is not configured for this origin.');
  let token = tokenValid() ? _accessToken : null;
  if (!token) token = await getToken({ prompt: '' });   // prompt:'' — re-auth without re-asking consent (item 14 bug)
  const q = encodeURIComponent(myDiagramsQuery());   // folder-less: finds the user's .dgf files wherever they landed
  // headRevisionId + ownedByMe come along so the link-reconcile (reconcileTabDriveLinks) can re-baseline an
  // ADOPTED tab without an extra GET AND filter out foreign 'shared-with-me' .dgf files (files.list under
  // drive.file returns app-OPENED files too, not only app-created ones).
  // sharingUser/owners/capabilities(canEdit) feed the Load → Drive "Shared with you" split: who shared a
  // not-owned file, and whether you can edit it (Collaborate) or only view it (a Copy share).
  // driveId is set ONLY for a file that LIVES on a team Shared Drive (My-Drive files have none). It lets the row
  // put the "Shared Drive" badge on the ACTUAL Shared-Drive file - not on the My-Drive source master that fanned
  // a copy to it (which now reads as just "My Drive"). capabilities.canDelete gates the delete control.
  const res = await fetch(`${API}?q=${q}&fields=files(id,name,modifiedTime,appProperties,headRevisionId,ownedByMe,driveId,capabilities(canEdit,canDelete),sharingUser(displayName,emailAddress),owners(displayName,emailAddress))&orderBy=modifiedTime desc&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error(await readErr(res));
  return (await res.json()).files || [];
}

/** Open one of the Drive-library rows as a new active tab. `ownedByMe` comes from `listMyDiagrams` (which returns
 *  files shared TO you too, not just your masters). For an OWNED row we `assumeOwned` (skip the ownership probe -
 *  it's guaranteed yours). For a NOT-owned row (`ownedByMe === false`) we MUST probe, so `importedFileRole` returns
 *  'shared-source' and the file gets the Shared File model (own My Drive copy + write-back) instead of being
 *  mis-modelled as your master - which previously let Close & Delete TRASH a file you don't own (data loss on a
 *  Shared Drive where you're a writer). */
export async function openDriveDiagram(fileId, name, ownedByMe = true, { knownCanEdit = false, driveId = null, sharedFrom = null, sharedEdit = null } = {}) {
  if (!isDriveConfigured()) { showError('Google Drive is not configured for this origin.'); return false; }
  let token = tokenValid() ? _accessToken : null;
  if (!token) {
    try { token = await getToken({ prompt: '' }); }
    catch (e) { if (!/access_denied|popup|closed|cancel/i.test(e.message)) showError(e.message); return false; }
  }
  // knownCanEdit = the Drive library row's KNOWN Collab status (its "Collab" pill). Passed through so the shared
  // tab's glyph/chip reflect edit access immediately even when the fresh probe returns canEdit=null (#3).
  // driveId = the row's KNOWN Shared-Drive id (set only when the file LIVES on a team Shared Drive). The owned-master
  // open path skips the ownership probe (assumeOwned), so meta has no driveId - we thread the list's value through so
  // the tab records it (s.driveId) and every local-state surface reads "Shared Drive" + a tab glyph (item 5).
  // sharedFrom/sharedEdit = the row's `appProperties.dfSharedFrom`/`dfSharedEdit` stamp (Mode C). For an OWNED FORK
  // this rebuilds the refresh-only sharedSource so "Refresh from original" survives a close+re-open; otherwise null.
  return importDriveFileById(fileId, name || 'Diagram', token, { assumeOwned: ownedByMe !== false, knownCanEdit, driveId, sharedFrom, sharedEdit });
}

/**
 * Clone a file shared TO the user into a NEW file in their OWN My Drive (the "Make a copy" action on a shared
 * row, item 2). Reads the source content, creates an owned copy named "<name> (copy)" in the Diagramforce
 * folder, and opens it as a new owned tab (no sharedSource — a standalone copy the user owns and can edit).
 * Works even on a VIEW-only share (it copies the content, not via Drive's copy endpoint). Returns true on success.
 */
export async function cloneSharedToMyDrive(sourceFileId, sourceName) {
  if (!isDriveConfigured()) { showError('Google Drive is not configured for this origin.'); return false; }
  let token = tokenValid() ? _accessToken : null;
  if (!token) {
    try { token = await getToken({ prompt: '' }); }
    catch (e) { if (!/access_denied|popup|closed|cancel/i.test(e.message)) showError(e.message); return false; }
  }
  try {
    const res = await fetch(`${API}/${encodeURIComponent(sourceFileId)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) { showError('Could not read the shared file from Drive: ' + await readErr(res)); return false; }
    const data = JSON.parse(await res.text());
    if (!data.graph || !data.type) { showError(`"${sourceName}" isn't a Diagramforce diagram.`); return false; }
    pctx.sanitizeGraphJSON(data.graph);
    const ok = await pctx.checkVersionWarning(data.av || null, data.name || sourceName, data);
    if (!ok) return false;
    if (!pctx.onImport) return false;

    // Create the owned copy first (so the new tab can be linked to it immediately), then open it.
    const baseName = (data.name || sourceName || 'Diagram').replace(/\.dgf$/i, '');
    data.name = `${baseName} (copy)`;
    const folderId = await ensureFolder(token);
    const created = await writeFile(null, data, { folderId }, token);
    if (!created || !created.id) { showError('Could not create the copy in your Drive.'); return false; }

    const type = pctx.normalizeDiagramType(data.type);
    pctx.onImport(data.name, type, data.graph, data.viewport || null, data.mappingMode);
    const aid = activeTabId();
    const s = tabState(aid);
    s.fileId = created.id; s.imported = false; s.dirty = false; s.lastSavedAt = Date.now(); s.lastHash = null;
    s.copies = []; s.conflict = false;
    // A clone is YOUR My Drive copy, but it KEEPS a refresh-only link to the original (item 5): the "Shared File"
    // chip marks where it came from, and the upstream sweep can offer Refresh when the original changes. canEdit is
    // false (a clone is a fork - it never writes back to someone else's file). A null baseline is recorded silently
    // on the first upstream check, so only a SUBSEQUENT change to the original flags a refresh.
    s.sharedSource = { fileId: sourceFileId, canEdit: false, lastRevisionId: null, lastPushedAt: 0, conflict: false };
    s.headRevisionId = created.headRevisionId || null;
    s.modifiedTime = created.modifiedTime || null;   // baseline BOTH divergence fields, like doSave (review fix)
    persistState(aid, s); notify();
    showToast(`Cloned "${baseName}" to your Drive ✓`, 'success');
    return true;
  } catch (err) {
    console.error('Diagramforce: clone shared file failed:', err);
    showError('Could not clone the shared file - it may be malformed or inaccessible.');
    return false;
  }
}

/** Move a diagram's Drive file to the user's Drive TRASH (recoverable ~30 days — NOT a hard delete).
 *  Unlinks any open tab pointing at it (drops to local-only). Returns true on success. */
/** Best-effort: find the user's private My-Drive backup mirror of `masterFileId` (the kind:'mydrive-backup' copy
 *  stamped appProperties.dfBackupOf) when no open tab carries it - so deleting a CLOSED / Load-list shared row still
 *  removes the backup, not just the link. Returns the backup file id or null. */
async function findBackupFileId(masterFileId, token) {
  if (!token || !masterFileId) return null;
  const q = encodeURIComponent(`appProperties has { key='dfBackupOf' and value='${masterFileId}' } and trashed = false`);
  const res = await fetch(`${API}?q=${q}&fields=files(id)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) return null;
  const data = await res.json();
  return (data.files && data.files[0] && data.files[0].id) || null;
}

export async function deleteDiagramFromDrive(fileId) {
  if (!isDriveConfigured()) { showError('Google Drive is not configured for this origin.'); return false; }
  let token = tokenValid() ? _accessToken : null;
  if (!token) {
    try { token = await getToken({ prompt: '' }); }
    catch (e) { if (!/access_denied|popup|closed|cancel/i.test(e.message)) showError(e.message); return false; }
  }
  try {
    // Phase B (B1b-2): this fileId can be a file the user does NOT own - a Collab/received-editable share they edit
    // DIRECTLY (s.sharedInEdit), or a team Shared-Drive file. NEVER trash that (unrecoverable for its owner); remove
    // only the user's private My-Drive backup mirror + the local tab link. sharedMasterDeleteDecision gates the
    // master-trash on DEFINITE ownership (a null/failed probe FAILS CLOSED). The 403 path stays as the backstop for
    // an owned-but-undeletable file (e.g. a Shared-Drive writer who isn't a content manager).
    let isSharedInEdit = false, backupFileId = null;
    for (const [, s] of driveByTab) if (s && s.fileId === fileId) {
      if (s.sharedInEdit) isSharedInEdit = true;
      const bk = (s.copies || []).find((c) => c && c.kind === 'mydrive-backup');
      if (bk && bk.fileId) backupFileId = bk.fileId;
    }
    // No open tab carried the backup (deleting a CLOSED / Load-list row) → find the mirror on Drive by its stamp.
    if (!backupFileId) { try { backupFileId = await findBackupFileId(fileId, token); } catch { backupFileId = null; } }

    let ownedByMe = null;
    try { ownedByMe = (await fileOwnership(fileId, token)).ownedByMe; } catch { ownedByMe = null; }
    const decision = sharedMasterDeleteDecision({ ownedByMe, isSharedInEdit, hasBackup: !!backupFileId });

    // 1) Always remove YOUR private backup mirror first (your own My-Drive file → a plain trash).
    if (decision.trashBackup && backupFileId) {
      try {
        await fetch(`${API}/${encodeURIComponent(backupFileId)}?supportsAllDrives=true`, {
          method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
        });
      } catch (e) { console.warn('Diagramforce: backup mirror trash failed', e); }
    }

    // 2) Trash the master ONLY when definitely owned. A foreign / unconfirmed master stays in Drive for its owner.
    if (!decision.trashMaster) {
      for (const [id, s] of driveByTab) if (s.fileId === fileId) clearTabDriveState(id);
      notify();
      const msg = (isSharedInEdit || ownedByMe === false)
        ? `Removed your local copy${backupFileId ? ' and My-Drive backup' : ''}. The shared file stays in Drive for its owner.`
        : "Couldn't confirm this file's owner, so we removed only the local copy. Try again to delete it from Drive.";
      showToast(msg, 'info');
      return true;
    }
    const res = await fetch(`${API}/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
      method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
    });
    if (!res.ok) {
      // A 403 here means the file is on a Shared Drive (you're a writer, not a content manager) - you genuinely
      // can't trash it. Say so clearly instead of leaking the raw "403 ... insufficient permissions".
      if (res.status === 403) {
        showError("You can't delete this one - it lives on a team Shared Drive (or is owned by someone else), so only a Drive manager can remove it.");
        return false;
      }
      showError('Could not delete from Google Drive: ' + await readErr(res));
      return false;
    }
    for (const [id, s] of driveByTab) if (s.fileId === fileId) clearTabDriveState(id);   // unlink open tabs
    notify();
    return true;
  } catch (err) {
    console.error('Diagramforce: delete from Drive failed:', err);
    showError('Could not delete from Google Drive - see console for details.');
    return false;
  }
}

/** Reset a tab's runtime + persisted Drive link (after its file is trashed) → the tab is now local-only. */
export function clearTabDriveState(tabId) {
  const s = driveByTab.get(tabId);
  if (!s) return;
  s.fileId = null; s.imported = false; s.dirty = false; s.lastSavedAt = 0; s.lastHash = null;
  s.folderId = null; s.driveId = null; s.folderName = null; s.sharedSource = null; s.sharedInEdit = null;
  s.headRevisionId = null; s.modifiedTime = null; s.conflict = false; s.copies = [];
  persistState(tabId, s);
}

// ── Shared Drive: publish a COPY (per-tab) ───────────────────────────────────────
/** Bulk "Sync to Shared Drive": pick ONE Shared-Drive folder, then publish a COPY of each given tab into
 *  it (ensuring each has a My-Drive master first) and register the copies as fan-out targets. Signs in
 *  once; skips empty tabs. Resolves with the count published (0 on cancel). */
export function publishTabsToSharedDrive(ids) {
  if (!isDriveConfigured()) { showError('Google Drive is not configured for this origin.'); return Promise.resolve(0); }
  const list = Array.isArray(ids) ? ids : [];
  if (!list.length) return Promise.resolve(0);
  return new Promise((resolve) => {
    (async () => {
      let token = tokenValid() ? _accessToken : null;
      if (!token) {
        try { token = await getToken({ prompt: '' }); }
        catch (e) { if (!/access_denied|popup|closed|cancel/i.test(e.message)) showError(e.message); resolve(0); return; }
      }
      try {
        const { apiKey, clientId } = googleConfig();
        await loadScript(GAPI_SRC);
        await new Promise((res, rej) => gapi.load('picker', { callback: res, onerror: rej }));
        const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
          .setEnableDrives(true).setSelectFolderEnabled(true).setMode(google.picker.DocsViewMode.LIST);
        const picker = new google.picker.PickerBuilder()
          .setAppId(clientId.split('-')[0]).setOAuthToken(token).setDeveloperKey(apiKey).addView(view)
          .setTitle('Choose a Shared Drive folder to publish copies into')
          .setCallback(async (d) => {
            if (d.action === google.picker.Action.CANCEL) { resolve(0); return; }
            if (d.action !== google.picker.Action.PICKED) return;
            const f = d.docs[0];
            let driveId = f.driveId || null;
            try {
              const r = await fetch(`${API}/${encodeURIComponent(f.id)}?supportsAllDrives=true&fields=driveId,capabilities(canAddChildren)`, { headers: { Authorization: 'Bearer ' + token } });
              if (r.ok) { const m = await r.json(); if (m.driveId) driveId = m.driveId; if (m.capabilities && m.capabilities.canAddChildren === false) { showError(`You need Contributor access or higher on "${f.name}" to publish there.`); resolve(0); return; } }
            } catch { /* soft: let the writes surface any real error */ }
            const byId = new Map((pctx.getAllTabs ? pctx.getAllTabs() : []).map((t) => [t.id, t]));
            let n = 0;
            for (const id of list) {
              const tab = byId.get(id); if (!tab) continue;
              const data = dataForTab(tab);
              if (!data.graph || !(data.graph.cells && data.graph.cells.length)) continue;   // skip empty
              const s = tabState(id);
              try {
                if (!s.fileId) { const m = await writeFile(null, data, { folderId: await ensureFolder(token) }, token); s.fileId = m.id; s.headRevisionId = m.headRevisionId || null; s.lastSavedAt = Date.now(); s.lastHash = hashStr(JSON.stringify(data)); }
                const meta = await writeFile(null, data, { folderId: f.id }, token);
                s.copies = upsertCopy(s.copies, { fileId: meta.id, driveId, folderId: f.id, label: f.name || 'Shared Drive', kind: 'shared-drive', lastRevisionId: meta.headRevisionId || null, lastPushedAt: Date.now(), conflict: false });
                persistState(id, s); n++;
              } catch { /* skip this one, keep going */ }
            }
            notify();
            if (n) showToast(`Published ${n} cop${n === 1 ? 'y' : 'ies'} to "${f.name}" ✓`, 'success');
            else showError('Could not publish any copies to that folder.');
            resolve(n);
          })
          .build();
        picker.setVisible(true);
      } catch (err) {
        console.error('Diagramforce: publish to Shared Drive failed:', err);
        showError('Could not open the folder picker - see console for details.');
        resolve(0);
      }
    })();
  });
}

// ── Drive share-link helpers (all wired internally: getDriveShareUrl/shareAnyone back the Share
//    Manager scoped/editable flows; fetchPublicGraph backs loadDriveRef/openGroupFromLink) ───────
/** Short, stable, live share link: appUrl#gd=<fileId>. (Module-internal — backs the scoped/editable share flows.) */
function getDriveShareUrl(fileId) {
  return `${location.origin}${location.pathname}#gd=${encodeURIComponent(fileId)}`;
}
/** Share an app-created file as "anyone with the link can view" (validated in Phase 0). */
export async function shareAnyone(fileId, token = null) {
  token = token || await getToken();   // reuse the caller's token when given (avoids a redundant account picker)
  const res = await fetch(`${API}/${encodeURIComponent(fileId)}/permissions?fields=id&supportsAllDrives=true`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });
  if (!res.ok) throw new Error('share failed: ' + await readErr(res));
  return true;
}
/**
 * Zero-sign-in anonymous read of a public file (Phase 3 recipient path). Validated to
 * ≥3 MB, logged-out, no redirect — but the inline-vs-redirect threshold is UNDOCUMENTED,
 * so callers MUST treat a throw as "fall back to sign-in+Picker or the inline URL".
 */
export async function fetchPublicGraph(fileId) {
  const { apiKey } = googleConfig();
  const res = await fetch(`${API}/${encodeURIComponent(fileId)}?alt=media&key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) throw new Error('public read failed: ' + res.status);
  return JSON.parse(await res.text());
}

// The signed-in user's email — fetched once (needs the `email` scope) to auto-derive the Workspace
// domain for "Organisation" sharing, so the UI doesn't have to ask for it.
let _userEmail = null;
async function getUserEmail() {
  if (_userEmail) return _userEmail;
  const token = await getEmailToken();   // separate `email` consent — only reached via org sharing
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('Could not read your Google account (needed to scope to your organisation).');
  _userEmail = (await res.json()).email || '';
  return _userEmail;
}

/** Create a sharing permission (domain / user) on an app-created file. `anyone` uses shareAnyone. */
async function createPermission(fileId, body, params = {}) {
  const token = await getToken();
  const qs = new URLSearchParams({ fields: 'id', supportsAllDrives: 'true', ...params }).toString();
  const res = await fetch(`${API}/${encodeURIComponent(fileId)}/permissions?${qs}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('share failed: ' + await readErr(res));
  return (await res.json()).id;
}

/**
 * Share the ACTIVE diagram via Drive at a chosen scope; returns the short live `#gd=` URL. Backs the
 * Share Manager. scope: 'anyone' (public, no sign-in to view) | 'domain' (everyone in a Google
 * Workspace domain) | 'user' (specific emails — they sign in to open).
 * NOTE: only 'anyone' is Phase-0-validated under the `drive.file` scope. 'domain' / 'user' permission
 * creation is *expected* to work on app-created files but isn't confirmed live yet — a failure is
 * thrown for the UI to surface (graceful, never a crash).
 */
export async function shareActiveScoped({ scope = 'anyone', domain = '', emails = [] } = {}) {
  if (!isDriveConfigured()) throw new Error('Google Drive is not configured for this origin.');
  const id = activeTabId();
  const s = tabState(id);
  if (!s.fileId) await doSave(id, { interactive: true });   // create the file (signs in if needed)
  if (!s.fileId) throw new Error('Sign-in or save did not complete.');
  const fileId = s.fileId;
  if (scope === 'domain') {
    let dom = domain;
    if (!dom) {                                   // auto-scope to the signed-in user's Workspace domain
      const email = await getUserEmail();
      dom = (email.split('@')[1] || '').toLowerCase();
      if (!dom || ['gmail.com', 'googlemail.com'].includes(dom)) {
        throw new Error('Organisation sharing needs a Google Workspace account (a personal Gmail has no organisation).');
      }
    }
    await createPermission(fileId, { role: 'reader', type: 'domain', domain: dom });
  } else if (scope === 'user') {
    const list = (emails || []).map((e) => String(e).trim()).filter(Boolean);
    if (!list.length) throw new Error('Enter at least one email address.');
    for (const email of list) {
      await createPermission(fileId, { role: 'reader', type: 'user', emailAddress: email }, { sendNotificationEmail: 'true' });
    }
  } else {
    await shareAnyone(fileId);
  }
  return getDriveShareUrl(fileId);
}

/**
 * EDITABLE share: publish a COPY of the active diagram and grant the recipient(s) WRITE access, so they
 * edit their own copy and never touch the owner's master. The copy is registered as a fan-out target
 * ("push but never clobber"): the owner's later saves update it unless the recipient changed it first.
 * scope: 'anyone' (anyone with the link can edit) | 'user' (specific emails) | 'domain' (everyone in a
 * Google Workspace organisation can edit the shared copy). Returns `#gd=<copyId>`.
 */
export async function shareActiveEditable({ scope = 'user', emails = [], domain = '' } = {}) {
  if (!isDriveConfigured()) throw new Error('Google Drive is not configured for this origin.');
  const id = activeTabId();
  const s = tabState(id);
  if (!s.fileId) await doSave(id, { interactive: true });   // ensure the master exists (signs in if needed)
  if (!s.fileId) throw new Error('Sign-in or save did not complete.');
  const token = tokenValid() ? _accessToken : await getToken();
  const list = (emails || []).map((e) => String(e).trim()).filter(Boolean);
  if (scope === 'user' && !list.length) throw new Error('Enter at least one email address.');
  // Organisation (Collaborate): resolve + validate the Workspace domain BEFORE creating the copy, so a
  // personal-Gmail user gets a clean error instead of an orphaned, ungrantable copy left in their Drive.
  let dom = '';
  if (scope === 'domain') {
    dom = domain;
    if (!dom) { const email = await getUserEmail(); dom = (email.split('@')[1] || '').toLowerCase(); }
    if (!dom || ['gmail.com', 'googlemail.com'].includes(dom)) {
      throw new Error('Organisation sharing needs a Google Workspace account (a personal Gmail has no organisation).');
    }
  }
  // The recipient-editable copy is stamped dfEditShareOf:<master id> so the Load library HIDES it (like a backup) -
  // it's not a diagram the sharer works on directly; its surface is the Share Manager + the Review flow. Without the
  // stamp it read as a phantom second owned diagram in "Your Google Drive" (screen 3).
  const meta = await writeFile(null, currentDiagramData(), { folderId: await ensureFolder(token), appProperties: { dfEditShareOf: s.fileId } }, token);
  const copyId = meta.id;
  try {
    if (scope === 'user') {
      for (const email of list) await createPermission(copyId, { role: 'writer', type: 'user', emailAddress: email }, { sendNotificationEmail: 'true' });
    } else if (scope === 'domain') {
      await createPermission(copyId, { role: 'writer', type: 'domain', domain: dom });
    } else {
      await createPermission(copyId, { role: 'writer', type: 'anyone' });
    }
  } catch (e) {
    // Roll the orphan copy into the trash so a failed grant doesn't litter Drive, then resurface the error.
    // Best-effort: if the cleanup ALSO fails, the (unshared, unregistered) copy is left in the user's own
    // My-Drive Diagramforce folder — harmless + deletable from Drive directly, but log its id so the leak
    // is diagnosable rather than fully silent.
    try {
      const t = await fetch(`${API}/${encodeURIComponent(copyId)}?supportsAllDrives=true`, { method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
      if (!t.ok) console.warn(`Diagramforce: could not trash the orphaned share copy ${copyId} (${t.status}); delete it from Google Drive if it lingers.`);
    } catch (cleanupErr) {
      console.warn(`Diagramforce: could not trash the orphaned share copy ${copyId}:`, cleanupErr);
    }
    throw e;
  }
  s.copies = upsertCopy(s.copies, {
    fileId: copyId, driveId: null, folderId: null, kind: 'edit-share',
    label: scope === 'user' ? list.join(', ') : scope === 'domain' ? `Everyone at ${dom}` : 'Anyone with the link',
    lastRevisionId: meta.headRevisionId || null, lastPushedAt: Date.now(), conflict: false,
  });
  persistState(id, s); notify();
  return getDriveShareUrl(copyId);
}

/**
 * Stop sharing one of the active diagram's shared copies (item 4). Revokes access by TRASHING the shared
 * copy file on Drive (an edit-share copy lives in the user's own My Drive, so trashing it removes the
 * recipients' access; it stays recoverable in Drive trash for 30 days). The user's own master is never touched.
 *
 * THROWS when the trash genuinely fails (e.g. 403 — a Shared-Drive copy the user can't trash) so the caller
 * surfaces it and the copy STAYS in the list (the share is still live — unlinking would lie). A 404 means the
 * file is already gone, so that counts as removed and unlinks cleanly. Only on a real removal does it unlink
 * locally + clear any (defensive) orphan sharedSource pointing at the same id. Returns true on removal.
 */
export async function removeShare(fileId) {
  const id = activeTabId();
  const s = tabState(id);
  if (!(s.copies || []).some((c) => c && c.fileId === fileId)) return false;
  let token = tokenValid() ? _accessToken : null;
  if (!token) token = await getToken();   // let a sign-in failure reject to the caller (don't fake success)
  const res = await fetch(`${API}/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
  if (!res.ok && res.status !== 404) throw new Error('Could not stop sharing: ' + await readErr(res));
  // Removed (trashed, or already gone) → unlink. Guard the should-never-happen overlap where the same id is
  // also the upstream sharedSource, so a fan-out never tries to write to the now-trashed file.
  s.copies = removeCopy(s.copies, fileId);
  if (s.sharedSource && s.sharedSource.fileId === fileId) s.sharedSource = null;
  persistState(id, s); notify();
  return true;
}

/** The active tab's shared copies (edit-share + Shared-Drive), for the Share Manager list. */
export function activeShareCopies() {
  const s = driveByTab.get(activeTabId());
  return (s?.copies || []).map((c) => ({
    fileId: c.fileId, label: c.label || c.folderName || 'Copy', kind: c.kind || 'edit-share',
    conflict: !!c.conflict, shareUrl: getDriveShareUrl(c.fileId),
  }));
}

/**
 * deferred-#6: the VIEW / Copy invites granted DIRECTLY on the active diagram's OWN master (reader/writer
 * permissions, no separate copy file). Read LIVE from Drive so the list is authoritative — no local grant
 * tracking to drift from the real "who has access". The owner's own permission is excluded. Each:
 * { permissionId, recipient, role, scope }. Returns [] when this tab has no own master. (Editable COPIES are a
 * SEPARATE concern - they live on copy files and are listed via activeShareCopies.)
 */
export async function listActiveShareGrants() {
  const s = driveByTab.get(activeTabId());
  if (!s || !s.fileId) return [];
  let token = tokenValid() ? _accessToken : null;
  if (!token) token = await getToken({ prompt: '' });
  // permissionDetails(inherited): on a team Shared Drive each member surfaces as a per-file permission with
  // permissionDetails[].inherited === true (access comes from Drive/folder membership, not a direct invite). The
  // Share Manager uses it to bucket members into the "Shared Drive" section (read-only) vs direct invites into
  // Edit/View. For a My-Drive file permissionDetails is absent, so every grant reads as a direct (non-inherited) one.
  const res = await fetch(`${API}/${encodeURIComponent(s.fileId)}/permissions?fields=permissions(id,type,role,emailAddress,domain,displayName,permissionDetails(inherited))&supportsAllDrives=true`, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error(await readErr(res));
  const grants = ((await res.json()).permissions || [])
    .filter((p) => p.role !== 'owner')   // never the owner's own access
    .map((p) => ({
      permissionId: p.id,
      role: p.role,                       // 'reader' (a View/Copy invite) | 'writer' | 'commenter'
      scope: p.type,                      // 'user' | 'domain' | 'anyone'
      inherited: Array.isArray(p.permissionDetails) && p.permissionDetails.some((d) => d && d.inherited),
      recipient: p.type === 'anyone' ? 'Anyone with the link'
        : p.type === 'domain' ? `Everyone at ${p.domain || 'your organisation'}`
          : (p.emailAddress || p.displayName || 'a person'),
    }));
  // Persist the count of DIRECT outgoing grants (people/links you invited on this master - NOT inherited Shared-Drive
  // members) so the TAB GLYPH can show "shared out" for a view/edit invite too, not only for editable copies. The tab
  // glyph reads local state synchronously, so it needs this mirrored; this live fetch is the authoritative reconcile
  // (every share / revoke in the Share Manager re-runs it). A Shared-Drive file's members are inherited → 0 here, so
  // its glyph still comes from driveDriveId.
  const cur = driveByTab.get(activeTabId());
  if (cur && cur.fileId === s.fileId) {
    const directOut = grants.filter((g) => !g.inherited).length;
    if ((cur.outgoingGrants || 0) !== directOut) { cur.outgoingGrants = directOut; persistState(activeTabId(), cur); }
  }
  return grants;
}

/**
 * deferred-#6: revoke ONE grant on the active diagram's OWN master via permissions.delete. The master FILE is
 * never touched - only that recipient's access - and it's fully reversible (re-share any time). A 404 (already
 * gone) counts as removed. Returns true on removal; throws on a real failure so the caller keeps the row.
 */
export async function removeGrant(permissionId) {
  const s = driveByTab.get(activeTabId());
  if (!s || !s.fileId || !permissionId) return false;
  let token = tokenValid() ? _accessToken : null;
  if (!token) token = await getToken();
  const res = await fetch(`${API}/${encodeURIComponent(s.fileId)}/permissions/${encodeURIComponent(permissionId)}?supportsAllDrives=true`, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok && res.status !== 404) throw new Error('Could not revoke access: ' + await readErr(res));
  return true;
}

/** The Google Drive WEB url for a file (its viewer, where the native Share / "who has access" dialog
 *  lives) — distinct from getDriveShareUrl, which is the app's own `#gd=` open-in-Diagramforce link. */
export function getDriveManageUrl(fileId) {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

/**
 * A plain summary of the ACTIVE diagram's sharing status, for the Share Manager "Sharing" block (R8).
 * Pure read of what the app itself tracks — the copies the user shared out and the file they opened
 * from someone — plus Drive web links to manage the authoritative "who has access" in Google Drive.
 * Returns: { role, copies[], source|null, manageUrl|null }.
 *  - role: 'local' | 'shared-out' | 'shared-in-edit' | 'shared-in-view' (from tabShareRole).
 *  - copies: activeShareCopies() (recipients of editable / Shared-Drive copies).
 *  - source: when opened from someone else, { fileId, canEdit, manageUrl } for the upstream file.
 *  - manageUrl: the user's OWN master's Drive web url (null if this tab has no own master).
 */
export function activeShareStatus() {
  const s = driveByTab.get(activeTabId());
  // onSharedDrive (R8 fix): a file that natively LIVES on a team Shared Drive (its own driveId set) grants edit
  // access via Drive membership, NOT via app-created copies - so copies/sharedSource are both empty and the role
  // would otherwise fall through to 'local' ("Not shared yet"), contradicting the tab glyph. Pass it through so
  // tabShareRole can return 'shared-drive-master', and surface the flag for the renderer's grant-list reframe.
  const onSharedDrive = !!s?.driveId;
  const role = tabShareRole({ copies: s?.copies, sharedSource: s?.sharedSource, onSharedDrive, ownFileId: s?.fileId, sharedInEdit: !!s?.sharedInEdit });
  const src = s?.sharedSource && s.sharedSource.fileId ? s.sharedSource : null;
  return {
    role,
    onSharedDrive,
    copies: activeShareCopies(),
    source: src ? { fileId: src.fileId, canEdit: src.canEdit === true, manageUrl: getDriveManageUrl(src.fileId) } : null,
    manageUrl: s?.fileId ? getDriveManageUrl(s.fileId) : null,
  };
}

/**
 * Resolve a diverged shared COPY (a recipient edited it). Pull = open their version in a new tab;
 * Keep = overwrite their copy with the master (fan-out wins); Fork = unlink it (becomes their own
 * independent diagram). Every version stays recoverable in Drive's file history regardless.
 */
export async function resolveCopyConflict(fileId) {
  const id = activeTabId();
  const s = tabState(id);
  const copy = (s.copies || []).find((c) => c.fileId === fileId);
  if (!copy) return;
  // Phase C: preview the sharer's master ("Your diagram") vs the diverged copy ("Google Drive diagram"). Best-effort
  // + needs a live token; falls back to the text-only modal if absent. The copy's `label` (the recipient's email)
  // names the remote side when Drive omits the revision's lastModifyingUser.
  let token = tokenValid() ? _accessToken : null;
  let preview = {};
  if (token) { try { preview = await buildConflictPreviews({ localData: currentDiagramData(), remoteFileId: fileId, token, remoteByFallback: copy.label || null }); } catch { preview = {}; } }
  const choice = await showConflictModal({ ...conflictActions('copy'), ...preview });
  if (!choice) return;
  // All three outcomes touch Drive (read their copy, or write ours), so acquire a token up front - fork no longer
  // short-circuits before this (it now opens their edit as a tab, which needs a read).
  if (!token) { try { token = await getToken(); } catch { return; } }

  if (choice === 'keep') {   // Keep mine: overwrite their copy with my live master; re-baseline so it's no longer flagged.
    try {
      const meta = await writeFile(fileId, currentDiagramData(), null, token);
      copy.lastRevisionId = meta.headRevisionId || null; copy.lastPushedAt = Date.now(); copy.conflict = false;
      persistState(id, s); notify();
      showToast('Overwrote the shared copy with your version ✓', 'success');
    } catch { showError('Could not overwrite the shared copy.'); }
    return;
  }

  // Both "Keep both" and "Keep Google Drive" need to READ the recipient's edited copy first.
  let data;
  try {
    data = await fetchGraphAuthed(fileId);
    if (!data || !data.graph || !data.type) throw new Error('unreadable');
    pctx.sanitizeGraphJSON(data.graph);
    if (!(await pctx.checkVersionWarning(data.av || null, data.name || 'Shared copy', data))) return;
  } catch { showError('Could not open the shared copy.'); return; }

  if (choice === 'fork') {
    // Keep both: open their edit as its OWN separate tab, then unlink the copy (the master stops syncing to it). Both
    // survive as independent tabs. onImport (NOT adoptDriveFileIntoNewTab) so the sharer's tab keeps its own master.
    pctx.onImport(`${data.name || 'Shared copy'} (their copy)`, pctx.normalizeDiagramType(data.type), data.graph, data.viewport || null, data.mappingMode);
    s.copies = removeCopy(s.copies, fileId); persistState(id, s); notify();
    showToast('Kept both - their copy opened in a new tab ✓', 'success');
    return;
  }

  // choice === 'pull' → Keep Google Drive: accept their edit IN PLACE, mirroring the master B3 pull. The sharer keeps
  // owning their OWN master file (s.fileId is untouched); we just replace the canvas with the recipient's content and
  // mark the tab dirty so the next save persists the accepted content to the master (fan-out then re-converges the
  // copy). Re-baseline the copy to its current head so it isn't re-flagged.
  if (pctx.onReplaceActive) {
    pctx.onReplaceActive(data.name || 'Shared copy', pctx.normalizeDiagramType(data.type), data.graph, data.viewport || null, data.mappingMode);
    copy.conflict = false; copy.lastPushedAt = Date.now();
    try { copy.lastRevisionId = (await remoteMeta(fileId, token)).headRevisionId || null; } catch { copy.lastRevisionId = null; }
    // Persist the accepted content to the sharer's OWN master RIGHT AWAY (with explicit "saved" feedback). The canvas
    // swap (onReplaceActive) fires NO graph-change event to arm the autosave timer, so without this the accept sits
    // unsaved and Version History wouldn't show it (the reported gap). NULL `s.headRevisionId` so doSave SKIPS its
    // cross-device lost-update GET and writes UNCONDITIONALLY: accepting their version is a deliberate overwrite of our
    // own master (a real master cross-device change would already be a separate `s.conflict`, surfaced before here),
    // and the GET could otherwise fail-closed or false-positive and silently leave the tab unsaved. interactive:false
    // → no immediate fan-out back to the copy (it already holds this content). doSave re-baselines s.headRevisionId.
    s.dirty = true; s.lastHash = null; s.headRevisionId = null;
    persistState(id, s); notify();
    try { await doSave(id, { interactive: false }); showToast('Switched to their version - saved ✓', 'success'); }
    catch { showToast('Switched to their version ✓ - will finish saving shortly.', 'info'); }
  } else {   // defensive fallback (in-place replace unavailable) → open in a new tab
    pctx.onImport(`${data.name || 'Shared copy'} (their copy)`, pctx.normalizeDiagramType(data.type), data.graph, data.viewport || null, data.mappingMode);
    copy.conflict = false;
    try { copy.lastRevisionId = (await remoteMeta(fileId, token)).headRevisionId || null; } catch { copy.lastRevisionId = null; }
    persistState(id, s); notify();
    showToast("Opened their version in a new tab ✓", 'success');
  }
}

/** Navbar "Sync paused — review" entry point: resolve whatever diverged on the active tab. A master
 *  conflict first (re-runs the guarded save, which pops its Pull/Keep/Fork modal), else the first
 *  diverged shared copy. Clicking again handles the next, until the tab is back in sync. */
export async function resolveActiveConflict() {
  const id = activeTabId();
  const s = driveByTab.get(id);
  if (!s) return;
  if (s.conflict) { await doSave(id, { interactive: true }); return; }
  const copy = (s.copies || []).find((c) => c && c.conflict);
  if (copy) { await resolveCopyConflict(copy.fileId); return; }
  showToast("Nothing to resolve - you're in sync ✓", 'info');
}

/**
 * Multi-select Save/Share: save each given OPEN tab to Drive (signs in ONCE up front so the loop
 * never pops N consent dialogs, and saves silently so there's no per-tab toast spam), optionally
 * make each "anyone with link" and return a short #gd= URL. Returns a per-tab result list for the
 * picker to render: { tabId, name, status: 'ok' | 'empty' | 'error', fileId?, shareUrl?, error? }.
 * Errors are per-tab — one bad diagram never aborts the rest.
 */
export async function saveTabsToDrive(tabIds, { share = false } = {}) {
  if (!isDriveConfigured()) throw new Error('Google Drive is not configured for this origin.');
  const ids = Array.isArray(tabIds) ? tabIds : [];
  if (!ids.length) return [];
  if (!tokenValid()) await getToken({ prompt: '' });   // one sign-in for the batch
  // Verify the targets' Drive links before saving: an explicit "Save to My Drive" must actually land, so probe
  // for dead links (file deleted/trashed in Drive) and clear them — otherwise the content-hash dedupe in doSave
  // would report "up to date" and silently no-op the write. reconcileDriveLinks clears dead own-master links so
  // the doSave below CREATEs a fresh file instead of skipping.
  try { await reconcileDriveLinks(); } catch { /* non-fatal — doSave's own self-heal is the backstop */ }
  const byId = new Map((pctx.getAllTabs ? pctx.getAllTabs() : []).map((t) => [t.id, t]));
  const results = [];
  for (const id of ids) {
    const tab = byId.get(id);
    const name = tab?.name || 'Diagram';
    if (!tab) { results.push({ tabId: id, name, status: 'error', error: 'tab not found' }); continue; }
    const data = dataForTab(tab);
    if (!data.graph || !(data.graph.cells && data.graph.cells.length)) {
      results.push({ tabId: id, name, status: 'empty' }); continue;   // skip empty diagrams
    }
    try {
      await doSave(id, { interactive: false, data });   // token already obtained ⇒ saves silently
      const s = tabState(id);
      if (!s.fileId) { results.push({ tabId: id, name, status: 'error', error: 'not signed in' }); continue; }
      let shareUrl = null;
      // Reuse the batch token (don't let shareAnyone fire its own getToken — a redundant GIS round-trip that
      // re-popped the account picker even though we're already signed in).
      if (share) { await shareAnyone(s.fileId, tokenValid() ? _accessToken : null); shareUrl = getDriveShareUrl(s.fileId); }
      results.push({ tabId: id, name, status: 'ok', fileId: s.fileId, shareUrl });
    } catch (e) {
      results.push({ tabId: id, name, status: 'error', error: e.message || 'error' });
    }
  }
  notify();   // per-tab driveByTab state changed → refresh the navbar control
  return results;
}

/** Adopt a read `.dgf` envelope as a new tab linked to `fileId` (shared by the anonymous + authed open paths).
 *  Returns false only when the data isn't a readable Diagramforce diagram. */
async function adoptSharedDiagram(data, fileId) {
  if (!data || !data.graph || !data.type) return false;
  pctx.sanitizeGraphJSON(data.graph);
  const ok = await pctx.checkVersionWarning(data.av || null, data.name || 'Shared diagram', data);
  if (!ok) return true;   // version warning declined — handled, nothing more to do
  // Mode C: if the recipient is signed in and already forked their own "(changed)" copy of this shared file, offer
  // to open THAT instead of a fresh view (best-effort; needs a token for the My-Drive listing, so anonymous opens
  // just skip the offer and view the original).
  if (tokenValid()) {
    const fork = await offerExistingFork(fileId, data.name || 'Shared diagram');
    if (fork) { await importDriveFileById(fork.id, fork.name, _accessToken, { assumeOwned: true }); return true; }
  }
  pctx.onImport(data.name || 'Shared diagram', pctx.normalizeDiagramType(data.type), data.graph, data.viewport || null, data.mappingMode);
  const s = tabState(activeTabId());
  // Shared File model: the opened file is the upstream SOURCE, not the user's file. Track it as `sharedSource`
  // (no own master yet — created on the first save) so the tab can keep its own My Drive copy AND, if the user
  // has writer permission, fan edits back to the source. `imported` stays false — the new model supersedes it.
  s.fileId = null; s.imported = false;
  s.sharedSource = { fileId, canEdit: null, lastRevisionId: null, lastPushedAt: 0, conflict: false };
  s.headRevisionId = null; s.lastHash = null; s.lastSavedAt = Date.now();
  persistState(activeTabId(), s); notify();
  showToast('Opened shared Google Drive diagram ✓', 'success');
  // A #gd= link can't probe canEdit here, so it opens as a VIEW (Copy) share (canEdit null) and creates NOTHING on
  // open - Mode C: it forks to a "<name> (changed)" My-Drive copy on the first edit. Only a KNOWN-editable share
  // (canEdit === true, never the case on this path) would eager-mint its working copy.
  if (s.sharedSource.canEdit === true) ensureSharedWorkingCopy(activeTabId()).catch(() => {});
  return true;
}

/** Open a `#dfg=` group share link: read each member file (anon → authed fallback), then re-assemble the
 *  group on the recipient side via the existing group-import handler (recreates the named group + opens each
 *  diagram as a grouped tab — the recipient's own copy, the "view/copy" model). Public files read with no
 *  sign-in; any member that can't be read is skipped (we report how many opened). Returns true if ≥1 opened. */
export async function openGroupFromLink({ name = 'Group', ids = [], color = null, icon = null } = {}) {
  if (!isDriveConfigured()) { showError("This is a Google Drive group link, but Drive isn't set up on this site yet."); return false; }
  if (!Array.isArray(ids) || !ids.length || !pctx.onImportGroup) return false;
  const diagrams = [];
  let oldestAv = null;
  for (const fileId of ids) {
    let data = null;
    try { data = await fetchPublicGraph(fileId); }                                  // public read (no sign-in)
    catch { try { data = await fetchGraphAuthed(fileId); } catch { data = null; } } // private member → needs the recipient's access
    if (!data || !data.graph || !data.type) continue;
    pctx.sanitizeGraphJSON(data.graph);
    if (data.av && (!oldestAv || compareSemver(data.av, oldestAv) < 0)) oldestAv = data.av;
    diagrams.push({
      name: data.name || 'Diagram',
      diagramType: pctx.normalizeDiagramType(data.type),
      graph: data.graph,
      viewport: data.viewport || null,
      mappingMode: !!data.mappingMode,
      group: name,
    });
  }
  if (!diagrams.length) return false;   // nothing readable → caller shows the generic share-load error
  // One version check for the whole group (the oldest member drives the warning), mirroring the single-file open.
  const ok = await pctx.checkVersionWarning(oldestAv, `Group "${name}"`, null);
  if (!ok) return true;   // declined — handled, nothing more to do
  pctx.onImportGroup([{ name, icon: icon || null, color: color || null }], diagrams);
  const skipped = ids.length - diagrams.length;
  showToast(`Opened shared group "${name}" - ${diagrams.length} diagram${diagrams.length === 1 ? '' : 's'}${skipped ? ` (${skipped} couldn't be opened)` : ''} ✓`, skipped ? 'warning' : 'success');
  return true;
}

/** Open a `#gd=<fileId>` share link: zero-sign-in anonymous read first, authed direct-open fallback. */
export async function loadDriveRef(fileId) {
  try {
    const data = await fetchPublicGraph(fileId);
    if (!(await adoptSharedDiagram(data, fileId))) throw new Error('not a Diagramforce diagram');
    return true;
  } catch {
    if (!isDriveConfigured()) {
      // No Google config on this origin (e.g. prod creds not registered yet) → the link
      // can't be read here. One clear message, not the confusing Picker→"not configured" pair.
      showError("This is a Google Drive share link, but Drive isn't set up on this site yet.");
      return false;
    }
    // Private share / very large file / Workspace policy blocked the anonymous read → the recipient must be
    // signed in. If we ALREADY hold a live token this session, open it straight away - no overlay, no second
    // sign-in (item 10). Otherwise this runs on PAGE LOAD with no user gesture, so we can't pop the sign-in
    // ourselves; show an actionable modal whose button IS the gesture and opens THIS file directly.
    if (tokenValid()) { openSharedFileAuthed(fileId); return true; }
    showRestrictedOpenModal(fileId);
    return true;
  }
}

/** Sign in (the click is the required gesture), then read + open the specific shared file the `#gd=` link
 *  names — directly, NOT via the Picker. Falls back to the Picker only if the direct authed read fails (e.g.
 *  the user signed in with an account that wasn't granted access). */
async function openSharedFileAuthed(fileId) {
  try {
    await getToken({ prompt: '' });
    const data = await fetchGraphAuthed(fileId);
    if (!(await adoptSharedDiagram(data, fileId))) showError("That file isn't a readable Diagramforce diagram.");
  } catch (e) {
    if (e && e.status === 401) { _accessToken = null; notify(); }
    console.error('Diagramforce: open shared file failed:', e);
    // 404 (item #11, confirmed with a recipient account): under the `drive.file` scope a recipient CANNOT
    // files.get a file they didn't create or open via the Picker - so a valid private share still 404s on a
    // direct read. It is NOT "moved or removed". The Picker's "Shared with me" view grants per-file access;
    // importDriveFileById then adopts it (editable when they hold writer). Lead them straight there.
    if (e?.status === 404) {
      showToast("This diagram was shared with you privately - find it under 'Shared with me' to open it.", 'info', { duration: 6000 });
      openFromDrive({ sharedFirst: true, title: "Open your shared diagram - look under 'Shared with me'" });
      return;
    }
    // 403 = this Google account genuinely isn't the one the file was shared to.
    const detail = e && e.message ? ` (${e.message})` : '';
    showError(e?.status === 403
      ? 'This Google account does not have access to that diagram. Open it with the account it was shared to.'
      : `Could not open the shared diagram${detail}.`);
    openFromDrive();   // last resort: let them locate it with the right account
  }
}

/** Actionable overlay for a `#gd=` link whose file isn't public (shared with the org / specific people). The
 *  button provides the user gesture the sign-in popup needs, then opens THAT file (the link already has its id). */
function showRestrictedOpenModal(fileId) {
  document.querySelector('.df-drive-open-modal')?.remove();
  const { footer, close } = buildModal({
    title: 'Sign in to open this diagram',
    className: 'df-drive-open-modal',
    width: '440px',
    bodyStyle: 'padding:16px 20px',
    bodyHtml: `<p style="margin:0;color:var(--text-secondary);line-height:1.5">This diagram has been shared privately. Sign in to your Google account to open this diagram if you have been invited.</p>`,
    footerHtml: '<button class="df-modal__btn" data-act="cancel">Cancel</button><button class="df-modal__btn df-modal__btn--primary" data-act="open" style="margin-left:auto">Sign in &amp; open</button>',
  });
  footer.querySelector('[data-act="cancel"]')?.addEventListener('click', close);
  footer.querySelector('[data-act="open"]')?.addEventListener('click', () => { close(); openSharedFileAuthed(fileId); });
}

/** Authenticated read of a file the signed-in user can access (private share / app-created). */
async function fetchGraphAuthed(fileId) {
  const token = await getToken();
  const res = await fetch(`${API}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) { const err = new Error(await readErr(res)); err.status = res.status; throw err; }   // .status lets the caller report 403 vs 404
  return JSON.parse(await res.text());
}

// ── Custom Templates library sync (item 17, v1.17.0) ─────────────────────────
// The WHOLE templates library is one Drive file - a plain application/json file marked
// `appProperties.dfKind='templates'` so it does NOT show in the diagram library (myDiagramsQuery matches
// `.dgf`/DGF_MIME only). Cross-device model: pull+merge on connect/boot, push on local change. Deletes
// PROPAGATE via tombstones carried in the file's `deleted` list (the merge + confirm overlay live in
// templates.js / util.mergeTemplatesWithTombstones; see Diagramforce-Sync.md §8.4). Both fns are
// OPPORTUNISTIC: they use an existing valid token and NEVER pop a sign-in (the caller guarantees one).
const LS_TEMPLATES_FILE = 'df.gdrive.templatesFileId';
const TEMPLATES_QUERY = "appProperties has { key='dfKind' and value='templates' } and trashed = false";
let _templatesFileId = null;
let _templatesHash = null;   // hash of the last-synced {templates, deleted}, so an unchanged push no-ops (no revision)

function templatesFileId() { return _templatesFileId || localStorage.getItem(LS_TEMPLATES_FILE) || null; }
function setTemplatesFileId(id) {
  _templatesFileId = id || null;
  try { if (id) localStorage.setItem(LS_TEMPLATES_FILE, id); else localStorage.removeItem(LS_TEMPLATES_FILE); }
  catch { /* private mode */ }
}

async function findTemplatesFile(token) {
  const cached = templatesFileId();
  if (cached) return cached;
  const res = await fetch(`${API}?q=${encodeURIComponent(TEMPLATES_QUERY)}&fields=files(id)&spaces=drive&pageSize=1&orderBy=modifiedTime desc&supportsAllDrives=true`, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) return null;
  const j = await res.json();
  const id = j.files?.[0]?.id || null;
  if (id) setTemplatesFileId(id);
  return id;
}

/** Read the Drive templates library file → `{ templates, deleted }` (or null when none exists / unreadable /
 *  no token). `deleted` is the tombstone list (back-compat: a pre-tombstone file has none). Sets the dedupe
 *  baseline so an identical push right after a pull is a no-op. */
export async function pullTemplates() {
  if (!isDriveConfigured() || !tokenValid()) return null;
  const token = _accessToken;
  try {
    const id = await findTemplatesFile(token);
    if (!id) return null;
    const res = await fetch(`${API}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) { if (res.status === 404) setTemplatesFileId(null); return null; }
    const data = JSON.parse(await res.text());
    const templates = Array.isArray(data?.templates) ? data.templates : [];
    const deleted = Array.isArray(data?.deleted) ? data.deleted : [];
    _templatesHash = hashStr(JSON.stringify({ t: templates, d: deleted }));
    return { templates, deleted };
  } catch (e) { console.warn('Diagramforce: pullTemplates failed', e); return null; }
}

/** Write the templates library + its tombstone list to the single Drive file (create or in-place update).
 *  Content-hash deduped on `{templates, deleted}` so an unchanged library never burns a Drive revision. No-ops
 *  (returns false) without a valid token. Returns true on a write or a dedupe skip. */
export async function pushTemplates(templates, deleted = []) {
  if (!isDriveConfigured() || !tokenValid()) return false;
  const arr = Array.isArray(templates) ? templates : [];
  const del = Array.isArray(deleted) ? deleted : [];
  const contentHash = hashStr(JSON.stringify({ t: arr, d: del }));
  if (templatesFileId() && _templatesHash === contentHash) return true;   // unchanged → skip (no revision)
  const token = _accessToken;
  try {
    const id = templatesFileId() || await findTemplatesFile(token);
    const payload = JSON.stringify({ schema: 'diagramforce-templates', version: 1, av: pctx.appVersion || null, updatedAt: Date.now(), templates: arr, deleted: del });
    const appProperties = { dfKind: 'templates', dfCount: String(arr.length) };
    const boundary = 'dft_' + Math.abs(hashStr(payload)).toString(36);
    let res;
    if (id) {
      res = await fetch(`${UPLOAD}/${encodeURIComponent(id)}?uploadType=multipart&fields=id&supportsAllDrives=true`, {
        method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + boundary },
        body: multipartBody({ appProperties }, payload, boundary),
      });
    } else {
      const folderId = await ensureFolder(token);
      const metadata = { name: 'Diagramforce Templates.json', mimeType: 'application/json', appProperties };
      if (folderId) metadata.parents = [folderId];
      res = await fetch(`${UPLOAD}?uploadType=multipart&fields=id&supportsAllDrives=true`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + boundary },
        body: multipartBody(metadata, payload, boundary),
      });
    }
    if (!res.ok) { if (res.status === 404) setTemplatesFileId(null); return false; }
    const j = await res.json();
    if (j.id) setTemplatesFileId(j.id);
    _templatesHash = contentHash;
    return true;
  } catch (e) { console.warn('Diagramforce: pushTemplates failed', e); return false; }
}

/** Does the ACTIVE tab map to a Drive file — an own master OR an upstream shared source it was opened from? */
export function activeHasDriveFile() {
  const s = driveByTab.get(activeTabId());
  return !!(s && (s.fileId || (s.sharedSource && s.sharedSource.fileId)));
}

/** Was the ACTIVE diagram OPENED from a SHARED file (a `#gd=` link)? Gates "Refresh from sender" — refreshing
 *  pulls the upstream source's latest. Covers the new Shared File model + legacy imported tabs. */
export function activeIsImported() {
  const s = driveByTab.get(activeTabId());
  return !!(s && ((s.sharedSource && s.sharedSource.fileId) || (s.imported && s.fileId)));
}

/** Re-fetch the ACTIVE tab's UPSTREAM source and import the LATEST version (as a new tab) — but only if it
 *  differs from what's open. Reads the shared SOURCE (the sender's file) when the tab was opened from a `#gd=`
 *  link, else the own master. Public files read anonymously; private ones via an authed read (signs in). */
/** Clear a tab's 'refresh' signal + null the baselines so the next sweep re-seeds silently to the pulled head. */
function clearUpstreamRefresh(id, s) {
  if (!s) return;
  let changed = false;
  if (s.sharedSource && s.sharedSource.upstreamChanged) { s.sharedSource.upstreamChanged = false; s.sharedSource.lastRevisionId = null; changed = true; }
  if (s.upstreamChanged) { s.upstreamChanged = false; s.upstreamAuthor = null; s.headRevisionId = null; changed = true; }
  if (changed) { persistState(id, s); notify(); }
}

export async function reopenLatestFromDrive() {
  const id = activeTabId();
  const s = driveByTab.get(id);
  const srcId = (s && s.sharedSource && s.sharedSource.fileId) || (s && s.fileId);
  if (!srcId) { showToast("This diagram isn't linked to a Google Drive file.", 'info'); return; }
  let data;
  try { data = await fetchPublicGraph(srcId); }            // public → anonymous, no sign-in
  catch {
    try { data = await fetchGraphAuthed(srcId); }          // private → authed (signs in if needed)
    catch { showError('Could not read the latest version from Google Drive.'); return; }
  }
  if (!data || !data.graph || !data.type) { showError('Could not read the latest version from Google Drive.'); return; }
  const mine = currentDiagramData();   // snapshot of YOUR current version, BEFORE any overwrite (for the diff + "Keep both")
  // Changed since what's open? Same content ⇒ nothing to import (just clear the nag).
  const same = hashStr(JSON.stringify(mine.graph)) === hashStr(JSON.stringify(data.graph));
  if (same) { clearUpstreamRefresh(id, s); showToast('You already have the latest version ✓', 'info'); return; }
  pctx.sanitizeGraphJSON(data.graph);
  const ok = await pctx.checkVersionWarning(data.av || null, data.name || 'Diagram', data);
  if (!ok) return;
  const type = pctx.normalizeDiagramType(data.type);

  // DIRECT-EDIT shared file (you can edit it): refreshing could overwrite YOUR version, so offer an explicit choice -
  // accept the latest in place, or keep your version as a SEPARATE diagram. (No "Keep mine" push-back: that's the
  // sharer's overwrite-Drive option.) Best-effort side-by-side diff preview, like the sharer's Review modal.
  if (s && s.sharedInEdit && pctx.onReplaceActive) {
    let preview = {};
    if (pctx.renderThumbnail) {
      const noGhost = (d) => ({ added: d.added, removed: d.removed, changed: d.changed });
      preview = {
        localPreview: { graph: mine.graph, shapes: countDiagramShapes(mine.graph.cells), by: 'you', when: '', diff: noGhost(diffGraphs(data.graph, mine.graph)) },
        remotePreview: { graph: data.graph, shapes: countDiagramShapes(data.graph.cells), by: s.upstreamAuthor || '', when: '', diff: noGhost(diffGraphs(mine.graph, data.graph)) },
      };
    }
    const choice = await showConflictModal({ ...conflictActions('refresh'), ...preview });
    if (!choice) return;   // dismissed → leave the refresh signal up for later
    pctx.onReplaceActive(data.name || 'Diagram', type, data.graph, data.viewport || null, data.mappingMode);
    clearUpstreamRefresh(id, s);
    if (choice === 'fork') {
      // Keep both: the latest now fills THIS (linked) tab; re-open your prior version as a NEW independent diagram.
      pctx.onImport(`${mine.name || 'Diagram'} (your version)`, pctx.normalizeDiagramType(mine.type), mine.graph, mine.viewport || null, mine.mappingMode);
      showToast('Kept both - your version is now a separate diagram ✓', 'success');
    } else {
      showToast('Refreshed to the latest version ✓', 'success');
    }
    return;
  }

  // Other cases (a view you only READ, or a fork that's your OWN file): keep the existing behaviour. A pure clean view
  // pulls IN PLACE (nothing of yours to preserve); a fork (s.fileId + s.sharedSource) or unsaved edits open the latest
  // in a NEW tab so your own work is never clobbered. (A fork is "clean" right after its auto-save, so the dirty flag
  // alone isn't enough - the own-master check protects a saved fork.)
  clearUpstreamRefresh(id, s);
  const activeTab = (pctx.getAllTabs ? pctx.getAllTabs() : []).find((t) => t.isActive);
  const clean = activeTab ? !activeTab.dirty : false;
  const hasOwnFork = !!(s && s.fileId && s.sharedSource && s.sharedSource.fileId);
  if (clean && !hasOwnFork && pctx.onReplaceActive) {
    pctx.onReplaceActive(data.name || 'Diagram', type, data.graph, data.viewport || null, data.mappingMode);
    showToast('Refreshed to the latest version ✓', 'success');
  } else {
    pctx.onImport(`${data.name || 'Diagram'} (original)`, type, data.graph, data.viewport || null, data.mappingMode);
    showToast('Opened the original in a new tab - your copy is kept ✓', 'success');
  }
}

// ── Phase 3: Version history (Drive per-file revisions) ──────────────────────────
/** The active tab's Drive file id (the master / opened file whose history we show), or null. */
function activeFileId() { return driveByTab.get(activeTabId())?.fileId || null; }
/** A usable token, reusing a still-valid cached one; prompts consent only on a first connect. Throws if declined. */
function ensureToken() { return tokenValid() ? Promise.resolve(_accessToken) : getToken({ prompt: '' }); }
/** Read a specific revision's `.dgf` content (the diagram envelope). Throws (typed `.status`) on a Drive error. */
async function fetchRevisionData(fileId, revisionId, token) {
  const res = await fetch(`${API}/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revisionId)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) { const e = new Error(await readErr(res)); e.status = res.status; throw e; }
  return JSON.parse(await res.text());
}

/**
 * List the ACTIVE diagram's Drive revisions, NEWEST-FIRST: {id, modifiedTime, size, sizeLabel, keepForever,
 * by}. Throws on a Drive error (the History modal surfaces it). `drive.file` is *expected* to grant revisions
 * on app-created files; a 403 here just degrades to the modal's error state. [] when the tab has no file.
 */
export async function listRevisions() {
  if (!isDriveConfigured()) throw new Error('Google Drive is not configured for this origin.');
  const fileId = activeFileId();
  if (!fileId) return [];
  const token = await ensureToken();
  const fields = 'revisions(id,modifiedTime,size,keepForever,lastModifyingUser(displayName,emailAddress,me))';
  const res = await fetch(`${API}/${encodeURIComponent(fileId)}/revisions?fields=${encodeURIComponent(fields)}&pageSize=200&supportsAllDrives=true`, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error(await readErr(res));
  return sortRevisions((await res.json()).revisions || []).map((r) => ({
    id: r.id, modifiedTime: r.modifiedTime || null, size: r.size != null ? Number(r.size) : null,
    sizeLabel: revisionSizeLabel(r.size), keepForever: !!r.keepForever,
    by: revisionAuthorLabel(r.lastModifyingUser),   // own save → "you" (Drive's `me`); else email when given, else name
  }));
}

/**
 * READ a revision's content for in-place inspection (thumbnail + element count) WITHOUT opening a tab. Returns
 * the sanitized { name, type, graph, viewport } or null if it isn't a readable Diagramforce diagram / on a Drive
 * error. Drive-only; the History modal's per-version eye-preview uses it. Never mutates the active diagram.
 */
export async function readRevision(revisionId) {
  const fileId = activeFileId();
  if (!fileId) return null;
  try {
    const token = await ensureToken();
    const data = await fetchRevisionData(fileId, revisionId, token);
    if (!data || !data.graph || !data.type) return null;
    pctx.sanitizeGraphJSON(data.graph);
    return { name: data.name || null, type: pctx.normalizeDiagramType(data.type), graph: data.graph, viewport: data.viewport || null };
  } catch (e) {
    if (e && e.status === 401) { _accessToken = null; notify(); }   // surface re-auth via the navbar, then degrade
    return null;
  }
}

/** VIEW a past revision: open it READ-ONLY (a new UNLINKED tab) for inspection — editing+saving it forks a
 *  fresh diagram, it can't overwrite the master. Returns true on success. */
export async function viewRevision(revisionId, fallbackName) {
  const fileId = activeFileId();
  if (!fileId) { showError("This diagram isn't linked to a Google Drive file."); return false; }
  try {
    const token = await ensureToken();
    const data = await fetchRevisionData(fileId, revisionId, token);
    if (!data || !data.graph || !data.type) { showError("That version isn't a readable Diagramforce diagram."); return false; }
    pctx.sanitizeGraphJSON(data.graph);
    const ok = await pctx.checkVersionWarning(data.av || null, data.name || fallbackName || 'Diagram', data);
    if (!ok) return false;
    pctx.onImport(`${data.name || fallbackName || 'Diagram'} (older version)`, pctx.normalizeDiagramType(data.type), data.graph, data.viewport || null, data.mappingMode);
    notify();   // a new (unlinked) tab is active — refresh the navbar
    showToast('Opened an older version (read-only copy) ✓', 'success');
    return true;
  } catch (e) {
    showError('Could not open that version: ' + (e?.message || 'see console.'));
    return false;
  }
}

/**
 * RESTORE a past revision: re-upload its content as a NEW head revision (non-destructive — the current
 * version is pushed into history, fully recoverable), then make it the working tab via the shared
 * adopt-into-new-tab path (prior tab unlinked as a local backup). Intentionally un-guarded: restoring only
 * ADDS a revision, so a concurrent remote change is preserved, not lost. Returns true on success.
 */
export async function restoreRevision(revisionId) {
  const id = activeTabId();
  const fileId = activeFileId();
  if (!fileId) { showError("This diagram isn't linked to a Google Drive file."); return false; }
  try {
    const token = await ensureToken();
    const data = await fetchRevisionData(fileId, revisionId, token);
    if (!data || !data.graph || !data.type) { showError("That version isn't a readable Diagramforce diagram."); return false; }
    // Sanitize + version-check BEFORE the irreversible writeFile, so declining the version warning leaves
    // the master untouched (writeFile-then-decline would otherwise mutate Drive with no tab adopting it).
    pctx.sanitizeGraphJSON(data.graph);
    const proceed = await pctx.checkVersionWarning(data.av || null, data.name || 'Diagram', data);
    if (!proceed) return false;
    await writeFile(fileId, data, null, token);   // old content → new head revision
    const s = tabState(id);
    const ok = await adoptDriveFileIntoNewTab({ oldTabId: id, data, fileId, copies: s.copies, label: `${data.name || 'Diagram'} (restored)`, token, alreadyValidated: true });
    if (ok) showToast('Restored an earlier version - your previous version is kept in history ✓', 'success');
    return ok;
  } catch (e) {
    if (e && e.status === 401) { _accessToken = null; notify(); showError('Google sign-in expired - click the Drive icon to sign in again.'); }
    else showError('Could not restore that version: ' + (e?.message || 'see console.'));
    return false;
  }
}

/** PIN / UNPIN a revision (`keepForever`) so Drive's ~30-day / 100-revision auto-purge won't remove it. */
export async function pinRevision(revisionId, keep) {
  const fileId = activeFileId();
  if (!fileId) { showError("This diagram isn't linked to a Google Drive file."); return false; }
  try {
    const token = await ensureToken();
    const res = await fetch(`${API}/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revisionId)}?supportsAllDrives=true`, {
      method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ keepForever: !!keep }),
    });
    if (!res.ok) throw new Error(await readErr(res));
    return true;
  } catch (e) {
    showError('Could not update the pin: ' + (e?.message || 'see console.'));
    return false;
  }
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}

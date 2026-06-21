// Pure, zero-dependency sync helpers for the Drive remote store (Phase 2: editable copies +
// fan-out + divergence detection). NO imports, NO Drive/DOM — so the conflict + fan-out logic is
// unit-testable in isolation. remote-store.js imports these (with a ?v= cache-bust); the unit test
// imports THIS file directly (raw path, no ?v=), exactly like df-format.js / myDiagramsQuery.

/**
 * Has a Drive file's head revision moved since we last wrote/read it? Drive stamps a new
 * `headRevisionId` on every content update, so an id that differs from our stored baseline means
 * someone else (another device, or a share recipient) changed the file under us. Both must be known —
 * a missing baseline (first write, legacy tab) is treated as "no known conflict", never a false alarm.
 */
export function revisionMoved(known, remote) {
  return !!(known && remote && known !== remote);
}

/** Insert-or-update a fan-out copy target by fileId. Returns a NEW array (never mutates input). */
export function upsertCopy(copies, copy) {
  const list = Array.isArray(copies) ? copies.slice() : [];
  const i = list.findIndex((c) => c && c.fileId === copy.fileId);
  if (i >= 0) list[i] = { ...list[i], ...copy };
  else list.push({ ...copy });
  return list;
}

/** Remove a fan-out copy target by fileId (Fork on a diverged copy = unlink it). Returns a new array. */
export function removeCopy(copies, fileId) {
  return (Array.isArray(copies) ? copies : []).filter((c) => c && c.fileId !== fileId);
}

/**
 * Title + plain-language framing + per-option descriptions for the 3-way Pull / Keep / Fork dialog, by
 * divergence context. Written for non-technical users (e.g. business analysts): the labels say what HAPPENS,
 * the `intro` explains the situation and reassures that nothing is deleted, and each `*Desc` spells out the
 * consequence of that choice. The three verbs still map to the same code outcomes:
 *  - 'master': the user's own file changed on another device (cross-device lost-update).
 *  - 'copy'  : a shared editable copy was changed by its recipient (fan-out would clobber them).
 * pull = open theirs (no data loss), keep = overwrite remote with mine, fork = split into a separate file.
 */
export function conflictActions(context) {
  // Buttons render left→right as keep · fork · pull (showConflictModal), so the order reads
  // "Keep mine · Keep both · Keep Google Drive" - the user-confirmed framing.
  if (context === 'copy') {
    // Same three outcomes as 'master' (keep mine / keep both / accept theirs), framed for the SHARER whose recipient
    // edited the shared copy: keep = overwrite their copy with mine; fork = open their edit as its own tab + stop
    // syncing it (both survive as separate tabs); pull = accept their edit IN PLACE on my screen.
    return {
      title: 'Someone edited your shared copy',
      intro: "The person you shared this with has changed their copy on Google Drive. Pick which to keep; nothing is deleted - the other stays in Google Drive's version history.",
      keepLabel: 'Keep mine',          keepDesc: "Save your screen over their copy. Their version moves to Google Drive's history.",
      forkLabel: 'Keep both',          forkDesc: 'Their copy opens in its own tab as a separate diagram; you keep yours unchanged.',
      pullLabel: 'Keep Google Drive',  pullDesc: 'Replace your screen with their version, in place. Choose Keep both to keep yours in a separate tab too.',
    };
  }
  if (context === 'refresh') {
    // RECEIVER side: the shared file you hold gained upstream changes. Two outcomes only - accept the latest in place,
    // or keep your version as a separate diagram. NO "Keep mine" (that would push your version back as the canonical
    // one - that's the sharer's overwrite-Drive option, not yours). keepLabel:'' → showConflictModal drops that option.
    return {
      title: 'The shared file has new changes',
      intro: "This file changed on Google Drive. Pick what to do; nothing is deleted - the other version stays in Google Drive's history.",
      keepLabel: '',                   keepDesc: '',
      forkLabel: 'Keep both',          forkDesc: 'Load the latest here, and keep your current version as a separate diagram.',
      pullLabel: 'Keep Google Drive',  pullDesc: 'Replace your screen with the latest version.',
    };
  }
  return { // 'master'
    title: 'Review changes',
    intro: "You've edited this here, but a newer version is also in Google Drive - probably from another device. Pick which to keep.",
    keepLabel: 'Keep mine',            keepDesc: 'Save your screen over the Google Drive version. Theirs moves to history.',
    forkLabel: 'Keep both',            forkDesc: 'Yours becomes a new, separate diagram; the Google Drive one stays as is.',
    pullLabel: 'Keep Google Drive',    pullDesc: 'Replace your screen with the Google Drive version, in place. Unsaved edits here are discarded - choose Keep both to keep them.',
  };
}

/**
 * Fan-out (pushing the master to its shared copies) runs ONLY on interactive saves and the
 * close/hide flush — never on the periodic autosave tick. With N copies, each fan-out is N extra
 * round-trips (a metadata GET + maybe a PATCH); doing that every cadence interval would make
 * autosave heavy and burn quota. The master itself still autosaves on cadence as before.
 */
export function shouldFanOut({ interactive = false, flush = false } = {}) {
  return !!(interactive || flush);
}

/**
 * Sort a Drive `revisions.list` array NEWEST-FIRST by modifiedTime (Drive returns oldest-first). Pure +
 * non-mutating; a missing/unparseable modifiedTime sorts last (treated as oldest) so the list never throws.
 */
export function sortRevisions(revisions) {
  const t = (r) => { const n = Date.parse(r && r.modifiedTime); return Number.isNaN(n) ? -Infinity : n; };
  return (Array.isArray(revisions) ? revisions.slice() : []).sort((a, b) => t(b) - t(a));
}

/**
 * What to do when a Drive write FAILS with an HTTP status, for the OWN-master self-heal path. A 404 (the
 * file was trashed/deleted) or 403 (we lost access to a file we own) means the locally-stored fileId is a
 * dead link — 'recreate' clears it and writes a fresh master so the user's work isn't silently lost. Anything
 * else, and ANY failure on an IMPORTED share (which heals via the fork / shared-source path, not here), is
 * just 'report'. Pure so the branch is unit-tested without a live Drive.
 */
export function healDecision(status, { imported = false } = {}) {
  if (imported) return 'report';
  return (status === 404 || status === 403) ? 'recreate' : 'report';
}

/**
 * Of the tabs currently flagged `imported` (opened from a `#gd=` link), which actually point at a file the
 * signed-in user OWNS — i.e. its id is in their `listMyDiagrams` set? Those were mis-flagged (e.g. opened from
 * the user's own Drive library in a session before the imported:false fix, then persisted) and should sync as
 * masters, so this returns their tab ids to un-flag. Genuine third-party shares (id NOT owned) are left
 * imported. Pure: takes plain {id, fileId, imported} entries + a Set/array of owned file ids.
 */
export function importsToUnflag(entries, ownedIds) {
  const owned = ownedIds instanceof Set ? ownedIds : new Set(ownedIds || []);
  return (Array.isArray(entries) ? entries : [])
    .filter((e) => e && e.imported && e.fileId && owned.has(e.fileId))
    .map((e) => e.id);
}

/**
 * Is a probed Drive file (its `{mimeType, name}`) a recognizable Diagramforce master — one `listMyDiagrams`
 * would return? The `.dgf` identity is the vendor MIME OR the `.dgf` name suffix; matching EITHER keeps it
 * (so a Drive MIME downgrade is still caught by the name). It deliberately does NOT trust `appProperties.dfType`:
 * the app's in-place UPDATE path PATCHes appProperties onto whatever file the stored id points at WITHOUT
 * renaming it, so a legacy `.diagramforce.json` the app once saved over carries `dfType` yet is NOT a `.dgf`
 * master and never appears in the library — trusting appProperties left such a tab stuck forever "already up to
 * date" (the Data-360 bug). A file matching neither is a stale pointer at a non-`.dgf` file (legacy `.json` /
 * foreign pick); the reconcile clears the link so a fresh `.dgf` master is created. Real `.dgf` masters still
 * match by name/MIME, so a list lag/pagination never false-clears one into a duplicate. Pure: `dgfMime` is passed
 * in (the leaf has no imports), so the branch is unit-tested without a live Drive.
 */
export function isRecognizedDgfMaster(meta, dgfMime) {
  if (!meta) return false;
  if (dgfMime && meta.mimeType === dgfMime) return true;
  return /\.dgf$/i.test(meta.name || '');
}

/**
 * How should a file just opened from Drive be MODELLED — as the user's own `master`, or via the
 * `shared-source` (Shared File) model (own My Drive copy + write-back to the upstream)? A file picked from the
 * "Shared with me" / "Shared Drives" Picker views can be owned by SOMEONE ELSE; modelling that as a master
 * would write the owner's file directly and skip the user's own copy. We only choose `shared-source` on
 * POSITIVE evidence the file is foreign (`ownedByMe === false`):
 *  - `assumeOwned` true → 'master'. The library ("Your Drive diagrams") only lists the user's OWN masters, so
 *    that path passes this and skips the ownership probe entirely (no behaviour change, no extra round-trip).
 *  - ownedByMe === false → 'shared-source' (a genuine third-party file).
 *  - ownedByMe unknown (null) BUT `sharedWithMe` (a `sharingUser` was present → the file was explicitly shared WITH
 *    you) → 'shared-source'. Drive sometimes omits `ownedByMe` on a freshly-granted invite; without this a real Copy
 *    invite opened via the Picker would model as a master and lose the share-in glyph + Share details.
 *  - owned (true), or unknown with no share signal → 'master' (conservative: never mis-model an owned file as shared
 *    just because a metadata read hiccuped).
 * Pure so the branch is unit-tested without a live Drive.
 */
export function importedFileRole({ assumeOwned = false, ownedByMe = null, sharedWithMe = false } = {}) {
  if (assumeOwned) return 'master';
  // ownedByMe===false is the primary signal. But Drive can OMIT ownedByMe on a freshly-granted invite (null), which
  // used to fall through to 'master' and silently drop the share-in indicators (no glyph / no Share details) for a
  // genuine Copy invite opened via the Picker. `sharedWithMe` (a sharingUser was present - it can ONLY be set on a
  // file shared WITH you, never your own) rescues that case without mis-modelling an owned file as shared.
  if (ownedByMe === false || (ownedByMe == null && sharedWithMe)) return 'shared-source';
  return 'master';
}

/**
 * Decide whether to PUSH the user's edits to the upstream SHARED SOURCE file (the file a diagram was opened
 * from via a `#gd=` link). The user ALWAYS keeps their own My Drive master regardless; the source is a fan-out
 * target only when the user has writer permission AND the source hasn't moved under them since the last push:
 *  - canEdit false → 'skip-readonly' (a View share: never write to the sender's file)
 *  - source moved  → 'flag-conflict' (someone changed it; don't clobber, surface it for Refresh)
 *  - otherwise     → 'push'
 */
export function sharedSourcePushDecision({ canEdit = false, moved = false } = {}) {
  if (!canEdit) return 'skip-readonly';
  if (moved) return 'flag-conflict';
  return 'push';
}

/**
 * The Save Manager "Shared File" chip state for a tab opened from a shared source:
 *  - canEdit unknown/false → 'view'     (no check; your edits save to My Drive only)
 *  - conflict              → 'conflict' (no check; the source changed - Refresh to reconcile)
 *  - else                  → 'synced'   (check; your edits also save back to the source)
 */
export function sharedChipState({ canEdit = false, conflict = false } = {}) {
  if (!canEdit) return 'view';
  if (conflict) return 'conflict';
  return 'synced';
}

/**
 * Reconcile each OPEN own-master tab's Drive link against the user's actual owned files, so the three storage
 * views (Save Manager / Load Browser / Load Drive) all agree with Drive reality instead of trusting a stale or
 * never-set per-tab `fileId` pointer (the chip-honesty bug: a diagram genuinely in My Drive showed "My Drive"
 * OFF because THIS browser's tab carried no/old pointer). Returns ONLY two decisions:
 *   - 'keep'  : the tab's fileId is already a live owned file → leave it (CLAIMED so no other tab adopts it).
 *   - 'adopt' : the pointer is null/stale but an owned file with the SAME canonical name (`<name>.dgf`) exists and
 *               is unclaimed → a CANDIDATE to link to (carries the file's `fileId` + `headRevisionId`). The caller
 *               (reconcileTabDriveLinks) MUST content-verify and only adopt when the remote content matches the
 *               local tab, so a stale local tab never silently clobbers a newer remote file (review finding).
 * NO 'clear' action: clearing a genuinely-dead pointer stays with the probe-based `reconcileDriveLinks` (which
 * has a recently-saved guard), so a paginated/lagged list never false-clears a valid link into a duplicate.
 * Greedy + claim-tracked so two same-named tabs never adopt the SAME file. `ownedFiles` MUST already be
 * ownership-filtered by the caller (only files the user owns - never a foreign shared `.dgf`). Pure: takes plain
 * {id,name,fileId} tabs + owned {id,name,headRevisionId} files + `driveFileName(name)->"<name>.dgf"`.
 */
export function reconcileTabFileLinks(tabs, ownedFiles, driveFileName) {
  const owned = Array.isArray(ownedFiles) ? ownedFiles : [];
  const ownedById = new Map(owned.map((f) => [f.id, f]));
  const byName = new Map();   // canonical filename -> [file, ...] (insertion order)
  for (const f of owned) {
    const list = byName.get(f.name) || [];
    list.push(f);
    byName.set(f.name, list);
  }
  const claimed = new Set();
  const list = Array.isArray(tabs) ? tabs : [];
  const decisions = [];
  // Pass 1 — keep tabs whose pointer is already a live owned file (claim those ids first).
  for (const t of list) {
    if (t && t.fileId && ownedById.has(t.fileId)) { claimed.add(t.fileId); decisions.push({ tabId: t.id, action: 'keep' }); }
  }
  const kept = new Set(decisions.map((d) => d.tabId));
  // Pass 2 — adopt-by-name CANDIDATES for the rest (the caller content-verifies before applying). No 'clear':
  // clearing a genuinely-dead pointer stays with the probe-based reconcileDriveLinks (recently-saved guarded),
  // so a paginated/lagged list never false-clears a valid link into a duplicate (adversarial-review finding).
  for (const t of list) {
    if (!t || kept.has(t.tabId) || kept.has(t.id)) continue;
    if (t.fileId && ownedById.has(t.fileId)) continue;   // already handled in pass 1
    const wantName = driveFileName(t.name);
    const candidates = (byName.get(wantName) || []).filter((f) => !claimed.has(f.id));
    if (candidates.length) {
      const f = candidates[0];
      claimed.add(f.id);
      decisions.push({ tabId: t.id, action: 'adopt', fileId: f.id, headRevisionId: f.headRevisionId || null });
    }
    // else: no unclaimed name match → nothing to do (null/stale pointer left for the probe-reconcile to handle)
  }
  return decisions;
}

/**
 * Classify a tab's COLLABORATION role from its persisted Drive fields, for the tab-bar indicator (R7)
 * and the Share-status summary (R8). The question users care about: "do my edits here reach other
 * people?" Roles:
 *   - 'shared-in-edit' : opened from someone else's EDITABLE shared file (`sharedSource.canEdit === true`).
 *                        Your edits also write back to their file → they reach the owner.
 *   - 'shared-in-view' : opened from someone else's VIEW-ONLY file (`sharedSource` present, canEdit not true).
 *                        Your edits save to your OWN My Drive copy only → they reach no one else.
 *   - 'shared-out'     : YOUR own file that you've shared OUT as editable / Shared-Drive copies
 *                        (`copies` non-empty, no upstream source). Your edits fan out → they reach recipients.
 *   - 'shared-drive-master' : the file ITSELF lives on a team Shared Drive (`onSharedDrive`, i.e. its own driveId
 *                        is set), so everyone with access to that Drive can open + edit it. Your edits reach them.
 *                        Distinct from 'shared-out' (a My-Drive master that PUBLISHED a copy to a Shared Drive).
 *   - 'local'          : browser-only or your own un-shared My Drive master. Edits affect no one else.
 * `sharedSource` takes precedence over `copies`, which takes precedence over `onSharedDrive` (a received file you
 * re-shared is still, primarily, a file whose edits reach its owner). Pure: plain fields; unit-tested, no live Drive.
 */
export function tabShareRole({ copies = null, sharedSource = null, onSharedDrive = false, outgoingGrants = 0, ownFileId = null, sharedInEdit = false } = {}) {
  // Phase B: a Collab/received-editable file edited DIRECTLY (s.fileId IS the foreign-but-writable shared file, no
  // working copy). It reaches the owner + every other recipient and can be overwritten, so it reads 'shared-in-edit'
  // (glyph 'both') - same as the legacy write-back model below, just driven by the marker instead of a sharedSource.
  if (sharedInEdit) return 'shared-in-edit';
  if (sharedSource) {
    if (sharedSource.canEdit === true) return 'shared-in-edit';   // Collab (shared-in, write-back) - regardless of own master
    // A VIEW (Copy) share that has FORKED into the user's OWN My-Drive master (ownFileId set) is the user's own file -
    // its sharedSource is now just a refresh-only pointer to the original, NOT a "shared with you" classification. So
    // it falls through to the owned/local classification below (no shared glyph). Only an UN-forked view (no own
    // master yet) reads as 'shared-in-view'. (Mode C: the fork is your own file.)
    if (!ownFileId) return 'shared-in-view';
  }
  // A `mydrive-backup` copy is a PRIVATE one-way mirror of a Shared-Drive file into the user's own My Drive - it
  // reaches no one else, so it must NOT count toward 'shared-out' (else the tab would wrongly show the outgoing
  // "shared with others" glyph). Only genuine recipient/Shared-Drive copies count.
  const copyCount = Array.isArray(copies) ? copies.filter((c) => c && c.kind !== 'mydrive-backup').length : 0;
  // `outgoingGrants` = direct view/edit invites granted on the master (a permission, NOT a copy file) - they DO reach
  // other people, so a master shared only via Invite still reads 'shared-out' (and shows the tab glyph).
  if (copyCount > 0 || outgoingGrants > 0) return 'shared-out';
  if (onSharedDrive) return 'shared-drive-master';
  return 'local';
}

/** Does editing a tab in this role reach OTHER people? True only for the write-propagating roles — drives whether
 *  the tab-bar share glyph shows (R7). 'shared-in-view' and 'local' do NOT impact others. */
export function tabShareImpactsOthers(role) {
  return role === 'shared-out' || role === 'shared-in-edit' || role === 'shared-drive-master';
}

/**
 * Phase B delete-protection. In Phase B a tab's s.fileId can point at a file the user does NOT own (a Collab/
 * received-editable share edited directly, or a team Shared-Drive file). Close & Delete must NEVER trash that file -
 * only the user's own private My-Drive backup mirror + the local tab link. We trash the master ONLY when ownership is
 * DEFINITE (ownedByMe === true) and the tab isn't a shared-in editable; a null/unknown probe fails CLOSED (skip the
 * master), because trashing a teammate's file is unrecoverable for them. Pure; unit-tested.
 *   @param ownedByMe   true | false | null(unknown) - from the Drive ownership probe
 *   @param isSharedInEdit  the tab edits a foreign shared file directly (Phase B Collab/Shared-Drive)
 *   @param hasBackup   a kind:'mydrive-backup' copy exists for this tab
 *   @returns { trashMaster, trashBackup, unlink }
 */
export function sharedMasterDeleteDecision({ ownedByMe = null, isSharedInEdit = false, hasBackup = false } = {}) {
  const foreign = isSharedInEdit || ownedByMe === false;
  return {
    trashMaster: !foreign && ownedByMe === true,   // only a file you DEFINITELY own (null probe → fail closed)
    trashBackup: !!hasBackup,                        // your private mirror is always yours to remove
    unlink: true,                                    // always drop the local tab link
  };
}

/**
 * Phase B upstream-change triage for a directly-edited shared file. When the shared file's Drive head revision has
 * moved since our baseline, decide what to surface:
 *   - 'none'    : nothing moved.
 *   - 'rebase'  : YOU made the last change elsewhere (lastByMe) and have no local edits → pull it silently, no dialog.
 *   - 'notice'  : SOMEONE ELSE changed it and you have no local edits → non-blocking "User X changed this file"
 *                 ([Version history] [Got it]); Got it pulls the latest in place.
 *   - 'conflict': you ALSO have unsaved local edits → both sides diverged → Pull / Keep / Fork.
 * Pure; unit-tested. (lastByMe comes from the head revision's lastModifyingUser.me flag.)
 */
export function upstreamNoticeDecision({ headChanged = false, lastByMe = false, hasLocalEdits = false } = {}) {
  if (!headChanged) return 'none';
  if (hasLocalEdits) return 'conflict';   // local + remote both moved - resolve before overwriting either
  if (lastByMe) return 'rebase';          // your own save from another device/tab - just adopt it
  return 'notice';                        // a collaborator changed it; you have nothing unsaved to protect
}

/** Version-history author label for a revision's `lastModifyingUser`. The CURRENT user's own save reads "you"
 *  (Drive's `me` flag) instead of their name; anyone else reads by emailAddress when Drive provides it (clearer than
 *  a cryptic Drive display name), else the displayName. Pure; unit-tested. */
export function revisionAuthorLabel(user) {
  if (!user) return null;
  if (user.me) return 'you';
  return user.emailAddress || user.displayName || null;
}

/**
 * The DIRECTIONAL share glyph for a role - the 3-way tab/chip indicator (by AUTHORITY, not just direction):
 *   - 'out'  : YOUR save wins. You own the master + fanned editable/Shared-Drive copies out (`shared-out`).
 *              Your edits push out; you resolve any conflict, never silently overwritten. Icon: #share.
 *   - 'in'   : THEIR save wins. A view-only file shared TO you (`shared-in-view`) - your edits stay in your own
 *              copy, Refresh to pull theirs. Icon: #share_link (the chain).
 *   - 'both' : edits flow BOTH ways. A Collab file you edit (writes back to the owner, `shared-in-edit`) OR a file
 *              that lives on a team Shared Drive (`shared-drive-master`) - you overwrite and can be overwritten.
 *              Icon: #socialshare.
 *   - null   : 'local' - no glyph.
 * Pure; unit-tested. Note the deliberate per-perspective asymmetry: a Collab share's OWNER reads 'out' (they hold
 * the master) while each RECIPIENT reads 'both' (they edit a copy that writes back).
 */
export function shareGlyphKind(role) {
  switch (role) {
    case 'shared-out': return 'out';
    case 'shared-in-view': return 'in';
    case 'shared-in-edit':
    case 'shared-drive-master': return 'both';
    default: return null;
  }
}

/** The per-tab Google-Drive linkage fields + their defaults — ONE canonical list so the session SERIALIZE
 *  (saveTabs) and the DESERIALIZE / re-HYDRATE on restore can never drift. The two MUST list the same fields, or
 *  one silently vanishes across a reload — exactly the bug where saveTabs dropped driveSharedSource /
 *  driveOutgoingGrants while restore still read them. Each entry is [field, default]. (The browser-archive +
 *  getAllTabs serializers use deliberate SUBSETS of this and stay separate on purpose.) */
export const DRIVE_TAB_FIELDS = [
  ['driveFileId', null],
  ['driveSync', false],
  ['driveLastSavedAt', null],
  ['driveImported', false],
  ['driveFolderId', null],
  ['driveDriveId', null],
  ['driveHeadRevisionId', null],
  ['driveLastHash', null],
  ['driveCopies', null],
  ['driveSharedSource', null],
  ['driveSharedInEdit', null],
  ['driveOutgoingGrants', 0],
];

/** A plain object of `o`'s Drive linkage fields with each default applied — the `o.x || default` semantics every
 *  mirror site already uses (an empty driveCopies array is truthy, so it's preserved, matching the old inline code).
 *  Spread into the session tab on BOTH save and restore so the two can't list different fields. */
export function serializeDriveFields(o) {
  const out = {};
  for (const [field, def] of DRIVE_TAB_FIELDS) out[field] = (o && o[field]) || def;
  return out;
}

/** The Drive identity of a tab/archive: the upstream shared-source fileId if it's a file shared TO you, else your
 *  own My-Drive master fileId. Two browser archives with the SAME identity mirror the SAME Drive file. */
export function driveIdentityOf(o) {
  if (!o) return null;
  return (o.driveSharedSource && o.driveSharedSource.fileId) || o.driveFileId || null;
}

/** Collapse a shared-in diagram's TWO Drive files to ONE Load-list row. Opening a view/edit share mints the
 *  recipient's OWN editable My-Drive master (the working copy) while the original stays shared-to-you, so
 *  `listMyDiagrams` returns BOTH. Given the Drive file list + the open tabs, returns the list with each original
 *  source REMOVED and each surviving working-copy master tagged `_sharedInWorkingCopy: { canEdit }` (so the Load
 *  pane re-homes it under "Shared with you" + shows a Shared-File chip + Copy/Collab pill, keeping the plain Load
 *  button since it's yours). The master→source link is read two ways: a durable appProperty `dfSharedFrom`
 *  (+`dfSharedEdit`) stamped on the master at create (survives a closed tab), OR an OPEN tab pairing its
 *  `driveSharedSource.fileId` to its own `driveFileId` (covers masters saved before the stamp existed). A source is
 *  hidden ONLY when its working copy is actually present in `files`, so nothing vanishes without a replacement row.
 *  Pure — new objects, inputs untouched. */
export function dedupeSharedInWorkingCopies(files, openTabs = []) {
  const list = Array.isArray(files) ? files.filter(Boolean) : [];
  const present = new Set(list.map((f) => f.id));
  const workingCopyOf = new Map();   // master fileId -> { canEdit } (the SHARE's access, for the Copy/Collab pill)
  const hide = new Set();
  const mark = (masterId, sourceId, canEdit) => {
    if (!masterId || !sourceId || masterId === sourceId || !present.has(masterId)) return;
    hide.add(sourceId);
    // A VIEW (Copy) fork is the user's OWN file (Mode C): hide the pristine original (reachable via the fork's Refresh)
    // but DON'T tag the fork as a shared working copy - it shows under "Your Google Drive" as a normal owned file.
    // Only an EDITABLE (Collab) working copy keeps the "Shared with you" treatment (the Copy/Collab pill + chip).
    if (canEdit) workingCopyOf.set(masterId, { canEdit: true });
  };
  // Durable: the stamped appProperty wins (works even when no tab is open).
  for (const f of list) { const from = f.appProperties && f.appProperties.dfSharedFrom; if (from) mark(f.id, from, f.appProperties.dfSharedEdit === '1'); }
  // Live: an open shared-in tab whose own master is in the list.
  for (const t of (Array.isArray(openTabs) ? openTabs : [])) { const src = t && t.driveSharedSource && t.driveSharedSource.fileId; if (src && t.driveFileId) mark(t.driveFileId, src, t.driveSharedSource.canEdit); }
  return list
    .filter((f) => !hide.has(f.id))
    .map((f) => { const w = workingCopyOf.get(f.id); return w ? { ...f, _sharedInWorkingCopy: w } : f; });
}

/** Mode C (shared-copy): the name a VIEW (Copy) share's working copy + tab take the moment the recipient first
 *  EDITS it - the divergence signal, so the fork reads distinctly from the untouched original it was opened from.
 *  Idempotent: never double-suffixes (a re-edit keeps the single "(changed)"). Pure. */
export const FORK_SUFFIX = ' (changed)';
export function forkName(name) {
  const n = ((name == null ? '' : String(name)).trim()) || 'Diagram';
  return n.endsWith(FORK_SUFFIX) ? n : n + FORK_SUFFIX;
}

/** Pick the browser-archive name for a closing tab, deduping by Drive identity so re-loading the SAME Drive
 *  diagram (especially a shared file, which arrives with no browserSaveName) REPLACES its archive instead of
 *  piling up dated duplicates (#4). Pure — the caller supplies the candidate sets.
 *  Returns { reuse: <name> } to overwrite an existing archive, or { fresh: true } to mint a new dated name.
 *  Order: (1) reuse this tab's OWN archive in place, unless another open tab already claims that name;
 *         (2) else reuse an archive that mirrors the same Drive file, again only if unclaimed by another tab. */
export function archiveDedupName({ browserSaveName = null, driveKey = null, saves = [], otherOpenSaveNames = [] } = {}) {
  const existingNames = new Set((saves || []).map(s => s.name));
  const claimed = new Set((otherOpenSaveNames || []).filter(Boolean));
  if (browserSaveName && existingNames.has(browserSaveName) && !claimed.has(browserSaveName)) return { reuse: browserSaveName };
  if (driveKey) {
    const twin = (saves || []).find(s => driveIdentityOf(s) === driveKey);
    if (twin && !claimed.has(twin.name)) return { reuse: twin.name };
  }
  return { fresh: true };
}

/** Human size label for a revision's byte count: "—" (unknown) / "812 B" / "12.3 KB" / "1.2 MB".
 *  Drive omits `size` for some revisions, so null/undefined/'' are "unknown" — NOT 0 B. */
export function revisionSizeLabel(bytes) {
  if (bytes == null || bytes === '') return '—';
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// What's New — a one-time overlay shown ONCE when the app updates to a newer
// RELEASE (a major or minor bump). It replaces the per-load "Version Notice"
// for minor versions (R23, v1.17.0): instead of warning on every older diagram
// that loads fine, the app tells the user — once — what changed in the update.
//
// Gate: localStorage `df_whats_new_seen` holds the last RELEASE whose changelog
// the user has acknowledged. A brand-new browser (no key) is silently recorded
// and shown nothing — first-run onboarding is the walkthrough's job, not this.
// Patch + dev-build bumps never trigger it (only major.minor is compared).

import { compareSemver } from './util.js?v=1.22.0';
import { buildModal } from './feedback.js?v=1.22.0';

const SEEN_KEY = 'df_whats_new_seen';

// Changelog — newest first, ONE entry per RELEASE (major/minor). Each highlight
// references a sprite symbol available at runtime: `icon-gdrive` is inlined in
// index.html, the rest (share_link / clock / layers / open_folder / palette /
// brush …) are SLDS icons registered by icons.js. `text` is trusted inline HTML
// (authored, not user input), so keep it to <strong>.
export const WHATS_NEW = [
  // 1.22.0 — the ORG IMPORT release. Four converters (objects / mappings / data graphs / richer flows) all
  // reached through the Claude skill's CLI scripts, so the copy deliberately leads with the capability rather
  // than an in-app button - there isn't one; the einstein item carries the install route. Final wording is the
  // owner's call at cut. Icons here come from the SLDS sprites (icons.js registers every symbol id):
  // database / data_mapping / hierarchy are sprite-verified, the rest were already in use above.
  {
    version: '1.22.0',
    title: "What's new in Diagramforce",
    intro: 'This one is about diagrams built from your own org instead of retyped out of it - real objects, Data Cloud mappings, data graphs and richer flows - plus a canvas that keeps up with them.',
    highlights: [
      { icon: 'database', text: '<strong>Turn real Salesforce objects into a data model.</strong> Name the objects you care about and the Diagramforce skill queries your org with the Salesforce CLI and drafts the ERD - primary and foreign keys inferred, relationships drawn only where both ends are on the canvas, and the field list curated to something readable - or ask for specific fields, or for every field, and get exactly that. Core objects and Data Cloud data model objects work the same.' },
      { icon: 'data_mapping', text: '<strong>Draw your Data Cloud mappings, end to end.</strong> The whole chain is laid out - data stream to data lake object to data model object, each in its own labelled lane - with one connector per mapped field. Formula fields show their expression on the connector, every unmapped field is accounted for instead of left ambiguous, and object-level connectors between card headers sum a mapping up when the field detail is more than the moment needs.' },
      { icon: 'hierarchy', text: '<strong>See a Data Cloud data graph as a diagram.</strong> Name a data graph and the skill fetches its definition and draws the tree - the root, every related object, the joining field named on each connector, and a facts card beside the tree recording what the graph is for. Pasting the definition JSON into Load &amp; Import draws the same diagram without the CLI.' },
      { icon: 'flow', text: '<strong>Flow imports read more like the org.</strong> Convert a flow with the skill\'s <strong>--org</strong> flag and the summary card links straight back to the flow in Flow Builder, marketing send steps show which CMS asset and which consent subscription their ids point to, and a wait names the event it is waiting for. Converted flows also gained a Resources summary, a left-hand annotation column, and false metadata flags folded into a disclosure instead of dropped.' },
      { icon: 'einstein', text: '<strong>All four org imports in one free skill.</strong> A flow, a data model, a mapping and a data graph can all come from the same org in the same session. Everything stays on your machine - the CLI runs locally and the skill writes a file you open here. <a href="https://github.com/MateuszDabrowski/diagramforce/tree/main/cowork-skill/diagramforce" target="_blank" rel="noopener">Get the skill</a>.' },
      { icon: 'edit', text: '<strong>The canvas kept up.</strong> Drop a diagram file anywhere on the window to open it. Tables and Data Objects collapse, and a collapsed card reports how many fields it hides. A relationship drawn by hand between two Data Model cards seeds real crow\'s-foot ends, self-relationships included. And the arrowheads and line styles you pick now survive a reload instead of being repainted.' },
    ],
  },
  // 1.21.0 — the DOMAIN MOVE release. This entry is the one users actually read on the new host: arriving
  // at diagramforce.com means an EMPTY localStorage (storage is per-origin), so `isNewerRelease` sees a null
  // lastSeen and the normal overlay never fires — `maybeShowMovedEntry()` force-shows THIS entry (index 0)
  // exactly once instead. So keep index 0 worth reading cold. The new-home highlight is AUTHORED here (it
  // deserves the same weight as its siblings); only the "Bring my diagrams over" BUTTON is appended to it at
  // runtime on the new host — see the domain-move block below. Also covers 1.20.1's external import, which
  // shipped as a PATCH and so was never announced (same catch-up reasoning as the 1.20.0 entry).
  {
    version: '1.21.0',
    // THE DOMAIN-MOVE ENTRY. Found by this flag, never by index or version, because it has a second job that
    // outlives its release: on diagramforce.com a first-time visitor is shown THIS card - whatever version they
    // land on - so the "bring my diagrams over" route can never go missing. Keep the flag on exactly one entry
    // (dev/tests/whats-new.test.js pins that) and do not prune this entry while the old host still redirects.
    domainMove: true,
    title: "What's new in Diagramforce",
    intro: 'Diagramforce has a new home at <strong>diagramforce.com</strong>. Your diagrams, Google Drive sync and shared links all keep working.',
    highlights: [
      // The "Bring my diagrams over" button is APPENDED to this item at runtime on the new host (see the
      // domain-move block below) - it is the only part that needs the new origin, so the item itself is
      // authored here and carries equal weight to its siblings.
      { icon: 'share_link', text: '<strong>A new home: diagramforce.com.</strong> Same app, shorter address. Every link you have already shared keeps working - the old address redirects here automatically. Diagrams in your Google Drive are already here. Diagrams saved only in your browser stay on the old address until you bring them across, which takes one click.' },
      // Flow import leads the feature items: it is the release's biggest new capability and the only one
      // that needs nothing installed. It sits ABOVE the Claude skill deliberately - the skill item also
      // mentions flows, so the in-app route should be read first or the two blur together.
      { icon: 'flow', text: '<strong>Turn a real Salesforce Flow into a diagram.</strong> Drop the flow into <strong>Load &amp; Import</strong> - either its <strong>.flow-meta.xml</strong> source file or the Tooling API response - and Diagramforce draws it from the org\'s own metadata: every element, decision outcome, fault path and Go To jump, positioned the way Flow Builder had it. Each card keeps the detail behind it - the fields a Create or Update actually writes, what a Get reads out and into which variable, a screen\'s components, the condition behind each outcome - and a summary card above Start records the flow\'s status, API version and resources. It all runs in your browser; the flow is never uploaded anywhere.' },
      { icon: 'einstein', text: '<strong>Build diagrams with Claude.</strong> There is now a free Diagramforce skill for Claude: describe what you want and it hands back a ready-to-open diagram - architecture, data model, Data Cloud field mapping, process, org chart, Gantt or sequence. It can rebuild a diagram from a screenshot too, and it converts a real Salesforce Flow the same way the app does. <a href="https://github.com/MateuszDabrowski/diagramforce/tree/main/cowork-skill/diagramforce" target="_blank" rel="noopener">Get the skill</a>.' },
      { icon: 'apps', text: '<strong>Open Diagramforce from another app.</strong> Any website can now add an "Open in Diagramforce" button that sends a diagram straight into a new tab here - no account, no file to download, and no size limit. Useful if you build a tool that generates flows, data models or mappings and want people to see them on a canvas. <a href="https://github.com/MateuszDabrowski/diagramforce/blob/main/how-to-use/web-integration.md" target="_blank" rel="noopener">Copy-paste snippet</a>.' },
    ],
  },
  // 1.20.0 — the catch-up entry: 1.19.2-1.19.5 were PATCH releases, so this overlay never fired for
  // them and users got no in-app notice of their user-facing changes. This entry deliberately covers
  // the best of the whole 1.19.x train PLUS 1.20.0. (The diagramforce.com domain may still join at cut.)
  {
    version: '1.20.0',
    title: "What's new in Diagramforce",
    intro: 'The headline is a whole new diagram type: <strong>Flow</strong>, for documenting Salesforce Flows. It is also a big catch-up - the recent 1.19.x updates shipped quietly, so this note covers the best of those too.',
    highlights: [
      { icon: 'flow', text: '<strong>New: Flow Diagrams.</strong> Document a Salesforce Flow with its real elements - Screen, Decision, Assignment, Loop, Get / Create / Update / Delete Records, Subflow and more. Connectors carry their role - a decision outcome, the default path, a fault path (shown in red), or a loop - and one-click <strong>Auto Layout</strong> straightens the whole flow into a clean vertical tree. Great for screen, record-triggered, and marketing / campaign flows.' },
      { icon: 'rows', text: '<strong>Readable field names.</strong> Data Object rows now show the field Label first (the API name fills in when there is no label). Need API names? Flip on <strong>API Names</strong> in the View menu to show them alongside - only where they differ.' },
      { icon: 'open_folder', text: '<strong>Seven official templates.</strong> Marketing Cloud Engagement Email and Mobile Data Views, Marketing Cloud Next Consent Data Model plus Email, Push and SMS Data Mappings, and Data 360 Contact Mapping. Open one from the New Diagram window, or drag it from the stencil straight into your current canvas - template tiles show the full name, a description, and an eye that previews the diagram.' },
      { icon: 'apps', text: '<strong>Ready-made objects.</strong> Official shape packs in the stencil: all MCE Data Views (verified field schemas) and the new MCN Data Model Objects - searchable, and one drag away in Data Model and Data Mapping diagrams.' },
      { icon: 'edit', text: '<strong>Save as Template from right-click.</strong> Select several shapes and the context menu offers Save as Template, right where Save Shape lives for a single shape. My Templates render one per row with a preview too.' },
      { icon: 'check', text: '<strong>Connector power-ups.</strong> Highlight State (Added / Changed / Removed / Deferred) now works on connectors, and selecting several connectors bulk-edits colours, line styles, widths, fonts and both arrowheads at once - fields that differ show "Mixed" instead of guessing.' },
      { icon: 'layers', text: '<strong>Grouping and layout that behave.</strong> Group and Ungroup on right-click, stickier drag-capture into containers, shapes no longer fall out of their container on drag, copy-paste keeps groups together (a copied container brings everything inside it), and Auto Layout lines things up more cleanly with connectors attaching on the facing side.' },
    ],
  },
  {
    version: '1.19.0',
    title: "What's new in Diagramforce",
    intro: 'This release adds ready-made templates, a way to review what changed between versions, one-click Markdown tables, cleaner automatic layouts and quicker editing - plus smoother mobile.',
    highlights: [
      { icon: 'open_folder', text: '<strong>Start from a template.</strong> The New Diagram window has a Templates tab with ready-made starting points. Open one and it becomes your own editable diagram. It starts with Data 360 Contact Mapping and Marketing Cloud Email Data Views, with more to come.' },
      { icon: 'check', text: '<strong>Compare with.</strong> Compare the current diagram with another open tab or a saved Google Drive version - what was added, changed or removed is tinted right on the canvas, without modifying anything. Apply it as Highlight States to keep the marks.' },
      { icon: 'rows', text: '<strong>Copy a table as Markdown.</strong> In the Table view, Copy as Markdown puts the table on your clipboard, ready to paste into Confluence, Jira, Notion or GitHub.' },
      { icon: 'layers', text: '<strong>Cleaner diagrams.</strong> Auto Layout now lines up children under their parents and straightens connectors for tidier Data Model, Architecture and Org charts - and when you save, any loose connectors (an end not attached to a shape) are flagged and framed on the canvas so you can fix them before you share.' },
      { icon: 'edit', text: '<strong>Quicker editing.</strong> A new Help menu gathers the guided tour, keyboard shortcuts and About in one place; double-click a Data Object to edit its fields in a table; and a selected connector now highlights clearly in every browser, ends and labels included.' },
      { icon: 'apps', text: '<strong>Smoother on mobile.</strong> The Table view bar stays reachable, long tab names no longer fill the screen, and Data Model diagrams can switch to the Table view on a phone.' },
    ],
  },
  {
    version: '1.18.0',
    title: "What's new in Diagramforce",
    intro: 'This release makes Gantt a full diagram type, adds new shapes, and lets you Copy as PNG straight to your clipboard.',
    highlights: [
      { icon: 'event', text: '<strong>Improved Gantt Chart.</strong> A 5-phase sample plan where dates drive the bars (drag to reschedule or reorder rows), with coloured task groups, a Timeline Summary lane, dependency arrows, day markers, assignees, and an editable Table view.' },
      { icon: 'apps', text: '<strong>New shapes.</strong> Table, Legend and Pill in every diagram type, a Highlight state for review/diff (added, changed, removed, deferred), and a reusable My Shapes palette.' },
      { icon: 'image', text: '<strong>Copy as PNG.</strong> Right-click or Cmd+C copies the selection as an image to paste into Slack, docs or chat. Cmd+Shift+C copies it with a transparent background.' },
      { icon: 'edit', text: '<strong>Right-click Actions.</strong> A canvas right-click menu with full per-shape and multi-select actions, plus copy/paste style, reverse or simplify a connector, one-click crow\'s-foot endings, release embedded shapes, and font size on any text.' },
      { icon: 'einstein', text: '<strong>Better LLM JSON spec.</strong> A validator (npm run validate), a which-diagram-type guide, and verified examples for all seven types.' },
    ],
  },
  {
    version: '1.17.0',
    title: "What's new in Diagramforce",
    intro: 'This release adds Google Drive sync as the headline, plus a refreshed interface and handy stencil upgrades. Everything still runs in your browser - no account is created and nothing leaves it unless you connect your own Google Drive.',
    highlights: [
      // Google Drive is the headline; its capabilities (sharing / history / conflict) nest UNDER it (children) so the
      // overlay groups all Drive features together instead of mixing them flat with the non-Drive ones.
      { icon: 'icon-gdrive', text: '<strong>Google Drive sync (optional).</strong> Connect your own Drive to auto-save every diagram and open it on any device.', children: [
        { icon: 'share_link', text: '<strong>Share via Drive.</strong> Share a diagram - or a whole tab group - as a view-only or editable link, and manage who has access.' },
        { icon: 'clock', text: '<strong>Version history.</strong> Browse, restore and pin past versions of any Drive-synced diagram, with a preview that highlights what changed.' },
        { icon: 'layers', text: '<strong>Conflict Review.</strong> If your edits clash with a Drive change, a side-by-side review highlights what differs and lets you keep yours, theirs, or both.' },
      ] },
      { icon: 'open_folder', text: '<strong>Save &amp; Export, Load &amp; Import, Close &amp; Delete.</strong> One place to see where each diagram lives - this browser and your Drive - and to export, reopen, or tidy up.' },
      { icon: 'palette', text: '<strong>A smarter stencil.</strong> Reuse your saved shapes (My Shapes) and templates, reach shapes from every other diagram type, and have your templates follow you across devices.' },
      { icon: 'brush', text: '<strong>A fresh look.</strong> A cleaner navbar, tabs and menus - plus a right-click menu on the canvas for quick actions.' },
    ],
  },
];

// Domain move (2026): on the NEW host only, append the "bring my diagrams over" button to the release's
// OWN new-home highlight, rather than unshifting a second near-duplicate item above it. The highlight already
// explains the move and carries the same weight as its siblings; only the BUTTON needs the new origin. Matched
// on content, not index, so a later release that pushes a different entry to the front can't collect the button
// by accident. The click handler is injected via setMigrationHandler (app.js) and wired in showWhatsNewModal -
// an inline onclick is CSP-blocked. Absent on the old host and in tests (the hostname never matches), so
// WHATS_NEW is unmutated there and the whats-new unit tests are unaffected.
if (typeof location !== 'undefined' && location.hostname === 'diagramforce.com') {
  // Search the DOMAIN-MOVE entry, not WHATS_NEW[0]. Index 0 is "the newest release", which stops being the move
  // entry the moment another release ships - at which point the button would have been appended to nothing and
  // the migration route would have silently vanished for every new arrival.
  const home = WHATS_NEW.find((e) => e.domainMove)?.highlights?.find((h) => h.text.includes('diagramforce.com'));
  if (home) {
    // Block-level, centred CTA rather than an inline button. Appended inline it wrapped onto a ragged
    // line after the last word ("...one click. [button]"), which buried the single action this card exists
    // to prompt. Its own centred line makes it read as the call to action it is.
    // The secondary "nothing to bring over" link is the EXIT. Without it the only way to retire this card was
    // to run a transfer, so anyone who never clicked - most fresh arrivals, who have nothing on the old origin
    // at all - saw it prepended to every later release's notes forever. Secondary styling on purpose: bringing
    // diagrams across is the action worth taking; this is for people it does not apply to.
    home.text += '<span class="df-whatsnew__cta">'
      + '<button class="df-modal__btn df-modal__btn--primary" data-action="df-migrate">Bring my diagrams over</button>'
      + '<button class="df-whatsnew__skip" data-action="df-migrate-skip">I have nothing to bring over</button>'
      + '</span>';
  }
}

// ── Pure decision helpers (unit-tested in tests/whats-new.test.js) ───────────

/** The [major, minor] of a version string, e.g. "1.17.0" -> [1, 17]. */
function majorMinor(v) {
  const p = String(v || '').split('.').map(Number);
  return [p[0] || 0, p[1] || 0];
}

/** True when `current` is a newer major-or-minor RELEASE than `lastSeen`. Patch
 *  and dev-build bumps don't count. A null/empty `lastSeen` (first visit) → false:
 *  there's nothing to announce a change *from*, and the walkthrough owns onboarding. */
export function isNewerRelease(lastSeen, current) {
  if (!lastSeen) return false;
  const [aMaj, aMin] = majorMinor(lastSeen);
  const [bMaj, bMin] = majorMinor(current);
  if (bMaj !== aMaj) return bMaj > aMaj;
  return bMin > aMin;
}

/** Changelog entries strictly newer than `lastSeen` and not newer than `current`,
 *  newest first (the order WHATS_NEW is authored in). Normally just the current
 *  release; covers the case where a user skipped one or more releases. */
export function entriesSince(lastSeen, current, log = WHATS_NEW) {
  return log.filter(e =>
    compareSemver(e.version, lastSeen) > 0 &&
    compareSemver(e.version, current) <= 0
  );
}

// ── Boot integration ─────────────────────────────────────────────────────────

let _appVersion = null;
export function init(appVersion) { _appVersion = appVersion; }

// Domain-move (2026): the "Bring my diagrams over" button in the current release entry (new host only) calls this
// handler, injected from app.js - so whats-new.js needs no import of the migration bridge. No-op until set.
let _migrationHandler = null;
let _migrationPending = null;
/** Wired from app.js to migrationBridge.isMigrationPending. Absent on the old host and in tests, where it stays
 *  null and the overlay behaves exactly as it always did. */
export function setMigrationPendingCheck(fn) { _migrationPending = fn; }

export function setMigrationHandler(fn) { _migrationHandler = fn; }

/** Wired from app.js to migrationBridge.dismissMigrationPrompt - the "nothing to bring over" exit. */
let _migrationDismiss = null;
export function setMigrationDismissHandler(fn) { _migrationDismiss = fn; }

/**
 * Decide (synchronously) whether to show the What's-New overlay this session and,
 * if so, render it on the next tick. Returns true when it WILL show, so the boot
 * sequence can skip other deferred overlays (the backup reminder) to avoid
 * stacking two dialogs on first paint.
 *
 * Always records the current RELEASE as "seen" so the overlay never re-appears
 * for this version — even on a reload moments later, and even if the user never
 * actually read it.
 */
export function maybeShowWhatsNew(fallbackLastSeen = null) {
  const current = _appVersion;
  if (!current) return false;

  let lastSeen = null;
  try { lastSeen = localStorage.getItem(SEEN_KEY); } catch { /* private mode */ }
  // A user updating in from a release that predates this feature has NO seen-key yet - but they're RETURNING, not
  // brand-new. Fall back to the restored session's appVersion (their actual last-run release) so they still get the
  // overlay, instead of being mistaken for a first-ever visitor and recorded silently. (A TRUE first-ever visitor has
  // no session → caller passes no fallback → still silent.) Fixes "the old Session-Restored notice showed instead of
  // What's New after the 1.16→1.17 update".
  if (!lastSeen && fallbackLastSeen) lastSeen = fallbackLastSeen;

  const record = () => { try { localStorage.setItem(SEEN_KEY, current); } catch { /* ignore */ } };

  if (!isNewerRelease(lastSeen, current)) { record(); return false; }
  const entries = entriesSince(lastSeen, current);
  if (!entries.length) { record(); return false; }

  record();  // mark seen up front so a quick reload can't double-show it
  setTimeout(() => showWhatsNewModal(entries), 0);
  return true;
}

/** Force-show the What's-New overlay for the CURRENT release, ignoring the seen-state. Wired to the About modal's
 *  version chip so the release notes stay reachable (re-read anytime, and reviewable before a release). Falls back to
 *  the newest authored entry if the running version isn't listed yet. */
/** Which entries the Help-menu overlay should render, as a PURE function of the running version and whether a
 *  domain migration is still outstanding - extracted so it is unit-testable without a DOM (unit-tested in
 *  dev/tests/whats-new.test.js).
 *
 *  While a migration is pending the move card LEADS. That is the only permanent route to the "Bring my diagrams
 *  over" button: the boot prompt fires once per browser, so a user who dismissed it and then updated to a later
 *  release would otherwise have no way back to diagrams still sitting on the old origin. The current release's
 *  notes still follow it - the move card supplements the changelog rather than replacing it. */
export function overlayEntriesFor(appVersion, migrationPending) {
  const [cMaj, cMin] = majorMinor(appVersion);
  const current = WHATS_NEW.find((e) => { const [m, n] = majorMinor(e.version); return m === cMaj && n === cMin; }) || WHATS_NEW[0];
  const move = migrationPending ? WHATS_NEW.find((e) => e.domainMove) : null;
  return [move, current].filter((e, i, a) => e && a.indexOf(e) === i);
}

export function showWhatsNewNow() {
  const entries = overlayEntriesFor(_appVersion, !!_migrationPending?.());
  if (entries.length) showWhatsNewModal(entries);
}

/** The domain-move card, whatever release is running. Distinct from showWhatsNewNow, which shows the CURRENT
 *  release's notes - that is the wrong card for a first-time arrival on the new host, who needs the migration
 *  route rather than a changelog for a version they have never run. Returns false when no move entry is
 *  authored (the entry has been pruned), so the caller can fall back rather than show an empty modal. */
export function showDomainMoveNotice() {
  const entry = WHATS_NEW.find((e) => e.domainMove);
  if (!entry) return false;
  showWhatsNewModal([entry]);
  return true;
}

function showWhatsNewModal(entries) {
  const iconSvg = (icon) => icon ? `<svg class="df-whatsnew__icon" aria-hidden="true"><use href="#${icon}"></use></svg>` : '';
  const subItem = (c) => `<li class="df-whatsnew__item df-whatsnew__item--sub">${iconSvg(c.icon)}<span>${c.text}</span></li>`;
  // A highlight with `children` renders as a PARENT whose sub-features nest in an indented sub-list (e.g. all the
  // Google Drive capabilities under "Google Drive"), so Drive items don't sit flat alongside the non-Drive ones.
  const renderHighlight = (h) => h.children && h.children.length
    ? `<li class="df-whatsnew__item">${iconSvg(h.icon)}<div class="df-whatsnew__body"><span>${h.text}</span><ul class="df-whatsnew__sublist">${h.children.map(subItem).join('')}</ul></div></li>`
    : `<li class="df-whatsnew__item">${iconSvg(h.icon)}<span>${h.text}</span></li>`;
  // When the user skipped releases, MULTIPLE entries show at once - prefix each with a version subtitle so it's clear
  // which changes belong to which release. With a single entry the modal title already carries the version.
  const multi = entries.length > 1;
  const items = entries.map(e =>
    (multi ? `<li class="df-whatsnew__subtitle">v${e.version}</li>` : '') + e.highlights.map(renderHighlight).join(''),
  ).join('');
  const head = entries[0] || {};
  // Title carries the release version after "Diagramforce" (e.g. "What's new in Diagramforce v1.18.0") - but only when
  // a SINGLE entry shows; with multiple, the per-version subtitles carry the versions instead.
  const titleText = head.title ? `${head.title}${(!multi && head.version) ? ` v${head.version}` : ''}` : "What's new";
  const { body, footer, close } = buildModal({
    title: titleText,
    className: 'df-whatsnew-modal',
    // ABOVE the New Diagram picker (z-index 10000, css/tabs.css), BELOW toasts + the skip link (10100).
    // The two overlays collide on exactly one journey, and it is the one the domain move depends on: a
    // first arrival at diagramforce.com has an empty per-origin localStorage, so there are zero tabs, so
    // session-store opens the New Diagram picker during restore - and the "we've moved / bring your
    // diagrams over" card then rendered BEHIND it at buildModal's default 3000, invisible, while
    // maybeShowMovedEntry() had already burned its once-per-browser flag. The user never saw the card and
    // their old-origin diagrams had no route across. Dismissing the card now reveals the picker beneath,
    // which is the right order to meet them in. (A class rule cannot do this - buildModal sets the
    // z-index INLINE, so it must be passed here.)
    zIndex: 10050,
    width: '480px',
    bodyStyle: 'padding:16px 20px',
    bodyHtml: `
      ${head.intro ? `<p class="df-whatsnew__intro">${head.intro}</p>` : ''}
      <ul class="df-whatsnew__list">${items}</ul>`,
    // Amber accent, bottom-right, "Got it" - identical to Keyboard shortcuts and Diagram with AI. This was blue
    // and left-aligned in one of the three, so the ONE Help dropdown offered three different-looking exits.
    // "Got it" rather than "Done" because all three are modals you READ: downloading the spec or copying a
    // shortcut does not COMPLETE anything, you still dismiss afterwards. "Done" belongs on a modal where the
    // button ends a task the user started.
    footerHtml: '<button class="df-modal__btn df-modal__btn--accent" data-action="ok" style="margin-left:auto">Got it</button>',
  });
  footer.querySelector('[data-action="ok"]').addEventListener('click', () => close());
  // Domain-move: the "Bring my diagrams over" button only exists in the injected entry on the new host; the optional
  // chaining makes this a no-op for every other release/entry (and everywhere the button isn't present).
  body.querySelector('[data-action="df-migrate"]')?.addEventListener('click', () => { if (_migrationHandler) _migrationHandler(); });
  // Dismiss in place rather than closing the modal: the move card is usually shown ALONGSIDE the current
  // release's notes, and closing the whole overlay would yank away something the user was reading. The card
  // is gone on the next open. The confirmation names the old address, because that is what makes this
  // recoverable - the Worker serves /migrate there indefinitely, so nothing is actually lost by dismissing.
  body.querySelector('[data-action="df-migrate-skip"]')?.addEventListener('click', (e) => {
    if (_migrationDismiss && !_migrationDismiss()) return;
    const cta = e.target.closest('.df-whatsnew__cta');
    if (cta) {
      cta.innerHTML = '';
      cta.textContent = 'Hidden. If you change your mind, diagramforce.mateuszdabrowski.pl still has them.';
      cta.classList.add('df-whatsnew__cta--done');
    }
  });
}

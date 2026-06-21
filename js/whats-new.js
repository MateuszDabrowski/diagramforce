// What's New — a one-time overlay shown ONCE when the app updates to a newer
// RELEASE (a major or minor bump). It replaces the per-load "Version Notice"
// for minor versions (R23, v1.17.0): instead of warning on every older diagram
// that loads fine, the app tells the user — once — what changed in the update.
//
// Gate: localStorage `df_whats_new_seen` holds the last RELEASE whose changelog
// the user has acknowledged. A brand-new browser (no key) is silently recorded
// and shown nothing — first-run onboarding is the walkthrough's job, not this.
// Patch + dev-build bumps never trigger it (only major.minor is compared).

import { compareSemver } from './util.js?v=1.17.0.199';
import { buildModal } from './feedback.js?v=1.17.0.199';

const SEEN_KEY = 'df_whats_new_seen';

// Changelog — newest first, ONE entry per RELEASE (major/minor). Each highlight
// references a sprite symbol available at runtime: `icon-gdrive` is inlined in
// index.html, the rest (share_link / clock / layers / open_folder / palette /
// brush …) are SLDS icons registered by icons.js. `text` is trusted inline HTML
// (authored, not user input), so keep it to <strong>.
export const WHATS_NEW = [
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
export function maybeShowWhatsNew() {
  const current = _appVersion;
  if (!current) return false;

  let lastSeen = null;
  try { lastSeen = localStorage.getItem(SEEN_KEY); } catch { /* private mode */ }

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
export function showWhatsNewNow() {
  const [cMaj, cMin] = majorMinor(_appVersion);
  const entry = WHATS_NEW.find((e) => { const [m, n] = majorMinor(e.version); return m === cMaj && n === cMin; }) || WHATS_NEW[0];
  if (entry) showWhatsNewModal([entry]);
}

function showWhatsNewModal(entries) {
  const iconSvg = (icon) => icon ? `<svg class="df-whatsnew__icon" aria-hidden="true"><use href="#${icon}"></use></svg>` : '';
  const subItem = (c) => `<li class="df-whatsnew__item df-whatsnew__item--sub">${iconSvg(c.icon)}<span>${c.text}</span></li>`;
  // A highlight with `children` renders as a PARENT whose sub-features nest in an indented sub-list (e.g. all the
  // Google Drive capabilities under "Google Drive"), so Drive items don't sit flat alongside the non-Drive ones.
  const renderHighlight = (h) => h.children && h.children.length
    ? `<li class="df-whatsnew__item">${iconSvg(h.icon)}<div class="df-whatsnew__body"><span>${h.text}</span><ul class="df-whatsnew__sublist">${h.children.map(subItem).join('')}</ul></div></li>`
    : `<li class="df-whatsnew__item">${iconSvg(h.icon)}<span>${h.text}</span></li>`;
  const items = entries.flatMap(e => e.highlights).map(renderHighlight).join('');
  const head = entries[0] || {};
  // Title carries the release version after "Diagramforce" (e.g. "What's new in Diagramforce v1.17.0").
  const titleText = head.title ? `${head.title}${head.version ? ` v${head.version}` : ''}` : "What's new";
  const { footer, close } = buildModal({
    title: titleText,
    className: 'df-whatsnew-modal',
    width: '480px',
    bodyStyle: 'padding:16px 20px',
    bodyHtml: `
      ${head.intro ? `<p class="df-whatsnew__intro">${head.intro}</p>` : ''}
      <ul class="df-whatsnew__list">${items}</ul>`,
    footerHtml: '<button class="df-modal__btn df-modal__btn--primary" data-action="ok" style="margin-left:auto">Got it</button>',
  });
  footer.querySelector('[data-action="ok"]').addEventListener('click', () => close());
}

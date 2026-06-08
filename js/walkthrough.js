// Contextual walkthrough — a first-party, zero-dependency guided tour. One generic tour
// runs for every diagram type (the steps were ~90% identical), with two type-specific feature
// steps spliced in when relevant. Steps render as a spotlight-cutout popover locked with
// trapFocus (from feedback.js). No external tour library, no graph mutations — purely an
// overlay layer on top of the app. On a first visit the tour starts itself (no separate splash).
import { trapFocus } from './feedback.js?v=1.15.6';
import { escHtml } from './util.js?v=1.15.6';

let modules = null;
let activeTour = null;   // { steps, index, els, release } while a tour runs

const FIRST_VISIT_KEY = 'df_first_visit_help_shown';

// The "?"-in-circle Help glyph — same filled ring as the About (i) toolbar icon, so the
// two read as a matched pair. Used in the navbar button (index.html) AND inline in copy
// via the {{help}} token below. `currentColor` so it inherits the surrounding text colour.
const HELP_ICON_SVG = '<svg class="df-help-glyph" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z"/><text x="8" y="11.7" text-anchor="middle" font-size="10" font-weight="700" font-family="system-ui, -apple-system, sans-serif">?</text></svg>';

// Platform modifier glyph for shortcut copy — ⌘ on macOS, Ctrl elsewhere.
const IS_MAC = (navigator.platform || '').toUpperCase().includes('MAC') || /Mac/i.test(navigator.userAgent || '');
const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

// ── Body renderer ───────────────────────────────────────────────────────────
// Safe: escape FIRST per line, then re-introduce a small, fixed markdown subset —
// [label](url) links (http/https only, new tab), **bold**, the {{help}} glyph + {{mod}}
// modifier tokens, "- " bullet lists, and newlines (→ <br>). Escape-first mirrors
// parseMarkdown; the glyph is a trusted constant injected AFTER escaping (never user input).
function renderBody(text) {
  const inline = (s) => {
    let h = escHtml(s);
    h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) =>
      `<a href="${/^https?:\/\//i.test(url) ? url : '#'}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\{\{help\}\}/g, HELP_ICON_SVG);
    h = h.replace(/\{\{mod\}\}/g, MOD_KEY);
    return h;
  };
  let html = '';
  let inList = false;
  for (const line of String(text ?? '').split('\n')) {
    const li = /^\s*-\s+(.*)$/.exec(line);
    if (li) {
      if (!inList) { html += '<ul class="df-tour__list">'; inList = true; }
      html += `<li>${inline(li[1])}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += inline(line) + '<br>';
    }
  }
  if (inList) html += '</ul>';
  return html.replace(/(?:<br>)+$/, '');   // drop trailing line breaks
}

// ── Step config ───────────────────────────────────────────────────────────────
// ONE walkthrough for every diagram type. The per-type tours were ~90% identical, so this is
// the single source of truth — type-neutral copy throughout. The only genuinely type-specific
// content is TYPE_STEP below, spliced in by start() when that type is active (and its target is
// really on screen). placement: where the card sits relative to the target —
//   'center' | 'below' | 'below-start' | 'above' | 'left' | 'right' | 'inside-top'.
// A target that's missing/invisible degrades gracefully to a centred card (no spotlight).
const BASE_TOUR = [
  {
    target: '#canvas-container', placement: 'center',
    title: 'Welcome to Diagramforce',
    body: 'A fast, browser-based canvas for architecture, data models, Data Cloud mappings, process flows, org charts, Gantt charts, and UML sequence diagrams — no account, and nothing leaves your browser.\n\nLet’s do a quick 60-second tour of the key tools.\n\nIn a rush? Hit skip. You can always jump right back into this walkthrough by clicking the {{help}} Help icon in the top toolbar.',
  },
  {
    targets: ['#btn-save', '#btn-load'], placement: 'below-start',
    title: 'Save & Load',
    body: 'Keep your work safe. Export a compact native JSON file for version control, share a diagram via a copyable URL, or save a clean PNG / WEBP / GIF for your documentation.\n\nYou can also use the [LLM Spec](https://github.com/MateuszDabrowski/diagramforce/blob/main/DIAGRAM_JSON_SPEC.md) to have an AI draft a diagram, then load it.',
  },
  {
    target: '#btn-display', placement: 'below-start',
    title: 'Context-Aware Display',
    body: 'The Display menu adapts to the active diagram type — auto-layout, focus dimming to trace connections, plus type-specific toggles (field labels & lengths, swimlane fit, participant labels, and more).',
  },
  {
    target: '#stencil-panel', placement: 'left',
    title: 'Your Diagram Stencil',
    body: 'Your canvas toolbox. This side panel auto-loads the shapes for the active diagram type — Salesforce & cloud products, BPMN steps, data objects, lifelines, Gantt tasks, and more.\n\nMissing something? Copy-paste it from another diagram type.',
  },
  {
    target: '#properties-panel', placement: 'right',
    title: 'Manage Properties',
    body: 'Click any shape or connector to edit it here — labels, colours, data types and keys, connector ends, and type-specific settings. You can also convert between shape types or apply changes across a multi-selection.',
    // Open an example shape's properties panel on enter so the step has something to point at;
    // clear it on leave so it closes again. Selection is UI state — no graph mutation / history.
    // Prefer a real content shape over a background grouper (Zone / Container / Pool / timeline).
    onEnter: (m) => {
      const els = m.graph?.getElements?.() || [];
      const GROUP = new Set(['sf.Zone', 'sf.Container', 'sf.BpmnPool', 'sf.TaskGroup', 'sf.GanttTimeline']);
      const el = els.find(e => e.get('type') === 'sf.DataObject')
        || els.find(e => !GROUP.has(e.get('type')))
        || els[0];
      if (el) m.selection?.selectOnly?.(el);
    },
    onLeave: (m) => m.selection?.clearSelection?.(),
  },
  {
    target: '#canvas-container', placement: 'center',
    title: 'Time to Build!',
    body: 'Pro-tip for fast workflows:\n- {{mod}} + A to select all elements, or hold Shift and drag to marquee-select\n- {{mod}} + C / V to copy and paste\n- {{mod}} + Z reverts not-so-great decisions\nFind more [here](https://github.com/MateuszDabrowski/diagramforce/tree/main#keyboard-shortcuts).\n\nTime to build!',
  },
];

// Genuinely type-specific feature steps — spliced in before the closing "Time to Build" step
// only when that diagram type is active, so the spotlight lands on a feature that's on screen.
const TYPE_STEP = {
  datamapping: {
    target: '#view-switch-group', placement: 'below',
    title: 'Diagram vs. Table Views',
    body: 'One diagram, two views. Flip instantly between the visual canvas and a tabular spreadsheet to audit the mapping + metadata, or export production-ready CSV specs for developers.',
  },
  datamodel: {
    target: '#btn-map-bridge', placement: 'below',
    title: 'The ‘Map’ Transition Bridge',
    body: 'Moving from schema to integration? This clones your structural model straight into a new Data Mapping tab, wrapping your tables in a default Source layer so you can immediately wire up pipelines.',
  },
};

// ── Init / public API ─────────────────────────────────────────────────────────
export function init(_modules) {
  modules = _modules;
  document.getElementById('btn-help')?.addEventListener('click', () => start());
}

export function isActive() { return !!activeTour; }

/** Start the walkthrough, splicing in the ACTIVE diagram type's feature step when relevant. */
export function start() {
  if (activeTour) return;                                   // already running
  const type = modules?.tabs?.getActiveTabType?.() || '';
  const steps = BASE_TOUR.slice();
  const extra = TYPE_STEP[type];
  if (extra) steps.splice(steps.length - 1, 0, extra);      // insert before the final "Time to Build"
  runTour(steps);
}

// ── First-run trigger ─────────────────────────────────────────────────────────
// On a first visit we run the walkthrough itself (no separate splash modal). The typical first
// screen is the Create-New-Diagram overlay, so we wait until a diagram canvas exists before
// starting — otherwise the spotlight would aim at toolbar buttons behind that overlay.
export function maybeStartFirstRunTour() {
  let shown = 'true';
  try { shown = localStorage.getItem(FIRST_VISIT_KEY); } catch { /* private mode → treat as already seen */ return; }
  if (shown) return;
  // "Ready" = a real diagram exists (≥1 tab) AND we're no longer sitting on the New-Diagram
  // overlay. NB getActiveTabType() always returns a default ('architecture') even with zero
  // tabs, so it can't be used here — getAllTabs().length is the true tab count.
  const ready = () => (modules?.tabs?.getAllTabs?.()?.length || 0) > 0 && !document.querySelector('.df-new-modal');
  let done = false;
  const begin = () => {
    if (done || !ready()) return;                // still on the New-Diagram overlay → wait
    done = true;
    try { localStorage.setItem(FIRST_VISIT_KEY, 'true'); } catch { /* ignore */ }
    setTimeout(start, 450);                       // let the chosen diagram paint + the overlay close
  };
  // Session already restored → start shortly after first paint. Otherwise start the moment the
  // user creates their first diagram (tabs.onChange fires on the new tab; begin() self-guards).
  if (ready()) setTimeout(begin, 400);
  else modules?.tabs?.onChange?.(begin);
}

// ── Tour runtime ────────────────────────────────────────────────────────────
function runTour(steps) {
  const overlay = document.createElement('div');
  overlay.className = 'df-tour';
  overlay.innerHTML = `
    <div class="df-tour__catcher"></div>
    <div class="df-tour__spotlight" hidden></div>
    <div class="df-tour__card" role="dialog" aria-modal="true" aria-labelledby="df-tour-title" tabindex="-1">
      <button type="button" class="df-tour__close" aria-label="Close walkthrough">✕</button>
      <h2 id="df-tour-title" class="df-tour__title"></h2>
      <div class="df-tour__body"></div>
      <div class="df-tour__footer">
        <button type="button" class="df-modal__btn df-tour__skip">Skip</button>
        <span class="df-tour__count" aria-live="polite"></span>
        <span class="df-tour__nav">
          <button type="button" class="df-modal__btn df-tour__back">Back</button>
          <button type="button" class="df-modal__btn df-modal__btn--primary df-tour__next">Next</button>
        </span>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const els = {
    catcher: overlay.querySelector('.df-tour__catcher'),
    spot: overlay.querySelector('.df-tour__spotlight'),
    card: overlay.querySelector('.df-tour__card'),
    title: overlay.querySelector('.df-tour__title'),
    body: overlay.querySelector('.df-tour__body'),
    count: overlay.querySelector('.df-tour__count'),
    back: overlay.querySelector('.df-tour__back'),
    next: overlay.querySelector('.df-tour__next'),
    skip: overlay.querySelector('.df-tour__skip'),
    closeBtn: overlay.querySelector('.df-tour__close'),
  };

  const release = trapFocus(els.card, { onEscape: end });
  // `entered` tracks which step's onEnter has fired (so onLeave pairs correctly, incl. on end()).
  activeTour = { steps, index: 0, entered: -1, overlay, els, release };

  els.next.addEventListener('click', () => go(1));
  els.back.addEventListener('click', () => go(-1));
  els.skip.addEventListener('click', end);
  els.closeBtn.addEventListener('click', end);
  els.card.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  });
  window.addEventListener('resize', reflow);

  render();

  function go(delta) {
    const ni = activeTour.index + delta;
    if (ni < 0) return;
    if (ni >= steps.length) { end(); return; }
    activeTour.index = ni;
    render();
  }

  function render() {
    const i = activeTour.index, step = steps[i], last = i === steps.length - 1;
    // Fire onLeave for the previously-entered step, then onEnter for this one — BEFORE reflow
    // so a step that reveals its target (e.g. opening the properties panel) is measured live.
    if (activeTour.entered !== i) {
      try { steps[activeTour.entered]?.onLeave?.(modules); } catch { /* hooks are best-effort */ }
      activeTour.entered = i;
      try { step.onEnter?.(modules); } catch { /* hooks are best-effort */ }
    }
    els.title.textContent = step.title;
    els.body.innerHTML = renderBody(step.body);
    els.count.textContent = `${i + 1} / ${steps.length}`;
    els.back.style.display = i === 0 ? 'none' : '';   // no Back on the first step
    els.skip.style.display = last ? 'none' : '';       // no Skip on the last step
    els.next.textContent = last ? 'Finish' : 'Next';
    reflow();
    // Re-measure after layout settles (panel reveal/animation), then focus the primary action
    // so keyboard users land inside the trapped card.
    requestAnimationFrame(() => { reflow(); els.next.focus({ preventScroll: true }); });
    // A step whose onEnter reveals an animated panel (e.g. the properties panel slides in
    // over ~400ms) needs reflow again once the transition settles — sync/rAF reflow measured
    // it mid-slide. Re-measure at a few points, guarded to the still-active step.
    if (step.onEnter) [120, 300, 460].forEach((ms) => setTimeout(() => {
      if (activeTour && activeTour.index === i) reflow();
    }, ms));
  }

  // Position the spotlight + card for the current step (called on render + resize).
  function reflow() {
    const step = steps[activeTour.index];
    const rect = resolveTargetRect(step);
    if (rect) {
      // Spotlight cutout (its box-shadow dims the rest); catcher stays transparent.
      const pad = 6;
      Object.assign(els.spot.style, {
        left: `${rect.left - pad}px`, top: `${rect.top - pad}px`,
        width: `${rect.width + pad * 2}px`, height: `${rect.height + pad * 2}px`,
      });
      els.spot.hidden = false;
      els.catcher.classList.remove('df-tour__catcher--dim');
      positionCard(els.card, rect, step.placement);
    } else {
      // No (visible) target → centre the card and dim via the catcher instead.
      els.spot.hidden = true;
      els.catcher.classList.add('df-tour__catcher--dim');
      positionCard(els.card, null, 'center');
    }
  }

  // Resolve the highlighted region: a single `target` selector, or the union of several
  // `targets` (e.g. Save + Load share one spotlight). Returns null for centred steps or
  // when nothing visible is found, so the card falls back to centre + catcher dim.
  function resolveTargetRect(step) {
    if (step.placement === 'center') return null;
    const sels = step.targets || (step.target ? [step.target] : []);
    let u = null;
    for (const sel of sels) {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      const vis = r && r.width > 0 && r.height > 0
        && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      if (!vis) continue;
      u = u
        ? { left: Math.min(u.left, r.left), top: Math.min(u.top, r.top),
            right: Math.max(u.right, r.right), bottom: Math.max(u.bottom, r.bottom) }
        : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
    if (!u) return null;
    return { left: u.left, top: u.top, width: u.right - u.left, height: u.bottom - u.top,
             right: u.right, bottom: u.bottom };
  }

  function end() {
    if (!activeTour) return;
    // Fire the current step's onLeave (e.g. clear the example selection) before tearing down.
    try { steps[activeTour.entered]?.onLeave?.(modules); } catch { /* hooks are best-effort */ }
    window.removeEventListener('resize', reflow);
    release();
    overlay.remove();
    activeTour = null;
  }
}

// Place the card relative to the target rect (or viewport-centre when none), clamped to
// the viewport with a margin so it never spills off-screen (no layout shift on the page).
function positionCard(card, rect, placement) {
  const M = 16, GAP = 14;
  const cw = card.offsetWidth, ch = card.offsetHeight;
  const vw = innerWidth, vh = innerHeight;
  let left, top;
  if (!rect || placement === 'center') {
    left = (vw - cw) / 2; top = (vh - ch) / 2;
  } else if (placement === 'below' || placement === 'below-start') {
    top = rect.bottom + GAP;
    left = placement === 'below-start' ? rect.left : rect.left + rect.width / 2 - cw / 2;
  } else if (placement === 'above') {
    top = rect.top - ch - GAP;
    left = rect.left + rect.width / 2 - cw / 2;
  } else if (placement === 'left') {
    left = rect.left - cw - GAP;
    top = rect.top + rect.height / 2 - ch / 2;
  } else if (placement === 'right') {
    left = rect.right + GAP;
    top = rect.top + rect.height / 2 - ch / 2;
  } else if (placement === 'inside-top') {
    left = rect.left + rect.width / 2 - cw / 2;
    top = rect.top + GAP * 2;
  } else {
    left = (vw - cw) / 2; top = (vh - ch) / 2;
  }
  card.style.left = `${Math.round(Math.max(M, Math.min(left, vw - cw - M)))}px`;
  card.style.top = `${Math.round(Math.max(M, Math.min(top, vh - ch - M)))}px`;
}

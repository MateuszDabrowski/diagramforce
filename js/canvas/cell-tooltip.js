// Canvas hover tooltip for the `sf.Link` card's URL (1.22.0).
//
// WHY NOT THE NATIVE SVG `<title>`, WHICH THIS REPLACES
// 1.22.0 dropped the URL sublabel under the link label - at 10px, ellipsised to a 220px pill, it read
// "acme.my.salesf..." and told nobody anything - and moved the URL to a native `<title>` tooltip instead. That
// shipped twice and was reported broken both times, the second as "I managed to see it once out of few dozen
// hovers".
//
// The obvious structural explanation was wrong, and worth recording so it is not re-attempted: an SVG tooltip
// resolves from the nearest ANCESTOR-OR-SELF `<title>`, and the card's root `<g>` IS an ancestor of every part
// of it. Measured with elementFromPoint under a real hovering pointer, over the label glyphs, over bare body,
// over the icon, selected and not: the chain reached the root title EVERY time. A title on `root` alone is
// structurally sufficient, so spraying one onto each child fixes nothing.
//
// What is left is the native tooltip's own behaviour: the browser only shows one after the pointer rests for
// roughly a second WITHOUT changing hovered node, and this card is a mosaic of small siblings (a tspan per
// label line, the body rect, the icon image, the icon hit rect). Sweeping a mouse across it re-arms that timer
// at every boundary crossing - which is exactly a tooltip that appears once in a few dozen tries.
//
// The decisive argument, though, is testability: a native tooltip is browser chrome, not DOM, so NO test can
// observe whether it appeared. Two fixes shipped unverified and both were wrong. An app-owned tooltip is a DOM
// node - it can be asserted, and it is, in dev/tests/e2e/link-card-hover.spec.js.
//
// It is deliberately small: one div, shown on `element:mouseenter` for a link card that has a url, hidden on
// leave and on anything that moves the paper underneath it.

/** Dwell before showing. Short enough to feel like an answer, long enough not to flicker while passing over. */
const SHOW_DELAY = 220;
const EDGE_PAD = 8;      // keep the tip inside the viewport

let tipEl = null;
let showTimer = null;

function ensureTip() {
  if (tipEl?.isConnected) return tipEl;
  tipEl = document.createElement('div');
  tipEl.className = 'df-canvas-tip';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.hidden = true;
  document.body.appendChild(tipEl);
  return tipEl;
}

function hideTip() {
  clearTimeout(showTimer);
  showTimer = null;
  if (tipEl) { tipEl.hidden = true; tipEl.textContent = ''; }
}

/**
 * Show `text` near a card, after the dwell. Positioned ABOVE the card and centred on it, falling below when
 * there is no room above - the pointer is on the card, so anchoring to the card rather than the cursor keeps
 * the tip still while the pointer moves within it.
 */
function showTipFor(el, text) {
  clearTimeout(showTimer);
  showTimer = setTimeout(() => {
    const tip = ensureTip();
    tip.textContent = text;
    tip.hidden = false;
    // Measure after it is in the DOM and rendered, or width/height are 0 and the clamp misplaces it.
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(EDGE_PAD, Math.min(left, window.innerWidth - t.width - EDGE_PAD));
    const above = r.top - t.height - EDGE_PAD;
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(above >= EDGE_PAD ? above : r.bottom + EDGE_PAD)}px`;
  }, SHOW_DELAY);
}

/** The hover text for a cell, or null if it has none. Only link cards carry one today. */
export function cellTooltipText(cell) {
  if (!cell || cell.get('type') !== 'sf.Link') return null;
  const url = cell.get('url');
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

export function registerCellTooltip(cctx) {
  const { paper, graph } = cctx;
  if (!paper) return;

  paper.on('element:mouseenter', (view) => {
    const text = cellTooltipText(view?.model);
    if (text) showTipFor(view.el, text); else hideTip();
  });
  paper.on('element:mouseleave', hideTip);

  // Anything that moves the paper under a shown tip, or replaces the card, leaves it pointing at nothing.
  for (const ev of ['element:pointerdown', 'blank:pointerdown', 'link:pointerdown', 'paper:pan', 'scale']) {
    paper.on(ev, hideTip);
  }
  paper.el?.addEventListener('wheel', hideTip, { passive: true });
  window.addEventListener('blur', hideTip);
  // A deleted card must not leave its tip behind.
  graph?.on('remove', hideTip);
}

/** Test seam: tear the tip down. */
export function _resetCellTooltip() {
  hideTip();
  tipEl?.remove();
  tipEl = null;
}

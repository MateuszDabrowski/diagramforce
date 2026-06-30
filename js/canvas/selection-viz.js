// Selection visualization — link hover / focus tinting. Extracted from canvas.js
// (Phase 4, Slice 10).
//
// When a connector is hovered or selected (`.selected`, owned by selection.js),
// this lifts it above overlapping links (SVG paint order), draws a selection-
// coloured HALO under its line + end markers + label (an additive cue that
// renders in every engine, incl. WebKit — unlike a CSS drop-shadow filter), and
// tints any crossing-bump arcs tagged with its id. A microtask sweep restores
// links that lose focus without firing a link-level event (a blank-canvas click).
//
// Element selection (the `.selected` class + selection box) is owned by
// js/selection.js — this module only READS `.selected`. No public exports
// besides the registration hook; `registerSelectionViz(cctx)` is called once in
// canvas.init() after cctx.graph/paper are wired.
import { cctx } from './context.js?v=1.19.0.49';
import { getBumpLayer } from './crossing-bumps.js?v=1.19.0.49';

// ── Private state ───────────────────────────────────────────────────
const linkOriginalNext = new WeakMap();   // linkView → original nextSibling (z-order restore)
const linkMarkerOriginals = new Map();    // linkView → { halo, haloMarkers, pathObserver } — the .df-link-halo underlay + marker clones + the line-`d` tracker; sweep iterates it
const linkLabelOriginals = new Map();     // linkView → [{ el, stroke, sw, so, rx, ry }] — saved label bg-rect attrs (pill border)
const _bumpsTinted = new Set();           // linkId set — which links have tinted bump arcs
let haloMarkerSeq = 0;                     // unique id counter for the halo's recoloured <marker> clones
const SELECTION_COLOR_FALLBACK = '#1D73C9';

// ── Focus colour ────────────────────────────────────────────────────
const getSelectionColor = () => {
  try {
    const c = getComputedStyle(document.documentElement)
      .getPropertyValue('--selection-color').trim();
    return c || SELECTION_COLOR_FALLBACK;
  } catch { return SELECTION_COLOR_FALLBACK; }
};

// ── Z-order: lift hovered/selected link above overlapping siblings ───
// SVG has no z-index — paint order is DOM document order, so a link is visible
// above another only if its <g> appears LATER in the parent. We stash the
// original next-sibling and put it back when focus ends, so the canvas doesn't
// drift into "every link ever hovered is permanently on top".
const bringLinkToFront = (linkView) => {
  const el = linkView?.el;
  const parent = el?.parentNode;
  if (!el || !parent) return;
  if (el === parent.lastChild) return;
  if (!linkOriginalNext.has(linkView)) {
    linkOriginalNext.set(linkView, el.nextSibling);
  }
  parent.appendChild(el);
};
const restoreLinkOrder = (linkView) => {
  const el = linkView?.el;
  const parent = el?.parentNode;
  if (!el || !parent) return;
  if (!linkOriginalNext.has(linkView)) return;
  const next = linkOriginalNext.get(linkView);
  linkOriginalNext.delete(linkView);
  // The saved next-sibling may have been removed (e.g. the link it
  // pointed to was deleted). If so, fall back to appendChild — the link
  // stays at the end, which is a harmless drift; better than throwing.
  try {
    if (next && next.parentNode === parent) parent.insertBefore(el, next);
    else parent.appendChild(el);
  } catch { /* defensive — DOM in unexpected state */ }
};

// ── Connector highlight: a selection-coloured HALO under the line ────
// A focused link (hover/select) gets an ADDITIVE halo: a CLONE of the line painted UNDERNEATH with a wider,
// semi-transparent selection-coloured stroke. The real line + its markers sit ON TOP, so they keep their real
// colour (never a recolour — the masking the old scheme caused; see GOTCHAS §2.2a). Why a stroke, not a glow:
// a CSS `filter: drop-shadow` looked right in Blink but Safari/WebKit does NOT PAINT CSS filters on SVG paths
// (it applies the style, skips the paint), so the highlight VANISHED in Safari; an SVG `<filter>` made the line
// disappear there. A wider stroke is plain SVG every engine renders (CR: "highlight doesn't work on Safari").
// The halo also carries RECOLOURED, WIDENED clones of the end markers so the arrowhead / ER tip gets a haloed
// outline. Preserve only EXPLICIT masking/open fills (so open ER tips stay open + a circle keeps its mask); a
// null fill is a closed arrow that inherits the line colour, so it gets tinted.
const isPreservedMarkerFill = (v) => v === 'none' || /transparent|bg-canvas/i.test(v || '');
const tintLinkMarkers = (linkView) => {
  const el = linkView?.el;
  if (!el || linkMarkerOriginals.has(linkView)) return;
  const line = el.querySelector('[joint-selector="line"]');
  if (!line || !line.parentNode) { linkMarkerOriginals.set(linkView, { halo: null, haloMarkers: [] }); return; }
  const color = getSelectionColor();
  const w = parseFloat(line.getAttribute('stroke-width')) || parseFloat(getComputedStyle(line).strokeWidth) || 2;
  const halo = line.cloneNode(false);
  halo.removeAttribute('id');
  halo.removeAttribute('joint-selector');   // MUST NOT be "line" — else [joint-selector=line] queries (+ JointJS) match the halo
  halo.style.filter = '';
  halo.setAttribute('class', 'df-link-halo');
  halo.setAttribute('pointer-events', 'none');
  halo.setAttribute('stroke', color);
  halo.setAttribute('stroke-width', String(w + 6));
  halo.setAttribute('stroke-opacity', '0.4');
  halo.setAttribute('fill', 'none');
  halo.setAttribute('stroke-linecap', 'butt');    // butt, NOT round: a round cap bulges ~half-width PAST the endpoint,
  halo.setAttribute('stroke-linejoin', 'round');  // overflowing the end-marker halo + wrapping the band AROUND the end (CR)
  halo.removeAttribute('stroke-dasharray');     // a dashed/dotted line still gets a SOLID halo

  // END markers: an ARROW marker auto-inherits the line stroke (so the halo's own stroke already tints it), but
  // an ER crow's-foot carries an EXPLICIT colour — a SHARED def renders grey on the halo, so the ends look
  // un-highlighted (CR). Clone each referenced marker def, paint it the halo colour, and point the HALO at the
  // clone, so the arrowhead / ER tip gets a haloed outline in EVERY case. We touch only the HALO's refs, never
  // the live line's marker-end/start — so the retired "stuck arrowhead" bug (which swapped the live line) can't
  // recur; the clones are removed with the halo in restoreLinkMarkers + the sweep.
  const haloMarkers = [];
  const root = el.ownerSVGElement;
  const defs = root?.querySelector('defs');
  if (defs) {
    for (const attr of ['marker-end', 'marker-start']) {
      const m = (halo.getAttribute(attr) || '').match(/url\(#([^)]+)\)/);
      const orig = m && root.getElementById(m[1]);
      if (!orig) continue;
      const clone = orig.cloneNode(true);
      clone.setAttribute('id', `df-halo-marker-${++haloMarkerSeq}`);
      clone.querySelectorAll('path').forEach((p) => {
        const f = p.getAttribute('fill');
        const sw = parseFloat(p.getAttribute('stroke-width')) || 2;
        p.setAttribute('stroke', color);
        p.setAttribute('stroke-width', String(sw + 6));   // markers are userSpaceOnUse (fixed size), so a same-size
        if (!isPreservedMarkerFill(f)) p.setAttribute('fill', color);   // clone hides UNDER the real marker — widen
        p.setAttribute('opacity', '0.4');                                // the stroke (overflow visible) so it pokes out;
        // +6 (NOT +4) so the end halo pokes the SAME ~3px as the body halo (w+6) — else the ending reads thinner.
      });
      defs.appendChild(clone);
      halo.setAttribute(attr, `url(#${clone.id})`);
      haloMarkers.push(clone);
    }
  }
  line.parentNode.insertBefore(halo, line);     // earlier sibling = painted first = UNDER the line

  // Keep the halo GLUED to the line while the connector is dragged / re-routed: the halo is a STATIC clone, so
  // without this it stays at the OLD path until drop (CR). A MutationObserver on the line's `d` copies each new
  // path to the halo (its markers re-anchor to the path ends automatically) — render-timing-agnostic, fires
  // exactly when JointJS rewrites `d`, and watches the LINE (never the halo) so it can't self-trigger.
  let pathObserver = null;
  try {
    pathObserver = new MutationObserver(() => { halo.setAttribute('d', line.getAttribute('d') || ''); });
    pathObserver.observe(line, { attributes: true, attributeFilter: ['d'] });
  } catch { /* no MutationObserver - halo just won't live-track (still correct on re-select) */ }
  linkMarkerOriginals.set(linkView, { halo, haloMarkers, pathObserver });
};
const restoreLinkMarkers = (linkView) => {
  const data = linkMarkerOriginals.get(linkView);
  if (!data) return;
  linkMarkerOriginals.delete(linkView);
  data.pathObserver?.disconnect();   // stop tracking the line's `d` before the halo goes away
  data.halo?.parentNode?.removeChild(data.halo);
  data.haloMarkers?.forEach((mk) => mk.parentNode?.removeChild(mk));   // drop the recoloured marker clones too
};

// ── Bump tint: re-stroke crossing-bump arcs tagged with the link id ──
// Mirrors the marker-tinting pattern: a per-link-id Set tracks which links are
// currently tinted; the sweep restores stale entries. Reads the bump layer
// directly from crossing-bumps.js (the focus-tinting bridge).
const tintLinkBumps = (linkView) => {
  if (!getBumpLayer()) return;
  const linkId = linkView?.model?.id;
  if (!linkId || _bumpsTinted.has(linkId)) return;
  _bumpsTinted.add(linkId);
  const color = getSelectionColor();
  getBumpLayer().querySelectorAll(`[data-link-id="${CSS.escape(String(linkId))}"]`).forEach(el => {
    if (!el.hasAttribute('data-orig-stroke')) {
      el.setAttribute('data-orig-stroke', el.getAttribute('stroke') ?? '');
    }
    el.setAttribute('stroke', color);
  });
};
const restoreLinkBumps = (linkView) => {
  if (!getBumpLayer()) return;
  const linkId = linkView?.model?.id;
  if (!linkId || !_bumpsTinted.has(linkId)) return;
  _bumpsTinted.delete(linkId);
  getBumpLayer().querySelectorAll(`[data-link-id="${CSS.escape(String(linkId))}"]`).forEach(el => {
    const orig = el.getAttribute('data-orig-stroke');
    if (orig == null) return;
    if (orig) el.setAttribute('stroke', orig);
    else el.removeAttribute('stroke');
    el.removeAttribute('data-orig-stroke');
  });
};

// ── Label highlight: a selection-coloured PILL border around each label ──
// Labels render in a SEPARATE joint-labels-layer <g> the line halo can't reach. Highlight each by wrapping its
// background `rect` in a selection-coloured ROUNDED (pill) border — the label keeps its own colours + stays
// READABLE (a stroked-text outline thickened the glyphs; CR: "wrap it in a blue pill-shaped border, more
// readable"). Plain SVG `stroke` + `rx`/`ry` (pill = corner radius half the rect height), so it renders in every
// engine incl. WebKit (a CSS `filter` glow didn't paint in Safari). Snapshot + restore the touched attrs. The
// clock <image> rides inside the freq label's rect, so it sits inside the pill too.
const tintLinkLabels = (linkView) => {
  if (!linkView || linkLabelOriginals.has(linkView)) return;
  const id = linkView.model?.id;
  const root = cctx.paper?.el;
  if (id == null || !root) return;
  const color = getSelectionColor();
  const scope = `.joint-link[model-id="${CSS.escape(String(id))}"]`;
  const saved = [];   // [{ el, stroke, sw, so, rx, ry }] — restored verbatim
  root.querySelectorAll(`${scope} rect`).forEach((r) => {
    let h = 0;
    try { h = r.getBBox().height; } catch { /* not laid out yet */ }
    const rad = String(h ? Math.round(h / 2) : 8);   // pill ends: corner radius = half the rect height
    saved.push({ el: r, stroke: r.getAttribute('stroke'), sw: r.getAttribute('stroke-width'),
      so: r.getAttribute('stroke-opacity'), rx: r.getAttribute('rx'), ry: r.getAttribute('ry') });
    r.setAttribute('stroke', color);
    r.setAttribute('stroke-width', '5');         // a soft BAND, not a crisp line — matches the body halo's weight
    r.setAttribute('stroke-opacity', '0.4');     // SAME colour + opacity as the line/marker halo (CR: consistency)
    r.setAttribute('rx', rad);
    r.setAttribute('ry', rad);
  });
  if (saved.length) linkLabelOriginals.set(linkView, saved);
};
const restoreLinkLabels = (linkView) => {
  const saved = linkLabelOriginals.get(linkView);
  if (!saved) return;
  linkLabelOriginals.delete(linkView);
  const put = (el, attr, v) => { if (v == null) el.removeAttribute(attr); else el.setAttribute(attr, v); };
  saved.forEach(({ el, stroke, sw, so, rx, ry }) => {
    put(el, 'stroke', stroke); put(el, 'stroke-width', sw); put(el, 'stroke-opacity', so); put(el, 'rx', rx); put(el, 'ry', ry);
  });
};

// ── Sweep: restore links that lost focus without a link-level event ──
// Deferred via queueMicrotask so selection.js's pointerdown handler (registered
// AFTER canvas.init by app.js) gets to add/remove `.selected` first. Without
// this defer, sweeping during link:pointerdown would see the just-deselected
// link still marked `.selected` and leave it tinted.
// `keep` (optional) is the link the pointer JUST entered — never strip it. bringLinkToFront's
// appendChild momentarily clears that link's `:hover`, so without this exclusion the very sweep
// fired on its own mouseenter would restore the link the user is actively hovering.
const sweepStaleMarkerTints = (keep) => queueMicrotask(() => {
  const keepId = keep?.model?.id;
  for (const linkView of [...linkMarkerOriginals.keys()]) {
    if (linkView === keep) continue;
    const el = linkView?.el;
    if (!el) { linkMarkerOriginals.delete(linkView); continue; }
    const stillFocused = el.classList.contains('selected') || el.matches(':hover');
    if (!stillFocused) {
      restoreLinkMarkers(linkView);
      restoreLinkOrder(linkView);
    }
  }
  // Sweep stale bump tints alongside markers — same focus semantics.
  for (const linkId of [..._bumpsTinted]) {
    if (linkId === keepId) continue;
    const view = cctx.paper.findViewByModel(linkId);
    const stillFocused = view?.el?.classList.contains('selected')
                      || view?.el?.matches(':hover');
    if (!stillFocused) restoreLinkBumps(view || { model: { id: linkId } });
  }
  // …and stale label tints — decoupled from markers (a labelless link is never in this map).
  for (const linkView of [...linkLabelOriginals.keys()]) {
    if (linkView === keep) continue;
    const el = linkView?.el;
    const stillFocused = el && (el.classList.contains('selected') || el.matches(':hover'));
    if (!stillFocused) restoreLinkLabels(linkView);
  }
});

// ── Registration: bind the hover/focus listeners to the live paper/graph ─
export function registerSelectionViz(cctx) {
  const { paper, graph } = cctx;

  paper.on('link:mouseenter', (linkView) => {
    bringLinkToFront(linkView);
    tintLinkMarkers(linkView);
    tintLinkBumps(linkView);
    tintLinkLabels(linkView);
    // Moving fast across a dense fan of overlapping connectors DROPS some links' mouseleave (the
    // pointer jumps off without the browser firing leave), stranding their glow filter. Every enter
    // also sweeps: any glowed link that's no longer
    // :hover (and not selected) gets restored, so strays never accumulate as the pointer travels.
    // Keep the just-entered link — its :hover is briefly cleared by the bringLinkToFront reorder.
    sweepStaleMarkerTints(linkView);
  });
  paper.on('link:mouseleave', (linkView) => {
    // Keep selected links lifted — selection is sustained focus.
    if (linkView?.el?.classList.contains('selected')) return;
    restoreLinkOrder(linkView);
    restoreLinkMarkers(linkView);
    restoreLinkBumps(linkView);
    restoreLinkLabels(linkView);
    sweepStaleMarkerTints();   // also catch strays whose own mouseleave was dropped
  });
  paper.on('link:pointerdown', (linkView) => {
    bringLinkToFront(linkView);
    tintLinkMarkers(linkView);
    tintLinkBumps(linkView);
    tintLinkLabels(linkView);
    // Clicking link A deselects link B; sweep restores B's markers/bumps.
    sweepStaleMarkerTints();
  });
  paper.on('blank:pointerdown', sweepStaleMarkerTints);
  paper.on('element:pointerdown', sweepStaleMarkerTints);

  // When attrs change on a currently-focused link (most commonly: the user changing source/target end style or
  // colour via the property picker while the link is selected), JointJS re-renders the line/markers — the fresh
  // elements don't carry our inline glow filter. Defer one microtask so JointJS finishes its re-render, then
  // tear down our stale glow refs and re-glow against the freshly rendered elements.
  graph.on('change:attrs', (cell) => {
    if (!cell.isLink()) return;
    const linkView = paper.findViewByModel(cell);
    if (!linkView || !linkMarkerOriginals.has(linkView)) return;
    queueMicrotask(() => {
      if (!linkMarkerOriginals.has(linkView)) return;
      restoreLinkMarkers(linkView);
      tintLinkMarkers(linkView);
    });
  });

  // A focused link whose labels are rebuilt (text edit, frequency change → new <text> DOM) loses the
  // tint with the old nodes — re-apply it against the fresh labels. Defer so JointJS finishes rendering.
  graph.on('change:labels', (cell) => {
    if (!cell.isLink()) return;
    const linkView = paper.findViewByModel(cell);
    if (!linkView || !linkLabelOriginals.has(linkView)) return;
    queueMicrotask(() => {
      restoreLinkLabels(linkView);   // drop stale (now-detached) text nodes
      const el = linkView.el;
      if (el && (el.classList.contains('selected') || el.matches(':hover'))) tintLinkLabels(linkView);
    });
  });
}

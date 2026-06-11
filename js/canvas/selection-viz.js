// Selection visualization — link hover / focus tinting. Extracted from canvas.js
// (Phase 4, Slice 10).
//
// When a connector is hovered or selected (`.selected`, owned by selection.js),
// this lifts it above overlapping links (SVG paint order), recolours its
// arrowhead / ER markers to `--selection-color`, and tints any crossing-bump
// arcs tagged with its id. A microtask sweep restores links that lose focus
// without firing a link-level event (e.g. a blank-canvas click that clears
// selection).
//
// Element selection (the `.selected` class + selection box) is owned by
// js/selection.js — this module only READS `.selected`. No public exports
// besides the registration hook; `registerSelectionViz(cctx)` is called once in
// canvas.init() after cctx.graph/paper are wired.
import { cctx } from './context.js?v=1.16.1';
import { getBumpLayer } from './crossing-bumps.js?v=1.16.1';

// ── Private state ───────────────────────────────────────────────────
const linkOriginalNext = new WeakMap();   // linkView → original nextSibling (z-order restore)
const linkMarkerOriginals = new Map();    // linkView → { saved, markerSwaps } — Map: the sweep iterates it
const linkLabelOriginals = new Map();     // linkView → [{ el, orig }] — saved <text> fills for label tint
const _bumpsTinted = new Set();           // linkId set — which links have tinted bump arcs
let focusMarkerCloneSeq = 0;              // unique id counter for cloned <marker> defs
const SELECTION_COLOR_FALLBACK = '#1D73C9';

// ── Focus colour ────────────────────────────────────────────────────
const getSelectionColor = () => {
  try {
    const c = getComputedStyle(document.documentElement)
      .getPropertyValue('--selection-color').trim();
    return c || SELECTION_COLOR_FALLBACK;
  } catch { return SELECTION_COLOR_FALLBACK; }
};
const isPreservedFill = (val) => {
  if (!val) return true;
  const v = val.trim().toLowerCase();
  return v === 'none' || v === 'transparent' || v.includes('bg-canvas');
};
const tintPath = (p, color, saved) => {
  const origStroke = p.getAttribute('stroke');
  const origFill = p.getAttribute('fill');
  saved.push({ el: p, origStroke, origFill });
  // Override stroke unconditionally — markers either have an explicit
  // stroke we want to swap, or none (auto-inherit) in which case
  // setting it makes the recolour explicit and visible.
  p.setAttribute('stroke', color);
  // Only override "real" fills — leave masking fills (none / bg) intact
  // so the circular open-stroke markers keep their visual notch.
  if (!isPreservedFill(origFill)) p.setAttribute('fill', color);
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

// ── Marker tint: recolour source/target arrowheads + ER notation ─────
// CSS recolours the line, but JointJS v4 renders sourceMarker/targetMarker as
// inline <path> children (or shared <marker> defs) with explicit stroke/fill
// that out-specify CSS. Snapshot + overwrite while focused, restore on unfocus.
// Shared <marker> defs are cloned (fresh id) so the tint doesn't leak to
// sibling links pointing at the same def.
const tintLinkMarkers = (linkView) => {
  const el = linkView?.el;
  if (!el || linkMarkerOriginals.has(linkView)) return;
  const color = getSelectionColor();
  const saved = [];           // direct path tints (inline marker case)
  const markerSwaps = [];     // { lineEl, attrName, origRef, cloneEl }

  // (A) Inline marker paths — JointJS v4 may render
  // sourceMarker/targetMarker as <path> children of the link group
  // (with a joint-selector like "line"/"sourceMarker"). Those aren't
  // shared between links so tinting them in place is safe.
  el.querySelectorAll('path').forEach(p => {
    const sel = p.getAttribute('joint-selector');
    if (sel === 'wrapper' || sel === 'line') return;
    tintPath(p, color, saved);
  });
  // (#7) Tint the LINE itself by attribute too. The `.joint-link:hover/.selected [joint-selector=line]`
  // CSS only fires when the pointer is on the cells-layer line — hovering the link's LABEL (a separate
  // layer) leaves the line grey. Setting the stroke directly (restored on blur) makes the WHOLE connector
  // recolour whichever part is hovered. The CSS rule still wins harmlessly on a real line :hover.
  const lineEl = el.querySelector('[joint-selector="line"]');
  if (lineEl) tintPath(lineEl, color, saved);

  // (B) <marker> defs — the shared-pool rendering path. Clone, tint
  // the clone, swap the line's marker-start / marker-end ref.
  const line = el.querySelector('[joint-selector="line"]');
  const root = el.ownerSVGElement;
  const defs = root?.querySelector('defs');
  if (line && root && defs) {
    for (const attrName of ['marker-start', 'marker-end']) {
      const ref = line.getAttribute(attrName);
      if (!ref) continue;
      const m = ref.match(/url\(#([^)]+)\)/);
      if (!m) continue;
      const origMarker = root.getElementById(m[1]);
      if (!origMarker) continue;
      const cloneId = `df-focus-marker-${++focusMarkerCloneSeq}`;
      const cloneEl = origMarker.cloneNode(true);
      cloneEl.setAttribute('id', cloneId);
      cloneEl.querySelectorAll('path').forEach(p => {
        const origFill = p.getAttribute('fill');
        p.setAttribute('stroke', color);
        if (!isPreservedFill(origFill)) p.setAttribute('fill', color);
      });
      defs.appendChild(cloneEl);
      markerSwaps.push({ lineEl: line, attrName, origRef: ref, cloneEl });
      line.setAttribute(attrName, `url(#${cloneId})`);
    }
  }

  linkMarkerOriginals.set(linkView, { saved, markerSwaps });
};
const restoreLinkMarkers = (linkView) => {
  const data = linkMarkerOriginals.get(linkView);
  if (!data) return;
  linkMarkerOriginals.delete(linkView);
  const { saved, markerSwaps } = data;
  saved.forEach(({ el, origStroke, origFill }) => {
    if (origStroke == null) el.removeAttribute('stroke');
    else el.setAttribute('stroke', origStroke);
    if (origFill == null) el.removeAttribute('fill');
    else el.setAttribute('fill', origFill);
  });
  // Re-resolve the LIVE line element. JointJS may have re-rendered the link (reroute, crossing-
  // bump recompute, a position/size change on an endpoint) between tint and restore, which
  // detaches the `lineEl` we captured at tint time. Restoring only that stale node leaves the
  // *live* line still pointing at our tinted clone → the "stuck arrowhead colour" bug. Blink
  // (Chrome/Vivaldi) re-renders more eagerly than WebKit, which is why it surfaced there and not
  // in Safari. Reset whichever of the two nodes still references our clone.
  const liveLine = linkView?.el?.querySelector('[joint-selector="line"]') || null;
  markerSwaps.forEach(({ lineEl, attrName, origRef, cloneEl }) => {
    // Only put origRef back where the line still points at OUR clone. If the user changed the
    // marker style mid-focus (property picker), JointJS re-rendered the line with a fresh
    // `url(#new-marker-id)`, so our origRef is stale there — leave it so we don't resurrect the
    // pre-change marker. The clone is removed unconditionally; it has no further purpose.
    for (const el of new Set([lineEl, liveLine])) {
      if (el && (el.getAttribute(attrName) || '').includes(cloneEl.id)) {
        el.setAttribute(attrName, origRef);
      }
    }
    cloneEl.parentNode?.removeChild(cloneEl);
  });
};

// Belt-and-braces cleanup for any focus-marker clone that escaped restore — e.g. a re-render
// landed between tint and a mouseleave that never fired. Removes clones no line references; for
// a clone a live line STILL points at (an actually-stuck tint), it first re-renders that link
// from its model so the arrowhead reverts to the real marker, then drops the orphan. Runs in the
// stale-tint sweep, so a stuck marker self-heals on the next canvas interaction.
const cleanupOrphanFocusMarkers = () => {
  const paper = cctx.paper;
  const svg = paper?.svg || paper?.el?.querySelector('svg');
  const defs = svg?.querySelector('defs');
  if (!defs) return;
  const owned = new Set();
  for (const { markerSwaps } of linkMarkerOriginals.values())
    for (const s of markerSwaps) owned.add(s.cloneEl.id);
  defs.querySelectorAll('marker[id^="df-focus-marker-"]').forEach((clone) => {
    if (owned.has(clone.id)) return;   // still backing an active tint — keep
    svg.querySelectorAll(`[marker-start="url(#${clone.id})"],[marker-end="url(#${clone.id})"]`)
      .forEach((lineEl) => {
        const view = paper.findView?.(lineEl.closest('.joint-link'));
        view?.update?.();   // re-render from the model → arrowhead reverts to its real marker
      });
    clone.remove();
  });
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

// ── Label tint: recolour the link's text labels (user label + frequency overlay) ──
// Labels render in a SEPARATE joint-labels-layer <g> carrying the SAME model-id (labelsLayer:true), so
// the `.joint-link:hover/.selected [joint-selector=line]` CSS that tints the line never reaches them.
// Mirror the marker tint: snapshot each label's tintable attribute (<text> `fill`, frequency clock
// <image> `href`) and overwrite with the --selection-color render while focused, restore on blur.
const tintLinkLabels = (linkView) => {
  if (!linkView || linkLabelOriginals.has(linkView)) return;
  const id = linkView.model?.id;
  const root = cctx.paper?.el;
  if (id == null || !root) return;
  const color = getSelectionColor();
  const scope = `.joint-link[model-id="${CSS.escape(String(id))}"]`;
  const saved = [];   // [{ el, attr, orig }] — uniform attr-swap, restored verbatim
  root.querySelectorAll(`${scope} text`).forEach((t) => {
    saved.push({ el: t, attr: 'fill', orig: t.getAttribute('fill') });
    t.setAttribute('fill', color);
  });
  // (#8) The frequency clock is a baked data-URI <image>; recolour it by swapping `href` to a
  // selection-colour render. Setting `href` overrides any original `xlink:href` (SVG2), so restoring
  // a null orig simply drops our `href` and the untouched original shows through. No-op without the gen.
  const clockUri = cctx.freqClockUri?.(color);
  if (clockUri) root.querySelectorAll(`${scope} image`).forEach((img) => {
    saved.push({ el: img, attr: 'href', orig: img.getAttribute('href') });
    img.setAttribute('href', clockUri);
  });
  if (saved.length) linkLabelOriginals.set(linkView, saved);
};
const restoreLinkLabels = (linkView) => {
  const saved = linkLabelOriginals.get(linkView);
  if (!saved) return;
  linkLabelOriginals.delete(linkView);
  saved.forEach(({ el, attr, orig }) => {
    if (orig == null) el.removeAttribute(attr);
    else el.setAttribute(attr, orig);
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
  // Drop any focus-marker clone that slipped through restore (self-heals a stuck arrowhead).
  cleanupOrphanFocusMarkers();
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
    // pointer jumps off without the browser firing leave), stranding their tinted clone → the
    // "stuck arrowhead colour" bug. Every enter also sweeps: any tinted link that's no longer
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

  // When attrs change on a currently-focused link (most commonly: the user
  // changing source/target end style via the property picker while the link is
  // selected), JointJS re-renders the line with a fresh marker URL. Our clone
  // is now orphaned and the line shows the new (un-tinted) marker. Defer one
  // microtask so JointJS finishes its re-render, then tear down our stale tint
  // and re-tint against the freshly rendered markers.
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

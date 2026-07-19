// Capture-visibility overlay (v1.19.2) — when exactly ONE grouping shape (a
// HALO_PARENT_TYPES captor: Container / Zone / BPMN Pool-Subprocess-Loop / RACI
// Task / Task Group) is selected, tint its embedding state so it's legible before
// any drag:
//   • CAPTURED children      → SOLID amber halo (they're inside the container)
//   • OVERLAPPING free shapes → DASHED amber halo (they sit over it but are
//     NOT captured, and COULD be — exactly what the multi-select Group action
//     (stage d) would pull in)
// Uses the connector-focus halo STYLE (soft/wide/translucent) in the neutral brand AMBER — NOT the
// selection colour (which flips to brand-red in dark theme, too aggressive) and NOT the Highlight-States
// green/amber (those would clash on a captor whose children carry a Shape state). Amber is theme-stable.
// Scoped to shapes over that one captor — never the whole canvas.
//
// The transient-`<g>`-in-`.joint-layers` lifecycle (rides pan/zoom, redraws on move/embed, auto-clears on a
// graph reset) is the shared overlay-layer.js kit — capture adds `change:parent` to its event list so the halos
// re-read the moment an embed changes. cctx-only (no init wiring) — driven by selection.onChange via the canvas
// facade. This module supplies its own captor detection + halo/pill draw.
import { cctx } from './context.js?v=1.20.0.63';
import { createOverlay } from './overlay-layer.js?v=1.20.0.63';
import { HALO_PARENT_TYPES, enclosedCapturableShapes, groupChildrenInto } from './embedding.js?v=1.20.0.63';

const SVGNS = 'http://www.w3.org/2000/svg';
// Adopt the CONNECTOR-focus halo STYLE (v1.19.2.10): a soft, wide, translucent stroke — captured = SOLID
// halo, overlapping-free = DASHED halo. Colour is the neutral brand amber (v1.19.2.11): deliberately NOT the
// old green/amber SHAPE_STATE / Highlight-States colours (bold green, dotted amber — would have clashed on a
// captor whose children carry a Shape state), and NOT the selection colour (flips to brand-red in dark theme,
// too aggressive). Amber is theme-stable, used by no other shape overlay, and this overlay is transient (only
// while a captor is selected), so solid-vs-dashed is enough to read "inside" vs "over it, but free".
const HALO_WIDTH = 6;      // wide soft band (mirrors the connector halo's line-width + 6)
const HALO_OPACITY = 0.5;
const PAD = 5;             // sit the halo just outside the shape edge

function getHaloColor() {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--brand-amber').trim();
    return v || '#F6B355';
  } catch { return '#F6B355'; }
}

let _captorId = null;

const overlay = createOverlay({
  className: 'df-capture-overlay',
  events: 'change:position change:size change:parent add remove',
  onTeardown: () => { _captorId = null; },
});

function haloRect(x, y, w, h, color, dashed) {
  const r = document.createElementNS(SVGNS, 'rect');
  r.setAttribute('x', String(x)); r.setAttribute('y', String(y));
  r.setAttribute('width', String(Math.max(0, w))); r.setAttribute('height', String(Math.max(0, h)));
  r.setAttribute('rx', '8'); r.setAttribute('ry', '8');
  r.setAttribute('fill', 'none'); r.setAttribute('stroke', color);
  r.setAttribute('stroke-width', String(HALO_WIDTH));
  r.setAttribute('stroke-opacity', String(HALO_OPACITY));
  r.setAttribute('stroke-linejoin', 'round');
  if (dashed) r.setAttribute('stroke-dasharray', '6 5');   // free (overlapping, not captured)
  r.setAttribute('vector-effect', 'non-scaling-stroke');
  return r;
}

// The captor's direct children — scan by `parent` attribute (authoritative even
// mid-embed, where getEmbeddedCells can momentarily lag; see embedding.js:322).
function capturedElements(captor) {
  const { graph } = cctx;
  return graph.getElements().filter((c) => c.get('parent') === captor.id);
}

// A small clickable "Group N" pill anchored to the captor's top-RIGHT corner, offered when it has enclosed-
// but-ungrouped shapes. WIRE style (v1.19.2.15): a transparent fill + a DASHED amber border matching the
// uncaptured-shape halos + amber ＋/text — so the pill reads as part of the same "these could be grouped"
// language, not a solid button. Lives in the (scaled) overlay `<g>` but is COUNTER-scaled (scale 1/s) so it
// stays a constant screen size at any zoom; pointer-events:auto so it's clickable while the rest of the layer
// is pass-through. Press → group them all in one undo step (then the overlay redraws: pill gone, dashed→solid).
function drawGroupPill(layer, captor, enclosed, color) {
  const { paper } = cctx;
  const bb = captor.getBBox();
  const s = (paper?.scale?.().sx) || 1;
  const label = `Group ${enclosed.length} ${enclosed.length === 1 ? 'shape' : 'shapes'}`;
  // Layout (screen px): padX inner margin, a plus glyph, a gap, then the label.
  const padX = 13, iconR = 4.5, gap = 9, h = 26;
  const textW = Math.ceil(label.length * 6.9);
  const w = padX + iconR * 2 + gap + textW + padX;
  const g = document.createElementNS(SVGNS, 'g');
  g.setAttribute('class', 'df-capture-overlay__pill');
  g.setAttribute('pointer-events', 'auto');
  g.style.cursor = 'pointer';
  // Anchor at the captor's top-right corner (local coords); counter-scale so pill coords below are screen px.
  g.setAttribute('transform', `translate(${bb.x + bb.width}, ${bb.y}) scale(${1 / s})`);
  const x0 = -(w + 6), y0 = 6;   // just inside the top-right corner
  const bg = document.createElementNS(SVGNS, 'rect');
  bg.setAttribute('x', String(x0)); bg.setAttribute('y', String(y0));
  bg.setAttribute('width', String(w)); bg.setAttribute('height', String(h));
  bg.setAttribute('rx', String(h / 2)); bg.setAttribute('ry', String(h / 2));
  // Transparent fill (wire look) but `pointer-events:all` so the whole pill is a click target; dashed amber
  // border in the SAME dash language as the uncaptured halos.
  bg.setAttribute('fill', 'transparent'); bg.setAttribute('pointer-events', 'all');
  bg.setAttribute('stroke', color); bg.setAttribute('stroke-width', '1.5');
  bg.setAttribute('stroke-dasharray', '5 4'); bg.setAttribute('stroke-opacity', '0.95');
  g.appendChild(bg);
  // ＋ glyph (amber, to match)
  const cx = x0 + padX + iconR, cy = y0 + h / 2;
  const plus = document.createElementNS(SVGNS, 'path');
  plus.setAttribute('d', `M ${cx - iconR} ${cy} H ${cx + iconR} M ${cx} ${cy - iconR} V ${cy + iconR}`);
  plus.setAttribute('stroke', color); plus.setAttribute('stroke-width', '1.8'); plus.setAttribute('stroke-linecap', 'round');
  g.appendChild(plus);
  const text = document.createElementNS(SVGNS, 'text');
  text.setAttribute('x', String(x0 + padX + iconR * 2 + gap)); text.setAttribute('y', String(cy));
  text.setAttribute('dominant-baseline', 'central'); text.setAttribute('fill', color);
  text.setAttribute('font-size', '12'); text.setAttribute('font-weight', '600');
  text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
  text.textContent = label;
  g.appendChild(text);
  // Act on POINTERDOWN, not click: this overlay clears + rebuilds its `<g>` on every redraw (render:done),
  // so the pill node can be replaced between a mousedown and mouseup — no `click` would ever complete. Pointerdown
  // fires on the node present at press. stopPropagation keeps the canvas from treating it as a blank click (deselect).
  g.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    groupChildrenInto(captor, enclosedCapturableShapes(captor));
  });
  layer.appendChild(g);
}

function draw() {
  const { graph } = cctx;
  const layer = overlay.layer();
  const captor = _captorId && graph?.getCell(_captorId);
  if (!layer || !captor || !captor.isElement?.()) { overlay.clear(); return; }
  overlay.clear();
  const color = getHaloColor();
  for (const c of capturedElements(captor)) {
    const bb = c.getBBox();
    layer.appendChild(haloRect(bb.x - PAD, bb.y - PAD, bb.width + PAD * 2, bb.height + PAD * 2, color, false));   // captured → SOLID halo
  }
  const enclosed = enclosedCapturableShapes(captor);
  for (const o of enclosed) {
    const bb = o.getBBox();
    layer.appendChild(haloRect(bb.x - PAD, bb.y - PAD, bb.width + PAD * 2, bb.height + PAD * 2, color, true));    // overlapping-free → DASHED halo
  }
  if (enclosed.length) drawGroupPill(layer, captor, enclosed, color);   // one-click "Group N" nudge
}
overlay.setDraw(draw);

// Selection-driven entry point (wired to selection.onChange via the canvas facade).
// Draws when EXACTLY ONE captor is selected; clears otherwise. Re-selecting the
// same captor just refreshes (no teardown/rebuild churn or stacked listeners).
export function syncCaptureOverlay(selectedIds) {
  const { graph, paper } = cctx;
  if (!graph || !paper) { clearCaptureOverlay(); return; }
  const ids = Array.isArray(selectedIds) ? selectedIds : [];
  if (ids.length !== 1) { clearCaptureOverlay(); return; }
  const cell = graph.getCell(ids[0]);
  if (!cell || !cell.isElement?.() || !HALO_PARENT_TYPES.has(cell.get('type'))) { clearCaptureOverlay(); return; }
  if (_captorId === cell.id) { overlay.draw(); return; }   // same captor still selected — refresh in place
  clearCaptureOverlay();                                   // different captor — reset (onTeardown nulls _captorId)
  _captorId = cell.id;
  overlay.activate();                                      // first draw + subscribe
}

export function clearCaptureOverlay() { overlay.deactivate(); }

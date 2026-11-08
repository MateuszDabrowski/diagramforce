// df.Venn (1.27.0) - a 2- or 3-set Venn diagram whose regions fill one by one, so it can draw a SQL join's result
// (LEFT EXCLUDING: the left set's own area only) as well as what overlapping sets share. A generic shape,
// in every type's "Generic Shapes" group. The region rules are pure (js/venn-model.js); this leaf only draws them.
//
// The transparent `body` rect is the selection + Highlight State frame; df.VennView draws everything else from the
// model props on every change:
//   tints     each set's outline filled in its colour, translucent, so overlaps blend (circles for a join, ellipses
//             for overlaps);
//   regions   a full-box rect per filled region, cut to that region by clip paths (the sets it is in) and masks
//             (the sets it is not in) - exact for rotated ellipses, where computing the arcs would not be;
//   outlines  each set's outline in its colour, on top so a highlighted region keeps its edges;
//   labels    per region, at its roomiest point (venn-model.js regionAnchors): a set's name in its own area, an
//             overlap's text in the overlap.
// Clip and mask ids carry the view id and a geometry key, so a resize mints new ids: Safari caches an SVG resource by
// id (gotchas-rendering 1.2 / 1.3), and a changed clip under an old id could keep its old shape.
import { vennGeometry, regionKeys, regionFill, regionAnchors, regionAt, vennModeOf, vennShapeFor, SET_LETTERS, VENN_DEFAULT_SETS, VENN_HIGHLIGHT } from '../venn-model.js?v=1.27.0';
import { nodeContrastText } from '../util.js?v=1.27.0';

const NS = 'http://www.w3.org/2000/svg';
const LABEL_PAD = 4;           // px a label keeps from its area's edge
const MIN_LABEL_SCALE = 0.6;   // labels shrink to fit their area, never below 60% of the font size
const FIT_WAIT_FRAMES = 30;    // frames a fit waits for its text to be laid out (a hidden tab never is)
const TINT_OPACITY = 0.28;

const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  return el;
};
const ellipseAttrs = (e) => ({ cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry, transform: e.rot ? `rotate(${e.rot} ${e.cx} ${e.cy})` : null });

/** A label's lines as tspans centred on the label's point, the block centred vertically (dy in em, so a shrunk font
 *  size keeps it centred). */
function setLines(t, lines, x) {
  t.replaceChildren(...lines.map((line, li) => {
    const span = svgEl('tspan', { x, dy: li === 0 ? `${(0.35 - (lines.length - 1) * 0.6).toFixed(2)}em` : '1.2em',
      'font-weight': line.bold ? 700 : null });
    span.textContent = line.text;
    return span;
  }));
}

/** The sets a cell draws: its `sets`, at least 2 and at most 3, each with a label and a colour. */
export function vennSets(cell) {
  const raw = Array.isArray(cell.get('sets')) ? cell.get('sets') : [];
  const n = raw.length >= 3 ? 3 : 2;
  return Array.from({ length: n }, (_, i) => ({
    label: String(raw[i]?.label ?? VENN_DEFAULT_SETS[i].label),
    color: raw[i]?.color || VENN_DEFAULT_SETS[i].color,
  }));
}

export function registerVenn() {
  joint.dia.Element.define(
    'df.Venn',
    {
      size: { width: 360, height: 260 },
      z: 2000,
      // `vennMode` ('overlaps' | 'join') has no default on purpose: shape defaults merge into every loaded cell, so a
      // default would hide the join of an authored file that sets `joins` and no mode. Unset, venn-model.js
      // vennModeOf infers it from the joins; the panel writes it.
      sets: VENN_DEFAULT_SETS.slice(0, 2).map((s) => ({ ...s })),
      // No outline choice: a join draws circles, overlaps draw ellipses (venn-model.js vennShapeFor).
      sharedCentre: true,       // three sets showing overlaps: false leaves no area in all three (venn-model.js)
      joins: [],                // join mode: SQL join types, one per pair of tables read left to right (venn-model.js JOINS)
      regions: {},              // overlaps mode: { AB: { fill: 'on' | '#hex', label: 'text' }, ... } - overlaps only
      highlightColor: VENN_HIGHLIGHT,
      fontSize: 14,
      attrs: {
        body: { x: 0, y: 0, width: 'calc(w)', height: 'calc(h)', rx: 4, ry: 4, fill: 'transparent', stroke: 'none' },
      },
    },
    { markup: [{ tagName: 'rect', selector: 'body' }] },
  );

  joint.shapes.df.VennView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      this.listenTo(this.model, 'change:vennMode change:sets change:sharedCentre change:joins change:regions change:highlightColor change:fontSize',
        () => this._renderVenn());
    },
    update() {
      joint.dia.ElementView.prototype.update.apply(this, arguments);
      this._renderVenn();
    },
    _renderVenn() {
      const m = this.model;
      const { width: w, height: h } = m.size();
      const sets = vennSets(m);
      const n = sets.length;
      const sharedCentre = m.get('sharedCentre') !== false;
      const mode = vennModeOf({ mode: m.get('vennMode'), joins: m.get('joins') });
      const shape = vennShapeFor(mode);
      const geom = vennGeometry(shape, n, w, h, { sharedCentre });
      const ctx = { regions: m.get('regions') || {}, joins: m.get('joins') || [], n, mode };
      const highlight = m.get('highlightColor') || VENN_HIGHLIGHT;
      const fontSize = Number(m.get('fontSize')) || 14;
      const idBase = `venn-${this.cid}-${Math.round(w)}x${Math.round(h)}-${shape === 'ellipses' ? 'e' : 'c'}${n}${sharedCentre ? '' : 'o'}`;

      this.el.querySelector(':scope > g.df-venn')?.remove();
      const root = svgEl('g', { class: 'df-venn' });
      const defs = svgEl('defs');
      geom.forEach((e, i) => {
        const clip = svgEl('clipPath', { id: `${idBase}-in${i}` });
        clip.appendChild(svgEl('ellipse', ellipseAttrs(e)));
        const mask = svgEl('mask', { id: `${idBase}-out${i}`, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: w, height: h });
        mask.appendChild(svgEl('rect', { x: 0, y: 0, width: w, height: h, fill: '#FFFFFF' }));
        mask.appendChild(svgEl('ellipse', { ...ellipseAttrs(e), fill: '#000000' }));
        defs.append(clip, mask);
      });
      root.appendChild(defs);

      const tints = svgEl('g', { class: 'df-venn__tints' });
      geom.forEach((e, i) => tints.appendChild(svgEl('ellipse', { ...ellipseAttrs(e), fill: sets[i].color, 'fill-opacity': TINT_OPACITY })));
      root.appendChild(tints);

      const regionLayer = svgEl('g', { class: 'df-venn__regions' });
      const shown = {};
      for (const key of regionKeys(n)) {
        const fill = regionFill(key, ctx);
        if (fill === 'none') continue;
        const paint = { fill: fill === 'on' ? highlight : fill };
        shown[key] = paint.fill;
        // Innermost the full-box rect, then one clip per set the region is in, one mask per set it is not in.
        let node = svgEl('rect', { x: 0, y: 0, width: w, height: h, ...paint });
        SET_LETTERS.slice(0, n).forEach((l, i) => {
          const g = key.includes(l) ? svgEl('g', { 'clip-path': `url(#${idBase}-in${i})` }) : svgEl('g', { mask: `url(#${idBase}-out${i})` });
          g.appendChild(node);
          node = g;
        });
        node.setAttribute('data-region', key);
        regionLayer.appendChild(node);
      }
      root.appendChild(regionLayer);

      const outlines = svgEl('g', { class: 'df-venn__outlines' });
      geom.forEach((e, i) => outlines.appendChild(svgEl('ellipse', { ...ellipseAttrs(e), fill: 'none', stroke: sets[i].color, 'stroke-width': 1.5 })));
      root.appendChild(outlines);

      const labels = svgEl('g', { class: 'df-venn__labels', 'pointer-events': 'none' });
      const anchors = regionAnchors(geom, w, h);
      for (const key of regionKeys(n)) {
        // A set's own area shows the set's NAME; text labels the OVERLAPS (owner, 2026-11-08: "Set 1 only text looks
        // like the same thing as Set 1 name" - it was, so the set-only regions have no text of their own). A name can
        // span lines; a line wrapped in **...** is bold, as in a Table cell.
        const isSet = key.length === 1;
        // A join's picture names its tables only; its overlaps are rows, not ideas to label.
        const raw = isSet ? String(sets[SET_LETTERS.indexOf(key)].label || '')
          : mode === 'overlaps' ? String(ctx.regions[key]?.label || '') : '';
        const at = anchors[key];
        // A line wrapped in **...** is bold, as in a Table cell.
        const lines = raw.trim() ? raw.split('\n').map((line) => {
          const bold = /^\*\*(.+)\*\*$/.exec(line.trim());
          return { text: bold ? bold[1] : line, bold: !!bold };
        }) : [];
        if (!lines.length || !at) continue;
        const ink = shown[key] ? (nodeContrastText(shown[key])?.label || 'var(--text-primary)') : 'var(--text-primary)';
        const t = svgEl('text', { x: at.x, y: at.y, 'text-anchor': 'middle', 'font-size': fontSize, fill: ink, 'data-region': key });
        setLines(t, lines, at.x);
        labels.appendChild(t);
      }
      root.appendChild(labels);

      // Under the transparent body, so the body stays the selection + Highlight State frame on top.
      this.el.insertBefore(root, this.el.querySelector(':scope > [joint-selector="body"]'));
      this._fit = { labels, geom, fontSize };
      this._fitLabels();
    },
    // Measuring text needs the view on the page; a render before mount fits on mount instead.
    onMount() {
      joint.dia.ElementView.prototype.onMount.apply(this, arguments);
      this._fitLabels();
    },
    // Labels fit their areas (owner, 2026-11-08: "Diagramforce" spilled over the outlines). Each label needs a scale at
    // which every line fits the width of its area at that line's height, and the block fits the area's height, with
    // LABEL_PAD to spare. Set names and overlap texts each shrink as ONE group - by the smallest scale in the group -
    // so labels of a kind stay the same size and read as a set (owner: "shared by all elements in either set or
    // overlap, so they are visually a group"). Never below MIN_LABEL_SCALE: past that, text that cannot fit overflows
    // rather than turning unreadable, and the user breaks the line (Enter) or enlarges the Venn. Font sizes are
    // written as attributes, so exports keep them.
    _fitLabels() {
      const fit = this._fit;
      if (!fit || !this.el.isConnected) return;
      const texts = [...fit.labels.querySelectorAll('text')];
      // WebKit can report new text as unlaid-out (zero size, at the origin) for a few frames after a render, and a fit
      // measured then left every label at full size. Wait for layout, a frame at a time, up to FIT_WAIT_FRAMES.
      const laidOut = texts.every((t) => { try { return t.getBBox().width > 0; } catch { return false; } });
      if (!laidOut) {
        fit.waited = (fit.waited || 0) + 1;
        if (fit.waited <= FIT_WAIT_FRAMES) requestAnimationFrame(() => { if (this._fit === fit) this._fitLabels(); });
        return;
      }
      const extent = (key, x, y, dx, dy) => {
        let d = 0;
        while (d < 2000 && regionAt(x + dx * (d + 1), y + dy * (d + 1), fit.geom) === key) d++;
        return d;
      };
      const scaleOf = (t) => {
        const key = t.getAttribute('data-region');
        const x = Number(t.getAttribute('x'));
        let scale = 1;
        try {
          for (const span of t.querySelectorAll('tspan')) {
            const bb = span.getBBox();
            if (!bb.width) return 1;   // not laid out (a hidden tab): leave it at full size
            const y = bb.y + bb.height / 2;
            const room = extent(key, x, y, -1, 0) + extent(key, x, y, 1, 0);
            scale = Math.min(scale, room / (bb.width + 2 * LABEL_PAD));
          }
          const block = t.getBBox();
          const cy = block.y + block.height / 2;
          const tall = extent(key, x, cy, 0, -1) + extent(key, x, cy, 0, 1);
          scale = Math.min(scale, tall / (block.height + 2 * LABEL_PAD));
        } catch { return 1; }
        return scale;
      };
      // Shrink only: the lines are the user's own (Enter makes a break), never re-broken. Breaking lines to fit
      // larger rewrote names ("SQL Query" became "SQL" / "Query") and fell differently per browser, and breaking only
      // below the floor made a longer label come out LARGER than a shorter one (owner, 2026-11-08: shrink-only). Each
      // group shrinks by the smallest scale any label in it needs, so more text never means larger text.
      texts.forEach((t) => t.setAttribute('font-size', fit.fontSize));
      const groups = { set: [], overlap: [] };
      for (const t of texts) groups[t.getAttribute('data-region').length === 1 ? 'set' : 'overlap'].push(t);
      for (const group of Object.values(groups)) {
        if (!group.length) continue;
        const scale = Math.max(MIN_LABEL_SCALE, Math.min(1, ...group.map(scaleOf)));
        if (scale < 1) group.forEach((t) => t.setAttribute('font-size', +(fit.fontSize * scale).toFixed(2)));
      }
    },
  });
}

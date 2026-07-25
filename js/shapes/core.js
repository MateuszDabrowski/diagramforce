// Core / architecture shapes (SimpleNode/Container/TextLabel/Pill/Legend/Table/Line/Image/Link/Note) + Zone (CLEANUP S3). registerCore() is called by shapes.js register(); it defines the block's
// JointJS shapes/views. Reads the shared leaves (ports/markdown-fo/fields/context) + app modules; never the facade.

import { SVG_NS_SHAPES, ensureMarkdownFO } from './markdown-fo.js?v=1.20.1';
import { portGroups, portItems } from './ports.js?v=1.20.1';
import { sanitizeCssColor } from '../util.js?v=1.20.1';

export function registerCore() {
  // --- SimpleNode ---
  // A rounded rectangle with an icon (left) and label/subtitle (right)
  // Used for individual components: "Google Ads", "Marketing Cloud", etc.
  joint.dia.Element.define(
    'sf.SimpleNode',
    {
      size: { width: 180, height: 64 },
      z: 2000,    // Node tier: 2000 – 2499
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          rx: 8,
          ry: 8,
          fill: 'var(--node-bg)',
          stroke: 'var(--node-border)',
          strokeWidth: 1,
        },
        icon: {
          x: 12,
          y: 'calc(0.5 * h - 16)',
          width: 32,
          height: 32,
          href: '',
        },
        label: {
          x: 'calc(0.5 * w + 20)',
          y: 'calc(0.5 * h)',
          textAnchor: 'middle',
          textVerticalAnchor: 'middle',
          fontSize: 13,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--node-text)',
          text: 'Node',
          textWrap: { width: 'calc(w - 64)', maxLineCount: 4, ellipsis: true },
        },
        subtitle: {
          x: 12,
          y: 42,
          textAnchor: 'start',
          textVerticalAnchor: 'top',
          fontSize: 10,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--node-subtitle)',
          text: '',
          visibility: 'hidden',
          textWrap: { width: 'calc(w - 24)', height: 'calc(h - 48)', ellipsis: true },
        },
      },
      ports: {
        groups: portGroups,
        items: portItems,
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'image', selector: 'icon' },
        { tagName: 'text', selector: 'label' },
        { tagName: 'text', selector: 'subtitle' },
      ],
    }
  );

  // --- Container ---
  // A group node that embeds children.
  // Has an accent bar on the left, header with icon + title, and open content area.
  joint.dia.Element.define(
    'sf.Container',
    {
      size: { width: 360, height: 240 },
      z: 1000,    // Container tier: 1000 – 1499
      tags: [],     // string[] — pills in header (Team use case)
      raci: {},     // { R?, A?, C?, I? } — top-right pills (Team use case)
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          rx: 12,
          ry: 12,
          fill: 'var(--container-bg)',
          stroke: 'var(--container-border)',
          strokeWidth: 1,
        },
        accent: {
          x: 1,
          y: 1,
          width: 'calc(w - 2)',
          height: 40,
          rx: 11,
          ry: 11,
          fill: 'var(--color-primary)',
        },
        accentFill: {
          x: 1,
          y: 20,
          width: 'calc(w - 2)',
          height: 21,
          fill: 'var(--color-primary)',
        },
        headerIcon: {
          x: 12,
          y: 9,
          width: 24,
          height: 24,
          href: '',
        },
        headerLabel: {
          x: 44,
          y: 21,
          textAnchor: 'start',
          textVerticalAnchor: 'middle',
          fontSize: 14,
          fontWeight: 'bold',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: '#FFFFFF',
          text: 'Container',
        },
        headerSubtitle: {
          x: 12,
          y: 50,
          textAnchor: 'start',
          textVerticalAnchor: 'top',
          fontSize: 11,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--node-subtitle)',
          text: '',
          textWrap: { width: 'calc(w - 28)', maxLineCount: 4, ellipsis: true },
        },
      },
      ports: {
        groups: portGroups,
        items: portItems,
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'rect', selector: 'accent' },
        { tagName: 'rect', selector: 'accentFill' },
        { tagName: 'image', selector: 'headerIcon' },
        { tagName: 'text', selector: 'headerLabel' },
        { tagName: 'text', selector: 'headerSubtitle' },
        { tagName: 'g', selector: 'raciGroup' },
        { tagName: 'g', selector: 'tagsGroup' },
      ],
    }
  );

  // Custom view: re-renders RACI pills (top-right corner) and tag pills
  // (header, after title) whenever the relevant model props change. Pulls
  // double-duty for plain Containers (no tags/RACI → groups stay empty) and
  // Team variants in Org Chart diagrams (tags + RACI populated).
  joint.shapes.sf.ContainerView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      this.listenTo(this.model, 'change:tags change:raci change:size change:attrs', () => this._updatePills());
    },
    render() {
      joint.dia.ElementView.prototype.render.apply(this, arguments);
      this._updatePills();
      return this;
    },
    update() {
      joint.dia.ElementView.prototype.update.apply(this, arguments);
      this._updatePills();
    },
    _updatePills() {
      const m = this.model;
      const { width } = m.size();
      const tags = Array.isArray(m.get('tags')) ? m.get('tags').filter(Boolean) : [];
      const raci = m.get('raci') || {};
      const ns = 'http://www.w3.org/2000/svg';

      // RACI: top-right corner of the accent bar. White-outlined pills so the
      // colour-coded fills stay legible against the coloured header.
      const raciGroupEl = this.el.querySelector('[joint-selector="raciGroup"]');
      if (raciGroupEl) {
        raciGroupEl.innerHTML = '';
        const RACI_COLORS = { R: '#1D73C9', A: '#DA4E55', C: '#F6B355', I: '#8A9099' };
        const RACI_NAMES = { R: 'Responsible', A: 'Accountable', C: 'Consulted', I: 'Informed' };
        const active = ['R', 'A', 'C', 'I'].filter(k => raci[k]);
        if (active.length > 0) {
          const PILL = 16;
          const GAP = 3;
          let xPos = width - 10 - active.length * PILL - (active.length - 1) * GAP;
          const yPos = 12;
          for (const key of active) {
            const g = document.createElementNS(ns, 'g');
            const rect = document.createElementNS(ns, 'rect');
            rect.setAttribute('x', String(xPos));
            rect.setAttribute('y', String(yPos));
            rect.setAttribute('width', String(PILL));
            rect.setAttribute('height', String(PILL));
            rect.setAttribute('rx', '4');
            rect.setAttribute('ry', '4');
            rect.setAttribute('fill', RACI_COLORS[key]);
            rect.setAttribute('stroke', '#FFFFFF');
            rect.setAttribute('stroke-width', '1.2');
            g.appendChild(rect);
            const text = document.createElementNS(ns, 'text');
            text.setAttribute('x', String(xPos + PILL / 2));
            text.setAttribute('y', String(yPos + PILL / 2 + 0.5));
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'central');
            text.setAttribute('fill', '#FFFFFF');
            text.setAttribute('font-size', '10');
            text.setAttribute('font-weight', '700');
            text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
            text.setAttribute('pointer-events', 'none');
            text.textContent = key;
            g.appendChild(text);
            const title = document.createElementNS(ns, 'title');
            title.textContent = RACI_NAMES[key];
            g.appendChild(title);
            raciGroupEl.appendChild(g);
            xPos += PILL + GAP;
          }
        }
      }

      // Tags: header row, RIGHT-aligned. The pill group sits flush against
      // the right edge of the header (carving out space for any active RACI
      // pills), and pills flow left-to-right inside that group with text
      // centred horizontally and vertically inside each pill.
      const tagsGroupEl = this.el.querySelector('[joint-selector="tagsGroup"]');
      if (tagsGroupEl) {
        tagsGroupEl.innerHTML = '';
        if (tags.length > 0) {
          const PILL_H = 16;
          const PILL_PAD = 10;
          const GAP = 4;
          const FONT = 10;
          const yPos = 21 - PILL_H / 2;
          // Right-edge anchor — RACI pills (if any) shift the anchor leftward.
          const raciActive = ['R', 'A', 'C', 'I'].filter(k => raci[k]).length;
          const raciW = raciActive ? raciActive * 16 + (raciActive - 1) * 3 + 8 : 0;
          const rightAnchor = width - 10 - raciW;
          // Reserve enough space so pills don't crash into the title — start
          // no closer than 80 px from the left edge.
          const titleText = m.attr('headerLabel/text') || '';
          const titleEstW = Math.min(titleText.length * 7, width * 0.5);
          const minStartX = 44 + titleEstW + 12;
          // Pre-compute total width of all pills so we can right-align them.
          const widths = tags.map(t => Math.ceil(t.length * 5.5) + PILL_PAD * 2);
          // Try fitting all tags. If they overflow the available band, drop
          // the LEAST-recent tags (left side) until they fit, replaced by a
          // "+N" overflow pill.
          let firstIdx = 0;
          let totalW = widths.reduce((a, b) => a + b, 0) + GAP * Math.max(0, tags.length - 1);
          while (firstIdx < tags.length - 1 && rightAnchor - totalW < minStartX) {
            totalW -= widths[firstIdx] + GAP;
            firstIdx++;
          }
          const showOverflow = firstIdx > 0;
          const overflowW = 24;
          if (showOverflow) totalW += overflowW + GAP;
          let curX = Math.max(minStartX, rightAnchor - totalW);
          if (showOverflow) {
            const ellipsis = document.createElementNS(ns, 'g');
            const r = document.createElementNS(ns, 'rect');
            r.setAttribute('x', String(curX));
            r.setAttribute('y', String(yPos));
            r.setAttribute('width', String(overflowW));
            r.setAttribute('height', String(PILL_H));
            r.setAttribute('rx', '8');
            r.setAttribute('ry', '8');
            r.setAttribute('fill', 'rgba(255, 255, 255, 0.18)');
            ellipsis.appendChild(r);
            const t = document.createElementNS(ns, 'text');
            t.setAttribute('x', String(curX + overflowW / 2));
            t.setAttribute('y', String(yPos + PILL_H / 2));
            t.setAttribute('text-anchor', 'middle');
            t.setAttribute('dominant-baseline', 'central');
            t.setAttribute('fill', '#FFFFFF');
            t.setAttribute('font-size', String(FONT));
            t.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
            t.textContent = `+${firstIdx}`;
            ellipsis.appendChild(t);
            const title = document.createElementNS(ns, 'title');
            title.textContent = tags.slice(0, firstIdx).join(', ');
            ellipsis.appendChild(title);
            tagsGroupEl.appendChild(ellipsis);
            curX += overflowW + GAP;
          }
          for (let i = firstIdx; i < tags.length; i++) {
            const tag = tags[i];
            const pillW = widths[i];
            const g = document.createElementNS(ns, 'g');
            const rect = document.createElementNS(ns, 'rect');
            rect.setAttribute('x', String(curX));
            rect.setAttribute('y', String(yPos));
            rect.setAttribute('width', String(pillW));
            rect.setAttribute('height', String(PILL_H));
            rect.setAttribute('rx', '8');
            rect.setAttribute('ry', '8');
            rect.setAttribute('fill', 'rgba(255, 255, 255, 0.18)');
            g.appendChild(rect);
            const text = document.createElementNS(ns, 'text');
            // Centred horizontally + vertically inside the pill.
            text.setAttribute('x', String(curX + pillW / 2));
            text.setAttribute('y', String(yPos + PILL_H / 2));
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'central');
            text.setAttribute('fill', '#FFFFFF');
            text.setAttribute('font-size', String(FONT));
            text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
            text.textContent = tag;
            g.appendChild(text);
            tagsGroupEl.appendChild(g);
            curX += pillW + GAP;
          }
        }
      }
    },
  });

  // --- TextLabel ---
  // A standalone text annotation with no background
  joint.dia.Element.define(
    'sf.TextLabel',
    {
      size: { width: 200, height: 32 },
      z: 2000,    // Node tier: 2000 – 2499
      attrs: {
        // v1.12.1 — explicit transparent hit-area rect so JointJS has
        // real SVG geometry to hit-test against. Previously the only
        // hit target was the foreignObject (added programmatically in
        // ensureMarkdownFO) with pointer-events="all" — that worked
        // for some browsers but not Safari, which silently swallowed
        // single clicks. The cell was still findable by rubber-band
        // because its bbox math doesn't go through DOM hit-testing.
        // pointerEvents:'all' is required because `fill: transparent`
        // alone doesn't always count as "painted" under the SVG
        // `visiblePainted` default.
        hitArea: {
          width: 'calc(w)',
          height: 'calc(h)',
          fill: 'transparent',
          stroke: 'none',
          pointerEvents: 'all',
        },
        label: {
          x: 'calc(0.5 * w)',
          y: 'calc(0.5 * h)',
          textAnchor: 'middle',
          textVerticalAnchor: 'middle',
          fontSize: 16,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-primary)',
          fontWeight: '600',
          text: 'Label',
        },
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'hitArea' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // Custom view: renders the label through an HTML foreignObject so inline
  // markdown (**bold**, *italic*, ~~strike~~, `code`) round-trips natively.
  // The SVG <text> stays in the markup (so model.attr() paths keep working
  // for theme/colour edits) but is display:none'd — the FO above it shows.
  joint.shapes.sf.TextLabelView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      this.listenTo(this.model, 'change:attrs change:size', () => this._renderMarkdown());
    },
    render() {
      joint.dia.ElementView.prototype.render.apply(this, arguments);
      this._renderMarkdown();
      return this;
    },
    update() {
      joint.dia.ElementView.prototype.update.apply(this, arguments);
      this._renderMarkdown();
    },
    _renderMarkdown() {
      const m = this.model;
      const { width, height } = m.size();
      const label = m.attr('label') || {};
      const text = label.text ?? 'Label';
      const fontSize = label.fontSize ?? 16;
      const fontWeight = label.fontWeight ?? 600;
      const fontFamily = label.fontFamily ?? 'system-ui, -apple-system, sans-serif';
      const fill = label.fill ?? 'var(--text-primary)';
      const textAnchor = label.textAnchor ?? 'middle';
      const justify = textAnchor === 'middle' ? 'center' : textAnchor === 'end' ? 'flex-end' : 'flex-start';
      const css = `display:flex;align-items:center;justify-content:${justify};`
        + `width:100%;height:100%;`
        + `font-size:${fontSize}px;font-weight:${fontWeight};font-family:${fontFamily};`
        + `color:${fill};line-height:1.3;text-align:${textAnchor === 'middle' ? 'center' : textAnchor === 'end' ? 'right' : 'left'};`
        + `white-space:pre-wrap;word-break:break-word;overflow:hidden;`;
      ensureMarkdownFO(this, 'label', text, { x: 0, y: 0, width, height, css, hideSelector: 'label' });
    },
  });

  // --- Pill ---
  // A number / short-label badge: a filled circle that extends into a stadium "pill" as the content grows. Use it
  // to reference points of a diagram in a legend / description, or to tag elements ("Phase 1"). It AUTO-WIDTHS to
  // its `pillText` (min width = height → a circle for 1-2 chars); rx tracks half the height so the ends stay round.
  joint.dia.Element.define(
    'df.Pill',
    {
      size: { width: 32, height: 32 },
      z: 2400,
      pillText: '1',
      attrs: {
        body: {
          x: 0, y: 0,
          width: 'calc(w)', height: 'calc(h)',
          rx: 'calc(0.5 * h)', ry: 'calc(0.5 * h)',
          fill: '#E24B4A', stroke: 'none',
        },
        label: {
          x: 'calc(0.5 * w)', y: 'calc(0.5 * h)',
          textAnchor: 'middle', textVerticalAnchor: 'middle',
          fontSize: 15, fontWeight: '700',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: '#FFFFFF', text: '1',
        },
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'text', selector: 'label' },
      ],
      // Auto-width the pill to its content at the MODEL level (a char-width estimate, ~0.62em/char) — runs at
      // construction (before any render) and on every pillText edit, so it can't be lost to the async render cycle
      // the way a view-side resize was. Min width = height → 1-2 chars stay a circle; rx=calc(0.5h) rounds the ends.
      initialize() {
        joint.dia.Element.prototype.initialize.apply(this, arguments);
        this.on('change:pillText', () => this._fitWidth());
        this._fitWidth();
      },
      _fitWidth() {
        const txt = String(this.get('pillText') ?? '');
        this.attr('label/text', txt, { silent: true });
        const h = this.size().height || 32;
        const fs = this.attr('label/fontSize') || 15;
        const w = Math.max(h, Math.round(txt.length * fs * 0.62) + Math.round(h * 0.55));
        if (Math.abs(this.size().width - w) > 0.5) this.resize(w, h);
      },
    }
  );

  // --- Legend ---
  // A single legend KEY: a fillable rounded "squircle" swatch with a label beside it. Drop several to explain
  // each colour a diagram uses (one item per colour, so each carries its own Shape state). The SWATCH is the
  // user-fillable colour AND the Shape-state target (its border is painted by applyShapeState via the
  // SHAPE_STATE_TARGET map in properties.js); the full-bounds `body` is transparent and only carries selection.
  // AUTO-WIDTHS to its label text.
  joint.dia.Element.define(
    'df.Legend',
    {
      size: { width: 120, height: 28 },
      z: 2400,
      attrs: {
        body: {
          x: 0, y: 0,
          width: 'calc(w)', height: 'calc(h)',
          rx: 6, ry: 6,
          fill: 'transparent', stroke: 'none',
        },
        swatch: {
          x: 2, y: 'calc(0.5 * h - 9)',
          width: 18, height: 18,
          rx: 5, ry: 5,
          fill: '#1D73C9', stroke: 'none',
        },
        label: {
          x: 28, y: 'calc(0.5 * h)',
          textAnchor: 'start', textVerticalAnchor: 'middle',
          fontSize: 14, fontWeight: '600',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-primary)', text: 'Label',
        },
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'rect', selector: 'swatch' },
        { tagName: 'text', selector: 'label' },
      ],
      // Auto-width to the label at the MODEL level (char-width estimate, ~0.6em/char) — runs at construction
      // (before any render) and on every label edit, so the width can't be lost to the async render cycle a
      // view-side resize would. The swatch + gap is a fixed 28px lead; height stays as the user set it.
      initialize() {
        joint.dia.Element.prototype.initialize.apply(this, arguments);
        // Back-compat: the Shape-state border now paints on the `swatch` (the visible squircle), not the
        // transparent full-bounds `body`. Move a stroke an older Legend stashed on `body` over to the swatch.
        const bs = this.attr('body/stroke');
        if (bs && bs !== 'none') {
          this.attr({
            swatch: { stroke: bs, strokeWidth: this.attr('body/strokeWidth'), strokeDasharray: this.attr('body/strokeDasharray') },
            body: { stroke: 'none', strokeWidth: null, strokeDasharray: null },
          }, { silent: true });
        }
        // Refit ONLY when the label text / font size changed — NOT on every attr edit. Binding the whole
        // change:attrs (the label lives in attrs) would otherwise snap a user-set Width back to the label on a
        // Fill / Label-colour / Shape-state edit too. (A label edit still re-fits, matching the Pill convention.)
        this.on('change:attrs', () => {
          const pl = (this.previous('attrs') || {}).label || {};
          const nl = (this.get('attrs') || {}).label || {};
          if (pl.text !== nl.text || pl.fontSize !== nl.fontSize) this._fitWidth();
        });
        this._fitWidth();
      },
      _fitWidth() {
        // A user-set width STICKS (manualWidth): the Width control + a resize-handle drag set it, and "Auto
        // size" clears it. So a label / font-size edit no longer snaps a deliberately-sized legend back.
        if (this.get('manualWidth')) return;
        const txt = String(this.attr('label/text') ?? '');
        const fs = this.attr('label/fontSize') || 14;
        const lead = 28;   // swatch (x:2 + 18) + an 8px gap before the label
        const w = Math.max(48, lead + Math.round(txt.length * fs * 0.6) + 10);
        const h = this.size().height || 28;
        if (Math.abs(this.size().width - w) > 0.5) this.resize(w, h);
      },
    }
  );

  // --- Table ---
  // A minimal grid: a 2D `rows` array (array of row arrays of cell strings). Each cell renders MARKDOWN and grows
  // to fit MULTI-LINE content (like the node description), so rows have variable height. Optional `tableLabel`
  // renders above the grid, and `highlightFirstRow` / `highlightFirstCol` tint + bold the leading row / column.
  // The transparent `body` rect is the selection + Shape-state frame; the visible table (border, fill, grid lines,
  // markdown cells) is drawn by df.TableView, which MEASURES wrapped content and resizes the model (Note pattern).
  const TABLE_MIN_ROW_H = 28;  // min px per row (one short line)
  const TABLE_MIN_COL_W = 48;  // a column can't be squeezed below this — the model floors width to cols × it
  joint.dia.Element.define(
    'df.Table',
    {
      size: { width: 330, height: 90 },
      z: 2300,
      rows: [
        ['Column 1', 'Column 2', 'Column 3'],
        ['', '', ''],
        ['', '', ''],
      ],
      tableLabel: '',
      highlightFirstRow: true,
      highlightFirstCol: false,
      fontSize: 13,
      tableFill: 'var(--node-bg)',
      tableBorder: 'var(--node-border)',   // the rename "Grid & Border": also tints the inner grid lines
      tableTextColor: '',                  // '' → var(--text-primary); applies to cell text + the label
      attrs: {
        // Transparent full-bounds frame: carries selection + the shared Shape-state border. The visible table
        // (fill/border/grid) is drawn by the view from tableFill/tableBorder.
        body: {
          x: 0, y: 0,
          width: 'calc(w)', height: 'calc(h)',
          rx: 4, ry: 4,
          fill: 'transparent', stroke: 'none',
        },
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
      ],
      // The MODEL only normalises `rows` to a rectangle + floors the WIDTH (cols × min) — HEIGHT is owned by the
      // view, which measures wrapped markdown (the only place the rendered height is known), like sf.Note.
      initialize() {
        joint.dia.Element.prototype.initialize.apply(this, arguments);
        // Back-compat: a pre-rework table used `headerRow` + painted the table on `body`. Fold those into the new
        // props once, and free `body` to be the transparent Shape-state frame.
        if (this.has('headerRow')) { this.set('highlightFirstRow', !!this.get('headerRow'), { silent: true }); this.unset('headerRow', { silent: true }); }
        const bf = this.attr('body/fill');
        if (bf && bf !== 'transparent') {
          if (this.get('tableFill') == null) this.set('tableFill', bf, { silent: true });
          this.attr('body/fill', 'transparent', { silent: true });
        }
        const bs = this.attr('body/stroke');
        if (bs && bs !== 'none' && !this.get('borderStyle')) {   // no active Shape-state: body/stroke IS the border
          if (this.get('tableBorder') == null) this.set('tableBorder', bs, { silent: true });
          this.attr('body/stroke', 'none', { silent: true });
        } else if (this.get('borderStyle')) {
          // Active Shape-state border: the user's real border is stashed in _origBorder. Promote it to tableBorder
          // and neutralise _origBorder so clearing the state later restores the transparent frame, not the old colour.
          const orig = this.get('_origBorder');
          if (orig && orig.stroke && orig.stroke !== 'none') {
            if (this.get('tableBorder') == null) this.set('tableBorder', orig.stroke, { silent: true });
            this.set('_origBorder', { stroke: 'none', strokeWidth: null, strokeDasharray: null }, { silent: true });
          }
        }
        this.on('change:rows change:size', () => this._normalize());
        this._normalize();
      },
      _normalize() {
        if (this._fitting) return;
        this._fitting = true;
        try {
          let rows = this.get('rows') || [];
          // Rectangle-normalise (cols = widest row): ragged JSON / LLM input otherwise clips longer rows + desyncs
          // the editor grid. Pad short rows + coerce non-arrays; write back only when it actually changed.
          const cols = Math.max(1, ...rows.map(r => (Array.isArray(r) ? r.length : 0)), 1);
          const padded = rows.map(r => { const rr = Array.isArray(r) ? r.slice() : []; while (rr.length < cols) rr.push(''); return rr; });
          if (JSON.stringify(padded) !== JSON.stringify(rows)) this.set('rows', padded);
          const w = Math.max(this.size().width, cols * TABLE_MIN_COL_W);
          if (Math.abs(this.size().width - w) > 0.5) this.resize(w, this.size().height);
        } finally { this._fitting = false; }
      },
    }
  );

  // Custom view for Table — draws the visible table (border rect, highlights, grid lines) in a <g> and renders
  // each cell as a MARKDOWN foreignObject (ensureMarkdownFO) that wraps + grows. It MEASURES each cell's content
  // scrollHeight to compute per-row heights, lays the cells out, and resizes the MODEL to the measured total
  // (the Note model-vs-view auto-height pattern: measure in the view, resize the model, _fitting-guarded; a
  // 0 scrollHeight = FO not laid out yet → retry next frame, never cache).
  joint.shapes.df.TableView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      // Marker class so the CSS selection-stroke rules can SKIP df.Table: it draws its own border + shows resize
      // corners, so the red outline on its transparent Shape-state body / view border is redundant (and the
      // `:first-child` rule made it flicker with the label). Corners alone signal selection; a Shape-state border
      // (on `body`) stays visible because the selection override no longer hides it.
      this.el.classList.add('df-table-el');
      this.listenTo(this.model,
        'change:rows change:size change:tableLabel change:highlightFirstRow change:highlightFirstCol change:fontSize change:tableFill change:tableBorder change:tableTextColor',
        () => this._renderTable());
      // Hover cross-highlight: a delegated handler (one listener for the whole table) tints the hovered cell's
      // row + column. Cheap — just toggles opacity + repositions two cached rects; no re-render.
      this.el.addEventListener('pointermove', (e) => this._tableHover(e));
      this.el.addEventListener('pointerleave', () => this._tableHoverOff());
    },
    _tableHover(e) {
      const g = this._geom, row = this._hoverRow, col = this._hoverCol;
      if (!g || !row || !col || !this.paper) return;
      // The cell FOs are pointer-events:none (clicks pass through to JointJS), so the pointer target is never a
      // cell — resolve the hovered row/column from the POINTER POSITION in the element's local coords instead.
      const p = this.paper.clientToLocalPoint({ x: e.clientX, y: e.clientY });
      const pos = this.model.position();
      const lx = p.x - pos.x, ly = p.y - pos.y;
      let r = -1;
      for (let i = 0; i < g.rowY.length; i++) { if (ly >= g.rowY[i] && ly < g.rowY[i] + g.rowH[i]) { r = i; break; } }
      const c = Math.floor(lx / g.colW);
      if (r < 0 || c < 0 || c >= g.cols || lx < 0 || lx > g.width) { this._tableHoverOff(); return; }
      row.setAttribute('y', String(g.rowY[r])); row.setAttribute('height', String(g.rowH[r])); row.setAttribute('opacity', '0.1');
      col.setAttribute('x', String(Math.round(c * g.colW))); col.setAttribute('width', String(Math.round(g.colW))); col.setAttribute('opacity', '0.1');
    },
    _tableHoverOff() {
      if (this._hoverRow) this._hoverRow.setAttribute('opacity', '0');
      if (this._hoverCol) this._hoverCol.setAttribute('opacity', '0');
    },
    update() {
      joint.dia.ElementView.prototype.update.apply(this, arguments);
      this._renderTable();
    },
    _renderTable() {
      const model = this.model;
      const ns = SVG_NS_SHAPES;
      const old = this.el.querySelector(':scope > g.df-table-g');
      if (old) old.remove();

      const rows = model.get('rows') || [];
      if (!rows.length) {
        this.el.querySelectorAll(':scope > foreignObject[data-md^="cell-"]').forEach(fo => fo.remove());
        return;
      }
      const fontSize = Math.max(6, Number(model.get('fontSize')) || 13);
      const labelText = String(model.get('tableLabel') || '');
      const hlRow = !!model.get('highlightFirstRow');
      const hlCol = !!model.get('highlightFirstCol');
      // Colours are interpolated into SVG attrs + a CSS string → sanitise via the shared security primitive.
      const safeColor = sanitizeCssColor;
      const tableFill = safeColor(model.get('tableFill'), 'var(--node-bg)');
      const tableBorder = safeColor(model.get('tableBorder'), 'var(--node-border)');
      const textColor = safeColor(model.get('tableTextColor'), 'var(--text-primary)');
      const cols = Math.max(1, ...rows.map(r => (Array.isArray(r) ? r.length : 0)), 1);
      const { width } = model.size();
      const colW = width / cols;
      const labelFont = fontSize + 2;   // the label reads one notch larger than the cells
      const labelH = labelText ? Math.round(labelFont + 12) : 0;
      const PAD_X = 6, PAD_Y = 5;
      const minRowH = Math.max(TABLE_MIN_ROW_H, fontSize + 14);

      // 1. Render + MEASURE every cell's markdown to derive per-row heights. TWO PHASES (P7): write ALL
      //    cell foreignObjects first, THEN read all heights in one batch — never interleaving a DOM write
      //    with a scrollHeight read. The old single loop forced a synchronous reflow on every cell's read
      //    (each ensureMarkdownFO invalidates layout, the next scrollHeight flushes it) → R×C reflows per
      //    keystroke. Batched, the first read in 1b triggers ONE layout the rest reuse. Each foreignObject
      //    is its own formatting context, so a cell's measured height is independent of its siblings —
      //    the per-row max heights come out identical to the interleaved version.
      const cellCss = (bold) => `width:100%;height:auto;box-sizing:border-box;font-size:${fontSize}px;`
        + `font-weight:${bold ? 700 : 400};font-family:system-ui,-apple-system,sans-serif;color:${textColor};`
        + `line-height:1.3;white-space:pre-wrap;word-break:break-word;overflow:hidden;`;
      const usedKeys = new Set();
      // 1a. WRITE all cell FOs (no reads interleaved). Row-major so 1b can fold into per-row heights.
      const cellList = [];
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < cols; c++) {
          const key = `cell-${r}-${c}`;
          usedKeys.add(key);
          const text = String(rows[r]?.[c] ?? '');
          const bold = (hlRow && r === 0) || (hlCol && c === 0);
          ensureMarkdownFO(this, key, text, {
            x: Math.round(c * colW + PAD_X), y: 0, width: Math.max(0, colW - PAD_X * 2), height: 4000,
            css: cellCss(bold),
          });
          cellList.push({ key, r, text });
        }
      }
      // 1b. READ all heights in one batch (a single reflow), folding each into its row's max.
      const rowH = new Array(rows.length).fill(minRowH);
      let needsRetry = false;
      for (const { key, r, text } of cellList) {
        const content = this.el.querySelector(`:scope > foreignObject[data-md="${key}"] [data-md-content]`);
        const sh = content ? content.scrollHeight : 0;
        if (text && !sh) needsRetry = true;   // non-empty cell not laid out yet
        if (sh + PAD_Y * 2 > rowH[r]) rowH[r] = sh + PAD_Y * 2;
      }
      for (let r = 0; r < rows.length; r++) rowH[r] = Math.round(rowH[r]);
      // Drop foreignObjects for cells that no longer exist (rows/cols shrank).
      this.el.querySelectorAll(':scope > foreignObject[data-md^="cell-"]').forEach(fo => { if (!usedKeys.has(fo.getAttribute('data-md'))) fo.remove(); });

      // 2. Cumulative row Y + final cell positions.
      const rowY = []; let acc = labelH;
      for (let r = 0; r < rows.length; r++) { rowY.push(acc); acc += rowH[r]; }
      const tableH = acc - labelH;
      const totalH = labelH + tableH;
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < cols; c++) {
          const fo = this.el.querySelector(`:scope > foreignObject[data-md="cell-${r}-${c}"]`);
          if (!fo) continue;
          fo.setAttribute('y', String(rowY[r] + PAD_Y));
          fo.setAttribute('height', String(Math.max(0, rowH[r] - PAD_Y * 2)));
        }
      }

      // 3. Draw the table chrome (label, border rect, highlight tints, grid lines) UNDER the cell FOs.
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'df-table-g');
      g.setAttribute('pointer-events', 'none');
      const rect = (x, y, w, h, fill, stroke, rx) => {
        const el = document.createElementNS(ns, 'rect');
        el.setAttribute('x', String(x)); el.setAttribute('y', String(y));
        el.setAttribute('width', String(Math.max(0, w))); el.setAttribute('height', String(Math.max(0, h)));
        if (rx) { el.setAttribute('rx', String(rx)); el.setAttribute('ry', String(rx)); }
        el.setAttribute('fill', fill || 'none');
        if (stroke) { el.setAttribute('stroke', stroke); el.setAttribute('stroke-width', '1'); }
        return el;
      };
      const line = (x1, y1, x2, y2, strong) => {
        const el = document.createElementNS(ns, 'line');
        el.setAttribute('x1', String(x1)); el.setAttribute('y1', String(y1));
        el.setAttribute('x2', String(x2)); el.setAttribute('y2', String(y2));
        el.setAttribute('stroke', tableBorder); el.setAttribute('stroke-opacity', strong ? '0.9' : '0.5');   // grid follows the border colour
        return el;
      };
      if (labelText) {
        const lt = document.createElementNS(ns, 'text');
        lt.setAttribute('x', '1'); lt.setAttribute('y', String(Math.round(labelH - 7)));
        lt.setAttribute('font-size', String(labelFont)); lt.setAttribute('font-weight', '600');
        lt.setAttribute('font-family', 'system-ui, -apple-system, sans-serif'); lt.setAttribute('fill', textColor);
        lt.textContent = labelText;
        g.appendChild(lt);
      }
      g.appendChild(rect(0, labelH, width, tableH, tableFill, tableBorder, 4));
      if (hlRow) g.appendChild(rect(1, labelH + 1, width - 2, rowH[0] - 1, 'var(--bg-elevated)'));
      if (hlCol) g.appendChild(rect(1, labelH + 1, colW - 1, tableH - 2, 'var(--bg-elevated)'));
      for (let c = 1; c < cols; c++) { const x = Math.round(c * colW); g.appendChild(line(x, labelH, x, labelH + tableH, hlCol && c === 1)); }
      for (let r = 1; r < rows.length; r++) { const y = Math.round(rowY[r]); g.appendChild(line(0, y, width, y, hlRow && r === 1)); }
      // Hover cross-highlight: a row + column tint, positioned + shown by the delegated pointer handler (initialize).
      // Drawn last in the chrome <g> (under the cell FOs) so the text stays readable on top.
      this._hoverRow = rect(0, labelH, width, 0, 'var(--selection-color)', null, 0); this._hoverRow.setAttribute('opacity', '0'); this._hoverRow.setAttribute('class', 'df-table-hl-row'); g.appendChild(this._hoverRow);
      this._hoverCol = rect(0, labelH, 0, tableH, 'var(--selection-color)', null, 0); this._hoverCol.setAttribute('opacity', '0'); this._hoverCol.setAttribute('class', 'df-table-hl-col'); g.appendChild(this._hoverCol);
      this._geom = { rowY: rowY.slice(), rowH: rowH.slice(), colW, labelH, tableH, width, cols };
      // Insert the chrome <g> BEFORE the first cell FO so the markdown text paints on top of the fill/tints.
      this.el.insertBefore(g, this.el.querySelector(':scope > foreignObject[data-md^="cell-"]'));

      // 4. Resize the model to the measured content height — but ONLY when the CONTENT or WIDTH changed (a fit
      //    key), so a manual height drag (same rows/width/font) is respected instead of snapping back (mirrors
      //    sf.Note's `_lastFitKey`). A 0-measurement (FOs not laid out on the first render) retries next frame —
      //    bounded + mounted-gated so a torn-down (deleted) or permanently-0 (display:none) view can't spin forever.
      if (!needsRetry) {
        this._mdRetryCount = 0;
        // Include the label: adding / removing / resizing it changes labelH (totalH), so it MUST re-fit the model
        // height — else the resize corners + the selection bounds lag at the pre-label size (the reported bug).
        const fitKey = width + '|' + fontSize + '|' + JSON.stringify(labelText) + '|' + JSON.stringify(rows);
        const cur = model.size();
        if (fitKey !== this._lastFitKey && Math.abs(cur.height - totalH) > 0.5 && !model._fitting) {
          model._fitting = true;
          try { model.resize(width, totalH); } finally { model._fitting = false; }
        }
        this._lastFitKey = fitKey;
      } else if (!this._mdRetry && this.el && this.el.parentNode && (this._mdRetryCount = (this._mdRetryCount || 0) + 1) <= 8) {
        this._mdRetry = true;
        requestAnimationFrame(() => { this._mdRetry = false; this._renderTable(); });
      }
    },
  });

  // --- Line ---
  // A decorative line element — horizontal by default, resizable.
  // Supports solid, dotted, dashed, and break styles via lineStyle property.
  // No ports — purely decorative.
  joint.dia.Element.define(
    'sf.Line',
    {
      size: { width: 200, height: 8 },
      z: 2000,
      lineStyle: 'solid',          // 'solid' | 'dotted' | 'dashed' | 'breaks'
      attrs: {
        hitArea: {
          width: 'calc(w)', height: 'calc(h)',
          fill: 'transparent', stroke: 'none',
        },
        // Transparent hit target sized by sf.LineView to the painted caption
        // above the line, so clicking the label selects the line. The markdown
        // FO is pointer-events:none, so clicks fall through to this rect, which
        // JointJS hit-tests for selection. Hidden until the line has a label.
        labelHit: {
          x: 0, y: 0, width: 0, height: 0,
          fill: 'transparent', stroke: 'none',
          visibility: 'hidden',
        },
        line: {
          x1: 0, y1: 'calc(0.5 * h)', x2: 'calc(w)', y2: 'calc(0.5 * h)',
          stroke: 'var(--text-muted)',
          strokeWidth: 2,
          strokeLinecap: 'round',
        },
        // Optional caption rendered above the line by sf.LineView via a
        // markdown <foreignObject>. Empty by default. This SVG <text> only
        // stores the text/style attrs — it's hidden (display:none) by the FO
        // renderer, which paints the actual markdown.
        label: {
          text: '',
          fontSize: 13,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          x: 0, y: 0,
          textVerticalAnchor: 'bottom',
        },
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'hitArea' },
        { tagName: 'rect', selector: 'labelHit' },
        { tagName: 'line', selector: 'line' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // sf.LineView — paints the optional caption above the line as markdown.
  // The line sits at the element's vertical centre in an 8px-tall box, so the
  // label band lives above it (negative y), bottom-anchored (align-items:
  // flex-end) so multi-line markdown grows upward and never crosses the line.
  // Empty label ⇒ nothing visible (the FO renders an empty content div).
  // Auto-resolved for sf.Line elements via paper.cellViewNamespace.
  joint.shapes.sf.LineView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      this.listenTo(this.model, 'change:attrs change:size', () => this._renderMarkdown());
    },
    render() {
      joint.dia.ElementView.prototype.render.apply(this, arguments);
      this._renderMarkdown();
      return this;
    },
    update() {
      joint.dia.ElementView.prototype.update.apply(this, arguments);
      this._renderMarkdown();
    },
    _renderMarkdown() {
      const m = this.model;
      const { width, height } = m.size();
      const label = m.attr('label') || {};
      const text = label.text ?? '';
      const fontSize = label.fontSize ?? 13;
      const fontFamily = label.fontFamily ?? 'system-ui, -apple-system, sans-serif';
      const fill = label.fill ?? 'var(--text-secondary)';
      const GAP = 4;     // gap between caption and line
      const BAND = 64;   // label band height; overflow:visible lets taller text grow upward
      const w = Math.max(width, 120);
      const foY = (height / 2) - GAP - BAND;
      const css = `display:flex;align-items:flex-end;justify-content:flex-start;`
        + `width:100%;height:100%;`
        + `font-size:${fontSize}px;font-family:${fontFamily};color:${fill};`
        + `line-height:1.3;text-align:left;`
        + `white-space:pre-wrap;word-break:break-word;overflow:visible;`;
      ensureMarkdownFO(this, 'label', text, { x: 0, y: foY, width: w, height: BAND, css, hideSelector: 'label' });
      const fo = this.el.querySelector(':scope > foreignObject[data-md="label"]');
      if (fo) fo.setAttribute('overflow', 'visible');
      // Size the click target to the painted caption. Sync handles the laid-out
      // update path; one deduped rAF handles the first render that runs before
      // the view is inserted into the DOM (FO not laid out yet ⇒ offsetWidth 0).
      this._sizeLabelHit();
      if (text && typeof requestAnimationFrame === 'function') {
        if (this._hitRaf) cancelAnimationFrame(this._hitRaf);
        this._hitRaf = requestAnimationFrame(() => { this._hitRaf = null; this._sizeLabelHit(); });
      }
    },
    _sizeLabelHit() {
      const hit = this.el.querySelector('[joint-selector="labelHit"]');
      if (!hit) return;
      const { height } = this.model.size();
      const text = (this.model.attr('label') || {}).text ?? '';
      const GAP = 4, BAND = 64;
      const foY = (height / 2) - GAP - BAND;
      const fo = this.el.querySelector(':scope > foreignObject[data-md="label"]');
      const content = fo && fo.querySelector('[data-md-content]');
      const tw = content ? content.offsetWidth : 0;
      const th = content ? content.offsetHeight : 0;
      if (text && tw > 0 && th > 0) {
        const PAD = 3;
        hit.setAttribute('x', String(-PAD));
        hit.setAttribute('y', String(foY + BAND - th - PAD));
        hit.setAttribute('width', String(tw + PAD * 2));
        hit.setAttribute('height', String(th + PAD * 2));
        hit.setAttribute('visibility', 'visible');
      } else {
        hit.setAttribute('visibility', 'hidden');
        hit.setAttribute('width', '0');
        hit.setAttribute('height', '0');
      }
    },
  });

  // --- Image ---
  // Raster image element. The data URI lives on `attrs.image.href`; the body
  // rect is a transparent hit area for selection bbox. No ports — images are
  // not connectable. See js/image-component.js for upload/resize and the
  // first-drop consent flow.
  joint.dia.Element.define(
    'sf.Image',
    {
      size: { width: 240, height: 180 },
      z: 1500,
      attrs: {
        body: {
          x: 0, y: 0,
          width: 'calc(w)',
          height: 'calc(h)',
          fill: 'transparent',
          stroke: 'var(--node-border)',
          strokeWidth: 1,
          rx: 8,
          ry: 8,
        },
        image: {
          x: 0, y: 0,
          width: 'calc(w)',
          height: 'calc(h)',
          href: '',
          preserveAspectRatio: 'xMidYMid meet',
          // CSS clip-path keeps the rendered raster inside the rounded body
          // (SVG <image> doesn't accept rx/ry). The number is the default
          // corner radius and stays in sync with body/rx via the property
          // panel's "Corner radius" control.
          style: 'clip-path:inset(0 round 8px);-webkit-clip-path:inset(0 round 8px)',
        },
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'image', selector: 'image' },
      ],
    }
  );

  // --- Link ---
  // Clickable external-link element: label + icon that opens `url` in a new tab.
  // The icon is a separate SVG image; a transparent hit rect on top enlarges
  // the click target. Click handling lives in js/canvas.js (paper pointerclick).
  joint.dia.Element.define(
    'sf.Link',
    {
      size: { width: 220, height: 44 },
      z: 2000,
      url: '',
      attrs: {
        body: {
          x: 0, y: 0,
          width: 'calc(w)', height: 'calc(h)',
          rx: 'calc(0.5 * h)', ry: 'calc(0.5 * h)',
          fill: 'var(--card-bg, #FFFFFF)',
          stroke: 'var(--border-muted, #D0D5DD)',
          strokeWidth: 1,
        },
        label: {
          x: 20, y: 'calc(0.5 * h)',
          textAnchor: 'start', textVerticalAnchor: 'middle',
          fontSize: 14, fontWeight: 600,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: '#1D73C9',
          text: 'Link',
          textWrap: { width: 'calc(w - 60)', maxLineCount: 1, ellipsis: true },
        },
        domain: {
          x: 20, y: 'calc(0.5 * h + 10)',
          textAnchor: 'start', textVerticalAnchor: 'middle',
          fontSize: 10, fontWeight: 400,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-muted, #6B7280)',
          text: '',
          textWrap: { width: 'calc(w - 60)', maxLineCount: 1, ellipsis: true },
        },
        iconImage: {
          x: 'calc(w - 34)', y: 'calc(0.5 * h - 10)',
          width: 20, height: 20,
          href: '',
          cursor: 'pointer',
          pointerEvents: 'none',
        },
        iconHit: {
          x: 'calc(w - 40)', y: 'calc(0.5 * h - 16)',
          width: 32, height: 32,
          rx: 16, ry: 16,
          fill: 'transparent',
          stroke: 'var(--border-muted, #D0D5DD)',
          strokeWidth: 1,
          cursor: 'pointer',
        },
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'text', selector: 'label' },
        { tagName: 'text', selector: 'domain' },
        { tagName: 'image', selector: 'iconImage' },
        { tagName: 'rect', selector: 'iconHit' },
      ],
    }
  );

  // --- Note ---
  // A post-it note style element for descriptions and annotations.
  // No ports — purely informational.
  //
  // The shape has a folded top-right corner (matching the stencil icon):
  //   body            — the main rectangle with the top-right corner cut off
  //                     (polygon path, NOT a simple rect — so the cut is part
  //                     of the border).
  //   fold            — the triangular flap showing the "paper folded over"
  //                     effect at the top-right.
  const NOTE_FOLD = 14; // size (px) of the folded corner flap
  joint.dia.Element.define(
    'sf.Note',
    {
      size: { width: 200, height: 120 },
      z: 2000,    // Node tier: 2000 – 2499
      attrs: {
        // Body is a polygon with the top-right corner cut off diagonally.
        // Path: top-left → top-right-minus-fold → diagonal fold cut
        //       → right-edge-down → bottom-right → bottom-left → close
        body: {
          d: `M 0 0 L calc(w - ${NOTE_FOLD}) 0 L calc(w) ${NOTE_FOLD} L calc(w) calc(h) L 0 calc(h) Z`,
          fill: '#FFF9C4',
          stroke: '#E8D44D',
          strokeWidth: 1,
          strokeLinejoin: 'round',
        },
        // Triangular folded-corner flap. Fill + stroke track the note's BORDER colour (body/stroke) so the user
        // controls the dog-ear by setting the border - the properties Border picker writes fold/fill + fold/stroke
        // too (and migrateNodes reconciles older notes). Default = the body stroke colour.
        fold: {
          d: `M calc(w - ${NOTE_FOLD}) 0 L calc(w - ${NOTE_FOLD}) ${NOTE_FOLD} L calc(w) ${NOTE_FOLD} Z`,
          fill: '#E8D44D',
          stroke: '#E8D44D',
          strokeWidth: 1,
          strokeLinejoin: 'round',
        },
        icon: {
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          href: '',
        },
        label: {
          x: 36,
          y: 14,
          textAnchor: 'start',
          textVerticalAnchor: 'top',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: '#5D4037',
          text: 'Note',
          textWrap: { width: `calc(w - ${48 + NOTE_FOLD})`, maxLineCount: 1, ellipsis: true },
        },
        subtitle: {
          x: 12,
          y: 38,
          textAnchor: 'start',
          textVerticalAnchor: 'top',
          fontSize: 11,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: '#795548',
          text: '',
          textWrap: { width: 'calc(w - 24)', height: 'calc(h - 48)', ellipsis: true },
        },
      },
    },
    {
      markup: [
        { tagName: 'path', selector: 'body' },
        { tagName: 'path', selector: 'fold' },
        { tagName: 'image', selector: 'icon' },
        { tagName: 'text', selector: 'label' },
        { tagName: 'text', selector: 'subtitle' },
      ],
    }
  );

  // Custom view: subtitle (the multi-line body) renders through a foreignObject
  // so inline markdown markers work. The heading (`label`) stays as plain SVG
  // text — single-line headings don't benefit from markdown and keeping them
  // as SVG keeps the existing ellipsis behaviour intact.
  joint.shapes.sf.NoteView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      this.listenTo(this.model, 'change:attrs change:size', () => this._renderMarkdown());
    },
    render() {
      joint.dia.ElementView.prototype.render.apply(this, arguments);
      this._renderMarkdown();
      return this;
    },
    update() {
      joint.dia.ElementView.prototype.update.apply(this, arguments);
      this._renderMarkdown();
    },
    _renderMarkdown() {
      const m = this.model;
      const { width, height } = m.size();
      const subtitle = m.attr('subtitle') || {};
      const text = subtitle.text ?? '';
      const fontSize = subtitle.fontSize ?? 11;
      const fontFamily = subtitle.fontFamily ?? 'system-ui, -apple-system, sans-serif';
      const fill = subtitle.fill ?? '#795548';
      const css = `width:100%;height:100%;`
        + `font-size:${fontSize}px;font-family:${fontFamily};`
        + `color:${fill};line-height:1.3;text-align:left;`
        + `white-space:pre-wrap;word-break:break-word;overflow:hidden;`;
      // Subtitle position matches the original SVG text origin (x:12, y:38,
      // width: w-24, height: h-48 — same maths as the model's attrs.subtitle.
      ensureMarkdownFO(this, 'subtitle', text, {
        x: 12, y: 38,
        width: width - 24,
        height: height - 48,
        css,
        hideSelector: 'subtitle',
      });
      this._autoFitHeight();
    },
    // R6: GROW the note's HEIGHT so the whole description shows. Measures the rendered markdown's natural
    // height and grows to fit (subtitle starts at y=38, ~10 px bottom pad → height = content + 48, floored at
    // 120). Guards: `_fitting` blocks the resize's re-entrant re-render; `_lastFitKey` keys on width+text so a
    // manual HEIGHT-only drag is respected (re-fits only when the width or the text changes).
    // GROW-ONLY (never auto-shrink): a re-render re-runs this for EVERY note, so auto-shrinking made editing
    // one note collapse its siblings — any note taller than its text (manually sized, or sized before R6)
    // would snap down to content, and a Zone/Container hugging them then wrongly shrank to the smallest one
    // (the "captured component shrinks to the active one" bug). Users still shrink a note by hand; the
    // height-only drag survives via the _lastFitKey guard.
    _autoFitHeight() {
      if (this._fitting) return;
      const m = this.model;
      const { width, height } = m.size();
      const text = m.attr('subtitle/text') || '';
      const key = width + '|' + text;
      if (key === this._lastFitKey) return;
      const content = this.el.querySelector('foreignObject[data-md="subtitle"] [data-md-content]');
      if (!content) return;
      const needed = content.scrollHeight;
      // scrollHeight 0 means the foreignObject hasn't laid out yet (common on the FIRST render). DON'T cache the
      // key on that non-measurement: a later render with the same width+text would otherwise skip via the guard
      // above and the note would stay clipped forever. Cache only once there is a real measurement.
      if (!needed) return;
      this._lastFitKey = key;
      const target = Math.max(120, Math.round(needed + 48));
      if (target <= height) return;   // grow-only — only EXPAND (never auto-shrink); no +1 slack so a 1px grow lands
      this._fitting = true;
      try { m.resize(width, target); } finally { this._fitting = false; }
    },
    // Explicit "Auto size" action (vs the passive grow-only _autoFitHeight): fit the height to the content
    // EXACTLY at the current width - growing OR shrinking to it (floored at the 120 default) - so a note that
    // was manually oversized snaps down to fit, and a clipped one grows. Bypasses the grow-only + key guards.
    fitNoteToContent() {
      const m = this.model;
      const width = m.size().width;
      this._renderMarkdown();
      const content = this.el.querySelector('foreignObject[data-md="subtitle"] [data-md-content]');
      const needed = content ? content.scrollHeight : 0;
      const target = Math.max(120, Math.round((needed || 24) + 48));
      this._lastFitKey = width + '|' + (m.attr('subtitle/text') || '');   // keep the passive fit from re-firing
      this._fitting = true;
      try { m.resize(width, target); } finally { this._fitting = false; }
    },
  });

  // ═══════════════════════════════════════════════════════════
  // BPMN Shapes (Process Diagrams)
  // ═══════════════════════════════════════════════════════════


  // --- Zone ---
  // A background area / swim lane. Rendered behind other elements.
  joint.dia.Element.define(
    'sf.Zone',
    {
      size: { width: 400, height: 300 },
      z: 0,       // Zone tier: 0 – 499 (always behind containers and nodes)
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          rx: 8,
          ry: 8,
          fill: 'rgba(29, 115, 201, 0.05)',
          stroke: '#1D73C9',
          strokeWidth: 1,
          strokeDasharray: '8 4',
        },
        label: {
          x: 10,
          y: 16,
          textAnchor: 'start',
          textVerticalAnchor: 'middle',
          fontSize: 11,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-muted)',
          fontWeight: '600',
          text: 'Zone',
          textWrap: { width: 'calc(w - 24)', maxLineCount: 1, ellipsis: true },
        },
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // ═══════════════════════════════════════════════════════════
  // Gantt Shapes
  // ═══════════════════════════════════════════════════════════

}

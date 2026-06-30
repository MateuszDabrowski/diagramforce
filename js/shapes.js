// Custom JointJS shapes for SF Diagrams
// All shapes are under the `sf` namespace
// Uses JointJS v4 JSON markup array syntax

import { parseMarkdown } from './markdown.js?v=1.19.1.1';
import { fieldFocus } from './canvas/focus-state.js?v=1.19.1.1';
import { applyGanttGeometry, applyGanttMilestoneGeometry, applyGanttMarkerGeometry, applyGanttGroupGeometry, ganttGroupSummary, dateToLocalX, layoutTimelineTasks, ganttRowLayout, ganttTimelineFor, ganttSummaryLaneH, recolorGroupTasks, GANTT_SUMMARY_GROUP_H, GANTT_SUMMARY_MARKER_H } from './canvas/gantt-layout.js?v=1.19.1.1';

// ── Stable field identity (fid) ────────────────────────────────────
// Pre-1.15.0, sf.DataObject field ports were keyed by ARRAY INDEX
// (`field-left-2`), so reordering or deleting a field silently re-bound any
// connected link to whatever field then occupied that index. Each field now
// carries an immutable `fid`; ports are `field-left-<fid>` / `field-right-<fid>`
// so a link follows its field across reorder / delete / apiName rename. A fid
// only needs to be unique WITHIN one DataObject (port IDs are cell-scoped), so
// duplicated objects may safely share fids. The leading 'f' keeps a fid from
// ever matching the legacy numeric-index form, which lets the load migration
// (migration.js) distinguish old positional ports from new fid ports.
//
// INVARIANT: every field must have a fid before its ports are built. Guaranteed
// by sf.DataObject.initialize (construction: load / paste / factory) and
// re-asserted in DataObjectView._syncFieldPorts (covers fields added later via
// the editor). Any NEW field-creation path can rely on one of those two.
export function newFid(existing) {
  let id;
  do { id = 'f' + Math.random().toString(36).slice(2, 9); } while (existing && existing.has(id));
  return id;
}

export function ensureFieldFids(cell) {
  const fields = cell.get('fields');
  if (!Array.isArray(fields) || fields.length === 0) return;
  if (fields.every(f => f && f.fid)) return; // idempotent no-op once all fids exist
  const seen = new Set(fields.filter(f => f && f.fid).map(f => f.fid));
  cell.set('fields', fields.map(f => {
    if (f && !f.fid) { const id = newFid(seen); seen.add(id); return { ...f, fid: id }; }
    return f;
  }), { silent: true });
}

// Data Cloud mapping mode flag (per active diagram), wired from app.js. Read by
// DataObjectView._syncFieldPorts to decide whether EVERY field gets connectable
// ports (mapping) or only PK/FK fields (default ER).
let mappingModeGetter = null;
export function setMappingModeGetter(fn) { mappingModeGetter = fn; }

// Wraps a mutation in a single undo entry — wired from app.js to history.startBatch/endBatch so
// the DataObject collapse toggle (a `collapsed` prop change + the follow-on resize) is one undo.
let dataObjectHistoryBatcher = null;
export function setDataObjectHistoryBatcher(fn) { dataObjectHistoryBatcher = fn; }

// Reads the Auto-Fit Containers toggle (canvas.isAutoSizingEnabled) — wired from app.js. When on,
// collapsing/expanding a DataObject re-packs its lane (shifts same-parent siblings below it).
let autoFitGetter = null;
export function setAutoFitGetter(fn) { autoFitGetter = fn; }

// Does a field have a live link on either of its ports? Drives "Show Only Mapped"
// — connected fields stay visible so collapsing the rest never breaks a link.
function fieldHasLink(model, field) {
  const graph = model.graph;
  if (!graph || !field || !field.fid) return false;
  const left = `field-left-${field.fid}`, right = `field-right-${field.fid}`;
  for (const link of graph.getConnectedLinks(model)) {
    for (const end of ['source', 'target']) {
      const ep = link.get(end);
      if (ep && ep.id === model.id && (ep.port === left || ep.port === right)) return true;
    }
  }
  return false;
}

// The fields a DataObject currently renders — rows, ports, and height all agree on
// this single list:
//   • keyFieldsOnly off             → every field
//   • keyFieldsOnly on + mapping ON → mapped fields PLUS key (PK/FK) fields
//     ("Show Only Mapped": unmapped non-key rows collapse, but keys stay as
//     structural anchors so the object keeps context — and any field with a live
//     link always stays, so no JointJS link is ever destroyed)
//   • keyFieldsOnly on + mapping off → only PK/FK fields ("Key Fields Only")
export function getVisibleDataObjectFields(model) {
  const fields = model.get('fields') || [];
  if (!model.get('keyFieldsOnly')) return fields;
  const mapping = !!(mappingModeGetter && mappingModeGetter());
  return mapping
    ? fields.filter(f => f && (fieldHasLink(model, f) || f.keyType))
    : fields.filter(f => f && f.keyType);
}

// ── Markdown foreignObject helper (CR-6.1) ─────────────────────────
// sf.TextLabel and sf.Note render their text as native HTML inside an SVG
// <foreignObject> so inline markdown markers (**bold**, *italic*, ~~strike~~,
// `code`) round-trip through to visible markup. Raster export then converts
// the FO + HTML back into tspans via persistence.js → replaceForeignObjects.
//
// Idempotent — finds an existing FO by `data-md` marker or creates one. Safe
// to call from initialize/render/update without leaking DOM.
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS_SHAPES = 'http://www.w3.org/2000/svg';

function ensureMarkdownFO(view, key, text, opts) {
  if (!view?.el) return;
  let fo = view.el.querySelector(`:scope > foreignObject[data-md="${key}"]`);
  if (!fo) {
    fo = document.createElementNS(SVG_NS_SHAPES, 'foreignObject');
    fo.setAttribute('data-md', key);
    // v1.12.1 — pointer-events:none on the FO itself so clicks pass
    // through to the SVG geometry beneath (hitArea on TextLabel /
    // Annotation, body on Note, header on DataObject, etc.). The
    // previous `pointer-events="all"` made the FO catch clicks but
    // didn't reliably propagate them to JointJS's element-view
    // delegation in Safari — the cell only became selectable via
    // Shift-drag rubber-band. Now selection always goes through proper
    // SVG geometry, which JointJS hit-tests bulletproof.
    fo.setAttribute('pointer-events', 'none');
    view.el.appendChild(fo);
  }
  fo.setAttribute('x', String(opts.x));
  fo.setAttribute('y', String(opts.y));
  fo.setAttribute('width', String(Math.max(0, opts.width)));
  fo.setAttribute('height', String(Math.max(0, opts.height)));

  // Two-level structure: outer `frame` div does flex-based centring (the
  // shape decides via opts.css whether to centre vertically/horizontally);
  // inner `content` div is block-level so `<br>` line breaks and inline
  // markdown elements lay out naturally. Without this nesting the inner
  // <br>s become flex items and stop working as line breaks.
  let frame = fo.firstChild;
  if (!frame || frame.nodeType !== 1 || frame.localName !== 'div' || !frame.dataset?.mdFrame) {
    while (fo.firstChild) fo.removeChild(fo.firstChild);
    frame = document.createElementNS(XHTML_NS, 'div');
    frame.setAttribute('xmlns', XHTML_NS);
    frame.dataset.mdFrame = '';
    const content = document.createElementNS(XHTML_NS, 'div');
    content.setAttribute('xmlns', XHTML_NS);
    content.dataset.mdContent = '';
    frame.appendChild(content);
    fo.appendChild(frame);
  }
  // Append `pointer-events:none; user-select:none` to the frame so the FO
  // itself catches the JointJS pointerdown (selection / drag) and the HTML
  // children don't start a browser text-selection mid-drag. The FO element's
  // `pointer-events="all"` attribute remains the actual hit target.
  frame.style.cssText = opts.css + ';pointer-events:none;user-select:none;';
  // The inner content div carries the rendered HTML; explicit display:block
  // so <br> + inline marks behave normally regardless of frame's flex.
  const content = frame.firstChild;
  content.style.cssText = 'display:block;max-width:100%;pointer-events:none;user-select:none;';
  // parseMarkdown escHtml's first, then applies only the four whitelisted
  // tags + <br>. innerHTML is safe here.
  content.innerHTML = parseMarkdown(text);
  // Hide the original SVG <text> node JointJS still emits (so its rendering
  // doesn't shadow / sit underneath our HTML). Done via inline style so it
  // survives JointJS attr-pass re-renders.
  if (opts.hideSelector) {
    const orig = view.el.querySelector(`[joint-selector="${opts.hideSelector}"]`);
    if (orig) orig.style.display = 'none';
  }
}

export function register() {
  // Shared port configuration — each side uses the same attrs & markup
  const portAttrs = {
    circle: { r: 5, magnet: true, fill: 'var(--port-color, #1D73C9)', stroke: '#FFFFFF', strokeWidth: 1.5 },
  };
  const portMarkup = [{ tagName: 'circle', selector: 'circle' }];
  const portGroups = Object.fromEntries(
    ['top', 'right', 'bottom', 'left'].map(side => [side, {
      position: { name: side },
      attrs: portAttrs,
      markup: portMarkup,
    }])
  );

  const portItems = [
    { id: 'port-top', group: 'top' },
    { id: 'port-right', group: 'right' },
    { id: 'port-bottom', group: 'bottom' },
    { id: 'port-left', group: 'left' },
  ];

  // ---- Sequence diagram port builders ----
  // Participant/Actor: `count` ports evenly spaced along the *lifeline* only
  // (headers are intentionally portless — users connect to the lifeline, not
  // the label header). Positions may be overridden per-cell via a
  // `lifelinePortRatios` array of 0–1 numbers (each a fraction of the
  // lifeline length). When absent, ports are distributed evenly via
  // (i+1)/(n+1).
  //
  // Port IDs follow `seq-port-left-<i>` / `seq-port-right-<i>` — index-based
  // so regenerations keep existing link endpoints stable.
  // Lifeline ports are offset ±LIFELINE_PORT_OFFSET px from the lifeline
  // centre so seq-left and seq-right are rendered as two distinct, clickable
  // circles on either side of the dashed line rather than overlapping on top
  // of each other. Mirrors the paired-ports look Activation shapes have, and
  // is kept in sync with LIFELINE_PORT_OFFSET in canvas.js (self-loop stub
  // override).
  const LIFELINE_PORT_OFFSET = 8;

  function buildSeqParticipantPorts(count, ratios, headerOffset = 48, bottomOffset = 48) {
    const items = [];
    const n = Math.max(1, count | 0);
    const list = Array.isArray(ratios) && ratios.length === n
      ? ratios
      : Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));
    const xLeft  = `calc(0.5 * w - ${LIFELINE_PORT_OFFSET})`;
    const xRight = `calc(0.5 * w + ${LIFELINE_PORT_OFFSET})`;
    // Ports spread across the "usable" lifeline: [headerOffset, h - bottomOffset].
    // Reserving `bottomOffset` at the foot gives symmetric breathing room for
    // the bottom-label mirror even when it's currently hidden, so toggling
    // `showBottomLabel` doesn't reflow link endpoints.
    //   y = headerOffset + ratio * (h - bottomOffset - headerOffset)
    //     = ratio*h + ((1 - ratio)*headerOffset - ratio*bottomOffset)
    for (let i = 0; i < n; i++) {
      const ratio = Math.max(0, Math.min(1, list[i]));
      const offset = Math.round(((1 - ratio) * headerOffset - ratio * bottomOffset) * 100) / 100;
      const sign = offset >= 0 ? '+' : '-';
      const yExpr = `calc(${ratio} * h ${sign} ${Math.abs(offset)})`;
      items.push({ id: `seq-port-left-${i}`,  group: 'seq-left',  args: { x: xLeft,  y: yExpr } });
      items.push({ id: `seq-port-right-${i}`, group: 'seq-right', args: { x: xRight, y: yExpr } });
    }
    return items;
  }

  // SequenceActor: stick figure sits atop the lifeline which begins at y=92.
  function buildSeqActorPorts(count, ratios, lifelineTop = 92) {
    const items = [];
    const n = Math.max(1, count | 0);
    const list = Array.isArray(ratios) && ratios.length === n
      ? ratios
      : Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));
    const xLeft  = `calc(0.5 * w - ${LIFELINE_PORT_OFFSET})`;
    const xRight = `calc(0.5 * w + ${LIFELINE_PORT_OFFSET})`;
    for (let i = 0; i < n; i++) {
      const ratio = Math.max(0, Math.min(1, list[i]));
      const offset = Math.round((1 - ratio) * lifelineTop * 100) / 100;
      const yExpr = `calc(${ratio} * h + ${offset})`;
      items.push({ id: `seq-port-left-${i}`,  group: 'seq-left',  args: { x: xLeft,  y: yExpr } });
      items.push({ id: `seq-port-right-${i}`, group: 'seq-right', args: { x: xRight, y: yExpr } });
    }
    return items;
  }

  // SequenceActivation: narrow strip, `count` port pairs along its full height.
  function buildSeqActivationPorts(count, ratios) {
    const items = [];
    const n = Math.max(1, count | 0);
    const list = Array.isArray(ratios) && ratios.length === n
      ? ratios
      : Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));
    for (let i = 0; i < n; i++) {
      const ratio = Math.max(0, Math.min(1, list[i]));
      const yExpr = `calc(${ratio} * h)`;
      items.push({ id: `seq-port-left-${i}`,  group: 'seq-left',  args: { x: 0,         y: yExpr } });
      items.push({ id: `seq-port-right-${i}`, group: 'seq-right', args: { x: 'calc(w)', y: yExpr } });
    }
    return items;
  }

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
      // Colours are interpolated into SVG attrs + a CSS string → sanitise to the same safe set as icon colours.
      const safeColor = (c, fb) => { const s = String(c || '').replace(/[^a-zA-Z0-9#(),.\s%-]/g, '').trim(); return s || fb; };
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

      // 1. Render + MEASURE every cell's markdown to derive per-row heights.
      const cellCss = (bold) => `width:100%;height:auto;box-sizing:border-box;font-size:${fontSize}px;`
        + `font-weight:${bold ? 700 : 400};font-family:system-ui,-apple-system,sans-serif;color:${textColor};`
        + `line-height:1.3;white-space:pre-wrap;word-break:break-word;overflow:hidden;`;
      const usedKeys = new Set();
      const rowH = [];
      let needsRetry = false;
      for (let r = 0; r < rows.length; r++) {
        let maxH = minRowH;
        for (let c = 0; c < cols; c++) {
          const key = `cell-${r}-${c}`;
          usedKeys.add(key);
          const text = String(rows[r]?.[c] ?? '');
          const bold = (hlRow && r === 0) || (hlCol && c === 0);
          ensureMarkdownFO(this, key, text, {
            x: Math.round(c * colW + PAD_X), y: 0, width: Math.max(0, colW - PAD_X * 2), height: 4000,
            css: cellCss(bold),
          });
          const content = this.el.querySelector(`:scope > foreignObject[data-md="${key}"] [data-md-content]`);
          const sh = content ? content.scrollHeight : 0;
          if (text && !sh) needsRetry = true;   // non-empty cell not laid out yet
          maxH = Math.max(maxH, sh + PAD_Y * 2);
        }
        rowH.push(Math.round(maxH));
      }
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

  // --- BpmnEvent ---
  // Circle event node: Start (thin border), End (thick border), Intermediate
  joint.dia.Element.define(
    'sf.BpmnEvent',
    {
      size: { width: 40, height: 40 },
      z: 2000,
      eventType: 'start', // start | intermediate | end
      attrs: {
        body: {
          cx: 'calc(0.5 * w)',
          cy: 'calc(0.5 * h)',
          r: 'calc(0.5 * w)',
          fill: '#FFFFFF',
          stroke: '#222222',
          strokeWidth: 1.5,
        },
        innerRing: {
          cx: 'calc(0.5 * w)',
          cy: 'calc(0.5 * h)',
          r: 'calc(0.5 * w - 3)',
          fill: 'none',
          stroke: 'none',
          strokeWidth: 1,
        },
        icon: {
          d: '',
          fill: '#222222',
          stroke: 'none',
          transform: 'translate(calc(0.5 * w - 6), calc(0.5 * h - 6))',
        },
        label: {
          x: 'calc(0.5 * w)',
          y: 'calc(h + 10)',
          textAnchor: 'middle',
          textVerticalAnchor: 'top',
          fontSize: 11,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: '',
        },
      },
      ports: {
        groups: portGroups,
        items: portItems,
      },
    },
    {
      markup: [
        { tagName: 'circle', selector: 'body' },
        { tagName: 'circle', selector: 'innerRing' },
        { tagName: 'path', selector: 'icon' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // --- BpmnTask ---
  // Rounded rectangle task (activity)
  joint.dia.Element.define(
    'sf.BpmnTask',
    {
      size: { width: 120, height: 60 },
      z: 2000,
      taskType: 'task', // task | user | service | script | send | receive
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          rx: 8,
          ry: 8,
          fill: '#FFFFFF',
          stroke: '#222222',
          strokeWidth: 1.5,
        },
        taskIcon: {
          x: 6,
          y: 6,
          width: 14,
          height: 14,
          href: '',
        },
        label: {
          x: 'calc(0.5 * w)',
          y: 'calc(0.5 * h)',
          textAnchor: 'middle',
          textVerticalAnchor: 'middle',
          fontSize: 12,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: '#222222',
          text: 'Task',
          textWrap: { width: 'calc(w - 16)', maxLineCount: 4, ellipsis: true },
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
        { tagName: 'image', selector: 'taskIcon' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // --- BpmnGateway ---
  // Diamond decision/merge node
  joint.dia.Element.define(
    'sf.BpmnGateway',
    {
      size: { width: 48, height: 48 },
      z: 2000,
      gatewayType: 'exclusive', // exclusive | parallel | inclusive | event
      attrs: {
        body: {
          d: 'M calc(0.5 * w) 0 L calc(w) calc(0.5 * h) L calc(0.5 * w) calc(h) L 0 calc(0.5 * h) Z',
          fill: '#FFFFFF',
          stroke: '#222222',
          strokeWidth: 1.5,
        },
        marker: {
          x: 'calc(0.5 * w)',
          y: 'calc(0.5 * h)',
          textAnchor: 'middle',
          textVerticalAnchor: 'middle',
          fontSize: 22,
          fontWeight: 'bold',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: '#222222',
          text: '\u00D7',  // × for exclusive
        },
        label: {
          x: 'calc(0.5 * w)',
          y: 'calc(h + 10)',
          textAnchor: 'middle',
          textVerticalAnchor: 'top',
          fontSize: 11,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: '',
        },
      },
      ports: {
        groups: portGroups,
        items: portItems,
      },
    },
    {
      markup: [
        { tagName: 'path', selector: 'body' },
        { tagName: 'text', selector: 'marker' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // --- BpmnSubprocess ---
  // Rounded rectangle with [ + ] marker at bottom center, label top-left
  joint.dia.Element.define(
    'sf.BpmnSubprocess',
    {
      size: { width: 360, height: 240 },
      z: 500,
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          rx: 8,
          ry: 8,
          fill: 'var(--container-bg)',
          stroke: 'var(--container-border)',
          strokeWidth: 1.5,
        },
        expandMarker: {
          x: 'calc(0.5 * w - 7)',
          y: 'calc(h - 16)',
          width: 14,
          height: 14,
          rx: 2,
          ry: 2,
          fill: 'none',
          stroke: 'var(--text-muted)',
          strokeWidth: 1,
        },
        expandPlus: {
          x: 'calc(0.5 * w)',
          y: 'calc(h - 9)',
          textAnchor: 'middle',
          textVerticalAnchor: 'middle',
          fontSize: 12,
          fontWeight: 'bold',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-muted)',
          text: '+',
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
          text: 'Subprocess',
          textWrap: { width: 'calc(w - 24)', maxLineCount: 1, ellipsis: true },
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
        { tagName: 'rect', selector: 'expandMarker' },
        { tagName: 'text', selector: 'expandPlus' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // --- BpmnLoop ---
  // Rounded rectangle with loop arrow marker at bottom center, label top-left
  joint.dia.Element.define(
    'sf.BpmnLoop',
    {
      size: { width: 360, height: 240 },
      z: 500,
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          rx: 8,
          ry: 8,
          fill: 'var(--container-bg)',
          stroke: 'var(--container-border)',
          strokeWidth: 1.5,
        },
        loopIcon: {
          href: '#refresh',
          x: 'calc(0.5 * w - 6)',
          y: 'calc(h - 18)',
          width: 12,
          height: 12,
          fill: 'var(--text-muted)',
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
          text: 'Loop',
          textWrap: { width: 'calc(w - 24)', maxLineCount: 1, ellipsis: true },
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
        { tagName: 'use', selector: 'loopIcon' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // --- BpmnPool ---
  // Horizontal pool/lane container
  joint.dia.Element.define(
    'sf.BpmnPool',
    {
      size: { width: 600, height: 250 },
      z: 0,
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          fill: 'var(--container-bg)',
          stroke: 'var(--container-border)',
          strokeWidth: 1.5,
        },
        header: {
          width: 30,
          height: 'calc(h)',
          fill: 'var(--pool-header-bg, rgba(0,0,0,0.06))',
          stroke: 'var(--container-border)',
          strokeWidth: 1,
        },
        label: {
          x: 15,
          y: 'calc(0.5 * h)',
          textAnchor: 'middle',
          textVerticalAnchor: 'middle',
          fontSize: 12,
          fontWeight: '700',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-primary)',
          text: 'Pool',
          transform: 'rotate(-90, 15, calc(0.5 * h))',
        },
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'rect', selector: 'header' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // --- BpmnDataObject ---
  // Document/data shape (folded corner rectangle)
  joint.dia.Element.define(
    'sf.BpmnDataObject',
    {
      size: { width: 40, height: 50 },
      z: 2000,
      attrs: {
        body: {
          d: 'M 0 0 L calc(w - 10) 0 L calc(w) 10 L calc(w) calc(h) L 0 calc(h) Z',
          fill: '#FFFFFF',
          stroke: '#222222',
          strokeWidth: 1,
        },
        fold: {
          d: 'M calc(w - 10) 0 L calc(w - 10) 10 L calc(w) 10',
          fill: 'none',
          stroke: '#222222',
          strokeWidth: 1,
        },
        label: {
          x: 'calc(0.5 * w)',
          y: 'calc(h + 10)',
          textAnchor: 'middle',
          textVerticalAnchor: 'top',
          fontSize: 11,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: 'Data',
        },
      },
      ports: {
        groups: portGroups,
        items: portItems,
      },
    },
    {
      markup: [
        { tagName: 'path', selector: 'body' },
        { tagName: 'path', selector: 'fold' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // ═══════════════════════════════════════════════════════════
  // Flowchart Shapes (Process Diagrams)
  // ═══════════════════════════════════════════════════════════

  // --- FlowProcess ---
  // Basic rectangle process step
  joint.dia.Element.define(
    'sf.FlowProcess',
    {
      size: { width: 120, height: 60 },
      z: 2000,
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          fill: '#FFFFFF',
          stroke: '#222222',
          strokeWidth: 1.5,
        },
        label: {
          x: 'calc(0.5 * w)',
          y: 'calc(0.5 * h)',
          textAnchor: 'middle',
          textVerticalAnchor: 'middle',
          fontSize: 12,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: '#222222',
          text: 'Process',
          textWrap: { width: 'calc(w - 16)', maxLineCount: 4, ellipsis: true },
        },
      },
      ports: { groups: portGroups, items: portItems },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // --- FlowDecision ---
  // Diamond decision (yes/no)
  joint.dia.Element.define(
    'sf.FlowDecision',
    {
      size: { width: 120, height: 80 },
      z: 2000,
      attrs: {
        body: {
          d: 'M calc(0.5 * w) 0 L calc(w) calc(0.5 * h) L calc(0.5 * w) calc(h) L 0 calc(0.5 * h) Z',
          fill: '#FFFFFF',
          stroke: '#222222',
          strokeWidth: 1.5,
        },
        label: {
          x: 'calc(0.5 * w)',
          y: 'calc(0.5 * h)',
          textAnchor: 'middle',
          textVerticalAnchor: 'middle',
          fontSize: 11,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: '#222222',
          text: 'Decision',
          textWrap: { width: 'calc(0.6 * w - 8)', maxLineCount: 3, ellipsis: true },
        },
      },
      ports: { groups: portGroups, items: portItems },
    },
    {
      markup: [
        { tagName: 'path', selector: 'body' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // --- FlowTerminator ---
  // Pill/stadium shape for start/end
  joint.dia.Element.define(
    'sf.FlowTerminator',
    {
      size: { width: 120, height: 60 },
      z: 2000,
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          rx: 'calc(0.5 * h)',
          ry: 'calc(0.5 * h)',
          fill: '#FFFFFF',
          stroke: '#222222',
          strokeWidth: 1.5,
        },
        label: {
          x: 'calc(0.5 * w)',
          y: 'calc(0.5 * h)',
          textAnchor: 'middle',
          textVerticalAnchor: 'middle',
          fontSize: 12,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: '#222222',
          text: 'Start',
          textWrap: { width: 'calc(w - 32)', maxLineCount: 1, ellipsis: true },
        },
      },
      ports: { groups: portGroups, items: portItems },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // --- FlowDatabase ---
  // Cylinder shape for database/storage
  joint.dia.Element.define(
    'sf.FlowDatabase',
    {
      size: { width: 80, height: 60 },
      z: 2000,
      attrs: {
        body: {
          d: 'M 0 10 C 0 -3 calc(w) -3 calc(w) 10 L calc(w) calc(h - 10) C calc(w) calc(h + 3) 0 calc(h + 3) 0 calc(h - 10) Z',
          fill: '#FFFFFF',
          stroke: '#222222',
          strokeWidth: 1.5,
        },
        top: {
          d: 'M 0 10 C 0 23 calc(w) 23 calc(w) 10',
          fill: 'none',
          stroke: '#222222',
          strokeWidth: 1.5,
        },
        label: {
          x: 'calc(0.5 * w)',
          y: 'calc(0.5 * h + 5)',
          textAnchor: 'middle',
          textVerticalAnchor: 'middle',
          fontSize: 12,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: '#222222',
          text: 'Database',
          textWrap: { width: 'calc(w - 16)', maxLineCount: 4, ellipsis: true },
        },
      },
      ports: { groups: portGroups, items: portItems },
    },
    {
      markup: [
        { tagName: 'path', selector: 'body' },
        { tagName: 'path', selector: 'top' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // --- FlowDocument ---
  // Rectangle with wavy bottom edge
  joint.dia.Element.define(
    'sf.FlowDocument',
    {
      size: { width: 120, height: 60 },
      z: 2000,
      attrs: {
        body: {
          d: 'M 0 0 L calc(w) 0 L calc(w) calc(h - 10) C calc(0.75 * w) calc(h - 20) calc(0.5 * w) calc(h) calc(0.25 * w) calc(h - 10) C calc(0.125 * w) calc(h - 15) 0 calc(h - 10) 0 calc(h - 10) Z',
          fill: '#FFFFFF',
          stroke: '#222222',
          strokeWidth: 1.5,
        },
        label: {
          x: 'calc(0.5 * w)',
          y: 'calc(0.5 * h - 4)',
          textAnchor: 'middle',
          textVerticalAnchor: 'middle',
          fontSize: 12,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: '#222222',
          text: 'Document',
          textWrap: { width: 'calc(w - 16)', maxLineCount: 4, ellipsis: true },
        },
      },
      ports: { groups: portGroups, items: portItems },
    },
    {
      markup: [
        { tagName: 'path', selector: 'body' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // --- FlowIO ---
  // Parallelogram for input/output
  joint.dia.Element.define(
    'sf.FlowIO',
    {
      size: { width: 140, height: 60 },
      z: 2000,
      attrs: {
        body: {
          d: 'M 20 0 L calc(w) 0 L calc(w - 20) calc(h) L 0 calc(h) Z',
          fill: '#FFFFFF',
          stroke: '#222222',
          strokeWidth: 1.5,
        },
        label: {
          x: 'calc(0.5 * w)',
          y: 'calc(0.5 * h)',
          textAnchor: 'middle',
          textVerticalAnchor: 'middle',
          fontSize: 12,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: '#222222',
          text: 'Input / Output',
          textWrap: { width: 'calc(w - 48)', maxLineCount: 4, ellipsis: true },
        },
      },
      ports: { groups: portGroups, items: portItems },
    },
    {
      markup: [
        { tagName: 'path', selector: 'body' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // --- FlowPredefined ---
  // Rectangle with double vertical bars on sides (predefined process)
  joint.dia.Element.define(
    'sf.FlowPredefined',
    {
      size: { width: 120, height: 60 },
      z: 2000,
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          fill: '#FFFFFF',
          stroke: '#222222',
          strokeWidth: 1.5,
        },
        lineLeft: {
          d: 'M 12 0 L 12 calc(h)',
          fill: 'none',
          stroke: '#222222',
          strokeWidth: 1.5,
        },
        lineRight: {
          d: 'M calc(w - 12) 0 L calc(w - 12) calc(h)',
          fill: 'none',
          stroke: '#222222',
          strokeWidth: 1.5,
        },
        label: {
          x: 'calc(0.5 * w)',
          y: 'calc(0.5 * h)',
          textAnchor: 'middle',
          textVerticalAnchor: 'middle',
          fontSize: 12,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: '#222222',
          text: 'Predefined',
          textWrap: { width: 'calc(w - 36)', maxLineCount: 4, ellipsis: true },
        },
      },
      ports: { groups: portGroups, items: portItems },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'path', selector: 'lineLeft' },
        { tagName: 'path', selector: 'lineRight' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // --- FlowOffPage ---
  // Pentagon pointing down (off-page connector)
  joint.dia.Element.define(
    'sf.FlowOffPage',
    {
      size: { width: 60, height: 60 },
      z: 2000,
      attrs: {
        body: {
          d: 'M 0 0 L calc(w) 0 L calc(w) calc(0.65 * h) L calc(0.5 * w) calc(h) L 0 calc(0.65 * h) Z',
          fill: '#FFFFFF',
          stroke: '#222222',
          strokeWidth: 1.5,
        },
        label: {
          x: 'calc(0.5 * w)',
          y: 'calc(0.4 * h)',
          textAnchor: 'middle',
          textVerticalAnchor: 'middle',
          fontSize: 11,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: '#222222',
          text: 'Link',
          textWrap: { width: 'calc(w - 12)', maxLineCount: 1, ellipsis: true },
        },
      },
      ports: { groups: portGroups, items: portItems },
    },
    {
      markup: [
        { tagName: 'path', selector: 'body' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // --- Annotation ---
  // Text with a curly bracket on left or right side
  joint.dia.Element.define(
    'sf.Annotation',
    {
      size: { width: 100, height: 120 },
      z: 2000,
      bracketSide: 'right',
      attrs: {
        // v1.12.1 — same fix as sf.TextLabel: add a transparent hit-area
        // rect so JointJS has real SVG geometry to hit-test against. The
        // bracket path alone is a thin line — most of the cell area is
        // visually empty and was unclickable before this change.
        hitArea: {
          width: 'calc(w)',
          height: 'calc(h)',
          fill: 'transparent',
          stroke: 'none',
          pointerEvents: 'all',
        },
        bracket: {
          d: 'M calc(w) 0 Q calc(w - 12) 0 calc(w - 12) calc(0.25 * h) L calc(w - 12) calc(0.45 * h) Q calc(w - 12) calc(0.5 * h) calc(w - 16) calc(0.5 * h) Q calc(w - 12) calc(0.5 * h) calc(w - 12) calc(0.55 * h) L calc(w - 12) calc(0.75 * h) Q calc(w - 12) calc(h) calc(w) calc(h)',
          fill: 'none',
          stroke: 'var(--text-secondary)',
          strokeWidth: 1.5,
        },
        label: {
          x: 0,
          y: 'calc(0.5 * h)',
          textAnchor: 'start',
          textVerticalAnchor: 'middle',
          fontSize: 12,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: 'Annotation',
          textWrap: { width: 'calc(w - 18)', maxLineCount: 6, ellipsis: true },
        },
      },
      ports: { groups: portGroups, items: portItems },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'hitArea' },
        { tagName: 'path', selector: 'bracket' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // Custom view: like sf.TextLabel/sf.Note, render the annotation text through
  // a foreignObject so inline markdown (**bold**, *italic*, ~~strike~~, `code`)
  // round-trips natively. Foreign-object position respects the `bracketSide`
  // model prop (text on the left when bracket is right, and vice-versa).
  joint.shapes.sf.AnnotationView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      this.listenTo(this.model, 'change:attrs change:size change:bracketSide change:angle',
        () => this._renderMarkdown());
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
      const text = label.text ?? 'Annotation';
      const fontSize = label.fontSize ?? 12;
      const fontFamily = label.fontFamily ?? 'system-ui, -apple-system, sans-serif';
      const fill = label.fill ?? 'var(--text-secondary)';
      // 18 px = bracket gutter (matches the original textWrap width math).
      const GUTTER = 18;
      const isRight = (m.get('bracketSide') || 'right') === 'right';
      const x = isRight ? 0 : GUTTER;
      const w = Math.max(0, width - GUTTER);
      // Auto-horizontal label — the annotation's text always reads level no
      // matter how the bracket is rotated. The <foreignObject> lives inside the
      // element's own rotation frame, so we counter the bracket's angle:
      // foAngle = −elementAngle. Re-rendered on change:angle (in the listenTo
      // above) so it holds as the bracket turns. SVG transform on the FO, NOT a
      // CSS transform on the inner HTML — CSS composed unreliably with the
      // element rotation and made the label vanish. overflow:visible while the
      // FO is turned so the text isn't clipped by its box.
      const norm = a => ((Math.round(a) % 360) + 360) % 360;
      const foAngle = norm(-(m.angle() || 0));
      const css = `display:flex;align-items:center;justify-content:flex-start;`
        + `width:100%;height:100%;`
        + `font-size:${fontSize}px;font-family:${fontFamily};color:${fill};`
        + `line-height:1.3;text-align:left;`
        + `white-space:pre-wrap;word-break:break-word;`
        + (foAngle ? `overflow:visible;` : `overflow:hidden;`);
      ensureMarkdownFO(this, 'label', text, {
        x, y: 0, width: w, height,
        css,
        hideSelector: 'label',
      });
      const fo = this.el.querySelector(':scope > foreignObject[data-md="label"]');
      if (fo) {
        if (foAngle) {
          fo.setAttribute('transform', `rotate(${foAngle} ${x + w / 2} ${height / 2})`);
          fo.setAttribute('overflow', 'visible');
        } else {
          fo.removeAttribute('transform');
          fo.removeAttribute('overflow');
        }
      }
    },
  });

  // ═══════════════════════════════════════════════════════════
  // Data Model Shapes
  // ═══════════════════════════════════════════════════════════

  // --- DataObject ---
  // Database table / Salesforce object with header + dynamic field rows.
  // Fields are stored as a `fields` array property and rendered by a custom view.
  joint.dia.Element.define(
    'sf.DataObject',
    {
      size: { width: 260, height: 80 },
      z: 2000,
      objectName: 'Object',
      headerColor: '#1D73C9',
      fields: [
        { label: 'Id', apiName: 'Id', type: 'ID', keyType: 'pk' },
      ],
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          rx: 4,
          ry: 4,
          fill: 'var(--node-bg)',
          stroke: 'var(--node-border)',
          strokeWidth: 1,
        },
        header: {
          width: 'calc(w)',
          height: 32,
          rx: 4,
          ry: 4,
          fill: '#1D73C9',
          stroke: 'none',
        },
        headerCover: {
          width: 'calc(w)',
          height: 16,
          y: 16,
          fill: '#1D73C9',
          stroke: 'none',
        },
        // Optional contextual icon (Account / Contact / Email / Snowflake …). Empty by
        // default — width/height 0 keeps it invisible until one is picked; updateDataObjectHeaderLayout
        // sizes it to 16×16 and shifts headerLabel right to clear it.
        headerIcon: {
          x: 10,
          y: 8,
          width: 0,
          height: 0,
          href: '',
          preserveAspectRatio: 'xMidYMid meet',
        },
        headerLabel: {
          x: 12,
          y: 16,
          textAnchor: 'start',
          textVerticalAnchor: 'middle',
          fontSize: 13,
          fontWeight: 'bold',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: '#FFFFFF',
          text: 'Object',
        },
      },
      ports: {
        groups: {
          top: portGroups.top,
          bottom: portGroups.bottom,
          // Field-row ports rendered as SQUARES (`rect`) — the visual marker for a
          // **mapping** port (vs the round relationship ports). `_syncFieldPorts` sets
          // each port's fill (by keyType) and toggles the corner radius per mode: a
          // crisp square (rx≈2) in Data Mapping, a rounded near-circle (rx=4) in Data
          // Model where these field ports act as ER (PK/FK) relationship anchors.
          // Square markup also keeps them OUT of the `.available-magnet circle` amber
          // highlight, so a drag doesn't flood every field port yellow.
          fieldLeft: {
            position: { name: 'absolute' },
            attrs: {
              rect: { width: 8, height: 8, x: -4, y: -4, rx: 2, ry: 2, magnet: true, fill: '#F6B355', stroke: '#FFFFFF', strokeWidth: 1.5 },
            },
            markup: [{ tagName: 'rect', selector: 'rect' }],
          },
          fieldRight: {
            position: { name: 'absolute' },
            attrs: {
              rect: { width: 8, height: 8, x: -4, y: -4, rx: 2, ry: 2, magnet: true, fill: '#1D73C9', stroke: '#FFFFFF', strokeWidth: 1.5 },
            },
            markup: [{ tagName: 'rect', selector: 'rect' }],
          },
          // Header-level ER relationship anchors — object↔object relationships, present
          // in BOTH Data Model and Data Mapping. They look and behave exactly like the
          // top/bottom relationship ports (round, `--port-color`), distinct from the
          // square field/mapping ports. Positioned on the header's side edges by
          // `_syncFieldPorts`; see canvas.js link:connect for the crow's-foot seeding.
          erLeft: {
            position: { name: 'absolute' },
            attrs: {
              circle: { r: 5, magnet: true, fill: 'var(--port-color, #1D73C9)', stroke: '#FFFFFF', strokeWidth: 1.5 },
            },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
          erRight: {
            position: { name: 'absolute' },
            attrs: {
              circle: { r: 5, magnet: true, fill: 'var(--port-color, #1D73C9)', stroke: '#FFFFFF', strokeWidth: 1.5 },
            },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
        },
        items: [
          { id: 'port-top', group: 'top' },
          { id: 'port-bottom', group: 'bottom' },
        ],
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'rect', selector: 'header' },
        { tagName: 'rect', selector: 'headerCover' },
        { tagName: 'image', selector: 'headerIcon' },
        { tagName: 'text', selector: 'headerLabel' },
      ],
      initialize(...args) {
        joint.dia.Element.prototype.initialize.apply(this, args);
        // Backfill stable fids for the initial fields (default template,
        // loaded JSON, paste). Runs at construction — before the load
        // migration — so links can be re-keyed against fields[i].fid.
        ensureFieldFids(this);
      },
    }
  );

  // Custom view for DataObject — renders field rows as dynamic SVG
  joint.shapes.sf.DataObjectView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      this.listenTo(this.model, 'change:fields change:showLabels change:showFieldLengths change:keyFieldsOnly change:collapsed', () => this._renderFieldRows());
      this.listenTo(this.model, 'change:fields change:keyFieldsOnly change:collapsed', () => this._syncFieldPorts());
      this.listenTo(this.model, 'change:keyFieldsOnly change:collapsed', () => this._autoResize());
      // Collapse/expand converges (or restores) every field port via _syncFieldPorts, but JointJS
      // re-renders the port ELEMENTS asynchronously. A connected link that re-routes before that
      // flush anchors to the stale, expanded port position — so a collapsed object's mapping links
      // stay drawn as if it were still expanded (most visible on mobile, where the flush lands even
      // later). Force the ports + connected links to settle explicitly. See _rerouteConnectedLinks.
      this.listenTo(this.model, 'change:collapsed', () => this._rerouteConnectedLinks());
      this.listenTo(this.model, 'change:category change:fields change:size', () => this._renderBadges());
    },
    update() {
      joint.dia.ElementView.prototype.update.apply(this, arguments);
      this._renderFieldRows();
      this._syncFieldPorts();
      this._renderBadges();
    },

    _autoResize() {
      const model = this.model;
      const HEADER_H = 32, ROW_H = 22, TOGGLE_H = 18;
      // Collapsed → just the header + the collapse toggle row; expanded → + the field rows.
      const rows = model.get('collapsed') ? 0 : Math.max(getVisibleDataObjectFields(model).length, 1);
      model.resize(model.size().width, HEADER_H + rows * ROW_H + TOGGLE_H);
    },

    // Data Cloud badge in the header (renders regardless of mapping mode, so
    // shared/loaded diagrams show it): a single hollow category pill, right-
    // aligned so it doesn't fight the left-aligned object name. Pointer-events
    // off so it never intercepts selection clicks.
    _renderBadges() {
      const model = this.model;
      const ns = 'http://www.w3.org/2000/svg';
      const old = this.el.querySelector('.do-badges-g');
      if (old) old.remove();
      // Category is a Data Cloud (mapping) concept — only surface the badge when
      // mapping mode is on (i.e. a Data Mapping diagram), so a pure Data Model
      // object never shows a stray category badge. Re-evaluated on every render,
      // so the same shared DataObject adapts when copied between the two types.
      if (!(mappingModeGetter && mappingModeGetter())) return;
      const { width } = model.size();
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'do-badges-g');
      g.setAttribute('pointer-events', 'none');
      let x = width - 8; // right edge; chips are placed leaving-to-the-left
      // Hollow SLDS-style badge: transparent fill, subtle outline, white text — same
      // colour as the header label so the pills read as one family and sit quietly.
      const chip = (text) => {
        const w = Math.max(18, text.length * 5.4 + 12);
        x -= w;
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', String(x)); rect.setAttribute('y', '8');
        rect.setAttribute('width', String(w)); rect.setAttribute('height', '16');
        rect.setAttribute('rx', '8'); rect.setAttribute('ry', '8');
        rect.setAttribute('fill', 'none');
        rect.setAttribute('stroke', 'rgba(255,255,255,0.5)');
        rect.setAttribute('stroke-width', '1');
        g.appendChild(rect);
        const t = document.createElementNS(ns, 'text');
        t.setAttribute('x', String(x + w / 2)); t.setAttribute('y', '16.5');
        t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'central');
        t.setAttribute('font-size', '9'); t.setAttribute('font-weight', '600');
        t.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
        t.setAttribute('fill', '#FFFFFF'); t.setAttribute('opacity', '0.85');
        t.textContent = text;
        g.appendChild(t);
        x -= 5; // gap before the next chip to the left
      };
      // Mapped-fields counter (X/Y): how many of this object's fields carry a mapping
      // link, of the total. Always shown in mapping mode, always the label colour.
      const fields = model.get('fields') || [];
      const total = fields.length;
      const mapped = fields.filter(f => fieldHasLink(model, f)).length;
      chip(`${mapped}/${total}`);
      // Category chip (only when set).
      const category = model.get('category');
      if (category) chip(category);
      this.el.appendChild(g);
    },

    _syncFieldPorts() {
      const model = this.model;
      // Self-heal: guarantee every field has a fid before building ports.
      // Covers fields added after construction (e.g. via the field editor),
      // which never re-run the model initialize. Silent — pure normalization.
      ensureFieldFids(model);
      const { width } = model.size();
      const HEADER_H = 32;
      const ROW_H = 22;

      // Which fields get connectable ports:
      //   • PK/FK fields              — always (default ER behaviour)
      //   • mapping mode ON           — EVERY field (source→DMO field mapping)
      //   • a field with a live link  — always, so a saved mapping link to a
      //     non-key field keeps its endpoint even when mapping mode is off on load
      const allFields = !!(mappingModeGetter && mappingModeGetter());
      const linkedPorts = new Set();
      const graph = model.graph;
      if (graph && !allFields) {
        for (const link of graph.getConnectedLinks(model)) {
          for (const end of ['source', 'target']) {
            const ep = link.get(end);
            if (ep && ep.id === model.id && typeof ep.port === 'string'
                && (ep.port.startsWith('field-left-') || ep.port.startsWith('field-right-'))) {
              linkedPorts.add(ep.port);
            }
          }
        }
      }
      // Each rebuilt port carries its OWN `markup` (and full `attrs`), not just a group
      // reference. This is deliberate: a cell saved before this change bakes in stale
      // `ports.groups` markup (old: field=circle, er=square), and a saved instance's
      // groups OVERRIDE the shape-definition groups on load. Per-PORT markup wins over
      // the group markup, so every diagram — new or pre-existing — renders the current
      // shapes: SQUARE field/mapping ports, ROUND relationship ports.
      const FIELD_MARKUP = [{ tagName: 'rect', selector: 'rect' }];
      const ER_MARKUP = [{ tagName: 'circle', selector: 'circle' }];
      // Field ports are SQUARES in Data Mapping (rx 2 — they read as mapping ports) and
      // rounded near-circles in Data Model (rx 4 on an 8×8 rect = a circle — there they
      // act as ER PK/FK anchors). `allFields` is the mapping-mode flag.
      const fieldCornerR = allFields ? 2 : 4;
      // When the object is collapsed its field rows are hidden, so converge every field port to
      // the header centre — the mapping links then fan into the collapsed object's header instead
      // of dangling at vanished row positions.
      const collapsed = !!model.get('collapsed');
      const desired = [];
      getVisibleDataObjectFields(model).forEach((field, i) => {
        const leftId = `field-left-${field.fid}`;
        const rightId = `field-right-${field.fid}`;
        const wanted = field.keyType || allFields || linkedPorts.has(leftId) || linkedPorts.has(rightId);
        if (wanted) {
          const y = collapsed ? HEADER_H / 2 : HEADER_H + i * ROW_H + ROW_H / 2;
          // PK = amber, FK = blue, FQK = brand red, plain field (mapping) = neutral grey.
          const fill = field.keyType === 'pk' ? '#F6B355' : field.keyType === 'fk' ? '#1D73C9' : field.keyType === 'fqk' ? '#DA4E55' : '#9AA0A6';
          const rectAttrs = { width: 8, height: 8, x: -4, y: -4, rx: fieldCornerR, ry: fieldCornerR, magnet: true, fill, stroke: '#FFFFFF', strokeWidth: 1.5 };
          desired.push({ id: leftId, group: 'fieldLeft', args: { x: 0, y }, markup: FIELD_MARKUP, attrs: { rect: rectAttrs } });
          desired.push({ id: rightId, group: 'fieldRight', args: { x: width, y }, markup: FIELD_MARKUP, attrs: { rect: rectAttrs } });
        }
      });

      // Header-level ER relationship ports — round relationship anchors on the header's
      // side edges, present in BOTH Data Model and Data Mapping (object↔object
      // relationships). They look/behave like the top/bottom relationship ports.
      // Vertically centred on the header. Stable ids so cloned / saved relationship
      // links re-anchor on load.
      const erCircle = { r: 5, magnet: true, fill: 'var(--port-color, #1D73C9)', stroke: '#FFFFFF', strokeWidth: 1.5 };
      const erPorts = [
        { id: 'er-left',  group: 'erLeft',  args: { x: 0,     y: HEADER_H / 2 }, markup: ER_MARKUP, attrs: { circle: erCircle } },
        { id: 'er-right', group: 'erRight', args: { x: width, y: HEADER_H / 2 }, markup: ER_MARKUP, attrs: { circle: erCircle } },
      ];

      // Apply by replacing the whole field-port set in ONE prop write — this
      // reliably adds, repositions, AND removes in a single pass. (JointJS's
      // incremental removePort/removePorts proved unreliable for real removals,
      // leaving stale ports behind when mapping mode turned non-key ports off.)
      // Top/bottom object-level ports are preserved untouched; er-* ports are
      // rebuilt here too (filtered out below) so they appear/disappear with mode.
      const currentItems = model.get('ports')?.items || [];
      const nonFieldPorts = currentItems.filter(p =>
        p.group !== 'fieldLeft' && p.group !== 'fieldRight' && p.group !== 'erLeft' && p.group !== 'erRight');
      // rewrite:true REPLACES the items array. Without it JointJS deep-MERGES by
      // index, so a shorter new list keeps the tail of the previous longer one —
      // removed ports would linger. (Same option the sequence-port rebuilds use.)
      model.prop('ports/items', [...nonFieldPorts, ...erPorts, ...desired], { rewrite: true });
    },

    // Settle a collapse/expand: flush the rendered port elements to the model's positions, then
    // re-route every connected link against those settled anchors. Without the explicit
    // _updatePorts() the port elements lag (JointJS renders them asynchronously), so a link
    // re-routed here would still read the old, expanded port position and never follow the
    // collapse. Runs synchronously (the common case) and again on the next frame (mobile flushes
    // ports late). Guarded against teardown — findViewByModel returns null for a removed view.
    _rerouteConnectedLinks() {
      const model = this.model;
      const paper = this.paper;
      const graph = model.graph;
      if (!graph || !paper) return;
      const flush = () => {
        this._updatePorts?.();
        for (const link of graph.getConnectedLinks(model)) {
          paper.findViewByModel(link)?.update?.();
        }
      };
      flush();
      requestAnimationFrame(flush);
    },

    _renderFieldRows() {
      const model = this.model;
      const fields = getVisibleDataObjectFields(model);
      const { width, height } = model.size();
      const HEADER_H = 32;
      const ROW_H = 22;
      const ns = 'http://www.w3.org/2000/svg';

      // Remove old dynamic content
      const old = this.el.querySelector('.do-fields-g');
      if (old) old.remove();

      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'do-fields-g');

      const collapsed = !!model.get('collapsed');
      if (!collapsed) fields.forEach((field, i) => {
        const y = HEADER_H + i * ROW_H;
        if (y + ROW_H > height + 2) return;

        // Per-field row group: lets flow-focus / field-hover target and dim an
        // individual field (data-fid), and an inset transparent hit-rect makes the
        // whole row hoverable without covering the edge ports (left x=0 / right x=w).
        const rowG = document.createElementNS(ns, 'g');
        rowG.setAttribute('class', 'do-field-row');
        if (field.fid) rowG.setAttribute('data-fid', field.fid);
        // Re-assert any active flow-focus dim on this field (survives re-render).
        if (field.fid && fieldFocus.dimmed?.has(`${model.id}::${field.fid}`)) rowG.classList.add('df-field-dimmed');
        const hit = document.createElementNS(ns, 'rect');
        hit.setAttribute('x', '12');
        hit.setAttribute('y', String(y));
        hit.setAttribute('width', String(Math.max(0, width - 24)));
        hit.setAttribute('height', String(ROW_H));
        hit.setAttribute('fill', 'transparent');
        hit.setAttribute('pointer-events', 'all');
        rowG.appendChild(hit);

        // Separator line between rows
        if (i > 0) {
          const sep = document.createElementNS(ns, 'line');
          sep.setAttribute('x1', '0');
          sep.setAttribute('y1', String(y));
          sep.setAttribute('x2', String(width));
          sep.setAttribute('y2', String(y));
          sep.setAttribute('stroke', 'var(--node-border)');
          sep.setAttribute('stroke-opacity', '0.15');
          rowG.appendChild(sep);
        }

        const textY = y + 15;
        let labelX = 12;

        // Key badge (PK amber, FK blue, FQK brand red — Data Cloud Fully Qualified Key)
        if (field.keyType) {
          const kt = field.keyType;
          const badge = document.createElementNS(ns, 'text');
          badge.setAttribute('x', '8');
          badge.setAttribute('y', String(textY));
          badge.setAttribute('font-size', '8');
          badge.setAttribute('font-weight', '700');
          badge.setAttribute('font-family', 'system-ui, sans-serif');
          badge.setAttribute('fill', kt === 'pk' ? '#F6B355' : kt === 'fk' ? '#1D73C9' : '#DA4E55');
          badge.textContent = kt === 'pk' ? 'PK' : kt === 'fk' ? 'FK' : 'FQK';
          rowG.appendChild(badge);
          labelX = kt === 'fqk' ? 32 : 26;   // FQK is 3 chars — nudge the label clear of it
        }

        // Field type (right-aligned), with optional length — computed first so its width
        // can reserve space when truncating the label below.
        const showLen = model.get('showFieldLengths');
        let typeStr = field.type || '';
        if (showLen && field.length) typeStr += `(${field.length})`;

        // Field label — truncated with an ellipsis so an over-long API name can never spill
        // past the object edge or collide with the right-aligned Data Type. The full,
        // untruncated text stays available as an SVG <title> tooltip.
        const showLabels = model.get('showLabels');
        const fullLabel = (field.apiName || field.label || '') +
          (showLabels && field.label ? ` (${field.label})` : '') +
          (field.required ? ' *' : '');
        const typeW = typeStr ? typeStr.length * 5.6 + 8 : 4;   // ~px, font-size 10
        const avail = width - labelX - typeW - 8;               // px left for the label
        const maxChars = Math.max(3, Math.floor(avail / 6.3));  // ~px per char, font-size 11
        let labelText = fullLabel;
        if (labelText.length > maxChars) labelText = labelText.slice(0, maxChars - 1).trimEnd() + '…';
        const label = document.createElementNS(ns, 'text');
        label.setAttribute('x', String(labelX));
        label.setAttribute('y', String(textY));
        label.setAttribute('font-size', '11');
        label.setAttribute('font-family', 'system-ui, sans-serif');
        label.setAttribute('fill', field.deprecated ? 'var(--text-muted)' : 'var(--node-text)');
        if (field.deprecated) label.setAttribute('text-decoration', 'line-through');
        label.textContent = labelText;
        if (labelText !== fullLabel) {
          const t = document.createElementNS(ns, 'title');
          t.textContent = fullLabel;
          label.appendChild(t);
        }
        rowG.appendChild(label);

        const typeEl = document.createElementNS(ns, 'text');
        typeEl.setAttribute('x', String(width - 10));
        typeEl.setAttribute('y', String(textY));
        typeEl.setAttribute('text-anchor', 'end');
        typeEl.setAttribute('font-size', '10');
        typeEl.setAttribute('font-family', 'system-ui, sans-serif');
        typeEl.setAttribute('fill', 'var(--text-muted)');
        typeEl.textContent = typeStr;
        rowG.appendChild(typeEl);

        g.appendChild(rowG);
      });

      // ── Collapse / expand toggle row (always the last row, present in both states) ──
      // Collapsed → header + ▾ (click to expand); expanded → header + fields + ▴ (click to
      // collapse). A click toggles `collapsed`; mousedown is stopped so it never starts a
      // drag/selection — the toggle is a control, not the object body.
      const TOGGLE_H = 18;
      const ty = HEADER_H + (collapsed ? 0 : Math.max(getVisibleDataObjectFields(model).length, 1) * ROW_H);
      const tg = document.createElementNS(ns, 'g');
      tg.setAttribute('class', 'do-collapse-toggle');
      tg.setAttribute('cursor', 'pointer');
      const thit = document.createElementNS(ns, 'rect');
      thit.setAttribute('x', '0'); thit.setAttribute('y', String(ty));
      thit.setAttribute('width', String(width)); thit.setAttribute('height', String(TOGGLE_H));
      thit.setAttribute('fill', 'transparent'); thit.setAttribute('pointer-events', 'all');
      tg.appendChild(thit);
      if (!collapsed) {
        const sep = document.createElementNS(ns, 'line');
        sep.setAttribute('x1', '0'); sep.setAttribute('y1', String(ty));
        sep.setAttribute('x2', String(width)); sep.setAttribute('y2', String(ty));
        sep.setAttribute('stroke', 'var(--node-border)'); sep.setAttribute('stroke-opacity', '0.15');
        tg.appendChild(sep);
      }
      const cxc = width / 2, cyc = ty + TOGGLE_H / 2;
      const chev = document.createElementNS(ns, 'path');
      chev.setAttribute('d', collapsed
        ? `M ${cxc - 5} ${cyc - 2} L ${cxc} ${cyc + 3} L ${cxc + 5} ${cyc - 2}`
        : `M ${cxc - 5} ${cyc + 2} L ${cxc} ${cyc - 3} L ${cxc + 5} ${cyc + 2}`);
      chev.setAttribute('fill', 'none'); chev.setAttribute('stroke', 'var(--text-muted)');
      chev.setAttribute('stroke-width', '1.5'); chev.setAttribute('stroke-linecap', 'round');
      chev.setAttribute('stroke-linejoin', 'round'); chev.setAttribute('pointer-events', 'none');
      tg.appendChild(chev);
      thit.addEventListener('mousedown', (evt) => evt.stopPropagation());
      thit.addEventListener('click', (evt) => {
        evt.stopPropagation();
        const m = this.model;
        const toggle = () => {
          const beforeH = m.size().height;
          m.prop('collapsed', !m.get('collapsed'));   // change:collapsed → _autoResize → resize (sync)
          // Auto-Fit ON: re-pack the lane in BOTH directions — a collapse closes the freed gap,
          // an expand pushes room open — by shifting same-parent siblings BELOW this object by the
          // height delta. Runs inside the same undo batch (synchronous after the resize). No global
          // reshuffle / no viewport re-frame; the parent then re-fits via its change:size trigger.
          if (autoFitGetter && autoFitGetter()) {
            const delta = m.size().height - beforeH;
            const gr = m.graph, parentId = m.get('parent');
            if (gr && parentId && delta) {
              const myTop = m.position().y;
              gr.getElements().forEach(c => {
                if (c !== m && c.get('parent') === parentId && c.get('type') === 'sf.DataObject'
                    && c.position().y > myTop) {
                  c.position(c.position().x, c.position().y + delta);
                }
              });
            }
          }
        };
        if (dataObjectHistoryBatcher) dataObjectHistoryBatcher(toggle); else toggle();
      });
      g.appendChild(tg);

      this.el.appendChild(g);
    },
  });

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

  // --- GanttTask ---
  // Horizontal bar: colored progress fill + gray remainder + label.
  // progress: 0–100 stored as model property, rendered by custom view.
  joint.dia.Element.define(
    'sf.GanttTask',
    {
      size: { width: 240, height: 32 },
      z: 2000,
      taskLabel: 'Task',
      progress: 0,
      startDate: '',
      endDate: '',
      assignee: '',
      groupId: null,          // 4.5b: id of the timeline group this bar belongs to, or null = ungrouped
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          rx: 4,
          ry: 4,
          fill: 'var(--node-bg)',
          stroke: 'var(--node-border)',
          strokeWidth: 1,
        },
        progressBar: {
          width: 0,
          height: 'calc(h)',
          rx: 4,
          ry: 4,
          fill: '#1D73C9',
          stroke: 'none',
        },
        label: {
          x: 8,
          y: 'calc(0.5 * h)',
          textAnchor: 'start',
          textVerticalAnchor: 'middle',
          fontSize: 12,
          fontWeight: 600,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--node-text)',
          text: 'Task',
          textWrap: { width: 'calc(w - 16)', maxLineCount: 1, ellipsis: true },
        },
        percentLabel: {
          x: 'calc(w - 8)',
          y: 'calc(0.5 * h - 4)',
          textAnchor: 'end',
          textVerticalAnchor: 'middle',
          fontSize: 10,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: '',
        },
        assigneeLabel: {
          x: 'calc(w - 8)',
          y: 'calc(0.5 * h + 8)',
          textAnchor: 'end',
          textVerticalAnchor: 'middle',
          fontSize: 9,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: '',
        },
      },
      ports: {
        groups: {
          left: {
            position: { name: 'left' },
            attrs: { circle: { r: 4, magnet: true, fill: 'var(--port-color, #1D73C9)', stroke: '#FFFFFF', strokeWidth: 1.5 } },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
          right: {
            position: { name: 'right' },
            attrs: { circle: { r: 4, magnet: true, fill: 'var(--port-color, #1D73C9)', stroke: '#FFFFFF', strokeWidth: 1.5 } },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
        },
        items: [
          { id: 'port-left', group: 'left' },
          { id: 'port-right', group: 'right' },
        ],
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'rect', selector: 'progressBar' },
        { tagName: 'text', selector: 'label' },
        { tagName: 'text', selector: 'percentLabel' },
        { tagName: 'text', selector: 'assigneeLabel' },
      ],
    }
  );

  // Custom view for GanttTask — updates progress bar width
  joint.shapes.sf.GanttTaskView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      this.listenTo(this.model, 'change:progress', () => this._updateProgress());
      this.listenTo(this.model, 'change:assignee change:showAssignee change:showProgress', () => this._updateDisplay());
      // Dates are the source of truth: editing start/end re-derives the bar's x + width on the timeline (gantt-scale).
      this.listenTo(this.model, 'change:startDate change:endDate', () => applyGanttGeometry(this.model));
      // Issue 6: a task's bar colour follows its GROUP — when it joins/changes a group (drop / drag / editor), recolour
      // its progress bar to the group's colour, UNLESS the user set a colour manually (`colorManual`). Fires only on a
      // groupId CHANGE (not initial load), so saved per-task colours are preserved.
      this.listenTo(this.model, 'change:groupId', () => {
        if (this.model.get('colorManual')) return;
        const tl = ganttTimelineFor(this.model);
        const gid = this.model.get('groupId');
        const grp = gid && tl && (tl.get('groups') || []).find((g) => g.id === gid);
        if (grp && grp.color) this.model.attr('progressBar/fill', grp.color);
      });
    },
    update() {
      joint.dia.ElementView.prototype.update.apply(this, arguments);
      this._updateProgress();
      this._updateDisplay();
    },
    _updateDisplay() {
      // Delegate to _updateProgress which handles all text, colors, and visibility
      this._updateProgress();
    },
    _updateProgress() {
      const model = this.model;
      const progress = Math.max(0, Math.min(100, model.get('progress') || 0));
      const { width } = model.size();
      const barWidth = Math.round(width * progress / 100);
      model.attr('progressBar/width', barWidth, { silent: true });

      const showProgress = model.get('showProgress') !== false;
      model.attr('percentLabel/text', showProgress && progress > 0 ? `${progress}%` : '', { silent: true });

      // Only override body fill if the user hasn't set a custom background color.
      // Custom means anything other than the two auto-managed values.
      const currentFill = model.attr('body/fill');
      const isDefaultFill = !currentFill || currentFill === 'var(--node-bg)' || currentFill === 'var(--gantt-task-uncompleted)';
      let bodyFill;
      if (isDefaultFill) {
        bodyFill = (progress > 0 && progress < 100) ? 'var(--gantt-task-uncompleted)' : 'var(--node-bg)';
        model.attr('body/fill', bodyFill, { silent: true });
      } else {
        bodyFill = currentFill;
      }

      // Text color: respect user override, otherwise auto-compute from progress
      const userTextColor = model.get('userTextColor');
      const labelColor = userTextColor || (progress > 0 ? '#FFFFFF' : 'var(--node-text)');
      const pctColor = userTextColor || (progress > 0 ? '#FFFFFF' : 'var(--text-secondary)');
      const assigneeColor = userTextColor || (progress > 0 ? '#FFFFFF' : 'var(--text-secondary)');
      model.attr('label/fill', labelColor, { silent: true });
      model.attr('percentLabel/fill', pctColor, { silent: true });
      model.attr('assigneeLabel/fill', assigneeColor, { silent: true });

      // Show/hide assignee
      const showAssignee = model.get('showAssignee') !== false;
      const assignee = model.get('assignee') || '';
      model.attr('assigneeLabel/text', showAssignee ? assignee : '', { silent: true });

      // Force view re-render of attrs
      const progressBarEl = this.el.querySelector('[joint-selector="progressBar"]');
      if (progressBarEl) progressBarEl.setAttribute('width', String(barWidth));
      const bodyEl = this.el.querySelector('[joint-selector="body"]');
      if (bodyEl) bodyEl.setAttribute('fill', bodyFill);
      const pctEl = this.el.querySelector('[joint-selector="percentLabel"]');
      if (pctEl) {
        pctEl.textContent = showProgress && progress > 0 ? `${progress}%` : '';
        pctEl.setAttribute('fill', pctColor);
      }
      const labelEl = this.el.querySelector('[joint-selector="label"]');
      if (labelEl) labelEl.setAttribute('fill', labelColor);
      const assigneeEl = this.el.querySelector('[joint-selector="assigneeLabel"]');
      if (assigneeEl) {
        assigneeEl.textContent = showAssignee ? assignee : '';
        assigneeEl.setAttribute('fill', assigneeColor);
      }
    },
  });

  // --- GanttMilestone ---
  // Diamond marker for key project milestones.
  joint.dia.Element.define(
    'sf.GanttMilestone',
    {
      size: { width: 24, height: 24 },
      z: 2000,
      milestoneDate: '',
      attrs: {
        body: {
          refPoints: '0,0.5 0.5,0 1,0.5 0.5,1',
          fill: '#F6B355',
          stroke: '#D4942A',
          strokeWidth: 1.5,
        },
        label: {
          x: 'calc(0.5 * w)',
          y: -4,
          textAnchor: 'middle',
          textVerticalAnchor: 'bottom',
          fontSize: 11,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-primary)',
          text: 'Milestone',
        },
        dateLabel: {   // ALWAYS-on date caption below the diamond (like the Day Marker)
          x: 'calc(0.5 * w)',
          y: 'calc(h + 4)',
          textAnchor: 'middle',
          textVerticalAnchor: 'top',
          fontSize: 10,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: '',
        },
      },
      ports: {
        groups: {
          left: {
            position: { name: 'left' },
            attrs: { circle: { r: 4, magnet: true, fill: '#F6B355', stroke: '#FFFFFF', strokeWidth: 1.5 } },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
          right: {
            position: { name: 'right' },
            attrs: { circle: { r: 4, magnet: true, fill: '#F6B355', stroke: '#FFFFFF', strokeWidth: 1.5 } },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
        },
        items: [
          { id: 'port-left', group: 'left' },
          { id: 'port-right', group: 'right' },
        ],
      },
    },
    {
      markup: [
        { tagName: 'polygon', selector: 'body' },
        { tagName: 'text', selector: 'label' },
        { tagName: 'text', selector: 'dateLabel' },
      ],
    }
  );

  // Custom view for GanttMilestone — `milestoneDate` is the source of truth, mirroring GanttTaskView for bars:
  // editing the date (panel / JSON / programmatic) slides the diamond to that column instead of being a silent
  // no-op. X derives from the date; Y stays where the user placed it (see applyGanttMilestoneGeometry). The
  // diamond ALWAYS shows its date as a caption (issue 9), like the Day Marker.
  joint.shapes.sf.GanttMilestoneView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      this.model.attr('dateLabel/text', fmtGanttDate(this.model.get('milestoneDate')), { silent: true });
      this.listenTo(this.model, 'change:milestoneDate', () => {
        applyGanttMilestoneGeometry(this.model);
        this.model.attr('dateLabel/text', fmtGanttDate(this.model.get('milestoneDate')));
      });
    },
  });

  // Short, locale-stable date caption for a Gantt marker ("24 Jun"). Empty for an unset/invalid date.
  const _GANTT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtGanttDate(iso) {
    if (!iso || typeof iso !== 'string') return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return '';
    const mon = _GANTT_MONTHS[Number(m[2]) - 1];
    return mon ? `${Number(m[3])} ${mon}` : '';
  }

  // --- GanttMarker ---
  // Upward-pointing triangle that marks a day on a Gantt chart (not necessarily today).
  // Can be embedded in a GanttTimeline like a milestone; shows its date as a caption.
  joint.dia.Element.define(
    'sf.GanttMarker',
    {
      size: { width: 20, height: 16 },
      z: 2000,
      pointDown: false,
      markerDate: '',   // Phase 6: when set, the triangle's x derives from this date (mirrors a milestone)
      attrs: {
        body: {
          refPoints: '0,1 0.5,0 1,1',
          fill: '#DA4E55',
          stroke: '#B03A40',
          strokeWidth: 1.5,
        },
        label: {
          x: 'calc(0.5 * w)',
          y: 'calc(h + 4)',
          textAnchor: 'middle',
          textVerticalAnchor: 'top',
          fontSize: 10,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-primary)',
          text: 'Day',
        },
        // A small date caption below the label (the view fills it from markerDate).
        dateLabel: {
          x: 'calc(0.5 * w)',
          y: 'calc(h + 17)',
          textAnchor: 'middle',
          textVerticalAnchor: 'top',
          fontSize: 9,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: '',
        },
      },
      ports: {
        groups: {
          left: {
            position: { name: 'left' },
            attrs: { circle: { r: 4, magnet: true, fill: '#DA4E55', stroke: '#FFFFFF', strokeWidth: 1.5 } },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
          right: {
            position: { name: 'right' },
            attrs: { circle: { r: 4, magnet: true, fill: '#DA4E55', stroke: '#FFFFFF', strokeWidth: 1.5 } },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
        },
        items: [
          { id: 'port-left', group: 'left' },
          { id: 'port-right', group: 'right' },
        ],
      },
    },
    {
      markup: [
        { tagName: 'polygon', selector: 'body' },
        { tagName: 'text', selector: 'label' },
        { tagName: 'text', selector: 'dateLabel' },
      ],
    }
  );

  // Custom view for GanttMarker — like GanttMilestoneView, `markerDate` (when set) is the source of truth:
  // editing the date slides the triangle to that column. The date also shows as a caption under the label.
  joint.shapes.sf.GanttMarkerView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      const sync = () => { applyGanttMarkerGeometry(this.model); this.model.attr('dateLabel/text', fmtGanttDate(this.model.get('markerDate'))); };
      this.listenTo(this.model, 'change:markerDate', sync);
      this.model.attr('dateLabel/text', fmtGanttDate(this.model.get('markerDate')), { silent: true });
    },
  });

  // --- GanttTimeline ---
  // Auto-calculated week/month header. Renders a two-row header:
  // top row shows months, bottom row shows weeks (or vice versa).
  // Custom view dynamically creates SVG column elements.
  joint.dia.Element.define(
    'sf.GanttTimeline',
    {
      size: { width: 960, height: 48 },
      z: 1000,
      startDate: '',          // YYYY-MM-DD format
      endDate: '',            // YYYY-MM-DD format (auto-calculated or manual)
      todayDate: '',          // Phase 6: YYYY-MM-DD — draws a full-height "today" line at this date's column
      viewMode: 'week',       // 'day', 'week' or 'month'
      numPeriods: 12,         // number of columns to show
      tasks: [],              // LEGACY (pre-4.5b): array of { id, type:'group'|'task', label, groupId?, color? }
      groups: [],             // 4.5b: [{ id, label, color, order }] group header rows; bars reference one via groupId
      taskListWidth: 200,     // width of the left task list panel
      rowHeight: 48,          // height per task row (tall enough for embedded elements)
      timelineTitle: 'Tasks',      // replaces the hardcoded "Tasks" header
      timelineDescription: '',     // description text below title
      weekStartDay: 1,             // first day of week (week-view column split): 1=Mon, 0=Sun, 6=Sat
      showWeekNumber: false,       // week view: label columns "W23" instead of the week start date
      weekendStartDay: 6,          // first weekend day (day-view shading): 6=Sat (Sat–Sun) or 5=Fri (Fri–Sat)
      showProjectSummary: false,   // Phase 6: a read-only overview lane at the top — every group summary bar +
                                   // milestone + day marker condensed into one row (Display menu toggle)
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          fill: 'var(--bg-surface-raised)',
          stroke: 'var(--node-border)',
          strokeWidth: 1,
          rx: 4,
          ry: 4,
        },
        topRow: {
          width: 'calc(w)',
          height: 24,
          fill: 'var(--node-bg)',
          stroke: 'none',
          rx: 4,
          ry: 4,
          pointerEvents: 'none',
        },
        divider: {
          x1: 0,
          y1: 24,
          x2: 'calc(w)',
          y2: 24,
          stroke: 'var(--node-border)',
          strokeWidth: 0.5,
          pointerEvents: 'none',
        },
      },
      ports: { groups: {}, items: [] },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'rect', selector: 'topRow' },
        { tagName: 'line', selector: 'divider' },
        // Dynamic column labels added by GanttTimelineView
        { tagName: 'g', selector: 'columns', attributes: { 'pointer-events': 'none' } },
      ],
    }
  );

  // Custom view for GanttTimeline — renders date columns dynamically
  joint.shapes.sf.GanttTimelineView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      // Re-draw the ruler AND re-position dated task bars whenever the axis changes (the bars track the timeline).
      this.listenTo(this.model, 'change:startDate change:endDate change:todayDate change:viewMode change:numPeriods change:size change:tasks change:groups change:taskListWidth change:rowHeight change:timelineTitle change:timelineDescription change:weekStartDay change:showWeekNumber change:weekendStartDay change:showProjectSummary', () => { this._renderColumns(); layoutTimelineTasks(this.model); });
      // Issue 7: a group's colour change must reach its bars — the per-task `change:groupId` listener can't see a
      // `change:groups` edit (recolour in the group editor / properties), so recolour all non-manual bars here.
      this.listenTo(this.model, 'change:groups', () => recolorGroupTasks(this.model));
      // Phase 4.2: the left panel is DERIVED from the bars, so re-render it when a GanttTask bar is added /
      // removed / moved / resized / relabelled. rAF-debounced; _renderColumns only touches this view's columns
      // group + silent attrs (no graph mutation), so there is no redraw loop.
      this._panelRaf = false;
      const reRenderPanel = () => {
        if (this._panelRaf) return;
        this._panelRaf = true;
        requestAnimationFrame(() => { this._panelRaf = false; this._renderColumns(); });
      };
      if (this.model.graph) {
        this.listenTo(this.model.graph, 'add remove change:position change:size change:taskLabel change:groupId change:markerDate change:milestoneDate change:progress change:startDate change:endDate', (cell) => {
          const ct = cell?.get?.('type');
          // Re-draw on a task change (panel rows + group summary bars react to dates/progress) OR a marker/
          // milestone change (the event lines + glyph columns + the Timeline Summary lane).
          if (ct === 'sf.GanttTask' || ct === 'sf.GanttMarker' || ct === 'sf.GanttMilestone') reRenderPanel();
        });
      }
    },
    update() {
      joint.dia.ElementView.prototype.update.apply(this, arguments);
      this._renderColumns();
    },

    _getVisibleTasks() {
      return this.model.get('tasks') || [];
    },

    _renderColumns() {
      const model = this.model;
      const viewMode = model.get('viewMode') || 'week';
      const numPeriods = model.get('numPeriods') || 12;
      const startStr = model.get('startDate') || '';
      const weekStartDay = ((Number(model.get('weekStartDay') ?? 1) % 7) + 7) % 7; // 0..6
      const showWeekNumber = model.get('showWeekNumber') === true;
      const weekendStartDay = ((Number(model.get('weekendStartDay') ?? 6) % 7) + 7) % 7; // 6=Sat / 5=Fri
      // Phase 4.6: the left panel derives PURELY from the unified bar+group layout (group headers interleaved with
      // their bars) — the bars own the record. A legacy tasks[]-only timeline can't reach here: migrateGanttTimeline
      // converts it to bars on load, the stencil drop seeds bars, and a fresh Gantt seeds bars.
      const layout = ganttRowLayout(model);
      const rowCount = layout.length;
      const taskListWidth = rowCount ? (model.get('taskListWidth') || 200) : 0;
      const rowHeight = Math.max(model.get('rowHeight') || 48, 48);
      const dateH = 48;            // total height for the two date rows
      const topH = dateH / 2;      // top date row height
      const botH = dateH / 2;      // bottom date row height
      // Timeline Summary overview lane (Display toggle). When ON it REPLACES the band below the dates with a lane
      // that has one SUBROW per group + a marker subrow (grows with the group count). When OFF the band is the 40px
      // phase row ONLY if there's a description; otherwise it collapses to 0 (no empty gap). headerH matches
      // ganttHeaderH so bars + panel stay aligned.
      const summaryOn = model.get('showProjectSummary');
      const summaryH = summaryOn ? ganttSummaryLaneH(model) : 0;
      const hasDesc = !!(model.get('timelineDescription') || '').trim();
      const phaseRowH = summaryOn ? 0 : (hasDesc ? 40 : 0);
      const headerH = dateH + phaseRowH + summaryH;

      // Unified row list. Each layout row (group header OR bar) sits at the DETERMINISTIC slot
      // `headerH + rowIndex*rowHeight` — the SAME index the geometry uses for the bar's Y — so the panel and the
      // bars can never disagree (and a mid-drag bar no longer jolts the panel). `rowY` is timeline-local top.
      const rows = layout.map(r => ({ type: r.kind === 'group' ? 'group' : 'task', label: r.label, color: r.color, groupId: r.groupId, rowY: headerH + r.rowIndex * rowHeight }));

      // Auto-resize height to fit the rows (lowest row bottom, min one row below the header).
      const totalHeight = rows.length ? Math.max(headerH + rowHeight, ...rows.map(r => r.rowY + rowHeight)) : headerH;
      const { width } = model.size();
      if (model.size().height !== totalHeight) {
        model.resize(width, totalHeight, { silent: true });
        model.attr('body/height', totalHeight, { silent: true });
      }
      // Keep topRow and divider aligned with the date header area
      model.attr('topRow/x', taskListWidth, { silent: true });
      model.attr('topRow/width', width - taskListWidth, { silent: true });
      model.attr('topRow/height', topH, { silent: true });
      model.attr('divider/x1', taskListWidth, { silent: true });
      model.attr('divider/y1', topH, { silent: true });
      model.attr('divider/y2', topH, { silent: true });
      // Apply to DOM immediately (silent attrs don't trigger re-render)
      const bodyEl = this.el.querySelector('[joint-selector="body"]');
      if (bodyEl) { bodyEl.setAttribute('height', totalHeight); bodyEl.setAttribute('width', width); }
      const topRowEl = this.el.querySelector('[joint-selector="topRow"]');
      if (topRowEl) { topRowEl.setAttribute('x', taskListWidth); topRowEl.setAttribute('width', width - taskListWidth); topRowEl.setAttribute('height', topH); }
      const dividerEl = this.el.querySelector('[joint-selector="divider"]');
      if (dividerEl) { dividerEl.setAttribute('x1', taskListWidth); dividerEl.setAttribute('y1', topH); dividerEl.setAttribute('y2', topH); }
      const height = totalHeight;

      const colGroup = this.el.querySelector('[joint-selector="columns"]');
      if (!colGroup) return;
      colGroup.innerHTML = '';

      const start = startStr ? new Date(startStr + 'T00:00:00') : new Date();
      if (isNaN(start.getTime())) return;

      // Snap start to the configured first-day-of-week (week view) or 1st of month (month view)
      if (viewMode === 'week') {
        const day = start.getDay();
        start.setDate(start.getDate() - ((day - weekStartDay + 7) % 7));
      } else if (viewMode === 'month') {
        start.setDate(1);
      }

      const timelineW = width - taskListWidth;
      const colW = timelineW / numPeriods;
      const SVG_NS = 'http://www.w3.org/2000/svg';
      const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

      // Helpers — all non-interactive elements get pointer-events:none
      const mkText = (x, y, text, size, weight, fill) => {
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('x', x); t.setAttribute('y', y);
        t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'central');
        t.setAttribute('font-size', size); t.setAttribute('font-weight', weight);
        t.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
        t.setAttribute('fill', fill);
        t.setAttribute('pointer-events', 'none');
        t.textContent = text;
        return t;
      };
      const mkRect = (x, y, w, h, fill) => {
        const r = document.createElementNS(SVG_NS, 'rect');
        r.setAttribute('x', x); r.setAttribute('y', y);
        r.setAttribute('width', w); r.setAttribute('height', h);
        r.setAttribute('fill', fill);
        r.setAttribute('pointer-events', 'none');
        return r;
      };
      const mkLine = (x1, y1, x2, y2, sw) => {
        const l = document.createElementNS(SVG_NS, 'line');
        l.setAttribute('x1', x1); l.setAttribute('y1', y1);
        l.setAttribute('x2', x2); l.setAttribute('y2', y2);
        l.setAttribute('stroke', 'var(--node-border)'); l.setAttribute('stroke-width', sw);
        l.setAttribute('pointer-events', 'none');
        return l;
      };

      // Offset X for task list panel
      const oX = taskListWidth;

      if (viewMode === 'day') {
        // Day view: top row = weeks/months, bottom row = individual dates
        const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const days = [];
        const d = new Date(start);
        for (let i = 0; i < numPeriods; i++) {
          days.push({ date: new Date(d), x: oX + i * colW });
          d.setDate(d.getDate() + 1);
        }

        // Group days by month for top row
        const monthSpans = [];
        let curMonth = -1, curYear = -1, spanStart = oX;
        days.forEach((day) => {
          const m = day.date.getMonth();
          const y = day.date.getFullYear();
          if (m !== curMonth || y !== curYear) {
            if (curMonth >= 0) monthSpans.push({ month: curMonth, year: curYear, startX: spanStart, endX: day.x });
            curMonth = m; curYear = y; spanStart = day.x;
          }
        });
        if (curMonth >= 0) monthSpans.push({ month: curMonth, year: curYear, startX: spanStart, endX: width });

        // Draw month spans (top row)
        monthSpans.forEach((ms, i) => {
          const spanW = ms.endX - ms.startX;
          if (i % 2 === 1) colGroup.appendChild(mkRect(ms.startX, 0, spanW, topH, 'var(--stencil-item-hover)'));
          if (ms.startX > oX) colGroup.appendChild(mkLine(ms.startX, 0, ms.startX, height, '0.5'));
          colGroup.appendChild(mkText(ms.startX + spanW / 2, topH / 2, `${MONTHS_SHORT[ms.month]} ${ms.year}`, '11', '700', 'var(--text-primary)'));
        });

        // Weekend column highlight across ALL rows (header + tasks). The 2-day weekend
        // block runs from weekendStartDay (6=Sat → Sat–Sun; 5=Fri → Fri–Sat).
        days.forEach((day) => {
          const dow = day.date.getDay();
          const isWeekend = dow === weekendStartDay || dow === (weekendStartDay + 1) % 7;
          if (isWeekend) colGroup.appendChild(mkRect(day.x, topH, colW, height - topH, 'var(--stencil-item-hover)'));
        });

        // Draw day labels (bottom row)
        days.forEach((day, i) => {
          if (i > 0) colGroup.appendChild(mkLine(day.x, topH, day.x, height, '0.3'));
          const label = colW > 40 ? `${DAYS_SHORT[day.date.getDay()]} ${day.date.getDate()}`
            : colW > 28 ? `${DAYS_SHORT[day.date.getDay()].charAt(0)} ${day.date.getDate()}`
            : String(day.date.getDate());
          colGroup.appendChild(mkText(day.x + colW / 2, topH + botH / 2, label, '9', '500', 'var(--text-secondary)'));
        });
      } else if (viewMode === 'week') {
        // Top row: months that span across weeks
        // Bottom row: week start dates ("3 Apr") OR week numbers ("W14") per showWeekNumber
        const weeks = [];
        const d = new Date(start);
        for (let i = 0; i < numPeriods; i++) {
          weeks.push({ start: new Date(d), x: oX + i * colW });
          d.setDate(d.getDate() + 7);
        }

        // Week number counted from the week containing Jan 1 of that date's year,
        // relative to the configured first-day-of-week (so it tracks weekStartDay).
        const weekNumberFor = (wd) => {
          const jan1 = new Date(wd.getFullYear(), 0, 1);
          const firstWeekStart = new Date(jan1);
          firstWeekStart.setDate(jan1.getDate() - ((jan1.getDay() - weekStartDay + 7) % 7));
          return Math.floor(Math.round((wd - firstWeekStart) / 86400000) / 7) + 1;
        };

        // Group weeks by month for top row
        const monthSpans = [];
        let curMonth = -1, curYear = -1, spanStart = oX;
        weeks.forEach((w) => {
          const m = w.start.getMonth();
          const y = w.start.getFullYear();
          if (m !== curMonth || y !== curYear) {
            if (curMonth >= 0) monthSpans.push({ month: curMonth, year: curYear, startX: spanStart, endX: w.x });
            curMonth = m; curYear = y; spanStart = w.x;
          }
        });
        if (curMonth >= 0) monthSpans.push({ month: curMonth, year: curYear, startX: spanStart, endX: width });

        // Draw month spans (top row)
        monthSpans.forEach((ms, i) => {
          const spanW = ms.endX - ms.startX;
          if (i % 2 === 1) colGroup.appendChild(mkRect(ms.startX, 0, spanW, topH, 'var(--stencil-item-hover)'));
          if (ms.startX > oX) colGroup.appendChild(mkLine(ms.startX, 0, ms.startX, height, '0.5'));
          colGroup.appendChild(mkText(ms.startX + spanW / 2, topH / 2, `${MONTHS_SHORT[ms.month]} ${ms.year}`, '11', '700', 'var(--text-primary)'));
        });

        // Draw week labels (bottom row)
        weeks.forEach((w, i) => {
          if (i % 2 === 1) colGroup.appendChild(mkRect(w.x, topH, colW, botH, 'var(--stencil-item-hover)'));
          if (i > 0) colGroup.appendChild(mkLine(w.x, topH, w.x, height, '0.3'));
          const wkLabel = showWeekNumber
            ? `W${weekNumberFor(w.start)}`
            : `${w.start.getDate()} ${MONTHS_SHORT[w.start.getMonth()]}`;
          colGroup.appendChild(mkText(w.x + colW / 2, topH + botH / 2,
            wkLabel, '10', '500', 'var(--text-secondary)'));
        });
      } else {
        // Month view: top row = years, bottom row = month names
        const months = [];
        const d = new Date(start);
        for (let i = 0; i < numPeriods; i++) {
          months.push({ month: d.getMonth(), year: d.getFullYear(), x: oX + i * colW });
          d.setMonth(d.getMonth() + 1);
        }

        // Group months by year for top row
        const yearSpans = [];
        let curYear2 = -1, spanStart2 = oX;
        months.forEach((m) => {
          if (m.year !== curYear2) {
            if (curYear2 >= 0) yearSpans.push({ year: curYear2, startX: spanStart2, endX: m.x });
            curYear2 = m.year; spanStart2 = m.x;
          }
        });
        if (curYear2 >= 0) yearSpans.push({ year: curYear2, startX: spanStart2, endX: width });

        // Draw year spans (top row)
        yearSpans.forEach((ys, i) => {
          const spanW = ys.endX - ys.startX;
          if (i % 2 === 1) colGroup.appendChild(mkRect(ys.startX, 0, spanW, topH, 'var(--stencil-item-hover)'));
          if (ys.startX > oX) colGroup.appendChild(mkLine(ys.startX, 0, ys.startX, height, '0.5'));
          colGroup.appendChild(mkText(ys.startX + spanW / 2, topH / 2, String(ys.year), '11', '700', 'var(--text-primary)'));
        });

        // Draw month labels (bottom row)
        months.forEach((m, i) => {
          if (i % 2 === 1) colGroup.appendChild(mkRect(m.x, topH, colW, botH, 'var(--stencil-item-hover)'));
          if (i > 0) colGroup.appendChild(mkLine(m.x, topH, m.x, height, '0.3'));
          colGroup.appendChild(mkText(m.x + colW / 2, topH + botH / 2, MONTHS_SHORT[m.month], '10', '500', 'var(--text-secondary)'));
        });
      }

      // Bottom border line below dates when there are no rows (empty timeline)
      if (rows.length === 0) {
        colGroup.appendChild(mkLine(0, dateH, width, dateH, '0.5'));
      }

      // ── Task list panel (left side) ──
      if (rows.length > 0) {
        // Task list background
        colGroup.appendChild(mkRect(0, 0, taskListWidth, height, 'var(--bg-surface-raised)'));
        // Divider between task list and timeline
        colGroup.appendChild(mkLine(taskListWidth, 0, taskListWidth, height, '1'));
        // Title in top row (always)
        colGroup.appendChild(mkText(taskListWidth / 2, topH / 2, model.get('timelineTitle') || 'Tasks', '11', '700', 'var(--text-primary)'));
        // Description: merged bottom-date-row + phase-row area (botH + phaseRowH)
        const desc = model.get('timelineDescription') || '';
        if (desc) {
          const descY = topH + 2;
          const descH = botH + phaseRowH - 4;
          const fo = document.createElementNS(SVG_NS, 'foreignObject');
          fo.setAttribute('x', '6');
          fo.setAttribute('y', String(descY));
          fo.setAttribute('width', String(taskListWidth - 12));
          fo.setAttribute('height', String(descH));
          fo.setAttribute('pointer-events', 'none');
          const div = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
          div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
          div.style.cssText = `font-size:9px;font-family:system-ui,-apple-system,sans-serif;color:var(--text-secondary);line-height:1.3;overflow:hidden;text-align:left;word-break:break-word;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;`;
          div.textContent = desc;
          fo.appendChild(div);
          colGroup.appendChild(fo);
        }
        // Horizontal header lines
        colGroup.appendChild(mkLine(0, topH, taskListWidth, topH, '0.3'));   // title / description separator (task list only)
        colGroup.appendChild(mkLine(taskListWidth, dateH, width, dateH, '0.3')); // dates/phase separator (timeline area only)
        colGroup.appendChild(mkLine(0, headerH, width, headerH, '0.5'));      // header/task-rows separator

        // ── Project Summary overview lane ──────────────────────────────────────────────────────────────────
        // A READ-ONLY condensation of the whole plan into ONE row: every group summary bar, milestone diamond,
        // and day-marker triangle for this timeline, drawn at their date columns. For a big Gantt it's a single
        // glance at the shape of the project. Purely derived SVG (no cells) → never selectable / draggable.
        if (summaryH) {
          const bandTop = dateH + phaseRowH;            // sits below the dates, above the first task row
          const groupsArr = (model.get('groups')) || [];
          colGroup.appendChild(mkRect(oX, bandTop, width - oX, summaryH, 'var(--stencil-item-hover)'));
          colGroup.appendChild(mkLine(0, bandTop, width, bandTop, '0.4'));   // separator above the lane
          const sumLabel = document.createElementNS(SVG_NS, 'text');
          sumLabel.setAttribute('x', '12'); sumLabel.setAttribute('y', String(bandTop + summaryH / 2));
          sumLabel.setAttribute('text-anchor', 'start'); sumLabel.setAttribute('dominant-baseline', 'central');
          sumLabel.setAttribute('font-size', '10'); sumLabel.setAttribute('font-weight', '700');
          sumLabel.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
          sumLabel.setAttribute('fill', 'var(--text-secondary)'); sumLabel.setAttribute('pointer-events', 'none');
          sumLabel.textContent = 'Timeline Summary'; colGroup.appendChild(sumLabel);
          const inGrid = (lx) => lx != null && lx >= oX - 0.5 && lx <= width + 0.5;
          const mkGlyph = (d, fill) => { const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); p.setAttribute('fill', fill); p.setAttribute('pointer-events', 'none'); return p; };
          // Milestones (amber diamond) + day markers (red triangle) share the TOP subrow (issue 3) — events read as the
          // headline of the summary, with the group spans stacked beneath them.
          const my = bandTop + 9;
          const g = model.graph;
          if (g) {
            for (const e of g.getElements()) {
              const t = e.get('type');
              if (t !== 'sf.GanttMilestone' && t !== 'sf.GanttMarker') continue;
              if (ganttTimelineFor(e) !== model) continue;
              const mx = dateToLocalX(model, t === 'sf.GanttMilestone' ? e.get('milestoneDate') : e.get('markerDate'));
              if (!inGrid(mx)) continue;
              if (t === 'sf.GanttMilestone') colGroup.appendChild(mkGlyph(`M ${mx} ${my - 6} L ${mx + 6} ${my} L ${mx} ${my + 6} L ${mx - 6} ${my} Z`, 'var(--brand-amber, #F6B355)'));
              else colGroup.appendChild(mkGlyph(`M ${mx - 6} ${my + 6} L ${mx + 6} ${my + 6} L ${mx} ${my - 6} Z`, 'var(--brand-red, #DA4E55)'));
              const lbl = e.attr('label/text');
              if (lbl) colGroup.appendChild(mkText(mx, my + 14, lbl, '9', '500', 'var(--text-secondary)'));   // issue 10: lane label
            }
          }
          // Each GROUP gets its OWN SUBROW (issue 2) below the marker row, so overlapping group spans never collide — a
          // read-only copy of its derived span + progress (`ganttGroupSummary`, the same source as the group rows).
          const gBase = bandTop + GANTT_SUMMARY_MARKER_H;
          groupsArr.forEach((grp, gi) => {
            const sum = ganttGroupSummary(model, grp.id);
            if (!sum) return;
            const x0 = Math.max(sum.x0, oX), x1 = Math.min(sum.x1, width);
            if (x1 <= x0) return;
            const gy = gBase + gi * GANTT_SUMMARY_GROUP_H + GANTT_SUMMARY_GROUP_H / 2;
            const col = grp.color || 'var(--gantt-phase-fill, #2A2D32)';
            const track = mkRect(x0, gy - 4, x1 - x0, 8, col);
            track.setAttribute('rx', '2'); track.setAttribute('opacity', '0.25'); colGroup.appendChild(track);
            const fillW = Math.round((x1 - x0) * sum.progress / 100);
            if (fillW > 0) { const fill = mkRect(x0, gy - 4, fillW, 8, col); fill.setAttribute('rx', '2'); colGroup.appendChild(fill); }
            // Group NAME at the bar's left edge (item 1) — OUTLINED (theme text fill + canvas-bg stroke via
            // paint-order) so it stays legible on any fill, in either theme, whether the bar is empty or completed.
            if (grp.label) {
              const t = document.createElementNS(SVG_NS, 'text');
              t.setAttribute('x', String(x0 + 5)); t.setAttribute('y', String(gy));
              t.setAttribute('text-anchor', 'start'); t.setAttribute('dominant-baseline', 'central');
              t.setAttribute('font-size', '9'); t.setAttribute('font-weight', '700');
              t.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
              t.setAttribute('fill', 'var(--text-primary)'); t.setAttribute('stroke', 'var(--bg-canvas, #1A1A1A)');
              t.setAttribute('stroke-width', '2.5'); t.setAttribute('paint-order', 'stroke');
              t.setAttribute('pointer-events', 'none'); t.textContent = grp.label;
              colGroup.appendChild(t);
            }
          });
        }

        // Row backgrounds + alternating stripes for timeline area
        rows.forEach((task, i) => {
          const rowY = task.rowY;
          // Alternating row stripe across full width
          if (i % 2 === 1) colGroup.appendChild(mkRect(0, rowY, width, rowHeight, 'var(--stencil-item-hover)'));
          // Separator line
          colGroup.appendChild(mkLine(0, rowY, width, rowY, '0.3'));

          if (task.type === 'group') {
            // Group row: color indicator + bold label
            if (task.color) {
              const indicator = document.createElementNS(SVG_NS, 'rect');
              indicator.setAttribute('x', '8');
              indicator.setAttribute('y', String(rowY + rowHeight / 2 - 5));
              indicator.setAttribute('width', '3');
              indicator.setAttribute('height', '10');
              indicator.setAttribute('rx', '1');
              indicator.setAttribute('fill', task.color);
              indicator.setAttribute('pointer-events', 'none');
              colGroup.appendChild(indicator);
            }

            const groupLabel = document.createElementNS(SVG_NS, 'text');
            groupLabel.setAttribute('x', task.color ? '16' : '8');
            groupLabel.setAttribute('y', String(rowY + rowHeight / 2));
            groupLabel.setAttribute('text-anchor', 'start');
            groupLabel.setAttribute('dominant-baseline', 'central');
            groupLabel.setAttribute('font-size', '11');
            groupLabel.setAttribute('font-weight', '700');
            groupLabel.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
            groupLabel.setAttribute('fill', 'var(--text-primary)');
            groupLabel.setAttribute('pointer-events', 'none');
            groupLabel.textContent = task.label || 'Group';
            colGroup.appendChild(groupLabel);

            // Auto summary/progress bar (Phase 6, item 5): the group row draws a bar spanning all its tasks
            // (min start → max end), filled by the duration-weighted % done, group-coloured — no separate shape
            // needed. Derived live from the member bars' dates/progress.
            const sum = ganttGroupSummary(model, task.groupId);
            if (sum) {
              const bx0 = Math.max(sum.x0, taskListWidth);
              const bx1 = Math.min(sum.x1, width);
              if (bx1 > bx0) {
                const barH = 10, by = rowY + rowHeight / 2 - barH / 2;
                const col = task.color || 'var(--gantt-phase-fill, #2A2D32)';
                const track = mkRect(bx0, by, bx1 - bx0, barH, col);
                track.setAttribute('rx', '3'); track.setAttribute('opacity', '0.22'); colGroup.appendChild(track);
                const fillW = Math.round((bx1 - bx0) * sum.progress / 100);
                if (fillW > 0) { const fill = mkRect(bx0, by, fillW, barH, col); fill.setAttribute('rx', '3'); colGroup.appendChild(fill); }
                if (bx1 + 34 < width) colGroup.appendChild(mkText(bx1 + 18, rowY + rowHeight / 2, `${sum.progress}%`, '10', '600', 'var(--text-secondary)'));
              }
            }
          } else {
            // Task row: indented text with optional color dot
            const indent = task.groupId ? 32 : 12;

            if (task.color) {
              const dot = document.createElementNS(SVG_NS, 'circle');
              dot.setAttribute('cx', String(indent));
              dot.setAttribute('cy', String(rowY + rowHeight / 2));
              dot.setAttribute('r', '3');
              dot.setAttribute('fill', task.color || 'var(--color-primary)');
              dot.setAttribute('pointer-events', 'none');
              colGroup.appendChild(dot);
            }

            const taskLabel = document.createElementNS(SVG_NS, 'text');
            taskLabel.setAttribute('x', String(task.color ? indent + 8 : indent));
            taskLabel.setAttribute('y', String(rowY + rowHeight / 2));
            taskLabel.setAttribute('text-anchor', 'start');
            taskLabel.setAttribute('dominant-baseline', 'central');
            taskLabel.setAttribute('font-size', '11');
            taskLabel.setAttribute('font-weight', '400');
            taskLabel.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
            taskLabel.setAttribute('fill', 'var(--text-secondary)');
            taskLabel.setAttribute('pointer-events', 'none');
            taskLabel.textContent = task.label || 'Task';
            colGroup.appendChild(taskLabel);
          }
        });
      }

      // ── Event lines: the timeline's today line + a dotted FULL-HEIGHT line at each marker / milestone, so an
      //    event reads across the whole timeline (down through the bars), not just where its glyph sits. ──
      const evtLine = (lx, color, dash) => {
        if (lx == null || lx < taskListWidth - 0.5 || lx > width + 0.5) return;
        const ln = document.createElementNS(SVG_NS, 'line');
        ln.setAttribute('x1', lx); ln.setAttribute('y1', 0); ln.setAttribute('x2', lx); ln.setAttribute('y2', height);
        ln.setAttribute('stroke', color); ln.setAttribute('stroke-width', '1.5');
        ln.setAttribute('stroke-dasharray', dash); ln.setAttribute('stroke-opacity', '0.8');
        ln.setAttribute('pointer-events', 'none');
        colGroup.appendChild(ln);
      };
      if (model.get('todayDate')) evtLine(dateToLocalX(model, model.get('todayDate')), 'var(--brand-red, #DA4E55)', '4 3');
      const graph = model.graph;
      if (graph) {
        for (const e of graph.getElements()) {
          const t = e.get('type');
          if (t === 'sf.GanttMarker') { if (ganttTimelineFor(e) === model) evtLine(dateToLocalX(model, e.get('markerDate')), 'var(--brand-red, #DA4E55)', '2 3'); }
          else if (t === 'sf.GanttMilestone') { if (ganttTimelineFor(e) === model) evtLine(dateToLocalX(model, e.get('milestoneDate')), 'var(--brand-amber, #F6B355)', '2 3'); }
        }
      }
    },
  });

  // --- GanttGroup ---
  // Summary / parent task bar with bracket indicators on either end.
  // Visually a darker bar with small downward prongs at each end.
  joint.dia.Element.define(
    'sf.GanttGroup',
    {
      size: { width: 360, height: 24 },
      z: 1000,
      groupId: null,   // Phase 6: when set to a timeline group's id, x+width AUTO-SPAN that group's tasks
      attrs: {
        body: {
          width: 'calc(w)',
          height: 8,
          y: 0,
          fill: 'var(--gantt-phase-fill, #2A2D32)',
          stroke: 'none',
        },
        leftProng: {
          d: 'M 0 0 L 0 8 L 6 0',
          fill: 'var(--gantt-phase-fill, #2A2D32)',
          stroke: 'none',
        },
        rightProng: {
          d: 'M 0 0 L 0 8 L -6 0',
          fill: 'var(--gantt-phase-fill, #2A2D32)',
          stroke: 'none',
          transform: 'translate(calc(w), 0)',
        },
        label: {
          x: 4,
          y: 16,
          textAnchor: 'start',
          textVerticalAnchor: 'top',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-primary)',
          text: 'Phase',
        },
      },
      ports: {
        groups: {
          left: {
            position: { name: 'left' },
            attrs: { circle: { r: 4, magnet: true, fill: '#2A2D32', stroke: '#FFFFFF', strokeWidth: 1.5 } },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
          right: {
            position: { name: 'right' },
            attrs: { circle: { r: 4, magnet: true, fill: '#2A2D32', stroke: '#FFFFFF', strokeWidth: 1.5 } },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
        },
        items: [
          { id: 'port-left', group: 'left' },
          { id: 'port-right', group: 'right' },
        ],
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'path', selector: 'leftProng' },
        { tagName: 'path', selector: 'rightProng' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

  // Custom view for GanttGroup — when `groupId` links it to a timeline group, x+width AUTO-SPAN that group's
  // tasks. Re-derives on any member's dates/membership change, on add/remove, and snaps x/width back after a
  // user drag/resize that ISN'T our own {gantt:true} layout move (so it reads as x-locked but Y-free, like a
  // derived bar). An UNLINKED group (no groupId) is freely manual (back-compat).
  joint.shapes.sf.GanttGroupView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      const reSpan = () => { if (this.model.get('groupId')) applyGanttGroupGeometry(this.model); };
      this.listenTo(this.model, 'change:groupId', reSpan);
      this.listenTo(this.model, 'change:position change:size', (m, val, opt) => { if (!(opt && opt.gantt)) reSpan(); });
      if (this.model.graph) {
        this.listenTo(this.model.graph, 'add remove change:startDate change:endDate change:groupId', (cell) => {
          if (cell && cell.get && cell.get('type') === 'sf.GanttTask') reSpan();
        });
      }
    },
  });

  // --- OrgPerson ---
  // Person card for organisation diagrams. Displays name, position, and optional
  // fields (email, phone, role, stream). Height adapts to visible fields.
  joint.dia.Element.define(
    'sf.OrgPerson',
    {
      size: { width: 280, height: 90 },
      z: 2000,
      personName: '',
      jobTitle: '',
      email: '',
      phone: '',
      role: '',
      stream: '',
      location: '',
      company: '',
      detailOrder: ['email', 'phone', 'role', 'stream', 'location', 'company'],
      // Extensible details list — replaces the hardcoded `email/phone/role/...`
      // fields. Entries render as `Label: Value` rows in the card body.
      // Pre-1.11 cells stored values on top-level fields (`email`, `phone`,
      // ...) ordered by `detailOrder`; the view auto-migrates those into this
      // array on first render. The legacy fields stay on the cell so old
      // exports keep working for users who roll back.
      details: [],      // [{ label, value }]
      imageUrl: '',     // data URI or URL for photo
      iconText: '',     // up to 4 letters shown in avatar circle
      tags: [],         // string[] — rendered as pills along bottom of card
      raci: {},         // { R?, A?, C?, I? } booleans — coloured pills top-right
      vacant: false,    // mark as recruitment placeholder: dashed borders + faded text
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          rx: 8,
          ry: 8,
          fill: 'var(--node-bg)',
          stroke: 'var(--node-border)',
          strokeWidth: 1.5,
        },
        accentBar: {
          width: 'calc(w)',
          height: 4,
          rx: 8,
          ry: 8,
          fill: '#1D73C9',
          stroke: 'none',
        },
        accentBarMask: {
          width: 'calc(w)',
          height: 2,
          y: 2,
          fill: '#1D73C9',
          stroke: 'none',
        },
        avatar: {
          r: 34,
          cx: 44,
          cy: 48,
          fill: '#E0E4E8',
          stroke: 'var(--node-border)',
          strokeWidth: 1,
        },
        avatarText: {
          x: 44,
          y: 48,
          textAnchor: 'middle',
          dominantBaseline: 'central',
          fontSize: 18,
          fontWeight: 700,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: '',
        },
        avatarImage: {
          x: 10,
          y: 14,
          width: 68,
          height: 68,
          href: '',
          opacity: 0,
        },
        avatarClip: {
          cx: 44,
          cy: 48,
          r: 34,
        },
        nameLabel: {
          x: 88,
          y: 14,
          textAnchor: 'start',
          dominantBaseline: 'hanging',
          fontSize: 13,
          fontWeight: 700,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--node-text)',
          text: 'Name',
        },
        positionLabel: {
          x: 88,
          y: 30,
          textAnchor: 'start',
          dominantBaseline: 'hanging',
          fontSize: 11,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: '',
        },
        detailsLabel: {
          x: 88,
          y: 46,
          textAnchor: 'start',
          dominantBaseline: 'hanging',
          fontSize: 10,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-muted)',
          text: '',
          lineHeight: 14,
        },
      },
      ports: {
        groups: {
          ...portGroups,
        },
        items: portItems,
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'rect', selector: 'accentBar' },
        { tagName: 'rect', selector: 'accentBarMask' },
        { tagName: 'clipPath', selector: 'avatarClipPath', attributes: { id: 'avatar-clip-placeholder' }, children: [
          { tagName: 'circle', selector: 'avatarClip' },
        ]},
        { tagName: 'circle', selector: 'avatar' },
        { tagName: 'image', selector: 'avatarImage' },
        { tagName: 'text', selector: 'avatarText' },
        { tagName: 'text', selector: 'nameLabel' },
        { tagName: 'text', selector: 'positionLabel' },
        { tagName: 'text', selector: 'detailsLabel' },
        { tagName: 'g', selector: 'raciGroup' },
        { tagName: 'g', selector: 'tagsGroup' },
      ],
    }
  );

  // Custom view for OrgPerson — updates display based on model properties
  joint.shapes.sf.OrgPersonView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      this.listenTo(this.model, 'change:personName change:jobTitle change:email change:phone change:role change:stream change:location change:company change:detailOrder change:details change:imageUrl change:iconText change:tags change:raci change:vacant', () => this._updateCard());
    },
    render() {
      joint.dia.ElementView.prototype.render.apply(this, arguments);
      this._updateCard();
      return this;
    },
    update() {
      joint.dia.ElementView.prototype.update.apply(this, arguments);
      this._updateCard();
    },
    _updateCard() {
      const m = this.model;
      const name = m.get('personName') || 'Name';
      const pos = m.get('jobTitle') || '';
      // Description supports multi-line via newlines. Each line renders as its
      // own <tspan> so wrapping survives JointJS' silent-attr round-trip.
      const posLines = pos ? pos.split(/\n/) : [];
      const POS_LINE_H = 14;
      const POS_GAP = 12; // gap below last description line; bumped from 8 to
                          // sit comfortably under Safari's hanging-baseline
                          // text metrics, which run a hair lower than Chrome's
      const email = m.get('email') || '';
      const phone = m.get('phone') || '';
      const role = m.get('role') || '';
      const stream = m.get('stream') || '';
      const location = m.get('location') || '';
      const company = m.get('company') || '';
      const imageUrl = m.get('imageUrl') || '';
      const iconText = (m.get('iconText') || '').substring(0, 4);
      const hasPhoto = !!imageUrl;
      const hasCustomAvatar = hasPhoto || !!iconText;
      const tags = Array.isArray(m.get('tags')) ? m.get('tags').filter(Boolean) : [];
      const raci = m.get('raci') || {};
      const vacant = !!m.get('vacant');
      const TAG_ROW_H = 30; // pill row + 8px bottom margin

      // Standard avatar layout — consistent size for all persons
      // Padding from left border = padding from accent bar bottom (y=4)
      const PAD = 10;
      const avatarR = 34;
      const avatarCx = PAD + avatarR;   // 44 — left edge at 10
      const avatarCy = 4 + PAD + avatarR; // 48 — top edge at 14
      const textX = avatarCx + avatarR + PAD; // 88
      // Align name top with avatar top edge
      const nameY = avatarCy - avatarR;  // 14

      m.attr('avatar/r', avatarR, { silent: true });
      m.attr('avatar/cx', avatarCx, { silent: true });
      m.attr('avatar/cy', avatarCy, { silent: true });
      m.attr('avatarClip/r', avatarR, { silent: true });
      m.attr('avatarClip/cx', avatarCx, { silent: true });
      m.attr('avatarClip/cy', avatarCy, { silent: true });
      // Detail block sits below name + (multi-line) description. Cached so
      // height calc, silent attrs, and direct-DOM updates all agree.
      const detailStartY = pos
        ? nameY + 16 + posLines.length * POS_LINE_H + POS_GAP
        : nameY + 16;
      m.attr('nameLabel/x', textX, { silent: true });
      m.attr('nameLabel/y', nameY, { silent: true });
      m.attr('positionLabel/x', textX, { silent: true });
      m.attr('positionLabel/y', nameY + 16, { silent: true });
      m.attr('detailsLabel/x', textX, { silent: true });
      m.attr('detailsLabel/y', detailStartY, { silent: true });

      // Avatar text — icon text or name initials
      let displayText;
      if (hasPhoto) {
        displayText = '';
      } else if (iconText) {
        displayText = iconText;
        m.attr('avatar/fill', '#1D73C9', { silent: true });
        m.attr('avatarText/fill', '#FFFFFF', { silent: true });
        m.attr('avatarText/fontSize', iconText.length > 2 ? 14 : 18, { silent: true });
      } else {
        displayText = name.split(/\s+/).map(w => w[0]).join('').substring(0, 2).toUpperCase();
        m.attr('avatar/fill', '#E0E4E8', { silent: true });
        m.attr('avatarText/fill', 'var(--text-secondary)', { silent: true });
        m.attr('avatarText/fontSize', 18, { silent: true });
      }

      m.attr('avatarText/text', displayText, { silent: true });
      m.attr('avatarText/x', avatarCx, { silent: true });
      m.attr('avatarText/y', avatarCy, { silent: true });
      m.attr('nameLabel/text', name, { silent: true });
      m.attr('positionLabel/text', pos, { silent: true });

      // Image handling
      m.attr('avatarImage/opacity', hasPhoto ? 1 : 0, { silent: true });
      if (hasPhoto) {
        const imgSize = avatarR * 2;
        m.attr('avatarImage/x', avatarCx - avatarR, { silent: true });
        m.attr('avatarImage/y', avatarCy - avatarR, { silent: true });
        m.attr('avatarImage/width', imgSize, { silent: true });
        m.attr('avatarImage/height', imgSize, { silent: true });
        m.attr('avatarImage/href', imageUrl, { silent: true });
        m.attr('avatar/fill', 'transparent', { silent: true });
      }

      // Detail labels — built from the new `details` array (since v1.11).
      // Pre-v1.11 cells used hardcoded fields (email/phone/role/stream/...) ordered
      // by `detailOrder`. The view auto-migrates them into `details` on first
      // render so subsequent saves use the new shape; the legacy fields stay
      // on the cell untouched for forward-compat with rollbacks.
      const DETAIL_LABELS = { email: 'Email', phone: 'Phone', role: 'Role', stream: 'Stream', location: 'Location', company: 'Company' };
      const fieldValues = { email, phone, role, stream, location, company };
      let detailEntries = m.get('details');
      if (!Array.isArray(detailEntries) || detailEntries.length === 0) {
        const order = m.get('detailOrder') || ['email', 'phone', 'role', 'stream', 'location', 'company'];
        const migrated = order.map(key => ({
          label: DETAIL_LABELS[key] || key,
          value: fieldValues[key] || '',
        }));
        // Persist the migration so it ships into the next save / share.
        if (migrated.some(d => d.value)) {
          m.set('details', migrated, { silent: true });
          detailEntries = migrated;
        } else {
          detailEntries = [];
        }
      }
      // Hide entries with empty values (current behaviour).
      const details = detailEntries
        .filter(d => d && d.value && String(d.value).trim() !== '')
        .map(d => ({ label: String(d.label ?? ''), value: String(d.value ?? '') }));

      // Wrap each detail VALUE to the value-column width so long text shows in FULL (no ellipsis); the card
      // then grows in height to fit. Width is forced to >= 280 below, so wrap against that final width.
      const labelW = 52;   // value column starts at textX + labelW
      const valMaxChars = Math.max(6, Math.floor((Math.max(m.size().width, 280) - textX - 10 - labelW) / 5.5));
      const wrapValue = (text) => {
        const words = String(text).split(/\s+/).filter(Boolean);
        if (!words.length) return [''];
        const lines = []; let line = '';
        for (let w of words) {
          while (w.length > valMaxChars) {                       // a single over-long token: hard-break it
            if (line) { lines.push(line); line = ''; }
            lines.push(w.slice(0, valMaxChars)); w = w.slice(valMaxChars);
          }
          const next = line ? line + ' ' + w : w;
          if (next.length > valMaxChars && line) { lines.push(line); line = w; }
          else line = next;
        }
        if (line) lines.push(line);
        return lines.length ? lines : [''];
      };
      const detailWrapped = details.map(d => ({ label: d.label, value: d.value, lines: wrapValue(d.value) }));

      // Adapt height — auto-size based on content. Tag row, when present,
      // sits at the very bottom and adds a fixed extra slice. Each wrapped value line is 14px.
      const detailH = detailWrapped.reduce((s, d) => s + d.lines.length, 0) * 14;
      const contentH = detailStartY + detailH + 10;
      const avatarBottom = avatarCy + avatarR + 8;
      const tagsExtraH = tags.length > 0 ? TAG_ROW_H : 0;
      const totalH = Math.max(contentH, avatarBottom, 60) + tagsExtraH;
      let { width, height } = m.size();
      let sizeChanged = false;
      if (width < 280) { width = 280; sizeChanged = true; }
      if (Math.abs(height - totalH) > 1) { height = totalH; sizeChanged = true; }
      if (sizeChanged) {
        m.resize(width, height, { silent: true });
      }

      // Sync size-dependent SVG elements via direct DOM
      const bodyRect = this.el.querySelector('[joint-selector="body"]');
      if (bodyRect) {
        bodyRect.setAttribute('width', String(width));
        bodyRect.setAttribute('height', String(height));
      }
      const barEl = this.el.querySelector('[joint-selector="accentBar"]');
      if (barEl) barEl.setAttribute('width', String(width));
      const barMask = this.el.querySelector('[joint-selector="accentBarMask"]');
      if (barMask) barMask.setAttribute('width', String(width));

      // Force SVG update — direct DOM manipulation since attrs are set silently
      const nameEl = this.el.querySelector('[joint-selector="nameLabel"]');
      if (nameEl) {
        nameEl.textContent = name;
        nameEl.setAttribute('x', String(textX));
        nameEl.setAttribute('y', String(nameY));
        nameEl.setAttribute('dominant-baseline', 'hanging');
        // JointJS' renderer occasionally stamps `display="none"` on text
        // elements that were updated via silent attrs; clear it explicitly.
        nameEl.removeAttribute('display');
      }
      const avatarTextEl = this.el.querySelector('[joint-selector="avatarText"]');
      if (avatarTextEl) {
        avatarTextEl.textContent = displayText;
        avatarTextEl.setAttribute('x', String(avatarCx));
        avatarTextEl.setAttribute('y', String(avatarCy));
        const fs = hasPhoto ? 18 : iconText ? (iconText.length > 2 ? 14 : 18) : 18;
        avatarTextEl.setAttribute('font-size', String(fs));
      }
      const avatarEl = this.el.querySelector('[joint-selector="avatar"]');
      if (avatarEl) {
        avatarEl.setAttribute('r', String(avatarR));
        avatarEl.setAttribute('cx', String(avatarCx));
        avatarEl.setAttribute('cy', String(avatarCy));
        const fillColor = hasPhoto ? 'transparent' : iconText ? '#1D73C9' : '#E0E4E8';
        avatarEl.setAttribute('fill', fillColor);
      }
      const posEl = this.el.querySelector('[joint-selector="positionLabel"]');
      if (posEl) {
        // Clear and rebuild as tspans so newlines wrap correctly. SVG <text>
        // collapses literal \n to a space, so single-line textContent loses
        // multi-line descriptions entirely.
        posEl.textContent = '';
        posEl.setAttribute('x', String(textX));
        posEl.setAttribute('y', String(nameY + 16));
        posEl.setAttribute('dominant-baseline', 'hanging');
        posEl.removeAttribute('display');
        posLines.forEach((line, i) => {
          const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          tspan.setAttribute('x', String(textX));
          // Absolute y per line. Safari ignores the parent's
          // `dominant-baseline="hanging"` for the first tspan when only `dy`
          // is set, falling back to alphabetic — that pulls the first line up
          // ~9 px and overlaps the name. Setting `y` and re-asserting the
          // hanging baseline on every tspan keeps Chrome and Safari aligned.
          tspan.setAttribute('y', String(nameY + 16 + i * POS_LINE_H));
          tspan.setAttribute('dominant-baseline', 'hanging');
          tspan.textContent = line;
          posEl.appendChild(tspan);
        });
      }

      // Avatar image + clip path
      const clipPathEl = this.el.querySelector('[joint-selector="avatarClipPath"]');
      const imgEl = this.el.querySelector('[joint-selector="avatarImage"]');
      if (clipPathEl && imgEl) {
        const clipId = `avatar-clip-${m.id}`;
        clipPathEl.setAttribute('id', clipId);
        const clipCircle = clipPathEl.querySelector('circle');
        if (clipCircle) {
          clipCircle.setAttribute('cx', String(avatarCx));
          clipCircle.setAttribute('cy', String(avatarCy));
          clipCircle.setAttribute('r', String(avatarR));
        }
        imgEl.setAttribute('clip-path', `url(#${clipId})`);
        if (hasPhoto) {
          const imgSize = avatarR * 2;
          imgEl.setAttribute('x', String(avatarCx - avatarR));
          imgEl.setAttribute('y', String(avatarCy - avatarR));
          imgEl.setAttribute('width', String(imgSize));
          imgEl.setAttribute('height', String(imgSize));
          imgEl.setAttribute('href', imageUrl);
          imgEl.style.opacity = '1';
        } else {
          imgEl.style.opacity = '0';
        }
      }

      // Details — labels aligned, values WRAP onto extra lines (computed above as detailWrapped) so nothing
      // is truncated; the card height already accounts for the wrapped line count.
      const detailEl = this.el.querySelector('[joint-selector="detailsLabel"]');
      if (detailEl) {
        detailEl.textContent = '';
        detailEl.setAttribute('x', String(textX));
        detailEl.setAttribute('y', String(detailStartY));
        detailEl.setAttribute('dominant-baseline', 'hanging');
        detailEl.removeAttribute('display');
        detailWrapped.forEach((d, i) => {
          // Label tspan (muted) — shares the value's FIRST line.
          const labelSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          labelSpan.setAttribute('x', String(textX));
          labelSpan.setAttribute('dy', i === 0 ? '0' : '14');
          labelSpan.setAttribute('fill', 'var(--text-muted)');
          labelSpan.textContent = d.label + ':';
          detailEl.appendChild(labelSpan);
          // Value — one tspan per wrapped line; the first shares the label's line, the rest drop down 14px.
          d.lines.forEach((ln, li) => {
            const valSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            valSpan.setAttribute('x', String(textX + labelW));
            valSpan.setAttribute('dy', li === 0 ? '0' : '14');
            valSpan.setAttribute('fill', 'var(--text-secondary)');
            valSpan.textContent = ln;
            detailEl.appendChild(valSpan);
          });
        });
      }

      // ── Vacant state ────────────────────────────────────────
      // Dashed body + dashed/transparent avatar + faded text. Used as a
      // recruitment placeholder ("position to be filled") or a RACI slot
      // that hasn't been assigned yet.
      const bodyEl = this.el.querySelector('[joint-selector="body"]');
      if (bodyEl) {
        if (vacant) bodyEl.setAttribute('stroke-dasharray', '6 4');
        else bodyEl.removeAttribute('stroke-dasharray');
      }
      if (avatarEl) {
        if (vacant) {
          avatarEl.setAttribute('stroke-dasharray', '4 3');
          avatarEl.setAttribute('fill', 'transparent');
        } else {
          avatarEl.removeAttribute('stroke-dasharray');
          // (fill is set above based on photo/iconText state — restored on
          // toggle-off via the existing avatar-fill logic in this same pass)
        }
      }
      if (avatarTextEl) avatarTextEl.style.opacity = vacant ? '0.5' : '1';
      if (nameEl) nameEl.style.opacity = vacant ? '0.55' : '1';
      if (posEl) posEl.style.opacity = vacant ? '0.55' : '1';
      const detailLblEl = this.el.querySelector('[joint-selector="detailsLabel"]');
      if (detailLblEl) detailLblEl.style.opacity = vacant ? '0.55' : '1';

      // ── RACI pills (top-right) ──────────────────────────────
      // Each active role is a coloured letter pill with a <title> tooltip
      // for the full name. Pills only render when their role is set.
      const raciGroupEl = this.el.querySelector('[joint-selector="raciGroup"]');
      if (raciGroupEl) {
        raciGroupEl.innerHTML = '';
        const RACI_COLORS = { R: '#1D73C9', A: '#DA4E55', C: '#F6B355', I: '#8A9099' };
        const RACI_NAMES = { R: 'Responsible', A: 'Accountable', C: 'Consulted', I: 'Informed' };
        const active = ['R', 'A', 'C', 'I'].filter(k => raci[k]);
        if (active.length > 0) {
          const PILL = 16;
          const GAP = 3;
          const ns = 'http://www.w3.org/2000/svg';
          // Right-aligned, sitting just below the accent bar
          let xPos = width - 10 - active.length * PILL - (active.length - 1) * GAP;
          const yPos = 10;
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

      // ── Tag pills (bottom row, full width, single line + ellipsis) ──
      // Background uses a theme-neutral semi-transparent grey — `var(--*)`
      // resolves unreliably when set via setAttribute, so a literal rgba
      // gives consistent pills in both light and dark modes.
      const tagsGroupEl = this.el.querySelector('[joint-selector="tagsGroup"]');
      if (tagsGroupEl) {
        tagsGroupEl.innerHTML = '';
        if (tags.length > 0) {
          const ns = 'http://www.w3.org/2000/svg';
          const PILL_H = 18;
          const PILL_PAD = 10;
          const GAP = 4;
          const FONT = 10;
          const PILL_FILL = 'rgba(127, 127, 127, 0.22)';
          const startX = 10;
          const yPos = totalH - PILL_H - 8;
          const maxX = width - 10;
          let curX = startX;
          for (let i = 0; i < tags.length; i++) {
            const tag = tags[i];
            const textW = Math.ceil(tag.length * 5.5);
            const pillW = textW + PILL_PAD * 2;
            if (curX + pillW > maxX && curX > startX) {
              const ellipsis = document.createElementNS(ns, 'g');
              const r = document.createElementNS(ns, 'rect');
              r.setAttribute('x', String(curX));
              r.setAttribute('y', String(yPos));
              r.setAttribute('width', '24');
              r.setAttribute('height', String(PILL_H));
              r.setAttribute('rx', '9');
              r.setAttribute('ry', '9');
              r.setAttribute('fill', PILL_FILL);
              ellipsis.appendChild(r);
              const t = document.createElementNS(ns, 'text');
              t.setAttribute('x', String(curX + 12));
              t.setAttribute('y', String(yPos + PILL_H / 2));
              t.setAttribute('text-anchor', 'middle');
              t.setAttribute('dominant-baseline', 'central');
              t.setAttribute('fill', 'var(--text-secondary)');
              t.setAttribute('font-size', String(FONT));
              t.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
              t.textContent = `+${tags.length - i}`;
              ellipsis.appendChild(t);
              const title = document.createElementNS(ns, 'title');
              title.textContent = tags.slice(i).join(', ');
              ellipsis.appendChild(title);
              tagsGroupEl.appendChild(ellipsis);
              break;
            }
            const g = document.createElementNS(ns, 'g');
            const rect = document.createElementNS(ns, 'rect');
            rect.setAttribute('x', String(curX));
            rect.setAttribute('y', String(yPos));
            rect.setAttribute('width', String(pillW));
            rect.setAttribute('height', String(PILL_H));
            rect.setAttribute('rx', '9');
            rect.setAttribute('ry', '9');
            rect.setAttribute('fill', PILL_FILL);
            g.appendChild(rect);
            const text = document.createElementNS(ns, 'text');
            // Centred horizontally + vertically inside the pill.
            text.setAttribute('x', String(curX + pillW / 2));
            text.setAttribute('y', String(yPos + PILL_H / 2));
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'central');
            text.setAttribute('fill', 'var(--text-secondary)');
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

  // --- Task ---
  // RACI workflow row: two-column card. Left column holds the task name +
  // description. Right column accepts embedded Person/Team cards (auto-stacks
  // vertically on drop). Each embedded card carries its own RACI pills, so
  // the Task itself doesn't need separate R/A/C/I slots.
  joint.dia.Element.define(
    'sf.Task',
    {
      size: { width: 540, height: 160 },
      // Canonical layer is Z_BASE['sf.Task'] = 500 (the "containers" tier) — below
      // Container/Team (1000) AND Person (2000) so embedded RACI cards always render
      // ABOVE the Task body, and the canvas change:z guard restores it there after a
      // drag. This literal is just the pre-canvas fallback (the add-listener reassigns
      // a fresh drop into the tier); kept in-tier so it never strands the card on top.
      z: 500,
      taskName: 'Task',
      taskDescription: '',
      // Width of the LEFT column (name + description). Stays fixed when the
      // task is resized — the right column grows instead. User can override
      // explicitly via the "Task description width" property panel input.
      descriptionWidth: 260,
      attrs: {
        body: {
          x: 0, y: 0,
          width: 'calc(w)',
          height: 'calc(h)',
          rx: 8,
          ry: 8,
          fill: 'var(--node-bg)',
          stroke: 'var(--node-border)',
          strokeWidth: 1.5,
        },
        rightBg: {
          // x / width are set by TaskView from descriptionWidth (defaults
          // here are placeholders — the view overrides them on render).
          x: 260,
          y: 1,
          width: 'calc(w - 261)',
          height: 'calc(h - 2)',
          rx: 7,
          ry: 7,
          fill: 'rgba(127, 127, 127, 0.04)',
          stroke: 'none',
        },
        divider: {
          x1: 260,
          y1: 12,
          x2: 260,
          y2: 'calc(h - 12)',
          stroke: 'var(--node-border)',
          strokeWidth: 1,
        },
        nameLabel: {
          x: 16,
          y: 16,
          textAnchor: 'start',
          textVerticalAnchor: 'top',
          fontSize: 14,
          fontWeight: 700,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--node-text)',
          text: 'Task',
          textWrap: { width: 232, maxLineCount: 3, ellipsis: true },
        },
        descLabel: {
          x: 16,
          y: 60,
          textAnchor: 'start',
          textVerticalAnchor: 'top',
          fontSize: 11,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: '',
          textWrap: { width: 232, maxLineCount: 8, ellipsis: true },
        },
        emptyHint: {
          x: 400,
          y: 'calc(0.5 * h)',
          textAnchor: 'middle',
          dominantBaseline: 'central',
          fontSize: 11,
          fontStyle: 'italic',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-muted)',
          text: 'Drop a person or team',
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
        { tagName: 'rect', selector: 'rightBg' },
        { tagName: 'line', selector: 'divider' },
        { tagName: 'text', selector: 'nameLabel' },
        { tagName: 'text', selector: 'descLabel' },
        { tagName: 'text', selector: 'emptyHint' },
      ],
    }
  );

  // Custom view for Task — syncs label text + textWrap widths to
  // descriptionWidth, auto-stacks embedded Person/Team cards in the right
  // column, and grows the task height when children overflow.
  joint.shapes.sf.TaskView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      this.listenTo(this.model, 'change:taskName change:taskDescription', () => this._updateLabels());
      this.listenTo(this.model, 'change:descriptionWidth change:size', () => { this._updateLayout(); this._restackEmbeds(); });
      this.listenTo(this.model, 'change:embeds change:position', () => this._restackEmbeds());
    },
    render() {
      joint.dia.ElementView.prototype.render.apply(this, arguments);
      this._updateLayout();
      this._updateLabels();
      this._restackEmbeds();
      return this;
    },
    update() {
      joint.dia.ElementView.prototype.update.apply(this, arguments);
      this._updateLabels();
    },
    /** Read descriptionWidth, clamp to a sensible range given current size. */
    _effectiveDescWidth() {
      const m = this.model;
      const sz = m.size();
      const raw = m.get('descriptionWidth') ?? 260;
      // Always leave at least 100 px for the right column.
      return Math.max(120, Math.min(sz.width - 100, raw));
    },
    _updateLayout() {
      const m = this.model;
      const sz = m.size();
      const dw = this._effectiveDescWidth();
      m.attr('divider/x1', dw, { silent: true });
      m.attr('divider/x2', dw, { silent: true });
      m.attr('rightBg/x', dw, { silent: true });
      m.attr('rightBg/width', sz.width - dw - 1, { silent: true });
      m.attr('emptyHint/x', dw + (sz.width - dw) / 2, { silent: true });
      const wrapW = Math.max(40, dw - 28);
      m.attr('nameLabel/textWrap/width', wrapW, { silent: true });
      m.attr('descLabel/textWrap/width', wrapW, { silent: true });
    },
    _updateLabels() {
      const m = this.model;
      m.attr('nameLabel/text', m.get('taskName') || 'Task', { silent: true });
      m.attr('descLabel/text', m.get('taskDescription') || '', { silent: true });
      const hasChildren = (m.get('embeds') || []).length > 0;
      m.attr('emptyHint/visibility', hasChildren ? 'hidden' : 'visible', { silent: true });
      const hintEl = this.el.querySelector('[joint-selector="emptyHint"]');
      if (hintEl) hintEl.style.visibility = hasChildren ? 'hidden' : 'visible';
    },
    _restackEmbeds() {
      // Task captures children like a Zone — they are embedded so they move
      // together when the Task is dragged, but their positions stay where
      // the user dropped them. (Auto-stacking previously implemented here
      // was removed in 1.10.3 because it constrained users who wanted to
      // arrange RACI assignees freely inside the right column.)
      const task = this.model;
      const hasChildren = (task.get('embeds') || []).length > 0;
      const hintEl = this.el.querySelector('[joint-selector="emptyHint"]');
      if (hintEl) hintEl.style.visibility = hasChildren ? 'hidden' : 'visible';
    },
  });

  // --- TaskGroup ---
  // RACI section: a dashed grouping frame (Zone-like) that holds multiple Task
  // cards so related RACI rows can be organised into labelled sections. Grey
  // accent distinguishes it from the blue Department zone. Sits in the Zone z-tier
  // (0) so it stays BEHIND its embedded Tasks (z 500). Its only valid child is a
  // Task (see canEmbed) — the Tasks carry their own Person/Team assignees.
  joint.dia.Element.define(
    'sf.TaskGroup',
    {
      size: { width: 640, height: 360 },
      z: 0,       // Zone tier: 0 – 499 (always behind Tasks and their cards)
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          rx: 8,
          ry: 8,
          fill: 'rgba(138, 144, 153, 0.06)',
          stroke: '#8A9099',
          strokeWidth: 1,
          strokeDasharray: '8 4',
        },
        label: {
          x: 12,
          y: 18,
          textAnchor: 'start',
          textVerticalAnchor: 'middle',
          fontSize: 12,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-muted)',
          fontWeight: '700',
          text: 'Task Group',
          textWrap: { width: 'calc(w - 28)', maxLineCount: 1, ellipsis: true },
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

  // --- SequenceParticipant ---
  // A UML sequence diagram participant: a rounded header rectangle with an
  // icon + label, and a dashed vertical lifeline extending to the element's
  // full height. Ports are placed on the left/right edges at multiple vertical
  // positions so messages can connect at different points along the lifeline.
  //
  // Port count along the lifeline is user-configurable via `lifelinePortCount`
  // (default 5). Rebuild via joint.shapes.sf.rebuildSeqParticipantPorts(cell, n).
  {
    const DEFAULT_PORT_COUNT = 5;
    const seqPortItems = buildSeqParticipantPorts(DEFAULT_PORT_COUNT);

    joint.dia.Element.define(
      'sf.SequenceParticipant',
      {
        size: { width: 140, height: 360 },
        z: 2000,
        participantRole: 'generic', // generic | salesforce | api | external | actor
        lifelinePortCount: DEFAULT_PORT_COUNT,
        showBottomLabel: true,
        attrs: {
          header: {
            x: 0,
            y: 0,
            width: 'calc(w)',
            height: 48,
            rx: 6,
            ry: 6,
            fill: 'var(--node-bg)',
            stroke: 'var(--node-border)',
            strokeWidth: 1,
          },
          headerAccent: {
            x: 0,
            y: 0,
            width: 'calc(w)',
            height: 6,
            rx: 6,
            ry: 6,
            fill: 'var(--color-primary)',
          },
          icon: {
            x: 10,
            y: 14,
            width: 20,
            height: 20,
            href: '',
            visibility: 'hidden',
          },
          label: {
            x: 'calc(0.5 * w)',
            y: 26,
            textAnchor: 'middle',
            textVerticalAnchor: 'middle',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fill: 'var(--node-text)',
            text: 'Participant',
            textWrap: { width: 'calc(w - 16)', maxLineCount: 2, ellipsis: true },
          },
          underline: {
            x1: 8,
            y1: 42,
            x2: 'calc(w - 8)',
            y2: 42,
            stroke: 'var(--node-text)',
            strokeWidth: 1,
            opacity: 0.4,
          },
          lifelineHitbox: {
            // Wide invisible strip around the dashed lifeline — larger touch/
            // click target than the thin dashed line alone so users can select
            // the participant without having to land exactly on the stroke.
            // Width covers both seq-left (-8px) and seq-right (+8px) port
            // positions with a few px of margin for the port circle radius.
            x: 'calc(0.5 * w - 16)',
            y: 48,
            width: 32,
            height: 'calc(h - 48)',
            fill: 'transparent',
            stroke: 'none',
            cursor: 'move',
          },
          lifeline: {
            x1: 'calc(0.5 * w)',
            y1: 48,
            x2: 'calc(0.5 * w)',
            y2: 'calc(h)',
            stroke: 'var(--node-border)',
            strokeWidth: 1.5,
            strokeDasharray: '6 4',
            pointerEvents: 'none',
          },
          // ── Bottom header (mirror of the top header). UML convention places
          // a matching participant label at the foot of the lifeline so the
          // reader can identify who a long lifeline belongs to without having
          // to scroll back up. Mirrors all top-header attrs by default and
          // syncs on label/role/accent changes. Toggle via showBottomLabel.
          headerBottom: {
            x: 0,
            y: 'calc(h - 48)',
            width: 'calc(w)',
            height: 48,
            rx: 6,
            ry: 6,
            fill: 'var(--node-bg)',
            stroke: 'var(--node-border)',
            strokeWidth: 1,
          },
          headerBottomAccent: {
            x: 0,
            y: 'calc(h - 6)',
            width: 'calc(w)',
            height: 6,
            rx: 6,
            ry: 6,
            fill: 'var(--color-primary)',
          },
          labelBottom: {
            x: 'calc(0.5 * w)',
            y: 'calc(h - 22)',
            textAnchor: 'middle',
            textVerticalAnchor: 'middle',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fill: 'var(--node-text)',
            text: 'Participant',
            textWrap: { width: 'calc(w - 16)', maxLineCount: 2, ellipsis: true },
          },
          underlineBottom: {
            x1: 8,
            y1: 'calc(h - 6)',
            x2: 'calc(w - 8)',
            y2: 'calc(h - 6)',
            stroke: 'var(--node-text)',
            strokeWidth: 1,
            opacity: 0.4,
          },
        },
        ports: {
          groups: {
            'seq-left': { attrs: portAttrs, markup: portMarkup },
            'seq-right': { attrs: portAttrs, markup: portMarkup },
          },
          items: seqPortItems,
        },
      },
      {
        markup: [
          { tagName: 'rect', selector: 'lifelineHitbox' },
          { tagName: 'line', selector: 'lifeline' },
          { tagName: 'rect', selector: 'header' },
          { tagName: 'rect', selector: 'headerAccent' },
          { tagName: 'image', selector: 'icon' },
          { tagName: 'text', selector: 'label' },
          { tagName: 'line', selector: 'underline' },
          { tagName: 'rect', selector: 'headerBottom' },
          { tagName: 'rect', selector: 'headerBottomAccent' },
          { tagName: 'text', selector: 'labelBottom' },
          { tagName: 'line', selector: 'underlineBottom' },
        ],
      }
    );
  }

  // --- SequenceActor ---
  // UML actor participant — a stick figure on top of a label. Can optionally
  // draw a dashed lifeline below the figure (toggled via `showLifeline`); the
  // lifeline is HIDDEN by default since UML actors often sit outside the
  // sequence interaction and users prefer to opt in.
  {
    const DEFAULT_PORT_COUNT = 5;
    // Empty port list by default: ports are generated on demand when the user
    // switches the lifeline on (via setActorLifelineVisible).
    const actorPortItems = [];

    joint.dia.Element.define(
      'sf.SequenceActor',
      {
        // Short by default — just stick figure + label. When the user enables
        // the lifeline the shape auto-resizes to DEFAULT_SIZES height (340).
        size: { width: 100, height: 92 },
        z: 2000,
        participantRole: 'actor',
        lifelinePortCount: DEFAULT_PORT_COUNT,
        showLifeline: false,
        attrs: {
          actorHitbox: {
            // Invisible hit target that spans the stick figure + label — makes
            // selection easy (stick figure lines alone are thin and hard to hit).
            x: 0,
            y: 0,
            width: 'calc(w)',
            height: 92,
            fill: 'transparent',
            stroke: 'none',
            cursor: 'move',
          },
          actorHead: {
            cx: 'calc(0.5 * w)',
            cy: 14,
            r: 10,
            fill: 'none',
            stroke: 'var(--node-text)',
            strokeWidth: 1.5,
            pointerEvents: 'none',
          },
          actorBody: {
            x1: 'calc(0.5 * w)',
            y1: 24,
            x2: 'calc(0.5 * w)',
            y2: 48,
            stroke: 'var(--node-text)',
            strokeWidth: 1.5,
            pointerEvents: 'none',
          },
          actorArms: {
            x1: 'calc(0.5 * w - 14)',
            y1: 32,
            x2: 'calc(0.5 * w + 14)',
            y2: 32,
            stroke: 'var(--node-text)',
            strokeWidth: 1.5,
            pointerEvents: 'none',
          },
          actorLegLeft: {
            x1: 'calc(0.5 * w)',
            y1: 48,
            x2: 'calc(0.5 * w - 10)',
            y2: 64,
            stroke: 'var(--node-text)',
            strokeWidth: 1.5,
            pointerEvents: 'none',
          },
          actorLegRight: {
            x1: 'calc(0.5 * w)',
            y1: 48,
            x2: 'calc(0.5 * w + 10)',
            y2: 64,
            stroke: 'var(--node-text)',
            strokeWidth: 1.5,
            pointerEvents: 'none',
          },
          label: {
            x: 'calc(0.5 * w)',
            y: 78,
            textAnchor: 'middle',
            textVerticalAnchor: 'middle',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fill: 'var(--node-text)',
            text: 'Actor',
            textWrap: { width: 'calc(w)', maxLineCount: 2, ellipsis: true },
            pointerEvents: 'none',
          },
          lifelineHitbox: {
            // Wide invisible strip around the dashed lifeline — larger touch/
            // click target than the thin dashed line alone so users can select
            // the actor's lifeline without having to land exactly on the stroke.
            // Width covers both seq-left (-8px) and seq-right (+8px) port
            // positions with a few px of margin for the port circle radius.
            // Hidden by default to match `showLifeline: false`; the
            // setActorLifelineVisible helper flips visibility + magnet when
            // users opt in.
            x: 'calc(0.5 * w - 16)',
            y: 92,
            width: 32,
            height: 'calc(h - 92)',
            fill: 'transparent',
            stroke: 'none',
            cursor: 'move',
            visibility: 'hidden',
            magnet: false,
          },
          lifeline: {
            x1: 'calc(0.5 * w)',
            y1: 92,
            x2: 'calc(0.5 * w)',
            y2: 'calc(h)',
            stroke: 'var(--node-border)',
            strokeWidth: 1.5,
            strokeDasharray: '6 4',
            pointerEvents: 'none',
            visibility: 'hidden',
          },
        },
        ports: {
          groups: {
            'seq-left': { attrs: portAttrs, markup: portMarkup },
            'seq-right': { attrs: portAttrs, markup: portMarkup },
          },
          items: actorPortItems,
        },
      },
      {
        markup: [
          { tagName: 'rect', selector: 'lifelineHitbox' },
          { tagName: 'line', selector: 'lifeline' },
          { tagName: 'rect', selector: 'actorHitbox' },
          { tagName: 'circle', selector: 'actorHead' },
          { tagName: 'line', selector: 'actorBody' },
          { tagName: 'line', selector: 'actorArms' },
          { tagName: 'line', selector: 'actorLegLeft' },
          { tagName: 'line', selector: 'actorLegRight' },
          { tagName: 'text', selector: 'label' },
        ],
      }
    );
  }

  // --- SequenceActivation ---
  // A narrow grey rectangle that sits on a participant's lifeline to mark
  // when that participant is actively processing a message. Users can drop
  // one on the canvas and it will snap to the nearest lifeline's centre X.
  // Ports are placed on the left/right edges; the count is configurable via
  // `lifelinePortCount` (default 2) so users can attach incoming and outgoing
  // messages at distinct vertical points along the activation.
  {
    const DEFAULT_ACT_PORT_COUNT = 2;
    const actPortItems = buildSeqActivationPorts(DEFAULT_ACT_PORT_COUNT);
    joint.dia.Element.define(
      'sf.SequenceActivation',
      {
        size: { width: 12, height: 80 },
        z: 2200, // above participant lifeline (node tier), below links
        lifelinePortCount: DEFAULT_ACT_PORT_COUNT,
        attrs: {
          body: {
            width: 'calc(w)',
            height: 'calc(h)',
            rx: 1,
            ry: 1,
            fill: '#D0D4D9',
            stroke: '#8A9099',
            strokeWidth: 1,
          },
        },
        ports: {
          groups: {
            'seq-left':  { attrs: portAttrs, markup: portMarkup },
            'seq-right': { attrs: portAttrs, markup: portMarkup },
          },
          items: actPortItems,
        },
      },
      {
        markup: [
          { tagName: 'rect', selector: 'body' },
        ],
      }
    );
  }

  // --- SequenceFragment ---
  // A titled frame used to group messages into a Standard or Alternative block.
  // Solid border with a small tab in the top-left corner showing a free-text
  // label (e.g. 'loop', 'loop (n)', 'critical', 'break', 'alt'). Can span
  // multiple participants.
  //
  // fragmentType:
  //   'standard'     — single-compartment frame (loop / opt / critical / break / par).
  //   'alternative' — dashed horizontal divider splits the frame in two; the
  //                   top compartment shows `condition` in [brackets], the
  //                   bottom compartment shows `elseCondition`.
  //
  // The tab path's cut corner is at the BOTTOM-RIGHT so the label reads cleanly
  // along the top edge and the fold motif sits beneath it.
  joint.dia.Element.define(
    'sf.SequenceFragment',
    {
      size: { width: 400, height: 200 },
      z: 500, // subprocess tier
      fragmentType: 'standard', // 'standard' | 'alternative'
      fragmentLabel: 'loop',    // free-text shown inside the title tab
      condition: '',            // top-compartment condition (in [brackets])
      elseCondition: '',        // bottom-compartment condition (alternative only)
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          rx: 2,
          ry: 2,
          fill: 'transparent',
          stroke: 'var(--node-border)',
          strokeWidth: 1.5,
        },
        titleTab: {
          // Trapezoid with the cut corner at BOTTOM-RIGHT. Width adapts to the
          // label via joint.shapes.sf.updateFragmentTitleTab(cell). Default is
          // sized for "loop".
          refX: 0,
          refY: 0,
          d: 'M 0 0 L 38 0 L 38 10 L 28 20 L 0 20 Z',
          fill: 'var(--bg-app)',
          stroke: 'var(--node-border)',
          strokeWidth: 1.5,
        },
        titleText: {
          x: 6,
          y: 14,
          textAnchor: 'start',
          textVerticalAnchor: 'middle',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-primary)',
          text: 'loop',
        },
        // Top-compartment condition text — sits BELOW the title tab so the tab
        // can size freely without fighting for horizontal space. For
        // Alternative fragments the same Y aligns with the Else condition in
        // the bottom compartment (mirror layout).
        conditionText: {
          x: 8,
          y: 34,
          textAnchor: 'start',
          textVerticalAnchor: 'middle',
          fontSize: 11,
          fontStyle: 'italic',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: '',
        },
        // Dashed divider line across the middle — visible only for
        // 'alternative' fragments. Positions update via `calc(0.5 * h)`.
        dividerLine: {
          x1: 0,
          y1: 'calc(0.5 * h)',
          x2: 'calc(w)',
          y2: 'calc(0.5 * h)',
          stroke: 'var(--node-border)',
          strokeWidth: 1,
          strokeDasharray: '6 4',
          visibility: 'hidden',
        },
        // Bottom-compartment "else" condition label — visible only for
        // 'alternative' fragments.
        elseText: {
          x: 8,
          y: 'calc(0.5 * h + 14)',
          textAnchor: 'start',
          textVerticalAnchor: 'middle',
          fontSize: 11,
          fontStyle: 'italic',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: '',
          visibility: 'hidden',
        },
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'line', selector: 'dividerLine' },
        { tagName: 'path', selector: 'titleTab' },
        { tagName: 'text', selector: 'titleText' },
        { tagName: 'text', selector: 'conditionText' },
        { tagName: 'text', selector: 'elseText' },
      ],
    }
  );

  // Override default label markup on standard.Link — canvas-colored rect hides line behind label
  joint.shapes.standard.Link.prototype.defaults.defaultLabel = {
    markup: [
      { tagName: 'rect', selector: 'body' },
      { tagName: 'text', selector: 'text' },
    ],
    attrs: {
      text: {
        fill: '#888888',
        fontSize: 13,
        fontWeight: 600,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        textAnchor: 'middle',
        textVerticalAnchor: 'middle',
      },
      body: {
        ref: 'text',
        refWidth: 12,
        refHeight: 4,
        refX: -6,
        refY: -2,
        fill: 'var(--bg-canvas, #FFFFFF)',
        stroke: 'none',
        rx: 2,
        ry: 2,
      },
    },
    position: { distance: 0.5 },
  };

  // ---- Public helper: resize SequenceFragment title tab to fit its label ----
  // Recomputes the trapezoid path from the label text's pixel width (measured
  // in a shared off-screen SVG). Called whenever `fragmentLabel` changes and
  // on load via canvas.js migrateNodes().
  {
    const MEASURE_SVG_ID = 'df-text-measure-svg';
    const TAB_PAD = 12;   // horizontal padding inside the tab
    const TAB_CUT = 10;   // diagonal cut width at the bottom-right
    const TAB_H   = 20;   // tab height (matches y=20 in path)
    const TAB_MIN = 28;   // minimum top-edge width

    function measureLabelWidth(text) {
      const str = String(text || '').trim();
      if (!str) return TAB_MIN;
      let svg = document.getElementById(MEASURE_SVG_ID);
      if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('id', MEASURE_SVG_ID);
        svg.setAttribute('aria-hidden', 'true');
        svg.style.position = 'absolute';
        svg.style.width = '0';
        svg.style.height = '0';
        svg.style.visibility = 'hidden';
        document.body.appendChild(svg);
      }
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
      t.setAttribute('font-size', '11');
      t.setAttribute('font-weight', '700');
      t.textContent = str;
      svg.appendChild(t);
      let w;
      try { w = t.getComputedTextLength(); } catch { w = str.length * 7; }
      svg.removeChild(t);
      return Math.max(TAB_MIN, Math.ceil(w));
    }

    joint.shapes.sf.updateFragmentTitleTab = (cell) => {
      if (!cell || cell.get('type') !== 'sf.SequenceFragment') return;
      const label = cell.get('fragmentLabel') ?? cell.attr('titleText/text') ?? '';
      const textW = measureLabelWidth(label);
      const topW = textW + TAB_PAD + TAB_CUT; // room for text + padding + diagonal
      const bottomW = topW - TAB_CUT;
      const d = `M 0 0 L ${topW} 0 L ${topW} 10 L ${bottomW} ${TAB_H} L 0 ${TAB_H} Z`;
      cell.attr('titleTab/d', d);
    };
  }

  // ---- Public helpers: rebuild sequence shape ports at runtime ----
  // Called by properties.js when the user changes the "Ports" count input or
  // edits individual port positions. Preserves existing link endpoints when
  // the new count keeps the same IDs.
  //
  // Each helper accepts an optional `ratios` array (length must match count)
  // of 0–1 numbers that override the evenly-spaced defaults.
  joint.shapes.sf.rebuildSeqParticipantPorts = (cell, count, ratios) => {
    const n = Math.max(1, count | 0);
    const items = buildSeqParticipantPorts(n, ratios);
    cell.set('lifelinePortCount', n);
    if (Array.isArray(ratios) && ratios.length === n) cell.set('lifelinePortRatios', ratios.slice());
    else cell.unset('lifelinePortRatios');
    cell.prop('ports/items', items, { rewrite: true });
  };
  joint.shapes.sf.rebuildSeqActorPorts = (cell, count, ratios) => {
    const n = Math.max(1, count | 0);
    const items = buildSeqActorPorts(n, ratios);
    cell.set('lifelinePortCount', n);
    if (Array.isArray(ratios) && ratios.length === n) cell.set('lifelinePortRatios', ratios.slice());
    else cell.unset('lifelinePortRatios');
    cell.prop('ports/items', items, { rewrite: true });
  };
  joint.shapes.sf.rebuildSeqActivationPorts = (cell, count, ratios) => {
    const n = Math.max(1, count | 0);
    const items = buildSeqActivationPorts(n, ratios);
    cell.set('lifelinePortCount', n);
    if (Array.isArray(ratios) && ratios.length === n) cell.set('lifelinePortRatios', ratios.slice());
    else cell.unset('lifelinePortRatios');
    cell.prop('ports/items', items, { rewrite: true });
  };

  // ---- Public helper: toggle Actor lifeline visibility ----
  // When hidden, the dashed lifeline, its hitbox, and all lifeline ports are
  // removed; the Actor collapses to just the stick-figure + label block. Any
  // connected links with those port endpoints are kept as-is (re-showing the
  // lifeline restores ports with stable IDs so the links reattach).
  joint.shapes.sf.setActorLifelineVisible = (cell, visible) => {
    if (!cell || cell.get('type') !== 'sf.SequenceActor') return;
    const show = !!visible;
    cell.set('showLifeline', show);
    if (show) {
      cell.attr('lifeline/visibility', 'visible');
      cell.attr('lifelineHitbox/visibility', 'visible');
      cell.attr('lifelineHitbox/magnet', true);
      // Restore height if it was collapsed
      const size = cell.size();
      if (size.height < 120) cell.resize(size.width, 340);
      // Rebuild ports
      const n = cell.get('lifelinePortCount') || 5;
      const ratios = cell.get('lifelinePortRatios');
      joint.shapes.sf.rebuildSeqActorPorts(cell, n, ratios);
    } else {
      cell.attr('lifeline/visibility', 'hidden');
      cell.attr('lifelineHitbox/visibility', 'hidden');
      cell.attr('lifelineHitbox/magnet', false);
      // Collapse to just the stick-figure + label region
      cell.resize(cell.size().width, 92);
      // Clear ports (but remember config so re-showing restores them)
      cell.prop('ports/items', [], { rewrite: true });
    }
  };

  // ---- Public helper: toggle Participant bottom label visibility ----
  // UML sequence diagrams commonly mirror the participant label at the foot
  // of the lifeline so long interactions remain readable as the reader
  // scrolls. This helper toggles the four bottom selectors (header mirror,
  // accent bar, label, underline) as a group.
  joint.shapes.sf.setParticipantBottomLabelVisible = (cell, visible) => {
    if (!cell || cell.get('type') !== 'sf.SequenceParticipant') return;
    const show = !!visible;
    const v = show ? 'visible' : 'hidden';
    cell.set('showBottomLabel', show);
    cell.attr('headerBottom/visibility', v);
    cell.attr('headerBottomAccent/visibility', v);
    cell.attr('labelBottom/visibility', v);
    cell.attr('underlineBottom/visibility', v);
  };

  // Keep the bottom mirror in sync with the top header when the user edits
  // the label text, header fill, label colour or accent. Registered on the
  // graph by canvas.js → attachParticipantBottomLabelSync.
  joint.shapes.sf.syncParticipantBottomLabel = (cell) => {
    if (!cell || cell.get('type') !== 'sf.SequenceParticipant') return;
    const label = cell.attr('label/text');
    if (label !== undefined) cell.attr('labelBottom/text', label);
    const accent = cell.attr('headerAccent/fill');
    if (accent !== undefined) cell.attr('headerBottomAccent/fill', accent);
    const fill = cell.attr('header/fill');
    if (fill !== undefined) cell.attr('headerBottom/fill', fill);
    const labelFill = cell.attr('label/fill');
    if (labelFill !== undefined) cell.attr('labelBottom/fill', labelFill);
  };
}

// Data Model DataObject shape + its field-row view (CLEANUP S3). registerDataObject() is called by shapes.js register(); it defines the block's
// JointJS shapes/views. Reads the shared leaves (ports/markdown-fo/fields/context) + app modules; never the facade.

import { sctx } from './context.js?v=1.20.0.63';
import { ensureFieldFids, fieldHasLink, getVisibleDataObjectFields } from './fields.js?v=1.20.0.63';
import { portGroups } from './ports.js?v=1.20.0.63';
import { fieldFocus } from '../canvas/focus-state.js?v=1.20.0.63';

export function registerDataObject() {
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
      if (!(sctx.mappingModeGetter && sctx.mappingModeGetter())) return;
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
      const allFields = !!(sctx.mappingModeGetter && sctx.mappingModeGetter());
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

        // Field label — truncated with an ellipsis so an over-long name can never spill
        // past the object edge or collide with the right-aligned Data Type. The full,
        // untruncated text stays available as an SVG <title> tooltip.
        //
        // LABEL-FIRST (1.20.0): the human label is primary (apiName fills in when the label is
        // empty — panel-created fields default label:''), and `showLabels` now appends the API
        // NAME when it differs (the pre-1.20 composition was apiName-primary with the label
        // appended). This is a render-time REINTERPRETATION, not a migration: no cell is
        // rewritten (Compare/version-history diffs + Drive hashes stay clean), the persisted
        // key and its frozen share-codec MIN code ('+') are untouched, and a pre-1.20 client
        // still renders both names for showLabels:true files. Equal label/apiName pairs are
        // deduped (the old code rendered "Id (Id)").
        const showApiNames = model.get('showLabels');
        const primaryName = field.label || field.apiName || '';
        const fullLabel = primaryName +
          (showApiNames && field.apiName && field.apiName !== primaryName ? ` (${field.apiName})` : '') +
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
          if (sctx.autoFitGetter && sctx.autoFitGetter()) {
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
        if (sctx.dataObjectHistoryBatcher) sctx.dataObjectHistoryBatcher(toggle); else toggle();
      });
      g.appendChild(tg);

      this.el.appendChild(g);
    },
  });

}

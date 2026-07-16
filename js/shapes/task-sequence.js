// Task / Sequence-diagram shapes + the standard.Link label patch tail (CLEANUP S3). registerTaskSequence() is called by shapes.js register(); it defines the block's
// JointJS shapes/views. Reads the shared leaves (ports/markdown-fo/fields/context) + app modules; never the facade.

import { buildSeqActivationPorts, buildSeqActorPorts, buildSeqParticipantPorts, portAttrs, portGroups, portItems, portMarkup } from './ports.js?v=1.19.5.8';

export function registerTaskSequence() {
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

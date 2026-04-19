// Custom JointJS shapes for SF Diagrams
// All shapes are under the `sf` namespace
// Uses JointJS v4 JSON markup array syntax

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
      ],
    }
  );

  // --- TextLabel ---
  // A standalone text annotation with no background
  joint.dia.Element.define(
    'sf.TextLabel',
    {
      size: { width: 200, height: 32 },
      z: 2000,    // Node tier: 2000 – 2499
      attrs: {
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
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

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
        line: {
          x1: 0, y1: 'calc(0.5 * h)', x2: 'calc(w)', y2: 'calc(0.5 * h)',
          stroke: 'var(--text-muted)',
          strokeWidth: 2,
          strokeLinecap: 'round',
        },
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'hitArea' },
        { tagName: 'line', selector: 'line' },
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
        // Triangular folded-corner flap. Slightly darker fill gives depth.
        fold: {
          d: `M calc(w - ${NOTE_FOLD}) 0 L calc(w - ${NOTE_FOLD}) ${NOTE_FOLD} L calc(w) ${NOTE_FOLD} Z`,
          fill: '#EDD56A',
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
        { tagName: 'path', selector: 'bracket' },
        { tagName: 'text', selector: 'label' },
      ],
    }
  );

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
          fieldLeft: {
            position: { name: 'absolute' },
            attrs: {
              circle: {
                r: 4,
                magnet: true,
                fill: '#F6B355',
                stroke: '#FFFFFF',
                strokeWidth: 1.5,
              },
            },
            markup: [{ tagName: 'circle', selector: 'circle' }],
          },
          fieldRight: {
            position: { name: 'absolute' },
            attrs: {
              circle: {
                r: 4,
                magnet: true,
                fill: '#1D73C9',
                stroke: '#FFFFFF',
                strokeWidth: 1.5,
              },
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
        { tagName: 'text', selector: 'headerLabel' },
      ],
    }
  );

  // Custom view for DataObject — renders field rows as dynamic SVG
  joint.shapes.sf.DataObjectView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      this.listenTo(this.model, 'change:fields change:showLabels change:showFieldLengths change:keyFieldsOnly', () => this._renderFieldRows());
      this.listenTo(this.model, 'change:fields change:keyFieldsOnly', () => this._syncFieldPorts());
      this.listenTo(this.model, 'change:keyFieldsOnly', () => this._autoResize());
    },
    update() {
      joint.dia.ElementView.prototype.update.apply(this, arguments);
      this._renderFieldRows();
      this._syncFieldPorts();
    },

    _autoResize() {
      const model = this.model;
      const fields = model.get('fields') || [];
      const keyFieldsOnly = model.get('keyFieldsOnly');
      const visibleCount = keyFieldsOnly ? fields.filter(f => f.keyType).length : fields.length;
      const HEADER_H = 32;
      const ROW_H = 22;
      const height = HEADER_H + Math.max(visibleCount, 1) * ROW_H + 4;
      model.resize(model.size().width, height);
    },

    _syncFieldPorts() {
      const model = this.model;
      const fields = model.get('fields') || [];
      const keyFieldsOnly = model.get('keyFieldsOnly');
      const { width } = model.size();
      const HEADER_H = 32;
      const ROW_H = 22;

      // Get existing field ports
      const existingPorts = (model.get('ports')?.items || []).filter(
        p => p.group === 'fieldLeft' || p.group === 'fieldRight'
      );
      const existingIds = new Set(existingPorts.map(p => p.id));

      // Build desired field ports for PK/FK fields.
      // Port y-position uses the visible row index (filtered when keyFieldsOnly is on);
      // port IDs remain tied to the original field index for stable link endpoints.
      const desired = [];
      let visibleIdx = 0;
      fields.forEach((field, i) => {
        const isVisible = !keyFieldsOnly || field.keyType;
        if (!isVisible) return;
        if (field.keyType) {
          const y = HEADER_H + visibleIdx * ROW_H + ROW_H / 2;
          const leftId = `field-left-${i}`;
          const rightId = `field-right-${i}`;
          desired.push({
            id: leftId, group: 'fieldLeft',
            args: { x: 0, y },
            attrs: { circle: { fill: field.keyType === 'pk' ? '#F6B355' : '#1D73C9' } },
          });
          desired.push({
            id: rightId, group: 'fieldRight',
            args: { x: width, y },
            attrs: { circle: { fill: field.keyType === 'pk' ? '#F6B355' : '#1D73C9' } },
          });
        }
        visibleIdx++;
      });

      const desiredIds = new Set(desired.map(p => p.id));

      // Remove ports that no longer exist
      const toRemove = existingPorts.filter(p => !desiredIds.has(p.id)).map(p => p.id);
      if (toRemove.length) model.removePorts(toRemove);

      // Add/update ports
      desired.forEach(p => {
        if (existingIds.has(p.id)) {
          // Update position
          model.portProp(p.id, 'args', p.args);
        } else {
          model.addPort(p);
        }
      });
    },

    _renderFieldRows() {
      const model = this.model;
      const allFields = model.get('fields') || [];
      const keyFieldsOnly = model.get('keyFieldsOnly');
      const fields = keyFieldsOnly ? allFields.filter(f => f.keyType) : allFields;
      const { width, height } = model.size();
      const HEADER_H = 32;
      const ROW_H = 22;
      const ns = 'http://www.w3.org/2000/svg';

      // Remove old dynamic content
      const old = this.el.querySelector('.do-fields-g');
      if (old) old.remove();

      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'do-fields-g');

      fields.forEach((field, i) => {
        const y = HEADER_H + i * ROW_H;
        if (y + ROW_H > height + 2) return;

        // Separator line between rows
        if (i > 0) {
          const sep = document.createElementNS(ns, 'line');
          sep.setAttribute('x1', '0');
          sep.setAttribute('y1', String(y));
          sep.setAttribute('x2', String(width));
          sep.setAttribute('y2', String(y));
          sep.setAttribute('stroke', 'var(--node-border)');
          sep.setAttribute('stroke-opacity', '0.15');
          g.appendChild(sep);
        }

        const textY = y + 15;
        let labelX = 12;

        // Key badge (PK in amber, FK in blue)
        if (field.keyType) {
          const isPK = field.keyType === 'pk';
          const badge = document.createElementNS(ns, 'text');
          badge.setAttribute('x', '8');
          badge.setAttribute('y', String(textY));
          badge.setAttribute('font-size', '8');
          badge.setAttribute('font-weight', '700');
          badge.setAttribute('font-family', 'system-ui, sans-serif');
          badge.setAttribute('fill', isPK ? '#F6B355' : '#1D73C9');
          badge.textContent = isPK ? 'PK' : 'FK';
          g.appendChild(badge);
          labelX = 26;
        }

        // Field label
        const showLabels = model.get('showLabels');
        let labelText = (field.apiName || field.label || '') +
          (showLabels && field.label ? ` (${field.label})` : '');
        if (field.required) labelText += ' *';
        const label = document.createElementNS(ns, 'text');
        label.setAttribute('x', String(labelX));
        label.setAttribute('y', String(textY));
        label.setAttribute('font-size', '11');
        label.setAttribute('font-family', 'system-ui, sans-serif');
        label.setAttribute('fill', field.decommissioned ? 'var(--text-muted)' : 'var(--node-text)');
        if (field.decommissioned) label.setAttribute('text-decoration', 'line-through');
        label.textContent = labelText;
        g.appendChild(label);

        // Field type (right-aligned), with optional length
        const showLen = model.get('showFieldLengths');
        let typeStr = field.type || '';
        if (showLen && field.length) typeStr += `(${field.length})`;
        const typeEl = document.createElementNS(ns, 'text');
        typeEl.setAttribute('x', String(width - 10));
        typeEl.setAttribute('y', String(textY));
        typeEl.setAttribute('text-anchor', 'end');
        typeEl.setAttribute('font-size', '10');
        typeEl.setAttribute('font-family', 'system-ui, sans-serif');
        typeEl.setAttribute('fill', 'var(--text-muted)');
        typeEl.textContent = typeStr;
        g.appendChild(typeEl);
      });

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
      ],
    }
  );

  // --- GanttMarker ---
  // Upward-pointing triangle that marks the current point in time on a Gantt chart.
  // Can be embedded in a GanttTimeline like a milestone.
  joint.dia.Element.define(
    'sf.GanttMarker',
    {
      size: { width: 20, height: 16 },
      z: 2000,
      pointDown: false,
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
          text: 'Today',
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
      ],
    }
  );

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
      viewMode: 'week',       // 'day', 'week' or 'month'
      numPeriods: 12,         // number of columns to show
      tasks: [],              // array of { id, type:'group'|'task', label, groupId?, color? }
      taskListWidth: 200,     // width of the left task list panel
      rowHeight: 48,          // height per task row (tall enough for embedded elements)
      timelineTitle: 'Tasks',      // replaces the hardcoded "Tasks" header
      timelineDescription: '',     // description text below title
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
      this.listenTo(this.model, 'change:startDate change:endDate change:viewMode change:numPeriods change:size change:tasks change:taskListWidth change:rowHeight change:timelineTitle change:timelineDescription', () => this._renderColumns());
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
      const tasks = model.get('tasks') || [];
      const taskListWidth = tasks.length ? (model.get('taskListWidth') || 200) : 0;
      const rowHeight = Math.max(model.get('rowHeight') || 48, 48);
      const dateH = 48;            // total height for the two date rows
      const topH = dateH / 2;      // top date row height
      const botH = dateH / 2;      // bottom date row height
      const phaseRowH = 40;        // space below dates for phase/group elements
      const headerH = dateH + phaseRowH;

      // Auto-resize height to fit tasks
      const visibleTasks = this._getVisibleTasks();
      const totalHeight = tasks.length ? headerH + Math.max(visibleTasks.length, 1) * rowHeight : headerH;
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

      // Snap start to Monday (week view) or 1st of month (month view)
      if (viewMode === 'week') {
        const day = start.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        start.setDate(start.getDate() + diff);
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
          if (ms.startX > oX) colGroup.appendChild(mkLine(ms.startX, 0, ms.startX, headerH, '0.5'));
          colGroup.appendChild(mkText(ms.startX + spanW / 2, topH / 2, `${MONTHS_SHORT[ms.month]} ${ms.year}`, '11', '700', 'var(--text-primary)'));
        });

        // Weekend column highlight across ALL rows (header + tasks)
        days.forEach((day) => {
          const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
          if (isWeekend) colGroup.appendChild(mkRect(day.x, topH, colW, height - topH, 'var(--stencil-item-hover)'));
        });

        // Draw day labels (bottom row)
        days.forEach((day, i) => {
          if (i > 0) colGroup.appendChild(mkLine(day.x, topH, day.x, headerH, '0.3'));
          const label = colW > 40 ? `${DAYS_SHORT[day.date.getDay()]} ${day.date.getDate()}`
            : colW > 28 ? `${DAYS_SHORT[day.date.getDay()].charAt(0)} ${day.date.getDate()}`
            : String(day.date.getDate());
          colGroup.appendChild(mkText(day.x + colW / 2, topH + botH / 2, label, '9', '500', 'var(--text-secondary)'));
        });
      } else if (viewMode === 'week') {
        // Top row: months that span across weeks
        // Bottom row: week start dates ("3 Apr" format)
        const weeks = [];
        const d = new Date(start);
        for (let i = 0; i < numPeriods; i++) {
          weeks.push({ start: new Date(d), x: oX + i * colW });
          d.setDate(d.getDate() + 7);
        }

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
          if (ms.startX > oX) colGroup.appendChild(mkLine(ms.startX, 0, ms.startX, headerH, '0.5'));
          colGroup.appendChild(mkText(ms.startX + spanW / 2, topH / 2, `${MONTHS_SHORT[ms.month]} ${ms.year}`, '11', '700', 'var(--text-primary)'));
        });

        // Draw week labels (bottom row)
        weeks.forEach((w, i) => {
          if (i % 2 === 1) colGroup.appendChild(mkRect(w.x, topH, colW, botH, 'var(--stencil-item-hover)'));
          if (i > 0) colGroup.appendChild(mkLine(w.x, topH, w.x, headerH, '0.3'));
          colGroup.appendChild(mkText(w.x + colW / 2, topH + botH / 2,
            `${w.start.getDate()} ${MONTHS_SHORT[w.start.getMonth()]}`, '10', '500', 'var(--text-secondary)'));
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
          if (ys.startX > oX) colGroup.appendChild(mkLine(ys.startX, 0, ys.startX, headerH, '0.5'));
          colGroup.appendChild(mkText(ys.startX + spanW / 2, topH / 2, String(ys.year), '11', '700', 'var(--text-primary)'));
        });

        // Draw month labels (bottom row)
        months.forEach((m, i) => {
          if (i % 2 === 1) colGroup.appendChild(mkRect(m.x, topH, colW, botH, 'var(--stencil-item-hover)'));
          if (i > 0) colGroup.appendChild(mkLine(m.x, topH, m.x, headerH, '0.3'));
          colGroup.appendChild(mkText(m.x + colW / 2, topH + botH / 2, MONTHS_SHORT[m.month], '10', '500', 'var(--text-secondary)'));
        });
      }

      // Bottom border line below dates when no task rows
      if (tasks.length === 0) {
        colGroup.appendChild(mkLine(0, dateH, width, dateH, '0.5'));
      }

      // ── Task list panel (left side) ──
      if (tasks.length > 0) {
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

        // Row backgrounds + alternating stripes for timeline area
        visibleTasks.forEach((task, i) => {
          const rowY = headerH + i * rowHeight;
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
      imageUrl: '',     // data URI or URL for photo
      iconText: '',     // up to 4 letters shown in avatar circle
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
      ],
    }
  );

  // Custom view for OrgPerson — updates display based on model properties
  joint.shapes.sf.OrgPersonView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      this.listenTo(this.model, 'change:personName change:jobTitle change:email change:phone change:role change:stream change:location change:company change:detailOrder change:imageUrl change:iconText', () => this._updateCard());
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
      m.attr('nameLabel/x', textX, { silent: true });
      m.attr('nameLabel/y', nameY, { silent: true });
      m.attr('positionLabel/x', textX, { silent: true });
      m.attr('positionLabel/y', nameY + 16, { silent: true });
      m.attr('detailsLabel/x', textX, { silent: true });
      m.attr('detailsLabel/y', pos ? nameY + 32 : nameY + 16, { silent: true });

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

      // Detail labels — build "Label: Value" pairs
      const DETAIL_LABELS = { email: 'Email', phone: 'Phone', role: 'Role', stream: 'Stream', location: 'Location', company: 'Company' };
      const fieldValues = { email, phone, role, stream, location, company };
      const order = m.get('detailOrder') || ['email', 'phone', 'role', 'stream', 'location', 'company'];
      const details = [];
      for (const key of order) {
        if (fieldValues[key]) details.push({ label: DETAIL_LABELS[key], value: fieldValues[key] });
      }

      // Adapt height — auto-size based on content
      const detailStartY = pos ? nameY + 32 : nameY + 16;
      const detailH = details.length * 14;
      const contentH = detailStartY + detailH + 10;
      const avatarBottom = avatarCy + avatarR + 8;
      const totalH = Math.max(contentH, avatarBottom, 60);
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
        posEl.textContent = pos;
        posEl.setAttribute('x', String(textX));
        posEl.setAttribute('y', String(nameY + 16));
        posEl.setAttribute('dominant-baseline', 'hanging');
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

      // Details — render with labels aligned, with ellipsis for overflow
      const detailEl = this.el.querySelector('[joint-selector="detailsLabel"]');
      if (detailEl) {
        detailEl.textContent = '';
        detailEl.setAttribute('x', String(textX));
        detailEl.setAttribute('y', String(pos ? nameY + 32 : nameY + 16));
        detailEl.setAttribute('dominant-baseline', 'hanging');
        const maxValWidth = m.size().width - textX - 10;
        const labelW = 52; // fixed tab stop for labels
        if (details.length > 0) {
          details.forEach((d, i) => {
            // Label tspan (muted)
            const labelSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            labelSpan.setAttribute('x', String(textX));
            labelSpan.setAttribute('dy', i === 0 ? '0' : '14');
            labelSpan.setAttribute('fill', 'var(--text-muted)');
            labelSpan.textContent = d.label + ':';
            detailEl.appendChild(labelSpan);
            // Value tspan (slightly brighter)
            const valSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            valSpan.setAttribute('x', String(textX + labelW));
            valSpan.setAttribute('fill', 'var(--text-secondary)');
            // Truncate long values with ellipsis
            const maxChars = Math.floor((maxValWidth - labelW) / 5.5);
            valSpan.textContent = d.value.length > maxChars && maxChars > 2 ? d.value.substring(0, maxChars - 1) + '…' : d.value;
            detailEl.appendChild(valSpan);
          });
        }
      }
    },
  });

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
    const MEASURE_SVG_ID = 'sf-text-measure-svg';
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

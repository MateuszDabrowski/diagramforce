// Process-diagram shapes (BPMN family + Flowchart shapes + Annotation) (CLEANUP S3). registerBpmnFlow() is called by shapes.js register(); it defines the block's
// JointJS shapes/views. Reads the shared leaves (ports/markdown-fo/fields/context) + app modules; never the facade.

import { ensureMarkdownFO } from './markdown-fo.js?v=1.19.2.99';
import { portGroups, portItems } from './ports.js?v=1.19.2.99';

export function registerBpmnFlow() {
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

}

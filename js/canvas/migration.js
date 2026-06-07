// Migration domain — schema/format fixups applied on diagram load. Extracted
// from canvas.js (Phase 4, Slice 4). migrateLinks/migrateNodes normalise legacy
// marker + shape formats; updateSimpleNodeLayout re-centres SimpleNode content.
// Reads the live graph/paper + refreshAllIconHrefs via the canvas context (cctx).
import { cctx } from './context.js?v=1.15.1';

// Legacy line-style dash strings → corrected standards. The line-style picklist
// previews advertise round dots and long-dashes, but pre-fix saves stored
// '3 4' (small dashes) for "dotted" and '16 8 2 8' (a dash-dot) for "breaks".
// Rewrite both on load so existing diagrams match the previews without the user
// having to re-pick the style. Applies to sf.Line elements (line/strokeDasharray)
// in migrateNodes and — defensively — to any legacy connector whose dasharray
// was hoisted onto lineStyle in migrateLinks.
const LEGACY_DASH_REMAP = { '3 4': '0 6', '16 8 2 8': '16 8' };

// ── Migrate link labels to use canvas-bg rect + connector-colored text ──
export function migrateLinks() {
  const { graph, paper } = cctx;
  for (const link of graph.getLinks()) {
    // ── Re-key legacy positional field ports → stable fid ports ──
    // Pre-1.15.0 saves bound a DataObject link to the field's ARRAY INDEX
    // (`field-left-2`); reordering/deleting a field then drifted the link.
    // Fields now carry an immutable `fid` (assigned in sf.DataObject.initialize,
    // so it exists by the time this runs) and `fields[i].fid` is the id of the
    // field saved at index i. fid ports don't match the numeric form, so this
    // is idempotent on already-migrated diagrams.
    for (const end of ['source', 'target']) {
      const ep = link.get(end);
      const m = typeof ep?.port === 'string' ? /^field-(left|right)-(\d+)$/.exec(ep.port) : null;
      if (!m) continue;
      const cell = graph.getCell(ep.id);
      if (cell?.get('type') !== 'sf.DataObject') continue;
      const field = (cell.get('fields') || [])[Number(m[2])];
      if (field?.fid) link.set(end, { ...ep, port: `field-${m[1]}-${field.fid}` });
    }

    // Smooth left→right flow for Data Cloud mapping links — bypass the orthogonal
    // sfManhattan router and use a horizontal-tangent bezier (matches the SF
    // mapping canvas). Idempotent.
    if (link.prop('linkKind') === 'mapping') {
      if (link.router()?.name !== 'sfMappingRouter') link.router({ name: 'sfMappingRouter' });
      if (link.connector()?.name !== 'sfMappingConnector') link.connector('sfMappingConnector');
      // Pin to the field-port anchor with a small outward offset (port-hit + 90°
      // entry + arrow tip at the edge) — see applyMappingLinkStyle.
      if (link.prop('source/connectionPoint')?.args?.offset !== 12) link.prop('source/connectionPoint', { name: 'anchor', args: { offset: 12 } });
      if (link.prop('target/connectionPoint')?.args?.offset !== 12) link.prop('target/connectionPoint', { name: 'anchor', args: { offset: 12 } });
      // Heal a mapping arrow that leaked the relationship style's explicit fill/stroke
      // (the old Connection-type switch merged markers, baking a hollow grey arrow).
      // A mapping arrow must auto-inherit the line colour → strip fill/stroke back to
      // the canonical solid arrowhead.
      const tm = link.attr('line/targetMarker');
      if (tm && (tm.fill != null || tm.stroke != null)) {
        link.removeAttr('line/targetMarker');
        link.attr('line/targetMarker', { type: 'path', d: 'M 0 -6 L -14 0 L 0 6 z' });
      }
      // Ensure the mapping-type token label exists (older saves predate it; the badge
      // defaults to 'S' for an unset/Standard type). Idempotent — rebuilds in place.
      cctx.syncMappingTypeBadge?.(link);
    }

    // Rebuild the Architecture connection-frequency overlay from its prop. A JSON/LLM
    // spec may set `connectionFrequency` without the derived clock label, so derive it
    // here. Idempotent + a no-op when the prop is unset (keeps non-freq labels intact).
    cctx.syncFrequencyLabel?.(link);

    // Ensure links have a sourceMarker (older diagrams may lack one). The plain
    // stub tracks the line width so a "None" end never reads thicker than the line.
    if (!link.attr('line/sourceMarker')) {
      const stroke = link.attr('line/stroke') || '#888888';
      link.attr('line/sourceMarker', {
        type: 'path',
        d: 'M 0 0 L -12 0',
        fill: 'none',
        stroke,
        'stroke-width': link.attr('line/strokeWidth') ?? 2,
      });
    }

    // Migrate old arrow markers to native JointJS convention
    //
    // Skip migration for paths already in the current canonical form —
    // the old-format heuristics (especially hasCrowFoot) can misidentify
    // canonical paths that happen to share substring patterns (e.g. the
    // canonical "one" path contains both `L 0 0` and `L -12 8`, which
    // would otherwise be re-written to "many" on every load).
    const CANONICAL_MARKER_PATHS = new Set([
      'M 0 0 L -12 0',
      'M 0 -6 L -14 0 L 0 6 z',
      'M 0 -6 L -14 0 L 0 6',
      'M -14 -6 L 0 0 L -14 6', // legacy reversed form shipped in an earlier 1.6.0 build
      'M -12 -8 L -12 8 M -12 0 L 0 0',
      'M 2 0 a 5 5 0 1 1 -10 0 a 5 5 0 1 1 10 0 Z M -8 0 L -12 0 M -12 -8 L -12 8',
      'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0',
      'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0 M 3 -8 L 3 8',
      'M 4 0 a 5 5 0 1 1 10 0 a 5 5 0 1 1 -10 0 Z M -12 -8 L 0 0 M 0 0 L -12 8 M 0 0 L -12 0',
    ]);

    for (const key of ['sourceMarker', 'targetMarker']) {
      const m = link.attr(`line/${key}`);
      if (!m?.d) continue;
      const d = m.d;
      if (CANONICAL_MARKER_PATHS.has(d)) continue; // already up to date
      // Old arrow: M 14 -6 0 0 14 6 z → new: M 0 -6 L -14 0 L 0 6 z
      if (d.includes('14 -6') && d.includes('z')) {
        link.attr(`line/${key}`, { type: 'path', d: 'M 0 -6 L -14 0 L 0 6 z' });
      }
      // Old ER markers: convert to canonical new paths
      else if (m.fill === 'none' || m.fill?.startsWith('var(')) {
        const stroke = m.stroke || link.attr('line/stroke') || '#888888';
        const hasCrowFoot = (d.includes('L 0 0') && /L\s*-12\s+8/.test(d)) || d.includes('L 12 0');
        const hasCircle = /a [345] [345]/.test(d);
        const hasBar = /M\s*-?15\s/.test(d) || /M\s*[3-9]\s+-8/.test(d)
          || /M\s*0\s+-8\s*L\s*0\s+8/.test(d) || /M\s*-1[14]\s+-8/.test(d);
        let newD;
        if (hasCrowFoot && hasCircle) {
          newD = 'M 4 0 a 5 5 0 1 1 10 0 a 5 5 0 1 1 -10 0 Z M -12 -8 L 0 0 M 0 0 L -12 8 M 0 0 L -12 0'; // zeroMany
        } else if (hasCrowFoot && hasBar) {
          newD = 'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0 M 3 -8 L 3 8'; // oneMany
        } else if (hasCrowFoot) {
          newD = 'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0'; // many
        } else if (hasCircle) {
          newD = 'M 2 0 a 5 5 0 1 1 -10 0 a 5 5 0 1 1 10 0 Z M -8 0 L -12 0 M -12 -8 L -12 8'; // zeroOne
        } else if (/M\s*-?\d+\s+-8\s*L\s*-?\d+\s+8/.test(d)) {
          newD = 'M -12 -8 L -12 8 M -12 0 L 0 0'; // one (bar at entity end)
        } else {
          continue;
        }
        const sw = 2;
        const markerFill = hasCircle ? 'var(--bg-canvas, #1A1A1A)' : 'none';
        link.attr(`line/${key}`, { type: 'path', d: newD, fill: markerFill, stroke, 'stroke-width': sw });
      }
    }

    // Pin `stroke-dasharray: 'none'` on every marker as defence in depth
    // (handles browsers that respect marker-level attribute overrides —
    // Chrome, Firefox).  Safari ignores this because it propagates the
    // line's dasharray into marker content at the renderer level; for
    // Safari we also render a bg-coloured overlay (startLineStyleOverlays)
    // so the real line never carries a dasharray in the first place.
    for (const key of ['sourceMarker', 'targetMarker']) {
      const m = link.attr(`line/${key}`);
      if (m && m['stroke-dasharray'] !== 'none') {
        link.attr(`line/${key}`, { ...m, 'stroke-dasharray': 'none' });
      }
    }

    // Legacy migration: move `line/strokeDasharray` onto `cell.prop('lineStyle')`
    // so the real line renders solid (markers stay crisp) while the overlay
    // manager paints the dashes.  Skip links that are already migrated.
    const legacyDash = link.attr('line/strokeDasharray');
    if (legacyDash && typeof legacyDash === 'string' && legacyDash !== 'none' && !link.prop('lineStyle')) {
      link.prop('lineStyle', legacyDash);
      link.attr('line/strokeDasharray', null);
    } else if (legacyDash && link.prop('lineStyle')) {
      // Belt-and-suspenders: if both are set (shouldn't happen), clear the line attr.
      link.attr('line/strokeDasharray', null);
    }

    // Re-map a legacy dash string that ended up on lineStyle (via the hoist
    // above on a pre-overlay connector) to the corrected standard.
    const ls = link.prop('lineStyle');
    if (ls && LEGACY_DASH_REMAP[ls]) link.prop('lineStyle', LEGACY_DASH_REMAP[ls]);

    const labels = link.labels();
    if (!labels || !labels.length) continue;
    const lineColor = link.attr('line/stroke') || '#888888';
    const newLabels = labels.map(lbl => {
      const text = lbl.attrs?.text?.text || lbl.attrs?.label?.text || '';
      if (!text) return lbl;
      const fontSize = lbl.attrs?.text?.fontSize ?? 13;
      return {
        markup: [
          { tagName: 'rect', selector: 'body' },
          { tagName: 'text', selector: 'text' },
        ],
        attrs: {
          text: { text, fill: lineColor, fontSize, fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', textAnchor: 'middle', textVerticalAnchor: 'middle' },
          body: { ref: 'text', refWidth: 12, refHeight: 4, refX: -6, refY: -2, fill: 'var(--bg-canvas, #FFFFFF)', stroke: 'none', rx: 2, ry: 2 },
        },
        position: lbl.position || { distance: 0.5 },
      };
    });
    link.labels(newLabels);
  }

  // Force all link views to re-render (clears stale routing/connection-point caches)
  paper.updateViews();
}

// ── SimpleNode dynamic layout ───────────────────────────────────────
// Adjusts icon/label/subtitle positioning based on content:
//  - Text only (no icon): label centered
//  - Icon + text (no description): icon+text pair centered
//  - With description: icon+text top-left, description below full-width

export function updateSimpleNodeLayout(cell) {
  if (cell.get('type') !== 'sf.SimpleNode') return;
  if (cell.get('iconMode')) return;

  const hasIcon = !!cell.attr('icon/href');
  const hasDescription = !!(cell.attr('subtitle/text'));

  if (hasDescription) {
    // Icon+label centered in header row, description below spanning full width
    if (hasIcon) {
      cell.attr({
        icon: { x: 12, y: 8, width: 32, height: 32 },
        label: {
          x: 'calc(0.5*w + 20)', y: 24,
          textAnchor: 'middle', textVerticalAnchor: 'middle',
          textWrap: { width: 'calc(w - 64)', maxLineCount: 1, ellipsis: true },
        },
        subtitle: {
          x: 12, y: 42, visibility: 'visible',
          textAnchor: 'start', textVerticalAnchor: 'top',
          textWrap: { width: 'calc(w - 24)', height: 'calc(h - 48)', ellipsis: true },
        },
      });
    } else {
      cell.attr({
        icon: { width: 0, height: 0 },
        label: {
          x: 12, y: 16,
          textAnchor: 'start', textVerticalAnchor: 'middle',
          textWrap: { width: 'calc(w - 24)', maxLineCount: 1, ellipsis: true },
        },
        subtitle: {
          x: 12, y: 32, visibility: 'visible',
          textAnchor: 'start', textVerticalAnchor: 'top',
          textWrap: { width: 'calc(w - 24)', height: 'calc(h - 38)', ellipsis: true },
        },
      });
    }
  } else if (hasIcon) {
    // Icon left, text centered in remaining space, vertically aligned with icon center
    cell.attr({
      icon: { x: 12, y: 'calc(0.5*h - 16)', width: 32, height: 32 },
      label: {
        x: 'calc(0.5*w + 20)', y: 'calc(0.5*h)',
        textAnchor: 'middle', textVerticalAnchor: 'middle',
        textWrap: { width: 'calc(w - 64)', maxLineCount: 4, ellipsis: true },
      },
      subtitle: { visibility: 'hidden' },
    });
  } else {
    // Text only — centered
    cell.attr({
      icon: { width: 0, height: 0 },
      label: {
        x: 'calc(0.5*w)', y: 'calc(0.5*h)',
        textAnchor: 'middle', textVerticalAnchor: 'middle',
        textWrap: { width: 'calc(w - 24)', maxLineCount: 4, ellipsis: true },
      },
      subtitle: { visibility: 'hidden' },
    });
  }
}

// Optional header icon for a DataObject (Data Model / Data Mapping). Empty by
// default; when an icon is picked, show it on the LEFT of the header bar and shift
// the object-name label right to clear it. Mirrors updateSimpleNodeLayout — a
// standalone pass called on icon-pick (properties.js) + on load (migrateNodes),
// never from the view's update loop, so it sets attrs non-silently without churn.
export function updateDataObjectHeaderLayout(cell) {
  if (cell.get('type') !== 'sf.DataObject') return;
  const hasIcon = !!cell.attr('headerIcon/href');
  if (hasIcon) {
    cell.attr({
      headerIcon: { x: 10, y: 8, width: 16, height: 16 },
      headerLabel: { x: 32 },
    });
  } else {
    cell.attr({
      headerIcon: { width: 0, height: 0 },
      headerLabel: { x: 12 },
    });
  }
}

export function migrateNodes() {
  const { graph, refreshAllIconHrefs } = cctx;
  for (const el of graph.getElements()) {
    if (el.get('type') === 'sf.SimpleNode' && !el.get('iconMode')) {
      updateSimpleNodeLayout(el);
    }
    // The field "Decommissioned" flag was renamed to "Deprecated" — carry the old
    // `decommissioned` property forward to `deprecated` so pre-rename diagrams keep
    // their marked fields. Silent (pure normalization, no history entry). Idempotent.
    if (el.get('type') === 'sf.DataObject') {
      const fields = el.get('fields');
      if (Array.isArray(fields) && fields.some(f => f && 'decommissioned' in f)) {
        el.set('fields', fields.map(f => {
          if (!f || !('decommissioned' in f)) return f;
          const { decommissioned, ...rest } = f;
          return { ...rest, deprecated: rest.deprecated ?? decommissioned };
        }), { silent: true });
      }
      // Re-apply the optional header-icon layout so a loaded object with an icon keeps
      // its right-shifted label (and one without stays left-aligned). Idempotent.
      updateDataObjectHeaderLayout(el);
    }
    // sf.Line stores its dash string directly on line/strokeDasharray; older
    // saves carry the pre-fix '3 4'/'16 8 2 8' values that no longer match the
    // picklist previews. Rewrite to the corrected '0 6'/'16 8' standards.
    if (el.get('type') === 'sf.Line') {
      const dash = el.attr('line/strokeDasharray');
      if (dash && LEGACY_DASH_REMAP[dash]) el.attr('line/strokeDasharray', LEGACY_DASH_REMAP[dash]);
    }
    // Migrate Container from old left-accent to new top-bar accent
    if (el.get('type') === 'sf.Container') {
      migrateContainer(el);
    }
    // Migrate SequenceFragment: condition used to sit beside the title tab at
    // (x=72, y=14); it now sits below the tab at (x=8, y=34) on its own line.
    // Also recompute the trapezoid path so it adapts to the current label.
    if (el.get('type') === 'sf.SequenceFragment') {
      const cx = el.attr('conditionText/x');
      const cy = el.attr('conditionText/y');
      if (cx === 72 || cy === 14 || cx == null || cy == null) {
        el.attr('conditionText/x', 8);
        el.attr('conditionText/y', 34);
        el.attr('conditionText/textAnchor', 'start');
        el.attr('conditionText/textVerticalAnchor', 'middle');
      }
      joint.shapes.sf.updateFragmentTitleTab?.(el);
    }
    // Migrate SequenceParticipant: older saves have no bottom header/label
    // attrs and no showBottomLabel property. New diagrams default showBottom
    // to true; existing diagrams inherit true as well so the label mirror
    // appears on load — users can hide via the properties panel.
    if (el.get('type') === 'sf.SequenceParticipant') {
      const hasBottomAttrs = el.attr('labelBottom/text') !== undefined;
      // Always sync label text and accent/fill in case the top changed while
      // this diagram was open without syncing.
      joint.shapes.sf.syncParticipantBottomLabel?.(el);
      if (!hasBottomAttrs && el.get('showBottomLabel') === undefined) {
        el.set('showBottomLabel', true);
      }
      const show = el.get('showBottomLabel') !== false;
      const v = show ? 'visible' : 'hidden';
      el.attr('headerBottom/visibility', v);
      el.attr('headerBottomAccent/visibility', v);
      el.attr('labelBottom/visibility', v);
      el.attr('underlineBottom/visibility', v);
      // Rebuild ports so the symmetric [headerOffset, h - bottomOffset] port
      // distribution (added alongside the bottom-label feature) applies to
      // older participants that were saved with the old top-only spacing.
      // Skip when the user customised port ratios so we don't trample edits.
      if (!el.get('lifelinePortRatios')) {
        const n = el.get('lifelinePortCount') || 5;
        joint.shapes.sf.rebuildSeqParticipantPorts?.(el, n);
      }
    }
    // SequenceActor: the shape defaults hide the lifeline + its hitbox and
    // ship with an empty port list, so importing a JSON that sets
    // `showLifeline: true` leaves the actor stuck looking collapsed until the
    // user toggles visibility in the properties panel — and that toggle
    // rewrites the port list, which can detach any links still pointing at
    // the original port IDs. Realize the stored state here so imports and
    // session restores match what the author saved.
    if (el.get('type') === 'sf.SequenceActor' && el.get('showLifeline')) {
      el.attr('lifeline/visibility', 'visible');
      el.attr('lifelineHitbox/visibility', 'visible');
      el.attr('lifelineHitbox/magnet', true);
      // Only seed ports when none were saved — preserves link endpoints when
      // the JSON already ships the port list.
      const items = el.prop('ports/items');
      if (!Array.isArray(items) || items.length === 0) {
        const n = el.get('lifelinePortCount') || 5;
        const ratios = el.get('lifelinePortRatios');
        joint.shapes.sf.rebuildSeqActorPorts?.(el, n, ratios);
      }
    }
  }
  // Regenerate icon data URIs so all icons use current normalized viewBoxes
  refreshAllIconHrefs();
}

function migrateContainer(el) {
  const accentW = el.attr('accent/width');
  // Old containers had accent width=4 (left bar) — migrate to top bar
  if (accentW === 4 || accentW === '4') {
    const accentColor = el.attr('accent/fill') || 'var(--color-primary)';
    el.attr({
      accent: { x: 1, y: 1, width: 'calc(w - 2)', height: 40, rx: 11, ry: 11, fill: accentColor },
      accentFill: { x: 1, y: 20, width: 'calc(w - 2)', height: 21, fill: accentColor },
      headerIcon: { x: 12, y: 9 },
      headerLabel: { x: 44, y: 21, fill: '#FFFFFF' },
      headerSubtitle: { y: 50 },
    });
  }
  // Ensure accentFill exists for containers that don't have it yet
  if (!el.attr('accentFill/fill')) {
    const accentColor = el.attr('accent/fill') || 'var(--color-primary)';
    el.attr('accentFill/fill', accentColor);
  }
}

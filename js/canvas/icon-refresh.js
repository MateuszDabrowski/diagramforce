// Icon refresh — regenerate SLDS icon data-URIs on canvas elements. Extracted from
// canvas.js (Phase 4 / S7 slice 2). setIconDataUriFn injects the generator; app.js wires it
// BEFORE canvas.init(), so it stays a plain module-scope setter (never init-gated / cctx-wired).
// refreshIcons re-colours SimpleNode icons after a theme switch; refreshAllIconHrefs regenerates
// every element's icon (current normalized viewBoxes). registerIconRefresh(cctx) exposes
// refreshAllIconHrefs + freqClockUri (the frequency-label clock-glyph builder used by the inline
// link-styles frequency label) on cctx. Reads the live graph via cctx.
import { cctx } from './context.js?v=1.22.1';

let _iconDataUriFn = null;
export function setIconDataUriFn(fn) { _iconDataUriFn = fn; }

export function refreshIcons() {
  if (!_iconDataUriFn) return;
  // After theme switch, update icon data URIs on elements using default label color
  const nodeText = getComputedStyle(document.documentElement).getPropertyValue('--node-text').trim();
  if (!nodeText) return;
  for (const el of cctx.graph.getElements()) {
    const type = el.get('type');
    if (type === 'sf.SimpleNode') {
      const iconHref = el.attr('icon/href');
      if (!iconHref) continue;
      // Only update icons whose label is still using the default (CSS var) color
      const labelFill = el.attr('label/fill');
      if (labelFill && !labelFill.startsWith('var(')) continue; // custom color, skip
      // Extract icon ID and regenerate with new theme color
      const idMatch = iconHref.match(/data-icon-id(?:%3D|=)(?:%22|")([^%"]+)(?:%22|")/);
      if (idMatch) {
        const iconId = decodeURIComponent(idMatch[1]);
        el.attr('icon/href', _iconDataUriFn(iconId, nodeText));
      }
    }
  }
}

// Mirrors PLACEHOLDER_INK in js/shapes/core.js - the df.Placeholder ? is a fixed mid-grey, not a themed colour.
const PLACEHOLDER_INK = '#747474';

/** Regenerate ALL icon data URIs on canvas elements so they use current normalized viewBoxes. */
function refreshAllIconHrefs() {
  if (!_iconDataUriFn) return;
  for (const el of cctx.graph.getElements()) {
    const type = el.get('type');
    if (type === 'sf.SimpleNode') {
      _refreshElementIcon(el, 'icon/href', 'label/fill');
    } else if (type === 'sf.Container') {
      _refreshElementIcon(el, 'headerIcon/href', null, '#FFFFFF');
    } else if (type === 'sf.DataObject') {
      // Optional header icon (Account/Contact/Snowflake…) — white, like the Container's,
      // matching the white header label on the coloured header bar.
      _refreshElementIcon(el, 'headerIcon/href', null, '#FFFFFF');
    } else if (type === 'sf.Note') {
      // The Note icon (light-bulb by default) was being lost on the save round-trip: slimForShare keeps only a
      // `data-icon-id` placeholder, and this loop skipped Notes - so the placeholder never re-resolved to the
      // full SVG (it rendered empty). Re-resolve it from label/fill (the note text colour). An empty href -
      // i.e. a user-cleared icon - no-ops in _refreshElementIcon, so cleared notes stay cleared. (item 1.2)
      _refreshElementIcon(el, 'icon/href', 'label/fill');
    } else if (type === 'df.Placeholder') {
      // Intrinsic to the type (a ? in a fixed grey), so re-resolve it like a flow icon rather than from a
      // label colour. Without this branch it renders empty after a reload - initialize() only bakes an EMPTY
      // href, and the save leaves a non-empty `data-icon-id` placeholder behind.
      _refreshElementIcon(el, 'icon/href', null, PLACEHOLDER_INK);
    } else if (type.startsWith('df.Flow')) {
      // Flow element icons are ALWAYS white on the coloured/circular chip (intrinsic to the element type). The save
      // slims the baked data URI to a `data-icon-id` placeholder; without this branch it never re-resolved on load
      // (the shape's initialize() only bakes when the href is EMPTY, and a placeholder isn't) - so every flow icon
      // rendered broken after a reload until the element was re-dropped. Re-resolve it to white here.
      _refreshElementIcon(el, 'icon/href', null, '#FFFFFF');
    }
  }
}

function _refreshElementIcon(el, hrefAttr, fillAttr, defaultColor) {
  const iconHref = el.attr(hrefAttr);
  if (!iconHref) return;
  const idMatch = iconHref.match(/data-icon-id(?:%3D|=)(?:%22|")([^%"]+)(?:%22|")/);
  if (!idMatch) return;
  const iconId = decodeURIComponent(idMatch[1]);
  // Determine the icon color from the element's text color or the default
  let color = defaultColor;
  if (!color) {
    const labelFill = fillAttr ? el.attr(fillAttr) : null;
    color = (labelFill && !labelFill.startsWith('var('))
      ? labelFill
      : getComputedStyle(document.documentElement).getPropertyValue('--node-text').trim() || '#FFFFFF';
  }
  el.attr(hrefAttr, _iconDataUriFn(iconId, color));
}

export function registerIconRefresh(cctx) {
  cctx.refreshAllIconHrefs = refreshAllIconHrefs;
  // The frequency-label overlay's clock glyph (inline link-styles reads cctx.freqClockUri).
  cctx.freqClockUri = (color) => (_iconDataUriFn ? _iconDataUriFn('clock', color, 24) : '');
}

// THE colour rule for every hex a CONVERTER chooses, and the palette that satisfies it.
//
// ── The rule ────────────────────────────────────────────────────────────────────────────────────────────────
// A converter-chosen colour is painted on the CANVAS, and the canvas is `--bg-canvas`, which is #FAFAFA in the
// light theme and #1A1A1A in the dark one. A diagram is shared as a URL and opened by someone else in the
// OTHER theme, so a colour that only works on one of them is a colour that only works for its author. Every
// entry here therefore clears WCAG's 3:1 non-text-contrast floor against BOTH backgrounds, and is authored at
// >= 3.5 so a later nudge does not silently drop under.
//
// This is not a style preference. A card headerColor is also the CONNECTOR colour (objects-to-diagramforce.mjs
// paints a relationship in the accent of the child card), and a connector is a 2px line, not a filled header:
// #321D71 scored 1.28:1 on dark, which is invisible, so a palette bug shipped as a connector bug.
//
// ── Why these values ────────────────────────────────────────────────────────────────────────────────────────
// "Passes on both" is a narrow band, and the maths says so: at contrast >= 3.5 both ways the relative
// luminance must sit in [0.157, 0.239], and the best any single colour can do on both at once is 4.13:1. So
// every entry is pinned near L* 50 and the separation has to come from HUE and CHROMA, not lightness - which
// is why this is a hand-tuned wheel rather than a lightened copy of the old values. Hues were placed by
// coordinate ascent on the minimum pairwise CIE76 deltaE; the result is 26.8, comfortably past the ~10 where
// two swatches stop being confusable. A palette that passes the contrast maths and reads as seven muddy greys
// would be a worse failure than the one it replaced.
//
// `blue` and `red` are the PREVIOUS values, kept byte-for-byte: they already cleared both floors (4.63/3.60
// and 3.87/4.31), and they are load-bearing elsewhere - `blue` is the default headerColor, the ERD's
// LINK_COLOR, the Source/Data Stream layer accent and the brand-swatch seed.
//
// ── How this file is consumed ───────────────────────────────────────────────────────────────────────────────
// ZERO IMPORTS, like flow-convert.js and datagraph-convert.js, and hand-copied to
// cowork-skill/diagramforce/scripts/ (dev/tests/skill-sync.test.js enforces byte-identity).
//
//   · The CLI-only `.mjs` scripts IMPORT this file directly - they are plain Node ESM with no `?v=` rewriting.
//   · The three hand-copied converters (datagraph-convert.js, mapping-convert.js, flow-convert.js) CANNOT
//     import it: the app rewrites every local specifier to `./x.js?v=<cache key>`, and that key must never
//     reach the skill's copy. They RESTATE the literals instead - the same treatment flow-convert.js already
//     gives the geometry constants it mirrors from js/shapes/flow.js - and dev/tests/diagram-palette.test.js
//     asserts every restated literal still equals the value here. That turns the hand-copy from a hope into a
//     checked invariant, which is more than the geometry constants get.
//   · App modules may import it normally (`./persistence/diagram-palette.js?v=<key>`); importing it is safe
//     for the byte-identity contract because the contract is about what THIS file imports, not who imports it.
//     The first app-side importer must also add it to sw.js PRECACHE_URLS - version-consistency.test.js fails
//     if it does not.

/** The canvas the rule is measured against: `--bg-canvas` in css/variables.css and css/theme.css. */
export const DF_CANVAS_BG = { light: '#FAFAFA', dark: '#1A1A1A' };

/** WCAG's non-text floor. 3.0 is the hard gate the test enforces; entries are authored at >= 3.5. */
export const DF_CONTRAST_FLOOR = 3.0;

// Named wheel. Every entry: >= 3.5:1 on both canvases, L* ~50, min pairwise deltaE 26.8.
// The trailing three are not accents - see their own exports below.
export const DF_COLORS = {
  blue:   '#1D73C9', // unchanged - default headerColor / ERD link / Source layer
  orange: '#BE5C2A',
  green:  '#008B46',
  purple: '#B652A7',
  cyan:   '#00849E',
  red:    '#DA4E55', // unchanged - DMO layer
  indigo: '#8467C9',
  teal:   '#008877',
  amber:  '#A06F03',
  olive:  '#747F00',
};

// The accent cycle, ORDERED so that any prefix works: adjacent entries are the ones a reader sees side by side
// (a data graph colours by tree depth, an ERD by object index), so the order maximises ADJACENT separation
// rather than merely average separation. Adjacent deltaE >= 72 through the first eight; the amber/olive pair
// at 29.7 sits last precisely because it is the weakest.
// Take a prefix: the data graph needs 7 (one per depth), the ERD 8 (one per object).
export const DF_ACCENT_CYCLE = [
  DF_COLORS.blue, DF_COLORS.orange, DF_COLORS.green, DF_COLORS.purple, DF_COLORS.cyan,
  DF_COLORS.red, DF_COLORS.indigo, DF_COLORS.teal, DF_COLORS.amber, DF_COLORS.olive,
];

// Severity, benign -> severe. Drawn from the SAME wheel on purpose: a second palette would be a second thing
// to keep in contrast, and a ramp built from unrelated colours reads as categories, not as degrees. Lightness
// is unavailable as the ramp axis (it is what the contrast rule pins), so the ramp runs green -> red round the
// hue wheel, which is the direction a reader already knows.
export const DF_SEVERITY_RAMP = [
  DF_COLORS.green, DF_COLORS.olive, DF_COLORS.amber, DF_COLORS.orange, DF_COLORS.red,
];

/** Deliberately plain: object-level ER relationships in a mapping diagram, which must not compete with the
 *  amber field connectors running between the same two cards. Chroma 4, so it reads as structure, not accent.
 *  Replaces #98A2B3, which was 2.47:1 on the light canvas. */
export const DF_NEUTRAL_LINK = '#74797F';

/** WCAG's normal-text floor. A badge label is 12px bold, which is NOT "large text" (>= 18.66px bold or 24px),
 *  so 4.5 applies and 3.0 does not. Kept separate from DF_CONTRAST_FLOOR because they measure different things:
 *  that one is a MARK against the canvas, this one is a LABEL against the mark. */
export const DF_TEXT_CONTRAST_FLOOR = 4.5;

// Ink for a label painted ON a palette fill - a df.Pill badge, or anything else that puts text inside an accent.
// These two are NOT in DF_COLORS and must never be: they are foregrounds, and measuring them against the canvas
// (#000000 scores 1.20:1 on the dark one) applies a rule they have no business being held to.
export const DF_INK_DARK = '#000000';
export const DF_INK_LIGHT = '#FFFFFF';

/** Salesforce's own brand red, kept because a Flow fault path should be Flow Builder's red and not ours.
 *  It clears both floors as-is (4.45 / 3.74), so the rule costs nothing here. */
export const DF_SF_RED = '#EA001E';

/** sRGB relative luminance, WCAG 2.x definition. Inlined rather than imported - this module has no imports. */
export function relativeLuminance(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => v / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio between two hex colours, 1..21. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The rule itself, executable: does this colour clear the floor on BOTH canvases? */
export function passesBothThemes(hex, floor = DF_CONTRAST_FLOOR) {
  return contrastRatio(hex, DF_CANVAS_BG.light) >= floor
      && contrastRatio(hex, DF_CANVAS_BG.dark) >= floor;
}

/**
 * Pick the readable ink for a label painted ON `fill`. A FUNCTION and not a constant, because on this wheel
 * there is no single right answer - and the reason is the same arithmetic that produced the wheel.
 *
 * Clearing 3.5:1 on both canvases pins an entry's relative luminance to [0.160, 0.240]; white ink at 4.5:1 needs
 * <= 0.183, black needs >= 0.175. Both sub-bands are non-empty and they barely overlap, so the ink follows the
 * fill rather than the other way round. Nine of the ten accents were placed mid-band at ~0.189 and take BLACK
 * (4.75-5.20; white there would be 4.04-4.42 and FAIL, which is why the obvious white-on-colour badge is wrong
 * here). `blue` is the one entry carried over byte-for-byte from the old palette, sits lower at 0.167, and takes
 * WHITE (4.83; black would be 4.35 and fail).
 *
 * So a converter painting text on a fill calls this rather than hardcoding a colour, and asserts the result over
 * its OWN fill set - the palette cannot make that claim on a converter's behalf. A future accent where neither
 * ink clears 4.5 has to move the fill; dev/tests/diagram-palette.test.js fails when one appears.
 */
export function onAccentInk(fill) {
  return contrastRatio(fill, DF_INK_DARK) >= contrastRatio(fill, DF_INK_LIGHT) ? DF_INK_DARK : DF_INK_LIGHT;
}

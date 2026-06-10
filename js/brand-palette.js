// Brand palette — persistent user-defined color swatches surfaced inside
// every property-panel color picker.  Per-browser (localStorage), not
// per-diagram, so a user's brand colors carry across every diagram they
// open.  CRUD only — UI integration lives in properties.js → addColor().
//
// Storage shape:
//   localStorage['sfdiag::brandColors'] = JSON.stringify(['#1D73C9', ...])
//
// Hex values are normalised to lowercase 6-char hex on the way in
// (`#rgb` → `#rrggbb`, `#RRGGBBAA` → `#rrggbb` truncated) so duplicate
// detection works regardless of how the picker hands the value back.

const LS_KEY = 'sfdiag::brandColors';
const SEED_FLAG = 'sfdiag::brandColorsSeeded';
const MAX_SLOTS = 12;
const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// Swatches every user gets pre-loaded (v1.15.7): brand red, accent amber, success green,
// brand blue, plus white (`#FFFFFF`) and the app's near-black (`#1C1E21` — the same value
// `--text-primary` / `--node-text` / the auto-contrast dark text use, so "black" matches what
// the app paints elsewhere). Seeded ONCE per browser (SEED_FLAG) and fully removable — once
// seeded they behave like any user-saved swatch, so deleting one keeps it gone (the flag stops
// it ever being re-added).
const DEFAULT_BRAND_COLORS = ['#da4e55', '#f6b355', '#27ae60', '#1d73c9', '#ffffff', '#1c1e21'];

const listeners = new Set();

/** Normalise any hex variant to lowercase 6-char `#rrggbb`. Returns null
 *  for non-hex input so callers can decide whether to fall through. */
function normaliseHex(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!HEX_RE.test(s)) return null;
  const h = s.replace(/^#/, '').toLowerCase();
  if (h.length === 3) return '#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length === 4) return '#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; // strip alpha
  if (h.length === 8) return '#' + h.slice(0, 6);                            // strip alpha
  return '#' + h;
}

/** Read the palette from localStorage. Returns a defensive copy so callers
 *  can't mutate the stored array by accident. Safe in private-mode browsers
 *  (returns []) and bad JSON (returns []). */
export function getPalette() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Filter to known-good entries, dedupe, cap to MAX_SLOTS.
    const seen = new Set();
    const out = [];
    for (const item of arr) {
      const norm = normaliseHex(item);
      if (norm && !seen.has(norm)) {
        seen.add(norm);
        out.push(norm);
        if (out.length >= MAX_SLOTS) break;
      }
    }
    return out;
  } catch {
    return [];
  }
}

function writePalette(arr) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(arr));
  } catch {
    /* private mode or quota — swallow; the in-memory call still resolved */
  }
  notifyListeners();
}

/** Add a color to the front of the palette. Duplicates are deduped (the
 *  existing entry is moved to the front). When the palette is full the
 *  oldest entry drops off the back — newest first, ringbuffer style.
 *  Returns true if the palette changed, false if the input was rejected
 *  (non-hex) or was already at the front. */
export function addToPalette(hex) {
  const norm = normaliseHex(hex);
  if (!norm) return false;
  const current = getPalette();
  // No-op if it's already the front entry (saves a write).
  if (current[0] === norm) return false;
  // Remove any existing copy further down so addToPalette doubles as
  // "promote to front".
  const next = [norm, ...current.filter(c => c !== norm)].slice(0, MAX_SLOTS);
  writePalette(next);
  return true;
}

/** Remove a color from the palette. Returns true if it was present. */
export function removeFromPalette(hex) {
  const norm = normaliseHex(hex);
  if (!norm) return false;
  const current = getPalette();
  const next = current.filter(c => c !== norm);
  if (next.length === current.length) return false;
  writePalette(next);
  return true;
}

/** Subscribe to palette changes. Called with the new palette on every
 *  add/remove. Returns an unsubscribe function. Used by open color pickers
 *  to repaint their swatch strip when the palette changes elsewhere
 *  (e.g., the same picker on another property field added a color). */
export function onPaletteChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notifyListeners() {
  const snap = getPalette();
  for (const cb of listeners) {
    try { cb(snap); } catch { /* listener bug — don't break the others */ }
  }
}

/** Seed the palette defaults — appending any default NOT yet offered on this browser (after the
 *  user's own colours, so a curated palette isn't disturbed), then recording the full default set.
 *  The flag stores WHICH defaults were offered, not a single boolean: that lets a later release add
 *  NEW defaults (e.g. white + the app-black in v1.15.7) to users who already seeded the original
 *  four — while a default the user removed stays removed (it was offered, so never re-added).
 *  Call once at startup. */
export function seedDefaultPalette() {
  try {
    let seeded = null;
    try { seeded = JSON.parse(localStorage.getItem(SEED_FLAG) || 'null'); } catch { seeded = null; }
    // Back-compat: the original flag was the boolean `1` (= "the four brand colours were offered").
    if (seeded === 1 || seeded === true) seeded = ['#da4e55', '#f6b355', '#27ae60', '#1d73c9'];
    const offered = new Set((Array.isArray(seeded) ? seeded : []).map(normaliseHex).filter(Boolean));

    const toSeed = DEFAULT_BRAND_COLORS.filter(c => !offered.has(c));   // defaults never offered here
    if (toSeed.length) {
      const merged = [...getPalette()];                                 // user colours first
      for (const c of toSeed) if (!merged.includes(c)) merged.push(c);  // append the unoffered defaults
      writePalette(merged.slice(0, MAX_SLOTS));                         // cap; user colours win a full palette
    }
    // Record every current default as offered — removals now stick, and we never re-add.
    localStorage.setItem(SEED_FLAG, JSON.stringify([...new Set([...offered, ...DEFAULT_BRAND_COLORS])]));
  } catch {
    /* private mode / quota — skip seeding, nothing persists anyway */
  }
}

export const PALETTE_MAX_SLOTS = MAX_SLOTS;

// Canvas accessibility.
//
// The JointJS canvas is an SVG that's opaque to assistive tech — shapes have no accessible
// name/role, and the diagram can't be reached by keyboard. This module bridges both gaps:
//
//   Phase A — announce the current selection through an sr-only `aria-live` region, so a screen
//             reader speaks what's selected as it changes.
//   Phase B — make the canvas keyboard-navigable: one Tab stop; Tab / Shift+Tab rove a selection
//             through the cells (each announced); arrows still nudge; Enter opens the inspector;
//             Escape leaves. Edge-release (no preventDefault at the ends) = no keyboard trap.
//   Phase C — a whole-diagram text outline: an sr-only landmark (`#a11y-outline`) holding the
//             diagram's structure as nested lists (shapes by containment) + a connections list,
//             so a screen reader user can READ the diagram on demand (heading/landmark nav)
//             instead of only hearing one selected shape at a time. Rebuilt, debounced, only when
//             the SR-relevant content actually changes (so cursor position survives style/move
//             edits). NOT a live region — silent; reached on demand.
//
// Pure overlay — reads graph/selection, drives selection + offscreen nodes. Never mutates the
// diagram or history. The "describe a shape" knowledge lives in properties.js (the inspector
// already owns the type→label map + name accessors); we just narrate + navigate + outline.
import { describeCell, cellName } from './properties.js?v=1.18.1';
import { escHtml } from './util.js?v=1.18.1';

let graph = null;
let selection = null;
let liveEl = null;
let canvasEl = null;
let outlineEl = null;
let outlineTimer = null;
let lastOutlineHtml = '';

export function init(modules) {
  graph = modules.graph;
  selection = modules.selection;
  liveEl = document.getElementById('a11y-live');
  // Announce on every selection change (mouse, marquee, keyboard, paste, programmatic).
  selection?.onChange?.(announceSelection);
  setupKeyboardNav();
  setupOutline();
}

// ── Phase A: selection narration ──────────────────────────────────────────────

/**
 * Speak `msg` via the polite live region. Clear first, then set on the next frame, so an
 * identical or rapid follow-up message still re-announces (assistive tech only re-reads on a
 * real text mutation — same trick the toast a11y fix uses).
 */
export function announce(msg) {
  if (!liveEl || !msg) return;
  liveEl.textContent = '';
  requestAnimationFrame(() => { if (liveEl) liveEl.textContent = msg; });
}

/** Announce the current selection ("Selected Object: Contact" / "3 items selected"). */
export function announceSelection() {
  const ids = selection?.getSelectedIds?.() || [];
  if (ids.length === 0) return;                 // deselect → stay quiet (no "nothing" chatter)
  if (ids.length === 1) {
    const cell = graph?.getCell?.(ids[0]);
    if (cell) announce(`Selected ${describeCell(cell)}`);
  } else {
    announce(`${ids.length} items selected`);
  }
}

// ── Phase B: keyboard canvas navigation ───────────────────────────────────────
// The canvas is ONE tab stop. While it's focused: Tab / Shift+Tab move a roving selection
// through the cells in graph order (each announced via Phase A); arrow keys still nudge the
// selected shape (keyboard.js, unchanged — this handler ignores them); Enter jumps into the
// properties panel; Escape clears + leaves. At the first/last cell we DON'T preventDefault, so
// focus releases to the surrounding chrome — the user is never trapped (WCAG 2.1.2).

function setupKeyboardNav() {
  canvasEl = document.getElementById('canvas-container');
  if (!canvasEl) return;
  canvasEl.tabIndex = 0;   // one tab stop for the whole canvas
  // Instructions live in the label so the screen reader reads them on focus — no JS focus
  // announcement needed, which avoids clashing with the mouse-click selection announcement.
  canvasEl.setAttribute(
    'aria-label',
    'Diagram canvas. Press Tab and Shift Tab to move between shapes; arrow keys nudge the '
    + 'selected shape; Enter opens its properties; Delete removes it. A text outline of the whole '
    + 'diagram is available in the Diagram outline region.',
  );
  canvasEl.addEventListener('keydown', onCanvasKeydown);
}

/**
 * Move the roving selection by `delta` (+1 next / −1 previous) through the cells in graph order.
 * Returns true if it moved (caller preventDefaults to stay in the canvas), false at an edge
 * (caller lets the browser move focus out — no keyboard trap).
 */
function navBy(delta) {
  const cells = graph?.getCells?.() || [];
  if (!cells.length) return false;
  const ids = selection?.getSelectedIds?.() || [];
  const idx = ids.length === 1 ? cells.findIndex((c) => c.id === ids[0]) : -1;
  const next = idx === -1 ? (delta > 0 ? 0 : cells.length - 1) : idx + delta;
  if (next < 0 || next >= cells.length) return false;     // past an edge → release focus
  selection?.selectOnly?.(cells[next].id);                // selects + announces via onChange
  return true;
}

function onCanvasKeydown(e) {
  if (e.target !== canvasEl) return;          // only when the canvas itself holds focus
  if (e.key === 'Tab') {
    if (navBy(e.shiftKey ? -1 : 1)) e.preventDefault();   // moved → stay; edge → let focus leave
  } else if (e.key === 'Enter') {
    if ((selection?.getSelectedIds?.() || []).length) {
      e.preventDefault();
      document.querySelector(
        '#properties-panel input, #properties-panel textarea, #properties-panel select, #properties-panel button',
      )?.focus();
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    selection?.clearSelection?.();
    canvasEl.blur();
  }
}

// ── Phase C: whole-diagram outline ────────────────────────────────────────────
// An sr-only landmark (`#a11y-outline`) mirroring the diagram as text: shapes nested by
// containment, then the connections list. Lets a screen reader user READ the whole structure via
// heading + list navigation, instead of hearing only the one selected shape (Phase A). Rebuilt —
// debounced AND content-deduped — on any structural / containment / wiring / label change. It is
// deliberately NOT wired to move/resize/restyle: those leave the text identical, and the dedupe
// guard then skips the DOM write, so an SR user's reading position is never yanked mid-read.

function setupOutline() {
  outlineEl = document.getElementById('a11y-outline');
  if (!outlineEl || !graph) return;
  // Broad event set on purpose — the content-dedupe in buildOutline() makes redundant fires
  // (e.g. a `change:attrs` from a colour tweak that doesn't touch a label) effectively free.
  graph.on(
    'add remove reset '
    + 'change:parent change:embeds change:source change:target '
    + 'change:attrs change:labels change:objectName change:_savedLabel change:iconMode',
    scheduleOutline,
  );
  buildOutline();   // initial paint — covers a diagram restored from session before init ran
}

function scheduleOutline() {
  clearTimeout(outlineTimer);
  outlineTimer = setTimeout(buildOutline, 400);
}

/** Render one element as an <li>, recursing into its embedded (non-link) children. */
function renderOutlineNode(el) {
  const kids = (el.getEmbeddedCells?.() || []).filter((c) => !c.isLink?.());
  const childList = kids.length ? `<ul>${kids.map(renderOutlineNode).join('')}</ul>` : '';
  return `<li>${escHtml(describeCell(el))}${childList}</li>`;
}

/**
 * Rebuild the outline DOM from the current graph. Top-level (un-parented) elements form a nested
 * list by containment; links are flattened into a "Connections" list ("A connects to B (label)").
 * Skips the write when the rendered HTML is unchanged (see the no-yank rationale above).
 */
export function buildOutline() {
  if (!outlineEl || !graph) return;
  const cells = graph.getCells?.() || [];
  const elements = cells.filter((c) => !c.isLink?.());
  const links = cells.filter((c) => c.isLink?.());

  let html;
  if (!elements.length && !links.length) {
    html = '<h2>Diagram outline</h2><p>The diagram is empty.</p>';
  } else {
    const topLevel = elements.filter((el) => !el.getParentCell?.());
    const shapesSection = elements.length
      ? `<h3>Shapes (${elements.length})</h3><ul>${topLevel.map(renderOutlineNode).join('')}</ul>`
      : '';
    const connSection = links.length
      ? `<h3>Connections (${links.length})</h3><ul>${links.map((l) => {
        const from = cellName(l.getSourceCell?.()) || 'an unattached point';
        const to = cellName(l.getTargetCell?.()) || 'an unattached point';
        const label = cellName(l);
        return `<li>${escHtml(`${from} connects to ${to}${label ? ` (${label})` : ''}`)}</li>`;
      }).join('')}</ul>`
      : '';
    const summary = `${elements.length} shape${elements.length === 1 ? '' : 's'}, `
      + `${links.length} connector${links.length === 1 ? '' : 's'}.`;
    html = `<h2>Diagram outline</h2><p>${summary}</p>${shapesSection}${connSection}`;
  }

  if (html === lastOutlineHtml) return;   // no SR-relevant change → leave the reading cursor alone
  lastOutlineHtml = html;
  outlineEl.innerHTML = html;
}

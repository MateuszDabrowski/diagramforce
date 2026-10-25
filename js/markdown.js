// Inline-markdown parser for sf.TextLabel and sf.Note (CR-6.1, v1.12.0)
//
// A deliberately tiny subset:
//   **bold**     → <strong>bold</strong>
//   *italic*     → <em>italic</em>
//   ~~strike~~   → <del>strike</del>
//   `code`       → <code>code</code>
//
// NOTE: underscores are deliberately NOT markdown markers — `_` renders
// literally so system field/object names (`My_Field__c`, `Account__r`) are
// never italicised. The hint under the input advertises only `*` / `**`.
//
// Security invariant: the raw input passes through escHtml() BEFORE any regex
// substitutions, so user text can never inject markup. Only the whitelisted
// markers above are recognised and only the four whitelisted tags are produced.
// No tag has attributes, so attribute-based XSS vectors are also closed off.
//
// The regex pass order is fixed and intentional (per CR-6.1):
//   bold → italic → strike → code
// Bold must run before italic so `**word**` doesn't get misinterpreted as
// `<em>*word*</em>`. Code last is suboptimal in theory (markers inside a
// `` `code` `` block also get interpreted), but matches the CR spec exactly.

// escHtml is the shared security primitive (js/util.js — itself dependency-free,
// so this module gains no transitive deps). It runs FIRST in parseMarkdown so
// user text can never inject markup.
import { escHtml } from './util.js?v=1.26.4';

/**
 * Convert plain text with inline markdown markers to HTML. Safe for innerHTML.
 *
 * - Bold and italic are non-greedy and don't span newlines (the `.` doesn't
 *   match `\n` by default), so unbalanced markers across lines aren't
 *   swallowed.
 * - Underscore (`_`) is NOT a marker — it renders literally, so system field
 *   names like `My_Field__c` are never mangled.
 * - Empty / non-string input returns an empty string.
 */
export function parseMarkdown(text) {
  if (text == null || text === '') return '';
  let html = escHtml(text);
  // Order matters: bold → italic → strike → code. See header note.
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?:^|(?<=[^*]))\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Convert hard line breaks to <br> AFTER inline-mark substitution so the
  // markers can't span across lines. CSS `white-space: pre-wrap` alone is
  // unreliable inside a flex-centred foreignObject — using <br> is
  // browser-universal and easier for replaceForeignObjects() to walk during
  // export (a <br> child node maps cleanly to a tspan line break).
  html = html.replace(/\n/g, '<br>');
  return html;
}

/**
 * Toggle the given pair of marker tokens around the user's text selection
 * inside a textarea/input. Used by the properties-panel keyboard shortcuts
 * (Cmd+B, Cmd+I, etc.). When the markers already sit just outside the
 * selection (where a wrap leaves it), they are removed; otherwise the
 * selection is wrapped. When the selection is empty, inserts the pair at the
 * cursor and re-positions the caret between them so the user can type
 * immediately (a second press removes the empty pair).
 *
 * Returns true if the input was modified (caller fires an 'input' event so
 * the standard property-update + history pipeline captures the change).
 */
export function wrapSelectionWithMarker(inputEl, marker) {
  if (!inputEl) return false;
  const start = inputEl.selectionStart ?? 0;
  const end = inputEl.selectionEnd ?? 0;
  const value = inputEl.value ?? '';
  const before = value.slice(0, start);
  const selected = value.slice(start, end);
  const after = value.slice(end);
  // A second press un-wraps. It used to wrap again: Cmd+B twice gave
  // '****bold****', rendered with stray asterisks (review I13).
  const n = isWrappedBy(before, after, marker) ? -marker.length : marker.length;
  inputEl.value = n < 0
    ? `${before.slice(0, n)}${selected}${after.slice(-n)}`
    : `${before}${marker}${selected}${marker}${after}`;
  // Re-select the previously-selected text (shifted by the marker length) so
  // the user can immediately re-trigger to toggle back or chain another marker.
  inputEl.setSelectionRange(start + n, end + n);
  return true;
}

/**
 * True when `marker` already wraps the selection from just outside it.
 * Asterisks are read as runs (1 italic, 2 bold, 3 both), so '*' toggles an odd
 * run and never takes one half of a bold pair, and '**' needs a run of 2+.
 */
function isWrappedBy(before, after, marker) {
  if (marker[0] !== '*') return before.endsWith(marker) && after.startsWith(marker);
  const k = before.length - before.replace(/\*+$/, '').length;
  const m = after.length - after.replace(/^\*+/, '').length;
  return marker === '*' ? (k % 2 === 1 && m % 2 === 1) : (k >= 2 && m >= 2);
}

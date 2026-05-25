// Inline-markdown parser for sf.TextLabel and sf.Note (CR-6.1, v1.12.0)
//
// A deliberately tiny subset:
//   **bold**     → <strong>bold</strong>
//   *italic*     → <em>italic</em>
//   _italic_     → <em>italic</em>
//   ~~strike~~   → <del>strike</del>
//   `code`       → <code>code</code>
//
// Security invariant: the raw input passes through escHtml() BEFORE any regex
// substitutions, so user text can never inject markup. Only the literal six
// tokens above are recognised and only the four whitelisted tags are produced.
// No tag has attributes, so attribute-based XSS vectors are also closed off.
//
// The regex pass order is fixed and intentional (per CR-6.1):
//   bold → italic → strike → code
// Bold must run before italic so `**word**` doesn't get misinterpreted as
// `<em>*word*</em>`. Code last is suboptimal in theory (markers inside a
// `` `code` `` block also get interpreted), but matches the CR spec exactly.

/**
 * HTML-escape a string so the markdown pass can safely emit it into innerHTML.
 * Kept inline (rather than imported from persistence.js) so this module has
 * zero internal dependencies — anything that wants to format text just needs
 * to import `parseMarkdown`.
 */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Convert plain text with inline markdown markers to HTML. Safe for innerHTML.
 *
 * - Bold and italic are non-greedy and don't span newlines (the `.` doesn't
 *   match `\n` by default), so unbalanced markers across lines aren't
 *   swallowed.
 * - Underscore italic is supported alongside `*` italic so `_foo_` works.
 * - Empty / non-string input returns an empty string.
 */
export function parseMarkdown(text) {
  if (text == null || text === '') return '';
  let html = escHtml(text);
  // Order matters: bold → italic → strike → code. See header note.
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?:^|(?<=[^*]))\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
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
 * Wrap the user's text selection inside a textarea/input with the given pair
 * of marker tokens. Used by the properties-panel keyboard shortcuts (Cmd+B,
 * Cmd+I, etc.). When the selection is empty, inserts the pair at the cursor
 * and re-positions the caret between them so the user can type immediately.
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
  inputEl.value = `${before}${marker}${selected}${marker}${after}`;
  // Re-select the previously-selected text (now offset by marker length) so
  // the user can immediately re-trigger to un-wrap or chain another marker.
  const newStart = start + marker.length;
  const newEnd = end + marker.length;
  inputEl.setSelectionRange(newStart, newEnd);
  return true;
}

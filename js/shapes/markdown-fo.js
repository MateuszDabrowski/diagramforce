// Markdown foreignObject helper (CLEANUP S3, CR-6.1) — sf.TextLabel/Note render inline markdown as native HTML
// inside an SVG <foreignObject>. Moved out of shapes.js so every registrar view can call it.
import { parseMarkdown } from '../markdown.js?v=1.22.0';

// ── Markdown foreignObject helper (CR-6.1) ─────────────────────────
// sf.TextLabel and sf.Note render their text as native HTML inside an SVG
// <foreignObject> so inline markdown markers (**bold**, *italic*, ~~strike~~,
// `code`) round-trip through to visible markup. Raster export then converts
// the FO + HTML back into tspans via persistence.js → replaceForeignObjects.
//
// Idempotent — finds an existing FO by `data-md` marker or creates one. Safe
// to call from initialize/render/update without leaking DOM.
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
export const SVG_NS_SHAPES = 'http://www.w3.org/2000/svg';

// The non-markdown path (see `opts.plain` below). Mirrors what parseMarkdown does BEFORE its marker pass, so
// plain and markdown cells escape identically and differ only in marker interpretation.
const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapePlain = (text) => String(text ?? '')
  .replace(/[&<>"']/g, (c) => HTML_ESC[c])
  .replace(/\n/g, '<br>');

export function ensureMarkdownFO(view, key, text, opts) {
  if (!view?.el) return;
  let fo = view.el.querySelector(`:scope > foreignObject[data-md="${key}"]`);
  if (!fo) {
    fo = document.createElementNS(SVG_NS_SHAPES, 'foreignObject');
    fo.setAttribute('data-md', key);
    // v1.12.1 — pointer-events:none on the FO itself so clicks pass
    // through to the SVG geometry beneath (hitArea on TextLabel /
    // Annotation, body on Note, header on DataObject, etc.). The
    // previous `pointer-events="all"` made the FO catch clicks but
    // didn't reliably propagate them to JointJS's element-view
    // delegation in Safari — the cell only became selectable via
    // Shift-drag rubber-band. Now selection always goes through proper
    // SVG geometry, which JointJS hit-tests bulletproof.
    fo.setAttribute('pointer-events', 'none');
    view.el.appendChild(fo);
  }
  fo.setAttribute('x', String(opts.x));
  fo.setAttribute('y', String(opts.y));
  fo.setAttribute('width', String(Math.max(0, opts.width)));
  fo.setAttribute('height', String(Math.max(0, opts.height)));

  // Two-level structure: outer `frame` div does flex-based centring (the
  // shape decides via opts.css whether to centre vertically/horizontally);
  // inner `content` div is block-level so `<br>` line breaks and inline
  // markdown elements lay out naturally. Without this nesting the inner
  // <br>s become flex items and stop working as line breaks.
  let frame = fo.firstChild;
  if (!frame || frame.nodeType !== 1 || frame.localName !== 'div' || !frame.dataset?.mdFrame) {
    while (fo.firstChild) fo.removeChild(fo.firstChild);
    frame = document.createElementNS(XHTML_NS, 'div');
    frame.setAttribute('xmlns', XHTML_NS);
    frame.dataset.mdFrame = '';
    const content = document.createElementNS(XHTML_NS, 'div');
    content.setAttribute('xmlns', XHTML_NS);
    content.dataset.mdContent = '';
    frame.appendChild(content);
    fo.appendChild(frame);
  }
  // Append `pointer-events:none; user-select:none` to the frame so the FO
  // itself catches the JointJS pointerdown (selection / drag) and the HTML
  // children don't start a browser text-selection mid-drag. The FO element's
  // `pointer-events="all"` attribute remains the actual hit target.
  frame.style.cssText = opts.css + ';pointer-events:none;user-select:none;';
  // The inner content div carries the rendered HTML; explicit display:block
  // so <br> + inline marks behave normally regardless of frame's flex.
  const content = frame.firstChild;
  content.style.cssText = 'display:block;max-width:100%;pointer-events:none;user-select:none;';
  // parseMarkdown escHtml's first, then applies only the four whitelisted
  // tags + <br>. innerHTML is safe here.
  //
  // `opts.plain` turns the marker pass OFF for content that is CODE rather than prose. Without it a Salesforce
  // formula expression is silently mangled: `{!Quantity} * {!UnitPrice} * 1.23` matches the italic rule and
  // renders as `{!Quantity} <em> {!UnitPrice} </em> 1.23` - the multiplication operators are GONE and the
  // reader cannot tell. That is the "a wrong row ends the question a missing row would invite" failure, not a
  // cosmetic one.
  // Escaping in the DATA is not an alternative: the same strings render through escHtml in the properties
  // panel, so a baked `\*` would show a literal backslash there - the identical objection that ruled out
  // smuggling U+00A0 indents into saved JSON.
  // Escape + <br> only, so the two modes differ ONLY in whether markers are interpreted.
  content.innerHTML = opts.plain ? escapePlain(text) : parseMarkdown(text);
  // Hide the original SVG <text> node JointJS still emits (so its rendering
  // doesn't shadow / sit underneath our HTML). Done via inline style so it
  // survives JointJS attr-pass re-renders.
  if (opts.hideSelector) {
    const orig = view.el.querySelector(`[joint-selector="${opts.hideSelector}"]`);
    if (orig) orig.style.display = 'none';
  }
}

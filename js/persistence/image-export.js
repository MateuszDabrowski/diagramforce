// Image export — PNG / WEBP raster + animated GIF generation, plus the
// standalone-SVG helpers (foreignObject -> SVG text, CSS-var resolution,
// line-style inlining) they depend on. Extracted from persistence.js
// (Phase 3, Slice 1). Live graph/paper/tab-name refs and the shared
// download/date helpers come from the persistence runtime context, wired in
// persistence.init().

import { GIFEncoder, quantize, applyPalette } from '../../assets/vendor/gifenc.esm.js?v=1.16.0';
import { showToast, showError } from '../feedback.js?v=1.16.0';
import { pctx } from './context.js?v=1.16.0';

export function exportWEBP(transparent = false) {
  return exportRaster(transparent, 'webp');
}

export function exportPNG(transparent = false) {
  return exportRaster(transparent, 'png');
}

function exportRaster(transparent, format) {
  const { paper, triggerDownload, dateSuffix, tabNameCb: getTabNameCallback } = pctx;
  const mimeType = format === 'webp' ? 'image/webp' : 'image/png';
  const ext = format === 'webp' ? 'webp' : 'png';
  const fmtLabel = format.toUpperCase();
  try {
    const contentBBox = paper.getContentBBox();
    if (!contentBBox || contentBBox.width === 0) {
      showError('Diagram is empty — nothing to export.');
      return;
    }

    const padding = 32;
    const exportW = contentBBox.width + padding * 2;
    const exportH = contentBBox.height + padding * 2;

    // Clone the paper SVG element and adjust for export
    const svgEl = paper.svg;
    const svgClone = svgEl.cloneNode(true);
    svgClone.setAttribute('width', exportW);
    svgClone.setAttribute('height', exportH);
    svgClone.setAttribute('viewBox',
      `${contentBBox.x - padding} ${contentBBox.y - padding} ${exportW} ${exportH}`
    );

    // Remove the viewport transform (scale+translate used for pan/zoom)
    const viewport = svgClone.querySelector('.joint-viewport');
    if (viewport) viewport.removeAttribute('transform');

    // Hide grid pattern and port circles for clean export
    svgClone.querySelectorAll('pattern, .joint-port').forEach(el => el.remove());

    // Inline the SLDS icon sprites so they render in the exported SVG
    const spritesContainer = document.getElementById('slds-icons');
    if (spritesContainer) {
      const defsEl = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defsEl.innerHTML = spritesContainer.innerHTML;
      svgClone.insertBefore(defsEl, svgClone.firstChild);
    }

    // Replace foreignObject elements with SVG text — HTML inside SVG Blob URLs
    // is blocked by browsers during Image rendering (security restriction)
    replaceForeignObjects(svgClone);

    // Resolve CSS custom properties — standalone SVG images can't access page CSS vars
    resolveCssVars(svgClone);

    // Bake the runtime overlay-based dashing into the standalone SVG.
    // For transparent export we fall back to inline stroke-dasharray on
    // the line; non-transparent uses the bg-coloured overlay technique to
    // avoid leaking the pattern into open-stroke markers in Safari.
    applyLineStyleInline(svgClone, transparent);

    const svgStr = new XMLSerializer().serializeToString(svgClone);
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const scale = 2; // 2× for retina sharpness
      const canvas = document.createElement('canvas');
      canvas.width = exportW * scale;
      canvas.height = exportH * scale;
      const ctx = canvas.getContext('2d');

      if (!transparent) {
        const theme = document.documentElement.getAttribute('data-theme');
        ctx.fillStyle = theme === 'dark' ? '#1A1A1A' : '#FAFAFA';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, exportW, exportH);

      canvas.toBlob(blob => {
        const baseName = (getTabNameCallback ? getTabNameCallback() : 'diagram').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'diagram';
        if (blob) {
          triggerDownload(URL.createObjectURL(blob), `df_${baseName}_${dateSuffix()}.${ext}`);
          showToast(`${fmtLabel} downloaded ✓`, 'success');
        }
        URL.revokeObjectURL(svgUrl);
      }, mimeType);
    };

    img.onerror = () => {
      showError(`${fmtLabel} export failed. Try saving as JSON instead.`);
      URL.revokeObjectURL(svgUrl);
    };

    img.src = svgUrl;
  } catch (err) {
    showError(`${fmtLabel} export failed: ` + err.message);
    console.error(`SF Diagrams: ${fmtLabel} export failed:`, err);
  }
}

/**
 * Export an animated GIF of the diagram with flowing connector dashes.
 * Renders multiple frames with varying stroke-dashoffset on link lines,
 * then encodes them as an animated GIF using gifenc.
 */
// Module-level flag — set true while a GIF is being encoded, read by
// toolbar's refreshShareAvailability() so the Save dropdown items disable
// during the long-running encode. Prevents the user from queuing a second
// export on top of the first.
let _gifEncodingInProgress = false;
export function isGifEncodingInProgress() { return _gifEncodingInProgress; }
let _onEncodingChange = null;
export function setGifEncodingListener(fn) { _onEncodingChange = fn; }
function setGifEncoding(state) {
  _gifEncodingInProgress = state;
  _onEncodingChange?.();
}

export async function exportGIF(transparent = false) {
  const { paper, graph, triggerDownload, dateSuffix, tabNameCb: getTabNameCallback } = pctx;
  if (_gifEncodingInProgress) {
    showToast('A GIF export is already running.', 'warning');
    return;
  }
  let progressToastDismiss = null;
  try {
    const contentBBox = paper.getContentBBox();
    if (!contentBBox || contentBBox.width === 0) {
      showError('Diagram is empty — nothing to export.');
      return;
    }

    // Mark encoding active so the Save dropdown items grey out. The toast
    // sits until the encoding finishes (8s upper bound — gifenc can be
    // slow on large diagrams; we'd rather have the toast linger than
    // disappear mid-encode).
    setGifEncoding(true);
    // Gap 27 (v1.12.0) — toast carries an `.update(msg)` channel so we
    // can rewrite the frame counter in place without flashing the toast
    // in and out per frame. Initial copy is the static fallback for the
    // brief window before the first frame finishes rendering.
    progressToastDismiss = showToast('Generating GIF… 0/12', 'info', { duration: 12000 });

    const padding = 32;
    const exportW = contentBBox.width + padding * 2;
    const exportH = contentBBox.height + padding * 2;
    const scale = 2; // 2× for retina sharpness
    const canvasW = Math.round(exportW * scale);
    const canvasH = Math.round(exportH * scale);

    // Animation parameters — must match css/canvas.css .df-animate-flow
    const TOTAL_FRAMES = 12;
    const DASH_TOTAL = 12; // stroke-dasharray: 8 4 → total repeat = 12
    const FRAME_DELAY = 50; // ms per frame (12 frames × 50ms = 600ms = one cycle)

    // Prepare a base SVG clone (same pipeline as exportPNG)
    function prepareBaseSvg() {
      const svgEl = paper.svg;
      const svgClone = svgEl.cloneNode(true);
      svgClone.setAttribute('width', exportW);
      svgClone.setAttribute('height', exportH);
      svgClone.setAttribute('viewBox',
        `${contentBBox.x - padding} ${contentBBox.y - padding} ${exportW} ${exportH}`
      );
      const viewport = svgClone.querySelector('.joint-viewport');
      if (viewport) viewport.removeAttribute('transform');
      svgClone.querySelectorAll('pattern, .joint-port, .df-flow-overlay').forEach(el => el.remove());
      const spritesContainer = document.getElementById('slds-icons');
      if (spritesContainer) {
        const defsEl = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defsEl.innerHTML = spritesContainer.innerHTML;
        svgClone.insertBefore(defsEl, svgClone.firstChild);
      }
      replaceForeignObjects(svgClone);
      resolveCssVars(svgClone);
      applyLineStyleInline(svgClone, transparent);
      return svgClone;
    }

    // Determine background color
    const theme = document.documentElement.getAttribute('data-theme');
    const bgColor = transparent ? null : (theme === 'dark' ? '#1A1A1A' : '#FAFAFA');

    // Render a single frame: clone SVG, set dash offset, rasterise to canvas
    function renderFrame(frameIndex) {
      return new Promise((resolve, reject) => {
        const svgClone = prepareBaseSvg();

        // Inverse-masking approach: clone each link line ON TOP without markers,
        // paint background-coloured dashes that "erase" sections of the solid
        // original line underneath.  This avoids Safari's marker inheritance bug.
        const offset = DASH_TOTAL - (frameIndex * (DASH_TOTAL / TOTAL_FRAMES));
        const eraseFill = bgColor || '#FFFFFF';
        svgClone.querySelectorAll('.joint-link [joint-selector="line"]').forEach(line => {
          const overlay = line.cloneNode(false);
          overlay.removeAttribute('marker-start');
          overlay.removeAttribute('marker-end');
          overlay.removeAttribute('marker-mid');
          overlay.removeAttribute('joint-selector');
          overlay.setAttribute('stroke', eraseFill);
          overlay.setAttribute('stroke-dasharray', '4 8');
          overlay.setAttribute('stroke-dashoffset', String(offset));
          line.parentNode.insertBefore(overlay, line.nextSibling);
        });

        const svgStr = new XMLSerializer().serializeToString(svgClone);
        const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const svgUrl = URL.createObjectURL(svgBlob);

        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = canvasW;
          canvas.height = canvasH;
          const ctx = canvas.getContext('2d');

          if (bgColor) {
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, canvasW, canvasH);
          }

          ctx.scale(scale, scale);
          ctx.drawImage(img, 0, 0, exportW, exportH);

          const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
          URL.revokeObjectURL(svgUrl);
          resolve(imageData.data);
        };
        img.onerror = () => {
          URL.revokeObjectURL(svgUrl);
          reject(new Error('Frame rendering failed'));
        };
        img.src = svgUrl;
      });
    }

    // Render all frames and encode GIF
    const gif = GIFEncoder();

    for (let i = 0; i < TOTAL_FRAMES; i++) {
      const rgba = await renderFrame(i);
      const palette = quantize(rgba, 256, { format: 'rgba4444' });
      const index = applyPalette(rgba, palette, 'rgba4444');

      const writeOpts = { palette, delay: FRAME_DELAY };
      if (transparent) {
        // Find the transparent entry in palette (closest to [0,0,0,0])
        let tIdx = 0;
        let minDist = Infinity;
        for (let p = 0; p < palette.length; p++) {
          const r = palette[p][0], g = palette[p][1], b = palette[p][2], a = palette[p][3];
          // Prefer fully transparent pixels
          if (a === 0) { tIdx = p; minDist = 0; break; }
          const dist = a; // lower alpha = more transparent
          if (dist < minDist) { minDist = dist; tIdx = p; }
        }
        writeOpts.transparent = true;
        writeOpts.transparentIndex = tIdx;
      }

      gif.writeFrame(index, canvasW, canvasH, writeOpts);

      // Gap 27 (v1.12.0) — push the post-frame counter to the toast so
      // users see steady progress (1/12, 2/12, …) instead of a static
      // spinner. Update happens AFTER writeFrame so the displayed
      // number always matches a frame that's fully encoded into the
      // GIF buffer — no "lying about progress" if the encode crashes
      // mid-loop. Update is a single textContent write, ~microseconds.
      progressToastDismiss?.update?.(`Generating GIF… ${i + 1}/${TOTAL_FRAMES}`);
    }

    // Final palette + container assembly step. Quick, but worth telling
    // the user something's still happening so the last counter doesn't
    // sit there for a beat while finish() runs.
    progressToastDismiss?.update?.('Finalising GIF…');
    gif.finish();
    const bytes = gif.bytes();
    const blob = new Blob([bytes], { type: 'image/gif' });
    const gifName = (getTabNameCallback ? getTabNameCallback() : 'diagram').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'diagram';
    triggerDownload(URL.createObjectURL(blob), `df_${gifName}_${dateSuffix()}.gif`);
    progressToastDismiss?.();
    showToast('GIF downloaded ✓', 'success');

  } catch (err) {
    progressToastDismiss?.();
    showError('GIF export failed: ' + err.message);
    console.error('SF Diagrams: GIF export failed:', err);
  } finally {
    // ALWAYS clear the in-progress flag, even if encoding threw — otherwise
    // the Save dropdown stays disabled forever after a failed encode.
    setGifEncoding(false);
  }
}

/**
 * Replace <foreignObject> elements with equivalent SVG <text> elements.
 * Browsers block HTML content inside SVG when rendering from Blob URLs
 * (used by the Image→Canvas PNG export pipeline) as a security measure.
 */
function replaceForeignObjects(svgRoot) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // CR-6.1 inline-markdown tag → tspan attribute mapping for the new
  // sf.TextLabel / sf.Note foreignObjects. Browsers won't render HTML in an
  // SVG Blob URL, so we walk each FO's HTML tree, build (text, marks[]) runs,
  // word-wrap them across lines, and emit per-segment tspans with the marks
  // applied. Inline tags outside this whitelist degrade to plain text.
  const MARK_TO_TSPAN = {
    strong: { 'font-weight': 'bold' },
    b:      { 'font-weight': 'bold' },
    em:     { 'font-style': 'italic' },
    i:      { 'font-style': 'italic' },
    del:    { 'text-decoration': 'line-through' },
    s:      { 'text-decoration': 'line-through' },
    code:   { 'font-family': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', 'fill': '#C8553D' },
  };
  // Approximate per-char width contribution by font-style. SVG text in raster
  // export is laid out by char count, so the wrap calc cares only about
  // relative width — bold and code take more space; italic about the same.
  const charWidthMultiplier = (marks) => {
    let mult = 1;
    if (marks.includes('strong') || marks.includes('b') || marks.includes('code')) mult *= 1.05;
    return mult;
  };

  // Walk a foreignObject's HTML subtree, returning an ordered array of
  // text runs. Each run carries the markdown marks active on it (e.g.
  // ['strong'], ['code']). `<br>` elements become explicit '\n' tokens so
  // the line-wrap below treats them as hard breaks; inline whitespace is
  // preserved.
  function collectRuns(node, marks, runs) {
    if (node.nodeType === 3) { // text node
      runs.push({ text: node.nodeValue, marks: marks.slice() });
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.localName.toLowerCase();
    if (tag === 'br') {
      runs.push({ text: '\n', marks: marks.slice() });
      return;
    }
    const nextMarks = MARK_TO_TSPAN[tag] ? marks.concat(tag) : marks;
    for (const child of node.childNodes) collectRuns(child, nextMarks, runs);
  }

  for (const fo of [...svgRoot.querySelectorAll('foreignObject')]) {
    const x = parseFloat(fo.getAttribute('x') || '0');
    const y = parseFloat(fo.getAttribute('y') || '0');
    const w = parseFloat(fo.getAttribute('width') || '100');
    const h = parseFloat(fo.getAttribute('height') || '100');

    const htmlChild = fo.querySelector('div, p, span');
    if (!htmlChild || !htmlChild.textContent.trim()) { fo.remove(); continue; }

    // Style: read from the HTML child's inline style, with sensible fallbacks.
    const cs = htmlChild.style;
    const fontSize = parseFloat(cs.fontSize) || 9;
    const fontFamily = cs.fontFamily || 'system-ui, -apple-system, sans-serif';
    const fill = cs.color || '#888888';
    const fontWeight = cs.fontWeight || 'normal';
    const textAlign = cs.textAlign || 'left';
    const lineHeight = 1.3;
    const charWidth = fontSize * 0.52;
    const maxChars = Math.max(4, Math.floor(w / charWidth));

    // Tokenize the HTML into formatted runs.
    const runs = [];
    collectRuns(htmlChild, [], runs);

    // Word-wrap across runs: split each run into words while preserving marks
    // per-word, then greedy-pack into lines. Each line is an array of segments
    // [{ text, marks }] which become per-segment tspans.
    const lines = [[]];
    let lineWidth = 0;
    const pushSegment = (text, marks) => {
      if (!text) return;
      const segWidth = text.length * charWidthMultiplier(marks);
      const lastLine = lines[lines.length - 1];
      lineWidth += segWidth;
      // Merge with previous segment if same marks (avoid tspan fragmentation
      // for plain text broken only by tokenisation).
      const last = lastLine[lastLine.length - 1];
      if (last && JSON.stringify(last.marks) === JSON.stringify(marks)) {
        last.text += text;
      } else {
        lastLine.push({ text, marks });
      }
    };
    const breakLine = () => {
      lines.push([]);
      lineWidth = 0;
    };
    for (const run of runs) {
      // Preserve explicit '\n' in the source text as hard breaks.
      const parts = run.text.split(/(\n)/);
      for (const part of parts) {
        if (part === '\n') { breakLine(); continue; }
        if (!part) continue;
        // Split on whitespace boundaries, keeping spaces.
        const tokens = part.split(/(\s+)/).filter(t => t.length > 0);
        for (const tok of tokens) {
          const tokWidth = tok.length * charWidthMultiplier(run.marks);
          // If the token overflows the current line and the line isn't empty,
          // wrap. Whitespace tokens at line-start are swallowed.
          const onlyWhitespace = /^\s+$/.test(tok);
          if (lineWidth > 0 && lineWidth + tokWidth > maxChars) {
            breakLine();
            if (onlyWhitespace) continue;
          }
          pushSegment(tok, run.marks);
        }
      }
    }

    // Clamp to maxLines (4) when the FO is short, matching the original
    // -webkit-line-clamp:4 visual. For full-height FOs (TextLabel/Note body),
    // compute from height/lineHeight so multi-line notes don't get truncated.
    const fitLines = Math.max(1, Math.floor(h / (fontSize * lineHeight))) || 1;
    const maxLines = Math.max(fitLines, 4);
    const visibleLines = lines.slice(0, maxLines);
    if (lines.length > maxLines) {
      const last = visibleLines[visibleLines.length - 1];
      if (last && last.length) {
        const tail = last[last.length - 1];
        tail.text = tail.text.replace(/.$/, '…');
      }
    }

    // Build the SVG <text> with per-line + per-segment tspans.
    const textEl = document.createElementNS(SVG_NS, 'text');
    // Vertical alignment within the FO box — match the frame's flexbox so the
    // raster text lands where the live HTML does: flex-end bottom-anchors (the
    // sf.Line caption, which otherwise exports ~a band-height too high), center
    // middles (TextLabel / Annotation), default/none tops (Note).
    const lineHeightPx = fontSize * lineHeight;
    const textBlockH = visibleLines.length * lineHeightPx;
    const alignItems = (cs.alignItems || '').trim();
    let topY = y;
    if (alignItems === 'flex-end') topY = y + h - textBlockH;
    else if (alignItems === 'center') topY = y + (h - textBlockH) / 2;
    textEl.setAttribute('x', String(x));
    textEl.setAttribute('y', String(topY + fontSize * 1.2));
    // Preserve the FO's own transform — e.g. the Annotation label's counter-
    // rotation that keeps the text horizontal while the bracket is rotated. The
    // <text> replaces the FO in the same parent group, so the identical local-
    // coordinate transform reproduces the on-canvas orientation.
    const foTransform = fo.getAttribute('transform');
    if (foTransform) textEl.setAttribute('transform', foTransform);
    textEl.setAttribute('font-size', String(fontSize));
    textEl.setAttribute('font-family', fontFamily);
    textEl.setAttribute('fill', fill);
    if (fontWeight && fontWeight !== 'normal') textEl.setAttribute('font-weight', fontWeight);
    if (textAlign === 'center') textEl.setAttribute('text-anchor', 'middle');
    else if (textAlign === 'right') textEl.setAttribute('text-anchor', 'end');

    const lineXOffset = textAlign === 'center' ? w / 2 : textAlign === 'right' ? w : 0;
    visibleLines.forEach((line, i) => {
      if (line.length === 0) {
        // Empty line (hard break) — still consume vertical space.
        const tspan = document.createElementNS(SVG_NS, 'tspan');
        tspan.setAttribute('x', String(x + lineXOffset));
        tspan.setAttribute('dy', i === 0 ? '0' : String(fontSize * lineHeight));
        tspan.textContent = ' ';
        textEl.appendChild(tspan);
        return;
      }
      line.forEach((seg, j) => {
        const tspan = document.createElementNS(SVG_NS, 'tspan');
        // Each line's FIRST tspan carries x + dy so the whole line begins at
        // the correct horizontal anchor and drops to the next baseline.
        // Continuation tspans on the same line inherit position.
        if (j === 0) {
          tspan.setAttribute('x', String(x + lineXOffset));
          tspan.setAttribute('dy', i === 0 ? '0' : String(fontSize * lineHeight));
        }
        for (const mark of seg.marks) {
          const tspanAttrs = MARK_TO_TSPAN[mark];
          if (!tspanAttrs) continue;
          for (const [k, v] of Object.entries(tspanAttrs)) {
            tspan.setAttribute(k, v);
          }
        }
        tspan.textContent = seg.text;
        textEl.appendChild(tspan);
      });
    });

    fo.parentNode.replaceChild(textEl, fo);
  }
}

/**
 * Walk all elements in an SVG clone and replace CSS var() references with
 * their computed values.  Standalone SVG images (Blob URLs) cannot access
 * the page's CSS custom properties, so every attribute and inline-style that
 * uses var(--…) must be resolved to a concrete colour / value before export.
 */
function resolveCssVars(svgRoot) {
  const cs = getComputedStyle(document.documentElement);

  // Cache resolved values to avoid repeated getComputedStyle calls
  const cache = new Map();
  function resolve(varExpr) {
    if (cache.has(varExpr)) return cache.get(varExpr);
    // Extract var name and optional fallback: var(--foo, #FFF)
    const m = varExpr.match(/var\(\s*(--[^,)]+)\s*(?:,\s*([^)]+))?\s*\)/);
    if (!m) { cache.set(varExpr, varExpr); return varExpr; }
    const val = cs.getPropertyValue(m[1]).trim() || (m[2] ? m[2].trim() : '');
    cache.set(varExpr, val);
    return val;
  }

  // Attributes that may contain colour var() references
  const COLOR_ATTRS = ['fill', 'stroke', 'color', 'stop-color', 'flood-color'];

  const walker = document.createTreeWalker(svgRoot, NodeFilter.SHOW_ELEMENT);
  let node = walker.currentNode;
  while (node) {
    // Resolve attributes
    for (const attr of COLOR_ATTRS) {
      const v = node.getAttribute(attr);
      if (v && v.includes('var(')) {
        node.setAttribute(attr, resolve(v));
      }
    }
    // Resolve inline style properties
    if (node.style) {
      for (const attr of COLOR_ATTRS) {
        const sv = node.style.getPropertyValue(attr);
        if (sv && sv.includes('var(')) {
          node.style.setProperty(attr, resolve(sv));
        }
      }
      // Also check common non-colour style properties
      const bg = node.style.getPropertyValue('background');
      if (bg && bg.includes('var(')) node.style.setProperty('background', resolve(bg));
      const bgColor = node.style.getPropertyValue('background-color');
      if (bgColor && bgColor.includes('var(')) node.style.setProperty('background-color', resolve(bgColor));
    }
    node = walker.nextNode();
  }
}

/**
 * Bake the runtime "bg-coloured overlay clone" dashing technique into a
 * standalone SVG export. The runtime overlays rely on a CSS rule
 * (`.df-line-style-overlay { stroke: var(--bg-canvas) !important; }`) which
 * doesn't apply in a Blob-URL SVG, so the overlay would either lose its
 * stroke or render in the line's own colour. We resolve the canvas bg
 * colour and set it inline on every overlay clone so the same masking
 * effect that works on canvas survives rasterisation.
 *
 * For transparent exports there is no background colour to "blend" the
 * dashes into; we strip the overlays and fall back to writing
 * `stroke-dasharray` inline on the link <path>. This is the only way to
 * produce true transparent gaps in the stroke. Trade-off: in Safari, the
 * line's dasharray can leak into open-stroke markers (lineArrow, ER
 * notation) — a documented Safari quirk that doesn't surface on
 * non-transparent exports because we don't put dasharray on the line at all.
 */
function applyLineStyleInline(svgRoot, transparent) {
  const { graph } = pctx;
  if (!graph) return;

  if (transparent) {
    // True transparent gaps require dasharray on the line itself.
    svgRoot.querySelectorAll('.df-line-style-overlay').forEach(el => el.remove());
    for (const link of graph.getLinks()) {
      const style = link.prop('lineStyle');
      if (!style || style === 'none') continue;
      const linkEl = svgRoot.querySelector(`.joint-link[model-id="${link.id}"]`);
      if (!linkEl) continue;
      const lineEl = linkEl.querySelector('[joint-selector="line"]');
      if (!lineEl) continue;
      lineEl.setAttribute('stroke-dasharray', style);
    }
    return;
  }

  // Non-transparent: preserve the overlay-based technique. Resolve the
  // canvas bg colour once and bake it into every overlay's stroke attribute
  // so the standalone SVG renders the dashes correctly.
  const root = document.documentElement;
  const theme = root.getAttribute('data-theme');
  const cs = getComputedStyle(root);
  const bgCanvas = cs.getPropertyValue('--bg-canvas').trim() || (theme === 'dark' ? '#1A1A1A' : '#FAFAFA');
  svgRoot.querySelectorAll('.df-line-style-overlay').forEach(overlay => {
    overlay.setAttribute('stroke', bgCanvas);
  });
}

// ── URL Sharing ─────────────────────────────────────────────────────


// Share orchestration — build/parse the #diagram=... share-URL hash via the
// versioned share codec, and the Share / share-error modals. Extracted from
// persistence.js (Phase 3, Slice 1). The live graph, the tab-name/type getters,
// the import handler, and the sanitize/normalize/version-check helpers come from
// the persistence runtime context, wired in persistence.init(). Legacy decode
// uses the global `pako`.

import { encodeShareV1, decodeShareV1, encodeShareV2, decodeShareV2, slimForShare } from '../share-codec.js?v=1.15.3';
import { diagramHasImage } from '../image-component.js?v=1.15.3';
import { showToast, showError, buildModal } from '../feedback.js?v=1.15.3';
import { escHtml } from '../util.js?v=1.15.3';
import { pctx } from './context.js?v=1.15.3';

export function shareAsURL() {
  const { graph, appVersion: APP_VERSION, tabNameCb: getTabNameCallback, diagramTypeCb: getDiagramTypeCallback, mappingModeCb: getMappingModeCallback } = pctx;
  if (!getTabNameCallback || !getDiagramTypeCallback) return;
  // Belt-and-braces: the dropdown button is already disabled when images are
  // present, but keyboard shortcut / hamburger entry / `share` action route
  // straight into this function and need the same gate.
  if (diagramHasImage(graph)) {
    showShareModal(null, { reason: 'image' });
    return;
  }
  const data = {
    v: 1,
    av: APP_VERSION,
    name: getTabNameCallback(),
    type: getDiagramTypeCallback(),
    mappingMode: getMappingModeCallback ? getMappingModeCallback() : false,
    // Slim out load-reconstructable data (default ports/size, mapping-link routing,
    // icon artwork) before encoding — the import path rebuilds it. Big win for
    // port-bearing + icon-heavy diagrams; lossless after load reconstruction.
    graph: slimForShare(graph.toJSON()),
  };
  try {
    // v2 codec: v1's key-minification + dictionary, extended to field-array keys
    // and post-v1 props, with a dictionary re-tuned for the slimmed payload. Output
    // starts with `v2.`; loadFromURL detects the prefix (and still decodes v1/legacy).
    const payload = encodeShareV2(data);
    const url = `${window.location.origin}${window.location.pathname}#diagram=${payload}`;
    showShareModal(url);
  } catch (err) {
    console.error('SF Diagrams: Share URL failed:', err);
    showError('Failed to generate share URL — diagram may be too large.');
  }
}

export async function loadFromURL() {
  const { sanitizeGraphJSON, normalizeDiagramType, checkVersionWarning, onImport: onImportCallback } = pctx;
  const hash = window.location.hash;
  if (!hash || !hash.includes('diagram=')) return false;

  // Versioned codec match (`v1.<base64url>`) takes precedence; falls through
  // to the legacy raw-deflate path for URLs created before this codec landed.
  const verMatch = hash.match(/diagram=v(\d+)\.([A-Za-z0-9_-]+)/);
  const legacyMatch = !verMatch && hash.match(/diagram=([A-Za-z0-9_-]+)/);
  if (!verMatch && !legacyMatch) {
    showShareLoadError('This share link is invalid. Please check that you copied the whole link, or ask the sender for a new one.');
    history.replaceState(null, '', window.location.pathname);
    return false;
  }

  try {
    let data;
    if (verMatch) {
      const ver = parseInt(verMatch[1], 10);
      // Every shipped decoder stays alive (forward links from a newer build are the
      // only ones we can't read). v2 is current; v1 covers links made before it.
      if (ver === 2) {
        data = decodeShareV2(`v2.${verMatch[2]}`);
      } else if (ver === 1) {
        data = decodeShareV1(`v1.${verMatch[2]}`);
      } else {
        showShareLoadError('This share link was created by a newer version of Diagramforce. Please ask the sender to update their link.');
        history.replaceState(null, '', window.location.pathname);
        return false;
      }
    } else {
      // Legacy: raw deflate, no preset dictionary, no key minification.
      let base64 = legacyMatch[1].replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) base64 += '=';
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const json = pako.inflateRaw(bytes, { to: 'string' });
      // Decompression-bomb guard: a legitimate share is far under this ceiling.
      if (json.length > 8 * 1024 * 1024) throw new Error('Share payload too large');
      data = JSON.parse(json);
    }

    if (!data.graph || !data.type) {
      showShareLoadError('This share link is invalid. Please check that you copied the whole link, or ask the sender for a new one.');
      history.replaceState(null, '', window.location.pathname);
      return false;
    }

    // Sanitize graph data from untrusted URL source
    sanitizeGraphJSON(data.graph);

    // Clear the hash so it doesn't reload on refresh
    history.replaceState(null, '', window.location.pathname);

    const savedVer = data.av || null;
    const ok = await checkVersionWarning(savedVer, data.name || 'Shared Diagram', data);
    if (!ok) return false;

    // Import the diagram using the existing import handler
    if (onImportCallback) {
      const type = normalizeDiagramType(data.type);
      onImportCallback(data.name || 'Shared Diagram', type, data.graph, data.viewport || null, data.mappingMode);
      return true;
    }
    return false;
  } catch (err) {
    console.error('SF Diagrams: Failed to load shared diagram:', err);
    showShareLoadError('This share link is invalid. Please check that you copied the whole link, or ask the sender for a new one.');
    history.replaceState(null, '', window.location.pathname);
    return false;
  }
}

/** Show a non-blocking error toast for share-URL load failures. */
function showShareLoadError(message, title = "Couldn't load shared diagram") {
  document.querySelector('.df-share-error-modal')?.remove();
  const { footer, close } = buildModal({
    title, // buildModal escapes via textContent
    className: 'df-share-error-modal',
    zIndex: 10001,
    width: '440px',
    showClose: false, // dismiss via OK button / backdrop / Escape
    bodyStyle: 'padding:16px 20px',
    bodyHtml: `<p style="margin:0;color:var(--text-secondary);line-height:1.5">${escHtml(message)}</p>`,
    footerHtml: '<button class="df-modal__btn df-modal__btn--primary" data-action="dismiss">OK</button>',
  });
  footer.style.justifyContent = 'flex-end';
  footer.querySelector('[data-action="dismiss"]').addEventListener('click', close);
}

function showShareModal(url, opts = {}) {
  document.querySelector('.df-share-modal')?.remove();

  const isWarning = opts.reason === 'image';
  const bodyHtml = isWarning
    ? `
        <div class="df-share-modal__warning">
          <p style="margin:0 0 var(--spacing-sm);font-weight:600;color:var(--text-primary)">Diagrams containing images exceed URL size limits.</p>
          <p style="margin:0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">Please use Save → Export to JSON to share this diagram, or remove every image to re-enable URL sharing.</p>
        </div>`
    : `
        <p style="margin:0 0 var(--spacing-sm);color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">
          Anyone with this link can open a copy of your diagram:
        </p>
        <input type="text" class="df-share-modal__url" readonly aria-readonly="true" aria-label="Shareable diagram URL" spellcheck="false">`;

  // Action modal: the top-right ✕ is the dismiss. The warning variant has no
  // action button, so it renders no footer at all (footerHtml:null → no bar).
  const { body, footer, close } = buildModal({
    title: isWarning ? 'Sharing unavailable' : 'Share Diagram',
    className: 'df-share-modal',
    zIndex: 3000,
    width: '520px',
    bodyStyle: 'padding:var(--spacing-md) var(--spacing-lg)',
    bodyHtml,
    footerHtml: isWarning
      ? null
      : '<button class="df-close-confirm__btn df-close-confirm__btn--save df-share-modal__copy-btn" style="margin-left:auto">Copy Link</button>',
  });
  if (footer) footer.style.justifyContent = 'flex-end';

  if (isWarning) return;

  const urlInput = body.querySelector('.df-share-modal__url');
  urlInput.value = url;

  const copyBtn = footer.querySelector('.df-share-modal__copy-btn');
  const ORIGINAL_LABEL = copyBtn.textContent;
  let revertTimer = null;
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(url).then(() => {
      // Visual success feedback via CSS class — no inline styles. Modal stays
      // open so the user can keep selecting/copying; button reverts after 2s
      // so a second copy attempt still feels responsive.
      copyBtn.textContent = '✓ Copied!';
      copyBtn.classList.add('is-copied');
      clearTimeout(revertTimer);
      revertTimer = setTimeout(() => {
        copyBtn.textContent = ORIGINAL_LABEL;
        copyBtn.classList.remove('is-copied');
      }, 2000);
    }).catch(() => {
      // Gap 23 (v1.12.0) — clipboard write rejection is silent on the
      // success affordance (no green "Copied!"), so users assumed the
      // app broke. Select the URL as a manual-copy fallback AND surface
      // a warning toast naming the platform shortcut so the next step
      // is obvious. Common causes: insecure origin, missing permission,
      // older Safari without async clipboard.
      urlInput.select();
      showToast('Could not copy automatically — press ⌘C / Ctrl+C on the selected link.', 'warning');
    });
  });

  // Select the URL text for easy manual copy
  setTimeout(() => urlInput.select(), 50);
}

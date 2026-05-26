import { showError } from './feedback.js?v=1.12.2';

// Image component — consent modal, file picker, and auto-resize for sf.Image.
//
// Storage choice (per the analysis in conversation):
//   - Embed as data URI on `cell.attrs.image.href` so the image travels with
//     every existing flow (browser save, JSON export/import). Keeps the
//     "everything in one file" mental model the rest of the app has.
//   - Auto-downscale on upload (max 1280 px on the long edge, WEBP @ 0.85) so
//     a 4 MB phone screenshot becomes ~150 KB before it ever lands in the
//     graph. Caps the worst case for localStorage and JSON file size.
//   - URL-share is gated separately in toolbar.js — any sf.Image cell in the
//     active tab disables the Share-as-URL menu item via reactive check on
//     graph add/remove.
//
// Safari note: Safari only opens a native file picker if `input.click()` is
// called from a synchronous descendant of a user-gesture event handler. Any
// `await` in the chain breaks the gesture context and the click is silently
// ignored. So this module deliberately uses callback-style flow control —
// the synchronous chain from drop/dblclick down to `input.click()` is
// preserved both via the no-consent fast path AND via the consent-modal slow
// path (the modal's "Add image" button click is itself a user gesture, and
// the picker is opened synchronously from its handler).

const MAX_DIMENSION = 1280;
const WEBP_QUALITY = 0.85;
const MAX_INPUT_BYTES = 10 * 1024 * 1024; // 10 MB pre-resize cap
const ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif)$/i;

/** True when any sf.Image cell is present in the graph. */
export function diagramHasImage(graph) {
  if (!graph) return false;
  return graph.getElements().some(el => el.get('type') === 'sf.Image');
}

/**
 * Entry point for the image add flow — called from stencil drop / dblclick /
 * touch drop. Synchronous in its first step (modal render or picker click),
 * which is what Safari requires.
 *
 * If no image is in the diagram yet, shows the consent modal first; the modal's
 * "Add image" button is what actually opens the file picker (its click is a
 * fresh user gesture, so Safari accepts it). If images already exist we skip
 * straight to the picker, calling it synchronously from the caller's gesture.
 *
 * `onResult` is called with `{ dataURI, width, height }` once a file has been
 * picked, validated, and resized. Never called if the user cancels at any step.
 */
export function startImageAddFlow(graph, onResult) {
  if (!diagramHasImage(graph)) {
    showImageConsentModal((accepted) => {
      if (accepted) openImagePicker(onResult);
    });
    return;
  }
  openImagePicker(onResult);
}

/**
 * Synchronously open a native file picker. Must be called from a
 * user-gesture event handler (drop, click, dblclick). The `change` listener
 * runs the async validation/resize pipeline once a file is selected.
 */
function openImagePicker(onResult) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/gif';
  // Safari: a fully-detached input sometimes drops the click silently. Park
  // it offscreen in the DOM until the picker resolves.
  input.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;opacity:0';
  const cleanup = () => { if (input.parentNode) input.parentNode.removeChild(input); };
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    cleanup();
    if (file) processImageFile(file, onResult);
  });
  input.addEventListener('cancel', cleanup);
  document.body.appendChild(input);
  input.click(); // synchronous — preserves user gesture
}

/**
 * Validate and resize the picked file, then deliver the resulting data URI
 * to the caller. Invalid types / oversize files surface as an alert; the
 * caller's onResult is only fired on success.
 */
async function processImageFile(file, onResult) {
  if (file.type === 'image/svg+xml') {
    showError('SVG images are not supported. Use PNG, JPG, WEBP, or GIF.');
    return;
  }
  if (!ALLOWED_MIME.test(file.type)) {
    showError('Unsupported file type. Use PNG, JPG, WEBP, or GIF.');
    return;
  }
  if (file.size > MAX_INPUT_BYTES) {
    showError('Image is too large (max 10 MB). Use a smaller file.');
    return;
  }
  try {
    const result = await resizeToDataURI(file);
    onResult(result);
  } catch (err) {
    console.error('SF Diagrams: Image processing failed:', err);
    showError(`Could not process image: ${err.message}`);
  }
}

/**
 * Decode the file, scale it down so neither dimension exceeds MAX_DIMENSION,
 * and re-encode as WEBP at quality 0.85. Preserves alpha.
 */
async function resizeToDataURI(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let { naturalWidth: width, naturalHeight: height } = img;
    if (!width || !height) throw new Error('Image has zero dimensions.');
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    let dataURI = canvas.toDataURL('image/webp', WEBP_QUALITY);
    // Older browsers may silently fall back to PNG when WEBP isn't supported.
    if (!dataURI.startsWith('data:image/webp')) {
      dataURI = canvas.toDataURL('image/png');
    }
    return { dataURI, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode the image.'));
    img.src = url;
  });
}

/**
 * Modal: explains the URL-share trade-off and lists supported formats.
 * Resolves via callback so the "Add image" click handler can synchronously
 * open the file picker (preserving Safari's user-gesture chain).
 */
function showImageConsentModal(callback) {
  document.querySelector('.sf-image-consent-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'sf-modal sf-image-consent-modal';
  overlay.style.zIndex = '10001';
  overlay.innerHTML = `
    <div class="sf-modal__overlay"></div>
    <div class="sf-modal__dialog" style="width:480px">
      <div class="sf-modal__header">
        <h2 class="sf-modal__title">Add image to this diagram?</h2>
      </div>
      <div class="sf-modal__body" style="padding:16px 20px">
        <p style="margin:0 0 12px;line-height:1.5">
          Adding image components will <strong>disable URL sharing</strong> for this diagram while images are present.
        </p>
        <p style="margin:0 0 12px;color:var(--text-secondary);line-height:1.5;font-size:var(--font-size-sm)">
          Other download options (Save to JSON, PNG, WEBP) stay available, but file sizes will grow with each image. Remove every image to re-enable URL sharing.
        </p>
        <p style="margin:0;color:var(--text-secondary);line-height:1.5;font-size:var(--font-size-sm)">
          When you continue you'll be asked to pick an image file. Supported formats: <strong>PNG, JPG, WEBP, GIF</strong>. Large images are automatically resized.
        </p>
      </div>
      <div class="sf-modal__footer" style="justify-content:flex-end;gap:8px;padding:12px 20px">
        <button class="sf-modal__btn" data-action="cancel">Cancel</button>
        <button class="sf-modal__btn sf-modal__btn--primary" data-action="confirm">Pick image</button>
      </div>
    </div>`;
  let finished = false;
  const finish = (val) => {
    if (finished) return;
    finished = true;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    callback(val);
  };
  const onKey = (e) => { if (e.key === 'Escape') finish(false); };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(false));
  // CRITICAL: this click handler runs as a user gesture. The callback fires
  // synchronously, which calls openImagePicker → input.click() — the file
  // picker thus opens within the same gesture that the user just performed.
  overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => finish(true));
  overlay.querySelector('.sf-modal__overlay').addEventListener('click', () => finish(false));
  document.body.appendChild(overlay);
}

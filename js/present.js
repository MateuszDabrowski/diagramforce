// Present mode - the diagram alone on the screen, still editable.
//
// Built for a screen share on a call: the diagram you are walking people through is on screen and nothing
// else is - no tab bar naming other clients' diagrams, no toolbar, no manager that lists what else is open.
// The whole page goes full screen (the Fullscreen API on the document element, so every interaction keeps
// working) and a body class hides the chrome. Entering clears the selection, which closes the properties
// panel by its own rule, tucks the stencil away, and THEN fits the diagram to content - in that order, because
// a fit is only right against the space the diagram actually gets, and the first frame the audience sees
// should be the diagram alone, centred. Leaving puts the stencil back exactly as it was; properties follows
// the selection and returns on the first click. (Two versions were tried the same day: closing without
// restoring, and leaving both untouched. This is the one where the audience gets a clean frame and the
// presenter gets their desk back.) Editing stays live: select, drag, connect, type a label, and drop a new
// shape after bringing the stencil back from the corner pill or Ctrl+B. What is locked while presenting
// is anything that would put ANOTHER diagram on screen - the tab bar, Save & Export, Load & Import, New,
// Close tab - both their buttons (hidden with the toolbar) and their shortcuts (dropped in keyboard.js).
//
// Escape leaves, natively: the browser exits full screen and `fullscreenchange` ends the mode. When the
// Fullscreen API is refused (no user activation, an embedder that forbids it) the mode still applies to the
// window and Escape leaves through keyboard.js. Nothing here is Slot-specific; the reason it fits Slot is
// that WebKit hosts a full-screen element in a window of its own, which a call's "share a window" picks up
// with no Slot chrome and no account name around it.
let modules = {};
let presenting = false;
let stencilWasHidden = false;
let pills = null;
let fitTimer = null;

export function init(_modules) {
  modules = _modules;
  const onChange = () => {
    if (!presenting) return;
    if (!fullscreenElement()) { exit(); return; }
    // Full screen arrived: the viewport is a different size now. The browser's own transition can still be
    // moving the window, so the resize listener below fits again on each step and this is the first.
    scheduleFit(150);
  };
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);
}

// Fit AFTER the layout has settled, never in the same tick as the change that unsettles it. The stencil
// animates its width and the properties panel its transform (css, --transition-normal), so a fit run
// synchronously measures a canvas still mid-animation and lands the diagram left of centre - the first
// report on this mode. Full screen then changes the size again, over the browser's own transition. So:
// one fit when the panel transition ends (with a timeout as the fallback, for a panel that was already
// hidden and fires no transitionend), and one on every resize while presenting, debounced.
function scheduleFit(delay) {
  if (fitTimer) clearTimeout(fitTimer);
  fitTimer = setTimeout(() => {
    fitTimer = null;
    if (!presenting) return;
    try { modules.canvas?.fitContent?.(); } catch { /* an empty canvas has nothing to fit */ }
  }, delay);
}
const onResize = () => scheduleFit(120);
function fitWhenPanelsSettle() {
  const stencil = document.getElementById('stencil-panel');
  let done = false;
  const go = () => { if (done) return; done = true; stencil?.removeEventListener('transitionend', onEnd); scheduleFit(0); };
  const onEnd = (e) => { if (e.propertyName === 'width') go(); };
  stencil?.addEventListener('transitionend', onEnd);
  setTimeout(go, 520);   // --transition-normal is 400 ms; the fallback covers a panel that was already hidden and never animates
}

export function isPresenting() { return presenting; }

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

/** Enter: hide the chrome, frame the whole diagram, ask for full screen. Full screen is best-effort - a refusal
 *  leaves a windowed present, which is the same screen minus the browser's own frame. */
export function enter() {
  if (presenting) return;
  presenting = true;
  // Selection first: clearing it closes properties, and properties' own close hands the stencil back, so the
  // stencil's "before" state is read AFTER that and hidden AFTER that, or the restore on leave would be wrong.
  try { modules.selection?.clearSelection?.(); } catch { /* nothing selected */ }
  stencilWasHidden = modules.stencil?.isHidden?.() ?? false;
  modules.stencil?.hide?.();
  document.body.classList.add('df-presenting');
  ensurePills();
  window.addEventListener('resize', onResize);
  fitWhenPanelsSettle();   // after the panels are gone, so the fit is to the whole space - see scheduleFit
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (request) {
    try { const p = request.call(root); if (p && p.catch) p.catch(() => {}); } catch { /* refused → windowed */ }
  }
}

/** Leave: chrome back, the stencil back to how it was - either way, so one opened mid-talk closes again and
 *  the desk is as it was left - and out of full screen if we are still in it. */
export function exit() {
  if (!presenting) return;
  presenting = false;
  window.removeEventListener('resize', onResize);
  if (fitTimer) { clearTimeout(fitTimer); fitTimer = null; }
  document.body.classList.remove('df-presenting');
  if (stencilWasHidden) modules.stencil?.hide?.(); else modules.stencil?.show?.();
  if (fullscreenElement()) {
    const leave = document.exitFullscreen || document.webkitExitFullscreen;
    try { const p = leave?.call(document); if (p && p.catch) p.catch(() => {}); } catch { /* already out */ }
  }
}

export function toggle() { presenting ? exit() : enter(); }

/** Two small pills in the corner, only while presenting: Shapes (the stencil, to add something mid-talk) and
 *  Leave. Built once, kept in the body; the body class shows and hides them. */
function ensurePills() {
  if (pills) return;
  pills = document.createElement('div');
  pills.className = 'df-present-pills';
  pills.setAttribute('role', 'toolbar');
  pills.setAttribute('aria-label', 'Presenting');
  const shapes = document.createElement('button');
  shapes.type = 'button';
  shapes.className = 'df-present-pill';
  shapes.textContent = 'Shapes';
  shapes.title = 'Show or hide the shape stencil (Ctrl+B)';
  shapes.addEventListener('click', () => modules.stencil?.toggle?.());
  const leave = document.createElement('button');
  leave.type = 'button';
  leave.className = 'df-present-pill df-present-pill--leave';
  leave.textContent = 'Leave';
  leave.title = 'Stop presenting (Esc)';
  leave.addEventListener('click', () => exit());
  pills.append(shapes, leave);
  document.body.appendChild(pills);
}

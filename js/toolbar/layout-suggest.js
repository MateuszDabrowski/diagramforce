// Suggested Auto Layout (owner decision 2026-10-16). A tool that writes a diagram with rough positions (SQL Studio's
// data model of a query: tables on a plain grid) can set `"suggestAutoLayout": true` in the file. The app never moves
// cards on open, as some Auto Layouts are still weaker than a hand layout, so the flag only PROPOSES it: one prompt,
// Auto Layout or Keep as is, and Auto Layout is the type's own View menu entry, one undo step. The flag is read at
// import and never saved, so the next open of the saved diagram does not ask again.
import { showToast } from '../feedback.js?v=1.26.6';

/** The prompt for the tab `tabId` named `name`. `run(tabId)` lays it out (app.js: back to that tab, then the menu's
 *  Auto Layout); `onDismiss` runs once the prompt is answered by any route. Returns the toast's dismiss function. */
export function offerAutoLayout(tabId, name, run, { onDismiss } = {}) {
  return showToast(`The tool that made "${name}" suggests arranging it with Auto Layout. Arrange it now?`, 'info', {
    sticky: true,
    onDismiss,
    actions: [{ label: 'Auto Layout', onClick: () => run(tabId) }, { label: 'Keep as is', secondary: true }],
  });
}

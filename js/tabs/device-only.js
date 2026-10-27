// Diagrams that exist only on this device (Slot's brief, owner decision 2026-10-16). Safari and every Slot account
// clear a site's script-written storage after 30 days of use without a click or key press on it, 7 after a tracker's
// link, and any browser clears it on request. A prompt when the person comes back is too late, so the signal shows
// while they work: one prompt per diagram, ten minutes after its first device-only edit, with the tab marker as the
// backstop. Nothing here reads window.slot: a browser gets the same.

import { tbctx } from './context.js?v=1.26.5';
import { showError, showToast } from '../feedback.js?v=1.26.5';
import { countDiagramShapes } from '../util.js?v=1.26.5';
import { deviceOnlyStep, isDeviceOnly } from '../persistence/drive-sync-logic.js?v=1.26.5';

export const DEVICE_ONLY_RISK = 'Your browser can clear it after a few weeks without a visit.';

/** Shapes on a tab: the live graph for the active one, the stored graph for the others. */
function tabShapeCount(tab) {
  const { graph } = tbctx.modules || {};
  if (tab.id === tbctx.activeTabId && graph) return graph.getElements().length;
  return countDiagramShapes(tab.graphJSON?.cells);
}

export function tabIsDeviceOnly(tab) {
  return !!tab && !tab.loadFailed && isDeviceOnly(tab, tabShapeCount(tab));
}

/** On a real content edit of the active tab: run the prompt clock. Returns whether the tab is device-only now, so the
 *  caller can re-draw the tab bar when the marker flips. */
export function noteDeviceOnlyEdit(tab, now = Date.now()) {
  const deviceOnly = tabIsDeviceOnly(tab);
  const step = deviceOnlyStep({ deviceOnly, since: tab.deviceOnlySince ?? null, prompted: !!tab.deviceOnlyPrompted, now });
  tab.deviceOnlySince = step.since;
  tab.deviceOnlyPrompted = step.prompted;
  if (step.prompt) showDeviceOnlyPrompt(tab);
  return deviceOnly;
}

/** The one prompt: Save to Google Drive where Drive is set up here, else Export. Sticky: it waits for the person. */
function showDeviceOnlyPrompt(tab) {
  const p = tbctx.modules.persistence;
  const name = tab.name;
  const action = p.isDriveConfigured?.()
    ? { label: 'Save to Google Drive', onClick: () => saveToDrive(p, tab.id, name) }
    : { label: 'Export', onClick: () => p.exportSelection?.({ tabIds: [tab.id] }) };
  showToast(`"${name}" is only on this device. ${DEVICE_ONLY_RISK}`, 'info', { sticky: true, action });
}

async function saveToDrive(p, id, name) {
  try {
    const results = await p.saveTabsToDrive([id]);
    if ((results || []).some((r) => r.status === 'ok')) showToast(`Saved "${name}" to Google Drive`, 'success');
    else if ((results || []).length) showError(`"${name}" could not be saved to Google Drive - see console.`);
  } catch (e) { showError('Could not save to Google Drive: ' + (e?.message || 'unknown error')); }
}

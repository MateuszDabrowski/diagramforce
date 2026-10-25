// Join colours (owner decision 2026-10-16, option C step 3). A query joined on several key columns draws every join in
// the same grey, so a reader cannot tell which field joins which. When a data model or data mapping opens into a tab
// (an import, a Drive or share open, a reopened browser save) with two or more join fields still grey, one prompt
// offers a colour per join field. Accept writes the colours into the diagram as one undo step, the same edit as the
// Color field, so exports and later edits see one kind of colour. A join the person coloured is never touched.

import { tbctx } from './context.js?v=1.26.4';
import { showToast } from '../feedback.js?v=1.26.4';
import { planJoinColours } from '../canvas/join-lanes.js?v=1.26.4';
import { DF_COLORS, DF_NEUTRAL_LINK } from '../persistence/diagram-palette.js?v=1.26.4';

// Amber is the mapping link colour (MAPPING_LINK_COLOR), and orange and olive sit next to it, so a join never takes them.
export const JOIN_PALETTE = [DF_COLORS.blue, DF_COLORS.green, DF_COLORS.purple, DF_COLORS.cyan, DF_COLORS.red, DF_COLORS.indigo, DF_COLORS.teal];

const FIELD_OF = (port) => port.replace(/^field-(left|right)-/, 'field-').replace(/^er-(left|right)$/, 'er');

/** The default-grey joins of a graph, as planJoinColours reads them: links between two data objects, not mappings,
 *  with a field port on at least one end. Both sides of a field row are one key. */
export function greyJoins(graph) {
  const out = [];
  for (const l of graph.getLinks()) {
    if (l.prop('linkKind') === 'mapping') continue;
    if (String(l.attr('line/stroke') || '').toUpperCase() !== DF_NEUTRAL_LINK) continue;
    const ends = [];
    for (const end of ['source', 'target']) {
      const ep = l.get(end) || {};
      const cell = ep.id ? graph.getCell(ep.id) : null;
      if (!cell || cell.get('type') !== 'sf.DataObject' || typeof ep.port !== 'string') break;
      const p = cell.position();
      ends.push({ key: `${ep.id}::${FIELD_OF(ep.port)}`, field: ep.port.startsWith('field-'), x: p.x, y: p.y + (cell.getPort?.(ep.port)?.args?.y ?? 0) });
    }
    if (ends.length === 2 && ends.some((e) => e.field)) out.push({ id: l.id, ends });
  }
  return out;
}

function planFor(tab) {
  const { graph } = tbctx.modules || {};
  if (!graph || !tab || (tab.diagramType !== 'datamodel' && tab.diagramType !== 'datamapping')) return null;
  return planJoinColours(greyJoins(graph), JOIN_PALETTE);
}

// One question at a time (SQL Studio's report, 2026-10-16): a file that also suggests Auto Layout opened with both
// sticky prompts stacked. While the Auto Layout prompt for a tab is open, its colour offer waits, and it shows once that
// prompt is answered by any route; the joins are then coloured top to bottom on the layout the person chose.
const _held = new Map();   // tabId -> { pending } while an earlier prompt for that tab is open
/** Hold the colour offer for `tabId`; the returned release shows it, if one was due, a frame later. Idempotent. */
export function holdJoinColours(tabId) {
  if (!_held.has(tabId)) _held.set(tabId, { pending: false });
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const h = _held.get(tabId);
    _held.delete(tabId);
    if (h?.pending) requestAnimationFrame(() => { try { offerJoinColours(tabId); } catch (e) { console.error('Diagramforce: join colour offer failed:', e); } });
  };
}

/** After a diagram opens into the active tab: the prompt, when two or more join fields are still grey. Returns whether
 *  it showed. Every open is a new tab, so declining needs no memory: the prompt cannot come back for this tab. */
export function offerJoinColours(tabId) {
  const hold = _held.get(tabId);
  if (hold) { hold.pending = true; return false; }
  const tab = tbctx.tabs.find((t) => t.id === tabId);
  if (!tab || tbctx.activeTabId !== tabId) return false;
  const plan = planFor(tab);
  if (!plan) return false;
  showToast(`"${tab.name}" draws ${plan.buses} join fields in the same grey. Give each its own colour?`, 'info', {
    sticky: true,
    actions: [{ label: 'Colour joins', onClick: () => colourJoins(tabId).catch((e) => console.error('Diagramforce: join colours failed:', e)) }, { label: 'Keep grey', secondary: true }],
  });
  return true;
}

/** Accept: colour the joins that are still grey, one undo step. Planned again here, as the person may have edited or
 *  switched tabs since the prompt showed. Resolves to how many joins changed. The Color field's setter loads on
 *  accept: tabs.js must stay importable without JointJS (data-export.test.js imports it in Node). */
export async function colourJoins(tabId) {
  const { applyLinkStroke } = await import('../properties/link-props.js?v=1.26.4');
  if (tbctx.activeTabId !== tabId) tbctx.switchTab?.(tabId);
  const tab = tbctx.tabs.find((t) => t.id === tabId);
  if (!tab || tbctx.activeTabId !== tabId) return 0;
  const plan = planFor(tab);
  if (!plan) return 0;
  const { graph, history } = tbctx.modules;
  history.startBatch();
  try { for (const [id, colour] of plan.colours) { const l = graph.getCell(id); if (l) applyLinkStroke(l, colour); } }
  finally { history.endBatch(); }
  return plan.colours.size;
}

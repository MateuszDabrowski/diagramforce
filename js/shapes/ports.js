// Port scaffolding (CLEANUP S3) — the shared port attrs/markup/groups/items + the sequence-lifeline port
// builders, moved out of register()'s local scope to module level so every per-type registrar imports them.
// Zero imports.

export const portAttrs = {
  circle: { r: 5, magnet: true, fill: 'var(--port-color, #1D73C9)', stroke: '#FFFFFF', strokeWidth: 1.5 },
};
export const portMarkup = [{ tagName: 'circle', selector: 'circle' }];
export const portGroups = Object.fromEntries(
  ['top', 'right', 'bottom', 'left'].map(side => [side, {
    position: { name: side },
    attrs: portAttrs,
    markup: portMarkup,
  }])
);

export const portItems = [
  { id: 'port-top', group: 'top' },
  { id: 'port-right', group: 'right' },
  { id: 'port-bottom', group: 'bottom' },
  { id: 'port-left', group: 'left' },
];

// ---- Sequence diagram port builders ----
// Participant/Actor: `count` ports evenly spaced along the *lifeline* only
// (headers are intentionally portless — users connect to the lifeline, not
// the label header). Positions may be overridden per-cell via a
// `lifelinePortRatios` array of 0–1 numbers (each a fraction of the
// lifeline length). When absent, ports are distributed evenly via
// (i+1)/(n+1).
//
// Port IDs follow `seq-port-left-<i>` / `seq-port-right-<i>` — index-based
// so regenerations keep existing link endpoints stable.
// Lifeline ports are offset ±LIFELINE_PORT_OFFSET px from the lifeline
// centre so seq-left and seq-right are rendered as two distinct, clickable
// circles on either side of the dashed line rather than overlapping on top
// of each other. Mirrors the paired-ports look Activation shapes have, and
// is kept in sync with LIFELINE_PORT_OFFSET in canvas.js (self-loop stub
// override).
export const LIFELINE_PORT_OFFSET = 8;

export function buildSeqParticipantPorts(count, ratios, headerOffset = 48, bottomOffset = 48) {
  const items = [];
  const n = Math.max(1, count | 0);
  const list = Array.isArray(ratios) && ratios.length === n
    ? ratios
    : Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));
  const xLeft  = `calc(0.5 * w - ${LIFELINE_PORT_OFFSET})`;
  const xRight = `calc(0.5 * w + ${LIFELINE_PORT_OFFSET})`;
  // Ports spread across the "usable" lifeline: [headerOffset, h - bottomOffset].
  // Reserving `bottomOffset` at the foot gives symmetric breathing room for
  // the bottom-label mirror even when it's currently hidden, so toggling
  // `showBottomLabel` doesn't reflow link endpoints.
  //   y = headerOffset + ratio * (h - bottomOffset - headerOffset)
  //     = ratio*h + ((1 - ratio)*headerOffset - ratio*bottomOffset)
  for (let i = 0; i < n; i++) {
    const ratio = Math.max(0, Math.min(1, list[i]));
    const offset = Math.round(((1 - ratio) * headerOffset - ratio * bottomOffset) * 100) / 100;
    const sign = offset >= 0 ? '+' : '-';
    const yExpr = `calc(${ratio} * h ${sign} ${Math.abs(offset)})`;
    items.push({ id: `seq-port-left-${i}`,  group: 'seq-left',  args: { x: xLeft,  y: yExpr } });
    items.push({ id: `seq-port-right-${i}`, group: 'seq-right', args: { x: xRight, y: yExpr } });
  }
  return items;
}

// SequenceActor: stick figure sits atop the lifeline which begins at y=92.
export function buildSeqActorPorts(count, ratios, lifelineTop = 92) {
  const items = [];
  const n = Math.max(1, count | 0);
  const list = Array.isArray(ratios) && ratios.length === n
    ? ratios
    : Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));
  const xLeft  = `calc(0.5 * w - ${LIFELINE_PORT_OFFSET})`;
  const xRight = `calc(0.5 * w + ${LIFELINE_PORT_OFFSET})`;
  for (let i = 0; i < n; i++) {
    const ratio = Math.max(0, Math.min(1, list[i]));
    const offset = Math.round((1 - ratio) * lifelineTop * 100) / 100;
    const yExpr = `calc(${ratio} * h + ${offset})`;
    items.push({ id: `seq-port-left-${i}`,  group: 'seq-left',  args: { x: xLeft,  y: yExpr } });
    items.push({ id: `seq-port-right-${i}`, group: 'seq-right', args: { x: xRight, y: yExpr } });
  }
  return items;
}

// SequenceActivation: narrow strip, `count` port pairs along its full height.
export function buildSeqActivationPorts(count, ratios) {
  const items = [];
  const n = Math.max(1, count | 0);
  const list = Array.isArray(ratios) && ratios.length === n
    ? ratios
    : Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));
  for (let i = 0; i < n; i++) {
    const ratio = Math.max(0, Math.min(1, list[i]));
    const yExpr = `calc(${ratio} * h)`;
    items.push({ id: `seq-port-left-${i}`,  group: 'seq-left',  args: { x: 0,         y: yExpr } });
    items.push({ id: `seq-port-right-${i}`, group: 'seq-right', args: { x: 'calc(w)', y: yExpr } });
  }
  return items;
}

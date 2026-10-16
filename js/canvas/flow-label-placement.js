// Flow connector-label collision resolution (1.22.0).
//
// A branch label is a pill up to ~250px wide, and two branches of one Decision were rendering one on top of the
// other - overlapping by 192 x 23 px, the first entirely hidden. Fixing that is easy; fixing it while every
// label still visibly BELONGS to its own connector is the whole problem, and the first cut got the second half
// wrong: it displaced pills by up to 502px in paper space, so they no longer related to any connector.
//
// WHAT SEARCHES, AND WHAT DOES NOT
// Three earlier attempts chose the label's `distance` along its own path by a FIXED RULE - index stagger, then a
// dy threshold, then a near-source/near-target split - and all three shipped overlapping labels. That produced a
// tempting conclusion, recorded at the time, that `distance` has no room to work in: 197 of 212 straight
// next-rank labelled links carry a pill wider than their whole connector.
//
// That was over-generalised. Measured across the 30-flow corpus (923 labels), the along-path SLACK - path length
// minus pill width - is p25 98px, p50 258px, p75 782px, and only 132 labels (14%) have none at all. Distance as
// a RULE is dead. Distance as a SEARCH was never tried, and it is what this module does: walk the label's own
// path for a spot that clears, nearest to where it wanted to be.
//
// Two properties fall out of that which the paper-space nudge could not give:
//   · a label stays ON ITS OWN LINE, so ownership is never in doubt - measured 0 misowned across the corpus,
//     against 41 for the shipped nudge.
//   · `distance` is PATH-RELATIVE, so the label rides its connector when a card is dragged later. An
//     `offset: {x, y}` is frozen paper space and detaches the moment anything moves.
//
// WHY IT RUNS AT LOAD, NOT ON EVERY RENDER
// `js/history.js:357` records every `change:labels` as an undo command, and pushing one clears the redo stack. A
// live resolver debounced off `render:done` would fire after any node drag, bury the user's own history under
// label nudges, and destroy redo. The load pass runs inside the JSON-loading guard, which that same listener
// already checks.
//
// It is also, deliberately, not a fight with the user. A saved position - whether this pass chose it or the user
// dragged the label there - becomes the SEED for the next run, and candidates are ordered by distance from the
// seed. So a placement that still works is kept exactly, and one that now collides moves as little as possible.

/** Overlap test with a 1px tolerance, so two rects that merely touch are not "colliding". */
const hits = (a, b) => a.x + 1 < b.x + b.w && b.x + 1 < a.x + a.w
  && a.y + 1 < b.y + b.h && b.y + 1 < a.y + a.h;

export const DISTANCE_STEP = 4;      // px between candidate points along a path - finer than the eye resolves
// ONE ring. The perpendicular fallback is the only path that takes a label off its own line, so its whole job
// is to be a last resort that stays ADJACENT. At three rings it could reach 108px, and after an Auto Layout -
// where the free band between a Decision and its targets is ~72px and every along-path point was blocked - it
// lifted a branch label clean above its own source card, reported as "one of the labels moving above the
// connected shape". One ring is one pill-height plus a gap: still visibly attached, or not worth doing.
export const FALLBACK_RINGS = 1;
export const FALLBACK_STEP = 36;     // one pill height plus a gap
// How far a twin label may move to share its twin's spot. The shared spots of "Morphes into", "New Route" and "sync"
// lay 12-97 px away. The only shared stretch of two "Deprecating" links lay 153 and 244 px away, in a crowded corner
// at a frame border: one pill there named neither line where a reader looks, so those twins stay apart.
export const TWIN_MAX_MOVE = 120;

// Frames: shapes that hold other cards (router.js and diagram-schema.js keep the same list).
const FRAME_TYPES = new Set(['sf.Container', 'sf.Zone', 'sf.TaskGroup', 'sf.BpmnPool', 'sf.BpmnSubprocess', 'sf.BpmnLoop']);

/** A frame's header band (Container accent, Pool side header) and its title text, in paper coordinates. */
function frameHeaders(paper, frame) {
  const view = paper.findViewByModel(frame);
  if (!view?.el || typeof view.getNodeBBox !== 'function') return [];
  const out = [];
  const nodes = [...view.el.querySelectorAll('[joint-selector="accent"], [joint-selector="header"], text')];
  for (const node of nodes) {
    if (node.tagName.toLowerCase() === 'text' && !node.textContent.trim()) continue;
    const r = view.getNodeBBox(node);
    if (r.width > 0 && r.height > 0) out.push({ x: r.x, y: r.y, w: r.width, h: r.height });
  }
  return out;
}

/**
 * Pure packer. Each item offers an ORDERED list of candidate rects - its own preferences, nearest first - and
 * takes the first that clears everything already placed. No geometry knowledge here at all, so the whole
 * decision is unit-testable without a browser.
 *
 * Items are processed by ASCENDING SLACK: the label with the least room to move chooses first. Sorting by
 * position instead (the first cut sorted top-to-bottom) let a label with 296px of usable path claim its seat
 * before one with a 32px connector and nowhere to go, and the constrained one was then flung 272px sideways.
 *
 * An item's `ignore` (a Set of obstacle ids) lets that one label rest on those obstacles: the frames its own link
 * lives in (see resolveFlowLabelCollisions). Items with the same `twin` key may take EXACTLY the same rect (within
 * 1 px): twin labels share one spot by design (shareTwinLabels), and a re-run must not push them apart again.
 *
 * @param {Array<{id, slack, candidates: Array<{key, x, y, w, h}>, ignore?: Set<string>, twin?: string}>} items
 * @param {Array<{id?, x, y, w, h}>} obstacles - cards and frames; never move, always avoided unless ignored
 * @returns {{ chosen: Map<string, any>, unresolved: string[] }} chosen maps id -> the winning candidate's `key`
 */
export function packLabels(items, obstacles = []) {
  // Stable and geometry-derived, so the result cannot depend on graph insertion order - two labels at the same
  // anchor would otherwise swap between loads and the diagram would not round-trip through a save.
  const order = [...items].sort((a, b) => (a.slack ?? 0) - (b.slack ?? 0)
    || (a.candidates[0]?.y ?? 0) - (b.candidates[0]?.y ?? 0)
    || (a.candidates[0]?.x ?? 0) - (b.candidates[0]?.x ?? 0)
    || String(a.id).localeCompare(String(b.id)));

  const chosen = new Map();
  const unresolved = [];
  const placed = obstacles.map((o) => ({ ...o, isLabel: false }));

  for (const item of order) {
    const blocks = (p, c) => !(p.id != null && item.ignore?.has(p.id))
      && !(item.twin && p.twin === item.twin && Math.abs(p.x - c.x) <= 1 && Math.abs(p.y - c.y) <= 1 && Math.abs(p.w - c.w) <= 1);
    const clears = (against) => item.candidates.find((c) => !against.some((p) => blocks(p, c) && hits(c, p)));
    // Prefer a spot clear of everything. Failing that, clear of the other LABELS only: a pill resting on a card
    // is still readable, whereas two pills on one spot means one of them may as well not exist.
    const win = clears(placed) || clears(placed.filter((p) => p.isLabel)) || item.candidates[0];
    if (!clears(placed.filter((p) => p.isLabel))) unresolved.push(item.id);
    chosen.set(item.id, win.key);
    placed.push({ x: win.x, y: win.y, w: win.w, h: win.h, isLabel: true, twin: item.twin });
  }
  return { chosen, unresolved };
}

/** Collinear stretches two polylines share (within 1 px), as axis runs. */
function sharedRuns(pa, pb) {
  const runs = (pts) => {
    const out = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (Math.abs(a.y - b.y) < 1 && Math.abs(a.x - b.x) >= 1) out.push({ o: 'H', c: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
      else if (Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) >= 1) out.push({ o: 'V', c: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
    }
    return out;
  };
  const out = [];
  for (const r of runs(pa)) for (const q of runs(pb)) {
    if (r.o !== q.o || Math.abs(r.c - q.c) > 1) continue;
    const lo = Math.max(r.lo, q.lo), hi = Math.min(r.hi, q.hi);
    if (hi > lo) out.push({ o: r.o, c: r.c, lo, hi });
  }
  return out;
}

/**
 * Twin labels: links that look alike merge onto one line (the shared trunk on architecture and process), and when
 * they carry the SAME text the pack set two identical pills side by side: "Morphes into" twice on 594 px of shared line
 * in vertical-lanes after Auto Layout, and two "New Route" pills 2 px apart where two green links meet a shared trunk.
 * Twins get ONE spot on a stretch both links share, at least as long as the pill, so the two pills draw as one: the
 * keeper's own spot when it lies on that stretch, else the clear point on the stretch nearest to it. Nothing is
 * removed: each link keeps its label, at a distance along its OWN line, so the two part again when the lines do. A
 * crossing is not a stretch (the runs must be collinear), and a label off its line (an offset) is left alone.
 * Mutates `chosen`.
 */
function shareTwinLabels(items, chosen, obstacles) {
  const polyline = (it) => [it.view.sourcePoint, ...(it.view.route || []), it.view.targetPoint].filter(Boolean);
  const rectOf = (it) => it.rectFor(chosen.get(it.id));
  const same = (a, b) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(a.w - b.w) <= 1;
  // The pill both twins would draw at point `p` of the stretch, or null when their pills would not coincide there.
  const atPoint = (k, it, p) => {
    const dk = k.view.getClosestPointLength?.(p), di = it.view.getClosestPointLength?.(p);
    if (!(dk >= 0) || !(di >= 0)) return null;
    const rk = k.rectFor({ distance: dk, offset: 0 }), ri = it.rectFor({ distance: di, offset: 0 });
    return same(rk, ri) ? { dk: Math.round(dk), di: Math.round(di), rect: rk } : null;
  };
  const anchor = (x) => x.view.getLabelCoordinates({ ...chosen.get(x.id), offset: 0 });
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= TWIN_MAX_MOVE;
  const keepers = [];
  for (const it of [...items].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const key = chosen.get(it.id);
    if (!it.text || !key || key.offset) continue;   // any offset, numeric or perpendicular, is off the line
    let joined = false;
    for (const k of keepers) {
      if (k.text !== it.text || k.look !== it.look) continue;
      // Already on the keeper's spot (a re-run): leave it, or rounding nudges its distance by a pixel every run.
      if (same(rectOf(it), rectOf(k))) { joined = true; break; }
      const stretches = sharedRuns(polyline(k), polyline(it)).filter((r) => r.hi - r.lo >= (r.o === 'H' ? it.w : it.h));
      if (!stretches.length) continue;
      const here = anchor(k), mine = anchor(it);
      const onStretch = (p) => stretches.some((r) => (r.o === 'H' ? Math.abs(p.y - r.c) <= 1 && p.x >= r.lo - 1 && p.x <= r.hi + 1
        : Math.abs(p.x - r.c) <= 1 && p.y >= r.lo - 1 && p.y <= r.hi + 1));
      // 1. The keeper's spot is on the shared stretch: the twin moves onto it.
      let spot = onStretch(here) && near(mine, here) ? atPoint(k, it, here) : null;
      // 2. Else the clear point of the stretch nearest the keeper's spot, clear of cards (its own frames aside) and of
      //    every other label.
      if (!spot) {
        const others = items.filter((o) => o !== k && o !== it && chosen.get(o.id)).map(rectOf);
        const blocked = (r) => obstacles.some((b) => !(b.id != null && (k.ignore?.has(b.id) || it.ignore?.has(b.id))) && hits(r, b))
          || others.some((o) => hits(r, o));
        const pts = [];
        for (const r of stretches) {
          const half = (r.o === 'H' ? it.w : it.h) / 2;
          for (let t = r.lo + half; t <= r.hi - half; t += DISTANCE_STEP) pts.push(r.o === 'H' ? { x: t, y: r.c } : { x: r.c, y: t });
        }
        pts.sort((p, q) => Math.hypot(p.x - here.x, p.y - here.y) - Math.hypot(q.x - here.x, q.y - here.y));
        for (const p of pts) {
          if (!near(p, here) || !near(p, mine)) continue;
          const c = atPoint(k, it, p);
          if (c && !blocked(c.rect)) { spot = c; chosen.set(k.id, { distance: c.dk }); break; }
        }
      }
      if (!spot) continue;
      chosen.set(it.id, { distance: spot.di });
      joined = true;
      break;
    }
    if (!joined) keepers.push(it);
  }
}

/**
 * Measure every flow connector label, resolve collisions along each label's own path, and write the winning
 * `distance` back. No-op on a diagram with no flow cards. Call from the load pass, inside the JSON-loading guard.
 *
 * `collisionOnly` (1.22.0, architecture/org/process): skip the target-centred ideal entirely - a label moves
 * ONLY if it collides, and then to the nearest clear point on its own path. Flow branch labels and datamodel
 * join labels describe the card they ARRIVE at, so hovering over the target reads right. An architecture label
 * ("REST", "Event Bus") describes the PIPE - the midpoint is the semantically-right spot, and the only defect
 * after Auto Layout is collision. Measured on a 7-label architecture corridor + a 3-label org chart: with the
 * ideal candidate in play a colliding org label jumped 151px to its target and even NON-colliding labels moved
 * 24-58px; collision-only moved the same colliding label 8px and left every non-collider exactly at the
 * midpoint. When set, `preferTargetCentre` is moot (there is no ideal candidate to prefer).
 */
export function resolveFlowLabelCollisions(cctx, { preferTargetCentre = false, seededLabels = null, scope = 'flow', collisionOnly = false } = {}) {
  const { graph, paper } = cctx;
  if (!graph || !paper) return null;
  const elements = graph.getElements();
  // The frames a link's own ends sit in. Every point of a link inside a zone lies on that zone, so with the zone as an
  // obstacle no candidate ever cleared: the pack fell back to "clear of other labels only" and dropped card
  // avoidance, which left "Unified Segments" on the Bloomreach card (vertical-lanes, 2026-10-12). The router already
  // lets a link pass through its own frames. A frame the link only crosses still blocks: a label there reads as
  // belonging to it.
  const ownFrames = (link) => {
    const ids = new Set();
    for (const end of [link.get('source'), link.get('target')]) {
      for (const a of graph.getCell(end?.id)?.getAncestors?.() || []) if (FRAME_TYPES.has(a.get('type'))) ids.add(a.id);
    }
    return ids;
  };
  // `scope` (1.22.0): the resolver was born flow-only and the df.Flow gate kept it from firing on every load
  // of every diagram type. The datamodel Auto Layout now wants the SAME target-centred placement for its join
  // labels (`scope: 'any'`), so the gate is opt-out rather than deleted - the default keeps the load pass and
  // every flow call site byte-identical in behaviour.
  if (scope !== 'any' && !elements.some((e) => String(e.get('type') || '').startsWith('df.Flow'))) return null;

  // The paper is async, so a view read straight after a model write returns the stale route. Flush first - this
  // is a load pass, so paying for one synchronous render is fine.
  paper.updateViews();

  const labelled = graph.getLinks().filter((l) => (l.labels() || []).length);
  // The <2 early-out holds for both TARGET-CENTRED scopes. Considered relaxing it to 1 under 'any', and measured
  // instead: after a layout, a lone parent-child link is straight, so its midpoint seed already sits centred
  // above the target - the placement the resolver would compute anyway. Unobservable behaviour stays unshipped.
  //
  // Under `collisionOnly` the reasoning inverts: the defect there is label-on-CARD, and one label is enough to
  // produce it. Measured on an org chart with a single labelled dotted-line report: after Auto Layout the lone
  // pill sat on the VP card (78px^2 of overlap) and the <2 gate skipped the fix entirely. Cards are obstacles in
  // the pack, so a lone label is a real 1-item search, not a no-op.
  if (labelled.length < (collisionOnly ? 1 : 2)) return null;

  const items = [];
  for (const link of labelled) {
    const pos = link.labels()[0]?.position;
    if (!pos) continue;
    const view = paper.requireView(link);
    const node = view?.findLabelNode?.(0);
    if (!node || typeof view.getConnectionLength !== 'function') continue;
    const len = view.getConnectionLength();
    if (!(len > 0)) continue;
    // The label <g>'s transform IS the anchor and getBBox() is relative to it, so the local box is invariant as
    // the anchor slides along the path - one measurement serves every candidate. Pad by 1 for the pill stroke,
    // which getBBox() under-reports by ~1px against getBoundingClientRect().
    // An architecture link's frequency overlay shares label 0's anchor and draws 22 px below it, so the pair is
    // measured as one block: measured alone, label 0 moved off a card while the overlay stayed on it.
    let bb = node.getBBox();
    const freqIdx = link.labels().findIndex((l) => l?.attrs?.freqText);
    const freqBox = freqIdx > 0 ? view.findLabelNode(freqIdx)?.getBBox?.() : null;
    if (freqBox) {
      const x = Math.min(bb.x, freqBox.x), y = Math.min(bb.y, freqBox.y);
      bb = { x, y, width: Math.max(bb.x + bb.width, freqBox.x + freqBox.width) - x, height: Math.max(bb.y + bb.height, freqBox.y + freqBox.height) - y };
    }
    const w = bb.width + 2, h = bb.height + 2;
    const rectFor = (position) => {
      const a = view.getLabelCoordinates(position);
      return { x: a.x + bb.x - 1, y: a.y + bb.y - 1, w, h };
    };
    const at = (d) => rectFor({ distance: d, offset: 0 });
    // Where it currently sits, in absolute px, so candidates can be ordered by how far they move it.
    const seedD = typeof pos.distance === 'number' && pos.distance > 0 && pos.distance <= 1
      ? pos.distance * len
      : Math.max(0, Math.min(len, pos.distance < 0 ? len + pos.distance : (pos.distance ?? len / 2)));

    // THE PREFERRED SPOT: centred on the card the connector POINTS AT - horizontally when it arrives at a
    // top/bottom port, vertically when it arrives at a side. A branch label's job is to say which branch you
    // are looking at, and sitting directly over the card that branch leads to says that with no ambiguity at
    // all. Suggested by the owner after two placement rules that were technically clear of each other and still
    // read as arbitrary: "maybe let's try to center it to the element it targets? Horizontally for top/bottom
    // and vertically for left/right?"
    //
    // Offered as the point on the label's OWN path nearest that centre - not as a paper-space position - so the
    // label stays on its line and keeps riding it when a card moves. If the ideal is unreachable the ordinary
    // nearest-to-seed search below takes over.
    const tgt = graph.getCell(link.get('target')?.id);
    const tPort = String(link.get('target')?.port || '');
    let idealD = null;
    // `collisionOnly` suppresses the ideal COMPLETELY rather than merely demoting it: demoted, it still sits
    // ahead of the grid, so a colliding label would jump to the target centre before the nearest clear spot was
    // even tried - measured on the org fixture as a 151px jump where the nearest clear grid point was 8px away.
    if (!collisionOnly && tgt?.position) {
      const tp = tgt.position(), ts = tgt.size();
      const vertical = !tPort || tPort.includes('top') || tPort.includes('bottom');
      const want = vertical ? tp.x + ts.width / 2 : tp.y + ts.height / 2;
      let best = Infinity;
      for (let d = 2; d <= len; d += DISTANCE_STEP) {
        const a = view.getLabelCoordinates({ distance: d, offset: 0 });
        const gap = Math.abs((vertical ? a.x : a.y) - want);
        if (gap < best) { best = gap; idealD = d; }
      }
    }

    // ORDER. On LOAD the current position comes first: a placement that still works is kept exactly, whether
    // this pass chose it or the user dragged the label there. After AUTO LAYOUT the target-centred point comes
    // first instead - auto layout has just reset every label to the path midpoint, so "where it already is" is
    // not a preference worth honouring, it is a default that was reported as a mess. Without this split the
    // reset midpoint wins whenever it merely fails to collide, and the centring never gets a say: measured
    // across three flow fixtures it left one entirely unchanged (median 137px off its target's axis).
    //
    // WHERE IT ALREADY IS. Without this the nearest candidate is a point on the 4px grid
    // rather than the position itself, so a label that collides with nothing still got snapped - and a
    // deliberately placed one lost its exact spot: an authored `{distance: 0.5, offset: 7}` became
    // `{distance: 86, offset: 0}`. Offering the current position as candidate zero makes "a label that does not
    // need to move does not move" true rather than approximately true, and it is what lets a user's own drag
    // survive: their placement is kept whole unless something actually overlaps it.
    const here = { key: { ...pos }, ...rectFor(pos) };
    const ideal = idealD == null ? null : { key: { distance: idealD }, ...at(idealD) };
    // Prefer the target centre when the position is not a CHOICE. Two ways that happens, and they are the same
    // case: Auto Layout has just reset every label to its path midpoint (`preferTargetCentre`), or the document
    // authored no position at all and `defaultFlowLabelPosition` seeded an index stagger (`seededLabels`).
    // A converted flow is the second one - the converter deliberately authors no `position`, so the app can
    // place the label against the resolved route - and without this the seeded stagger wins simply by not
    // colliding. Reported on a freshly converted Journey: "the Spring Arrivals flow doesn't follow the rule for
    // labels over their cards".
    const isDefault = preferTargetCentre || !!seededLabels?.has(link.id);
    const candidates = isDefault && ideal ? [ideal, here] : [here, ...(ideal ? [ideal] : [])];

    // Then every other point along its own path, nearest to the seed first.
    const grid = [];
    for (let d = 2; d <= len; d += DISTANCE_STEP) grid.push(d);
    grid.sort((p, q) => Math.abs(p - seedD) - Math.abs(q - seedD) || p - q);
    for (const d of grid) candidates.push({ key: { distance: d }, ...at(d) });

    // Perpendicular nudges, appended LAST and tightly bounded, for a label whose own path is entirely blocked.
    // Measured: this fires for 1 label in 923. It is the only path that leaves a pill off its own line, which
    // is why it is the last resort and why the budget is 108px rather than the 502px the first cut allowed.
    const base = at(seedD);
    for (let k = 1; k <= FALLBACK_RINGS; k++) {
      for (const dy of [-k * FALLBACK_STEP, k * FALLBACK_STEP]) {
        candidates.push({ key: { distance: seedD, offset: { x: 0, y: dy } },
          x: base.x, y: base.y + dy, w, h });
      }
    }
    const text = String(link.labels()[0]?.attrs?.text?.text || link.labels()[0]?.attrs?.label?.text || '').trim();
    const look = `${String(link.attr('line/stroke') || '').toLowerCase()}|${link.get('lineStyle') || link.attr('line/strokeDasharray') || 'none'}`;
    // Twins only where a label describes the LINE (collisionOnly: architecture, org, process). A datamodel join label or a
    // flow branch label describes its TARGET, so five relationships with one join text keep five pills, one per target.
    const twin = collisionOnly && text ? `${text}\u0000${look}` : undefined;
    items.push({ id: link.id, slack: len - w, candidates, ignore: ownFrames(link), view, text, look, w, h, rectFor, twin });
  }
  // Mirrors the labelled-count gate above: collision-only mode packs a single label against the cards.
  if (items.length < (collisionOnly ? 1 : 2)) return null;

  const obstacles = [];
  for (const e of elements) {
    const p = e.position(), s = e.size();
    obstacles.push({ id: e.id, x: p.x, y: p.y, w: s.width, h: s.height });
    // A frame's title and header band stay in the way even for the links inside it.
    if (FRAME_TYPES.has(e.get('type'))) obstacles.push(...frameHeaders(paper, e));
  }

  const { chosen, unresolved } = packLabels(items, obstacles);
  if (collisionOnly) shareTwinLabels(items, chosen, obstacles);
  let moved = 0;
  for (const [id, key] of chosen) {
    const link = graph.getCell(id);
    const pos = link?.labels()?.[0]?.position;
    if (!pos) continue;
    const next = key.offset !== undefined ? { distance: key.distance, offset: key.offset }
      : { distance: key.distance, offset: 0 };
    if (JSON.stringify(pos) === JSON.stringify(next)) continue;   // idempotent: an unchanged label is not rewritten
    link.label(0, { position: next });
    moved++;
  }
  // Flush AGAIN. On an async paper these writes are batched, and measured here nothing flushed them on its own:
  // the model carried the new position while the pill still rendered at the old one, so the diagram looked
  // exactly as broken as before the fix. One synchronous flush at the end of a load pass is the whole cost.
  if (moved) paper.updateViews();
  return { measured: items.length, moved, unresolved };
}

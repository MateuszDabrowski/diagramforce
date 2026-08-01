#!/usr/bin/env node
// objects-to-diagramforce.mjs — turn a SELECTION of Salesforce objects into a Diagramforce `datamodel` diagram.
//
//   node scripts/objects-to-diagramforce.mjs selection.json [out.json]
//
// Works for BOTH core sObjects (Account, Contact, custom objects) and Data Cloud DMOs (`ssot__*__dlm`) - they
// are the same thing to this script: named objects with typed fields and relationships between them.
//
// ── The division of labour, which is the whole design ────────────────────────────────────────────────────────
// YOU (or the agent) decide WHAT goes in the diagram; this script handles HOW it is drawn. That split is
// deliberate: a mature org has hundreds of objects and `Account` alone can carry 400+ fields, so a whole-org
// dump is both unloadable (MAX_CELL_COUNT is 2000) and unreadable. "Which objects and which fields matter for
// THIS diagram" is a judgement call, and judgement is the part a CLI cannot make. The official MCN Consent Data
// Model - 21 objects, 3 to 14 fields each out of DMOs carrying up to 118 - is exactly that judgement applied by
// hand, and it is the shape this script exists to reproduce.
//
// So: query the org, pick, write a selection, run this. The mechanical parts you should NOT hand-author -
// stable field ids, field ports, ER crow's-foot markers, zone embedding, layout - are what this does.
//
// ── Selection format ────────────────────────────────────────────────────────────────────────────────────────
// {
//   "title": "MCN Consent Data Model",
//   "zones":   [ { "label": "Contact Points", "objects": ["ssot__ContactPointEmail__dlm"] } ],
//   "objects": [ { "name": "ssot__ContactPointEmail__dlm", "label": "Contact Point Email",
//                  "category": "Profile", "headerColor": "#1D73C9",
//                  "fields": [ { "label": "Id", "apiName": "ssot__Id__c", "type": "Text",
//                                "keyType": "pk", "required": true } ] } ],
//   "relationships": [ { "from": "ssot__ContactPointEmail__dlm.ssot__PartyId__c",
//                        "to":   "ssot__Individual__dlm.ssot__Id__c" } ]
// }
//
// `relationships` are ONE-to-MANY as written: `to` is the ONE end (the parent's key), `from` is the MANY end
// (the child's foreign key) - which is how a Salesforce lookup reads, so `Contact.AccountId -> Account.Id`.
//
// ── Getting the raw material out of an org ──────────────────────────────────────────────────────────────────
//   core objects:  sf data query -t -r csv -o <org> \
//                    -q "SELECT QualifiedApiName, Label, DataType, ReferenceTo, RelationshipName, IsNillable \
//                        FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = 'Contact'"
//                  `DataType` reads `Lookup(Account)` and `ReferenceTo` resolves the target, so a relationship
//                  needs no extra lookup.
//   Data Cloud:    sf api request rest "/services/data/v67.0/ssot/data-model-objects?limit=200" -o <org>
//                  (paginate - the default is 50) and, for DMO-to-DMO relationships,
//                  sf org list metadata -m FieldSrcTrgtRelationship -o <org>
//
// Zero dependencies. Emits the standard single-diagram envelope, validated by scripts/validate-diagram.mjs.
import { readFileSync, writeFileSync } from 'node:fs';

// Verbatim from js/er-markers.js. A pure ER relationship carries NO `linkKind` - its absence is what marks it as
// one (a `linkKind` of 'mapping' would make it a Data Cloud field mapping instead), and the app does not derive
// these markers on load, so they are authored here.
const ER_ONE = 'M -12 -8 L -12 8 M -12 0 L 0 0';
const ER_MANY = 'M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0';
// A relationship takes the accent of the object it BELONGS TO - the MANY end, the child that carries the
// foreign key - so a card and every arrow leaving it read as one thing. Colouring by the `to` end was measured
// and rejected: 47 of 126 relationships in a 21-object model land on `User.Id`, so keying off the parent gives
// one colour to exactly the bundle it is supposed to separate.
// #1D73C9 remains the fallback for a selection that names no headerColor - the same default a card takes.
const LINK_COLOR = '#1D73C9';

// Card geometry. Height tracks the field count because the app sizes a DataObject from its rows; getting this
// roughly right means the imported diagram does not need an Auto Size pass to be readable.
// 480 wide, measured off the official data model rather than chosen: an ERD card carries `Label (ApiName)`
// plus a type column, and at 260 (the DATA MAPPING width) every row truncates mid-name.
const CARD_W = 480, HEADER_H = 44, ROW_H = 22, CARD_PAD = 12;
const COL_GAP = 120, ROW_GAP = 80;

const die = (msg) => { console.error(msg); process.exit(1); };

/** A stable, collision-free field id. Field ports are `field-<fid>`, so this has to be deterministic: a
 *  regenerated diagram must keep the same ports or every link silently detaches. */
function makeFid(objectName, apiName, used) {
  const slug = (s) => String(s).replace(/__c$|__dlm$|__dll$/i, '').replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '').toLowerCase();
  const base = `${slug(objectName).slice(0, 14)}_${slug(apiName).slice(0, 18)}`;
  let fid = base, n = 2;
  while (used.has(fid)) fid = `${base}_${n++}`;
  used.add(fid);
  return fid;
}

/** Salesforce type -> the app's SF_FIELD_TYPES allowlist. An unmapped type would be shown verbatim by the field
 *  editor, which is honest but jarring, so the common ones are normalised and the rest fall back to Text. */
const TYPE_MAP = {
  string: 'Text', text: 'Text', textarea: 'Text Area', longtextarea: 'Long Text Area', richtextarea: 'Rich Text Area',
  id: 'ID', reference: 'Lookup', lookup: 'Lookup', masterdetail: 'Master-Detail',
  boolean: 'Boolean', checkbox: 'Checkbox', currency: 'Currency', date: 'Date', datetime: 'DateTime',
  email: 'Email', phone: 'Phone', url: 'URL', percent: 'Percent', double: 'Number', int: 'Number',
  integer: 'Number', number: 'Number', picklist: 'Picklist', multipicklist: 'Multi-Picklist',
  multiselectpicklist: 'Multi-Picklist', autonumber: 'Auto Number', formula: 'Formula',
};
const normType = (t) => {
  if (!t) return 'Text';
  const raw = String(t).trim();
  // `Lookup(Account)` / `Master-Detail(Account)` arrive straight from FieldDefinition.DataType.
  const m = raw.match(/^(Lookup|Master-Detail)\s*\(/i);
  if (m) return m[1].toLowerCase() === 'lookup' ? 'Lookup' : 'Master-Detail';
  return TYPE_MAP[raw.toLowerCase().replace(/[\s-]/g, '')] || TYPE_MAP[raw.toLowerCase()] || 'Text';
};

export function buildDiagram(spec, appVersion = '1.21.7') {
  const objects = spec.objects || [];
  if (!objects.length) die('The selection lists no objects.');

  // ── Cards ──────────────────────────────────────────────────────────────────
  const usedFids = new Set();
  const byName = new Map();
  const cells = [];
  objects.forEach((o, i) => {
    if (!o.name) die(`objects[${i}] has no "name".`);
    const id = `obj-${i}`;
    const fields = (o.fields || []).map((f) => ({
      label: f.label || f.apiName,
      apiName: f.apiName,
      type: normType(f.type),
      keyType: f.keyType ?? null,
      fid: makeFid(o.name, f.apiName, usedFids),
      ...(f.required ? { required: true } : {}),
      ...(f.length ? { length: f.length } : {}),
    }));
    const cell = {
      id, type: 'sf.DataObject', z: 2000,
      position: { x: 0, y: 0 },                                   // laid out below
      size: { width: CARD_W, height: HEADER_H + fields.length * ROW_H + CARD_PAD },
      objectName: o.label || o.name,
      // BOTH are required. `objectName` is the prop the panel and table view read; `attrs.headerLabel.text` is
      // what the CARD actually renders, and nothing syncs one to the other on load - authoring only the prop
      // draws 21 cards all captioned "Object", which is what the first run of this did.
      // THREE places, not one. `headerColor` is only read by the properties PANEL (js/properties/renderers-core.js
      // - it shows the current value); what actually RENDERS is `attrs.header.fill` plus `attrs.headerCover.fill`,
      // and nothing syncs the prop to the attrs on load. Authoring only the prop drew four identically blue cards
      // while their connectors were four different colours - the same trap as `objectName` vs
      // `attrs.headerLabel.text` below, which cost a cycle when this script was first written.
      attrs: {
        headerLabel: { text: o.label || o.name },
        header: { fill: o.headerColor || LINK_COLOR },
        headerCover: { fill: o.headerColor || LINK_COLOR },
      },
      // The API name lives on every field already; the card shows the readable name. `category` drives the
      // Data Cloud styling when present and is simply absent for core objects.
      ...(o.category ? { category: o.category } : {}),
      headerColor: o.headerColor || '#1D73C9',
      showLabels: true, showFieldLengths: false,
      fields,
    };
    byName.set(o.name, { cell, fieldsByApi: new Map(fields.map((f, k) => [(o.fields[k] || {}).apiName, f])) });
    cells.push(cell);
  });

  // ── Layout: zone-aware columns ─────────────────────────────────────────────
  // Objects in the same zone stack in one column, so a zone is a clean vertical band and its box never has to
  // enclose scattered cards. Ungrouped objects follow in their own columns. Same reasoning as the mermaid
  // subgraph banding: group membership decides the CROSS axis, never the reading order.
  const zoneOf = new Map();
  (spec.zones || []).forEach((z, zi) => (z.objects || []).forEach((n) => zoneOf.set(n, zi)));
  const columns = [];
  (spec.zones || []).forEach((z, zi) => {
    const members = objects.filter((o) => zoneOf.get(o.name) === zi);
    if (members.length) columns.push({ zone: z, members });
  });
  const loose = objects.filter((o) => !zoneOf.has(o.name));
  // Ungrouped cards are split into columns balanced BY HEIGHT, not three at a time.
  //
  // A fixed three-per-column ignores both how many cards there are and how tall each one is. Four objects came
  // out 3 + 1: one 1978px strip beside a lone 606px card, using about a third of the canvas width and forcing a
  // 45% zoom to fit. Cards also differ a lot in height - a card is 44 + 22 per field - so even a balanced COUNT
  // can leave one column twice the height of its neighbour.
  //
  // So: pick the column count that makes the whole block roughly square (a column is a fixed CARD_W + COL_GAP
  // wide, so k ~ sqrt(totalHeight / columnWidth)), then fill columns in order until each reaches its share of
  // the height. Order is preserved - the selection order is the reader's, and re-sorting cards to pack them
  // tighter would scramble it.
  if (loose.length) {
    const h = (o) => byName.get(o.name).cell.size.height + ROW_GAP;
    // Fill k columns in order, starting a new one once the current has had its share of the total height.
    // Order is preserved - the selection order is the reader's, and re-sorting cards to pack them tighter would
    // scramble it - so this balances by height WITHIN the given order rather than bin-packing freely.
    // Split into k columns by PREFIX SUM: column j should end at (j+1)/k of the total height, so each card is
    // taken while doing so gets the running total CLOSER to that mark. Order is preserved - the selection order
    // is the reader's, and re-sorting cards to pack them tighter would scramble it.
    //
    // Two simpler rules were tried and both degenerate at the tail, because once a fixed share is spent there is
    // nothing left to balance with: 9 equal cards over 7 columns gave six single-card columns and one holding
    // three (heights 738 x6 and 2214), and 12 cards over 5 gave four columns of two and a last of four.
    const splitInto = (k) => {
      const hs = loose.map(h);
      const total = hs.reduce((a2, b2) => a2 + b2, 0);
      const out = [];
      let idx = 0, cum = 0;
      for (let j = 0; j < k && idx < loose.length; j++) {
        const ideal = (total * (j + 1)) / k;
        const bucket = [];
        while (idx < loose.length) {
          // Leave at least one card for every column still to come, or k columns cannot all be filled.
          if (bucket.length && loose.length - idx <= k - j - 1) break;
          const after = cum + hs[idx];
          if (bucket.length && Math.abs(after - ideal) > Math.abs(cum - ideal)) break;
          bucket.push(loose[idx]); cum = after; idx++;
        }
        out.push(bucket);
      }
      while (idx < loose.length) out[out.length - 1].push(loose[idx++]);
      return out.filter((bk) => bk.length);
    };

    // Pick k by MEASURING the block each k produces, rather than by a closed-form guess. sqrt(total/colWidth)
    // was tried both ways and neither rounding is right for every count: `round` stacked two objects in one
    // column (aspect 0.43) and `ceil` split four into 2+1+1. Scoring the real aspect settles it per case.
    // The target is 1.4, not 1.0 - fit-to-screen is HEIGHT-bound and a monitor is wider than it is tall, so a
    // block should lean wide. Ties go to fewer columns, which keeps related cards near each other.
    const TARGET_AR = 1.4;
    // Scored in LOG space, and ASYMMETRICALLY. A plain |ar - target| is symmetric in ratio space, so it rated a
    // 480x856 tall strip (0.56) as a better fit than a 1080x388 wide band (2.78) and put four small cards in a
    // single column. Too TALL costs double, because fit-to-screen is height-bound: every extra row of height
    // zooms the whole diagram out, whereas extra width is free until it runs off the side.
    let best = null;
    for (let k = 1; k <= loose.length; k++) {
      const buckets = splitInto(k);
      if (buckets.length !== k) continue;                       // k columns were not actually fillable
      const w = k * (CARD_W + COL_GAP) - COL_GAP;
      const hgt = Math.max(...buckets.map((b) => b.reduce((n, o) => n + h(o), 0) - ROW_GAP));
      const dev = Math.log((w / hgt) / TARGET_AR);
      const score = dev < 0 ? -dev * 2 : dev;
      if (!best || score < best.score - 1e-9) best = { score, buckets };
    }
    for (const b of best.buckets) columns.push({ zone: null, members: b });
  }

  let x = 40;
  const ZONE_PAD = 20, ZONE_TOP = 48;
  columns.forEach((col) => {
    const inZone = !!col.zone;
    let y = 60 + (inZone ? ZONE_TOP : 0);
    const top = y;
    col.members.forEach((o) => {
      const { cell } = byName.get(o.name);
      cell.position = { x: x + (inZone ? ZONE_PAD : 0), y };
      y += cell.size.height + ROW_GAP;
    });
    if (inZone) {
      const zid = `zone-${cells.length}`;
      const height = (y - ROW_GAP) - top + ZONE_TOP + ZONE_PAD;
      cells.push({
        id: zid, type: 'sf.Zone', z: 0,
        position: { x, y: top - ZONE_TOP },
        size: { width: CARD_W + ZONE_PAD * 2, height },
        attrs: { label: { text: col.zone.label || 'Zone' } },
        embeds: col.members.map((o) => byName.get(o.name).cell.id),
      });
      col.members.forEach((o) => { byName.get(o.name).cell.parent = zid; });
    }
    x += CARD_W + (inZone ? ZONE_PAD * 2 : 0) + COL_GAP;
  });

  // ── Relationship links ─────────────────────────────────────────────────────
  // FIELD-to-OBJECT. The MANY end anchors on the child's actual foreign-key ROW (`field-left-<fid>` /
  // `field-right-<fid>`); the ONE end stays on the parent's object-level `er-left` / `er-right`.
  //
  // Both ends were object-level until 1.22.0, and that is why an ERD's connectors bundled: every relationship
  // between one pair of cards resolved to the SAME two anchor points, so N relationships painted as one thick
  // line. Measured on a 21-object model, 126 relationships produced 90 distinct paths and 3.7% unique ink.
  // Anchoring the child end on its own row gives each relationship its own start and answers the question the
  // reader is actually asking - WHICH lookup is this? - without a label.
  //
  // The parent end deliberately stays object-level. It is the object's identity that is being pointed at, and
  // 47 of those 126 relationships land on `User.Id`: moving that fan-in from the header to row 0 relocates the
  // pile rather than removing it, and it would switch off the app's own header-port fan-out for that end.
  //
  // The precondition this creates: `field-*` ports only exist for fields the card is SHOWING, and the
  // "Key Fields Only" display toggle filters to `keyType` fields. So the FROM field is FORCED to `fk` below -
  // without it, a hand-written selection that omits keyType would have its ports filtered away and sfManhattan
  // would fall back to a straight diagonal across the canvas.
  //
  // Side is picked from relative POSITION, the same rule the flow converter uses, so the two stubs face each
  // other instead of doubling back. `to` is the ONE end, `from` the MANY end - the direction a lookup reads.
  const warnings = [];
  // How many self-relationships have already been drawn on each card, so the next one takes the other edge.
  const selfCount = new Map();
  (spec.relationships || []).forEach((r, i) => {
    const parse = (s) => {
      const dot = String(s || '').lastIndexOf('.');
      return dot < 0 ? [s, null] : [s.slice(0, dot), s.slice(dot + 1)];
    };
    const [fromObj, fromField] = parse(r.from);
    const [toObj, toField] = parse(r.to);
    const a = byName.get(fromObj), b = byName.get(toObj);
    if (!a || !b) {
      warnings.push(`relationships[${i}] references an object not in the selection (${!a ? fromObj : toObj}) - skipped.`);
      return;
    }
    const af = a.fieldsByApi.get(fromField), bf = b.fieldsByApi.get(toField);
    if (!af || !bf) {
      // The link draws object-to-object, but the named FIELDS still have to be on the cards: they are what the
      // relationship means, and a diagram asserting `Contact -> Account` via a key the reader cannot see is
      // worse than one that omits it. So this is a selection error, not a drawing problem.
      warnings.push(`relationships[${i}] names a field that is not in the selection `
        + `(${!af ? `${fromObj}.${fromField}` : `${toObj}.${toField}`}) - skipped; add the field to the object `
        + 'so the relationship is visible on the card it belongs to.');
      return;
    }
    // Layout has already run, so relative position is known.
    const dx = b.cell.position.x - a.cell.position.x;
    // A SELF-relationship - `Contact.ReportsToId -> Contact.Id`, `Account.ParentId -> Account.Id`, and the
    // `MasterRecordId` every standard object carries - is a real hierarchy worth drawing, but both ends land
    // on the SAME card. Sending it out one side and back into that same side degenerates into a stub tucked
    // behind the card's corner, which is what shipped. Out the side and in through the TOP instead: the
    // orthogonal router then draws a visible loop over the card, which is how a self-reference reads.
    const self = a.cell.id === b.cell.id;
    // The child's FK ROW is the source anchor. A field port exists only while the field is VISIBLE, and the
    // "Key Fields Only" display toggle filters to `keyType` fields - so stamp `fk` on the FROM field when the
    // selection did not. Without it that toggle deletes the port, `getPortInfo` returns null, and sfManhattan
    // degrades to a straight diagonal across the canvas.
    if (!af.keyType) af.keyType = 'fk';

    // A SELF-relationship goes TOP TO TOP - out of the card's top port and straight back into it - so it draws
    // a small bracket ABOVE the card instead of anything beside it. The owner's proposal: "add option to target
    // the same port that was a starting point, and then it would allow for top-to-top self relationship".
    //
    // Every side-anchored version of this has failed for one reason: the space beside a card is not free. It is
    // the corridor every cross-object relationship runs through, and on top of that `portGroupToSide`
    // (js/canvas/router.js) recognises only top/right/bottom/left - so `er-*` and `field-*` ends are invisible
    // to connector distribution and ALL of them terminate on one pixel. Measured on an 8-object org model:
    // Account's `er-right` carried five link ends at the identical point, the self-loop among them. That pile
    // in a 120px gutter is what "too many play around self-relationships" was.
    //
    // The top edge is empty by construction - the ERD grid stacks cards in columns, so nothing routes above a
    // card - and `port-top` IS in group `top`, the one family the router already distributes. Measured against
    // the previous field-row -> `er-<side>` shape on the same 8-object model: total ink 577px -> 438px, ink
    // drawn on top of another link 122px -> 0px, and it no longer reaches into the gutter at all (32px -> 0).
    // Both ends on ONE port is not degenerate: sfManhattan gives it a real 146px bracket.
    //
    // Alternating top / bottom is what keeps two loops on one card apart. User carries ManagerId AND
    // CreatedById; both on the top edge coincide for 146px, which is one line as far as the reader is
    // concerned. Alternating measures 0px of sibling overlap for the same total ink.
    let sPort, tPort;
    if (self) {
      const n = selfCount.get(a.cell.id) || 0;
      selfCount.set(a.cell.id, n + 1);
      const edge = n % 2 === 0 ? 'top' : 'bottom';
      sPort = tPort = `port-${edge}`;
    } else {
      const side = dx > 0 ? 'right' : 'left';
      sPort = `field-${side}-${af.fid}`;
      tPort = dx > 0 ? 'er-left'
        : dx < 0 ? 'er-right'
          : 'er-left';   // same column, different cards - leave and re-enter the same side
    }
    // No waypoints, on any relationship. An earlier self-loop carried explicit vertices and that was the real
    // defect behind "when I clicked simplify path on them, they exploded": Simplify path clears vertices
    // (js/properties/link-props.js) and so does Auto Layout, so a loop that EXISTS only because of its
    // waypoints collapses the moment either runs. Ports survive both - measured, the top-to-top bracket is
    // byte-identical before and after Simplify path.
    //
    // The child's accent, matching its card header. Markers take it too, or a crow's foot reads as a separate
    // object from the line it terminates.
    const accent = a.cell.headerColor || LINK_COLOR;
    cells.push({
      id: `rel-${i}`, type: 'standard.Link', z: 3000,
      // Field ports render a `rect` and the ER / top groups a `circle` (js/shapes/ports.js), so naming one
      // magnet for both ends would leave the source unresolvable. Omitting it on the field end is what every
      // other field-anchored fixture in this repo does.
      source: { id: a.cell.id, port: sPort },
      target: { id: b.cell.id, port: tPort, magnet: 'circle' },
      // A self-reference reads as an aside rather than as a relationship between two things on the canvas, so
      // it is DOTTED - the connector panel's own "Dotted" value, so the control shows the matching option.
      // Via the `lineStyle` prop and never `line/strokeDasharray`: the overlay manager owns the dash render,
      // and a dasharray on the line bleeds into the open-stroke crow's-foot markers on Safari (gotcha 1.1).
      ...(self ? { lineStyle: '2 4' } : {}),
      // MEASURED off templates/mcn-consent-data-model.json, where all 37 relationships carry exactly these.
      // Omitting them is not "the default is fine" - a standard.Link with no router is JointJS's straight
      // line between anchors, so every relationship rendered as a long diagonal cutting across the canvas
      // instead of the orthogonal elbows an ERD reads by. The app has no load-time heal for this the way it
      // does for mapping links, so an authored ERD has to say it.
      router: { name: 'sfManhattan' },
      connector: { name: 'rounded', args: { radius: 8 } },
      attrs: { line: {
        stroke: accent, strokeWidth: 2,
        sourceMarker: { d: ER_MANY, fill: 'none', stroke: accent, 'stroke-width': 2, 'stroke-dasharray': 'none' },
        targetMarker: { d: ER_ONE, fill: 'none', stroke: accent, 'stroke-width': 2, 'stroke-dasharray': 'none' },
      } },
    });
  });

  return {
    diagram: {
      version: 1, appVersion, title: spec.title || 'Imported Data Model',
      diagramType: 'datamodel', graph: { cells },
    },
    stats: {
      objects: objects.length,
      fields: objects.reduce((n, o) => n + (o.fields || []).length, 0),
      links: (spec.relationships || []).length - warnings.length,
      zones: (spec.zones || []).length,
      warnings,
    },
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath) die('usage: node scripts/objects-to-diagramforce.mjs <selection.json> [out.json]');
  let spec;
  try { spec = JSON.parse(readFileSync(inPath, 'utf8')); }
  catch (e) { die(`Could not read ${inPath}: ${e.message}`); }
  const { diagram, stats } = buildDiagram(spec);
  const json = JSON.stringify(diagram, null, 2);
  if (outPath) writeFileSync(outPath, json); else console.log(json);
  console.error(`✓ ${diagram.title}
  objects ${stats.objects} · fields ${stats.fields} · relationships ${stats.links} · zones ${stats.zones}${
    stats.warnings.length ? `\n  warnings:\n${stats.warnings.map((w) => `    - ${w}`).join('\n')}` : ''}`);
}

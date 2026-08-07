#!/usr/bin/env node
// org-to-selection.mjs — turn raw org metadata into a DRAFT selection for objects-to-diagramforce.mjs.
//
//   node scripts/org-to-selection.mjs fields.csv --title "Sales Core" > selection.json
//   node scripts/org-to-selection.mjs dmos.json  --only ssot__Individual__dlm,ssot__ContactPointEmail__dlm
//
// This closes the CLI loop. You query the org, this drafts the selection, you PRUNE it, then
// objects-to-diagramforce.mjs draws it. The pruning step is yours on purpose - see below.
//
// ── Where the input comes from ──────────────────────────────────────────────────────────────────────────────
//   core sObjects (CSV):
//     sf data query -o <org> -t -r csv -q "SELECT EntityDefinitionId, QualifiedApiName, Label, DataType, \
//        ReferenceTo, RelationshipName, IsNillable FROM FieldDefinition \
//        WHERE EntityDefinition.QualifiedApiName IN ('Account','Contact')" > fields.csv
//   Data Cloud DMOs (JSON):
//     sf api request rest "/services/data/v67.0/ssot/data-model-objects?limit=200" -o <org> > dmos.json
//     (paginate - the default page is 50, and `nextPageUrl` tells you there is more)
//
// Format is auto-detected: a CSV with a `QualifiedApiName` column is FieldDefinition; JSON containing
// `dataModelObject` is Data Cloud.
//
//   OWD / sharing model (JSON), one query for every object:
//     sf data query -o <org> -t --json -q "SELECT QualifiedApiName, InternalSharingModel, \
//        ExternalSharingModel FROM EntityDefinition WHERE QualifiedApiName IN ('Account','Contact')" > owd.json
//   record counts (JSON), one REST call for every object:
//     sf api request rest "/services/data/v67.0/limits/recordCount?sObjects=Account,Contact" -o <org> > vol.json
//
// Pass either or both with `--owd owd.json` / `--volume vol.json`; objects-to-diagramforce.mjs turns them into
// badges on the cards.
//
// ── What it infers, and what it deliberately does not ───────────────────────────────────────────────────────
// INFERS (all mechanical, all things you should not hand-type):
//   · `keyType` - a field literally named `Id` is the pk; a Lookup/Master-Detail with a resolvable target is an
//     fk. NB `Id` reports its DataType as `Lookup()` with EMPTY parens, so the name is the reliable signal and
//     the type is not.
//   · `relationships` - from `ReferenceTo`, which arrives as a JSON STRING (`{"referenceTo":["Account"]}`), and
//     ONLY when the target object is also in the selection. A link to an object that is not on the canvas would
//     render as a dangling stub, so those are dropped and counted.
//   · a per-object `headerColor`, so the cards are not all one blue.
//
// PASSES THROUGH (facts the org states, which nothing can derive from field metadata - see `--owd` / `--volume`
// below): `sharing` (the org-wide default) and `records` (the row count). Merged by object name, never guessed.
//
// DOES NOT infer: WHICH objects and WHICH fields belong in the diagram. That is judgement, and it is the whole
// reason this is a draft rather than an import. 4 core objects came back as 612 fields in the org this was
// built against; the hand-built MCN Consent Data Model uses 3-14 fields per object. `--keys-only` gets you most
// of the way (keys + required), but read the result before drawing it.
import { readFileSync } from 'node:fs';
import { DF_ACCENT_CYCLE } from './diagram-palette.js';

const die = (m) => { console.error(m); process.exit(1); };

/** Minimal RFC4180-ish CSV reader - the Salesforce CLI quotes any field containing a comma or a quote, and
 *  `ReferenceTo` always does, so a naive split on ',' corrupts every row that has a relationship. */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.length && r.some(Boolean))
    .map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

// One accent per object, cycled by index. IMPORTED, not restated: this script is CLI-only Node ESM, so it has
// none of the `?v=` cache-key rewriting that forces the app-side converters to restate their literals.
// The previous eight were chosen for variety alone and five of them failed the both-themes contrast rule -
// #321D71 at 1.28:1 on the dark canvas being the one the owner caught in a screenshot. It matters twice over,
// because objects-to-diagramforce.mjs paints each RELATIONSHIP in its child card's headerColor: an unreadable
// header is an unreadable connector, and a connector is 2px of it.
const PALETTE = DF_ACCENT_CYCLE.slice(0, 8);

// ── Annotations: what the org SAYS about an object, as opposed to what it can be derived to be ──────────────
// Both readers below take the RAW org response, unedited. That is the point: the moment an agent has to reshape
// a payload by hand it can quietly get a value wrong, and neither of these is checkable from the diagram. They
// are also strictly separate flags because they are strictly separate calls - one SOQL over EntityDefinition
// for the sharing models, one REST call for the counts - and an author often wants only one of them.
//
// Provenance keys (`__source`, `__note`) are skipped rather than rejected, so a saved payload can carry a note
// about when and from which org it was pulled. Nothing else is invented: an object with no entry gets no badge
// and is NAMED on stderr, because "the OWD query missed this object" and "this object has no OWD" look identical
// on the canvas otherwise.

/**
 * `--owd <file>` -> Map<objectNameLower, { internal, external }>.
 *
 * Accepts the raw `sf data query --json` envelope, a bare `{ records: [...] }`, or a plain
 * `{ "Account": { "internal": "ReadWrite", "external": "Read" } }` map - the last being the same shape the
 * merged selection carries, so a hand-written annotation file and a hand-written selection read alike.
 */
export function parseSharingModels(raw) {
  const out = new Map();
  const add = (name, internal, external) => {
    if (!name || !internal) return;
    out.set(String(name).toLowerCase(),
      { internal: String(internal), ...(external ? { external: String(external) } : {}) });
  };
  const rows = raw?.result?.records || raw?.records || (Array.isArray(raw) ? raw : null);
  if (rows) {
    for (const r of rows) add(r.QualifiedApiName || r.name, r.InternalSharingModel, r.ExternalSharingModel);
    return out;
  }
  for (const [name, v] of Object.entries(raw || {})) {
    if (name.startsWith('__')) continue;
    if (typeof v === 'string') add(name, v);
    else add(name, v?.internal ?? v?.InternalSharingModel, v?.external ?? v?.ExternalSharingModel);
  }
  return out;
}

/**
 * `--volume <file>` -> Map<objectNameLower, recordCount>.
 *
 * The documented source is `/limits/recordCount?sObjects=A,B,C`, which returns every object in ONE call -
 * versus one `SELECT COUNT()` per object. They do not measure quite the same thing: recordCount reads the org's
 * storage stats and counts every row, `SELECT COUNT()` respects sharing and any filter you write, so on `User`
 * they differ by the inactive and integration users (185 vs 113 in the org this was built against). A plain
 * `{ "Account": 92 }` map is therefore accepted too - that is the escape hatch for an author who wants the
 * queried number rather than the stored one.
 */
export function parseRecordCounts(raw) {
  const out = new Map();
  const add = (name, n) => {
    const v = Number(n);
    if (name && Number.isFinite(v)) out.set(String(name).toLowerCase(), v);
  };
  if (Array.isArray(raw?.sObjects)) { for (const s of raw.sObjects) add(s.name, s.count); return out; }
  for (const [name, v] of Object.entries(raw || {})) {
    if (name.startsWith('__')) continue;
    add(name, v && typeof v === 'object' ? (v.records ?? v.count) : v);
  }
  return out;
}

/** `{"referenceTo":["Account"]}` -> 'Account'. Tolerates the null form and any non-JSON surprise. */
function refTarget(raw) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    const list = Array.isArray(v) ? v : v?.referenceTo;
    return Array.isArray(list) && list.length ? list[0] : null;
  } catch { return null; }
}

/** FieldDefinition rows -> objects. */
function fromFieldDefinition(rows) {
  const byObj = new Map();
  for (const r of rows) {
    const obj = r.EntityDefinitionId || r.EntityDefinition || r.SobjectType;
    const api = r.QualifiedApiName;
    if (!obj || !api) continue;
    if (!byObj.has(obj)) byObj.set(obj, []);
    const dt = r.DataType || '';
    const target = refTarget(r.ReferenceTo);
    // `Id` reports DataType `Lookup()` - empty parens - so the NAME is what identifies a primary key here.
    const keyType = api === 'Id' ? 'pk' : (target && /^(Lookup|Master-Detail)/i.test(dt) ? 'fk' : null);
    byObj.get(obj).push({
      label: r.Label || api, apiName: api, type: api === 'Id' ? 'ID' : dt, keyType,
      ...(String(r.IsNillable).toLowerCase() === 'false' ? { required: true } : {}),
      ...(target ? { _refTo: target } : {}),
    });
  }
  return [...byObj].map(([name, fields]) => ({ name, label: name, fields }));
}

/** Data Cloud `/ssot/data-model-objects` -> objects. */
function fromDataCloud(json) {
  return (json.dataModelObject || []).map((o) => ({
    name: o.name, label: o.label || o.name,
    // PROFILE / ENGAGEMENT / OTHER is the DMO's own category and is exactly the datamodel card's vocabulary.
    category: o.category && o.category !== 'UNASSIGNED'
      ? o.category[0] + o.category.slice(1).toLowerCase() : undefined,
    fields: (o.fields || []).map((f) => ({
      label: f.label || f.name, apiName: f.name, type: f.type,
      // A DMO has no ReferenceTo; `ssot__Id__c` is the key and `...Id__c` names a foreign key by convention.
      keyType: /(^|_)Id__c$/i.test(f.name) && /^ssot__Id__c$/i.test(f.name) ? 'pk'
        : /Id__c$/i.test(f.name) ? 'fk' : null,
    })),
  }));
}

export function buildSelection(input, opts = {}) {
  let objects = typeof input === 'string'
    ? fromFieldDefinition(parseCsv(input))
    : fromDataCloud(input);

  if (opts.only?.length) {
    const want = new Set(opts.only.map((s) => s.toLowerCase()));
    objects = objects.filter((o) => want.has(o.name.toLowerCase()));
  }
  if (!objects.length) die('No objects matched. Check --only against the names in the input.');

  const inSel = new Set(objects.map((o) => o.name.toLowerCase()));
  const relationships = [];
  let droppedRels = 0;
  for (const o of objects) {
    for (const f of o.fields) {
      if (!f._refTo) continue;
      // Only draw a relationship whose TARGET is on the canvas. Anything else is a dangling stub.
      if (inSel.has(String(f._refTo).toLowerCase())) {
        relationships.push({ from: `${o.name}.${f.apiName}`, to: `${f._refTo}.Id` });
      } else droppedRels++;
    }
  }

  // WHICH plain fields survive was arbitrary - source order, which for FieldDefinition means the system audit
  // columns come first. A four-object Sales Core draft led every card with `Deleted (IsDeleted)` and
  // `Compare Name (CompareName)`, which is not what anyone opens a data model to learn.
  //
  // Ranking by "required" then fixed that badly in a different way: on a STANDARD object nearly every system
  // boolean is non-nillable, so `required` promoted them wholesale. Measured on Account/Case/Contact/Opportunity
  // at 25 fields, the non-key rows after `Name` were MayEdit, IsLocked, IsExcludedFromRealign, IsActive,
  // IsPartner, IsCustomerPortal... - reported as "really, really random in terms of usefulness, with Checkboxes
  // taking most of the fields".
  //
  // So the top of the plain band is now a CURATED list per standard object: the fields on its standard page
  // layout, the ones an architect opens a data model expecting to see. Below that, ordering is ALPHABETICAL
  // rather than source order - source order for FieldDefinition is effectively arbitrary, and "bad but
  // predictable" beats "random".
  const SYSTEM_FIELD = /^(IsDeleted|SystemModstamp|LastModifiedDate|LastModifiedById|CreatedDate|CreatedById|LastViewedDate|LastReferencedDate|LastActivityDate|MasterRecordId|OwnerId|CleanStatus|JigsawCompanyId|Jigsaw|PhotoUrl|ConnectionReceivedId|ConnectionSentId|CompareName|IsPersonAccount|RecordTypeId)$/i;
  // Access/derived flags every standard object carries. They are non-nillable, so without this they outrank real
  // business fields; and none of them is a fact about the DATA MODEL - they are per-user, per-request state.
  const SYSTEM_FLAG = /^(MayEdit|IsLocked|UserRecordAccessId|IsExcludedFromRealign|IsExcludedFromTerritory2Filter|LastCURequestDate|LastCUUpdateDate|IsPriorityRecord|HasPrivacyHold|IsEmailBounced|IsSelfServiceClosed|IsClosedOnCreate|HasCommentsUnreadByOwner|HasSelfServiceComments|IsVisibleInSelfService)$/i;

  // The standard page layout, roughly, for the objects a Salesforce data model is usually ABOUT. Order inside
  // each list is the priority order. Not exhaustive on purpose - it only has to beat "alphabetical" for the
  // objects people actually draw, and anything unlisted simply falls through to the bands below.
  const KEY_FIELDS = {
    account: ['Name', 'Type', 'Industry', 'AnnualRevenue', 'NumberOfEmployees', 'Rating', 'Phone', 'Website',
      'BillingCity', 'BillingCountry', 'ShippingCity', 'AccountSource', 'Description', 'ParentId', 'OwnerId'],
    contact: ['Name', 'FirstName', 'LastName', 'Email', 'Phone', 'MobilePhone', 'Title', 'Department',
      'AccountId', 'MailingCity', 'MailingCountry', 'LeadSource', 'Birthdate', 'Description', 'OwnerId'],
    opportunity: ['Name', 'AccountId', 'StageName', 'Amount', 'CloseDate', 'Probability', 'Type', 'LeadSource',
      'ForecastCategoryName', 'NextStep', 'CampaignId', 'Description', 'OwnerId'],
    case: ['CaseNumber', 'Subject', 'Status', 'Priority', 'Origin', 'Type', 'Reason', 'AccountId', 'ContactId',
      'Description', 'ClosedDate', 'IsEscalated', 'SuppliedEmail', 'OwnerId'],
    lead: ['Name', 'FirstName', 'LastName', 'Company', 'Title', 'Email', 'Phone', 'Status', 'LeadSource',
      'Industry', 'Rating', 'AnnualRevenue', 'NumberOfEmployees', 'IsConverted', 'OwnerId'],
    user: ['Name', 'Username', 'Email', 'Alias', 'IsActive', 'ProfileId', 'UserRoleId', 'Department', 'Title',
      'ManagerId'],
    campaign: ['Name', 'Type', 'Status', 'StartDate', 'EndDate', 'BudgetedCost', 'ActualCost', 'ExpectedRevenue',
      'NumberOfLeads', 'IsActive', 'OwnerId'],
    task: ['Subject', 'Status', 'Priority', 'ActivityDate', 'WhoId', 'WhatId', 'Description', 'OwnerId'],
    event: ['Subject', 'StartDateTime', 'EndDateTime', 'Location', 'WhoId', 'WhatId', 'Description', 'OwnerId'],
    product2: ['Name', 'ProductCode', 'Family', 'Description', 'IsActive'],
    asset: ['Name', 'AccountId', 'ContactId', 'Product2Id', 'SerialNumber', 'Status', 'InstallDate',
      'UsageEndDate'],
    order: ['OrderNumber', 'AccountId', 'Status', 'Type', 'EffectiveDate', 'EndDate', 'TotalAmount', 'OwnerId'],
    contract: ['ContractNumber', 'AccountId', 'Status', 'StartDate', 'ContractTerm', 'EndDate', 'OwnerId'],
    quote: ['Name', 'OpportunityId', 'Status', 'ExpirationDate', 'TotalPrice', 'GrandTotal'],
  };

  const rankFor = (objectName) => {
    const curated = KEY_FIELDS[String(objectName || '').toLowerCase()] || [];
    const priority = new Map(curated.map((n, i) => [n.toLowerCase(), i]));
    return (f) => {
      if (f.keyType === 'pk') return [0, 0];
      if (/^Name$/i.test(f.apiName)) return [1, 0];
      // A foreign key that points at an object ON THE CANVAS draws a relationship. One that points outside the
      // selection draws NOTHING - it is a field named `WhoId` with no arrow - yet it competes for the same
      // one-third fk budget. Measured on a 4-object Sales+Service selection: 84 lookups, of which only 19 point
      // into the selection. Ranking them together let the 65 useless ones crowd out the 19 that are the entire
      // point of an ERD, and the 25-field cap cost 10 of the 20 relationships. Splitting the rank keeps them.
      if (f.keyType === 'fk' && f._refTo && inSel.has(String(f._refTo).toLowerCase())) return [2, 0];
      if (f.keyType) return [3, 0];                          // a key, but one that draws no line here
      if (SYSTEM_FIELD.test(f.apiName) || SYSTEM_FLAG.test(f.apiName)) return [8, 0];   // plumbing, last
      const p = priority.get(String(f.apiName).toLowerCase());
      if (p !== undefined) return [4, p];                    // on this object's standard layout, in ITS order
      if (/__c$/i.test(f.apiName)) return [5, 0];            // this org's own additions
      if (f.required) return [6, 0];
      return [7, 0];
    };
  };
  for (const o of objects) {
    // Per-object, because the curated priority list is per-object. Ties break ALPHABETICALLY rather than by
    // source order: FieldDefinition's order is effectively arbitrary, so source order made two runs of the same
    // selection disagree about which fields survived a cap. Bad but predictable beats random.
    const rank = rankFor(o.name);
    o.fields = o.fields
      .map((f) => ({ f, r: rank(f) }))
      .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1]
        || String(a.f.apiName).localeCompare(String(b.f.apiName), 'en', { numeric: true }))
      .map((x) => x.f);
  }

  // Pruning. Keys + required is the useful default shape for an ERD: it is what a relationship diagram is ABOUT,
  // and it turns a 150-field object into something a reader can take in.
  let prunedFields = 0;
  const missingFields = [];
  if (opts.keysOnly) {
    for (const o of objects) {
      const keep = o.fields.filter((f) => f.keyType || f.required);
      prunedFields += o.fields.length - keep.length;
      o.fields = keep;
    }
  }
  // An EXPLICIT field list wins over the cap, for the objects it names. This is the "I know which fields I care
  // about" case - a mapping discussion, a specific integration contract - where any automatic ranking is a
  // guess at something the reader has already decided. The pk is kept regardless: relationships point AT it, so
  // dropping it would silently delete the arrows into that object.
  // Objects the list does not mention are untouched, and still take the cap.
  let pinnedFields = 0;
  if (opts.fields?.size) {
    for (const o of objects) {
      const want = opts.fields.get(o.name.toLowerCase());
      if (!want) continue;
      const keep = o.fields.filter((f) => f.keyType === 'pk' || want.has(String(f.apiName).toLowerCase()));
      // Name what was ASKED FOR and does not exist, rather than quietly drawing a smaller card: a typo in a
      // field name is otherwise indistinguishable from the field having been removed from the org.
      const got = new Set(keep.map((f) => String(f.apiName).toLowerCase()));
      for (const w of want) if (!got.has(w)) missingFields.push(`${o.name}.${w}`);
      pinnedFields += o.fields.length - keep.length;
      o.fields = keep;
      o._pinned = true;
    }
  }
  if (opts.maxFields) {
    for (const o of objects) {
      if (o._pinned) continue;   // an explicit list is not a suggestion
      if (o.fields.length <= opts.maxFields) continue;
      // KEYS FIRST STARVES THE CARD. The obvious ordering - every key, then whatever fits - produces a card
      // that is nothing but Lookups, because a standard Salesforce object has dozens of them (Account carries
      // ~15) and they consume the whole budget before a single business field is reached. Measured against
      // the official MCN Consent Data Model, that is backwards: 105 of its 169 fields carry NO key at all,
      // 43 are fk and 21 are pk. A reader identifies a record by its NAME, not by its MasterRecordId.
      //
      // So: the pk always survives (it is what relationships point at), foreign keys take at most a THIRD of
      // what is left, and plain fields fill the rest. Either side backfills when the other runs short, so a
      // pure-lookup junction object still fills its card.
      const pk = o.fields.filter((f) => f.keyType === 'pk');
      const fk = o.fields.filter((f) => f.keyType && f.keyType !== 'pk');
      const plain = o.fields.filter((f) => !f.keyType);
      const budget = Math.max(0, opts.maxFields - pk.length);
      const fkTake = Math.min(fk.length, Math.max(1, Math.floor(budget / 3)));
      const plainTake = Math.min(plain.length, budget - fkTake);
      // Backfill: whichever side had less than its share hands the slack to the other.
      const slack = budget - fkTake - plainTake;
      const keep = [...pk, ...fk.slice(0, fkTake + Math.min(slack, fk.length - fkTake)),
        ...plain.slice(0, plainTake)];
      prunedFields += o.fields.length - keep.length;
      // Re-order to the source order so the card does not read as three shuffled blocks.
      const kept = new Set(keep);
      o.fields = o.fields.filter((f) => kept.has(f));
    }
  }

  // Merge the annotations onto the objects that SURVIVED pruning, so the counts on stderr describe the diagram
  // that will actually be drawn rather than the draft before `--only`.
  const unmatched = [];
  let annotatedSharing = 0, annotatedRecords = 0;
  for (const o of objects) {
    const key = String(o.name).toLowerCase();
    const sharing = opts.sharing?.get(key);
    const records = opts.records?.get(key);
    if (sharing) { o.sharing = sharing; annotatedSharing++; }
    else if (opts.sharing?.size) unmatched.push(`${o.name} (no sharing model)`);
    if (records !== undefined) { o.records = records; annotatedRecords++; }
    else if (opts.records?.size) unmatched.push(`${o.name} (no record count)`);
  }

  objects.forEach((o, i) => {
    o.headerColor = o.headerColor || PALETTE[i % PALETTE.length];
    o.fields.forEach((f) => delete f._refTo);
    delete o._pinned;   // internal marker - never reaches the emitted selection
  });

  // A relationship whose field got pruned would be skipped by the drawer with a warning; drop it here instead
  // so the draft is internally consistent.
  const has = (ref) => {
    const i = ref.lastIndexOf('.');
    const o = objects.find((x) => x.name.toLowerCase() === ref.slice(0, i).toLowerCase());
    return !!o && o.fields.some((f) => f.apiName === ref.slice(i + 1));
  };
  const kept = relationships.filter((r) => has(r.from) && has(r.to));
  const lostToPruning = relationships.length - kept.length;

  return {
    selection: { title: opts.title || 'Imported Data Model', objects, relationships: kept },
    stats: {
      objects: objects.length,
      fields: objects.reduce((n, o) => n + o.fields.length, 0),
      relationships: kept.length,
      droppedRels, prunedFields, lostToPruning, pinnedFields, missingFields,
      annotatedSharing, annotatedRecords, unmatched,
    },
  };
}

/**
 * The RECOMMENDED cap - a number for SKILL.md to quote, not a default this script applies.
 *
 * The script stays uncapped when nobody says otherwise, because it does not know what the diagram is for and a
 * silent cap would delete fields the reader never heard about. The soft default lives one layer up, in the
 * skill instructions, where the reader's own words are available to override it.
 *
 * 25 is a working compromise, not a discovered constant. The org this was built against returns 612 fields for
 * 4 core objects (Account alone has ~120 with ~27 lookups), and the hand-built MCN Consent Data Model - the
 * reference for what a good ERD looks like here - uses 3-14 fields per object. So the honest range is "a couple
 * of dozen": low enough that a card is readable at fit-to-screen, high enough that the pk, the Name, the
 * on-canvas lookups and a useful slice of business fields all survive the ranking. Below ~15 the lookups start
 * starving out the business fields; above ~40 the cards stop being scannable.
 */
export const RECOMMENDED_MAX_FIELDS = 25;

/** `--max-fields` -> a cap. Absent (or `all`/`0`) = no cap: this script does not impose one, so a diagram is
 *  never quietly smaller than the org. `--fields` beats any cap for the objects it names. */
export function parseMaxFields(raw) {
  if (raw == null) return 0;
  if (/^(all|none|unlimited)$/i.test(String(raw).trim())) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** `--fields Account.Name,Account.Industry,Contact.Email` -> Map<objectLower, Set<fieldLower>>.
 *  Unqualified entries are rejected loudly rather than guessed at: `Name` exists on most objects, so applying
 *  it to all of them would silently reshape cards the reader never mentioned. */
export function parseFieldList(raw) {
  if (!raw) return null;
  const map = new Map();
  const bad = [];
  for (const entry of String(raw).split(',').map((s) => s.trim()).filter(Boolean)) {
    const dot = entry.lastIndexOf('.');
    if (dot < 1 || dot === entry.length - 1) { bad.push(entry); continue; }
    const obj = entry.slice(0, dot).toLowerCase(), field = entry.slice(dot + 1).toLowerCase();
    if (!map.has(obj)) map.set(obj, new Set());
    map.get(obj).add(field);
  }
  // THROWS rather than exiting. `die` calls process.exit, which is right for a CLI and wrong for a function the
  // app and the tests import - it takes the whole process down with no stack and no way to assert on it. The CLI
  // catches this below and dies there, where exiting is the correct behaviour.
  if (bad.length) throw new Error(`--fields needs Object.Field, got: ${bad.join(', ')}`);
  return map;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const val = (flag) => { const i = args.indexOf(flag); return i > -1 ? args[i + 1] : null; };
  if (!file) die('usage: node scripts/org-to-selection.mjs <fields.csv|dmos.json> [--only A,B] [--keys-only]'
    + ' [--max-fields N|all] [--fields Obj.Field,Obj.Other] [--owd owd.json] [--volume counts.json] [--title T]');
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch (e) { die(`Could not read ${file}: ${e.message}`); }
  // The Salesforce CLI prints warnings before JSON, so find the payload rather than trusting position.
  const i = raw.indexOf('{');
  const input = (i > -1 && /"dataModelObject"/.test(raw)) ? JSON.parse(raw.slice(i)) : raw;

  /** Read an annotation payload straight from the CLI. Sliced from the first `{` or `[` for the same reason the
   *  DMO catalogue is: `sf` prints its update banner before the JSON on some versions. */
  const annotation = (flag, parse) => {
    const path = val(flag);
    if (!path) return null;
    let text;
    try { text = readFileSync(path, 'utf8'); } catch (e) { return die(`Could not read ${path}: ${e.message}`); }
    const start = text.search(/[[{]/);
    if (start < 0) return die(`${path} contains no JSON - ${flag} takes the raw org response.`);
    try { return parse(JSON.parse(text.slice(start))); } catch (e) { return die(`Could not parse ${path}: ${e.message}`); }
  };

  const { selection, stats } = buildSelection(input, {
    only: (val('--only') || '').split(',').map((s) => s.trim()).filter(Boolean),
    keysOnly: args.includes('--keys-only'),
    maxFields: parseMaxFields(val('--max-fields')),
    fields: (() => { try { return parseFieldList(val('--fields')); } catch (e) { die(e.message); } })(),
    sharing: annotation('--owd', parseSharingModels),
    records: annotation('--volume', parseRecordCounts),
    title: val('--title'),
  });
  console.log(JSON.stringify(selection, null, 2));
  console.error(`✓ draft selection: ${stats.objects} objects · ${stats.fields} fields · ${stats.relationships} relationships`
    + `${stats.pinnedFields ? `\n  kept only the ${stats.pinnedFields === 1 ? 'field' : 'fields'} named in --fields`
      + ` (dropped ${stats.pinnedFields} other(s) on those objects)` : ''}`
    + `${stats.missingFields?.length ? `\n  NOT FOUND in the org: ${stats.missingFields.join(', ')}`
      + ' - check the spelling, or the field has been removed' : ''}`
    + `${stats.prunedFields ? `\n  pruned ${stats.prunedFields} field(s)` : ''}`
    + `${stats.lostToPruning ? ` — which cost ${stats.lostToPruning} relationship(s); re-run with a larger --max-fields to keep them` : ''}`
    + `${stats.droppedRels ? `\n  ${stats.droppedRels} relationship(s) point outside the selection and were dropped (add those objects with --only to keep them)` : ''}`
    + `${stats.annotatedSharing ? `\n  sharing model on ${stats.annotatedSharing} object(s)` : ''}`
    + `${stats.annotatedRecords ? `\n  record count on ${stats.annotatedRecords} object(s)` : ''}`
    + `${stats.unmatched?.length ? `\n  NOT ANNOTATED: ${stats.unmatched.join(', ')}`
      + ' - the object is missing from the --owd / --volume payload, so it gets no badge' : ''}`
    + `\n  REVIEW BEFORE DRAWING - which objects and fields belong is a judgement this cannot make.`);
}

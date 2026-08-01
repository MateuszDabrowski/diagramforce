---
name: diagramforce
description: >-
  Author an importable Diagramforce diagram - from a description, from an existing diagram (a
  screenshot, draw.io, or Mermaid), or from real Salesforce metadata (Flows, objects, Data Cloud
  mappings, data graphs) - then hand the user a file to open in Diagramforce. Diagramforce is a
  no-backend browser editor for Salesforce/CRM architecture, data models (ERD), Data Cloud field
  mappings, process flows, Salesforce Flows, org charts, Gantt timelines, and UML sequence diagrams.
  Use it whenever the user wants to visualize, diagram, map, model, draw, or recreate any of those as
  an editable diagram - especially in a Salesforce, Marketing Cloud, or Data Cloud context, even when
  they don't name Diagramforce (e.g. 'turn this into an ERD', 'map these fields into the Individual
  DMO', 'diagram this Flow from my org'). It outputs diagram JSON validated to import intact - no
  account, no backend. Do NOT use it for data charts or dashboards, for writing code, or for reviewing
  a design without drawing it.
---

# Diagramforce diagram authoring

Produce a **validated Diagramforce diagram JSON file** and hand it to the user to open in the app.
You do not need the app or any network access to build the diagram - you author JSON to a published
spec, check it with a bundled validator, then give the user the file plus the one-time paste steps.

Diagramforce renders the JSON; your job is to get the JSON **right** so nothing silently drops on
import. Work the loop below in order - skipping the spec-read or the validator is the usual cause of
a diagram that opens with missing shapes or links.

**Starting from an existing diagram?** If the user hands you a screenshot, whiteboard photo, draw.io,
or another diagram to recreate, that is a prime use of this skill: read the source, understand its
elements and connections, and author the equivalent Diagramforce JSON with the same workflow below
(the source just seeds step 1's type choice and step 3's content). One shortcut worth offering: if the
source is **Mermaid**, Diagramforce imports it natively - the user can paste the Mermaid straight into
**Load & Import -> Paste** and the app auto-detects and converts it (`graph`/`flowchart` -> Process,
Architecture or Org Chart - the pane offers the choice; `stateDiagram` -> Process, `erDiagram` -> Data Model,
`sequenceDiagram` -> Sequence, `gantt` -> Gantt, with sections becoming phases and `after` becoming real
dependencies). `subgraph` groups import as labelled zones. So you may not need to author
JSON at all. Author JSON yourself when they want a type Mermaid can't express, or edits beyond a
straight conversion.

**Starting from a real Salesforce Flow? Convert it - do not redraw it.** If the flow exists in an org,
its metadata already holds every element, connector, decision outcome and fault path, so hand-authoring
it would be slower AND less accurate. If they have the SFDX source (`force-app/main/default/flows/*.flow-meta.xml`,
or one `sf project retrieve` away), use that directly. Otherwise ask for the Tooling API response:

1. In **Setup -> Flows**, open the flow; the URL carries `flowId=301...`. (This works for flows the org
   authored. A packaged flow shows a namespaced name like `ns__Flow_Name-1` instead, and its metadata is
   usually withheld from subscribers - say so rather than guessing at it.)
2. They fetch `GET /services/data/vXX.0/tooling/sobjects/Flow/301...` and paste the response. Use the
   org's **latest** API version, not a fixed one - the Tooling API shapes its response to the version you
   ask for, so an older `vXX.0` silently omits any element type or field added since. An unauthenticated
   `GET /services/data/` on the instance URL lists the versions; take the highest.

   Any route that returns that JSON works - pick whichever the user already has:
   [Workbench](https://workbench.developerforce.com) -> **utilities -> REST Explorer** (no install, but
   third-party and blocked by some org policies), `sf api request rest` from the Salesforce CLI, or the
   Developer Console's **Query Editor**. The whole response or just its `Metadata` object both work.

Then run the bundled converter and validate as usual. It takes **either** source format and detects which
from the content:

```bash
# the SFDX source file, straight from `sf project retrieve start -m "Flow:*"`
node scripts/flow-to-diagramforce.mjs force-app/main/default/flows/My_Flow.flow-meta.xml diagram.json

# ...or a Tooling API response
node scripts/flow-to-diagramforce.mjs flow-response.json diagram.json

node scripts/validate-diagram.mjs diagram.json
```

**`--org <alias>` adds an "Open in Flow Builder" card** so the diagram is one click from the real flow. It is
the only flag you need - it resolves both the org's instance URL and, for a `.flow-meta.xml`, the flow's version
id:

```bash
node scripts/flow-to-diagramforce.mjs My_Flow.flow-meta.xml diagram.json --org <alias>
```

Requires an authenticated Salesforce CLI on the machine running the script. If there is none - or you know the
host but are not authenticated to it - pass the instance URL directly instead, and the card still links to the
Flows list in Setup:

```bash
node scripts/flow-to-diagramforce.mjs flow-response.json diagram.json --org-url https://acme.my.salesforce.com
```

Given explicitly, `--org-url` wins over whatever the alias resolves to. With neither flag no card is emitted, on
purpose: a guessed host is worse than none.

A **Tooling response** carries the `301...` id, so it deep-links with `--org-url` alone. A **`.flow-meta.xml`**
has no id: with `--org` it is looked up (the LATEST version, which is what `sf project retrieve` gave you), and
without it the card falls back to the Flows list. The script prints which you got - relay that, and relay the
note if the org is running a DIFFERENT version as Active than the file you converted.

**`--org` also names the references the metadata carries only as ids.** A marketing flow's cards would
otherwise read as bare identifiers: CMS content keys on Send Email / SMS / WhatsApp / Push / In-App actions,
Communication Subscriptions (`0Xl...`), their Channel Types (`0eB...`), and the segment a segment-triggered
flow starts from (`1sg...`, MarketSegment). The id is always KEPT and the name APPENDED - `0XlHn... (Marketing)`
- because the id is what a user pastes into a URL or hands to support. The segment is named on BOTH of its
surfaces, the Start card's details row and its configuration line. `start.dataGraph` is already a developer
name, so it is never looked up. The script prints how many references it resolved - relay that line with the
warnings.

The `.flow-meta.xml` path means a flow comes from the same `sf project retrieve` the object and mapping
importers use, so one org pull can feed all three. (Before 1.22.0 this script took JSON only and died on an
XML file with a raw parse error.)

It maps each metadata collection to its `df.Flow*` class, carries decision outcomes / fault paths (red)
/ Go To jumps (blue) with their branch labels, synthesises the End cards the metadata has no element
for, fills each card's **`details`** rows with the documentation detail that will not fit on a card (the
fields a Create/Update writes, what a Get reads out and into which variables, a screen's components with
their types, each outcome's condition, an action's parameters), emits a **`df.Table` above Start** holding
the flow-level facts (status, API version, run mode, description, resource counts) plus a **Resources sidebar**
to the right listing what each formula computes, what each text template sends and pulls, what fills each
choice set, and the description of every variable that carries one, and either honours the flow's own `locationX/Y` or - when the builder stored none (as Marketing
Cloud Next journeys do) or stored only some - computes the same tidy tree the app's Auto Layout uses.
Two conventions on those tables to keep when you author a flow by hand: the facts table lists the flow's
**Inputs / Outputs signature in full** up to 12 items each, then `+N more` - it is the flow's contract, not a
detail to sample. The Resources card CURATES (variables that carry a description, choices with human names)
and closes with a **Not listed** accounting row, so its rows plus that row reconcile with the facts table's
resource counts.

**Read its warnings out to the user - always.** They are the part a clean validator cannot tell you:
the validator proves the diagram LOADS, while the warnings are where the converter says what it could
not represent faithfully. An element type it has no dedicated shape for still gets drawn (as a generic
Action card, so the graph stays connected and nothing pointing at it breaks) and named in a warning -
**Custom Error** is the one you will meet most. (Orchestrator/approval **stages** used to warn here; they
have had a real `df.FlowStage` card since 1.21.2, with each step's kind and assignee in its details.) Other warnings
flag a flow with no entry point, connectors pointing at deleted elements, and metadata whose canvas
coordinates were missing or incomplete.

**If the converter ERRORS saying the metadata is not readable, that is the answer, not a failure.** A
managed-package flow returns `Metadata: null` to a subscriber org - Salesforce withholds a packaged flow's
internals. Tell the user their org cannot read that flow's definition and suggest converting one their own
org authored, rather than retrying or hand-drawing an approximation from the element names.

## Workflow

### 1. Pick the diagram type - it decides everything downstream

Choose by the **question the diagram answers**, not by the first shapes that come to mind. The
`diagramType` you pick must match the shapes you use; a wrong type opens the diagram as a plain
architecture tab with the type-specific tools gated off.

| Type | Answers | Typical use |
|------|---------|-------------|
| `architecture` | "How do these systems/components connect?" | Integrations, system landscapes |
| `datamodel` | "What objects/entities exist and how do they relate?" | Salesforce/SF Data ERDs |
| `datamapping` | "How does data flow from source to target, field by field?" | Data Cloud / Data 360 source -> DLO -> DMO mappings |
| `process` | "What are the steps/decisions in this business process?" | BPMN-style process flows |
| `flow` | "What does this Salesforce Flow do, element by element?" | Documenting an existing SF Flow |
| `org` | "Who reports to whom?" | Org / team charts |
| `gantt` | "What is the schedule / timeline?" | Project plans, roadmaps |
| `sequence` | "What messages pass between participants over time?" | UML sequence / API call flows |

For the genuinely tricky calls (e.g. process vs flow, datamodel vs datamapping), read the
**"Choosing the right diagram type"** section of the spec before committing.

### 2. Read the spec section for that type - do not guess shape names

The full contract is [`references/DIAGRAM_JSON_SPEC.md`](references/DIAGRAM_JSON_SPEC.md).
It is large, so read the **Top-Level Structure** plus the **specific type's shape reference** (each
shape lists its `type`, mandatory fields, port definitions, and link rules) rather than the whole
file. Shape `type` strings, field keys, and port ids are exact - the app silently drops a cell whose
`type` is not a real shape and a link pointing at a missing cell, so a guessed name vanishes on load.

### 3. Author the JSON

Envelope:

```json
{
  "version": 1,
  "appVersion": "1.21.0",
  "title": "Human-readable diagram name",
  "diagramType": "architecture",
  "graph": { "cells": [ /* elements first, then links */ ] }
}
```

- Set `appVersion` to the value in the spec's **"Spec snapshot: vX"** marker.
- **You place the nodes.** There is no server-side auto-layout - every element carries its own
  `position` (x/y). Lay the diagram out so it reads well: a clear direction (left-to-right or
  top-down), no overlapping shapes, and room for the connectors. A diagram that validates but is a
  tangle of overlaps is not done.
- Use only shapes that belong to the chosen `diagramType` (the validator flags a type-specific shape
  used in the wrong diagram).
- Give every cell a unique `id`; a link's `source`/`target` must reference ids that exist.

### 4. Validate - and fix until clean (this is not optional)

Save the JSON to a file and run the bundled validator (Node, zero dependencies):

```bash
node scripts/validate-diagram.mjs your-diagram.json
```

It exits non-zero if any **ERROR** was found. Run the loop: **fix every ERROR, re-run until the file
is clean, then review WARNINGS.** Why it matters:

- **ERRORS** mean cells or links will **silently vanish** on import (unknown shape `type`, a link to a
  missing cell, a duplicate id, a missing/wrong `diagramType`). "It parsed as JSON" is not enough.
- **WARNINGS** are quiet-degrade traps (a shape that loads but renders wrong - e.g. a name in the
  wrong field, a type-specific shape in the wrong diagram type).

The validator proves the diagram will **load intact**. It does **not** judge whether the layout
**reads well** - do a final visual pass in your head (spacing, overlaps, flow direction) before
handing it over.

### 5. Deliver (a one-click link when it fits, the file otherwise)

Save the final, validated JSON as a file (`.json`, or Diagramforce's own `.dgf` extension - the
content is identical). **Then try the link first:**

```bash
node scripts/make-share-url.mjs your-diagram.json
```

On success it prints a single `https://diagramforce.com/#diagram=...` URL. Give the user **that link**
and tell them to click it - the diagram opens directly, no import step. Also attach the file, so they
have something to keep.

The URL carries the whole diagram in its hash; nothing is uploaded and no account is involved.

**If it exits with code 2**, the diagram is past the ~8000-character ceiling that browsers and chat
clients start truncating at. Do NOT hand over a truncated link. Fall back to the file:

1. Open **https://diagramforce.com**
2. Click **Load & Import**, choose the **Paste** tab, paste the JSON, and click **Load**
   (or use the **File** tab to open the `.json` / `.dgf` you saved).
3. The diagram opens as a new tab. No sign-in; nothing leaves the browser.

Rough guide to what fits: a converted Salesforce Flow or a normal architecture diagram fits easily; a
large Data Cloud field-mapping diagram (hundreds of mapped fields) generally does not. Do not guess -
run the script and read the exit code.

If the user later wants it in Google Drive or shared, they can do that from inside the app - your job
ends at a clean, importable diagram.

## From a live Salesforce org (CLI)

When the user has the `sf` CLI authenticated, you can build a data model straight from their org. Two steps,
because the middle one is a judgement only you can make.

```bash
# 1. Pull the raw metadata (core objects; use --only later to narrow)
sf data query -o <org> -t -r csv -q "SELECT EntityDefinitionId, QualifiedApiName, Label, DataType, \
   ReferenceTo, RelationshipName, IsNillable FROM FieldDefinition \
   WHERE EntityDefinition.QualifiedApiName IN ('Account','Contact','Opportunity')" > fields.csv

# 2. Draft a selection - infers keys and relationships, prunes to something readable
node scripts/org-to-selection.mjs fields.csv --max-fields 25 --title "Sales Core" > selection.json

# 3. REVIEW selection.json, then draw it
node scripts/objects-to-diagramforce.mjs selection.json diagram.json
node scripts/validate-diagram.mjs diagram.json
```

**How many fields per card: pass `--max-fields 25` unless the user says otherwise.** The script itself imposes
NO cap - it does not know what the diagram is for, so it will not quietly shrink one. **You** apply the default,
which makes it soft: 25 is enough that the pk, the Name, the on-canvas lookups and a useful slice of business
fields all survive the ranking, and few enough that a card stays readable at fit-to-screen. Listen for what the
user actually wants and pass the matching flag rather than reaching for 25 by inertia:

| what they say | what to pass |
|---|---|
| nothing about fields | `--max-fields 25` |
| "all the fields", "everything", "I want to decide what to map" | `--max-fields all` |
| "just the keys", "only relationships" | `--keys-only` |
| a NUMBER ("about 10 per object", "keep it tight") | `--max-fields 10` |
| they NAME fields ("Account Name and Industry, Contact Email") | `--fields Account.Name,Account.Industry,Contact.Email` |

`--fields` is exact and wins over the cap for the objects it names; objects it does not name still take the cap.
Entries must be `Object.Field` - an unqualified name is refused, because `Name` exists on nearly every object.
The pk is always kept (relationships point at it), and any named field the org does not have is reported on
stderr - relay that, it is usually a typo.

**Step 2's output is a DRAFT, and reviewing it is the job.** Measured on a real org: four core objects returned
**612 fields**. `--keys-only` cut that to 192, `--max-fields 12` to 48. The hand-built official data models use
3-14 fields per object. A whole-org dump is both unloadable (`MAX_CELL_COUNT` is 2000) and unreadable, so
deciding which objects and which fields the diagram is ABOUT is the part that makes it useful - and it is
exactly the part a script cannot do.

Read the stderr summary: it tells you how many relationships were dropped for pointing outside the selection
(add those objects) and how many were lost to field pruning (raise `--max-fields`).

**Data Cloud** works the same way - pass the DMO catalogue instead, and remember to paginate:
```bash
sf api request rest "/services/data/v67.0/ssot/data-model-objects?limit=200" -o <org> > dmos.json
node scripts/org-to-selection.mjs dmos.json --only ssot__Individual__dlm,ssot__ContactPointEmail__dlm
```

### Data Cloud field mappings → a `datamapping` diagram

`ObjectSourceTargetMap` metadata carries the object pairs, the field pairs and the formulas in one retrieve.
The Connect API (`/ssot/data-model-object-mappings`) returns the same pairs but has nowhere to put the formula
detail, and is GET-by-name - so the retrieve is the one to use.

```bash
sf project retrieve start -o <org> -m "ObjectSourceTargetMap:*"
node scripts/mappings-to-diagramforce.mjs force-app/main/default/objectSourceTargetMaps \
  --only Contact_Home --org <org> --title "Contact_Home mappings" > diagram.json
node scripts/validate-diagram.mjs diagram.json
```

Pass `--org <alias>` when you have one: it fetches each DLO's and DMO's **category** (Profile / Engagement /
Other) from `/ssot/metadata` in two GETs and stamps it on the cards, the way the official templates categorise
theirs. No org reachable? `--categories metadata.json` accepts a saved copy of the same payload. Either way a
failure is a silent no-op - cards simply stay uncategorised for the user to set. The app's picklist is exactly
Profile / Engagement / Other - an org (or a screenshot) may say `Related` or `Segment_Membership`, and both
normalise to **Other** (AccountContact, Salesforce's standard Related-category DMO, is hand-set to Other in
the official template). Only DLO and DMO cards carry `category`; Source and Data Stream cards OMIT the key
entirely - do not invent one when you author by hand.

The metadata path also draws the owner-convention **formula input connectors**: a formula that reads source
data (`sourceField['X']` in its expression) gets a left-to-left connector from each referenced source field
row into its formula row; static formulas get none. Draw the same convention when you author by hand: one
plain `Standard` mapping link per referenced source field, from the source row's LEFT port to the formula
row's LEFT port (`field-left-<fid>` at BOTH ends, so the link runs down the shared column edge), and set NO
`expressionRule` on it - the expression already rides the companion's Formula link. A static formula reads no
source data, so it gets no input connector at all.

There is a second, lighter source the same script accepts - **one GET**, DMO-scoped, so it needs no `--only`:

```bash
sf api request rest "/services/data/v67.0/ssot/data-model-object-mappings?dmoDeveloperName=ssot__Individual__dlm" \
  -o <org> > mappings.json
node scripts/mappings-to-diagramforce.mjs mappings.json > diagram.json
```

Prefer the retrieve when you can: the Connect response carries only the object and field pairs, so it produces
no Formula companion cards and no Expression / Rule values (~5% of field rows in a real org). Reach for the GET
when the user cannot authenticate the CLI against the org, or already has the response in hand - and tell them
what it left out. **The user can also paste that same response straight into the app** (Load & Import ->
Paste), which is often faster than involving you at all - say so rather than making them round-trip through a
file.

`--only` matches either side of a mapping, and **you will need it.** Measured on a real Data Cloud org: 154
object mappings, 3661 field mappings, one DLO fanning out to 7 DMOs. That is 3695 cells against a
`MAX_CELL_COUNT` of 2000 - the script refuses rather than emitting something the app cannot open. Pick the
objects the diagram is ABOUT.

Two things to tell the user when you hand it over:

- **The suffix tells you the layer - and the Data Stream zone is not a column.** A suffix-less name is a
  source object (DSO) and sits in the **Source** layer; `__dll` is a DLO, `__dlm` a DMO. The **Data Stream**
  zone holds ONLY what the stream itself adds - the formulas companion card - and it shares the Source column,
  stacked about 56px below the Source zone, never a lane of its own. A DLO is one card, whether it is acting
  as a source or a target. Follow the same placement when you author a `datamapping` by hand - the spec's
  Data Mapping section prescribes it.
- **Formula mappings have no source field** (153 of 153 in the org this was built against), so each source
  object that has them gets a **"&lt;name&gt; Formulas"** companion card, feeding real
  `mappingType: "Formula"` links. That is the convention the official `data360-contact-mapping` template uses,
  and it means the formula gets the connector's **F** badge plus the **Expression / Rule** column in the Table
  view. A companion card is NOT an object in the org - say so when you hand the diagram over.

### Data Cloud DATA GRAPHS

A data graph is a TREE - one primary DMO with related objects hanging off it, each with their own - so it
becomes a Data Model diagram laid out by DEPTH: a column per level, the primary object on the left, a crow's
foot at every child end (every edge is to-many by construction).

```bash
# what the org has
sf api request rest /services/data/v64.0/ssot/data-graphs/metadata -o <org>
# one graph, by DeveloperName
node scripts/datagraph-to-diagramforce.mjs --org <org> --name Profile diagram.json
node scripts/validate-diagram.mjs diagram.json
```

**Two input shapes, and the difference is worth telling the user about.** The DEFINITION above carries real
object and field labels, field types, and which columns are keys. The PREVIEW payload - what Data Cloud shows
under **Data Graphs -> Preview**, which a user can copy with no API access at all - carries none of that: names
are derived from the API names and keys from naming convention. Both work:

```bash
node scripts/datagraph-to-diagramforce.mjs preview.json diagram.json --root UnifiedIndividual__dlm
```

A preview's repeated array entries are sample ROWS of one object, not several objects, so they are merged into
one card - and merged across ALL rows, because a preview omits nulls and row 1 is therefore not the schema.

A definition also gets **two things a preview cannot give**, and both are simply absent for a paste rather than
faked: a **facts card** beside the tree (type, status, data space, primary object, refresh schedules, real-time
and caching flags, Id / Values DMO, dates, version - rows with nothing to say are omitted), and a **join label
on every edge** (`ssot__Id__c = UnifiedRecordId__c`), read from each related object's `path[]`. Tell the user
which of the two they are looking at.
**The user can paste either shape straight into the app** (Load & Import -> Paste, which has its own Data Graph
card) - say so rather than making them round-trip through a file.

### One retrieve, three diagrams

All three org importers now read what `sf project retrieve` writes, so a single pull covers the release:

```bash
sf project retrieve start -o <org> -m "Flow:*" -m "ObjectSourceTargetMap:*"
node scripts/flow-to-diagramforce.mjs force-app/main/default/flows/My_Flow.flow-meta.xml flow.json
node scripts/mappings-to-diagramforce.mjs force-app/main/default/objectSourceTargetMaps --only <dlo> > map.json
```

Core objects are the exception - they are a QUERY, not a retrieve (`FieldDefinition` via `sf data query`), and
they still go through `org-to-selection.mjs` first because which objects and fields belong is a judgement.

## Examples

**Example 1**
Input: "We push Leads from a web form into Salesforce, sync them to Marketing Cloud via MC Connect, and
mirror them to a data warehouse. Diagram it."
Output: an `architecture` diagram - a node per system (Web Form, Salesforce, Marketing Cloud, Data
Warehouse) with labeled connectors for each hop - validated clean, saved to a file, and delivered as a
one-click `#diagram=` link (it fits comfortably at this size).

**Example 2**
Input: "Map the standard Contact fields into a Data Cloud Individual DMO."
Output: a `datamapping` diagram with source and DMO DataObjects in their layer zones and field-to-field
mapping links, authored from the spec's `datamapping` section and Data 360 guidance, validated clean.

**Example 3**
Input: "Here's the Tooling API JSON for our Case routing flow - diagram it." *(response pasted)*
Output: run `scripts/flow-to-diagramforce.mjs` on it, validate the result, hand over the file plus the
paste steps, and pass on any converter warning (e.g. a Custom Error element shown as an Action card).

## Staying in sync (for maintainers)

Three files are **verbatim copies** of the app's, snapshotted at the version in the spec's "Spec
snapshot" marker. Re-copy them from the repo on each Diagramforce release:

| Bundled copy | Source in the app |
|---|---|
| `references/DIAGRAM_JSON_SPEC.md` | `DIAGRAM_JSON_SPEC.md` |
| `scripts/diagram-schema.js` | `js/persistence/diagram-schema.js` |
| `scripts/flow-layout.js` | `js/canvas/flow-layout.js` |

Keeping the schema current is what stops the validator drifting from the renderer - it is the guard: a
shape the copy doesn't know is flagged rather than silently accepted. `flow-layout.js` matters less
often (only the computed-layout path uses it) but should track the app so converted flows keep looking
like Flow Builder. `flow-to-diagramforce.mjs` reads its `appVersion` straight from the bundled spec, so
re-syncing the spec is enough to stamp the right version.

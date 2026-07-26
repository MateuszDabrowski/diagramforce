---
name: diagramforce
description: >-
  Author an importable Diagramforce diagram - from a description, from an existing diagram (a screenshot,
  draw.io, or Mermaid), or from real Salesforce Flow metadata (Tooling API JSON) - then hand the user a
  file to open in Diagramforce. Diagramforce is a no-backend browser editor for Salesforce/CRM
  architecture, data models (ERD), Data Cloud field mappings, process flows, Salesforce Flows, org
  charts, Gantt timelines, and UML sequence diagrams. Use it whenever the user wants to visualize,
  diagram, map, model, draw, or recreate any of those as an editable diagram - especially in a
  Salesforce, Marketing Cloud, or Data Cloud context, and even when they don't name Diagramforce (e.g. 'turn
  this into an ERD', 'map these fields into the Individual DMO', 'diagram this Flow from my org', 'redraw
  this architecture screenshot'). It outputs diagram JSON validated to import intact - no account, no
  backend. Do NOT use it for data charts or dashboards, for writing code, or for reviewing a design
  without drawing it.
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
**Load & Import -> Paste** and the app auto-detects and converts it (`graph`/`flowchart`/`stateDiagram`
-> Process, `erDiagram` -> Data Model, `sequenceDiagram` -> Sequence), so you may not need to author
JSON at all. Author JSON yourself when they want a type Mermaid can't express, or edits beyond a
straight conversion.

**Starting from a real Salesforce Flow? Convert it - do not redraw it.** If the flow exists in an org,
its metadata already holds every element, connector, decision outcome and fault path, so hand-authoring
it would be slower AND less accurate. Ask the user for the Tooling API response:

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

Then run the bundled converter and validate as usual:

```bash
node scripts/flow-to-diagramforce.mjs flow-response.json diagram.json
node scripts/validate-diagram.mjs diagram.json
```

It maps each metadata collection to its `df.Flow*` class, carries decision outcomes / fault paths (red)
/ Go To jumps (blue) with their branch labels, synthesises the End cards the metadata has no element
for, fills each card's **`details`** rows with the documentation detail that will not fit on a card (the
fields a Create/Update writes, what a Get reads out and into which variables, a screen's components with
their types, each outcome's condition, an action's parameters), emits a **`df.Table` above Start** holding
the flow-level facts (status, API version, run mode, description, resource counts), and either honours the flow's own `locationX/Y` or - when the builder stored none (as Marketing
Cloud Next journeys do) or stored only some - computes the same tidy tree the app's Auto Layout uses.

**Read its warnings out to the user - always.** They are the part a clean validator cannot tell you:
the validator proves the diagram LOADS, while the warnings are where the converter says what it could
not represent faithfully. An element type it has no dedicated shape for still gets drawn (as a generic
Action card, so the graph stays connected and nothing pointing at it breaks) and named in a warning -
Orchestrator/approval **stages** and **Custom Error** are the two you will meet most. Other warnings
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

### 5. Deliver (paste into Diagramforce - no account, no backend)

Save the final, validated JSON as a file (`.json`, or Diagramforce's own `.dgf` extension - the
content is identical). Then give the user the file **and** these steps:

1. Open **https://diagramforce.com**
2. Click **Load & Import**, choose the **Paste** tab, paste the JSON, and click **Load**
   (or use the **File** tab to open the `.json` / `.dgf` you saved).
3. That's it - the diagram opens as a new tab. No sign-in; nothing leaves the browser.

If the user later wants it in Google Drive or shared, they can do that from inside the app - your job
ends at a clean, importable diagram.

## Examples

**Example 1**
Input: "We push Leads from a web form into Salesforce, sync them to Marketing Cloud via MC Connect, and
mirror them to a data warehouse. Diagram it."
Output: an `architecture` diagram - a node per system (Web Form, Salesforce, Marketing Cloud, Data
Warehouse) with labeled connectors for each hop - validated clean, saved to a file, with the paste steps.

**Example 2**
Input: "Map the standard Contact fields into a Data Cloud Individual DMO."
Output: a `datamapping` diagram with source and DMO DataObjects in their layer zones and field-to-field
mapping links, authored from the spec's `datamapping` section and Data 360 guidance, validated clean.

**Example 3**
Input: "Here's the Tooling API JSON for our Case routing flow - diagram it." *(response pasted)*
Output: run `scripts/flow-to-diagramforce.mjs` on it, validate the result, hand over the file plus the
paste steps, and pass on any converter warning (e.g. Orchestrator stages shown as Action cards).

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

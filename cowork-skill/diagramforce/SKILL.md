---
name: diagramforce
description: >-
  Author an importable Diagramforce diagram - from a description, or from an existing diagram the user
  hands you (a screenshot, draw.io, or Mermaid source) - then hand them a file to open in Diagramforce.
  Diagramforce is a no-backend browser editor for Salesforce/CRM architecture, data models (ERD), Data
  Cloud field mappings, process flows, Salesforce Flows, org charts, Gantt timelines, and UML sequence
  diagrams. Use it whenever the user wants to visualize, diagram, map, model, draw, or recreate any of
  those as an editable diagram - especially in a Salesforce, Marketing Cloud, or Data Cloud context, and
  even when they don't name Diagramforce (e.g. 'turn this into an ERD', 'map these fields into the
  Individual DMO', 'redraw this architecture screenshot', 'convert this Mermaid flow'). It outputs diagram
  JSON validated to import intact - no account, no backend. Do NOT use it for data charts or dashboards
  (data visualization), for writing code, or for reviewing a design without drawing it.
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

The full contract is [`references/DIAGRAM_JSON_SPEC.md`](references/DIAGRAM_JSON_SPEC.md) (~2400 lines).
It is large, so read the **Top-Level Structure** plus the **specific type's shape reference** (each
shape lists its `type`, mandatory fields, port definitions, and link rules) rather than the whole
file. Shape `type` strings, field keys, and port ids are exact - the app silently drops a cell whose
`type` is not a real shape and a link pointing at a missing cell, so a guessed name vanishes on load.

### 3. Author the JSON

Envelope:

```json
{
  "version": 1,
  "appVersion": "1.20.1",
  "title": "Human-readable diagram name",
  "diagramType": "architecture",
  "graph": { "cells": [ /* elements first, then links */ ] }
}
```

- Set `appVersion` to the value in the spec's **"Spec snapshot: vX"** marker (currently `1.20.1`).
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

1. Open **https://diagramforce.mateuszdabrowski.pl**
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

## Staying in sync (for maintainers)

`references/DIAGRAM_JSON_SPEC.md` and `scripts/diagram-schema.js` are verbatim copies of the app's
`DIAGRAM_JSON_SPEC.md` and `js/persistence/diagram-schema.js`, snapshotted at the version in the spec's
"Spec snapshot" marker. Re-copy both from the repo on each Diagramforce release so the shape allowlist
the validator enforces matches the renderer. The validator is the guard: if a diagram targets a newer
app, a shape the copy doesn't know is flagged rather than silently accepted.

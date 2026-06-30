# Diagramforce JSON Specification

> Reference for LLMs and developers generating importable diagram JSON files for **Diagramforce**.
>
> The app lives at **[diagramforce.mateuszdabrowski.pl](https://diagramforce.mateuszdabrowski.pl/)** — this is the only canonical URL. When you point a user to the app (e.g. "paste this JSON via Load ▸ Import"), always use that address. There is **no** `diagramforce.app` / `diagramforce.com`.
>
> **Spec snapshot: v1.19.1** — matches the app's current `appVersion`; set `"appVersion": "1.19.1"` in generated files.
>
> **Validate before importing.** Run `npm run validate -- your-diagram.json` (a zero-dependency dev CLI) to catch the
> issues the loader heals or **silently drops** rather than erroring on: a cell whose `type` isn't a real shape (dropped
> on load), a link pointing at a missing cell id (dropped), duplicate cell ids, a missing/wrong `diagramType`, and a
> type-specific shape used in the wrong diagram type. It exits non-zero on errors, so it doubles as a CI gate. The CLI
> shares the **same shape allowlist** the app loads with (`js/persistence/diagram-schema.js`), so it can't drift.

## Top-Level Structure

```json
{
  "version": 1,
  "appVersion": "1.19.1",
  "timestamp": 1712700000000,
  "title": "My Diagram",
  "diagramType": "architecture",
  "graph": {
    "cells": [ /* elements and links */ ]
  },
  "viewport": {
    "zoom": 1,
    "translate": { "tx": 0, "ty": 0 }
  }
}
```

> **File extension (v1.17.0).** Diagramforce has its own extension **`.dgf`** (used mainly for Google
> Drive, so Drive can offer "Open with Diagramforce") — but the **content is exactly this JSON envelope,
> unchanged**. The app still imports plain `.json` too; format is detected from the JSON **structure**,
> never the extension. Drive stores `.dgf` files with the MIME `application/vnd.diagramforce+json`
> (the bytes are still the JSON envelope above).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | number | Yes | Always `1` |
| `appVersion` | string | Yes | Semver string, currently `"1.19.1"` |
| `timestamp` | number | No | Unix timestamp in milliseconds |
| `title` | string | Yes | Diagram name (shown as tab title) |
| `diagramType` | string | Yes | One of: `"architecture"`, `"process"`, `"datamodel"`, `"datamapping"`, `"org"`, `"gantt"`, `"sequence"`. **Must match the shapes you use** (see [Diagram Types](#diagram-types)). Aliases `"data"`/`"organisation"` are accepted but the canonical forms are `"datamodel"` and `"org"` |
| `graph` | object | Yes | Contains `cells` array — the JointJS graph data |
| `viewport` | object | No | Pan/zoom state. Omit to auto-fit on load |
| `group` | object | No | `{ "name", "icon", "color" }` of the tab GROUP this diagram belonged to. Present only when the diagram was saved/exported from a named tab group. On load the app recreate-or-REJOINS a group of that name and drops the tab into it (so reopening one grouped diagram restores its group). Omit for ungrouped diagrams. Added v1.17.0 |

> ⚠️ **Always set `diagramType` to match the shapes in the diagram.** If it is missing or wrong, the diagram opens as an architecture tab and the type-specific tools (the sequence Auto Layout, the data-model stencil, the Gantt timeline controls, etc.) are gated off until the tab is recreated. **Pick the type by the QUESTION your diagram answers using [Choosing the right diagram type](#choosing-the-right-diagram-type) - not by the shapes that first come to mind - before you author any cells.**

> For generating an importable diagram, prefer the **single-diagram** envelope
> above — it opens as a new tab. Two multi-element container formats also import
> (produced by the app's Export Manager), but you normally won't generate them:
>
> ```json
> { "schema": "diagramforce-export", "version": 1, "appVersion": "1.19.1", "exportedAt": 1712700000000,
>   "diagrams": [ { "name": "...", "diagramType": "architecture", "graph": { "cells": [] }, "viewport": null, "appVersion": "1.19.1" } ],
>   "templates": [ { "name": "...", "diagramType": "architecture", "cells": [] } ] }
> ```
>
> Each `diagrams[]` entry MAY carry its own optional `appVersion` (open-tab
> exports stamp the current version; named-save exports keep the version stored
> with the save). On re-import a diagram keeps that original version
> (`entry.appVersion || bundle.appVersion || current`) instead of being
> re-stamped as current, so its provenance survives a backup round-trip.
>
> On import, a `diagramforce-export` bundle dedups its entries against what's
> already present (exact-content matches are skipped; name clashes with different
> content get `"(Restored)"`), then saves the surviving `diagrams[]` to the
> browser and merges `templates[]` into the Templates library; both keys are
> optional. **Load → Load from Browser opens whenever the file contained any
> `diagrams[]` — even if all were duplicates** — so a re-imported backup still
> reveals where the diagrams live (toast distinguishes newly-restored from
> already-present). A
> `diagramforce-templates` file (`{ "schema": "diagramforce-templates",
> "templates": [...] }`) merges templates only. Each template's `cells` is a
> JointJS subgraph (elements + links), same cell grammar as `graph.cells`.
>
> **Group bundle (v1.16.0).** The chip menu's **Export group** emits the same
> `diagramforce-export` bundle with two extra keys — top-level `"kind": "group"`
> and `"groups": [{ "name", "icon", "color" }]` — plus each `diagrams[]` entry
> gains a `"group": "<group name>"` tag naming its group. Filename
> `df_group_<name>_<date>.json`. A group export **always uses the bundle shape**,
> even for a single diagram, so these keys survive (the single-diagram shortcut
> would strip them). `icon` is an SLDS icon ID or `null`; `color` is a hex string
> or `null`.
>
> ```json
> { "schema": "diagramforce-export", "version": 1, "appVersion": "1.19.1", "exportedAt": 1712700000000,
>   "kind": "group",
>   "groups": [ { "name": "Project A", "icon": null, "color": "#27ae60" } ],
>   "diagrams": [ { "name": "...", "diagramType": "architecture", "group": "Project A", "graph": { "cells": [] }, "viewport": null, "appVersion": "1.19.1" } ] }
> ```
>
> A `kind:"group"` bundle imports **differently** from a generic one: it
> recreates the group(s) and opens each diagram as a **grouped tab** (group names
> deduped, tab names deduped) — an intentional "bring my whole project back as a
> working set" — whereas a generic bundle (no `kind`) still lands its diagrams in
> **browser saves**. A generic Export-Manager / Select-All export passes no
> `groups`, so the `kind`/`groups`/`group` keys never appear there. A group
> bundle opened in a **pre-1.16.0** build degrades gracefully: the older importer
> ignores `kind`/`groups` and the diagrams simply become browser saves.

## Diagram Types

| Type | Use For | Primary Shapes |
|------|---------|----------------|
| `architecture` | System architecture, integrations | SimpleNode, Container, Zone, Note, TextLabel, Image |
| `process` | BPMN workflows, flowcharts | BpmnEvent, BpmnTask, BpmnGateway, BpmnSubprocess, BpmnLoop, BpmnPool, BpmnDataObject, Flow* shapes, Annotation |
| `datamodel` | ERDs, Salesforce object models (pure ER) | DataObject |
| `datamapping` | Data Cloud / Data 360 field mapping (mapping mode always on — all-field ports, Category, source→DMO mapping links) | DataObject + mapping links (`linkKind:"mapping"`) + labelled **layer Zones** (`sf.Zone` with `layerStage`: `source`/`dlo`/`dmo`/`activation`) |
| `org` | Org charts, team structures, RACI workflows | OrgPerson, Container (Team), Zone (Department), Task, TaskGroup (RACI section) |
| `gantt` | Project timelines | GanttTimeline, GanttTask, GanttMilestone, GanttGroup, GanttMarker |
| `sequence` | UML sequence diagrams, message flows | SequenceParticipant, SequenceActor, SequenceActivation, SequenceFragment |

> **`sf.Image`** is available in every diagram type's "Generic Shapes" stencil group (since v1.9). Note that any tab containing `sf.Image` cells has Share-as-URL automatically disabled — see [sf.Image](#sfimage-since-v19) for details.

> **`df.Pill`** (an auto-widening number / short-label badge — a circle for `1`, a stadium pill for `Phase 1`, driven by the `pillText` prop) is a net-new GENERIC shape in every type's "Generic Shapes" group (since v1.17.2). It uses the **`df.` namespace** — the project marks net-new shapes `df.*` while legacy shapes keep `sf.*` (the type string is serialized, so renaming would break old saves); both resolve via `cellNamespace`/`cellViewNamespace = joint.shapes`.

> **`df.Legend`** (since v1.17.3) — one legend KEY: a fillable rounded "squircle" swatch (the user-fillable colour, attr `swatch/fill`) with a label beside it (attr `label/text`, themed `var(--text-primary)`). Drop several to explain each colour a diagram uses. AUTO-WIDTHS to the label at the model level, UNLESS `manualWidth: true` (set by the Width control or a resize, cleared by "Auto size") — then the authored `size.width` is kept. The **Shape state** border paints on the `swatch` (the visible squircle); the full-bounds `body` attr is transparent and only carries selection.

> **`df.Table`** (since v1.17.3) — a grid of **markdown, multi-line** cells. Top-level props: `rows` (an array of row arrays of cell strings, e.g. `[["**Layer**","What"],["Data 360","Unifies\nidentity"]]` — each cell supports the same markdown subset as a description: `**bold**` / `*italic*` / `~~strike~~` / `` `code` `` + `\n` line breaks); optional `tableLabel` (a caption rendered above the grid, left-aligned); `highlightFirstRow` (bool, default `true`) + `highlightFirstCol` (bool, default `false`) tint + bold the leading row / column; `fontSize` (default `13`); `tableFill`; `tableBorder` (tints BOTH the outer border AND the inner grid lines — the "Grid & Border" control); and `tableTextColor` (cell text + the label; `''` → `var(--text-primary)`). The label renders one notch larger than the cells (`fontSize + 2`). The number of columns is the widest row's length; ragged input is padded to a rectangle on load, and a manual resize re-applies a per-column minimum width. The view MEASURES each cell's wrapped markdown to give rows **variable height** (so a multi-line cell grows its row), and resizes the model. The outer `body` rect is a transparent selection + Shape-state frame (the visible table is view-drawn from `tableFill`/`tableBorder`). Cells are edited in the "Edit in Table" overlay (Save / Cancel, +Row / +Column strips, row-× / column-×). *(Replaces the pre-v1.17.3 `headerRow` boolean — old tables migrate it to `highlightFirstRow` on load.)*

> **Highlight State (review / diff overlay, since v1.17.2; UI label "Highlight" → "Shape State" → "Highlight State" across v1.17.x — internals/prop unchanged):** any element with a `body` outline gets a `None / Added / Changed / Removed / Deferred` control — its own COLLAPSIBLE section (collapsed by default, between Content and Appearance), the states stacked as styled checkbox rows (the selected row carries the dash effect) — that paints the body stroke green (added) / orange dotted (changed) / red dashed (removed) / violet dash-dot (deferred). It persists as a top-level `borderStyle` prop (`"bold"` / `"dotted"` / `"dashed"` / `"deferred"`; the prop name predates the UI rename and is kept stable for back-compat). A companion `_origBorder` prop (`{stroke, strokeWidth, strokeDasharray}`) stashes the pre-override stroke so reverting to **None** restores the shape's own border losslessly. Both absent on a None / un-highlighted element.

## Choosing the right diagram type

Pick the type by the **question your diagram answers**, not by the shapes that first come to mind. The most common
failure is reaching for `architecture` (generic boxes + arrows) for something that has a purpose-built type. These
seven types are **general-purpose** - draw any architecture, process, data, org, or timeline diagram, not only
Salesforce ones. The last column maps each onto a category in [Salesforce's diagramming framework](https://architect.salesforce.com/diagrams)
as a convenience when you're working in a Salesforce context; ignore it for non-Salesforce diagrams.

| Your diagram answers... | Use | Salesforce framework (cross-ref, optional) |
|---|---|---|
| "What systems / products / integrations exist and how do they connect?" | `architecture` | System Landscape, Solution Architecture, Capability Map |
| "Who are the people and teams - reporting lines, team composition, who is responsible for what (RACI)?" | `org` | Role Hierarchy (people / personas) |
| "What are the steps of a process, in what order?" (approval, onboarding, branching, swimlanes) | `process` | Interaction / Process and Flow (BPMN) |
| "In what time-order do systems or actors message each other?" | `sequence` | Interaction / Process and Flow (UML sequence) |
| "What objects / fields exist and how are they related?" (schema, keys, cardinality) | `datamodel` | Data Model (ERD) |
| "How do source fields map into Data Cloud DLOs / DMOs?" | `datamapping` | Data Model + Solution Architecture (Data Cloud) |
| "What gets delivered when - the plan / roadmap over time?" | `gantt` | Roadmap |

### Don't confuse these (the mis-picks that produce a wrong-looking diagram)

- ✗ Drawing **people or teams** (two teams on a project, an org chart, who-does-what, reporting lines) as boxes-and-arrows in `architecture` → ✓ that is an **`org`** diagram. `architecture` is for SYSTEMS and integrations, never people. Use `sf.OrgPerson`, `sf.Container` (Team), and `sf.Task` + `sf.TaskGroup` for RACI. *(In Salesforce's framework this is the Role Hierarchy diagram - people are not free-floating actors in a system landscape.)*
- ✗ Using `architecture` for a **step-by-step process** (an approval, an onboarding flow) → ✓ `process`. When the message is the ORDER of steps, use BPMN events / tasks / gateways, and number the steps.
- ✗ Using `architecture` (or any generic boxes) for a **data schema** (objects, fields, keys) → ✓ `datamodel`. You need field rows + crow's-foot cardinality, which only `sf.DataObject` provides.
- ✗ Using `process` (one BPMN pool) when the point is **who messages whom, in what order**, across systems → ✓ `sequence`. Lifelines + ordered messages read an interaction better than a flowchart.
- ✗ Drawing a **project plan / timeline** as a flowchart → ✓ `gantt`. Dates, dependencies, and a time axis are the message (Salesforce's Roadmap).
- ✗ Reaching for `datamapping` for **any** field mapping (e.g. a Salesforce → Snowflake ETL, or any non-Data-Cloud mapping) → ✓ `datamapping` is **Data Cloud-specific** (its layers are Source / DLO / DMO / Activation). For a general source→target field relationship, model it in `datamodel` with a relationship link between objects.

> **One diagram, one message.** Scope ruthlessly - exclude anything not required to convey the message (a principle
> Salesforce's framework states too). If a request spans two questions (e.g. the systems AND the rollout plan),
> produce TWO diagrams of the right types rather than one overloaded `architecture` diagram.

## Diagramming best practices

General diagramming hygiene that makes ANY generated diagram clearer, expressed in Diagramforce features. These are
standard practices that hold for any diagram, Salesforce-related or not; the [Salesforce diagramming
framework](https://architect.salesforce.com/diagrams) is one well-known codification of them, cited below where it
adds a concrete rule.

- **Give every diagram a Header.** Set a clear `title`, and for an on-canvas heading add an `sf.TextLabel` (markdown) at the top stating the diagram's purpose in one line. A title + one-line purpose orients any reader (and is what the SF framework asks for).
- **Add a Key when colour, line-style, or icon carries meaning.** Drop one `df.Legend` swatch per colour/classification so the encoding is never guessed. (This is the "Key" the SF framework expects whenever a classification is not labelled directly on the shape.)
- **Let connectors stay orthogonal.** Diagramforce's router already draws orthogonal connectors (L / Z / U-shaped as the obstacles need), kept straight where possible. A connector ENDPOINT means **direction** on a flow/integration (use an arrow) and **cardinality + optionality** on a data relationship (use crow's-foot markers) - never an arrow on an ERD relationship, nor a crow's-foot on a process flow.
- **Number the steps on a process or sequence** so the order is unambiguous - prefix task/message labels with `1.`, `2.`, … or drop a `df.Pill` badge on each step.
- **Put connector detail in a label or Pill, not a fatter line.** Use a link label or `df.Pill`; for an integration cadence use the connector **Frequency** field (Architecture diagrams only; renders a clock + interval, see [Link Labels](#link-labels)).
- **Keep text legible.** Text and its background should contrast strongly (the SF framework uses a 50-point rule on a 0-100 lightness scale). The built-in light/dark themes already satisfy this - preserve it if you override fills.
- **Use the Information-Engineering ER notation** Diagramforce ships: crow's-foot = many, circle = optional (zero), bar = exactly one; the master-detail parent reads as the "one" side. See [Marker Types](#marker-types).
- **Prefer several focused diagrams over one dense one** - split varying concepts into separate diagrams rather than overloading one.

## Common authoring mistakes (per type)

The traps below are **type-specific** - things the loader silently heals, drops, or derives, so emitting them wrong
fails quietly. (The generic mistakes - an unknown shape `type`, a link to a missing id, duplicate ids, a wrong
`diagramType` - are caught by `npm run validate`; see the top of this doc.) Each rule is `✗ wrong → ✓ right`.

**`architecture`**
- ✗ `type: "sf.Link"` to connect two shapes → ✓ `type: "standard.Link"` with `source`/`target` `{id, port}`. `sf.Link` is a standalone clickable-URL pill ELEMENT (a `url`-prop node with no ports), not a connector.
- ✗ invented endpoint port names (`"right"`, `"out"`, `"port-1"`) → ✓ the four baked-in ids verbatim: `port-top` / `port-right` / `port-bottom` / `port-left` (they exist even if you omit the element's `ports` block; a bad name makes load throw "invalid target").
- ✗ a one-sided embed (child in the Container's `embeds[]` but no `parent` on the child, or vice-versa) → ✓ set BOTH: the child id in the parent's `embeds` AND `parent: "<container-id>"` on the child (the loader does not reconcile the missing half). Position the child below the 40px header.
- ✗ explicit `fill`/`stroke` on an arrow `targetMarker` → ✓ OMIT `targetMarker` (the loader normalises it to `M 0 -6 L -14 0 L 0 6 z`); `fill`/`stroke` are only for ER crow's-foot markers.

**`process`**
- ✗ `sf.BpmnEvent`/`sf.BpmnGateway` with only the discriminator (`eventType`/`gatewayType`) and default `attrs` - it's inert on load (the colour/glyph are applied only at stencil-drop) → ✓ also emit the matching `attrs`: a gateway needs `attrs.marker.text` (exclusive `×`, parallel `+`, inclusive `○`, event `◇`); a non-start event needs its `body` fill/stroke (see the BpmnEvent reference).
- ✗ `targetMarker: {type:"none"}` (or any markerless object) on a flow you want arrowed - the loader skips markers with no `d`, so it loads undirected → ✓ OMIT `targetMarker` for a directed flow. `sourceMarker` is NOT auto-arrowed.
- ✗ linking TO a `sf.BpmnPool` (it has no ports) → ✓ attach links to the step shapes (Task/Event/Gateway); embed steps with `parent:"pool-id"` + the id in the pool's `embeds[]`.

**`datamodel`**
- ✗ emitting a `ports` block on an `sf.DataObject` → ✓ omit it entirely - the loader rebuilds `port-top`/`port-bottom`, `er-left`/`er-right`, and one `field-{left,right}-<fid>` per keyed field. Only REFERENCE a port from a link endpoint.
- ✗ referencing a `field-…-<fid>` whose `<fid>` no field carries, or pointing a PK/FK link at a field with no `keyType` (no port is built) → ✓ copy a `fid` verbatim from a field in that object, or connect via the header `er-left`/`er-right` anchors.
- ✗ a crow's-foot ER marker with a solid `fill` matching the stroke → ✓ open markers (many/one/oneMany) `fill:"none"`; circle markers (zeroOne/zeroMany) `fill:"var(--bg-canvas, #1A1A1A)"`. A wrong fill fails the ER test and the cardinality is replaced with a plain arrow.
- ✗ tagging a plain object-to-object relationship with `linkKind:"mapping"` → ✓ a pure ER relationship link carries NO `linkKind` - its absence is what marks it.

**`datamapping`** (additive - see the Data Cloud mapping checklist below)
- ✗ `category` omitted, nested in `attrs`, or keyed `objectCategory` → ✓ top-level `"category": "Profile"`|`"Engagement"`|`"Other"` on each DLO/DMO cell.
- ✗ a mapping link with explicit `router`/`connector` or ER markers, or no `linkKind` → ✓ `linkKind:"mapping"` + a `mappingType` from `Standard`/`Formula`/`Streaming Transform`/`Batch Transform`/`Calculated Insight`; the loader applies `sfMappingRouter`/`sfMappingConnector` itself.
- ✗ a layer as `sf.Container`, or `layerStage` on the DataObject → ✓ each layer is an `sf.Zone` with top-level `layerStage` in `source`/`dlo`/`dmo`/`activation`.

**`org`**
- ✗ name/title in `attrs` (`nameLabel`/`positionLabel`) → ✓ top-level `personName` and `jobTitle` (the prop is `jobTitle`, NOT `position`/`title`/`role`); the view overwrites the attrs from the props every render.
- ✗ a tall hardcoded `size` or detail rows in `attrs` → ✓ drive content via the `details` array `[{label,value},…]`; the view auto-computes height (authored height is overwritten; empty-value rows dropped).
- ✗ wrong embed nesting → ✓ the hierarchy is TaskGroup ▸ Task ▸ OrgPerson|Team: a TaskGroup embeds only Tasks; a Task embeds only an OrgPerson or a Team (`sf.Container`); TaskGroup is top-level. Set BOTH `embeds[]` and `parent` (no reciprocation).

**`gantt`**
- ✗ emitting a GanttTask's `position`/`size`/`progressBar.width` → ✓ emit DATA only: `startDate`/`endDate` (`"YYYY-MM-DD"`, ALWAYS both), `order` (a distinct 0-based row slot), `progress` 0-100. The loader derives x/width/fill from the dates + order.
- ✗ omitting `order` (expecting array order or `position.y`) or duplicating it → ✓ one distinct integer `order` per bar - it IS the row slot (group headers push it down).
- ✗ placing a GanttMilestone/GanttMarker by `position.x` → ✓ set `milestoneDate`/`markerDate` for the column; emit only `position.y` for the row (X is overwritten).
- ✗ dependencies as a `dependsOn` array, or a bare `standard.Link` between bars → ✓ a `standard.Link` with `linkKind:"ganttDep"` + `source.port:"port-right"` → `target.port:"port-left"` (FS), optional `depType`/`lag`. Predecessors are DERIVED from these links.

**`sequence`**
- ✗ serializing a `ports.items` array (hand-written `seq-port-left-0`…) → ✓ set ONLY the integer `lifelinePortCount` (>= messages received; 10 is safe) and omit `ports` - the loader regenerates `seq-port-{left,right}-<i>`.
- ✗ a `sf.SequenceActor` with messages but `showLifeline` omitted/false (no lifeline, no ports → links dangle) → ✓ set `showLifeline:true` on any messaging Actor (Participants always have a lifeline).
- ✗ dashing a reply via `attrs.line.strokeDasharray` (auto-dash only fires on interactive draw) → ✓ set top-level `lineStyle:"6 4"`; a reply also swaps direction (`source seq-port-left-<i>` → `target seq-port-right-<i>`).

## Cell Structure (Elements)

Every element in the `cells` array follows this structure:

```json
{
  "id": "unique-id-1",
  "type": "sf.SimpleNode",
  "position": { "x": 100, "y": 200 },
  "size": { "width": 180, "height": 64 },
  "z": 2000,
  "attrs": { /* shape-specific visual attributes */ },
  "ports": { /* port definitions — include for shapes with ports */ }
}
```

### Mandatory Fields for Every Element

| Field | Description |
|-------|-------------|
| `id` | Unique string. Use any format (e.g., `"node-1"`, UUID). Must be unique across all cells |
| `type` | Shape class name (e.g., `"sf.SimpleNode"`) |
| `position` | `{ "x": number, "y": number }` — top-left corner in canvas coordinates |
| `size` | `{ "width": number, "height": number }` |
| `z` | Z-order layer (see Z-Order section) |
| `attrs` | Nested attribute object keyed by SVG selector |

### Z-Order Values

Assign these `z` values to keep layers rendering correctly:

| Shape Type | Z Value | Layer |
|-----------|---------|-------|
| Zone, BpmnPool | `0` | Background |
| BpmnSubprocess, BpmnLoop, SequenceFragment | `500` | Sub-containers |
| Container, GanttTimeline, GanttGroup | `1000` | Containers |
| SimpleNode, Note, TextLabel, DataObject, OrgPerson, all Bpmn/Flow shapes, GanttTask, GanttMilestone, GanttMarker, SequenceParticipant, SequenceActor | `2000` | Elements |
| SequenceActivation | `2200` | Overlays on top of elements |
| Links | `3000` or higher | Connections |

### Port Definitions

Most shapes need ports for connecting links. Include this `ports` block for any shape that should be connectable:

```json
"ports": {
  "groups": {
    "top":    { "position": { "name": "top" },    "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] },
    "right":  { "position": { "name": "right" },  "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] },
    "bottom": { "position": { "name": "bottom" }, "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] },
    "left":   { "position": { "name": "left" },   "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] }
  },
  "items": [
    { "id": "port-top",    "group": "top" },
    { "id": "port-right",  "group": "right" },
    { "id": "port-bottom", "group": "bottom" },
    { "id": "port-left",   "group": "left" }
  ]
}
```

Shapes that do NOT have ports: `sf.TextLabel`, `sf.Note`, `sf.Line`, `sf.Link`, `sf.Zone`, `sf.TaskGroup`, `sf.BpmnPool`.

> **Never delete, rename, or restyle the standard ports — always leverage the out-of-the-box (OOTB) ones.** Emit the standard port block exactly as shown above (or omit `ports` entirely on shapes that supply them automatically, e.g. `sf.DataObject`), and **do not prune ports just because no link currently connects to them.** Every connectable shape ships with its full set of attachment points so the user can wire up *new* connections after generation. Dropping "unused" ports — a common LLM mistake — silently strips those anchors and forces the user to rebuild them by hand. Reference the ports you need from link endpoints and leave every other port intact.

## Link Structure

Links connect two elements via ports:

> **⚠️ The #1 failure when generating diagrams: dangling references.** Every link's
> `source.id` and `target.id` **must** be the `id` of an element you actually defined
> in this same `cells` array — never reference an id you didn't create, and never
> mistype one. Likewise a field port `field-left-<fid>` / `field-right-<fid>` **must**
> use a `fid` that exists in that element's `fields` array (copy it verbatim — don't
> invent a new prefix like `m_…` when the field's `fid` is `dmo_…`).
>
> **Before returning the JSON, check every link:** does `source.id` appear as an
> element `id` above? does `target.id`? does each port's `<fid>` exist in that
> element's `fields`? If a link names `obj-foo`, then `obj-foo` must exist as an
> element. *(Since v1.15.5 the app **skips** a link whose endpoint points at a missing
> element instead of failing the whole load — but a skipped link is a missing
> mapping, so get them right.)*

```json
{
  "id": "link-1",
  "type": "standard.Link",
  "z": 3001,
  "source": { "id": "node-1", "port": "port-right" },
  "target": { "id": "node-2", "port": "port-left" },
  "attrs": {
    "line": {
      "stroke": "#888888",
      "strokeWidth": 2,
      "targetMarker": {
        "type": "path",
        "d": "M 0 -6 L -14 0 L 0 6 z"
      }
    }
  },
  "router": { "name": "sfManhattan" },
  "connector": { "name": "rounded", "args": { "radius": 8 } }
}
```

### Link Fields

| Field | Required | Description |
|-------|----------|-------------|
| `source` | Yes | `{ "id": "element-id", "port": "port-name" }` |
| `target` | Yes | `{ "id": "element-id", "port": "port-name" }` |
| `router` | Yes | Always `{ "name": "sfManhattan" }` for orthogonal routing |
| `connector` | Yes | Always `{ "name": "rounded", "args": { "radius": 8 } }` |
| `vertices` | No | Array of `{ "x": n, "y": n }` waypoints for manual routing |
| `labels` | No | Array of label objects (see below) |
| `lineStyle` | No | Dashed/dotted dash pattern as a raw SVG `stroke-dasharray` string (`"8 4"` dashed, `"2 4"` dotted, `"6 4"` for sequence replies). Stored as a **top-level cell property** — NOT `attrs.line.strokeDasharray`. Rendered as a bg-coloured overlay clone because Safari leaks `stroke-dasharray` into `<marker>` content. Omitted / `null` means solid. |
| `linkKind` | No | `"mapping"` marks a Data Cloud source→DMO field mapping (v1.15.0); absent ⇒ an ER relationship. Top-level cell property. A field→field link drawn while the diagram's mapping mode is on is auto-tagged; mapping links render with a distinct colour (`#F6B355`, the brand accent), a single direction arrow, **1 px** stroke, and custom routing that flows cleanly left→right like the Data Cloud mapping canvas: `router: { name: "sfMappingRouter" }` adds a short horizontal stub off each field port and `connector: { name: "sfMappingConnector" }` draws that straight stub + a cubic bézier, so the line leaves and arrives **perpendicular** to the port edge (never parallel / hugging it). The ends use `source`/`target` `connectionPoint: { name: "anchor", args: { offset: 12 } }` (overriding the default 16 px offset) so the line reads as landing on its specific field port with the arrow tip right at the object edge — not diving over the field text. |
| `mappingType` | No | Data Cloud transform classification of a mapping link (v1.15.0): one of `"Standard"` (direct copy, the default applied to a fresh mapping), `"Formula"`, `"Streaming Transform"`, `"Batch Transform"`, or `"Calculated Insight"`. Top-level cell property, authored via the link inspector's **Mapping type** picklist; surfaced in the table view's **Mapping Type** column. A **non-Standard** value renders an outlined **monospace** code token (`F` / `ST` / `BT` / `CI`, tinted to the connector colour) as a link label on the target stub (see Link Labels); **Standard renders no token**. `migrateLinks` re-syncs tokens on load. A legacy `mapsTo` / `transform` attribute on an older draft is read as a fallback. |
| `expressionRule` | No | The transform **expression / rule** note for a non-Standard mapping link (v1.15.0; was briefly `mappingLabel` pre-release, still read as a fallback). Top-level cell property, authored via the link inspector's progressively-disclosed **Expression / rules** field (shown whenever `mappingType` ≠ `"Standard"`); surfaced in the table view's **Expression / Rule** column (empty ⇒ dimmed em-dash). Distinct from the link's visual `labels`. |
| `mapsTo` | No | *Legacy (read-only fallback).* Superseded by `mappingType` above; loaders still read it when `mappingType` is absent, and preserve it if an older draft has it. |
| `connectionFrequency` | No | Integration **frequency** for an Architecture connector (v1.15.0): a free-text cadence string (e.g. `"Real-time"`, `"Every 15 mins"`, `"Nightly"`). Top-level cell property, authored via the link inspector's **Frequency** field (shown only for `architecture` diagrams). When non-empty it auto-renders a secondary link label — a small clock icon + the text in muted grey — **below** the connector line (see Link Labels). Clearing it removes the label. `migrateLinks` rebuilds the label from this prop on load, so a spec may set just the prop. |

**Why `lineStyle` and not `attrs.line.strokeDasharray` (v1.7.0+):** Safari propagates a path's `stroke-dasharray` into its SVG `<marker>` elements at the renderer level, causing arrowheads / ER notation to render dashed along with the line. The app keeps the real path solid and paints a canvas-bg-coloured clone (with the dash pattern) on top to simulate dashes. `lineStyle` is the canonical storage; legacy `attrs.line.strokeDasharray` values on loaded diagrams are auto-migrated to `lineStyle` and the attr is cleared.

### Link Labels

```json
"labels": [
  {
    "position": 0.5,
    "attrs": {
      "text": { "text": "uses" }
    }
  }
]
```

`position` is 0–1 (0 = source end, 0.5 = middle, 1 = target end). A negative
`position.distance` measures back from the target end instead.

**Mapping-type code badge (v1.15.0).** A non-Standard mapping link auto-manages an extra
label — a rounded outlined box with the monospace type code (`F` / `ST` / `BT` / `CI`), transparent
(canvas-coloured) fill, and border + letters in the connector's `line/stroke` colour — pinned
to the target stub at `position.distance: -20`. It's identified by its `attrs.badgeBox` selector
and regenerated from `mappingType` by `syncMappingTypeBadge`; loaders preserve it like any label.
Editing a link's user label preserves the badge (and vice-versa).

**Connection-frequency overlay (v1.15.0).** An Architecture link with a non-empty
`connectionFrequency` prop auto-manages a secondary label: a 12 px clock icon (`<image>` with the
SLDS `clock` data URI) + the cadence text in a fixed muted grey (`#888`, legible on both themes),
centered on the link midpoint (icon pinned to the text's left edge via `ref`) with an absolute
downward `offset: { x: 0, y: 26 }` so it always sits a fixed distance **below** the connector —
regardless of segment orientation, never flipping sides or colliding with the on-line user label.
A canvas-bg mask rect (`freqBg`) breaks the connector line behind the overlay (like the user
label's body rect), leaving a short visible run of line between the label and the frequency.
Identified by its `attrs.freqText` selector and (re)built by `syncFrequencyLabel`; loaders rebuild it
from the prop. Editing a link's user label preserves it (and vice-versa).

### Marker Types

The `sourceMarker` and `targetMarker` control arrow/endpoint styles.

> **You can OMIT `targetMarker` for a standard arrow.** A `standard.Link` with no `targetMarker` would otherwise inherit JointJS's *own* built-in arrow (a short triangle that is none of the options below), so the importer **normalises any omitted/unrecognised target marker to the canonical Arrow** on load. So `"line": { "stroke": "#E11D48", "strokeWidth": 2 }` ends with a proper arrow — no need to repeat the Arrow path on every link. Set `targetMarker` explicitly only for a **non-arrow** end (an ER marker, or the **None** stub for no arrowhead). `sourceMarker` is **not** auto-normalised — it defaults to the None stub, so set it explicitly when the *source* end needs a marker.

| Marker | Definition | Use |
|--------|-----------|-----|
| Arrow | `{ "type": "path", "d": "M 0 -6 L -14 0 L 0 6 z" }` | Standard directional arrow (no explicit fill/stroke — auto-inherited) |
| None | `{ "type": "path", "d": "M 0 0 L -12 0", "fill": "none", "stroke": "#888888", "stroke-width": <line strokeWidth> }` | Stub line (use the link's stroke color; `stroke-width` **tracks the line's `strokeWidth`** so a None end never reads thicker than the connector) |
| One | `{ "type": "path", "d": "M -12 -8 L -12 8 M -12 0 L 0 0", "fill": "none", "stroke": "#888888", "stroke-width": 2 }` | ER: exactly one |
| Zero or One | `{ "type": "path", "d": "M 2 0 a 5 5 0 1 1 -10 0 a 5 5 0 1 1 10 0 Z M -8 0 L -12 0 M -12 -8 L -12 8", "fill": "var(--bg-canvas, #1A1A1A)", "stroke": "#888888", "stroke-width": 2 }` | ER: zero or one |
| Many | `{ "type": "path", "d": "M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0", "fill": "none", "stroke": "#888888", "stroke-width": 2 }` | ER: many (crow's foot) |
| One or Many | `{ "type": "path", "d": "M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0 M 3 -8 L 3 8", "fill": "none", "stroke": "#888888", "stroke-width": 2 }` | ER: one or many |
| Zero or Many | `{ "type": "path", "d": "M 4 0 a 5 5 0 1 1 10 0 a 5 5 0 1 1 -10 0 Z M -12 -8 L 0 0 M 0 0 L -12 8 M 0 0 L -12 0", "fill": "var(--bg-canvas, #1A1A1A)", "stroke": "#888888", "stroke-width": 2 }` | ER: zero or many |

For ER markers, replace `"#888888"` with the link's actual stroke color.
For arrow markers, do NOT set explicit fill/stroke — JointJS auto-inherits from the line.
The **None** stub's `stroke-width` follows the line's `strokeWidth` (markers render `userSpaceOnUse`, so it must be set explicitly — the Line-width control, `applyMappingLinkStyle` / `applyRelationshipLinkStyle`, and the load migration all keep them in lock-step). Decorated arrow / crow's-foot markers keep their own weight.

---

## Colours & dark mode

The canvas renders in **both a light and a dark theme** (user-toggled). Every shape's default colours are CSS custom properties — `"fill": "var(--node-bg)"`, `"fill": "var(--node-text)"`, `"stroke": "var(--node-border)"`, etc. — that **adapt automatically** to the active theme. The examples throughout this spec use those `var(--…)` defaults for exactly this reason.

When you hardcode a colour (a hex like `"#FFFFFF"` or `rgb()/rgba()`), it is **fixed** — it does **not** adapt to the theme. The classic failure: a node with a hardcoded light `body.fill` (`#FFFFFF`) but a *theme-default* label. In light mode both look right; switch to dark mode and the body stays white while the theme text flips to light → **invisible white-on-white**.

**Rules of thumb:**

1. **Prefer the theme defaults.** Omit `fill` on `body`, `label`, `subtitle` (or keep the `var(--…)` values) and the node is fully theme-adaptive — readable in light *and* dark with zero effort. This is the best choice unless a colour carries meaning.
2. **If you hardcode `body.fill`, you don't need to hand-pick the text colour** — the importer **auto-contrasts** a node's `label`/`subtitle` against an explicit solid `body.fill` (dark text on a light card, light text on a dark card) for any text still on the theme default. So a hardcoded "white card" stays legible in dark mode. *(You can still set `label.fill`/`subtitle.fill` explicitly to override; an explicit text colour is always respected.)*
3. **Use hardcoded colour where it carries meaning, on the parts that read on any background** — `stroke` (borders), `accent` (Container/Zone bars), brand-coloured `body.fill`. A coloured *stroke* on a theme-default body reads on both themes; a coloured *body* with white text (`label.fill: "#FFFFFF"`) reads on both themes.
4. **Translucent fills** (`rgba(…, 0.03)` Zone/Layer tints) intentionally show the canvas through them, so they stay theme-adaptive and are *not* auto-contrasted — leave their labels on the theme default.

> ⚠️ The auto-contrast safety net covers `sf.SimpleNode` label/subtitle. For richer shapes (Container header, DataObject), prefer theme defaults or pair a coloured bar with `"#FFFFFF"` text.

---

## Shape Reference

### sf.SimpleNode

Basic rounded-rect component node with optional icon and subtitle. The most common shape for architecture diagrams.

**Default size:** `180 x 64`

```json
{
  "id": "node-1",
  "type": "sf.SimpleNode",
  "position": { "x": 100, "y": 100 },
  "size": { "width": 180, "height": 64 },
  "z": 2000,
  "attrs": {
    "body": {
      "width": "calc(w)", "height": "calc(h)",
      "rx": 8, "ry": 8,
      "fill": "var(--node-bg)", "stroke": "var(--node-border)", "strokeWidth": 1
    },
    "icon": {
      "x": 12, "y": "calc(0.5 * h - 16)",
      "width": 32, "height": 32,
      "href": ""
    },
    "label": {
      "x": "calc(0.5 * w)", "y": "calc(0.5 * h)",
      "textAnchor": "middle", "textVerticalAnchor": "middle",
      "fontSize": 13,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "var(--node-text)",
      "text": "My Node",
      "textWrap": { "width": "calc(w - 64)", "maxLineCount": 4, "ellipsis": true }
    },
    "subtitle": {
      "x": 12, "y": 42,
      "textAnchor": "start", "textVerticalAnchor": "top",
      "fontSize": 10,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "var(--node-subtitle)",
      "text": "",
      "visibility": "hidden",
      "textWrap": { "width": "calc(w - 24)", "height": "calc(h - 48)", "ellipsis": true }
    }
  },
  "ports": { /* standard 4-port config */ }
}
```

**Tips:**
- For text-only nodes (no icon): set `icon/href` to `""` — the label auto-centers.
- For nodes with a description/subtitle: set `subtitle/text` to your text and `subtitle/visibility` to `"visible"`. Increase height to ~80-90 to accommodate.

**Setting an icon (brand logos + Salesforce indicators).** External generators **can** add real icons — you do **not** need to embed the full SVG. Set `icon/href` to a compact data-URI that *names* an icon by ID; on load the app resolves it to the real artwork (via `refreshAllIconHrefs`, which runs during `migrateNodes`). Pattern:

```text
data:image/svg+xml,<svg data-icon-id="ICON_ID"/>
```

In JSON the inner quotes must be escaped:

```json
"icon": { "href": "data:image/svg+xml,<svg data-icon-id=\"custom-snowflake\"/>" }
```

Leave `icon/href` as `""` for a text-only node. A node whose `body/fill` is a brand colour reads best with `label/fill: "#FFFFFF"` (white icon + label on the coloured body). The same `data-icon-id` href works for `sf.Container` and `sf.DataObject` `headerIcon/href` (both resolve white on the coloured header bar).

#### Icon ID reference

`ICON_ID` is either a **custom brand logo** (`custom-*`) or an **SLDS** ([Lightning Design System](https://www.lightningdesignsystem.com/icons/)) icon name (underscored). The table below is the **complete** set for the architecture stencil's logo-bearing categories — every token is verified against the shipped registry. Each token shows its stencil concept; where one icon serves several concepts the aliases are in parentheses.

| Stencil category | `ICON_ID` tokens (→ concept) |
|---|---|
| **Salesforce Products** | `custom-sales` · `custom-service` · `custom-marketing` · `custom-commerce` · `custom-data` (Data Cloud) · `custom-agentforce` · `custom-experience` · `custom-field-service` · `custom-net-zero` · `forecasts` (Revenue) · `custom-platform` · `custom-tableau` · `custom-slack` · `custom-mulesoft` · `custom-informatica` · `custom-appexchange` |
| **External Systems** | `custom-snowflake` · `custom-aws` · `custom-google-cloud` · `custom-azure` · `custom-databricks` · `custom-sap` · `custom-oracle` · `home` (On-Premise) |
| **Industries** | `money` (Financial Services) · `heart` (Health) · `life_sciences` · `product_item` (Manufacturing) · `store` (Consumer Goods) · `shopping_bag` (Retail) · `wifi` (Communications) · `video` (Media) · `custom-energy-utilities` · `data_governance` (Public Sector) · `education` · `patient_service` (Nonprofit) · `transport_light_truck` (Automotive) · `plane` (Travel & Hospitality) |
| **Integrations & APIs** | `data_streams` (REST / SOAP / Bulk / Streaming API) · `data_mapping` (GraphQL) · `topic2` (Pub/Sub) · `record_update` (Change Data Capture) · `event` (Platform Events) · `broadcast` (Event Relay) · `connected_apps` (Private Connect) · `database` (SFTP) |
| **Activation Channels** | `email` · `sms` (SMS / LINE) · `whatsapp` · `page` (Website) · `live_chat` (Chat) · `social` (Social Media Ads) · `push` (Mobile Push) · `notification` (Web Push) · `voice_call` (Voice / IVR) · `store` (Point of Sale) · `agent_astro` (Agent) |
| **Other common SLDS** | `data_lake_objects` (Data Lake) · `segments` (Personalization) · `einstein` · `campaign` · `advertising` · `macros` (Automation) · `desktop_and_phone` (Web App) · `phone_portrait` (Mobile) · `light_bulb` (Note) · `apex` · `integration` · `record` |

> An **unknown ID renders nothing** — use a token from the verified set above (or any valid SLDS icon name) or leave `href` empty. Note: the minimal href is **expanded to the full SVG on load**, so a generated file and its loaded/saved form are not byte-identical — this matches how in-app icon drops are already stored, and `contentSignature` (used for import dedup) reflects the resolved full href.

### sf.Container

Group node with a coloured accent bar header. Can visually contain child elements.

**Default size:** `360 x 240`

```json
{
  "id": "container-1",
  "type": "sf.Container",
  "position": { "x": 50, "y": 50 },
  "size": { "width": 360, "height": 240 },
  "z": 1000,
  "attrs": {
    "body": {
      "width": "calc(w)", "height": "calc(h)",
      "rx": 12, "ry": 12,
      "fill": "var(--container-bg)", "stroke": "var(--container-border)", "strokeWidth": 1
    },
    "accent": {
      "x": 1, "y": 1,
      "width": "calc(w - 2)", "height": 40,
      "rx": 11, "ry": 11,
      "fill": "#1D73C9"
    },
    "accentFill": {
      "x": 1, "y": 20,
      "width": "calc(w - 2)", "height": 21,
      "fill": "#1D73C9"
    },
    "headerIcon": {
      "x": 12, "y": 9, "width": 24, "height": 24,
      "href": ""
    },
    "headerLabel": {
      "x": 44, "y": 21,
      "textAnchor": "start", "textVerticalAnchor": "middle",
      "fontSize": 14, "fontWeight": "bold",
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "#FFFFFF",
      "text": "Container Name"
    },
    "headerSubtitle": {
      "x": 12, "y": 50,
      "textAnchor": "start", "textVerticalAnchor": "top",
      "fontSize": 11,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "var(--node-subtitle)",
      "text": "",
      "textWrap": { "width": "calc(w - 28)", "maxLineCount": 4, "ellipsis": true }
    }
  },
  "ports": { /* standard 4-port config */ }
}
```

**Embedding children:** To visually nest elements inside a container, set the `parent` field on child cells and add their IDs to the container's `embeds` array:

```json
// On the container:
{ "id": "container-1", "type": "sf.Container", "embeds": ["node-1", "node-2"], ... }

// On each child:
{ "id": "node-1", "type": "sf.SimpleNode", "parent": "container-1", ... }
```

Position children so they fall within the container's bounds (below the 40px header).

**Accent colors:** Change `accent/fill` and `accentFill/fill` together to set the header bar color. Common Salesforce colours:
- Sales: `#032E61`, Service: `#7F2B82`, Marketing: `#F49825`
- Platform: `#1D73C9`, Data: `#0D9DDA`, Commerce: `#61C754`

**`tags` (since v1.10)** — Optional `string[]` rendered as right-aligned pills in the header (after the title). Primary use case is the Team variant in Org Chart diagrams; available on every Container regardless of diagram type. Empty / unset arrays render nothing. Overflow on the left side is replaced by a `+N` chip with hover tooltip listing the dropped tags.

**`raci` (since v1.10)** — Optional `{ R?, A?, C?, I? }` of booleans. Renders coloured pills in the top-right corner of the header (white-outlined for contrast against the coloured accent bar). Same colour mapping and tooltip behaviour as `sf.OrgPerson.raci`.

### sf.Zone

Background grouping area with dashed border. Always renders behind other elements.

**Default size:** `400 x 300`

```json
{
  "id": "zone-1",
  "type": "sf.Zone",
  "position": { "x": 30, "y": 30 },
  "size": { "width": 400, "height": 300 },
  "z": 0,
  "attrs": {
    "body": {
      "width": "calc(w)", "height": "calc(h)",
      "rx": 8, "ry": 8,
      "fill": "rgba(29, 115, 201, 0.05)",
      "stroke": "#1D73C9", "strokeWidth": 1,
      "strokeDasharray": "8 4"
    },
    "label": {
      "x": 10, "y": 16,
      "textAnchor": "start", "textVerticalAnchor": "middle",
      "fontSize": 11,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "var(--text-muted)", "fontWeight": "600",
      "text": "Zone Name",
      "textWrap": { "width": "calc(w - 24)", "maxLineCount": 1, "ellipsis": true }
    }
  }
}
```

No ports. Use Zones purely as visual grouping backgrounds.

### sf.TextLabel

Standalone text annotation with no background or border.

**Default size:** `200 x 32`

```json
{
  "id": "label-1",
  "type": "sf.TextLabel",
  "position": { "x": 100, "y": 50 },
  "size": { "width": 200, "height": 32 },
  "z": 2000,
  "attrs": {
    "label": {
      "x": "calc(0.5 * w)", "y": "calc(0.5 * h)",
      "textAnchor": "middle", "textVerticalAnchor": "middle",
      "fontSize": 16,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "var(--text-primary)", "fontWeight": "600",
      "text": "Section Title"
    }
  }
}
```

No ports.

### sf.Note

Post-it style sticky note.

**Default size:** `200 x 120`

```json
{
  "id": "note-1",
  "type": "sf.Note",
  "position": { "x": 500, "y": 50 },
  "size": { "width": 200, "height": 120 },
  "z": 2000,
  "attrs": {
    "body": {
      "d": "M 0 0 L calc(w - 14) 0 L calc(w) 14 L calc(w) calc(h) L 0 calc(h) Z",
      "fill": "#FFF9C4", "stroke": "#E8D44D", "strokeWidth": 1, "strokeLinejoin": "round"
    },
    "fold": {
      "d": "M calc(w - 14) 0 L calc(w - 14) 14 L calc(w) 14 Z",
      "fill": "#EDD56A", "stroke": "#E8D44D", "strokeWidth": 1, "strokeLinejoin": "round"
    },
    "icon": { "x": 10, "y": 10, "width": 20, "height": 20, "href": "" },
    "label": {
      "x": 36, "y": 14,
      "textAnchor": "start", "textVerticalAnchor": "top",
      "fontSize": 13, "fontWeight": 600,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "#5D4037",
      "text": "Note Title",
      "textWrap": { "width": "calc(w - 48)", "maxLineCount": 1, "ellipsis": true }
    },
    "subtitle": {
      "x": 12, "y": 38,
      "textAnchor": "start", "textVerticalAnchor": "top",
      "fontSize": 11,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "#795548",
      "text": "Note body text goes here",
      "textWrap": { "width": "calc(w - 24)", "height": "calc(h - 48)", "ellipsis": true }
    }
  }
}
```

No ports.

### sf.Image (since v1.9)

Raster image embedded directly into the diagram via a `data:` URI. Available in every diagram type's "Generic Shapes" stencil group.

**Default size:** `240 x 180` (aspect-ratio-aware, displayed up to 320 px on the long edge after upload)

```json
{
  "id": "image-1",
  "type": "sf.Image",
  "position": { "x": 100, "y": 100 },
  "size": { "width": 240, "height": 180 },
  "z": 1500,
  "attrs": {
    "body": {
      "x": 0, "y": 0,
      "width": "calc(w)", "height": "calc(h)",
      "fill": "transparent",
      "stroke": "var(--node-border)",
      "strokeWidth": 1,
      "rx": 8, "ry": 8
    },
    "image": {
      "x": 0, "y": 0,
      "width": "calc(w)", "height": "calc(h)",
      "href": "data:image/webp;base64,UklGRiIAAABXRUJQVlA4...",
      "preserveAspectRatio": "xMidYMid meet",
      "style": "clip-path:inset(0 round 8px);-webkit-clip-path:inset(0 round 8px)"
    }
  }
}
```

**Tips:**
- The `image/href` is a `data:` URI. Uploads from the property panel are auto-resized to max 1280 px on the long edge and re-encoded as WEBP at quality 0.85 (PNG fallback in browsers without WEBP encoding).
- SVG uploads are rejected (security: SVG can carry scripts). Allowed input formats: PNG, JPG, WEBP, GIF.
- The `image/style` clip-path keeps the rendered raster inside the rounded body; if you change `body/rx` and `body/ry`, change the `inset(0 round Npx)` value to match.
- **URL sharing is disabled when any `sf.Image` cell is in the active tab.** Image bytes blow past every messaging-app URL-length limit; the Save → Share-as-URL menu item disables itself reactively. Use Save → Export to JSON to share image-laden diagrams.

No ports.

### sf.Line

Decorative horizontal line separator with an optional caption. Available in all diagram types.

**Default size:** `200 x 8`

```json
{
  "id": "line-1",
  "type": "sf.Line",
  "position": { "x": 100, "y": 300 },
  "size": { "width": 200, "height": 8 },
  "z": 2000,
  "lineStyle": "solid",
  "attrs": {
    "hitArea": {
      "width": "calc(w)", "height": "calc(h)",
      "fill": "transparent", "stroke": "none"
    },
    "line": {
      "x1": 0, "y1": "calc(0.5 * h)", "x2": "calc(w)", "y2": "calc(0.5 * h)",
      "stroke": "var(--text-muted)", "strokeWidth": 2, "strokeLinecap": "round"
    },
    "label": {
      "text": "", "fontSize": 13,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "var(--text-secondary)"
    }
  }
}
```

**`attrs.label.text`** (since v1.14.0) — optional caption rendered above the line's left edge, left-aligned. Empty by default. Supports the same inline markdown as Notes (`**bold**`, `*italic*`, `~~strike~~`, `` `code` ``); underscores are literal (not italic). When set it paints via a `<foreignObject>`, and a transparent hit rect sized to the caption makes it clickable/selectable.

**`lineStyle`** — `"solid"` (default), `"dashed"`, `"dotted"`, or `"breaks"`. Controls `strokeDasharray`:
- `solid` → `none`
- `dashed` → `12 6`
- `dotted` → `0 6` (round dots; was `3 4` before v1.14.0)
- `breaks` → `16 8` (long dashes; was `16 8 2 8` before v1.14.0)

Diagrams saved before v1.14.0 with the legacy `3 4` / `16 8 2 8` values are auto-migrated to `0 6` / `16 8` on load.

No ports.

### sf.Link

Clickable external-link element with a terminator (pill) shape: label + external-link icon. Clicking the right end of the element (where the icon sits) opens `url` in a new tab. Available in all diagram types.

**Default size:** `220 x 44`

```json
{
  "id": "link-1",
  "type": "sf.Link",
  "position": { "x": 100, "y": 300 },
  "size": { "width": 220, "height": 44 },
  "z": 2000,
  "url": "https://example.com",
  "attrs": {
    "body": {
      "x": 0, "y": 0, "width": "calc(w)", "height": "calc(h)",
      "rx": "calc(0.5 * h)", "ry": "calc(0.5 * h)",
      "fill": "var(--card-bg, #FFFFFF)",
      "stroke": "var(--border-muted, #D0D5DD)", "strokeWidth": 1
    },
    "label": {
      "x": 20, "y": "calc(0.5 * h - 8)",
      "textAnchor": "start", "textVerticalAnchor": "middle",
      "fontSize": 14, "fontWeight": 600,
      "fill": "#1D73C9",
      "text": "API Docs"
    },
    "domain": {
      "x": 20, "y": "calc(0.5 * h + 10)",
      "textAnchor": "start", "textVerticalAnchor": "middle",
      "fontSize": 10, "fill": "var(--text-muted, #6B7280)",
      "text": "example.com"
    },
    "iconImage": {
      "x": "calc(w - 34)", "y": "calc(0.5 * h - 10)",
      "width": 20, "height": 20,
      "pointerEvents": "none",
      "href": "data:image/svg+xml,..."
    },
    "iconHit": {
      "x": "calc(w - 40)", "y": "calc(0.5 * h - 16)",
      "width": 32, "height": 32,
      "rx": 16, "ry": 16,
      "fill": "transparent",
      "stroke": "var(--border-muted, #D0D5DD)", "strokeWidth": 1
    }
  }
}
```

**`url`** — Target URL. Opened in a new tab (`noopener,noreferrer`) when the icon is clicked. Empty string disables click-through.

**`attrs.domain.text`** — optional hostname shown as a small second line under the label (the app auto-fills it from `url` on drop). When present, `label.y` shifts up to `calc(0.5 * h - 8)` to make room (as above); for a single-line link with no domain, use `label.y: "calc(0.5 * h)"` and omit `domain`.

No ports.

### sf.DataObject

Database table / Salesforce object with coloured header and dynamic field rows. Used in data model diagrams.

**Default size:** `260 x 80` (height auto-adjusts: 32px header + 22px per field + 4px padding)

```json
{
  "id": "obj-1",
  "type": "sf.DataObject",
  "position": { "x": 100, "y": 100 },
  "size": { "width": 260, "height": 128 },
  "z": 2000,
  "objectName": "Account",
  "headerColor": "#1D73C9",
  "fields": [
    { "label": "Id", "apiName": "Id", "type": "ID", "keyType": "pk", "length": null, "required": false, "deprecated": false },
    { "label": "Name", "apiName": "Name", "type": "Text", "keyType": null, "length": 255, "required": true, "deprecated": false },
    { "label": "Industry", "apiName": "Industry", "type": "Picklist", "keyType": null, "length": null, "required": false, "deprecated": false },
    { "label": "Owner", "apiName": "OwnerId", "type": "Lookup", "keyType": "fk", "length": null, "required": true, "deprecated": false }
  ],
  "showLabels": false,
  "showFieldLengths": false,
  "keyFieldsOnly": false,
  "attrs": {
    "body": {
      "width": "calc(w)", "height": "calc(h)",
      "rx": 4, "ry": 4,
      "fill": "var(--node-bg)", "stroke": "var(--node-border)", "strokeWidth": 1
    },
    "header": {
      "width": "calc(w)", "height": 32,
      "rx": 4, "ry": 4,
      "fill": "#1D73C9", "stroke": "none"
    },
    "headerCover": {
      "width": "calc(w)", "height": 16, "y": 16,
      "fill": "#1D73C9", "stroke": "none"
    },
    "headerIcon": {
      "x": 10, "y": 8, "width": 16, "height": 16,
      "href": "data:image/svg+xml,<svg data-icon-id=\"account\"/>",
      "preserveAspectRatio": "xMidYMid meet"
    },
    "headerLabel": {
      "x": 32, "y": 16,
      "textAnchor": "start", "textVerticalAnchor": "middle",
      "fontSize": 13, "fontWeight": "bold",
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "#FFFFFF",
      "text": "Account"
    }
  }
  // NOTE: no "ports" block — you can omit it entirely on a DataObject (v1.15.5). The app
  // supplies the object ports (port-top / port-bottom), the header relationship anchors, AND
  // one mapping port per field automatically. Just REFERENCE the ports you need from links
  // (field-left-<fid> / field-right-<fid>) — see "Linking DataObjects" below.
}
```

**Field object structure:**

| Field | Type | Description |
|-------|------|-------------|
| `label` | string | Display name |
| `apiName` | string | API/column name (shown in the field row) |
| `type` | string | Data type (e.g., `"Text"`, `"Number"`, `"Lookup"`, `"ID"`, `"Picklist"`, `"Date"`, `"Boolean"`, `"Currency"`, `"Formula"`) |
| `keyType` | `"pk"` / `"fk"` / `"fqk"` / `null` | Key marker badge — Primary key (amber), Foreign key (blue), or **Fully Qualified Key** (`"fqk"`, **brand red** — Data Cloud, v1.15.0). Cycled None → PK → FK → FQK in the field editor. Setting `"pk"` or `"fqk"` auto-sets `required: true` (a key is inherently mandatory). Any non-null `keyType` also forces the field's left/right mapping ports to render. |
| `length` | number / null | Field length (shown if `showFieldLengths` is true) |
| `required` | boolean | Shows asterisk if true. Auto-set `true` for a PK/FQK field. |
| `deprecated` | boolean | Strikes through the field if true. *(Formerly `decommissioned`; loaders migrate the old key to `deprecated` on load.)* |
| `sampleValues` | string | Optional representative example value(s), e.g. `"jane@example.com, john@acme.com"`. **Display/export-only** — surfaced in the field editor, the Data Mapping table view (Source/Target **Sample Values** columns) and CSV exports; **never drawn on the node**. Omit when blank. (v1.15.7) |
| `fid` | string | Stable per-field identity (e.g. `"f3k9x2a"`), auto-generated; field-level port IDs derive from it. Survives reorder / delete / rename so connected links stay anchored. Present in saves ≥ v1.15.0; generators MAY omit it (the app assigns one on load, and older saves are migrated). |

**Display flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `showLabels` | `false` | Show the human-readable `label` alongside `apiName` in each row |
| `showFieldLengths` | `false` | Show `(length)` suffix next to the type |
| `keyFieldsOnly` | `false` | When `true`, only fields with `keyType` (PK/FK) are rendered; the object height shrinks to fit |
| `collapsed` | `false` | When `true`, the object renders **header-only** (all field rows hidden, height = `32 + 18`); a bottom toggle row flips it. Mapping links converge to the header while collapsed. Top-level prop; omit it for a normal expanded object. |

**Data Cloud metadata (mapping mode, v1.15.0):** an optional object-level attribute, omitted when blank. Editable in the DataObject panel's **Data Mapping** section (a three-position segmented slider) only when the diagram's mapping mode is on; it renders (as a hollow header pill) and round-trips regardless of mode.

| Attr | Type | Description |
|------|------|-------------|
| `category` | `"Profile"` / `"Engagement"` / `"Other"` | Data Cloud DMO category (platform-enforced). The one object-level mapping attribute. |

> Pre-release v1.15.0 iterations also carried `dataSource` (Origin System) and `kind` (Pipeline Tier) free-text attributes; both were removed before release. Loaders ignore them harmlessly if an older draft still has them. Object role/tier is expressed via Zone / Container grouping instead.

**Optional header icon (`headerIcon/href`, v1.15.0):** an optional contextual SLDS / custom icon in the header bar (e.g. `account`, `contact`, `email`, `custom-snowflake` - bare SLDS names or `custom-*` brand logos, NOT a `standard-` prefix; see the [Icon ID reference](#icon-id-reference)) to make a large schema scannable at a glance — empty by default. Uses the **same `data-icon-id` data-URI pattern** as the Node `icon/href` (above) and resolves to white via `refreshAllIconHrefs`. When set, the icon renders at `16×16` on the header's left (`x:10, y:8`) and `headerLabel/x` shifts to `32`; when blank, `headerIcon` collapses to `width/height:0` and `headerLabel/x` returns to `12`. `updateDataObjectHeaderLayout` applies this on edit + on load. Persists in `attrs.headerIcon.href`; no separate top-level prop.

**Sizing rule:** Set height to `32 + (max(visibleFields, 1) * 22) + 18` — that's `HEADER (32) + rows·ROW (22) + the collapse-toggle row (18)`. The custom view auto-renders the field rows **and** the bottom toggle row. `visibleFields` equals `fields.length` unless `keyFieldsOnly` is `true` (only `keyType` fields counted) or `collapsed` is `true` (zero rows → height `32 + 18 = 50`). If you get the height slightly wrong the app self-heals it on load (`migrateNodes` recomputes every DataObject to this formula), but emitting it correctly avoids a one-frame reflow.

**Linking DataObjects for ER diagrams:**

> **Omit the `ports` block — don't emit it at all (v1.15.5).** The shape definition already
> carries every port *group*, and the app generates the actual ports on load: `port-top` /
> `port-bottom` (object-level), the header relationship anchors, and **one mapping port per
> field**. So you never write the verbose `ports` boilerplate (it was ~40 lines of identical
> JSON per object and a frequent source of mistakes) — you only **reference** the ports you need
> from links. Listing them is harmless (older exports do) but pure noise.

Two port conventions to **reference** from link endpoints:

1. **Object-level ports (`port-top`, `port-bottom`)** — for "this table relates to that table" links.
2. **Field-level ports (`field-left-{fid}`, `field-right-{fid}`)** — for field→field mappings and PK→FK relationships. The view renders one for every field with a `keyType`, **every field when the diagram's mapping mode is on** (so all of `datamapping`), and any field a live link points at. `{fid}` is the field's stable `fid` (see field table), **not** its array index, so a link stays anchored to the same field across reorder, delete, and rename. *(Saves ≤ v1.14.x used the zero-based array index, `field-left-{i}`; `migrateLinks` re-keys those to `fid` form on load.)*

Just reference them from link endpoints: `"source": { "id": "obj-contact", "port": "field-right-<fid>" }` — where `<fid>` is copied verbatim from a field in that object.

Apply ER markers (see Marker Types section) to represent cardinality.

### sf.OrgPerson

Person card for organisation charts with avatar circle and detail fields.

**Default size:** `280 x 90` (height auto-adjusts based on visible details + tag row)

```json
{
  "id": "person-1",
  "type": "sf.OrgPerson",
  "position": { "x": 100, "y": 100 },
  "size": { "width": 280, "height": 90 },
  "z": 2000,
  "personName": "Jane Smith",
  "jobTitle": "VP Engineering — Platform & Data",
  "details": [
    { "label": "Email", "value": "jane@example.com" },
    { "label": "Role", "value": "Leadership" },
    { "label": "Location", "value": "London" },
    { "label": "Company", "value": "Acme Corp" }
  ],
  "tags": ["leadership", "platform"],
  "raci": { "R": true, "A": true },
  "vacant": false,
  "imageUrl": "",
  "iconText": "JS",
  "email": "jane@example.com",
  "phone": "",
  "role": "Leadership",
  "stream": "",
  "location": "London",
  "company": "Acme Corp",
  "detailOrder": ["email", "phone", "role", "stream", "location", "company"],
  "attrs": {
    "body": {
      "width": "calc(w)", "height": "calc(h)",
      "rx": 8, "ry": 8,
      "fill": "var(--node-bg)", "stroke": "var(--node-border)", "strokeWidth": 1.5
    },
    "accentBar": {
      "width": "calc(w)", "height": 4, "rx": 8, "ry": 8,
      "fill": "#1D73C9", "stroke": "none"
    },
    "accentBarMask": {
      "width": "calc(w)", "height": 2, "y": 2,
      "fill": "#1D73C9", "stroke": "none"
    },
    "avatar": {
      "r": 34, "cx": 44, "cy": 48,
      "fill": "#1D73C9", "stroke": "var(--node-border)", "strokeWidth": 1
    },
    "avatarText": {
      "x": 44, "y": 48,
      "textAnchor": "middle", "dominantBaseline": "central",
      "fontSize": 18, "fontWeight": 700,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "#FFFFFF",
      "text": "JS"
    },
    "avatarImage": {
      "x": 10, "y": 14, "width": 68, "height": 68,
      "href": "", "opacity": 0
    },
    "nameLabel": {
      "x": 88, "y": 14,
      "textAnchor": "start", "dominantBaseline": "hanging",
      "fontSize": 13, "fontWeight": 700,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "var(--node-text)",
      "text": "Jane Smith"
    },
    "positionLabel": {
      "x": 88, "y": 30,
      "textAnchor": "start", "dominantBaseline": "hanging",
      "fontSize": 11,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "var(--text-secondary)",
      "text": "VP Engineering"
    },
    "detailsLabel": {
      "x": 88, "y": 46,
      "textAnchor": "start", "dominantBaseline": "hanging",
      "fontSize": 10,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "var(--text-muted)",
      "text": "Email: jane@example.com\nRole: Leadership\nLocation: London\nCompany: Acme Corp",
      "lineHeight": 14
    }
  },
  "ports": { /* standard 4-port config */ }
}
```

**Tips:**
- Set `iconText` to 1-4 characters for the avatar circle (typically initials).
- Set `avatar/fill` to match `accentBar/fill` for a cohesive look.
- Height auto-adjusts: ~60 px base + ~14 px per visible detail row + 30 px when `tags` is non-empty.

**`details` (since v1.11)** — Extensible array of `{ label, value }` rows shown beneath the position label. The view renders one line per entry where `value` is non-empty; empty rows are hidden. Entries with `value === ""` are kept in the model so the user can fill them in later.

When loading a pre-v1.11 diagram, the view auto-migrates the legacy hardcoded fields (`email`, `phone`, `role`, `stream`, `location`, `company`) into `details` using `detailOrder` for the row order. The legacy fields stay on the cell so the JSON also opens cleanly in older versions.

**`tags` (since v1.10)** — Array of strings rendered as muted pills along the bottom of the card. Empty array hides the tag row entirely. If many tags would overflow the card width, the trailing ones are hidden behind a `+N` overflow chip whose hover tooltip shows the missing tags.

**`raci` (since v1.10)** — Object `{ R?, A?, C?, I? }` of booleans. Each truthy key renders a coloured pill in the top-right corner with the letter (R/A/C/I) and a tooltip for the full role name (Responsible / Accountable / Consulted / Informed). Multiple roles allowed simultaneously. Pill colours: R=brand blue (`#1D73C9`), A=brand red (`#DA4E55`), C=brand amber (`#F6B355`), I=neutral grey (`#8A9099`).

**`vacant` (since v1.10)** — When `true`, the card renders with dashed body border, dashed transparent avatar (no fill), and faded text/details (~55 % opacity). Use as a recruitment placeholder ("position to be filled") or to mark an unassigned RACI slot.

**Position field rename (since v1.10)** — The property panel label changed from "Position" to "Description". The underlying model field is still `jobTitle` for backward compatibility — pre-v1.10 diagrams keep working unchanged.

### sf.Task (since v1.10)

RACI workflow row for Org Chart diagrams. Two-column layout: left column holds the task name + description, right column captures embedded `sf.OrgPerson` and `sf.Container` (Team) cards as RACI assignees. Each embedded card carries its own RACI pills, so the Task itself does not duplicate R/A/C/I slots.

**Default size:** `540 x 160` (`descriptionWidth` defaults to 260 px)

```json
{
  "id": "task-1",
  "type": "sf.Task",
  "position": { "x": 600, "y": 100 },
  "size": { "width": 540, "height": 160 },
  "z": 500,
  "taskName": "Quarterly architecture review",
  "taskDescription": "Review platform changes and align on next quarter's roadmap.",
  "descriptionWidth": 260,
  "embeds": ["person-1", "team-1"],
  "attrs": {
    "body": {
      "x": 0, "y": 0,
      "width": "calc(w)", "height": "calc(h)",
      "rx": 8, "ry": 8,
      "fill": "var(--node-bg)", "stroke": "var(--node-border)", "strokeWidth": 1.5
    },
    "rightBg": {
      "x": 260, "y": 1,
      "width": "calc(w - 261)", "height": "calc(h - 2)",
      "rx": 7, "ry": 7,
      "fill": "rgba(127, 127, 127, 0.04)", "stroke": "none"
    },
    "divider": {
      "x1": 260, "y1": 12,
      "x2": 260, "y2": "calc(h - 12)",
      "stroke": "var(--node-border)", "strokeWidth": 1
    },
    "nameLabel": {
      "x": 16, "y": 16,
      "textAnchor": "start", "textVerticalAnchor": "top",
      "fontSize": 14, "fontWeight": 700,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "var(--node-text)",
      "text": "Quarterly architecture review",
      "textWrap": { "width": 232, "maxLineCount": 3, "ellipsis": true }
    },
    "descLabel": {
      "x": 16, "y": 60,
      "textAnchor": "start", "textVerticalAnchor": "top",
      "fontSize": 11,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "var(--text-secondary)",
      "text": "Review platform changes and align on next quarter's roadmap.",
      "textWrap": { "width": 232, "maxLineCount": 8, "ellipsis": true }
    }
  }
}
```

**Tips:**
- `descriptionWidth` controls the LEFT column. The right column absorbs any size changes when the task is resized — left column stays at this width unless the user explicitly edits it.
- `nameLabel` and `descLabel` `textWrap.width` should equal `descriptionWidth - 28` (padding accommodation). The view recomputes these automatically when `descriptionWidth` or `size` changes.
- Embedded Person/Team cards are **tucked into the right column** on capture (clamped past the divider), keeping the left label/description column clear. The card grows right + down to hold the roster (top-left + left column stay put), floored at the 540×160 default.
- Task `z` lives in the `Z_BASE` "containers" tier (`500`) — intentionally below Container/Team (1000) and OrgPerson (2000) so embedded cards always render above the Task body. (Older saves at `z:900` are still in-tier and load fine.)

Standard 4 ports (top, right, bottom, left) — use them to link Tasks to other tasks or deliverables.

### sf.TaskGroup (since v1.15)

RACI **section** for Org Chart diagrams — a dashed grouping frame (grey accent, Zone-like) that holds multiple `sf.Task` cards so related RACI rows can be organised into labelled sections. Its only valid embedded child is `sf.Task` (the Tasks carry their own Person/Team assignees). Sits in the `Z_BASE` "backgrounds" tier (`z:0`, same as Zone) so it always renders behind its Tasks. Top-level only — it is not embeddable in a Department/Team/another Task Group.

**Default size:** `640 x 360`

```json
{
  "id": "taskgroup-1",
  "type": "sf.TaskGroup",
  "position": { "x": 80, "y": 80 },
  "size": { "width": 640, "height": 360 },
  "z": 0,
  "embeds": ["task-1", "task-2"],
  "attrs": {
    "body": {
      "width": "calc(w)", "height": "calc(h)",
      "rx": 8, "ry": 8,
      "fill": "rgba(138, 144, 153, 0.06)", "stroke": "#8A9099",
      "strokeWidth": 1, "strokeDasharray": "8 4"
    },
    "label": {
      "x": 12, "y": 18,
      "textAnchor": "start", "textVerticalAnchor": "middle",
      "fontSize": 12, "fontWeight": "700",
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "var(--text-muted)",
      "text": "Onboarding workstream",
      "textWrap": { "width": "calc(w - 28)", "maxLineCount": 1, "ellipsis": true }
    }
  }
}
```

No ports — it is a grouping frame, not a connectable node. Dropped Tasks tuck below the ~28 px top label band; the frame auto-fits to its Tasks like any free-form container.

### BPMN Shapes (Process Diagrams)

#### sf.BpmnEvent

Circle event node.

**Default size:** `40 x 40`

```json
{
  "id": "start-1",
  "type": "sf.BpmnEvent",
  "position": { "x": 100, "y": 200 },
  "size": { "width": 40, "height": 40 },
  "z": 2000,
  "eventType": "start",
  "attrs": {
    "body": {
      "cx": "calc(0.5 * w)", "cy": "calc(0.5 * h)", "r": "calc(0.5 * w)",
      "fill": "#FFFFFF", "stroke": "#222222", "strokeWidth": 2
    },
    "innerRing": {
      "cx": "calc(0.5 * w)", "cy": "calc(0.5 * h)", "r": "calc(0.5 * w - 3)",
      "fill": "none", "stroke": "none", "strokeWidth": 1
    },
    "icon": {
      "d": "", "fill": "#222222", "stroke": "none",
      "transform": "translate(calc(0.5 * w - 6), calc(0.5 * h - 6))"
    },
    "label": {
      "x": "calc(0.5 * w)", "y": "calc(h + 10)",
      "textAnchor": "middle", "textVerticalAnchor": "top",
      "fontSize": 11,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "var(--text-secondary)",
      "text": "Start"
    }
  },
  "ports": { /* standard 4-port config */ }
}
```

**Event types:**
- `"start"` — thin border (`strokeWidth: 2`)
- `"intermediate"` — double ring (set `innerRing/stroke` to `"#222222"`)
- `"end"` — thick border (`strokeWidth: 3`)

#### sf.BpmnTask

Rounded rectangle activity.

**Default size:** `120 x 60`

```json
{
  "id": "task-1",
  "type": "sf.BpmnTask",
  "position": { "x": 200, "y": 185 },
  "size": { "width": 120, "height": 60 },
  "z": 2000,
  "taskType": "task",
  "attrs": {
    "body": {
      "width": "calc(w)", "height": "calc(h)",
      "rx": 8, "ry": 8,
      "fill": "#FFFFFF", "stroke": "#222222", "strokeWidth": 1.5
    },
    "taskIcon": { "x": 6, "y": 6, "width": 14, "height": 14, "href": "" },
    "label": {
      "x": "calc(0.5 * w)", "y": "calc(0.5 * h)",
      "textAnchor": "middle", "textVerticalAnchor": "middle",
      "fontSize": 12,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "#222222",
      "text": "Review Order",
      "textWrap": { "width": "calc(w - 16)", "maxLineCount": 4, "ellipsis": true }
    }
  },
  "ports": { /* standard 4-port config */ }
}
```

**Task types:** `"task"`, `"user"`, `"service"`, `"script"`, `"send"`, `"receive"`

#### sf.BpmnGateway

Diamond decision/merge node.

**Default size:** `48 x 48`

```json
{
  "id": "gw-1",
  "type": "sf.BpmnGateway",
  "position": { "x": 380, "y": 191 },
  "size": { "width": 48, "height": 48 },
  "z": 2000,
  "gatewayType": "exclusive",
  "attrs": {
    "body": {
      "d": "M calc(0.5 * w) 0 L calc(w) calc(0.5 * h) L calc(0.5 * w) calc(h) L 0 calc(0.5 * h) Z",
      "fill": "#FFFFFF", "stroke": "#222222", "strokeWidth": 1.5
    },
    "marker": {
      "x": "calc(0.5 * w)", "y": "calc(0.5 * h)",
      "textAnchor": "middle", "textVerticalAnchor": "middle",
      "fontSize": 22, "fontWeight": "bold",
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "#222222",
      "text": "\u00d7"
    },
    "label": {
      "x": "calc(0.5 * w)", "y": "calc(h + 10)",
      "textAnchor": "middle", "textVerticalAnchor": "top",
      "fontSize": 11,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "var(--text-secondary)",
      "text": ""
    }
  },
  "ports": { /* standard 4-port config */ }
}
```

**Gateway marker symbols:**
- `"exclusive"`: `"\u00d7"` (multiplication sign)
- `"parallel"`: `"+"`
- `"inclusive"`: `"\u25cb"` (circle)
- `"event"`: `"\u25c7"` (diamond)

#### sf.BpmnSubprocess

Rounded rectangle container with [+] marker.

**Default size:** `360 x 240`, **z:** `500`

Same pattern as Container but with `expandMarker` rect and `expandPlus` text at the bottom.

#### sf.BpmnLoop

Rounded-rectangle container identical in size to `sf.BpmnSubprocess`, but marked with a loop glyph instead of the `[+]` expand marker — use it for a looped / iterating sub-process.

**Default size:** `360 x 240`, **z:** `500`

Same `body` as Container/Subprocess, with a single-line top-left `label` (default `"Loop"`) and a `loopIcon` (`<use href="#refresh">`) centred at the bottom edge instead of Subprocess's `expandMarker` + `expandPlus`. Standard 4-port configuration.

```json
{
  "id": "loop-1",
  "type": "sf.BpmnLoop",
  "position": { "x": 100, "y": 100 },
  "size": { "width": 360, "height": 240 },
  "z": 500,
  "attrs": { "label": { "text": "Process Each Order" } },
  "ports": { /* standard 4-port config (top/right/bottom/left) — see Port Definitions */ }
}
```

#### sf.BpmnPool

Horizontal pool/lane container.

**Default size:** `600 x 250`, **z:** `0`

Has a narrow left `header` panel with rotated vertical label. No ports.

#### sf.BpmnDataObject

Small folded-corner document artifact representing a BPMN data object. Available in the Process diagram's stencil; the label sits **below** the shape.

**Default size:** `40 x 50`, **z:** `2000`

`body` is a folded-corner `path` with a `fold` triangle at the top-right; the `label` text is positioned beneath the shape (`y: calc(h + 10)`, default `"Data"`). Standard 4-port configuration.

```json
{
  "id": "data-1",
  "type": "sf.BpmnDataObject",
  "position": { "x": 100, "y": 100 },
  "size": { "width": 40, "height": 50 },
  "z": 2000,
  "attrs": { "label": { "text": "Invoice" } },
  "ports": { /* standard 4-port config (top/right/bottom/left) — see Port Definitions */ }
}
```

### Flowchart Shapes

All flowchart shapes follow the same simple pattern — a `body` path/rect and a `label` text. Default size is `120 x 60` for most.

| Shape | Body | Default Size |
|-------|------|-------------|
| `sf.FlowProcess` | Rectangle | 120 x 60 |
| `sf.FlowDecision` | Diamond | 120 x 80 |
| `sf.FlowTerminator` | Pill/stadium (rx = half height) | 120 x 60 |
| `sf.FlowDatabase` | Cylinder | 80 x 60 |
| `sf.FlowDocument` | Rectangle with wavy bottom | 120 x 60 |
| `sf.FlowIO` | Parallelogram | 140 x 60 |
| `sf.FlowPredefined` | Rectangle with double vertical bars | 120 x 60 |
| `sf.FlowOffPage` | Pentagon pointing down | 60 x 60 |
| `sf.Annotation` | Text with curly bracket | 100 x 120 |

All have standard 4-port configuration.

### sf.Annotation

A curly-brace bracket with a text label — used to call out or group a region of a diagram. The brace spans the element's height on one side; the label sits beside it. Standard 4-port configuration.

**Default size:** `100 x 120`, **z:** `2000`

**Properties:**
- `bracketSide` — `"right"` (default) or `"left"`. Which side the curly brace is drawn on.

The caption is set via `attrs.label.text`. Since v1.14.0 the label **stays horizontal automatically**: if the element is rotated, the label counter-rotates so the text always reads level (there is no manual text-angle property).

```json
{
  "id": "anno-1",
  "type": "sf.Annotation",
  "position": { "x": 600, "y": 100 },
  "size": { "width": 100, "height": 120 },
  "z": 2000,
  "bracketSide": "right",
  "attrs": {
    "label": { "text": "Legacy systems" }
  },
  "ports": { /* standard 4-port config (top/right/bottom/left) — see Port Definitions */ }
}
```

### Gantt Shapes

> A Gantt chart is **authored as data**: describe the schedule (tasks with dates) and the app computes every pixel. A **`sf.GanttTimeline`** is the date-ruler backbone; each task is a **`sf.GanttTask`** bar embedded in it, **positioned and sized from its dates** — you do **not** set a bar's `position`/`size`/`progressBar` width (all derived on load). Add the timeline, then the bars.

#### sf.GanttTimeline

The date-ruler backbone: a header row of period columns (days / weeks / months) plus a left-hand panel. The panel's task rows are **derived from the `sf.GanttTask` bars** embedded in the timeline (the bars own the record). Optional **`groups`** define phase header rows that bars attach to via their `groupId`.

**Default size:** `960 x 48`, **z:** `1000` (container tier). No ports. The height auto-grows to fit its rows.

**Properties (all top-level, not under `attrs`):**
- `viewMode` — `"day"`, `"week"`, or `"month"` (column granularity). Default `"week"`.
- `numPeriods` — number of columns (default `12`; stencil presets: day `14`, week `12`, month `12`).
- `startDate` / `endDate` — `"YYYY-MM-DD"`. `endDate` auto-computes from `startDate` + `numPeriods` when blank (day → +N days, week → +N×7 days, month → +N months). The view snaps `startDate` to the configured `weekStartDay` (week) or the 1st (month). `startDate` is the **origin** every bar's dates are measured from.
- `todayDate` — `"YYYY-MM-DD"` (optional). Draws a full-height dashed **today line** at that date's column (omit / blank = no line). Data-first: the line's x is derived from the date.
- `weekStartDay` — `0`–`6` (0 = Sunday … 6 = Saturday), the first day of the week — controls where the **week** view splits its columns. Default `1` (Monday). The Display menu's "Week Starts:" control cycles the three practical conventions: Monday (ISO 8601), Sunday (Americas), Saturday (MENA).
- `weekendStartDay` — `6` (Saturday → Sat–Sun weekend) or `5` (Friday → Fri–Sat weekend). The first day of the 2-day weekend block shaded as non-working columns in the **day** view. Default `6` (Saturday). Cycled from the Display menu's "Weekend Starts:" control.
- `showWeekNumber` — `true`/`false`. When `true`, **week**-view columns are labelled `"W23"` (week number, counted relative to `weekStartDay`) instead of the week-start date (`"3 Apr"`). Default `false`. Toggled from the Display menu's "Week Numbers".
- `showProjectSummary` — `true`/`false`. When `true`, a read-only **Project Summary** lane is drawn at the top of the timeline (between the date header and the first row): a single overview row condensing every group summary bar (in its group colour), milestone (diamond), and day marker (triangle) for the timeline. Adds one lane-height to the header, so the task rows shift down. Default `false`. Toggled from the Display menu's "Project Summary Row" (gantt only).
- `groups` — optional array of `{ id, label, color, order }` phase headers. A `sf.GanttTask` joins one via its `groupId`; the group header takes a panel row above its bars. Omit for a flat (ungrouped) plan.
- `taskListWidth` — width (px) of the left panel (default `200`).
- `rowHeight` — height (px) per row (default / min `48`).
- `timelineTitle` / `timelineDescription` — header text for the panel (default `"Tasks"` / `""`).

> **Legacy:** a `tasks` array (`{ id, type:"group"|"task", label, groupId?, color? }`) from older diagrams is still accepted and **auto-migrated to bars + `groups` on load** — do **not** emit it for new diagrams; create `sf.GanttTask` bars instead.

```json
{
  "id": "timeline-1",
  "type": "sf.GanttTimeline",
  "position": { "x": 80, "y": 80 },
  "size": { "width": 960, "height": 48 },
  "z": 1000,
  "viewMode": "week",
  "numPeriods": 12,
  "startDate": "2026-06-01",
  "endDate": "2026-08-24",
  "taskListWidth": 200,
  "rowHeight": 48,
  "timelineTitle": "Tasks",
  "groups": [
    { "id": "g1", "label": "Phase 1", "color": "#1D73C9", "order": 0 }
  ],
  "embeds": ["t1"]
}
```

#### sf.GanttTask

A scheduled bar. **The dates are the source of truth** — `startDate`/`endDate` set the bar's column position and width, `order` sets its row, and `groupId` attaches it to a timeline group. The app **derives** `position`, `size`, the progress-bar width, ports, and the label `attrs` on load, so you only emit the data fields below. Embed the bar in the timeline via `parent` (and list it in the timeline's `embeds`); in a single-timeline diagram the bar binds to that sole timeline even without `parent`.

**Default size:** `240 x 32` (derived from the dates). **z:** `2000`.

**Properties (top-level):**
- `taskLabel` — the bar's label.
- `startDate` / `endDate` — `"YYYY-MM-DD"`. Position + width derive from these against the timeline's axis.
- `order` — integer row slot (0-based). The bar's Y derives from it; any group headers above it shift it down a row. **Emit it** — an `order`less bar keeps its manual Y while the panel rows it last, so it paints in the wrong row (an old diagram, or one built by dropping stencil tasks, is auto-healed on load: `order` is back-filled from each bar's current Y order).
- `groupId` — id of a `timeline.groups[]` entry, or omit / `null` for ungrouped.
- `progress` — `0`–`100` (fills the progress bar).
- `assignee` — short initials shown on the bar (optional).

```json
{
  "id": "t1",
  "type": "sf.GanttTask",
  "taskLabel": "Discovery",
  "startDate": "2026-06-01",
  "endDate": "2026-06-22",
  "order": 0,
  "groupId": "g1",
  "progress": 40,
  "assignee": "JS",
  "parent": "timeline-1"
}
```

> The verbose pre-derived form (explicit `position` / `size` / `attrs` / `ports` / `progressBar` width) is still accepted for back-compat, but you never need to emit it — set the dates and the app lays the bar out.

#### sf.GanttMilestone

A diamond marker for a point-in-time event. **`milestoneDate` is the source of truth for its column** — the diamond's centre sits on that date, exactly like a bar's `startDate`/`endDate` drive its position. The app **derives** the x from the date on load (and re-derives it whenever the date or the timeline's axis changes), so you don't emit `position.x`. The **y** (which row the diamond sits on) is taken from `position.y` — set it to a task's row. Embed it in the timeline via `parent` (and list it in the timeline's `embeds`); in a single-timeline diagram it binds to that sole timeline even without `parent`.

**Default size:** `24 x 24`. **z:** `2000`.

**Properties (top-level):**
- `milestoneDate` — `"YYYY-MM-DD"`. The diamond's column derives from it against the timeline's axis (`position.x` is ignored / overwritten).
- `position.y` — the canvas Y the diamond sits at (pick a task row); `position.x` is set from the date.
- `attrs.label.text` — the caption shown above the diamond.

```json
{
  "id": "milestone-1",
  "type": "sf.GanttMilestone",
  "milestoneDate": "2026-03-01",
  "position": { "x": 0, "y": 160 },
  "parent": "timeline-1",
  "attrs": { "label": { "text": "Launch" } }
}
```

> The verbose pre-derived form (explicit `size` / full `body` + `label` `attrs` / `ports`) is still accepted for back-compat, but you never need to emit it — set `milestoneDate` and the app places the diamond. A milestone with NO `milestoneDate` keeps its manual `position.x` and is back-filled with the date that x implies on load, so old diagrams gain real milestone data without moving.

#### sf.GanttGroup

A summary / parent bar with bracket indicators. Set **`groupId`** to one of the timeline's `groups[]` ids and it **AUTO-SPANS that group's tasks** (x+width derive from the earliest task's left to the latest task's right; do not set `position.x`/`size` — Y is the manual row). It re-spans whenever a member task's dates or membership change. Omit `groupId` for a free-floating manual bar (back-compat). **Grouping tasks in the left panel is still the timeline's `groups` array + each `sf.GanttTask`'s `groupId`** (see `sf.GanttTimeline`); a `sf.GanttGroup` shape is the optional *visual* summary of one of those groups.

**Default size:** `360 x 24`, **z:** `1000`

#### sf.GanttMarker (Day Marker)

A point-in-time **Day Marker** (triangle) — marks any day, not necessarily today. **Authored as data, like a milestone:** set **`markerDate`** (`"YYYY-MM-DD"`) and the triangle's x derives from the axis — do not set `position.x`/`size` (Y is the manual row). The marker shows its date as a small caption under the label, and draws a full-height dotted line at its column. A dropped marker seeds `markerDate` from its drop column (so it's dated + snapped immediately); a dateless one keeps its manual pixels and back-fills `markerDate` from them on load. For a chart-wide today indicator prefer the timeline's `todayDate` (a full-height line) below.

**Default size:** `20 x 16`

#### Gantt dependencies

A dependency between two tasks is a **`standard.Link`** tagged **`linkKind:"ganttDep"`**, drawn as a brand-amber arrow into the successor (a stub-free bézier — no boxy loops). Its `depType` + `lag` ARE the data the Table view + a future critical-path read (a `dependsOn` array is *derived* from these links, never authored). On load the app auto-heals the arrow + connector from `linkKind`, so you only set the kind + endpoints (+ optional `depType`/`lag`). Drawing ANY connector between two task bars on the canvas auto-tags it as a `ganttDep`.

**Properties (top-level on the link):**
- `linkKind` — `"ganttDep"`.
- `depType` — `"FS"` (finish→start, the default), `"SS"` (start→start), `"FF"` (finish→finish), or `"SF"` (start→finish).
- `lag` — integer days between the linked ends (negative = lead). Default `0`.
- `source` / `target` — `{ id, port }`. FS connects the predecessor's `port-right` to the successor's `port-left`; the other types use the matching left/right ends.

```json
{
  "type": "standard.Link",
  "linkKind": "ganttDep",
  "source": { "id": "t1", "port": "port-right" },
  "target": { "id": "t2", "port": "port-left" },
  "depType": "FS",
  "lag": 0
}
```

> Phase 3 records + renders the dependency; it does NOT auto-move the successor bar (auto-scheduling + a critical path are future). Keep the kinds distinct: `ganttDep` is a schedule dependency, not a Data Mapping (`mapping`) or ER relationship link.

---

### Sequence Shapes

Sequence diagrams model ordered interactions between participants across time. **Connect messages through lifeline ports** (not `topLeft` anchors): each lane exposes `lifelinePortCount` evenly-spaced port pairs (`seq-port-left-<i>` / `seq-port-right-<i>`), and messages reference those port IDs directly. Port-based connections stay aligned under future edits, are easy for a human to rewire in the UI, and work out-of-the-box with the **Display → Auto Layout** action.

**Layout conventions**

- Participants sit side-by-side at `y = 40`. Center-to-center spacing is typically `220`.
- Each lane (Participant, or Actor with `showLifeline: true`) carries `lifelinePortCount` port pairs along its lifeline. Pick a count ≥ the number of messages that lane will receive; `10` is a reasonable default for realistic diagrams.
- Messages are `standard.Link` instances whose `source` / `target` specify `{ id, port }` — e.g. `source.port: "seq-port-right-2"` on the left lane connects to `target.port: "seq-port-left-2"` on the right lane. The port index determines the vertical position of the message.
- Activation boxes (`sf.SequenceActivation`) overlay the lifeline between activate / deactivate points. They always use `z = 2200` so they render above the dashed lifeline but below message links.
- Fragment boxes (`sf.SequenceFragment`) use `z = 500` so they render behind participants and messages.

**Port alignment across lanes**

For same-index ports on different lanes to sit at the same canvas Y (so messages render as flat horizontal lines), three properties must match across every lane:

1. **Same `lifelinePortCount`** on every Participant and on every Actor with `showLifeline: true`.
2. **Same lifeline start Y.** Ports are laid out from the top of the lifeline, not the top of the element. For `sf.SequenceParticipant` the lifeline begins `48px` below `position.y` (header height). For `sf.SequenceActor` it begins `92px` below `position.y` (stick figure + label block). So an actor needs `position.y = participant.position.y - 44` to keep their lifelines at the same canvas Y.
3. **Same lifeline span.** `size.height - headerOffset - bottomOffset` must match. `headerOffset/bottomOffset` are `48/48` for Participant and `92/0` for Actor. With a target span `Sp`, set Participant height to `Sp + 96` and Actor height to `Sp + 92`.

The port Y formula is `lifelineStart + ((i + 1) / (portCount + 1)) * lifelineSpan` in canvas coordinates, so aligning those three values gives pixel-perfect parallel connectors at every index.

The **Display → Auto Layout** action does this automatically: it picks the largest existing port count, the median lifeline start Y, and the largest lifeline span, then repositions/resizes every lane and rebuilds its ports with even spacing. If any lane has a different port count or custom `lifelinePortRatios` (and the diagram already has connectors), a confirmation modal lists those lanes so you can see which ones will have their ports regenerated before committing.

**Ports are rebuilt on import.** The load pipeline calls `rebuildSeqParticipantPorts` / `rebuildSeqActorPorts` using each cell's stored `lifelinePortCount` (and `showLifeline` for actors), so LLM-generated JSON only needs to set `lifelinePortCount` — you don't need to serialize the `ports.items` array.

#### sf.SequenceParticipant

A UML participant — a bordered header with an accent bar plus a dashed vertical lifeline. By default the header is mirrored at the foot of the lifeline so long interactions remain readable while scrolling. The mirror can be hidden by setting `showBottomLabel` to `false`.

**Default size:** `140 x 360`, **z:** `2000`

**Properties:**
- `participantRole` — `"generic"`, `"salesforce"`, `"api"`, or `"external"` (drives the accent-bar colour).
- `lifelinePortCount` — how many connectable points appear on each side of the lifeline (default `5`).
- `showBottomLabel` — boolean, default `true`. When `true`, `headerBottom`, `headerBottomAccent`, `labelBottom`, and `underlineBottom` are visible.

Only the **accent bar** is tinted by the role colour; the header border, underline and lifeline use the theme-aware default stroke so participants look consistent across roles.

| Role | Accent-bar colour |
|------|-------------------|
| `generic` | `#8A9099` |
| `salesforce` | `#2E844A` |
| `api` | `#1D73C9` |
| `external` | `#F6B355` |

```json
{
  "id": "part-sf",
  "type": "sf.SequenceParticipant",
  "position": { "x": 60, "y": 40 },
  "size": { "width": 140, "height": 520 },
  "z": 2000,
  "participantRole": "salesforce",
  "lifelinePortCount": 5,
  "showBottomLabel": true,
  "attrs": {
    "label":              { "text": "Salesforce" },
    "labelBottom":        { "text": "Salesforce" },
    "headerAccent":       { "fill": "#2E844A" },
    "headerBottomAccent": { "fill": "#2E844A" }
  },
  "ports": { /* seq-left / seq-right port groups generated by the shape */ }
}
```

#### sf.SequenceActor

Stick-figure actor with an optional dashed lifeline.

**Default size:** `100 x 92` (stick figure + label only), **z:** `2000`

**Properties:**
- `showLifeline` — boolean, default `false`. When `true`, the dashed lifeline and its ports appear and the element auto-resizes to `100 x 340`. When `false`, the actor renders as a compact stick-figure + label block.
- `lifelinePortCount` — how many connectable points appear on the lifeline when it is shown (default `5`).

The stick figure uses the theme-aware `var(--node-text)` stroke by default — no role accent. A manual "Stroke" colour can still be applied via the properties panel if users want to tint an individual actor.

```json
{
  "id": "part-user",
  "type": "sf.SequenceActor",
  "position": { "x": 80, "y": 40 },
  "size": { "width": 100, "height": 520 },
  "z": 2000,
  "participantRole": "actor",
  "showLifeline": true,
  "lifelinePortCount": 5,
  "attrs": {
    "label": { "text": "Customer" }
  }
}
```

#### sf.SequenceActivation

Narrow grey box overlaid on a participant's lifeline to show when that participant is "active" (executing). It carries its own `lifelinePortCount` (default `2`) `seq-left` / `seq-right` port pairs, so messages can attach directly to the active box instead of the bare lifeline.

**Default size:** `12 x 80`, **z:** `2200`

Position `x` must be `participantCenterX - 6` (the activation is centered on the lifeline). Height is the duration of the activation in Y pixels.

```json
{
  "id": "act-1",
  "type": "sf.SequenceActivation",
  "position": { "x": 124, "y": 140 },
  "size": { "width": 12, "height": 96 },
  "z": 2200,
  "lifelinePortCount": 2,
  "attrs": {
    "body": { "fill": "#D0D4D9", "stroke": "#8A9099", "strokeWidth": 1 }
  }
}
```

#### sf.SequenceFragment

UML fragment box with a trapezoidal label tab in the top-left corner. Wraps the messages inside the fragment.

**Default size:** `400 x 200`, **z:** `500`

**Properties:**
- `fragmentType` — **`"standard"` (default) or `"alternative"` — these are the only two values.** `standard` is a single-compartment frame (use it for loop / opt / par / critical / break). `alternative` is the UML `alt`: a dashed horizontal divider splits the frame into two compartments — for it to render you must *also* set the `dividerLine` and `elseText` attrs to `visibility: "visible"` (see example).
- `fragmentLabel` — the free-text keyword shown in the title tab (default `"loop"`). **This is where the operator name (`loop` / `alt` / `opt` / `par` / `critical` / `break`) actually goes** — NOT `fragmentType`. The tab text re-syncs from this prop on import.
- `condition` — top-compartment condition; the visible text lives in `attrs.conditionText.text` and is conventionally `[bracketed]`.
- `elseCondition` — bottom-compartment condition (alternative only); visible text lives in `attrs.elseText.text`.

For a single-compartment fragment (e.g. a loop), set `"fragmentType": "standard"`, `"fragmentLabel": "loop"`, and omit `elseCondition` plus the `dividerLine` / `elseText` attrs.

```json
{
  "id": "frag-1",
  "type": "sf.SequenceFragment",
  "position": { "x": 30, "y": 180 },
  "size": { "width": 400, "height": 200 },
  "z": 500,
  "fragmentType": "alternative",
  "fragmentLabel": "alt",
  "condition": "customer exists",
  "elseCondition": "customer not found",
  "attrs": {
    "body":          { "stroke": "#8A9099", "fill": "rgba(138,144,153,0.05)" },
    "titleText":     { "text": "alt" },
    "conditionText": { "text": "[customer exists]" },
    "dividerLine":   { "visibility": "visible" },
    "elseText":      { "text": "[customer not found]", "visibility": "visible" }
  }
}
```

### Sequence Message Links

Sequence messages are `standard.Link` instances that connect port-to-port between lanes. The **port index = message slot**: message #1 hooks into `seq-port-*-0` on both lanes, message #2 into `seq-port-*-1`, and so on. A "left-to-right" request leaves the source lane's `seq-port-right-<i>` and enters the target lane's `seq-port-left-<i>`; a reply goes the other way (`seq-port-left-<i>` → `seq-port-right-<i>`).

When a user draws an interactive link from a `seq-left` port to a `seq-right` port (the "right-to-left" UML reply direction), the app automatically sets `lineStyle: "6 4"` on the link. For generated JSON, set that property yourself on replies so they render dashed.

| Operator | `style` | `arrow` | Visual |
|----------|---------|---------|--------|
| Sync request | `"solid"` | `"solid"` | Solid line + filled arrow head |
| Sync response | `"dashed"` | `"solid"` | Dashed line + filled arrow head |
| Open request (legacy) | `"solid"` | `"open"` | Solid line + open V head |
| Open response (legacy) | `"dashed"` | `"open"` | Dashed line + open V head |
| Async (fire-and-forget) | `"solid"` | `"openAsync"` | Solid line + open V head |
| Async response | `"dashed"` | `"openAsync"` | Dashed line + open V head |
| Lost | either | `"lost"` | Line ending in an `X` |

```json
{
  "id": "msg-1",
  "type": "standard.Link",
  "z": 3000,
  "source": { "id": "part-sf",  "port": "seq-port-right-0" },
  "target": { "id": "part-api", "port": "seq-port-left-0" },
  "router":    { "name": "normal" },
  "connector": { "name": "normal" },
  "attrs": {
    "line": {
      "stroke": "#5E6B7A",
      "strokeWidth": 2,
      "sourceMarker": {
        "type": "path", "d": "M 0 0 L -6 0",
        "fill": "none", "stroke": "#5E6B7A", "stroke-width": 2
      },
      "targetMarker": {
        "type": "path", "d": "M 0 -6 L -14 0 L 0 6 z"
      }
    }
  },
  "labels": [
    { "position": { "distance": 0.5, "offset": -10 },
      "attrs": { "text": { "text": "getAccount()", "fontSize": 11, "fill": "var(--text-primary)" } } }
  ]
}
```

For a dashed response, set top-level `lineStyle` on the link to `"6 4"` (the app renders the dashes as a bg-coloured overlay so the arrow marker stays solid on Safari). Replies also typically swap direction: `source.port: "seq-port-left-<i>"` → `target.port: "seq-port-right-<i>"`.

For an async open arrow, replace `targetMarker.d` with `"M -14 -6 L 0 0 L -14 6"` and add `"fill": "none", "stroke": "#5E6B7A", "stroke-width": 2`.

**Legacy topLeft anchors still load.** Existing diagrams that use `anchor: { name: "topLeft", args: { dx, dy } }` will continue to render correctly, and the Auto Layout action compensates anchor `dy` values when it repositions lanes so those messages stay horizontal. New LLM-generated diagrams should prefer ports.

---

## Generating Data Cloud Mapping Diagrams (`datamapping`)

This section is the authoritative guide for producing **valid Salesforce Data Cloud / Data 360 field-mapping diagrams**. It composes the atomic [`sf.DataObject`](#sfdataobject), [`sf.Zone`](#sfzone), and [Link](#link-structure) grammar above into a coherent pipeline, and adds the platform rules an LLM must apply. Use `"diagramType": "datamapping"` (mapping mode is then always on — every field is connectable, the `category` badge shows, links auto-style as mappings). The whole section's individual facts are defined above; here is how to assemble them.

> **Mental model:** a Data Cloud mapping diagram is a **left → right pipeline**. Source systems on the left, harmonized Data Model Objects toward the right, optional activation targets at the far right. **Objects live inside labelled layer Zones**; **field-level mapping links** carry attributes from one layer to the next; optional **object-level relationship links** show ER cardinality between whole tables.

### 1. The four layers (`sf.Zone` with `layerStage`)

A layer is an `sf.Zone` carrying a `layerStage` property. **Place every DataObject inside its layer by embedding it** — set the object's `parent` to the Zone id AND list the object id in the Zone's `embeds` array (geometry alone is not enough: the table view's *Data Layer* column reads the object's `parent`, so a loose object reports `[No Mapping Layer]`). Lay the layers out as vertical columns, left → right in pipeline order:

| Layer (Zone `label`) | `layerStage` | Accent (`body/stroke` + `label/fill`, `body/fill` = same at ~5% alpha) | Role |
|---|---|---|---|
| `Source` | `"source"` | `#1D73C9` (blue) | External/origin systems as they exist (CRM, ERP, S3, Marketing Cloud, DB). Native source data types. |
| `Data Lake Object` | `"dlo"` | `#F6B355` (amber) | Raw ingestion — data as landed in Data Cloud, one DLO per source stream. |
| `Data Model Object` | `"dmo"` | `#DA4E55` (red) | Harmonized target entities unified by Identity Resolution (Individual, Account Contact Point, …). |
| `Activation` | `"activation"` | `#27AE60` (green) | Outbound targets where harmonized data is pushed (Email, SMS, Ad Audience, Snowflake share, webhook). |

- **Use only the layers the prompt needs.** A "map this source into a DLO" request uses just Source + DLO — omit the DMO and Activation Zones entirely; do **not** stretch the remaining columns to fill the canvas (omit `viewport` and the app auto-fits).
- **Coordinates:** give each layer its own column. A workable grid: object width 260, ~200 px between columns ⇒ column pitch ≈ 480. e.g. Source objects at `x:80`, DLO at `x:560`, DMO at `x:1040`, Activation at `x:1520`. Make each Zone ≈ `60` px wider/taller than the objects it wraps, with the objects inset ~`40` px. Or omit `viewport` and let the user run **Auto Layout** (it re-columns layers with a 200 px lane gap, 36 px between objects, top-aligned).
- A generic `Layer` Zone (no `layerStage`) is available for grouping that isn't one of the four canonical tiers; it reports its own label as the Data Layer.

### 2. Objects — `category` is mandatory for DLO/DMO

Every `sf.DataObject` that represents a **Data Cloud-native** resource (DLOs and DMOs) **must set `category`** — it is platform-enforced and drives execution (Identity Resolution eligibility, time-series indexing). Source-system objects (raw CRM/ERP tables) normally leave it blank.

| `category` | Use for | Platform effect |
|---|---|---|
| `"Profile"` | Core identity / master entities — Individual, Account, Contact Point, subscriber/master profiles. | Eligible for **Identity Resolution** match rules. |
| `"Engagement"` | Time-series behavioural events — orders, email/web/app interactions, transactions, logs. Must carry an event timestamp field. | Time-series indexed; used for streaming insights & segmentation recency. |
| `"Other"` | Reference / lookup / catalog data — product, store, picklist value sets. | Neither identity nor time-series. |

Set it as a **top-level cell property**: `"category": "Profile"`. (It is *not* `objectCategory`, and it is not nested under `attrs`.) Object **role/tier is expressed by which layer Zone the object sits in** — there is deliberately no `dataSource`/`kind` attribute.

### 3. Fields — keys, Data Cloud types, and normalization

Populate `fields` as an array of field **objects** (never bare strings); see the [`sf.DataObject` field table](#sfdataobject) for every key. For mappings, mind these:

- **`fid`** — give each field a short stable id (`"c_email"`, `"dlo_email"`, …). Field-level link ports derive from it (§4). If you omit it the app assigns one on load, but then *you can't reference the field from a link*, so **always set `fid` on any field you map**.
- **`keyType`** — `"pk"` (primary key, amber), `"fk"` (foreign key, blue), or `"fqk"` (**Fully Qualified Key**, brand red). In Data Cloud the FQK is the primary key **qualified by its data source / source object** so identical ids from different sources stay distinct — mark a DLO/DMO primary key as `"fqk"` when it must be source-qualified. `"pk"`/`"fqk"` auto-set `required: true`.
- **`deprecated`** — `true` strikes the row through (field still present but slated for removal). *(Replaces the old `decommissioned` flag — loaders migrate it.)*
- **Type normalization (document the evolution across layers).** Source objects may use native source types (`varchar(255)`, `Id`, `nvarchar`, `timestamp`, `picklist`, `number(18,0)`). **DLO and DMO fields must normalize to Data Cloud's strict primitive set** in the `type` string:

  | Data Cloud primitive (`type`) | Absorbs source types |
  |---|---|
  | `"Text"` | strings, ids, picklists, emails, phone, URLs |
  | `"Number"` | int / decimal / double / currency / percent |
  | `"Date"` / `"Date Time"` | date, datetime, timestamp |
  | `"Boolean"` | true/false flags |

  Showing the type changing from (e.g.) `varchar(255)` on the Source field to `Text` on the DLO/DMO field is the correct, expected way to document a transformation.

### 4. Field-level mapping links (`linkKind: "mapping"`)

A mapping link carries one attribute from a source-side field to a target-side field, drawn **left → right**. Reference the field **ports** — `field-right-<fid>` on the left/source object, `field-left-<fid>` on the right/target object — via the endpoint's **`port`** key (it is **not** a `<fid>#fieldRight` suffix, and field ports are **never** listed in `ports.items` — they are generated):

```json
{
  "id": "map-email",
  "type": "standard.Link",
  "source": { "id": "obj-sf-contact", "port": "field-right-c_email" },
  "target": { "id": "obj-dlo-contact", "port": "field-left-dlo_email" },
  "linkKind": "mapping",
  "mappingType": "Standard",
  "attrs": { "line": { "stroke": "#F6B355", "strokeWidth": 1,
    "targetMarker": { "type": "path", "d": "M 0 -6 L -14 0 L 0 6 z" } } }
}
```

That is the **minimal** correct form. On load the app **auto-heals the rest** from `linkKind` + `mappingType` (`migrateLinks`): it applies the smooth left→right router (`sfMappingRouter`) + connector (`sfMappingConnector`), pins the ends to the field ports (`connectionPoint` anchor offset 12), repairs the arrowhead, and renders the type-code badge. So you do **not** need to hand-author the bézier router or the badge — but **do** set the amber `line/stroke` (`#F6B355`) and `strokeWidth: 1`, which are not auto-applied.

| `mappingType` | Code badge on target | Meaning |
|---|---|---|
| `"Standard"` (default) | *(none)* | Direct 1:1 copy, no transformation. |
| `"Formula"` | `F` | Field-level formula/expression. |
| `"Streaming Transform"` | `ST` | Real-time stream transform. |
| `"Batch Transform"` | `BT` | Scheduled batch transform. |
| `"Calculated Insight"` | `CI` | Multi-dimensional metric (CI). |

For any **non-`Standard`** type, add **`expressionRule`** (top-level string) with the formula/rule note, e.g. `"expressionRule": "PROPERCASE(FirstName)"` — it surfaces in the link inspector and the table's *Expression / Rule* column. (`mappingType`/`expressionRule` superseded the pre-release `mapsTo`/`mappingLabel`, still read as fallbacks.)

### 5. Object-level relationships (ER, optional)

To show a **whole-table** relationship (a DMO lookup to another DMO, or an ER model in the Source layer) draw an ordinary relationship link — **no `linkKind`** — between the objects' **header ports** (`er-left` / `er-right`, the round relationship anchors), or the pre-seeded `port-top` / `port-bottom`. Use `sfManhattan` routing and crow's-foot cardinality markers (see [Marker Types](#marker-types)):

```json
{
  "id": "rel-ind-acct", "type": "standard.Link",
  "source": { "id": "obj-dmo-individual", "port": "er-right" },
  "target": { "id": "obj-dmo-account", "port": "er-left" },
  "router": { "name": "sfManhattan" },
  "connector": { "name": "rounded", "args": { "radius": 8 } },
  "attrs": { "line": { "stroke": "#888888", "strokeWidth": 2,
    "sourceMarker": { "type": "path", "d": "M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0", "fill": "none", "stroke": "#888888" },
    "targetMarker": { "type": "path", "d": "M -12 -8 L -12 8 M -12 0 L 0 0", "fill": "none", "stroke": "#888888" } } }
}
```

Keep the two link kinds distinct: **field-level = `linkKind:"mapping"`, amber, field ports**; **object-level = no `linkKind`, grey, header ports, crow's-foot**. Don't mix them on one link.

### 6. Worked example — Contact → DLO → DMO

A complete, importable three-layer mapping (Source CRM Contact → Contact DLO → Individual DMO), with one `Formula` mapping. Copy, import, then run Auto Layout to tidy.

```json
{
  "version": 1, "appVersion": "1.19.1", "title": "Contact → Individual Mapping", "diagramType": "datamapping",
  "graph": { "cells": [
    { "id": "zone-src", "type": "sf.Zone", "position": { "x": 40, "y": 40 }, "size": { "width": 340, "height": 280 }, "z": 0,
      "layerStage": "source", "embeds": ["obj-src"],
      "attrs": { "body": { "fill": "rgba(29,115,201,0.05)", "stroke": "#1D73C9", "strokeWidth": 1, "strokeDasharray": "8 4" },
        "label": { "text": "Source", "fill": "#1D73C9" } } },
    { "id": "obj-src", "type": "sf.DataObject", "position": { "x": 80, "y": 100 }, "size": { "width": 260, "height": 102 }, "z": 2000,
      "parent": "zone-src", "objectName": "Salesforce Contact", "headerColor": "#1D73C9",
      "fields": [
        { "label": "Id", "apiName": "Id", "type": "Id", "keyType": "pk", "fid": "s_id", "required": true },
        { "label": "Email", "apiName": "Email", "type": "varchar(255)", "keyType": null, "fid": "s_email" },
        { "label": "First Name", "apiName": "FirstName", "type": "varchar(40)", "keyType": null, "fid": "s_fname" }
      ],
      "attrs": { "header": { "fill": "#1D73C9" }, "headerCover": { "fill": "#1D73C9" }, "headerLabel": { "text": "Salesforce Contact" } } },

    { "id": "zone-dlo", "type": "sf.Zone", "position": { "x": 520, "y": 40 }, "size": { "width": 340, "height": 280 }, "z": 0,
      "layerStage": "dlo", "embeds": ["obj-dlo"],
      "attrs": { "body": { "fill": "rgba(246,179,85,0.05)", "stroke": "#F6B355", "strokeWidth": 1, "strokeDasharray": "8 4" },
        "label": { "text": "Data Lake Object", "fill": "#F6B355" } } },
    { "id": "obj-dlo", "type": "sf.DataObject", "position": { "x": 560, "y": 100 }, "size": { "width": 260, "height": 102 }, "z": 2000,
      "parent": "zone-dlo", "objectName": "Contact DLO", "headerColor": "#F6B355", "category": "Profile",
      "fields": [
        { "label": "Id", "apiName": "Id__c", "type": "Text", "keyType": "fqk", "fid": "d_id", "required": true },
        { "label": "Email", "apiName": "Email__c", "type": "Text", "keyType": null, "fid": "d_email" },
        { "label": "First Name", "apiName": "FirstName__c", "type": "Text", "keyType": null, "fid": "d_fname" }
      ],
      "attrs": { "header": { "fill": "#F6B355" }, "headerCover": { "fill": "#F6B355" }, "headerLabel": { "text": "Contact DLO" } } },

    { "id": "zone-dmo", "type": "sf.Zone", "position": { "x": 1000, "y": 40 }, "size": { "width": 340, "height": 280 }, "z": 0,
      "layerStage": "dmo", "embeds": ["obj-dmo"],
      "attrs": { "body": { "fill": "rgba(218,78,85,0.05)", "stroke": "#DA4E55", "strokeWidth": 1, "strokeDasharray": "8 4" },
        "label": { "text": "Data Model Object", "fill": "#DA4E55" } } },
    { "id": "obj-dmo", "type": "sf.DataObject", "position": { "x": 1040, "y": 100 }, "size": { "width": 260, "height": 102 }, "z": 2000,
      "parent": "zone-dmo", "objectName": "Individual", "headerColor": "#DA4E55", "category": "Profile",
      "fields": [
        { "label": "Id", "apiName": "Id", "type": "Text", "keyType": "fqk", "fid": "m_id", "required": true },
        { "label": "Email", "apiName": "Email", "type": "Text", "keyType": null, "fid": "m_email" },
        { "label": "First Name", "apiName": "FirstName", "type": "Text", "keyType": null, "fid": "m_fname" }
      ],
      "attrs": { "header": { "fill": "#DA4E55" }, "headerCover": { "fill": "#DA4E55" }, "headerLabel": { "text": "Individual" } } },

    { "id": "map-1", "type": "standard.Link", "source": { "id": "obj-src", "port": "field-right-s_email" }, "target": { "id": "obj-dlo", "port": "field-left-d_email" },
      "linkKind": "mapping", "mappingType": "Standard",
      "attrs": { "line": { "stroke": "#F6B355", "strokeWidth": 1, "targetMarker": { "type": "path", "d": "M 0 -6 L -14 0 L 0 6 z" } } } },
    { "id": "map-2", "type": "standard.Link", "source": { "id": "obj-dlo", "port": "field-right-d_email" }, "target": { "id": "obj-dmo", "port": "field-left-m_email" },
      "linkKind": "mapping", "mappingType": "Standard",
      "attrs": { "line": { "stroke": "#F6B355", "strokeWidth": 1, "targetMarker": { "type": "path", "d": "M 0 -6 L -14 0 L 0 6 z" } } } },
    { "id": "map-3", "type": "standard.Link", "source": { "id": "obj-dlo", "port": "field-right-d_fname" }, "target": { "id": "obj-dmo", "port": "field-left-m_fname" },
      "linkKind": "mapping", "mappingType": "Formula", "expressionRule": "PROPERCASE(FirstName__c)",
      "attrs": { "line": { "stroke": "#F6B355", "strokeWidth": 1, "targetMarker": { "type": "path", "d": "M 0 -6 L -14 0 L 0 6 z" } } } }
  ] }
}
```

### 7. Validation checklist (avoid the common mistakes)

- ✅ `"diagramType": "datamapping"` — **not** `"mapping"` or `"data"`.
- ✅ Layers are `sf.Zone` with `layerStage` (`source`/`dlo`/`dmo`/`activation`) — **not** a `sf.Container` named "Source".
- ✅ Every DataObject is **embedded** in its layer Zone: object `parent` = zone id **and** zone `embeds` includes the object id.
- ✅ Object typing is `category` = `Profile`/`Engagement`/`Other` (top-level, set on every DLO/DMO) — **not** `objectCategory`.
- ✅ Field links reference ports via the endpoint **`port`** key as `field-right-<fid>` / `field-left-<fid>` — **not** `<fid>#fieldRight`. Source side uses `field-right-…`, target side `field-left-…`.
- ✅ Mapping links: `linkKind:"mapping"`, amber `#F6B355` stroke, `strokeWidth:1`, `mappingType` from the five-value set; add `expressionRule` for non-`Standard`. Do **not** set `sfManhattan` on a mapping link — the app applies `sfMappingRouter`.
- ✅ ER relationship links: **no** `linkKind`, header ports (`er-left`/`er-right`), `sfManhattan` router, crow's-foot markers.
- ✅ Mark any field you connect with a `fid`; never list field ports in `ports.items`.
- ✅ Keep every OOTB port — **never** drop ports that have no connector. They are the user's attachment points for edits made after generation.
- ✅ Normalize DLO/DMO field `type` to `Text`/`Number`/`Date`/`Date Time`/`Boolean`; keep native types only on Source objects.

---

## Complete Examples

### Architecture Diagram

A **System Landscape** (Salesforce framework Level 2): a "Salesforce Core" container grouping two clouds, an external
system (amber border = "external", per the Legend), two integration connectors carrying **Frequency** labels, a Note,
and `df.Legend` swatches acting as the Salesforce **Key**. It shows the framework conventions in action - a Header
(the `title` + a top `sf.TextLabel`), a Key (`df.Legend`), colour as classification, and orthogonal connectors with
their cadence on the line. *(Validated with `npm run validate`; rendered in-app.)*

```json
{
  "version": 1,
  "appVersion": "1.19.1",
  "title": "Order-to-Cash System Landscape",
  "diagramType": "architecture",
  "graph": {
    "cells": [
      { "id": "title", "type": "sf.TextLabel", "position": { "x": 60, "y": 24 }, "size": { "width": 600, "height": 28 }, "attrs": { "label": { "text": "**Order-to-Cash** - Salesforce to ERP integration (Level 2)" } } },

      { "id": "sfcore", "type": "sf.Container", "position": { "x": 60, "y": 90 }, "size": { "width": 240, "height": 230 }, "attrs": { "accent": { "fill": "#1D73C9" }, "accentFill": { "fill": "#1D73C9" }, "headerLabel": { "text": "Salesforce Core" } }, "embeds": ["sales", "service"] },
      { "id": "sales",   "type": "sf.SimpleNode", "parent": "sfcore", "position": { "x": 80, "y": 146 }, "size": { "width": 200, "height": 60 }, "attrs": { "label": { "text": "Sales Cloud" }, "subtitle": { "text": "Opportunities, Quotes" } } },
      { "id": "service", "type": "sf.SimpleNode", "parent": "sfcore", "position": { "x": 80, "y": 236 }, "size": { "width": 200, "height": 60 }, "attrs": { "label": { "text": "Service Cloud" }, "subtitle": { "text": "Cases, Entitlements" } } },

      { "id": "erp", "type": "sf.SimpleNode", "position": { "x": 480, "y": 150 }, "size": { "width": 220, "height": 64 }, "attrs": { "label": { "text": "SAP ERP" }, "subtitle": { "text": "Orders, Invoices" }, "body": { "stroke": "#F6B355", "strokeWidth": 2 } } },

      { "id": "l1", "type": "standard.Link", "source": { "id": "sales", "port": "port-right" }, "target": { "id": "erp", "port": "port-left" }, "connectionFrequency": "Real-time" },
      { "id": "l2", "type": "standard.Link", "source": { "id": "service", "port": "port-right" }, "target": { "id": "erp", "port": "port-left" }, "connectionFrequency": "Nightly batch" },

      { "id": "note", "type": "sf.Note", "position": { "x": 480, "y": 270 }, "size": { "width": 220, "height": 80 }, "attrs": { "label": { "text": "Orders sync via MuleSoft. See integration runbook." } } },

      { "id": "leg1", "type": "df.Legend", "position": { "x": 60, "y": 360 }, "attrs": { "swatch": { "fill": "#1D73C9" }, "label": { "text": "Salesforce platform" } } },
      { "id": "leg2", "type": "df.Legend", "position": { "x": 60, "y": 396 }, "attrs": { "swatch": { "fill": "#F6B355" }, "label": { "text": "External system" } } }
    ]
  }
}
```

### Data Model (ERD)

Two related Salesforce objects with ER notation:

```json
{
  "version": 1,
  "appVersion": "1.19.1",
  "timestamp": 1712700000000,
  "title": "Account-Contact ERD",
  "diagramType": "datamodel",
  "graph": {
    "cells": [
      {
        "id": "obj-account",
        "type": "sf.DataObject",
        "position": { "x": 100, "y": 100 },
        "size": { "width": 260, "height": 152 },
        "z": 2000,
        "objectName": "Account",
        "headerColor": "#1D73C9",
        "fields": [
          { "label": "Id", "apiName": "Id", "type": "ID", "keyType": "pk", "length": null, "required": false, "deprecated": false },
          { "label": "Name", "apiName": "Name", "type": "Text", "keyType": null, "length": 255, "required": true, "deprecated": false },
          { "label": "Industry", "apiName": "Industry", "type": "Picklist", "keyType": null, "length": null, "required": false, "deprecated": false, "sampleValues": "Technology, Manufacturing" },
          { "label": "Annual Revenue", "apiName": "AnnualRevenue", "type": "Currency", "keyType": null, "length": null, "required": false, "deprecated": false },
          { "label": "Owner", "apiName": "OwnerId", "type": "Lookup", "keyType": "fk", "length": null, "required": true, "deprecated": false }
        ],
        "showLabels": false,
        "showFieldLengths": false,
        "keyFieldsOnly": false,
        "attrs": {
          "body": { "width": "calc(w)", "height": "calc(h)", "rx": 4, "ry": 4, "fill": "var(--node-bg)", "stroke": "var(--node-border)", "strokeWidth": 1 },
          "header": { "width": "calc(w)", "height": 32, "rx": 4, "ry": 4, "fill": "#1D73C9", "stroke": "none" },
          "headerCover": { "width": "calc(w)", "height": 16, "y": 16, "fill": "#1D73C9", "stroke": "none" },
          "headerIcon": { "x": 10, "y": 8, "width": 16, "height": 16, "href": "data:image/svg+xml,<svg data-icon-id=\"account\"/>" },
          "headerLabel": { "x": 32, "y": 16, "textAnchor": "start", "textVerticalAnchor": "middle", "fontSize": 13, "fontWeight": "bold", "fontFamily": "system-ui, -apple-system, sans-serif", "fill": "#FFFFFF", "text": "Account" }
        },
        "ports": {
          "groups": {
            "top":    { "position": { "name": "top" },    "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] },
            "bottom": { "position": { "name": "bottom" }, "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] }
          },
          "items": [
            { "id": "port-top", "group": "top" },
            { "id": "port-bottom", "group": "bottom" }
          ]
        }
      },
      {
        "id": "obj-contact",
        "type": "sf.DataObject",
        "position": { "x": 500, "y": 100 },
        "size": { "width": 260, "height": 152 },
        "z": 2000,
        "objectName": "Contact",
        "headerColor": "#7F2B82",
        "fields": [
          { "label": "Id", "apiName": "Id", "type": "ID", "keyType": "pk", "length": null, "required": false, "deprecated": false },
          { "label": "Name", "apiName": "Name", "type": "Text", "keyType": null, "length": 255, "required": true, "deprecated": false },
          { "label": "Email", "apiName": "Email", "type": "Email", "keyType": null, "length": null, "required": false, "deprecated": false, "sampleValues": "jane@acme.com, sam@globalmedia.com" },
          { "label": "Account", "apiName": "AccountId", "type": "Lookup", "keyType": "fk", "length": null, "required": false, "deprecated": false },
          { "label": "Title", "apiName": "Title", "type": "Text", "keyType": null, "length": 128, "required": false, "deprecated": false }
        ],
        "showLabels": false,
        "showFieldLengths": false,
        "keyFieldsOnly": false,
        "attrs": {
          "body": { "width": "calc(w)", "height": "calc(h)", "rx": 4, "ry": 4, "fill": "var(--node-bg)", "stroke": "var(--node-border)", "strokeWidth": 1 },
          "header": { "width": "calc(w)", "height": 32, "rx": 4, "ry": 4, "fill": "#7F2B82", "stroke": "none" },
          "headerCover": { "width": "calc(w)", "height": 16, "y": 16, "fill": "#7F2B82", "stroke": "none" },
          "headerIcon": { "x": 10, "y": 8, "width": 16, "height": 16, "href": "data:image/svg+xml,<svg data-icon-id=\"contact\"/>" },
          "headerLabel": { "x": 32, "y": 16, "textAnchor": "start", "textVerticalAnchor": "middle", "fontSize": 13, "fontWeight": "bold", "fontFamily": "system-ui, -apple-system, sans-serif", "fill": "#FFFFFF", "text": "Contact" }
        },
        "ports": {
          "groups": {
            "top":    { "position": { "name": "top" },    "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] },
            "bottom": { "position": { "name": "bottom" }, "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] }
          },
          "items": [
            { "id": "port-top", "group": "top" },
            { "id": "port-bottom", "group": "bottom" }
          ]
        }
      },
      {
        "id": "link-account-contact",
        "type": "standard.Link",
        "z": 3001,
        "source": { "id": "obj-account", "port": "port-top" },
        "target": { "id": "obj-contact", "port": "port-top" },
        "attrs": {
          "line": {
            "stroke": "#888888",
            "strokeWidth": 2,
            "sourceMarker": {
              "type": "path",
              "d": "M -12 -8 L -12 8 M -12 0 L 0 0",
              "fill": "none",
              "stroke": "#888888",
              "stroke-width": 2
            },
            "targetMarker": {
              "type": "path",
              "d": "M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0",
              "fill": "none",
              "stroke": "#888888",
              "stroke-width": 2
            }
          }
        },
        "labels": [
          { "position": 0.5, "attrs": { "text": { "text": "has" } } }
        ],
        "router": { "name": "sfManhattan" },
        "connector": { "name": "rounded", "args": { "radius": 8 } }
      }
    ]
  }
}
```

### Sequence Diagram

Three lanes - an **`sf.SequenceActor`** ("Customer", `showLifeline: true`) plus two `sf.SequenceParticipant`s -
exchanging **numbered** messages, with an activation box and an `alt` fragment. Messages are port-based: every lane
carries the same `lifelinePortCount: 10`, so `seq-port-*-<i>` is message slot `i` and ports are rebuilt on load (do
not serialize `ports.items`). An actor WITH a lifeline must sit 44px ABOVE the participants
(`position.y = participant.y - 44`) so the lifelines align. The reply (`msg-2`) is dashed (`lineStyle: "6 4"`) and
swaps port direction. *(Validated with `npm run validate`; rendered in-app.)*

```json
{
  "version": 1,
  "appVersion": "1.19.1",
  "title": "Account Lookup",
  "diagramType": "sequence",
  "graph": {
    "cells": [
      { "id": "cust", "type": "sf.SequenceActor", "position": { "x": -140, "y": -4 }, "size": { "width": 100, "height": 356 }, "z": 2000, "showLifeline": true, "lifelinePortCount": 10, "attrs": { "label": { "text": "Customer" } } },
      { "id": "part-sf", "type": "sf.SequenceParticipant", "position": { "x": 60, "y": 40 }, "size": { "width": 140, "height": 360 }, "z": 2000, "participantRole": "salesforce", "lifelinePortCount": 10, "showBottomLabel": true, "attrs": { "header": { "stroke": "#2E844A" }, "headerAccent": { "fill": "#2E844A" }, "label": { "text": "Salesforce" }, "lifeline": { "stroke": "#2E844A" }, "underline": { "stroke": "#2E844A", "opacity": 0.6 } } },
      { "id": "part-api", "type": "sf.SequenceParticipant", "position": { "x": 280, "y": 40 }, "size": { "width": 140, "height": 360 }, "z": 2000, "participantRole": "api", "lifelinePortCount": 10, "showBottomLabel": true, "attrs": { "header": { "stroke": "#1D73C9" }, "headerAccent": { "fill": "#1D73C9" }, "label": { "text": "Account API" }, "lifeline": { "stroke": "#1D73C9" }, "underline": { "stroke": "#1D73C9", "opacity": 0.6 } } },
      { "id": "frag-1", "type": "sf.SequenceFragment", "position": { "x": 30, "y": 188 }, "size": { "width": 460, "height": 120 }, "z": 500, "fragmentType": "alternative", "fragmentLabel": "alt", "condition": "account found", "elseCondition": "account not found", "attrs": { "body": { "stroke": "#8A9099", "fill": "rgba(138,144,153,0.05)" }, "titleText": { "text": "alt" }, "conditionText": { "text": "[account found]" }, "dividerLine": { "visibility": "visible" }, "elseText": { "text": "[account not found]", "visibility": "visible" } } },
      { "id": "act-api", "type": "sf.SequenceActivation", "position": { "x": 344, "y": 138 }, "size": { "width": 12, "height": 80 }, "z": 2200, "attrs": { "body": { "fill": "#D0D4D9", "stroke": "#8A9099", "strokeWidth": 1 } } },
      { "id": "msg-0", "type": "standard.Link", "z": 3000, "source": { "id": "cust", "port": "seq-port-right-1" }, "target": { "id": "part-sf", "port": "seq-port-left-1" }, "router": { "name": "normal" }, "connector": { "name": "normal" }, "attrs": { "line": { "stroke": "#5E6B7A", "strokeWidth": 2, "sourceMarker": { "type": "path", "d": "M 0 0 L -6 0", "fill": "none", "stroke": "#5E6B7A", "stroke-width": 2 }, "targetMarker": { "type": "path", "d": "M 0 -6 L -14 0 L 0 6 z" } } }, "labels": [ { "position": { "distance": 0.5, "offset": -10 }, "attrs": { "text": { "text": "1. lookup account", "fontSize": 11, "fill": "var(--text-primary)" } } } ] },
      { "id": "msg-1", "type": "standard.Link", "z": 3000, "source": { "id": "part-sf", "port": "seq-port-right-2" }, "target": { "id": "part-api", "port": "seq-port-left-2" }, "router": { "name": "normal" }, "connector": { "name": "normal" }, "attrs": { "line": { "stroke": "#5E6B7A", "strokeWidth": 2, "sourceMarker": { "type": "path", "d": "M 0 0 L -6 0", "fill": "none", "stroke": "#5E6B7A", "stroke-width": 2 }, "targetMarker": { "type": "path", "d": "M 0 -6 L -14 0 L 0 6 z" } } }, "labels": [ { "position": { "distance": 0.5, "offset": -10 }, "attrs": { "text": { "text": "2. getAccount(id)", "fontSize": 11, "fill": "var(--text-primary)" } } } ] },
      { "id": "msg-2", "type": "standard.Link", "z": 3000, "source": { "id": "part-api", "port": "seq-port-left-3" }, "target": { "id": "part-sf", "port": "seq-port-right-3" }, "router": { "name": "normal" }, "connector": { "name": "normal" }, "lineStyle": "6 4", "attrs": { "line": { "stroke": "#5E6B7A", "strokeWidth": 2, "sourceMarker": { "type": "path", "d": "M 0 0 L -6 0", "fill": "none", "stroke": "#5E6B7A", "stroke-width": 2, "stroke-dasharray": "none" }, "targetMarker": { "type": "path", "d": "M 0 -6 L -14 0 L 0 6 z", "stroke-dasharray": "none" } } }, "labels": [ { "position": { "distance": 0.5, "offset": -10 }, "attrs": { "text": { "text": "3. Account{...}", "fontSize": 11, "fill": "var(--text-primary)" } } } ] }
    ]
  }
}
```

### Gantt Chart

The bars carry **data only** - `startDate`/`endDate` + `order` + `groupId` + `progress` + an optional `assignee` -
the loader derives each bar's x/width/colour and the milestone/marker columns from the dates (no `position`/`size` on
bars). `taskLabel` is the task name (the loader copies it onto the bar). The timeline's `todayDate` draws the
full-height today line; a `sf.GanttMarker` (`markerDate`) is a separate dated marker. A dependency is a
`standard.Link` with `linkKind:"ganttDep"` + `depType` (`FS`/`SS`/`FF`/`SF`) + optional `lag`. *(Validated with
`npm run validate`; rendered in-app.)*

```json
{
  "version": 1,
  "appVersion": "1.19.1",
  "title": "Implementation Plan",
  "diagramType": "gantt",
  "graph": {
    "cells": [
      { "id": "tl1", "type": "sf.GanttTimeline", "position": { "x": 40, "y": 40 }, "size": { "width": 1000, "height": 360 },
        "startDate": "2026-06-01", "viewMode": "week", "numPeriods": 10, "taskListWidth": 200, "rowHeight": 48, "showProjectSummary": true, "todayDate": "2026-06-22",
        "groups": [ { "id": "gA", "label": "Discovery", "color": "#1D73C9", "order": 0 }, { "id": "gB", "label": "Build", "color": "#2A9D8F", "order": 1 } ],
        "embeds": ["req", "design", "dev", "ms1", "ms2", "gate"] },
      { "id": "req",    "type": "sf.GanttTask", "parent": "tl1", "order": 0, "groupId": "gA", "taskLabel": "Requirements gathering", "assignee": "AB", "startDate": "2026-06-01", "endDate": "2026-06-15", "progress": 100 },
      { "id": "design", "type": "sf.GanttTask", "parent": "tl1", "order": 1, "groupId": "gA", "taskLabel": "Solution architecture",  "assignee": "CD", "startDate": "2026-06-15", "endDate": "2026-06-29", "progress": 40 },
      { "id": "dev",    "type": "sf.GanttTask", "parent": "tl1", "order": 2, "groupId": "gB", "taskLabel": "Custom development",      "assignee": "EF", "startDate": "2026-06-29", "endDate": "2026-07-27", "progress": 0 },
      { "id": "ms2",    "type": "sf.GanttMilestone", "parent": "tl1", "position": { "x": 240, "y": 232 }, "milestoneDate": "2026-06-29", "attrs": { "label": { "text": "Design sign-off" } } },
      { "id": "ms1",    "type": "sf.GanttMilestone", "parent": "tl1", "position": { "x": 240, "y": 232 }, "milestoneDate": "2026-07-27", "attrs": { "label": { "text": "Go Live" } } },
      { "id": "gate",   "type": "sf.GanttMarker", "parent": "tl1", "position": { "x": 240, "y": 136 }, "markerDate": "2026-07-06", "attrs": { "label": { "text": "Phase gate" } } },
      { "id": "dep1",   "type": "standard.Link", "linkKind": "ganttDep", "depType": "FS", "source": { "id": "req", "port": "port-right" }, "target": { "id": "design", "port": "port-left" } },
      { "id": "dep2",   "type": "standard.Link", "linkKind": "ganttDep", "depType": "SS", "lag": 2, "source": { "id": "design", "port": "port-right" }, "target": { "id": "dev", "port": "port-left" } }
    ]
  }
}
```

### Process / BPMN

A richer BPMN flow: an **exclusive** gateway (`×`) branches on approval; the Yes path forks two tasks through a
**parallel** gateway (`+`) and joins them; steps are numbered (Salesforce's sequenced-numbering convention); and an
`sf.Annotation` brace carries an SLA note via a dotted association link (`lineStyle: "2 4"`). A gateway needs
`attrs.marker.text` (`×` exclusive, `+` parallel, `○` inclusive, `◇` event); a non-start event needs its `body`
fill/stroke; flows OMIT `targetMarker` (the loader adds the arrow). *(Validated with `npm run validate`; rendered in-app.)*

```json
{
  "version": 1,
  "appVersion": "1.19.1",
  "title": "Access Request Process",
  "diagramType": "process",
  "graph": {
    "cells": [
      { "id": "start", "type": "sf.BpmnEvent", "eventType": "start", "position": { "x": 40, "y": 224 }, "size": { "width": 48, "height": 48 }, "attrs": { "label": { "text": "Request" } } },
      { "id": "t1", "type": "sf.BpmnTask", "position": { "x": 130, "y": 214 }, "size": { "width": 140, "height": 68 }, "attrs": { "label": { "text": "1. Review request" } } },
      { "id": "anno", "type": "sf.Annotation", "position": { "x": 150, "y": 96 }, "size": { "width": 120, "height": 90 }, "bracketSide": "right", "attrs": { "label": { "text": "SLA: 2 business days" } } },

      { "id": "gw1", "type": "sf.BpmnGateway", "gatewayType": "exclusive", "position": { "x": 330, "y": 222 }, "size": { "width": 52, "height": 52 }, "attrs": { "marker": { "text": "×" }, "label": { "text": "Approved?" } } },

      { "id": "gw2", "type": "sf.BpmnGateway", "gatewayType": "parallel", "position": { "x": 450, "y": 222 }, "size": { "width": 52, "height": 52 }, "attrs": { "marker": { "text": "+" } } },
      { "id": "t2", "type": "sf.BpmnTask", "position": { "x": 560, "y": 120 }, "size": { "width": 150, "height": 68 }, "attrs": { "label": { "text": "2. Provision access" } } },
      { "id": "t3", "type": "sf.BpmnTask", "position": { "x": 560, "y": 300 }, "size": { "width": 150, "height": 68 }, "attrs": { "label": { "text": "3. Notify manager" } } },
      { "id": "gw3", "type": "sf.BpmnGateway", "gatewayType": "parallel", "position": { "x": 770, "y": 222 }, "size": { "width": 52, "height": 52 }, "attrs": { "marker": { "text": "+" } } },
      { "id": "done", "type": "sf.BpmnEvent", "eventType": "end", "position": { "x": 880, "y": 224 }, "size": { "width": 48, "height": 48 }, "attrs": { "body": { "fill": "#F9E3E5", "stroke": "#DA4E55", "strokeWidth": 4 }, "icon": { "fill": "#DA4E55" }, "label": { "text": "Granted" } } },

      { "id": "t4", "type": "sf.BpmnTask", "position": { "x": 430, "y": 380 }, "size": { "width": 150, "height": 68 }, "attrs": { "label": { "text": "Send rejection notice" } } },
      { "id": "rej", "type": "sf.BpmnEvent", "eventType": "end", "position": { "x": 640, "y": 392 }, "size": { "width": 48, "height": 48 }, "attrs": { "body": { "fill": "#F9E3E5", "stroke": "#DA4E55", "strokeWidth": 4 }, "icon": { "fill": "#DA4E55" }, "label": { "text": "Rejected" } } },

      { "id": "a1", "type": "standard.Link", "source": { "id": "anno", "port": "port-bottom" }, "target": { "id": "t1", "port": "port-top" }, "lineStyle": "2 4" },
      { "id": "f1", "type": "standard.Link", "source": { "id": "start", "port": "port-right" }, "target": { "id": "t1", "port": "port-left" } },
      { "id": "f2", "type": "standard.Link", "source": { "id": "t1", "port": "port-right" }, "target": { "id": "gw1", "port": "port-left" } },
      { "id": "f3", "type": "standard.Link", "source": { "id": "gw1", "port": "port-right" }, "target": { "id": "gw2", "port": "port-left" }, "labels": [ { "attrs": { "text": { "text": "Yes" } } } ] },
      { "id": "f4", "type": "standard.Link", "source": { "id": "gw1", "port": "port-bottom" }, "target": { "id": "t4", "port": "port-left" }, "labels": [ { "attrs": { "text": { "text": "No" } } } ] },
      { "id": "f5", "type": "standard.Link", "source": { "id": "gw2", "port": "port-top" }, "target": { "id": "t2", "port": "port-left" } },
      { "id": "f6", "type": "standard.Link", "source": { "id": "gw2", "port": "port-bottom" }, "target": { "id": "t3", "port": "port-left" } },
      { "id": "f7", "type": "standard.Link", "source": { "id": "t2", "port": "port-right" }, "target": { "id": "gw3", "port": "port-top" } },
      { "id": "f8", "type": "standard.Link", "source": { "id": "t3", "port": "port-right" }, "target": { "id": "gw3", "port": "port-bottom" } },
      { "id": "f9", "type": "standard.Link", "source": { "id": "gw3", "port": "port-right" }, "target": { "id": "done", "port": "port-left" } },
      { "id": "f10", "type": "standard.Link", "source": { "id": "t4", "port": "port-right" }, "target": { "id": "rej", "port": "port-left" } }
    ]
  }
}
```

### Org Chart

This is the classic mis-pick: "two teams working on a project" is an **`org`** diagram, NOT `architecture` (people,
not systems - see [Choosing the right diagram type](#choosing-the-right-diagram-type)). `sf.OrgPerson` carries
top-level `personName` / `jobTitle` / `iconText` (avatar initials) / `raci` (`{R,A,C,I}` role pills) / `tags` /
`vacant` (dashed "to be hired" placeholder) / a `details` array - the view renders every label and AUTO-SIZES from
these props (never hand-write the label `attrs` or a tall `size`). A **Team is an `sf.Container`** (header via
`attrs.headerLabel.text` + accent colour) that EMBEDS its people: set BOTH the container `embeds[]` and each person's
`parent`. Reporting links join `port-bottom` → `port-top`. (Wrap the teams in a Department `sf.Zone` the same way for
another grouping level; for a RACI matrix use `sf.Task` + `sf.TaskGroup` instead - see their Shape Reference.)
*(Validated with `npm run validate`; rendered in-app.)*

```json
{
  "version": 1,
  "appVersion": "1.19.1",
  "title": "Project Phoenix - Delivery Teams",
  "diagramType": "org",
  "graph": {
    "cells": [
      { "id": "lead", "type": "sf.OrgPerson", "position": { "x": 280, "y": 40 }, "personName": "Maria Chen", "jobTitle": "Programme Lead", "iconText": "MC", "raci": { "A": true }, "tags": ["sponsor"], "details": [ { "label": "Stream", "value": "Delivery" }, { "label": "Location", "value": "London" } ] },

      { "id": "platform", "type": "sf.Container", "position": { "x": 60, "y": 210 }, "size": { "width": 320, "height": 320 }, "tags": ["scrum"], "attrs": { "accent": { "fill": "#1D73C9" }, "accentFill": { "fill": "#1D73C9" }, "headerLabel": { "text": "Platform Team" } }, "embeds": ["sam", "vac1"] },
      { "id": "sam",  "type": "sf.OrgPerson", "parent": "platform", "position": { "x": 80, "y": 264 }, "personName": "Sam Rivera", "jobTitle": "Tech Lead", "iconText": "SR", "raci": { "R": true } },
      { "id": "vac1", "type": "sf.OrgPerson", "parent": "platform", "position": { "x": 80, "y": 400 }, "personName": "To be hired", "jobTitle": "Senior Engineer", "vacant": true },

      { "id": "data", "type": "sf.Container", "position": { "x": 440, "y": 210 }, "size": { "width": 320, "height": 320 }, "attrs": { "accent": { "fill": "#7F2B82" }, "accentFill": { "fill": "#7F2B82" }, "headerLabel": { "text": "Data Team" } }, "embeds": ["alex", "priya"] },
      { "id": "alex",  "type": "sf.OrgPerson", "parent": "data", "position": { "x": 460, "y": 264 }, "personName": "Alex Kim", "jobTitle": "Data Lead", "iconText": "AK", "raci": { "R": true, "C": true } },
      { "id": "priya", "type": "sf.OrgPerson", "parent": "data", "position": { "x": 460, "y": 400 }, "personName": "Priya Patel", "jobTitle": "Analytics Engineer", "iconText": "PP", "raci": { "C": true }, "tags": ["dbt", "CRMA"] },

      { "id": "r1", "type": "standard.Link", "source": { "id": "lead", "port": "port-bottom" }, "target": { "id": "platform", "port": "port-top" } },
      { "id": "r2", "type": "standard.Link", "source": { "id": "lead", "port": "port-bottom" }, "target": { "id": "data", "port": "port-top" } }
    ]
  }
}
```

---

## Layout Tips

- **Spacing:** Leave ~100-140px horizontal gaps and ~80-100px vertical gaps between elements for clean routing.
- **Grid:** The canvas uses a 16px grid. Align positions to multiples of 16 for neatness.
- **Container children:** Position children at least 50px below the container's top (to clear the 40px header bar) and 10px from edges.
- **Zones:** Place zones first (z=0) and size them to encompass their child elements with ~30px padding.
- **Links:** The `sfManhattan` router auto-routes orthogonal paths. You rarely need `vertices` — only add them for specific waypoint control.
- **Port selection:** Use `port-right`/`port-left` for horizontal flows, `port-top`/`port-bottom` for vertical flows. The router handles the rest.

## Limits

- Maximum 2000 cells per diagram (enforced on import).
- Element IDs must be unique strings across all cells.
- Link `source.id` and `target.id` must reference existing element IDs.
- Link `source.port` and `target.port` must match port IDs defined on the referenced elements.

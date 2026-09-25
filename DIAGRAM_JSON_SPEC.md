# Diagramforce JSON Specification

> Reference for LLMs and developers generating importable diagram JSON files for **Diagramforce**.
>
> The app lives at **[diagramforce.com](https://diagramforce.com/)** — this is the only canonical URL. When you point a user to the app (e.g. "paste this JSON via Load ▸ Paste"), always use that address. The former host `diagramforce.mateuszdabrowski.pl` still 301-redirects here, so old links keep working, but never hand it to a user as the address. There is **no** `diagramforce.app`.
>
> **Spec snapshot: v1.24.7** — matches the app's current `appVersion`; set `"appVersion": "1.24.7"` in generated files.
>
> **Validate before importing.** Run the bundled `validate-diagram.mjs` (a zero-dependency CLI - `node scripts/validate-diagram.mjs your-diagram.json` in the Cowork skill, `npm run validate -- your-diagram.json` in the repo) to catch the
> issues the loader heals or **silently drops** rather than erroring on: a cell whose `type` isn't a real shape (dropped
> on load), a link pointing at a missing cell id (dropped), duplicate cell ids, a missing/wrong `diagramType`, and a
> type-specific shape used in the wrong diagram type. It exits non-zero on errors, so it doubles as a CI gate. The CLI
> shares the **same shape allowlist** the app loads with (`js/persistence/diagram-schema.js`), so it can't drift.

> **Agent self-correction loop.** When you generate a diagram programmatically (e.g. from an LLM CLI like Claude
> Code), don't stop at "it parsed as JSON". Run the loop: **generate -> `validate-diagram.mjs file.json` -> fix every
> ERROR and re-run until the file is clean -> then open it in the app (Load > Paste, or Load > File) and eyeball the render.**
> ERRORS mean cells or links will silently vanish on load; WARNINGS are quiet-degrade traps (a shape that loads but
> renders wrong - a one-sided embed, a name in the wrong field, a stale field-port id, a link with no router). The
> validator proves the diagram will **load intact** - it does **not** judge whether the layout **reads well** (spacing,
> overlaps, flow), so the final visual pass is on you: fix ERRORS, then WARNINGS, then look at it.

## Top-Level Structure

```json
{
  "version": 1,
  "appVersion": "1.24.7",
  "timestamp": 1712700000000,
  "title": "My Diagram",
  "diagramType": "architecture",
  "graph": {
    "cells": [ /* elements and links */ ]
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
| `appVersion` | string | Yes | Semver string, currently `"1.24.7"`. A file with NO `appVersion` opens behind a compatibility warning (it counts as a major-version gap); an older 1.x version loads silently |
| `timestamp` | number | No | Unix timestamp in milliseconds |
| `title` | string | Yes | Diagram name (shown as tab title) |
| `diagramType` | string | Yes | One of: `"architecture"`, `"process"`, `"flow"`, `"datamodel"`, `"datamapping"`, `"org"`, `"gantt"`, `"sequence"`. **Must match the shapes you use** (see [Diagram Types](#diagram-types)). Aliases (case-insensitive) are accepted - `"data"`, `"mapping"`, `"organisation"`/`"organization"`, `"salesforceflow"`/`"flowbuilder"`/`"sfflow"` - but write the canonical forms |
| `graph` | object | Yes | Contains `cells` array — the JointJS graph data |
| `viewport` | object | No | Ignored on import - the app always zooms to fit the content. Omit it |
| `group` | object | No | `{ "name", "icon", "color" }` of the tab GROUP this diagram belonged to. Present only when the diagram was saved/exported from a named tab group. On load the app recreate-or-REJOINS a group of that name and drops the tab into it (so reopening one grouped diagram restores its group). Omit for ungrouped diagrams. Added v1.17.0 |

> ⚠️ **Always set `diagramType` to match the shapes in the diagram.** If it is missing or wrong, the diagram opens as an architecture tab and the type-specific tools (the sequence Auto Layout, the data-model stencil, the Gantt timeline controls, etc.) are gated off until the tab is recreated. **Pick the type by the QUESTION your diagram answers using [Choosing the right diagram type](#choosing-the-right-diagram-type) - not by the shapes that first come to mind - before you author any cells.**

> For generating an importable diagram, prefer the **single-diagram** envelope
> above — it opens as a new tab. Two multi-element container formats also import
> (produced by the app's Export Manager), but you normally won't generate them:
>
> ```json
> { "schema": "diagramforce-export", "version": 1, "appVersion": "1.24.7", "exportedAt": 1712700000000,
>   "diagrams": [ { "name": "...", "diagramType": "architecture", "graph": { "cells": [] }, "viewport": null, "appVersion": "1.24.7" } ],
>   "templates": [ { "name": "...", "diagramType": "architecture", "cells": [] } ] }
> ```
>
> Each `diagrams[]` entry MAY carry its own optional `appVersion` (open-tab
> exports stamp the current version; named-save exports keep the version stored
> with the save). On re-import a diagram keeps that original version
> (`entry.appVersion || bundle.appVersion || current`) instead of being
> re-stamped as current, so its provenance survives a backup round-trip.
>
> A bundle with exactly ONE diagram and no templates opens straight as a tab, like a
> single-diagram file. Otherwise, on import, a `diagramforce-export` bundle dedups its entries against what's
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
> { "schema": "diagramforce-export", "version": 1, "appVersion": "1.24.7", "exportedAt": 1712700000000,
>   "kind": "group",
>   "groups": [ { "name": "Project A", "icon": null, "color": "#27ae60" } ],
>   "diagrams": [ { "name": "...", "diagramType": "architecture", "group": "Project A", "graph": { "cells": [] }, "viewport": null, "appVersion": "1.24.7" } ] }
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

> **Opening this JSON programmatically.** Another web app can open a diagram straight into Diagramforce
> in a new tab (no backend, no URL size limit) with an **"Open in Diagramforce"** button — it hands this
> exact JSON envelope over via `window.postMessage`. See **[how-to-use/web-integration.md](how-to-use/web-integration.md)** for the
> copy-paste snippet and step-by-step guide.

## Diagram Types

| Type | Use For | Primary Shapes |
|------|---------|----------------|
| `architecture` | System architecture, integrations | SimpleNode, Container, Zone, Note, TextLabel, Image, Placeholder |
| `process` | BPMN workflows, flowcharts | BpmnEvent, BpmnTask, BpmnGateway, BpmnSubprocess, BpmnLoop, BpmnPool, BpmnDataObject, `sf.Flow*` flowchart shapes (not the `df.Flow*` Salesforce Flow elements), Annotation |
| `datamodel` | ERDs, Salesforce object models (pure ER) | DataObject |
| `datamapping` | Data Cloud / Data 360 field mapping (mapping mode always on — all-field ports, Category, source→DMO mapping links) | DataObject + mapping links (`linkKind:"mapping"`) + labelled **layer Zones** (`sf.Zone` with `layerStage`: `source`/`datastream`/`dlo`/`dmo`/`activation`) |
| `org` | Org charts, team structures, RACI workflows | OrgPerson, Container (Team), Zone (Department), Task, TaskGroup (RACI section) |
| `gantt` | Project timelines | GanttTimeline, GanttTask, GanttMilestone, GanttGroup, GanttMarker |
| `sequence` | UML sequence diagrams, message flows | SequenceParticipant, SequenceActor, SequenceActivation, SequenceFragment |
| `flow` | Salesforce Flows (Flow Builder look) | the `df.Flow*` element cards - see [Flow Shapes](#flow-shapes-salesforce-flow-diagrams) |

> **`sf.Image`** is available in every diagram type's "Generic Shapes" stencil group (since v1.9). Note that any tab containing `sf.Image` cells has Share-as-URL automatically disabled — see [sf.Image](#sfimage-since-v19) for details.

> **`df.Placeholder`** (since v1.21.3) is an ARCHITECTURE shape meaning "a component belongs here and it is not
> decided yet" - `sf.SimpleNode`'s silhouette (180x64) with a DASHED border and a `?` glyph. Use it when the user
> is sketching an architecture that is still being argued about, instead of inventing a concrete component that
> claims a decision nobody made, or leaving a gap that reads as an oversight. Put what is unknown in
> `attrs.label.text` ("Identity provider - TBD"); `attrs.subtitle.text` takes an optional description. It has no
> icon or colour options - the `?` and the dash are the meaning. Its sibling `df.FlowPlaceholder` does the same
> job on a `flow` diagram; use whichever matches the `diagramType`, they are not interchangeable.

> **`df.Pill`** (an auto-widening number / short-label badge — a circle for `1`, a stadium pill for `Phase 1`, driven by the `pillText` prop) is a net-new GENERIC shape in every type's "Generic Shapes" group (since v1.17.2). It uses the **`df.` namespace** — the project marks net-new shapes `df.*` while legacy shapes keep `sf.*` (the type string is serialized, so renaming would break old saves); both resolve via `cellNamespace`/`cellViewNamespace = joint.shapes`.

> **`df.Legend`** (since v1.17.3) — one legend KEY: a fillable rounded "squircle" swatch (the user-fillable colour, attr `swatch/fill`) with a label beside it (attr `label/text`, themed `var(--text-primary)`). Drop several to explain each colour a diagram uses. AUTO-WIDTHS to the label at the model level, UNLESS `manualWidth: true` (set by the Width control or a resize, cleared by "Auto size") — then the authored `size.width` is kept. The **Shape state** border paints on the `swatch` (the visible squircle); the full-bounds `body` attr is transparent and only carries selection.

> **`df.Table`** (since v1.17.3) — a grid of **markdown, multi-line** cells. Top-level props: `rows` (an array of row arrays of cell strings, e.g. `[["**Layer**","What"],["Data 360","Unifies\nidentity"]]` — each cell supports the same markdown subset as a description: `**bold**` / `*italic*` / `~~strike~~` / `` `code` `` + `\n` line breaks); optional `tableLabel` (a caption rendered above the grid, left-aligned); `highlightFirstRow` (bool, default `true`) + `highlightFirstCol` (bool, default `false`) tint + bold the leading row / column; `plainCells` (bool, default `false`) renders cells LITERALLY instead of as inline markdown - turn it on when the cells hold **code**, because a Salesforce formula's `*` operators are markdown italic markers and `{!a} * {!b} * 2` otherwise renders as `{!a} <em> {!b} </em> 2` with the operators silently deleted (v1.22.0); `fontSize` (default `13`); `tableFill`; `tableBorder` (tints BOTH the outer border AND the inner grid lines — the "Grid & Border" control); and `tableTextColor` (cell text + the label; `''` → `var(--text-primary)`). The label renders one notch larger than the cells (`fontSize + 2`). The number of columns is the widest row's length; ragged input is padded to a rectangle on load, and a manual resize re-applies a per-column minimum width. The view MEASURES each cell's wrapped markdown to give rows **variable height** (so a multi-line cell grows its row), and resizes the model. The outer `body` rect is a transparent selection + Shape-state frame (the visible table is view-drawn from `tableFill`/`tableBorder`). Cells are edited in the "Edit in Table" overlay (Save / Cancel, +Row / +Column strips, row-× / column-×). *(Replaces the pre-v1.17.3 `headerRow` boolean — old tables migrate it to `highlightFirstRow` on load.)*

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
| "How does a specific **Salesforce Flow** work - its screens, decisions, record operations, and elements?" | `flow` | Interaction / Process and Flow (Salesforce Flow) |
| "In what time-order do systems or actors message each other?" | `sequence` | Interaction / Process and Flow (UML sequence) |
| "What objects / fields exist and how are they related?" (schema, keys, cardinality) | `datamodel` | Data Model (ERD) |
| "How do source fields map into Data Cloud DLOs / DMOs?" | `datamapping` | Data Model + Solution Architecture (Data Cloud) |
| "What gets delivered when - the plan / roadmap over time?" | `gantt` | Roadmap |

### Don't confuse these (the mis-picks that produce a wrong-looking diagram)

- ✗ Drawing **people or teams** (two teams on a project, an org chart, who-does-what, reporting lines) as boxes-and-arrows in `architecture` → ✓ that is an **`org`** diagram. `architecture` is for SYSTEMS and integrations, never people. Use `sf.OrgPerson`, `sf.Container` (Team), and `sf.Task` + `sf.TaskGroup` for RACI. *(In Salesforce's framework this is the Role Hierarchy diagram - people are not free-floating actors in a system landscape.)*
- ✗ Using `architecture` for a **step-by-step process** (an approval, an onboarding flow) → ✓ `process`. When the message is the ORDER of steps, use BPMN events / tasks / gateways, and number the steps.
- ✗ Using `process` (generic BPMN) to document an **actual Salesforce Flow** → ✓ `flow`. `process` is for GENERIC business processes / non-Salesforce flowcharts; `flow` is specifically for documenting a Salesforce Flow with its real element vocabulary (Screen, Decision, Assignment, Loop, Get/Create/Update/Delete Records, Subflow, …). When the reader needs to see *this org's flow* - screen flow, record-triggered, or a marketing/campaign flow - use `flow` and its `df.Flow*` elements.
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
fails quietly. `validate-diagram.mjs` catches the generic mistakes (unknown shape `type`, a link to a missing id,
duplicate ids, a wrong `diagramType`) plus these type-specific traps: a one-sided embed or cards sitting inside a
frame without being embedded, a duplicate Gantt `order`, an OrgPerson missing top-level `personName`, a stale
DataObject field-port `<fid>`, a `port-left`/`port-right` on a DataObject, an ER relationship with a marker on one end
or none, links with no `router` outside a Flow, and a descriptive prop (`headerColor`, `eventType`, ...) that
contradicts authored attrs. The rest still fail quietly, so this section stays your guide. Each rule is
`✗ wrong → ✓ right`.

**`architecture`**
- ✗ `type: "sf.Link"` to connect two shapes → ✓ `type: "standard.Link"` with `source`/`target` `{id, port}`. `sf.Link` is a standalone clickable-URL pill ELEMENT (a `url`-prop node with no ports), not a connector.
- ✗ invented endpoint port names (`"right"`, `"out"`, `"port-1"`) → ✓ the four baked-in ids verbatim: `port-top` / `port-right` / `port-bottom` / `port-left` (they exist even if you omit the element's `ports` block - **except `sf.DataObject`**, whose ring is only `port-top` / `port-bottom`; it relates through the header `er-left` / `er-right` or a field port, and a `port-left` / `port-right` on it does NOT throw - the line just lands on the card body. `validate-diagram.mjs` warns).
- ✗ a one-sided embed (child in the Container's `embeds[]` but no `parent` on the child, or vice-versa) → ✓ set BOTH: the child id in the parent's `embeds` AND `parent: "<container-id>"` on the child (the loader does not reconcile the missing half). Position the child below the 40px header.
- ✗ explicit `fill`/`stroke` on an arrow `targetMarker` → ✓ OMIT `targetMarker` (the loader normalises it to `M 0 -6 L -14 0 L 0 6 z`); `fill`/`stroke` are only for ER crow's-foot markers.

**`process`**
- ✗ hand-writing an event's colours or a gateway's glyph that disagree with its `eventType` / `gatewayType` → ✓ set just the discriminator: the loader applies the matching look (event ring and fill; gateway glyph `×` / `+` / `○` / `◇`). Authored `attrs` win over the prop, so leave them out unless you mean to override it.
- ✗ `targetMarker: {type:"none"}` (or a marker object with no `d`) to get an undirected line - the loader drops it and the default arrowhead returns → ✓ for no arrowhead use the None stub `{ "type": "path", "d": "M 0 0 L -12 0" }`; for a directed flow OMIT `targetMarker`. `sourceMarker` is NOT auto-arrowed.
- ✗ linking TO a `sf.BpmnPool` (it has no ports) → ✓ attach links to the step shapes (Task/Event/Gateway); embed steps with `parent:"pool-id"` + the id in the pool's `embeds[]`.
- ✗ `sf.Container` lanes drawn BEHIND their cards with an empty `embeds[]` → ✓ set BOTH sides on every card (`embeds[]` + `parent`); an undeclared frame is decorative and doesn't group-move. See [Capture](#capture-put-cards-inside-a-frame-dont-just-draw-one-behind-them).
- ✗ varying card size to make a layout fit, or sizing each lane to its own card count → ✓ ONE card size for the whole diagram and ONE height for every lane. See [Container lanes](#container-lanes-columns-of-grouped-cards).

**`flow`** (Salesforce Flow - see the [Flow Shapes](#flow-shapes-salesforce-flow-diagrams) reference)
- ✗ putting the element name/label inside `attrs.label.text` → ✓ set the TOP-LEVEL `name` prop (it drives the card label via the model); the element TYPE renders as the grey subtitle automatically (shown once `name` differs from the type); `apiName`, `description` + the per-kind fields are also top-level documentation metadata (edited in the panel, NOT shown on the card). Nothing element-specific goes in `attrs`.
- ✗ setting `attrs.icon.href` (or inventing an icon) → ✓ OMIT it entirely - each `df.Flow*` class bakes its own canonical white SLDS glyph when the href is empty. An authored href REPLACES that glyph.
- ✗ `type:"sf.Link"` / a BPMN gateway to branch a decision → ✓ `type:"standard.Link"` with `source`/`target` `{id, port}` between `df.Flow*` cells; the four baked-in port ids (`port-top`/`port-right`/`port-bottom`/`port-left`) apply. A flow connector is **Standard** (grey, the default), **Fault** (set `attrs.line.stroke` to `#EA001E`), **Go To** (set `attrs.line.stroke` to the Go To blue `#0B5CAB` - a dotted jump to an existing element), or **Loop** (set top-level `flowKind:"loop"` on a Loop element's two branches - grey like Standard but with an arrowhead, v1.22.0) - see [Flow connectors](#flow-shapes-salesforce-flow-diagrams). Add outcome/loop labels via `labels`.
- ✗ mixing `processType` and `triggerType` values → ✓ `processType` is the FLOW-level kind (`Flow` = screen flow, `AutoLaunchedFlow`, `Orchestrator`, `EvaluationFlow`, `Survey`, `Journey`, `PromptFlow`, `CheckoutFlow`, `RoutingFlow`, `Workflow`, `CustomEvent`, `InvocableProcess`, … - this is the complete standard set); `triggerType` exists only on an autolaunched Start (`RecordAfterSave`/`RecordBeforeSave`/`RecordBeforeDelete`/`Scheduled`/`PlatformEvent`/`DataCloudDataChange`/`DataGraphDataChange`/`AutomationEvent`/`ExternalSystemChange`/`EnterpriseScaleExternalSystemChange`/`Activation`/`Segment`/`CampaignMember`/`CrmRecordQuery`/`List`/`ScheduledJourney`/`Capability`/`FormSubmissionEvent`/`IndivRelatedRecord`). A screen flow's Start has no `triggerType`. In the property panel these two Start fields are FREE-TEXT inputs with a datalist of the most popular values as suggestions (`renderers-flow.js`) - type any value; the JSON value is always a free string. Every per-kind field is free text - never validated.
- ✗ reaching for a `df.FlowDecision` diamond or a BPMN gateway to show a branch → ✓ every element is the SAME uniform card (`210 x 56`); the branch is expressed by the outgoing `standard.Link`s, not by the element shape.

**`datamodel`**
- ✗ emitting a `ports` block on an `sf.DataObject` → ✓ omit it entirely - the loader rebuilds `port-top`/`port-bottom`, `er-left`/`er-right`, and one `field-{left,right}-<fid>` per keyed field. Only REFERENCE a port from a link endpoint.
- ✗ referencing a `field-…-<fid>` whose `<fid>` no field carries → ✓ copy the `fid` verbatim from that object's `fields`. A field you anchor a relationship on should carry `keyType: "fk"` (or `"pk"`) - the port is built for any linked field regardless, but the key flag is what the schema table reports. Do NOT "fall back" to the header `er-left` / `er-right` for a field-level relationship: that is a different LEVEL (object-level), and the Table view reports it as such.
- ✗ a crow's-foot ER marker with a solid `fill` matching the stroke → ✓ open markers (many/one/oneMany) `fill:"none"`; circle markers (zeroOne/zeroMany) `fill:"var(--bg-canvas, #1A1A1A)"`. A solid fill on a canonical crow's-foot path is NOT healed on load: the glyph renders as a filled wedge on the canvas while the Table view, which reads the path only, still reports Many.
- ✗ a relationship between two DataObjects with NO ER marker on either end (an omitted `targetMarker` becomes a plain arrow) → ✓ set BOTH `sourceMarker` and `targetMarker` to Marker Types ER paths; a marker-less link loads and draws, but carries no cardinality - the Table view reads an em-dash (`validate-diagram.mjs` warns).
- ✗ tagging a plain object-to-object relationship with `linkKind:"mapping"` → ✓ a pure ER relationship link carries NO `linkKind` - its absence is what marks it.

**`datamapping`** (additive - see the Data Cloud mapping checklist below)
- ✗ `category` omitted, nested in `attrs`, or keyed `objectCategory` → ✓ top-level `"category": "Profile"`|`"Engagement"`|`"Other"` on each DLO/DMO cell.
- ✗ a mapping link with explicit `router`/`connector` or ER markers, or no `linkKind` → ✓ `linkKind:"mapping"` + a `mappingType` from `Standard`/`Formula`/`Streaming Transform`/`Batch Transform`/`Calculated Insight`; the loader applies `sfMappingRouter`/`sfMappingConnector` **and the amber 1 px line** itself (v1.22.0).
- ✗ a layer as `sf.Container`, or `layerStage` on the DataObject → ✓ each layer is an `sf.Zone` with top-level `layerStage` in `source`/`datastream`/`dlo`/`dmo`/`activation`.

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
- ✗ leaving a reply solid → ✓ set top-level `lineStyle:"6 4"` (an authored `attrs.line.strokeDasharray` is moved into `lineStyle` on load, so either works; `lineStyle` is the form the app saves); a reply also swaps direction (`source seq-port-left-<i>` → `target seq-port-right-<i>`).

## Cell Structure (Elements)

Every element in the `cells` array follows this structure:

```json
{
  "id": "unique-id-1",
  "type": "sf.SimpleNode",
  "position": { "x": 100, "y": 200 },
  "size": { "width": 180, "height": 64 },
  "z": 2000,
  "attrs": { /* shape-specific visual attributes */ }
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
| `parent` | Optional. Id of the frame that OWNS this cell. MUST be paired with the frame listing this id in its `embeds[]` - see [Capture](#capture-put-cards-inside-a-frame-dont-just-draw-one-behind-them). A one-sided declaration is not reconciled on load. |
| `embeds` | Optional, frames only (Zone / Container / Pool / Subprocess / Loop / TaskGroup / Task / GanttTimeline). Ids of the cells this frame owns. MUST be paired with `parent` on each child. A frame merely drawn behind cells is decorative. |

### Z-Order Values

Assign these `z` values to keep layers rendering correctly:

| Shape Type | Z Value | Layer |
|-----------|---------|-------|
| Zone, BpmnPool, TaskGroup | `0` | Background |
| BpmnSubprocess, BpmnLoop, SequenceFragment, Task | `500` | Sub-containers |
| Container, GanttTimeline, GanttGroup | `1000` | Containers |
| Image | `1500` | Pictures behind the cards |
| SimpleNode, Note, TextLabel, Line, Link, DataObject, OrgPerson, all Bpmn/Flow shapes, GanttTask, GanttMilestone, GanttMarker, SequenceParticipant, SequenceActor | `2000` | Elements |
| SequenceActivation | `2200` | Overlays on top of elements |
| `df.Table` | `2300` | Tables |
| `df.Pill`, `df.Legend` | `2400` | Badges and keys |
| Links | `3000` or higher | Connections |

An authored `z` survives load, so a frame given an element's `2000` covers its own children - use the tier above.

### Port Definitions

**Omit `ports` on every element.** Each connectable shape builds its own from its class: the four ring ports
`port-top` / `port-right` / `port-bottom` / `port-left`, plus the DataObject header (`er-left` / `er-right`) and
field ports, and the sequence lifeline ports. Reference them by id from a link endpoint. Never emit a `ports` block,
least of all a partial one: dropping "unused" ports - a common LLM mistake - strips the anchors a user needs to wire
new connections after generation.

Shapes with NO ports (a link cannot attach to them): `sf.TextLabel`, `sf.Note`, `sf.Line`, `sf.Link`, `sf.Image`,
`sf.Zone`, `sf.TaskGroup`, `sf.BpmnPool`, `sf.SequenceFragment`, `sf.GanttTimeline`, `df.Pill`, `df.Legend`,
`df.Table`.

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
| `router` | Yes* | `{ "name": "sfManhattan" }` for orthogonal routing. *Omit it only where the loader sets it: `linkKind: "mapping"` and `linkKind: "ganttDep"` links, and Flow connectors (an end on a `df.Flow*` card). Sequence messages use `{ "name": "normal" }`. Anywhere else a missing router draws a straight diagonal (the validator warns) |
| `connector` | Yes* | `{ "name": "rounded", "args": { "radius": 8 } }` with `sfManhattan`; the same exceptions as `router` (sequence: `{ "name": "normal" }`) |
| `vertices` | No | Array of `{ "x": n, "y": n }` waypoints for manual routing |
| `labels` | No | Array of label objects (see below) |
| `lineStyle` | No | Dashed/dotted dash pattern as a raw SVG `stroke-dasharray` string (`"8 4"` dashed, `"2 4"` dotted, `"6 4"` for sequence replies). Stored as a **top-level cell property** — NOT `attrs.line.strokeDasharray`. Rendered as a bg-coloured overlay clone because Safari leaks `stroke-dasharray` into `<marker>` content. Omitted / `null` means solid. |
| `linkKind` | No | `"mapping"` marks a Data Cloud source→DMO field mapping; `"ganttDep"` a Gantt dependency. Top-level cell property; absent on an ER relationship. Set the prop and nothing else: the loader applies the mapping look (amber `#A06F03`, 1 px, one arrow, its own field-port routing) or the dependency look. |
| `mappingType` | No | Data Cloud transform classification of a mapping link (v1.15.0): one of `"Standard"` (direct copy, the default applied to a fresh mapping), `"Formula"`, `"Streaming Transform"`, `"Batch Transform"`, or `"Calculated Insight"`. Top-level cell property, authored via the link inspector's **Mapping type** picklist; surfaced in the table view's **Mapping Type** column. A **non-Standard** value renders an outlined **monospace** code token (`F` / `ST` / `BT` / `CI`, tinted to the connector colour) as a link label on the target stub (see Link Labels); **Standard renders no token**. `migrateLinks` re-syncs tokens on load. |
| `expressionRule` | No | The transform **expression / rule** note for a non-Standard mapping link (v1.15.0; was briefly `mappingLabel` pre-release, still read as a fallback). Top-level cell property, authored via the link inspector's progressively-disclosed **Expression / rules** field (shown whenever `mappingType` ≠ `"Standard"`); surfaced in the table view's **Expression / Rule** column (empty ⇒ dimmed em-dash). Distinct from the link's visual `labels`. |
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

**Labels the app builds for you.** A non-Standard mapping link's type token (`F` / `ST` / `BT` / `CI`) and an
Architecture link's frequency label (clock + cadence, below the line) are generated from `mappingType` and
`connectionFrequency` on every load. Set the prop; never author those labels.

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
2. **If you hardcode a SimpleNode's `body.fill`, leave its text on the theme default** — the loader picks the text colour against the explicit solid fill by WCAG contrast (the rule the tab-group chips use): near-black `#1C1E21` on light and mid fills, which includes **nine of the ten palette accents**, and light `#F5F6F7` on dark fills and on the palette **blue**. *(An explicit `label.fill` / `subtitle.fill` is always respected; if you set one, follow the same rule - white text on a palette accent other than blue is 4.0-4.4:1, under the 4.5:1 text floor.)*
3. **Use hardcoded colour where it carries meaning, on the parts that read on any background** — `stroke` (borders), `accent` (Container/Zone bars), brand-coloured `body.fill`. A coloured *stroke* on a theme-default body reads on both themes, and so does a coloured *body* whose text follows rule 2.
4. **Translucent fills** (`rgba(…, 0.03)` Zone/Layer tints) intentionally show the canvas through them, so they stay theme-adaptive and are *not* auto-contrasted — leave their labels on the theme default.
5. **Every hardcoded colour must clear 3:1 against BOTH canvas backgrounds.** See below - this is the rule that makes point 3's "reads on any background" checkable instead of a hope.

### The both-themes rule (pick colours from this palette)

The canvas is `--bg-canvas`: **`#FAFAFA`** in light, **`#1A1A1A`** in dark. A diagram travels as a share URL and gets opened by someone in the other theme, so "it looked fine while I authored it" is not evidence. Any colour you hardcode on a **card header, zone accent, connector stroke, marker or badge** must clear **WCAG's 3:1 non-text-contrast floor against both**.

This bites hardest on connectors, because a card header is a filled block and a connector is 2px of the same value. A `#321D71` header is merely dim on dark; the relationship line inheriting it is **1.28:1 - invisible**.

Pick from this palette and the rule is satisfied by construction. Every entry is >= 3.5:1 on both, and no two are closer than deltaE 26.8, so they stay tellable apart:

| Name | Hex | vs `#FAFAFA` | vs `#1A1A1A` |
|---|---|---|---|
| blue | `#1D73C9` | 4.63 | 3.60 |
| orange | `#BE5C2A` | 4.23 | 3.94 |
| green | `#008B46` | 4.21 | 3.96 |
| purple | `#B652A7` | 4.23 | 3.94 |
| cyan | `#00849E` | 4.20 | 3.97 |
| red | `#DA4E55` | 3.87 | 4.31 |
| indigo | `#8467C9` | 4.22 | 3.95 |
| teal | `#008877` | 4.20 | 3.97 |
| amber | `#A06F03` | 4.22 | 3.95 |
| olive | `#747F00` | 4.21 | 3.96 |
| neutral (plain structural lines) | `#74797F` | 4.21 | 3.96 |

Use them **in that order** when you need N distinct accents (one per object, per layer, per tree depth): the order is tuned so neighbouring entries are the most different, which is what matters when the reader sees them side by side. For a severity or risk ramp use `green -> olive -> amber -> orange -> red`.

Two things the numbers explain that are otherwise surprising:

- **Every entry is a mid-tone.** Clearing 3:1 on a near-white *and* a near-black background confines relative luminance to a narrow band, and the best any single colour can do on both at once is 4.13:1. So there are no pale pastels and no deep navies here - all the separation comes from hue and chroma. Do not "brighten" one of these; you will push it off the dark canvas or off the light one.
- **Older diagrams carry two retired stage colours**, `#F6B355` (DLO amber) and `#27AE60` (Activation green), at 1.75 and 2.75 on light. Use `#A06F03` and `#008B46`.

Colours that are **not** on the canvas (modal chrome, export-only text fills) are outside this rule - they answer to the contrast of whatever surface they sit on.

**Two hexes in this spec are PROTOCOL tokens, not colour choices, and you must use them exactly as written:** the Flow fault red `#EA001E` and the Flow Go To blue `#0B5CAB`. A flow connector stores no type field, so the loader reads its **stroke** to decide what kind of connector it is. Substitute a palette colour and you do not recolour a Go To - you stop it being one (no dotted line, no destination label). The Go To blue is under the floor on the dark canvas (2.60:1) and is a known exception; use it anyway.


> ⚠️ The auto-contrast safety net covers `sf.SimpleNode` label/subtitle. For richer shapes (Container header, DataObject), prefer theme defaults or pair a coloured bar with `"#FFFFFF"` text.

---

## Shape Reference

The generic net-new shapes `df.Placeholder`, `df.Pill`, `df.Legend` and `df.Table` are described under
[Diagram Types](#diagram-types).

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
  }
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
| **Data Model / Data Mapping headers** (`sf.DataObject` `headerIcon/href`) | `individual` (Individual / Unified Individual) · `contact` (CRM Contact/Lead) · `email` · `sms` (Phone / SMS) · `push` (Mobile App / Contact Point App) · `phone_portrait` (Device) · `connected_apps` (Software Application) · `record_consent` (Consent / Subscription Consent / Preference Centre) · `broadcast` (Communication Subscription) · `topic2` (Channel Type) · `record` (Status / Purpose / Legal Basis lookups) · `address` (Contact Point Address) · `account` (Account / Account junctions) · `data_lake_objects` (DLO) · `data_mapping` (Data Stream / Unified Link) |
| **Flow elements** (`df.Flow*` - AUTO-applied, do not set) | Each `df.Flow*` class bakes its own white SLDS glyph on load. Never set an icon on a flow card. |

> These tables are the **complete allowed set** — do **not** use an ID that is not listed, even if it sounds like a plausible SLDS name (an unknown ID renders an invisible blank, with no error). If no listed token fits the concept, leave `href` as `""`. Note: the minimal href is **expanded to the full SVG on load**, so a generated file and its loaded/saved form are not byte-identical — this matches how in-app icon drops are already stored, and `contentSignature` (used for import dedup) reflects the resolved full href.

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
  }
}
```

**Embedding children:** To visually nest elements inside a container, set the `parent` field on child cells and add their IDs to the container's `embeds` array:

```json
// On the container:
{ "id": "container-1", "type": "sf.Container", "embeds": ["node-1", "node-2"], ... }

// On each child:
{ "id": "node-1", "type": "sf.SimpleNode", "parent": "container-1", ... }
```

Position children so they fall within the container's bounds - **48px** clear of the left, right and bottom
edges, and at least 48px below the 40px header (`container.y + 88`). Less than 32px and the connectors into
those children draw on the container's own border; see [Layout Tips](#layout-tips).

**`manualSize` (since v1.23.0)** — Optional top-level boolean. `true` pins the frame's geometry: the in-app
content-hug (which otherwise re-wraps a frame around its children on every child move) skips it. Set this when
the frame is deliberately bigger than its contents - uniform lane heights, reserved space. Cleared by the
right-click **Auto size** action; a resize-handle drag sets it. Absent/false = the frame hugs its children.

**Accent colors:** Change `accent/fill` and `accentFill/fill` together to set the header bar color. Pick from the
[palette](#the-both-themes-rule-pick-colours-from-this-palette): an accent must clear 3:1 on both canvases, and the
familiar brand navies and pastels do not (`#032E61` is 1.30:1 on dark, `#F49825` 2.15:1 on light).

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

No ports. A Zone groups by **embedding**, not by geometry: set `parent: "<zone-id>"` on every child AND list each child id in the Zone's `embeds[]` - both sides, every child. A Zone merely drawn behind cards is decorative (no group-move, no auto-size; `validate-diagram.mjs` warns). See [Capture](#capture-put-cards-inside-a-frame-dont-just-draw-one-behind-them). The one deliberate exception is a Salesforce Flow's stage bands (see below).

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
    "label": { "text": "Note Title" },
    "subtitle": { "text": "The body goes here - **markdown** works" }
  }
}
```

- `label` is a ONE-line title (longer text is cut with an ellipsis). Put the body in `subtitle`: it renders markdown
  and the note grows to fit it (never shorter than 120).
- The yellow look is the default; set `body.fill` / `body.stroke` to recolour. The folded corner follows `body.stroke`.
- An empty `icon.href` gets the default light-bulb on load. To keep a note icon-free, set top-level
  `"iconCleared": true`.

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
  "lineStyle": "dashed",
  "attrs": { "label": { "text": "Optional caption" } }
}
```

**`attrs.label.text`** — optional caption rendered above the line's left edge, left-aligned. Empty by default.
Supports the same inline markdown as Notes (`**bold**`, `*italic*`, `~~strike~~`, `` `code` ``); underscores are
literal (not italic).

**`lineStyle`** — `"solid"` (default), `"dashed"`, `"dotted"`, or `"breaks"`. Set the prop; the loader applies the
matching dash (`none`, `12 6`, `0 6`, `16 8`) to `attrs.line.strokeDasharray`. Recolour with `attrs.line.stroke`.

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
  "attrs": { "label": { "text": "API Docs" } }
}
```

**`url`** — Target URL. Opened in a new tab (`noopener,noreferrer`) when the icon is clicked; the full URL is the
hover tooltip. Empty string disables click-through.

Author only `url` and the label text. The loader draws the external-link icon from the label colour when
`iconImage.href` is empty - an authored `href` placeholder draws an empty circle instead - and it hides the old
`domain` sub-line and centres the label, so leave both out.

No ports.

### sf.DataObject

Database table / Salesforce object with coloured header and dynamic field rows. Used in data model diagrams.

**Default size:** `260 x 80` (height auto-adjusts: see the Sizing rule below)

```json
{
  "id": "obj-1",
  "type": "sf.DataObject",
  "position": { "x": 100, "y": 100 },
  "size": { "width": 260, "height": 138 },
  "z": 2000,
  "objectName": "Account",
  "headerColor": "#1D73C9",
  "fields": [
    { "label": "Id", "apiName": "Id", "type": "ID", "keyType": "pk", "length": null, "required": true, "deprecated": false },
    { "label": "Name", "apiName": "Name", "type": "Text", "keyType": null, "length": 255, "required": true, "deprecated": false },
    { "label": "Industry", "apiName": "Industry", "type": "Picklist", "keyType": null, "length": null, "required": false, "deprecated": false },
    { "label": "Owner", "apiName": "OwnerId", "type": "Lookup", "keyType": "fk", "length": null, "required": true, "deprecated": false }
  ],
  "showLabels": false,
  "showFieldLengths": false,
  "keyFieldsOnly": false
}
```

**`objectName` and `headerColor` draw the header.** Set the props; the loader writes them to the header's attrs
(`headerLabel.text`, and `header.fill` + `headerCover.fill`). Do not also author those attrs unless they say the same
thing: authored attrs win over the props, and the validator warns when they disagree. Omit `ports` (see Linking
DataObjects below).

**Field object structure:**

| Field | Type | Description |
|-------|------|-------------|
| `label` | string | Display name - **the primary text drawn on each field row** (v1.20.0, label-first); an empty label falls back to `apiName` |
| `apiName` | string | API/column name - the stable field identity (CSV round-trips and mapping links key off it); drawn in parentheses after the label when `showLabels` is on and it differs |
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
| `showLabels` | `false` | Show the `apiName` in parentheses after the label where they differ (v1.20.0 - the "API Names" View toggle; pre-1.20 the same flag appended the label to an apiName-first row, so old saves render both names either way) |
| `showFieldLengths` | `false` | Show `(length)` suffix next to the type |
| `keyFieldsOnly` | `false` | When `true`, only fields with `keyType` (PK/FK) are rendered; the object height shrinks to fit |
| `collapsed` | `false` | When `true`, the object renders **header-only** (all field rows hidden, height = `32 + 18`); a bottom toggle row flips it. Mapping links converge to the header while collapsed. Top-level prop; omit it for a normal expanded object. |

**Data Cloud metadata (mapping mode, v1.15.0):** an optional object-level attribute, omitted when blank. Editable in the DataObject panel's **Data Mapping** section (a three-position segmented slider) and drawn as a hollow header pill only in a Data Mapping diagram; it round-trips in any type.

| Attr | Type | Description |
|------|------|-------------|
| `category` | `"Profile"` / `"Engagement"` / `"Other"` | Data Cloud DMO category (platform-enforced). The one object-level mapping attribute. |

**Optional header icon (`headerIcon/href`, v1.15.0):** an optional contextual SLDS / custom icon in the header bar (e.g. `account`, `contact`, `email`, `custom-snowflake` - bare SLDS names or `custom-*` brand logos, NOT a `standard-` prefix; see the [Icon ID reference](#icon-id-reference)) to make a large schema scannable at a glance — empty by default. Uses the **same `data-icon-id` data-URI pattern** as the Node `icon/href` (above) and resolves to white via `refreshAllIconHrefs`. When set, the icon renders at `16×16` on the header's left (`x:10, y:8`) and `headerLabel/x` shifts to `32`; when blank, `headerIcon` collapses to `width/height:0` and `headerLabel/x` returns to `12`. `updateDataObjectHeaderLayout` applies this on edit + on load. Persists in `attrs.headerIcon.href`; no separate top-level prop.

**Sizing rule:** Set height to `32 + (max(visibleFields, 1) * 22) + 18` — that's `HEADER (32) + rows·ROW (22) + the collapse-toggle row (18)`. The custom view auto-renders the field rows **and** the bottom toggle row. `visibleFields` equals `fields.length` unless `keyFieldsOnly` is `true` (only `keyType` fields counted) or `collapsed` is `true` (zero rows → height `32 + 18 = 50`). If you get the height slightly wrong the app self-heals it on load (`migrateNodes` recomputes every DataObject to this formula), but emitting it correctly avoids a one-frame reflow.

**Linking DataObjects for ER diagrams:**

Omit `ports`: the app builds every DataObject port on load. Reference them from link endpoints:

1. **Object-level ports** — the header anchors `er-left` / `er-right` (the usual choice for an ER relationship) and
   the ring `port-top` / `port-bottom` — for "this table relates to that table" links. There is no `port-left` /
   `port-right` on a DataObject.
2. **Field-level ports (`field-left-{fid}`, `field-right-{fid}`)** — for field→field mappings and PK→FK relationships. The view renders one for every field with a `keyType`, **every field when the diagram's mapping mode is on** (so all of `datamapping`), and any field a live link points at. `{fid}` is the field's stable `fid` (see field table), **not** its array index, so a link stays anchored to the same field across reorder, delete, and rename. *(Saves ≤ v1.14.x used the zero-based array index, `field-left-{i}`; `migrateLinks` re-keys those to `fid` form on load.)*

Just reference them from link endpoints: `"source": { "id": "obj-contact", "port": "field-right-<fid>" }` — where `<fid>` is copied verbatim from a field in that object.

Apply ER markers (see Marker Types section) to represent cardinality.

> **Which level the app reports.** The Table view's Relationships grid (1.23.2) classifies every ER link by its
> PORT ids: **Field-level** when EITHER end names a `field-left-<fid>` / `field-right-<fid>` port, **Object-level**
> otherwise (`er-left` / `er-right`, `port-top` / `port-bottom`). Pick the level by what you know: a relationship
> carried by a key field (FK -> PK) is field-level - anchor the child's FK field; a relationship you only know at
> object grain is object-level - anchor the headers. Never mix the two for the same pair.
>
> **Orientation.** Cardinality is read PER END from the markers and reported `source-end:target-end` exactly as
> drawn, beside the From/To objects - so the same fact reads `1:Many` drawn parent -> child and `Many:1` drawn
> child -> parent, and both are correct left-to-right. Within one diagram use ONE direction: draw **from the ONE
> (parent / PK) end to the MANY (child / FK) end** - `sourceMarker` = bar (1) or circle-bar (0..1),
> `targetMarker` = crow's foot (Many / 0..Many / 1..Many). The bundled ERD generator draws child FK field ->
> parent header, so its rows read `Many:1`; that is the same convention seen from the child.

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
  "jobTitle": "VP Engineering - Platform & Data",
  "iconText": "JS",
  "details": [
    { "label": "Email", "value": "jane@example.com" },
    { "label": "Location", "value": "London" }
  ],
  "tags": ["leadership", "platform"],
  "raci": { "R": true, "A": true },
  "vacant": false,
  "attrs": { "accentBar": { "fill": "#1D73C9" }, "accentBarMask": { "fill": "#1D73C9" } }
}
```

**Tips:**
- The view draws every label from the props above and overwrites the label attrs on each render - author the props,
  never `nameLabel` / `positionLabel` / `detailsLabel`.
- `iconText` is 1-4 characters for the avatar (typically initials); `imageUrl` takes a photo instead. The avatar
  colour is not yours to set: blue with initials, grey without.
- The top bar is the colour you control: `accentBar.fill` and `accentBarMask.fill`, together.
- Size is computed: height never below 90 (the avatar), growing 14 px per detail line once the text outgrows it and
  30 px for a tag row; width never below 280 - a narrower card is widened on load, so leave room on the pitch.

**`details` (since v1.11)** — Extensible array of `{ label, value }` rows shown beneath the position label. The view renders one line per entry where `value` is non-empty; empty rows are hidden. Entries with `value === ""` are kept in the model so the user can fill them in later.

**`tags` (since v1.10)** — Array of strings rendered as muted pills along the bottom of the card. Empty array hides the tag row entirely. If many tags would overflow the card width, the trailing ones are hidden behind a `+N` overflow chip whose hover tooltip shows the missing tags.

**`raci` (since v1.10)** — Object `{ R?, A?, C?, I? }` of booleans. Each truthy key renders a coloured pill in the top-right corner with the letter (R/A/C/I) and a tooltip for the full role name (Responsible / Accountable / Consulted / Informed). Multiple roles allowed simultaneously. Pill colours: R=brand blue (`#1D73C9`), A=brand red (`#DA4E55`), C=brand amber (`#F6B355`), I=neutral grey (`#8A9099`).

**`vacant` (since v1.10)** — When `true`, the card renders with dashed body border, dashed transparent avatar (no fill), and faded text/details (~55 % opacity). Use as a recruitment placeholder ("position to be filled") or to mark an unassigned RACI slot.

**`jobTitle`** is the line under the name (the panel calls it "Description"); `\n` makes further lines.

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
  "attrs": { "label": { "text": "Start" } }
}
```

**Event types** - set `eventType`; the loader applies the look (leave `body` / `innerRing` / `icon` attrs out, or
they win over it):
- `"start"` — green ring (`#008B46`, 1.5 px) on a pale green fill
- `"intermediate"` — amber double ring (`#A06F03`)
- `"end"` — red ring (`#DA4E55`, 4 px) on a pale red fill

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
  "attrs": { "label": { "text": "Review Order" } }
}
```

**`taskType`** (`"task"`, `"user"`, `"service"`, `"script"`, `"send"`, `"receive"`) is stored and shown in the panel
only - nothing on the card changes with it. Say the kind in the label if the reader needs it.

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
  "gatewayType": "parallel",
  "attrs": { "label": { "text": "" } }
}
```

**`gatewayType`** — `"exclusive"` (`×`, the default), `"parallel"` (`+`), `"inclusive"` (`○`), `"event"` (`◇`). Set the
prop; the loader draws the glyph (`attrs.marker.text`). An authored glyph that says a different gateway wins and the
validator warns.

#### sf.BpmnSubprocess

Rounded rectangle container with [+] marker.

**Default size:** `360 x 240`, **z:** `500`

A `body`, a single-line top-left `label` and the `[+]` marker at the bottom - there is NO Container-style header.
Name it with `attrs.label.text`, exactly like `sf.BpmnLoop` below.

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
  "attrs": { "label": { "text": "Process Each Order" } }
}
```

#### sf.BpmnPool

Pool/lane container, horizontal by default.

**Default size:** `600 x 250`, **z:** `0`

Has a narrow left `header` panel with a rotated vertical label. For a VERTICAL pool set top-level
`"poolDirection": "vertical"`, size `250 x 600`, `attrs.header` `{ "width": "calc(w)", "height": 30 }` and
`attrs.label` `{ "x": "calc(0.5 * w)", "y": 15, "transform": "rotate(0)" }` (what the stencil builds). No ports. A Pool groups by **embedding**, not by geometry: set `parent: "<pool-id>"` on every child AND list each child id in the Pool's `embeds[]` - both sides, every child. A Pool drawn behind tasks without that is decorative (no group-move, no auto-size; `validate-diagram.mjs` warns). See [Capture](#capture-put-cards-inside-a-frame-dont-just-draw-one-behind-them).

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
  "attrs": { "label": { "text": "Invoice" } }
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

All have standard 4-port configuration.

### sf.Annotation

A curly-brace bracket with a text label — used to call out or group a region of a diagram, in any diagram type (it is a generic stencil shape). The brace spans the element's height on one side; the label sits beside it. Standard 4-port configuration.

**Default size:** `100 x 120`, **z:** `2000`

**Properties:**
- `bracketSide` — `"right"` (default) or `"left"`. Set the prop; the loader draws the brace on that side and moves the label beside it.

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
  }
}
```

### Flow Shapes (Salesforce Flow Diagrams)

`diagramType: "flow"`. These `df.Flow*` classes document a **Salesforce Flow** with its real element vocabulary. They are DISTINCT from the generic `sf.Flow*` flowchart shapes (which belong to `process`). Every element is the **same uniform card** - a rounded body with a coloured icon chip (left) and a label - so you distinguish elements by their `type` and icon, and express branching with the outgoing `standard.Link`s, not by the shape.

**Shared structure (identical for every `df.Flow*` class).** Default size `210 x 56`. Persisted data lives in TOP-LEVEL props, NOT `attrs`:

- `name` (string) - the visible card label. Seed it; it drives `attrs.label.text` via the model.
- `apiName` (string, optional) - the Flow element's API name, shown in the panel only. The card's grey subtitle is the element TYPE ("Get Records"), drawn automatically once `name` differs from it.
- `details` (array, optional, since v1.21.0) - `[{ "label": "...", "value": "..." }]` rows rendered as a
  read-only **Metadata** table in the property panel, never on the card. A row may add **`"quiet": true`**
  (v1.22.0): quiet rows render inside a collapsed "N settings turned off" disclosure below the table instead of
  inline - use it for a flag whose value is an explicit `false`, which is an answer worth keeping ("this is NOT
  a template") but not what the reader came for. Quiet rows do not count against the ~20-row cap. This is where the long tail goes: the
  fields a Create/Update actually WRITES, the fields a Get reads out and into which variables, a screen's full
  component list with types, each decision outcome's condition, an action's input parameters. Both sides are
  FREE TEXT - nothing is parsed or validated, and nothing in the app keys off these rows, so use whatever
  labels read best. Keep the per-kind `fields` above for the one-line facts that belong on the card and use
  `details` for everything that would not fit on one; a row list beyond ~20 entries is better truncated with a
  final `{"label": "+N more"}` row than dumped in full.
- `description` (string, optional) - free text.
- per-kind fields (see the table) - all FREE TEXT, never validated.

**Omit `attrs.icon.href`** - each class bakes its own white SLDS glyph on load. You may omit the `attrs` block entirely; a minimal cell is just `type` + `id` + `position` + `size` + `name` (+ any per-kind fields). Connect elements with `standard.Link` between the four baked-in ports (`port-top`/`port-right`/`port-bottom`/`port-left`).

| `type` | Card label | Flow metadata element | Per-kind fields (free text) |
|---|---|---|---|
| `df.FlowStart` | Start | `start` | `processType`, `triggerType`, `object`, `filters`, `configuration` |
| `df.FlowEnd` | End | *(UI-only; no metadata element)* | *(none)* |
| `df.FlowScreen` | Screen | `screens` | `components` |
| `df.FlowAction` | Action | `actionCalls` | `actionName`, `actionType` |
| `df.FlowSubflow` | Subflow | `subflows` | `flowName` |
| `df.FlowSendToFlow` | Send to a Flow | `subflows` | `flowName` |
| `df.FlowSendEmail` | Send Email Message | `actionCalls` | `template` (panel label "Email") |
| `df.FlowSendSms` | Send SMS Message | `actionCalls` | `template` (panel label "SMS") |
| `df.FlowSendWhatsApp` | Send WhatsApp Message | `actionCalls` | `template` (panel label "Message") |
| `df.FlowSendToData360` | Send to Data 360 Activation | `actionCalls` | `activation` |
| `df.FlowSendMobileApp` | Send Mobile App Message | `actionCalls` | `template` (panel label "Push Notification Message") |
| `df.FlowSendMobileInApp` | Send Mobile In-App Message | `actionCalls` | `template` (panel label "In-App Message") |
| `df.FlowForwardToBot` | Forward to Bot or Agent | `actionCalls` | `actionName` |
| `df.FlowRunAgent` | Run Agent | `actionCalls` (GENERATE_AI_AGENT_RESPONSE) | `actionName` |
| `df.FlowCreateCampaignMember` | Create Campaign Member | `actionCalls` | `actionName`, `object` |
| `df.FlowCreateTask` | Create Task | `actionCalls` | `actionName` |
| `df.FlowExit` | Exit from a Flow | *(UI-only; REMOVE_FROM_FLOW)* | *(none)* |
| `df.FlowAssignment` | Assignment | `assignments` | `assignmentItems` |
| `df.FlowDecision` | Decision | `decisions` | `outcomes` |
| `df.FlowLoop` | Loop | `loops` | `collectionReference` |
| `df.FlowTransform` | Transform | `transforms` | `transformTarget` |
| `df.FlowPathExperiment` | Path Experiment | `experiments` | `outcomes` |
| `df.FlowCollectionSort` | Collection Sort | `collectionProcessors` (Sort) | `collectionReference` |
| `df.FlowCollectionFilter` | Collection Filter | `collectionProcessors` (Filter) | `collectionReference`, `conditions` |
| `df.FlowWait` | Wait for Amount of Time | `waits` | `waitEvents` |
| `df.FlowWaitUntilDate` | Wait Until Date | `waits` | `waitEvents` |
| `df.FlowWaitUntilEvent` | Wait Until Event | `waits` | `waitEvents` |
| `df.FlowEinsteinDecision` | Einstein Decision | `actionCalls` | `actionName` |
| `df.FlowDetermineCrmRecord` | Determine CRM Record for Individual | `actionCalls` | `actionName` |
| `df.FlowGetRecords` | Get Records | `recordLookups` | `object`, `filters` |
| `df.FlowCreateRecords` | Create Records | `recordCreates` | `object` |
| `df.FlowUpdateRecords` | Update Records | `recordUpdates` | `object`, `filters` |
| `df.FlowDeleteRecords` | Delete Records | `recordDeletes` | `object`, `filters` |
| `df.FlowRollback` | Roll Back Records | `recordRollbacks` *(record-triggered / autolaunched)* | *(none)* |
| `df.FlowStage` | Stage | `orchestratedStages` *(Orchestrator / `ProcessType: ApprovalWorkflow`)* | `stageSteps` |
| `df.FlowPlaceholder` | Placeholder | *(UI-only; NEVER produced by flow import)* | *(none)* |

> **Placeholder is for DESIGN, not import.** `df.FlowPlaceholder` is a dashed card meaning "a step belongs here
> and it is not defined yet" - use it when the author is sketching a flow they have not built. It has no Metadata
> API counterpart, and the flow-metadata converter never emits one: an empty decision outcome in a real org means
> "do nothing and continue", not "undefined", so inventing an element there would misrepresent the org. Put its
> description in the card's `name` ("Approval step - TBD"); it takes no per-kind fields.

> **Field-key note.** Where a real 1:1 Metadata API field exists the key IS that field name (`triggerType`, `object`, `filters`, `actionName`, `actionType`, `flowName`, `waitEvents`, `assignmentItems`, `collectionReference`, `conditions`). The rest are pragmatic summary keys (`components`, `outcomes`, `transformTarget`, `template`, `activation`, `configuration`) - a short human summary, not the raw metadata. The messaging sends store their content reference in `template` (the panel labels it per channel: Email / SMS / Message / Push Notification Message / In-App Message); Send to Data 360 uses `activation` (an API-activation reference, not message content). Start carries a free-text `configuration` (arbitrary setup notes - schedule cadence, entry conditions, etc.). `processType` is a Flow-level field parked on the Start card for convenience. (The Transform summary key is `transformTarget`, not `target`, to avoid colliding with a link's built-in `target` endpoint.)

**One element (minimal + with fields):**

```json
{
  "id": "get-lead",
  "type": "df.FlowGetRecords",
  "position": { "x": 400, "y": 150 },
  "size": { "width": 210, "height": 56 },
  "z": 2000,
  "name": "Get Lead",
  "apiName": "Get_Lead",
  "object": "Lead",
  "filters": "Id equals {!$Record.Id}"
}
```

**Flow connectors (Standard / Fault / Go To / Loop).** A flow link is a plain `standard.Link` between two `df.Flow*` cells. There are FOUR types (Salesforce's terms): **Standard**, **Fault**, **Go To**, and **Loop** (a Loop element's "For Each" / "After Last" branch). Fault and Go To are a shortcut over the normal connector styling, NOT a separate prop - the loader derives those two from `(stroke, dash)`. Loop is the exception: it keeps the Standard grey, so its stroke cannot identify it, and it carries a top-level **`flowKind: "loop"`** prop instead (v1.22.0; the loader checks `flowKind` BEFORE the stroke). You do NOT need to set `router`/`connector` - the loader defaults every flow link to orthogonal `sfManhattan` + rounded routing (omitting them renders a diagonal straight line until load).

- **Standard** (the default): emit just `source`/`target` (endpoints). The loader paints it grey `#5C5C5C` with "None" line-continuation stub ends so it TOUCHES the cards. You do not set `line`/`attrs`. If you DO author end markers, the loader keeps them (fill-if-absent since v1.22.0) - an authored end, including an explicit `{"type":"none"}`, is never overwritten on load, only recoloured to the connector type's colour. The same rule covers `lineStyle`: an authored value - including an explicit `null` for solid - is kept; only an absent prop is filled with the type's dash.
- **Fault**: set `attrs.line.stroke` to the fault red `#EA001E`. The loader recognises the red, dashes the line (`lineStyle` `"8 4"`), and applies the stub ends. (A fault path originates from a data/action element - Get/Create/Update/Delete Records, Action, Subflow - never from `df.FlowStart`.)
- **Go To** ("Outgoing Go To" - a jump to an existing element, e.g. a loop-back or a shared downstream target): blue `#0B5CAB` + dotted. Set `attrs.line.stroke` to `#0B5CAB` (like a Fault authors via red) - the loader dots the line and seeds a BLUE ITALIC reference label "*&lt;destination name&gt;* →" (SLDS blue-40, matching Flow Builder), falling back to "Go To". You don't author the label; it derives from the target.
- **Loop** (v1.22.0): set top-level `flowKind: "loop"` on BOTH branches leaving a `df.FlowLoop` - "For Each" (into the body) and "After Last" (onward). The loader keeps the Standard grey and solid line but adds a **Line Arrow target end**, because a loop is where the top-to-bottom layout stops giving the direction: both branches leave the same card and the For Each branch RETURNS to it, so which line enters the body is exactly what the reader cannot see. A prop rather than a colour on purpose - re-anchoring re-applies the style FROM the type, so a style detail must never stand in for identity. Add the branch labels ("For Each", "After Last") via `labels` yourself.
- **Labels** (a decision outcome name, "For Each"/"After Last" on a loop, etc.) are yours to add via `labels` - the loader seeds text only for Fault ("Fault") and Go To (the destination name). A label's colour tracks the line (grey / red / blue).
  - ⚠️ **Author the label's TEXT only - never its `position`.** The loader places an unpositioned flow label for you, and it can do it better than you can from here because it knows the route the router actually resolved: a branch label rides near its **target**, where that branch owns its own column, while a Fault, a Go To, or an empty outcome dropping several ranks to a merge stays near the source. Placing them yourself is a trap with no good answer - at the link midpoint a decision's outcomes drift apart down their own branches, and near the source they pile on top of each other, because every outcome leaves the **same** port and shares that first 32 px stub. Set `position` only to nudge a placement you have actually seen render wrong.
  - ⚠️ **On a Go To, author the OUTCOME NAME ALONE (`"No"`) - or no label at all.** The loader renders a Go To as blue italic and appends the "→" **itself**, so `"No → Retry Screen"` comes out as `"No → Retry Screen →"` - and at that width it sits on top of the card it just left. Authoring any label REPLACES the auto-seeded destination name, so this is a real trade: `"No"` names the branch and the dotted line shows where it lands; no label names the target instead. Pick one - never pack both into the string.

> **Flow-level metadata goes on a `df.Table`, not on Start.** The Start card holds only what the Start
> *element* declares (trigger, object, entry filters). Facts about the FLOW - status, API version, run mode,
> description, the resource inventory - have no element to live on, so put them on a `df.Table` placed to the
> LEFT of the flow, top-aligned with it (`highlightFirstCol: true`, `highlightFirstRow: false` gives the key/value
> look; `tableLabel` carries the flow's name). A flow is tall and narrow, so the side is the free axis. `df.Table` is a generic shape available in every diagram type, so this needs no
> flow-specific grammar. Give it no connectors - it documents the flow, it is not a step in it.
> A flow that declares input/output variables SHOULD get an `Inputs` / `Outputs` row stating the full call
> signature - list every item up to 12, then truncate with `+N more`.

> **A second `df.Table` carries the RESOURCES** (v1.22.0) - the formulas, text templates, choice sets,
> constants and described variables a flow references, which have no card of their own and were otherwise
> reduced to a count. Place it directly UNDER the facts table, in the same left column, so the two read as one
> block of documentation beside the flow. Set **`plainCells: true`** on it -
> formula expressions are code, and a `*` operator is a markdown italic marker. Row grammar mirrors the flow
> card: resource name in the left column, `Kind (Type) · definition` in the right.
> Curate, do not dump: a resource earns a row when it carries real content (a formula's expression, a text
> template's body, a variable with a description, a choice with a human name). Close the table with a final
> `Not listed` accounting row that sums everything skipped (e.g. `Not listed | 14 record variables, 3
> constants`) so the listed rows plus that row reconcile with the flow's true resource count.

> **Set a `port` on both endpoints of every flow link** (`port-top` / `port-right` / `port-bottom` / `port-left`). The
> loader fills a MISSING port by the rule below, but which port a branch leaves from is part of the drawing, so
> choose it.
>
> **Which port: a flow reads top-to-bottom, so ANY step to a different row is `port-bottom` → `port-top`.** The
> orthogonal router draws the horizontal jog for you, so a decision branch that moves further sideways than down
> still leaves the BOTTOM. Do *not* pick "whichever axis is bigger" - that makes exactly those branches exit the
> side and curl back on themselves. Sides (`port-right` → `port-left`, or the mirror) are for three cases only:
> two cards genuinely sharing a row, a **Fault**, and a **Go To** - the last two leave sideways by convention so
> they read as an aside rather than as the main path.
>
> This is flow-specific guidance. Other diagram types have their own connection conventions - see the relevant
> shape section (e.g. Data Mapping links attach to per-field ports, not these four).

```json
{ "id": "l1",      "type": "standard.Link", "source": { "id": "dec", "port": "port-bottom" }, "target": { "id": "email", "port": "port-top" }, "labels": [ { "attrs": { "text": { "text": "Engaged" } } } ] },
{ "id": "l-fault", "type": "standard.Link", "source": { "id": "get", "port": "port-right" },  "target": { "id": "err",   "port": "port-top" }, "attrs": { "line": { "stroke": "#EA001E" } } },
{ "id": "l-goto",  "type": "standard.Link", "source": { "id": "dec", "port": "port-right" },  "target": { "id": "start", "port": "port-right" }, "attrs": { "line": { "stroke": "#0B5CAB" } } }
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
- `weekStartDay` — `0`–`6` (0 = Sunday … 6 = Saturday), the first day of the week — controls where the **week** view splits its columns. Default `1` (Monday). The View menu's "Week Starts:" control cycles the three practical conventions: Monday (ISO 8601), Sunday (Americas), Saturday (MENA).
- `weekendStartDay` — `6` (Saturday → Sat–Sun weekend) or `5` (Friday → Fri–Sat weekend). The first day of the 2-day weekend block shaded as non-working columns in the **day** view. Default `6` (Saturday). Cycled from the View menu's "Weekend Starts:" control.
- `showWeekNumber` — `true`/`false`. When `true`, **week**-view columns are labelled `"W23"` (week number, counted relative to `weekStartDay`) instead of the week-start date (`"3 Apr"`). Default `false`. Toggled from the View menu's "Week Numbers".
- `showProjectSummary` — `true`/`false`. When `true`, a read-only **Project Summary** lane is drawn at the top of the timeline (between the date header and the first row): a single overview row condensing every group summary bar (in its group colour), milestone (diamond), and day marker (triangle) for the timeline. Adds one lane-height to the header, so the task rows shift down. Default `false`. Toggled from the View menu's "Project Summary Row" (gantt only).
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
- `groupId` — id of a `timeline.groups[]` entry, or omit / `null` for ungrouped. A grouped bar takes its group's `color` on load; set top-level `colorManual: true` (and `attrs.progressBar.fill`) to keep a colour of your own.
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
  "milestoneDate": "2026-07-20",
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

A dependency between two tasks is a **`standard.Link`** tagged **`linkKind:"ganttDep"`**, drawn as a brand-amber arrow into the successor: an orthogonal elbow that runs along the predecessor's row and drops to the successor, wrapping between the two rows when the successor starts before the predecessor ends. Its `depType` + `lag` ARE the data the Table view + a future critical-path read (a `dependsOn` array is *derived* from these links, never authored). On load the app auto-heals the arrow + connector from `linkKind`, so you only set the kind + endpoints (+ optional `depType`/`lag`). Drawing ANY connector between two task bars on the canvas auto-tags it as a `ganttDep`.

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

> The app records and draws the dependency; it does NOT auto-move the successor bar (auto-scheduling + a critical path are future). Keep the kinds distinct: `ganttDep` is a schedule dependency, not a Data Mapping (`mapping`) or ER relationship link.

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
- `participantRole` — `"generic"`, `"salesforce"`, `"api"`, or `"external"`. Set it; the loader tints the accent bar (top and bottom) from the table below.
- `lifelinePortCount` — how many connectable points appear on each side of the lifeline (default `5`).
- `showBottomLabel` — boolean, default `true`. When `true`, `headerBottom`, `headerBottomAccent`, `labelBottom`, and `underlineBottom` are visible.

Only the **accent bar** is tinted by the role colour; the header border, underline and lifeline use the theme-aware default stroke so participants look consistent across roles.

| Role | Accent-bar colour |
|------|-------------------|
| `generic` | `#8A9099` |
| `salesforce` | `#2E844A` |
| `api` | `#1D73C9` |
| `external` | `#A06F03` |

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
    "label":       { "text": "Salesforce" },
    "labelBottom": { "text": "Salesforce" }
  }
}
```

#### sf.SequenceActor

Stick-figure actor with an optional dashed lifeline.

**Default size:** `100 x 92` (stick figure + label only), **z:** `2000`

**Properties:**
- `showLifeline` — boolean, default `false`. When `true`, the dashed lifeline and its ports appear; an actor shorter than 120 is grown to `100 x 340` on load, but size it to the lifeline you need. When `false`, the actor renders as a compact stick-figure + label block.
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

Narrow grey box overlaid on a participant's lifeline to show when that participant is "active" (executing). It carries its own `lifelinePortCount` (default `2`) `seq-left` / `seq-right` port pairs - the loader builds that many - so messages can attach directly to the active box instead of the bare lifeline.

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
- `fragmentType` — **`"standard"` (default) or `"alternative"` — these are the only two values.** `standard` is a single-compartment frame (use it for loop / opt / par / critical / break). `alternative` is the UML `alt`: the loader shows a dashed divider splitting the frame into two compartments.
- `fragmentLabel` — the free-text keyword shown in the title tab (default `"loop"`). **This is where the operator name (`loop` / `alt` / `opt` / `par` / `critical` / `break`) actually goes** — NOT `fragmentType`. The loader writes it to the tab and sizes the tab to fit.
- `condition` — top-compartment condition, WITHOUT brackets; the loader shows it as `[condition]`.
- `elseCondition` — bottom-compartment condition (alternative only); shown as `[elseCondition]`, or `[else]` when empty.

Set the props, not the text attrs: the loader derives `titleText`, `conditionText`, `dividerLine` and `elseText` from them.

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
  "elseCondition": "customer not found"
}
```

### Sequence Message Links

Sequence messages are `standard.Link` instances that connect port-to-port between lanes. The **port index = message slot**: message #1 hooks into `seq-port-*-0` on both lanes, message #2 into `seq-port-*-1`, and so on. A "left-to-right" request leaves the source lane's `seq-port-right-<i>` and enters the target lane's `seq-port-left-<i>`; a reply goes the other way (`seq-port-left-<i>` → `seq-port-right-<i>`).

When a user draws an interactive link from a `seq-left` port to a `seq-right` port (the "right-to-left" UML reply direction), the app automatically sets `lineStyle: "6 4"` on the link. For generated JSON, set that property yourself on replies so they render dashed.

The message KIND is the target marker and the line style - there is no message-type prop:

| Message | `targetMarker` | Line |
|---------|----------------|------|
| Sync request | `{ "type": "path", "d": "M 0 -6 L -14 0 L 0 6 z" }` (filled) | solid |
| Reply | the same filled arrow | top-level `"lineStyle": "6 4"` |
| Async (fire-and-forget) | `{ "type": "path", "d": "M 0 -6 L -14 0 L 0 6", "fill": "none", "stroke": "#5E6B7A", "stroke-width": 2 }` (open) | solid |
| Async reply | the open arrow | `"lineStyle": "6 4"` |
| Lost | `{ "type": "path", "d": "M -10 -6 L 0 6 M -10 6 L 0 -6", "fill": "none", "stroke": "#5E6B7A", "stroke-width": 2 }` (an `X`) | either |

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

**Legacy topLeft anchors still load.** Existing diagrams that use `anchor: { name: "topLeft", args: { dx, dy } }` will continue to render correctly, and the Auto Layout action compensates anchor `dy` values when it repositions lanes so those messages stay horizontal. New LLM-generated diagrams should prefer ports.

---

## Generating Data Cloud Mapping Diagrams (`datamapping`)

This section is the authoritative guide for producing **valid Salesforce Data Cloud / Data 360 field-mapping diagrams**. It composes the atomic [`sf.DataObject`](#sfdataobject), [`sf.Zone`](#sfzone), and [Link](#link-structure) grammar above into a coherent pipeline, and adds the platform rules an LLM must apply. Use `"diagramType": "datamapping"` (mapping mode is then always on — every field is connectable, the `category` badge shows, links auto-style as mappings). The whole section's individual facts are defined above; here is how to assemble them.

> **Mental model:** a Data Cloud mapping diagram is a **left → right pipeline**. Source systems on the left, harmonized Data Model Objects toward the right, optional activation targets at the far right. **Objects live inside labelled layer Zones**; **field-level mapping links** carry attributes from one layer to the next; optional **object-level relationship links** show ER cardinality between whole tables.

### 1. The layer Zones (`sf.Zone` with `layerStage`)

A layer is an `sf.Zone` carrying a `layerStage` property. **Place every DataObject inside its layer by embedding it** — set the object's `parent` to the Zone id AND list the object id in the Zone's `embeds` array (geometry alone is not enough: the table view's *Data Layer* column reads the object's `parent`, so a loose object reports `[No Mapping Layer]`). Lay the layers out as vertical columns, left → right in pipeline order:

| Layer (Zone `label`) | `layerStage` | Accent (`body/stroke` + `label/fill`, `body/fill` = same at ~5% alpha) | Role |
|---|---|---|---|
| `Source` | `"source"` | `#1D73C9` (blue) | External/origin systems as they exist (CRM, ERP, S3, Marketing Cloud, DB). Native source data types. |
| `Data Stream` | `"datastream"` | `#1D73C9` (blue — same as Source; the stencil's Data Stream preset and the stacked-in-the-Source-column layout make the two zones read as one ingestion column) | The OOTB Data Stream mapping step — statics + calculated key + system timestamp (see below). **Not its own column**: stack this Zone in the Source column, below the Source Zone. |
| `Data Lake Object` | `"dlo"` | `#A06F03` (amber) | Raw ingestion — data as landed in Data Cloud, one DLO per source stream. |
| `Data Model Object` | `"dmo"` | `#DA4E55` (red) | Harmonized target entities unified by Identity Resolution (Individual, Account Contact Point, …). |
| `Activation` | `"activation"` | `#008B46` (green) | Outbound targets where harmonized data is pushed (Email, SMS, Ad Audience, Snowflake share, webhook). |

- **Use only the layers the prompt needs.** A "map this source into a DLO" request uses just Source + DLO — omit the DMO and Activation Zones entirely; do **not** stretch the remaining columns to fill the canvas (omit `viewport` and the app auto-fits).
- **The Data Stream layer models the fields a DLO carries that no source provides.** In Data Cloud the Data Stream (not the payload) sets: **statics** (Data Source, Internal Organization / MID, a static channel value like `'EMAIL'`), the **calculated source-qualified primary key** (e.g. `CONCAT(DataSource, '-', Id)`), and the **system ingestion timestamp**. Model one "Data Stream: <Name>" DataObject per stream whose fields **`Formula`-link into the DLO** (`expressionRule` = the static value or formula); source key fields that feed the calculated key get a `src → Data Stream` input link. It is a mapping *step*, not a pipeline *stage* — its Zone shares the Source column (stacked below with its own y-cursor), feeding the DLO column from the left like the sources do. Only the stream's own companion object lives in the Data Stream Zone - every real source table (in an org import, the suffix-less DSO names; DLOs carry `__dll`, DMOs `__dlm`) MUST stay in the Source Zone above. Start the Data Stream Zone ~56 px below the Source Zone's bottom edge so the two read as one ingestion column.
- **Coordinates:** one column per layer, using the numbers in §3b: 260 px cards inset 48 px in a 356 px zone, zones 556 px apart (a 200 px gutter), so zone `x` = 0 / 556 / 1112 / 1668 and each card `x` = zone `x` + 48.
- A generic `Layer` Zone (no `layerStage`) is available for grouping that isn't one of the canonical tiers; it reports its own label as the Data Layer.

### 2. Objects — `category` is mandatory for DLO/DMO

Every `sf.DataObject` that represents a **Data Cloud-native** resource (DLOs and DMOs) **must set `category`** — it is platform-enforced and drives execution (Identity Resolution eligibility, time-series indexing). Source-system objects (raw CRM/ERP tables) and Data Stream companion objects MUST omit the `category` key entirely - it belongs on Data-Cloud-native cards only. When converting real org metadata, keep only these three values: an org category outside the set (`Related`, `Segment_Membership`, ...) normalises to `"Other"` (the shipped template sets AccountContact to `Other` the same way).

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
- **Type normalization (document the evolution across layers).** Source objects may use native source types (`varchar(255)`, `Id`, `nvarchar`, `timestamp`, `picklist`, `number(18,0)`). **DLO and DMO fields use Data Cloud's own type set** in the `type` string - the Data 360 field types are Text, Number, Percent, Date, DateTime, Boolean, Email, Phone and URL (plus Lookup on DMOs, which a diagram draws as a relationship link, not as a type):

  | Data Cloud type (`type`) | Absorbs source types | Where |
  |---|---|---|
  | `"Text"` | strings, ids, picklists | DLO and DMO. On a **standard** DMO also every email, phone and URL |
  | `"Email"` / `"Phone"` / `"URL"` | email, phone, url | DLO, and custom DMO fields |
  | `"Number"` / `"Percent"` | int / decimal / double / currency; percent | DLO and DMO |
  | `"Date"` / `"DateTime"` | date, datetime, timestamp | DLO and DMO |
  | `"Boolean"` | true/false flags | DLO, and custom DMO fields |

  A DLO keeps the type its data stream gave it: a Salesforce CRM stream keeps `email`, `phone` and `url` (measured on an org's `Contact_Home__dll`), while the standard DMO fields those map to (`ContactPointEmail.EmailAddress`, `ContactPointPhone.TelephoneNumber`, `Individual.PhotoURL`) are `Text`. Showing the type changing from (e.g.) `varchar(255)` on the Source field to `Text` on the DLO/DMO field is the correct, expected way to document a transformation. Caveat: **standard Data 360 DMOs have no Boolean fields** — real DMO flags (`IsActive`, `PrimaryFlag`, `IsTestSend`, …) are `Text`. Use `Boolean` on a DMO only for a custom field you know stores one.

### 3b. Geometry and layers

Use these numbers. The validator proves a diagram LOADS, not that it reads right, and invented geometry is the
usual way a generated diagram looks nothing like the app's own.

| | Data Mapping | Data Model |
|---|---|---|
| Card width | **260** | **480** (an ERD row is `Label (ApiName)` + a type column) |
| Lane / zone width | **356** on a **556** pitch (200 px gutter) | n/a |
| Card inset in lane | **48** left, right and bottom - the app's frame fit, so a card drag never resizes the zone | n/a |
| First card / card gap | zone `y` + **48** / **36** | |
| Link ports | `field-right-*` -> `field-left-*` | child FK field `field-<side>-<fid>` -> parent header `er-<side>` - **FIELD level** in the Table view (what `objects-to-diagramforce.mjs` emits); `er-right` -> `er-left` only for an object-level relationship with no key field |
| Link router / connector | applied on load from `linkKind` | **you must author** `router:{name:"sfManhattan"}` + `connector:{name:"rounded",args:{radius:8}}` |

> ⚠️ **An ERD relationship with no `router` renders as a DIAGONAL.** A `standard.Link` without one is a
> straight line between anchors. Mapping links are healed on load from `linkKind:"mapping"`; ER relationships
> are **not**, so an authored data model has to say it.

> ⚠️ **A `datamapping` layer Zone needs FOUR things, not one.** `layerStage` is what Auto-Layout reads, but a
> zone carrying only that renders as the generic "Layer" preset and reads as a custom layer duplicating the
> built-in one. Match what the stencil produces:
> ```json
> { "type": "sf.Zone", "layerStage": "dlo",
>   "attrs": { "body":  { "stroke": "#A06F03", "fill": "rgba(160,111,3,0.05)" },
>              "label": { "text": "Data Lake Object", "fill": "#A06F03" } } }
> ```
> Accents: `source`/`datastream` `#1D73C9`, `dlo` `#A06F03`, `dmo` `#DA4E55`, `activation` `#008B46`. Each
> card's `headerColor` takes its own lane's accent (the loader paints the header from it).

**Field mix on an ERD card:** 105 of the official model's 167 fields carry NO key, 42 are fk, 20 are pk. Do not
fill a card with foreign keys - a standard object has ~15 lookups and they will consume the whole budget before
a single business field. A reader identifies a record by its name, not its `MasterRecordId`.

### 4. Field-level mapping links (`linkKind: "mapping"`)

A mapping link carries one attribute from a source-side field to a target-side field, drawn **left → right**. Reference the field **ports** — `field-right-<fid>` on the left/source object, `field-left-<fid>` on the right/target object — via the endpoint's **`port`** key (it is **not** a `<fid>#fieldRight` suffix, and field ports are **never** listed in `ports.items` — they are generated):

```json
{
  "id": "map-email",
  "type": "standard.Link",
  "source": { "id": "obj-sf-contact", "port": "field-right-c_email" },
  "target": { "id": "obj-dlo-contact", "port": "field-left-dlo_email" },
  "linkKind": "mapping",
  "mappingType": "Standard"
}
```

That is the **minimal** correct form — endpoints, `linkKind` and `mappingType`, with **no `attrs` at all**. On load the app **auto-heals the rest** from `linkKind` + `mappingType` (`migrateLinks`): the amber 1 px line (`#A06F03`) with its arrowhead and source stub, the smooth left→right router (`sfMappingRouter`) + connector (`sfMappingConnector`), the field-port anchors (`connectionPoint` offset 12), and the type-code badge.

The style heal is **gated on the line being untouched** (`standard.Link`'s `#333333` + `strokeWidth: 2` default), so a link that authors its own `line/stroke` keeps that colour — which is how a user's deliberate recolour survives a reload. So author NO line attrs, or author BOTH `stroke: "#A06F03"` and `strokeWidth: 1`: either one alone switches the heal off and leaves a grey 1 px or an amber 2 px line.

| `mappingType` | Code badge on target | Meaning |
|---|---|---|
| `"Standard"` (default) | *(none)* | Direct 1:1 copy, no transformation. |
| `"Formula"` | `F` | Field-level formula/expression. |
| `"Streaming Transform"` | `ST` | Real-time stream transform. |
| `"Batch Transform"` | `BT` | Scheduled batch transform. |
| `"Calculated Insight"` | `CI` | Multi-dimensional metric (CI). |

For any **non-`Standard`** type, add **`expressionRule`** (top-level string) with the formula/rule note, e.g. `"expressionRule": "PROPERCASE(FirstName)"` — it surfaces in the link inspector and the table's *Expression / Rule* column. (`expressionRule` superseded the pre-release `mappingLabel`, which is still read as a fallback.)

**Port-side convention.** `field-right → field-left` is the default only for **left-to-right** pairs. When both endpoints share a column — e.g. a Source object feeding the Data Stream Zone stacked below it — anchor **both ends on the same outer side** (`field-left-<fid>` at source *and* target) so the link routes down the column's edge instead of crossing the rightward traffic. For vertically stacked objects linked at object level (e.g. an identity spine), use `port-top`/`port-bottom` rather than the er side anchors.

**Formula inputs are explicit links.** A Data Stream formula row that READS source data - the calculated key, or any expression over payload fields - MUST receive one input link per source field it references: source row `field-left-<fid>` to formula row `field-left-<fid>`, a plain `linkKind:"mapping"` + `mappingType:"Standard"` link with NO `expressionRule` (the formula itself lives on the Data-Stream-to-DLO `Formula` link, not on its inputs). A static row (Data Source, Internal Organization / MID, a literal channel like `'EMAIL'`, the system timestamp) reads nothing, so it MUST get no input link. A formula that reads ANOTHER formula's output (`formulaField['X']` in Data Cloud expressions) chains **between two rows of the same Data Stream card**: referenced formula row `field-left-<fid>` to reading formula row `field-left-<fid>`, same link shape - the router draws it as a small loop off the card's left edge. Chain only to a row that EXISTS as a formula output on that card; a `formulaField` reference to a directly-mapped column is not a derived field and gets no link.

```json
{ "id": "in-key", "type": "standard.Link",
  "source": { "id": "obj-src", "port": "field-left-s_id" },
  "target": { "id": "obj-stream", "port": "field-left-ds_key" },
  "linkKind": "mapping", "mappingType": "Standard" }
```

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
    "sourceMarker": { "type": "path", "d": "M -12 -8 L -12 8 M -12 0 L 0 0", "fill": "none", "stroke": "#888888", "stroke-width": 2 },
    "targetMarker": { "type": "path", "d": "M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0", "fill": "none", "stroke": "#888888", "stroke-width": 2 } } }
}
```

Keep the two link kinds distinct: **field-level = `linkKind:"mapping"`, amber, field ports**; **object-level = no `linkKind`, grey, header ports, crow's-foot**. Don't mix them on one link.

Two composition rules that make a large mapping read well:

- **Pair overlay: one grey ER link per mapped object pair.** For every object pair that exchanges field mappings, also draw a single header-level relationship link (`er-right → er-left`, grey, ONE at the feeding object, ONE-OR-MANY into the fed object - a mapped record can land in one fed record or several; skip `→ Activation` pairs and source→Data-Stream key inputs). The diagram then reads at two levels — object relationships at a glance, field lineage in detail. Derive the pair list from the mapping links themselves so it can't drift.
- **Identity Resolution is a relationship, never a field mapping.** IR *generates* the Unified records — their keys and attributes are reconciled, not copied — so **no mapping link may point into Unified Individual** (a `Batch Transform` into the unified PK is the tell-tale mistake). Draw the identity spine `Individual → Unified Link Individual → Unified Individual` as grey ER relationship links (no `linkKind`, labelled "Identity Resolution", `port-top`/`port-bottom` when the three are stacked in one column), and give the unified objects no Source/DLO feed.

### 6. Worked example — Contact → DLO → Individual and Contact Point Email

A complete, importable three-layer mapping, built on real object and field names. It follows §3 (types per layer),
§3b (geometry), §4 (minimal mapping links), §5 (one grey ER link per mapped pair, plus the DMO-to-DMO relationship)
and §7 (every source and DLO field mapped; every DMO key mapped). The email goes to **Contact Point Email**: the
Individual DMO has no email or phone field - contact points are their own objects.

```json
{
  "version": 1, "appVersion": "1.24.7", "title": "Contact to Individual and Contact Point Email", "diagramType": "datamapping",
  "graph": { "cells": [
    {"id": "zone-src", "type": "sf.Zone", "position": {"x": 40, "y": 40}, "size": {"width": 356, "height": 212}, "z": 0, "layerStage": "source", "embeds": ["obj-src"], "attrs": {"body": {"fill": "rgba(29,115,201,0.05)", "stroke": "#1D73C9"}, "label": {"text": "Source", "fill": "#1D73C9"}}},
    {"id": "obj-src", "type": "sf.DataObject", "position": {"x": 88, "y": 88}, "size": {"width": 260, "height": 116}, "z": 2000, "parent": "zone-src", "objectName": "Salesforce Contact", "headerColor": "#1D73C9", "fields": [{"label": "Id", "apiName": "Id", "type": "ID", "keyType": "pk", "fid": "s_id", "required": true}, {"label": "Email", "apiName": "Email", "type": "Email", "keyType": null, "fid": "s_email"}, {"label": "First Name", "apiName": "FirstName", "type": "Text", "keyType": null, "fid": "s_fname"}]},
    {"id": "zone-dlo", "type": "sf.Zone", "position": {"x": 596, "y": 40}, "size": {"width": 356, "height": 212}, "z": 0, "layerStage": "dlo", "embeds": ["obj-dlo"], "attrs": {"body": {"fill": "rgba(160,111,3,0.05)", "stroke": "#A06F03"}, "label": {"text": "Data Lake Object", "fill": "#A06F03"}}},
    {"id": "obj-dlo", "type": "sf.DataObject", "position": {"x": 644, "y": 88}, "size": {"width": 260, "height": 116}, "z": 2000, "parent": "zone-dlo", "objectName": "Contact_Home", "headerColor": "#A06F03", "category": "Profile", "fields": [{"label": "Id", "apiName": "Id__c", "type": "Text", "keyType": "pk", "fid": "d_id", "required": true}, {"label": "Email", "apiName": "Email__c", "type": "Email", "keyType": null, "fid": "d_email"}, {"label": "First Name", "apiName": "FirstName__c", "type": "Text", "keyType": null, "fid": "d_fname"}]},
    {"id": "zone-dmo", "type": "sf.Zone", "position": {"x": 1152, "y": 40}, "size": {"width": 356, "height": 342}, "z": 0, "layerStage": "dmo", "embeds": ["obj-ind", "obj-cpe"], "attrs": {"body": {"fill": "rgba(218,78,85,0.05)", "stroke": "#DA4E55"}, "label": {"text": "Data Model Object", "fill": "#DA4E55"}}},
    {"id": "obj-ind", "type": "sf.DataObject", "position": {"x": 1200, "y": 88}, "size": {"width": 260, "height": 94}, "z": 2000, "parent": "zone-dmo", "objectName": "Individual", "headerColor": "#DA4E55", "category": "Profile", "fields": [{"label": "Individual Id", "apiName": "ssot__Id__c", "type": "Text", "keyType": "pk", "fid": "i_id", "required": true}, {"label": "First Name", "apiName": "ssot__FirstName__c", "type": "Text", "keyType": null, "fid": "i_fname"}]},
    {"id": "obj-cpe", "type": "sf.DataObject", "position": {"x": 1200, "y": 218}, "size": {"width": 260, "height": 116}, "z": 2000, "parent": "zone-dmo", "objectName": "Contact Point Email", "headerColor": "#DA4E55", "category": "Profile", "fields": [{"label": "Contact Point Email Id", "apiName": "ssot__Id__c", "type": "Text", "keyType": "pk", "fid": "e_id", "required": true}, {"label": "Party", "apiName": "ssot__PartyId__c", "type": "Text", "keyType": "fk", "fid": "e_party"}, {"label": "Email Address", "apiName": "ssot__EmailAddress__c", "type": "Text", "keyType": null, "fid": "e_addr"}]},
    {"id": "map-id", "type": "standard.Link", "source": {"id": "obj-src", "port": "field-right-s_id"}, "target": {"id": "obj-dlo", "port": "field-left-d_id"}, "linkKind": "mapping", "mappingType": "Standard"},
    {"id": "map-email", "type": "standard.Link", "source": {"id": "obj-src", "port": "field-right-s_email"}, "target": {"id": "obj-dlo", "port": "field-left-d_email"}, "linkKind": "mapping", "mappingType": "Standard"},
    {"id": "map-fname", "type": "standard.Link", "source": {"id": "obj-src", "port": "field-right-s_fname"}, "target": {"id": "obj-dlo", "port": "field-left-d_fname"}, "linkKind": "mapping", "mappingType": "Standard"},
    {"id": "map-ind-id", "type": "standard.Link", "source": {"id": "obj-dlo", "port": "field-right-d_id"}, "target": {"id": "obj-ind", "port": "field-left-i_id"}, "linkKind": "mapping", "mappingType": "Standard"},
    {"id": "map-ind-fname", "type": "standard.Link", "source": {"id": "obj-dlo", "port": "field-right-d_fname"}, "target": {"id": "obj-ind", "port": "field-left-i_fname"}, "linkKind": "mapping", "mappingType": "Formula", "expressionRule": "PROPER(FirstName__c)"},
    {"id": "map-cpe-id", "type": "standard.Link", "source": {"id": "obj-dlo", "port": "field-right-d_id"}, "target": {"id": "obj-cpe", "port": "field-left-e_id"}, "linkKind": "mapping", "mappingType": "Formula", "expressionRule": "CONCAT(Id__c, '-email')"},
    {"id": "map-cpe-party", "type": "standard.Link", "source": {"id": "obj-dlo", "port": "field-right-d_id"}, "target": {"id": "obj-cpe", "port": "field-left-e_party"}, "linkKind": "mapping", "mappingType": "Standard"},
    {"id": "map-cpe-addr", "type": "standard.Link", "source": {"id": "obj-dlo", "port": "field-right-d_email"}, "target": {"id": "obj-cpe", "port": "field-left-e_addr"}, "linkKind": "mapping", "mappingType": "Standard"},
    {"id": "pair-src-dlo", "type": "standard.Link", "source": {"id": "obj-src", "port": "er-right"}, "target": {"id": "obj-dlo", "port": "er-left"}, "router": {"name": "sfManhattan"}, "connector": {"name": "rounded", "args": {"radius": 8}}, "attrs": {"line": {"stroke": "#74797F", "strokeWidth": 2, "sourceMarker": {"type": "path", "d": "M -12 -8 L -12 8 M -12 0 L 0 0", "fill": "none", "stroke": "#74797F", "stroke-width": 2}, "targetMarker": {"type": "path", "d": "M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0 M 3 -8 L 3 8", "fill": "none", "stroke": "#74797F", "stroke-width": 2}}}},
    {"id": "pair-dlo-ind", "type": "standard.Link", "source": {"id": "obj-dlo", "port": "er-right"}, "target": {"id": "obj-ind", "port": "er-left"}, "router": {"name": "sfManhattan"}, "connector": {"name": "rounded", "args": {"radius": 8}}, "attrs": {"line": {"stroke": "#74797F", "strokeWidth": 2, "sourceMarker": {"type": "path", "d": "M -12 -8 L -12 8 M -12 0 L 0 0", "fill": "none", "stroke": "#74797F", "stroke-width": 2}, "targetMarker": {"type": "path", "d": "M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0 M 3 -8 L 3 8", "fill": "none", "stroke": "#74797F", "stroke-width": 2}}}},
    {"id": "pair-dlo-cpe", "type": "standard.Link", "source": {"id": "obj-dlo", "port": "er-right"}, "target": {"id": "obj-cpe", "port": "er-left"}, "router": {"name": "sfManhattan"}, "connector": {"name": "rounded", "args": {"radius": 8}}, "attrs": {"line": {"stroke": "#74797F", "strokeWidth": 2, "sourceMarker": {"type": "path", "d": "M -12 -8 L -12 8 M -12 0 L 0 0", "fill": "none", "stroke": "#74797F", "stroke-width": 2}, "targetMarker": {"type": "path", "d": "M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0 M 3 -8 L 3 8", "fill": "none", "stroke": "#74797F", "stroke-width": 2}}}},
    {"id": "rel-ind-cpe", "type": "standard.Link", "source": {"id": "obj-ind", "port": "port-bottom"}, "target": {"id": "obj-cpe", "port": "port-top"}, "router": {"name": "sfManhattan"}, "connector": {"name": "rounded", "args": {"radius": 8}}, "attrs": {"line": {"stroke": "#74797F", "strokeWidth": 2, "sourceMarker": {"type": "path", "d": "M -12 -8 L -12 8 M -12 0 L 0 0", "fill": "none", "stroke": "#74797F", "stroke-width": 2}, "targetMarker": {"type": "path", "d": "M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0", "fill": "none", "stroke": "#74797F", "stroke-width": 2}}}}
  ] }
}
```

### 7. Connectivity completeness (audit before delivering)

A syntactically valid mapping can still be **incomplete** — a box or field with no lineage reads as a mistake, not a footnote. Audit connectivity at both levels before delivering:

- **Object level: no object may sit unconnected.** Even reference DMOs (Consent Status, Data Use Purpose, …) get their `Name` seeded from a DLO value (a normalising `Formula` link) rather than floating linkless.
- **Field level**, per layer:

  | Layer | Rule |
  |---|---|
  | Source | Every field maps somewhere — including key fields feeding the Data Stream's calculated key (draw the `src → Data Stream` input). |
  | Data Stream | Every field maps into the DLO. |
  | DLO | Every field has ≥1 link (in or out). |
  | DMO | The only layer where fields *may* be unmapped — but **not keys** (next rule). |
  | Activation | Every field receives a mapping. |

- **A keyed DMO field is unmapped only with a stated reason.** The DLO record key maps into each fed DMO's **PK** (and PartyId where present); reference DMO PKs derive from the driving value (`Formula`, e.g. "Key derived from <Name>"); resolvable FKs get a `Formula` "Resolve X by Y" link. The legitimate exceptions: the **IR-generated identity spine** (Unified Individual / Unified Link — never source-mapped, §5), **FKs to objects outside the diagram's scope**, and **reference-only FKs with no source**.

### 8. Validation checklist (avoid the common mistakes)

- ✅ `"diagramType": "datamapping"` (`"mapping"` is an accepted alias; `"data"` opens a Data Model instead).
- ✅ Layers are `sf.Zone` with `layerStage` (`source`/`datastream`/`dlo`/`dmo`/`activation`) — **not** a `sf.Container` named "Source".
- ✅ Every DataObject is **embedded** in its layer Zone: object `parent` = zone id **and** zone `embeds` includes the object id.
- ✅ Object typing is `category` = `Profile`/`Engagement`/`Other` (top-level, set on every DLO/DMO) — **not** `objectCategory`.
- ✅ Field links reference ports via the endpoint **`port`** key as `field-right-<fid>` / `field-left-<fid>` — **not** `<fid>#fieldRight`. Source side uses `field-right-…`, target side `field-left-…`.
- ✅ Mapping links: `linkKind:"mapping"` and a `mappingType` from the five-value set, NO `attrs` (the loader applies the amber 1 px look; author both `stroke` and `strokeWidth` or neither); add `expressionRule` for non-`Standard`. Do **not** set a router on a mapping link — the app applies `sfMappingRouter`.
- ✅ ER relationship links: **no** `linkKind`, header ports (`er-left`/`er-right`), `sfManhattan` router, crow's-foot markers.
- ✅ Mark any field you connect with a `fid`; omit `ports` entirely (never a partial list - the app builds every port, and a dropped one is an attachment point the user loses).
- ✅ DLO/DMO field `type` from Data Cloud's set (`Text`/`Number`/`Percent`/`Date`/`DateTime`/`Boolean`/`Email`/`Phone`/`URL`); keep native types only on Source objects, and remember a **standard** DMO field is `Text` for flags, emails, phones and URLs (§3).
- ✅ Every `data-icon-id` token comes from the **Icon ID reference** tables — never invent an SLDS-sounding name (an unknown ID renders an invisible blank). No fitting token → `href: ""`. Icons are all-or-none per diagram: a mix of iconed and icon-less objects reads as a bug.
- ✅ No unconnected objects; field-level connectivity audited per §7 (Source/Data Stream/DLO/Activation fields all linked; keyed DMO fields mapped or exempted with a reason).
- ✅ No mapping link points into Unified Individual — the identity spine is grey ER links (§5).
- ✅ Same-column pairs (Source → Data Stream) anchor both link ends on the outer side (`field-left` at both); `field-right → field-left` is for left-to-right pairs only (§4).

---

## Complete Examples

### Architecture Diagram

A **System Landscape** (Salesforce framework Level 2): a "Salesforce Core" container grouping two clouds, an external
system (amber border = "external", per the Legend), two integration connectors carrying **Frequency** labels, a Note,
and `df.Legend` swatches acting as the Salesforce **Key**. It shows the framework conventions in action - a Header
(the `title` + a top `sf.TextLabel`), a Key (`df.Legend`), colour as classification, and orthogonal connectors with
their cadence on the line. *(Validated with `validate-diagram.mjs`; rendered in-app.)*

```json
{
  "version": 1,
  "appVersion": "1.24.7",
  "title": "Order-to-Cash System Landscape",
  "diagramType": "architecture",
  "graph": {
    "cells": [
      { "id": "title", "type": "sf.TextLabel", "position": { "x": 60, "y": 24 }, "size": { "width": 600, "height": 28 }, "attrs": { "label": { "text": "**Order-to-Cash** - Salesforce to ERP integration (Level 2)" } } },

      { "id": "sfcore", "type": "sf.Container", "position": { "x": 60, "y": 90 }, "size": { "width": 296, "height": 286 }, "attrs": { "accent": { "fill": "#1D73C9" }, "accentFill": { "fill": "#1D73C9" }, "headerLabel": { "text": "Salesforce Core" } }, "embeds": ["sales", "service"] },
      { "id": "sales",   "type": "sf.SimpleNode", "parent": "sfcore", "position": { "x": 108, "y": 178 }, "size": { "width": 200, "height": 60 }, "attrs": { "label": { "text": "Sales Cloud" }, "subtitle": { "text": "Opportunities, Quotes" } } },
      { "id": "service", "type": "sf.SimpleNode", "parent": "sfcore", "position": { "x": 108, "y": 268 }, "size": { "width": 200, "height": 60 }, "attrs": { "label": { "text": "Service Cloud" }, "subtitle": { "text": "Cases, Entitlements" } } },

      { "id": "erp", "type": "sf.SimpleNode", "position": { "x": 480, "y": 221 }, "size": { "width": 220, "height": 64 }, "attrs": { "label": { "text": "SAP ERP" }, "subtitle": { "text": "Orders, Invoices" }, "body": { "stroke": "#A06F03", "strokeWidth": 2 } } },

      { "id": "l1", "type": "standard.Link", "source": { "id": "sales", "port": "port-right" }, "target": { "id": "erp", "port": "port-left" }, "connectionFrequency": "Real-time", "router": { "name": "sfManhattan" }, "connector": { "name": "rounded", "args": { "radius": 8 } } },
      { "id": "l2", "type": "standard.Link", "source": { "id": "service", "port": "port-right" }, "target": { "id": "erp", "port": "port-left" }, "connectionFrequency": "Nightly batch", "router": { "name": "sfManhattan" }, "connector": { "name": "rounded", "args": { "radius": 8 } } },

      { "id": "note", "type": "sf.Note", "position": { "x": 480, "y": 320 }, "size": { "width": 220, "height": 120 }, "attrs": { "label": { "text": "Integration" }, "subtitle": { "text": "Orders sync via MuleSoft. See the integration runbook." } } },

      { "id": "leg1", "type": "df.Legend", "position": { "x": 60, "y": 410 }, "attrs": { "swatch": { "fill": "#1D73C9" }, "label": { "text": "Salesforce platform" } } },
      { "id": "leg2", "type": "df.Legend", "position": { "x": 60, "y": 446 }, "attrs": { "swatch": { "fill": "#A06F03" }, "label": { "text": "External system" } } }
    ]
  }
}
```

### Data Model (ERD)

Two related Salesforce objects: 480 px cards (§3b), the header drawn from `objectName` / `headerColor`, no `ports`,
and one FIELD-level relationship drawn from the ONE end (Account's header) to the MANY end (Contact's `AccountId`
row), so the Table view reports it as a field-level `1:Many`.

```json
{
  "version": 1, "appVersion": "1.24.7", "title": "Account-Contact ERD", "diagramType": "datamodel",
  "graph": { "cells": [
    {"id": "obj-account", "type": "sf.DataObject", "position": {"x": 100, "y": 100}, "size": {"width": 480, "height": 160}, "z": 2000, "objectName": "Account", "headerColor": "#1D73C9", "fields": [{"label": "Id", "apiName": "Id", "type": "ID", "keyType": "pk", "fid": "a_id", "required": true}, {"label": "Name", "apiName": "Name", "type": "Text", "keyType": null, "fid": "a_name", "required": true, "length": 255}, {"label": "Industry", "apiName": "Industry", "type": "Picklist", "keyType": null, "fid": "a_industry", "required": false, "sampleValues": "Technology, Manufacturing"}, {"label": "Annual Revenue", "apiName": "AnnualRevenue", "type": "Currency", "keyType": null, "fid": "a_revenue", "required": false}, {"label": "Owner", "apiName": "OwnerId", "type": "Lookup", "keyType": "fk", "fid": "a_owner", "required": true}]},
    {"id": "obj-contact", "type": "sf.DataObject", "position": {"x": 720, "y": 100}, "size": {"width": 480, "height": 160}, "z": 2000, "objectName": "Contact", "headerColor": "#B652A7", "fields": [{"label": "Id", "apiName": "Id", "type": "ID", "keyType": "pk", "fid": "c_id", "required": true}, {"label": "Name", "apiName": "Name", "type": "Text", "keyType": null, "fid": "c_name", "required": true, "length": 255}, {"label": "Email", "apiName": "Email", "type": "Email", "keyType": null, "fid": "c_email", "required": false, "sampleValues": "jane@acme.com, sam@globalmedia.com"}, {"label": "Account", "apiName": "AccountId", "type": "Lookup", "keyType": "fk", "fid": "c_account", "required": false}, {"label": "Title", "apiName": "Title", "type": "Text", "keyType": null, "fid": "c_title", "required": false, "length": 128}]},
    {"id": "rel-account-contact", "type": "standard.Link", "source": {"id": "obj-account", "port": "er-right"}, "target": {"id": "obj-contact", "port": "field-left-c_account"}, "router": {"name": "sfManhattan"}, "connector": {"name": "rounded", "args": {"radius": 8}}, "attrs": {"line": {"stroke": "#74797F", "strokeWidth": 2, "sourceMarker": {"type": "path", "d": "M -12 -8 L -12 8 M -12 0 L 0 0", "fill": "none", "stroke": "#74797F", "stroke-width": 2}, "targetMarker": {"type": "path", "d": "M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0", "fill": "none", "stroke": "#74797F", "stroke-width": 2}}}, "labels": [{"position": 0.5, "attrs": {"text": {"text": "has"}}}]}
  ] }
}
```

### Sequence Diagram

Three lanes - an **`sf.SequenceActor`** ("Customer", `showLifeline: true`) plus two `sf.SequenceParticipant`s -
exchanging **numbered** messages, with an activation box and an `alt` fragment. Messages are port-based: every lane
carries the same `lifelinePortCount: 10`, so `seq-port-*-<i>` is message slot `i` and ports are rebuilt on load (do
not serialize `ports.items`). An actor WITH a lifeline must sit 44px ABOVE the participants
(`position.y = participant.y - 44`) so the lifelines align. The reply (`msg-2`) is dashed (`lineStyle: "6 4"`) and
swaps port direction. *(Validated with `validate-diagram.mjs`; rendered in-app.)*

```json
{
  "version": 1,
  "appVersion": "1.24.7",
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
`validate-diagram.mjs`; rendered in-app.)*

```json
{
  "version": 1,
  "appVersion": "1.24.7",
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
fill/stroke; flows OMIT `targetMarker` (the loader adds the arrow). *(Validated with `validate-diagram.mjs`; rendered in-app.)*

```json
{
  "version": 1,
  "appVersion": "1.24.7",
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

      { "id": "a1", "type": "standard.Link", "source": { "id": "anno", "port": "port-bottom" }, "target": { "id": "t1", "port": "port-top" }, "lineStyle": "2 4", "router": { "name": "sfManhattan" }, "connector": { "name": "rounded", "args": { "radius": 8 } } },
      { "id": "f1", "type": "standard.Link", "source": { "id": "start", "port": "port-right" }, "target": { "id": "t1", "port": "port-left" }, "router": { "name": "sfManhattan" }, "connector": { "name": "rounded", "args": { "radius": 8 } } },
      { "id": "f2", "type": "standard.Link", "source": { "id": "t1", "port": "port-right" }, "target": { "id": "gw1", "port": "port-left" }, "router": { "name": "sfManhattan" }, "connector": { "name": "rounded", "args": { "radius": 8 } } },
      { "id": "f3", "type": "standard.Link", "source": { "id": "gw1", "port": "port-right" }, "target": { "id": "gw2", "port": "port-left" }, "labels": [ { "attrs": { "text": { "text": "Yes" } } } ], "router": { "name": "sfManhattan" }, "connector": { "name": "rounded", "args": { "radius": 8 } } },
      { "id": "f4", "type": "standard.Link", "source": { "id": "gw1", "port": "port-bottom" }, "target": { "id": "t4", "port": "port-left" }, "labels": [ { "attrs": { "text": { "text": "No" } } } ], "router": { "name": "sfManhattan" }, "connector": { "name": "rounded", "args": { "radius": 8 } } },
      { "id": "f5", "type": "standard.Link", "source": { "id": "gw2", "port": "port-top" }, "target": { "id": "t2", "port": "port-left" }, "router": { "name": "sfManhattan" }, "connector": { "name": "rounded", "args": { "radius": 8 } } },
      { "id": "f6", "type": "standard.Link", "source": { "id": "gw2", "port": "port-bottom" }, "target": { "id": "t3", "port": "port-left" }, "router": { "name": "sfManhattan" }, "connector": { "name": "rounded", "args": { "radius": 8 } } },
      { "id": "f7", "type": "standard.Link", "source": { "id": "t2", "port": "port-right" }, "target": { "id": "gw3", "port": "port-top" }, "router": { "name": "sfManhattan" }, "connector": { "name": "rounded", "args": { "radius": 8 } } },
      { "id": "f8", "type": "standard.Link", "source": { "id": "t3", "port": "port-right" }, "target": { "id": "gw3", "port": "port-bottom" }, "router": { "name": "sfManhattan" }, "connector": { "name": "rounded", "args": { "radius": 8 } } },
      { "id": "f9", "type": "standard.Link", "source": { "id": "gw3", "port": "port-right" }, "target": { "id": "done", "port": "port-left" }, "router": { "name": "sfManhattan" }, "connector": { "name": "rounded", "args": { "radius": 8 } } },
      { "id": "f10", "type": "standard.Link", "source": { "id": "t4", "port": "port-right" }, "target": { "id": "rej", "port": "port-left" }, "router": { "name": "sfManhattan" }, "connector": { "name": "rounded", "args": { "radius": 8 } } }
    ]
  }
}
```

### Flow (Salesforce Flow)

A **segment-triggered marketing flow**: a Data Cloud segment membership starts it, a Get Records reads the contact (with a fault path to a Notify-admin Action), a Decision branches on engagement, and each branch runs a Send-message Action before ending. Every element is the SAME uniform `210 x 56` card - branching is expressed by the `standard.Link`s, not by the shapes. Element name/apiName/per-kind fields are TOP-LEVEL; `attrs` and `icon` are omitted (each class self-iconizes on load). *(Validated with `validate-diagram.mjs`; rendered in-app.)*

```json
{
  "version": 1,
  "appVersion": "1.24.7",
  "title": "Welcome Campaign (segment-triggered)",
  "diagramType": "flow",
  "graph": {
    "cells": [
      { "id": "start", "type": "df.FlowStart", "position": { "x": 360, "y": 20 }, "size": { "width": 210, "height": 56 }, "z": 2000, "name": "New segment member", "apiName": "Start", "processType": "AutoLaunchedFlow", "triggerType": "Segment", "object": "Campaign Member" },
      { "id": "get", "type": "df.FlowGetRecords", "position": { "x": 360, "y": 120 }, "size": { "width": 210, "height": 56 }, "z": 2000, "name": "Get Contact", "apiName": "Get_Contact", "object": "Contact", "filters": "Id equals {!$Record.ContactId}" },
      { "id": "dec", "type": "df.FlowDecision", "position": { "x": 360, "y": 220 }, "size": { "width": 210, "height": 56 }, "z": 2000, "name": "Engaged in last 30 days?", "apiName": "Is_Engaged", "outcomes": "Engaged; Default (not engaged)" },
      { "id": "email", "type": "df.FlowAction", "position": { "x": 180, "y": 330 }, "size": { "width": 210, "height": 56 }, "z": 2000, "name": "Send welcome email", "apiName": "Send_Welcome_Email", "actionName": "emailSimple", "actionType": "emailSimple" },
      { "id": "sms", "type": "df.FlowAction", "position": { "x": 540, "y": 330 }, "size": { "width": 210, "height": 56 }, "z": 2000, "name": "Send SMS nudge", "apiName": "Send_SMS_Nudge", "actionName": "sendSms", "actionType": "apex" },
      { "id": "err", "type": "df.FlowAction", "position": { "x": 620, "y": 120 }, "size": { "width": 210, "height": 56 }, "z": 2000, "name": "Notify admin", "apiName": "Notify_Admin", "actionName": "emailSimple", "actionType": "emailAlert" },
      { "id": "end", "type": "df.FlowEnd", "position": { "x": 360, "y": 440 }, "size": { "width": 210, "height": 56 }, "z": 2000, "name": "End" },

      { "id": "l1", "type": "standard.Link", "source": { "id": "start", "port": "port-bottom" }, "target": { "id": "get", "port": "port-top" } },
      { "id": "l2", "type": "standard.Link", "source": { "id": "get", "port": "port-bottom" }, "target": { "id": "dec", "port": "port-top" } },
      { "id": "l3", "type": "standard.Link", "source": { "id": "get", "port": "port-right" }, "target": { "id": "err", "port": "port-left" }, "attrs": { "line": { "stroke": "#EA001E" } } },
      { "id": "l4", "type": "standard.Link", "source": { "id": "dec", "port": "port-bottom" }, "target": { "id": "email", "port": "port-top" }, "labels": [ { "attrs": { "text": { "text": "Engaged" } } } ] },
      { "id": "l5", "type": "standard.Link", "source": { "id": "dec", "port": "port-bottom" }, "target": { "id": "sms", "port": "port-top" }, "labels": [ { "attrs": { "text": { "text": "Default" } } } ] },
      { "id": "l6", "type": "standard.Link", "source": { "id": "email", "port": "port-bottom" }, "target": { "id": "end", "port": "port-top" } },
      { "id": "l7", "type": "standard.Link", "source": { "id": "sms", "port": "port-bottom" }, "target": { "id": "end", "port": "port-top" } }
    ]
  }
}
```

> Read the ports above against the positions: **every link between two different rows is `port-bottom` →
> `port-top`**, including the two decision branches (`l4`/`l5`) that move sideways more than they move down,
> and the two that merge back into End (`l6`/`l7`). The orthogonal router draws the horizontal jog. The one
> link that leaves a side is `l3`, the **fault** - and its target genuinely shares a row with its source.
> Copying side ports onto a branch is the single most common way a hand-authored flow comes out tangled.

### Org Chart

This is the classic mis-pick: "two teams working on a project" is an **`org`** diagram, NOT `architecture` (people,
not systems - see [Choosing the right diagram type](#choosing-the-right-diagram-type)). `sf.OrgPerson` carries
top-level `personName` / `jobTitle` / `iconText` (avatar initials) / `raci` (`{R,A,C,I}` role pills) / `tags` /
`vacant` (dashed "to be hired" placeholder) / a `details` array - the view renders every label and AUTO-SIZES from
these props (never hand-write the label `attrs` or a tall `size`). A **Team is an `sf.Container`** (header via
`attrs.headerLabel.text` + accent colour) that EMBEDS its people: set BOTH the container `embeds[]` and each person's
`parent`. Reporting links join `port-bottom` → `port-top` and, like every relationship link, carry
`router: { "name": "sfManhattan" }` - without it an org link renders as a straight diagonal. (Wrap the teams in a
Department `sf.Zone` the same way for another grouping level; for a RACI matrix use `sf.Task` + `sf.TaskGroup`
instead - see their Shape Reference.) To chart a real org's **Salesforce role hierarchy**, do not author it by hand:
the skill's `roles-to-diagramforce.mjs` builds it from one `UserRole` query, and the app takes the same query result
on **Load → Paste**. *(Validated with `validate-diagram.mjs`; rendered in-app.)*

```json
{
  "version": 1,
  "appVersion": "1.24.7",
  "title": "Project Phoenix - Delivery Teams",
  "diagramType": "org",
  "graph": {
    "cells": [
      { "id": "lead", "type": "sf.OrgPerson", "position": { "x": 336, "y": 40 }, "personName": "Maria Chen", "jobTitle": "Programme Lead", "iconText": "MC", "raci": { "A": true }, "tags": ["sponsor"], "details": [ { "label": "Stream", "value": "Delivery" }, { "label": "Location", "value": "London" } ] },

      { "id": "platform", "type": "sf.Container", "position": { "x": 60, "y": 240 }, "size": { "width": 376, "height": 346 }, "tags": ["scrum"], "attrs": { "accent": { "fill": "#1D73C9" }, "accentFill": { "fill": "#1D73C9" }, "headerLabel": { "text": "Platform Team" } }, "embeds": ["sam", "vac1"] },
      { "id": "sam",  "type": "sf.OrgPerson", "parent": "platform", "position": { "x": 108, "y": 328 }, "personName": "Sam Rivera", "jobTitle": "Tech Lead", "iconText": "SR", "raci": { "R": true } },
      { "id": "vac1", "type": "sf.OrgPerson", "parent": "platform", "position": { "x": 108, "y": 448 }, "personName": "To be hired", "jobTitle": "Senior Engineer", "vacant": true },

      { "id": "data", "type": "sf.Container", "position": { "x": 516, "y": 240 }, "size": { "width": 376, "height": 376 }, "attrs": { "accent": { "fill": "#B652A7" }, "accentFill": { "fill": "#B652A7" }, "headerLabel": { "text": "Data Team" } }, "embeds": ["alex", "priya"] },
      { "id": "alex",  "type": "sf.OrgPerson", "parent": "data", "position": { "x": 564, "y": 328 }, "personName": "Alex Kim", "jobTitle": "Data Lead", "iconText": "AK", "raci": { "R": true, "C": true } },
      { "id": "priya", "type": "sf.OrgPerson", "parent": "data", "position": { "x": 564, "y": 448 }, "personName": "Priya Patel", "jobTitle": "Analytics Engineer", "iconText": "PP", "raci": { "C": true }, "tags": ["dbt", "CRMA"] },

      { "id": "r1", "type": "standard.Link", "source": { "id": "lead", "port": "port-bottom" }, "target": { "id": "platform", "port": "port-top" }, "router": { "name": "sfManhattan" }, "connector": { "name": "rounded", "args": { "radius": 8 } } },
      { "id": "r2", "type": "standard.Link", "source": { "id": "lead", "port": "port-bottom" }, "target": { "id": "data", "port": "port-top" }, "router": { "name": "sfManhattan" }, "connector": { "name": "rounded", "args": { "radius": 8 } } }
    ]
  }
}
```

---

## Layout Tips

- **Import never runs a layout.** Neither the file/paste import nor the `postMessage` "Open in Diagramforce" path
  moves your cards; **Auto Layout** runs only when the user picks it from the **View** menu. What IS recomputed
  on load is size and date-driven placement: DataObject heights (the Sizing rule), the content-sized cards
  (OrgPerson, Note, `df.Table`), an OrgPerson narrower than 280 (widened), a lifeline Actor shorter than 120, and
  Gantt bars and milestones (x from their dates). Everything else is your numbers - if the render is wrong, look at
  the JSON, not at the app.
- **Spacing:** Leave ~100-140px horizontal gaps and ~80-100px vertical gaps between TOP-LEVEL elements for clean
  routing. Cards stacked inside one container are a different case - see *Container lanes* below.
- **Frame padding is 48px (Data Mapping layer zones included), and the number is not cosmetic.** A link into an embedded card turns **32px** out
  from the port (the router's stub) and its arrow tip lands **16px** out. A frame padded by less than 32px
  therefore draws the connector **on its own border**: at 16px the arrow tips sit exactly on the edge, and at
  ~30px the vertical fan-out trunk does. Pad a `sf.Container` / `sf.Zone` by **48px** on left, right and bottom
  (and keep children ≥ 48px below the 40px header, i.e. `container.y + 88`). This is also what the in-app
  auto-size produces, so a 48px frame is already at its resting size and won't shift on the first edit.
- **Zones:** Place zones first (z=0) and size them to encompass their child elements with the same 48px padding.
- **Links:** The `sfManhattan` router auto-routes orthogonal paths. You rarely need `vertices` — only add them for specific waypoint control.
- **Port selection:** Use `port-right`/`port-left` for horizontal flows, `port-top`/`port-bottom` for vertical flows. The router handles the rest.

### Capture: put cards INSIDE a frame, don't just draw one behind them

`sf.Container`, `sf.Zone`, `sf.TaskGroup`, `sf.BpmnPool`, `sf.BpmnSubprocess` and `sf.BpmnLoop` are **capture
frames**: on the canvas, dropping an element inside one embeds it. A generated diagram must declare that
relationship itself - **geometry alone does not create it**. A frame whose bounds enclose cards but whose
`embeds` is empty is a decorative rectangle:

- it does **not** group-move (drag the lane, the cards stay behind),
- it does **not** auto-size to its contents,
- selecting it selects nothing else, and Ungroup has nothing to release.

Set **both** sides on every child - the id in the frame's `embeds[]` **and** `parent: "<frame-id>"` on the
child. The loader does not reconcile a half-declared embed, and `validate-diagram.mjs` warns on both the
one-sided case and the zero-sided case above. The one deliberate exception: a Salesforce **Flow** diagram's stage
bands - `sf.Zone`s the flow converter draws behind an orchestration's stages - are backdrops by design (an embedded
band would drag its members around on Auto Layout), so the validator does not warn on `diagramType: "flow"`.

```json
{ "id": "env-qa", "type": "sf.Container", "embeds": ["card-1", "card-2"], … }
{ "id": "card-1", "type": "sf.BpmnTask", "parent": "env-qa", … }
```

**Auto-size (what happens AFTER load).** Once children are embedded, moving or resizing one re-hugs the frame
to its contents: the **top is anchored** (the header lives there) and **left / right / bottom grow *and shrink***
to a 48px inset - so hugging the left also **moves** the frame. Import never triggers this, so your authored
geometry loads intact, but a frame that is deliberately larger than its contents collapses on the first edit.
Two ways to keep it:

- author the frame at its resting size (48px inset on left/right/bottom) so the hug is already satisfied, or
- set **`"manualSize": true`** on the frame (top-level cell property, since v1.23.0). That pins its geometry -
  the content-hug skips it entirely. It is a cell property, so it **travels with the file** (saves, share URLs,
  `postMessage` import). The user releases it with **Auto size** in the right-click menu; a resize-handle drag
  sets it. Use it whenever the layout means something the hug would destroy - lanes at one uniform height, a
  frame with deliberate breathing room, a placeholder frame sized for content not yet added.

### Container lanes (columns of grouped cards)

Swimlanes, environment columns, stage columns - a row of `sf.Container`s each holding a vertical stack of cards
wired left to right. **A lane's height is a property of the DIAGRAM, not of the lane.** Sizing each lane to its
own card count produces a bar chart, not a set of lanes.

| Quantity | Value |
|---|---|
| Card size | ONE size for every card in the diagram (`180 x 60` reads well; `sf.BpmnTask` defaults to `120 x 60`) |
| Card inset in lane | `48` left and right (see *Frame padding* above) |
| Lane width | card width + 96 |
| Lane gap | `80`-`120` between one lane's right edge and the next lane's left edge |
| Lane top `y` | IDENTICAL for every lane |
| First card `y` | lane `y` + `88` minimum (40px header + 48px pad) |
| Row pitch | card height + `24` - the unit of the shared row grid |
| Lane height | `(deepest card bottom across ALL lanes) - lane.y + 48`, applied to EVERY lane |

**Rows are shared, not per-lane.** Pick the row grid once for the whole diagram (`y = firstRowY + n * rowPitch`),
then place each card on the row its STAGE occupies, leaving a row empty in lanes that skip that stage. Do not
pack each lane from its own top - that gives every lane a different meaning for "row 2".

Then place each card by what it connects to, working outward from the lane with the most cards:

- **One-to-one:** a card and the single card it feeds share a `y`, so the connector is a flat horizontal line.
- **Fan-out:** a card that feeds SEVERAL cards sits at their midpoint - the average of their centres, minus half
  its own height. **This is usually BETWEEN rows, and that is correct**: it makes the fan read as symmetric
  instead of hanging off the topmost branch. Same rule mirrored for fan-in.
- **Unconnected:** keep the card on its row, in its lane's existing order.
- Never let two cards in a lane come closer than `24`, and never push one above `lane.y + 88` or below
  `lane.y + height - 48`.

Uniform lane heights are **larger** than the hug would produce, so pin them: give every lane
`"manualSize": true`, or accept that the first card drag re-hugs each lane to its own contents.

> **In the app:** right-click any lane on a `process` diagram (or select several lanes and right-click) →
> **Match Container Height**. It computes exactly the geometry above - one top, one height taken from the lane
> with the most cards, one-to-one rows flat, fan-outs centred - and pins the result with `manualSize`. A diagram
> authored to this section is a **fixed point** of that action: running it changes nothing. That makes it a free
> self-check - if the diagram visibly moves, your generated geometry did not satisfy the rules above.

**Self-check before you emit.** Every one of these must hold:

1. Every card in the diagram has the same `size`.
2. Every lane has the same `position.y`, and every lane has the same `size.height`. No lane's height is a
   function of its own card count.
3. Every card `y` is `firstRowY + n * rowPitch` for some integer `n`.
4. Every pair of cards joined by a link shares a `y`, unless the link is a deliberate fan-out.
5. Both sides of every embed are set (`embeds[]` **and** `parent`), and lanes with a non-resting height carry
   `"manualSize": true`.
6. Left and right insets are 48 on both edges of every lane; no card sits less than 88px below its lane's top.

## Limits

- Maximum 2000 cells per diagram (enforced on import).
- Element IDs must be unique strings across all cells.
- Link `source.id` and `target.id` must reference existing element IDs.
- Link `source.port` and `target.port` must match port IDs defined on the referenced elements.

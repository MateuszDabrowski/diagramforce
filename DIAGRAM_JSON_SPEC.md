# Diagramforce JSON Specification

> Reference for LLMs and developers generating importable diagram JSON files for [diagramforce.app](https://diagramforce.app).
>
> **Spec snapshot: v1.14.1** — matches the app's current `appVersion`; set `"appVersion": "1.14.1"` in generated files.

## Top-Level Structure

```json
{
  "version": 1,
  "appVersion": "1.14.1",
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

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | number | Yes | Always `1` |
| `appVersion` | string | Yes | Semver string, currently `"1.14.1"` |
| `timestamp` | number | No | Unix timestamp in milliseconds |
| `title` | string | Yes | Diagram name (shown as tab title) |
| `diagramType` | string | Yes | One of: `"architecture"`, `"process"`, `"datamodel"`, `"org"`, `"gantt"`, `"sequence"`. **Must match the shapes you use** (see [Diagram Types](#diagram-types)). Aliases `"data"`/`"organisation"` are accepted but the canonical forms are `"datamodel"` and `"org"` |
| `graph` | object | Yes | Contains `cells` array — the JointJS graph data |
| `viewport` | object | No | Pan/zoom state. Omit to auto-fit on load |

> ⚠️ **Always set `diagramType` to match the shapes in the diagram.** If it is missing or wrong, the diagram opens as an architecture tab — the sequence-specific Auto Layout, the data-model stencil, the Gantt timeline controls, etc. are gated on the tab type and will be unavailable until the tab is recreated. Pick the type from the table below **before** choosing shapes.

> For generating an importable diagram, prefer the **single-diagram** envelope
> above — it opens as a new tab. Two multi-element container formats also import
> (produced by the app's Export Manager), but you normally won't generate them:
>
> ```json
> { "schema": "diagramforce-export", "version": 1, "appVersion": "1.14.1", "exportedAt": 1712700000000,
>   "diagrams": [ { "name": "...", "diagramType": "architecture", "graph": { "cells": [] }, "viewport": null, "appVersion": "1.14.1" } ],
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

## Diagram Types

| Type | Use For | Primary Shapes |
|------|---------|----------------|
| `architecture` | System architecture, integrations | SimpleNode, Container, Zone, Note, TextLabel, Image |
| `process` | BPMN workflows, flowcharts | BpmnEvent, BpmnTask, BpmnGateway, BpmnSubprocess, BpmnLoop, BpmnPool, BpmnDataObject, Flow* shapes, Annotation |
| `datamodel` | ERDs, Salesforce object models | DataObject |
| `org` | Org charts, team structures, RACI workflows | OrgPerson, Container (Team), Zone, Task |
| `gantt` | Project timelines | GanttTimeline, GanttTask, GanttMilestone, GanttGroup, GanttMarker |
| `sequence` | UML sequence diagrams, message flows | SequenceParticipant, SequenceActor, SequenceActivation, SequenceFragment |

> **`sf.Image`** is available in every diagram type's "Generic Shapes" stencil group (since v1.9). Note that any tab containing `sf.Image` cells has Share-as-URL automatically disabled — see [sf.Image](#sfimage-since-v19) for details.

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

Shapes that do NOT have ports: `sf.TextLabel`, `sf.Note`, `sf.Line`, `sf.Link`, `sf.Zone`, `sf.BpmnPool`.

## Link Structure

Links connect two elements via ports:

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

`position` is 0–1 (0 = source end, 0.5 = middle, 1 = target end).

### Marker Types

The `sourceMarker` and `targetMarker` control arrow/endpoint styles:

| Marker | Definition | Use |
|--------|-----------|-----|
| Arrow | `{ "type": "path", "d": "M 0 -6 L -14 0 L 0 6 z" }` | Standard directional arrow (no explicit fill/stroke — auto-inherited) |
| None | `{ "type": "path", "d": "M 0 0 L -12 0", "fill": "none", "stroke": "#888888", "stroke-width": 2 }` | Stub line (use the link's stroke color) |
| One | `{ "type": "path", "d": "M -12 -8 L -12 8 M -12 0 L 0 0", "fill": "none", "stroke": "#888888", "stroke-width": 2 }` | ER: exactly one |
| Zero or One | `{ "type": "path", "d": "M 2 0 a 5 5 0 1 1 -10 0 a 5 5 0 1 1 10 0 Z M -8 0 L -12 0 M -12 -8 L -12 8", "fill": "var(--bg-canvas, #1A1A1A)", "stroke": "#888888", "stroke-width": 2 }` | ER: zero or one |
| Many | `{ "type": "path", "d": "M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0", "fill": "none", "stroke": "#888888", "stroke-width": 2 }` | ER: many (crow's foot) |
| One or Many | `{ "type": "path", "d": "M -12 -8 L 0 0 L -12 8 M 0 0 L -12 0 M 3 -8 L 3 8", "fill": "none", "stroke": "#888888", "stroke-width": 2 }` | ER: one or many |
| Zero or Many | `{ "type": "path", "d": "M 4 0 a 5 5 0 1 1 10 0 a 5 5 0 1 1 -10 0 Z M -12 -8 L 0 0 M 0 0 L -12 8 M 0 0 L -12 0", "fill": "var(--bg-canvas, #1A1A1A)", "stroke": "#888888", "stroke-width": 2 }` | ER: zero or many |

For ER markers, replace `"#888888"` with the link's actual stroke color.
For arrow markers, do NOT set explicit fill/stroke — JointJS auto-inherits from the line.

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

Leave `icon/href` as `""` for a text-only node. A node whose `body/fill` is a brand colour reads best with `label/fill: "#FFFFFF"` (white icon + label on the coloured body). The same `data-icon-id` href works for `sf.Container` `headerIcon/href`.

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
    { "label": "Id", "apiName": "Id", "type": "ID", "keyType": "pk", "length": null, "required": false, "decommissioned": false },
    { "label": "Name", "apiName": "Name", "type": "Text", "keyType": null, "length": 255, "required": true, "decommissioned": false },
    { "label": "Industry", "apiName": "Industry", "type": "Picklist", "keyType": null, "length": null, "required": false, "decommissioned": false },
    { "label": "Owner", "apiName": "OwnerId", "type": "Lookup", "keyType": "fk", "length": null, "required": true, "decommissioned": false }
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
    "headerLabel": {
      "x": 12, "y": 16,
      "textAnchor": "start", "textVerticalAnchor": "middle",
      "fontSize": 13, "fontWeight": "bold",
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "#FFFFFF",
      "text": "Account"
    }
  },
  "ports": {
    "groups": {
      "top":    { "position": { "name": "top" },    "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] },
      "bottom": { "position": { "name": "bottom" }, "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] },
      "fieldLeft":  { "position": { "name": "left" },  "attrs": { "circle": { "r": 4, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] },
      "fieldRight": { "position": { "name": "right" }, "attrs": { "circle": { "r": 4, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] }
    },
    "items": [
      { "id": "port-top",    "group": "top" },
      { "id": "port-bottom", "group": "bottom" }
    ]
  }
}
```

**Field object structure:**

| Field | Type | Description |
|-------|------|-------------|
| `label` | string | Display name |
| `apiName` | string | API/column name (shown in the field row) |
| `type` | string | Data type (e.g., `"Text"`, `"Number"`, `"Lookup"`, `"ID"`, `"Picklist"`, `"Date"`, `"Boolean"`, `"Currency"`, `"Formula"`) |
| `keyType` | `"pk"` / `"fk"` / `null` | Primary key or foreign key badge |
| `length` | number / null | Field length (shown if `showFieldLengths` is true) |
| `required` | boolean | Shows asterisk if true |
| `decommissioned` | boolean | Strikes through the field if true |

**Display flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `showLabels` | `false` | Show the human-readable `label` alongside `apiName` in each row |
| `showFieldLengths` | `false` | Show `(length)` suffix next to the type |
| `keyFieldsOnly` | `false` | When `true`, only fields with `keyType` (PK/FK) are rendered; the object height shrinks to fit |

**Sizing rule:** Set height to `32 + (max(visibleFields, 1) * 22) + 4`. The custom view auto-renders field rows. `visibleFields` equals `fields.length` unless `keyFieldsOnly` is `true`, in which case only fields with `keyType` are counted.

**Linking DataObjects for ER diagrams:**

Two port conventions:

1. **Object-level ports (`port-top`, `port-bottom`)** — pre-seeded in `ports.items`. Use for "this table relates to that table" links.
2. **Field-level ports (`field-left-{i}`, `field-right-{i}`)** — dynamically created by the view for every field with a `keyType` (`pk` or `fk`). The `{i}` is the field's zero-based index in the original `fields` array (stable even when `keyFieldsOnly` hides non-key rows). Prefer these for PK→FK relationships so the line anchors to the actual row.

Do NOT list field-level ports in `ports.items` — they are generated at render time. Just reference them from link endpoints: `"source": { "id": "obj-contact", "port": "field-right-0" }`.

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
  "z": 900,
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
- Embedded children (Person/Team cards) are captured like a Zone capture — they move with the task when dragged but the user controls their position inside the right column.
- Task `z` is intentionally below Container (1000) and OrgPerson (2000) so embedded cards always render above the Task body.

Standard 4 ports (top, right, bottom, left) — use them to link Tasks to other tasks or deliverables.

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
- `"inclusive"`: `"\u25ef"` (large circle)
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

> A Gantt chart is built around a **`sf.GanttTimeline`** backbone — a date-ruler container that the other Gantt shapes are positioned over. Add the timeline first, then place tasks / milestones / markers across its columns.

#### sf.GanttTimeline

The date-ruler backbone of a Gantt chart: a header row of period columns (days / weeks / months) plus a left-hand task-list panel. Group and task **rows** are stored on the timeline itself (in the `tasks` array); `sf.GanttTask` / `sf.GanttMilestone` / `sf.GanttMarker` elements are then positioned over its columns by canvas X.

**Default size:** `960 x 48`, **z:** `1000` (container tier). No ports.

**Properties (all top-level, not under `attrs`):**
- `viewMode` — `"day"`, `"week"`, or `"month"` (column granularity). Default `"week"`.
- `numPeriods` — number of columns (default `12`; stencil presets: day `14`, week `12`, month `12`).
- `startDate` / `endDate` — `"YYYY-MM-DD"`. `endDate` auto-computes from `startDate` + `numPeriods` when blank (day → +N days, week → +N×7 days, month → +N months). The view snaps `startDate` to a Monday (week) or the 1st (month).
- `tasks` — array of `{ id, type: "group" | "task", label, groupId?, color? }`; `task` rows reference their parent group via `groupId`.
- `taskListWidth` — width (px) of the left task-list panel (default `200`).
- `rowHeight` — height (px) per task row (default / min `48`). The timeline auto-grows its height to fit the visible rows.
- `timelineTitle` / `timelineDescription` — header text for the task-list panel (default `"Tasks"` / `""`).

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
  "timelineDescription": "",
  "tasks": [
    { "id": "g1", "type": "group", "label": "Phase 1", "color": "#1D73C9" },
    { "id": "t1", "type": "task", "groupId": "g1", "label": "Discovery", "color": "#1D73C9" }
  ]
}
```

#### sf.GanttTask

Horizontal progress bar.

**Default size:** `240 x 32`

```json
{
  "id": "gtask-1",
  "type": "sf.GanttTask",
  "position": { "x": 200, "y": 100 },
  "size": { "width": 240, "height": 32 },
  "z": 2000,
  "taskLabel": "Design Phase",
  "progress": 75,
  "startDate": "2024-01-15",
  "endDate": "2024-02-15",
  "assignee": "JS",
  "barColor": "#1D73C9",
  "attrs": {
    "body": {
      "width": "calc(w)", "height": "calc(h)",
      "rx": 4, "ry": 4,
      "fill": "var(--node-bg)", "stroke": "var(--node-border)", "strokeWidth": 1
    },
    "progressBar": {
      "width": 180, "height": "calc(h)",
      "rx": 4, "ry": 4,
      "fill": "#1D73C9", "stroke": "none"
    },
    "label": {
      "x": 8, "y": "calc(0.5 * h)",
      "textAnchor": "start", "textVerticalAnchor": "middle",
      "fontSize": 12, "fontWeight": 600,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "#FFFFFF",
      "text": "Design Phase",
      "textWrap": { "width": "calc(w - 16)", "maxLineCount": 1, "ellipsis": true }
    },
    "percentLabel": {
      "x": "calc(w - 8)", "y": "calc(0.5 * h - 4)",
      "textAnchor": "end", "textVerticalAnchor": "middle",
      "fontSize": 10,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "var(--text-secondary)",
      "text": "75%"
    },
    "assigneeLabel": {
      "x": "calc(w - 8)", "y": "calc(0.5 * h + 8)",
      "textAnchor": "end", "textVerticalAnchor": "middle",
      "fontSize": 9,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "var(--text-secondary)",
      "text": "JS"
    }
  },
  "ports": {
    "groups": {
      "left":  { "position": { "name": "left" },  "attrs": { "circle": { "r": 4, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] },
      "right": { "position": { "name": "right" }, "attrs": { "circle": { "r": 4, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] }
    },
    "items": [
      { "id": "port-left",  "group": "left" },
      { "id": "port-right", "group": "right" }
    ]
  }
}
```

**Progress bar width:** Set `progressBar/width` to `Math.round(totalWidth * progress / 100)`.

#### sf.GanttMilestone

Diamond milestone marker.

**Default size:** `24 x 24`

```json
{
  "id": "milestone-1",
  "type": "sf.GanttMilestone",
  "position": { "x": 400, "y": 104 },
  "size": { "width": 24, "height": 24 },
  "z": 2000,
  "milestoneDate": "2024-03-01",
  "attrs": {
    "body": {
      "refPoints": "0,0.5 0.5,0 1,0.5 0.5,1",
      "fill": "#F6B355", "stroke": "#D4942A", "strokeWidth": 1.5
    },
    "label": {
      "x": "calc(0.5 * w)", "y": -4,
      "textAnchor": "middle", "textVerticalAnchor": "bottom",
      "fontSize": 11,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fill": "var(--text-primary)",
      "text": "Launch"
    }
  },
  "ports": { /* left/right only */ }
}
```

#### sf.GanttGroup

Summary/phase bar with bracket indicators.

**Default size:** `360 x 24`, **z:** `1000`

#### sf.GanttMarker

Today marker (triangle).

**Default size:** `20 x 16`

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

## Complete Examples

### Architecture Diagram

A simple 3-node architecture with one container:

```json
{
  "version": 1,
  "appVersion": "1.14.1",
  "timestamp": 1712700000000,
  "title": "Simple Architecture",
  "diagramType": "architecture",
  "graph": {
    "cells": [
      {
        "id": "zone-1",
        "type": "sf.Zone",
        "position": { "x": 30, "y": 30 },
        "size": { "width": 560, "height": 340 },
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
            "text": "Salesforce Org",
            "textWrap": { "width": "calc(w - 24)", "maxLineCount": 1, "ellipsis": true }
          }
        }
      },
      {
        "id": "node-web",
        "type": "sf.SimpleNode",
        "position": { "x": 60, "y": 80 },
        "size": { "width": 180, "height": 64 },
        "z": 2000,
        "attrs": {
          "body": { "width": "calc(w)", "height": "calc(h)", "rx": 8, "ry": 8, "fill": "var(--node-bg)", "stroke": "var(--node-border)", "strokeWidth": 1 },
          "icon": { "x": 12, "y": "calc(0.5 * h - 16)", "width": 32, "height": 32, "href": "" },
          "label": { "x": "calc(0.5 * w)", "y": "calc(0.5 * h)", "textAnchor": "middle", "textVerticalAnchor": "middle", "fontSize": 13, "fontFamily": "system-ui, -apple-system, sans-serif", "fill": "var(--node-text)", "text": "Web App", "textWrap": { "width": "calc(w - 64)", "maxLineCount": 4, "ellipsis": true } },
          "subtitle": { "x": 12, "y": 42, "textAnchor": "start", "textVerticalAnchor": "top", "fontSize": 10, "fontFamily": "system-ui, -apple-system, sans-serif", "fill": "var(--node-subtitle)", "text": "", "visibility": "hidden", "textWrap": { "width": "calc(w - 24)", "height": "calc(h - 48)", "ellipsis": true } }
        },
        "ports": {
          "groups": {
            "top":    { "position": { "name": "top" },    "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] },
            "right":  { "position": { "name": "right" },  "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] },
            "bottom": { "position": { "name": "bottom" }, "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] },
            "left":   { "position": { "name": "left" },   "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] }
          },
          "items": [
            { "id": "port-top", "group": "top" },
            { "id": "port-right", "group": "right" },
            { "id": "port-bottom", "group": "bottom" },
            { "id": "port-left", "group": "left" }
          ]
        }
      },
      {
        "id": "node-api",
        "type": "sf.SimpleNode",
        "position": { "x": 60, "y": 220 },
        "size": { "width": 180, "height": 64 },
        "z": 2000,
        "attrs": {
          "body": { "width": "calc(w)", "height": "calc(h)", "rx": 8, "ry": 8, "fill": "var(--node-bg)", "stroke": "var(--node-border)", "strokeWidth": 1 },
          "icon": { "x": 12, "y": "calc(0.5 * h - 16)", "width": 32, "height": 32, "href": "" },
          "label": { "x": "calc(0.5 * w)", "y": "calc(0.5 * h)", "textAnchor": "middle", "textVerticalAnchor": "middle", "fontSize": 13, "fontFamily": "system-ui, -apple-system, sans-serif", "fill": "var(--node-text)", "text": "REST API", "textWrap": { "width": "calc(w - 64)", "maxLineCount": 4, "ellipsis": true } },
          "subtitle": { "x": 12, "y": 42, "textAnchor": "start", "textVerticalAnchor": "top", "fontSize": 10, "fontFamily": "system-ui, -apple-system, sans-serif", "fill": "var(--node-subtitle)", "text": "", "visibility": "hidden", "textWrap": { "width": "calc(w - 24)", "height": "calc(h - 48)", "ellipsis": true } }
        },
        "ports": {
          "groups": {
            "top":    { "position": { "name": "top" },    "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] },
            "right":  { "position": { "name": "right" },  "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] },
            "bottom": { "position": { "name": "bottom" }, "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] },
            "left":   { "position": { "name": "left" },   "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] }
          },
          "items": [
            { "id": "port-top", "group": "top" },
            { "id": "port-right", "group": "right" },
            { "id": "port-bottom", "group": "bottom" },
            { "id": "port-left", "group": "left" }
          ]
        }
      },
      {
        "id": "node-db",
        "type": "sf.SimpleNode",
        "position": { "x": 370, "y": 220 },
        "size": { "width": 180, "height": 64 },
        "z": 2000,
        "attrs": {
          "body": { "width": "calc(w)", "height": "calc(h)", "rx": 8, "ry": 8, "fill": "var(--node-bg)", "stroke": "var(--node-border)", "strokeWidth": 1 },
          "icon": { "x": 12, "y": "calc(0.5 * h - 16)", "width": 32, "height": 32, "href": "" },
          "label": { "x": "calc(0.5 * w)", "y": "calc(0.5 * h)", "textAnchor": "middle", "textVerticalAnchor": "middle", "fontSize": 13, "fontFamily": "system-ui, -apple-system, sans-serif", "fill": "var(--node-text)", "text": "Database", "textWrap": { "width": "calc(w - 64)", "maxLineCount": 4, "ellipsis": true } },
          "subtitle": { "x": 12, "y": 42, "textAnchor": "start", "textVerticalAnchor": "top", "fontSize": 10, "fontFamily": "system-ui, -apple-system, sans-serif", "fill": "var(--node-subtitle)", "text": "", "visibility": "hidden", "textWrap": { "width": "calc(w - 24)", "height": "calc(h - 48)", "ellipsis": true } }
        },
        "ports": {
          "groups": {
            "top":    { "position": { "name": "top" },    "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] },
            "right":  { "position": { "name": "right" },  "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] },
            "bottom": { "position": { "name": "bottom" }, "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] },
            "left":   { "position": { "name": "left" },   "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] }
          },
          "items": [
            { "id": "port-top", "group": "top" },
            { "id": "port-right", "group": "right" },
            { "id": "port-bottom", "group": "bottom" },
            { "id": "port-left", "group": "left" }
          ]
        }
      },
      {
        "id": "link-1",
        "type": "standard.Link",
        "z": 3001,
        "source": { "id": "node-web", "port": "port-bottom" },
        "target": { "id": "node-api", "port": "port-top" },
        "attrs": {
          "line": {
            "stroke": "#888888",
            "strokeWidth": 2,
            "targetMarker": { "type": "path", "d": "M 0 -6 L -14 0 L 0 6 z" }
          }
        },
        "router": { "name": "sfManhattan" },
        "connector": { "name": "rounded", "args": { "radius": 8 } }
      },
      {
        "id": "link-2",
        "type": "standard.Link",
        "z": 3002,
        "source": { "id": "node-api", "port": "port-right" },
        "target": { "id": "node-db", "port": "port-left" },
        "attrs": {
          "line": {
            "stroke": "#888888",
            "strokeWidth": 2,
            "targetMarker": { "type": "path", "d": "M 0 -6 L -14 0 L 0 6 z" }
          }
        },
        "router": { "name": "sfManhattan" },
        "connector": { "name": "rounded", "args": { "radius": 8 } }
      }
    ]
  }
}
```

### Data Model (ERD)

Two related Salesforce objects with ER notation:

```json
{
  "version": 1,
  "appVersion": "1.14.1",
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
          { "label": "Id", "apiName": "Id", "type": "ID", "keyType": "pk", "length": null, "required": false, "decommissioned": false },
          { "label": "Name", "apiName": "Name", "type": "Text", "keyType": null, "length": 255, "required": true, "decommissioned": false },
          { "label": "Industry", "apiName": "Industry", "type": "Picklist", "keyType": null, "length": null, "required": false, "decommissioned": false },
          { "label": "Annual Revenue", "apiName": "AnnualRevenue", "type": "Currency", "keyType": null, "length": null, "required": false, "decommissioned": false },
          { "label": "Owner", "apiName": "OwnerId", "type": "Lookup", "keyType": "fk", "length": null, "required": true, "decommissioned": false }
        ],
        "showLabels": false,
        "showFieldLengths": false,
        "keyFieldsOnly": false,
        "attrs": {
          "body": { "width": "calc(w)", "height": "calc(h)", "rx": 4, "ry": 4, "fill": "var(--node-bg)", "stroke": "var(--node-border)", "strokeWidth": 1 },
          "header": { "width": "calc(w)", "height": 32, "rx": 4, "ry": 4, "fill": "#1D73C9", "stroke": "none" },
          "headerCover": { "width": "calc(w)", "height": 16, "y": 16, "fill": "#1D73C9", "stroke": "none" },
          "headerLabel": { "x": 12, "y": 16, "textAnchor": "start", "textVerticalAnchor": "middle", "fontSize": 13, "fontWeight": "bold", "fontFamily": "system-ui, -apple-system, sans-serif", "fill": "#FFFFFF", "text": "Account" }
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
          { "label": "Id", "apiName": "Id", "type": "ID", "keyType": "pk", "length": null, "required": false, "decommissioned": false },
          { "label": "Name", "apiName": "Name", "type": "Text", "keyType": null, "length": 255, "required": true, "decommissioned": false },
          { "label": "Email", "apiName": "Email", "type": "Email", "keyType": null, "length": null, "required": false, "decommissioned": false },
          { "label": "Account", "apiName": "AccountId", "type": "Lookup", "keyType": "fk", "length": null, "required": false, "decommissioned": false },
          { "label": "Title", "apiName": "Title", "type": "Text", "keyType": null, "length": 128, "required": false, "decommissioned": false }
        ],
        "showLabels": false,
        "showFieldLengths": false,
        "keyFieldsOnly": false,
        "attrs": {
          "body": { "width": "calc(w)", "height": "calc(h)", "rx": 4, "ry": 4, "fill": "var(--node-bg)", "stroke": "var(--node-border)", "strokeWidth": 1 },
          "header": { "width": "calc(w)", "height": 32, "rx": 4, "ry": 4, "fill": "#7F2B82", "stroke": "none" },
          "headerCover": { "width": "calc(w)", "height": 16, "y": 16, "fill": "#7F2B82", "stroke": "none" },
          "headerLabel": { "x": 12, "y": 16, "textAnchor": "start", "textVerticalAnchor": "middle", "fontSize": 13, "fontWeight": "bold", "fontFamily": "system-ui, -apple-system, sans-serif", "fill": "#FFFFFF", "text": "Contact" }
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

A two-participant sync exchange with an activation box and an `alt` fragment. Messages are port-based: both participants carry `lifelinePortCount: 10`, so `seq-port-*-0` is the first message slot, `seq-port-*-1` the second, etc.

```json
{
  "version": 1,
  "appVersion": "1.14.1",
  "title": "Account Lookup",
  "diagramType": "sequence",
  "graph": {
    "cells": [
      {
        "id": "part-sf",
        "type": "sf.SequenceParticipant",
        "position": { "x": 60, "y": 40 },
        "size": { "width": 140, "height": 360 },
        "z": 2000,
        "participantRole": "salesforce",
        "lifelinePortCount": 10,
        "showBottomLabel": true,
        "attrs": {
          "header":       { "stroke": "#2E844A" },
          "headerAccent": { "fill":   "#2E844A" },
          "label":        { "text": "Salesforce" },
          "lifeline":     { "stroke": "#2E844A" },
          "underline":    { "stroke": "#2E844A", "opacity": 0.6 }
        }
      },
      {
        "id": "part-api",
        "type": "sf.SequenceParticipant",
        "position": { "x": 280, "y": 40 },
        "size": { "width": 140, "height": 360 },
        "z": 2000,
        "participantRole": "api",
        "lifelinePortCount": 10,
        "showBottomLabel": true,
        "attrs": {
          "header":       { "stroke": "#1D73C9" },
          "headerAccent": { "fill":   "#1D73C9" },
          "label":        { "text": "Account API" },
          "lifeline":     { "stroke": "#1D73C9" },
          "underline":    { "stroke": "#1D73C9", "opacity": 0.6 }
        }
      },
      {
        "id": "frag-1",
        "type": "sf.SequenceFragment",
        "position": { "x": 30, "y": 180 },
        "size": { "width": 460, "height": 120 },
        "z": 500,
        "fragmentType": "alternative",
        "fragmentLabel": "alt",
        "condition": "account found",
        "elseCondition": "account not found",
        "attrs": {
          "body":          { "stroke": "#8A9099", "fill": "rgba(138,144,153,0.05)" },
          "titleText":     { "text": "alt" },
          "conditionText": { "text": "[account found]" },
          "dividerLine":   { "visibility": "visible" },
          "elseText":      { "text": "[account not found]", "visibility": "visible" }
        }
      },
      {
        "id": "act-api",
        "type": "sf.SequenceActivation",
        "position": { "x": 344, "y": 130 },
        "size": { "width": 12, "height": 80 },
        "z": 2200,
        "attrs": {
          "body": { "fill": "#D0D4D9", "stroke": "#8A9099", "strokeWidth": 1 }
        }
      },
      {
        "id": "msg-1",
        "type": "standard.Link",
        "z": 3000,
        "source": { "id": "part-sf",  "port": "seq-port-right-2" },
        "target": { "id": "part-api", "port": "seq-port-left-2" },
        "router":    { "name": "normal" },
        "connector": { "name": "normal" },
        "attrs": {
          "line": {
            "stroke": "#5E6B7A", "strokeWidth": 2,
            "sourceMarker": { "type": "path", "d": "M 0 0 L -6 0", "fill": "none", "stroke": "#5E6B7A", "stroke-width": 2 },
            "targetMarker": { "type": "path", "d": "M 0 -6 L -14 0 L 0 6 z" }
          }
        },
        "labels": [
          { "position": { "distance": 0.5, "offset": -10 },
            "attrs": { "text": { "text": "getAccount(id)", "fontSize": 11, "fill": "var(--text-primary)" } } }
        ]
      },
      {
        "id": "msg-2",
        "type": "standard.Link",
        "z": 3000,
        "source": { "id": "part-api", "port": "seq-port-left-3" },
        "target": { "id": "part-sf",  "port": "seq-port-right-3" },
        "router":    { "name": "normal" },
        "connector": { "name": "normal" },
        "lineStyle": "6 4",
        "attrs": {
          "line": {
            "stroke": "#5E6B7A", "strokeWidth": 2,
            "sourceMarker": { "type": "path", "d": "M 0 0 L -6 0", "fill": "none", "stroke": "#5E6B7A", "stroke-width": 2, "stroke-dasharray": "none" },
            "targetMarker": { "type": "path", "d": "M 0 -6 L -14 0 L 0 6 z", "stroke-dasharray": "none" }
          }
        },
        "labels": [
          { "position": { "distance": 0.5, "offset": -10 },
            "attrs": { "text": { "text": "Account{...}", "fontSize": 11, "fill": "var(--text-primary)" } } }
        ]
      }
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

# Diagramforce JSON Specification

> Reference for LLMs and developers generating importable diagram JSON files for [diagramforce.app](https://diagramforce.app).

## Top-Level Structure

```json
{
  "version": 1,
  "appVersion": "1.4.1",
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
| `appVersion` | string | Yes | Semver string, currently `"1.4.1"` |
| `timestamp` | number | No | Unix timestamp in milliseconds |
| `title` | string | Yes | Diagram name (shown as tab title) |
| `diagramType` | string | Yes | One of: `"architecture"`, `"process"`, `"data"`, `"organisation"`, `"gantt"` |
| `graph` | object | Yes | Contains `cells` array — the JointJS graph data |
| `viewport` | object | No | Pan/zoom state. Omit to auto-fit on load |

## Diagram Types

| Type | Use For | Primary Shapes |
|------|---------|----------------|
| `architecture` | System architecture, integrations | SimpleNode, Container, Zone, Note, TextLabel |
| `process` | BPMN workflows, flowcharts | BpmnEvent, BpmnTask, BpmnGateway, BpmnSubprocess, BpmnPool, Flow* shapes |
| `data` | ERDs, Salesforce object models | DataObject |
| `organisation` | Org charts, team structures | OrgPerson, Container, Zone |
| `gantt` | Project timelines | GanttTimeline, GanttTask, GanttMilestone, GanttGroup, GanttMarker |

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
| BpmnSubprocess, BpmnLoop | `500` | Sub-containers |
| Container, GanttTimeline, GanttGroup | `1000` | Containers |
| SimpleNode, Note, TextLabel, DataObject, OrgPerson, all Bpmn/Flow shapes, GanttTask, GanttMilestone, GanttMarker | `2000` | Elements |
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

Shapes that do NOT have ports: `sf.TextLabel`, `sf.Note`, `sf.Line`, `sf.Zone`, `sf.BpmnPool`.

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
      "textWrap": { "width": "calc(w - 64)", "maxLineCount": 2, "ellipsis": true }
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
- The icon `href` should be a data URI or left empty. When generating JSON externally, leave it empty — icons are decorative.

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
      "textWrap": { "width": "calc(w - 28)", "maxLineCount": 2, "ellipsis": true }
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
      "width": "calc(w)", "height": "calc(h)",
      "rx": 3, "ry": 3,
      "fill": "#FFF9C4", "stroke": "#E8D44D", "strokeWidth": 1
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

### sf.Line

Decorative horizontal line separator. Available in all diagram types.

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
    }
  }
}
```

**`lineStyle`** — `"solid"` (default), `"dashed"`, `"dotted"`, or `"breaks"`. Controls `strokeDasharray`:
- `solid` → `none`
- `dashed` → `12 6`
- `dotted` → `3 4`
- `breaks` → `16 8 2 8`

No ports.

### sf.DataObject

Database table / Salesforce object with coloured header and dynamic field rows. Used in data model diagrams.

**Default size:** `260 x 80` (height auto-adjusts: ~32px header + 24px per field)

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
      "bottom": { "position": { "name": "bottom" }, "attrs": { "circle": { "r": 5, "magnet": true, "fill": "var(--port-color, #1D73C9)", "stroke": "#FFFFFF", "strokeWidth": 1.5 } }, "markup": [{ "tagName": "circle", "selector": "circle" }] }
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

**Sizing rule:** Set height to `32 + (fields.length * 24)`. The custom view auto-renders field rows.

**Linking DataObjects for ER diagrams:** Use `port-top` and `port-bottom` for connections. Apply ER markers (see Marker Types section) to represent cardinality.

### sf.OrgPerson

Person card for organisation charts with avatar circle and detail fields.

**Default size:** `280 x 90` (height auto-adjusts based on visible details)

```json
{
  "id": "person-1",
  "type": "sf.OrgPerson",
  "position": { "x": 100, "y": 100 },
  "size": { "width": 280, "height": 90 },
  "z": 2000,
  "personName": "Jane Smith",
  "jobTitle": "VP Engineering",
  "email": "jane@example.com",
  "phone": "",
  "role": "Leadership",
  "stream": "",
  "location": "London",
  "company": "Acme Corp",
  "detailOrder": ["email", "phone", "role", "stream", "location", "company"],
  "imageUrl": "",
  "iconText": "JS",
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
- The `detailsLabel/text` is a newline-separated string of `"Label: Value"` pairs, built from the non-empty detail fields in `detailOrder`.
- Height auto-adjusts: ~60px base + ~14px per visible detail line. Set height to accommodate.

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
      "textWrap": { "width": "calc(w - 16)", "maxLineCount": 2, "ellipsis": true }
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

#### sf.BpmnPool

Horizontal pool/lane container.

**Default size:** `600 x 250`, **z:** `0`

Has a narrow left `header` panel with rotated vertical label. No ports.

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

### Gantt Shapes

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

## Complete Examples

### Architecture Diagram

A simple 3-node architecture with one container:

```json
{
  "version": 1,
  "appVersion": "1.4.1",
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
          "label": { "x": "calc(0.5 * w)", "y": "calc(0.5 * h)", "textAnchor": "middle", "textVerticalAnchor": "middle", "fontSize": 13, "fontFamily": "system-ui, -apple-system, sans-serif", "fill": "var(--node-text)", "text": "Web App", "textWrap": { "width": "calc(w - 64)", "maxLineCount": 2, "ellipsis": true } },
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
          "label": { "x": "calc(0.5 * w)", "y": "calc(0.5 * h)", "textAnchor": "middle", "textVerticalAnchor": "middle", "fontSize": 13, "fontFamily": "system-ui, -apple-system, sans-serif", "fill": "var(--node-text)", "text": "REST API", "textWrap": { "width": "calc(w - 64)", "maxLineCount": 2, "ellipsis": true } },
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
          "label": { "x": "calc(0.5 * w)", "y": "calc(0.5 * h)", "textAnchor": "middle", "textVerticalAnchor": "middle", "fontSize": 13, "fontFamily": "system-ui, -apple-system, sans-serif", "fill": "var(--node-text)", "text": "Database", "textWrap": { "width": "calc(w - 64)", "maxLineCount": 2, "ellipsis": true } },
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
  "appVersion": "1.4.1",
  "timestamp": 1712700000000,
  "title": "Account-Contact ERD",
  "diagramType": "data",
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

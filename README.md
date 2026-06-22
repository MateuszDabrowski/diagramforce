# Diagramforce

Free browser-based visual diagramming tool for Salesforce architects and consultants. Create architecture diagrams, data models, Data Cloud field mappings, process flows, org charts, Gantt charts, and UML sequence diagrams - all in your browser, with no account and no Diagramforce backend. Your diagrams stay in your browser; optionally connect your own Google Drive to auto-save, share, and browse version history - your files live in your own Drive, never on a Diagramforce server.

**[diagramforce.mateuszdabrowski.pl](https://diagramforce.mateuszdabrowski.pl)**

## Features

### Diagram types

- **Architecture Diagrams** - Map system landscape, integrations, and Salesforce clouds with 1700+ SLDS icons
- **Data Model Diagrams** - Define objects, fields, and relationships with ER notation (crow's foot, one, zero-or-one, etc.); tag objects with optional SLDS header icons (contact / account / email / third-party such as Snowflake)
- **Data Mapping Diagrams (Salesforce Data Cloud / Data 360)** - Map the end-to-end data journey from source systems → Data Lake / Data Model Objects → Activations, with field-level source→target mappings, mapping types (Standard, Formula, Streaming/Batch Transform, Calculated Insight), a synced table view, and CSV field import/export. One click turns an existing Data Model into a Data Mapping diagram
- **Process Diagrams** - Design business processes with BPMN and flowchart shapes
- **Organisation Charts** - Document team hierarchy with person cards, departments, and teams, plus a RACI toolkit (Task and Task Group shapes for responsibility matrices)
- **Gantt Charts** - Plan project timelines with tasks, milestones, phases, and dependencies
- **Sequence Diagrams** - UML sequence diagrams with participants, actors, activation boxes, and alt/loop fragments; reply-style messages default to dashed

### Editing & layout

- **Smart Node Layout** - Content auto-centers based on what's set: text-only, icon + text, or description layout
- **Auto-Sizing parents** - Containers, Zones, BPMN Pools and other parent shapes auto-grow *and* auto-shrink to keep one grid dot of padding below the lowest embedded child. Toggle off in Display menu if you want manual control
- **Smart shape conversions** - Convert between Node / Container / Icon and the new shape stays embedded in its previous parent whenever the embedding rules allow it
- **Multi-select** - Cmd/Ctrl+click *or* Shift+click; Shift+drag on blank canvas for rubber-band selection
- **Resize Guides** - Tracking lines extend from resized edges for easy alignment
- **Alignment & spacing guides** - While dragging, live guides snap edges and centres to nearby shapes, straighten directly-connected links, and show edge-to-edge spacing in px for even distribution
- **Crossing bumps** - Where two links cross without connecting, EDA-style "jump-over" arcs make the non-connection explicit (toggle in the Display menu)
- **Auto Layout** - One-click force-directed layout (Display menu) untangles connected components; Data Mapping lays out by data layer, and sequence diagrams get automatic lane + port alignment
- **Field-level lineage** - In a Data Mapping diagram, hover or select a single field to trace its full source→destination path; everything off the lineage dims back
- **Animate Connectors** - Optional Display toggle (every diagram type) that runs a directional flow along every connector; while it's on, the PNG export becomes an animated GIF
- **Multi-tab** - Work on multiple diagrams simultaneously with independent undo/redo per tab
- **Single-step undo for drags** - A continuous drag is one undo command, not one per pixel; structural edits (embeds, conversions, deletes, bulk field imports) each collapse into one undo step too
- **Guided onboarding** - A first-visit welcome splash and a diagram-type-aware walkthrough, relaunchable anytime from the Help button
- **Contextual empty-canvas hints** - A ghost wireframe suggests what to drop first for each diagram type
- **Dark / Light Theme** - Full theme support with Salesforce-aligned brand colours

### Persistence & sharing

- **Offline-capable** - Service worker caches the app shell + every runtime library; after first load, refresh in airplane mode and the app boots from cache
- **No Backend, local-first** - Everything runs client-side; your diagrams stay in your browser unless you opt in to Google Drive sync. Every open diagram is auto-kept in this browser's session, and closing a tab archives a copy you can reopen (90-day local storage)
- **Google Drive sync (opt-in)** - Connect your own Google Drive (`drive.file` scope, no Diagramforce backend) and every diagram auto-saves to a `.dgf` file in a "Diagramforce" folder you own. **Auto-save is on by default** (toggle in the Drive menu) on a **2-minute cadence** plus **work-boundary saves** (opening, switching, closing a tab). If a synced file changed elsewhere, a **Refresh** appears to pull the latest. Open your diagrams on any device from the **"Your Google Drive Diagrams"** library, browse **version history** (Open / Restore / Pin past versions, with a diff-highlighted preview), and keep working offline - it re-syncs when you reconnect. Disconnect any time; your files stay in your Drive
- **Storage managers** - Unified **Save & Export** / **Load & Import** / **Share** managers (each opens anchored under its navbar button). **Load & Import** has one tabbed surface: **Browser** (reopen open + closed diagrams, with a storage-usage gauge and a **Close & Delete** hub to tidy browser storage) / **Google Drive** / **File** (open a `.dgf` or `.json`) / **Paste**
- **Sharing** - Copy a self-contained **Diagramforce link** (the whole diagram in the URL), or - when connected to Drive - a short, always-up-to-date **Google Drive link**: keep it **public** (anyone, no sign-in), **invite** specific people as **Copy** (view-only; their edits fork to their own copy) or **Collaborate** (they edit the shared file directly, and you keep a private backup in your Drive), limit it to your **organisation**, or **Add to a team Shared Drive**. A file shared *to* you shows a **Shared File** chip; if your edits and a Drive change clash, a **Conflict Review** (Keep mine / Keep both / Keep Google Drive) resolves them with a side-by-side diff-highlighted preview. **Share a whole tab group** as a single public link that reopens every diagram in the group
- **Custom Templates** - Capture any multi-selection as a reusable template; stored locally and (when connected) synced across your devices via Google Drive, with deletes that propagate
- **Export & backup** - Export as JSON / PNG / WEBP / SVG / animated GIF; bundle selected or all diagrams (plus your templates) into a single JSON file from **Save & Export**
- **Mermaid Import (beta)** - Paste mermaid.js source (`graph` / `flowchart` / `stateDiagram` → Process, `erDiagram` → Data Model, `sequenceDiagram` → Sequence) and convert into a native diagramforce diagram with auto-layout
- **Fit to Content** - Automatically fits viewport when loading shared or saved diagrams

## Keyboard shortcuts

| Action | Shortcut |
|--------|----------|
| Undo | Cmd/Ctrl + Z |
| Redo | Cmd/Ctrl + Shift + Z |
| Copy | Cmd/Ctrl + C |
| Paste | Cmd/Ctrl + V |
| Duplicate | Cmd/Ctrl + D |
| Select all | Cmd/Ctrl + A |
| Delete | Delete / Backspace |
| Nudge selection | Arrow keys (Shift = 16 px step) |
| Multi-select | Cmd/Ctrl + Click *or* Shift + Click |
| Rubber-band select | Shift + Drag (on blank canvas) |
| Save & Export | Cmd/Ctrl + S |
| Load & Import | Cmd/Ctrl + O |
| New diagram | Cmd/Ctrl + N |
| Close tab | Cmd/Ctrl + W |
| Zoom in / out | + / − (or scroll / pinch) |
| Fit to screen | Ctrl + 0 |

## Tech stack

| Layer | Technology |
|-------|-----------|
| Diagramming | [JointJS v4.0.4](https://www.jointjs.com/) (vendored, same-origin) |
| UI design system | [Salesforce Lightning Design System v2.29.1](https://www.lightningdesignsystem.com/) - sprites self-hosted |
| Compression | pako (vendored) for share-URL deflate |
| Animated export | gifenc (vendored) for GIF export |
| Code | Vanilla JavaScript with ES modules - no framework, no bundler, no build step |
| Styling | CSS custom properties with theme switching |
| Offline | Service worker with `APP_VERSION`-keyed cache |

All third-party libraries are vendored under `assets/vendor/` and served same-origin - no CDN runtime dependency.

## Project structure

```
index.html              Single-page entry point (SVG sprites inlined, modal markup)
manifest.json           PWA manifest (installable app)
sw.js                   Service worker (offline cache, APP_VERSION-keyed)
package.json            Test-runner config - the app itself stays build-free
css/                    Modular stylesheets (variables, theme, layout + one per UI panel)
js/
  app.js                Entry point - initialises all modules in dependency order, registers SW
  canvas.js             Facade over the canvas engine (graph/paper, z-order, register* wiring)
  canvas/               Canvas sub-modules behind a shared runtime context (cctx): router
                        (sfManhattan), auto-layout, viewport (pan/zoom/grid), migration,
                        crossing-bumps, spacing-guides, selection-viz, embedding,
                        line-style, external-labels, focus-state (field-level dimming),
                        mobile, context
  components.js         Stencil definitions per diagram type + element factory
  shapes.js             Custom JointJS shape definitions (sf.* namespace)
  stencil.js            Stencil panel with search + drag-to-canvas drop
  properties.js         Property inspector, field editor, ER marker picker, type conversions
  selection.js          Multi-select, rubber-band, resize tracking lines, alignment ops
  templates.js          Custom Templates library - capture a selection as a reusable subgraph
  tabs.js               Multi-diagram tabs with per-tab history + viewport + session restore
  toolbar.js            Toolbar wiring, Save/Load/Export/Display modals
  table-view.js         Data Mapping table view - read-only spreadsheet projection of the mappings
  persistence.js        Facade: APP_VERSION + save/load orchestration; re-exports sub-modules
  persistence/          Persistence sub-modules behind a shared context (pctx): storage
                        (named saves), json-pipeline (load/import/paste), image-export
                        (PNG/WEBP/GIF), share-orchestration (URL codec), versioning, context
  history.js            Undo/redo with drag-aware merge (continuous events → one command)
  clipboard.js          Copy/paste/duplicate with link-aware cloning
  feedback.js           Toasts, confirm/prompt dialogs, shared modal scaffold
  keyboard.js           Keyboard shortcut manager
  walkthrough.js        First-visit welcome splash + diagram-type-aware guided tour
  theme.js              Theme toggle (persisted in localStorage)
  icons.js              SLDS icon registry, data URI generation
  image-component.js    sf.Image upload UX and detection
  markdown.js           Inline markdown rendering (notes, labels, captions)
  share-codec.js        Versioned share-URL codec (compression + key dictionary)
  mermaid-import.js     Mermaid → diagramforce converter, hierarchical layout
  util.js               Shared zero-dependency helpers
  util/geometry.js      Pure bbox / clamp geometry primitives
assets/
  icons/                SLDS SVG sprite files (self-hosted)
  vendor/               JointJS, pako, gifenc (vendored same-origin)
dev/tests/                  Zero-build characterization tests (Node's native test runner)
DIAGRAM_JSON_SPEC.md    LLM-facing JSON specification
```

## LLM diagram generation

[`DIAGRAM_JSON_SPEC.md`](DIAGRAM_JSON_SPEC.md) documents the complete JSON structure for all diagram types - including a dedicated guide for generating Salesforce Data Cloud (Data 360) mappings with valid field types, categories, and DLO/DMO layers. Feed it to any LLM (e.g. Claude) and ask it to generate a diagram JSON for a specific architecture, data model, Data Cloud field mapping, process flow, etc. The output can be imported directly via *Load & Import → Paste* (or *Load & Import → File* for a `.json` or `.dgf`).

## Browser support

Tested in Chrome, Vivaldi, and Safari. Service worker requires a Service-Worker-capable browser (all modern desktop browsers).

## License

This work is licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

## Author

[Mateusz Dąbrowski](https://www.linkedin.com/in/mateusz-dabrowski-pl/)
[mateuszdabrowski.pl](https://mateuszdabrowski.pl)

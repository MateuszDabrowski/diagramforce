# Diagramforce

Browser-based visual diagramming tool for Salesforce architects and consultants. Create architecture diagrams, data models, process flows, org charts, and Gantt charts - all in your browser with no backend, no build step, and no data leaving your machine.

**[diagramforce.mateuszdabrowski.pl](https://diagramforce.mateuszdabrowski.pl)**

## Features

- **Architecture Diagrams** — Map system landscape, integrations, and Salesforce clouds with 1700+ SLDS icons
- **Data Model Diagrams** — Define objects, fields, and relationships with ER notation (crow's foot, one, zero-or-one, etc.)
- **Process Diagrams** — Design business processes with BPMN and flowchart shapes
- **Organisation Charts** — Document team hierarchy with person cards, departments, and teams
- **Gantt Charts** — Plan project timelines with tasks, milestones, phases, and dependencies
- **Dark / Light Theme** — Full theme support with Salesforce-aligned brand colours
- **Multi-tab** — Work on multiple diagrams simultaneously with independent undo/redo per tab
- **Smart Node Layout** — Content auto-centers: text-only, icon+text, or description layout
- **Resize Guides** — Tracking lines extend from resized edges for easy alignment
- **Export** — Save to browser, export as JSON or PNG, share via copyable URL
- **Fit to Content** — Automatically fits viewport when loading shared or saved diagrams
- **No Backend** — Everything runs client-side; your diagrams never leave your browser

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Undo | Cmd/Ctrl + Z |
| Redo | Cmd/Ctrl + Shift + Z |
| Copy | Cmd/Ctrl + C |
| Paste | Cmd/Ctrl + V |
| Duplicate | Cmd/Ctrl + D |
| Select All | Cmd/Ctrl + A |
| Delete | Delete / Backspace |
| Multi-select | Cmd/Ctrl + Click |
| Rubber-band select | Shift + Drag |
| Zoom in/out | Cmd/Ctrl + +/- or scroll |
| Fit to screen | Ctrl + 0 |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Diagramming | [JointJS v4](https://www.jointjs.com/) (open-source, via CDN) |
| UI Components | [Salesforce Lightning Design System v2.29](https://www.lightningdesignsystem.com/) (via CDN) |
| Icons | SLDS SVG sprites (self-hosted for same-origin `<use>`) |
| Code | Vanilla JavaScript with ES modules — no framework, no bundler |
| Styling | CSS custom properties with theme switching |

## Project Structure

```
index.html          Single-page entry point
css/                Modular stylesheets (variables, theme, layout, components)
js/
  app.js            Entry point — initialises all modules
  canvas.js         JointJS paper, pan/zoom, grid, auto-layout, SimpleNode layout
  shapes.js         Custom JointJS shape definitions
  templates.js      Pre-built Salesforce component templates
  stencil.js        Stencil panel with drag-to-canvas
  properties.js     Property inspector with ER marker picker
  selection.js      Multi-select, rubber-band, resize tracking lines, alignment
  tabs.js           Multi-diagram tab management
  toolbar.js        Toolbar event wiring
  persistence.js    Save/load, JSON/PNG export, URL sharing, versioning
  history.js        Undo/redo command stack
  clipboard.js      Copy/paste/duplicate
  keyboard.js       Keyboard shortcut manager
  theme.js          Theme toggle
  icons.js          SLDS icon registry
assets/
  icons/            SLDS SVG sprite files
```

## Browser Support

Tested in Chrome, Vivaldi, and Safari.

## License

This work is licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

## Author

[Mateusz Dąbrowski](https://www.linkedin.com/in/mateusz-dabrowski-pl/)
[mateuszdabrowski.pl](https://mateuszdabrowski.pl)

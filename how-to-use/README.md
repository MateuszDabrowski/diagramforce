# Using Diagramforce outside the app

Three ways to get a diagram *into* [Diagramforce](https://diagramforce.mateuszdabrowski.pl) from
somewhere else - all no-backend, no account, nothing leaves the browser. Pick by who is driving.

| You are... | Use | What it is |
|---|---|---|
| An LLM or a developer authoring diagram JSON by hand | [`DIAGRAM_JSON_SPEC.md`](../DIAGRAM_JSON_SPEC.md) | The complete JSON contract for all diagram types (architecture, data model, Data Cloud mapping, process, Salesforce Flow, org, gantt, sequence). Generate it, validate it, paste it into *Load & Import ▸ Paste*. |
| Working inside Claude (Cowork / Claude Code / claude.ai) | [`cowork-skill/diagramforce`](../cowork-skill/diagramforce/SKILL.md) | A Claude skill that authors a valid diagram from a description - or from a screenshot, draw.io, or Mermaid source - and hands you a file to open. |
| Building a web app that should open Diagramforce | [`web-integration.md`](web-integration.md) | An "Open in Diagramforce" button: `window.postMessage`, new tab, any diagram size. |

All three share the same foundation:

- **One JSON contract** - every path produces the envelope described in
  [`DIAGRAM_JSON_SPEC.md`](../DIAGRAM_JSON_SPEC.md) (kept at the repo root because the release tooling
  and the in-app spec link point at it there).
- **No backend** - delivery is paste / file import / `postMessage` into the static app. There is no
  Diagramforce server, account, or API key anywhere in the loop.
- **The same validator** - `dev/scripts/validate-diagram.mjs` (also bundled with the Cowork skill)
  checks a diagram against the app's real shape allowlist before you hand it over.

> Not what you want? To *edit* diagrams, or to save/share from inside the app, just open
> [Diagramforce](https://diagramforce.mateuszdabrowski.pl) directly - this folder is only about
> feeding diagrams in from other tools.

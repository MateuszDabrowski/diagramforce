# Open a diagram in Diagramforce from your own app

Diagramforce has **no backend**. It is a static site, so another website cannot "POST a diagram" to
it - there is no server to receive the request. But your app can still hand a diagram to Diagramforce
and have it **open in a new tab**, with **no backend on either side**, using the browser's built-in
`window.postMessage` channel.

This is the recommended path for a "**Open in Diagramforce**" button in a third-party app (for
example, a tool that generates a Salesforce Flow, data model, or architecture and wants to visualise
it in Diagramforce).

- **No backend, no build step, no Diagramforce account or API key.**
- **No URL size limit** - the payload travels through `postMessage`, not the URL, so even large
  data-mapping diagrams work (a URL/hash handoff caps out around 8000 characters; this does not).
- The diagram opens in a **new browser tab** and is treated exactly like a pasted/imported file:
  it is sanitised and rendered, and the user edits their own copy.

> **You produce the JSON; Diagramforce renders it.** The diagram must conform to
> [`DIAGRAM_JSON_SPEC.md`](../DIAGRAM_JSON_SPEC.md) - the same JSON you would paste into
> *Load & Import -> Paste*. Feed that spec to an LLM (e.g. Claude) to generate the JSON, or build it
> yourself. Validate it with `npm run validate -- your-diagram.json` before wiring the button.

---

## TL;DR

Drop this into your web app and call `openInDiagramforce(diagram)` from a button click:

```js
const DIAGRAMFORCE_ORIGIN = 'https://diagramforce.mateuszdabrowski.pl';

/**
 * Open a diagram in Diagramforce in a new tab.
 * @param {object|string} diagram - a Diagramforce diagram JSON (object or string),
 *   conforming to DIAGRAM_JSON_SPEC.md.
 * @returns {boolean} false if the browser blocked the pop-up.
 */
function openInDiagramforce(diagram) {
  const json = typeof diagram === 'string' ? diagram : JSON.stringify(diagram);

  // Open the tab in "live import" mode. Must run synchronously inside a user gesture (a click),
  // and WITHOUT `noopener` - we need the returned window handle to post the payload to it.
  const win = window.open(DIAGRAMFORCE_ORIGIN + '/#import=postmessage', '_blank');
  if (!win) return false;                       // pop-up blocked - tell the user to allow pop-ups

  // Diagramforce posts a "ready" ping once its listener is live; only then do we send the diagram.
  function onMessage(event) {
    if (event.origin !== DIAGRAMFORCE_ORIGIN) return;                 // only trust Diagramforce
    const d = event.data;
    if (!d || d.source !== 'diagramforce' || d.type !== 'ready') return;
    win.postMessage({ source: 'diagramforce', type: 'import', v: 1, json }, DIAGRAMFORCE_ORIGIN);
    window.removeEventListener('message', onMessage);
  }
  window.addEventListener('message', onMessage);
  return true;
}
```

```html
<button type="button"
  onclick="openInDiagramforce(myDiagram) || alert('Please allow pop-ups for this site to open Diagramforce.')">
  Open in Diagramforce
</button>
```

That is the whole integration. Nothing needs to be installed or configured on the Diagramforce side.

---

## How it works

```
Your app                                  Diagramforce (new tab)
────────                                  ──────────────────────
click "Open in Diagramforce"
window.open(.../#import=postmessage) ───▶ boots, sees #import=postmessage
addEventListener('message', …)            registers a message listener
                                    ◀───── postMessage({type:'ready'})  to window.opener
postMessage({type:'import', json}) ─────▶ validates, sanitises, opens the diagram as a tab
```

1. **Your button opens Diagramforce** at `…/#import=postmessage` in a new tab. That hash tells
   Diagramforce to wait for a diagram instead of showing its normal "New diagram" screen.
2. **Diagramforce announces it is ready** by posting `{ source:'diagramforce', type:'ready' }` back to
   the window that opened it (`window.opener`). This handshake avoids a race - your app knows exactly
   when Diagramforce is listening.
3. **Your app sends the diagram** as `{ source:'diagramforce', type:'import', json:'<diagram JSON string>' }`.
4. **Diagramforce imports it** through the same pipeline as *Load & Import* (version check ->
   sanitise -> open as a new tab).

If no diagram arrives within ~12 seconds (for example, the tab was opened directly), Diagramforce
falls back to its normal new-diagram screen.

---

## Step by step

### 1. Produce the diagram JSON

Build a diagram object conforming to [`DIAGRAM_JSON_SPEC.md`](../DIAGRAM_JSON_SPEC.md). The minimum shape:

```json
{
  "version": 1,
  "appVersion": "1.20.1",
  "title": "My Flow",
  "diagramType": "flow",
  "graph": { "cells": [ /* elements and links, with x/y positions */ ] }
}
```

- `diagramType` must match the shapes you use (`architecture`, `process`, `flow`, `datamodel`,
  `datamapping`, `org`, `gantt`, `sequence`).
- **You place the nodes** - the spec is not auto-layout; every element carries its own position.
- Set `appVersion` to the current Diagramforce version to avoid a compatibility notice.
- **Validate before shipping the button:** `npm run validate -- your-diagram.json` catches the errors
  the loader silently drops (unknown shape types, links to missing cells, wrong `diagramType`).

### 2. Add the button

Copy the `openInDiagramforce` function and button from the [TL;DR](#tldr) above into your app. Pass it
the diagram object (or a JSON string).

### 3. There is no step 3

The Diagramforce side is built in. Your users click the button, a new tab opens, and their diagram
renders.

---

## Message protocol reference

All messages are plain objects with a `source: 'diagramforce'` discriminator (so they never collide
with other libraries that use `postMessage`, such as Google sign-in).

| Direction | Message | Meaning |
|---|---|---|
| Diagramforce -> your app | `{ source:'diagramforce', type:'ready', v:1 }` | Diagramforce is listening; send the diagram now |
| Your app -> Diagramforce | `{ source:'diagramforce', type:'import', v:1, json:'<string>' }` | The diagram JSON to open (as a **string**) |

- Send `json` as a **string** (`JSON.stringify(diagram)`), not a live object.
- Always pass Diagramforce's origin as the `targetOrigin` when you `postMessage` (the snippet does),
  so the payload is only delivered to Diagramforce.

---

## Important notes

- **Do not use `noopener`.** `window.open(url, '_blank', 'noopener')` returns `null`, so you lose the
  window handle and cannot send the diagram. The trade-off: without `noopener`, the opened tab holds a
  reference to your page (`window.opener`). This is safe when opening a trusted app like Diagramforce,
  but be aware of it.
- **Call it inside a click.** Browsers block `window.open` that is not triggered by a user gesture.
  Keep the call in the button's `onclick` (or a click event handler) - do not defer it behind an
  `await`/`setTimeout` before opening the window.
- **Pop-up blockers.** If `window.open` returns `null`, the pop-up was blocked; prompt the user to
  allow pop-ups for your site. (The TL;DR button does this.)
- **Size.** `postMessage` itself has no practical size limit, but Diagramforce caps an imported diagram
  at **2000 cells** and rejects payloads over 8 MB. Anything within a normal diagram is fine.
- **Security model (community-open).** Diagramforce accepts an import from **any** site - there is no
  allowlist to get added to, so no coordination with the Diagramforce maintainer is needed. This is
  safe because only the window that opened the tab can message it, and every imported diagram is
  sanitised (cell cap, and stripping of event handlers, script URIs, and prototype-pollution keys) -
  the same treatment a pasted file or a shared-link diagram gets. Diagramforce never sends any of your
  or the user's data back; its only outbound message is the contentless "ready" ping.

---

## Testing locally

1. Serve your app over `http://` (not `file://`) so `postMessage` origins work.
2. Point `DIAGRAMFORCE_ORIGIN` at your local Diagramforce if you are running it locally
   (e.g. `http://localhost:3456`), then open `…/#import=postmessage`.
3. Click your button and confirm the diagram opens in the new tab.

---

## Alternatives

The `postMessage` button above is the best fit for "one button, opens a new tab". Two other no-backend
paths exist, with different trade-offs:

| Method | Best for | Limit |
|---|---|---|
| **`postMessage` button** (this guide) | One button -> new tab, any diagram size | Link is not shareable/bookmarkable |
| **Share link** (`#diagram=…`) | A copyable/bookmarkable link | ~8000-char practical limit; large diagrams do not fit |
| **Google Drive link** (`#gd=<fileId>`) | Shareable link to any size | Requires the diagram to live in Google Drive |

For a shareable link, open the diagram in Diagramforce and use **Share** - it copies either a
self-contained Diagramforce link or, when Drive is connected, a short always-up-to-date Google Drive
link. There is no supported way to generate those links from outside the app: the share URL uses an
internal versioned codec, so a link built by a third party would break the next time that codec changes.
Use the `postMessage` button above instead, and let the user share from inside Diagramforce.

---

Questions or issues: [github.com/MateuszDabrowski/diagramforce](https://github.com/MateuszDabrowski/diagramforce)

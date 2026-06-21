// Diagramforce file format — the `.dgf` extension + MIME constants (single source
// of truth). The file CONTENT is the same JSON envelope the app has always used
// (see DIAGRAM_JSON_SPEC.md); `.dgf` is purely the filename suffix + the type
// Google Drive's "Open with Diagramforce" binds to. Plain `.json` is still read
// everywhere — import detects format from the JSON structure, not the extension.
//
// Leaf module: ZERO imports, pure constants, so remote-store.js, json-pipeline.js
// and the Picker can all share it without a dependency cycle (like util.js).

/** Canonical Diagramforce file extension. */
export const DGF_EXT = '.dgf';

/** Custom vendor MIME for `.dgf`. Defined for forward-compat + listed in the
 *  Picker so a future custom-MIME write stays openable; Phase 1 still WRITES the
 *  file content as `application/json` to keep the validated anonymous public-read
 *  path (fetchPublicGraph) byte-for-byte unchanged. */
export const DGF_MIME = 'application/vnd.diagramforce+json';

/** Diagram-file extensions stripped to derive a fallback diagram name on import. */
export const KNOWN_EXT_RE = /\.(dgf|json)$/i;

/** MIME list the Google Picker filters on: the custom `DGF_MIME` + `application/json` (so diagrams show
 *  whether or not Drive preserved the custom vendor MIME) + the FOLDER mime so folders appear and are
 *  navigable (without it the Picker is flat — you can't browse into folders). CAVEAT: Drive types both
 *  `.json` and Jupyter `.ipynb` as `application/json`, so notebooks can leak into the list; the Picker has
 *  no exclude filter and dropping `application/json` would also hide legacy `.json` diagrams, so we keep it. */
export const PICKER_MIMES = [DGF_MIME, 'application/json', 'application/vnd.google-apps.folder'].join(',');

/** Drive filename for a newly-created diagram file: `<name>.dgf` (name clamped). */
export function driveFileName(name) {
  return `${String(name || 'Diagram').slice(0, 120)}${DGF_EXT}`;
}

/** Drive `files.list` query for the user's own Diagramforce diagrams: the `.dgf` files this app created,
 *  matched by the custom MIME OR a `.dgf` name. NOT folder-scoped on purpose — files can land in My Drive
 *  root, the `Diagramforce` folder, or (legacy) a Shared Drive, and Drive doesn't always preserve a custom
 *  vendor MIME, so a folder+exact-MIME query missed them (the "library shows nothing" bug). Under
 *  `drive.file`, files.list only ever returns app-created/opened files, so this stays scoped to the user.
 *  Pure (unit-tested); the caller URL-encodes it. */
export function myDiagramsQuery() {
  return `(mimeType = '${DGF_MIME}' or name contains '.dgf') and trashed = false`;
}

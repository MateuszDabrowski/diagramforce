// Compact share-URL codec (v1).
//
// Transforms the share data through three layers before base64-url encoding:
//   1. Structural JSON keys are renamed to single-char codes (MIN map).
//   2. The result is fed to pako.deflateRaw with a frozen preset dictionary
//      (DICT_V1) so common substrings — type names, attr boilerplate, port
//      group skeletons — compress to short back-references on the very first
//      occurrence.
//   3. The compressed bytes go through standard url-safe base64.
//
// Output format: `v1.<base64url>`. The version prefix lets us ship a v2
// dictionary later without breaking links generated against v1; persistence.js
// keeps the legacy decoder around for URLs created before this codec landed.
//
// Anything in DICT_V1 or MIN is FROZEN — never edit, only ship a parallel v2.

// pako is loaded as a global script in index.html.

// Long-key → short-key map. Short codes MUST NOT collide with any single-char
// key JointJS itself emits (`d`, `r`, `x`, `y`, `z` — confirmed by walking a
// representative graph) or any single-char field at the top level (`v` for
// schema version), or the round-trip becomes ambiguous on decode.
const MIN = Object.freeze({
  // Top-level / per-cell core
  cells: 'C', graph: 'G', type: 't', position: 'p', size: 's', attrs: 'a',
  ports: 'P', parent: '!', embeds: 'E',
  id: '[', angle: ']',
  // Geometry
  width: 'w', height: 'h',
  // Link
  source: 'u', target: 'D', vertices: 'V', labels: 'L',
  router: '$', connector: 'c',
  // Ports
  groups: 'g', items: 'I', args: 'A',
  group: '=', name: '>',
  // Markup
  markup: 'm', selector: 'S', tagName: 'N',
  circle: '(', magnet: ')',
  // Attr selectors (from sf.* shape definitions)
  body: 'B', label: 'l', subtitle: 'b', headerLabel: 'H',
  accent: 'k', icon: 'O', line: 'n',
  // Common attr fields
  fill: 'f', stroke: 'R', strokeWidth: 'W',
  fontSize: 'F', fontWeight: '*', fontFamily: '%',
  textAnchor: 'X', textVerticalAnchor: 'Y',
  opacity: 'o', text: 'T',
  ref: '_', refX: 'q', refY: 'Q',
  refWidth: '~', refHeight: '|',
  rx: '.', ry: ',',
  // df-specific user-visible properties
  iconId: 'j', iconColor: 'J',
  userTextColor: 'U', customColors: 'K',
  lineStyle: '?',
  showLabels: '+', showFieldLengths: '@', keyFieldsOnly: '#',
  showAssignee: ':', showProgress: ';', showBottomLabel: '<',
  fields: '/', description: '&', color: 'M',
});

const EXPAND = Object.freeze(Object.fromEntries(
  Object.entries(MIN).map(([k, v]) => [v, k])
));

function remapKeys(value, table) {
  if (Array.isArray(value)) return value.map(v => remapKeys(v, table));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      out[table[k] ?? k] = remapKeys(value[k], table);
    }
    return out;
  }
  return value;
}

// Preset dictionary for pako. zlib's LZ77 prefers recent matches, so place
// the highest-frequency strings near the END. Strings are post-minify form
// (using MIN's short codes); editing this for v1 is forbidden — ship a v2
// dictionary alongside.
const DICT_V1_TEXT =
  // Less-common type strings — loaded early so frequent ones can preempt them
  '"$":{">":"normal"}"c":{">":"normal"}"L":[]"V":[]"E":[]' +
  '"t":"sf.GanttTimeline""t":"sf.GanttGroup""t":"sf.GanttMilestone""t":"sf.GanttTask"' +
  '"t":"sf.SequenceFragment""t":"sf.SequenceActivation""t":"sf.SequenceActor""t":"sf.SequenceParticipant"' +
  '"t":"sf.BpmnPool""t":"sf.BpmnSubprocess""t":"sf.BpmnGateway""t":"sf.BpmnTask""t":"sf.BpmnEvent"' +
  '"t":"sf.FlowProcess""t":"sf.FlowDecision""t":"sf.FlowDocument""t":"sf.FlowEnd"' +
  // Mid-frequency attr value patterns
  '"X":"middle""Y":"middle""*":600"%":"system-ui, -apple-system, sans-serif"' +
  '"f":"transparent""R":"none""W":1"W":2"o":1"o":0' +
  '"_":"text""q":-6"Q":-2"~":12"|":4' +
  // Common shape types (higher frequency)
  '"t":"sf.OrgPerson""t":"sf.DataObject""t":"sf.Note""t":"sf.TextLabel""t":"sf.Zone""t":"sf.Container""t":"sf.SimpleNode"' +
  // Common cell shell
  '"p":{"x":0,"y":0},"s":{"w":120,"h":60},"z":2000,' +
  // Port markup (every cell with ports has 4x of these)
  '"m":[{"N":"circle","S":"circle"}]' +
  // Per-port-group attrs (every cell with ports has 4x of these)
  '"a":{"(":{"r":5,")":true,"f":"var(--port-color, #1D73C9)","R":"#FFFFFF","W":1.5}}' +
  // Port-group items
  '"I":[{"[":"port-top","=":"top"},{"[":"port-right","=":"right"},{"[":"port-bottom","=":"bottom"},{"[":"port-left","=":"left"}]' +
  // Full port-group block (the highest-yield string in any node JSON)
  '"P":{"g":{"top":{"p":{">":"top"},"a":{"(":{"r":5,")":true,"f":"var(--port-color, #1D73C9)","R":"#FFFFFF","W":1.5}},"m":[{"N":"circle","S":"circle"}]},' +
  '"right":{"p":{">":"right"},"a":{"(":{"r":5,")":true,"f":"var(--port-color, #1D73C9)","R":"#FFFFFF","W":1.5}},"m":[{"N":"circle","S":"circle"}]},' +
  '"bottom":{"p":{">":"bottom"},"a":{"(":{"r":5,")":true,"f":"var(--port-color, #1D73C9)","R":"#FFFFFF","W":1.5}},"m":[{"N":"circle","S":"circle"}]},' +
  '"left":{"p":{">":"left"},"a":{"(":{"r":5,")":true,"f":"var(--port-color, #1D73C9)","R":"#FFFFFF","W":1.5}},"m":[{"N":"circle","S":"circle"}]}}}' +
  // Link source/target wrappers
  '"u":{"[":"' + '"},"D":{"[":"' + '"},"';

const DICT_V1 = new TextEncoder().encode(DICT_V1_TEXT);

// ── Slim transform (v1.15.0+) ───────────────────────────────────────
// Strip data the SHARE LOAD path deterministically reconstructs, so it never
// rides in the URL. Reconstruction (all already run on import — see
// share-orchestration loadFromURL → tabs import → fromJSON + migrateLinks +
// migrateNodes):
//   • Default `ports` / `size` / `angle` → JointJS rebuilds from the shape
//     definition when the key is absent (verified: an omitted default `ports`
//     block — ~88% of a node's JSON — round-trips exactly).
//   • Mapping-link routing (`router` / `connector` / endpoint `connectionPoint`)
//     → migrateLinks re-applies it from `linkKind` + `mappingType`.
//   • Icon artwork (`icon.href` / `headerIcon.href`) → refreshAllIconHrefs
//     re-resolves the full SVG from the embedded `data-icon-id`; we keep only the
//     compact placeholder.
// Pure: deep-clones its input, never mutates the live graph JSON. Idempotent.
const ICON_ID_RE = /data-icon-id(?:%3D|=)(?:%22|")([^%"]+)(?:%22|")/;
function slimIconHref(href) {
  if (typeof href !== 'string' || !href) return href;
  const m = href.match(ICON_ID_RE);
  if (!m) return href;                       // not a registry icon — leave untouched
  return 'data:image/svg+xml,<svg data-icon-id="' + m[1] + '"/>';
}
function shapeDefaults(type) {
  if (typeof type !== 'string' || !type.startsWith('sf.')) return null;
  const Ctor = (typeof joint !== 'undefined' && joint.shapes && joint.shapes.sf || {})[type.slice(3)];
  return Ctor && Ctor.prototype && Ctor.prototype.defaults || null;
}
const _eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function slimForShare(graphJSON) {
  const out = JSON.parse(JSON.stringify(graphJSON || {}));
  for (const cell of out.cells || []) {
    if (cell.attrs) {
      if (cell.attrs.icon && cell.attrs.icon.href) cell.attrs.icon.href = slimIconHref(cell.attrs.icon.href);
      if (cell.attrs.headerIcon && cell.attrs.headerIcon.href) cell.attrs.headerIcon.href = slimIconHref(cell.attrs.headerIcon.href);
    }
    if (cell.linkKind === 'mapping') {
      delete cell.router; delete cell.connector;
      if (cell.source) delete cell.source.connectionPoint;
      if (cell.target) delete cell.target.connectionPoint;
    }
    const def = shapeDefaults(cell.type);
    if (def) {
      if (def.ports && cell.ports && _eq(cell.ports, def.ports)) delete cell.ports;
      if (def.size && cell.size && _eq(cell.size, def.size)) delete cell.size;
    }
    if (cell.angle === 0) delete cell.angle;
  }
  return out;
}

function bytesToUrlSafe(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function urlSafeToBytes(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Encode a share-data object to `v1.<base64url>`. */
export function encodeShareV1(data) {
  const minified = remapKeys(data, MIN);
  const json = JSON.stringify(minified);
  const compressed = pako.deflateRaw(json, { dictionary: DICT_V1, level: 9 });
  return 'v1.' + bytesToUrlSafe(compressed);
}

/** Decode a `v1.<base64url>` payload back to the share-data object. */
export function decodeShareV1(payload) {
  if (!payload.startsWith('v1.')) throw new Error('Not a v1 share payload');
  const bytes = urlSafeToBytes(payload.slice(3));
  const json = pako.inflateRaw(bytes, { dictionary: DICT_V1, to: 'string' });
  // Decompression-bomb guard: a legitimate share is far under this ceiling.
  if (json.length > 8 * 1024 * 1024) throw new Error('Share payload too large');
  return remapKeys(JSON.parse(json), EXPAND);
}

// ── v2 codec ─────────────────────────────────────────────────────────
// Extends v1: minifies the field-array keys (apiName/keyType/fid/required/length/
// deprecated — the dominant content of a Data Model / Mapping share) plus the post-v1
// shape & Data-Cloud props, and re-tunes the dictionary for SLIMMED shares — since
// slimForShare drops the port boilerplate that dominated DICT_V1, DICT_V2 spends its
// budget on field-row, type and icon-placeholder patterns instead.
//
// MIN_V2 / DICT_V2 are FROZEN — never edit, only ship a parallel v3. decodeShareV1 +
// the legacy raw-deflate path stay alive (loadFromURL) for links made before v2.
// Short codes for new keys are chosen from chars NEITHER MIN nor JointJS emit
// (e i Z ^ ` - ' are free single-chars; the rest use distinct 2-char codes that
// never appear as real keys, so the round-trip stays unambiguous).
const MIN_V2 = Object.freeze({
  ...MIN,
  // Field-array keys (per-field; high frequency in Data Model / Mapping diagrams)
  apiName: 'e', keyType: 'i', fid: 'Z', required: '^', length: '`', deprecated: '-',
  // Object / link / shape props introduced after v1
  category: "'",
  mappingType: 'mt', expressionRule: 'xr', linkKind: 'lk', layerStage: 'ls',
  objectName: 'on', headerColor: 'hc', headerIcon: 'hi', connectionFrequency: 'cf',
  taskName: 'tn', taskDescription: 'td', descriptionWidth: 'dw',
  personName: 'pn', jobTitle: 'jt', tags: 'tg', raci: 'rc', vacant: 'vc',
  taskLabel: 'tl', progress: 'pg', barColor: 'bc', assignee: 'as',
});
const EXPAND_V2 = Object.freeze(Object.fromEntries(
  Object.entries(MIN_V2).map(([k, v]) => [v, k])
));

// Post-MIN_V2 form, highest-frequency last. Editing forbidden once shipped (v3 instead).
const DICT_V2_TEXT =
  // Type strings (all shapes, incl. v1.15.0 additions) — least-frequent first
  '"t":"sf.GanttMarker""t":"sf.GanttTimeline""t":"sf.GanttGroup""t":"sf.GanttMilestone""t":"sf.GanttTask"' +
  '"t":"sf.SequenceFragment""t":"sf.SequenceActivation""t":"sf.SequenceActor""t":"sf.SequenceParticipant"' +
  '"t":"sf.BpmnPool""t":"sf.BpmnSubprocess""t":"sf.BpmnGateway""t":"sf.BpmnTask""t":"sf.BpmnEvent"' +
  '"t":"sf.TaskGroup""t":"sf.Task""t":"sf.OrgPerson""t":"sf.Note""t":"sf.TextLabel""t":"sf.Zone""t":"sf.Container""t":"sf.SimpleNode""t":"sf.DataObject"' +
  // Data-Cloud value patterns (mapping links + layer zones)
  '"lk":"mapping""mt":"Standard""mt":"Formula""ls":"source""ls":"dlo""ls":"dmo""ls":"activation"' +
  // Field-row patterns — the dominant content of a slimmed Data Model share
  '"t":"Text""t":"Number""t":"Date""t":"Boolean""t":"Id""^":false,"-":false}"i":"pk""i":"fk""i":"fqk"' +
  // Icon placeholder wrapper (Q2 — every stripped icon shares this exact prefix)
  'data:image/svg+xml,<svg data-icon-id="' +
  // Link source/target wrappers
  '"u":{"[":"' + '"},"D":{"[":"' + '"},"';
const DICT_V2 = new TextEncoder().encode(DICT_V2_TEXT);

/** Encode a share-data object to `v2.<base64url>`. */
export function encodeShareV2(data) {
  const minified = remapKeys(data, MIN_V2);
  const json = JSON.stringify(minified);
  const compressed = pako.deflateRaw(json, { dictionary: DICT_V2, level: 9 });
  return 'v2.' + bytesToUrlSafe(compressed);
}

/** Decode a `v2.<base64url>` payload back to the share-data object. */
export function decodeShareV2(payload) {
  if (!payload.startsWith('v2.')) throw new Error('Not a v2 share payload');
  const bytes = urlSafeToBytes(payload.slice(3));
  const json = pako.inflateRaw(bytes, { dictionary: DICT_V2, to: 'string' });
  if (json.length > 8 * 1024 * 1024) throw new Error('Share payload too large');
  return remapKeys(JSON.parse(json), EXPAND_V2);
}

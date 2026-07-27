#!/usr/bin/env node
// make-share-url.mjs — turn an authored Diagramforce diagram into a ONE-CLICK https://diagramforce.com/#diagram=
// link, so the user opens the diagram by clicking rather than by downloading a file and running Load > Import.
//
//   node scripts/make-share-url.mjs my-diagram.json
//   node scripts/make-share-url.mjs my-diagram.json --origin https://diagramforce.com
//
// Zero dependencies. The app encodes with `pako.deflateRaw`; Node's built-in `zlib.deflateRawSync` accepts the
// same `dictionary` option, so no package is needed. The two compressors may emit DIFFERENT BYTES for the same
// input - deflate output is not stable across implementations - and that is fine: the app only ever INFLATES,
// and both streams inflate to the identical JSON. dev/tests/e2e/share-url-replica.spec.js proves exactly that by
// feeding this script's output through the SHIPPED decoder in a real browser.
//
// ── The one rule that matters ────────────────────────────────────────────────────────────────────────────────
// MIN, MIN_V2 and DICT_V2_TEXT below are VERBATIM COPIES of js/share-codec.js and are FROZEN. A single changed
// character produces links the app cannot decode. Never hand-edit them; dev/tests/share-codec-replica.test.js
// source-parses both files and fails if they differ by so much as whitespace. When the app ships a codec v3,
// this script gains a v3 branch and KEEPS the v2 one - every link ever emitted must stay decodable.
//
// ── Size ceiling ─────────────────────────────────────────────────────────────────────────────────────────────
// Browsers and chat clients start truncating links past roughly 8000 characters. Measured: a converted 20-element
// Salesforce Flow lands near 3300, comfortably inside; the big Data Cloud field-mapping diagrams reach 12-16k and
// do NOT fit. The script REFUSES to emit an over-length link rather than handing over one that silently breaks -
// exit code 2, with the advice to deliver the .json file instead.
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

// ── FROZEN, verbatim from js/share-codec.js ──────────────────────────────────────────────────────────────────
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
const DICT_V2 = Buffer.from(DICT_V2_TEXT, 'utf8');
// ── end frozen block ─────────────────────────────────────────────────────────────────────────────────────────

/** Rename long JSON keys to their single-char codes. Same walker as the app's. */
function remapKeys(value, table) {
  if (Array.isArray(value)) return value.map((v) => remapKeys(v, table));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[table[k] ?? k] = remapKeys(value[k], table);
    return out;
  }
  return value;
}

const bytesToUrlSafe = (bytes) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Encode a SHARE-DATA object to `v2.<base64url>` — the app's encodeShareV2, in Node. */
export function encodeShareV2(data) {
  const json = JSON.stringify(remapKeys(data, MIN_V2));
  return 'v2.' + bytesToUrlSafe(deflateRawSync(Buffer.from(json, 'utf8'), { dictionary: DICT_V2, level: 9 }));
}

/** The FILE envelope the skill authors is NOT the SHARE envelope the codec takes. buildShareURL() in
 *  js/persistence/share-orchestration.js builds `{ v, av, name, type, mappingMode, graph }` - different key
 *  names from the file's `{ version, appVersion, title, diagramType, graph }`, and getting this wrong yields a
 *  link that decodes to an empty diagram rather than an error. Exported so the test can assert the mapping. */
export function fileToShareData(file) {
  return {
    v: 1,
    av: file.appVersion || '',
    name: file.title || 'Diagram',
    type: file.diagramType || 'architecture',
    mappingMode: !!file.mappingMode,
    // No slimForShare pass: that strips load-reconstructable data (default ports, baked icon artwork) which
    // authored JSON does not carry in the first place. Skipping it costs a few percent of payload, never
    // correctness - the app rebuilds those on load either way.
    graph: file.graph || { cells: [] },
  };
}

const MAX_URL = 8000;   // past this, browsers and chat clients start truncating

export function makeShareUrl(file, origin = 'https://diagramforce.com/') {
  const url = `${origin.replace(/\/*$/, '/')}#diagram=${encodeShareV2(fileToShareData(file))}`;
  return { url, length: url.length, fits: url.length <= MAX_URL };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const oi = args.indexOf('--origin');
  const origin = oi > -1 ? args[oi + 1] : 'https://diagramforce.com/';
  if (!file) {
    console.error('Usage: node scripts/make-share-url.mjs <diagram.json> [--origin https://diagramforce.com]');
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Could not read ${file}: ${err.message}`);
    process.exit(1);
  }
  if (parsed.schema === 'diagramforce-export' || parsed.schema === 'diagramforce-templates') {
    console.error('That is a multi-diagram bundle. A share link carries ONE diagram - export a single one first.');
    process.exit(1);
  }
  const { url, length, fits } = makeShareUrl(parsed, origin);
  if (!fits) {
    console.error(`Too large for a link: ${length} chars (ceiling ${MAX_URL}).`);
    console.error('Hand the user the .json file instead and tell them to open it via Load > Import.');
    process.exit(2);
  }
  console.log(url);
  console.error(`✓ ${length} chars (ceiling ${MAX_URL})`);
}

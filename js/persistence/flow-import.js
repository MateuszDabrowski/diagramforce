// Salesforce Flow import (1.21.0) — drop a real flow into Diagramforce and get the diagram.
//
// Two source formats, because the two ways people actually HAVE a flow are different:
//   • Tooling API JSON  — `GET /services/data/vXX.0/tooling/sobjects/Flow/301...`, the whole response
//     envelope or just its `Metadata` object. This is what the Cowork skill takes.
//   • `.flow-meta.xml`  — the SFDX source format, i.e. the file sitting in force-app/main/default/flows
//     of anyone who has ever pulled the org. Parsed with the browser's OWN DOMParser: no dependency, no
//     build step, nothing leaves the machine. (Node has no DOMParser, which is why the skill's CLI takes
//     JSON only — the shared converter is identical either way.)
//
// The conversion itself is flow-convert.js, shared verbatim with the skill, so a flow imported here and
// the same flow converted by the skill produce byte-identical diagrams.
// Every import MUST carry the ?v= cache key. Two things break without it, and neither is visible in dev:
// the service worker precaches the ?v= URL, so a bare specifier misses the cache and breaks offline boot;
// and a bare './context.js' is a DIFFERENT module URL from './context.js?v=…', which instantiates a SECOND
// pctx singleton whose appVersion is never set - stamping every imported flow appVersion "1".
import { convertFlowMetadata } from './flow-convert.js?v=1.22.1';
import { computeFlowLayout } from '../canvas/flow-layout.js?v=1.22.1';
import { pctx } from './context.js?v=1.22.1';
import { parseScalar, foldChild } from './flow-xml.js?v=1.22.1';

// The SCHEMA rules (which keys are lists, how a leaf scalar is typed, how a child folds into its parent) live
// in flow-xml.js, shared byte-identically with the skill - so the browser's DOMParser path below and the
// skill's standalone Node scanner can never disagree about the shape they produce. Only the TOKENISER differs.

/** One XML element -> a plain object shaped like the Tooling API's JSON for the same flow. */
function xmlToObject(node) {
  const children = [...node.children];
  if (!children.length) return parseScalar(node.textContent || '');
  const out = {};
  for (const child of children) foldChild(out, child.localName, xmlToObject(child));
  return out;
}

/**
 * Parse a `.flow-meta.xml` source file into the Metadata shape the converter expects.
 * @throws {Error} with a human-readable reason when the file is not a Flow.
 */
export function parseFlowXml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('That file is not valid XML.');
  const root = doc.documentElement;
  if (!root || root.localName !== 'Flow') {
    throw new Error(`That XML is a <${root?.localName || 'nothing'}>, not a <Flow>. Export the flow's .flow-meta.xml.`);
  }
  const md = xmlToObject(root);
  // The source format has no MasterLabel; the converter falls back to `label`, which the XML does carry.
  return { Metadata: md };
}

/** True when the text looks like a Flow source file rather than a diagram or Mermaid. */
export function looksLikeFlowXml(text) {
  return /^\s*(<\?xml[^>]*\?>\s*)?<Flow[\s>]/.test(text);
}

// Workbench's REST Explorer shows the WHOLE HTTP exchange - "Raw Response", the status line, and a dozen
// response headers - above the JSON body, and people copy the lot. Rather than making them hand-trim it,
// drop a leading HTTP preamble: everything before the first `{` that actually parses as a Flow.
//
// Deliberately conservative. It only engages when the text does NOT already start with `{`, AND the preamble
// looks like an HTTP exchange (a status line or header-ish `Name: value` lines) - so a stray brace inside
// prose can't trick it, and a Diagramforce document (which starts with `{`) never reaches this path at all.
const HTTP_PREAMBLE = /(^|\n)\s*(HTTP\/[\d.]+\s+\d{3}|Raw Response|[A-Za-z][A-Za-z0-9-]*:\s)/;
export function stripHttpPreamble(text) {
  const t = String(text);
  if (/^\s*[{[]/.test(t)) return t;                 // already clean JSON
  const brace = t.indexOf('{');
  if (brace <= 0) return t;
  if (!HTTP_PREAMBLE.test(t.slice(0, brace))) return t;
  return t.slice(brace);
}

/** True when the text is a Tooling API Flow response (or a bare Flow `Metadata` object). */
export function looksLikeFlowJson(text) {
  const body = stripHttpPreamble(text);
  if (!/^\s*\{/.test(body)) return false;
  try { return isFlowMetadata(JSON.parse(body)); } catch { return false; }
}

/** Shape test shared by both detectors — a Flow envelope, or the Metadata object itself. */
export function isFlowMetadata(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const md = obj.Metadata || obj;
  if (!md || typeof md !== 'object') return false;
  // A Diagramforce diagram must never match: it has `graph.cells` and a `diagramType`.
  if (md.graph || md.diagramType) return false;
  // A flow is identified by its `start` / `startElementReference` plus at least one element collection —
  // `processType` alone is too weak (it appears in unrelated metadata too).
  const hasEntry = md.start != null || md.startElementReference != null;
  const hasElements = ['screens', 'decisions', 'actionCalls', 'assignments', 'recordLookups', 'recordCreates',
    'recordUpdates', 'recordDeletes', 'loops', 'subflows', 'waits', 'orchestratedStages']
    .some((k) => Array.isArray(md[k]) && md[k].length);
  return Boolean(hasEntry && (hasElements || md.processType));
}

/**
 * Convert a pasted/dropped Flow source (either format) into a Diagramforce diagram.
 * @param {string} text - file contents.
 * @returns {{diagram: object, stats: object}}
 * @throws {Error} when the text is neither format, or the XML is not a Flow.
 */
/** `opts.fileName` is the dropped file's base name. It matters because SFDX SOURCE FORMAT keeps a flow's API
 *  name ONLY in the file name - `Gather_Scent_Preferences_Campaign_Flow.flow-meta.xml` - and never inside the
 *  document, so without it an XML-imported flow has no API name at all. A Tooling response carries `FullName`
 *  and wins; this is the fallback for the file path. */
export function importFlowSource(text, opts = {}) {
  let input;
  if (looksLikeFlowXml(text)) input = parseFlowXml(text);
  else {
    let parsed;
    const body = stripHttpPreamble(text);
    try { parsed = JSON.parse(body); } catch { throw new Error('That is neither Flow metadata JSON nor a .flow-meta.xml file.'); }
    if (!isFlowMetadata(parsed)) throw new Error('That JSON is not a Salesforce Flow (no start element or element collections found).');
    input = parsed;
  }
  // pctx.appVersion is set at persistence module-eval, so it is always populated by the time a user
  // can reach an import control.
  return convertFlowMetadata(input, { fullName: opts.fileName || null, computeFlowLayout, appVersion: pctx.appVersion });
}

// Flow `.flow-meta.xml` -> the Tooling-API-shaped object the converter expects.
//
// Shared VERBATIM with cowork-skill/diagramforce/scripts/flow-xml.js (a test enforces byte-identity), for the
// same reason flow-convert.js is: the app and the skill must produce byte-identical diagrams from the same
// file, and the thing most likely to drift between them is not the conversion but the SCHEMA KNOWLEDGE below.
//
// ── Why there are two tokenisers and only one set of rules ───────────────────────────────────────────────────
// The browser has DOMParser: battle-tested, and it reports malformed XML properly (`<parsererror>`), which a
// hand-rolled scanner would have to reinvent badly. Node has no DOMParser at all, which is why the skill's CLI
// took JSON only - so `sf project retrieve start -m "Flow:*"`, the command every other org import in this
// release uses, produced files its own flow converter could not read.
//
// So: `parseFlowXmlText` below is a standalone scanner for Node, and flow-import.js keeps DOMParser for the
// browser - but BOTH fold their tree with the same `XML_ARRAY_KEYS`, `parseScalar` and `foldChild` exported
// here. Tokenising is an environment detail; the schema is the part that must never disagree.

// Metadata keys whose value is a LIST even when the XML carries exactly one of them. XML has no way to say
// "array of one" - <screens> appearing once is indistinguishable from a scalar - so the shape has to come from
// knowing the schema. Get this wrong and a single-screen flow converts to a screens OBJECT the converter skips.
export const XML_ARRAY_KEYS = new Set([
  // element collections
  'screens', 'decisions', 'assignments', 'loops', 'subflows', 'transforms', 'waits', 'actionCalls',
  'recordLookups', 'recordCreates', 'recordUpdates', 'recordDeletes', 'recordRollbacks',
  'orchestratedStages', 'collectionProcessors', 'experiments', 'customErrors', 'apexPluginCalls', 'steps',
  // resources (not drawn, but must not collapse into scalars either)
  'variables', 'constants', 'formulas', 'textTemplates', 'choices', 'dynamicChoiceSets', 'stages',
  // repeated children the converter reads
  'rules', 'conditions', 'filters', 'fields', 'waitEvents', 'stageSteps', 'experimentPaths',
  'scheduledPaths', 'inputParameters', 'outputParameters', 'assignmentItems', 'inputAssignments',
  'outputAssignments',
  'customErrorMessages', 'connectors', 'processMetadataValues', 'assignees',
  // Repeated SCALAR children. Easy to miss, because the list above is all objects and a scalar list looks like
  // an ordinary field until it repeats. Measured across 339 real org flows, the two that bite are:
  //   choiceReferences - 50 screen fields carry exactly one, and a lone one arrived as the bare string
  //     "Month", so the whole `choices: …` clause vanished from the row: the dropdown-provenance feature
  //     worked on multi-choice fields and silently did nothing on single-choice ones, in 24 flows.
  //   queriedFields - 42 Get Records carry exactly one. Worse than dropped: `el.queriedFields?.length` is
  //     truthy for the string "Id" (length 2), so the row was EMITTED and then joined to nothing, printing
  //     "Fields read:" with a blank value.
  // mapItems / sortOptions / transformValues had no occurrences in that corpus but are the same shape, and a
  // name in a Set costs nothing.
  'choiceReferences', 'queriedFields', 'mapItems', 'sortOptions', 'transformValues',
]);

/** Leaf text that should not stay a string. */
export const parseScalar = (s) => {
  const t = String(s ?? '').trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t !== '' && !Number.isNaN(Number(t)) && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
};

/** Fold one parsed child into its parent object - the array/scalar rule, shared by both tokenisers. */
export function foldChild(out, key, val) {
  if (XML_ARRAY_KEYS.has(key)) (out[key] ||= []).push(val);
  else if (key in out) out[key] = [].concat(out[key], val);   // repeated but unlisted - still an array
  else out[key] = val;
}

// ── Standalone tokeniser (Node) ──────────────────────────────────────────────────────────────────────────────
// Deliberately narrow: this reads Salesforce METADATA xml, which is machine-generated, namespaced, entity-
// escaped and free of DTDs or processing instructions beyond the declaration. It is not a general XML parser
// and does not pretend to be one - it recognises exactly the constructs that corpus contains and reports
// anything it cannot make sense of rather than guessing.
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** Decode the XML entities DOMParser would, so both tokenisers hand the converter identical strings. */
function decodeEntities(s) {
  if (!s.includes('&')) return s;   // the overwhelmingly common case, and the scan is not free
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : whole;
    }
    // An UNKNOWN entity is left verbatim rather than dropped - the same thing a browser does with a stray
    // `&foo;`, and dropping it would silently corrupt a formula.
    return body in ENTITY ? ENTITY[body] : whole;
  });
}

/**
 * Parse a `.flow-meta.xml` document into the Metadata shape the converter expects.
 * @returns {{Metadata: object}}
 * @throws {Error} with a human-readable reason when the file is not a Flow.
 */
export function parseFlowXmlText(text) {
  const s = String(text ?? '');
  const root = { name: '#root', children: [], text: '' };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;

  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { top().text += decodeEntities(s.slice(i)); break; }
    if (lt > i) top().text += decodeEntities(s.slice(i, lt));

    if (s.startsWith('<!--', lt)) {                       // comment
      const end = s.indexOf('-->', lt);
      i = end < 0 ? s.length : end + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', lt)) {                  // literal text - NO entity decoding
      const end = s.indexOf(']]>', lt);
      top().text += s.slice(lt + 9, end < 0 ? s.length : end);
      i = end < 0 ? s.length : end + 3;
      continue;
    }
    if (s.startsWith('<?', lt) || s.startsWith('<!', lt)) {   // declaration / doctype
      const end = s.indexOf('>', lt);
      i = end < 0 ? s.length : end + 1;
      continue;
    }

    // A real tag. Scan to its '>' RESPECTING QUOTES - an attribute value may legitimately contain '>', and a
    // naive indexOf('>') would cut the tag in half and corrupt everything after it.
    let j = lt + 1, quote = null;
    while (j < s.length) {
      const c = s[j];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      j++;
    }
    if (j >= s.length) throw new Error('That file ends inside an XML tag - it looks truncated.');
    const inner = s.slice(lt + 1, j);
    i = j + 1;

    if (inner[0] === '/') {                                // closing tag
      // Check the NAME matches. Silently popping whatever is on top turns a corrupted document into a
      // plausible-looking half-flow, which is worse than refusing it - DOMParser reports a <parsererror> for
      // the same input, and the two paths have to agree about what is readable, not only about what is read.
      const closing = inner.slice(1).trim().split(':').pop();
      if (stack.length < 2 || top().name !== closing) {
        throw new Error(`That XML is malformed - </${closing}> closes nothing that is open.`);
      }
      stack.pop();
      continue;
    }
    const selfClosing = inner.endsWith('/');
    const rawName = (selfClosing ? inner.slice(0, -1) : inner).match(/^[^\s/]+/)?.[0] || '';
    if (!rawName) throw new Error('That file contains a malformed XML tag.');
    // localName, matching DOMParser: `<xsi:nil>` and `<nil>` fold to the same key, and the root <Flow> keeps
    // its name whether or not the document declares a default namespace.
    const node = { name: rawName.split(':').pop(), children: [], text: '' };
    top().children.push(node);
    if (!selfClosing) stack.push(node);
  }

  // Anything still open means the document was cut short. Without this a truncated retrieve parses into a
  // partial flow that looks fine, and the reader gets a diagram missing whatever came after the cut.
  if (stack.length > 1) {
    throw new Error(`That file ends with <${top().name}> still open - it looks truncated.`);
  }
  const doc = root.children[0];
  if (!doc) throw new Error('That file has no XML content.');
  if (doc.name !== 'Flow') {
    throw new Error(`That XML is a <${doc.name}>, not a <Flow>. Export the flow's .flow-meta.xml.`);
  }
  // The source format has no MasterLabel; the converter falls back to `label`, which the XML does carry.
  return { Metadata: toObject(doc) };
}

/** One node -> a plain object shaped like the Tooling API's JSON. Mirrors flow-import.js's xmlToObject: a node
 *  with NO element children is its text, everything else is an object folded by the shared rule. */
function toObject(node) {
  if (!node.children.length) return parseScalar(node.text);
  const out = {};
  for (const child of node.children) foldChild(out, child.name, toObject(child));
  return out;
}

#!/usr/bin/env node
// CLI wrapper: Salesforce Flow metadata -> Diagramforce `flow` diagram JSON.
//
//   node flow-to-diagramforce.mjs <tooling-flow-response.json> [out.json]
//
// Input: what the Salesforce Tooling API returns for a flow version -
//   GET /services/data/vXX.0/tooling/sobjects/Flow/301...
// Use the org's LATEST API version: the Tooling API shapes its response to the version you ask for, so an
// older one silently omits anything added since. Pass the whole response envelope or just its `Metadata`.
//
// The conversion itself lives in ./flow-convert.js - a VERBATIM copy of the app's
// js/persistence/flow-convert.js, so the skill and the app's own Load & Import produce byte-identical
// diagrams from the same metadata. This file only supplies the two things that differ between a browser
// and a CLI (the layout function and the app version) plus file I/O and the report.
//
// Always run the output through validate-diagram.mjs before handing it to the user.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { computeFlowLayout } from './flow-layout.js';
import { convertFlowMetadata } from './flow-convert.js';
import { parseFlowXmlText } from './flow-xml.js';

// Read the version from the bundled spec's "Spec snapshot: vX" marker rather than hardcoding it, so
// re-syncing the spec automatically stamps the right appVersion and the two can never drift apart.
const appVersion = (() => {
  try {
    const spec = readFileSync(new URL('../references/DIAGRAM_JSON_SPEC.md', import.meta.url), 'utf8');
    return (spec.match(/Spec snapshot: v([\d.]+)/) || [])[1] || '1';
  } catch { return '1'; }
})();

const argv = process.argv.slice(2);
// `--org <alias>` is THE flag. It answers both questions the link card needs - which org, and which flow - so
// the good outcome is what you get by default. It used to answer only the second, with `--org-url` required
// alongside it for the first, and the failure was not hypothetical: the preview generated for review carried
// "Open Flows in Setup" and a /lightning/setup/Flows/home url, because nobody passes an opt-in flag they have
// not been told about. A link to a list of 339 flows is not a link to this flow.
const orgAlias = (() => { const i = argv.indexOf('--org'); return i > -1 ? argv[i + 1] : null; })();
// `--org-url` stays for the case `--org` cannot serve: an instance you know but are not authenticated to, or a
// conversion running where the sf CLI is not installed. Given explicitly, it WINS - an operator naming a host
// outranks whatever an alias resolves to.
const orgUrlFlag = (() => { const i = argv.indexOf('--org-url'); return i > -1 ? argv[i + 1] : null; })();
const [inPath, outPath] = argv.filter((a) => !a.startsWith('--') && a !== orgUrlFlag && a !== orgAlias);
if (!inPath) { console.error('usage: node flow-to-diagramforce.mjs <flow.flow-meta.xml|flow.json> [out.json] [--org <alias>] [--org-url https://…my.salesforce.com]'); process.exit(1); }
// Resolve the instance url from the alias when it was not given. Read-only (`sf org display`), best-effort: a
// failure just means no card, which is the same as passing neither flag.
let orgUrl = orgUrlFlag;
if (!orgUrl && orgAlias) {
  try {
    const out = execFileSync('sf', ['org', 'display', '-o', orgAlias, '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    // `sf org display --json` also returns an accessToken. Take the one field and let the rest go out of scope -
    // never log the payload, and never write it into a diagram that is about to be shared.
    orgUrl = JSON.parse(out)?.result?.instanceUrl || null;
    if (!orgUrl) console.error(`  note: ${orgAlias} reported no instanceUrl - no link card`);
  } catch { console.error(`  note: could not read ${orgAlias} (not authenticated?) - no link card`); }
}
const text = readFileSync(inPath, 'utf8');
// BOTH source formats, detected from the CONTENT rather than the extension. The XML path is what
// `sf project retrieve start -m "Flow:*"` produces - the same command the object and mapping importers use -
// and until now this script JSON.parse'd unconditionally and died on it with a raw SyntaxError stack, while
// stripping `.flow-meta.xml` off the filename two lines below to derive the API name.
const raw = /^\s*(<\?xml|<Flow[\s>])/.test(text) ? parseFlowXmlText(text) : JSON.parse(text);
// SFDX source format keeps a flow's API name ONLY in the FILE NAME - never inside the document - so derive it
// here for the .flow-meta.xml path. A Tooling response carries FullName and wins over this.
const fullName = inPath.split('/').pop().replace(/\.(flow-meta\.xml|json|xml)$/i, '') || null;
// Resolve the id BEFORE converting, so the card can deep-link. Best-effort: a failed lookup degrades to the
// Setup link rather than aborting a conversion that is otherwise fine.
let flowId = raw?.Id || raw?.id || null;
// The name to QUERY on, resolved the way the converter itself resolves it (flow-convert.js: FullName wins over
// the file name). The file name is only a fallback: a Tooling response saved as `flow-response.json` - the
// literal filename SKILL.md suggests - would otherwise query DeveloperName = 'flow-response' and match nothing.
// A name containing `__` is packaged, so its DeveloperName in the org is the un-namespaced half and a
// name-equality query cannot find it; skipping is honest, guessing is not.
const apiName = raw?.FullName || raw?.Metadata?.fullName || raw?.fullName || fullName;
const queryable = apiName && /^[A-Za-z0-9_]+$/.test(apiName) && !apiName.includes('__');
// `orgUrl` still gates the lookup: with no instance url there is no card to build, so the query is a subprocess
// round trip - against a CLI that may be slow, or may stop to re-authenticate - paid for a discarded answer.
if (!flowId && orgAlias && orgUrl && queryable) {
  try {
    // LATEST first, not ACTIVE. This lookup only ever runs for a source file with no id of its own - a
    // `.flow-meta.xml` - and `sf project retrieve` writes the LATEST version, so that is the version drawn on
    // the canvas. Measured against the 393 FlowDefinition rows behind these 339 files: 10 definitions have
    // ActiveVersionId != LatestVersionId, and all 10 of the retrieved files carry <status>Draft</status>. Taking
    // ActiveVersionId first would deep-link those 10 to a version the diagram does not show - the worst kind of
    // wrong, because the link looks like it worked. LatestVersionId is non-null on all 393.
    // `NamespacePrefix = NULL` because a packaged flow's DeveloperName is not unique across namespaces; the same
    // org holds 51 installed FlowDefinitions across 8 of them.
    const q = 'SELECT DeveloperName, ActiveVersionId, LatestVersionId FROM FlowDefinition '
      + `WHERE DeveloperName = '${String(apiName).replace(/'/g, "\\'")}' AND NamespacePrefix = NULL`;
    const out = execFileSync('sf', ['data', 'query', '-o', orgAlias, '-t', '-q', q, '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const rec = JSON.parse(out)?.result?.records?.[0];
    flowId = rec?.LatestVersionId || rec?.ActiveVersionId || null;
    // A live difference between the two is a fact about the FLOW, not a converter apology: the file you are
    // reading is not what the org is running. Say it rather than silently linking to one of them.
    if (rec?.ActiveVersionId && rec.LatestVersionId && rec.ActiveVersionId !== rec.LatestVersionId) {
      console.error(`  note: this file is ${apiName}'s LATEST version, which the link opens - ${orgAlias} is `
        + 'running a DIFFERENT version as Active');
    }
    if (!flowId) console.error(`  note: no unmanaged flow named ${apiName} in ${orgAlias} - the link will point at Setup`);
  } catch { console.error(`  note: could not look up ${apiName} in ${orgAlias} - the link will point at Setup`); }
}

// ── Resolving the references a marketing flow leaves opaque ───────────────────────────────────────────────────
//
// A Send Email / Send Push / Send SMS step names its asset by CMS content key and its consent by record id,
// and a Segment-triggered journey's Start names its audience the same opaque way:
//
//   contentId                      marketing--Default_Content_Workspace.sfdc_cms__email--MCY7J44O4PBNCAHJCRL5UGNFJ7HI
//   communicationSubscriptionId    0XlHn000000siRuKAI
//   commSubscriptionChannelTypeId  0eBHn000000siW2MAI
//   start.segment                  1sgHn00000000oyIAA          (MarketSegment)
//
// None of that answers the question a reader has, which is WHICH email, WHICH subscription, WHICH segment. Note
// the contrast with the Omni-Channel routing parameters, which look similar and are deliberately NOT resolved
// here: measured across 364 flow versions, all 27 of those ids already sit beside a `…Label` / `…DevName`
// sibling on the same card, so there is nothing to add. These four have no such sibling. (`start.dataGraph`
// needs no lookup either - the metadata already carries the graph's NAME, not an id.)
//
// The NAME IS ADDED, NEVER SUBSTITUTED - "0Xl… (Marketing)". The id is what you paste into a URL or hand to
// support; a converter that swallowed it would be destroying the one thing that is unambiguous.
//
// FOUR QUERIES AT MOST, each an IN-list over the DISTINCT references in the whole flow - not one per step.
// `ManagedContent` carries `ContentKey`, so a CMS asset resolves in SOQL rather than needing a Connect GET each.
// The type segment is case-INSENSITIVE on purpose: today's marketing types (email/sms/push) are lowercase,
// but a custom or future camelCase `sfdc_cms__<Type>` would otherwise lose resolution silently - and the
// `sfdc_cms__` prefix plus the `--` separators anchor the match tightly enough that widening costs nothing.
const CMS_KEY = /sfdc_cms__[A-Za-z0-9_]+--([A-Za-z0-9]{10,})/;

/** One `sf data query`, returning [] on any failure. A resolver must never be able to break a conversion that
 *  works perfectly well without it - the ids stay bare and the diagram is still correct. */
function orgQuery(alias, soql, tooling) {
  try {
    const args = ['data', 'query', '-o', alias, '-q', soql, '--json'];
    if (tooling) args.splice(4, 0, '-t');
    const out = execFileSync('sf', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out)?.result?.records || [];
  } catch { return []; }
}

const quoteIn = (vals) => vals.map((v) => `'${String(v).replace(/'/g, "\\'")}'`).join(',');

/**
 * Walk every card's `details`, collect the references worth resolving, ask the org once per KIND, and append
 * the name in place. Mutates the diagram. Silent no-op without an org.
 */
function resolveReferences(diagram, alias) {
  if (!alias) return { cms: 0, subs: 0, channels: 0 };
  const rows = [];
  for (const c of diagram.graph.cells) for (const r of (c.details || [])) rows.push(r);

  const keys = new Set(), subs = new Set(), chans = new Set(), segs = new Set();
  for (const r of rows) {
    const v = String(r.value ?? '');
    const m = CMS_KEY.exec(v);
    if (m) { keys.add(m[1]); continue; }
    if (/^0Xl[A-Za-z0-9]{12,15}$/.test(v)) subs.add(v);
    else if (/^0eB[A-Za-z0-9]{12,15}$/.test(v)) chans.add(v);
    else if (/^1sg[A-Za-z0-9]{12,15}$/.test(v)) segs.add(v);
  }
  const names = new Map();
  if (keys.size) {
    for (const rec of orgQuery(alias, `SELECT ContentKey, Name FROM ManagedContent WHERE ContentKey IN (${quoteIn([...keys])})`)) {
      if (rec.ContentKey && rec.Name) names.set(rec.ContentKey, rec.Name);
    }
  }
  // Key each record under BOTH id widths. SOQL accepts a 15-char id in the IN-list but always RETURNS the
  // 18-char form, so a flow that stored the short id would query successfully and then miss the map - paying
  // for an answer it drops. The read side below tries both widths too; this is the write side of the same rule.
  const setId = (rec) => {
    if (!rec.Id || !rec.Name) return;
    names.set(rec.Id, rec.Name);
    names.set(String(rec.Id).slice(0, 15), rec.Name);
  };
  if (subs.size) {
    for (const rec of orgQuery(alias, `SELECT Id, Name FROM CommSubscription WHERE Id IN (${quoteIn([...subs])})`)) setId(rec);
  }
  if (chans.size) {
    for (const rec of orgQuery(alias, `SELECT Id, Name FROM CommSubscriptionChannelType WHERE Id IN (${quoteIn([...chans])})`)) setId(rec);
  }
  if (segs.size) {
    for (const rec of orgQuery(alias, `SELECT Id, Name FROM MarketSegment WHERE Id IN (${quoteIn([...segs])})`)) setId(rec);
  }
  let hit = 0;
  for (const r of rows) {
    const v = String(r.value ?? '');
    const m = CMS_KEY.exec(v);
    // An 18-char id is stored 15-char-prefixed in some payloads, so match on what we asked for.
    const found = m ? names.get(m[1]) : (names.get(v) || names.get(v.slice(0, 15)));
    if (!found) continue;
    r.value = `${v} (${found})`;
    hit++;
  }
  // The segment id also appears ON the Start card, embedded mid-string in its `configuration` line
  // ("segment 1sg… · data graph … · schedule …") where the anchored full-value match above cannot reach it.
  // Same rule - id kept, name appended - and no `hit++`: the reference was already counted at its details row,
  // and double counting would make the summary below claim more resolutions than the flow has references.
  if (segs.size) {
    for (const c of diagram.graph.cells) {
      if (typeof c.configuration !== 'string') continue;
      c.configuration = c.configuration.replace(/1sg[A-Za-z0-9]{12,15}/g, (id) => {
        const n = names.get(id) || names.get(id.slice(0, 15));
        return n ? `${id} (${n})` : id;
      });
    }
  }
  return { resolved: hit, asked: keys.size + subs.size + chans.size + segs.size,
    queries: (keys.size ? 1 : 0) + (subs.size ? 1 : 0) + (chans.size ? 1 : 0) + (segs.size ? 1 : 0) };
}

const { diagram, stats } = convertFlowMetadata(raw, { fullName, computeFlowLayout, appVersion, orgUrl, flowId });
const refs = resolveReferences(diagram, orgAlias);
const json = JSON.stringify(diagram, null, 2);
if (outPath) writeFileSync(outPath, json); else console.log(json);
console.error(`✓ ${diagram.title}
  elements ${stats.elements} (incl. ${stats.ends} synthesised End) · links ${stats.links} (${stats.goto} Go To, ${stats.fault} fault)
  layout: ${stats.layoutMode}${refs.asked ? `
  references: ${refs.resolved} of ${refs.asked} named from ${orgAlias} in ${refs.queries} quer${refs.queries === 1 ? 'y' : 'ies'} (the id is kept, the name added)` : ''}${stats.warnings.length ? `\n  warnings:\n${stats.warnings.map((w) => `    - ${w}`).join('\n')}` : ''}`);

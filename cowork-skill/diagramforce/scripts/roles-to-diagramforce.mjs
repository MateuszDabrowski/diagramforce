#!/usr/bin/env node
// Salesforce ROLE HIERARCHY -> a Diagramforce Org Chart.
//
// A thin CLI wrapper. The parsing, layout and card authoring live in `role-convert.js`, which is the SAME module
// the app's paste path uses - so a chart built here and one pasted into Load & Import are identical rather than
// merely similar. (Same arrangement as datagraph-convert.js; the copy beside this file is asserted identical to
// js/persistence/role-convert.js by dev/tests/skill-sync.test.js.)
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROLE_QUERY, parseRoles, buildRoleDiagram } from './role-convert.js';
import { runSf, readText } from './sf-cli.js';

const die = (m) => { console.error(m); process.exit(1); };

// Stamp the app version from the bundled spec's "Spec snapshot: vX" marker, as flow-to-diagramforce.mjs does, so a
// re-synced spec re-stamps the output and no hardcoded version can drift ahead of (or behind) the release.
const appVersion = (() => {
  try {
    const spec = readFileSync(new URL('../references/DIAGRAM_JSON_SPEC.md', import.meta.url), 'utf8');
    return (spec.match(/Spec snapshot: v([\d.]+)/) || [])[1] || undefined;
  } catch { return undefined; }
})();

/** Run ROLE_QUERY through `sf data query`, which reuses the CLI's own auth - no access token is ever read, printed
 *  or written by this script. A SELECT, so it reads the org and changes nothing. runSf (sf-cli.js) starts `sf` on
 *  Windows too, and turns a failure into sf's own reason rather than "Command failed: sf data query ...". */
function fetchFromOrg(alias) {
  return JSON.parse(runSf(['data', 'query', '--query', ROLE_QUERY, '--json', '-o', alias], { maxBuffer: 64 * 1024 * 1024 }));
}

function main(argv) {
  const args = argv.slice(2);
  const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const org = val('--org'), title = val('--title'), root = val('--root');
  const includePortal = args.includes('--include-portal');
  const positional = args.filter((a, i) => !a.startsWith('--') && !['--org', '--title', '--root'].includes(args[i - 1]));
  const [first, second] = positional;
  // With --org the only path is the OUTPUT. Given a saved result as well, the first positional used to become the
  // output, so `roles q.json out.json --org x` overwrote q.json with the diagram.
  if (org && positional.length > 1) {
    die(`Pass either a saved role query result or --org, not both - with --org the only path is the output file (got ${positional.join(', ')}).`);
  }
  const inPath = org ? null : first;
  const outPath = org ? first : second;

  if (!inPath && !org) {
    die('usage: node scripts/roles-to-diagramforce.mjs <roles.json> [out.json] [--root <role>] [--include-portal] [--title T]\n'
      + '       node scripts/roles-to-diagramforce.mjs --org <alias> [out.json] [--root <role>] [--include-portal] [--title T]\n'
      + '\n'
      + 'Input is the output of:\n'
      + `  sf data query --query "${ROLE_QUERY}" --json -o <alias>\n`
      + 'Leave out the Users subquery and the cards show roles only, with no holders and no vacancies.\n'
      + 'Portal roles (PortalType Partner / CustomerPortal) are skipped unless --include-portal is given.\n'
      + '--root draws one branch: the role (DeveloperName, Name or Id) and everything under it.');
  }

  let doc;
  try {
    doc = org ? fetchFromOrg(org) : JSON.parse(readText(inPath));
  } catch (e) { die(org ? `Could not query the roles from ${org}: ${e.message}` : `Could not read the role query result: ${e.message}`); }

  let built;
  try {
    built = buildRoleDiagram(parseRoles(doc), { title, includePortal, root, ...(appVersion ? { appVersion } : {}) });
  } catch (e) { die(e.message); }

  const json = JSON.stringify(built.diagram, null, 2);
  if (outPath) writeFileSync(outPath, json); else process.stdout.write(json);

  const s = built.stats;
  console.error(`✓ ${built.diagram.title}`);
  console.error(`  roles ${s.roles} · links ${s.links} · top roles ${s.roots} · levels ${s.levels}`
    + (s.vacant != null ? ` · vacant ${s.vacant}` : '')
    + (s.portalSkipped ? ` · ${s.portalSkipped} portal roles skipped (--include-portal keeps them)` : ''));
  if (s.vacant == null) {
    console.error('  note: no Users subquery in the input, so the cards carry no holders and no vacancies.');
  }
  if (s.cycles) console.error(`  note: ${s.cycles} role(s) sat in a parent cycle and were drawn as top roles.`);
  if (s.partial) {
    console.error(`  note: the input is one page of a longer result (${s.partial.received} of ${s.partial.total ?? '?'} roles). `
      + '--org, or sf data query --json, fetches every page.');
  }
  if (s.missingParents) console.error(`  note: ${s.missingParents} role(s) name a parent missing from the input and were drawn as top roles.`);
  // One uniform card width across the chart, so a wide org is wide - say how wide, because the reader will
  // otherwise meet it at 10% zoom with no warning.
  if (s.width > 8000) {
    console.error(`  note: the chart is ${s.width}px wide (${s.cardWidth}px cards). Draw one branch with `
      + '--root <DeveloperName>, or zoom in after opening.');
  }
}

// Entry point: compare REAL paths. The module URL is symlink-resolved and percent-encoded while argv[1] is as typed,
// and on Windows it uses backslashes, so a name or URL comparison skipped main() (skill-cli-paths.test.js).
const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) main(process.argv);

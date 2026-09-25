#!/usr/bin/env node
// Salesforce ROLE HIERARCHY -> a Diagramforce Org Chart.
//
// A thin CLI wrapper. The parsing, layout and card authoring live in `role-convert.js`, which is the SAME module
// the app's paste path uses - so a chart built here and one pasted into Load & Import are identical rather than
// merely similar. (Same arrangement as datagraph-convert.js; the copy beside this file is asserted identical to
// js/persistence/role-convert.js by dev/tests/skill-sync.test.js.)
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ROLE_QUERY, parseRoles, buildRoleDiagram } from './role-convert.js';

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
 *  or written by this script. A SELECT, so it reads the org and changes nothing. */
function fetchFromOrg(alias) {
  const body = execFileSync('sf', ['data', 'query', '--query', ROLE_QUERY, '--json', '-o', alias],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(body);
}

function main(argv) {
  const args = argv.slice(2);
  const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const org = val('--org'), title = val('--title'), root = val('--root');
  const includePortal = args.includes('--include-portal');
  const positional = args.filter((a, i) => !a.startsWith('--') && !['--org', '--title', '--root'].includes(args[i - 1]));
  const [first, second] = positional;
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
    doc = org ? fetchFromOrg(org) : JSON.parse(readFileSync(inPath, 'utf8'));
  } catch (e) { die(`Could not read the role query result: ${e.message}`); }

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
  // One uniform card width across the chart, so a wide org is wide - say how wide, because the reader will
  // otherwise meet it at 10% zoom with no warning.
  if (s.width > 8000) {
    console.error(`  note: the chart is ${s.width}px wide (${s.cardWidth}px cards). Draw one branch with `
      + '--root <DeveloperName>, or zoom in after opening.');
  }
}

// File NAME, not the full URL: `import.meta.url` is percent-encoded and symlink-resolved while argv[1] is neither,
// so an exact compare silently skipped main() for any install path with a space ("Application Support") or a
// symlink - exit 0, no output. Same check as the sibling scripts.
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) main(process.argv);

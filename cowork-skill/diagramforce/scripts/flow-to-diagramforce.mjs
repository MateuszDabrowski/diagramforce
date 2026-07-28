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
import { computeFlowLayout } from './flow-layout.js';
import { convertFlowMetadata } from './flow-convert.js';

// Read the version from the bundled spec's "Spec snapshot: vX" marker rather than hardcoding it, so
// re-syncing the spec automatically stamps the right appVersion and the two can never drift apart.
const appVersion = (() => {
  try {
    const spec = readFileSync(new URL('../references/DIAGRAM_JSON_SPEC.md', import.meta.url), 'utf8');
    return (spec.match(/Spec snapshot: v([\d.]+)/) || [])[1] || '1';
  } catch { return '1'; }
})();

const [inPath, outPath] = process.argv.slice(2);
if (!inPath) { console.error('usage: node flow-to-diagramforce.mjs <flow.json> [out.json]'); process.exit(1); }
const raw = JSON.parse(readFileSync(inPath, 'utf8'));
// SFDX source format keeps a flow's API name ONLY in the FILE NAME - never inside the document - so derive it
// here for the .flow-meta.xml path. A Tooling response carries FullName and wins over this.
const fullName = inPath.split('/').pop().replace(/\.(flow-meta\.xml|json|xml)$/i, '') || null;
const { diagram, stats } = convertFlowMetadata(raw, { fullName, computeFlowLayout, appVersion });
const json = JSON.stringify(diagram, null, 2);
if (outPath) writeFileSync(outPath, json); else console.log(json);
console.error(`✓ ${diagram.title}
  elements ${stats.elements} (incl. ${stats.ends} synthesised End) · links ${stats.links} (${stats.goto} Go To, ${stats.fault} fault)
  layout: ${stats.layoutMode}${stats.warnings.length ? `\n  warnings:\n${stats.warnings.map((w) => `    - ${w}`).join('\n')}` : ''}`);

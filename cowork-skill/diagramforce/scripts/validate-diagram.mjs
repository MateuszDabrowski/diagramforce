#!/usr/bin/env node
// Validate a Diagramforce diagram JSON BEFORE handing it to the user - surfacing the things the app's loader
// heals or SILENTLY drops (unknown shape types, dangling links, duplicate ids) plus best-practice warnings
// (wrong diagramType, a type-specific shape used in the wrong diagram type). Zero dependencies (Node built-ins
// only), no build step.
//
//   node validate-diagram.mjs path/to/diagram.json [more.json ...]
//   cat diagram.json | node validate-diagram.mjs        # reads stdin
//
// Exit code: 1 if any ERROR was found (the diagram won't import as authored), else 0 (warnings don't fail).
//
// `diagram-schema.js` (the shape allowlist + rules) is a verbatim copy of the app's own
// js/persistence/diagram-schema.js, bundled so this skill is self-contained. Keep it in sync with the app on
// each release (it is the SAME allowlist the renderer loads with, so a stale copy would accept shapes the app
// then drops). See the skill's SKILL.md "Staying in sync" note.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateFile } from './diagram-schema.js';

const tryRead = (p) => { try { return { text: readFileSync(p, 'utf8') }; } catch (e) { return { err: e.message }; } };

function report(source, json) {
  let errors = 0, warnings = 0;
  const results = validateFile(json);
  for (const r of results) {
    const label = results.length > 1 ? `${source} › ${r.name}` : source;
    if (!r.errors.length && !r.warnings.length) { console.log(`✓ ${label}: valid`); continue; }
    console.log(`${r.errors.length ? '✗' : '⚠'} ${label}`);
    for (const e of r.errors) { console.log(`    ✗ ERROR   ${e}`); errors++; }
    for (const w of r.warnings) { console.log(`    ⚠ WARNING ${w}`); warnings++; }
  }
  return { errors, warnings };
}

const args = process.argv.slice(2);
const inputs = args.length
  ? args.map((p) => ({ source: p, ...tryRead(resolve(process.cwd(), p)) }))
  : [{ source: '<stdin>', text: (() => { try { return readFileSync(0, 'utf8'); } catch { return ''; } })() }];

let totalErrors = 0, totalWarnings = 0;
for (const { source, text, err } of inputs) {
  if (err) { console.log(`✗ ${source}: cannot read (${err})`); totalErrors++; continue; }
  if (!text || !text.trim()) { console.log(`✗ ${source}: empty input`); totalErrors++; continue; }
  let json;
  try { json = JSON.parse(text); } catch (e) { console.log(`✗ ${source}: invalid JSON (${e.message})`); totalErrors++; continue; }
  const { errors, warnings } = report(source, json);
  totalErrors += errors; totalWarnings += warnings;
}

console.log(`\n${totalErrors ? '✗' : '✓'} ${inputs.length} file(s) checked - ${totalErrors} error(s), ${totalWarnings} warning(s).`);
process.exit(totalErrors ? 1 : 0);

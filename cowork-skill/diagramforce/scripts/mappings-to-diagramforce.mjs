#!/usr/bin/env node
// mappings-to-diagramforce.mjs — turn Data Cloud mappings into a `datamapping` diagram, from either source.
//
//   # the richer METADATA path - carries formulas and filters, needs a selection
//   sf project retrieve start -m "ObjectSourceTargetMap:*" -o <org>
//   node scripts/mappings-to-diagramforce.mjs force-app/main/default/objectSourceTargetMaps --only Contact_Home
//
//   # the one-GET CONNECT path - no CLI needed to FETCH it, and DMO-scoped so it needs no --only
//   sf api request rest "/services/data/v67.0/ssot/data-model-object-mappings?dmoDeveloperName=ssot__Individual__dlm" > m.json
//   node scripts/mappings-to-diagramforce.mjs m.json
//
// Point it at a directory of `*.objectSourceTargetMap-meta.xml` files, a single one, or a saved Connect
// response. The format is detected from the CONTENT.
//
// The conversion itself lives in ./mapping-convert.js - a VERBATIM copy of the app's
// js/persistence/mapping-convert.js, so the skill and the app's own Load & Import produce byte-identical
// diagrams from the same mappings. This file supplies only the file I/O, the selection flags and the report.
//
// ── Scale is the reason `--only` exists (metadata path) ─────────────────────────────────────────────────────
// Measured on a real Data Cloud org: 154 object mappings and 3661 field mappings, one DLO fanning out to 7
// DMOs. `MAX_CELL_COUNT` is 2000, so "the whole org" is not a diagram - it is a crash. Pick the DLOs the
// diagram is ABOUT. The Connect path needs no flag: asking for one DMO IS the selection.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { buildDiagram, parseMappingXml, fromConnectPayload, looksLikeMappingJson, fieldCatalogue, normaliseCategory } from './mapping-convert.js';

const die = (m) => { console.error(m); process.exit(1); };

/** Read a set of `*.objectSourceTargetMap-meta.xml` files into normalised maps. */
export function parseMappingFiles(paths) {
  const maps = [];
  for (const p of paths) {
    const m = parseMappingXml(readFileSync(p, 'utf8'));
    if (m) maps.push(m);
  }
  return maps;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  const val = (f) => { const i = args.indexOf(f); return i > -1 ? args[i + 1] : null; };
  if (!target) die('usage: node scripts/mappings-to-diagramforce.mjs <dir|file> [--only A,B] [--no-lineage] [--with-fields dmos.json] [--org <alias> | --categories metadata.json] [--title T] [--max-cells N]');

  // Detect the SOURCE SHAPE from the content, not the extension: a saved Connect response is `.json`, but so
  // is anything else, and a directory of metadata is neither. Getting this from the bytes means the user does
  // not have to tell us which route they took.
  let maps;
  try {
    const isDir = statSync(target).isDirectory();
    if (isDir) {
      const paths = readdirSync(target)
        .filter((f) => f.endsWith('.objectSourceTargetMap-meta.xml')).map((f) => join(target, f));
      maps = parseMappingFiles(paths);
    } else {
      const text = readFileSync(target, 'utf8');
      maps = looksLikeMappingJson(text) ? fromConnectPayload(JSON.parse(text)) : parseMappingFiles([target]);
    }
  } catch (e) { die(`Could not read ${target}: ${e.message}`); }

  // Everything that was read, before --only narrows it. Kept so the report below can say where a DLO's other
  // fields GO - the canvas alone cannot distinguish "feeds a DMO you did not select" from "read by nothing".
  const allMaps = maps;

  const only = (val('--only') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  let lineageAdded = 0;
  if (only.length) {
    const all = allMaps;
    maps = all.filter((m) => only.some((o) => m.source.toLowerCase().includes(o) || m.target.toLowerCase().includes(o)));

    // COMPLETE THE LINEAGE. `--only` is a substring filter over both object names, so which data streams
    // appear depends on how the org happened to NAME things: selecting ContactPointEmail pulled in
    // `Training_Site_contactPointEmail_C3B5BBA5` purely because that stream's name contains the DMO's, while
    // the four other streams feeding the same DMO's DLOs were left out. One of five is worse than none - the
    // Data Stream lane looked authoritative while being arbitrary.
    //
    // So: for every DLO on the canvas, pull in the ingest map that FEEDS it. Upstream only, and only for
    // DLOs - completing the upstream of a DMO would drag in every sibling DLO that feeds it and explode a
    // one-DMO diagram into most of the org. Iterated to a fixed point, though in practice a Data Cloud
    // pipeline is only ever datastream -> dlo -> dmo, so it settles in one pass.
    const have = new Set(maps.map((m) => `${m.source}\u0000${m.target}`));
    for (let pass = 0; pass < 4; pass++) {
      const dlos = new Set(maps.flatMap((m) => [m.source, m.target]).filter((n) => /__dll$/i.test(n)));
      const add = all.filter((m) => dlos.has(m.target) && !have.has(`${m.source}\u0000${m.target}`));
      if (!add.length) break;
      add.forEach((m) => have.add(`${m.source}\u0000${m.target}`));
      maps = maps.concat(add);
      lineageAdded += add.length;
    }
    // Opt OUT, not in: the layer model only means something when the leftmost lane is complete.
    if (args.includes('--no-lineage')) { maps = maps.slice(0, maps.length - lineageAdded); lineageAdded = 0; }
  }

  // A DLO field with no outgoing connector is one of TWO very different things, and the canvas cannot tell
  // them apart: it either feeds a DMO that is not in this selection, or it is read by nothing anywhere.
  // Measured on a real org, both are common - 54% of the 2257 ingested DLO fields are read by no onward map
  // at all, while Lead_Home__dll alone has 7 onward maps and 45 of its 75 fields go somewhere off-canvas.
  // Reporting it is the same discipline as the flow converter's unreachable-element warning: say what the
  // picture cannot.
  const offCanvas = (() => {
    const shown = new Set(maps.map((m) => `${m.source}\u0000${m.target}`));
    const dlos = new Set(maps.flatMap((m) => [m.source, m.target]).filter((n) => /__dll$/i.test(n)));
    const targets = new Map();       // DMO -> how many field maps it takes from a DLO we are showing
    for (const m of allMaps) {
      if (shown.has(`${m.source}\u0000${m.target}`) || !dlos.has(m.source)) continue;
      targets.set(m.target, (targets.get(m.target) || 0) + m.fields.length);
    }
    return [...targets].sort((a, b) => b[1] - a[1]);
  })();

  let diagram, stats;
  // buildDiagram throws rather than exits (it runs in a browser too), so the CLI restores the clean exit.
  // --with-fields: merge the FULL field list from a /ssot/data-model-objects catalogue, so the cards show what
  // is NOT mapped as well as what is. Mapped-only stays the default; this is the "which fields still need
  // mapping?" view, and it is deliberately opt-in because it makes every card considerably taller.
  let catalogue = null;
  const catPath = val('--with-fields');
  if (catPath) {
    try {
      const raw = readFileSync(catPath, 'utf8');
      catalogue = fieldCatalogue(JSON.parse(raw.slice(Math.max(0, raw.indexOf('{')))));
    } catch (e) { die(`Could not read the field catalogue ${catPath}: ${e.message}`); }
  }
  // OBJECT CATEGORIES (owner: "I don't see any object with properly selected Category"). Two optional routes
  // feeding one map of API name -> normalised app value, stamped onto DLO and DMO cards; a card with no entry
  // stays keyless, exactly like the templates' Source and Data Stream cards. Same resolver rules as the flow
  // converter's --org: silent no-op on ANY failure - a category is a bonus, the diagram is the deliverable.
  //   --org <alias>       one GET per entity type against /ssot/metadata, through the CLI's own auth
  //   --categories <file> a saved copy of the same payload(s), for orgs where the sf CLI cannot connect
  //                       (Workbench REST Explorer paste; accepts one payload or an array of them)
  const categories = {};
  const takeMeta = (payload) => {
    for (const e of (payload?.metadata || [])) {
      const cat = normaliseCategory(e?.category);
      if (e?.name && cat) categories[e.name] = cat;
    }
  };
  const orgAlias = val('--org');
  if (orgAlias) {
    for (const entity of ['DataModelObject', 'DataLakeObject']) {
      try {
        const out = execFileSync('sf',
          ['api', 'request', 'rest', `/services/data/v64.0/ssot/metadata?entityType=${entity}`, '-o', orgAlias],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
        takeMeta(JSON.parse(out));
      } catch { console.error(`  note: could not fetch ${entity} categories from ${orgAlias} - cards stay uncategorised`); }
    }
  }
  const catFile = val('--categories');
  if (catFile) {
    try {
      const parsed = JSON.parse(readFileSync(catFile, 'utf8'));
      (Array.isArray(parsed) ? parsed : [parsed]).forEach(takeMeta);
    } catch { console.error(`  note: could not read ${catFile} - cards stay uncategorised`); }
  }

  try { ({ diagram, stats } = buildDiagram(maps, { title: val('--title'), catalogue, categories })); }
  catch (e) { die(`${e.message} Check the path, and --only if you used it.`); }
  const cap = Number(val('--max-cells')) || 2000;
  if (stats.cells > cap) {
    die(`That selection is ${stats.cells} cells, past the ${cap} the app will load `
      + `(${stats.objectMaps} object mappings, ${stats.fieldLinks} field links).\n`
      + 'Narrow it with --only <dlo name> - a mapping diagram is about a few objects, not the whole org.');
  }
  console.log(JSON.stringify(diagram, null, 2));
  console.error(`✓ ${diagram.title}
  object mappings ${stats.objectMaps} · ${stats.layers.join(' · ')}
  field links ${stats.fieldLinks}${stats.formulas ? ` · ${stats.formulas} formula-sourced (drawn from a "… Formulas" companion card - a formula map has no source field of its own)` : ''}${
  stats.formulaInputs ? ` · ${stats.formulaInputs} formula input(s) drawn left-to-left from the source fields they read` : ''}${
  stats.categorised ? `\n  ${stats.categorised} card(s) categorised from the org` : ''}${
  stats.filtered ? ` · ${stats.filtered} filtered` : ''}${
  stats.unmapped ? `\n  + ${stats.unmapped} unmapped field(s) shown from the catalogue - the gaps to discuss` : ''}${
  lineageAdded ? `\n  + ${lineageAdded} upstream map(s) added to complete the lineage (--no-lineage to skip)` : ''}${
  stats.prunedUpstream ? `\n  - ${stats.prunedUpstream} upstream mapping(s) dropped: ingested but never forwarded to a data model object `
    + '(--with-fields keeps them, and shows the unmapped ones too)' : ''}${
  offCanvas.length ? `\n  note: fields on these DLOs also feed ${offCanvas.length} DMO(s) NOT in this selection - `
    + `${offCanvas.slice(0, 3).map(([n, c]) => `${n} (${c})`).join(', ')}${offCanvas.length > 3 ? `, +${offCanvas.length - 3} more` : ''}. `
    + 'A field with no outgoing connector here is not necessarily unused.' : ''}`);
}

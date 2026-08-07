// Field-schema CSV export — one row per field across every DataObject on the diagram.
// This is the Save → Export to CSV action for Data MODEL diagrams. (Data Mapping exports the
// source→target mapping lineage instead, reusing table-view.js — see the dispatch in toolbar.js.)
// Columns mirror the per-object field CSV in properties.js (fieldsToCsv), prefixed with an
// Object column so a flat, multi-object export stays unambiguous.
import { sanitizeFilenamePart } from './util.js?v=1.22.1';
import { getActiveTabName } from './tabs.js?v=1.22.1';
import { triggerDownload } from './persistence.js?v=1.22.1';

const COLUMNS = ['Object', 'API Name', 'Label', 'Type', 'Length', 'Required', 'Deprecated', 'Key', 'Sample Values'];

// RFC-4180-ish escaper: quote any cell holding a comma / quote / newline, doubling inner quotes.
const esc = v => { const s = String(v ?? '').trim(); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const keyToCsv = k => k === 'pk' ? 'PK' : k === 'fk' ? 'FK' : k === 'fqk' ? 'FQK' : '';
const objNameOf = o => (o && o.attr && o.attr('headerLabel/text')) || (o && o.get('objectName')) || (o && o.get('name')) || 'Object';

/** Build the field-schema CSV string for every DataObject.
 *  `rowOrder` (optional, C7 1.22.0): an array of `{ objId, fid }` dictating emission order - the
 *  Table view passes its RENDERED row order so the in-view "Export Schema to CSV" honours the
 *  current column sort, making the button's "the visible rows" tooltip true (mapping + gantt
 *  already exported what you see; model mode silently discarded the sort). Omitted -> graph order
 *  (the Save-menu export renders without the table open and stays graph-ordered on purpose).
 *  Any field the order misses (or that has no fid) is appended in graph order so the file never
 *  silently loses a row; entries that no longer resolve are skipped. */
export function buildObjectSchemaCsv(graph, rowOrder = null) {
  const objects = graph.getElements().filter(e => e.get('type') === 'sf.DataObject');
  const lines = [COLUMNS.map(esc).join(',')];
  const push = (o, f) => lines.push([
    objNameOf(o), f.apiName || '', f.label || '', f.type || '', f.length || '',
    f.required ? 'Yes' : 'No', f.deprecated ? 'Yes' : 'No', keyToCsv(f.keyType), f.sampleValues || '',
  ].map(esc).join(','));
  const seen = new Set();
  for (const { objId, fid } of (rowOrder || [])) {
    const o = objId && graph.getCell(objId);
    if (!o?.get || o.get('type') !== 'sf.DataObject') continue;
    const f = fid && (o.get('fields') || []).find(x => x && x.fid === fid);
    if (!f) continue;
    push(o, f);
    seen.add(`${objId}::${fid}`);
  }
  for (const o of objects) {
    for (const f of (o.get('fields') || [])) {
      if (!f || (f.fid && seen.has(`${o.id}::${f.fid}`))) continue;
      push(o, f);
    }
  }
  // A UTF-8 BOM keeps Excel honest about the encoding; CRLF line ends match the table-view export.
  return '﻿' + lines.join('\r\n');
}

/** Build + download the field-schema CSV (Data Model Save → Export to CSV). */
export function exportObjectSchemaCsv(graph) {
  if (!graph) return;
  const csv = buildObjectSchemaCsv(graph);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, `df_${sanitizeFilenamePart(getActiveTabName(), 'tab')}_schema.csv`);
}

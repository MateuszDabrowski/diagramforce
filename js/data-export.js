// Field-schema CSV export — one row per field across every DataObject on the diagram.
// This is the Save → Export to CSV action for Data MODEL diagrams. (Data Mapping exports the
// source→target mapping lineage instead, reusing table-view.js — see the dispatch in toolbar.js.)
// Columns mirror the per-object field CSV in properties.js (fieldsToCsv), prefixed with an
// Object column so a flat, multi-object export stays unambiguous.
import { sanitizeFilenamePart } from './util.js?v=1.16.0';
import { getActiveTabName } from './tabs.js?v=1.16.0';

const COLUMNS = ['Object', 'API Name', 'Label', 'Type', 'Length', 'Required', 'Deprecated', 'Key', 'Sample Values'];

// RFC-4180-ish escaper: quote any cell holding a comma / quote / newline, doubling inner quotes.
const esc = v => { const s = String(v ?? '').trim(); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const keyToCsv = k => k === 'pk' ? 'PK' : k === 'fk' ? 'FK' : k === 'fqk' ? 'FQK' : '';
const objNameOf = o => (o && o.attr && o.attr('headerLabel/text')) || (o && o.get('objectName')) || (o && o.get('name')) || 'Object';

/** Build the field-schema CSV string for every DataObject in graph order. */
export function buildObjectSchemaCsv(graph) {
  const objects = graph.getElements().filter(e => e.get('type') === 'sf.DataObject');
  const lines = [COLUMNS.map(esc).join(',')];
  for (const o of objects) {
    const name = objNameOf(o);
    for (const f of (o.get('fields') || [])) {
      if (!f) continue;
      lines.push([
        name, f.apiName || '', f.label || '', f.type || '', f.length || '',
        f.required ? 'Yes' : 'No', f.deprecated ? 'Yes' : 'No', keyToCsv(f.keyType), f.sampleValues || '',
      ].map(esc).join(','));
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
  const a = document.createElement('a');
  a.href = url;
  a.download = `df_${sanitizeFilenamePart(getActiveTabName(), 'tab')}_schema.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

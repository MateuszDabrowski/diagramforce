// DataObject field editor (CLEANUP S2, slice 4) — the field-schema editor extracted from properties.js:
// SF_FIELD_TYPES (the type allowlist, also imported by table-view.js via the facade re-export), the inline
// renderFieldEditor row list, and the staged "Edit in Table" openFieldEditorModal (Save/Cancel, history-locked)
// plus its CSV import/export helpers. Operates on the passed cell/parent + history batching (no graph/paper/
// selection ref); never imports the facade back. The facade's renderDataObjectProps + the DataObject dblclick
// handler import renderFieldEditor / openFieldEditorModal back; table-view.js keeps importing SF_FIELD_TYPES
// from properties.js (facade re-export).
import * as history from '../history.js?v=1.21.7';
import { resizeDataObjectToFit } from '../components.js?v=1.21.7';
import { buildModal, confirmModal } from '../feedback.js?v=1.21.7';
import { applyKeyType, cycleKeyType, keyImpliesRequired, keyTypeLabel, newField } from '../field-model.js?v=1.21.7';
import { triggerDownload } from '../persistence.js?v=1.21.7';
import { newFid } from '../shapes.js?v=1.21.7';
import { getActiveTabName } from '../tabs.js?v=1.21.7';
import { sanitizeFilenamePart } from '../util.js?v=1.21.7';

export const SF_FIELD_TYPES = [
  'Auto Number', 'Boolean', 'Checkbox', 'Currency', 'Date', 'DateTime', 'Email',
  'Formula', 'ID', 'Lookup', 'Master-Detail', 'Number', 'Percent',
  'Phone', 'Picklist', 'Multi-Picklist', 'Rich Text Area',
  'Text', 'Text Area', 'Long Text Area', 'URL',
];

export function renderFieldEditor(parent, cell) {
  const fields = cell.get('fields') || [];
  const listEl = document.createElement('div');
  listEl.className = 'df-field-list';

  function rebuild() {
    listEl.innerHTML = '';

    // Header row
    const hdr = document.createElement('div');
    hdr.className = 'df-field-row df-field-row--header';
    hdr.innerHTML = '<span>Key</span><span>API Name</span><span>Type</span><span></span>';
    listEl.appendChild(hdr);

    const currentFields = cell.get('fields') || [];
    currentFields.forEach((field, i) => {
      const row = document.createElement('div');
      row.className = 'df-field-row';

      // Key type toggle
      const keyBtn = document.createElement('button');
      keyBtn.className = 'df-field-key df-field-key--' + (field.keyType || 'none');
      keyBtn.textContent = keyTypeLabel(field.keyType);
      keyBtn.title = 'Toggle key: None → PK → FK → FQK';
      keyBtn.addEventListener('click', () => {
        const updated = [...cell.get('fields')];
        // applyKeyType auto-marks required for PK/FQK (inherently mandatory keys).
        updated[i] = applyKeyType(updated[i], cycleKeyType(field.keyType));
        cell.set('fields', updated);
        resizeDataObjectToFit(cell);
        rebuild();
      });

      // API Name input
      const apiInput = document.createElement('input');
      apiInput.type = 'text';
      apiInput.className = 'df-field-input df-field-input--api';
      apiInput.value = field.apiName || '';
      apiInput.placeholder = 'API Name';
      apiInput.addEventListener('input', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], apiName: apiInput.value };
        cell.set('fields', updated);
      });

      // Type select
      const typeSelect = document.createElement('select');
      typeSelect.className = 'df-field-input df-field-input--type';
      // Add current value if it's not in the list
      const allTypes = SF_FIELD_TYPES.includes(field.type) ? SF_FIELD_TYPES : [field.type, ...SF_FIELD_TYPES].filter(Boolean);
      allTypes.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        if (t === field.type) opt.selected = true;
        typeSelect.appendChild(opt);
      });
      typeSelect.addEventListener('change', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], type: typeSelect.value };
        cell.set('fields', updated);
      });

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'df-field-delete';
      delBtn.textContent = '×';
      delBtn.title = 'Remove field';
      delBtn.addEventListener('click', () => {
        const updated = [...cell.get('fields')];
        updated.splice(i, 1);
        cell.set('fields', updated);
        resizeDataObjectToFit(cell);
        rebuild();
      });

      row.appendChild(keyBtn);
      row.appendChild(apiInput);
      row.appendChild(typeSelect);
      row.appendChild(delBtn);
      listEl.appendChild(row);
    });

    // Add field button
    const addBtn = document.createElement('button');
    addBtn.className = 'df-properties__btn df-properties__btn--add-field';
    addBtn.textContent = '+ Add Field';
    addBtn.addEventListener('click', () => {
      const updated = [...cell.get('fields'), newField()];
      cell.set('fields', updated);
      resizeDataObjectToFit(cell);
      rebuild();
    });
    listEl.appendChild(addBtn);

    // Edit in Table button
    const fullEditBtn = document.createElement('button');
    fullEditBtn.className = 'df-properties__btn df-properties__btn--full-edit';
    fullEditBtn.textContent = '⊞ Edit in Table';
    fullEditBtn.addEventListener('click', () => openFieldEditorModal(cell, rebuild));
    listEl.appendChild(fullEditBtn);
  }

  rebuild();
  parent.appendChild(listEl);
}

/* ── Full Edit Mode modal for DataObject fields ───────────── */

// A compact checkbox toggle matching the Display menu's checkbox (a square that shows
// a tick when on). Used for the field modal's Required / Deprecated columns
// instead of raw browser checkboxes, for app-consistent styling.
export function makeFieldCheckToggle(checked, title, extraClass, onChange, locked = false) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'df-field-modal__check-toggle' + (extraClass ? ' ' + extraClass : '')
    + (checked ? ' is-checked' : '') + (locked ? ' is-locked' : '');
  btn.title = locked ? 'A PK / FQK key is always required' : title;
  btn.setAttribute('role', 'checkbox');
  btn.setAttribute('aria-checked', String(checked));
  if (locked) { btn.setAttribute('aria-disabled', 'true'); btn.disabled = true; }
  btn.innerHTML = '<svg class="df-toolbar__checkbox" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path class="df-toolbar__checkbox-tick" d="M4.5 8l2.5 2.5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // Locked toggles (PK/FQK Required) are non-interactive — the key type owns the value.
  if (!locked) {
    btn.addEventListener('click', () => {
      const next = !btn.classList.contains('is-checked');
      btn.classList.toggle('is-checked', next);
      btn.setAttribute('aria-checked', String(next));
      onChange(next);
    });
  }
  return btn;
}

export function openFieldEditorModal(cell, onClose) {
  // Remove any existing modal — through its own close() (stashed on the node) so trapFocus's document-level
  // keydown listener is released rather than orphaned.
  const staleField = document.getElementById('field-editor-modal');
  if (staleField?.__dfClose) staleField.__dfClose(); else staleField?.remove();

  // buildModal owns the scaffold + focus-trap + focus-restore + backdrop/✕/Escape
  // close. The bespoke borderless ✕ (closeClass + closeHtml) and footer scoping
  // (footerClass) come from the extended factory API; onClose fires the caller's
  // callback after teardown (matches the old close()).
  const { overlay, body: bodyEl, close } = buildModal({
    title: `Edit Fields - ${cell.get('objectName') || 'Object'}`, // textContent - buildModal escapes
    dialogClass: 'df-field-modal__dialog',
    bodyClass: 'df-field-modal__body',
    footerClass: 'df-field-modal__footer',
    closeClass: 'df-field-modal__close',
    closeHtml: '✕',
    footerHtml: `
      <button class="df-properties__btn df-properties__btn--add-field df-field-modal__add">+ Add Field</button>
      <button class="df-modal__btn df-modal__btn--primary df-field-modal__done">Done</button>`,
    onClose,
  });
  overlay.id = 'field-editor-modal';

  function rebuildModal() {
    bodyEl.innerHTML = '';
    const currentFields = cell.get('fields') || [];

    // Header row
    const hdr = document.createElement('div');
    hdr.className = 'df-field-modal__row df-field-modal__row--header';
    hdr.innerHTML = '<span class="df-field-modal__col--handle"></span><span class="df-field-modal__col--key">Key</span><span class="df-field-modal__col--api">API Name</span><span class="df-field-modal__col--label">Label</span><span class="df-field-modal__col--type">Type</span><span class="df-field-modal__col--len">Length</span><span class="df-field-modal__col--sample">Sample Values</span><span class="df-field-modal__col--req">REQUIRED</span><span class="df-field-modal__col--decom">DEPRECATED</span><span class="df-field-modal__col--del"></span>';
    bodyEl.appendChild(hdr);

    currentFields.forEach((field, i) => {
      const row = document.createElement('div');
      row.className = 'df-field-modal__row';
      row.dataset.index = i;

      // Reorder handle
      const handle = document.createElement('span');
      handle.className = 'df-field-modal__col--handle df-field-modal__handle';
      handle.innerHTML = '⠿';
      handle.draggable = true;
      handle.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
        row.classList.add('df-field-modal__row--dragging');
      });
      handle.addEventListener('dragend', () => row.classList.remove('df-field-modal__row--dragging'));

      // Key toggle
      const keyBtn = document.createElement('button');
      keyBtn.className = 'df-field-key df-field-key--' + (field.keyType || 'none') + ' df-field-modal__col--key';
      keyBtn.textContent = keyTypeLabel(field.keyType);
      keyBtn.title = 'Toggle key: None → PK → FK → FQK';
      keyBtn.addEventListener('click', () => {
        const updated = [...cell.get('fields')];
        // applyKeyType auto-marks required for PK/FQK (inherently mandatory keys).
        updated[i] = applyKeyType(updated[i], cycleKeyType(field.keyType));
        cell.set('fields', updated);
        resizeDataObjectToFit(cell);
        rebuildModal();
      });

      // API Name
      const apiInput = document.createElement('input');
      apiInput.type = 'text';
      apiInput.className = 'df-field-input df-field-modal__col--api';
      apiInput.value = field.apiName || '';
      apiInput.placeholder = 'API Name';
      apiInput.addEventListener('input', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], apiName: apiInput.value };
        cell.set('fields', updated);
      });

      // Label
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'df-field-input df-field-modal__col--label';
      labelInput.value = field.label || '';
      labelInput.placeholder = 'Label';
      labelInput.addEventListener('input', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], label: labelInput.value };
        cell.set('fields', updated);
      });

      // Type
      const typeSelect = document.createElement('select');
      typeSelect.className = 'df-field-input df-field-modal__col--type';
      const allTypes = SF_FIELD_TYPES.includes(field.type) ? SF_FIELD_TYPES : [field.type, ...SF_FIELD_TYPES].filter(Boolean);
      allTypes.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        if (t === field.type) opt.selected = true;
        typeSelect.appendChild(opt);
      });
      typeSelect.addEventListener('change', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], type: typeSelect.value };
        cell.set('fields', updated);
      });

      // Length
      const lenInput = document.createElement('input');
      lenInput.type = 'text';
      lenInput.className = 'df-field-input df-field-modal__col--len';
      lenInput.value = field.length || '';
      lenInput.placeholder = '—';
      lenInput.addEventListener('input', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], length: lenInput.value };
        cell.set('fields', updated);
      });

      // Sample values (optional) — representative example values for the field, surfaced in
      // the Data Mapping table view and CSV exports. Display/export-only: never drawn on the node.
      const sampleInput = document.createElement('input');
      sampleInput.type = 'text';
      sampleInput.className = 'df-field-input df-field-modal__col--sample';
      sampleInput.value = field.sampleValues || '';
      sampleInput.placeholder = 'e.g. Acme, Globex';
      sampleInput.addEventListener('input', () => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], sampleValues: sampleInput.value };
        cell.set('fields', updated);
      });

      // Required + Deprecated — Display-menu-style checkbox toggles (a tick that
      // appears when on), not raw browser checkboxes, for app-consistent styling.
      // A PK / FQK key is inherently required, so the toggle is checked AND locked for those keys
      // (the key type owns the value) — the old code left it unchecked-but-uncheckable, which was a bug.
      const reqLocked = keyImpliesRequired(field.keyType);
      const reqCheck = makeFieldCheckToggle(reqLocked || !!field.required, 'Required', 'df-field-modal__col--req', on => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], required: on };
        cell.set('fields', updated);
      }, reqLocked);
      const decomCheck = makeFieldCheckToggle(!!field.deprecated, 'Deprecated', 'df-field-modal__col--decom', on => {
        const updated = [...cell.get('fields')];
        updated[i] = { ...updated[i], deprecated: on };
        cell.set('fields', updated);
      });

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'df-field-delete df-field-modal__col--del';
      delBtn.textContent = '×';
      delBtn.title = 'Remove field';
      delBtn.addEventListener('click', () => {
        const updated = [...cell.get('fields')];
        updated.splice(i, 1);
        cell.set('fields', updated);
        resizeDataObjectToFit(cell);
        rebuildModal();
      });

      row.appendChild(handle);
      row.appendChild(keyBtn);
      row.appendChild(apiInput);
      row.appendChild(labelInput);
      row.appendChild(typeSelect);
      row.appendChild(lenInput);
      row.appendChild(sampleInput);
      row.appendChild(reqCheck);
      row.appendChild(decomCheck);
      row.appendChild(delBtn);

      // Drop zone for reorder — show indicator line above or below
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        // Determine if dropping above or below center of row
        const rect = row.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        // Clear previous indicators on all rows
        bodyEl.querySelectorAll('.df-field-modal__row').forEach(r => {
          r.classList.remove('df-field-modal__row--drop-above', 'df-field-modal__row--drop-below');
        });
        if (e.clientY < mid) {
          row.classList.add('df-field-modal__row--drop-above');
        } else {
          row.classList.add('df-field-modal__row--drop-below');
        }
      });
      row.addEventListener('dragleave', (e) => {
        // Only remove if leaving the row entirely
        if (!row.contains(e.relatedTarget)) {
          row.classList.remove('df-field-modal__row--drop-above', 'df-field-modal__row--drop-below');
        }
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const rect = row.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        const dropBelow = e.clientY >= mid;
        bodyEl.querySelectorAll('.df-field-modal__row').forEach(r => {
          r.classList.remove('df-field-modal__row--drop-above', 'df-field-modal__row--drop-below');
        });
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
        let toIdx = dropBelow ? i + 1 : i;
        if (fromIdx === toIdx || fromIdx + 1 === toIdx) { /* no-op: same position */ return; }
        const updated = [...cell.get('fields')];
        const [moved] = updated.splice(fromIdx, 1);
        // Adjust target index after removal
        if (fromIdx < toIdx) toIdx--;
        updated.splice(toIdx, 0, moved);
        cell.set('fields', updated);
        resizeDataObjectToFit(cell);
        rebuildModal();
      });

      bodyEl.appendChild(row);
    });
  }

  rebuildModal();

  // Add field
  overlay.querySelector('.df-field-modal__add').addEventListener('click', () => {
    const updated = [...cell.get('fields'), newField()];
    cell.set('fields', updated);
    resizeDataObjectToFit(cell);
    rebuildModal();
    // The "+ Add Field" button lives in the FOOTER (outside the scrolling body), so on a long list the new row
    // appends at the BOTTOM of the body, below the fold — reveal it + focus its API Name input to type into (CR).
    // Scroll the body directly to its end rather than newRow.scrollIntoView({behavior:'smooth'}): smooth
    // scrollIntoView on a NESTED scroll container doesn't land reliably on Firefox (the new row stayed below the
    // fold) and the animation outran the reveal. The new row is always last, so scrolling the body to the bottom is
    // instant + identical across engines. `preventScroll` on focus so it doesn't re-scroll.
    const rows = bodyEl.querySelectorAll('.df-field-modal__row:not(.df-field-modal__row--header)');
    const newRow = rows[rows.length - 1];
    if (newRow) {
      bodyEl.scrollTop = bodyEl.scrollHeight;
      newRow.querySelector('input')?.focus({ preventScroll: true });
    }
  });

  // Done closes; backdrop / ✕ / Escape are wired by buildModal.
  overlay.querySelector('.df-field-modal__done').addEventListener('click', close);

  // Import / Export Fields (CSV) — a persistent panel between the (rebuilt) field list
  // and the footer. Three exports/imports + a paste box; importing OVERWRITES every
  // field on this object (behind a confirmation), so the round-trip is: export →
  // edit in a spreadsheet → re-import.
  const dialog = overlay.querySelector('.df-field-modal__dialog');
  const footer = overlay.querySelector('.df-field-modal__footer');
  if (dialog && footer) {
    const objLabel = cell.get('objectName') || 'Object';
    const panel = document.createElement('details');
    panel.className = 'df-csv-tools';
    panel.innerHTML = `
      <summary class="df-csv-tools__summary">Import / Export Fields (CSV)</summary>
      <div class="df-csv-tools__body">
        <div class="df-csv-tools__row">
          <button type="button" class="df-modal__btn df-csv-tools__btn df-csv-tools__sample">Export Sample CSV</button>
          <button type="button" class="df-modal__btn df-csv-tools__btn df-csv-tools__export">Export Fields to CSV</button>
          <button type="button" class="df-modal__btn df-csv-tools__btn df-csv-tools__import-file">Import Fields from CSV…</button>
          <button type="button" class="df-modal__btn df-csv-tools__btn df-csv-tools__import-paste">Import Fields from Paste</button>
        </div>
        <textarea class="df-csv-tools__textarea" rows="4" spellcheck="false" placeholder="API Name,Label,Type,Length,Required,Deprecated,Key,Sample Values&#10;Id,Record ID,ID,,Yes,No,PK,003Ax00000ABCDE&#10;AccountId,Account,Lookup,,Yes,No,FK,001Ax00000XYZab&#10;Email__c,Email,Email,,No,No,,jane@example.com"></textarea>
        <p class="df-csv-tools__hint">Paste rows in the box above, then <strong>Import Fields from Paste</strong>. Columns: <strong>API&nbsp;Name, Label, Type, Length, Required, Deprecated, Key, Sample&nbsp;Values</strong> - a header row is auto-detected; importing <strong>overwrites every field</strong> on this object. Grab the Sample CSV for the full list of valid Type / Key values.</p>
        <span class="df-csv-tools__status" aria-live="polite"></span>
        <input type="file" accept=".csv,text/csv" class="df-csv-tools__file" hidden>
      </div>`;
    dialog.insertBefore(panel, footer);

    const status = panel.querySelector('.df-csv-tools__status');
    const ta = panel.querySelector('.df-csv-tools__textarea');
    const fileInput = panel.querySelector('.df-csv-tools__file');
    const setStatus = (msg, err) => { status.textContent = msg; status.classList.toggle('df-csv-tools__status--err', !!err); };

    // Import = OVERWRITE, behind a confirmation. The whole ingestion (field replace +
    // auto-resize) is wrapped in ONE explicit history batch so it collapses to a single
    // undo entry — flushPendingDragCommit folds the debounce-merged change:fields/size
    // into the open batch before it closes.
    const doImport = async (text) => {
      const parsed = parseBulkFields(text);
      if (!parsed.length) { setStatus('No valid rows found - check the format (see Sample CSV).', true); return; }
      const prevCount = (cell.get('fields') || []).length;
      const ok = await confirmModal({
        title: 'Overwrite fields?',
        message: `This replaces all ${prevCount} field${prevCount === 1 ? '' : 's'} on “${objLabel}” with ${parsed.length} imported field${parsed.length === 1 ? '' : 's'}. You can undo it afterwards.`,
        okLabel: 'Overwrite',
        cancelLabel: 'Cancel',
        tone: 'danger',
      });
      if (!ok) { setStatus('Import cancelled.'); return; }
      history.startBatch();
      try {
        cell.set('fields', parsed);              // OVERWRITE the whole field list
        resizeDataObjectToFit(cell);
        history.flushPendingDragCommit();        // fold field + size changes into this batch
      } finally {
        history.endBatch();
      }
      ta.value = '';
      setStatus(`Imported ${parsed.length} field${parsed.length === 1 ? '' : 's'} (replaced ${prevCount}).`);
      rebuildModal();
    };

    // Filesystem-safe, cross-platform filenames (df_ prefix; `_` between sections, `-`
    // within — tab + object names normalised via sanitizeFilenamePart).
    const tabPart = sanitizeFilenamePart(getActiveTabName(), 'tab');
    const objPart = sanitizeFilenamePart(objLabel, 'object');
    panel.querySelector('.df-csv-tools__sample').addEventListener('click', () => downloadCsv('df_object-sample.csv', buildSampleFieldsCsv()));
    panel.querySelector('.df-csv-tools__export').addEventListener('click', () => downloadCsv(`df_${tabPart}_${objPart}_fields.csv`, fieldsToCsv(cell.get('fields') || [])));
    panel.querySelector('.df-csv-tools__import-file').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { doImport(String(reader.result || '')); fileInput.value = ''; };
      reader.onerror = () => { setStatus('Could not read that file.', true); fileInput.value = ''; };
      reader.readAsText(file);
    });
    panel.querySelector('.df-csv-tools__import-paste').addEventListener('click', () => {
      if (!ta.value.trim()) { setStatus('Paste some CSV rows first.', true); return; }
      doImport(ta.value);
    });
  }
}

// Field ↔ CSV columns (the full set the editor exposes), in a fixed order shared by
// the Sample, Export, and Import paths.
export const FIELD_CSV_COLUMNS = ['API Name', 'Label', 'Type', 'Length', 'Required', 'Deprecated', 'Key', 'Sample Values'];
export const csvCell = v => { const s = String(v ?? '').trim(); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const keyToCsv = k => k === 'pk' ? 'PK' : k === 'fk' ? 'FK' : k === 'fqk' ? 'FQK' : '';

export function fieldsToCsv(fields) {
  const rows = (fields || []).map(f => [
    f.apiName || '', f.label || '', f.type || '', f.length || '',
    f.required ? 'Yes' : 'No', f.deprecated ? 'Yes' : 'No', keyToCsv(f.keyType), f.sampleValues || '',
  ]);
  return '﻿' + [FIELD_CSV_COLUMNS, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}

// A documentation-grade template: canonical PK/FK/FQK rows up top, then one row per
// remaining Salesforce field type so every valid Type value is spelled out, plus a
// Required + a Deprecated example.
export function buildSampleFieldsCsv() {
  const canonical = [
    ['Id', 'Record ID', 'ID', '', 'Yes', 'No', 'PK', '003Ax00000ABCDE'],
    ['AccountId', 'Account', 'Lookup', '', 'Yes', 'No', 'FK', '001Ax00000XYZab'],
    ['UnifiedId__c', 'Unified Profile Key', 'Text', '255', 'No', 'No', 'FQK', 'john.doe@example.com'],
  ];
  const used = new Set(canonical.map(r => r[2]));
  const rest = SF_FIELD_TYPES.filter(t => !used.has(t)).map(t => {
    const api = t.replace(/[^a-z0-9]+/gi, '') + '__c';
    const len = /text|char|area/i.test(t) ? '255' : '';
    return [api, `${t} Example`, t, len, 'No', 'No', '', ''];
  });
  const all = [...canonical, ...rest];
  if (all.length) all[all.length - 1][5] = 'Yes';   // last row demonstrates Deprecated
  return '﻿' + [FIELD_CSV_COLUMNS, ...all].map(r => r.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(URL.createObjectURL(blob), filename);
}

// Parse a CSV/TSV block into a FULL replacement field list. Delimiter = tab if any
// line has one, else comma. A header row (first cell is a known header token) maps
// columns by name; otherwise positional API Name, Label, Type, Length, Required,
// Deprecated, Key. Type falls back to the first cell that reads as a known SF
// type (then Text); Required/Deprecated accept Yes/true/1/x. Fresh fids per row.
export function parseBulkFields(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return out;
  const delim = lines.some(l => l.includes('\t')) ? '\t' : ',';
  const split = l => l.split(delim).map(s => s.trim());
  const typeOf = v => SF_FIELD_TYPES.find(t => t.toLowerCase() === String(v).toLowerCase());
  const keyOf = v => {
    const k = String(v).toLowerCase().trim();
    if (k === 'pk' || /primary/.test(k)) return 'pk';
    if (k === 'fk' || /foreign/.test(k)) return 'fk';
    if (k === 'fqk' || /qualified/.test(k)) return 'fqk';
    return null;
  };
  const truthy = v => /^(y|yes|true|1|x|✓)$/i.test(String(v).trim());

  const firstLower = split(lines[0]).map(s => s.toLowerCase());
  const HEADER_FIRST = ['api name', 'api_name', 'apiname', 'api', 'name', 'field', 'field name', 'field api name'];
  let start = 0;
  let map = { api: 0, label: 1, type: 2, length: 3, required: 4, decom: 5, key: 6, sample: 7 };   // positional default
  if (HEADER_FIRST.includes(firstLower[0])) {
    start = 1;
    const find = re => firstLower.findIndex(h => re.test(h));
    map = {
      api: Math.max(0, find(/api|^name$|^field/)),
      label: find(/label|display/),
      type: find(/type/),
      length: find(/len/),
      required: find(/req/),
      decom: find(/deprecat|decom/),   // new "Deprecated" header + legacy "Decommissioned"
      key: find(/key|pk|fk|fqk/),
      sample: find(/sample|example/),
    };
  }

  const seen = new Set();
  for (let i = start; i < lines.length; i++) {
    const cols = split(lines[i]);
    const api = sanitizeFieldValue((map.api >= 0 ? cols[map.api] : cols[0]) || '');
    if (!api) continue;
    let type = (map.type >= 0 ? typeOf(cols[map.type]) : null) || '';
    if (!type) { for (let j = 0; j < cols.length; j++) { if (j === map.api) continue; const m = typeOf(cols[j]); if (m) { type = m; break; } } }
    if (!type) type = 'Text';
    const label = sanitizeFieldValue((map.label >= 0 && cols[map.label]) ? cols[map.label] : api);
    const length = sanitizeFieldValue((map.length >= 0 && cols[map.length]) ? cols[map.length] : '', 32);
    const deprecated = map.decom >= 0 ? truthy(cols[map.decom]) : false;
    let keyType = map.key >= 0 ? keyOf(cols[map.key]) : null;
    if (!keyType) { for (let j = 0; j < cols.length; j++) { const k = keyOf(cols[j]); if (k) { keyType = k; break; } } }
    // A PK / FQK is inherently mandatory; otherwise honour the Required column.
    const required = keyImpliesRequired(keyType) ? true : (map.required >= 0 ? truthy(cols[map.required]) : false);
    const sampleValues = sanitizeFieldValue((map.sample >= 0 && cols[map.sample]) ? cols[map.sample] : '');
    const fid = newFid(seen); seen.add(fid);   // stable synthetic identity per imported row
    out.push({ label, apiName: api, type, keyType, length, required, deprecated, sampleValues, fid });
  }
  return out;
}

// Sanitise a pasted/imported field string — parity with sanitizeGraphJSON for untrusted
// input: drop control + zero-width chars, neutralise script-bearing URIs, trim, and cap
// length so a hostile paste can't inject markup, bloat the model, or break the renderer.
export function sanitizeFieldValue(s, maxLen = 255) {
  let v = String(s ?? '').replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '');
  if (/^\s*(javascript|vbscript)\s*:|^\s*data\s*:\s*text\/html/i.test(v)) v = '';
  v = v.trim();
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

// Organisation-diagram property renderers (CLEANUP S2, slice 9) — renderOrgPersonProps (avatar / detail lines /
// tags / RACI / vacancy) + renderTaskProps. Build via the widget builders + finishStandardProps (render-core),
// reading graph/paper/selection + the panel DOM refs via prctx; never imports the facade. The showProperties()
// dispatch imports both back.
import { prctx } from './context.js?v=1.19.4.4';
import { finishStandardProps } from './render-core.js?v=1.19.4.4';
import { addChipInput, addColor, addNumber, addRaciPicker, addText, addTextarea, addToggle, section } from './widgets.js?v=1.19.4.4';

export function renderOrgPersonProps(cell) {
  // Content (uniform section name across all shapes; stored fields keep their
  // historical prop names for back-compat — `personName`, `jobTitle`).
  const info = section(prctx.bodyEl, 'Content');
  addText(info, 'Label', cell.get('personName') || '', v => {
    cell.set('personName', v);
    prctx.titleEl.textContent = v || '';
  });
  // Description (multi-line) backed by `jobTitle` for back-compat. Placeholder
  // hints at the typical use ("job title") while leaving room for a project
  // role, team name, or any other short secondary label per user preference.
  addTextarea(info, 'Description', cell.get('jobTitle') || '',
    v => cell.set('jobTitle', v),
    { placeholder: 'job title' });

  // Mark-as-vacant toggle — dashed borders + faded text mark the card as a
  // recruitment placeholder or unassigned RACI slot. Lives in Content (a
  // status flag, not an aesthetic choice) immediately below Description so
  // the Appearance section stays exclusively about design tokens.
  addToggle(info, 'Mark as vacant', !!cell.get('vacant'),
    v => cell.set('vacant', v));

  // Tags — comma-separated chips at the bottom of the card
  addChipInput(info, 'Tags', cell.get('tags') || [], v => cell.set('tags', v));

  // RACI multi-pick — coloured pills in the top-right corner of the card
  addRaciPicker(info, 'RACI', cell.get('raci') || {}, v => cell.set('raci', v));

  // Image / Avatar section
  const imageSec = section(prctx.bodyEl, 'Image');

  // Icon Text input (up to 4 characters)
  addText(imageSec, 'Icon text', cell.get('iconText') || '', v => {
    cell.set('iconText', v.substring(0, 4));
  });

  // Photo upload
  const photoField = document.createElement('div');
  photoField.className = 'df-prop-field';
  const photoLabel = document.createElement('div');
  photoLabel.className = 'df-properties__label';
  photoLabel.textContent = 'Photo';

  const photoControls = document.createElement('div');
  photoControls.className = 'df-prop-pair';

  const hasImage = !!cell.get('imageUrl');

  const ICON_UPLOAD = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v10M3 8h10"/></svg>`;
  const ICON_CHANGE = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4h11l-3-3M15 12H4l3 3"/></svg>`;
  const ICON_REMOVE = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h10M6 4V2.5A.5.5 0 016.5 2h3a.5.5 0 01.5.5V4M4.5 4l.5 9.5h6l.5-9.5"/></svg>`;

  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'df-properties__btn df-properties__btn--order';
  uploadBtn.innerHTML = hasImage ? `${ICON_CHANGE} Change` : `${ICON_UPLOAD} Upload`;

  const clearBtn = document.createElement('button');
  clearBtn.className = 'df-properties__btn df-properties__btn--order';
  clearBtn.innerHTML = `${ICON_REMOVE} Remove`;

  // Full-width upload when no image, 50/50 pair when image exists
  function updatePhotoLayout(show) {
    if (show) {
      photoControls.style.gridTemplateColumns = '1fr 1fr';
      clearBtn.style.display = '';
    } else {
      photoControls.style.gridTemplateColumns = '1fr';
      clearBtn.style.display = 'none';
    }
  }
  updatePhotoLayout(hasImage);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      cell.set('imageUrl', reader.result);
      uploadBtn.innerHTML = `${ICON_CHANGE} Change`;
      updatePhotoLayout(true);
    };
    reader.readAsDataURL(file);
  });

  uploadBtn.addEventListener('click', () => fileInput.click());
  clearBtn.addEventListener('click', () => {
    cell.set('imageUrl', '');
    uploadBtn.innerHTML = `${ICON_UPLOAD} Upload`;
    updatePhotoLayout(false);
  });

  photoControls.appendChild(uploadBtn);
  photoControls.appendChild(clearBtn);
  photoControls.appendChild(fileInput);
  photoField.appendChild(photoLabel);
  photoField.appendChild(photoControls);
  imageSec.appendChild(photoField);

  // Extensible details list — each entry is `{ label, value }`. Cells from
  // pre-v1.11 stored values on top-level fields (`email`/`phone`/...); the
  // OrgPersonView migrates those into `details` on first render so by the
  // time we see the cell here the array is populated. We still fall back to
  // a legacy build here in case the user opens the panel before the view's
  // render-side migration kicks in.
  const DEFAULT_DETAIL_LABELS = ['Email', 'Phone', 'Role', 'Stream', 'Location', 'Company'];
  const LEGACY_KEYS = { Email: 'email', Phone: 'phone', Role: 'role', Stream: 'stream', Location: 'location', Company: 'company' };

  const initialDetails = (() => {
    const stored = cell.get('details');
    if (Array.isArray(stored) && stored.length > 0) {
      return stored.map(d => ({ label: String(d?.label ?? ''), value: String(d?.value ?? '') }));
    }
    // Legacy migration fallback — order respects `detailOrder` if present.
    const order = cell.get('detailOrder') || ['email', 'phone', 'role', 'stream', 'location', 'company'];
    const labelByKey = { email: 'Email', phone: 'Phone', role: 'Role', stream: 'Stream', location: 'Location', company: 'Company' };
    return order.map(k => ({ label: labelByKey[k] || k, value: cell.get(k) || '' }));
  })();

  // Working copy — committed back to the cell on every mutation.
  let detailsState = [...initialDetails];
  const commitDetails = () => {
    // Mirror values back to legacy fields where the label matches a known
    // key, so cells saved by 1.11+ still degrade gracefully if loaded by an
    // older version that only knows about the hardcoded fields.
    cell.set('details', detailsState.map(d => ({ ...d })));
    for (const lbl of DEFAULT_DETAIL_LABELS) {
      const legacyKey = LEGACY_KEYS[lbl];
      const match = detailsState.find(d => d.label === lbl);
      cell.set(legacyKey, match ? match.value : '');
    }
  };

  const detailSec = section(prctx.bodyEl, 'Details');

  function buildDetailList() {
    detailSec.querySelectorAll('.df-detail-row, .df-detail-add').forEach(r => r.remove());

    detailsState.forEach((entry, idx) => {
      const row = document.createElement('div');
      row.className = 'df-detail-row';
      row.draggable = true;
      row.dataset.idx = String(idx);

      // Drag handle
      const handle = document.createElement('span');
      handle.className = 'df-detail-row__handle';
      handle.innerHTML = '⠿';
      handle.title = 'Drag to reorder';
      row.appendChild(handle);

      // Label input — plain text, freely editable
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'df-properties__input df-detail-row__label-input';
      labelInput.value = entry.label;
      labelInput.placeholder = 'Label';
      labelInput.addEventListener('input', () => {
        detailsState[idx].label = labelInput.value;
        commitDetails();
      });
      row.appendChild(labelInput);

      // Value input
      const valueInput = document.createElement('input');
      valueInput.type = 'text';
      valueInput.className = 'df-properties__input';
      valueInput.value = entry.value;
      valueInput.placeholder = 'Value';
      valueInput.addEventListener('input', () => {
        detailsState[idx].value = valueInput.value;
        commitDetails();
      });
      row.appendChild(valueInput);

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'df-detail-row__remove';
      removeBtn.innerHTML = '×';
      removeBtn.title = 'Remove';
      removeBtn.addEventListener('click', () => {
        detailsState.splice(idx, 1);
        commitDetails();
        buildDetailList();
      });
      row.appendChild(removeBtn);

      // Drag-and-drop to reorder
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('df-detail-row--dragging');
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('df-detail-row--dragging');
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('df-detail-row--over');
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('df-detail-row--over');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('df-detail-row--over');
        const draggingEl = detailSec.querySelector('.df-detail-row--dragging');
        if (!draggingEl || draggingEl === row) return;
        const fromIdx = parseInt(draggingEl.dataset.idx, 10);
        const toIdx = parseInt(row.dataset.idx, 10);
        if (Number.isNaN(fromIdx) || Number.isNaN(toIdx)) return;
        const [moved] = detailsState.splice(fromIdx, 1);
        detailsState.splice(toIdx, 0, moved);
        commitDetails();
        buildDetailList();
      });

      detailSec.appendChild(row);
    });

    // + Add detail button
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'df-properties__btn df-properties__btn--auto-size df-detail-add';
    addBtn.style.marginTop = '6px';
    addBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>
      Add detail`;
    addBtn.addEventListener('click', () => {
      detailsState.push({ label: '', value: '' });
      commitDetails();
      buildDetailList();
      // Focus the new label input so the user starts typing immediately
      const rows = detailSec.querySelectorAll('.df-detail-row');
      const last = rows[rows.length - 1];
      last?.querySelector('.df-detail-row__label-input')?.focus();
    });
    detailSec.appendChild(addBtn);
  }
  buildDetailList();

  // Appearance — design tokens only (the vacant toggle moved to Content
  // above, since it's a status flag rather than a colour choice).
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Accent', cell.attr('accentBar/fill') || '#1D73C9', v => {
    cell.attr('accentBar/fill', v);
    cell.attr('accentBarMask/fill', v);
  }, { defaultValue: '#1D73C9' });

  // OrgPerson keeps its bespoke Auto Size (reset height to 1 → the view's _updateCard auto-heights it).
  finishStandardProps(cell, {
    sizeMode: 'pair',
    autoSize: true,
    applySize: true,
  });
}

export function renderTaskProps(cell) {
  // Content — primary text only.
  const content = section(prctx.bodyEl, 'Content');
  addText(content, 'Label', cell.get('taskName') || '', v => {
    cell.set('taskName', v);
    prctx.titleEl.textContent = v || '';
  });
  addTextarea(content, 'Description', cell.get('taskDescription') || '',
    v => cell.set('taskDescription', v));

  // Appearance
  const appearance = section(prctx.bodyEl, 'Appearance');
  addColor(appearance, 'Fill', cell.attr('body/fill') || 'var(--node-bg)',
    v => cell.attr('body/fill', v));
  addColor(appearance, 'Border', cell.attr('body/stroke') || 'var(--node-border)',
    v => cell.attr('body/stroke', v));

  // Description width (a fixed left-column width; the right column absorbs resize) lives in Size & Order alongside
  // Width/Height. Min clamp of 120 px is enforced inside `_effectiveDescWidth` on the shape side.
  finishStandardProps(cell, { sizeMode: 'pair', sizeExtras: (s) => {
    addNumber(s, 'Description width', cell.get('descriptionWidth') ?? 260, v => cell.set('descriptionWidth', Math.max(120, v)));
  } });
}

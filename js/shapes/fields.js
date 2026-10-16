// DataObject field helpers (CLEANUP S3) — the stable-fid machinery + the visible-fields rule, moved out of
// shapes.js so the data-object registrar (and the external importers via the facade re-export) share one copy.
import { sctx } from './context.js?v=1.26.3';

// ── Stable field identity (fid) ────────────────────────────────────
// Pre-1.15.0, sf.DataObject field ports were keyed by ARRAY INDEX
// (`field-left-2`), so reordering or deleting a field silently re-bound any
// connected link to whatever field then occupied that index. Each field now
// carries an immutable `fid`; ports are `field-left-<fid>` / `field-right-<fid>`
// so a link follows its field across reorder / delete / apiName rename. A fid
// only needs to be unique WITHIN one DataObject (port IDs are cell-scoped), so
// duplicated objects may safely share fids. The leading 'f' keeps a minted fid
// from ever matching the legacy numeric-index form, which lets the load migration
// (migration.js) distinguish old positional ports from new fid ports. A
// hand-authored fid can be all digits ("1"); the migration leaves a port alone
// when a field owns that fid.
//
// INVARIANT: every field must have a fid before its ports are built. Guaranteed
// by sf.DataObject.initialize (construction: load / paste / factory) and
// re-asserted in DataObjectView._syncFieldPorts (covers fields added later via
// the editor). Any NEW field-creation path can rely on one of those two.
export function newFid(existing) {
  let id;
  do { id = 'f' + Math.random().toString(36).slice(2, 9); } while (existing && existing.has(id));
  return id;
}

// Also heals hand-authored JSON (K3, 2026-10-15): a REPEATED fid builds two ports with one id, which JointJS rejects
// ("found id duplicities in ports") and the diagram cannot open. The first field keeps the fid, so links stay on
// it; a repeat gets a fresh one. A non-object entry is dropped and a non-array `fields` becomes [], since either
// throws in the view. A clean list is not rewritten.
export function ensureFieldFids(cell) {
  const raw = cell.get('fields');
  if (raw == null) return;
  const fields = Array.isArray(raw) ? raw : [];
  const taken = new Set(fields.filter(f => f && typeof f === 'object' && f.fid).map(f => String(f.fid)));
  const used = new Set();
  let changed = fields !== raw;
  const out = [];
  for (const f of fields) {
    if (!f || typeof f !== 'object') { changed = true; continue; }
    if (f.fid && !used.has(String(f.fid))) { used.add(String(f.fid)); out.push(f); continue; }
    const id = newFid(taken); taken.add(id); used.add(id);
    out.push({ ...f, fid: id });
    changed = true;
  }
  if (changed) cell.set('fields', out, { silent: true });
}

// Does a field have a live link on either of its ports? Drives "Show Only Mapped"
// — connected fields stay visible so collapsing the rest never breaks a link.
export function fieldHasLink(model, field) {
  const graph = model.graph;
  if (!graph || !field || !field.fid) return false;
  const left = `field-left-${field.fid}`, right = `field-right-${field.fid}`;
  for (const link of graph.getConnectedLinks(model)) {
    for (const end of ['source', 'target']) {
      const ep = link.get(end);
      if (ep && ep.id === model.id && (ep.port === left || ep.port === right)) return true;
    }
  }
  return false;
}

// Does a field carry a MAPPING link (linkKind 'mapping')? Drives the header's X/Y counter. A join between two source
// tables is a grey relationship link on the same field ports (SQL Studio's lineage, 2026-10-16): counted as mapped, a
// table that is only joined read 1/1, where 0/1 told the reader it feeds no column. Visibility keeps fieldHasLink.
export function fieldHasMappingLink(model, field) {
  const graph = model.graph;
  if (!graph || !field || !field.fid) return false;
  const left = `field-left-${field.fid}`, right = `field-right-${field.fid}`;
  for (const link of graph.getConnectedLinks(model)) {
    if (link.get('linkKind') !== 'mapping') continue;
    for (const end of ['source', 'target']) {
      const ep = link.get(end);
      if (ep && ep.id === model.id && (ep.port === left || ep.port === right)) return true;
    }
  }
  return false;
}

// The fields a DataObject currently renders — rows, ports, and height all agree on
// this single list:
//   • keyFieldsOnly off             → every field
//   • keyFieldsOnly on + mapping ON → mapped fields PLUS key (PK/FK) fields
//     ("Show Only Mapped": unmapped non-key rows collapse, but keys stay as
//     structural anchors so the object keeps context — and any field with a live
//     link always stays, so no JointJS link is ever destroyed)
//   • keyFieldsOnly on + mapping off → only PK/FK fields ("Key Fields Only")
export function getVisibleDataObjectFields(model) {
  const fields = model.get('fields') || [];
  if (!model.get('keyFieldsOnly')) return fields;
  const mapping = !!(sctx.mappingModeGetter && sctx.mappingModeGetter());
  return mapping
    ? fields.filter(f => f && (fieldHasLink(model, f) || f.keyType))
    : fields.filter(f => f && f.keyType);
}

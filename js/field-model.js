// DataObject field model (CLEANUP V2) — the single source for the pure per-field rules that were duplicated
// across the three field-editing surfaces (the properties-panel inline editor, the "Edit in Table" modal, and
// the Data Model table view) plus the CSV importer. Zero-dep leaf: no DOM, no graph — just the field rules, so
// it is unit-tested directly (dev/tests/field-model.test.js).
//
// A DataObject field is { label, apiName, type, keyType, required, length, sampleValues, deprecated, fid }.
// `keyType` is one of null | 'pk' | 'fk' | 'fqk' (Primary / Foreign / Fully-Qualified key).

/** Does this key type make the field inherently mandatory? A PK or FQK is a mandatory identifier, so it is
 *  ALWAYS required / not-nullable. This one rule was inlined ~9 times (panel/modal/import + the table view's
 *  toggle, nullable-lock, and Nullable derivations); a change had to be made in every copy. */
export function keyImpliesRequired(keyType) {
  return keyType === 'pk' || keyType === 'fqk';
}

/** The key-toggle cycle used by the panel + modal key button: None → PK → FK → FQK → None. */
export function cycleKeyType(cur) {
  return cur === 'pk' ? 'fk' : cur === 'fk' ? 'fqk' : cur === 'fqk' ? null : 'pk';
}

/** The short badge label for a key type (the key button's text). */
export function keyTypeLabel(keyType) {
  return keyType === 'pk' ? 'PK' : keyType === 'fk' ? 'FK' : keyType === 'fqk' ? 'FQK' : '—';
}

/** Apply a key-type change to a field, returning a NEW field object. Sets `required: true` when the new key type
 *  implies it (PK/FQK) — the maintainer-locked rule that a key is always required. Leaves `required` unchanged
 *  for FK/None (a field can be required or not independently of being a plain foreign key). */
export function applyKeyType(field, next) {
  return { ...field, keyType: next, ...(keyImpliesRequired(next) ? { required: true } : {}) };
}

/** A fresh blank field for the "+ Add Field" action — one default so the panel and modal can't drift (the modal
 *  copy had silently dropped `sampleValues`). Returns a new object each call (never a shared mutable literal). */
export function newField() {
  return { label: '', apiName: '', type: 'Text', keyType: null, length: '', sampleValues: '' };
}

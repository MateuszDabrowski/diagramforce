// Custom JointJS shapes for SF Diagrams — FACADE (CLEANUP S3, split COMPLETE).
// All shapes are under the `sf` namespace (net-new shapes use `df`); JointJS v4 JSON markup array syntax.
// The ~5000-line register() is now six per-type registrar leaves in js/shapes/; register() calls them in order
// (registerCore FIRST — the first define creates joint.shapes.sf/df). The shared cross-block deps live in
// js/shapes/{ports,context,markdown-fo,fields}.js. This facade keeps only: the app.js-wired getter setters
// (written into sctx), the field-helper re-exports (so components/canvas/properties/field-editor import them from
// shapes.js unchanged), and the register() orchestrator.

import { sctx } from './shapes/context.js?v=1.19.3.8';
import { registerCore } from './shapes/core.js?v=1.19.3.8';
import { registerBpmnFlow } from './shapes/bpmn-flow.js?v=1.19.3.8';
import { registerDataObject } from './shapes/data-object.js?v=1.19.3.8';
import { registerGantt } from './shapes/gantt.js?v=1.19.3.8';
import { registerOrg } from './shapes/org.js?v=1.19.3.8';
import { registerTaskSequence } from './shapes/task-sequence.js?v=1.19.3.8';

// Data Cloud mapping mode / undo batcher / auto-fit getters — wired from app.js, written into the shapes runtime
// context (sctx) so the DataObject registrar reads them via sctx.*. The field helpers live in shapes/fields.js;
// re-exported here so components.js / canvas/migration.js / properties.js / field-editor.js keep importing them
// from shapes.js unchanged.
export function setMappingModeGetter(fn) { sctx.mappingModeGetter = fn; }
export function setDataObjectHistoryBatcher(fn) { sctx.dataObjectHistoryBatcher = fn; }
export function setAutoFitGetter(fn) { sctx.autoFitGetter = fn; }
export { newFid, ensureFieldFids, getVisibleDataObjectFields } from './shapes/fields.js?v=1.19.3.8';

// Register every custom shape + view. registerCore MUST run first (its first define creates the joint.shapes.sf /
// joint.shapes.df namespaces that every later View attachment reads).
export function register() {
  registerCore();
  registerBpmnFlow();
  registerDataObject();
  registerGantt();
  registerOrg();
  registerTaskSequence();
}

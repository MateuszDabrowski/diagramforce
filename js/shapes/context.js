// shapes.js runtime context (CLEANUP S3) — the three app.js-wired getters the DataObject shapes read, moved out
// of shapes.js module scope so the per-type registrar leaves can reach them without importing the facade back.
// The facade's set*Getter() functions write these; the leaves read sctx.* at CALL time (acyclic, like prctx/pctx).
export const sctx = { mappingModeGetter: null, dataObjectHistoryBatcher: null, autoFitGetter: null };

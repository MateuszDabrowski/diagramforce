// Diagram-schema leaf — ZERO-dependency, no DOM, no JointJS. The single source of truth for what the loader accepts,
// plus a PURE validator the dev CLI runs (dev/scripts/validate-diagram.mjs) so an LLM-authored diagram can be checked
// BEFORE it ships, surfacing the failures the app heals/drops silently on load. json-pipeline.js imports the
// ALLOWED_CELL_TYPES + MAX_CELL_COUNT from here so the app and the validator can never drift. The validator REPORTS;
// it never reconstructs (the loader already rebuilds ports / re-routes / re-lays-out on load).

// Cap mirrored from the loader (sanitizeGraphJSON throws above this).
export const MAX_CELL_COUNT = 2000;

// Every cell `type` the app will render. A cell with any other type is SILENTLY DROPPED on load (a deliberate
// security choice - a noisy error would let an attacker probe the allowlist), which is exactly the one failure an
// author can't see without this validator.
export const ALLOWED_CELL_TYPES = new Set([
  // Architecture
  'sf.SimpleNode', 'sf.Container', 'sf.Zone', 'sf.TextLabel', 'sf.Note',
  'sf.Annotation', 'sf.Image', 'sf.Link', 'sf.Line', 'sf.Task',
  // BPMN / Process
  'sf.BpmnEvent', 'sf.BpmnTask', 'sf.BpmnGateway', 'sf.BpmnSubprocess',
  'sf.BpmnLoop', 'sf.BpmnPool', 'sf.BpmnDataObject',
  // Flow
  'sf.FlowProcess', 'sf.FlowDecision', 'sf.FlowTerminator', 'sf.FlowDatabase',
  'sf.FlowDocument', 'sf.FlowIO', 'sf.FlowPredefined', 'sf.FlowOffPage',
  // Data Model
  'sf.DataObject',
  // Org Chart
  'sf.OrgPerson',
  // sf.TaskGroup (RACI section grouper, registered in shapes.js since v1.15) was MISSING from the loader allowlist,
  // so a saved org diagram containing one had that cell silently dropped on load. Added here (the loader imports this
  // set) to close that gap - the allowlist's own contract is to mirror the shapes registered in shapes.js.
  'sf.TaskGroup',
  // Gantt
  'sf.GanttTask', 'sf.GanttMilestone', 'sf.GanttMarker', 'sf.GanttTimeline',
  'sf.GanttGroup',
  // Sequence
  'sf.SequenceParticipant', 'sf.SequenceActor', 'sf.SequenceActivation',
  'sf.SequenceFragment',
  // Flow (Salesforce Flow elements; net-new df.* — distinct from the legacy sf.Flow* flowchart family above)
  'df.FlowStart', 'df.FlowEnd', 'df.FlowScreen', 'df.FlowAction', 'df.FlowSubflow',
  'df.FlowSendToFlow', 'df.FlowSendEmail', 'df.FlowSendSms', 'df.FlowSendWhatsApp',
  'df.FlowSendToData360', 'df.FlowSendMobileApp', 'df.FlowSendMobileInApp', 'df.FlowForwardToBot',
  'df.FlowRunAgent', 'df.FlowCreateCampaignMember', 'df.FlowCreateTask', 'df.FlowExit',
  'df.FlowAssignment', 'df.FlowDecision', 'df.FlowLoop', 'df.FlowTransform', 'df.FlowPathExperiment',
  'df.FlowCollectionSort', 'df.FlowCollectionFilter',
  'df.FlowWait', 'df.FlowWaitUntilDate', 'df.FlowWaitUntilEvent',
  'df.FlowEinsteinDecision', 'df.FlowDetermineCrmRecord',
  'df.FlowGetRecords', 'df.FlowCreateRecords', 'df.FlowUpdateRecords', 'df.FlowDeleteRecords',
  'df.FlowRollback',
  // Generic (df.* net-new shapes; sf.* legacy kept for save back-compat)
  'df.Pill', 'df.Legend', 'df.Table',
  // JointJS link
  'standard.Link',
]);

const VALID_DIAGRAM_TYPES = new Set(['architecture', 'process', 'datamodel', 'datamapping', 'org', 'gantt', 'sequence', 'flow']);
// Aliases the loader normalises (kept lenient).
const DIAGRAM_TYPE_ALIASES = { data: 'datamodel', datamodel: 'datamodel', organisation: 'org', organization: 'org', mapping: 'datamapping', salesforceflow: 'flow', flowbuilder: 'flow', sfflow: 'flow' };

/** The diagram type(s) a TYPE-SPECIFIC shape belongs to. Cross-type generics (Note/TextLabel/Line/Image/Pill/Legend/
 *  Table/Link/Container/Zone/SimpleNode/Annotation/Task) return null - they're valid anywhere, so no warning. */
export function shapeHomeTypes(cellType) {
  if (typeof cellType !== 'string') return null;
  if (cellType.startsWith('sf.Bpmn') || cellType.startsWith('sf.Flow')) return ['process'];
  if (cellType.startsWith('df.Flow')) return ['flow'];   // net-new Salesforce Flow elements (distinct namespace from sf.Flow*)
  if (cellType === 'sf.DataObject') return ['datamodel', 'datamapping'];
  if (cellType === 'sf.OrgPerson') return ['org'];
  if (cellType.startsWith('sf.Gantt')) return ['gantt'];
  if (cellType.startsWith('sf.Sequence')) return ['sequence'];
  return null;
}

const isLink = (c) => c && typeof c === 'object' && c.source != null && c.target != null;

/**
 * Validate ONE diagram envelope. Pure - no I/O, no DOM. Reads cells from `diagram.graph.cells` (canonical) or
 * `diagram.cells` (bare graph). Returns { errors, warnings } as arrays of plain strings. ERRORS are things the loader
 * drops/throws on (the diagram won't import as authored); WARNINGS are best-practice / silent-degrade issues.
 */
export function validateDiagram(diagram) {
  const errors = [];
  const warnings = [];
  if (!diagram || typeof diagram !== 'object') return { errors: ['Top level is not a JSON object.'], warnings };

  const cells = Array.isArray(diagram.graph?.cells) ? diagram.graph.cells
    : Array.isArray(diagram.cells) ? diagram.cells : null;
  if (!cells) return { errors: ['Missing cells array (expected `graph.cells` or `cells`).'], warnings };

  if (cells.length > MAX_CELL_COUNT) errors.push(`Too many cells: ${cells.length} > ${MAX_CELL_COUNT} (load THROWS).`);

  // diagramType (the loader falls back to `architecture` when missing/unknown, silently disabling type-gated UI).
  const rawType = diagram.diagramType;
  const type = DIAGRAM_TYPE_ALIASES[rawType] || rawType;
  if (rawType == null) warnings.push('Missing `diagramType` - the diagram opens as "architecture", hiding the type-specific stencil + controls.');
  else if (!VALID_DIAGRAM_TYPES.has(type)) warnings.push(`Unknown diagramType "${rawType}" - opens as "architecture". Use one of: ${[...VALID_DIAGRAM_TYPES].join(', ')}.`);
  if (diagram.appVersion == null) warnings.push('Missing `appVersion` - set it to the current app version so the version-warning logic behaves.');

  const ids = new Set();
  const seen = new Set();
  const byId = new Map();   // id -> cell (first occurrence) - powers the reciprocity / field-port checks below.
  // First pass: collect valid cell ids (for the dangling-link check) + structural/allowlist/dup checks.
  for (const c of cells) {
    if (!c || typeof c !== 'object') { errors.push('A cell is not an object (dropped on load).'); continue; }
    const id = c.id;
    const ct = c.type;
    if (typeof id !== 'string' || !id) errors.push(`Cell missing a string \`id\` (type ${JSON.stringify(ct)}).`);
    else { if (seen.has(id)) errors.push(`Duplicate cell id "${id}".`); else byId.set(id, c); seen.add(id); ids.add(id); }
    if (typeof ct !== 'string' || !ct) { errors.push(`Cell "${id ?? '?'}" missing a string \`type\`.`); continue; }
    if (!ALLOWED_CELL_TYPES.has(ct)) {
      errors.push(`Cell "${id ?? '?'}" has unknown type "${ct}" - SILENTLY DROPPED on load (not in the shape allowlist).`);
      continue;
    }
    // Best-practice: a type-specific shape used in the wrong diagram type (only warns when diagramType is known).
    const home = shapeHomeTypes(ct);
    if (home && type && VALID_DIAGRAM_TYPES.has(type) && !home.includes(type)) {
      warnings.push(`Cell "${id}" is a ${ct} (a ${home.join('/')} shape) but diagramType is "${type}".`);
    }
  }

  // Second pass: dangling links (the loader drops a link whose source/target id isn't present).
  for (const c of cells) {
    if (!isLink(c)) continue;
    for (const end of ['source', 'target']) {
      const ref = c[end];
      const rid = ref && typeof ref === 'object' ? ref.id : undefined;
      if (rid != null && !ids.has(rid)) {
        errors.push(`Link "${c.id ?? '?'}" ${end} references missing cell "${rid}" - the link is DROPPED on load.`);
      }
    }
  }

  // Third pass: dangling `parent` / `embeds` (the loader STRIPS a parent whose cell isn't present). Not just
  // cosmetic - a link/element with a parent attr pointing at a missing cell makes JointJS throw "Embedding of
  // already embedded cells" on a node drag (the reparent skips the unembed but still embeds), FREEZING the canvas
  // until reload. The loader now strips these, so this is a warning (the diagram still loads + works), but an
  // author should fix the id so the intended grouping survives.
  for (const c of cells) {
    if (!c || typeof c !== 'object') continue;
    if (c.parent != null && !ids.has(c.parent)) {
      warnings.push(`Cell "${c.id ?? '?'}" has \`parent\` "${c.parent}" referencing a missing cell - the parent ref is STRIPPED on load (use a real cell id to keep the grouping).`);
    }
    if (Array.isArray(c.embeds)) {
      for (const eid of c.embeds) {
        if (!ids.has(eid)) warnings.push(`Cell "${c.id ?? '?'}" \`embeds\` a missing cell "${eid}" - pruned on load.`);
      }
    }
  }

  // Type-specific QUIET-DEGRADE traps (documented in DIAGRAM_JSON_SPEC.md "Common authoring mistakes"). Unlike the
  // generic failures above, the loader neither drops nor heals these - the cell loads but renders WRONG, so an author
  // can't see the mistake without this check. All WARNINGS (the diagram still imports).

  // One-sided embed: both cells are present but the parent<->embeds relationship is declared on only one side.
  // json-pipeline.js S6 only strips parent/embeds pointing at a MISSING cell; it does NOT reconcile a half-declared
  // embed. JointJS reads `parent` and `embeds` as independent attributes, so a one-sided embed group-moves /
  // reparents asymmetrically. The spec tells authors to set BOTH sides (child `parent` AND the id in parent `embeds`).
  for (const c of cells) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string') continue;
    if (typeof c.parent === 'string' && ids.has(c.parent)) {
      const p = byId.get(c.parent);
      const embeds = Array.isArray(p?.embeds) ? p.embeds : [];
      if (!embeds.includes(c.id)) {
        warnings.push(`Cell "${c.id}" sets \`parent\` "${c.parent}" but that cell's \`embeds\` doesn't list "${c.id}" - set BOTH sides (the loader won't reconcile a one-sided embed).`);
      }
    }
    if (Array.isArray(c.embeds)) {
      for (const eid of c.embeds) {
        if (!ids.has(eid)) continue;   // missing-child case already warned above
        const child = byId.get(eid);
        if (child && child.parent !== c.id) {
          warnings.push(`Cell "${c.id}" \`embeds\` "${eid}" but that cell's \`parent\` is ${child.parent == null ? 'unset' : `"${child.parent}"`}, not "${c.id}" - set BOTH sides.`);
        }
      }
    }
  }

  // Gantt: `order` IS the row slot - two GanttTasks with the same order collide in one row. (A MISSING order is
  // auto-healed from the bar's Y on load, so only the un-healed duplicate is flagged.)
  const ganttRow = new Map();   // order value -> first task id that claimed it
  for (const c of cells) {
    if (!c || c.type !== 'sf.GanttTask' || typeof c.order !== 'number') continue;
    if (ganttRow.has(c.order)) {
      warnings.push(`GanttTask "${c.id ?? '?'}" reuses \`order\` ${c.order} (already used by "${ganttRow.get(c.order)}") - each bar needs a distinct 0-based row slot.`);
    } else ganttRow.set(c.order, c.id ?? '?');
  }

  // OrgPerson: the name must be the TOP-LEVEL `personName` - the view overwrites attrs.nameLabel from it every
  // render, so a name placed only in attrs paints once then vanishes. A `vacant` slot may legitimately have none.
  for (const c of cells) {
    if (!c || c.type !== 'sf.OrgPerson') continue;
    const hasName = typeof c.personName === 'string' && c.personName.trim() !== '';
    if (!hasName && c.vacant !== true) {
      warnings.push(`OrgPerson "${c.id ?? '?'}" has no top-level \`personName\` - put the name there (not in attrs.nameLabel), or set \`vacant: true\`.`);
    }
  }

  // DataObject field ports: a link end referencing `field-{left,right}-<fid>` must name a fid that exists on that
  // object's `fields` - a stale fid builds no port, so the link end dangles. Only checked when the object's fields
  // actually carry fids (generators MAY omit them; the app assigns on load) and the ref isn't the legacy numeric
  // index form (`field-left-3`, which migrateLinks re-keys), to avoid false positives.
  const FIELD_PORT = /^field-(?:left|right)-(.+)$/;
  for (const c of cells) {
    if (!isLink(c)) continue;
    for (const end of ['source', 'target']) {
      const ref = c[end];
      if (!ref || typeof ref !== 'object' || typeof ref.port !== 'string' || typeof ref.id !== 'string') continue;
      const m = FIELD_PORT.exec(ref.port);
      if (!m || /^\d+$/.test(m[1])) continue;
      const obj = byId.get(ref.id);
      if (!obj || obj.type !== 'sf.DataObject' || !Array.isArray(obj.fields)) continue;
      const fids = obj.fields.map((f) => f && f.fid).filter((x) => typeof x === 'string');
      if (fids.length && !fids.includes(m[1])) {
        warnings.push(`Link "${c.id ?? '?'}" ${end} port "${ref.port}" references field id "${m[1]}" not on DataObject "${ref.id}" - copy a real \`fid\` from its fields (a stale one builds no port, so the end dangles).`);
      }
    }
  }

  // BpmnGateway: the decision glyph lives in `attrs.marker.text` and is NOT derived from `gatewayType` on load
  // (it's applied only at stencil-drop), so an authored gateway without it renders blank / inert.
  for (const c of cells) {
    if (!c || c.type !== 'sf.BpmnGateway') continue;
    const t = c.attrs?.marker?.text;
    if (typeof t !== 'string' || t.trim() === '') {
      warnings.push(`BpmnGateway "${c.id ?? '?'}" has no \`attrs.marker.text\` glyph (× exclusive / + parallel / ○ inclusive / ◇ event) - it renders blank (the loader doesn't derive it from gatewayType).`);
    }
  }

  return { errors, warnings };
}

/** Validate a single diagram OR a `diagramforce-export` bundle (validates each `diagrams[]` entry). Returns an array
 *  of { name, errors, warnings } so the CLI can report per-diagram. */
export function validateFile(json) {
  if (json && json.schema === 'diagramforce-export' && Array.isArray(json.diagrams)) {
    return json.diagrams.map((d, i) => ({ name: d?.name || `diagrams[${i}]`, ...validateDiagram(d) }));
  }
  return [{ name: json?.title || 'diagram', ...validateDiagram(json) }];
}

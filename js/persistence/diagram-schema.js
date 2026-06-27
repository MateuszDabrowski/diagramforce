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
  // Generic (df.* net-new shapes; sf.* legacy kept for save back-compat)
  'df.Pill', 'df.Legend', 'df.Table',
  // JointJS link
  'standard.Link',
]);

export const VALID_DIAGRAM_TYPES = new Set(['architecture', 'process', 'datamodel', 'datamapping', 'org', 'gantt', 'sequence']);
// Aliases the loader normalises (kept lenient).
export const DIAGRAM_TYPE_ALIASES = { data: 'datamodel', datamodel: 'datamodel', organisation: 'org', organization: 'org', mapping: 'datamapping' };

/** The diagram type(s) a TYPE-SPECIFIC shape belongs to. Cross-type generics (Note/TextLabel/Line/Image/Pill/Legend/
 *  Table/Link/Container/Zone/SimpleNode/Annotation/Task) return null - they're valid anywhere, so no warning. */
export function shapeHomeTypes(cellType) {
  if (typeof cellType !== 'string') return null;
  if (cellType.startsWith('sf.Bpmn') || cellType.startsWith('sf.Flow')) return ['process'];
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
  // First pass: collect valid cell ids (for the dangling-link check) + structural/allowlist/dup checks.
  for (const c of cells) {
    if (!c || typeof c !== 'object') { errors.push('A cell is not an object (dropped on load).'); continue; }
    const id = c.id;
    const ct = c.type;
    if (typeof id !== 'string' || !id) errors.push(`Cell missing a string \`id\` (type ${JSON.stringify(ct)}).`);
    else { if (seen.has(id)) errors.push(`Duplicate cell id "${id}".`); seen.add(id); ids.add(id); }
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

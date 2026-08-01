// Official template library — curated, READ-ONLY starting points surfaced in the New Diagram
// modal's "Templates" tab. Opening one creates a fresh diagram tab seeded with its cells (you
// edit your copy; the official file stays pristine).
//
// Storage model (deliberately NOT a live GitHub fetch): the heavy cells live in same-origin
// `templates/*.json` files in this repo. The app's own CSP (`connect-src 'self'`) ALLOWS a
// same-origin fetch but BLOCKS cross-origin (raw.githubusercontent.com) — so a repo folder
// served from the same GitHub Pages origin gives the "folder on GitHub" authoring workflow
// without widening CSP. Each file is the app's standard export shape ({ title, diagramType,
// mappingMode, graph:{cells}, viewport }), so authoring a new official template = export your
// diagram, drop the file in templates/, add one entry below (+ a sw.js precache line).
//
// Offline: templates/*.json are SW-precached (sw.js), and the versioned cache name busts them on
// every release/dev bump, so no `?v=` query is needed on the fetch.

import { renderTemplateThumbnail } from './templates.js?v=1.22.0';

// ── Manifest (small; the cells are fetched lazily) ──────────────────────────
const OFFICIAL_TEMPLATES = [
  {
    id: 'official-data360-contact-mapping',
    shapes: 13,
    name: 'Data 360 Contact Mapping',
    description: 'Base Data 360 mapping of Contact data from Source, through DLO to DMO',
    diagramType: 'datamapping',
    file: 'templates/data360-contact-mapping.json',
  },
  {
    id: 'official-mce-email-data-views',
    shapes: 11,
    name: 'MCE Email Data Views',
    description: 'Marketing Cloud Engagement data model for email channel System Data Views',
    diagramType: 'datamodel',
    file: 'templates/mce-email-data-views.json',
  },
  {
    id: 'official-mce-mobile-data-views',
    shapes: 7,
    name: 'MCE Mobile Data Views',
    description: 'Marketing Cloud Engagement data model for MobileConnect SMS channel System Data Views',
    diagramType: 'datamodel',
    file: 'templates/mce-mobile-data-views.json',
  },
  {
    id: 'official-mcn-consent-data-model',
    shapes: 25,
    name: 'MCN Consent Data Model',
    description: 'Marketing Cloud Next consent, subscription and engagement DMOs around the Unified Individual',
    diagramType: 'datamodel',
    file: 'templates/mcn-consent-data-model.json',
  },
  {
    id: 'official-mcn-email-data-mapping',
    shapes: 30,
    name: 'MCN Email Data Mapping',
    description: 'Marketing Cloud Next email channel mapping from sources through Data Streams and DLOs to DMOs',
    diagramType: 'datamapping',
    file: 'templates/mcn-email-data-mapping.json',
  },
  {
    id: 'official-mcn-push-data-mapping',
    shapes: 31,
    name: 'MCN Push Data Mapping',
    description: 'Marketing Cloud Next mobile push mapping from sources through Data Streams and DLOs to DMOs',
    diagramType: 'datamapping',
    file: 'templates/mcn-push-data-mapping.json',
  },
  {
    id: 'official-mcn-sms-data-mapping',
    shapes: 26,
    name: 'MCN SMS Data Mapping',
    description: 'Marketing Cloud Next SMS and WhatsApp mapping from sources through Data Streams and DLOs to DMOs',
    diagramType: 'datamapping',
    file: 'templates/mcn-sms-data-mapping.json',
  },
];

// id → { cells, viewport, mappingMode, diagramType } once fetched (in-memory, per session).
const _cache = new Map();

export function getOfficialTemplates() {
  return OFFICIAL_TEMPLATES;
}

function getOfficialTemplate(id) {
  return OFFICIAL_TEMPLATES.find((t) => t.id === id) || null;
}

/** Fetch (once, then cache) an official template's cells from its same-origin JSON file.
 *  Returns { cells, viewport, mappingMode, diagramType } or null (missing id / fetch failure). */
export async function loadOfficialTemplate(id) {
  if (_cache.has(id)) return _cache.get(id);
  const meta = getOfficialTemplate(id);
  if (!meta) return null;
  let data;
  try {
    const res = await fetch(meta.file);
    if (!res.ok) throw new Error(`${meta.file} → HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.warn('Diagramforce: official template failed to load', id, err);
    return null;
  }
  const cells = Array.isArray(data?.graph?.cells) ? data.graph.cells
    : Array.isArray(data?.cells) ? data.cells : [];
  const out = {
    cells,
    viewport: data?.viewport || null,
    mappingMode: !!data?.mappingMode,
    diagramType: data?.diagramType || meta.diagramType,
  };
  _cache.set(id, out);
  return out;
}

// Rendered-SVG cache (1.20.0 perf): the templates are IMMUTABLE per session, but the modal is
// rebuilt on every open, and re-rendering 7 mini-papers (three of them ~100-link routed mapping
// diagrams) each time made the Templates tab visibly lag. Cache the final SVG markup per id+size;
// repeat opens clone it instantly instead of spinning up throwaway papers again.
const _thumbSvgCache = new Map();   // `${id}@${size}x${height}` → svg outerHTML

/** Render a self-contained mini-paper thumbnail for an official template (lazy-loads its cells;
 *  the RENDERED SVG is cached per id+size for the session). Returns a wrapper <div> (the same
 *  shape renderTemplateThumbnail returns), or null on failure. */
export async function renderOfficialThumbnail(id, size = 200, height = 120) {
  const key = `${id}@${size}x${height}`;
  if (_thumbSvgCache.has(key)) {
    const wrap = document.createElement('div');
    wrap.className = 'df-template-thumb';
    wrap.innerHTML = _thumbSvgCache.get(key);   // our own generated SVG markup, not user input
    return wrap;
  }
  const loaded = await loadOfficialTemplate(id);
  if (!loaded || !loaded.cells.length) return null;
  // renderTemplateThumbnail only needs a { cells } shape; it sanitises + fits the content itself.
  const wrap = renderTemplateThumbnail({ cells: loaded.cells }, size, height);
  if (wrap && wrap.firstElementChild) _thumbSvgCache.set(key, wrap.innerHTML);
  return wrap;
}

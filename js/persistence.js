// Persistence — named saves, JSON import/export, PNG/GIF export
// (Auto-save is handled by the tabs module now.)

import { GIFEncoder, quantize, applyPalette } from 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm';

let graph, paper, canvasModule;
const NAMED_SAVE_PREFIX = 'sfdiag::save::';
const SAVE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const APP_VERSION = '1.8.2';
export { APP_VERSION };

// Maximum number of cells to accept from external sources (share URLs, JSON import)
const MAX_CELL_COUNT = 2000;

/** Sanitise graph JSON from untrusted sources (share URLs, imports).
 *  Strips event-handler attributes and javascript: URIs to prevent XSS. */
function sanitizeGraphJSON(graphData) {
  if (!graphData || !Array.isArray(graphData.cells)) return graphData;
  if (graphData.cells.length > MAX_CELL_COUNT) {
    throw new Error(`Diagram exceeds maximum element count (${MAX_CELL_COUNT}).`);
  }
  const stripAttrs = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      // Remove event handler attributes (onclick, onload, etc.)
      if (/^on[a-z]/i.test(key)) { delete obj[key]; continue; }
      const val = obj[key];
      // Remove javascript: URIs in string values
      if (typeof val === 'string' && /^\s*javascript\s*:/i.test(val)) {
        obj[key] = '';
      } else if (typeof val === 'object' && val !== null) {
        stripAttrs(val);
      }
    }
  };
  for (const cell of graphData.cells) { stripAttrs(cell); }
  return graphData;
}

/** HTML-escape a string for safe innerHTML interpolation. */
export function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Map LLM-friendly diagram type aliases to the internal names used by the app. */
export function normalizeDiagramType(type) {
  const aliases = {
    organisation: 'org',
    organization: 'org',
    data: 'datamodel',
    datamodel: 'datamodel',
    architecture: 'architecture',
    process: 'process',
    sequence: 'sequence',
    gantt: 'gantt',
    org: 'org',
  };
  return aliases[String(type || '').toLowerCase()] || 'architecture';
}

// Callback invoked after a successful named save (used by tabs to update tab name)
let onNamedSaveCallback = null;
export function onNamedSave(cb) { onNamedSaveCallback = cb; }

// Callback to mark tab as saved (set by tabs module)
let onSaveCompleteCallback = null;
export function onSaveComplete(cb) { onSaveCompleteCallback = cb; }

// Callback for importing into a new tab (set by tabs module)
let onImportCallback = null;
export function setImportHandler(cb) { onImportCallback = cb; }

// Callback to get current diagram type
let getDiagramTypeCallback = null;
export function setDiagramTypeGetter(cb) { getDiagramTypeCallback = cb; }

// Callback to get current tab name (used as default save name)
let getTabNameCallback = null;
export function setTabNameGetter(cb) { getTabNameCallback = cb; }

// Callback to get all open tabs (set by tabs module)
let getAllTabsCallback = null;
export function setAllTabsGetter(cb) { getAllTabsCallback = cb; }

// Callback to get a specific tab's graph JSON
let getTabGraphCallback = null;
export function setTabGraphGetter(cb) { getTabGraphCallback = cb; }

// Callback to get a specific tab's viewport
let getTabViewportCallback = null;
export function setTabViewportGetter(cb) { getTabViewportCallback = cb; }

// Callback to get a specific tab's diagram type
let getTabDiagramTypeCallback = null;
export function setTabDiagramTypeGetter(cb) { getTabDiagramTypeCallback = cb; }

// Callback to show save modal (set by toolbar)
let showSaveModalCallback = null;
export function setShowSaveModal(cb) { showSaveModalCallback = cb; }

export function init(_graph, _paper, _canvas) {
  graph = _graph;
  paper = _paper;
  canvasModule = _canvas;
}

/** YYYYMMDD date string for filenames */
function dateSuffix() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** Compare semver strings. Returns -1 if a<b, 0 if equal, 1 if a>b */
function compareSemver(a, b) {
  if (!a) return -1;
  if (!b) return 1;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

/**
 * Classify the version difference between saved and current app version.
 * Returns 'none' | 'patch' | 'minor' | 'major'.
 */
export function classifyVersionDiff(savedVersion) {
  if (!savedVersion) return 'major'; // no version at all — treat as major
  const saved = savedVersion.split('.').map(Number);
  const current = APP_VERSION.split('.').map(Number);
  if (saved[0] !== current[0]) return 'major';
  if (saved[1] !== current[1]) return 'minor';
  if (saved[2] !== current[2]) return 'patch';
  return 'none';
}

/**
 * Show a warning modal if the loaded data was saved with an older app version.
 * Returns a Promise that resolves to true (user wants to continue) or false.
 *
 * - Patch differences: no warning (silent load)
 * - Minor differences: soft warning (should still work)
 * - Major differences: strong warning (probably won't work)
 * - No version info: treated as major
 */
function checkVersionWarning(savedAppVersion, sourceName, rawData) {
  if (compareSemver(savedAppVersion, APP_VERSION) >= 0) {
    return Promise.resolve(true); // same or newer — load without warning
  }
  const diff = classifyVersionDiff(savedAppVersion);
  if (diff === 'none' || diff === 'patch') {
    return Promise.resolve(true); // patch-only difference — no warning
  }
  return showVersionWarningModal(savedAppVersion, sourceName, diff, rawData);
}

function showVersionWarningModal(savedVersion, sourceName, diff, rawData) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'sf-modal';
    overlay.style.zIndex = '10001';

    const savedLabel = savedVersion || 'unknown (no version)';
    const isMajor = diff === 'major';
    const title = isMajor ? 'Compatibility Warning' : 'Version Notice';
    const message = isMajor
      ? 'There were significant changes introduced since this diagram was saved. Your save probably won\'t load correctly.'
      : 'There have been some changes since this diagram was saved, but it should still work.';
    const loadLabel = isMajor ? 'Try Anyway' : 'Continue';

    overlay.innerHTML = `
      <div class="sf-modal__overlay"></div>
      <div class="sf-modal__dialog" style="width:440px">
        <div class="sf-modal__header">
          <h2 class="sf-modal__title">${title}</h2>
        </div>
        <div class="sf-modal__body" style="padding:16px 20px">
          <p style="margin:0 0 12px">
            <strong>${escHtml(sourceName || 'This diagram')}</strong> was saved with
            <strong>v${escHtml(savedLabel)}</strong>, but the current app version is
            <strong>v${escHtml(APP_VERSION)}</strong>
            (<a href="https://github.com/MateuszDabrowski/diagramforce" target="_blank" rel="noopener" style="color:var(--color-primary)">GitHub</a>).
          </p>
          <p style="margin:0;color:var(--text-secondary)">
            ${message}
          </p>
        </div>
        <div class="sf-modal__footer" style="justify-content:flex-end">
          <button class="sf-modal__btn" data-action="cancel">Don't load</button>
          <button class="sf-modal__btn" data-action="backup" style="margin-left:auto">Save as JSON</button>
          <button class="sf-modal__btn sf-modal__btn--primary" data-action="load">${loadLabel}</button>
        </div>
      </div>`;

    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });
    overlay.querySelector('[data-action="backup"]').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      if (btn.dataset.saved) return;
      // Export the incoming diagram data as-is (the old version) as a backup
      const exportData = rawData ? JSON.parse(JSON.stringify(rawData)) : null;
      if (exportData) {
        // Normalise structure — share URLs use compact keys (v, av, name, type)
        const backupData = {
          version: exportData.version || exportData.v || 1,
          appVersion: exportData.appVersion || exportData.av || savedVersion || 'unknown',
          timestamp: exportData.timestamp || Date.now(),
          title: exportData.title || exportData.name || sourceName || 'Backup',
          diagramType: exportData.diagramType || exportData.type || 'architecture',
          graph: exportData.graph,
          viewport: exportData.viewport || null,
        };
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const safeName = (backupData.title).replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'backup';
        triggerDownload(URL.createObjectURL(blob), `${safeName}_backup_${dateSuffix()}.json`);
      }
      btn.textContent = 'Saved!';
      btn.style.background = '#2e844a';
      btn.style.color = '#fff';
      btn.style.borderColor = '#2e844a';
      btn.dataset.saved = '1';
    });
    overlay.querySelector('[data-action="load"]').addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });
    overlay.querySelector('.sf-modal__overlay').addEventListener('click', () => {
      overlay.remove(); resolve(false);
    });
    document.body.appendChild(overlay);
  });
}

// newDiagram is now a thin wrapper — tabs module handles the actual logic.
// This keeps backward compat for keyboard.js (Ctrl+N).
let newDiagramHandler = null;
export function setNewDiagramHandler(fn) { newDiagramHandler = fn; }
export function newDiagram() {
  if (newDiagramHandler) { newDiagramHandler(); return; }
  // Fallback (no tabs module)
  if (graph.getCells().length > 0) {
    if (!confirm('Start a new diagram? Unsaved changes will be lost.')) return;
  }
  graph.clear();
  canvasModule.setViewport({ zoom: 1, translate: { tx: 0, ty: 0 } });
}

// --- Named saves ---

export function namedSave() {
  // Delegate to save modal
  if (showSaveModalCallback) {
    showSaveModalCallback();
    return;
  }
  // Fallback: single-tab save via prompt
  namedSaveSingle();
}

/** Save a single tab (active) — used as fallback and internally. */
function namedSaveSingle() {
  const defaultName = getTabNameCallback ? getTabNameCallback() : 'My Diagram';
  const existing = prompt('Save diagram as:', defaultName);
  if (!existing?.trim()) return;
  const name = existing.trim();
  saveSingleTab(name, graph.toJSON(), canvasModule.getViewport(),
    getDiagramTypeCallback ? getDiagramTypeCallback() : 'architecture');
}

/** Save multiple tabs by id with a name prefix. */
export function saveMultipleTabs(tabIds, namePrefix) {
  if (!getAllTabsCallback || !getTabGraphCallback) return;
  const allTabs = getAllTabsCallback();
  let savedCount = 0;
  for (const tabId of tabIds) {
    const tab = allTabs.find(t => t.id === tabId);
    if (!tab) continue;
    const graphJSON = getTabGraphCallback(tabId);
    const viewport = getTabViewportCallback ? getTabViewportCallback(tabId) : null;
    const diagramType = getTabDiagramTypeCallback ? getTabDiagramTypeCallback(tabId) : 'architecture';
    if (!graphJSON) continue;
    // Use the tab name as save name (with date suffix)
    const saveName = namePrefix
      ? `${namePrefix} — ${tab.name}`
      : tab.name;
    saveSingleTab(saveName, graphJSON, viewport, diagramType, tabIds.length > 1);
    savedCount++;
  }
  if (savedCount > 0 && onSaveCompleteCallback) {
    onSaveCompleteCallback('browser');
  }
}

function saveSingleTab(name, graphJSON, viewport, diagramType, silent = false) {
  const key = NAMED_SAVE_PREFIX + name;
  const alreadyExists = localStorage.getItem(key) !== null;
  if (alreadyExists && !silent && !confirm(`"${name}" already exists. Overwrite?`)) return;

  const data = {
    name,
    timestamp: Date.now(),
    version: 1,
    appVersion: APP_VERSION,
    diagramType,
    graph: graphJSON,
    viewport,
  };
  try {
    localStorage.setItem(key, JSON.stringify(data));
    if (!silent) {
      if (onNamedSaveCallback) onNamedSaveCallback(name);
    }
  } catch (err) {
    alert('Save failed: ' + err.message);
  }
}

export function getNamedSaves() {
  const saves = [];
  const now = Date.now();
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key?.startsWith(NAMED_SAVE_PREFIX)) continue;
    try {
      const data = JSON.parse(localStorage.getItem(key));
      const age = now - (data.timestamp || 0);
      if (age > SAVE_TTL_MS) {
        localStorage.removeItem(key);
        continue;
      }
      saves.push({
        key,
        name: data.name || key.replace(NAMED_SAVE_PREFIX, ''),
        timestamp: data.timestamp,
        expiresIn: SAVE_TTL_MS - age,
        diagramType: data.diagramType || 'architecture',
        appVersion: data.appVersion || null,
      });
    } catch (err) {
      console.warn('SF Diagrams: Skipping corrupt save entry:', key, err);
    }
  }
  return saves.sort((a, b) => b.timestamp - a.timestamp);
}

export async function loadNamedSave(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) { alert('Save not found.'); return false; }
    const data = JSON.parse(raw);
    const savedVer = data.appVersion || null;
    const name = data.name || key.replace(NAMED_SAVE_PREFIX, '');
    const ok = await checkVersionWarning(savedVer, name, data);
    if (!ok) return false;
    if (data?.graph) sanitizeGraphJSON(data.graph);
    if (onImportCallback && data?.graph) {
      const type = normalizeDiagramType(data.diagramType);
      onImportCallback(name, type, data.graph, data.viewport);
    } else if (data?.graph) {
      canvasModule.setLoadingJSON(true);
      try { graph.fromJSON(data.graph); } finally { canvasModule.setLoadingJSON(false); }
      if (data?.viewport) canvasModule.setViewport(data.viewport);
    }
    return true;
  } catch (err) {
    alert('Failed to load: ' + err.message);
    return false;
  }
}

export function deleteNamedSave(key) {
  localStorage.removeItem(key);
}

// Keep old name as alias for keyboard shortcut backward compat
export const saveJSON = namedSave;

// --- Import / Export ---

export function exportJSON() {
  const diagramType = getDiagramTypeCallback ? getDiagramTypeCallback() : 'architecture';
  const tabName = getTabNameCallback ? getTabNameCallback() : 'sf-diagram';
  const data = {
    version: 1,
    appVersion: APP_VERSION,
    timestamp: Date.now(),
    title: tabName,
    diagramType,
    graph: graph.toJSON(),
    viewport: canvasModule.getViewport(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const safeName = tabName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'sf-diagram';
  triggerDownload(URL.createObjectURL(blob), `${safeName}_${dateSuffix()}.json`);
  if (onSaveCompleteCallback) onSaveCompleteCallback('json');
}

export function importJSON() {
  const input = document.getElementById('file-input');
  input.onchange = (evt) => {
    const files = Array.from(evt.target.files);
    if (!files.length) return;
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const fallbackName = file.name.replace(/\.json$/i, '') || 'Imported';
        await loadJSONText(e.target.result, fallbackName);
      };
      reader.readAsText(file);
    }
    input.value = '';
  };
  input.click();
}

/**
 * Parse a JSON string and load it into a new tab (or fallback to current canvas).
 * Used by `importJSON` (file picker) and `pasteJSON` (textarea modal).
 * Returns true on success, false on parse/validation failure.
 */
async function loadJSONText(jsonText, fallbackName) {
  try {
    const data = JSON.parse(jsonText);
    const savedVer = data.appVersion || null;
    const name = data.title || fallbackName || 'Imported';
    const ok = await checkVersionWarning(savedVer, name, data);
    if (!ok) return false;
    if (data?.graph) sanitizeGraphJSON(data.graph);
    if (onImportCallback && data?.graph) {
      const type = normalizeDiagramType(data.diagramType);
      onImportCallback(name, type, data.graph, data.viewport);
    } else if (data?.graph) {
      canvasModule.setLoadingJSON(true);
      try { graph.fromJSON(data.graph); } finally { canvasModule.setLoadingJSON(false); }
      if (data?.viewport) canvasModule.setViewport(data.viewport);
    } else {
      throw new Error('No graph data found in JSON.');
    }
    return true;
  } catch (err) {
    alert(`Failed to load ${fallbackName ? `"${fallbackName}"` : 'JSON'}: ${err.message}`);
    return false;
  }
}

/**
 * Paste-from-JSON modal: shows a textarea, validates the input is parseable
 * JSON with a `graph` field, and loads it via the same pipeline as `importJSON`.
 */
export function pasteJSON() {
  document.querySelector('.sf-paste-json-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'sf-paste-json-modal sf-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="sf-modal__overlay"></div>
    <div class="sf-modal__dialog" style="width:620px;max-width:92vw">
      <div class="sf-modal__header">
        <h2 class="sf-modal__title">Paste JSON</h2>
        <button class="sf-toolbar__button sf-paste-json-modal__close" aria-label="Close">
          <svg class="sf-toolbar__icon"><use href="#close"></use></svg>
        </button>
      </div>
      <div class="sf-modal__body" style="padding:var(--spacing-md) var(--spacing-lg)">
        <p style="margin:0 0 var(--spacing-sm);color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">
          Paste a Diagramforce JSON:
        </p>
        <textarea class="sf-paste-json-modal__input" spellcheck="false" rows="14"
          placeholder='{ "appVersion": "${APP_VERSION}", "diagramType": "architecture", "graph": { "cells": [...] } }'
          style="width:100%;box-sizing:border-box;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;padding:8px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-panel);color:var(--text-primary);resize:vertical"></textarea>
        <p class="sf-paste-json-modal__status" style="margin:var(--spacing-sm) 0 0;color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5;min-height:1.4em">
          Paste a diagram exported via <strong>Save → Save to JSON</strong> or generated using <a href="https://github.com/MateuszDabrowski/diagramforce/blob/main/DIAGRAM_JSON_SPEC.md" target="_blank" rel="noopener" style="color:var(--color-primary)">Diagram JSON Spec for LLMs</a>.
        </p>
      </div>
      <div class="sf-modal__footer" style="justify-content:flex-end;gap:8px">
        <button class="sf-modal__btn sf-paste-json-modal__cancel">Cancel</button>
        <button class="sf-modal__btn sf-modal__btn--primary sf-paste-json-modal__load" disabled>Load</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('.sf-paste-json-modal__input');
  const status = overlay.querySelector('.sf-paste-json-modal__status');
  const loadBtn = overlay.querySelector('.sf-paste-json-modal__load');
  const errColor = 'var(--color-error, #ba0517)';
  const okColor = 'var(--text-secondary)';

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.sf-modal__overlay').addEventListener('click', close);
  overlay.querySelector('.sf-paste-json-modal__close').addEventListener('click', close);
  overlay.querySelector('.sf-paste-json-modal__cancel').addEventListener('click', close);

  const validate = () => {
    const text = input.value.trim();
    if (!text) {
      status.style.color = okColor;
      status.innerHTML = 'Paste a diagram exported via <strong>Save → Save to JSON</strong> or generated using <a href="https://github.com/MateuszDabrowski/diagramforce/blob/main/DIAGRAM_JSON_SPEC.md" target="_blank" rel="noopener" style="color:var(--color-primary)">Diagram JSON Spec for LLMs</a>.';
      loadBtn.disabled = true;
      return;
    }
    try {
      const data = JSON.parse(text);
      if (!data?.graph?.cells) throw new Error('Missing graph.cells field.');
      status.style.color = okColor;
      const t = normalizeDiagramType(data.diagramType);
      status.innerHTML = `Detected: <strong>${escHtml(data.title || 'Untitled')}</strong> (${escHtml(t)}, ${data.graph.cells.length} cells)`;
      loadBtn.disabled = false;
    } catch (err) {
      status.style.color = errColor;
      status.textContent = `Invalid JSON: ${err.message}`;
      loadBtn.disabled = true;
    }
  };
  input.addEventListener('input', validate);

  loadBtn.addEventListener('click', async () => {
    const ok = await loadJSONText(input.value, 'Pasted');
    if (ok) close();
  });

  setTimeout(() => input.focus(), 50);
}

// Keep old name as alias
export const openJSON = importJSON;

export function exportWEBP(transparent = false) {
  return exportRaster(transparent, 'webp');
}

export function exportPNG(transparent = false) {
  return exportRaster(transparent, 'png');
}

function exportRaster(transparent, format) {
  const mimeType = format === 'webp' ? 'image/webp' : 'image/png';
  const ext = format === 'webp' ? 'webp' : 'png';
  const fmtLabel = format.toUpperCase();
  try {
    const contentBBox = paper.getContentBBox();
    if (!contentBBox || contentBBox.width === 0) {
      alert('The diagram is empty — nothing to export.');
      return;
    }

    const padding = 32;
    const exportW = contentBBox.width + padding * 2;
    const exportH = contentBBox.height + padding * 2;

    // Clone the paper SVG element and adjust for export
    const svgEl = paper.svg;
    const svgClone = svgEl.cloneNode(true);
    svgClone.setAttribute('width', exportW);
    svgClone.setAttribute('height', exportH);
    svgClone.setAttribute('viewBox',
      `${contentBBox.x - padding} ${contentBBox.y - padding} ${exportW} ${exportH}`
    );

    // Remove the viewport transform (scale+translate used for pan/zoom)
    const viewport = svgClone.querySelector('.joint-viewport');
    if (viewport) viewport.removeAttribute('transform');

    // Hide grid pattern and port circles for clean export
    svgClone.querySelectorAll('pattern, .joint-port').forEach(el => el.remove());

    // Inline the SLDS icon sprites so they render in the exported SVG
    const spritesContainer = document.getElementById('slds-icons');
    if (spritesContainer) {
      const defsEl = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defsEl.innerHTML = spritesContainer.innerHTML;
      svgClone.insertBefore(defsEl, svgClone.firstChild);
    }

    // Replace foreignObject elements with SVG text — HTML inside SVG Blob URLs
    // is blocked by browsers during Image rendering (security restriction)
    replaceForeignObjects(svgClone);

    // Resolve CSS custom properties — standalone SVG images can't access page CSS vars
    resolveCssVars(svgClone);

    const svgStr = new XMLSerializer().serializeToString(svgClone);
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const scale = 2; // 2× for retina sharpness
      const canvas = document.createElement('canvas');
      canvas.width = exportW * scale;
      canvas.height = exportH * scale;
      const ctx = canvas.getContext('2d');

      if (!transparent) {
        const theme = document.documentElement.getAttribute('data-theme');
        ctx.fillStyle = theme === 'dark' ? '#1A1A1A' : '#FAFAFA';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, exportW, exportH);

      canvas.toBlob(blob => {
        const baseName = (getTabNameCallback ? getTabNameCallback() : 'sf-diagram').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'sf-diagram';
        if (blob) triggerDownload(URL.createObjectURL(blob), `${baseName}_${dateSuffix()}.${ext}`);
        URL.revokeObjectURL(svgUrl);
      }, mimeType);
    };

    img.onerror = () => {
      alert(`${fmtLabel} export failed. Try saving as JSON instead.`);
      URL.revokeObjectURL(svgUrl);
    };

    img.src = svgUrl;
  } catch (err) {
    alert(`${fmtLabel} export failed: ` + err.message);
    console.error(`SF Diagrams: ${fmtLabel} export failed:`, err);
  }
}

/**
 * Export an animated GIF of the diagram with flowing connector dashes.
 * Renders multiple frames with varying stroke-dashoffset on link lines,
 * then encodes them as an animated GIF using gifenc.
 */
export async function exportGIF(transparent = false) {
  try {
    const contentBBox = paper.getContentBBox();
    if (!contentBBox || contentBBox.width === 0) {
      alert('The diagram is empty — nothing to export.');
      return;
    }

    const padding = 32;
    const exportW = contentBBox.width + padding * 2;
    const exportH = contentBBox.height + padding * 2;
    const scale = 2; // 2× for retina sharpness
    const canvasW = Math.round(exportW * scale);
    const canvasH = Math.round(exportH * scale);

    // Animation parameters — must match css/canvas.css .sf-animate-flow
    const TOTAL_FRAMES = 12;
    const DASH_TOTAL = 12; // stroke-dasharray: 8 4 → total repeat = 12
    const FRAME_DELAY = 50; // ms per frame (12 frames × 50ms = 600ms = one cycle)

    // Prepare a base SVG clone (same pipeline as exportPNG)
    function prepareBaseSvg() {
      const svgEl = paper.svg;
      const svgClone = svgEl.cloneNode(true);
      svgClone.setAttribute('width', exportW);
      svgClone.setAttribute('height', exportH);
      svgClone.setAttribute('viewBox',
        `${contentBBox.x - padding} ${contentBBox.y - padding} ${exportW} ${exportH}`
      );
      const viewport = svgClone.querySelector('.joint-viewport');
      if (viewport) viewport.removeAttribute('transform');
      svgClone.querySelectorAll('pattern, .joint-port, .sf-flow-overlay').forEach(el => el.remove());
      const spritesContainer = document.getElementById('slds-icons');
      if (spritesContainer) {
        const defsEl = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defsEl.innerHTML = spritesContainer.innerHTML;
        svgClone.insertBefore(defsEl, svgClone.firstChild);
      }
      replaceForeignObjects(svgClone);
      resolveCssVars(svgClone);
      return svgClone;
    }

    // Determine background color
    const theme = document.documentElement.getAttribute('data-theme');
    const bgColor = transparent ? null : (theme === 'dark' ? '#1A1A1A' : '#FAFAFA');

    // Render a single frame: clone SVG, set dash offset, rasterise to canvas
    function renderFrame(frameIndex) {
      return new Promise((resolve, reject) => {
        const svgClone = prepareBaseSvg();

        // Inverse-masking approach: clone each link line ON TOP without markers,
        // paint background-coloured dashes that "erase" sections of the solid
        // original line underneath.  This avoids Safari's marker inheritance bug.
        const offset = DASH_TOTAL - (frameIndex * (DASH_TOTAL / TOTAL_FRAMES));
        const eraseFill = bgColor || '#FFFFFF';
        svgClone.querySelectorAll('.joint-link [joint-selector="line"]').forEach(line => {
          const overlay = line.cloneNode(false);
          overlay.removeAttribute('marker-start');
          overlay.removeAttribute('marker-end');
          overlay.removeAttribute('marker-mid');
          overlay.removeAttribute('joint-selector');
          overlay.setAttribute('stroke', eraseFill);
          overlay.setAttribute('stroke-dasharray', '4 8');
          overlay.setAttribute('stroke-dashoffset', String(offset));
          line.parentNode.insertBefore(overlay, line.nextSibling);
        });

        const svgStr = new XMLSerializer().serializeToString(svgClone);
        const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const svgUrl = URL.createObjectURL(svgBlob);

        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = canvasW;
          canvas.height = canvasH;
          const ctx = canvas.getContext('2d');

          if (bgColor) {
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, canvasW, canvasH);
          }

          ctx.scale(scale, scale);
          ctx.drawImage(img, 0, 0, exportW, exportH);

          const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
          URL.revokeObjectURL(svgUrl);
          resolve(imageData.data);
        };
        img.onerror = () => {
          URL.revokeObjectURL(svgUrl);
          reject(new Error('Frame rendering failed'));
        };
        img.src = svgUrl;
      });
    }

    // Render all frames and encode GIF
    const gif = GIFEncoder();

    for (let i = 0; i < TOTAL_FRAMES; i++) {
      const rgba = await renderFrame(i);
      const palette = quantize(rgba, 256, { format: 'rgba4444' });
      const index = applyPalette(rgba, palette, 'rgba4444');

      const writeOpts = { palette, delay: FRAME_DELAY };
      if (transparent) {
        // Find the transparent entry in palette (closest to [0,0,0,0])
        let tIdx = 0;
        let minDist = Infinity;
        for (let p = 0; p < palette.length; p++) {
          const r = palette[p][0], g = palette[p][1], b = palette[p][2], a = palette[p][3];
          // Prefer fully transparent pixels
          if (a === 0) { tIdx = p; minDist = 0; break; }
          const dist = a; // lower alpha = more transparent
          if (dist < minDist) { minDist = dist; tIdx = p; }
        }
        writeOpts.transparent = true;
        writeOpts.transparentIndex = tIdx;
      }

      gif.writeFrame(index, canvasW, canvasH, writeOpts);
    }

    gif.finish();
    const bytes = gif.bytes();
    const blob = new Blob([bytes], { type: 'image/gif' });
    const gifName = (getTabNameCallback ? getTabNameCallback() : 'sf-diagram').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'sf-diagram';
    triggerDownload(URL.createObjectURL(blob), `${gifName}_${dateSuffix()}.gif`);

  } catch (err) {
    alert('GIF export failed: ' + err.message);
    console.error('SF Diagrams: GIF export failed:', err);
  }
}

/**
 * Replace <foreignObject> elements with equivalent SVG <text> elements.
 * Browsers block HTML content inside SVG when rendering from Blob URLs
 * (used by the Image→Canvas PNG export pipeline) as a security measure.
 */
function replaceForeignObjects(svgRoot) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const foList = [...svgRoot.querySelectorAll('foreignObject')];
  for (const fo of foList) {
    const x = parseFloat(fo.getAttribute('x') || '0');
    const y = parseFloat(fo.getAttribute('y') || '0');
    const w = parseFloat(fo.getAttribute('width') || '100');

    // Extract text content from the HTML child
    const textContent = fo.textContent?.trim() || '';
    if (!textContent) { fo.remove(); continue; }

    // Get styling from the HTML child
    const htmlChild = fo.querySelector('div, p, span');
    let fontSize = '9';
    let fontFamily = 'system-ui, -apple-system, sans-serif';
    let fill = '#888888';
    if (htmlChild) {
      const cs = htmlChild.style;
      if (cs.fontSize) fontSize = cs.fontSize.replace('px', '');
      if (cs.fontFamily) fontFamily = cs.fontFamily;
      if (cs.color) fill = cs.color;
    }

    // Create SVG text with word-wrapping approximation
    const textEl = document.createElementNS(SVG_NS, 'text');
    textEl.setAttribute('x', String(x));
    textEl.setAttribute('y', String(y + parseFloat(fontSize) * 1.2));
    textEl.setAttribute('font-size', fontSize);
    textEl.setAttribute('font-family', fontFamily);
    textEl.setAttribute('fill', fill);

    // Simple line-break: split text into lines that fit the width
    const charWidth = parseFloat(fontSize) * 0.52;
    const maxChars = Math.floor(w / charWidth);
    const words = textContent.split(/\s+/);
    const lines = [];
    let currentLine = '';
    for (const word of words) {
      const test = currentLine ? currentLine + ' ' + word : word;
      if (test.length > maxChars && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = test;
      }
    }
    if (currentLine) lines.push(currentLine);

    // Limit to 4 lines (matching the original -webkit-line-clamp: 4)
    const maxLines = 4;
    const visibleLines = lines.slice(0, maxLines);
    if (lines.length > maxLines) {
      const last = visibleLines[maxLines - 1];
      visibleLines[maxLines - 1] = last.substring(0, last.length - 1) + '…';
    }

    visibleLines.forEach((line, i) => {
      const tspan = document.createElementNS(SVG_NS, 'tspan');
      tspan.setAttribute('x', String(x));
      tspan.setAttribute('dy', i === 0 ? '0' : String(parseFloat(fontSize) * 1.3));
      tspan.textContent = line;
      textEl.appendChild(tspan);
    });

    fo.parentNode.replaceChild(textEl, fo);
  }
}

/**
 * Walk all elements in an SVG clone and replace CSS var() references with
 * their computed values.  Standalone SVG images (Blob URLs) cannot access
 * the page's CSS custom properties, so every attribute and inline-style that
 * uses var(--…) must be resolved to a concrete colour / value before export.
 */
function resolveCssVars(svgRoot) {
  const cs = getComputedStyle(document.documentElement);

  // Cache resolved values to avoid repeated getComputedStyle calls
  const cache = new Map();
  function resolve(varExpr) {
    if (cache.has(varExpr)) return cache.get(varExpr);
    // Extract var name and optional fallback: var(--foo, #FFF)
    const m = varExpr.match(/var\(\s*(--[^,)]+)\s*(?:,\s*([^)]+))?\s*\)/);
    if (!m) { cache.set(varExpr, varExpr); return varExpr; }
    const val = cs.getPropertyValue(m[1]).trim() || (m[2] ? m[2].trim() : '');
    cache.set(varExpr, val);
    return val;
  }

  // Attributes that may contain colour var() references
  const COLOR_ATTRS = ['fill', 'stroke', 'color', 'stop-color', 'flood-color'];

  const walker = document.createTreeWalker(svgRoot, NodeFilter.SHOW_ELEMENT);
  let node = walker.currentNode;
  while (node) {
    // Resolve attributes
    for (const attr of COLOR_ATTRS) {
      const v = node.getAttribute(attr);
      if (v && v.includes('var(')) {
        node.setAttribute(attr, resolve(v));
      }
    }
    // Resolve inline style properties
    if (node.style) {
      for (const attr of COLOR_ATTRS) {
        const sv = node.style.getPropertyValue(attr);
        if (sv && sv.includes('var(')) {
          node.style.setProperty(attr, resolve(sv));
        }
      }
      // Also check common non-colour style properties
      const bg = node.style.getPropertyValue('background');
      if (bg && bg.includes('var(')) node.style.setProperty('background', resolve(bg));
      const bgColor = node.style.getPropertyValue('background-color');
      if (bgColor && bgColor.includes('var(')) node.style.setProperty('background-color', resolve(bgColor));
    }
    node = walker.nextNode();
  }
}

// ── URL Sharing ─────────────────────────────────────────────────────

export function shareAsURL() {
  if (!getTabNameCallback || !getDiagramTypeCallback) return;
  const data = {
    v: 1,
    av: APP_VERSION,
    name: getTabNameCallback(),
    type: getDiagramTypeCallback(),
    graph: graph.toJSON(),
  };
  try {
    const json = JSON.stringify(data);
    const compressed = pako.deflateRaw(json);
    // Build base64 in chunks to avoid call-stack overflow on large arrays
    let binaryStr = '';
    for (let i = 0; i < compressed.length; i++) binaryStr += String.fromCharCode(compressed[i]);
    const base64 = btoa(binaryStr);
    // Use URL-safe base64
    const urlSafe = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const url = `${window.location.origin}${window.location.pathname}#diagram=${urlSafe}`;

    showShareModal(url);
  } catch (err) {
    console.error('SF Diagrams: Share URL failed:', err);
    alert('Failed to generate share URL. The diagram may be too large.');
  }
}

export async function loadFromURL() {
  const hash = window.location.hash;
  if (!hash || !hash.includes('diagram=')) return false;

  const match = hash.match(/diagram=([A-Za-z0-9_-]+)/);
  // Hash is present but the payload contains characters outside the
  // url-safe-base64 alphabet — almost always a copy/paste truncation.
  if (!match) {
    showShareLoadError('This share link is invalid. Please check that you copied the whole link, or ask the sender for a new one.');
    history.replaceState(null, '', window.location.pathname);
    return false;
  }

  try {
    // Restore standard base64 from URL-safe encoding
    let base64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    // Re-add padding
    while (base64.length % 4) base64 += '=';

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const json = pako.inflateRaw(bytes, { to: 'string' });
    const data = JSON.parse(json);

    if (!data.graph || !data.type) {
      showShareLoadError('This share link is invalid. Please check that you copied the whole link, or ask the sender for a new one.');
      history.replaceState(null, '', window.location.pathname);
      return false;
    }

    // Sanitize graph data from untrusted URL source
    sanitizeGraphJSON(data.graph);

    // Clear the hash so it doesn't reload on refresh
    history.replaceState(null, '', window.location.pathname);

    const savedVer = data.av || null;
    const ok = await checkVersionWarning(savedVer, data.name || 'Shared Diagram', data);
    if (!ok) return false;

    // Import the diagram using the existing import handler
    if (onImportCallback) {
      const type = normalizeDiagramType(data.type);
      onImportCallback(data.name || 'Shared Diagram', type, data.graph, data.viewport || null);
      return true;
    }
    return false;
  } catch (err) {
    console.error('SF Diagrams: Failed to load shared diagram:', err);
    showShareLoadError('This share link is invalid. Please check that you copied the whole link, or ask the sender for a new one.');
    history.replaceState(null, '', window.location.pathname);
    return false;
  }
}

/** Show a non-blocking error toast for share-URL load failures. */
function showShareLoadError(message) {
  document.querySelector('.sf-share-error-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'sf-share-error-modal sf-modal';
  overlay.style.zIndex = '10001';
  overlay.innerHTML = `
    <div class="sf-modal__overlay"></div>
    <div class="sf-modal__dialog" style="width:440px">
      <div class="sf-modal__header">
        <h2 class="sf-modal__title">Couldn't load shared diagram</h2>
      </div>
      <div class="sf-modal__body" style="padding:16px 20px">
        <p style="margin:0;color:var(--text-secondary);line-height:1.5">${escHtml(message)}</p>
      </div>
      <div class="sf-modal__footer" style="justify-content:flex-end">
        <button class="sf-modal__btn sf-modal__btn--primary" data-action="dismiss">OK</button>
      </div>
    </div>`;
  const dismiss = () => overlay.remove();
  overlay.querySelector('[data-action="dismiss"]').addEventListener('click', dismiss);
  overlay.querySelector('.sf-modal__overlay').addEventListener('click', dismiss);
  document.body.appendChild(overlay);
}

function showShareModal(url) {
  document.querySelector('.sf-share-modal')?.remove();

  const wrapper = document.createElement('div');
  wrapper.className = 'sf-share-modal';
  wrapper.innerHTML = `
    <div class="sf-modal" style="z-index:3000">
      <div class="sf-modal__overlay"></div>
      <div class="sf-modal__dialog" style="width:520px">
        <div class="sf-modal__header">
          <h2 class="sf-modal__title">Share Diagram</h2>
        </div>
        <div class="sf-modal__body" style="padding:var(--spacing-md) var(--spacing-lg)">
          <p style="margin:0 0 var(--spacing-sm);color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.5">
            Anyone with this link can open a copy of your diagram:
          </p>
          <input type="text" class="sf-share-modal__url" readonly spellcheck="false">
        </div>
        <div style="display:flex;gap:var(--spacing-sm);padding:var(--spacing-sm) var(--spacing-lg) var(--spacing-md);justify-content:flex-end">
          <button class="sf-close-confirm__btn sf-share-modal__close-btn">Close</button>
          <button class="sf-close-confirm__btn sf-close-confirm__btn--save sf-share-modal__copy-btn">Copy Link</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(wrapper);

  const urlInput = wrapper.querySelector('.sf-share-modal__url');
  urlInput.value = url;

  const close = () => wrapper.remove();
  const copyBtn = wrapper.querySelector('.sf-share-modal__copy-btn');

  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(url).then(() => {
      copyBtn.textContent = 'Copied!';
      copyBtn.style.borderColor = '#43A047';
      copyBtn.style.background = '#43A047';
      copyBtn.style.color = '#fff';
      setTimeout(close, 600);
    }).catch(() => {
      urlInput.select();
    });
  });

  wrapper.querySelector('.sf-share-modal__close-btn').addEventListener('click', close);
  wrapper.querySelector('.sf-modal__overlay').addEventListener('click', close);

  // Select the URL text for easy manual copy
  setTimeout(() => urlInput.select(), 50);
}

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

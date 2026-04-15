// SF Diagrams — App bootstrap
// Initializes all modules in order. JointJS is a global (loaded via CDN script tag).

import * as theme       from './theme.js?v=1.3.1';
import * as icons       from './icons.js?v=1.3.1';
import { getAllStencilSvgs } from './templates.js?v=1.3.1';
import * as shapes      from './shapes.js?v=1.3.1';
import * as canvas      from './canvas.js?v=1.3.1';
import * as stencil     from './stencil.js?v=1.3.1';
import * as selection   from './selection.js?v=1.3.1';
import * as history     from './history.js?v=1.3.1';
import * as clipboard   from './clipboard.js?v=1.3.1';
import * as keyboard    from './keyboard.js?v=1.3.1';
import * as toolbar     from './toolbar.js?v=1.3.1';
import * as properties  from './properties.js?v=1.3.1';
import * as persistence from './persistence.js?v=1.3.1';
import * as tabs        from './tabs.js?v=1.3.1';
import * as mermaidImport from './mermaid-import.js?v=1.3.1';

async function main() {
  // Set app version in About modal
  const versionEl = document.getElementById('about-version');
  if (versionEl) versionEl.textContent = `v${persistence.APP_VERSION}`;

  // --- Phase 1: Foundation ---
  theme.init();

  // Load SLDS icon sprites into the DOM (async)
  await icons.init();

  // Register custom stencilSvg icons so they appear in icon pickers
  icons.registerStencilIcons(getAllStencilSvgs());

  // Normalize viewBoxes across all icon sets for consistent visual sizing
  icons.normalizeViewBoxes();

  // --- Phase 2: Canvas core ---
  shapes.register();
  canvas.setIconDataUriFn(icons.getIconDataUri);
  const { graph, paper } = canvas.init();

  // --- Phase 3: Stencil panel ---
  stencil.init(graph, paper);

  // --- Phase 4: Interaction ---
  selection.init(graph, paper);
  history.init(graph);
  clipboard.init(graph, paper, selection);

  const moduleRefs = {
    graph,
    paper,
    canvas,
    selection,
    history,
    clipboard,
    persistence,
    toolbar,
    theme,
    stencil,
    tabs,
    mermaidImport,
  };

  keyboard.init(moduleRefs);
  toolbar.init(moduleRefs);

  // --- Phase 5: Properties panel ---
  properties.init(graph, paper, selection);

  // --- Phase 6: Persistence (export/import only, no auto-load) ---
  persistence.init(graph, paper, canvas);

  // --- Phase 7: Tabs (restores session, manages auto-save) ---
  tabs.init(graph, paper, canvas, selection, history, persistence, stencil);
  tabs.setupAutoSave();

  // --- Phase 7b: Mermaid import (needs tabs + canvas + graph) ---
  mermaidImport.init(moduleRefs);

  // --- Phase 8: Mobile interactions ---
  canvas.initMobileDragHandles();

  // --- Phase 9: Check for shared diagram in URL hash ---
  persistence.loadFromURL();

}

main().catch(err => {
  console.error('SF Diagrams: Initialization failed', err);
});

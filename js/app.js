// SF Diagrams — App bootstrap
// Initializes all modules in order. JointJS is a global (loaded via CDN script tag).

import * as theme       from './theme.js';
import * as icons       from './icons.js';
import { getAllStencilSvgs } from './templates.js';
import * as shapes      from './shapes.js';
import * as canvas      from './canvas.js';
import * as stencil     from './stencil.js';
import * as selection   from './selection.js';
import * as history     from './history.js';
import * as clipboard   from './clipboard.js';
import * as keyboard    from './keyboard.js';
import * as toolbar     from './toolbar.js';
import * as properties  from './properties.js';
import * as persistence from './persistence.js';
import * as tabs        from './tabs.js';

async function main() {
  // --- Phase 1: Foundation ---
  theme.init();

  // Load SLDS icon sprites into the DOM (async)
  await icons.init();

  // Register custom stencilSvg icons so they appear in icon pickers
  icons.registerStencilIcons(getAllStencilSvgs());

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

  // --- Phase 8: Check for shared diagram in URL hash ---
  persistence.loadFromURL();

}

main().catch(err => {
  console.error('SF Diagrams: Initialization failed', err);
});

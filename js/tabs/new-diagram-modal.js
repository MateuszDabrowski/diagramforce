// New-diagram modal (CLEANUP S5) — the type-picker + Templates tab that seeds a fresh tab (via
// tbctx.importDiagramAsTab) or optionally drops it into a group (tbctx.setTabGroup). Reads paper/persistence
// from tbctx.modules + the forward-refs (importDiagramAsTab/setTabGroup/createDiagramOfType/getGroup) at CALL
// time; never imports the facade back.

import { tbctx } from './context.js?v=1.19.2.99';
import { DIAGRAM_TYPES } from './diagram-types.js?v=1.19.2.99';
import { getOfficialTemplates, loadOfficialTemplate, renderOfficialThumbnail } from '../official-templates.js?v=1.19.2.99';
import { normalizeDiagramType } from '../persistence.js?v=1.19.2.99';
import { showError } from '../feedback.js?v=1.19.2.99';

export function showNewDiagramModal(targetGroupId = null) {
  const { tabs } = tbctx;                                            // shared array ref (read length for dismiss-guard)
  const { paper, persistence: persistenceModule } = tbctx.modules;   // module refs (wired in tabs.init)
  const { importDiagramAsTab, setTabGroup, createDiagramOfType, getGroup } = tbctx;  // forward-refs to facade functions
  // Remove any existing modal
  document.querySelector('.df-new-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'df-new-modal';
  overlay.innerHTML = `
    <div class="df-new-modal__backdrop"></div>
    <div class="df-new-modal__dialog">
      <h2 class="df-new-modal__title">New Diagram</h2>
      <div class="df-new-modal__tabs" role="tablist">
        <button class="df-new-modal__tab is-active" data-tab="create" role="tab" aria-selected="true">Create</button>
        <button class="df-new-modal__tab" data-tab="open" role="tab" aria-selected="false">Load</button>
        <button class="df-new-modal__tab" data-tab="templates" role="tab" aria-selected="false">Templates</button>
      </div>
      <div class="df-new-modal__panels">
      <div class="df-new-modal__panel" data-tab="create">
      <div class="df-new-modal__grid">
        <button class="df-new-modal__card" data-type="architecture">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <rect x="2" y="5" width="22" height="14" rx="3" fill="var(--color-primary)" opacity="0.85"/>
            <rect x="2" y="29" width="22" height="14" rx="3" fill="var(--color-primary)" opacity="0.85"/>
            <rect x="40" y="17" width="22" height="14" rx="3" fill="var(--color-primary)" opacity="0.85"/>
            <path d="M24 12 H32 V24 H40 M24 36 H32 V24" fill="none" stroke="var(--color-primary)" stroke-width="2.4" stroke-linejoin="round"/>
          </svg>
          <span class="df-new-modal__card-title">Architecture</span>
          <span class="df-new-modal__card-desc">Map system architecture, integrations, and infrastructure landscape.</span>
        </button>
        <button class="df-new-modal__card" data-type="datamodel">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <!-- Two objects, vertically offset (the small stagger) like a real schema relationship -->
            <rect x="3" y="5" width="18" height="22" rx="3" fill="none" stroke="var(--color-primary)" stroke-width="1.5"/>
            <rect x="3" y="5" width="18" height="8" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <rect x="43" y="21" width="18" height="22" rx="3" fill="none" stroke="var(--color-primary)" stroke-width="1.5"/>
            <rect x="43" y="21" width="18" height="8" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <!-- Orthogonal relationship connector, vertical leg centred between the objects so both
                 end-stubs are visible. Ends: "one" = a T-bar at the left object (stem runs right, no
                 line on the object side → reads as a T, not a cross); "zero or many" = open circle +
                 crow's foot at the right object. -->
            <g stroke="var(--text-secondary, #9AA0A6)" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 16 H29 V32 H40"/>
              <line x1="22" y1="12" x2="22" y2="20"/>
              <circle cx="36" cy="32" r="2.3" fill="var(--bg-app)"/>
              <path d="M40 32 L43 28 M40 32 L43 32 M40 32 L43 36"/>
            </g>
          </svg>
          <span class="df-new-modal__card-title">Data Model</span>
          <span class="df-new-modal__card-desc">Define objects, fields, and relationships like Schema Builder.</span>
        </button>
        <button class="df-new-modal__card" data-type="datamapping">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <rect x="3" y="9" width="22" height="30" rx="3" fill="none" stroke="var(--color-primary)" stroke-width="1.5"/>
            <rect x="3" y="9" width="22" height="8" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <rect x="39" y="9" width="22" height="30" rx="3" fill="none" stroke="var(--color-primary)" stroke-width="1.5"/>
            <rect x="39" y="9" width="22" height="8" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <path d="M25 24 L36 24 M32.5 20.5 L36 24 L32.5 27.5" fill="none" stroke="var(--color-accent)" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M25 32 L36 32 M32.5 28.5 L36 32 L32.5 35.5" fill="none" stroke="var(--color-accent)" stroke-width="1.5" stroke-linejoin="round" opacity="0.55"/>
          </svg>
          <span class="df-new-modal__card-title">Data Mapping</span>
          <span class="df-new-modal__card-desc">Map end-to-end data journey from source systems through Data Cloud pipelines to Activations.</span>
        </button>
        <button class="df-new-modal__card" data-type="process">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <circle cx="10" cy="24" r="6" fill="none" stroke="var(--color-primary)" stroke-width="2"/>
            <circle cx="10" cy="24" r="2.5" fill="var(--color-primary)"/>
            <rect x="22" y="17" width="20" height="14" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <path d="M48 16l8 8-8 8" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linejoin="round"/>
            <line x1="16" y1="24" x2="22" y2="24" stroke="var(--text-muted)" stroke-width="1.5"/>
            <line x1="42" y1="24" x2="48" y2="24" stroke="var(--text-muted)" stroke-width="1.5"/>
          </svg>
          <span class="df-new-modal__card-title">Process</span>
          <span class="df-new-modal__card-desc">Design business processes, flows, and BPMN workflows.</span>
        </button>
        <button class="df-new-modal__card" data-type="sequence">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <rect x="4" y="4" width="14" height="7" rx="2" fill="var(--color-primary)" opacity="0.85"/>
            <rect x="25" y="4" width="14" height="7" rx="2" fill="var(--color-primary)" opacity="0.65"/>
            <rect x="46" y="4" width="14" height="7" rx="2" fill="var(--color-primary)" opacity="0.5"/>
            <line x1="11" y1="11" x2="11" y2="44" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 2"/>
            <line x1="32" y1="11" x2="32" y2="44" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 2"/>
            <line x1="53" y1="11" x2="53" y2="44" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 2"/>
            <line x1="11" y1="20" x2="32" y2="20" stroke="var(--color-primary)" stroke-width="1.5"/>
            <polygon points="32,20 28,18 28,22" fill="var(--color-primary)"/>
            <line x1="32" y1="30" x2="53" y2="30" stroke="var(--color-primary)" stroke-width="1.5"/>
            <polygon points="53,30 49,28 49,32" fill="var(--color-primary)"/>
            <line x1="32" y1="38" x2="11" y2="38" stroke="var(--color-accent)" stroke-width="1" stroke-dasharray="3 2"/>
            <polygon points="11,38 15,36 15,40" fill="var(--color-accent)"/>
          </svg>
          <span class="df-new-modal__card-title">Sequence</span>
          <span class="df-new-modal__card-desc">Document request/response interactions between systems.</span>
        </button>
        <button class="df-new-modal__card" data-type="gantt">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <rect x="8" y="6" width="24" height="7" rx="2" fill="var(--color-primary)" opacity="0.8"/>
            <rect x="16" y="17" width="28" height="7" rx="2" fill="var(--color-primary)" opacity="0.6"/>
            <rect x="24" y="28" width="18" height="7" rx="2" fill="var(--color-primary)" opacity="0.4"/>
            <line x1="32" y1="13" x2="32" y2="17" stroke="var(--text-muted)" stroke-width="1"/>
            <line x1="42" y1="24" x2="42" y2="28" stroke="var(--text-muted)" stroke-width="1"/>
            <polygon points="30,35 33,28 36,35" fill="var(--color-accent)"/>
          </svg>
          <span class="df-new-modal__card-title">Gantt Chart</span>
          <span class="df-new-modal__card-desc">Plan project timelines, tasks, milestones, and dependencies.</span>
        </button>
        <button class="df-new-modal__card" data-type="org">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <rect x="20" y="2" width="24" height="14" rx="3" fill="var(--color-primary)" opacity="0.8"/>
            <rect x="2" y="28" width="24" height="14" rx="3" fill="var(--color-primary)" opacity="0.6"/>
            <rect x="38" y="28" width="24" height="14" rx="3" fill="var(--color-primary)" opacity="0.6"/>
            <line x1="32" y1="16" x2="32" y2="22" stroke="var(--text-muted)" stroke-width="1.5"/>
            <line x1="14" y1="22" x2="50" y2="22" stroke="var(--text-muted)" stroke-width="1.5"/>
            <line x1="14" y1="22" x2="14" y2="28" stroke="var(--text-muted)" stroke-width="1.5"/>
            <line x1="50" y1="22" x2="50" y2="28" stroke="var(--text-muted)" stroke-width="1.5"/>
          </svg>
          <span class="df-new-modal__card-title">Org Chart</span>
          <span class="df-new-modal__card-desc">Document team hierarchy, roles, and responsibilities.</span>
        </button>
      </div>
      </div>
      <div class="df-new-modal__panel" data-tab="open" hidden>
      <div class="df-new-modal__grid df-new-modal__grid--open">
        <button class="df-new-modal__card" data-action="load">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <!-- Window body extended ~+10px at the bottom (height 30 → 37) so the browser glyph is less squat. -->
            <rect x="6" y="9" width="52" height="37" rx="4" fill="none" stroke="var(--color-primary)" stroke-width="2.5"/>
            <path d="M6 20 H58" stroke="var(--color-primary)" stroke-width="2"/>
            <circle cx="13" cy="14.5" r="1.7" fill="var(--color-primary)"/>
            <circle cx="19" cy="14.5" r="1.7" fill="var(--color-primary)"/>
            <circle cx="25" cy="14.5" r="1.7" fill="var(--color-primary)"/>
            <rect x="32" y="12" width="20" height="5" rx="2.5" fill="var(--color-primary)" opacity="0.5"/>
          </svg>
          <span class="df-new-modal__card-title">Browser Storage</span>
          <span class="df-new-modal__card-desc">Open a diagram you saved in this browser.</span>
        </button>
        <button class="df-new-modal__card" data-action="import-json">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <path d="M18 4h20l10 10v30a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="none" stroke="var(--color-primary)" stroke-width="2.5"/>
            <path d="M38 4v10h10" fill="none" stroke="var(--color-primary)" stroke-width="2.5"/>
            <text x="32" y="38" text-anchor="middle" font-size="11" font-family="var(--font-family)" fill="var(--color-primary)" opacity="0.9">{ }</text>
          </svg>
          <span class="df-new-modal__card-title">JSON or DGF File</span>
          <span class="df-new-modal__card-desc">Open a Diagramforce .dgf or .json file from your computer.</span>
        </button>
        <button class="df-new-modal__card df-new-modal__card--paste" data-action="paste">
          <svg class="df-new-modal__icon" viewBox="0 0 64 48">
            <rect x="15" y="6" width="34" height="40" rx="4" fill="none" stroke="var(--color-primary)" stroke-width="2.5"/>
            <rect x="24" y="3" width="16" height="8" rx="2.5" fill="var(--color-primary)" opacity="0.85"/>
            <line x1="22" y1="22" x2="42" y2="22" stroke="var(--text-muted)" stroke-width="2"/>
            <line x1="22" y1="30" x2="42" y2="30" stroke="var(--text-muted)" stroke-width="2"/>
            <line x1="22" y1="38" x2="34" y2="38" stroke="var(--text-muted)" stroke-width="2"/>
          </svg>
          <span class="df-new-modal__card-title">Paste</span>
          <span class="df-new-modal__card-desc">Paste Diagramforce JSON or Mermaid code - the format is detected automatically.</span>
        </button>
      </div>
      </div>
      <div class="df-new-modal__panel" data-tab="templates" hidden>
      <div class="df-new-modal__grid df-new-modal__grid--templates"></div>
      </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Cross-device restore: when Drive is available on this origin, append a card that opens
  // "Your Drive diagrams" so a fresh device can pull the user's masters (signs in on click if needed).
  if (persistenceModule.isDriveConfigured?.()) {
    const card = document.createElement('button');
    card.className = 'df-new-modal__card df-new-modal__card--drive';
    card.dataset.action = 'drive';
    card.innerHTML = `
      <svg class="df-new-modal__icon" viewBox="0 0 48 48" aria-hidden="true"><use href="#icon-gdrive"></use></svg>
      <span class="df-new-modal__card-title">Google Drive</span>
      <span class="df-new-modal__card-desc">Open a diagram you saved to your Google Drive, on any device.</span>`;
    // Insert as the 2nd card (right after Browser Storage): row 1 = Browser / Drive / File, row 2 = File + Paste.
    const openGrid = overlay.querySelector('.df-new-modal__grid--open');
    openGrid?.insertBefore(card, openGrid.children[1] || null);
  }

  // Tab switcher: "Create" (diagram types) vs "Open" (existing diagrams from Browser / Drive / File / Paste).
  const showPanel = (which) => {
    overlay.querySelectorAll('.df-new-modal__tab').forEach((t) => {
      const on = t.dataset.tab === which;
      t.classList.toggle('is-active', on); t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    overlay.querySelectorAll('.df-new-modal__panel').forEach((p) => { p.hidden = p.dataset.tab !== which; });
  };
  overlay.querySelectorAll('.df-new-modal__tab').forEach((t) => t.addEventListener('click', () => showPanel(t.dataset.tab)));

  // Card clicks — a "Create" card makes that diagram type (in the target group, if any); an "Open" card
  // routes to the matching opener (all of which open the result as a new tab).
  const OPEN_ACTIONS = {
    paste: () => persistenceModule.openPasteImport?.(),
    'import-json': () => persistenceModule.importJSON(),
    load: () => persistenceModule.openLoadModal?.(),
    drive: () => persistenceModule.openDriveLibrary?.(),
  };
  overlay.querySelectorAll('.df-new-modal__card').forEach(card => {
    card.addEventListener('click', () => {
      overlay.remove();
      const action = card.dataset.action;
      if (action && OPEN_ACTIONS[action]) { OPEN_ACTIONS[action](); return; }
      createDiagramOfType(card.dataset.type, targetGroupId);
    });
  });

  // ── Templates tab — official, curated starting points (official-templates.js). Built AFTER the
  // generic card wiring above so these cards get ONLY the open-as-new-tab handler below (not the
  // create-blank handler, which would fire createDiagramOfType(undefined) on a card with no type). ──
  const tmplMetas = getOfficialTemplates();
  const tmplGrid = overlay.querySelector('.df-new-modal__grid--templates');
  if (!tmplMetas.length) {
    // No official templates → drop the tab + panel so an empty "Templates" view never shows.
    overlay.querySelector('.df-new-modal__tab[data-tab="templates"]')?.remove();
    overlay.querySelector('.df-new-modal__panel[data-tab="templates"]')?.remove();
  } else if (tmplGrid) {
    const typeShort = (t) => DIAGRAM_TYPES[normalizeDiagramType(t)]?.short || 'Diagram';
    tmplMetas.forEach((meta) => {
      const card = document.createElement('button');
      card.className = 'df-new-modal__card df-new-modal__card--template';
      card.dataset.templateId = meta.id;
      const thumb = document.createElement('div');
      thumb.className = 'df-new-modal__thumb';
      thumb.innerHTML = '<span class="df-new-modal__thumb-loading" aria-hidden="true"></span>';
      const badge = document.createElement('span');
      badge.className = 'df-new-modal__card-badge';
      badge.textContent = typeShort(meta.diagramType);
      const title = document.createElement('span');
      title.className = 'df-new-modal__card-title';
      title.textContent = meta.name;
      const desc = document.createElement('span');
      desc.className = 'df-new-modal__card-desc';
      desc.textContent = meta.description || '';
      card.append(thumb, badge, title, desc);
      tmplGrid.appendChild(card);

      // Lazy thumbnail: fetch the cells (same-origin) + render a mini-paper. Best-effort - on
      // failure the placeholder stays (the card still opens via the cached/fresh fetch on click).
      renderOfficialThumbnail(meta.id).then((el) => {
        if (el && card.isConnected) { thumb.innerHTML = ''; thumb.appendChild(el); }
      }).catch(() => { /* keep the placeholder */ });

      // Open → a fresh tab seeded with the template (you edit your copy; the official file is untouched).
      card.addEventListener('click', async () => {
        if (card.dataset.busy) return;            // guard a double-tap during the fetch
        card.dataset.busy = '1';
        const loaded = await loadOfficialTemplate(meta.id);
        if (!loaded || !loaded.cells.length) {
          showError('Could not open this template. Check your connection and try again.');
          delete card.dataset.busy;
          return;
        }
        overlay.remove();
        // Deep-copy the cached cells so a repeat open (or fromJSON's reads) never mutates the cache.
        const cells = JSON.parse(JSON.stringify(loaded.cells));
        const id = importDiagramAsTab(meta.name, loaded.diagramType, { cells }, loaded.viewport, loaded.mappingMode, { fit: true });
        if (targetGroupId && getGroup(targetGroupId)) setTabGroup(id, targetGroupId);
      });
    });
  }

  // Only allow dismissal when at least one tab already exists
  const canDismiss = tabs.length > 0;

  if (canDismiss) {
    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'df-new-modal__close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    closeBtn.addEventListener('click', () => { overlay.remove(); });
    overlay.querySelector('.df-new-modal__dialog').appendChild(closeBtn);

    // Close on backdrop click
    overlay.querySelector('.df-new-modal__backdrop').addEventListener('click', () => { overlay.remove(); });

    // Close on Escape
    const onKey = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
  }
}

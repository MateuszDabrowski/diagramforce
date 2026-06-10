// SLDS Icon registry
// Loads self-hosted SVG sprite files, inlines them into the page,
// and provides a searchable catalog of all available icons.

const SPRITE_CATEGORIES = ['standard', 'utility', 'action', 'custom', 'doctype'];
const iconRegistry = []; // [{ category, name, id }]

export async function init() {
  const container = document.getElementById('slds-icons');

  for (const category of SPRITE_CATEGORIES) {
    try {
      const resp = await fetch(`assets/icons/${category}-sprite.svg`);
      if (!resp.ok) {
        console.warn(`SF Diagrams: Failed to load ${category} sprite (${resp.status})`);
        continue;
      }
      const svgText = await resp.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, 'image/svg+xml');
      const svg = doc.querySelector('svg');
      if (!svg) continue;

      svg.id = `slds-${category}-sprite`;
      // Ensure the sprite is hidden but present in the DOM
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      container.appendChild(document.adoptNode(svg));

      const symbols = svg.querySelectorAll('symbol');
      const seenIds = new Set(iconRegistry.map(i => i.id));
      symbols.forEach(sym => {
        if (seenIds.has(sym.id)) return; // skip duplicates across sprites
        seenIds.add(sym.id);
        iconRegistry.push({
          category,
          name: sym.id,
          id: sym.id,
        });
      });
    } catch (err) {
      console.warn(`SF Diagrams: Error loading ${category} sprite:`, err);
    }
  }

}

export function getAllIcons() {
  return iconRegistry;
}


export function getCategories() {
  // Include 'diagrams' if stencil icons have been registered
  const cats = [...SPRITE_CATEGORIES];
  if (iconRegistry.some(i => i.category === 'diagrams')) {
    cats.push('diagrams');
  }
  return cats;
}

/** Register stencilSvg icons as selectable symbols in the icon registry.
 *  Creates <symbol> elements in a hidden SVG so getIconDataUri() can render them. */
export function registerStencilIcons(stencilSvgs) {
  const container = document.getElementById('slds-icons');
  let sprite = document.getElementById('slds-stencil-sprite');
  if (!sprite) {
    sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sprite.id = 'slds-stencil-sprite';
    sprite.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    container.appendChild(sprite);
  }

  const seenIds = new Set(iconRegistry.map(i => i.id));
  for (const { id, name, svg, viewBox } of stencilSvgs) {
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
    symbol.id = id;
    symbol.setAttribute('viewBox', viewBox || '0 0 20 20');
    // Stencil SVGs use stroke-based drawing; set default stroke so paths render
    symbol.innerHTML = `<g fill="none" stroke="currentColor" stroke-width="1.3">${svg}</g>`;
    sprite.appendChild(symbol);

    iconRegistry.push({ category: 'diagrams', name, id });
  }
}

// ── ViewBox normalization ────────────────────────────────────────────
// SLDS sprites have inconsistent padding: standard icons (1000×1000) fill ~60%,
// utility icons (520×520) fill ~92%. This measures each symbol's actual bounding
// box and computes a cropped viewBox with consistent ~15% padding so all icons
// appear the same visual size when rendered at the same pixel dimensions.
const normalizedViewBoxes = new Map();

export function normalizeViewBoxes() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '200');
  svg.setAttribute('height', '200');
  svg.style.cssText = 'position:absolute;left:-9999px;top:-9999px;overflow:hidden';
  document.body.appendChild(svg);

  for (const icon of iconRegistry) {
    const sym = document.getElementById(icon.id);
    if (!sym) continue;
    const vb = sym.getAttribute('viewBox') || '0 0 52 52';
    const [,, vbW, vbH] = vb.split(' ').map(Number);

    svg.setAttribute('viewBox', vb);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.innerHTML = sym.innerHTML;
    svg.appendChild(g);

    try {
      const bbox = g.getBBox();
      if (bbox.width > 0 && bbox.height > 0) {
        const maxDim = Math.max(bbox.width, bbox.height);
        const pad = maxDim * 0.08;
        const side = maxDim + pad * 2;
        const cx = bbox.x + bbox.width / 2;
        const cy = bbox.y + bbox.height / 2;
        const normalizedVB = `${(cx - side / 2).toFixed(1)} ${(cy - side / 2).toFixed(1)} ${side.toFixed(1)} ${side.toFixed(1)}`;
        normalizedViewBoxes.set(icon.id, normalizedVB);
        // Apply directly to the symbol so all <use> references render normalized
        sym.setAttribute('viewBox', normalizedVB);
      }
    } catch (e) { /* skip icons that fail measurement */ }

    svg.removeChild(g);
  }

  svg.remove();

  // Re-render existing <use> instances so they adopt the freshly-cropped symbol viewBoxes. Some
  // engines snapshot a referenced <symbol> at first paint and DON'T re-read a later `viewBox`
  // change — which leaves standard-sprite icons (cropped from a 1000px canvas, so ~30% smaller
  // before normalization) rendering tiny next to utility icons, most visibly in the Save menu
  // (`#save` vs the `code_playground`/`quip_sheet` Export icons). Clone+replace is a listener-free
  // refresh. Runs before the stencil mounts, so only the page chrome's `<use>`s exist here.
  document.querySelectorAll('use').forEach((u) => u.replaceWith(u.cloneNode(true)));
}

// Generate a data URI for an SLDS icon to use as JointJS <image> href.
// Extracts the symbol's inner SVG content and wraps it in a standalone SVG.
// Uses normalized viewBox to ensure consistent visual sizing across icon sets.
export function getIconDataUri(iconId, color = '#FFFFFF', size = 32) {
  if (!iconId) return '';

  const safeId = iconId.replace(/[^a-zA-Z0-9_-]/g, '');
  const symbol = document.getElementById(safeId);
  if (!symbol) {
    // Symbol not loaded yet or doesn't exist
    return '';
  }

  const safeColor = color.replace(/[^a-zA-Z0-9#(),.\s%-]/g, '');
  // Replace currentColor with the actual color (stencilSvg icons use currentColor)
  const innerContent = symbol.innerHTML.replace(/currentColor/g, safeColor);
  const viewBox = normalizedViewBoxes.get(safeId) || symbol.getAttribute('viewBox') || '0 0 52 52';

  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}" fill="${safeColor}" data-icon-id="${safeId}">${innerContent}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgContent);
}

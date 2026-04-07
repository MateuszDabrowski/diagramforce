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

export function searchIcons(query) {
  const q = query.toLowerCase();
  return iconRegistry.filter(icon =>
    icon.name.toLowerCase().includes(q) ||
    icon.category.toLowerCase().includes(q)
  );
}

export function getIconsByCategory(category) {
  return iconRegistry.filter(icon => icon.category === category);
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

// Generate a data URI for an SLDS icon to use as JointJS <image> href.
// Extracts the symbol's inner SVG content and wraps it in a standalone SVG.
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
  const viewBox = symbol.getAttribute('viewBox') || '0 0 52 52';

  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}" fill="${safeColor}" data-icon-id="${safeId}">${innerContent}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgContent);
}

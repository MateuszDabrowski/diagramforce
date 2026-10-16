// RACI role pills. The Container (Team) and OrgPerson views draw the same letter pills and the properties panel's
// picker offers the same four roles, so the roster (key, name, colour) and the pill geometry live here once: a role
// added or recoloured in one place used to leave Team and Person cards disagreeing. css/properties.css styles the
// picker's active buttons with the matching --brand-* tokens (a stylesheet cannot read this table).

const SVG_NS = 'http://www.w3.org/2000/svg';

export const RACI_ROLES = Object.freeze([
  Object.freeze({ key: 'R', name: 'Responsible', color: '#1D73C9' }),
  Object.freeze({ key: 'A', name: 'Accountable', color: '#DA4E55' }),
  Object.freeze({ key: 'C', name: 'Consulted', color: '#F6B355' }),
  Object.freeze({ key: 'I', name: 'Informed', color: '#8A9099' }),
]);

const PILL = 16;
const GAP = 3;
const RIGHT_INSET = 10;

/** Width the active pills of `raci` take, gaps included; 0 when no role is set. */
export function raciPillsWidth(raci) {
  const n = RACI_ROLES.filter((r) => raci?.[r.key]).length;
  return n ? n * PILL + (n - 1) * GAP : 0;
}

/** Draw the active roles of `raci` into `groupEl` (cleared first) as letter pills, right-aligned 10 px inside
 *  `width`, top at `y`, each with a <title> naming the role. `outline` adds the white edge that keeps the pills
 *  legible on the Container's coloured header. */
export function renderRaciPills(groupEl, raci, width, { y, outline = false }) {
  groupEl.innerHTML = '';
  const active = RACI_ROLES.filter((r) => raci?.[r.key]);
  let x = width - RIGHT_INSET - raciPillsWidth(raci);
  for (const role of active) {
    const g = document.createElementNS(SVG_NS, 'g');
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(PILL));
    rect.setAttribute('height', String(PILL));
    rect.setAttribute('rx', '4');
    rect.setAttribute('ry', '4');
    rect.setAttribute('fill', role.color);
    if (outline) {
      rect.setAttribute('stroke', '#FFFFFF');
      rect.setAttribute('stroke-width', '1.2');
    }
    g.appendChild(rect);
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(x + PILL / 2));
    text.setAttribute('y', String(y + PILL / 2 + 0.5));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('fill', '#FFFFFF');
    text.setAttribute('font-size', '10');
    text.setAttribute('font-weight', '700');
    text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    text.setAttribute('pointer-events', 'none');
    text.textContent = role.key;
    g.appendChild(text);
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = role.name;
    g.appendChild(title);
    groupEl.appendChild(g);
    x += PILL + GAP;
  }
}

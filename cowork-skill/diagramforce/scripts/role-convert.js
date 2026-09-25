// Salesforce ROLE HIERARCHY -> a Diagramforce Org Chart (1.24.6).
//
// The input is the `sf data query --json` result of ROLE_QUERY below: every UserRole with its parent and, via the
// `Users` child relationship, the ACTIVE users who hold it. One query rather than a roles query plus a users
// query, so a single paste carries the whole picture - the app's paste box has room for one payload, not two.
// A plain REST `/query` response and a bare array of records are accepted too; the `Users` subquery is
// optional, and without it the cards simply say nothing about who holds the role (vacancy is only claimed when
// the payload could have shown a holder and did not).
//
// One card per ROLE, not per person: this is the role hierarchy, the thing sharing rules and report roll-ups
// follow, and in most orgs most roles are empty or shared. The role is the bold line; the holder, the holder
// count, or "Vacant" is the second. Vacant roles use the card's own dashed placeholder style.
//
// Portal roles (PortalType Partner / CustomerPortal) are skipped by default. An org creates three per portal
// account, so they outnumber the internal roles in any org with a live community, and they hang under the
// account owner's role rather than forming a hierarchy of their own. `includePortal` keeps them.
//
// This file is the source of truth for both the app's paste path and the CLI script. The copy under
// `cowork-skill/diagramforce/scripts/` is a HAND copy - byte-identity is enforced by
// dev/tests/skill-sync.test.js, and the file stays import-free so the copy runs under plain Node.

export const ROLE_QUERY = 'SELECT Id, Name, DeveloperName, ParentRoleId, PortalType, '
  + '(SELECT Name FROM Users WHERE IsActive = true) FROM UserRole';

const CARD_H = 90;                     // the sf.OrgPerson resting height for a name + one line
const MIN_W = 280;                     // the sf.OrgPerson minimum width
const TEXT_X = 88;                     // where the card's name starts, right of the avatar
const H_GAP = 40;                      // between sibling subtrees
const V_GAP = 90;                      // between levels
const ROOT_GAP = 120;                  // between separate trees (an org can have several top roles)
// Every sibling group is a ROW, leaves included. Stacking a manager's leaf roles in one column under it was
// tried and reverted: the router ranks a port's links by the target's centre x, a column ties on x, and the
// links braid - see Documentation/approaches/smaller-reverts.md.

/** 13px bold system-ui. `system-ui` is a different font per OS, and the card never wraps its name, so the estimate
 *  must cover the WIDEST one: an underestimate draws the name over the card's right edge, an overestimate only adds
 *  padding. The per-character table is macOS-shaped; FONT_SPREAD scales it to the Linux default font, measured on
 *  the 1.24.5 tag CI at 15% wider than the table ("Omega Financial Services Customer Executive": 338.6 px against
 *  293.7) - which overflowed a 400 px card on all three engines there while fitting on macOS. */
const FONT_SPREAD = 1.2;
function nameWidth(s) {
  let w = 0;
  for (const ch of String(s || '')) {
    if (/[ijl.,'|!:;]/.test(ch) || ch === ' ') w += 3.8;
    else if (/[frt()\-]/.test(ch)) w += 5;
    else if (/[mw]/.test(ch)) w += 11;
    else if (/[MW]/.test(ch)) w += 12.5;
    else if (/[A-Z&@%]/.test(ch)) w += 9;
    else w += 7.5;
  }
  return w * FONT_SPREAD;
}

function recordsOf(doc) {
  if (Array.isArray(doc)) return doc;
  if (doc && typeof doc === 'object') {
    if (Array.isArray(doc.records)) return doc.records;
    if (doc.result && Array.isArray(doc.result.records)) return doc.result.records;
  }
  return null;
}

const isRoleRecord = (r) => !!r && typeof r === 'object' && !Array.isArray(r)
  && (r.attributes?.type === 'UserRole' || ('ParentRoleId' in r && 'Name' in r));

/**
 * Is this text a role query result? Strict, because it runs in the paste detector's chain ahead of the generic
 * Diagramforce describer: EVERY record must be a role (typed `UserRole`, or carrying `ParentRoleId` + `Name`),
 * and anything with `graph` / `diagramType` falls through.
 */
export function looksLikeRoleQueryJson(text) {
  const t = String(text || '').trim();
  if (t[0] !== '{' && t[0] !== '[') return false;
  let doc;
  try { doc = JSON.parse(t); } catch { return false; }
  if (!doc || typeof doc !== 'object' || doc.graph || doc.diagramType) return false;
  const recs = recordsOf(doc);
  return !!recs && recs.length > 0 && recs.every(isRoleRecord);
}

/** `{ roles, holdersKnown }` from any of the accepted shapes. Throws a message fit for a toast. */
export function parseRoles(doc) {
  if (doc && typeof doc === 'object' && !Array.isArray(doc) && doc.status && doc.message) {
    throw new Error(`The sf CLI returned an error: ${doc.message}`);
  }
  const recs = recordsOf(doc);
  if (!recs || !recs.length || !recs.some(isRoleRecord)) {
    throw new Error(`Not a role query result. Run: sf data query --query "${ROLE_QUERY}" --json`);
  }
  const roleRecs = recs.filter(isRoleRecord);
  if (!roleRecs.every((r) => r.Id && 'ParentRoleId' in r)) {
    throw new Error('Every role needs Id and ParentRoleId - add both to the SELECT.');
  }
  const holdersKnown = roleRecs.some((r) => 'Users' in r);
  const seen = new Set();
  const roles = [];
  for (const r of roleRecs) {
    if (seen.has(r.Id)) continue;
    seen.add(r.Id);
    const u = r.Users;
    const names = Array.isArray(u?.records) ? u.records.map((x) => x && x.Name).filter(Boolean) : [];
    roles.push({
      id: String(r.Id),
      name: String(r.Name || r.DeveloperName || 'Unnamed role'),
      apiName: r.DeveloperName || null,
      parentId: r.ParentRoleId ? String(r.ParentRoleId) : null,
      portal: r.PortalType && r.PortalType !== 'None' ? String(r.PortalType) : null,
      // `totalSize` rather than the record count: a subquery over a big role (a contact centre's agent role)
      // comes back paged, and the count is what the card says.
      holders: holdersKnown ? { count: Number(u?.totalSize ?? names.length) || 0, names } : null,
    });
  }
  return { roles, holdersKnown };
}

const initials = (name) => {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  return ((w[0][0] || '') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
};

export function buildRoleDiagram(parsed, { appVersion = '1.24.6', title = null, includePortal = false, root = null } = {}) {
  const all = parsed.roles || [];
  const roles = includePortal ? all : all.filter((r) => !r.portal);
  const portalSkipped = all.length - roles.length;
  if (!roles.length) {
    throw new Error(portalSkipped
      ? `All ${portalSkipped} roles are portal roles, which are skipped. Include them to draw them.`
      : 'No roles to draw.');
  }

  const byId = new Map(roles.map((r) => [r.id, r]));
  const byName = (a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const kids = new Map(roles.map((r) => [r.id, []]));
  const roots = [];
  for (const r of roles) {
    if (r.parentId && byId.has(r.parentId) && r.parentId !== r.id) kids.get(r.parentId).push(r);
    else roots.push(r);
  }
  for (const list of kids.values()) list.sort(byName);
  roots.sort(byName);

  // Walk from the roots; anything not reached sits in a parent CYCLE, which Salesforce forbids but a hand-edited
  // payload can carry. Break each at its first role (by name) so every role still gets a card.
  const reached = new Set();
  const mark = (r) => { if (reached.has(r.id)) return; reached.add(r.id); for (const c of kids.get(r.id)) mark(c); };
  roots.forEach(mark);
  const loopRoots = [];
  for (const r of [...roles].sort(byName)) {
    if (reached.has(r.id)) continue;
    const p = byId.get(r.parentId);
    if (p) kids.set(p.id, kids.get(p.id).filter((c) => c.id !== r.id));
    loopRoots.push(r);
    mark(r);
  }
  roots.push(...loopRoots);

  // One BRANCH, by DeveloperName, Name or Id. SOQL cannot select a subtree of a self-referencing hierarchy, and
  // a whole org's chart runs to five figures of pixels wide, so the cut happens here.
  if (root) {
    const want = String(root).trim();
    const hit = roles.find((r) => r.apiName === want) || roles.find((r) => r.id === want)
      || roles.find((r) => r.name.toLowerCase() === want.toLowerCase());
    if (!hit) throw new Error(`No role "${want}" in the query result${portalSkipped ? ' (portal roles are skipped unless included)' : ''}.`);
    roots.length = 0;
    roots.push(hit);
  }
  const branch = root ? roots[0] : null;

  // One width for every card, from the longest role name - an org chart of ragged cards reads as a mistake,
  // and the card's name never wraps, so a narrow card draws a long name across its own edge.
  const holderLine = (r) => {
    const h = r.holders;
    if (!h) return '';
    if (h.count === 0) return 'Vacant';
    if (h.count === 1) return h.names[0] || '1 user';
    return `${h.count} users`;
  };
  const order = [];
  const walk = (r) => { order.push(r); kids.get(r.id).forEach(walk); };
  roots.forEach(walk);
  let W = MIN_W;
  for (const r of order) {
    W = Math.max(W, TEXT_X + nameWidth(r.name) + 16, TEXT_X + holderLine(r).length * 6.5 * FONT_SPREAD + 16);
  }
  W = Math.ceil(W / 10) * 10;

  // ── Layout: subtree blocks, top-down ──────────────────────────────────────────────────────────────────────
  // Each subtree is a block with a width and an ANCHOR (the x of its root's centre within it). A parent sits
  // centred over its first and last child's anchors - over the children themselves, not over the block, so an
  // uneven subtree to one side does not drag the parent off the middle of its own reports.
  const blocks = new Map();
  const measure = (r) => {
    const k = kids.get(r.id);
    let b;
    if (!k.length) b = { width: W, anchor: W / 2 };
    else {
      let off = 0;
      const offs = k.map((c) => { const cb = measure(c); const o = off; off += cb.width + H_GAP; return o; });
      const rowW = off - H_GAP;
      const a0 = offs[0] + blocks.get(k[0].id).anchor;
      const a1 = offs[k.length - 1] + blocks.get(k[k.length - 1].id).anchor;
      // Every block's anchor sits at least W/2 in from both of its edges, so a parent centred over its first and
      // last child's anchors always fits inside the row - the row IS the block.
      b = { width: rowW, anchor: (a0 + a1) / 2, offs };
    }
    blocks.set(r.id, b);
    return b;
  };
  const pos = new Map();
  const depthOf = new Map();
  const place = (r, x0, y, depth) => {
    const b = blocks.get(r.id);
    pos.set(r.id, { x: x0 + b.anchor - W / 2, y });
    depthOf.set(r.id, depth);
    kids.get(r.id).forEach((c, i) => place(c, x0 + b.offs[i], y + CARD_H + V_GAP, depth + 1));
  };
  let x = 40;
  for (const r of roots) { const b = measure(r); place(r, x, 40, 0); x += b.width + ROOT_GAP; }

  // ── Cells ─────────────────────────────────────────────────────────────────────────────────────────────────
  // sf.OrgPerson renders every label from these top-level props and auto-sizes from them, so no label attrs are
  // written here. Ids are short on purpose: they travel in share URLs.
  const cellId = new Map(order.map((r, i) => [r.id, `role-${i + 1}`]));
  const cells = [];
  let vacant = 0, held = 0;
  for (const r of order) {
    const h = r.holders;
    const card = {
      id: cellId.get(r.id), type: 'sf.OrgPerson',
      position: { x: Math.round(pos.get(r.id).x), y: Math.round(pos.get(r.id).y) },
      size: { width: W, height: CARD_H },
      personName: r.name,
      jobTitle: holderLine(r),
    };
    if (h && h.count === 0) { card.vacant = true; vacant++; }
    else if (h) {
      held++;
      // The holder's initials, or the head-count when several people share the role: the avatar is the first
      // thing the eye lands on, and "22" there says "contact centre" faster than the line under the name.
      const icon = h.count === 1 ? initials(h.names[0]) : String(h.count);
      if (icon && icon.length <= 4) card.iconText = icon;
    }
    cells.push(card);
  }
  // The link a user DRAWS in an Org Chart, spelled out in full. The load path only heals the router of FLOW
  // links; a minimal `standard.Link` anywhere else renders as a straight diagonal, and a CEO's eight-way fan of
  // diagonals across a 5000px row reads as a web, not a hierarchy.
  let links = 0;
  const GREY = '#888888';
  for (const r of order) {
    for (const c of kids.get(r.id)) {
      cells.push({
        id: `role-link-${++links}`, type: 'standard.Link',
        source: { id: cellId.get(r.id), port: 'port-bottom' },
        target: { id: cellId.get(c.id), port: 'port-top' },
        router: { name: 'sfManhattan' },
        connector: { name: 'rounded', args: { radius: 8 } },
        attrs: { line: {
          stroke: GREY, strokeWidth: 2,
          sourceMarker: { type: 'path', d: 'M 0 0 L -12 0', fill: 'none', stroke: GREY, 'stroke-width': 2, 'stroke-dasharray': 'none' },
          targetMarker: { type: 'path', d: 'M 0 -6 L -14 0 L 0 6 z', 'stroke-dasharray': 'none' },
        } },
      });
    }
  }

  return {
    diagram: {
      version: 1, appVersion, title: title || (branch ? `${branch.name} - Role Hierarchy` : 'Role Hierarchy'),
      diagramType: 'org',
      graph: { cells },
    },
    stats: {
      roles: order.length, links, roots: roots.length,
      levels: Math.max(...depthOf.values()) + 1,
      vacant: parsed.holdersKnown ? vacant : null,
      held: parsed.holdersKnown ? held : null,
      portalSkipped, cycles: root ? 0 : loopRoots.length,
      width: Math.round(x - ROOT_GAP), cardWidth: W,
    },
  };
}

// Organisation-diagram shapes (OrgPerson) (CLEANUP S3). registerOrg() is called by shapes.js register(); it defines the block's
// JointJS shapes/views. Reads the shared leaves (ports/markdown-fo/fields/context) + app modules; never the facade.

import { portGroups, portItems } from './ports.js?v=1.22.1';

export function registerOrg() {
  // --- OrgPerson ---
  // Person card for organisation diagrams. Displays name, position, and optional
  // fields (email, phone, role, stream). Height adapts to visible fields.
  joint.dia.Element.define(
    'sf.OrgPerson',
    {
      size: { width: 280, height: 90 },
      z: 2000,
      personName: '',
      jobTitle: '',
      email: '',
      phone: '',
      role: '',
      stream: '',
      location: '',
      company: '',
      detailOrder: ['email', 'phone', 'role', 'stream', 'location', 'company'],
      // Extensible details list — replaces the hardcoded `email/phone/role/...`
      // fields. Entries render as `Label: Value` rows in the card body.
      // Pre-1.11 cells stored values on top-level fields (`email`, `phone`,
      // ...) ordered by `detailOrder`; the view auto-migrates those into this
      // array on first render. The legacy fields stay on the cell so old
      // exports keep working for users who roll back.
      details: [],      // [{ label, value }]
      imageUrl: '',     // data URI or URL for photo
      iconText: '',     // up to 4 letters shown in avatar circle
      tags: [],         // string[] — rendered as pills along bottom of card
      raci: {},         // { R?, A?, C?, I? } booleans — coloured pills top-right
      vacant: false,    // mark as recruitment placeholder: dashed borders + faded text
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          rx: 8,
          ry: 8,
          fill: 'var(--node-bg)',
          stroke: 'var(--node-border)',
          strokeWidth: 1.5,
        },
        accentBar: {
          width: 'calc(w)',
          height: 4,
          rx: 8,
          ry: 8,
          fill: '#1D73C9',
          stroke: 'none',
        },
        accentBarMask: {
          width: 'calc(w)',
          height: 2,
          y: 2,
          fill: '#1D73C9',
          stroke: 'none',
        },
        avatar: {
          r: 34,
          cx: 44,
          cy: 48,
          fill: '#E0E4E8',
          stroke: 'var(--node-border)',
          strokeWidth: 1,
        },
        avatarText: {
          x: 44,
          y: 48,
          textAnchor: 'middle',
          dominantBaseline: 'central',
          fontSize: 18,
          fontWeight: 700,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: '',
        },
        avatarImage: {
          x: 10,
          y: 14,
          width: 68,
          height: 68,
          href: '',
          opacity: 0,
        },
        avatarClip: {
          cx: 44,
          cy: 48,
          r: 34,
        },
        nameLabel: {
          x: 88,
          y: 14,
          textAnchor: 'start',
          dominantBaseline: 'hanging',
          fontSize: 13,
          fontWeight: 700,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--node-text)',
          text: 'Name',
        },
        positionLabel: {
          x: 88,
          y: 30,
          textAnchor: 'start',
          dominantBaseline: 'hanging',
          fontSize: 11,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-secondary)',
          text: '',
        },
        detailsLabel: {
          x: 88,
          y: 46,
          textAnchor: 'start',
          dominantBaseline: 'hanging',
          fontSize: 10,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fill: 'var(--text-muted)',
          text: '',
          lineHeight: 14,
        },
      },
      ports: {
        groups: {
          ...portGroups,
        },
        items: portItems,
      },
    },
    {
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'rect', selector: 'accentBar' },
        { tagName: 'rect', selector: 'accentBarMask' },
        { tagName: 'clipPath', selector: 'avatarClipPath', attributes: { id: 'avatar-clip-placeholder' }, children: [
          { tagName: 'circle', selector: 'avatarClip' },
        ]},
        { tagName: 'circle', selector: 'avatar' },
        { tagName: 'image', selector: 'avatarImage' },
        { tagName: 'text', selector: 'avatarText' },
        { tagName: 'text', selector: 'nameLabel' },
        { tagName: 'text', selector: 'positionLabel' },
        { tagName: 'text', selector: 'detailsLabel' },
        { tagName: 'g', selector: 'raciGroup' },
        { tagName: 'g', selector: 'tagsGroup' },
      ],
    }
  );

  // Custom view for OrgPerson — updates display based on model properties
  joint.shapes.sf.OrgPersonView = joint.dia.ElementView.extend({
    initialize() {
      joint.dia.ElementView.prototype.initialize.apply(this, arguments);
      this.listenTo(this.model, 'change:personName change:jobTitle change:email change:phone change:role change:stream change:location change:company change:detailOrder change:details change:imageUrl change:iconText change:tags change:raci change:vacant', () => this._updateCard());
    },
    render() {
      joint.dia.ElementView.prototype.render.apply(this, arguments);
      this._updateCard();
      return this;
    },
    update() {
      joint.dia.ElementView.prototype.update.apply(this, arguments);
      this._updateCard();
    },
    _updateCard() {
      const m = this.model;
      const name = m.get('personName') || 'Name';
      const pos = m.get('jobTitle') || '';
      // Description supports multi-line via newlines. Each line renders as its
      // own <tspan> so wrapping survives JointJS' silent-attr round-trip.
      const posLines = pos ? pos.split(/\n/) : [];
      const POS_LINE_H = 14;
      const POS_GAP = 12; // gap below last description line; bumped from 8 to
                          // sit comfortably under Safari's hanging-baseline
                          // text metrics, which run a hair lower than Chrome's
      const email = m.get('email') || '';
      const phone = m.get('phone') || '';
      const role = m.get('role') || '';
      const stream = m.get('stream') || '';
      const location = m.get('location') || '';
      const company = m.get('company') || '';
      const imageUrl = m.get('imageUrl') || '';
      const iconText = (m.get('iconText') || '').substring(0, 4);
      const hasPhoto = !!imageUrl;
      const hasCustomAvatar = hasPhoto || !!iconText;
      const tags = Array.isArray(m.get('tags')) ? m.get('tags').filter(Boolean) : [];
      const raci = m.get('raci') || {};
      const vacant = !!m.get('vacant');
      const TAG_ROW_H = 30; // pill row + 8px bottom margin

      // Standard avatar layout — consistent size for all persons
      // Padding from left border = padding from accent bar bottom (y=4)
      const PAD = 10;
      const avatarR = 34;
      const avatarCx = PAD + avatarR;   // 44 — left edge at 10
      const avatarCy = 4 + PAD + avatarR; // 48 — top edge at 14
      const textX = avatarCx + avatarR + PAD; // 88
      // Align name top with avatar top edge
      const nameY = avatarCy - avatarR;  // 14

      m.attr('avatar/r', avatarR, { silent: true });
      m.attr('avatar/cx', avatarCx, { silent: true });
      m.attr('avatar/cy', avatarCy, { silent: true });
      m.attr('avatarClip/r', avatarR, { silent: true });
      m.attr('avatarClip/cx', avatarCx, { silent: true });
      m.attr('avatarClip/cy', avatarCy, { silent: true });
      // Detail block sits below name + (multi-line) description. Cached so
      // height calc, silent attrs, and direct-DOM updates all agree.
      const detailStartY = pos
        ? nameY + 16 + posLines.length * POS_LINE_H + POS_GAP
        : nameY + 16;
      m.attr('nameLabel/x', textX, { silent: true });
      m.attr('nameLabel/y', nameY, { silent: true });
      m.attr('positionLabel/x', textX, { silent: true });
      m.attr('positionLabel/y', nameY + 16, { silent: true });
      m.attr('detailsLabel/x', textX, { silent: true });
      m.attr('detailsLabel/y', detailStartY, { silent: true });

      // Avatar text — icon text or name initials
      let displayText;
      if (hasPhoto) {
        displayText = '';
      } else if (iconText) {
        displayText = iconText;
        m.attr('avatar/fill', '#1D73C9', { silent: true });
        m.attr('avatarText/fill', '#FFFFFF', { silent: true });
        m.attr('avatarText/fontSize', iconText.length > 2 ? 14 : 18, { silent: true });
      } else {
        displayText = name.split(/\s+/).map(w => w[0]).join('').substring(0, 2).toUpperCase();
        m.attr('avatar/fill', '#E0E4E8', { silent: true });
        m.attr('avatarText/fill', 'var(--text-secondary)', { silent: true });
        m.attr('avatarText/fontSize', 18, { silent: true });
      }

      m.attr('avatarText/text', displayText, { silent: true });
      m.attr('avatarText/x', avatarCx, { silent: true });
      m.attr('avatarText/y', avatarCy, { silent: true });
      m.attr('nameLabel/text', name, { silent: true });
      m.attr('positionLabel/text', pos, { silent: true });

      // Image handling
      m.attr('avatarImage/opacity', hasPhoto ? 1 : 0, { silent: true });
      if (hasPhoto) {
        const imgSize = avatarR * 2;
        m.attr('avatarImage/x', avatarCx - avatarR, { silent: true });
        m.attr('avatarImage/y', avatarCy - avatarR, { silent: true });
        m.attr('avatarImage/width', imgSize, { silent: true });
        m.attr('avatarImage/height', imgSize, { silent: true });
        m.attr('avatarImage/href', imageUrl, { silent: true });
        m.attr('avatar/fill', 'transparent', { silent: true });
      }

      // Detail labels — built from the new `details` array (since v1.11).
      // Pre-v1.11 cells used hardcoded fields (email/phone/role/stream/...) ordered
      // by `detailOrder`. The view auto-migrates them into `details` on first
      // render so subsequent saves use the new shape; the legacy fields stay
      // on the cell untouched for forward-compat with rollbacks.
      const DETAIL_LABELS = { email: 'Email', phone: 'Phone', role: 'Role', stream: 'Stream', location: 'Location', company: 'Company' };
      const fieldValues = { email, phone, role, stream, location, company };
      let detailEntries = m.get('details');
      if (!Array.isArray(detailEntries) || detailEntries.length === 0) {
        const order = m.get('detailOrder') || ['email', 'phone', 'role', 'stream', 'location', 'company'];
        const migrated = order.map(key => ({
          label: DETAIL_LABELS[key] || key,
          value: fieldValues[key] || '',
        }));
        // Persist the migration so it ships into the next save / share.
        if (migrated.some(d => d.value)) {
          m.set('details', migrated, { silent: true });
          detailEntries = migrated;
        } else {
          detailEntries = [];
        }
      }
      // Hide entries with empty values (current behaviour).
      const details = detailEntries
        .filter(d => d && d.value && String(d.value).trim() !== '')
        .map(d => ({ label: String(d.label ?? ''), value: String(d.value ?? '') }));

      // Wrap each detail VALUE to the value-column width so long text shows in FULL (no ellipsis); the card
      // then grows in height to fit. Width is forced to >= 280 below, so wrap against that final width.
      const labelW = 52;   // value column starts at textX + labelW
      const valMaxChars = Math.max(6, Math.floor((Math.max(m.size().width, 280) - textX - 10 - labelW) / 5.5));
      const wrapValue = (text) => {
        const words = String(text).split(/\s+/).filter(Boolean);
        if (!words.length) return [''];
        const lines = []; let line = '';
        for (let w of words) {
          while (w.length > valMaxChars) {                       // a single over-long token: hard-break it
            if (line) { lines.push(line); line = ''; }
            lines.push(w.slice(0, valMaxChars)); w = w.slice(valMaxChars);
          }
          const next = line ? line + ' ' + w : w;
          if (next.length > valMaxChars && line) { lines.push(line); line = w; }
          else line = next;
        }
        if (line) lines.push(line);
        return lines.length ? lines : [''];
      };
      const detailWrapped = details.map(d => ({ label: d.label, value: d.value, lines: wrapValue(d.value) }));

      // Adapt height — auto-size based on content. Tag row, when present,
      // sits at the very bottom and adds a fixed extra slice. Each wrapped value line is 14px.
      const detailH = detailWrapped.reduce((s, d) => s + d.lines.length, 0) * 14;
      const contentH = detailStartY + detailH + 10;
      const avatarBottom = avatarCy + avatarR + 8;
      const tagsExtraH = tags.length > 0 ? TAG_ROW_H : 0;
      const totalH = Math.max(contentH, avatarBottom, 60) + tagsExtraH;
      let { width, height } = m.size();
      let sizeChanged = false;
      if (width < 280) { width = 280; sizeChanged = true; }
      if (Math.abs(height - totalH) > 1) { height = totalH; sizeChanged = true; }
      if (sizeChanged) {
        m.resize(width, height, { silent: true });
      }

      // Sync size-dependent SVG elements via direct DOM
      const bodyRect = this.el.querySelector('[joint-selector="body"]');
      if (bodyRect) {
        bodyRect.setAttribute('width', String(width));
        bodyRect.setAttribute('height', String(height));
      }
      const barEl = this.el.querySelector('[joint-selector="accentBar"]');
      if (barEl) barEl.setAttribute('width', String(width));
      const barMask = this.el.querySelector('[joint-selector="accentBarMask"]');
      if (barMask) barMask.setAttribute('width', String(width));

      // Force SVG update — direct DOM manipulation since attrs are set silently
      const nameEl = this.el.querySelector('[joint-selector="nameLabel"]');
      if (nameEl) {
        nameEl.textContent = name;
        nameEl.setAttribute('x', String(textX));
        nameEl.setAttribute('y', String(nameY));
        nameEl.setAttribute('dominant-baseline', 'hanging');
        // JointJS' renderer occasionally stamps `display="none"` on text
        // elements that were updated via silent attrs; clear it explicitly.
        nameEl.removeAttribute('display');
      }
      const avatarTextEl = this.el.querySelector('[joint-selector="avatarText"]');
      if (avatarTextEl) {
        avatarTextEl.textContent = displayText;
        avatarTextEl.setAttribute('x', String(avatarCx));
        avatarTextEl.setAttribute('y', String(avatarCy));
        const fs = hasPhoto ? 18 : iconText ? (iconText.length > 2 ? 14 : 18) : 18;
        avatarTextEl.setAttribute('font-size', String(fs));
      }
      const avatarEl = this.el.querySelector('[joint-selector="avatar"]');
      if (avatarEl) {
        avatarEl.setAttribute('r', String(avatarR));
        avatarEl.setAttribute('cx', String(avatarCx));
        avatarEl.setAttribute('cy', String(avatarCy));
        const fillColor = hasPhoto ? 'transparent' : iconText ? '#1D73C9' : '#E0E4E8';
        avatarEl.setAttribute('fill', fillColor);
      }
      const posEl = this.el.querySelector('[joint-selector="positionLabel"]');
      if (posEl) {
        // Clear and rebuild as tspans so newlines wrap correctly. SVG <text>
        // collapses literal \n to a space, so single-line textContent loses
        // multi-line descriptions entirely.
        posEl.textContent = '';
        posEl.setAttribute('x', String(textX));
        posEl.setAttribute('y', String(nameY + 16));
        posEl.setAttribute('dominant-baseline', 'hanging');
        posEl.removeAttribute('display');
        posLines.forEach((line, i) => {
          const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          tspan.setAttribute('x', String(textX));
          // Absolute y per line. Safari ignores the parent's
          // `dominant-baseline="hanging"` for the first tspan when only `dy`
          // is set, falling back to alphabetic — that pulls the first line up
          // ~9 px and overlaps the name. Setting `y` and re-asserting the
          // hanging baseline on every tspan keeps Chrome and Safari aligned.
          tspan.setAttribute('y', String(nameY + 16 + i * POS_LINE_H));
          tspan.setAttribute('dominant-baseline', 'hanging');
          tspan.textContent = line;
          posEl.appendChild(tspan);
        });
      }

      // Avatar image + clip path
      const clipPathEl = this.el.querySelector('[joint-selector="avatarClipPath"]');
      const imgEl = this.el.querySelector('[joint-selector="avatarImage"]');
      if (clipPathEl && imgEl) {
        const clipId = `avatar-clip-${m.id}`;
        clipPathEl.setAttribute('id', clipId);
        const clipCircle = clipPathEl.querySelector('circle');
        if (clipCircle) {
          clipCircle.setAttribute('cx', String(avatarCx));
          clipCircle.setAttribute('cy', String(avatarCy));
          clipCircle.setAttribute('r', String(avatarR));
        }
        imgEl.setAttribute('clip-path', `url(#${clipId})`);
        if (hasPhoto) {
          const imgSize = avatarR * 2;
          imgEl.setAttribute('x', String(avatarCx - avatarR));
          imgEl.setAttribute('y', String(avatarCy - avatarR));
          imgEl.setAttribute('width', String(imgSize));
          imgEl.setAttribute('height', String(imgSize));
          imgEl.setAttribute('href', imageUrl);
          imgEl.style.opacity = '1';
        } else {
          imgEl.style.opacity = '0';
        }
      }

      // Details — labels aligned, values WRAP onto extra lines (computed above as detailWrapped) so nothing
      // is truncated; the card height already accounts for the wrapped line count.
      const detailEl = this.el.querySelector('[joint-selector="detailsLabel"]');
      if (detailEl) {
        detailEl.textContent = '';
        detailEl.setAttribute('x', String(textX));
        detailEl.setAttribute('y', String(detailStartY));
        detailEl.setAttribute('dominant-baseline', 'hanging');
        detailEl.removeAttribute('display');
        detailWrapped.forEach((d, i) => {
          // Label tspan (muted) — shares the value's FIRST line.
          const labelSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          labelSpan.setAttribute('x', String(textX));
          labelSpan.setAttribute('dy', i === 0 ? '0' : '14');
          labelSpan.setAttribute('fill', 'var(--text-muted)');
          labelSpan.textContent = d.label + ':';
          detailEl.appendChild(labelSpan);
          // Value — one tspan per wrapped line; the first shares the label's line, the rest drop down 14px.
          d.lines.forEach((ln, li) => {
            const valSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            valSpan.setAttribute('x', String(textX + labelW));
            valSpan.setAttribute('dy', li === 0 ? '0' : '14');
            valSpan.setAttribute('fill', 'var(--text-secondary)');
            valSpan.textContent = ln;
            detailEl.appendChild(valSpan);
          });
        });
      }

      // ── Vacant state ────────────────────────────────────────
      // Dashed body + dashed/transparent avatar + faded text. Used as a
      // recruitment placeholder ("position to be filled") or a RACI slot
      // that hasn't been assigned yet.
      const bodyEl = this.el.querySelector('[joint-selector="body"]');
      if (bodyEl) {
        if (vacant) bodyEl.setAttribute('stroke-dasharray', '6 4');
        else bodyEl.removeAttribute('stroke-dasharray');
      }
      if (avatarEl) {
        if (vacant) {
          avatarEl.setAttribute('stroke-dasharray', '4 3');
          avatarEl.setAttribute('fill', 'transparent');
        } else {
          avatarEl.removeAttribute('stroke-dasharray');
          // (fill is set above based on photo/iconText state — restored on
          // toggle-off via the existing avatar-fill logic in this same pass)
        }
      }
      if (avatarTextEl) avatarTextEl.style.opacity = vacant ? '0.5' : '1';
      if (nameEl) nameEl.style.opacity = vacant ? '0.55' : '1';
      if (posEl) posEl.style.opacity = vacant ? '0.55' : '1';
      const detailLblEl = this.el.querySelector('[joint-selector="detailsLabel"]');
      if (detailLblEl) detailLblEl.style.opacity = vacant ? '0.55' : '1';

      // ── RACI pills (top-right) ──────────────────────────────
      // Each active role is a coloured letter pill with a <title> tooltip
      // for the full name. Pills only render when their role is set.
      const raciGroupEl = this.el.querySelector('[joint-selector="raciGroup"]');
      if (raciGroupEl) {
        raciGroupEl.innerHTML = '';
        const RACI_COLORS = { R: '#1D73C9', A: '#DA4E55', C: '#F6B355', I: '#8A9099' };
        const RACI_NAMES = { R: 'Responsible', A: 'Accountable', C: 'Consulted', I: 'Informed' };
        const active = ['R', 'A', 'C', 'I'].filter(k => raci[k]);
        if (active.length > 0) {
          const PILL = 16;
          const GAP = 3;
          const ns = 'http://www.w3.org/2000/svg';
          // Right-aligned, sitting just below the accent bar
          let xPos = width - 10 - active.length * PILL - (active.length - 1) * GAP;
          const yPos = 10;
          for (const key of active) {
            const g = document.createElementNS(ns, 'g');
            const rect = document.createElementNS(ns, 'rect');
            rect.setAttribute('x', String(xPos));
            rect.setAttribute('y', String(yPos));
            rect.setAttribute('width', String(PILL));
            rect.setAttribute('height', String(PILL));
            rect.setAttribute('rx', '4');
            rect.setAttribute('ry', '4');
            rect.setAttribute('fill', RACI_COLORS[key]);
            g.appendChild(rect);
            const text = document.createElementNS(ns, 'text');
            text.setAttribute('x', String(xPos + PILL / 2));
            text.setAttribute('y', String(yPos + PILL / 2 + 0.5));
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'central');
            text.setAttribute('fill', '#FFFFFF');
            text.setAttribute('font-size', '10');
            text.setAttribute('font-weight', '700');
            text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
            text.setAttribute('pointer-events', 'none');
            text.textContent = key;
            g.appendChild(text);
            const title = document.createElementNS(ns, 'title');
            title.textContent = RACI_NAMES[key];
            g.appendChild(title);
            raciGroupEl.appendChild(g);
            xPos += PILL + GAP;
          }
        }
      }

      // ── Tag pills (bottom row, full width, single line + ellipsis) ──
      // Background uses a theme-neutral semi-transparent grey — `var(--*)`
      // resolves unreliably when set via setAttribute, so a literal rgba
      // gives consistent pills in both light and dark modes.
      const tagsGroupEl = this.el.querySelector('[joint-selector="tagsGroup"]');
      if (tagsGroupEl) {
        tagsGroupEl.innerHTML = '';
        if (tags.length > 0) {
          const ns = 'http://www.w3.org/2000/svg';
          const PILL_H = 18;
          const PILL_PAD = 10;
          const GAP = 4;
          const FONT = 10;
          const PILL_FILL = 'rgba(127, 127, 127, 0.22)';
          const startX = 10;
          const yPos = totalH - PILL_H - 8;
          const maxX = width - 10;
          let curX = startX;
          for (let i = 0; i < tags.length; i++) {
            const tag = tags[i];
            const textW = Math.ceil(tag.length * 5.5);
            const pillW = textW + PILL_PAD * 2;
            if (curX + pillW > maxX && curX > startX) {
              const ellipsis = document.createElementNS(ns, 'g');
              const r = document.createElementNS(ns, 'rect');
              r.setAttribute('x', String(curX));
              r.setAttribute('y', String(yPos));
              r.setAttribute('width', '24');
              r.setAttribute('height', String(PILL_H));
              r.setAttribute('rx', '9');
              r.setAttribute('ry', '9');
              r.setAttribute('fill', PILL_FILL);
              ellipsis.appendChild(r);
              const t = document.createElementNS(ns, 'text');
              t.setAttribute('x', String(curX + 12));
              t.setAttribute('y', String(yPos + PILL_H / 2));
              t.setAttribute('text-anchor', 'middle');
              t.setAttribute('dominant-baseline', 'central');
              t.setAttribute('fill', 'var(--text-secondary)');
              t.setAttribute('font-size', String(FONT));
              t.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
              t.textContent = `+${tags.length - i}`;
              ellipsis.appendChild(t);
              const title = document.createElementNS(ns, 'title');
              title.textContent = tags.slice(i).join(', ');
              ellipsis.appendChild(title);
              tagsGroupEl.appendChild(ellipsis);
              break;
            }
            const g = document.createElementNS(ns, 'g');
            const rect = document.createElementNS(ns, 'rect');
            rect.setAttribute('x', String(curX));
            rect.setAttribute('y', String(yPos));
            rect.setAttribute('width', String(pillW));
            rect.setAttribute('height', String(PILL_H));
            rect.setAttribute('rx', '9');
            rect.setAttribute('ry', '9');
            rect.setAttribute('fill', PILL_FILL);
            g.appendChild(rect);
            const text = document.createElementNS(ns, 'text');
            // Centred horizontally + vertically inside the pill.
            text.setAttribute('x', String(curX + pillW / 2));
            text.setAttribute('y', String(yPos + PILL_H / 2));
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'central');
            text.setAttribute('fill', 'var(--text-secondary)');
            text.setAttribute('font-size', String(FONT));
            text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
            text.textContent = tag;
            g.appendChild(text);
            tagsGroupEl.appendChild(g);
            curX += pillW + GAP;
          }
        }
      }
    },
  });

}

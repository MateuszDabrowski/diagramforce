// Pre-built Salesforce architecture templates
// Each template is a config object describing a diagram element

import { getIconDataUri } from './icons.js?v=1.8.2';

/** Convert inline stencilSvg markup to a data URI for use as a canvas icon.
 *  Each child element must carry its own fill/stroke — the wrapper SVG sets NO
 *  defaults so nothing leaks into text or explicitly-styled elements. */
export function getStencilSvgDataUri(svgContent, color = '#FFFFFF', size = 32) {
  // Sanitize color before interpolation into SVG markup
  const safeColor = color.replace(/[^a-zA-Z0-9#(),.\s%-]/g, '');
  const svg = svgContent.replace(/currentColor/g, safeColor);
  const full = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="${size}" height="${size}">${svg}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(full);
}

/** Extract a display hostname from a URL string for the sf.Link subtitle.
 *  Strips a leading "www.". Empty string if the URL is missing or invalid. */
export function extractLinkDomain(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const normalized = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(normalized).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// WCAG luminance-based contrast — returns dark or white text for a given bg
export function contrastTextColor(bgHex) {
  if (!bgHex || bgHex.startsWith('var(')) return null;
  const hex = bgHex.replace('#', '');
  if (hex.length !== 6) return null;
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const toLinear = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return L > 0.179 ? '#1C1E21' : '#FFFFFF';
}

function node(label, iconName, options = {}) {
  return { type: 'sf.SimpleNode', label, iconName, ...options };
}

function container(label, iconName, accentColor, options = {}) {
  return { type: 'sf.Container', label, iconName, accentColor, ...options };
}

// Stencil SVG icons (20×20 viewBox, stroke-based, no fill by default)
export const SVG = {
  node:       '<rect x="3" y="4" width="14" height="12" rx="3" /><circle cx="10" cy="10" r="2" fill="currentColor" stroke="none"/>',
  container:  '<rect x="2" y="3" width="16" height="14" rx="2" /><line x1="2" y1="7" x2="18" y2="7"/><circle cx="5.5" cy="5" r="1" fill="currentColor" stroke="none"/>',
  text:       '<line x1="5" y1="4" x2="15" y2="4"/><line x1="10" y1="4" x2="10" y2="16"/><line x1="7" y1="16" x2="13" y2="16"/>',
  note:       '<path d="M4 3h9l3 3v11H4z"/><path d="M13 3v3h3"/>',
  zone:       '<rect x="2" y="3" width="16" height="14" rx="1" stroke-dasharray="3 2"/><line x1="4" y1="6" x2="10" y2="6" stroke-width="1" opacity="0.5"/>',
  line:       '<line x1="2" y1="10" x2="18" y2="10" stroke-width="2" stroke-linecap="round"/>',
  // linkIcon — external-link glyph (SVG Repo "External_Link"), translated to crop
  // the 24×24 source into the 20×20 viewBox and with the arrow head pulled one
  // unit toward the shape centre (M19 5 instead of M20 4).
  linkIcon:   '<g transform="translate(-3 -2)" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.0002 5H8.2002C7.08009 5 6.51962 5 6.0918 5.21799C5.71547 5.40973 5.40973 5.71547 5.21799 6.0918C5 6.51962 5 7.08009 5 8.2002V15.8002C5 16.9203 5 17.4801 5.21799 17.9079C5.40973 18.2842 5.71547 18.5905 6.0918 18.7822C6.5192 19 7.07899 19 8.19691 19H15.8031C16.921 19 17.48 19 17.9074 18.7822C18.2837 18.5905 18.5905 18.2839 18.7822 17.9076C19 17.4802 19 16.921 19 15.8031V14M19 9V5M19 5H15M19 5L13 11"/></g>',
  // link — stencil thumbnail: terminator pill with ONLY the arrow portion of the
  // external-link glyph centered inside (no inner square — readable at 20×20).
  link:       '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="5" width="18" height="10" rx="5" stroke-width="1.5"/><path d="M7.5 12.5 L12.5 7.5 M10 7.5 H12.5 V10" stroke-width="1.3"/></g>',
  // Flowchart
  flowProcess:    '<rect x="2" y="4" width="16" height="12" rx="2"/>',
  flowDecision:   '<path d="M10 3L18 10L10 17L2 10Z"/>',
  flowTerminator: '<rect x="2" y="5" width="16" height="10" rx="5"/><rect x="8" y="8" width="4" height="4" rx="0.5" fill="currentColor" stroke="none"/>',
  flowDatabase:   '<ellipse cx="10" cy="6" rx="7" ry="3"/><path d="M3 6v8c0 1.66 3.13 3 7 3s7-1.34 7-3V6" fill="none"/>',
  flowDocument:   '<path d="M3 4h14v10c-2.3-1.5-4.7-1.5-7 0s-4.7 1.5-7 0z"/>',
  flowIO:         '<path d="M6 4h12l-4 12H2z"/>',
  flowPredefined: '<rect x="2" y="4" width="16" height="12" rx="1"/><line x1="5" y1="4" x2="5" y2="16"/><line x1="15" y1="4" x2="15" y2="16"/>',
  // Org
  orgPerson:     '<rect x="2" y="3" width="16" height="14" rx="3"/><line x1="2" y1="6" x2="18" y2="6" stroke-width="1.5"/><circle cx="7" cy="11" r="2" stroke-width="0.8"/><line x1="11" y1="10" x2="16" y2="10" stroke-width="1"/><line x1="11" y1="13" x2="15" y2="13" stroke-width="0.8" opacity="0.5"/>',
  orgDepartment: '<rect x="2" y="3" width="16" height="14" rx="1" stroke-dasharray="3 2"/><circle cx="7" cy="8" r="1.5" stroke-width="0.8"/><circle cx="13" cy="8" r="1.5" stroke-width="0.8"/><circle cx="10" cy="13" r="1.5" stroke-width="0.8"/>',
  orgTeam:       '<rect x="2" y="3" width="16" height="14" rx="2"/><rect x="2" y="5" width="2" height="10" rx="1" fill="currentColor" stroke="none" opacity="0.6"/><text x="7" y="8" font-size="4" font-weight="bold" fill="currentColor" stroke="none" opacity="0.5">Team</text><circle cx="8" cy="13" r="1.5" stroke-width="0.8"/><circle cx="13" cy="13" r="1.5" stroke-width="0.8"/>',
  // BPMN Events
  eventStart:        '<circle cx="10" cy="10" r="7" stroke-width="1.5"/>',
  eventEnd:          '<circle cx="10" cy="10" r="7" stroke-width="4"/>',
  eventIntermediate: '<circle cx="10" cy="10" r="7" stroke-width="1.5"/><circle cx="10" cy="10" r="4.5" stroke-width="1.5"/>',
  // BPMN Activities
  task:       '<rect x="2" y="4" width="16" height="12" rx="3"/>',
  subprocess: '<rect x="2" y="4" width="16" height="12" rx="3"/><rect x="7.5" y="12" width="5" height="3.5" rx="0.5" fill="none" stroke-width="0.8"/><line x1="10" y1="12.5" x2="10" y2="15" stroke-width="0.8"/><line x1="8.5" y1="13.75" x2="11.5" y2="13.75" stroke-width="0.8"/>',
  loop:       '<rect x="2" y="4" width="16" height="12" rx="3"/><use href="#refresh" x="7" y="11" width="6" height="6" fill="currentColor"/>',
  // BPMN Gateways
  gatewayExcl: '<path d="M10 2L18 10L10 18L2 10Z"/><path d="M7.5 7.5l5 5M12.5 7.5l-5 5" stroke-width="1.5"/>',
  gatewayPar:  '<path d="M10 2L18 10L10 18L2 10Z"/><line x1="10" y1="6" x2="10" y2="14" stroke-width="1.5"/><line x1="6" y1="10" x2="14" y2="10" stroke-width="1.5"/>',
  gatewayIncl: '<path d="M10 2L18 10L10 18L2 10Z"/><circle cx="10" cy="10" r="3" stroke-width="1.5"/>',
  gatewayEvt:  '<path d="M10 2L18 10L10 18L2 10Z"/><circle cx="10" cy="10" r="3.5" stroke-width="1"/><circle cx="10" cy="10" r="2" stroke-width="1"/>',
  // BPMN other
  dataObject: '<path d="M5 2h7l3 3v13H5z"/><path d="M12 2v3h3"/>',
  poolH:      '<rect x="1" y="4" width="18" height="12" rx="1"/><line x1="5" y1="4" x2="5" y2="16"/>',
  poolV:      '<rect x="1" y="2" width="18" height="16" rx="1"/><line x1="1" y1="6" x2="19" y2="6"/>',
  flowStart:  '<rect x="2" y="5" width="16" height="10" rx="5"/><path d="M8 8l4 2-4 2z" fill="currentColor" stroke="none"/>',
  flowOffPage: '<path d="M4 3h12v8l-6 6-6-6z"/>',
  annotation: '<line x1="2" y1="8" x2="10" y2="8" stroke-width="1" opacity="0.5"/><line x1="2" y1="11" x2="8" y2="11" stroke-width="1" opacity="0.5"/><path d="M18 3 Q14 3 14 6 L14 8.5 Q14 10 12 10 Q14 10 14 11.5 L14 14 Q14 17 18 17" fill="none"/>',
  // Data Model
  dataTable:  '<rect x="2" y="3" width="16" height="14" rx="2"/><rect x="2" y="3" width="16" height="5" rx="2" fill="currentColor" stroke="none" opacity="0.4"/><line x1="5" y1="11" x2="15" y2="11" stroke-width="1" opacity="0.4"/><line x1="5" y1="14" x2="12" y2="14" stroke-width="1" opacity="0.4"/>',
  // Sequence Diagram
  seqParticipant: '<rect x="3" y="2" width="14" height="5" rx="1"/><line x1="10" y1="7" x2="10" y2="18" stroke-dasharray="2 2"/>',
  seqActor:       '<circle cx="10" cy="4" r="2" stroke-width="1.2"/><line x1="10" y1="6" x2="10" y2="11" stroke-width="1.2"/><line x1="7" y1="8" x2="13" y2="8" stroke-width="1.2"/><line x1="10" y1="11" x2="8" y2="13" stroke-width="1.2"/><line x1="10" y1="11" x2="12" y2="13" stroke-width="1.2"/><line x1="10" y1="14" x2="10" y2="18" stroke-dasharray="2 2"/>',
  seqActivation:  '<rect x="8" y="3" width="4" height="14" fill="currentColor" stroke="none" opacity="0.4"/><rect x="8" y="3" width="4" height="14" stroke-width="1"/>',
  seqFragment:    '<rect x="2" y="3" width="16" height="14" rx="1"/><path d="M2 3 L8 3 L9 5 L9 7 L2 7 Z" fill="currentColor" stroke="none" opacity="0.2"/><text x="3" y="6" font-size="3" font-weight="bold" fill="currentColor" stroke="none">loop</text>',
};

export const TEMPLATE_CATEGORIES = [
  {
    id: 'generic',
    label: 'Generic Shapes',
    templates: [
      { type: 'sf.SimpleNode',  label: 'Node',       iconName: null, stencilSvg: SVG.node, noCanvasIcon: true },
      { type: 'sf.Container',   label: 'Container',  iconName: null, accentColor: '#1D73C9', stencilSvg: SVG.container },
      { type: 'sf.Zone',        label: 'Zone',       stencilSvg: SVG.zone  },
      { type: 'sf.Note',        label: 'Note',       stencilSvg: SVG.note  },
      { type: 'sf.TextLabel',   label: 'Text',       stencilSvg: SVG.text  },
      { type: 'sf.Annotation',  label: 'Annotation', stencilSvg: SVG.annotation },
      { type: 'sf.Line',        label: 'Line',       stencilSvg: SVG.line  },
      { type: 'sf.Link',        label: 'Link',       url: 'https://', stencilSvg: SVG.link },
    ],
  },
  // ── Salesforce Products ────────────────────────────────────────────
  {
    id: 'sf-products',
    label: 'Salesforce Products',
    templates: [
      // Salesforce product icons — stroke-based outlines for clarity at small sizes
      // Sales keeps fill-based traced SVG; others use simple 20×20 stroke icons
      node('Sales',        null, { bg: '#032E61', stencilSvg: '<g transform="translate(0.5,0.5) scale(0.297)" fill="currentColor"><path d="M55,7H9c-1.1,0-2,.9-2,2V55c0,1.1,.9,2,2,2H55c1.1,0,2-.9,2-2V9c0-1.1-.9-2-2-2Zm-2,46h-7v-6c0-1.1-.9-2-2-2s-2,.9-2,2v6h-8v-6c0-1.1-.9-2-2-2s-2,.9-2,2v6h-8v-6c0-1.1-.9-2-2-2s-2,.9-2,2v6h-7V11H53V53Z"/><path d="M26.65,37.36c.78,.78,2.04,.78,2.82,0l12.53-12.52v9.16c0,1.1,.9,2,2,2s2-.9,2-2v-14c0-1.1-.9-2-2-2h-14c-1.1,0-2,.9-2,2s.9,2,2,2h9.17l-11.17,11.12-6.59-6.53c-.78-.78-2.04-.78-2.82,0l-7.59,7.59v5.64l9-9,6.65,6.54Z"/></g>' }),
      node('Service',      null, { bg: '#8A033E', stencilSvg: '<g transform="translate(10,10) scale(1.2) translate(-10,-10)"><path d="M10 16L4.5 10.5a3.5 3.5 0 1 1 5-5l.5.5.5-.5a3.5 3.5 0 1 1 5 5Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></g>' }),
      node('Marketing',    null, { bg: '#DD7A01', stencilSvg: '<g transform="translate(0.5,0.5) scale(0.297)" fill="currentColor"><path d="M59.41,51.58l-9.82-9.82c2.16-3.4,3.41-7.43,3.41-11.76,0-12.15-9.85-22-22-22S9,17.85,9,30s9.85,22,22,22c3.81,0,7.39-.97,10.51-2.67l10.08,10.08c.37,.38,.88,.59,1.41,.59,.53,0,1.04-.21,1.41-.59l5-5c.78-.78,.78-2.05,0-2.83Z M31,12c9.94,0,18,8.06,18,18s-8.06,18-18,18-18-8.06-18-18S21.06,12,31,12Z" fill-rule="evenodd"/><circle cx="31" cy="26" r="6"/><path d="M31,36c-4.97,0-9,4.03-9,9,0,.18-.03,.36-.08,.52,2.67,1.56,5.76,2.48,9.08,2.48s6.41-.91,9.08-2.48c-.05-.17-.08-.34-.08-.52,0-4.97-4.03-9-9-9Z"/></g>' }),
      node('Commerce',     null, { bg: '#396547', stencilSvg: '<g transform="translate(10,10) scale(1.1) translate(-10,-10)"><path d="M3 3h2l2.5 8.5h7.5L17.5 5H7" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="8" cy="15" r="1.2" fill="currentColor" stroke="none"/><circle cx="14" cy="15" r="1.2" fill="currentColor" stroke="none"/></g>' }),
      node('Data',         null, { bg: '#321D71', stencilSvg: '<g transform="translate(0.5,0.5) scale(0.297)" fill="currentColor"><path d="M32,58.54c14.66,0,26.54-11.88,26.54-26.54S46.66,5.46,32,5.46,5.46,17.34,5.46,32s11.88,26.54,26.54,26.54Z M32,9.25c-12.51,0-22.75,10.24-22.75,22.75s10.24,22.75,22.75,22.75,22.75-10.24,22.75-22.75S44.51,9.25,32,9.25Z" fill-rule="evenodd"/><circle cx="32" cy="15.89" r="2.37"/><circle cx="15.89" cy="32" r="2.37"/><circle cx="48.11" cy="32" r="2.37"/><circle cx="24" cy="17" r="2.37"/><circle cx="40" cy="17" r="2.37"/><circle cx="19" cy="23" r="2.37"/><circle cx="45" cy="23" r="2.37"/><circle cx="19" cy="41" r="2.37"/><circle cx="45" cy="41" r="2.37"/><circle cx="32" cy="32" r="6.63"/><path d="M32,42.52c-5.4,0-9.86,4.45-9.86,9.86v.09c2.94,1.42,6.35,2.27,9.86,2.27s6.92-.85,9.86-2.27v-.09c0-5.5-4.45-9.86-9.86-9.86Z"/></g>' }),
      node('Agentforce',   null, { bg: '#032D60', stencilSvg: '<g transform="translate(0.5,0.5) scale(0.297)" fill="currentColor"><path d="M53.47,18.83c-.93-1.17-1.97-2.26-3.09-3.25,1.81-.8,3.08-2.61,3.08-4.72,0-2.86-2.31-5.17-5.17-5.17s-5.17,2.31-5.17,5.17c0,.05,0,.1.02,.14-2.54-1.09-5.27-1.82-8.09-2.13-5.03-.55-9.89.25-14.18,2.09,0-.04,0-.07,0-.11,0-2.86-2.31-5.17-5.17-5.17s-5.17,2.31-5.17,5.17c0,2.1,1.25,3.89,3.05,4.71-4.34,3.85-7.33,9.07-8.07,15.03-.78,6.26,1,12.5,5.01,17.57,4.38,5.54,11.09,9.17,18.43,9.97,1.04,.12,2.08,.17,3.11,.17,13.32,0,24.85-9.3,26.42-21.89.78-6.26-1-12.5-5.01-17.57Z M32,17.1c-.78,0-1.56.04-2.33.12-.93.1-1.71.68-2.07,1.58-.69,1.75.42,4.2,1.78,6.27-.44-.08-.92-.19-1.43-.36-2.79-.89-5.26-3.86-5.29-3.89-.62-.75-1.69-.93-2.51-.41-5.12,3.21-8.18,8.35-8.18,13.77,0,9.42,8.97,17.07,20.02,17.07s20.02-7.66,20.02-17.07-8.97-17.07-20.02-17.07Z" fill-rule="evenodd"/><path d="M43.88,33.93c-.28-.17-.57-.35-.87-.47-2.45-1-4.96-.97-7.46-.3-1.19.32-2.38.56-3.57.57-1.19,0-2.38-.25-3.57-.57-2.5-.67-5.02-.7-7.46.3-.31.13-.6.29-.87.47-.53.34-.77.78-.65,1.45.23,1.25.38,2.53.61,3.78.23,1.24,1.06,2.09,2.31,2.21,1.71.16,3.43.25,5.15.28,1.38.03,2.36-.6,2.75-2,.37-1.29.74-2.58,1.17-3.86.09-.27.38-.47.58-.7.19.23.49.43.58.7.42,1.28.8,2.57,1.17,3.86.39,1.41,1.38,2.03,2.75,2,1.71-.03,3.44-.12,5.15-.28,1.25-.12,2.09-.97,2.31-2.21.23-1.26.38-2.53.61-3.78.13-.66-.13-1.12-.65-1.45Z"/></g>' }),
      node('Experience',   null, { bg: '#032D60', stencilSvg: '<g transform="translate(10,10) scale(1.15) translate(-10,-10)"><circle cx="10" cy="6" r="3" fill="none" stroke="currentColor" stroke-width="1.15"/><path d="M4 17.5v-2c0-2.8 2.7-5 6-5s6 2.2 6 5v2" fill="none" stroke="currentColor" stroke-width="1.15"/></g>' }),
      node('Field Service', null, { bg: '#8A033E', stencilSvg: '<g transform="translate(10,10) scale(1.15) translate(-10,-10)"><path d="M10 18s-5.5-6-5.5-9.5a5.5 5.5 0 0 1 11 0c0 3.5-5.5 9.5-5.5 9.5z" fill="none" stroke="currentColor" stroke-width="1.15"/><circle cx="10" cy="8.5" r="2" fill="currentColor" stroke="none"/></g>' }),
      node('Net Zero',     null, { bg: '#194E31', stencilSvg: '<path d="M10 2l6 7h-3l3 5H4l3-5H4z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><line x1="10" y1="14" x2="10" y2="18" stroke="currentColor" stroke-width="1.5"/>' }),
      node('Revenue',      'forecasts',        { bg: '#E07D1A' }),
      node('Platform',     null, { bg: '#200647', stencilSvg: '<g transform="translate(10,10) scale(1.1) translate(-10,-10)"><path d="M11.5 2H7L4 10h4l-2 8 9-10h-5z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></g>' }),
      node('Tableau',      null, { bg: '#E97628', stencilSvg: '<g transform="translate(0.5,0.5) scale(0.297)" fill="currentColor"><path d="M40.75,33.28h-7.26v7.9h-2.88v-7.9h-7.26v-2.78h7.26v-7.9h2.88v7.9h7.26v2.78Z"/><path d="M26.13,43.42h-6.51v-7.15h-2.46v7.15h-6.62v2.14h6.62v7.05h2.46v-7.05h6.51v-2.14Z"/><path d="M53.46,18.01h-6.51v-7.05h-2.46v7.05h-6.51v2.24h6.51v7.05h2.46v-7.05h6.51v-2.24Z"/><path d="M37.55,51.22h-4.38v-4.91h-2.14v4.91h-4.48v1.92h4.48v5.02h2.14v-5.02h4.38v-1.92Z"/><path d="M26.13,18.01h-6.62v-7.05h-2.35v7.05h-6.62v2.14h6.62v7.15h2.35v-7.15h6.62v-2.14Z"/><path d="M58.48,30.93h-4.38v-4.91h-2.14v4.91h-4.48v1.92h4.48v4.91h2.14v-4.91h4.38v-1.92Z"/><path d="M53.46,43.42h-6.51v-7.15h-2.46v7.15h-6.51v2.14h6.51v7.05h2.46v-7.05h6.51v-2.14Z"/><path d="M37.23,10.75h-4.38v-4.91h-1.6v4.91h-4.38v1.49h4.38v4.8h1.6v-4.8h4.38v-1.49Z"/><path d="M15.88,31.15h-4.38v-4.8h-1.6v4.8h-4.38v1.49h4.38v4.8h1.6v-4.8h4.38v-1.49Z"/></g>' }),
      node('Slack',        null, { bg: '#611F69', stencilSvg: '<g transform="translate(0.5,0.5) scale(0.297)" fill="currentColor"><path d="M16.34,39.13c0,3.12-2.55,5.68-5.68,5.68s-5.68-2.55-5.68-5.68,2.55-5.68,5.68-5.68h5.68v5.68Z"/><path d="M19.2,39.13c0-3.12,2.55-5.68,5.68-5.68s5.68,2.55,5.68,5.68v14.21c0,3.12-2.55,5.68-5.68,5.68s-5.68-2.55-5.68-5.68v-14.21Z"/><path d="M24.87,16.34c-3.12,0-5.68-2.55-5.68-5.68s2.55-5.68,5.68-5.68,5.68,2.55,5.68,5.68v5.68h-5.68Z"/><path d="M24.87,19.2c3.12,0,5.68,2.55,5.68,5.68s-2.55,5.68-5.68,5.68H10.66c-3.12,0-5.68-2.55-5.68-5.68s2.55-5.68,5.68-5.68h14.21Z"/><path d="M47.66,24.87c0-3.12,2.55-5.68,5.68-5.68s5.68,2.55,5.68,5.68-2.55,5.68-5.68,5.68h-5.68v-5.68Z"/><path d="M44.8,24.87c0,3.12-2.55,5.68-5.68,5.68s-5.68-2.55-5.68-5.68V10.66c0-3.12,2.55-5.68,5.68-5.68s5.68,2.55,5.68,5.68v14.21Z"/><path d="M39.13,47.66c3.12,0,5.68,2.55,5.68,5.68s-2.55,5.68-5.68,5.68-5.68-2.55-5.68-5.68v-5.68h5.68Z"/><path d="M39.13,44.8c-3.12,0-5.68-2.55-5.68-5.68s2.55-5.68,5.68-5.68h14.21c3.12,0,5.68,2.55,5.68,5.68s-2.55,5.68-5.68,5.68h-14.21Z"/></g>' }),
      node('MuleSoft',     null, { bg: '#00004C', stencilSvg: '<g transform="translate(0.5,0.5) scale(0.297)" fill="currentColor"><path d="M32,58.29c14.52,0,26.29-11.77,26.29-26.29S46.52,5.71,32,5.71,5.71,17.48,5.71,32s11.77,26.29,26.29,26.29Z M32,56.22c-13.33.09-24.13-10.61-24.22-23.94-.09-13.33,10.7-24.13,24.03-24.22,13.33-.09,24.13,10.7,24.22,23.94v.09c0,13.33-10.8,24.13-24.03,24.13Z" fill-rule="evenodd"/><path d="M25.33,43.83c-4.13-2.07-6.76-6.38-6.76-10.98,0-2.44.75-4.88,2.07-6.95l8.64,12.95h5.26l8.64-12.95c1.31,2.07,2.07,4.51,2.07,6.95,0,4.32-2.25,8.36-5.91,10.61l1.69,6.38c9.67-5.07,13.52-16.99,8.45-26.75-1.69-3.29-4.22-6.01-7.42-7.89l-10.04,15.58-9.95-15.58c-9.39,5.54-12.58,17.65-6.95,27.04,2.07,3.38,5.07,6.2,8.64,7.89l1.6-6.29Z"/></g>' }),
      node('Informatica',  null,                   { bg: '#FF4D00', stencilSvg: '<g transform="translate(1.5,1.5) scale(0.25)" fill="currentColor"><g transform="matrix(0.838,0,0,0.827,0,0)"><polygon points="34.29,45.02 57.26,58.04 58.11,48.14 51.74,41.26 42.33,39.68"/><polygon points="38.17,0 57.26,58.04 76.34,38.69"/><polygon points="35.1,30.74 34.3,45.02 63.63,38.69"/><polygon points="20.38,59.35 24.18,54.2 23.49,48.01 14.14,41.86 0,38.69"/><polygon points="0,38.69 23.49,48.01 36.11,2.1"/><polygon points="23.49,48.01 20.38,59.35 38.17,77.39 54.89,60.44"/></g></g>' }),
      node('AppExchange',  null, { bg: '#E4A201', stencilSvg: '<g transform="translate(0.5,0.5) scale(0.297)" fill="currentColor"><path d="M49.25,5.55h-25.3c-5.06,0-9.2,4.14-9.2,9.2-5.06,0-9.2,4.14-9.2,9.2v25.3c0,5.06,4.14,9.2,9.2,9.2h25.3c5.06,0,9.2-4.14,9.2-9.2,5.06,0,9.2-4.14,9.2-9.2V14.75c0-5.06-4.14-9.2-9.2-9.2Z M53.85,40.05c0,2.53-2.07,4.6-4.6,4.6h-25.3c-2.53,0-4.6-2.07-4.6-4.6V14.75c0-2.53,2.07-4.6,4.6-4.6h25.3c2.53,0,4.6,2.07,4.6,4.6v25.3Z" fill-rule="evenodd"/><path d="M46.95,25.1h-8.05v-8.05c0-1.27-1.04-2.3-2.3-2.3s-2.3,1.03-2.3,2.3v8.05h-8.05c-1.27,0-2.3,1.04-2.3,2.3s1.03,2.3,2.3,2.3h8.05v8.05c0,1.27,1.04,2.3,2.3,2.3s2.3-1.03,2.3-2.3v-8.05h8.05c1.27,0,2.3-1.04,2.3-2.3s-1.03-2.3-2.3-2.3Z"/></g>' }),
    ],
  },
  // ── Industries ─────────────────────────────────────────────────────
  {
    id: 'industries',
    label: 'Industries',
    collapsed: true,
    templates: [
      node('Financial Services',   'money',            { bg: '#1A5276' }),
      node('Health',               'heart',            { bg: '#E74C3C' }),
      node('Life Sciences',        'life_sciences',    { bg: '#27AE60' }),
      node('Manufacturing',        'product_item',     { bg: '#5D6D7E' }),
      node('Consumer Goods',       'store',            { bg: '#E67E22' }),
      node('Retail',               'shopping_bag',     { bg: '#9B59B6' }),
      node('Communications',       'wifi',             { bg: '#2980B9' }),
      node('Media',                'video',            { bg: '#8E44AD' }),
      node('Energy & Utilities',   null,               { bg: '#F39C12', stencilSvg: '<g transform="translate(10,10) scale(1.2) translate(-10,-10)"><path d="M11 3H8L5 10h3.5L7 17l8-9h-4.5z" fill="none" stroke="currentColor" stroke-width="1.0" stroke-linejoin="round"/></g>' }),
      node('Public Sector',        'data_governance',  { bg: '#1F618D' }),
      node('Education',            'education',        { bg: '#16A085' }),
      node('Nonprofit',            'patient_service',  { bg: '#E74C3C' }),
      node('Automotive',           'transport_light_truck', { bg: '#2C3E50' }),
      node('Travel & Hospitality', 'plane',            { bg: '#3498DB' }),
    ],
  },
  // ── Generic Architecture ───────────────────────────────────────────
  {
    id: 'generic-arch',
    label: 'Generic Architecture',
    templates: [
      node('Mobile App',            'phone_portrait',    { bg: '#333333' }),
      node('Web App',               'desktop_and_phone', { bg: '#333333' }),
      node('E-commerce Storefront', 'store',             { bg: '#64A1D9' }),
      node('IoT Device',            'iot_orchestrations', { bg: '#555555' }),
      node('CDN',                   'wifi',              { bg: '#555555' }),
      node('Identity Provider',     'identity',          { bg: '#555555' }),
      node('API Gateway',           'data_integration_hub', { bg: '#2A9D8F' }),
      node('Data Lake',             'data_lake_objects',  { bg: '#1B4965' }),
      node('Data Warehouse',        'database',          { bg: '#293241' }),
    ],
  },
  // ── External Systems ───────────────────────────────────────────────
  {
    id: 'external',
    label: 'External Systems',
    templates: [
      node('Snowflake',     'client', { bg: '#29B5E8', stencilSvg: '<g transform="translate(10,10) scale(1.1) translate(-10,-10)"><circle cx="10" cy="10" r="2.5" fill="currentColor" stroke="none"/><circle cx="10" cy="4" r="1.5" fill="currentColor" stroke="none"/><circle cx="10" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="4.8" cy="7" r="1.5" fill="currentColor" stroke="none"/><circle cx="15.2" cy="7" r="1.5" fill="currentColor" stroke="none"/><circle cx="4.8" cy="13" r="1.5" fill="currentColor" stroke="none"/><circle cx="15.2" cy="13" r="1.5" fill="currentColor" stroke="none"/><line x1="10" y1="5.5" x2="10" y2="7.5" stroke="currentColor" stroke-width="0.9"/><line x1="10" y1="12.5" x2="10" y2="14.5" stroke="currentColor" stroke-width="0.9"/><line x1="6.2" y1="7.8" x2="8" y2="8.8" stroke="currentColor" stroke-width="0.9"/><line x1="12" y1="11.2" x2="13.8" y2="12.2" stroke="currentColor" stroke-width="0.9"/><line x1="6.2" y1="12.2" x2="8" y2="11.2" stroke="currentColor" stroke-width="0.9"/><line x1="12" y1="8.8" x2="13.8" y2="7.8" stroke="currentColor" stroke-width="0.9"/></g>' }),
      node('AWS',           'client', { bg: '#FF9900', stencilSvg: '<text x="10" y="10.5" text-anchor="middle" font-size="7.5" font-weight="900" fill="currentColor" stroke="none" font-family="system-ui" letter-spacing="-0.5">aws</text><g transform="translate(0.5,4.8) scale(0.0658)" fill="currentColor"><path d="M273.5,143.7c-32.9,24.3-80.7,37.2-121.8,37.2c-57.6,0-109.5-21.3-148.7-56.7c-3.1-2.8-0.3-6.6,3.4-4.4c42.4,24.6,94.7,39.5,148.8,39.5c36.5,0,76.6-7.6,113.5-23.2C274.2,133.6,278.9,139.7,273.5,143.7z"/><path d="M287.2,128.1c-4.2-5.4-27.8-2.6-38.5-1.3c-3.2,0.4-3.7-2.4-0.8-4.5c18.8-13.2,49.7-9.4,53.3-5c3.6,4.5-1,35.4-18.6,50.2c-2.7,2.3-5.3,1.1-4.1-1.9C282.5,155.7,291.4,133.4,287.2,128.1z"/></g>' }),
      node('Google Cloud',  'client', { bg: '#4285F4', stencilSvg: '<g transform="translate(0.5,0.3) scale(0.15)" fill="currentColor"><path d="M80.6 40.3h.4l-.2-.2 14-14v-.3c-11.8-10.4-28.1-14-43.2-9.5C36.5 20.8 24.9 32.8 20.7 48c.2-.1.5-.2.8-.2 5.2-3.4 11.4-5.4 17.9-5.4 2.2 0 4.3.2 6.4.6.1-.1.2-.1.3-.1 9-9.9 24.2-11.1 34.6-2.6h-.1z"/><path d="M108.1 47.8c-2.3-8.5-7.1-16.2-13.8-22.1L80 39.9c6 4.9 9.5 12.3 9.3 20v2.5c16.9 0 16.9 25.2 0 25.2H63.9v20h-.1l.1.2h25.4c14.6.1 27.5-9.3 31.8-23.1 4.3-13.8-1-28.8-13-36.9z"/><path d="M39 107.9h26.3V87.7H39c-1.9 0-3.7-.4-5.4-1.1l-15.2 14.6v.2c6 4.3 13.2 6.6 20.7 6.6z"/><path d="M40.2 41.9c-14.9.1-28.1 9.3-32.9 22.8-4.8 13.6 0 28.5 11.8 37.3l15.6-14.9c-8.6-3.7-10.6-14.5-4-20.8 6.6-6.4 17.8-4.4 21.7 3.8L68 55.2C61.4 46.9 51.1 42 40.2 42.1z"/></g>' }),
      node('Azure',         'client', { bg: '#0078D4', stencilSvg: '<g transform="translate(1,0.5) scale(0.19)" fill="currentColor"><path d="M33.338 6.544h26.038l-27.03 80.087a4.152 4.152 0 0 1-3.933 2.824H8.149a4.145 4.145 0 0 1-3.928-5.47L29.404 9.368a4.152 4.152 0 0 1 3.934-2.825z" opacity="0.85"/><path d="M71.175 60.261h-41.29a1.911 1.911 0 0 0-1.305 3.309l26.532 24.764a4.171 4.171 0 0 0 2.846 1.121h23.38z"/><path d="M66.595 9.364a4.145 4.145 0 0 0-3.928-2.82H33.648a4.146 4.146 0 0 1 3.928 2.82l25.184 74.62a4.146 4.146 0 0 1-3.928 5.472h29.02a4.146 4.146 0 0 0 3.927-5.472z" opacity="0.65"/></g>' }),
      node('On-Premise',    'home',   { bg: '#555555' }),
      node('SAP',           'client', { bg: '#0FAAFF', stencilSvg: '<text x="10" y="13" text-anchor="middle" font-size="9" font-weight="bold" fill="currentColor" stroke="none" font-family="system-ui">SAP</text>' }),
      node('Oracle',        'client', { bg: '#F80000', stencilSvg: '<rect x="2" y="5" width="16" height="10" rx="5" fill="none" stroke="currentColor" stroke-width="2"/>' }),
      node('Databricks',    'client', { bg: '#FF3621', stencilSvg: '<g transform="translate(10,10) scale(1.15) translate(-10,-10)"><path d="M10 3L16 7L10 11L4 7Z" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><path d="M4 10L10 14L16 10" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><path d="M4 13L10 17L16 13" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/></g>' }),
    ],
  },
  // ── Integrations & APIs ────────────────────────────────────────────
  {
    id: 'integrations',
    label: 'Integrations & APIs',
    templates: [
      node('REST API',            'data_streams',             { bg: '#2A9D8F' }),
      node('SOAP API',            'data_streams',             { bg: '#457B9D' }),
      node('GraphQL API',         'data_mapping',             { bg: '#E535AB' }),
      node('Bulk API',            'data_streams',             { bg: '#264653' }),
      node('Pub/Sub API',         'topic2',                   { bg: '#F4A261' }),
      node('Streaming API',       'data_streams',             { bg: '#E9C46A' }),
      node('Change Data Capture', 'record_update',            { bg: '#E76F51' }),
      node('Platform Events',     'event',                    { bg: '#9B7DD4' }),
      node('Event Relay',         'broadcast',                { bg: '#DA4E55' }),
      node('Private Connect',     'connected_apps',           { bg: '#555555' }),
      node('SFTP',                'database',                 { bg: '#6D6875' }),
    ],
  },
  // ── Programmatic Languages ─────────────────────────────────────────
  {
    id: 'languages',
    label: 'Programmatic Languages',
    collapsed: true,
    templates: [
      node('Apex',        'apex',               { bg: '#1D73C9' }),
      node('LWC',         'lightning_component', { bg: '#00A1E0' }),
      node('AMPscript',   'code_playground',     { bg: '#F49756' }),
      node('SSJS',        'javascript_button',   { bg: '#DAA520' }),
      node('SQL',         'query_editor',        { bg: '#3D5A80' }),
      node('SOQL',        'query_editor',        { bg: '#1D73C9' }),
      node('SOSL',        'query_editor',        { bg: '#457B9D' }),
      node('GTL',         'client',              { bg: '#6D6875', stencilSvg: '<g transform="scale(0.15625)" fill="currentColor"><path d="M14.59 62.67a7.14 7.14 0 002.31-3.48c.46-2 .36-3.94-2.31-5.3C7.82 50.47 3.45 56.57 2.77 58s-1.74 3.68-1 8.84 3.19 9.9 11 11.73a32.89 32.89 0 0022-2.57c6.84-3.26 19.7-9 22.94-9.58a28.15 28.15 0 016.49-.81v-7.85a18 18 0 00-17.38-9.15C34.43 49.59 29.51 56 26.49 58.7s-8.61 9.17-12.37 8-4.81-5.7-3.48-7.14 2.37-1.18 3.18 0a6.24 6.24 0 01.77 3.11z"/><path d="M113.41 62.67a7.14 7.14 0 01-2.31-3.48c-.46-2-.36-3.94 2.31-5.3 6.76-3.43 11.13 2.67 11.81 4.11s1.74 3.68 1 8.84-3.19 9.9-11 11.73A32.89 32.89 0 0193.23 76c-6.84-3.26-19.7-9-22.94-9.58a28.15 28.15 0 00-6.49-.81v-7.85a18 18 0 0117.38-9.15c12.39 1 17.32 7.38 20.34 10.08s8.61 9.17 12.37 8 4.81-5.76 3.48-7.19-2.37-1.18-3.18 0a6.24 6.24 0 00-.78 3.17z"/></g>' }),
      node('Handlebars',  'client',              { bg: '#E97628', stencilSvg: '<g transform="scale(0.15625)" fill="currentColor"><path d="M14.59 62.67a7.14 7.14 0 002.31-3.48c.46-2 .36-3.94-2.31-5.3C7.82 50.47 3.45 56.57 2.77 58s-1.74 3.68-1 8.84 3.19 9.9 11 11.73a32.89 32.89 0 0022-2.57c6.84-3.26 19.7-9 22.94-9.58a28.15 28.15 0 016.49-.81v-7.85a18 18 0 00-17.38-9.15C34.43 49.59 29.51 56 26.49 58.7s-8.61 9.17-12.37 8-4.81-5.7-3.48-7.14 2.37-1.18 3.18 0a6.24 6.24 0 01.77 3.11z"/><path d="M113.41 62.67a7.14 7.14 0 01-2.31-3.48c-.46-2-.36-3.94 2.31-5.3 6.76-3.43 11.13 2.67 11.81 4.11s1.74 3.68 1 8.84-3.19 9.9-11 11.73A32.89 32.89 0 0193.23 76c-6.84-3.26-19.7-9-22.94-9.58a28.15 28.15 0 00-6.49-.81v-7.85a18 18 0 0117.38-9.15c12.39 1 17.32 7.38 20.34 10.08s8.61 9.17 12.37 8 4.81-5.76 3.48-7.19-2.37-1.18-3.18 0a6.24 6.24 0 00-.78 3.17z"/></g>' }),
    ],
  },
  // ── Activation Channels ────────────────────────────────────────────
  {
    id: 'channels',
    label: 'Activation Channels',
    collapsed: true,
    templates: [
      node('Email',           'email',      { bg: '#3498DB' }),
      node('SMS',             'sms',        { bg: '#2ECC71' }),
      node('WhatsApp',        'whatsapp',   { bg: '#25D366' }),
      node('LINE',            'sms',        { bg: '#06C755' }),
      node('Website',         'page',       { bg: '#555555' }),
      node('Chat',            'live_chat',  { bg: '#00A1E0' }),
      node('Social Media Ads', 'social',    { bg: '#3B5998' }),
      node('Mobile Push',     'push',       { bg: '#DA4E55' }),
      node('Web Push',        'notification', { bg: '#E97628' }),
      node('Voice/IVR',       'voice_call', { bg: '#555555' }),
      node('Point of Sale',   'store',      { bg: '#2A9D8F' }),
      node('Agent',           'agent_astro', { bg: '#1D73C9' }),
    ],
  },
  // ── Marketing Cloud Engagement ─────────────────────────────────────
  {
    id: 'mce',
    label: 'Marketing Cloud Engagement',
    collapsed: true,
    templates: [
      node('Email',          'email',              { bg: '#F49756' }),
      node('SMS',            'sms',                { bg: '#F49756' }),
      node('WhatsApp',       'whatsapp',           { bg: '#F49756' }),
      node('LINE',           'sms',                { bg: '#F49756' }),
      node('Push',           'push',               { bg: '#F49756' }),
      node('Cloud Page',     'page',               { bg: '#F49756' }),
      node('Code Resource',  'code_playground',    { bg: '#F49756' }),
      node('Data Extension', 'database',           { bg: '#F49756' }),
      node('Personalization', 'segments',           { bg: '#F49756' }),
      node('Intelligence',   'einstein',           { bg: '#F49756' }),
      node('Journey',        'flow',               { bg: '#F49756' }),
      node('Automation',     'macros',             { bg: '#F49756' }),
      node('Einstein',       'einstein_alt',       { bg: '#F49756' }),
      node('MC Connect',     'integration',        { bg: '#F49756' }),
    ],
  },
  // ── MCE Journey Builder Activities ─────────────────────────────────
  {
    id: 'mce-jb',
    label: 'MCE Journey Builder Activities',
    collapsed: true,
    templates: [
      // ── Messaging ──
      node('Email',              'email',         { bg: '#4CA86C' }),
      node('SMS',                'sms',           { bg: '#4CA86C' }),
      node('MobilePush',         'push',          { bg: '#4CA86C' }),
      node('WhatsApp',           'whatsapp',      { bg: '#4CA86C' }),
      node('LINE',               'sms',           { bg: '#4CA86C' }),
      node('In-App Push',        'notification',  { bg: '#4CA86C' }),
      node('Inbox Push',         'notification',  { bg: '#4CA86C' }),
      // ── Flow Control ──
      node('Decision Split',          'decision',  { bg: '#E97628' }),
      node('Engagement Split',        'decision',  { bg: '#E97628' }),
      node('Random Split',            'decision',  { bg: '#E97628' }),
      node('Frequency Split',         'filter',    { bg: '#E97628' }),
      node('Einstein Scoring Split',  'einstein',  { bg: '#E97628' }),
      node('Join',                    'merge',     { bg: '#E97628' }),
      node('Wait',                    'waits',     { bg: '#6D6875' }),
      node('Path Optimizer',          'path_experiment', { bg: '#E97628' }),
      node('Einstein STO',            'einstein',  { bg: '#00A1E0' }),
      // ── Advertising ──
      node('Ad Audience',             'advertising', { bg: '#3B5998' }),
      node('Advertising Campaign',    'campaign',    { bg: '#3B5998' }),
      // ── Salesforce Activities ──
      node('Update Contact',     'record_update', { bg: '#1D73C9' }),
      node('Account Activity',   'account',       { bg: '#1D73C9' }),
      node('Case Activity',      'case',          { bg: '#1D73C9' }),
      node('Contact Activity',   'contact',       { bg: '#1D73C9' }),
      node('Lead Activity',      'lead',          { bg: '#1D73C9' }),
      node('Opportunity Activity', 'opportunity',  { bg: '#1D73C9' }),
      node('Task Activity',      'task',          { bg: '#1D73C9' }),
      node('Object Activity',    'record',        { bg: '#1D73C9' }),
    ],
  },
  // ── MCE Automation Studio Activities ───────────────────────────────
  {
    id: 'mce-as',
    label: 'MCE Automation Studio Activities',
    collapsed: true,
    templates: [
      node('SQL Query',       'query_editor',   { bg: '#3D5A80' }),
      node('Import File',     'download',       { bg: '#6D6875' }),
      node('File Transfer',   'upload',         { bg: '#6D6875' }),
      node('Data Extract',    'upload',         { bg: '#457B9D' }),
      node('Script',          'code_playground', { bg: '#DAA520' }),
      node('Filter',          'filter',         { bg: '#E97628' }),
      node('Refresh Group',   'refresh',        { bg: '#2A9D8F' }),
      node('Refresh Segment Template', 'segments', { bg: '#2A9D8F' }),
      node('Send Email',      'email',          { bg: '#4CA86C' }),
      node('Send SMS',        'sms',            { bg: '#4CA86C' }),
      node('Send Push',       'push',           { bg: '#4CA86C' }),
      node('Verification',    'task',           { bg: '#555555' }),
      node('Wait',            'waits',          { bg: '#6D6875' }),
      node('Einstein STO',    'einstein',       { bg: '#00A1E0' }),
      node('Einstein Engagement Frequency', 'einstein', { bg: '#00A1E0' }),
    ],
  },
];

// ── BPMN (Process Diagram) templates ────────────────────────────────

export const BPMN_CATEGORIES = [
  {
    id: 'bpmn-swimlanes',
    label: 'Swim Lanes',
    templates: [
      { type: 'sf.BpmnPool',       label: 'Horizontal Pool',  poolDirection: 'horizontal', stencilSvg: SVG.poolH },
      { type: 'sf.BpmnPool',       label: 'Vertical Pool',    poolDirection: 'vertical',   stencilSvg: SVG.poolV },
    ],
  },
  {
    id: 'bpmn-events',
    label: 'Events',
    templates: [
      { type: 'sf.BpmnEvent', label: 'Start',        eventType: 'start',        stencilSvg: SVG.eventStart },
      { type: 'sf.BpmnEvent', label: 'End',           eventType: 'end',          stencilSvg: SVG.eventEnd },
      { type: 'sf.BpmnEvent', label: 'Intermediate',  eventType: 'intermediate', stencilSvg: SVG.eventIntermediate },
    ],
  },
  {
    id: 'bpmn-activities',
    label: 'Activities',
    templates: [
      { type: 'sf.BpmnTask',       label: 'Task',                               stencilSvg: SVG.task },
      { type: 'sf.BpmnSubprocess', label: 'Subprocess',                          stencilSvg: SVG.subprocess },
      { type: 'sf.BpmnLoop',       label: 'Loop',                                stencilSvg: SVG.loop },
    ],
  },
  {
    id: 'bpmn-gateways',
    label: 'Gateways',
    templates: [
      { type: 'sf.BpmnGateway', label: 'Exclusive',   gatewayType: 'exclusive', stencilSvg: SVG.gatewayExcl },
      { type: 'sf.BpmnGateway', label: 'Parallel',    gatewayType: 'parallel',  stencilSvg: SVG.gatewayPar },
      { type: 'sf.BpmnGateway', label: 'Inclusive',    gatewayType: 'inclusive',  stencilSvg: SVG.gatewayIncl },
      { type: 'sf.BpmnGateway', label: 'Event-based', gatewayType: 'event',     stencilSvg: SVG.gatewayEvt },
    ],
  },
  {
    id: 'flow-shapes',
    label: 'Flowchart',
    templates: [
      { type: 'sf.FlowTerminator',  label: 'Start',              stencilSvg: SVG.flowStart },
      { type: 'sf.FlowProcess',     label: 'Process',            stencilSvg: SVG.flowProcess },
      { type: 'sf.FlowDecision',    label: 'Decision',           stencilSvg: SVG.flowDecision },
      { type: 'sf.FlowTerminator',  label: 'Terminator',         stencilSvg: SVG.flowTerminator },
      { type: 'sf.FlowDatabase',    label: 'Database',           stencilSvg: SVG.flowDatabase },
      { type: 'sf.FlowDocument',    label: 'Document',           stencilSvg: SVG.flowDocument },
      { type: 'sf.FlowIO',          label: 'Input / Output',     stencilSvg: SVG.flowIO },
      { type: 'sf.FlowPredefined',  label: 'Predefined Process', stencilSvg: SVG.flowPredefined },
      { type: 'sf.FlowOffPage',     label: 'Off-Page Link',      stencilSvg: SVG.flowOffPage },
      { type: 'sf.BpmnDataObject',  label: 'Data Object',        stencilSvg: SVG.dataObject },
    ],
  },
  {
    id: 'bpmn-generic',
    label: 'Generic Shapes',
    templates: [
      { type: 'sf.Zone',       label: 'Zone',       stencilSvg: SVG.zone },
      { type: 'sf.Note',       label: 'Note',       stencilSvg: SVG.note },
      { type: 'sf.TextLabel',  label: 'Text',       stencilSvg: SVG.text },
      { type: 'sf.Annotation', label: 'Annotation', stencilSvg: SVG.annotation },
      { type: 'sf.Line',       label: 'Line',       stencilSvg: SVG.line },
      { type: 'sf.Link',       label: 'Link',       url: 'https://', stencilSvg: SVG.link },
    ],
  },
];

// ── Gantt templates ───────────────────────────────────────────────

const ganttSVG = {
  task:      '<rect x="2" y="6" width="16" height="8" rx="2"/><rect x="2" y="6" width="10" height="8" rx="2" fill="currentColor" stroke="none" opacity="0.4"/>',
  milestone: '<polygon points="10,2 18,10 10,18 2,10" />',
  marker:    '<polygon points="4,18 10,4 16,18" />',
  group:     '<rect x="1" y="7" width="18" height="4" fill="currentColor" stroke="none"/><path d="M1 7L1 11L4 7" fill="currentColor" stroke="none"/><path d="M19 7L19 11L16 7" fill="currentColor" stroke="none"/>',
  timeline:  '<rect x="1" y="3" width="18" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1"/><line x1="7" y1="3" x2="7" y2="9" stroke="currentColor" stroke-width="0.5"/><line x1="13" y1="3" x2="13" y2="9" stroke="currentColor" stroke-width="0.5"/><rect x="1" y="9" width="18" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1"/><line x1="4" y1="9" x2="4" y2="15" stroke="currentColor" stroke-width="0.3"/><line x1="7" y1="9" x2="7" y2="15" stroke="currentColor" stroke-width="0.3"/><line x1="10" y1="9" x2="10" y2="15" stroke="currentColor" stroke-width="0.3"/><line x1="13" y1="9" x2="13" y2="15" stroke="currentColor" stroke-width="0.3"/><line x1="16" y1="9" x2="16" y2="15" stroke="currentColor" stroke-width="0.3"/>',
};

export const GANTT_CATEGORIES = [
  {
    id: 'gantt-elements',
    label: 'Gantt Elements',
    templates: [
      { type: 'sf.GanttTimeline',  label: 'Day Timeline',    stencilSvg: ganttSVG.timeline, viewMode: 'day', numPeriods: 14 },
      { type: 'sf.GanttTimeline',  label: 'Week Timeline',   stencilSvg: ganttSVG.timeline, viewMode: 'week', numPeriods: 12 },
      { type: 'sf.GanttTimeline',  label: 'Month Timeline',  stencilSvg: ganttSVG.timeline, viewMode: 'month', numPeriods: 12 },
      { type: 'sf.GanttTask',      label: 'Task',            stencilSvg: ganttSVG.task,
        taskLabel: 'Task', progress: 0, barColor: '#1D73C9' },
      { type: 'sf.GanttTask',      label: 'In-Progress Task', stencilSvg: ganttSVG.task,
        taskLabel: 'In-Progress Task', progress: 50, barColor: '#1D73C9' },
      { type: 'sf.GanttTask',      label: 'Completed Task',  stencilSvg: ganttSVG.task,
        taskLabel: 'Completed Task', progress: 100, barColor: '#2A9D8F' },
      { type: 'sf.GanttMilestone', label: 'Milestone',       stencilSvg: ganttSVG.milestone },
      { type: 'sf.GanttMarker',    label: 'Today Marker',    stencilSvg: ganttSVG.marker },
      { type: 'sf.GanttGroup',     label: 'Phase / Group',   stencilSvg: ganttSVG.group },
    ],
  },
  {
    id: 'gantt-phases',
    label: 'Project Phases',
    templates: [
      { type: 'sf.GanttGroup', label: 'Planning',      stencilSvg: ganttSVG.group, phaseLabel: 'Planning' },
      { type: 'sf.GanttGroup', label: 'Development',   stencilSvg: ganttSVG.group, phaseLabel: 'Development' },
      { type: 'sf.GanttGroup', label: 'Testing',       stencilSvg: ganttSVG.group, phaseLabel: 'Testing' },
      { type: 'sf.GanttGroup', label: 'Deployment',    stencilSvg: ganttSVG.group, phaseLabel: 'Deployment' },
      { type: 'sf.GanttGroup', label: 'Go Live',       stencilSvg: ganttSVG.group, phaseLabel: 'Go Live' },
    ],
  },
  {
    id: 'gantt-salesforce',
    label: 'Project Tasks',
    templates: [
      { type: 'sf.GanttTask', label: 'Discovery & Requirements',  stencilSvg: ganttSVG.task, taskLabel: 'Discovery & Requirements', progress: 0, barColor: '#5B5FC7' },
      { type: 'sf.GanttTask', label: 'Solution Design',           stencilSvg: ganttSVG.task, taskLabel: 'Solution Design', progress: 0, barColor: '#5B5FC7' },
      { type: 'sf.GanttTask', label: 'Data Model Config',         stencilSvg: ganttSVG.task, taskLabel: 'Data Model Config', progress: 0, barColor: '#1D73C9' },
      { type: 'sf.GanttTask', label: 'Flow / Automation Build',   stencilSvg: ganttSVG.task, taskLabel: 'Flow / Automation Build', progress: 0, barColor: '#1D73C9' },
      { type: 'sf.GanttTask', label: 'Lightning Page Build',      stencilSvg: ganttSVG.task, taskLabel: 'Lightning Page Build', progress: 0, barColor: '#1D73C9' },
      { type: 'sf.GanttTask', label: 'Integration Development',   stencilSvg: ganttSVG.task, taskLabel: 'Integration Development', progress: 0, barColor: '#2A9D8F' },
      { type: 'sf.GanttTask', label: 'Data Migration',            stencilSvg: ganttSVG.task, taskLabel: 'Data Migration', progress: 0, barColor: '#2A9D8F' },
      { type: 'sf.GanttTask', label: 'UAT / QA Testing',          stencilSvg: ganttSVG.task, taskLabel: 'UAT / QA Testing', progress: 0, barColor: '#E97628' },
      { type: 'sf.GanttTask', label: 'Training & Enablement',     stencilSvg: ganttSVG.task, taskLabel: 'Training & Enablement', progress: 0, barColor: '#E97628' },
      { type: 'sf.GanttTask', label: 'Change Set Deployment',     stencilSvg: ganttSVG.task, taskLabel: 'Change Set Deployment', progress: 0, barColor: '#DA4E55' },
      { type: 'sf.GanttTask', label: 'Post-Go-Live Support',      stencilSvg: ganttSVG.task, taskLabel: 'Post-Go-Live Support', progress: 0, barColor: '#DA4E55' },
      { type: 'sf.GanttMilestone', label: 'Project Kickoff',      stencilSvg: ganttSVG.milestone },
      { type: 'sf.GanttMilestone', label: 'Design Sign-Off',      stencilSvg: ganttSVG.milestone },
      { type: 'sf.GanttMilestone', label: 'UAT Complete',          stencilSvg: ganttSVG.milestone },
      { type: 'sf.GanttMilestone', label: 'Go Live',               stencilSvg: ganttSVG.milestone },
    ],
  },
  {
    id: 'gantt-generic',
    label: 'Generic Shapes',
    templates: [
      { type: 'sf.Zone',       label: 'Zone',       stencilSvg: SVG.zone },
      { type: 'sf.Note',       label: 'Note',       stencilSvg: SVG.note },
      { type: 'sf.TextLabel',  label: 'Text',       stencilSvg: SVG.text },
      { type: 'sf.Annotation', label: 'Annotation', stencilSvg: SVG.annotation },
      { type: 'sf.Line',       label: 'Line',       stencilSvg: SVG.line },
      { type: 'sf.Link',       label: 'Link',       url: 'https://', stencilSvg: SVG.link },
    ],
  },
];

// ── Organisation Diagram templates ────────────────────────────────

export const ORG_CATEGORIES = [
  {
    id: 'org-components',
    label: 'Components',
    templates: [
      { type: 'sf.OrgPerson', label: 'Person', personName: 'Full Name', jobTitle: 'Job Title', stencilSvg: SVG.orgPerson },
      { type: 'sf.Zone',      label: 'Department', stencilSvg: SVG.orgDepartment },
      { type: 'sf.Container',  label: 'Team',       stencilSvg: SVG.orgTeam },
    ],
  },
  {
    id: 'org-generic',
    label: 'Generic Shapes',
    templates: [
      { type: 'sf.Zone',       label: 'Zone',       stencilSvg: SVG.zone },
      { type: 'sf.Note',       label: 'Note',       stencilSvg: SVG.note },
      { type: 'sf.TextLabel',  label: 'Text',       stencilSvg: SVG.text },
      { type: 'sf.Annotation', label: 'Annotation', stencilSvg: SVG.annotation },
      { type: 'sf.Line',       label: 'Line',       stencilSvg: SVG.line },
      { type: 'sf.Link',       label: 'Link',       url: 'https://', stencilSvg: SVG.link },
    ],
  },
];

// ── Sequence Diagram templates ────────────────────────────────────

// Role-based accent colors (match Mulesoft-style sequence diagrams).
// Actor uses the same neutral grey as Participant/generic by default — users
// change it explicitly via the property panel if they want role-styled shapes.
const SEQ_ACCENT = {
  generic:     '#8A9099', // neutral grey
  salesforce:  '#2E844A', // Salesforce green
  api:         '#1D73C9', // API / system blue
  external:    '#F6B355', // external / partner amber
  actor:       '#8A9099', // neutral grey — matches participant default
};

export const SEQUENCE_CATEGORIES = [
  {
    id: 'seq-components',
    label: 'Sequence',
    templates: [
      { type: 'sf.SequenceParticipant', label: 'Participant', role: 'generic', accentColor: SEQ_ACCENT.generic, stencilSvg: SVG.seqParticipant },
      { type: 'sf.SequenceActor',       label: 'Actor',       role: 'actor',   accentColor: SEQ_ACCENT.actor,   stencilSvg: SVG.seqActor },
      { type: 'sf.SequenceActivation',  label: 'Activation',                                                    stencilSvg: SVG.seqActivation },
      { type: 'sf.SequenceFragment',    label: 'Fragment',    fragmentType: 'standard',    fragmentLabel: 'loop', stencilSvg: SVG.seqFragment },
      { type: 'sf.SequenceFragment',    label: 'Alternative', fragmentType: 'alternative', fragmentLabel: 'alt',  stencilSvg: SVG.seqFragment },
    ],
  },
  {
    id: 'seq-generic',
    label: 'Generic Shapes',
    templates: [
      { type: 'sf.Zone',       label: 'Zone',       stencilSvg: SVG.zone },
      { type: 'sf.Note',       label: 'Note',       stencilSvg: SVG.note },
      { type: 'sf.TextLabel',  label: 'Text',       stencilSvg: SVG.text },
      { type: 'sf.Annotation', label: 'Annotation', stencilSvg: SVG.annotation },
      { type: 'sf.Line',       label: 'Line',       stencilSvg: SVG.line },
      { type: 'sf.Link',       label: 'Link',       url: 'https://', stencilSvg: SVG.link },
    ],
  },
];

// ── Data Model templates ───────────────────────────────────────────

export const DATAMODEL_CATEGORIES = [
  {
    id: 'dm-generic',
    label: 'Generic Shapes',
    templates: [
      {
        type: 'sf.DataObject', label: 'Object', objectName: 'ObjectName', headerColor: '#1D73C9', stencilSvg: SVG.dataTable,
        fields: [
          { label: 'Id', apiName: 'Id', type: 'ID', keyType: 'pk' },
          { label: 'Name', apiName: 'Name', type: 'Text', keyType: null },
        ],
      },
      { type: 'sf.Zone',       label: 'Zone',       stencilSvg: SVG.zone },
      { type: 'sf.Note',       label: 'Note',       stencilSvg: SVG.note },
      { type: 'sf.TextLabel',  label: 'Text',       stencilSvg: SVG.text },
      { type: 'sf.Annotation', label: 'Annotation', stencilSvg: SVG.annotation },
      { type: 'sf.Line',       label: 'Line',       stencilSvg: SVG.line },
      { type: 'sf.Link',       label: 'Link',       url: 'https://', stencilSvg: SVG.link },
    ],
  },
  {
    id: 'dm-mc-dataviews',
    label: 'Marketing Cloud Data Views',
    collapsed: true,
    templates: [
      {
        type: 'sf.DataObject', label: 'Subscribers', objectName: '_Subscribers', headerColor: '#E07D1A', stencilSvg: SVG.dataTable,
        fields: [
          { label: 'Subscriber Key', apiName: 'SubscriberKey', type: 'Varchar(254)', keyType: 'pk' },
          { label: 'Subscriber ID', apiName: 'SubscriberID', type: 'Integer', keyType: null },
          { label: 'Email Address', apiName: 'EmailAddress', type: 'Varchar(254)', keyType: null },
          { label: 'Status', apiName: 'Status', type: 'Varchar(12)', keyType: null },
          { label: 'Date Joined', apiName: 'DateJoined', type: 'DateTime', keyType: null },
          { label: 'Date Unsubscribed', apiName: 'DateUnsubscribed', type: 'DateTime', keyType: null },
          { label: 'Date Undeliverable', apiName: 'DateUndeliverable', type: 'DateTime', keyType: null },
          { label: 'Bounce Count', apiName: 'BounceCount', type: 'Integer', keyType: null },
          { label: 'Domain', apiName: 'Domain', type: 'Varchar(254)', keyType: null },
          { label: 'Subscriber Type', apiName: 'SubscriberType', type: 'Varchar(100)', keyType: null },
          { label: 'Locale', apiName: 'Locale', type: 'Integer', keyType: null },
        ],
      },
      {
        type: 'sf.DataObject', label: 'Job', objectName: '_Job', headerColor: '#E07D1A', stencilSvg: SVG.dataTable,
        fields: [
          { label: 'Job ID', apiName: 'JobID', type: 'Integer', keyType: 'pk' },
          { label: 'Email ID', apiName: 'EmailID', type: 'Integer', keyType: null },
          { label: 'Account ID', apiName: 'AccountID', type: 'Integer', keyType: null },
          { label: 'Account User ID', apiName: 'AccountUserID', type: 'Integer', keyType: null },
          { label: 'From Name', apiName: 'FromName', type: 'Varchar(130)', keyType: null },
          { label: 'From Email', apiName: 'FromEmail', type: 'Varchar(100)', keyType: null },
          { label: 'Sched Time', apiName: 'SchedTime', type: 'DateTime', keyType: null },
          { label: 'Pickup Time', apiName: 'PickupTime', type: 'DateTime', keyType: null },
          { label: 'Delivered Time', apiName: 'DeliveredTime', type: 'DateTime', keyType: null },
          { label: 'Event ID', apiName: 'EventID', type: 'Varchar(50)', keyType: null },
          { label: 'Is Multipart', apiName: 'IsMultipart', type: 'Boolean', keyType: null },
          { label: 'Job Type', apiName: 'JobType', type: 'Varchar(50)', keyType: null },
          { label: 'Job Status', apiName: 'JobStatus', type: 'Varchar(50)', keyType: null },
          { label: 'Modified By', apiName: 'ModifiedBy', type: 'Integer', keyType: null },
          { label: 'Modified Date', apiName: 'ModifiedDate', type: 'DateTime', keyType: null },
          { label: 'Email Name', apiName: 'EmailName', type: 'Varchar(100)', keyType: null },
          { label: 'Email Subject', apiName: 'EmailSubject', type: 'Varchar(200)', keyType: null },
          { label: 'Is Wrapped', apiName: 'IsWrapped', type: 'Boolean', keyType: null },
          { label: 'Test Email Addr', apiName: 'TestEmailAddr', type: 'Varchar(128)', keyType: null },
          { label: 'Category', apiName: 'Category', type: 'Varchar(100)', keyType: null },
          { label: 'BCC Email', apiName: 'BccEmail', type: 'Varchar(100)', keyType: null },
          { label: 'Original Sched Time', apiName: 'OriginalSchedTime', type: 'DateTime', keyType: null },
          { label: 'Created Date', apiName: 'CreatedDate', type: 'DateTime', keyType: null },
          { label: 'Character Set', apiName: 'CharacterSet', type: 'Varchar(30)', keyType: null },
          { label: 'IP Address', apiName: 'IPAddress', type: 'Varchar(50)', keyType: null },
          { label: 'SF Total Sub Count', apiName: 'SalesforceTotalSubscriberCount', type: 'Integer', keyType: null },
          { label: 'SF Error Sub Count', apiName: 'SalesforceErrorSubscriberCount', type: 'Integer', keyType: null },
          { label: 'Send Type', apiName: 'SendType', type: 'Varchar(128)', keyType: null },
          { label: 'Dynamic Email Subject', apiName: 'DynamicEmailSubject', type: 'Varchar(max)', keyType: null },
          { label: 'Suppress Tracking', apiName: 'SuppressTracking', type: 'Boolean', keyType: null },
          { label: 'Send Classification Type', apiName: 'SendClassificationType', type: 'Varchar(32)', keyType: null },
          { label: 'Send Classification', apiName: 'SendClassification', type: 'Varchar(36)', keyType: null },
          { label: 'Resolve Links Current', apiName: 'ResolveLinksWithCurrentData', type: 'Boolean', keyType: null },
          { label: 'Email Send Definition', apiName: 'EmailSendDefinition', type: 'Varchar(36)', keyType: null },
          { label: 'Deduplicate By Email', apiName: 'DeduplicateByEmail', type: 'Boolean', keyType: null },
          { label: 'TS Def Object ID', apiName: 'TriggererSendDefinitionObjectID', type: 'Varchar(36)', keyType: null },
          { label: 'TS Customer Key', apiName: 'TriggeredSendCustomerKey', type: 'Varchar(36)', keyType: null },
        ],
      },
      {
        type: 'sf.DataObject', label: 'Sent', objectName: '_Sent', headerColor: '#E07D1A', stencilSvg: SVG.dataTable,
        fields: [
          { label: 'Account ID', apiName: 'AccountID', type: 'Integer', keyType: null },
          { label: 'OYB Account ID', apiName: 'OYBAccountID', type: 'Integer', keyType: null },
          { label: 'Job ID', apiName: 'JobID', type: 'Integer', keyType: 'fk' },
          { label: 'List ID', apiName: 'ListID', type: 'Integer', keyType: null },
          { label: 'Batch ID', apiName: 'BatchID', type: 'Integer', keyType: null },
          { label: 'Subscriber ID', apiName: 'SubscriberID', type: 'Integer', keyType: 'fk' },
          { label: 'Subscriber Key', apiName: 'SubscriberKey', type: 'Varchar(254)', keyType: 'fk' },
          { label: 'Event Date', apiName: 'EventDate', type: 'DateTime', keyType: null },
          { label: 'Domain', apiName: 'Domain', type: 'Varchar(128)', keyType: null },
          { label: 'TS Def Object ID', apiName: 'TriggererSendDefinitionObjectID', type: 'Varchar(36)', keyType: null },
          { label: 'TS Customer Key', apiName: 'TriggeredSendCustomerKey', type: 'Varchar(36)', keyType: null },
        ],
      },
      {
        type: 'sf.DataObject', label: 'Open', objectName: '_Open', headerColor: '#E07D1A', stencilSvg: SVG.dataTable,
        fields: [
          { label: 'Account ID', apiName: 'AccountID', type: 'Integer', keyType: null },
          { label: 'OYB Account ID', apiName: 'OYBAccountID', type: 'Integer', keyType: null },
          { label: 'Job ID', apiName: 'JobID', type: 'Integer', keyType: 'fk' },
          { label: 'List ID', apiName: 'ListID', type: 'Integer', keyType: null },
          { label: 'Batch ID', apiName: 'BatchID', type: 'Integer', keyType: null },
          { label: 'Subscriber ID', apiName: 'SubscriberID', type: 'Integer', keyType: 'fk' },
          { label: 'Subscriber Key', apiName: 'SubscriberKey', type: 'Varchar(254)', keyType: 'fk' },
          { label: 'Event Date', apiName: 'EventDate', type: 'DateTime', keyType: null },
          { label: 'Is Unique', apiName: 'IsUnique', type: 'Boolean', keyType: null },
          { label: 'Domain', apiName: 'Domain', type: 'Varchar(128)', keyType: null },
          { label: 'TS Def Object ID', apiName: 'TriggererSendDefinitionObjectID', type: 'Varchar(36)', keyType: null },
          { label: 'TS Customer Key', apiName: 'TriggeredSendCustomerKey', type: 'Varchar(36)', keyType: null },
        ],
      },
      {
        type: 'sf.DataObject', label: 'Click', objectName: '_Click', headerColor: '#E07D1A', stencilSvg: SVG.dataTable,
        fields: [
          { label: 'Account ID', apiName: 'AccountID', type: 'Integer', keyType: null },
          { label: 'OYB Account ID', apiName: 'OYBAccountID', type: 'Integer', keyType: null },
          { label: 'Job ID', apiName: 'JobID', type: 'Integer', keyType: 'fk' },
          { label: 'List ID', apiName: 'ListID', type: 'Integer', keyType: null },
          { label: 'Batch ID', apiName: 'BatchID', type: 'Integer', keyType: null },
          { label: 'Subscriber ID', apiName: 'SubscriberID', type: 'Integer', keyType: 'fk' },
          { label: 'Subscriber Key', apiName: 'SubscriberKey', type: 'Varchar(254)', keyType: 'fk' },
          { label: 'Event Date', apiName: 'EventDate', type: 'DateTime', keyType: null },
          { label: 'Is Unique', apiName: 'IsUnique', type: 'Boolean', keyType: null },
          { label: 'Domain', apiName: 'Domain', type: 'Varchar(128)', keyType: null },
          { label: 'URL', apiName: 'URL', type: 'Varchar(900)', keyType: null },
          { label: 'Link Name', apiName: 'LinkName', type: 'Varchar(1024)', keyType: null },
          { label: 'Link Content', apiName: 'LinkContent', type: 'Varchar(max)', keyType: null },
          { label: 'TS Def Object ID', apiName: 'TriggererSendDefinitionObjectID', type: 'Varchar(36)', keyType: null },
          { label: 'TS Customer Key', apiName: 'TriggeredSendCustomerKey', type: 'Varchar(36)', keyType: null },
        ],
      },
      {
        type: 'sf.DataObject', label: 'Bounce', objectName: '_Bounce', headerColor: '#E07D1A', stencilSvg: SVG.dataTable,
        fields: [
          { label: 'Account ID', apiName: 'AccountID', type: 'Integer', keyType: null },
          { label: 'OYB Account ID', apiName: 'OYBAccountID', type: 'Integer', keyType: null },
          { label: 'Job ID', apiName: 'JobID', type: 'Integer', keyType: 'fk' },
          { label: 'List ID', apiName: 'ListID', type: 'Integer', keyType: null },
          { label: 'Batch ID', apiName: 'BatchID', type: 'Integer', keyType: null },
          { label: 'Subscriber ID', apiName: 'SubscriberID', type: 'Integer', keyType: 'fk' },
          { label: 'Subscriber Key', apiName: 'SubscriberKey', type: 'Varchar(254)', keyType: 'fk' },
          { label: 'Event Date', apiName: 'EventDate', type: 'DateTime', keyType: null },
          { label: 'Is Unique', apiName: 'IsUnique', type: 'Boolean', keyType: null },
          { label: 'Domain', apiName: 'Domain', type: 'Varchar(128)', keyType: null },
          { label: 'Bounce Category ID', apiName: 'BounceCategoryID', type: 'Integer', keyType: null },
          { label: 'Bounce Category', apiName: 'BounceCategory', type: 'Varchar(50)', keyType: null },
          { label: 'Bounce Subcategory ID', apiName: 'BounceSubcategoryID', type: 'Integer', keyType: null },
          { label: 'Bounce Subcategory', apiName: 'BounceSubcategory', type: 'Varchar(50)', keyType: null },
          { label: 'Bounce Type ID', apiName: 'BounceTypeID', type: 'Integer', keyType: null },
          { label: 'Bounce Type', apiName: 'BounceType', type: 'Varchar(50)', keyType: null },
          { label: 'SMTP Bounce Reason', apiName: 'SMTPBounceReason', type: 'Varchar(max)', keyType: null },
          { label: 'SMTP Message', apiName: 'SMTPMessage', type: 'Varchar(max)', keyType: null },
          { label: 'SMTP Code', apiName: 'SMTPCode', type: 'Integer', keyType: null },
          { label: 'TS Def Object ID', apiName: 'TriggererSendDefinitionObjectID', type: 'Varchar(36)', keyType: null },
          { label: 'TS Customer Key', apiName: 'TriggeredSendCustomerKey', type: 'Varchar(36)', keyType: null },
          { label: 'Is False Bounce', apiName: 'IsFalseBounce', type: 'Boolean', keyType: null },
        ],
      },
      {
        type: 'sf.DataObject', label: 'Unsubscribe', objectName: '_Unsubscribe', headerColor: '#E07D1A', stencilSvg: SVG.dataTable,
        fields: [
          { label: 'Account ID', apiName: 'AccountID', type: 'Integer', keyType: null },
          { label: 'OYB Account ID', apiName: 'OYBAccountID', type: 'Integer', keyType: null },
          { label: 'Job ID', apiName: 'JobID', type: 'Integer', keyType: 'fk' },
          { label: 'List ID', apiName: 'ListID', type: 'Integer', keyType: null },
          { label: 'Batch ID', apiName: 'BatchID', type: 'Integer', keyType: null },
          { label: 'Subscriber ID', apiName: 'SubscriberID', type: 'Integer', keyType: 'fk' },
          { label: 'Subscriber Key', apiName: 'SubscriberKey', type: 'Varchar(254)', keyType: 'fk' },
          { label: 'Event Date', apiName: 'EventDate', type: 'DateTime', keyType: null },
          { label: 'Is Unique', apiName: 'IsUnique', type: 'Boolean', keyType: null },
          { label: 'Domain', apiName: 'Domain', type: 'Varchar(128)', keyType: null },
          { label: 'TS Def Object ID', apiName: 'TriggererSendDefinitionObjectID', type: 'Varchar(36)', keyType: null },
          { label: 'TS Customer Key', apiName: 'TriggeredSendCustomerKey', type: 'Varchar(36)', keyType: null },
        ],
      },
      {
        type: 'sf.DataObject', label: 'Complaint', objectName: '_Complaint', headerColor: '#E07D1A', stencilSvg: SVG.dataTable,
        fields: [
          { label: 'Account ID', apiName: 'AccountID', type: 'Integer', keyType: null },
          { label: 'OYB Account ID', apiName: 'OYBAccountID', type: 'Integer', keyType: null },
          { label: 'Job ID', apiName: 'JobID', type: 'Integer', keyType: 'fk' },
          { label: 'List ID', apiName: 'ListID', type: 'Integer', keyType: null },
          { label: 'Batch ID', apiName: 'BatchID', type: 'Integer', keyType: null },
          { label: 'Subscriber ID', apiName: 'SubscriberID', type: 'Integer', keyType: 'fk' },
          { label: 'Subscriber Key', apiName: 'SubscriberKey', type: 'Varchar(254)', keyType: 'fk' },
          { label: 'Event Date', apiName: 'EventDate', type: 'DateTime', keyType: null },
          { label: 'Is Unique', apiName: 'IsUnique', type: 'Boolean', keyType: null },
          { label: 'Domain', apiName: 'Domain', type: 'Varchar(128)', keyType: null },
        ],
      },
      {
        type: 'sf.DataObject', label: 'FTAF', objectName: '_FTAF', headerColor: '#E07D1A', stencilSvg: SVG.dataTable,
        fields: [
          { label: 'Account ID', apiName: 'AccountID', type: 'Integer', keyType: null },
          { label: 'OYB Account ID', apiName: 'OYBAccountID', type: 'Integer', keyType: null },
          { label: 'Job ID', apiName: 'JobID', type: 'Integer', keyType: 'fk' },
          { label: 'List ID', apiName: 'ListID', type: 'Integer', keyType: null },
          { label: 'Batch ID', apiName: 'BatchID', type: 'Integer', keyType: null },
          { label: 'Subscriber ID', apiName: 'SubscriberID', type: 'Integer', keyType: 'fk' },
          { label: 'Subscriber Key', apiName: 'SubscriberKey', type: 'Varchar(254)', keyType: 'fk' },
          { label: 'Transaction Time', apiName: 'TransactionTime', type: 'DateTime', keyType: null },
          { label: 'Is Unique', apiName: 'IsUnique', type: 'Boolean', keyType: null },
          { label: 'Domain', apiName: 'Domain', type: 'Varchar(128)', keyType: null },
          { label: 'TS Def Object ID', apiName: 'TriggererSendDefinitionObjectID', type: 'Varchar(36)', keyType: null },
          { label: 'TS Customer Key', apiName: 'TriggeredSendCustomerKey', type: 'Varchar(36)', keyType: null },
        ],
      },
      {
        type: 'sf.DataObject', label: 'BU Unsubscribes', objectName: '_BusinessUnitUnsubscribes', headerColor: '#E07D1A', stencilSvg: SVG.dataTable,
        fields: [
          { label: 'Business Unit ID', apiName: 'BusinessUnitID', type: 'Integer', keyType: null },
          { label: 'Subscriber ID', apiName: 'SubscriberID', type: 'Integer', keyType: 'fk' },
          { label: 'Subscriber Key', apiName: 'SubscriberKey', type: 'Varchar(254)', keyType: 'fk' },
          { label: 'Unsub Date UTC', apiName: 'UnsubDateUTC', type: 'DateTime', keyType: null },
          { label: 'Unsub Reason', apiName: 'UnsubReason', type: 'Varchar(100)', keyType: null },
        ],
      },
      {
        type: 'sf.DataObject', label: 'List Subscribers', objectName: '_ListSubscribers', headerColor: '#E07D1A', stencilSvg: SVG.dataTable,
        fields: [
          { label: 'List ID', apiName: 'ListID', type: 'Integer', keyType: null },
          { label: 'List Name', apiName: 'ListName', type: 'Varchar(50)', keyType: null },
          { label: 'List Type', apiName: 'ListType', type: 'Varchar(16)', keyType: null },
          { label: 'Subscriber ID', apiName: 'SubscriberID', type: 'Integer', keyType: 'fk' },
          { label: 'Subscriber Key', apiName: 'SubscriberKey', type: 'Varchar(254)', keyType: 'fk' },
          { label: 'Subscriber Type', apiName: 'SubscriberType', type: 'Varchar(100)', keyType: null },
          { label: 'Email Address', apiName: 'EmailAddress', type: 'Varchar(254)', keyType: null },
          { label: 'Status', apiName: 'Status', type: 'Varchar(12)', keyType: null },
          { label: 'Created Date', apiName: 'CreatedDate', type: 'DateTime', keyType: null },
          { label: 'Date Unsubscribed', apiName: 'DateUnsubscribed', type: 'DateTime', keyType: null },
          { label: 'Add Method', apiName: 'AddMethod', type: 'Varchar(17)', keyType: null },
          { label: 'Added By', apiName: 'AddedBy', type: 'Integer', keyType: null },
        ],
      },
      {
        type: 'sf.DataObject', label: 'Journey', objectName: '_Journey', headerColor: '#E07D1A', stencilSvg: SVG.dataTable,
        fields: [
          { label: 'Version ID', apiName: 'VersionID', type: 'Varchar(36)', keyType: 'pk' },
          { label: 'Journey ID', apiName: 'JourneyID', type: 'Varchar(36)', keyType: null },
          { label: 'Journey Name', apiName: 'JourneyName', type: 'Varchar(200)', keyType: null },
          { label: 'Version Number', apiName: 'VersionNumber', type: 'Integer', keyType: null },
          { label: 'Created Date', apiName: 'CreatedDate', type: 'DateTime', keyType: null },
          { label: 'Last Published', apiName: 'LastPublishedDate', type: 'DateTime', keyType: null },
          { label: 'Modified Date', apiName: 'ModifiedDate', type: 'DateTime', keyType: null },
          { label: 'Journey Status', apiName: 'JourneyStatus', type: 'Varchar(100)', keyType: null },
        ],
      },
      {
        type: 'sf.DataObject', label: 'Journey Activity', objectName: '_JourneyActivity', headerColor: '#E07D1A', stencilSvg: SVG.dataTable,
        fields: [
          { label: 'Version ID', apiName: 'VersionID', type: 'Varchar(36)', keyType: 'fk' },
          { label: 'Activity ID', apiName: 'ActivityID', type: 'Varchar(36)', keyType: null },
          { label: 'Activity Name', apiName: 'ActivityName', type: 'Varchar(200)', keyType: null },
          { label: 'Activity External Key', apiName: 'ActivityExternalKey', type: 'Varchar(200)', keyType: 'pk' },
          { label: 'Activity Object ID', apiName: 'JourneyActivityObjectID', type: 'Varchar(36)', keyType: null },
          { label: 'Activity Type', apiName: 'ActivityType', type: 'Varchar(512)', keyType: null },
        ],
      },
      {
        type: 'sf.DataObject', label: 'SMS Message Tracking', objectName: '_SMSMessageTracking', headerColor: '#E07D1A', stencilSvg: SVG.dataTable,
        fields: [
          { label: 'Tracking ID', apiName: 'MobileMessageTrackingID', type: 'Integer', keyType: 'pk' },
          { label: 'EID', apiName: 'EID', type: 'Integer', keyType: null },
          { label: 'MID', apiName: 'MID', type: 'Integer', keyType: null },
          { label: 'Mobile', apiName: 'Mobile', type: 'Varchar(15)', keyType: 'fk' },
          { label: 'Message ID', apiName: 'MessageID', type: 'Integer', keyType: null },
          { label: 'Keyword ID', apiName: 'KeywordID', type: 'Varchar(36)', keyType: null },
          { label: 'Code ID', apiName: 'CodeID', type: 'Varchar(36)', keyType: null },
          { label: 'Conversation ID', apiName: 'ConversationID', type: 'Varchar(36)', keyType: null },
          { label: 'Campaign ID', apiName: 'CampaignID', type: 'Integer', keyType: null },
          { label: 'Sent', apiName: 'Sent', type: 'Boolean', keyType: null },
          { label: 'Delivered', apiName: 'Delivered', type: 'Boolean', keyType: null },
          { label: 'Undelivered', apiName: 'Undelivered', type: 'Boolean', keyType: null },
          { label: 'Outbound', apiName: 'Outbound', type: 'Boolean', keyType: null },
          { label: 'Inbound', apiName: 'Inbound', type: 'Boolean', keyType: null },
          { label: 'Create DateTime', apiName: 'CreateDateTime', type: 'DateTime', keyType: null },
          { label: 'Modified DateTime', apiName: 'ModifiedDateTime', type: 'DateTime', keyType: null },
          { label: 'Action DateTime', apiName: 'ActionDateTime', type: 'DateTime', keyType: null },
          { label: 'Message Text', apiName: 'MessageText', type: 'Varchar(160)', keyType: null },
          { label: 'Is Test', apiName: 'IsTest', type: 'Boolean', keyType: null },
          { label: 'Recurrence ID', apiName: 'MobileMessageRecurrenceID', type: 'Integer', keyType: null },
          { label: 'Response To ID', apiName: 'ResponseToMobileMessageTrackingID', type: 'Integer', keyType: null },
          { label: 'Is Valid', apiName: 'IsValid', type: 'Boolean', keyType: null },
          { label: 'Invalidation Code', apiName: 'InvalidationCode', type: 'Integer', keyType: null },
          { label: 'Send ID', apiName: 'SendID', type: 'Integer', keyType: null },
          { label: 'Send Split ID', apiName: 'SendSplitID', type: 'Integer', keyType: null },
          { label: 'Send Segment ID', apiName: 'SendSegmentID', type: 'Integer', keyType: null },
          { label: 'Send Job ID', apiName: 'SendJobID', type: 'Integer', keyType: null },
          { label: 'Send Group ID', apiName: 'SendGroupID', type: 'Integer', keyType: null },
          { label: 'Send Person ID', apiName: 'SendPersonID', type: 'Integer', keyType: null },
          { label: 'Subscriber ID', apiName: 'SubscriberID', type: 'Integer', keyType: null },
          { label: 'Subscriber Key', apiName: 'SubscriberKey', type: 'Varchar(254)', keyType: null },
          { label: 'SMS Status Code ID', apiName: 'SMSStandardStatusCodeId', type: 'Integer', keyType: null },
          { label: 'Description', apiName: 'Description', type: 'Varchar', keyType: null },
          { label: 'Name', apiName: 'Name', type: 'Varchar', keyType: null },
          { label: 'Short Code', apiName: 'ShortCode', type: 'Varchar', keyType: null },
          { label: 'Shared Keyword', apiName: 'SharedKeyword', type: 'Varchar', keyType: null },
          { label: 'Ordinal', apiName: 'Ordinal', type: 'Integer', keyType: null },
          { label: 'From Name', apiName: 'FromName', type: 'Varchar(11)', keyType: null },
          { label: 'JB Activity ID', apiName: 'JBActivityID', type: 'Varchar(36)', keyType: null },
          { label: 'JB Definition ID', apiName: 'JBDefinitionID', type: 'Varchar(36)', keyType: null },
        ],
      },
      {
        type: 'sf.DataObject', label: 'Mobile Address', objectName: '_MobileAddress', headerColor: '#E07D1A', stencilSvg: SVG.dataTable,
        fields: [
          { label: 'Contact ID', apiName: '_ContactID', type: 'Integer', keyType: 'pk' },
          { label: 'Mobile Number', apiName: '_MobileNumber', type: 'Varchar(15)', keyType: 'pk' },
          { label: 'Status', apiName: '_Status', type: 'Varchar', keyType: null },
          { label: 'Source', apiName: '_Source', type: 'Varchar', keyType: null },
          { label: 'Source Object Id', apiName: '_SourceObjectId', type: 'Varchar(200)', keyType: null },
          { label: 'Priority', apiName: '_Priority', type: 'Varchar', keyType: null },
          { label: 'Channel', apiName: '_Channel', type: 'Varchar(20)', keyType: null },
          { label: 'Carrier Id', apiName: '_CarrierId', type: 'Varchar', keyType: null },
          { label: 'Country Code', apiName: '_CountryCode', type: 'Varchar(2)', keyType: null },
          { label: 'Created Date', apiName: '_CreatedDate', type: 'DateTime', keyType: null },
          { label: 'Created By', apiName: '_CreatedBy', type: 'Varchar', keyType: null },
          { label: 'Modified Date', apiName: '_ModifiedDate', type: 'DateTime', keyType: null },
          { label: 'Modified By', apiName: '_ModifiedBy', type: 'Varchar', keyType: null },
          { label: 'City', apiName: '_City', type: 'Varchar(200)', keyType: null },
          { label: 'State', apiName: '_State', type: 'Varchar(200)', keyType: null },
          { label: 'Zip Code', apiName: '_ZipCode', type: 'Varchar(20)', keyType: null },
          { label: 'First Name', apiName: '_FirstName', type: 'Varchar(100)', keyType: null },
          { label: 'Last Name', apiName: '_LastName', type: 'Varchar(100)', keyType: null },
          { label: 'UTC Offset', apiName: '_UTCOffset', type: 'Decimal', keyType: null },
          { label: 'Is Honor DST', apiName: '_IsHonorDST', type: 'Boolean', keyType: null },
        ],
      },
      {
        type: 'sf.DataObject', label: 'Push Address', objectName: '_PushAddress', headerColor: '#E07D1A', stencilSvg: SVG.dataTable,
        fields: [
          { label: 'Contact ID', apiName: '_ContactID', type: 'Integer', keyType: 'pk' },
          { label: 'Device ID', apiName: '_DeviceID', type: 'Varchar(200)', keyType: 'pk' },
          { label: 'App ID', apiName: '_APID', type: 'Varchar(38)', keyType: null },
          { label: 'Status', apiName: '_Status', type: 'Varchar', keyType: null },
          { label: 'Source', apiName: '_Source', type: 'Varchar', keyType: null },
          { label: 'Source Object Id', apiName: '_SourceObjectId', type: 'Varchar(200)', keyType: null },
          { label: 'Platform', apiName: '_Platform', type: 'Varchar(100)', keyType: null },
          { label: 'Platform Version', apiName: '_PlatformVersion', type: 'Varchar(100)', keyType: null },
          { label: 'Alias', apiName: '_Alias', type: 'Varchar(100)', keyType: null },
          { label: 'Opt Out Status ID', apiName: '_OptOutStatusID', type: 'Integer', keyType: null },
          { label: 'Opt Out Method ID', apiName: '_OptOutMethodID', type: 'Integer', keyType: null },
          { label: 'Opt Out Date', apiName: '_OptOutDate', type: 'DateTime', keyType: null },
          { label: 'Opt In Status ID', apiName: '_OptInStatusID', type: 'Integer', keyType: null },
          { label: 'Opt In Method ID', apiName: '_OptInMethodID', type: 'Varchar', keyType: null },
          { label: 'Opt In Date', apiName: '_OptInDate', type: 'DateTime', keyType: null },
          { label: 'Channel', apiName: '_Channel', type: 'Varchar(20)', keyType: null },
          { label: 'Created Date', apiName: '_CreatedDate', type: 'DateTime', keyType: null },
          { label: 'Created By', apiName: '_CreatedBy', type: 'Varchar', keyType: null },
          { label: 'Modified Date', apiName: '_ModifiedDate', type: 'DateTime', keyType: null },
          { label: 'Modified By', apiName: '_ModifiedBy', type: 'Varchar', keyType: null },
          { label: 'City', apiName: '_City', type: 'Varchar(200)', keyType: null },
          { label: 'State', apiName: '_State', type: 'Varchar(200)', keyType: null },
          { label: 'Zip Code', apiName: '_ZipCode', type: 'Varchar(200)', keyType: null },
          { label: 'First Name', apiName: '_FirstName', type: 'Varchar(200)', keyType: null },
          { label: 'Last Name', apiName: '_LastName', type: 'Varchar(200)', keyType: null },
          { label: 'UTC Offset', apiName: '_UTCOffset', type: 'Decimal', keyType: null },
          { label: 'Is Honor DST', apiName: '_IsHonorDST', type: 'Boolean', keyType: null },
          { label: 'System Token', apiName: '_SystemToken', type: 'Varchar(4000)', keyType: null },
          { label: 'Provider Token', apiName: '_ProviderToken', type: 'Varchar(200)', keyType: null },
          { label: 'Badge', apiName: '_Badge', type: 'Integer', keyType: null },
          { label: 'Location Enabled', apiName: '_LocationEnabled', type: 'Boolean', keyType: null },
          { label: 'Time Zone', apiName: '_TimeZone', type: 'Varchar(50)', keyType: null },
          { label: 'Device', apiName: '_Device', type: 'Varchar(100)', keyType: null },
          { label: 'Hardware Id', apiName: '_HardwareId', type: 'Varchar(100)', keyType: null },
          { label: 'Device Type', apiName: '_DeviceType', type: 'Varchar(20)', keyType: null },
        ],
      },
      {
        type: 'sf.DataObject', label: 'Push Tag', objectName: '_PushTag', headerColor: '#E07D1A', stencilSvg: SVG.dataTable,
        fields: [
          { label: 'Device ID', apiName: '_DeviceID', type: 'Varchar(200)', keyType: 'fk' },
          { label: 'App ID', apiName: '_APID', type: 'Varchar(38)', keyType: null },
          { label: 'Value', apiName: '_Value', type: 'Varchar(128)', keyType: null },
          { label: 'Created Date', apiName: '_CreatedDate', type: 'DateTime', keyType: null },
          { label: 'Created By', apiName: '_CreatedBy', type: 'Varchar', keyType: null },
          { label: 'Modified Date', apiName: '_ModifiedDate', type: 'DateTime', keyType: null },
          { label: 'Modified By', apiName: '_ModifiedBy', type: 'Varchar', keyType: null },
        ],
      },
    ],
  },
];

// Helper: resize a DataObject element to fit its fields
export function resizeDataObjectToFit(cell) {
  const fields = cell.get('fields') || [];
  const keyFieldsOnly = cell.get('keyFieldsOnly');
  const visible = keyFieldsOnly ? fields.filter(f => f.keyType) : fields;
  const HEADER_H = 32;
  const ROW_H = 22;
  const height = HEADER_H + Math.max(visible.length, 1) * ROW_H + 4;
  cell.resize(cell.size().width, height);
}

// Lookup map from SVG content → registered icon ID (populated by getAllStencilSvgs)
const stencilSvgToId = new Map();

/** Return the registered icon ID for a stencilSvg string, or '' if not registered. */
export function getStencilSvgIconId(svg) {
  return stencilSvgToId.get(svg) || '';
}

/** Collect all unique stencilSvg definitions for icon registry registration.
 *  Returns [{ id, name, svg, viewBox }] — SVG constant entries + inline template icons. */
export function getAllStencilSvgs() {
  const result = [];
  const seenSvg = new Set();
  stencilSvgToId.clear();

  // 1. SVG constant entries (shape icons)
  const humanNames = {
    node: 'Node', container: 'Container', text: 'Text', note: 'Note', zone: 'Zone',
    flowProcess: 'Process', flowDecision: 'Decision', flowTerminator: 'Terminator',
    flowDatabase: 'Database', flowDocument: 'Document', flowIO: 'Input/Output',
    flowPredefined: 'Predefined Process', orgPerson: 'Person', orgDepartment: 'Department',
    orgTeam: 'Team', eventStart: 'Start Event', eventEnd: 'End Event',
    eventIntermediate: 'Intermediate Event', task: 'Task', subprocess: 'Subprocess',
    loop: 'Loop', gatewayExcl: 'Exclusive Gateway', gatewayPar: 'Parallel Gateway',
    gatewayIncl: 'Inclusive Gateway', gatewayEvt: 'Event Gateway',
    dataObject: 'Data Object', poolH: 'Pool (Horizontal)', poolV: 'Pool (Vertical)',
    flowStart: 'Flow Start', flowOffPage: 'Off-Page', annotation: 'Annotation',
    dataTable: 'Data Table',
  };
  for (const [key, svg] of Object.entries(SVG)) {
    const id = 'custom-' + key.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    result.push({ id, name: humanNames[key] || key, svg, viewBox: '0 0 20 20' });
    seenSvg.add(svg);
    stencilSvgToId.set(svg, id);
  }

  // 2. Inline stencilSvg from all template categories
  const allCats = [...TEMPLATE_CATEGORIES, ...BPMN_CATEGORIES, ...GANTT_CATEGORIES, ...ORG_CATEGORIES, ...DATAMODEL_CATEGORIES];
  for (const cat of allCats) {
    for (const tpl of cat.templates || []) {
      if (!tpl.stencilSvg || seenSvg.has(tpl.stencilSvg)) continue;
      seenSvg.add(tpl.stencilSvg);
      const label = tpl.label || 'Icon';
      const id = 'custom-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
      result.push({ id, name: label, svg: tpl.stencilSvg, viewBox: '0 0 20 20' });
      stencilSvgToId.set(tpl.stencilSvg, id);
    }
  }

  return result;
}

// Create a JointJS element from a template config at the given position
export function createElementFromTemplate(template, position = { x: 100, y: 100 }) {
  const { type, label, iconName, bg, accentColor, subtitle } = template;

  switch (type) {
    case 'sf.SimpleNode': {
      const textColor = bg ? contrastTextColor(bg) : null;
      const iconColor = textColor || getComputedStyle(document.documentElement).getPropertyValue('--node-text').trim() || '#1C1E21';
      // If template has stencilSvg and iconName is a generic placeholder, prefer stencilSvg for canvas
      const useStencilSvg = !template.noCanvasIcon && template.stencilSvg && (!iconName || iconName === 'client');
      let iconHref = '';
      if (useStencilSvg) {
        // Use registered symbol ID so icon picker can identify it
        const registeredId = getStencilSvgIconId(template.stencilSvg);
        iconHref = registeredId ? getIconDataUri(registeredId, iconColor) : getStencilSvgDataUri(template.stencilSvg, iconColor);
      } else if (iconName) {
        iconHref = getIconDataUri(iconName, iconColor);
      }
      const attrs = {
        label: { text: label || 'Node' },
        subtitle: { text: subtitle || '' },
      };
      if (bg) attrs.body = { fill: bg };
      if (textColor) {
        attrs.label.fill = textColor;
        attrs.subtitle.fill = textColor;
        attrs.subtitle.opacity = 0.7;
      }
      if (iconHref) attrs.icon = { href: iconHref };
      return new joint.shapes.sf.SimpleNode({ position, attrs });
    }

    case 'sf.Container': {
      const iconHref = iconName ? getIconDataUri(iconName, '#FFFFFF') : '';
      const attrs = {
        headerLabel: { text: label || 'Container' },
      };
      if (accentColor) {
        attrs.accent = { fill: accentColor };
        attrs.accentFill = { fill: accentColor };
      }
      if (iconHref) attrs.headerIcon = { href: iconHref };
      return new joint.shapes.sf.Container({ position, attrs });
    }

    case 'sf.TextLabel':
      return new joint.shapes.sf.TextLabel({
        position,
        attrs: { label: { text: label || 'Label' } },
      });

    case 'sf.Line':
      return new joint.shapes.sf.Line({ position });

    case 'sf.Link': {
      const color = '#1D73C9';
      const iconHref = getStencilSvgDataUri(SVG.linkIcon, color, 20);
      const url = template.url || '';
      const domain = extractLinkDomain(url);
      return new joint.shapes.sf.Link({
        position,
        url,
        attrs: {
          label: {
            text: label || 'Link',
            fill: color,
            y: domain ? 'calc(0.5 * h - 8)' : 'calc(0.5 * h)',
          },
          domain: { text: domain },
          iconImage: { href: iconHref },
        },
      });
    }

    case 'sf.Note': {
      const noteIconId = iconName || 'light_bulb';
      const noteIconColor = '#5D4037';
      return new joint.shapes.sf.Note({
        position,
        attrs: {
          label: { text: label || 'Note' },
          icon: { href: getIconDataUri(noteIconId, noteIconColor, 20) },
        },
      });
    }


    case 'sf.Zone':
      return new joint.shapes.sf.Zone({
        position,
        attrs: { label: { text: label || 'Zone' } },
      });

    // ── BPMN shapes ──────────────────────────────────────────

    case 'sf.BpmnEvent': {
      const eventType = template.eventType || 'start';
      const attrs = { label: { text: label || '' } };
      // Style based on event type — distinct fill + border colors so each
      // type is unambiguously recognizable in both light and dark themes.
      if (eventType === 'end') {
        attrs.body = { fill: '#F9E3E5', stroke: '#DA4E55', strokeWidth: 4 };
        attrs.icon = { fill: '#DA4E55' };
      } else if (eventType === 'intermediate') {
        attrs.body = { fill: '#FDF1DC', stroke: '#F6B355', strokeWidth: 1.5 };
        attrs.innerRing = { stroke: '#F6B355', strokeWidth: 1.5 };
        attrs.icon = { fill: '#F6B355' };
      } else {
        attrs.body = { fill: '#DCF1E2', stroke: '#4FAE7B', strokeWidth: 1.5 };
        attrs.icon = { fill: '#4FAE7B' };
      }
      return new joint.shapes.sf.BpmnEvent({ position, attrs, eventType });
    }

    case 'sf.BpmnTask':
      return new joint.shapes.sf.BpmnTask({
        position,
        attrs: { label: { text: label || 'Task' } },
      });

    case 'sf.BpmnGateway': {
      const gatewayType = template.gatewayType || 'exclusive';
      const markers = {
        exclusive: '\u00D7',   // ×
        parallel:  '+',
        inclusive: '\u25CB',   // ○
        event:    '\u25C7',   // ◇
      };
      return new joint.shapes.sf.BpmnGateway({
        position,
        attrs: {
          marker: { text: markers[gatewayType] || '\u00D7' },
          label: { text: label || '' },
        },
        gatewayType,
      });
    }

    case 'sf.BpmnSubprocess':
      return new joint.shapes.sf.BpmnSubprocess({
        position,
        attrs: { label: { text: label || 'Subprocess' } },
      });

    case 'sf.BpmnLoop':
      return new joint.shapes.sf.BpmnLoop({
        position,
        attrs: { label: { text: label || 'Loop' } },
      });

    case 'sf.BpmnPool': {
      const isVertical = template.poolDirection === 'vertical';
      if (isVertical) {
        return new joint.shapes.sf.BpmnPool({
          position,
          size: { width: 250, height: 600 },
          attrs: {
            header: {
              width: 'calc(w)',
              height: 30,
            },
            label: {
              text: label || 'Pool',
              x: 'calc(0.5 * w)',
              y: 15,
              transform: 'rotate(0)',
            },
          },
          poolDirection: 'vertical',
        });
      }
      return new joint.shapes.sf.BpmnPool({
        position,
        attrs: { label: { text: label || 'Pool' } },
      });
    }

    case 'sf.BpmnDataObject':
      return new joint.shapes.sf.BpmnDataObject({
        position,
        attrs: { label: { text: label || 'Data' } },
      });

    // ── Flowchart shapes ────────────────────────────────────

    case 'sf.FlowProcess':
      return new joint.shapes.sf.FlowProcess({
        position,
        attrs: { label: { text: label || 'Process' } },
      });

    case 'sf.FlowDecision':
      return new joint.shapes.sf.FlowDecision({
        position,
        attrs: { label: { text: label || 'Decision' } },
      });

    case 'sf.FlowTerminator':
      return new joint.shapes.sf.FlowTerminator({
        position,
        attrs: { label: { text: label || 'Start' } },
      });

    case 'sf.FlowDatabase':
      return new joint.shapes.sf.FlowDatabase({
        position,
        attrs: { label: { text: label || 'Database' } },
      });

    case 'sf.FlowDocument':
      return new joint.shapes.sf.FlowDocument({
        position,
        attrs: { label: { text: label || 'Document' } },
      });

    case 'sf.FlowIO':
      return new joint.shapes.sf.FlowIO({
        position,
        attrs: { label: { text: label || 'Input / Output' } },
      });

    case 'sf.FlowPredefined':
      return new joint.shapes.sf.FlowPredefined({
        position,
        attrs: { label: { text: label || 'Predefined' } },
      });

    case 'sf.FlowOffPage':
      return new joint.shapes.sf.FlowOffPage({
        position,
        attrs: { label: { text: template.defaultLabel || 'Link' } },
      });

    case 'sf.Annotation': {
      const side = template.bracketSide || 'right';
      return new joint.shapes.sf.Annotation({
        position,
        bracketSide: side,
        attrs: { label: { text: label || 'Annotation' } },
      });
    }

    // ── Data Model shapes ───────────────────────────────────

    case 'sf.DataObject': {
      const fields = template.fields || [
        { label: 'Id', apiName: 'Id', type: 'ID', keyType: 'pk' },
      ];
      const objectName = template.objectName || label || 'Object';
      const headerColor = template.headerColor || '#1D73C9';
      const HEADER_H = 32;
      const ROW_H = 22;
      const height = HEADER_H + Math.max(fields.length, 1) * ROW_H + 4;
      return new joint.shapes.sf.DataObject({
        position,
        size: { width: 260, height },
        objectName,
        headerColor,
        fields: fields.map(f => ({ ...f })),
        attrs: {
          header: { fill: headerColor },
          headerCover: { fill: headerColor },
          headerLabel: { text: objectName },
        },
      });
    }

    // ── Gantt shapes ──────────────────────────────────────────

    case 'sf.GanttTask': {
      const barColor = template.barColor || '#1D73C9';
      const progress = template.progress ?? 0;
      const taskWidth = 160;
      const barWidth = Math.round(taskWidth * progress / 100);
      const textColor = progress > 0 ? '#FFFFFF' : 'var(--node-text)';
      const pctColor = progress > 0 ? '#FFFFFF' : 'var(--text-secondary)';
      const assigneeColor = progress > 0 ? '#FFFFFF' : 'var(--text-secondary)';
      const bodyFill = (progress > 0 && progress < 100) ? 'var(--gantt-task-uncompleted)' : 'var(--node-bg)';
      return new joint.shapes.sf.GanttTask({
        position,
        taskLabel: template.taskLabel || label || 'Task',
        progress,
        startDate: template.startDate || '',
        endDate: template.endDate || '',
        assignee: template.assignee || '',
        attrs: {
          label: { text: template.taskLabel || label || 'Task', fill: textColor },
          progressBar: { fill: barColor, width: barWidth },
          percentLabel: { text: progress > 0 ? `${progress}%` : '', fill: pctColor },
          assigneeLabel: { fill: assigneeColor },
          body: { fill: progress > 0 ? bodyFill : undefined },
        },
      });
    }

    case 'sf.GanttMilestone':
      return new joint.shapes.sf.GanttMilestone({
        position,
        attrs: { label: { text: label || 'Milestone' } },
      });

    case 'sf.GanttMarker':
      return new joint.shapes.sf.GanttMarker({
        position,
        attrs: { label: { text: label || 'Today' } },
      });

    case 'sf.GanttGroup':
      return new joint.shapes.sf.GanttGroup({
        position,
        attrs: { label: { text: template.phaseLabel || label || 'Phase' } },
      });

    case 'sf.GanttTimeline': {
      // Default to today's date; auto-calculate end date
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      const startDate = `${yyyy}-${mm}-${dd}`;
      const mode = template.viewMode || 'week';
      const periods = template.numPeriods || 12;
      const endD = new Date(today);
      if (mode === 'day') endD.setDate(endD.getDate() + periods);
      else if (mode === 'week') endD.setDate(endD.getDate() + periods * 7);
      else endD.setMonth(endD.getMonth() + periods);
      const endDate = endD.toISOString().slice(0, 10);
      return new joint.shapes.sf.GanttTimeline({
        position,
        startDate,
        endDate,
        viewMode: mode,
        numPeriods: periods,
        tasks: [
          { id: 'g1', type: 'group', label: 'Phase 1', color: '#1D73C9' },
          { id: 't1', type: 'task', label: 'Task 1', groupId: 'g1', color: '#1D73C9' },
        ],
      });
    }

    // ── Sequence Diagram shapes ──────────────────────────────

    case 'sf.SequenceParticipant': {
      const role = template.role || 'generic';
      const accent = template.accentColor || '#8A9099';
      const labelText = label || 'Participant';
      // Only the accent bar on top of the header is tinted by the role colour;
      // the header border/lifeline/underline keep the default theme colour so
      // participants look consistent across roles (no coloured borders).
      // labelBottom is initialised in parallel so the bottom-label mirror
      // matches from the moment the participant is dropped.
      return new joint.shapes.sf.SequenceParticipant({
        position,
        participantRole: role,
        attrs: {
          label: { text: labelText },
          labelBottom: { text: labelText },
          headerAccent: { fill: accent },
          headerBottomAccent: { fill: accent },
        },
      });
    }

    case 'sf.SequenceActor': {
      // Actor ignores role accent entirely — the stick figure + label use the
      // default theme-aware stroke from the shape definition, matching the
      // neutral look of Participant so Actor doesn't stand out with a tint.
      return new joint.shapes.sf.SequenceActor({
        position,
        participantRole: 'actor',
        attrs: {
          label: { text: label || 'Actor' },
        },
      });
    }

    case 'sf.SequenceActivation':
      return new joint.shapes.sf.SequenceActivation({ position });

    case 'sf.SequenceFragment': {
      const fragmentType = template.fragmentType || 'standard';
      const fragmentLabel = template.fragmentLabel || (fragmentType === 'alternative' ? 'alt' : 'loop');
      const isAlt = fragmentType === 'alternative';
      const condition = template.condition ?? 'if';
      const elseCondition = template.elseCondition ?? 'else';
      const cell = new joint.shapes.sf.SequenceFragment({
        position,
        fragmentType,
        fragmentLabel,
        condition,
        elseCondition,
        attrs: {
          titleText: { text: fragmentLabel },
          conditionText: { text: condition ? `[${condition}]` : '' },
          dividerLine: { visibility: isAlt ? 'visible' : 'hidden' },
          elseText: {
            text: isAlt ? `[${elseCondition}]` : '',
            visibility: isAlt ? 'visible' : 'hidden',
          },
        },
      });
      // Auto-size the title tab to the label (delayed so the cell is in DOM
      // terms already visible to the SVG measurement sandbox).
      requestAnimationFrame(() => {
        if (joint.shapes.sf.updateFragmentTitleTab) {
          joint.shapes.sf.updateFragmentTitleTab(cell);
        }
      });
      return cell;
    }

    // ── Organisation shapes ──────────────────────────────────

    case 'sf.OrgPerson': {
      const jt = template.jobTitle || '';
      const pName = template.personName || 'Name';
      const initials = pName.split(/\s+/).map(w => w[0]).join('').substring(0, 2).toUpperCase();
      return new joint.shapes.sf.OrgPerson({
        position,
        personName: pName,
        jobTitle: jt,
        email: template.email || '',
        phone: template.phone || '',
        role: template.role || '',
        stream: template.stream || '',
        location: template.location || '',
        company: template.company || '',
        attrs: {
          nameLabel: { text: pName },
          positionLabel: { text: jt },
          avatarText: { text: initials },
          accentBar: { fill: template.accentColor || '#1D73C9' },
          accentBarMask: { fill: template.accentColor || '#1D73C9' },
        },
      });
    }

    default:
      console.warn('SF Diagrams: Unknown template type:', type);
      return null;
  }
}


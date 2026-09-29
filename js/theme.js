// Theme manager - light / dark / system, the same model as mateuszdabrowski.pl (Docusaurus colorMode with
// respectPrefersColorScheme). The CHOICE is 'system' (the default: follow the OS, live) or an explicit 'light' /
// 'dark'; the toolbar button cycles system -> light -> dark -> system. Only an explicit choice is stored
// (localStorage['sf-diagrams-theme']); choosing system removes the key, so "never chose" and "chose system" are one
// state and a stored 'light' / 'dark' from before this change keeps working. js/theme-boot.js applies the same rule
// before first paint; this module owns it after boot.
//   <html data-theme>        the RESOLVED theme ('light' | 'dark') - every [data-theme="dark"] rule keys on it
//   <html data-theme-choice> the choice ('system' | 'light' | 'dark') - picks the button's icon

const STORAGE_KEY = 'sf-diagrams-theme';
const NEXT = Object.assign(Object.create(null), { system: 'light', light: 'dark', dark: 'system' });
const LABEL = Object.assign(Object.create(null), { system: 'System mode', light: 'Light mode', dark: 'Dark mode' });

let choice = 'system';
let resolved = 'dark';
let osDark = null;                 // MediaQueryList for (prefers-color-scheme: dark); null where unsupported
const listeners = new Set();

export function init() {
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* storage blocked: follow the OS */ }
  choice = saved === 'light' || saved === 'dark' ? saved : 'system';
  osDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  // The OS can switch while the app is open (e.g. macOS Auto appearance at sunset). Only system mode follows it.
  osDark?.addEventListener?.('change', () => { if (choice === 'system') apply(); });
  apply();
}

// Advance to the next choice in the cycle and remember it.
export function toggle() {
  choice = NEXT[choice];
  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch { /* storage blocked: the choice lasts for this page only */ }
  apply();
}

export function getChoice() { return choice; }
export function getTheme() { return resolved; }

// Called with the resolved theme whenever it changes - from the button OR from the OS in system mode - so the
// canvas can repaint what CSS cannot reach (grid colour, baked icon colours).
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function apply() {
  const before = resolved;
  resolved = choice === 'system' ? (!osDark || osDark.matches ? 'dark' : 'light') : choice;
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-theme-choice', choice);
  labelControls();
  if (resolved !== before) for (const fn of listeners) fn(resolved);
}

// "System mode. Click for light mode." - the website's tooltip wording, on the toolbar button and its hamburger twin.
function labelControls() {
  const tip = `${LABEL[choice]}. Click for ${LABEL[NEXT[choice]].toLowerCase()}.`;
  const aria = `Switch between dark and light mode (currently ${LABEL[choice].toLowerCase()})`;
  const btn = document.getElementById('btn-theme');
  if (btn) { btn.title = tip; btn.setAttribute('aria-label', aria); }
  for (const el of document.querySelectorAll('[data-theme-label]')) el.textContent = `Theme: ${LABEL[choice].replace(' mode', '')}`;
  const item = document.querySelector('.df-toolbar__menu-item[data-action="theme"]');
  if (item) item.title = tip;
}

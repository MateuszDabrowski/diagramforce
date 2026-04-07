// Theme manager — toggles light/dark mode
// Persists to localStorage, defaults to dark

const STORAGE_KEY = 'sf-diagrams-theme';

let currentTheme = 'dark';

export function init() {
  const saved = localStorage.getItem(STORAGE_KEY);
  currentTheme = saved || 'dark';
  applyTheme(currentTheme);
}

export function toggle() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(currentTheme);
  localStorage.setItem(STORAGE_KEY, currentTheme);
}

export function getTheme() {
  return currentTheme;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

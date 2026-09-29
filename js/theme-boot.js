// Diagramforce - theme before first paint.
// A CLASSIC, render-blocking script in <head> (not a module, not deferred): it must set the theme before the body
// paints, or a light-OS visitor sees the hard-coded dark <html> flash on every load. The CSP forbids inline scripts,
// so this is its own same-origin file. It applies the same rule as js/theme.js, which takes over once the app boots:
//   stored 'light' / 'dark' = the visitor's explicit choice; anything else = 'system', which follows the OS.
(function () {
  var choice = null;
  try { choice = localStorage.getItem('sf-diagrams-theme'); } catch (e) { /* storage blocked: follow the OS */ }
  if (choice !== 'light' && choice !== 'dark') choice = 'system';
  var dark = choice === 'dark'
    || (choice === 'system' && (!window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches));
  var root = document.documentElement;
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.setAttribute('data-theme-choice', choice);
})();

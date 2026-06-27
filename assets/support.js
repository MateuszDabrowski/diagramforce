// Wires up support.html's "Email support" button at runtime. The address is assembled here from split
// parts, so it appears literally NOWHERE in served source — not in support.html, and not as a matchable
// pattern in this file (a regex like \w+@\w+ over this script finds nothing). This defeats the large
// majority of email harvesters, which scrape static HTML (at most linked JS) without executing it. The
// mailto is pre-filled with the user's app version (read from their own same-origin session, if present)
// and browser, so messages arrive with the detail I need. JS-off users get the readable, un-harvestable
// "support_diagramforce at mateuszdabrowski dot pl" <noscript> fallback in the page.
(function () {
  'use strict';
  var el = document.getElementById('df-support-email');
  if (!el) return;

  var addr = ['support', 'diagramforce'].join('_') + '@' + ['mateuszdabrowski', 'pl'].join('.');

  // App version from the user's OWN stored session (same origin) — accurate to the build they actually run.
  // Absent if they reached this page without using the app here; then the version line is simply omitted.
  var ver = '';
  try {
    var s = JSON.parse(localStorage.getItem('sf-diagrams-tabs') || '{}');
    if (s && typeof s.appVersion === 'string') ver = s.appVersion;
  } catch (e) { /* private mode / parse error */ }

  var lines = [
    'Hi,',
    '',
    '[Describe your question or topic here.]',
    '',
    '',
    '----- details (please keep, they help me reply) -----'
  ];
  if (ver) lines.push('App version: ' + ver);
  lines.push('Browser: ' + navigator.userAgent);

  var href = 'mailto:' + addr
    + '?subject=' + encodeURIComponent('Diagramforce support')
    + '&body=' + encodeURIComponent(lines.join('\n'));
  el.setAttribute('href', href);
  el.setAttribute('rel', 'nofollow');
})();

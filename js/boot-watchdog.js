// Diagramforce - boot watchdog.
// A CLASSIC script (not a module), so it runs even when the app's module graph does not: one module that fails to
// load or parse stops js/app.js from running at all, main().catch never runs, and the page used to sit there with a
// dead toolbar and no word about why (review I10). The CSP forbids inline scripts, so this is its own same-origin
// file, like js/theme-boot.js. It shows a banner saying the diagrams are still saved and offering Reload:
//   - at once when a same-origin script fails to load or a same-origin script has a SyntaxError (an old Safari
//     without regex lookbehind cannot parse a module), or when app.js reports main() threw (window.__dfBootFailed);
//   - when the app has not reported a finished boot (window.__dfBootDone) BOOT_GRACE_MS after the page loaded.
// A finished boot removes the banner again, so a slow first visit that gets there late heals itself.
(function () {
  var BOOT_GRACE_MS = 10000;
  var firstError = '';

  function show(failed, detail) {
    if (window.__dfBooted) return;
    var old = document.getElementById('df-boot-failure');
    if (old) { if (!failed || old.getAttribute('data-failed')) return; old.remove(); }
    var bar = document.createElement('div');
    bar.id = 'df-boot-failure';
    bar.setAttribute('role', 'alert');
    if (failed) bar.setAttribute('data-failed', '1');
    // Fixed colours, not tokens: the banner must read even when the stylesheets did not load. White on #B3261E is
    // about 6.5:1, opaque, so it reads the same on either theme.
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:12px 16px;'
      + 'background:#B3261E;color:#FFFFFF;font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;'
      + 'display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
    var text = document.createElement('div');
    text.style.cssText = 'flex:1 1 320px;';
    var title = document.createElement('strong');
    title.textContent = failed ? 'Diagramforce could not start.' : 'Diagramforce is taking longer than usual to start.';
    text.appendChild(title);
    text.appendChild(document.createTextNode(failed
      ? ' Your diagrams are still saved in this browser. Reload to try again.'
      : ' Your diagrams are still saved in this browser. If nothing changes, reload.'));
    if (detail) {
      var d = document.createElement('div');
      d.style.cssText = 'opacity:0.85;font-size:12px;margin-top:2px;word-break:break-word;';
      d.textContent = 'Details: ' + detail;
      text.appendChild(d);
    }
    var reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = 'Reload';
    reload.style.cssText = 'font:inherit;font-weight:600;padding:6px 14px;border:0;border-radius:4px;'
      + 'background:#FFFFFF;color:#B3261E;cursor:pointer;';
    reload.addEventListener('click', function () { location.reload(); });
    var help = document.createElement('a');
    help.href = 'support.html';
    help.textContent = 'Get help';
    help.style.cssText = 'color:#FFFFFF;text-decoration:underline;';
    bar.appendChild(text);
    bar.appendChild(reload);
    bar.appendChild(help);
    (document.body || document.documentElement).appendChild(bar);
  }

  // Capture phase: a script's load error does not bubble. Image and other resource errors are not boot failures.
  window.addEventListener('error', function (e) {
    if (window.__dfBooted) return;
    var t = e.target;
    var own = location.origin + '/';
    if (t && t.tagName === 'SCRIPT') {
      var src = t.src || '';
      if (src.indexOf(own) !== 0) return;   // a third-party script (Google sign-in) is not the app
      // A missing import fires on the root module (js/app.js), not on the file that is missing, so do not name it.
      show(true, t.type === 'module' ? 'a module of the app failed to load'
        : 'a script failed to load (' + src.slice(own.length) + ')');
      return;
    }
    // A module that does not parse arrives only as this ErrorEvent, and nothing of the app runs after it, so do not
    // wait out the grace period. A runtime SyntaxError (JSON.parse) during boot shows it too, and a boot that then
    // finishes removes it.
    if (/SyntaxError/.test(e.message || '') && (e.filename || '').indexOf(own) === 0) {
      show(true, e.message + ' (' + e.filename.slice(own.length).split('?')[0] + ')');
      return;
    }
    if (!firstError && e.message) firstError = e.message;
  }, true);

  window.__dfBootFailed = function (err) {
    show(true, (err && (err.message || String(err))) || firstError);
  };
  window.__dfBootDone = function () {
    window.__dfBooted = true;
    var bar = document.getElementById('df-boot-failure');
    if (bar) bar.remove();
  };

  function arm() {
    setTimeout(function () { if (!window.__dfBooted) show(!!firstError, firstError); }, BOOT_GRACE_MS);
  }
  if (document.readyState === 'complete') arm(); else window.addEventListener('load', arm);
})();

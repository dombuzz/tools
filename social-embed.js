// Für die Tab-Seiten von /social (social-profil, social-novitads, social-mument):
// - Im Rahmen von /social (iframe): Embed-Modus (Klasse «embed» auf <html>) und Nutzungsmeldung an /social, damit dort gezählt wird (Download = Nutzung).
// - Direkt geöffnet (kein iframe): wie ein normales Tool mit like.js.
(function () {
  if (window.parent === window) {
    document.addEventListener('DOMContentLoaded', function () {
      var s = document.createElement('script'); s.src = '/like.js'; s.defer = true; document.body.appendChild(s);
    });
    return;
  }
  var root = document.documentElement;
  root.classList.add('embed');
  /* Kein eigener Container: Seite wird in voller Höhe gezeigt (Höhe geht an /social), Hintergrund durchsichtig. */
  var st = document.createElement('style');
  st.textContent = 'html.embed,html.embed body{background:transparent!important;background-image:none!important;min-height:0!important;height:auto!important}' +
    '@media(min-width:861px){html.embed{overflow:hidden!important}}' +
    /* Handy: Rahmen = Bildschirmhöhe, Vorschau oben fixiert (wie /maletgs), Einstellungen scrollen darunter */
    '@media(max-width:860px){html.embed .stick{position:sticky!important;top:0!important;z-index:20;background:var(--bg);padding-bottom:4px}html.embed .stick .card{padding:10px 12px}html.embed .stick .row{gap:6px;margin-bottom:6px!important}html.embed .stick .row[style*="margin-top"]{margin-top:8px!important}html.embed .stick .hint,html.embed .stick .warn{display:none}}' +
    'html.embed body::before,html.embed body::after{display:none!important}html.embed .wrap,html.embed .container{max-width:none!important}';
  (document.head || root).appendChild(st);
  /* Höhe an /social melden */
  var lastH = 0;
  function sendH() {
    if (!document.body) return;
    var h = Math.ceil(document.body.getBoundingClientRect().bottom + (window.pageYOffset || 0));
    if (h && h !== lastH) { lastH = h; try { parent.postMessage({ dbzH: h }, location.origin); } catch (e) {} }
  }
  /* Sichtfenster von /social (für «100vh»-Masse und mitlaufende Vorschau) */
  var view = { vh: window.innerHeight, off: 0 };
  function applyView() {
    var mob = window.innerWidth <= 860;
    /* Handy: Vorschau nur ca. 20 % der Bildschirmhöhe, damit die Einstellungen darunter sichtbar bleiben */
    var off = /novitads/.test(location.pathname) ? 150 : 210;
    root.style.setProperty('--vh', (mob ? Math.round(view.vh * 0.2 + off) : view.vh) + 'px');
    document.querySelectorAll('.stick').forEach(function (el) {
      var par = el.parentElement; if (!par) return;
      /* Einspaltig (Handy): normal mitscrollen, keine mitlaufende Vorschau */
      if (window.innerWidth <= 860) { el.style.position = ''; el.style.top = ''; el.style.transform = ''; return; }
      el.style.position = 'relative'; el.style.top = '0'; el.style.transform = 'none';
      var pt = par.getBoundingClientRect().top + (window.pageYOffset || 0);
      var ty = Math.max(0, Math.min(view.off - pt + 16, par.offsetHeight - el.offsetHeight));
      el.style.transform = 'translateY(' + ty + 'px)';
    });
  }
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || !e.data.dbzView) return;
    view = e.data.dbzView; lastH = 0; applyView(); sendH();
  });
  /* Scrittira: die Karte in der Seite ausblenden, Status/Knopf stattdessen oben rechts in /social zeigen */
  function fontSetup() {
    var fs = document.getElementById('fState'), fb = document.getElementById('fBtn'), ff = document.getElementById('fFile');
    if (!fs || !fb || !ff) return;
    var card = ff.closest('.card'); if (card) card.style.display = 'none';
    function post() { try { parent.postMessage({ dbzFont: { html: fs.innerHTML, btn: fb.firstChild ? fb.firstChild.textContent : '' } }, location.origin); } catch (e) {} }
    new MutationObserver(post).observe(card || fs, { childList: true, subtree: true, characterData: true });
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data || !e.data.dbzFontFiles) return;
      if (ff.onchange) ff.onchange({ target: { files: e.data.dbzFontFiles, value: '' } });
    });
    post();
  }
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(fontSetup, 0);
    if ('ResizeObserver' in window) new ResizeObserver(function () { sendH(); applyView(); }).observe(document.body);
    sendH(); try { parent.postMessage({ dbzReady: true }, location.origin); } catch (e) {}
  });
  window.addEventListener('load', sendH);
  var id = (location.pathname.replace(/\.html?$/i, '').split('/').pop() || '').replace(/^social-/, '');
  function use() { try { parent.postMessage({ dbzUse: id }, location.origin); } catch (e) {} }
  var orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) use(); return orig.apply(this, arguments); };
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a[download]')) use(); }, true);
  window.addEventListener('dbz-success', use);
})();

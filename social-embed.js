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
  document.documentElement.classList.add('embed');
  var id = (location.pathname.replace(/\.html?$/i, '').split('/').pop() || '').replace(/^social-/, '');
  function use() { try { parent.postMessage({ dbzUse: id }, location.origin); } catch (e) {} }
  var orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) use(); return orig.apply(this, arguments); };
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a[download]')) use(); }, true);
  window.addEventListener('dbz-success', use);
})();
